// The guide and the dedication are Markdown files in content/. They are
// turned into a few plain blocks at build time and rendered without HTML.

export type Inline =
  | { t: 'text'; s: string }
  | { t: 'em'; s: string }
  | { t: 'strong'; s: string }
  | { t: 'link'; s: string; href: string }
  | { t: 'unseen'; s: string }
  /** [[id|words]]: a link to a card of the dictionary */
  | { t: 'card'; s: string; id: string; em?: boolean };
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
 * Inline Markdown: *em*, **strong**, [text](href), and card links as in the
 * cards, [[id|words]]. The one piece of HTML let
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
  const re = /\[\[([a-z0-9-]+)(?:\|([^\]]+))?\]\]|\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > last) out.push({ t: 'text', s: s.slice(last, m.index) });
    if (m[1]) out.push({ t: 'card', id: m[1], s: m[2] ?? m[1] });
    else if (m[3]) out.push({ t: 'strong', s: m[3] });
    else if (m[4] ?? m[5]) {
      // *[[id|A Title]]*: a link to a card whose name is set in italics.
      const card = /^\[\[([a-z0-9-]+)(?:\|([^\]]+))?\]\]$/.exec((m[4] ?? m[5])!);
      out.push(card ? { t: 'card', id: card[1], s: card[2] ?? card[1], em: true } : { t: 'em', s: (m[4] ?? m[5])! });
    }
    else out.push({ t: 'link', s: m[6], href: m[7] });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ t: 'text', s: s.slice(last) });
  return out;
}

/** The cards a document links to. */
export function cardLinks(doc: ProseDoc): string[] {
  return doc.blocks.flatMap((b) => b.inline.flatMap((x) => (x.t === 'card' ? [x.id] : [])));
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
