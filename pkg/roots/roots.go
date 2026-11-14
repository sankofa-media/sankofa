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

// Source backs a statement: where it was read and the passage itself.
type Source struct {
	Title string `json:"title"`
	URL   string `json:"url"`
	Quote string `json:"quote,omitempty"`
}

// Evidence is one typed piece of proof for a link: the artist's own words
// (testimony), what they listened to and admired (listening), what critics
// heard (critics) or an analysis of the music (analysis).
type Evidence struct {
	Type string `json:"type"`
	// Dimensions of style this item documents (see Dimensions).
	Dimensions []string `json:"dimensions,omitempty"`
	Text       string   `json:"text"`
	TextRU     string   `json:"textRu,omitempty"`
	Source     Source   `json:"source"`
}

// Example is an optional small illustration of a link: one song, never the
// basis of the route.
type Example struct {
	Song   string `json:"song"`
	Text   string `json:"text"`
	TextRU string `json:"textRu,omitempty"`
	Source Source `json:"source"`
}

// Note records someone other than the artist (a producer, an engineer, a
// session player) who shaped one period of the artist's sound. A note is
// never a step of a route.
type Note struct {
	Period string `json:"period"`
	Who    string `json:"who"`
	Role   string `json:"role"`
	What   string `json:"what"`
	WhatRU string `json:"whatRu,omitempty"`
	Source Source `json:"source"`
}

// Link is one documented step of stylistic influence. To is another artist
// of the collection ("root:<id>"), a style ("style:<id>") or a museum card
// ("card:<id>").
// Legacy is a labelled note on how an artist's music passed on into Black
// traditions, the other direction from the routes. It points to museum cards
// and is never a step of a route.
type Legacy struct {
	Text    string   `json:"text"`
	TextRU  string   `json:"textRu,omitempty"`
	Cards   []string `json:"cards"`
	Sources []Source `json:"sources"`
}

type Link struct {
	To string `json:"to"`
	// Kind: influence (the artist listened to and drew on the target), style
	// (works in that style or card genre), scene, teacher.
	Kind string `json:"kind"`
	// Scope: career (formation of the style) or period (a named period or
	// album, in Period). Only career links make a main route.
	Scope  string `json:"scope"`
	Period string `json:"period,omitempty"`
	// How says in style terms what passed on.
	How   string `json:"how"`
	HowRU string `json:"howRu,omitempty"`
	// Carries lists the musical elements (elements.yaml ids) this step
	// transmitted.
	Carries []string `json:"carries,omitempty"`
	// Dimensions of style this link documents; the rest are not documented.
	Dimensions []string   `json:"dimensions"`
	Evidence   []Evidence `json:"evidence"`
	Example    *Example   `json:"example,omitempty"`
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
	// Story tells in two or three sentences how the artist's style grew out
	// of the tradition, built only from the facts of its own links.
	Story   string  `json:"story,omitempty"`
	StoryRU string  `json:"storyRu,omitempty"`
	Links   []Link  `json:"links"`
	Notes   []Note  `json:"notes,omitempty"`
	Legacy  *Legacy `json:"legacy,omitempty"`
}

// Trait is a short stylistic feature of a style.
type Trait struct {
	EN string `json:"en"`
	RU string `json:"ru,omitempty"`
}

// Style is a style artists work in that is not a museum card: British beat,
// soul, grunge. It grows out of other styles or cards through From.
type Style struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	NameRU  string   `json:"nameRu,omitempty"`
	Years   []int    `json:"years"`
	Place   string   `json:"place"`
	PlaceRU string   `json:"placeRu,omitempty"`
	Traits  []Trait  `json:"traits"`
	Sources []Source `json:"sources"`
	From    []Link   `json:"from"`
}

// Evidence types, dimensions, link kinds, scopes and note roles.
var (
	EvidenceTypes = []string{"testimony", "listening", "critics", "analysis"}
	Dimensions    = []string{"rhythm", "harmony-form", "melody-vocal", "sound", "performance", "image"}
	validKinds    = []string{"influence", "style", "scene", "teacher"}
	validScopes   = []string{"career", "period"}
	noteRoles     = []string{"producer", "engineer", "session", "collaborator", "label"}
)

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
	Styles    []Style
	Elements  []Element
	CardLinks []CardLink
	Lines     []Line
}

