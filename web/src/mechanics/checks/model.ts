// "How we checked": joins the fact-check ledgers (content/ledger) into one
// record per card, and counts the whole museum. Pure: the build script feeds
// it parsed YAML, the tests feed it small fixtures.

export interface SourceRef {
  title: string;
  url?: string;
}

/**
 * One agent's check of one fact. `agent` is A or B for the two independent
 * agents of the main check; W (the writer's research) and C (the second
 * agent's check) for the claims added when the explainer cards were rewritten.
 */
export interface AgentCheck {
  agent: 'A' | 'B' | 'W' | 'C';
  verdict: string;
  /** The verdict came from the second round, when this agent re-checked the other's sources. */
  recheck?: boolean;
  /** The agent's first-round verdict, when a re-check replaced it. */
  first?: string;
  sources: SourceRef[];
  /** What the checking agent wrote about its verdict. */
  note?: string;
}

export interface FactCheck {
  fact: string;
  /** agreed | recheck-confirmed | corrected | disputed | confirmed (explainers, context) */
  status: string;
  checks: AgentCheck[];
  /** Added in a rewrite without an entry in the writer's ledger; found and checked by the second agent. */
  unledgered?: boolean;
}

export interface MediaRight {
  file: string;
  url: string;
  license: string;
  wording?: string;
  verified?: string;
  sha256?: string;
  /** The second, independent licence check, when there was one. */
  second?: { verdict: string; note?: string };
}

export interface CardChecks {
  facts: FactCheck[];
  media: MediaRight[];
}

export interface Totals {
  cards: number;
  facts: number;
  byStatus: Record<string, number>;
  claimsExamined: number;
  refuted: number;
  unconfirmed: number;
  rechecked: number;
  images: number;
  imageSecond: Record<string, number>;
  rootsLinks: number;
  rootsByVerdict: Record<string, number>;
  /** Facts kept from the explainer rewrite. */
  explainers: number;
  /** The context rewrite: the writer's ledger and its independent second check. */
  context: ContextTotals;
  /** The new cards of the expansion, counted the same way. */
  expansion: ContextTotals;
}

export interface ContextTotals {
  /** Facts the writer recorded, each with its sources. */
  facts: number;
  /** Sentences the writer had not recorded, found and checked by the second agent. */
  unledgered: number;
  /** Kept on the cards, as written or corrected. */
  kept: number;
  confirmed: number;
  corrected: number;
  /** Taken out of the cards: refuted, unconfirmed or removed. */
  dropped: number;
}

export interface ChecksFile {
  version: 1;
  cards: Record<string, CardChecks>;
  totals: Totals;
}

interface RawSource {
  title?: string;
  url?: string;
}
interface MatchEntry {
  verdict?: string;
  claim?: string;
  sources?: RawSource[];
}
interface MatchSide {
  verdict?: string;
  entries?: MatchEntry[];
}
export interface MatchClaim {
  card: string;
  claim: string;
  status: string;
  codex?: MatchSide;
  claude?: MatchSide;
}
export interface Recheck {
  card: string;
  claim: string;
  verdict: string;
  sources?: (RawSource | string)[];
  note?: string;
}
export interface FinalFact {
  status: string;
  fact: string;
}
export interface MediaEntry {
  card: string;
  file: string;
  url: string;
  license: string;
  license_wording?: string;
  verified_on?: string;
  sha256?: string;
}
export interface MediaCheck {
  card: string;
  file: string;
  verdict: string;
  note?: string;
}

/** One fact the writer added to a card in the context rewrite, with its sources. */
export interface ContextFact {
  card: string;
  fact: string;
  sources?: RawSource[] | null;
}
/** The second agent's verdict on a context fact. */
export interface ContextCheck {
  card: string;
  fact: string;
  verdict: string;
  sources?: (RawSource | string)[] | null;
  note?: string;
  /** Some checkers wrote an unledgered sentence as `claim` instead of `fact`. */
  claim?: string;
}
/**
 * A check file: either a list, where an unledgered sentence's fact starts
 * with "(unledgered)" or "UNLEDGERED:", or { claims, unledgered }.
 */
export type ContextCheckFile =
  | ContextCheck[]
  | { claims?: ContextCheck[]; entries?: ContextCheck[]; checks?: ContextCheck[]; removed?: ContextCheck[]; removed_or_reworded?: ContextCheck[]; unledgered?: ContextCheck[] };
export interface ContextRound {
  facts: ContextFact[];
  check: ContextCheckFile;
}

