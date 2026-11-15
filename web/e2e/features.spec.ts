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
  // The one line still resting on a single source never ships.
  expect(text).not.toContain('by ear');
  expect(await page.evaluate(async () => JSON.stringify(await (await fetch('data/features/sea-lion-girls.json')).json()))).not.toContain('by ear');
  // Every block is draft copy for now, and says so to the editor.
  // Final texts carry no draft mark; drafts are marked so the editor can find them.
  expect(await feature(page).locator('.ft-block[data-block]').count()).toBeGreaterThan(0);
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
  await expect(scene(page, 'door').locator('.ft-art')).toHaveAttribute('data-state', 'open');
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
  await expect(rv.locator('.rv-detail .rv-card .rv-title')).toContainText('Sealion');
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
  for (const id of ['door', 'expedition', 'family', 'album', 'simone', 'single', 'river', 'screen', 'classroom', 'finale']) {
    await goToScene(page, id);
    const over = await page.locator('.ft-sheet').evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(over, id).toBeLessThanOrEqual(1);
  }
});

test('a dictionary link opens its card over the longread; closing it returns to the same scene and sound', async ({ page }) => {
  await openFeature(page);
  await feature(page).locator('.ft-knock').click();
  await expect(feature(page)).toHaveAttribute('data-audio', 'on');
  await goToScene(page, 'jazz');
  // A recording in the docked player keeps playing through the card.
  await scene(page, 'jazz').locator('.ft-play').first().click();
  await expect(page.locator('.mp iframe.lb-frame')).toHaveCount(1);
  const audio = await feature(page).getAttribute('data-audio');
  // An explicit [[jazz]] link in the stop's text.
  const link = scene(page, 'jazz').locator('[data-block="text"] a.xref[data-card="jazz"]');
  await expect(link).toBeVisible();
  // Let the scroll that brings the link into view settle before the card opens.
  await link.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await link.click();
  await expect(page.locator('.drawer.on article.card[data-card-id="jazz"]')).toBeVisible();
  const top = await page.locator('.ft-sheet').evaluate((el) => el.scrollTop);
  const at = page.url().match(/scene=([a-z-]+)/)?.[1];
  expect(page.url()).toContain('view=feature');
  await expect(feature(page)).toBeAttached();
  await page.keyboard.press('Escape');
  await expect(page.locator('.drawer.on')).toHaveCount(0);
  await expect(feature(page)).toBeVisible();
  expect(page.url()).toContain(`scene=${at}`);
  expect(await page.locator('.ft-sheet').evaluate((el) => el.scrollTop)).toBe(top);
  await expect(feature(page)).toHaveAttribute('data-audio', audio!);
  await expect(page.locator('.mp iframe.lb-frame')).toHaveCount(1);
  // The linker also finds names nobody marked: the river's cards and the stops are woven.
  expect(await feature(page).locator('a.xref[data-card]').count()).toBeGreaterThan(2);
});

test('in Russian the links open the Russian card in place, and the scene stays', async ({ page }) => {
  await openFeature(page, '#view=feature&item=sea-lion-girls&scene=single&lang=ru');
  await expect.poll(() => page.url()).toContain('scene=single');
  const link = scene(page, 'single').locator('[data-block="two-sides"] a.xref[data-card="mississippi-goddam"]');
  await expect(link).toHaveText('«Mississippi Goddam»');
  await link.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await link.click();
  await expect(page.locator('.drawer.on article.card[data-card-id="mississippi-goddam"]')).toBeVisible();
  const at = page.url().match(/scene=([a-z-]+)/)?.[1];
  const top = await page.locator('.ft-sheet').evaluate((el) => el.scrollTop);
  await page.locator('.drawer.on .close').first().click();
  await expect(page.locator('.drawer.on')).toHaveCount(0);
  await expect(feature(page)).toBeVisible();
  expect(page.url()).toContain(`scene=${at}`);
  expect(await page.locator('.ft-sheet').evaluate((el) => el.scrollTop)).toBe(top);
});

