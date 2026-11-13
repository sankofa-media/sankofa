import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fill, parseInline, parseProse } from '../src/mechanics/guide/model';

describe('guide and dedication prose', () => {
  it('reads the title from front matter and turns paragraphs into blocks', () => {
    const d = parseProse('---\ntitle: "Hello"\n---\n\nFirst line\nsame paragraph.\n\n## Part\n\n> A quote\n> goes on.\n');
    expect(d.title).toBe('Hello');
    expect(d.blocks.map((b) => b.type)).toEqual(['p', 'h2', 'quote']);
    expect(d.blocks[0].inline).toEqual([{ t: 'text', s: 'First line same paragraph.' }]);
    expect(d.blocks[2].inline).toEqual([{ t: 'text', s: 'A quote goes on.' }]);
  });
  it('falls back to a level-one heading for the title', () => {
    expect(parseProse('# Title\n\nText').title).toBe('Title');
  });
  it('reads emphasis and links, and nothing else', () => {
    expect(parseInline('A *b* **c** [d](#view=atlas) <i>e</i>')).toEqual([
      { t: 'text', s: 'A ' },
      { t: 'em', s: 'b' },
      { t: 'text', s: ' ' },
      { t: 'strong', s: 'c' },
      { t: 'text', s: ' ' },
      { t: 'link', s: 'd', href: '#view=atlas' },
      { t: 'text', s: ' e' },
    ]);
  });
  it('lets through only the unseen span, and drops any other HTML', () => {
    expect(parseInline('Seen. <span class="unseen">Not *quite* <b>seen</b>.</span> <script>x</script>end')).toEqual([
      { t: 'text', s: 'Seen. ' },
      { t: 'unseen', s: 'Not *quite* seen.' },
      { t: 'text', s: ' xend' },
    ]);
    expect(parseInline('<span class="other">a</span>')).toEqual([{ t: 'text', s: 'a' }]);
  });
  it('fills numbers computed at run time', () => {
    expect(fill('{{cards}} cards, {{unknown}}', { cards: '99' })).toBe('99 cards, {{unknown}}');
  });
});

describe('the museum’s guide', () => {
  const root = join(__dirname, '../../content');
  for (const f of ['guide.md', 'guide.ru.md']) {
    const d = parseProse(readFileSync(join(root, f), 'utf8'));
    it(`${f}: titled, with the same sections in both languages`, () => {
      expect(d.title).toBeTruthy();
      expect(d.blocks.filter((b) => b.type === 'h2')).toHaveLength(10);
    });
    it(`${f}: uses only numbers the museum computes`, () => {
      const names = [...JSON.stringify(d).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
      for (const n of names) expect(['cards', 'pairs', 'documents', 'objects']).toContain(n);
    });
  }
  it('Russian uses «» quotes, not Latin ones', () => {
    expect(readFileSync(join(root, 'guide.ru.md'), 'utf8')).not.toMatch(/["“”]/);
  });
});

describe('the dedication page', () => {
  const web = join(__dirname, '..');
  const build = (content: string, out: string) => execFileSync(process.execPath, [join(web, 'scripts/build-mechanics.ts'), content, out], { stdio: 'pipe' });

  it('is built from whichever language file exists, and is absent without one', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'sankofa-ded-'));
    const content = join(tmp, 'content');
    const out = join(tmp, 'data');
    mkdirSync(join(content, 'cards'), { recursive: true });
    try {
      build(content, out);
      expect(existsSync(join(out, 'dedication.json'))).toBe(false);
      cpSync(join(web, 'fixtures/dedication/dedication.ru.md'), join(content, 'dedication.ru.md'));
      build(content, out);
      const d = JSON.parse(readFileSync(join(out, 'dedication.json'), 'utf8'));
      expect(d.ru.title).toBe('Тестовая страница');
      expect(d.en).toBeUndefined();
      expect(JSON.stringify(d.ru.blocks)).toContain('{"t":"unseen","s":"Скрытая часть заготовки."}');
      rmSync(join(content, 'dedication.ru.md'));
      build(content, out);
      expect(existsSync(join(out, 'dedication.json'))).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
