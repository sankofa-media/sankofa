// The mechanics: documents on the desk, working objects, how the facts were
// checked, the guide and the dedication. They plug into the museum through
// three doors: views opened by the router (#view=document&item=…, objects,
// method, guide, dedication), blocks on every card, and a few links placed
// into the story (the copy note, the end of the story, the footer).
import type { App } from '../app';
import type { Card } from '../lib/types';
import { h } from '../lib/dom';
import { pick } from '../lib/i18n';
import { mediaSrc } from '../lib/media';
import { editionPairs } from '../views/editionNote';
import * as data from './data';
import { Sheet } from './sheet';
import { isMechView, type MechView } from './views';
import { desk, type DeskView } from './docs/view';
import { agentsNote, checksPanel, methodPage } from './checks/view';
import { objectBlock, objectKeyForCard, OBJECT_KEYS, shelf } from './objects/view';
import { stopAll, watchPage } from '../lib/sound';
import { inLang, prose } from './guide/view';
import './mechanics.css';

export interface MechHooks {
  /** Put a mechanics view (or none) into the link and close what it replaces. */
  navigate(view: MechView | null, item?: string, push?: boolean): void;
}

export interface Mechanics {
  readonly isOpen: boolean;
  open(view: MechView, item?: string): void;
  close(): void;
}

const KICKER: Record<MechView, { en: string; ru: string }> = {
  document: { en: 'Document on the desk', ru: 'Документ на столе' },
  objects: { en: 'Working objects', ru: 'Действующие предметы' },
  method: { en: 'How we checked', ru: 'Как мы проверяли' },
  guide: { en: 'How to read this museum', ru: 'Как читать этот музей' },
  dedication: { en: 'Dedication', ru: 'Посвящение' },
};

export function installMechanics(app: App, hooks: MechHooks): Mechanics {
  watchPage();
  const sheet = new Sheet('mx-view');
  let view: MechView | null = null;
  let current: DeskView | null = null;
  let returnCard: string | undefined;
  let token = 0;

  const close = () => {
    current?.dispose();
    current = null;
    view = null;
    stopAll();
    delete sheet.el.dataset.view;
    sheet.hide();
  };
  sheet.onClose = () => {
    const back = returnCard;
    close();
    hooks.navigate(null, undefined, false);
    if (back) app.openCard(back, { push: false });
  };

  const show = async (v: MechView, item?: string) => {
    const my = ++token;
    const ready = (el: HTMLElement | null, label: string) => {
      if (my !== token) return;
      current?.dispose();
      current = null;
      sheet.show(pick(KICKER[v]), label, el ?? h('p.mx-empty', {}, pick({ en: 'Nothing here yet.', ru: 'Здесь пока ничего нет.' })));
    };
    // The sheet opens at once and says it is loading: never an empty room
    // while the data is still on its way.
    if (!sheet.isOpen || sheet.el.dataset.view !== v || sheet.body.querySelector('.mx-error')) ready(loadingState(), pick(KICKER[v]));
    sheet.el.dataset.view = v;
    try {
      await fill(v, item, my, ready);
    } catch {
      if (my !== token) return;
      ready(errorState(() => void show(v, item)), pick(KICKER[v]));
    }
  };

  const fill = async (v: MechView, item: string | undefined, my: number, ready: (el: HTMLElement | null, label: string) => void) => {
    if (v === 'document') {
      const docs = await data.documents();
      const d = docs?.documents.find((x) => x.id === item) ?? docs?.documents[0];
      if (my !== token) return;
      if (!d) return ready(null, pick(KICKER.document));
      returnCard = d.card;
      const dv = desk(app, d, sheet.el);
      ready(dv.el, pick(d.title));
      current = dv;
      requestAnimationFrame(() => dv.update());
    } else if (v === 'objects') {
      returnCard = undefined;
      const o = await data.objects();
      ready(o ? shelf(app, o) : null, pick(KICKER.objects));
      if (item && OBJECT_KEYS.includes(item as never)) requestAnimationFrame(() => document.getElementById(`object-${item}`)?.scrollIntoView({ block: 'start' }));
    } else if (v === 'method') {
      returnCard = undefined;
      const c = await data.checks();
      ready(c ? methodPage(c) : null, pick(KICKER.method));
    } else if (v === 'guide') {
      returnCard = undefined;
      const [g, docs, o] = await Promise.all([data.guide(), data.documents().catch(() => null), data.objects().catch(() => null)]);
      const doc = inLang(g);
      const values = {
        cards: String(app.set.all().filter((c) => c.edition === 'both' || c.edition === app.edition).length),
        pairs: String(editionPairs(app).length),
        documents: String(docs?.documents.length ?? 0),
        objects: String(OBJECT_KEYS.filter((k) => o?.[k]).length),
      };
      const body = doc ? prose(doc, values) : null;
      // Where the guide first speaks of the agents, say who they are.
      const about = body ? [...body.querySelectorAll('p')].find((p) => /\bagents?\b|агент/i.test(p.textContent ?? '')) : undefined;
      about?.after(agentsNote());
      ready(doc ? h('article.mx-guide', {}, h('header.mx-head', {}, h('h2', {}, doc.title ?? pick(KICKER.guide))), body) : null, doc?.title ?? pick(KICKER.guide));
    } else if (v === 'dedication') {
      returnCard = undefined;
      const doc = inLang(await data.dedication());
      ready(doc ? h('article.mx-dedication', {}, doc.title ? h('h2', {}, doc.title) : null, prose(doc, {}, 'mx-ded-prose')) : null, doc?.title ?? pick(KICKER.dedication));
    }
  };

  const mech: Mechanics = {
    get isOpen() {
      return sheet.isOpen;
    },
    open(v, item) {
      if (view === v && sheet.isOpen && v !== 'document' && v !== 'objects') return;
      view = v;
      stopAll();
      void show(v, item);
    },
    close,
  };

  // Links anywhere: <a data-mech="guide">, data-item for the document or object.
  document.addEventListener('click', (e) => {
    const a = (e.target as Element).closest<HTMLElement>('[data-mech]');
    if (!a) return;
    const v = a.dataset.mech;
    if (!isMechView(v)) return;
    e.preventDefault();
    hooks.navigate(v, a.dataset.item, true);
    mech.open(v, a.dataset.item);
  });

  decorate();
  return mech;
}

