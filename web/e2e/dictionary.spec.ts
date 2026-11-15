// The dictionary woven through the museum: names on the cover open their
// cards, the rooms link the cards they mention, and the name index lists
// every entry from A to Z.
import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sankofa.edition', 'm'));
});

const sheet = (page: Page) => page.locator('.mx-sheet.open');
const drawerCard = (page: Page, id?: string) => page.locator(`.drawer.on article.card${id ? `[data-card-id="${id}"]` : ''}`);

test('a name on the cover opens its card in place', async ({ page }) => {
  await page.goto('/');
  const link = page.locator('.cover p.deck:visible a[data-card="sun-ra"]');
  await expect(link).toHaveText('Sun Ra');
  // Once the cards are here, the link carries the card's book and its wow.
  await expect(link).toHaveAttribute('title', /^Sun Ra: /);
  await link.click();
  await expect(drawerCard(page, 'sun-ra')).toBeVisible();
  await expect(page).toHaveURL(/focus=sun-ra/);
});

test('the Russian cover names Сан Ра and opens the same card', async ({ page }) => {
  await page.goto('/#lang=ru');
  const link = page.locator('.cover p.deck:visible a[data-card="sun-ra"]');
  await expect(link).toHaveText('Сан Ра');
  await link.click();
  await expect(drawerCard(page, 'sun-ra')).toBeVisible();
});

test('the guide and the Workshop link the cards they name, never in headings or controls; the dedication is left alone', async ({ page }) => {
  await page.goto('/#view=guide');
  await expect(sheet(page).locator('.mx-prose a[data-card="equiano"]').first()).toBeVisible();
  await expect(sheet(page).locator('h2 a[data-card], h3 a[data-card]')).toHaveCount(0);
  await sheet(page).locator('.mx-prose a[data-card="equiano"]').first().click();
  await expect(drawerCard(page, 'equiano')).toBeVisible();

  await page.goto('/#view=workshop');
  const woven = sheet(page).locator('p a[data-card]');
  await expect(woven.first()).toBeVisible();
  expect(await woven.count()).toBeGreaterThan(5);
  await expect(sheet(page).locator('button a[data-card], h2 a[data-card], h3 a[data-card], [role="button"] a[data-card]')).toHaveCount(0);
  // One link per card per paragraph.
  const repeats = await sheet(page).evaluate((s) =>
    [...s.querySelectorAll('p')].filter((p) => {
      const ids = [...p.querySelectorAll<HTMLElement>(':scope > a[data-card]')].map((a) => a.dataset.card);
      return new Set(ids).size !== ids.length;
    }).length,
  );
  expect(repeats).toBe(0);

  await page.goto('/#view=dedication');
  await expect(sheet(page).locator('.mx-dedication')).toBeVisible();
  await page.waitForTimeout(300);
  await expect(sheet(page).locator('.mx-dedication a[data-card]')).toHaveCount(0);
});

test('the engine room’s terminal names cards that open', async ({ page }) => {
  await page.goto('/#view=engine');
  const id = page.locator('.engine .term pre a.term-card').first();
  await expect(id).toBeVisible();
  const card = await id.getAttribute('data-card');
  await id.click();
  await expect(drawerCard(page, card!)).toBeVisible();
});

