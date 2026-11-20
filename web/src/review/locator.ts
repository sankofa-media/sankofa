// How a review note finds its element again: a CSS path anchored on the
// museum's own data-* ids, the ids around the element, and its text. Written
// against a small slice of the DOM so it can be tested without a browser.

export interface ElLike {
  tagName: string;
  id: string;
  parentElement: ElLike | null;
  children: ArrayLike<ElLike>;
  attributes: ArrayLike<{ name: string; value: string }>;
  textContent: string | null;
  getAttribute(name: string): string | null;
}

export interface Target {
  css: string;
  tag: string;
  data?: Record<string, string>;
  attrs?: Record<string, string>;
  classes?: string[];
  text?: string;
  rect?: { x: number; y: number; w: number; h: number };
}

export interface PageInfo {
  key: string;
  view?: string;
  item?: string;
  scene?: string;
  chapter?: string;
}

/** data-* attributes that say what a thing is, used to anchor the CSS path. */
const ANCHORS = ['feature-id', 'scene', 'block', 'layer', 'chapter', 'step', 'beat', 'object', 'fact', 'card', 'root', 'country', 'feature'];
/** data-* attributes that say how a thing is right now, not what it is. */
const STATE = new Set(['state', 'painted', 'shown', 'lit', 'open', 'fade', 'frozen', 'empty', 'audio', 'knocked', 'playable', 'lying', 'renamed', 'theme', 'develop', 'oil', 'ink', 'sheet-count', 'src', 'p']);
/** Inline elements: a tap on one means the block it is in. */
const INLINE = new Set(['span', 'a', 'em', 'strong', 'b', 'i', 'u', 's', 'small', 'sup', 'sub', 'abbr', 'time', 'mark', 'q', 'cite', 'code', 'kbd', 'br', 'wbr', 'bdi', 'bdo', 'tspan', 'textPath']);
const ATTRS = ['alt', 'aria-label', 'title', 'src', 'href', 'role'];

const tagOf = (el: ElLike) => el.tagName.toLowerCase();
const isRoot = (el: ElLike) => ['html', 'body'].includes(tagOf(el));

/** CSS.escape for identifiers, without a browser. */
export function cssIdent(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const code = s.charCodeAt(i);
    if (/[A-Za-z_\-\u00a0-\uffff]/.test(c) || (/[0-9]/.test(c) && i > 0 && !(i === 1 && s[0] === '-'))) out += c;
    else if (/[0-9]/.test(c)) out += `\\${code.toString(16)} `;
    else out += `\\${c}`;
  }
  return out;
}

const quote = (v: string) => `"${v.replace(/["\\]/g, (m) => `\\${m}`)}"`;

/** Text with its white space folded, shortened to n characters. */
export function excerpt(s: string | null | undefined, n = 300): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function anchorOf(el: ElLike): string | null {
  for (const a of ANCHORS) {
    const v = el.getAttribute(`data-${a}`);
    if (v && v.length <= 120) return `[data-${a}=${quote(v)}]`;
  }
  return null;
}

const stableId = (id: string) => /^[A-Za-z][\w-]{0,80}$/.test(id) && !/\d{4,}/.test(id);

function segment(el: ElLike): { sel: string; stop: boolean } {
  const tag = tagOf(el);
  if (el.id && stableId(el.id)) return { sel: `#${cssIdent(el.id)}`, stop: true };
  const anchor = anchorOf(el);
  let sel = tag + (anchor ?? '');
  const parent = el.parentElement;
  if (parent) {
    const same = Array.from(parent.children).filter((c) => tagOf(c) === tag);
    const twins = anchor ? same.filter((c) => anchorOf(c) === anchor) : same;
    if (twins.length > 1) sel += `:nth-of-type(${same.indexOf(el) + 1})`;
  }
  return { sel, stop: false };
}

