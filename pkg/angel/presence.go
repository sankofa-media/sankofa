package angel

import (
	"sort"
	"sync"
	"time"
)

// PresenceTTL is how long a touch stays without a heartbeat.
const PresenceTTL = 15 * time.Second

// MaxTouches caps the points held at once.
const MaxTouches = 2000

// Point is one finger on a screen somewhere, anonymous.
type Point struct {
	K string  `json:"k"` // opaque handle, stable while the touch lasts
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// Snapshot is what the presence stream sends.
type Snapshot struct {
	Count    int     `json:"count"`
	Watching int     `json:"watching"`
	Points   []Point `json:"points"`
}

type touch struct {
	p    Point
	seen time.Time
}

// Presence holds the touches in memory only; nothing of it is stored.
type Presence struct {
	mu       sync.Mutex
	now      func() time.Time
	touches  map[string]touch
	watching int
	version  uint64
}

// NewPresence returns an empty presence.
func NewPresence(now func() time.Time) *Presence {
	if now == nil {
		now = time.Now
	}
	return &Presence{now: now, touches: map[string]touch{}}
}

// Touch records a finger down (with a position) or up. It reports false when
// the presence is full.
func (p *Presence) Touch(id, handle string, down bool, x, y float64) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	if !down {
		if _, ok := p.touches[id]; ok {
			delete(p.touches, id)
			p.version++
		}
		return true
	}
	if _, ok := p.touches[id]; !ok && len(p.touches) >= MaxTouches {
		return false
	}
	p.touches[id] = touch{p: Point{K: handle, X: clamp01(x), Y: clamp01(y)}, seen: p.now()}
	p.version++
	return true
}

func clamp01(v float64) float64 {
	if v != v || v < 0 { // NaN or negative
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

// expire drops touches without a heartbeat; the caller holds the lock.
func (p *Presence) expire() {
	now := p.now()
	for id, t := range p.touches {
		if now.Sub(t.seen) > PresenceTTL {
			delete(p.touches, id)
			p.version++
		}
	}
}

// Snapshot returns the current points (sorted by handle for stable output)
// and a version that changes whenever they do.
func (p *Presence) Snapshot() (Snapshot, uint64) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.expire()
	s := Snapshot{Count: len(p.touches), Watching: p.watching, Points: make([]Point, 0, len(p.touches))}
	for _, t := range p.touches {
		s.Points = append(s.Points, t.p)
	}
	sort.Slice(s.Points, func(i, j int) bool { return s.Points[i].K < s.Points[j].K })
	return s, p.version
}

// Watch counts a watcher of the stream until the returned function is called.
// It reports false when max watchers are already there.
func (p *Presence) Watch(max int) (func(), bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.watching >= max {
		return nil, false
	}
	p.watching++
	p.version++
	return func() {
		p.mu.Lock()
		p.watching--
		p.version++
		p.mu.Unlock()
	}, true
}
