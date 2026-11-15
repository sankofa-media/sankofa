package crumbs

import (
	"testing"

	"github.com/tym83/sankofa/pkg/card"
)

func TestPrefersUnreadAndLinked(t *testing.T) {
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
	p := &Picker{Set: s, Last: "a", Seen: func(id string) bool { return id == "a" }}
	if got := p.Next().ID; got != "b" {
		t.Fatalf("want linked unread b, got %s", got)
	}
	// Both copies hold the whole dictionary: a card of a pair is a crumb too.
	q := &Picker{Set: s, Seen: func(id string) bool { return id != "d" }}
	if got := q.Next().ID; got != "d" {
		t.Fatalf("want the unread paired card d, got %s", got)
	}
}
