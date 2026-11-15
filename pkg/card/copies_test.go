package card

import "testing"

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
