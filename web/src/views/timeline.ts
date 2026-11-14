// The timeline: eras v0–v7 as bands, lives as bars, events as beads. Time is
// stretched where the cards are dense, so the 1300s do not eat the page.
import { scaleLinear, type ScaleLinear } from 'd3-scale';
import { select, type Selection } from 'd3-selection';
import { brushX, type BrushBehavior } from 'd3-brush';
import type { Card } from '../lib/types';
import { formatYears, span, when } from '../lib/cards';
import { eraColor } from '../lib/atlasModel';
import { chapterLabel, chapterNumber, pick, t } from '../lib/i18n';

export interface EraSpan {
  id: string;
  label: string;
  from: number;
  to: number;
}

interface Options {
  compact?: boolean;
  /** Font size the life names are drawn at, so they are measured right. */
  labelSize?: number;
  brush?: boolean;
  onSelect?: (id: string) => void;
  onBrush?: (from?: number, to?: number) => void;
  onEra?: (id: string) => void;
  onHover?: (id: string | null, ev?: MouseEvent) => void;
}

const NOW = new Date().getFullYear();

/** Where the scale changes pace: drawn on the axis as breaks. */
export const SCALE_BREAKS = [1500, 1700, 1850, 1950];

/**
 * Piecewise linear, widening toward today, with every change of pace marked
 * on the axis: 1300–1500, 1500–1700, 1700–1850, 1850–1950, 1950–now.
 */
export function yearScale(width: number, left = 24, right = 24): ScaleLinear<number, number> {
  const inner = width - left - right;
  return scaleLinear()
    .domain([1300, ...SCALE_BREAKS, NOW])
    .range([0, 0.06, 0.15, 0.33, 0.72, 1].map((f) => left + f * inner))
    .clamp(true);
}

export class Timeline {
  private svg: Selection<SVGSVGElement, unknown, null, undefined>;
  private x!: ScaleLinear<number, number>;
  private brush?: BrushBehavior<unknown>;
  private gBrush?: Selection<SVGGElement, unknown, null, undefined>;
  private silent = false;
  private range: [number, number] | null = null;
  private ro: ResizeObserver;
  private width = 0;

  constructor(
    private host: HTMLElement,
    private cards: Card[],
    private eras: EraSpan[],
    private opts: Options = {},
  ) {
    this.svg = select(host).append('svg').attr('class', 'tl') as never;
    this.svg.attr('role', 'group').attr('aria-label', t('Timeline, 1300 to today'));
    this.ro = new ResizeObserver(() => {
      const w = Math.max(this.opts.compact ? 900 : 1100, host.clientWidth);
      if (Math.abs(w - this.width) > 4) this.render();
    });
    this.ro.observe(host);
    this.render();
  }

  setCards(cards: Card[]): void {
    this.cards = cards;
    this.render();
  }

