// The museum's crawlable layer: one page per route worth finding (the home,
// the special projects and their list, the chapters, every card, the guide
// and the dedication), in English and Russian, each with its metadata,
// JSON-LD and its text as plain HTML, all taken from the compiled data
// (web/public/data). A new special project (content/features/<id>) gets its
// page, metadata and structured data here without any change to this file.
import type { Card, Chapter } from '../../src/lib/types.ts';
import type { FeatureData, FeatureEntry, FeaturesIndex, Scene } from '../../src/features/model.ts';
import type { Inline, ProseFile } from '../../src/mechanics/guide/model.ts';
import type { LineageData } from '../../src/features/lineage.ts';
import { bodyForEdition, localizeCard, localizeChapter } from '../../src/lib/cards.ts';
import { pathOfPage, type PageKind, type PageLang } from '../../src/lib/pagePath.ts';
import { describe, esc, linked, paragraphs, plain } from './text.ts';

export const LANGS: readonly PageLang[] = ['en', 'ru'];

export interface Image {
  url: string;
  width?: number;
  height?: number;
  alt?: string;
}

export interface SeoPage {
  kind: PageKind;
  id?: string;
  lang: PageLang;
  /** The page's path ('/features/angel/'). */
  path: string;
  /** The same page in each language. */
  alternates: Record<PageLang, string>;
  title: string;
  /** The page's own heading (the title without the site's name). */
  name: string;
  description: string;
  image: Image;
  ogType: 'website' | 'article';
  published?: string;
  modified?: string;
  jsonLd: Record<string, unknown>[];
  /** The page's text as HTML, for readers and crawlers without the museum's script. */
  body: string;
  /** Pictures on the page, for the image sitemap. */
  images: string[];
}

export interface HomeText {
  title: string;
  description: string;
  /** The opening paragraphs of the museum, as plain text. */
  lede: string[];
}

export interface Dates {
  first?: string;
  last?: string;
}

export interface SeoInput {
  /** The canonical origin, without a trailing slash. */
  site: string;
  cards: Card[];
  chapters: Chapter[];
  features: FeaturesIndex;
  featureData: Record<string, FeatureData>;
  guide?: ProseFile;
  dedication?: ProseFile;
  home: Record<PageLang, HomeText>;
  /** First and last change of a piece of content: 'card:<id>', 'chapter:<id>', 'feature:<id>', 'guide', 'dedication'. */
  dates(key: string): Dates;
  /** The link-preview picture made for a feature, when one was made. */
  featureImage(id: string, lang: PageLang): Image | undefined;
  featuresImage(lang: PageLang): Image;
  /** The site's own preview picture. */
  defaultImage(lang: PageLang): Image;
}

const L = {
  museum: { en: 'Sankofa', ru: 'Sankofa' },
  sources: { en: 'Sources', ru: 'Источники' },
  further: { en: 'Go further', ru: 'Куда смотреть дальше' },
  contested: { en: 'Contested.', ru: 'Об этом спорят.' },
  chapter: { en: 'Chapter', ru: 'Глава' },
  cards: { en: 'Cards', ru: 'Карточки' },
  chapters: { en: 'Chapters', ru: 'Главы' },
  recordings: { en: 'Recordings and sources', ru: 'Записи и источники' },
  more: { en: 'More of the museum', ru: 'Ещё в музее' },
  guide: { en: 'How to read this museum', ru: 'Как читать этот музей' },
  dedication: { en: 'Dedication', ru: 'Посвящение' },
  open: { en: 'Open in the museum', ru: 'Открыть в музее' },
} as const;
type Label = keyof typeof L;

export function label(k: Label, lang: PageLang): string {
  return L[k][lang];
}

/** A path in a language, as the museum links it. */
export function pagePath(kind: PageKind, lang: PageLang, id?: string): string {
  return pathOfPage({ kind, lang, ...(id ? { id } : {}) });
}

function homePath(lang: PageLang): string {
  return lang === 'ru' ? '/ru/' : '/';
}

