import './styles/main.css';
import './styles/roots.css';
import './styles/countries.css';
import './styles/factoids.css';
import type { App } from './app';
import { cardLink } from './app';
import type { CardsFile, ChaptersFile } from './lib/types';
import { ERAS } from './lib/types';
import { holdScroll, placeTop, rememberPlace, takePlace } from './lib/place';
import { CardSet, cardForEdition, localizeCard, localizeChapter } from './lib/cards';
import { chapterForEdition, sortChapters } from './lib/chapters';
import { formatFragment } from './lib/fragment';
import { formatRoute, parseRoute, screenOf, type Route } from './lib/route';
import * as reader from './lib/reader';
import { copyText, h, svgIcon, toast } from './lib/dom';
import { chapterLabel, chapterNumber, detectLang, isLang, lang, pick, setLang, storeLang, storedLang, t, t as tr, type Lang } from './lib/i18n';
import { buildStory } from './views/story';
import { localizeStatics, RU_TITLE_FIX } from './lib/statics';
import { loadMediaManifest } from './lib/media';
import { loadJson } from './lib/loadJson';
import { foldStepMarks, splitStepMarks } from './lib/stepMarks';
import { EMPTY_LISTEN, type ListenFile } from './lib/listen';
import { EMPTY_VOICES, type VoicesFile } from './lib/voices';
import { rootsExtras } from './lib/elements';
import { watchTypography } from './lib/typo';
import { Drawer, renderBook, renderCard } from './views/card';
import { Atlas } from './views/atlas';
import { Descent } from './views/descent';
import { Listen } from './views/listen';
import { Engine } from './views/engine';
import { Roots } from './views/roots';
import { RootsMap } from './views/rootsMap';
import { installMechanics } from './mechanics';
import { installFeatures } from './features';
import { installNavMenu, navReady, setBookCount } from './views/navMenu';
import { installFocusTrap } from './lib/focusTrap';
import { isMechView } from './mechanics/views';
import { compileLexicon, type NamesFile } from './lib/names';
import { setLexicon, weaveLive } from './lib/weave';
import { Facts, usableFactoids, type FactoidsFile } from './lib/factoids';
import { FactPanel } from './views/factoid';
import { takeReviewToken, watchReviewHash } from './lib/reviewGate';

async function load<T>(url: string): Promise<T> {
  // The cover paints first; the data comes at a lower priority, with a
  // timeout and further tries on a slow line.
  const data = await loadJson<T>(url, { priority: 'low', timeout: 20_000 });
  if (data === null) throw new Error(`${url}: not found`);
  return data;
}

function readRoute(): Route {
  return parseRoute(location.hash);
}

function writeRoute(r: Route, push: boolean): void {
  // Every link carries the language, so a shared link opens as it was read.
  const frag = formatRoute({ ...r, point: { ...r.point, lang: lang() === 'en' ? undefined : lang() } });
  const url = frag ? `#${frag}` : location.pathname + location.search;
  if (url === (location.hash || location.pathname + location.search)) return;
  history[push ? 'pushState' : 'replaceState'](null, '', url);
}

/** Switch language: remember it, put it in the link, and rebuild the museum. */
export function switchLang(to: Lang): void {
  storeLang(to);
  const r = parseRoute(location.hash);
  // Keep the reader's place in the story across the rebuild: the chapter and
  // the step being read go into the link, the offset in it into this tab.
  const here = !r.view ? rememberPlace() : undefined;
  if (here) {
    r.ch = here.ch;
    r.step = here.step >= 0 ? here.step : undefined;
  }
  const frag = formatRoute({ ...r, point: { ...r.point, lang: to === 'en' ? undefined : to } });
  history.replaceState(null, '', frag ? `#${frag}` : location.pathname + location.search);
  location.reload();
}

