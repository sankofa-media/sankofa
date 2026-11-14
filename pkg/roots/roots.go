// Package roots traces how artists and bands, often far from Black music on
// the surface, stand on Black traditions: a chain of documented influences
// that ends at a card of the museum. Every link carries its own sources.
package roots

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"sort"
	"strings"

	"sigs.k8s.io/yaml"

	"github.com/tym83/sankofa/pkg/card"
)

// Source backs one link.
type Source struct {
	Title string `json:"title"`
	URL   string `json:"url"`
}

// Link is one documented step of influence. To is either another artist of
// the collection ("root:<id>") or a museum card ("card:<id>").
type Link struct {
	To string `json:"to"`
	// Kind of borrowing: influence (named as an influence), cover (recorded
	// their song), sample (used a recording), interpolation (replayed part of
	// a composition), member (played in the band),
	// producer, scene (came out of the same scene), teacher, collaboration.
	Kind string `json:"kind,omitempty"`
	// What exactly was borrowed, for covers, samples and interpolations: the song or the
	// recording and what of it (beat, handclaps, a riff).
	What    string   `json:"what,omitempty"`
	WhatRU  string   `json:"whatRu,omitempty"`
	Claim   string   `json:"claim"`
	Sources []Source `json:"sources"`
	// Russian translation of the claim.
	ClaimRU string `json:"claimRu,omitempty"`
	// Carries lists the musical elements (elements.yaml ids) this step
	// actually transmitted; empty when the evidence shows no element.
	Carries []string `json:"carries,omitempty"`
	// How says in one sentence, in systemic terms, what the later artist took.
	How   string `json:"how,omitempty"`
	HowRU string `json:"howRu,omitempty"`
}

// Artist is someone whose roots we trace.
type Artist struct {
	ID      string     `json:"id"`
	Name    string     `json:"name"`
	NameRU  string     `json:"nameRu,omitempty"`
	Aliases []string   `json:"aliases,omitempty"` // for search: other spellings, Cyrillic
	Years   []int      `json:"years"`
	Place   card.Place `json:"place"`
	PlaceRU string     `json:"placeRu,omitempty"`
	Genre   string     `json:"genre"`
	GenreRU string     `json:"genreRu,omitempty"`
	// Story tells in two or three sentences how the artist grew out of the
	// tradition, built only from the facts of its own links.
	Story   string `json:"story,omitempty"`
	StoryRU string `json:"storyRu,omitempty"`
	Links   []Link `json:"links"`
}

var validKinds = map[string]bool{"influence": true, "cover": true, "sample": true, "interpolation": true, "member": true, "producer": true, "scene": true, "teacher": true, "collaboration": true}

// Quote is a source with the passage that backs a statement.
type Quote struct {
	Title string `json:"title"`
	URL   string `json:"url"`
	Quote string `json:"quote,omitempty"`
}

// Element is a musical idea that travelled from Black traditions into later
// music: blue notes, the riff, the breakbeat.
type Element struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	NameRU  string   `json:"nameRu,omitempty"`
	What    string   `json:"what"`
	WhatRU  string   `json:"whatRu,omitempty"`
	Origin  []string `json:"origin"` // museum card ids
	Sources []Quote  `json:"sources"`
}

// CardFact is a sentence of a museum card that a card link rests on.
type CardFact struct {
	Card  string `json:"card"`
	Quote string `json:"quote"`
}

// CardLink explains a step between two museum cards (a card and one of its
// roots) in terms of the elements it carried.
type CardLink struct {
	From    string     `json:"from"`
	To      string     `json:"to"`
	Kind    string     `json:"kind,omitempty"`
	How     string     `json:"how"`
	HowRU   string     `json:"howRu,omitempty"`
	Carries []string   `json:"carries,omitempty"`
	Facts   []CardFact `json:"facts,omitempty"`
	Sources []Quote    `json:"sources,omitempty"`
}

// Line is a main route through the traditions with a short overview.
type Line struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	NameRU     string   `json:"nameRu,omitempty"`
	Path       []string `json:"path"` // museum card ids, oldest first
	Elements   []string `json:"elements,omitempty"`
	Overview   string   `json:"overview"`
	OverviewRU string   `json:"overviewRu,omitempty"`
	Sources    []Quote  `json:"sources"`
}

// Set is a loaded collection.
type Set struct {
	ByID      map[string]*Artist
	Order     []string
	Elements  []Element
	CardLinks []CardLink
	Lines     []Line
}

// Files of the collection that are not artists.
const (
	ElementsFile  = "elements.yaml"
	CardLinksFile = "card-links.yaml"
	LinesFile     = "lines.yaml"
)

// Element returns the element with the id, or nil.
func (s *Set) Element(id string) *Element {
	for i := range s.Elements {
		if s.Elements[i].ID == id {
			return &s.Elements[i]
		}
	}
	return nil
}

