import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { analyse, checkRR, detectBeats, intervals, movingAverage, pulsatile, resample, steady, type Sample } from '../src/features/angel/pulse/ppg';
import { beatAt, beatsBetween, beatTimes, bpm, lubDub, vibrationPattern, waveAt } from '../src/features/angel/pulse/wave';
import { ANXIETY, anxietyAt, crowdShown, PROGRESS_CEILING, shownProgress, squeeze, stickyCount, thenNowPeriod, tremble, viscosity, yearAt, pulsePeriod } from '../src/features/angel/mood';
import { pulseUrl, wantsPulse } from '../src/features/angel/url';
import type { FeatureSource } from '../src/features/model';

/** A small deterministic random source (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * What a phone camera sees through a fingertip: a bright frame that darkens
 * a little on every beat (a quick fall and a slow return), a slow drift of
 * the exposure, sensor noise, and frames that do not arrive exactly on time.
 */
function fingertip(rr: number[], opts: { fps?: number; seed?: number; noise?: number; drift?: number } = {}): { samples: Sample[]; beats: number[] } {
  const fps = opts.fps ?? 29.97;
  const r = rng(opts.seed ?? 7);
  const beats: number[] = [0.4];
  for (const v of rr) beats.push(beats[beats.length - 1] + v / 1000);
  const end = beats[beats.length - 1] + 0.6;
  const samples: Sample[] = [];
  for (let k = 0; k / fps < end; k++) {
    const t = k / fps + (r() - 0.5) * 0.008;
    let dip = 0;
    for (const b of beats) {
      const d = t - b;
      if (d < -0.2 || d > 1.2) continue;
      // The finger darkens quickly at systole and recovers slowly.
      dip += d < 0 ? Math.exp(-(d * d) / (2 * 0.04 * 0.04)) : Math.exp(-d / 0.2);
    }
    const v = 140 - 3 * dip + (opts.drift ?? 6) * Math.sin(2 * Math.PI * 0.08 * t) + (r() - 0.5) * 2 * (opts.noise ?? 0.25);
    samples.push({ t, v });
  }
  return { samples, beats };
}

describe('camera pulse: the signal arithmetic', () => {
  it('resamples uneven frames onto an even grid', () => {
    const s = resample(
      [
        { t: 0, v: 0 },
        { t: 0.05, v: 5 },
        { t: 0.1, v: 10 },
      ],
      20,
    );
    expect(s.hz).toBe(20);
    expect([...s.v]).toEqual([0, 5, 10]);
    const m = movingAverage([1, 2, 3, 4, 5], 3);
    expect(m[2]).toBeCloseTo(3);
    expect(m[0]).toBeCloseTo(1.5);
  });

  it('takes the drift away and turns the darkening into peaks', () => {
    const { samples } = fingertip(new Array(30).fill(850));
    const x = pulsatile(resample(samples, 30));
    const mean = x.reduce((a, b) => a + b, 0) / x.length;
    expect(Math.abs(mean)).toBeLessThan(0.3);
    expect(Math.max(...x)).toBeGreaterThan(0.5);
  });

  it('finds every beat of a steady pulse and measures it to within half a frame', () => {
    const rr = new Array(40).fill(0).map((_, i) => 830 + ((i * 37) % 5) * 10);
    const { samples, beats } = fingertip(rr, { seed: 11 });
    const a = analyse(samples);
    // The first and last second are left out; every beat in between is found.
    const inner = beats.filter((t) => t - samples[0].t >= 1 && t - samples[0].t <= a.wave.length / a.hz - 1);
    expect(a.beats.length).toBe(inner.length);
    const truth = intervals(inner);
    expect(a.rr.length).toBe(truth.length);
    a.rr.forEach((v, i) => expect(Math.abs(v - truth[i])).toBeLessThanOrEqual(15));
    expect(checkRR(a.rr)).toBeNull();
  });

  it('follows a quickening pulse', () => {
    // From 64 to 100 beats a minute over 45 beats.
    const rr = Array.from({ length: 45 }, (_, i) => Math.round(940 - (i / 44) * 340));
    const { samples, beats } = fingertip(rr, { seed: 3, noise: 0.35 });
    const a = analyse(samples);
    const truth = intervals(beats.filter((t) => t - samples[0].t >= 1 && t - samples[0].t <= a.wave.length / a.hz - 1));
    expect(a.rr.length).toBe(truth.length);
    // Within a frame and a half at 30 frames a second: the overlapping beats of a fast heart blur the peaks a little.
    a.rr.forEach((v, i) => expect(Math.abs(v - truth[i])).toBeLessThanOrEqual(25));
    // And with no drift: the mean interval is right to a few milliseconds.
    expect(Math.abs(a.rr.reduce((s, v) => s + v, 0) - truth.reduce((s, v) => s + v, 0)) / truth.length).toBeLessThan(4);
    // It quickens: the last intervals are clearly shorter than the first.
    const head = a.rr.slice(0, 5).reduce((s, v) => s + v, 0) / 5;
    const tail = a.rr.slice(-5).reduce((s, v) => s + v, 0) / 5;
    expect(head - tail).toBeGreaterThan(250);
    expect(checkRR(a.rr)).toBeNull();
  });

  it('never counts two beats inside the refractory period', () => {
    const hz = 30;
    const x = new Float64Array(90);
    // Two bumps 0.2 s apart: one beat (the larger), then a real one 1 s later.
    x[30] = 1;
    x[36] = 0.6;
    x[60] = 1;
    const b = detectBeats(x, hz);
    expect(b.map((t) => Math.round(t * hz))).toEqual([30, 60]);
  });

  it('refines a peak between frames with a parabola', () => {
    const hz = 30;
    const x = new Float64Array(30);
    // A symmetric peak centred halfway between frames 10 and 11.
    x[9] = 0.2;
    x[10] = 1;
    x[11] = 1;
    x[12] = 0.2;
    const [t] = detectBeats(x, hz);
    expect(t * hz).toBeCloseTo(10.5, 1);
  });

  it('flat light, or a finger that moved, gives no pulse to send', () => {
    const flat: Sample[] = Array.from({ length: 900 }, (_, k) => ({
      t: k / 30,
      v: 120 + Math.sin(k) * 0.01,
    }));
    expect(checkRR(analyse(flat).rr)).not.toBeNull();
  });

  it('checks a rhythm the way the server does', () => {
    expect(checkRR(new Array(30).fill(800))).toBeNull();
    expect(checkRR(new Array(10).fill(800))).toBe('count');
    expect(checkRR(new Array(121).fill(800))).toBe('count');
    expect(checkRR([...new Array(29).fill(800), 250])).toBe('range');
    expect(checkRR([...new Array(29).fill(800), 2100])).toBe('range');
    // Six 40%+ jumps in 30 beats is too many (more than 10%).
    expect(checkRR(new Array(30).fill(0).map((_, i) => (i % 5 === 4 ? 1300 : 800)))).toBe('irregular');
  });
});

