package main

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/tym83/sankofa/pkg/card"
	"github.com/tym83/sankofa/pkg/reader"
)

func TestDictIndexAndEdition(t *testing.T) {
	t.Setenv("SANKOFA_HOME", t.TempDir())
	s, err := card.LoadDir("../../content/cards")
	if err != nil {
		t.Fatal(err)
	}
	st, _ := reader.Load()
	st.Edition = card.EditionMale
	m := newDictModel(s, st, s.ByID["bridgetower"])
	key := func(k tea.KeyMsg) { m.Update(k) }
	key(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("/")})
	if !m.index {
		t.Fatal("/ must open the index")
	}
	key(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("equiano")})
	key(tea.KeyMsg{Type: tea.KeyEnter})
	if m.index || m.cur.ID != "equiano" {
		t.Fatalf("search must open equiano, got %s", m.cur.ID)
	}
	m.open(s.ByID["douglass-covey"], true)
	key(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("e")})
	if st.Edition != card.EditionFemale || m.edition != card.EditionFemale || m.cur.ID != "douglass-covey" {
		t.Fatalf("e must trade the copy and keep the card open: %s %s", st.Edition, m.cur.ID)
	}
	// The index of the female copy finds Douglass too, and opens Douglass.
	key(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("/")})
	key(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("Frederick Douglass fights")})
	key(tea.KeyMsg{Type: tea.KeyEnter})
	if m.cur.ID != "douglass-covey" {
		t.Fatalf("the female index must open douglass-covey, got %s", m.cur.ID)
	}
}

func TestDictLinkOpensItsOwnCard(t *testing.T) {
	t.Setenv("SANKOFA_HOME", t.TempDir())
	s := &card.Set{ByID: map[string]*card.Card{}}
	for _, c := range []*card.Card{
		{ID: "hub", Title: "Hub", Kind: "person", Places: []card.Place{{Name: "A"}}, Edition: card.EditionBoth, Body: "See [[douglass]]."},
		{ID: "douglass", Title: "Douglass", Kind: "event", Places: []card.Place{{Name: "B"}}, Edition: card.EditionMale, Pair: "p"},
		{ID: "jacobs", Title: "Jacobs", Kind: "event", Places: []card.Place{{Name: "C"}}, Edition: card.EditionFemale, Pair: "p"},
	} {
		s.ByID[c.ID] = c
		s.Order = append(s.Order, c.ID)
	}
	st, _ := reader.Load()
	st.Edition = card.EditionFemale
	m := newDictModel(s, st, s.ByID["hub"])
	m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	if m.cur.ID != "douglass" {
		t.Fatalf("a link to douglass in the female copy opens douglass, got %s", m.cur.ID)
	}
	if v := m.View(); !strings.Contains(strings.ReplaceAll(v, nbsp, " "), "In your copy this theme is told through") {
		t.Fatalf("the card names the other telling:\n%s", v)
	}
}

func TestReadingCopy(t *testing.T) {
	for flag, want := range map[string]string{"": card.EditionMale, "f": card.EditionFemale, "female": card.EditionFemale, "m": card.EditionMale} {
		if got, err := readingCopy(flag, card.EditionMale); err != nil || got != want {
			t.Fatalf("readingCopy(%q) = %q, %v", flag, got, err)
		}
	}
	if _, err := readingCopy("x", card.EditionMale); err == nil {
		t.Fatal("an unknown copy must fail")
	}
}
