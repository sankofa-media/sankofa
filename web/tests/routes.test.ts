import { describe, expect, it } from 'vitest';
import type { Artist, LineageCard } from '../src/lib/roots';
import { bestVia, elementReach, forksOf, layoutRoutes, routeSet, routeThrough, segShape, stepsOf, threadsOf } from '../src/lib/routes';
import { cardLinkIndex, parseCardLinks, parseElements } from '../src/lib/elements';

const src = [{ title: 'a', url: 'https://a' }, { title: 'b', url: 'https://b' }];
const art = (id: string, links: { to: string; kind?: string; carries?: string[] }[], paths: string[][]): Artist =>
  ({ id, name: id.toUpperCase(), years: [1970], place: { name: 'X', lat: 0, lon: 0 }, genre: 'Rock', links: links.map((l) => ({ claim: `${id} to ${l.to}`, sources: src, ...l })), paths }) as Artist;

// A splits into B and C; both reach the card x, which grows from y and z.
const all = [
  art('a', [{ to: 'root:b', kind: 'cover', carries: ['riff'] }, { to: 'root:c', kind: 'influence' }], [['a', 'b', 'card:x'], ['a', 'c', 'card:x']]),
  art('b', [{ to: 'card:x', kind: 'scene', carries: ['riff', 'blue'] }], [['b', 'card:x']]),
  art('c', [{ to: 'card:x', kind: 'teacher' }], [['c', 'card:x']]),
];
const byId = new Map(all.map((x) => [x.id, x]));
const cards = new Map<string, LineageCard>([
  ['x', { id: 'x', roots: ['y', 'z'] }],
  ['y', { id: 'y' }],
  ['z', { id: 'z' }],
]);

describe('routes', () => {
  const rs = routeSet(byId.get('a')!, byId, cards);

  it('extracts every route from the artist to the oldest cards', () => {
    expect(rs.routes.map((r) => r.join(' '))).toEqual(['a b card:x card:y', 'a b card:x card:z', 'a c card:x card:y', 'a c card:x card:z']);
  });

  it('merges shared stations: each station and each link once', () => {
    expect(rs.nodes).toEqual(['a', 'b', 'c', 'card:x', 'card:y', 'card:z']);
    expect(rs.edges.filter((e) => e.to === 'card:x')).toHaveLength(2);
    expect(rs.edges.filter((e) => e.from === 'card:x')).toHaveLength(2);
    expect(rs.depth.get('card:x')).toBe(2);
    expect(rs.depth.get('card:z')).toBe(3);
  });

  it('finds the forks of a route, the current branch first', () => {
    const forks = forksOf(rs, 0);
    expect(forks.map((f) => f.at)).toEqual([0, 2]);
    expect(forks[0].options.map((o) => o.next)).toEqual(['b', 'c']);
    expect(forks[1].options.map((o) => o.next)).toEqual(['card:y', 'card:z']);
  });

  it('switching at a fork keeps the rest of the route', () => {
    // from a>b>x>z, going via c keeps the end at z
    expect(rs.routes[bestVia(rs, 1, 0, 'c')].join(' ')).toBe('a c card:x card:z');
    expect(rs.routes[bestVia(rs, 2, 2, 'card:z')].join(' ')).toBe('a c card:x card:z');
  });

  it('picking a station keeps the current route if it passes there, else the closest one through it', () => {
    expect(routeThrough(rs, 'card:x', 2)).toBe(2);
    expect(rs.routes[routeThrough(rs, 'card:z', 2)].join(' ')).toBe('a c card:x card:z');
    expect(rs.routes[routeThrough(rs, 'c', 1)].join(' ')).toBe('a c card:x card:z');
  });

  it('lays the graph out without two stations on one spot and with the first route on one straight line', () => {
    const o = layoutRoutes(rs, (r) => rs.depth.get(r)!);
    const spots = [...o.spots.values()].map((s) => `${s.at}:${s.lane}`);
    expect(new Set(spots).size).toBe(rs.nodes.length);
    expect(rs.routes[0].map((r) => o.spots.get(r)!.lane)).toEqual([0, 0, 0, 0]);
    // every link drawn once
    expect(o.segs).toHaveLength(rs.edges.length);
    expect(new Set(o.segs.map((s) => `${s.from}>${s.to}`)).size).toBe(rs.edges.length);
    // a split bends away from the station and comes back before the merge
    const viaC = o.segs.find((s) => s.from === 'a' && s.to === 'c')!;
    const shape = segShape(viaC, o.spots);
    expect(shape[0][0]).toEqual([0, 0]);
    expect(shape[shape.length - 1][shape[shape.length - 1].length - 1]).toEqual([1, o.spots.get('c')!.lane]);
  });

  it('lays phones out one station per row', () => {
    const o = layoutRoutes(rs, (r) => rs.nodes.indexOf(r));
    expect(new Set([...o.spots.values()].map((s) => s.at)).size).toBe(rs.nodes.length);
    expect(o.span).toBe(rs.nodes.length);
  });
});

describe('steps and threads', () => {
  const links = cardLinkIndex(parseCardLinks('links:\n- {from: x, to: y, claim: "X grew from Y.", carries: [blue]}\nunexplained:\n- {from: x, to: z}\n'));
  const elements = new Map(parseElements('elements:\n- {id: riff, name: The riff, origin: [x]}\n- {id: blue, name: Blue notes, origin: [card:y]}\n- {name: nameless}\n').elements.map((e) => [e.id, e]));

  it('gives each step its link or its card-to-card why', () => {
    const steps = stepsOf(['a', 'b', 'card:x', 'card:y'], byId, links);
    expect(steps.map((s) => s.kind)).toEqual(['cover', 'scene', 'lineage']);
    expect(steps[2].cardLink?.claim).toBe('X grew from Y.');
    expect(stepsOf(['a', 'b', 'card:x', 'card:z'], byId, links)[2].cardLink).toBeUndefined();
  });

  it('runs a thread from the first step that carries an element to its origin card', () => {
    const route = ['a', 'b', 'card:x', 'card:y'];
    const t = threadsOf(route, stepsOf(route, byId, links), elements);
    expect(t).toEqual([
      { element: 'riff', from: 0, to: 1, origin: 2 },
      { element: 'blue', from: 1, to: 2, origin: 3 },
    ]);
  });

  it('tolerates links without elements and unknown element ids', () => {
    const route = ['a', 'c', 'card:x', 'card:z'];
    expect(threadsOf(route, stepsOf(route, byId, new Map()), elements)).toEqual([]);
    const odd = new Map([['riff', elements.get('riff')!]]);
    expect(threadsOf(['a', 'b', 'card:x'], stepsOf(['a', 'b', 'card:x'], byId, links), odd).map((t) => t.element)).toEqual(['riff']);
  });

  it('counts the collection routes that carry each element', () => {
    const r = elementReach(all, [...elements.values()]);
    expect(r.get('riff')).toEqual({ routes: 2, artists: ['a', 'b'] });
    expect(r.get('blue')).toEqual({ routes: 2, artists: ['a', 'b'] });
  });
});
