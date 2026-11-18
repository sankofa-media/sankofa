package factoid

import (
	"os"
	"testing"

	"github.com/tym83/sankofa/pkg/card"
)

// The museum's own collection always validates: a broken factoid fails here
// before it fails the web build.
func TestRealCollectionValidates(t *testing.T) {
	all, err := LoadFS(os.DirFS("../../content/factoids"))
	if err != nil {
		t.Fatal(err)
	}
	cs, err := card.LoadDir("../../content/cards")
	if err != nil {
		t.Fatal(err)
	}
	shown := Shown(all)
	if len(shown) == 0 {
		t.Fatalf("expected checked factoids, got none of %d", len(all))
	}
	for _, e := range Validate(shown, cs) {
		t.Error(e)
	}
}
