package angel

// The owner's review notes: while reading the museum, the owner points at an
// element (or selects a piece of text) and leaves a note on it, typed or
// spoken. Everything here is behind the admin token. Each note keeps where it
// was left (page, scene, viewport, language), how to find the element again
// (a CSS path, the data-* ids around it, its text) and the note itself, so
// whoever acts on it needs nothing else.

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

// Review limits.
const (
	MaxReviewJSON    = 64 << 10 // one note with its locator
	MaxReviewAudio   = 2 << 20  // minutes of compressed speech; the ingress takes 3 MB bodies
	MaxReviewComment = 10000    // runes
	MaxReviews       = 20000    // stored notes, open and done
)

// Review statuses.
const (
	ReviewOpen = "open"
	ReviewDone = "done"
)

const reviewSchema = `
CREATE TABLE IF NOT EXISTS reviews (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  status     TEXT NOT NULL DEFAULT 'open',
  created    TEXT NOT NULL,
  updated    TEXT NOT NULL,
  comment    TEXT NOT NULL DEFAULT '',
  page       TEXT NOT NULL DEFAULT '{}',
  target     TEXT NOT NULL DEFAULT '{}',
  selection  TEXT NOT NULL DEFAULT '',
  audio      TEXT NOT NULL DEFAULT '',
  audio_type TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS reviews_status ON reviews(status);
`

// ReviewPage is where a note was left.
type ReviewPage struct {
	URL       string  `json:"url"`
	Hash      string  `json:"hash"`
	Key       string  `json:"key"` // the page the note belongs to: "museum", "feature:<id>", "<view>:<item>"
	View      string  `json:"view,omitempty"`
	Item      string  `json:"item,omitempty"`
	Scene     string  `json:"scene,omitempty"`
	Chapter   string  `json:"chapter,omitempty"`
	Lang      string  `json:"lang"`
	Theme     string  `json:"theme,omitempty"`
	Device    string  `json:"device"` // phone | tablet | desktop
	Width     int     `json:"width"`
	Height    int     `json:"height"`
	DPR       float64 `json:"dpr"`
	Scroll    float64 `json:"scroll"` // scroll offset of the container the element is in
	UserAgent string  `json:"user_agent,omitempty"`
}

// ReviewRect is an element's box in viewport pixels when the note was left.
type ReviewRect struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	W float64 `json:"w"`
	H float64 `json:"h"`
}

// ReviewTarget is how to find the element again.
type ReviewTarget struct {
	CSS     string            `json:"css"`
	Tag     string            `json:"tag"`
	Data    map[string]string `json:"data,omitempty"`  // data-* ids on the element and its ancestors, nearest first
	Attrs   map[string]string `json:"attrs,omitempty"` // alt, aria-label, title, src, href
	Classes []string          `json:"classes,omitempty"`
	Text    string            `json:"text,omitempty"` // the element's text, shortened
	Rect    *ReviewRect       `json:"rect,omitempty"`
}

// ReviewSelection is the text the owner selected, with what surrounds it.
type ReviewSelection struct {
	Text   string `json:"text"`
	Before string `json:"before,omitempty"`
	After  string `json:"after,omitempty"`
}

// Review is one note.
type Review struct {
	ID        int64            `json:"id"`
	Status    string           `json:"status"`
	Created   string           `json:"created"`
	Updated   string           `json:"updated"`
	Comment   string           `json:"comment"`
	Page      ReviewPage       `json:"page"`
	Target    ReviewTarget     `json:"target"`
	Selection *ReviewSelection `json:"selection,omitempty"`
	Audio     string           `json:"audio,omitempty"` // URL of the voice note
	AudioType string           `json:"audio_type,omitempty"`

	audioFile string
}

// reviewInput is what the page sends.
type reviewInput struct {
	Comment   string           `json:"comment"`
	Page      ReviewPage       `json:"page"`
	Target    ReviewTarget     `json:"target"`
	Selection *ReviewSelection `json:"selection"`
}

