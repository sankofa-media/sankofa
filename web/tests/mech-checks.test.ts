import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { describe, expect, it } from 'vitest';
import { buildChecks, factText, findClaim, pairContext, type Ledgers } from '../src/mechanics/checks/model';

const src = (s: string) => ({ title: s, url: `https://example.org/${s}` });

function fixture(): Ledgers {
  return {
    final: {
      a: [
        { status: 'agreed', fact: 'The ship sailed in 1781 (also wow)' },
        { status: 'recheck-confirmed', fact: 'It carried 442 people' },
        { status: 'corrected', fact: 'The narrower, corrected wording.' },
      ],
    },
    match: {
      claims: [
        { card: 'a', claim: 'The ship sailed in 1781 (also wow)', status: 'agreed', codex: { verdict: 'confirmed', entries: [{ sources: [src('a1'), src('a2')] }] }, claude: { verdict: 'confirmed', entries: [{ sources: [src('b1'), src('b2'), src('b1')] }] } },
        { card: 'a', claim: 'It carried 442 people', status: 'contested', codex: { verdict: 'removed', entries: [] }, claude: { verdict: 'confirmed', entries: [{ sources: [src('b3'), src('b4')] }] } },
        { card: 'a', claim: 'The broad original wording', status: 'contested', codex: { verdict: 'unverified' }, claude: { verdict: 'confirmed', entries: [{ sources: [src('b5')] }] } },
        { card: 'a', claim: 'Something false', status: 'refuted' },
        { card: 'a', claim: 'Something unconfirmed', status: 'unconfirmed' },
      ],
    },
    recheckA: [
      { card: 'a', claim: 'It carried 442 people', verdict: 'confirmed', sources: [src('a3'), src('a4')] },
      { card: 'a', claim: 'The broad original wording', verdict: 'corrected', sources: [src('a5')], note: 'The narrower, corrected wording.' },
      { card: 'a', claim: 'Dropped claim', verdict: 'unverified' },
    ],
    recheckB: [],
    explainersNew: { a: [{ claim: 'An explainer claim', sources: [src('w1')] }, { claim: 'A removed explainer claim' }] },
    explainersCheck: { claims: [{ card: 'a', claim: 'An explainer claim', verdict: 'confirmed', sources: [src('c1'), src('c2')] }, { card: 'a', claim: 'A removed explainer claim', verdict: 'unverified' }] },
    media: [{ card: 'a', file: 'a.jpg', url: 'https://commons.example/a', license: 'CC0', license_wording: 'No rights reserved.', sha256: 'abc' }],
    mediaCheck: [{ card: 'a', file: 'a.jpg', verdict: 'ok' }],
    rootsCheck: { links: [{ verdict: 'confirmed' }] },
    rootsDeepCheck: { checks: [{ verdict: 'corrected' }, { verdict: 'confirmed' }] },
    context: [
      // The list form (context-a-check): unledgered sentences are marked in the fact.
      {
        facts: [
          { card: 'a', fact: 'The writer’s first context fact', sources: [src('w2'), src('w3')] },
          { card: 'a', fact: 'A context fact quoted with other words by the checker', sources: [src('w4')] },
          { card: 'a', fact: 'A context fact the checker could not confirm', sources: [src('w5')] },
        ],
        check: [
          { card: 'a', fact: 'The writer’s first context fact', verdict: 'confirmed', sources: [src('c3'), src('c4')], note: 'Both quotes found.' },
          { card: 'a', fact: 'A context fact quoted in other words by the checker', verdict: 'corrected', sources: [src('c5')] },
          { card: 'a', fact: 'A context fact the checker could not confirm', verdict: 'unconfirmed', sources: [] },
          { card: 'a', fact: '(unledgered) A sentence the writer did not record', verdict: 'confirmed', sources: [src('c6')] },
          { card: 'a', fact: 'UNLEDGERED: Another unrecorded sentence', verdict: 'unconfirmed', sources: [src('c7')] },
        ],
      },
      // The map form (context-b-check): { claims, unledgered }.
      {
        facts: [{ card: 'a', fact: 'A fact of the second round', sources: [src('w6'), src('w7')] }],
        check: {
          claims: [{ card: 'a', fact: 'A fact of the second round', verdict: 'confirmed', sources: [src('c8'), src('c9')] }],
          unledgered: [
            { card: 'a', fact: 'An unrecorded sentence that was dropped', verdict: 'removed', sources: [src('c10')] },
            { card: 'a', fact: 'A pointer to another entry', verdict: 'corrected', sources: null },
          ],
        },
      },
    ],
  };
}

