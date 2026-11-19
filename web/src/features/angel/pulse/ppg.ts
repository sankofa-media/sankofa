// Photoplethysmography from a phone camera, as pure arithmetic. A fingertip
// over the lens, lit by the flash, darkens a little with every heartbeat as
// blood fills it; the mean green of the frame's centre carries that. The
// camera code (./camera.ts) feeds frame times and green means in; this file
// turns them into beat times and RR intervals, which are the only thing the
// page ever sends. No DOM, no network.

export interface Sample {
  /** Seconds. */
  t: number;
  /** Mean green of the frame's centre, 0..255. */
  v: number;
  /** Mean red and blue of the same pixels (to tell a fingertip over the lens from an open view). */
  r?: number;
  b?: number;
}

/** A fingertip lit through: the frame is red, with little blue in it. */
export function covered(s: Sample): boolean {
  if (s.r === undefined || s.b === undefined) return true;
  return s.r > 60 && s.r > s.v * 1.4 && s.r > s.b * 1.8;
}

export interface Series {
  /** Time of the first value, seconds. */
  t0: number;
  /** Rate, values per second. */
  hz: number;
  v: Float64Array;
}

/** Frame times jitter: put the samples on an even grid at `hz` by linear interpolation. */
export function resample(samples: readonly Sample[], hz = 30): Series {
  const s = [...samples].filter((x) => Number.isFinite(x.t) && Number.isFinite(x.v)).sort((a, b) => a.t - b.t);
  if (s.length < 2) return { t0: s[0]?.t ?? 0, hz, v: new Float64Array(s.map((x) => x.v)) };
  const t0 = s[0].t;
  const n = Math.floor((s[s.length - 1].t - t0) * hz) + 1;
  const v = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + i / hz;
    while (j < s.length - 2 && s[j + 1].t < t) j++;
    const a = s[j];
    const b = s[j + 1];
    const span = b.t - a.t;
    v[i] = span > 0 ? a.v + ((b.v - a.v) * (t - a.t)) / span : a.v;
  }
  return { t0, hz, v };
}

/** A centred moving average over `win` values (shorter at the edges). */
export function movingAverage(v: ArrayLike<number>, win: number): Float64Array {
  const n = v.length;
  const out = new Float64Array(n);
  const half = Math.max(0, Math.floor(win / 2));
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + v[i];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n, i + half + 1);
    out[i] = (pre[b] - pre[a]) / (b - a);
  }
  return out;
}

/**
 * The pulsatile part of the signal: inverted (the finger darkens on a
 * beat, so a beat becomes a peak), the slow drift (1.5 s moving average)
 * taken away, and smoothed a little.
 */
export function pulsatile(series: Series, opts: { invert?: boolean; baseline?: number; smooth?: number } = {}): Float64Array {
  const { hz, v } = series;
  const sign = opts.invert === false ? 1 : -1;
  const x = Float64Array.from(v, (y) => sign * y);
  const base = movingAverage(x, Math.round((opts.baseline ?? 1.5) * hz));
  const d = Float64Array.from(x, (y, i) => y - base[i]);
  return movingAverage(d, Math.max(1, Math.round((opts.smooth ?? 0.12) * hz)));
}

/**
 * Beat times (seconds from the series' start) in a pulsatile signal: local
 * maxima above an adaptive threshold (a share of the local amplitude over
 * the surrounding two seconds, and above a floor of sensor noise), no closer than the refractory period (the
 * larger peak wins), each refined by a parabola through its neighbours.
 */
