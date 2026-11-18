package angel

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// MaxVoiceSeconds is the longest voice message kept; longer ones are cut.
const MaxVoiceSeconds = 30

// Audio turns uploads into what transcription and the bass need.
type Audio interface {
	// ToWAV decodes any upload into 16 kHz mono PCM WAV, cut at
	// MaxVoiceSeconds: the input whisper.cpp expects.
	ToWAV(ctx context.Context, in, out string) error
	// Whisper renders a voice that cannot be recognised: phase-randomised
	// (a whisper with no pitch left), shifted down, reversed, low-passed and
	// drowned in echoes.
	Whisper(ctx context.Context, in, out string) error
}

// Transcriber turns speech into text.
type Transcriber interface {
	Transcribe(ctx context.Context, wav string) (string, error)
}

// FFmpeg is the Audio backed by the ffmpeg binary.
type FFmpeg struct{ Bin string }

func (f FFmpeg) run(ctx context.Context, args ...string) error {
	bin := f.Bin
	if bin == "" {
		bin = "ffmpeg"
	}
	cmd := exec.CommandContext(ctx, bin, append([]string{"-hide_banner", "-nostdin", "-loglevel", "error", "-y"}, args...)...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("ffmpeg: %w: %s", err, strings.TrimSpace(stderr.String()))
	}
	return nil
}

// ToWAV implements Audio.
func (f FFmpeg) ToWAV(ctx context.Context, in, out string) error {
	return f.run(ctx, "-i", in, "-t", fmt.Sprint(MaxVoiceSeconds), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "wav", out)
}

// WhisperFilter is the ffmpeg filter chain of the whisper. afftfilt with
// random phases is ffmpeg's documented "whisper" effect: it keeps the
// spectral envelope roughly and throws the voice's pitch away. The pitch
// shift, the reversal, the low-pass at the bass's register and the echoes
// then take away the timbre and the words.
const WhisperFilter = "aformat=channel_layouts=mono,aresample=44100,asetrate=44100*0.78,aresample=44100," +
	"afftfilt=real='hypot(re,im)*cos((random(0)*2-1)*2*3.14)':imag='hypot(re,im)*sin((random(1)*2-1)*2*3.14)':win_size=1024:overlap=0.75," +
	"areverse,lowpass=f=900,lowpass=f=900,highpass=f=60," +
	"aecho=0.8:0.85:73|149|263|421:0.5|0.38|0.28|0.2," +
	"dynaudnorm=f=200,afade=t=in:d=0.6,areverse,afade=t=in:d=0.6,areverse"

// Whisper implements Audio. The output is MP3, which every browser plays.
func (f FFmpeg) Whisper(ctx context.Context, in, out string) error {
	return f.run(ctx, "-i", in, "-t", fmt.Sprint(MaxVoiceSeconds), "-vn", "-af", WhisperFilter, "-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "64k", "-f", "mp3", out)
}

// WhisperCPP is the Transcriber backed by whisper.cpp's HTTP server.
type WhisperCPP struct {
	URL    string // base URL, e.g. http://whisper:8080
	Client *http.Client
}

// Transcribe implements Transcriber (POST /inference, multipart "file").
func (w WhisperCPP) Transcribe(ctx context.Context, wav string) (string, error) {
	f, err := os.Open(wav)
	if err != nil {
		return "", err
	}
	defer f.Close()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	part, err := mw.CreateFormFile("file", filepath.Base(wav))
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(part, f); err != nil {
		return "", err
	}
	_ = mw.WriteField("response_format", "json")
	_ = mw.WriteField("language", "auto")
	_ = mw.WriteField("temperature", "0.0")
	if err := mw.Close(); err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(w.URL, "/")+"/inference", &body)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	c := w.Client
	if c == nil {
		c = http.DefaultClient
	}
	resp, err := c.Do(req)
	if err != nil {
		return "", fmt.Errorf("whisper: %w", err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("whisper: status %d: %s", resp.StatusCode, strings.TrimSpace(string(data)))
	}
	var out struct {
		Text  string `json:"text"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal(data, &out); err != nil {
		return "", fmt.Errorf("whisper: %w", err)
	}
	if out.Error != "" {
		return "", fmt.Errorf("whisper: %s", out.Error)
	}
	return Normalize(out.Text), nil
}
