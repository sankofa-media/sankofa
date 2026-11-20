import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { BLEND_FROM, decayAt, decayEffects, Drag, lyingProgress, THRESHOLDS, type DecayPoint } from '../src/features/engine/decay';
import { byteCapacity, codewords, encodeQR, formatBits, qrPath, rsRemainder, versionBits } from '../src/features/engine/qr';
import { FlashGate, publishFeature, sceneArtFiles, validateFeature, validateLenses, validateSceneArt, type FeatureSource } from '../src/features/model';
import { sortOverlays } from '../src/features/forever-changes/lee/mode';
import { existsSync } from 'node:fs';
import { VISION_IDS } from '../src/features/forever-changes/art';
import { BEHIND_FROM, BEHIND_GAP, facing, gap, intensity, MAX_AT_ONCE, movedToward, Scheduler, type Vision } from '../src/features/forever-changes/lee/scheduler';
import { leeUrl, wantsLee } from '../src/features/forever-changes/lee/url';
import { ECHOES, OFFICIAL_CHANNELS, SONGS } from '../src/features/forever-changes/recordings';

const fc = parse(readFileSync(new URL('../../content/features/forever-changes/feature.yaml', import.meta.url), 'utf8')) as FeatureSource;
const ids = fc.scenes.map((s) => s.id);
const points: DecayPoint[] = fc.scenes.map((s) => ({ decay: s.decay as number, settle: s.settle as boolean }));
const level = (id: string, p = 0.5) => decayAt(points, ids.indexOf(id), p);
const SIDE_A = ['alone-again-or', 'a-house-is-not-a-motel', 'andmoreagain', 'the-daily-planet', 'old-man', 'the-red-telephone'];
const SIDE_B = ['between-clark-and-hilldale', 'live-and-let-live', 'the-good-humor-man', 'bummer-in-the-summer', 'you-set-the-scene'];