export interface Ledgers {
  final: Record<string, FinalFact[]>;
  match: { claims: MatchClaim[] };
  /** Agent A's (codex) re-check of what B confirmed. */
  recheckA: Recheck[];
  /** Agent B's (claude) re-check of what A confirmed. */
  recheckB: Recheck[];
  explainersNew?: Record<string, { claim: string; sources?: RawSource[] }[]>;
  explainersCheck?: { claims: Recheck[] };
  media?: MediaEntry[];
  mediaCheck?: MediaCheck[];
  rootsCheck?: { links?: { verdict: string }[] };
  rootsDeepCheck?: { checks?: { verdict: string }[] };
  /** The context rewrite, one round per ledger (context-a, context-b). */
  context?: ContextRound[];
  /** The new cards, one round per batch ledger (expand-c01 ... expand-x03). */
  expansion?: ContextRound[];
}

export const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[“”"‘’'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** The display form of a ledger fact: without the "(also wow …)" bookkeeping. */
export function factText(s: string): string {
  return s.replace(/\s*\((also|wow)\b[^)]*\)/gi, '').replace(/\s+/g, ' ').trim();
}

function sources(list: (RawSource | string)[] | undefined): SourceRef[] {
  const out: SourceRef[] = [];
  const seen = new Set<string>();
  for (const s of list ?? []) {
    const ref: SourceRef = typeof s === 'string' ? { title: s, url: s } : { title: s.title ?? s.url ?? '', url: s.url };
    if (!ref.title) continue;
    const key = ref.url ?? ref.title;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref.url ? ref : { title: ref.title });
  }
  return out;
}

function side(agent: 'A' | 'B', s: MatchSide | undefined): AgentCheck {
  const entries = s?.entries ?? [];
  return { agent, verdict: s?.verdict ?? 'unchecked', sources: sources(entries.flatMap((e) => e.sources ?? [])) };
}

function words(s: string): Set<string> {
  return new Set(norm(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2));
}

function overlap(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}

/**
 * The phase-1 claim a final fact came from: the same words; or, for a
 * corrected fact, the claim whose re-check note is the corrected wording;
 * or failing both, the claim of that card that shares most words with it.
 */
export function findClaim(card: string, fact: string, l: Ledgers, index = indexLedgers(l)): MatchClaim | undefined {
  const exact = index.match.get(card + '|' + norm(fact));
  if (exact) return exact;
  for (const r of [...(index.recheckA.get(card) ?? []), ...(index.recheckB.get(card) ?? [])]) {
    if (r.note && norm(r.note) === norm(fact)) {
      const m = index.match.get(card + '|' + norm(r.claim));
      if (m) return m;
    }
  }
  let best: MatchClaim | undefined;
  let score = 0;
  for (const m of index.byCard.get(card) ?? []) {
    const s = overlap(fact, m.claim);
    if (s > score) [best, score] = [m, s];
  }
  return score >= 0.5 ? best : undefined;
}

interface Index {
  match: Map<string, MatchClaim>;
  byCard: Map<string, MatchClaim[]>;
  recheckA: Map<string, Recheck[]>;
  recheckB: Map<string, Recheck[]>;
}

function group<T extends { card: string }>(list: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of list) m.set(x.card, [...(m.get(x.card) ?? []), x]);
  return m;
}

export function indexLedgers(l: Ledgers): Index {
  return {
    match: new Map(l.match.claims.map((c) => [c.card + '|' + norm(c.claim), c])),
    byCard: group(l.match.claims),
    recheckA: group(l.recheckA),
    recheckB: group(l.recheckB),
  };
}

function recheckOf(list: Recheck[] | undefined, claim: string): Recheck | undefined {
  return list?.find((r) => norm(r.claim) === norm(claim));
}

/** Both agents' checks of one final fact. */
export function checksFor(card: string, f: FinalFact, l: Ledgers, index = indexLedgers(l)): AgentCheck[] {
  const m = findClaim(card, f.fact, l, index);
  if (!m) return [];
  const a = side('A', m.codex);
  const b = side('B', m.claude);
  const ra = recheckOf(index.recheckA.get(card), m.claim);
  const rb = recheckOf(index.recheckB.get(card), m.claim);
  const fromRecheck = (c: AgentCheck, r: Recheck): AgentCheck => ({ agent: c.agent, verdict: r.verdict, recheck: true, first: c.verdict, sources: sources(r.sources) });
  return [ra ? fromRecheck(a, ra) : a, rb ? fromRecheck(b, rb) : b];
}

