// A small QR code encoder (ISO/IEC 18004): byte mode, error correction
// level M, versions 1–10 (up to 213 bytes, enough for a museum link). It
// draws to a boolean grid and to an SVG path; nothing is fetched, nothing
// leaves the page. `qrSvg` draws one for a link a phone should open.

/** Error correction level M: [EC codewords per block, blocks of the short length, short data length, blocks of the long length]. */
const BLOCKS_M: [number, number, number, number][] = [
  [0, 0, 0, 0],
  [10, 1, 16, 0],
  [16, 1, 28, 0],
  [26, 1, 44, 0],
  [18, 2, 32, 0],
  [24, 2, 43, 0],
  [16, 4, 27, 0],
  [18, 4, 31, 0],
  [22, 2, 38, 2],
  [22, 3, 36, 2],
  [26, 4, 43, 1],
];

const ALIGN: number[][] = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

/** Data codewords a version holds at level M. */
export function dataCapacity(version: number): number {
  const [, nShort, lenShort, nLong] = BLOCKS_M[version];
  return nShort * lenShort + nLong * (lenShort + 1);
}

/** Bytes of text a version holds in byte mode. */
export function byteCapacity(version: number): number {
  const countBits = version < 10 ? 8 : 16;
  return Math.floor((dataCapacity(version) * 8 - 4 - countBits) / 8);
}

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const r = new Array<number>(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      r[j] = gfMul(r[j], root);
      if (j + 1 < degree) r[j] ^= r[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return r;
}

/** The Reed–Solomon error correction codewords of `data`. */
export function rsRemainder(data: number[], degree: number): number[] {
  const div = rsDivisor(degree);
  const r = new Array<number>(degree).fill(0);
  for (const b of data) {
    const f = b ^ (r.shift() as number);
    r.push(0);
    for (let i = 0; i < degree; i++) r[i] ^= gfMul(div[i], f);
  }
  return r;
}

function utf8(text: string): number[] {
  return [...new TextEncoder().encode(text)];
}

/** The final codeword sequence: data with its padding, split in blocks, error correction added, interleaved. */
export function codewords(bytes: number[], version: number): number[] {
  const cap = dataCapacity(version);
  const bits: number[] = [];
  const put = (v: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, cap * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < cap; pad ^= 0xec ^ 0x11) data.push(pad);

  const [ec, nShort, lenShort, nLong] = BLOCKS_M[version];
  const blocks: number[][] = [];
  let k = 0;
  for (let b = 0; b < nShort + nLong; b++) {
    const len = b < nShort ? lenShort : lenShort + 1;
    blocks.push(data.slice(k, k + len));
    k += len;
  }
  const ecs = blocks.map((b) => rsRemainder(b, ec));
  const out: number[] = [];
  for (let i = 0; i <= lenShort; i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < ec; i++) for (const e of ecs) out.push(e[i]);
  return out;
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** The 15 format bits for level M and a mask. */
export function formatBits(mask: number): number {
  const data = (0b00 << 3) | mask; // level M is 00
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** The 18 version bits (versions 7 and up). */
export function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

export interface QR {
  version: number;
  size: number;
  mask: number;
  /** modules[y][x]: true is dark. */
  modules: boolean[][];
}

class Grid {
  readonly version: number;
  readonly size: number;
  readonly m: boolean[][];
  readonly fn: boolean[][];
  constructor(version: number) {
    this.version = version;
    this.size = version * 4 + 17;
    this.m = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.fn = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }
  set(x: number, y: number, dark: boolean): void {
    this.m[y][x] = dark;
    this.fn[y][x] = true;
  }
  finder(cx: number, cy: number): void {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= this.size || y >= this.size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        this.set(x, y, d !== 2 && d !== 4);
      }
  }
  align(cx: number, cy: number): void {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) this.set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  format(mask: number): void {
    const bits = formatBits(mask);
    const bit = (i: number) => ((bits >>> i) & 1) === 1;
    const n = this.size;
    for (let i = 0; i <= 5; i++) this.set(8, i, bit(i));
    this.set(8, 7, bit(6));
    this.set(8, 8, bit(7));
    this.set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) this.set(n - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.set(8, n - 15 + i, bit(i));
    this.set(8, n - 8, true);
  }
  functions(): void {
    const n = this.size;
    for (let i = 0; i < n; i++) {
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }
    this.finder(3, 3);
    this.finder(n - 4, 3);
    this.finder(3, n - 4);
    const pos = ALIGN[this.version];
    const last = pos.length - 1;
    for (let i = 0; i < pos.length; i++)
      for (let j = 0; j < pos.length; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
        this.align(pos[i], pos[j]);
      }
    this.format(0);
    if (this.version >= 7) {
      const bits = versionBits(this.version);
      for (let i = 0; i < 18; i++) {
        const dark = ((bits >>> i) & 1) === 1;
        const a = n - 11 + (i % 3);
        const b = Math.floor(i / 3);
        this.set(a, b, dark);
        this.set(b, a, dark);
      }
    }
  }
  place(data: number[]): void {
    const n = this.size;
    let i = 0;
    for (let right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < n; vert++)
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const up = ((right + 1) & 2) === 0;
          const y = up ? n - 1 - vert : vert;
          if (this.fn[y][x] || i >= data.length * 8) continue;
          this.m[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
    }
  }
  mask(k: number): void {
    const f = MASKS[k];
    for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) if (!this.fn[y][x] && f(x, y)) this.m[y][x] = !this.m[y][x];
  }
}

/** A penalty for how hard a pattern is to read (runs, 2×2 blocks, finder look-alikes, balance). */
export function penalty(m: boolean[][]): number {
  const n = m.length;
  let p = 0;
  const lines = (get: (a: number, b: number) => boolean) => {
    for (let a = 0; a < n; a++) {
      let run = 1;
      for (let b = 1; b <= n; b++) {
        if (b < n && get(a, b) === get(a, b - 1)) run++;
        else {
          if (run >= 5) p += run - 2;
          run = 1;
        }
      }
      // A finder look-alike: dark light dark dark dark light dark with light on one side.
      for (let b = 0; b + 10 < n; b++) {
        const seq = Array.from({ length: 11 }, (_, k) => get(a, b + k));
        const core = [true, false, true, true, true, false, true];
        const matchL = seq.slice(4).every((v, k) => v === core[k]) && seq.slice(0, 4).every((v) => !v);
        const matchR = seq.slice(0, 7).every((v, k) => v === core[k]) && seq.slice(7).every((v) => !v);
        if (matchL || matchR) p += 40;
      }
    }
  };
  lines((y, x) => m[y][x]);
  lines((x, y) => m[y][x]);
  for (let y = 0; y + 1 < n; y++) for (let x = 0; x + 1 < n; x++) if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
  const dark = m.reduce((a, r) => a + r.filter(Boolean).length, 0);
  p += Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;
  return p;
}

/** Encode text (UTF-8) as a QR code; throws when it does not fit version 10. */
export function encodeQR(text: string, mask?: number): QR {
  const bytes = utf8(text);
  let version = 1;
  while (version <= 10 && byteCapacity(version) < bytes.length) version++;
  if (version > 10) throw new Error(`QR: ${bytes.length} bytes do not fit version 10`);
  const cw = codewords(bytes, version);
  let best: Grid | null = null;
  let bestK = 0;
  let bestP = Infinity;
  for (const k of mask === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [mask]) {
    const g = new Grid(version);
    g.functions();
    g.place(cw);
    g.mask(k);
    g.format(k);
    const p = mask === undefined ? penalty(g.m) : 0;
    if (p < bestP) {
      best = g;
      bestP = p;
      bestK = k;
    }
  }
  return { version, size: best!.size, mask: bestK, modules: best!.m };
}

/** One SVG path drawing every dark module (with a quiet zone of `margin` modules). */
export function qrPath(qr: QR, margin = 4): { d: string; size: number } {
  const parts: string[] = [];
  qr.modules.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x++;
        continue;
      }
      let w = 1;
      while (x + w < row.length && row[x + w]) w++;
      parts.push(`M${x + margin} ${y + margin}h${w}v1h-${w}z`);
      x += w;
    }
  });
  return { d: parts.join(''), size: qr.size + margin * 2 };
}

/** An SVG QR code for `text`, black on white, named for screen readers by `label`. */
export function qrSvg(text: string, label: string, cls = 'fc-qr'): SVGSVGElement {
  const { d, size } = qrPath(encodeQR(text));
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('class', cls);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.dataset.url = text;
  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('width', String(size));
  bg.setAttribute('height', String(size));
  bg.setAttribute('fill', '#fff');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', d);
  p.setAttribute('fill', '#000');
  svg.append(bg, p);
  return svg;
}

/** A phone or a tablet: no hover, a coarse pointer (a QR code would be pointless there). */
export function isPhone(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;
}
