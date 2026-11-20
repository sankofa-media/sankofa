// The special projects' page: the list (/features/) and one feature
// (/features/<id>/#scene=<scene>; the old #view=feature&item=<id> links lead
// here). It is the whole page while it is open: the museum is not shown
// behind it, and its bar leads back to the museum. Loaded on the first visit (see
// ./index.ts); every feature, and the scroll engine they share, is a module
// of its own, loaded only when a reader opens it.
import type { App } from '../app';
import { h, svgIcon } from '../lib/dom';
import { lang, pick } from '../lib/i18n';
import { loadJson } from '../lib/loadJson';
import { featurePath } from '../lib/pagePath';
import { stopWithin } from '../lib/sound';
import { weaveLive } from '../lib/weave';
import type { Bi, Cover, FeatureData, FeaturesIndex } from './model';
import './features.css';

/** What a feature module gets to work with. */
export interface FeatureContext {
  app: App;
  data: FeatureData;
  /** The engine's labels (content/features/index.yaml). */
  ui: Record<string, Bi>;
  /** Where the feature draws itself. */
  root: HTMLElement;
  /** The sheet's bar slot for the feature's own controls. */
  tools: HTMLElement;
  /** The element that scrolls. */
  scroller: HTMLElement;
  /** The scene the link asks for. */
  scene?: string;
  /** The reader reached another scene: keep it in the link. */
  onScene(id: string): void;
}

export interface FeatureInstance {
  /** Show a scene (the link changed: back, forward, a pasted link). */
  goTo(scene: string | undefined): void;
  current(): string | undefined;
  dispose(): void;
}

export interface FeatureModule {
  mount(ctx: FeatureContext): FeatureInstance;
}

/** Every feature's code, loaded on demand: the main bundle holds only these loaders. */
const MODULES: Record<string, () => Promise<FeatureModule>> = {
  'sea-lion-girls': () => import('./sea-lion-girls/index'),
  'forever-changes': () => import('./forever-changes/index'),
  angel: () => import('./angel/index'),
};

import type { FeatureHooks, Features } from './index';

let indexP: Promise<FeaturesIndex | null> | undefined;
function loadIndex(): Promise<FeaturesIndex | null> {
  indexP ??= loadJson<FeaturesIndex>('data/features.json', { timeout: 12_000, tries: 2 });
  indexP.catch(() => (indexP = undefined));
  return indexP;
}

const FALLBACK: Record<string, Bi> = {
  'list-kicker': { en: 'Special projects', ru: 'Спецпроекты' },
  close: { en: 'Close', ru: 'Закрыть' },
  home: { en: 'Sankofa', ru: 'В музей' },
  'list-title': { en: 'Special projects', ru: 'Спецпроекты' },
  'home-label': { en: 'Back to the Sankofa museum', ru: 'Вернуться в музей Sankofa' },
  back: { en: 'All features', ru: 'Все спецпроекты' },
  loading: { en: 'Loading…', ru: 'Загружается…' },
  error: { en: 'This feature could not be loaded. Try again.', ru: 'Не удалось загрузить спецпроект. Попробуйте ещё раз.' },
  retry: { en: 'Try again', ru: 'Попробовать ещё раз' },
};

