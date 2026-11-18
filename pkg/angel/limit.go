package angel

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"sync"
	"time"
)

// Clients tells clients apart without remembering who they are: a client is
// the HMAC of its IP address under a random salt that lives only in memory
// and is replaced every day. The IP itself is never stored, and yesterday's
// keys cannot be linked to today's.
type Clients struct {
	mu   sync.Mutex
	salt []byte
	day  string
	now  func() time.Time

	// Every counter is keyed by client and dropped with the salt.
	hits    map[string][]time.Time
	reports map[int64]map[string]bool
}

// NewClients returns a keyer with a fresh salt.
func NewClients(now func() time.Time) *Clients {
	if now == nil {
		now = time.Now
	}
	c := &Clients{now: now}
	c.rotate(now().UTC().Format(time.DateOnly))
	return c
}

func (c *Clients) rotate(day string) {
	c.salt = make([]byte, 32)
	if _, err := rand.Read(c.salt); err != nil {
		panic(err)
	}
	c.day = day
	c.hits = map[string][]time.Time{}
	c.reports = map[int64]map[string]bool{}
}

func (c *Clients) check() {
	if d := c.now().UTC().Format(time.DateOnly); d != c.day {
		c.rotate(d)
	}
}

// Key returns the anonymous key of an IP for today.
func (c *Clients) Key(ip string) string {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.check()
	return c.key(ip)
}

func (c *Clients) key(s string) string {
	m := hmac.New(sha256.New, c.salt)
	m.Write([]byte(s))
	return hex.EncodeToString(m.Sum(nil)[:12])
}

// Allow reports whether client key may do one more of kind: at most n within
// window (a sliding window). An allowed call is counted.
func (c *Clients) Allow(key, kind string, n int, window time.Duration) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.check()
	k := kind + "|" + key
	now := c.now()
	keep := c.hits[k][:0]
	for _, t := range c.hits[k] {
		if now.Sub(t) < window {
			keep = append(keep, t)
		}
	}
	if len(keep) >= n {
		c.hits[k] = keep
		return false
	}
	c.hits[k] = append(keep, now)
	return true
}

// Report records that client key reported word id and reports whether this is
// the first report of that client on that word today.
func (c *Clients) Report(key string, id int64) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.check()
	if c.reports[id] == nil {
		c.reports[id] = map[string]bool{}
	}
	if c.reports[id][key] {
		return false
	}
	c.reports[id][key] = true
	return true
}

// Opaque turns a per-tab id into a short handle for the presence stream, so
// the tab id a client chose is never shown to others.
func (c *Clients) Opaque(id string) string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.key("tab|" + id)[:8]
}

// Sweep forgets windows that have run out; call it now and then.
func (c *Clients) Sweep(maxWindow time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.check()
	now := c.now()
	for k, ts := range c.hits {
		if len(ts) == 0 || now.Sub(ts[len(ts)-1]) >= maxWindow {
			delete(c.hits, k)
		}
	}
}
