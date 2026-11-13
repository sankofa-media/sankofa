// Fetching the museum's data files: a slow or broken connection gets a
// timeout and another try, and the caller learns the difference between a
// file that is not there (null) and one that could not be loaded (an error).

export interface LoadOptions {
  /** Milliseconds before one attempt is given up. */
  timeout?: number;
  /** Attempts in all, the first included. */
  tries?: number;
  /** Pause before the next attempt, doubled each time. */
  backoff?: number;
  priority?: 'high' | 'low' | 'auto';
  fetch?: typeof fetch;
}

export class LoadError extends Error {
  constructor(
    readonly url: string,
    readonly reason: string,
  ) {
    super(`${url}: ${reason}`);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function once<T>(url: string, f: typeof fetch, timeout: number, priority?: string): Promise<T | null> {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  const timer = setTimeout(() => ctl?.abort(), timeout);
  try {
    const r = await f(url, { signal: ctl?.signal, ...(priority ? { priority } : {}) } as RequestInit);
    // Absent: a 404, or a server that answers every path with the page itself.
    if (r.status === 404) return null;
    if (!r.ok) throw new LoadError(url, `HTTP ${r.status}`);
    const type = r.headers.get('content-type') ?? '';
    if (type.includes('text/html')) return null;
    return (await r.json()) as T;
  } catch (e) {
    if (e instanceof LoadError) throw e;
    const aborted = ctl?.signal.aborted;
    throw new LoadError(url, aborted ? `no answer in ${Math.round(timeout / 1000)} s` : (e as Error).message || 'network error');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The parsed JSON at `url`; null when the file does not exist. Throws a
 * LoadError when every attempt failed or timed out.
 */
export async function loadJson<T>(url: string, opts: LoadOptions = {}): Promise<T | null> {
  const f = opts.fetch ?? fetch.bind(globalThis);
  const tries = Math.max(1, opts.tries ?? 3);
  const timeout = opts.timeout ?? 15_000;
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await once<T>(url, f, timeout, opts.priority);
    } catch (e) {
      last = e;
      if (i < tries - 1) await sleep((opts.backoff ?? 800) * 2 ** i);
    }
  }
  throw last instanceof LoadError ? last : new LoadError(url, String(last));
}