export function createFeatures(app: App, hooks: FeatureHooks): Features {
  let ui: Record<string, Bi> = FALLBACK;
  const say = (k: string) => pick(ui[k] ?? FALLBACK[k] ?? { en: k, ru: k });
  const kicker = h('span.ft-kicker');
  const back = h('a.btn.ft-back', { href: featurePath(undefined, lang()), 'data-features': '' }, svgIcon('prev'), h('span.ft-back-label'));
  const tools = h('div.ft-tools');
  // The other language, named in itself, as in the museum's top bar.
  const langBtn = h('button.btn.lang-switch.ft-lang', { type: 'button', onclick: () => hooks.switchLang() });
  // Not a "close" button: the special project is a page, and this is the way into the museum.
  const home = h('a.btn.ft-home', {
    href: lang() === 'ru' ? '/#lang=ru' : '/',
    onclick: (ev: Event) => {
      const e = ev as MouseEvent;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      closeAll(true);
    },
  });
  const body = h('div.ft-body');
  const el = h('section.ft-sheet', { role: 'dialog', 'aria-modal': 'true', tabindex: '-1', hidden: true }, h('div.ft-bar', {}, home, back, kicker, tools, langBtn), body);
  document.body.append(el);
  weaveLive(app, body);
  let returnTo: Element | null = null;
  let mounted: { id: string; inst: FeatureInstance } | null = null;
  let token = 0;

  const paintChrome = (inFeature: boolean) => {
    kicker.textContent = say('list-kicker');
    back.hidden = !inFeature;
    back.querySelector('.ft-back-label')!.textContent = say('back');
    back.setAttribute('href', featurePath(undefined, lang()));
    home.textContent = say('home');
    home.setAttribute('aria-label', say('home-label'));
    const ru = lang() === 'ru';
    langBtn.textContent = ru ? 'EN' : 'RU';
    langBtn.lang = ru ? 'en' : 'ru';
    langBtn.setAttribute('aria-label', ru ? 'Read in English' : 'Читать по-русски');
    el.setAttribute('aria-label', say('list-kicker'));
  };

  // The page's title follows what it shows, as a page's should.
  let museumTitle = document.title;
  const title = (t?: string) => (document.title = t ? `${t} · Sankofa` : say('list-title') + ' · Sankofa');

  const show = () => {
    if (el.hidden) {
      returnTo = document.activeElement;
      museumTitle = document.title;
    }
    el.hidden = false;
    document.body.classList.add('locked', 'ft-on');
    el.focus({ preventScroll: true });
  };

  const unmount = () => {
    if (!mounted) return;
    stopWithin(el);
    mounted.inst.dispose();
    mounted = null;
    tools.replaceChildren();
  };

  const status = (cls: string, text: string, retry?: () => void) =>
    h(`div.${cls}`, { role: cls === 'ft-error' ? 'alert' : 'status' }, h('p', {}, text), retry ? h('button.btn.primary', { type: 'button', onclick: retry }, say('retry')) : null);

  const list = async (my: number) => {
    unmount();
    paintChrome(false);
    body.replaceChildren(status('ft-loading', say('loading')));
    el.scrollTop = 0;
    const idx = await loadIndex();
    if (my !== token) return;
    if (idx) ui = { ...FALLBACK, ...idx.ui };
    paintChrome(false);
    title();
    const items = (idx?.features ?? []).map((f) =>
      h(
        'li.ft-item',
        {},
        h(
          'a.ft-item-link',
          { href: featurePath(f.id, lang()), 'data-feature': f.id },
          coverArt(f.id, f.cover),
          h('span.ft-item-tx', {}, h('b', {}, pick(f.title)), h('span', {}, pick(f.dek)), f.reading ? h('small', {}, pick(f.reading)) : null),
          h('span.btn.primary.ft-item-go', { 'aria-hidden': 'true' }, say('open')),
        ),
      ),
    );
    body.replaceChildren(
      h('header.ft-list-head', {}, h('h2', {}, say('list-title')), h('p', {}, say('list-dek'))),
      h('ul.ft-list', {}, ...items),
    );
    body.querySelectorAll<HTMLElement>('.ft-item-link').forEach(drift);
  };

  // A cover is the feature's first picture; its layers drift apart a little
  // as the pointer crosses the card, as they do in the story.
  const coverArt = (id: string, cover: Cover | undefined) => {
    if (!cover) return h('span.ft-item-art.ft-item-ring', { 'aria-hidden': 'true' });
    const layers = cover.layers.map((l) =>
      h('img', { src: app.media(`features/${id}/${l.file}`), alt: '', loading: 'lazy', decoding: 'async', draggable: 'false', 'data-depth': l.depth ? String(l.depth) : undefined }),
    );
    return h('span.ft-item-art', { 'aria-hidden': 'true', style: `aspect-ratio:${cover.aspect}` }, ...layers);
  };
  const drift = (link: HTMLElement) => {
    const art = link.querySelector<HTMLElement>('.ft-item-art');
    const layers = [...(art?.querySelectorAll<HTMLElement>('img[data-depth]') ?? [])];
    if (!art || !layers.length || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const move = (x: number, y: number) => {
      for (const img of layers) {
        const d = Number(img.dataset.depth);
        img.style.transform = x || y ? `translate(${(x * d).toFixed(1)}px, ${(y * d).toFixed(1)}px)` : '';
      }
    };
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    link.addEventListener('pointermove', (e) => {
      const r = art.getBoundingClientRect();
      move(-0.6 * clamp(((e.clientX - r.left) / r.width - 0.5) * 2), -0.6 * clamp(((e.clientY - r.top) / r.height - 0.5) * 2));
    });
    link.addEventListener('pointerleave', () => move(0, 0));
  };

  const feature = async (id: string, scene: string | undefined, my: number) => {
    if (mounted?.id === id) {
      if (scene !== mounted.inst.current()) mounted.inst.goTo(scene);
      return;
    }
    unmount();
    paintChrome(true);
    body.replaceChildren(status('ft-loading', say('loading')));
    el.scrollTop = 0;
    try {
      const load = MODULES[id];
      const [idx, data, mod] = await Promise.all([loadIndex(), loadJson<FeatureData>(`data/features/${id}.json`, { timeout: 15_000, tries: 2 }), load ? load() : Promise.resolve(null)]);
      if (my !== token) return;
      if (idx) ui = { ...FALLBACK, ...idx.ui };
      paintChrome(true);
      if (!data || !mod) {
        hooks.navigate('features', undefined, undefined, false);
        return void list(my);
      }
      title(pick(data.title).split(':')[0]);
      const root = h('article.ft', { 'data-feature-id': id });
      body.replaceChildren(root);
      const inst = mod.mount({
        app,
        data,
        ui,
        root,
        tools,
        scroller: el,
        scene,
        onScene: (s) => hooks.navigate('feature', id, s, false),
      });
      mounted = { id, inst };
    } catch {
      if (my !== token) return;
      body.replaceChildren(status('ft-error', say('error'), () => void feature(id, scene, ++token)));
    }
  };

  const api: Features = {
    get isOpen() {
      return !el.hidden;
    },
    open(view, item, scene) {
      const my = ++token;
      show();
      if (view === 'feature' && item && /^[a-z0-9-]{1,64}$/.test(item)) void feature(item, scene, my);
      else void list(my);
    },
    close() {
      if (el.hidden) return;
      ++token;
      unmount();
      body.replaceChildren();
      el.hidden = true;
      document.body.classList.remove('locked', 'ft-on');
      document.title = museumTitle;
      if (returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus({ preventScroll: true });
    },
  };
  // To the museum (the stub closes this page and brings the museum back where
  // it was): a new step in the history from the home link, in place of this
  // one from Escape.
  const closeAll = (push = false) => hooks.navigate(null, undefined, undefined, push);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.querySelector('.drawer.on')) {
      e.stopPropagation();
      closeAll();
    }
  });
  return api;
}
