// Convert the roots' extra layers into JSON for the web:
//   <content>/roots/elements.yaml (or <content>/elements.yaml) -> data/elements.json
//   <content>/card-links.yaml                                  -> data/card-links.json
// Either may be absent: the museum then shows the roots without them.
// Usage: node scripts/build-roots-extra.ts <content dir> <out dir>
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EMPTY_CARD_LINKS, EMPTY_ELEMENTS, parseCardLinks, parseElements } from '../src/lib/elements.ts';

const [src, out] = process.argv.slice(2);
if (!src || !out) {
  console.error('usage: build-roots-extra.ts <content dir> <out dir>');
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const elementsFile = [join(src, 'roots', 'elements.yaml'), join(src, 'elements.yaml')].find(existsSync);
const elements = elementsFile ? parseElements(readFileSync(elementsFile, 'utf8')) : EMPTY_ELEMENTS;
writeFileSync(join(out, 'elements.json'), JSON.stringify(elements));
const linksFile = join(src, 'card-links.yaml');
const links = existsSync(linksFile) ? parseCardLinks(readFileSync(linksFile, 'utf8')) : EMPTY_CARD_LINKS;
writeFileSync(join(out, 'card-links.json'), JSON.stringify(links));
console.log(`roots extras: ${elements.elements.length} elements, ${links.links.length} card links (${links.unexplained.length} unexplained)`);
