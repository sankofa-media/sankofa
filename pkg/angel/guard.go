package angel

import (
	"regexp"
	"strings"
	"unicode"
)

// The pre-filter rejects what is plainly a contact, a link or a payment
// address before any model sees it: such words never join the chorus, and the
// cheapest refusal is the one that costs no call.
var guards = []struct {
	name string
	re   *regexp.Regexp
}{
	{"email", regexp.MustCompile(`(?i)[a-z0-9._%+-]+\s*(?:@|\(at\)|\[at\])\s*[a-z0-9.-]+\.[a-z]{2,}`)},
	{"messenger", regexp.MustCompile(`(?i)\b(?:t\.me|wa\.me|telegram\.me|vk\.com|instagram\.com|discord\.gg)\b`)},
	{"url", regexp.MustCompile(`(?i)\b(?:https?://|www\.)\S+`)},
	{"url", regexp.MustCompile(`(?i)\b[a-z0-9-]{2,}\.(?:com|net|org|info|biz|io|me|ru|su|xn--p1ai|рф|ua|by|kz|uz|de|uk|fr|it|es|pl|co|app|dev|xyz|top|site|online|shop|store|link|club|live|tv|ly|gg|cc|to|in|us|eu)\b`)},
	{"handle", regexp.MustCompile(`(?:^|\s)@[A-Za-z0-9_]{4,}`)},
	{"crypto", regexp.MustCompile(`\b(?:0x[0-9a-fA-F]{40}|bc1[0-9a-z]{25,60}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|T[1-9A-HJ-NP-Za-km-z]{33})\b`)},
}

// phoneRun is a run of digits with the separators phone numbers are written
// with; seven or more digits in it make a phone number.
var phoneRun = regexp.MustCompile(`\+?[\d][\d\s().-]{5,}\d`)

// Guard reports why text must be rejected without asking the model, or "".
func Guard(text string) string {
	for _, g := range guards {
		if g.re.MatchString(text) {
			return g.name
		}
	}
	for _, m := range phoneRun.FindAllString(text, -1) {
		n := 0
		for _, r := range m {
			if unicode.IsDigit(r) {
				n++
			}
		}
		if n >= 7 {
			return "phone"
		}
	}
	return ""
}

// Normalize trims the text and collapses runs of blank lines and spaces.
func Normalize(text string) string {
	text = strings.Map(func(r rune) rune {
		if r == '\r' || (unicode.IsControl(r) && r != '\n' && r != '\t') {
			return -1
		}
		return r
	}, text)
	lines := strings.Split(text, "\n")
	out := lines[:0]
	blank := false
	for _, l := range lines {
		l = strings.Join(strings.Fields(l), " ")
		if l == "" {
			if blank || len(out) == 0 {
				continue
			}
			blank = true
		} else {
			blank = false
		}
		out = append(out, l)
	}
	return strings.TrimSpace(strings.Join(out, "\n"))
}
