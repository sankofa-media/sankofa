package angel

import (
	"crypto/subtle"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Prefix is where the service lives on the museum's host.
const Prefix = "/api/angel"

// Rate limits per client (an HMAC of the IP under a daily salt).
const (
	WordsPerHour   = 5
	TouchesPer10s  = 120 // heartbeats plus moves of a finger
	ReportsPerHour = 20
	StreamsPerIP   = 6
	MaxWatchers    = 5000
	MaxAudioBytes  = 2 << 20
	presenceTick   = 150 * time.Millisecond
	presenceKeepUp = 15 * time.Second
	sweepEvery     = 10 * time.Minute
)

//go:embed admin.html
var adminPage []byte

// Server is the HTTP face of the service.
type Server struct {
	Svc        *Service
	Presence   *Presence
	Clients    *Clients
	AdminToken string
	// IPHeader is the header the ingress puts the client address in
	// (X-Real-IP for ingress-nginx); empty means the connection's address.
	IPHeader string
	Log      *slog.Logger

	mu      sync.Mutex
	streams map[string]int // open presence streams per client key
}

// Handler returns the routes.
func (s *Server) Handler() http.Handler {
	m := http.NewServeMux()
	m.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { io.WriteString(w, "ok\n") })
	m.HandleFunc("GET "+Prefix+"/healthz", func(w http.ResponseWriter, _ *http.Request) { io.WriteString(w, "ok\n") })
	m.HandleFunc("GET "+Prefix+"/presence", s.presence)
	m.HandleFunc("POST "+Prefix+"/touch", s.touch)
	m.HandleFunc("POST "+Prefix+"/words", s.submit)
	m.HandleFunc("GET "+Prefix+"/words", s.sample)
	m.HandleFunc("DELETE "+Prefix+"/words", s.deleteByCode)
	m.HandleFunc("GET "+Prefix+"/words/status", s.status)
	m.HandleFunc("POST "+Prefix+"/words/{id}/report", s.report)
	m.HandleFunc("GET "+Prefix+"/count", s.count)
	m.HandleFunc("GET "+Prefix+"/whispers", s.whispers)
	m.HandleFunc("GET "+Prefix+"/whispers/{file}", s.whisperFile)
	m.HandleFunc("POST "+Prefix+"/pulses", s.submitPulse)
	m.HandleFunc("GET "+Prefix+"/pulses", s.samplePulses)
	m.HandleFunc("GET "+Prefix+"/pulses/count", s.countPulses)
	m.HandleFunc("DELETE "+Prefix+"/pulses", s.deletePulse)
	m.HandleFunc("GET "+Prefix+"/admin/{$}", s.adminHTML)
	m.HandleFunc("GET "+Prefix+"/admin/pulses", s.admin(s.adminPulses))
	m.HandleFunc("POST "+Prefix+"/admin/pulses/{id}", s.admin(s.decidePulse))
	m.HandleFunc("GET "+Prefix+"/admin/queue", s.admin(s.queue))
	m.HandleFunc("POST "+Prefix+"/admin/words/{id}", s.admin(s.decide))
	return headers(m)
}

