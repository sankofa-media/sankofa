// The reader's own cabinet, kept in their browser like their book. Storage
// may be closed (a private window); the cabinet then lasts as long as the page.
import { readCabinet, writeCabinet } from '../../lib/reader';
import { parseHoldings, type Holdings } from './model';

let state: Holdings | null = null;
const listeners = new Set<(h: Holdings) => void>();

export function holdings(): Holdings {
  state ??= parseHoldings(readCabinet());
  return state;
}

export function save(next: Holdings): void {
  state = next;
  try {
    writeCabinet(JSON.stringify(next));
  } catch {
    /* nothing to keep it in: it lives in this page */
  }
  listeners.forEach((l) => l(next));
}

/** Be told whenever the cabinet changes; returns a way to stop. */
export function onHoldings(cb: (h: Holdings) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
