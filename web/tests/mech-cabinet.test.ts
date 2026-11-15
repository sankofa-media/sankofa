import { describe, expect, it } from 'vitest';
import {
  anchorIn,
  drawerOpen,
  EMPTY,
  isLocked,
  openCache,
  parseHoldings,
  reachable,
  slots,
  sortInto,
  tally,
  unlockDrawer,
  validateCabinet,
  type CabinetFile,
  type Fact,
  type Known,
} from '../src/mechanics/cabinet/model';

const L = (en: string, ru = en + ' (ru)') => ({ en, ru });
const src = (u: string) => ({ title: u, url: u, quote: 'a passage' });
const two = (id: string): Fact => ({ id, claim: 'a fact', sources: [src('https://loc.gov/x'), src('https://si.edu/y')] });

function file(): CabinetFile {
  return {
    version: 1,
    intro: L('A cabinet'),
    drawers: [
      { id: 'heap', label: L('Plyushkin’s corner') },
      { id: 'seas', label: L('Seas') },
      { id: 'seals', label: L('Seals and patents') },
      { id: 'underground', label: L('Underground'), lock: 'brass-key', intro: L('Secret'), contents: ['still-book'] },
      { id: 'honest', label: L('Honest'), intro: L('Where these things came from'), contents: ['benin-head'] },
    ],
    keys: [
      { id: 'brass-key', name: L('A brass key'), note: L('Small') },
      { id: 'iron-key', name: L('An iron key'), note: L('Heavy') },
    ],
    caches: [
      { id: 'chest', kind: 'chest', name: L('Sea chest'), place: L('Liverpool'), time: L('1790s'), story: L('A chest'), hidden: { at: 'card-image', card: 'equiano', x: 40, y: 60 }, contents: { both: ['certificate'], m: ['m-thing'], f: ['f-thing'] }, gives: ['iron-key'] },
      { id: 'box', kind: 'box', name: L('Box'), place: L('Philadelphia'), time: L('1849'), story: L('A box'), hidden: { at: 'chapter-step', chapter: 'v2', anchor: L('logged hundreds', 'вносил в журнал') }, contents: { both: ['lithograph'] }, gives: ['brass-key'] },
      { id: 'strongbox', kind: 'strongbox', name: L('Strongbox'), place: L('Washington'), time: L('1882'), story: L('Patents'), hidden: { at: 'workshop', object: 'amen' }, lock: 'iron-key', contents: { both: ['patent'] } },
    ],
    artifacts: ['certificate', 'm-thing', 'f-thing', 'lithograph', 'patent', 'still-book', 'benin-head'].map((id) => ({
      id,
      drawer: id === 'patent' ? 'seals' : id === 'still-book' ? 'underground' : id === 'benin-head' ? 'honest' : id === 'f-thing' ? 'heap' : 'seas',
      shape: 'paper' as const,
      image: `cab-${id}.jpg`,
      caption: L(`Caption ${id}`),
      credit: 'Library of Congress',
      license: 'Public domain',
      url: 'https://loc.gov/item',
      place: L('Somewhere'),
      year: '1849',
      note: L('Why it is here'),
      cards: ['equiano'],
    })),
  };
}

function known(f: CabinetFile, patch: Partial<Known> = {}): Known {
  return {
    cards: new Set(['equiano']),
    chapters: new Set(['v2']),
    objects: new Set(['amen', 'tr808']),
    media: new Set(f.artifacts.map((a) => a.image)),
    rights: new Set(f.artifacts.map((a) => a.image)),
    text: (_kind, _id, lang) => (lang === 'en' ? 'Real records exist: William Still logged hundreds of fugitives' : 'Уильям Стилл вносил в журнал сотни беглецов'),
    facts: [...f.caches.map((c) => two(`cache:${c.id}`)), ...f.artifacts.map((a) => two(`artifact:${a.id}`)), two('drawer:underground'), two('drawer:honest')],
    ...patch,
  };
}

