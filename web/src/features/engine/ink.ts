// Living ink: line drawings that boil slightly, as hand-drawn animation does,
// draw themselves as the reader scrolls into their scene, spread in blots
// when the scene is reached, and breathe. Drawings are plain SVG with data
// attributes, so a feature describes what moves and the engine moves it:
//   data-ink="from to"   a stroke drawn over that part of the scene's progress
//   data-fade="from to"  an element that appears over that part
//   data-depth="px"      a parallax layer, shifted by up to that many pixels
//   data-develop="from to" a photo developing out of its drawing (or back)
// Real photos may be layered into a drawing only with their rights recorded
// (content/ledger/media.yaml, checked by the build); generated art needs no
// label. Calm mode shows every drawing finished and still.
import { windowed } from '../model';

const NS = 'http://www.w3.org/2000/svg';
type SvgAttrs = Record<string, string | number | undefined>;

export function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: SvgAttrs = {}, ...children: (SVGElement | null | undefined)[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) el.setAttribute(k, String(v));
  for (const c of children) if (c) el.append(c);
  return el;
}

/** A drawing: decorative, so hidden from screen readers (the text says what it shows). */
export function drawing(viewBox: string, cls: string, ...children: (SVGElement | null | undefined)[]): SVGSVGElement {
  return s('svg', { viewBox, class: `ink ${cls}`, 'aria-hidden': 'true', focusable: 'false', preserveAspectRatio: 'xMidYMid meet' }, ...children);
}

