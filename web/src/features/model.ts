// Special projects ("features"): multimedia longreads told in scenes. This is
// the pure part of the engine, shared by the build script and the browser:
// the shape of a feature's content, its validation, and the arithmetic of
// scrolling through scenes. Nothing here touches the DOM.
//
// A feature lives in content/features/<id>/feature.yaml: a list of scenes,
// each with text blocks in English and Russian. Every block is marked
// `draft: true` until the editor has written its final text; a block marked
// `hold: true` waits for a second source and is never shipped to readers.

export interface Bi {
  en: string;
  ru: string;
}

export type BlockRole = 'kicker' | 'title' | 'lede' | 'text' | 'caption' | 'label' | 'quote' | 'line' | 'note';
export const BLOCK_ROLES: readonly BlockRole[] = ['kicker', 'title', 'lede', 'text', 'caption', 'label', 'quote', 'line', 'note'];

export interface Block extends Bi {
  id: string;
  role: BlockRole;
  draft: boolean;
  /** Not shown until a fact has a second source; dropped by the build. */
  hold?: boolean;
  /** Why it is held (for the editor). */
  check?: string;
}

/** One picture in a feature: generated art needs no label, a real photo needs its rights. */
export interface Art {
  id: string;
  kind: 'generated' | 'photo';
  file: string;
  /** The rights ledger entry (content/ledger/media.yaml) a photo is cleared by: its file name. */
  rights?: string;
}

export interface Scene {
  id: string;
  /** Which mechanic the feature module renders for it (door, minute, river…). */
  kind: string;
  blocks: Block[];
  /** Lineage nodes the scene plays or shows. */
  nodes?: string[];
  /** Anything else the scene's mechanic reads (figures, flashes, frames…). */
  [extra: string]: unknown;
}

export interface FeatureSource {
  id: string;
  order?: number;
  title: Bi;
  dek: Bi;
  reading?: Bi;
  /** A lineage file next to feature.yaml. */
  lineage?: string;
  ui?: Record<string, Bi & { draft?: boolean }>;
  art?: Art[];
  /** The river of versions, when the feature has a lineage. */
  river?: RiverSource;
  scenes: Scene[];
}

export interface RiverSource {
  roots: { girls: string; simone: string };
  include: string[];
  glyphs?: Record<string, import('./lineage').Glyph>;
  branch?: Record<string, import('./lineage').Branch>;
  screen?: string[];
}

/** What the museum ships for one feature (data/features/<id>.json). */
export interface FeatureData {
  version: 1;
  id: string;
  title: Bi;
  dek: Bi;
  reading?: Bi;
  ui: Record<string, Bi>;
  art: Art[];
  scenes: Scene[];
  lineage?: import('./lineage').LineageData;
}

export interface FeatureEntry {
  id: string;
  title: Bi;
  dek: Bi;
  reading?: Bi;
  scenes: number;
}

/** The list of features (data/features.json) with the engine's own labels. */
export interface FeaturesIndex {
  version: 1;
  ui: Record<string, Bi>;
  features: FeatureEntry[];
}

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isFeatureId(s: string | null | undefined): s is string {
  return !!s && ID.test(s) && s.length <= 64;
}

function bi(v: unknown): v is Bi {
  const b = v as Bi;
  return !!b && typeof b.en === 'string' && typeof b.ru === 'string' && b.en.trim() !== '' && b.ru.trim() !== '';
}

export interface ValidateContext {
  /** Lineage node ids with at least one source. */
  sourced?: Set<string>;
  /** Every lineage node id. */
  nodes?: Set<string>;
  /** Files with a rights entry in the media ledger. */
  rights?: Set<string>;
  /** Screen uses (lineage sync works) with at least one source. */
  sync?: Set<string>;
}

