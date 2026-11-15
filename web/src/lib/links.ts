// [[id]] and [[id|words]] cross-links, as written in cards, chapters and the
// guide. Dependency-free, so the build scripts can use it too.

// Same expression as pkg/card linkRe.
const LINK_RE = /\[\[([a-z0-9-]+)(?:\|([^\]]+))?\]\]/g;

export type Segment = { text: string } | { target: string; text: string; explicit: boolean };

/** Split text into plain runs and [[links]], in order. */
export function segments(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK_RE)) {
    const start = m.index ?? 0;
    if (start > last) out.push({ text: text.slice(last, start) });
    out.push({ target: m[1], text: m[2] ?? m[1], explicit: m[2] !== undefined });
    last = start + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

export function links(text: string): string[] {
  return [...text.matchAll(LINK_RE)].map((m) => m[1]);
}

export function plain(text: string): string {
  return text.replace(LINK_RE, (_, id: string, t?: string) => t ?? id);
}
