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
