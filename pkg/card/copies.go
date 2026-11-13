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
