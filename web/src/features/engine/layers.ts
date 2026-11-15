// Layered illustrations: a scene's generated picture as transparent layers
// stacked on one canvas of paper colour. The engine moves them through the
// data attributes it already knows (data-depth for parallax, data-open for a
// layer swinging open) and CSS does the rest: each layer is wiped in like
// ink when its scene is reached, figures breathe, a disc turns, and a layer
// with a state shows only while the picture is in it. Files load when their
// scene comes near (img[data-src], see scroll.ts). Calm mode and reduced
// motion leave the layers still and finished.
import { h } from '../../lib/dom';
import { pick } from '../../lib/i18n';
import type { ArtLayer, SceneArt } from '../model';

export interface Picture {
  el: HTMLElement;
  /** Show the layers of this state (and hide the others' from screen readers too). */
  setState(state: string): void;
  readonly state: string | undefined;
}

const pct = (v: number | undefined) => `${v ?? 0}%`;

function layer(l: ArtLayer, i: number, src: string): HTMLElement {
  const fit = l.fit ?? {};
  const style = [`--x:${pct(fit.x)}`, `--y:${pct(fit.y)}`, `--k:${fit.scale ?? 1}`];
  if (l.spin) style.push(`--cx:${l.spin.x}%`, `--cy:${l.spin.y}%`, `--ratio:${l.spin.ratio}`, `--tilt:${l.spin.tilt ?? 0}deg`);
  const img = h('img', {
    alt: l.alt === '' ? '' : pick(l.alt),
    'data-src': src,
    decoding: 'async',
    draggable: 'false',
    style: style.join(';'),
  });
  const pivot = l.pivot?.trim().split(/\s+/).map((v) => `${v}%`).join(' ');
  // A disc turns inside its face: a still copy keeps the rim, the turning one is clipped to the face.
  const face = l.role === 'spin' && l.spin?.face;
  const turning = face
    ? [
        h('img.al-still', { alt: '', 'data-src': src, decoding: 'async', draggable: 'false', 'aria-hidden': 'true', style: style.join(';') }),
        h('div.al-face', { style: `clip-path:ellipse(${face[2]}% ${face[3]}% at ${face[0]}% ${face[1]}%)` }, img),
      ]
    : [img];
  return h(
    'div.al',
    {
      'data-layer': l.file.replace(/\.[a-z]+$/, ''),
      'data-depth': l.depth ? String(l.depth) : undefined,
      'data-role': l.role,
      'data-state': l.state,
      'data-open': l.open,
      style: `--i:${i}${pivot ? `;--pivot:${pivot}` : ''}`,
    },
    ...turning,
  );
}

/** A scene's layered picture. `src` turns an art file into its URL. */
export function layered(art: SceneArt, src: (file: string) => string, opts: { name: string; state?: string; overlay?: Node | null }): Picture {
  const layers = art.layers.map((l, i) => layer(l, i, src(l.file)));
  const decorative = art.layers.every((l) => l.alt === '');
  const el = h('div.ft-art', { 'data-art': opts.name, style: `aspect-ratio:${art.aspect ?? '3 / 2'}`, 'aria-hidden': decorative ? 'true' : undefined }, ...layers, opts.overlay ?? null);
  let state: string | undefined;
  const setState = (s: string) => {
    state = s;
    el.dataset.state = s;
    for (const al of layers) {
      if (!al.dataset.state) continue;
      if (al.dataset.state === s) al.removeAttribute('aria-hidden');
      else al.setAttribute('aria-hidden', 'true');
    }
  };
  if (opts.state) setState(opts.state);
  return {
    el,
    setState,
    get state() {
      return state;
    },
  };
}