// CardLink returns the explanation of the step from one card to another, or nil.
func (s *Set) CardLink(from, to string) *CardLink {
	for i := range s.CardLinks {
		if s.CardLinks[i].From == from && s.CardLinks[i].To == to {
			return &s.CardLinks[i]
		}
	}
	return nil
}

// LoadFS reads every *.yaml in fsys.
func LoadFS(fsys fs.FS) (*Set, error) {
	s := &Set{ByID: map[string]*Artist{}}
	err := fs.WalkDir(fsys, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || path.Ext(p) != ".yaml" {
			return err
		}
		data, err := fs.ReadFile(fsys, p)
		if err != nil {
			return err
		}
		switch path.Base(p) {
		case ElementsFile:
			var doc struct {
				Elements []Element `json:"elements"`
			}
			if err := yaml.UnmarshalStrict(data, &doc); err != nil {
				return fmt.Errorf("%s: %w", p, err)
			}
			s.Elements = doc.Elements
			return nil
		case CardLinksFile:
			var doc struct {
				Links []CardLink `json:"links"`
			}
			if err := yaml.UnmarshalStrict(data, &doc); err != nil {
				return fmt.Errorf("%s: %w", p, err)
			}
			s.CardLinks = doc.Links
			return nil
		case LinesFile:
			var doc struct {
				Lines []Line `json:"lines"`
			}
			if err := yaml.UnmarshalStrict(data, &doc); err != nil {
				return fmt.Errorf("%s: %w", p, err)
			}
			s.Lines = doc.Lines
			return nil
		}
		var a Artist
		if err := yaml.UnmarshalStrict(data, &a); err != nil {
			return fmt.Errorf("%s: %w", p, err)
		}
		if _, dup := s.ByID[a.ID]; dup {
			return fmt.Errorf("%s: duplicate id %q", p, a.ID)
		}
		s.ByID[a.ID] = &a
		s.Order = append(s.Order, a.ID)
		return nil
	})
	if errors.Is(err, fs.ErrNotExist) {
		return s, nil
	}
	sort.Strings(s.Order)
	return s, err
}

// LoadDir reads a directory; a missing directory is an empty set.
func LoadDir(dir string) (*Set, error) {
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		return &Set{ByID: map[string]*Artist{}}, nil
	}
	return LoadFS(os.DirFS(dir))
}

// Validate checks sources, references and that every artist reaches a card.
func (s *Set) Validate(cards *card.Set) []error {
	var errs []error
	for _, id := range s.Order {
		a := s.ByID[id]
		bad := func(f string, x ...any) { errs = append(errs, fmt.Errorf("roots %s: %s", id, fmt.Sprintf(f, x...))) }
		if a.Name == "" || a.Genre == "" || len(a.Years) == 0 || a.Place.Name == "" {
			bad("needs name, genre, years and place")
		}
		if len(a.Links) == 0 {
			bad("needs at least one link")
		}
		for i, l := range a.Links {
			if l.Kind != "" && !validKinds[l.Kind] {
				bad("link %d: unknown kind %q", i, l.Kind)
			}
			if (l.Kind == "sample" || l.Kind == "cover" || l.Kind == "interpolation") && strings.TrimSpace(l.What) == "" {
				bad("link %d: a %s must say what was taken", i, l.Kind)
			}
			if strings.TrimSpace(l.Claim) == "" {
				bad("link %d has no claim", i)
			}
			if len(l.Sources) < 2 {
				bad("link %d to %s has %d sources, want at least 2", i, l.To, len(l.Sources))
			}
			for _, src := range l.Sources {
				if src.Title == "" || !strings.HasPrefix(src.URL, "http") {
					bad("link %d: source needs a title and a URL", i)
				}
			}
			for _, e := range l.Carries {
				if s.Element(e) == nil {
					bad("link %d: unknown element %q", i, e)
				}
			}
			if len(l.Carries) > 0 && strings.TrimSpace(l.How) == "" {
				bad("link %d: carries elements but has no how", i)
			}
			kind, ref, _ := strings.Cut(l.To, ":")
			switch kind {
			case "card":
				if cards.ByID[ref] == nil {
					bad("link %d: unknown card %q", i, ref)
				}
			case "root":
				if s.ByID[ref] == nil {
					bad("link %d: unknown artist %q", i, ref)
				}
			default:
				bad("link %d: to must be card:<id> or root:<id>", i)
			}
		}
		if _, err := s.Paths(id, 8); err != nil {
			bad("%v", err)
		}
	}
	return append(errs, s.validateLayer(cards)...)
}

