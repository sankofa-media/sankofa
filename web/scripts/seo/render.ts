// A pre-rendered page: the built index.html with the page's own head (title,
// description, canonical, hreflang, Open Graph, Twitter, JSON-LD), its
// language, and its text as plain HTML that shows until the museum starts.
// The museum then boots at the same place (src/lib/pagePath.ts reads the path).
import type { PageLang } from '../../src/lib/pagePath.ts';
import { esc, jsonForScript } from './text.ts';
import type { SeoPage } from './pages.ts';

const OG_LOCALE: Record<PageLang, string> = { en: 'en_US', ru: 'ru_RU' };

export function headHtml(site: string, p: SeoPage): string {
  const url = site + p.path;
  const other = (Object.keys(p.alternates) as PageLang[]).filter((l) => l !== p.lang);
  const xDefault = p.kind === 'home' ? '/' : p.alternates.en;
  const tags = [
    `<title>${esc(p.title)}</title>`,
    `<meta name="description" content="${esc(p.description)}" />`,
    `<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    ...(Object.entries(p.alternates) as [PageLang, string][]).map(([l, path]) => `<link rel="alternate" hreflang="${l}" href="${esc(site + path)}" />`),
    `<link rel="alternate" hreflang="x-default" href="${esc(site + xDefault)}" />`,
    `<meta property="og:site_name" content="Sankofa" />`,
    `<meta property="og:type" content="${p.ogType}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:title" content="${esc(p.name === 'Sankofa' ? p.title : p.name)}" />`,
    `<meta property="og:description" content="${esc(p.description)}" />`,
    `<meta property="og:locale" content="${OG_LOCALE[p.lang]}" />`,
    ...other.map((l) => `<meta property="og:locale:alternate" content="${OG_LOCALE[l]}" />`),
    `<meta property="og:image" content="${esc(p.image.url)}" />`,
    ...(p.image.width && p.image.height ? [`<meta property="og:image:width" content="${p.image.width}" />`, `<meta property="og:image:height" content="${p.image.height}" />`] : []),
    ...(p.image.alt ? [`<meta property="og:image:alt" content="${esc(p.image.alt)}" />`] : []),
    ...(p.ogType === 'article' && p.published ? [`<meta property="article:published_time" content="${esc(p.published)}" />`] : []),
    ...(p.ogType === 'article' && p.modified ? [`<meta property="article:modified_time" content="${esc(p.modified)}" />`] : []),
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(p.name === 'Sankofa' ? p.title : p.name)}" />`,
    `<meta name="twitter:description" content="${esc(p.description)}" />`,
    `<meta name="twitter:image" content="${esc(p.image.url)}" />`,
    ...(p.image.alt ? [`<meta name="twitter:image:alt" content="${esc(p.image.alt)}" />`] : []),
    `<link rel="alternate" type="application/atom+xml" title="${p.lang === 'ru' ? 'Sankofa: спецпроекты' : 'Sankofa: special projects'}" href="${p.lang === 'ru' ? '/ru/features.atom' : '/features.atom'}" />`,
    `<script type="application/ld+json">${jsonForScript({ '@context': 'https://schema.org', '@graph': p.jsonLd })}</script>`,
  ];
  return tags.join('\n    ');
}

const SEO_BLOCK = /<!-- seo:start[\s\S]*?<!-- seo:end -->/;
const NOSCRIPT = /<!-- seo:noscript[^>]*-->/;
// The static feed link in index.html: the pages carry their own, per language.
const FEED_LINK = /\s*<link rel="alternate" type="application\/atom\+xml"[^>]*>/;

/** The noscript list of pages a reader without the script can go to. */
export function noscriptHtml(links: { name: string; path: string }[], lang: PageLang): string {
  if (!links.length) return '';
  const head = lang === 'ru' ? 'Страницы, которые читаются и без JavaScript' : 'Pages that read without JavaScript';
  return `<nav lang="${lang}" aria-label="${esc(head)}"><p>${esc(head)}:</p><ul>${links.map((l) => `<li><a href="${esc(l.path)}">${esc(l.name)}</a></li>`).join('')}</ul></nav>`;
}

/**
 * The page from the built index.html: its head, its language, and for every
 * page but the home its text in <article data-prerender> with body.pre (the
 * museum's own markup hidden until the script takes over).
 */
export function renderPage(template: string, site: string, p: SeoPage, noscript: string): string {
  if (!SEO_BLOCK.test(template)) throw new Error('index.html has no <!-- seo:start --> … <!-- seo:end --> block');
  let html = template.replace(FEED_LINK, '').replace(SEO_BLOCK, () => headHtml(site, p));
  html = html.replace(/<html lang="[a-z]+"/, `<html lang="${p.lang}"`);
  html = html.replace(NOSCRIPT, () => noscript);
  html = html.replace(/href="(?:\/)?features\//g, `href="${p.lang === 'ru' ? '/ru' : ''}/features/`);
  if (p.kind === 'home') return html;
  // Only the home's first screen uses the cover and its small display face.
  html = html.replace(/\s*<link rel="preload" as="(?:image|font)"[^>]*>/g, '');
  if (p.kind === 'feature' || p.kind === 'features') html = html.replace(/<body[\s\S]*?<\/body>/, '<body></body>');
  return html.replace(/<body([^>]*)>/, (_, attrs: string) => `<body${attrs} class="pre">\n    <div class="prerender" data-prerender lang="${p.lang}">${p.body}</div>`);
}
