// Routes: every way from an artist back to the oldest museum card, read one
// at a time. The routes come from the same tree as before (lib/roots), but
// the overview draws them as one graph with shared stations merged, like a
// metro map: where routes part, the line splits; where they meet, it joins.
// Pure logic, no DOM.
import { buildTree, extendLineage, linkTo, toDag, type Artist, type LineageCard, type LinkKind, type RootLink, type TreeNode } from './roots';
import type { CardLink, MusicElement } from './elements';

export type StepKind = LinkKind | 'lineage' | 'unknown';

/** One step of a route: from a station to the next (older) one. */
export interface RouteStep {
  from: string;
  to: string;
  kind: StepKind;
  /** the sourced link between two artists, or an artist and a card */
  link?: RootLink;
  /** the "why" of a card-to-card step, told from the cards */
  cardLink?: CardLink;
  /** elements carried along this step */
  carries: string[];
}

export interface RouteSet {
  root: string;
  /** each route: the artist, then stations down to the oldest card */
  routes: string[][];
  /** every station once, each after everything that leads to it */
  nodes: string[];
  edges: { from: string; to: string }[];
  /** the longest way from the artist to each station */
  depth: Map<string, number>;
}

/** All routes of an artist, leaves of its tree in tree order (strongest branch first). */
export function routesOfTree(tree: TreeNode): string[][] {
  const out: string[][] = [];
  const seen = new Set<string>();
  const walk = (n: TreeNode, path: string[]) => {
    const p = [...path, n.ref];
    if (!n.children.length) {
      const key = p.join('>');
      if (p.length > 1 && !seen.has(key)) (seen.add(key), out.push(p));
      return;
    }
    n.children.forEach((c) => walk(c, p));
  };
  walk(tree, []);
  return out;
}

export function routeSet(artist: Artist, byId: Map<string, Artist>, cards: Map<string, LineageCard>): RouteSet {
  const tree = extendLineage(buildTree(artist, byId), cards);
  return routeSetOfTree(tree);
}

export function routeSetOfTree(tree: TreeNode): RouteSet {
  const routes = routesOfTree(tree);
  const dag = toDag(tree);
  const depth = new Map<string, number>([[tree.ref, 0]]);
  // toDag orders by the longest way; recompute it here to hand it out.
  for (const ref of dag.order) for (const e of dag.edges) if (e.from === ref) depth.set(e.to, Math.max(depth.get(e.to) ?? 0, (depth.get(ref) ?? 0) + 1));
  return { root: tree.ref, routes, nodes: dag.order, edges: dag.edges.map((e) => ({ from: e.from, to: e.to })), depth };
}

const samePrefix = (a: string[], b: string[], n: number) => {
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
  return true;
};
const commonSuffix = (a: string[], b: string[]) => {
  let k = 0;
  while (k < a.length && k < b.length && a[a.length - 1 - k] === b[b.length - 1 - k]) k++;
  return k;
};
const commonPrefix = (a: string[], b: string[]) => {
  let k = 0;
  while (k < a.length && k < b.length && a[k] === b[k]) k++;
  return k;
};

/** Where the current route splits: at station `at`, the next stations other routes take. The current one comes first. */
export interface Fork {
  at: number;
  options: { next: string; route: number }[];
}

export function forksOf(rs: RouteSet, current: number): Fork[] {
  const cur = rs.routes[current];
  const forks: Fork[] = [];
  for (let i = 0; i < cur.length - 1; i++) {
    const options: Fork['options'] = [{ next: cur[i + 1], route: current }];
    for (let r = 0; r < rs.routes.length; r++) {
      const other = rs.routes[r];
      if (other.length <= i + 1 || !samePrefix(other, cur, i + 1)) continue;
      const next = other[i + 1];
      if (options.some((o) => o.next === next)) continue;
      options.push({ next, route: bestVia(rs, current, i, next) });
    }
    if (options.length > 1) forks.push({ at: i, options });
  }
  return forks;
}

