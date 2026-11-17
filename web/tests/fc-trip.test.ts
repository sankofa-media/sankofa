import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { decayAt, type DecayPoint } from '../src/features/engine/decay';
import { FlashGate, type FeatureSource } from '../src/features/model';
import { CALM_LOOK, LEE_CYCLE, leePhase, look, MELT_MAX, MOODS, moodAt, Quality, slew, SLEW, SPLIT_MAX, BREATHE_MAX } from '../src/features/forever-changes/trip';
import { grow } from '../src/features/forever-changes/mycelium';
import { edgeHotspot } from '../src/features/forever-changes/lee/mode';

const fc = parse(readFileSync(new URL('../../content/features/forever-changes/feature.yaml', import.meta.url), 'utf8')) as FeatureSource;
const ids = fc.scenes.map((s) => s.id);
const points: DecayPoint[] = fc.scenes.map((s) => ({ decay: s.decay as number, settle: s.settle as boolean }));
const at = (id: string, p = 0.5) => {
  const i = ids.indexOf(id);
  return look(decayAt(points, i, p), moodAt(ids, i, p));
};

describe('the trip on the page: how strong, chapter by chapter', () => {
  it('the door and the prologue are a calm 1967 magazine: nothing at all', () => {
    for (const id of ['warning', 'prologue']) {
      const l = at(id);
      expect(l.acid, id).toBe(0);
      expect(l.overlay, id).toBe(0);
      expect(l.mycelium, id).toBe(0);
      expect(l.melt.text + l.melt.title + l.melt.art, id).toBe(0);
      expect(l.tunnel, id).toBe(0);
      expect(l.swap, id).toBe(false);
    }
    expect(look(0, { dark: 1, warm: 0 })).toEqual(CALM_LOOK);
  });
  it('every effect grows with the level, and the peak is The Red Telephone, overwhelming', () => {
    const levels = [0, 0.1, 0.25, 0.4, 0.6, 0.8, 1];
    const series = levels.map((l) => look(l, { dark: 0.5, warm: 0 }));
    for (let k = 1; k < series.length; k++) {
      const a = series[k - 1];
      const b = series[k];
      expect(b.acid).toBeGreaterThanOrEqual(a.acid);
      expect(b.overlay).toBeGreaterThanOrEqual(a.overlay);
      expect(b.melt.title).toBeGreaterThanOrEqual(a.melt.title);
      expect(b.melt.art).toBeGreaterThanOrEqual(a.melt.art);
      expect(b.split.art).toBeGreaterThanOrEqual(a.split.art);
      expect(b.breathe).toBeGreaterThanOrEqual(a.breathe);
    }
    const peak = at('the-red-telephone');
    expect(peak.acid).toBeGreaterThan(0.95);
    expect(peak.overlay).toBeGreaterThan(0.75);
    expect(peak.tunnel).toBe(1);
    expect(peak.swap).toBe(true);
    expect(peak.tilt).toBeGreaterThan(1.5);
    expect(peak.mycelium).toBeGreaterThan(0.9);
    // Nowhere else opens the tunnel or swaps words.
    for (const id of ids.filter((x) => x !== 'the-red-telephone')) {
      expect(at(id).tunnel, id).toBe(0);
      expect(at(id).swap, id).toBe(false);
    }
  });
  it('the text stays readable: every displacement and fringe is bounded, and body text moves least', () => {
    for (let l = 0; l <= 1.0001; l += 0.05) {
      const x = look(l, { dark: 1, warm: 0 });
      expect(x.melt.text).toBeLessThanOrEqual(MELT_MAX.text);
      expect(x.melt.title).toBeLessThanOrEqual(MELT_MAX.title);
      expect(x.melt.art).toBeLessThanOrEqual(MELT_MAX.art);
      expect(x.split.title).toBeLessThanOrEqual(SPLIT_MAX.title);
      expect(x.split.art).toBeLessThanOrEqual(SPLIT_MAX.art);
      expect(x.breathe).toBeLessThanOrEqual(BREATHE_MAX);
      expect(x.melt.text).toBeLessThanOrEqual(x.melt.title + 1e-9);
      expect(x.acid).toBeLessThanOrEqual(1);
    }
    // A letter moves at most half the scale either way: under three pixels.
    expect(MELT_MAX.text / 2).toBeLessThan(3);
    expect(BREATHE_MAX).toBeLessThanOrEqual(0.02);
  });
  it('the dark chapters grow mycelium; it recedes in the breaths and burns away in You Set the Scene', () => {
    for (const id of ['a-house-is-not-a-motel', 'the-red-telephone', 'live-and-let-live', 'bummer-in-the-summer']) {
      expect(MOODS[id].dark, id).toBeGreaterThanOrEqual(0.75);
      expect(at(id).mycelium, id).toBeGreaterThan(0.4);
      expect(at(id).vignette, id).toBeGreaterThan(0.3);
    }
    for (const id of ['old-man', 'the-good-humor-man']) expect(at(id).mycelium, id).toBeLessThan(0.05);
    expect(at('the-good-humor-man').warm).toBeGreaterThan(0.3);
    // The reassembly: warm, no dark, and the level falls to nothing by its end.
    expect(at('you-set-the-scene', 0.3).warm).toBeGreaterThan(0.8);
    expect(at('you-set-the-scene', 0.3).mycelium).toBe(0);
    expect(at('you-set-the-scene', 1).acid).toBe(0);
    for (const id of ['after', 'return', 'end', 'echoes']) expect(at(id).acid, id).toBe(0);
  });
  it('the mood blends from chapter to chapter like the level', () => {
    const i = ids.indexOf('old-man');
    expect(moodAt(ids, i, 0.5).dark).toBe(0);
    expect(moodAt(ids, i, 1).dark).toBe(1);
    const mid = moodAt(ids, i, 0.9).dark;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });
});

