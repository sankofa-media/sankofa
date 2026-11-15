// On a phone the top bar keeps the wordmark, the language and one labelled
// "Menu" button. The menu is a sheet that names every way into the museum in
// words, with a line on what each one is: a newcomer never has to guess
// what nine bare icons mean.
import { h, svgIcon } from '../lib/dom';
import { lang, pick } from '../lib/i18n';

const HINTS: Record<string, { en: string; ru: string }> = {
  descent: { en: 'Seven centuries, year by year', ru: 'Семь веков, год за годом' },
  atlas: { en: 'Every card on one map', ru: 'Все карточки на одной карте' },
  listen: { en: 'The museum’s cluster, played as drums', ru: 'Кластер музея звучит как барабаны' },
  roots: { en: 'Trace an artist back to these stories', ru: 'Проследить исполнителя до этих историй' },
  engine: { en: 'How the museum runs on Kubernetes', ru: 'Как музей устроен на Kubernetes' },
  book: { en: 'The cards you have opened, kept in this browser', ru: 'Открытые вами карточки — хранятся в этом браузере' },
  fact: { en: 'One checked fact at random, with its sources', ru: 'Случайный проверенный факт — с источниками' },
  workshop: { en: 'The elements music is made of, to play', ru: 'Элементы, из которых сделана музыка, — на них можно играть' },
  cabinet: { en: 'What you find hidden around the museum', ru: 'Всё, что вы найдёте спрятанным по музею' },
  features: { en: 'Long stories to read and hear, scene by scene', ru: 'Большие истории со звуком — сцена за сценой' },
  index: { en: 'Every name in the dictionary, from A to Z', ru: 'Все имена словаря — от А до Я' },
  guide: { en: 'What is where, and how the facts were checked', ru: 'Что где лежит и как проверяли факты' },
  dedication: { en: 'Whom this museum is for', ru: 'Кому посвящён этот музей' },
};

/** Which entry a top-bar button is. */
function keyOf(b: HTMLElement): string | undefined {
  if (b.matches('[data-open-descent]')) return 'descent';
  if (b.matches('[data-open-atlas]')) return 'atlas';
  if (b.matches('[data-open-listen]')) return 'listen';
  if (b.matches('[data-open-roots]')) return 'roots';
  if (b.matches('[data-open-engine]')) return 'engine';
  if (b.matches('[data-open-book]')) return 'book';
  if (b.matches('[data-open-fact]')) return 'fact';
  if (b.matches('[data-features]')) return 'features';
  return b.dataset.mech;
}

/** "3 cards" in the reader's language. */
export function bookCount(n: number, l = lang()): string {
  if (l === 'ru') {
    const m10 = n % 10;
    const m100 = n % 100;
    const w = m10 === 1 && m100 !== 11 ? 'карточка' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'карточки' : 'карточек';
    return `${n} ${w}`;
  }
  return `${n} ${n === 1 ? 'card' : 'cards'}`;
}

// The menu is up while the cards still load; an entry chosen then is kept
// and carried out once the museum is ready, instead of being lost.
let ready = false;
let pending: HTMLElement | undefined;
export function navReady(): void {
  ready = true;
  const b = pending;
  pending = undefined;
  b?.click();
}