  private render(): void {
    const compact = !!this.opts.compact;
    const W = Math.max(compact ? 900 : 1100, this.host.clientWidth);
    this.width = W;
    const x = (this.x = yearScale(W));
    const svg = this.svg;
    svg.selectAll('*').remove();

    // Eras: greedy lanes for overlapping spans.
    const eraLanes: number[] = [];
    const eraRows = this.eras.map((e) => {
      let lane = eraLanes.findIndex((end) => end < x(e.from) - 2);
      if (lane < 0) lane = eraLanes.length;
      eraLanes[lane] = x(e.to);
      return { e, lane };
    });
    const eraSize = compact ? 12 : 10.5;
    const eraH = 16;
    const eraTop = 6;
    const lifeTop = eraTop + eraLanes.length * (eraH + 3) + 12;
    // Names are measured at the size they are drawn (the atlas draws larger).
    const size = this.opts.labelSize ?? (compact ? 12.5 : 11);
    const rowH = Math.round(size + (compact ? 6 : 9));
    const maxRows = compact ? 9 : 14;
    const barH = Math.round(size + (compact ? 1.5 : 3));

    // Lives are bars with their name inside, after or before the bar, never
    // cut and never over another name; everything else is a bead in a strip
    // of its own, named on hover.
    const items = [...this.cards].sort((a, b) => span(a)[0] - span(b)[0]);
    const lives: LifeIn[] = [];
    const beads: { c: Card; x: number; lane: number }[] = [];
    const beadEnds: number[] = [];
    const bead = (c: Card, xm: number) => {
      let lane = beadEnds.findIndex((e) => e < xm - 7);
      if (lane < 0) lane = beadEnds.length < 3 ? beadEnds.length : beadEnds.indexOf(Math.min(...beadEnds));
      beadEnds[lane] = xm;
      beads.push({ c, x: xm, lane });
    };
    const byId = new Map<string, Card>();
    for (const c of items) {
      const [a, b] = span(c);
      const life = c.kind === 'person' && b > a;
      // A bead stands at the moment its story is about.
      if (!life) {
        bead(c, x(when(c).year));
        continue;
      }
      byId.set(c.id, c);
      lives.push({ id: c.id, title: c.title, x0: x(a), x1: Math.max(x(b), x(a) + 4) });
    }
    const lay = layoutLives(lives, { measure: (s) => textWidth(s, size) * 1.08, maxRows, left: x(1300) - 20, right: x(NOW) });
    // No room in any row: the life joins the beads rather than overlap another.
    for (const id of lay.overflow) bead(byId.get(id)!, lives.find((l) => l.id === id)!.x0);
    const placed = lay.placed.map((p) => ({ ...p, c: byId.get(p.id)! }));
    const beadTop = lifeTop + Math.max(1, lay.rows) * rowH + 6;
    const lanesH = Math.max(1, beadEnds.length) * 9;
    const axisY = beadTop + lanesH + 8;
    const H = axisY + 40;
    svg.attr('width', W).attr('height', H).attr('viewBox', `0 0 ${W} ${H}`);

    const gEra = svg.append('g');
    for (const { e, lane } of eraRows) {
      const g = gEra
        .append('g')
        .attr('class', 'era')
        .attr('tabindex', 0)
        .attr('role', 'button')
        .attr('aria-label', `${chapterLabel(e.id)}, ${e.label}, ${e.from} to ${e.to}`)
        .style('--era', eraColor(e.id))
        .on('click', () => this.opts.onEra?.(e.id))
        .on('keydown', (ev: KeyboardEvent) => {
          if (ev.key === 'Enter') this.opts.onEra?.(e.id);
        });
      const y = eraTop + lane * (eraH + 3);
      g.append('rect').attr('x', x(e.from)).attr('y', y).attr('width', Math.max(6, x(e.to) - x(e.from))).attr('height', eraH).attr('rx', 3);
      // The chapter's name where it fits, its number where it does not.
      const room = x(e.to) - x(e.from) - 12;
      const label = textWidth(e.label, eraSize) * 1.12 <= room ? e.label : String(chapterNumber(e.id) ?? '');
      g.append('text')
        .attr('x', x(e.from) + 6)
        .attr('y', y + eraH / 2 + eraSize * 0.36)
        .text(label);
      g.append('title').text(`${chapterLabel(e.id)} · ${e.label}`);
    }

    // Century and decade ticks.
    const gAxis = svg.append('g').attr('class', 'axis');
    const ticks: number[] = [];
    for (let y = 1300; y <= NOW; y += 50) ticks.push(y);
    for (const t of ticks) {
      const major = t % 100 === 0;
      if (!major && t < 1700) continue;
      const g = gAxis.append('g').attr('class', major ? 'tick-major' : 'tick');
      g.append('line').attr('x1', x(t)).attr('x2', x(t)).attr('y1', lifeTop - 6).attr('y2', axisY);
      if (major || t >= 1850) g.append('text').attr('x', x(t)).attr('y', axisY + 16).attr('text-anchor', 'middle').text(t);
    }
    // The scale changes pace at these years: say so where it happens.
    for (const b of SCALE_BREAKS) {
      const g = gAxis.append('g').attr('class', 'scale-break');
      g.append('text').attr('x', x(b)).attr('y', axisY + 4).attr('text-anchor', 'middle').text('≈');
    }
    gAxis
      .append('text')
      .attr('class', 'scale-note')
      .attr('x', x(1300))
      .attr('y', axisY + 32)
      .text(pick({ en: 'The scale widens toward today; ≈ marks where its pace changes.', ru: 'Шкала растягивается к нашим дням; ≈ отмечает, где меняется её шаг.' }));
    const now = svg.append('g').attr('class', 'now');
    now.append('line').attr('x1', x(NOW)).attr('x2', x(NOW)).attr('y1', lifeTop - 6).attr('y2', axisY);

    const gLife = svg.append('g');
    const hook = (g: Selection<SVGGElement, unknown, null, undefined>, c: Card) =>
      g
        .attr('data-id', c.id)
        .attr('tabindex', 0)
        .attr('role', 'button')
        .attr('aria-label', `${c.title}, ${formatYears(c.years)}`)
        .style('--era', eraColor(c.era))
        .on('click', () => this.opts.onSelect?.(c.id))
        .on('keydown', (ev: KeyboardEvent) => {
          if (ev.key === 'Enter') this.opts.onSelect?.(c.id);
        })
        .on('mouseenter', (ev: MouseEvent) => this.opts.onHover?.(c.id, ev))
        .on('mouseleave', () => this.opts.onHover?.(null));
    for (const p of placed) {
      const y = lifeTop + p.row * rowH;
      const g = hook(gLife.append('g').attr('class', 'life'), p.c);
      g.append('rect').attr('x', p.x0).attr('y', y).attr('width', p.x1 - p.x0).attr('height', barH).attr('rx', barH / 2);
      g.append('title').text(`${p.c.title}, ${formatYears(p.c.years)}`);
      if (p.label !== 'none') {
        const tx = p.label === 'in' ? p.x0 + 6 : p.label === 'out' ? p.x1 + 5 : p.x0 - 5;
        g.append('text')
          .attr('class', p.label === 'in' ? 'in' : 'out')
          .attr('x', tx)
          .attr('text-anchor', p.label === 'before' ? 'end' : null)
          .attr('y', y + barH / 2 + size * 0.34)
          .text(p.c.title);
      }
    }
    for (const b of beads) {
      const g = hook(gLife.append('g').attr('class', 'life bead'), b.c);
      g.append('circle').attr('cx', b.x).attr('cy', beadTop + b.lane * 9 + 4).attr('r', 3.2);
    }
    if (this.opts.brush) {
      this.brush = brushX()
        .extent([
          [x(1300), 0],
          [x(NOW), axisY],
        ])
        .filter((ev: Event) => !(ev.target as Element).closest?.('.life, .era') || (ev as MouseEvent).shiftKey)
        .on('end', (ev) => {
          if (this.silent) return;
          if (!ev.selection) {
            this.range = null;
            this.opts.onBrush?.();
            return;
          }
          const [s0, s1] = ev.selection as [number, number];
          const r: [number, number] = [Math.round(x.invert(s0)), Math.round(x.invert(s1))];
          this.range = r;
          this.opts.onBrush?.(r[0], r[1]);
        });
      this.gBrush = svg.insert('g', ':first-child').attr('class', 'brush').call(this.brush as never);
      this.gBrush.select('.overlay').attr('aria-hidden', 'true');
      if (this.range) this.setRange(this.range[0], this.range[1]);
    }
  }

