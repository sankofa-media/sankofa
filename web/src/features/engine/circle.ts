// The reader's clap circle: every tap (or the space bar) leaves a drop of ink
// on a ring, at the place in the bar where the clap fell. The circle lives
// through the whole feature, large in the scene where the reader first claps
// and small in the corner after, and its claps come back in the finale.
import { h } from '../../lib/dom';
import { clapAngle, FlashGate } from '../model';
import { s } from './ink';

export interface Drop {
  /** Degrees round the ring, 0 at the top. */
  angle: number;
}

const MAX = 96;

export class ClapCircle {
  readonly el: HTMLButtonElement;
  private ring: SVGGElement;
  private count: HTMLElement;
  private drops: Drop[] = [];
  private gate = new FlashGate(3, 1000);
  onClap?: () => void;

  constructor(
    private readonly key: string,
    private readonly label: string,
    private readonly countText: (n: number) => string,
  ) {
    this.ring = s('g', { class: 'cc-drops' });
    const svg = s(
      'svg',
      { viewBox: '-60 -60 120 120', class: 'cc-svg', 'aria-hidden': 'true', focusable: 'false' },
      s('circle', { r: 44, class: 'cc-ring' }),
      s('circle', { r: 44, class: 'cc-ring cc-ring-2' }),
      // The beats: two and four are the claps.
      ...[0, 90, 180, 270].map((a) => s('circle', { cx: 44 * Math.sin((a * Math.PI) / 180), cy: -44 * Math.cos((a * Math.PI) / 180), r: a % 180 ? 3.4 : 2, class: `cc-beat${a % 180 ? ' on' : ''}`, 'data-beat': a / 90 })),
      this.ring,
    );
    this.count = h('span.cc-count', { 'aria-live': 'polite' });
    this.el = h('button.cc', { type: 'button', 'aria-label': label, hidden: true }, svg, this.count) as HTMLButtonElement;
    this.el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.onClap?.();
    });
    // The keyboard's Enter arrives as a click with no pointer (Space is caught earlier, by the kit).
    this.el.addEventListener('click', (e) => {
      if (e.detail === 0) this.onClap?.();
    });
    this.restore();
    this.paint();
  }

  get claps(): readonly Drop[] {
    return this.drops;
  }

  /** Leave a drop: at its place in the bar when the bed keeps time, else a quarter round from the last. */
  add(time?: { now: number; start: number; beat: number }): Drop {
    const angle = time ? clapAngle(time.now - time.start, time.beat) : ((this.drops.length * 90) % 360) + ((this.drops.length * 37) % 20) - 10;
    const d = { angle: Math.round(angle * 10) / 10 };
    this.drops.push(d);
    if (this.drops.length > MAX) this.drops.shift();
    this.store();
    this.paint(true);
    return d;
  }

  /** Large on its stage, or small in the corner. */
  setPlace(place: 'hidden' | 'stage' | 'corner'): void {
    this.el.hidden = place === 'hidden';
    this.el.dataset.place = place;
  }

  /** The beat being played, for the running dots. */
  pulse(beat: number): void {
    this.el.dataset.beat = String(beat % 4);
  }

  private paint(fresh = false): void {
    this.ring.replaceChildren(
      ...this.drops.map((d, i) => {
        const a = (d.angle * Math.PI) / 180;
        const r = 44 + ((i * 7) % 9) - 4;
        return s('circle', { cx: (r * Math.sin(a)).toFixed(1), cy: (-r * Math.cos(a)).toFixed(1), r: 2.6 + ((i * 3) % 4) * 0.5, class: 'cc-drop' });
      }),
    );
    this.count.textContent = this.drops.length ? this.countText(this.drops.length) : this.label;
    this.el.setAttribute('aria-label', this.drops.length ? `${this.label}. ${this.countText(this.drops.length)}` : this.label);
    // A new drop may glow, but never more than three times a second.
    if (fresh && this.gate.allow(performance.now())) {
      this.el.classList.remove('flash');
      void this.el.offsetWidth;
      this.el.classList.add('flash');
    }
  }

  private store(): void {
    try {
      sessionStorage.setItem(this.key, JSON.stringify(this.drops.map((d) => d.angle)));
    } catch {
      /* the drops live as long as the page */
    }
  }

  private restore(): void {
    try {
      const v = JSON.parse(sessionStorage.getItem(this.key) ?? '[]');
      if (Array.isArray(v)) this.drops = v.filter((x) => typeof x === 'number').slice(-MAX).map((angle) => ({ angle }));
    } catch {
      this.drops = [];
    }
  }
}
