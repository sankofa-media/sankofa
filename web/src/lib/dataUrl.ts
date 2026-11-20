import manifest from 'virtual:runtime-data';
import { lang } from './i18n';

export function dataUrl(url: string): string {
  const key = url.replace(/^\//, '').replace(/\.json$/, `.${lang()}.json`);
  const digest = manifest[key];
  return digest ? '/' + key.replace(/^data\//, 'data/cache/').replace(/\.json$/, `.${digest}.json`) : url;
}

/** Restore bilingual accessors from the single shipped language, without another transfer. */
export function hydrateLanguage(value: any): any {
  if (Array.isArray(value)) return value.map(hydrateLanguage);
  if (!value || typeof value !== 'object') return value;
  for (const key of Object.keys(value)) value[key] = hydrateLanguage(value[key]);
  for (const key of Object.keys(value)) {
    if (key.endsWith('Ru') && typeof value[key] === 'string' && !(key.slice(0, -2) in value)) value[key.slice(0, -2)] = value[key];
  }
  if ('en' in value && !('ru' in value)) value.ru = value.en;
  if ('ru' in value && !('en' in value)) value.en = value.ru;
  return value;
}
