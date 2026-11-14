// One route, read top to bottom: a station, then the link that leads to the
// next one (what was passed on, then the evidence and its sources), then
// that station. Where the route splits, a marker offers the other ways.
// Stations with a recording get a ▶ that plays into the docked player.
// Shared by the Roots view and the music map's side panel.
import type { App } from '../app';
import { h } from '../lib/dom';
import { formatYears } from '../lib/cards';
import { chapterLabel, lang, pick } from '../lib/i18n';
import { eraColor } from '../lib/atlasModel';
import { recordingFor } from '../lib/listen';
import { mediaSrc } from '../lib/media';
import { placeName, quotes, type Artist } from '../lib/roots';
import type { CardLink, MusicElement } from '../lib/elements';
import { forksOf, stepsOf, threadsOf, type RouteSet, type RouteStep, type StepKind, type Thread } from '../lib/routes';
import { miniPlayer, type Track } from './miniPlayer';

export interface RouteCtx {
  app: App;
  byId: Map<string, Artist>;
  cardLinks: Map<string, CardLink>;
  elements: Map<string, MusicElement>;
  colors: Map<string, string>;
  onElement: (id: string) => void;
}

/** The kind of a step as words between two names: "Led Zeppelin covered the blues". */
export const VERB: Record<StepKind, { en: string; ru: string }> = {
  // English joins the two names with a verb. Russian names the step after
  // them («Эд Ширан → Эминем — влияние»): a verb between two names would
  // need cases and genders the names do not give.
  influence: { en: 'was influenced by', ru: 'влияние' },
  cover: { en: 'covered', ru: 'кавер-версия' },
  sample: { en: 'sampled', ru: 'сэмпл' },
  interpolation: { en: 'interpolated', ru: 'интерполяция' },
  member: { en: 'played in the band of', ru: 'игра в ансамбле' },
  producer: { en: 'was produced by', ru: 'работа с продюсером' },
  scene: { en: 'was rooted in', ru: 'общая сцена' },
  teacher: { en: 'learned from', ru: 'ученичество' },
  collaboration: { en: 'played with', ru: 'совместная игра' },
  lineage: { en: 'grew out of', ru: 'жанровые корни' },
  unknown: { en: 'leads to', ru: 'связь' },
};

/** A group, not a person: one year (founding) and a name that is not a person's. */
export function isGroup(a: Pick<Artist, 'years' | 'name'>): boolean {
  return a.years.length === 1 && (/^the\s/i.test(a.name) || !/^[A-Z][a-z]+\s[A-Z][a-z]+$/.test(a.name));
}

export class RouteReader {
  readonly el: HTMLElement;
  private rs?: RouteSet;
  private cur = 0;
  private route: string[] = [];
  private steps: RouteStep[] = [];
  private threads: Thread[] = [];
  onRoute?: (i: number) => void;

  constructor(
    private ctx: RouteCtx,
    private compact = false,
  ) {
    this.el = h(`div.rt-reader${compact ? '.compact' : ''}`);
    document.addEventListener('mp-change', (e) => this.markPlaying((e as CustomEvent<{ ref?: string }>).detail.ref));
  }

  get current(): number {
    return this.cur;
  }

  get threadList(): Thread[] {
    return this.threads;
  }

  /** The route's stations that can be heard, as the docked player's queue. */
  tracks(): Track[] {
    return this.route
      .map((ref) => ({ ref, label: this.name(ref), rec: recordingFor(this.ctx.app.listen, ref)! }))
      .filter((t) => t.rec);
  }

  /** Walk the route through the docked player, from its first recording (a click). */
  playRoute(): void {
    const q = this.tracks();
    if (q.length) miniPlayer().play(q, 0);
  }

  set(rs: RouteSet, current: number): void {
    this.rs = rs;
    this.cur = Math.max(0, Math.min(current, rs.routes.length - 1));
    this.route = rs.routes[this.cur] ?? [];
    this.steps = stepsOf(this.route, this.ctx.byId, this.ctx.cardLinks);
    this.threads = threadsOf(this.route, this.steps, this.ctx.elements);
    this.render();
  }

  select(i: number, focusAt?: string): void {
    if (!this.rs || i < 0) return;
    this.set(this.rs, i);
    this.onRoute?.(i);
    if (focusAt) this.el.querySelector<HTMLElement>(`.rt-station[data-ref="${CSS.escape(focusAt)}"]`)?.focus({ preventScroll: false });
  }

  name(ref: string): string {
    if (ref.startsWith('card:')) return this.ctx.app.set.get(ref.slice(5))?.title ?? ref.slice(5);
    const a = this.ctx.byId.get(ref);
    return a ? (lang() === 'ru' && a.nameRu) || a.name : ref;
  }

  elName(id: string): string {
    const e = this.ctx.elements.get(id);
    return e ? (lang() === 'ru' && e.nameRu) || e.name : id;
  }

