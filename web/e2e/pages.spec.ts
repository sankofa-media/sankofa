// The museum's real paths: special projects as pages of their own, the
// pre-rendered pages for search engines, and the files beside them.
import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sankofa.edition', 'm');
    localStorage.setItem('sankofa.navlegend', '1');
  });
  await page.route(/youtube|ytimg|googlevideo|tile\.loc\.gov/, (r) => r.abort());
  // Angel's ending asks the museum's service; nothing here needs it.
  await page.route(/\/api\//, (r) => r.fulfill({ status: 503, body: '' }));
});

const sheet = (page: Page) => page.locator('.ft-sheet:not([hidden])');
const feature = (page: Page, id: string) => sheet(page).locator(`article.ft[data-feature-id="${id}"]`);

test('a special project’s own path opens it as the page, with nothing of the museum behind it', async ({ page }) => {
  await page.goto('/features/angel/');
  await expect(feature(page, 'angel')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/features/angel/');
  await expect(page.locator('[data-prerender]')).toHaveCount(0);
  await expect(page.locator('#story')).toBeHidden();
  await expect(page.locator('body > .nav')).toBeHidden();
  // The story behind it is not even built.
  await expect(page.locator('#story article.chapter')).toHaveCount(0);
  await expect(page).toHaveTitle(/^Angel · Sankofa$/);
  // The way back is a link into the museum, by name.
  const home = sheet(page).locator('.ft-home');
  await expect(home).toHaveText('Sankofa');
  await expect(home).toHaveAttribute('href', '/');
  await expect(sheet(page).locator('.ft-close')).toHaveCount(0);
  await home.click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.locator('#story article.chapter').first()).toBeAttached();
  expect(new URL(page.url()).pathname).toBe('/');
  // Back returns to the project.
  await page.goBack();
  await expect(feature(page, 'angel')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/features/angel/');
});

test('an old hash link to a feature moves to its path and keeps its scene', async ({ page }) => {
  await page.goto('/#view=feature&item=angel&scene=bristol');
  await expect(feature(page, 'angel')).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/features/angel/');
  expect(new URL(page.url()).hash).toContain('scene=bristol');
  await page.goto('/#view=features&lang=ru');
  await expect(sheet(page).locator('.ft-list')).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/ru/features/');
  await expect(sheet(page).locator('.ft-home')).toHaveText('В музей');
});

test('from the museum, a project opens on its path, and Back returns to the same place in the museum', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the top bar entry is in the menu on a phone');
  await page.goto('/#ch=v2');
  await expect(page.locator('#ch-v2')).toBeAttached();
  await page.waitForTimeout(800);
  const y = await page.evaluate(() => window.scrollY);
  expect(y).toBeGreaterThan(200);
  await page.locator('.nav-actions [data-features]').click();
  await expect(sheet(page).locator('.ft-list')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/features/');
  await sheet(page).locator('[data-feature="forever-changes"]').click();
  await expect(feature(page, 'forever-changes')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/features/forever-changes/');
  await page.goBack();
  await page.goBack();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.locator('#story')).toBeVisible();
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - y)).toBeLessThan(80);
});

test('a pre-rendered page carries its text and metadata, and opens the museum at it', async ({ page, request }) => {
  const raw = await (await request.get('/ru/features/sea-lion-girls/')).text();
  expect(raw).toContain('<html lang="ru"');
  expect(raw).toContain('<link rel="canonical" href="https://sankofa.black/ru/features/sea-lion-girls/" />');
  expect(raw).toContain('hreflang="en" href="https://sankofa.black/features/sea-lion-girls/"');
  expect(raw).toContain('<meta property="og:image" content="https://sankofa.black/social/features/sea-lion-girls.jpg" />');
  expect(raw).toMatch(/<div class="prerender" data-prerender lang="ru">[\s\S]*<h1>Sea Lion Girls: как две девушки из Миссисипи/);
  const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(raw)![1]);
  expect(ld['@graph'].map((n: { '@type': unknown }) => n['@type'])).toEqual([['Organization', 'Museum'], 'WebSite', 'Article', 'BreadcrumbList']);
  expect((await request.get('/social/features/sea-lion-girls.jpg')).headers()['content-type']).toBe('image/jpeg');

  // A card's page opens the museum with that card.
  await page.goto('/cards/sun-ra/');
  await expect(page.locator('.drawer.on article.card[data-card-id="sun-ra"]')).toBeVisible();
  await expect(page.locator('[data-prerender]')).toHaveCount(0);
  await expect(page).toHaveTitle(/Sun Ra/);
});

test('robots.txt, the sitemap, llms.txt and the feed are published', async ({ request }) => {
  const robots = await (await request.get('/robots.txt')).text();
  expect(robots).toContain('Sitemap: https://sankofa.black/sitemap.xml');
  const sitemap = await (await request.get('/sitemap.xml')).text();
  expect(sitemap).toContain('<loc>https://sankofa.black/features/angel/</loc>');
  expect(sitemap).toContain('<loc>https://sankofa.black/ru/cards/sun-ra/</loc>');
  const llms = await (await request.get('/llms.txt')).text();
  expect(llms.startsWith('# Sankofa\n')).toBe(true);
  expect(llms).toContain('(https://sankofa.black/features/angel/)');
  const full = await (await request.get('/llms-full.txt')).text();
  expect(full).toContain('## Angel: the song that was never meant to be');
  const atom = await (await request.get('/features.atom')).text();
  expect(atom.match(/<entry>/g)?.length).toBeGreaterThanOrEqual(3);
});
