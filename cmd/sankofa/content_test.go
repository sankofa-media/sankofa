package main

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/sankofa-media/sankofa/pkg/factoid"
)

func TestStepLabel(t *testing.T) {
	for _, tc := range []struct {
		in, label, text string
		bad             bool
	}{
		{in: "Plain text.", text: "Plain text."},
		{in: "{at Oyo · 1949} The drums.", label: "Oyo · 1949", text: "The drums."},
		{in: "{male} {at Charleston · 1862} Smalls.", label: "Charleston · 1862", text: "{male} Smalls."},
		{in: "{at Benin City} Bronzes.", label: "Benin City", text: "Bronzes."},
		{in: "{at Oyo · 1949 The drums.", bad: true},
		{in: "{at  · 1949} The drums.", bad: true},
		{in: "{at A · B · C} x", bad: true},
		{in: "{at [[oyo|Oyo]] · 1949} The drums.", bad: true},
		{in: "{female} {at Oyo · [[y|1949]]} The drums.", bad: true},
		{in: "{at Oyo · 1949} The [[drums|drums]].", label: "Oyo · 1949", text: "The [[drums|drums]]."},
		{in: "{at National Conservatory of Music, East 17th Street, New York · 1892} x", bad: true},
	} {
		label, text, err := stepLabel(tc.in)
		if (err != nil) != tc.bad {
			t.Errorf("%q: err %v, want bad=%v", tc.in, err, tc.bad)
			continue
		}
		if !tc.bad && (label != tc.label || text != tc.text) {
			t.Errorf("%q: got %q / %q, want %q / %q", tc.in, label, text, tc.label, tc.text)
		}
	}
}

func TestExportFactoidsKeepsWhatTheMuseumShows(t *testing.T) {
	lat, lon := 6.45, 3.39
	out := ExportFactoids([]factoid.Factoid{{ID: "fx-a", EN: "a", RU: "а", Year: 1900, Place: &factoid.Place{Name: "Lagos", Lat: &lat, Lon: &lon},
		Sources: []factoid.Source{{Title: "One", URL: "https://one", Quote: "long quote"}}, Gender: "f", Status: factoid.Checked}})
	data, _ := json.Marshal(out)
	s := string(data)
	for _, want := range []string{`"cards":[]`, `"lat":6.45`, `"url":"https://one"`} {
		if !strings.Contains(s, want) {
			t.Errorf("missing %s in %s", want, s)
		}
	}
	for _, gone := range []string{"quote", "gender", "status"} {
		if strings.Contains(s, gone) {
			t.Errorf("%s leaks into the export: %s", gone, s)
		}
	}
}
