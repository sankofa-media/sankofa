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
	_, ts := newServer(t, nil)
	body := func(v any) *strings.Reader { b, _ := json.Marshal(v); return strings.NewReader(string(b)) }
	post := func(ip string, v any) (*http.Response, map[string]any) {
		return do(t, "POST", ts.URL+"/api/angel/pulses", ip, "application/json", body(v))
	}

	if resp, _ := post("a", map[string]any{"rr": steady(40, 800), "source": "camera"}); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("no consent: %d", resp.StatusCode)
	}
	if resp, _ := post("a", map[string]any{"rr": steady(40, 800), "source": "camera", "consent": true, "ecg": []int{1, 2}}); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("extra fields accepted: %d", resp.StatusCode)
	}
	if resp, _ := post("a", map[string]any{"rr": steady(40, 800), "source": "watch", "consent": true}); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("unknown source: %d", resp.StatusCode)
	}
	resp, out := post("a", map[string]any{"rr": steady(40, 803), "source": "camera", "consent": true})
	if resp.StatusCode != http.StatusCreated || out["delete_code"] == nil {
		t.Fatalf("pulse: %d %v", resp.StatusCode, out)
	}
	code := out["delete_code"].(string)
	post("a", map[string]any{"rr": steady(30, 700), "source": "camera", "consent": true})
	if resp, _ := post("a", map[string]any{"rr": steady(30, 700), "source": "camera", "consent": true}); resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("third pulse in an hour: %d", resp.StatusCode)
	}

	_, out = do(t, "GET", ts.URL+"/api/angel/pulses?n=24", "b", "", nil)
	ps := append(out["others"].([]any), out["first"])
	if len(ps) != 2 {
		t.Fatalf("sample %v", out)
	}
	for _, p := range ps {
		m := p.(map[string]any)
		if len(m) != 2 || m["id"] == nil || m["rr"] == nil {
			t.Fatalf("sample exposes more than id and rr: %v", m)
		}
	}

	// The owner hides one; it leaves the sample and the count.
	_, out = do(t, "GET", ts.URL+"/api/angel/admin/pulses", "x", "", nil, "Authorization", "Bearer secret-token")
	first := out["pulses"].([]any)[0].(map[string]any)["id"]
	resp, _ = do(t, "POST", ts.URL+"/api/angel/admin/pulses/"+jsonNum(first.(float64)), "x", "application/json", strings.NewReader(`{"action":"hide"}`), "Authorization", "Bearer secret-token")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("hide %d", resp.StatusCode)
	}
	if _, out = do(t, "GET", ts.URL+"/api/angel/pulses/count", "x", "", nil); out["count"] != 1.0 {
		t.Fatalf("count after hide %v", out)
	}

	if resp, _ = do(t, "DELETE", ts.URL+"/api/angel/pulses?code="+code, "x", "", nil); resp.StatusCode != http.StatusOK {
		t.Fatalf("delete %d", resp.StatusCode)
	}
	if resp, _ = do(t, "DELETE", ts.URL+"/api/angel/pulses?code="+code, "x", "", nil); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("delete twice %d", resp.StatusCode)
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
	check := func(wantFirst int64, wantOthers int) {
		t.Helper()
		_, out := do(t, "GET", ts.URL+"/api/angel/pulses?n=24", "x", "", nil)
		if got := int64(out["first"].(map[string]any)["id"].(float64)); got != wantFirst {
			t.Fatalf("first = %d, want %d", got, wantFirst)
		}
		others := out["others"].([]any)
		if len(others) != wantOthers {
			t.Fatalf("others = %d, want %d", len(others), wantOthers)
		}
		for _, o := range others {
			if int64(o.(map[string]any)["id"].(float64)) == wantFirst {
				t.Fatal("first is also among the others")
			}
		}
	}
	check(ids[0], 3)
	if err := srv.Svc.Store.SetPulseHidden(ctx, ids[0], true); err != nil {
		t.Fatal(err)
	}
	check(ids[1], 2)
	if err := srv.Svc.Store.DeletePulseByCode(ctx, codes[1]); err != nil {
		t.Fatal(err)
	}
	check(ids[2], 1)
	if err := srv.Svc.Store.SetPulseHidden(ctx, ids[0], false); err != nil {
		t.Fatal(err)
	}
	check(ids[0], 2) // shown again, the earliest is the centre again
}
