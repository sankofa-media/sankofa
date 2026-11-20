import '../styles/main.css';
import '../styles/fonts-full.css';
import '../styles/factoids.css';
import type { App } from '../app';
import type { Card, CardsFile } from '../lib/types';
import { CardSet, cardForEdition } from '../lib/cards';
import { loadJson } from '../lib/loadJson';
import { toast } from '../lib/dom';
import { lang, setLang, storeLang, t, pick } from '../lib/i18n';
import { langOfLocation, featurePath, routeOfLocation } from '../lib/pagePath';
import type { ListenFile } from '../lib/listen';
import type { VoicesFile } from '../lib/voices';
import type { CabinetFile } from '../mechanics/cabinet/model';
import { EMPTY_LISTEN } from '../lib/listen';
import { EMPTY_VOICES } from '../lib/voices';
import { Facts, usableFactoids, type FactoidsFile } from '../lib/factoids';
import { edition, recordVisit } from '../lib/reader';
import { loadMediaManifest } from '../lib/media';
import { compileLexicon, type NamesFile } from '../lib/names';
import { setLexicon } from '../lib/weave';
import { watchPage } from '../lib/sound';
import { watchTypography } from '../lib/typo';
import { installFocusTrap } from '../lib/focusTrap';
import { createFeatures } from './host';

async function start() {
  setLang(langOfLocation(location.pathname, location.hash) ?? 'en');
  document.documentElement.lang = lang();
  installFocusTrap();
  watchPage();
  watchTypography(lang());
  // Metadata supplies link titles; card bodies are fetched only on a card click.
  const [index, names] = await Promise.all([
    loadJson<CardsFile>('data/card-index.json'),
    loadJson<NamesFile>('data/names.json'),
    loadMediaManifest(),
  ]);
  if (names) setLexicon(compileLexicon(names[lang()], lang()));
  const set = new CardSet(index?.cards ?? []);
  let drawer: import('../views/card').Drawer | undefined;
  let request = 0;
  const navigate = (hash: string) => location.assign((lang() === 'ru' ? '/ru/' : '/') + hash);
  const app: App = {
    set, raw: id => set.get(id), chapters: [], listen: EMPTY_LISTEN, voices: EMPTY_VOICES,
    styles: [], elements: { elements: [] }, cardLinks: { links: [] }, lines: [],
    edition: edition(), facts: new Facts(async () => usableFactoids(await loadJson<FactoidsFile>('data/factoids.json'))), media: file => `/media/${file}`,
    openEngine: () => navigate('#view=engine'),
    openAtlas: p => navigate('#' + new URLSearchParams(Object.entries(p).map(([k, v]) => [k, String(v)]))),
    openBook: () => navigate('#view=index'), openDescent: () => navigate('#view=descent'),
    chapterInView() {}, onPath() {}, closeCard: () => drawer?.close(),
    openCard(id, opts = {}) {
      if (!/^[a-z0-9-]+$/.test(id)) return;
      const my = ++request;
      void Promise.all([loadJson<Card>(`data/cards/${id}.json`), import('../views/card'), loadJson<ListenFile>('data/listen.json'), loadJson<VoicesFile>('data/voices.json')]).then(([card, mod, listen, voices]) => {
        if (!card || my !== request) return;
        app.listen = listen ?? EMPTY_LISTEN;
        app.voices = voices ?? EMPTY_VOICES;
        set.byId.set(id, cardForEdition(card, app.edition));
        drawer ??= new mod.Drawer(t('Card'));
        drawer.onClose = () => {
          ++request;
          const url = new URL(location.href);
          const hash = new URLSearchParams(url.hash.slice(1));
          hash.delete('focus');
          url.hash = hash.toString();
          history.replaceState(null, '', url);
        };
        drawer.show(mod.renderCard(app, set.get(id)!));
        recordVisit(id);
        const hash = new URLSearchParams(location.hash.slice(1));
        hash.set('focus', id);
        history[opts.push === false ? 'replaceState' : 'pushState'](null, '', location.pathname + location.search + '#' + hash);
      }).catch(() => toast(pick({ en: 'The card could not load. Please try again.', ru: 'Карточку не удалось загрузить. Попробуйте ещё раз.' })));
    },
  };
  const host = createFeatures(app, {
    switchLang() {
      const next = lang() === 'ru' ? 'en' : 'ru';
      storeLang(next);
      location.assign(featurePath(routeOfLocation(location.pathname, location.hash).item, next) + location.hash);
    },
    navigate(view, _item, scene) {
      if (view === 'feature') {
        const hash = new URLSearchParams(location.hash.slice(1));
        if (scene) hash.set('scene', scene); else hash.delete('scene');
        history.replaceState(null, '', location.pathname + (hash.size ? '#' + hash : ''));
      } else location.assign(view === 'features' ? featurePath(undefined, lang()) : lang() === 'ru' ? '/ru/' : '/');
    },
  });
  const apply = () => {
    const route = routeOfLocation(location.pathname, location.hash);
    host.open(route.view === 'feature' ? 'feature' : 'features', route.item, route.scene);
    if (route.point.focus) app.openCard(route.point.focus, { push: false });
    else { ++request; drawer?.close(true); }
  };
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !drawer?.isOpen) return;
    e.preventDefault();
    e.stopPropagation();
    drawer.close();
  }, true);
  document.addEventListener('click', e => {
    const anchor = (e.target as Element).closest<HTMLAnchorElement>('a[data-card]');
    if (!anchor || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    app.openCard(anchor.dataset.card!);
  });
  document.addEventListener('click', e => {
    const a = (e.target as Element).closest<HTMLAnchorElement>('a[data-mech], a[data-chapter]');
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    navigate(new URL(a.href).hash);
  });
  window.addEventListener('popstate', apply);
  window.addEventListener('hashchange', apply);
  apply();
  const id = routeOfLocation(location.pathname, location.hash).item;
  if (id) void Promise.all([loadJson<CabinetFile>(`data/feature-caches/${id}.json`), import('../mechanics/cabinet/hide'), import('../mechanics/mechanics.css')]).then(([caches, mod]) => {
    if (caches) mod.hideLive(app, caches);
  }).catch(() => undefined);
}
void start();
