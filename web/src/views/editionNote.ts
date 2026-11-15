// The two copies, said plainly: both hold the whole dictionary; they tell the
// same themes with a man's and a woman's view, so some cards read differently
// and some chapter steps tell another story. Which one you hold, a switch to
// the other, and the list of pairs straight from the cards.
import type { App } from '../app';
import { h, reducedMotion } from '../lib/dom';
import { lang, pick, pluralRu } from '../lib/i18n';
import { setEdition } from '../lib/reader';
import { rememberPlace } from '../lib/place';
import type { Card } from '../lib/types';

/** Stories named in the note before the rest are counted. */
const SHOWN = 3;
const EN_NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const RU_IN = ['ни в одном месте', 'в одном месте', 'в двух местах', 'в трёх местах', 'в четырёх местах', 'в пяти местах', 'в шести местах', 'в семи местах', 'в восьми местах', 'в девяти местах', 'в десяти местах'];
const COPY_PARAGRAPH = /(^|\n)\s*\{(male|female)\}\s/;
const RU_ALL = ['', 'Единственная пара', 'Обе пары', 'Все три пары', 'Все четыре пары', 'Все пять пар', 'Все шесть пар', 'Все семь пар', 'Все восемь пар', 'Все девять пар', 'Все десять пар'];

export interface Pair {
  id: string;
  m: Card;
  f: Card;
}

/** The m/f cards, matched by `pair`: one theme, a story for each copy's chapter. */
export function editionPairs(app: Pick<App, 'set'>): Pair[] {
  const by = new Map<string, Partial<Pair>>();
  for (const c of app.set.all()) {
    if ((c.edition !== 'm' && c.edition !== 'f') || !c.pair) continue;
    const p = by.get(c.pair) ?? { id: c.pair };
    p[c.edition] = c;
    by.set(c.pair, p);
  }
  // In the order the chapters tell them.
  return [...by.values()].filter((p): p is Pair => !!p.m && !!p.f).sort((a, b) => (a.m.era ?? '').localeCompare(b.m.era ?? ''));
}

/** Switch copies at once and rebuild the museum where the reader is. */
export function switchEdition(to: 'm' | 'f'): void {
  setEdition(to);
  // Come back to the same place in the story after the rebuild.
  const here = rememberPlace();
  if (here && !/(^|[#&])view=/.test(location.hash)) {
    const q = new URLSearchParams(location.hash.slice(1));
    q.set('ch', here.ch);
    if (here.step >= 0) q.set('step', String(here.step));
    else q.delete('step');
    history.replaceState(null, '', `#${q.toString()}`);
  }
  location.reload();
}

export function editionNote(app: App): HTMLElement {
  const ru = lang() === 'ru';
  const pairs = editionPairs(app);
  const mine = app.edition;
  const other: 'm' | 'f' = mine === 'f' ? 'm' : 'f';
  const n = pairs.length;
  // Cards whose own text differs between the copies ({male}/{female} paragraphs).
  const varied = app.set.all().some((c) => COPY_PARAGRAPH.test(app.raw(c.id)?.body ?? ''));
  // Every pair from the data, in each copy's own words.
  // Names come from the cards themselves, so a new pair needs no code here.
  const name = (c: Card) => (ru ? `«${c.title}»` : c.inline || c.title.replace(/^The /, 'the '));
  const join = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} ${ru ? 'и' : 'and'} ${xs[xs.length - 1]}` : xs.join(''));
  // Only the reader's own stories are named: the other copy stays a door, not a summary.
  // With many pairs, three names and a count: the whole list is behind the button.
  const names = pairs.map((p) => name(p[mine]));
  const rest = names.length - SHOWN;
  const own =
    rest > 1
      ? `${names.slice(0, SHOWN).join(', ')} ${ru ? `и ещё ${rest} ${pluralRu(rest, ['историю', 'истории', 'историй'])}` : `and ${rest} more stories`}`
      : join(names);
  const text = ru
    ? `Как у Павича, у музея два экземпляра — мужской и женский. В каждом весь словарь: любая карточка открывается в обоих. Темы у них одни и те же, но в одном они увидены глазами мужчины, в другом — глазами женщины: ${varied ? 'иные карточки читаются в них по-разному, а ' : ''}${RU_IN[n] ?? `в ${n} местах`} глава рассказывает свою тему через другую историю. У вас — ${mine === 'f' ? 'женский' : 'мужской'}; в его главах вы прочтёте: ${own}.`
    : `Like Pavić’s dictionary, this museum has two copies, a male and a female one. Each holds the whole dictionary: every card opens in both. They tell the same themes, one with a man’s view and one with a woman’s: ${varied ? 'some cards read differently in each, and ' : ''}in ${EN_NUM[n] ?? n} places a chapter tells its theme through another story. Yours is the ${mine === 'f' ? 'female' : 'male'} copy; in its chapters you read ${own}.`;

  const list = h(
    'ol.ed-pairs',
    {},
    pairs.map((p) =>
      h(
        'li',
        {},
        pairLink(app, p.m),
        h('span.ed-dash', {}, ' / '),
        pairLink(app, p.f),
      ),
    ),
  );
  const box = h('div.ed-box', { hidden: true }, h('p.ed-head', {}, pick({ en: 'Male copy / Female copy', ru: 'Мужской экземпляр / Женский экземпляр' })), list);
  const listBtn = h(
    'button.btn.ed-list',
    {
      type: 'button',
      'aria-expanded': 'false',
      onclick: () => {
        box.hidden = !box.hidden;
        listBtn.setAttribute('aria-expanded', String(!box.hidden));
        // The list opens below the fold on most screens: bring it into view.
        if (!box.hidden) box.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
      },
    },
    ru ? RU_ALL[n] || `Все пары (${n})` : n === 2 ? 'Both pairs' : `All ${EN_NUM[n] ?? n} pairs`,
  );
  return h(
    'div.ed-note',
    {},
    h('p', {}, text),
    h(
      'div.ed-actions',
      {},
      h('button.btn.ed-switch', { type: 'button', onclick: () => switchEdition(other) }, pick({ en: `Open the ${other === 'm' ? 'male' : 'female'} copy`, ru: `Открыть ${other === 'm' ? 'мужской' : 'женский'} экземпляр` })),
      listBtn,
    ),
    box,
  );
}

/** A card of a pair; the reader's own half is marked in the list. */
export function pairLink(app: App, c: Card, label?: string): HTMLElement {
  return h('a', { href: `#focus=${c.id}`, 'data-card': c.id, class: c.edition === app.edition ? 'mine' : 'other' }, label ?? c.title);
}

/**
 * On a card of a pair, one quiet line naming the card that tells the same
 * theme in the other copy. Seen from the other copy, the line names the
 * reader's own card instead, so it is true whichever copy is held.
 */
export function pairLine(app: App, c: Card): HTMLElement | null {
  if (c.edition !== 'm' && c.edition !== 'f') return null;
  const p = app.set.partner(c.id);
  if (!p) return null;
  const mine = c.edition === app.edition;
  const link = pairLink(app, p, lang() === 'ru' ? `«${p.title}»` : `“${p.title}”`);
  return h(
    'p.pair-line',
    {},
    mine ? pick({ en: 'In the other copy this theme is told through ', ru: 'В другом экземпляре эту тему рассказывает ' }) : pick({ en: 'In your copy this theme is told through ', ru: 'В вашем экземпляре эту тему рассказывает ' }),
    link,
    '.',
  );
}