describe('Forever Changes: the scenes', () => {
  it('every scene of the storyboard, in order, with the record turned over between the sides', () => {
    expect(ids).toEqual(['warning', 'prologue', 'hillside', 'session-day', 'diary', 'orchestra', ...SIDE_A, 'flip', ...SIDE_B, 'after', 'return', 'end', 'echoes', 'lee']);
    const songs = fc.scenes.filter((s) => s.kind === 'song').map((s) => s.song as { n: number; side: string });
    expect(songs.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(songs.map((s) => s.side).join('')).toBe('aaaaaabbbbb');
  });
  it('the content is valid and held lines never ship', () => {
    // Its photographs are cleared by the media ledger (the build also checks each file's checksum).
    const ledger = parse(readFileSync(new URL('../../content/ledger/media.yaml', import.meta.url), 'utf8')) as { file: string; feature?: string }[];
    expect(validateFeature(fc, { rights: new Set(ledger.filter((e) => e.feature === 'forever-changes').map((e) => e.file)) })).toEqual([]);
    expect(fc.scenes.every((s) => s.blocks.every((b) => typeof b.draft === 'boolean'))).toBe(true);
    const held = fc.scenes.flatMap((s) => s.blocks.filter((b) => b.hold));
    expect(held.length).toBeGreaterThanOrEqual(0);
    expect(held.every((b) => typeof b.check === 'string' && b.check.length > 0)).toBe(true);
    const { data } = publishFeature(fc);
    const shipped = JSON.stringify(data);
    for (const b of held) expect(shipped).not.toContain(b.en.trim().slice(0, 60));
    // Single-source stories from the storyboard stay out.
    expect(shipped).not.toContain('Benny Goodman');
    expect(shipped).not.toContain('Sharon Tate');
    expect(shipped).not.toContain('Philharmonic');
  });
  it('every vision is in the library and has a label; false names only where the page decays', () => {
    for (const s of fc.scenes) {
      for (const v of (s.visions as string[] | undefined) ?? []) {
        expect(VISION_IDS, `${s.id}: ${v}`).toContain(v);
        expect(fc.ui?.[`vision-${v}`], `vision-${v}`).toBeTruthy();
      }
      if (s.alias) expect(s.decay as number, s.id).toBeGreaterThanOrEqual(0.4);
      expect(s.name, `${s.id} needs a menu name`).toBeTruthy();
    }
    for (const id of ['the-red-telephone', 'the-daily-planet', 'old-man']) expect((fc.scenes.find((s) => s.id === id)!.visions as string[]).length).toBeGreaterThan(0);
    expect(fc.scenes.find((s) => s.id === 'the-red-telephone')!.visions).toContain('telephone');
    expect(fc.scenes.find((s) => s.id === 'the-daily-planet')!.visions).toContain('newspaper');
    expect(fc.scenes.find((s) => s.id === 'old-man')!.visions).toContain('old-man');
  });
  it('no more than a few words of any lyric', () => {
    // Quoted runs inside the narrator's song text stay short: at most a handful of words between quotes.
    for (const s of fc.scenes.filter((x) => x.kind === 'song'))
      for (const b of s.blocks.filter((x) => !x.lens && !x.hold && x.role !== 'quote'))
        for (const m of b.en.matchAll(/“([^”]+)”/g)) expect(m[1].split(/\s+/).length, `${s.id}/${b.id}: ${m[1]}`).toBeLessThanOrEqual(8);
  });
});

describe('the pictures', () => {
  const dir = new URL('../../content/features/forever-changes/art/', import.meta.url);
  it('every chapter has a generated picture, every file is there, and people stay unnamed in it', () => {
    for (const s of fc.scenes) {
      expect(s.art?.generated, s.id).toBe(true);
      expect(s.art!.layers.length, s.id).toBeGreaterThan(0);
      expect(validateSceneArt(s.art), s.id).toEqual([]);
      // The picture as a whole is described: its back layer (or each state's) has alt text.
      expect(s.art!.layers.some((l) => l.alt !== ''), s.id).toBe(true);
    }
    for (const f of sceneArtFiles(fc)) expect(existsSync(new URL(f, dir)), f).toBe(true);
    const alts = JSON.stringify(fc.scenes.map((s) => [...s.art!.layers, ...(s.art!.overlays ?? [])].map((l) => l.alt)));
    expect(alts).not.toMatch(/Arthur|Lee\b|Echols|Botnick|MacLean|Forssi|Holzman|Артур|Ли\b|Эколс/);
  });
  it('the chapters that follow the text have a state per part', () => {
    const states = (id: string) => [...new Set(fc.scenes.find((s) => s.id === id)!.art!.layers.map((l) => l.state))];
    expect(states('prologue')).toEqual(['memphis', 'dorsey', 'bido', 'castle']);
    expect(states('after')).toEqual(['after', 'prison']);
  });
  it('the real photographs are cleared, credited in both languages and never marked generated', () => {
    const ledger = parse(readFileSync(new URL('../../content/ledger/media.yaml', import.meta.url), 'utf8')) as { file: string; feature?: string; license?: string; license_url?: string; source_revision?: string }[];
    const all = (fc.art ?? []).filter((a) => a.kind === 'photo');
    expect(all.map((a) => a.id)).toEqual(['cover', 'love-1967', 'love-1966-ad', 'love-red-book-ad', 'echols-2019']);
    // The album cover is quoted in a review, as critics do, and says so.
    const cover = all.find((a) => a.id === 'cover')!;
    const quoted = ledger.find((x) => x.file === cover.file);
    expect(quoted?.feature).toBe('forever-changes');
    expect(quoted?.license).toMatch(/art\. 1274; fair use/);
    expect(cover.credit!.en).toContain('Bob Pepper');
    const photos = all.filter((a) => a.id !== 'cover');
    for (const a of photos) {
      const e = ledger.find((x) => x.file === a.file);
      expect(e?.feature, a.id).toBe('forever-changes');
      expect(e?.source_revision, a.id).toMatch(/oldid=\d+/);
      expect(a.credit?.en && a.credit?.ru, a.id).toBeTruthy();
      expect(a.source, a.id).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    }
    // CC BY-SA: the author and a link to the licence.
    const echols = photos.find((a) => a.id === 'echols-2019')!;
    expect(echols.credit!.en).toContain('Ghmyrtle');
    expect(echols.license_url).toBe('https://creativecommons.org/licenses/by-sa/4.0/');
    expect(validateFeature({ ...fc, art: [{ ...echols, license_url: 'http://x' }] })).toContain('art echols-2019: license_url must be an https link');
  });
  it('the Arthur Lee mode’s painted overlays are sorted into figures, faces and objects', () => {
    const lee = fc.scenes.find((s) => s.kind === 'lee')!.art!.overlays!;
    const o = sortOverlays(lee.map((l) => ({ file: l.file, src: l.file, alt: '' })));
    expect(o.figures.length).toBe(8);
    expect(o.faces.length).toBe(2);
    expect(Object.keys(o.objects).sort()).toEqual(['newspaper', 'old-man', 'telephone']);
    for (const id of Object.keys(o.objects)) expect(VISION_IDS, id).toContain(id);
  });
});

describe('decay: the curve through the album', () => {
  it('nothing at the door and in the prologue; it rises through side one to its peak at The Red Telephone', () => {
    expect(level('warning')).toBe(0);
    expect(level('prologue')).toBe(0);
    expect(level('hillside')).toBeGreaterThan(0);
    const a = SIDE_A.map((id) => level(id));
    expect(a[0]).toBeLessThan(a[1]);
    expect(a[1]).toBeLessThan(a[2]);
    expect(a[2]).toBeLessThan(a[3]);
    // Old Man is a breath before the peak.
    expect(a[4]).toBeLessThan(a[3]);
    const peak = Math.max(...fc.scenes.map((_, i) => decayAt(points, i, 0.5)));
    expect(level('the-red-telephone')).toBe(peak);
    expect(level('the-red-telephone')).toBe(1);
  });
  it('a breath in The Good Humor Man, back like nausea, and put back together in You Set the Scene and after', () => {
    expect(level('the-good-humor-man')).toBeLessThan(level('live-and-let-live'));
    expect(level('the-good-humor-man')).toBeLessThan(level('bummer-in-the-summer'));
    expect(level('bummer-in-the-summer')).toBeGreaterThan(0.5);
    expect(level('you-set-the-scene', 0)).toBeGreaterThan(0.3);
    expect(level('you-set-the-scene', 0.5)).toBeLessThan(level('you-set-the-scene', 0));
    expect(level('you-set-the-scene', 1)).toBe(0);
    for (const id of ['after', 'return', 'end', 'echoes', 'lee']) expect(level(id, 0.5), id).toBe(0);
  });
  it('a scene holds its level and blends into the next over its last fifth', () => {
    const pts = [{ decay: 0.2 }, { decay: 1 }];
    expect(decayAt(pts, 0, 0)).toBe(0.2);
    expect(decayAt(pts, 0, BLEND_FROM)).toBe(0.2);
    expect(decayAt(pts, 0, 0.9)).toBeGreaterThan(0.2);
    expect(decayAt(pts, 0, 1)).toBeCloseTo(1);
    expect(decayAt(pts, 1, 1)).toBe(1);
    expect(decayAt(pts, 5, 0.5)).toBe(0);
    expect(decayAt([{ decay: 3 }], 0, 0.5)).toBe(1);
  });
  it('effects switch on by threshold and stay bounded, so the text stays readable at the peak', () => {
    const none = decayEffects(0);
    expect(none).toMatchObject({ flow: 0, drift: 0, echo: 0, drag: 0, creep: false, lie: false, rename: false, watching: false });
    const peak = decayEffects(1);
    expect(peak).toMatchObject({ flow: 1, echo: 1, drag: 1, creep: true, lie: true, rename: true, watching: true });
    expect(peak.drift).toBeLessThanOrEqual(60);
    expect(decayEffects(THRESHOLDS.watching - 0.01).watching).toBe(false);
    expect(decayEffects(level('the-red-telephone')).watching).toBe(true);
    // Only The Red Telephone is watched.
    for (const id of ids.filter((x) => x !== 'the-red-telephone')) expect(decayEffects(level(id)).watching, id).toBe(false);
  });
  it('the drag lags behind the scroll, falls past its place, settles, and never goes beyond its bound', () => {
    const d = new Drag(40);
    for (let i = 0; i < 50; i++) d.push(120, 1);
    expect(d.offset).toBeLessThanOrEqual(40);
    let min = 0;
    for (let i = 0; i < 400; i++) min = Math.min(min, d.step(1 / 60));
    expect(min).toBeLessThan(0);
    expect(d.resting).toBe(true);
    const off = new Drag(40);
    off.push(500, 0);
    expect(off.offset).toBe(0);
  });
  it('the progress bar lies only when told, only for a moment, and comes back to the truth', () => {
    expect(lyingProgress(0.4, 500, false)).toBe(0.4);
    expect(lyingProgress(0.4, 500, true)).not.toBe(0.4);
    expect(lyingProgress(0.4, 3000, true)).toBe(0.4);
    for (let t = 0; t < 60_000; t += 250) {
      const v = lyingProgress(0.5, t, true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('lenses', () => {
  const lensed = (): FeatureSource => ({
    id: 'demo',
    title: { en: 'Demo', ru: 'Демо' },
    dek: { en: 'Demo', ru: 'Демо' },
    lenses: [
      { id: 'a', name: { en: 'A', ru: 'А' } },
      { id: 'b', name: { en: 'B', ru: 'Б' } },
      { id: 'quiet', name: { en: 'Q', ru: 'К' }, empty: true, silence: { en: 'He did not tell.', ru: 'Он не рассказал.' } },
    ],
    scenes: [
      {
        id: 'one',
        kind: 'text',
        lenses: ['a', 'b', 'quiet'],
        blocks: [
          { id: 'n', role: 'text', draft: true, en: 'Narrator', ru: 'Рассказчик' },
          { id: 'x', role: 'text', draft: true, lens: 'a', en: 'A says', ru: 'А говорит' },
          { id: 'y', role: 'text', draft: true, lens: 'b', en: 'B says', ru: 'Б говорит' },
        ],
      },
    ],
  });
  it('the content’s lenses check out: every listed witness speaks, David Angel only by his silence', () => {
    expect(validateLenses(fc)).toEqual([]);
    const angel = fc.lenses!.find((l) => l.id === 'angel')!;
    expect(angel.empty).toBe(true);
    expect(fc.scenes.some((s) => s.blocks.some((b) => b.lens === 'angel'))).toBe(false);
    expect(fc.scenes.find((s) => s.id === 'orchestra')!.lenses).toContain('angel');
    // The session players' day: three witnesses at least, side by side.
    const day = fc.scenes.find((s) => s.id === 'session-day')!;
    expect(day.differ).toBe(true);
    for (const l of ['botnick', 'echols', 'stuart-ware']) expect(day.lenses).toContain(l);
  });
  it('a sound lensed feature passes; the build keeps whose account each block is', () => {
    expect(validateFeature(lensed())).toEqual([]);
    const { data } = publishFeature(lensed());
    expect(data.lenses?.map((l) => l.id)).toEqual(['a', 'b', 'quiet']);
    expect(data.scenes[0].blocks.find((b) => b.id === 'x')?.lens).toBe('a');
    expect(data.scenes[0].blocks.find((b) => b.id === 'n')?.lens).toBeUndefined();
  });
  it('catches an unknown lens, a silent witness, an empty lens that speaks, and a lens not listed', () => {
    const f1 = lensed();
    f1.scenes[0].lenses = ['a', 'b', 'nobody'];
    expect(validateLenses(f1).join()).toContain('lens nobody is not defined');
    const f2 = lensed();
    f2.scenes[0].blocks = f2.scenes[0].blocks.filter((b) => b.id !== 'y');
    expect(validateLenses(f2).join()).toContain('lens b has nothing to say here');
    const f3 = lensed();
    f3.scenes[0].blocks.push({ id: 'z', role: 'text', draft: true, lens: 'quiet', en: 'Q', ru: 'К' });
    expect(validateLenses(f3).join()).toContain('left no account');
    const f4 = lensed();
    f4.scenes[0].lenses = ['a', 'quiet'];
    expect(validateLenses(f4).join()).toContain('lens b is not in the scene');
    const f5 = lensed();
    f5.scenes[0].blocks[1].hold = true;
    expect(validateLenses(f5).join()).toContain('lens a has nothing to say here');
    const f6 = lensed();
    delete f6.lenses![2].silence;
    expect(validateLenses(f6).join()).toContain('needs its silence');
  });
});

describe('the QR code to the phone', () => {
  it('carries the museum, the feature, the chapter and lee=1', () => {
    expect(leeUrl('https://museum.example/', 'the-red-telephone')).toBe('https://museum.example/features/forever-changes/#scene=the-red-telephone&lee=1');
    expect(leeUrl('https://museum.example/#old', 'old-man', 'ru')).toBe('https://museum.example/ru/features/forever-changes/#scene=old-man&lee=1');
    expect(leeUrl('https://museum.example/', 'bad scene!')).toBe('https://museum.example/features/forever-changes/#lee=1');
    expect(wantsLee('#view=feature&item=forever-changes&lee=1')).toBe(true);
    expect(wantsLee('#view=feature&item=forever-changes')).toBe(false);
  });
  it('encodes in the smallest version that fits, with its finders, timing and format', () => {
    const url = leeUrl('https://museum.sankofa.workshop.aenix.io/', 'between-clark-and-hilldale', 'ru');
    const q = encodeQR(url);
    expect(byteCapacity(q.version)).toBeGreaterThanOrEqual(url.length);
    expect(byteCapacity(q.version - 1)).toBeLessThan(url.length);
    expect(q.size).toBe(q.version * 4 + 17);
    const m = q.modules;
    const finder = (x: number, y: number) => [0, 6].every((d) => m[y][x + d] && m[y + d][x]) && m[y + 3][x + 3] && !m[y + 1][x + 1];
    expect(finder(0, 0)).toBe(true);
    expect(finder(q.size - 7, 0)).toBe(true);
    expect(finder(0, q.size - 7)).toBe(true);
    for (let i = 8; i < q.size - 8; i++) expect(m[6][i]).toBe(i % 2 === 0);
    // The dark module beside the lower finder.
    expect(m[q.size - 8][8]).toBe(true);
    expect(qrPath(q).size).toBe(q.size + 8);
    expect(() => encodeQR('x'.repeat(300))).toThrow();
  });
  it('the error correction and the format and version words are the standard ones', () => {
    // Level M, mask 0: the format word is the mask pattern itself.
    expect(formatBits(0)).toBe(0x5412);
    expect(versionBits(7)).toBe(0x07c94);
    expect(versionBits(10)).toBe(0x0a4d3);
    // The worked example of the standard (1-M, "01234567"): its ten EC codewords.
    expect(rsRemainder([0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11], 10)).toEqual([0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]);
    expect(codewords([...new TextEncoder().encode('a')], 1)).toHaveLength(26);
  });
});

describe('the Arthur Lee mode: the scheduler of visions', () => {
  it('grows stronger the longer it runs, and visions come more often', () => {
    expect(intensity(0)).toBe(0);
    expect(intensity(120)).toBeGreaterThan(0.4);
    expect(intensity(600)).toBeGreaterThan(0.95);
    expect(intensity(600)).toBeLessThan(1);
    expect(gap(1)).toBeLessThan(gap(0));
  });
  it('the chapter’s own object comes first, never a crowd, and someone stands behind only later and rarely', () => {
    const s = new Scheduler(['telephone'], 42);
    const seen: Vision[] = [];
    for (let t = 0; t <= 3600; t += 0.25) {
      seen.push(...s.tick(t));
      expect(s.active(t).length).toBeLessThanOrEqual(MAX_AT_ONCE);
    }
    expect(seen[0]).toMatchObject({ kind: 'object', object: 'telephone' });
    expect(seen[0].at).toBeLessThan(10);
    const behind = seen.filter((v) => v.kind === 'behind');
    expect(behind.length).toBeGreaterThan(0);
    for (const b of behind) expect(intensity(b.at)).toBeGreaterThanOrEqual(BEHIND_FROM);
    for (let i = 1; i < behind.length; i++) expect(behind[i].at - behind[i - 1].at).toBeGreaterThanOrEqual(BEHIND_GAP);
    expect(new Set(seen.map((v) => v.kind))).toEqual(new Set(['object', 'figure', 'face', 'behind', 'eyes']));
    const early = seen.filter((v) => v.at < 120).length;
    const late = seen.filter((v) => v.at >= 1200 && v.at < 1320).length;
    expect(late).toBeGreaterThan(early);
    // Figures stand at the edge of the frame.
    for (const f of seen.filter((v) => v.kind === 'figure')) expect(Math.abs(f.x)).toBe(1);
  });
  it('follows the chapter, melts what is looked at, and is the same for the same seed', () => {
    const a = new Scheduler(['newspaper'], 7);
    const b = new Scheduler(['newspaper'], 7);
    const ta: Vision[] = [];
    const tb: Vision[] = [];
    for (let t = 0; t < 300; t += 0.5) {
      ta.push(...a.tick(t));
      tb.push(...b.tick(t));
    }
    expect(ta).toEqual(tb);
    a.setObjects(['old-man']);
    let next: Vision | undefined;
    for (let t = 300; !next && t < 400; t += 0.5) next = a.tick(t).find((v) => v.kind === 'object');
    expect(next?.object).toBe('old-man');
    const live = a.active(next!.at);
    a.melt(live[0]);
    expect(a.active(next!.at)).not.toContain(live[0]);
  });
  it('turning toward a figure, by the compass or by the picture moving on its side', () => {
    expect(facing(5, 350)).toBe(true);
    expect(facing(350, 5)).toBe(true);
    expect(facing(10, 350)).toBe(false);
    expect(facing(90, 10)).toBe(false);
    expect(movedToward(-1, { left: 0.3, right: 0 })).toBe(true);
    expect(movedToward(1, { left: 0.3, right: 0.01 })).toBe(false);
  });
  it('the telephone’s light never rings more than three times a second', () => {
    const g = new FlashGate(3, 1000);
    let rings = 0;
    for (let t = 0; t < 1000; t += 50) if (g.allow(t)) rings++;
    expect(rings).toBe(3);
  });
});

describe('official recordings', () => {
  it('every song chapter plays the album track from the official channel, each id checked', () => {
    expect(Object.keys(SONGS).sort()).toEqual([...SIDE_A, ...SIDE_B].sort());
    const all = [...Object.values(SONGS), ...ECHOES];
    for (const r of all) {
      expect(r.youtube).toMatch(/^[A-Za-z0-9_-]{11}$/);
      expect(r.channel).toMatch(OFFICIAL_CHANNELS);
      expect(r.verified).toContain('oEmbed');
    }
    expect(new Set(all.map((r) => r.youtube)).size).toBe(all.length);
    for (const r of Object.values(SONGS)) expect(r.channel).toBe('Love - Topic');
    expect(ECHOES.map((r) => r.artist)).toEqual(['UFO', 'The Damned', 'Calexico']);
  });
});
