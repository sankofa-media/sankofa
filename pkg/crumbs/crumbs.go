// Package crumbs picks short lines to show while something is running, enough
// to make someone want to read further: the "wow" lines of cards and the
// museum's checked factoids.
package crumbs

import (
	"math/rand/v2"

	"github.com/sankofa-media/sankofa/pkg/card"
	"github.com/sankofa-media/sankofa/pkg/factoid"
)

// Crumb is one line to show: a card's wow line or a factoid.
type Crumb struct {
	Card *card.Card
	Fact *factoid.Factoid
}

// ID is the card's or the factoid's id.
func (c *Crumb) ID() string {
	if c.Fact != nil {
		return c.Fact.ID
	}
	return c.Card.ID
}

// Picker chooses crumbs: first what the reader has not seen, preferring what
// is linked to the card they read last; never the same crumb twice until the
// pool runs out.
type Picker struct {
	Set *card.Set
	// Facts are checked factoids (pkg/factoid.Shown); nil for cards only.
	Facts []factoid.Factoid
	// Seen reports cards the reader opened and factoids already shown.
	Seen func(id string) bool
	Last string // last card the reader opened
	prev map[string]bool
}

// Next returns the next crumb, card or factoid, or nil for an empty pool.
func (p *Picker) Next() *Crumb { return p.next(true, true) }

// NextFact returns the next factoid only, or nil when there are none.
func (p *Picker) NextFact() *factoid.Factoid {
	if c := p.next(false, true); c != nil {
		return c.Fact
	}
	return nil
}

func (p *Picker) next(cards, facts bool) *Crumb {
	if p.prev == nil {
		p.prev = map[string]bool{}
	}
	linked := map[string]bool{}
	if c := p.Set.ByID[p.Last]; c != nil {
		linked[c.ID] = true
		for _, l := range c.Links() {
			linked[l.Target] = true
		}
	}
	var near, fresh, any []Crumb
	add := func(cr Crumb, related bool) {
		id := cr.ID()
		if p.prev[id] {
			return
		}
		any = append(any, cr)
		if p.Seen != nil && p.Seen(id) {
			return
		}
		fresh = append(fresh, cr)
		if related {
			near = append(near, cr)
		}
	}
	if cards && p.Set != nil {
		for _, id := range p.Set.Order {
			// Both copies hold the whole dictionary: any card can be a crumb.
			add(Crumb{Card: p.Set.ByID[id]}, linked[id])
		}
	}
	if facts {
		for i := range p.Facts {
			f := &p.Facts[i]
			related := false
			for _, id := range f.Cards {
				related = related || linked[id]
			}
			add(Crumb{Fact: f}, related)
		}
	}
	pool := near
	if len(pool) == 0 {
		pool = fresh
	}
	if len(pool) == 0 {
		pool = any
	}
	if len(pool) == 0 {
		if len(p.prev) == 0 {
			return nil
		}
		p.prev = map[string]bool{}
		return p.next(cards, facts)
	}
	cr := pool[rand.IntN(len(pool))]
	p.prev[cr.ID()] = true
	return &cr
}
