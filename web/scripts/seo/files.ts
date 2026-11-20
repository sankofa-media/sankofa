// The service files published with the museum: robots.txt, the sitemap (an
// index of several when it grows past the limit), llms.txt and
// llms-full.txt for AI assistants, and an Atom feed of the special projects
// per language. All of them are built from the same pages as the HTML.
import type { ProseFile } from '../../src/mechanics/guide/model.ts';
import { bodyForEdition, localizeCard, localizeChapter } from '../../src/lib/cards.ts';
import type { PageLang } from '../../src/lib/pagePath.ts';
import { label, pagePath, type SeoInput, type SeoPage } from './pages.ts';
import { esc, markdown, paragraphs, plain } from './text.ts';

/** Crawlers that read the web for AI assistants and search, named so their welcome is explicit. */
export const AI_CRAWLERS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'anthropic-ai', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'Meta-ExternalAgent', 'Amazonbot', 'DuckAssistBot', 'MistralAI-User', 'YandexAdditional'];

/**
 * Everything is open: the pages, the data the museum reads and the media.
 * Only the machinery is closed: the cluster's live pulse (a stream that never
 * ends), the health check and the review API.
 */
export function robotsTxt(site: string): string {
  const closed = ['/pulse', '/pulses', '/healthz', '/api/'];
  const group = (agents: string[]) => [...agents.map((a) => `User-agent: ${a}`), 'Allow: /', ...closed.map((p) => `Disallow: ${p}`)].join('\n');
  return [
    '# Sankofa: a museum of seven centuries of Black culture. Read it, cite it, link to it.',
    group(['*']),
    '',
    '# Assistants and their search are welcome too.',
    group(AI_CRAWLERS),
    '',
    `Sitemap: ${site}/sitemap.xml`,
    '',
  ].join('\n');
}

const SITEMAP_LIMIT = 45_000;

function urlEntry(site: string, p: SeoPage): string {
  const alt = (Object.entries(p.alternates) as [PageLang, string][]).map(([l, path]) => `<xhtml:link rel="alternate" hreflang="${l}" href="${esc(site + path)}"/>`);
  const xDefault = `<xhtml:link rel="alternate" hreflang="x-default" href="${esc(site + (p.kind === 'home' ? '/' : p.alternates.en))}"/>`;
  const images = [...new Set(p.images)].map((u) => `<image:image><image:loc>${esc(u)}</image:loc></image:image>`);
  return `<url><loc>${esc(site + p.path)}</loc>${p.modified ? `<lastmod>${esc(p.modified)}</lastmod>` : ''}${alt.join('')}${xDefault}${images.join('')}</url>`;
}

/** sitemap.xml, or sitemap.xml as an index of sitemap-<n>.xml when there are too many pages for one. */
export function sitemaps(site: string, pages: SeoPage[], limit = SITEMAP_LIMIT): Record<string, string> {
  const head = '<?xml version="1.0" encoding="UTF-8"?>\n';
  const ns = 'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"';
  const set = (ps: SeoPage[]) => `${head}<urlset ${ns}>\n${ps.map((p) => urlEntry(site, p)).join('\n')}\n</urlset>\n`;
  if (pages.length <= limit) return { 'sitemap.xml': set(pages) };
  const out: Record<string, string> = {};
  const parts: string[] = [];
  for (let i = 0; i < pages.length; i += limit) {
    const chunk = pages.slice(i, i + limit);
    const name = `sitemap-${parts.length + 1}.xml`;
    out[name] = set(chunk);
    const last = chunk.map((p) => p.modified).filter(Boolean).sort().pop();
    parts.push(`<sitemap><loc>${esc(`${site}/${name}`)}</loc>${last ? `<lastmod>${esc(last)}</lastmod>` : ''}</sitemap>`);
  }
  out['sitemap.xml'] = `${head}<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${parts.join('\n')}\n</sitemapindex>\n`;
  return out;
}

function byKind(pages: SeoPage[], lang: PageLang, kind: SeoPage['kind']): SeoPage[] {
  return pages.filter((p) => p.lang === lang && p.kind === kind);
}

/**
 * llms.txt (llmstxt.org): what the museum is, in its own words, and where
 * its pages are, with the full text one link away.
 */
