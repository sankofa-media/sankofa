package angel

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Pulses are readers' own heartbeats, gathered into a chorus around the
// author's. A pulse is health data (GDPR art. 9), so only its anonymous form
// is ever accepted or kept: the RR intervals (milliseconds between beats),
// rounded to 5 ms, the kind of source, and the day. No ECG or camera frames,
// no device, no name, no age, no time of day: the browser derives the
// intervals from the camera itself and sends only them.

// Limits of a pulse.
const (
	MinBeats      = 20
	MaxBeats      = 120
	MinRR         = 270  // ms, about 220 bpm
	MaxRR         = 2000 // ms, 30 bpm
	MaxJump       = 0.40 // relative change between consecutive intervals
	MaxJumpsShare = 0.10 // share of beats allowed to jump that much
	RRStep        = 5    // ms
	PulsesPerHour = 2
)

// PulseSources are where a pulse may come from. Today only the phone camera
// (a fingertip over the lens); the stored field lets another source, such as
// tapping along, be added later without a schema change.
var PulseSources = map[string]bool{"camera": true}

// RoundRR rounds an interval to the nearest RRStep ms.
func RoundRR(v int) int { return (v + RRStep/2) / RRStep * RRStep }

// ValidateRR checks a series of RR intervals and returns it rounded.
func ValidateRR(rr []int) ([]int, error) {
	if len(rr) < MinBeats || len(rr) > MaxBeats {
		return nil, fmt.Errorf("%w: want %d to %d intervals, got %d", ErrInput, MinBeats, MaxBeats, len(rr))
	}
	jumps := 0
	for i, v := range rr {
		if v < MinRR || v > MaxRR {
			return nil, fmt.Errorf("%w: interval %d of %d ms is outside %d..%d", ErrInput, i, v, MinRR, MaxRR)
		}
		if i > 0 {
			d := float64(v-rr[i-1]) / float64(rr[i-1])
			if d > MaxJump || d < -MaxJump {
				jumps++
			}
		}
	}
	if float64(jumps) > MaxJumpsShare*float64(len(rr)) {
		return nil, fmt.Errorf("%w: too irregular to be a pulse (%d jumps)", ErrInput, jumps)
	}
	out := make([]int, len(rr))
	for i, v := range rr {
		out[i] = RoundRR(v)
	}
	return out, nil
}

// Pulse is one stored pulse.
type Pulse struct {
	ID     int64  `json:"id"`
	RR     []int  `json:"rr"`
	Source string `json:"source"`
	Day    string `json:"day"`
	Hidden bool   `json:"hidden"`
}

const pulseSchema = `
CREATE TABLE IF NOT EXISTS pulses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  rr          TEXT NOT NULL,
  source      TEXT NOT NULL,
  day         TEXT NOT NULL,
  hidden      INTEGER NOT NULL DEFAULT 0,
  delete_hash TEXT NOT NULL UNIQUE
);
`

