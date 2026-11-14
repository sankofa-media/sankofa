// Command griot-bench generates churn in a Kubernetes API and measures a
// Griot recording it: write throughput, lag, query latency and retention.
// It runs inside the stand next to a throwaway control plane (vapi.yaml).
//
//	griot-bench create  --namespaces 20 --configmaps 4500 --deployments 250
//	griot-bench update  --rate 400 --duration 10m
//	griot-bench probe   --griot https://griot-pg:443 --duration 10m
//	griot-bench query   --griot https://griot-pg:443
//	griot-bench metrics --urls http://griot-pg-0:9090/metrics --duration 10m
//	griot-bench retain  --store postgres --dsn ... --tiers 10m:1m,30m:10m
//	griot-bench delete  --namespaces 2 / cleanup
package main

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"

	"github.com/tym83/sankofa/pkg/history"
)

var (
	kubeconfig  = flag.String("kubeconfig", os.Getenv("KUBECONFIG"), "kubeconfig of the API under churn")
	namespaces  = flag.Int("namespaces", 20, "bench namespaces")
	configmaps  = flag.Int("configmaps", 4500, "config maps per namespace")
	deployments = flag.Int("deployments", 250, "deployments per namespace")
	workers     = flag.Int("workers", 48, "concurrent writers")
	rate        = flag.Float64("rate", 400, "updates per second")
	duration    = flag.Duration("duration", 5*time.Minute, "how long to run")
	deployEvery = flag.Int("deploy-every", 50, "update: every Nth update rolls a deployment")
	griotURL    = flag.String("griot", "https://griot-pg.griot-bench.svc:443", "Griot API base URL (direct, as the front proxy)")
	certFile    = flag.String("proxy-cert", "/pki/front-proxy-client.crt", "front proxy client certificate")
	keyFile     = flag.String("proxy-key", "/pki/front-proxy-client.key", "front proxy client key")
	iterations  = flag.Int("n", 50, "query: iterations per query")
	urls        = flag.String("urls", "", "metrics: comma-separated /metrics URLs")
	every       = flag.Duration("every", 5*time.Second, "metrics: sampling interval")
	storeKind   = flag.String("store", "postgres", "retain: sqlite or postgres")
	dsn         = flag.String("dsn", os.Getenv("GRIOT_DSN"), "retain: SQLite path or PostgreSQL DSN")
	tiers       = flag.String("tiers", "", "retain: compaction tiers")
	maxVersions = flag.Int("max-versions", 0, "retain: versions per object")
	shift       = flag.Duration("shift", 0, "retain: pretend now is this much later")
	vacuum      = flag.Bool("vacuum", false, "retain: vacuum after retention (SQLite VACUUM, PostgreSQL plain VACUUM ANALYZE)")
	probeName   = flag.String("probe-name", "probe", "probe: config map to write (one per concurrent probe)")
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: griot-bench create|update|probe|query|metrics|retain|delete|cleanup [flags]")
		os.Exit(2)
	}
	mode := os.Args[1]
	_ = flag.CommandLine.Parse(os.Args[2:])
	ctx := context.Background()
	var err error
	switch mode {
	case "create":
		err = create(ctx, kube())
	case "update":
		err = update(ctx, kube())
	case "probe":
		err = probe(ctx, kube())
	case "query":
		err = query(ctx)
	case "metrics":
		err = sample(ctx)
	case "retain":
		err = retain(ctx)
	case "nsat":
		err = nsat(ctx)
	case "delete":
		err = deleteNS(ctx, kube(), *namespaces, false)
	case "cleanup":
		err = deleteNS(ctx, kube(), 1000, true)
	default:
		err = fmt.Errorf("unknown mode %q", mode)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "griot-bench:", err)
		os.Exit(1)
	}
}