test('the index lists every entry from A to Z, with letters, a filter and kinds', async ({ page }, info) => {
  await page.goto('/#view=index');
  const ix = sheet(page).locator('.mx-index');
  await expect(ix.locator('h2')).toHaveText('Index');
  const titles = await ix.locator('.ix-group').first().locator('.ix-title').allTextContents();
  expect(titles.length).toBeGreaterThan(3);
  // "The" does not count: the blues are filed under B.
  await expect(ix.locator('[data-letter-head="B"] + ul .ix-entry[data-card="blues"]')).toHaveCount(1);
  await expect(ix.locator('[data-letter-head="T"] + ul .ix-entry[data-card="blues"]')).toHaveCount(0);
  // Every group is in order.
  const order = await ix.evaluate((el) =>
    [...el.querySelectorAll('.ix-group')].every((g) => {
      const keys = [...g.querySelectorAll('.ix-title')].map((t) => (t.textContent ?? '').replace(/^[\s"'“«]+/, '').replace(/^the\s+/i, '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ''));
      return keys.every((k, i) => !i || keys[i - 1].localeCompare(k, 'en', { sensitivity: 'base' }) <= 0);
    }),
  );
  expect(order).toBe(true);

  // The letter bar jumps to its letter.
  await ix.locator('.ix-letter[data-letter="Z"]').click();
  await expect(ix.locator('[data-letter-head="Z"]')).toBeFocused();

  // The filter finds by name, and says how many it shows.
  await ix.locator('.ix-filter').fill('sun ra');
  await expect(ix.locator('.ix-entry')).toHaveCount(1);
  await expect(ix.locator('.ix-entry[data-card="sun-ra"]')).toBeVisible();
  await expect(ix.locator('.ix-count')).toHaveText(/^1\s+of\s+\d+$/);
  await expect(ix.locator('.ix-letter[data-letter="Z"]')).toBeDisabled();
  await ix.locator('.ix-filter').fill('');

  // A kind chip keeps only its kind.
  await ix.locator('.ix-chip[data-kind="genre"]').click();
  await expect(ix.locator('.ix-chip[data-kind="genre"]')).toHaveAttribute('aria-pressed', 'true');
  const shown = await ix.locator('.ix-entry').count();
  expect(shown).toBeGreaterThan(5);
  await expect(ix.locator('.ix-entry[data-card="jazz"]')).toHaveCount(1);
  await expect(ix.locator('.ix-entry[data-card="sun-ra"]')).toHaveCount(0);
  await ix.locator('.ix-chip[data-kind="genre"]').click();

  // Every card is listed alike, without marks for the copies: the whole
  // dictionary is in both. A card of the female half of a pair (the setup
  // pins the male copy) opens as itself and names the other telling.
  const total = await page.evaluate(async () => (await (await fetch('data/cards.json')).json()).cards.length);
  await expect(ix.locator('.ix-entry')).toHaveCount(total);
  await expect(ix.locator('.ix-other, .ix-entry.foreign')).toHaveCount(0);
  const jacobs = ix.locator('.ix-entry[data-card="jacobs-garret"]');
  await jacobs.scrollIntoViewIfNeeded();
  await jacobs.click();
  await expect(drawerCard(page, 'jacobs-garret')).toBeVisible();
  await expect(drawerCard(page, 'jacobs-garret').locator('.pair-line')).toHaveText(/^In\syour\scopy\sthis\stheme\sis\stold\sthrough\s“Frederick\sDouglass/);
  await expect(page.locator('.notice.edition')).toHaveCount(0);

  if (info.project.name === 'mobile') {
    // No sideways scrolling at phone width.
    await page.keyboard.press('Escape');
    const wide = await sheet(page).evaluate((s) => s.scrollWidth - s.clientWidth);
    expect(wide).toBeLessThanOrEqual(1);
  }
});

test('the Russian index files Russian titles in Russian order, Latin after Cyrillic', async ({ page }) => {
  await page.goto('/#view=index&lang=ru');
  const ix = sheet(page).locator('.mx-index');
  await expect(ix.locator('h2')).toHaveText('Указатель');
  const bar = await ix.locator('.ix-letter').allTextContents();
  expect(bar[0]).toBe('А');
  expect(bar).not.toContain('Ё');
  const firstLatin = bar.findIndex((l) => /[A-Z]/.test(l));
  expect(firstLatin).toBeGreaterThan(20);
  expect(bar.slice(0, firstLatin).every((l) => /\p{Script=Cyrillic}/u.test(l))).toBe(true);
  await expect(ix.locator('[data-letter-head="С"] + ul .ix-entry[data-card="sun-ra"] .ix-title')).toHaveText('Сан Ра');
  await ix.locator('.ix-filter').fill('Сан Ра');
  await expect(ix.locator('.ix-entry[data-card="sun-ra"]')).toBeVisible();
  await expect(ix.locator('.ix-count')).toHaveText(/^\d+\s+из\s+\d+$/);
});

test('the menu names the index with a line on what it is', async ({ page }, info) => {
  await page.goto('/');
  if (info.project.name === 'mobile') {
    await page.locator('.nav-menu-btn').click();
    const item = page.locator('.nav-sheet-item[data-entry="index"]');
    await expect(item).toContainText('Index');
    await expect(item).toContainText('Every name in the dictionary');
    await item.click();
  } else await page.locator('.nav-actions [data-mech="index"]').click();
  await expect(sheet(page).locator('.mx-index')).toBeVisible();
  await expect(page).toHaveURL(/view=index/);
});
