// Loading, preloading and reading order: what a reader on a slow line or a
// phone sees before and while the data and the pictures arrive.
import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sankofa.edition', 'm'));
});

const sheet = (page: Page) => page.locator('.mx-sheet.open');

test('a view says it is loading, never that it is empty, while its data is on the way', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route(/\/data\/(?:cache\/)?objects(?:\.(?:en|ru)\.[a-f0-9]+)?\.json$/, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto('/#view=objects');
  await expect(sheet(page).locator('.mx-loading')).toBeVisible();
  await expect(sheet(page).locator('.mx-empty')).toHaveCount(0);
  await expect(sheet(page)).not.toContainText('Nothing here yet');
  release();
  await expect(sheet(page).locator('.mx-shelf')).toBeVisible();
  await expect(sheet(page).locator('.mx-loading')).toHaveCount(0);
});

test('a document that cannot be loaded says so and loads on "Try again"', async ({ page }) => {
  let fail = true;
  await page.route(/\/data\/(?:cache\/)?documents(?:\.(?:en|ru)\.[a-f0-9]+)?\.json$/, (route) => (fail ? route.abort('failed') : route.continue()));
  await page.goto('/#view=document');
  const err = sheet(page).locator('.mx-error');
  await expect(err).toBeVisible({ timeout: 15_000 });
  await expect(err).toContainText('could not be loaded');
  fail = false;
  await err.getByRole('button').click();
  await expect(sheet(page).locator('.mx-error')).toHaveCount(0, { timeout: 15_000 });
  await expect(sheet(page).locator('.mx-loading')).toHaveCount(0, { timeout: 15_000 });
});

test('a card tells its story first and what is contested after it, in paragraphs', async ({ page }) => {
  const data = await (await page.request.get('/data/cards.json')).json();
  const c = data.cards.find((x: { dispute?: string; body: string }) => x.dispute && /\n\s*\n/.test(x.body));
  test.skip(!c, 'no contested card with several paragraphs');
  await page.goto(`/#focus=${c.id}`);
  const card = page.locator('.drawer.on .card-body');
  await expect(card.locator('.notice.contested')).toBeVisible();
  const order = await card.evaluate((el) => {
    const text = el.querySelector('.text')!;
    const contested = el.querySelector('.notice.contested')!;
    return text.compareDocumentPosition(contested) & Node.DOCUMENT_POSITION_FOLLOWING;
  });
  expect(order).toBeTruthy();
  expect(await card.locator('.text p').count()).toBeGreaterThan(1);
  // The paragraphs breathe: a visible gap between them.
  const gap = await card.locator('.text p').first().evaluate((p) => parseFloat(getComputedStyle(p).marginBottom));
  expect(gap).toBeGreaterThan(12);
});

test('the next chapter’s hero is requested before it comes into view', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'one viewport is enough');
  const asked: string[] = [];
  page.on('request', (r) => r.resourceType() === 'image' && asked.push(r.url()));
  await page.goto('/');
  await expect(page.locator('article.chapter').first()).toBeAttached();
  const ids = await page.locator('article.chapter').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.chapter!));
  // A chapter whose successor opens on a photograph.
  let at = -1;
  let file = '';
  for (let i = 0; i < ids.length - 1; i++) {
    const f = await page.locator(`#ch-${ids[i + 1]} .hero img[data-file]`).getAttribute('data-file').catch(() => null);
    if (f) {
      at = i;
      file = f;
      break;
    }
  }
  test.skip(at < 0, 'no photographic hero after a chapter');
  await page.locator(`#ch-${ids[at]} .hero`).evaluate((e) => e.scrollIntoView({ block: 'start' }));
  const stem = file.replace(/\.(jpe?g|png|webp)$/i, '');
  // The full-width copy, not the contents' thumbnail of the same picture.
  await expect.poll(() => asked.some((u) => u.includes(stem) && !u.includes('/w480/')), { timeout: 8000 }).toBe(true);
  // ...while the reader is still a chapter away from it.
  const top = await page.locator(`#ch-${ids[at + 1]} .hero`).evaluate((e) => e.getBoundingClientRect().top);
  expect(top).toBeGreaterThan(await page.evaluate(() => innerHeight * 2));
});

