package angel

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"
)

func steady(n, ms int) []int {
	rr := make([]int, n)
	for i := range rr {
		rr[i] = ms + (i%3-1)*12 // a little natural variability
	}
	return rr
}

func TestRoundRR(t *testing.T) {
	for in, want := range map[int]int{812: 810, 813: 815, 815: 815, 817: 815, 818: 820, 270: 270, 1998: 2000} {
		if got := RoundRR(in); got != want {
			t.Errorf("RoundRR(%d) = %d, want %d", in, got, want)
		}
	}
}

func TestValidateRR(t *testing.T) {
	ok, err := ValidateRR(steady(40, 803))
	if err != nil {
		t.Fatal(err)
	}
	for _, v := range ok {
		if v%RRStep != 0 {
			t.Fatalf("not rounded: %v", ok)
		}
	}

	withJumps := func(n, jumps int) []int {
		rr := steady(n, 800)
		for i := 0; i < jumps; i++ {
			rr[2+i*3] = 1300 // +62% then -38%: one jump each
		}
		return rr
	}
	cases := map[string][]int{
		"too few":   steady(MinBeats-1, 800),
		"too many":  steady(MaxBeats+1, 800),
		"too fast":  append(steady(30, 800), 260),
		"too slow":  append(steady(30, 800), 2010),
		"irregular": withJumps(40, 5), // 5 jumps above 40% is more than 10% of 40
		"empty":     nil,
	}
	for name, rr := range cases {
		if _, err := ValidateRR(rr); !errors.Is(err, ErrInput) {
			t.Errorf("%s: accepted (%v)", name, err)
		}
	}
	// Exactly at the share: 4 jumps of 40 beats is 10%, allowed.
	rr := steady(40, 800)
	rr[10], rr[20] = 1250, 1250 // up 56%, then down 36%: one jump each
	rr[30], rr[35] = 1250, 1250
	if _, err := ValidateRR(rr); err != nil {
		t.Errorf("4 jumps of 40 refused: %v", err)
	}
	for _, n := range []int{MinBeats, MaxBeats} {
		if _, err := ValidateRR(steady(n, 600)); err != nil {
			t.Errorf("%d beats refused: %v", n, err)
		}
	}
}