const UNLEDGERED = /^\s*(\(unledgered\)|unledgered:)\s*/i;
const KEPT = new Set(['confirmed', 'corrected']);

/** A check file in one shape: the claims of the writer's ledger, and the unledgered sentences. */
export function contextCheckEntries(f: ContextCheckFile | undefined): { claims: ContextCheck[]; unledgered: ContextCheck[] } {
  if (!f) return { claims: [], unledgered: [] };
  if (!Array.isArray(f)) {
    const named = (xs: ContextCheck[] | undefined) => (xs ?? []).map((e) => ({ ...e, fact: e.fact ?? e.claim ?? '' }));
    return {
      claims: named([...(f.claims ?? []), ...(f.entries ?? []), ...(f.checks ?? []), ...(f.removed ?? []), ...(f.removed_or_reworded ?? [])]),
      unledgered: named(f.unledgered),
    };
  }
  const claims: ContextCheck[] = [];
  const unledgered: ContextCheck[] = [];
  for (const e of f) {
    if (UNLEDGERED.test(e.fact)) unledgered.push({ ...e, fact: e.fact.replace(UNLEDGERED, '') });
    else claims.push(e);
  }
  return { claims, unledgered };
}

export interface ContextPair {
  fact: ContextFact;
  check?: ContextCheck;
}

/**
 * Each writer's fact with its check. The checker sometimes quotes a fact in
 * slightly different words; on a card, an unmatched fact takes the unmatched
 * check that shares most words with it.
 */
export function pairContext(round: ContextRound): { pairs: ContextPair[]; unledgered: ContextCheck[] } {
  const { claims, unledgered } = contextCheckEntries(round.check);
  const exact = new Map<string, ContextCheck>();
  for (const c of claims) exact.set(c.card + '|' + norm(c.fact), c);
  const used = new Set<ContextCheck>();
  const pairs: ContextPair[] = round.facts.map((f) => {
    const c = exact.get(f.card + '|' + norm(f.fact));
    if (c && !used.has(c)) used.add(c);
    return { fact: f, check: c && used.has(c) ? c : undefined };
  });
  for (const p of pairs) {
    if (p.check) continue;
    let best: ContextCheck | undefined;
    let score = 0;
    for (const c of claims) {
      if (used.has(c) || c.card !== p.fact.card) continue;
      const s = overlap(p.fact.fact, c.fact);
      if (s > score) [best, score] = [c, s];
    }
    if (best && score >= 0.5) {
      used.add(best);
      p.check = best;
    }
  }
  return { pairs, unledgered };
}

function contextChecks(rounds: ContextRound[] | undefined): { byCard: Map<string, FactCheck[]>; totals: ContextTotals } {
  const byCard = new Map<string, FactCheck[]>();
  const totals: ContextTotals = { facts: 0, unledgered: 0, kept: 0, confirmed: 0, corrected: 0, dropped: 0 };
  const keep = (card: string, f: FactCheck) => byCard.set(card, [...(byCard.get(card) ?? []), f]);
  const count = (verdict: string) => {
    if (verdict === 'confirmed' || verdict === 'corrected') {
      totals.kept++;
      totals[verdict]++;
    } else totals.dropped++;
  };
  const second = (c: ContextCheck): AgentCheck => ({ agent: 'C', verdict: c.verdict, sources: sources(c.sources ?? []), ...(c.note ? { note: c.note } : {}) });
  for (const round of rounds ?? []) {
    const { pairs, unledgered } = pairContext(round);
    totals.facts += pairs.length;
    totals.unledgered += unledgered.length;
    for (const { fact, check } of pairs) {
      // A fact nobody re-checked does not count as checked, and is not shown as such.
      if (!check) continue;
      count(check.verdict);
      if (!KEPT.has(check.verdict)) continue;
      keep(fact.card, { fact: factText(check.fact), status: check.verdict, checks: [{ agent: 'W', verdict: 'confirmed', sources: sources(fact.sources ?? []) }, second(check)] });
    }
    for (const u of unledgered) {
      const kept = KEPT.has(u.verdict);
      // A kept sentence without sources only points at a ledger entry already counted.
      if (kept && !(u.sources ?? []).length) continue;
      count(u.verdict);
      if (kept) keep(u.card, { fact: factText(u.fact), status: u.verdict, unledgered: true, checks: [second(u)] });
    }
  }
  return { byCard, totals };
}

