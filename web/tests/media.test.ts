import { describe, expect, it, vi } from 'vitest';
import { fitSrc, mediaSrc, setVariants } from '../src/lib/media';
import { firstBigNumber, narratedCards, pickInterlude, qualifierOf } from '../src/views/signature';
import type { Card } from '../src/lib/types';

const app = { media: (f: string) => `media/${f}` };

describe('media variants', () => {
  it('uses the original when there are no variants', () => {
    setVariants({});
    expect(mediaSrc(app, 'a.jpg')).toEqual({ src: 'media/a.jpg' });
  });
  it('picks the smallest variant that covers the width and lists all', () => {
    setVariants({ 'a.jpg': [480, 960] }, { 'a.jpg': 1800 });
    const r = mediaSrc(app, 'a.jpg', [600]);
    expect(r.src).toBe('media/w960/a.jpg');
    expect(r.srcset).toBe('media/w480/a.jpg 480w, media/w960/a.jpg 960w, media/a.jpg 1800w');
  });
});

describe('fitted copies', () => {
  it('give a phone the smallest copy that covers its screen at up to twice the density', () => {
    setVariants({ 'features/x/a.webp': [480, 960, 1600] }, { 'features/x/a.webp': 2400 });
    vi.stubGlobal('devicePixelRatio', 3);
    expect(fitSrc(app, 'features/x/a.webp', 390)).toBe('media/w960/features/x/a.webp');
    expect(fitSrc(app, 'features/x/a.webp', 768)).toBe('media/w1600/features/x/a.webp');
    // A large dense screen keeps the original.
    expect(fitSrc(app, 'features/x/a.webp', 1440)).toBe('media/features/x/a.webp');
    vi.stubGlobal('devicePixelRatio', 1);
    expect(fitSrc(app, 'features/x/a.webp', 1440)).toBe('media/w1600/features/x/a.webp');
    vi.unstubAllGlobals();
    setVariants({});
    expect(fitSrc(app, 'features/x/a.webp', 390)).toBe('media/features/x/a.webp');
  });
  it('serve a photograph as WebP when the build made one', () => {
    setVariants({ 'p.jpg': [480, 960] }, { 'p.jpg': 1600 }, ['p.jpg']);
    vi.stubGlobal('devicePixelRatio', 2);
    expect(fitSrc(app, 'p.jpg', 390)).toBe('media/w960/p.webp');
    expect(fitSrc(app, 'p.jpg', 1440)).toBe('media/p.webp');
    vi.unstubAllGlobals();
    setVariants({});
  });
});

describe('webp', () => {
  it('serves WebP copies when the build made them', () => {
    setVariants({ 'a.jpg': [480] }, { 'a.jpg': 900 }, ['a.jpg']);
    expect(mediaSrc(app, 'a.jpg', [480])).toEqual({ src: 'media/w480/a.webp', srcset: 'media/w480/a.webp 480w, media/a.webp 900w' });
    setVariants({});
  });
});

describe('signature numbers', () => {
  it('reads the number a card already states', () => {
    expect(firstBigNumber('lists the names of almost 100,000 Africans')).toBe(100000);
    expect(firstBigNumber('no numbers here, 1781')).toBeUndefined();
    expect(qualifierOf('A free database lists nearly 100,000 Africans')).toBe('nearly');
    expect(qualifierOf('lists 100,000 names')).toBeUndefined();
  });
});

import { shortLabel } from '../src/views/map';
describe('map labels', () => {
  it('keep the name and cut at a word', () => {
    expect(shortLabel('Partus sequitur ventrem: Virginia, 1662', 40)).toBe('Partus sequitur ventrem');
    expect(shortLabel('Joseph Bologne, Chevalier de Saint-Georges', 40)).toBe('Joseph Bologne');
    expect(shortLabel('Dahomey the Aro and the African side of the trade', 22)).toBe('Dahomey the Aro and…');
  });
});

describe('interludes', () => {
  const c = (id: string, extra: Partial<Card> = {}): Card => ({ id, kind: 'person', title: id, wow: 'a short hook', years: [1900], places: [], zoom: 4, books: ['heirs'], sources: [], body: '', ...extra });
  const img = { media: [{ type: 'image' as const, file: 'x.jpg', credit: '', license: '' }] };

  it('never picks a card the steps narrate, and none when all are narrated', () => {
    const cards = [c('timbuktu-manuscripts', img), c('mansa-musa'), c('kora', img)];
    expect(pickInterlude('v0', cards, new Set(['timbuktu-manuscripts']))?.id).toBe('kora');
    expect(pickInterlude('v0', cards, new Set())?.id).toBe('timbuktu-manuscripts');
    expect(pickInterlude('v0', cards, new Set(['timbuktu-manuscripts', 'mansa-musa', 'kora']))).toBeUndefined();
    expect(pickInterlude('v6', [c('big-mama-thornton'), c('funk')], narratedCards(['[[big-mama-thornton|Thornton]]’s “Hound Dog”']))?.id).toBe('funk');
  });
});
