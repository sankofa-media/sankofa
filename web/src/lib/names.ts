// The dictionary's names: how each card can be mentioned in running text,
// in English and Russian, and a linker that turns the first mention of a
// card in a block of text into a link to it.
//
// Names come from three places: the card's title (with its parenthesis,
// article and subtitle taken off), its `inline` name, and the explicit list
// in content/aliases.yaml for names written differently. They are derived at
// build time (scripts/build-names.ts -> data/names.json) and compiled into
// one regular expression per language at run time. Russian names match their
// case forms: every Cyrillic word of a name takes the endings its own ending
// allows ("Сан Ра" also reads "Сана Ра", "Фредерик Дуглас" also "Фредерика
// Дугласа").
import { links, segments, type Segment } from './links.ts';

export type NameLang = 'en' | 'ru';

/** What the derivation needs to know of a card. */
export interface NameSource {
  id: string;
  kind: string;
  title: string;
  inline?: string;
  translations?: Record<string, { title?: string; inline?: string } | undefined>;
}

/** content/aliases.yaml */
export interface AliasesFile {
  /** Extra names per card and language; they win over derived ones. */
  aliases?: Record<string, { en?: string[]; ru?: string[] }>;
  /** Derived names never used for linking: common words, other places of the same name. */
  never?: { en?: string[]; ru?: string[] };
}

/** data/names.json: every card's names per language, longest first. */
export interface NamesFile {
  version: 1;
  en: Record<string, string[]>;
  ru: Record<string, string[]>;
}

/** Kinds whose names are common nouns ("jazz", "блюз") and read in either case. */
const COMMON_KINDS = new Set(['genre', 'language', 'instrument', 'script']);
/** Kinds whose single-word titles are too often an ordinary word to be guessed. */
const TITLE_KINDS = new Set(['work', 'media', 'comparison', 'myth']);
const MIN_DERIVED = 4;

const words = (s: string) => s.split(/\s+/).filter(Boolean);
const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();
const unquote = (s: string) => tidy(s.replace(/^["“«]+|["”»]+$/g, '').replace(/^["“«](.*)["”»]$/, '$1'));

/** The names a title and an inline name give, in one language. */
export function deriveNames(kind: string, title: string, inline: string | undefined, l: NameLang): string[] {
  const out = new Set<string>();
  const add = (s: string | undefined) => {
    if (!s) return;
    let n = unquote(s.replace(/\s*\([^)]*\)\s*$/, ''));
    if (l === 'en') n = n.replace(/^(?:the|The) /, '');
    n = n.replace(/[.,:;!?]+$/, '');
    if (n.length < MIN_DERIVED || !/^\p{L}/u.test(n)) return;
    if (TITLE_KINDS.has(kind) && words(n).length === 1 && !inline) return;
    out.add(n);
    if (COMMON_KINDS.has(kind) && /^\p{Lu}\p{Ll}/u.test(n)) out.add(n[0].toLowerCase() + n.slice(1));
  };
  const full = unquote(title);
  add(full);
  const bare = full.replace(/\s*\([^)]*\)\s*$/, '');
  // "Ajami: African languages in Arabic letters" -> "Ajami".
  const colon = bare.split(/:\s+/);
  if (colon.length > 1) add(colon[0]);
  // "Kara Walker, A Subtlety" names a work by its second half;
  // "Taharqa, the Kushite pharaoh" names a person by the first.
  const comma = bare.split(/,\s+/);
  if (comma.length > 1) add(kind === 'work' ? comma.slice(1).join(', ') : comma[0]);
  // "Moshoeshoe I and Thaba Bosiu", "Queen Njinga of Ndongo and Matamba".
  if (!TITLE_KINDS.has(kind) && !COMMON_KINDS.has(kind)) {
    const and = bare.split(l === 'ru' ? /\s+и\s+/ : /\s+and\s+/);
    if (and.length > 1 && /^\p{Lu}/u.test(and[0])) add(and[0]);
  }
  if (kind === 'person' && l === 'en') {
    const of = bare.split(/\s+of\s+/);
    if (of.length > 1) add(of[0]);
  }
  if (inline) add(inline);
  return [...out];
}

