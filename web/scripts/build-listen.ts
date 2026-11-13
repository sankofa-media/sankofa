// Convert content/listen.yaml into data/listen.json.
// Usage: node scripts/build-listen.ts <listen.yaml|-> <out.json>
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { EMPTY_LISTEN, parseListen } from '../src/lib/listen.ts';

const [src, out] = process.argv.slice(2);
if (!src || !out) {
  console.error('usage: build-listen.ts <listen.yaml> <out.json>');
  process.exit(2);
}
const data = existsSync(src) ? parseListen(readFileSync(src, 'utf8')) : EMPTY_LISTEN;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(data));
const n = (r: Record<string, unknown[]>) => Object.values(r).reduce((s, x) => s + x.length, 0);
console.log(`listen: ${n(data.cards)} card and ${n(data.roots)} roots recordings -> ${out}`);