async function start(): Promise<void> {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get('lang');
  const current = detectLang(fromHash, storedLang(), navigator.languages ?? navigator.language);
  setLang(current);
  if (isLang(fromHash)) storeLang(fromHash);
  document.documentElement.lang = current;
  localizeStatics(current);
  const loading = h('div.loading', { role: 'progressbar', 'aria-label': t('Loading the museum') });
  document.body.append(loading);
  let cardsFile: CardsFile;
  let chaptersFile: ChaptersFile;
  let listenFile: ListenFile;
  let voicesFile: VoicesFile;
  let namesFile: NamesFile | null;
  installNavMenu(document.querySelector<HTMLElement>('.nav')!);
  installFocusTrap();
  // The language switch needs no data, so it works while the cards load.
  document.querySelectorAll<HTMLElement>('[data-lang-switch]').forEach((b) => b.addEventListener('click', () => switchLang(lang() === 'ru' ? 'en' : 'ru')));
  // Let the static cover paint before the 1 MB of cards competes for the wire.
  await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  try {
    [cardsFile, chaptersFile, listenFile, , namesFile, voicesFile] = await Promise.all([
      load<CardsFile>('data/cards.json'),
      load<ChaptersFile>('data/chapters.json'),
      // Listening is an extra: the museum opens without it.
      load<ListenFile>('data/listen.json').catch(() => EMPTY_LISTEN),
      loadMediaManifest(),
      // The dictionary's names: without them, only the marked links link.
      load<NamesFile>('data/names.json').catch(() => null),
      load<VoicesFile>('data/voices.json').catch(() => EMPTY_VOICES),
    ]);
  } catch (e) {
    loading.remove();
    document.getElementById('story')!.append(
      h(
        'div.load-error',
        { role: 'alert' },
        h('p', {}, pick({ en: 'The museum could not load its cards. Check the connection and try again.', ru: 'Музей не смог загрузить карточки. Проверьте соединение и попробуйте ещё раз.' })),
        h('p.load-error-detail', {}, (e as Error).message),
        h('button.btn.primary', { type: 'button', onclick: () => location.reload() }, pick({ en: 'Try again', ru: 'Попробовать ещё раз' })),
      ),
    );
    return;
  }

  const rawCards = new Map(cardsFile.cards.map((c) => [c.id, c]));
  const held = reader.edition();
  // Cards, like chapters, hold only the reader's copy of a marked paragraph.
  const set = new CardSet(cardsFile.cards.map((c) => cardForEdition(localizeCard(c, current), held)));
  // Each copy reads only its own paragraphs: every step and count follows from here.
  // A step's own label and picture ({at …}, {img …}) travel with its paragraph
  // through both filters, then come off as fields beside the clean text.
  const chapters = sortChapters(chaptersFile.chapters.map((c) => splitStepMarks(chapterForEdition(localizeChapter(foldStepMarks(c), current), held)))).map((c) => ({ ...c, title: RU_TITLE_FIX[c.title] ?? c.title }));
  // One name per release: every era label is the chapter's own title.
  for (const e of ERAS) e.label = chapters.find((c) => c.id === e.id)?.title ?? e.label;
  if (namesFile) setLexicon(compileLexicon(namesFile[current], current));
  const cardDrawer = new Drawer(t('Card'));
  const bookDrawer = new Drawer(t('Your book'));
  const pathListeners: ((p: string[]) => void)[] = [];
  let route = readRoute();
  let chapterNow: string | null = null;

  // Factoids are an extra, like listening: they arrive after the cards and
  // fill the views that wait for them; without them the museum is whole.
  const facts = new Facts();
  void loadJson<FactoidsFile>('data/factoids.json', { priority: 'low', timeout: 20_000 })
    .then((f) => facts.fill(usableFactoids(f)))
    .catch(() => facts.fill([]));

  const app: App = {
    set,
    facts,
    raw: (id) => rawCards.get(id),
    openEngine(push = true) {
      cardDrawer.close(true);
      bookDrawer.close(true);
      closeOverlays('engine');
      route = { point: {}, view: 'engine' };
      writeRoute(route, push);
      engine.open();
    },
    chapters,
    listen: listenFile,
    voices: voicesFile,
    // The roots' elements, genre-to-genre steps and lines come with the cards.
    ...rootsExtras(cardsFile),
    edition: held,
    media: (file) => `media/${file}`,
    openCard(id, opts = {}) {
      const c = set.get(id);
      if (!c) return;
      bookDrawer.close(true);
      cardDrawer.show(renderCard(app, c));
      const next = reader.recordVisit(c.id);
      pathListeners.forEach((l) => l(next));
      route = { ...route, point: { ...route.point, focus: c.id } };
      if (!atlas.isOpen && !descent.isOpen && !listen.isOpen && !engine.isOpen && !roots.isOpen && !rootsMap.isOpen && !features.isOpen && !route.ch && chapterNow) route.ch = chapterNow;
      writeRoute(route, opts.push ?? true);
    },
    closeCard() {
      cardDrawer.close();
    },
    openAtlas(p, push = true) {
      cardDrawer.close(true);
      closeOverlays('atlas');
      bookDrawer.close(true);
      // A bare atlas has no point to show; name the view so the link opens it.
      route = { point: p, view: p.from || p.place || p.zoom || p.path?.length ? undefined : 'atlas' };
      writeRoute(route, push);
      atlas.open(p);
      if (p.focus) app.openCard(p.focus, { push: false });
    },
    openBook() {
      cardDrawer.close(true);
      const path = reader.readPath();
      bookDrawer.show(
        renderBook(app, path, {
          share: async () => {
            const url = location.href.split('#')[0] + '#' + formatFragment({ path, lang: lang() === 'en' ? undefined : lang() });
            toast((await copyText(url)) ? t('Link to your path copied') : t('Copy failed'));
          },
          replay: () => {
            bookDrawer.close(true);
            app.openAtlas({ path, focus: path[0] });
          },
          clear: () => {
            reader.clearPath();
            pathListeners.forEach((l) => l([]));
            app.openBook();
          },
        }),
      );
    },
    openDescent(year, push = true) {
      cardDrawer.close(true);
      bookDrawer.close(true);
      closeOverlays('descent');
      route = { point: year ? { from: year } : {}, view: 'descent' };
      writeRoute(route, push);
      descent.open(year);
    },
    chapterInView(id) {
      chapterNow = id;
      // The link follows the chapter being read, so a reload or a shared
      // link opens there; overlays keep their own links.
      if (id && !atlas.isOpen && !descent.isOpen && !listen.isOpen && !engine.isOpen && !roots.isOpen && !rootsMap.isOpen && !features.isOpen && !route.point.focus && !route.view && route.ch !== id) {
        route = { point: {}, ch: id };
        writeRoute(route, false);
      }
    },
    onPath(cb) {
      pathListeners.push(cb);
    },
  };

  const atlas = new Atlas(app);
  const descent = new Descent(app);
  descent.onYear = (year) => {
    route = { point: { from: year, zoom: descent.level, focus: route.point.focus }, view: 'descent' };
    writeRoute(route, false);
  };
  descent.onLevel = () => descent.onYear?.(Math.round(descent.year));
  const engine = new Engine(app);
  engine.onClose = () => {
    engine.close();
    route = { point: {}, ch: chapterNow ?? undefined };
    writeRoute(route, false);
  };
  const roots = new Roots(app, cardsFile.roots ?? []);
  roots.onArtist = (artist) => {
    route = { point: {}, view: 'roots', artist };
    // A chain is a page to come back to; a cleared one is not.
    writeRoute(route, !!artist);
  };
  roots.onClose = () => {
    roots.close();
    route = { point: {}, ch: chapterNow ?? undefined };
    writeRoute(route, false);
  };
  const rootsMap = new RootsMap(app, cardsFile.roots ?? []);
  rootsMap.onClose = () => {
    rootsMap.close();
    route = { point: {}, view: 'roots' };
    writeRoute(route, false);
    roots.open();
  };
  const closeOverlays = (keep?: string) => {
    if (keep !== 'roots-map' && rootsMap.isOpen) rootsMap.close();
    if (keep !== 'roots' && roots.isOpen) roots.close();
    if (keep !== 'atlas' && atlas.isOpen) atlas.close();
    if (keep !== 'descent' && descent.isOpen) descent.close();
    if (keep !== 'listen' && listen.isOpen) listen.close();
    if (keep !== 'engine' && engine.isOpen) engine.close();
    if (!isMechView(keep) && mech.isOpen) mech.close();
    if (keep !== 'features' && keep !== 'feature' && features.isOpen) features.close();
  };
  const listen = new Listen(app);
  listen.onClose = () => {
    listen.close();
    route = { point: {}, ch: chapterNow ?? undefined };
    writeRoute(route, false);
  };
  descent.onClose = () => {
    descent.close();
    cardDrawer.close(true);
    route = { point: {}, ch: chapterNow ?? undefined };
    writeRoute(route, false);
  };
  atlas.onChange = (p, view, push) => {
    route = { point: p, ...view };
    writeRoute(route, push ?? false);
  };
  atlas.onClose = () => {
    atlas.close();
    cardDrawer.close(true);
    route = { point: {}, ch: chapterNow ?? undefined };
    writeRoute(route, false);
  };
  cardDrawer.onClose = () => {
    route = { ...route, point: { ...route.point, focus: undefined } };
    if (atlas.isOpen) atlas.unfocus();
    else writeRoute(route, false);
  };

  setupNav(app, atlas);
  const factPanel = new FactPanel(app);
  const factBtn = document.querySelector<HTMLElement>('.nav [data-open-fact]');
  if (factBtn) {
    factBtn.title = pick({ en: 'A random fact from the archive', ru: 'Случайный факт из архива' });
    factBtn.addEventListener('click', () => factPanel.toggle());
  }
  document.querySelectorAll<HTMLAnchorElement>('[data-set-lang]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const to = a.dataset.setLang;
      if (isLang(to) && to !== lang()) switchLang(to);
    }),
  );
  linkCover(app);
  buildStory(app, document.getElementById('story')!);
  // Documents, working objects, how we checked, the guide and the dedication.
  const mech = installMechanics(app, {
    navigate(view, item, push = true) {
      cardDrawer.close(true);
      bookDrawer.close(true);
      if (view) closeOverlays(view);
      route = view ? { point: {}, view, ...(item ? { item } : {}) } : { point: {}, ch: chapterNow ?? undefined };
      writeRoute(route, push);
    },
  });
  // Special projects: the list and each feature, loaded when opened.
  const features = installFeatures(app, {
    switchLang: () => switchLang(lang() === 'ru' ? 'en' : 'ru'),
    navigate(view, item, scene, push = true) {
      // Reading on into the next scene changes only the link.
      const sceneOnly = !push && view === 'feature' && route.view === 'feature' && route.item === item;
      if (!sceneOnly) {
        cardDrawer.close(true);
        bookDrawer.close(true);
        if (view) closeOverlays(view);
      }
      route = view ? { point: {}, view, ...(item ? { item } : {}), ...(scene ? { scene } : {}) } : { point: {}, ch: chapterNow ?? undefined };
      writeRoute(route, push);
    },
  });
  // The dictionary runs through the rooms whose text comes from data.
  weaveLive(app, engine.el);
  weaveLive(app, roots.el);
  weaveLive(app, rootsMap.el);
  weaveLive(app, listen.el);
  const countries = atlas.el.querySelector('.atlas-countries');
  if (countries) weaveLive(app, countries);
  watchTypography(current);
  trackChapters(app);
  loading.remove();

  // Escape closes the topmost panel first, wherever the focus is.
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape') return;
      const open = [cardDrawer, bookDrawer].find((d) => d.isOpen);
      if (!open) return;
      e.preventDefault();
      e.stopPropagation();
      open.close();
    },
    true,
  );

  // Inline card links anywhere open the card in place.
  document.addEventListener('click', (e) => {
    const rm = (e.target as Element).closest<HTMLElement>('[data-roots-map]');
    if (rm) {
      e.preventDefault();
      closeOverlays('roots-map');
      route = { point: {}, view: 'roots-map' };
      writeRoute(route, true);
      rootsMap.open();
      return;
    }
    const ra = (e.target as Element).closest<HTMLElement>('[data-artist-roots]');
    if (ra) {
      e.preventDefault();
      closeOverlays('roots');
      route = { point: {}, view: 'roots', artist: ra.dataset.artistRoots };
      writeRoute(route, true);
      roots.open(ra.dataset.artistRoots);
      return;
    }
    // An element's thread in Roots, from the Workshop and elsewhere.
    const re = (e.target as Element).closest<HTMLElement>('[data-roots-element]');
    if (re) {
      e.preventDefault();
      cardDrawer.close(true);
      closeOverlays('roots');
      route = { point: {}, view: 'roots', item: re.dataset.rootsElement };
      writeRoute(route, true);
      roots.open(undefined, re.dataset.rootsElement);
      return;
    }
    const ro = (e.target as Element).closest<HTMLElement>('[data-roots]');
    if (ro) {
      e.preventDefault();
      cardDrawer.close(true);
      closeOverlays('roots');
      route = { point: {}, view: 'roots' };
      writeRoute(route, true);
      roots.open();
      return;
    }
    const en = (e.target as Element).closest<HTMLElement>('[data-engine]');
    if (en) {
      e.preventDefault();
      app.openEngine();
      return;
    }
    const l = (e.target as Element).closest<HTMLElement>('[data-listen]');
    if (l) {
      e.preventDefault();
      closeOverlays('listen');
      cardDrawer.close(true);
      route = { point: {}, view: 'listen' };
      writeRoute(route, true);
      listen.open();
      return;
    }
    const d = (e.target as Element).closest<HTMLElement>('[data-descent]');
    if (d) {
      e.preventDefault();
      app.openDescent(d.dataset.descent ? Number(d.dataset.descent) : undefined);
      return;
    }
    const a = (e.target as Element).closest<HTMLElement>('[data-card]');
    if (a) {
      e.preventDefault();
      app.openCard(a.dataset.card!);
      return;
    }
    const ch = (e.target as Element).closest<HTMLElement>('a[data-chapter]');
    if (ch) {
      e.preventDefault();
      if (descent.isOpen) descent.onClose?.();
      scrollToChapter(ch.dataset.chapter!);
    }
  });

  const apply = (initial: boolean) => {
    // A link with another language (typed, pasted or followed) switches the museum.
    const asked = new URLSearchParams(location.hash.slice(1)).get('lang');
    if (!initial && isLang(asked) && asked !== lang()) return switchLang(asked);
    route = readRoute();
    const screen = screenOf(route);
    closeOverlays(screen);
    if (screen === 'listen') listen.open();
    else if (screen === 'engine') engine.open();
    else if (screen === 'roots') roots.open(route.artist, route.item);
    else if (screen === 'roots-map') rootsMap.open();
    else if (isMechView(screen)) mech.open(screen, route.item);
    else if (screen === 'features' || screen === 'feature') features.open(screen, route.item, route.scene);
    else if (screen === 'descent') descent.open(route.point.from, route.point.zoom);
    else if (screen === 'atlas') atlas.open(route.point, { atlas: route.atlas, country: route.country });
    else if (route.ch && (initial || route.ch !== chapterNow)) {
      // After a language or copy switch, come back to the same step; a plain
      // chapter link opens at the chapter's top. Either way the place is held
      // while pictures, maps and fonts above it settle.
      const back = initial ? takePlace(route.ch, route.step) : undefined;
      if (back && document.getElementById(`ch-${back.ch}`)) holdScroll(() => placeTop(back));
      else if (initial) holdChapter(route.ch);
      else scrollToChapter(route.ch);
    } else if (initial && route.point.focus) {
      // A card link opens over its own chapter, not wherever the story was.
      const era = app.set.get(route.point.focus)?.era;
      if (era) holdChapter(era);
    }
    if (route.point.focus) app.openCard(route.point.focus, { push: false });
    else cardDrawer.close(true);
  };
  // Mirror the language into the link, so what is shared opens as it was read.
  if (lang() !== 'en' && !isLang(new URLSearchParams(location.hash.slice(1)).get('lang'))) writeRoute(readRoute(), false);
  window.addEventListener('popstate', () => apply(false));
  window.addEventListener('hashchange', () => apply(false));
  apply(true);
  // Only now may a menu entry chosen during loading open its view.
  navReady();
}

