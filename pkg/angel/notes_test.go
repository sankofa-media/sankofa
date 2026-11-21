package angel

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func noteRequest(h http.Handler, method, path, body string, admin bool) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, Prefix+path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	if admin {
		r.Header.Set("Authorization", "Bearer owner")
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
func noteServer(t *testing.T, m Moderator) (*Service, http.Handler) {
	s := newService(t, m)
	return s, (&Server{Svc: s, Clients: NewClients(nil), AdminToken: "owner"}).Handler()
}
func submitTestNote(t *testing.T, h http.Handler, text string) string {
	t.Helper()
	b, _ := json.Marshal(map[string]string{"text": text, "lang": "ru"})
	r := noteRequest(h, "POST", "/notes", string(b), false)
	if r.Code != 202 {
		t.Fatalf("submit %d: %s", r.Code, r.Body)
	}
	var out map[string]string
	json.Unmarshal(r.Body.Bytes(), &out)
	if out["status"] != "received" || out["delete_code"] == "" {
		t.Fatalf("receipt: %v", out)
	}
	return out["delete_code"]
}
func TestNotesLifecycle(t *testing.T) {
	m := &fakeModerator{j: Judgement{Verdict: VerdictPublish, CleanText: "Мы переехали.", Lang: "ru", Translations: Translations{EN: "We moved.", RU: "Мы переехали."}}}
	s, h := noteServer(t, m)
	code := submitTestNote(t, h, "Мы с Анной переехали.")
	if m.calls != 1 {
		t.Fatal("moderator not used")
	}
	var hash string
	if err := s.Store.db.QueryRow(`SELECT delete_hash FROM notes`).Scan(&hash); err != nil || hash != HashCode(code) {
		t.Fatalf("hash: %q %v", hash, err)
	}
	if n, _ := s.Store.Count(context.Background()); n != 0 {
		t.Fatal("notes leaked into words")
	}
	r := noteRequest(h, "GET", "/notes?lang=en", "", false)
	if !strings.Contains(r.Body.String(), "We moved.") || strings.Contains(r.Body.String(), "Анной") || strings.Contains(r.Body.String(), "delete_hash") {
		t.Fatal(r.Body)
	}
	for _, path := range []string{"/admin/notes", "/admin/notes/1"} {
		method := "GET"
		if strings.HasSuffix(path, "/1") {
			method = "POST"
		}
		if r := noteRequest(h, method, path, `{"action":"hide"}`, false); r.Code != 401 {
			t.Fatal(r.Code)
		}
	}
	if r := noteRequest(h, "GET", "/admin/notes", "", true); !strings.Contains(r.Body.String(), `"tr_en":"We moved."`) {
		t.Fatal(r.Body)
	}
	for _, action := range []string{"hide", "publish"} {
		if r := noteRequest(h, "POST", "/admin/notes/1", `{"action":"`+action+`"}`, true); r.Code != 200 {
			t.Fatal(r.Body)
		}
		r := noteRequest(h, "GET", "/notes", "", false)
		if strings.Contains(r.Body.String(), "Мы переехали.") != (action == "publish") {
			t.Fatal(r.Body)
		}
	}
	if r := noteRequest(h, "DELETE", "/notes?code=wrong", "", false); r.Code != 404 {
		t.Fatal(r.Code)
	}
	if r := noteRequest(h, "DELETE", "/notes?code="+code, "", false); r.Code != 200 {
		t.Fatal(r.Body)
	}
	if r := noteRequest(h, "GET", "/notes", "", false); !strings.Contains(r.Body.String(), `"notes":[]`) {
		t.Fatal(r.Body)
	}
}
func TestNotesModeration(t *testing.T) {
	for _, tc := range []struct {
		name, text string
		m          Moderator
		status     Status
		empty      bool
	}{
		{"guard", "contact me at test@example.com", &fakeModerator{j: Judgement{Verdict: VerdictPublish}}, StatusRejected, false},
		{"rules", "Я не хочу жить", Rules{}, StatusCrisis, true},
		{"refusal", "We moved.", &fakeModerator{j: Judgement{Refused: true}}, StatusReview, false},
		{"no model", "We moved.", nil, StatusPending, false},
		{"model reject", "We moved.", &fakeModerator{j: Judgement{Verdict: VerdictReject}}, StatusRejected, false},
		{"clean guard", "We moved.", &fakeModerator{j: Judgement{Verdict: VerdictPublish, CleanText: "https://example.com"}}, StatusRejected, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, h := noteServer(t, tc.m)
			submitTestNote(t, h, tc.text)
			var status, text string
			if err := s.Store.db.QueryRow(`SELECT status,text FROM notes`).Scan(&status, &text); err != nil {
				t.Fatal(err)
			}
			if Status(status) != tc.status || (tc.empty && text != "") {
				t.Fatalf("%s %q", status, text)
			}
			if r := noteRequest(h, "GET", "/notes", "", false); !strings.Contains(r.Body.String(), `"notes":[]`) {
				t.Fatal(r.Body)
			}
			if tc.empty && noteRequest(h, "POST", "/admin/notes/1", `{"action":"publish"}`, true).Code == 200 {
				t.Fatal("empty note published")
			}
		})
	}
}
func TestNotesLimitsAndPagination(t *testing.T) {
	_, h := noteServer(t, Rules{})
	for _, text := range []string{"", strings.Repeat("я", 601)} {
		b, _ := json.Marshal(map[string]string{"text": text})
		if r := noteRequest(h, "POST", "/notes", string(b), false); r.Code != 400 {
			t.Fatal(r.Code)
		}
	}
	for i := 0; i < 5; i++ {
		submitTestNote(t, h, strings.Repeat("я", 600))
	}
	if r := noteRequest(h, "POST", "/notes", `{"text":"six"}`, false); r.Code != 429 {
		t.Fatal(r.Code)
	}
	if r := noteRequest(h, "POST", "/words", `{"text":"six"}`, false); r.Code != 429 {
		t.Fatal("budget not shared", r.Code)
	}
	var page struct {
		Notes []PublicWord `json:"notes"`
		Next  int64        `json:"next"`
	}
	r := noteRequest(h, "GET", "/notes?n=2", "", false)
	json.Unmarshal(r.Body.Bytes(), &page)
	if len(page.Notes) != 2 || page.Notes[0].ID != 5 || page.Notes[1].ID != 4 || page.Next != 4 {
		t.Fatalf("%+v", page)
	}
	r = noteRequest(h, "GET", "/notes?n=2&before=4", "", false)
	json.Unmarshal(r.Body.Bytes(), &page)
	if len(page.Notes) != 2 || page.Notes[0].ID != 3 || page.Next != 2 {
		t.Fatalf("%+v", page)
	}
}
func TestNotesMigrationReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "angel.db")
	s, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	// Simulate an existing service database before notes were added.
	if _, err = s.db.Exec(`DROP TABLE notes`); err != nil {
		t.Fatal(err)
	}
	s.Close()
	s, err = OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	rows, err := s.db.Query(`SELECT text FROM notes`)
	if err != nil {
		t.Fatal(err)
	}
	rows.Close()
}