func clip(s string, n int) string {
	s = strings.ToValidUTF8(strings.TrimSpace(s), "")
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return string(r[:n])
}

func clipMap(m map[string]string, keys, n int) map[string]string {
	if len(m) == 0 {
		return nil
	}
	names := make([]string, 0, len(m))
	for k := range m {
		names = append(names, k)
	}
	sort.Strings(names)
	out := map[string]string{}
	for _, k := range names {
		if len(out) == keys {
			break
		}
		if k = clip(k, 64); k != "" {
			out[k] = clip(m[k], n)
		}
	}
	return out
}

// clean bounds every field; a note needs a comment or a voice.
func (in *reviewInput) clean(voice bool) error {
	in.Comment = clip(in.Comment, MaxReviewComment)
	if in.Comment == "" && !voice {
		return fmt.Errorf("%w: a note needs text or a voice recording", ErrInput)
	}
	p := &in.Page
	for _, f := range []struct {
		s *string
		n int
	}{{&p.URL, 2000}, {&p.Hash, 2000}, {&p.Key, 200}, {&p.View, 100}, {&p.Item, 200}, {&p.Scene, 200}, {&p.Chapter, 100}, {&p.Lang, 16}, {&p.Theme, 16}, {&p.Device, 16}, {&p.UserAgent, 400}} {
		*f.s = clip(*f.s, f.n)
	}
	if p.Key == "" {
		p.Key = "museum"
	}
	t := &in.Target
	t.CSS, t.Tag, t.Text = clip(t.CSS, 2000), clip(t.Tag, 32), clip(t.Text, 600)
	t.Data, t.Attrs = clipMap(t.Data, 40, 200), clipMap(t.Attrs, 10, 400)
	if len(t.Classes) > 12 {
		t.Classes = t.Classes[:12]
	}
	for i := range t.Classes {
		t.Classes[i] = clip(t.Classes[i], 64)
	}
	if s := in.Selection; s != nil {
		s.Text, s.Before, s.After = clip(s.Text, 4000), clip(s.Before, 400), clip(s.After, 400)
		if s.Text == "" {
			in.Selection = nil
		}
	}
	return nil
}

// --- store ----------------------------------------------------------------

const reviewCols = `id, status, created, updated, comment, page, target, selection, audio, audio_type`

func scanReview(sc interface{ Scan(...any) error }) (Review, error) {
	var r Review
	var page, target, sel string
	if err := sc.Scan(&r.ID, &r.Status, &r.Created, &r.Updated, &r.Comment, &page, &target, &sel, &r.audioFile, &r.AudioType); err != nil {
		return r, err
	}
	_ = json.Unmarshal([]byte(page), &r.Page)
	_ = json.Unmarshal([]byte(target), &r.Target)
	if sel != "" {
		r.Selection = &ReviewSelection{}
		_ = json.Unmarshal([]byte(sel), r.Selection)
	}
	if r.audioFile != "" {
		r.Audio = fmt.Sprintf("%s/review/%d/audio", Prefix, r.ID)
	}
	return r, nil
}

// InsertReview stores a new open note.
func (s *Store) InsertReview(ctx context.Context, in reviewInput, now time.Time) (int64, error) {
	var n int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM reviews`).Scan(&n); err != nil {
		return 0, err
	}
	if n >= MaxReviews {
		return 0, fmt.Errorf("%w: too many notes are kept; delete the done ones", ErrInput)
	}
	page, _ := json.Marshal(in.Page)
	target, _ := json.Marshal(in.Target)
	sel := ""
	if in.Selection != nil {
		b, _ := json.Marshal(in.Selection)
		sel = string(b)
	}
	ts := now.UTC().Format(time.RFC3339)
	res, err := s.db.ExecContext(ctx, `INSERT INTO reviews (status, created, updated, comment, page, target, selection) VALUES (?,?,?,?,?,?,?)`,
		ReviewOpen, ts, ts, in.Comment, string(page), string(target), sel)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// Review returns one note.
func (s *Store) Review(ctx context.Context, id int64) (Review, error) {
	r, err := scanReview(s.db.QueryRowContext(ctx, `SELECT `+reviewCols+` FROM reviews WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return r, ErrNotFound
	}
	return r, err
}

