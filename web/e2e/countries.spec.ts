// The atlas's Countries mode: switching, choosing a country, the link, the
// back button, Russian, phones and the keyboard.
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sankofa.edition', 'm'));
});

const panel = (page: import('@playwright/test').Page) => page.locator('.atlas-countries');

test('the switch opens Countries, a country lists its cards in time order, and the link follows', async ({ page }) => {
  await page.goto('/#view=atlas');
  await expect(page.locator('.atlas.open')).toBeVisible();
  const mode = page.locator('.atlas-mode');
  await expect(mode.getByRole('button', { name: 'Time' })).toHaveAttribute('aria-pressed', 'true');
  await mode.getByRole('button', { name: 'Countries' }).click();
  await expect(mode.getByRole('button', { name: 'Countries' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/atlas=countries/);
  await expect(page.locator('.atlas .levels')).toBeHidden();

  await panel(page).getByRole('button', { name: /^Brazil, \d+ cards$/ }).click();
  await expect(page).toHaveURL(/atlas=countries&country=brazil/);
  await expect(panel(page).getByRole('heading', { name: 'Brazil' })).toBeFocused();
  const years = await panel(page).locator('.cn-card .y').allTextContents();
  expect(years.length).toBeGreaterThan(5);
  const starts = years.map((y) => parseInt(y, 10));
  expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  await expect(panel(page)).toContainText('Candomblé');
  await expect(panel(page).locator('.cn-about')).toContainText('Palmares');
  await expect(page.locator('.geo .country.on')).toHaveCount(1);

  // A card opens beside the list and keeps the country in the link.
  await panel(page).locator('.cn-card', { hasText: 'Capoeira' }).click();
  await expect(page.locator('.drawer.on')).toContainText('Capoeira');
  await expect(page).toHaveURL(/focus=capoeira.*atlas=countries&country=brazil/);

  // Back goes to the country list, then to the Time view.
  await page.goBack();
  await expect(panel(page).getByRole('heading', { name: 'Countries' })).toBeVisible();
  await page.goBack();
  await expect(page.locator('.atlas-mode').getByRole('button', { name: 'Time' })).toHaveAttribute('aria-pressed', 'true');
  await page.goForward();
  await page.goForward();
  await expect(panel(page).getByRole('heading', { name: 'Brazil' })).toBeVisible();
});

test('a shared link opens the country, and the keyboard can choose another', async ({ page }) => {
  await page.goto('/#atlas=countries&country=mali');
  await expect(panel(page).getByRole('heading', { name: 'Mali' })).toBeVisible();
  await expect(panel(page)).toContainText('Mansa Musa');
  await panel(page).getByRole('button', { name: 'All countries' }).press('Enter');
  await expect(panel(page).getByRole('button', { name: /^Mali, / })).toBeFocused();
  const find = panel(page).getByRole('searchbox', { name: 'Find a country' });
  await find.fill('jama');
  await expect(panel(page).locator('.cn-list li:not([hidden])')).toHaveCount(1);
  await find.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/country=jamaica/);
  await expect(panel(page).getByRole('heading', { name: 'Jamaica' })).toBeFocused();
});

test('Russian: the switch, the list and the country speak Russian', async ({ page }) => {
  await page.goto('/#lang=ru&atlas=countries&country=united-kingdom');
  await expect(page.locator('.atlas-mode').getByRole('button', { name: 'Страны' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.atlas-mode').getByRole('button', { name: 'Время' })).toBeVisible();
  await expect(panel(page).getByRole('heading', { name: 'Великобритания' })).toBeVisible();
  await expect(panel(page).locator('.cn-count')).toContainText(/карточ/);
  await expect(panel(page).locator('.cn-about')).toContainText('«Уиндраша»');
  await panel(page).getByRole('button', { name: 'Все страны' }).click();
  await expect(panel(page).getByRole('button', { name: /^Бразилия, \d+ карточ/ })).toBeVisible();
  await expect(page).toHaveURL(/lang=ru.*atlas=countries/);
});

test('on a phone the country reads under the map, within the screen', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'phone layout');
  await page.goto('/#atlas=countries&country=nigeria');
  const p = panel(page);
  await expect(p.getByRole('heading', { name: 'Nigeria' })).toBeVisible();
  const map = await page.locator('.atlas-stage').boundingBox();
  const box = await p.boundingBox();
  const vw = page.viewportSize()!.width;
  expect(box!.y).toBeGreaterThanOrEqual(map!.y + map!.height - 2);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vw + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await p.locator('.cn-card').first().click();
  await expect(page.locator('.drawer.on')).toBeVisible();
});

test('a country without a sourced header shows only its name and count', async ({ page }) => {
  await page.goto('/#atlas=countries&country=austria');
  await expect(panel(page).getByRole('heading', { name: 'Austria' })).toBeVisible();
  await expect(panel(page).locator('.cn-count')).toContainText('1 card');
  await expect(panel(page).locator('.cn-about')).toHaveCount(0);
});
