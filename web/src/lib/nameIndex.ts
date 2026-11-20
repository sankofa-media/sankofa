// The name index: every card of the dictionary in alphabetical order, in the
// reader's language. Russian is sorted by the Russian titles, Cyrillic first
// and then Latin, Ё filed with Е as in Russian dictionaries; English ignores a
// leading "The". Quotation marks and accents never decide the order.
import type { Card } from './types';
import type { Lang } from './i18n';

export interface IndexEntry {
  id: string;
  title: string;
  /** The title in English too, so a reader can find a card by either name. */
  en: string;
  kind: string;
  years: number[];
  wow: string;
  letter: string;
  key: string;
}

/** Letters, digits and spaces only, lower case, without accents; ё reads е. */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    // Accents go from Latin letters only: Russian й is a letter of its own.
    .replace(/[^\p{Script=Cyrillic}]/gu, (ch) => ch.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The part of a title the index files it by. */
export function sortTitle(title: string, l: Lang): string {
  let s = title.replace(/^[\s"'“”«»„(\[]+/, '');
  if (l === 'en') s = s.replace(/^the\s+/i, '');
  return s;
}

/** The letter an entry is filed under: Ё under Е, digits under #. */
export function letterOf(title: string, l: Lang): string {
  const c = fold(sortTitle(title, l)).charAt(0).toUpperCase();
  if (!c) return '#';
  if (/\p{N}/u.test(c)) return '#';
  return c;
}

const cyr = (s: string) => /^\p{Script=Cyrillic}/u.test(s);

/** Compare two titles as the index orders them. */
export function compareTitles(a: string, b: string, l: Lang): number {
  const x = fold(sortTitle(a, l));
  const y = fold(sortTitle(b, l));
  const digit = (s: string) => /^\p{N}/u.test(s);
  if (digit(x) !== digit(y)) return digit(x) ? 1 : -1;
  if (l === 'ru' && cyr(x) !== cyr(y)) return cyr(x) ? -1 : 1;
  return x.localeCompare(y, l, { sensitivity: 'base', numeric: true }) || a.localeCompare(b, l);
}

/** Every card as an index entry, in order. `raw` gives the English title. */
export function indexEntries(cards: Card[], l: Lang, raw: (id: string) => Card | undefined = () => undefined): IndexEntry[] {
  return cards
    .map((c) => ({
      id: c.id,
      title: c.title,
      en: c.sourceTitle ?? raw(c.id)?.title ?? c.title,
      kind: c.kind,
      years: c.years,
      wow: c.wow,
      letter: letterOf(c.title, l),
      key: fold(sortTitle(c.title, l)),
    }))
    .sort((a, b) => compareTitles(a.title, b.title, l));
}

/** The letters in the order the index shows them. */
export function letters(entries: IndexEntry[]): string[] {
  return [...new Set(entries.map((e) => e.letter))];
}

/** Entries whose title (in either language) holds the query, of the chosen kinds (none chosen: all). */
export function filterEntries(entries: IndexEntry[], query: string, kinds: ReadonlySet<string>): IndexEntry[] {
  const q = fold(query);
  return entries.filter((e) => (!kinds.size || kinds.has(e.kind)) && (!q || fold(e.title).includes(q) || fold(e.en).includes(q)));
}