test('the 1939 recording plays the Library’s own file, credited, with a link to its page', async ({ page }) => {
  await openFeature(page, '#view=feature&item=sea-lion-girls&scene=minute');
  const sc = scene(page, 'minute');
  await expect(sc.locator('.ft-credit')).toContainText('Library of Congress, American Folklife Center');
  await expect(sc.locator('.ft-credit a')).toHaveAttribute('href', 'https://www.loc.gov/item/ihas.200196570/');
  await sc.locator('.ft-play').click();
  await expect(page.locator('.mp audio')).toHaveAttribute('src', /^https:\/\/tile\.loc\.gov\//);
  await expect(page.locator('.mp iframe')).toHaveCount(0);
});

test('Nina Simone’s photo develops out of the drawing, with its CC0 credit', async ({ page }) => {
  await openFeature(page, '#view=feature&item=sea-lion-girls&scene=simone');
  const fig = scene(page, 'simone').locator('figure.ft-photo');
  await expect(fig.locator('img.ink-photo')).toHaveAttribute('src', /nina-simone-1965\.jpg$/);
  await expect(fig.locator('img.ink-photo')).toHaveAttribute('alt', /Nina Simone/);
  // It develops out of the generated drawing of a woman at the piano.
  await expect(fig.locator('.ink-develop > .ft-art [data-layer="piano-figure"]')).toHaveAttribute('data-role', 'figure');
  await expect(fig.locator('figcaption')).toContainText('Anefo');
  await expect(fig.locator('figcaption')).toContainText('CC0');
});

test('the illustrations load scene by scene, as the reader comes near', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    const m = r.url().match(/media\/features\/sea-lion-girls\/([a-z0-9-]+\.webp)$/);
    if (m) asked.push(m[1]);
  });
  await openFeature(page);
  const door = scene(page, 'door').locator('.ft-art img');
  await expect(door).toHaveCount(5);
  await expect.poll(() => door.evaluateAll((els) => els.every((e) => (e as HTMLImageElement).complete && (e as HTMLImageElement).naturalWidth > 0))).toBe(true);
  // Nothing further down has been fetched yet.
  expect(asked.filter((f) => !f.startsWith('door-'))).toEqual([]);
  await expect(scene(page, 'classroom').locator('.ft-art img[data-src]')).toHaveCount(3);
  // Layers carry alt text where they mean something, and an empty alt where they are decoration.
  await expect(scene(page, 'door').locator('[data-layer="door-house"] img')).toHaveAttribute('alt', /wooden house/);
  await expect(scene(page, 'door').locator('[data-layer="door-tree"] img')).toHaveAttribute('alt', '');
  await goToScene(page, 'expedition');
  const exp = scene(page, 'expedition').locator('.ft-art img');
  await expect(exp).toHaveCount(3);
  await expect.poll(() => exp.evaluateAll((els) => els.every((e) => (e as HTMLImageElement).naturalWidth > 0))).toBe(true);
  expect(asked).toContain('expedition-machine.webp');
  expect(asked).not.toContain('classroom-room.webp');
  // No caption on the pictures themselves; one line in the closing credits says they are generated.
  await expect(feature(page).locator('.ft-art figcaption')).toHaveCount(0);
  await expect(scene(page, 'finale').locator('.ft-art-credit')).toHaveText('Illustrations generated, edited by the museum');
});

test('the finale: the door of the first scene opens, with the light behind it', async ({ page }) => {
  await openFeature(page, '#view=feature&item=sea-lion-girls&scene=finale');
  await expect.poll(() => page.url()).toContain('scene=finale');
  const art = scene(page, 'finale').locator('.ft-art');
  await expect(art).toHaveAttribute('data-state', 'closed');
  await expect(art.locator('[data-layer="door-porch-open"]')).toHaveAttribute('aria-hidden', 'true');
  await page.locator('.ft-sheet:not([hidden])').evaluate((el) => el.scrollBy(0, el.clientHeight));
  await expect(art).toHaveAttribute('data-state', 'open');
  await expect(art.locator('[data-layer="door-porch-open"]')).not.toHaveAttribute('aria-hidden', 'true');
  await expect(art.locator('[data-layer="door-porch"]')).toHaveAttribute('aria-hidden', 'true');
  await expect.poll(() => art.locator('[data-layer="door-light"] img').evaluate((e) => Number(getComputedStyle(e).opacity))).toBe(1);
});