/**
 * The cover and the opening are static HTML, so their names are linked by
 * hand as <a data-card>; once the cards are here, those links get the book
 * and the one-line wow of the card they open, like every other link.
 */
function linkCover(app: App): void {
  document.querySelectorAll<HTMLAnchorElement>('.cover a[data-card], .opener a[data-card]').forEach((a) => {
    const id = a.dataset.card!;
    if (!app.set.get(id)) return;
    const l = cardLink(app, id, a.textContent ?? '');
    l.classList.add(...[...a.classList].filter((c) => c !== 'xref'));
    a.replaceWith(l);
  });
}

function scrollToChapter(id: string): void {
  document.getElementById(`ch-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Open the story at a chapter at once and keep it there while the page
 * settles. ('auto' would follow the page's smooth scrolling and still be on
 * its way, chapters away, when the reader starts reading.)
 */
function holdChapter(id: string): void {
  const el = document.getElementById(`ch-${id}`);
  if (el) holdScroll(() => el.getBoundingClientRect().top + window.scrollY);
}

function setupNav(app: App, atlas: Atlas): void {
  const nav = document.querySelector<HTMLElement>('.nav')!;
  const progress = nav.querySelector<HTMLElement>('.progress')!;
  for (const ch of app.chapters) {
    progress.append(h('a', { href: `#ch=${ch.id}`, 'data-chapter': ch.id, 'aria-label': `${chapterLabel(ch.id)}: ${ch.title}`, title: `${chapterLabel(ch.id)} · ${ch.title}` }, h('span', {}, String(chapterNumber(ch.id) ?? ''))));
  }
  nav.querySelector('[data-home]')!.addEventListener('click', (e) => {
    e.preventDefault();
    if (atlas.isOpen) atlas.onClose?.();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  const atlasBtn = nav.querySelector<HTMLElement>('[data-open-atlas]')!;
  atlasBtn.addEventListener('click', () => app.openAtlas({ zoom: 1 }));
  const bookBtn = nav.querySelector<HTMLElement>('[data-open-book]')!;
  bookBtn.addEventListener('click', () => app.openBook());
  // The book's count shows only once there is something in it.
  const setCount = (p: string[]) => setBookCount(new Set(p).size);
  setCount(reader.readPath());
  app.onPath(setCount);

  const themeBtn = nav.querySelector<HTMLButtonElement>('[data-theme-toggle]')!;
  const paintTheme = () => {
    const t = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    themeBtn.replaceChildren(svgIcon(t === 'light' ? 'moon' : 'sun'));
    themeBtn.setAttribute('aria-label', tr(t === 'light' ? 'Switch to dark theme' : 'Switch to light theme'));
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'light' ? '#f5efe3' : '#0c0d18');
  };
  themeBtn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    reader.setTheme(next);
    paintTheme();
  });
  paintTheme();

  const onScroll = () => nav.classList.toggle('solid', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

function trackChapters(app: App): void {
  const links = [...document.querySelectorAll<HTMLElement>('.progress a')];
  const articles = [...document.querySelectorAll<HTMLElement>('article.chapter')];
  let raf = 0;
  let last: string | null | undefined;
  const tick = () => {
    raf = 0;
    const mid = window.innerHeight / 2;
    const at = articles.find((a) => {
      const r = a.getBoundingClientRect();
      return r.top <= mid && r.bottom > mid;
    });
    const id = at?.dataset.chapter ?? null;
    if (id === last) return;
    last = id;
    app.chapterInView(id);
    const idx = id ? app.chapters.findIndex((c) => c.id === id) : -1;
    const past = !id && articles.length > 0 && articles[articles.length - 1].getBoundingClientRect().bottom < mid;
    links.forEach((l, i) => {
      l.classList.toggle('on', i === idx);
      l.classList.toggle('done', past || (idx >= 0 && i < idx));
    });
  };
  window.addEventListener('scroll', () => (raf ||= requestAnimationFrame(tick)), { passive: true });
  tick();
}

// The owner's review mode: its token leaves the link before the route is read,
// and only a device holding it downloads the mode at all.
const reviewToken = takeReviewToken();
watchReviewHash();
start();
if (reviewToken) void import('./review').then((m) => m.install(reviewToken));
