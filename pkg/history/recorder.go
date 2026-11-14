package history

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"math/rand/v2"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/dynamic"
)

// Skipped resources are noise, not memory: heartbeats, events and endpoints
// change constantly and are derived from other objects.
var Skipped = map[schema.GroupResource]bool{
	{Group: "", Resource: "events"}:                                       true,
	{Group: "events.k8s.io", Resource: "events"}:                          true,
	{Group: "coordination.k8s.io", Resource: "leases"}:                    true,
	{Group: "", Resource: "endpoints"}:                                    true,
	{Group: "discovery.k8s.io", Resource: "endpointslices"}:               true,
	{Group: "metrics.k8s.io", Resource: "pods"}:                           true,
	{Group: "metrics.k8s.io", Resource: "nodes"}:                          true,
	{Group: "", Resource: "componentstatuses"}:                            true,
	{Group: "history.sankofa.kuberoot.dev", Resource: "timelines"}:        true,
	{Group: "history.sankofa.kuberoot.dev", Resource: "clustertimelines"}: true,
}

// Scope limits what the recorder remembers. Empty means everything.
type Scope struct {
	Namespaces        map[string]bool // only these namespaces (cluster-scoped objects are still kept)
	ExcludeNamespaces map[string]bool
	ExcludeResources  map[schema.GroupResource]bool
}

func (s Scope) keeps(gr schema.GroupResource, ns string) bool {
	if s.ExcludeResources[gr] {
		return false
	}
	if ns == "" {
		return true
	}
	if s.ExcludeNamespaces[ns] {
		return false
	}
	return len(s.Namespaces) == 0 || s.Namespaces[ns]
}

// ParseScope reads comma-separated lists; resources are "resource.group" or
// "resource" for the core group.
func ParseScope(namespaces, exclude, excludeResources string) Scope {
	set := func(s string) map[string]bool {
		m := map[string]bool{}
		for _, v := range strings.Split(s, ",") {
			if v = strings.TrimSpace(v); v != "" {
				m[v] = true
			}
		}
		return m
	}
	sc := Scope{Namespaces: set(namespaces), ExcludeNamespaces: set(exclude), ExcludeResources: map[schema.GroupResource]bool{}}
	for r := range set(excludeResources) {
		sc.ExcludeResources[schema.ParseGroupResource(r)] = true
	}
	return sc
}

// Counters are the recorder's numbers since start.
type Counters struct {
	Events   atomic.Int64 // informer events seen
	Skipped  atomic.Int64 // events that changed nothing remembered
	Written  atomic.Int64 // records committed
	Batches  atomic.Int64 // transactions committed
	Errors   atomic.Int64 // failed writes
	Swept    atomic.Int64 // deaths found after a restart
	Queue    atomic.Int64 // records waiting to be written
	LagMilli atomic.Int64 // event-to-commit delay of the last batch
}

type pending struct {
	entry Entry
	seen  time.Time
}

// head is the latest record of one incarnation, as small as it can be: the
// recorder keeps one per object in the cluster, and nothing else.
type head struct {
	hash [32]byte
	verb uint8
	ref  Ref
}

var verbs = []string{"", Born, Changed, Died}

func verbCode(v string) uint8 {
	for i, s := range verbs {
		if s == v {
			return uint8(i)
		}
	}
	return 0
}

func parseHash(s string) (h [32]byte) {
	_, _ = hex.Decode(h[:], []byte(s))
	return h
}

// Recorder watches every resource and writes their lives into the store.
//
// It lists and watches each resource itself instead of using informers: an
// informer keeps every object in memory, while the recorder only needs the
// latest content hash of each object to tell a change from a resync. Memory
// then follows the number of objects at a few hundred bytes each, not their
// size.
type Recorder struct {
	Store     Store
	Discovery discovery.DiscoveryInterface
	Dynamic   dynamic.Interface
	Log       *slog.Logger
	Scope     Scope
	// BatchSize and FlushEvery bound one write transaction.
	BatchSize  int
	FlushEvery time.Duration
	// PageSize is the list page size.
	PageSize int64
	Counters Counters

	mu      sync.Mutex
	started map[schema.GroupVersionResource]bool
	heads   map[string]head // uid -> latest record, the dedup cache
	strs    map[string]string
	queue   chan pending
}

