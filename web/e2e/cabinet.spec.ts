// The Workshop and the Cabinet of Curiosities: the old link to the objects,
// a cache on a card's picture, one in a chapter's words, a locked cache and
// its key, a secret drawer, the unsorted heap, the two copies, Russian.
import { expect, test, type Page } from '@playwright/test';

const as = (edition: 'm' | 'f', lang?: 'ru') => async ({ page }: { page: Page }) => {
  await page.addInitScript(
    ([e, l]) => {
      localStorage.setItem('sankofa.edition', e);
      localStorage.setItem('sankofa.navlegend', '1');
      if (l) localStorage.setItem('sankofa.lang', l);
    },
    [edition, lang ?? ''],
  );
  await page.route(/youtube|ytimg|googlevideo/, (r) => r.abort());
};

const sheet = (page: Page) => page.locator('.mx-sheet.open');
const cache = (page: Page) => page.locator('.cb-modal');

/** Open the cache hidden on a card's picture, from the keyboard. */
async function openFromPicture(page: Page, card: string) {
  await page.goto(`/#focus=${card}`);
  const spot = page.locator(`.drawer.on article.card[data-card-id="${card}"] .cb-glint`);
  await expect(spot).toBeAttached();
  // Nothing shows until the picture is hovered or the spot has focus; a touch
  // screen has no hover, so there the glint stays faintly seen.
  const touch = await page.evaluate(() => matchMedia('(hover: none)').matches);
  await expect(spot).toHaveCSS('opacity', touch ? '0.35' : '0');
  await expect(spot).toHaveAttribute('aria-label', /hidden/i);
  await spot.focus();
  await page.keyboard.press('Enter');
  await expect(cache(page)).toBeVisible();
}

/** Open the cache hidden in a word of a card. */
async function openFromCardWord(page: Page, card: string) {
  await page.goto(`/#focus=${card}`);
  const word = page.locator(`.drawer.on article.card[data-card-id="${card}"] .cb-word`).first();
  await expect(word).toBeAttached({ timeout: 15_000 });
  await word.scrollIntoViewIfNeeded();
  await word.click();
  await expect(cache(page)).toBeVisible();
}

/** Open the cache hidden in a word of a chapter step. */
async function openFromWord(page: Page, chapter: string) {
  await page.goto(`/#ch=${chapter}`);
  const word = page.locator(`#ch-${chapter} .cb-word`).first();
  await expect(word).toBeAttached({ timeout: 15_000 });
  await word.scrollIntoViewIfNeeded();
  await word.click();
  await expect(cache(page)).toBeVisible();
}

test.describe('the Workshop', () => {
  test.beforeEach(as('m'));

  test('an old link to the objects opens the Workshop and says so in the link', async ({ page }) => {
    await page.goto('/#view=objects');
    await expect(sheet(page).locator('.mx-shelf h2').first()).toHaveText('The Workshop');
    await expect.poll(() => page.url()).toContain('view=workshop');
    // Every object names its element, and its label says where, who and where next.
    await expect(sheet(page).locator('.mx-object')).toHaveCount(5);
    await expect(sheet(page).locator('.mx-object .mx-label dt')).toHaveCount(15);
    await expect(sheet(page).locator('.mx-shelf .mx-lede')).toContainText('elements');
    // Call and response answers back.
    await sheet(page).locator('.mx-cr-call').first().click();
    await expect(sheet(page).locator('.mx-cr-status')).toContainText('answered');
    // An element's thread opens in Roots with the element explained.
    await sheet(page).locator('.mx-obj-amen a.mx-thread').first().click();
    await expect(page.locator('.roots.open')).toBeVisible();
    await expect(page.locator('.roots .ep')).toBeVisible();
    expect(page.url()).toContain('view=roots');
    expect(page.url()).toContain('item=breakbeat');
  });
});