const ORG_ID = '/#organization';
const SITE_ID = '/#website';

/** The museum itself, as every page's graph names it. */
export function siteGraph(input: SeoInput, lang: PageLang): Record<string, unknown>[] {
  const s = input.site;
  return [
    {
      '@type': ['Organization', 'Museum'],
      '@id': s + ORG_ID,
      name: 'Sankofa',
      url: s + '/',
      logo: { '@type': 'ImageObject', url: s + '/icon-512.png', width: 512, height: 512 },
      image: input.defaultImage(lang).url,
      description: input.home.en.description,
      sameAs: ['https://github.com/sankofa-media/sankofa'],
    },
    {
      '@type': 'WebSite',
      '@id': s + SITE_ID,
      url: s + '/',
      name: 'Sankofa',
      alternateName: input.home[lang].title,
      description: input.home[lang].description,
      inLanguage: ['en', 'ru'],
      publisher: { '@id': s + ORG_ID },
    },
  ];
}

function breadcrumbs(input: SeoInput, items: { name: string; path: string }[]): Record<string, unknown> {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: input.site + it.path })),
  };
}

function breadcrumbHtml(items: { name: string; path: string }[]): string {
  return `<nav class="crumbs" aria-label="Breadcrumbs"><ol>${items.map((it, i) => (i === items.length - 1 ? `<li aria-current="page">${esc(it.name)}</li>` : `<li><a href="${esc(it.path)}">${esc(it.name)}</a></li>`)).join('')}</ol></nav>`;
}

function mediaUrl(input: SeoInput, file: string): string {
  return `${input.site}/media/${file.split('/').map(encodeURIComponent).join('/')}`;
}

function titled(name: string): string {
  return `${name} — Sankofa`;
}

function page(input: SeoInput, p: Omit<SeoPage, 'path' | 'alternates' | 'jsonLd'> & { jsonLd: Record<string, unknown>[] }): SeoPage {
  const alternates = Object.fromEntries(LANGS.map((l) => [l, p.kind === 'home' ? homePath(l) : pagePath(p.kind, l, p.id)])) as Record<PageLang, string>;
  return { ...p, path: alternates[p.lang], alternates, jsonLd: [...siteGraph(input, p.lang), ...p.jsonLd] };
}

// ---------------------------------------------------------------- features

function blockHtml(b: { role: string; en: string; ru: string; lens?: string }, lang: PageLang, href: (id: string) => string | undefined, lensName?: string): string {
  const text = linked(b[lang], href);
  if (!text.trim()) return '';
  const who = lensName ? `<cite>${esc(lensName)}</cite> ` : '';
  switch (b.role) {
    case 'title':
      return `<h2>${text}</h2>`;
    case 'kicker':
      return `<p class="kicker">${text}</p>`;
    case 'lede':
      return `<p class="lede">${who}${text}</p>`;
    case 'quote':
      return `<blockquote><p>${who}${text}</p></blockquote>`;
    case 'caption':
    case 'label':
    case 'note':
      return `<p class="${b.role}">${who}${text}</p>`;
    default:
      return `<p>${who}${text}</p>`;
  }
}

function photoHtml(input: SeoInput, f: FeatureData, sc: Scene, lang: PageLang): { html: string; url?: string } {
  const art = sc.photo ? f.art.find((a) => a.id === sc.photo && a.kind === 'photo') : undefined;
  if (!art) return { html: '' };
  const url = mediaUrl(input, art.file);
  const cap = [art.caption?.[lang], art.credit?.[lang]].filter(Boolean).map((s) => esc(s!)).join('. ');
  return { url, html: `<figure><img src="${esc(url)}" alt="${esc(art.alt?.[lang] ?? '')}" loading="lazy" decoding="async" />${cap ? `<figcaption>${cap}</figcaption>` : ''}</figure>` };
}