func kube() kubernetes.Interface {
	cfg, err := clientcmd.BuildConfigFromFlags("", *kubeconfig)
	if err != nil {
		panic(err)
	}
	cfg.QPS, cfg.Burst = 5000, 10000
	return kubernetes.NewForConfigOrDie(cfg)
}

func nsName(i int) string { return fmt.Sprintf("bench-%02d", i) }

// payload makes a config map look like configuration: a few hundred bytes.
func payload(i int) map[string]string {
	return map[string]string{
		"v":          "0",
		"t":          strconv.FormatInt(time.Now().UnixMilli(), 10),
		"app.yaml":   fmt.Sprintf("server:\n  port: %d\n  workers: %d\nlog:\n  level: info\n  format: json\nfeatures:\n  checkout: true\n  search: %t\n", 8000+i%1000, 1+i%16, i%2 == 0),
		"endpoints":  fmt.Sprintf("https://svc-%d.internal:8443,https://svc-%d.internal:8443", i%97, (i+1)%97),
		"owner-team": []string{"payments", "search", "checkout", "platform"}[i%4],
	}
}

func pool(n int, work func(i int) error) (int64, int64) {
	var ok, failed atomic.Int64
	jobs := make(chan int)
	var wg sync.WaitGroup
	for w := 0; w < *workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range jobs {
				if err := work(i); err != nil && !apierrors.IsAlreadyExists(err) {
					if failed.Add(1) < 5 {
						fmt.Fprintln(os.Stderr, "error:", err)
					}
				} else {
					ok.Add(1)
				}
			}
		}()
	}
	for i := 0; i < n; i++ {
		jobs <- i
	}
	close(jobs)
	wg.Wait()
	return ok.Load(), failed.Load()
}

func create(ctx context.Context, kc kubernetes.Interface) error {
	start := time.Now()
	for n := 0; n < *namespaces; n++ {
		ns := nsName(n)
		_, err := kc.CoreV1().Namespaces().Create(ctx, &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: ns, Labels: map[string]string{"bench": "griot"}}}, metav1.CreateOptions{})
		if err != nil && !apierrors.IsAlreadyExists(err) {
			return err
		}
		t := time.Now()
		ok, failed := pool(*configmaps, func(i int) error {
			_, err := kc.CoreV1().ConfigMaps(ns).Create(ctx, &corev1.ConfigMap{ObjectMeta: metav1.ObjectMeta{Name: fmt.Sprintf("cm-%05d", i), Labels: map[string]string{"bench": "griot"}}, Data: payload(i)}, metav1.CreateOptions{})
			return err
		})
		dok, dfailed := pool(*deployments, func(i int) error {
			_, err := kc.AppsV1().Deployments(ns).Create(ctx, deployment(fmt.Sprintf("web-%04d", i)), metav1.CreateOptions{})
			return err
		})
		fmt.Printf("create %s configmaps=%d deployments=%d failed=%d took=%s rate=%.0f/s\n", ns, ok, dok, failed+dfailed, time.Since(t).Round(time.Millisecond), float64(ok+dok)/time.Since(t).Seconds())
	}
	fmt.Printf("create done in %s\n", time.Since(start).Round(time.Second))
	return nil
}

func deployment(name string) *appsv1.Deployment {
	one := int32(1)
	two := int32(2)
	labels := map[string]string{"app": name}
	return &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: name, Labels: map[string]string{"bench": "griot"}},
		Spec: appsv1.DeploymentSpec{
			Replicas: &one, RevisionHistoryLimit: &two,
			Selector: &metav1.LabelSelector{MatchLabels: labels},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: labels, Annotations: map[string]string{"rev": "0"}},
				Spec: corev1.PodSpec{Containers: []corev1.Container{{
					Name: "app", Image: "registry.k8s.io/pause:3.10",
					Env: []corev1.EnvVar{{Name: "MODE", Value: "bench"}},
				}}},
			},
		},
	}
}

