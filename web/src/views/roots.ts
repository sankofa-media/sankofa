// Roots: type a band or an artist and watch the chain grow back, link by
// sourced link, to a card of the museum.
import type { App } from '../app';
import { placeName, chainLine, quotes, longestRoots, searchArtists, suggestions, type Artist, type LineageCard } from '../lib/roots';
import { copyText, h, reducedMotion, svgIcon, toast } from '../lib/dom';
import { formatYears } from '../lib/cards';
import { lang, pick, t } from '../lib/i18n';
import { cardLinkIndex, elementColors, type MusicElement } from '../lib/elements';
import { elementReach, routeSet, routeThrough, type RouteSet } from '../lib/routes';
import { RouteReader } from './routeReader';
import { metro } from './routeMetro';
import { ElementPanel } from './elementPanel';
import { miniPlayer } from './miniPlayer';

export class Roots {
  readonly el: HTMLElement;
  private input: HTMLInputElement;
  private results: HTMLElement;
  private stage: HTMLElement;
  private sugg: HTMLElement;
  private byId: Map<string, Artist>;
  private lineage: Map<string, LineageCard>;
  private active = -1;
  private current?: string;
  private reader: RouteReader;
  private panel: ElementPanel;
  private elements: Map<string, MusicElement>;
  private colors: Map<string, string>;
  private reach: Map<string, { routes: number; artists: string[] }>;
  onArtist?: (id: string | undefined) => void;
  onClose?: () => void;

