package angel

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

// Limits of what a reader may leave.
const (
	MaxTextRunes       = 280
	MaxTranscriptRunes = 600 // thirty seconds of speech
	ReportsToHide      = 3
)

// Service is the chorus: it takes words in, sends them through transcription
// and the filter, and keeps them.
type Service struct {
	Store       *Store
	Dir         string      // data directory: audio/ and whispers/ live here
	Moderator   Moderator   // nil: every word waits for the owner
	Transcriber Transcriber // nil: voice is not accepted
	Audio       Audio
	Log         *slog.Logger
	Now         func() time.Time
	Timeout     time.Duration // per word

	jobs chan int64
	wg   sync.WaitGroup
}

// ErrInput is a reader mistake (empty, too long, bad audio).
var ErrInput = errors.New("bad input")

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

func (s *Service) log() *slog.Logger {
	if s.Log != nil {
		return s.Log
	}
	return slog.Default()
}

// AudioDir and WhisperDir are where voices live while they exist.
func (s *Service) AudioDir() string   { return filepath.Join(s.Dir, "audio") }
func (s *Service) WhisperDir() string { return filepath.Join(s.Dir, "whispers") }

// Start creates the directories, starts the worker and re-queues words a
// restart interrupted.
func (s *Service) Start(ctx context.Context) error {
	for _, d := range []string{s.AudioDir(), s.WhisperDir()} {
		if err := os.MkdirAll(d, 0o700); err != nil {
			return err
		}
	}
	if s.Timeout == 0 {
		s.Timeout = 3 * time.Minute
	}
	s.jobs = make(chan int64, 256)
	backlog, err := s.Store.ByStatus(ctx, 10000, StatusQueued)
	if err != nil {
		return err
	}
	if s.Moderator != nil {
		// Words that waited only because there was no key go through now.
		waiting, err := s.Store.ByStatus(ctx, 10000, StatusPending)
		if err != nil {
			return err
		}
		backlog = append(backlog, waiting...)
	}
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		for _, w := range backlog {
			s.process(ctx, w.ID)
		}
		for {
			select {
			case <-ctx.Done():
				return
			case id := <-s.jobs:
				s.process(ctx, id)
			}
		}
	}()
	return nil
}

// Wait waits for the worker to stop after its context is cancelled.
func (s *Service) Wait() { s.wg.Wait() }

// Submission is what a reader sends.
type Submission struct {
	Text      string
	Lang      string
	KeepVoice bool
	Audio     []byte // optional voice recording
}

// Submit stores a word as queued and hands it to the worker. It returns the
// one-time delete code; only its hash is kept.
func (s *Service) Submit(ctx context.Context, sub Submission) (string, error) {
	text := Normalize(sub.Text)
	if utf8.RuneCountInString(text) > MaxTextRunes {
		return "", fmt.Errorf("%w: text longer than %d characters", ErrInput, MaxTextRunes)
	}
	if text == "" && len(sub.Audio) == 0 {
		return "", fmt.Errorf("%w: nothing to keep", ErrInput)
	}
	if len(sub.Audio) > 0 && (s.Transcriber == nil || s.Audio == nil) {
		return "", fmt.Errorf("%w: voice is not accepted right now", ErrInput)
	}
	w := Word{Text: text, Lang: cleanLang(sub.Lang), KeepVoice: sub.KeepVoice && len(sub.Audio) > 0}
	if len(sub.Audio) > 0 {
		f, err := os.CreateTemp(s.AudioDir(), "in-*")
		if err != nil {
			return "", err
		}
		_, werr := f.Write(sub.Audio)
		cerr := f.Close()
		if err := errors.Join(werr, cerr); err != nil {
			os.Remove(f.Name())
			return "", err
		}
		w.Audio = filepath.Base(f.Name())
	}
	code := NewDeleteCode()
	id, err := s.Store.Insert(ctx, w, code, s.now())
	if err != nil {
		if w.Audio != "" {
			os.Remove(filepath.Join(s.AudioDir(), w.Audio))
		}
		return "", err
	}
	select {
	case s.jobs <- id:
	default:
		// The queue is full; the word stays queued and is picked up on the
		// next start. Nothing is lost.
		s.log().Warn("angel queue full", "id", id)
	}
	return code, nil
}

func cleanLang(l string) string {
	l = strings.TrimSpace(l)
	if len(l) > 16 {
		return ""
	}
	for _, r := range l {
		if !(r == '-' || r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9') {
			return ""
		}
	}
	return l
}

func (s *Service) removeFile(dir, name string) {
	if name == "" {
		return
	}
	if err := os.Remove(filepath.Join(dir, filepath.Base(name))); err != nil && !os.IsNotExist(err) {
		s.log().Warn("angel remove", "err", err)
	}
}

// process carries one word to its verdict.
func (s *Service) process(parent context.Context, id int64) {
	ctx, cancel := context.WithTimeout(parent, s.Timeout)
	defer cancel()
	w, err := s.Store.Get(ctx, id)
	if err != nil {
		if !errors.Is(err, ErrNotFound) {
			s.log().Error("angel get", "id", id, "err", err)
		}
		return
	}
	if w.Status != StatusQueued && w.Status != StatusPending {
		return
	}
	if w.Audio != "" {
		s.hear(ctx, &w)
	}
	if w.Status == StatusRejected {
		s.save(ctx, w)
		return
	}
	s.judge(ctx, &w)
	if w.Status != StatusPublished && w.Status != StatusPending && w.Status != StatusReview {
		s.removeFile(s.WhisperDir(), w.Whisper)
		w.Whisper = ""
	}
	if w.Status == StatusCrisis {
		// The most private words of all: not kept, only the verdict is.
		w.Text, w.TrEN, w.TrRU = "", "", ""
	}
	s.save(ctx, w)
}

