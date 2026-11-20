import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { contentsFor } from '../src/mechanics/cabinet/model.ts';
import { bodyForEdition, localizeCard, localizeChapter } from '../src/lib/cards.ts';

/** Preserve the data interfaces while shipping only the requested translation. */
export function localized(value: any, language: 'en' | 'ru'): any {
  if (Array.isArray(value)) return value.map(v => localized(v, language));
  if (!value || typeof value !== 'object') return value;
  // Roots and recording notes use field/fieldRu rather than {en, ru}.
  // Keep bilingual names for search and geographic keys.
  const prose = (key: string) => !['name', 'place', 'genre'].includes(key) && typeof value[key] === 'string' && typeof value[key + 'Ru'] === 'string';
  return Object.fromEntries(Object.entries(value)
    .filter(([k]) => !(language === 'en' && k.endsWith('Ru') && prose(k.slice(0, -2))) && !(language === 'ru' && prose(k) && value[k + 'Ru']))
    .filter(([k]) => !('en' in value && 'ru' in value) || k !== (language === 'en' ? 'ru' : 'en'))
    .map(([k, v]) => [k, localized(v, language)]));
}

export function runtimeData(): Plugin {
  const manifest: Record<string, string> = {};
  let building = false;
  const development = new Map<string, string>();
  return {
    name: 'runtime-data',
    configResolved(config) { building = config.command === 'build'; },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const value = development.get(req.url ?? '');
        if (!value) return next();
        res.setHeader('Content-Type', 'application/json');
        res.end(value);
      });
    },
    resolveId(id) { if (id === 'virtual:runtime-data') return '\0runtime-data'; },
    load(id) { if (id === '\0runtime-data') return `export default ${JSON.stringify(manifest)}`; },
    buildStart() {
      const emit = (key: string, value: unknown) => {
        const source = JSON.stringify(value);
        const digest = createHash('sha256').update(source).digest('hex').slice(0, 16);
        const fileName = `data/cache/${key.replace(/^data\//, '').replace(/\.json$/, '')}.${digest}.json`;
        if (building) this.emitFile({ type: 'asset', fileName, source });
        else development.set('/' + fileName, source);
        manifest[key] = digest;
      };
      const walk = (dir: string, prefix = 'data') => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const key = `${prefix}/${entry.name}`;
          if (entry.isDirectory()) { walk(join(dir, entry.name), key); continue; }
          if (!entry.name.endsWith('.json')) continue;
          const original = JSON.parse(readFileSync(join(dir, entry.name), 'utf8'));
          for (const language of ['en', 'ru'] as const) {
            let value = localized(original, language);
            if (key === 'data/cards.json') {
              value.cards = original.cards.map((c: any) => {
                const { translations, ...card } = localizeCard(c, language);
                const counterText = Object.fromEntries(['m', 'f'].flatMap(edition => {
                  const text = `${c.wow} ${bodyForEdition(c.body, edition as 'm' | 'f')}`;
                  const match = text.match(/\b(?:(?:nearly|almost|about|around|over|more than)\s+)?\d{1,3}(?:,\d{3})+\b/i);
                  return match ? [[edition, match[0]]] : [];
                }));
                return { ...card, localized: true, sourceTitle: c.title, ...(Object.keys(counterText).length ? { counterText } : {}) };
              });
              emit(`data/card-index.${language}.json`, { cards: value.cards.map((c: any) => ({ id: c.id, title: c.title, wow: c.wow, books: c.books, years: c.years, places: c.places, era: c.era, kind: c.kind, pair: c.pair, edition: c.edition, inline: c.inline, label: c.label, body: '' })) });
              for (const c of value.cards) emit(`data/cards/${c.id}.${language}.json`, c);
              for (const c of original.cards) emit(`data/raw-cards/${c.id}.${language}.json`, c);
            }
            if (key === 'data/chapters.json') value.chapters = original.chapters.map((c: any) => {
              const { translations, ...chapter } = localizeChapter(c, language);
              return { ...chapter, localized: true };
            });
            if (key === 'data/checks.json') for (const [id, check] of Object.entries(value.cards)) emit(`data/checks/${id}.${language}.json`, check);
            if (key === 'data/cabinet.json') {
              for (const { id } of JSON.parse(readFileSync('public/data/features.json', 'utf8')).features) {
                const caches = value.caches.filter((c: any) => c.hidden.at === 'feature' && c.hidden.feature === id);
                const ids = new Set(caches.flatMap((c: any) => [...contentsFor(c, 'm'), ...contentsFor(c, 'f')]));
                const keyIds = new Set(caches.flatMap((c: any) => [c.lock, ...(c.gives ?? [])]));
                const keys = value.keys.filter((k: any) => keyIds.has(k.id));
                const artifacts = value.artifacts.filter((a: any) => ids.has(a.id));
                const sources = Object.fromEntries(Object.entries(value.sources ?? {}).filter(([k]) => caches.some((c: any) => k === `cache:${c.id}`) || ids.has(k.replace(/^artifact:/, ''))));
                emit(`data/feature-caches/${id}.${language}.json`, { ...value, caches, artifacts, sources, drawers: [], keys });
              }
            }
            emit(key.replace(/\.json$/, `.${language}.json`), value);
          }
        }
      };
      walk('public/data');
    },
  };
}
