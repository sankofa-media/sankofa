package roots

import (
	"strings"
	"testing"
	"testing/fstest"

	"github.com/tym83/sankofa/pkg/card"
)

const two = `
    sources:
      - {title: a, url: "https://a"}
      - {title: b, url: "https://b"}`

func TestPaths(t *testing.T) {
	fsys := fstest.MapFS{
		"oasis.yaml":   {Data: []byte("id: oasis\nname: Oasis\nyears: [1991]\nplace: {name: M, lat: 1, lon: 1}\ngenre: britpop\nlinks:\n  - to: root:beatles\n    claim: c" + two + "\n")},
		"beatles.yaml": {Data: []byte("id: beatles\nname: The Beatles\naliases: [битлз]\nyears: [1960]\nplace: {name: L, lat: 1, lon: 1}\ngenre: rock\nlinks:\n  - to: card:rock-n-roll\n    claim: c" + two + "\n")},
	}
	s, err := LoadFS(fsys)
	if err != nil {
		t.Fatal(err)
	}
	cards := &card.Set{ByID: map[string]*card.Card{"rock-n-roll": {ID: "rock-n-roll"}}}
	if errs := s.Validate(cards); len(errs) != 0 {
		t.Fatal(errs)
	}
	ps, _ := s.Paths("oasis", 8)
	if len(ps) != 1 || len(ps[0]) != 2 || ps[0][1].Link.To != "card:rock-n-roll" {
		t.Fatalf("%+v", ps)
	}
	if f := s.Find("Битлз"); len(f) != 1 || f[0].ID != "beatles" {
		t.Fatal("alias search")
	}
	s.ByID["beatles"].Links[0].Sources = s.ByID["beatles"].Links[0].Sources[:1]
	errs := s.Validate(cards)
	if len(errs) == 0 || !strings.Contains(errs[0].Error(), "want at least 2") {
		t.Fatal("one source must fail")
	}
}

func TestBorrowingKinds(t *testing.T) {
	for _, kind := range []string{"cover", "sample", "interpolation"} {
		t.Run(kind, func(t *testing.T) {
			fsys := fstest.MapFS{
				"artist.yaml": {Data: []byte("id: artist\nname: Artist\nyears: [2000]\nplace: {name: City}\ngenre: pop\nlinks:\n  - to: card:jazz\n    kind: " + kind + "\n    what: A replayed melody\n    whatRu: Заново сыгранная мелодия\n    claim: A documented borrowing" + two + "\n")},
			}
			s, err := LoadFS(fsys)
			if err != nil {
				t.Fatal(err)
			}
			cards := &card.Set{ByID: map[string]*card.Card{"jazz": {ID: "jazz"}}}
			if errs := s.Validate(cards); len(errs) != 0 {
				t.Fatal(errs)
			}
			for _, missing := range []string{"", "   "} {
				s.ByID["artist"].Links[0].What = missing
				errs := s.Validate(cards)
				if len(errs) != 1 || !strings.Contains(errs[0].Error(), "must say what was taken") {
					t.Fatalf("borrowing without an identified source part must fail: %v", errs)
				}
			}
		})
	}
}

func TestElementLayer(t *testing.T) {
	q := `
    sources:
      - {title: a, url: "https://a", quote: "qa"}
      - {title: b, url: "https://b", quote: "qb"}`
	fsys := fstest.MapFS{
		"band.yaml":   {Data: []byte("id: band\nname: Band\nyears: [1960]\nplace: {name: L}\ngenre: rock\nlinks:\n  - to: card:blues\n    claim: c\n    carries: [riff]\n    how: The band took blues riffs.\n    howRu: Группа взяла блюзовые риффы." + two + "\n")},
		ElementsFile:  {Data: []byte("elements:\n  - id: riff\n    name: The riff\n    what: A short repeated phrase.\n    origin: [blues]" + q + "\n")},
		CardLinksFile: {Data: []byte("links:\n  - from: blues\n    to: work-songs\n    how: The holler bent its notes.\n    carries: [riff]\n    facts:\n      - {card: work-songs, quote: a long bending cry}\n")},
		LinesFile:     {Data: []byte("lines:\n  - id: blues\n    name: The blues line\n    path: [work-songs, blues]\n    elements: [riff]\n    overview: From hollers to the blues." + q + "\n")},
	}
	s, err := LoadFS(fsys)
	if err != nil {
		t.Fatal(err)
	}
	if len(s.Order) != 1 || len(s.Elements) != 1 || len(s.CardLinks) != 1 || len(s.Lines) != 1 {
		t.Fatalf("layer files must not load as artists: %+v", s)
	}
	cards := &card.Set{ByID: map[string]*card.Card{"blues": {ID: "blues", Roots: []string{"work-songs"}}, "work-songs": {ID: "work-songs"}}}
	if errs := s.Validate(cards); len(errs) != 0 {
		t.Fatal(errs)
	}
	if s.ByID["band"].Links[0].How == "" || s.CardLink("blues", "work-songs") == nil || s.Element("riff") == nil {
		t.Fatal("lookups")
	}
	s.ByID["band"].Links[0].Carries = []string{"swing"}
	if errs := s.Validate(cards); len(errs) != 1 || !strings.Contains(errs[0].Error(), "unknown element") {
		t.Fatalf("unknown element must fail: %v", errs)
	}
	s.ByID["band"].Links[0].Carries = []string{"riff"}
	s.CardLinks[0].To = "jazz"
	if errs := s.Validate(cards); len(errs) == 0 {
		t.Fatal("a card link to an unknown card must fail")
	}
	s.CardLinks[0].To = "work-songs"
	s.Elements[0].Sources = s.Elements[0].Sources[:1]
	if errs := s.Validate(cards); len(errs) != 1 || !strings.Contains(errs[0].Error(), "want at least 2") {
		t.Fatalf("an element with one source must fail: %v", errs)
	}
}
