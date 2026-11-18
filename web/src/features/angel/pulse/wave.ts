// A heartbeat rebuilt from its rhythm alone. The server keeps only RR
// intervals (milliseconds between beats), so the wave under the reader's
// finger is reconstructed: one soft hill per beat with a small echo after
// it, placed at the real beat times, so a quickening is seen and felt. The
// same times drive the vibration ("lub-dub") and the light. Pure: no DOM.

/** Beat times in ms from the start of one pass through `rr`; the pass lasts `cycle` ms. */
export function beatTimes(rr: readonly number[]): { times: number[]; cycle: number } {
  const times: number[] = [];
  let t = 0;
  for (const v of rr) {
    times.push(t);
    t += v;
  }
  return { times, cycle: t };
}

/**
 * The shape of one beat at `phase` (0..1 of its interval): a soft systolic
 * hill early in the beat and a smaller dicrotic echo after it.
 */
export function pulseShape(phase: number): number {
  const g = (x: number, mu: number, s: number) => Math.exp(-((x - mu) * (x - mu)) / (2 * s * s));
  return g(phase, 0.16, 0.07) + 0.32 * g(phase, 0.42, 0.08);
}

/** Which beat `t` (ms, looping) falls in, and how far into it. */
export function beatAt(t: number, rr: readonly number[]): { index: number; phase: number; start: number } {
  if (!rr.length) return { index: 0, phase: 0, start: 0 };
  const { times, cycle } = beatTimes(rr);
  const u = ((t % cycle) + cycle) % cycle;
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= u) lo = mid;
    else hi = mid - 1;
  }
  return { index: lo, phase: (u - times[lo]) / rr[lo], start: t - (u - times[lo]) };
}

/** The wave's height at `t` ms (0..~1), looping over the rhythm. */
export function waveAt(t: number, rr: readonly number[]): number {
  if (!rr.length) return 0;
  const { index, phase } = beatAt(t, rr);
  // A beat's hill is as wide as its interval allows: a fast beat is narrower.
  const width = Math.min(1, 800 / rr[index]);
  return pulseShape(Math.min(1, phase / width));
}

/** The beats that start in (from, to] ms, looping, with their interval. */
export function beatsBetween(from: number, to: number, rr: readonly number[]): { at: number; index: number; rr: number }[] {
  if (!rr.length || to <= from) return [];
  const out: { at: number; index: number; rr: number }[] = [];
  const { times, cycle } = beatTimes(rr);
  const first = Math.floor(from / cycle);
  const last = Math.floor(to / cycle);
  for (let c = first; c <= last; c++) {
    for (let i = 0; i < times.length; i++) {
      const at = c * cycle + times[i];
      if (at > from && at <= to) out.push({ at, index: i, rr: rr[i] });
    }
  }
  return out;
}

/**
 * One heartbeat for navigator.vibrate: a firm "lub", a short gap and a
 * softer "dub". The gap shortens as the heart quickens, as the second
 * sound does in a real heart; the whole fits well inside the interval.
 */
export function lubDub(rr: number): number[] {
  const gap = Math.round(Math.min(220, Math.max(70, rr * 0.28 - 30)));
  return [38, gap, 22];
}

/** A whole rhythm as one vibration pattern (lub, gap, dub, rest…). */
export function vibrationPattern(rr: readonly number[]): number[] {
  const out: number[] = [];
  for (const v of rr) {
    const [a, gap, b] = lubDub(v);
    out.push(a, gap, b, Math.max(0, v - a - gap - b));
  }
  return out;
}

/** Beats per minute of a rhythm (its mean interval). */
export function bpm(rr: readonly number[]): number {
  if (!rr.length) return 0;
  return Math.round(60000 / (rr.reduce((s, v) => s + v, 0) / rr.length));
}