// Run records until ctx is done, rediscovering resources (new CRDs) every
// interval.
func (r *Recorder) Run(ctx context.Context, interval time.Duration) error {
	if r.BatchSize <= 0 {
		r.BatchSize = 500
	}
	if r.FlushEvery <= 0 {
		r.FlushEvery = 200 * time.Millisecond
	}
	if r.PageSize <= 0 {
		r.PageSize = 500
	}
	r.started = map[schema.GroupVersionResource]bool{}
	r.heads = map[string]head{}
	r.strs = map[string]string{}
	r.queue = make(chan pending, 4*r.BatchSize)
	if err := r.warm(ctx); err != nil {
		return err
	}
	done := make(chan struct{})
	go func() { r.write(ctx); close(done) }()
	var wg sync.WaitGroup
	for {
		if err := r.discover(ctx, &wg); err != nil {
			r.Log.Warn("discovery", "err", err)
		}
		select {
		case <-ctx.Done():
			wg.Wait()
			<-done
			return nil
		case <-time.After(interval):
		}
	}
}

// intern shares the strings repeated across objects: groups, resources and
// namespaces. Callers hold r.mu.
func (r *Recorder) intern(s string) string {
	if v, ok := r.strs[s]; ok {
		return v
	}
	r.strs[s] = s
	return s
}

func (r *Recorder) internRef(ref Ref) Ref {
	return Ref{Group: r.intern(ref.Group), Resource: r.intern(ref.Resource), Namespace: r.intern(ref.Namespace), Name: ref.Name}
}

// warm loads the latest record of every uid, so a restart does not rewrite
// unchanged objects and a new leader starts with the old leader's memory.
func (r *Recorder) warm(ctx context.Context) error {
	heads, err := r.Store.Heads(ctx)
	if err != nil {
		return err
	}
	r.mu.Lock()
	for _, h := range heads {
		r.heads[h.UID] = head{hash: parseHash(h.Hash), verb: verbCode(h.Verb), ref: r.internRef(h.Ref)}
	}
	r.mu.Unlock()
	r.Log.Info("memory warmed", "objects", len(heads))
	return nil
}

// write commits queued records in batches, one transaction per batch.
func (r *Recorder) write(ctx context.Context) {
	batch := make([]pending, 0, r.BatchSize)
	tick := time.NewTicker(r.FlushEvery)
	defer tick.Stop()
	flush := func() {
		if len(batch) == 0 {
			return
		}
		entries := make([]Entry, len(batch))
		for i, p := range batch {
			entries[i] = p.entry
		}
		// A fresh context, so a shutdown does not lose the tail.
		wctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
		err := r.Store.AddBatch(wctx, entries)
		cancel()
		if err != nil {
			r.Counters.Errors.Add(1)
			r.Log.Warn("store", "err", err, "records", len(entries))
		} else {
			r.Counters.Written.Add(int64(len(entries)))
			r.Counters.Batches.Add(1)
			r.Counters.LagMilli.Store(time.Since(batch[0].seen).Milliseconds())
		}
		r.Counters.Queue.Add(-int64(len(batch)))
		batch = batch[:0]
	}
	for {
		select {
		case p := <-r.queue:
			batch = append(batch, p)
			if len(batch) >= r.BatchSize {
				flush()
			}
		case <-tick.C:
			flush()
		case <-ctx.Done():
			for {
				select {
				case p := <-r.queue:
					batch = append(batch, p)
				default:
					flush()
					return
				}
			}
		}
	}
}

func (r *Recorder) discover(ctx context.Context, wg *sync.WaitGroup) error {
	lists, err := r.Discovery.ServerPreferredResources()
	if err != nil && len(lists) == 0 {
		return err
	}
	for _, l := range lists {
		gv, perr := schema.ParseGroupVersion(l.GroupVersion)
		if perr != nil {
			continue
		}
		for _, res := range l.APIResources {
			gvr := gv.WithResource(res.Name)
			gr := gvr.GroupResource()
			if Skipped[gr] || r.Scope.ExcludeResources[gr] || !hasVerbs(res, "list", "watch") || strings.Contains(res.Name, "/") {
				continue
			}
			r.mu.Lock()
			seen := r.started[gvr]
			r.started[gvr] = true
			r.mu.Unlock()
			if seen {
				continue
			}
			wg.Add(1)
			go func() {
				defer wg.Done()
				r.follow(ctx, gvr)
			}()
			r.Log.Debug("watching", "resource", gvr.String())
		}
	}
	return nil
}

