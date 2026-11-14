// Roots read as routes: the overview, forks, the link before each station,
// elements of music (placeholder layer), and the music map's path panel.
import { expect, test, type Page } from '@playwright/test';
import { serveFixtureElements } from './support/roots';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sankofa.edition', 'm');
    localStorage.setItem('sankofa.navlegend', '1');
  });
});

const routeText = (page: Page) => page.locator('.rt-which span').textContent();

test('the overview draws every documented chain once, with its forks', async ({ page }) => {
  await page.goto('/#view=roots&artist=ed-sheeran');
  const metro = page.locator('.rt-metro');
  await expect(metro).toBeVisible();
  // Each station once, however many routes pass through it.
  const refs = await metro.locator('.rt-mstop').evaluateAll((bs) => bs.map((b) => b.getAttribute('data-ref')));
  expect(new Set(refs).size).toBe(refs.length);
  expect(refs).toContain('labi-siffre');
  expect(refs).toContain('card:hip-hop');
  // Stations off the current route are drawn too: the splits are visible.
  expect(await metro.locator('.rt-mstop.on').count()).toBeGreaterThan(1);
  expect(await metro.locator('.rt-mstop:not(.on)').count()).toBeGreaterThan(0);
  // In the reading, a fork names its ways; nothing is "as above".
  await expect(page.locator('.rt-fork p').first()).toHaveText(/^Here\sthe\sline\ssplits\s—\svia\s.+\sor\s.+\.$/);
  await expect(page.locator('.roots')).not.toContainText('as above');
});

test('switching at a fork reads the other way, and so does picking a station on the overview', async ({ page }) => {
  await page.goto('/#view=roots&artist=ed-sheeran');
  const before = await routeText(page);
  const fork = page.locator('.rt-fork').first();
  const way = fork.locator('.rt-way:not(.on)').first();
  const next = await way.getAttribute('data-next');
  await way.click();
  await expect.poll(() => routeText(page)).not.toBe(before);
  await expect(page.locator(`.rt-mstop.on[data-ref="${next}"]`)).toHaveCount(1);
  await expect(page.locator(`.rt-route .rt-station[data-ref="${next}"]`)).toHaveCount(1);
  await expect(page.locator('.rt-fork .rt-way.on').first()).toHaveAttribute('data-next', next!);
  // A terminal station on the overview selects the route that ends there.
  await page.locator('.rt-mstop[data-ref="card:hip-hop"]').click();
  await expect(page.locator('.rt-mstop.on[data-ref="card:hip-hop"]')).toHaveCount(1);
  await expect(page.locator('.rt-route .rt-station[data-ref="card:hip-hop"]')).toHaveCount(1);
  // Keyboard: a station button is reachable and named.
  const stop = page.locator('.rt-mstop[data-ref="labi-siffre"]');
  await stop.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.rt-route .rt-station[data-ref="labi-siffre"]')).toHaveCount(1);
  await expect(stop).toHaveAttribute('aria-label', /Labi Siffre/);
});

