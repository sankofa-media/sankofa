import { describe, expect, it } from 'vitest';
import type { Card, Chapter } from '../src/lib/types';
import type { FeatureData, FeaturesIndex } from '../src/features/model';
import { buildPages, type SeoInput, type SeoPage } from '../scripts/seo/pages';
import { featuresAtom, llmsFullTxt, llmsTxt, robotsTxt, sitemaps, AI_CRAWLERS } from '../scripts/seo/files';
import { headHtml, renderPage } from '../scripts/seo/render';
import { describe as describeText, linked } from '../scripts/seo/text';
import { contentKey, homeText } from '../scripts/seo/plugin';

const SITE = 'https://sankofa.black';
const bi = (en: string, ru: string) => ({ en, ru });

const card = (id: string, extra: Partial<Card> = {}): Card => ({
  id,
  kind: 'person',
  title: `Title ${id}`,
  wow: `The wow of ${id}. It is a sentence.`,
  years: [1900],
  places: [{ name: 'Lagos', lat: 6.5, lon: 3.4 }],
  zoom: 3,
  era: 'v0',
  books: ['voices'],
  sources: [{ title: 'A source', url: 'https://example.org/source' }],
  body: `First paragraph about [[other|the other]].\n\n{male} Only the male copy.\n\n{female} Only the female copy.`,
  translations: { ru: { title: `Заголовок ${id}`, wow: `Удивление ${id}.`, body: 'Первый абзац.' } },
  ...extra,
});

const feature = (id: string): FeatureData => ({
  version: 1,
  id,
  title: bi(`${id}: a story`, `${id}: история`),
  dek: bi('In 1939 two sisters sang. The song went on.', 'В 1939 году две сестры спели. Песня пошла дальше.'),
  reading: bi('20 minutes', '20 минут'),
  ui: {},
  art: [{ id: 'p1', kind: 'photo', file: 'photo.jpg', alt: bi('A photo', 'Фото'), caption: bi('Caption', 'Подпись'), credit: bi('Photo: X, CC BY 2.0', 'Фото: X, CC BY 2.0') }],
  lenses: [{ id: 'lee', name: bi('Arthur Lee', 'Артур Ли'), role: bi('singer', 'певец') }],
  scenes: [
    {
      id: 'one',
      kind: 'text',
      photo: 'p1',
      song: { title: 'Alone Again Or', writer: 'Bryan MacLean' },
      blocks: [
        { id: 'k', role: 'kicker', en: 'Kicker', ru: 'Кикер', draft: false },
        { id: 't', role: 'title', en: 'A title', ru: 'Заголовок', draft: false },
        { id: 'x', role: 'text', en: 'Text with [[a|a card]] & <tags>.', ru: 'Текст.', draft: false },
        { id: 'q', role: 'quote', en: 'He said it.', ru: 'Он сказал.', draft: false, lens: 'lee' },
      ],
    },
  ],
  lineage: {
    nodes: [
      { id: 'n1', title: 'Sea Lion Woman', artist: 'The Shipp sisters', year: 1939, kind: 'field-recording', parents: [], branch: 'girls', glyph: 'clap', categories: [], link: 'https://www.loc.gov/item/x/', sources: [{ title: 'LoC record', url: 'https://www.loc.gov/item/x/' }] },
    ] as never,
    sync: [],
  },
});

function input(featureIds = ['sea-lion-girls', 'brand-new']): SeoInput {
  const features: FeaturesIndex = {
    version: 1,
    ui: { 'list-title': bi('Special projects', 'Спецпроекты'), 'list-dek': bi('Long stories.', 'Большие истории.') },
    features: featureIds.map((id) => ({ id, title: feature(id).title, dek: feature(id).dek, scenes: 1, ...(id === 'brand-new' ? { seo: { description: bi('A short own description.', 'Своё короткое описание.') } } : {}) })),
  };
  const chapters: Chapter[] = [{ id: 'v0', title: 'Africa Before', kicker: '1200s', years: [1200, 1850], places: [], cards: ['a', 'other'], steps: ['The story starts with [[a|a song]].'], translations: { ru: { title: 'Африка до работорговли', steps: ['История начинается с песни.'] } } }];
  return {
    site: SITE,
    cards: [card('a', { media: [{ type: 'image', file: 'a.jpg', caption: 'A caption', credit: 'Someone', license: 'CC BY 4.0' }] }), card('other')],
    chapters,
    features,
    featureData: Object.fromEntries(featureIds.map((id) => [id, feature(id)])),
    guide: { version: 1, en: { title: 'How to read this museum', blocks: [{ type: 'p', inline: [{ t: 'text', s: 'Sankofa is a museum. ' }, { t: 'card', id: 'a', s: 'A' }, { t: 'unseen', s: 'Hidden.' }] }] } },
    home: { en: { title: 'Sankofa — Go back and fetch it', description: 'Seven centuries of Black culture.', lede: ['This museum tells seven centuries.'] }, ru: { title: 'Sankofa — Вернись и забери', description: 'Семь веков чёрной культуры.', lede: ['Этот музей рассказывает.'] } },
    dates: (k) => (k.startsWith('feature:') ? { first: '2026-11-01T10:00:00Z', last: '2026-11-19T10:00:00Z' } : {}),
    featureImage: (id) => ({ url: `${SITE}/social/features/${id}.jpg`, width: 1200, height: 630 }),
    defaultImage: { url: `${SITE}/social-card.jpg`, width: 1200, height: 630 },
  };
}

