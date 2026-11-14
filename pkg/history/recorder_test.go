package history

import (
	"context"
	"io"
	"log/slog"
	"path/filepath"
	"testing"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	dynamicfake "k8s.io/client-go/dynamic/fake"
)

var cmGVR = schema.GroupVersionResource{Version: "v1", Resource: "configmaps"}

func eventually(t *testing.T, what string, f func() bool) {
	t.Helper()
	for end := time.Now().Add(10 * time.Second); time.Now().Before(end); time.Sleep(20 * time.Millisecond) {
		if f() {
			return
		}
	}
	t.Fatalf("%s did not happen", what)
}

// The recorder lists, then watches: births, changes, deletions while it
// watches and deletions while it was away all land in the store, and an
// unchanged object is not written twice.
func TestRecorderFollowsAResource(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s, err := OpenSQLite(filepath.Join(t.TempDir(), "h.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	// Remembered alive, but gone from the cluster: died while nobody watched.
	ghost := entry(t, cms, cm("a", "ghost", "g1", "x"), Born, t0)
	if err := s.AddBatch(ctx, []Entry{ghost}); err != nil {
		t.Fatal(err)
	}
	existing := cm("a", "kept", "k1", "1")
	dc := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), map[schema.GroupVersionResource]string{cmGVR: "ConfigMapList"}, existing)
	r := &Recorder{Store: s, Dynamic: dc, Log: slog.New(slog.NewTextHandler(io.Discard, nil)), FlushEvery: 10 * time.Millisecond}
	r.BatchSize, r.PageSize = 10, 2
	r.heads, r.strs, r.started = map[string]head{}, map[string]string{}, map[schema.GroupVersionResource]bool{}
	r.queue = make(chan pending, 100)
	if err := r.warm(ctx); err != nil {
		t.Fatal(err)
	}
	go r.write(ctx)
	go r.follow(ctx, cmGVR)

	life := func(name string) []Record {
		l, _ := s.Life(ctx, Ref{Resource: "configmaps", Namespace: "a", Name: name})
		return l
	}
	eventually(t, "ghost obituary", func() bool { l := life("ghost"); return len(l) == 2 && l[1].Verb == Died })
	eventually(t, "kept born", func() bool { return len(life("kept")) == 1 })
	// Wait until the watch is open, then change things.
	eventually(t, "watch open", func() bool { return len(dc.Actions()) >= 2 })
	cms := dc.Resource(cmGVR).Namespace("a")
	if _, err := cms.Create(ctx, cm("a", "new", "n1", "1"), metav1.CreateOptions{}); err != nil {
		t.Fatal(err)
	}
	changed := cm("a", "kept", "k1", "2")
	if _, err := cms.Update(ctx, changed, metav1.UpdateOptions{}); err != nil {
		t.Fatal(err)
	}
	// The same content again: a resync, not a change.
	if _, err := cms.Update(ctx, changed.DeepCopy(), metav1.UpdateOptions{}); err != nil {
		t.Fatal(err)
	}
	if err := cms.Delete(ctx, "new", metav1.DeleteOptions{}); err != nil {
		t.Fatal(err)
	}
	eventually(t, "new born and died", func() bool { l := life("new"); return len(l) == 2 && l[1].Verb == Died })
	eventually(t, "kept changed", func() bool { l := life("kept"); return len(l) == 2 && l[1].Verb == Changed })
	time.Sleep(100 * time.Millisecond)
	if l := life("kept"); len(l) != 2 {
		t.Fatalf("unchanged update written: %d records", len(l))
	}
	if r.Counters.Swept.Load() != 1 {
		t.Fatalf("swept %d", r.Counters.Swept.Load())
	}
}
