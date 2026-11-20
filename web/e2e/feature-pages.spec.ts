import { expect, test } from '@playwright/test';

for (const language of ['en', 'ru']) {
  const prefix = language === 'ru' ? '/ru' : '';
  test(`static feature links keep the page language before scripts (${language})`, async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(new URL(`${prefix}/`, test.info().project.use.baseURL).href);
    await expect(page.locator('a[data-features]')).toHaveAttribute('href', `${prefix}/features/`);
    await page.locator('a[data-features]').evaluate((a: HTMLAnchorElement) => { location.href = a.href; });
    await expect(page).toHaveURL(new RegExp(`${prefix}/features/$`));
    await page.locator(`a[href="${prefix}/features/sea-lion-girls/"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`${prefix}/features/sea-lion-girls/$`));
    await expect(page.locator('[data-prerender]')).toBeVisible();
    await context.close();
  });

  test(`feature renders art without museum data and fetches one card on demand (${language})`, async ({ page }) => {
    const requests: string[] = [];
    page.on('request', r => requests.push(new URL(r.url()).pathname));
    await page.route(/\/data\/(?:cache\/)?(?:cards\.|chapters\.|checks\.|cabinet\.|factoids\.)/, r => r.abort());
    await page.route(/youtube|ytimg|googlevideo/, r => r.abort());
    await page.goto(`${prefix}/features/sea-lion-girls/`);
    const feature = page.locator('article.ft');
    await expect(feature).toBeVisible();
    await expect.poll(() => feature.locator('img[src]').evaluateAll(imgs => imgs.some(img => (img as HTMLImageElement).naturalWidth > 0))).toBe(true);
    expect(requests.filter(url => /\/cards\//.test(url))).toEqual([]);
    expect(requests.filter(url => /\/(?:cards|chapters|checks|cabinet|factoids)\./.test(url))).toEqual([]);
    await expect(page.locator('.ft-home')).toHaveAttribute('href', `${prefix}/`);
    await expect(page.locator('.ft-back')).toHaveAttribute('href', `${prefix}/features/`);
    const link = feature.locator('a[data-card]').first();
    const id = await link.getAttribute('data-card');
    await link.click();
    await expect(page.locator(`.drawer.on [data-card-id="${id}"]`)).toBeVisible();
    expect(requests.some(url => url.includes(`/cards/${id}.${language}.`))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('.drawer.on')).toHaveCount(0);
    await expect(feature).toBeVisible();
  });
}