test.describe('the cabinet', () => {
  test.beforeEach(as('m'));

  test('a cache on a picture: the container first, then its things, then Unsorted', async ({ page }) => {
    await openFromPicture(page, 'equiano');
    await expect(cache(page).locator('#cb-cache-title')).toBeVisible();
    await expect(cache(page).locator('.cb-container-story')).not.toBeEmpty();
    await expect(cache(page).locator('.cb-find')).toHaveCount(0);
    await cache(page).locator('.cb-openit').click();
    const finds = cache(page).locator('.cb-find');
    expect(await finds.count()).toBeGreaterThan(0);
    // Escape closes the cache, and the card is still there.
    await page.keyboard.press('Escape');
    await expect(cache(page)).toHaveCount(0);
    await expect(page.locator('.drawer.on article.card[data-card-id="equiano"]')).toBeVisible();
    // The finds wait unsorted in the unsorted heap; one is put away.
    await page.goto('/#view=cabinet');
    const pile = sheet(page).locator('.cb-pile .cb-thing');
    const n = await pile.count();
    expect(n).toBeGreaterThan(0);
    await expect(sheet(page).locator('.cb-tally')).toContainText(/You\s+have\s+found\s+\d+\s+of\s+\d+\s+things/);
    await expect(sheet(page).locator('.cb-dust').first()).toContainText('something lay here');
    await pile.first().click();
    const sortBtn = page.locator('.cb-modal .cb-sort');
    if (await sortBtn.count()) {
      await sortBtn.click();
      await expect(sheet(page).locator('.cb-pile .cb-thing')).toHaveCount(n - 1);
      await expect(sheet(page).locator('.cb-drawer.pulled .cb-thing')).not.toHaveCount(0);
    }
  });

  test('a locked cache opens only with its key, found in another cache', async ({ page }) => {
    await openFromCardWord(page, 'garrett-morgan');
    await expect(cache(page).locator('.cb-locked')).toContainText('locked');
    await expect(cache(page).locator('.cb-usekey')).toHaveCount(0);
    await page.keyboard.press('Escape');
    // The key lies in the archive box hidden in a word of chapter five.
    await openFromWord(page, 'v5');
    await cache(page).locator('.cb-openit').click();
    await expect(cache(page).locator('.cb-keyfind')).toBeVisible();
    await openFromCardWord(page, 'garrett-morgan');
    await cache(page).locator('.cb-usekey').click();
    expect(await cache(page).locator('.cb-find').count()).toBeGreaterThan(0);
  });

  test('a secret drawer has no label until its key turns', async ({ page }) => {
    await page.goto('/#view=cabinet');
    const secret = sheet(page).locator('.cb-drawer.cb-secret[data-drawer="underground"]');
    await expect(secret.locator('.cb-plate')).toHaveText('a drawer with no label');
    await secret.locator('.cb-face').click();
    await expect(secret.locator('.cb-usekey')).toHaveCount(0);
    await openFromWord(page, 'v2');
    await cache(page).locator('.cb-openit').click();
    await expect(cache(page).locator('.cb-keyfind')).toBeVisible();
    await page.goto('/#view=cabinet');
    await sheet(page).locator('.cb-drawer.cb-secret[data-drawer="underground"] .cb-face').click();
    await sheet(page).locator('.cb-drawer.cb-secret[data-drawer="underground"] .cb-usekey').click();
    await expect(sheet(page).locator('.cb-drawer[data-drawer="underground"] .cb-plate')).toHaveText('Underground');
    expect(await sheet(page).locator('.cb-drawer[data-drawer="underground"] .cb-thing').count()).toBeGreaterThan(0);
    // The finds survive a reload: they are kept in this browser.
    await page.reload();
    await expect(sheet(page).locator('.cb-drawer[data-drawer="underground"] .cb-plate')).toHaveText('Underground');
  });

  test('the honest drawer is open from the start', async ({ page }) => {
    await page.goto('/#view=cabinet');
    const honest = sheet(page).locator('.cb-drawer.cb-honest[data-drawer="honest"]');
    await expect(honest).toHaveClass(/pulled/);
    await expect(honest.locator('.cb-drawer-intro')).toContainText('1897');
    expect(await honest.locator('.cb-thing').count()).toBeGreaterThan(0);
  });
});

test.describe('the other copy', () => {
  test.beforeEach(as('f'));
  test('the same chest holds something else in the female copy', async ({ page }) => {
    await openFromPicture(page, 'equiano');
    await cache(page).locator('.cb-openit').click();
    const f = await cache(page).locator('.cb-find').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.artifact));
    expect(f).toContain('seacole-british-hotel');
  });
});

test.describe('in Russian', () => {
  test.beforeEach(as('m', 'ru'));
  test('the cabinet, the Workshop and a hidden word speak Russian', async ({ page }) => {
    await page.goto('/#view=cabinet&lang=ru');
    await expect(sheet(page).locator('.cb-head h2')).toHaveText('Кабинет редкостей');
    await expect(sheet(page).locator('.cb-drawer.cb-secret[data-drawer="underground"] > .cb-face .cb-plate')).toHaveText('ящик без надписи');
    await page.goto('/#view=workshop&lang=ru');
    await expect(sheet(page).locator('.mx-shelf h2').first()).toHaveText('Мастерская');
    await expect(sheet(page).locator('.mx-label dt').first()).toHaveText('Где и когда');
    await page.goto('/#focus=windrush-scandal&lang=ru');
    const word = page.locator('.drawer.on .cb-word');
    await expect(word).toHaveAttribute('aria-label', /Здесь что-то спрятано/);
    await word.click();
    await expect(cache(page).locator('.cb-openit')).toHaveText('Открыть');
  });
});
