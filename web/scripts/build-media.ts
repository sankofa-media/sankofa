// Make smaller copies of the museum's images: media/w<width>/<file>, and
// data/media.json listing which exist. Uses `sips` (macOS) or `vipsthumbnail`
// (libvips, installed in the Docker build); without either, it writes an
// empty manifest and the museum serves the originals.
// The special projects' illustration layers (media/features/<id>/*.webp,
// copied there by build-features.ts, so run this after it) get the same
// copies at media/w<width>/features/<id>/<file>, made with cwebp or vips so
// the layers keep their transparency.
// Usage: node scripts/build-media.ts <media-dir> <manifest.json>
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const WIDTHS = [480, 960, 1600];

/**
 * Scans with obvious scanner margins and colour bars, cropped for display:
 * [top, right, bottom, left] as fractions of the image. Content keeps the
 * original; only the served copy is cropped.
 */
const CROPS: Record<string, [number, number, number, number]> = {
  'phillis-wheatley.jpg': [0.08, 0.13, 0.08, 0.145],
  // the scan's paper margins read as grey bands behind the coda
  'adinkra.jpg': [0.025, 0.035, 0.02, 0.02],
};
const [dir, out] = process.argv.slice(2);
if (!dir || !out) {
  console.error('usage: build-media.ts <media-dir> <manifest.json>');
  process.exit(2);
}

