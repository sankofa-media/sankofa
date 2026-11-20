// The build step that makes the museum findable: after `vite build` it reads
// the compiled data in dist/data and writes, next to the app,
//   <page>/index.html          a pre-rendered page per route (scripts/seo/pages.ts)
//   index.html, ru/index.html  the home pages with their own head
//   social/features/<id>.jpg   link-preview pictures of the special projects
//   robots.txt, sitemap.xml    (an index of sitemap-<n>.xml when large)
//   llms.txt, llms-full.txt, ru/llms-full.txt
//   features.atom, ru/features.atom
// Every special project listed in content/features/index.yaml gets all of it
// with no change here. SITE_URL sets the canonical origin.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import type { CardsFile, ChaptersFile } from '../../src/lib/types.ts';
import type { FeatureData, FeaturesIndex } from '../../src/features/model.ts';
import type { ProseFile } from '../../src/mechanics/guide/model.ts';
import { buildPages, LANGS, sitemapLinks, type Dates, type HomeText, type Image, type SeoInput } from './pages.ts';
import { featuresAtom, llmsFullTxt, llmsTxt, robotsTxt, sitemaps } from './files.ts';
import { noscriptHtml, renderPage } from './render.ts';
import { composeSocial, SOCIAL_H, SOCIAL_W, socialTool } from './social.ts';
import { plain } from './text.ts';

export const DEFAULT_SITE = 'https://sankofa.black';

const stripTags = (s: string) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** The museum's own words about itself, from the static index.html. */
export function homeText(template: string): Record<'en' | 'ru', HomeText> {
  const meta = (re: RegExp) => re.exec(template)?.[1] ?? '';
  const block = (l: string) => new RegExp(`<section class="opener"[\\s\\S]*?<div data-l="${l}">([\\s\\S]*?)<div data-edition-note>`).exec(template)?.[1] ?? '';
  const paras = (html: string) => [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => stripTags(m[1])).filter(Boolean);
  const aside = (l: string) => new RegExp(`<aside class="engine-aside"[\\s\\S]*?<p data-l="${l}">([\\s\\S]*?)</p>`).exec(template)?.[1] ?? '';
  const deck = (l: string) => stripTags(new RegExp(`<p class="deck" data-l="${l}">([\\s\\S]*?)</p>`).exec(template)?.[1] ?? '');
  return {
    en: {
      title: stripTags(meta(/<title>([^<]*)<\/title>/)),
      description: meta(/<meta name="description" content="([^"]*)"/),
      lede: [...paras(block('en')), stripTags(aside('en'))].filter(Boolean),
    },
    ru: {
      title: meta(/document\.title = '([^']+)'/) || 'Sankofa',
      description: deck('ru'),
      lede: [...paras(block('ru')), stripTags(aside('ru'))].filter(Boolean),
    },
  };
}

