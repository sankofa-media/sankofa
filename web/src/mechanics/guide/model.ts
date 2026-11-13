// The guide and the dedication are Markdown files in content/. They are
// turned into a few plain blocks at build time and rendered without HTML.

export type Inline = { t: 'text'; s: string } | { t: 'em'; s: string } | { t: 'strong'; s: string } | { t: 'link'; s: string; href: string } | { t: 'unseen'; s: string };
export type Block = { type: 'h2' | 'h3' | 'p'; inline: Inline[] } | { type: 'quote'; inline: Inline[] };

export interface ProseDoc {
  title?: string;
  blocks: Block[];
}

export interface ProseFile {
  version: 1;
  en?: ProseDoc;
  ru?: ProseDoc;
}

/** Front matter: only `title:` is read. */
function frontMatter(src: string): { title?: string; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  if (!m) return { body: src };
  const t = /^title:\s*(.+)$/m.exec(m[1]);
  const title = t?.[1].trim().replace(/^(["'])(.*)\1$/, '$2');
  return { title, body: src.slice(m[0].length) };
}

/** Raw HTML is not rendered: tags are dropped and their text kept. */
const stripTags = (s: string) => s.replace(/<\/?[a-zA-Z][^>]*>/g, '');

/**
 * Inline Markdown: *em*, **strong**, [text](href). The one piece of HTML let
 * through is <span class="unseen">…</span>; any other tag is removed.
 */
export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  const parts = s.split(/<span class="unseen">([\s\S]*?)<\/span>/);
  parts.forEach((part, i) => {
    if (i % 2) {
      const text = stripTags(part);
      if (text) out.push({ t: 'unseen', s: text });
    } else out.push(...markdown(stripTags(part)));
  });
  return out;
}

function markdown(s: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > last) out.push({ t: 'text', s: s.slice(last, m.index) });
    if (m[1]) out.push({ t: 'strong', s: m[1] });
    else if (m[2] ?? m[3]) out.push({ t: 'em', s: (m[2] ?? m[3])! });
    else out.push({ t: 'link', s: m[4], href: m[5] });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ t: 'text', s: s.slice(last) });
  return out;
}

export function parseProse(src: string): ProseDoc {
  const { title, body } = frontMatter(src.replace(/\r\n/g, '\n'));
  const blocks: Block[] = [];
  let h1: string | undefined;
  for (const para of body.split(/\n\s*\n/)) {
    const p = para.trim();
    if (!p) continue;
    const head = /^(#{1,3})\s+(.*)$/.exec(p);
    if (head && !p.includes('\n')) {
      if (head[1] === '#') h1 ??= head[2].trim();
      else blocks.push({ type: head[1] === '##' ? 'h2' : 'h3', inline: parseInline(head[2].trim()) });
      continue;
    }
    if (p.startsWith('>')) {
      blocks.push({ type: 'quote', inline: parseInline(p.replace(/^>\s?/gm, '').replace(/\s*\n\s*/g, ' ')) });
      continue;
    }
    blocks.push({ type: 'p', inline: parseInline(p.replace(/\s*\n\s*/g, ' ')) });
  }
  return { title: title ?? h1, blocks };
}

/**
 * Fill {{name}} with a value computed at run time, so numbers in the prose
 * stay true as the collection grows. Unknown names are left as they are.
 */
export function fill(s: string, values: Record<string, string>): string {
  return s.replace(/\{\{(\w+)\}\}/g, (all, k: string) => values[k] ?? all);
}
