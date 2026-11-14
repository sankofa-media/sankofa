package history

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// backends returns a fresh SQLite store and, when GRIOT_TEST_POSTGRES_DSN is
// set, a fresh PostgreSQL store in its own schema. On the stand:
//
//	kubectl port-forward svc/postgres 15432:5432 &
//	GRIOT_TEST_POSTGRES_DSN='postgres://griot:...@localhost:15432/griot?sslmode=disable' go test ./pkg/history/
func backends(t *testing.T) map[string]*SQLStore {
	t.Helper()
	out := map[string]*SQLStore{}
	s, err := OpenSQLite(filepath.Join(t.TempDir(), "h.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	out["sqlite"] = s
	dsn := os.Getenv("GRIOT_TEST_POSTGRES_DSN")
	if dsn == "" {
		return out
	}
	schemaName := fmt.Sprintf("t%d", time.Now().UnixNano())
	admin, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := admin.Exec(`CREATE SCHEMA ` + schemaName); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = admin.Exec(`DROP SCHEMA ` + schemaName + ` CASCADE`)
		admin.Close()
	})
	sep := "?"
	if strings.Contains(dsn, "?") {
		sep = "&"
	}
	p, err := OpenPostgres(dsn + sep + "search_path=" + schemaName)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { p.Close() })
	out["postgres"] = p
	return out
}

var t0 = time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)

func cm(ns, name, uid, value string) *unstructured.Unstructured {
	return &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "v1", "kind": "ConfigMap",
		"metadata": map[string]any{"name": name, "namespace": ns, "uid": uid, "resourceVersion": "1"},
		"data":     map[string]any{"v": value},
	}}
}

func entry(t *testing.T, gr schema.GroupResource, u *unstructured.Unstructured, verb string, at time.Time) Entry {
	t.Helper()
	rec, hash, err := Normalize(gr, u)
	if err != nil {
		t.Fatal(err)
	}
	rec.Verb, rec.At = verb, at
	return Entry{Record: rec, Hash: hash}
}

var cms = schema.GroupResource{Resource: "configmaps"}

func TestBackends(t *testing.T) {
	for name, s := range backends(t) {
		t.Run(name, func(t *testing.T) {
			ctx := context.Background()
			es := []Entry{
				entry(t, cms, cm("a", "one", "u1", "1"), Born, t0),
				entry(t, cms, cm("a", "one", "u1", "2"), Changed, t0.Add(time.Hour)),
				entry(t, cms, cm("a", "two", "u2", "x"), Born, t0.Add(time.Hour)),
				entry(t, cms, cm("b", "three", "u3", "y"), Born, t0),
				entry(t, cms, cm("a", "two", "u2", "x"), Died, t0.Add(2*time.Hour)),
				entry(t, cms, cm("a", "two", "u4", "reborn"), Born, t0.Add(3*time.Hour)),
			}
			if err := s.AddBatch(ctx, es); err != nil {
				t.Fatal(err)
			}
			one := Ref{Resource: "configmaps", Namespace: "a", Name: "one"}
			two := Ref{Resource: "configmaps", Namespace: "a", Name: "two"}
			life, err := s.Life(ctx, two)
			if err != nil || len(life) != 3 || life[0].Verb != Born || life[1].Verb != Died || life[2].UID != "u4" {
				t.Fatalf("life of two: %d %v", len(life), err)
			}
			if life[0].Recorded.IsZero() {
				t.Fatal("recorded time not kept")
			}
			r, ok, err := s.At(ctx, one, t0.Add(30*time.Minute))
			if err != nil || !ok || !strings.Contains(string(r.Object), `"v":"1"`) {
				t.Fatalf("at: %s %v %v", r.Object, ok, err)
			}
			if _, ok, _ := s.At(ctx, two, t0.Add(150*time.Minute)); ok {
				t.Fatal("two was dead at 2:30 and must not be found")
			}
			if _, ok, _ := s.At(ctx, one, t0.Add(-time.Minute)); ok {
				t.Fatal("one was not born yet")
			}
			for _, tc := range []struct {
				at   time.Duration
				want string
			}{{30 * time.Minute, "one"}, {90 * time.Minute, "one,two"}, {150 * time.Minute, "one"}, {4 * time.Hour, "one,two"}} {
				recs, err := s.NamespaceAt(ctx, "a", t0.Add(tc.at))
				if err != nil {
					t.Fatal(err)
				}
				var names []string
				for _, r := range recs {
					names = append(names, r.Ref.Name)
				}
				if got := strings.Join(names, ","); got != tc.want {
					t.Fatalf("namespace a at +%s: %q, want %q", tc.at, got, tc.want)
				}
			}
			heads, err := s.Heads(ctx)
			if err != nil || len(heads) != 4 {
				t.Fatalf("heads %d %v", len(heads), err)
			}
			last, ok, err := s.Latest(ctx, "u2")
			if err != nil || !ok || last.Verb != Died {
				t.Fatalf("latest u2 %+v %v", last, err)
			}
			if h, v, _ := s.LastHash(ctx, "u1"); h != es[1].Hash || v != Changed {
				t.Fatalf("last hash %s %s", h, v)
			}
			obits, _ := s.Obituaries(ctx, "a", 10)
			if len(obits) != 1 || obits[0].UID != "u2" {
				t.Fatalf("obituaries %v", obits)
			}
			st, err := s.Stats(ctx)
			if err != nil || st.Records != 6 || st.Objects != 4 || st.Bytes <= 0 {
				t.Fatalf("stats %+v %v", st, err)
			}
		})
	}
}

