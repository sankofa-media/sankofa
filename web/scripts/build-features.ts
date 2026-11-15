// Build the special projects (content/features) into the museum's data:
//   data/features.json        the list, with the engine's own labels
//   data/features/<id>.json   one feature: its scenes and its river
// Validation stops the build: every scene has text in English and Russian,
// every lineage node a scene uses has sources, every playable link is on an
// allowed host, every real photo has a rights entry. Blocks held for a
// second source (hold: true) are dropped here and never reach a reader.
// Usage: node scripts/build-features.ts <content-dir> <data-dir>
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { isFeatureId, publishFeature, validateFeature, type Bi, type FeatureEntry, type FeatureSource, type FeaturesIndex } from '../src/features/model.ts';
import { compileLineage, sourcedNodes, validateLineage, type RawLineage } from '../src/features/lineage.ts';

const [src, out] = process.argv.slice(2);
if (!src || !out) {
  console.error('usage: build-features.ts <content-dir> <data-dir>');
  process.exit(2);
}
const dir = join(src, 'features');
const outDir = join(out, 'features');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const yaml = <T>(p: string): T => YAML.parse(readFileSync(p, 'utf8')) as T;

const indexFile = join(dir, 'index.yaml');
const index = existsSync(indexFile) ? yaml<{ order?: string[]; ui?: Record<string, Bi> }>(indexFile) : { order: [], ui: {} };
const mediaLedger = join(src, 'ledger', 'media.yaml');
const rights = new Set(existsSync(mediaLedger) ? (yaml<{ file: string; url?: string; license?: string }[]>(mediaLedger) ?? []).filter((e) => e.url && e.license).map((e) => e.file) : []);

const errors: string[] = [];
const entries: FeatureEntry[] = [];
let held = 0;
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
  const errs = validateFeature(f, raw ? { nodes: new Set(raw.nodes.map((n) => n.id)), sourced: sourcedNodes(raw), sync, rights } : { rights });
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
  entries.push({ id, title: f.title, dek: f.dek, ...(f.reading ? { reading: f.reading } : {}), scenes: f.scenes.length });
}
for (const [k, v] of Object.entries(index.ui ?? {})) if (!v || !v.en || !v.ru) errors.push(`index.yaml: ui.${k} needs en and ru`);
if (errors.length) {
  console.error(`features: ${errors.length} problem(s):\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
const list: FeaturesIndex = { version: 1, ui: index.ui ?? {}, features: entries };
writeFileSync(join(out, 'features.json'), JSON.stringify(list));
console.log(`features: ${entries.length} (${entries.map((e) => `${e.id}: ${e.scenes} scenes`).join(', ')}), ${held} held block(s) left out -> ${out}`);