// follow lists a resource page by page, then watches it from the list's
// resource version; when the watch history is gone it lists again. Objects
// missing from a list died while nobody was watching.
func (r *Recorder) follow(ctx context.Context, gvr schema.GroupVersionResource) {
	ri := r.Dynamic.Resource(gvr)
	gr := gvr.GroupResource()
	backoff := time.Second
	wait := func() {
		select {
		case <-ctx.Done():
		case <-time.After(backoff):
		}
		backoff = min(2*backoff, time.Minute)
	}
	for ctx.Err() == nil {
		rv, err := r.list(ctx, ri, gr)
		if err != nil {
			if ctx.Err() == nil {
				r.Log.Warn("list", "resource", gvr.String(), "err", err)
			}
			wait()
			continue
		}
		backoff = time.Second
		for ctx.Err() == nil {
			next, relist, err := r.watch(ctx, ri, gr, rv)
			if relist {
				break
			}
			if err != nil {
				if ctx.Err() == nil {
					r.Log.Warn("watch", "resource", gvr.String(), "err", err)
				}
				wait()
				continue
			}
			rv, backoff = next, time.Second
		}
	}
}

func (r *Recorder) list(ctx context.Context, ri dynamic.NamespaceableResourceInterface, gr schema.GroupResource) (string, error) {
	present := map[string]struct{}{}
	opts := metav1.ListOptions{Limit: r.PageSize}
	var rv string
	for {
		page, err := ri.List(ctx, opts)
		if err != nil {
			return "", err
		}
		if rv == "" {
			rv = page.GetResourceVersion()
		}
		for i := range page.Items {
			u := &page.Items[i]
			present[string(u.GetUID())] = struct{}{}
			r.observe(ctx, gr, u, false)
		}
		if opts.Continue = page.GetContinue(); opts.Continue == "" {
			break
		}
	}
	r.sweep(ctx, gr, present)
	return rv, nil
}

// watch follows changes from rv. It returns the last resource version seen,
// or relist when the server no longer has that history.
func (r *Recorder) watch(ctx context.Context, ri dynamic.NamespaceableResourceInterface, gr schema.GroupResource, rv string) (string, bool, error) {
	timeout := int64(300 + rand.IntN(300))
	w, err := ri.Watch(ctx, metav1.ListOptions{ResourceVersion: rv, AllowWatchBookmarks: true, TimeoutSeconds: &timeout})
	if err != nil {
		if apierrors.IsResourceExpired(err) || apierrors.IsGone(err) {
			return rv, true, nil
		}
		return rv, false, err
	}
	defer w.Stop()
	for {
		select {
		case <-ctx.Done():
			return rv, false, nil
		case ev, ok := <-w.ResultChan():
			if !ok {
				return rv, false, nil
			}
			switch ev.Type {
			case watch.Error:
				err := apierrors.FromObject(ev.Object)
				if apierrors.IsResourceExpired(err) || apierrors.IsGone(err) {
					return rv, true, nil
				}
				return rv, false, err
			case watch.Bookmark:
				if u, ok := ev.Object.(*unstructured.Unstructured); ok {
					rv = u.GetResourceVersion()
				}
			case watch.Added, watch.Modified, watch.Deleted:
				u, ok := ev.Object.(*unstructured.Unstructured)
				if !ok {
					continue
				}
				rv = u.GetResourceVersion()
				r.observe(ctx, gr, u, ev.Type == watch.Deleted)
			}
		}
	}
}

// sweep records deaths that happened while nobody was watching: objects alive
// in the memory but absent from a full list.
func (r *Recorder) sweep(ctx context.Context, gr schema.GroupResource, present map[string]struct{}) {
	r.mu.Lock()
	var gone []string
	for uid, h := range r.heads {
		if h.verb != verbCode(Died) && h.ref.Group == gr.Group && h.ref.Resource == gr.Resource && r.Scope.keeps(gr, h.ref.Namespace) {
			if _, ok := present[uid]; !ok {
				gone = append(gone, uid)
			}
		}
	}
	r.mu.Unlock()
	for _, uid := range gone {
		last, ok, err := r.Store.Latest(ctx, uid)
		if err != nil || !ok {
			continue
		}
		last.Verb, last.At, last.Manager = Died, time.Now().UTC(), ""
		r.Counters.Swept.Add(1)
		r.enqueue(ctx, last, hashOf(last.Object), time.Now())
	}
	if len(gone) > 0 {
		r.Log.Info("deaths found while nobody was recording", "resource", gr.String(), "objects", len(gone))
	}
}

