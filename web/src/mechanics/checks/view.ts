// "How we checked": the panel at the foot of every card, and the page that
// explains the method with the museum's own totals.
import type { Card } from '../../lib/types';
import { h } from '../../lib/dom';
import { formatNumber, lang, pick, pluralRu } from '../../lib/i18n';
import type { AgentCheck, CardChecks, ChecksFile, FactCheck, MediaRight } from './model';

const STATUS: Record<string, { en: string; ru: string }> = {
  agreed: { en: 'Both agents confirmed it', ru: 'Подтвердили оба агента' },
  'recheck-confirmed': { en: 'Confirmed on re-check', ru: 'Подтверждено при перепроверке' },
  corrected: { en: 'Kept in a corrected form', ru: 'Оставлено в исправленном виде' },
  disputed: { en: 'Kept as contested', ru: 'Оставлено как спорное' },
  confirmed: { en: 'Confirmed by a second agent', ru: 'Подтверждено вторым агентом' },
};

const VERDICT: Record<string, { en: string; ru: string }> = {
  confirmed: { en: 'confirmed', ru: 'подтвердил' },
  corrected: { en: 'corrected', ru: 'уточнил' },
  removed: { en: 'set aside', ru: 'отложил' },
  unverified: { en: 'could not confirm', ru: 'не смог подтвердить' },
  disputed: { en: 'found it contested', ru: 'счёл спорным' },
  refuted: { en: 'refuted', ru: 'опроверг' },
  unchecked: { en: 'not checked', ru: 'не проверял' },
};

const AGENT: Record<AgentCheck['agent'], { en: string; ru: string }> = {
  A: { en: 'Agent A', ru: 'Агент А' },
  B: { en: 'Agent B', ru: 'Агент Б' },
  W: { en: 'The writer’s sources', ru: 'Источники автора' },
  C: { en: 'Second agent', ru: 'Второй агент' },
};

const plural = (n: number, en: [string, string], ru: [string, string, string]) => `${formatNumber(n)} ${lang() === 'ru' ? pluralRu(n, ru) : n === 1 ? en[0] : en[1]}`;

function verdict(v: string): string {
  return VERDICT[v] ? pick(VERDICT[v]) : v;
}

function agentBlock(c: AgentCheck): HTMLElement {
  return h(
    'div.ck-agent',
    {},
    h(
      'p.ck-who',
      {},
      h('b', {}, pick(AGENT[c.agent])),
      ' ',
      verdict(c.verdict),
      c.recheck ? h('span.ck-re', {}, pick({ en: ` on re-check (first: ${verdict(c.first ?? '')})`, ru: ` при перепроверке (сначала: ${verdict(c.first ?? '')})` })) : null,
    ),
    c.sources.length
      ? h(
          'ul.ck-sources',
          {},
          c.sources.map((s) => h('li', {}, s.url ? h('a', { href: s.url, rel: 'noopener', target: '_blank' }, s.title) : s.title)),
        )
      : h('p.ck-none', {}, pick({ en: 'No sources recorded for this verdict.', ru: 'Источники для этого вердикта не записаны.' })),
    c.note ? h('p.ck-agent-note', { lang: 'en' }, c.note) : null,
  );
}

function factRow(f: FactCheck, i: number): HTMLElement {
  return h(
    'li.ck-fact',
    {},
    h(
      'details',
      {},
      h('summary', {}, h('span.ck-n', { 'aria-hidden': 'true' }, String(i + 1)), h('span.ck-text', { lang: 'en' }, f.fact), h(`span.ck-status.s-${f.status}`, {}, STATUS[f.status] ? pick(STATUS[f.status]) : f.status)),
      f.unledgered
        ? h('p.ck-unledgered', {}, pick({ en: 'The writer added this sentence without recording it; the second agent found it in the card and checked it on its own.', ru: 'Автор добавил это предложение, не записав его в журнал; второй агент нашёл его в карточке и проверил сам.' }))
        : null,
      f.checks.length
        ? h('div.ck-agents', {}, f.checks.map(agentBlock))
        : h('p.ck-none', {}, pick({ en: 'The ledger records the result; the two agents filed this fact under other wording.', ru: 'Результат записан в журнале; агенты проверяли этот факт в другой формулировке.' })),
    ),
  );
}

