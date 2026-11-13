// Smaller copies of images, made at build time (scripts/build-data.sh writes
// media/w<width>/<file> and data/media.json). Without them, the originals.
import type { App } from '../app';

interface Manifest {
  /** file → widths of the variants that exist, ascending */
  files?: Record<string, number[]>;
  /** file → width of the original */
  sizes?: Record<string, number>;
  /** width / height of each image */
  ratios?: Record<string, number>;
  /** files that also come as WebP next to every copy */
  webp?: string[];
  /** average colour of each image, #rrggbb: its frame's colour while it loads */
  colours?: Record<string, string>;
}

let variants: Record<string, number[]> = {};
let sizes: Record<string, number> = {};
let webp = new Set<string>();
let ratios: Record<string, number> = {};
let colours: Record<string, string> = {};

export async function loadMediaManifest(): Promise<void> {
  try {
    const r = await fetch('data/media.json');
    if (!r.ok) return;
    const m = (await r.json()) as Manifest;
    variants = m.files ?? {};
    sizes = m.sizes ?? {};
    webp = new Set(m.webp ?? []);
    ratios = m.ratios ?? {};
    colours = m.colours ?? {};
  } catch {
    /* no variants: the originals are used */
  }
}

/** For tests. */
export function setVariants(v: Record<string, number[]>, s: Record<string, number> = {}, w: string[] = [], c: Record<string, string> = {}): void {
  variants = v;
  sizes = s;
  webp = new Set(w);
  colours = c;
}

/** The image's average colour, when the build measured it. */
export function colourOf(file: string): string | undefined {
  return colours[file];
}

/** The URL of the smallest copy: what a placeholder or a preview loads. */
export function smallSrc(app: Pick<App, 'media'>, file: string): string {
  const small = variants[file]?.[0];
  return small ? served(`media/w${small}/${file}`, file) : served(app.media(file), file);
}

const preloaded = new Set<string>();
/**
 * Ask the browser for an image ahead of the reader, with the same srcset and
 * sizes the <img> will use, so the request is the one the page then needs.
 */
export function preloadImage(app: Pick<App, 'media'>, file: string, want: number, sizesAttr: string): void {
  const key = `${file} ${sizesAttr}`;
  if (preloaded.has(key) || typeof document === 'undefined') return;
  preloaded.add(key);
  const src = mediaSrc(app, file, [want]);
  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'image';
  link.href = src.src;
  if (src.srcset) {
    link.setAttribute('imagesrcset', src.srcset);
    link.setAttribute('imagesizes', sizesAttr);
  }
  link.dataset.preload = file;
  document.head.append(link);
}

/** The served name of a copy: WebP when the build made one. */
function served(path: string, file: string): string {
  return webp.has(file) ? path.replace(/\.(jpe?g|png)$/i, '.webp') : path;
}

/** Width of the original, when the build measured it. */
export function naturalWidth(file: string): number | undefined {
  return sizes[file];
}

/**
 * src and srcset for an image: the smallest variant that covers `want[0]` as
 * src, every variant plus the original in srcset. Never larger than the
 * source, so nothing is upscaled by us.
 */
export function mediaSrc(app: Pick<App, 'media'>, file: string, want: number[] = [960]): { src: string; srcset?: string } {
  const have = variants[file] ?? [];
  const orig = served(app.media(file), file);
  if (!have.length) return { src: orig };
  const pickW = have.find((w) => w >= want[0]) ?? have[have.length - 1];
  const origW = sizes[file] ?? have[have.length - 1] * 2;
  const srcset = [...have.map((w) => `${served(`media/w${w}/${file}`, file)} ${w}w`), `${orig} ${origW}w`].join(', ');
  return { src: served(`media/w${pickW}/${file}`, file), srcset };
}

/**
 * A picture that is never an empty frame: a small copy shows first, softly
 * blurred, and the full one replaces it once loaded. `ready` resolves when
 * something is on screen. With `near`, loading starts only when the element
 * comes within a few screens.
 */
export function progressive(
  app: Pick<App, 'media'>,
  file: string,
  opts: { want?: number; sizes?: string; alt?: string; cls?: string; near?: boolean; margin?: string; priority?: 'high' | 'low' } = {},
): { img: HTMLImageElement; ready: Promise<void>; start: () => void } {
  const img = document.createElement('img');
  img.alt = opts.alt ?? '';
  // Reserve the picture's shape before it loads: nothing below it jumps.
  if (ratios[file]) img.style.aspectRatio = String(ratios[file]);
  img.decoding = 'async';
  // Until the picture arrives its frame wears the picture's own colour.
  if (colours[file]) img.style.backgroundColor = colours[file];
  if (opts.priority) img.setAttribute('fetchpriority', opts.priority);
  if (opts.cls) img.className = opts.cls;
  const small = variants[file]?.[0];
  const full = mediaSrc(app, file, [opts.want ?? 960]);
  let resolve!: () => void;
  const ready = new Promise<void>((r) => (resolve = r));
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    if (small && full.srcset) {
      img.classList.add('lq');
      img.src = served(`media/w${small}/${file}`, file);
      img.decode().then(resolve, resolve);
      const hi = new Image();
      hi.decoding = 'async';
      if (opts.priority) hi.setAttribute('fetchpriority', opts.priority);
      if (opts.sizes) hi.sizes = opts.sizes;
      hi.srcset = full.srcset;
      hi.src = full.src;
      hi.decode().then(
        () => {
          if (opts.sizes) img.sizes = opts.sizes;
          img.srcset = full.srcset!;
          img.src = full.src;
          img.classList.remove('lq');
          img.style.backgroundColor = '';
          resolve();
        },
        () => img.classList.remove('lq'),
      );
    } else {
      if (opts.sizes && full.srcset) {
        img.sizes = opts.sizes;
        img.srcset = full.srcset;
      }
      img.src = full.src;
      img.decode().then(resolve, resolve);
    }
  };
  if (opts.near && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (es) => {
        if (!es.some((e) => e.isIntersecting)) return;
        io.disconnect();
        start();
      },
      { rootMargin: opts.margin ?? '250% 0px' },
    );
    queueMicrotask(() => io.observe(img));
  } else start();
  return { img, ready, start };
}
