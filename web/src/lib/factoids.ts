// The museum's short verified facts (content/factoids, data/factoids.json):
// one sentence in each language, a year, sometimes a place, the cards it
// belongs to and the two sources it was checked against. The build exports
// only checked ones (`sankofa content factoids`); this module chooses which
// to show where.
import { overlaps } from './cards';
import { links } from './links';
import type { Card } from './types';

export interface FactSource {
  title: string;
  url: string;
}

export interface Factoid {
  id: string;
  cat: string;
  en: string;
  ru: string;
  year: number;
  date?: string;
  place?: { name: string; lat: number; lon: number };
  cards: string[];
  sources: FactSource[];
  /** "single-source": shown although only one source could be confirmed. */
  status?: string;
}

export interface FactoidsFile {
  version: number;
  factoids: Factoid[];
}

export const MAX_WORDS = 30;

/**
 * Only what can be shown whole: both languages, a year, at most MAX_WORDS
 * words, two linked sources, a place with coordinates if any. The build
 * refuses anything else; this keeps a stale or hand-edited file from
 * putting half a fact on the page.
 */
export function usableFactoids(file: FactoidsFile | null | undefined): Factoid[] {
  const seen = new Set<string>();
  const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
  return (file?.factoids ?? []).filter((f) => {
    if (!f?.id || seen.has(f.id)) return false;
    seen.add(f.id);
    if (!f.en?.trim() || !f.ru?.trim() || words(f.en) > MAX_WORDS || words(f.ru) > MAX_WORDS) return false;
    if (!Number.isInteger(f.year) || f.year === 0) return false;
    if (!Array.isArray(f.cards) || !Array.isArray(f.sources) || f.sources.length < (f.status === 'single-source' ? 1 : 2)) return false;
    if (f.sources.some((s) => !s?.title || !/^https?:\/\//.test(s.url ?? ''))) return false;
    if (f.place && !(Number.isFinite(f.place.lat) && Number.isFinite(f.place.lon))) return false;
    return true;
  });
}

/** The factoids that belong to a card, its own first, then in time order; at most `max`. */
export function cardFactoids(list: Factoid[], id: string, max = 3): Factoid[] {
  return list
    .filter((f) => f.cards.includes(id))
    .sort((a, b) => Number(b.cards[0] === id) - Number(a.cards[0] === id) || a.cards.length - b.cards.length || a.year - b.year || a.id.localeCompare(b.id))
    .slice(0, max);
}

/**
 * One factoid for each quiet stretch of the descent, dated strictly inside
 * it; never the same factoid twice. Stretches with none get none.
 */
export function quietFactoids(list: Factoid[], stretches: { from: number; to: number }[]): (Factoid | undefined)[] {
  const used = new Set<string>();
  return stretches.map((q) => {
    const mid = (q.from + q.to) / 2;
    const inside = list.filter((f) => f.year > q.from && f.year < q.to && !used.has(f.id));
    // The one nearest the middle of the silence, so it reads as its voice.
    inside.sort((a, b) => Math.abs(a.year - mid) - Math.abs(b.year - mid) || a.id.localeCompare(b.id));
    const f = inside[0];
    if (f) used.add(f.id);
    return f;
  });
}

/** Atlas levels at which factoids show as dots: cities and people. */
export const FACT_LEVELS = [3, 4];

/** The factoids with a place that the atlas shows at this level and time. */
export function atlasFactoids(list: Factoid[], o: { level: number; from?: number; to?: number }): Factoid[] {
  if (!FACT_LEVELS.includes(o.level)) return [];
  // The same time filter as the cards' (atlasModel): a year, or a span.
  return list.filter((f) => f.place && overlaps({ years: [f.year] }, o.from, o.to));
}

export interface PickState {
  /** Factoids the reader has been shown before. */
  seen: Set<string>;
  /** Shown in this sitting: not again until all have been. */
  prev: Set<string>;
  /** The card the reader read last. */
  last?: Card;
  random?: () => number;
}

/**
 * The crumb picker's rules (pkg/crumbs): first factoids not seen, preferring
 * those of the card read last or of the cards it links to; no repeats until
 * the pool runs out, then from the start.
 */
export function pickFactoid(list: Factoid[], st: PickState): Factoid | undefined {
  if (!list.length) return undefined;
  const related = new Set<string>();
  if (st.last) {
    related.add(st.last.id);
    for (const l of links(st.last.body ?? '')) related.add(l);
  }
  const any = list.filter((f) => !st.prev.has(f.id));
  if (!any.length) {
    st.prev.clear();
    return pickFactoid(list, st);
  }
  const fresh = any.filter((f) => !st.seen.has(f.id));
  const near = fresh.filter((f) => f.cards.some((c) => related.has(c)));
  const pool = near.length ? near : fresh.length ? fresh : any;
  const f = pool[Math.floor((st.random ?? Math.random)() * pool.length)];
  st.prev.add(f.id);
  return f;
}

/** The store the views share: empty until the file arrives, then filled once. */
export class Facts {
  list: Factoid[] = [];
  readonly ready: Promise<void>;
  private done!: () => void;
  constructor(private loader?: () => Promise<Factoid[]>) {
    this.ready = new Promise((r) => (this.done = r));
  }
  load(): void {
    const loader = this.loader;
    if (!loader) return;
    this.loader = undefined;
    void loader().then(list => this.fill(list)).catch(() => { this.loader = loader; });
  }
  fill(list: Factoid[]): void {
    this.list = list;
    this.done();
  }
}
