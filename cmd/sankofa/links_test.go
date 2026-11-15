package main

import (
	"bytes"
	"strings"
	"testing"

	"github.com/tym83/sankofa/pkg/card"
)

func linkSet() *card.Set {
	s := &card.Set{ByID: map[string]*card.Card{}}
	for _, c := range []*card.Card{
		{ID: "sun-ra", Title: "Sun Ra", Kind: "person", Books: []string{card.BookHeirs}, Years: []int{1914, 1993}, Edition: card.EditionBoth},
		{ID: "zong", Title: "The Zong massacre", Kind: "event", Books: []string{card.BookArchives}, Years: []int{1781}, Edition: card.EditionBoth},
		{ID: "blues", Title: "The blues", Kind: "genre", Years: []int{1890}, Edition: card.EditionBoth},
		{ID: "douglass-covey", Title: "Frederick Douglass fights Edward Covey", Kind: "event", Years: []int{1834}, Edition: card.EditionMale},
	} {
		s.ByID[c.ID] = c
		s.Order = append(s.Order, c.ID)
	}
	return s
}

func TestRenderLinksInAPipe(t *testing.T) {
	got := renderLinks(linkSet(), "From [[sun-ra|Sun Ra]] back to [[zong]].", linkStyle{})
	want := "From Sun" + nbsp + "Ra✶" + nbsp + "[sun-ra] back to The" + nbsp + "Zong" + nbsp + "massacre▤" + nbsp + "[zong]."
	if got != want {
		t.Fatalf("got %q\nwant %q", got, want)
	}
	if strings.Contains(got, "\x1b") {
		t.Fatal("no escape sequences outside a terminal")
	}
}

func TestRenderLinksOnATerminal(t *testing.T) {
	t.Setenv("SANKOFA_MUSEUM_URL", "https://museum.example/")
	lang = "ru"
	defer func() { lang = "en" }()
	got := renderLinks(linkSet(), "[[sun-ra|Сан Ра]]", linkStyle{tty: true})
	want := "\x1b]8;;https://museum.example/#focus=sun-ra&lang=ru\x1b\\Сан" + nbsp + "Ра\x1b]8;;\x1b\\✶" + nbsp + "\x1b[2m[sun-ra]\x1b[22m"
	if got != want {
		t.Fatalf("got %q\nwant %q", got, want)
	}
	if w := visibleWidth(got); w != len([]rune("Сан Ра✶ [sun-ra]")) {
		t.Fatalf("visible width %d", w)
	}
}

func TestPrintCardWrapsLinksWhole(t *testing.T) {
	s := linkSet()
	c := &card.Card{ID: "x", Title: "X", Kind: "person", Years: []int{1900}, Wow: "w",
		Body:    strings.Repeat("word ", 14) + "[[sun-ra|Sun Ra]] and " + strings.Repeat("more ", 14) + "[[zong|the Zong]] end.",
		Further: []string{"[[blues|The blues]], any recording"}}
	for _, tty := range []bool{false, true} {
		var b bytes.Buffer
		printCard(&b, s, c, tty)
		out := b.String()
		for _, line := range strings.Split(out, "\n") {
			if visibleWidth(line) > 78 && !strings.Contains(line, "#") {
				t.Fatalf("line wider than 78: %q", line)
			}
		}
		if !strings.Contains(escapes.ReplaceAllString(out, ""), "The"+nbsp+"blues"+nbsp+"[blues]") {
			t.Fatalf("further links must render too:\n%s", out)
		}
		if strings.Contains(out, "[[") {
			t.Fatalf("raw link markup left:\n%s", out)
		}
	}
}

func TestIndexOrder(t *testing.T) {
	var b bytes.Buffer
	printIndex(&b, linkSet(), card.EditionFemale, linkStyle{})
	out := b.String()
	if !strings.HasPrefix(out, "B\n  The blues") {
		t.Fatalf("English ignores a leading The:\n%s", out)
	}
	if !strings.Contains(out, "Frederick Douglass fights Edward Covey · 1834 · event · in the other copy [douglass-covey]") {
		t.Fatalf("the other copy is marked:\n%s", out)
	}
	titles := func(l string, ts ...string) []string {
		var cs []*card.Card
		for _, x := range ts {
			cs = append(cs, &card.Card{Title: x})
		}
		sortIndex(cs, l)
		var out []string
		for _, c := range cs {
			out = append(out, c.Title)
		}
		return out
	}
	got := strings.Join(titles("ru", "Ёлка", "Йоруба", "«Respect»", "Ель", "1960-й", "Ежи", "Ифа", "Абебе"), " ")
	if want := "Абебе Ежи Ёлка Ель Ифа Йоруба «Respect» 1960-й"; got != want {
		t.Fatalf("Russian order:\ngot  %s\nwant %s", got, want)
	}
	if l := indexLetter("Ёлка", "ru"); l != "Е" {
		t.Fatalf("Ё is filed under Е, got %s", l)
	}
	if l := indexLetter("The Zong massacre", "en"); l != "Z" {
		t.Fatalf("got %s", l)
	}
}
