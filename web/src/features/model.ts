// Special projects ("features"): multimedia longreads told in scenes. This is
// the pure part of the engine, shared by the build script and the browser:
// the shape of a feature's content, its validation, and the arithmetic of
// scrolling through scenes. Nothing here touches the DOM.
import { links } from '../lib/links.ts';
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
  /** Whose account this is: one of the feature's lenses (see Lens). */
  lens?: string;
}

/**
 * One witness through whom a scene can be read (the "Rashomon" lenses): the
 * same scene, told by someone else. A lens marked `empty` is a witness who
 * left no account; it carries only its `silence` and no blocks.
 */
export interface Lens {
  id: string;
  name: Bi;
  role?: Bi;
  empty?: boolean;
  silence?: Bi;
}

/** One picture in a feature: generated art needs no label, a real photo needs its rights. */
export interface Art {
  id: string;
  kind: 'generated' | 'photo';
  file: string;
  /** The rights ledger entry (content/ledger/media.yaml) a photo is cleared by: its file name. */
  rights?: string;
  /** What the picture shows, for a screen reader. */
  alt?: Bi;
  /** What the photo shows, in a line under it (as its source page states it). */
  caption?: Bi;
  /** Who made it and under what licence, shown with it. */
  credit?: Bi;
  /** The page it comes from, linked from the credit. */
  source?: string;
  /** The licence's own page, linked from the credit when the licence asks for a link. */
  license_url?: string;
}

/**
 * One layer of a scene's generated illustration: a transparent image on the
 * scene's canvas, stacked in order (first is furthest back).
 */
export interface ArtLayer {
  /** A file in content/features/<id>/art. */
  file: string;
  /** Parallax: how many pixels the layer travels through the scene (0 is still). */
  depth?: number;
  /**
   * figure: breathes slightly; spin: turns slowly in its own plane (see
   * `spin`); step: comes half a step forward when its scene is reached.
   */
  role?: ArtRole;
  /** What it shows for a screen reader, or "" for a decorative layer. Required either way. */
  alt: Bi | '';
  /** Shown only while the picture is in this state (a door closed or open). */
  state?: string;
  /** Appears over this part of the scene's progress, swinging open from its pivot: "from to". */
  open?: string;
  /** Registration on the canvas, in percent of its width and height, and a scale. */
  fit?: { x?: number; y?: number; scale?: number };
  /** The point the layer breathes or opens around, in percent: "x y". */
  pivot?: string;
  /**
   * For a disc seen at an angle: the centre it turns about (percent), the
   * ratio of its axes, its tilt (degrees), and the face that turns, an
   * ellipse [cx, cy, rx, ry] in percent (the rim stays still).
   */
  spin?: { x: number; y: number; ratio: number; tilt?: number; face?: [number, number, number, number] };
}

export type ArtRole = 'figure' | 'spin' | 'step';
export const ART_ROLES: readonly ArtRole[] = ['figure', 'spin', 'step'];

/** A scene's illustration: generated layers, marked as generated (they never enter the photo-rights ledger). */
export interface SceneArt {
  generated: true;
  /** The canvas, "w / h" (3 / 2 when not given). */
  aspect?: string;
  layers: ArtLayer[];
  /**
   * Transparent pictures the scene's mechanic places by itself rather than
   * stacking them on the canvas (the figures of the Arthur Lee mode). They
   * ship with the scene and need alt text like any layer.
   */
  overlays?: ArtLayer[];
  /** Where hands meet, in percent of the canvas: a ripple of ink spreads there with every clap. */
  claps?: { depth?: number; at: [number, number][] };
}

export interface Scene {
  id: string;
  /** Which mechanic the feature module renders for it (door, minute, river…). */
  kind: string;
  blocks: Block[];
  /** Lineage nodes the scene plays or shows. */
  nodes?: string[];
  /** A real photo from the feature's art list (its id). */
  photo?: string;
  /** The scene's generated illustration. */
  art?: SceneArt;
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
  /** The witnesses a scene can be read through (scenes list theirs as `lenses`). */
  lenses?: Lens[];
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
  lenses?: Lens[];
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
  /** Dictionary card ids, for [[id|words]] links in the text. */
  cards?: Set<string>;
  /** Files in the feature's art folder. */
  artFiles?: Set<string>;
  /** Every file named in the media ledger, cleared or not. */
  ledger?: Set<string>;
}

const ART_FILE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.(?:webp|png|jpg)$/;
const RANGE = /^\s*(0|1|0?\.\d+)\s+(0|1|0?\.\d+)\s*$/;

/** Every art file the feature's scenes use, for the build to ship. */
export function sceneArtFiles(f: FeatureSource): string[] {
  return [...new Set(f.scenes.flatMap((s) => [...(s.art?.layers ?? []), ...(s.art?.overlays ?? [])].map((l) => l.file)))];
}

