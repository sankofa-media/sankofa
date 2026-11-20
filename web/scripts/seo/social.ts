// Link-preview pictures (1200×630) for the special projects, drawn from the
// feature's own art: its `seo.image` when it names one, else its cover's
// layers stacked back to front, as the list of features shows them. Uses
// ImageMagick where present (macOS builds), else libvips (the Docker build);
// without either, the feature keeps the site's own preview picture.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const SOCIAL_W = 1200;
export const SOCIAL_H = 630;
const BG = '#0c0d18';

const has = (cmd: string) => {
  try {
    execFileSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

export type SocialTool = 'magick' | 'vips' | null;

export function socialTool(): SocialTool {
  return has('magick') ? 'magick' : has('vips') && has('vipsthumbnail') ? 'vips' : null;
}

/**
 * Stack `layers` (back to front, each filling the canvas as in the museum)
 * into a 1200×630 JPEG at `out`. Returns false when no tool could draw it.
 */
export function composeSocial(layers: string[], out: string, tool: SocialTool = socialTool()): boolean {
  const files = layers.filter((f) => existsSync(f));
  if (!files.length || !tool) return false;
  mkdirSync(dirname(out), { recursive: true });
  const size = `${SOCIAL_W}x${SOCIAL_H}`;
  try {
    if (tool === 'magick') {
      const args = ['-size', size, `xc:${BG}`];
      for (const f of files) args.push('(', f, '-background', 'none', '-resize', `${size}^`, '-gravity', 'center', '-extent', size, ')', '-composite');
      execFileSync('magick', [...args, '-strip', '-quality', '84', out], { stdio: 'ignore' });
      return true;
    }
    const tmp = mkdtempSync(join(tmpdir(), 'sankofa-social-'));
    try {
      const fitted = files.map((f, i) => {
        const o = join(tmp, `l${i}.png`);
        execFileSync('vipsthumbnail', [f, '--size', size, '--smartcrop', 'centre', '-o', o], { stdio: 'ignore' });
        return o;
      });
      const stacked = join(tmp, 'stack.png');
      if (fitted.length === 1) execFileSync('vips', ['copy', fitted[0], stacked], { stdio: 'ignore' });
      else execFileSync('vips', ['composite', fitted.join(' '), stacked, Array(fitted.length - 1).fill('2').join(' ')], { stdio: 'ignore' });
      execFileSync('vips', ['flatten', stacked, `${out}[Q=84,strip]`, '--background', '12 13 24'], { stdio: 'ignore' });
      return true;
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  } catch {
    return false;
  }
}