  /** "Along this line travelled: …", one coloured thread per element. */
  summary(): HTMLElement | null {
    if (!this.threads.length) return null;
    return h(
      'div.rt-threads',
      {},
      h('span.rt-threads-lede', {}, pick({ en: 'Along this line travelled', ru: 'По этой линии прошли' })),
      h(
        'ul',
        {},
        this.threads.map((t) => {
          const origin = t.origin !== undefined ? this.name(this.route[t.origin]) : undefined;
          return h('li', {}, this.elChip(t.element, origin ? pick({ en: `from ${origin}`, ru: `истоки: ${origin}` }) : undefined));
        }),
      ),
    );
  }

  private elChip(id: string, note?: string): HTMLElement {
    return h(
      'button.rt-el',
      { type: 'button', style: `--ec:${this.ctx.colors.get(id) ?? 'var(--gold)'}`, 'aria-label': pick({ en: `${this.elName(id)}: what it is and where it comes from`, ru: `${this.elName(id)}: что это и откуда` }), onclick: () => this.ctx.onElement(id) },
      h('i', { 'aria-hidden': 'true' }),
      this.elName(id),
      note ? h('small', {}, note) : null,
    );
  }

  private render(): void {
    const rs = this.rs!;
    const forks = new Map(forksOf(rs, this.cur).map((f) => [f.at, f]));
    const items: HTMLElement[] = [];
    // Thread rails: which elements run past each row.
    const rails = (lo: number, hi: number) => this.threads.map((t, k) => (t.from <= hi && lo <= t.to ? h('span.rt-rail', { style: `--ec:${this.ctx.colors.get(t.element)};--k:${k}`, 'aria-hidden': 'true' }) : null)).filter(Boolean) as HTMLElement[];
    this.route.forEach((ref, i) => {
      // a station sits between step i-1 and step i
      items.push(h('li.rt-row', {}, ...rails(i - 0.5, i - 0.5), this.station(ref, i)));
      const f = forks.get(i);
      if (f) items.push(h('li.rt-row', {}, ...rails(i, i), this.forkEl(f.options, i)));
      const s = this.steps[i];
      if (s) items.push(h('li.rt-row', {}, ...rails(i, i), this.linkEl(s, i)));
    });
    this.el.style.setProperty('--rails', String(this.threads.length));
    this.el.replaceChildren(h('ol.rt-route', { 'aria-label': pick({ en: 'The route, station by station', ru: 'Маршрут, станция за станцией' }) }, items));
    this.markPlaying(miniPlayer().current());
  }

