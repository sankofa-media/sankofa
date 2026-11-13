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
}

export interface FactCheck {
  fact: string;
  /** agreed | recheck-confirmed | corrected | disputed | confirmed (explainers) */
  status: string;
  checks: AgentCheck[];
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

export function buildChecks(l: Ledgers, cardIds: string[]): ChecksFile {
  const index = indexLedgers(l);
  const cards: Record<string, CardChecks> = {};
  const byStatus: Record<string, number> = {};
  const explainerChecks = new Map((l.explainersCheck?.claims ?? []).map((c) => [c.card + '|' + norm(c.claim), c]));
  const second = new Map((l.mediaCheck ?? []).map((m) => [m.card + '|' + m.file, m]));
  const known = new Set(cardIds);
  let facts = 0;
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
    }
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
  return {
    version: 1,
    cards,
    totals: {
      cards: Object.keys(cards).length,
      facts,
      byStatus,
      claimsExamined: l.match.claims.length + ex.length,
      refuted: matchCount('refuted') + rechecks.filter((r) => r.verdict === 'refuted').length + ex.filter((r) => r.verdict === 'refuted').length,
      unconfirmed: matchCount('unconfirmed') + rechecks.filter((r) => r.verdict === 'unverified').length + ex.filter((r) => r.verdict === 'unverified').length,
      rechecked: rechecks.length,
      images: images.length,
      imageSecond: tally(images.map((m) => second.get(m.card + '|' + m.file)).filter((x): x is MediaCheck => !!x)),
      rootsLinks: roots.length,
      rootsByVerdict: tally(roots),
    },
  };
}
