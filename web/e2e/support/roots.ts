// Serve the placeholder deep roots (web/fixtures/roots) in place of the
// exported ones, until the deepened collection is merged. Paths are found
// the way pkg/roots does: artist ids, then the final card.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { Page } from '@playwright/test';

interface Link {
  to: string;
}
interface Artist {
  id: string;
  links: Link[];
  paths?: string[][];
}

export function fixtureRoots(): Artist[] {
  const dir = join(process.cwd(), 'fixtures', 'roots');
  const all: Artist[] = readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => parse(readFileSync(join(dir, f), 'utf8')));
  const byId = new Map(all.map((a) => [a.id, a]));
  for (const a of all) {
    const paths: string[][] = [];
    const walk = (id: string, chain: string[]) => {
      for (const l of byId.get(id)?.links ?? []) {
        const [kind, ref] = l.to.split(':');
        if (kind === 'card') paths.push([...chain, id, l.to]);
        else if (!chain.includes(ref)) walk(ref, [...chain, id]);
      }
    };
    walk(a.id, []);
    a.paths = paths;
  }
  return all;
}

interface ElementsFixture {
  elements: unknown[];
  carries: Record<string, object>;
  cardCarries: Record<string, string[]>;
}

export function fixtureElements(): ElementsFixture {
  return parse(readFileSync(join(process.cwd(), 'fixtures', 'elements.yaml'), 'utf8'));
}

/**
 * Serve the placeholder roots (web/fixtures/roots) and/or the placeholder
 * elements of music (web/fixtures/elements.yaml, laid over the links).
 */
export async function serveFixtureRoots(page: Page, opts: { roots?: boolean; elements?: boolean } = { roots: true }): Promise<void> {
  const fx = opts.elements ? fixtureElements() : undefined;
  await page.route('**/data/cards.json', async (route) => {
    const res = await route.fetch();
    const data = await res.json();
    const roots: { id: string; links: { to: string }[] }[] = opts.roots ? fixtureRoots() : data.roots;
    if (fx) for (const a of roots) for (const l of a.links) Object.assign(l, fx.carries[`${a.id}>${l.to}`] ?? {});
    await route.fulfill({ response: res, json: { ...data, roots } });
  });
  if (!fx) return;
  await page.route('**/data/elements.json', (route) => route.fulfill({ json: { elements: fx.elements } }));
  await page.route('**/data/card-links.json', async (route) => {
    const res = await route.fetch();
    const data = await res.json();
    for (const l of data.links) l.carries = fx.cardCarries[`${l.from}>${l.to}`] ?? l.carries;
    await route.fulfill({ response: res, json: data });
  });
}

/** The real roots with the placeholder elements of music laid over them. */
export const serveFixtureElements = (page: Page) => serveFixtureRoots(page, { elements: true });
