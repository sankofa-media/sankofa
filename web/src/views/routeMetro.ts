// The route overview: every route from an artist to the museum's cards as a
// metro map, shared stations drawn once. Horizontal on wide screens (one
// column per step back), vertical on phones (one row per station). The
// current route is lit; picking a station selects a route through it.
import { h } from '../lib/dom';
import { pick } from '../lib/i18n';
import { coreRoutes, forksOf, layoutRoutes, segShape, subset, type Overview, type Pt, type RouteSet, type Thread } from '../lib/routes';

const NS = 'http://www.w3.org/2000/svg';

export interface MetroOpts {
  rs: RouteSet;
  current: number;
  name: (ref: string) => string;
  threads: Thread[];
  colors: Map<string, string>;
  /** a station was picked */
  onPick: (ref: string) => void;
  /** phones: one station per row */
  vertical: boolean;
}

export function metro(o: MetroOpts): HTMLElement {
  const { vertical } = o;
  const full = o.rs;
  // The artist's chains and the current route; other genre branches show as stubs.
  const rs = subset(full, coreRoutes(full, o.current));
  const at = vertical ? (r: string) => rs.nodes.indexOf(r) : (r: string) => rs.depth.get(r) ?? 0;
  const ov: Overview = layoutRoutes(rs, at);
  const route = full.routes[o.current] ?? [];
  const drawnEdge = new Set(rs.edges.map((e) => `${e.from}>${e.to}`));
  const hidden = new Map(forksOf(full, o.current).map((f) => [route[f.at], f.options.filter((x) => !drawnEdge.has(`${route[f.at]}>${x.next}`)).length]));
  const onRoute = new Set(route);
  const terminals = new Set(rs.routes.map((r) => r[r.length - 1]));
  // Geometry.
  const COL = vertical ? 40 : Math.max(108, Math.min(150, 1000 / ov.span));
  const LANE = vertical ? 18 : 58;
  const padA = vertical ? 22 : COL / 2;
  const padL = vertical ? 14 : 22;
  const labelX = padL + (ov.lanes - 1) * LANE + 22;
  const xy = ([a, l]: Pt): Pt => (vertical ? [padL + l * LANE, padA + a * COL] : [padA + a * COL, padL + l * LANE]);
  const W = vertical ? Math.max(labelX + 170, Math.min(window.innerWidth - 32, 640)) : padA * 2 + (ov.span - 1) * COL;
  const H = vertical ? padA * 2 + (ov.span - 1) * COL : padL + (ov.lanes - 1) * LANE + 48;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'rt-metro-lines');
  svg.setAttribute('width', String(W));
  svg.setAttribute('height', String(H));
  svg.setAttribute('aria-hidden', 'true');
  const pathOf = (pieces: Pt[][], shift: Pt = [0, 0]) =>
    pieces
      .map((p, i) => {
        const q = p.map((pt) => xy(pt)).map(([x, y]) => [x + shift[0], y + shift[1]]);
        const head = i === 0 ? `M${q[0][0]},${q[0][1]}` : '';
        return q.length === 2 ? `${head}L${q[1][0]},${q[1][1]}` : `${head}C${q[1][0]},${q[1][1]} ${q[2][0]},${q[2][1]} ${q[3][0]},${q[3][1]}`;
      })
      .join('');
  const add = (d: string, cls: string, color?: string) => {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('class', cls);
    if (color) p.style.stroke = color;
    svg.append(p);
  };
  const stepOf = new Map(route.slice(0, -1).map((r, i) => [`${r}>${route[i + 1]}`, i]));
  for (const s of ov.segs) if (!stepOf.has(`${s.from}>${s.to}`)) add(pathOf(segShape(s, ov.spots)), 'rt-ml');
  for (const s of ov.segs) {
    const i = stepOf.get(`${s.from}>${s.to}`);
    if (i === undefined) continue;
    const shape = segShape(s, ov.spots);
    add(pathOf(shape), 'rt-ml on');
    // Threads of the elements carried along this step run beside the line.
    o.threads
      .filter((t) => t.from <= i && i <= t.to)
      .forEach((t) => {
        const k = o.threads.indexOf(t);
        const off = -(6 + k * 4);
        add(pathOf(shape, vertical ? [off, 0] : [0, off]), 'rt-mthread', o.colors.get(t.element));
      });
  }
  // Stations: a dot in the drawing, a button with the name over it.
  const box = h('div.rt-metro-box', { style: `width:${W}px;height:${H}px` }, svg);
  const buttons: HTMLButtonElement[] = [];
  for (const ref of rs.nodes) {
    const sp = ov.spots.get(ref);
    if (!sp) continue;
    const [x, y] = xy([sp.at, sp.lane]);
    const card = ref.startsWith('card:');
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', String(x));
    dot.setAttribute('cy', String(y));
    dot.setAttribute('r', card ? '7' : '5.5');
    dot.setAttribute('class', `rt-mdot${card ? ' card' : ''}${onRoute.has(ref) ? ' on' : ''}${terminals.has(ref) ? ' end' : ''}`);
    svg.append(dot);
    const more = hidden.get(ref) ?? 0;
    if (more) {
      // Branches not drawn: a short stub and how many.
      const stub = document.createElementNS(NS, 'path');
      stub.setAttribute('d', vertical ? `M${x},${y} q 10,4 14,16` : `M${x},${y} q 4,-10 16,-14`);
      stub.setAttribute('class', 'rt-mstub');
      const n = document.createElementNS(NS, 'text');
      n.setAttribute('x', String(vertical ? x + 12 : x + 19));
      n.setAttribute('y', String(vertical ? y + 28 : y - 14));
      n.setAttribute('class', 'rt-mmore');
      n.textContent = `+${more}`;
      svg.append(stub, n);
    }
    for (const t of o.threads) {
      if (t.origin === undefined || route[t.origin] !== ref) continue;
      const ring = document.createElementNS(NS, 'circle');
      ring.setAttribute('cx', String(x));
      ring.setAttribute('cy', String(y));
      ring.setAttribute('r', String(11 + o.threads.indexOf(t) * 3));
      ring.setAttribute('class', 'rt-morigin');
      ring.style.stroke = o.colors.get(t.element) ?? '';
      svg.append(ring);
    }
    const name = o.name(ref);
    const here = onRoute.has(ref);
    const extra = more ? pick({ en: `; ${more} more ${more === 1 ? 'branch' : 'branches'} here, offered in the route below`, ru: `; ещё веток отсюда: ${more}, их можно выбрать в маршруте ниже` }) : '';
    const label = (here
      ? pick({ en: `${name}: on this route`, ru: `${name}: на этом маршруте` })
      : terminals.has(ref)
        ? pick({ en: `${name}: take the route that ends here`, ru: `${name}: выбрать маршрут, который здесь заканчивается` })
        : pick({ en: `${name}: take a route through here`, ru: `${name}: выбрать маршрут через эту станцию` })) + extra;
    const b = h(
      `button.rt-mstop${card ? '.card' : ''}${here ? '.on' : ''}${terminals.has(ref) ? '.end' : ''}`,
      {
        type: 'button',
        'data-ref': ref,
        'aria-label': label,
        'aria-current': here ? 'step' : undefined,
        style: vertical ? `left:${x - 10}px;top:${y - COL / 2}px;height:${COL}px;width:${W - x + 10}px;--lx:${labelX - x + 10}px` : `left:${x - COL / 2}px;top:${y - 10}px;width:${COL}px`,
        onclick: () => o.onPick(ref),
      },
      h('span.rt-mname', {}, name),
    ) as HTMLButtonElement;
    buttons.push(b);
    box.append(b);
  }
  // Arrow keys walk along the current route; Tab goes through every station.
  box.addEventListener('keydown', (e) => {
    const fwd = vertical ? 'ArrowDown' : 'ArrowRight';
    const back = vertical ? 'ArrowUp' : 'ArrowLeft';
    if (e.key !== fwd && e.key !== back) return;
    const ref = (document.activeElement as HTMLElement | null)?.dataset?.ref;
    const i = ref ? route.indexOf(ref) : -1;
    const to = route[i < 0 ? 0 : i + (e.key === fwd ? 1 : -1)];
    const b = buttons.find((x) => x.dataset.ref === to);
    if (b) {
      e.preventDefault();
      b.focus();
    }
  });
  return h(
    `div.rt-metro${vertical ? '.vertical' : ''}`,
    { role: 'group', 'aria-label': pick({ en: 'All routes to the museum', ru: 'Все маршруты к музею' }) },
    box,
  );
}