// Stores written before compression existed stay readable.
func TestCompressionMixes(t *testing.T) {
	for name, s := range backends(t) {
		t.Run(name, func(t *testing.T) {
			ctx := context.Background()
			s.Compress = false
			if err := s.Add(ctx, entry(t, cms, cm("a", "x", "u1", "plain"), Born, t0).Record, "h1"); err != nil {
				t.Fatal(err)
			}
			s.Compress = true
			if err := s.Add(ctx, entry(t, cms, cm("a", "x", "u1", strings.Repeat("zip", 100)), Changed, t0.Add(time.Minute)).Record, "h2"); err != nil {
				t.Fatal(err)
			}
			life, err := s.Life(ctx, Ref{Resource: "configmaps", Namespace: "a", Name: "x"})
			if err != nil || len(life) != 2 || !strings.Contains(string(life[0].Object), "plain") || !strings.Contains(string(life[1].Object), "zipzip") {
				t.Fatalf("mixed bodies: %v", err)
			}
		})
	}
}

func TestCompaction(t *testing.T) {
	for name, s := range backends(t) {
		t.Run(name, func(t *testing.T) {
			ctx := context.Background()
			now := t0.Add(10 * 24 * time.Hour)
			// One change every 10 minutes for 10 days.
			var es []Entry
			for i := 0; i <= 10*24*6; i++ {
				verb := Changed
				if i == 0 {
					verb = Born
				}
				es = append(es, entry(t, cms, cm("a", "busy", "u1", fmt.Sprint(i)), verb, t0.Add(time.Duration(i)*10*time.Minute)))
			}
			if err := s.AddBatch(ctx, es); err != nil {
				t.Fatal(err)
			}
			tiers, err := ParseTiers("24h:1h,7d:24h")
			if err != nil {
				t.Fatal(err)
			}
			st, err := s.Retain(ctx, Policy{Tiers: tiers}, now)
			if err != nil {
				t.Fatal(err)
			}
			life, _ := s.Life(ctx, Ref{Resource: "configmaps", Namespace: "a", Name: "busy"})
			if int64(len(es))-st.Compacted != int64(len(life)) {
				t.Fatalf("compacted %d of %d, %d left", st.Compacted, len(es), len(life))
			}
			if life[0].Verb != Born || !life[len(life)-1].At.Equal(now) {
				t.Fatal("birth and the latest state must survive compaction")
			}
			perHour, perDay := map[int64]int{}, map[int64]int{}
			recent := 0
			for _, r := range life[1:] {
				age := now.Sub(r.At)
				switch {
				case age <= 24*time.Hour:
					recent++
				case age <= 7*24*time.Hour:
					perHour[r.At.UnixMilli()/time.Hour.Milliseconds()]++
				default:
					perDay[r.At.UnixMilli()/(24*time.Hour).Milliseconds()]++
				}
			}
			if recent < 24*6 {
				t.Fatalf("last 24h must keep every change, kept %d", recent)
			}
			for h, n := range perHour {
				if n > 1 {
					t.Fatalf("hour %d keeps %d changes", h, n)
				}
			}
			for d, n := range perDay {
				if n > 1 {
					t.Fatalf("day %d keeps %d changes", d, n)
				}
			}
			if len(perHour) < 6*24-1 || len(perDay) < 3 {
				t.Fatalf("too much forgotten: %d hours, %d days", len(perHour), len(perDay))
			}
			// The newest change of each window survives: at the end of an hour
			// the state is still exact.
			r, ok, _ := s.At(ctx, Ref{Resource: "configmaps", Namespace: "a", Name: "busy"}, t0.Add(5*24*time.Hour+59*time.Minute))
			if !ok || !strings.Contains(string(r.Object), fmt.Sprintf(`"v":"%d"`, 5*24*6+5)) {
				t.Fatalf("state at the end of an hour lost: %s", r.Object)
			}
			again, _ := s.Retain(ctx, Policy{Tiers: tiers}, now)
			if again.Compacted != 0 {
				t.Fatalf("compaction must be idempotent, forgot %d more", again.Compacted)
			}
		})
	}
}

