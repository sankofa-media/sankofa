// The musical elements the roots carry from station to station (blue notes,
// the backbeat, call and response…), the steps between genre cards told
// through them, and the main lines of the traditions. All three come with
// the cards (`sankofa content export`: rootsElements, rootsCardLinks,
// rootsLines); the museum works without any of them.
import type { RootSource } from './roots';

export interface Quote extends RootSource {
  quote?: string;
}

export interface MusicElement {
  id: string;
  name: string;
  nameRu?: string;
  what: string;
  whatRu?: string;
  /** museum card ids where the element comes from */
  origin: string[];
  sources: Quote[];
}

/** A step from a genre card to one of its roots, told by what it carried. */
export interface CardLink {
  from: string;
  to: string;
  kind?: string;
  how: string;
  howRu?: string;
  carries?: string[];
  /** the cards' own sentences the step rests on */
  facts?: { card: string; quote: string }[];
  sources?: Quote[];
}

/** A main line through the traditions, with a short overview. */
export interface Line {
  id: string;
  name: string;
  nameRu?: string;
  /** museum card ids, oldest first */
  path: string[];
  elements?: string[];
  overview: string;
  overviewRu?: string;
  sources: Quote[];
}

export interface ElementsFile {
  elements: MusicElement[];
}

export interface CardLinksFile {
  links: CardLink[];
}

const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const ids = (v: unknown): string[] => list<unknown>(v).filter((x): x is string => typeof x === 'string' && !!x);

/** The roots' extra layers as exported, with anything missing or malformed left out. */
export function rootsExtras(doc: { rootsElements?: unknown; rootsCardLinks?: unknown; rootsLines?: unknown }): { elements: ElementsFile; cardLinks: CardLinksFile; lines: Line[] } {
  const elements = list<MusicElement>(doc.rootsElements)
    .filter((e) => e?.id && e.name)
    .map((e) => ({ ...e, what: e.what ?? '', origin: ids(e.origin).map((o) => o.replace(/^card:/, '')), sources: list<Quote>(e.sources) }));
  const links = list<CardLink>(doc.rootsCardLinks)
    .filter((l) => l?.from && l.to)
    .map((l) => ({ ...l, how: l.how ?? '', carries: ids(l.carries), facts: list<{ card: string; quote: string }>(l.facts), sources: list<Quote>(l.sources) }));
  const lines = list<Line>(doc.rootsLines)
    .filter((l) => l?.id && l.name && Array.isArray(l.path))
    .map((l) => ({ ...l, elements: ids(l.elements), overview: l.overview ?? '', sources: list<Quote>(l.sources) }));
  return { elements: { elements }, cardLinks: { links }, lines };
}

/** Card-to-card links by "from>to" (card ids without the prefix). */
export function cardLinkIndex(f: CardLinksFile): Map<string, CardLink> {
  return new Map(f.links.map((l) => [`${l.from}>${l.to}`, l]));
}

/**
 * The lines a route follows: those sharing at least two of its museum
 * cards, the closest first.
 */
export function linesOf(route: string[], lines: Line[]): Line[] {
  const cards = route.filter((r) => r.startsWith('card:')).map((r) => r.slice(5));
  return lines
    // Ties go to the line through the card where the artist's chain enters the museum.
    .map((l) => ({ l, n: cards.filter((c) => l.path.includes(c)).length + (l.path.includes(cards[0]) ? 0.5 : 0) }))
    .filter((x) => x.n >= 2)
    .sort((a, b) => b.n - a.n)
    .map((x) => x.l);
}

// Thread colours: distinct on the dark roots background, none of them the
// gold of the route itself.
const PALETTE = ['#6ac0a8', '#e07a50', '#8fa4e8', '#c79ae8', '#9fd08a', '#ef8fb0', '#5fc4e0', '#d9c35a', '#f0a868', '#b0c4a0', '#e8b4f0', '#7fd6c2', '#f07a7a', '#a8b8ff', '#c6a16e', '#7ab0d8'];

/** A stable colour per element, by its place in the file. */
export function elementColors(f: ElementsFile): Map<string, string> {
  return new Map(f.elements.map((e, i) => [e.id, PALETTE[i % PALETTE.length]]));
}