/** Problems with a scene's generated illustration. */
export function validateSceneArt(art: unknown, ctx: ValidateContext = {}, photos: Set<string> = new Set()): string[] {
  const errs: string[] = [];
  const a = art as SceneArt;
  if (!a || typeof a !== 'object' || Array.isArray(a)) return ['art must be { generated: true, layers: [...] }'];
  if (a.generated !== true) errs.push('art must be marked generated: true (a real photo goes in the feature\'s art list, with its rights)');
  if (a.aspect !== undefined && !/^\d+(\.\d+)?\s*\/\s*\d+(\.\d+)?$/.test(a.aspect)) errs.push(`art aspect ${JSON.stringify(a.aspect)} is not "w / h"`);
  if (a.claps !== undefined) {
    const c = a.claps;
    const pct = (v: unknown) => typeof v === 'number' && v >= 0 && v <= 100;
    if (!c || !Array.isArray(c.at) || c.at.length === 0 || !c.at.every((p) => Array.isArray(p) && p.length === 2 && p.every(pct))) errs.push('art claps need at: [[x, y], ...] in percent');
    if (c?.depth !== undefined && !(typeof c.depth === 'number' && c.depth >= 0 && c.depth <= 80)) errs.push('art claps depth must be 0..80 pixels');
  }
  if (!Array.isArray(a.layers) || a.layers.length === 0) return [...errs, 'art has no layers'];
  if (a.overlays !== undefined && !Array.isArray(a.overlays)) errs.push('art overlays must be a list of layers');
  for (const l of [...a.layers, ...(Array.isArray(a.overlays) ? a.overlays : [])]) {
    const at = `art layer ${l?.file ?? '?'}`;
    if (typeof l?.file !== 'string' || !ART_FILE.test(l.file)) {
      errs.push(`${at}: file must be a lowercase name ending in .webp, .png or .jpg`);
      continue;
    }
    if (ctx.artFiles && !ctx.artFiles.has(l.file)) errs.push(`${at}: no such file in the feature's art folder`);
    if (ctx.ledger?.has(l.file) || photos.has(l.file)) errs.push(`${at}: generated art must not be in the photo-rights ledger or the photo list`);
    if (!('alt' in l)) errs.push(`${at}: needs alt (en and ru), or alt: "" when it is decorative`);
    else if (l.alt !== '' && !bi(l.alt)) errs.push(`${at}: alt needs en and ru, or "" when decorative`);
    if (l.depth !== undefined && !(typeof l.depth === 'number' && l.depth >= 0 && l.depth <= 80)) errs.push(`${at}: depth must be 0..80 pixels`);
    if (l.role !== undefined && !ART_ROLES.includes(l.role)) errs.push(`${at}: unknown role ${JSON.stringify(l.role)}`);
    if (l.role === 'spin' && !(l.spin && [l.spin.x, l.spin.y, l.spin.ratio].every((v) => typeof v === 'number') && l.spin.ratio > 0 && l.spin.ratio <= 1)) errs.push(`${at}: a spinning layer needs spin: { x, y, ratio (0..1] }`);
    if (l.spin?.face !== undefined && !(Array.isArray(l.spin.face) && l.spin.face.length === 4 && l.spin.face.every((v) => typeof v === 'number'))) errs.push(`${at}: spin.face must be [cx, cy, rx, ry] in percent`);
    if (l.state !== undefined && !isFeatureId(l.state)) errs.push(`${at}: state must be a slug`);
    if (l.open !== undefined && !RANGE.test(l.open)) errs.push(`${at}: open must be "from to" between 0 and 1`);
    if (l.pivot !== undefined && !/^\s*-?\d+(\.\d+)?\s+-?\d+(\.\d+)?\s*$/.test(l.pivot)) errs.push(`${at}: pivot must be "x y" in percent`);
    for (const k of ['x', 'y', 'scale'] as const) if (l.fit?.[k] !== undefined && typeof l.fit[k] !== 'number') errs.push(`${at}: fit.${k} must be a number`);
  }
  return errs;
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
    if (a.kind === 'generated' && ctx.ledger?.has(a.file)) errs.push(`art ${a.id}: generated art must not be in the photo-rights ledger`);
    if (a.kind !== 'photo' && a.kind !== 'generated') errs.push(`art ${a.id}: kind must be photo or generated`);
    if (a.kind === 'photo' && !(bi(a.alt) && bi(a.credit))) errs.push(`art ${a.id}: a real photo needs alt and credit in en and ru`);
    if (a.caption !== undefined && !bi(a.caption)) errs.push(`art ${a.id}: caption needs en and ru`);
    for (const k of ['source', 'license_url'] as const) if (a[k] !== undefined && !/^https:\/\/\S+$/.test(a[k]!)) errs.push(`art ${a.id}: ${k} must be an https link`);
  }
  if (!Array.isArray(f.scenes) || f.scenes.length === 0) {
    errs.push('no scenes');
    return errs;
  }
  const sceneIds = new Set<string>();
  const photos = new Set((f.art ?? []).filter((a) => a.kind === 'photo').map((a) => a.file));
  for (const s of f.scenes) {
    const at = `scene ${s.id ?? '?'}`;
    if (!isFeatureId(s.id)) errs.push(`${at}: id is not a slug`);
    else if (sceneIds.has(s.id)) errs.push(`${at}: duplicate id`);
    sceneIds.add(s.id);
    if (!s.kind) errs.push(`${at}: no kind`);
    if (s.photo !== undefined && !(f.art ?? []).some((a) => a.id === s.photo && a.kind === 'photo')) errs.push(`${at}: photo ${String(s.photo)} is not a photo in the feature's art list`);
    if (s.art !== undefined) errs.push(...validateSceneArt(s.art, ctx, photos).map((e) => `${at}: ${e}`));
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
      if (ctx.cards) for (const id of [...links(b.en ?? ''), ...links(b.ru ?? '')]) if (!ctx.cards.has(id)) errs.push(`${bat}: links to a card that does not exist: ${id}`);
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
  errs.push(...validateLenses(f));
  for (const n of f.river?.include ?? []) {
    if (ctx.nodes && !ctx.nodes.has(n)) errs.push(`river: lineage node ${n} does not exist`);
    else if (ctx.sourced && !ctx.sourced.has(n)) errs.push(`river: lineage node ${n} has no sources`);
  }
  return errs;
}