/** First and last commit dates of every piece of content, from one `git log`. */
export function contentDates(root: string): (key: string) => Dates {
  const map = new Map<string, Dates>();
  try {
    const log = execFileSync('git', ['-C', root, 'log', '--format=%x01%cI', '--name-only', '--', 'content'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    for (const commit of log.split('\x01')) {
      const [date, ...files] = commit.trim().split('\n');
      if (!date) continue;
      for (const f of files) {
        const key = contentKey(f.trim());
        if (!key) continue;
        const d = map.get(key) ?? {};
        // Newest first: the first date seen is the last change, the final one the first.
        d.last ??= date;
        d.first = date;
        map.set(key, d);
      }
    }
  } catch {
    // No git (a container build): the pages go without dates rather than with wrong ones.
  }
  return (key) => map.get(key) ?? {};
}

export function contentKey(file: string): string | undefined {
  let m = /^content\/cards\/([a-z0-9-]+)(?:\.[a-z]{2})?\.md$/.exec(file);
  if (m) return `card:${m[1]}`;
  m = /^content\/chapters\/([a-z0-9-]+)(?:\.[a-z]{2})?\.md$/.exec(file);
  if (m) return `chapter:${m[1]}`;
  m = /^content\/features\/([a-z0-9-]+)\//.exec(file);
  if (m) return `feature:${m[1]}`;
  m = /^content\/(guide|dedication)(?:\.[a-z]{2})?\.md$/.exec(file);
  if (m) return m[1];
  return undefined;
}

function readJson<T>(file: string): T | undefined {
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : undefined;
}

function write(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

export interface SeoBuild {
  pages: number;
  files: string[];
  social: string[];
}

/** Write the crawlable layer into a built museum (`dist`). */
export function buildSeo(dist: string, repo: string, site = DEFAULT_SITE, log: (s: string) => void = console.log): SeoBuild | undefined {
  const data = join(dist, 'data');
  const cardsFile = readJson<CardsFile>(join(data, 'cards.json'));
  const chaptersFile = readJson<ChaptersFile>(join(data, 'chapters.json'));
  if (!cardsFile || !chaptersFile) {
    log('seo: no compiled data in dist/data (run `npm run data`): pages not written');
    return undefined;
  }
  const features = readJson<FeaturesIndex>(join(data, 'features.json')) ?? { version: 1, ui: {}, features: [] };
  const featureData: Record<string, FeatureData> = {};
  for (const e of features.features) {
    const f = readJson<FeatureData>(join(data, 'features', `${e.id}.json`));
    if (f) featureData[e.id] = f;
  }
  const template = readFileSync(join(dist, 'index.html'), 'utf8');

  // The special projects' link previews, drawn from their own art.
  const tool = socialTool();
  const social: string[] = [];
  const featureImages = new Map<string, Image>();
  for (const e of features.features) {
    const files = e.seo?.image ? [e.seo.image] : (e.cover?.layers ?? []).map((l) => l.file);
    const out = join(dist, 'social', 'features', `${e.id}.jpg`);
    if (!files.length || !composeSocial(files.map((f) => join(dist, 'media', 'features', e.id, f)), out, tool)) continue;
    social.push(`social/features/${e.id}.jpg`);
    featureImages.set(e.id, { url: `${site}/social/features/${e.id}.jpg`, width: SOCIAL_W, height: SOCIAL_H, alt: plain(e.title.en) });
  }

  const input: SeoInput = {
    site,
    cards: cardsFile.cards,
    chapters: chaptersFile.chapters,
    features,
    featureData,
    guide: readJson<ProseFile>(join(data, 'guide.json')),
    dedication: readJson<ProseFile>(join(data, 'dedication.json')),
    home: homeText(template),
    dates: contentDates(repo),
    featureImage: (id) => featureImages.get(id),
    defaultImage: { url: `${site}/social-card.jpg`, width: 1200, height: 630, alt: 'Sankofa' },
  };
  const pages = buildPages(input);
  const noscript = Object.fromEntries(LANGS.map((l) => [l, noscriptHtml(sitemapLinks(pages, l), l)]));
  for (const p of pages) write(join(dist, p.path, 'index.html'), renderPage(template, site, p, noscript[p.lang]));

  const files: Record<string, string> = {
    'robots.txt': robotsTxt(site),
    ...sitemaps(site, pages),
    'llms.txt': llmsTxt(input, pages),
    'llms-full.txt': llmsFullTxt(input, 'en'),
    'ru/llms-full.txt': llmsFullTxt(input, 'ru'),
    'features.atom': featuresAtom(site, pages, 'en', new Date().toISOString()),
    'ru/features.atom': featuresAtom(site, pages, 'ru', new Date().toISOString()),
  };
  for (const [name, text] of Object.entries(files)) write(join(dist, name), text);
  log(`seo: ${pages.length} pages, ${social.length} social image(s)${tool ? '' : ' (no magick or vips: features use the site picture)'}, ${Object.keys(files).join(', ')} -> ${dist}`);
  return { pages: pages.length, files: Object.keys(files), social };
}

/** The Vite plugin: runs buildSeo after every production build. */
export function seo(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'sankofa-seo',
    apply: 'build',
    configResolved(c) {
      config = c;
    },
    closeBundle() {
      const dist = resolve(config.root, config.build.outDir);
      buildSeo(dist, resolve(config.root, '..'), (process.env.SITE_URL || process.env.SANKOFA_SITE)?.replace(/\/+$/, '') || DEFAULT_SITE, (s) => config.logger.info(s));
    },
  };
}
