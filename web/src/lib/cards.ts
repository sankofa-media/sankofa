import type { Book, Card, Chapter, Place } from './types';
import { BOOK_SYMBOLS } from './types';
import { slug } from './fragment';
import { localizeCredit, t } from './i18n';

export { links, plain, segments, type Segment } from './links';
import { links } from './links';

export class CardSet {
  readonly byId = new Map<string, Card>();
  readonly order: string[];

  constructor(cards: Card[]) {
    for (const c of cards) {
      this.byId.set(c.id, { ...c, edition: c.edition || 'both' });
    }
    this.order = [...this.byId.keys()].sort();
  }

  get(id: string): Card | undefined {
    return this.byId.get(id);
  }

  all(): Card[] {
    return this.order.map((id) => this.byId.get(id)!);
  }

  /** The other card of an m/f pair: the same theme told in the other copy. */
  partner(id: string): Card | undefined {
    const c = this.byId.get(id);
    if (!c?.pair) return undefined;
    return this.all().find((o) => o.pair === c.pair && o.id !== c.id);
  }

  backlinks(id: string): string[] {
    const c = this.byId.get(id);
    if (c?.backlinks) return c.backlinks;
    return this.order.filter((oid) => links(this.byId.get(oid)!.body).includes(id));
  }

  /** Resolve a fragment place key: a card id, or the slug of a place name. */
  resolvePlace(key: string): Place | undefined {
    const byCard = this.byId.get(key);
    if (byCard?.places[0]) return byCard.places[0];
    let partial: Place | undefined;
    for (const c of this.all()) {
      for (const p of c.places) {
        const s = placeKey(p);
        if (s === key) return p;
        if (!partial && s.split('-').includes(key)) partial = p;
      }
    }
    return partial;
  }
}

export function bookSymbols(books: Book[] | undefined): string {
  return (books ?? []).map((b) => BOOK_SYMBOLS[b] ?? '').join('');
}

export function span(c: { years: number[] }): [number, number] {
  const a = c.years[0];
  const b = c.years[1] ?? a;
  return [a, b];
}

/**
 * The year and place a card's story is about: its moment when set, else its
 * first year at its first place. `years` stays the span shown elsewhere.
 */
export function when(c: { years: number[]; places?: Place[]; moment?: Card['moment'] }): { year: number; place: Place } {
  const m = c.moment;
  const places = c.places ?? [];
  const place = (m && places[m.place ?? 0]) || places[0];
  return { year: m?.year ?? c.years[0], place };
}

export function formatYears(years: number[]): string {
  if (!years.length) return '';
  const fmt = (y: number) => (y < 0 ? `${-y} ${t('BCE')}` : String(y));
  return years.length > 1 && years[1] !== years[0] ? `${fmt(years[0])}–${fmt(years[1])}` : fmt(years[0]);
}

export const KIND_LABEL: Record<string, string> = {
  person: 'Person',
  genre: 'Genre',
  place: 'Place',
  object: 'Object',
  language: 'Language',
  script: 'Script',
  instrument: 'Instrument',
  event: 'Event',
  media: 'Media',
  work: 'Work',
  myth: 'Myth, examined',
  comparison: 'Comparison',
};

export function overlaps(c: { years: number[] }, from?: number, to?: number): boolean {
  if (!from) return true;
  const [a, b] = span(c);
  const end = to ?? from;
  return b >= from && a <= end;
}

/**
 * A card in the reader's language, like card.Localized: anything missing or
 * of the wrong length stays in English. Place names keep their English form
 * in `en`, because fragments are built from it.
 */
export function localizeCard(c0: Card, lang: string): Card {
  // Licences and the museum's own credit words are translated; names stay.
  const c: Card = lang === 'en' || !c0.media ? c0 : { ...c0, media: c0.media.map((m) => ({ ...m, credit: localizeCredit(m.credit, lang as 'ru'), license: localizeCredit(m.license, lang as 'ru') })) };
  const tr = lang === 'en' ? undefined : c.translations?.[lang];
  if (!tr || !tr.title) return { ...c, textLang: 'en' };
  const out: Card = { ...c, title: tr.title, wow: tr.wow || c.wow, body: tr.body || c.body, inline: tr.inline || (lang === 'en' ? c.inline : undefined), label: tr.label || c.label, textLang: tr.body ? lang : 'en' };
  if (tr.dispute) out.dispute = tr.dispute;
  if (tr.further && c.further && tr.further.length === c.further.length) out.further = tr.further;
  if (tr.places && tr.places.length === c.places.length) out.places = c.places.map((p, i) => ({ ...p, name: tr.places![i], en: p.name }));
  if (c.media?.length) {
    const same = (xs?: string[]) => (xs && xs.length === c.media!.length ? xs : undefined);
    const [caps, credits, licenses] = [same(tr.captions), same(tr.credits), same(tr.licenses)];
    if (caps || credits || licenses)
      out.media = c.media.map((m, i) => ({ ...m, caption: caps?.[i] || m.caption, credit: credits?.[i] || m.credit, license: licenses?.[i] || m.license }));
  }
  return out;
}

const COPY_MARK = /^\{(male|female)\}\s+/;

/**
 * A card body as one copy reads it: a paragraph that opens with `{male} ` or
 * `{female} ` stays only in that copy (marker stripped); the rest in both.
 */
export function bodyForEdition(body: string, edition: 'm' | 'f'): string {
  if (!/(^|\n)\s*\{(male|female)\}/.test(body)) return body;
  return body
    .split(/\n\s*\n/)
    .flatMap((p) => {
      const t = p.trim();
      const m = t.match(COPY_MARK);
      if (!m) return [p];
      return (m[1] === 'male' ? 'm' : 'f') === edition ? [t.slice(m[0].length)] : [];
    })
    .join('\n\n');
}

/** The card as the reader's copy holds it. */
export function cardForEdition(c: Card, edition: 'm' | 'f'): Card {
  const body = bodyForEdition(c.body, edition);
  return body === c.body ? c : { ...c, body };
}

/** A chapter in the reader's language; the body only when every step is there. */
export function localizeChapter(ch: Chapter, lang: string): Chapter {
  const tr = lang === 'en' ? undefined : ch.translations?.[lang];
  if (!tr) return { ...ch, textLang: 'en' };
  const steps = tr.steps && tr.steps.length === ch.steps.length ? tr.steps : ch.steps;
  return {
    ...ch,
    title: tr.title || ch.title,
    kicker: tr.kicker || ch.kicker,
    hero: ch.hero ? { ...ch.hero, caption: tr.heroCaption || ch.hero.caption, credit: tr.heroCredit || localizeCredit(ch.hero.credit, lang as 'ru'), license: tr.heroLicense || localizeCredit(ch.hero.license, lang as 'ru') } : ch.hero,
    steps,
    // Labels are written in the language of their paragraphs.
    stepLabels: steps === ch.steps ? ch.stepLabels : tr.stepLabels,
    textLang: steps === ch.steps ? 'en' : lang,
  };
}

/** The key a place has in fragments: the slug of its original name. */
export function placeKey(p: Place): string {
  return slug(p.en ?? p.name);
}