/** Every card's names, with the aliases, minus names two cards share or `never` forbids. */
export function buildNames(cards: NameSource[], aliases: AliasesFile = {}): { file: NamesFile; ambiguous: { lang: NameLang; name: string; ids: string[] }[] } {
  const file: NamesFile = { version: 1, en: {}, ru: {} };
  const ambiguous: { lang: NameLang; name: string; ids: string[] }[] = [];
  for (const l of ['en', 'ru'] as const) {
    const never = new Set((aliases.never?.[l] ?? []).map((n) => n.toLowerCase()));
    const owners = new Map<string, Set<string>>();
    const derived = new Map<string, string[]>();
    for (const c of cards) {
      const tr = l === 'en' ? { title: c.title, inline: c.inline } : c.translations?.ru;
      const ns = tr?.title ? deriveNames(c.kind, tr.title, tr.inline, l) : [];
      derived.set(c.id, ns);
      for (const n of ns) (owners.get(n.toLowerCase()) ?? owners.set(n.toLowerCase(), new Set()).get(n.toLowerCase())!).add(c.id);
    }
    const explicit = new Set<string>();
    for (const [id, a] of Object.entries(aliases.aliases ?? {})) for (const n of a[l] ?? []) explicit.add(n.toLowerCase() + '\u0000' + id);
    for (const [name, ids] of owners) if (ids.size > 1) ambiguous.push({ lang: l, name, ids: [...ids].sort() });
    for (const c of cards) {
      const mine = (derived.get(c.id) ?? []).filter((n) => !never.has(n.toLowerCase()) && owners.get(n.toLowerCase())!.size === 1);
      const extra = aliases.aliases?.[c.id]?.[l] ?? [];
      const all = [...new Set([...extra.map(tidy), ...mine])].filter((n) => n && (!never.has(n.toLowerCase()) || explicit.has(n.toLowerCase() + '\u0000' + c.id)));
      if (all.length) file[l][c.id] = all.sort((a, b) => b.length - a.length || a.localeCompare(b));
    }
  }
  return { file, ambiguous };
}

// --- matching ---

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The endings a Russian word may take in its case forms, by its own ending. */
function ruWord(w: string): string {
  if (!/^[\p{Script=Cyrillic}-]+$/u.test(w)) return esc(w);
  // In "чикаго-хаус" only the last part declines.
  const cut = w.lastIndexOf('-');
  const head = cut >= 0 ? w.slice(0, cut + 1) : '';
  const tail = cut >= 0 ? w.slice(cut + 1) : w;
  const yo = (s: string) => esc(s).replace(/[её]/g, '[её]').replace(/[ЕЁ]/g, '[ЕЁ]');
  if (tail.length < 3) return yo(w);
  const alt = (stem: string, ends: string[]) => yo(head) + yo(stem) + `(?:${ends.join('|')})`;
  const last = tail.slice(-1).toLowerCase();
  const two = tail.slice(-2).toLowerCase();
  if (two === 'ий' || two === 'ый' || two === 'ой') return alt(tail.slice(0, -2), [two, 'ия', 'ию', 'ием', 'ии', 'его', 'ему', 'им', 'ем', 'ого', 'ому', 'ым', 'ом', 'ой', 'ую']);
  if (two === 'ая' || two === 'яя') return alt(tail.slice(0, -2), [two, 'ой', 'ую', 'ою', 'ей', 'юю']);
  if (two === 'ое' || two === 'ее') return alt(tail.slice(0, -2), [two, 'ого', 'ому', 'ым', 'ом', 'его', 'ему', 'им', 'ем']);
  if (last === 'а') return alt(tail.slice(0, -1), ['а', 'ы', 'и', 'е', 'у', 'ой', 'ою', 'ам', 'ами', 'ах']);
  if (last === 'я') return alt(tail.slice(0, -1), ['я', 'и', 'е', 'ю', 'ей', 'ею', 'ям', 'ями', 'ях']);
  if (last === 'ь') return alt(tail.slice(0, -1), ['ь', 'я', 'ю', 'ем', 'ём', 'е', 'и', 'ью', 'ей']);
  if (last === 'й') return alt(tail.slice(0, -1), ['й', 'я', 'ю', 'ем', 'е', 'и']);
  if ((last === 'ы' || last === 'и') && tail.length >= 5) return alt(tail.slice(0, -1), ['ы', 'и', 'ов', 'ей', 'ам', 'ям', 'ами', 'ями', 'ах', 'ях']);
  if (/[бвгджзклмнпрстфхцчшщ]/.test(last)) return alt(tail, ['', 'а', 'у', 'ом', 'ым', 'е', 'ы', 'и', 'ов', 'ам', 'ами', 'ах']);
  return yo(w);
}

