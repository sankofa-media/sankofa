// Placeholder art for Forever Changes, drawn in code: ink on dark paper
// with the poster colours of the Strip creeping in as the page decays. The
// generated illustrations will replace these scene by scene (a scene's
// `art:` layers win over its placeholder). The visions are shared with the
// Arthur Lee mode: the same red telephone rings on the page and in the room.
import { blot, drawing, hatch, ink, loop, s, sketch } from '../engine/ink';

type P = [number, number];

const paper = (w: number, h: number) => s('rect', { x: 0, y: 0, width: w, height: h, class: 'ink-paper' });
const line = (pts: P[], seed: number, from = 0, to = 0.4, cls = 'ink-line') => ink(sketch(pts, seed, 1), from, to, { class: cls });
const ring = (cx: number, cy: number, r: number, seed: number, from = 0, to = 0.4, cls = 'ink-line') => ink(loop(cx, cy, r, r, seed, 0.8), from, to, { class: cls });

/** Every vision the mode and the pages can draw, by id (viewBox 0 0 200 200). */
const VISIONS: Record<string, () => SVGElement[]> = {
  telephone: () => [
    line([[40, 120], [60, 92], [140, 92], [160, 120], [150, 160], [50, 160], [40, 120]], 1, 0, 0.5, 'ink-line red'),
    line([[30, 84], [50, 60], [150, 60], [170, 84], [150, 92], [50, 92], [30, 84]], 2, 0.1, 0.6, 'ink-line red'),
    ring(100, 126, 16, 3, 0.2, 0.6, 'ink-line red'),
    s('g', { class: 'v-rings' }, line([[20, 50], [8, 36]], 4), line([[180, 50], [192, 36]], 5), line([[26, 34], [18, 18]], 6), line([[174, 34], [182, 18]], 7)),
  ],
  newspaper: () => [
    line([[30, 40], [170, 40], [170, 170], [30, 170], [30, 40]], 11),
    line([[44, 58], [156, 58]], 12, 0.1, 0.5),
    ...[80, 96, 112, 128, 144].flatMap((y, i) => [line([[44, y], [94, y]], 13 + i, 0.2, 0.6), line([[106, y], [156, y]], 20 + i, 0.25, 0.65)]),
    hatch(44, 64, 50, 10, 4, 9, 0.1, 0.5),
  ],
  'old-man': () => [
    ring(100, 52, 18, 31),
    line([[100, 70], [92, 120], [80, 172]], 32),
    line([[100, 70], [110, 120], [118, 172]], 33),
    line([[96, 86], [70, 120], [66, 150]], 34),
    line([[66, 150], [64, 182]], 35, 0.2, 0.6),
    line([[86, 60], [100, 74], [114, 60]], 36, 0.3, 0.6),
  ],
  trumpet: () => [line([[30, 104], [130, 98], [170, 70], [172, 140], [130, 110], [30, 112], [30, 104]], 41), ...[70, 86, 102].map((x, i) => line([[x, 98], [x, 82]], 42 + i, 0.2, 0.6)), ring(64, 120, 10, 45, 0.3, 0.6)],
  helmet: () => [line([[40, 120], [52, 70], [100, 50], [148, 70], [160, 120], [40, 120]], 51), line([[30, 126], [170, 126]], 52, 0.1, 0.5), hatch(52, 74, 96, 44, 7, 53, 0.3, 0.7)],
  rose: () => [ring(100, 70, 22, 61, 0, 0.4, 'ink-line red'), ring(100, 70, 11, 62, 0.1, 0.5, 'ink-line red'), line([[100, 92], [96, 140], [102, 182]], 63, 0.2, 0.6), line([[98, 130], [74, 116]], 64, 0.3, 0.6)],
  jukebox: () => [line([[50, 180], [50, 70], [100, 30], [150, 70], [150, 180], [50, 180]], 71), ring(100, 82, 26, 72, 0.1, 0.5, 'ink-line red'), ...[120, 136, 152].map((y, i) => line([[64, y], [136, y]], 73 + i, 0.2, 0.6))],
  crystal: () => [line([[100, 20], [140, 80], [100, 180], [60, 80], [100, 20]], 81), line([[60, 80], [140, 80]], 82, 0.2, 0.5), line([[100, 20], [100, 180]], 83, 0.3, 0.6)],
  'ice-cream': () => [ring(100, 66, 30, 91, 0, 0.4, 'ink-line red'), line([[72, 80], [100, 176], [128, 80]], 92, 0.1, 0.5), hatch(78, 86, 44, 50, 6, 93, 0.3, 0.7)],
  sun: () => [ring(100, 100, 34, 101, 0, 0.4, 'ink-line red'), ...Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2;
    return line([[100 + Math.cos(a) * 46, 100 + Math.sin(a) * 46], [100 + Math.cos(a) * 70, 100 + Math.sin(a) * 70]], 102 + i, 0.2, 0.6);
  })],
  curtain: () => [line([[20, 20], [180, 20]], 121), line([[24, 22], [40, 100], [30, 180]], 122), line([[176, 22], [160, 100], [170, 180]], 123), hatch(26, 24, 30, 150, 6, 124, 0.2, 0.6), hatch(146, 24, 30, 150, 6, 125, 0.2, 0.6)],
  siren: () => [line([[70, 150], [70, 90], [100, 60], [130, 90], [130, 150], [70, 150]], 131, 0, 0.4, 'ink-line red'), line([[50, 160], [150, 160]], 132), line([[40, 70], [24, 60]], 133, 0.3, 0.6), line([[160, 70], [176, 60]], 134, 0.3, 0.6)],
  chairs: () => [0, 1, 2].flatMap((i) => [line([[30 + i * 56, 170], [30 + i * 56, 110], [70 + i * 56, 110], [70 + i * 56, 170]], 141 + i * 3), line([[30 + i * 56, 110], [30 + i * 56, 60]], 142 + i * 3, 0.1, 0.5), ring(50 + i * 56, 84, 9, 143 + i * 3, 0.3, 0.7)]),
  'tape-reel': () => [ring(64, 100, 40, 151), ring(64, 100, 8, 152, 0.1, 0.4), ring(144, 100, 40, 153), ring(144, 100, 8, 154, 0.1, 0.4), line([[64, 140], [144, 140]], 155, 0.3, 0.7, 'ink-line red')],
  notes: () => [...[60, 80, 100, 120, 140].map((y, i) => line([[20, y], [180, y]], 161 + i, 0, 0.3)), ...[50, 90, 130, 160].map((x, i) => s('g', {}, ring(x, 128 - i * 10, 7, 170 + i, 0.3 + i * 0.1, 0.5 + i * 0.1), line([[x + 7, 128 - i * 10], [x + 7, 88 - i * 10]], 175 + i, 0.35 + i * 0.1, 0.55 + i * 0.1)))],
  record: () => [ring(100, 100, 80, 181), ring(100, 100, 56, 182, 0.1, 0.4), ring(100, 100, 24, 183, 0.2, 0.5, 'ink-line red'), blot(100, 100, 3)],
  bars: () => [...[40, 70, 100, 130, 160].map((x, i) => line([[x, 20], [x, 180]], 191 + i)), line([[30, 20], [170, 20]], 197), line([[30, 180], [170, 180]], 198)],
  'music-stand': () => [line([[60, 60], [140, 60], [130, 110], [70, 110], [60, 60]], 201), line([[100, 110], [100, 176]], 202, 0.2, 0.5), line([[70, 180], [100, 170], [130, 180]], 203, 0.3, 0.6), blot(100, 84, 4, 'red')],
  lily: () => [line([[100, 180], [100, 90]], 211), line([[100, 90], [80, 50], [100, 64], [120, 50], [100, 90]], 212, 0.2, 0.6), line([[100, 140], [130, 120]], 213, 0.3, 0.6)],
  castle: () => [line([[30, 170], [30, 80], [50, 80], [50, 60], [70, 60], [70, 80], [130, 80], [130, 60], [150, 60], [150, 80], [170, 80], [170, 170], [30, 170]], 221), line([[90, 170], [90, 130], [110, 130], [110, 170]], 222, 0.2, 0.6), hatch(34, 84, 132, 40, 8, 223, 0.3, 0.7)],
  eye: () => [line([[20, 100], [100, 56], [180, 100], [100, 144], [20, 100]], 231), s('g', { class: 'v-pupil' }, ring(100, 100, 22, 232, 0.1, 0.5, 'ink-line red'), blot(100, 100, 8, 'red'))],
  guitar: () => [ring(80, 130, 34, 241), ring(110, 100, 24, 242, 0.1, 0.4), line([[118, 92], [176, 34]], 243, 0.2, 0.6), ring(80, 130, 8, 244, 0.3, 0.6)],
};

