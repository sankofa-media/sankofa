// The decay drawn: the levels of ../engine/decay.ts turned into what the
// reader sees. The trip itself (melting, acid colour, mycelium, the tunnel)
// is ./trip-fx.ts; here: colour drifts, text gets an echo, the text lags
// behind the scroll and then falls
// after it (only the picture: the real scroll is never held or pushed, so
// the keyboard and the scroll bar always work), footnotes creep, the
// progress bar lies for a moment, a chapter in the menu is called something
// else for a moment, and in "The Red Telephone" someone is watching. All of
// it stops in calm mode, with reduced motion, and until the reader chose
// "as it is" at the door. Any flash goes through the FlashGate.
import { h } from '../../lib/dom';
import { decayEffects, Drag, lyingProgress, STILL, type DecayEffects } from '../engine/decay';
import { s } from '../engine/ink';
import { FlashGate } from '../model';
import { TripFx } from './trip-fx';
import type { Mood } from './trip';

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface DecayFxOptions {
  root: HTMLElement;
  scroller: HTMLElement;
  /** Whether calm mode is on right now. */
  calm(): boolean;
  /** The chapter menu's items, for a moment's false name. */
  names(): { el: HTMLElement; alias?: string }[];
  /** The progress bar to draw (it reports the truth to screen readers). */
  bar: HTMLElement;
}

export class DecayFx {
  level = 0;
  effects: DecayEffects = STILL;
  private chosen = false;
  mood: Mood = { dark: 0, warm: 0 };
  readonly trip: TripFx;
  private drag = new Drag(72);
  private lastTop: number;
  private raf = 0;
  private last = 0;
  private timers: number[] = [];
  private gate = new FlashGate(3, 1000);
  private frozenUntil = 0;
  private dragged: HTMLElement | null = null;
  private onScroll = () => {
    const top = this.o.scroller.scrollTop;
    const dy = top - this.lastTop;
    this.lastTop = top;
    if (this.active) {
      this.drag.push(dy, this.effects.drag);
      this.trip.scrolled(dy);
    }
    this.paintBar();
    this.loop();
  };

  constructor(private readonly o: DecayFxOptions) {
    this.lastTop = o.scroller.scrollTop;
    this.trip = new TripFx({ root: o.root, scroller: o.scroller });
    o.scroller.addEventListener('scroll', this.onScroll, { passive: true });
    // A false name in the menu, a lying bar, a ring of the red telephone.
    this.timers.push(window.setInterval(() => this.rename(), 3800));
    this.timers.push(window.setInterval(() => this.paintBar(), 400));
    this.timers.push(window.setInterval(() => this.ring(), 2200));
    this.paintBar();
  }

  /** The reader chose at the door: "as it is" lets the decay in. */
  choose(full: boolean): void {
    this.chosen = full;
    this.apply();
  }

  get active(): boolean {
    return this.chosen && !this.o.calm() && !reduced();
  }

  private get frozen(): boolean {
    return performance.now() < this.frozenUntil;
  }

  /** The record is turned over: everything stops for a moment. */
  freeze(ms = 1200): void {
    this.frozenUntil = performance.now() + ms;
    this.trip.hold(ms);
    this.o.root.dataset.frozen = '';
    this.drag.reset();
    this.paintDrag(0);
    window.setTimeout(() => {
      if (!this.frozen) delete this.o.root.dataset.frozen;
    }, ms + 20);
  }

  /** The level now (from the reader's place). */
  set(level: number, scene: HTMLElement | null, mood?: Mood): void {
    this.level = level;
    if (mood) this.mood = mood;
    if (scene !== this.dragged) {
      this.paintDrag(0);
      this.dragged = scene;
    }
    this.apply();
  }