describe('how we checked: ledgers joined per card', () => {
  const l = fixture();
  const out = buildChecks(l, ['a', 'b']);

  it('strips the ledger bookkeeping from facts', () => {
    expect(factText('Born in 1930 (also wow: young)')).toBe('Born in 1930');
    expect(out.cards.a.facts[0].fact).toBe('The ship sailed in 1781');
  });

  it('gives both agents and their sources, without duplicates', () => {
    const [a, b] = out.cards.a.facts[0].checks;
    expect(a).toMatchObject({ agent: 'A', verdict: 'confirmed' });
    expect(a.sources.map((s) => s.title)).toEqual(['a1', 'a2']);
    expect(b.sources.map((s) => s.title)).toEqual(['b1', 'b2']);
  });

  it('takes the re-check as the verdict of the agent that re-checked', () => {
    const [a, b] = out.cards.a.facts[1].checks;
    expect(a).toMatchObject({ agent: 'A', verdict: 'confirmed', recheck: true, first: 'removed' });
    expect(a.sources.map((s) => s.title)).toEqual(['a3', 'a4']);
    expect(b.verdict).toBe('confirmed');
  });

  it('finds a corrected fact through the re-check note', () => {
    expect(findClaim('a', 'The narrower, corrected wording.', l)?.claim).toBe('The broad original wording');
    expect(out.cards.a.facts[2].checks[0]).toMatchObject({ verdict: 'corrected', recheck: true });
  });

  it('keeps only explainer claims the second agent confirmed', () => {
    const ex = out.cards.a.facts.filter((f) => f.checks[0]?.agent === 'W' && f.fact.includes('xplainer'));
    expect(ex.map((f) => f.fact)).toEqual(['An explainer claim']);
    expect(ex[0].checks[1]).toMatchObject({ agent: 'C', verdict: 'confirmed' });
  });

  it('joins the context rewrite: the writer’s sources, the second check and its note', () => {
    const ctx = out.cards.a.facts.filter((f) => f.checks.some((c) => c.agent === 'W') && !f.fact.includes('explainer'));
    expect(ctx.map((f) => f.fact)).toEqual(['The writer’s first context fact', 'A context fact quoted in other words by the checker', 'A fact of the second round']);
    expect(ctx[0].checks[0]).toMatchObject({ agent: 'W', verdict: 'confirmed' });
    expect(ctx[0].checks[0].sources.map((s) => s.title)).toEqual(['w2', 'w3']);
    expect(ctx[0].checks[1]).toMatchObject({ agent: 'C', verdict: 'confirmed', note: 'Both quotes found.' });
    expect(ctx[1].status).toBe('corrected');
  });

  it('shows the unledgered sentences the second agent confirmed, from both file forms', () => {
    const un = out.cards.a.facts.filter((f) => f.unledgered);
    expect(un.map((f) => f.fact)).toEqual(['A sentence the writer did not record']);
    expect(un[0].checks.map((c) => c.agent)).toEqual(['C']);
  });

  it('carries the licence wording and the second check of pictures', () => {
    expect(out.cards.a.media[0]).toMatchObject({ file: 'a.jpg', wording: 'No rights reserved.', second: { verdict: 'ok' } });
  });

  it('counts the totals from the ledgers', () => {
    expect(out.totals).toMatchObject({
      cards: 1,
      facts: 8,
      // 5 phase-one claims, 2 explainer claims, 4 context facts and 4 unledgered sentences.
      claimsExamined: 15,
      refuted: 1,
      // 3 from the main check and the explainers, 3 from the context rewrite.
      unconfirmed: 6,
      explainers: 1,
      context: { facts: 4, unledgered: 4, kept: 4, confirmed: 3, corrected: 1, dropped: 3 },
      rechecked: 3,
      images: 1,
      imageSecond: { ok: 1 },
      rootsLinks: 3,
      rootsByVerdict: { confirmed: 2, corrected: 1 },
    });
    expect(out.cards.b).toBeUndefined();
  });
});

describe('how we checked: the museum’s own ledgers', () => {
  const root = join(__dirname, '../../content');
  const y = (f: string) => YAML.parse(readFileSync(join(root, 'ledger', f), 'utf8'));
  const ids = readdirSync(join(root, 'cards'))
    .filter((f) => f.endsWith('.md') && !/\.[a-z]{2}\.md$/.test(f))
    .map((f) => f.replace(/\.md$/, ''));
  const out = buildChecks(
    {
      final: y('final.yaml'),
      match: y('match.yaml'),
      recheckA: y('recheck-codex-result.yaml'),
      recheckB: y('recheck-claude-result.yaml'),
      explainersNew: y('explainers-new.yaml'),
      explainersCheck: y('explainers-check.yaml'),
      media: [...y('media.yaml'), ...y('media-documents.yaml')],
      mediaCheck: y('media-check.yaml'),
      context: ['a', 'b'].map((x) => ({ facts: y(`context-${x}.yaml`), check: y(`context-${x}-check.yaml`) })),
    },
    ids,
  );

  it('pairs every fact of the context rewrite with its second check', () => {
    for (const x of ['a', 'b']) {
      const { pairs } = pairContext({ facts: y(`context-${x}.yaml`), check: y(`context-${x}-check.yaml`) });
      expect(pairs.filter((p) => !p.check).map((p) => `${p.fact.card}: ${p.fact.fact}`)).toEqual([]);
    }
    expect(out.totals.context.kept).toBeGreaterThan(400);
  });

  it('has a record for every card', () => {
    expect(Object.keys(out.cards).sort()).toEqual([...ids].sort());
  });

  it('traces almost every fact to the two agents', () => {
    const facts = Object.values(out.cards).flatMap((c) => c.facts);
    // An unledgered sentence has only the second agent's check: the writer recorded none.
    const traced = facts.filter((f) => f.checks.length === (f.unledgered ? 1 : 2));
    expect(traced.length / facts.length).toBeGreaterThan(0.99);
    for (const f of traced) for (const c of f.checks) expect(['A', 'B', 'W', 'C']).toContain(c.agent);
  });
});
