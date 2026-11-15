import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { clapAngle, FlashGate, formatClock, parseClock, publishFeature, sceneAt, sceneProgress, validateFeature, windowed, type FeatureSource } from '../src/features/model';
import { branches, compileLineage, layoutRiver, playableOf, sourcedNodes, validateLineage, youtubeId, type RawLineage } from '../src/features/lineage';

const bi = (en: string, ru: string) => ({ en, ru });
const base = (): FeatureSource => ({
  id: 'demo',
  title: bi('Demo', 'Демо'),
  dek: bi('A demo', 'Демо'),
  scenes: [
    { id: 'one', kind: 'text', blocks: [{ id: 'a', role: 'text', draft: true, en: 'Hello', ru: 'Привет' }] },
    { id: 'two', kind: 'text', blocks: [{ id: 'b', role: 'text', draft: true, en: 'Shown', ru: 'Видно' }, { id: 'c', role: 'text', draft: true, hold: true, en: 'Held', ru: 'Ждёт' }] },
  ],
});

describe('scene model', () => {
  it('progress runs 0..1 across a tall scene and across a short one', () => {
    expect(sceneProgress(0, 2000, 800)).toBe(0);
    expect(sceneProgress(-600, 2000, 800)).toBeCloseTo(0.5);
    expect(sceneProgress(-1200, 2000, 800)).toBe(1);
    expect(sceneProgress(-5000, 2000, 800)).toBe(1);
    expect(sceneProgress(800, 400, 800)).toBe(0);
    expect(sceneProgress(200, 400, 800)).toBeCloseTo(0.5);
  });
  it('the current scene is the one under the reading line', () => {
    const rects = [{ top: -900, height: 1000 }, { top: 100, height: 1000 }, { top: 1100, height: 1000 }];
    expect(sceneAt(rects, 900)).toBe(1);
    expect(sceneAt([{ top: 500, height: 100 }], 900)).toBe(0);
  });
  it('windows, clocks, angles', () => {
    expect(windowed(0.5, 0.4, 0.6)).toBeCloseTo(0.5);
    expect(windowed(0.1, 0.4, 0.6)).toBe(0);
    expect(parseClock('1:49')).toBe(109);
    expect(parseClock('3:21')).toBe(201);
    expect(() => parseClock('1:99')).toThrow();
    expect(formatClock(157)).toBe('2:37');
    expect(clapAngle(0.6, 0.6)).toBeCloseTo(90);
    expect(clapAngle(2.4 + 1.2, 0.6)).toBeCloseTo(180);
  });
  it('never more than three flashes in a second', () => {
    const g = new FlashGate();
    expect([0, 100, 200, 300, 400].map((t) => g.allow(t))).toEqual([true, true, true, false, false]);
    expect(g.allow(1001)).toBe(true);
  });
});

describe('feature validation', () => {
  it('a sound feature passes, and the build drops held blocks', () => {
    expect(validateFeature(base())).toEqual([]);
    const { data, held } = publishFeature(base());
    expect(held).toBe(1);
    expect(JSON.stringify(data)).not.toContain('Held');
    expect(data.scenes[1].blocks.map((b) => b.id)).toEqual(['b']);
  });
  it('every block needs English and Russian, and a draft mark', () => {
    const f = base();
    f.scenes[0].blocks[0].ru = '';
    delete (f.scenes[1].blocks[0] as { draft?: boolean }).draft;
    const errs = validateFeature(f);
    expect(errs.join('\n')).toMatch(/one block a: needs both en and ru/);
    expect(errs.join('\n')).toMatch(/block b: draft must be set/);
  });
  it('a scene with only held text has nothing to show', () => {
    const f = base();
    f.scenes[1].blocks = [f.scenes[1].blocks[1]];
    expect(validateFeature(f).join()).toMatch(/scene two: needs at least one shown block/);
  });
  it('lineage nodes a scene uses must exist and have sources; a photo needs its rights', () => {
    const f = base();
    f.scenes[0].nodes = ['ok', 'bare', 'ghost'];
    f.art = [{ id: 'p', kind: 'photo', file: 'p.jpg' }, { id: 'g', kind: 'generated', file: 'g.png' }];
    const errs = validateFeature(f, { nodes: new Set(['ok', 'bare']), sourced: new Set(['ok']), rights: new Set() }).join('\n');
    expect(errs).toMatch(/bare has no sources/);
    expect(errs).toMatch(/ghost does not exist/);
    expect(errs).toMatch(/art p: a real photo needs a rights entry/);
    expect(errs).not.toMatch(/art g/);
  });
});

