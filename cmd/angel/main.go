// Command angel serves the special project "Angel" of the Sankofa museum:
// the presence of readers touching their screens at the same moment, and the
// chorus of words they never said. See pkg/angel.
package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/sankofa-media/sankofa/pkg/angel"
)

func main() {
	listen := flag.String("listen", ":8080", "address to listen on")
	dir := flag.String("data", "/var/lib/angel", "data directory: angel.db, whispers/, audio/ (in transit)")
	whisper := flag.String("whisper-url", os.Getenv("ANGEL_WHISPER_URL"), "whisper.cpp server URL; empty disables voice")
	ffmpeg := flag.String("ffmpeg", "ffmpeg", "ffmpeg binary")
	ipHeader := flag.String("ip-header", "X-Real-IP", "header carrying the client address set by the ingress; empty uses the connection")
	flag.Parse()

	log := slog.New(slog.NewJSONHandler(os.Stderr, nil))
	if err := run(*listen, *dir, *whisper, *ffmpeg, *ipHeader, log); err != nil {
		log.Error("angel", "err", err)
		os.Exit(1)
	}
}

func run(listen, dir, whisperURL, ffmpeg, ipHeader string, log *slog.Logger) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	store, err := angel.OpenStore(filepath.Join(dir, "angel.db"))
	if err != nil {
		return err
	}
	defer store.Close()

	svc := &angel.Service{Store: store, Dir: dir, Audio: angel.FFmpeg{Bin: ffmpeg}, Log: log}
	if key := os.Getenv("ANTHROPIC_API_KEY"); key != "" {
		svc.Moderator = angel.NewClaude(key)
		log.Info("moderation on", "model", angel.Model)
	} else {
		svc.Moderator = angel.Rules{}
		log.Warn("ANTHROPIC_API_KEY is not set: words are checked by rules only")
	}
	if err := store.Seed(context.Background(), time.Now()); err != nil {
		return err
	}
	if whisperURL != "" {
		svc.Transcriber = angel.WhisperCPP{URL: whisperURL, Client: &http.Client{Timeout: 2 * time.Minute}}
	} else {
		log.Warn("no whisper URL: voice is not accepted")
	}
	token := os.Getenv("ANGEL_ADMIN_TOKEN")
	if token == "" {
		log.Warn("ANGEL_ADMIN_TOKEN is not set: owner moderation is off")
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if err := svc.Start(ctx); err != nil {
		return err
	}
	srv := &angel.Server{Svc: svc, Presence: angel.NewPresence(nil), Clients: angel.NewClients(nil), AdminToken: token, IPHeader: ipHeader, Log: log}
	go srv.Sweep(ctx.Done())

	hs := &http.Server{
		Addr:              listen,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       time.Minute, // uploads of up to 2 MB from phones
		IdleTimeout:       2 * time.Minute,
		// Request contexts end with the process, so open streams close.
		BaseContext: func(net.Listener) context.Context { return ctx },
		// No WriteTimeout: the presence stream stays open.
	}
	errc := make(chan error, 1)
	go func() { errc <- hs.ListenAndServe() }()
	log.Info("angel listening", "addr", listen)
	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	shut, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	err = hs.Shutdown(shut)
	svc.Wait()
	if errors.Is(err, context.DeadlineExceeded) {
		return nil // open presence streams were cut; that is fine
	}
	return err
}