func TestHTTPPulses(t *testing.T) {
	srv, ts := newServer(t, nil)
	body := func(v any) *strings.Reader { b, _ := json.Marshal(v); return strings.NewReader(string(b)) }

	// The service no longer accepts reader pulses: POST is gone, DELETE is
	// gone, the count is gone.
	resp, _ := do(t, "POST", ts.URL+"/api/angel/pulses", "a", "application/json", body(map[string]any{"rr": steady(40, 803), "source": "camera", "consent": true}))
	if resp.StatusCode < http.StatusBadRequest {
		t.Fatalf("POST pulses still served: %d", resp.StatusCode)
	}
	if resp, _ = do(t, "DELETE", ts.URL+"/api/angel/pulses?code=whatever", "a", "", nil); resp.StatusCode < http.StatusBadRequest {
		t.Fatalf("DELETE pulses still served: %d", resp.StatusCode)
	}
	if resp, _ = do(t, "GET", ts.URL+"/api/angel/pulses/count", "a", "", nil); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("pulses count still served: %d", resp.StatusCode)
	}

	// With nothing stored the chorus is empty: no first, no others.
	resp, out := do(t, "GET", ts.URL+"/api/angel/pulses?n=24", "b", "", nil)
	if resp.StatusCode != http.StatusOK || out["first"] != nil || len(out["others"].([]any)) != 0 {
		t.Fatalf("empty chorus: %d %v", resp.StatusCode, out)
	}

	// Even with several pulses stored, readers get only the first one left.
	ctx := context.Background()
	var ids []int64
	for i := range 3 {
		id, err := srv.Svc.Store.InsertPulse(ctx, steady(30, 700+i*50), "camera", NewDeleteCode(), time.Now())
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	_, out = do(t, "GET", ts.URL+"/api/angel/pulses?n=24", "b", "", nil)
	first := out["first"].(map[string]any)
	if got := int64(first["id"].(float64)); got != ids[0] {
		t.Fatalf("first = %d, want %d", got, ids[0])
	}
	if len(first) != 2 || first["rr"] == nil {
		t.Fatalf("sample exposes more than id and rr: %v", first)
	}
	if others := out["others"].([]any); len(others) != 0 {
		t.Fatalf("others = %d, want none", len(others))
	}

	// The owner hides the first visible pulse; the next earliest takes its
	// place. Un-hiding restores it.
	_, out = do(t, "GET", ts.URL+"/api/angel/admin/pulses", "x", "", nil, "Authorization", "Bearer secret-token")
	list := out["pulses"].([]any)
	if len(list) != 3 || int64(list[0].(map[string]any)["id"].(float64)) != ids[2] || int64(list[2].(map[string]any)["id"].(float64)) != ids[0] {
		t.Fatalf("admin list not newest first: %v", out)
	}
	resp, _ = do(t, "POST", ts.URL+"/api/angel/admin/pulses/"+jsonNum(float64(ids[0])), "x", "application/json", strings.NewReader(`{"action":"hide"}`), "Authorization", "Bearer secret-token")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("hide %d", resp.StatusCode)
	}
	_, out = do(t, "GET", ts.URL+"/api/angel/pulses", "b", "", nil)
	if got := int64(out["first"].(map[string]any)["id"].(float64)); got != ids[1] {
		t.Fatalf("first after hide = %d, want %d", got, ids[1])
	}
	resp, _ = do(t, "POST", ts.URL+"/api/angel/admin/pulses/"+jsonNum(float64(ids[0])), "x", "application/json", strings.NewReader(`{"action":"publish"}`), "Authorization", "Bearer secret-token")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("publish %d", resp.StatusCode)
	}
	_, out = do(t, "GET", ts.URL+"/api/angel/pulses", "b", "", nil)
	if got := int64(out["first"].(map[string]any)["id"].(float64)); got != ids[0] {
		t.Fatalf("first after publish = %d, want %d", got, ids[0])
	}
}

func TestFirstPulse(t *testing.T) {
	srv, ts := newServer(t, nil)
	if _, out := do(t, "GET", ts.URL+"/api/angel/pulses", "x", "", nil); out["first"] != nil || len(out["others"].([]any)) != 0 {
		t.Fatalf("empty chorus: %v", out)
	}
	ctx := context.Background()
	var codes []string
	var ids []int64
	for i := range 4 {
		code := NewDeleteCode()
		id, err := srv.Svc.Store.InsertPulse(ctx, steady(30, 700+i*50), "camera", code, time.Now())
		if err != nil {
			t.Fatal(err)
		}
		codes, ids = append(codes, code), append(ids, id)
	}
	check := func(wantFirst int64) {
		t.Helper()
		_, out := do(t, "GET", ts.URL+"/api/angel/pulses?n=24", "x", "", nil)
		if got := int64(out["first"].(map[string]any)["id"].(float64)); got != wantFirst {
			t.Fatalf("first = %d, want %d", got, wantFirst)
		}
		if others := out["others"].([]any); len(others) != 0 {
			t.Fatalf("others = %d, want none", len(others))
		}
	}
	check(ids[0])
	if err := srv.Svc.Store.SetPulseHidden(ctx, ids[0], true); err != nil {
		t.Fatal(err)
	}
	check(ids[1])
	if err := srv.Svc.Store.DeletePulseByCode(ctx, codes[1]); err != nil {
		t.Fatal(err)
	}
	check(ids[2])
	if err := srv.Svc.Store.SetPulseHidden(ctx, ids[0], false); err != nil {
		t.Fatal(err)
	}
	check(ids[0]) // shown again, the earliest is the centre again
}
