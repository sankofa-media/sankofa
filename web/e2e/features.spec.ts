import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sankofa.edition', 'm');
    localStorage.setItem('sankofa.navlegend', '1');
  });
  // Nothing in these tests may reach a video host or the archive.
  await page.route(/youtube|ytimg|googlevideo|tile\.loc\.gov/, (r) => r.abort());
});

const sheet = (page: Page) => page.locator('.ft-sheet:not([hidden])');
const feature = (page: Page) => sheet(page).locator('article.ft[data-feature-id="sea-lion-girls"]');
const scene = (page: Page, id: string) => feature(page).locator(`[data-scene="${id}"]`);

async function openFeature(page: Page, hash = '#view=feature&item=sea-lion-girls'): Promise<void> {
  await page.goto(`/${hash}`);
  await expect(feature(page)).toBeVisible();
}

async function goToScene(page: Page, id: string): Promise<void> {
  await scene(page, id).evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await expect.poll(() => page.url()).toContain(`scene=${id}`);
}

test('the menu opens the list of features, and the list opens Sea Lion Girls', async ({ page, isMobile }) => {
  await page.goto('/');
  if (isMobile) {
    await page.locator('.nav-menu-btn').click();
    const entry = page.locator('.nav-sheet-item[data-entry="features"]');
    await expect(entry.locator('b')).toHaveText('Features');
    await expect(entry.locator('small')).not.toBeEmpty();
    await entry.click();
  } else {
    await page.locator('.nav-actions [data-features]').click();
  }
  await expect(sheet(page).locator('.ft-list-head h2')).toHaveText('Special projects');
  expect(page.url()).toContain('view=features');
  const item = sheet(page).locator('[data-feature="sea-lion-girls"]');
  await expect(item).toContainText('Sea Lion Girls: how two young women from Mississippi sang a song the whole world knows');
  await item.click();
  await expect(feature(page)).toBeVisible();
  expect(page.url()).toContain('view=feature&item=sea-lion-girls');
  await expect(feature(page).locator('h1.ft-h1')).toContainText('Sea Lion Girls');
  // Back returns to the list, and back again to the museum.
  await page.goBack();
  await expect(sheet(page).locator('.ft-list')).toBeVisible();
  await expect(feature(page)).toHaveCount(0);
  await page.goBack();
  await expect(sheet(page)).toHaveCount(0);
});

test('every scene is built, held lines never show, and no text is hard to reach', async ({ page }) => {
  await openFeature(page);
  const ids = await feature(page).locator('.ft-scene').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.scene));
  expect(ids).toEqual(['door', 'ring', 'expedition', 'family', 'minute', 'album', 'simone', 'single', 'bass', 'river', 'jazz', 'beat', 'house', 'feist', 'kanye', 'massive', 'burial', 'screen', 'silence', 'classroom', 'finale']);
  // Lines waiting for a second source are not shipped at all.
  const text = await feature(page).innerText();
  expect(text).not.toContain('ambulance');
  expect(text).not.toContain('by ear');
  expect(text).not.toContain('only Isaac');
  expect(await page.evaluate(async () => JSON.stringify(await (await fetch('data/features/sea-lion-girls.json')).json()))).not.toContain('ambulance');
  // Every block is draft copy for now, and says so to the editor.
  expect(await feature(page).locator('.ft-block[data-block]:not([data-draft])').count()).toBe(0);
  // Family: five names with their ages.
  await expect(scene(page, 'family').locator('.ft-figures li')).toHaveCount(5);
  await expect(scene(page, 'family').locator('.ft-figures li').first()).toContainText('Mary Shipp');
  await expect(scene(page, 'family').locator('.ft-figures li').first()).toContainText('47');
});

