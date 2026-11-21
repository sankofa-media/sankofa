// Build the special projects (content/features) into the museum's data:
//   data/features.json        the list, with the engine's own labels
//   data/features/<id>.json   one feature: its scenes and its river
//   media/features/<id>/      the generated illustrations its scenes use
// Validation stops the build: every scene has text in English and Russian,
// every lineage node a scene uses has sources, every playable link is on an
// allowed host, every real photo has a rights entry, every illustration
// layer exists, has its alt text and is marked generated (and is never a
// file of the photo-rights ledger). Blocks held for a
// second source (hold: true) are dropped here and never reach a reader.
// Usage: node scripts/build-features.ts <content-dir> <data-dir> [<media-dir>]
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { featureCover, isFeatureId, publishFeature, sceneArtFiles, validateFeature, type Bi, type FeatureEntry, type FeatureSource, type FeaturesIndex } from '../src/features/model.ts';
import { compileLineage, sourcedNodes, validateLineage, type RawLineage } from '../src/features/lineage.ts';

const [src, out, media = join(out ?? '', '..', 'media')] = process.argv.slice(2);
if (!src || !out) {
  console.error('usage: build-features.ts <content-dir> <data-dir> [<media-dir>]');
  process.exit(2);
}
const dir = join(src, 'features');
const outDir = join(out, 'features');
const artOut = join(media, 'features');
rmSync(outDir, { recursive: true, force: true });
rmSync(artOut, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const yaml = <T>(p: string): T => YAML.parse(readFileSync(p, 'utf8')) as T;

const indexFile = join(dir, 'index.yaml');
const index = existsSync(indexFile) ? yaml<{ order?: string[]; ui?: Record<string, Bi> }>(indexFile) : { order: [], ui: {} };
const mediaLedger = join(src, 'ledger', 'media.yaml');
// A photo is cleared when its ledger entry names the source page, the licence
// and its wording, and the file in content/media is exactly the one checked.
const sha = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');
const ledgerEntries = existsSync(mediaLedger) ? (yaml<{ file: string; url?: string; license?: string; license_wording?: string; sha256?: string }[]>(mediaLedger) ?? []) : [];
const ledger = new Set(ledgerEntries.map((e) => e.file));
// Feature-local photographs share the rights ledger without duplicate originals.
const photoSource = (file: string) => {
  const scoped = /^features\/([a-z0-9-]+)\/([a-z0-9-]+\.(?:jpg|png|webp))$/.exec(file);
  return scoped ? join(dir, scoped[1], 'media', scoped[2]) : join(src, 'media', file);
};
const rights = new Set(
  ledgerEntries
    .filter((e) => e.url && e.license && e.license_wording && existsSync(photoSource(e.file)) && e.sha256 === sha(photoSource(e.file)))
    .map((e) => e.file),
);
const cardsDir = join(src, 'cards');
const cards = new Set(existsSync(cardsDir) ? readdirSync(cardsDir).filter((f) => f.endsWith('.md') && !/\.[a-z]{2}\.md$/.test(f)).map((f) => f.slice(0, -3)) : []);

const errors: string[] = [];
const entries: FeatureEntry[] = [];
let held = 0;
let art = 0;
for (const id of index.order ?? []) {
  if (!isFeatureId(id)) {
    errors.push(`index.yaml: ${id} is not a feature id`);
    continue;
  }
  const file = join(dir, id, 'feature.yaml');
  if (!existsSync(file)) {
    errors.push(`${id}: no feature.yaml`);
    continue;
  }
  const f = yaml<FeatureSource>(file);
  if (f.id !== id) errors.push(`${id}/feature.yaml: id is ${f.id}`);
  let raw: RawLineage | undefined;
  if (f.lineage) {
    raw = yaml<RawLineage>(join(dir, id, f.lineage));
    errors.push(...validateLineage(raw).map((e) => `${id}/${f.lineage}: ${e}`));
  }
  const sync = new Set((raw?.sync ?? []).filter((s) => (s.sources ?? []).length > 0).map((s) => s.work));
  const artDir = join(dir, id, 'art');
  const artFiles = new Set(existsSync(artDir) ? readdirSync(artDir) : []);
  const base = { rights, cards, artFiles, ledger };
  const errs = validateFeature(f, raw ? { ...base, nodes: new Set(raw.nodes.map((n) => n.id)), sourced: sourcedNodes(raw), sync } : base);
  errors.push(...errs.map((e) => `${id}: ${e}`));
  if (errs.length) continue;
  let lineage;
  try {
    lineage = raw && f.river ? compileLineage(raw, f.river) : undefined;
  } catch (e) {
    errors.push(`${id}: ${(e as Error).message}`);
    continue;
  }
  const pub = publishFeature(f, lineage);
  held += pub.held;
  writeFileSync(join(outDir, `${id}.json`), JSON.stringify(pub.data));
  const used = sceneArtFiles(f);
  if (used.length) mkdirSync(join(artOut, id), { recursive: true });
  for (const file of used) {
    copyFileSync(join(artDir, file), join(artOut, id, file));
    // Keep the source's time: build-media.ts remakes a smaller copy only when the layer changed.
    const st = statSync(join(artDir, file));
    utimesSync(join(artOut, id, file), st.atime, st.mtime);
  }
  for (const photo of f.art ?? []) {
    if (photo.kind !== 'photo' || !photo.file.startsWith(`features/${id}/`)) continue;
    mkdirSync(join(artOut, id), { recursive: true });
    copyFileSync(photoSource(photo.file), join(media, photo.file));
  }
  art += used.length;
  const cover = featureCover(f);
  if (f.cover && !cover) errors.push(`${id}: cover ${f.cover} is not a scene with art`);
  // seo: optional description and link-preview picture (scripts/seo uses them).
  const seo = f.seo;
  if (seo?.description && !(seo.description.en?.trim() && seo.description.ru?.trim())) errors.push(`${id}: seo.description needs en and ru`);
  if (seo?.image) {
    if (!artFiles.has(seo.image)) errors.push(`${id}: seo.image ${seo.image} is not in art/`);
    else {
      mkdirSync(join(artOut, id), { recursive: true });
      copyFileSync(join(artDir, seo.image), join(artOut, id, seo.image));
    }
  }
  entries.push({ id, title: f.title, dek: f.dek, ...(f.reading ? { reading: f.reading } : {}), scenes: f.scenes.length, ...(cover ? { cover } : {}), ...(seo ? { seo } : {}) });
}
for (const [k, v] of Object.entries(index.ui ?? {})) if (!v || !v.en || !v.ru) errors.push(`index.yaml: ui.${k} needs en and ru`);
if (errors.length) {
  console.error(`features: ${errors.length} problem(s):\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
const list: FeaturesIndex = { version: 1, ui: index.ui ?? {}, features: entries };
writeFileSync(join(out, 'features.json'), JSON.stringify(list));
console.log(`features: ${entries.length} (${entries.map((e) => `${e.id}: ${e.scenes} scenes`).join(', ')}), ${held} held block(s) left out, ${art} illustration layer(s) -> ${out}`);
