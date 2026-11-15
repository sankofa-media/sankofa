// The atlas explorer: the map, the zoom ladder and the timeline, all driven by
// one atlas point (pkg/atlas.Point) so every view is a link.
import type { App } from '../app';
import type { Point } from '../lib/fragment';
import { terminalCommand } from '../lib/fragment';
import { copyText, h, svgIcon, toast } from '../lib/dom';
import { atlasLayers, eraColor } from '../lib/atlasModel';
import { formatYears, span } from '../lib/cards';
import { ERAS, type Card } from '../lib/types';
import { GeoMap, LEVEL_K, LEVEL_NAMES } from './map';
import { Timeline } from './timeline';
import { showTip, hideTip } from './tip';
import { chapterLabel, count, lang, pick, t } from '../lib/i18n';
import { countriesWithCards, countryCards, countryPoints, type CountriesFile, type Country } from '../lib/countries';
import { loadJson } from '../lib/loadJson';
import { atlasFactoids } from '../lib/factoids';
import { factoidView } from './factoid';

/** The atlas's own keys next to the shared point (lib/route.ts). */
export interface AtlasView {
  atlas?: 'countries';
  country?: string;
}

export class Atlas {
  readonly el: HTMLElement;
  private map?: GeoMap;
  private timeline?: Timeline;
  private stage: HTMLElement;
  private timeHost: HTMLElement;
  private when: HTMLElement;
  private levels: HTMLButtonElement[] = [];
  private pathbar: HTMLElement;
  private list: HTMLElement;
  private term: HTMLElement;
  private p: Point = {};
  private level = 1;
  private pathIndex = 0;
  private mode: 'time' | 'countries' = 'time';
  private country?: string;
  private countries?: CountriesFile;
  private countriesLoad?: Promise<void>;
  private modeBtns: HTMLButtonElement[] = [];
  private panel: HTMLElement;
  /** The factoid opened from its dot, shown in a small box over the map. */
  private factBox: HTMLElement;
  private factId?: string;
  /** `push` when the change is a page to come back to (a mode, a country). */
  onChange?: (p: Point, view: AtlasView, push?: boolean) => void;
  onClose?: () => void;

