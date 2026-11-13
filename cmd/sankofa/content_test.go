package main

import "testing"

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