test('pictures wait in their own colour, not in an empty frame', async ({ page }) => {
  const media = await (await page.request.get('/data/media.json')).json();
  test.skip(!media.colours || !Object.keys(media.colours).length, 'no colours measured');
  await page.goto('/#ch=v1');
  const img = page.locator('#ch-v1 .hero img[data-file]');
  await expect(img).toBeAttached();
  const file = await img.getAttribute('data-file');
  if (media.colours[file!]) {
    const bg = await img.evaluate((e) => (e as HTMLElement).style.backgroundColor || 'loaded');
    expect(bg).not.toBe('');
  }
});

test('on a phone a step picture always sits above its words', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'phones only');
  await page.goto('/');
  await expect(page.locator('article.chapter').first()).toBeAttached();
  const misplaced = await page.locator('.step:has(.step-fig)').evaluateAll((steps) =>
    steps
      .filter((s) => {
        const fig = s.querySelector('.step-fig')!.getBoundingClientRect();
        const p = s.querySelector('p')!.getBoundingClientRect();
        return fig.bottom > p.top + 1;
      })
      .map((s) => s.closest('article')?.getAttribute('data-chapter')),
  );
  expect(misplaced).toEqual([]);
  expect(await page.locator('.step:has(.step-fig)').count()).toBeGreaterThan(0);
});

test('the visitor kubeconfig is asked for only in the engine room', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (r) => r.url().includes('visitor.kubeconfig') && asked.push(r.method()));
  await page.goto('/');
  await expect(page.locator('article.chapter').first()).toBeAttached();
  await page.waitForTimeout(1500);
  expect(asked).toEqual([]);
  await page.goto('/#view=engine');
  await expect.poll(() => asked.length).toBe(1);
});

test('the method page reads as a centred column and says who the two agents are', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'wide screens');
  await page.goto('/#view=method');
  const art = sheet(page).locator('.mx-method');
  await expect(art).toBeVisible();
  const box = (await art.boundingBox())!;
  const vw = page.viewportSize()!.width;
  expect(box.width).toBeGreaterThan(600);
  expect(box.width).toBeLessThan(740);
  expect(Math.abs(box.x + box.width / 2 - vw / 2)).toBeLessThan(40);
  await expect(art.locator('.mx-agents')).toContainText('AI research agents');
  await page.goto('/#view=guide&lang=ru');
  await expect(sheet(page).locator('.mx-agents')).toContainText('ИИ-агента');
});

test('the listening room speaks plainly, with the technical names on demand', async ({ page }) => {
  await page.goto('/#view=listen');
  const status = page.locator('.l-status');
  await expect(status).toContainText('drums playing');
  await expect(status).not.toContainText('pods');
  await expect(page.locator('.l-node text.st').first()).not.toHaveText(/ready/);
  await page.locator('.l-tech').click();
  await expect(status).toContainText('pods');
  await expect(page.locator('.l-node text.st').first()).toHaveText(/ready/);
});

test('one document: a text taller than its panel fades and offers to read more', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'the desk is a side panel on wide screens');
  await page.goto('/#view=descent&t=1930&zoom=5');
  const scroll = page.locator('.desk-scroll');
  await expect(scroll).toBeVisible();
  await page.waitForTimeout(900);
  const over = await scroll.evaluate((e) => e.scrollHeight - e.clientHeight > 4);
  test.skip(!over, 'this document fits its panel');
  await expect(scroll).toHaveClass(/clipped/);
  await expect(page.locator('.desk-foot .btn')).toHaveText(/Read more/);
});

test('atlas timeline names are whole and apart', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'the atlas timeline is shown on wide screens');
  await page.goto('/#zoom=1');
  const names = page.locator('.atlas .tl .life text');
  await expect(names.first()).toBeAttached();
  const boxes = await names.evaluateAll((els) => els.map((e) => ({ t: e.textContent ?? '', r: (e as SVGGraphicsElement).getBoundingClientRect().toJSON() as DOMRect })));
  expect(boxes.some((b) => b.t.endsWith('…'))).toBe(false);
  const hits: string[] = [];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].r;
      const b = boxes[j].r;
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 2 && b.top < a.bottom - 2) hits.push(`${boxes[i].t} / ${boxes[j].t}`);
    }
  expect(hits).toEqual([]);
});
