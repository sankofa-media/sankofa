// Drawings in code for the scenes that have no generated illustration yet:
// ink and pencil on the warm paper of the generated pictures (#f3ead8), one
// muted red, no text. Each is a stand-in until the editor's art arrives (see
// sankofa-features/sea-lion-woman/ART-BRIEF-2.md); a scene's `art:` layers,
// when it has them, take its place. The people in the story are drawn as
// dignified silhouettes in one warm dark skin tone, with no faces invented.
import { h } from '../../lib/dom';
import { blot, drawing, hatch, ink, loop, rng, s, sketch } from '../engine/ink';

const W = 600;
const H = 400;
type P = [number, number];

/** A drawing on the paper of the generated pictures (decorative: the text says what it shows). */
export function panel(name: string, svg: SVGSVGElement): HTMLElement {
  return h('div.ft-art.ft-drawn', { 'data-art': name, 'data-drawn': '', style: 'aspect-ratio:3 / 2', 'aria-hidden': 'true' }, svg);
}

const canvas = (cls: string, ...children: (SVGElement | null | undefined)[]) => drawing(`0 0 ${W} ${H}`, `art-drawn ${cls}`, ...children);

/** A filled shape that fades in over a stretch of the scene. */
const solid = (d: string, cls: string, from = 0, to = 0.3) => s('g', { 'data-fade': `${from} ${to}` }, s('path', { d, class: cls }));

/** A closed hand-drawn outline. */
const shape = (pts: P[], seed: number, jitter = 1) => `${sketch([...pts, pts[0]], seed, jitter)} Z`;

/** A line of handwriting along a ruled line: arches and loops in words, never letters. */
function scrawl(x0: number, y0: number, x1: number, y1: number, seed: number): string {
  const r = rng(seed);
  const len = Math.hypot(x1 - x0, y1 - y0);
  const ux = (x1 - x0) / len;
  const uy = (y1 - y0) / len;
  let d = '';
  let t = 0;
  while (t < len - 8) {
    const word = Math.min(len - t, 14 + r() * 34);
    const amp = 2.6 + r() * 1.6;
    const tall = Math.floor(r() * 4);
    for (let u = 0; u <= word; u += 1.5) {
      const arch = Math.abs(Math.sin(u / 2.4));
      const up = -amp * arch * (Math.floor(u / 7.5) === tall ? 2.2 : 1);
      const x = x0 + ux * (t + u);
      const y = y0 + uy * (t + u) + up;
      d += `${u === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)} `;
    }
    t += word + 6 + r() * 6;
  }
  return d.trim();
}

/**
 * A young woman's silhouette, from the waist up, facing `dir` (1 right,
 * -1 left): hair, head, neck, shoulders, a dress; the arm is drawn by the
 * caller where the hand goes. `top` is the crown of the head, `k` the scale.
 */
function bust(x: number, top: number, k: number, dir: 1 | -1, seed: number, dress: 'ink' | 'red', from = 0.05): SVGGElement {
  const X = (dx: number) => x + dx * k * dir;
  const Y = (dy: number) => top + dy * k;
  const head = loop(X(0), Y(26), 19 * k, 24 * k, seed, 0.6);
  const hair = loop(X(-3), Y(18), 23 * k, 21 * k, seed + 1, 0.8);
  const neck = shape([[X(-7), Y(44)], [X(7), Y(44)], [X(9), Y(58)], [X(-9), Y(58)]], seed + 2, 0.4);
  const body = shape(
    [
      [X(-12), Y(54)],
      [X(12), Y(54)],
      [X(38), Y(60)],
      [X(52), Y(74)],
      [X(56), Y(120)],
      [X(48), Y(200)],
      [X(60), Y(320)],
      [X(-60), Y(320)],
      [X(-46), Y(200)],
      [X(-54), Y(120)],
      [X(-52), Y(74)],
      [X(-38), Y(60)],
    ],
    seed + 3,
    1,
  );
  return s(
    'g',
    { class: 'dr-person' },
    solid(`${hair} Z`, 'ink-solid', from, from + 0.15),
    solid(`${head} Z`, 'ink-skin', from, from + 0.15),
    solid(neck, 'ink-skin', from, from + 0.15),
    solid(body, dress === 'red' ? 'ink-red' : 'ink-solid', from + 0.05, from + 0.2),
    ink(sketch([[X(-12), Y(56)], [X(0), Y(66)], [X(12), Y(56)]], seed + 4, 0.5), from + 0.1, from + 0.25, { class: 'ink-line dr-paper-line' }),
  );
}