/** A small seeded random, so a drawing is the same on every visit. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A hand-drawn line through points: each point nudged a little, joined by soft curves. */
export function sketch(points: [number, number][], seed = 1, jitter = 1.2): string {
  const r = rng(seed);
  const p = points.map(([x, y]) => [x + (r() - 0.5) * jitter * 2, y + (r() - 0.5) * jitter * 2] as const);
  if (p.length < 2) return '';
  let d = `M${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)}`;
  for (let i = 1; i < p.length; i++) {
    const [x0, y0] = p[i - 1];
    const [x1, y1] = p[i];
    const mx = (x0 + x1) / 2 + (r() - 0.5) * jitter;
    const my = (y0 + y1) / 2 + (r() - 0.5) * jitter;
    d += ` Q${mx.toFixed(1)} ${my.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }
  return d;
}

/** A hand-drawn ellipse. */
export function loop(cx: number, cy: number, rx: number, ry = rx, seed = 1, jitter = 1): string {
  const pts: [number, number][] = [];
  const n = 18;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return sketch(pts, seed, jitter);
}

/** An inked stroke that draws itself between `from` and `to` of its scene's progress. */
export function ink(d: string, from = 0, to = 0.4, attrs: SvgAttrs = {}): SVGPathElement {
  return s('path', { d, pathLength: 1, class: 'ink-line', 'data-ink': `${from} ${to}`, ...attrs });
}

/** Parallel hatching inside a box: pencil shading. */
let clips = 0;
export function hatch(x: number, y: number, w: number, h: number, gap = 6, seed = 3, from = 0.2, to = 0.6): SVGGElement {
  const id = `ft-clip-${++clips}`;
  const g = s('g', { class: 'ink-hatch', 'data-fade': `${from} ${to}` }, s('clipPath', { id }, s('rect', { x, y, width: w, height: h })));
  const lines = s('g', { 'clip-path': `url(#${id})` });
  const r = rng(seed);
  for (let i = -h; i < w; i += gap) {
    lines.append(s('path', { d: sketch([[x + i, y + h], [x + i + h, y]], Math.floor(r() * 1e6), 0.6) }));
  }
  g.append(lines);
  return g;
}

/** A blot of ink that spreads when its scene is reached. */
export function blot(cx: number, cy: number, r: number, cls = ''): SVGCircleElement {
  return s('circle', { cx, cy, r, class: `ink-blot ${cls}`.trim() });
}

/** The filters every drawing shares: the boil and the soft edge of wet ink. */
export function inkDefs(): SVGSVGElement {
  return s(
    'svg',
    { class: 'ink-defs', width: 0, height: 0, 'aria-hidden': 'true', focusable: 'false' },
    s(
      'defs',
      {},
      s(
        'filter',
        { id: 'ft-boil', x: '-5%', y: '-5%', width: '110%', height: '110%' },
        s('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.03', numOctaves: 2, seed: 1, result: 'n' }),
        s('feDisplacementMap', { in: 'SourceGraphic', in2: 'n', scale: 2.4, xChannelSelector: 'R', yChannelSelector: 'G' }),
      ),
      s('filter', { id: 'ft-wet' }, s('feGaussianBlur', { stdDeviation: 0.35 })),
    ),
  );
}

/**
 * The line boils by changing the noise behind it a few times a second. It is
 * a tremble of the line, not a change of light; it still runs no faster
 * than three times a second, and not at all in calm mode or a hidden tab.
 */
export const BOIL_PER_SECOND = 3;

interface Parts {
  ink: [SVGGeometryElement, number, number][];
  fade: [Element & ElementCSSInlineStyle, number, number][];
  depth: [Element & ElementCSSInlineStyle, number][];
  develop: [Element & ElementCSSInlineStyle, number, number][];
}

const range = (v: string | undefined): [number, number] => {
  const [a, b] = (v ?? '0 1').split(/\s+/).map(Number);
  return [Number.isFinite(a) ? a : 0, Number.isFinite(b) ? b : 1];
};

export class LivingInk {
  private timer = 0;
  private seed = 1;
  private parts = new WeakMap<Element, Parts>();
  private turbulence: SVGElement | null;
  calm = false;

  constructor(defs: SVGSVGElement) {
    this.turbulence = defs.querySelector('feTurbulence');
    this.timer = window.setInterval(() => {
      if (this.calm || document.hidden) return;
      this.seed = (this.seed % 7) + 1;
      this.turbulence?.setAttribute('seed', String(this.seed));
    }, 1000 / BOIL_PER_SECOND);
  }

  private partsOf(scene: Element): Parts {
    let p = this.parts.get(scene);
    if (!p) {
      p = {
        ink: [...scene.querySelectorAll<SVGGeometryElement>('[data-ink]')].map((e) => [e, ...range(e.dataset.ink)]),
        fade: [...scene.querySelectorAll<HTMLElement>('[data-fade]')].map((e) => [e, ...range(e.dataset.fade)]),
        depth: [...scene.querySelectorAll<HTMLElement>('[data-depth]')].map((e) => [e, Number(e.dataset.depth) || 0]),
        develop: [...scene.querySelectorAll<HTMLElement>('[data-develop]')].map((e) => [e, ...range(e.dataset.develop)]),
      };
      this.parts.set(scene, p);
    }
    return p;
  }

  /** Forget a scene's parts after its drawing changed. */
  refresh(scene: Element): void {
    this.parts.delete(scene);
  }

  /** Draw a scene at progress `p` (calm: finished and still). */
  draw(scene: Element, p: number): void {
    const parts = this.partsOf(scene);
    const calm = this.calm;
    for (const [el, a, b] of parts.ink) el.style.strokeDashoffset = String(calm ? 0 : 1 - windowed(p, a, b));
    for (const [el, a, b] of parts.fade) el.style.opacity = String(calm ? 1 : windowed(p, a, b));
    for (const [el, d] of parts.depth) el.style.transform = calm ? '' : `translateY(${((0.5 - p) * d).toFixed(1)}px)`;
    for (const [el, a, b] of parts.develop) el.style.setProperty('--develop', String(calm ? 1 : windowed(p, a, b)));
  }

  dispose(): void {
    clearInterval(this.timer);
  }
}

/**
 * A photo developing out of its drawing: the drawing on top fades as the
 * photo comes up underneath. `photo` must be a file the build cleared
 * (a rights entry in the media ledger); without one, the drawing stays alone.
 */
export function develop(draw: SVGSVGElement, photo: { src: string; alt: string } | null, from = 0.3, to = 0.8): HTMLElement {
  const box = document.createElement('div');
  box.className = 'ink-develop';
  box.dataset.develop = `${from} ${to}`;
  if (photo) {
    const img = document.createElement('img');
    img.src = photo.src;
    img.alt = photo.alt;
    img.loading = 'lazy';
    img.decoding = 'async';
    box.append(img);
  }
  box.append(draw);
  return box;
}
