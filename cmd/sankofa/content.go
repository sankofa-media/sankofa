package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/spf13/cobra"
	"sigs.k8s.io/yaml"

	"github.com/sankofa-media/sankofa/api/v1alpha1"
	"github.com/sankofa-media/sankofa/pkg/card"
	"github.com/sankofa-media/sankofa/pkg/factoid"
	"github.com/sankofa-media/sankofa/pkg/roots"
)

func contentCmd() *cobra.Command {
	c := &cobra.Command{Use: "content", Short: "Work with the card collection"}
	c.AddCommand(&cobra.Command{
		Use:   "lint DIR",
		Short: "Validate cards: sources, links, coordinates, length",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			s, err := card.LoadDir(args[0])
			if err != nil {
				return err
			}
			errs := s.Validate()
			errs = append(errs, lintQuests(filepath.Join(args[0], "..", "quests"), s)...)
			errs = append(errs, lintChapters(filepath.Join(args[0], "..", "chapters"), s)...)
			if rs, err := roots.LoadDir(filepath.Join(args[0], "..", "roots")); err != nil {
				errs = append(errs, err)
			} else {
				errs = append(errs, rs.Validate(s)...)
			}
			if all, err := factoid.LoadFS(os.DirFS(filepath.Join(args[0], "..", "factoids"))); err != nil {
				errs = append(errs, err)
			} else {
				errs = append(errs, factoid.Validate(factoid.Shown(all), s)...)
			}
			for _, e := range errs {
				fmt.Fprintln(cmd.ErrOrStderr(), e)
			}
			if len(errs) > 0 {
				return fmt.Errorf("%d problems in %d cards", len(errs), len(s.Order))
			}
			fmt.Fprintf(cmd.OutOrStdout(), "%d cards OK\n", len(s.Order))
			return nil
		},
	})
	var out string
	exp := &cobra.Command{
		Use:   "export DIR",
		Short: "Export cards as JSON for the web museum",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			s, err := card.LoadDir(args[0])
			if err != nil {
				return err
			}
			if errs := s.Validate(); len(errs) > 0 {
				return fmt.Errorf("content does not lint: %v", errs[0])
			}
			doc := Export(s)
			if rs, err := roots.LoadDir(filepath.Join(args[0], "..", "roots")); err == nil {
				doc["roots"] = ExportRoots(rs)
				doc["rootsStyles"] = rs.Styles
				doc["rootsElements"] = rs.Elements
				doc["rootsCardLinks"] = rs.CardLinks
				doc["rootsLines"] = rs.Lines
			}
			data, err := json.MarshalIndent(doc, "", " ")
			if err != nil {
				return err
			}
			if out == "-" {
				_, err = cmd.OutOrStdout().Write(data)
				return err
			}
			if err := os.MkdirAll(filepath.Dir(out), 0o755); err != nil {
				return err
			}
			return os.WriteFile(out, data, 0o644)
		},
	}
	exp.Flags().StringVarP(&out, "out", "o", "-", "output file")
	c.AddCommand(exp)
	c.AddCommand(factoidsExportCmd())
	return c
}

// factoidsExportCmd writes the checked factoids for the web museum, after
// validating them against the cards; unverified factoids never leave here.
func factoidsExportCmd() *cobra.Command {
	var out, cards string
	c := &cobra.Command{
		Use:   "factoids DIR",
		Short: "Validate the checked factoids and export them as JSON for the web museum",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			var s *card.Set
			if cards != "" {
				var err error
				if s, err = card.LoadDir(cards); err != nil {
					return err
				}
			}
			var shown []factoid.Factoid
			if _, err := os.Stat(args[0]); err == nil {
				all, err := factoid.LoadFS(os.DirFS(args[0]))
				if err != nil {
					return err
				}
				shown = factoid.Shown(all)
				if errs := factoid.Validate(shown, s); len(errs) > 0 {
					for _, e := range errs {
						fmt.Fprintln(cmd.ErrOrStderr(), e)
					}
					return fmt.Errorf("%d problems in %d checked factoids", len(errs), len(shown))
				}
				fmt.Fprintf(cmd.ErrOrStderr(), "factoids: %d checked of %d\n", len(shown), len(all))
			}
			doc := map[string]any{"version": 1, "factoids": ExportFactoids(shown)}
			data, err := json.Marshal(doc)
			if err != nil {
				return err
			}
			if out == "-" {
				_, err = cmd.OutOrStdout().Write(data)
				return err
			}
			if err := os.MkdirAll(filepath.Dir(out), 0o755); err != nil {
				return err
			}
			return os.WriteFile(out, data, 0o644)
		},
	}
	c.Flags().StringVarP(&out, "out", "o", "-", "output file")
	c.Flags().StringVar(&cards, "cards", "", "card directory the factoids' cards must exist in")
	return c
}

