package main

import (
	"fmt"
	"io"
	"math/rand/v2"
	"os"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/spf13/cobra"

	"github.com/sankofa-media/sankofa/pkg/atlas"
	"github.com/sankofa-media/sankofa/pkg/card"
	"github.com/sankofa-media/sankofa/pkg/reader"
)

func dictCmd() *cobra.Command {
	var plain, index bool
	var copyFlag string
	c := &cobra.Command{
		Use:   "dict [CARD]",
		Short: "Read the dictionary: follow links between cards, endlessly",
		Long: `An endless dictionary in the manner of Pavić's Dictionary of the Khazars.
Links are marked with the book they lead to: ❝ voices, ▤ archives, ✶ heirs.

Keys: tab/shift+tab select a link, enter follow it, backspace go back,
/ or i the index with search, e trade your copy (male/female edition),
r random card, o show the atlas link, q quit.

Printed (--plain, or into a pipe), links read "Sun Ra✶ [sun-ra]": the id in
brackets is the card to open next. On a terminal the words are also a
hyperlink to the card in the museum (--museum-url, SANKOFA_MUSEUM_URL).
--index prints every entry from A to Z in the language of --lang.

Both copies hold the whole dictionary, and a link opens the very card it
names. A card's {male}/{female} paragraphs are read in your copy, or in the
one --edition names (m or f) for this reading only.`,
		Args: cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			s, err := loadCards(cmd)
			if err != nil {
				return err
			}
			st, err := reader.Load()
			if err != nil {
				return err
			}
			ed, err := readingCopy(copyFlag, st.Edition)
			if err != nil {
				return err
			}
			out := cmd.OutOrStdout()
			if index {
				printIndex(out, s, linkStyle{tty: isTerminal(out)})
				return nil
			}
			start := ""
			if len(args) == 1 {
				start = args[0]
			} else {
				start = unreadCard(s, st)
			}
			c := s.ByID[start]
			if c == nil {
				return fmt.Errorf("no card %q", start)
			}
			if plain || !isTerminal(cmd.OutOrStdout()) {
				st.Visit(c.ID)
				_ = st.Save()
				printCard(out, s, s.Resolved(c), ed, isTerminal(out))
				return nil
			}
			m := newDictModelIn(s, st, c, ed)
			if _, err := tea.NewProgram(m, tea.WithAltScreen()).Run(); err != nil {
				return err
			}
			return st.Save()
		},
	}
	c.Flags().BoolVar(&plain, "plain", false, "print the card instead of opening the reader")
	c.Flags().BoolVar(&index, "index", false, "print every entry of the dictionary from A to Z")
	c.Flags().StringVar(&copyFlag, "edition", "", "the copy to read the cards in, m or f (default: your copy)")
	c.AddCommand(pathCmd())
	return c
}

func pathCmd() *cobra.Command {
	c := &cobra.Command{Use: "path", Short: "Your own book: the path you walked through the dictionary"}
	c.AddCommand(&cobra.Command{
		Use:   "export",
		Short: "Print a link that replays your path in the museum",
		RunE: func(cmd *cobra.Command, _ []string) error {
			st, err := reader.Load()
			if err != nil {
				return err
			}
			if len(st.Path) == 0 {
				return fmt.Errorf("your path is empty: open some cards with `sankofa dict` first")
			}
			p := atlas.Point{Focus: st.Path[0], Path: st.Path, Lang: lang}
			fmt.Fprintln(cmd.OutOrStdout(), p.URL())
			return nil
		},
	})
	c.AddCommand(&cobra.Command{
		Use:   "import URL",
		Short: "Walk someone else's path, read in your own copy",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			s, err := loadCards(cmd)
			if err != nil {
				return err
			}
			st, err := reader.Load()
			if err != nil {
				return err
			}
			p, err := atlas.Parse(args[0])
			if err != nil {
				return err
			}
			for _, id := range p.Path {
				if c := s.ByID[id]; c != nil {
					printCard(cmd.OutOrStdout(), s, s.Resolved(c), st.Edition, isTerminal(cmd.OutOrStdout()))
					fmt.Fprintln(cmd.OutOrStdout())
				}
			}
			return nil
		},
	})
	return c
}

// readingCopy is the copy a reading uses: the one --edition names, else the
// reader's own.
func readingCopy(flag, held string) (string, error) {
	switch flag {
	case "":
		return held, nil
	case "m", "male", "м":
		return card.EditionMale, nil
	case "f", "female", "ж":
		return card.EditionFemale, nil
	}
	return "", fmt.Errorf("--edition wants m or f, not %q", flag)
}

