import { beforeEach, describe, expect, it } from 'vitest';
import { atlasFactoids, cardFactoids, pickFactoid, quietFactoids, usableFactoids, type Factoid } from '../src/lib/factoids';
import { readFactsSeen, recordFactSeen } from '../src/lib/reader';
import type { Card } from '../src/lib/types';
import { readFileSync, existsSync } from 'node:fs';

const src = [
  { title: 'One', url: 'https://one.example' },
  { title: 'Two', url: 'https://two.example' },
];
const fx = (id: string, year: number, cards: string[] = [], place?: Factoid['place']): Factoid => ({ id, cat: 'art', en: `Fact ${id}.`, ru: `Факт ${id}.`, year, cards, sources: src, place });

describe('usableFactoids', () => {
  it('keeps whole facts and drops anything that cannot be shown whole', () => {
    const ok = fx('fx-ok', 1900);
    const got = usableFactoids({
      version: 1,
      factoids: [
        ok,
        { ...ok }, // duplicate id
        { ...fx('fx-noru', 1900), ru: '' },
        { ...fx('fx-long', 1900), en: Array(31).fill('word').join(' ') },
        { ...fx('fx-noyear', 0) },
        { ...fx('fx-onesrc', 1900), sources: src.slice(0, 1) },
        { ...fx('fx-nolink', 1900), sources: [src[0], { title: 'Two', url: '' }] },
        { ...fx('fx-noplace', 1900), place: { name: 'X', lat: NaN, lon: 3 } },
        fx('fx-placed', 1901, [], { name: 'Lagos', lat: 6.45, lon: 3.39 }),
      ],
    });
    expect(got.map((f) => f.id)).toEqual(['fx-ok', 'fx-placed']);
    expect(usableFactoids(null)).toEqual([]);
  });

  it('accepts every factoid the build exported', () => {
    const file = 'public/data/factoids.json';
    if (!existsSync(file)) return;
    const data = JSON.parse(readFileSync(file, 'utf8'));
    expect(data.factoids.length).toBeGreaterThan(0);
    expect(usableFactoids(data).length).toBe(data.factoids.length);
  });
});

describe('cardFactoids (the card footer)', () => {
  const list = [fx('a', 1950, ['other', 'zong']), fx('b', 1900, ['zong']), fx('c', 1800, ['zong', 'other']), fx('d', 1700, ['zong']), fx('e', 1600, ['nope'])];
  it('takes at most three of the card, its own first, then by year', () => {
    expect(cardFactoids(list, 'zong').map((f) => f.id)).toEqual(['d', 'b', 'c']);
    expect(cardFactoids(list, 'zong', 5).map((f) => f.id)).toEqual(['d', 'b', 'c', 'a']);
  });
  it('is empty for a card without factoids', () => {
    expect(cardFactoids(list, 'equiano')).toEqual([]);
  });
});

describe('quietFactoids (the descent)', () => {
  it('gives each stretch one fact dated strictly inside it, nearest the middle, never twice', () => {
    const list = [fx('edge', 1300), fx('early', 1310), fx('mid', 1352), fx('mid2', 1349), fx('late', 1650)];
    const got = quietFactoids(list, [
      { from: 1300, to: 1400 },
      { from: 1300, to: 1400 },
      { from: 1500, to: 1600 },
    ]);
    expect(got.map((f) => f?.id)).toEqual(['mid2', 'mid', undefined]);
  });
});

describe('atlasFactoids', () => {
  const list = [fx('placed', 1900, [], { name: 'Lagos', lat: 6, lon: 3 }), fx('nowhere', 1900), fx('later', 1960, [], { name: 'Accra', lat: 5, lon: 0 })];
  it('shows placed facts at zoom 3 and 4 only', () => {
    expect(atlasFactoids(list, { level: 2 })).toEqual([]);
    expect(atlasFactoids(list, { level: 5 })).toEqual([]);
    expect(atlasFactoids(list, { level: 3 }).map((f) => f.id)).toEqual(['placed', 'later']);
    expect(atlasFactoids(list, { level: 4 }).length).toBe(2);
  });
  it('follows the time filter', () => {
    expect(atlasFactoids(list, { level: 3, from: 1950, to: 1970 }).map((f) => f.id)).toEqual(['later']);
    expect(atlasFactoids(list, { level: 3, from: 1900 }).map((f) => f.id)).toEqual(['placed']);
  });
});

describe('pickFactoid (the random-fact button)', () => {
  const list = [fx('f1', 1900, ['c']), fx('f2', 1900, ['a']), fx('f3', 1900), fx('f4', 1900, ['b'])];
  const last = { id: 'a', body: 'See [[b]].' } as Card;
  it('prefers unseen facts of the last card and the cards it links to, then other unseen, then repeats', () => {
    const st = { seen: new Set(['f1']), prev: new Set<string>(), last, random: () => 0 };
    const first = [pickFactoid(list, st)!.id, pickFactoid(list, st)!.id];
    expect(first.sort()).toEqual(['f2', 'f4']);
    expect(pickFactoid(list, st)!.id).toBe('f3');
    expect(pickFactoid(list, st)!.id).toBe('f1');
    // All shown in this sitting: it starts over rather than running dry.
    expect(pickFactoid(list, st)).toBeDefined();
    expect(pickFactoid([], st)).toBeUndefined();
  });
  it('never repeats within a sitting until the pool runs out', () => {
    const st = { seen: new Set<string>(), prev: new Set<string>() };
    const ids = list.map(() => pickFactoid(list, st)!.id);
    expect(new Set(ids).size).toBe(list.length);
  });
});

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

describe('seen factoids in reader state', () => {
  beforeEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = new MemStorage();
  });
  it('remembers shown facts', () => {
    recordFactSeen('fx-1');
    recordFactSeen('fx-2');
    recordFactSeen('fx-1');
    expect([...readFactsSeen()]).toEqual(['fx-2', 'fx-1']);
  });
  it('keeps working when storage is closed', () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('denied');
      },
    };
    expect(() => recordFactSeen('fx-1')).not.toThrow();
    expect(readFactsSeen().size).toBe(0);
  });
});
