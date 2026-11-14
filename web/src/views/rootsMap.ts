// The music map: one large graph of every artist and link, growing upward
// out of the glowing traditions at the bottom. Hover or tap an artist to
// light its way down to the roots; a root, to light everything that grew
// from it.
import type { App } from '../app';
import { select } from 'd3-selection';
import { zoom as d3zoom, zoomIdentity, type ZoomTransform } from 'd3-zoom';
import 'd3-transition';
import { h, reducedMotion, svgIcon } from '../lib/dom';
import { count, lang, pick, t } from '../lib/i18n';
import { buildGraph, carrying, grewFrom, headline, layout, radius, reach, yearY, type GEdge, type GNode, type Graph, type MapCard } from '../lib/rootsMap';
import { nbsp, quotes } from '../lib/typo';
import { recordingFor } from '../lib/listen';
import { placeName, KIND_LABEL, searchArtists, type Artist, type LineageCard, type LinkKind } from '../lib/roots';
import { cardLinkIndex, elementColors, type MusicElement } from '../lib/elements';
import { elementReach, routeSet, type RouteSet } from '../lib/routes';
import { RouteReader } from './routeReader';
import { ElementPanel } from './elementPanel';
import { miniPlayer } from './miniPlayer';

const NS = 'http://www.w3.org/2000/svg';
const KINDS: (LinkKind | 'lineage')[] = ['influence', 'cover', 'sample', 'interpolation', 'member', 'producer', 'collaboration', 'scene', 'teacher', 'lineage'];

export class RootsMap {
  readonly el: HTMLElement;
  private svg: SVGSVGElement;
  private gAll: SVGGElement;
  private stage: HTMLElement;
  private info: HTMLElement;
  private input: HTMLInputElement;
  private results: HTMLElement;
  private g?: Graph;
  private t: ZoomTransform = zoomIdentity;
  private zoomer = d3zoom<SVGSVGElement, unknown>();
  private nodeEls = new Map<string, SVGGElement>();
  private edgeEls: { e: GEdge; el: SVGPathElement }[] = [];
  private pinned?: string;
  private built = false;
  private phone = false;
  private early = 0.28;
  private lit?: Set<string>;
  private litCard = false;
  private reader: RouteReader;
  private panel: ElementPanel;
  private elements: Map<string, MusicElement>;
  private colors: Map<string, string>;
  private byId: Map<string, Artist>;
  private lineage: Map<string, LineageCard>;
  private elFilter?: string;
  private elBar: HTMLElement;
  onClose?: () => void;