test('the knock is the first gesture: it unlocks the sound and opens the door', async ({ page }) => {
  await openFeature(page);
  await expect(feature(page)).toHaveAttribute('data-audio', 'locked');
  await feature(page).locator('.ft-knock').click();
  await expect(feature(page)).toHaveAttribute('data-audio', 'on');
  await expect(feature(page)).toHaveAttribute('data-knocked', '');
  await expect(feature(page).locator('.art-door.open').first()).toBeAttached();
  await expect(feature(page).locator('.ft-opened')).toContainText('Luella and John Shipp');
  // The bar's sound switch turns the clap off and on again.
  const sound = sheet(page).locator('.ft-sound');
  await expect(sound).toHaveAttribute('aria-pressed', 'true');
  await sound.click();
  await expect(feature(page)).toHaveAttribute('data-audio', 'off');
  await expect(sound).toHaveAttribute('aria-pressed', 'false');
});

test('the clap circle keeps the reader’s claps through the whole feature', async ({ page }) => {
  await openFeature(page);
  await feature(page).locator('.ft-knock').click();
  await goToScene(page, 'minute');
  const circle = feature(page).locator('.cc');
  await expect(circle).toHaveAttribute('data-place', 'stage');
  await circle.click();
  await circle.click();
  // The space bar claps here too.
  await page.locator('.ft-sheet').focus();
  await page.keyboard.press('Space');
  await expect(circle.locator('.cc-drop')).toHaveCount(3);
  await expect(circle).toHaveAttribute('aria-label', /3/);
  await goToScene(page, 'river');
  await expect(circle).toHaveAttribute('data-place', 'corner');
  await expect(circle).toBeVisible();
  await expect(circle.locator('.cc-drop')).toHaveCount(3);
  await goToScene(page, 'finale');
  await expect(circle).toHaveAttribute('data-place', 'stage');
  await expect(circle.locator('.cc-drop')).toHaveCount(3);
  await feature(page).locator('.fn-together').click();
  await expect(feature(page)).toHaveAttribute('data-together', '');
  // The finale also starts the 1939 recording in the docked player.
  await expect(page.locator('.mp')).toBeVisible();
  await expect(page.locator('.mp-now b')).toContainText('Shipp');
});

test('the 1964 single turns over: A side, then the B side and the name on its label', async ({ page }) => {
  await openFeature(page, '#view=feature&item=sea-lion-girls&scene=single');
  await expect.poll(() => page.url()).toContain('scene=single');
  const rec = scene(page, 'single').locator('.sg');
  const flip = scene(page, 'single').locator('.sg-flip');
  await expect(rec).toHaveAttribute('data-side', 'a');
  await expect(rec.locator('.sg-a .sg-title')).toHaveText('Mississippi Goddam');
  await flip.click();
  await expect(rec).toHaveAttribute('data-side', 'b');
  await expect(flip).toHaveAttribute('aria-pressed', 'true');
  await expect(rec.locator('.sg-b .sg-title')).toHaveText('Sea Lion Woman');
  await expect(rec.locator('.sg-b .sg-credit')).toHaveText('Written by George Houston Bass');
  await expect(rec.locator('.sg-b .sg-names')).toHaveText('Christine and Katherine Shipp');
  await expect(scene(page, 'single').locator('.sg-now')).toContainText('Sea Lion Woman');
});

