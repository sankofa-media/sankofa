// The Workshop: working objects as the reader meets them, on their cards and
// together on the bench. Each object is an element of music that travels
// between styles; its label (content/objects.yaml) says which, where and when,
// who made it and where it went next, and links its thread in Roots and its
// cards. The sounds are the card's own recording or synthesized in the browser.
import type { App } from '../../app';
import { h } from '../../lib/dom';
import { pick } from '../../lib/i18n';
import { drumMachine } from './drummachine';
import { gramophone } from './gramophone';
import type { ObjectLabel, ObjectsFile } from './model';
import { pads } from './pads';
import { KIT_808, KIT_ACOUSTIC, KIT_CLAVE } from './voices';
import { callResponse } from './callresponse';
import { flipClave } from './model';
import { listenBlock } from '../../views/player';

export type Key = 'gramophone' | 'tr808' | 'amen' | 'clave' | 'call';
export const OBJECT_KEYS: Key[] = ['gramophone', 'tr808', 'amen', 'clave', 'call'];

/** A drawer under an object on the bench (the cabinet hides things in some). */
let drawerHook: ((key: Key) => HTMLElement | null) | undefined;
export function setWorkshopDrawers(f: (key: Key) => HTMLElement | null): void {
  drawerHook = f;
}

function instrument(app: App, key: Key, o: ObjectsFile, where: 'card' | 'shelf'): HTMLElement | null {
  if (key === 'gramophone' && o.gramophone) {
    const c = app.set.get(o.gramophone.card);
    const audio = c?.media?.find((m) => m.type === 'audio' && m.file === o.gramophone!.audio);
    const el = gramophone({ src: app.media(o.gramophone.audio), title: 'Crazy Blues', artist: 'Mamie Smith and Her Jazz Hounds', year: '1920', rpm: o.gramophone.rpm });
    if (audio) el.append(h('p.credit', {}, audio.caption ? audio.caption + ' · ' : '', audio.credit, ' · ', audio.url ? h('a', { href: audio.url, rel: 'noopener', target: '_blank' }, audio.license) : audio.license));
    return el;
  }
  if (key === 'tr808' && o.tr808)
    return drumMachine({
      id: 'tr808',
      kit: KIT_808,
      pattern: o.tr808.pattern,
      bpm: o.tr808.tempo,
      label: { en: 'Drum machine pattern', ru: 'Рисунок драм-машины' },
      presetName: {
        en: 'The preset is a simple electro beat written for this museum. It is not the pattern of “Planet Rock” or of any other record.',
        ru: 'Заготовка — простой электро-бит, написанный для этого музея. Это не рисунок «Planet Rock» и не рисунок какой-либо другой пластинки.',
      },
      voices: [
        { key: 'bd', short: 'BD', name: { en: 'Bass drum', ru: 'Бас-барабан' } },
        { key: 'sd', short: 'SD', name: { en: 'Snare drum', ru: 'Малый барабан' } },
        { key: 'lt', short: 'LT', name: { en: 'Low tom', ru: 'Низкий том' } },
        { key: 'cp', short: 'CP', name: { en: 'Hand clap', ru: 'Хлопок' } },
        { key: 'cb', short: 'CB', name: { en: 'Cowbell', ru: 'Ковбелл' } },
        { key: 'ch', short: 'CH', name: { en: 'Closed hi-hat', ru: 'Закрытый хай-хэт' } },
        { key: 'oh', short: 'OH', name: { en: 'Open hi-hat', ru: 'Открытый хай-хэт' } },
      ],
    });
  if (key === 'amen' && o.amen)
    return h(
      'div.mx-amen',
      {},
      pads('amen-pads', KIT_ACOUSTIC, [
        { key: 'kick', name: { en: 'Kick', ru: 'Бочка' } },
        { key: 'snare', name: { en: 'Snare', ru: 'Малый барабан' } },
        { key: 'hat', name: { en: 'Hi-hat', ru: 'Хай-хэт' } },
        { key: 'ride', name: { en: 'Ride', ru: 'Райд' } },
      ]),
      drumMachine({
        id: 'amen',
        kit: KIT_ACOUSTIC,
        pattern: o.amen.pattern,
        bpm: o.amen.tempo,
        label: { en: 'Four-bar break', ru: 'Четырёхтактовый брейк' },
        presetName: {
          en: 'The preset is an approximate re-creation of the famous four bars, played on synthesized drums. It is not a sample and not the recording.',
          ru: 'Заготовка — приблизительное воссоздание знаменитых четырёх тактов на синтезированных барабанах. Это не сэмпл и не сама запись.',
        },
        voices: [
          { key: 'ride', short: 'RD', name: { en: 'Ride', ru: 'Райд' } },
          { key: 'crash', short: 'CR', name: { en: 'Crash', ru: 'Крэш' } },
          { key: 'hat', short: 'HH', name: { en: 'Hi-hat', ru: 'Хай-хэт' } },
          { key: 'snare', short: 'SN', name: { en: 'Snare', ru: 'Малый барабан' } },
          { key: 'kick', short: 'KD', name: { en: 'Kick', ru: 'Бочка' } },
        ],
      }),
      // The official recording, from the museum's listening list. On its card
      // the card's own listening block already offers it.
      where === 'shelf' ? recording(app, o.amen.card) : null,
    );
  if (key === 'clave' && o.clave) {
    const voices = [
      { key: 'clave', short: 'CL', name: { en: 'Clave', ru: 'Клаве' } },
      { key: 'bell', short: 'BL', name: { en: 'Bell', ru: 'Колокол' } },
      { key: 'conga', short: 'CG', name: { en: 'Conga', ru: 'Конга' } },
      { key: 'tumba', short: 'TU', name: { en: 'Low conga', ru: 'Низкая конга' } },
    ];
    const machine = (two: boolean) =>
      drumMachine({
        id: 'clave',
        kit: KIT_CLAVE,
        pattern: two ? { ...o.clave!.pattern, clave: flipClave(o.clave!.pattern.clave) } : o.clave!.pattern,
        bpm: o.clave!.tempo,
        label: two ? { en: 'Son clave, 2–3', ru: 'Сон-клаве, 2–3' } : { en: 'Son clave, 3–2', ru: 'Сон-клаве, 3–2' },
        presetName: {
          en: 'The preset is the son clave, a traditional pattern of five strokes, over a simple conga part written for this museum.',
          ru: 'Заготовка — сон-клаве, традиционный рисунок из пяти ударов, поверх простой партии конги, написанной для этого музея.',
        },
        voices,
      });
    const host = h('div.mx-clave', {});
    let two = false;
    const dir = h('button.btn.mx-clave-flip', { type: 'button', 'aria-pressed': 'false' }, pick({ en: 'Turn it round: 2–3', ru: 'Развернуть: 2–3' }));
    dir.addEventListener('click', () => {
      two = !two;
      dir.setAttribute('aria-pressed', String(two));
      dir.textContent = two ? pick({ en: 'Turn it back: 3–2', ru: 'Вернуть: 3–2' }) : pick({ en: 'Turn it round: 2–3', ru: 'Развернуть: 2–3' });
      host.querySelector('.mx-machine')?.replaceWith(machine(two));
    });
    host.append(
      h('p.mx-hint', {}, pick({ en: 'Three strokes, then two: the clave is heard as a question and an answer. Turned round, the same five strokes start with the two.', ru: 'Три удара, потом два: клаве звучит как вопрос и ответ. Если развернуть её, те же пять ударов начнутся с двух.' })),
      dir,
      machine(false),
    );
    return host;
  }
  if (key === 'call' && o.call) return callResponse();
  return null;
}

