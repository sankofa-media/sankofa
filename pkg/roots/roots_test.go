package roots

import (
	"strings"
	"testing"
	"testing/fstest"

	"github.com/sankofa-media/sankofa/pkg/card"
)

// link renders a link with two evidence items from two websites.
func link(to, scope string) string {
	return `
  - to: ` + to + `
    kind: influence
    scope: ` + scope + `
    period: "1975"
    how: Took the backbeat and the shouted vocal.
    howRu: Взяли бэкбит и крик в голосе.
    carries: [backbeat]
    dimensions: [rhythm, melody-vocal]
    evidence:
      - type: testimony
        dimensions: [rhythm]
        text: They say so.
        textRu: Они так говорят.
        source: {title: a, url: "https://a.org/x", quote: "qa"}
      - type: critics
        dimensions: [melody-vocal]
        text: Critics heard it.
        textRu: Критики это услышали.
        source: {title: b, url: "https://www.b.com/y", quote: "qb"}`
}

// indented shifts a link under a style's from.
func indented(l string) string { return strings.ReplaceAll(l, "\n", "\n    ") }

func artist(id, links string) []byte {
	return []byte("id: " + id + "\nname: " + id + "\naliases: [битлз]\nyears: [1960]\nplace: {name: L, lat: 1, lon: 1}\ngenre: rock\nlinks:" + links + "\n")
}

const style = `styles:
  - id: beat
    name: British beat
    years: [1962]
    place: Liverpool
    traits:
      - {en: backbeat, ru: бэкбит}
      - {en: guitars, ru: гитары}
      - {en: harmony vocals, ru: многоголосие}
    sources:
      - {title: a, url: "https://a.org", quote: "qa"}
      - {title: b, url: "https://b.org", quote: "qb"}
    from:`

func load(t *testing.T, files map[string]string) *Set {
	t.Helper()
	fsys := fstest.MapFS{}
	for k, v := range files {
		fsys[k] = &fstest.MapFile{Data: []byte(v)}
	}
	s, err := LoadFS(fsys)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

var cards = &card.Set{ByID: map[string]*card.Card{"rock-n-roll": {ID: "rock-n-roll"}, "blues": {ID: "blues"}}}

const elements = `elements:
  - id: backbeat
    name: Backbeat
    what: Two and four.
    origin: [blues]
    sources:
      - {title: a, url: "https://a", quote: "qa"}
      - {title: b, url: "https://b", quote: "qb"}
`

func TestStyleRoute(t *testing.T) {
	s := load(t, map[string]string{
		"oasis.yaml":   string(artist("oasis", link("root:beatles", "career"))),
		"beatles.yaml": string(artist("beatles", link("style:beat", "career"))),
		StylesFile:     style + indented(link("card:rock-n-roll", "career")),
		ElementsFile:   elements,
	})
	if errs := s.Validate(cards); len(errs) != 0 {
		t.Fatal(errs)
	}
	ps, _ := s.MainPaths("oasis", 8)
	if len(ps) != 1 || len(ps[0]) != 3 || ps[0][1].From != "beatles" || ps[0][2].From != "style:beat" || ps[0][2].Link.To != "card:rock-n-roll" {
		t.Fatalf("%+v", ps)
	}
	if f := s.Find("Битлз"); len(f) != 2 {
		t.Fatal("alias search")
	}
}

func TestPeriodOnlyIsNotARoute(t *testing.T) {
	s := load(t, map[string]string{
		"bowie.yaml": string(artist("bowie", link("card:rock-n-roll", "period"))),
		ElementsFile: elements,
	})
	errs := s.Validate(cards)
	if len(errs) != 1 || !strings.Contains(errs[0].Error(), "only through period-scope") {
		t.Fatalf("a period-only route must fail: %v", errs)
	}
}

func TestCycle(t *testing.T) {
	s := load(t, map[string]string{
		"a.yaml":     string(artist("a", link("root:b", "career")+link("card:blues", "career"))),
		"b.yaml":     string(artist("b", link("root:a", "career"))),
		ElementsFile: elements,
	})
	errs := s.Validate(cards)
	if len(errs) == 0 || !strings.Contains(errs[0].Error(), "cycle") {
		t.Fatalf("a cycle must fail: %v", errs)
	}
}

func TestStyleMustReachCard(t *testing.T) {
	s := load(t, map[string]string{
		"x.yaml":     string(artist("x", link("style:beat", "career"))),
		StylesFile:   style + indented(link("root:x", "career")),
		ElementsFile: elements,
	})
	errs := s.Validate(cards)
	joined := ""
	for _, e := range errs {
		joined += e.Error() + "\n"
	}
	if !strings.Contains(joined, "a style grows from style:<id> or card:<id>") {
		t.Fatalf("a style leading to an artist must fail: %v", errs)
	}
}

func TestEvidenceRules(t *testing.T) {
	cases := map[string]struct{ from, to, want string }{
		"one website":         {`url: "https://www.b.com/y"`, `url: "https://a.org/z"`, "one website"},
		"missing quote":       {`quote: "qb"`, `quote: ""`, "needs a title, a URL and a quote"},
		"unknown type":        {`type: critics`, `type: rumour`, `type "rumour"`},
		"unbacked dimension":  {`dimensions: [melody-vocal]`, `dimensions: [rhythm]`, `dimension "melody-vocal" is not backed`},
		"unknown kind":        {`kind: influence`, `kind: cover`, `kind "cover"`},
		"period without name": {`period: "1975"`, `period: ""`, "must name its period"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			scope := "career"
			if name == "period without name" {
				scope = "period"
			}
			l := strings.Replace(link("card:blues", scope), c.from, c.to, 1)
			s := load(t, map[string]string{"x.yaml": string(artist("x", l+link("card:rock-n-roll", "career"))), ElementsFile: elements})
			errs := s.Validate(cards)
			if len(errs) == 0 || !strings.Contains(errs[0].Error(), c.want) {
				t.Fatalf("want %q, got %v", c.want, errs)
			}
		})
	}
}

