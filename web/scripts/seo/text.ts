// Plain-text and HTML helpers for the pages the build writes for search
// engines and AI assistants. Nothing here rewrites the museum's words: it
// escapes them, turns [[id|words]] into links and cuts a description at a
// word boundary.
import { segments } from '../../src/lib/links.ts';

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Text with [[id|words]] as plain words. */
export function plain(s: string): string {
  return segments(s)
    .map((x) => x.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Text with [[id|words]] as HTML links to the card pages that exist; the rest
 * escaped. `href(id)` returns the card's path, or undefined for a card that
 * has no page.
 */
export function linked(s: string, href: (id: string) => string | undefined): string {
  return segments(s)
    .map((x) => {
      if (!('target' in x)) return esc(x.text);
      const to = href(x.target);
      return to ? `<a href="${esc(to)}">${esc(x.text)}</a>` : esc(x.text);
    })
    .join('');
}

/** Text with [[id|words]] as Markdown links (for llms-full.txt). */
export function markdown(s: string, href: (id: string) => string | undefined): string {
  return segments(s)
    .map((x) => {
      if (!('target' in x)) return x.text;
      const to = href(x.target);
      return to ? `[${x.text}](${to})` : x.text;
    })
    .join('');
}

/**
 * A description of at most `max` characters: the whole text when it fits,
 * else as many whole sentences as fit, else cut at a word and marked with an
 * ellipsis.
 */
export function describe(text: string, max = 160): string {
  const t = plain(text);
  if (t.length <= max) return t;
  const sentences = t.match(/[^.!?…]+[.!?…]+["»”’)]*\s*/g) ?? [];
  let out = '';
  for (const s of sentences) {
    if ((out + s).trim().length > max) break;
    out += s;
  }
  if (out.trim().length >= max * 0.4) return out.trim();
  const cut = t.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return (at > max * 0.5 ? cut.slice(0, at) : cut).replace(/[\s,;:—–-]+$/, '') + '…';
}

/** Paragraphs of a card body or a Markdown-ish text. */
export function paragraphs(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** JSON for a <script type="application/ld+json">: nothing in it can close the tag. */
export function jsonForScript(v: unknown): string {
  return JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}