/**
 * Problems with a feature's lenses: every lens is defined once, with a name
 * in both languages; a scene lists only defined lenses, and each one it lists
 * speaks there in at least one shown block, except a witness who left no
 * account (`empty`), who speaks nowhere and is shown by its silence.
 */
export function validateLenses(f: FeatureSource): string[] {
  const errs: string[] = [];
  const lenses = new Map<string, Lens>();
  for (const l of f.lenses ?? []) {
    if (!isFeatureId(l?.id)) errs.push(`lens ${JSON.stringify(l?.id)}: id is not a slug`);
    else if (lenses.has(l.id)) errs.push(`lens ${l.id}: duplicate id`);
    else lenses.set(l.id, l);
    if (!bi(l?.name)) errs.push(`lens ${l?.id}: needs a name in en and ru`);
    if (l?.role !== undefined && !bi(l.role)) errs.push(`lens ${l.id}: role needs en and ru`);
    if (l?.empty && !bi(l.silence)) errs.push(`lens ${l.id}: an empty lens needs its silence in en and ru`);
  }
  for (const s of f.scenes ?? []) {
    const listed = s.lenses === undefined ? [] : Array.isArray(s.lenses) ? (s.lenses as string[]) : null;
    if (listed === null) {
      errs.push(`scene ${s.id}: lenses must be a list of lens ids`);
      continue;
    }
    for (const id of listed) {
      const l = lenses.get(id);
      if (!l) {
        errs.push(`scene ${s.id}: lens ${id} is not defined`);
        continue;
      }
      const shown = (s.blocks ?? []).filter((b) => b.lens === id && !b.hold).length;
      if (!l.empty && shown === 0) errs.push(`scene ${s.id}: lens ${id} has nothing to say here (no shown block)`);
    }
    for (const b of s.blocks ?? []) {
      if (b.lens === undefined) continue;
      const l = lenses.get(b.lens);
      if (!l) errs.push(`scene ${s.id} block ${b.id}: lens ${b.lens} is not defined`);
      else if (l.empty) errs.push(`scene ${s.id} block ${b.id}: ${b.lens} left no account and cannot speak`);
      else if (!listed.includes(b.lens)) errs.push(`scene ${s.id} block ${b.id}: lens ${b.lens} is not in the scene's lenses`);
    }
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
    return { ...s, blocks: blocks.map(({ id, role, en, ru, draft, lens }) => ({ id, role, en: en.trim(), ru: ru.trim(), draft, ...(lens ? { lens } : {}) })) };
  });
  const ui: Record<string, Bi> = {};
  for (const [k, v] of Object.entries(f.ui ?? {})) ui[k] = { en: v.en.trim(), ru: v.ru.trim() };
  return {
    data: { version: 1, id: f.id, title: f.title, dek: f.dek, ...(f.reading ? { reading: f.reading } : {}), ui, art: f.art ?? [], scenes, ...(lineage ? { lineage } : {}), ...(f.lenses?.length ? { lenses: f.lenses } : {}) },
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
