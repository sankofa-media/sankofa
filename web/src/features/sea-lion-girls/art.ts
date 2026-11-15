// Line art for Sea Lion Girls drawn in code: ink and pencil on warm paper,
// one colour besides the ink (red, "dressed in red"). The scenes show their
// generated illustrations (feature.yaml, `art:`); these drawings remain for
// the film strip, the page, the glyphs, and as stand-ins for a scene whose
// layers are not there.
import type { Glyph } from '../lineage';
import { blot, drawing, hatch, ink, loop, s, sketch } from '../engine/ink';

/** A standing figure: head, dress or coat, arms. `clap` raises the hands together. */
export function figure(x: number, y: number, k = 1, seed = 1, opts: { clap?: boolean; red?: boolean; from?: number; to?: number } = {}): SVGGElement {
  const { from = 0, to = 0.4 } = opts;
  const head = 8 * k;
  const g = s('g', { class: `ink-figure ink-breathe${opts.red ? ' red' : ''}`, style: `transform-origin:${x}px ${y + 60 * k}px` });
  g.append(
    ink(loop(x, y, head, head * 1.1, seed, 0.8), from, to),
    ink(sketch([[x, y + head], [x - 13 * k, y + 52 * k], [x + 13 * k, y + 52 * k], [x, y + head]], seed + 1, 1.2), from + 0.05, to + 0.05, { class: 'ink-line ink-fill' }),
    ink(sketch([[x - 4 * k, y + 52 * k], [x - 5 * k, y + 70 * k]], seed + 2), from + 0.1, to + 0.1),
    ink(sketch([[x + 4 * k, y + 52 * k], [x + 5 * k, y + 70 * k]], seed + 3), from + 0.1, to + 0.1),
  );
  if (opts.clap)
    g.append(
      ink(sketch([[x - 6 * k, y + 18 * k], [x - 2 * k, y + 4 * k], [x, y - 6 * k]], seed + 4), from + 0.15, to + 0.15),
      ink(sketch([[x + 6 * k, y + 18 * k], [x + 2 * k, y + 4 * k], [x, y - 6 * k]], seed + 5), from + 0.15, to + 0.15),
    );
  else
    g.append(
      ink(sketch([[x - 6 * k, y + 18 * k], [x - 16 * k, y + 36 * k]], seed + 4), from + 0.15, to + 0.15),
      ink(sketch([[x + 6 * k, y + 18 * k], [x + 16 * k, y + 36 * k]], seed + 5), from + 0.15, to + 0.15),
    );
  return g;
}

const paper = (w: number, h: number) => s('rect', { x: 0, y: 0, width: w, height: h, class: 'ink-paper' });

export function door(): SVGSVGElement {
  const leaf = s(
    'g',
    { class: 'door-leaf' },
    s('rect', { x: 166, y: 131, width: 68, height: 136, class: 'door-wood' }),
    ...[180, 196, 212, 226].map((x, i) => ink(sketch([[x, 134], [x, 265]], 20 + i, 0.8), 0.1, 0.5)),
    s('circle', { cx: 226, cy: 200, r: 3, class: 'ink-dot' }),
  );
  return drawing(
    '0 0 400 310',
    'art-door',
    paper(400, 310),
    s('g', { 'data-depth': 18 }, ink(sketch([[30, 96], [200, 30], [370, 96]], 2, 2), 0, 0.3), ink(sketch([[60, 92], [60, 270]], 3), 0, 0.3), ink(sketch([[340, 92], [340, 270]], 4), 0, 0.3)),
    s('rect', { x: 166, y: 131, width: 68, height: 136, class: 'door-light' }),
    ink(sketch([[165, 268], [165, 130], [235, 130], [235, 268]], 5, 0.8), 0.05, 0.35),
    leaf,
    ink(sketch([[90, 140], [130, 140], [130, 180], [90, 180], [90, 140]], 6), 0.1, 0.4),
    ink(sketch([[270, 140], [310, 140], [310, 180], [270, 180], [270, 140]], 7), 0.1, 0.4),
    hatch(91, 141, 38, 38, 6, 8, 0.2, 0.6),
    hatch(271, 141, 38, 38, 6, 9, 0.2, 0.6),
    ink(sketch([[24, 270], [376, 270]], 10, 1.5), 0, 0.3),
    ink(sketch([[150, 284], [250, 284]], 11), 0.05, 0.35),
    ink(sketch([[138, 298], [262, 298]], 12), 0.05, 0.35),
    blot(120, 292, 5),
    blot(286, 290, 3),
  );
}

export function expedition(place: string): SVGSVGElement {
  const route: [number, number][] = [
    [360, 40],
    [320, 80],
    [300, 110],
    [250, 135],
    [205, 150],
    [150, 168],
  ];
  return drawing(
    '0 0 400 300',
    'art-map',
    paper(400, 300),
    s('g', { 'data-depth': 12 }, ink(sketch([[0, 250], [60, 238], [120, 252], [190, 240], [260, 258], [330, 236], [400, 246]], 40, 3), 0, 0.3), hatch(0, 256, 400, 44, 7, 41, 0.1, 0.4)),
    ink(sketch([[150, 20], [140, 80], [158, 130], [146, 190], [152, 248]], 42, 3), 0.05, 0.4, { class: 'ink-line river' }),
    ink(sketch(route, 43, 2), 0.25, 0.85, { class: 'ink-line red route' }),
    blot(150, 168, 7, 'red'),
    label(162, 190, place, 'ink-label', '0.7 0.9'),
  );
}