/** Links into the story: a "?" by the copy switch, the end of the story, a footer. */
function decorate(): void {
  // The top-bar entries keep a name when their label folds away.
  document.querySelectorAll<HTMLElement>('.nav-actions .mx-nav').forEach((a) => {
    const v = a.dataset.mech;
    if (isMechView(v)) a.setAttribute('aria-label', v === 'guide' ? pick({ en: 'Guide: how to read this museum', ru: 'Как читать этот музей' }) : pick(KICKER[v]));
    if (isMechView(v)) a.title = a.getAttribute('aria-label')!;
  });
  document.querySelectorAll<HTMLElement>('.ed-switch').forEach((b) => {
    if (b.nextElementSibling?.classList.contains('mx-help')) return;
    b.after(h('a.icon-btn.mx-help', { href: '#view=guide', 'data-mech': 'guide', 'aria-label': pick({ en: 'How to read this museum', ru: 'Как читать этот музей' }), title: pick({ en: 'How to read this museum', ru: 'Как читать этот музей' }) }, '?'));
  });
  const story = document.getElementById('story');
  if (!story) return;
  const ded = h('a', { href: '#view=dedication', 'data-mech': 'dedication', hidden: true }, pick({ en: 'Dedication', ru: 'Посвящение' }));
  const codaDed = h('a.mx-coda-ded', { href: '#view=dedication', 'data-mech': 'dedication', hidden: true }, pick({ en: 'Dedication', ru: 'Посвящение' }));
  story.querySelector('.coda .coda-inner')?.append(codaDed);
  story.append(
    h(
      'footer.mx-colophon',
      { 'aria-label': pick({ en: 'About this museum', ru: 'Об этом музее' }) },
      h(
        'nav',
        {},
        h('a', { href: '#view=guide', 'data-mech': 'guide' }, pick({ en: 'How to read this museum', ru: 'Как читать этот музей' })),
        h('a', { href: '#view=objects', 'data-mech': 'objects' }, pick({ en: 'Working objects', ru: 'Действующие предметы' })),
        h('a', { href: '#view=method', 'data-mech': 'method' }, pick({ en: 'How we checked', ru: 'Как мы проверяли' })),
        ded,
      ),
      h('p', {}, 'Sankofa · ', pick({ en: 'cards and chapters CC BY 4.0, code Apache-2.0, media under their own licences', ru: 'карточки и главы — CC BY 4.0, код — Apache-2.0, медиа — под собственными лицензиями' })),
    ),
  );
  // The dedication appears only when the content has one.
  void data
    .dedication()
    .then((d) => {
      if (!inLang(d)) return;
      ded.hidden = false;
      codaDed.hidden = false;
    })
    .catch(() => undefined);
}

/** What a view shows while its data is on the way. */
export function loadingState(): HTMLElement {
  return h('div.mx-loading', { role: 'status', 'aria-live': 'polite' }, h('span.mx-spinner', { 'aria-hidden': 'true' }), pick({ en: 'Loading…', ru: 'Загружается…' }));
}

/** What a view shows when its data could not be loaded, with a way to ask again. */
export function errorState(retry: () => void): HTMLElement {
  return h(
    'div.mx-error',
    { role: 'alert' },
    h('p', {}, pick({ en: 'This page could not be loaded. The connection may be slow; try again.', ru: 'Эту страницу не удалось загрузить. Возможно, медленное соединение — попробуйте ещё раз.' })),
    h('button.btn.primary', { type: 'button', onclick: retry }, pick({ en: 'Try again', ru: 'Попробовать ещё раз' })),
  );
}

/** Blocks on a card: its working object and its documents. */
export function cardExtras(app: App, c: Card): HTMLElement {
  const host = h('div.mx-card-extras');
  void Promise.all([data.objects(), data.documents()]).then(([o, docs]) => {
    const parts: HTMLElement[] = [];
    for (const d of docs?.documents.filter((x) => x.card === c.id) ?? []) {
      const first = d.pages[0];
      parts.push(
        h(
          'a.mx-doclink',
          { href: `#view=document&item=${d.id}`, 'data-mech': 'document', 'data-item': d.id },
          h('img', { ...mediaSrc(app, first.file, [480]), sizes: '96px', alt: '', loading: 'lazy', decoding: 'async', width: String(first.width), height: String(first.height) }),
          h('span', {}, h('small', {}, pick({ en: 'Read the document', ru: 'Читать документ' })), h('b', {}, pick(d.title)), h('em', {}, pick(d.imprint))),
        ),
      );
    }
    const key = o ? objectKeyForCard(o, c.id) : undefined;
    if (o && key) {
      const b = objectBlock(app, o, key, 'card');
      if (b) parts.push(b);
    }
    host.replaceChildren(...parts);
  }).catch(() => undefined);
  return host;
}

/** The "How we checked" panel of a card. */
export function cardChecks(_app: App, c: Card): HTMLElement {
  const host = h('div.mx-card-checks');
  void data.checks().then((f) => {
    const p = checksPanel(c, f?.cards[c.id]);
    if (p) host.replaceChildren(p);
  }).catch(() => undefined);
  return host;
}