func TestNotes(t *testing.T) {
	s := load(t, map[string]string{
		"x.yaml":     string(artist("x", link("card:blues", "career"))) + "notes:\n  - {period: \"1977\", who: Eno, role: producer, what: Shaped the sound., source: {title: a, url: \"https://a\", quote: q}}\n",
		ElementsFile: elements,
	})
	if errs := s.Validate(cards); len(errs) != 0 {
		t.Fatal(errs)
	}
	s.ByID["x"].Notes[0].Role = "uncle"
	if errs := s.Validate(cards); len(errs) != 1 || !strings.Contains(errs[0].Error(), "note 0") {
		t.Fatalf("a note with an unknown role must fail: %v", errs)
	}
}

func TestLegacy(t *testing.T) {
	s := load(t, map[string]string{
		"x.yaml": string(artist("x", link("card:blues", "career"))) + `legacy:
  text: Their music went on into the blues.
  textRu: Их музыка ушла дальше, в блюз.
  cards: [blues]
  sources:
    - {title: a, url: "https://a.org/l", quote: qa}
    - {title: b, url: "https://b.org/l", quote: qb}
`,
		ElementsFile: elements,
	})
	if errs := s.Validate(cards); len(errs) != 0 {
		t.Fatal(errs)
	}
	if ps, _ := s.MainPaths("x", 8); len(ps) != 1 {
		t.Fatalf("a legacy note is never a route step: %+v", ps)
	}
	s.ByID["x"].Legacy.Cards = []string{"nowhere"}
	s.ByID["x"].Legacy.Sources = s.ByID["x"].Legacy.Sources[:1]
	errs := s.Validate(cards)
	joined := ""
	for _, e := range errs {
		joined += e.Error() + "\n"
	}
	if len(errs) != 2 || !strings.Contains(joined, `unknown card "nowhere"`) || !strings.Contains(joined, "two websites") {
		t.Fatalf("a legacy note needs known cards and two websites: %v", errs)
	}
}

func TestElementLayer(t *testing.T) {
	q := `
    sources:
      - {title: a, url: "https://a", quote: "qa"}
      - {title: b, url: "https://b", quote: "qb"}`
	s := load(t, map[string]string{
		"band.yaml":   string(artist("band", link("card:blues", "career"))),
		ElementsFile:  elements,
		CardLinksFile: "links:\n  - from: blues\n    to: work-songs\n    how: The holler bent its notes.\n    carries: [backbeat]\n    facts:\n      - {card: work-songs, quote: a long bending cry}\n",
		LinesFile:     "lines:\n  - id: blues\n    name: The blues line\n    path: [work-songs, blues]\n    elements: [backbeat]\n    overview: From hollers to the blues." + q + "\n",
	})
	if len(s.Order) != 1 || len(s.Elements) != 1 || len(s.CardLinks) != 1 || len(s.Lines) != 1 {
		t.Fatalf("layer files must not load as artists: %+v", s)
	}
	cs := &card.Set{ByID: map[string]*card.Card{"blues": {ID: "blues", Roots: []string{"work-songs"}}, "work-songs": {ID: "work-songs"}}}
	if errs := s.Validate(cs); len(errs) != 0 {
		t.Fatal(errs)
	}
	s.ByID["band"].Links[0].Carries = []string{"swing"}
	if errs := s.Validate(cs); len(errs) != 1 || !strings.Contains(errs[0].Error(), "unknown element") {
		t.Fatalf("unknown element must fail: %v", errs)
	}
	s.ByID["band"].Links[0].Carries = nil
	s.CardLinks[0].To = "jazz"
	if errs := s.Validate(cs); len(errs) == 0 {
		t.Fatal("a card link to an unknown card must fail")
	}
}
