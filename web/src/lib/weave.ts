// Weave the dictionary into rendered text: the first mention of a card in
// every block becomes a link that opens the card in place, like a [[link]].
// Used for text the museum renders from data it does not mark up by hand
// (the Workshop's labels, the cabinet, documents, country headers, Roots,
// the engine room); authored prose carries explicit [[id|words]] links.
import type { App } from '../app';
import { cardLink } from '../app';
import { EMPTY_LEXICON, linkSegments, type Lexicon } from './names';

let lexicon: Lexicon = EMPTY_LEXICON;

export function setLexicon(l: Lexicon): void {
  lexicon = l;
}

export function currentLexicon(): Lexicon {
  return lexicon;
}

/**
 * Never linked inside: headings, controls, links, quotations of sources,
 * code, pictures and anything marked data-no-link (the dedication).
 */
export const NO_LINK =
  'a, button, select, option, input, textarea, label, summary, h1, h2, h3, h4, h5, h6, blockquote, q, cite, code, pre, kbd, samp, svg, script, style, ' +
  '[role="button"], [role="tab"], [role="link"], [contenteditable], [aria-hidden="true"], [data-no-link], .xref, .cb-word, .unseen, .rt-fact, .ck-quote, .mx-dedication';
/** What counts as one block for the first-mention rule. */
const BLOCK = 'p, li, dd, dt, td, th, figcaption, caption, div, section, article, aside, header, footer, details';

export interface WeaveOptions {
  /** Cards not to link here, such as the card being read. */
  exclude?: Iterable<string>;
}

/** Link the first mention of every card in each block under `root`; returns how many links it made. */
export function weave(app: App, root: Element, opts: WeaveOptions = {}): number {
  if (lexicon === EMPTY_LEXICON || root.closest('[data-no-link], .mx-dedication')) return 0;
  const exclude = new Set(opts.exclude ?? []);
  const seenBy = new Map<Element, Set<string>>();
  const seenIn = (block: Element) => {
    let s = seenBy.get(block);
    if (!s) {
      // A card already linked in the block, by hand or before, counts as mentioned.
      s = new Set([...block.querySelectorAll<HTMLElement>('[data-card]')].map((a) => a.dataset.card!));
      seenBy.set(block, s);
    }
    return s;
  };
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const p = n.parentElement;
      if (!p || !/\p{L}{3}/u.test(n.nodeValue ?? '')) return NodeFilter.FILTER_REJECT;
      return p.closest(NO_LINK) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: Text[] = [];
  for (let n = walk.nextNode(); n; n = walk.nextNode()) nodes.push(n as Text);
  let made = 0;
  for (const n of nodes) {
    const block = n.parentElement!.closest(BLOCK);
    const parts = linkSegments(n.data, lexicon, { seen: seenIn(block && root.contains(block) ? block : root), exclude });
    if (!parts.some((p) => 'target' in p)) continue;
    const frag = document.createDocumentFragment();
    for (const p of parts) {
      if (!('target' in p)) frag.append(p.text);
      else {
        frag.append(cardLink(app, p.target, p.text));
        made++;
      }
    }
    n.replaceWith(frag);
  }
  return made;
}

/**
 * Keep `root` woven as views render into it: whatever is added is woven on
 * the next frame. Returns a function that stops watching.
 */
export function weaveLive(app: App, root: Element, opts: WeaveOptions | (() => WeaveOptions | null) = {}): () => void {
  let raf = 0;
  const run = () => {
    raf = 0;
    const o = typeof opts === 'function' ? opts() : opts;
    if (!o) return;
    obs.disconnect();
    weave(app, root, o);
    obs.observe(root, { childList: true, subtree: true });
  };
  const obs = new MutationObserver(() => {
    raf ||= requestAnimationFrame(run);
  });
  obs.observe(root, { childList: true, subtree: true });
  raf = requestAnimationFrame(run);
  return () => {
    obs.disconnect();
    if (raf) cancelAnimationFrame(raf);
  };
}

const ID_RE = /(?<![a-z0-9-])[a-z0-9]+(?:-[a-z0-9]+)*(?![a-z0-9-])/g;
/** Where a word is an object's name rather than prose: a table's first column, a command's argument, a YAML name or list. */
const ID_PLACE = /^$|(?:^\s*-|\bcards?|\bdict|\bname:|\bpair:)\s*$|\[[^\]]*$/;

/**
 * In a terminal shown on the page, card ids (the names of the Card objects,
 * as `kubectl get cards` prints them) become links to their cards.
 */
export function weaveIds(app: App, root: Element): void {
  for (const block of root.querySelectorAll('.term pre, .term code')) {
    const walk = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    for (let n = walk.nextNode(); n; n = walk.nextNode()) if (!n.parentElement?.closest('a')) nodes.push(n as Text);
    for (const n of nodes) {
      let last = 0;
      const frag = document.createDocumentFragment();
      for (const m of n.data.matchAll(ID_RE)) {
        const id = m[0];
        const i = m.index ?? 0;
        if (!app.set.get(id) || !ID_PLACE.test(n.data.slice(n.data.lastIndexOf('\n', i - 1) + 1, i))) continue;
        if (i > last) frag.append(n.data.slice(last, i));
        const a = cardLink(app, id, id);
        a.classList.add('term-card');
        frag.append(a);
        last = i + id.length;
      }
      if (!last) continue;
      frag.append(n.data.slice(last));
      n.replaceWith(frag);
    }
  }
}