func TestRetentionRules(t *testing.T) {
	for name, s := range backends(t) {
		t.Run(name, func(t *testing.T) {
			ctx := context.Background()
			now := t0.Add(30 * 24 * time.Hour)
			var es []Entry
			for i := 0; i < 20; i++ {
				verb := Changed
				if i == 0 {
					verb = Born
				}
				es = append(es, entry(t, cms, cm("a", "many", "u1", fmt.Sprint(i)), verb, t0.Add(time.Duration(i)*time.Hour)))
			}
			es = append(es,
				entry(t, cms, cm("a", "old-dead", "u2", "x"), Born, t0),
				entry(t, cms, cm("a", "old-dead", "u2", "x"), Died, t0.Add(time.Hour)),
				entry(t, cms, cm("a", "new-dead", "u3", "x"), Born, now.Add(-2*time.Hour)),
				entry(t, cms, cm("a", "new-dead", "u3", "x"), Died, now.Add(-time.Hour)),
			)
			if err := s.AddBatch(ctx, es); err != nil {
				t.Fatal(err)
			}
			st, err := s.Retain(ctx, Policy{MaxVersions: 5, TombstoneTTL: 7 * 24 * time.Hour}, now)
			if err != nil {
				t.Fatal(err)
			}
			if st.Trimmed != 15 || st.Tombstones != 2 {
				t.Fatalf("trimmed %d tombstones %d", st.Trimmed, st.Tombstones)
			}
			if life, _ := s.Life(ctx, Ref{Resource: "configmaps", Namespace: "a", Name: "old-dead"}); len(life) != 0 {
				t.Fatal("old tombstone must be gone entirely")
			}
			if life, _ := s.Life(ctx, Ref{Resource: "configmaps", Namespace: "a", Name: "new-dead"}); len(life) != 2 {
				t.Fatal("recent death must be remembered")
			}
			st, err = s.Retain(ctx, Policy{MaxAge: 24 * time.Hour}, now)
			if err != nil || st.Expired != 4 {
				t.Fatalf("expired %d %v", st.Expired, err)
			}
			if life, _ := s.Life(ctx, Ref{Resource: "configmaps", Namespace: "a", Name: "many"}); len(life) != 1 {
				t.Fatalf("max age keeps the latest state only, kept %d", len(life))
			}
		})
	}
}

func TestParseTiers(t *testing.T) {
	ts, err := ParseTiers("7d:24h, 24h:1h")
	if err != nil || len(ts) != 2 || ts[0].After != 24*time.Hour || ts[1].Window != 24*time.Hour {
		t.Fatalf("%v %v", ts, err)
	}
	if _, err := ParseTiers("24h:1d,7d:1h"); err == nil {
		t.Fatal("finer windows for older records must be refused")
	}
	if _, err := ParseTiers("24h"); err == nil {
		t.Fatal("missing window must be refused")
	}
}

// Normalize redacts secret values, including the copy kubectl apply keeps in
// an annotation, before they reach the store.
func TestSecretValuesNeverStored(t *testing.T) {
	sec := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "v1", "kind": "Secret",
		"metadata":   map[string]any{"name": "s", "namespace": "a", "uid": "u9", "annotations": map[string]any{"kubectl.kubernetes.io/last-applied-configuration": `{"data":{"password":"aHVudGVyMg=="}}`}},
		"data":       map[string]any{"password": "aHVudGVyMg=="},
		"stringData": map[string]any{"token": "hunter2"},
	}}
	gr := schema.GroupResource{Resource: "secrets"}
	rec, _, err := Normalize(gr, sec)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(rec.Object), "aHVudGVyMg") || strings.Contains(string(rec.Object), "hunter2") {
		t.Fatalf("secret value leaked into history: %s", rec.Object)
	}
	for name, s := range backends(t) {
		if err := s.Add(context.Background(), rec, "h"); err != nil {
			t.Fatal(err)
		}
		got, _, _ := s.Latest(context.Background(), "u9")
		if strings.Contains(string(got.Object), "hunter2") || !strings.Contains(string(got.Object), "redacted") {
			t.Fatalf("%s: %s", name, got.Object)
		}
	}
	// A secret-shaped config map is not a secret.
	c, _, _ := Normalize(cms, cm("a", "x", "u", "hunter2"))
	if !strings.Contains(string(c.Object), "hunter2") {
		t.Fatal("config maps must not be redacted")
	}
}

func TestNormalizeKeepsManager(t *testing.T) {
	u := cm("a", "x", "u", "1")
	u.Object["metadata"].(map[string]any)["managedFields"] = []any{
		map[string]any{"manager": "kubectl", "operation": "Update", "time": "2026-11-01T10:00:00Z"},
		map[string]any{"manager": "helm", "operation": "Update", "time": "2026-11-02T10:00:00Z"},
	}
	u.Object["status"] = map[string]any{"x": "y"}
	rec, h1, err := Normalize(cms, u)
	if err != nil {
		t.Fatal(err)
	}
	if rec.Manager != "helm" || !rec.At.Equal(time.Date(2026, 11, 2, 10, 0, 0, 0, time.UTC)) {
		t.Fatalf("manager %q at %s", rec.Manager, rec.At)
	}
	if strings.Contains(string(rec.Object), "managedFields") || strings.Contains(string(rec.Object), "status") {
		t.Fatalf("managed fields or status kept: %s", rec.Object)
	}
	if _, h2, _ := Normalize(cms, cm("a", "x", "u", "1")); h1 != h2 {
		t.Fatal("status and managed fields must not change the content hash")
	}
}
