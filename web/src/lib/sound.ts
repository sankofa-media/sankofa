// One sound at a time, for the whole museum. Every source claims the
// coordinator when it starts and the source before it is stopped: a listening
// block (a YouTube player or an audio file), a roots chain stop, the
// gramophone, the drum machine and the pads, the listening room, and any
// <audio>/<video> on a card. Sources pass the element they live in, so closing
// a panel or a view silences exactly what sounds inside it. Audio starts only
// from a user gesture: the shared context is created or resumed inside one.

interface Source {
  id: string;
  stop: () => void;
  owner?: Element;
}

let ctx: AudioContext | null = null;
let current: Source | null = null;
const own = new WeakSet<HTMLMediaElement>();

/** The Web Audio context the instruments share, created on first use. */
export function audioContext(): AudioContext {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  ctx ??= new AC();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/**
 * Start sounding as `id`: whatever else plays is stopped, and so is every
 * media element on the page that is not driven by a source itself.
 */
export function claim(id: string, stop: () => void, owner?: Element): void {
  if (current && current.id !== id) {
    const prev = current;
    current = null;
    prev.stop();
  }
  current = { id, stop, owner };
  document.querySelectorAll<HTMLMediaElement>('audio, video').forEach((m) => {
    if (m !== owner && !own.has(m) && !m.paused) m.pause();
  });
}

/** `id` has stopped on its own. */
export function release(id: string): void {
  if (current?.id === id) current = null;
}

/** Silence whatever is sounding. */
export function stopAll(): void {
  const prev = current;
  current = null;
  prev?.stop();
}

/** Silence what sounds inside `root` (a panel or a view being closed or redrawn). */
export function stopWithin(root: Element): void {
  if (current?.owner && root.contains(current.owner)) stopAll();
}

/** The id of the source sounding now. */
export function playing(): string | null {
  return current?.id ?? null;
}

/** A media element a source drives itself (the gramophone's record, a block's audio). */
export function adopt(m: HTMLMediaElement): void {
  own.add(m);
}

let mediaIds = 0;
const mediaId = new WeakMap<HTMLMediaElement, string>();

let watching = false;
/**
 * Plain media on the page (a card's own recording) take part too: when one
 * starts, it claims the coordinator. A link into the listening room stops
 * everything before the room opens.
 */
export function watchPage(): void {
  if (watching) return;
  watching = true;
  document.addEventListener(
    'play',
    (e) => {
      const m = e.target;
      if (!(m instanceof HTMLMediaElement) || own.has(m)) return;
      let id = mediaId.get(m);
      if (!id) mediaId.set(m, (id = `media-${++mediaIds}`));
      claim(id, () => m.pause(), m);
    },
    true,
  );
  document.addEventListener(
    'pause',
    (e) => {
      const m = e.target;
      if (m instanceof HTMLMediaElement && !own.has(m)) {
        const id = mediaId.get(m);
        if (id) release(id);
      }
    },
    true,
  );
  document.addEventListener(
    'click',
    (e) => {
      if ((e.target as Element).closest?.('[data-listen]')) stopAll();
    },
    true,
  );
}