export function llmsTxt(input: SeoInput, pages: SeoPage[]): string {
  const s = input.site;
  const link = (p: SeoPage, note?: string) => `- [${p.name}](${s}${p.path})${note ? `: ${note}` : ''}`;
  const en = input.home.en;
  const lines = [
    '# Sankofa',
    '',
    `> ${en.description}`,
    '',
    ...en.lede.flatMap((p) => [p, '']),
    `Every page exists in English and in Russian (the Russian page is the same path under ${s}/ru/). The complete text of the museum, as plain Markdown, is at ${s}/llms-full.txt (English) and ${s}/ru/llms-full.txt (Russian).`,
    '',
  ];
  const features = byKind(pages, 'en', 'feature');
  if (features.length) {
    lines.push('## Special projects', '', ...features.map((p) => link(p, p.description)), '');
  }
  const chapters = byKind(pages, 'en', 'chapter');
  if (chapters.length) lines.push(`## ${label('chapters', 'en')}`, '', ...chapters.map((p) => link(p, p.description)), '');
  const about = [...byKind(pages, 'en', 'guide'), ...byKind(pages, 'en', 'dedication')];
  lines.push('## About the museum', '', `- [Sankofa](${s}/): the museum itself, with its atlas, timeline and listening room`, ...about.map((p) => link(p, p.description)), `- [Source code and content](https://github.com/tym83/sankofa): the museum is also a Kubernetes distribution; every card is an object in the cluster`, '');
  lines.push('## In Russian', '', `- [Sankofa](${s}/ru/)`, ...byKind(pages, 'ru', 'feature').map((p) => link(p)), ...byKind(pages, 'ru', 'chapter').map((p) => link(p)), '');
  lines.push('## Optional', '', `- [Feed of special projects](${s}/features.atom)`, `- [Sitemap](${s}/sitemap.xml)`, ...byKind(pages, 'en', 'card').map((p) => link(p)), '');
  return lines.join('\n');
}

function proseMarkdown(file: ProseFile | undefined, lang: PageLang, href: (id: string) => string | undefined): string {
  const doc = file?.[lang] ?? file?.en;
  if (!doc) return '';
  const out = [`## ${doc.title ?? ''}`, ''];
  for (const b of doc.blocks) {
    const text = b.inline
      .map((x) => (x.t === 'unseen' ? '' : x.t === 'card' ? (href(x.id) ? `[${x.s}](${href(x.id)})` : x.s) : x.t === 'em' ? `*${x.s}*` : x.t === 'strong' ? `**${x.s}**` : x.t === 'link' ? `[${x.s}](${x.href})` : x.s))
      .join('')
      .trim();
    if (!text) continue;
    out.push(b.type === 'h2' ? `### ${text}` : b.type === 'h3' ? `#### ${text}` : b.type === 'quote' ? `> ${text}` : text, '');
  }
  return out.join('\n');
}