function lineageHtml(lineage: LineageData | undefined, lang: PageLang): string {
  const nodes = lineage?.nodes ?? [];
  if (!nodes.length) return '';
  const items = nodes.map((n) => {
    const head = [n.title, n.artist, n.year ? String(n.year) : ''].filter(Boolean).map((s) => esc(String(s))).join(' — ');
    const link = n.link ? ` <a href="${esc(n.link)}" rel="nofollow noopener">${esc(new URL(n.link).hostname.replace(/^www\./, ''))}</a>` : '';
    const src = (n.sources ?? []).filter((s) => s.url).map((s) => `<li><a href="${esc(s.url!)}" rel="nofollow noopener">${esc(s.title)}</a></li>`);
    const story = n.story?.[lang] ? `<p>${esc(plain(n.story[lang]))}</p>` : '';
    return `<li>${head}${link}${story}${src.length ? `<ul>${src.join('')}</ul>` : ''}</li>`;
  });
  return `<section><h2>${esc(label('recordings', lang))}</h2><ul>${items.join('')}</ul></section>`;
}

/** Who and what a feature is about, as its own data names them. */
export function featureAbout(f: FeatureData, lang: PageLang): { about: Record<string, unknown>[]; mentions: Record<string, unknown>[]; citation: Record<string, unknown>[] } {
  const about: Record<string, unknown>[] = [];
  for (const n of f.lineage?.nodes ?? []) {
    about.push({
      '@type': 'MusicRecording',
      name: n.title,
      ...(n.artist ? { byArtist: { '@type': 'MusicGroup', name: n.artist } } : {}),
      ...(n.year ? { datePublished: String(n.year) } : {}),
      ...(n.link ? { url: n.link } : {}),
    });
  }
  for (const sc of f.scenes) {
    const song = sc.song as { title?: string; writer?: string } | undefined;
    if (song?.title) about.push({ '@type': 'MusicComposition', name: song.title, ...(song.writer ? { composer: { '@type': 'Person', name: song.writer } } : {}) });
  }
  const mentions = (f.lenses ?? []).filter((l) => !l.empty).map((l) => ({ '@type': 'Person', name: l.name[lang], ...(l.role ? { description: l.role[lang] } : {}) }));
  const seen = new Set<string>();
  const citation: Record<string, unknown>[] = [];
  for (const n of f.lineage?.nodes ?? []) {
    for (const s of n.sources ?? []) {
      if (!s.url || seen.has(s.url)) continue;
      seen.add(s.url);
      citation.push({ '@type': 'CreativeWork', name: s.title, url: s.url });
    }
  }
  return { about, mentions, citation };
}