test('calm mode keeps the illustrations still and finished', async ({ page }) => {
  await openFeature(page, '#view=feature&item=sea-lion-girls&scene=album');
  await sheet(page).locator('.ft-calm').click();
  await expect(feature(page)).toHaveClass(/is-calm/);
  const style = (sel: string) => feature(page).locator(sel).first().evaluate((e) => {
    const s = getComputedStyle(e);
    return { mask: s.maskImage, anim: s.animationName, transform: (e as HTMLElement).style.transform, open: s.getPropertyValue('--open') };
  });
  // No ink wipe, no breathing, no turning disc, no parallax; the van's doors stand open.
  expect((await style('[data-scene="album"] .ft-art .al')).mask).toBe('none');
  expect((await style('[data-layer="album-disc"] .al-face img')).anim).toBe('none');
  expect((await style('[data-layer="classroom-children"]')).anim).toBe('none');
  expect((await style('[data-layer="album-sleeves"]')).transform).toBe('');
  expect((await style('[data-layer="expedition-machine"]')).open).toBe('1');
  // The finale shows its door open at once.
  await goToScene(page, 'finale');
  await expect(scene(page, 'finale').locator('.ft-art')).toHaveAttribute('data-state', 'open');
});

test('with reduced motion the illustrations do not move either', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openFeature(page, '#view=feature&item=sea-lion-girls&scene=classroom');
  const anim = await scene(page, 'classroom').locator('[data-layer="classroom-teacher"]').evaluate((e) => getComputedStyle(e).animationName);
  expect(anim).toBe('none');
  const mask = await scene(page, 'classroom').locator('.ft-art .al').first().evaluate((e) => getComputedStyle(e).maskImage);
  expect(mask).toBe('none');
});

test('the ring, the family and the minute are drawn in layers: hands clap, the sisters step forward', async ({ page }) => {
  await openFeature(page);
  for (const id of ['ring', 'family', 'minute']) await expect(scene(page, id).locator('svg.ink')).toHaveCount(0);
  await goToScene(page, 'family');
  const sisters = scene(page, 'family').locator('.al[data-role="step"]');
  await expect(sisters).toHaveCount(2);
  // Half a step back until the scene is reached, then forward to where they are drawn.
  await expect.poll(() => sisters.first().evaluate((e) => getComputedStyle(e).scale)).toBe('1');
  await expect(scene(page, 'family').locator('.ft-figures li')).toHaveCount(5);
  await feature(page).locator('.ft-knock').evaluate((b) => (b as HTMLButtonElement).click());
  await goToScene(page, 'minute');
  const hands = scene(page, 'minute').locator('.al[data-role="hands"]');
  // A still copy under the clapping hands keeps the sisters whole.
  await expect(hands.locator('img')).toHaveCount(2);
  await expect.poll(() => hands.locator('img').evaluateAll((els) => els.every((e) => (e as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await hands.evaluate((e) => e.classList.remove('clap'));
  await feature(page).locator('.cc').click();
  await expect(hands).toHaveClass(/clap/);
  // The alt text says two sisters lead and answer, without naming which is which.
  const alts = await scene(page, 'minute').locator('.ft-art img:not(.al-still)').evaluateAll((els) => els.map((e) => (e as HTMLImageElement).alt).join(' '));
  expect(alts).toContain('one leads, the other answers');
  expect(alts).not.toMatch(/Christine|Katherine/);
});

test('in calm mode the hands do not clap and the sisters already stand forward', async ({ page }) => {
  await openFeature(page);
  await sheet(page).locator('.ft-calm').click();
  await expect(feature(page)).toHaveClass(/is-calm/);
  const step = await scene(page, 'family').locator('.al[data-role="step"]').first().evaluate((e) => getComputedStyle(e).scale);
  expect(step).toBe('1');
  await goToScene(page, 'minute');
  const hands = scene(page, 'minute').locator('.al[data-role="hands"]');
  await feature(page).locator('.cc').click();
  await expect(hands).not.toHaveClass(/clap/);
});