/** The museum's whole text in one Markdown file per language: projects, chapters, guide, cards. */
export function llmsFullTxt(input: SeoInput, lang: PageLang): string {
  const s = input.site;
  const data = input;
  const ids = new Set(data.cards.map((c) => c.id));
  const href = (id: string) => (ids.has(id) ? s + pagePath('card', lang, id) : undefined);
  const md = (t: string) => markdown(t, href);
  const h = input.home[lang];
  const out = [`# Sankofa — ${lang === 'ru' ? 'полный текст музея' : 'the full text of the museum'}`, '', `> ${h.description}`, '', `Source: ${s}${lang === 'ru' ? '/ru/' : '/'}`, '', ...h.lede.flatMap((p) => [p, ''])];
  if (data.features.features.length) out.push(`# ${data.features.ui['list-title']?.[lang] ?? 'Special projects'}`, '');
  for (const e of data.features.features) {
    const f = data.featureData[e.id];
    if (!f) continue;
    const lenses = new Map((f.lenses ?? []).map((l) => [l.id, l.name[lang]]));
    out.push(`## ${f.title[lang]}`, '', `URL: ${s}${pagePath('feature', lang, f.id)}`, '', md(f.dek[lang]), '');
    for (const sc of f.scenes) {
      for (const b of sc.blocks) {
        const t = md(b[lang]).trim();
        if (!t) continue;
        const who = b.lens && lenses.get(b.lens) ? `${lenses.get(b.lens)}: ` : '';
        out.push(b.role === 'title' ? `### ${t}` : b.role === 'quote' ? `> ${who}${t}` : b.role === 'kicker' ? `*${t}*` : `${who}${t}`, '');
      }
    }
    const nodes = f.lineage?.nodes ?? [];
    if (nodes.length) {
      out.push(`### ${label('recordings', lang)}`, '');
      for (const n of nodes) out.push(`- ${[n.title, n.artist, n.year].filter(Boolean).join(' — ')}${n.story?.[lang] ? `. ${plain(n.story[lang])}` : ''}${n.sources?.length ? ` Sources: ${n.sources.map((x) => `[${x.title}](${x.url})`).join('; ')}` : ''}`);
      out.push('');
    }
  }
  out.push(`# ${label('chapters', lang)}`, '');
  for (const ch0 of data.chapters) {
    const ch = localizeChapter(ch0, lang);
    out.push(`## ${ch.title}`, '', `*${ch.kicker}*`, '', `URL: ${s}${pagePath('chapter', lang, ch.id)}`, '');
    ch.steps.forEach((st, i) => {
      if (ch.stepCopies?.[i] === 'f') return;
      out.push(md(st.replace(/^\{(male|female)\}\s+/, '')), '');
    });
  }
  const guide = proseMarkdown(data.guide, lang, href);
  if (guide) out.push(`# ${label('guide', lang)}`, '', guide);
  out.push(`# ${label('cards', lang)}`, '');
  for (const c0 of data.cards) {
    const c = localizeCard(c0, lang);
    out.push(`## ${c.title}`, '', `URL: ${s}${pagePath('card', lang, c.id)}`, '', `**${md(c.wow)}**`, '');
    for (const p of paragraphs(bodyForEdition(c.body, c0.edition === 'f' ? 'f' : 'm'))) out.push(md(p), '');
    if (c.dispute) out.push(`${label('contested', lang)} ${md(c.dispute)}`, '');
    if (c.sources?.length) out.push(`${label('sources', lang)}:`, ...c.sources.map((x) => `- ${x.url ? `[${x.title}](${x.url})` : x.title}`), '');
  }
  return out.join('\n');
}

/** An Atom feed of the special projects, newest first. */
export function featuresAtom(site: string, pages: SeoPage[], lang: PageLang, built: string): string {
  const feats = byKind(pages, lang, 'feature').sort((a, b) => (b.published ?? '').localeCompare(a.published ?? ''));
  const self = `${site}${lang === 'ru' ? '/ru' : ''}/features.atom`;
  const list = byKind(pages, lang, 'features')[0];
  const updated = feats.map((p) => p.modified).filter(Boolean).sort().pop() ?? built;
  const title = lang === 'ru' ? 'Sankofa: спецпроекты' : 'Sankofa: special projects';
  const entries = feats.map((p) =>
    [
      '  <entry>',
      `    <id>${esc(site + p.path)}</id>`,
      `    <title>${esc(p.name)}</title>`,
      `    <link rel="alternate" type="text/html" href="${esc(site + p.path)}"/>`,
      `    <published>${esc(p.published ?? updated)}</published>`,
      `    <updated>${esc(p.modified ?? p.published ?? updated)}</updated>`,
      `    <summary>${esc(p.description)}</summary>`,
      `    <link rel="enclosure" type="image/jpeg" href="${esc(p.image.url)}"/>`,
      '  </entry>',
    ].join('\n'),
  );
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${lang}">`,
    `  <id>${esc(self)}</id>`,
    `  <title>${esc(title)}</title>`,
    ...(list ? [`  <subtitle>${esc(list.description)}</subtitle>`, `  <link rel="alternate" type="text/html" href="${esc(site + list.path)}"/>`] : []),
    `  <link rel="self" type="application/atom+xml" href="${esc(self)}"/>`,
    `  <updated>${esc(updated)}</updated>`,
    '  <author><name>Sankofa</name><uri>' + esc(site + '/') + '</uri></author>',
    `  <icon>${esc(site)}/favicon.svg</icon>`,
    ...entries,
    '</feed>',
    '',
  ].join('\n');
}
