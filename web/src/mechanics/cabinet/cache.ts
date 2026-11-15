// Opening a cache: first the container itself, with its own history, then
// what lies inside. The finds go into the reader's cabinet. A locked cache
// says so and waits for its key; nothing in it is needed to read the museum.
import type { App } from '../../app';
import { h } from '../../lib/dom';
import { pick } from '../../lib/i18n';
import { mediaSrc } from '../../lib/media';
import { containerArt, keyArt } from './art';
import { contentsFor, isLocked, openCache, type Artifact, type CabinetFile, type Cache } from './model';
import { holdings, save } from './store';

let open: { el: HTMLElement; back: Element | null } | null = null;

// Escape closes the cache before anything under it (a card, a sheet): this
// listener sits on the window, ahead of the document's own.
function onEscape(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || !open) return;
  e.stopPropagation();
  e.preventDefault();
  closeCache();
}

// Going somewhere else in the museum (a link, Back) leaves the dialog behind.
window.addEventListener('hashchange', () => closeCache());
window.addEventListener('popstate', () => closeCache());

export function closeCache(): void {
  if (!open) return;
  const { el, back } = open;
  open = null;
  window.removeEventListener('keydown', onEscape, true);
  el.remove();
  document.documentElement.classList.remove('cb-modal-open');
  if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
}

/** A found thing, as it comes out of a container or lies in a drawer. */
export function artifactFigure(app: App, f: CabinetFile, a: Artifact, opts: { full?: boolean } = {}): HTMLElement {
  const cards = a.cards.map((id) => app.set.forEdition(id, app.edition) ?? app.set.get(id)).filter((c): c is NonNullable<typeof c> => !!c);
  const drawer = f.drawers.find((d) => d.id === a.drawer);
  return h(
    `article.cb-find${opts.full ? '.cb-find-full' : ''}`,
    { 'data-artifact': a.id },
    h(
      'figure.cb-find-fig',
      {},
      h('img', { ...mediaSrc(app, a.image, opts.full ? [960] : [480]), sizes: opts.full ? '(max-width: 720px) 100vw, 560px' : '240px', alt: pick(a.caption), loading: 'lazy', decoding: 'async', ...(a.width ? { width: String(a.width), height: String(a.height) } : {}) }),
      h('figcaption.credit', {}, h('span.cap', {}, pick(a.caption)), ' · ', a.credit, ' · ', a.url ? h('a', { href: a.url, rel: 'noopener', target: '_blank' }, a.license) : a.license),
    ),
    h(
      'div.cb-find-text',
      {},
      h('p.cb-find-where', {}, `${pick(a.place)} · ${a.year}`, drawer && opts.full ? h('span.cb-find-drawer', {}, ' · ', pick({ en: 'drawer: ', ru: 'ящик: ' }), pick(drawer.label)) : null),
      h('p.cb-find-note', {}, pick(a.note)),
      cards.length ? h('p.cb-find-cards', {}, ...cards.flatMap((c, i) => [i ? ' · ' : '', h('a', { href: `#focus=${c.id}`, 'data-card': c.id }, c.title)])) : null,
      opts.full && a.sources?.length
        ? h('details.cb-find-sources', {}, h('summary', {}, pick({ en: 'Sources', ru: 'Источники' })), h('ol', {}, a.sources.map((s) => h('li', {}, h('a', { href: s.url, rel: 'noopener', target: '_blank' }, s.title)))))
        : null,
    ),
  );
}

/** The container, as the reader first meets it. */
function containerHead(c: Cache, f: CabinetFile): HTMLElement {
  return h(
    'header.cb-container',
    {},
    h('div.cb-container-art', {}, containerArt(c.kind)),
    h(
      'div',
      {},
      h('div.kicker', {}, pick({ en: 'Something was hidden here', ru: 'Здесь было что-то спрятано' })),
      h('h2', { id: 'cb-cache-title' }, pick(c.name)),
      h('p.cb-container-where', {}, `${pick(c.place)} · ${pick(c.time)}`),
      h('p.cb-container-story', {}, pick(c.story)),
      f.sources?.[`cache:${c.id}`]?.length
        ? h('details.cb-find-sources', {}, h('summary', {}, pick({ en: 'Sources', ru: 'Источники' })), h('ol', {}, f.sources[`cache:${c.id}`].map((s) => h('li', {}, h('a', { href: s.url, rel: 'noopener', target: '_blank' }, s.title)))))
        : null,
    ),
  );
}