func update(ctx context.Context, kc kubernetes.Interface) error {
	interval := time.Duration(float64(time.Second) / *rate)
	tick := time.NewTicker(interval)
	defer tick.Stop()
	end := time.Now().Add(*duration)
	var done, failed, rolls atomic.Int64
	sem := make(chan struct{}, *workers)
	var n int64
	last := time.Now()
	var lastDone int64
	for time.Now().Before(end) {
		<-tick.C
		n++
		seq := n
		sem <- struct{}{}
		go func() {
			defer func() { <-sem }()
			ns := nsName(rand.IntN(*namespaces))
			var err error
			if *deployEvery > 0 && seq%int64(*deployEvery) == 0 {
				p := fmt.Sprintf(`{"spec":{"template":{"metadata":{"annotations":{"rev":"%d"}}}}}`, seq)
				_, err = kc.AppsV1().Deployments(ns).Patch(ctx, fmt.Sprintf("web-%04d", rand.IntN(*deployments)), types.MergePatchType, []byte(p), metav1.PatchOptions{})
				rolls.Add(1)
			} else {
				p := fmt.Sprintf(`{"data":{"v":"%d","t":"%d"}}`, seq, time.Now().UnixMilli())
				_, err = kc.CoreV1().ConfigMaps(ns).Patch(ctx, fmt.Sprintf("cm-%05d", rand.IntN(*configmaps)), types.MergePatchType, []byte(p), metav1.PatchOptions{})
			}
			if err != nil {
				if failed.Add(1) < 5 {
					fmt.Fprintln(os.Stderr, "error:", err)
				}
				return
			}
			done.Add(1)
		}()
		if time.Since(last) >= 10*time.Second {
			d := done.Load()
			fmt.Printf("update %s done=%d rate=%.0f/s rolls=%d failed=%d\n", time.Now().UTC().Format(time.TimeOnly), d, float64(d-lastDone)/time.Since(last).Seconds(), rolls.Load(), failed.Load())
			last, lastDone = time.Now(), d
		}
	}
	for i := 0; i < cap(sem); i++ {
		sem <- struct{}{}
	}
	fmt.Printf("update done=%d failed=%d rolls=%d in %s\n", done.Load(), failed.Load(), rolls.Load(), *duration)
	return nil
}

// griot talks to a Griot replica directly, the way the aggregator does: with
// the front proxy client certificate and the user in headers.
type griot struct {
	base string
	hc   *http.Client
}

func newGriot() (*griot, error) {
	cert, err := tls.LoadX509KeyPair(*certFile, *keyFile)
	if err != nil {
		return nil, err
	}
	return &griot{base: strings.TrimRight(*griotURL, "/"), hc: &http.Client{Timeout: 120 * time.Second, Transport: &http.Transport{
		MaxIdleConnsPerHost: 16,
		// The benchmark trusts the replica it was pointed at; the aggregator
		// verifies against the APIService CA bundle.
		TLSClientConfig: &tls.Config{Certificates: []tls.Certificate{cert}, InsecureSkipVerify: true}, //nolint:gosec
	}}}, nil
}

func (g *griot) get(ctx context.Context, path string, q map[string]string) ([]byte, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", g.base+"/apis/"+history.Group+"/"+history.Version+path, nil)
	qs := req.URL.Query()
	for k, v := range q {
		qs.Set(k, v)
	}
	req.URL.RawQuery = qs.Encode()
	req.Header.Set("X-Remote-User", "bench-admin")
	req.Header.Add("X-Remote-Group", "system:masters")
	resp, err := g.hc.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("%s: %d %s", path, resp.StatusCode, strings.TrimSpace(string(b)))
	}
	return b, err
}