// Files of the collection that are not artists.
const (
	StylesFile    = "styles.yaml"
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

// Style returns the style with the id, or nil.
func (s *Set) Style(id string) *Style {
	for i := range s.Styles {
		if s.Styles[i].ID == id {
			return &s.Styles[i]
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

// LoadFS reads every *.yaml in fsys. A file that does not parse is
// reported, and the rest of the collection still loads, so a check can
// list every problem at once.
func LoadFS(fsys fs.FS) (*Set, error) {
	s := &Set{ByID: map[string]*Artist{}}
	var bad []error
	err := fs.WalkDir(fsys, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || path.Ext(p) != ".yaml" {
			return err
		}
		data, err := fs.ReadFile(fsys, p)
		if err != nil {
			return err
		}
		if err := s.loadFile(p, data); err != nil {
			bad = append(bad, err)
		}
		return nil
	})
	if errors.Is(err, fs.ErrNotExist) {
		return s, nil
	}
	sort.Strings(s.Order)
	if err != nil {
		return s, err
	}
	return s, errors.Join(bad...)
}

func (s *Set) loadFile(p string, data []byte) error {
	switch path.Base(p) {
	case StylesFile:
		var doc struct {
			Styles []Style `json:"styles"`
		}
		if err := yaml.UnmarshalStrict(data, &doc); err != nil {
			return fmt.Errorf("%s: %w", p, err)
		}
		s.Styles = doc.Styles
		return nil
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
}

// LoadDir reads a directory; a missing directory is an empty set.
func LoadDir(dir string) (*Set, error) {
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		return &Set{ByID: map[string]*Artist{}}, nil
	}
	return LoadFS(os.DirFS(dir))
}

// Validate checks evidence, references, cycles and that every artist and
// style reaches a museum card through career-scope steps.
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
			for _, e := range s.checkLink(l, cards, false) {
				bad("link %d to %s: %s", i, l.To, e)
			}
		}
		for i, n := range a.Notes {
			if strings.TrimSpace(n.Period) == "" || strings.TrimSpace(n.Who) == "" || strings.TrimSpace(n.What) == "" || !contains(noteRoles, n.Role) {
				bad("note %d needs a period, who, a role (%s) and what", i, strings.Join(noteRoles, ", "))
			}
			if !quoted(n.Source) {
				bad("note %d: source needs a title, a URL and a quote", i)
			}
		}
		if lg := a.Legacy; lg != nil {
			if strings.TrimSpace(lg.Text) == "" || strings.TrimSpace(lg.TextRU) == "" {
				bad("legacy needs text and textRu")
			}
			if len(lg.Cards) == 0 {
				bad("legacy needs at least one card")
			}
			for _, c := range lg.Cards {
				if cards.ByID[c] == nil {
					bad("legacy: unknown card %q", c)
				}
			}
			hosts := map[string]bool{}
			for _, src := range lg.Sources {
				if !quoted(src) {
					bad("legacy: source needs a title, a URL and a quote")
				}
				hosts[host(src.URL)] = true
			}
			if len(hosts) < 2 {
				bad("legacy needs quoted sources from at least two websites")
			}
		}
	}
	seen := map[string]bool{}
	for _, st := range s.Styles {
		bad := func(f string, x ...any) { errs = append(errs, fmt.Errorf("style %s: %s", st.ID, fmt.Sprintf(f, x...))) }
		if st.ID == "" || seen[st.ID] {
			bad("empty or duplicate id")
		}
		seen[st.ID] = true
		if st.Name == "" || len(st.Years) == 0 || st.Place == "" {
			bad("needs name, years and place")
		}
		if len(st.Traits) < 3 || len(st.Traits) > 5 {
			bad("has %d traits, want 3 to 5", len(st.Traits))
		}
		for _, t := range st.Traits {
			if strings.TrimSpace(t.EN) == "" || strings.TrimSpace(t.RU) == "" {
				bad("a trait needs English and Russian")
			}
		}
		if len(st.Sources) < 2 {
			bad("has %d sources, want at least 2", len(st.Sources))
		}
		for _, src := range st.Sources {
			if !quoted(src) {
				bad("source needs a title, a URL and a quote")
			}
		}
		if len(st.From) == 0 {
			bad("needs at least one from step")
		}
		for i, l := range st.From {
			for _, e := range s.checkLink(l, cards, true) {
				bad("from %d to %s: %s", i, l.To, e)
			}
		}
	}
	if cyc := s.cycle(); cyc != nil {
		errs = append(errs, fmt.Errorf("roots: cycle %s", strings.Join(cyc, " → ")))
		return append(errs, s.validateLayer(cards)...)
	}
	for _, id := range s.Order {
		if _, err := s.Paths(id, 12); err != nil {
			errs = append(errs, fmt.Errorf("roots %s: %v", id, err))
		} else if _, err := s.MainPaths(id, 12); err != nil {
			errs = append(errs, fmt.Errorf("roots %s: %v", id, err))
		}
	}
	for _, st := range s.Styles {
		if _, err := s.MainPaths("style:"+st.ID, 12); err != nil {
			errs = append(errs, fmt.Errorf("style %s: %v", st.ID, err))
		}
	}
	return append(errs, s.validateLayer(cards)...)
}