// ExportedFactoid is a factoid as the web museum shows it: no workshop fields.
type ExportedFactoid struct {
	ID      string           `json:"id"`
	Cat     string           `json:"cat"`
	EN      string           `json:"en"`
	RU      string           `json:"ru"`
	Year    int              `json:"year"`
	Date    string           `json:"date,omitempty"`
	Place   *exportedPlace   `json:"place,omitempty"`
	Cards   []string         `json:"cards"`
	Sources []exportedSource `json:"sources"`
	Status  string           `json:"status,omitempty"`
}

// The museum shows a source's title and link; the quote stays in the workshop.
type exportedSource struct {
	Title string `json:"title"`
	URL   string `json:"url"`
}

type exportedPlace struct {
	Name string  `json:"name"`
	Lat  float64 `json:"lat"`
	Lon  float64 `json:"lon"`
}

// ExportFactoids prepares validated factoids for the web museum.
func ExportFactoids(fs []factoid.Factoid) []ExportedFactoid {
	out := make([]ExportedFactoid, 0, len(fs))
	for _, f := range fs {
		e := ExportedFactoid{ID: f.ID, Cat: f.Cat, EN: f.EN, RU: f.RU, Year: f.Year, Date: f.Date, Cards: f.Cards}
		if f.Status == factoid.SingleSource {
			e.Status = f.Status
		}
		for _, s := range f.Sources {
			e.Sources = append(e.Sources, exportedSource{Title: s.Title, URL: s.URL})
		}
		if e.Cards == nil {
			e.Cards = []string{}
		}
		if f.Place != nil && f.Place.Lat != nil && f.Place.Lon != nil {
			e.Place = &exportedPlace{Name: f.Place.Name, Lat: *f.Place.Lat, Lon: *f.Place.Lon}
		}
		out = append(out, e)
	}
	return out
}

// ExportedCard is a card as the web museum sees it.
type ExportedCard struct {
	*card.Card
	Backlinks []string `json:"backlinks"`
}

// Export prepares a card set for the web museum.
func Export(s *card.Set) map[string]any {
	cards := make([]ExportedCard, 0, len(s.Order))
	for _, id := range s.Order {
		cards = append(cards, ExportedCard{Card: s.Resolved(s.ByID[id]), Backlinks: s.Backlinks(id)})
	}
	return map[string]any{"version": 1, "cards": cards}
}

// lintQuests checks quests against the cards they reference.
func lintQuests(dir string, s *card.Set) []error {
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		return nil
	}
	qs, err := v1alpha1.LoadQuests(os.DirFS(dir))
	if err != nil {
		return []error{err}
	}
	var errs []error
	for _, q := range qs {
		bad := func(f string, a ...any) {
			errs = append(errs, fmt.Errorf("quest %s: %s", q.Name, fmt.Sprintf(f, a...)))
		}
		sp := q.Spec
		if sp.Title == "" || sp.Prompt == "" || sp.Reveal == "" {
			bad("needs title, prompt and reveal")
		}
		switch sp.Type {
		case "dilemma", "quiz":
			if len(sp.Choices) < 2 {
				bad("needs at least two choices")
			}
			if sp.Type == "quiz" && (sp.Answer == nil || *sp.Answer < 0 || *sp.Answer >= len(sp.Choices)) {
				bad("quiz needs a valid answer index")
			}
			if sp.Type == "dilemma" && sp.Answer != nil {
				bad("a dilemma has no right answer")
			}
		case "walk":
			if s.ByID[sp.From] == nil || s.ByID[sp.To] == nil {
				bad("walk needs existing from and to cards")
			}
		case "cluster":
			if sp.Check == "" {
				bad("cluster quest needs a check")
			}
		default:
			bad("unknown type %q", sp.Type)
		}
		for _, c := range sp.Cards {
			if s.ByID[c] == nil {
				bad("unknown card %q", c)
			}
		}
	}
	return errs
}

