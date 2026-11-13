// An element of music explained: what it is, which museum card it comes
// from, and which routes of the collection carry it. The systemic view of
// the roots: not one song, but what travels from station to station.
import type { App } from '../app';
import { h, svgIcon } from '../lib/dom';
import { count, lang, pick, t } from '../lib/i18n';
import type { Artist } from '../lib/roots';
import type { MusicElement } from '../lib/elements';

export interface ElementInfo {
  element: MusicElement;
  color: string;
  reach?: { routes: number; artists: string[] };
}

/** "carried along 3 routes" / «несут три маршрута» */
export function routesLine(n: number): string {
  return pick({ en: `${n} ${n === 1 ? 'route carries it' : 'routes carry it'}`, ru: `маршрутов, которые его несут: ${n}` });
}

export class ElementPanel {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private back?: HTMLElement | null;
  onArtist?: (id: string) => void;

  constructor(
    private app: App,
    private byId: Map<string, Artist>,
    host: HTMLElement,
  ) {
    this.body = h('div.ep-body');
    this.el = h(
      'aside.ep',
      { role: 'dialog', 'aria-modal': 'false', 'aria-label': pick({ en: 'Element of music', ru: 'Элемент музыки' }), hidden: '', tabindex: '-1' },
      h('button.icon-btn.ep-close', { type: 'button', 'aria-label': t('Close'), onclick: () => this.close() }, svgIcon('close')),
      this.body,
    );
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.close();
      }
    });
    host.append(this.el);
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(info: ElementInfo): void {
    const e = info.element;
    const L = lang();
    const name = (L === 'ru' && e.nameRu) || e.name;
    const what = (L === 'ru' && e.whatRu) || e.what;
    const artists = (info.reach?.artists ?? []).map((id) => this.byId.get(id)).filter((a): a is Artist => !!a);
    this.back = document.activeElement as HTMLElement | null;
    this.body.replaceChildren(
      ...[h('small.ep-kicker', { style: `--ec:${info.color}` }, h('i', { 'aria-hidden': 'true' }), pick({ en: 'An element of music', ru: 'Элемент музыки' })),
      h('h3', {}, name),
      what ? h('p.ep-what', {}, what) : null,
      e.origin.length
        ? h(
            'p.ep-origin',
            {},
            pick({ en: 'Where it comes from: ', ru: 'Откуда он: ' }),
            ...e.origin.flatMap((id, k) => [k ? ', ' : '', h('a', { href: `#focus=${id}`, 'data-card': id }, this.app.set.get(id)?.title ?? id)]),
          )
        : null,
      info.reach
        ? h(
            'div.ep-reach',
            {},
            h('p', {}, routesLine(info.reach.routes), artists.length ? pick({ en: `, through ${count(artists.length, 'artist', 'en')}:`, ru: `; исполнителей: ${artists.length}` }) : '.'),
            artists.length
              ? h(
                  'ul.ep-artists',
                  {},
                  artists.map((a) => h('li', {}, h('a.chip', { href: `#view=roots&artist=${a.id}`, 'data-artist': a.id, onclick: (ev: Event) => this.onArtist && (ev.preventDefault(), ev.stopPropagation(), this.onArtist(a.id)) }, (L === 'ru' && a.nameRu) || a.name))),
                )
              : null,
          )
        : null,
      e.sources.length ? h('ol.rt-src', { 'aria-label': pick({ en: 'Sources', ru: 'Источники' }) }, e.sources.map((s) => h('li', {}, h('a', { href: s.url, rel: 'noopener', target: '_blank' }, s.title)))) : null,
      ].filter((x): x is HTMLElement => !!x));
    this.el.hidden = false;
    this.el.focus({ preventScroll: true });
  }

  close(): void {
    if (this.el.hidden) return;
    this.el.hidden = true;
    this.back?.focus?.({ preventScroll: true });
  }
}
