package main

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"

	"github.com/sankofa-media/sankofa/content"
	"github.com/sankofa-media/sankofa/pkg/cabinet"
)

// rummageCmd is a door of the museum's Cabinet of Curiosities, left out of
// the help on purpose: the museum's own game tells the reader where it is.
func rummageCmd() *cobra.Command {
	return &cobra.Command{
		Use:    "rummage",
		Short:  "Rummage through the storeroom",
		Hidden: true,
		Args:   cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			var fsys fs.FS = content.Cabinet()
			if dir, _ := cmd.Flags().GetString("content"); dir != "" {
				fsys = os.DirFS(filepath.Join(dir, "..", "cabinet"))
			}
			c, err := cabinet.Load(fsys)
			if err != nil {
				return err
			}
			say := c.Say(cabinet.ViaCLI, lang)
			if say == "" {
				say = map[bool]string{true: "Только пыль.", false: "Only dust."}[lang == "ru"]
			}
			_, err = fmt.Fprintln(cmd.OutOrStdout(), say)
			return err
		},
	}
}
