// The trip, as numbers: how strong every madness on the page is at a given
// decay level and mood, how fast the shown values may follow the reader (so
// a jump to another chapter flows instead of blinking), how the effects
// degrade when frames drop, and the Arthur Lee mode's phases over a session.
// Pure arithmetic, shared by the browser and the tests.
import { decayAt, type DecayPoint } from '../engine/decay';
import { intensity as leeIntensity } from './lee/scheduler';

const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * The colour of a chapter beyond its level. `dark` is the mushroom side:
 * mycelium from the edges, spores, a closing vignette, bruise colours.
 * `warm` is the reassembly: the colour turns to gold and the dark burns away.
 */
export interface Mood {
  dark: number;
  warm: number;
}

export const MOODS: Record<string, Mood> = {
  'a-house-is-not-a-motel': { dark: 0.75, warm: 0 },
  andmoreagain: { dark: 0.2, warm: 0 },
  'the-daily-planet': { dark: 0.3, warm: 0 },
  'old-man': { dark: 0, warm: 0.35 },
  'the-red-telephone': { dark: 1, warm: 0 },
  flip: { dark: 0.3, warm: 0 },
  'between-clark-and-hilldale': { dark: 0.15, warm: 0.2 },
  'live-and-let-live': { dark: 0.9, warm: 0 },
  'the-good-humor-man': { dark: 0, warm: 0.6 },
  'bummer-in-the-summer': { dark: 0.85, warm: 0 },
  'you-set-the-scene': { dark: 0, warm: 1 },
  after: { dark: 0, warm: 0.25 },
};

/** The mood at progress `p` through scene `i`, blended like the decay level. */
export function moodAt(ids: string[], i: number, p: number): Mood {
  const pts = (k: 'dark' | 'warm'): DecayPoint[] => ids.map((id) => ({ decay: MOODS[id]?.[k] ?? 0 }));
  return { dark: decayAt(pts('dark'), i, p), warm: decayAt(pts('warm'), i, p) };
}

/** The displacement scale at the very worst (a letter moves at most half of it either way). Body text stays readable. */
export const MELT_MAX = { text: 5, title: 26, art: 64 } as const;
/** Colour fringes of the chromatic aberration, in pixels at the worst. */
export const SPLIT_MAX = { title: 5, art: 9 } as const;
/** The page breathes by at most this much of its size (±). */
export const BREATHE_MAX = 0.018;

export interface Look {
  /** The acid colour flowing behind the page (0..1 opacity). */
  acid: number;
  /** The same colour laid over the page with a blend mode (0..1 opacity). */
  overlay: number;
  /** Hue cycles per second: a full turn in seconds, never a strobe. */
  hueSpeed: number;
  /** Domain warp of the colour field (0..1). */
  warp: number;
  /** Displacement of letters and pictures, in pixels. */
  melt: { text: number; title: number; art: number };
  /** Chromatic aberration, in pixels. */
  split: { title: number; art: number };
  /** The echoes trailing behind what scrolls (0..1). */
  trails: number;
  /** Breathing of the whole page: amplitude as a fraction of the size. */
  breathe: number;
  /** Mycelium and spores (0..1). */
  mycelium: number;
  /** The heavy vignette closing in (0..1). */
  vignette: number;
  /** The warm reassembly (0..1). */
  warm: number;
  /** The kaleidoscope tunnel behind the text (0..1): the peak only. */
  tunnel: number;
  /** The page tilts and swims, in degrees at most. */
  tilt: number;
  /** Words swap places for a moment. */
  swap: boolean;
}

export const CALM_LOOK: Look = look(0, { dark: 0, warm: 0 });

/** Everything the page shows at a level (0..1) and a mood. Zero at zero: the prologue is a calm 1967 magazine. */
export function look(level: number, mood: Mood): Look {
  const l = clamp01(level);
  const dark = clamp01(mood.dark);
  const warm = clamp01(mood.warm);
  const on = smoothstep(0.02, 0.12, l);
  const curve = Math.pow(l, 1.15);
  const mycelium = dark * smoothstep(0.12, 0.5, l) * (1 - warm);
  return {
    acid: on * (0.3 + 0.7 * Math.pow(l, 0.8)),
    overlay: on * 0.8 * smoothstep(0.05, 0.75, l),
    hueSpeed: 0.012 + 0.07 * curve,
    warp: curve,
    melt: { text: MELT_MAX.text * smoothstep(0.05, 0.85, l), title: MELT_MAX.title * curve, art: MELT_MAX.art * curve },
    split: { title: SPLIT_MAX.title * smoothstep(0.15, 1, l), art: SPLIT_MAX.art * smoothstep(0.1, 1, l) },
    trails: smoothstep(0.2, 0.9, l),
    breathe: BREATHE_MAX * smoothstep(0.1, 0.9, l),
    mycelium,
    vignette: clamp01(0.25 * curve + 0.7 * mycelium),
    warm: warm * on,
    tunnel: smoothstep(0.88, 1, l),
    tilt: 1.8 * smoothstep(0.6, 1, l),
    swap: l >= 0.9,
  };
}

