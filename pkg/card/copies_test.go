package card

import (
	"strings"
	"testing"
)

func TestCopyParagraphs(t *testing.T) {
	body := "Both read this.\n\n{male} Only men read [[robert-smalls|this]].\n\n{female} Only women read this one, which is longer.\n\nBoth again."
	m := CopyParagraphs(body, EditionMale)
	f := CopyParagraphs(body, EditionFemale)
	if len(m) != 3 || m[1] != "Only men read [[robert-smalls|this]]." {
		t.Fatalf("male copy: %q", m)
	}
	if len(f) != 3 || f[1] != "Only women read this one, which is longer." {
		t.Fatalf("female copy: %q", f)
	}
	if got, want := CopyWords(body), 3+8+2; got != want {
		t.Fatalf("CopyWords = %d, want %d", got, want)
	}
	if got := CopyWords("One two three."); got != 3 {
		t.Fatalf("unmarked CopyWords = %d", got)
	}
}

func TestForCopy(t *testing.T) {
	c := &Card{ID: "x", Body: "Both.\n\n{male} His.\n\n{female} Hers.", Translations: map[string]*Translation{"ru": {Title: "Икс", Body: "Оба.\n\n{male} Его.\n\n{female} Её."}}}
	m, f := c.ForCopy(EditionMale), c.ForCopy(EditionFemale)
	if m.Body != "Both.\n\nHis." || f.Body != "Both.\n\nHers." {
		t.Fatalf("bodies: %q / %q", m.Body, f.Body)
	}
	if m.Translations["ru"].Body != "Оба.\n\nЕго." || f.Localized("ru").Body != "Оба.\n\nЕё." {
		t.Fatalf("translations: %q / %q", m.Translations["ru"].Body, f.Translations["ru"].Body)
	}
	if c.Body != "Both.\n\n{male} His.\n\n{female} Hers." || c.Translations["ru"].Body != "Оба.\n\n{male} Его.\n\n{female} Её." {
		t.Fatal("ForCopy must not change the card it reads")
	}
	plain := &Card{ID: "y", Body: "One.\n\nTwo."}
	if plain.ForCopy(EditionFemale).Body != plain.Body || c.ForCopy("") != c {
		t.Fatal("an unmarked card, or no copy, reads as it is")
	}
}

func TestLinkInLabel(t *testing.T) {
	for p, want := range map[string]bool{
		"{at [[oyo|Oyo]] · 1949} The drums.":           true,
		"{female} {at Oyo · [[y1949]]} The drums.":     true,
		"{at Oyo · 1949} The [[drums|drums]].":         false,
		"[[oyo|Oyo]] {at nothing} is not a label.":     false,
		"{male} Plain text with [[sun-ra|Sun Ra]].":    false,
		"{at [[oyo|Oyo]] unclosed label and the text.": true,
	} {
		if got := LinkInLabel(p); got != want {
			t.Errorf("%q: got %v, want %v", p, got, want)
		}
	}
}

func TestValidateRejectsLinkInLabel(t *testing.T) {
	b := mk(t, "b", "", "", "x")
	if errs := set(mk(t, "a", "", "", "{at Oyo · 1949} Hello [[b|friend]]."), b).Validate(); len(errs) != 0 {
		t.Fatalf("a link in the text is fine: %v", errs)
	}
	errs := set(mk(t, "a", "", "", "{at [[b|Oyo]] · 1949} Hello."), b).Validate()
	if len(errs) != 1 || !strings.Contains(errs[0].Error(), "{at} label") {
		t.Fatalf("a link in the label must fail: %v", errs)
	}
}
