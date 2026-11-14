// Package history is the memory of the cluster. Kubernetes keeps events for an
// hour and forgets a deleted object at once; Griot keeps the life story of
// every object, including an obituary after it is gone.
package history

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

// Verbs of a record.
const (
	Born    = "born"
	Changed = "changed"
	Died    = "died"
)

// Ref identifies an object.
type Ref struct {
	Group     string `json:"group"`
	Resource  string `json:"resource"`
	Namespace string `json:"namespace,omitempty"`
	Name      string `json:"name"`
}

func (r Ref) String() string {
	g := r.Group
	if g == "" {
		g = "core"
	}
	if r.Namespace == "" {
		return fmt.Sprintf("%s.%s/%s", r.Resource, g, r.Name)
	}
	return fmt.Sprintf("%s.%s/%s/%s", r.Resource, g, r.Namespace, r.Name)
}

// Record is one moment in an object's life.
type Record struct {
	ID       int64           `json:"id"`
	Ref      Ref             `json:"ref"`
	UID      string          `json:"uid"`
	Kind     string          `json:"kind"`
	Verb     string          `json:"verb"`
	At       time.Time       `json:"at"`
	Manager  string          `json:"manager,omitempty"` // field manager of the last write: who did it
	Revision string          `json:"resourceVersion"`
	Object   json.RawMessage `json:"object"`
	// Recorded is when Griot wrote the record; At minus Recorded is the lag.
	Recorded time.Time `json:"recorded,omitempty"`
}

// Entry is a record with its content hash, as the recorder writes it.
type Entry struct {
	Record Record
	Hash   string
}

// Head is the latest record of one object incarnation (uid), without the body.
type Head struct {
	ID   int64
	UID  string
	Ref  Ref
	Kind string
	Hash string
	Verb string
}

// Stats describe the size of the memory.
type Stats struct {
	Records int64 `json:"records"`
	Objects int64 `json:"objects"` // distinct uids
	Bytes   int64 `json:"bytes"`   // on-disk size as the backend reports it
}

// Store is where the memory lives. SQLite (one file, one writer) and
// PostgreSQL (shared by several Griot replicas) implement it.
type Store interface {
	// Heads returns the latest record of every uid; the recorder warms its
	// dedup cache with it.
	Heads(ctx context.Context) ([]Head, error)
	// LastHash returns the content hash and verb of the latest record for uid.
	LastHash(ctx context.Context, uid string) (hash, verb string, err error)
	// Add appends one record.
	Add(ctx context.Context, r Record, hash string) error
	// AddBatch appends records in one transaction, in order.
	AddBatch(ctx context.Context, entries []Entry) error
	// Life returns every record of an object (all its incarnations), oldest first.
	Life(ctx context.Context, ref Ref) ([]Record, error)
	// At returns the state of the object at t: the latest record not after t.
	At(ctx context.Context, ref Ref, t time.Time) (Record, bool, error)
	// LastAlive returns the latest record of the object under this name.
	LastAlive(ctx context.Context, ref Ref) (Record, bool, error)
	// Latest returns the latest record of an incarnation.
	Latest(ctx context.Context, uid string) (Record, bool, error)
	// Obituaries lists deaths, newest first, optionally in one namespace.
	Obituaries(ctx context.Context, namespace string, limit int) ([]Record, error)
	// NamespaceAt returns the latest record of every object that was alive in
	// the namespace at t ("" means cluster-scoped objects).
	NamespaceAt(ctx context.Context, namespace string, t time.Time) ([]Record, error)
	// Prune forgets records older than before, except the latest of each uid.
	Prune(ctx context.Context, before time.Time) (int64, error)
	// Retain applies a retention policy and compaction.
	Retain(ctx context.Context, p Policy, now time.Time) (RetainStats, error)
	// Stats reports counts and size.
	Stats(ctx context.Context) (Stats, error)
	Close() error
}

// Open opens or creates a SQLite store at path.
func Open(path string) (*SQLStore, error) { return OpenSQLite(path) }

// OpenStore opens a store by driver name: "sqlite" (dsn is a file path) or
// "postgres" (dsn is a libpq/pgx connection string).
func OpenStore(driver, dsn string) (Store, error) {
	switch driver {
	case "sqlite", "":
		return OpenSQLite(dsn)
	case "postgres", "postgresql", "pgx":
		return OpenPostgres(dsn)
	}
	return nil, fmt.Errorf("unknown store %q: want sqlite or postgres", driver)
}
