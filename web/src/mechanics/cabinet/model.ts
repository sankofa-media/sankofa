// The Cabinet of Curiosities: the data the build writes (data/cabinet.json),
// its validation, and the reader's own cabinet (what they have found, sorted
// and unlocked), kept apart from the DOM so it can be tested.
//
// Caches are hidden across the museum: on a card's picture, on a word of a
// card or of a chapter step, in a drawer of the Workshop. A cache is a
// container with its own history (a sailor's sea chest, Henry "Box" Brown's
// box); opening it puts its artifacts into the reader's cabinet. A cache or a
// drawer may be locked; its key lies in another cache.

export interface L {
  en: string;
  ru: string;
}

export type Edition = 'm' | 'f';

export const CONTAINER_KINDS = ['chest', 'box', 'suitcase', 'crate', 'archive-box', 'bag', 'strongbox', 'grip'] as const;
export type ContainerKind = (typeof CONTAINER_KINDS)[number];

export const SHAPES = ['paper', 'book', 'photo', 'drawing', 'object', 'instrument', 'record'] as const;
export type Shape = (typeof SHAPES)[number];

export type Hidden =
  | { at: 'card-image'; card: string; x: number; y: number }
  | { at: 'card-text'; card: string; anchor: L }
  | { at: 'chapter-step'; chapter: string; anchor: L }
  | { at: 'workshop'; object: string };

export interface Cache {
  id: string;
  kind: ContainerKind;
  name: L;
  place: L;
  time: L;
  story: L;
  hidden: Hidden;
  /** the key that opens it, when it is locked */
  lock?: string;
  /** keys found inside */
  gives?: string[];
  /** artifacts inside, in both copies and in one copy only */
  contents: { both?: string[]; m?: string[]; f?: string[] };
  cards?: string[];
}

export interface Artifact {
  id: string;
  drawer: string;
  shape: Shape;
  image: string;
  width?: number;
  height?: number;
  caption: L;
  credit: string;
  license: string;
  url: string;
  place: L;
  year: string;
  note: L;
  cards: string[];
  /** filled by the build from the ledger */
  sources?: { title: string; url: string }[];
}

export interface Drawer {
  id: string;
  label: L;
  /** a secret drawer opens only with this key */
  lock?: string;
  /** what the drawer says about itself (the honest drawer, a secret one) */
  intro?: L;
  /** artifacts that lie in the drawer itself, not in a cache */
  contents?: string[];
}

export interface Key {
  id: string;
  name: L;
  note: L;
}

export interface CabinetFile {
  version: 1;
  intro: L;
  drawers: Drawer[];
  caches: Cache[];
  artifacts: Artifact[];
  keys: Key[];
  /** facts behind the drawers' and caches' own texts, by subject */
  sources?: Record<string, { title: string; url: string }[]>;
}

/** the unsorted heap: where every find lands before it is sorted, and where the strays stay. */
export const HEAP = 'heap';

// ---------- validation ----------

export interface Fact {
  /** cache:<id>, artifact:<id> or drawer:<id> */
  id: string;
  /** `image`: what a picture shows, which its own source page states */
  about?: 'image';
  claim: string;
  sources: { title: string; url: string; quote: string; opened?: string }[];
}

export interface Known {
  cards: Set<string>;
  chapters: Set<string>;
  objects: Set<string>;
  media: Set<string>;
  /** image files with a rights record whose checksum matches */
  rights: Set<string>;
  /** a card's or chapter's text, per language, for anchors */
  text(kind: 'card' | 'chapter', id: string, lang: 'en' | 'ru'): string;
  facts: Fact[];
}

const filled = (v: L | undefined) => !!v?.en?.trim() && !!v?.ru?.trim();
const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
};
const weak = (u: string) => /(^|\.)wikipedia\.org$/.test(host(u));

/** Whether an anchor can be found in a text: in plain words, not across a link. */
export function anchorIn(text: string, anchor: string): boolean {
  return anchorRegExp(anchor).test(text.replace(/\[\[[^\]]*\]\]/g, '\u0000'));
}

/** An anchor as a pattern: any run of spaces (typographic ones too) matches any other. */
export function anchorRegExp(anchor: string): RegExp {
  const esc = anchor
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\s\\u00a0\\u202f]+');
  return new RegExp(esc);
}