// pairLine names, on a card of a pair, the card that tells the same theme in
// the other copy; seen from the other copy it names the reader's own card.
func pairLine(s *card.Set, c *card.Card, edition string, st linkStyle) string {
	p := s.Partner(c.ID)
	if p == nil || (c.Edition != card.EditionMale && c.Edition != card.EditionFemale) {
		return ""
	}
	lead := "In the other copy this theme is told through "
	if c.Edition != edition {
		lead = "In your copy this theme is told through "
	}
	q := "“" + p.Title + "”"
	if lang == "ru" {
		q = "«" + p.Title + "»"
	}
	return tr(lead) + renderLinks(s, "[["+p.ID+"|"+q+"]]", st) + "."
}

// unreadCard picks a card the reader has not opened yet.
func unreadCard(s *card.Set, st *reader.State) string {
	var fresh []string
	for _, id := range s.Order {
		if !st.Seen(id) {
			fresh = append(fresh, id)
		}
	}
	if len(fresh) == 0 {
		fresh = s.Order
	}
	return fresh[rand.IntN(len(fresh))]
}

func isTerminal(w io.Writer) bool {
	f, ok := w.(*os.File)
	if !ok {
		return false
	}
	fi, err := f.Stat()
	return err == nil && fi.Mode()&os.ModeCharDevice != 0
}

func booksOf(c *card.Card) string {
	var b []string
	for _, k := range c.Books {
		b = append(b, card.BookSymbols[k])
	}
	return strings.Join(b, "")
}

func yearsOf(c *card.Card) string {
	switch len(c.Years) {
	case 1:
		return fmt.Sprint(c.Years[0])
	case 2:
		return fmt.Sprintf("%d–%d", c.Years[0], c.Years[1])
	}
	return ""
}

// printCard renders a card as text, as the given copy reads it. Links print
// as their words and the id of the card they open; with osc (a terminal) the
// words are OSC 8 links to the card in the museum and the ids are dim.
func printCard(w io.Writer, s *card.Set, c *card.Card, edition string, osc bool) {
	c = c.ForCopy(edition)
	place := ""
	if len(c.Places) > 0 {
		place = c.Places[0].Name
	}
	st := linkStyle{tty: osc}
	fmt.Fprintf(w, "%s %s\n%s · %s · %s\n\n%s\n\n", booksOf(c), c.Title, yearsOf(c), place, tr(c.Kind), c.Wow)
	fmt.Fprintln(w, wrap(renderLinks(s, c.Body, st), 78))
	if line := pairLine(s, c, edition, st); line != "" {
		fmt.Fprintln(w, "\n"+wrap(line, 78))
	}
	if c.Dispute != "" {
		fmt.Fprintf(w, "\n%s%s\n", tr("Disputed: "), renderLinks(s, c.Dispute, st))
	}
	if len(c.Further) > 0 {
		fmt.Fprintln(w, "\n"+tr("Further:"))
		for _, f := range c.Further {
			fmt.Fprintln(w, "  ·", renderLinks(s, f, st))
		}
	}
	fmt.Fprintln(w, "\n"+tr("Sources:"))
	for _, src := range c.Sources {
		fmt.Fprintln(w, "  ·", atlas.Hyperlink(osc && src.URL != "", src.URL, src.Title))
	}
	u := cardPoint(c).URL()
	fmt.Fprintln(w, "\n"+tr("Atlas:"), atlas.Hyperlink(osc, u, u))
}

func wrap(s string, width int) string {
	var out []string
	for _, para := range strings.Split(s, "\n\n") {
		words := strings.Fields(para)
		line := ""
		for _, w := range words {
			if line != "" && visibleWidth(line)+1+visibleWidth(w) > width {
				out = append(out, line)
				line = w
				continue
			}
			if line == "" {
				line = w
			} else {
				line += " " + w
			}
		}
		out = append(out, line, "")
	}
	return strings.TrimRight(strings.Join(out, "\n"), "\n")
}

// --- interactive reader ---

var (
	stTitle  = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#F2C14E"))
	stMeta   = lipgloss.NewStyle().Foreground(lipgloss.Color("#8A8A8A"))
	stWow    = lipgloss.NewStyle().Italic(true).Foreground(lipgloss.Color("#E07A5F"))
	stLink   = lipgloss.NewStyle().Underline(true).Foreground(lipgloss.Color("#81B29A"))
	stSel    = lipgloss.NewStyle().Reverse(true).Foreground(lipgloss.Color("#81B29A"))
	stDim    = lipgloss.NewStyle().Foreground(lipgloss.Color("#6C6C6C"))
	stFooter = lipgloss.NewStyle().Foreground(lipgloss.Color("#5F87AF"))
)