/** SVG text with a plain string. */
export function label(x: number, y: number, text: string, cls = 'ink-label', fade?: string): SVGTextElement {
  const t = s('text', { x, y, class: cls, ...(fade ? { 'data-fade': fade } : {}) });
  t.textContent = text;
  return t;
}

export function album(paris: string, washington: string): SVGSVGElement {
  return drawing(
    '0 0 400 300',
    'art-album',
    paper(400, 300),
    s(
      'g',
      { 'data-depth': 10 },
      ink(sketch([[40, 40], [170, 40], [170, 170], [40, 170], [40, 40]], 90), 0, 0.25),
      ink(loop(150, 105, 52, 52, 91, 1), 0.05, 0.3),
      ink(loop(150, 105, 16, 16, 92, 0.6), 0.1, 0.3),
      hatch(41, 41, 128, 128, 8, 93, 0.05, 0.3),
    ),
    ink(sketch([[60, 200], [52, 240], [64, 290]], 94, 3), 0.25, 0.45),
    ink(sketch([[340, 190], [350, 236], [338, 290]], 95, 3), 0.25, 0.45),
    ink(sketch([[66, 236], [140, 200], [220, 190], [300, 206], [344, 232]], 96, 2), 0.45, 0.95, { class: 'ink-line red route' }),
    blot(66, 236, 5),
    blot(344, 232, 5, 'red'),
    label(30, 262, washington, 'ink-label', '0.4 0.55'),
    label(316, 262, paris, 'ink-label', '0.85 1'),
  );
}

export function piano(): SVGSVGElement {
  return drawing(
    '0 0 400 300',
    'art-piano',
    paper(400, 300),
    s('g', { 'data-depth': 16 }, ink(sketch([[150, 150], [370, 150], [380, 120], [300, 96], [170, 110], [150, 150]], 100, 2), 0, 0.35), hatch(152, 112, 220, 36, 6, 101, 0.2, 0.5)),
    ink(sketch([[160, 150], [160, 250]], 102), 0.1, 0.3),
    ink(sketch([[360, 150], [360, 250]], 103), 0.1, 0.3),
    ink(sketch([[150, 162], [300, 162]], 104), 0.15, 0.35),
    figure(110, 120, 1.05, 105, { from: 0.2, to: 0.55 }),
    ink(sketch([[70, 196], [150, 196]], 106), 0.3, 0.5),
  );
}

export function page(): SVGSVGElement {
  const lines = [0, 1, 2, 3, 4, 5, 6].map((i) => ink(sketch([[110, 70 + i * 26], [110 + 180 - (i % 3) * 30, 70 + i * 26]], 110 + i, 0.8), 0.1 + i * 0.08, 0.2 + i * 0.08));
  return drawing('0 0 400 300', 'art-page', paper(400, 300), ink(sketch([[90, 40], [310, 40], [310, 270], [90, 270], [90, 40]], 109), 0, 0.2), ...lines);
}

export function classroom(): SVGSVGElement {
  const kids = s('g', {});
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    kids.append(figure(200 + Math.sin(a) * 110, 150 - Math.cos(a) * 40, 0.6, 130 + i * 7, { clap: true, from: 0.1 + i * 0.03, to: 0.35 + i * 0.03 }));
  }
  return drawing(
    '0 0 400 300',
    'art-class',
    paper(400, 300),
    s('g', { 'data-depth': 10 }, ink(sketch([[70, 30], [330, 30], [330, 90], [70, 90], [70, 30]], 120), 0, 0.2), hatch(71, 31, 258, 58, 9, 121, 0, 0.3)),
    ink(loop(200, 230, 130, 28, 122, 2), 0.05, 0.3),
    kids,
  );
}

/** A small picture for one frame of the film strip. */
export function frame(i: number): SVGSVGElement {
  const k = i * 17 + 3;
  return drawing(
    '0 0 160 100',
    'art-frame',
    paper(160, 100),
    ink(sketch([[0, 70 + (i % 3) * 4], [160, 66 + (i % 2) * 6]], k, 1.5), 0, 0.5),
    figure(40 + (i * 23) % 80, 30, 0.55, k + 1, { red: i === 0, clap: i % 2 === 0, from: 0.2, to: 0.6 }),
    i % 2 ? ink(loop(128, 24, 10, 10, k + 2), 0.3, 0.7) : hatch(100, 10, 50, 30, 6, k + 3, 0.3, 0.7),
  );
}

const GLYPH_PATHS: Record<Glyph, string> = {
  // two palms meeting
  clap: 'M8 20c-2-3-3-8-1-13l2 1-1 6m6 6c2-3 3-8 1-13l-2 1 1 6M12 4v3m-3-2 1 2m5-2-1 2',
  // a refrain coming round again
  refrain: 'M5 12a7 7 0 0 1 12-5l2 2m0-5v5h-5M19 12a7 7 0 0 1-12 5l-2-2m0 5v-5h5',
  // three staff lines and two notes
  arrangement: 'M3 8h18M3 12h18M3 16h18M8 16.5a1.6 1.6 0 1 0 0-.1M8 16V6m8 6.5a1.6 1.6 0 1 0 0-.1M16 12V4',
  // a reel of tape
  tape: 'M7 16a3 3 0 1 0 0-.1M17 16a3 3 0 1 0 0-.1M7 19h10M4 8h16v5H4z',
};

export function glyph(g: Glyph): SVGSVGElement {
  return s('svg', { viewBox: '0 0 24 24', class: `ft-glyph g-${g}`, 'aria-hidden': 'true', focusable: 'false', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, s('path', { d: GLYPH_PATHS[g] }));
}
