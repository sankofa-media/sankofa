import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import YAML from 'yaml';
import { buildNames, compileLexicon, deriveNames, linkSegments, unlinked, type NameSource } from '../src/lib/names';
import { CardSet } from '../src/lib/cards';
import type { Card } from '../src/lib/types';

const src = (id: string, kind: string, title: string, ru?: string, extra: Partial<NameSource> = {}): NameSource => ({ id, kind, title, translations: ru ? { ru: { title: ru } } : undefined, ...extra });

const cards: NameSource[] = [
  src('sun-ra', 'person', 'Sun Ra', 'Сан Ра'),
  src('mansa-musa', 'person', 'Mansa Musa', 'Манса Муса'),
  src('douglass-covey', 'event', 'Frederick Douglass fights Edward Covey', 'Фредерик Дуглас против Эдварда Кови'),
  src('jacobs-garret', 'event', 'Harriet Jacobs in the garret', 'Гарриет Джейкобс на чердаке'),
  src('blues', 'genre', 'The blues', 'Блюз', { inline: 'the blues', translations: { ru: { title: 'Блюз', inline: 'блюз' } } }),
  src('respect', 'work', '"Respect" (Aretha Franklin, 1967)', '«Respect» (Арета Франклин, 1967)'),
  src('crazy-blues', 'work', 'Crazy Blues (Mamie Smith, 1920)', 'Crazy Blues (Мейми Смит, 1920)'),
  src('timbuktu-manuscripts', 'object', 'The Timbuktu manuscripts', 'Рукописи Тимбукту'),
  src('black-orpheus', 'work', 'Black Orpheus (Orfeu Negro)', '«Чёрный Орфей» (Orfeu Negro)'),
  src('black-orpheus-journal', 'media', 'Black Orpheus (journal)', '«Чёрный Орфей» (журнал)'),
  src('lagos-1444', 'event', 'Lagos, 8 August 1444', 'Лагуш, 8 августа 1444 года'),
];
const aliases = {
  aliases: {
    'douglass-covey': { en: ['Frederick Douglass', 'Douglass'], ru: ['Фредерик Дуглас'] },
    'jacobs-garret': { en: ['Harriet Jacobs'], ru: ['Гарриет Джейкобс'] },
    'timbuktu-manuscripts': { en: ['Timbuktu'], ru: ['Тимбукту'] },
  },
  never: { en: ['Lagos'] },
};
const { file, ambiguous } = buildNames(cards, aliases);
const en = compileLexicon(file.en, 'en');
const ru = compileLexicon(file.ru, 'ru');
const linked = (segs: ReturnType<typeof linkSegments>) => segs.flatMap((s) => ('target' in s ? [`${s.target}:${s.text}`] : []));