// chapter is the front matter of a museum chapter.
type chapter struct {
	ID     string       `json:"id"`
	Title  string       `json:"title"`
	Kicker string       `json:"kicker"`
	Years  []int        `json:"years"`
	Hero   *card.Media  `json:"hero,omitempty"`
	Places []card.Place `json:"places,omitempty"`
	Cards  []string     `json:"cards"`
}

// lintChapters checks chapters against the cards: ids, links and length.
func lintChapters(dir string, s *card.Set) []error {
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return []error{err}
	}
	var errs []error
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".md" || strings.HasSuffix(e.Name(), ".ru.md") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			return append(errs, err)
		}
		bad := func(f string, a ...any) {
			errs = append(errs, fmt.Errorf("chapter %s: %s", e.Name(), fmt.Sprintf(f, a...)))
		}
		parts := strings.SplitN(string(data), "\n---\n", 2)
		if !strings.HasPrefix(string(data), "---\n") || len(parts) != 2 {
			bad("missing front matter")
			continue
		}
		var ch chapter
		if err := yaml.UnmarshalStrict([]byte(strings.TrimPrefix(parts[0], "---\n")), &ch); err != nil {
			bad("front matter: %v", err)
			continue
		}
		if ch.ID == "" || ch.Title == "" {
			bad("needs id and title")
		}
		for _, id := range ch.Cards {
			if s.ByID[id] == nil {
				bad("unknown card %q", id)
			}
		}
		body := &card.Card{Body: parts[1]}
		for _, e := range card.ProseErrors(parts[1]) {
			bad("%s", e)
		}
		for _, l := range body.Links() {
			if s.ByID[l.Target] == nil {
				bad("link to unknown card %q", l.Target)
			}
		}
		labelled := 0
		paras := card.Paragraphs(parts[1])
		for i, p := range paras {
			label, _, err := stepLabel(p)
			if err != nil {
				bad("paragraph %d: %v", i+1, err)
			}
			if label != "" {
				labelled++
			}
		}
		if labelled > 0 && labelled < len(paras) {
			bad("%d of %d paragraphs carry an {at Place · Year} label: label all of them or none", labelled, len(paras))
		}
		for _, ed := range []string{card.EditionMale, card.EditionFemale} {
			steps := card.CopyParagraphs(parts[1], ed)
			for i, p := range steps {
				_, steps[i], _ = stepLabel(p)
			}
			if n := card.Words(strings.Join(steps, "\n\n")); n < 80 {
				bad("%s copy has %d words, want at least 80", ed, n)
			}
			if len(steps) < minChapterSteps || len(steps) > maxChapterSteps {
				bad("%s copy has %d steps, want %d..%d", ed, len(steps), minChapterSteps, maxChapterSteps)
			}
		}
		for i, p := range paras {
			_, p, _ = stepLabel(p)
			if n := card.Words(p); n > maxStepWords {
				bad("paragraph %d has %d words, want at most %d: a step must fit its box on a phone", i+1, n, maxStepWords)
			}
		}
		errs = append(errs, lintChapterTranslation(dir, e.Name(), parts[1], bad)...)
	}
	return errs
}

// A chapter is read as scroll steps, one per paragraph: a step must fit its
// text box on a phone, and a chapter needs enough steps for a rhythm but not
// so many that it turns into a feed. Each copy of the museum is counted alone.
const (
	maxStepWords    = 80
	minChapterSteps = 6
	maxChapterSteps = 14
)

// stepLabel splits a chapter paragraph into the label it shows and its text.
// After an optional {male}/{female} marker a paragraph may open with
// `{at Place · Year} `: one or two parts, short, no braces. The text keeps the
// copy marker.
func stepLabel(p string) (label, text string, err error) {
	marker := ""
	for _, m := range []string{card.MarkerMale, card.MarkerFemale} {
		if strings.HasPrefix(p, m) {
			marker, p = m, strings.TrimPrefix(p, m)
		}
	}
	if !strings.HasPrefix(p, "{at") {
		return "", marker + p, nil
	}
	end := strings.Index(p, "}")
	if !strings.HasPrefix(p, "{at ") || end < 0 || !strings.HasPrefix(p[end+1:], " ") {
		return "", marker + p, fmt.Errorf("malformed label, want `{at Place · Year} ` before the text")
	}
	label = strings.TrimSpace(p[len("{at "):end])
	text = marker + strings.TrimSpace(p[end+1:])
	parts := strings.Split(label, " · ")
	switch {
	case strings.ContainsAny(label, "{"):
		return label, text, fmt.Errorf("label %q holds a brace", label)
	case card.LinkInLabel(p):
		return label, text, fmt.Errorf("label %q holds a card link: link in the text, not the label", label)
	case len(parts) > 2:
		return label, text, fmt.Errorf("label %q has %d parts, want Place · Year", label, len(parts))
	case utf8.RuneCountInString(label) > maxLabelRunes:
		return label, text, fmt.Errorf("label %q is longer than %d characters: name the place, not the institution", label, maxLabelRunes)
	}
	for _, x := range parts {
		if strings.TrimSpace(x) == "" || strings.Contains(x, "·") {
			return label, text, fmt.Errorf("label %q has an empty part, want Place · Year", label)
		}
	}
	return label, text, nil
}