/** An arm from the shoulder to the hand, as a thick stroke of skin. */
const arm = (pts: P[], seed: number, from = 0.15) => {
  const [hx, hy] = pts[pts.length - 1];
  return s('g', { 'data-fade': `${from} ${from + 0.15}` }, s('path', { d: sketch(pts, seed, 0.6), class: 'ink-limb' }), s('ellipse', { cx: hx, cy: hy, rx: 9, ry: 7, class: 'dr-hand' }));
};

/** The words: two girls at a table bend over a sheet of lined paper; its lines are half rubbed out and written again, and a blank paper label waits beside it. */
export function words(): SVGSVGElement {
  // The sheet lies flat on the table, foreshortened: its far edge is shorter than the near one.
  const L: [P, P] = [[236, 236], [196, 392]];
  const R: [P, P] = [[396, 232], [436, 388]];
  const along = ([a, b]: [P, P], t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const lines: SVGElement[] = [];
  for (let i = 0; i < 8; i++) {
    const t = 0.12 + i * 0.11;
    const [x0, y0] = along(L, t);
    const [x1, y1] = along(R, t);
    lines.push(ink(sketch([[x0 + 4, y0], [x1 - 4, y1]], 300 + i, 0.4), 0.05 + i * 0.02, 0.2 + i * 0.02, { class: 'ink-line dr-rule' }));
    if (i > 6) continue;
    const len = 0.5 + ((i * 37) % 40) / 100;
    const ex = x0 + 8 + (x1 - x0 - 16) * len;
    const ey = y0 + (y1 - y0) * len;
    if (i % 2) {
      // Written, rubbed out, and written again just above.
      lines.push(s('g', { class: 'dr-erased', 'data-fade': '0.08 0.25' }, s('path', { d: scrawl(x0 + 8, y0 - 1, ex, ey - 1, 400 + i), class: 'ink-line' }), s('path', { d: `M${x0 + 4} ${y0 - 9} L${ex + 4} ${ey - 9} L${ex + 4} ${ey + 2} L${x0 + 4} ${y0 + 2} Z`, class: 'dr-smudge' })));
      lines.push(ink(scrawl(x0 + 10, y0 - 9, x0 + 10 + (ex - x0) * 0.7, y0 - 9 + (ey - y0) * 0.7, 500 + i), 0.3 + i * 0.03, 0.45 + i * 0.03, { class: 'ink-line dr-write' }));
    } else lines.push(ink(scrawl(x0 + 8, y0 - 1, ex, ey - 1, 400 + i), 0.1 + i * 0.03, 0.28 + i * 0.03, { class: 'ink-line dr-write' }));
  }
  const sheet = shape([L[0], R[0], R[1], L[1]], 299, 0.6);
  // The label: a blank tag on the table, tied with red thread.
  const tag = shape([[470, 318], [536, 306], [546, 340], [482, 354], [462, 338]], 610, 0.6);
  return canvas(
    'art-words',
    s(
      'g',
      { 'data-depth': 3 },
      bust(118, 70, 1.12, 1, 620, 'ink', 0.02),
      bust(492, 62, 1.08, -1, 630, 'ink', 0.06),
    ),
    s(
      'g',
      { 'data-depth': 6 },
      // The table top, from its far edge to the bottom of the picture.
      solid(`M0 222 L${W} 214 L${W} ${H} L0 ${H} Z`, 'dr-table', 0, 0.15),
      ink(sketch([[0, 222], [300, 218], [W, 214]], 289, 1), 0, 0.2),
      hatch(0, 300, W, 100, 10, 290, 0, 0.3),
      solid(sheet, 'dr-sheet', 0.02, 0.15),
      ink(sheet, 0.02, 0.2),
      ...lines,
      solid(tag, 'dr-tag', 0.15, 0.3),
      ink(tag, 0.15, 0.3),
      s('circle', { cx: 473, cy: 334, r: 3.5, class: 'ink-dot' }),
      ink(sketch([[473, 334], [452, 350], [446, 372], [462, 398]], 611, 2), 0.25, 0.5, { class: 'ink-line red dr-thread' }),
    ),
    s(
      'g',
      { 'data-depth': 9 },
      // Her arm reaches down to the sheet, the pencil's point on a line; the other girl's hand rests by the label.
      arm([[160, 150], [196, 236], [262, 300]], 621),
      ink(sketch([[252, 314], [282, 282]], 622, 0.3), 0.25, 0.35, { class: 'ink-line dr-pencil' }),
      blot(282, 282, 2.2),
      arm([[452, 142], [440, 236], [452, 312]], 631, 0.22),
    ),
  );
}

/** July 1964, seen from above: a portable record player open on a table, a blank sleeve, a cup of coffee and a cup of tea. The record itself lies on the platter (the page puts it there). */
export function recordTable(): SVGSVGElement {
  const r = rng(700);
  const grain: SVGElement[] = [];
  for (let i = 0; i < 16; i++) {
    const y = 12 + i * 25 + r() * 8;
    grain.push(ink(sketch([[0, y], [150, y + 4 - r() * 8], [320, y + 3], [460, y - 3], [W, y + 2]], 701 + i, 2), 0, 0.3, { class: 'ink-line dr-grain' }));
  }
  const cup = (cx: number, cy: number, seed: number, dark: boolean) =>
    s(
      'g',
      {},
      ink(loop(cx + 6, cy + 4, 40, 36, seed, 0.6), 0.25, 0.45),
      ink(loop(cx, cy, 26, 26, seed + 1, 0.4), 0.3, 0.5),
      solid(`${loop(cx, cy, 20, 20, seed + 2, 0.4)} Z`, dark ? 'dr-coffee' : 'dr-tea', 0.2, 0.35),
      ink(sketch([[cx + 26, cy - 4], [cx + 38, cy - 6], [cx + 38, cy + 6], [cx + 25, cy + 6]], seed + 3, 0.5), 0.35, 0.5),
    );
  return canvas(
    'art-table',
    s('g', {}, ...grain),
    s(
      'g',
      { 'data-depth': 4 },
      // A paper sleeve, blank, half under the player; its one red band.
      solid(shape([[18, 120], [150, 104], [168, 300], [34, 316]], 710, 0.8), 'dr-sleeve', 0.1, 0.25),
      ink(shape([[18, 120], [150, 104], [168, 300], [34, 316]], 710, 0.8), 0.1, 0.3),
      solid(shape([[26, 270], [162, 254], [164, 268], [28, 284]], 711, 0.6), 'ink-red', 0.3, 0.45),
      cup(522, 108, 720, true),
      cup(536, 300, 730, false),
    ),
    s(
      'g',
      { 'data-depth': 8 },
      // The case, its lid hinged open at the top, the platter (the record lies on it), the arm parked at the right.
      solid(shape([[134, 30], [466, 30], [466, 372], [134, 372]], 740, 0.6), 'dr-case', 0.05, 0.2),
      ink(shape([[134, 30], [466, 30], [466, 372], [134, 372]], 740, 0.6), 0.05, 0.25),
      ink(sketch([[140, 22], [460, 22]], 741, 0.6), 0.1, 0.3),
      hatch(136, 32, 328, 338, 11, 742, 0.15, 0.4),
      ink(loop(300, 200, 156, 156, 743, 0.6), 0.15, 0.35),
      ink(loop(436, 64, 14, 14, 744, 0.4), 0.3, 0.45),
      ink(sketch([[436, 64], [452, 150], [448, 270], [430, 316]], 745, 0.8), 0.35, 0.55, { class: 'ink-line dr-arm' }),
      ink(sketch([[422, 312], [440, 324]], 746, 0.4), 0.45, 0.6, { class: 'ink-line dr-arm' }),
      ink(loop(176, 340, 9, 9, 747, 0.4), 0.4, 0.55),
      ink(loop(206, 340, 9, 9, 748, 0.4), 0.42, 0.57),
    ),
  );
}

/** The silence: an empty schoolyard at dusk, a chalk circle on the ground, a red ribbon left on it. */
export function silence(): SVGSVGElement {
  const r = rng(800);
  const sky: SVGElement[] = [];
  // Dusk: pencil shading that thickens towards the top.
  for (let band = 0; band < 4; band++) sky.push(hatch(0, band * 40, W, 44, 4 + band * 3, 801 + band, 0, 0.3 + band * 0.05));
  const fence: SVGElement[] = [];
  for (let x = 20; x < W; x += 34) fence.push(ink(sketch([[x, 196 - r() * 4], [x + r() * 2, 236]], 820 + x, 0.6), 0.1, 0.35, { class: 'ink-line dr-fence' }));
  return canvas(
    'art-silence',
    s('g', { 'data-depth': 2 }, ...sky, s('circle', { cx: 262, cy: 150, r: 22, class: 'dr-sun' })),
    s(
      'g',
      { 'data-depth': 5 },
      ...fence,
      ink(sketch([[0, 204], [W, 200]], 840, 0.8), 0.1, 0.3, { class: 'ink-line dr-fence' }),
      ink(sketch([[0, 222], [W, 218]], 841, 0.8), 0.1, 0.3, { class: 'ink-line dr-fence' }),
      // A bare tree behind the fence, and a swing frame with its seat hanging still.
      ink(sketch([[96, 236], [100, 150], [92, 110], [84, 70]], 842, 1.4), 0.15, 0.4),
      ink(sketch([[100, 150], [134, 112], [150, 90]], 843, 1.2), 0.2, 0.45),
      ink(sketch([[96, 126], [66, 100], [52, 84]], 844, 1.2), 0.2, 0.45),
      ink(sketch([[388, 248], [414, 132], [440, 248]], 845, 0.8), 0.2, 0.45),
      ink(sketch([[414, 132], [530, 132]], 846, 0.6), 0.25, 0.5),
      ink(sketch([[506, 248], [530, 132], [556, 248]], 847, 0.8), 0.25, 0.5),
      ink(sketch([[462, 132], [462, 214]], 848, 0.3), 0.35, 0.55),
      ink(sketch([[488, 132], [488, 214]], 849, 0.3), 0.35, 0.55),
      ink(sketch([[456, 215], [494, 215]], 850, 0.4), 0.4, 0.6),
    ),
    s(
      'g',
      { 'data-depth': 9 },
      solid(`M0 ${236} L${W} 232 L${W} ${H} L0 ${H} Z`, 'dr-ground', 0, 0.2),
      hatch(0, 300, W, 100, 8, 860, 0.05, 0.3),
      // The chalk circle the children played in, and nobody in it.
      ink(loop(286, 312, 176, 52, 861, 2.2), 0.3, 0.75, { class: 'ink-line dr-chalk' }),
      ink(loop(290, 314, 170, 49, 862, 2.6), 0.4, 0.85, { class: 'ink-line dr-chalk faint' }),
      ink(sketch([[392, 340], [402, 334], [410, 344], [420, 336]], 863, 0.6), 0.6, 0.8, { class: 'ink-line red dr-ribbon' }),
    ),
  );
}

/** On screen: a projector's beam across a dark room, onto a lit screen; rows of empty seats. */
export function projector(): SVGSVGElement {
  const r = rng(900);
  const dust: SVGElement[] = [];
  for (let i = 0; i < 26; i++) {
    const t = r();
    const x = 108 + t * 440;
    const spread = 14 + t * 120;
    dust.push(s('circle', { cx: x.toFixed(1), cy: (150 - 6 * t + (r() - 0.5) * spread).toFixed(1), r: (0.6 + r() * 1.2).toFixed(2), class: 'dr-dust' }));
  }
  const seats: SVGElement[] = [];
  for (let row = 0; row < 2; row++)
    for (let i = 0; i < 9; i++) {
      const x = 150 + i * 50 + row * 24;
      const y = 340 + row * 34;
      seats.push(solid(`${sketch([[x - 20, y + 40], [x - 20, y + 6], [x - 14, y], [x + 14, y], [x + 20, y + 6], [x + 20, y + 40]], 940 + row * 20 + i, 0.6)} Z`, 'dr-seat', 0.1, 0.3));
    }
  return canvas(
    'art-projector',
    solid(`M0 0 H${W} V${H} H0 Z`, 'dr-night', 0, 0.12),
    s('g', { 'data-depth': 3 }, solid(shape([[520, 50], [592, 44], [594, 270], [520, 260]], 901, 0.6), 'dr-screen', 0.2, 0.4)),
    // The beam widens from the lens to the screen.
    s('g', { 'data-depth': 5, 'data-fade': '0.25 0.5' }, s('path', { d: 'M112 146 L520 52 L520 258 L112 160 Z', class: 'dr-beam' }), ...dust),
    s(
      'g',
      { 'data-depth': 8 },
      solid(shape([[40, 132], [112, 128], [114, 178], [42, 182]], 910, 0.6), 'dr-machine', 0.05, 0.2),
      solid(`${loop(54, 100, 26, 26, 911, 0.4)} Z`, 'dr-machine', 0.08, 0.22),
      solid(`${loop(100, 100, 22, 22, 912, 0.4)} Z`, 'dr-machine', 0.1, 0.24),
      ink(loop(54, 100, 8, 8, 913, 0.3), 0.15, 0.3, { class: 'ink-line dr-light-line' }),
      ink(loop(100, 100, 7, 7, 914, 0.3), 0.15, 0.3, { class: 'ink-line dr-light-line' }),
      ink(sketch([[60, 182], [48, 260]], 915, 0.6), 0.1, 0.25, { class: 'ink-line dr-light-line' }),
      ink(sketch([[96, 182], [108, 260]], 916, 0.6), 0.1, 0.25, { class: 'ink-line dr-light-line' }),
      s('circle', { cx: 60, cy: 168, r: 3, class: 'dr-pilot' }),
    ),
    s('g', { 'data-depth': 12 }, ...seats),
  );
}

/** Burial: a London street at night in the rain, one window lit. */
export function nightStreet(): SVGSVGElement {
  const r = rng(1000);
  const roof: P[] = [[0, 120]];
  // Terraced houses with their chimney stacks.
  for (let x = 0; x <= W; x += 75) roof.push([x + 8, 120], [x + 8, 96], [x + 26, 96], [x + 26, 120], [x + 75, 120]);
  roof.push([W, 120], [W, 300], [0, 300]);
  const windows: SVGElement[] = [];
  for (let col = 0; col < 8; col++)
    for (let row = 0; row < 2; row++) {
      const x = 26 + col * 75;
      const y = 150 + row * 70;
      const lit = col === 5 && row === 0;
      windows.push(solid(shape([[x, y], [x + 30, y], [x + 30, y + 42], [x, y + 42]], 1010 + col * 3 + row, 0.4), lit ? 'dr-lit' : 'dr-window', 0.1 + col * 0.02, 0.3 + col * 0.02));
      if (lit) windows.push(solid(shape([[x + 2, y + 2], [x + 11, y + 2], [x + 9, y + 40], [x + 2, y + 40]], 1050, 0.3), 'ink-red dr-curtain', 0.3, 0.5));
    }
  const rain: SVGElement[] = [];
  for (let i = 0; i < 90; i++) {
    const x = r() * (W + 60) - 30;
    const y = r() * H;
    const l = 10 + r() * 16;
    rain.push(s('path', { d: `M${x.toFixed(1)} ${y.toFixed(1)} l${(-l * 0.25).toFixed(1)} ${l.toFixed(1)}`, class: 'dr-rain' }));
  }
  return canvas(
    'art-night',
    solid(`M0 0 H${W} V${H} H0 Z`, 'dr-night', 0, 0.12),
    s('g', { 'data-depth': 3 }, solid(`${sketch(roof, 1001, 0.6)} Z`, 'dr-house', 0.05, 0.25), ...windows),
    s(
      'g',
      { 'data-depth': 6 },
      solid(`M0 300 H${W} V${H} H0 Z`, 'dr-road', 0.05, 0.25),
      // The lit window and the lamp shiver on the wet road.
      ...[0, 1, 2, 3].map((i) => ink(sketch([[401 + i * 5, 312 + i * 6], [399 + i * 5, 380 - i * 4]], 1060 + i, 2), 0.35, 0.6, { class: 'ink-line dr-shine' })),
      ink(sketch([[128, 300], [132, 396]], 1070, 2.4), 0.3, 0.55, { class: 'ink-line dr-shine' }),
      ink(sketch([[120, 300], [122, 120], [138, 104], [156, 104]], 1071, 0.6), 0.15, 0.35, { class: 'ink-line dr-light-line' }),
      s('circle', { cx: 158, cy: 112, r: 22, class: 'dr-halo' }),
      s('circle', { cx: 158, cy: 110, r: 4, class: 'dr-lamp' }),
    ),
    s('g', { 'data-depth': 10, 'data-fade': '0.15 0.4' }, ...rain),
  );
}

/**
 * The sketch a photograph develops out of: a few lines of the scene in ink
 * (a desk, a flute, a guitar, the decks, clapping hands, drum pads, a stage).
 */
export type Motif = 'desk' | 'flute' | 'guitar' | 'decks' | 'hands' | 'pads' | 'stage';

export function sketchOf(motif: Motif, seed = 1): SVGSVGElement {
  const floor = ink(sketch([[30, 330], [300, 326], [570, 332]], seed, 1.6), 0, 0.3);
  const spot = s('g', { 'data-fade': '0 0.3' }, s('path', { d: 'M250 0 L350 0 L470 330 L130 330 Z', class: 'dr-spot' }));
  const parts: SVGElement[] = [];
  const line = (pts: P[], k: number, from = 0.05, to = 0.35, cls = 'ink-line') => parts.push(ink(sketch(pts, seed + k, 0.8), from, to, { class: cls }));
  const ring = (cx: number, cy: number, rx: number, ry: number, k: number, from = 0.1, to = 0.35) => parts.push(ink(loop(cx, cy, rx, ry, seed + k, 0.6), from, to));
  switch (motif) {
    case 'desk': {
      // A writing desk: a typewriter, a stack of pages, a letter.
      line([[90, 260], [510, 260]], 1);
      line([[110, 260], [110, 330]], 2);
      line([[490, 260], [490, 330]], 3);
      parts.push(ink(shape([[220, 180], [380, 180], [400, 250], [200, 250]], seed + 4, 0.8), 0.1, 0.35));
      line([[236, 180], [250, 140], [350, 140], [364, 180]], 5);
      for (let i = 0; i < 4; i++) line([[218 + i * 2, 206 + i * 12], [382 - i * 2, 206 + i * 12]], 6 + i, 0.2, 0.4, 'ink-line dr-faint');
      parts.push(ink(shape([[410, 236], [480, 230], [484, 256], [414, 260]], seed + 11, 0.6), 0.25, 0.45));
      break;
    }
    case 'flute':
      line([[150, 210], [460, 150]], 1, 0.05, 0.4);
      line([[150, 218], [460, 158]], 2, 0.05, 0.4);
      for (let i = 0; i < 6; i++) ring(220 + i * 36, 197 - i * 7, 4, 4, 3 + i, 0.25, 0.45);
      ring(420, 250, 34, 34, 10, 0.3, 0.5);
      ring(420, 250, 26, 26, 11, 0.35, 0.55);
      break;
    case 'guitar':
      ring(260, 250, 62, 56, 1);
      ring(310, 196, 44, 40, 2);
      ring(272, 240, 14, 14, 3, 0.2, 0.4);
      line([[296, 214], [430, 90]], 4);
      line([[304, 222], [438, 98]], 5);
      parts.push(ink(shape([[400, 230], [520, 230], [520, 330], [400, 330]], seed + 6, 0.8), 0.2, 0.45));
      ring(460, 280, 30, 30, 7, 0.3, 0.5);
      break;
    case 'decks':
      parts.push(ink(shape([[80, 220], [520, 220], [520, 300], [80, 300]], seed + 1, 0.8), 0.05, 0.3));
      ring(190, 258, 70, 22, 2);
      ring(410, 258, 70, 22, 3);
      ring(190, 258, 8, 3, 4, 0.2, 0.4);
      ring(410, 258, 8, 3, 5, 0.2, 0.4);
      for (let i = 0; i < 3; i++) line([[292 + i * 8, 236], [292 + i * 8, 284]], 6 + i, 0.25, 0.45);
      break;
    case 'hands':
      for (let i = 0; i < 5; i++) {
        const x = 110 + i * 95;
        const y = 220 - (i % 2) * 24;
        line([[x - 18, y + 60], [x - 6, y + 10], [x, y - 20]], 1 + i * 3, 0.1 + i * 0.05, 0.35 + i * 0.05);
        line([[x + 18, y + 60], [x + 6, y + 10], [x, y - 20]], 2 + i * 3, 0.1 + i * 0.05, 0.35 + i * 0.05);
      }
      break;
    case 'pads':
      parts.push(ink(shape([[130, 150], [470, 150], [470, 320], [130, 320]], seed + 1, 0.8), 0.05, 0.3));
      for (let row = 0; row < 2; row++) for (let i = 0; i < 8; i++) parts.push(ink(shape([[148 + i * 40, 250 + row * 34], [176 + i * 40, 250 + row * 34], [176 + i * 40, 274 + row * 34], [148 + i * 40, 274 + row * 34]], seed + 10 + row * 8 + i, 0.4), 0.15 + i * 0.02, 0.35 + i * 0.02));
      for (let i = 0; i < 6; i++) ring(170 + i * 52, 192, 10, 10, 40 + i, 0.25, 0.45);
      break;
    case 'stage':
      line([[300, 330], [300, 170]], 1);
      ring(300, 158, 10, 14, 2);
      line([[270, 330], [300, 300], [330, 330]], 3);
      for (let i = 0; i < 4; i++) parts.push(ink(loop(120 + i * 120, 40, 18, 12, seed + 10 + i, 0.4), 0.2, 0.4));
      break;
  }
  return canvas('art-sketch', spot, floor, s('g', { 'data-depth': 6 }, ...parts), blot(560, 360, 4, 'red'));
}
