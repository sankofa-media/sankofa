// The dictionary's names (data/names.json) and the report of its gaps.
//
//   data/names.json   every card's names in English and Russian, from the
//                     titles, `inline` names and content/aliases.yaml; the
//                     museum links mentions of them (src/lib/names.ts)
//   dist/link-gaps.txt  mentions of cards that are not linked in authored text
//                     (chapters, the guide, the cover, card bodies), and words
//                     that look like a card's name but match none of its names
//
// Usage: node scripts/build-names.ts <content-dir> <data-dir> <index.html> [<report>]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import YAML from 'yaml';
import { buildNames, compileLexicon, linkSegments, unlinked, type AliasesFile, type Lexicon, type NameLang, type NameSource } from '../src/lib/names.ts';
import { links } from '../src/lib/links.ts';

const [src, out, indexHtml, reportPath = 'dist/link-gaps.txt'] = process.argv.slice(2);
if (!src || !out || !indexHtml) {
  console.error('usage: build-names.ts <content-dir> <data-dir> <index.html> [<report>]');
  process.exit(2);
}
const read = (p: string) => readFileSync(p, 'utf8');
const cards = (JSON.parse(read(join(out, 'cards.json'))) as { cards: (NameSource & { body: string; translations?: Record<string, { title?: string; inline?: string; body?: string }> })[] }).cards;
const ids = new Set(cards.map((c) => c.id));
const aliasPath = join(src, 'aliases.yaml');
const aliases = (existsSync(aliasPath) ? YAML.parse(read(aliasPath)) : {}) as AliasesFile;
const errors: string[] = [];
for (const [id, a] of Object.entries(aliases.aliases ?? {})) {
  if (!ids.has(id)) errors.push(`aliases.yaml: no card ${id}`);
  for (const l of ['en', 'ru'] as const) for (const n of a?.[l] ?? []) if (typeof n !== 'string' || !n.trim()) errors.push(`aliases.yaml: ${id}.${l}: ${JSON.stringify(n)} is not a name (quote it)`);
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
const { file, ambiguous } = buildNames(cards, aliases);
writeFileSync(join(out, 'names.json'), JSON.stringify(file));
const lex: Record<NameLang, Lexicon> = { en: compileLexicon(file.en, 'en'), ru: compileLexicon(file.ru, 'ru') };

// --- the report ---

type Gap = { where: string; id: string; text: string };
const gaps: Record<string, Gap[]> = { chapters: [], guide: [], cover: [], cards: [], woven: [] };
const near: { where: string; phrase: string; ids: string[] }[] = [];
const paragraphs = (body: string) => body.split(/\n\s*\n/).map((p) => p.trim().replace(/^\{(?:male|female)\}\s+/, '').replace(/^\{at [^}]*\}\s*/, '')).filter(Boolean);
const bodyOf = (md: string) => md.replace(/^---\n[\s\S]*?\n---\n?/, '');

