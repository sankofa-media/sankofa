import { describe, expect, it } from 'vitest';
import { localized } from '../scripts/runtime-data';
import { hydrateLanguage } from '../src/lib/dataUrl';
import { localizeCard } from '../src/lib/cards';
import { usableFactoids } from '../src/lib/factoids';
import { readFileSync } from 'node:fs';

const cards = JSON.parse(readFileSync('public/data/cards.json', 'utf8')).cards;
const facts = JSON.parse(readFileSync('public/data/factoids.json', 'utf8'));

describe('single-language runtime data', () => {
  for (const language of ['en', 'ru'] as const) {
    it(`keeps every checked fact usable in ${language}`, () => {
      const result = hydrateLanguage(localized(facts, language));
      expect(usableFactoids(result).map(f => f.id)).toEqual(usableFactoids(facts).map(f => f.id));
      for (let i = 0; i < facts.factoids.length; i++) expect(result.factoids[i][language]).toBe(facts.factoids[i][language]);
    });
    it(`localizes each card once, preserving place fragment keys in ${language}`, () => {
      for (const original of cards) {
        const { translations: _translations, ...card } = localizeCard(original, language);
        const shipped = { ...card, localized: true };
        expect(localizeCard(shipped, language)).toEqual(shipped);
        expect(shipped.body).toBe(localizeCard(original, language).body);
        expect(shipped.places.map(p => p.en ?? p.name)).toEqual(original.places.map((p: { name: string }) => p.name));
      }
    });
  }
  it('does not discard an English-only fallback', () => {
    expect(localized({ title: { en: 'Fallback' } }, 'ru')).toEqual({ title: { en: 'Fallback' } });
  });
});
