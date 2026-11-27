// Real paths next to the museum's hash links. A special project is a page of
// its own (/features/<id>/, /ru/features/<id>/), and the pages the build
// pre-renders for search engines (/cards/<id>/, the A–Z index /cards/, /chapters/<id>/, /guide/,
// /dedication/, /ru/) open the museum at the same place as their hash link.
// The language of a path is its prefix: /ru/… is Russian, any other page
// path is English; the bare root keeps the reader's own language.
// Pure: the build (scripts/seo) and the browser share it.
import { formatRoute, parseRoute, type Route } from './route.ts';

export type PageLang = 'en' | 'ru';
export type PageKind = 'home' | 'features' | 'feature' | 'chapter' | 'card' | 'index' | 'guide' | 'dedication';

export interface PathPage {
  kind: PageKind;
  id?: string;
  /** The language the path names; absent on the bare root. */
  lang?: PageLang;
}

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const isId = (s: string | undefined): s is string => !!s && s.length <= 64 && ID.test(s);

/** The page a path names, or null for a path the museum does not know. */
export function pageOfPath(pathname: string): PathPage | null {
  const p = pathname.replace(/\/index\.html$/, '/');
  const m = /^\/(?:(ru)(?:\/|$))?(?:([a-z]+)(?:\/([^/]+))?\/?)?$/.exec(p);
  if (!m) return null;
  const [, ru, section, id] = m;
  const lang: PageLang | undefined = ru ? 'ru' : section ? 'en' : undefined;
  const page = (kind: PageKind, withId?: string): PathPage => ({ kind, ...(withId ? { id: withId } : {}), ...(lang ? { lang } : {}) });
  if (!section) return page('home');
  if (section === 'features') return id === undefined ? page('features') : isId(id) ? page('feature', id) : null;
  if (section === 'chapters' && isId(id)) return page('chapter', id);
  if (section === 'cards' && id === undefined) return page('index');
  if (section === 'cards' && isId(id)) return page('card', id);
  if ((section === 'guide' || section === 'dedication') && id === undefined) return page(section);
  return null;
}

/** The path of a page: what the build writes and what the museum links to. */
export function pathOfPage(p: PathPage): string {
  const pre = p.lang === 'ru' ? '/ru' : '';
  switch (p.kind) {
    case 'home':
      return `${pre}/`;
    case 'features':
      return `${pre}/features/`;
    case 'feature':
      return `${pre}/features/${p.id}/`;
    case 'chapter':
      return `${pre}/chapters/${p.id}/`;
    case 'card':
      return `${pre}/cards/${p.id}/`;
    case 'index':
      return `${pre}/cards/`;
    default:
      return `${pre}/${p.kind}/`;
  }
}

/** A special project's own page (or the list's, without an id) in a language. */
export function featurePath(id: string | undefined, lang: string): string {
  return pathOfPage({ kind: id ? 'feature' : 'features', ...(id ? { id } : {}), lang: lang === 'ru' ? 'ru' : 'en' });
}

/** Whether the hash says anything about where the museum is (beyond the language). */
function hashHasRoute(hash: string): boolean {
  const q = new URLSearchParams(hash.replace(/^#/, ''));
  return [...q.keys()].some((k) => k !== 'lang');
}

/**
 * Where the museum is, from the whole location. On a feature's page the path
 * names the feature and the hash its scene; a pre-rendered page opens what it
 * shows unless its hash already says otherwise.
 */
export function routeOfLocation(pathname: string, hash: string): Route {
  const r = parseRoute(hash);
  const page = pageOfPath(pathname);
  if (!page || page.kind === 'home') return r;
  const q = new URLSearchParams(hash.replace(/^#/, ''));
  if (page.kind === 'feature') {
    const sc = q.get('scene');
    const { view: _v, item: _i, scene: _s, ...rest } = r;
    return { ...rest, view: 'feature', item: page.id, ...(sc && /^[a-z0-9-]{1,64}$/.test(sc) ? { scene: sc } : {}) };
  }
  if (page.kind === 'features') return { ...r, view: 'features', item: undefined };
  if (hashHasRoute(hash)) return r;
  if (page.kind === 'chapter') return { point: r.point, ch: page.id };
  if (page.kind === 'card') return { point: { ...r.point, focus: page.id } };
  return { point: r.point, view: page.kind };
}

/** The language a location names: the hash's lang=, else the path's prefix. */
export function langOfLocation(pathname: string, hash: string): PageLang | undefined {
  const l = new URLSearchParams(hash.replace(/^#/, '')).get('lang');
  if (l === 'en' || l === 'ru') return l;
  return pageOfPath(pathname)?.lang;
}

/**
 * The link for a route: a feature (and the list) on its own path, the
 * language in the path; everything else as the hash on the museum's root,
 * the language in the hash as before.
 */
export function urlOfRoute(r: Route, lang: string, search = ''): string {
  if ((r.view === 'feature' && isId(r.item)) || r.view === 'features') {
    const path = featurePath(r.view === 'feature' ? r.item : undefined, lang);
    const rest = formatRoute({ point: { ...r.point, lang: undefined }, ...(r.ch ? { ch: r.ch, step: r.step } : {}) });
    const hash = [r.view === 'feature' && r.scene ? `scene=${r.scene}` : '', rest].filter(Boolean).join('&');
    return path + (hash ? `#${hash}` : '');
  }
  const frag = formatRoute({ ...r, point: { ...r.point, lang: lang === 'en' ? undefined : lang } });
  return '/' + search + (frag ? `#${frag}` : '');
}

/** Keys of a hash that are no part of a route (a feature's own modes: lee=1, pulse=1…). */
export function extraHashKeys(hash: string): string {
  const known = new Set(['view', 'item', 'scene', 'lang', 'ch', 'step', 'artist', 'atlas', 'country', 't', 'zoom', 'place', 'focus', 'path']);
  const q = new URLSearchParams(hash.replace(/^#/, ''));
  return [...q.entries()]
    .filter(([k]) => !known.has(k))
    .map(([k, v]) => (v === '' ? k : `${encodeURIComponent(k)}=${encodeURIComponent(v)}`))
    .join('&');
}

/**
 * The location as the old hash link would have said it (#view=feature&item=…),
 * for code that keys pages by their hash (the owner's review notes).
 */
export function hashOfLocation(pathname: string, hash: string): string {
  const page = pageOfPath(pathname);
  if (!page || (page.kind !== 'feature' && page.kind !== 'features')) return hash;
  const q = new URLSearchParams(hash.replace(/^#/, ''));
  q.delete('view');
  q.delete('item');
  const rest = q.toString();
  const head = page.kind === 'feature' ? `view=feature&item=${page.id}` : 'view=features';
  return `#${head}${rest ? `&${rest}` : ''}`;
}