/** The route that leaves station `at` of the current route for `next`, keeping as much of the rest as it can. */
export function bestVia(rs: RouteSet, current: number, at: number, next: string): number {
  const cur = rs.routes[current];
  let best = -1;
  let score = -1;
  rs.routes.forEach((r, i) => {
    if (r.length <= at + 1 || r[at + 1] !== next || !samePrefix(r, cur, at + 1)) return;
    const s = commonSuffix(r, cur);
    if (s > score) (best = i), (score = s);
  });
  return best;
}

/**
 * The route to take when the reader picks a station: the current route if
 * it passes there; otherwise one ending there, else one passing through it,
 * sharing as much of its beginning (then its end) with the current one.
 */
export function routeThrough(rs: RouteSet, ref: string, current: number): number {
  if (rs.routes[current]?.includes(ref)) return current;
  const cur = rs.routes[current] ?? [];
  let best = -1;
  let score = -Infinity;
  rs.routes.forEach((r, i) => {
    if (!r.includes(ref)) return;
    const s = (r[r.length - 1] === ref ? 1000 : 0) + commonPrefix(r, cur) * 10 + commonSuffix(r, cur);
    if (s > score) (best = i), (score = s);
  });
  return best;
}

/** The steps of a route, each with its link, its card-to-card "why" and what it carries. */
export function stepsOf(route: string[], byId: Map<string, Artist>, cardLinks: Map<string, CardLink>): RouteStep[] {
  const steps: RouteStep[] = [];
  for (let i = 0; i < route.length - 1; i++) {
    const from = route[i];
    const to = route[i + 1];
    if (from.startsWith('card:')) {
      const cardLink = cardLinks.get(`${from.slice(5)}>${to.replace(/^card:/, '')}`);
      steps.push({ from, to, kind: 'lineage', cardLink, carries: cardLink?.carries ?? [] });
    } else {
      const link = linkTo(byId.get(from), to);
      steps.push({ from, to, kind: link?.kind ?? 'unknown', link, carries: link?.carries ?? [] });
    }
  }
  return steps;
}

/**
 * An element's thread along a route: from the first step that carries it to
 * the last, and on to its origin card when the route reaches that card.
 * `from`/`to` are step indices (inclusive); `origin` a station index.
 */
export interface Thread {
  element: string;
  from: number;
  to: number;
  origin?: number;
}

export function threadsOf(route: string[], steps: RouteStep[], elements: Map<string, MusicElement>): Thread[] {
  const out: Thread[] = [];
  steps.forEach((s, i) => {
    for (const id of s.carries) {
      if (!elements.has(id)) continue;
      const t = out.find((x) => x.element === id);
      if (t) t.to = i;
      else out.push({ element: id, from: i, to: i });
    }
  });
  for (const t of out) {
    const origin = elements.get(t.element)!.origin;
    for (let j = t.from + 1; j < route.length; j++) {
      if (route[j].startsWith('card:') && origin.includes(route[j].slice(5))) {
        t.origin = j;
        t.to = Math.max(t.to, j - 1);
        break;
      }
    }
  }
  return out;
}

/** How many of the collection's routes (each artist's documented chains) carry each element, and by which artists. */
export function elementReach(artists: Artist[], elements: MusicElement[]): Map<string, { routes: number; artists: string[] }> {
  const byId = new Map(artists.map((a) => [a.id, a]));
  const out = new Map(elements.map((e) => [e.id, { routes: 0, artists: [] as string[] }]));
  for (const a of artists) {
    for (const p of a.paths) {
      const carried = new Set<string>();
      for (let i = 0; i < p.length - 1; i++) for (const id of linkTo(byId.get(p[i]), p[i + 1])?.carries ?? []) carried.add(id);
      for (const id of carried) {
        const r = out.get(id);
        if (!r) continue;
        r.routes++;
        if (!r.artists.includes(a.id)) r.artists.push(a.id);
      }
    }
  }
  return out;
}

/** A station's place on the overview: `at` along the line (column or row), `lane` across it. */
export interface Spot {
  at: number;
  lane: number;
}