// probe writes a timestamp into one config map every second and measures how
// long until Griot serves that state.
func probe(ctx context.Context, kc kubernetes.Interface) error {
	g, err := newGriot()
	if err != nil {
		return err
	}
	ns := "bench-probe"
	_, _ = kc.CoreV1().Namespaces().Create(ctx, &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: ns, Labels: map[string]string{"bench": "griot"}}}, metav1.CreateOptions{})
	_, _ = kc.CoreV1().ConfigMaps(ns).Create(ctx, &corev1.ConfigMap{ObjectMeta: metav1.ObjectMeta{Name: *probeName}, Data: map[string]string{"t": "0"}}, metav1.CreateOptions{})
	end := time.Now().Add(*duration)
	var lags []time.Duration
	misses := 0
	for time.Now().Before(end) {
		stamp := strconv.FormatInt(time.Now().UnixNano(), 10)
		written := time.Now()
		if _, err := kc.CoreV1().ConfigMaps(ns).Patch(ctx, *probeName, types.MergePatchType, []byte(`{"data":{"t":"`+stamp+`"}}`), metav1.PatchOptions{}); err != nil {
			return err
		}
		found := false
		for time.Since(written) < 60*time.Second {
			b, err := g.get(ctx, "/namespaces/"+ns+"/timelines/configmaps.core:"+*probeName, nil)
			if err == nil && strings.Contains(string(b), stamp) {
				found = true
				break
			}
			time.Sleep(25 * time.Millisecond)
		}
		if !found {
			misses++
			continue
		}
		lag := time.Since(written)
		lags = append(lags, lag)
		if len(lags)%30 == 0 {
			fmt.Printf("probe %s n=%d %s\n", time.Now().UTC().Format(time.TimeOnly), len(lags), summary(lags[len(lags)-30:]))
		}
		time.Sleep(time.Second - min(lag, time.Second))
	}
	fmt.Printf("probe lag n=%d misses=%d %s\n", len(lags), misses, summary(lags))
	return nil
}

func summary(d []time.Duration) string {
	if len(d) == 0 {
		return "no samples"
	}
	s := append([]time.Duration(nil), d...)
	sort.Slice(s, func(i, j int) bool { return s[i] < s[j] })
	p := func(q float64) time.Duration { return s[min(len(s)-1, int(q*float64(len(s))))].Round(time.Millisecond) }
	return fmt.Sprintf("p50=%s p95=%s p99=%s max=%s", p(0.5), p(0.95), p(0.99), s[len(s)-1].Round(time.Millisecond))
}

func timeit(name string, n int, f func(i int) (int, error)) {
	var d []time.Duration
	items := 0
	for i := 0; i < n; i++ {
		t := time.Now()
		k, err := f(i)
		if err != nil {
			fmt.Printf("query %-28s error: %v\n", name, err)
			return
		}
		d = append(d, time.Since(t))
		items = k
	}
	fmt.Printf("query %-28s n=%d items=%d %s\n", name, n, items, summary(d))
}

