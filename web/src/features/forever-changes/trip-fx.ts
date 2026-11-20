// The trip drawn on the page: what ./trip.ts says, painted. Letters and
// pictures melt through animated SVG displacement with colour fringes; acid
// colour flows behind the page and over it; in the dark chapters mycelium
// grows in from the edges, spores drift and a vignette closes in; at the
// peak a kaleidoscope tunnel opens behind the text with an eye at its end,
// the page tilts and swims, and words swap places for a moment. Everything
// shown follows its target at a bounded speed, so nothing blinks; the frame
// budget lowers the resolution and the noise when frames drop; the loop
// stops when there is nothing to draw, when the tab is hidden, in calm mode
// and with reduced motion. It never touches the scroll position.
import { h } from '../../lib/dom';
import { s } from '../engine/ink';
import { FlashGate } from '../model';
import { AcidField, rasterise } from './acid';
import { Mycelium } from './mycelium';
import { CALM_LOOK, look, Quality, slew, SLEW, type Look, type Mood } from './trip';

export interface TripOptions {
  root: HTMLElement;
  scroller: HTMLElement;
}

type Shown = Pick<Look, 'acid' | 'overlay' | 'mycelium' | 'vignette' | 'warm' | 'tunnel' | 'warp' | 'trails' | 'breathe' | 'tilt'> & { dark: number; text: number; title: number; art: number; splitTitle: number; splitArt: number };

const ZERO: Shown = { acid: 0, overlay: 0, mycelium: 0, vignette: 0, warm: 0, tunnel: 0, warp: 0, trails: 0, breathe: 0, tilt: 0, dark: 0, text: 0, title: 0, art: 0, splitTitle: 0, splitArt: 0 };

export class TripFx {
  private field = new AcidField();
  private myc = new Mycelium();
  private over: HTMLCanvasElement;
  private og: CanvasRenderingContext2D | null;
  private vig: HTMLElement;
  private layers: HTMLElement[];
  private quality = new Quality();
  private target: Look = CALM_LOOK;
  private mood: Mood = { dark: 0, warm: 0 };
  private shown: Shown = { ...ZERO };
  private written = new Map<string, number>();
  private on = false;
  private raf = 0;
  private last = 0;
  private t0 = performance.now();
  private hue = 0;
  private vel = 0;
  private velShown = 0;
  private scene: HTMLElement | null = null;
  private picFor: HTMLElement | null = null;
  private pointer: [number, number] = [0, 0];
  private blinkUntil = 0;
  private nextBlink = 6;
  private gate = new FlashGate(3, 1000);
  private filterAt = 0;
  private filterTick = 0;
  private turb: { el: SVGElement; base: [number, number]; amp: [number, number]; speed: number; art: boolean }[] = [];
  private maps: { el: SVGElement; key: 'text' | 'title' | 'art' }[] = [];
  private splits: { el: SVGElement; key: 'splitTitle' | 'splitArt'; sign: number }[] = [];
  private swapTimer = 0;
  private holdUntil = 0;
  private swapped: HTMLElement[] = [];
  /** Frames drawn and the frame rate the budget sees (for the page's own report). */
  frames = 0;

  constructor(private readonly o: TripOptions) {
    this.over = document.createElement('canvas');
    this.og = this.over.getContext('2d');
    this.field.canvas.className = 'fc-trip-back';
    this.myc.canvas.className = 'fc-trip-myc';
    this.over.className = 'fc-trip-over';
    this.vig = h('div.fc-trip-vig');
    for (const el of [this.field.canvas, this.myc.canvas, this.over]) el.setAttribute('aria-hidden', 'true');
    this.vig.setAttribute('aria-hidden', 'true');
    this.layers = [this.field.canvas, this.myc.canvas, this.over, this.vig];
    // Behind the pictures; over the pictures and under the text; over everything (blended).
    o.root.prepend(this.field.canvas);
    o.root.append(this.myc.canvas, this.over, this.vig);
    this.show(false);
    o.root.dataset.tripGl = this.field.kind;
    o.root.append(this.filters());
    window.addEventListener('resize', this.fit);
    document.addEventListener('visibilitychange', this.wake);
    o.scroller.addEventListener('pointermove', this.look, { passive: true });
    this.fit();
  }