function featurePage(input: SeoInput, e: FeatureEntry, f: FeatureData, lang: PageLang, cardHref: (id: string) => string | undefined): SeoPage {
  const name = f.title[lang];
  const description = e.seo?.description?.[lang] ? plain(e.seo.description[lang]) : describe(f.dek[lang]);
  const path = pagePath('feature', lang, f.id);
  const list = { name: input.features.ui['list-title']?.[lang] ?? 'Special projects', path: pagePath('features', lang) };
  const crumbs = [{ name: 'Sankofa', path: homePath(lang) }, list, { name: name.split(':')[0], path }];
  const made = input.featureImage(f.id, lang);
  const image = made ? { ...made, alt: name } : input.defaultImage(lang);
  const lenses = new Map((f.lenses ?? []).map((l) => [l.id, l.name[lang]]));
  const images: string[] = [image.url];
  const scenes = f.scenes
    .map((sc) => {
      const photo = photoHtml(input, f, sc, lang);
      if (photo.url) images.push(photo.url);
      const blocks = sc.blocks.map((b) => blockHtml(b, lang, cardHref, b.lens ? lenses.get(b.lens) : undefined)).join('');
      return blocks || photo.html ? `<section id="scene-${esc(sc.id)}">${blocks}${photo.html}</section>` : '';
    })
    .join('');
  const d = input.dates(`feature:${f.id}`);
  const { about, mentions, citation } = featureAbout(f, lang);
  const url = input.site + path;
  const article: Record<string, unknown> = {
    '@type': 'Article',
    '@id': url + '#article',
    headline: name.length > 110 ? name.split(':')[0] : name,
    ...(name.length > 110 ? { alternativeHeadline: name } : {}),
    name,
    description,
    abstract: plain(f.dek[lang]),
    inLanguage: lang,
    url,
    mainEntityOfPage: url,
    image: [image.url],
    ...(d.first ? { datePublished: d.first } : {}),
    ...(d.last ? { dateModified: d.last } : {}),
    author: { '@id': input.site + ORG_ID },
    publisher: { '@id': input.site + ORG_ID },
    isPartOf: { '@id': input.site + SITE_ID },
    isAccessibleForFree: true,
    ...(about.length ? { about } : {}),
    ...(mentions.length ? { mentions } : {}),
    ...(citation.length ? { citation } : {}),
    ...(lang === 'ru' ? { translationOfWork: { '@id': input.site + pagePath('feature', 'en', f.id) + '#article' } } : { workTranslation: { '@id': input.site + pagePath('feature', 'ru', f.id) + '#article' } }),
  };
  const body = [
    breadcrumbHtml(crumbs),
    `<article><header><h1>${esc(name)}</h1><p class="lede">${linked(f.dek[lang], cardHref)}</p>${e.reading ? `<p class="reading">${esc(e.reading[lang])}</p>` : ''}</header>`,
    scenes,
    lineageHtml(f.lineage, lang),
    `</article>`,
  ].join('');
  return page(input, {
    kind: 'feature',
    id: f.id,
    lang,
    title: titled(name),
    name,
    description,
    image,
    ogType: 'article',
    published: d.first,
    modified: d.last,
    jsonLd: [article, breadcrumbs(input, crumbs)],
    body,
    images,
  });
}

function featuresListPage(input: SeoInput, lang: PageLang): SeoPage {
  const ui = input.features.ui;
  const name = ui['list-title']?.[lang] ?? 'Special projects';
  const dek = ui['list-dek']?.[lang] ?? '';
  const path = pagePath('features', lang);
  const crumbs = [{ name: 'Sankofa', path: homePath(lang) }, { name, path }];
  const items = input.features.features.map((e) => {
    const p = pagePath('feature', lang, e.id);
    return `<li><h2><a href="${esc(p)}">${esc(e.title[lang])}</a></h2><p>${esc(plain(e.dek[lang]))}</p>${e.reading ? `<p class="reading">${esc(e.reading[lang])}</p>` : ''}</li>`;
  });
  const last = input.features.features.map((e) => input.dates(`feature:${e.id}`).last).filter(Boolean).sort().pop();
  const url = input.site + path;
  return page(input, {
    kind: 'features',
    lang,
    title: titled(name),
    name,
    description: describe(dek),
    image: input.featuresImage(lang),
    ogType: 'website',
    modified: last,
    jsonLd: [
      {
        '@type': 'CollectionPage',
        '@id': url,
        url,
        name,
        description: plain(dek),
        inLanguage: lang,
        isPartOf: { '@id': input.site + SITE_ID },
        mainEntity: {
          '@type': 'ItemList',
          itemListElement: input.features.features.map((e, i) => ({ '@type': 'ListItem', position: i + 1, url: input.site + pagePath('feature', lang, e.id), name: e.title[lang] })),
        },
      },
      breadcrumbs(input, crumbs),
    ],
    body: `${breadcrumbHtml(crumbs)}<article><header><h1>${esc(name)}</h1><p class="lede">${esc(dek)}</p></header><ul class="list">${items.join('')}</ul></article>`,
    images: input.features.features.map((e) => input.featureImage(e.id, lang)?.url).filter((u): u is string => !!u),
  });
}

// ---------------------------------------------------------------- chapters and cards

function cardEdition(c: Card): 'm' | 'f' {
  return c.edition === 'f' ? 'f' : 'm';
}

