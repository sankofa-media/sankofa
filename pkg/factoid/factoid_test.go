package factoid

import (
	"strings"
	"testing"
	"testing/fstest"

	"github.com/sankofa-media/sankofa/pkg/card"
)

const sample = `
- id: fx-a
  cat: art
  en: One short checked sentence.
  ru: Одно короткое проверенное предложение.
  year: 1900
  place: { name: Lagos, lat: 6.45, lon: 3.39 }
  cards: [ a ]
  sources:
    - { title: One, url: "https://one.example" }
    - { title: Two, url: "https://two.example" }
  status: checked
- id: fx-b
  cat: art
  en: Not checked yet.
  ru: Ещё не проверено.
  year: 1901
  cards: []
  sources: []
  status: unverified
`

func cardSet(ids ...string) *card.Set {
	s := &card.Set{ByID: map[string]*card.Card{}}
	for _, id := range ids {
		s.ByID[id] = &card.Card{ID: id}
		s.Order = append(s.Order, id)
	}
	return s
}

func TestLoadShowsOnlyChecked(t *testing.T) {
	fs := fstest.MapFS{"art.yaml": {Data: []byte(sample)}}
	got, err := Load(fs, cardSet("a"))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].ID != "fx-a" {
		t.Fatalf("want only fx-a, got %+v", got)
	}
	if got[0].Text("ru") != "Одно короткое проверенное предложение." || got[0].Text("en") != "One short checked sentence." {
		t.Fatal("Text picks the language")
	}
}

func TestValidateCatchesEachRule(t *testing.T) {
	lat, lon := 6.0, 3.0
	ok := Factoid{ID: "fx-ok", EN: "x", RU: "х", Year: 1900, Place: &Place{Name: "P", Lat: &lat, Lon: &lon}, Cards: []string{"a"},
		Sources: []Source{{Title: "a", URL: "https://a"}, {Title: "b", URL: "https://b"}}, Status: Checked}
	if errs := Validate([]Factoid{ok}, cardSet("a")); len(errs) != 0 {
		t.Fatalf("valid factoid rejected: %v", errs)
	}
	cases := map[string]func(f *Factoid){
		"duplicate id":           func(f *Factoid) { f.ID = "fx-ok" },
		"no ru text":             func(f *Factoid) { f.RU = " " },
		"no en text":             func(f *Factoid) { f.EN = "" },
		"more than 30":           func(f *Factoid) { f.EN = strings.Repeat("word ", 31) },
		"no year":                func(f *Factoid) { f.Year = 0 },
		"does not exist":         func(f *Factoid) { f.Cards = []string{"ghost"} },
		"has no lat/lon":         func(f *Factoid) { f.Place = &Place{Name: "Nowhere"} },
		"off the globe":          func(f *Factoid) { big := 200.0; f.Place = &Place{Name: "Far", Lat: &lat, Lon: &big} },
		"two are needed":         func(f *Factoid) { f.Sources = f.Sources[:1] },
		"needs a title and link": func(f *Factoid) { f.Sources = []Source{{Title: "a"}, {Title: "b", URL: "https://b"}} },
	}
	for want, mutate := range cases {
		f := ok
		f.ID = "fx-other"
		f.Sources = append([]Source(nil), ok.Sources...)
		mutate(&f)
		errs := Validate([]Factoid{ok, f}, cardSet("a"))
		if len(errs) == 0 {
			t.Errorf("%s: not caught", want)
			continue
		}
		key := strings.Fields(want)[0]
		if want == "needs a title and link" {
			key = "needs a title"
		}
		if !strings.Contains(errs[0].Error(), key) {
			t.Errorf("%s: got %v", want, errs[0])
		}
	}
}
