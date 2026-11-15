import type { App } from '../app';
import { cardPoint, richText } from '../app';
import type { Card } from '../lib/types';
import { BOOK_NAMES, ERAS } from '../lib/types';
import { formatYears, KIND_LABEL } from '../lib/cards';
import { formatFragment, terminalCommand } from '../lib/fragment';
import { vtags, bookMarks, copyText, h, svgIcon, toast } from '../lib/dom';
import { eraColor } from '../lib/atlasModel';
import { chapterLabel, edition, lang, t } from '../lib/i18n';
import { editionNote, pairLine } from './editionNote';
import { cardYaml } from '../lib/cardYaml';
import { mediaSrc } from '../lib/media';
import { paragraphsOf } from '../lib/paragraphs';
import { cardCaches, cardChecks, cardExtras } from '../mechanics';
import { listenBlock } from './player';
import { stopWithin } from '../lib/sound';

/** A drawer that slides in from the right, with a focus trap and Esc to close. */
export class Drawer {
  readonly el: HTMLElement;
  private scrim: HTMLElement;
  private returnTo: Element | null = null;
  onClose?: () => void;

  constructor(label: string) {
    this.scrim = h('div.scrim', { 'aria-hidden': 'true' });
    this.el = h('aside.drawer', { role: 'dialog', 'aria-modal': 'true', 'aria-label': label, tabindex: '-1' });
    this.scrim.addEventListener('click', () => this.close());
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.close();
      }
      if (e.key === 'Tab') this.trap(e);
    });
    document.body.append(this.scrim, this.el);
  }

  get isOpen(): boolean {
    return this.el.classList.contains('on');
  }

  show(content: HTMLElement): void {
    if (!this.isOpen) this.returnTo = document.activeElement;
    stopWithin(this.el);
    const close = h('button.icon-btn.close', { 'aria-label': t('Close'), onclick: () => this.close() }, svgIcon('close'));
    // A sticky header holds the close button, so it never covers the text.
    const bar = h('div.drawer-bar', {}, h('span.drawer-label', {}, ...vtags(content.dataset.label ?? '')), close);
    this.el.replaceChildren(bar, content);
    this.el.scrollTop = 0;
    this.el.classList.add('on');
    this.scrim.classList.add('on');
    // The page behind stays still while a panel is open.
    document.documentElement.classList.add('panel-open');
    requestAnimationFrame(() => {
      if (this.isOpen) (this.el.querySelector<HTMLElement>('h2') ?? this.el).focus({ preventScroll: true });
    });
  }

  close(silent = false): void {
    if (!this.isOpen) return;
    // Nothing keeps playing behind a closed panel.
    stopWithin(this.el);
    this.el.classList.remove('on');
    this.scrim.classList.remove('on');
    document.documentElement.classList.remove('panel-open');
    if (this.returnTo instanceof HTMLElement || this.returnTo instanceof SVGElement) (this.returnTo as HTMLElement).focus?.({ preventScroll: true });
    if (!silent) this.onClose?.();
  }

  private trap(e: KeyboardEvent): void {
    const items = [...this.el.querySelectorAll<HTMLElement>('a[href], button, [tabindex="0"], audio')].filter((x) => x.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

export function renderCard(app: App, c: Card): HTMLElement {
  const era = ERAS.find((e) => e.id === c.era);
  const img = c.media?.find((m) => m.type === 'image');
  const audio = c.media?.filter((m) => m.type === 'audio') ?? [];
  const point = cardPoint(c);
  const term = h('div.term', {}, h('code', {}, terminalCommand(point)));
  term.append(
    h('button', { onclick: async () => toast((await copyText(terminalCommand(point))) ? t('Command copied') : t('Copy failed')) }, t('Copy')),
  );

  const paragraphs = paragraphsOf(c.body).map((p) => h('p', {}, richText(app, p)));
  // What is disputed reads after the story it qualifies, not before it.
  const contested = c.dispute ? h('div.notice.contested', { role: 'note' }, h('b', {}, t('Contested.') + ' '), c.dispute) : null;
  const other = pairLine(app, c);

  const backlinks = app.set.backlinks(c.id).map((id) => app.set.get(id)).filter(Boolean) as Card[];
  const sameGenre = (c.genres ?? []).map((g) => app.set.get(g)).filter(Boolean) as Card[];

  const body = h(
    `div.card-body${img ? '' : '.nomedia'}`,
    { style: `--era:${eraColor(c.era)}` },
    h(
      'div.meta',
      {},
      h('span.era-tag', {}, [chapterLabel(c.era), era?.label].filter(Boolean).join(' · ')),
      h('span', {}, KIND_LABEL[c.kind] ?? c.kind),
      h('span', {}, formatYears(c.years)),
      h('span', {}, c.places.map((p) => p.name).join(' → ')),
    ),
    h('h2', { tabindex: '-1', id: 'card-title' }, c.title),
    h('p.wow', {}, c.wow),
    h(
      'div.books',
      {},
      c.books.map((b) => h(`span.book.${b}`, {}, bookMarks([b]), BOOK_NAMES[b])),
    ),
    h('div.text', {}, ...paragraphs),
    contested,
    other,
    ...(app.listen.cards[c.id] ?? []).slice(0, 1).map((r) => listenBlock(r)),
    ...audio.map((a) =>
      h(
        'figure.card-audio',
        {},
        h('audio', { controls: true, preload: 'none', src: app.media(a.file) }),
        h('figcaption.credit', {}, a.caption ? a.caption + ' · ' : '', a.credit, ' · ', a.url ? h('a', { href: a.url, rel: 'noopener', target: '_blank' }, a.license) : a.license),
      ),
    ),
    cardExtras(app, c),
    c.further?.length ? h('section.sec.further', {}, h('h3', {}, t('Go further')), h('ul', {}, c.further.map((f) => h('li', {}, richText(app, f))))) : null,
    sameGenre.length || backlinks.length
      ? h(
          'section.sec',
          {},
          h('h3', {}, t('Cards that lead here')),
          h(
            'div.chips',
            {},
            [...sameGenre, ...backlinks.filter((b) => !sameGenre.includes(b))].map((b) =>
              h('a.chip', { href: `#focus=${b.id}`, 'data-card': b.id }, bookMarks(b.books), b.title),
            ),
          ),
        )
      : null,
    h(
      'div.card-actions',
      {},
      h('button.btn', { onclick: () => app.openAtlas(point, true) }, svgIcon('map'), t('Show on the atlas')),
      h('button.btn', { onclick: () => term.classList.toggle('on'), 'aria-label': t('Open in terminal') }, svgIcon('term'), t('Open in terminal')),
      h(
        'button.btn',
        {
          onclick: async () => {
            const url = location.href.split('#')[0] + '#' + formatFragment(point);
            toast((await copyText(url)) ? t('Link copied') : t('Copy failed'));
          },
        },
        svgIcon('link'),
        t('Copy link'),
      ),
    ),
    term,
    k8sObject(app, c),
    h(
      'section.sec.sources',
      {},
      h('h3', {}, t('Sources')),
      h(
        'ol',
        {},
        c.sources.map((s) => h('li', {}, s.url ? h('a', { href: s.url, rel: 'noopener', target: '_blank' }, s.title) : s.title)),
      ),
    ),
    cardChecks(app, c),
  );

  const media = img
    ? h(
        'figure.card-media',
        {},
        h('img', { ...mediaSrc(app, img.file, [960]), sizes: '(max-width: 720px) 100vw, 560px', alt: img.caption ?? c.title, loading: 'eager', decoding: 'async' }),
        h(
          'figcaption.credit',
          {},
          img.caption ? h('span.cap', {}, img.caption) : null,
          img.credit,
          ' · ',
          img.url ? h('a', { href: img.url, rel: 'noopener', target: '_blank' }, img.license) : img.license,
        ),
      )
    : null;

  const article = h('article.card', { 'data-label': [chapterLabel(c.era), KIND_LABEL[c.kind] ?? c.kind].filter(Boolean).join(' · '), 'data-card-id': c.id, 'aria-labelledby': 'card-title', lang: c.textLang && c.textLang !== lang() ? c.textLang : undefined }, media, body);
  cardCaches(app, c, article);
  return article;
}

export function renderBook(app: App, path: string[], actions: { share(): void; replay(): void; clear(): void }): HTMLElement {
  const cards = path.map((id) => app.set.get(id)).filter(Boolean) as Card[];
  return h(
    'div.book-panel',
    {},
    h('div.kicker', {}, t('Your book · {edition}', { edition: edition(app.edition) })),
    h('h2', { tabindex: '-1' }, t('The path you walked')),
    editionNote(app),
    h(
      'p',
      {},
      cards.length
        ? t('Every card you open is written into your own book, here in your browser and nowhere else. Share it and another reader walks the same road, whichever copy they hold.')
        : t('Open a card and it is written into your own book. Nothing leaves your browser until you share it.'),
    ),
    cards.length
      ? h(
          'ol.path-list',
          {},
          cards.map((c) =>
            h('li', {}, h('button', { 'data-card': c.id }, h('b', {}, bookMarks(c.books), ' ', c.title), h('span', {}, c.wow))),
          ),
        )
      : null,
    cards.length
      ? h(
          'div.card-actions',
          {},
          h('button.btn.primary', { onclick: actions.share }, svgIcon('link'), t('Share my path')),
          h('button.btn', { onclick: actions.replay }, svgIcon('map'), t('Replay on the atlas')),
          h('button.btn', { onclick: actions.clear }, t('Start a new book')),
        )
      : null,
  );
}

/** The card as the object the cluster stores, behind a quiet toggle. */
function k8sObject(app: App, c: Card): HTMLElement {
  const raw = app.raw(c.id) ?? c;
  const cmd = `sankofa dict ${c.id}`;
  const det = h(
    'details.sec.k8s',
    {},
    h('summary', {}, svgIcon('term'), t('This card is a Kubernetes object')),
    h('div.term.on.multi', {}, h('pre', {}, `$ ${cmd}\n$ kubectl get card ${c.id} -o yaml\n${cardYaml(raw)}`)),
  );
  det.querySelector('.term')!.append(h('button', { onclick: async () => toast((await copyText(cmd)) ? t('Command copied') : t('Copy failed')) }, t('Copy')));
  return det;
}