function recording(app: App, card: string): HTMLElement | null {
  const r = app.listen.cards[card]?.[0];
  return r ? listenBlock(r, { heading: pick({ en: 'The original recording', ru: 'Оригинальная запись' }) }) : null;
}

/** The element names of an object, in the reader's language. */
function elementName(app: App, id: string): string {
  const e = app.elements.elements.find((x) => x.id === id);
  return e ? pick({ en: e.name, ru: e.nameRu ?? e.name }) : id;
}

/** The label of an object: which element, where and when, who, where next; and its roads. */
function label(app: App, l: ObjectLabel): HTMLElement {
  const cardsHere = l.cards.map((id) => app.set.forEdition(id, app.edition) ?? app.set.get(id)).filter((c): c is NonNullable<typeof c> => !!c);
  const threads = l.elements.filter((id) => app.elements.elements.some((e) => e.id === id));
  return h(
    'div.mx-label',
    {},
    h(
      'dl.mx-label-list',
      {},
      h('dt', {}, pick({ en: 'Where and when', ru: 'Где и когда' })),
      h('dd', {}, pick(l.when)),
      h('dt', {}, pick({ en: 'Who made it', ru: 'Кто это сделал' })),
      h('dd', {}, pick(l.who)),
      h('dt', {}, pick({ en: 'Where it went next', ru: 'Куда это пошло дальше' })),
      h('dd', {}, pick(l.next)),
    ),
    h(
      'div.mx-roads',
      {},
      threads.length
        ? h(
            'p.mx-threads',
            {},
            h('span', {}, pick({ en: 'Its thread in Roots: ', ru: 'Его нить в «Корнях»: ' })),
            ...threads.flatMap((id, i) => [i ? ', ' : '', h('a.mx-thread', { href: `#view=roots&item=${id}`, 'data-roots-element': id }, elementName(app, id))]),
          )
        : null,
      cardsHere.length ? h('p.mx-cardlinks', {}, h('span', {}, pick({ en: 'Cards: ', ru: 'Карточки: ' })), ...cardsHere.flatMap((c, i) => [i ? ' · ' : '', h('a', { href: `#focus=${c.id}`, 'data-card': c.id }, c.title)])) : null,
    ),
  );
}

