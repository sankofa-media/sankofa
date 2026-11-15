package main

import (
	"strings"
	"testing"

	"github.com/tym83/sankofa/pkg/card"
	"github.com/tym83/sankofa/pkg/crumbs"
	"github.com/tym83/sankofa/pkg/factoid"
)

func TestFactCrumbSaysItsYearAndLeadsToItsCard(t *testing.T) {
	set := &card.Set{ByID: map[string]*card.Card{"zong": {ID: "zong", Years: []int{1781}, Places: []card.Place{{Name: "Jamaica", Lat: 18, Lon: -77}}, Zoom: 3}}}
	withCard := &factoid.Factoid{ID: "fx-1", EN: "A ship sailed.", Year: 1781, Cards: []string{"ghost", "zong"}}
	line := crumbLine(set, &crumbs.Crumb{Fact: withCard}, false, 0)
	if !strings.HasPrefix(line, "1781. A ship sailed.") {
		t.Fatalf("year missing: %q", line)
	}
	if p := factPoint(set, withCard); p.Focus != "zong" {
		t.Fatalf("want the first existing card, got %+v", p)
	}
	alone := &factoid.Factoid{ID: "fx-2", EN: "In 1900 something happened.", Year: 1900}
	if line := crumbLine(set, &crumbs.Crumb{Fact: alone}, false, 0); strings.Count(line, "1900") != 1 {
		t.Fatalf("year said twice: %q", line)
	}
	if p := factPoint(set, alone); p.From != 1900 || p.Focus != "" {
		t.Fatalf("a fact without cards opens its year: %+v", p)
	}
}
