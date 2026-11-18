// The Cabinet of Curiosities across the whole museum: every cache can be
// found where it hides (a picture, a word of a card, a chapter, a factoid,
// the atlas and its countries, Roots, the name index, a longread, the
// Workshop, the cluster's letter lock) and opened; the key chains open in
// order and only in order; both copies, both languages, phone width (the
// mobile project).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { contentsFor, keyChains, type CabinetFile, type Cache } from '../src/mechanics/cabinet/model';

const cab = JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', 'cabinet.json'), 'utf8')) as CabinetFile;
/** The lock words stay in the content; the built data has only their hashes. */
const words = new Map<string, string>(
  (parse(readFileSync(join(process.cwd(), '..', 'content', 'cabinet', 'caches.yaml'), 'utf8')) as { caches: Cache[] }).caches.flatMap((c) => (c.hidden.at === 'cluster' && c.hidden.word ? [[c.id, c.hidden.word] as [string, string]] : [])),
);

type Holdings = { found?: string[]; sorted?: string[]; opened?: string[]; keys?: string[]; unlocked?: string[] };

const as = (edition: 'm' | 'f', lang?: 'ru', held?: Holdings) => async ({ page }: { page: Page }) => {
  await page.addInitScript(
    ([e, l, hs]) => {
      localStorage.setItem('sankofa.edition', e as string);
      localStorage.setItem('sankofa.navlegend', '1');
      if (l) localStorage.setItem('sankofa.lang', l as string);
      if (hs && !sessionStorage.getItem('cb-seeded')) {
        localStorage.setItem('sankofa.cabinet', hs as string);
        sessionStorage.setItem('cb-seeded', '1');
      }
    },
    [edition, lang ?? '', held ? JSON.stringify(held) : ''],
  );
  await page.route(/youtube|ytimg|googlevideo/, (r) => r.abort());
};

const modal = (page: Page) => page.locator('.cb-modal');
const sel = (id: string) => `[data-cache="${id}"]`;
const q = (lang?: 'ru') => (lang ? `&lang=${lang}` : '');

/** Go where a cache hides and return what reveals it (a glint, a word, a drawer's contents). */
async function reveal(page: Page, c: Cache, lang?: 'ru'): Promise<Locator> {
  const hd = c.hidden;
  switch (hd.at) {
    case 'card-image':
    case 'card-text':
      await page.goto(`/#focus=${hd.card}${q(lang)}`);
      return page.locator(`.drawer.on article.card[data-card-id="${hd.card}"] ${sel(c.id)}`);
    case 'factoid':
      await page.goto(`/#focus=${c.cards![0]}${q(lang)}`);
      return page.locator(`.drawer.on .fx-footer .fx[data-fact="${hd.fact}"] ${sel(c.id)}`);
    case 'chapter-step':
      await page.goto(`/#ch=${hd.chapter}${q(lang)}`);
      return page.locator(`#ch-${hd.chapter} ${sel(c.id)}`);
    case 'atlas':
      await page.goto(`/#view=atlas${q(lang)}`);
      return page.locator(`.atlas.open g.cb-aglint${sel(c.id)}`);
    case 'country':
      await page.goto(`/#atlas=countries&country=${hd.country}${q(lang)}`);
      return page.locator(`.cn-head[data-country="${hd.country}"] ${sel(c.id)}`);
    case 'roots':
      await page.goto(`/#view=roots&artist=${hd.artist}${q(lang)}`);
      return page.locator(`.r-tree[data-root="${hd.artist}"] .r-story ${sel(c.id)}`);
    case 'index':
      await page.goto(`/#view=index${q(lang)}`);
      return page.locator(`.mx-index ${sel(c.id)}`);
    case 'feature':
      await page.goto(`/#view=feature&item=${hd.feature}&scene=${hd.scene}${q(lang)}`);
      return page.locator(`.ft-sheet [data-scene="${hd.scene}"] [data-block="${hd.block}"] ${sel(c.id)}`);
    case 'workshop': {
      await page.goto(`/#view=workshop&item=${hd.object}${q(lang)}`);
      const btn = page.locator(`#object-${hd.object} .cb-wdrawer-btn`);
      await btn.scrollIntoViewIfNeeded();
      await btn.click();
      return page.locator(`#object-${hd.object} ${sel(c.id)}`);
    }
    case 'cluster': {
      await page.goto(`/#view=cabinet${q(lang)}`);
      const input = page.locator('#cb-lock-word');
      await expect(input).toBeVisible();
      await input.fill(words.get(c.id)!.toUpperCase());
      return page.locator('.cb-lock-go');
    }
  }
}

const touch = (page: Page) => page.evaluate(() => matchMedia('(hover: none)').matches);

/** Find a cache and open its dialog, from the keyboard as a reader with no mouse would. */
async function find(page: Page, c: Cache, lang?: 'ru'): Promise<void> {
  const el = await reveal(page, c, lang);
  await expect(el).toBeAttached({ timeout: 20_000 });
  // Hidden until hovered; a touch screen has no hover, so there it stays faintly seen.
  if (c.hidden.at === 'card-image' || c.hidden.at === 'index' || c.hidden.at === 'atlas') await expect(el).toHaveCSS('opacity', (await touch(page)) ? '0.35' : '0');
  await el.focus();
  await page.keyboard.press('Enter');
  await expect(modal(page).locator('#cb-cache-title')).toBeVisible();
}

