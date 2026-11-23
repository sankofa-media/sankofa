package v1alpha1

import (
	"reflect"
	"testing"

	"github.com/sankofa-media/sankofa/pkg/card"
)

func TestRoundTrip(t *testing.T) {
	c := &card.Card{ID: "x", Kind: "person", Title: "X", Wow: "w", Years: []int{1}, Zoom: 4,
		Places: []card.Place{{Name: "Lagos", Lat: 6.5244, Lon: 3.3792}}, Books: []string{"voices"},
		Edition: "both", Sources: []card.Source{{Title: "s"}}, Body: "b", Moment: &card.Moment{Year: 1, Place: 0}}
	if got := ToCard(FromCard(c)); !reflect.DeepEqual(got, c) {
		t.Fatalf("%+v\n%+v", got, c)
	}
}
