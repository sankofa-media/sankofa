import { describe, expect, it } from 'vitest';
import { compareTitles, filterEntries, fold, indexEntries, letterOf, letters } from '../src/lib/nameIndex';
import type { Card } from '../src/lib/types';

const card = (id: string, title: string, extra: Partial<Card> = {}): Card => ({ id, kind: 'person', title, wow: '', years: [1900], places: [], zoom: 4, books: ['heirs'], sources: [], body: '', edition: 'both', ...extra });
const order = (titles: string[], l: 'en' | 'ru') => [...titles].sort((a, b) => compareTitles(a, b, l));

describe('name index', () => {
  it('sorts English titles ignoring a leading The, quotes and accents', () => {
    expect(order(['The Zong massacre', 'Afrobeat', '"Respect" (Aretha Franklin, 1967)', 'The blues', 'Ébène', 'Equiano'], 'en')).toEqual([
      'Afrobeat',
      'The blues',
      'Ébène',
      'Equiano',
      '"Respect" (Aretha Franklin, 1967)',
      'The Zong massacre',
    ]);
    expect(letterOf('The Zong massacre', 'en')).toBe('Z');
    expect(letterOf('Ébène', 'en')).toBe('E');
    expect(letterOf('1960, the Year of Africa', 'en')).toBe('#');
  });

  it('sorts Russian titles in Russian order, Ё with Е, Cyrillic before Latin, digits last', () => {
    expect(order(['Ёлка', 'Ежи', 'Жанна', 'Ель', '«Respect» (Арета Франклин)', 'Абебе', '1960-й, год Африки', 'Йоруба', 'Ифа'], 'ru')).toEqual([
      'Абебе',
      'Ежи',
      'Ёлка',
      'Ель',
      'Жанна',
      'Ифа',
      'Йоруба',
      '«Respect» (Арета Франклин)',
      '1960-й, год Африки',
    ]);
    expect(letterOf('Ёлка', 'ru')).toBe('Е');
    expect(letterOf('Йоруба', 'ru')).toBe('Й');
    expect(fold('Ёлка «Йоруба»')).toBe('елка йоруба');
  });

  it('marks cards of the other copy, filters by either title and by kind', () => {
    const cards = [card('sun-ra', 'Сан Ра'), card('douglass-covey', 'Фредерик Дуглас против Эдварда Кови', { edition: 'm', kind: 'event' }), card('jazz', 'Джаз', { kind: 'genre' })];
    const raw = (id: string) => ({ 'sun-ra': card('sun-ra', 'Sun Ra'), 'douglass-covey': card('douglass-covey', 'Frederick Douglass fights Edward Covey'), jazz: card('jazz', 'Jazz') })[id];
    const es = indexEntries(cards, 'ru', 'f', raw);
    expect(es.map((e) => e.id)).toEqual(['jazz', 'sun-ra', 'douglass-covey']);
    expect(es.find((e) => e.id === 'douglass-covey')?.foreign).toBe(true);
    expect(letters(es)).toEqual(['Д', 'С', 'Ф']);
    expect(filterEntries(es, 'sun', new Set()).map((e) => e.id)).toEqual(['sun-ra']);
    expect(filterEntries(es, 'дуглас', new Set()).map((e) => e.id)).toEqual(['douglass-covey']);
    expect(filterEntries(es, '', new Set(['genre'])).map((e) => e.id)).toEqual(['jazz']);
  });
});
