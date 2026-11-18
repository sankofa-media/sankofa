// The museum's checked factoids, everywhere they appear: a card's footer,
// the random-fact panel, the atlas at cities and people, the descent's quiet
// stretches. Each shows its year and, on demand, its two sources.
import { expect, test, type Page } from '@playwright/test';

interface Fact {
  id: string;
  en: string;
  ru: string;
  year: number;
  place?: { lat: number; lon: number };
  cards: string[];
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sankofa.edition', 'm'));
});

/** The page sets its own typography (quotes, dashes, non-breaking spaces): compare the words. */
const norm = (s: string | null) => (s ?? '').replace(/[\u00a0\u202f\u00ad]/g, (c) => (c === '\u00ad' ? '' : ' ')).replace(/["“”«»„]/g, '"').replace(/['‘’]/g, "'").replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();

async function facts(page: Page): Promise<Fact[]> {
  return (await (await page.request.get('/data/factoids.json')).json()).factoids;
}

/** Sources stay folded until asked for, then show two links. */
async function sourcesOpen(fx: ReturnType<Page['locator']>) {
  const btn = fx.locator('.fx-src-btn');
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await expect(fx.locator('.fx-sources')).toBeHidden();
  await btn.click();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  expect(await fx.locator('.fx-sources a').count()).toBeGreaterThanOrEqual(2);
  await expect(fx.locator('.fx-sources a').first()).toHaveAttribute('href', /^https?:\/\//);
}

test('a card ends with up to three of its factoids, each with its year and sources', async ({ page }) => {
  const list = await facts(page);
  const count = new Map<string, number>();
  for (const f of list) for (const c of f.cards) count.set(c, (count.get(c) ?? 0) + 1);
  const cards = (await (await page.request.get('/data/cards.json')).json()).cards as { id: string; edition?: string }[];
  // A card of both copies with more factoids than the footer holds.
  const id = [...count.entries()].filter(([c]) => cards.find((x) => x.id === c && (!x.edition || x.edition === 'both'))).sort((a, b) => b[1] - a[1])[0]?.[0];
  test.skip(!id, 'no card has factoids');
  await page.goto(`/#focus=${id}`);
  const foot = page.locator('.drawer.on .fx-footer');
  await expect(foot).toBeVisible();
  await expect(foot.locator('h3')).toHaveText('Did you know');
  const n = await foot.locator('.fx').count();
  expect(n).toBeGreaterThan(0);
  expect(n).toBeLessThanOrEqual(3);
  for (const fid of await foot.locator('.fx').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.fact!))) {
    expect(list.find((f) => f.id === fid)!.cards).toContain(id);
  }
  const first = foot.locator('.fx').first();
  await expect(first.locator('.fx-year')).toHaveText(/^\d+( BCE)?$/);
  // The card being read is not linked to itself from its own footer.
  await expect(first.locator(`.fx-cards [data-card="${id}"]`)).toHaveCount(0);
  await sourcesOpen(first);

  await page.goto(`/#focus=${id}&lang=ru`);
  const ru = page.locator('.drawer.on .fx-footer');
  await expect(ru.locator('h3')).toHaveText('Знаете ли вы');
  await expect(ru.locator('.fx-src-btn').first()).toHaveText(/Источники/);
  const fid = await ru.locator('.fx').first().getAttribute('data-fact');
  expect(norm(await ru.locator('.fx-text').first().textContent())).toBe(norm(list.find((f) => f.id === fid)!.ru));
});

test('a card without factoids has no empty footer', async ({ page }) => {
  const list = await facts(page);
  const cards = (await (await page.request.get('/data/cards.json')).json()).cards as { id: string; edition?: string }[];
  const bare = cards.find((c) => (!c.edition || c.edition === 'both') && !list.some((f) => f.cards.includes(c.id)));
  test.skip(!bare, 'every card has factoids');
  await page.goto(`/#focus=${bare!.id}`);
  await expect(page.locator('.drawer.on .card-body h2')).toBeVisible();
  await expect(page.locator('.drawer.on .fx-footer')).toBeHidden();
});

async function openFactPanel(page: Page, mobile: boolean) {
  if (mobile) {
    await page.locator('.nav-menu-btn').click();
    const item = page.locator('.nav-sheet-item[data-entry="fact"]');
    await expect(item.locator('small')).not.toBeEmpty();
    await item.click();
  } else {
    await page.locator('.nav [data-open-fact]').click();
  }
  const panel = page.locator('.fx-panel');
  await expect(panel).toBeVisible();
  return panel;
}