func (s *Service) save(ctx context.Context, w Word) {
	// Saving must not be lost to the per-word timeout.
	if err := s.Store.Update(context.WithoutCancel(ctx), w); err != nil {
		s.log().Error("angel update", "id", w.ID, "err", err)
	}
}

// hear transcribes the recording and, when the reader asked, makes a whisper
// of it. The original is deleted in every case.
func (s *Service) hear(ctx context.Context, w *Word) {
	orig := filepath.Join(s.AudioDir(), filepath.Base(w.Audio))
	defer func() {
		s.removeFile(s.AudioDir(), w.Audio)
		w.Audio = ""
	}()
	if s.Transcriber == nil || s.Audio == nil {
		w.Status, w.Reason = StatusRejected, "voice is not accepted"
		return
	}
	wav := orig + ".wav"
	defer os.Remove(wav)
	if err := s.Audio.ToWAV(ctx, orig, wav); err != nil {
		s.log().Warn("angel decode", "id", w.ID, "err", err)
		w.Status, w.Reason = StatusRejected, "audio could not be decoded"
		return
	}
	said, err := s.Transcriber.Transcribe(ctx, wav)
	if err != nil {
		s.log().Warn("angel transcribe", "id", w.ID, "err", err)
		w.Status, w.Reason = StatusRejected, "transcription failed"
		return
	}
	if r := []rune(said); len(r) > MaxTranscriptRunes {
		said = string(r[:MaxTranscriptRunes])
	}
	switch {
	case said == "" && w.Text == "":
		w.Status, w.Reason = StatusRejected, "nothing heard"
		return
	case w.Text == "":
		w.Text = said
	case said != "":
		w.Text = w.Text + "\n" + said
	}
	if w.KeepVoice {
		name := fmt.Sprintf("%d.mp3", w.ID)
		if err := s.Audio.Whisper(ctx, orig, filepath.Join(s.WhisperDir(), name)); err != nil {
			s.log().Warn("angel whisper", "id", w.ID, "err", err)
			s.removeFile(s.WhisperDir(), name)
		} else {
			w.Whisper = name
		}
	}
}

// judge runs the pre-filter and the model.
func (s *Service) judge(ctx context.Context, w *Word) {
	if why := Guard(w.Text); why != "" {
		w.Status, w.Reason = StatusRejected, "pre-filter: "+why
		return
	}
	if s.Moderator == nil {
		w.Status, w.Reason = StatusPending, "no moderator: waits for the owner"
		return
	}
	j, err := s.Moderator.Moderate(ctx, w.Text, w.Lang)
	if err != nil {
		s.log().Warn("angel moderate", "id", w.ID, "err", err)
		w.Status, w.Reason = StatusPending, "moderation failed: waits for the owner"
		return
	}
	w.Reason = j.Reason
	if j.Lang != "" {
		w.Lang = cleanLang(j.Lang)
	}
	w.Theme = j.Theme
	switch {
	case j.Refused:
		w.Status = StatusReview
	case j.Verdict == VerdictCrisis:
		w.Status = StatusCrisis
	case j.Verdict == VerdictPublish:
		clean := j.CleanText
		if clean == "" {
			clean = w.Text
		}
		// The model's cleaning must not smuggle in what the guard refuses.
		if why := Guard(clean); why != "" {
			w.Status, w.Reason = StatusRejected, "pre-filter after cleaning: "+why
			return
		}
		w.Text, w.TrEN, w.TrRU = clean, j.Translations.EN, j.Translations.RU
		w.Status = StatusPublished
	default:
		w.Status = StatusRejected
	}
}

// Report counts a reader's report of a published word; the third report from
// different readers hides it until the owner looks.
func (s *Service) Report(ctx context.Context, id int64) (Word, error) {
	w, err := s.Store.Get(ctx, id)
	if err != nil {
		return w, err
	}
	if w.Status != StatusPublished {
		return w, ErrNotFound
	}
	w.Reports++
	if w.Reports >= ReportsToHide {
		w.Status = StatusReported
	}
	return w, s.Store.Update(ctx, w)
}

// DeleteByCode forgets the word a delete code belongs to, voice included.
func (s *Service) DeleteByCode(ctx context.Context, code string) error {
	w, err := s.Store.ByCode(ctx, code)
	if err != nil {
		return err
	}
	s.removeFile(s.AudioDir(), w.Audio)
	s.removeFile(s.WhisperDir(), w.Whisper)
	return s.Store.Delete(ctx, w.ID)
}

// Decide is the owner's action on a word: publish or hide.
func (s *Service) Decide(ctx context.Context, id int64, action string) (Word, error) {
	w, err := s.Store.Get(ctx, id)
	if err != nil {
		return w, err
	}
	switch action {
	case "publish":
		if w.Status == StatusCrisis || w.Text == "" {
			return w, fmt.Errorf("%w: this word cannot be published", ErrInput)
		}
		w.Status, w.Reports = StatusPublished, 0
	case "hide":
		w.Status = StatusHidden
		s.removeFile(s.WhisperDir(), w.Whisper)
		w.Whisper = ""
	default:
		return w, fmt.Errorf("%w: action must be publish or hide", ErrInput)
	}
	w.Reason = "owner: " + action
	return w, s.Store.Update(ctx, w)
}