  // ---------- the SVG filters: melting with colour fringes ----------
  private filters(): SVGSVGElement {
    let art = false;
    const turb = (freq: [number, number], amp: [number, number], speed: number, seed: number, result: string, octaves = 2) => {
      const el = s('feTurbulence', { type: 'fractalNoise', baseFrequency: `${freq[0]} ${freq[1]}`, numOctaves: octaves, seed, result });
      this.turb.push({ el, base: freq, amp, speed, art });
      return el;
    };
    // One colour channel of an image; noise gets a solid alpha so the map is read as it is.
    const only = (input: string, ch: 'r' | 'g' | 'b', result: string, solid = false) => {
      const rows = { r: '1 0 0 0 0 0 0 0 0 0 0 0 0 0 0', g: '0 0 0 0 0 0 1 0 0 0 0 0 0 0 0', b: '0 0 0 0 0 0 0 0 0 0 0 0 1 0 0' }[ch];
      return s('feColorMatrix', { in: input, type: 'matrix', values: `${rows} ${solid ? '0 0 0 0 1' : '0 0 0 1 0'}`, result });
    };
    const sum = (a: string, b: string, result?: string) => s('feComposite', { in: a, in2: b, operator: 'arithmetic', k1: 0, k2: 1, k3: 1, k4: 0, ...(result ? { result } : {}) });
    const map = (key: 'text' | 'title' | 'art', input: string, result?: string) => {
      const el = s('feDisplacementMap', { in: 'SourceGraphic', in2: input, scale: 0, xChannelSelector: 'R', yChannelSelector: 'G', ...(result ? { result } : {}) });
      this.maps.push({ el, key });
      return el;
    };
    const offset = (key: 'splitTitle' | 'splitArt', input: string, sign: number, result: string) => {
      const el = s('feOffset', { in: input, dx: 0, dy: 0, result });
      this.splits.push({ el, key, sign });
      return el;
    };
    // Drips: a noise that changes fast across and slowly down, pulled one way only, so things run downward.
    const drip = (freq: [number, number], seed: number, key: 'title' | 'art', splitKey: 'splitTitle' | 'splitArt') => [
      turb(freq, [freq[0] * 0.25, freq[1] * 0.5], 0.21, seed, 'drip', 1),
      s('feComponentTransfer', { in: 'drip', result: 'dripG' }, s('feFuncR', { type: 'discrete', tableValues: '0' }), s('feFuncG', { type: 'table', tableValues: '0.5 0.5 0.42 0.08' }), s('feFuncB', { type: 'discrete', tableValues: '0' })),
      turb([freq[0] * 0.22, freq[1] * 6], [freq[0] * 0.08, freq[1] * 2], 0.17, seed + 5, 'wob', 1),
      only('wob', 'r', 'wobR', true),
      only('dripG', 'g', 'dripGG', true),
      sum('wobR', 'dripGG', 'map'),
      map(key, 'map', 'melt'),
      only('melt', 'r', 'r'),
      offset(splitKey, 'r', 1, 'r2'),
      only('melt', 'b', 'b'),
      offset(splitKey, 'b', -1, 'b2'),
      only('melt', 'g', 'g'),
      sum('r2', 'g', 'rg'),
      sum('rg', 'b2'),
    ];
    const filter = (id: string, ...kids: SVGElement[]) => s('filter', { id, x: '-6%', y: '-30%', width: '112%', height: '170%', 'color-interpolation-filters': 'sRGB' }, ...kids);
    const soft = filter('fc-flow-soft', turb([0.008, 0.03], [0.002, 0.01], 0.13, 3, 'n'), map('text', 'n'));
    const strong = filter('fc-flow-strong', ...drip([0.05, 0.004], 7, 'title', 'splitTitle'));
    art = true;
    const pic = filter('fc-melt-art', ...drip([0.022, 0.003], 17, 'art', 'splitArt'));
    return s('svg', { class: 'ink-defs', width: 0, height: 0, 'aria-hidden': 'true', focusable: 'false' }, s('defs', {}, soft, strong, pic));
  }

