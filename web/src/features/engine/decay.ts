// Progressive decay: a page that comes apart chapter by chapter and is put
// back together. Each scene carries a level (0 is the calm page, 1 the
// worst); the reader's place gives the level now, and the level gives the
// effects. Pure arithmetic, shared by the browser and the tests: nothing
// here touches the DOM. A feature draws the effects (see its decay module);
// calm mode and reduced motion turn every one of them off.

export interface DecayPoint {
  /** The scene's level, 0..1. */
  decay?: number;
  /** The page puts itself back together across this scene (its level falls to 0 by its end). */
  settle?: boolean;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Where the level starts moving towards the next scene's: the last fifth of a scene. */
export const BLEND_FROM = 0.8;

/**
 * The level at progress `p` (0..1) through scene `i`. A scene holds its own
 * level and blends into the next one over its last fifth, so the peak stays
 * a peak; a scene that settles falls to nothing across its length.
 */
export function decayAt(scenes: DecayPoint[], i: number, p: number): number {
  const sc = scenes[i];
  if (!sc) return 0;
  const here = clamp01(sc.decay ?? 0);
  const t = clamp01(p);
  if (sc.settle) return here * (1 - smooth(t));
  const next = scenes[i + 1] ? clamp01(scenes[i + 1].decay ?? 0) : here;
  if (t <= BLEND_FROM) return here;
  return here + (next - here) * smooth((t - BLEND_FROM) / (1 - BLEND_FROM));
}

export interface DecayEffects {
  /** How far letters flow (0..1 of the allowed displacement). */
  flow: number;
  /** Colour drift, in degrees of hue. */
  drift: number;
  /** The echo behind the text (0..1 of its allowed offset and strength). */
  echo: number;
  /** How much the text lags behind the scroll and then falls after it (0..1). */
  drag: number;
  /** Footnotes creep away from their place. */
  creep: boolean;
  /** The progress bar may lie for a moment. */
  lie: boolean;
  /** A chapter in the menu may be called something else for a moment. */
  rename: boolean;
  /** Someone is watching. */
  watching: boolean;
}

/** The thresholds, in one place, so the curve and the tests agree. */
export const THRESHOLDS = { echo: 0.2, creep: 0.3, drag: 0.45, rename: 0.6, lie: 0.85, watching: 0.95 } as const;

/** What the page does at a level. Every effect is bounded: text stays readable at 1. */
export function decayEffects(level: number): DecayEffects {
  const l = clamp01(level);
  const over = (from: number) => (l <= from ? 0 : (l - from) / (1 - from));
  return {
    flow: l,
    drift: Math.round(l * 48),
    echo: over(THRESHOLDS.echo),
    drag: over(THRESHOLDS.drag),
    creep: l >= THRESHOLDS.creep,
    lie: l >= THRESHOLDS.lie,
    rename: l >= THRESHOLDS.rename,
    watching: l >= THRESHOLDS.watching,
  };
}

/** No decay at all: calm mode, reduced motion, before the reader chose. */
export const STILL: DecayEffects = decayEffects(0);

/**
 * The lag of the text behind the scroll, as a damped spring: the text holds
 * back while the reader scrolls and then falls after the page, a little past
 * its place, and settles. The real scroll position is never touched, so the
 * keyboard, the scroll bar and assistive technology always work; only the
 * picture lags, by at most `max` pixels.
 */
export class Drag {
  offset = 0;
  private v = 0;
  constructor(
    public max = 48,
    private readonly stiffness = 60,
    private readonly damping = 7,
  ) {}

  /** The page scrolled by `dy` pixels: the text is left behind by that much (up to the bound). */
  push(dy: number, strength: number): void {
    if (strength <= 0) return;
    const lim = this.max * Math.min(1, strength);
    this.offset = Math.max(-lim, Math.min(lim, this.offset + dy * strength * 0.6));
  }

  /** Advance by `dt` seconds; returns the offset in pixels. */
  step(dt: number): number {
    const h = Math.min(0.05, Math.max(0, dt));
    const a = -this.stiffness * this.offset - this.damping * this.v;
    this.v += a * h;
    this.offset += this.v * h;
    if (Math.abs(this.offset) < 0.05 && Math.abs(this.v) < 0.05) this.offset = this.v = 0;
    return this.offset;
  }

  get resting(): boolean {
    return this.offset === 0 && this.v === 0;
  }

  reset(): void {
    this.offset = this.v = 0;
  }
}

/**
 * The lie of the progress bar: at a high level, now and then the bar shows
 * a wrong place for a moment and then the truth again. Deterministic for a
 * given seed and time, so it can be tested. Returns the value to draw.
 */
export function lyingProgress(truth: number, now: number, lie: boolean, seed = 7): number {
  if (!lie) return truth;
  const period = 9000;
  const slot = Math.floor(now / period);
  const within = now - slot * period;
  if (within > 1400) return truth;
  const r = Math.abs(Math.sin((slot + 1) * 12.9898 + seed * 78.233)) % 1;
  // Backwards to where the reader was long ago, or forwards to an end that is not there.
  return r < 0.5 ? Math.max(0, truth * r) : Math.min(1, truth + (1 - truth) * r);
}