/** A piece of line from one station to the next, drawn along `lane` between its bends. */
export interface Seg {
  from: string;
  to: string;
  lane: number;
}

export interface Overview {
  spots: Map<string, Spot>;
  segs: Seg[];
  span: number;
  lanes: number;
}

/**
 * Lay the routes out as lines. Each route in turn: stations already placed
 * stay; each new stretch between two placed stations gets the lowest lane
 * free along its whole length, so lines never run through a station. A line
 * bends half a step after it leaves a station and half a step before it
 * reaches one. `at` is a station's position along the line: its depth on
 * wide screens, its reading order on phones.
 */
export function layoutRoutes(rs: RouteSet, at: (ref: string) => number): Overview {
  const spots = new Map<string, Spot>();
  const segs: Seg[] = [];
  const drawn = new Set<string>();
  const busy: [number, number][][] = [];
  const free = (lane: number, lo: number, hi: number) => !(busy[lane] ?? []).some(([a, b]) => a <= hi && lo <= b);
  const take = (lane: number, lo: number, hi: number) => (busy[lane] ??= []).push([lo, hi]);
  spots.set(rs.root, { at: at(rs.root), lane: 0 });
  take(0, 2 * at(rs.root), 2 * at(rs.root));
  for (const route of rs.routes) {
    let i = 0;
    while (i < route.length - 1) {
      const a = route[i];
      let j = i + 1;
      while (j < route.length && !spots.has(route[j])) j++;
      const fresh = route.slice(i + 1, Math.min(j, route.length));
      const b = j < route.length ? route[j] : undefined;
      if (!fresh.length && drawn.has(`${a}>${b}`)) {
        i = j;
        continue;
      }
      const lo = 2 * at(a) + 1;
      const hi = b ? 2 * at(b) - 1 : 2 * at(fresh[fresh.length - 1]);
      const prefer = [spots.get(a)!.lane, ...(b ? [spots.get(b)!.lane] : [])];
      let lane = prefer.find((l) => free(l, lo, hi)) ?? -1;
      for (let l = 0; lane < 0; l++) if (free(l, lo, hi)) lane = l;
      take(lane, lo, hi);
      const chain = [a, ...fresh, ...(b ? [b] : [])];
      for (const n of fresh) spots.set(n, { at: at(n), lane });
      for (let k = 0; k < chain.length - 1; k++) {
        drawn.add(`${chain[k]}>${chain[k + 1]}`);
        segs.push({ from: chain[k], to: chain[k + 1], lane });
      }
      i = b ? j : route.length;
    }
  }
  let span = 0;
  let lanes = 0;
  for (const s of spots.values()) (span = Math.max(span, s.at)), (lanes = Math.max(lanes, s.lane));
  return { spots, segs, span: span + 1, lanes: lanes + 1 };
}

/**
 * A segment as points in (along, across) space, for the view to map onto
 * the screen: straight where it stays in its lane, bending half a step from
 * its ends where it leaves or joins another lane. Each piece is a line or a
 * cubic curve [start, control1, control2, end].
 */
export type Pt = [number, number];
export function segShape(seg: Seg, spots: Map<string, Spot>): Pt[][] {
  const u = spots.get(seg.from)!;
  const v = spots.get(seg.to)!;
  const L = seg.lane;
  const pieces: Pt[][] = [];
  let p: Pt = [u.at, u.lane];
  const bend = (to: Pt) => {
    const m = (p[0] + to[0]) / 2;
    pieces.push([p, [m, p[1]], [m, to[1]], to]);
    p = to;
  };
  const line = (to: Pt) => {
    if (to[0] !== p[0] || to[1] !== p[1]) pieces.push([p, to]);
    p = to;
  };
  const near = v.at - u.at <= 1;
  if (u.lane !== L) bend(near && v.lane !== L ? [(u.at + v.at) / 2, L] : [u.at + 0.5, L]);
  if (v.lane !== L) {
    line([Math.max(p[0], v.at - 0.5), L]);
    bend([v.at, v.lane]);
  } else line([v.at, v.lane]);
  return pieces;
}