  // ---------- inputs ----------
  /** The level and mood now, and the chapter they belong to. `on` is false in calm mode, with reduced motion and before the door. */
  set(level: number, mood: Mood, scene: HTMLElement | null, on: boolean): void {
    this.on = on;
    this.mood = mood;
    this.target = on ? look(level, mood) : CALM_LOOK;
    if (scene !== this.scene) {
      this.unswap();
      this.scene?.style.removeProperty('--vel');
      this.scene = scene;
    }
    this.o.root.classList.toggle('fx-trip', on);
    this.o.root.classList.toggle('fx-swim', on && this.target.tilt > 0.05);
    if (on && this.target.tunnel > 0 && scene && scene !== this.picFor) {
      this.picFor = scene;
      void rasterise(scene.querySelector('.ft-stage')).then((c) => this.field.picture(c));
    }
    if (!on) this.stillNow();
    else this.start();
  }

  /** The record is turned over: the picture stands still for a moment (it does not go dark). */
  hold(ms: number): void {
    this.holdUntil = performance.now() + ms;
  }

  /** The page scrolled by `dy`: the echoes trail behind. */
  scrolled(dy: number): void {
    if (!this.on) return;
    this.vel = Math.max(-1, Math.min(1, this.vel + dy / 60));
    this.start();
  }

  private look = (e: PointerEvent) => {
    this.pointer = [Math.max(-1, Math.min(1, (e.clientX / innerWidth) * 2 - 1)), Math.max(-1, Math.min(1, (e.clientY / innerHeight) * 2 - 1))];
  };

  private fit = () => {
    const q = this.quality.scale;
    this.field.resize(innerWidth * q, innerHeight * q);
    this.over.width = this.field.w;
    this.over.height = this.field.h;
    const m = Math.min(1, q * 2) * Math.min(1.5, devicePixelRatio || 1);
    this.myc.resize(innerWidth * m, innerHeight * m);
  };

  private wake = () => {
    if (!document.hidden) this.start();
  };