  setRange(from?: number, to?: number): void {
    this.range = from ? [from, to ?? from] : null;
    if (!this.brush || !this.gBrush) return;
    this.silent = true;
    if (this.range) {
      const a = this.x(this.range[0]);
      const b = Math.max(this.x(this.range[1]), a + 3);
      this.gBrush.call(this.brush.move as never, [a, b]);
    } else this.gBrush.call(this.brush.move as never, null);
    this.silent = false;
    this.svg.selectAll<SVGGElement, unknown>('g.life').classed('dim', (_, i, n) => {
      if (!this.range) return false;
      const c = this.cards.find((k) => k.id === (n[i] as SVGGElement).dataset.id);
      if (!c) return false;
      const [a, b] = span(c);
      return b < this.range[0] || a > this.range[1];
    });
  }

  setFocus(id?: string): void {
    this.svg.selectAll<SVGGElement, unknown>('g.life').classed('on', (_, i, n) => (n[i] as SVGGElement).dataset.id === id);
  }

  /** Scroll the container so a year is in view (mobile). */
  reveal(year: number): void {
    const px = this.x(year) - this.host.clientWidth / 2;
    this.host.scrollTo?.({ left: Math.max(0, px), behavior: 'smooth' });
  }

  destroy(): void {
    this.ro.disconnect();
    this.svg.remove();
  }
}

