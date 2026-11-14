// Where the reader is in the story, kept across a rebuild (language or copy
// switch). The place is the step being read, not a depth in the chapter: the
// two languages (and the two copies) tell a chapter at different lengths, so
// "60% down chapter four" lands on another paragraph, or another chapter.
// The step goes into the link (ch=v4&step=2); the finer offset inside it stays
// in this tab only.

const KEY = 'sankofa.place';

export interface Place {
  ch: string;
  /** the step whose stretch holds the middle of the screen; -1 is the chapter's opening above its first step */
  step: number;
  /** how far into that stretch the middle of the screen is, 0..1 */
  off: number;
}

/**
 * The stretches of a chapter, top to bottom: from the chapter's top to its
 * first step, then from each step's top to the next one's, the last one to
 * the chapter's bottom. Together they cover the chapter with no gaps, so any
 * point in it belongs to exactly one, whatever the margins between steps.
 */
function stretches(el: HTMLElement): { step: number; top: number; bottom: number }[] {
  const r = el.getBoundingClientRect();
  const tops = [...el.querySelectorAll<HTMLElement>('.step[data-step]')].map((s) => ({ step: Number(s.dataset.step), top: s.getBoundingClientRect().top }));
  const marks = [{ step: -1, top: r.top }, ...tops];
  return marks.map((m, i) => ({ step: m.step, top: m.top, bottom: i + 1 < marks.length ? marks[i + 1].top : r.bottom }));
}

/** The chapter at the middle of the screen and the reader's step in it. */
export function placeNow(): Place | undefined {
  const mid = window.innerHeight / 2;
  for (const el of document.querySelectorAll<HTMLElement>('article.chapter')) {
    const r = el.getBoundingClientRect();
    if (r.top > mid || r.bottom < mid) continue;
    const s = stretches(el).find((x) => x.top <= mid && x.bottom >= mid) ?? { step: -1, top: r.top, bottom: r.bottom };
    return { ch: el.dataset.chapter!, step: s.step, off: clamp((mid - s.top) / Math.max(1, s.bottom - s.top)) };
  }
  return undefined;
}

/**
 * The scroll position that puts this place at the middle of the screen, in
 * the page as it is laid out now; undefined while the chapter is not built.
 */
export function placeTop(p: Place): number | undefined {
  const el = document.getElementById(`ch-${p.ch}`);
  if (!el) return undefined;
  const all = stretches(el);
  const s = all.find((x) => x.step === p.step) ?? all[0];
  return s.top + p.off * (s.bottom - s.top) + window.scrollY - window.innerHeight / 2;
}

/** Remember the place before the page is rebuilt; returns it for the link. */
export function rememberPlace(): Place | undefined {
  const p = placeNow();
  try {
    if (p) sessionStorage.setItem(KEY, JSON.stringify(p));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* private mode: the chapter and step in the link are enough */
  }
  return p;
}

/**
 * The place to come back to in this chapter, once: the remembered one when it
 * is the same step, else the step named in the link, read from its top.
 */
export function takePlace(ch: string, step?: number): Place | undefined {
  let p: Place | undefined;
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    p = raw ? (JSON.parse(raw) as Place) : undefined;
  } catch {
    p = undefined;
  }
  if (p && p.ch === ch && typeof p.step === 'number' && typeof p.off === 'number' && (step === undefined || p.step === step)) return p;
  return step !== undefined ? { ch, step, off: 0 } : undefined;
}

/**
 * Keep a point of the story where it was put while the page settles: fonts
 * swap, pictures above decode, heroes and maps take their final height. Each
 * layout change aims again, so the reader is not left a paragraph (or a
 * chapter) off. It lets go as soon as the reader (or anything else) scrolls,
 * once the page has been still for a while, and in any case after `max` ms.
 * `target` is the scroll position wanted, in the page as laid out now.
 */
export function holdScroll(target: () => number | undefined, opts: { max?: number; quiet?: number } = {}): () => void {
  const max = opts.max ?? 5000;
  const quiet = opts.quiet ?? 1200;
  const root = document.scrollingElement ?? document.documentElement;
  const want = () => {
    const y = target();
    return y === undefined ? undefined : Math.max(0, Math.min(y, root.scrollHeight - window.innerHeight));
  };
  let last: number | undefined;
  let done = false;
  let settled = false;
  let still: ReturnType<typeof setTimeout> | undefined;
  const aim = () => {
    const y = want();
    if (done || y === undefined) return;
    last = y;
    // Instant, whatever the page's CSS says: a smooth scroll would still be
    // on its way when the next layout change moves the target.
    if (Math.abs(window.scrollY - y) > 1) window.scrollTo({ top: y, behavior: 'instant' });
    clearTimeout(still);
    if (settled) still = setTimeout(stop, quiet);
  };
  // A changed target is the layout moving: aim again. The same target but
  // another position is someone scrolling: let go.
  const check = () => {
    const y = want();
    if (done || y === undefined) return;
    if (last === undefined || Math.abs(y - last) > 1) aim();
    else if (Math.abs(window.scrollY - y) > 2) stop();
  };
  const ro = new ResizeObserver(check);
  const story = document.getElementById('story') ?? document.body;
  ro.observe(story);
  for (const c of story.children) ro.observe(c);
  const input = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
  const until = setTimeout(() => stop(), max);
  function stop(): void {
    if (done) return;
    done = true;
    ro.disconnect();
    clearTimeout(still);
    clearTimeout(until);
    window.removeEventListener('scroll', check);
    for (const e of input) window.removeEventListener(e, stop);
  }
  window.addEventListener('scroll', check, { passive: true });
  for (const e of input) window.addEventListener(e, stop, { passive: true });
  aim();
  // Settled: fonts are in and every picture above the target has decoded.
  const y0 = (target() ?? 0) - window.scrollY + window.innerHeight;
  const above = [...story.querySelectorAll('img')].filter((i) => !i.complete && i.getBoundingClientRect().top < y0);
  void Promise.allSettled([document.fonts?.ready, ...above.map((i) => i.decode())]).then(() => {
    settled = true;
    aim();
    if (!done) still = setTimeout(stop, quiet);
  });
  return stop;
}

function clamp(x: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
}
