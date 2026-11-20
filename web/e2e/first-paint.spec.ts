import { expect, test } from '@playwright/test';

for (const language of ['en', 'ru']) {
  test(`${language}: opens from the index, fetches full prose once and keeps it`, async ({ page }) => {
    const requests: string[] = [];
    page.on('request', request => requests.push(request.url()));
    await page.goto(language === 'en' ? '/' : '/ru/');
    await expect(page.locator('article.chapter').first()).toBeAttached();
    await expect(page.locator('.loading')).toHaveCount(0);
    expect(requests.some(url => /\/card-index\./.test(url))).toBe(true);
    expect(requests.some(url => /\/(?:cards|roots)\.(?:en|ru)\./.test(url))).toBe(false);
    expect(requests.some(url => /\/cards\/sun-ra\./.test(url))).toBe(false);
    const link = page.locator('.cover .deck:visible [data-card="sun-ra"]');
    await link.click();
    const card = page.locator('.drawer.on article.card[data-card-id="sun-ra"]');
    await expect(card.locator('.text p').first()).not.toBeEmpty();
    await page.locator('.drawer.on .close').click();
    await link.click();
    await expect(card.locator('.text p').first()).not.toBeEmpty();
    expect(requests.filter(url => /\/cards\/sun-ra\./.test(url))).toHaveLength(1);
  });
}

test('closing a pending card cannot reopen it', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\/cards\/sun-ra\./, async route => { await gate; await route.continue(); });
  await page.goto('/');
  await expect(page.locator('article.chapter').first()).toBeAttached();
  await expect(page.locator('.loading')).toHaveCount(0);
  await page.locator('.cover .deck:visible [data-card="sun-ra"]').click();
  await expect(page.locator('.drawer.on [role="status"]')).toBeVisible();
  await page.locator('.drawer.on .close').click();
  const response = page.waitForResponse(/\/cards\/sun-ra\./);
  release();
  await response;
  await expect(page.locator('.drawer.on')).toHaveCount(0);
});

test('a phone receives a smaller cover even at high pixel density', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Phone source selection');
  await page.goto('/');
  const image = page.locator('.cover-art img');
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.currentSrc)).toMatch(/cover-(480|960)\.webp$/);
});
