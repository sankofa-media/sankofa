// The museum's own position next to the shared atlas point: which view is
// open (view=descent) and which chapter the story is at (ch=v3). Go's
// atlas.Parse ignores these keys, so terminal links stay compatible.
import { formatFragment, goQueryEscape, safeParse, type Point } from './fragment';
import { isMechView, type MechView } from '../mechanics/views';

export type View = 'descent' | 'listen' | 'atlas' | 'engine' | 'roots' | 'roots-map' | 'features' | 'feature' | MechView;

export interface Route {
  point: Point;
  ch?: string;
  /** the step of the chapter being read, kept across a language or copy switch */
  step?: number;
  view?: View;
  /** the artist the roots view is rooted on */
  artist?: string;
  /** the document or object a mechanics view opens on; the feature a feature view opens */
  item?: string;
  /** the scene of a feature being read */
  scene?: string;
  /** the atlas grouped by present-day country (atlas=countries) */
  atlas?: 'countries';
  /** the country the atlas shows, by its id in content/countries.yaml */
  country?: string;
}

export function parseRoute(hash: string): Route {
  const s = hash.startsWith('#') ? hash.slice(1) : hash;
  const q = new URLSearchParams(s);
  const v = q.get('view');
  const view = v === 'descent' || v === 'listen' || v === 'atlas' || v === 'engine' || v === 'roots' || v === 'roots-map' || v === 'features' || v === 'feature' || isMechView(v) ? v : undefined;
  const artist = q.get('artist') ?? undefined;
  const item = q.get('item') ?? undefined;
  const sc = q.get('scene');
  const scene = view === 'feature' && sc && /^[a-z0-9-]{1,64}$/.test(sc) ? sc : undefined;
  const ch = q.get('ch') ?? undefined;
  const st = q.get('step');
  const step = ch && st && /^\d{1,3}$/.test(st) ? Number(st) : undefined;
  const atlas = q.get('atlas') === 'countries' ? ('countries' as const) : undefined;
  const country = atlas && /^[a-z0-9-]{1,64}$/.test(q.get('country') ?? '') ? q.get('country')! : undefined;
  return {
    point: safeParse(s),
    ch,
    view,
    ...(step !== undefined ? { step } : {}),
    ...(artist ? { artist } : {}),
    ...(item ? { item } : {}),
    ...(scene ? { scene } : {}),
    ...(atlas ? { atlas } : {}),
    ...(country ? { country } : {}),
  };
}

/** The fragment for a route: atlas keys as Go writes them, museum keys after. */
export function formatRoute(r: Route): string {
  const extra: string[] = [];
  if (r.ch) extra.push('ch=' + goQueryEscape(r.ch));
  if (r.ch && r.step !== undefined) extra.push('step=' + r.step);
  if (r.view) extra.push('view=' + r.view);
  if (r.artist) extra.push('artist=' + goQueryEscape(r.artist));
  if (r.item) extra.push('item=' + goQueryEscape(r.item));
  if (r.view === 'feature' && r.scene) extra.push('scene=' + goQueryEscape(r.scene));
  if (r.atlas) extra.push('atlas=' + r.atlas);
  if (r.atlas && r.country) extra.push('country=' + goQueryEscape(r.country));
  return [formatFragment(r.point), ...extra].filter(Boolean).join('&');
}

/** Which screen a route opens. */
export function screenOf(r: Route): View | 'story' {
  if (r.view) return r.view;
  if (r.atlas) return 'atlas';
  if (!r.ch && (r.point.path?.length || r.point.from || r.point.place || r.point.zoom)) return 'atlas';
  return 'story';
}