describe('lineage', () => {
  const raw: RawLineage = {
    nodes: [
      { id: 'trad', title: 'Trad', year: null, kind: 'original', parents: [] },
      { id: 'field', title: 'Field', year: 1939, kind: 'field-recording', parents: ['trad'], playable_url: 'https://www.loc.gov/item/x/', playable_audio_direct: 'https://tile.loc.gov/a.mp3', sources: [{ title: 'LoC', url: 'https://loc.gov' }] },
      { id: 'nina', title: 'Nina', year: 1964, kind: 'cover', parents: ['field'], playable_url: 'https://www.youtube.com/watch?v=E17-0CuPb64', sources: [{ title: 'D', url: 'https://d' }] },
      { id: 'single', title: 'Single', year: 1964, kind: 'cover', parents: ['nina'], sources: [{ title: 'D', url: 'https://d' }] },
      { id: 'feist', title: 'Feist', year: 2007, kind: 'cover', parents: ['field', 'nina'], sources: [{ title: 'N', url: 'https://n' }] },
      { id: 'kanye', title: 'Kanye', year: 2008, kind: 'sample', parents: ['nina'], playable_url: 'https://youtu.be/1BlH1JZBeXI' },
      { id: 'band', title: 'Band', year: 2021, kind: 'cover', parents: ['nina'], playable_url: 'https://atjazz.bandcamp.com/album/x', sources: [{ title: 'B', url: 'https://b' }] },
    ],
  };
  it('playable links come only from allowed hosts', () => {
    expect(validateLineage(raw)).toEqual([]);
    expect(youtubeId('https://youtu.be/1BlH1JZBeXI')).toBe('1BlH1JZBeXI');
    expect(playableOf(raw.nodes[1]).play).toEqual({ source: 'audio', audio: 'https://tile.loc.gov/a.mp3' });
    expect(playableOf(raw.nodes[6])).toEqual({ link: 'https://atjazz.bandcamp.com/album/x' });
    expect(() => playableOf({ id: 'x', playable_url: 'https://evil.example/song.mp3' })).toThrow(/not allowed/);
    expect(() => playableOf({ id: 'x', playable_audio_direct: 'https://example.com/a.mp3' })).toThrow(/tile.loc.gov/);
    expect(validateLineage({ nodes: [{ id: 'a', title: 'a', year: 2000, kind: 'cover', parents: ['b'] }] })[0]).toMatch(/parent b does not exist/);
  });
  it('only sourced nodes count, unless the owner verified a disputed one', () => {
    const s = sourcedNodes({ nodes: [...raw.nodes, { id: 'pc', title: 'PC', year: 2010, kind: 'sample', parents: ['nina'], verified: true, claims_for: [{ who: 'WhoSampled', url: 'https://w' }] }] });
    expect(s.has('kanye')).toBe(false);
    expect(s.has('pc')).toBe(true);
  });
  it('two branches: Simone’s only when everything came from her', () => {
    const b = branches(raw, { girls: 'field', simone: 'nina' });
    expect(b.get('trad')).toBe('source');
    expect(b.get('field')).toBe('girls');
    expect(b.get('single')).toBe('simone');
    expect(b.get('feist')).toBe('girls');
    expect(b.get('kanye')).toBe('simone');
  });
  it('the tree grows down: no node beside or above what it came from', () => {
    const data = compileLineage(raw, { include: ['field', 'nina', 'single', 'feist', 'kanye', 'band'], roots: { girls: 'field', simone: 'nina' }, glyphs: { feist: 'clap' }, screen: ['feist'] });
    expect(data.nodes.find((n) => n.id === 'feist')).toMatchObject({ glyph: 'clap', categories: ['cover', 'screen'], branch: 'girls' });
    expect(data.nodes.find((n) => n.id === 'kanye')).toMatchObject({ glyph: 'tape', categories: ['sample'] });
    const lay = layoutRiver(data.nodes);
    const row = new Map(lay.placed.map((p) => [p.id, p.row]));
    for (const e of lay.edges) expect(row.get(e.to)!).toBeGreaterThan(row.get(e.from)!);
    expect(row.get('single')).toBeGreaterThan(row.get('nina')!);
    for (const p of lay.placed) {
      if (p.branch === 'girls') expect(p.x).toBeLessThan(0.5);
      if (p.branch === 'simone') expect(p.x).toBeGreaterThan(0.5);
    }
    expect(lay.years[0]).toBe(1939);
  });
});

describe('the Sea Lion Girls content', () => {
  const f = parse(readFileSync('../content/features/sea-lion-girls/feature.yaml', 'utf8')) as FeatureSource;
  const lin = parse(readFileSync('../content/features/sea-lion-girls/lineage.yaml', 'utf8')) as RawLineage;
  it('is valid against its lineage, all draft, with the single-source lines held', () => {
    const sync = new Set((lin.sync ?? []).filter((s) => (s.sources ?? []).length).map((s) => s.work));
    expect(validateFeature(f, { nodes: new Set(lin.nodes.map((n) => n.id)), sourced: sourcedNodes(lin), sync })).toEqual([]);
    expect(validateLineage(lin)).toEqual([]);
    const blocks = f.scenes.flatMap((s) => s.blocks);
    expect(blocks.every((b) => b.draft === true)).toBe(true);
    const held = blocks.filter((b) => b.hold).map((b) => b.id);
    expect(held).toEqual(expect.arrayContaining(['ambulance', 'by-ear', 'isaac-1998', 'never-heard', 'isaac-africa']));
  });
});

describe('feature routes', async () => {
  const { formatRoute, parseRoute } = await import('../src/lib/route');
  it('the link keeps the feature and its scene, and nothing else gets a scene', () => {
    const r = parseRoute('#view=feature&item=sea-lion-girls&scene=river');
    expect(r).toMatchObject({ view: 'feature', item: 'sea-lion-girls', scene: 'river' });
    expect(formatRoute(r)).toBe('view=feature&item=sea-lion-girls&scene=river');
    expect(parseRoute('#view=features').view).toBe('features');
    expect(parseRoute('#view=roots&scene=x').scene).toBeUndefined();
    expect(parseRoute('#view=feature&item=a&scene=<b>').scene).toBeUndefined();
  });
});
