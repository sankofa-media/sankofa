// The Arthur Lee mode's clock: how strong the world grows the longer the
// mode runs, and when something that is not there appears. Pure and seeded,
// so the tests can run an hour of it in a moment; the mode itself only
// draws what this says.

/** Everything the mode can show besides the picture itself. */
export type VisionKind = 'figure' | 'face' | 'object' | 'behind';

export interface Vision {
  kind: VisionKind;
  /** When it appears, in seconds since the mode started. */
  at: number;
  /** How long it stays unless it melts sooner. */
  life: number;
  /** For an object: which one (from the chapter's visions). */
  object?: string;
  /** Where: the edge of the frame for figures (-1 left … 1 right), anywhere for faces. */
  x: number;
  y: number;
}

/** 0 at the start, rising towards 1: about half after two minutes, nearly all after six. */
export function intensity(seconds: number): number {
  const t = Math.max(0, seconds);
  return 1 - Math.exp(-t / 170);
}

/** Seconds between visions at an intensity: rare at first, never a crowd. */
export function gap(level: number): number {
  return 22 - 15 * Math.min(1, Math.max(0, level));
}

/** At most this many at once. */
export const MAX_AT_ONCE = 3;
/** "Someone behind you" waits for the world to be strong, and comes rarely. */
export const BEHIND_FROM = 0.45;
export const BEHIND_GAP = 45;

export function rng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Scheduler {
  private next: number;
  private lastBehind = -Infinity;
  private shownObjects = 0;
  private readonly rand: () => number;
  private live: Vision[] = [];

  /** `objects`: the chapter's visions (a ringing telephone for "The Red Telephone"…). */
  constructor(
    private objects: string[],
    seed = 1967,
    /** The first vision waits this many seconds. */
    start = 4,
  ) {
    this.rand = rng(seed);
    this.next = start;
  }

  /** The reader is in another chapter now: its own objects come next. */
  setObjects(objects: string[]): void {
    this.objects = objects;
    this.shownObjects = 0;
  }

  /** Visions on screen at `now` (seconds since start). */
  active(now: number): Vision[] {
    this.live = this.live.filter((v) => now < v.at + v.life);
    return this.live;
  }

  /** One melted (looked at): it goes before its time. */
  melt(v: Vision): void {
    this.live = this.live.filter((x) => x !== v);
  }

  /** What appears now, if anything. Call every frame or every few hundred milliseconds. */
  tick(now: number): Vision[] {
    const out: Vision[] = [];
    this.active(now);
    while (now >= this.next) {
      const at = this.next;
      const level = intensity(at);
      this.next = at + gap(level) * (0.75 + this.rand() * 0.5);
      if (this.live.length >= MAX_AT_ONCE) continue;
      const v = this.pick(at, level);
      if (!v) continue;
      this.live.push(v);
      out.push(v);
    }
    return out;
  }

  private pick(at: number, level: number): Vision | null {
    const r = this.rand();
    const x = this.rand();
    const y = this.rand();
    // The chapter's own object comes first, then now and then again.
    if (this.objects.length && (this.shownObjects === 0 || r < 0.3)) {
      const object = this.objects[this.shownObjects % this.objects.length];
      this.shownObjects++;
      return { kind: 'object', at, life: 9 + 6 * level, object, x: 0.2 + x * 0.6, y: 0.25 + y * 0.5 };
    }
    if (level >= BEHIND_FROM && at - this.lastBehind >= BEHIND_GAP && r < 0.45) {
      this.lastBehind = at;
      return { kind: 'behind', at, life: 4, x: x < 0.5 ? -1 : 1, y: 0.5 };
    }
    if (r < 0.75) return { kind: 'figure', at, life: 12 + 8 * level, x: x < 0.5 ? -1 : 1, y: 0.35 + y * 0.4 };
    return { kind: 'face', at, life: 6 + 4 * level, x: 0.15 + x * 0.7, y: 0.15 + y * 0.6 };
  }
}

/**
 * Has the reader turned towards a figure at the edge? With a compass, the
 * figure was left at a heading; turning within `within` degrees of it melts
 * it. Headings are in degrees, any range.
 */
export function facing(heading: number, figureHeading: number, within = 18): boolean {
  const d = (((heading - figureHeading) % 360) + 540) % 360 - 180;
  return Math.abs(d) <= within;
}

/**
 * Without a compass: a large change of the camera picture on the figure's
 * side means the phone moved that way. `diff` is the mean change per side
 * (0..1); the threshold is above the noise of a still camera.
 */
export function movedToward(side: -1 | 1, diff: { left: number; right: number }, threshold = 0.12): boolean {
  return (side < 0 ? diff.left : diff.right) > threshold;
}
