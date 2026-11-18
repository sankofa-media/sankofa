package main

import (
	"fmt"
	"io"
	"regexp"
	"sort"
	"strings"
	"unicode"

	"golang.org/x/text/collate"
	"golang.org/x/text/language"
	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"

	"github.com/tym83/sankofa/pkg/atlas"
	"github.com/tym83/sankofa/pkg/card"
)

// linkStyle says how card links print: on a terminal the words are an OSC 8
// hyperlink to the card in the museum and the reference is dim; in a pipe
// both are plain text.
type linkStyle struct {
	tty bool
}

const nbsp = " "

// cardURL is the museum's address of a card, in the reader's language.
func cardURL(id string) string {
	return atlas.Point{Focus: id, Lang: lang}.URL()
}

// renderLinks turns [[id|words]] into the words, the book of the card they
// lead to and a reference the reader can follow: "Sun Ra✶ [sun-ra]", i.e.
// `sankofa dict sun-ra`. A link and its reference never break across lines.
func renderLinks(s *card.Set, text string, st linkStyle) string {
	links := (&card.Card{Body: text}).Links()
	if len(links) == 0 {
		return text
	}
	var b strings.Builder
	last := 0
	for _, l := range links {
		b.WriteString(text[last:l.Start])
		words, sym := l.Text, ""
		if t := s.ByID[l.Target]; t != nil {
			if !l.Explicit {
				words = t.Title
			}
			if len(t.Books) > 0 {
				sym = card.BookSymbols[t.Books[0]]
			}
		}
		words = strings.ReplaceAll(words, " ", nbsp)
		ref := "[" + l.Target + "]"
		if st.tty {
			words = atlas.Hyperlink(true, cardURL(l.Target), words)
			ref = "\x1b[2m" + ref + "\x1b[22m"
		}
		b.WriteString(words + sym + nbsp + ref)
		last = l.End
	}
	b.WriteString(text[last:])
	return b.String()
}

var escapes = regexp.MustCompile(`\x1b\]8;;[^\x1b]*\x1b\\|\x1b\[[0-9;]*m`)

// visibleWidth is the width of text on screen, escape sequences aside.
func visibleWidth(s string) int {
	return len([]rune(escapes.ReplaceAllString(s, "")))
}

// --- the alphabetical index ---

var stripMarks = transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC)

// foldTitle is a title as the index compares it: lower case, ё read as е,
// accents taken off Latin letters (Russian й stays й), punctuation dropped.
func foldTitle(s string) string {
	s = strings.ReplaceAll(strings.ToLower(s), "ё", "е")
	var b strings.Builder
	for _, r := range s {
		switch {
		case unicode.Is(unicode.Cyrillic, r):
			b.WriteRune(r)
		case unicode.IsLetter(r) || unicode.IsDigit(r) || unicode.IsSpace(r):
			t, _, _ := transform.String(stripMarks, string(r))
			b.WriteString(t)
		}
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

// sortTitle is the part of a title the index files it by: no leading
// quotation marks, and in English no leading "The".
func sortTitle(title, l string) string {
	t := strings.TrimLeft(title, " \"'“”«»„([")
	if l != "ru" && len(t) > 4 && strings.EqualFold(t[:4], "the ") {
		t = t[4:]
	}
	return foldTitle(t)
}

// indexLetter is the letter an entry is filed under; digits go under #.
func indexLetter(title, l string) string {
	for _, r := range sortTitle(title, l) {
		if unicode.IsDigit(r) {
			return "#"
		}
		return string(unicode.ToUpper(r))
	}
	return "#"
}

// sortIndex orders cards as the museum's index does: Russian titles in
// Russian order with Cyrillic before Latin, English ignoring "The", titles
// that start with a number last.
func sortIndex(cs []*card.Card, l string) {
	tag := language.English
	if l == "ru" {
		tag = language.Russian
	}
	col := collate.New(tag, collate.Loose, collate.Numeric)
	first := func(s string) rune {
		for _, r := range s {
			return r
		}
		return 0
	}
	sort.SliceStable(cs, func(i, j int) bool {
		a, b := sortTitle(cs[i].Title, l), sortTitle(cs[j].Title, l)
		da, db := unicode.IsDigit(first(a)), unicode.IsDigit(first(b))
		if da != db {
			return db
		}
		if l == "ru" {
			ca, cb := unicode.Is(unicode.Cyrillic, first(a)), unicode.Is(unicode.Cyrillic, first(b))
			if ca != cb {
				return ca
			}
		}
		if c := col.CompareString(a, b); c != 0 {
			return c < 0
		}
		return cs[i].Title < cs[j].Title
	})
}

// printIndex prints every card under its letter, with its years, its kind
// and its id. Both copies hold the whole dictionary, so no card is marked.
func printIndex(w io.Writer, s *card.Set, st linkStyle) {
	var cs []*card.Card
	for _, id := range s.Order {
		cs = append(cs, s.ByID[id])
	}
	sortIndex(cs, lang)
	letter := ""
	for _, c := range cs {
		if L := indexLetter(c.Title, lang); L != letter {
			if letter != "" {
				fmt.Fprintln(w)
			}
			letter = L
			fmt.Fprintln(w, L)
		}
		title := c.Title
		if st.tty {
			title = atlas.Hyperlink(true, cardURL(c.ID), title)
		}
		ref := "[" + c.ID + "]"
		if st.tty {
			ref = "\x1b[2m" + ref + "\x1b[22m"
		}
		fmt.Fprintf(w, "  %s · %s · %s %s\n", title, yearsOf(c), tr(c.Kind), ref)
	}
}
