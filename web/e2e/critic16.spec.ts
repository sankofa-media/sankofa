// Round 16 of the visitors' critique: what a reader on a phone and on a
// laptop, in both languages, found broken, and keeps from coming back.
import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sankofa.navlegend', '1'));
  await page.route(/youtube|ytimg|googlevideo/, (r) => r.abort());
});

const sheet = (page: Page) => page.locator('.mx-sheet.open');

test('the Cabinet’s “how to look” is a paragraph of its own', async ({ page }) => {
  await page.goto('/#view=cabinet&lang=ru');
  const ledes = sheet(page).locator('.cb-head .mx-lede');
  await expect(ledes).toHaveCount(2);
  await expect(ledes.nth(1)).toHaveText(/^Как\P{L}*искать/u);
  await page.goto('about:blank');
  await page.goto('/#view=cabinet&lang=en');
  await expect(sheet(page).locator('.cb-head .mx-lede').nth(1)).toHaveText(/^How\P{L}*to\P{L}*look/u);
});

test('a glint on the atlas map is faintly visible on a touch screen, as the Cabinet promises', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'only a touch screen has no hover');
  await page.goto('/#view=atlas');
  const glint = page.locator('.atlas.open g.cb-aglint').first();
  await expect(glint).toBeAttached({ timeout: 15_000 });
  await expect(glint).toHaveCSS('opacity', '0.35');
});