  constructor(
    private app: App,
    private artists: Artist[],
  ) {
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.setAttribute('class', 'rm-svg');
    this.svg.setAttribute('role', 'img');
    this.gAll = document.createElementNS(NS, 'g');
    this.svg.append(this.gAll);
    this.stage = h('div.rm-stage', {}, this.svg);
    this.info = h('aside.rm-info', { 'aria-live': 'polite' });
    this.input = h('input.rm-input', { type: 'search', placeholder: pick({ en: 'Find a band or an artist…', ru: 'Найти группу или исполнителя…' }), 'aria-label': pick({ en: 'Find on the map', ru: 'Найти на карте' }) }) as HTMLInputElement;
    this.results = h('ul.rm-results');
    this.input.addEventListener('input', () => this.search());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const first = this.results.querySelector<HTMLElement>('li');
        if (first) this.focusOn(first.dataset.id!);
      }
    });
    const legendList = h(
      'ul.rm-legend',
      { 'aria-label': pick({ en: 'Kinds of links', ru: 'Виды связей' }) },
      KINDS.map((k) =>
        h(
          'li',
          { style: `--kc:var(--k-${k === 'lineage' ? 'lineage' : k})` },
          h('i'),
          k === 'lineage' ? pick({ en: 'rooted in', ru: 'корни в' }) : pick(KIND_LABEL[k]),
        ),
      ),
    );
    // On phones the key folds away behind one line; on wide screens it stays open.
    const legend = h('details.rm-key', { open: window.innerWidth >= 760 ? '' : undefined }, h('summary', {}, pick({ en: 'Colours of the links', ru: 'Цвета связей' })), legendList);
    const bar = h('header.d-bar', {}, h('span.d-title', {}, pick({ en: 'The music map', ru: 'Карта музыки' })), h('button.icon-btn', { 'aria-label': t('Close'), onclick: () => this.onClose?.() }, svgIcon('close')));
    this.head = h(
      'div.rm-head',
      {},
      h('div.kicker', {}, t('Roots')),
      h('h2', {}),
      h('div.rm-search', {}, this.input, this.results),
      h('p.rm-hint-line', {}, pick({ en: 'Tap an artist to light its way to the roots. Later artists are further up ↑', ru: 'Коснитесь исполнителя — загорится его путь к корням. Выше — более поздние исполнители ↑' })),
    );
    this.byId = new Map(artists.map((a) => [a.id, a]));
    this.lineage = new Map(app.set.all().map((c) => [c.id, { id: c.id, roots: c.roots }] as [string, LineageCard]));
    this.elements = new Map(app.elements.elements.map((e) => [e.id, e]));
    this.colors = elementColors(app.elements);
    this.elBar = h('div.rm-elbar');
    if (app.elements.elements.length) {
      this.elBar.append(
        h('span.rm-elbar-lede', {}, pick({ en: 'Follow an element:', ru: 'Проследить элемент:' })),
        h(
          'ul.rm-els',
          { 'aria-label': pick({ en: 'Elements of music', ru: 'Элементы музыки' }) },
          app.elements.elements.map((e) =>
            h('li', {}, h('button.rt-el', { type: 'button', 'data-el': e.id, 'aria-pressed': 'false', style: `--ec:${this.colors.get(e.id)}`, onclick: () => this.filterElement(this.elFilter === e.id ? undefined : e.id) }, h('i', { 'aria-hidden': 'true' }), (lang() === 'ru' && e.nameRu) || e.name)),
          ),
        ),
      );
      this.head.append(this.elBar);
    }
    this.reader = new RouteReader({ app, byId: this.byId, cardLinks: cardLinkIndex(app.cardLinks), elements: this.elements, colors: this.colors, onElement: (id) => this.filterElement(id) }, true);
    this.el = h('section.rmap', { 'aria-label': pick({ en: 'The music map', ru: 'Карта музыки' }), tabindex: '-1' }, bar, this.head, this.stage, legend, this.info);
    this.panel = new ElementPanel(app, this.byId, this.el);
    this.panel.onArtist = (id) => {
      this.panel.close();
      this.focusOn(id);
    };
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.onClose?.();
    });
    document.body.append(this.el);
  }

  private head: HTMLElement;

  get isOpen(): boolean {
    return this.el.classList.contains('open');
  }

  open(): void {
    this.el.classList.add('open');
    document.body.classList.add('locked');
    if (!this.built) requestAnimationFrame(() => this.build());
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

  private build(): void {
    this.built = true;
    const cards = new Map<string, MapCard>(this.app.set.all().map((c) => [c.id, { id: c.id, title: c.title, years: c.years, roots: c.roots }]));
    const cardCarries = new Map(this.app.cardLinks.links.filter((l) => l.carries?.length).map((l) => [`${l.from}>${l.to}`, l.carries!]));
    const g = (this.g = buildGraph(this.artists, cards, (a) => this.nameOf(a), cardCarries));
    this.phone = window.innerWidth < 760;
    // Phones get a canvas wider than the screen, panned sideways, so the
    // artists spread out instead of piling at the left edge.
    const W = this.phone ? Math.max(680, (this.stage.clientWidth || window.innerWidth) * 1.8) : this.stage.clientWidth || window.innerWidth;
    const years = [Math.min(...g.nodes.map((n) => n.year)) - 10, Math.min(new Date().getFullYear(), Math.max(...g.nodes.map((n) => n.year)) + 6)] as [number, number];
    // Phones: a map under two screens tall, the empty 1800s squeezed, so the
    // first screen holds the roots and the artists who grew straight from them.
    const H = this.phone ? Math.max(1000, (this.stage.clientHeight || window.innerHeight * 0.7) * 1.7) : Math.max(this.stage.clientHeight, 700) * 1.25;
    this.early = this.phone ? 0.14 : 0.28;
    layout(g, W, H, years, this.early);
    this.svg.setAttribute('viewBox', `0 0 ${W} ${this.phone ? H : this.stage.clientHeight || H}`);
    // On phones keep labels clear of both edges.
    if (this.phone) {
      this.svg.setAttribute('height', String(H));
      this.svg.setAttribute('width', String(W));
      // Drawn at full size and panned, never shrunk to the screen: labels stay legible.
      this.svg.style.width = `${W}px`;
      this.svg.style.height = `${H}px`;
      this.svg.style.maxWidth = 'none';
    }
    this.draw(W, H, years);
    // Headline: computed from the data.
    const hl = headline(g);
    const inline = (n: GNode) => {
      const rc = this.app.set.get(n.id.slice(5));
      return rc?.inline || (lang() === 'ru' ? `«${n.label}»` : n.label.replace(/^The /, 'the '));
    };
    const names = hl.roots.map(inline);
    const two = names.length > 1;
    // As many roots as the map draws at its foot, named, never "one root" over two.
    const en = two ? `${names.length === 2 ? 'two' : names.length} roots: ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
    const ruN = two ? `${names.length === 2 ? 'двум' : names.length === 3 ? 'трём' : names.length} корням: ${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}` : `корню: ${names[0]}`;
    // Set explicitly: the heading is written before the page-wide typesetter starts.
    this.head.querySelector('h2')!.textContent = nbsp(hl.roots.length
      ? pick({
          en:
            hl.count === hl.total
              ? `All ${hl.total} artists lead back to ${en}`
              : `Of ${count(hl.total, 'artist', 'en')}, ${hl.count} lead back to ${en}`,
          ru:
            hl.count === hl.total
              ? `Все ${count(hl.total, 'artist', 'ru')} ${pluralLead(hl.total)} к ${ruN}`
              : `Из ${count(hl.total, 'artistOf', 'ru')} ${hl.count} ${pluralLead(hl.count)} к ${ruN}`,
        })
      : pick({ en: 'Every chain on one map', ru: 'Все цепочки на одной карте' }), lang());
    if (!this.phone) {
      this.zoomer
        .scaleExtent([0.4, 6])
        // The wheel scrolls the page; zoom needs ctrl (or a pinch, which browsers send as ctrl+wheel).
        .filter((ev: Event) => (ev.type === 'wheel' ? (ev as WheelEvent).ctrlKey : !(ev as MouseEvent).button))
        .on('zoom', (ev) => {
          this.t = ev.transform;
          this.gAll.setAttribute('transform', this.t.toString());
        })
        .on('end', () => this.placeLabels());
      select(this.svg).call(this.zoomer);
      // Fit the whole graph, labels included, into the view.
      const vw = this.stage.clientWidth;
      const vh = this.stage.clientHeight;
      const xs = g.nodes.map((n) => n.x!);
      const ys = g.nodes.map((n) => n.y!);
      const pad = 110;
      const [x0, x1] = [Math.min(...xs) - pad, Math.max(...xs) + pad];
      const [y0, y1] = [Math.min(...ys) - 70, Math.max(...ys) + 110];
      const k = Math.min(1.4, vw / (x1 - x0), vh / (y1 - y0));
      select(this.svg).call(this.zoomer.transform, zoomIdentity.translate((vw - (x1 - x0) * k) / 2 - x0 * k, (vh - (y1 - y0) * k) / 2 - y0 * k).scale(k));
    }
    this.placeLabels();
    // Labels are measured: measure again once the faces have loaded.
    // The italic face of the root names loads only once they are drawn.
    const again = () => this.isOpen && this.placeLabels(this.lit);
    void document.fonts?.ready.then(again);
    document.fonts?.addEventListener?.('loadingdone', again);
    setTimeout(again, 700);
    this.showInfo();
    // Phones open on the roots at the bottom, with the artists above them; the
    // line under the search says that later artists are further up.
    if (this.phone) {
      const deepest = Math.max(...g.nodes.map((n) => n.y!));
      requestAnimationFrame(() => {
        this.stage.scrollTop = Math.max(0, deepest + 90 - this.stage.clientHeight);
        const roots = g.nodes.filter((n) => n.card && n.y! > deepest - 400);
        const cx = roots.length ? roots.reduce((s, n) => s + n.x!, 0) / roots.length : W / 2;
        this.stage.scrollLeft = Math.max(0, cx - this.stage.clientWidth / 2);
        this.placeLabels();
      });
    }
  }

  private draw(W: number, H: number, years: [number, number]): void {
    const g = this.g!;
    this.gAll.innerHTML = '';
    // Time axis.
    const axis = document.createElementNS(NS, 'g');
    axis.setAttribute('class', 'rm-axis');
    for (let y = Math.ceil(years[0] / 50) * 50; y <= years[1]; y += y < 1900 ? 50 : 25) {
      const py = yearY(y, H, years, this.early);
      axis.innerHTML += `<line x1="0" x2="${W}" y1="${py}" y2="${py}"/><text x="8" y="${py - 4}">${y}</text>`;
    }
    // A glow under the roots.
    const glow = document.createElementNS(NS, 'g');
    glow.innerHTML = `<defs><radialGradient id="rm-glow"><stop offset="0" stop-color="#e3ab3d" stop-opacity="0.55"/><stop offset="1" stop-color="#e3ab3d" stop-opacity="0"/></radialGradient></defs>`;
    const gEdges = document.createElementNS(NS, 'g');
    gEdges.setAttribute('class', 'rm-edges');
    const gNodes = document.createElementNS(NS, 'g');
    gNodes.setAttribute('class', 'rm-nodes');
    this.gAll.append(axis, glow, gEdges, gNodes);
    this.edgeEls = [];
    for (const e of g.edges) {
      const a = g.byId.get(e.from)!;
      const b = g.byId.get(e.to)!;
      const p = document.createElementNS(NS, 'path');
      const my = (a.y! + b.y!) / 2;
      p.setAttribute('d', `M${a.x},${a.y} C${a.x},${my} ${b.x},${my} ${b.x},${b.y}`);
      p.setAttribute('class', `rm-edge k-${e.kind}`);
      gEdges.append(p);
      this.edgeEls.push({ e, el: p });
    }
    for (const n of [...g.nodes].sort((x, y) => Number(x.card) - Number(y.card))) {
      const el = document.createElementNS(NS, 'g');
      el.setAttribute('class', `rm-node${n.card ? ' card' : ''}`);
      el.setAttribute('transform', `translate(${n.x},${n.y})`);
      el.setAttribute('tabindex', '0');
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', `${n.label}, ${n.year}`);
      const r = radius(n);
      el.innerHTML = `${n.card ? `<circle class="halo" r="${r * 3.2}" fill="url(#rm-glow)"/>` : ''}<circle class="dot" r="${r}"/><text class="lbl" y="${-r - 5}" text-anchor="middle"></text>`;
      el.querySelector('text')!.textContent = quotes(n.label, lang());
      el.addEventListener('click', () => this.pick(n.id));
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.pick(n.id);
        }
      });
      gNodes.append(el);
      this.nodeEls.set(n.id, el);
    }
  }

  /**
   * Light an artist's route (its stations on, the rest of its way down
   * half-lit) or, for a root, everything that grew from it. Only the lit
   * route is named; everything else is dimmed.
   */
  private light(id?: string, route?: number): void {
    const g = this.g!;
    this.el.classList.toggle('lit', !!id || !!this.elFilter);
    this.lit = undefined;
    this.litCard = false;
    this.nodeEls.forEach((el) => el.classList.remove('cur', 'near'));
    this.edgeEls.forEach(({ el }) => el.classList.remove('near'));
    if (!id) {
      this.nodeEls.forEach((el) => el.classList.remove('on'));
      this.edgeEls.forEach(({ el }) => el.classList.remove('on'));
      if (this.elFilter) return this.paintElement();
      this.showInfo();
      this.placeLabels();
      return;
    }
    const n = g.byId.get(id)!;
    if (n.card) {
      const set = grewFrom(g, id);
      this.nodeEls.forEach((el, k) => el.classList.toggle('on', set.has(k)));
      this.edgeEls.forEach(({ e, el }) => el.classList.toggle('on', set.has(e.from) && set.has(e.to)));
      this.showInfo(n, set);
      this.lit = set;
      this.litCard = true;
      this.placeLabels(set);
      return;
    }
    const a = this.byId.get(id)!;
    const rs = routeSet(a, this.byId, this.lineage);
    const cur = route ?? (this.shownArtist === id ? this.reader.current : 0);
    this.shownArtist = id;
    this.paintRoute(rs, cur);
    this.showInfo(n, undefined, cur);
  }

  private shownArtist?: string;

  /** One route of the lit artist: its stations and links on, the rest of the way half-lit. */
  private paintRoute(rs: RouteSet, cur: number): void {
    const g = this.g!;
    const route = rs.routes[cur] ?? [rs.root];
    const on = new Set(route);
    const steps = new Set(route.slice(0, -1).map((r, i) => `${r}>${route[i + 1]}`));
    const near = reach(g, rs.root);
    this.nodeEls.forEach((el, k) => {
      el.classList.toggle('on', on.has(k));
      el.classList.toggle('near', !on.has(k) && near.has(k));
    });
    this.edgeEls.forEach(({ e, el }) => {
      el.classList.toggle('on', steps.has(`${e.from}>${e.to}`));
      el.classList.toggle('near', !steps.has(`${e.from}>${e.to}`) && near.has(e.from) && near.has(e.to));
    });
    this.lit = on;
    this.placeLabels(on);
  }

  /** Light every link that carries an element. */
  filterElement(id?: string): void {
    this.elFilter = id && this.elements.has(id) ? id : undefined;
    this.elBar.querySelectorAll<HTMLElement>('[data-el]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.el === this.elFilter)));
    this.pinned = undefined;
    this.shownArtist = undefined;
    this.light();
  }

  private paintElement(): void {
    const g = this.g!;
    const id = this.elFilter!;
    const { edges, nodes } = carrying(g, id);
    const color = this.colors.get(id) ?? '';
    const lit = new Set(edges);
    this.nodeEls.forEach((el, k) => el.classList.toggle('on', nodes.has(k)));
    this.edgeEls.forEach(({ e, el }) => {
      el.classList.toggle('on', lit.has(e));
      el.classList.toggle('el-on', lit.has(e));
      // A lit link takes the element's colour in place of its kind's.
      if (lit.has(e)) el.style.setProperty('--kc', color);
      else el.style.removeProperty('--kc');
    });
    this.lit = nodes;
    this.placeLabels(nodes);
    const e = this.elements.get(id)!;
    const reachOf = elementReach(this.artists, [e]).get(id);
    this.info.classList.remove('idle');
    this.info.replaceChildren(
      h('small', { style: `color:${color}` }, pick({ en: 'An element of music', ru: 'Элемент музыки' })),
      h('b', {}, (lang() === 'ru' && e.nameRu) || e.name),
      h('p', {}, (lang() === 'ru' && e.whatRu) || e.what),
      h('p.rm-el-count', {}, pick({ en: `Lit: ${edges.length} ${edges.length === 1 ? 'link carries' : 'links carry'} it, along ${reachOf?.routes ?? 0} ${reachOf?.routes === 1 ? 'route' : 'routes'}.`, ru: `Подсвечено связей, которые его несут: ${edges.length}; маршрутов: ${reachOf?.routes ?? 0}.` })),
      h('div.rm-info-btns', {}, h('button.btn', { type: 'button', onclick: () => this.panel.open({ element: e, color, reach: reachOf }) }, pick({ en: 'Where it comes from →', ru: 'Откуда он →' })), h('button.btn', { type: 'button', onclick: () => this.filterElement() }, pick({ en: 'Clear', ru: 'Сбросить' }))),
    );
  }

  private showInfo(n?: GNode, set?: Set<string>, cur = 0): void {
    this.info.classList.toggle('idle', !n);
    this.info.classList.remove('path');
    if (!n) {
      this.info.replaceChildren(
        h('p.rm-hint', {}, pick({ en: 'Tap an artist to read its route to the roots; a glowing root, to see all that grew from it.', ru: 'Коснитесь исполнителя — откроется его маршрут к корням; светящегося корня — всё, что из него выросло.' })),
      );
      return;
    }
    if (n.card) {
      const artists = [...set!].filter((k) => !this.g!.byId.get(k)!.card).length;
      const rec = recordingFor(this.app.listen, n.id);
      this.info.replaceChildren(
        h('small', {}, pick({ en: 'A root in the museum', ru: 'Корень в музее' })),
        h('b', {}, n.label),
        h('p', {}, pick({ en: `${count(artists, 'artist', 'en')} grew out of it.`, ru: `Из него выросло: ${count(artists, 'artist', 'ru')}.` })),
        h(
          'div.rm-info-btns',
          {},
          rec
            ? h('button.btn.rt-playcard', { type: 'button', 'aria-label': pick({ en: `Play ${n.label}: ${rec.title}`, ru: `Слушать: ${n.label}, ${rec.title}` }), onclick: () => miniPlayer().play([{ ref: n.id, label: n.label, rec }], 0) }, '▶ ', pick({ en: 'Listen', ru: 'Слушать' }))
            : null,
          h('a.btn', { href: `#focus=${n.id.slice(5)}`, 'data-card': n.id.slice(5) }, pick({ en: 'Open the card →', ru: 'Открыть карточку →' })),
        ),
      );
      return;
    }
    const a = this.byId.get(n.id)!;
    this.info.classList.add('path');
    const route = this.reader.el;
    this.reader.onRoute = (i) => {
      this.paintRoute(routeSet(a, this.byId, this.lineage), i);
      head.replaceChildren(...this.pathHead(a));
    };
    const rs = routeSet(a, this.byId, this.lineage);
    this.reader.set(rs, cur);
    const head = h('div.rm-path-head', {}, ...this.pathHead(a));
    // Phones: the sheet opens folded, so the lit path stays in view above it.
    this.info.classList.remove('open');
    const toggle = h(
      'button.btn.rm-sheet-toggle',
      {
        type: 'button',
        'aria-expanded': 'false',
        onclick: () => {
          const open = this.info.classList.toggle('open');
          toggle.setAttribute('aria-expanded', String(open));
          toggle.textContent = open ? pick({ en: 'Hide the route ↓', ru: 'Свернуть маршрут ↓' }) : pick({ en: 'Read the route ↑', ru: 'Читать маршрут ↑' });
        },
      },
      pick({ en: 'Read the route ↑', ru: 'Читать маршрут ↑' }),
    );
    this.info.replaceChildren(
      head,
      toggle,
      route,
      h('a.btn', { href: `#view=roots&artist=${a.id}`, 'data-artist-roots': a.id }, pick({ en: 'All routes in Roots →', ru: 'Все маршруты в «Корнях» →' })),
    );
    this.info.scrollTop = 0;
  }

  private pathHead(a: Artist): HTMLElement[] {
    const heard = this.reader.tracks().length;
    const summary = this.reader.summary();
    return [
      h('small', {}, `${a.years[0]} · ${placeName(a, lang())}`),
      h('b', {}, this.nameOf(a)),
      ...(((lang() === 'ru' && a.storyRu) || a.story) ? [h('p.rm-story', {}, (lang() === 'ru' && a.storyRu) || a.story!)] : []),
      ...(heard ? [h('button.btn.primary.rt-playroute', { type: 'button', onclick: () => this.reader.playRoute() }, svgIcon('wave'), pick({ en: 'Play the route', ru: 'Слушать маршрут' }))] : []),
      ...(summary ? [summary] : []),
    ];
  }

  /** Labels by importance; none overlap. While something is lit, its labels come first. */
  private placeLabels(priority?: Set<string>): void {
    const g = this.g;
    if (!g) return;
    const k = this.phone ? 1 : this.t.k;
    if (!this.phone) this.gAll.style.setProperty('--lk', String(1 / Math.max(0.5, k)));
    const order = [...g.nodes].sort((a, b) => Number(priority?.has(b.id) ?? 0) - Number(priority?.has(a.id) ?? 0) || Number(b.card) - Number(a.card) || b.support - a.support);
    const budget = this.phone ? 70 : Math.round(46 * Math.max(1, k));
    // On a phone with nothing lit, name only the roots and the six best-known
    // artists on screen; tapping lights and names a whole chain.
    const view = this.stage.getBoundingClientRect();
    const onScreen = (n: GNode) => {
      const r = this.nodeEls.get(n.id)!.getBoundingClientRect();
      return r.top >= view.top && r.bottom <= view.bottom;
    };
    const famous = this.phone && !priority ? new Set(order.filter((n) => !n.card && onScreen(n)).slice(0, 6).map((n) => n.id)) : undefined;
    // Show every candidate, measure where it really lands, keep those that fit.
    const lbls = order.map((n) => ({ n, el: this.nodeEls.get(n.id)!.querySelector('text') as SVGTextElement }));
    lbls.forEach(({ el }) => el.classList.remove('hide'));
    const rects = lbls.map(({ el }) => el.getBoundingClientRect());
    const boxes: DOMRect[] = [];
    let shown = 0;
    // Dots are obstacles too: a label never covers another artist's node.
    const dots = new Map<string, DOMRect>();
    for (const n of g.nodes) {
      const c = this.nodeEls.get(n.id)?.querySelector('circle.dot');
      if (c) dots.set(n.id, c.getBoundingClientRect());
    }
    let self = '';
    const over = (r: DOMRect, b: DOMRect) => r.left < b.right + 3 && r.right > b.left - 3 && r.top < b.bottom + 1 && r.bottom > b.top - 1;
    // A root's name may pass over a small artist dot, never over a label or another root.
    let selfCard = false;
    // While a path is lit, only its own dots are obstacles: the dimmed ones may be covered.
    const hits = (r: DOMRect) => boxes.some((b) => over(r, b)) || [...dots].some(([id, b]) => id !== self && b.width > 0 && (!priority || priority.has(id)) && (!selfCard || id.startsWith('card:')) && over(r, b));
    const fewArtists = !!priority && [...priority].filter((k) => !g.byId.get(k)?.card).length <= 8;
    const bigRoots = new Set(g.nodes.filter((x) => x.card).sort((a, b) => b.support - a.support).slice(0, 3).map((x) => x.id));
    lbls.forEach(({ n, el }, i) => {
      self = n.id;
      selfCard = n.card;
      let r = rects[i];
      // On a phone a lit path is named alone: an artist's chain, or for a root
      // only the traditions that grew from it, never the forty artists above.
      const want = priority
        ? priority.has(n.id) && (!this.litCard || n.card || fewArtists)
        : famous
          ? famous.has(n.id) || n.card
          : true;
      // Every root keeps its name: above its dot, or below it if that is taken.
      // A lit artist looks for a free place the same way; others stay above their dot.
      if (!n.card) {
        el.setAttribute('x', '0');
        el.setAttribute('y', String(-radius(n) - 5));
        el.setAttribute('text-anchor', 'middle');
        r = el.getBoundingClientRect();
      }
      if (n.card || (priority?.has(n.id) && hits(r))) {
        const rr = radius(n);
        // above, below, right, left: the first place that is free
        const spots: [number, number, string][] = [[0, -rr - 5, 'middle'], [0, rr + 16, 'middle'], [rr + 6, 4, 'start'], [-rr - 6, 4, 'end'], [rr + 4, -rr - 2, 'start'], [-rr - 4, -rr - 2, 'end'], [rr + 4, rr + 12, 'start'], [-rr - 4, rr + 12, 'end']];
        for (const [x, y, anchor] of spots) {
          el.setAttribute('x', String(x));
          el.setAttribute('y', String(y));
          el.setAttribute('text-anchor', anchor);
          r = el.getBoundingClientRect();
          if (!hits(r)) break;
        }
      }
      // Roots keep their names unless they would print over another label;
      // the three biggest roots always keep theirs, unless a path is lit.
      const free = !hits(r) || (n.card && bigRoots.has(n.id) && !priority);
      const ok = want && free && shown < budget && r.width > 0;
      el.classList.toggle('hide', !ok);
      if (ok) {
        boxes.push(r);
        shown++;
      }
    });
  }

  /** A node picked by click or keyboard: light it, or unlight it if it was lit. */
  private pick(id: string): void {
    this.pinned = this.pinned === id ? undefined : id;
    if (this.pinned && this.elFilter) {
      this.elFilter = undefined;
      this.elBar.querySelectorAll<HTMLElement>('[data-el]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      this.edgeEls.forEach(({ el }) => (el.classList.remove('el-on'), el.style.removeProperty('--kc')));
    }
    this.light(this.pinned);
  }

  private search(): void {
    const found = searchArtists(this.artists, this.input.value, 6);
    this.results.replaceChildren(...found.map((a) => h('li', { 'data-id': a.id, onmousedown: (e: Event) => (e.preventDefault(), this.focusOn(a.id)) }, this.nameOf(a))));
  }

  /** Fly to an artist and light its way down. */
  focusOn(id: string): void {
    const n = this.g?.byId.get(id);
    if (!n) return;
    this.input.value = '';
    this.results.replaceChildren();
    this.pinned = id;
    if (this.elFilter) {
      this.elFilter = undefined;
      this.elBar.querySelectorAll<HTMLElement>('[data-el]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      this.edgeEls.forEach(({ el }) => (el.classList.remove('el-on'), el.style.removeProperty('--kc')));
    }
    this.light(id);
    if (this.phone) {
      this.stage.scrollTo({ top: n.y! - this.stage.clientHeight / 4, left: Math.max(0, n.x! - this.stage.clientWidth / 2), behavior: reducedMotion() ? 'auto' : 'smooth' });
      return;
    }
    // Fit the whole way down to the roots, clear of the info plate.
    const set = reach(this.g!, id);
    const pts = [...set].map((k) => this.g!.byId.get(k)!);
    const W = this.stage.clientWidth;
    const H = this.stage.clientHeight;
    const plate = this.info.getBoundingClientRect();
    const usableW = W - (W > 900 ? Math.min(plate.width + 40, W * 0.4) : 0);
    const xs = pts.map((p) => p.x!);
    const ys = pts.map((p) => p.y!);
    const pad = 90;
    const [x0, x1, y0, y1] = [Math.min(...xs) - pad, Math.max(...xs) + pad, Math.min(...ys) - 50, Math.max(...ys) + 50];
    const k = Math.max(0.5, Math.min(3, usableW / (x1 - x0), H / (y1 - y0)));
    select(this.svg)
      .transition()
      .duration(reducedMotion() ? 0 : 1200)
      .call(this.zoomer.transform as never, zoomIdentity.translate((usableW - (x1 - x0) * k) / 2 - x0 * k, (H - (y1 - y0) * k) / 2 - y0 * k).scale(k));
  }
}

function pluralLead(n: number): string {
  const a = n % 100;
  const b = n % 10;
  return a > 10 && a < 20 ? 'ведут' : b === 1 ? 'ведёт' : 'ведут';
}