/** Everything wrong with the cabinet's data, as messages; an empty list means it may be built. */
export function validateCabinet(f: CabinetFile, k: Known): string[] {
  const errs: string[] = [];
  const art = new Map(f.artifacts.map((a) => [a.id, a]));
  const drawers = new Map(f.drawers.map((d) => [d.id, d]));
  const keys = new Set(f.keys.map((x) => x.id));
  const dup = (what: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) errs.push(`${what} ${id} is defined twice`);
      seen.add(id);
    }
  };
  dup('artifact', f.artifacts.map((a) => a.id));
  dup('cache', f.caches.map((c) => c.id));
  dup('drawer', f.drawers.map((d) => d.id));
  dup('key', f.keys.map((x) => x.id));
  if (!filled(f.intro)) errs.push('cabinet: intro needs English and Russian');

  const factsBy = new Map<string, Fact[]>();
  for (const fact of k.facts) factsBy.set(fact.id, [...(factsBy.get(fact.id) ?? []), fact]);
  for (const fact of k.facts) {
    const strong = fact.sources.filter((s) => s.url && s.quote?.trim() && !weak(s.url));
    // Two sources from one site are one source; a museum card was checked on its own.
    const hosts = new Set(strong.map((s) => host(s.url)));
    const fromCard = strong.some((s) => s.url.startsWith('card:'));
    // What a picture shows rests on the picture's own source page.
    const ofImage = fact.about === 'image' && strong.length >= 1;
    if (!fromCard && !ofImage && hosts.size < 2) errs.push(`ledger: ${fact.id}: "${fact.claim.slice(0, 60)}" needs two independent sources with quotes (Wikipedia does not count)`);
    for (const s of fact.sources) if (s.url.startsWith('card:') && !k.cards.has(s.url.slice(5))) errs.push(`ledger: ${fact.id}: card ${s.url.slice(5)} does not exist`);
    const [kind, id] = fact.id.split(':');
    const ok = kind === 'artifact' ? art.has(id) : kind === 'cache' ? f.caches.some((c) => c.id === id) : kind === 'drawer' ? drawers.has(id) : false;
    if (!ok) errs.push(`ledger: ${fact.id} names nothing in the cabinet`);
  }

  for (const d of f.drawers) {
    if (!filled(d.label)) errs.push(`drawer ${d.id}: label needs English and Russian`);
    if (d.intro && !filled(d.intro)) errs.push(`drawer ${d.id}: intro needs English and Russian`);
    if (d.intro && d.id !== HEAP && !factsBy.has(`drawer:${d.id}`)) errs.push(`drawer ${d.id}: its intro has no facts in the ledger`);
    if (d.lock && !keys.has(d.lock)) errs.push(`drawer ${d.id}: key ${d.lock} does not exist`);
    for (const a of d.contents ?? []) if (!art.has(a)) errs.push(`drawer ${d.id}: artifact ${a} does not exist`);
  }
  if (!drawers.has(HEAP)) errs.push(`cabinet: there is no ${HEAP} drawer (the unsorted heap)`);

  const placed = new Map<string, string>();
  const place = (a: string, where: string) => {
    if (placed.has(a)) errs.push(`artifact ${a} lies both in ${placed.get(a)} and in ${where}`);
    placed.set(a, where);
  };
  for (const d of f.drawers) for (const a of d.contents ?? []) place(a, `drawer ${d.id}`);

  const givenKeys = new Set<string>();
  for (const c of f.caches) {
    const at = `cache ${c.id}`;
    if (!CONTAINER_KINDS.includes(c.kind)) errs.push(`${at}: unknown kind ${c.kind}`);
    for (const fld of ['name', 'place', 'time', 'story'] as const) if (!filled(c[fld])) errs.push(`${at}: ${fld} needs English and Russian`);
    if (!factsBy.has(`cache:${c.id}`)) errs.push(`${at}: its story has no facts in the ledger`);
    for (const id of c.cards ?? []) if (!k.cards.has(id)) errs.push(`${at}: card ${id} does not exist`);
    if (c.lock && !keys.has(c.lock)) errs.push(`${at}: key ${c.lock} does not exist`);
    for (const g of c.gives ?? []) {
      if (!keys.has(g)) errs.push(`${at}: gives key ${g}, which does not exist`);
      givenKeys.add(g);
    }
    const all = [...(c.contents.both ?? []), ...(c.contents.m ?? []), ...(c.contents.f ?? [])];
    if (!all.length) errs.push(`${at}: is empty`);
    for (const e of ['m', 'f'] as const) if (!contentsFor(c, e).length) errs.push(`${at}: holds nothing in the ${e} copy`);
    for (const a of all) {
      if (!art.has(a)) errs.push(`${at}: artifact ${a} does not exist`);
      place(a, at);
    }
    const hd = c.hidden;
    if (!hd) errs.push(`${at}: is hidden nowhere`);
    else if (hd.at === 'card-image') {
      if (!k.cards.has(hd.card)) errs.push(`${at}: card ${hd.card} does not exist`);
      if (!(hd.x >= 0 && hd.x <= 100 && hd.y >= 0 && hd.y <= 100)) errs.push(`${at}: hotspot x/y must be percentages`);
    } else if (hd.at === 'card-text' || hd.at === 'chapter-step') {
      const kind = hd.at === 'card-text' ? 'card' : 'chapter';
      const id = hd.at === 'card-text' ? hd.card : hd.chapter;
      if (!(kind === 'card' ? k.cards : k.chapters).has(id)) errs.push(`${at}: ${kind} ${id} does not exist`);
      else if (!filled(hd.anchor)) errs.push(`${at}: anchor needs English and Russian`);
      else for (const lang of ['en', 'ru'] as const) if (!anchorIn(k.text(kind, id, lang), hd.anchor[lang])) errs.push(`${at}: the ${lang} anchor "${hd.anchor[lang]}" is not in the text of ${kind} ${id}`);
    } else if (hd.at === 'workshop') {
      if (!k.objects.has(hd.object)) errs.push(`${at}: the Workshop has no object ${hd.object}`);
    } else errs.push(`${at}: unknown hiding place ${(hd as { at: string }).at}`);
  }
  for (const x of f.keys) {
    if (!filled(x.name) || !filled(x.note)) errs.push(`key ${x.id}: name and note need English and Russian`);
    if (!givenKeys.has(x.id)) errs.push(`key ${x.id}: no cache holds it`);
  }
  // A lock whose key lies only behind the same lock can never be opened.
  for (const c of f.caches) if (c.lock && (c.gives ?? []).includes(c.lock)) errs.push(`cache ${c.id}: holds its own key`);

  for (const a of f.artifacts) {
    const at = `artifact ${a.id}`;
    if (!placed.has(a.id)) errs.push(`${at}: lies in no cache and no drawer`);
    if (!drawers.has(a.drawer)) errs.push(`${at}: drawer ${a.drawer} does not exist`);
    if (!SHAPES.includes(a.shape)) errs.push(`${at}: unknown shape ${a.shape}`);
    for (const fld of ['caption', 'place', 'note'] as const) if (!filled(a[fld])) errs.push(`${at}: ${fld} needs English and Russian`);
    if (!a.year) errs.push(`${at}: has no year`);
    if (!a.cards?.length) errs.push(`${at}: names no card`);
    for (const id of a.cards ?? []) if (!k.cards.has(id)) errs.push(`${at}: card ${id} does not exist`);
    if (!k.media.has(a.image)) errs.push(`${at}: image ${a.image} is not in content/media`);
    else if (!k.rights.has(a.image)) errs.push(`${at}: image ${a.image} has no rights record (or its checksum does not match)`);
    if (!a.url || !a.license || !a.credit) errs.push(`${at}: needs credit, license and the source page url`);
    if (!factsBy.has(`artifact:${a.id}`)) errs.push(`${at}: its note has no facts in the ledger`);
  }
  return errs;
}