func headers(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

// Sweep periodically forgets expired rate-limit windows until stop closes.
func (s *Server) Sweep(stop <-chan struct{}) {
	t := time.NewTicker(sweepEvery)
	defer t.Stop()
	for {
		select {
		case <-stop:
			return
		case <-t.C:
			s.Clients.Sweep(time.Hour)
		}
	}
}

func (s *Server) log() *slog.Logger {
	if s.Log != nil {
		return s.Log
	}
	return slog.Default()
}

// client returns the anonymous key of the request's client. The address is
// used only to compute the key and is never logged or stored.
func (s *Server) client(r *http.Request) string {
	ip := ""
	if s.IPHeader != "" {
		ip = strings.TrimSpace(strings.Split(r.Header.Get(s.IPHeader), ",")[0])
	}
	if ip == "" {
		ip, _, _ = net.SplitHostPort(r.RemoteAddr)
		if ip == "" {
			ip = r.RemoteAddr
		}
	}
	return s.Clients.Key(ip)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

// --- presence -------------------------------------------------------------

var tabID = regexp.MustCompile(`^[A-Za-z0-9_-]{8,64}$`)

func (s *Server) touch(w http.ResponseWriter, r *http.Request) {
	if !s.Clients.Allow(s.client(r), "touch", TouchesPer10s, 10*time.Second) {
		fail(w, http.StatusTooManyRequests, "slow down")
		return
	}
	var in struct {
		ID    string  `json:"id"`
		State string  `json:"state"`
		X     float64 `json:"x"`
		Y     float64 `json:"y"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&in); err != nil || !tabID.MatchString(in.ID) {
		fail(w, http.StatusBadRequest, "want {id, state: down|up, x, y}")
		return
	}
	var down bool
	switch in.State {
	case "down":
		down = true
	case "up":
	default:
		fail(w, http.StatusBadRequest, "state must be down or up")
		return
	}
	if !s.Presence.Touch(in.ID, s.Clients.Opaque(in.ID), down, in.X, in.Y) {
		fail(w, http.StatusServiceUnavailable, "too many hands right now")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) presence(w http.ResponseWriter, r *http.Request) {
	fl, ok := w.(http.Flusher)
	if !ok {
		fail(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	key := s.client(r)
	s.mu.Lock()
	if s.streams == nil {
		s.streams = map[string]int{}
	}
	if s.streams[key] >= StreamsPerIP {
		s.mu.Unlock()
		fail(w, http.StatusTooManyRequests, "too many streams")
		return
	}
	s.streams[key]++
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		if s.streams[key]--; s.streams[key] <= 0 {
			delete(s.streams, key)
		}
		s.mu.Unlock()
	}()
	done, ok := s.Presence.Watch(MaxWatchers)
	if !ok {
		fail(w, http.StatusServiceUnavailable, "too many watchers")
		return
	}
	defer done()

	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	io.WriteString(w, "retry: 3000\n\n")
	fl.Flush()

	tick := time.NewTicker(presenceTick)
	defer tick.Stop()
	var last uint64
	sent := time.Time{}
	for first := true; ; first = false {
		snap, v := s.Presence.Snapshot()
		if first || v != last {
			data, _ := json.Marshal(snap)
			if _, err := fmt.Fprintf(w, "event: presence\ndata: %s\n\n", data); err != nil {
				return
			}
			fl.Flush()
			last, sent = v, time.Now()
		} else if time.Since(sent) > presenceKeepUp {
			if _, err := io.WriteString(w, ": keep-alive\n\n"); err != nil {
				return
			}
			fl.Flush()
			sent = time.Now()
		}
		select {
		case <-r.Context().Done():
			return
		case <-tick.C:
		}
	}
}

// --- words ----------------------------------------------------------------

func (s *Server) submit(w http.ResponseWriter, r *http.Request) {
	var sub Submission
	ct, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	switch ct {
	case "application/json":
		var in struct {
			Text      string `json:"text"`
			Lang      string `json:"lang"`
			KeepVoice bool   `json:"keep_voice"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&in); err != nil {
			fail(w, http.StatusBadRequest, "bad JSON")
			return
		}
		sub = Submission{Text: in.Text, Lang: in.Lang}
	case "multipart/form-data":
		r.Body = http.MaxBytesReader(w, r.Body, MaxAudioBytes+64<<10)
		if err := r.ParseMultipartForm(MaxAudioBytes + 64<<10); err != nil {
			fail(w, http.StatusRequestEntityTooLarge, "audio must be at most 2 MB")
			return
		}
		defer r.MultipartForm.RemoveAll()
		sub.Text, sub.Lang = r.FormValue("text"), r.FormValue("lang")
		sub.KeepVoice, _ = strconv.ParseBool(r.FormValue("keep_voice"))
		if f, hdr, err := r.FormFile("audio"); err == nil {
			defer f.Close()
			if hdr.Size > MaxAudioBytes {
				fail(w, http.StatusRequestEntityTooLarge, "audio must be at most 2 MB")
				return
			}
			data, err := io.ReadAll(io.LimitReader(f, MaxAudioBytes+1))
			if err != nil || len(data) > MaxAudioBytes {
				fail(w, http.StatusRequestEntityTooLarge, "audio must be at most 2 MB")
				return
			}
			sub.Audio = data
		}
	default:
		fail(w, http.StatusUnsupportedMediaType, "send JSON or multipart/form-data")
		return
	}
	if !s.Clients.Allow(s.client(r), "words", WordsPerHour, time.Hour) {
		fail(w, http.StatusTooManyRequests, "you have left many words already; come back later")
		return
	}
	code, err := s.Svc.Submit(r.Context(), sub)
	switch {
	case errors.Is(err, ErrInput):
		fail(w, http.StatusBadRequest, strings.TrimPrefix(err.Error(), ErrInput.Error()+": "))
		return
	case err != nil:
		s.log().Error("angel submit", "err", err)
		fail(w, http.StatusInternalServerError, "could not keep the words")
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "pending", "delete_code": code})
}

