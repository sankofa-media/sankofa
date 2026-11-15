package card

import "strings"

// Copy markers open a paragraph that is read in one copy of the museum only.
const (
	MarkerMale   = "{male} "
	MarkerFemale = "{female} "
)

// Paragraphs splits a body into its paragraphs (blank-line separated).
func Paragraphs(body string) []string {
	var out []string
	for _, p := range strings.Split(strings.ReplaceAll(body, "\r\n", "\n"), "\n\n") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// CopyParagraphs returns the paragraphs a reader of one copy (EditionMale or
// EditionFemale) sees: unmarked paragraphs and that copy's own, markers stripped.
func CopyParagraphs(body, edition string) []string {
	var out []string
	for _, p := range Paragraphs(body) {
		switch {
		case strings.HasPrefix(p, MarkerMale):
			if edition == EditionMale {
				out = append(out, strings.TrimPrefix(p, MarkerMale))
			}
		case strings.HasPrefix(p, MarkerFemale):
			if edition == EditionFemale {
				out = append(out, strings.TrimPrefix(p, MarkerFemale))
			}
		default:
			out = append(out, p)
		}
	}
	return out
}

// ForCopy returns the card as a reader of one copy reads it: in its body and
// in every translation's body, the other copy's {male}/{female} paragraphs are
// dropped and the reader's own lose their marker. An unmarked card comes back
// as it is.
func (c *Card) ForCopy(edition string) *Card {
	if edition != EditionMale && edition != EditionFemale {
		return c
	}
	out := *c
	out.Body = copyBody(c.Body, edition)
	if len(c.Translations) > 0 {
		out.Translations = make(map[string]*Translation, len(c.Translations))
		for lang, t := range c.Translations {
			tt := *t
			tt.Body = copyBody(t.Body, edition)
			out.Translations[lang] = &tt
		}
	}
	return &out
}

func copyBody(body, edition string) string {
	if !strings.Contains(body, MarkerMale) && !strings.Contains(body, MarkerFemale) {
		return body
	}
	return strings.Join(CopyParagraphs(body, edition), "\n\n")
}

// Words counts the words of prose with link markup replaced by its text.
func Words(text string) int {
	return len(strings.Fields((&Card{Body: text}).PlainBody()))
}

// CopyWords is the longest a reader of either copy reads: markers mean the two
// copies differ, and each copy is limited on its own.
func CopyWords(body string) int {
	n := 0
	for _, ed := range []string{EditionMale, EditionFemale} {
		if w := Words(strings.Join(CopyParagraphs(body, ed), "\n\n")); w > n {
			n = w
		}
	}
	return n
}