// Reviews lists notes with the given status ("" for all), oldest first.
func (s *Store) Reviews(ctx context.Context, status string) ([]Review, error) {
	q, args := `SELECT `+reviewCols+` FROM reviews ORDER BY id`, []any{}
	if status != "" {
		q, args = `SELECT `+reviewCols+` FROM reviews WHERE status = ? ORDER BY id`, []any{status}
	}
	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Review{}
	for rows.Next() {
		r, err := scanReview(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// UpdateReview changes a note's text and/or status.
func (s *Store) UpdateReview(ctx context.Context, id int64, comment, status *string, now time.Time) error {
	r, err := s.Review(ctx, id)
	if err != nil {
		return err
	}
	if comment != nil {
		r.Comment = *comment
	}
	if status != nil {
		r.Status = *status
	}
	_, err = s.db.ExecContext(ctx, `UPDATE reviews SET comment = ?, status = ?, updated = ? WHERE id = ?`, r.Comment, r.Status, now.UTC().Format(time.RFC3339), id)
	return err
}

func (s *Store) setReviewAudio(ctx context.Context, id int64, file, ctype string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE reviews SET audio = ?, audio_type = ? WHERE id = ?`, file, ctype, id)
	return err
}

// DeleteReview removes a note and returns its audio file name, if any.
func (s *Store) DeleteReview(ctx context.Context, id int64) (string, error) {
	r, err := s.Review(ctx, id)
	if err != nil {
		return "", err
	}
	_, err = s.db.ExecContext(ctx, `DELETE FROM reviews WHERE id = ?`, id)
	return r.audioFile, err
}

// --- HTTP -----------------------------------------------------------------

// ReviewDir is where voice notes are kept.
func (s *Service) ReviewDir() string { return filepath.Join(s.Dir, "review") }

// Voice note types accepted, by the extension they are kept under.
var reviewAudioExt = map[string]string{
	"audio/webm": "webm",
	"audio/ogg":  "ogg",
	"audio/mp4":  "m4a",
	"audio/aac":  "aac",
	"audio/mpeg": "mp3",
	"audio/wav":  "wav",
}

func reviewID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		fail(w, http.StatusNotFound, "no such note")
		return 0, false
	}
	return id, true
}

func reviewStatus(r *http.Request, def string) (string, bool) {
	switch q := r.URL.Query().Get("status"); q {
	case "":
		return def, true
	case "all":
		return "", true
	case ReviewOpen, ReviewDone:
		return q, true
	}
	return "", false
}

func (s *Server) listReviews(w http.ResponseWriter, r *http.Request) {
	st, ok := reviewStatus(r, "")
	if !ok {
		fail(w, http.StatusBadRequest, "status must be open, done or all")
		return
	}
	out, err := s.Svc.Store.Reviews(r.Context(), st)
	if err != nil {
		s.log().Error("review list", "err", err)
		fail(w, http.StatusInternalServerError, "store")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"reviews": out})
}

// exportReviews is the engineer's view: open notes by default, as JSON or,
// with ?format=md, as Markdown.
func (s *Server) exportReviews(w http.ResponseWriter, r *http.Request) {
	st, ok := reviewStatus(r, ReviewOpen)
	if !ok {
		fail(w, http.StatusBadRequest, "status must be open, done or all")
		return
	}
	out, err := s.Svc.Store.Reviews(r.Context(), st)
	if err != nil {
		s.log().Error("review export", "err", err)
		fail(w, http.StatusInternalServerError, "store")
		return
	}
	if r.URL.Query().Get("format") == "md" {
		w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
		io.WriteString(w, ReviewsMarkdown(out, st))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"reviews": out})
}

func (s *Server) createReview(w http.ResponseWriter, r *http.Request) {
	var in reviewInput
	var audio []byte
	var audioType string
	ct, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	switch ct {
	case "application/json":
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, MaxReviewJSON)).Decode(&in); err != nil {
			fail(w, http.StatusBadRequest, "bad JSON")
			return
		}
	case "multipart/form-data":
		r.Body = http.MaxBytesReader(w, r.Body, MaxReviewAudio+MaxReviewJSON+16<<10)
		if err := r.ParseMultipartForm(MaxReviewAudio + MaxReviewJSON); err != nil {
			fail(w, http.StatusRequestEntityTooLarge, "a note with its voice must be at most 2 MB")
			return
		}
		defer r.MultipartForm.RemoveAll()
		note := r.FormValue("note")
		if len(note) > MaxReviewJSON || json.Unmarshal([]byte(note), &in) != nil {
			fail(w, http.StatusBadRequest, "field note must be the note as JSON")
			return
		}
		if f, hdr, err := r.FormFile("audio"); err == nil {
			defer f.Close()
			audioType, _, _ = mime.ParseMediaType(hdr.Header.Get("Content-Type"))
			if _, ok := reviewAudioExt[audioType]; !ok {
				fail(w, http.StatusUnsupportedMediaType, "audio must be webm, ogg, mp4, aac, mpeg or wav")
				return
			}
			data, err := io.ReadAll(io.LimitReader(f, MaxReviewAudio+1))
			if err != nil || len(data) > MaxReviewAudio {
				fail(w, http.StatusRequestEntityTooLarge, "audio must be at most 2 MB")
				return
			}
			if len(data) > 0 {
				audio = data
			}
		}
	default:
		fail(w, http.StatusUnsupportedMediaType, "send JSON or multipart/form-data")
		return
	}
	if err := in.clean(audio != nil); err != nil {
		fail(w, http.StatusBadRequest, strings.TrimPrefix(err.Error(), ErrInput.Error()+": "))
		return
	}
	id, err := s.Svc.Store.InsertReview(r.Context(), in, s.Svc.now())
	if errors.Is(err, ErrInput) {
		fail(w, http.StatusInsufficientStorage, strings.TrimPrefix(err.Error(), ErrInput.Error()+": "))
		return
	} else if err != nil {
		s.log().Error("review create", "err", err)
		fail(w, http.StatusInternalServerError, "store")
		return
	}
	if audio != nil {
		name := fmt.Sprintf("%d.%s", id, reviewAudioExt[audioType])
		dir := s.Svc.ReviewDir()
		err := os.MkdirAll(dir, 0o700)
		if err == nil {
			err = os.WriteFile(filepath.Join(dir, name), audio, 0o600)
		}
		if err == nil {
			err = s.Svc.Store.setReviewAudio(r.Context(), id, name, audioType)
		}
		if err != nil {
			s.log().Error("review audio", "err", err)
			_, _ = s.Svc.Store.DeleteReview(r.Context(), id)
			fail(w, http.StatusInternalServerError, "could not keep the voice note")
			return
		}
	}
	rev, err := s.Svc.Store.Review(r.Context(), id)
	if err != nil {
		fail(w, http.StatusInternalServerError, "store")
		return
	}
	writeJSON(w, http.StatusCreated, rev)
}

func (s *Server) updateReview(w http.ResponseWriter, r *http.Request) {
	id, ok := reviewID(w, r)
	if !ok {
		return
	}
	var in struct {
		Comment *string `json:"comment"`
		Status  *string `json:"status"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, MaxReviewJSON)).Decode(&in); err != nil {
		fail(w, http.StatusBadRequest, "want {comment?, status?: open|done}")
		return
	}
	if in.Status != nil && *in.Status != ReviewOpen && *in.Status != ReviewDone {
		fail(w, http.StatusBadRequest, "status must be open or done")
		return
	}
	if in.Comment != nil {
		c := clip(*in.Comment, MaxReviewComment)
		in.Comment = &c
	}
	err := s.Svc.Store.UpdateReview(r.Context(), id, in.Comment, in.Status, s.Svc.now())
	if errors.Is(err, ErrNotFound) {
		fail(w, http.StatusNotFound, "no such note")
		return
	} else if err != nil {
		s.log().Error("review update", "err", err)
		fail(w, http.StatusInternalServerError, "store")
		return
	}
	rev, err := s.Svc.Store.Review(r.Context(), id)
	if err != nil {
		fail(w, http.StatusInternalServerError, "store")
		return
	}
	writeJSON(w, http.StatusOK, rev)
}

func (s *Server) deleteReview(w http.ResponseWriter, r *http.Request) {
	id, ok := reviewID(w, r)
	if !ok {
		return
	}
	file, err := s.Svc.Store.DeleteReview(r.Context(), id)
	if errors.Is(err, ErrNotFound) {
		fail(w, http.StatusNotFound, "no such note")
		return
	} else if err != nil {
		s.log().Error("review delete", "err", err)
		fail(w, http.StatusInternalServerError, "store")
		return
	}
	if file != "" {
		s.Svc.removeFile(s.Svc.ReviewDir(), file)
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (s *Server) reviewAudio(w http.ResponseWriter, r *http.Request) {
	id, ok := reviewID(w, r)
	if !ok {
		return
	}
	rev, err := s.Svc.Store.Review(r.Context(), id)
	if err != nil || rev.audioFile == "" {
		fail(w, http.StatusNotFound, "no voice note")
		return
	}
	f, err := os.Open(filepath.Join(s.Svc.ReviewDir(), filepath.Base(rev.audioFile)))
	if err != nil {
		fail(w, http.StatusNotFound, "no voice note")
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		fail(w, http.StatusNotFound, "no voice note")
		return
	}
	w.Header().Set("Content-Type", rev.AudioType)
	http.ServeContent(w, r, "", st.ModTime(), f)
}

// ReviewsMarkdown renders notes for reading in a terminal or a chat.
func ReviewsMarkdown(rs []Review, status string) string {
	var b strings.Builder
	what := status
	if what == "" {
		what = "all"
	}
	fmt.Fprintf(&b, "# Review notes: %d %s\n", len(rs), what)
	for _, r := range rs {
		p, t := r.Page, r.Target
		where := p.Key
		if p.Scene != "" {
			where += " · scene " + p.Scene
		}
		fmt.Fprintf(&b, "\n## #%d · %s · %s\n\n", r.ID, where, r.Status)
		fmt.Fprintf(&b, "- Page: %s\n", p.URL)
		fmt.Fprintf(&b, "- Seen on: %s %dx%d @%g, lang %s", p.Device, p.Width, p.Height, p.DPR, p.Lang)
		if p.Theme != "" {
			fmt.Fprintf(&b, ", theme %s", p.Theme)
		}
		b.WriteString("\n")
		fmt.Fprintf(&b, "- Element: `%s` (`%s`)\n", t.Tag, t.CSS)
		if len(t.Data) > 0 {
			keys := make([]string, 0, len(t.Data))
			for k := range t.Data {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			parts := make([]string, 0, len(keys))
			for _, k := range keys {
				parts = append(parts, fmt.Sprintf("data-%s=%q", k, t.Data[k]))
			}
			fmt.Fprintf(&b, "- Ids: %s\n", strings.Join(parts, " "))
		}
		if t.Text != "" {
			fmt.Fprintf(&b, "- Element text: %q\n", t.Text)
		}
		if s := r.Selection; s != nil {
			fmt.Fprintf(&b, "- Selected: %q (before: %q, after: %q)\n", s.Text, s.Before, s.After)
		}
		if r.Audio != "" {
			fmt.Fprintf(&b, "- Voice: %s (%s)\n", r.Audio, r.AudioType)
		}
		fmt.Fprintf(&b, "- Left: %s, updated %s\n", r.Created, r.Updated)
		if r.Comment != "" {
			fmt.Fprintf(&b, "\n%s\n", r.Comment)
		}
	}
	return b.String()
}
