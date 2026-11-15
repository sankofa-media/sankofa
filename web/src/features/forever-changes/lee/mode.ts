// The Arthur Lee mode: the reader's own room through his eyes. On a phone,
// after a warning and the camera permission, the camera picture runs
// through shaders on the device (see ./gl.ts); things that are not there
// appear at the edge of the frame and melt when the phone turns to them,
// faces surface in the patterns, the current chapter's objects come into
// the room, and the longer it runs the stronger it gets. Without a camera
// (or on a computer) the same runs over a still picture. Nothing is sent
// anywhere: there is no network call in this file. The way out is always on
// the screen, and Escape works too.
import { h } from '../../../lib/dom';
import { FlashGate } from '../../model';
import { vision } from '../art';
import { Shader, stillRoom } from './gl';
import { facing, intensity, movedToward, Scheduler, type Vision } from './scheduler';

export interface LeeChapter {
  id: string;
  name: string;
  visions: string[];
  /** The chapter's colour, 0..1 around the hue circle. */
  hue: number;
}

export interface LeeOptions {
  /** Where the mode draws itself (it covers the screen). */
  host: HTMLElement;
  say(key: string, vars?: Record<string, string>): string;
  /** A phone: the camera is offered. */
  phone: boolean;
  onClose?(): void;
}

