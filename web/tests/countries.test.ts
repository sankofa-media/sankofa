import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import { assignCard, countryAt, isoOf, type CountryFeature } from '../src/lib/countryAssign';
type CountriesFile = { countries: { id: string; name: { en: string; ru: string }; about?: { en: string; ru: string }; cards: { id: string; places: number[]; main: boolean }[] }[] };

const require = createRequire(import.meta.url);
const topo = JSON.parse(readFileSync(require.resolve('world-atlas/countries-50m.json'), 'utf8')) as Topology;
const features = (feature(topo, topo.objects.countries as never) as unknown as { features: CountryFeature[] }).features;
const at = (lon: number, lat: number) => {
  const f = countryAt(features, lon, lat);
  return f ? isoOf(f) : null;
};

describe('country of a place', () => {
  it('finds the country a place lies in', () => {
    expect(at(-8.0029, 12.6392)).toBe('466'); // Bamako, Mali
    expect(at(-3.0074, 16.7666)).toBe('466'); // Timbuktu, Mali
    expect(at(15.3136, -4.3317)).toBe('180'); // Kinshasa, DR Congo
    expect(at(-0.1276, 51.5072)).toBe('826'); // London
  });

  it('counts harbours and islands the coarse coastline misses', () => {
    expect(at(-38.5014, -12.9714)).toBe('076'); // Salvador, Bahia
    expect(at(-76.7931, 17.9714)).toBe('388'); // Kingston, Jamaica
    expect(at(-74.006, 40.7128)).toBe('840'); // New York City
    expect(at(55.492, -4.6796)).toBe('690'); // Mahé, Seychelles
  });

  it('keeps a segment whole across the far meridian (Cartagena is not Vietnam)', () => {
    expect(at(-75.5478, 10.4236)).toBe('170');
  });

  it('gives no country to the open sea and the poles', () => {
    expect(at(-30, 10)).toBeNull(); // "Atlantic Ocean"
    expect(at(-78.5, 17.5)).toBeNull(); // off Jamaica, where the Zong sailed
    expect(at(0, 89.9)).toBeNull();
    expect(at(0, -89.9)).toBeNull(); // Antarctica is not a country
  });

  it('counts a card for every country its places lie in, and lets a pin decide first', () => {
    const places = [
      { name: 'Schio', lat: 45.7139, lon: 11.3561 },
      { name: 'Darfur', lat: 13.5, lon: 24.0 },
      { name: 'Venice', lat: 45.4408, lon: 12.3155 },
    ];
    expect([...assignCard(features, places)]).toEqual([
      ['380', [0, 2]],
      ['729', [1]],
    ]);
    const pinned = assignCard(features, places, (i) => (i === 1 ? null : undefined));
    expect([...pinned.keys()]).toEqual(['380']);
  });
});

describe('the built countries file', () => {
  const file = JSON.parse(readFileSync(new URL('../public/data/countries.json', import.meta.url), 'utf8')) as CountriesFile;
  const of = (id: string) => file.countries.filter((c) => c.cards.some((x) => x.id === id)).map((c) => c.id).sort();

  it('places known cards in their countries', () => {
    expect(of('candomble')).toEqual(['brazil']);
    expect(of('josephine-bakhita')).toEqual(['italy', 'sudan']);
    expect(of('mansa-musa')).toContain('mali');
  });

  it('follows content/countries.yaml where the outlines are wrong', () => {
    // Disputed territories stand under no state; border towns stand on their own side.
    expect(of('mary-seacole')).toEqual(['crimea', 'jamaica', 'united-kingdom']);
    expect(of('african-quarter-jerusalem')).toEqual(['jerusalem']);
    expect(of('mapungubwe-rhino')).toEqual(['south-africa']);
    expect(of('parsley-massacre')).toEqual(['dominican-republic', 'haiti']);
    expect(of('gannibal')).toContain('cameroon');
  });

  it('names every country in English and Russian, and marks the main place', () => {
    for (const c of file.countries) {
      expect(c.name.en && c.name.ru, c.id).toBeTruthy();
      if (c.about) expect(c.about.en && c.about.ru, c.id).toBeTruthy();
    }
    const brazil = file.countries.find((c) => c.id === 'brazil')!;
    expect(brazil.cards.find((x) => x.id === 'candomble')).toMatchObject({ main: true, places: [0] });
  });
});