func count(r *http.Request, def, max int) int {
	n, err := strconv.Atoi(r.URL.Query().Get("n"))
	if err != nil || n <= 0 {
		return def
	}
	return min(n, max)
}

// PublicWord is a word as readers see it.
type PublicWord struct {
	ID          int64  `json:"id"`
	Text        string `json:"text"`
	Lang        string `json:"lang"`
	Translation string `json:"translation"`
	Theme       string `json:"theme"`
}

// Translate picks the translation of w into lang, or "".
func Translate(w Word, lang string) string {
	base := strings.ToLower(strings.SplitN(lang, "-", 2)[0])
	if base == "" {
		return ""
	}
	if strings.EqualFold(strings.SplitN(w.Lang, "-", 2)[0], base) {
		return w.Text
	}
	switch base {
	case "en":
		return w.TrEN
	case "ru":
		return w.TrRU
	}
	return ""
}

func (s *Server) sample(w http.ResponseWriter, r *http.Request) {
	words, err := s.Svc.Store.Sample(r.Context(), count(r, 40, 200))
	if err != nil {
		s.log().Error("angel sample", "err", err)
		fail(w, http.StatusInternalServerError, "store")
		return
	}
	lang := r.URL.Query().Get("lang")
	out := make([]PublicWord, 0, len(words))
	for _, x := range words {
		out = append(out, PublicWord{ID: x.ID, Text: x.Text, Lang: x.Lang, Translation: Translate(x, lang), Theme: x.Theme})
	}
	writeJSON(w, http.StatusOK, map[string]any{"words": out})
}

func (s *Server) count(w http.ResponseWriter, r *http.Request) {
	n, err := s.Svc.Store.Count(r.Context())
	if err != nil {
		fail(w, http.StatusInternalServerError, "store")
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"count": n})
}

func (s *Server) whispers(w http.ResponseWriter, r *http.Request) {
	words, err := s.Svc.Store.Whispers(r.Context(), count(r, 8, 50))
	if err != nil {
		fail(w, http.StatusInternalServerError, "store")
		return
	}
	urls := make([]string, 0, len(words))
	for _, x := range words {
		urls = append(urls, Prefix+"/whispers/"+x.Whisper)
	}
	writeJSON(w, http.StatusOK, map[string]any{"whispers": urls})
}

var whisperName = regexp.MustCompile(`^([0-9]+)\.mp3$`)

func (s *Server) whisperFile(w http.ResponseWriter, r *http.Request) {
	m := whisperName.FindStringSubmatch(r.PathValue("file"))
	if m == nil {
		http.NotFound(w, r)
		return
	}
	id, _ := strconv.ParseInt(m[1], 10, 64)
	word, err := s.Svc.Store.Get(r.Context(), id)
	if err != nil || word.Status != StatusPublished || word.Whisper != m[0] {
		http.NotFound(w, r)
		return
	}
	f, err := os.Open(filepath.Join(s.Svc.WhisperDir(), word.Whisper))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "audio/mpeg")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	http.ServeContent(w, r, "", st.ModTime(), f)
}