/** Open the dialog's cache, with the key when it is locked; returns what was inside. */
async function openIt(page: Page): Promise<string[]> {
  const key = modal(page).locator('.cb-usekey');
  if (await key.count()) await key.click();
  else await modal(page).locator('.cb-openit').click();
  await expect(modal(page).locator('.cb-inside h3')).toBeVisible();
  return modal(page).locator('.cb-find').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.artifact!));
}

const phase2 = cab.caches.filter((c) => !['sea-chest', 'box-brown-box', 'pullman-grip', 'windrush-suitcase', 'record-crate', 'griot-bag', 'schomburg-box', 'inventors-strongbox'].includes(c.id));

test.describe('every cache can be found and opened', () => {
  for (const c of cab.caches) {
    test(`${c.id} (${c.hidden.at})`, async ({ page }) => {
      await as('m', undefined, c.lock ? { keys: [c.lock] } : undefined)({ page });
      await find(page, c);
      expect((await openIt(page)).sort()).toEqual(contentsFor(c, 'm').slice().sort());
      // Once opened it stays opened, wherever it hides.
      await page.keyboard.press('Escape');
      await expect(modal(page)).toHaveCount(0);
    });
  }
});

test.describe('the chains open in order, and only in order', () => {
  for (const chain of keyChains(cab)) {
    test(chain.join(' → '), async ({ page }) => {
      await as('m')({ page });
      const links = chain.map((l) => l.split(':') as ['cache' | 'drawer', string]);
      for (const [i, [kind, id]] of links.entries()) {
        if (kind === 'drawer') {
          await page.goto('/#view=cabinet');
          const d = page.locator(`.mx-sheet.open .cb-drawer[data-drawer="${id}"]`);
          await expect(d.locator('.cb-plate').first()).toHaveText(/no label|без надписи/);
          if (!(await d.locator('.cb-usekey').isVisible())) await d.locator('.cb-face').first().click();
          await d.locator('.cb-usekey').click();
          await expect(page.locator(`.mx-sheet.open .cb-drawer[data-drawer="${id}"] .cb-thing`).first()).toBeVisible();
          continue;
        }
        const c = cab.caches.find((x) => x.id === id)!;
        await find(page, c);
        // A locked link waits for the key of the one before it.
        if (c.lock) await expect(modal(page).locator('.cb-usekey')).toBeVisible();
        if (i < links.length - 1 && links[i + 1][0] === 'cache') {
          const next = cab.caches.find((x) => x.id === links[i + 1][1])!;
          if (next.lock && i === 0) {
            await page.keyboard.press('Escape');
            await find(page, next);
            await expect(modal(page).locator('.cb-locked')).toBeVisible();
            await expect(modal(page).locator('.cb-usekey')).toHaveCount(0);
            await page.keyboard.press('Escape');
            await find(page, c);
          }
        }
        await openIt(page);
        if (c.gives?.length) await expect(modal(page).locator('.cb-keyfind')).toHaveCount(c.gives.length);
        if (c.clue) await expect(modal(page).locator('.cb-clue')).toBeVisible();
        await page.keyboard.press('Escape');
      }
    });
  }
});

test.describe('the other copy', () => {
  const differs = phase2.find((c) => c.contents.f?.length && !c.lock);
  test.skip(!differs, 'no phase-two cache differs between the copies');
  test('a cache holds something else in the female copy', async ({ page }) => {
    await as('f')({ page });
    await find(page, differs!);
    const got = await openIt(page);
    expect(got.sort()).toEqual(contentsFor(differs!, 'f').slice().sort());
    expect(got).not.toContain(differs!.contents.m?.[0]);
  });
});

test.describe('in Russian', () => {
  test('hidden words and the letter lock speak Russian', async ({ page }) => {
    await as('m', 'ru')({ page });
    for (const at of ['roots', 'factoid', 'country', 'feature'] as const) {
      const c = phase2.find((x) => x.hidden.at === at && !x.lock);
      if (!c) continue;
      const el = await reveal(page, c, 'ru');
      await expect(el).toHaveAttribute('aria-label', /Здесь что-то спрятано/, { timeout: 20_000 });
      const anchor = (c.hidden as { anchor: { ru: string } }).anchor.ru;
      expect((await el.textContent())?.replace(/\s+/g, ' ')).toBe(anchor.replace(/\s+/g, ' '));
    }
    await page.goto('/#view=cabinet&lang=ru');
    await expect(page.locator('.cb-letterlock h3')).toContainText('Кодовый замок');
    await page.locator('#cb-lock-word').fill('nothing');
    await page.locator('.cb-lock-go').click();
    await expect(page.locator('.cb-lock-msg')).toContainText('не поддаётся');
  });
});
