import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { clapAngle, FlashGate, formatClock, parseClock, publishFeature, sceneArtFiles, sceneAt, sceneProgress, validateFeature, validateSceneArt, windowed, type FeatureSource, type SceneArt } from '../src/features/model';
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
  it('[[links]] must name dictionary cards; a photo needs alt text and a credit', () => {
    const f = base();
    f.scenes[0].blocks[0].en = 'Hello [[jazz]] and [[nowhere|there]]';
    f.art = [{ id: 'p', kind: 'photo', file: 'p.jpg', rights: 'p.jpg' }];
    f.scenes[1].photo = 'missing';
    const errs = validateFeature(f, { cards: new Set(['jazz']), rights: new Set(['p.jpg']) }).join('\n');
    expect(errs).toMatch(/card that does not exist: nowhere/);
    expect(errs).not.toMatch(/: jazz/);
    expect(errs).toMatch(/art p: a real photo needs alt and credit/);
    expect(errs).toMatch(/scene two: photo missing is not a photo in the feature's art list/);
  });
  it('a photo caption, when given, needs English and Russian', () => {
    const f = base();
    f.art = [{ id: 'p', kind: 'photo', file: 'p.jpg', rights: 'p.jpg', alt: bi('A', 'А'), credit: bi('C', 'К'), caption: { en: 'Only English' } as never }];
    expect(validateFeature(f, { rights: new Set(['p.jpg']) }).join('\n')).toMatch(/art p: caption needs en and ru/);
    f.art[0].caption = bi('Caption', 'Подпись');
    expect(validateFeature(f, { rights: new Set(['p.jpg']) })).toEqual([]);
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

describe('scene illustrations', () => {
  const layers = (): SceneArt => ({
    generated: true,
    layers: [
      { file: 'door-house.webp', depth: 6, alt: bi('A house', 'Дом') },
      { file: 'door-tree.webp', alt: '' },
      { file: 'door-porch.webp', state: 'closed', open: '0.1 0.4', pivot: '50 60', fit: { x: 2, scale: 0.9 }, alt: bi('A porch', 'Крыльцо') },
      { file: 'album-disc.webp', role: 'spin', spin: { x: 57, y: 72, ratio: 0.5 }, alt: '' },
    ],
  });
  const ctx = { artFiles: new Set(['door-house.webp', 'door-tree.webp', 'door-porch.webp', 'album-disc.webp']), ledger: new Set(['nina.jpg']) };
  it('a sound layered picture passes, and the build ships each file once', () => {
    expect(validateSceneArt(layers(), ctx)).toEqual([]);
    const f = base();
    f.scenes[0].art = layers();
    f.scenes[1].art = { generated: true, layers: [{ file: 'door-house.webp', alt: '' }] };
    expect(validateFeature(f, ctx)).toEqual([]);
    expect(sceneArtFiles(f)).toEqual(['door-house.webp', 'door-tree.webp', 'door-porch.webp', 'album-disc.webp']);
    expect(publishFeature(f).data.scenes[0].art?.layers).toHaveLength(4);
  });
  it('every layer exists and has alt text, or says it is decorative', () => {
    const a = layers();
    a.layers[0].file = 'door-gone.webp';
    delete (a.layers[1] as { alt?: unknown }).alt;
    a.layers[2].alt = { en: 'A porch', ru: '' };
    const errs = validateSceneArt(a, ctx).join('\n');
    expect(errs).toMatch(/door-gone.webp: no such file/);
    expect(errs).toMatch(/door-tree.webp: needs alt/);
    expect(errs).toMatch(/door-porch.webp: alt needs en and ru/);
    expect(validateSceneArt({ ...layers(), layers: [] }, ctx).join()).toMatch(/no layers/);
    expect(validateSceneArt('door.png', ctx).join()).toMatch(/generated: true, layers/);
  });
  it('generated art is marked generated and never mixed into the photo ledger', () => {
    const unmarked = { ...layers(), generated: false } as unknown as SceneArt;
    expect(validateSceneArt(unmarked, ctx).join()).toMatch(/must be marked generated: true/);
    const a = layers();
    a.layers[0].file = 'nina.jpg';
    const errs = validateSceneArt(a, { ...ctx, artFiles: new Set([...ctx.artFiles, 'nina.jpg']) }).join();
    expect(errs).toMatch(/nina.jpg: generated art must not be in the photo-rights ledger/);
    // A photo of the feature's own list cannot be passed off as a layer either.
    const f = base();
    f.art = [{ id: 'p', kind: 'photo', file: 'door-house.webp', rights: 'door-house.webp', alt: bi('x', 'х'), credit: bi('c', 'к') }, { id: 'g', kind: 'generated', file: 'nina.jpg' }];
    f.scenes[0].art = layers();
    const all = validateFeature(f, { ...ctx, rights: new Set(['door-house.webp']) }).join('\n');
    expect(all).toMatch(/scene one: art layer door-house.webp: generated art must not be in the photo-rights ledger/);
    expect(all).toMatch(/art g: generated art must not be in the photo-rights ledger/);
  });
  it('depths, roles, states, windows and spins are checked', () => {
    const a = layers();
    a.layers[0].depth = 500;
    a.layers[1].role = 'dance' as never;
    a.layers[2].state = 'Open Wide';
    a.layers[2].open = 'soon';
    a.layers[3].spin = undefined;
    const errs = validateSceneArt(a, ctx).join('\n');
    expect(errs).toMatch(/depth must be 0..80/);
    expect(errs).toMatch(/unknown role "dance"/);
    expect(errs).toMatch(/state must be a slug/);
    expect(errs).toMatch(/open must be "from to"/);
    expect(errs).toMatch(/spinning layer needs spin/);
    expect(validateSceneArt({ ...layers(), claps: { at: [[120, 5]] } }, ctx).join()).toMatch(/claps need at/);
    expect(validateSceneArt({ ...layers(), claps: { depth: 10, at: [[40, 34]] } }, ctx)).toEqual([]);
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
  it('is valid against its lineage, with the single-source lines held', () => {
    const sync = new Set((lin.sync ?? []).filter((s) => (s.sources ?? []).length).map((s) => s.work));
    const ledger = parse(readFileSync('../content/ledger/media.yaml', 'utf8')) as { file: string; feature?: string }[];
    const rights = new Set(ledger.filter((e) => e.feature === 'sea-lion-girls').map((e) => e.file));
    const cards = new Set(readdirSync('../content/cards').filter((x) => !/\.[a-z]{2}\.md$/.test(x)).map((x) => x.replace(/\.md$/, '')));
    const artFiles = new Set(readdirSync('../content/features/sea-lion-girls/art'));
    const all = new Set(ledger.map((e) => e.file));
    expect(validateFeature(f, { nodes: new Set(lin.nodes.map((n) => n.id)), sourced: sourcedNodes(lin), sync, rights, cards, artFiles, ledger: all })).toEqual([]);
    // The approved illustrations: every scene redrawn so far has its layers, generated and with alt fields.
    const drawn = f.scenes.filter((s) => s.art).map((s) => s.id);
    expect(drawn).toEqual(['door', 'ring', 'expedition', 'arrival', 'family', 'minute', 'album', 'simone', 'river', 'classroom', 'finale']);
    // Ring and minute: whole figures with their own hands, and ink where the hands meet.
    for (const id of ['ring', 'minute']) {
      const a = f.scenes.find((s) => s.id === id)!.art!;
      expect(a.layers.some((l) => /hands/.test(l.file)), id).toBe(false);
      expect(a.claps?.at.length, id).toBeGreaterThan(0);
      expect(validateSceneArt(a)).toEqual([]);
    }
    // The arrival opens the cover's door.
    expect(f.scenes.find((s) => s.id === 'arrival')!.art).toEqual(f.scenes.find((s) => s.id === 'door')!.art);
    // The minute's alt text never says which sister is which.
    const minuteAlt = JSON.stringify(f.scenes.find((s) => s.id === 'minute')!.art!.layers.map((l) => l.alt));
    expect(minuteAlt).not.toMatch(/Christine|Katherine|Кристин|Кэтрин/);
    expect(f.scenes.every((s) => !s.art || s.art.generated === true)).toBe(true);
    expect(sceneArtFiles(f).every((file) => artFiles.has(file))).toBe(true);
    expect(f.ui?.['art-credit']).toMatchObject({ en: 'Illustrations generated, edited by the museum', ru: 'Иллюстрации созданы нейросетью, отобраны музеем' });
    expect(validateLineage(lin)).toEqual([]);
    const blocks = f.scenes.flatMap((s) => s.blocks);
    expect(blocks.every((b) => typeof b.draft === 'boolean')).toBe(true);
    // Every line still resting on one source stays held: today only "learned by ear".
    const held = blocks.filter((b) => b.hold).map((b) => b.id);
    expect(held).toEqual(['by-ear']);
  });
  it('shows a cleared real photo on every stop with a person to see, each with its caption, credit and source', () => {
    const ledger = parse(readFileSync('../content/ledger/media.yaml', 'utf8')) as { file: string; feature?: string; url?: string; source_revision?: string; license_url?: string; caption?: { en: string; ru: string }; credit?: { en: string; ru: string } }[];
    const photos = Object.fromEntries(f.scenes.filter((s) => s.photo).map((s) => [s.id, s.photo]));
    expect(photos).toEqual({ simone: 'simone-1965', bass: 'hughes-1936', jazz: 'lateef-1964', beat: 'easybeats-1967', house: 'vega-2009', feist: 'feist-2006', kanye: 'kanye-2008', massive: 'massive-2010' });
    for (const [scene, id] of Object.entries(photos)) {
      if (scene === 'simone') continue;
      const a = f.art!.find((x) => x.id === id)!;
      const e = ledger.find((x) => x.file === a.file && x.feature === 'sea-lion-girls');
      expect(e, id).toBeDefined();
      expect(a.source, id).toBe(e!.url);
      expect(e!.source_revision, id).toMatch(/^https:\/\/commons\.wikimedia\.org\/w\/index\.php\?title=File:.+&oldid=\d+$/);
      expect(a.caption, id).toEqual(e!.caption);
      expect(a.credit, id).toEqual(e!.credit);
      // An attribution licence gets its link next to the credit.
      if (/creativecommons\.org\/licenses\//.test(e!.license_url ?? '')) expect(a.license_url, id).toBe(e!.license_url);
    }
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
