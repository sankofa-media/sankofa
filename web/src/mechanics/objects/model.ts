// Working objects: the data the build writes (data/objects.json) and the pure
// parts of the instruments, kept apart from Web Audio so they can be tested.

export interface Pattern {
  /** voice id -> one boolean per step */
  [voice: string]: boolean[];
}

export interface L {
  en: string;
  ru: string;
}

/** The label every Workshop object carries: the element it lets you touch, and its story. */
export interface ObjectLabel {
  /** element ids (content/roots/elements.yaml); the first is the one you touch */
  elements: string[];
  /** card ids the story rests on */
  cards: string[];
  name: L;
  /** the element, as this object shows it */
  what: L;
  /** where and when */
  when: L;
  /** who made it */
  who: L;
  /** where it went next */
  next: L;
}

export interface ObjectsFile {
  version: 1;
  /** what the elements are and why the music of the Atlantic world rests on them */
  intro?: L;
  gramophone?: { card: string; audio: string; rpm: number; caption?: string; credit?: string; license?: string; url?: string } & ObjectLabel;
  tr808?: { card: string; tempo: number; pattern: Pattern } & ObjectLabel;
  /** The Amen break's official recording comes from data/listen.json, by its card. */
  amen?: { card: string; tempo: number; pattern: Pattern } & ObjectLabel;
  clave?: { card: string; tempo: number; pattern: Pattern } & ObjectLabel;
  call?: { card: string } & ObjectLabel;
}

export const LABEL_FIELDS = ['name', 'what', 'when', 'who', 'next'] as const;

/** What is wrong with an object's label: unknown elements or cards, a missing translation. */
export function validateLabel(key: string, o: Partial<ObjectLabel> | undefined, known: { cards: Set<string>; elements: Set<string> }): string[] {
  const errs: string[] = [];
  if (!o) return [`${key}: no label`];
  if (!o.elements?.length) errs.push(`${key}: names no element`);
  for (const e of o.elements ?? []) if (!known.elements.has(e)) errs.push(`${key}: element ${e} is not in roots/elements.yaml`);
  if (!o.cards?.length) errs.push(`${key}: names no card`);
  for (const c of o.cards ?? []) if (!known.cards.has(c)) errs.push(`${key}: card ${c} does not exist`);
  for (const f of LABEL_FIELDS) {
    const v = o[f] as L | undefined;
    if (!v?.en?.trim()) errs.push(`${key}: ${f} has no English`);
    if (!v?.ru?.trim()) errs.push(`${key}: ${f} has no Russian`);
  }
  return errs;
}

/**
 * A call-and-response round: the leader's call, then the group's answer, and
 * how the answer the reader gives lands against the beat it was due on.
 * Times in seconds from the start of the round.
 */
export function answerTiming(due: number, at: number, window = 0.25): 'early' | 'on' | 'late' {
  if (at < due - window) return 'early';
  if (at > due + window) return 'late';
  return 'on';
}

/** The son clave in either direction: 3–2 is the pattern as written, 2–3 its halves swapped. */
export function flipClave(steps: boolean[]): boolean[] {
  const half = steps.length / 2;
  return [...steps.slice(half), ...steps.slice(0, half)];
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
