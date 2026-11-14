package history

import (
	"bytes"
	"context"
	"database/sql"
	"fmt"
	"strconv"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/klauspost/compress/zstd"
	_ "modernc.org/sqlite"
)

// dialect holds what differs between SQLite and PostgreSQL. Queries are
// written with ? placeholders and rebound for PostgreSQL.
type dialect struct {
	name   string
	schema string
	dollar bool
}

var sqliteDialect = dialect{name: "sqlite", schema: `
CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grp TEXT NOT NULL, resource TEXT NOT NULL, namespace TEXT NOT NULL, name TEXT NOT NULL,
  uid TEXT NOT NULL, kind TEXT NOT NULL, verb TEXT NOT NULL, at INTEGER NOT NULL,
  manager TEXT NOT NULL, revision TEXT NOT NULL, hash TEXT NOT NULL, object BLOB NOT NULL,
  recorded INTEGER NOT NULL DEFAULT 0, until INTEGER NOT NULL DEFAULT 4611686018427387904
);`}

var postgresDialect = dialect{name: "postgres", dollar: true, schema: `
CREATE TABLE IF NOT EXISTS records (
  id BIGSERIAL PRIMARY KEY,
  grp TEXT NOT NULL, resource TEXT NOT NULL, namespace TEXT NOT NULL, name TEXT NOT NULL,
  uid TEXT NOT NULL, kind TEXT NOT NULL, verb TEXT NOT NULL, at BIGINT NOT NULL,
  manager TEXT NOT NULL, revision TEXT NOT NULL, hash TEXT NOT NULL, object BYTEA NOT NULL,
  recorded BIGINT NOT NULL DEFAULT 0, until BIGINT NOT NULL DEFAULT 4611686018427387904
);
-- Many small deletes from retention: vacuum and analyze this table early
-- rather than at the default 20% of dead rows.
ALTER TABLE records SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.01, autovacuum_vacuum_cost_limit = 1000);`}

const indexes = `
CREATE INDEX IF NOT EXISTS records_ref ON records(grp, resource, namespace, name, at);
CREATE INDEX IF NOT EXISTS records_verb ON records(verb, at);
CREATE INDEX IF NOT EXISTS records_uid ON records(uid, id);
CREATE INDEX IF NOT EXISTS records_ns_until ON records(namespace, until, at);`

func (d dialect) rebind(q string) string {
	if !d.dollar {
		return q
	}
	var b strings.Builder
	n := 0
	for _, c := range q {
		if c == '?' {
			n++
			b.WriteString("$" + strconv.Itoa(n))
			continue
		}
		b.WriteRune(c)
	}
	return b.String()
}

// SQLStore is the Store on database/sql.
type SQLStore struct {
	db *sql.DB
	d  dialect
	// Compress stores object bodies as zstd frames. Reads detect the frame
	// magic, so stores written with and without compression mix freely.
	Compress bool
	enc      *zstd.Encoder
	dec      *zstd.Decoder
}