export function buildChecks(l: Ledgers, cardIds: string[]): ChecksFile {
  const index = indexLedgers(l);
  const cards: Record<string, CardChecks> = {};
  const byStatus: Record<string, number> = {};
  const explainerChecks = new Map((l.explainersCheck?.claims ?? []).map((c) => [c.card + '|' + norm(c.claim), c]));
  const second = new Map((l.mediaCheck ?? []).map((m) => [m.card + '|' + m.file, m]));
  const known = new Set(cardIds);
  const context = contextChecks(l.context);
  const expansion = contextChecks(l.expansion);
  let facts = 0;
  let explainers = 0;
  for (const id of cardIds) {
    const list: FactCheck[] = [];
    for (const f of l.final[id] ?? []) {
      list.push({ fact: factText(f.fact), status: f.status, checks: checksFor(id, f, l, index) });
    }
    for (const c of l.explainersNew?.[id] ?? []) {
      const chk = explainerChecks.get(id + '|' + norm(c.claim));
      // Refuted or unverified explainer claims were taken out of the card.
      if (!chk || (chk.verdict !== 'confirmed' && chk.verdict !== 'corrected')) continue;
      list.push({
        fact: factText(chk.verdict === 'corrected' && chk.note ? chk.note : c.claim),
        status: chk.verdict,
        checks: [
          { agent: 'W', verdict: 'confirmed', sources: sources(c.sources) },
          { agent: 'C', verdict: chk.verdict, sources: sources(chk.sources) },
        ],
      });
      explainers++;
    }
    list.push(...(context.byCard.get(id) ?? []), ...(expansion.byCard.get(id) ?? []));
    for (const f of list) byStatus[f.status] = (byStatus[f.status] ?? 0) + 1;
    facts += list.length;
    const media = (l.media ?? [])
      .filter((m) => m.card === id)
      .map((m): MediaRight => {
        const s = second.get(m.card + '|' + m.file);
        return {
          file: m.file,
          url: m.url,
          license: m.license,
          wording: m.license_wording,
          verified: m.verified_on,
          sha256: m.sha256,
          ...(s ? { second: { verdict: s.verdict, note: s.note } } : {}),
        };
      });
    if (list.length || media.length) cards[id] = { facts: list, media };
  }
  const tally = (xs: { verdict: string }[] | undefined) => {
    const t: Record<string, number> = {};
    for (const x of xs ?? []) t[x.verdict] = (t[x.verdict] ?? 0) + 1;
    return t;
  };
  const matchCount = (s: string) => l.match.claims.filter((c) => c.status === s).length;
  const rechecks = [...l.recheckA, ...l.recheckB];
  const ex = l.explainersCheck?.claims ?? [];
  const roots = [...(l.rootsCheck?.links ?? []), ...(l.rootsDeepCheck?.checks ?? [])];
  const images = (l.media ?? []).filter((m) => known.has(m.card));
  // Context facts taken out of the cards, by the checker's verdict.
  const contextDropped = (...verdicts: string[]) =>
    [...(l.context ?? []), ...(l.expansion ?? [])].reduce((n, round) => {
      const { pairs, unledgered } = pairContext(round);
      return n + [...pairs.map((p) => p.check?.verdict), ...unledgered.map((u) => u.verdict)].filter((v) => v && verdicts.includes(v)).length;
    }, 0);
  return {
    version: 1,
    cards,
    totals: {
      cards: Object.keys(cards).length,
      facts,
      byStatus,
      claimsExamined: l.match.claims.length + ex.length + context.totals.facts + context.totals.unledgered + expansion.totals.facts + expansion.totals.unledgered,
      refuted: matchCount('refuted') + rechecks.filter((r) => r.verdict === 'refuted').length + ex.filter((r) => r.verdict === 'refuted').length + contextDropped('refuted'),
      unconfirmed: matchCount('unconfirmed') + rechecks.filter((r) => r.verdict === 'unverified').length + ex.filter((r) => r.verdict === 'unverified').length + contextDropped('unconfirmed', 'unverified', 'removed'),
      rechecked: rechecks.length,
      images: images.length,
      imageSecond: tally(images.map((m) => second.get(m.card + '|' + m.file)).filter((x): x is MediaCheck => !!x)),
      rootsLinks: roots.length,
      rootsByVerdict: tally(roots),
      explainers,
      context: context.totals,
      expansion: expansion.totals,
    },
  };
}
