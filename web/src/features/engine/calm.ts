// Calm mode: still drawings and no moving ink. It follows the system's
// "reduce motion" setting until the reader chooses for themselves on any
// feature screen; the choice is kept in this browser.
const KEY = 'sankofa.feature.calm';

function stored(): boolean | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === '1' ? true : v === '0' ? false : null;
  } catch {
    return null;
  }
}

function systemCalm(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isCalm(): boolean {
  return stored() ?? systemCalm();
}

export function setCalm(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* private mode: for this page only */
  }
  listeners.forEach((l) => l(on));
}

const listeners = new Set<(on: boolean) => void>();

/** Call `cb` when calm mode changes (by the toggle or by the system setting). Returns an unsubscribe. */
export function onCalm(cb: (on: boolean) => void): () => void {
  listeners.add(cb);
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const sys = () => stored() === null && cb(systemCalm());
  mq?.addEventListener('change', sys);
  return () => {
    listeners.delete(cb);
    mq?.removeEventListener('change', sys);
  };
}
