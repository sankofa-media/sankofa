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
  await expect(ledes.nth(1)).toHaveText(/^Как искать\./);
  await page.goto('/#view=cabinet');
  await page.reload();
  await expect(sheet(page).locator('.cb-head .mx-lede').nth(1)).toHaveText(/^How to look\./);
});
