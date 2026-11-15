// Present-day countries for the atlas's "Countries" mode. The build assigns
// every card place to a country (lib/countryAssign.ts, run by
// scripts/build-countries.ts); the museum reads the result per copy.
import type { Card, Edition, Place } from './types';
import type { CardSet } from './cards';
import { span } from './cards';
import { readerCards } from './atlasModel';

export interface Bilingual {
  en: string;
  ru: string;
}

export interface CountryCard {
  id: string;
  /** Indexes into the card's places that lie in this country. */
  places: number[];
  /** True when the card's main place (places[0]) lies here. */
  main: boolean;
}

export interface Country {
  /** The key in links: country=<id>. */
  id: string;
  /** Natural Earth / world-atlas feature id (ISO 3166-1 numeric). */
  iso: string;
  name: Bilingual;
  /** The short header; absent when it could not be sourced. */
  about?: Bilingual;
  /** A territory whose status is disputed, listed under no state. */
  disputed?: boolean;
  cards: CountryCard[];
}

export interface CountriesFile {
  countries: Country[];
}

/** A card's year for the country list: the start of its span. */
const start = (c: Card) => span(c)[0];

export interface CountryEntry {
  card: Card;
  /** The card's places in this country, in the reader's language. */
  places: Place[];
  main: boolean;
}

/**
 * One country's cards in the reader's copy, in time order (by the start of
 * each card's years, then by title).
 */
export function countryCopy(set: CardSet, edition: Exclude<Edition, 'both'> | '', country: Country): CountryEntry[] {
  const mine = new Set(readerCards(set, edition).map((c) => c.id));
  return country.cards
    .filter((cc) => mine.has(cc.id))
    .map((cc) => {
      const card = set.get(cc.id)!;
      return { card, places: cc.places.map((i) => card.places[i]).filter(Boolean), main: cc.main };
    })
    .sort((a, b) => start(a.card) - start(b.card) || a.card.title.localeCompare(b.card.title));
}

export interface CountryCount {
  country: Country;
  n: number;
}

/** The countries with cards in the reader's copy, by name in the reader's language. */
export function countriesInCopy(set: CardSet, edition: Exclude<Edition, 'both'> | '', file: CountriesFile, lang: 'en' | 'ru'): CountryCount[] {
  const mine = new Set(readerCards(set, edition).map((c) => c.id));
  return file.countries
    .map((country) => ({ country, n: country.cards.filter((cc) => mine.has(cc.id)).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => a.country.name[lang].localeCompare(b.country.name[lang], lang));
}

/**
 * Where each of a country's cards stands on the map: at its first place in
 * that country, cards sharing a spot spread on a small spiral (tighter as the
 * map zooms in) so each stays clickable.
 */
export function countryPoints(rows: CountryEntry[], level: number): { card: Card; lon: number; lat: number }[] {
  const step = 2.2 / [1, 2.2, 4.6, 9, 18][Math.max(1, Math.min(5, level)) - 1];
  const seen = new Map<string, number>();
  return rows
    .filter((r) => r.places.length)
    .map((r) => {
      const p = r.places[0];
      const key = `${p.lon.toFixed(1)},${p.lat.toFixed(1)}`;
      const i = seen.get(key) ?? 0;
      seen.set(key, i + 1);
      if (!i) return { card: r.card, lon: p.lon, lat: p.lat };
      const a = i * 2.4;
      const d = step * Math.sqrt(i);
      return { card: r.card, lon: p.lon + Math.cos(a) * d, lat: p.lat + Math.sin(a) * d * 0.8 };
    });
}