// InsertPulse stores a validated pulse.
func (s *Store) InsertPulse(ctx context.Context, rr []int, source, code string, now time.Time) (int64, error) {
	data, err := json.Marshal(rr)
	if err != nil {
		return 0, err
	}
	res, err := s.db.ExecContext(ctx, `INSERT INTO pulses (rr, source, day, delete_hash) VALUES (?,?,?,?)`,
		string(data), source, now.UTC().Format(time.DateOnly), HashCode(code))
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *Store) pulses(ctx context.Context, q string, args ...any) ([]Pulse, error) {
	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Pulse
	for rows.Next() {
		var p Pulse
		var rr string
		if err := rows.Scan(&p.ID, &rr, &p.Source, &p.Day, &p.Hidden); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(rr), &p.RR); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// FirstPulse returns the earliest visible pulse: the centre pulse that plays
// under every reader's palm. When it is hidden or deleted, the next earliest
// takes its place. It returns ErrNotFound when there is none.
func (s *Store) FirstPulse(ctx context.Context) (Pulse, error) {
	ps, err := s.pulses(ctx, `SELECT id, rr, source, day, hidden FROM pulses WHERE hidden = 0 ORDER BY id LIMIT 1`)
	if err != nil {
		return Pulse{}, err
	}
	if len(ps) == 0 {
		return Pulse{}, ErrNotFound
	}
	return ps[0], nil
}

// SamplePulses returns up to n random visible pulses other than except.
func (s *Store) SamplePulses(ctx context.Context, n int, except int64) ([]Pulse, error) {
	return s.pulses(ctx, `SELECT id, rr, source, day, hidden FROM pulses WHERE hidden = 0 AND id != ? ORDER BY random() LIMIT ?`, except, n)
}

// RecentPulses returns the newest pulses, hidden ones included, for the owner.
func (s *Store) RecentPulses(ctx context.Context, n int) ([]Pulse, error) {
	return s.pulses(ctx, `SELECT id, rr, source, day, hidden FROM pulses ORDER BY id DESC LIMIT ?`, n)
}

// CountPulses returns the number of visible pulses.
func (s *Store) CountPulses(ctx context.Context) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM pulses WHERE hidden = 0`).Scan(&n)
	return n, err
}

// SetPulseHidden hides or shows a pulse.
func (s *Store) SetPulseHidden(ctx context.Context, id int64, hidden bool) error {
	res, err := s.db.ExecContext(ctx, `UPDATE pulses SET hidden = ? WHERE id = ?`, hidden, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeletePulseByCode forgets the pulse a delete code belongs to.
func (s *Store) DeletePulseByCode(ctx context.Context, code string) error {
	var id int64
	err := s.db.QueryRowContext(ctx, `SELECT id FROM pulses WHERE delete_hash = ?`, HashCode(code)).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `DELETE FROM pulses WHERE id = ?`, id)
	return err
}

// --- HTTP ------------------------------------------------------------------

func (s *Server) submitPulse(w http.ResponseWriter, r *http.Request) {
	// Unknown fields are refused, so nothing beyond RR can slip into the
	// request by mistake (an ECG trace, a birth date, a device name).
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10))
	dec.DisallowUnknownFields()
	var in struct {
		RR      []int  `json:"rr"`
		Source  string `json:"source"`
		Consent bool   `json:"consent"`
	}
	if err := dec.Decode(&in); err != nil {
		fail(w, http.StatusBadRequest, "want {rr: [ms], source: camera, consent: true}")
		return
	}
	if !in.Consent {
		fail(w, http.StatusBadRequest, "consent is required")
		return
	}
	if !PulseSources[in.Source] {
		fail(w, http.StatusBadRequest, "source must be camera")
		return
	}
	rr, err := ValidateRR(in.RR)
	if err != nil {
		fail(w, http.StatusBadRequest, strings.TrimPrefix(err.Error(), ErrInput.Error()+": "))
		return
	}
	if !s.Clients.Allow(s.client(r), "pulses", PulsesPerHour, time.Hour) {
		fail(w, http.StatusTooManyRequests, "you have left your pulse already; come back later")
		return
	}
	code := NewDeleteCode()
	if _, err := s.Svc.Store.InsertPulse(r.Context(), rr, in.Source, code, s.Svc.now()); err != nil {
		s.log().Error("angel pulse", "err", err)
		fail(w, http.StatusInternalServerError, "could not keep the pulse")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"delete_code": code})
}

// PublicPulse is a pulse as readers get it.
type PublicPulse struct {
	ID int64 `json:"id"`
	RR []int `json:"rr"`
}

// samplePulses returns {first, others}: the centre pulse (or null) and a
// random sample of the rest.
func (s *Server) samplePulses(w http.ResponseWriter, r *http.Request) {
	var first *PublicPulse
	f, err := s.Svc.Store.FirstPulse(r.Context())
	switch {
	case err == nil:
		first = &PublicPulse{f.ID, f.RR}
	case !errors.Is(err, ErrNotFound):
		fail(w, http.StatusInternalServerError, "store")
		return
	}
	ps, err := s.Svc.Store.SamplePulses(r.Context(), count(r, 24, 100), f.ID)
	if err != nil {
		fail(w, http.StatusInternalServerError, "store")
		return
	}
	others := make([]PublicPulse, 0, len(ps))
	for _, p := range ps {
		others = append(others, PublicPulse{p.ID, p.RR})
	}
	writeJSON(w, http.StatusOK, map[string]any{"first": first, "others": others})
}

func (s *Server) countPulses(w http.ResponseWriter, r *http.Request) {
	n, err := s.Svc.Store.CountPulses(r.Context())
	if err != nil {
		fail(w, http.StatusInternalServerError, "store")
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"count": n})
}

func (s *Server) deletePulse(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("code")
	if code == "" {
		fail(w, http.StatusBadRequest, "code required")
		return
	}
	if !s.Clients.Allow(s.client(r), "delete", 30, time.Hour) {
		fail(w, http.StatusTooManyRequests, "slow down")
		return
	}
	err := s.Svc.Store.DeletePulseByCode(r.Context(), code)
	if errors.Is(err, ErrNotFound) {
		fail(w, http.StatusNotFound, "no such code")
		return
	} else if err != nil {
		fail(w, http.StatusInternalServerError, "store")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (s *Server) adminPulses(w http.ResponseWriter, r *http.Request) {
	ps, err := s.Svc.Store.RecentPulses(r.Context(), count(r, 100, 1000))
	if err != nil {
		fail(w, http.StatusInternalServerError, "store")
		return
	}
	if ps == nil {
		ps = []Pulse{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"pulses": ps})
}

func (s *Server) decidePulse(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	var in struct {
		Action string `json:"action"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&in); err != nil || (in.Action != "hide" && in.Action != "publish") {
		fail(w, http.StatusBadRequest, "want {action: hide|publish}")
		return
	}
	err = s.Svc.Store.SetPulseHidden(r.Context(), id, in.Action == "hide")
	if errors.Is(err, ErrNotFound) {
		fail(w, http.StatusNotFound, "no such pulse")
		return
	} else if err != nil {
		fail(w, http.StatusInternalServerError, "store")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": in.Action})
}
