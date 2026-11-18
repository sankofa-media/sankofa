// The opening's one white line: an oscilloscope trace across the empty room
// that swells under the reader's finger or cursor, like a speaker cone
// moving with a bass note. It draws only while the first scene is on
// screen; reduced motion leaves it a still, straight line.
import { h } from '../../lib/dom';

export class Oscilloscope {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private raf = 0;
  private x = -1;
  private y = -1;
  private energy = 0;
  private running = false;
  private readonly onMove = (e: PointerEvent) => {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width) return;
    this.x = (e.clientX - r.left) / r.width;
    this.y = (e.clientY - r.top) / r.height;
    // Closer to the line, more energy; it fades when the hand is still.
    const near = Math.max(0, 1 - Math.abs(this.y - 0.5) * 2.2);
    this.energy = Math.min(1, this.energy + 0.25 * near + (e.pointerType === 'touch' ? 0.2 : 0));
  };

  constructor(private readonly calm: () => boolean) {
    this.canvas = h('canvas.an-scope-canvas', { 'aria-hidden': 'true' }) as HTMLCanvasElement;
    this.el = h('div.an-scope', { 'aria-hidden': 'true' }, this.canvas);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    window.addEventListener('pointermove', this.onMove, { passive: true });
    window.addEventListener('pointerdown', this.onMove, { passive: true });
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  stop(): void {
    this.running = false;
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerdown', this.onMove);
    cancelAnimationFrame(this.raf);
  }

  private frame(t: number): void {
    if (!this.running) return;
    const c = this.canvas;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.round(c.clientWidth * dpr);
    const hh = Math.round(c.clientHeight * dpr);
    if (w && hh && (c.width !== w || c.height !== hh)) {
      c.width = w;
      c.height = hh;
    }
    const g = c.getContext('2d');
    if (g && w && hh) {
      g.clearRect(0, 0, w, hh);
      g.strokeStyle = 'rgba(240, 240, 236, 0.92)';
      g.lineWidth = 1.4 * dpr;
      g.shadowColor = 'rgba(255, 255, 255, 0.6)';
      g.shadowBlur = 6 * dpr;
      g.beginPath();
      const still = this.calm();
      const s = t / 1000;
      for (let i = 0; i <= 160; i++) {
        const u = i / 160;
        let dy = 0;
        if (!still) {
          // A low idle breath, and a swell around the hand: a slow bass wave (~55 Hz drawn as a few slow cycles).
          const idle = 0.004 * Math.sin(u * 9 + s * 1.7);
          const bump = this.x >= 0 ? Math.exp(-((u - this.x) ** 2) / 0.006) : 0;
          dy = idle + this.energy * bump * 0.09 * Math.sin(u * 60 - s * 14);
        }
        const y = (0.5 + dy) * hh;
        if (i === 0) g.moveTo(0, y);
        else g.lineTo(u * w, y);
      }
      g.stroke();
    }
    this.energy *= 0.965;
    this.raf = requestAnimationFrame((tt) => this.frame(tt));
  }

  dispose(): void {
    this.stop();
  }
}