describe('no flashes', () => {
  it('a shown value follows its target at a bounded speed: a jump across the album flows over more than a second', () => {
    let shown = 0;
    let steps = 0;
    const dt = 1 / 60;
    while (shown < 1 && steps < 1000) {
      const next = slew(shown, 1, dt, SLEW.opacity);
      expect(next - shown).toBeLessThanOrEqual(SLEW.opacity * dt + 1e-9);
      shown = next;
      steps++;
    }
    expect(steps * dt).toBeGreaterThan(1);
    // In any third of a second the light changes by less than a quarter: never three swings a second.
    expect(SLEW.opacity / 3).toBeLessThan(0.25);
    // A long pause (a hidden tab) does not turn into a jump either.
    expect(slew(0, 1, 5, SLEW.opacity)).toBeLessThanOrEqual(SLEW.opacity * 0.1);
  });
  it('the colour drifts in seconds: a full turn of the hue takes over ten seconds even at the peak', () => {
    for (let l = 0; l <= 1; l += 0.1) expect(1 / look(l, { dark: 0, warm: 0 }).hueSpeed).toBeGreaterThan(10);
  });
  it('the ringing telephone and the blinking eye go through the FlashGate: at most three a second', () => {
    const g = new FlashGate(3, 1000);
    let n = 0;
    for (let t = 0; t < 10_000; t += 16) if (g.allow(t)) n++;
    expect(n).toBeLessThanOrEqual(30);
    for (const file of ['decay-fx.ts', 'trip-fx.ts', 'lee/mode.ts']) {
      const src = readFileSync(new URL(`../src/features/forever-changes/${file}`, import.meta.url), 'utf8');
      expect(src, file).toMatch(/new FlashGate\(3, 1000\)/);
      expect(src, file).toMatch(/gate\.allow\(/);
    }
  });
  it('the Arthur Lee phases flow: no value of light jumps between frames', () => {
    let prev = leePhase(0);
    for (let t = 1 / 30; t < 900; t += 1 / 30) {
      const p = leePhase(t);
      for (const k of ['euphoria', 'bad', 'kaleidoscope', 'intensity', 'trails', 'breathe'] as const) expect(Math.abs(p[k] - prev[k]), `${k} at ${t}`).toBeLessThan(0.01);
      prev = p;
    }
  });
});

describe('the Arthur Lee mode over a session', () => {
  it('starts gentle and euphoric, ramps over minutes, and only turns bad once the world is strong', () => {
    const p0 = leePhase(0);
    expect(p0.intensity).toBe(0);
    expect(p0.bad).toBe(0);
    expect(p0.kaleidoscope).toBe(0);
    expect(leePhase(120).intensity).toBeGreaterThan(0.4);
    expect(leePhase(600).intensity).toBeGreaterThan(0.95);
    for (let t = 0; t < 60; t += 0.5) expect(leePhase(t).bad, `${t}`).toBe(0);
  });
  it('alternates euphoric, kaleidoscope and bad phases once it has ramped', () => {
    const late = Array.from({ length: LEE_CYCLE * 2 }, (_, k) => leePhase(600 + k));
    expect(Math.max(...late.map((p) => p.bad))).toBeGreaterThan(0.9);
    expect(Math.max(...late.map((p) => p.kaleidoscope))).toBeGreaterThan(0.8);
    expect(Math.max(...late.map((p) => p.euphoria))).toBeGreaterThan(0.95);
    // Never euphoric and bad at full at once.
    for (const p of late) expect(p.euphoria + p.bad).toBeLessThanOrEqual(1.0001);
    // A bad stretch is a stretch: tens of seconds, not a blink.
    const bad = late.filter((p) => p.bad > 0.5).length;
    expect(bad).toBeGreaterThan(30);
  });
  it('faces come out where the picture has the most edges', () => {
    const w = 32;
    const h = 18;
    const lum = new Float32Array(w * h).fill(0.4);
    for (let y = 8; y < 12; y++) for (let x = 20; x < 24; x++) lum[y * w + x] = (x + y) % 2 ? 1 : 0;
    const [x, y] = edgeHotspot(lum, w, h)!;
    expect(x).toBeGreaterThan(20 / w);
    expect(x).toBeLessThan(24 / w);
    expect(y).toBeGreaterThan(7 / h);
    expect(y).toBeLessThan(13 / h);
    expect(edgeHotspot(new Float32Array(w * h).fill(0.5), w, h)).toBeNull();
  });
});

describe('the frame budget', () => {
  it('drops resolution and octaves when frames are slow, climbs back when there is room, ignores a pause', () => {
    const q = new Quality();
    expect(q.step).toBe(0);
    for (let k = 0; k < 400; k++) q.frame(40);
    expect(q.step).toBe(Quality.STEPS.length - 1);
    expect(q.scale).toBeLessThan(Quality.STEPS[0].scale);
    expect(q.octaves).toBeLessThan(Quality.STEPS[0].octaves);
    for (let k = 0; k < 2000; k++) q.frame(8);
    expect(q.step).toBe(0);
    const r = new Quality();
    for (let k = 0; k < 50; k++) r.frame(1000);
    expect(r.step).toBe(0);
    // A good frame rate keeps the best quality.
    const s = new Quality();
    for (let k = 0; k < 1000; k++) s.frame(16.7);
    expect(s.step).toBe(0);
  });
});

describe('the mycelium', () => {
  it('grows from all four edges, the same tree every time, and stays near the edges', () => {
    const a = grow(1000, 700);
    const b = grow(1000, 700);
    expect(a.segments.length).toBe(b.segments.length);
    expect(a.segments[100]).toEqual(b.segments[100]);
    expect(a.segments.length).toBeGreaterThan(500);
    const starts = a.segments.filter((s) => s.birth === 0);
    expect(starts.some((s) => s.y0 < 0)).toBe(true);
    expect(starts.some((s) => s.y0 > 700)).toBe(true);
    expect(starts.some((s) => s.x0 < 0)).toBe(true);
    expect(starts.some((s) => s.x0 > 1000)).toBe(true);
    // The middle of the screen stays clear.
    const mid = a.segments.filter((s) => Math.abs(s.x1 - 500) < 120 && Math.abs(s.y1 - 350) < 80);
    expect(mid.length / a.segments.length).toBeLessThan(0.01);
    for (const s of a.segments) {
      expect(s.birth).toBeGreaterThanOrEqual(0);
      expect(s.birth).toBeLessThanOrEqual(1);
    }
  });
});
