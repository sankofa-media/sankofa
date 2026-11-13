// The musical elements the roots carry from station to station (blue notes,
// the backbeat, call and response…), and the "why" of each genre-to-genre
// step, told from the museum's own cards. Both come from content files
// (content/roots/elements.yaml, content/card-links.yaml) through
// scripts/build-roots-extra.ts; the museum works without either.
import { parse as parseYaml } from 'yaml';
import type { RootSource } from './roots';

export interface MusicElement {
  id: string;
  name: string;
  nameRu?: string;
  what: string;
  whatRu?: string;
  /** museum card ids where the element comes from */
  origin: string[];
  sources: RootSource[];
}

export interface CardLink {
  from: string;
  to: string;
  claim: string;
  claimRu?: string;
  /** the card sentence the claim rests on */
  rests?: { card: string; text: string };
  carries?: string[];
  how?: string;
  howRu?: string;
}

export interface ElementsFile {
  elements: MusicElement[];
}

export interface CardLinksFile {
  links: CardLink[];
  /** pairs the cards do not explain: shown with the kind only */
  unexplained: { from: string; to: string }[];
}

export const EMPTY_ELEMENTS: ElementsFile = { elements: [] };
export const EMPTY_CARD_LINKS: CardLinksFile = { links: [], unexplained: [] };

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x) : typeof v === 'string' && v ? [v] : []);

/** Parse content/roots/elements.yaml: a list, or `{elements: [...]}`. Entries without an id or a name are dropped. */
export function parseElements(src: string): ElementsFile {
  const y = parseYaml(src) as unknown;
  const list = Array.isArray(y) ? y : ((y as { elements?: unknown })?.elements ?? []);
  const out: MusicElement[] = [];
  for (const raw of list as Record<string, unknown>[]) {
    const id = str(raw?.id);
    const name = str(raw?.name);
    if (!id || !name) continue;
    out.push({
      id,
      name,
      nameRu: str(raw.nameRu),
      what: str(raw.what) ?? '',
      whatRu: str(raw.whatRu),
      origin: ids(raw.origin ?? raw.origins).map((o) => o.replace(/^card:/, '')),
      sources: Array.isArray(raw.sources) ? (raw.sources as RootSource[]).filter((s) => s?.url) : [],
    });
  }
  return { elements: out };
}

/** Parse content/card-links.yaml. */
export function parseCardLinks(src: string): CardLinksFile {
  const y = (parseYaml(src) ?? {}) as { links?: Record<string, unknown>[]; unexplained?: { from: string; to: string }[] };
  const links: CardLink[] = [];
  for (const l of y.links ?? []) {
    const from = str(l.from);
    const to = str(l.to);
    const claim = str(l.claim);
    if (!from || !to || !claim) continue;
    const rests = l.rests as CardLink['rests'];
    links.push({ from, to, claim, claimRu: str(l.claimRu), rests: rests?.card ? rests : undefined, carries: ids(l.carries), how: str(l.how), howRu: str(l.howRu) });
  }
  return { links, unexplained: (y.unexplained ?? []).filter((p) => p?.from && p?.to) };
}

/** Card-to-card links by "from>to" (card ids without the prefix). */
export function cardLinkIndex(f: CardLinksFile): Map<string, CardLink> {
  return new Map(f.links.map((l) => [`${l.from}>${l.to}`, l]));
}

// Thread colours: distinct on the dark roots background, none of them the
// gold of the route itself.
const PALETTE = ['#6ac0a8', '#e07a50', '#8fa4e8', '#c79ae8', '#9fd08a', '#ef8fb0', '#5fc4e0', '#d9c35a', '#f0a868', '#b0c4a0', '#e8b4f0', '#7fd6c2', '#f07a7a', '#a8b8ff'];

/** A stable colour per element, by its place in the file. */
export function elementColors(f: ElementsFile): Map<string, string> {
  return new Map(f.elements.map((e, i) => [e.id, PALETTE[i % PALETTE.length]]));
}