export function detectBeats(
  x: Float64Array,
  hz: number,
  opts: {
    refractory?: number;
    share?: number;
    window?: number;
    floor?: number;
  } = {},
): number[] {
  const n = x.length;
  if (n < 3) return [];
  const refractory = opts.refractory ?? 0.3;
  const share = opts.share ?? 0.45;
  // Below this (in green levels) it is sensor noise, not blood: a finger that is not there.
  const floor = opts.floor ?? 0.05;
  const half = Math.max(1, Math.round(((opts.window ?? 2) * hz) / 2));
  // The local amplitude: a running maximum of |x| (simple, O(n·w) is fine for a minute at 30 Hz).
  const amp = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let k = Math.max(0, i - half); k < Math.min(n, i + half + 1); k++) m = Math.max(m, Math.abs(x[k]));
    amp[i] = m;
  }
  const peaks: { i: number; v: number }[] = [];
  for (let i = 1; i < n - 1; i++) {
    const v = x[i];
    if (!(v > x[i - 1] && v >= x[i + 1])) continue;
    if (v <= floor || v < share * amp[i]) continue;
    const prev = peaks[peaks.length - 1];
    if (prev && (i - prev.i) / hz < refractory) {
      if (v > prev.v) peaks[peaks.length - 1] = { i, v };
      continue;
    }
    peaks.push({ i, v });
  }
  return peaks.map(({ i }) => {
    const a = x[i - 1];
    const b = x[i];
    const c = x[i + 1];
    const den = a - 2 * b + c;
    const off = den !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
    return (i + off) / hz;
  });
}

/** Intervals between beats, in whole milliseconds. */
export function intervals(beats: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < beats.length; i++) out.push(Math.round((beats[i] - beats[i - 1]) * 1000));
  return out;
}

// The limits the server checks (pkg/angel/pulse.go), checked here first so
// a reader is not asked to send what would be refused.
export const RR_LIMITS = {
  minBeats: 20,
  maxBeats: 120,
  min: 270,
  max: 2000,
  jump: 0.4,
  jumpShare: 0.1,
} as const;

export type RRProblem = 'count' | 'range' | 'irregular';

/** Whether a rhythm would pass as a pulse: null when it does, or what is wrong. */
export function checkRR(rr: readonly number[]): RRProblem | null {
  const L = RR_LIMITS;
  if (rr.length < L.minBeats || rr.length > L.maxBeats) return 'count';
  let jumps = 0;
  for (let i = 0; i < rr.length; i++) {
    if (!(rr[i] >= L.min && rr[i] <= L.max)) return 'range';
    if (i > 0 && Math.abs(rr[i] - rr[i - 1]) / rr[i - 1] > L.jump) jumps++;
  }
  return jumps > L.jumpShare * rr.length ? 'irregular' : null;
}

export interface Analysis {
  /** The pulsatile wave, for drawing. */
  wave: Float64Array;
  hz: number;
  beats: number[];
  rr: number[];
}

/**
 * The pulse period, from the autocorrelation of the wave: the lag between
 * 0.3 and 1.6 s (37 to 200 beats a minute) where the wave best matches
 * itself, and how well (0..1). A wave of noise matches itself nowhere.
 */
export function period(raw: Float64Array, hz: number): { lag: number; strength: number } {
  const n = raw.length;
  // A slip of the finger is a jolt many times the pulse; clipped, it cannot drown the rhythm.
  const mag = Float64Array.from(raw, Math.abs).sort();
  const lim = 4 * (mag[n >> 1] || 0);
  const x = Float64Array.from(raw, (y) => Math.max(-lim, Math.min(lim, y)));
  let e = 0;
  for (let i = 0; i < n; i++) e += x[i] * x[i];
  if (!(e > 0)) return { lag: 0, strength: 0 };
  const lo = Math.max(1, Math.round(0.3 * hz));
  const hi = Math.min(n - 1, Math.round(1.6 * hz));
  const ac: number[] = [];
  for (let k = 0; k <= hi; k++) {
    let c = 0;
    for (let i = 0; i + k < n; i++) c += x[i] * x[i + k];
    ac.push(c / e);
  }
  // The best match, then halved while half the lag matches nearly as well: two periods match almost as well as one.
  const peaks: number[] = [];
  for (let k = lo; k < hi; k++) if (ac[k] > ac[k - 1] && ac[k] >= ac[k + 1] && ac[k] > 0.15) peaks.push(k);
  let best = -1;
  for (const k of peaks) if (best < 0 || ac[k] > ac[best]) best = k;
  for (let again = true; again && best > 0;) {
    again = false;
    for (const k of peaks) {
      if (Math.abs(k * 2 - best) <= Math.max(2, best * 0.12) && ac[k] > 0.75 * ac[best]) {
        best = k;
        again = true;
        break;
      }
    }
  }
  if (best < 0) return { lag: 0, strength: 0 };
  return { lag: best / hz, strength: ac[best] };
}

