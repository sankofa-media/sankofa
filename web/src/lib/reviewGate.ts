// The owner's review mode is switched on by opening the museum once with
// #review=<token> (and off with #review=off). The token is kept on this device
// and taken out of the link at once, before the museum reads its route; readers
// without it load nothing of the mode.

export const REVIEW_KEY = 'sankofa.review';

/**
 * The review parameter of a hash and the hash without it. `token` is undefined
 * when the hash does not mention review, null when it asks to switch it off.
 */
export function splitReviewHash(hash: string): { token: string | null | undefined; rest: string } {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (!params.has('review')) return { token: undefined, rest: hash };
  const v = (params.get('review') ?? '').trim();
  params.delete('review');
  const rest = params.toString();
  return { token: v === '' || v === 'off' ? null : v, rest: rest ? `#${rest}` : '' };
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Take a token out of the link into storage; return the token in effect, if any. */
export function takeReviewToken(store: Storage | null = storage()): string | null {
  const { token, rest } = splitReviewHash(location.hash);
  try {
    if (token !== undefined) {
      history.replaceState(history.state, '', rest || location.pathname + location.search);
      if (token) store?.setItem(REVIEW_KEY, token);
      else store?.removeItem(REVIEW_KEY);
    }
    return store?.getItem(REVIEW_KEY) || null;
  } catch {
    return token || null;
  }
}

/** A review link typed into an open tab changes only the hash: take it and reload. */
export function watchReviewHash(): void {
  window.addEventListener('hashchange', () => {
    if (splitReviewHash(location.hash).token === undefined) return;
    takeReviewToken();
    location.reload();
  });
}

/** Forget the token on this device. */
export function forgetReviewToken(store: Storage | null = storage()): void {
  try {
    store?.removeItem(REVIEW_KEY);
  } catch {
    /* nothing kept */
  }
}
