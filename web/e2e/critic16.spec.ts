// Round 16 of the visitors' critique: what a reader on a phone and on a
// laptop, in both languages, found broken, and keeps from coming back.
import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sankofa.navlegend', '1'));
  await page.route(/youtube|ytimg|googlevideo/, (r) => r.abort());
});

const sheet = (page: Page) => page.locator('.mx-sheet.open');

test('the Cabinet’s “how to look” is a paragraph of its own', async ({ page }) => {
  await page.goto('/#view=cabinet&lang=ru');
  const ledes = sheet(page).locator('.cb-head .mx-lede');
  await expect(ledes).toHaveCount(2);
  await expect(ledes.nth(1)).toHaveText(/^Как\P{L}*искать/u);
  await page.goto('about:blank');
  await page.goto('/#view=cabinet&lang=en');
  await expect(sheet(page).locator('.cb-head .mx-lede').nth(1)).toHaveText(/^How\P{L}*to\P{L}*look/u);
});

test('a glint on the atlas map is faintly visible on a touch screen, as the Cabinet promises', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'only a touch screen has no hover');
  await page.goto('/#view=atlas');
  const glint = page.locator('.atlas.open g.cb-aglint').first();
  await expect(glint).toBeAttached({ timeout: 15_000 });
  await expect(glint).toHaveCSS('opacity', '0.35');
});

test('the top bar never runs off a laptop screen: it draws closer, then folds into the Menu', async ({ page, isMobile }) => {
  test.skip(isMobile, 'a phone always has the Menu');
  const lastRight = () => page.evaluate(() => {
    const vis = [...document.querySelectorAll<HTMLElement>('.nav-actions > *')].filter((e) => e.offsetWidth > 0);
    return vis[vis.length - 1].getBoundingClientRect().right;
  });
  // Russian labels are the longest: at 1440 the whole bar is there, theme switch included.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#ch=v5&lang=ru');
  await expect(page.locator('.nav [data-theme-toggle]')).toBeVisible();
  expect(await lastRight()).toBeLessThanOrEqual(1440);
  // A narrower window folds the bar into the Menu, which names every way in.
  await page.setViewportSize({ width: 1024, height: 768 });
  const menu = page.locator('.nav-menu-btn');
  await expect(menu).toBeVisible();
  expect(await lastRight()).toBeLessThanOrEqual(1024);
  await menu.click();
  await expect(page.locator('#nav-sheet [data-entry="dedication"]')).toBeVisible();
  // Wide again: the bar comes back and the sheet closes.
  await page.setViewportSize({ width: 1600, height: 900 });
  await expect(menu).toBeHidden();
  await expect(page.locator('#nav-sheet')).toBeHidden();
});

test('on a phone the atlas list keeps long BCE dates inside their column', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'the list is the phone’s atlas');
  await page.goto('/#view=atlas');
  const y = page.locator('.atlas-item .y').first();
  await expect(y).toBeVisible({ timeout: 15_000 });
  const over = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.atlas-item .y')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
  expect(over).toEqual([]);
});

test('Tab goes round inside an open room instead of walking into the page hidden under it', async ({ page, isMobile }) => {
  test.skip(isMobile, 'a keyboard walk');
  for (const where of ['/#view=dedication', '/#view=cabinet', '/#focus=mansa-musa']) {
    await page.goto('about:blank');
    await page.goto(where);
    await page.waitForTimeout(1500);
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      const behind = await page.evaluate(() => {
        const a = document.activeElement;
        return !!a && (a === document.body || !!a.closest('.nav, .skip, #story'));
      });
      expect(behind, `${where}: Tab ${i + 1} left the room`).toBe(false);
    }
  }
});

test('Escape leaves Roots even though the room opens with the focus in its search', async ({ page }) => {
  await page.goto('/#view=roots');
  const input = page.locator('.roots.open .r-input');
  await expect(input).toBeFocused();
  await input.fill('nirv');
  await page.keyboard.press('Escape');
  await expect(input).toHaveValue('');
  await expect(page.locator('.roots.open')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.roots.open')).toHaveCount(0);
});

test('the name index starts the Latin alphabet on a line of its own, after the Russian one', async ({ page }) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('about:blank');
    await page.goto('/#view=index&lang=ru');
    const gap = page.locator('.ix-letters .ix-letter.ix-gap');
    await expect(gap).toBeVisible();
    const [last, first, left] = await page.evaluate(() => {
      const g = document.querySelector<HTMLElement>('.ix-letters .ix-gap')!;
      const prev = g.previousElementSibling!.previousElementSibling as HTMLElement;
      return [prev.getBoundingClientRect().bottom, g.getBoundingClientRect().top, g.getBoundingClientRect().left - document.querySelector('.ix-letters')!.getBoundingClientRect().left];
    });
    // Below «Я», with room between the two, and at the start of the row.
    expect(first).toBeGreaterThan(last + 4);
    expect(left).toBeLessThan(2);
  }
});

test('on a phone the music map keeps every name it shows inside the screen', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'a phone pans a canvas wider than the screen');
  for (const lang of ['ru', 'en']) {
    await page.goto('about:blank');
    await page.goto(`/#view=roots-map&lang=${lang}`);
    await expect(page.locator('.rm-svg text.lbl:not(.hide)').first()).toBeVisible({ timeout: 15_000 });
    const cut = async () =>
      page.evaluate(() => {
        const v = document.querySelector('.rm-stage')!.getBoundingClientRect();
        return [...document.querySelectorAll('.rm-svg text.lbl:not(.hide)')]
          .map((t) => [t.textContent, t.getBoundingClientRect()] as const)
          .filter(([, r]) => r.width > 0 && r.bottom > v.top && r.top < v.bottom && (r.left < v.left || r.right > v.right))
          .map(([s]) => s);
      });
    await expect.poll(cut).toEqual([]);
    // Panned sideways, the names are fitted to the new strip.
    await page.locator('.rm-stage').evaluate((s) => s.scrollBy(150, 0));
    await expect.poll(cut).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
  }
});

test('the atlas names the Slav card “Slav → slave”, not a bare “Slav”', async ({ page }) => {
  for (const [lang, name] of [['en', 'Slav → slave'], ['ru', 'Славянин → раб']]) {
    await page.goto('about:blank');
    await page.goto(`/#focus=slave-word-and-systems&lang=${lang}&zoom=1`);
    await expect(page.locator('.atlas.open g.pt.focus text.lbl')).toHaveText(name, { timeout: 15_000 });
  }
});