function chapterPage(input: SeoInput, ch0: Chapter, lang: PageLang, cardHref: (id: string) => string | undefined, cardsById: Map<string, Card>): SeoPage {
  const ch = localizeChapter(ch0, lang);
  const path = pagePath('chapter', lang, ch.id);
  const crumbs = [{ name: 'Sankofa', path: homePath(lang) }, { name: ch.title, path }];
  const image = input.defaultImage(lang);
  const d = input.dates(`chapter:${ch.id}`);
  const steps = ch.steps
    .map((s, i) => {
      if (ch.stepCopies?.[i] === 'f') return '';
      const at = ch.stepLabels?.[i];
      return `${at ? `<h3>${esc(at)}</h3>` : ''}<p>${linked(s.replace(/^\{(male|female)\}\s+/, ''), cardHref)}</p>`;
    })
    .join('');
  const cards = ch.cards
    .map((id) => cardsById.get(id))
    .filter((c): c is Card => !!c)
    .map((c) => {
      const lc = localizeCard(c, lang);
      return `<li><a href="${esc(pagePath('card', lang, c.id))}">${esc(lc.title)}</a>: ${esc(plain(lc.wow))}</li>`;
    });
  const hero = ch.hero ? `<figure><img src="${esc(image.url)}" alt="${esc(ch.hero.caption ?? '')}" loading="lazy" decoding="async" /><figcaption>${esc([ch.hero.caption, ch.hero.credit, ch.hero.license].filter(Boolean).join('. '))}</figcaption></figure>` : '';
  const description = describe(ch.steps[0] ?? ch.kicker);
  const url = input.site + path;
  return page(input, {
    kind: 'chapter',
    id: ch.id,
    lang,
    title: titled(ch.title),
    name: ch.title,
    description,
    image,
    ogType: 'article',
    published: d.first,
    modified: d.last,
    jsonLd: [
      {
        '@type': 'Article',
        '@id': url + '#article',
        headline: ch.title,
        alternativeHeadline: ch.kicker,
        description,
        inLanguage: ch.textLang ?? lang,
        url,
        mainEntityOfPage: url,
        image: [image.url],
        ...(d.first ? { datePublished: d.first } : {}),
        ...(d.last ? { dateModified: d.last } : {}),
        author: { '@id': input.site + ORG_ID },
        publisher: { '@id': input.site + ORG_ID },
        isPartOf: { '@id': input.site + SITE_ID },
        ...(ch.years?.length ? { temporalCoverage: ch.years.join('/') } : {}),
        ...(ch.places?.length ? { spatialCoverage: ch.places.map((p) => ({ '@type': 'Place', name: p.name, geo: { '@type': 'GeoCoordinates', latitude: p.lat, longitude: p.lon } })) } : {}),
        hasPart: ch.cards.filter((id) => cardsById.has(id)).map((id) => ({ '@id': input.site + pagePath('card', lang, id) + '#article' })),
      },
      breadcrumbs(input, crumbs),
    ],
    body: `${breadcrumbHtml(crumbs)}<article><header><p class="kicker">${esc(ch.kicker)}</p><h1>${esc(ch.title)}</h1></header>${hero}${steps}${cards.length ? `<section><h2>${esc(label('cards', lang))}</h2><ul>${cards.join('')}</ul></section>` : ''}</article>`,
    images: [image.url],
  });
}