func query(ctx context.Context) error {
	g, err := newGriot()
	if err != nil {
		return err
	}
	// Moments: the start of the history, the middle and now.
	b, err := g.get(ctx, "/namespaces/bench-00/timelines/configmaps.core:cm-00000", nil)
	if err != nil {
		return err
	}
	var tl history.Timeline
	if err := json.Unmarshal(b, &tl); err != nil {
		return err
	}
	born := tl.Moments[0].At
	now := time.Now().UTC()
	mid := born.Add(now.Sub(born) / 2)
	ts := func(t time.Time) string { return t.Format(time.RFC3339Nano) }
	fmt.Printf("query window %s .. %s\n", ts(born), ts(now))
	life := func(path func(int) string) func(int) (int, error) {
		return func(i int) (int, error) {
			b, err := g.get(ctx, path(i), nil)
			if err != nil {
				return 0, err
			}
			var tl history.Timeline
			err = json.Unmarshal(b, &tl)
			return len(tl.Moments), err
		}
	}
	cmPath := func(i int) string {
		return fmt.Sprintf("/namespaces/%s/timelines/configmaps.core:cm-%05d", nsName(rand.IntN(*namespaces)), rand.IntN(*configmaps))
	}
	timeit("life configmap", *iterations, life(cmPath))
	timeit("life deployment", *iterations, life(func(int) string {
		return fmt.Sprintf("/namespaces/%s/timelines/deployments.apps:web-%04d", nsName(rand.IntN(*namespaces)), rand.IntN(*deployments))
	}))
	timeit("life probe (long history)", *iterations, life(func(int) string { return "/namespaces/bench-probe/timelines/configmaps.core:" + *probeName }))
	timeit("at configmap (mid)", *iterations, func(i int) (int, error) {
		_, err := g.get(ctx, cmPath(i), map[string]string{"at": ts(mid)})
		return 1, err
	})
	list := func(ns string, at time.Time) ([]history.Record, error) {
		b, err := g.get(ctx, "/namespaces/"+ns+"/timelines", map[string]string{"at": ts(at)})
		if err != nil {
			return nil, err
		}
		var l history.TimelineList
		if err := json.Unmarshal(b, &l); err != nil {
			return nil, err
		}
		out := make([]history.Record, 0, len(l.Items))
		for _, it := range l.Items {
			m := it.Moments[len(it.Moments)-1]
			out = append(out, history.Record{Ref: it.Target, Kind: it.Kind, UID: m.UID, Object: it.Object})
		}
		return out, nil
	}
	n := max(3, *iterations/10)
	timeit("namespace at (mid)", n, func(i int) (int, error) {
		r, err := list(nsName(i%*namespaces), mid)
		return len(r), err
	})
	timeit("namespace at (now)", n, func(i int) (int, error) {
		r, err := list(nsName(i%*namespaces), now)
		return len(r), err
	})
	timeit("namespace diff (mid..now)", n, func(i int) (int, error) {
		a, err := list(nsName(i%*namespaces), mid)
		if err != nil {
			return 0, err
		}
		b, err := list(nsName(i%*namespaces), now)
		if err != nil {
			return 0, err
		}
		return len(history.DiffSets(a, b)), nil
	})
	timeit("namespace plan (now)", n, func(i int) (int, error) {
		r, err := list(nsName(i%*namespaces), now)
		if err != nil {
			return 0, err
		}
		p, err := history.PlanRestore(r, false)
		return len(p.Objects), err
	})
	timeit("obituaries (all, 100)", *iterations, func(int) (int, error) {
		b, err := g.get(ctx, "/timelines", nil)
		return len(b), err
	})
	return nil
}

// sample scrapes Griot /metrics and prints rates.
func sample(ctx context.Context) error {
	list := strings.Split(*urls, ",")
	prev := map[string]map[string]float64{}
	end := time.Now().Add(*duration)
	for time.Now().Before(end) {
		for _, u := range list {
			m, err := scrape(ctx, u)
			if err != nil {
				fmt.Printf("metrics %s error %v\n", u, err)
				continue
			}
			p := prev[u]
			if p != nil {
				dt := every.Seconds()
				fmt.Printf("metrics %s %s leader=%v written=%.0f rate=%.0f/s events=%.0f/s queue=%.0f lag=%.3fs errors=%.0f\n",
					time.Now().UTC().Format(time.TimeOnly), u, m["griot_leader"], m["griot_records_written_total"],
					(m["griot_records_written_total"]-p["griot_records_written_total"])/dt,
					(m["griot_events_total"]-p["griot_events_total"])/dt, m["griot_queue_records"], m["griot_last_batch_lag_seconds"], m["griot_write_errors_total"])
			}
			prev[u] = m
		}
		time.Sleep(*every)
	}
	return nil
}

func scrape(ctx context.Context, url string) (map[string]float64, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	out := map[string]float64{}
	sc := bufio.NewScanner(resp.Body)
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) == 2 && !strings.HasPrefix(f[0], "#") {
			v, _ := strconv.ParseFloat(f[1], 64)
			out[f[0]] = v
		}
	}
	return out, sc.Err()
}

