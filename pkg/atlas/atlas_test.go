package atlas

import (
	"strings"
	"testing"
)

func TestRoundTrip(t *testing.T) {
	p := Point{From: 1900, To: 1935, Place: "delta", Zoom: 3, Focus: "blues", Path: []string{"a", "b"}, Lang: "ru"}
	got, err := Parse("http://x/#" + p.Fragment())
	if err != nil || got.Fragment() != p.Fragment() {
		t.Fatalf("%+v %v", got, err)
	}
	if _, err := Parse("zoom=9"); err == nil {
		t.Fatal("zoom 9 must fail")
	}
}

func TestSlug(t *testing.T) {
	if got := Slug("Île de Gorée"); got != "ile-de-goree" {
		t.Fatal(got)
	}
}

func TestBase(t *testing.T) {
	t.Setenv("SANKOFA_MUSEUM_URL", "")
	if got := (Point{Focus: "blues", Lang: "ru"}).URL(); got != "https://museum.sankofa.workshop.aenix.io/#focus=blues&lang=ru" {
		t.Fatalf("unset: %s", got)
	}
	if got := (Point{From: 1900, Zoom: 3}).URL(); !strings.HasPrefix(got, DefaultBase+"#") || !strings.HasSuffix(got, "#t=1900&zoom=3") {
		t.Fatalf("atlas point on the public museum: %s", got)
	}
	t.Setenv("SANKOFA_MUSEUM_URL", "http://localhost:5173")
	if got := (Point{Focus: "blues"}).URL(); got != "http://localhost:5173/#focus=blues" {
		t.Fatalf("set without a slash: %s", got)
	}
}