function cardPage(input: SeoInput, c0: Card, lang: PageLang, cardHref: (id: string) => string | undefined, chapters: Map<string, Chapter>): SeoPage {
  const c = localizeCard(c0, lang);
  const path = pagePath('card', lang, c.id);
  const ch = c.era ? chapters.get(c.era) : undefined;
  const chTitle = ch ? localizeChapter(ch, lang).title : undefined;
  const crumbs = [{ name: 'Sankofa', path: homePath(lang) }, ...(ch && chTitle ? [{ name: chTitle, path: pagePath('chapter', lang, ch.id) }] : []), { name: c.title, path }];
  const img = c.media?.find((m) => m.type === 'image');
  const image = input.defaultImage(lang);
  const d = input.dates(`card:${c.id}`);
  const body = paragraphs(bodyForEdition(c.body, cardEdition(c0)))
    .map((p) => `<p>${linked(p, cardHref)}</p>`)
    .join('');
  const figure = img ? `<figure><img src="${esc(image.url)}" alt="${esc(img.caption ?? '')}" loading="lazy" decoding="async" /><figcaption>${esc([img.caption, img.credit, img.license].filter(Boolean).join('. '))}${img.url ? ` <a href="${esc(img.url)}" rel="nofollow noopener">↗</a>` : ''}</figcaption></figure>` : '';
  const further = c.further?.length ? `<section><h2>${esc(label('further', lang))}</h2><ul>${c.further.map((f) => `<li>${linked(f, cardHref)}</li>`).join('')}</ul></section>` : '';
  const sources = c.sources?.length ? `<section><h2>${esc(label('sources', lang))}</h2><ol>${c.sources.map((s) => `<li>${s.url ? `<a href="${esc(s.url)}" rel="nofollow noopener">${esc(s.title)}</a>` : esc(s.title)}</li>`).join('')}</ol></section>` : '';
  const dispute = c.dispute ? `<p class="contested"><b>${esc(label('contested', lang))}</b> ${linked(c.dispute, cardHref)}</p>` : '';
  const description = describe(c.wow);
  const url = input.site + path;
  return page(input, {
    kind: 'card',
    id: c.id,
    lang,
    title: titled(c.title),
    name: c.title,
    description,
    image,
    ogType: 'article',
    published: d.first,
    modified: d.last,
    jsonLd: [
      {
        '@type': 'Article',
        '@id': url + '#article',
        headline: c.title.length > 110 ? c.title.slice(0, 109) + '…' : c.title,
        name: c.title,
        description,
        inLanguage: c.textLang ?? lang,
        url,
        mainEntityOfPage: url,
        image: [image.url],
        ...(d.first ? { datePublished: d.first } : {}),
        ...(d.last ? { dateModified: d.last } : {}),
        author: { '@id': input.site + ORG_ID },
        publisher: { '@id': input.site + ORG_ID },
        isPartOf: ch ? { '@id': input.site + pagePath('chapter', lang, ch.id) + '#article' } : { '@id': input.site + SITE_ID },
        ...(c.years?.length ? { temporalCoverage: [...new Set(c.years)].join('/') } : {}),
        ...(c.places?.length ? { spatialCoverage: c.places.map((p) => ({ '@type': 'Place', name: p.name, geo: { '@type': 'GeoCoordinates', latitude: p.lat, longitude: p.lon } })) } : {}),
        ...(c.sources?.length ? { citation: c.sources.map((s) => ({ '@type': 'CreativeWork', name: s.title, ...(s.url ? { url: s.url } : {}) })) } : {}),
      },
      breadcrumbs(input, crumbs),
    ],
    body: `${breadcrumbHtml(crumbs)}<article><header><h1>${esc(c.title)}</h1><p class="lede">${linked(c.wow, cardHref)}</p></header>${figure}${body}${dispute}${further}${sources}</article>`,
    images: img ? [image.url] : [],
  });
}

// ---------------------------------------------------------------- guide, dedication, home

function inlineHtml(xs: Inline[], cardHref: (id: string) => string | undefined): string {
  return xs
    .map((x) => {
      switch (x.t) {
        case 'em':
          return `<em>${esc(x.s)}</em>`;
        case 'strong':
          return `<strong>${esc(x.s)}</strong>`;
        case 'link':
          return `<a href="${esc(x.href)}">${esc(x.s)}</a>`;
        case 'card': {
          const to = cardHref(x.id);
          const t = x.em ? `<em>${esc(x.s)}</em>` : esc(x.s);
          return to ? `<a href="${esc(to)}">${t}</a>` : t;
        }
        // What the page keeps out of sight stays out of it here too.
        case 'unseen':
          return '';
        default:
          return esc(x.s);
      }
    })
    .join('');
}