function mediaRow(m: MediaRight): HTMLElement {
  return h(
    'li.ck-media',
    {},
    h('p', {}, h('b', {}, m.file), ' · ', h('a', { href: m.url, rel: 'noopener', target: '_blank' }, m.license)),
    m.wording ? h('blockquote.ck-quote', { lang: 'en' }, m.wording) : null,
    h(
      'p.ck-meta',
      {},
      m.verified ? pick({ en: `Read on the source page on ${m.verified}.`, ru: `Прочитано на странице источника ${m.verified}.` }) : null,
      m.second ? ' ' + pick({ en: `Second check: ${m.second.verdict}.`, ru: `Вторая проверка: ${m.second.verdict === 'ok' ? 'без замечаний' : m.second.verdict === 'fix' ? 'подпись исправлена' : m.second.verdict}.` }) : null,
      m.sha256 ? h('span.ck-sha', { title: 'SHA-256' }, ` SHA-256 ${m.sha256.slice(0, 12)}…`) : null,
    ),
  );
}

/** The panel at the foot of a card. */
export function checksPanel(c: Card, data: CardChecks | undefined): HTMLElement | null {
  const facts = data?.facts ?? [];
  const media = data?.media ?? [];
  // Pictures on the card without a ledger entry still show the rights the card records.
  const known = new Set(media.map((m) => m.file));
  const onCard = (c.media ?? []).filter((m) => !known.has(m.file));
  if (!facts.length && !media.length && !onCard.length) return null;
  return h(
    'details.sec.mx-checks',
    {},
    h('summary', {}, pick({ en: 'How we checked', ru: 'Как мы проверяли' }), h('span.ck-count', {}, facts.length ? plural(facts.length, ['fact', 'facts'], ['факт', 'факта', 'фактов']) : '')),
    h(
      'p.ck-intro',
      {},
      pick({
        en: 'Each fact on this card was checked twice, independently, against independent sources: by two agents, or by the writer who added it and a second agent who reopened every source. Open a fact to see who checked it and with what.',
        ru: 'Каждый факт этой карточки проверен дважды, независимо и по независимым источникам: двумя агентами или автором, который его добавил, и вторым агентом, заново открывшим каждый источник. Откройте факт, чтобы увидеть, кто его проверял и по каким источникам.',
      }),
      ' ',
      h('a', { href: '#view=method', 'data-mech': 'method' }, pick({ en: 'How the museum checks facts →', ru: 'Как музей проверяет факты →' })),
    ),
    facts.length ? h('ol.ck-facts', {}, facts.map(factRow)) : null,
    media.length || onCard.length
      ? h(
          'section.ck-pictures',
          {},
          h('h4', {}, pick({ en: 'Pictures, sounds and their rights', ru: 'Изображения, звук и права на них' })),
          h(
            'ul',
            {},
            media.map(mediaRow),
            onCard.map((m) => h('li.ck-media', {}, h('p', {}, h('b', {}, m.file), ' · ', m.url ? h('a', { href: m.url, rel: 'noopener', target: '_blank' }, m.license) : m.license), h('p.ck-meta', {}, m.credit))),
          ),
        )
      : null,
  );
}

/** The site page: the method in plain words, and the totals from the ledgers. */
/** Who "the two agents" are, said once, plainly. */
export function agentsNote(): HTMLElement {
  return h(
    'p.mx-agents',
    {},
    h('b', {}, pick({ en: 'Who the two agents are. ', ru: 'Кто такие два агента. ' })),
    pick({
      en: 'Two independent AI research agents. Each had to find two independent, authoritative sources for every fact; a fact stays only if both agents confirm it.',
      ru: 'Два независимых исследовательских ИИ-агента. Каждый должен был найти для каждого факта два независимых авторитетных источника; факт остаётся, только если его подтвердили оба агента.',
    }),
  );
}