func quoted(src Source) bool {
	return src.Title != "" && strings.HasPrefix(src.URL, "http") && strings.TrimSpace(src.Quote) != ""
}

func host(u string) string {
	u = strings.TrimPrefix(strings.TrimPrefix(u, "https://"), "http://")
	h, _, _ := strings.Cut(u, "/")
	return strings.TrimPrefix(strings.ToLower(h), "www.")
}

// checkLink validates one link of an artist, or one from step of a style
// (which may lead only to styles and cards).
func (s *Set) checkLink(l Link, cards *card.Set, ofStyle bool) []string {
	var out []string
	bad := func(f string, x ...any) { out = append(out, fmt.Sprintf(f, x...)) }
	if !contains(validKinds, l.Kind) {
		bad("kind %q, want one of %s", l.Kind, strings.Join(validKinds, ", "))
	}
	if !contains(validScopes, l.Scope) {
		bad("scope %q, want career or period", l.Scope)
	}
	if l.Scope == "period" && strings.TrimSpace(l.Period) == "" {
		bad("a period link must name its period")
	}
	if strings.TrimSpace(l.How) == "" || strings.TrimSpace(l.HowRU) == "" {
		bad("needs how and howRu")
	}
	for _, e := range l.Carries {
		if s.Element(e) == nil {
			bad("unknown element %q", e)
		}
	}
	if len(l.Dimensions) == 0 {
		bad("documents no dimension")
	}
	tagged := map[string]bool{}
	hosts := map[string]bool{}
	if len(l.Evidence) < 2 {
		bad("has %d evidence items, want at least 2", len(l.Evidence))
	}
	for j, ev := range l.Evidence {
		if !contains(EvidenceTypes, ev.Type) {
			bad("evidence %d: type %q, want one of %s", j, ev.Type, strings.Join(EvidenceTypes, ", "))
		}
		if strings.TrimSpace(ev.Text) == "" || strings.TrimSpace(ev.TextRU) == "" {
			bad("evidence %d needs text and textRu", j)
		}
		if !quoted(ev.Source) {
			bad("evidence %d: source needs a title, a URL and a quote", j)
		}
		for _, d := range ev.Dimensions {
			if !contains(Dimensions, d) {
				bad("evidence %d: unknown dimension %q", j, d)
			}
			tagged[d] = true
		}
		hosts[host(ev.Source.URL)] = true
	}
	if len(l.Evidence) >= 2 && len(hosts) < 2 {
		bad("evidence comes from one website; want at least two independent ones")
	}
	for _, d := range l.Dimensions {
		if !contains(Dimensions, d) {
			bad("unknown dimension %q", d)
		} else if !tagged[d] {
			bad("dimension %q is not backed by any evidence item", d)
		}
	}
	if ex := l.Example; ex != nil {
		if strings.TrimSpace(ex.Song) == "" || strings.TrimSpace(ex.Text) == "" || !quoted(ex.Source) {
			bad("an example needs a song, text and a quoted source")
		}
	}
	kind, ref, _ := strings.Cut(l.To, ":")
	switch {
	case kind == "card":
		if cards.ByID[ref] == nil {
			bad("unknown card %q", ref)
		}
	case kind == "style":
		if s.Style(ref) == nil {
			bad("unknown style %q", ref)
		}
	case kind == "root" && !ofStyle:
		if s.ByID[ref] == nil {
			bad("unknown artist %q", ref)
		}
	default:
		if ofStyle {
			bad("a style grows from style:<id> or card:<id>")
		} else {
			bad("to must be root:<id>, style:<id> or card:<id>")
		}
	}
	return out
}

