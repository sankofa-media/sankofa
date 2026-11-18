// Package cabinet reads the part of the museum's Cabinet of Curiosities that
// lives in the cluster rather than on the site: caches hidden "at: cluster"
// in content/cabinet/caches.yaml, found through a Card's annotation, the
// storeroom ConfigMap or the `sankofa rummage` command. Each carries a word
// the reader types into the cabinet's letter lock; content/cabinet/cluster.yaml
// holds what the cluster says around it.
package cabinet

import (
	"fmt"
	"io/fs"
	"regexp"
	"strings"

	"sigs.k8s.io/yaml"
)

// Annotation is the Card annotation a cache hides in.
const Annotation = "sankofa.kuberoot.dev/margin"

// Ways into the cluster.
const (
	ViaAnnotation = "annotation"
	ViaConfigMap  = "configmap"
	ViaCLI        = "cli"
)

// Cache is one cache hidden in the cluster.
type Cache struct {
	ID   string
	Via  string
	Card string
	Word string
}

// Text is a line in English and Russian.
type Text struct {
	EN string `json:"en"`
	RU string `json:"ru"`
}

// In picks the language (anything but ru is English).
func (t Text) In(lang string) string {
	if lang == "ru" && t.RU != "" {
		return t.RU
	}
	return t.EN
}

// Cluster is what the cluster says: each text has a {word} where the word goes.
type Cluster struct {
	Annotation Text `json:"annotation"`
	Rummage    Text `json:"rummage"`
	Storeroom  Text `json:"storeroom"`
}

// Cabinet is the cluster's share of the cabinet.
type Cabinet struct {
	Caches []Cache
	Says   Cluster
}

var word = regexp.MustCompile(`^[a-z]{4,16}$`)

// Load reads caches.yaml and cluster.yaml from a cabinet directory.
func Load(fsys fs.FS) (*Cabinet, error) {
	raw, err := fs.ReadFile(fsys, "caches.yaml")
	if err != nil {
		return nil, err
	}
	var doc struct {
		Caches []struct {
			ID     string `json:"id"`
			Hidden struct {
				At   string `json:"at"`
				Via  string `json:"via"`
				Card string `json:"card"`
				Word string `json:"word"`
			} `json:"hidden"`
		} `json:"caches"`
	}
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		return nil, fmt.Errorf("caches.yaml: %w", err)
	}
	c := &Cabinet{}
	for _, x := range doc.Caches {
		if x.Hidden.At != "cluster" {
			continue
		}
		h := x.Hidden
		if !word.MatchString(h.Word) {
			return nil, fmt.Errorf("cache %s: the lock word must be 4 to 16 lowercase latin letters", x.ID)
		}
		switch h.Via {
		case ViaAnnotation:
			if h.Card == "" {
				return nil, fmt.Errorf("cache %s: an annotation needs a card", x.ID)
			}
		case ViaConfigMap, ViaCLI:
		default:
			return nil, fmt.Errorf("cache %s: unknown way into the cluster %q", x.ID, h.Via)
		}
		c.Caches = append(c.Caches, Cache{ID: x.ID, Via: h.Via, Card: h.Card, Word: h.Word})
	}
	if raw, err := fs.ReadFile(fsys, "cluster.yaml"); err == nil {
		if err := yaml.Unmarshal(raw, &c.Says); err != nil {
			return nil, fmt.Errorf("cluster.yaml: %w", err)
		}
	} else if len(c.Caches) > 0 {
		return nil, err
	}
	for _, x := range c.Caches {
		t := c.text(x.Via)
		for _, l := range []string{"en", "ru"} {
			if !strings.Contains(t.In(l), "{word}") {
				return nil, fmt.Errorf("cluster.yaml: the %s text (%s) has no {word} for cache %s", x.Via, l, x.ID)
			}
		}
	}
	return c, nil
}

func (c *Cabinet) text(via string) Text {
	switch via {
	case ViaAnnotation:
		return c.Says.Annotation
	case ViaConfigMap:
		return c.Says.Storeroom
	default:
		return c.Says.Rummage
	}
}

// Say is what the cluster says for one way in, with the word in place; empty
// when no cache hides that way.
func (c *Cabinet) Say(via, lang string) string {
	for _, x := range c.Caches {
		if x.Via == via {
			return strings.ReplaceAll(c.text(via).In(lang), "{word}", x.Word)
		}
	}
	return ""
}

// Margins are the Card annotations to write: card id -> note (English; the
// Russian note goes under the same key with a -ru suffix).
func (c *Cabinet) Margins() map[string]map[string]string {
	out := map[string]map[string]string{}
	for _, x := range c.Caches {
		if x.Via != ViaAnnotation {
			continue
		}
		t := c.Says.Annotation
		out[x.Card] = map[string]string{
			Annotation:         strings.ReplaceAll(t.EN, "{word}", x.Word),
			Annotation + "-ru": strings.ReplaceAll(t.RU, "{word}", x.Word),
		}
	}
	return out
}