export const VISION_IDS = Object.keys(VISIONS);

/** A vision, drawn (null when the id is not in the library). */
export function vision(id: string, cls = 'fc-vision'): SVGSVGElement | null {
  const make = VISIONS[id];
  if (!make) return null;
  return drawing('0 0 200 200', `${cls} v-${id}`, ...make());
}

function mast(text: string): SVGTextElement {
  const t = s('text', { x: 40, y: 80, class: 'ink-label fc-mast' });
  t.textContent = text;
  return t;
}

/** The magazine of 1967: three columns of type, a photograph's frame, a rule. */
export function magazine(late = false): SVGSVGElement {
  const cols = [0, 1, 2].flatMap((c) =>
    Array.from({ length: 14 }, (_, r) => line([[40 + c * 120, 120 + r * 14], [140 + c * 120 - ((r * 7 + c * 3) % 5) * 6, 120 + r * 14]], 300 + c * 20 + r, 0.05 + r * 0.02, 0.25 + r * 0.02)),
  );
  return drawing(
    '0 0 420 340',
    `art-magazine${late ? ' late' : ''}`,
    paper(420, 340),
    line([[30, 40], [390, 40]], 290, 0, 0.2),
    line([[30, 96], [390, 96]], 291, 0, 0.2),
    mast(late ? '1968–2006' : '1967'),
    late ? line([[280, 54], [380, 54], [380, 88], [280, 88], [280, 54]], 292, 0.1, 0.4) : line([[260, 110], [380, 110], [380, 210], [260, 210], [260, 110]], 292, 0.1, 0.4),
    ...cols.slice(0, late ? 42 : 34),
  );
}

