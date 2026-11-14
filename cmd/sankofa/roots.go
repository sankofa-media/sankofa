package main

import (
	"fmt"
	"path/filepath"
	"slices"
	"strings"

	"github.com/spf13/cobra"

	"github.com/tym83/sankofa/content"
	"github.com/tym83/sankofa/pkg/atlas"
	"github.com/tym83/sankofa/pkg/roots"
)

func loadRoots(cmd *cobra.Command) (*roots.Set, error) {
	if dir, _ := cmd.Flags().GetString("content"); dir != "" {
		return roots.LoadDir(filepath.Join(dir, "..", "roots"))
	}
	return roots.LoadFS(content.Roots())
}

func rootsCmd() *cobra.Command {
	c := &cobra.Command{
		Use:   "roots [ARTIST]",
		Short: "Trace how an artist stands on Black traditions, link by sourced link",
		Long: `Pick an artist or a band — Metallica, Oasis, Taylor Swift — and follow the
documented chain of stylistic influence, through the artists they listened
to and the styles they work in, back to the museum: to the blues,
rock'n'roll, reggae. Every link names its evidence. Without an argument, lists
everyone in the collection.`,
		Args: cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			rs, loadErr := loadRoots(cmd)
			check, _ := cmd.Flags().GetBool("check")
			if loadErr != nil && !check {
				return loadErr
			}
			cards, err := loadCards(cmd)
			if err != nil {
				return err
			}
			w := cmd.OutOrStdout()
			if check {
				var errs []error
				if loadErr != nil {
					errs = append(errs, loadErr)
				}
				errs = append(errs, rs.Validate(cards)...)
				for _, e := range errs {
					fmt.Fprintln(w, e)
				}
				if len(errs) > 0 {
					return fmt.Errorf("%d roots problems", len(errs))
				}
				fmt.Fprintf(w, "%d artists, %d styles OK\n", len(rs.Order), len(rs.Styles))
				return nil
			}
			name := func(a *roots.Artist) string {
				if lang == "ru" && a.NameRU != "" {
					return a.NameRU
				}
				return a.Name
			}
			if len(args) == 0 {
				for _, id := range rs.Order {
					a := rs.ByID[id]
					g := a.Genre
					if lang == "ru" && a.GenreRU != "" {
						g = a.GenreRU
					}
					fmt.Fprintf(w, "%-28s %s · %s\n", name(a), g, (&cardYears{a.Years}).String())
				}
				return nil
			}
			found := rs.Find(args[0])
			if len(found) == 0 {
				return fmt.Errorf("%s: %q", tr("no such artist in the collection"), args[0])
			}
			a := found[0]
			paths, err := rs.Paths(a.ID, 12)
			if err != nil {
				return err
			}
			osc := isTerminal(w)
			ru := lang == "ru"
			pick := func(en, r string) string {
				if ru && r != "" {
					return r
				}
				return en
			}
			node := func(ref string) string {
				if id, ok := strings.CutPrefix(ref, "style:"); ok {
					if st := rs.Style(id); st != nil {
						return pick(st.Name, st.NameRU) + " (" + tr("style") + ")"
					}
					return ref
				}
				if id, ok := strings.CutPrefix(ref, "card:"); ok {
					if c := cards.ByID[id]; c != nil {
						return atlas.Hyperlink(osc, cardPoint(c).URL(), stLink.Render(c.Title))
					}
					return id
				}
				if x := rs.ByID[strings.TrimPrefix(ref, "root:")]; x != nil {
					return name(x)
				}
				return ref
			}
			say := func(indent, text string) {
				for _, line := range strings.Split(wrap(text, 74-len(indent)), "\n") {
					fmt.Fprintf(w, "%s   %s\n", indent, line)
				}
			}
			groups := []struct {
				label string
				types []string
			}{
				{"In their own words", []string{"testimony"}},
				{"What they listened to", []string{"listening"}},
				{"What critics heard", []string{"critics"}},
				{"In the music", []string{"analysis"}},
			}
			fmt.Fprintf(w, "%s\n\n", stTitle.Render(name(a)))
			for i, p := range paths {
				if i > 0 {
					fmt.Fprintln(w)
				}
				for _, st := range p {
					l := st.Link
					indent := strings.Repeat("   ", st.Depth)
					head := fmt.Sprintf("%s%s → %s", indent, node(st.From), node(l.To))
					if l.Scope == "period" {
						head += "  " + stMeta.Render("["+tr("Period")+": "+l.Period+"]")
					}
					fmt.Fprintln(w, head)
					say(indent, pick(l.How, l.HowRU))
					var undoc []string
					for _, d := range roots.Dimensions {
						if !slices.Contains(l.Dimensions, d) {
							undoc = append(undoc, d)
						}
					}
					dims := stMeta.Render(tr("Documented")+":") + " " + strings.Join(l.Dimensions, ", ")
					if len(undoc) > 0 {
						dims += " · " + stMeta.Render(tr("Not documented")+":") + " " + strings.Join(undoc, ", ")
					}
					fmt.Fprintf(w, "%s   %s\n", indent, dims)
					if len(l.Carries) > 0 {
						var els []string
						for _, id := range l.Carries {
							n := id
							if e := rs.Element(id); e != nil {
								n = pick(e.Name, e.NameRU)
							}
							els = append(els, n)
						}
						fmt.Fprintf(w, "%s   %s %s\n", indent, stMeta.Render(tr("Carries")+":"), strings.Join(els, ", "))
					}
					for _, g := range groups {
						var items []roots.Evidence
						for _, ev := range l.Evidence {
							if slices.Contains(g.types, ev.Type) {
								items = append(items, ev)
							}
						}
						if len(items) == 0 {
							continue
						}
						fmt.Fprintf(w, "%s   %s\n", indent, stMeta.Render(tr(g.label)+":"))
						for _, ev := range items {
							say(indent+"  ", "· "+pick(ev.Text, ev.TextRU))
							fmt.Fprintf(w, "%s       %s\n", indent, stDim.Render(atlas.Hyperlink(osc, ev.Source.URL, ev.Source.Title)))
						}
					}
					if ex := l.Example; ex != nil {
						fmt.Fprintf(w, "%s   %s %s\n", indent, stMeta.Render(tr("Example")+":"), ex.Song)
						say(indent+"  ", pick(ex.Text, ex.TextRU))
					}
				}
			}
			if len(a.Notes) > 0 {
				fmt.Fprintf(w, "\n%s\n", stMeta.Render(tr("Period notes")+":"))
				for _, n := range a.Notes {
					say("", fmt.Sprintf("%s · %s (%s): %s", n.Period, n.Who, n.Role, pick(n.What, n.WhatRU)))
				}
			}
			return nil
		},
	}
	c.Flags().Bool("check", false, "validate the roots collection and list every problem")
	return c
}

type cardYears struct{ y []int }

func (c *cardYears) String() string {
	switch len(c.y) {
	case 1:
		return fmt.Sprint(c.y[0])
	case 2:
		return fmt.Sprintf("%d–%d", c.y[0], c.y[1])
	}
	return ""
}