type Source = 'camera' | 'still';

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class LeeMode {
  readonly el: HTMLElement;
  private warn: HTMLElement;
  private view: HTMLElement;
  private canvas: HTMLCanvasElement;
  private video: HTMLVideoElement;
  private layer: HTMLElement;
  private live: HTMLElement;
  private now: HTMLElement;
  private chapter: LeeChapter | null = null;
  private shader: Shader | null = null;
  private stream: MediaStream | null = null;
  private still: HTMLCanvasElement | null = null;
  private raf = 0;
  private timers: number[] = [];
  private t0 = 0;
  private scheduler: Scheduler | null = null;
  private shown = new Map<Vision, { el: HTMLElement; target?: number }>();
  private heading: number | null = null;
  private diff = { left: 0, right: 0 };
  private lastFrame: Float32Array | null = null;
  private sampler: CanvasRenderingContext2D | null = null;
  private gate = new FlashGate(3, 1000);
  private returnTo: Element | null = null;
  private off: (() => void)[] = [];

  constructor(private readonly o: LeeOptions) {
    const say = o.say;
    this.now = h('p.fc-lee-now');
    const camBtn = o.phone && !!navigator.mediaDevices?.getUserMedia ? (h('button.btn.primary.fc-lee-camera', { type: 'button' }, say('lee-start-camera')) as HTMLButtonElement) : null;
    camBtn?.addEventListener('click', () => void this.start('camera'));
    const stillBtn = h(`button.btn${camBtn ? '' : '.primary'}.fc-lee-still`, { type: 'button' }, say('lee-start-still')) as HTMLButtonElement;
    stillBtn.addEventListener('click', () => void this.start('still'));
    this.warn = h(
      'div.fc-lee-warn',
      {},
      h('h2.fc-lee-title', {}, say('lee-warning-title')),
      h('p', {}, say('lee-warning-text')),
      h('p.fc-lee-privacy', {}, say('lee-privacy')),
      h('p.fc-lee-atmos', {}, say('lee-atmosphere')),
      o.phone ? h('p.fc-lee-motion', {}, say('lee-motion')) : null,
      this.now,
      h('div.fc-lee-go', {}, camBtn, stillBtn),
    );
    this.canvas = h('canvas.fc-lee-canvas', { 'aria-hidden': 'true' }) as HTMLCanvasElement;
    this.video = h('video.fc-lee-video', { muted: '', playsinline: '', 'aria-hidden': 'true' }) as HTMLVideoElement;
    this.video.muted = true;
    this.video.playsInline = true;
    this.layer = h('div.fc-lee-layer', { 'aria-hidden': 'true' });
    this.live = h('p.ft-visually-hidden.fc-lee-live', { 'aria-live': 'polite' });
    this.view = h('div.fc-lee-view', { hidden: true }, this.video, this.canvas, this.layer, h('p.fc-lee-note'), this.live);
    const exit = h('button.btn.fc-lee-exit', { type: 'button' }, h('span', { 'aria-hidden': 'true' }, '×'), say('lee-exit'));
    exit.addEventListener('click', () => this.close());
    this.el = h('div.fc-lee', { role: 'dialog', 'aria-modal': 'true', 'aria-label': say('lee-open'), hidden: true, tabindex: '-1' }, this.view, this.warn, exit);
    this.el.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      // The mode closes, not the whole feature behind it.
      e.stopPropagation();
      e.preventDefault();
      this.close();
    });
    this.layer.addEventListener('pointerdown', (e) => {
      const v = this.visionAt(e.target as Element);
      if (v) this.melt(v);
    });
    o.host.append(this.el);
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  /** Open at a chapter: the warning first, nothing starts before the reader says so. */
  open(ch: LeeChapter): void {
    this.setChapter(ch);
    if (this.isOpen) return;
    this.returnTo = document.activeElement;
    this.el.hidden = false;
    this.el.dataset.state = 'warning';
    this.warn.hidden = false;
    this.view.hidden = true;
    document.body.classList.add('fc-lee-on');
    (this.warn.querySelector('button') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  setChapter(ch: LeeChapter): void {
    this.chapter = ch;
    this.el.dataset.chapter = ch.id;
    this.now.textContent = this.o.say('lee-chapter', { title: ch.name });
    this.view.querySelector('.fc-lee-note')!.textContent = this.o.say('lee-chapter', { title: ch.name });
    this.scheduler?.setObjects(ch.visions);
  }

  private async start(want: Source): Promise<void> {
    let source: Source = want;
    if (want === 'camera') {
      // Both asks start inside the reader's tap (iOS wants that for the motion sensors).
      const DOE = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
      const motion = typeof DOE?.requestPermission === 'function' ? DOE.requestPermission().catch(() => 'denied') : Promise.resolve('granted');
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        this.video.srcObject = this.stream;
        await this.video.play().catch(() => undefined);
      } catch {
        source = 'still';
        this.view.querySelector('.fc-lee-note')!.textContent = this.o.say('lee-denied');
      }
      if ((await motion) === 'granted') this.listenMotion();
    }
    if (!this.isOpen) return this.stopCamera();
    if (source === 'still') this.still = stillRoom();
    this.run(source);
  }

  private listenMotion(): void {
    const on = (e: DeviceOrientationEvent) => {
      const compass = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
      // A compass heading grows clockwise, alpha counter-clockwise: keep one sense (counter-clockwise).
      this.heading = typeof compass === 'number' ? 360 - compass : e.alpha;
    };
    window.addEventListener('deviceorientation', on);
    this.off.push(() => window.removeEventListener('deviceorientation', on));
  }

  private run(source: Source): void {
    this.el.dataset.state = 'running';
    this.el.dataset.source = source;
    this.warn.hidden = true;
    this.view.hidden = false;
    (this.el.querySelector('.fc-lee-exit') as HTMLElement).focus({ preventScroll: true });
    this.shader = Shader.create(this.canvas);
    this.el.classList.toggle('no-gl', !this.shader);
    if (!this.shader && this.still) this.view.prepend(Object.assign(this.still, { className: 'fc-lee-still-img' }));
    if (this.shader) this.shader.mirror = false;
    this.scheduler = new Scheduler(this.chapter?.visions ?? [], hashSeed(this.chapter?.id ?? 'lee'));
    this.t0 = performance.now();
    const fit = () => {
      const scale = Math.min(1, 900 / Math.max(innerWidth, innerHeight));
      this.shader?.resize(innerWidth * scale * Math.min(2, devicePixelRatio || 1) * 0.6, innerHeight * scale * Math.min(2, devicePixelRatio || 1) * 0.6);
    };
    fit();
    window.addEventListener('resize', fit);
    this.off.push(() => window.removeEventListener('resize', fit));
    if (this.still && this.shader) this.shader.upload(this.still, this.still.width, this.still.height);
    const frame = () => {
      this.raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      const t = (performance.now() - this.t0) / 1000;
      const level = intensity(t);
      this.el.style.setProperty('--lee', level.toFixed(3));
      if (this.shader) {
        if (this.stream && this.video.readyState >= 2) this.shader.upload(this.video, this.video.videoWidth, this.video.videoHeight);
        this.shader.draw(t, { intensity: level, kaleidoscope: smooth(0.35, 1, level) * 0.85, hue: ((this.chapter?.hue ?? 0) + t * 0.002) % 1 });
      }
    };
    this.raf = requestAnimationFrame(frame);
    // The visions: a few times a second is plenty.
    this.timers.push(window.setInterval(() => this.visions(), 250));
    if (this.stream) this.timers.push(window.setInterval(() => this.sample(), 250));
    const near = (e: PointerEvent) => this.near(e.clientX, e.clientY);
    this.el.addEventListener('pointermove', near);
    this.off.push(() => this.el.removeEventListener('pointermove', near));
  }

  private visions(): void {
    if (!this.scheduler) return;
    const t = (performance.now() - this.t0) / 1000;
    for (const v of this.scheduler.tick(t)) this.show(v);
    const alive = new Set(this.scheduler.active(t));
    for (const [v, s] of this.shown) {
      if (!alive.has(v)) this.remove(v, false);
      else if (v.kind === 'figure') {
        const turned = s.target !== undefined && this.heading !== null && facing(this.heading, s.target);
        if (turned || (this.stream && movedToward(v.x < 0 ? -1 : 1, this.diff))) this.melt(v);
      }
    }
    // The ringing telephone: its light pulses, never more than three times a second.
    for (const [v, s] of this.shown) if (v.object === 'telephone' && this.gate.allow(performance.now())) s.el.classList.toggle('ring');
  }

  private show(v: Vision): void {
    let el: HTMLElement;
    if (v.kind === 'object' && v.object) {
      const art = vision(v.object, 'fc-vision ink');
      el = h('div.fc-lee-vision', { 'data-kind': 'object', 'data-object': v.object, style: `left:${v.x * 100}%;top:${v.y * 100}%` }, art);
      this.live.textContent = this.o.say(`vision-${v.object}`);
    } else if (v.kind === 'face') {
      el = h('div.fc-lee-vision', { 'data-kind': 'face', style: `left:${v.x * 100}%;top:${v.y * 100}%` }, face());
    } else if (v.kind === 'behind') {
      el = h('div.fc-lee-vision', { 'data-kind': 'behind', 'data-side': v.x < 0 ? 'left' : 'right' }, h('span.fc-lee-shadow'), h('p.fc-lee-whisper', {}, this.o.say('lee-behind')));
    } else {
      el = h('div.fc-lee-vision', { 'data-kind': 'figure', 'data-side': v.x < 0 ? 'left' : 'right', style: `top:${v.y * 100}%` }, inkFigure());
    }
    // Every drawn line is finished at once: there is no scroll here to draw it.
    el.querySelectorAll<SVGPathElement>('[data-ink]').forEach((p) => (p.style.strokeDashoffset = '0'));
    this.layer.append(el);
    this.shown.set(v, { el, target: v.kind === 'figure' && this.heading !== null ? this.heading - (v.x < 0 ? -1 : 1) * 35 : undefined });
  }

  private visionAt(t: Element): Vision | undefined {
    const el = t.closest('.fc-lee-vision');
    for (const [v, s] of this.shown) if (s.el === el) return v;
    return undefined;
  }

  /** The pointer came close to a figure (a computer has no compass): it melts. */
  private near(x: number, y: number): void {
    for (const [v, s] of this.shown) {
      if (v.kind !== 'figure') continue;
      const r = s.el.getBoundingClientRect();
      const dx = Math.max(r.left - x, 0, x - r.right);
      const dy = Math.max(r.top - y, 0, y - r.bottom);
      if (Math.hypot(dx, dy) < Math.min(innerWidth, innerHeight) * 0.12) this.melt(v);
    }
  }

  /** It melts away when looked at. */
  melt(v: Vision): void {
    this.scheduler?.melt(v);
    this.remove(v, true);
  }

  private remove(v: Vision, melt: boolean): void {
    const s = this.shown.get(v);
    if (!s) return;
    this.shown.delete(v);
    s.el.classList.add(melt ? 'melt' : 'gone');
    window.setTimeout(() => s.el.remove(), 1400);
  }

  /** How much the camera picture changed on each side since the last look. */
  private sample(): void {
    if (this.video.readyState < 2) return;
    if (!this.sampler) {
      const c = document.createElement('canvas');
      c.width = 32;
      c.height = 18;
      this.sampler = c.getContext('2d', { willReadFrequently: true });
    }
    const g = this.sampler;
    if (!g) return;
    g.drawImage(this.video, 0, 0, 32, 18);
    const px = g.getImageData(0, 0, 32, 18).data;
    const lum = new Float32Array(32 * 18);
    for (let i = 0; i < lum.length; i++) lum[i] = (px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114) / 255;
    if (this.lastFrame) {
      let l = 0;
      let r = 0;
      for (let y = 0; y < 18; y++)
        for (let x = 0; x < 32; x++) {
          const d = Math.abs(lum[y * 32 + x] - this.lastFrame[y * 32 + x]);
          if (x < 11) l += d;
          else if (x >= 21) r += d;
        }
      this.diff = { left: l / (11 * 18), right: r / (11 * 18) };
    }
    this.lastFrame = lum;
  }

  private stopCamera(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  close(): void {
    if (!this.isOpen) return;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.timers.forEach((t) => clearInterval(t));
    this.timers = [];
    this.off.forEach((f) => f());
    this.off = [];
    this.stopCamera();
    this.shader?.dispose();
    this.shader = null;
    this.scheduler = null;
    this.shown.clear();
    this.layer.replaceChildren();
    this.view.querySelector('.fc-lee-still-img')?.remove();
    this.still = null;
    this.lastFrame = null;
    this.heading = null;
    this.el.hidden = true;
    delete this.el.dataset.state;
    delete this.el.dataset.source;
    document.body.classList.remove('fc-lee-on');
    if (this.returnTo instanceof HTMLElement && this.returnTo.isConnected) this.returnTo.focus({ preventScroll: true });
    this.o.onClose?.();
  }

  dispose(): void {
    this.close();
    this.el.remove();
  }
}

function hashSeed(s: string): number {
  let x = 2166136261;
  for (const c of s) x = Math.imul(x ^ c.charCodeAt(0), 16777619);
  return x >>> 0;
}

/** A tall ink figure, the kind seen from the corner of the eye. */
function inkFigure(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 300');
  svg.setAttribute('class', 'fc-figure');
  svg.innerHTML =
    '<path class="ink-line" d="M50 20c-12 0-18 10-18 22s8 22 18 22 18-10 18-22-6-22-18-22z"/>' +
    '<path class="ink-line fc-figure-body" d="M50 64c-20 20-26 70-22 120s8 90 6 110M50 64c20 20 26 70 22 120s-8 90-6 110"/>' +
    '<path class="ink-line" d="M34 110c-12 30-14 60-10 86M66 110c12 30 14 60 10 86"/>';
  return svg;
}

/** A face in the pattern: two eyes and a mouth, barely there. */
function face(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('class', 'fc-face');
  svg.innerHTML =
    '<path class="ink-line" d="M30 46c6-8 18-8 24 0M66 46c6-8 18-8 24 0"/>' +
    '<circle class="fc-face-eye" cx="42" cy="50" r="4"/><circle class="fc-face-eye" cx="78" cy="50" r="4"/>' +
    '<path class="ink-line" d="M38 86c14 10 30 10 44 0"/>';
  return svg;
}
