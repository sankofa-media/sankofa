import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { beatAt, beatsBetween, beatTimes, bpm, lubDub, vibrationPattern, waveAt } from '../src/features/angel/pulse/wave';
import { ANXIETY, anxietyAt, crowdShown, PROGRESS_CEILING, shownProgress, squeeze, stickyCount, thenNowPeriod, tremble, viscosity, yearAt, pulsePeriod } from '../src/features/angel/mood';
import { pulseUrl, wantsPulse } from '../src/features/angel/url';
import type { FeatureSource } from '../src/features/model';

describe('the pulse wave rebuilt from its rhythm', () => {
  const rr = [1000, 900, 800, 700];
  it('places beats at the real times and loops', () => {
    expect(beatTimes(rr)).toEqual({
      times: [0, 1000, 1900, 2700],
      cycle: 3400,
    });
    expect(beatAt(1950, rr)).toMatchObject({ index: 2 });
    expect(beatAt(3400 + 950, rr)).toMatchObject({ index: 0 });
    expect(beatsBetween(0, 3400, rr).map((b) => b.at)).toEqual([1000, 1900, 2700, 3400]);
    expect(bpm([1000, 1000])).toBe(60);
  });
  it('draws one hill a beat, closer together as the beats quicken', () => {
    const peaks: number[] = [];
    let prev = waveAt(0, rr);
    let rising = true;
    for (let t = 1; t < 3400; t++) {
      const v = waveAt(t, rr);
      if (rising && v < prev && prev > 0.8) peaks.push(t - 1);
      rising = v >= prev;
      prev = v;
    }
    expect(peaks.length).toBe(4);
    const gaps = peaks.slice(1).map((p, i) => p - peaks[i]);
    expect(gaps[0]).toBeGreaterThan(gaps[2]);
  });
  it('vibrates lub-dub inside every interval', () => {
    for (const v of [400, 800, 1500]) {
      const p = lubDub(v);
      expect(p).toHaveLength(3);
      expect(p.reduce((s, x) => s + x, 0)).toBeLessThan(v);
    }
    expect(lubDub(400)[1]).toBeLessThan(lubDub(1200)[1]);
    expect(vibrationPattern([800, 600]).reduce((s, x) => s + x, 0)).toBe(1400);
  });
  it('keeps beating without a gap when the recorded rhythm runs out and loops', () => {
    // A two-beat rhythm, five cycles asked for: every beat of every cycle is
    // there, and the spacing between neighbours follows the rhythm across
    // the cycle boundary as if the record never ended.
    const rr = [500, 700];
    const beats = beatsBetween(0, 5 * 1200, rr).map((b) => b.at);
    expect(beats).toEqual([500, 1200, 1700, 2400, 2900, 3600, 4100, 4800, 5300, 6000]);
    const gaps = beats.slice(1).map((t, i) => t - beats[i]);
    expect(gaps).toEqual([700, 500, 700, 500, 700, 500, 700, 500, 700]);
  });
});

describe('the mood of the page', () => {
  const ids = ['line', 'kingston', 'then-now', 'bristol', 'studio', 'olympic', 'voice', 'strata', 'break', 'crowd', 'beetle', 'screens', 'afterlife', 'spiral', 'fall', 'warm'];
  it('every scene has a level; it rises to the break and falls to the warm screen', () => {
    for (const id of ids) expect(ANXIETY[id], id).toBeTypeOf('number');
    const levels = ids.map((_, i) => anxietyAt(ids, i, 0.25));
    const peak = levels.indexOf(Math.max(...levels));
    expect(ids[peak]).toBe('break');
    for (let i = 2; i < peak; i++) expect(levels[i]).toBeGreaterThanOrEqual(levels[i - 1]);
    for (let i = peak + 2; i < ids.length; i++) expect(levels[i]).toBeLessThanOrEqual(levels[i - 1]);
    expect(anxietyAt(ids, ids.length - 1, 1)).toBe(0);
    expect(anxietyAt(ids, 7, 1)).toBeCloseTo(1);
  });
  it('the progress never reaches the end', () => {
    expect(shownProgress(1)).toBe(PROGRESS_CEILING);
    expect(shownProgress(2)).toBe(PROGRESS_CEILING);
    expect(shownProgress(0.5)).toBe(0.5);
    expect(shownProgress(Number.NaN)).toBe(0);
  });
  it('the light beats at half time and slows towards 1973', () => {
    expect(pulsePeriod(107)).toBeCloseTo(1.121, 2);
    expect(thenNowPeriod(0)).toBeGreaterThan(thenNowPeriod(1));
  });
  it('the sticky line, the squeeze, the weight of the scroll and the tremble stay within bounds', () => {
    expect(stickyCount(0)).toBe(1);
    expect(stickyCount(1)).toBe(18);
    expect(stickyCount(0.5)).toBeLessThan(stickyCount(0.9));
    expect(squeeze(2)).toBe(1);
    expect(viscosity(0)).toBe(1);
    expect(viscosity(1)).toBeCloseTo(0.55);
    expect(tremble(0, 1)).toBe(0);
    expect(tremble(10_000, 1)).toBe(1);
    expect(tremble(2000, 0)).toBeLessThan(tremble(2000, 1));
  });
  it('the crowd comes out one group at a time, and the years run to 2026', () => {
    expect([0, 0.2, 0.4, 0.6, 0.9].map((p) => crowdShown(p))).toEqual([0, 1, 2, 3, 3]);
    expect(yearAt(0)).toBe(1997);
    expect(yearAt(1)).toBe(2026);
  });
});

describe('the pulse page link', () => {
  it('opens the pulse page of this feature, in the reader’s language', () => {
    expect(pulseUrl('https://sankofa.black/', 'ru')).toBe('https://sankofa.black/ru/features/angel/#scene=warm&pulse=1');
    expect(pulseUrl('https://sankofa.black/#x', 'en')).toBe('https://sankofa.black/features/angel/#scene=warm&pulse=1');
    expect(wantsPulse('#view=feature&item=angel&pulse=1')).toBe(true);
    expect(wantsPulse('#view=feature&item=angel')).toBe(false);
  });
});

describe('the Angel content', () => {
  const f = parse(readFileSync('../content/features/angel/feature.yaml', 'utf8')) as FeatureSource;
  it('keeps the scenes in the order of the track', () => {
    expect(f.scenes.map((s) => s.id)).toEqual(['line', 'kingston', 'then-now', 'bristol', 'studio', 'olympic', 'voice', 'strata', 'break', 'crowd', 'beetle', 'screens', 'afterlife', 'warm']);
  });
  it('never says whose the pulse is', () => {
    const all = JSON.stringify(f.ui) + JSON.stringify(f.scenes);
    expect(all).not.toMatch(/\b(my|author'?s?|owner'?s?)\s+pulse|мой пульс|пульс автора|пульс владельца/i);
  });
});
