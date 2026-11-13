// The music map: every artist and every link of the roots collection as one
// graph converging on the museum's cards and, through their genre roots, on
// the oldest traditions. Pure model and layout, no DOM.
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';

type SimEdge = SimulationLinkDatum<GNode> & GEdge;
import type { Artist, LinkKind } from './roots';

export interface MapCard {
  id: string;
  title: string;
  years: number[];
  roots?: string[];
}

export interface GNode extends SimulationNodeDatum {
  id: string; // artist id or "card:<id>"
  card: boolean;
  label: string;
  year: number;
  /** how many artists stand on this node (reach it through their links) */
  support: number;
  x?: number;
  y?: number;
}

export interface GEdge {
  from: string;
  to: string;
  kind: LinkKind | 'lineage' | 'unknown';
  /** elements of music carried along this link */
  carries?: string[];
}

export interface Graph {
  nodes: GNode[];
  edges: GEdge[];
  byId: Map<string, GNode>;
  out: Map<string, string[]>;
  in: Map<string, string[]>;
}

export function buildGraph(artists: Artist[], cards: Map<string, MapCard>, name: (a: Artist) => string, cardCarries: Map<string, string[]> = new Map()): Graph {
  const byId = new Map<string, GNode>();
  const edges: GEdge[] = [];
  const add = (n: GNode) => byId.get(n.id) ?? (byId.set(n.id, n), n);
  for (const a of artists) add({ id: a.id, card: false, label: name(a), year: a.years[0] ?? 1950, support: 0 });
  const addCard = (id: string): GNode | undefined => {
    const c = cards.get(id);
    if (!c) return undefined;
    const known = byId.get(`card:${id}`);
    if (known) return known;
    const n = add({ id: `card:${id}`, card: true, label: c.title, year: c.years[0] ?? 1900, support: 0 });
    for (const r of c.roots ?? []) {
      if (addCard(r)) edges.push({ from: n.id, to: `card:${r}`, kind: 'lineage', carries: cardCarries.get(`${id}>${r}`) });
    }
    return n;
  };
  for (const a of artists) {
    for (const l of a.links) {
      const [k, ref] = l.to.split(':');
      const to = k === 'card' ? (addCard(ref) ? `card:${ref}` : undefined) : byId.has(ref) ? ref : undefined;
      if (to) edges.push({ from: a.id, to, kind: l.kind ?? 'unknown', carries: l.carries });
    }
  }
  const out = new Map<string, string[]>();
  const inn = new Map<string, string[]>();
  for (const e of edges) {
    out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
    inn.set(e.to, [...(inn.get(e.to) ?? []), e.from]);
  }
  const g: Graph = { nodes: [...byId.values()], edges, byId, out, in: inn };
  for (const a of artists) for (const id of reach(g, a.id)) if (id !== a.id) byId.get(id)!.support++;
  return g;
}

/** Everything a node stands on: its links followed down to the oldest roots. */
export function reach(g: Graph, id: string): Set<string> {
  const seen = new Set<string>([id]);
  const stack = [id];
  while (stack.length) for (const n of g.out.get(stack.pop()!) ?? []) if (!seen.has(n)) (seen.add(n), stack.push(n));
  return seen;
}

/** The links that carry an element, and every node they touch. */
export function carrying(g: Graph, element: string): { edges: GEdge[]; nodes: Set<string> } {
  const edges = g.edges.filter((e) => e.carries?.includes(element));
  return { edges, nodes: new Set(edges.flatMap((e) => [e.from, e.to])) };
}

/** Everything that grew out of a node. */
export function grewFrom(g: Graph, id: string): Set<string> {
  const seen = new Set<string>([id]);
  const stack = [id];
  while (stack.length) for (const n of g.in.get(stack.pop()!) ?? []) if (!seen.has(n)) (seen.add(n), stack.push(n));
  return seen;
}

/**
 * The roots at the bottom of the map, for the headline: every tradition with
 * no older root of its own, and the traditions of the same age that grew from
 * them (spirituals beside work songs), as the map draws them side by side.
 * `count` is how many artists lead back to at least one of them.
 */