  private markPlaying(ref?: string): void {
    this.el.querySelectorAll<HTMLElement>('.rt-play').forEach((b) => {
      const on = b.dataset.ref === ref;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  private playBtn(ref: string): HTMLElement | null {
    const rec = recordingFor(this.ctx.app.listen, ref);
    if (!rec) return null;
    return h(
      'button.rt-play',
      {
        type: 'button',
        'data-ref': ref,
        'aria-pressed': 'false',
        'aria-label': pick({ en: `Play ${this.name(ref)}: ${rec.title}`, ru: `Слушать: ${this.name(ref)}, ${rec.title}` }),
        title: rec.title,
        onclick: () => {
          const q = this.tracks();
          miniPlayer().play(q, Math.max(0, q.findIndex((t) => t.ref === ref)));
        },
      },
      h('span', { 'aria-hidden': 'true' }, '▶'),
    );
  }

  private station(ref: string, i: number): HTMLElement {
    const first = i === 0;
    const last = i === this.route.length - 1;
    const play = this.playBtn(ref);
    if (ref.startsWith('card:')) {
      const id = ref.slice(5);
      const c = this.ctx.app.set.forEdition(id, this.ctx.app.edition) ?? this.ctx.app.set.get(id);
      const img = c?.media?.find((m) => m.type === 'image');
      const deep = i > 0 && this.route[i - 1].startsWith('card:');
      const origins = this.threads.filter((t) => t.origin === i);
      return h(
        `div.rt-station.rt-cardst${deep ? '.deep' : ''}${last ? '.end' : ''}`,
        { 'data-ref': ref, tabindex: '-1', style: c ? `--era:${eraColor(c.era)}` : undefined },
        h(
          'a.rt-card',
          { href: `#focus=${id}`, 'data-card': id },
          img ? h('img', { ...mediaSrc(this.ctx.app, img.file, [480]), sizes: '120px', alt: '', loading: 'lazy', decoding: 'async' }) : null,
          h(
            'div',
            {},
            h('small', {}, [pick({ en: 'In the museum', ru: 'В музее' }), c ? chapterLabel(c.era) : '', c ? formatYears(c.years) : ''].filter(Boolean).join(' · ')),
            h('b', {}, c?.title ?? id),
            c?.wow ? h('span', {}, c.wow) : null,
          ),
        ),
        play,
        origins.length
          ? h(
              'p.rt-origin',
              {},
              pick({ en: 'Where it comes from: ', ru: 'Отсюда родом: ' }),
              ...origins.flatMap((t, k) => [k ? ', ' : '', this.elChip(t.element)]),
            )
          : null,
      );
    }
    const a = this.ctx.byId.get(ref);
    if (!a) return h('div.rt-station', { 'data-ref': ref }, ref);
    const genre = (lang() === 'ru' && a.genreRu) || a.genre;
    let hue = 0;
    for (const ch of a.genre) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
    const name = this.name(ref);
    const body = [
      h('span.rt-mono', { 'aria-hidden': 'true' }, name.replace(/^the\s+/i, '').charAt(0)),
      h('div.rt-plate', {}, h('b', {}, name), h('small', {}, `${formatYears(a.years)} · ${placeName(a, lang())} · ${genre}`)),
    ];
    return h(
      `div.rt-station.rt-artist${first ? '.first' : ''}`,
      { 'data-ref': ref, tabindex: '-1', style: `--hue:${hue}` },
      first || this.compact
        ? h('div.rt-who', {}, ...body)
        : h('a.rt-who', { href: `#view=roots&artist=${ref}`, 'data-artist': ref, title: pick({ en: 'Follow this artist’s own roots', ru: 'Проследить корни этого исполнителя' }) }, ...body),
      play,
    );
  }

  private forkEl(options: { next: string; route: number }[], at: number): HTMLElement {
    const names = options.map((o) => this.name(o.next));
    const or = (list: string[], word: string) => (list.length < 2 ? list[0] : `${list.slice(0, -1).join(', ')} ${word} ${list[list.length - 1]}`);
    return h(
      'div.rt-fork',
      { role: 'group', 'aria-label': pick({ en: 'The line splits here', ru: 'Здесь линия расходится' }) },
      h('p', {}, pick({ en: `Here the line splits — via ${or(names, 'or')}.`, ru: `Здесь линия расходится. Дальше — ${or(names, 'или')}.` })),
      h(
        'div.rt-fork-ways',
        {},
        options.map((o, k) =>
          h(
            `button.rt-way${k === 0 ? '.on' : ''}`,
            {
              type: 'button',
              'aria-pressed': String(k === 0),
              'data-next': o.next,
              onclick: () => k && this.select(o.route, this.route[at]),
            },
            pick({ en: `via ${this.name(o.next)}`, ru: `→ ${this.name(o.next)}` }),
          ),
        ),
      ),
    );
  }

  private linkEl(s: RouteStep, i: number): HTMLElement {
    const L = lang();
    const l = s.link;
    const cl = s.cardLink;
    const from = this.name(s.from);
    const to = this.name(s.to);
    // A band goes on through its member; a person played in a leader's band.
    let verb = pick(VERB[s.kind]);
    if (s.kind === 'member') {
      const a = this.ctx.byId.get(s.from);
      if (a && isGroup(a)) verb = pick({ en: 'through its member', ru: 'участник группы' });
    }
    const how = (L === 'ru' && (l?.howRu || cl?.howRu)) || l?.how || cl?.how;
    const claim = l ? quotes((L === 'ru' && l.claimRu) || l.claim, L) : cl ? quotes((L === 'ru' && cl.claimRu) || cl.claim, L) : '';
    const what = l?.what ? quotes((L === 'ru' && l.whatRu) || l.what, L) : '';
    const carried = s.carries.filter((id) => this.ctx.elements.has(id));
    const lead = how
      ? h('p.rt-how', {}, how)
      : carried.length
        ? h('p.rt-how', {}, pick({ en: 'Passed on: ', ru: 'Передано: ' }), ...carried.flatMap((id, k) => [k ? ', ' : '', this.elChip(id)]))
        : null;
    const sources = l?.sources ?? [];
    return h(
      `div.rt-link.k-${s.kind}`,
      { 'data-step': String(i) },
      L === 'ru'
        ? h('p.rt-verb', {}, h('span', {}, from), ' → ', h('span', {}, to), ' — ', h('em', {}, verb))
        : h('p.rt-verb', {}, h('span', {}, from), ' ', h('em', {}, verb), ' ', h('span', {}, to)),
      lead,
      how && carried.length ? h('p.rt-carried', {}, ...carried.map((id) => this.elChip(id))) : null,
      claim ? h(`p.rt-claim${lead ? '.evidence' : ''}`, {}, lead ? h('small', {}, pick({ en: 'The evidence', ru: 'Свидетельство' })) : null, claim) : null,
      what && what !== claim ? h('p.rt-what', {}, what) : null,
      cl?.rests && s.kind === 'lineage' ? h('p.rt-rests', {}, pick({ en: 'As the museum card says', ru: 'Так говорит карточка музея' }), ': ', h('a', { href: `#focus=${cl.rests.card}`, 'data-card': cl.rests.card }, this.name(`card:${cl.rests.card}`))) : null,
      sources.length ? h('ol.rt-src', { 'aria-label': pick({ en: 'Sources', ru: 'Источники' }) }, sources.map((src) => h('li', {}, h('a', { href: src.url, rel: 'noopener', target: '_blank' }, src.title)))) : null,
    );
  }
}