  constructor(private app: App) {
    this.when = h('div.when', { 'aria-live': 'polite' });
    this.term = h('div.term', { style: 'position:absolute;right:var(--gutter);top:calc(var(--nav-h) + 12px);z-index:4;max-width:min(560px,90vw)' }, h('code'));
    this.term.append(h('button', { onclick: async () => toast((await copyText(terminalCommand(this.point()))) ? t('Command copied') : t('Copy failed')) }, t('Copy')));
    const modes = h('div.atlas-mode', { role: 'group', 'aria-label': pick({ en: 'Atlas view', ru: 'Вид атласа' }) });
    for (const [m, label] of [
      ['time', pick({ en: 'Time', ru: 'Время' })],
      ['countries', pick({ en: 'Countries', ru: 'Страны' })],
    ] as const) {
      const b = h('button', { type: 'button', 'data-mode': m, 'aria-pressed': String(m === 'time'), onclick: () => this.setMode(m) }, label) as HTMLButtonElement;
      this.modeBtns.push(b);
      modes.append(b);
    }
    const bar = h(
      'header.atlas-bar',
      {},
      h('div.atlas-title', {}, h('h2', {}, t('Atlas')), h('p.atlas-why', {}, pick({ en: 'The museum in space: where everything happened.', ru: 'Музей в пространстве: где всё происходило.' }))),
      modes,
      this.when,
      h('div.sp'),
      h(
        'button.btn',
        {
          onclick: () => {
            this.term.querySelector('code')!.textContent = terminalCommand(this.point());
            this.term.classList.toggle('on');
          },
        },
        svgIcon('term'),
        h('span.label', {}, t('Open in terminal')),
      ),
      h('button.icon-btn', { 'aria-label': t('Close the atlas'), onclick: () => this.onClose?.() }, svgIcon('close')),
    );
    const ladder = h('div.levels', { role: 'group', 'aria-label': t('Zoom level') });
    LEVEL_NAMES.forEach((name, i) => {
      const short = pick({ en: ['Centuries', 'Regions', 'Cities', 'People', 'Document'], ru: ['Века', 'Регионы', 'Города', 'Люди', 'Документ'] })[i];
      const b = h('button', { 'aria-pressed': 'false', 'aria-label': name, onclick: () => this.setLevel(i + 1) }, h('b', {}, String(i + 1)), h('span', {}, name), h('span.short', {}, short)) as HTMLButtonElement;
      this.levels.push(b);
      ladder.append(b);
    });
    ladder.append(h('div.hint', {}, t('Zoom changes what is told, not only the scale. Keys: + − arrows [ ]')));
    this.pathbar = h('div.pathbar', { role: 'group', 'aria-label': t('Reader path') });
    const legend = h(
      'div.legend',
      { 'aria-hidden': 'true' },
      ERAS.map((e) => h('span', { style: `--c:${eraColor(e.id)}`, title: chapterLabel(e.id) }, h('i'), e.label)),
      h(
        'span.legend-note',
        {},
        pick({
          en: 'Middle Passage: line width is the share of people embarked from each African region (SlaveVoyages estimates).',
          ru: 'Средний путь: толщина линии — доля людей, вывезенных из каждого региона Африки (оценки SlaveVoyages).',
        }),
      ),
    );
    this.factBox = h('div.atlas-fact', { role: 'dialog', 'aria-modal': 'false', 'aria-label': pick({ en: 'A fact at this place', ru: 'Факт об этом месте' }), hidden: true, tabindex: '-1' });
    this.factBox.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.hideFact(true);
      }
    });
    this.stage = h('div.atlas-stage', {}, ladder, legend, this.pathbar, this.factBox);
    this.timeHost = h('div.atlas-time');
    this.list = h('div.atlas-list', { role: 'list' });
    this.panel = h('div.atlas-countries', { role: 'region', 'aria-label': pick({ en: 'Countries', ru: 'Страны' }) });
    this.el = h('section.atlas', { 'aria-label': t('Atlas'), role: 'region', tabindex: '-1' }, bar, this.stage, this.timeHost, this.list, this.panel, this.term);
    this.el.addEventListener('keydown', (e) => this.key(e));
    document.body.append(this.el);
    // Factoids come after the cards: their dots join an open atlas.
    void app.facts.ready.then(() => this.isOpen && this.draw(false));
  }

  /** Show a factoid from its dot: the sentence, its year, sources and cards. */
  showFact(id: string): void {
    const f = this.app.facts.list.find((x) => x.id === id);
    if (!f) return;
    this.factId = id;
    this.factBox.replaceChildren(
      h('button.icon-btn.close', { type: 'button', 'aria-label': pick({ en: 'Close', ru: 'Закрыть' }), onclick: () => this.hideFact(true) }, svgIcon('close')),
      // Place names are kept in English only; the Russian box goes without.
      ...(lang() === 'en' && f.place ? [h('span.atlas-fact-place', {}, f.place.name)] : []),
      factoidView(this.app, f, { compact: true }),
    );
    this.factBox.hidden = false;
    this.factBox.focus({ preventScroll: true });
    this.draw(false);
  }

  private hideFact(refocus = false): void {
    if (this.factBox.hidden) return;
    const id = this.factId;
    this.factBox.hidden = true;
    this.factId = undefined;
    this.draw(false);
    if (refocus && id) this.stage.querySelector<SVGGElement>(`g.fact[data-fact="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
  }

  get isOpen(): boolean {
    return this.el.classList.contains('open');
  }

  private ensure(): void {
    if (this.map) return;
    this.map = new GeoMap(this.stage, {
      interactive: true,
      detail: 'high',
      maxLabels: () => (window.innerWidth < 720 ? 5 : 18),
      // Names keep clear of the zoom ladder and of the legend in the corner.
      avoid: () => (this.mode === 'countries' ? this.panelBoxes() : [[0, 0, window.innerWidth < 720 ? 210 : 250, window.innerWidth < 720 ? 52 : 330], ...this.cornerBoxes()]),
      onPoint: (id) => this.focus(id),
      onFact: (id) => this.showFact(id),
      onCountry: (iso) => {
        const c = this.countries?.countries.find((x) => x.iso === iso);
        if (c) this.selectCountry(c.id);
      },
      onRegion: (r) => this.map!.flyTo(r.lon, r.lat, LEVEL_K[2], 1200),
      onLevel: (lvl) => {
        this.level = lvl;
        this.draw(false);
        this.emit();
      },
      onHover: (id, ev) => this.hover(id, ev),
    });
    this.stage.prepend(this.map.svg.node()!);
    const cards = this.app.set.all();
    this.timeline = new Timeline(this.timeHost, cards, this.eras(), {
      compact: true,
      brush: true,
      onSelect: (id) => this.focus(id),
      onBrush: (from, to) => {
        this.p = { ...this.p, from, to };
        this.draw(false);
        this.emit();
      },
      onEra: (id) => {
        const e = this.eras().find((x) => x.id === id)!;
        this.setTime(e.from, e.to);
      },
      onHover: (id, ev) => this.hover(id, ev),
    });
  }

  private eras() {
    return ERAS.map((e) => {
      const ch = this.app.chapters.find((c) => c.id === e.id);
      return ch?.years.length ? { ...e, from: ch.years[0], to: ch.years[1] ?? ch.years[0] } : e;
    });
  }

  open(p: Point, view: AtlasView = {}): void {
    this.ensure();
    const first = !this.isOpen;
    this.el.classList.add('open');
    document.body.classList.add('locked', 'atlas-open');
    if (first) this.el.focus({ preventScroll: true });
    this.mode = view.atlas === 'countries' ? 'countries' : 'time';
    this.country = this.mode === 'countries' ? view.country : undefined;
    this.showMode();
    if (this.mode === 'countries') {
      this.p = { ...p };
      this.level = p.zoom ?? 1;
      this.loadCountries().then(() => {
        this.draw(true);
        this.flyToCountry(first ? 1800 : 1200);
      });
      this.draw(true);
      return;
    }
    this.apply(p, first);
  }

  close(): void {
    this.factBox.hidden = true;
    this.factId = undefined;
    this.el.classList.remove('open');
    document.body.classList.remove('locked', 'atlas-open');
    this.term.classList.remove('on');
    hideTip();
  }

  /** Apply a point from a link. */
  apply(p: Point, fly = true): void {
    this.p = { ...p };
    const focusCard = p.focus ? this.app.set.get(p.focus) : undefined;
    const place = p.place ? this.app.set.resolvePlace(p.place) : undefined;
    this.level = p.zoom ?? (p.path?.length ? 3 : undefined) ?? focusCard?.zoom ?? (place ? 3 : 1);
    this.timeline!.setRange(p.from, p.to);
    if (p.from) this.timeline!.reveal(p.from);
    this.timeline!.setFocus(p.focus);
    if (p.path?.length) {
      const i = p.focus ? p.path.indexOf(p.focus) : 0;
      this.pathIndex = Math.max(0, i);
    }
    this.draw(true);
    const k = LEVEL_K[this.level - 1];
    this.map!.ready.then(() => {
      const dur = fly ? 1800 : 1200;
      this.map!.inset = focusCard && window.innerWidth > 900 ? 560 : 0;
      if (place && !focusCard) this.map!.flyTo(place.lon, place.lat, k, dur);
      else if (focusCard) this.map!.flyTo(focusCard.places[0].lon, focusCard.places[0].lat, k, dur);
      else if (p.path?.length) this.map!.fit(this.pathCards().map((c) => [c.places[0].lon, c.places[0].lat]), LEVEL_K[3], dur);
      else if (this.level >= 2) {
        // Open where there is something to see, not on the open sea.
        const c = this.densest() ?? [-28, 18];
        this.map!.flyTo(c[0], c[1], k, dur);
      } else this.map!.flyTo(-28, 18, k, dur);
    });
  }

  point(): Point {
    return { ...this.p, zoom: this.level };
  }

  view(): AtlasView {
    return this.mode === 'countries' ? { atlas: 'countries', ...(this.country ? { country: this.country } : {}) } : {};
  }

  private emit(push = false): void {
    this.onChange?.(this.point(), this.view(), push);
  }

  /** countries.json comes with the first visit to the Countries mode. */
  private loadCountries(): Promise<void> {
    this.countriesLoad ??= loadJson<CountriesFile>('data/countries.json', { timeout: 20_000 })
      .then((f) => {
        this.countries = f ?? { countries: [] };
      })
      .catch(() => {
        this.countriesLoad = undefined;
        this.countries = undefined;
        this.renderPanel(true);
      });
    return this.countriesLoad;
  }

  private setMode(m: 'time' | 'countries'): void {
    if (m === this.mode) return;
    this.mode = m;
    this.country = undefined;
    if (this.p.focus) this.app.closeCard();
    this.p = { ...this.p, focus: undefined };
    this.showMode();
    this.emit(true);
    if (m === 'countries') {
      this.loadCountries().then(() => {
        this.draw(true);
        this.flyToCountry(1200);
      });
      this.draw(true);
    } else {
      this.map?.setCountries(null);
      this.apply(this.p, false);
    }
  }

  private showMode(): void {
    const on = this.mode === 'countries';
    this.el.classList.toggle('countries', on);
    this.modeBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === this.mode)));
    if (this.map) this.map.insetLeft = on && window.innerWidth >= 720 ? this.panel.offsetLeft + this.panel.offsetWidth : 0;
    if (!on) this.panel.replaceChildren();
  }

  private chosen(): Country | undefined {
    return this.country ? this.countries?.countries.find((c) => c.id === this.country) : undefined;
  }

  /** Choose a country (undefined: back to the list). `fromList` moves focus to its heading. */
  selectCountry(id: string | undefined, fromList = false): void {
    if (id === this.country) return;
    const prev = this.country;
    if (this.p.focus) this.app.closeCard();
    this.p = { ...this.p, focus: undefined };
    this.country = id;
    this.draw(false);
    this.flyToCountry(1300);
    this.emit(true);
    // Keyboard and screen reader users land on what they chose, or back on the country they left.
    if (fromList) this.panel.querySelector<HTMLElement>(id ? '.cn-head h3' : `.cn-list button[data-country="${CSS.escape(prev ?? '')}"]`)?.focus({ preventScroll: true });
  }

  private flyToCountry(dur: number): void {
    if (!this.map) return;
    this.map.insetLeft = window.innerWidth >= 720 ? this.panel.offsetLeft + this.panel.offsetWidth : 0;
    const c = this.chosen();
    const map = this.map;
    map.ready.then(() => {
      if (!c) return map.flyTo(-28, 18, 1, dur);
      const pts = countryCards(this.app.set, c).flatMap((r) => r.places.slice(0, 1)).map((p) => [p.lon, p.lat] as [number, number]);
      if (pts.length) map.fit(pts, LEVEL_K[2], dur);
    });
  }

  /** The country panel's box on the map, for the labels to keep clear of. */
  private panelBoxes(): [number, number, number, number][] {
    if (window.innerWidth < 720 || !this.panel.offsetParent) return [];
    const s = this.stage.getBoundingClientRect();
    const r = this.panel.getBoundingClientRect();
    return [[r.left - s.left - 8, r.top - s.top - 8, r.right - s.left + 8, r.bottom - s.top + 8]];
  }

  private pathCards(): Card[] {
    return (this.p.path ?? []).map((id) => this.app.set.get(id)).filter(Boolean) as Card[];
  }

  focus(id: string): void {
    const c = this.app.set.get(id);
    if (!c) return;
    this.p = { ...this.p, focus: id };
    if (this.p.path) {
      const i = this.p.path.indexOf(id);
      if (i >= 0) this.pathIndex = i;
    }
    this.timeline?.setFocus(id);
    this.draw(false);
    const k = Math.max(LEVEL_K[this.level - 1], LEVEL_K[Math.min(c.zoom, 4) - 1]);
    if (this.map) this.map.inset = window.innerWidth > 900 ? Math.min(560, window.innerWidth) : 0;
    const at = this.mode === 'countries' ? (this.chosenRows().find((r) => r.card.id === id)?.places[0] ?? c.places[0]) : c.places[0];
    this.map?.flyTo(at.lon, at.lat, k, 1300);
    this.emit();
    this.app.openCard(id, { push: false });
  }

  unfocus(): void {
    if (!this.p.focus) return;
    this.p = { ...this.p, focus: undefined };
    this.timeline?.setFocus(undefined);
    this.draw(false);
    this.emit();
  }

  private setLevel(lvl: number): void {
    this.level = Math.max(1, Math.min(5, lvl));
    const target = this.level >= 2 ? this.nearestContent() : undefined;
    if (target) this.map?.flyTo(target[0], target[1], LEVEL_K[this.level - 1], 1100);
    else this.map?.setLevel(this.level);
    this.draw(false);
    this.emit();
  }

  /** The place with the most cards around it at this level: where a fresh atlas opens. */
  private densest(): [number, number] | undefined {
    const layers = atlasLayers(this.app.set, { level: this.level, from: this.p.from, to: this.p.to });
    const pts = layers.visible.map((c) => [c.places[0].lon, c.places[0].lat] as [number, number]);
    const r = [0, 30, 12, 8, 5][this.level - 1] ?? 8;
    let best: [number, number] | undefined;
    let bestN = 0;
    for (const p of pts) {
      const near = pts.filter((q) => Math.hypot((q[0] - p[0]) * Math.cos((p[1] * Math.PI) / 180), q[1] - p[1]) < r);
      if (near.length > bestN) {
        bestN = near.length;
        best = [near.reduce((s, q) => s + q[0], 0) / near.length, near.reduce((s, q) => s + q[1], 0) / near.length];
      }
    }
    return best;
  }

  /** At cities, people and documents, go to the nearest thing to look at, never an empty sea. */
  private nearestContent(): [number, number] | undefined {
    if (!this.map) return undefined;
    const [lon, lat] = this.map.center();
    const layers = atlasLayers(this.app.set, { level: this.level, from: this.p.from, to: this.p.to });
    const here = layers.visible.filter((c) => c.zoom >= Math.min(this.level, 4));
    const pool = here.length ? here : layers.visible;
    let best: [number, number] | undefined;
    let bestD = Infinity;
    for (const c of pool) {
      const p = c.places[0];
      const d = Math.hypot((p.lon - lon) * Math.cos((lat * Math.PI) / 180), p.lat - lat);
      if (d < bestD) {
        bestD = d;
        best = [p.lon, p.lat];
      }
    }
    return best;
  }

  private setTime(from?: number, to?: number): void {
    this.p = { ...this.p, from, to };
    this.timeline?.setRange(from, to);
    this.draw(false);
    this.emit();
  }

  /** The legend's box on the map, as the map measures its labels. */
  private cornerBoxes(): [number, number, number, number][] {
    const legend = this.stage.querySelector<HTMLElement>('.legend');
    if (!legend || !legend.offsetParent) return [];
    const s = this.stage.getBoundingClientRect();
    const r = legend.getBoundingClientRect();
    if (!r.width) return [];
    return [[r.left - s.left - 8, r.top - s.top - 8, r.right - s.left + 8, r.bottom - s.top + 4]];
  }

  private chosenRows() {
    const c = this.chosen();
    return c ? countryCards(this.app.set, c) : [];
  }

  private drawCountries(): void {
    const map = this.map!;
    const file = this.countries;
    const c = this.chosen();
    const list = file ? countriesWithCards(this.app.set, file, lang()) : [];
    map.setCountries(file ? { lit: new Set(list.map((x) => x.country.iso)), on: c?.iso, names: new Map(list.map((x) => [x.country.iso, x.country.name[lang()]])) } : null);
    const rows = this.chosenRows();
    map.setPoints(
      countryPoints(rows, this.level).map(({ card, lon, lat }) => ({
        id: card.id,
        lon,
        lat,
        label: card.title,
        title: true,
        color: eraColor(card.era),
        focus: card.id === this.p.focus,
        lit: card.id === this.p.focus,
        priority: (card.id === this.p.focus ? 100 : 0) + (6 - card.zoom) * 2,
        aria: `${card.title}, ${card.places[0].name}. ${card.wow}`,
      })),
    );
    map.setRoutes([], false);
    map.setFacts([]);
    this.factBox.hidden = true;
    this.factId = undefined;
    map.setRegions([]);
    map.setNumbers([]);
    this.when.textContent = c
      ? `${c.name[lang()]}: ${count(rows.length, 'card')}`
      : file
        ? pick({ en: `${list.length} countries have cards in your copy.`, ru: `Карточки вашего экземпляра есть в ${list.length} ${list.length % 10 === 1 && list.length % 100 !== 11 ? 'стране' : 'странах'}.` })
        : t('Loading the museum');
    this.list.replaceChildren();
    this.renderPanel();
  }

  private renderPanel(failed = false): void {
    if (this.mode !== 'countries') return;
    const file = this.countries;
    if (!file) {
      this.panel.replaceChildren(
        failed
          ? h('p.cn-why', {}, pick({ en: 'The list of countries could not be loaded.', ru: 'Не удалось загрузить список стран.' }), ' ', h('button.btn', { type: 'button', onclick: () => this.loadCountries().then(() => this.draw(false)) }, pick({ en: 'Try again', ru: 'Попробовать ещё раз' })))
          : h('p.cn-why.mx-loading', {}, pick({ en: 'Loading the countries…', ru: 'Загружаем страны…' })),
      );
      return;
    }
    const c = this.chosen();
    if (!c) return this.renderCountryList(file);
    const rows = this.chosenRows();
    const years = rows.map((r) => span(r.card));
    const range = years.length ? formatYears([Math.min(...years.map((y) => y[0])), Math.max(...years.map((y) => y[1]))]) : '';
    this.panel.replaceChildren(
      h('button.cn-back', { type: 'button', onclick: () => this.selectCountry(undefined, true) }, svgIcon('prev'), pick({ en: 'All countries', ru: 'Все страны' })),
      h(
        'div.cn-head',
        {},
        h('h3', { tabindex: '-1' }, c.name[lang()]),
        h('p.cn-count', {}, rows.length ? `${count(rows.length, 'card')} · ${range}` : pick({ en: 'No cards in your copy of the museum.', ru: 'В вашем экземпляре музея карточек нет.' })),
        c.disputed ? h('p.cn-disputed', {}, pick({ en: 'Its status is disputed; the museum lists it under no state.', ru: 'Статус этой территории оспаривается; музей не относит её ни к одному государству.' })) : null,
        c.about ? h('p.cn-about', {}, c.about[lang()]) : null,
      ),
      h(
        'ol.cn-cards',
        { 'aria-label': pick({ en: `Cards in time order`, ru: `Карточки по времени` }) },
        rows.map((r) =>
          h(
            'li',
            {},
            h(
              'button.cn-card',
              { type: 'button', style: `--era:${eraColor(r.card.era)}`, 'aria-current': r.card.id === this.p.focus ? 'true' : null, onclick: () => this.focus(r.card.id) },
              h('span.y', {}, formatYears(r.card.years)),
              h('b', {}, r.card.title),
              h('span.pl', {}, r.places.map((p) => p.name).join(' · ')),
            ),
          ),
        ),
      ),
    );
  }

  private renderCountryList(file: CountriesFile): void {
    const list = countriesWithCards(this.app.set, file, lang());
    const items = list.map(({ country, n }) =>
      h(
        'li',
        { 'data-name': country.name[lang()].toLowerCase() },
        h(
          'button.cn-item',
          { type: 'button', 'data-country': country.id, 'aria-label': `${country.name[lang()]}, ${count(n, 'card')}`, onclick: () => this.selectCountry(country.id, true) },
          h('span', {}, country.name[lang()]),
          h('span.n', { 'aria-hidden': 'true' }, String(n)),
        ),
      ),
    );
    const find = h('input.cn-find', {
      type: 'search',
      placeholder: pick({ en: 'Find a country', ru: 'Найти страну' }),
      'aria-label': pick({ en: 'Find a country', ru: 'Найти страну' }),
      oninput: (e: Event) => {
        const q = (e.target as HTMLInputElement).value.trim().toLowerCase();
        for (const li of items) li.hidden = !!q && !(li.dataset.name ?? '').includes(q);
      },
    });
    this.panel.replaceChildren(
      h(
        'div.cn-head',
        {},
        h('h3', {}, pick({ en: 'Countries', ru: 'Страны' })),
        h('p.cn-why', {}, pick({ en: 'Every card is counted where its places lie today. Choose a country on the map or in the list.', ru: 'Каждая карточка учтена там, где её места находятся сегодня. Выберите страну на карте или в списке.' })),
      ),
      find,
      h('ul.cn-list', { 'aria-label': pick({ en: 'Countries with cards', ru: 'Страны с карточками' }) }, items),
    );
  }

  private draw(animate: boolean): void {
    if (!this.map) return;
    if (this.mode === 'countries') return this.drawCountries();
    // The Middle Passage note explains the weighted lines of the first two levels only.
    this.stage.classList.toggle('lvl-near', this.level >= 3);
    const path = this.pathCards();
    const layers = atlasLayers(
      this.app.set,
      { level: this.level, from: this.p.from, to: this.p.to, focus: this.p.focus, lit: path.map((c) => c.id) },
    );
    if (path.length > 1) {
      layers.routes.push({
        id: 'path',
        color: 'var(--ink)',
        flow: true,
        legs: path.slice(1).map((c, i) => ({
          from: [path[i].places[0].lon, path[i].places[0].lat],
          to: [c.places[0].lon, c.places[0].lat],
        })),
      });
    }
    this.map.setPoints(layers.points);
    // Factoids with a place: light dots at cities and people, in the same time.
    const facts = atlasFactoids(this.app.facts.list, { level: this.level, from: this.p.from, to: this.p.to });
    if (this.factId && !facts.some((f) => f.id === this.factId)) {
      this.factBox.hidden = true;
      this.factId = undefined;
    }
    this.map.setFacts(facts.map((f) => ({ id: f.id, lon: f.place!.lon, lat: f.place!.lat, on: f.id === this.factId, aria: `${pick({ en: 'Fact', ru: 'Факт' })}, ${f.year}, ${lang() === 'en' ? f.place!.name + ': ' : ''}${pick({ en: f.en, ru: f.ru })}` })));
    this.map.setRoutes(layers.routes, animate || this.level <= 2);
    this.map.setRegions(layers.regions);
    this.map.setNumbers(path.map((c, i) => ({ n: i + 1, lon: c.places[0].lon, lat: c.places[0].lat })));
    this.levels.forEach((b, i) => {
      b.classList.toggle('on', i + 1 === this.level);
      b.setAttribute('aria-pressed', String(i + 1 === this.level));
    });
    const when = this.p.from ? formatYears(this.p.to ? [this.p.from, this.p.to] : [this.p.from]) : t('1300 – today');
    // One sentence, not a stat row.
    const n = layers.points.filter((p) => !p.out).length;
    const mine = this.app.set.all().length;
    this.when.textContent = pick({ en: `${n} of ${count(mine, 'card', 'en')} have a place on the map, ${when}.`, ru: `На карте ${n} из ${count(mine, 'cardOf', 'ru')}, ${when}.` });
    this.renderPathbar(path);
    this.renderList(layers.points.filter((p) => !p.out).map((p) => this.app.set.get(p.id)).filter((c): c is Card => !!c));
  }

  /** On phones the timeline becomes a list under a small map: eras to filter, cards to open. */
  private renderList(visible: Card[]): void {
    if (window.innerWidth >= 720) return this.list.replaceChildren();
    const eras = this.eras();
    const chips = h(
      'div.atlas-eras',
      {},
      h('button.chip', { 'aria-pressed': String(!this.p.from), onclick: () => this.setTime() }, '1300 –'),
      eras.map((e) => h('button.chip', { 'aria-pressed': String(this.p.from === e.from && this.p.to === e.to), onclick: () => this.setTime(e.from, e.to), title: chapterLabel(e.id) }, e.label)),
    );
    const items = [...visible].sort((a, b) => span(a)[0] - span(b)[0]).map((c) =>
      h('button.atlas-item', { role: 'listitem', onclick: () => this.focus(c.id), style: `--era:${eraColor(c.era)}` }, h('span.y', {}, formatYears(c.years)), h('b', {}, c.title), h('span.pl', {}, c.places[0].name)),
    );
    // The atlas sentence reads under the map on phones, where it has room.
    this.list.replaceChildren(h('p.atlas-when', {}, this.when.textContent ?? ''), chips, ...items);
  }

  private renderPathbar(path: Card[]): void {
    this.pathbar.classList.toggle('on', path.length > 0);
    if (!path.length) return;
    const i = this.pathIndex;
    const go = (j: number) => {
      const c = path[Math.max(0, Math.min(path.length - 1, j))];
      this.focus(c.id);
    };
    this.pathbar.replaceChildren(
      h('span', {}, t('A reader’s path ·') + ' ', h('b', {}, `${i + 1} / ${path.length}`)),
      h('button.icon-btn', { 'aria-label': t('Previous card in the path'), onclick: () => go(this.pathIndex - 1), disabled: i === 0 }, svgIcon('prev')),
      h('button.icon-btn', { 'aria-label': t('Next card in the path'), onclick: () => go(this.pathIndex + (this.p.focus ? 1 : 0)), disabled: i >= path.length - 1 && !!this.p.focus }, svgIcon('next')),
    );
  }

  private hover(id: string | null, ev?: MouseEvent): void {
    if (!id || !ev) return hideTip();
    const c = this.app.set.get(id);
    if (!c) return hideTip();
    const [a, b] = span(c);
    showTip(ev, `${c.places[0].name} · ${a === b ? a : `${a}–${b}`}`, c.title, c.wow);
  }

  private key(e: KeyboardEvent): void {
    if (!this.map || (e.target as HTMLElement).closest('.drawer')) return;
    // Typing in the country search moves the cursor, not the map.
    if ((e.target as HTMLElement).matches('input, textarea') && e.key !== 'Escape') return;
    const step = 90;
    const width = this.p.from ? Math.max(10, (this.p.to ?? this.p.from) - this.p.from) : 25;
    switch (e.key) {
      case 'ArrowLeft':
        this.map.pan(step, 0);
        break;
      case 'ArrowRight':
        this.map.pan(-step, 0);
        break;
      case 'ArrowUp':
        this.map.pan(0, step);
        break;
      case 'ArrowDown':
        this.map.pan(0, -step);
        break;
      case '+':
      case '=':
        this.setLevel(this.level + 1);
        break;
      case '-':
      case '_':
        this.setLevel(this.level - 1);
        break;
      case '[':
        this.setTime((this.p.from ?? 1850) - width, (this.p.to ?? this.p.from ?? 1850) - width);
        break;
      case ']':
        this.setTime((this.p.from ?? 1850) + width, (this.p.to ?? this.p.from ?? 1850) + width);
        break;
      case 'Escape':
        this.onClose?.();
        break;
      default:
        return;
    }
    e.preventDefault();
  }
}
