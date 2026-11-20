// Scroll-driven scenes. An IntersectionObserver says which scenes are near
// the screen; on every frame the reader scrolls, each of those gets its
// progress (0..1) as the CSS variable --p and through `onProgress`, and the
// scene under the reading line becomes the current one. Text blocks reveal
// once, when they come into view. Pictures load ahead of their scene: an
// <img data-src> gets its src when the scene two places before it comes
// near, not with the page and not at the last moment (a slow phone network
// must have the picture ready when the scene arrives). A scene counts as
// reached as soon as its top comes on screen, so its picture is drawn in
// while it arrives, not after the text has already slid over it.
import { sceneAt, sceneProgress } from '../model';

export interface ScrollerOptions {
  /** The scrolling element (the feature's sheet). */
  root: HTMLElement;
  scenes: HTMLElement[];
  onProgress?(scene: HTMLElement, p: number): void;
  onCurrent?(scene: HTMLElement, index: number): void;
}

/** Give a scene's waiting pictures their files. */
export function load(scene: Element): void {
  scene.querySelectorAll<HTMLImageElement>('img[data-src]').forEach((img) => {
    img.src = img.dataset.src!;
    delete img.dataset.src;
  });
}

/** How many scenes ahead of the one coming near load their pictures. */
const AHEAD = 2;

export class Scroller {
  private near = new Set<HTMLElement>();
  private io: IntersectionObserver;
  private reveal: IntersectionObserver;
  private raf = 0;
  private current = -1;
  private readonly onScroll = () => (this.raf ||= requestAnimationFrame(() => this.tick()));
  /** While set, the current scene is not reported (a jump to a scene is under way). */
  private quietUntil = 0;

  constructor(private readonly o: ScrollerOptions) {
    this.io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const el = e.target as HTMLElement;
          if (e.isIntersecting) {
            this.near.add(el);
            this.loadAround(el);
          } else {
            this.near.delete(el);
            // A scene that has left settles at its end or its start.
            const p = e.boundingClientRect.top < 0 ? 1 : 0;
            this.set(el, p);
          }
        }
        this.onScroll();
      },
      { root: o.root, rootMargin: '25% 0px 25% 0px' },
    );
    this.reveal = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add('on');
          this.reveal.unobserve(e.target);
        }
      },
      { root: o.root, rootMargin: '0px 0px -10% 0px', threshold: 0.15 },
    );
    for (const s of o.scenes) {
      this.io.observe(s);
      s.querySelectorAll('.ft-block').forEach((b) => this.reveal.observe(b));
    }
    // The opening scenes load at once.
    o.scenes.slice(0, AHEAD + 1).forEach(load);
    o.root.addEventListener('scroll', this.onScroll, { passive: true });
    window.addEventListener('resize', this.onScroll);
    this.onScroll();
  }

  /** Load a scene's pictures and those of the scenes after it. */
  private loadAround(el: HTMLElement): void {
    const i = this.o.scenes.indexOf(el);
    for (let k = Math.max(0, i); k <= i + AHEAD && k < this.o.scenes.length; k++) load(this.o.scenes[k]);
  }

  private set(el: HTMLElement, p: number): void {
    const prev = Number(el.dataset.p ?? -1);
    if (Math.abs(prev - p) < 0.0005) return;
    el.dataset.p = p.toFixed(4);
    el.style.setProperty('--p', p.toFixed(4));
    this.o.onProgress?.(el, p);
  }

  private tick(): void {
    this.raf = 0;
    const vh = this.o.root.clientHeight;
    const top0 = this.o.root.getBoundingClientRect().top;
    for (const el of this.near) {
      const r = el.getBoundingClientRect();
      this.set(el, sceneProgress(r.top - top0, r.height, vh));
      if (r.top - top0 < vh * 0.9) el.classList.add('reached');
    }
    const rects = this.o.scenes.map((s) => {
      const r = s.getBoundingClientRect();
      return { top: r.top - top0, height: r.height };
    });
    const i = sceneAt(rects, vh);
    if (i !== this.current && i >= 0) {
      if (this.current >= 0) this.o.scenes[this.current].classList.remove('current');
      this.current = i;
      const el = this.o.scenes[i];
      el.classList.add('current', 'reached');
      // Everything above the current scene has been reached too.
      for (let k = 0; k < i; k++) this.o.scenes[k].classList.add('reached');
      if (performance.now() >= this.quietUntil) this.o.onCurrent?.(el, i);
    }
  }

  /** Bring a scene to the top of the screen. */
  goTo(el: HTMLElement, smooth: boolean): void {
    const top = el.getBoundingClientRect().top - this.o.root.getBoundingClientRect().top + this.o.root.scrollTop;
    this.quietUntil = smooth ? 0 : performance.now() + 50;
    this.o.root.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
    // Reveal what a jump skipped over: a reader arriving by link sees the text at once.
    el.querySelectorAll('.ft-block').forEach((b) => b.classList.add('on'));
    this.onScroll();
  }

  /** Reveal every block now (calm mode shows text without waiting). */
  revealAll(): void {
    for (const s of this.o.scenes) s.querySelectorAll('.ft-block').forEach((b) => b.classList.add('on'));
  }

  currentScene(): HTMLElement | undefined {
    return this.o.scenes[this.current];
  }

  dispose(): void {
    this.io.disconnect();
    this.reveal.disconnect();
    this.o.root.removeEventListener('scroll', this.onScroll);
    window.removeEventListener('resize', this.onScroll);
    if (this.raf) cancelAnimationFrame(this.raf);
  }
}
