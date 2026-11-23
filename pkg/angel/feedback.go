package angel

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const feedbackSchema = `
CREATE TABLE IF NOT EXISTS feedback (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 kind TEXT NOT NULL, text TEXT NOT NULL, contact TEXT NOT NULL,
 page TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created TEXT NOT NULL
);
`

// Feedback is private correspondence, stored without moderation or client identifiers.
type Feedback struct {
	ID      int64        `json:"id"`
	Kind    string       `json:"kind"`
	Text    string       `json:"text"`
	Contact string       `json:"contact"`
	Page    FeedbackPage `json:"page"`
	Status  string       `json:"status"`
	Created string       `json:"created"`
}

type FeedbackPage struct {
	URL      string `json:"url"`
	Key      string `json:"key"`
	View     string `json:"view"`
	Item     string `json:"item"`
	Scene    string `json:"scene"`
	Language string `json:"language"`
	Theme    string `json:"theme"`
	Viewport struct {
		Width  int `json:"width"`
		Height int `json:"height"`
	} `json:"viewport"`
}

func (s *Server) submitFeedback(w http.ResponseWriter, r *http.Request) {
	var in Feedback
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<10))
	if d.Decode(&in) != nil || d.Decode(new(any)) != io.EOF {
		fail(w, 400, "bad JSON")
		return
	}
	in.Text = strings.TrimSpace(in.Text)
	validKind := in.Kind == "correction" || in.Kind == "idea" || in.Kind == "topic" || in.Kind == "other"
	if !validKind || in.Text == "" || utf8.RuneCountInString(in.Text) > 4000 || utf8.RuneCountInString(in.Contact) > 200 {
		fail(w, 400, "invalid feedback")
		return
	}
	if !s.Clients.Allow(s.client(r), "feedback", 10, time.Hour) {
		fail(w, 429, "slow down")
		return
	}
	page, _ := json.Marshal(in.Page)
	_, err := s.Svc.Store.db.ExecContext(r.Context(), `INSERT INTO feedback (kind,text,contact,page,created) VALUES (?,?,?,?,?)`, in.Kind, in.Text, in.Contact, string(page), s.Svc.now().UTC().Format(time.RFC3339))
	if err != nil {
		fail(w, 500, "store")
		return
	}
	writeJSON(w, 201, map[string]string{"status": "received"})
}

func (s *Server) adminFeedback(w http.ResponseWriter, r *http.Request) {
	n := count(r, 100, 1000)
	rows, err := s.Svc.Store.db.QueryContext(r.Context(), `SELECT id,kind,text,contact,page,status,created FROM feedback WHERE id<? ORDER BY id DESC LIMIT ?`, noteBefore(r), n+1)
	if err != nil {
		fail(w, 500, "store")
		return
	}
	defer rows.Close()
	out := []Feedback{}
	for rows.Next() {
		var f Feedback
		var page string
		if err := rows.Scan(&f.ID, &f.Kind, &f.Text, &f.Contact, &page, &f.Status, &f.Created); err != nil {
			fail(w, 500, "store")
			return
		}
		if json.Unmarshal([]byte(page), &f.Page) != nil {
			fail(w, 500, "store")
			return
		}
		out = append(out, f)
	}
	if rows.Err() != nil {
		fail(w, 500, "store")
		return
	}
	var next int64
	if len(out) > n {
		out = out[:n]
		next = out[n-1].ID
	}
	writeJSON(w, 200, map[string]any{"feedback": out, "next": next})
}

func (s *Server) decideFeedback(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		fail(w, 404, "no such feedback")
		return
	}
	var in struct {
		Status string `json:"status"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&in) != nil || (in.Status != "open" && in.Status != "done") {
		fail(w, 400, "want {status: open|done}")
		return
	}
	res, err := s.Svc.Store.db.ExecContext(r.Context(), `UPDATE feedback SET status=? WHERE id=?`, in.Status, id)
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
		fail(w, 404, "no such feedback")
		return
	}
	writeJSON(w, 200, map[string]string{"status": in.Status})
}
