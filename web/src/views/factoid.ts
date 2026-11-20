// A factoid as the museum shows it, wherever it appears (a card's footer, a
// quiet stretch of the descent, a dot on the atlas, the random-fact panel):
// its year, the sentence with the dictionary woven in, the cards it belongs
// to, and on demand the two sources it was checked against.
import type { App } from '../app';
import { cardLink } from '../app';
import { formatYears } from '../lib/cards';
import { h, svgIcon } from '../lib/dom';
import { pick } from '../lib/i18n';
import { cardFactoids, pickFactoid, type Factoid } from '../lib/factoids';
import * as reader from '../lib/reader';
import { weave } from '../lib/weave';

let uid = 0;

export interface FactViewOptions {
  /** The card being read: not linked again from its own footer. */
  from?: string;
  /** Heading level-free compact form (descent, atlas). */
  compact?: boolean;
}

export function factoidView(app: App, f: Factoid, o: FactViewOptions = {}): HTMLElement {
  const text = h('p.fx-text', { lang: pick({ en: 'en', ru: 'ru' }) }, pick({ en: f.en, ru: f.ru }));
  weave(app, text, { exclude: o.from ? [o.from] : [] });
  const cards = f.cards.filter((id) => id !== o.from && app.set.get(id));
  const srcId = `fx-src-${++uid}`;
  const sources = h(
    'ol.fx-sources',
    { id: srcId, hidden: true, 'aria-label': pick({ en: 'How we checked it', ru: 'Как мы это проверили' }) },
    f.sources.map((s) => h('li', {}, h('a', { href: s.url, rel: 'noopener', target: '_blank' }, s.title))),
    f.status === 'single-source' ? h('li.fx-single', {}, pick({ en: 'Checked against one source only.', ru: 'Проверено только по одному источнику.' })) : null,
  );
  const toggle = h(
    'button.fx-src-btn',
    {
      type: 'button',
      'aria-expanded': 'false',
      'aria-controls': srcId,
      onclick: () => {
        const open = sources.hidden;
        sources.hidden = !open;
        toggle.setAttribute('aria-expanded', String(open));
      },
    },
    pick({ en: 'Sources', ru: 'Источники' }),
  );
  return h(
    `div.fx${o.compact ? '.compact' : ''}`,
    { 'data-fact': f.id },
    h('span.fx-year', {}, formatYears([f.year])),
    text,
    h(
      'div.fx-foot',
      {},
      cards.length
        ? h(
            'span.fx-cards',
            {},
            pick({ en: 'Read: ', ru: 'Читать: ' }),
            ...cards.flatMap((id, i) => [i ? ' · ' : '', cardLink(app, id, app.set.get(id)!.title)]),
          )
        : null,
      toggle,
    ),
    sources,
  );
}

/** «Знаете ли вы» on a card: up to three factoids that belong to it, once they have arrived. */
export function factFooter(app: App, cardId: string): HTMLElement {
  const sec = h('section.sec.fx-footer', { hidden: true });
  const fill = () => {
    const list = cardFactoids(app.facts.list, cardId);
    if (!list.length) return;
    sec.replaceChildren(h('h3', {}, pick({ en: 'Did you know', ru: 'Знаете ли вы' })), ...list.map((f) => factoidView(app, f, { from: cardId })));
    sec.hidden = false;
  };
  app.facts.load();
  if (app.facts.list.length) fill();
  else void app.facts.ready.then(fill);
  return sec;
}

/**
 * The random-fact panel under the header: one factoid at a time, "another
 * one" for the next, chosen by the crumb picker's rules.
 */
export class FactPanel {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private prev = new Set<string>();
  private returnTo: Element | null = null;

  constructor(private app: App) {
    this.body = h('div.fx-panel-body', { 'aria-live': 'polite' });
    this.el = h(
      'aside.fx-panel',
      { role: 'dialog', 'aria-modal': 'false', 'aria-label': pick({ en: 'A fact from the archive', ru: 'Факт из архива' }), hidden: true, tabindex: '-1' },
      h(
        'div.fx-panel-bar',
        {},
        h('span.fx-panel-kicker', {}, pick({ en: 'Did you know', ru: 'Знаете ли вы' })),
        h('button.icon-btn.close', { type: 'button', 'aria-label': pick({ en: 'Close', ru: 'Закрыть' }), onclick: () => this.close() }, svgIcon('close')),
      ),
      this.body,
      h('div.fx-panel-actions', {}, h('button.btn', { type: 'button', 'data-fact-next': '', onclick: () => this.next() }, pick({ en: 'Another one', ru: 'Ещё один' }))),
    );
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.close();
      }
    });
    // Following a card link reads the card; the panel steps aside.
    this.el.addEventListener('click', (e) => {
      if ((e.target as Element).closest('[data-card]')) this.close(false);
    });
    document.body.append(this.el);
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    if (!this.isOpen) this.returnTo = document.activeElement;
    this.el.hidden = false;
    this.mark(true);
    this.next();
    this.app.facts.load();
    if (!this.app.facts.list.length) void this.app.facts.ready.then(() => this.isOpen && this.next());
    this.el.focus({ preventScroll: true });
  }

  close(restore = true): void {
    if (!this.isOpen) return;
    this.el.hidden = true;
    this.mark(false);
    if (restore && this.returnTo instanceof HTMLElement) this.returnTo.focus({ preventScroll: true });
  }

  /** The header button says whether its panel is open. */
  private mark(open: boolean): void {
    document.querySelector('.nav [data-open-fact]')?.setAttribute('aria-expanded', String(open));
  }

  next(): void {
    const path = reader.readPath();
    const last = path.length ? this.app.set.get(path[path.length - 1]) : undefined;
    const f = pickFactoid(this.app.facts.list, { seen: reader.readFactsSeen(), prev: this.prev, last });
    if (!f) {
      this.body.replaceChildren(h('p.fx-text', {}, pick({ en: 'The facts are still on their way. Try again in a moment.', ru: 'Факты ещё в пути. Попробуйте через минуту.' })));
      return;
    }
    reader.recordFactSeen(f.id);
    this.body.replaceChildren(factoidView(this.app, f));
  }
}
