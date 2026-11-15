// The reader's Cabinet of Curiosities: a tall old cabinet whose drawers are
// labelled by hand, a secret drawer without a label, Plyushkin's corner where
// every find lands unsorted, and the honest drawer that says where such
// cabinets got their things. Empty places show as dusty silhouettes: there is
// more to find, and nothing says where.
import type { App } from '../../app';
import { h } from '../../lib/dom';
import { pick } from '../../lib/i18n';
import { mediaSrc } from '../../lib/media';
import { keyArt, silhouette } from './art';
import { closeCache, openArtifactDialog } from './cache';
import { drawerOpen, HEAP, slots, sortInto, tally, unlockDrawer, type Artifact, type CabinetFile, type Drawer, type Holdings } from './model';
import { holdings, onHoldings, save } from './store';

/** A stable small tilt per thing, so the heap looks heaped and stays put. */
function tilt(id: string): number {
  let n = 0;
  for (const ch of id) n = (n * 31 + ch.charCodeAt(0)) | 0;
  return ((Math.abs(n) % 15) - 7) * 1.1;
}

function count(n: number, of: number): string {
  return pick({ en: `You have found ${n} of ${of} things.`, ru: `Найдено вещей: ${n} из ${of}.` });
}

export function cabinetView(app: App, f: CabinetFile): HTMLElement {
  const root = h('div.cb-room');
  const openDrawers = new Set<string>(['honest']);

  const thumb = (a: Artifact, onOpen: () => void, extra = '') =>
    h(
      `button.cb-thing${extra}`,
      { type: 'button', 'data-artifact': a.id, onclick: onOpen, 'aria-label': `${pick(a.caption)}, ${pick(a.place)}, ${a.year}` },
      h('img', { ...mediaSrc(app, a.image, [480]), sizes: '160px', alt: '', loading: 'lazy', decoding: 'async' }),
      h('span.cb-thing-cap', { 'aria-hidden': 'true' }, pick(a.caption)),
    );

  /** One find, close up; from the heap it can be put away into its drawer. */
  const inspect = (a: Artifact, fromHeap: boolean) => {
    const d = f.drawers.find((x) => x.id === a.drawer);
    let actions: HTMLElement | null = null;
    if (fromHeap && d && d.id !== HEAP) {
      const can = drawerOpen(d, holdings());
      actions = h(
        'div.cb-actions',
        {},
        can
          ? h('button.btn.primary.cb-sort', { type: 'button', onclick: () => {
              save(sortInto(f, holdings(), a.id));
              openDrawers.add(d.id);
              closeCache();
            } }, pick({ en: `Put it in the drawer “${d.label.en}”`, ru: `Положить в ящик «${d.label.ru}»` }))
          : h('p.cb-locked', {}, pick({ en: 'Its drawer is locked. Its key is somewhere in the museum.', ru: 'Его ящик заперт. Ключ — где-то в музее.' })),
      );
    } else if (fromHeap) actions = h('p.cb-hint', {}, pick({ en: 'It belongs in no drawer. Plyushkin would keep it in the heap, and so do we.', ru: 'Ни в какой ящик это не годится. Плюшкин оставил бы это в куче — оставим и мы.' }));
    openArtifactDialog(app, f, a, actions);
  };

  const slotList = (d: Drawer, hs: Holdings) => {
    const list = slots(f, hs, d.id, app.edition);
    if (!list.length) return h('p.cb-hint', {}, pick({ en: 'Empty, for now.', ru: 'Пока пусто.' }));
    return h(
      'ul.cb-slots',
      {},
      list.map((s) =>
        h(
          'li',
          {},
          s.here
            ? thumb(s.artifact, () => inspect(s.artifact, false))
            : h('div.cb-dust', { role: 'img', 'aria-label': pick({ en: 'An empty place: something lay here', ru: 'Пустое место: здесь что-то лежало' }) }, silhouette(s.artifact.shape), h('span', { 'aria-hidden': 'true' }, pick({ en: 'something lay here', ru: 'здесь что-то лежало' }))),
        ),
      ),
    );
  };

  const drawerEl = (d: Drawer, hs: Holdings) => {
    const isOpen = drawerOpen(d, hs);
    const secret = !!d.lock;
    const pulled = openDrawers.has(d.id);
    const id = `cb-drawer-${d.id}`;
    const face = h(
      'button.cb-face',
      { type: 'button', 'aria-expanded': String(pulled), 'aria-controls': id, onclick: () => {
        if (pulled) openDrawers.delete(d.id);
        else openDrawers.add(d.id);
        paint();
        root.querySelector<HTMLElement>(`[data-drawer="${d.id}"] .cb-face`)?.focus({ preventScroll: true });
      } },
      h('span.cb-knob', { 'aria-hidden': 'true' }),
      secret && !isOpen ? h('span.cb-plate.cb-noplate', {}, pick({ en: 'a drawer with no label', ru: 'ящик без надписи' })) : h('span.cb-plate', {}, pick(d.label)),
    );
    let body: HTMLElement;
    if (secret && !isOpen) {
      const has = hs.keys.includes(d.lock!);
      body = h(
        'div.cb-drawer-in',
        { id },
        h('p.cb-locked', {}, h('span.cb-keyhole', { 'aria-hidden': 'true' }), pick({ en: 'It does not open. There is a keyhole under the edge. ', ru: 'Не открывается. Под краем — замочная скважина. ' }), has ? pick({ en: 'You have a key.', ru: 'У вас есть ключ.' }) : pick({ en: 'The key is somewhere in the museum.', ru: 'Ключ — где-то в музее.' })),
        has ? h('button.btn.primary.cb-usekey', { type: 'button', onclick: () => (openDrawers.add(d.id), save(unlockDrawer(f, holdings(), d.id))) }, keyArt(), pick({ en: 'Try the key', ru: 'Попробовать ключ' })) : null,
      );
    } else {
      body = h('div.cb-drawer-in', { id }, d.intro ? h('p.cb-drawer-intro', {}, pick(d.intro)) : null, slotList(d, hs));
    }
    body.hidden = !pulled;
    return h(`section.cb-drawer${secret ? '.cb-secret' : ''}${d.id === 'honest' ? '.cb-honest' : ''}${pulled ? '.pulled' : ''}`, { 'data-drawer': d.id, 'aria-label': secret && !isOpen ? pick({ en: 'A drawer with no label', ru: 'Ящик без надписи' }) : pick(d.label) }, face, body);
  };

  const heapEl = (hs: Holdings) => {
    const heap = f.drawers.find((d) => d.id === HEAP);
    const list = slots(f, hs, HEAP, app.edition);
    return h(
      'section.cb-heap',
      { 'aria-labelledby': 'cb-heap-h' },
      h('h3', { id: 'cb-heap-h' }, heap ? pick(heap.label) : pick({ en: 'Plyushkin’s corner', ru: 'Угол Плюшкина' })),
      h('p.cb-hint', {}, heap?.intro ? pick(heap.intro) : pick({ en: 'Everything you find lands here first, in a heap. Pick through it and put things away.', ru: 'Всё найденное сначала попадает сюда, в кучу. Переберите её и разложите вещи по местам.' })),
      list.length
        ? h('ul.cb-pile', {}, list.map((s) => h('li', { style: `--tilt:${tilt(s.artifact.id)}deg` }, thumb(s.artifact, () => inspect(s.artifact, true), '.cb-heaped'))))
        : h('p.cb-hint.cb-pile-empty', {}, pick({ en: 'Nothing here yet but dust. Things are hidden all over the museum: on a picture, in a word, in a drawer.', ru: 'Пока здесь только пыль. Вещи спрятаны по всему музею: на картинке, в слове, в ящике.' })),
    );
  };

  const paint = () => {
    const hs = holdings();
    const t = tally(f, hs, app.edition);
    const keys = hs.keys.map((id) => f.keys.find((k) => k.id === id)).filter((k): k is NonNullable<typeof k> => !!k);
    root.replaceChildren(
      h(
        'header.mx-head.cb-head',
        {},
        h('h2', {}, pick({ en: 'Cabinet of Curiosities', ru: 'Кабинет редкостей' })),
        h('p.mx-lede', {}, pick(f.intro)),
        h('p.cb-tally', { role: 'status' }, count(t.have, t.of)),
        keys.length ? h('div.cb-keyring', {}, h('span', {}, pick({ en: 'On your key ring:', ru: 'На вашей связке:' })), ...keys.map((k) => h('span.cb-keyring-key', { title: pick(k.note) }, keyArt(), pick(k.name)))) : null,
      ),
      h('div.cb-cabinet', {}, h('div.cb-crown', { 'aria-hidden': 'true' }), h('div.cb-drawers', {}, ...f.drawers.filter((d) => d.id !== HEAP).map((d) => drawerEl(d, hs)))),
      heapEl(hs),
    );
  };
  paint();
  const stop = onHoldings(() => {
    if (!root.isConnected) return stop();
    paint();
  });
  return root;
}
