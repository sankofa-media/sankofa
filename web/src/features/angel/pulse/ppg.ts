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
export function detectBeats(x: Float64Array, hz: number, opts: { refractory?: number; share?: number; window?: number; floor?: number } = {}): number[] {
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
export const RR_LIMITS = { minBeats: 20, maxBeats: 120, min: 270, max: 2000, jump: 0.4, jumpShare: 0.1 } as const;

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
 * Everything from raw frames: resample to 30 Hz, take the pulsatile part,
 * find the beats, measure the intervals. The first and last second are left
 * out of the beats (the moving averages are lopsided there).
 */
export function analyse(samples: readonly Sample[], hz = 30): Analysis {
  const series = resample(samples, hz);
  const wave = pulsatile(series);
  const dur = wave.length / hz;
  const beats = detectBeats(wave, hz).filter((t) => t >= 1 && t <= dur - 1);
  return { wave, hz, beats, rr: intervals(beats) };
}
