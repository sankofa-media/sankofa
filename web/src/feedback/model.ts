import { pageOfPath, routeOfLocation } from '../lib/pagePath';
export const kinds = ['correction', 'idea', 'topic', 'other'] as const;
export function validFeedback(kind: string, text: string, contact: string): boolean {
  return kinds.includes(kind as typeof kinds[number]) && [...text.trim()].length > 0 && [...text.trim()].length <= 4000 && [...contact].length <= 200;
}
/** Keep only navigation context: never forward review tokens or query credentials. */
export function pageContext(href: string, language: string, theme: string, width: number, height: number) {
  const url = new URL(href);
  const route = routeOfLocation(url.pathname, url.hash);
  const page = pageOfPath(url.pathname);
  const hash = new URLSearchParams(url.hash.slice(1));
  for (const key of [...hash.keys()]) if (!['view', 'item', 'scene', 'focus', 'ch', 'step', 'lang', 'atlas', 'country'].includes(key)) hash.delete(key);
  return { url: url.origin + url.pathname + (hash.size ? '#' + hash : ''), key: page?.kind ?? 'home', view: route.view ?? 'story', item: route.point.focus ?? route.item ?? page?.id ?? route.ch ?? '', scene: route.scene ?? '', language, theme, viewport: { width, height } };
}
