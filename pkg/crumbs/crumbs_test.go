package crumbs

import (
	"testing"

	"github.com/sankofa-media/sankofa/pkg/card"
	"github.com/sankofa-media/sankofa/pkg/factoid"
)

func set() *card.Set {
	s := &card.Set{ByID: map[string]*card.Card{}}
	for _, c := range []*card.Card{
		{ID: "a", Edition: "both", Body: "[[b]]"},
		{ID: "b", Edition: "both"},
		{ID: "c", Edition: "both"},
		{ID: "d", Edition: "m", Pair: "p"},
	} {
		s.ByID[c.ID] = c
		s.Order = append(s.Order, c.ID)
	}
	return s
}

func TestPrefersUnreadAndLinked(t *testing.T) {
	p := &Picker{Set: set(), Last: "a", Seen: func(id string) bool { return id == "a" }}
	if got := p.Next().ID(); got != "b" {
		t.Fatalf("want linked unread b, got %s", got)
	}
	// Both copies hold the whole dictionary: a pair card is a crumb like any other.
	seenD := false
	for i := 0; i < 10; i++ {
		if c := p.Next(); c.Card != nil && c.Card.ID == "d" {
			seenD = true
		}
	}
	if !seenD {
		t.Fatal("a pair card should be a crumb too")
	}
}

func facts() []factoid.Factoid {
	return []factoid.Factoid{
		{ID: "fx-1", EN: "one", RU: "один", Cards: []string{"c"}},
		{ID: "fx-2", EN: "two", RU: "два", Cards: []string{"a"}},
		{ID: "fx-3", EN: "three", RU: "три"},
	}
}

func TestFactoidsJoinThePool(t *testing.T) {
	p := &Picker{Set: set(), Facts: facts()}
	// Both copies include every card, including the paired card d. Together
	// with three factoids, the pool has seven entries (not six).
	want := map[string]bool{"a": true, "b": true, "c": true, "d": true, "fx-1": true, "fx-2": true, "fx-3": true}
	for cycle := 0; cycle < 2; cycle++ {
		got := map[string]bool{}
		for range len(want) {
			crumb := p.Next()
			if crumb == nil {
				t.Fatal("pool ran dry")
			}
			id := crumb.ID()
			if !want[id] || got[id] {
				t.Fatalf("cycle %d: unexpected or repeated crumb %q; seen %v", cycle, id, got)
			}
			got[id] = true
		}
		if len(got) != len(want) {
			t.Fatalf("want every card and factoid once, got %v", got)
		}
	}
}

func TestFactPrefersTheLastCardsFactoids(t *testing.T) {
	// The reader just read a: its own factoid fx-2 comes first, then the
	// rest unseen (fx-3, not fx-1 which was shown already), then repeats.
	seen := map[string]bool{"a": true, "fx-1": true}
	p := &Picker{Set: set(), Facts: facts(), Last: "a", Seen: func(id string) bool { return seen[id] }}
	if f := p.NextFact(); f == nil || f.ID != "fx-2" {
		t.Fatalf("want fx-2, got %+v", f)
	}
	if f := p.NextFact(); f.ID != "fx-3" {
		t.Fatalf("want unseen fx-3, got %s", f.ID)
	}
	if f := p.NextFact(); f.ID != "fx-1" {
		t.Fatalf("want fx-1 once the unseen ran out, got %s", f.ID)
	}
	if f := p.NextFact(); f == nil {
		t.Fatal("the pool starts over instead of running dry")
	}
	if (&Picker{Set: set()}).NextFact() != nil {
		t.Fatal("no factoids, no fact")
	}
}

func TestLinkedFactoidsComeBeforeOtherFreshOnes(t *testing.T) {
	// a links to b: b and b's factoid are both related to what was read.
	fs := append(facts(), factoid.Factoid{ID: "fx-4", EN: "four", Cards: []string{"b"}})
	seen := map[string]bool{"a": true, "fx-2": true}
	p := &Picker{Set: set(), Facts: fs, Last: "a", Seen: func(id string) bool { return seen[id] }}
	first := map[string]bool{p.Next().ID(): true, p.Next().ID(): true}
	if !first["b"] || !first["fx-4"] {
		t.Fatalf("want card b and its factoid fx-4 first, got %v", first)
	}
}
