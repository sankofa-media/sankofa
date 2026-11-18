// The mood of the whole page, driven by one number, the anxiety (./mood.ts):
// the light metronome, the sticky line (the title as a watermark that
// multiplies on the edges and narrows the reading column, joined at the
// breakdown by readers' words), type that trembles on a fast scroll, a
// scroll that grows heavy towards the breakdown, figures that stand at the
// edge of the screen for a moment, and a progress bar that never reaches
// the end. Reduced motion keeps the light still, the type steady, the
// scroll ordinary and the figures away; the narrowing stays, gently.
import { h } from '../../lib/dom';
import { shownProgress, squeeze, stickyCount, tremble, viscosity } from './mood';

export interface MoodOptions {
  root: HTMLElement;
  scroller: HTMLElement;
  bar: HTMLElement;
  title: string;
  calm(): boolean;
  /** Pictures of figures that may stand at the edge of the screen. */
  watchers: { src: string; alt: string }[];
  /** Where the reading ends (the tail after it is not counted). */
  end(): number;
}

const MAX_COPIES = 18;
const MAX_WORDS = 10;
/** Scenes where someone may stand at the edge of the screen (the end of act II, the start of act III). */
const WATCHED = new Set(['voice', 'strata', 'break']);

export class MoodFx {
  readonly wall: HTMLElement;
  private copies: HTMLElement[] = [];
  private wordEls: HTMLElement[] = [];
  private watcherBox: HTMLElement;
  private anxiety = 0;
  private scene = '';
  private shake = 0;
  private raf = 0;
  private lastY = 0;
  private lastT = 0;
  private watchTimer = 0;
  private disposers: (() => void)[] = [];

  constructor(private readonly o: MoodOptions) {
    // Copy 0 is the watermark in the middle; the rest stick to the edges, deterministically placed.
    for (let k = 0; k < MAX_COPIES; k++) {
      const side = k === 0 ? 'mid' : k % 2 ? 'left' : 'right';
      const top = k === 0 ? 42 : 4 + ((k * 53) % 88);
      const size = k === 0 ? 0 : 14 + ((k * 7) % 26);
      const tilt = k === 0 ? 0 : ((k * 13) % 9) - 4;
      const inset = ((k * 29) % 5) * 1.4;
      this.copies.push(h(`span.an-copy.an-${side}`, { 'aria-hidden': 'true', style: `top:${top}%;--fs:${size}px;--tilt:${tilt}deg;--in:${inset}vw;--k:${k}` }, o.title));
    }
    this.wall = h('div.an-wall', { 'aria-hidden': 'true' }, ...this.copies);
    this.watcherBox = h('div.an-watchers', { 'aria-hidden': 'true' });
    o.root.append(h('div.an-beat', { 'aria-hidden': 'true' }), this.wall, this.watcherBox);

    const onScroll = () => this.scrolled();
    const onWheel = (e: WheelEvent) => this.wheel(e);
    o.scroller.addEventListener('scroll', onScroll, { passive: true });
    o.scroller.addEventListener('wheel', onWheel, { passive: false });
    this.disposers.push(() => {
      o.scroller.removeEventListener('scroll', onScroll);
      o.scroller.removeEventListener('wheel', onWheel);
    });
    this.scheduleWatcher();
  }

  /** Readers' words join the wall at the breakdown. */
  setWords(words: string[]): void {
    this.wordEls.forEach((e) => e.remove());
    this.wordEls = words.slice(0, MAX_WORDS).map((w, k) => {
      const side = k % 2 ? 'right' : 'left';
      return h(`span.an-copy.an-word.an-${side}`, { 'aria-hidden': 'true', style: `top:${10 + ((k * 37) % 80)}%;--fs:${13 + ((k * 5) % 9)}px;--tilt:${((k * 11) % 7) - 3}deg;--in:${1 + ((k * 3) % 4)}vw` }, w);
    });
    this.wall.append(...this.wordEls);
    this.paint();
  }

  /** The reader is at `anxiety` in scene `scene`. */
  set(anxiety: number, scene: string): void {
    this.anxiety = anxiety;
    this.scene = scene;
    this.paint();
  }