test('each link says why before the next station, in readable type', async ({ page }) => {
  await page.goto('/#view=roots&artist=led-zeppelin');
  const order = await page.locator('.rt-route').evaluate((ol) => {
    const items = [...ol.querySelectorAll('.rt-station, .rt-link')];
    return items.map((x) => (x.classList.contains('rt-link') ? 'link' : 'station'));
  });
  // station, link, station, link, …, station (forks aside)
  expect(order[0]).toBe('station');
  expect(order[order.length - 1]).toBe('station');
  for (let i = 1; i < order.length; i++) expect(order[i]).not.toBe(order[i - 1]);
  const claim = page.locator('.rt-link .rt-claim').first();
  await expect(claim).toBeVisible();
  expect(parseFloat(await claim.evaluate((e) => getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
  // Genre-to-genre steps carry a sentence from the cards.
  await page.goto('about:blank');
  await page.goto('/#view=roots&artist=aquarium');
  await page.locator('.rt-mstop[data-ref="card:rhythm-and-blues"]').click();
  const lineage = page.locator('.rt-link.k-lineage').first();
  await expect(lineage.locator('.rt-verb')).toContainText('grew out of');
  await expect(lineage.locator('.rt-claim')).not.toBeEmpty();
  await expect(lineage.locator('.rt-rests a')).toBeAttached();
});

test('Russian reads the routes in Russian', async ({ page }) => {
  await page.goto('/#view=roots&artist=ed-sheeran&lang=ru');
  await expect(page.locator('.rt-overview h3')).toHaveText('Все маршруты к музею');
  await expect(page.locator('.rt-fork p').first()).toHaveText(/^Здесь\sлиния\sрасходится\.\sДальше\s—\s.+\sили\s.+\.$/);
  await expect(page.locator('.rt-verb').first()).toHaveText(/^Эд\sШиран\s→\sЭминем\s—\sвлияние$/);
  await expect(page.locator('.rt-playroute')).toHaveText(/Слушать маршрут/);
});

test('elements of music run along the route and explain themselves', async ({ page }) => {
  await serveFixtureElements(page);
  await page.goto('/#view=roots&artist=led-zeppelin');
  const threads = page.locator('.rt-threads');
  await expect(threads).toContainText('Along this line travelled');
  await expect(threads.locator('.rt-el')).toContainText(['Blue notes']);
  // The thread runs on the overview beside the lit line, and by the reading.
  expect(await page.locator('.rt-mthread').count()).toBeGreaterThan(0);
  expect(await page.locator('.rt-rail').count()).toBeGreaterThan(0);
  // A link leads with what was passed on; the song or fact is the evidence beneath.
  const link = page.locator('.rt-link').first();
  await expect(link.locator('.rt-how')).toContainText('Blue notes');
  await expect(link.locator('.rt-claim.evidence small')).toHaveText('The evidence');
  // The origin card says where the element comes from.
  await expect(page.locator('.rt-cardst[data-ref="card:blues"] .rt-origin').first()).toContainText('Blue notes');
  // An element opens its explainer: what, where from, who carries it.
  await threads.locator('.rt-el').first().click();
  const panel = page.locator('.roots .ep');
  await expect(panel).toBeVisible();
  await expect(panel.locator('h3')).toHaveText('Blue notes');
  await expect(panel.locator('.ep-origin a')).toHaveText('The blues');
  await expect(panel.locator('.ep-artists')).toContainText('Led Zeppelin');
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  // The index lists every element with the number of routes that carry it.
  await expect(page.locator('.rt-elindex .rt-el')).toHaveCount(6);
});

test('the music map filters by an element', async ({ page }) => {
  await serveFixtureElements(page);
  await page.goto('/#view=roots-map');
  await expect(page.locator('.rm-els .rt-el')).toHaveCount(6);
  await page.locator('.rm-els [data-el="blue-notes"]').click();
  await expect(page.locator('.rmap.lit')).toBeAttached();
  await expect(page.locator('.rm-els [data-el="blue-notes"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('.rm-edge.el-on').count()).toBeGreaterThan(2);
  await expect(page.locator('.rm-info')).toContainText('Blue notes');
  // Picking an artist leaves the filter.
  await page.locator('.rm-input').fill('zeppelin');
  await page.locator('.rm-input').press('Enter');
  await expect(page.locator('.rm-els [data-el="blue-notes"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.rm-path-head > b')).toHaveText('Led Zeppelin');
  await expect(page.locator('.rm-info .rt-threads')).toContainText('Blue notes');
});

test('labels on the phone map are at least 12px and do not overlap when a path is lit', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'phones only');
  await page.goto('/#view=roots-map');
  await page.locator('.rm-input').fill('sheeran');
  await page.locator('.rm-input').press('Enter');
  await page.waitForTimeout(1200);
  const rects = await page.locator('.rm-node .lbl').evaluateAll((ls) =>
    ls.filter((l) => getComputedStyle(l).display !== 'none' && l.textContent).map((l) => {
      const r = l.getBoundingClientRect();
      return { h: r.height, l: r.left, r: r.right, t: r.top, b: r.bottom };
    }),
  );
  expect(rects.length).toBeGreaterThan(3);
  // a 12px face renders at least ~12px tall on screen
  for (const r of rects) expect(r.h).toBeGreaterThanOrEqual(12);
  let n = 0;
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) if (rects[i].l < rects[j].r - 1 && rects[i].r > rects[j].l + 1 && rects[i].t < rects[j].b - 1 && rects[i].b > rects[j].t + 1) n++;
  expect(n).toBe(0);
});
