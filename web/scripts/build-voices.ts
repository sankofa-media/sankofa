// Build the voices remembering slavery (content/voices) into the museum's data:
//   data/voices.json         the excerpts, their credits and their cues
//   data/voices/<id>.<l>.vtt the subtitle files, for the players' <track>
// Validation stops the build (lib/voices: parseVoices). No audio is copied:
// the excerpts stream from the Library of Congress.
// Usage: node scripts/build-voices.ts <content-dir> <data-dir>
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EMPTY_VOICES, parseVoices } from '../src/lib/voices.ts';

const [src, out] = process.argv.slice(2);
if (!src || !out) {
  console.error('usage: build-voices.ts <content-dir> <data-dir>');
  process.exit(2);
}
const dir = join(src, 'voices');
const file = join(dir, 'voices.yaml');
const cardsDir = join(src, 'cards');
const cards = existsSync(cardsDir) ? new Set(readdirSync(cardsDir).filter((f) => f.endsWith('.md') && !/\.[a-z]{2}\.md$/.test(f)).map((f) => f.slice(0, -3))) : undefined;
const data = existsSync(file) ? parseVoices(readFileSync(file, 'utf8'), (f) => readFileSync(join(dir, f), 'utf8'), cards) : EMPTY_VOICES;
const trackDir = join(out, 'voices');
rmSync(trackDir, { recursive: true, force: true });
mkdirSync(trackDir, { recursive: true });
for (const v of data.voices) for (const l of ['en', 'ru'] as const) copyFileSync(join(dir, v.tracks[l].split('/').pop()!), join(trackDir, v.tracks[l].split('/').pop()!));
writeFileSync(join(out, 'voices.json'), JSON.stringify(data));
console.log(`voices: ${data.voices.length} (${[...new Set(data.voices.map((v) => v.card))].join(', ') || 'none'}) -> ${join(out, 'voices.json')}`);
