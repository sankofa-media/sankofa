// Command sankofa is the Sankofa CLI: the dictionary, the atlas and the
// cluster memory. It also works as a kubectl plugin (kubectl sankofa).
package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"

	"github.com/sankofa-media/sankofa/pkg/atlas"
)

func main() {
	root := &cobra.Command{
		Use:           "sankofa",
		Short:         "Go back and fetch it: a Kubernetes distribution that remembers",
		SilenceUsage:  true,
		SilenceErrors: true,
	}
	root.PersistentFlags().String("content", envOr("SANKOFA_CONTENT", ""), "read cards from a local content directory instead of the cluster")
	root.PersistentFlags().StringVar(&lang, "lang", envOr("SANKOFA_LANG", "en"), "language of the cards: en or ru")
	museum := root.PersistentFlags().String("museum-url", os.Getenv("SANKOFA_MUSEUM_URL"), "the museum's address for card links (default "+atlas.DefaultBase+")")
	root.PersistentPreRun = func(*cobra.Command, []string) {
		if *museum != "" {
			_ = os.Setenv("SANKOFA_MUSEUM_URL", *museum)
		}
	}
	kubeFlags.AddFlags(root.PersistentFlags())
	root.AddCommand(contentCmd(), dictCmd(), tellCmd(), fetchCmd(), diffCmd(), obituariesCmd(), creditsCmd(), genreCmd(), questCmd(), crumbCmd(), waitCmd(), atlasCmd(), storyCmd(), kgotlaCmd(), editionCmd(), rootsCmd(), rummageCmd())
	if err := root.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, "sankofa:", err)
		os.Exit(1)
	}
}

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