export interface LifeIn {
  id: string;
  title: string;
  x0: number;
  x1: number;
}

export interface LifeOut extends LifeIn {
  row: number;
  /** Where the name goes: inside the bar, after it, before it, or nowhere. */
  label: 'in' | 'out' | 'before' | 'none';
  /** The stretch of the row the bar and its name take. */
  span: [number, number];
}

/**
 * Rows for the lives: each takes the first row where its bar and its whole
 * name fit, the name inside the bar, else after it, else before it. Names are
 * never cut and never run into another bar or name. A life that fits nowhere
 * within `maxRows` keeps its bar without a name if a row has room for that,
 * and otherwise is returned in `overflow`.
 */
export function layoutLives(lives: LifeIn[], o: { measure: (s: string) => number; maxRows: number; left: number; right: number; gap?: number }): { placed: LifeOut[]; overflow: string[]; rows: number } {
  const gap = o.gap ?? 8;
  const rows: [number, number][][] = [];
  const free = (r: number, a: number, b: number) => !(rows[r] ?? []).some(([p, q]) => a < q + gap && b > p - gap);
  const placed: LifeOut[] = [];
  const overflow: string[] = [];
  for (const l of [...lives].sort((a, b) => a.x0 - b.x0)) {
    const lw = o.measure(l.title) + 12;
    const options: { label: LifeOut['label']; span: [number, number] }[] = [];
    if (l.x1 - l.x0 >= lw) options.push({ label: 'in', span: [l.x0, l.x1] });
    if (l.x1 + 5 + lw <= o.right) options.push({ label: 'out', span: [l.x0, l.x1 + 5 + lw] });
    if (l.x0 - 5 - lw >= o.left) options.push({ label: 'before', span: [l.x0 - 5 - lw, l.x1] });
    let done: LifeOut | undefined;
    for (let r = 0; r < o.maxRows && !done; r++) {
      const opt = options.find((x) => free(r, x.span[0], x.span[1]));
      if (opt) done = { ...l, row: r, label: opt.label, span: opt.span };
    }
    // No row has room for the name: the bar alone, where it fits.
    for (let r = 0; r < Math.min(o.maxRows, rows.length) && !done; r++) {
      if (free(r, l.x0, l.x1)) done = { ...l, row: r, label: 'none', span: [l.x0, l.x1] };
    }
    if (!done) {
      overflow.push(l.id);
      continue;
    }
    (rows[done.row] ??= []).push(done.span);
    placed.push(done);
  }
  return { placed, overflow, rows: rows.length };
}

/** Cut a drawn label to its room with an ellipsis; the full name stays in the title. */
export function fitText(el: SVGTextElement, full: string, room: number): void {
  if (!el.getComputedTextLength || el.getComputedTextLength() <= room) return;
  if (room < 24) {
    el.textContent = '';
    return;
  }
  let n = full.length;
  while (n > 1 && el.getComputedTextLength() > room) el.textContent = full.slice(0, --n).trimEnd() + '…';
}

let ctx2d: CanvasRenderingContext2D | null | undefined;
/** Measure a label as it will be drawn, so labels never run into each other. */
export function textWidth(text: string, size: number): number {
  if (ctx2d === undefined) ctx2d = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  if (!ctx2d) return text.length * size * 0.58;
  ctx2d.font = `${size}px Inter, system-ui, sans-serif`;
  return ctx2d.measureText(text).width;
}
