// The working objects as the reader meets them: on their cards, and together
// on the shelf. Every sentence here restates its card; the sounds are the
// card's own recording or synthesized in the browser.
import type { App } from '../../app';
import { h } from '../../lib/dom';
import { pick } from '../../lib/i18n';
import { drumMachine } from './drummachine';
import { gramophone } from './gramophone';
import type { ObjectsFile } from './model';
import { pads } from './pads';
import { KIT_808, KIT_ACOUSTIC } from './voices';
import { youtubeFacade } from './youtube';

type Key = 'gramophone' | 'tr808' | 'amen';
export const OBJECT_KEYS: Key[] = ['gramophone', 'tr808', 'amen'];

const NAMES: Record<Key, { en: string; ru: string }> = {
  gramophone: { en: 'The gramophone', ru: 'Граммофон' },
  tr808: { en: 'The drum machine', ru: 'Драм-машина' },
  amen: { en: 'The Amen pads', ru: 'Пэды Amen' },
};

const STORY: Record<Key, { en: string; ru: string }> = {
  gramophone: {
    en: 'On 10 August 1920 Mamie Smith recorded Perry Bradford’s “Crazy Blues” with her Jazz Hounds, and the record opened the “race records” market. This is that recording.',
    ru: '10 августа 1920 года Мейми Смит записала со своими Jazz Hounds песню Перри Брэдфорда «Crazy Blues», и эта пластинка открыла рынок «расовых пластинок». Здесь звучит та самая запись.',
  },
  tr808: {
    en: 'For “Planet Rock” in 1982, Afrika Bambaataa and Arthur Baker rebuilt Kraftwerk’s music on a Roland TR-808. Here every voice is synthesized in your browser, in the manner of that machine.',
    ru: 'Для «Planet Rock» в 1982 году Африка Бамбаатаа и Артур Бейкер пересобрали музыку Kraftwerk на Roland TR-808. Здесь каждый голос синтезирует ваш браузер, на манер той машины.',
  },
  amen: {
    en: 'Gregory C. Coleman’s drum break on the Winstons’ 1969 B-side “Amen, Brother” became one of the most sampled recordings ever. The recording is not ours to copy: these drums are synthesized, and the pattern is a re-creation.',
    ru: 'Барабанный брейк Грегори К. Коулмана на стороне Б сингла The Winstons «Amen, Brother» (1969) стал одной из самых сэмплируемых записей в истории. Копировать саму запись мы не вправе: эти барабаны синтезированы, а рисунок воссоздан заново.',
  },
};

function instrument(app: App, key: Key, o: ObjectsFile): HTMLElement | null {
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
      o.amen.youtube ? youtubeFacade('amen', o.amen.youtube) : null,
    );
  return null;
}

function cardOf(o: ObjectsFile, key: Key): string | undefined {
  return o[key]?.card;
}

/** One object, as a section: what it is, the instrument, and its card. */
export function objectBlock(app: App, o: ObjectsFile, key: Key, where: 'card' | 'shelf'): HTMLElement | null {
  const inst = instrument(app, key, o);
  if (!inst) return null;
  const card = cardOf(o, key);
  const c = card ? app.set.get(card) : undefined;
  return h(
    `section.mx-object.mx-obj-${key}`,
    { id: `object-${key}`, 'aria-labelledby': `object-${key}-${where}` },
    h('div.mx-object-head', {}, h('div.kicker', {}, pick({ en: 'Working object', ru: 'Действующий предмет' })), h(where === 'card' ? 'h3' : 'h2', { id: `object-${key}-${where}` }, pick(NAMES[key]))),
    h('p.mx-object-text', {}, pick(STORY[key])),
    inst,
    where === 'shelf' && c
      ? h('a.mx-more', { href: `#focus=${c.id}`, 'data-card': c.id }, pick({ en: `Read the card: ${c.title} →`, ru: `Читать карточку: ${c.title} →` }))
      : h('a.mx-more', { href: `#view=objects&item=${key}`, 'data-mech': 'objects', 'data-item': key }, pick({ en: 'All working objects →', ru: 'Все действующие предметы →' })),
  );
}

export function objectKeyForCard(o: ObjectsFile, card: string): Key | undefined {
  return OBJECT_KEYS.find((k) => o[k]?.card === card);
}

/** The shelf: every object, one after another. */
export function shelf(app: App, o: ObjectsFile): HTMLElement {
  return h(
    'div.mx-shelf',
    {},
    h(
      'header.mx-head',
      {},
      h('h2', {}, pick({ en: 'Working objects', ru: 'Действующие предметы' })),
      h(
        'p.mx-lede',
        {},
        pick({
          en: 'Three instruments from the cards, to play rather than to look at. Sound starts only when you press something, and only one plays at a time.',
          ru: 'Три инструмента из карточек — на них играют, а не разглядывают. Звук появляется, только когда вы что-то нажмёте, и одновременно звучит что-то одно.',
        }),
      ),
    ),
    ...OBJECT_KEYS.map((k) => objectBlock(app, o, k, 'shelf')),
  );
}
