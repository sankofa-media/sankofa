import { describe, expect, it } from 'vitest';
import { around, cssIdent, cssPath, dataIds, describe as describeEl, deviceKind, excerpt, pageOf, pickable, resolve, type ElLike } from '../src/review/locator';
import { splitReviewHash } from '../src/lib/reviewGate';

/** A tiny element tree, enough for the locator. */
class Fake implements ElLike {
  parentElement: Fake | null = null;
  children: Fake[] = [];
  attributes: { name: string; value: string }[];
  constructor(
    readonly tagName: string,
    attrs: Record<string, string> = {},
    private readonly own = '',
    kids: Fake[] = [],
  ) {
    this.attributes = Object.entries(attrs).map(([name, value]) => ({ name, value }));
    for (const k of kids) {
      k.parentElement = this;
      this.children.push(k);
    }
  }
  get id(): string {
    return this.getAttribute('id') ?? '';
  }
  get textContent(): string {
    return this.own + this.children.map((c) => c.textContent).join('');
  }
  getAttribute(name: string): string | null {
    return this.attributes.find((a) => a.name === name)?.value ?? null;
  }
}

const P = (attrs: Record<string, string>, text: string, kids: Fake[] = []) => new Fake('P', attrs, text, kids);

function tree() {
  const em = new Fake('EM', {}, 'sang');
  const p2 = P({ class: 'ft-p' }, 'The ring of children ', [em]);
  const block = new Fake('DIV', { 'data-block': 'b2', 'data-state': 'lit', class: 'ft-block' }, '', [P({}, 'First line.'), p2]);
  const scene = new Fake('SECTION', { 'data-scene': 'ring', class: 'ft-scene' }, '', [new Fake('H2', {}, 'The ring'), block]);
  const art = new Fake('ARTICLE', { class: 'ft', 'data-feature-id': 'sea-lion-girls' }, '', [scene]);
  const sheet = new Fake('SECTION', { class: 'ft-sheet', role: 'dialog' }, '', [new Fake('DIV', { class: 'ft-bar' }), art]);
  const body = new Fake('BODY', {}, '', [new Fake('MAIN', { id: 'story' }), sheet]);
  new Fake('HTML', {}, '', [body]);
  return { em, p2, block, scene, art, body };
}

describe('the review locator', () => {
  it('builds a CSS path anchored on the data ids, with positions only where needed', () => {
    const { p2, block } = tree();
    expect(cssPath(p2)).toBe('body > section > article[data-feature-id="sea-lion-girls"] > section[data-scene="ring"] > div[data-block="b2"] > p:nth-of-type(2)');
    expect(cssPath(block)).toBe('body > section > article[data-feature-id="sea-lion-girls"] > section[data-scene="ring"] > div[data-block="b2"]');
  });

  it('stops at a stable id', () => {
    const story = new Fake('MAIN', { id: 'story' }, '', [new Fake('ARTICLE', { 'data-chapter': 'v1' }, '', [P({}, 'one'), P({}, 'two')])]);
    new Fake('BODY', {}, '', [story]);
    expect(cssPath(story.children[0].children[1])).toBe('#story > article[data-chapter="v1"] > p:nth-of-type(2)');
    // Generated-looking ids are not trusted.
    const gen = new Fake('DIV', { id: 'x-1700000000' }, '', [P({}, 'a')]);
    new Fake('BODY', {}, '', [gen]);
    expect(cssPath(gen.children[0])).toBe('body > div > p');
  });

  it('collects the ids around an element, nearest first, without state', () => {
    const { p2 } = tree();
    const ids = dataIds(p2);
    expect(ids).toEqual({ block: 'b2', scene: 'ring', 'feature-id': 'sea-lion-girls' });
    expect(Object.keys(ids)[0]).toBe('block');
  });

  it('describes an element and climbs from inline bits to their block', () => {
    const { em, p2 } = tree();
    expect(pickable(em)).toBe(p2);
    const t = describeEl(p2);
    expect(t.tag).toBe('p');
    expect(t.text).toBe('The ring of children sang');
    expect(t.classes).toEqual(['ft-p']);
  });

  it('keeps a selection with its surroundings, cut on word boundaries', () => {
    const full = 'In the yard the ring of children sang a song the whole world knows today.';
    const start = full.indexOf('sang');
    const s = around(full, start, start + 4, 20);
    expect(s.text).toBe('sang');
    expect(s.before).toBe('ring of children');
    expect(s.after).toBe('a song the whole');
  });

  it('finds an element again by its path, then by ids and text when the path moved', () => {
    const { p2 } = tree();
    const t = describeEl(p2);
    const finder = (map: Record<string, Fake[]>) => ({
      querySelector: (s: string) => map[s]?.[0] ?? null,
      querySelectorAll: (s: string) => map[s] ?? [],
    });
    expect(resolve(t, finder({ [t.css]: [p2] }))).toBe(p2);
    // The path now points at another paragraph: the text tells them apart and the ids find it.
    const other = P({}, 'Something else entirely');
    expect(resolve(t, finder({ [t.css]: [other], 'p[data-block="b2"], [data-block="b2"] p': [other, p2] }))).toBe(p2);
    expect(resolve({ ...t, data: {} }, finder({ [t.css]: [other] }))).toBeNull();
  });

  it('escapes identifiers and folds text', () => {
    expect(cssIdent('a b')).toBe('a\\ b');
    expect(cssIdent('1x')).toBe('\\31 x');
    expect(excerpt('  a \n\n b  ')).toBe('a b');
    expect(excerpt('abcdef', 4)).toBe('abc…');
  });

  it('names the page and the device', () => {
    expect(pageOf('#view=feature&item=sea-lion-girls&scene=ring')).toEqual({ key: 'feature:sea-lion-girls', view: 'feature', item: 'sea-lion-girls', scene: 'ring', chapter: undefined });
    expect(pageOf('#ch=v1&step=3').key).toBe('museum');
    expect(pageOf('').key).toBe('museum');
    expect(pageOf('#view=atlas').key).toBe('atlas');
    expect(deviceKind(390, 844, true)).toBe('phone');
    expect(deviceKind(820, 1180, true)).toBe('tablet');
    expect(deviceKind(1440, 900, false)).toBe('desktop');
  });
});

describe('the review gate', () => {
  it('takes the token out of the link and keeps the rest', () => {
    expect(splitReviewHash('#review=abc123&view=feature&item=angel')).toEqual({ token: 'abc123', rest: '#view=feature&item=angel' });
    expect(splitReviewHash('#review=abc123')).toEqual({ token: 'abc123', rest: '' });
    expect(splitReviewHash('#review=off&lang=ru')).toEqual({ token: null, rest: '#lang=ru' });
    expect(splitReviewHash('#view=features')).toEqual({ token: undefined, rest: '#view=features' });
  });
});
