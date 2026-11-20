import type { Card, Chapter, Book } from './lib/types';
import { CardSet, segments, when } from './lib/cards';
import { type Point } from './lib/fragment';
import { placeKey } from './lib/cards';
import { lang } from './lib/i18n';
import { t } from './lib/i18n';
import { h } from './lib/dom';
import type { ListenFile } from './lib/listen';
import type { CardLinksFile, ElementsFile, Line } from './lib/elements';

export interface App {
  set: CardSet;
  /** The localized card before edition filtering; original YAML is loaded on demand. */
  raw(id: string): Card | undefined;
  openEngine(push?: boolean): void;
  chapters: Chapter[];
  /** Recordings to listen to, by card and by roots artist. */
  listen: ListenFile;
  /** Voices remembering slavery, with their subtitles, by card. */
  voices: import('./lib/voices').VoicesFile;
  /** Styles as route stations, keyed "style:<id>" (content/roots/styles.yaml). */
  styles: import('./lib/roots').Artist[];
  /** Musical elements the roots carry (content/roots/elements.yaml). */
  elements: ElementsFile;
  /** Genre-to-genre steps told by what they carried (content/roots/card-links.yaml). */
  cardLinks: CardLinksFile;
  /** The main lines through the traditions (content/roots/lines.yaml). */
  lines: Line[];
  edition: 'm' | 'f';
  /** The checked factoids, filled once data/factoids.json arrives. */
  facts: import('./lib/factoids').Facts;
  media(file: string): string;
  /** Open exactly this card over the current view, in either copy. */
  openCard(id: string, opts?: { push?: boolean }): void;
  closeCard(): void;
  openAtlas(p: Point, push?: boolean): void;
  openBook(): void;
  openDescent(year?: number, push?: boolean): void;
  /** Story position, kept in the fragment as ch=… next to the atlas keys. */
  chapterInView(id: string | null): void;
  onPath(cb: (path: string[]) => void): void;
}

export function cardPoint(c: Card): Point {
  // A card with a moment opens on that moment; otherwise on its span.
  if (c.moment) {
    const at = when(c);
    return { from: at.year, place: placeKey(at.place), zoom: c.zoom, focus: c.id, lang: lang() === 'en' ? undefined : lang() };
  }
  const [a, b] = [c.years[0], c.years[1]];
  return { from: a, to: b && b !== a ? b : undefined, place: placeKey(c.places[0]), zoom: c.zoom, focus: c.id, lang: lang() === 'en' ? undefined : lang() };
}

export const EDITION_NAME = { m: 'male copy', f: 'female copy' } as const;

/**
 * A link to a card that opens it in place: always the very card it names,
 * whichever copy the reader holds, since the whole dictionary is in both.
 */
export function cardLink(app: App, id: string, text: string): HTMLElement {
  const target = app.set.get(id);
  if (!target) return h('span.xref.missing', { title: t('This card is not written yet') }, text);
  const book: Book | undefined = target.books[0];
  return h(`a.xref.${book ?? 'heirs'}`, { href: `#focus=${id}`, 'data-card': id, title: `${target.title}: ${target.wow}` }, text);
}

/** Text with [[links]] as DOM; links carry the book symbol of their target. */
export function richText(app: App, text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const s of segments(text)) {
    if (!('target' in s)) frag.append(s.text);
    // A bare [[id]] shows the title of the card it names; an explicit
    // [[id|text]] always shows its own words, even when they equal the id.
    else frag.append(cardLink(app, s.target, s.explicit ? s.text : (app.set.get(s.target)?.title ?? s.text)));
  }
  return frag;
}
