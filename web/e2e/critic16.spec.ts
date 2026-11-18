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

test('the top bar never runs off a laptop screen: it draws closer, then folds into the Menu', async ({ page, isMobile }) => {
  test.skip(isMobile, 'a phone always has the Menu');
  const lastRight = () => page.evaluate(() => {
    const vis = [...document.querySelectorAll<HTMLElement>('.nav-actions > *')].filter((e) => e.offsetWidth > 0);
    return vis[vis.length - 1].getBoundingClientRect().right;
  });
  // Russian labels are the longest: at 1440 the whole bar is there, theme switch included.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#ch=v5&lang=ru');
  await expect(page.locator('.nav [data-theme-toggle]')).toBeVisible();
  expect(await lastRight()).toBeLessThanOrEqual(1440);
  // A narrower window folds the bar into the Menu, which names every way in.
  await page.setViewportSize({ width: 1024, height: 768 });
  const menu = page.locator('.nav-menu-btn');
  await expect(menu).toBeVisible();
  expect(await lastRight()).toBeLessThanOrEqual(1024);
  await menu.click();
  await expect(page.locator('#nav-sheet [data-entry="dedication"]')).toBeVisible();
  // Wide again: the bar comes back and the sheet closes.
  await page.setViewportSize({ width: 1600, height: 900 });
  await expect(menu).toBeHidden();
  await expect(page.locator('#nav-sheet')).toBeHidden();
});

test('on a phone the atlas list keeps long BCE dates inside their column', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'the list is the phone’s atlas');
  await page.goto('/#view=atlas');
  const y = page.locator('.atlas-item .y').first();
  await expect(y).toBeVisible({ timeout: 15_000 });
  const over = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.atlas-item .y')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
  expect(over).toEqual([]);
});
