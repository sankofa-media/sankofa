// The river: the song's family tree growing down the page in two branches,
// a filter by what each version took, and every medallion a way into the
// docked player. Stops along it are cards for one or a few versions.
import { h } from '../../lib/dom';
import type { Kit } from '../engine/kit';
import { s } from '../engine/ink';
import { CATEGORIES, layoutRiver, type Category, type LineageNode } from '../lineage';
import { glyph } from './art';

export function river(kit: Kit): { el: HTMLElement; grow(p: number): void } {
  const nodes = kit.ctx.data.lineage?.nodes ?? [];
  const lay = layoutRiver(nodes);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const at = new Map(lay.placed.map((p) => [p.id, p]));
  const W = 1000;
  const R = 100;
  const edges = s('svg', { class: 'rv-edges', viewBox: `0 0 ${W} ${lay.rows * R}`, preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' });
  for (const e of lay.edges) {
    const a = at.get(e.from)!;
    const b = at.get(e.to)!;
    const x0 = a.x * W;
    const y0 = a.row * R + R / 2;
    const x1 = b.x * W;
    const y1 = b.row * R + R / 2;
    const my = (y0 + y1) / 2;
    edges.append(s('path', { d: `M${x0} ${y0} C${x0} ${my} ${x1} ${my} ${x1} ${y1}`, class: `rv-edge b-${b.branch}`, 'data-row': b.row, 'vector-effect': 'non-scaling-stroke' }));
  }
  const detail = h('div.rv-detail', { 'aria-live': 'polite' });
  const show = (n: LineageNode) => {
    detail.replaceChildren(card(kit, n));
  };
  const buttons = lay.placed.map((p) => {
    const n = byId.get(p.id)!;
    const name = `${n.title} — ${n.artist}${n.year ? `, ${n.year}` : ''}. ${kit.ui('travelled')}: ${kit.ui(`glyph-${n.glyph}`)}`;
    const b = h(
      'button.rv-node',
      { type: 'button', 'data-node': n.id, 'data-branch': p.branch, 'data-cats': n.categories.join(' '), 'data-playable': n.play ? '' : undefined, style: `--r:${p.row};--x:${p.x.toFixed(4)}`, 'aria-label': name, title: name },
      h('span.rv-med', { 'aria-hidden': 'true' }, glyph(n.glyph)),
      h('span.rv-year', { 'aria-hidden': 'true' }, n.year ? String(n.year) : '—'),
      h('span.rv-name', { 'aria-hidden': 'true' }, n.artist.split(/[;(]/)[0].trim()),
    );
    b.addEventListener('click', () => {
      buttons.forEach((x) => x.classList.toggle('on', x === b));
      show(n);
      kit.play(n);
    });
    return b;
  });
  const field = h('div.rv-field', { style: `--rows:${lay.rows}` }, edges, ...buttons);
  const filters: Category[] = [...CATEGORIES];
  const fbtn = (c: Category | 'all') =>
    h('button.btn.rv-filter', { type: 'button', 'data-filter': c, 'aria-pressed': String(c === 'all'), onclick: () => filter(c) }, kit.ui(`filter-${c}`));
  const bar = h('div.rv-filters', { role: 'group', 'aria-label': kit.ui('filter') }, fbtn('all'), ...filters.map(fbtn));
  const filter = (c: Category | 'all') => {
    bar.querySelectorAll<HTMLElement>('.rv-filter').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === c)));
    for (const b of buttons) b.classList.toggle('dim', c !== 'all' && !(b.dataset.cats ?? '').split(' ').includes(c));
    field.dataset.filter = c;
  };
  const legend = h(
    'ul.rv-legend',
    {},
    ...(['clap', 'refrain', 'arrangement', 'tape'] as const).map((g) => h('li', {}, glyph(g), kit.ui(`glyph-${g}`))),
  );
  const heads = h('div.rv-heads', { 'aria-hidden': 'true' }, h('span.b-girls', {}, kit.ui('branch-girls')), h('span.b-simone', {}, kit.ui('branch-simone')));
  const el = h('div.rv', {}, bar, legend, heads, field, detail);
  const grow = (p: number) => {
    const upto = kit.calm ? lay.rows : Math.ceil(p * 1.25 * lay.rows);
    for (const b of buttons) b.classList.toggle('grown', Number(b.style.getPropertyValue('--r')) < upto);
    edges.querySelectorAll<SVGPathElement>('.rv-edge').forEach((e) => e.classList.toggle('grown', Number(e.dataset.row) < upto));
  };
  grow(0);
  return { el, grow };
}

/** A version's card: medallion, names, what travelled, the way to hear it, its sources. */
export function card(kit: Kit, n: LineageNode): HTMLElement {
  return h(
    'div.rv-card',
    { 'data-node': n.id },
    h('span.rv-med.big', { 'aria-hidden': 'true' }, glyph(n.glyph), h('b', {}, n.year ? String(n.year) : '—')),
    h(
      'div.rv-card-tx',
      {},
      h('p.rv-title', {}, n.title),
      h('p.rv-artist', {}, n.artist),
      h('p.rv-trav', {}, `${kit.ui('travelled')}: ${kit.ui(`glyph-${n.glyph}`)}`),
      kit.playButton(n),
      kit.credit(n),
      n.sources.length
        ? h(
            'details.rv-src',
            {},
            h('summary', {}, `${kit.ui('sources')} · ${n.sources.length}`),
            h('ul', {}, ...n.sources.map((x) => h('li', {}, h('a', { href: x.url, target: '_blank', rel: 'noopener noreferrer' }, x.title)))),
          )
        : null,
    ),
  );
}

/** Stop cards for a scene's nodes. */
export function stop(kit: Kit, ids: string[]): HTMLElement {
  return h('div.rv-stop', {}, ...ids.map((id) => kit.node(id)).filter((n): n is LineageNode => !!n).map((n) => card(kit, n)));
}

/** The year of a screen use, from the lineage's sync list. */
export function syncYear(kit: Kit, work: string): number | undefined {
  return kit.ctx.data.lineage?.sync.find((x) => x.work === work)?.year;
}

