package angel

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"strings"
	"testing"
)

const reviewNote = `{
  "comment": "Make this line shorter",
  "page": {"url": "https://sankofa.black/#view=feature&item=sea-lion-girls&scene=ring", "hash": "#view=feature&item=sea-lion-girls&scene=ring",
           "key": "feature:sea-lion-girls", "view": "feature", "item": "sea-lion-girls", "scene": "ring", "lang": "ru",
           "device": "phone", "width": 390, "height": 844, "dpr": 3, "scroll": 1200},
  "target": {"css": "article.ft > section[data-scene=\"ring\"] > p:nth-of-type(2)", "tag": "p",
             "data": {"scene": "ring", "block": "b2", "feature-id": "sea-lion-girls"}, "text": "The ring of children sang"},
  "selection": {"text": "sang", "before": "The ring of children ", "after": " in the yard"}
}`

func reviewReq(t *testing.T, method, url, ctype string, body io.Reader, token string) (*http.Response, []byte) {
	t.Helper()
	req, _ := http.NewRequest(method, url, body)
	if ctype != "" {
		req.Header.Set("Content-Type", ctype)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp, b
}

func TestReviewNeedsToken(t *testing.T) {
	_, ts := newServer(t, nil)
	for _, c := range []struct{ method, path, token string }{
		{"GET", "/api/angel/review", ""},
		{"GET", "/api/angel/review", "wrong"},
		{"POST", "/api/angel/review", ""},
		{"GET", "/api/angel/review/export", ""},
		{"PATCH", "/api/angel/review/1", "secret-tokenX"},
		{"DELETE", "/api/angel/review/1", ""},
		{"GET", "/api/angel/review/1/audio", ""},
	} {
		resp, _ := reviewReq(t, c.method, ts.URL+c.path, "application/json", strings.NewReader(reviewNote), c.token)
		if resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s %s with %q: %d, want 401", c.method, c.path, c.token, resp.StatusCode)
		}
	}
	// The token is never accepted from the URL.
	resp, _ := reviewReq(t, "GET", ts.URL+"/api/angel/review?token=secret-token", "", nil, "")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("token in the query: %d", resp.StatusCode)
	}
}

func TestReviewOffWithoutToken(t *testing.T) {
	srv, ts := newServer(t, nil)
	srv.AdminToken = ""
	resp, _ := reviewReq(t, "GET", ts.URL+"/api/angel/review", "", nil, "")
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("%d, want 403", resp.StatusCode)
	}
}

