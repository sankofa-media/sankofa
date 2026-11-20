// The link to the pulse page: the museum, this feature at its warm last
// screen, and pulse=1, which opens the pulse page on arrival (from the
// desktop's QR code, or shared directly).

export const FEATURE_ID = 'angel';

/** The museum link that opens the pulse page. `base` is origin + path (any hash is dropped). */
export function pulseUrl(base: string, lang?: string): string {
  return `${new URL(base).origin}${lang === 'ru' ? '/ru' : ''}/features/${FEATURE_ID}/#scene=warm&pulse=1`;
}

/** Whether a link asks for the pulse page. */
export function wantsPulse(hash: string): boolean {
  return new URLSearchParams(hash.replace(/^#/, '')).get('pulse') === '1';
}