/** Mulholland Drive at night: the hill, and the city's lights below that come and go slowly. */
export function hillside(): SVGSVGElement {
  const lights = Array.from({ length: 46 }, (_, i) => {
    const x = 20 + ((i * 73) % 380);
    const y = 200 + ((i * 37) % 80);
    return s('circle', { cx: x, cy: y, r: 1.6 + (i % 3) * 0.6, class: `fc-light l${i % 5}` });
  });
  return drawing(
    '0 0 420 300',
    'art-hillside',
    paper(420, 300),
    s('g', { class: 'fc-wash' }, s('ellipse', { cx: 210, cy: 250, rx: 230, ry: 60, class: 'fc-glow' })),
    s('g', { class: 'fc-lights' }, ...lights),
    line([[0, 170], [80, 150], [160, 120], [230, 132], [300, 110], [420, 140]], 401, 0, 0.4),
    s('g', { class: 'fc-house', 'data-depth': 14 }, line([[250, 112], [250, 84], [272, 70], [294, 84], [294, 110]], 402, 0.1, 0.5), blot(272, 96, 3, 'red')),
    ink(loop(262, 120, 4, 9, 403, 0.6), 0.3, 0.6, { class: 'ink-line fc-sitter' }),
  );
}

/** Sunset Sound, 1 August 1967: five chairs, and strangers in them. */
export function studio(): SVGSVGElement {
  const chairs = [0, 1, 2, 3, 4].map((i) =>
    s(
      'g',
      { class: 'fc-chair', 'data-fade': `${0.05 + i * 0.06} ${0.2 + i * 0.06}` },
      line([[50 + i * 72, 220], [50 + i * 72, 170], [90 + i * 72, 170], [90 + i * 72, 220]], 500 + i),
      line([[50 + i * 72, 170], [50 + i * 72, 130]], 510 + i, 0.1, 0.4),
      s('g', { class: 'fc-stranger', 'data-fade': `${0.35 + i * 0.05} ${0.5 + i * 0.05}` }, ring(70 + i * 72, 116, 11, 520 + i, 0.35, 0.6), line([[70 + i * 72, 128], [70 + i * 72, 168]], 530 + i, 0.4, 0.65)),
    ),
  );
  return drawing('0 0 420 300', 'art-studio', paper(420, 300), line([[20, 60], [400, 60], [400, 100], [20, 100], [20, 60]], 540, 0, 0.3), hatch(24, 64, 372, 32, 8, 541, 0.05, 0.3), ...chairs, line([[20, 240], [400, 240]], 542, 0, 0.2));
}

