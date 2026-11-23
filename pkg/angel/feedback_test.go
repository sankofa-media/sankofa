package angel

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestFeedbackValidation(t *testing.T) {
	for _, tc := range []struct {
		kind, text, contact string
		code                int
	}{
		{"correction", "hello", "", 201}, {"idea", strings.Repeat("界", 4000), strings.Repeat("界", 200), 201},
		{"topic", "hello", "", 201}, {"other", "hello", "", 201}, {"invalid", "hello", "", 400},
		{"other", " \n ", "", 400}, {"other", strings.Repeat("界", 4001), "", 400},
		{"other", "hello", strings.Repeat("界", 201), 400},
	} {
		t.Run(tc.kind+string(rune(tc.code))+tc.text[:min(len(tc.text), 8)], func(t *testing.T) {
			m := &fakeModerator{}
			_, h := noteServer(t, m)
			body, _ := json.Marshal(map[string]any{"kind": tc.kind, "text": tc.text, "contact": tc.contact, "page": map[string]any{"url": "https://sankofa.black/", "viewport": map[string]int{"width": 390, "height": 844}}})
			r := noteRequest(h, "POST", "/feedback", string(body), false)
			if r.Code != tc.code {
				t.Fatalf("got %d: %s", r.Code, r.Body)
			}
			if m.calls != 0 {
				t.Fatal("feedback sent to moderator")
			}
		})
	}
}

func TestFeedbackAdminAndLimit(t *testing.T) {
	_, h := noteServer(t, &fakeModerator{})
	for i := 0; i < 11; i++ {
		r := noteRequest(h, "POST", "/feedback", `{"kind":"idea","text":"hello","contact":"reader","page":{"language":"en"}}`, false)
		want := 201
		if i == 10 {
			want = 429
		}
		if r.Code != want {
			t.Fatalf("request %d: %d", i, r.Code)
		}
	}
	for _, path := range []string{"/admin/feedback", "/admin/feedback/1"} {
		method := "GET"
		if strings.HasSuffix(path, "/1") {
			method = "POST"
		}
		if r := noteRequest(h, method, path, `{"status":"done"}`, false); r.Code != 401 {
			t.Fatal(r.Code)
		}
	}
	r := noteRequest(h, "GET", "/admin/feedback?n=2", "", true)
	var out struct {
		Feedback []Feedback `json:"feedback"`
		Next     int64      `json:"next"`
	}
	if err := json.Unmarshal(r.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if r.Code != 200 || len(out.Feedback) != 2 || out.Feedback[0].ID != 10 || out.Feedback[1].ID != 9 || out.Next != 9 || out.Feedback[0].Status != "open" || out.Feedback[0].Contact != "reader" || out.Feedback[0].Page.Language != "en" {
		t.Fatal(r.Body)
	}
	for _, status := range []string{"done", "open", "invalid"} {
		r := noteRequest(h, "POST", "/admin/feedback/10", `{"status":"`+status+`"}`, true)
		want := 200
		if status == "invalid" {
			want = 400
		}
		if r.Code != want {
			t.Fatal(r.Body)
		}
		if want == 200 {
			r = noteRequest(h, "GET", "/admin/feedback?n=1", "", true)
			json.Unmarshal(r.Body.Bytes(), &out)
			if out.Feedback[0].Status != status {
				t.Fatal(r.Body)
			}
		}
	}
	if r := noteRequest(h, "POST", "/admin/feedback/999", `{"status":"done"}`, true); r.Code != 404 {
		t.Fatal(r.Code)
	}
	if r := noteRequest(h, "POST", "/feedback", `{} {}`, false); r.Code != 400 {
		t.Fatal(r.Code)
	}
}
