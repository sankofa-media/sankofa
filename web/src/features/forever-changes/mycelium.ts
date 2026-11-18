// The mushroom side of the page: mycelium growing in from the edges of the
// screen, branching as it goes, in near-black, bruise purple and bile green,
// with caps swelling at some tips and spores drifting up through the light.
// It grows with the darkness of the chapter and draws back when the dark
// recedes. The tree is grown once per screen size (seeded, so it is the same
// tree every time) and drawn up to how far it has grown; only the spores move
// every frame.
import { rng } from './lee/scheduler';

export interface Segment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** How far along its growth this segment appears (0..1). */
  birth: number;
  width: number;
  depth: number;
}

export interface Cap {
  x: number;
  y: number;
  r: number;
  birth: number;
}

/** Grow the tendrils for a screen of `w`×`h`: roots along all four edges, reaching at most `reach` of the short side. */
export function grow(w: number, h: number, seed = 1967, reach = 0.42): { segments: Segment[]; caps: Cap[] } {
  const rand = rng(seed);
  const segments: Segment[] = [];
  const caps: Cap[] = [];
  const short = Math.min(w, h);
  const per = Math.max(90, short * 0.2);
  const roots: { x: number; y: number; a: number }[] = [];
  for (let x = rand() * per; x < w; x += per * (0.6 + rand() * 0.8)) {
    roots.push({ x, y: -4, a: Math.PI / 2 });
    roots.push({ x: w - x, y: h + 4, a: -Math.PI / 2 });
  }
  for (let y = rand() * per; y < h; y += per * (0.6 + rand() * 0.8)) {
    roots.push({ x: -4, y, a: 0 });
    roots.push({ x: w + 4, y: h - y, a: Math.PI });
  }
  const limit = 9000;
  const branch = (x: number, y: number, a: number, len: number, start: number, total: number, width: number, depth: number) => {
    let d = 0;
    while (d < len && segments.length < limit) {
      const step = 5 + rand() * 7;
      a += (rand() - 0.5) * 0.7;
      const nx = x + Math.cos(a) * step;
      const ny = y + Math.sin(a) * step;
      const birth = (start + d) / total;
      segments.push({ x0: x, y0: y, x1: nx, y1: ny, birth, width: Math.max(0.4, width * (1 - d / len) ** 1.1), depth });
      x = nx;
      y = ny;
      d += step;
      if (depth < 5 && rand() < 0.11 - depth * 0.012) {
        const side = rand() < 0.5 ? -1 : 1;
        branch(x, y, a + side * (0.5 + rand() * 0.7), (len - d) * (0.45 + rand() * 0.4), start + d, total, width * 0.7, depth + 1);
      }
    }
    if (rand() < 0.3) caps.push({ x, y, r: 2.5 + rand() * (depth < 2 ? 7 : 4), birth: Math.min(1, (start + d) / total) });
  };
  for (const r of roots) {
    const len = short * reach * (0.45 + rand() * 0.55);
    branch(r.x, r.y, r.a + (rand() - 0.5) * 0.6, len, 0, short * reach, 3 + rand() * 4, 0);
  }
  return { segments, caps };
}

interface Spore {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hue: number;
  phase: number;
}