describe('countries in the reader’s copy', async () => {
  const { CardSet } = await import('../src/lib/cards');
  const { countriesInCopy, countryCopy } = await import('../src/lib/countries');
  const card = (id: string, years: number[], extra: object = {}) =>
    ({ id, kind: 'event', title: id, wow: '', years, places: [{ name: `${id}-a`, lat: 0, lon: 0 }, { name: `${id}-b`, lat: 1, lon: 1 }], zoom: 3, books: [], body: '', sources: [], ...extra }) as never;
  const set = new CardSet([
    card('late', [1950]),
    card('early', [1600, 1700]),
    card('song-m', [1800], { edition: 'm', pair: 'song' }),
    card('song-f', [1800], { edition: 'f', pair: 'song' }),
  ]);
  const file = {
    countries: [
      { id: 'zeta', iso: '1', name: { en: 'Zeta', ru: 'Альфа' }, cards: [{ id: 'late', places: [1], main: false }, { id: 'early', places: [0], main: true }, { id: 'song-m', places: [0], main: true }] },
      { id: 'alpha', iso: '2', name: { en: 'Alpha', ru: 'Яблоко' }, cards: [{ id: 'song-f', places: [0], main: true }] },
    ],
  };

  it('lists a country’s cards in time order, with its own places', () => {
    const rows = countryCopy(set, 'm', file.countries[0]);
    expect(rows.map((r) => r.card.id)).toEqual(['early', 'song-m', 'late']);
    expect(rows[2].places.map((p) => p.name)).toEqual(['late-b']);
    expect(rows[2].main).toBe(false);
  });

  it('counts only the reader’s copy, and sorts by the reader’s language', () => {
    expect(countriesInCopy(set, 'm', file, 'en').map((x) => [x.country.id, x.n])).toEqual([['zeta', 3]]);
    expect(countriesInCopy(set, 'f', file, 'en').map((x) => [x.country.id, x.n])).toEqual([['alpha', 1], ['zeta', 2]]);
    expect(countriesInCopy(set, 'f', file, 'ru').map((x) => x.country.id)).toEqual(['zeta', 'alpha']);
  });
});

describe('country headers are sourced', async () => {
  const YAML = (await import('yaml')).default;
  const read = (p: string) => YAML.parse(readFileSync(new URL(`../../content/${p}`, import.meta.url), 'utf8'));
  const countries = read('countries.yaml').countries as { id: string; about?: { en: string; ru: string } }[];
  const ledger = read('ledger/countries.yaml').entries as { country: string; fact: string; sources: { url: string; quote: string }[] }[];

  it('every header has ledger facts, each with two sources from different sites and a quote', () => {
    const ids = new Set(countries.map((c) => c.id));
    for (const c of countries.filter((x) => x.about)) expect(ledger.some((e) => e.country === c.id), c.id).toBe(true);
    for (const e of ledger) {
      expect(ids.has(e.country), e.country).toBe(true);
      expect(e.sources.length, e.fact).toBeGreaterThanOrEqual(2);
      expect(new Set(e.sources.map((s) => new URL(s.url).hostname.replace(/^www\./, ''))).size, e.fact).toBeGreaterThanOrEqual(2);
      for (const s of e.sources) expect(s.quote?.length, e.fact).toBeGreaterThan(10);
      expect(e.sources.some((s) => /wikipedia\.org/.test(s.url)), e.fact).toBe(false);
    }
  });
});
