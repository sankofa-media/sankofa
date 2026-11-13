import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { describe, expect, it } from 'vitest';
import { activeIndex, focusTransform, union, validateDoc, type Doc } from '../src/mechanics/docs/model';

const root = join(__dirname, '../../content');

describe('document on the desk: geometry', () => {
  it('joins the boxes of a line', () => {
    expect(union([[0.1, 0.2, 0.3, 0.02], [0.05, 0.23, 0.6, 0.02]])).toEqual([0.05, 0.2, 0.6, expect.closeTo(0.05, 6)]);
  });

  it('reads the last note that passed the reading line', () => {
    expect(activeIndex([100, 600, 1200], 450)).toBe(0);
    expect(activeIndex([-300, 400, 900], 450)).toBe(1);
    expect(activeIndex([-900, -400, 200], 450)).toBe(2);
  });

  it('zooms a phone window onto a line and never shows past the page', () => {
    const pw = 375;
    const ph = 600;
    const t = focusTransform([0.4, 0.75, 0.2, 0.02], pw, ph, 375, 350);
    expect(t.scale).toBeGreaterThan(1);
    expect(t.scale).toBeLessThanOrEqual(2.4);
    // The line's centre is on screen.
    const cx = (0.5 * pw) * t.scale + t.x;
    const cy = (0.76 * ph) * t.scale + t.y;
    expect(cx).toBeGreaterThan(0);
    expect(cx).toBeLessThan(375);
    expect(cy).toBeGreaterThan(0);
    expect(cy).toBeLessThan(350);
    // No gap at the edges.
    expect(t.x).toBeLessThanOrEqual(0);
    expect(t.y).toBeLessThanOrEqual(0);
    expect(pw * t.scale + t.x).toBeGreaterThanOrEqual(375 - 0.001);
    expect(ph * t.scale + t.y).toBeGreaterThanOrEqual(350 - 0.001);
  });
});

describe('document on the desk: validation', () => {
  const ctx = { cards: new Set(['c']), media: new Set(['p.jpg']), rights: new Set(['p.jpg']) };
  const good: Partial<Doc> = {
    id: 'd',
    card: 'c',
    title: { en: 'T', ru: 'Т' },
    imprint: { en: 'I', ru: 'И' },
    source: { title: 's', url: 'https://x', license: 'Public domain' },
    pages: [{ file: 'p.jpg', label: { en: 'p', ru: 'с' }, width: 0, height: 0 }],
    lines: [{ page: 0, boxes: [[0.1, 0.1, 0.5, 0.02]], text: 't', ru: 'т', note: { en: 'n', ru: 'н' } }],
  };
  it('accepts a sound document', () => expect(validateDoc(good, ctx)).toEqual([]));
  it('refuses a page without a rights entry', () => {
    expect(validateDoc(good, { ...ctx, rights: new Set() }).join()).toMatch(/no rights entry/);
  });
  it('refuses a box outside the page and a missing card', () => {
    const bad = { ...good, card: 'x', lines: [{ ...good.lines![0], boxes: [[0.8, 0.1, 0.5, 0.02]] as [number, number, number, number][] }] };
    const errs = validateDoc(bad, ctx).join('\n');
    expect(errs).toMatch(/card x does not exist/);
    expect(errs).toMatch(/not inside the page/);
  });
});

describe('document on the desk: the museum’s documents', () => {
  const docs = readdirSync(join(root, 'documents')).filter((f) => f.endsWith('.yaml'));
  const ledger = YAML.parse(readFileSync(join(root, 'ledger/media-documents.yaml'), 'utf8')) as { card: string; file: string; sha256: string; url: string; license_wording: string }[];
  const cards = new Set(readdirSync(join(root, 'cards')).map((f) => f.replace(/(\.ru)?\.md$/, '')));

  it('has three to five documents', () => {
    expect(docs.length).toBeGreaterThanOrEqual(3);
    expect(docs.length).toBeLessThanOrEqual(5);
  });

  for (const f of docs) {
    const d = YAML.parse(readFileSync(join(root, 'documents', f), 'utf8')) as Doc;
    it(`${d.id}: valid, with recorded rights and matching checksums`, () => {
      const rights = new Set(ledger.filter((e) => e.card === d.card).map((e) => e.file));
      const media = new Set(d.pages.map((p) => p.file).filter((p) => existsSync(join(root, 'media', p))));
      expect(validateDoc(d, { cards, media, rights })).toEqual([]);
      for (const p of d.pages) {
        const e = ledger.find((x) => x.file === p.file)!;
        expect(e.url).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
        expect(e.license_wording.length).toBeGreaterThan(40);
        expect(createHash('sha256').update(readFileSync(join(root, 'media', p.file))).digest('hex')).toBe(e.sha256);
      }
    });
    it(`${d.id}: every note comes with a Russian translation in «» style, no Latin quotes`, () => {
      for (const l of d.lines) {
        expect(l.ru).not.toMatch(/["“”]/);
        expect(l.note.ru).not.toMatch(/["“”]/);
      }
    });
  }
});