type dictModel struct {
	set *card.Set
	st  *reader.State
	// edition is the copy the cards are read in: the reader's, or --edition.
	edition  string
	cur      *card.Card // the card as this copy reads it
	back     []string   // ids of the cards behind it
	sel      int
	width    int
	height   int
	showLink bool
	note     string

	// The index: every card, filtered by what the reader types.
	index bool
	query string
	pick  int
}

func newDictModel(s *card.Set, st *reader.State, c *card.Card) *dictModel {
	return newDictModelIn(s, st, c, st.Edition)
}

func newDictModelIn(s *card.Set, st *reader.State, c *card.Card, edition string) *dictModel {
	m := &dictModel{set: s, st: st, edition: edition, width: 80}
	m.open(c, false)
	return m
}

// open shows exactly this card (a link never swaps it for its pair), as the
// reader's copy reads it.
func (m *dictModel) open(c *card.Card, push bool) {
	if push && m.cur != nil {
		m.back = append(m.back, m.cur.ID)
	}
	if raw := m.set.ByID[c.ID]; raw != nil {
		c = raw
	}
	m.cur = m.set.Resolved(c).ForCopy(m.edition)
	m.sel = 0
	m.showLink = false
	m.st.Visit(c.ID)
}

func (m *dictModel) Init() tea.Cmd { return nil }

func (m *dictModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = min(msg.Width, 100)
		m.height = msg.Height
	case tea.KeyMsg:
		if m.index {
			return m.updateIndex(msg)
		}
		m.note = ""
		links := m.cur.Links()
		switch msg.String() {
		case "q", "ctrl+c", "esc":
			return m, tea.Quit
		case "tab", "right", "down":
			if len(links) > 0 {
				m.sel = (m.sel + 1) % len(links)
			}
		case "shift+tab", "left", "up":
			if len(links) > 0 {
				m.sel = (m.sel - 1 + len(links)) % len(links)
			}
		case "enter":
			if len(links) > 0 {
				if t := m.set.ByID[links[m.sel].Target]; t != nil {
					m.open(t, true)
				}
			}
		case "backspace", "b":
			if n := len(m.back); n > 0 {
				prev := m.set.ByID[m.back[n-1]]
				m.back = m.back[:n-1]
				if prev != nil {
					m.open(prev, false)
				}
			}
		case "r":
			m.open(m.set.ByID[unreadCard(m.set, m.st)], true)
		case "/", "i":
			m.index, m.query, m.pick = true, "", 0
		case "e":
			// Trade the copy: the same card stays open, read in the other copy.
			if m.edition == card.EditionMale {
				m.edition = card.EditionFemale
			} else {
				m.edition = card.EditionMale
			}
			m.st.Edition = m.edition
			_ = m.st.Save()
			m.open(m.cur, false)
			m.note = tr("Your copy is now") + ": " + editionName(m.edition)
		case "o":
			m.showLink = !m.showLink
		}
	}
	return m, nil
}

// matches lists cards whose title, place or kind contains the query.
func (m *dictModel) matches() []*card.Card {
	q := strings.ToLower(m.query)
	var out []*card.Card
	for _, id := range m.set.Order {
		c := m.set.ByID[id]
		hay := strings.ToLower(c.Title + " " + c.Places[0].Name + " " + tr(c.Kind) + " " + yearsOf(c))
		if q == "" || strings.Contains(hay, q) {
			out = append(out, c)
		}
	}
	return out
}

func (m *dictModel) updateIndex(k tea.KeyMsg) (tea.Model, tea.Cmd) {
	list := m.matches()
	switch k.Type {
	case tea.KeyEsc:
		m.index = false
	case tea.KeyCtrlC:
		return m, tea.Quit
	case tea.KeyEnter:
		if len(list) > 0 {
			m.index = false
			m.open(list[min(m.pick, len(list)-1)], true)
		}
	case tea.KeyUp, tea.KeyShiftTab:
		if m.pick > 0 {
			m.pick--
		}
	case tea.KeyDown, tea.KeyTab:
		if m.pick < len(list)-1 {
			m.pick++
		}
	case tea.KeyBackspace:
		if r := []rune(m.query); len(r) > 0 {
			m.query = string(r[:len(r)-1])
			m.pick = 0
		}
	case tea.KeyRunes, tea.KeySpace:
		m.query += string(k.Runes)
		if k.Type == tea.KeySpace {
			m.query += " "
		}
		m.pick = 0
	}
	return m, nil
}