describe('names', () => {
  it('derive from titles: parenthesis, article and subtitle come off', () => {
    expect(deriveNames('work', 'Crazy Blues (Mamie Smith, 1920)', undefined, 'en')).toContain('Crazy Blues');
    expect(deriveNames('object', 'The Timbuktu manuscripts', undefined, 'en')).toContain('Timbuktu manuscripts');
    expect(deriveNames('script', 'Ajami: African languages in Arabic letters', undefined, 'en')).toContain('Ajami');
    expect(deriveNames('person', 'Taharqa, the Kushite pharaoh', undefined, 'en')).toContain('Taharqa');
    expect(deriveNames('work', 'Kara Walker, A Subtlety (2014)', undefined, 'en')).toContain('A Subtlety');
    // A genre reads in either case; a person does not.
    expect(deriveNames('genre', 'Jazz', undefined, 'en')).toEqual(['Jazz', 'jazz']);
    // A one-word title of a work is too often an ordinary word.
    expect(deriveNames('work', '"Respect" (Aretha Franklin, 1967)', undefined, 'en')).toEqual([]);
    expect(deriveNames('event', 'Ghana’s independence', undefined, 'en')).toContain('Ghana’s independence');
  });

  it('drop names two cards share and names `never` forbids', () => {
    expect(ambiguous.map((a) => `${a.lang}:${a.name}`)).toEqual(expect.arrayContaining(['en:black orpheus', 'ru:чёрный орфей']));
    expect(file.en['black-orpheus'] ?? []).not.toContain('Black Orpheus');
    expect(file.en['lagos-1444'] ?? []).not.toContain('Lagos');
    expect(file.ru['lagos-1444']).toContain('Лагуш');
  });

  it('link the first mention of a card in a block, and only that one', () => {
    const segs = linkSegments('Sun Ra played in Chicago. Later Sun Ra left for the stars, and Sun Ra never came back.', en);
    expect(linked(segs)).toEqual(['sun-ra:Sun Ra']);
    expect(segs.map((s) => s.text).join('')).toBe('Sun Ra played in Chicago. Later Sun Ra left for the stars, and Sun Ra never came back.');
    // A shared `seen` carries the rule across the pieces of one block.
    const seen = new Set<string>();
    expect(linked(linkSegments('From Sun Ra', en, { seen }))).toHaveLength(1);
    expect(linked(linkSegments('to Sun Ra', en, { seen }))).toHaveLength(0);
  });

  it('take the longest name at a place and respect word boundaries', () => {
    expect(linked(linkSegments('the Timbuktu manuscripts survived', en))).toEqual(['timbuktu-manuscripts:Timbuktu manuscripts']);
    expect(linked(linkSegments('Sun Rays and Sun Ra’s band', en))).toEqual(['sun-ra:Sun Ra']);
    expect(linked(linkSegments('Crazy Blues sold', en))).toEqual(['crazy-blues:Crazy Blues']);
  });

  it('read a common noun in either case, a proper name only as written', () => {
    expect(linked(linkSegments('Blues came first; then the blues again.', en))).toEqual(['blues:Blues']);
    expect(linked(linkSegments('sun ra in lower case', en))).toEqual([]);
  });

  it('never link a card linked by hand in the block, nor an excluded card', () => {
    expect(linked(linkSegments('Sun Ra, and later [[sun-ra|the man from Saturn]].', en))).toEqual(['sun-ra:the man from Saturn']);
    expect(linked(linkSegments('Sun Ra and Mansa Musa', en, { exclude: new Set(['sun-ra']) }))).toEqual(['mansa-musa:Mansa Musa']);
    expect(unlinked('Sun Ra and [[mansa-musa|the king]]', en)).toEqual([{ id: 'sun-ra', text: 'Sun Ra' }]);
  });

  it('match Russian case forms and ё written as е', () => {
    expect(linked(linkSegments('Звездолёты Сана Ра', ru))).toEqual(['sun-ra:Сана Ра']);
    expect(linked(linkSegments('о Сане Ра и Мансе Мусе', ru))).toEqual(['sun-ra:Сане Ра', 'mansa-musa:Мансе Мусе']);
    expect(linked(linkSegments('история Фредерика Дугласа', ru))).toEqual(['douglass-covey:Фредерика Дугласа']);
    expect(linked(linkSegments('корни блюза и Блюз', ru))).toEqual(['blues:блюза']);
    expect(linked(linkSegments('библиотеки Тимбукту', ru))).toEqual(['timbuktu-manuscripts:Тимбукту']);
    expect(linked(linkSegments('Санкт-Петербург', ru))).toEqual([]);
  });

  it('the content aliases are names, and every one belongs to a card', () => {
    const a = YAML.parse(readFileSync(new URL('../../content/aliases.yaml', import.meta.url), 'utf8'));
    for (const id of Object.keys(a.aliases)) expect(existsSync(new URL(`../../content/cards/${id}.md`, import.meta.url)), id).toBe(true);
    for (const v of Object.values(a.aliases as Record<string, { en?: unknown[]; ru?: unknown[] }>)) for (const n of [...(v.en ?? []), ...(v.ru ?? [])]) expect(typeof n).toBe('string');
  });
});

describe('links and the two copies', () => {
  const card = (c: Partial<Card> & { id: string }): Card => ({ kind: 'person', title: c.id, wow: '', years: [1800], places: [], zoom: 4, books: ['voices'], sources: [], body: '', edition: 'both', ...c });
  const set = new CardSet([card({ id: 'douglass-covey', edition: 'm', pair: 'p' }), card({ id: 'jacobs-garret', edition: 'f', pair: 'p' }), card({ id: 'sun-ra' })]);
  it('a link names its card in either copy; the pair only points to the other telling', () => {
    expect(set.get('douglass-covey')?.id).toBe('douglass-covey');
    expect(set.get('jacobs-garret')?.id).toBe('jacobs-garret');
    expect(set.partner('douglass-covey')?.id).toBe('jacobs-garret');
    expect(set.partner('jacobs-garret')?.id).toBe('douglass-covey');
    expect(set.partner('sun-ra')).toBeUndefined();
  });
});
