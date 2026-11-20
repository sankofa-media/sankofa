// The link the desktop's QR code carries: the museum, this feature, the
// chapter being read, and lee=1, which opens the Arthur Lee mode on arrival.

export const FEATURE_ID = 'forever-changes';

/** The museum link that opens the mode at `scene`. `base` is origin + path (no hash). */
export function leeUrl(base: string, scene: string | undefined, lang?: string): string {
  const q = [...(scene && /^[a-z0-9-]{1,64}$/.test(scene) ? [`scene=${scene}`] : []), 'lee=1'];
  return `${new URL(base).origin}${lang === 'ru' ? '/ru' : ''}/features/${FEATURE_ID}/#${q.join('&')}`;
}

/** Whether a link asks for the mode. */
export function wantsLee(hash: string): boolean {
  return new URLSearchParams(hash.replace(/^#/, '')).get('lee') === '1';
}
