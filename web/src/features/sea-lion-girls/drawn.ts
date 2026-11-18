// Drawings in code on the warm paper of the generated pictures (#f3ead8):
// ink and pencil, one muted red, no text. Every scene now has its generated
// art or a photo; what is drawn here is the sketch a photograph develops out
// of, the few lines it shows until the photo comes up.
import { h } from '../../lib/dom';
import { blot, drawing, ink, loop, s, sketch } from '../engine/ink';

const W = 600;
const H = 400;
type P = [number, number];

/** A drawing on the paper of the generated pictures (decorative: the text says what it shows). */
export function panel(name: string, svg: SVGSVGElement): HTMLElement {
  return h('div.ft-art.ft-drawn', { 'data-art': name, 'data-drawn': '', style: 'aspect-ratio:3 / 2', 'aria-hidden': 'true' }, svg);
}

const canvas = (cls: string, ...children: (SVGElement | null | undefined)[]) => drawing(`0 0 ${W} ${H}`, `art-drawn ${cls}`, ...children);

/** A closed hand-drawn outline. */
const shape = (pts: P[], seed: number, jitter = 1) => `${sketch([...pts, pts[0]], seed, jitter)} Z`;

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