// OpenSQLite opens or creates a SQLite store. SQLite has one writer: run one
// Griot replica on it.
func OpenSQLite(path string) (*SQLStore, error) {
	// auto_vacuum only takes effect on a new file; it lets retention give
	// space back to the file system with incremental_vacuum.
	db, err := sql.Open("sqlite", path+"?_pragma=auto_vacuum(INCREMENTAL)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=synchronous(NORMAL)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	return newSQLStore(db, sqliteDialect)
}

// OpenPostgres opens a PostgreSQL store and creates its schema.
func OpenPostgres(dsn string) (*SQLStore, error) {
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(16)
	db.SetMaxIdleConns(4)
	db.SetConnMaxIdleTime(5 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, err
	}
	return newSQLStore(db, postgresDialect)
}

func newSQLStore(db *sql.DB, d dialect) (*SQLStore, error) {
	if _, err := db.Exec(d.schema); err != nil {
		db.Close()
		return nil, err
	}
	// Stores created before the recorded column existed.
	if _, err := db.Exec(`SELECT recorded FROM records LIMIT 0`); err != nil {
		if _, err := db.Exec(`ALTER TABLE records ADD COLUMN recorded BIGINT NOT NULL DEFAULT 0`); err != nil {
			db.Close()
			return nil, err
		}
	}
	// Stores created before validity intervals: add and fill them once.
	if _, err := db.Exec(`SELECT until FROM records LIMIT 0`); err != nil {
		if _, err := db.Exec(`ALTER TABLE records ADD COLUMN until BIGINT NOT NULL DEFAULT ` + strconv.FormatInt(Forever, 10)); err != nil {
			db.Close()
			return nil, err
		}
		if _, err := db.Exec(d.rebind(repairUntil), Forever, Forever); err != nil {
			db.Close()
			return nil, fmt.Errorf("fill validity intervals: %w", err)
		}
	}
	// The old namespace index is replaced by records_ns_until.
	_, _ = db.Exec(`DROP INDEX IF EXISTS records_ns`)
	for _, stmt := range strings.Split(strings.TrimSpace(indexes+";"+auditSchema), ";") {
		if stmt = strings.TrimSpace(stmt); stmt == "" {
			continue
		}
		if _, err := db.Exec(stmt); err != nil {
			db.Close()
			return nil, err
		}
	}
	enc, _ := zstd.NewWriter(nil, zstd.WithEncoderLevel(zstd.SpeedDefault), zstd.WithEncoderConcurrency(1))
	dec, _ := zstd.NewReader(nil, zstd.WithDecoderConcurrency(0))
	return &SQLStore{db: db, d: d, Compress: true, enc: enc, dec: dec}, nil
}

// Dialect names the backend: "sqlite" or "postgres".
func (s *SQLStore) Dialect() string { return s.d.name }

// DB exposes the handle for measurements and tests.
func (s *SQLStore) DB() *sql.DB { return s.db }

// Close closes the store.
func (s *SQLStore) Close() error { return s.db.Close() }

func (s *SQLStore) q(query string) string { return s.d.rebind(query) }

var zstdMagic = []byte{0x28, 0xb5, 0x2f, 0xfd}

func (s *SQLStore) pack(obj []byte) []byte {
	if !s.Compress {
		return obj
	}
	return s.enc.EncodeAll(obj, make([]byte, 0, len(obj)/3))
}

func (s *SQLStore) unpack(b []byte) ([]byte, error) {
	if !bytes.HasPrefix(b, zstdMagic) {
		return b, nil
	}
	return s.dec.DecodeAll(b, nil)
}

const cols = `id,grp,resource,namespace,name,uid,kind,verb,at,manager,revision,object,recorded`

func (s *SQLStore) scan(rows *sql.Rows) ([]Record, error) {
	defer rows.Close()
	var out []Record
	for rows.Next() {
		var r Record
		var at, recorded int64
		var obj []byte
		if err := rows.Scan(&r.ID, &r.Ref.Group, &r.Ref.Resource, &r.Ref.Namespace, &r.Ref.Name, &r.UID, &r.Kind, &r.Verb, &at, &r.Manager, &r.Revision, &obj, &recorded); err != nil {
			return nil, err
		}
		r.At = time.UnixMilli(at).UTC()
		if recorded > 0 {
			r.Recorded = time.UnixMilli(recorded).UTC()
		}
		body, err := s.unpack(obj)
		if err != nil {
			return nil, fmt.Errorf("record %d: %w", r.ID, err)
		}
		r.Object = body
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *SQLStore) query(ctx context.Context, q string, args ...any) ([]Record, error) {
	rows, err := s.db.QueryContext(ctx, s.q(q), args...)
	if err != nil {
		return nil, err
	}
	return s.scan(rows)
}

func (s *SQLStore) one(ctx context.Context, q string, args ...any) (Record, bool, error) {
	rs, err := s.query(ctx, q, args...)
	if err != nil || len(rs) == 0 {
		return Record{}, false, err
	}
	return rs[0], true, nil
}

// Heads returns the latest record of every uid, without bodies.
func (s *SQLStore) Heads(ctx context.Context) ([]Head, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,uid,grp,resource,namespace,name,kind,hash,verb FROM records WHERE id IN (SELECT MAX(id) FROM records GROUP BY uid)`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Head
	for rows.Next() {
		var h Head
		if err := rows.Scan(&h.ID, &h.UID, &h.Ref.Group, &h.Ref.Resource, &h.Ref.Namespace, &h.Ref.Name, &h.Kind, &h.Hash, &h.Verb); err != nil {
			return nil, err
		}
		out = append(out, h)
	}
	return out, rows.Err()
}

// LastHash returns the content hash of the latest record for the uid.
func (s *SQLStore) LastHash(ctx context.Context, uid string) (hash, verb string, err error) {
	err = s.db.QueryRowContext(ctx, s.q(`SELECT hash, verb FROM records WHERE uid=? ORDER BY id DESC LIMIT 1`), uid).Scan(&hash, &verb)
	if err == sql.ErrNoRows {
		return "", "", nil
	}
	return hash, verb, err
}

// Add appends a record.
func (s *SQLStore) Add(ctx context.Context, r Record, hash string) error {
	return s.AddBatch(ctx, []Entry{{Record: r, Hash: hash}})
}

// batchRows keeps a multi-row INSERT well under SQLite's parameter limit.
const batchRows = 500

// Forever is the end of the validity interval of a current state.
const Forever int64 = 1 << 62

// Every record is the state of its object from at until the next record of
// the same uid; a death is valid for no time at all. The interval makes
// "everything alive at T" an index range instead of a scan of all history.
//
// repairUntil recomputes intervals after records were removed from the middle
// of a life (compaction) or for stores created before intervals existed.
const repairUntil = `UPDATE records SET until = CASE WHEN verb='died' THEN at ELSE COALESCE((SELECT n.at FROM records n WHERE n.uid=records.uid AND n.id>records.id ORDER BY n.id LIMIT 1), ?) END
 WHERE until <> CASE WHEN verb='died' THEN at ELSE COALESCE((SELECT n.at FROM records n WHERE n.uid=records.uid AND n.id>records.id ORDER BY n.id LIMIT 1), ?) END`

// AddBatch appends records in one transaction with multi-row inserts, and
// closes the validity interval of the state each record replaces.
func (s *SQLStore) AddBatch(ctx context.Context, entries []Entry) error {
	if len(entries) == 0 {
		return nil
	}
	// Within the batch, a record is valid until the next one of its uid.
	until := make([]int64, len(entries))
	next := map[string]int{}
	first := map[string]int64{} // uid -> at of its first record in the batch
	var order []string
	for i := len(entries) - 1; i >= 0; i-- {
		r := entries[i].Record
		until[i] = Forever
		if j, ok := next[r.UID]; ok {
			until[i] = entries[j].Record.At.UnixMilli()
		}
		if r.Verb == Died {
			until[i] = r.At.UnixMilli()
		}
		next[r.UID] = i
	}
	for i, e := range entries {
		if _, ok := first[e.Record.UID]; !ok {
			first[e.Record.UID] = entries[i].Record.At.UnixMilli()
			order = append(order, e.Record.UID)
		}
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	for start := 0; start < len(order); start += batchRows {
		chunk := order[start:min(start+batchRows, len(order))]
		var b strings.Builder
		b.WriteString(`WITH v(uid, t) AS (VALUES `)
		args := make([]any, 0, 2*len(chunk)+1)
		for i, uid := range chunk {
			if i > 0 {
				b.WriteByte(',')
			}
			b.WriteString("(CAST(? AS TEXT), CAST(? AS BIGINT))")
			args = append(args, uid, first[uid])
		}
		b.WriteString(`) UPDATE records SET until = (SELECT t FROM v WHERE v.uid = records.uid) WHERE until = ? AND uid IN (SELECT uid FROM v)`)
		if _, err := tx.ExecContext(ctx, s.q(b.String()), append(args, Forever)...); err != nil {
			return fmt.Errorf("close intervals: %w", err)
		}
	}
	now := time.Now().UnixMilli()
	for start := 0; start < len(entries); start += batchRows {
		chunk := entries[start:min(start+batchRows, len(entries))]
		var b strings.Builder
		b.WriteString(`INSERT INTO records(grp,resource,namespace,name,uid,kind,verb,at,manager,revision,hash,object,recorded,until) VALUES`)
		args := make([]any, 0, len(chunk)*14)
		for i, e := range chunk {
			if i > 0 {
				b.WriteByte(',')
			}
			b.WriteString("(?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
			r := e.Record
			args = append(args, r.Ref.Group, r.Ref.Resource, r.Ref.Namespace, r.Ref.Name, r.UID, r.Kind, r.Verb, r.At.UnixMilli(), r.Manager, r.Revision, e.Hash, s.pack(r.Object), now, until[start+i])
		}
		if _, err := tx.ExecContext(ctx, s.q(b.String()), args...); err != nil {
			return err
		}
	}
	return tx.Commit()
}

const byRef = ` WHERE grp=? AND resource=? AND namespace=? AND name=?`

func refArgs(ref Ref, more ...any) []any {
	return append([]any{ref.Group, ref.Resource, ref.Namespace, ref.Name}, more...)
}

// Life returns every record of an object (all its incarnations), oldest first.
func (s *SQLStore) Life(ctx context.Context, ref Ref) ([]Record, error) {
	return s.query(ctx, `SELECT `+cols+` FROM records`+byRef+` ORDER BY id`, refArgs(ref)...)
}

// At returns the state of the object at time t: the latest record not after
// t. ok is false when the object did not exist then.
func (s *SQLStore) At(ctx context.Context, ref Ref, t time.Time) (Record, bool, error) {
	r, ok, err := s.one(ctx, `SELECT `+cols+` FROM records`+byRef+` AND at<=? ORDER BY id DESC LIMIT 1`, refArgs(ref, t.UnixMilli())...)
	if ok && r.Verb == Died {
		return Record{}, false, err
	}
	return r, ok, err
}

// LastAlive returns the latest record under the name, for restores without a
// time: for a dead object, its final state.
func (s *SQLStore) LastAlive(ctx context.Context, ref Ref) (Record, bool, error) {
	return s.one(ctx, `SELECT `+cols+` FROM records`+byRef+` ORDER BY id DESC LIMIT 1`, refArgs(ref)...)
}

// Latest returns the latest record of an incarnation.
func (s *SQLStore) Latest(ctx context.Context, uid string) (Record, bool, error) {
	return s.one(ctx, `SELECT `+cols+` FROM records WHERE uid=? ORDER BY id DESC LIMIT 1`, uid)
}

// Obituaries lists deaths, newest first, optionally in one namespace.
func (s *SQLStore) Obituaries(ctx context.Context, namespace string, limit int) ([]Record, error) {
	q := `SELECT ` + cols + ` FROM records WHERE verb='died'`
	args := []any{}
	if namespace != "" {
		q += ` AND namespace=?`
		args = append(args, namespace)
	}
	q += ` ORDER BY id DESC LIMIT ?`
	return s.query(ctx, q, append(args, limit)...)
}

// Cursor continues a paged namespace read after the last object returned.
type Cursor struct {
	Group, Resource, Name string
	ID                    int64
}

// NamespaceAt returns the state of every object alive in the namespace at t,
// ordered by resource and name, at most limit (0: all) after the cursor. It
// reads the validity intervals: its cost follows the objects alive at t and
// the changes made after t, not the whole history.
func (s *SQLStore) NamespaceAt(ctx context.Context, namespace string, t time.Time, after *Cursor, limit int) ([]Record, error) {
	q := `SELECT ` + cols + ` FROM records WHERE namespace=? AND until>? AND at<=? AND verb<>'died'`
	args := []any{namespace, t.UnixMilli(), t.UnixMilli()}
	if after != nil {
		q += ` AND (grp, resource, name, id) > (?, ?, ?, ?)`
		args = append(args, after.Group, after.Resource, after.Name, after.ID)
	}
	q += ` ORDER BY grp, resource, name, id`
	if limit > 0 {
		q += ` LIMIT ?`
		args = append(args, limit)
	}
	return s.query(ctx, q, args...)
}

// NamespaceAtScan is the query NamespaceAt used before validity intervals:
// the latest record of every uid not after t. Kept to measure the difference.
func (s *SQLStore) NamespaceAtScan(ctx context.Context, namespace string, t time.Time) ([]Record, error) {
	return s.query(ctx, `SELECT `+cols+` FROM records WHERE id IN (SELECT MAX(id) FROM records WHERE namespace=? AND at<=? GROUP BY uid) AND verb<>'died' ORDER BY grp, resource, name`,
		namespace, t.UnixMilli())
}

// Moments returns records of an object without bodies, newest first, at most
// limit, older than beforeID when it is not zero.
func (s *SQLStore) Moments(ctx context.Context, ref Ref, limit int, beforeID int64) ([]Record, error) {
	q := `SELECT id,grp,resource,namespace,name,uid,kind,verb,at,manager,revision,recorded FROM records` + byRef
	args := refArgs(ref)
	if beforeID > 0 {
		q += ` AND id<?`
		args = append(args, beforeID)
	}
	q += ` ORDER BY id DESC LIMIT ?`
	rows, err := s.db.QueryContext(ctx, s.q(q), append(args, limit)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Record
	for rows.Next() {
		var r Record
		var at, recorded int64
		if err := rows.Scan(&r.ID, &r.Ref.Group, &r.Ref.Resource, &r.Ref.Namespace, &r.Ref.Name, &r.UID, &r.Kind, &r.Verb, &at, &r.Manager, &r.Revision, &recorded); err != nil {
			return nil, err
		}
		r.At = time.UnixMilli(at).UTC()
		if recorded > 0 {
			r.Recorded = time.UnixMilli(recorded).UTC()
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// Summarize counts an object's life without reading it.
func (s *SQLStore) Summarize(ctx context.Context, ref Ref) (Summary, error) {
	var sum Summary
	var changed, born sql.NullInt64
	err := s.db.QueryRowContext(ctx, s.q(`SELECT COUNT(*), SUM(CASE WHEN verb='changed' THEN 1 ELSE 0 END), SUM(CASE WHEN verb='born' THEN 1 ELSE 0 END) FROM records`+byRef), refArgs(ref)...).
		Scan(&sum.Records, &changed, &born)
	if err != nil || sum.Records == 0 {
		return sum, err
	}
	sum.Changes, sum.Lives = int(changed.Int64), int(born.Int64)
	first, err := s.Moments(ctx, ref, 1, 0)
	if err != nil {
		return sum, err
	}
	sum.Last = first[0]
	rows, err := s.db.QueryContext(ctx, s.q(`SELECT id,grp,resource,namespace,name,uid,kind,verb,at,manager,revision,recorded FROM records`+byRef+` ORDER BY id LIMIT 1`), refArgs(ref)...)
	if err != nil {
		return sum, err
	}
	for rows.Next() {
		var at, recorded int64
		r := &sum.First
		if err := rows.Scan(&r.ID, &r.Ref.Group, &r.Ref.Resource, &r.Ref.Namespace, &r.Ref.Name, &r.UID, &r.Kind, &r.Verb, &at, &r.Manager, &r.Revision, &recorded); err != nil {
			rows.Close()
			return sum, err
		}
		r.At = time.UnixMilli(at).UTC()
	}
	rows.Close()
	mrows, err := s.db.QueryContext(ctx, s.q(`SELECT DISTINCT manager FROM records`+byRef+` AND manager<>'' ORDER BY manager LIMIT 50`), refArgs(ref)...)
	if err != nil {
		return sum, err
	}
	defer mrows.Close()
	for mrows.Next() {
		var m string
		if err := mrows.Scan(&m); err != nil {
			return sum, err
		}
		sum.Managers = append(sum.Managers, m)
	}
	return sum, mrows.Err()
}

// Prune forgets records older than the retention, except the last record of
// each object, so every object keeps at least its obituary.
func (s *SQLStore) Prune(ctx context.Context, before time.Time) (int64, error) {
	return s.exec(ctx, `DELETE FROM records WHERE at<? AND id NOT IN (SELECT MAX(id) FROM records GROUP BY uid)`, before.UnixMilli())
}

func (s *SQLStore) exec(ctx context.Context, q string, args ...any) (int64, error) {
	res, err := s.db.ExecContext(ctx, s.q(q), args...)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// Stats reports counts and on-disk size.
func (s *SQLStore) Stats(ctx context.Context) (Stats, error) {
	var st Stats
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*), COUNT(DISTINCT uid) FROM records`).Scan(&st.Records, &st.Objects); err != nil {
		return st, err
	}
	var err error
	if s.d.name == "sqlite" {
		var pages, size, free int64
		if err = s.db.QueryRowContext(ctx, `PRAGMA page_count`).Scan(&pages); err == nil {
			if err = s.db.QueryRowContext(ctx, `PRAGMA page_size`).Scan(&size); err == nil {
				err = s.db.QueryRowContext(ctx, `PRAGMA freelist_count`).Scan(&free)
			}
		}
		st.Bytes = (pages - free) * size
	} else {
		err = s.db.QueryRowContext(ctx, `SELECT pg_total_relation_size('records')`).Scan(&st.Bytes)
	}
	return st, err
}