// ---------- what a reader can find ----------

/** The artifacts a cache holds in a copy. */
export function contentsFor(c: Cache, e: Edition): string[] {
  return [...(c.contents.both ?? []), ...(c.contents[e] ?? [])];
}

/** Every artifact a reader of this copy can come to hold. */
export function reachable(f: CabinetFile, e: Edition): Set<string> {
  const out = new Set<string>();
  for (const c of f.caches) contentsFor(c, e).forEach((a) => out.add(a));
  for (const d of f.drawers) (d.contents ?? []).forEach((a) => out.add(a));
  return out;
}

// ---------- the reader's own cabinet ----------

export interface Holdings {
  /** artifacts found, in the order found */
  found: string[];
  /** found artifacts the reader has put into their drawers */
  sorted: string[];
  /** caches opened */
  opened: string[];
  /** keys in hand */
  keys: string[];
  /** locks opened (a cache's or a drawer's key id, by what it opened) */
  unlocked: string[];
}

export const EMPTY: Holdings = { found: [], sorted: [], opened: [], keys: [], unlocked: [] };

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Holdings read back from storage; anything malformed is an empty cabinet. */
export function parseHoldings(raw: string | null): Holdings {
  if (!raw) return { ...EMPTY };
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    return { found: strings(o.found), sorted: strings(o.sorted), opened: strings(o.opened), keys: strings(o.keys), unlocked: strings(o.unlocked) };
  } catch {
    return { ...EMPTY };
  }
}