const graph = (p: SeoPage) => p.jsonLd as Record<string, unknown>[];
const ofType = (p: SeoPage, t: string) => graph(p).find((n) => n['@type'] === t || (Array.isArray(n['@type']) && (n['@type'] as string[]).includes(t)));

describe('the crawlable pages', () => {
  const pages = buildPages(input());
  const at = (path: string) => pages.find((p) => p.path === path)!;

  it('has one page per route and language, every feature included without naming it', () => {
    const paths = pages.map((p) => p.path);
    for (const p of ['/', '/ru/', '/features/', '/ru/features/', '/features/sea-lion-girls/', '/ru/features/brand-new/', '/chapters/v0/', '/cards/a/', '/ru/cards/other/', '/guide/', '/ru/guide/']) expect(paths).toContain(p);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('gives every page a title, a short description, alternates and an image', () => {
    for (const p of pages) {
      expect(p.title, p.path).toMatch(/\S/);
      expect(p.description.length, p.path).toBeGreaterThan(0);
      expect(p.description.length, p.path).toBeLessThanOrEqual(160);
      expect(p.alternates.en).toMatch(/^\//);
      expect(p.alternates.ru).toMatch(/^\/ru\//);
      expect(p.image.url).toMatch(/^https:\/\//);
    }
  });

  it('describes a feature as an Article with dates, about, mentions and citations from its own data', () => {
    const p = at('/features/sea-lion-girls/');
    const a = ofType(p, 'Article')!;
    expect(a).toMatchObject({
      '@type': 'Article',
      headline: 'sea-lion-girls: a story',
      inLanguage: 'en',
      url: `${SITE}/features/sea-lion-girls/`,
      datePublished: '2026-11-01T10:00:00Z',
      dateModified: '2026-11-19T10:00:00Z',
      image: [`${SITE}/social/features/sea-lion-girls.jpg`],
      author: { '@id': `${SITE}/#organization` },
      publisher: { '@id': `${SITE}/#organization` },
    });
    expect((a.headline as string).length).toBeLessThanOrEqual(110);
    expect(a.about).toEqual([
      { '@type': 'MusicRecording', name: 'Sea Lion Woman', byArtist: { '@type': 'MusicGroup', name: 'The Shipp sisters' }, datePublished: '1939', url: 'https://www.loc.gov/item/x/' },
      { '@type': 'MusicComposition', name: 'Alone Again Or', composer: { '@type': 'Person', name: 'Bryan MacLean' } },
    ]);
    expect(a.mentions).toEqual([{ '@type': 'Person', name: 'Arthur Lee', description: 'singer' }]);
    expect(a.citation).toEqual([{ '@type': 'CreativeWork', name: 'LoC record', url: 'https://www.loc.gov/item/x/' }]);
    expect(ofType(at('/ru/features/sea-lion-girls/'), 'Article')).toMatchObject({ inLanguage: 'ru', translationOfWork: { '@id': `${SITE}/features/sea-lion-girls/#article` } });
  });

  it('takes a feature’s own seo description when it has one, else its dek', () => {
    expect(at('/features/brand-new/').description).toBe('A short own description.');
    expect(at('/ru/features/brand-new/').description).toBe('Своё короткое описание.');
    expect(at('/features/sea-lion-girls/').description).toBe('In 1939 two sisters sang. The song went on.');
  });

  it('puts the site, the organization and a breadcrumb trail on every page', () => {
    for (const p of pages) {
      expect(ofType(p, 'WebSite'), p.path).toMatchObject({ '@id': `${SITE}/#website`, url: `${SITE}/` });
      expect(ofType(p, 'Organization'), p.path).toMatchObject({ '@id': `${SITE}/#organization`, name: 'Sankofa' });
      if (p.kind === 'home') continue;
      const crumbs = ofType(p, 'BreadcrumbList')!.itemListElement as { position: number; item: string }[];
      expect(crumbs[0].item).toBe(`${SITE}${p.lang === 'ru' ? '/ru/' : '/'}`);
      expect(crumbs.at(-1)!.item).toBe(SITE + p.path);
      crumbs.forEach((c, i) => expect(c.position).toBe(i + 1));
    }
  });

  it('renders the words as they are, escaped, with card links to card pages', () => {
    const p = at('/features/sea-lion-girls/');
    expect(p.body).toContain('Text with <a href="/cards/a/">a card</a> &amp; &lt;tags&gt;.');
    expect(p.body).toContain('<cite>Arthur Lee</cite>');
    expect(p.body).toContain('<img src="https://sankofa.black/media/photo.jpg" alt="A photo"');
    expect(at('/cards/a/').body).toContain('Only the male copy.');
    expect(at('/cards/a/').body).not.toContain('Only the female copy.');
    expect(at('/cards/a/').body).toContain('<a href="https://example.org/source" rel="nofollow noopener">A source</a>');
    expect(at('/guide/').body).not.toContain('Hidden.');
    expect(linked('[[missing|words]]', () => undefined)).toBe('words');
  });

  it('writes a head with canonical, hreflang, Open Graph, Twitter and parseable JSON-LD', () => {
    const p = at('/ru/features/sea-lion-girls/');
    const head = headHtml(SITE, p);
    expect(head).toContain(`<link rel="canonical" href="${SITE}/ru/features/sea-lion-girls/" />`);
    expect(head).toContain(`hreflang="en" href="${SITE}/features/sea-lion-girls/"`);
    expect(head).toContain(`hreflang="x-default" href="${SITE}/features/sea-lion-girls/"`);
    expect(head).toContain('<meta property="og:type" content="article" />');
    expect(head).toContain('<meta property="og:locale" content="ru_RU" />');
    expect(head).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(head).not.toMatch(/noindex/);
    const json = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(head)![1];
    expect(JSON.parse(json)['@context']).toBe('https://schema.org');
  });

  it('pre-renders into the built index.html without losing the museum', () => {
    const template = `<!doctype html><html lang="en"><head><!-- seo:start x --><title>Old</title><!-- seo:end --><link rel="alternate" type="application/atom+xml" href="features.atom" /><link rel="preload" as="image" href="hero.webp" /></head><body><main id="story"></main><noscript><!-- seo:noscript --></noscript></body></html>`;
    const html = renderPage(template, SITE, at('/ru/features/sea-lion-girls/'), '<nav>links</nav>');
    expect(html).toContain('<html lang="ru"');
    expect(html).not.toContain('<title>Old</title>');
    expect(html).toContain('<body class="pre">');
    expect(html).toContain('<div class="prerender" data-prerender lang="ru">');
    expect(html).toContain('<main id="story">');
    expect(html).toContain('<noscript><nav>links</nav></noscript>');
    expect(html).not.toContain('hero.webp');
    expect(html.match(/application\/atom\+xml/g)).toHaveLength(1);
    expect(html).toContain('href="/ru/features.atom"');
    // The home keeps its cover picture and has no pre-rendered copy.
    const home = renderPage(template, SITE, at('/'), '');
    expect(home).toContain('hero.webp');
    expect(home).not.toContain('data-prerender');
  });
});

describe('the service files', () => {
  const inp = input();
  const pages = buildPages(inp);

  it('robots.txt opens everything but the machinery, names the sitemap and welcomes AI crawlers', () => {
    const r = robotsTxt(SITE);
    expect(r).toMatch(/User-agent: \*\nAllow: \//);
    for (const bot of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended']) expect(AI_CRAWLERS).toContain(bot);
    for (const bot of AI_CRAWLERS) expect(r).toContain(`User-agent: ${bot}`);
    expect(r).toContain('Disallow: /pulse');
    expect(r).not.toMatch(/Disallow: \/(data|media|features|cards)/);
    expect(r).not.toMatch(/Disallow: \/\s*$/m);
    expect(r).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  });

  it('the sitemap lists every page once, with alternates, lastmod and images', () => {
    const { 'sitemap.xml': xml } = sitemaps(SITE, pages);
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toHaveLength(pages.length);
    expect(locs).toContain(`${SITE}/ru/features/brand-new/`);
    expect(xml).toContain('<lastmod>2026-11-19T10:00:00Z</lastmod>');
    expect(xml).toContain(`<xhtml:link rel="alternate" hreflang="ru" href="${SITE}/ru/features/sea-lion-girls/"/>`);
    expect(xml).toContain(`<image:loc>${SITE}/social/features/sea-lion-girls.jpg</image:loc>`);
    expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;)/);
  });

  it('a large sitemap becomes an index of parts', () => {
    const files = sitemaps(SITE, pages, 10);
    expect(files['sitemap.xml']).toContain('<sitemapindex');
    const parts = Object.keys(files).filter((f) => f !== 'sitemap.xml');
    expect(parts.length).toBe(Math.ceil(pages.length / 10));
    expect(files['sitemap.xml']).toContain(`<loc>${SITE}/sitemap-1.xml</loc>`);
    const total = parts.reduce((n, f) => n + (files[f].match(/<url>/g) ?? []).length, 0);
    expect(total).toBe(pages.length);
  });

  it('llms.txt follows the convention: a title, a summary, sections of links', () => {
    const t = llmsTxt(inp, pages);
    expect(t.startsWith('# Sankofa\n\n> Seven centuries of Black culture.\n')).toBe(true);
    expect(t).toContain('## Special projects');
    expect(t).toContain(`- [brand-new: a story](${SITE}/features/brand-new/): A short own description.`);
    expect(t).toContain(`- [Africa Before](${SITE}/chapters/v0/)`);
    expect(t).toContain('## Optional');
    for (const m of t.matchAll(/\]\((https?:[^)]+)\)/g)) expect(m[1]).toMatch(/^https:\/\/(sankofa\.black|github\.com)\//);
  });

  it('llms-full.txt carries the full text in each language', () => {
    const en = llmsFullTxt(inp, 'en');
    expect(en).toContain('## sea-lion-girls: a story');
    expect(en).toContain('Text with [a card](https://sankofa.black/cards/a/) & <tags>.');
    expect(en).toContain('> Arthur Lee: He said it.');
    expect(en).toContain('The story starts with [a song](https://sankofa.black/cards/a/).');
    expect(en).toContain('- [A source](https://example.org/source)');
    const ru = llmsFullTxt(inp, 'ru');
    expect(ru).toContain('## Африка до работорговли');
    expect(ru).toContain('Первый абзац.');
  });

  it('the Atom feed has an entry per feature, newest first', () => {
    const xml = featuresAtom(SITE, pages, 'en', '2026-11-20T00:00:00Z');
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en">');
    expect(xml.match(/<entry>/g)).toHaveLength(2);
    expect(xml).toContain(`<id>${SITE}/features/brand-new/</id>`);
    expect(xml).toContain('<updated>2026-11-19T10:00:00Z</updated>');
    expect(featuresAtom(SITE, pages, 'ru', 'x')).toContain(`<link rel="self" type="application/atom+xml" href="${SITE}/ru/features.atom"/>`);
  });
});

describe('helpers', () => {
  it('cuts a description at a sentence, else at a word', () => {
    expect(describeText('Short.')).toBe('Short.');
    const long = 'One sentence that runs on for a while about the museum and its cards. ' + 'Another sentence that is much too long to fit into the remaining space of the description at all, really.';
    expect(describeText(long)).toBe('One sentence that runs on for a while about the museum and its cards.');
    const words = 'word '.repeat(60);
    expect(describeText(words).endsWith('…')).toBe(true);
    expect(describeText(words).length).toBeLessThanOrEqual(160);
  });

  it('maps content files to what they date', () => {
    expect(contentKey('content/cards/sun-ra.md')).toBe('card:sun-ra');
    expect(contentKey('content/cards/sun-ra.ru.md')).toBe('card:sun-ra');
    expect(contentKey('content/chapters/v2.ru.md')).toBe('chapter:v2');
    expect(contentKey('content/features/angel/art/x.webp')).toBe('feature:angel');
    expect(contentKey('content/guide.ru.md')).toBe('guide');
    expect(contentKey('content/media/x.jpg')).toBeUndefined();
  });

  it('reads the museum’s own words about itself from index.html', () => {
    const h = homeText(`<title>Sankofa — Go back</title><meta name="description" content="Seven centuries." /><script>if (l === 'ru') document.title = 'Sankofa — Вернись';</script><p class="deck" data-l="ru">Семь <a href="#">веков</a>.</p><section class="opener"><div data-l="en"><p class="lede">This <b>museum</b>.</p><div data-edition-note></div></div><div data-l="ru"><p>Этот музей.</p><div data-edition-note></div></div><aside class="engine-aside"><p data-l="en">A cluster.</p><p data-l="ru">Кластер.</p></aside></section>`);
    expect(h.en).toEqual({ title: 'Sankofa — Go back', description: 'Seven centuries.', lede: ['This museum.', 'A cluster.'] });
    expect(h.ru).toEqual({ title: 'Sankofa — Вернись', description: 'Семь веков.', lede: ['Этот музей.', 'Кластер.'] });
  });
});