func (m *dictModel) indexView() string {
	var b strings.Builder
	list := m.matches()
	b.WriteString(stTitle.Render(tr("Index")) + "  " + stMeta.Render(fmt.Sprintf(tr("%d cards"), len(list))) + "\n\n")
	b.WriteString("› " + m.query + "▏\n\n")
	rows := max(5, m.height-8)
	start := 0
	if m.pick >= rows {
		start = m.pick - rows + 1
	}
	for i := start; i < len(list) && i < start+rows; i++ {
		c := list[i]
		line := fmt.Sprintf("%s %-40s %s · %s", booksOf(c), trim(c.Title, 40), yearsOf(c), tr(c.Kind))
		if i == m.pick {
			b.WriteString(stSel.Render(line) + "\n")
		} else {
			b.WriteString(line + "\n")
		}
	}
	b.WriteString("\n" + stFooter.Render(tr("type to search · ↑↓ choose · enter open · esc back")))
	return b.String()
}

func (m *dictModel) View() string {
	if m.index {
		return m.indexView()
	}
	c := m.cur
	var b strings.Builder
	place := ""
	if len(c.Places) > 0 {
		place = c.Places[0].Name
	}
	b.WriteString(stTitle.Render(booksOf(c)+" "+c.Title) + "\n")
	b.WriteString(stMeta.Render(yearsOf(c)+" · "+place+" · "+tr(c.Kind)) + "\n\n")
	b.WriteString(stWow.Render(wrap(c.Wow, m.width-4)) + "\n\n")

	// Render the body with styled links. Wrap first on plain text, then style
	// link texts in place so wrapping stays correct.
	links := c.Links()
	var sb strings.Builder
	last := 0
	for i, l := range links {
		sb.WriteString(c.Body[last:l.Start])
		sym := ""
		if t := m.set.ByID[l.Target]; t != nil && len(t.Books) > 0 {
			sym = card.BookSymbols[t.Books[0]]
		}
		txt := strings.ReplaceAll(l.Text+sym, " ", " ")
		if i == m.sel {
			sb.WriteString("\x00S" + txt + "\x00E")
		} else {
			sb.WriteString("\x00L" + txt + "\x00E")
		}
		last = l.End
	}
	sb.WriteString(c.Body[last:])
	body := wrap(sb.String(), m.width-4)
	body = styleMarks(body)
	b.WriteString(body + "\n")
	if line := pairLine(m.set, c, m.edition, linkStyle{}); line != "" {
		b.WriteString("\n" + stMeta.Render(wrap(line, m.width-4)) + "\n")
	}

	if c.Dispute != "" {
		b.WriteString("\n" + stWow.Render(tr("Disputed: ")) + wrap(c.Dispute, m.width-14) + "\n")
	}
	if len(c.Further) > 0 {
		b.WriteString("\n" + stMeta.Render(tr("Further")) + "\n")
		for _, f := range c.Further {
			b.WriteString("  · " + f + "\n")
		}
	}
	if bl := m.set.Backlinks(c.ID); len(bl) > 0 {
		b.WriteString("\n" + stMeta.Render(tr("← referenced by: ")) + strings.Join(bl, ", ") + "\n")
	}
	b.WriteString("\n" + stDim.Render(tr("Sources")+": "+sourceTitles(c)) + "\n")
	if m.showLink {
		u := cardPoint(c).URL()
		b.WriteString("\n" + stFooter.Render(tr("Atlas: ")) + atlas.Hyperlink(true, u, u) + "\n")
	}
	ed := tr("male")
	if m.edition == card.EditionFemale {
		ed = tr("female")
	}
	if m.note != "" {
		b.WriteString("\n" + stWow.Render(m.note))
	}
	b.WriteString("\n" + stFooter.Render(fmt.Sprintf(tr("tab link · enter open · backspace back · / index · r random · e copy · o atlas · q quit   [%s copy · %d read]"), ed, len(m.st.Path))))
	return b.String()
}

func styleMarks(s string) string {
	var out strings.Builder
	for {
		i := strings.Index(s, "\x00")
		if i < 0 {
			out.WriteString(s)
			break
		}
		out.WriteString(s[:i])
		kind := s[i+1]
		j := strings.Index(s[i:], "\x00E")
		txt := strings.ReplaceAll(s[i+2:i+j], " ", " ")
		if kind == 'S' {
			out.WriteString(stSel.Render(txt))
		} else {
			out.WriteString(stLink.Render(txt))
		}
		s = s[i+j+2:]
	}
	return out.String()
}

func sourceTitles(c *card.Card) string {
	var t []string
	for _, s := range c.Sources {
		t = append(t, s.Title)
	}
	return strings.Join(t, "; ")
}
