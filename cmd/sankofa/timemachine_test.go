package main

import (
	"strings"
	"testing"
	"time"
)

func TestWhen(t *testing.T) {
	got, err := when("2h")
	if err != nil {
		t.Fatal(err)
	}
	ts, _ := time.Parse(time.RFC3339Nano, got)
	if d := time.Since(ts); d < 2*time.Hour-time.Minute || d > 2*time.Hour+time.Minute {
		t.Fatalf("2h back is %s back", d)
	}
	if got, _ := when("7d"); !strings.HasPrefix(got, time.Now().Add(-7*24*time.Hour).UTC().Format("2006-01-02")) {
		t.Fatalf("7d back: %s", got)
	}
	if got, _ := when("2026-11-12T10:00:00+02:00"); got != "2026-11-12T08:00:00Z" {
		t.Fatalf("RFC3339 normalised to %s", got)
	}
	if _, err := when("yesterday"); err == nil {
		t.Fatal("words are not moments")
	}
}

func TestNamespaceArg(t *testing.T) {
	for in, want := range map[string]string{"namespace/shop": "shop", "ns/shop": "shop", "namespaces/shop": "shop", "deployment/web": "", "namespace/": ""} {
		if got, _ := namespaceArg(in); got != want {
			t.Fatalf("%s -> %q", in, got)
		}
	}
}