  private paint(): void {
    const a = this.anxiety;
    const r = this.o.root;
    r.style.setProperty('--an-anx', a.toFixed(3));
    r.style.setProperty('--an-squeeze', squeeze(a).toFixed(3));
    const n = stickyCount(a, MAX_COPIES);
    this.copies.forEach((c, k) => c.classList.toggle('on', k < n));
    // Words come only near the peak, more of them the higher it is.
    const w = a < 0.8 ? 0 : Math.ceil(((a - 0.8) / 0.2) * this.wordEls.length);
    this.wordEls.forEach((e, k) => e.classList.toggle('on', k < w));
    this.progress();
  }

  /** The bar: how far through the reading, never to the end. */
  progress(): void {
    const sc = this.o.scroller;
    const max = Math.max(1, this.o.end() - sc.clientHeight);
    const truth = sc.scrollTop / max;
    const shown = shownProgress(truth);
    this.o.bar.style.setProperty('--shown', shown.toFixed(4));
    this.o.bar.setAttribute('aria-valuenow', String(Math.round(shown * 100)));
  }

  private scrolled(): void {
    this.progress();
    const now = performance.now();
    const y = this.o.scroller.scrollTop;
    const dt = now - this.lastT;
    if (this.lastT && dt > 0 && dt < 200 && !this.o.calm()) {
      const speed = ((y - this.lastY) / dt) * 1000;
      this.shake = Math.max(this.shake, tremble(speed, this.anxiety));
      if (this.shake > 0.02 && !this.raf) this.raf = requestAnimationFrame(() => this.tremor());
    }
    this.lastY = y;
    this.lastT = now;
  }

  private tremor(): void {
    this.raf = 0;
    const r = this.o.root;
    if (this.o.calm()) this.shake = 0;
    this.shake *= 0.88;
    if (this.shake < 0.02) {
      this.shake = 0;
      r.style.setProperty('--an-shake', '0');
      r.style.setProperty('--an-jx', '0');
      return;
    }
    r.style.setProperty('--an-shake', this.shake.toFixed(3));
    r.style.setProperty('--an-jx', (Math.random() * 2 - 1).toFixed(2));
    this.raf = requestAnimationFrame(() => this.tremor());
  }

  /** A heavier scroll towards the breakdown: a wheel step moves the page less (never less than about half). */
  private wheel(e: WheelEvent): void {
    if (this.o.calm() || e.ctrlKey || e.metaKey || this.anxiety < 0.05) return;
    const t = e.target as Element | null;
    if (t?.closest('textarea, input, select, [contenteditable], .an-pulse')) return;
    const k = viscosity(this.anxiety);
    if (k >= 0.999) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.o.scroller.clientHeight : 1;
    this.o.scroller.scrollTop += e.deltaY * unit * k;
  }

  // ---------- someone behind you ----------

  private scheduleWatcher(): void {
    clearTimeout(this.watchTimer);
    this.watchTimer = window.setTimeout(() => {
      this.maybeWatcher();
      this.scheduleWatcher();
    }, 7000 + Math.random() * 6000);
  }

  private maybeWatcher(): void {
    if (this.o.calm() || document.hidden || !WATCHED.has(this.scene) || !this.o.watchers.length) return;
    if (this.watcherBox.childElementCount) return;
    const pic = this.o.watchers[Math.floor(Math.random() * this.o.watchers.length)];
    // On a wide screen the text is on the left: the figure stands at the right edge; on a phone at either.
    const side = innerWidth > 720 || Math.random() < 0.5 ? 'right' : 'left';
    const img = h('img.an-watcher', { src: pic.src, alt: '', decoding: 'async', draggable: 'false', 'data-side': side });
    img.addEventListener('animationend', () => img.remove());
    this.watcherBox.append(img);
  }

  dispose(): void {
    clearTimeout(this.watchTimer);
    if (this.raf) cancelAnimationFrame(this.raf);
    this.disposers.forEach((d) => d());
  }
}