  constructor(
    private app: App,
    private artists: Artist[],
  ) {
    this.byId = new Map([...artists, ...app.styles].map((a) => [a.id, a]));
    this.lineage = new Map(app.set.all().map((c) => [c.id, { id: c.id, roots: c.roots }] as [string, LineageCard]));
    this.input = h('input.r-input', {
      type: 'search',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: pick({ en: 'Type a band or an artist…', ru: 'Группа или исполнитель…' }),
      'aria-label': pick({ en: 'Band or artist', ru: 'Группа или исполнитель' }),
      role: 'combobox',
      'aria-expanded': 'false',
      'aria-controls': 'r-results',
      'aria-autocomplete': 'list',
    }) as HTMLInputElement;
    this.results = h('ul.r-results', { id: 'r-results', role: 'listbox' });
    this.sugg = h('div.r-sugg');
    this.stage = h('div.r-stage', { 'aria-live': 'polite' });
    this.input.addEventListener('input', () => this.search());
    this.input.addEventListener('keydown', (e) => this.key(e));
    const bar = h('header.d-bar', {}, h('span.d-title', {}, t('Roots')), h('a.btn.r-maplink', { href: '#view=roots-map', 'data-roots-map': '' }, pick({ en: 'The music map', ru: 'Карта музыки' })), h('button.icon-btn', { 'aria-label': t('Close'), onclick: () => this.onClose?.() }, svgIcon('close')));
    const head = h(
      'header.r-head',
      {},
      h('div.kicker', {}, t('Roots')),
      h('h2', {}, pick({ en: 'Where does your music come from?', ru: 'Откуда растёт ваша музыка?' })),
      h(
        'p.r-lede',
        {},
        pick({
          en: 'Pick a band or an artist. The chain runs back through the artists they listened to and the styles they play to Black traditions, and ends at a card of the museum; every link says what of the style passed on and is documented by at least two sources.',
          ru: 'Выберите группу или исполнителя. Цепочка ведёт от них назад — через тех, кого они слушали, и стили, в которых они играют, — к чёрным традициям и заканчивается карточкой музея. Каждое звено говорит, что именно перешло из стиля, и подтверждено как минимум двумя источниками.',
        }),
      ),
      h('div.r-search', {}, searchIcon(), this.input, this.results),
      this.sugg,
    );
    this.el = h('section.roots', { 'aria-label': t('Roots'), tabindex: '-1' }, bar, h('div.r-wrap', {}, head, this.stage));
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.activeElement !== this.input) this.onClose?.();
    });
    this.el.addEventListener('click', (e) => {
      const a = (e.target as Element).closest<HTMLElement>('[data-artist]');
      if (!a) return;
      e.preventDefault();
      this.show(a.dataset.artist!);
      this.onArtist?.(a.dataset.artist!);
    });
    document.body.append(this.el);
    this.elements = new Map(app.elements.elements.map((e) => [e.id, e]));
    this.colors = elementColors(app.elements);
    this.reach = elementReach(artists, app.elements.elements, app.styles);
    this.reader = new RouteReader({ app, byId: this.byId, cardLinks: cardLinkIndex(app.cardLinks), elements: this.elements, colors: this.colors, lines: app.lines, onElement: (id) => this.openElement(id) });
    this.panel = new ElementPanel(app, this.byId, this.el, app.cardLinks.links);
    this.renderSuggestions();
  }

  get isOpen(): boolean {
    return this.el.classList.contains('open');
  }

  open(artist?: string): void {
    this.el.classList.add('open');
    document.body.classList.add('locked');
    if (artist) this.show(artist);
    else if (!this.current) {
      this.renderEmpty();
      requestAnimationFrame(() => this.input.focus({ preventScroll: true }));
    }
  }

  close(): void {
    this.panel.close();
    miniPlayer().close();
    this.el.classList.remove('open');
    document.body.classList.remove('locked');
  }

  private nameOf(a: Artist): string {
    return lang() === 'ru' && a.nameRu ? a.nameRu : a.name;
  }

  private refName(ref: string): string {
    if (ref.startsWith('card:')) return this.app.set.get(ref.slice(5))?.title ?? ref.slice(5);
    const a = this.byId.get(ref);
    return a ? this.nameOf(a) : ref;
  }

  private renderSuggestions(): void {
    const list = suggestions(this.artists, 7);
    this.sugg.replaceChildren(
      ...(list.length ? [h('span', {}, pick({ en: 'Try', ru: 'Например' }))] : []),
      ...list.map((a) => h('a.chip', { href: `#view=roots&artist=${a.id}`, 'data-artist': a.id }, this.nameOf(a))),
    );
  }

  private search(): void {
    const found = searchArtists(this.artists, this.input.value);
    this.active = found.length ? 0 : -1;
    this.results.replaceChildren(
      ...found.map((a, i) =>
        h(
          `li.r-hit${i === 0 ? '.on' : ''}`,
          { role: 'option', 'aria-selected': String(i === 0), 'data-id': a.id, onmousedown: (e: Event) => (e.preventDefault(), this.pick(a.id)) },
          h('b', {}, this.nameOf(a)),
          h('span', {}, `${(lang() === 'ru' && a.genreRu) || a.genre} · ${formatYears(a.years)} · ${placeName(a, lang())}`),
        ),
      ),
    );
    const q = this.input.value.trim();
    if (q && !found.length) {
      this.results.append(h('li.r-none', {}, this.emptyLine()));
      // A search that finds nobody leaves no answer from before under it.
      if (this.current) {
        this.current = undefined;
        this.renderEmpty();
        this.onArtist?.(undefined);
      }
    }
    this.input.setAttribute('aria-expanded', String(!!q));
    this.stage.classList.toggle('typing', !!q && !this.current);
    this.results.classList.toggle('on', !!q);
  }

  private key(e: KeyboardEvent): void {
    const hits = [...this.results.querySelectorAll<HTMLElement>('.r-hit')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!hits.length) return;
      this.active = (this.active + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length;
      hits.forEach((x, i) => {
        x.classList.toggle('on', i === this.active);
        x.setAttribute('aria-selected', String(i === this.active));
      });
    } else if (e.key === 'Enter' && hits[this.active]) {
      e.preventDefault();
      this.pick(hits[this.active].dataset.id!);
    } else if (e.key === 'Escape') {
      this.input.value = '';
      this.search();
    }
  }

  private pick(id: string): void {
    this.input.value = '';
    this.search();
    this.input.blur();
    this.show(id);
    this.onArtist?.(id);
  }

  private emptyLine(): string {
    return pick({
      en: 'Can’t find them? The collection grows; every link needs two sources.',
      ru: 'Не нашли? Коллекция растёт, а каждому звену нужны два источника.',
    });
  }

  private renderEmpty(): void {
    const top = longestRoots(this.artists, this.lineage, 4, this.app.styles);
    this.stage.replaceChildren(
      ...(top.length
        ? [h(
            'section.r-longest',
            {},
            h('h3', {}, pick({ en: 'The longest roots', ru: 'Самые длинные корни' })),
            h(
              'div.r-long-grid',
              {},
              top.map(({ artist, chain, borrowed }) =>
                h(
                  'a.r-long',
                  { href: `#view=roots&artist=${artist.id}`, 'data-artist': artist.id },
                  h('small', {}, pick({ en: `${chain.length - 1} steps back`, ru: `шагов назад: ${chain.length - 1}` })),
                  h('b', {}, this.nameOf(artist)),
                  borrowed?.how ? h('span.r-what', {}, quotes((lang() === 'ru' && borrowed.howRu) || borrowed.how, lang())) : null,
                  h('span.r-chain', {}, chainLine(chain, (r) => this.refName(r))),
                ),
              ),
            ),
            h('a.btn', { href: '#view=roots-map', 'data-roots-map': '' }, pick({ en: 'See every chain on one map →', ru: 'Все цепочки на одной карте →' })),
          )]
        : []),
      h('p.r-empty', {}, this.artists.length ? this.emptyLine() : pick({ en: 'The first chains are being written and checked.', ru: 'Первые цепочки пишутся и проверяются.' })),
      ...[this.elementsIndex()].filter((x): x is HTMLElement => !!x),
    );
  }

  /** Root the view on an artist: every route at a glance, then one route read in full. */
  show(id: string, route = 0): void {
    const a = this.byId.get(id);
    this.current = id;
    if (!a) return this.renderEmpty();
    this.panel.close();
    const rs = routeSet(a, this.byId, this.lineage);
    const ends = [...new Set(rs.routes.map((r) => r[r.length - 1]))];
    const chains = a.paths.length;
    if (!rs.routes.length) {
      this.stage.replaceChildren(h('div.r-tree', { 'data-root': id }, this.plate(a)), h('p.r-empty', {}, pick({ en: 'No documented chain reaches the museum yet.', ru: 'Документированной цепочки до музея пока нет.' })));
      return;
    }
    const story = (lang() === 'ru' && a.storyRu) || a.story;
    const overview = h('div.rt-overview-map');
    const summary = h('div.rt-summary');
    const bar = h('div.rt-routebar');
    const paint = (i: number, scroll = false) => {
      this.reader.set(rs, i);
      const r = rs.routes[this.reader.current];
      overview.replaceChildren(
        metro({ rs, current: this.reader.current, name: (x) => this.refName(x), threads: this.reader.threadList, colors: this.colors, vertical: window.innerWidth < 760, onPick: (ref) => this.pickStation(rs, ref) }),
      );
      summary.replaceChildren(...[this.reader.summary(), this.reader.lineBox()].filter((x): x is HTMLElement => !!x));
      const heard = this.reader.tracks().length;
      bar.replaceChildren(
        ...[h(
          'p.rt-which',
          {},
          h('small', {}, pick({ en: 'The route you are reading', ru: 'Маршрут, который вы читаете' })),
          h('span', {}, chainLine(r, (x) => this.refName(x))),
        ),
        heard
          ? h('button.btn.primary.rt-playroute', { type: 'button', onclick: () => this.reader.playRoute() }, svgIcon('wave'), pick({ en: 'Play the route', ru: 'Слушать маршрут' }))
          : null,
        heard ? h('small.rt-heard', {}, pick({ en: `${heard} of its ${r.length} stations can be heard, each when you ask.`, ru: `Слышно станций: ${heard} из ${r.length}, каждую — когда попросите.` })) : null,
      ].filter((x): x is HTMLElement => !!x));
      if (scroll) bar.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
    };
    this.reader.onRoute = (i) => paint(i);
    this.paintRoute = paint;
    this.stage.replaceChildren(
      h(
        'div.r-tree',
        { 'data-root': id },
        h('header.rt-head', {}, this.plate(a), story ? h('p.r-story', {}, story) : null),
        h(
          'section.rt-overview',
          { 'aria-labelledby': 'rt-ov-h' },
          h('h3', { id: 'rt-ov-h' }, pick({ en: 'All routes to the museum', ru: 'Все маршруты к музею' })),
          h(
            'p.rt-ov-lede',
            {},
            pick({
              en: `${chains} documented ${chains === 1 ? 'chain leads' : 'chains lead'} from ${this.nameOf(a)} into the museum; past its cards the line runs on through the genres they grew from. Shared stations are drawn once. Pick a station to read a route through it; a +1 marks a branch offered further down.`,
              ru: `Документированных цепочек от исполнителя до музея: ${chains}. За карточками линия идёт дальше — через жанры, из которых они выросли. Общие станции нарисованы один раз. Выберите станцию, чтобы прочитать маршрут через неё; пометка +1 — ветка, которую можно выбрать ниже.`,
            }),
          ),
          overview,
          ends.length > 1 ? h('p.rt-ends', {}, pick({ en: 'End stations: ', ru: 'Конечные станции: ' }), ends.map((e) => this.refName(e)).join(', ')) : null,
        ),
        bar,
        summary,
        this.reader.el,
      ),
      h(
        'footer.r-close',
        {},
        h(
          'button.btn',
          {
            onclick: async () => {
              const url = location.href.split('#')[0] + `#view=roots&artist=${id}${lang() === 'en' ? '' : `&lang=${lang()}`}`;
              toast((await copyText(url)) ? pick({ en: 'Link to these routes copied', ru: 'Ссылка на маршруты скопирована' }) : t('Copy failed'));
            },
          },
          svgIcon('link'),
          pick({ en: 'Share these routes', ru: 'Поделиться маршрутами' }),
        ),
      ),
      ...[this.elementsIndex()].filter((x): x is HTMLElement => !!x),
    );
    paint(route);
    // The answer is the routes: bring them up and fold the header away.
    this.el.classList.add('chosen');
    requestAnimationFrame(() => {
      const top = this.stage.getBoundingClientRect().top + this.el.scrollTop - 70;
      this.el.scrollTo({ top: Math.max(0, top), behavior: reducedMotion() ? 'auto' : 'smooth' });
    });
  }

  /** The artist the routes start from, as a plate. */
  private plate(a: Artist): HTMLElement {
    let hue = 0;
    for (const ch of a.genre) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
    const name = this.nameOf(a);
    return h(
      'div.r-artist.r-root',
      { style: `--hue:${hue}` },
      h('span.r-mono', { 'aria-hidden': 'true' }, name.replace(/^the\s+/i, '').charAt(0)),
      h('div.r-plate', {}, h('small', {}, `${formatYears(a.years)} · ${placeName(a, lang())}`), h('b', {}, name), h('span', {}, (lang() === 'ru' && a.genreRu) || a.genre)),
    );
  }

  private paintRoute?: (i: number, scroll?: boolean) => void;

  /** A station picked on the overview: a route through it, then that station in the reading. */
  private pickStation(rs: RouteSet, ref: string): void {
    const i = routeThrough(rs, ref, this.reader.current);
    if (i < 0) return;
    this.paintRoute?.(i);
    const st = this.reader.el.querySelector<HTMLElement>(`.rt-station[data-ref="${CSS.escape(ref)}"]`);
    st?.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
    st?.focus({ preventScroll: true });
    // Keep the overview's focus where the reader was, if they were on it with the keyboard.
  }

  /** The elements of music the collection's routes carry, and how many routes carry each. */
  private elementsIndex(): HTMLElement | null {
    const list = this.app.elements.elements;
    if (!list.length) return null;
    return h(
      'section.rt-elindex',
      { 'aria-labelledby': 'rt-el-h' },
      h('h3', { id: 'rt-el-h' }, pick({ en: 'Elements of music', ru: 'Элементы музыки' })),
      h('p', {}, pick({ en: 'What travels along the routes, from the oldest museum cards to today. Open one to see where it comes from and who carries it.', ru: 'То, что идёт по маршрутам от самых старых карточек музея до наших дней. Откройте элемент — увидите, откуда он и кто его несёт.' })),
      h(
        'ul',
        {},
        list.map((e) =>
          h(
            'li',
            {},
            h(
              'button.rt-el',
              { type: 'button', 'data-el': e.id, style: `--ec:${this.colors.get(e.id)}`, onclick: () => this.openElement(e.id) },
              h('i', { 'aria-hidden': 'true' }),
              (lang() === 'ru' && e.nameRu) || e.name,
              h('small', {}, String(this.reach.get(e.id)?.routes ?? 0)),
            ),
          ),
        ),
      ),
    );
  }

  private openElement(id: string): void {
    const element = this.elements.get(id);
    if (!element) return;
    this.panel.open({ element, color: this.colors.get(id) ?? '', reach: this.reach.get(id) });
  }

}

function searchIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m16 16 4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>';
  return svg;
}
