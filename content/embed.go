// Package content embeds the card collection into the Griot binary, so a
// cluster carries its memory with it.
package content

import (
	"embed"
	"io/fs"
)

//go:embed cards quests roots factoids
var files embed.FS

// Cards is the card collection.
func Cards() fs.FS { return sub("cards") }

// Roots are the artists whose roots the museum traces.
func Roots() fs.FS { return sub("roots") }

// Factoids are the short verified facts, every status included: readers
// get only the checked ones (pkg/factoid.Shown).
func Factoids() fs.FS { return sub("factoids") }

// Quests are the quest definitions.
func Quests() fs.FS { return sub("quests") }

func sub(dir string) fs.FS {
	sub, err := fs.Sub(files, dir)
	if err != nil {
		panic(err)
	}
	return sub
}
