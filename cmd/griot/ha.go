package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"sync"
	"sync/atomic"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/leaderelection"
	"k8s.io/client-go/tools/leaderelection/resourcelock"

	"github.com/tym83/sankofa/pkg/history"
)

// elect runs the recorder only while this replica holds the lease. Every
// replica serves reads from the shared store. Losing the lease ends the
// process: a recorder that may have been replaced must not keep writing.
func elect(ctx context.Context, log *slog.Logger, kube kubernetes.Interface, o options, lead func(context.Context)) {
	id, _ := os.Hostname()
	if id == "" {
		id = fmt.Sprintf("griot-%d", time.Now().UnixNano())
	}
	ns := o.leaseNamespace
	if ns == "" {
		ns = "default"
	}
	lock := &resourcelock.LeaseLock{
		LeaseMeta:  metav1.ObjectMeta{Name: o.leaseName, Namespace: ns},
		Client:     kube.CoordinationV1(),
		LockConfig: resourcelock.ResourceLockConfig{Identity: id},
	}
	leaderelection.RunOrDie(ctx, leaderelection.LeaderElectionConfig{
		Lock:            lock,
		LeaseDuration:   15 * time.Second,
		RenewDeadline:   10 * time.Second,
		RetryPeriod:     2 * time.Second,
		ReleaseOnCancel: true,
		Name:            o.leaseName,
		Callbacks: leaderelection.LeaderCallbacks{
			OnStartedLeading: func(ctx context.Context) {
				log.Info("leading: this replica records", "identity", id)
				lead(ctx)
			},
			OnStoppedLeading: func() {
				if ctx.Err() == nil {
					log.Error("lost the recorder lease; exiting", "identity", id)
					os.Exit(1)
				}
			},
			OnNewLeader: func(who string) {
				if who != id {
					log.Info("following: reads only", "leader", who)
				}
			},
		},
	})
}

// retain applies the policy periodically on the recording replica, and
// vacuums the store every vacuumEvery (0: never).
func retain(ctx context.Context, log *slog.Logger, s history.Store, p history.Policy, every, vacuumEvery time.Duration, m *metrics) {
	t := time.NewTicker(every)
	defer t.Stop()
	lastVacuum := time.Now()
	for {
		start := time.Now()
		st, err := s.Retain(ctx, p, start)
		if err != nil {
			log.Warn("retention", "err", err)
		} else if st.Total() > 0 {
			log.Info("forgot old changes", "compacted", st.Compacted, "expired", st.Expired, "trimmed", st.Trimmed, "tombstones", st.Tombstones, "took", time.Since(start))
		}
		m.retained(st, time.Since(start))
		if vacuumEvery > 0 && time.Since(lastVacuum) >= vacuumEvery {
			vs := time.Now()
			if err := s.Vacuum(ctx); err != nil {
				log.Warn("vacuum", "err", err)
			} else {
				log.Info("vacuumed the store", "took", time.Since(vs))
				m.vacuumed(time.Since(vs))
			}
			lastVacuum = time.Now()
		}
		if size, err := s.Stats(ctx); err == nil {
			m.stats(size)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// metrics serves the recorder's counters in the Prometheus text format.
type metrics struct {
	rec    *history.Recorder
	store  history.Store
	leader atomic.Bool

	mu        sync.Mutex
	forgotten int64
	retainDur time.Duration
	vacuumDur time.Duration
	size      history.Stats
}

func (m *metrics) vacuumed(d time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.vacuumDur = d
}

func (m *metrics) retained(st history.RetainStats, d time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.forgotten += st.Total()
	m.retainDur = d
}

func (m *metrics) stats(s history.Stats) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.size = s
}

func (m *metrics) ServeHTTP(w http.ResponseWriter, _ *http.Request) {
	c := &m.rec.Counters
	m.mu.Lock()
	size, forgotten, rd, vd := m.size, m.forgotten, m.retainDur, m.vacuumDur
	m.mu.Unlock()
	leader := 0
	if m.leader.Load() {
		leader = 1
	}
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	for _, l := range []struct {
		name, kind, help string
		v                any
	}{
		{"griot_leader", "gauge", "1 when this replica records", leader},
		{"griot_events_total", "counter", "informer events seen", c.Events.Load()},
		{"griot_events_unchanged_total", "counter", "events that changed nothing remembered", c.Skipped.Load()},
		{"griot_records_written_total", "counter", "records committed", c.Written.Load()},
		{"griot_batches_total", "counter", "write transactions committed", c.Batches.Load()},
		{"griot_write_errors_total", "counter", "failed write transactions", c.Errors.Load()},
		{"griot_deaths_swept_total", "counter", "deaths found after a restart", c.Swept.Load()},
		{"griot_queue_records", "gauge", "records waiting to be written", c.Queue.Load()},
		{"griot_last_batch_lag_seconds", "gauge", "event-to-commit delay of the oldest record of the last batch", float64(c.LagMilli.Load()) / 1000},
		{"griot_store_records", "gauge", "records in the store at the last retention run", size.Records},
		{"griot_store_objects", "gauge", "object incarnations in the store at the last retention run", size.Objects},
		{"griot_store_bytes", "gauge", "store size at the last retention run", size.Bytes},
		{"griot_retention_forgotten_total", "counter", "records forgotten by retention and compaction", forgotten},
		{"griot_retention_last_seconds", "gauge", "duration of the last retention run", rd.Seconds()},
		{"griot_vacuum_last_seconds", "gauge", "duration of the last vacuum", vd.Seconds()},
	} {
		fmt.Fprintf(w, "# HELP %s %s\n# TYPE %s %s\n%s %v\n", l.name, l.help, l.name, l.kind, l.name, l.v)
	}
}
