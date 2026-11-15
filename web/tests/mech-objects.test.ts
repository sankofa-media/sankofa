import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { describe, expect, it } from 'vitest';
import { parseListen } from '../src/lib/listen';
import { answerTiming, clearPattern, flipClave, formatTime, GROOVE, hits, parsePattern, parseSteps, patternLength, radiusAtTime, stepSeconds, timeAtRadius, toggle, validateLabel } from '../src/mechanics/objects/model';
import { existsSync } from 'node:fs';

describe('working objects: patterns', () => {
  it('reads steps, ignoring bar separators', () => {
    expect(parseSteps('x...|.x..')).toEqual([true, false, false, false, false, true, false, false]);
  });
  it('refuses voices of different lengths and broken bars', () => {
    expect(() => parsePattern({ a: 'x'.repeat(16), b: 'x'.repeat(32) })).toThrow(/differ/);
    expect(() => parsePattern({ a: 'x'.repeat(12) })).toThrow(/whole bars/);
  });
  it('toggles and clears without touching the original', () => {
    const p = parsePattern({ bd: 'x'.padEnd(16, '.') });
    const q = toggle(p, 'bd', 1);
    expect(p.bd[1]).toBe(false);
    expect(q.bd.slice(0, 2)).toEqual([true, true]);
    expect(clearPattern(q).bd.every((x) => !x)).toBe(true);
  });
  it('lists the voices on a step and times sixteenths', () => {
    const p = parsePattern({ bd: 'x'.padEnd(16, '.'), sd: '....x'.padEnd(16, '.') });
    expect(hits(p, 0)).toEqual(['bd']);
    expect(hits(p, 20)).toEqual(['sd']);
    expect(stepSeconds(120)).toBeCloseTo(0.125);
  });
});

describe('working objects: the museum’s presets', () => {
  const o = YAML.parse(readFileSync(join(__dirname, '../../content/objects.yaml'), 'utf8'));
  it('the drum machine is one bar, the Amen break four', () => {
    expect(patternLength(parsePattern(o.tr808.pattern))).toBe(16);
    expect(patternLength(parsePattern(o.amen.pattern))).toBe(64);
  });
  it('the Amen break has no recording; the official one comes from the listening list', () => {
    expect(JSON.stringify(o.amen)).not.toMatch(/\.(ogg|mp3|wav|flac)/);
    const listen = parseListen(readFileSync(join(__dirname, '../../content/listen.yaml'), 'utf8'));
    const rec = listen.cards[o.amen.card]?.[0];
    expect(rec?.source).toBe('youtube');
    // A copy kept in objects.yaml is ignored by the build, but must not disagree.
    if (o.amen.youtube) expect(o.amen.youtube.id).toBe(rec?.youtube);
  });
  it('the gramophone plays the card’s own recording', () => {
    const card = readFileSync(join(__dirname, `../../content/cards/${o.gramophone.card}.md`), 'utf8');
    expect(card).toContain(`"${o.gramophone.audio}"`);
    expect(card).toMatch(/license: "Public domain"/);
  });
});

describe('working objects: the needle', () => {
  it('maps the outer groove to the start and the inner to the end', () => {
    expect(timeAtRadius(GROOVE.outer, 200)).toBe(0);
    expect(timeAtRadius(GROOVE.inner, 200)).toBe(200);
    expect(timeAtRadius(1, 200)).toBe(0);
    for (const t of [0, 37, 120, 199]) expect(timeAtRadius(radiusAtTime(t, 200), 200)).toBeCloseTo(t);
  });
  it('formats time', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(211.9)).toBe('3:31');
  });
});

describe('the Workshop: every object is an element, with its story', () => {
  const content = join(__dirname, '../../content');
  const o = YAML.parse(readFileSync(join(content, 'objects.yaml'), 'utf8'));
  const elements = new Set((YAML.parse(readFileSync(join(content, 'roots/elements.yaml'), 'utf8')).elements as { id: string }[]).map((e) => e.id));
  const cards = { has: (id: string) => existsSync(join(content, 'cards', `${id}.md`)) } as Set<string>;
  it('has an intro in both languages', () => {
    expect(o.intro.en.length).toBeGreaterThan(200);
    expect(o.intro.ru.length).toBeGreaterThan(200);
  });
  for (const key of ['gramophone', 'tr808', 'amen', 'clave', 'call'])
    it(`${key}: names its element and cards, and says where, who and where next in English and Russian`, () => {
      expect(validateLabel(key, o[key], { cards, elements })).toEqual([]);
    });
  it('a label with an unknown element or no Russian is refused', () => {
    const bad = { ...o.clave, elements: ['kazoo'], next: { en: 'On', ru: '' } };
    const errs = validateLabel('clave', bad, { cards, elements }).join('\n');
    expect(errs).toMatch(/kazoo/);
    expect(errs).toMatch(/next has no Russian/);
  });
  it('the clave is five strokes, three then two, and turns round', () => {
    const p = parsePattern(o.clave.pattern);
    expect(p.clave.filter(Boolean)).toHaveLength(5);
    expect(p.clave.slice(0, 8).filter(Boolean)).toHaveLength(3);
    const two = flipClave(p.clave);
    expect(two.slice(0, 8).filter(Boolean)).toHaveLength(2);
    expect(flipClave(two)).toEqual(p.clave);
  });
  it('an answer is on the beat within a quarter of a second', () => {
    expect(answerTiming(2, 2.1)).toBe('on');
    expect(answerTiming(2, 1.5)).toBe('early');
    expect(answerTiming(2, 2.6)).toBe('late');
  });
});