describe('camera pulse: a real fingertip under a flash', () => {
  /** A beat as a phone sees it: the fall, the slow return, and the second bump (the dicrotic wave) a third of a second later. */
  function realistic(
    rr: number[],
    opts: {
      seed?: number;
      bump?: number;
      noise?: number;
      slips?: number[];
    } = {},
  ): Sample[] {
    const r = rng(opts.seed ?? 5);
    const beats: number[] = [0.4];
    for (const v of rr) beats.push(beats[beats.length - 1] + v / 1000);
    const end = beats[beats.length - 1] + 0.6;
    const out: Sample[] = [];
    for (let k = 0; k / 30 < end; k++) {
      const t = k / 30 + (r() - 0.5) * 0.008;
      let dip = 0;
      for (const b of beats) {
        const d = t - b;
        if (d < -0.2 || d > 1.2) continue;
        dip += d < 0 ? Math.exp(-(d * d) / (2 * 0.04 * 0.04)) : Math.exp(-d / 0.18);
        // The dicrotic wave: a smaller darkening 0.33 s after the beat.
        dip += (opts.bump ?? 0.6) * Math.exp(-((d - 0.33) ** 2) / (2 * 0.05 * 0.05));
      }
      // The flash leaves green nearly black and noisy; red carries the pulse.
      const slip = (opts.slips ?? []).some((a) => t > a && t < a + 0.4) ? 25 : 0;
      out.push({
        t,
        v: 8 + (r() - 0.5) * 2,
        r: 210 - 3 * dip + slip + (r() - 0.5) * 2 * (opts.noise ?? 0.3),
        b: 20,
      });
    }
    return out;
  }

  it('reads the pulse from red when the flash leaves green dark, and does not count the second bump', () => {
    const rr = Array.from({ length: 45 }, (_, i) => 820 + ((i * 53) % 7) * 12);
    const a = analyse(realistic(rr));
    expect(checkRR(a.rr)).toBeNull();
    const mean = a.rr.reduce((p, v) => p + v, 0) / a.rr.length;
    expect(Math.abs(mean - 856)).toBeLessThan(25);
  });

  it('keeps the steady stretch when the finger slips for a moment', () => {
    const rr = new Array(50).fill(780);
    const a = analyse(realistic(rr, { slips: [9.1, 31.4], seed: 9 }));
    expect(checkRR(a.rr)).toBeNull();
    a.rr.forEach((v) => expect(Math.abs(v - 780)).toBeLessThan(40));
  });

  it('catches a pulse across rates, bumps, noise and slips', () => {
    let ok = 0;
    let n = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = rng(seed * 101);
      const base = 520 + r() * 560;
      const rr = Array.from({ length: Math.ceil(40000 / base) + 2 }, () => Math.round(base * (0.95 + r() * 0.1)));
      const slips = r() < 0.5 ? [5 + r() * 30] : [];
      const a = analyse(
        realistic(rr, {
          seed,
          bump: 0.2 + r() * 0.4,
          noise: 0.2 + r() * 0.6,
          slips,
        }),
      );
      n++;
      if (!checkRR(a.rr) && Math.abs(a.rr.reduce((p, v) => p + v, 0) / a.rr.length - base) < base * 0.08) ok++;
    }
    expect(ok / n).toBeGreaterThanOrEqual(0.95);
  });

  it('joins a bump counted as a beat back into its interval', () => {
    expect(steady([800, 800, 300, 500, 800, 800])).toEqual([800, 800, 800, 800, 800]);
  });
});

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
    expect(pulseUrl('https://sankofa.black/', 'ru')).toBe('https://sankofa.black/#lang=ru&view=feature&item=angel&scene=warm&pulse=1');
    expect(pulseUrl('https://sankofa.black/#x', 'en')).toBe('https://sankofa.black/#view=feature&item=angel&scene=warm&pulse=1');
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

describe('a fingertip over the lens', () => {
  it('is red and lit through; an open view, a dark room or a white wall is not', async () => {
    const { covered } = await import('../src/features/angel/pulse/ppg');
    expect(covered({ t: 0, v: 40, r: 210, b: 20 })).toBe(true);
    expect(covered({ t: 0, v: 120, r: 130, b: 110 })).toBe(false);
    expect(covered({ t: 0, v: 8, r: 12, b: 6 })).toBe(false);
    expect(covered({ t: 0, v: 230, r: 240, b: 235 })).toBe(false);
    expect(covered({ t: 0, v: 50 })).toBe(true);
  });
});
