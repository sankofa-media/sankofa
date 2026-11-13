// Data for the museum's documents, working objects, "How we checked", the
// guide and the dedication, built from the content repository:
//   data/documents.json  content/documents/*.yaml (+ page sizes, rights checked)
//   data/objects.json    content/objects.yaml
//   data/checks.json     content/ledger/* joined per card, with totals
//   data/guide.json      content/guide.md, content/guide.ru.md
//   data/dedication.json content/dedication.md / .ru.md (absent: no file)
// Usage: node scripts/build-mechanics.ts <content-dir> <data-dir>
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { buildChecks, type Ledgers, type MediaEntry } from '../src/mechanics/checks/model.ts';
import { validateDoc, type Doc } from '../src/mechanics/docs/model.ts';
import { parsePattern, type ObjectsFile } from '../src/mechanics/objects/model.ts';
import { parseProse, type ProseFile } from '../src/mechanics/guide/model.ts';

const [src, out] = process.argv.slice(2);
if (!src || !out) {
  console.error('usage: build-mechanics.ts <content-dir> <data-dir>');
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const read = (p: string) => readFileSync(p, 'utf8');
const yaml = <T>(p: string, fallback: T): T => (existsSync(p) ? ((YAML.parse(read(p)) as T) ?? fallback) : fallback);
const write = (name: string, data: unknown) => writeFileSync(join(out, name), JSON.stringify(data));

const cardFiles = existsSync(join(src, 'cards')) ? readdirSync(join(src, 'cards')).filter((f) => f.endsWith('.md') && !/\.[a-z]{2}\.md$/.test(f)) : [];
const cardIds = cardFiles.map((f) => f.replace(/\.md$/, ''));
const cards = new Set(cardIds);
const mediaDir = join(src, 'media');
const media = new Set(existsSync(mediaDir) ? readdirSync(mediaDir) : []);
const ledger = join(src, 'ledger');
const mediaLedger = yaml<MediaEntry[]>(join(ledger, 'media.yaml'), []);
const docLedger = yaml<MediaEntry[]>(join(ledger, 'media-documents.yaml'), []);

/** Width and height of a JPEG, from its first SOF marker. */
function jpegSize(file: string): { width: number; height: number } {
  const b = readFileSync(file);
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) throw new Error(`${file}: not a JPEG`);
    const marker = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  throw new Error(`${file}: no frame header`);
}

// Documents: every page must be a file in content/media with a rights entry
// whose checksum matches it, and every line must sit inside its page.
const errors: string[] = [];
const rights = new Set<string>();
for (const e of docLedger) {
  const f = join(mediaDir, e.file);
  if (!existsSync(f)) {
    errors.push(`media-documents.yaml: ${e.file} is missing`);
    continue;
  }
  const sum = createHash('sha256').update(readFileSync(f)).digest('hex');
  if (e.sha256 !== sum) errors.push(`media-documents.yaml: ${e.file} sha256 is ${sum}, the ledger says ${e.sha256}`);
  else if (!e.url || !e.license || !e.license_wording) errors.push(`media-documents.yaml: ${e.file} needs url, license and license_wording`);
  else rights.add(e.file);
}
const docDir = join(src, 'documents');
const documents: Doc[] = [];
for (const f of existsSync(docDir) ? readdirSync(docDir).filter((x) => x.endsWith('.yaml')).sort() : []) {
  const d = YAML.parse(read(join(docDir, f))) as Doc;
  const errs = validateDoc(d, { cards, media, rights });
  if (errs.length) {
    errors.push(...errs.map((e) => `${f}: ${e}`));
    continue;
  }
  d.pages = d.pages.map((p) => ({ ...p, ...jpegSize(join(mediaDir, p.file)) }));
  documents.push(d);
}

// Objects.
const objSrc = yaml<Record<string, Record<string, unknown>>>(join(src, 'objects.yaml'), {});
const objects: ObjectsFile = { version: 1 };
const raw = (id: string) => (existsSync(join(src, 'cards', id + '.md')) ? read(join(src, 'cards', id + '.md')) : '');
if (objSrc.gramophone) {
  const g = objSrc.gramophone as { card: string; audio: string; rpm?: number };
  if (!cards.has(g.card)) errors.push(`objects.yaml: gramophone card ${g.card} does not exist`);
  else if (!media.has(g.audio)) errors.push(`objects.yaml: ${g.audio} is not in content/media`);
  else if (!raw(g.card).includes(`"${g.audio}"`)) errors.push(`objects.yaml: ${g.audio} is not among the media of card ${g.card}`);
  else objects.gramophone = { card: g.card, audio: g.audio, rpm: g.rpm ?? 78 };
}
for (const key of ['tr808', 'amen'] as const) {
  const o = objSrc[key] as { card: string; tempo: number; pattern: Record<string, string> } | undefined;
  if (!o) continue;
  if (!cards.has(o.card)) {
    errors.push(`objects.yaml: ${key} card ${o.card} does not exist`);
    continue;
  }
  try {
    const pattern = parsePattern(o.pattern);
    if (key === 'tr808') objects.tr808 = { card: o.card, tempo: o.tempo, pattern };
    // Its recording is the card's entry in listen.yaml; a `youtube` copy here is ignored.
    else objects.amen = { card: o.card, tempo: o.tempo, pattern };
  } catch (e) {
    errors.push(`objects.yaml: ${key}: ${(e as Error).message}`);
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
write('documents.json', { version: 1, documents });
write('objects.json', objects);

// How we checked.
const ledgers: Ledgers = {
  final: yaml(join(ledger, 'final.yaml'), {}),
  match: yaml(join(ledger, 'match.yaml'), { claims: [] }),
  recheckA: yaml(join(ledger, 'recheck-codex-result.yaml'), []),
  recheckB: yaml(join(ledger, 'recheck-claude-result.yaml'), []),
  explainersNew: yaml(join(ledger, 'explainers-new.yaml'), {}),
  explainersCheck: yaml(join(ledger, 'explainers-check.yaml'), { claims: [] }),
  media: [...mediaLedger, ...docLedger],
  mediaCheck: yaml(join(ledger, 'media-check.yaml'), []),
  rootsCheck: yaml(join(ledger, 'roots-check.yaml'), {}),
  rootsDeepCheck: yaml(join(ledger, 'roots-deep-check.yaml'), {}),
};
const checks = buildChecks(ledgers, cardIds);
write('checks.json', checks);

// The guide and the dedication: Markdown, in English and Russian.
function prose(base: string): ProseFile | null {
  const en = join(src, `${base}.md`);
  const ru = join(src, `${base}.ru.md`);
  if (!existsSync(en) && !existsSync(ru)) return null;
  return { version: 1, ...(existsSync(en) ? { en: parseProse(read(en)) } : {}), ...(existsSync(ru) ? { ru: parseProse(read(ru)) } : {}) };
}
for (const base of ['guide', 'dedication']) {
  const p = prose(base);
  if (p) write(`${base}.json`, p);
  else rmSync(join(out, `${base}.json`), { force: true });
}

console.log(`${documents.length} documents, ${Object.keys(objects).length - 1} objects, checks for ${checks.totals.cards} cards (${checks.totals.facts} facts) -> ${out}`);
