// The special projects' sheet: the list (#view=features) and one feature
// (#view=feature&item=<id>&scene=<scene>). Loaded on the first visit (see
// ./index.ts); every feature, and the scroll engine they share, is a module
// of its own, loaded only when a reader opens it.
import type { App } from '../app';
import { h, svgIcon } from '../lib/dom';
import { pick } from '../lib/i18n';
import { loadJson } from '../lib/loadJson';
import { stopWithin } from '../lib/sound';
import { weaveLive } from '../lib/weave';
import type { Bi, FeatureData, FeaturesIndex } from './model';
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
};

import type { FeatureHooks, Features } from './index';

let indexP: Promise<FeaturesIndex | null> | undefined;
function loadIndex(): Promise<FeaturesIndex | null> {
  indexP ??= loadJson<FeaturesIndex>('data/features.json', { timeout: 12_000, tries: 2 });
  indexP.catch(() => (indexP = undefined));
  return indexP;
}

const FALLBACK: Record<string, Bi> = {
  'list-kicker': { en: 'Features', ru: 'Спецпроекты' },
  close: { en: 'Close', ru: 'Закрыть' },
  back: { en: 'All features', ru: 'Все спецпроекты' },
  loading: { en: 'Loading…', ru: 'Загружается…' },
  error: { en: 'This feature could not be loaded. Try again.', ru: 'Не удалось загрузить спецпроект. Попробуйте ещё раз.' },
  retry: { en: 'Try again', ru: 'Попробовать ещё раз' },
};

export function createFeatures(app: App, hooks: FeatureHooks): Features {
  let ui: Record<string, Bi> = FALLBACK;
  const say = (k: string) => pick(ui[k] ?? FALLBACK[k] ?? { en: k, ru: k });
  const kicker = h('span.ft-kicker');
  const back = h('a.btn.ft-back', { href: '#view=features', 'data-features': '' }, svgIcon('prev'), h('span.ft-back-label'));
  const tools = h('div.ft-tools');
  const closeBtn = h('button.icon-btn.ft-close', { type: 'button', onclick: () => closeAll() }, svgIcon('close'));
  const body = h('div.ft-body');
  const el = h('section.ft-sheet', { role: 'dialog', 'aria-modal': 'true', tabindex: '-1', hidden: true }, h('div.ft-bar', {}, back, kicker, tools, closeBtn), body);
  document.body.append(el);
  weaveLive(app, body);
  let returnTo: Element | null = null;
  let mounted: { id: string; inst: FeatureInstance } | null = null;
  let token = 0;

  const paintChrome = (inFeature: boolean) => {
    kicker.textContent = say('list-kicker');
    back.hidden = !inFeature;
    back.querySelector('.ft-back-label')!.textContent = say('back');
    closeBtn.setAttribute('aria-label', say('close'));
    el.setAttribute('aria-label', say('list-kicker'));
  };

  const show = () => {
    if (el.hidden) returnTo = document.activeElement;
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
    const items = (idx?.features ?? []).map((f) =>
      h(
        'li.ft-item',
        {},
        h(
          'a.ft-item-link',
          { href: `#view=feature&item=${f.id}`, 'data-feature': f.id },
          h('span.ft-item-art', { 'aria-hidden': 'true' }),
          h('span.ft-item-tx', {}, h('b', {}, pick(f.title)), h('span', {}, pick(f.dek)), f.reading ? h('small', {}, pick(f.reading)) : null),
          h('span.btn.primary.ft-item-go', { 'aria-hidden': 'true' }, say('open')),
        ),
      ),
    );
    body.replaceChildren(
      h('header.ft-list-head', {}, h('h2', {}, say('list-title')), h('p', {}, say('list-dek'))),
      h('ul.ft-list', {}, ...items),
    );
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
      if (returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus({ preventScroll: true });
    },
  };
  const closeAll = () => {
    api.close();
    hooks.navigate(null, undefined, undefined, false);
  };
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.querySelector('.drawer.on')) {
      e.stopPropagation();
      closeAll();
    }
  });
  return api;
}