export function installNavMenu(nav: HTMLElement): void {
  const actions = nav.querySelector<HTMLElement>('.nav-actions');
  if (!actions || actions.querySelector('.nav-menu-btn')) return;
  const l = lang();
  const entries = [...actions.querySelectorAll<HTMLElement>('.btn:not(.lang-switch)')];
  const sheet = h('div.nav-sheet', { id: 'nav-sheet', role: 'dialog', 'aria-modal': 'false', 'aria-label': pick({ en: 'Museum menu', ru: 'Меню музея' }), hidden: true });
  const list = h('ul.nav-sheet-list');
  for (const b of entries) {
    const key = keyOf(b);
    const name = b.querySelector(`.label [data-l="${l}"]`)?.textContent?.trim();
    if (!key || !name) continue;
    const svg = b.querySelector('svg')?.cloneNode(true) as SVGElement | undefined;
    const hint = HINTS[key] ? pick(HINTS[key]) : '';
    const count = key === 'book' ? h('span.nav-sheet-count', { 'data-sheet-count': '' }) : null;
    const item = h(
      'button.nav-sheet-item',
      {
        type: 'button',
        'data-entry': key,
        onclick: () => {
          close();
          if (ready) b.click();
          else pending = b;
        },
      },
      h('span.nav-sheet-ic', { 'aria-hidden': 'true' }, ...(svg ? [svg as unknown as HTMLElement] : [])),
      h('span.nav-sheet-tx', {}, h('b', {}, name, count), hint ? h('small', {}, hint) : null),
    );
    list.append(h('li', {}, item));
  }
  const theme = nav.querySelector<HTMLButtonElement>('[data-theme-toggle]');
  if (theme) {
    const light = () => document.documentElement.dataset.theme === 'light';
    const label = () => pick(light() ? { en: 'Dark theme', ru: 'Тёмная тема' } : { en: 'Light theme', ru: 'Светлая тема' });
    const ic = h('span.nav-sheet-ic', { 'aria-hidden': 'true' });
    const name = h('b', {});
    const paint = () => {
      ic.replaceChildren(svgIcon(light() ? 'moon' : 'sun'));
      name.textContent = label();
    };
    paint();
    const tb = h('button.nav-sheet-item.nav-sheet-theme', { type: 'button', onclick: () => (theme.click(), paint()) }, ic, h('span.nav-sheet-tx', {}, name));
    list.append(h('li', {}, tb));
  }
  sheet.append(list);

  const btn = h(
    'button.btn.nav-menu-btn',
    { type: 'button', 'aria-expanded': 'false', 'aria-controls': 'nav-sheet' },
    h('span.nav-menu-ic', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
    h('span.nav-menu-label', {}, pick({ en: 'Menu', ru: 'Меню' })),
  );
  const open = () => {
    sheet.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    document.documentElement.classList.add('nav-sheet-open');
    sheet.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  };
  const close = () => {
    if (sheet.hidden) return;
    sheet.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.documentElement.classList.remove('nav-sheet-open');
  };
  btn.addEventListener('click', () => (sheet.hidden ? open() : close()));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !sheet.hidden) {
      close();
      btn.focus();
    }
  });
  document.addEventListener('click', (e) => {
    if (sheet.hidden) return;
    const t = e.target as Node;
    if (!sheet.contains(t) && !btn.contains(t)) close();
  });
  window.addEventListener('resize', () => window.innerWidth > 720 && close());
  // The language switch stays in the bar; the menu goes just before it.
  actions.insertBefore(btn, actions.querySelector('.lang-switch'));
  nav.after(sheet);
}

/** Show how many cards are in the reader's book, or nothing while it is empty. */
export function setBookCount(n: number): void {
  document.querySelectorAll<HTMLElement>('[data-path-count]').forEach((c) => {
    c.textContent = String(n);
    c.hidden = n === 0;
  });
  document.querySelectorAll<HTMLElement>('[data-sheet-count]').forEach((c) => (c.textContent = n ? ` · ${bookCount(n)}` : ''));
  const book = document.querySelector<HTMLElement>('.nav [data-open-book]');
  if (book) {
    const name = pick({ en: 'Your book', ru: 'Ваша книга' });
    const what = n ? pick({ en: `${bookCount(n)} you have opened`, ru: `открыто: ${bookCount(n)}` }) : pick({ en: 'the cards you open are kept here', ru: 'здесь хранятся открытые вами карточки' });
    book.title = `${name}: ${what}`;
    book.setAttribute('aria-label', `${name}, ${what}`);
  }
}