function prosePage(input: SeoInput, kind: 'guide' | 'dedication', file: ProseFile, lang: PageLang, cardHref: (id: string) => string | undefined): SeoPage | undefined {
  const doc = file[lang] ?? file.en;
  if (!doc) return undefined;
  const name = doc.title ?? label(kind, lang);
  const path = pagePath(kind, lang);
  const crumbs = [{ name: 'Sankofa', path: homePath(lang) }, { name, path }];
  const firstP = doc.blocks.find((b) => b.type === 'p');
  const description = describe(firstP ? firstP.inline.filter((x) => x.t !== 'unseen').map((x) => x.s).join('') : name);
  const blocks = doc.blocks
    .map((b) => {
      const html = inlineHtml(b.inline, cardHref);
      if (!html.trim()) return '';
      return b.type === 'quote' ? `<blockquote><p>${html}</p></blockquote>` : `<${b.type}>${html}</${b.type}>`;
    })
    .join('');
  const d = input.dates(kind);
  const url = input.site + path;
  return page(input, {
    kind,
    lang,
    title: titled(name),
    name,
    description,
    image: input.defaultImage(lang),
    ogType: 'website',
    published: d.first,
    modified: d.last,
    jsonLd: [
      { '@type': kind === 'guide' ? 'AboutPage' : 'WebPage', '@id': url, url, name, description, inLanguage: lang, isPartOf: { '@id': input.site + SITE_ID }, ...(d.last ? { dateModified: d.last } : {}) },
      breadcrumbs(input, crumbs),
    ],
    body: `${breadcrumbHtml(crumbs)}<article><header><h1>${esc(name)}</h1></header>${blocks}</article>`,
    images: [],
  });
}

function homePage(input: SeoInput, lang: PageLang, all: SeoPage[]): SeoPage {
  const h = input.home[lang];
  const last = all.map((p) => p.modified).filter(Boolean).sort().pop();
  const url = input.site + homePath(lang);
  return page(input, {
    kind: 'home',
    lang,
    title: h.title,
    name: 'Sankofa',
    description: describe(h.description),
    image: input.defaultImage(lang),
    ogType: 'website',
    modified: last,
    jsonLd: [{ '@type': 'WebPage', '@id': url, url, name: h.title, description: h.description, inLanguage: lang, isPartOf: { '@id': input.site + SITE_ID }, about: { '@id': input.site + ORG_ID } }],
    body: '',
    images: [input.defaultImage(lang).url],
  });
}

/** Every page of the crawlable layer, in both languages. */
export function buildPages(input: SeoInput): SeoPage[] {
  const cardsById = new Map(input.cards.map((c) => [c.id, c]));
  const chapters = new Map(input.chapters.map((c) => [c.id, c]));
  const out: SeoPage[] = [];
  for (const lang of LANGS) {
    const cardHref = (id: string) => (cardsById.has(id) ? pagePath('card', lang, id) : undefined);
    if (input.features.features.length) out.push(featuresListPage(input, lang));
    for (const e of input.features.features) {
      const f = input.featureData[e.id];
      if (f) out.push(featurePage(input, e, f, lang, cardHref));
    }
    for (const ch of input.chapters) out.push(chapterPage(input, ch, lang, cardHref, cardsById));
    for (const c of input.cards) out.push(cardPage(input, c, lang, cardHref, chapters));
    if (input.guide) {
      const p = prosePage(input, 'guide', input.guide, lang, cardHref);
      if (p) out.push(p);
    }
    if (input.dedication) {
      const p = prosePage(input, 'dedication', input.dedication, lang, cardHref);
      if (p) out.push(p);
    }
  }
  const homes = LANGS.map((l) => homePage(input, l, out));
  return [...homes, ...out];
}

/** The pages a reader without the museum's script can go to, for the home page's <noscript>. */
export function sitemapLinks(pages: SeoPage[], lang: PageLang): { name: string; path: string }[] {
  const order: PageKind[] = ['features', 'feature', 'chapter', 'guide', 'dedication'];
  return pages.filter((p) => p.lang === lang && order.includes(p.kind)).sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind)).map((p) => ({ name: p.name, path: p.path }));
}