/** Problems with a feature's content; empty when it may be built. */
export function validateFeature(f: FeatureSource, ctx: ValidateContext = {}): string[] {
  const errs: string[] = [];
  if (!isFeatureId(f.id)) errs.push(`id ${JSON.stringify(f.id)} is not a lowercase slug`);
  if (!bi(f.title)) errs.push('title needs en and ru');
  if (!bi(f.dek)) errs.push('dek needs en and ru');
  if (f.reading !== undefined && !bi(f.reading)) errs.push('reading needs en and ru');
  for (const [k, v] of Object.entries(f.ui ?? {})) if (!bi(v)) errs.push(`ui.${k} needs en and ru`);
  for (const a of f.art ?? []) {
    if (a.kind === 'photo' && !(a.rights && ctx.rights?.has(a.rights))) errs.push(`art ${a.id}: a real photo needs a rights entry in the media ledger`);
    if (a.kind !== 'photo' && a.kind !== 'generated') errs.push(`art ${a.id}: kind must be photo or generated`);
  }
  if (!Array.isArray(f.scenes) || f.scenes.length === 0) {
    errs.push('no scenes');
    return errs;
  }
  const sceneIds = new Set<string>();
  for (const s of f.scenes) {
    const at = `scene ${s.id ?? '?'}`;
    if (!isFeatureId(s.id)) errs.push(`${at}: id is not a slug`);
    else if (sceneIds.has(s.id)) errs.push(`${at}: duplicate id`);
    sceneIds.add(s.id);
    if (!s.kind) errs.push(`${at}: no kind`);
    const blocks = Array.isArray(s.blocks) ? s.blocks : [];
    const blockIds = new Set<string>();
    for (const b of blocks) {
      const bat = `${at} block ${b.id ?? '?'}`;
      if (!b.id) errs.push(`${bat}: no id`);
      else if (blockIds.has(b.id)) errs.push(`${bat}: duplicate id`);
      blockIds.add(b.id);
      if (!BLOCK_ROLES.includes(b.role)) errs.push(`${bat}: unknown role ${JSON.stringify(b.role)}`);
      if (!bi(b)) errs.push(`${bat}: needs both en and ru text`);
      if (typeof b.draft !== 'boolean') errs.push(`${bat}: draft must be set (true until the editor's pass)`);
    }
    if (!blocks.some((b) => !b.hold && bi(b))) errs.push(`${at}: needs at least one shown block with en and ru text`);
    const used = [...(s.nodes ?? []), ...((s.threads as string[] | undefined) ?? []), ...((s.frames as Frame[] | undefined) ?? []).map((f) => f.node).filter((n): n is string => !!n)];
    for (const n of used) {
      if (ctx.nodes && !ctx.nodes.has(n)) errs.push(`${at}: lineage node ${n} does not exist`);
      else if (ctx.sourced && !ctx.sourced.has(n)) errs.push(`${at}: lineage node ${n} has no sources`);
    }
    for (const t of (s.flashes as unknown[] | undefined) ?? []) {
      try {
        parseClock(t as string);
      } catch (e) {
        errs.push(`${at}: ${(e as Error).message}`);
      }
    }
    for (const fr of (s.frames as Frame[] | undefined) ?? []) {
      if (!bi(fr.caption)) errs.push(`${at}: frame ${fr.work} needs a caption in en and ru`);
      if (ctx.sync && !ctx.sync.has(fr.work)) errs.push(`${at}: frame ${fr.work} is not a sourced screen use in the lineage`);
    }
    for (const fig of (s.figures as Figure[] | undefined) ?? []) if (!bi(fig.name) || (fig.role && !bi(fig.role))) errs.push(`${at}: figure ${fig.id} needs a name (and role) in en and ru`);
  }
  for (const n of f.river?.include ?? []) {
    if (ctx.nodes && !ctx.nodes.has(n)) errs.push(`river: lineage node ${n} does not exist`);
    else if (ctx.sourced && !ctx.sourced.has(n)) errs.push(`river: lineage node ${n} has no sources`);
  }
  return errs;
}

/** A frame of a film strip: a screen use of the song from the lineage's sync list. */
export interface Frame {
  work: string;
  node?: string;
  caption: Bi;
}

/** A person drawn in a scene. */
export interface Figure {
  id: string;
  name: Bi;
  age?: number;
  role?: Bi;
  lead?: boolean;
}

/** The shipped feature: held blocks are removed, so they cannot be shown by mistake. */
export function publishFeature(f: FeatureSource, lineage?: FeatureData['lineage']): { data: FeatureData; held: number } {
  let held = 0;
  const scenes = f.scenes.map((s) => {
    const blocks = s.blocks.filter((b) => {
      if (b.hold) held++;
      return !b.hold;
    });
    return { ...s, blocks: blocks.map(({ id, role, en, ru, draft }) => ({ id, role, en: en.trim(), ru: ru.trim(), draft })) };
  });
  const ui: Record<string, Bi> = {};
  for (const [k, v] of Object.entries(f.ui ?? {})) ui[k] = { en: v.en.trim(), ru: v.ru.trim() };
  return {
    data: { version: 1, id: f.id, title: f.title, dek: f.dek, ...(f.reading ? { reading: f.reading } : {}), ui, art: f.art ?? [], scenes, ...(lineage ? { lineage } : {}) },
    held,
  };
}

// ---------- scrolling ----------

/**
 * How far through a scene the reader is, 0..1. A scene taller than the
 * screen runs from its top reaching the top of the screen (0) to its bottom
 * reaching the bottom (1), which is the life of a sticky stage; a shorter
 * one from entering at the bottom to leaving at the top.
 */
export function sceneProgress(top: number, height: number, viewport: number): number {
  const span = height > viewport ? height - viewport : height + viewport;
  const done = height > viewport ? -top : viewport - top;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, done / span));
}

/** The scene under the reading line (a third down the screen), by the tops and heights of the scenes. */
export function sceneAt(rects: { top: number; height: number }[], viewport: number, line = 1 / 3): number {
  const y = viewport * line;
  for (let i = 0; i < rects.length; i++) if (rects[i].top <= y && rects[i].top + rects[i].height > y) return i;
  if (rects.length && rects[0].top > y) return 0;
  return rects.length - 1;
}

/** A progress window inside a scene mapped to 0..1 (for ink that draws from `from` to `to`). */
export function windowed(p: number, from = 0, to = 1): number {
  if (to <= from) return p >= to ? 1 : 0;
  return Math.min(1, Math.max(0, (p - from) / (to - from)));
}

/**
 * Never more than three flashes in any one second (WCAG 2.3.1). A flash
 * asked for too soon is simply not drawn; the sound or the drop it belongs
 * to is not affected.
 */
export class FlashGate {
  private times: number[] = [];
  private readonly max: number;
  private readonly window: number;
  constructor(max = 3, window = 1000) {
    this.max = max;
    this.window = window;
  }

  allow(now: number): boolean {
    this.times = this.times.filter((t) => now - t < this.window);
    if (this.times.length >= this.max) return false;
    this.times.push(now);
    return true;
  }
}

/** Where a clap lands on the reader's circle: the bar's phase as an angle, 0 at the top, clockwise. */
export function clapAngle(t: number, beat: number, beatsPerBar = 4): number {
  const bar = beat * beatsPerBar;
  const phase = (((t % bar) + bar) % bar) / bar;
  return phase * 360;
}

/** "1:49" → 109. */
export function parseClock(s: string | number): number {
  if (typeof s === 'number') return s;
  const m = /^(\d+):([0-5]\d)$/.exec(s.trim());
  if (!m) throw new Error(`not a m:ss time: ${s}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