func (s *Server) status(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("code")
	if code == "" {
		fail(w, http.StatusBadRequest, "code required")
		return
	}
	word, err := s.Svc.Store.ByCode(r.Context(), code)
	if errors.Is(err, ErrNotFound) {
		fail(w, http.StatusNotFound, "no such code")
		return
	} else if err != nil {
		fail(w, http.StatusInternalServerError, "store")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": word.Status.Public()})
}

func (s *Server) deleteByCode(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("code")
	if code == "" {
		fail(w, http.StatusBadRequest, "code required")
		return
	}
	// Guessing codes is pointless (75 random bits), but limit it anyway.
	if !s.Clients.Allow(s.client(r), "delete", 30, time.Hour) {
		fail(w, http.StatusTooManyRequests, "slow down")
		return
	}
	err := s.Svc.DeleteByCode(r.Context(), code)
	if errors.Is(err, ErrNotFound) {
		fail(w, http.StatusNotFound, "no such code")
		return
	} else if err != nil {
		fail(w, http.StatusInternalServerError, "store")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (s *Server) report(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	key := s.client(r)
	if !s.Clients.Allow(key, "report", ReportsPerHour, time.Hour) {
		fail(w, http.StatusTooManyRequests, "slow down")
		return
	}
	if !s.Clients.Report(key, id) {
		// The same reader reporting twice counts once.
		writeJSON(w, http.StatusOK, map[string]string{"status": "reported"})
		return
	}
	_, err = s.Svc.Report(r.Context(), id)
	if errors.Is(err, ErrNotFound) {
		fail(w, http.StatusNotFound, "no such word")
		return
	} else if err != nil {
		fail(w, http.StatusInternalServerError, "store")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "reported"})
}

// --- owner ----------------------------------------------------------------

func (s *Server) admin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.AdminToken == "" {
			fail(w, http.StatusForbidden, "moderation is off: ANGEL_ADMIN_TOKEN is not set")
			return
		}
		got, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || subtle.ConstantTimeCompare([]byte(got), []byte(s.AdminToken)) != 1 {
			w.Header().Set("WWW-Authenticate", `Bearer realm="angel"`)
			fail(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		next(w, r)
	}
}

func (s *Server) adminHTML(w http.ResponseWriter, _ *http.Request) {
	h := w.Header()
	h.Set("Content-Type", "text/html; charset=utf-8")
	h.Set("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; media-src 'self'; frame-ancestors 'none'")
	w.Write(adminPage)
}

// QueueItem is a word as the owner sees it.
type QueueItem struct {
	ID      int64  `json:"id"`
	Text    string `json:"text"`
	Lang    string `json:"lang"`
	Theme   string `json:"theme"`
	TrEN    string `json:"tr_en"`
	TrRU    string `json:"tr_ru"`
	Status  Status `json:"status"`
	Reason  string `json:"reason"`
	Day     string `json:"day"`
	Reports int    `json:"reports"`
	Voice   bool   `json:"voice"`
}

func (s *Server) queue(w http.ResponseWriter, r *http.Request) {
	st := []Status{StatusPending, StatusReview, StatusReported}
	if q := r.URL.Query().Get("status"); q != "" {
		st = nil
		for _, x := range strings.Split(q, ",") {
			st = append(st, Status(strings.TrimSpace(x)))
		}
	}
	words, err := s.Svc.Store.ByStatus(r.Context(), count(r, 200, 1000), st...)
	if err != nil {
		fail(w, http.StatusInternalServerError, "store")
		return
	}
	out := make([]QueueItem, 0, len(words))
	for _, x := range words {
		out = append(out, QueueItem{x.ID, x.Text, x.Lang, x.Theme, x.TrEN, x.TrRU, x.Status, x.Reason, x.Day, x.Reports, x.Whisper != ""})
	}
	writeJSON(w, http.StatusOK, map[string]any{"words": out})
}

func (s *Server) decide(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	var in struct {
		Action string `json:"action"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&in); err != nil {
		fail(w, http.StatusBadRequest, "want {action: publish|hide}")
		return
	}
	word, err := s.Svc.Decide(r.Context(), id, in.Action)
	switch {
	case errors.Is(err, ErrNotFound):
		fail(w, http.StatusNotFound, "no such word")
	case errors.Is(err, ErrInput):
		fail(w, http.StatusBadRequest, strings.TrimPrefix(err.Error(), ErrInput.Error()+": "))
	case err != nil:
		fail(w, http.StatusInternalServerError, "store")
	default:
		writeJSON(w, http.StatusOK, map[string]string{"status": string(word.Status)})
	}
}
