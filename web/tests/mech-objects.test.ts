import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { describe, expect, it } from 'vitest';
import { parseListen } from '../src/lib/listen';
import { clearPattern, formatTime, GROOVE, hits, parsePattern, parseSteps, patternLength, radiusAtTime, stepSeconds, timeAtRadius, toggle } from '../src/mechanics/objects/model';

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
