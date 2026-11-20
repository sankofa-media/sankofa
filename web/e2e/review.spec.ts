import { expect, test, type Page } from '@playwright/test';

const TOKEN = 'test-review-token';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sankofa.edition', 'm');
    localStorage.setItem('sankofa.navlegend', '1');
  });
  await page.route(/youtube|ytimg|googlevideo|tile\.loc\.gov/, (r) => r.abort());
});

const feature = (page: Page) => page.locator('.ft-sheet:not([hidden]) article.ft[data-feature-id="sea-lion-girls"]');

/** The angel's review endpoints, kept in memory; every call must carry the token. */
async function mockReview(page: Page) {
  const notes: Record<string, unknown>[] = [];
  const auth: (string | null)[] = [];
  await page.route('**/api/angel/review**', async (route) => {
    const req = route.request();
    auth.push(req.headers()['authorization'] ?? null);
    if (req.headers()['authorization'] !== `Bearer ${TOKEN}`) return route.fulfill({ status: 401, json: { error: 'unauthorized' } });
    if (req.method() === 'GET') return route.fulfill({ json: { reviews: notes } });
    if (req.method() === 'POST') {
      const body = req.postDataJSON();
      const note = { ...body, id: notes.length + 1, status: 'open', created: '2026-11-20T10:00:00Z', updated: '2026-11-20T10:00:00Z' };
      notes.push(note);
      return route.fulfill({ status: 201, json: note });
    }
    return route.fulfill({ status: 405, json: { error: 'unexpected' } });
  });
  return { notes, auth };
}

test('the owner turns review on with the token, notes a paragraph of a feature and sees its marker', async ({ page, isMobile }) => {
  const api = await mockReview(page);
  await page.goto(`/#review=${TOKEN}&view=feature&item=sea-lion-girls`);
  await expect(feature(page)).toBeVisible();
  // The token leaves the link at once and stays on the device.
  expect(page.url()).not.toContain('review');
  expect(page.url()).toContain('view=feature&item=sea-lion-girls');
  expect(await page.evaluate(() => localStorage.getItem('sankofa.review'))).toBe(TOKEN);

  const bar = page.locator('.rv-bar');
  await expect(bar.locator('.rv-list')).toHaveText(/Notes 0/);
  await bar.locator('.rv-comment').click();
  await expect(bar.locator('.rv-hint')).toBeVisible();

  const para = feature(page).locator('.ft-block[data-block] p').filter({ visible: true }).first();
  await para.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const before = page.url();
  if (isMobile) await para.tap();
  else await para.click();
  // A tap picks; it does not act on the page.
  expect(page.url()).toBe(before);

  const panel = page.locator('.rv-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.rv-tag')).toContainText('<p>');
  await expect(panel.locator('.rv-tag')).toContainText('block=');
  await panel.locator('textarea').fill('Shorten this paragraph');
  await panel.locator('.rv-save').click();
  await expect(panel).toBeHidden();

  expect(api.notes).toHaveLength(1);
  const note = api.notes[0] as {
    comment: string;
    page: { key: string; view: string; item: string; device: string; width: number; lang: string };
    target: { css: string; tag: string; data: Record<string, string>; text: string };
  };
  expect(note.comment).toBe('Shorten this paragraph');
  expect(note.page).toMatchObject({ key: 'feature:sea-lion-girls', view: 'feature', item: 'sea-lion-girls', lang: 'en' });
  expect(note.page.device).toBe(isMobile ? 'phone' : 'desktop');
  expect(note.target.tag).toBe('p');
  expect(note.target.data['feature-id']).toBe('sea-lion-girls');
  expect(note.target.data.block).toBeTruthy();
  expect(note.target.text.length).toBeGreaterThan(10);
  // The path finds the very paragraph that was noted.
  expect(await page.evaluate((css) => document.querySelector(css)?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 40), note.target.css)).toBe(note.target.text.slice(0, 40));
  expect(api.auth.every((a) => a === `Bearer ${TOKEN}`)).toBe(true);

  const mark = page.locator('.rv-mark');
  await expect(mark).toHaveCount(1);
  await expect(mark).toBeVisible();
  await expect(bar.locator('.rv-list')).toHaveText(/Notes 1/);
  // The marker opens the note again.
  await mark.click();
  await expect(panel.locator('textarea')).toHaveValue('Shorten this paragraph');
});

test('readers get nothing of the review mode', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (/review|api\/angel\/review/.test(r.url())) asked.push(r.url());
  });
  await page.goto('/#view=feature&item=sea-lion-girls');
  await expect(feature(page)).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator('.rv-root')).toHaveCount(0);
  expect(asked).toEqual([]);
});

test('a token the server refuses is forgotten', async ({ page }) => {
  await mockReview(page);
  await page.goto('/#review=wrong-token');
  await expect(page.locator('.rv-toast')).toHaveText('The review token was not accepted');
  await expect(page.locator('.rv-root')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('sankofa.review'))).toBeNull();
});