  /** Calm mode or the system setting changed, or the level did. */
  apply(): void {
    const r = this.o.root;
    const on = this.active;
    this.effects = on ? decayEffects(this.level) : STILL;
    const e = this.effects;
    r.classList.toggle('fx-on', on && this.level > 0);
    r.classList.toggle('fx-creep', on && e.creep);
    r.classList.toggle('fx-watching', on && e.watching);
    r.style.setProperty('--decay', (on ? this.level : 0).toFixed(3));
    r.style.setProperty('--flow', e.flow.toFixed(3));
    r.style.setProperty('--drift', `${e.drift}deg`);
    r.style.setProperty('--echo', e.echo.toFixed(3));
    r.dataset.decay = String(Math.round((on ? this.level : 0) * 10));
    this.trip.set(on ? this.level : 0, this.mood, this.dragged, on);
    if (!on) {
      this.drag.reset();
      this.paintDrag(0);
      this.o.names().forEach((n) => this.unrename(n.el));
    }
    this.paintBar();
  }

  private loop(): void {
    if (this.raf) return;
    this.last = performance.now();
    const step = () => {
      const now = performance.now();
      const off = this.frozen ? 0 : this.drag.step((now - this.last) / 1000);
      this.last = now;
      this.paintDrag(off);
      this.raf = this.drag.resting ? 0 : requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  private paintDrag(off: number): void {
    const flow = this.dragged?.querySelector<HTMLElement>('.ft-flow');
    if (!flow) return;
    flow.style.transform = off ? `translate3d(0, ${off.toFixed(1)}px, 0)` : '';
  }

  /** The bar's place: the truth, or for a moment not. Screen readers always get the truth. */
  private paintBar(): void {
    const sc = this.o.scroller;
    const max = sc.scrollHeight - sc.clientHeight;
    const truth = max > 0 ? sc.scrollTop / max : 0;
    const shown = this.active && !this.frozen ? lyingProgress(truth, performance.now(), this.effects.lie) : truth;
    this.o.bar.style.setProperty('--shown', shown.toFixed(4));
    this.o.bar.setAttribute('aria-valuenow', String(Math.round(truth * 100)));
    this.o.bar.toggleAttribute('data-lying', Math.abs(shown - truth) > 0.01);
  }

  private rename(): void {
    if (!this.active || !this.effects.rename || this.frozen) return;
    const items = this.o.names().filter((n) => n.alias);
    if (!items.length) return;
    const n = items[Math.floor(Math.random() * items.length)];
    if (n.el.dataset.renamed !== undefined) return;
    n.el.dataset.name = n.el.textContent ?? '';
    n.el.dataset.renamed = '';
    n.el.textContent = n.alias!;
    window.setTimeout(() => this.unrename(n.el), 1300);
  }

  private unrename(el: HTMLElement): void {
    if (el.dataset.renamed === undefined) return;
    el.textContent = el.dataset.name ?? el.textContent;
    delete el.dataset.renamed;
  }

  /** The red telephone rings: a red pulse of the page, through the gate. */
  private ring(): void {
    if (!this.active || !this.effects.watching || this.frozen) return;
    if (!this.gate.allow(performance.now())) return;
    const r = this.o.root;
    r.classList.remove('fx-ring');
    void r.offsetWidth;
    r.classList.add('fx-ring');
  }

  dispose(): void {
    this.o.scroller.removeEventListener('scroll', this.onScroll);
    this.timers.forEach((t) => clearInterval(t));
    if (this.raf) cancelAnimationFrame(this.raf);
    this.trip.dispose();
  }
}

/** The eye that follows the reader in "The Red Telephone". */
export function watcher(text: string): { el: HTMLElement; follow(x: number, y: number): void } {
  const pupil = s('circle', { cx: 50, cy: 30, r: 9, class: 'fc-pupil' });
  const eye = s('svg', { viewBox: '0 0 100 60', class: 'fc-eye', 'aria-hidden': 'true' }, s('path', { d: 'M4 30C24 4 76 4 96 30C76 56 24 56 4 30Z', class: 'ink-line' }), pupil);
  const el = h('div.fc-watch', {}, eye as unknown as Node, h('p.fc-watch-tx', {}, text));
  return {
    el,
    follow(x, y) {
      const r = (eye as unknown as Element).getBoundingClientRect();
      if (!r.width) return;
      const dx = Math.max(-1, Math.min(1, (x - (r.left + r.width / 2)) / 300));
      const dy = Math.max(-1, Math.min(1, (y - (r.top + r.height / 2)) / 300));
      pupil.setAttribute('cx', String(50 + dx * 22));
      pupil.setAttribute('cy', String(30 + dy * 10));
    },
  };
}
