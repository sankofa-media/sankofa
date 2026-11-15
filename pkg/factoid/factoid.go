// Package factoid reads the museum's short verified facts: one sentence, a
// year, sometimes a place, the cards it belongs to and two sources. Only
// factoids whose status is "checked" are ever shown; the rest stay in the
// workshop until someone has checked them.
package factoid

import (
	"fmt"
	"io/fs"
	"path"
	"sort"
	"strings"

	"sigs.k8s.io/yaml"

	"github.com/tym83/sankofa/pkg/card"
)

// Checked is the only status a factoid may be shown with.
const Checked = "checked"

// MaxWords is the longest a factoid may be, in either language.
const MaxWords = 30

// Place is where a factoid happened.
type Place struct {
	Name string   `json:"name"`
	Lat  *float64 `json:"lat"`
	Lon  *float64 `json:"lon"`
}

// Source is one of the two places a factoid was checked against.
type Source struct {
	Title string `json:"title"`
	URL   string `json:"url"`
	Quote string `json:"quote,omitempty"`
}

// Factoid is one verified fact.
type Factoid struct {
	ID      string   `json:"id"`
	Cat     string   `json:"cat"`
	EN      string   `json:"en"`
	RU      string   `json:"ru"`
	Year    int      `json:"year"`
	Date    string   `json:"date,omitempty"`
	Place   *Place   `json:"place,omitempty"`
	Cards   []string `json:"cards"`
	Gender  string   `json:"gender,omitempty"`
	Region  string   `json:"region,omitempty"`
	Sources []Source `json:"sources"`
	Note    string   `json:"note,omitempty"`
	Status  string   `json:"status"`
}

// Text is the factoid in a language; English when there is no other.
func (f *Factoid) Text(lang string) string {
	if lang == "ru" && f.RU != "" {
		return f.RU
	}
	return f.EN
}

// LoadFS reads every *.yaml file at the top of fsys; each holds a list.
// It returns all factoids, checked or not, in file and list order.
func LoadFS(fsys fs.FS) ([]Factoid, error) {
	names, err := fs.Glob(fsys, "*.yaml")
	if err != nil {
		return nil, err
	}
	sort.Strings(names)
	var out []Factoid
	for _, n := range names {
		data, err := fs.ReadFile(fsys, n)
		if err != nil {
			return nil, err
		}
		var list []Factoid
		if err := yaml.UnmarshalStrict(data, &list); err != nil {
			return nil, fmt.Errorf("%s: %w", path.Base(n), err)
		}
		out = append(out, list...)
	}
	return out, nil
}

// Shown keeps only the checked factoids.
func Shown(all []Factoid) []Factoid {
	var out []Factoid
	for _, f := range all {
		if f.Status == Checked {
			out = append(out, f)
		}
	}
	return out
}

// Validate checks the factoids that will be shown: unique ids, both
// languages, at most MaxWords words, a year, cards that exist, a place with
// coordinates, two sources with links. `cards` may be nil to skip the card
// check (no collection at hand).
func Validate(shown []Factoid, cards *card.Set) []error {
	var errs []error
	bad := func(f *Factoid, format string, a ...any) {
		errs = append(errs, fmt.Errorf("%s: %s", f.ID, fmt.Sprintf(format, a...)))
	}
	seen := map[string]bool{}
	for i := range shown {
		f := &shown[i]
		if f.ID == "" {
			errs = append(errs, fmt.Errorf("factoid %d (%.40q): no id", i, f.EN))
			continue
		}
		if seen[f.ID] {
			bad(f, "duplicate id")
		}
		seen[f.ID] = true
		for _, t := range []struct{ lang, text string }{{"en", f.EN}, {"ru", f.RU}} {
			if strings.TrimSpace(t.text) == "" {
				bad(f, "no %s text", t.lang)
			} else if n := len(strings.Fields(t.text)); n > MaxWords {
				bad(f, "%s text has %d words, more than %d", t.lang, n, MaxWords)
			}
		}
		if f.Year == 0 {
			bad(f, "no year")
		}
		if f.Place != nil {
			switch {
			case f.Place.Lat == nil || f.Place.Lon == nil:
				bad(f, "place %q has no lat/lon", f.Place.Name)
			case *f.Place.Lat < -90 || *f.Place.Lat > 90 || *f.Place.Lon < -180 || *f.Place.Lon > 180:
				bad(f, "place %q is off the globe", f.Place.Name)
			}
		}
		if cards != nil {
			for _, id := range f.Cards {
				if cards.ByID[id] == nil {
					bad(f, "card %q does not exist", id)
				}
			}
		}
		if len(f.Sources) < 2 {
			bad(f, "%d sources, two are needed", len(f.Sources))
		}
		for _, s := range f.Sources {
			if strings.TrimSpace(s.Title) == "" || !strings.HasPrefix(s.URL, "http") {
				bad(f, "source %q needs a title and a link", s.Title)
			}
		}
	}
	return errs
}

// Load reads, filters and validates: the factoids a reader may see.
func Load(fsys fs.FS, cards *card.Set) ([]Factoid, error) {
	all, err := LoadFS(fsys)
	if err != nil {
		return nil, err
	}
	shown := Shown(all)
	if errs := Validate(shown, cards); len(errs) > 0 {
		return nil, fmt.Errorf("%d factoid problems, first: %w", len(errs), errs[0])
	}
	return shown, nil
}