func TestReviewFlow(t *testing.T) {
	_, ts := newServer(t, nil)
	const tok = "secret-token"
	resp, b := reviewReq(t, "POST", ts.URL+"/api/angel/review", "application/json", strings.NewReader(reviewNote), tok)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create: %d %s", resp.StatusCode, b)
	}
	var rev Review
	if err := json.Unmarshal(b, &rev); err != nil {
		t.Fatal(err)
	}
	if rev.ID == 0 || rev.Status != ReviewOpen || rev.Comment != "Make this line shorter" || rev.Page.Scene != "ring" ||
		rev.Target.Data["block"] != "b2" || rev.Selection == nil || rev.Selection.Text != "sang" || rev.Created == "" {
		t.Fatalf("created: %+v", rev)
	}

	// A note with neither text nor voice is refused.
	resp, _ = reviewReq(t, "POST", ts.URL+"/api/angel/review", "application/json", strings.NewReader(`{"comment":"  "}`), tok)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("empty note: %d", resp.StatusCode)
	}
	// Too large a body is refused.
	big := `{"comment":"` + strings.Repeat("a", MaxReviewJSON) + `"}`
	resp, _ = reviewReq(t, "POST", ts.URL+"/api/angel/review", "application/json", strings.NewReader(big), tok)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("big note: %d", resp.StatusCode)
	}

	// A second note, spoken: multipart with the voice.
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	_ = mw.WriteField("note", `{"page":{"key":"museum","url":"https://sankofa.black/"},"target":{"css":"h1","tag":"h1"}}`)
	h := textproto.MIMEHeader{}
	h.Set("Content-Disposition", `form-data; name="audio"; filename="note.webm"`)
	h.Set("Content-Type", "audio/webm;codecs=opus")
	part, _ := mw.CreatePart(h)
	part.Write([]byte("OggS-fake-voice"))
	mw.Close()
	resp, b = reviewReq(t, "POST", ts.URL+"/api/angel/review", mw.FormDataContentType(), &body, tok)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("voice: %d %s", resp.StatusCode, b)
	}
	var voice Review
	_ = json.Unmarshal(b, &voice)
	if voice.Audio == "" || voice.AudioType != "audio/webm" {
		t.Fatalf("voice note: %+v", voice)
	}
	resp, b = reviewReq(t, "GET", ts.URL+voice.Audio, "", nil, tok)
	if resp.StatusCode != http.StatusOK || string(b) != "OggS-fake-voice" || resp.Header.Get("Content-Type") != "audio/webm" {
		t.Fatalf("audio: %d %q %s", resp.StatusCode, b, resp.Header.Get("Content-Type"))
	}

	// List.
	resp, b = reviewReq(t, "GET", ts.URL+"/api/angel/review", "", nil, tok)
	var list struct{ Reviews []Review }
	_ = json.Unmarshal(b, &list)
	if resp.StatusCode != http.StatusOK || len(list.Reviews) != 2 {
		t.Fatalf("list: %d %s", resp.StatusCode, b)
	}

	// Edit and close the first one.
	resp, b = reviewReq(t, "PATCH", ts.URL+"/api/angel/review/1", "application/json", strings.NewReader(`{"comment":"Shorter, and no comma"}`), tok)
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(b), "no comma") {
		t.Fatalf("edit: %d %s", resp.StatusCode, b)
	}
	resp, _ = reviewReq(t, "PATCH", ts.URL+"/api/angel/review/1", "application/json", strings.NewReader(`{"status":"maybe"}`), tok)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad status: %d", resp.StatusCode)
	}
	resp, _ = reviewReq(t, "PATCH", ts.URL+"/api/angel/review/1", "application/json", strings.NewReader(`{"status":"done"}`), tok)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("done: %d", resp.StatusCode)
	}
	resp, _ = reviewReq(t, "PATCH", ts.URL+"/api/angel/review/99", "application/json", strings.NewReader(`{"status":"done"}`), tok)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("missing: %d", resp.StatusCode)
	}

	// The export holds only the open one; ?status=all both; Markdown reads.
	resp, b = reviewReq(t, "GET", ts.URL+"/api/angel/review/export", "", nil, tok)
	_ = json.Unmarshal(b, &list)
	if resp.StatusCode != http.StatusOK || len(list.Reviews) != 1 || list.Reviews[0].ID != voice.ID {
		t.Fatalf("export: %s", b)
	}
	resp, b = reviewReq(t, "GET", ts.URL+"/api/angel/review/export?status=all", "", nil, tok)
	_ = json.Unmarshal(b, &list)
	if len(list.Reviews) != 2 {
		t.Fatalf("export all: %s", b)
	}
	resp, b = reviewReq(t, "GET", ts.URL+"/api/angel/review/export?status=done&format=md", "", nil, tok)
	md := string(b)
	if resp.StatusCode != http.StatusOK || !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/markdown") ||
		!strings.Contains(md, "## #1 · feature:sea-lion-girls · scene ring · done") || !strings.Contains(md, `data-block="b2"`) ||
		!strings.Contains(md, "Shorter, and no comma") || !strings.Contains(md, `Selected: "sang"`) || !strings.Contains(md, "phone 390x844") {
		t.Fatalf("markdown:\n%s", md)
	}

	// Delete removes the note and its voice.
	resp, _ = reviewReq(t, "DELETE", ts.URL+"/api/angel/review/2", "", nil, tok)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("delete: %d", resp.StatusCode)
	}
	resp, _ = reviewReq(t, "GET", ts.URL+voice.Audio, "", nil, tok)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("audio after delete: %d", resp.StatusCode)
	}
	resp, _ = reviewReq(t, "DELETE", ts.URL+"/api/angel/review/2", "", nil, tok)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("delete twice: %d", resp.StatusCode)
	}
}

func TestReviewRefusesOtherAudio(t *testing.T) {
	_, ts := newServer(t, nil)
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	_ = mw.WriteField("note", `{"comment":"x"}`)
	h := textproto.MIMEHeader{}
	h.Set("Content-Disposition", `form-data; name="audio"; filename="x.html"`)
	h.Set("Content-Type", "text/html")
	part, _ := mw.CreatePart(h)
	part.Write([]byte("<script>"))
	mw.Close()
	resp, _ := reviewReq(t, "POST", ts.URL+"/api/angel/review", mw.FormDataContentType(), &body, "secret-token")
	if resp.StatusCode != http.StatusUnsupportedMediaType {
		t.Fatalf("%d", resp.StatusCode)
	}
}