test('the river: two branches, a filter by kind, and a node plays in the docked player', async ({ page }) => {
  await openFeature(page, '#view=feature&item=sea-lion-girls&scene=river');
  const rv = scene(page, 'river');
  await expect(rv.locator('.rv-node')).toHaveCount(29);
  await expect(rv.locator('.rv-node[data-branch="girls"]')).not.toHaveCount(0);
  await expect(rv.locator('.rv-node[data-branch="simone"]')).not.toHaveCount(0);
  await expect(rv.locator('.rv-node[data-node="feist-sealion-2007"]')).toHaveAttribute('data-branch', 'girls');
  await rv.locator('.rv-filter[data-filter="remix"]').click();
  await expect(rv.locator('.rv-filter[data-filter="remix"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(rv.locator('.rv-node[data-node="maw-remix-2002"]')).not.toHaveClass(/dim/);
  await expect(rv.locator('.rv-node[data-node="feist-sealion-2007"]')).toHaveClass(/dim/);
  await rv.locator('.rv-filter[data-filter="all"]').click();
  await expect(rv.locator('.rv-node.dim')).toHaveCount(0);
  await rv.locator('.rv-node[data-node="feist-sealion-2007"]').click();
  await expect(page.locator('.mp')).toBeVisible();
  await expect(page.locator('.mp-now b')).toContainText('Feist');
  await expect(rv.locator('.rv-detail .rv-card h3')).toContainText('Sealion');
  // A node without an official upload says so instead of playing.
  await rv.locator('.rv-node[data-node="easybeats-1967"]').click();
  await expect(rv.locator('.rv-detail .ft-none')).toBeVisible();
});

test('Massive Attack: three clap flashes tied back to 1964 and 1939', async ({ page }) => {
  await openFeature(page, '#view=feature&item=sea-lion-girls&scene=massive');
  const sc = scene(page, 'massive');
  await expect(sc.locator('.fl-mark')).toHaveCount(3);
  await expect(sc.locator('.fl-mark text')).toHaveText(['1:49', '2:37', '3:21']);
  await expect(sc.locator('.thread')).toHaveCount(6);
  await sc.locator('.fl-show').click();
  await expect(sc.locator('.fl-mark.seen')).toHaveCount(3, { timeout: 5000 });
  await expect(sc.locator('.ft-note')).toContainText('Jerry Fuchs');
});

test('calm mode: a switch on the feature screen, on by itself with reduced motion', async ({ page }) => {
  await openFeature(page);
  const calm = sheet(page).locator('.ft-calm');
  await expect(calm).toHaveAttribute('aria-pressed', 'false');
  await calm.click();
  await expect(calm).toHaveAttribute('aria-pressed', 'true');
  await expect(feature(page)).toHaveClass(/is-calm/);
  // Every drawing is finished and every line of text shown at once.
  await expect.poll(() => feature(page).locator('.ft-block:not(.on)').count()).toBe(0);
  const offsets = await feature(page).locator('[data-scene="door"] [data-ink]').evaluateAll((els) => els.map((e) => (e as SVGElement).style.strokeDashoffset));
  expect(offsets.every((o) => o === '0')).toBe(true);
  // Kept for the next visit.
  await page.reload();
  await expect(sheet(page).locator('.ft-calm')).toHaveAttribute('aria-pressed', 'true');
});

test('calm mode follows the system’s reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openFeature(page);
  await expect(sheet(page).locator('.ft-calm')).toHaveAttribute('aria-pressed', 'true');
  const anim = await feature(page).locator('.ink-breathe').first().evaluate((e) => getComputedStyle(e).animationName);
  expect(anim).toBe('none');
});

test('in Russian, the feature, its labels and its menu entry are Russian', async ({ page }) => {
  await openFeature(page, '#view=feature&item=sea-lion-girls&lang=ru');
  await expect(feature(page).locator('h1.ft-h1')).toContainText('как две девушки из Миссисипи');
  await expect(feature(page).locator('.ft-knock')).toHaveText('Постучать');
  await expect(sheet(page).locator('.ft-calm')).toContainText('Спокойный режим');
  await expect(scene(page, 'door').locator('[data-block="when"]')).toContainText('13 мая 1939 года');
  await expect(page.locator('.nav-actions [data-features]')).toHaveAttribute('aria-label', 'Спецпроекты');
});

test('a link keeps the scene: reload and back return to it', async ({ page }) => {
  await openFeature(page);
  await goToScene(page, 'album');
  await page.reload();
  await expect(feature(page)).toBeVisible();
  await expect.poll(async () => scene(page, 'album').evaluate((el) => Math.abs(el.getBoundingClientRect().top) < window.innerHeight)).toBe(true);
  expect(page.url()).toContain('scene=album');
});

test('the feature fits a phone: nothing runs off the side', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone layout');
  await openFeature(page);
  for (const id of ['door', 'family', 'single', 'river', 'screen', 'finale']) {
    await goToScene(page, id);
    const over = await page.locator('.ft-sheet').evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(over, id).toBeLessThanOrEqual(1);
  }
});
