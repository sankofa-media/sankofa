// Package angel is the server side of the special project "Angel": the
// presence of readers touching the screen at the same moment, and the chorus
// of words they never said.
package angel

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base32"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	_ "modernc.org/sqlite" // pure-Go SQLite driver
)

// Status is where a word is on its way to the chorus.
type Status string

const (
	// StatusQueued: received, not processed yet (transcription, moderation).
	StatusQueued Status = "queued"
	// StatusPending: processed, waits for the owner (no model key, or the
	// model call failed).
	StatusPending Status = "pending"
	// StatusReview: the model refused to judge; the owner decides.
	StatusReview Status = "review"
	// StatusPublished: part of the chorus.
	StatusPublished Status = "published"
	// StatusReported: was published, hidden by reader reports until reviewed.
	StatusReported Status = "reported"
	// StatusRejected: not published.
	StatusRejected Status = "rejected"
	// StatusCrisis: the writer may be in danger; never published.
	StatusCrisis Status = "crisis"
	// StatusHidden: hidden by the owner.
	StatusHidden Status = "hidden"
)

// Public maps an internal status onto what a writer may see by delete code:
// pending | published | rejected | crisis.
func (s Status) Public() string {
	switch s {
	case StatusPublished, StatusReported:
		return "published"
	case StatusRejected, StatusHidden:
		return "rejected"
	case StatusCrisis:
		return "crisis"
	}
	return "pending"
}

// Word is one stored entry.
type Word struct {
	ID         int64
	Text       string
	Lang       string
	Theme      string
	TrEN, TrRU string
	Status     Status
	Reason     string
	Day        string // YYYY-MM-DD, UTC: no finer time is kept
	Reports    int
	KeepVoice  bool
	Audio      string // original upload awaiting transcription, relative name
	Whisper    string // processed whisper file, relative name
}

// Store keeps the words in SQLite.
type Store struct{ db *sql.DB }

const schema = `
CREATE TABLE IF NOT EXISTS words (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  text        TEXT NOT NULL DEFAULT '',
  lang        TEXT NOT NULL DEFAULT '',
  theme       TEXT NOT NULL DEFAULT '',
  tr_en       TEXT NOT NULL DEFAULT '',
  tr_ru       TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL,
  reason      TEXT NOT NULL DEFAULT '',
  day         TEXT NOT NULL,
  reports     INTEGER NOT NULL DEFAULT 0,
  keep_voice  INTEGER NOT NULL DEFAULT 0,
  audio       TEXT NOT NULL DEFAULT '',
  whisper     TEXT NOT NULL DEFAULT '',
  delete_hash TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS words_status ON words(status);
`

// OpenStore opens or creates the database at path (":memory:" for tests).
func OpenStore(path string) (*Store, error) {
	dsn := path
	if path != ":memory:" {
		dsn = path + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=synchronous(NORMAL)"
	}
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1) // one writer; also keeps ":memory:" a single database
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("schema: %w", err)
	}
	return &Store{db: db}, nil
}

// Close closes the database.
func (s *Store) Close() error { return s.db.Close() }

// NewDeleteCode returns a fresh one-time delete code.
func NewDeleteCode() string {
	b := make([]byte, 15)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b))
}

// HashCode is how a delete code is kept: only its SHA-256.
func HashCode(code string) string {
	h := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(code))))
	return hex.EncodeToString(h[:])
}

// Insert stores a new word as queued and returns its id.
func (s *Store) Insert(ctx context.Context, w Word, code string, now time.Time) (int64, error) {
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO words (text, lang, status, day, keep_voice, audio, delete_hash) VALUES (?,?,?,?,?,?,?)`,
		w.Text, w.Lang, StatusQueued, now.UTC().Format(time.DateOnly), w.KeepVoice, w.Audio, HashCode(code))
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

const cols = `id, text, lang, theme, tr_en, tr_ru, status, reason, day, reports, keep_voice, audio, whisper`

func scan(r interface{ Scan(...any) error }) (Word, error) {
	var w Word
	var st string
	err := r.Scan(&w.ID, &w.Text, &w.Lang, &w.Theme, &w.TrEN, &w.TrRU, &st, &w.Reason, &w.Day, &w.Reports, &w.KeepVoice, &w.Audio, &w.Whisper)
	w.Status = Status(st)
	return w, err
}

func (s *Store) query(ctx context.Context, q string, args ...any) ([]Word, error) {
	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Word
	for rows.Next() {
		w, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

// ErrNotFound is returned when no word matches.
var ErrNotFound = errors.New("not found")

// Get returns one word.
func (s *Store) Get(ctx context.Context, id int64) (Word, error) {
	w, err := scan(s.db.QueryRowContext(ctx, `SELECT `+cols+` FROM words WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return w, ErrNotFound
	}
	return w, err
}

// ByCode returns the word a delete code belongs to.
func (s *Store) ByCode(ctx context.Context, code string) (Word, error) {
	w, err := scan(s.db.QueryRowContext(ctx, `SELECT `+cols+` FROM words WHERE delete_hash = ?`, HashCode(code)))
	if errors.Is(err, sql.ErrNoRows) {
		return w, ErrNotFound
	}
	return w, err
}

// Update writes back every mutable field of w.
func (s *Store) Update(ctx context.Context, w Word) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE words SET text=?, lang=?, theme=?, tr_en=?, tr_ru=?, status=?, reason=?, reports=?, audio=?, whisper=? WHERE id=?`,
		w.Text, w.Lang, w.Theme, w.TrEN, w.TrRU, w.Status, w.Reason, w.Reports, w.Audio, w.Whisper, w.ID)
	return err
}

// Delete removes a word for good.
func (s *Store) Delete(ctx context.Context, id int64) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM words WHERE id = ?`, id)
	return err
}

// Sample returns up to n random published words.
func (s *Store) Sample(ctx context.Context, n int) ([]Word, error) {
	return s.query(ctx, `SELECT `+cols+` FROM words WHERE status = ? ORDER BY random() LIMIT ?`, StatusPublished, n)
}

// Whispers returns up to n random published words that have a whisper.
func (s *Store) Whispers(ctx context.Context, n int) ([]Word, error) {
	return s.query(ctx, `SELECT `+cols+` FROM words WHERE status = ? AND whisper != '' ORDER BY random() LIMIT ?`, StatusPublished, n)
}

// Count returns the number of published words.
func (s *Store) Count(ctx context.Context) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM words WHERE status = ?`, StatusPublished).Scan(&n)
	return n, err
}

// ByStatus lists words in the given statuses, oldest first.
func (s *Store) ByStatus(ctx context.Context, limit int, st ...Status) ([]Word, error) {
	if len(st) == 0 {
		return nil, nil
	}
	args := make([]any, 0, len(st)+1)
	for _, x := range st {
		args = append(args, x)
	}
	args = append(args, limit)
	return s.query(ctx, `SELECT `+cols+` FROM words WHERE status IN (?`+strings.Repeat(",?", len(st)-1)+`) ORDER BY id LIMIT ?`, args...)
}