for (const lang of ['en', 'ru'] as const) {
  test(`the random-fact button shows one fact at a time, another on request (${lang})`, async ({ page }, info) => {
    const list = await facts(page);
    await page.goto(lang === 'ru' ? '/#lang=ru' : '/');
    await expect(page.locator('.loading')).toHaveCount(0);
    const panel = await openFactPanel(page, info.project.name === 'mobile');
    await expect(panel.locator('.fx-panel-kicker')).toHaveText(lang === 'ru' ? 'Знаете ли вы' : 'Did you know');
    const fx = panel.locator('.fx');
    await expect(fx).toHaveCount(1);
    const a = (await fx.getAttribute('data-fact'))!;
    const f = list.find((x) => x.id === a)!;
    expect(norm(await fx.locator('.fx-text').textContent())).toBe(norm(f[lang]));
    await expect(fx.locator('.fx-year')).toHaveText(f.year < 0 ? new RegExp(`^${-f.year}\\s`) : String(f.year));
    await sourcesOpen(fx);
    await panel.locator('[data-fact-next]').click();
    await expect(panel.locator('[data-fact-next]')).toHaveText(lang === 'ru' ? 'Ещё один' : 'Another one');
    const b = await panel.locator('.fx').getAttribute('data-fact');
    expect(b).not.toBe(a);
    // Shown facts are remembered in this browser, so a new visit starts elsewhere.
    const seen = await page.evaluate(() => localStorage.getItem('sankofa.facts'));
    expect(seen?.split(',')).toEqual([a, b]);
    // On a phone the panel keeps the 16px gutter and never scrolls the page sideways.
    const box = (await panel.boundingBox())!;
    const vw = page.viewportSize()!.width;
    expect(box.x).toBeGreaterThanOrEqual(15);
    expect(box.x + box.width).toBeLessThanOrEqual(vw - 15);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  });
}

test('the random fact prefers the card read last', async ({ page }, info) => {
  const list = await facts(page);
  const withCard = list.find((f) => f.cards.length === 1);
  test.skip(!withCard, 'no factoid with a card');
  const id = withCard!.cards[0];
  const mine = list.filter((f) => f.cards.includes(id)).map((f) => f.id);
  await page.addInitScript((p) => localStorage.setItem('sankofa.path', p), id);
  await page.goto('/');
  await expect(page.locator('.loading')).toHaveCount(0);
  const panel = await openFactPanel(page, info.project.name === 'mobile');
  expect(mine).toContain(await panel.locator('.fx').getAttribute('data-fact'));
});

test('the atlas shows placed factoids as small light dots at cities and people, within its time', async ({ page }, info) => {
  const placed = (await facts(page)).filter((f) => f.place);
  test.skip(!placed.length, 'no factoid has a place');
  await page.goto('/#zoom=1');
  await expect(page.locator('.atlas.open')).toBeVisible();
  await expect(page.locator('.geo g.fact')).toHaveCount(0);
  // A fresh load each time: a hash hop during the opening flight is rewritten by it.
  await page.goto('about:blank');
  await page.goto('/#zoom=3');
  await expect(page.locator('.geo g.fact')).toHaveCount(placed.length);
  // Lighter and smaller than a card's marker.
  const dot = await page.locator('.geo g.fact .fdot').first().evaluate((c) => ({ r: Number(c.getAttribute('r')), o: Number(getComputedStyle(c).fillOpacity) }));
  const card = await page.locator('.geo g.pt:not(.out):not(.minor) circle.dot').first().evaluate((c) => Number(c.getAttribute('r')));
  expect(dot.r).toBeLessThan(card);
  expect(dot.o).toBeLessThan(0.6);
  // The time filter holds for facts as for cards.
  const inTime = placed.filter((f) => f.year >= 1900 && f.year <= 1950).length;
  // A fresh load each time: a hash hop during the opening flight is rewritten by it.
  await page.goto('about:blank');
  await page.goto('/#t=1900-1950&zoom=4');
  await expect(page.locator('.geo g.fact')).toHaveCount(inTime);
  // A dot opens its fact (keyboard works as well as the mouse).
  const g = page.locator('.geo g.fact').first();
  const fid = await g.getAttribute('data-fact');
  if (info.project.name === 'mobile') {
    await g.focus();
    await page.keyboard.press('Enter');
  } else await g.dispatchEvent('click');
  const box = page.locator('.atlas-fact');
  await expect(box).toBeVisible();
  await expect(box.locator('.fx')).toHaveAttribute('data-fact', fid!);
  await expect(box.locator('.fx-year')).toHaveText(/^\d{4}$/);
  await expect(page.locator(`.geo g.fact.on[data-fact="${fid}"]`)).toHaveCount(1);
  const f = placed.find((x) => x.id === fid)!;
  if (f.cards.length) {
    await box.locator('.fx-cards [data-card]').first().click();
    await expect(page.locator('.drawer.on .card-body h2')).toBeVisible();
  } else {
    await page.keyboard.press('Escape');
    await expect(box).toBeHidden();
  }
});

test('a quiet stretch of the descent is voiced by a fact dated inside it', async ({ page }) => {
  await page.goto('/#view=descent');
  const quiet = page.locator('.d-quiet');
  await expect(quiet.first()).toBeAttached();
  const voiced = page.locator('.d-quiet:has(.fx)');
  await expect(voiced.first()).toBeAttached();
  for (const q of await voiced.all()) {
    const [from, to] = ((await q.locator('.d-quiet-years').textContent()) ?? '').split('—').map((s) => Number(s.trim()));
    const year = Number(await q.locator('.fx-year').textContent());
    expect(year).toBeGreaterThan(from);
    expect(year).toBeLessThan(to);
  }
  await expect(voiced.first().locator('.d-quiet-line')).toBeAttached();
  await page.goto('/#view=descent&lang=ru');
  await expect(page.locator('.d-quiet:has(.fx) .fx-src-btn').first()).toHaveText(/Источники/);
});