  // ---------- the loop ----------
  private start(): void {
    if (this.raf || document.hidden) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  /**
   * How much of the picture's melt to apply: none until the chapter's picture has loaded (a melting
   * placeholder reads as a picture that failed), and on a narrow picture proportionally less, so a
   * phone sees the same distortion of a recognisable picture as a wide screen, not a smear.
   */
  private artFit(): number {
    const art = this.scene?.querySelector<HTMLElement>('.ft-stage .ft-art');
    if (!art) return 0;
    const imgs = [...art.querySelectorAll<HTMLImageElement>('img')].filter((i) => i.getAttribute('src'));
    if (!imgs.length || imgs.some((i) => !i.complete || !i.naturalWidth)) return 0;
    return Math.min(1, Math.max(0.3, art.clientWidth / 860));
  }

  private get resting(): boolean {
    const t = this.target;
    const sh = this.shown;
    const idle = (Object.keys(sh) as (keyof Shown)[]).every((k) => Math.abs(sh[k] - this.goal(k, t)) < 1e-4);
    return idle && t.acid === 0 && t.mycelium === 0 && Math.abs(this.velShown) < 0.01;
  }

  private goal(k: keyof Shown, t: Look): number {
    switch (k) {
      case 'dark':
        return this.on ? this.mood.dark * (t.acid > 0 ? 1 : 0) : 0;
      case 'text':
        return t.melt.text;
      case 'title':
        return t.melt.title;
      case 'art':
        return t.melt.art;
      case 'splitTitle':
        return t.split.title;
      case 'splitArt':
        return t.split.art;
      default:
        return t[k];
    }
  }

  private frame = (now: number) => {
    this.raf = 0;
    if (document.hidden) return;
    if (now < this.holdUntil) {
      this.last = now;
      this.raf = requestAnimationFrame(this.frame);
      return;
    }
    const dt = Math.min(0.1, (now - this.last) / 1000);
    if (this.quality.frame(now - this.last)) {
      this.fit();
      this.o.root.dataset.tripQ = String(this.quality.step);
    }
    this.last = now;
    const t = (now - this.t0) / 1000;
    const tg = this.target;
    const sh = this.shown;
    for (const k of Object.keys(sh) as (keyof Shown)[]) {
      const rate = k === 'text' || k === 'title' || k === 'art' || k === 'splitTitle' || k === 'splitArt' ? SLEW.melt : SLEW.opacity;
      sh[k] = slew(sh[k], this.goal(k, tg), dt, rate);
    }
    this.hue = (this.hue + tg.hueSpeed * dt) % 1;
    this.vel *= Math.pow(0.04, dt);
    this.velShown += (this.vel - this.velShown) * Math.min(1, dt * 10);
    this.paint(t, dt, now);
    if (++this.frames % 60 === 0) this.o.root.dataset.tripFps = String(Math.round(this.quality.fps));
    // With nothing to show and nothing moving, the loop sleeps until the reader moves on.
    if (!this.resting) this.raf = requestAnimationFrame(this.frame);
  };

  private paint(t: number, dt: number, now: number): void {
    const sh = this.shown;
    const visible = sh.acid > 0.002 || sh.mycelium > 0.002;
    this.show(visible || sh.vignette >= 0.002);
    if (sh.acid > 0.002) {
      // A slow blink of the eye at the end of the tunnel (through the gate: it is a change of light).
      if (t > this.nextBlink && sh.tunnel > 0.3 && this.gate.allow(now)) {
        this.blinkUntil = t + 0.45;
        this.nextBlink = t + 5 + ((t * 7.31) % 4);
      }
      const blink = t < this.blinkUntil ? Math.abs(Math.sin(((this.blinkUntil - t) / 0.45) * Math.PI)) : 0;
      const open = (0.75 + 0.2 * Math.sin(t * 0.37)) * (1 - 0.92 * blink);
      this.field.draw({ time: t, hue: this.hue, warp: sh.warp, dark: sh.dark, warm: sh.warm, tunnel: sh.tunnel, octaves: this.quality.octaves, eye: [this.pointer[0], this.pointer[1], open] });
      if (this.og && sh.overlay > 0.002) {
        const g = this.og;
        g.setTransform(-1, 0, 0, 1, this.over.width, 0);
        g.drawImage(this.field.canvas, 0, 0);
        g.setTransform(1, 0, 0, 1, 0, 0);
      }
    }
    if (sh.mycelium > 0.002 || this.myc.canvas.dataset.drawn) {
      this.myc.draw(sh.mycelium, t, dt);
      if (sh.mycelium > 0.002) this.myc.canvas.dataset.drawn = '1';
      else delete this.myc.canvas.dataset.drawn;
    }
    this.css(this.field.canvas, 'opacity', sh.acid);
    this.css(this.over, 'opacity', sh.overlay);
    this.css(this.vig, 'opacity', sh.vignette);
    this.css(this.o.root, '--trip-warm', sh.warm, 0.02);
    this.css(this.o.root, '--trip-dark', sh.dark, 0.02);
    this.css(this.o.root, '--breathe', sh.breathe, 0.0008);
    this.css(this.o.root, '--tilt', sh.tilt, 0.03);
    this.css(this.o.root, '--trails', sh.trails, 0.02);
    this.css(this.o.root, '--split', sh.splitTitle, 0.1);
    if (this.scene) this.css(this.scene, '--vel', this.velShown, 0.02);
    // The melt changes shape continuously: thirty times a second at best, fewer when frames are short
    // (it boils, like a hand-drawn film on twos); the pictures, the costliest, half as often.
    const every = [33, 50, 90, 140][this.quality.step];
    if (now - this.filterAt > every) {
      this.filterAt = now;
      this.filterTick++;
      for (const f of this.turb) {
        if (f.art && this.filterTick % 2) continue;
        const fx = f.base[0] + f.amp[0] * Math.sin(t * f.speed * 2.1) * Math.min(1, sh.warp * 2);
        const fy = f.base[1] + f.amp[1] * Math.sin(t * f.speed * 1.3 + 1) * Math.min(1, sh.warp * 2);
        const v = `${fx.toFixed(4)} ${fy.toFixed(4)}`;
        if (f.el.getAttribute('baseFrequency') !== v) f.el.setAttribute('baseFrequency', v);
      }
      const art = this.artFit();
      for (const m of this.maps) this.attr(m.el, 'scale', m.key === 'art' ? sh.art * art : sh[m.key]);
      for (const sp of this.splits) this.attr(sp.el, 'dx', (sp.key === 'splitArt' ? sh.splitArt * art : sh[sp.key]) * sp.sign);
    }
    // Words swap places for a moment at the peak.
    if (this.target.swap && this.on && !this.swapTimer) this.swapTimer = window.setTimeout(() => this.swap(), 2600);
  }

  private shownLayers: boolean | null = null;
  private show(on: boolean): void {
    if (on === this.shownLayers) return;
    this.shownLayers = on;
    for (const l of this.layers) l.hidden = !on;
  }

  private css(el: HTMLElement, prop: string, v: number, eps = 0.003): void {
    const key = `${prop}@${el === this.o.root ? 'root' : el === this.scene ? 'scene' : el.className}`;
    const prev = this.written.get(key);
    if (prev !== undefined && Math.abs(prev - v) < eps && !(v === 0 && prev !== 0)) return;
    this.written.set(key, v);
    if (prop.startsWith('--')) el.style.setProperty(prop, v.toFixed(4));
    else el.style.setProperty(prop, v.toFixed(3));
  }

  private attr(el: SVGElement, name: string, v: number): void {
    const s = v.toFixed(2);
    if (el.getAttribute(name) !== s) el.setAttribute(name, s);
  }

  // ---------- words that trade places ----------
  private swap(): void {
    this.swapTimer = 0;
    if (!this.on || !this.target.swap || !this.scene || document.hidden) return;
    const vh = innerHeight;
    const paras = [...this.scene.querySelectorAll<HTMLElement>('.ft-flow .ft-block.on p')].filter((p) => {
      const r = p.getBoundingClientRect();
      return r.bottom > vh * 0.15 && r.top < vh * 0.85;
    });
    const p = paras[Math.floor(Math.random() * paras.length)];
    const nodes = p ? [...p.childNodes].filter((n): n is Text => n instanceof Text && /\S+\s+\S+\s+\S+/.test(n.data)) : [];
    const node = nodes[Math.floor(Math.random() * nodes.length)];
    if (!node) return;
    const words = [...node.data.matchAll(/\S{3,}/g)];
    if (words.length < 3) return;
    const i = Math.floor(Math.random() * (words.length - 1));
    const j = Math.min(words.length - 1, i + 1 + Math.floor(Math.random() * 3));
    const wrap = (m: RegExpMatchArray, n: Text): HTMLElement => {
      const r = document.createRange();
      r.setStart(n, m.index!);
      r.setEnd(n, m.index! + m[0].length);
      const span = h('span.fc-swap');
      r.surroundContents(span);
      return span;
    };
    // The later word first, so the earlier offsets stay right.
    const b = wrap(words[j], node);
    const a = wrap(words[i], node);
    this.swapped.push(a, b);
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    a.style.setProperty('--sx', `${rb.left - ra.left + (rb.width - ra.width) / 2}px`);
    a.style.setProperty('--sy', `${rb.top - ra.top}px`);
    b.style.setProperty('--sx', `${ra.left - rb.left + (ra.width - rb.width) / 2}px`);
    b.style.setProperty('--sy', `${ra.top - rb.top}px`);
    requestAnimationFrame(() => {
      a.classList.add('away');
      b.classList.add('away');
    });
    window.setTimeout(() => {
      a.classList.remove('away');
      b.classList.remove('away');
      window.setTimeout(() => this.unswap(), 900);
    }, 1700);
  }

  /** Every swapped word back in its text, as it was. */
  private unswap(): void {
    for (const el of this.swapped) {
      const parent = el.parentNode;
      if (!parent) continue;
      el.replaceWith(...el.childNodes);
      parent.normalize();
    }
    this.swapped = [];
  }

  private stillNow(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    clearTimeout(this.swapTimer);
    this.swapTimer = 0;
    this.unswap();
    this.shown = { ...ZERO };
    this.vel = this.velShown = 0;
    this.show(false);
    for (const m of this.maps) this.attr(m.el, 'scale', 0);
    for (const sp of this.splits) this.attr(sp.el, 'dx', 0);
    for (const p of ['--trip-warm', '--trip-dark', '--breathe', '--tilt', '--trails', '--split']) this.o.root.style.removeProperty(p);
    this.scene?.style.removeProperty('--vel');
    this.written.clear();
    this.myc.draw(0, 0, 0);
    delete this.myc.canvas.dataset.drawn;
  }

  /** For the page's own checks: what is drawn now. */
  stats(): { fps: number; step: number; frames: number; kind: string; acid: number; mycelium: number; tunnel: number } {
    return { fps: Math.round(this.quality.fps), step: this.quality.step, frames: this.frames, kind: this.field.kind, acid: this.shown.acid, mycelium: this.shown.mycelium, tunnel: this.shown.tunnel };
  }

  dispose(): void {
    this.stillNow();
    window.removeEventListener('resize', this.fit);
    document.removeEventListener('visibilitychange', this.wake);
    this.o.scroller.removeEventListener('pointermove', this.look);
    this.field.dispose();
    this.layers.forEach((l) => l.remove());
  }
}