/** A name as a pattern: either case for a lowercase first letter, case forms in Russian. */
export function namePattern(name: string, l: NameLang): string {
  const first = name[0];
  const lower = first.toLowerCase() === first && first.toUpperCase() !== first;
  const parts = name.split(/(\s+)/).map((p, i) => (i % 2 ? '\\s+' : l === 'ru' ? ruWord(p) : esc(p)));
  let src = parts.join('');
  if (lower) {
    const up = first.toUpperCase();
    // The first character's own pattern starts with it (or with an escape of it).
    src = src.startsWith(esc(first)) ? `[${first}${up}]` + src.slice(esc(first).length) : src;
  }
  return src;
}

const NOT_WORD = '(?<![\\p{L}\\p{N}])';
const NOT_WORD_AFTER = '(?![\\p{L}\\p{N}])';

export interface Lexicon {
  readonly lang: NameLang;
  /** The card a matched piece of text names, if any. */
  idOf(text: string): string | undefined;
  /** All matches in a text, left to right, longest at each place. */
  find(text: string): { index: number; text: string; id: string }[];
}

/** Compile one language's names into a lexicon. */
export function compileLexicon(names: Record<string, string[]>, l: NameLang): Lexicon {
  const entries = Object.entries(names)
    .flatMap(([id, ns]) => ns.map((n) => ({ id, n, src: namePattern(n, l) })))
    .sort((a, b) => b.n.length - a.n.length || a.n.localeCompare(b.n));
  const each = entries.map((e) => ({ id: e.id, re: new RegExp(`^(?:${e.src})$`, 'u') }));
  const all = entries.length ? new RegExp(`${NOT_WORD}(?:${entries.map((e) => e.src).join('|')})${NOT_WORD_AFTER}`, 'gu') : null;
  const idOf = (text: string) => each.find((e) => e.re.test(text))?.id;
  return {
    lang: l,
    idOf,
    find(text) {
      if (!all) return [];
      const out: { index: number; text: string; id: string }[] = [];
      for (const m of text.matchAll(all)) {
        const id = idOf(m[0]);
        if (id) out.push({ index: m.index ?? 0, text: m[0], id });
      }
      return out;
    },
  };
}

export const EMPTY_LEXICON: Lexicon = { lang: 'en', idOf: () => undefined, find: () => [] };

export interface LinkOptions {
  /** Cards already linked in this block: they are not linked again. */
  seen?: Set<string>;
  /** Cards never linked here (the card being read, say). */
  exclude?: ReadonlySet<string>;
}

/**
 * Text with [[links]] and plain mentions, as segments: explicit links stay,
 * and the first plain mention of every other card becomes a link. Explicit
 * links anywhere in the text count as the card's mention, so a card linked
 * by hand later in the block is not also linked earlier by the linker.
 */
export function linkSegments(text: string, lex: Lexicon, opts: LinkOptions = {}): Segment[] {
  const seen = opts.seen ?? new Set<string>();
  const parts = segments(text);
  for (const p of parts) if ('target' in p) seen.add(p.target);
  const out: Segment[] = [];
  for (const p of parts) {
    if ('target' in p) {
      out.push(p);
      continue;
    }
    let last = 0;
    for (const m of lex.find(p.text)) {
      if (seen.has(m.id) || opts.exclude?.has(m.id)) continue;
      seen.add(m.id);
      if (m.index > last) out.push({ text: p.text.slice(last, m.index) });
      out.push({ target: m.id, text: m.text, explicit: true });
      last = m.index + m.text.length;
    }
    if (last < p.text.length) out.push({ text: p.text.slice(last) });
  }
  return out;
}

/** Mentions of cards in a text that are not inside a [[link]]: for the gaps report. */
export function unlinked(text: string, lex: Lexicon, exclude?: ReadonlySet<string>): { id: string; text: string }[] {
  const marked = new Set(links(text));
  return linkSegments(text, lex, { exclude }).flatMap((s) => ('target' in s && !marked.has(s.target) ? [{ id: s.target, text: s.text }] : []));
}