/** A CSS path from the nearest stable id (or the body) down to el. */
export function cssPath(el: ElLike): string {
  const parts: string[] = [];
  let at: ElLike | null = el;
  while (at && !isRoot(at)) {
    const { sel, stop } = segment(at);
    parts.unshift(sel);
    if (stop) return parts.join(' > ');
    at = at.parentElement;
  }
  return ['body', ...parts].join(' > ');
}

/** The data-* ids on el and its ancestors, the nearest one of each name. */
export function dataIds(el: ElLike): Record<string, string> {
  const out: Record<string, string> = {};
  for (let at: ElLike | null = el; at && !isRoot(at); at = at.parentElement) {
    for (const { name, value } of Array.from(at.attributes)) {
      if (!name.startsWith('data-')) continue;
      const k = name.slice(5);
      if (k.startsWith('rv') || STATE.has(k) || k in out || !value || value.length > 120) continue;
      out[k] = value;
    }
  }
  return out;
}

/** What a reader would call the thing tapped: inline bits stand for their block. */
export function pickable<E extends ElLike>(el: E, inline: (el: E) => boolean = (e) => INLINE.has(e.tagName) || INLINE.has(tagOf(e))): E {
  let at = el;
  while (inline(at)) {
    if (!at.parentElement || isRoot(at.parentElement)) break;
    at = at.parentElement as E;
  }
  return at;
}

/** Everything a note keeps about its element, except where it is on screen. */
export function describe(el: ElLike): Target {
  const attrs: Record<string, string> = {};
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v) attrs[a] = v.slice(0, 400);
  }
  const classes = (el.getAttribute('class') ?? '').split(/\s+/).filter((c) => c && !c.startsWith('rv-'));
  return { css: cssPath(el), tag: tagOf(el), data: dataIds(el), attrs, classes, text: excerpt(el.textContent) };
}

/** The selected text with what stands before and after it in its block. */
export function around(full: string, start: number, end: number, n = 80): { text: string; before: string; after: string } {
  return {
    text: excerpt(full.slice(start, end), 4000),
    before: excerpt(full.slice(Math.max(0, start - n), start).replace(/^\S*\s/, ''), n),
    after: excerpt(full.slice(end, end + n).replace(/\s\S*$/, ''), n),
  };
}

/** The page a hash names: the museum itself, a feature, or another view. */
export function pageOf(hash: string): PageInfo {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const view = p.get('view') ?? undefined;
  const item = p.get('item') ?? undefined;
  const key = !view ? 'museum' : item ? `${view}:${item}` : view;
  return { key, view, item, scene: p.get('scene') ?? undefined, chapter: p.get('ch') ?? undefined };
}

/** phone | tablet | desktop, from the screen and the pointer. */
export function deviceKind(width: number, height: number, coarse: boolean): 'phone' | 'tablet' | 'desktop' {
  if (!coarse) return 'desktop';
  return Math.min(width, height) < 600 ? 'phone' : 'tablet';
}

interface Finder<E> {
  querySelector(sel: string): E | null;
  querySelectorAll(sel: string): ArrayLike<E>;
}

/** Find a note's element again: by its path, else by its ids and text. */
export function resolve<E extends ElLike>(t: Target, root: Finder<E>): E | null {
  const head = excerpt(t.text, 40).replace(/…$/, '');
  const fits = (el: E) => !head || excerpt(el.textContent, 400).startsWith(head);
  try {
    const el = root.querySelector(t.css);
    if (el && fits(el)) return el;
  } catch {
    /* a path that is no longer valid CSS */
  }
  // The data ids are kept nearest first: the first anchor is the closest one.
  const near = Object.keys(t.data ?? {}).find((k) => ANCHORS.includes(k));
  if (!near || !head) return null;
  const id = `[data-${near}=${quote(t.data![near])}]`;
  try {
    for (const el of Array.from(root.querySelectorAll(`${cssIdent(t.tag)}${id}, ${id} ${cssIdent(t.tag)}`))) if (fits(el)) return el;
  } catch {
    /* ignore */
  }
  return null;
}
