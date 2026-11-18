package cabinet

import (
	"os"
	"strings"
	"testing"
	"testing/fstest"

	"sigs.k8s.io/yaml"
)

const caches = `
caches:
  - id: on-paper
    hidden: {at: card-text, card: x}
  - id: margin
    hidden: {at: cluster, via: annotation, card: equiano, word: lantern}
  - id: shelf
    hidden: {at: cluster, via: configmap, word: ledger}
  - id: drawer
    hidden: {at: cluster, via: cli, word: needle}
`

const says = `
annotation: {en: "pencil: {word}", ru: "карандаш: {word}"}
storeroom: {en: "shelf {word}", ru: "полка {word}"}
rummage: {en: "dust and {word}", ru: "пыль и {word}"}
`

func TestLoadAndSay(t *testing.T) {
	c, err := Load(fstest.MapFS{"caches.yaml": {Data: []byte(caches)}, "cluster.yaml": {Data: []byte(says)}})
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Caches) != 3 {
		t.Fatalf("want the 3 cluster caches, got %v", c.Caches)
	}
	if got := c.Say(ViaCLI, "ru"); got != "пыль и needle" {
		t.Errorf("rummage ru = %q", got)
	}
	if got := c.Say(ViaConfigMap, "en"); got != "shelf ledger" {
		t.Errorf("storeroom = %q", got)
	}
	m := c.Margins()
	if m["equiano"][Annotation] != "pencil: lantern" || m["equiano"][Annotation+"-ru"] != "карандаш: lantern" {
		t.Errorf("margins = %v", m)
	}
}

func TestRefusesBadWords(t *testing.T) {
	for _, bad := range []string{
		"caches:\n  - id: a\n    hidden: {at: cluster, via: cli, word: Ab}\n",
		"caches:\n  - id: a\n    hidden: {at: cluster, via: annotation, word: lantern}\n",
		"caches:\n  - id: a\n    hidden: {at: cluster, via: pigeon, word: lantern}\n",
	} {
		if _, err := Load(fstest.MapFS{"caches.yaml": {Data: []byte(bad)}, "cluster.yaml": {Data: []byte(says)}}); err == nil {
			t.Errorf("accepted %q", bad)
		}
	}
	if _, err := Load(fstest.MapFS{"caches.yaml": {Data: []byte(caches)}, "cluster.yaml": {Data: []byte("rummage: {en: dust, ru: пыль}")}}); err == nil {
		t.Error("accepted texts without {word}")
	}
}

// The museum's own cabinet loads, and the storeroom ConfigMap in
// deploy/museum.yaml says exactly what content/cabinet/cluster.yaml says.
func TestRealCabinetAndStoreroom(t *testing.T) {
	c, err := Load(os.DirFS("../../content/cabinet"))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile("../../deploy/museum.yaml")
	if err != nil {
		t.Fatal(err)
	}
	var found bool
	for _, doc := range strings.Split(string(raw), "\n---\n") {
		var o struct {
			Kind     string            `json:"kind"`
			Metadata struct{ Name, Namespace string } `json:"metadata"`
			Data     map[string]string `json:"data"`
		}
		if yaml.Unmarshal([]byte(doc), &o) != nil || o.Kind != "ConfigMap" || o.Metadata.Name != "storeroom" {
			continue
		}
		found = true
		if o.Metadata.Namespace != "sankofa-museum" {
			t.Errorf("storeroom is in %q", o.Metadata.Namespace)
		}
		for _, l := range []string{"en", "ru"} {
			if want := c.Say(ViaConfigMap, l); want != "" && strings.TrimSpace(o.Data["inventory."+l+".txt"]) != strings.TrimSpace(want) {
				t.Errorf("storeroom inventory.%s.txt is %q, content says %q", l, o.Data["inventory."+l+".txt"], want)
			}
		}
	}
	if !found && c.Say(ViaConfigMap, "en") != "" {
		t.Error("deploy/museum.yaml has no storeroom ConfigMap")
	}
}