/** One object, as a section: the element it lets you touch, the instrument, its label. */
export function objectBlock(app: App, o: ObjectsFile, key: Key, where: 'card' | 'shelf'): HTMLElement | null {
  const inst = instrument(app, key, o, where);
  const l = o[key];
  if (!inst || !l) return null;
  const first = l.elements[0];
  const drawer = where === 'shelf' ? drawerHook?.(key) : null;
  return h(
    `section.mx-object.mx-obj-${key}`,
    { id: `object-${key}`, 'aria-labelledby': `object-${key}-${where}` },
    h(
      'div.mx-object-head',
      {},
      h('div.kicker', {}, pick({ en: 'Element', ru: 'Элемент' }), ': ', first ? elementName(app, first) : ''),
      h(where === 'card' ? 'h3' : 'h2', { id: `object-${key}-${where}` }, pick(l.name)),
    ),
    h('p.mx-object-text', {}, pick(l.what)),
    inst,
    where === 'shelf' ? label(app, l) : null,
    where === 'card' ? h('a.mx-more', { href: `#view=workshop&item=${key}`, 'data-mech': 'workshop', 'data-item': key }, pick({ en: 'Its story in the Workshop →', ru: 'Его история — в Мастерской →' })) : null,
    drawer,
  );
}

export function objectKeyForCard(o: ObjectsFile, card: string): Key | undefined {
  return OBJECT_KEYS.find((k) => o[k]?.card === card);
}

/** The Workshop: why these elements, then every object, one after another. */
export function shelf(app: App, o: ObjectsFile): HTMLElement {
  return h(
    'div.mx-shelf',
    {},
    h(
      'header.mx-head',
      {},
      h('h2', {}, pick({ en: 'The Workshop', ru: 'Мастерская' })),
      o.intro ? h('p.mx-lede', {}, pick(o.intro)) : null,
      h(
        'p.mx-hint',
        {},
        pick({
          en: 'Sound starts only when you press something, and only one thing plays at a time.',
          ru: 'Звук появляется, только когда вы что-то нажмёте, и одновременно звучит что-то одно.',
        }),
      ),
    ),
    ...OBJECT_KEYS.map((k) => objectBlock(app, o, k, 'shelf')),
  );
}
