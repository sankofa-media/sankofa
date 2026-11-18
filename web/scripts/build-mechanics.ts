// Data for the museum's documents, working objects, "How we checked", the
// guide and the dedication, built from the content repository:
//   data/documents.json  content/documents/*.yaml (+ page sizes, rights checked)
//   data/objects.json    content/objects.yaml
//   data/checks.json     content/ledger/* joined per card, with totals
//   data/guide.json      content/guide.md, content/guide.ru.md
//   data/dedication.json content/dedication.md / .ru.md (absent: no file)
//   data/cabinet.json    content/cabinet/*.yaml, facts from ledger/cabinet.yaml,
//                        image rights from ledger/media-cabinet.yaml (or media.yaml)
// Usage: node scripts/build-mechanics.ts <content-dir> <data-dir>
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { buildChecks, pairContext, type ContextRound, type Ledgers, type MediaEntry } from '../src/mechanics/checks/model.ts';
import { validateDoc, type Doc } from '../src/mechanics/docs/model.ts';
import { LABEL_FIELDS, parsePattern, validateLabel, type ObjectLabel, type ObjectsFile } from '../src/mechanics/objects/model.ts';
import { cardLinks, parseProse, type ProseFile } from '../src/mechanics/guide/model.ts';
import { validateCabinet, wordHash, type CabinetFile, type Fact, type L } from '../src/mechanics/cabinet/model.ts';

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

// The Workshop's objects: each an element of music, with its label.
const objSrc = yaml<Record<string, Record<string, unknown>>>(join(src, 'objects.yaml'), {});
const objects: ObjectsFile = { version: 1 };
const elementIds = new Set(yaml<{ elements?: { id: string }[] }>(join(src, 'roots', 'elements.yaml'), {}).elements?.map((e) => e.id) ?? []);
const raw = (id: string) => (existsSync(join(src, 'cards', id + '.md')) ? read(join(src, 'cards', id + '.md')) : '');
const intro = objSrc.intro as { en?: string; ru?: string } | undefined;
if (intro) {
  if (!intro.en?.trim() || !intro.ru?.trim()) errors.push('objects.yaml: intro needs English and Russian');
  else objects.intro = { en: intro.en.trim(), ru: intro.ru.trim() };
}
/** The label of an object, checked; undefined (with errors noted) when it is broken. */
const label = (key: string): ObjectLabel | undefined => {
  const o = objSrc[key] as Partial<ObjectLabel> | undefined;
  const errs = validateLabel(key, o, { cards, elements: elementIds });
  if (errs.length) {
    errors.push(...errs.map((e) => `objects.yaml: ${e}`));
    return undefined;
  }
  const out = { elements: o!.elements!, cards: o!.cards! } as ObjectLabel;
  for (const f of LABEL_FIELDS) out[f] = { en: o![f]!.en.trim(), ru: o![f]!.ru.trim() };
  return out;
};
if (objSrc.gramophone) {
  const g = objSrc.gramophone as { card: string; audio: string; rpm?: number };
  const l = label('gramophone');
  if (!cards.has(g.card)) errors.push(`objects.yaml: gramophone card ${g.card} does not exist`);
  else if (!media.has(g.audio)) errors.push(`objects.yaml: ${g.audio} is not in content/media`);
  else if (!raw(g.card).includes(`"${g.audio}"`)) errors.push(`objects.yaml: ${g.audio} is not among the media of card ${g.card}`);
  else if (l) objects.gramophone = { card: g.card, audio: g.audio, rpm: g.rpm ?? 78, ...l };
}
for (const key of ['tr808', 'amen', 'clave'] as const) {
  const o = objSrc[key] as { card: string; tempo: number; pattern: Record<string, string> } | undefined;
  if (!o) continue;
  if (!cards.has(o.card)) {
    errors.push(`objects.yaml: ${key} card ${o.card} does not exist`);
    continue;
  }
  const l = label(key);
  try {
    const pattern = parsePattern(o.pattern);
    // The Amen break's recording is the card's entry in listen.yaml; a `youtube` copy here is ignored.
    if (l) objects[key] = { card: o.card, tempo: o.tempo, pattern, ...l };
  } catch (e) {
    errors.push(`objects.yaml: ${key}: ${(e as Error).message}`);
  }
}
if (objSrc.call) {
  const c = objSrc.call as { card: string };
  const l = label('call');
  if (!cards.has(c.card)) errors.push(`objects.yaml: call card ${c.card} does not exist`);
  else if (l) objects.call = { card: c.card, ...l };
}