// node is an artist id or "style:<id>".
func (s *Set) linksOf(node string) []Link {
	if id, ok := strings.CutPrefix(node, "style:"); ok {
		if st := s.Style(id); st != nil {
			return st.From
		}
		return nil
	}
	if a := s.ByID[node]; a != nil {
		return a.Links
	}
	return nil
}

func next(l Link) (string, bool) {
	kind, ref, _ := strings.Cut(l.To, ":")
	switch kind {
	case "root":
		return ref, true
	case "style":
		return l.To, true
	}
	return "", false
}

// cycle returns one cycle among artists and styles, or nil.
func (s *Set) cycle() []string {
	const (
		white = iota
		grey
		black
	)
	color := map[string]int{}
	var stack, found []string
	var visit func(n string) bool
	visit = func(n string) bool {
		color[n] = grey
		stack = append(stack, n)
		for _, l := range s.linksOf(n) {
			m, ok := next(l)
			if !ok {
				continue
			}
			switch color[m] {
			case grey:
				for i, x := range stack {
					if x == m {
						found = append(append([]string(nil), stack[i:]...), m)
					}
				}
				return true
			case white:
				if visit(m) {
					return true
				}
			}
		}
		stack = stack[:len(stack)-1]
		color[n] = black
		return false
	}
	nodes := append([]string(nil), s.Order...)
	for _, st := range s.Styles {
		nodes = append(nodes, "style:"+st.ID)
	}
	for _, n := range nodes {
		if color[n] == white && visit(n) {
			return found
		}
	}
	return nil
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
	From  string // artist id or "style:<id>"
	Link  Link
	Depth int
}

// Career reports whether every step of the path is a career-scope link.
func Career(p []Step) bool {
	for _, st := range p {
		if st.Link.Scope != "career" {
			return false
		}
	}
	return true
}

// Paths returns every chain from an artist (or "style:<id>") to museum
// cards, depth-first, each node visited once per chain; chains made only of
// career links come first. A node that cannot reach a card is an error.
func (s *Set) Paths(id string, maxDepth int) ([][]Step, error) {
	var out [][]Step
	var walk func(cur string, chain []Step, seen map[string]bool) error
	walk = func(cur string, chain []Step, seen map[string]bool) error {
		if len(chain) > maxDepth {
			return fmt.Errorf("chain from %s is longer than %d", id, maxDepth)
		}
		if !strings.HasPrefix(cur, "style:") && s.ByID[cur] == nil {
			return fmt.Errorf("unknown artist %q", cur)
		}
		for _, l := range s.linksOf(cur) {
			st := Step{From: cur, Link: l, Depth: len(chain)}
			nextChain := append(append([]Step(nil), chain...), st)
			ref, ok := next(l)
			if !ok {
				out = append(out, nextChain)
				continue
			}
			if seen[ref] {
				continue
			}
			seen2 := map[string]bool{ref: true}
			for k := range seen {
				seen2[k] = true
			}
			if err := walk(ref, nextChain, seen2); err != nil {
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
	sort.SliceStable(out, func(i, j int) bool { return Career(out[i]) && !Career(out[j]) })
	return out, nil
}

// MainPaths returns the chains made only of career-scope links: the routes
// that may stand for the artist. A period-only influence is never one.
func (s *Set) MainPaths(id string, maxDepth int) ([][]Step, error) {
	ps, err := s.Paths(id, maxDepth)
	if err != nil {
		return nil, err
	}
	var out [][]Step
	for _, p := range ps {
		if Career(p) {
			out = append(out, p)
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("%s reaches a museum card only through period-scope links", id)
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
