// What the reader keeps in their own browser: the edition they hold, the path
// they walked, the theme, what they found for their cabinet. The server knows nothing about visitors.
import type { Edition } from './types';

const K = { edition: 'sankofa.edition', path: 'sankofa.path', theme: 'sankofa.theme', cabinet: 'sankofa.cabinet', facts: 'sankofa.facts' };
const MAX_PATH = 200;
const MAX_FACTS = 2000;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: keep going without memory */
  }
}

/** The copy this reader holds. Like an installation, it is dealt once at random. */
export function edition(random = Math.random): Exclude<Edition, 'both'> {
  const e = read(K.edition);
  if (e === 'm' || e === 'f') return e;
  const dealt = random() < 0.5 ? 'm' : 'f';
  write(K.edition, dealt);
  return dealt;
}

export function readPath(): string[] {
  const raw = read(K.path);
  return raw ? raw.split('.').filter(Boolean) : [];
}

/** Append a visit; a repeated visit to the same card is one step. */
export function appendPath(path: string[], id: string): string[] {
  if (path[path.length - 1] === id) return path;
  return [...path, id].slice(-MAX_PATH);
}

export function recordVisit(id: string): string[] {
  const next = appendPath(readPath(), id);
  write(K.path, next.join('.'));
  return next;
}

export function clearPath(): void {
  write(K.path, '');
}

export type Theme = 'dark' | 'light';

export function theme(): Theme {
  return read(K.theme) === 'light' ? 'light' : 'dark';
}

export function setTheme(t: Theme): void {
  write(K.theme, t);
}

/** Hold the other copy from now on (the page is rebuilt by the caller). */
export function setEdition(e: Exclude<Edition, 'both'>): void {
  write(K.edition, e);
}

/** The reader's cabinet as stored (JSON); null when there is none yet or storage is closed. */
export function readCabinet(): string | null {
  return read(K.cabinet);
}

export function writeCabinet(json: string): void {
  write(K.cabinet, json);
}

/** The factoids this reader has been shown by the random-fact button. */
export function readFactsSeen(): Set<string> {
  const raw = read(K.facts);
  return new Set(raw ? raw.split(',').filter(Boolean) : []);
}

/** Remember one more shown factoid; the oldest are forgotten past MAX_FACTS. */
export function recordFactSeen(id: string): Set<string> {
  const seen = readFactsSeen();
  seen.delete(id);
  seen.add(id);
  const list = [...seen].slice(-MAX_FACTS);
  write(K.facts, list.join(','));
  return new Set(list);
}