// The Cabinet of Curiosities. Every image needs a rights record whose checksum
// matches the file; every text its facts in the ledger; every hiding place
// must exist, down to the words a cache is hidden in.
const cabDir = join(src, 'cabinet');
let cabinet: CabinetFile | null = null;
if (existsSync(join(cabDir, 'cabinet.yaml'))) {
  const base = yaml<Partial<CabinetFile>>(join(cabDir, 'cabinet.yaml'), {});
  cabinet = {
    version: 1,
    intro: base.intro!,
    drawers: base.drawers ?? [],
    keys: base.keys ?? [],
    caches: yaml<{ caches?: CabinetFile['caches'] }>(join(cabDir, 'caches.yaml'), {}).caches ?? [],
    artifacts: yaml<{ artifacts?: CabinetFile['artifacts'] }>(join(cabDir, 'artifacts.yaml'), {}).artifacts ?? [],
  };
  const cabRights = new Set<string>();
  const cabLedger = yaml<MediaEntry[]>(join(ledger, 'media-cabinet.yaml'), []);
  for (const e of [...cabLedger, ...mediaLedger]) {
    const fp = join(mediaDir, e.file);
    if (!existsSync(fp)) continue;
    if (!e.url || !e.license || !e.license_wording || !e.sha256) {
      if (cabLedger.includes(e)) errors.push(`media-cabinet.yaml: ${e.file} needs url, license, license_wording and sha256`);
      continue;
    }
    const sum = createHash('sha256').update(readFileSync(fp)).digest('hex');
    if (e.sha256 === sum) cabRights.add(e.file);
    else if (cabLedger.includes(e)) errors.push(`media-cabinet.yaml: ${e.file} sha256 is ${sum}, the ledger says ${e.sha256}`);
  }
  const facts = yaml<Fact[]>(join(ledger, 'cabinet.yaml'), []);
  // The other places caches hide in: the factoids the museum shows, the
  // countries' headers in the atlas.
  const factoidText = new Map<string, L>();
  const fxDir = join(src, 'factoids');
  for (const f of existsSync(fxDir) ? readdirSync(fxDir).filter((x) => x.endsWith('.yaml')) : [])
    for (const x of yaml<{ id: string; status?: string; en?: string; ru?: string }[]>(join(fxDir, f), []))
      if (x?.status === 'checked' && x.en && x.ru) factoidText.set(x.id, { en: x.en, ru: x.ru });
  const countryText = new Map<string, L>();
  for (const c of yaml<{ countries?: { id: string; about?: L }[] }>(join(src, 'countries.yaml'), {}).countries ?? []) if (c.about?.en && c.about.ru) countryText.set(c.id, c.about);
  const body = (p: string) => (existsSync(p) ? read(p).replace(/^---\n[\s\S]*?\n---\n/, '') : '');
  const errs = validateCabinet(cabinet, {
    cards,
    chapters: new Set(existsSync(join(src, 'chapters')) ? readdirSync(join(src, 'chapters')).filter((f) => /^[a-z0-9-]+\.md$/.test(f)).map((f) => f.replace(/\.md$/, '')) : []),
    objects: new Set(Object.keys(objects).filter((k) => k !== 'version' && k !== 'intro')),
    media,
    rights: cabRights,
    text: (kind, id, l) => body(join(src, kind === 'card' ? 'cards' : 'chapters', `${id}${l === 'ru' ? '.ru' : ''}.md`)),
    facts,
    edition: (id) => (existsSync(join(src, 'cards', `${id}.md`)) ? /^edition:\s*(\w+)/m.exec(read(join(src, 'cards', `${id}.md`)))?.[1] : undefined),
    factoid: (id) => factoidText.get(id) ?? null,
    country: (id) => countryText.get(id) ?? null,
    roots: (id) => {
      const a = yaml<{ story?: string; storyRu?: string } | null>(join(src, 'roots', `${id}.yaml`), null);
      return a?.story && a.storyRu ? { en: a.story, ru: a.storyRu } : null;
    },
    feature: (id, scene, block) => {
      const ft = yaml<{ scenes?: { id: string; blocks?: ({ id: string; hold?: boolean } & Partial<L>)[] }[] } | null>(join(src, 'features', id, 'feature.yaml'), null);
      const b = ft?.scenes?.find((x) => x.id === scene)?.blocks?.find((x) => x.id === block);
      return b && !b.hold && b.en && b.ru ? { en: b.en, ru: b.ru } : null;
    },
  });
  errors.push(...errs.map((e) => `cabinet: ${e}`));
  // What the reader sees: sizes of the pictures, and the sources behind each text.
  const sources: Record<string, { title: string; url: string }[]> = {};
  for (const f of facts)
    for (const x of f.sources) {
      if (!x.url || x.url.startsWith('card:')) continue;
      const list = (sources[f.id] ??= []);
      if (!list.some((y) => y.url === x.url)) list.push({ title: x.title, url: x.url });
    }
  cabinet.sources = sources;
  // A lock word stays in the content; the page gets only its hash.
  cabinet.caches = cabinet.caches.map((c) => (c.hidden?.at === 'cluster' ? { ...c, hidden: { at: 'cluster', via: c.hidden.via, ...(c.hidden.card ? { card: c.hidden.card } : {}), hash: wordHash(c.hidden.word ?? '') } } : c));
  cabinet.artifacts = cabinet.artifacts.map((a) => {
    let size = {};
    try {
      size = jpegSize(join(mediaDir, a.image));
    } catch {
      /* reported above when the file is missing */
    }
    return { ...a, ...size, sources: sources[`artifact:${a.id}`] ?? [] };
  });
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
write('documents.json', { version: 1, documents });
write('objects.json', objects);
if (cabinet) write('cabinet.json', cabinet);
else rmSync(join(out, 'cabinet.json'), { force: true });

// How we checked. The context rewrite: every context-<x>.yaml (the writer's
// facts with sources) beside its context-<x>-check.yaml (the second check).
const context: ContextRound[] = (existsSync(ledger) ? readdirSync(ledger) : [])
  .filter((f) => /^context-[a-z0-9]+\.yaml$/.test(f) && existsSync(join(ledger, f.replace(/\.yaml$/, '-check.yaml'))))
  .sort()
  .map((f) => ({ facts: yaml(join(ledger, f), []), check: yaml(join(ledger, f.replace(/\.yaml$/, '-check.yaml')), []) }));
for (const [i, round] of context.entries()) {
  const unchecked = pairContext(round).pairs.filter((p) => !p.check);
  for (const p of unchecked) console.warn(`ledger: context round ${i + 1}: no second check for ${p.fact.card}: ${p.fact.fact.slice(0, 80)}`);
}
// The new cards: every expand-<batch>.yaml beside its expand-<batch>-check.yaml.
const expansion: ContextRound[] = (existsSync(ledger) ? readdirSync(ledger) : [])
  .filter((f) => /^expand-[a-z0-9]+\.yaml$/.test(f) && existsSync(join(ledger, f.replace(/\.yaml$/, '-check.yaml'))))
  .sort()
  .map((f) => ({ facts: yaml(join(ledger, f), []), check: yaml(join(ledger, f.replace(/\.yaml$/, '-check.yaml')), []) }));
for (const f of (existsSync(ledger) ? readdirSync(ledger) : []).filter((f) => /^expand-[a-z0-9]+\.yaml$/.test(f))) {
  if (!existsSync(join(ledger, f.replace(/\.yaml$/, '-check.yaml')))) console.warn(`ledger: ${f} has no second check`);
}
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
  expansion,
  context,
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
  for (const [l, doc] of Object.entries(p ?? {})) {
    if (typeof doc !== 'object') continue;
    const bad = cardLinks(doc).filter((id) => !cards.has(id));
    if (bad.length) {
      console.error(`${base}${l === 'ru' ? '.ru' : ''}.md: links to unknown cards: ${bad.join(', ')}`);
      process.exit(1);
    }
    // The dedication stays as it was written: no links in it.
    if (base === 'dedication' && cardLinks(doc).length) {
      console.error(`${base}${l === 'ru' ? '.ru' : ''}.md: the dedication carries no card links`);
      process.exit(1);
    }
  }
  if (p) write(`${base}.json`, p);
  else rmSync(join(out, `${base}.json`), { force: true });
}

console.log(`${documents.length} documents, ${cabinet ? `${cabinet.caches.length} caches with ${cabinet.artifacts.length} artifacts, ` : ''}${Object.keys(objects).filter((k) => k !== "version" && k !== "intro").length} objects, checks for ${checks.totals.cards} cards (${checks.totals.facts} facts, ${checks.totals.context.kept} from the context rewrite) -> ${out}`);
