import { describe, expect, it } from 'vitest';
import { CardSet, bookSymbols, cardForEdition, formatYears, links, localizeCard, overlaps, plain, segments, when } from '../src/lib/cards';
import { atlasLayers } from '../src/lib/atlasModel';
import { quietStretches } from '../src/lib/descentModel';
import { readFileSync } from 'node:fs';
import type { Card } from '../src/lib/types';

const card = (c: Partial<Card> & { id: string }): Card => ({
  kind: 'person',
  title: c.id,
  wow: 'wow',
  years: [1800],
  places: [{ name: 'Vienna', lat: 48.2, lon: 16.37 }],
  zoom: 4,
  books: ['heirs'],
  sources: [{ title: 's' }],
  body: '',
  edition: 'both',
  ...c,
});

const set = new CardSet([
  card({ id: 'douglass', edition: 'm', pair: 'freedom', body: 'See [[jacobs]].', books: ['voices'] }),
  card({ id: 'jacobs', edition: 'f', pair: 'freedom', books: ['voices'] }),
  card({ id: 'zong', kind: 'event', books: ['archives', 'voices'], body: 'Told by [[equiano|Olaudah Equiano]] and [[douglass]].', places: [{ name: 'Mississippi Delta', lat: 34, lon: -90 }] }),
  card({ id: 'equiano', body: 'The [[zong]] case.' }),
  card({ id: 'delta', kind: 'place', places: [{ name: 'The Delta', lat: 33.5, lon: -90.5 }] }),
]);

describe('links', () => {
  it('splits text into runs and links like pkg/card', () => {
    expect(segments('Told by [[equiano|Olaudah Equiano]] and [[zong]].')).toEqual([
      { text: 'Told by ' },
      { target: 'equiano', text: 'Olaudah Equiano', explicit: true },
      { text: ' and ' },
      { target: 'zong', text: 'zong', explicit: false },
      { text: '.' },
    ]);
    expect(links('[[a]] [[b-2|B]] [[Not-valid]]')).toEqual(['a', 'b-2']);
    expect(plain('By [[equiano|Equiano]] on the [[zong]]')).toBe('By Equiano on the zong');
  });

  it('marks links with the book symbols of their target', () => {
    expect(bookSymbols(set.get('zong')!.books)).toBe('▤❝');
  });

  it('computes backlinks when the export has none', () => {
    expect(set.backlinks('zong')).toEqual(['equiano']);
    expect(set.backlinks('douglass')).toEqual(['zong']);
  });
});

describe('editions', () => {
  it('finds the other copy', () => {
    expect(set.partner('jacobs')!.id).toBe('douglass');
    expect(set.partner('zong')).toBeUndefined();
  });

  it('defaults a missing edition to both', () => {
    expect(new CardSet([{ ...card({ id: 'x' }), edition: undefined }]).get('x')!.edition).toBe('both');
  });
});

describe('places and time', () => {
  it('resolves a place key by card id, slug, or a word of the slug', () => {
    expect(set.resolvePlace('delta')!.name).toBe('The Delta');
    expect(set.resolvePlace('mississippi-delta')!.name).toBe('Mississippi Delta');
    expect(set.resolvePlace('vienna')!.name).toBe('Vienna');
    expect(set.resolvePlace('atlantis')).toBeUndefined();
  });

  it('filters by overlapping years', () => {
    const c = { years: [1900, 1935] };
    expect(overlaps(c, 1930, 1940)).toBe(true);
    expect(overlaps(c, 1936, 1950)).toBe(false);
    expect(overlaps({ years: [1781] }, 1781)).toBe(true);
    expect(overlaps(c)).toBe(true);
  });

  it('formats years', () => {
    expect(formatYears([1778, 1860])).toBe('1778–1860');
    expect(formatYears([1781])).toBe('1781');
    expect(formatYears([1781, 1781])).toBe('1781');
  });
});

describe('card bodies by copy', () => {
  const card = JSON.parse(readFileSync(new URL('./fixtures/marked/card.json', import.meta.url), 'utf8')) as Card;

  it('keeps the marked paragraphs of the reader’s copy only, marker stripped', () => {
    const m = cardForEdition(card, 'm').body.split('\n\n');
    const f = cardForEdition(card, 'f').body.split('\n\n');
    expect(m).toHaveLength(3);
    expect(f).toHaveLength(3);
    expect(m[1]).toBe('Only the male copy reads this\nwrapped line.');
    expect(f[1]).toBe('Only the female copy reads this.');
    expect(m[0]).toBe(f[0]);
    expect(m.join(' ')).not.toMatch(/\{(male|female)\}/);
  });

  it('works on the translation too and never touches the hook or title', () => {
    const ru = cardForEdition(localizeCard(card, 'ru'), 'f');
    expect(ru.body).toBe('Общий первый абзац.\n\nТолько женский экземпляр.\n\nОбщий последний абзац.');
    expect(cardForEdition(card, 'f').wow).toBe(card.wow);
  });

  it('returns an unmarked card unchanged', () => {
    const plainCard = { ...card, body: 'One.\n\nTwo.' };
    expect(cardForEdition(plainCard, 'm')).toBe(plainCard);
  });
});

describe('the moment a card is about', () => {
  const smalls = card({ id: 'robert-smalls', years: [1839, 1915], places: [{ name: 'Beaufort', lat: 32.4, lon: -80.7 }, { name: 'Charleston', lat: 32.8, lon: -79.9 }], moment: { year: 1862, place: 1 } });

  it('reads the moment, falling back to the first year and place', () => {
    expect(when(smalls)).toEqual({ year: 1862, place: smalls.places[1] });
    expect(when({ ...smalls, moment: { year: 1862 } }).place.name).toBe('Beaufort');
    expect(when({ ...smalls, moment: undefined })).toEqual({ year: 1839, place: smalls.places[0] });
  });

  it('places the atlas pin at the moment, in place and in time', () => {
    const set = new CardSet([smalls]);
    const at1862 = atlasLayers(set, { level: 4, from: 1860, to: 1865 });
    expect(at1862.points[0]).toMatchObject({ lon: -79.9, lat: 32.8, out: false });
    const at1900 = atlasLayers(set, { level: 4, from: 1900, to: 1910 });
    expect(at1900.points[0].out).toBe(true);
  });

  it('anchors the descent at the moment', () => {
    expect(quietStretches([smalls], 45)[0]).toEqual({ from: 1300, to: 1862 });
  });
});