export function openCacheDialog(app: App, f: CabinetFile, cacheId: string): void {
  const c = f.caches.find((x) => x.id === cacheId);
  if (!c) return;
  const box = h('div.cb-box', { tabindex: '-1' });
  const actions = h('div.cb-actions');
  const inside = h('div.cb-inside', { 'aria-live': 'polite' });
  box.append(containerHead(c, f), actions, inside);

  const keyName = (id: string) => f.keys.find((k) => k.id === id);
  const showInside = (artifacts: string[], keys: string[], again: boolean) => {
    actions.replaceChildren();
    const finds = artifacts.map((id) => f.artifacts.find((a) => a.id === id)).filter((a): a is Artifact => !!a);
    inside.replaceChildren(
      h('h3', {}, again ? pick({ en: 'Inside, as you left it', ru: 'Внутри — всё как вы оставили' }) : pick({ en: 'Inside', ru: 'Внутри' })),
      ...finds.map((a) => artifactFigure(app, f, a)),
      ...keys.map((id) => {
        const k = keyName(id);
        return k ? h('div.cb-keyfind', {}, keyArt(), h('div', {}, h('b', {}, pick(k.name)), h('p', {}, pick(k.note)))) : '';
      }),
      h(
        'p.cb-into',
        {},
        pick(again ? { en: 'These things are already in your cabinet. ', ru: 'Эти вещи уже в вашем кабинете. ' } : { en: 'These things are now in your cabinet, in Plyushkin’s corner, waiting to be sorted. ', ru: 'Теперь эти вещи в вашем кабинете — в углу Плюшкина, ждут, пока их разберут. ' }),
        h('a', { href: '#view=cabinet', 'data-mech': 'cabinet' }, pick({ en: 'Open your cabinet →', ru: 'Открыть ваш кабинет →' })),
      ),
    );
    inside.querySelector<HTMLElement>('h3')?.setAttribute('tabindex', '-1');
    inside.querySelector<HTMLElement>('h3')?.focus({ preventScroll: true });
  };

  const paint = () => {
    const hs = holdings();
    if (hs.opened.includes(c.id) && !isLocked(c, hs)) return showInside(contentsFor(c, app.edition), c.gives ?? [], true);
    if (isLocked(c, hs)) {
      const has = hs.keys.includes(c.lock!);
      actions.replaceChildren(
        h('p.cb-locked', {}, h('b', {}, pick({ en: 'It is locked. ', ru: 'Заперто. ' })), has ? pick({ en: 'You have a key that might fit.', ru: 'У вас есть ключ — может, подойдёт.' }) : pick({ en: 'Its key lies somewhere else in the museum.', ru: 'Ключ от него лежит где-то в другом месте музея.' })),
        has
          ? h('button.btn.primary.cb-usekey', { type: 'button', onclick: () => {
              const r = openCache(f, holdings(), c.id, app.edition, true);
              save(r.state);
              showInside(r.artifacts, r.keys, false);
            } }, keyArt(), pick({ en: 'Use the key', ru: 'Попробовать ключ' }))
          : '',
      );
      return;
    }
    actions.replaceChildren(
      h('button.btn.primary.cb-openit', { type: 'button', onclick: () => {
        const r = openCache(f, holdings(), c.id, app.edition);
        save(r.state);
        showInside(r.artifacts, r.keys, false);
      } }, pick({ en: 'Open it', ru: 'Открыть' })),
    );
  };
  paint();

  showModal(box, 'cb-cache-title', 'cb-modal-cache');
  (actions.querySelector<HTMLElement>('button') ?? box).focus({ preventScroll: true });
}

/** A modal over everything: Escape, a click outside or a link inside closes it; Tab stays in. */
export function showModal(box: HTMLElement, labelledby: string, cls = ''): void {
  closeCache();
  const el = h(`div.cb-modal${cls ? '.' + cls : ''}`, { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': labelledby }, h('div.cb-scrim', { onclick: closeCache }), box);
  box.prepend(h('button.icon-btn.cb-close', { type: 'button', 'aria-label': pick({ en: 'Close', ru: 'Закрыть' }), onclick: closeCache }, '×'));
  // A link out of the dialog (a card, the cabinet) leaves the dialog behind.
  box.addEventListener('click', (e) => {
    if ((e.target as Element).closest('a[href]')) closeCache();
  });
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const all = [...box.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), summary, [tabindex="0"]')];
    if (!all.length) return;
    const first = all[0];
    const last = all[all.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
  open = { el, back: document.activeElement };
  window.addEventListener('keydown', onEscape, true);
  document.body.append(el);
  document.documentElement.classList.add('cb-modal-open');
  box.focus({ preventScroll: true });
}

/** One find, close up, with what can be done with it. */
export function openArtifactDialog(app: App, f: CabinetFile, a: Artifact, actions: HTMLElement | null): void {
  const fig = artifactFigure(app, f, a, { full: true });
  const title = h('h2', { id: 'cb-art-title' }, pick(a.caption));
  const box = h('div.cb-box.cb-box-art', { tabindex: '-1' }, title, fig, actions);
  showModal(box, 'cb-art-title', 'cb-modal-art');
}
