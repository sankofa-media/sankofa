// "Document on the desk": a primary document whose lines light up on the scan
// as the reader scrolls. The data comes from content/documents/*.yaml.

export type Box = [x: number, y: number, w: number, h: number];
export interface Text2 {
  en: string;
  ru: string;
}

export interface DocLine {
  page: number;
  boxes: Box[];
  /** As printed. */
  text: string;
  /** Russian translation. */
  ru: string;
  /** One sentence of context, drawn from the card. */
  note: Text2;
}

export interface DocPage {
  file: string;
  label: Text2;
  width: number;
  height: number;
}

export interface Doc {
  id: string;
  card: string;
  title: Text2;
  imprint: Text2;
  source: { title: string; url: string; scan?: string; license: string };
  pages: DocPage[];
  lines: DocLine[];
}

export interface DocsFile {
  version: 1;
  documents: Doc[];
}

/** Problems with a document as written, for the build to refuse it. */
export function validateDoc(d: Partial<Doc>, ctx: { cards: Set<string>; media: Set<string>; rights: Set<string> }): string[] {
  const errs: string[] = [];
  const at = `document ${d.id ?? '?'}`;
  if (!d.id) errs.push(`${at}: no id`);
  if (!d.card || !ctx.cards.has(d.card)) errs.push(`${at}: card ${d.card} does not exist`);
  if (!d.title?.en || !d.title?.ru) errs.push(`${at}: title needs en and ru`);
  if (!d.source?.url || !d.source?.license) errs.push(`${at}: source needs url and license`);
  if (!d.pages?.length) errs.push(`${at}: no pages`);
  for (const p of d.pages ?? []) {
    if (!ctx.media.has(p.file)) errs.push(`${at}: ${p.file} is not in content/media`);
    if (!ctx.rights.has(p.file)) errs.push(`${at}: ${p.file} has no rights entry in the media ledger`);
  }
  (d.lines ?? []).forEach((l, i) => {
    const li = `${at}, line ${i + 1}`;
    if (!d.pages?.[l.page]) errs.push(`${li}: page ${l.page} does not exist`);
    if (!l.text || !l.ru || !l.note?.en || !l.note?.ru) errs.push(`${li}: needs text, ru and note.en/ru`);
    if (!l.boxes?.length) errs.push(`${li}: no boxes`);
    for (const b of l.boxes ?? []) {
      const [x, y, w, h] = b;
      if (b.length !== 4 || [x, y, w, h].some((v) => typeof v !== 'number' || v < 0 || v > 1) || x + w > 1.0001 || y + h > 1.0001 || w <= 0 || h <= 0) errs.push(`${li}: box ${JSON.stringify(b)} is not inside the page`);
    }
  });
  if (!d.lines?.length) errs.push(`${at}: no lines`);
  return errs;
}

/** The smallest box around several boxes. */
export function union(boxes: Box[]): Box {
  const x0 = Math.min(...boxes.map((b) => b[0]));
  const y0 = Math.min(...boxes.map((b) => b[1]));
  const x1 = Math.max(...boxes.map((b) => b[0] + b[2]));
  const y1 = Math.max(...boxes.map((b) => b[1] + b[3]));
  return [x0, y0, x1 - x0, y1 - y0];
}

/**
 * Which note is being read: the last one whose top has passed the reading
 * line. `tops` are the notes' top edges in viewport pixels, in order.
 */
export function activeIndex(tops: number[], line: number): number {
  let at = 0;
  tops.forEach((t, i) => {
    if (t <= line) at = i;
  });
  return at;
}

/**
 * How to move a page inside a window so a region fills it: the scale and the
 * translation (in window pixels) for `transform: translate() scale()` with the
 * origin at the top left. The page is `pw`×`ph` at scale 1; the window is
 * `vw`×`vh`. The scale is capped so a line is magnified, not blown up, and
 * the page never leaves a gap at an edge.
 */
export function focusTransform(region: Box, pw: number, ph: number, vw: number, vh: number, maxScale = 2.4): { scale: number; x: number; y: number } {
  const [rx, ry, rw, rh] = region;
  const fit = Math.min(vw / (rw * pw * 1.15), vh / (rh * ph * 2.2));
  const base = Math.max(vw / pw, vh / ph);
  const scale = Math.max(base, Math.min(maxScale, fit));
  const cx = (rx + rw / 2) * pw * scale;
  const cy = (ry + rh / 2) * ph * scale;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const x = clamp(vw / 2 - cx, vw - pw * scale, 0);
  const y = clamp(vh / 2 - cy, vh - ph * scale, 0);
  return { scale, x, y };
}