// Words of every title, to recognise a name the lexicon does not know.
const titleWords = new Map<string, Set<string>>();
for (const c of cards)
  for (const t of [c.title, c.translations?.ru?.title ?? '']) for (const w of t.match(/\p{Lu}[\p{L}'’-]+/gu) ?? []) (titleWords.get(w) ?? titleWords.set(w, new Set()).get(w)!).add(c.id);
const STOP = new Set(['The', 'A', 'An', 'In', 'On', 'At', 'Of', 'And', 'But', 'For', 'His', 'Her', 'Its', 'This', 'That', 'When', 'Black', 'African', 'American', 'Africa', 'America', 'Europe', 'British', 'French', 'New', 'Saint', 'King', 'Queen', 'Empire', 'House', 'Church', 'Великий', 'Как', 'Чёрный', 'Африка', 'Америка', 'Европа', 'Новый']);
/** Capitalised words outside links that belong to some title but match no name. */
function nearMisses(where: string, text: string, l: NameLang): void {
  const linked = linkSegments(text, lex[l]);
  for (const s of linked) {
    if ('target' in s) continue;
    for (const m of s.text.matchAll(/(?<![\p{L}.!?]\s|^)(\p{Lu}[\p{L}'’-]{3,})/gu)) {
      const w = m[1].replace(/['’]s$/, '');
      if (STOP.has(w)) continue;
      const owners = titleWords.get(w);
      if (owners && owners.size <= 3) near.push({ where, phrase: w, ids: [...owners].sort() });
    }
  }
}
function scan(group: string, where: string, text: string, l: NameLang, exclude?: Set<string>): void {
  for (const g of unlinked(text, lex[l], exclude)) gaps[group].push({ where, ...g });
  nearMisses(where, text, l);
}

const chDir = join(src, 'chapters');
for (const f of existsSync(chDir) ? readdirSync(chDir).filter((x) => x.endsWith('.md')).sort() : []) {
  const l: NameLang = f.endsWith('.ru.md') ? 'ru' : 'en';
  paragraphs(bodyOf(read(join(chDir, f)))).forEach((p, i) => scan('chapters', `${f} ¶${i + 1}`, p, l));
}
for (const [f, l] of [['guide.md', 'en'], ['guide.ru.md', 'ru']] as const) {
  if (!existsSync(join(src, f))) continue;
  paragraphs(bodyOf(read(join(src, f))))
    .filter((p) => !p.startsWith('#'))
    .forEach((p, i) => scan('guide', `${f} ¶${i + 1}`, p, l));
}
// The cover: a link there is an <a data-card="id">.
for (const m of read(indexHtml).matchAll(/<p[^>]*data-l="(en|ru)"[^>]*>([\s\S]*?)<\/p>/g)) {
  const l = m[1] as NameLang;
  const marked = [...m[2].matchAll(/data-card="([a-z0-9-]+)"/g)].map((x) => x[1]);
  const text = m[2].replace(/<[^>]+>/g, '') + marked.map((id) => ` [[${id}]]`).join('');
  scan('cover', `index.html (${l})`, text, l);
}
for (const c of cards) {
  const self = new Set([c.id]);
  paragraphs(c.body).forEach((p, i) => scan('cards', `${c.id}.md ¶${i + 1}`, p, 'en', self));
  const ru = c.translations?.ru?.body;
  if (ru) paragraphs(ru).forEach((p, i) => scan('cards', `${c.id}.ru.md ¶${i + 1}`, p, 'ru', self));
}
// Texts the museum links by itself when it shows them: every string under an
// `en`/`ru` key (or a field ending in Ru) of the Workshop, the cabinet, the
// documents, the country headers and the roots.
function strings(node: unknown, path: string, visit: (s: string, l: NameLang, where: string) => void, l: NameLang = 'en'): void {
  if (typeof node === 'string') return visit(node, l, path);
  if (Array.isArray(node)) return node.forEach((x, i) => strings(x, `${path}[${i}]`, visit, l));
  if (node && typeof node === 'object')
    for (const [k, v] of Object.entries(node)) {
      if (['id', 'card', 'cards', 'url', 'file', 'image', 'audio', 'href', 'sources', 'source', 'from', 'to', 'genres', 'elements', 'kind', 'at'].includes(k)) continue;
      strings(v, `${path}.${k}`, visit, k === 'ru' || /Ru$/.test(k) ? 'ru' : k === 'en' ? 'en' : l);
    }
}
const woven = [join(src, 'objects.yaml'), join(src, 'countries.yaml'), ...['cabinet', 'documents', 'roots'].flatMap((d) => (existsSync(join(src, d)) ? readdirSync(join(src, d)).filter((f) => f.endsWith('.yaml')).map((f) => join(src, d, f)) : []))];
let wovenLinks = 0;
for (const f of woven.filter(existsSync)) {
  const name = f.slice(src.length + 1);
  strings(YAML.parse(read(f)), name, (s, l, where) => {
    if (s.length < 12 || !/\s/.test(s)) return;
    for (const id of links(s)) if (!ids.has(id)) errors.push(`${where}: link to unknown card ${id}`);
    const found = unlinked(s, lex[l]);
    wovenLinks += found.length;
    for (const g of found) gaps.woven.push({ where, ...g });
    nearMisses(where, s, l);
  });
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

const lines: string[] = [];
const head = (s: string) => lines.push('', `== ${s}`);
head(`Unlinked mentions in authored text (add [[id|words]])`);
for (const g of ['cover', 'guide', 'chapters', 'cards'] as const) {
  lines.push(`-- ${g}: ${gaps[g].length}`);
  for (const x of gaps[g]) lines.push(`${x.where}: "${x.text}" -> [[${x.id}|${x.text}]]`);
}
head(`Mentions the museum links by itself (Workshop, cabinet, documents, countries, roots): ${gaps.woven.length}`);
for (const x of gaps.woven) lines.push(`${x.where}: "${x.text}" -> ${x.id}`);
const nearBy = new Map<string, { ids: string[]; n: number; where: string }>();
for (const x of near) {
  const k = x.phrase;
  const e = nearBy.get(k) ?? { ids: x.ids, n: 0, where: x.where };
  e.n++;
  nearBy.set(k, e);
}
const nearList = [...nearBy].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]));
head(`Words that look like a card's name but match none of its names (add an alias?): ${nearList.length}`);
for (const [w, e] of nearList) lines.push(`${w} ×${e.n} ~ ${e.ids.join(', ')} (first: ${e.where})`);
head(`Names two cards share, not linked automatically: ${ambiguous.length}`);
for (const a of ambiguous) lines.push(`${a.lang} "${a.name}": ${a.ids.join(', ')}`);
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, lines.join('\n').trim() + '\n');

const n = (l: NameLang) => Object.values(file[l]).reduce((s, x) => s + x.length, 0);
console.log(
  `names: ${n('en')} English and ${n('ru')} Russian names for ${Object.keys(file.en).length} cards -> ${join(out, 'names.json')}; ` +
    `unlinked: ${gaps.cover.length} on the cover, ${gaps.guide.length} in the guide, ${gaps.chapters.length} in chapters, ${gaps.cards.length} in cards; ` +
    `${wovenLinks} linked by the museum itself; ${nearList.length} near misses, ${ambiguous.length} shared names -> ${reportPath}`,
);