/**
 * Follow a target at a bounded speed (units per second): a shown value
 * never jumps, so a jump across the album flows over a second or two
 * instead of blinking.
 */
export function slew(shown: number, target: number, dt: number, perSecond: number): number {
  const step = perSecond * Math.max(0, Math.min(0.1, dt));
  if (Math.abs(target - shown) <= step) return target;
  return shown + Math.sign(target - shown) * step;
}

/** How fast the light-carrying values may change: well under a flash (a full swing takes over a second). */
export const SLEW = { opacity: 0.7, melt: 30 } as const;

/**
 * The frame budget. Counts frames; when they come too slowly the canvas
 * resolution and the noise octaves drop, and climb back when there is room.
 */
export class Quality {
  static readonly STEPS = [
    { scale: 0.5, octaves: 5 },
    { scale: 0.38, octaves: 4 },
    { scale: 0.28, octaves: 3 },
    { scale: 0.2, octaves: 2 },
  ];
  step = 0;
  private ema = 16.7;
  private slow = 0;
  private fast = 0;

  constructor(start = 0) {
    this.step = Math.max(0, Math.min(Quality.STEPS.length - 1, start));
  }

  /** One frame took `ms`. Returns true when the quality changed. */
  frame(ms: number): boolean {
    if (!(ms > 0) || ms > 250) return false; // a hidden tab or a pause, not a slow frame
    this.ema += (ms - this.ema) * 0.08;
    if (this.ema > 21) {
      this.fast = 0;
      if (++this.slow > 24 && this.step < Quality.STEPS.length - 1) {
        this.step++;
        this.slow = 0;
        this.ema = 16.7;
        return true;
      }
    } else if (this.ema < 14) {
      this.slow = 0;
      if (++this.fast > 240 && this.step > 0) {
        this.step--;
        this.fast = 0;
        return true;
      }
    } else {
      this.slow = Math.max(0, this.slow - 1);
    }
    return false;
  }

  get fps(): number {
    return 1000 / this.ema;
  }

  get scale(): number {
    return Quality.STEPS[this.step].scale;
  }

  get octaves(): number {
    return Quality.STEPS[this.step].octaves;
  }
}

// ---------- the Arthur Lee mode over a session ----------

export { leeIntensity };

export interface LeePhase {
  intensity: number;
  /** Euphoric colour: hue rotation by luminance, posterisation, edge glow (0..1). */
  euphoria: number;
  /** The bad trip: desaturated, green and purple, tendrils at the edges, shadows thicken (0..1). */
  bad: number;
  /** The kaleidoscope phase (0..1). */
  kaleidoscope: number;
  /** Long colour trails (0..1 of the feedback that stays). */
  trails: number;
  /** The walls bend and pulse (0..1). */
  breathe: number;
}

/** One trip cycle, in seconds: euphoria, a kaleidoscope, a bad stretch, and back. */
export const LEE_CYCLE = 96;

/**
 * The mode's look at `seconds` into the session. Intensity ramps over
 * minutes; on top of it the phases alternate slowly (a full cycle is a
 * minute and a half), so the picture flows from one to the next and never
 * switches. The first bad stretch waits until the world is strong.
 */
export function leePhase(seconds: number): LeePhase {
  const t = Math.max(0, seconds);
  const i = leeIntensity(t);
  const c = (t % LEE_CYCLE) / LEE_CYCLE;
  // A smooth bump over [a, b] of the cycle.
  const bump = (a: number, b: number) => smoothstep(a, a + (b - a) * 0.35, c) * (1 - smoothstep(b - (b - a) * 0.35, b, c));
  const badReady = smoothstep(0.3, 0.55, i);
  const bad = badReady * bump(0.55, 0.92);
  const kaleidoscope = smoothstep(0.25, 0.6, i) * bump(0.3, 0.62) * 0.9;
  const euphoria = Math.min(1, (0.35 + 0.65 * i) * (1 - bad));
  return {
    intensity: i,
    euphoria,
    bad,
    kaleidoscope,
    trails: 0.55 + 0.4 * i,
    breathe: 0.2 + 0.8 * i,
  };
}
