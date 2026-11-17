// A song's family tree for a feature's river: the research file
// (content/features/<id>/lineage.yaml, every node with its sources) turned
// into what the page draws. Pure: shared by the build and the browser.
//
// Each version is a node with its parents. The river runs in two branches:
// what descends from the field recording itself (the girls' branch) and what
// descends from Nina Simone's arrangement (Simone's branch). Every node
// carries a glyph for what travelled on to it: the clap, the refrain, the
// arrangement or the master tape itself.

export type Branch = 'source' | 'girls' | 'simone';
export type Glyph = 'clap' | 'refrain' | 'arrangement' | 'tape';
export const GLYPHS: readonly Glyph[] = ['clap', 'refrain', 'arrangement', 'tape'];
/** What the river's filter sorts by. */
export type Category = 'archive' | 'cover' | 'sample' | 'remix' | 'screen';
export const CATEGORIES: readonly Category[] = ['cover', 'sample', 'remix', 'screen', 'archive'];

export interface RawSource {
  title?: string;
  url?: string;
  quote?: string;
}

export interface RawNode {
  id: string;
  title: string;
  artist?: string;
  year: number | null;
  kind: string;
  parents?: string[];
  what_travelled?: string;
  playable_url?: string | null;
  playable_audio_direct?: string | null;
  sources?: RawSource[];
  /** A disputed link the owner confirmed: its supporting claims stand in for sources. */
  verified?: boolean;
  claims_for?: { who?: string; url?: string; quote?: string; says?: string }[];
  /** The version's short story for readers, in both languages. */
  story?: { en: string; ru: string };
}

export interface RawSync {
  work: string;
  type: string;
  year: number;
  version_used?: string;
  sources?: RawSource[];
}

export interface RawLineage {
  nodes: RawNode[];
  sync?: RawSync[];
}

export type Play = { source: 'youtube'; youtube: string } | { source: 'audio'; audio: string };

export interface LineageNode {
  id: string;
  title: string;
  artist: string;
  year: number | null;
  kind: string;
  parents: string[];
  branch: Branch;
  glyph: Glyph;
  categories: Category[];
  /** An official recording the docked player can start. */
  play?: Play;
  /** A page to listen at, when the recording cannot be played inside the museum. */
  link?: string;
  sources: { title: string; url: string }[];
  /** The version's short story for readers. */
  story?: { en: string; ru: string };
}

export interface SyncEntry {
  work: string;
  type: string;
  year: number;
  sources: { title: string; url: string }[];
}

export interface LineageData {
  nodes: LineageNode[];
  sync: SyncEntry[];
}

/** Recordings play only from these hosts, through the museum's docked player. */
export const PLAYER_HOSTS = ['www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be', 'tile.loc.gov'];
/** Pages a node may point to for listening when it cannot be played inside. */
export const LINK_HOSTS = ['www.loc.gov', 'loc.gov', '*.bandcamp.com'];

function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.hostname : null;
  } catch {
    return null;
  }
}

function hostIn(host: string, list: string[]): boolean {
  return list.some((h) => (h.startsWith('*.') ? host.endsWith(h.slice(1)) : host === h));
}

