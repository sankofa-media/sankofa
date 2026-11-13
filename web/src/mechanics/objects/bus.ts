// One sound at a time across the page. Whatever starts playing claims the bus
// and the previous source is stopped: an instrument, the gramophone, a video,
// or any <audio>/<video> element on the page. Audio starts only from a user
// gesture: the context is created or resumed inside one.

let ctx: AudioContext | null = null;
let current: { id: string; stop: () => void } | null = null;
const own = new WeakSet<HTMLMediaElement>();

export function audioContext(): AudioContext {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  ctx ??= new AC();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Take the bus: stop whatever else is playing. */
export function claim(id: string, stop: () => void): void {
  if (current && current.id !== id) {
    const prev = current;
    current = null;
    prev.stop();
  }
  current = { id, stop };
  document.querySelectorAll<HTMLMediaElement>('audio, video').forEach((m) => {
    if (!own.has(m) && !m.paused) m.pause();
  });
}

export function release(id: string): void {
  if (current?.id === id) current = null;
}

export function stopAll(): void {
  const prev = current;
  current = null;
  prev?.stop();
}

export function playing(): string | null {
  return current?.id ?? null;
}

/** A media element the bus drives itself (the gramophone's record). */
export function adopt(m: HTMLMediaElement): void {
  own.add(m);
}

let watching = false;
/** Other players on the page (a card's audio, the listening room) silence ours. */
export function watchPage(): void {
  if (watching) return;
  watching = true;
  document.addEventListener(
    'play',
    (e) => {
      const m = e.target;
      if (m instanceof HTMLMediaElement && !own.has(m)) stopAll();
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
