// The Angel service (pkg/angel, under /api/angel on the museum's host): the
// readers' words, the pulses, and who is touching a screen right now. The
// museum may be served without it, so every call here fails quietly: a
// missing service gives null or an empty list, never an error on screen.

export const API = '/api/angel';

export interface Pulse {
  id: number;
  /** Milliseconds between beats. */
  rr: number[];
}

export interface Pulses {
  /** The centre of the chorus: the first pulse left, or null while there is none. */
  first: Pulse | null;
  others: Pulse[];
}

export interface Word {
  id: number;
  text: string;
  lang: string;
  /** The text in the reader's language, or "" (the same as text when it is already in it). */
  translation: string;
  theme: string;
}

export interface Presence {
  /** Fingers on screens right now. */
  count: number;
  watching: number;
  /** Where they are, 0..1 across and down a screen. */
  points: { k: string; x: number; y: number }[];
}

async function call<T>(path: string, init: RequestInit = {}, timeout = 8000): Promise<{ status: number; body: T | null } | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(API + path, { ...init, signal: ctl.signal, credentials: 'omit', cache: 'no-store' });
    const type = r.headers.get('content-type') ?? '';
    const body = type.includes('application/json') ? ((await r.json()) as T) : null;
    return { status: r.status, body };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const isRR = (v: unknown): v is number[] => Array.isArray(v) && v.length > 1 && v.every((x) => typeof x === 'number' && x > 0 && x < 5000);
const isPulse = (p: unknown): p is Pulse => !!p && typeof p === 'object' && isRR((p as Pulse).rr);

let pulsesP: Promise<Pulses | null> | undefined;
/** The pulses: null when the service cannot be reached. Asked once per page. */
export function pulses(): Promise<Pulses | null> {
  pulsesP ??= call<{ first?: unknown; others?: unknown }>('/pulses?n=40').then((r) => {
    if (!r || r.status !== 200 || !r.body) return null;
    const first = isPulse(r.body.first) ? r.body.first : null;
    const others = Array.isArray(r.body.others) ? r.body.others.filter(isPulse) : [];
    return { first, others };
  });
  return pulsesP;
}

/** Forget what was asked (a pulse was just left). */
export function forgetPulses(): void {
  pulsesP = undefined;
}

/** A sample of the readers' published words, with translations into `lang`. */
export async function words(lang: string, n = 40): Promise<Word[]> {
  const r = await call<{ words?: Word[] }>(`/words?n=${n}&lang=${encodeURIComponent(lang)}`);
  if (!r || r.status !== 200 || !Array.isArray(r.body?.words)) return [];
  return r.body.words.filter((w) => w && typeof w.text === 'string' && w.text.trim() !== '');
}

/** Leave words (text, or a recording with its keep-voice choice). The delete code, or null. */
export async function sendWords(w: { text: string; lang: string; audio?: Blob | null; keepVoice?: boolean }): Promise<string | null> {
  let init: RequestInit;
  if (w.audio) {
    const fd = new FormData();
    fd.set('text', w.text);
    fd.set('lang', w.lang);
    fd.set('keep_voice', String(!!w.keepVoice));
    fd.set('audio', w.audio, 'words.webm');
    init = { method: 'POST', body: fd };
  } else {
    init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: w.text, lang: w.lang }) };
  }
  const r = await call<{ delete_code?: string }>('/words', init, 20_000);
  return r && r.status === 202 && typeof r.body?.delete_code === 'string' ? r.body.delete_code : null;
}

/** What became of words left with `code`: pending, published, rejected, crisis; null when unknown. */
export async function wordsStatus(code: string): Promise<string | null> {
  const r = await call<{ status?: string }>(`/words/status?code=${encodeURIComponent(code)}`);
  return r && r.status === 200 && typeof r.body?.status === 'string' ? r.body.status : null;
}

/** Leave a pulse: only the intervals between beats, with consent. The delete code, or null. */
export async function sendPulse(rr: number[]): Promise<string | null> {
  const r = await call<{ delete_code?: string }>('/pulses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rr, source: 'camera', consent: true }) });
  return r && r.status === 201 && typeof r.body?.delete_code === 'string' ? r.body.delete_code : null;
}

/** A finger down (with where, 0..1) or up, for the others to see. Fire and forget. */
export function touch(id: string, down: boolean, x = 0, y = 0): void {
  void call('/touch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, state: down ? 'down' : 'up', x, y }), keepalive: true }, 4000);
}

/** Who is touching now, as it changes. Returns a way to stop listening. */
export function presence(onSnap: (p: Presence) => void): () => void {
  if (typeof EventSource !== 'function') return () => {};
  let es: EventSource | null = new EventSource(API + '/presence');
  let failures = 0;
  es.addEventListener('presence', (e) => {
    failures = 0;
    try {
      const p = JSON.parse((e as MessageEvent).data) as Presence;
      if (typeof p.count === 'number') onSnap({ count: p.count, watching: p.watching ?? 0, points: Array.isArray(p.points) ? p.points : [] });
    } catch {
      /* not a snapshot */
    }
  });
  // Without the service the stream fails at once: stop asking after a few tries.
  es.onerror = () => {
    if (++failures >= 3) {
      es?.close();
      es = null;
    }
  };
  return () => {
    es?.close();
    es = null;
  };
}

/** A random id for this tab's touches (never stored). */
export function tabId(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'[b & 63]).join('');
}