// validateLayer checks elements, card links and lines.
func (s *Set) validateLayer(cards *card.Set) []error {
	var errs []error
	bad := func(f string, x ...any) { errs = append(errs, fmt.Errorf(f, x...)) }
	quotes := func(what string, qs []Quote, min int) {
		if len(qs) < min {
			bad("%s has %d sources, want at least %d", what, len(qs), min)
		}
		for _, q := range qs {
			if q.Title == "" || !strings.HasPrefix(q.URL, "http") || strings.TrimSpace(q.Quote) == "" {
				bad("%s: source needs a title, a URL and a quote", what)
			}
		}
	}
	elements := func(what string, ids []string) {
		for _, e := range ids {
			if s.Element(e) == nil {
				bad("%s: unknown element %q", what, e)
			}
		}
	}
	seen := map[string]bool{}
	for _, e := range s.Elements {
		what := "element " + e.ID
		if e.ID == "" || seen[e.ID] {
			bad("%s: empty or duplicate id", what)
		}
		seen[e.ID] = true
		if e.Name == "" || strings.TrimSpace(e.What) == "" {
			bad("%s needs a name and what", what)
		}
		if len(e.Origin) == 0 {
			bad("%s needs an origin card", what)
		}
		for _, c := range e.Origin {
			if cards.ByID[c] == nil {
				bad("%s: unknown origin card %q", what, c)
			}
		}
		quotes(what, e.Sources, 2)
	}
	for _, cl := range s.CardLinks {
		what := "card link " + cl.From + " → " + cl.To
		from, to := cards.ByID[cl.From], cards.ByID[cl.To]
		if from == nil || to == nil {
			bad("%s: unknown card", what)
			continue
		}
		if !contains(from.Roots, cl.To) {
			bad("%s: %s is not among the roots of %s", what, cl.To, cl.From)
		}
		if strings.TrimSpace(cl.How) == "" {
			bad("%s has no how", what)
		}
		elements(what, cl.Carries)
		for _, f := range cl.Facts {
			if cards.ByID[f.Card] == nil || strings.TrimSpace(f.Quote) == "" {
				bad("%s: a fact needs a known card and a quote", what)
			}
		}
		if len(cl.Facts) == 0 {
			quotes(what, cl.Sources, 2)
		} else {
			quotes(what, cl.Sources, 0)
		}
	}
	for _, ln := range s.Lines {
		what := "line " + ln.ID
		if ln.Name == "" || strings.TrimSpace(ln.Overview) == "" || len(ln.Path) < 2 {
			bad("%s needs a name, an overview and a path", what)
		}
		for _, c := range ln.Path {
			if cards.ByID[c] == nil {
				bad("%s: unknown card %q", what, c)
			}
		}
		elements(what, ln.Elements)
		quotes(what, ln.Sources, 2)
	}
	return errs
}

func contains(xs []string, x string) bool {
	for _, y := range xs {
		if y == x {
			return true
		}
	}
	return false
}

// Step is one hop of a resolved path.
type Step struct {
	From  string // artist id
	Link  Link
	Depth int
}

// Paths returns every chain from the artist to museum cards (depth-first,
// each artist visited once per chain). An artist that cannot reach a card is
// an error.
func (s *Set) Paths(id string, maxDepth int) ([][]Step, error) {
	var out [][]Step
	var walk func(cur string, chain []Step, seen map[string]bool) error
	walk = func(cur string, chain []Step, seen map[string]bool) error {
		if len(chain) > maxDepth {
			return fmt.Errorf("chain from %s is longer than %d", id, maxDepth)
		}
		a := s.ByID[cur]
		if a == nil {
			return fmt.Errorf("unknown artist %q", cur)
		}
		for _, l := range a.Links {
			st := Step{From: cur, Link: l, Depth: len(chain)}
			next := append(append([]Step(nil), chain...), st)
			kind, ref, _ := strings.Cut(l.To, ":")
			if kind == "card" {
				out = append(out, next)
				continue
			}
			if seen[ref] {
				continue
			}
			seen2 := map[string]bool{ref: true}
			for k := range seen {
				seen2[k] = true
			}
			if err := walk(ref, next, seen2); err != nil {
				return err
			}
		}
		return nil
	}
	if err := walk(id, nil, map[string]bool{id: true}); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("%s does not reach any museum card", id)
	}
	return out, nil
}

// Find looks an artist up by id, name or alias, case-insensitively.
func (s *Set) Find(q string) []*Artist {
	q = strings.ToLower(strings.TrimSpace(q))
	var exact, part []*Artist
	for _, id := range s.Order {
		a := s.ByID[id]
		names := append([]string{a.ID, a.Name, a.NameRU}, a.Aliases...)
		for _, n := range names {
			n = strings.ToLower(n)
			if n == "" {
				continue
			}
			if n == q {
				exact = append(exact, a)
				break
			}
			if strings.Contains(n, q) {
				part = append(part, a)
				break
			}
		}
	}
	if len(exact) > 0 {
		return exact
	}
	return part
}
