// The arithmetic of the Angel longread's mood, kept apart from the DOM so it
// can be tested: how anxious the page is at any point of the reading, how
// far the progress bar may go, how the light beats, and how the sticky line
// closes in on the text.

/**
 * How tense each scene is, 0..1, along the shape of the track: it rises from
 * the bass and the silence through the voice, peaks where the guitars come
 * in and the crowd follows, and falls through the fade to the warm screen.
 */
export const ANXIETY: Record<string, number> = {
  line: 0.08,
  kingston: 0,
  'then-now': 0.12,
  bristol: 0.24,
  studio: 0.36,
  olympic: 0.44,
  voice: 0.52,
  strata: 0.66,
  break: 1,
  crowd: 0.96,
  beetle: 0.72,
  screens: 0.52,
  afterlife: 0.36,
  spiral: 0.2,
  fall: 0.06,
  warm: 0,
};

/**
 * The anxiety at progress `p` (0..1) through scene `i` of `ids`: the scene's
 * own level, leaning towards the next scene's as the reader nears it.
 */
export function anxietyAt(ids: readonly string[], i: number, p: number): number {
  const at = (k: number) => ANXIETY[ids[k]] ?? 0;
  if (i < 0 || i >= ids.length) return 0;
  const here = at(i);
  const next = i + 1 < ids.length ? at(i + 1) : here;
  const q = Math.min(1, Math.max(0, p));
  // The first half of a scene holds its own level; the second leans towards the next.
  const lean = q <= 0.5 ? 0 : (q - 0.5) * 2;
  return here + (next - here) * lean * lean;
}

/** The song is not exhausted: the progress bar never reaches the end. */
export const PROGRESS_CEILING = 0.99;

export function shownProgress(truth: number): number {
  if (!Number.isFinite(truth)) return 0;
  return Math.min(PROGRESS_CEILING, Math.max(0, truth));
}

/**
 * The light metronome. The tempo is our own estimate from listening to the
 * album version (about 107 beats per minute, not a published figure); the
 * page pulses at half time, about 54 a minute, which the eye takes in
 * without counting. The 1973 song is slower and lighter: also our estimate.
 */
export const BPM_1998 = 107;
export const BPM_1973 = 76;

/** Seconds per light pulse at half time. */
export function pulsePeriod(bpm: number): number {
  return 120 / bpm;
}

/** The period between the two songs as the reader drags from 1973 (0) to 1998 (1). */
export function thenNowPeriod(t: number): number {
  const q = Math.min(1, Math.max(0, t));
  return pulsePeriod(BPM_1973) + (pulsePeriod(BPM_1998) - pulsePeriod(BPM_1973)) * q;
}

/** How many copies of the title stick to the edges at an anxiety level (one faint watermark at rest). */
export function stickyCount(anxiety: number, max = 18): number {
  const a = Math.min(1, Math.max(0, anxiety));
  return 1 + Math.round(a * a * (max - 1));
}

/** How much the reading column narrows, 0..1 of the allowed squeeze (never more than that). */
export function squeeze(anxiety: number): number {
  const a = Math.min(1, Math.max(0, anxiety));
  return Math.round(a * 1000) / 1000;
}

/**
 * How heavy the scroll is: the share of a wheel step that moves the page
 * (1 is ordinary). It never drops below 0.55, so the page is always
 * readable and never traps the reader.
 */
export function viscosity(anxiety: number): number {
  const a = Math.min(1, Math.max(0, anxiety));
  return Math.max(0.55, 1 - 0.45 * a);
}

/** How much the type trembles: scroll speed (px/s) against the depth of the reading. */
export function tremble(speed: number, anxiety: number): number {
  const v = Math.min(1, Math.abs(speed) / 4000);
  return Math.min(1, v * (0.25 + 0.75 * Math.min(1, Math.max(0, anxiety))));
}

/** Which of the crowd's groups have come out at progress p (one group at a time). */
export function crowdShown(p: number, groups = 3): number {
  if (p < 0.12) return 0;
  return Math.min(groups, 1 + Math.floor(((p - 0.12) / 0.6) * groups));
}

/** The year the afterlife counter shows at progress p, 1997 → 2026. */
export function yearAt(p: number, from = 1997, to = 2026): number {
  const q = Math.min(1, Math.max(0, p));
  return Math.round(from + (to - from) * q);
}
