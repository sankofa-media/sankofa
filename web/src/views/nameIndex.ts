// The name index (#view=index): every entry of the dictionary from A to Z in
// the reader's language, with a letter bar, a filter and the kinds of card.
// Each entry opens its card in place. Both copies hold the whole dictionary,
// so every card is listed alike, whichever copy the reader holds.
import type { App } from '../app';
import { h } from '../lib/dom';
import { formatYears, KIND_LABEL } from '../lib/cards';
import { count, lang, pick, t } from '../lib/i18n';
import { filterEntries, indexEntries, letters, type IndexEntry } from '../lib/nameIndex';

/** The kinds in the order the chips show them. */
const KINDS = ['person', 'genre', 'place', 'work', 'event', 'object', 'media', 'language', 'script', 'instrument', 'myth', 'comparison'];

export function nameIndex(app: App): HTMLElement {
  const l = lang();
  const all = indexEntries(app.set.all(), l, app.raw);
  const kinds = new Set<string>();
  let query = '';

  const status = h('p.ix-count', { role: 'status', 'aria-live': 'polite' });
  const bar = h('nav.ix-letters', { 'aria-label': pick({ en: 'Letters', ru: 'Буквы' }) });
  const list = h('div.ix-list');
  const input = h('input.ix-filter', {
    type: 'search',
    id: 'ix-filter',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: pick({ en: 'A name, a title, a word…', ru: 'Имя, название, слово…' }),
  }) as HTMLInputElement;
  const present = KINDS.filter((k) => all.some((e) => e.kind === k));
  const chips = h(
    'div.ix-kinds',
    { role: 'group', 'aria-label': pick({ en: 'Kinds of card', ru: 'Виды карточек' }) },
    present.map((k) =>
      h(
        'button.ix-chip',
        {
          type: 'button',
          'aria-pressed': 'false',
          'data-kind': k,
          onclick: (e: Event) => {
            const b = e.currentTarget as HTMLElement;
            if (kinds.has(k)) kinds.delete(k);
            else kinds.add(k);
            b.setAttribute('aria-pressed', String(kinds.has(k)));
            render();
          },
        },
        t(KIND_LABEL[k] ?? k),
      ),
    ),
  );

  const entry = (e: IndexEntry) =>
    h(
      'li',
      {},
      h(
        'a.ix-entry',
        { href: `#focus=${e.id}`, 'data-card': e.id },
        h('span.ix-title', {}, e.title),
        h('span.ix-meta', {}, [formatYears(e.years), t(KIND_LABEL[e.kind] ?? e.kind)].filter(Boolean).join(' · ')),
        h('span.ix-wow', {}, e.wow),
      ),
    );

  const render = () => {
    const shown = filterEntries(all, query, kinds);
    const have = new Set(shown.map((e) => e.letter));
    bar.replaceChildren(
      ...letters(all).map((L, i, ls) =>
        h(
          // Where Russian letters give way to Latin ones, a gap says so.
          `button.ix-letter${i && /\p{Script=Cyrillic}/u.test(ls[i - 1]) && !/\p{Script=Cyrillic}/u.test(L) ? '.ix-gap' : ''}`,
          {
            type: 'button',
            'data-letter': L,
            'aria-label': pick({ en: `Entries under ${L}`, ru: `Статьи на букву ${L}` }),
            ...(have.has(L) ? {} : { disabled: true }),
            onclick: () => {
              const head = list.querySelector<HTMLElement>(`[data-letter-head="${CSS.escape(L)}"]`);
              head?.scrollIntoView({ block: 'start' });
              head?.focus({ preventScroll: true });
            },
          },
          L,
        ),
      ),
    );
    const groups = new Map<string, IndexEntry[]>();
    for (const e of shown) (groups.get(e.letter) ?? groups.set(e.letter, []).get(e.letter)!).push(e);
    list.replaceChildren(
      ...[...groups].map(([L, es]) =>
        h('section.ix-group', { 'aria-labelledby': `ix-${L}` }, h('h3.ix-head', { id: `ix-${L}`, tabindex: '-1', 'data-letter-head': L }, L), h('ul', {}, es.map(entry))),
      ),
      ...(shown.length ? [] : [h('p.mx-empty', {}, pick({ en: 'No entry matches.', ru: 'Ничего не нашлось.' }))]),
    );
    status.textContent = shown.length === all.length ? pick({ en: `${count(all.length, 'card', 'en')}`, ru: `${count(all.length, 'card', 'ru')}` }) : pick({ en: `${shown.length} of ${all.length}`, ru: `${shown.length} из ${all.length}` });
  };
  input.addEventListener('input', () => {
    query = input.value;
    render();
  });
  render();

  return h(
    'article.mx-index',
    {},
    h(
      'header.mx-head',
      {},
      h('h2', {}, pick({ en: 'Index', ru: 'Указатель' })),
      h(
        'p.mx-lede',
        {},
        pick({
          en: 'Every entry of the dictionary from A to Z: people, places, songs, books and the words between them. Each one opens its card.',
          ru: 'Все статьи словаря от А до Я — люди, места, песни, книги и слова между ними. Каждая открывает свою карточку.',
        }),
      ),
    ),
    h(
      'div.ix-tools',
      {},
      h('label.mx-sr', { for: 'ix-filter' }, pick({ en: 'Filter the index', ru: 'Найти в указателе' })),
      input,
      chips,
      status,
    ),
    bar,
    list,
  );
}
