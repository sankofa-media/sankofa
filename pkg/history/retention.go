package history

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
)

// Policy says what the memory forgets. The zero Policy forgets nothing.
//
// Whatever the policy, the latest record of every incarnation stays until
// TombstoneTTL removes a dead one, so every object keeps at least its last
// known state or its obituary.
type Policy struct {
	// MaxAge forgets records older than this.
	MaxAge time.Duration
	// MaxVersions keeps at most this many records per incarnation (uid).
	MaxVersions int
	// TombstoneTTL forgets a dead object entirely this long after its death.
	TombstoneTTL time.Duration
	// Tiers thin out old changes: a "changed" record older than a tier's After
	// survives only if it is the newest of its uid in its Window. Births and
	// deaths always survive compaction.
	Tiers []Tier
}

// Tier is one step of compaction.
type Tier struct {
	After  time.Duration // records older than this
	Window time.Duration // keep the newest per window
}

// RetainStats count what each rule forgot.
type RetainStats struct {
	Compacted  int64 `json:"compacted"`
	Expired    int64 `json:"expired"`
	Trimmed    int64 `json:"trimmed"`
	Tombstones int64 `json:"tombstones"`
}

// Total is the number of records forgotten.
func (r RetainStats) Total() int64 { return r.Compacted + r.Expired + r.Trimmed + r.Tombstones }

// ParseTiers reads "24h:1h,168h:24h": older than 24h keep one per hour, older
// than 7 days one per day. Durations accept a "d" suffix for days.
func ParseTiers(s string) ([]Tier, error) {
	var out []Tier
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		a, w, ok := strings.Cut(part, ":")
		if !ok {
			return nil, fmt.Errorf("tier %q: want AFTER:WINDOW, e.g. 24h:1h", part)
		}
		after, err := ParseDuration(a)
		if err != nil {
			return nil, fmt.Errorf("tier %q: %w", part, err)
		}
		window, err := ParseDuration(w)
		if err != nil || window <= 0 {
			return nil, fmt.Errorf("tier %q: bad window", part)
		}
		out = append(out, Tier{After: after, Window: window})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].After < out[j].After })
	for i := 1; i < len(out); i++ {
		if out[i].Window < out[i-1].Window {
			return nil, fmt.Errorf("tiers must not get finer with age: %s after %s", out[i].Window, out[i-1].Window)
		}
	}
	return out, nil
}

// ParseDuration is time.ParseDuration that also accepts whole days ("7d").
func ParseDuration(s string) (time.Duration, error) {
	s = strings.TrimSpace(s)
	if n, ok := strings.CutSuffix(s, "d"); ok {
		var d int
		if _, err := fmt.Sscanf(n, "%d", &d); err == nil && fmt.Sprint(d) == n {
			return time.Duration(d) * 24 * time.Hour, nil
		}
	}
	return time.ParseDuration(s)
}


// Retain applies the policy: compaction, then age, then version count, then
// tombstones.
func (s *SQLStore) Retain(ctx context.Context, p Policy, now time.Time) (RetainStats, error) {
	var st RetainStats
	var err error
	touched := map[string]struct{}{} // uids that lost records from the middle of a life
	for i, t := range p.Tiers {
		hi := now.Add(-t.After).UnixMilli()
		lo := int64(math.MinInt64 / 2)
		if i+1 < len(p.Tiers) {
			lo = now.Add(-p.Tiers[i+1].After).UnixMilli()
		}
		w := t.Window.Milliseconds()
		// Every change but the newest of its uid in its window. Such a record
		// always has a newer one, so it is never the latest state. (NOT IN
		// over large id sets falls back to a quadratic plan in PostgreSQL once
		// the set outgrows work_mem; an IN over a window function does not.)
		rows, err := s.db.QueryContext(ctx, s.q(`DELETE FROM records WHERE id IN (
 SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY uid, at/? ORDER BY id DESC) AS rn
  FROM records WHERE verb='changed' AND at>=? AND at<?) w WHERE rn > 1) RETURNING uid`), w, lo, hi)
		if err != nil {
			return st, fmt.Errorf("compact tier %d: %w", i, err)
		}
		for rows.Next() {
			var uid string
			if err := rows.Scan(&uid); err != nil {
				rows.Close()
				return st, err
			}
			touched[uid] = struct{}{}
			st.Compacted++
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return st, fmt.Errorf("compact tier %d: %w", i, err)
		}
	}
	if len(touched) > 0 {
		// Records left the middle of these lives: the states before them now
		// last until the next surviving record.
		uids := make([]any, 0, len(touched))
		for uid := range touched {
			uids = append(uids, uid)
		}
		for start := 0; start < len(uids); start += batchRows {
			chunk := uids[start:min(start+batchRows, len(uids))]
			marks := strings.TrimSuffix(strings.Repeat("?,", len(chunk)), ",")
			args := append([]any{Forever, Forever}, chunk...)
			if _, err := s.exec(ctx, repairUntil+` AND uid IN (`+marks+`)`, args...); err != nil {
				return st, fmt.Errorf("repair intervals: %w", err)
			}
		}
	}
	if p.MaxAge > 0 {
		if st.Expired, err = s.Prune(ctx, now.Add(-p.MaxAge)); err != nil {
			return st, fmt.Errorf("expire: %w", err)
		}
		if _, err = s.PruneAudit(ctx, now.Add(-p.MaxAge)); err != nil {
			return st, fmt.Errorf("expire audit: %w", err)
		}
	}
	if p.MaxVersions > 0 {
		st.Trimmed, err = s.exec(ctx, `DELETE FROM records WHERE id IN (
 SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY uid ORDER BY id DESC) AS rn FROM records) v WHERE rn > ?)`, p.MaxVersions)
		if err != nil {
			return st, fmt.Errorf("trim: %w", err)
		}
	}
	if p.TombstoneTTL > 0 {
		st.Tombstones, err = s.exec(ctx, `DELETE FROM records WHERE uid IN (
 SELECT uid FROM records r WHERE verb='died' AND at<? AND NOT EXISTS (SELECT 1 FROM records n WHERE n.uid=r.uid AND n.id>r.id))`, now.Add(-p.TombstoneTTL).UnixMilli())
		if err != nil {
			return st, fmt.Errorf("tombstones: %w", err)
		}
	}
	if st.Total() > 0 && s.d.name == "sqlite" {
		// Give freed pages back to the file system (needs auto_vacuum, set on
		// stores created by this version).
		_, _ = s.db.ExecContext(ctx, `PRAGMA incremental_vacuum`)
	}
	return st, nil
}

// Vacuum gives space freed by retention back to the store.
func (s *SQLStore) Vacuum(ctx context.Context) error {
	if s.d.name == "sqlite" {
		_, err := s.db.ExecContext(ctx, `VACUUM`)
		return err
	}
	_, err := s.db.ExecContext(ctx, `VACUUM (ANALYZE) records`)
	return err
}