/** The session diary's pages. */
export function diary(): SVGSVGElement {
  return drawing(
    '0 0 420 300',
    'art-diary',
    paper(420, 300),
    line([[60, 30], [210, 40], [210, 280], [60, 270], [60, 30]], 601),
    line([[210, 40], [360, 30], [360, 270], [210, 280]], 602, 0.05, 0.35),
    ...Array.from({ length: 10 }, (_, r) => line([[76, 70 + r * 20], [196, 72 + r * 20]], 610 + r, 0.1 + r * 0.06, 0.3 + r * 0.06)),
    ...Array.from({ length: 10 }, (_, r) => line([[224, 72 + r * 20], [344, 70 + r * 20]], 630 + r, 0.4 + r * 0.05, 0.55 + r * 0.05)),
  );
}

/** A staff that writes itself, as if sung. */
export function score(): SVGSVGElement {
  const staff = [0, 1, 2, 3, 4].map((k) => line([[20, 110 + k * 12], [400, 110 + k * 12]], 700 + k, 0, 0.2));
  const notes = Array.from({ length: 14 }, (_, i) => {
    const x = 50 + i * 25;
    const y = 158 - ((i * 5) % 7) * 7;
    return s('g', { class: 'fc-note' }, ink(loop(x, y, 5, 4, 710 + i, 0.5), 0.2 + i * 0.05, 0.3 + i * 0.05), ink(sketch([[x + 5, y], [x + 5, y - 30]], 730 + i, 0.4), 0.22 + i * 0.05, 0.32 + i * 0.05));
  });
  return drawing('0 0 420 300', 'art-score', paper(420, 300), ...staff, ...notes);
}

/** One of the eleven: a disc with the song's own vision drawn on its label. */
export function song(visionId: string | undefined, n: number): SVGSVGElement {
  const v = visionId ? VISIONS[visionId] : undefined;
  const label = v ? s('g', { transform: 'translate(160 110) scale(0.5)' }, ...v()) : null;
  return drawing(
    '0 0 420 320',
    `art-song n${n}`,
    paper(420, 320),
    s('g', { class: 'fc-disc' }, ink(loop(210, 160, 140, 140, 800 + n, 0.7), 0, 0.3), ink(loop(210, 160, 104, 104, 820 + n, 0.6), 0.05, 0.35), ink(loop(210, 160, 56, 56, 840 + n, 0.5), 0.1, 0.4, { class: 'ink-line red' })),
    label,
  );
}

/** The record turned over: a disc with both labels (side A and side B are HTML around it). */
export function disc(): SVGSVGElement {
  return drawing('0 0 300 300', 'art-flip', ink(loop(150, 150, 140, 140, 901, 0.4), 0, 0.2), ink(loop(150, 150, 100, 100, 902, 0.3), 0, 0.2), ink(loop(150, 150, 60, 60, 903, 0.3), 0, 0.2, { class: 'ink-line red' }));
}

/** The stage of the revival: stands that light one after another. */
export function stands(n = 15): SVGSVGElement {
  const g = Array.from({ length: n }, (_, i) => {
    const row = i < 8 ? 0 : 1;
    const x = row ? 70 + (i - 8) * 44 : 40 + i * 48;
    const y = row ? 150 : 210;
    return s(
      'g',
      { class: 'fc-stand', 'data-stand': i, style: `--i:${i}` },
      s('circle', { cx: x + 14, cy: y - 8, r: 16, class: 'fc-lamp' }),
      line([[x, y], [x + 28, y], [x + 24, y + 18], [x + 4, y + 18], [x, y]], 1000 + i, 0, 0.3),
      line([[x + 14, y + 18], [x + 14, y + 48]], 1020 + i, 0, 0.3),
    );
  });
  return drawing('0 0 420 300', 'art-stands', paper(420, 300), line([[20, 270], [400, 270]], 1050, 0, 0.2), ...g);
}

/** Echoes: rings going out from one point. */
export function echoes(): SVGSVGElement {
  return drawing('0 0 420 300', 'art-echoes', paper(420, 300), ...[20, 50, 85, 125, 170].map((r, i) => ink(loop(210, 150, r * 1.2, r, 1100 + i, 0.8), i * 0.12, 0.2 + i * 0.12, { class: i === 0 ? 'ink-line red' : 'ink-line' })));
}
