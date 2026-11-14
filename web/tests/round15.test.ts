import { describe, expect, it } from 'vitest';
import { LoadError, loadJson } from '../src/lib/loadJson';
import { paragraphsOf } from '../src/lib/paragraphs';
import { foldStepMarks, splitStepMarks, stepMarks } from '../src/lib/stepMarks';
import { layoutLives, type LifeIn } from '../src/views/timeline';
import { answering, guestLabel, guestMeaning } from '../src/lib/subtitles';
import { bookCount } from '../src/views/navMenu';
import type { Chapter } from '../src/lib/types';

const json = (body: unknown, status = 200, type = 'application/json') => new Response(JSON.stringify(body), { status, headers: { 'content-type': type } });

describe('loadJson: a slow line gets a timeout and another try', () => {
  it('returns the data', async () => {
    expect(await loadJson('a.json', { fetch: async () => json({ ok: 1 }) })).toEqual({ ok: 1 });
  });
  it('treats a 404 and an HTML fallback as absent, not as an error', async () => {
    expect(await loadJson('a.json', { fetch: async () => json({}, 404) })).toBeNull();
    expect(await loadJson('a.json', { fetch: async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }) })).toBeNull();
  });
  it('tries again after a failure and succeeds', async () => {
    let n = 0;
    const f = async () => (++n < 2 ? json({}, 503) : json({ ok: 2 }));
    expect(await loadJson('a.json', { fetch: f as typeof fetch, backoff: 1 })).toEqual({ ok: 2 });
    expect(n).toBe(2);
  });
  it('gives up a request that never answers, and says so', async () => {
    let calls = 0;
    const never = ((_: string, init?: RequestInit) =>
      new Promise((_r, reject) => {
        calls++;
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as typeof fetch;
    const err = (await loadJson('a.json', { fetch: never, timeout: 20, tries: 2, backoff: 1 }).catch((e: LoadError) => e)) as LoadError;
    expect(err).toBeInstanceOf(LoadError);
    expect(String(err.message)).toMatch(/no answer/);
    expect(calls).toBe(2);
  });
});

describe('paragraphsOf', () => {
  it('splits on blank lines and joins wrapped lines', () => {
    expect(paragraphsOf('One\nline.\n\nTwo.\r\n\r\nThree.\n \n')).toEqual(['One line.', 'Two.', 'Three.']);
  });
});

describe('step markers: {at Place · Year} and {img card:n}', () => {
  it('reads and strips them in any order', () => {
    expect(stepMarks('{at Timbuktu · 2012} The families kept them.')).toEqual({ text: 'The families kept them.', label: 'Timbuktu · 2012' });
    expect(stepMarks('{img mali-manuscripts:1} {at Тимбукту · 2012} Текст.')).toEqual({ text: 'Текст.', label: 'Тимбукту · 2012', img: { card: 'mali-manuscripts', index: 1 } });
    expect(stepMarks('No marker {at here}.')).toEqual({ text: 'No marker {at here}.' });
  });
  it('folds step objects and parallel fields, so the copy filter keeps each label with its paragraph', () => {
    const ch = {
      id: 'v0',
      title: 'T',
      kicker: '',
      years: [],
      places: [],
      cards: [],
      steps: [{ text: 'A', label: 'Here · 1300' }, 'B'] as unknown as string[],
      translations: { ru: { steps: ['А', 'Б'], stepLabels: [undefined, 'Там · 1400'] } as never },
    } as Chapter;
    const folded = foldStepMarks(ch);
    expect(folded.steps).toEqual(['{at Here · 1300} A', 'B']);
    expect(folded.translations!.ru.steps).toEqual(['А', '{at Там · 1400} Б']);
    const split = splitStepMarks(folded);
    expect(split.steps).toEqual(['A', 'B']);
    expect(split.stepLabels).toEqual(['Here · 1300', '']);
  });
  it('leaves a chapter without markers as it is', () => {
    const ch = { id: 'v1', title: 'T', kicker: '', years: [], places: [], cards: [], steps: ['A', 'B'] } as Chapter;
    expect(splitStepMarks(foldStepMarks(ch))).toBe(ch);
  });
});

describe('timeline: names are never cut and never overlap', () => {
  const measure = (s: string) => s.length * 7;
  const lives: LifeIn[] = [
    { id: 'musa', title: 'Mansa Musa', x0: 30, x1: 34 },
    { id: 'latino', title: 'Juan Latino', x0: 120, x1: 170 },
    { id: 'wells', title: 'Ida B. Wells', x0: 700, x1: 900 },
    { id: 'smalls', title: 'Robert Smalls', x0: 640, x1: 820 },
    { id: 'yaa', title: 'Yaa Asantewaa', x0: 600, x1: 840 },
    { id: 'thornton', title: 'Willie Mae “Big Mama” Thornton', x0: 880, x1: 1100 },
    { id: 'late', title: 'Someone with a long name at the end', x0: 1180, x1: 1195 },
  ];
  const out = layoutLives(lives, { measure, maxRows: 9, left: 4, right: 1200 });
  it('places every life with its whole name', () => {
    expect(out.overflow).toEqual([]);
    expect(out.placed.every((p) => p.label !== 'none')).toBe(true);
    // A short bar at the right edge names itself to the left.
    expect(out.placed.find((p) => p.id === 'late')!.label).toBe('before');
  });
  it('keeps every span in a row apart', () => {
    for (const a of out.placed)
      for (const b of out.placed) if (a !== b && a.row === b.row) expect(a.span[1] <= b.span[0] || b.span[1] <= a.span[0]).toBe(true);
  });
  it('a name inside its bar fits the bar', () => {
    for (const p of out.placed.filter((x) => x.label === 'in')) expect(measure(p.title) + 12).toBeLessThanOrEqual(p.x1 - p.x0);
  });
  it('sends what does not fit to the beads instead of overlapping', () => {
    const crowd = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, title: 'A rather long name', x0: 100, x1: 110 }));
    const r = layoutLives(crowd, { measure, maxRows: 2, left: 0, right: 400 });
    expect(r.placed.length).toBe(2);
    expect(r.overflow.length).toBe(3);
  });
});

describe('listening room in plain words', () => {
  it('names an unknown workload by what it is, not by its object name', () => {
    expect(guestLabel('bench-run', 'ru')).toBe('гостевая программа');
    expect(guestLabel('bench-run', 'en')).toBe('a visiting program');
    expect(guestMeaning('bench-run', 'en')).toMatch(/extra drum/);
  });
  it('says what a drum does instead of "16 ready"', () => {
    expect(answering(16, 0, 'en')).toBe('16 programs answer');
    expect(answering(21, 0, 'ru')).toBe('отвечает 21 программа');
    expect(answering(4, 1, 'ru', true)).toBe('отвечают 4, молчат 1');
  });
});

describe('the book count', () => {
  it('agrees with its number', () => {
    expect(bookCount(1, 'en')).toBe('1 card');
    expect(bookCount(3, 'ru')).toBe('3 карточки');
    expect(bookCount(11, 'ru')).toBe('11 карточек');
    expect(bookCount(21, 'ru')).toBe('21 карточка');
  });
});