describe('cabinet: validation', () => {
  it('accepts a whole cabinet', () => {
    const f = file();
    expect(validateCabinet(f, known(f))).toEqual([]);
  });
  it('fails on dangling references', () => {
    const f = file();
    f.caches[0].contents.both = ['nothing-here'];
    f.caches[0].hidden = { at: 'card-image', card: 'no-such-card', x: 10, y: 10 };
    f.caches[2].lock = 'no-key';
    f.caches[2].hidden = { at: 'workshop', object: 'kazoo' };
    const errs = validateCabinet(f, known(f)).join('\n');
    expect(errs).toMatch(/artifact nothing-here does not exist/);
    expect(errs).toMatch(/card no-such-card does not exist/);
    expect(errs).toMatch(/key no-key does not exist/);
    expect(errs).toMatch(/no object kazoo/);
    expect(errs).toMatch(/certificate: lies in no cache and no drawer/);
  });
  it('fails on a missing translation', () => {
    const f = file();
    f.artifacts[0].note = { en: 'Why', ru: '' };
    f.caches[1].story = { en: '', ru: 'Ящик' };
    const errs = validateCabinet(f, known(f)).join('\n');
    expect(errs).toMatch(/artifact certificate: note needs English and Russian/);
    expect(errs).toMatch(/cache box: story needs English and Russian/);
  });
  it('fails on an artifact without a rights record', () => {
    const f = file();
    const k = known(f);
    k.rights.delete('cab-patent.jpg');
    expect(validateCabinet(f, k).join('\n')).toMatch(/cab-patent\.jpg has no rights record/);
  });
  it('fails on an anchor that is not in the text, or only inside a link', () => {
    const f = file();
    expect(validateCabinet(f, known(f, { text: () => 'nothing of the sort' })).join('\n')).toMatch(/anchor "logged hundreds" is not in the text of chapter v2/);
    expect(anchorIn('he [[still|logged hundreds]] of them', 'logged hundreds')).toBe(false);
    expect(anchorIn('в Тилбери, Эссекс', 'в Тилбери')).toBe(true);
    expect(anchorIn('в Тилбери', 'в Тилбери')).toBe(true);
  });
  it('wants two independent sources per fact, and Wikipedia does not count', () => {
    const f = file();
    const k = known(f);
    k.facts[0] = { id: 'cache:chest', claim: 'x', sources: [src('https://en.wikipedia.org/wiki/A'), src('https://loc.gov/b')] };
    k.facts[1] = { id: 'cache:box', claim: 'y', sources: [src('https://loc.gov/a'), src('https://www.loc.gov/b')] };
    const errs = validateCabinet(f, k).join('\n');
    expect(errs).toMatch(/ledger: cache:chest/);
    expect(errs).toMatch(/ledger: cache:box/);
  });
  it('refuses a key nobody can find, and a cache that holds its own key', () => {
    const f = file();
    f.caches[0].gives = [];
    f.caches[2].gives = ['iron-key'];
    const errs = validateCabinet(f, known(f)).join('\n');
    expect(errs).toMatch(/cache strongbox: holds its own key/);
  });
  it('refuses a cache that is empty in one copy', () => {
    const f = file();
    f.caches[0].contents = { m: ['certificate', 'm-thing', 'f-thing'] };
    expect(validateCabinet(f, known(f)).join('\n')).toMatch(/cache chest: holds nothing in the f copy/);
  });
});

describe('cabinet: a reader finds things', () => {
  it('the two copies hold different things in the same chest', () => {
    const f = file();
    expect(openCache(f, EMPTY, 'chest', 'm').artifacts).toEqual(['certificate', 'm-thing']);
    expect(openCache(f, EMPTY, 'chest', 'f').artifacts).toEqual(['certificate', 'f-thing']);
    expect(reachable(f, 'm').has('f-thing')).toBe(false);
    expect(tally(f, EMPTY, 'm')).toEqual({ have: 1, of: 6 });
  });
  it('finds land in Plyushkin’s corner, and are sorted into their drawers', () => {
    const f = file();
    let h = openCache(f, EMPTY, 'chest', 'm').state;
    expect(slots(f, h, 'heap', 'm').map((s) => s.artifact.id)).toEqual(['certificate', 'm-thing']);
    // In its drawer, a thing not yet sorted is neither there nor dust.
    expect(slots(f, h, 'seas', 'm').map((s) => s.artifact.id)).toEqual(['lithograph']);
    expect(slots(f, h, 'seas', 'm')[0].here).toBe(false);
    h = sortInto(f, h, 'certificate');
    expect(slots(f, h, 'heap', 'm').map((s) => s.artifact.id)).toEqual(['m-thing']);
    expect(slots(f, h, 'seas', 'm').find((s) => s.artifact.id === 'certificate')?.here).toBe(true);
    expect(h.keys).toEqual(['iron-key']);
  });
  it('a locked cache opens only with its key, found elsewhere', () => {
    const f = file();
    const shut = openCache(f, EMPTY, 'strongbox', 'm', true);
    expect(shut.status).toBe('locked');
    expect(shut.state).toBe(EMPTY);
    const withKey = openCache(f, EMPTY, 'chest', 'm').state;
    expect(isLocked(f.caches[2], withKey)).toBe(true);
    expect(openCache(f, withKey, 'strongbox', 'm').status).toBe('locked');
    const r = openCache(f, withKey, 'strongbox', 'm', true);
    expect(r.status).toBe('unlocked');
    expect(r.state.found).toContain('patent');
    expect(openCache(f, r.state, 'strongbox', 'm').status).toBe('again');
  });
  it('a secret drawer opens with its key, and its things are there at once', () => {
    const f = file();
    const d = f.drawers.find((x) => x.id === 'underground')!;
    expect(drawerOpen(d, EMPTY)).toBe(false);
    expect(unlockDrawer(f, EMPTY, 'underground')).toBe(EMPTY);
    const h = unlockDrawer(f, openCache(f, EMPTY, 'box', 'm').state, 'underground');
    expect(drawerOpen(d, h)).toBe(true);
    expect(slots(f, h, 'underground', 'm')).toEqual([{ artifact: f.artifacts.find((a) => a.id === 'still-book'), here: true }]);
  });
  it('the honest drawer is open to everyone, nothing hidden', () => {
    const f = file();
    expect(slots(f, EMPTY, 'honest', 'f').map((s) => s.here)).toEqual([true]);
  });
  it('storage that is broken or empty is an empty cabinet', () => {
    expect(parseHoldings(null)).toEqual(EMPTY);
    expect(parseHoldings('{oops')).toEqual(EMPTY);
    expect(parseHoldings('{"found":["a",3],"keys":"x"}')).toEqual({ ...EMPTY, found: ['a'] });
  });
});