const maxLabelRunes = 40

type chapterText struct {
	Title       string `json:"title"`
	Kicker      string `json:"kicker"`
	HeroCaption string `json:"heroCaption,omitempty"`
	HeroCredit  string `json:"heroCredit,omitempty"`
	HeroLicense string `json:"heroLicense,omitempty"`
}

// lintChapterTranslation checks <id>.<lang>.md: same links, same paragraphs.
func lintChapterTranslation(dir, name, original string, bad func(string, ...any)) []error {
	for _, lang := range card.Languages {
		data, err := os.ReadFile(filepath.Join(dir, strings.TrimSuffix(name, ".md")+"."+lang+".md"))
		if err != nil {
			continue
		}
		parts := strings.SplitN(string(data), "\n---\n", 2)
		if !strings.HasPrefix(string(data), "---\n") || len(parts) != 2 {
			bad("%s translation: missing front matter", lang)
			continue
		}
		var t chapterText
		if err := yaml.UnmarshalStrict([]byte(strings.TrimPrefix(parts[0], "---\n")), &t); err != nil {
			bad("%s translation: %v", lang, err)
			continue
		}
		if t.Title == "" || t.Kicker == "" {
			bad("%s translation needs title and kicker", lang)
		}
		paras := func(s string) int {
			n := 0
			for _, p := range strings.Split(strings.TrimSpace(s), "\n\n") {
				if strings.TrimSpace(p) != "" {
					n++
				}
			}
			return n
		}
		if a, b := paras(original), paras(parts[1]); a != b {
			bad("%s translation has %d paragraphs, want %d (one per scroll step)", lang, b, a)
		} else {
			op, tp := card.Paragraphs(original), card.Paragraphs(parts[1])
			for i := range op {
				ol, _, _ := stepLabel(op[i])
				tl, _, err := stepLabel(tp[i])
				if err != nil {
					bad("%s translation paragraph %d: %v", lang, i+1, err)
				}
				if (ol == "") != (tl == "") {
					bad("%s translation paragraph %d: the original and the translation must both carry an {at} label or neither", lang, i+1)
				}
			}
		}
		want := map[string]bool{}
		for _, l := range (&card.Card{Body: original}).Links() {
			want[l.Target] = true
		}
		for _, l := range (&card.Card{Body: parts[1]}).Links() {
			delete(want, l.Target)
		}
		for id := range want {
			bad("%s translation lost the link to %q", lang, id)
		}
	}
	return nil
}

// ExportedArtist is an artist with every resolved chain to the museum.
type ExportedArtist struct {
	*roots.Artist
	// Each path: the artist id, then artist ids and "style:<id>" stations,
	// then the final "card:<id>". Paths made only of career-scope links
	// come first; MainPaths counts them.
	Paths     [][]string `json:"paths"`
	MainPaths int        `json:"mainPaths"`
}

// ExportRoots prepares roots for the museum.
func ExportRoots(rs *roots.Set) []ExportedArtist {
	out := []ExportedArtist{}
	for _, id := range rs.Order {
		ea := ExportedArtist{Artist: rs.ByID[id], Paths: [][]string{}}
		ps, _ := rs.Paths(id, 12)
		for _, p := range ps {
			var ids []string
			for _, st := range p {
				ids = append(ids, st.From)
			}
			ids = append(ids, p[len(p)-1].Link.To)
			ea.Paths = append(ea.Paths, ids)
			if roots.Career(p) {
				ea.MainPaths++
			}
		}
		out = append(out, ea)
	}
	return out
}
