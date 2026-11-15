// Build web/public/data/countries.json: for each present-day country, the
// cards whose places lie in it, with the country's names and short header
// from content/countries.yaml.
//
//   node build-countries.ts <cards.json> <countries.yaml> <out.json>
//
// Boundaries: Natural Earth 1:50m admin-0 (public domain) from the
// world-atlas package the map already draws. Every country that receives a
// card must be named in countries.yaml (English and Russian), or the build fails.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import YAML from 'yaml';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import { assignCard, isoOf, type CountryFeature, type Pin } from '../src/lib/countryAssign.ts';

interface Entry {
  id: string;
  iso: string;
  name: { en: string; ru: string };
  about?: { en: string; ru: string };
}

const [cardsPath, yamlPath, outPath] = process.argv.slice(2);
if (!cardsPath || !yamlPath || !outPath) {
  console.error('usage: build-countries.ts <cards.json> <countries.yaml> <out.json>');
  process.exit(2);
}

const require = createRequire(import.meta.url);
const topo = JSON.parse(readFileSync(require.resolve('world-atlas/countries-50m.json'), 'utf8')) as Topology;
const features = (feature(topo, topo.objects.countries as never) as unknown as { features: CountryFeature[] }).features;
const cards = (JSON.parse(readFileSync(cardsPath, 'utf8')) as { cards: { id: string; places: { name: string; lat: number; lon: number }[] }[] }).cards;
interface Area {
  country: string;
  box: [number, number, number, number];
}
interface Override {
  card: string;
  place: string;
  country: string;
}
const doc = (existsSync(yamlPath) ? YAML.parse(readFileSync(yamlPath, 'utf8')) : {}) as { countries?: Entry[]; areas?: Area[]; overrides?: Override[] };
// Without a countries file (the placeholder fixtures), Natural Earth's own names stand in.
const slug = (s: string) => s.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const entries: Entry[] = existsSync(yamlPath)
  ? (doc.countries ?? [])
  : [...new Map(features.map((f) => [isoOf(f), f])).values()].map((f) => ({ id: slug(f.properties?.name ?? isoOf(f)) || isoOf(f), iso: isoOf(f), name: { en: f.properties?.name ?? '', ru: f.properties?.name ?? '' } }));
const areas = doc.areas ?? [];
const overrides = doc.overrides ?? [];

const errors: string[] = [];
const byIso = new Map<string, Entry>();
const ids = new Set<string>();
for (const e of entries) {
  if (!e.id || !/^[a-z0-9-]+$/.test(e.id)) errors.push(`countries.yaml: bad id ${JSON.stringify(e.id)}`);
  if (ids.has(e.id)) errors.push(`countries.yaml: ${e.id} is listed twice`);
  ids.add(e.id);
  if (!e.name?.en || !e.name?.ru) errors.push(`countries.yaml: ${e.id} needs name.en and name.ru`);
  if (e.about && (!e.about.en || !e.about.ru)) errors.push(`countries.yaml: ${e.id} has a header in one language only`);
  byIso.set(String(e.iso), e);
}

const isoById = new Map(entries.map((e) => [e.id, String(e.iso)]));
const target = (id: string, where: string): string | null => {
  if (id === 'none') return null;
  const iso = isoById.get(id);
  if (!iso) errors.push(`countries.yaml: ${where} names unknown country ${id}`);
  return iso ?? null;
};
const byCard = new Map<string, Override[]>();
for (const o of overrides) byCard.set(o.card, [...(byCard.get(o.card) ?? []), o]);
const used = new Set<Override>();
const pinFor = (id: string): Pin => (_, p) => {
  const o = byCard.get(id)?.find((x) => x.place === p.name);
  if (o) {
    used.add(o);
    return target(o.country, `override ${o.card}`);
  }
  const a = areas.find((x) => p.lon >= x.box[0] && p.lat >= x.box[1] && p.lon <= x.box[2] && p.lat <= x.box[3]);
  return a ? target(a.country, 'area') : undefined;
};

const tally = new Map<string, { id: string; places: number[]; main: boolean }[]>();
let none = 0;
for (const c of cards) {
  const here = assignCard(features, c.places, pinFor(c.id));
  if (!here.size) none++;
  for (const [iso, places] of here) {
    tally.set(iso, [...(tally.get(iso) ?? []), { id: c.id, places, main: places[0] === 0 }]);
  }
}

for (const o of overrides) if (!used.has(o)) errors.push(`countries.yaml: override ${o.card} / ${JSON.stringify(o.place)} matches no card place`);
const nameOf = new Map(features.map((f) => [isoOf(f), f.properties?.name ?? '?']));
for (const iso of tally.keys()) {
  if (!byIso.has(iso)) errors.push(`countries.yaml: no entry for iso ${iso} (${nameOf.get(iso)}), which has ${tally.get(iso)!.length} card(s)`);
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

const countries = [...tally.entries()]
  .map(([iso, list]) => {
    const e = byIso.get(iso)!;
    return { id: e.id, iso, name: e.name, ...(e.about ? { about: e.about } : {}), cards: list };
  })
  .sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(outPath, JSON.stringify({ countries }) + '\n');
const headers = countries.filter((c) => c.about).length;
console.log(`countries: ${countries.length} with cards (${headers} with a header), ${none} cards at sea or nowhere -> ${outPath}`);