func hasVerbs(r metav1.APIResource, verbs ...string) bool {
	for _, v := range verbs {
		found := false
		for _, rv := range r.Verbs {
			if rv == v {
				found = true
			}
		}
		if !found {
			return false
		}
	}
	return true
}

func (r *Recorder) observe(ctx context.Context, gr schema.GroupResource, u *unstructured.Unstructured, deleted bool) {
	seen := time.Now()
	r.Counters.Events.Add(1)
	if !r.Scope.keeps(gr, u.GetNamespace()) {
		return
	}
	rec, hash, err := Normalize(gr, u)
	if err != nil {
		r.Log.Warn("normalize", "err", err)
		return
	}
	r.mu.Lock()
	h, known := r.heads[rec.UID]
	r.mu.Unlock()
	switch {
	case deleted:
		// The last writer is not the one who deleted it; the watch does not
		// say who did.
		rec.Verb = Died
		rec.At = time.Now().UTC()
		rec.Manager = ""
	case !known || h.verb == verbCode(Died):
		rec.Verb = Born
	case h.hash == parseHash(hash):
		r.Counters.Skipped.Add(1)
		return
	default:
		rec.Verb = Changed
	}
	r.enqueue(ctx, rec, hash, seen)
}

func (r *Recorder) enqueue(ctx context.Context, rec Record, hash string, seen time.Time) {
	r.mu.Lock()
	r.heads[rec.UID] = head{hash: parseHash(hash), verb: verbCode(rec.Verb), ref: r.internRef(rec.Ref)}
	r.mu.Unlock()
	r.Counters.Queue.Add(1)
	select {
	case r.queue <- pending{entry: Entry{Record: rec, Hash: hash}, seen: seen}:
	case <-ctx.Done():
		r.Counters.Queue.Add(-1)
	}
}

func isSecret(gr schema.GroupResource) bool { return gr.Group == "" && gr.Resource == "secrets" }

func redact(obj map[string]any) {
	// kubectl apply keeps the whole applied Secret, values included, in this
	// annotation.
	unstructured.RemoveNestedField(obj, "metadata", "annotations", "kubectl.kubernetes.io/last-applied-configuration")
	if a, ok, _ := unstructured.NestedMap(obj, "metadata", "annotations"); ok && len(a) == 0 {
		unstructured.RemoveNestedField(obj, "metadata", "annotations")
	}
	for _, f := range []string{"data", "stringData"} {
		if m, ok, _ := unstructured.NestedMap(obj, f); ok {
			for k := range m {
				m[k] = "<redacted>"
			}
			_ = unstructured.SetNestedMap(obj, m, f)
		}
	}
}

// Normalize strips what is not memory (status, managed fields, revisions),
// redacts secret values and computes a content hash.
func Normalize(gr schema.GroupResource, u *unstructured.Unstructured) (Record, string, error) {
	o := u.DeepCopy()
	manager, at := lastWrite(o)
	if at.IsZero() {
		at = o.GetCreationTimestamp().Time
	}
	if at.IsZero() {
		at = time.Now()
	}
	rev := o.GetResourceVersion()
	unstructured.RemoveNestedField(o.Object, "status")
	unstructured.RemoveNestedField(o.Object, "metadata", "managedFields")
	unstructured.RemoveNestedField(o.Object, "metadata", "resourceVersion")
	if isSecret(gr) {
		redact(o.Object)
	}
	data, err := json.Marshal(o.Object)
	if err != nil {
		return Record{}, "", err
	}
	return Record{
		Ref:      Ref{Group: gr.Group, Resource: gr.Resource, Namespace: o.GetNamespace(), Name: o.GetName()},
		UID:      string(o.GetUID()),
		Kind:     o.GetKind(),
		At:       at.UTC(),
		Manager:  manager,
		Revision: rev,
		Object:   data,
	}, hashOf(data), nil
}

func hashOf(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func lastWrite(u *unstructured.Unstructured) (string, time.Time) {
	var who string
	var when time.Time
	for _, mf := range u.GetManagedFields() {
		if mf.Time != nil && !mf.Time.Time.Before(when) {
			who, when = mf.Manager, mf.Time.Time
		}
	}
	return who, when
}