/**
 * The intervals that are surely the heart's: a too-short interval followed
 * by one that completes it (a bump after the beat, counted as a beat) is
 * one interval; then the longest unbroken stretch where every interval is
 * near its neighbours' median and no step between two is a jump. A finger
 * that slipped for a moment breaks the stretch, it does not spoil it.
 */
export function steady(rr: readonly number[]): number[] {
  const merged: number[] = [];
  const med = (a: readonly number[], i: number) => {
    const w = a.slice(Math.max(0, i - 4), i + 5).sort((p, q) => p - q);
    return w[w.length >> 1];
  };
  for (let i = 0; i < rr.length; i++) {
    const m = med(rr, i);
    if (rr[i] < 0.65 * m && i + 1 < rr.length && rr[i] + rr[i + 1] < 1.3 * m) {
      merged.push(rr[i] + rr[i + 1]);
      i++;
    } else merged.push(rr[i]);
  }
  let best: [number, number] = [0, 0];
  let from = 0;
  for (let i = 0; i <= merged.length; i++) {
    const m = i < merged.length ? med(merged, i) : 0;
    const ok =
      i < merged.length &&
      merged[i] >= RR_LIMITS.min &&
      merged[i] <= RR_LIMITS.max &&
      merged[i] > 0.7 * m &&
      merged[i] < 1.4 * m &&
      (i === from || Math.abs(merged[i] - merged[i - 1]) / merged[i - 1] <= 0.3);
    if (!ok) {
      if (i - from > best[1] - best[0]) best = [from, i];
      from = i + 1;
    }
  }
  return merged.slice(best[0], best[1]);
}

/**
 * Everything from raw frames: resample to 30 Hz, take the pulsatile part of
 * the colour that carries the pulse best (green usually; red when the flash
 * leaves green too dark), find the beats no closer than most of a period
 * (so the second bump of every beat is not a beat), measure the intervals
 * and keep the steady stretch. The first and last second are left out of
 * the beats (the moving averages are lopsided there).
 */
export function analyse(samples: readonly Sample[], hz = 30): Analysis {
  const channels: Sample[][] = [samples as Sample[]];
  if (samples.length && samples.every((s) => s.r !== undefined)) channels.push(samples.map((s) => ({ t: s.t, v: s.r! })));
  let wave: Float64Array = new Float64Array(0);
  let slope: Float64Array = new Float64Array(0);
  let p = { lag: 0, strength: -1 };
  for (const c of channels) {
    const w = pulsatile(resample(c, hz));
    // A beat is where the wave climbs steepest: the second bump of a beat can be as tall as the first, but it never rises as fast.
    const d = movingAverage(
      Float64Array.from(w, (y, i) => (i ? (y - w[i - 1]) * hz : 0)),
      3,
    );
    const q = period(d, hz);
    if (q.strength > p.strength) {
      wave = w;
      slope = d;
      p = q;
    }
  }
  const dur = wave.length / hz;
  // The second bump comes 0.25 to 0.4 s after the beat whatever the rate, so beats closer than 0.42 s are never both counted
  // (a resting pulse up to about 140 a minute), and never closer than most of the period found.
  const refractory = Math.max(0.42, 0.6 * p.lag);
  const beats = detectBeats(slope, hz, {
    refractory,
    floor: 0.05 * hz * 0.1,
  }).filter((t) => t >= 1 && t <= dur - 1);
  return { wave, hz, beats, rr: steady(intervals(beats)) };
}
