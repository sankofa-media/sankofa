package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"golang.org/x/term"

	"github.com/tym83/sankofa/content"
	"github.com/tym83/sankofa/pkg/atlas"
	"github.com/tym83/sankofa/pkg/card"
	"github.com/tym83/sankofa/pkg/crumbs"
	"github.com/tym83/sankofa/pkg/factoid"
	"github.com/tym83/sankofa/pkg/reader"
)

func crumbPicker(cmd *cobra.Command) (*crumbs.Picker, *reader.State, error) {
	s, err := loadCards(cmd)
	if err != nil {
		return nil, nil, err
	}
	st, err := reader.Load()
	if err != nil {
		return nil, nil, err
	}
	last := ""
	if n := len(st.Path); n > 0 {
		last = st.Path[n-1]
	}
	return &crumbs.Picker{Set: s, Facts: loadFacts(cmd), Seen: st.Seen, Last: last}, st, nil
}

// loadFacts reads the checked factoids next to --content, or the ones built
// into sankofa. Crumbs are an extra: without factoids, cards still crumb.
func loadFacts(cmd *cobra.Command) []factoid.Factoid {
	fsys := content.Factoids()
	if dir, _ := cmd.Flags().GetString("content"); dir != "" {
		for _, d := range []string{filepath.Join(dir, "..", "factoids"), filepath.Join(dir, "factoids")} {
			if st, err := os.Stat(d); err == nil && st.IsDir() {
				fsys = os.DirFS(d)
				break
			}
		}
	}
	all, err := factoid.LoadFS(fsys)
	if err != nil {
		return nil
	}
	return factoid.Shown(all)
}

// factPoint is where a factoid leads: its first card, or its year on the atlas.
func factPoint(set *card.Set, f *factoid.Factoid) atlas.Point {
	for _, id := range f.Cards {
		if c := set.ByID[id]; c != nil {
			return cardPoint(c)
		}
	}
	return atlas.Point{From: f.Year, Zoom: 3, Lang: lang}
}

func crumbLine(set *card.Set, c *crumbs.Crumb, osc bool, width int) string {
	var u, line string
	if f := c.Fact; f != nil {
		u, line = factPoint(set, f).URL(), f.Text(lang)
		// Every fact says its year; most already do in their own words.
		if y := strconv.Itoa(f.Year); !strings.Contains(line, y) {
			line = y + ". " + line
		}
	} else {
		u, line = cardPoint(c.Card).URL(), c.Card.Wow
	}
	if width > 10 && len([]rune(line)) > width-4 {
		line = string([]rune(line)[:width-5]) + "…"
	}
	return atlas.Hyperlink(osc, u, line+" →")
}

func crumbCmd() *cobra.Command {
	var fact bool
	c := &cobra.Command{
		Use:   "crumb",
		Short: "Print one crumb: a single surprising line with a link (for prompts and scripts)",
		Example: `  sankofa crumb
  sankofa crumb --fact`,
		RunE: func(cmd *cobra.Command, _ []string) error {
			p, st, err := crumbPicker(cmd)
			if err != nil {
				return err
			}
			var cr *crumbs.Crumb
			if fact {
				if f := p.NextFact(); f != nil {
					cr = &crumbs.Crumb{Fact: f}
				}
			} else {
				cr = p.Next()
			}
			if cr == nil {
				return nil
			}
			fmt.Fprintln(cmd.OutOrStdout(), crumbLine(p.Set, cr, isTerminal(cmd.OutOrStdout()), 0))
			if cr.Fact != nil {
				// The next one is another fact: a shown factoid counts as seen.
				st.SawFact(cr.Fact.ID)
				return st.Save()
			}
			return nil
		},
	}
	c.Flags().BoolVar(&fact, "fact", false, "print one of the museum's checked factoids, with its year and a link")
	return c
}

// waitCmd runs any command and, while it runs, shows crumbs under a spinner.
// Output of the command passes through untouched; crumbs go to the terminal
// only, never into pipes or CI logs.
func waitCmd() *cobra.Command {
	var every time.Duration
	c := &cobra.Command{
		Use:   "wait -- COMMAND [ARGS...]",
		Short: "Run a long command and read something surprising while it works",
		Example: `  sankofa wait -- kubectl rollout status deploy/web
  sankofa wait -- kubepkg install sankofa-genre-hip-hop`,
		Args:               cobra.MinimumNArgs(1),
		DisableFlagParsing: false,
		RunE: func(cmd *cobra.Command, args []string) error {
			run := exec.Command(args[0], args[1:]...)
			run.Stdin, run.Stdout, run.Stderr = os.Stdin, os.Stdout, os.Stderr
			tty := isTerminal(os.Stderr)
			var p *crumbs.Picker
			var st *reader.State
			if tty {
				p, st, _ = crumbPicker(cmd)
			}
			if err := run.Start(); err != nil {
				return err
			}
			done := make(chan error, 1)
			go func() { done <- run.Wait() }()
			if p == nil {
				return <-done
			}
			spin := []string{"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"}
			tick := time.NewTicker(120 * time.Millisecond)
			defer tick.Stop()
			cur := p.Next()
			sawFact(st, cur)
			changed := time.Now()
			for i := 0; ; i++ {
				select {
				case err := <-done:
					fmt.Fprint(os.Stderr, "\r\x1b[2K")
					_ = st.Save()
					return err
				case <-tick.C:
					if time.Since(changed) > every {
						cur, changed = p.Next(), time.Now()
						sawFact(st, cur)
					}
					if cur != nil {
						fmt.Fprintf(os.Stderr, "\r\x1b[2K%s %s", spin[i%len(spin)], crumbLine(p.Set, cur, true, termWidth()-2))
					}
				}
			}
		},
	}
	c.Flags().DurationVar(&every, "every", 8*time.Second, "how long each crumb stays")
	return c
}

// sawFact remembers a factoid put on screen, so the next wait shows another.
func sawFact(st *reader.State, c *crumbs.Crumb) {
	if c != nil && c.Fact != nil {
		st.SawFact(c.Fact.ID)
	}
}

func termWidth() int {
	if w, _, err := term.GetSize(int(os.Stderr.Fd())); err == nil && w > 0 {
		return w
	}
	return 100
}
