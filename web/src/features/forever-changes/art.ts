// What Forever Changes still draws in code, in ink: the visions of the
// Arthur Lee mode that have no painted overlay (a trumpet, a rose, a
// siren…) and the record that turns over between the sides. Every chapter's
// picture is a generated illustration (the scenes' `art:` layers).
import { blot, drawing, hatch, ink, loop, s, sketch } from '../engine/ink';

type P = [number, number];

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

/** The record turned over: a disc with both labels (side A and side B are HTML around it). */
export function disc(): SVGSVGElement {
  return drawing('0 0 300 300', 'art-flip', ink(loop(150, 150, 140, 140, 901, 0.4), 0, 0.2), ink(loop(150, 150, 100, 100, 902, 0.3), 0, 0.2), ink(loop(150, 150, 60, 60, 903, 0.3), 0, 0.2, { class: 'ink-line red' }));
}
