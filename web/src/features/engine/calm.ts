// Calm mode: still drawings and no moving ink. There is no switch on the
// screen: it follows the system's "reduce motion" setting alone.
function systemCalm(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isCalm(): boolean {
  return systemCalm();
}

/** Call `cb` when the system setting changes. Returns an unsubscribe. */
export function onCalm(cb: (on: boolean) => void): () => void {
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const sys = () => cb(systemCalm());
  mq?.addEventListener('change', sys);
  return () => mq?.removeEventListener('change', sys);
}