const add = (list: string[], ...ids: string[]) => [...list, ...ids.filter((id) => !list.includes(id))];

export type OpenResult = { state: Holdings; status: 'opened' | 'again' | 'locked' | 'unlocked'; artifacts: string[]; keys: string[] };

/** A cache's lock: open with no key, and closed for good once the key has turned. */
export function isLocked(c: Cache, h: Holdings): boolean {
  return !!c.lock && !h.unlocked.includes(`cache:${c.id}`);
}

/**
 * Open a cache. A locked one stays shut unless the reader holds its key (and
 * `useKey` is asked); its artifacts and keys then go into the cabinet: the
 * artifacts into the unsorted heap, unsorted.
 */
export function openCache(f: CabinetFile, h: Holdings, cacheId: string, e: Edition, useKey = false): OpenResult {
  const c = f.caches.find((x) => x.id === cacheId);
  if (!c) return { state: h, status: 'locked', artifacts: [], keys: [] };
  let state = h;
  let status: OpenResult['status'] = h.opened.includes(c.id) ? 'again' : 'opened';
  if (isLocked(c, h)) {
    if (!useKey || !h.keys.includes(c.lock!)) return { state: h, status: 'locked', artifacts: [], keys: [] };
    state = { ...state, unlocked: add(state.unlocked, `cache:${c.id}`) };
    status = 'unlocked';
  }
  const artifacts = contentsFor(c, e);
  const keys = c.gives ?? [];
  state = { ...state, found: add(state.found, ...artifacts), keys: add(state.keys, ...keys), opened: add(state.opened, c.id) };
  return { state, status, artifacts, keys };
}

/** Whether a drawer is open to this reader: unlocked drawers always are. */
export function drawerOpen(d: Drawer, h: Holdings): boolean {
  return !d.lock || h.unlocked.includes(`drawer:${d.id}`);
}

/** Turn a key in a secret drawer; nothing happens without the key. */
export function unlockDrawer(f: CabinetFile, h: Holdings, drawerId: string): Holdings {
  const d = f.drawers.find((x) => x.id === drawerId);
  if (!d?.lock || drawerOpen(d, h) || !h.keys.includes(d.lock)) return h;
  return { ...h, unlocked: add(h.unlocked, `drawer:${d.id}`), found: add(h.found, ...(d.contents ?? [])), sorted: add(h.sorted, ...(d.contents ?? [])) };
}

/** Put a found artifact into its drawer, if that drawer is open. */
export function sortInto(f: CabinetFile, h: Holdings, artifactId: string): Holdings {
  const a = f.artifacts.find((x) => x.id === artifactId);
  const d = a && f.drawers.find((x) => x.id === a.drawer);
  if (!a || !d || !h.found.includes(a.id) || h.sorted.includes(a.id) || !drawerOpen(d, h)) return h;
  return { ...h, sorted: add(h.sorted, a.id) };
}

/** Whether an artifact is the reader's to see: found, or lying open in an unlocked drawer. */
export function held(f: CabinetFile, h: Holdings, a: Artifact): boolean {
  if (h.found.includes(a.id)) return true;
  return f.drawers.some((d) => !d.lock && (d.contents ?? []).includes(a.id));
}

export interface Slot {
  artifact: Artifact;
  /** false: a dusty silhouette with "something lay here" */
  here: boolean;
}

/**
 * A drawer's slots for a reader: what they have put there, and a silhouette
 * for each thing of their copy still missing. the unsorted heap holds every
 * unsorted find, and its own strays.
 */
export function slots(f: CabinetFile, h: Holdings, drawerId: string, e: Edition): Slot[] {
  const can = reachable(f, e);
  if (drawerId === HEAP) {
    return f.artifacts
      .filter((a) => can.has(a.id) && h.found.includes(a.id) && (!h.sorted.includes(a.id) || a.drawer === HEAP))
      .map((artifact) => ({ artifact, here: true }));
  }
  return f.artifacts
    .filter((a) => a.drawer === drawerId && can.has(a.id))
    .map((artifact) => ({ artifact, here: held(f, h, artifact) && (h.sorted.includes(artifact.id) || !h.found.includes(artifact.id)) }))
    .filter((s) => s.here || !h.found.includes(s.artifact.id));
}

/** "4 of 21": what a reader of this copy has, and what there is to find. */
export function tally(f: CabinetFile, h: Holdings, e: Edition): { have: number; of: number } {
  const can = reachable(f, e);
  const have = f.artifacts.filter((a) => can.has(a.id) && held(f, h, a)).length;
  return { have, of: can.size };
}