const has = (cmd: string) => {
  try {
    execFileSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
const tool = has('sips') ? 'sips' : has('vipsthumbnail') ? 'vips' : null;
// WebP copies: cwebp (libwebp) where present, else vips can write them.
const webp = has('cwebp') ? 'cwebp' : has('vipsthumbnail') ? 'vips' : null;

function toWebp(src: string): string | undefined {
  const dst = src.replace(/\.(jpe?g|png)$/i, '.webp');
  if (existsSync(dst) && statSync(dst).mtimeMs >= statSync(src).mtimeMs) return dst;
  try {
    if (webp === 'cwebp') execFileSync('cwebp', ['-quiet', '-q', '74', src, '-o', dst], { stdio: 'ignore' });
    else if (webp === 'vips') execFileSync('vips', ['copy', src, `${dst}[Q=74]`], { stdio: 'ignore' });
    else return undefined;
    return dst;
  } catch {
    return undefined;
  }
}

function crop(file: string, c: [number, number, number, number]): void {
  const w = width(file);
  const hgt = (() => {
    try {
      if (tool === 'sips') return Number(execFileSync('sips', ['-g', 'pixelHeight', file]).toString().match(/pixelHeight:\s*(\d+)/)?.[1]);
      return Number(execFileSync('vipsheader', ['-f', 'height', file]).toString().trim());
    } catch {
      return 0;
    }
  })();
  if (!w || !hgt) return;
  const [t, r, b, l] = c;
  const cw = Math.round(w * (1 - l - r));
  const ch = Math.round(hgt * (1 - t - b));
  const x = Math.round(w * l);
  const y = Math.round(hgt * t);
  if (tool === 'sips') execFileSync('sips', ['--cropToHeightWidth', String(ch), String(cw), '--cropOffset', String(y), String(x), file], { stdio: 'ignore' });
  else execFileSync('vips', ['crop', file, `${file}.tmp.jpg`, String(x), String(y), String(cw), String(ch)], { stdio: 'ignore' }), execFileSync('mv', [`${file}.tmp.jpg`, file]);
}

function width(file: string): number | undefined {
  try {
    if (tool === 'sips') return Number(execFileSync('sips', ['-g', 'pixelWidth', file]).toString().match(/pixelWidth:\s*(\d+)/)?.[1]);
    if (tool === 'vips') return Number(execFileSync('vipsheader', ['-f', 'width', file]).toString().trim());
  } catch {
    /* unreadable: skip */
  }
  return undefined;
}

function height(file: string): number | undefined {
  try {
    if (tool === 'sips') return Number(execFileSync('sips', ['-g', 'pixelHeight', file]).toString().match(/pixelHeight:\s*(\d+)/)?.[1]);
    if (tool === 'vips') return Number(execFileSync('vipsheader', ['-f', 'height', file]).toString().trim());
  } catch {
    /* unreadable: skip */
  }
  return undefined;
}

function resize(src: string, dst: string, w: number): void {
  // sips now and then fails a file it handles fine a moment later (exit 13
  // somewhere in a long run of a thousand pictures): try it again before giving up.
  for (let attempt = 1; ; attempt++) {
    try {
      if (tool === 'sips') execFileSync('sips', ['-Z', String(w), '-s', 'formatOptions', '72', src, '--out', dst], { stdio: 'ignore' });
      else execFileSync('vipsthumbnail', [src, '--size', `${w}x`, '-o', `${resolve(dst)}[Q=72,strip]`], { stdio: 'ignore' });
      return;
    } catch (err) {
      if (attempt >= 3) throw err;
      execFileSync('sleep', ['1']);
    }
  }
}

/**
 * The picture's average colour, as #rrggbb: shown in its frame while the
 * picture itself is still on the way. The image is shrunk to one pixel and
 * that pixel read back (BMP from sips, PPM from vips). Optional: on any
 * failure the frame keeps the page's own colour.
 */
const scratch = mkdtempSync(join(tmpdir(), 'sankofa-media-'));
process.on('exit', () => rmSync(scratch, { recursive: true, force: true }));
const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
function averageColour(src: string): string | undefined {
  try {
    if (tool === 'sips') {
      const out = join(scratch, 'px.bmp');
      execFileSync('sips', ['-z', '1', '1', '-s', 'format', 'bmp', src, '--out', out], { stdio: 'ignore' });
      const b = readFileSync(out);
      const at = b.readUInt32LE(10);
      return hex(b[at + 2], b[at + 1], b[at]);
    }
    if (tool === 'vips') {
      const out = join(scratch, 'px.ppm');
      execFileSync('vipsthumbnail', [src, '--size', '1x1!', '-o', out], { stdio: 'ignore' });
      const b = readFileSync(out);
      // P6 header: magic, width, height and maxval, then the pixel bytes.
      const head = b.subarray(0, 64).toString('latin1').match(/^P6\s+\d+\s+\d+\s+\d+\s/);
      if (!head) return undefined;
      const at = head[0].length;
      return hex(b[at], b[at + 1], b[at + 2]);
    }
  } catch {
    /* no colour: the frame stays neutral */
  }
  return undefined;
}

const files: Record<string, number[]> = {};
const colours: Record<string, string> = {};
const sizes: Record<string, number> = {};
const ratios: Record<string, number> = {};
const webps: string[] = [];
if (tool) {
  for (const f of readdirSync(dir)) {
    const src = join(dir, f);
    if (!/\.(jpe?g|png)$/i.test(f) || !statSync(src).isFile()) continue;
    if (CROPS[f]) crop(src, CROPS[f]);
    const w0 = width(src);
    if (!w0) continue;
    sizes[f] = w0;
    const h0 = height(src);
    if (h0) ratios[f] = Math.round((w0 / h0) * 1000) / 1000;
    const c = averageColour(src);
    if (c) colours[f] = c;
    for (const w of WIDTHS) {
      if (w >= w0 * 0.9) break; // never upscale, and skip near-duplicates
      const dstDir = join(dir, `w${w}`);
      const dst = join(dstDir, f);
      mkdirSync(dstDir, { recursive: true });
      if (!existsSync(dst) || statSync(dst).mtimeMs < statSync(src).mtimeMs) resize(src, dst, w);
      (files[f] ??= []).push(w);
    }
    // WebP for the original and every smaller copy, or none at all.
    const all = [src, ...(files[f] ?? []).map((w) => join(dir, `w${w}`, f))];
    if (webp && all.every((p) => toWebp(p))) webps.push(f);
  }
}

/** A smaller copy of a transparent WebP layer, alpha kept. */
function resizeWebp(src: string, dst: string, w: number): void {
  if (webp === 'cwebp') execFileSync('cwebp', ['-quiet', '-resize', String(w), '0', '-q', '82', '-alpha_q', '90', src, '-o', dst], { stdio: 'ignore' });
  else execFileSync('vipsthumbnail', [src, '--size', `${w}x`, '-o', `${resolve(dst)}[Q=82,alpha_q=90,strip]`], { stdio: 'ignore' });
}

// The illustration layers of the special projects, at media/features/<id>/.
const featuresDir = join(dir, 'features');
if (tool && webp && existsSync(featuresDir)) {
  for (const id of readdirSync(featuresDir)) {
    const fdir = join(featuresDir, id);
    if (!statSync(fdir).isDirectory()) continue;
    for (const f of readdirSync(fdir)) {
      if (!/\.(webp|png|jpe?g)$/i.test(f)) continue;
      const key = `features/${id}/${f}`;
      const src = join(dir, key);
      const w0 = width(src);
      if (!w0) continue;
      sizes[key] = w0;
      const encoded = f.endsWith('.webp') ? src : toWebp(src);
      if (!encoded) continue;
      if (!f.endsWith('.webp')) webps.push(key);
      const servedKey = key.replace(/\.(png|jpe?g)$/i, '.webp');
      for (const w of WIDTHS) {
        if (w >= w0 * 0.9) break;
        const dst = join(dir, `w${w}`, servedKey);
        mkdirSync(dirname(dst), { recursive: true });
        try {
          if (!existsSync(dst) || statSync(dst).mtimeMs < statSync(src).mtimeMs) resizeWebp(src, dst, w);
        } catch {
          break; // no copy: the original serves
        }
        (files[key] ??= []).push(w);
      }
    }
  }
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ widths: WIDTHS, files, sizes, ratios, colours, webp: webps }));
console.log(`media variants: ${tool ?? 'none (no sips or vipsthumbnail)'}, ${Object.keys(files).length} images, ${webps.length} with WebP`);

// The cover is a backdrop: give it its own lighter responsive encodings.
const hero = join(dir, 'hero-v0.jpg');
if (webp && existsSync(hero)) {
  for (const w of WIDTHS) {
    const dst = join(dir, `cover-${w}.webp`);
    if (webp === 'cwebp') execFileSync('cwebp', ['-quiet', '-resize', String(w), '0', '-q', '25', hero, '-o', dst]);
    else execFileSync('vipsthumbnail', [hero, '--size', `${w}x`, '-o', `${resolve(dst)}[Q=25,strip]`]);
  }
}