export function headline(g: Graph, sameAge = 50): { total: number; roots: GNode[]; count: number } {
  const artists = g.nodes.filter((n) => !n.card);
  // Only traditions older than every artist stand at the foot: a card with no
  // roots of its own from the artists' own century is not one of them.
  const first = Math.min(...artists.map((n) => n.year));
  const terminal = g.nodes.filter((n) => n.card && !(g.out.get(n.id)?.length) && n.year < first);
  const oldest = new Set(terminal.map((n) => n.id));
  for (const n of g.nodes) {
    const outs = g.out.get(n.id) ?? [];
    if (n.card && outs.length && outs.every((o) => oldest.has(o) && n.year <= g.byId.get(o)!.year + sameAge)) oldest.add(n.id);
  }
  const reached = new Map<string, number>();
  const any = new Set<string>();
  for (const id of oldest) {
    const grew = [...grewFrom(g, id)].filter((k) => !g.byId.get(k)!.card);
    reached.set(id, grew.length);
    grew.forEach((k) => any.add(k));
  }
  const roots = [...oldest].filter((id) => reached.get(id)! > 0).map((id) => g.byId.get(id)!).sort((a, b) => a.year - b.year || reached.get(b.id)! - reached.get(a.id)!);
  return { total: artists.length, roots, count: any.size };
}

/**
 * Lay out once, deterministically: time runs bottom to top (oldest at the
 * bottom), links pull together, nodes keep apart. `h` grows with the years.
 */
/** Height for a year: the last century gets most of it, where the artists are. */
export function yearY(year: number, h: number, years: [number, number], early = 0.28): number {
  const [y0, y1] = years;
  const split = Math.min(y1 - 1, Math.max(y0 + 1, 1900));
  const t = Math.max(y0, Math.min(y1, year));
  // Before 1900 there are only roots, so that century takes `early` of the height.
  const f = t <= split ? ((t - y0) / (split - y0)) * early : early + ((t - split) / (y1 - split)) * (1 - early);
  return h - 50 - f * (h - 100);
}

export function layout(g: Graph, w: number, h: number, years: [number, number], early = 0.28): void {
  const yOf = (year: number) => yearY(year, h, years, early);
  // Artists start spread across the width by their family: the root card
  // their first link reaches, so related lines grow side by side.
  const fam = new Map<string, number>();
  const roots = g.nodes.filter((n) => n.card).sort((a, b) => a.year - b.year || a.id.localeCompare(b.id));
  roots.forEach((r, i) => fam.set(r.id, (i + 0.5) / roots.length));
  const famOf = (id: string): number => {
    let cur = id;
    for (let i = 0; i < 12; i++) {
      if (fam.has(cur)) return fam.get(cur)!;
      const next = g.out.get(cur)?.[0];
      if (!next) break;
      cur = next;
    }
    return 0.5;
  };
  for (const n of g.nodes) {
    let s = 0;
    for (const ch of n.id) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
    const f = n.card ? 0.5 + (famOf(n.id) - 0.5) * 0.35 : famOf(n.id) * 0.8 + 0.1 + ((s % 1000) / 1000 - 0.5) * 0.25;
    n.x = 40 + f * (w - 80);
    n.y = yOf(n.year);
  }
  const target = new Map(g.nodes.map((n) => [n.id, n.x!]));
  const sim = forceSimulation<GNode>(g.nodes)
    .force('y', forceY<GNode>((n) => yOf(n.year)).strength(0.85))
    .force('x', forceX<GNode>((n) => target.get(n.id)!).strength((n) => (n.card ? 0.25 : 0.06)))
    .force('charge', forceManyBody<GNode>().strength(-38).distanceMax(220))
    .force('link', forceLink<GNode, SimEdge>(g.edges.map((e) => ({ ...e, source: e.from, target: e.to }))).id((n) => n.id).strength(0.04).distance(60))
    .force('collide', forceCollide<GNode>((n) => radius(n) + (n.card ? 26 : 14)))
    .stop();
  for (let i = 0; i < 300; i++) sim.tick();
  // Use the whole width: stretch the settled layout edge to edge, keeping
  // room for labels at both sides.
  const xs = g.nodes.map((n) => n.x ?? w / 2);
  const [lo, hi] = [Math.min(...xs), Math.max(...xs)];
  for (const n of g.nodes) n.x = hi > lo ? 70 + (((n.x ?? w / 2) - lo) / (hi - lo)) * (w - 140) : w / 2;
}

export function radius(n: GNode): number {
  return (n.card ? 7 : 4) + Math.sqrt(n.support) * (n.card ? 2.4 : 1.6);
}
