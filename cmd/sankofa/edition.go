package main

import (
	"fmt"

	"github.com/spf13/cobra"

	"github.com/tym83/sankofa/pkg/card"
	"github.com/tym83/sankofa/pkg/reader"
)

func editionName(e string) string {
	if e == card.EditionFemale {
		return tr("female")
	}
	return tr("male")
}

func editionCmd() *cobra.Command {
	c := &cobra.Command{
		Use:   "edition [m|f|swap]",
		Short: "Show or change your copy of the dictionary: the male or the female edition",
		Long: `Like the copies of Pavić's Dictionary of the Khazars, every reader holds one
of two editions. Both hold the whole dictionary, and a link opens the very card
it names. They tell the same themes with a man's and a woman's view: some cards
read differently, and a chapter may tell its theme through another life,
Frederick Douglass fighting Covey in the male copy, Harriet Jacobs in her
garret in the female one. The copy is dealt at random on first use; this
command lets you trade it, and sankofa dict --edition reads in either.`,
		Args: cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			st, err := reader.Load()
			if err != nil {
				return err
			}
			w := cmd.OutOrStdout()
			if len(args) == 0 {
				fmt.Fprintf(w, "%s: %s\n", tr("Your copy"), editionName(st.Edition))
				return nil
			}
			switch args[0] {
			case "m", "male", "м":
				st.Edition = card.EditionMale
			case "f", "female", "ж":
				st.Edition = card.EditionFemale
			case "swap":
				if st.Edition == card.EditionMale {
					st.Edition = card.EditionFemale
				} else {
					st.Edition = card.EditionMale
				}
			default:
				return fmt.Errorf("want m, f or swap")
			}
			if err := st.Save(); err != nil {
				return err
			}
			fmt.Fprintf(w, "%s: %s\n", tr("Your copy is now"), editionName(st.Edition))
			return nil
		},
	}
	return c
}