export class Mycelium {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D | null;
  private cache: HTMLCanvasElement;
  private cg: CanvasRenderingContext2D | null;
  private tree: ReturnType<typeof grow> = { segments: [], caps: [] };
  private drawnAt = -1;
  private paintedT = -1;
  private spores: Spore[] = [];
  private rand = rng(73);
  private w = 0;
  private h = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.g = this.canvas.getContext('2d');
    this.cache = document.createElement('canvas');
    this.cg = this.cache.getContext('2d');
  }

  resize(w: number, h: number): void {
    w = Math.round(w);
    h = Math.round(h);
    if (w === this.w && h === this.h) return;
    this.w = this.canvas.width = this.cache.width = w;
    this.h = this.canvas.height = this.cache.height = h;
    this.tree = grow(w, h);
    this.drawnAt = -1;
    this.paintedT = -1;
    this.spores = [];
  }

  /** Draw the tree grown to `growth` (0..1) and the spores, at `t` seconds. */
  draw(growth: number, t: number, dt: number): void {
    const g = this.g;
    if (!g) return;
    const { w, h } = this;
    g.clearRect(0, 0, w, h);
    if (growth <= 0.001) return;
    if (Math.abs(growth - this.drawnAt) > 0.006 && t - this.paintedT > 0.09) {
      this.paintedT = t;
      this.paintTree(growth);
    }
    // The whole growth breathes a little, toward the middle and back.
    const s = 1 + 0.012 * Math.sin(t * 0.8);
    g.setTransform(s, 0, 0, s, (w * (1 - s)) / 2, (h * (1 - s)) / 2);
    g.drawImage(this.cache, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    this.drawSpores(growth, t, dt);
  }

  private paintTree(growth: number): void {
    const g = this.cg;
    if (!g) return;
    this.drawnAt = growth;
    g.clearRect(0, 0, this.w, this.h);
    g.lineCap = 'round';
    // A dark body first, then the bruised colour, then the bile at the young tips.
    const passes: [string, number, (s: Segment) => boolean][] = [
      ['rgba(120, 30, 150, 0.16)', 5, () => true],
      ['rgba(4, 0, 8, 0.95)', 2, () => true],
      ['rgba(118, 34, 140, 0.95)', 1, () => true],
      ['rgba(176, 210, 30, 0.9)', 0.45, (s) => s.birth > growth - 0.22 || s.depth >= 3],
    ];
    for (const [colour, k, pick] of passes) {
      // One path per line width: a few strokes instead of thousands.
      const paths = new Map<number, Path2D>();
      for (const sg of this.tree.segments) {
        if (sg.birth > growth || !pick(sg)) continue;
        const wk = Math.max(1, Math.round(sg.width * k * 2));
        let p = paths.get(wk);
        if (!p) paths.set(wk, (p = new Path2D()));
        p.moveTo(sg.x0, sg.y0);
        p.lineTo(sg.x1, sg.y1);
      }
      g.strokeStyle = colour;
      for (const [wk, p] of paths) {
        g.lineWidth = wk / 2;
        g.stroke(p);
      }
    }
    for (const c of this.tree.caps) {
      if (c.birth > growth) continue;
      const r = c.r * Math.min(1, (growth - c.birth) * 6 + 0.3);
      const grad = g.createRadialGradient(c.x, c.y, 0, c.x, c.y, r * 2.4);
      grad.addColorStop(0, 'rgba(190, 210, 40, 0.9)');
      grad.addColorStop(0.35, 'rgba(110, 30, 130, 0.75)');
      grad.addColorStop(1, 'rgba(10, 0, 14, 0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(c.x, c.y, r * 2.4, 0, Math.PI * 2);
      g.fill();
    }
  }

  private drawSpores(growth: number, t: number, dt: number): void {
    const g = this.g!;
    const want = Math.round(140 * growth);
    while (this.spores.length < want) {
      const r = this.rand;
      this.spores.push({ x: r() * this.w, y: r() * this.h, vx: (r() - 0.5) * 8, vy: -6 - r() * 14, r: 1.2 + r() * 4, hue: r() < 0.5 ? 285 : 72, phase: r() * 6.28 });
    }
    this.spores.length = Math.min(this.spores.length, want);
    const step = Math.min(0.05, dt);
    for (const sp of this.spores) {
      sp.x += (sp.vx + Math.sin(t * 0.6 + sp.phase) * 10) * step;
      sp.y += sp.vy * step;
      if (sp.y < -10) sp.y = this.h + 10;
      if (sp.x < -10) sp.x = this.w + 10;
      if (sp.x > this.w + 10) sp.x = -10;
      const a = (0.45 + 0.4 * Math.sin(t * 0.9 + sp.phase)) * Math.min(1, growth * 1.5);
      g.fillStyle = `hsla(${sp.hue}, 90%, ${sp.hue > 200 ? 62 : 55}%, ${(a * 0.22).toFixed(3)})`;
      g.beginPath();
      g.arc(sp.x, sp.y, sp.r * 3.2, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = `hsla(${sp.hue}, 90%, ${sp.hue > 200 ? 70 : 62}%, ${a.toFixed(3)})`;
      g.beginPath();
      g.arc(sp.x, sp.y, sp.r, 0, Math.PI * 2);
      g.fill();
    }
  }
}