func retain(ctx context.Context) error {
	s, err := history.OpenStore(*storeKind, *dsn)
	if err != nil {
		return err
	}
	defer s.Close()
	ts, err := history.ParseTiers(*tiers)
	if err != nil {
		return err
	}
	before, err := s.Stats(ctx)
	if err != nil {
		return err
	}
	fmt.Printf("retain before records=%d objects=%d bytes=%d\n", before.Records, before.Objects, before.Bytes)
	t := time.Now()
	st, err := s.Retain(ctx, history.Policy{Tiers: ts, MaxVersions: *maxVersions}, time.Now().Add(*shift))
	if err != nil {
		return err
	}
	took := time.Since(t)
	if *vacuum {
		vt := time.Now()
		if err := s.Vacuum(ctx); err != nil {
			return err
		}
		fmt.Printf("retain vacuum took=%s\n", time.Since(vt).Round(time.Millisecond))
	}
	after, err := s.Stats(ctx)
	if err != nil {
		return err
	}
	fmt.Printf("retain after records=%d objects=%d bytes=%d compacted=%d trimmed=%d took=%s\n", after.Records, after.Objects, after.Bytes, st.Compacted, st.Trimmed, took.Round(time.Millisecond))
	return nil
}

func deleteNS(ctx context.Context, kc kubernetes.Interface, n int, all bool) error {
	l, err := kc.CoreV1().Namespaces().List(ctx, metav1.ListOptions{LabelSelector: "bench=griot"})
	if err != nil {
		return err
	}
	sort.Slice(l.Items, func(i, j int) bool { return l.Items[i].Name > l.Items[j].Name })
	i := 0
	for _, ns := range l.Items {
		if ns.Name == "bench-probe" && !all {
			continue
		}
		if i++; i > n {
			break
		}
		if err := kc.CoreV1().Namespaces().Delete(ctx, ns.Name, metav1.DeleteOptions{}); err != nil && !apierrors.IsNotFound(err) {
			return err
		}
		fmt.Println("deleted namespace", ns.Name)
	}
	return nil
}

// nsat compares the namespace read before and after validity intervals on
// the same store: the scan of the latest record per uid against the
// interval range, at several moments, and checks they agree.
func nsat(ctx context.Context) error {
	st, err := history.OpenStore(*storeKind, *dsn)
	if err != nil {
		return err
	}
	defer st.Close()
	s := st.(*history.SQLStore)
	var first, last int64
	if err := s.DB().QueryRowContext(ctx, `SELECT MIN(at), MAX(at) FROM records WHERE namespace='bench-00'`).Scan(&first, &last); err != nil {
		return err
	}
	for _, frac := range []float64{0.1, 0.5, 0.9, 1.0} {
		t := time.UnixMilli(first + int64(frac*float64(last-first)))
		if frac == 1.0 {
			t = time.Now()
		}
		var scan, iv []time.Duration
		var n1, n2 int
		for i := 0; i < *iterations; i++ {
			ns := nsName(i % *namespaces)
			a := time.Now()
			r1, err := s.NamespaceAtScan(ctx, ns, t)
			if err != nil {
				return err
			}
			scan = append(scan, time.Since(a))
			b := time.Now()
			r2, err := s.NamespaceAt(ctx, ns, t, nil, 0)
			if err != nil {
				return err
			}
			iv = append(iv, time.Since(b))
			n1, n2 = len(r1), len(r2)
			if n1 != n2 {
				fmt.Printf("nsat MISMATCH %s at %s: scan %d, intervals %d\n", ns, t.UTC().Format(time.RFC3339), n1, n2)
			}
		}
		fmt.Printf("nsat at=%s (%.0f%%) objects=%d scan: %s | intervals: %s\n", t.UTC().Format(time.RFC3339), frac*100, n2, summary(scan), summary(iv))
	}
	return nil
}