/** The YouTube video id of a watch or short link. */
export function youtubeId(url: string): string | null {
  const host = hostOf(url);
  if (!host) return null;
  const u = new URL(url);
  const id = host === 'youtu.be' ? u.pathname.slice(1) : u.searchParams.get('v');
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

/** How a node is heard: in the docked player, at a page outside, or not at all. Throws on a host that is not allowed. */
export function playableOf(n: Pick<RawNode, 'id' | 'playable_url' | 'playable_audio_direct'>): { play?: Play; link?: string } {
  const direct = n.playable_audio_direct ?? undefined;
  if (direct) {
    const host = hostOf(direct);
    if (host !== 'tile.loc.gov') throw new Error(`${n.id}: playable_audio_direct must be a https://tile.loc.gov file, got ${direct}`);
    return { play: { source: 'audio', audio: direct }, ...(n.playable_url ? { link: n.playable_url } : {}) };
  }
  const url = n.playable_url ?? undefined;
  if (!url) return {};
  const host = hostOf(url);
  if (!host) throw new Error(`${n.id}: playable_url must be https: ${url}`);
  if (hostIn(host, PLAYER_HOSTS)) {
    const id = youtubeId(url);
    if (!id) throw new Error(`${n.id}: not a YouTube video link: ${url}`);
    return { play: { source: 'youtube', youtube: id } };
  }
  if (hostIn(host, LINK_HOSTS)) return { link: url };
  throw new Error(`${n.id}: playable_url host ${host} is not allowed (player: ${PLAYER_HOSTS.join(', ')}; links: ${LINK_HOSTS.join(', ')})`);
}

function sourcesOf(list: RawSource[] | undefined): { title: string; url: string }[] {
  return (list ?? []).filter((s) => s.title && s.url).map((s) => ({ title: String(s.title), url: String(s.url) }));
}

/** A node's sources; for a disputed node the owner verified, the claims that support it. */
export function nodeSources(n: Pick<RawNode, 'sources' | 'verified' | 'claims_for'>): { title: string; url: string }[] {
  const own = sourcesOf(n.sources);
  if (own.length || n.verified !== true) return own;
  return sourcesOf((n.claims_for ?? []).map((c) => ({ title: c.who, url: c.url })));
}

/** Problems in the research file itself. */
export function validateLineage(raw: RawLineage): string[] {
  const errs: string[] = [];
  const byId = new Map<string, RawNode>();
  for (const n of raw.nodes ?? []) {
    if (byId.has(n.id)) errs.push(`${n.id}: duplicate node`);
    byId.set(n.id, n);
  }
  for (const n of raw.nodes ?? []) {
    for (const p of n.parents ?? []) {
      const pn = byId.get(p);
      if (!pn) errs.push(`${n.id}: parent ${p} does not exist`);
      else if (pn.year !== null && n.year !== null && pn.year > n.year) errs.push(`${n.id}: parent ${p} (${pn.year}) is younger than the node (${n.year})`);
    }
    try {
      playableOf(n);
    } catch (e) {
      errs.push((e as Error).message);
    }
  }
  return errs;
}

/** Node ids with at least one source that names a title and a link. */
export function sourcedNodes(raw: RawLineage): Set<string> {
  return new Set((raw.nodes ?? []).filter((n) => nodeSources(n).length > 0).map((n) => n.id));
}

/**
 * The branch of every node. The field recording roots the girls' branch and
 * Simone's recording roots hers; a node belongs to Simone's branch only when
 * everything it came from did, so a version that went back to the 1939
 * voices (Feist named both) stays with the girls.
 */
export function branches(raw: RawLineage, roots: { girls: string; simone: string }, override: Record<string, Branch> = {}): Map<string, Branch> {
  const byId = new Map((raw.nodes ?? []).map((n) => [n.id, n]));
  const out = new Map<string, Branch>();
  const visit = (id: string, stack: Set<string>): Branch => {
    const done = out.get(id);
    if (done) return done;
    let b: Branch;
    if (override[id]) b = override[id];
    else if (id === roots.simone) b = 'simone';
    else if (id === roots.girls) b = 'girls';
    else {
      const parents = (byId.get(id)?.parents ?? []).filter((p) => byId.has(p) && !stack.has(p));
      if (parents.length === 0) b = 'source';
      else {
        stack.add(id);
        const pb = parents.map((p) => visit(p, stack));
        stack.delete(id);
        b = pb.every((x) => x === 'simone') ? 'simone' : 'girls';
      }
    }
    out.set(id, b);
    return b;
  };
  for (const n of raw.nodes ?? []) visit(n.id, new Set());
  return out;
}

/** The glyph a node gets unless the feature names one. */
export function defaultGlyph(kind: string, branch: Branch): Glyph {
  if (kind === 'remix' || kind === 'sample' || kind === 'field-recording') return 'tape';
  if (kind === 'interpolation') return 'refrain';
  if (kind === 'cover') return branch === 'simone' ? 'arrangement' : 'refrain';
  return 'clap';
}

export function categoryOf(kind: string): Category {
  if (kind === 'cover') return 'cover';
  if (kind === 'sample' || kind === 'interpolation') return 'sample';
  if (kind === 'remix') return 'remix';
  return 'archive';
}

export interface CompileOptions {
  /** The nodes the river shows, in any order. */
  include: string[];
  roots: { girls: string; simone: string };
  glyphs?: Record<string, Glyph>;
  branch?: Record<string, Branch>;
  /** Nodes heard on screen (film, series, game). */
  screen?: string[];
}

export function compileLineage(raw: RawLineage, opts: CompileOptions): LineageData {
  const byId = new Map((raw.nodes ?? []).map((n) => [n.id, n]));
  const br = branches(raw, opts.roots, opts.branch);
  const screen = new Set(opts.screen ?? []);
  const nodes: LineageNode[] = [];
  for (const id of opts.include) {
    const n = byId.get(id);
    if (!n) throw new Error(`river: no lineage node ${id}`);
    const branch = br.get(id) ?? 'source';
    const cats: Category[] = [categoryOf(n.kind)];
    if (screen.has(id)) cats.push('screen');
    nodes.push({
      id,
      title: n.title,
      artist: n.artist ?? '',
      year: n.year,
      kind: n.kind,
      parents: (n.parents ?? []).filter((p) => opts.include.includes(p)),
      branch,
      glyph: opts.glyphs?.[id] ?? defaultGlyph(n.kind, branch),
      categories: cats,
      ...playableOf(n),
      sources: nodeSources(n),
      ...(n.story ? { story: n.story } : {}),
    });
  }
  const sync = (raw.sync ?? []).map((s) => ({ work: s.work, type: s.type, year: s.year, sources: sourcesOf(s.sources) }));
  return { nodes, sync };
}

// ---------- layout ----------

export interface Placed {
  id: string;
  row: number;
  /** Across the river, 0..1. */
  x: number;
  branch: Branch;
}

export interface RiverLayout {
  rows: number;
  placed: Placed[];
  edges: { from: string; to: string }[];
  /** The year each row begins with, for the margin. */
  years: (number | null)[];
}

const LANES: Record<Branch, [number, number]> = { source: [0.3, 0.7], girls: [0.06, 0.44], simone: [0.56, 0.94] };

/**
 * Rows go down the years; a node never sits above or beside what it came
 * from. Within a row each branch keeps its own half of the river and spreads
 * its nodes evenly across it.
 */
export function layoutRiver(nodes: Pick<LineageNode, 'id' | 'year' | 'parents' | 'branch'>[]): RiverLayout {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const yearOf = (n: { year: number | null }) => n.year ?? -Infinity;
  const years = [...new Set(nodes.map(yearOf))].sort((a, b) => a - b);
  const row = new Map<string, number>();
  let next = 0;
  for (const y of years) {
    const base = next;
    let left = nodes.filter((n) => yearOf(n) === y);
    // Inside one year, a parent before its children.
    let guard = left.length + 1;
    while (left.length && guard-- > 0) {
      const ready = left.filter((n) => n.parents.every((p) => !byId.has(p) || row.has(p) || yearOf(byId.get(p)!) !== y));
      const batch = ready.length ? ready : left;
      for (const n of batch) {
        const parentRows = n.parents.filter((p) => row.has(p)).map((p) => row.get(p)! + 1);
        const r = Math.max(base, ...parentRows);
        row.set(n.id, r);
        next = Math.max(next, r + 1);
      }
      left = left.filter((n) => !row.has(n.id));
    }
  }
  const placed: Placed[] = [];
  const cells = new Map<string, string[]>();
  for (const n of nodes) {
    const k = `${row.get(n.id)}:${n.branch}`;
    (cells.get(k) ?? cells.set(k, []).get(k)!).push(n.id);
  }
  for (const n of nodes) {
    const r = row.get(n.id)!;
    const cell = cells.get(`${r}:${n.branch}`)!;
    const [a, b] = LANES[n.branch];
    const i = cell.indexOf(n.id);
    placed.push({ id: n.id, row: r, x: a + ((b - a) * (i + 1)) / (cell.length + 1), branch: n.branch });
  }
  const edges = nodes.flatMap((n) => n.parents.filter((p) => byId.has(p)).map((p) => ({ from: p, to: n.id })));
  const yearsByRow: (number | null)[] = Array.from({ length: next }, (_, r) => {
    const n = nodes.find((x) => row.get(x.id) === r);
    return n ? n.year : null;
  });
  return { rows: next, placed, edges, years: yearsByRow };
}