export function methodPage(data: ChecksFile): HTMLElement {
  const t = data.totals;
  const kept = (s: string) => t.byStatus[s] ?? 0;
  const stat = (n: number, label: string) => h('div.ck-stat', {}, h('b', {}, formatNumber(n)), h('span', {}, label));
  const rf = (n: number, one: string, many: string, ruf: [string, string, string]) => (lang() === 'ru' ? pluralRu(n, ruf) : n === 1 ? one : many);
  return h(
    'article.mx-method',
    {},
    h(
      'header.mx-head',
      {},
      h('h2', {}, pick({ en: 'How we checked', ru: 'Как мы проверяли' })),
      h(
        'p.mx-lede',
        {},
        pick({
          en: 'A museum that asks to be believed has to show its work. Here is the rule every card follows, and what it cost.',
          ru: 'Музей, который просит ему верить, должен показать свою работу. Вот правило, которому следует каждая карточка, и чего оно стоило.',
        }),
      ),
    ),
    h(
      'section.ck-rule',
      {},
      h(
        'p',
        {},
        pick({
          en: 'Every fact was checked by two agents working independently of each other. Each looked for two independent, authoritative sources: archives, libraries, museums, scholars, established newspapers. Two pages copying each other count as one. A fact stays only if both agents confirm it.',
          ru: 'Каждый факт проверили два агента, работавшие независимо друг от друга. Каждый искал два независимых авторитетных источника: архивы, библиотеки, музеи, работы учёных, солидные газеты. Две страницы, переписанные одна с другой, считаются за одну. Факт остаётся, только если его подтвердили оба агента.',
        }),
      ),
      agentsNote(),
      h(
        'p',
        {},
        pick({
          en: 'When one agent confirmed a fact and the other had set it aside, the second agent went back to it with the first one’s sources and looked again on its own. Some facts survived only in a narrower, corrected form. A few could not be settled; they stay on their cards marked as contested, with both sides named.',
          ru: 'Если один агент факт подтвердил, а другой отложил, второй возвращался к нему с источниками первого и искал заново сам. Некоторые факты уцелели лишь в более узкой, исправленной форме. Несколько так и не удалось решить: они остаются на карточках с пометкой «спорно», и обе стороны названы.',
        }),
      ),
      h(
        'p',
        {},
        pick({
          en: 'When the cards were rewritten to give each story its context and its outcome, the writer recorded every new fact with at least two independent sources and a quotation from each. A second agent then reopened every one of those pages, looked for each quotation in the page itself, and gave its own verdict; it also read the cards against their sources and checked, the same way, the sentences the writer had added without recording them. What it could not confirm was taken out of the cards.',
          ru: 'Когда карточки переписывали, чтобы у каждой истории были предыстория и развязка, автор записывал каждый новый факт минимум с двумя независимыми источниками и цитатой из каждого. Затем второй агент заново открыл каждую из этих страниц, нашёл каждую цитату в самом тексте страницы и вынес свой вердикт; кроме того, он сверил карточки с источниками и так же проверил предложения, которые автор добавил, не записав. То, что подтвердить не удалось, из карточек убрано.',
        }),
      ),
      h(
        'p',
        {},
        pick({
          en: 'Pictures follow the same discipline. Each one is public domain or openly licensed, and the licence was read on the file’s own source page and copied word for word, with the date and a checksum of the file. A second check reopened every source page.',
          ru: 'Изображения подчиняются той же дисциплине. Каждое находится в общественном достоянии или под открытой лицензией; лицензию прочитали на странице самого файла и переписали слово в слово, с датой и контрольной суммой файла. Вторая проверка заново открыла каждую такую страницу.',
        }),
      ),
    ),
    h(
      'section.ck-totals',
      { 'aria-label': pick({ en: 'Totals from the ledgers', ru: 'Итоги по журналам проверки' }) },
      h('h3', {}, pick({ en: 'The ledgers, counted', ru: 'Журналы проверки в цифрах' })),
      h(
        'div.ck-stats',
        {},
        stat(t.claimsExamined, rf(t.claimsExamined, 'claim examined', 'claims examined', ['утверждение рассмотрено', 'утверждения рассмотрено', 'утверждений рассмотрено'])),
        stat(t.facts, rf(t.facts, `fact kept on ${t.cards} cards`, `facts kept on ${t.cards} cards`, [`факт остался на ${t.cards} ${pluralRu(t.cards, ['карточке', 'карточках', 'карточках'])}`, `факта осталось на ${t.cards} ${pluralRu(t.cards, ['карточке', 'карточках', 'карточках'])}`, `фактов осталось на ${t.cards} ${pluralRu(t.cards, ['карточке', 'карточках', 'карточках'])}`])),
        stat(t.refuted, rf(t.refuted, 'found wrong and removed', 'found wrong and removed', ['оказалось неверным и удалено', 'оказались неверными и удалены', 'оказались неверными и удалены'])),
        stat(t.unconfirmed, rf(t.unconfirmed, 'could not be confirmed twice and was dropped', 'could not be confirmed twice and were dropped', ['не удалось подтвердить дважды — выброшено', 'не удалось подтвердить дважды — выброшены', 'не удалось подтвердить дважды — выброшены'])),
      ),
      h(
        'ul.ck-breakdown',
        {},
        h('li', {}, pick({ en: `${formatNumber(kept('agreed'))} confirmed by both agents in the first round;`, ru: `${formatNumber(kept('agreed'))} — подтвердили оба агента в первом же круге;` })),
        h('li', {}, pick({ en: `${formatNumber(kept('recheck-confirmed'))} confirmed when the second agent re-checked them (${formatNumber(t.rechecked)} claims went back for a re-check);`, ru: `${formatNumber(kept('recheck-confirmed'))} — подтверждены, когда второй агент перепроверил их (всего на перепроверку вернулось ${formatNumber(t.rechecked)} утверждений);` })),
        h('li', {}, pick({ en: `${formatNumber(t.explainers)} added when cards were rewritten to explain their subject, each confirmed by a second agent;`, ru: `${formatNumber(t.explainers)} — добавлены, когда карточки переписывали, чтобы объяснить сам предмет, и каждый подтвердил второй агент;` })),
        h(
          'li',
          {},
          pick({
            en: `${formatNumber(t.context.kept)} added when cards were rewritten for context and outcomes: of ${formatNumber(t.context.facts)} facts the writer recorded with sources and ${formatNumber(t.context.unledgered)} sentences it had not recorded, the second check confirmed ${formatNumber(t.context.confirmed)}, corrected ${formatNumber(t.context.corrected)} and took ${formatNumber(t.context.dropped)} out;`,
            ru: `${formatNumber(t.context.kept)} — добавлены, когда карточки переписывали ради предыстории и развязки: из ${formatNumber(t.context.facts)} ${pluralRu(t.context.facts, ['факта', 'фактов', 'фактов'])}, записанных автором с источниками, и ${formatNumber(t.context.unledgered)} ${pluralRu(t.context.unledgered, ['предложения', 'предложений', 'предложений'])}, которые он не записал, вторая проверка подтвердила ${formatNumber(t.context.confirmed)}, исправила ${formatNumber(t.context.corrected)} и убрала ${formatNumber(t.context.dropped)};`,
          }),
        ),
        h(
          'li',
          {},
          pick({
            en: `${formatNumber(t.expansion.kept)} on the new cards: of ${formatNumber(t.expansion.facts)} facts the writers recorded with sources and ${formatNumber(t.expansion.unledgered)} sentences they had not recorded, an independent second check confirmed ${formatNumber(t.expansion.confirmed)}, corrected ${formatNumber(t.expansion.corrected)} and took ${formatNumber(t.expansion.dropped)} out;`,
            ru: `${formatNumber(t.expansion.kept)} — на новых карточках: из ${formatNumber(t.expansion.facts)} ${pluralRu(t.expansion.facts, ['факта', 'фактов', 'фактов'])}, записанных авторами с источниками, и ${formatNumber(t.expansion.unledgered)} ${pluralRu(t.expansion.unledgered, ['предложения', 'предложений', 'предложений'])}, которые они не записали, независимая вторая проверка подтвердила ${formatNumber(t.expansion.confirmed)}, исправила ${formatNumber(t.expansion.corrected)} и убрала ${formatNumber(t.expansion.dropped)};`,
          }),
        ),
        h('li', {}, pick({ en: `${formatNumber(kept('corrected'))} kept in a corrected form, in all;`, ru: `${formatNumber(kept('corrected'))} — всего оставлены в исправленном виде;` })),
        h('li', {}, pick({ en: `${formatNumber(kept('disputed'))} kept only as contested.`, ru: `${formatNumber(kept('disputed'))} — оставлены только как спорные.` })),
      ),
      h(
        'p',
        {},
        pick({
          en: `Pictures: ${formatNumber(t.images)} licence records with the wording copied from the source page; the second check passed ${formatNumber(t.imageSecond.ok ?? 0)}, corrected the caption or credit of ${formatNumber(t.imageSecond.fix ?? 0)} and took ${formatNumber(t.imageSecond.reject ?? 0)} off their cards. Roots: ${formatNumber(t.rootsLinks)} links between musicians re-checked by a second agent, ${formatNumber(t.rootsByVerdict.confirmed ?? 0)} confirmed and ${formatNumber(t.rootsByVerdict.corrected ?? 0)} corrected.`,
          ru: `Изображения: ${formatNumber(t.images)} записей о лицензиях с формулировкой, переписанной со страницы источника; вторая проверка одобрила ${formatNumber(t.imageSecond.ok ?? 0)}, исправила подпись или авторство у ${formatNumber(t.imageSecond.fix ?? 0)} и сняла с карточек ${formatNumber(t.imageSecond.reject ?? 0)}. «Корни»: ${formatNumber(t.rootsLinks)} связей между музыкантами перепроверил второй агент, ${formatNumber(t.rootsByVerdict.confirmed ?? 0)} подтверждены, ${formatNumber(t.rootsByVerdict.corrected ?? 0)} исправлены.`,
        }),
      ),
      h('p.ck-note', {}, pick({ en: 'These numbers are counted from the ledgers each time the museum is built.', ru: 'Эти числа заново подсчитываются по журналам при каждой сборке музея.' })),
    ),
    h(
      'section.ck-where',
      {},
      h(
        'p',
        {},
        pick({
          en: 'On every card, the panel “How we checked” lists the card’s facts with both checks’ verdicts and sources, and the rights of its pictures. The ledgers themselves are in the museum’s repository, in content/ledger.',
          ru: 'На каждой карточке панель «Как мы проверяли» перечисляет её факты с вердиктами и источниками обеих проверок, а также права на её изображения. Сами журналы лежат в репозитории музея, в content/ledger.',
        }),
      ),
    ),
  );
}
