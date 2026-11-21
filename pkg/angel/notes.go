package angel

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const MaxNoteRunes = 600
const noteSchema = `
CREATE TABLE IF NOT EXISTS notes (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 text TEXT NOT NULL, lang TEXT NOT NULL, tr_en TEXT NOT NULL, tr_ru TEXT NOT NULL,
 status TEXT NOT NULL, reason TEXT NOT NULL, day TEXT NOT NULL,
 delete_hash TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS notes_status_id ON notes(status, id);
`

// Reuse the moderation value and scanner without mixing the two collections.
const noteCols = `id, text, lang, '' AS theme, tr_en, tr_ru, status, reason, day, 0, 0, '', ''`

func (s *Server) submitNote(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Text string `json:"text"`
		Lang string `json:"lang"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&in); err != nil {
		fail(w, 400, "bad JSON")
		return
	}
	in.Text = Normalize(in.Text)
	if in.Text == "" || utf8.RuneCountInString(in.Text) > MaxNoteRunes {
		fail(w, 400, "text must contain 1 to 600 characters")
		return
	}
	// Share the words budget: switching collections must not bypass the limit.
	if !s.Clients.Allow(s.client(r), "words", WordsPerHour, time.Hour) {
		fail(w, 429, "slow down")
		return
	}
	note := Word{Text: in.Text, Lang: cleanLang(in.Lang)}
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	s.Svc.judge(ctx, &note)
	if note.Status == StatusCrisis {
		note.Text, note.TrEN, note.TrRU = "", "", ""
	}
	code := NewDeleteCode()
	_, err := s.Svc.Store.db.ExecContext(r.Context(), `INSERT INTO notes (text,lang,tr_en,tr_ru,status,reason,day,delete_hash) VALUES (?,?,?,?,?,?,?,?)`,
		note.Text, note.Lang, note.TrEN, note.TrRU, note.Status, note.Reason, s.Svc.now().UTC().Format(time.DateOnly), HashCode(code))
	if err != nil {
		fail(w, 500, "store")
		return
	}
	// All filter outcomes have the same acknowledgement.
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "received", "delete_code": code})
}

func noteBefore(r *http.Request) int64 {
	n, _ := strconv.ParseInt(r.URL.Query().Get("before"), 10, 64)
	if n <= 0 {
		return 1<<63 - 1
	}
	return n
}

func (s *Server) listNotes(w http.ResponseWriter, r *http.Request) {
	n := count(r, 20, 100)
	notes, err := s.Svc.Store.query(r.Context(), `SELECT `+noteCols+` FROM notes WHERE status=? AND id<? ORDER BY id DESC LIMIT ?`, StatusPublished, noteBefore(r), n+1)
	if err != nil {
		fail(w, 500, "store")
		return
	}
	var next int64
	if len(notes) > n {
		notes = notes[:n]
		next = notes[n-1].ID
	}
	out := make([]PublicWord, 0, len(notes))
	for _, x := range notes {
		out = append(out, PublicWord{ID: x.ID, Text: x.Text, Lang: x.Lang, Translation: Translate(x, r.URL.Query().Get("lang"))})
	}
	writeJSON(w, 200, map[string]any{"notes": out, "next": next})
}

func (s *Server) deleteNote(w http.ResponseWriter, r *http.Request) {
	code := strings.TrimSpace(r.URL.Query().Get("code"))
	if code == "" {
		fail(w, 400, "code required")
		return
	}
	if !s.Clients.Allow(s.client(r), "delete", 30, time.Hour) {
		fail(w, 429, "slow down")
		return
	}
	res, err := s.Svc.Store.db.ExecContext(r.Context(), `DELETE FROM notes WHERE delete_hash=?`, HashCode(code))
	if err != nil {
		fail(w, 500, "store")
		return
	}
	n, err := res.RowsAffected()
	if err != nil {
		fail(w, 500, "store")
		return
	}
	if n == 0 {
		fail(w, 404, "no such code")
		return
	}
	writeJSON(w, 200, map[string]string{"status": "deleted"})
}

func (s *Server) adminNotes(w http.ResponseWriter, r *http.Request) {
	n := count(r, 100, 1000)
	notes, err := s.Svc.Store.query(r.Context(), `SELECT `+noteCols+` FROM notes WHERE id<? ORDER BY id DESC LIMIT ?`, noteBefore(r), n+1)
	if err != nil {
		fail(w, 500, "store")
		return
	}
	var next int64
	if len(notes) > n {
		notes = notes[:n]
		next = notes[n-1].ID
	}
	out := make([]QueueItem, 0, len(notes))
	for _, x := range notes {
		out = append(out, QueueItem{ID: x.ID, Text: x.Text, Lang: x.Lang, TrEN: x.TrEN, TrRU: x.TrRU, Status: x.Status, Reason: x.Reason, Day: x.Day})
	}
	writeJSON(w, 200, map[string]any{"notes": out, "next": next})
}

func (s *Server) decideNote(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		fail(w, 404, "no such note")
		return
	}
	var in struct {
		Action string `json:"action"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&in) != nil || (in.Action != "publish" && in.Action != "hide") {
		fail(w, 400, "want {action: publish|hide}")
		return
	}
	status := StatusHidden
	if in.Action == "publish" {
		status = StatusPublished
	}
	res, err := s.Svc.Store.db.ExecContext(r.Context(), `UPDATE notes SET status=?,reason=? WHERE id=? AND (?!='published' OR (text!='' AND status!='crisis'))`, status, "owner: "+in.Action, id, status)
	if err != nil {
		fail(w, 500, "store")
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		fail(w, 404, "note unavailable")
		return
	}
	writeJSON(w, 200, map[string]string{"status": string(status)})
}
