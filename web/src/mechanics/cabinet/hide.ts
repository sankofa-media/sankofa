// Where the caches hide: a faint glint on a card's picture (seen only on
// hover or keyboard focus), a word of a card or of a chapter step, a drawer
// under a Workshop object. Every one is a real button: the keyboard reaches
// it, and a screen reader hears that something is hidden here.
import type { App } from '../../app';
import type { Card } from '../../lib/types';
import { h } from '../../lib/dom';
import { lang, pick } from '../../lib/i18n';
import { anchorRegExp, contentsFor, type CabinetFile, type Cache } from './model';
import { openCacheDialog } from './cache';
import { holdings, onHoldings } from './store';

const HIDDEN = { en: 'Something is hidden here', ru: 'Здесь что-то спрятано' };

/** Caches this copy can open (each holds something in it). */
const live = (app: App, f: CabinetFile) => f.caches.filter((c) => contentsFor(c, app.edition).length);

const mark = (b: HTMLElement, c: Cache) => {
  b.dataset.cache = c.id;
  b.classList.toggle('opened', holdings().opened.includes(c.id));
};

/**
 * Wrap the first plain-text occurrence of `anchor` under `root` (outside links
 * and buttons) in a button; returns it, or null when the words are not there.
 */
export function wrapAnchor(root: Element, anchor: string, make: (text: string) => HTMLElement): HTMLElement | null {
  const re = anchorRegExp(anchor);
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => ((n.parentElement?.closest('a, button, .cb-word') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)),
  });
  for (let n = walk.nextNode() as Text | null; n; n = walk.nextNode() as Text | null) {
    const m = re.exec(n.data);
    if (!m) continue;
    const after = n.splitText(m.index);
    after.splitText(m[0].length);
    const b = make(after.data);
    after.replaceWith(b);
    return b;
  }
  return null;
}

function wordButton(app: App, f: CabinetFile, c: Cache, text: string): HTMLElement {
  const b = h('button.cb-word', { type: 'button', 'aria-label': `${text}: ${pick(HIDDEN)}`, onclick: (e: Event) => (e.stopPropagation(), openCacheDialog(app, f, c.id)) }, text);
  mark(b, c);
  return b;
}

/** Place a hotspot over an image at x/y % of the picture itself, wherever `cover` crops it. */
function placeSpot(img: HTMLImageElement, spot: HTMLElement, x: number, y: number): void {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  const bw = img.clientWidth;
  const bh = img.clientHeight;
  if (!nw || !nh || !bw || !bh) {
    spot.style.left = `${x}%`;
    spot.style.top = `${y}%`;
    return;
  }
  const fit = getComputedStyle(img).objectFit;
  const s = fit === 'cover' ? Math.max(bw / nw, bh / nh) : fit === 'contain' ? Math.min(bw / nw, bh / nh) : bw / nw;
  const dw = nw * s;
  const dh = fit === 'cover' || fit === 'contain' ? nh * s : bh;
  const [px, py] = (getComputedStyle(img).objectPosition || '50% 50%').split(' ').map((v) => (v.endsWith('%') ? parseFloat(v) / 100 : 0.5));
  const left = (bw - dw) * px + (x / 100) * dw;
  const top = (bh - dh) * (py ?? 0.5) + (y / 100) * dh;
  // A spot cropped out of sight is put back at the nearest edge it can be seen at.
  spot.style.left = `${Math.min(bw - 12, Math.max(12, left))}px`;
  spot.style.top = `${Math.min(bh - 12, Math.max(12, top))}px`;
}

/** The caches on a card: on its picture, in its words. */
export function hideInCard(app: App, f: CabinetFile, card: Card, article: HTMLElement): void {
  for (const c of live(app, f)) {
    const hd = c.hidden;
    if (hd.at === 'card-image' && hd.card === card.id) {
      const img = article.querySelector<HTMLImageElement>('.card-media img');
      if (!img || img.closest('.cb-imgwrap')) continue;
      const wrap = h('span.cb-imgwrap', {});
      img.replaceWith(wrap);
      const spot = h('button.cb-glint', { type: 'button', 'aria-label': pick({ en: 'Something is hidden in this picture', ru: 'На этой картинке что-то спрятано' }), onclick: () => openCacheDialog(app, f, c.id) }, h('i', { 'aria-hidden': 'true' }));
      mark(spot, c);
      wrap.append(img, spot);
      const place = () => placeSpot(img, spot, hd.x, hd.y);
      if (img.complete) place();
      img.addEventListener('load', place);
      if ('ResizeObserver' in window) new ResizeObserver(place).observe(img);
    } else if (hd.at === 'card-text' && hd.card === card.id) {
      const text = article.querySelector('.card-body .text');
      if (text) wrapAnchor(text, hd.anchor[lang()], (t) => wordButton(app, f, c, t));
    }
  }
}

/** The caches in the chapters' steps. */
export function hideInStory(app: App, f: CabinetFile): void {
  for (const c of live(app, f)) {
    const hd = c.hidden;
    if (hd.at !== 'chapter-step') continue;
    const ch = document.getElementById(`ch-${hd.chapter}`);
    if (!ch) continue;
    for (const p of ch.querySelectorAll('.step p')) if (wrapAnchor(p, hd.anchor[lang()], (t) => wordButton(app, f, c, t))) break;
  }
}

/** The drawer under a Workshop object: most hold only sawdust; one holds a cache. */
export function workshopDrawer(app: App, f: CabinetFile | null, key: string): HTMLElement {
  const c = f ? live(app, f).find((x) => x.hidden.at === 'workshop' && x.hidden.object === key) : undefined;
  const inner = h('div.cb-wdrawer-in', { hidden: true });
  const btn = h('button.cb-wdrawer-btn', { type: 'button', 'aria-expanded': 'false' }, h('span.cb-wdrawer-knob', { 'aria-hidden': 'true' }), pick({ en: 'The drawer under the bench', ru: 'Ящик под верстаком' }));
  btn.addEventListener('click', () => {
    const on = inner.hidden;
    inner.hidden = !on;
    btn.setAttribute('aria-expanded', String(on));
  });
  if (c) {
    const b = h('button.cb-wcache', { type: 'button', 'aria-label': `${pick(c.name)}: ${pick(HIDDEN)}`, onclick: () => f && openCacheDialog(app, f, c.id) }, pick({ en: 'Something lies at the back of the drawer.', ru: 'В глубине ящика что-то лежит.' }));
    mark(b, c);
    inner.append(b);
  } else inner.append(h('p.cb-wempty', {}, pick({ en: 'Only sawdust and a pencil stub.', ru: 'Только стружка и огрызок карандаша.' })));
  return h('div.cb-wdrawer', {}, btn, inner);
}

// Opened caches look opened everywhere they are hidden.
onHoldings((hs) => document.querySelectorAll<HTMLElement>('[data-cache]').forEach((b) => b.classList.toggle('opened', hs.opened.includes(b.dataset.cache!))));
