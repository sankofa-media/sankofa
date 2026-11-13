// Working objects: the data the build writes (data/objects.json) and the pure
// parts of the instruments, kept apart from Web Audio so they can be tested.

export interface Pattern {
  /** voice id -> one boolean per step */
  [voice: string]: boolean[];
}

export interface ObjectsFile {
  version: 1;
  gramophone?: { card: string; audio: string; rpm: number; caption?: string; credit?: string; license?: string; url?: string };
  tr808?: { card: string; tempo: number; pattern: Pattern };
  amen?: { card: string; tempo: number; pattern: Pattern; youtube?: { id: string; title: string; channel: string; start?: number } };
}

/** "x..x|x..." -> booleans; `|` only separates bars for the eye. */
export function parseSteps(s: string): boolean[] {
  return [...s.replace(/[|\s]/g, '')].map((c) => c === 'x' || c === 'X');
}

export function parsePattern(src: Record<string, string>): Pattern {
  const out: Pattern = {};
  const lens = new Set<number>();
  for (const [k, v] of Object.entries(src)) {
    out[k] = parseSteps(v);
    lens.add(out[k].length);
  }
  if (lens.size > 1) throw new Error(`pattern voices differ in length: ${[...lens].join(', ')}`);
  const n = [...lens][0] ?? 0;
  if (n % 16) throw new Error(`pattern length ${n} is not whole bars of 16 steps`);
  return out;
}

export function patternLength(p: Pattern): number {
  return Object.values(p)[0]?.length ?? 16;
}

export function toggle(p: Pattern, voice: string, step: number): Pattern {
  const row = [...(p[voice] ?? [])];
  row[step] = !row[step];
  return { ...p, [voice]: row };
}

export function clearPattern(p: Pattern): Pattern {
  return Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v.map(() => false)]));
}

/** Seconds per sixteenth note. */
export function stepSeconds(bpm: number): number {
  return 60 / bpm / 4;
}

/** Voices that sound on a step. */
export function hits(p: Pattern, step: number): string[] {
  return Object.keys(p).filter((k) => p[k][step % p[k].length]);
}

/**
 * Where the needle sits on a 78: the outer groove is the start, the inner
 * groove the end. `r` is the distance from the centre as a fraction of the
 * record's radius.
 */
export const GROOVE = { outer: 0.94, inner: 0.42 };

export function timeAtRadius(r: number, duration: number): number {
  const f = (GROOVE.outer - r) / (GROOVE.outer - GROOVE.inner);
  return Math.min(1, Math.max(0, f)) * duration;
}

export function radiusAtTime(t: number, duration: number): number {
  const f = duration > 0 ? Math.min(1, Math.max(0, t / duration)) : 0;
  return GROOVE.outer - f * (GROOVE.outer - GROOVE.inner);
}

export function formatTime(t: number): string {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
