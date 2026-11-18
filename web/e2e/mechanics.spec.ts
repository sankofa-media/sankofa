import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sankofa.edition', 'm');
    localStorage.setItem('sankofa.navlegend', '1');
  });
  // Nothing in these tests may reach YouTube.
  await page.route(/youtube|ytimg|googlevideo/, (r) => r.abort());
});

const sheet = (page: Page) => page.locator('.mx-sheet.open');

test('a card leads to its document, whose lines light up as the notes scroll', async ({ page }) => {
  await page.goto('/#focus=equiano');
  const link = page.locator('.drawer.on .mx-doclink');
  await expect(link).toBeVisible();
  await link.click();
  await expect(sheet(page)).toBeVisible();
  expect(page.url()).toContain('view=document');
  expect(page.url()).toContain('item=equiano-narrative');
  const notes = sheet(page).locator('.desk-note');
  const n = await notes.count();
  expect(n).toBeGreaterThan(2);
  await expect(sheet(page).locator('.desk-mark.on').first()).toBeVisible();
  await expect(sheet(page).locator('.desk-mark.on').first()).toHaveAttribute('data-line', '0');
  // The last line is on the second page: reading it turns the page.
  await notes.last().scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 300);
  await expect(notes.last()).toHaveClass(/on/);
  await expect(sheet(page).locator(`.desk-mark.on[data-line="${n - 1}"]`).first()).toBeAttached();
  await expect(sheet(page).locator('.desk-page')).toContainText('List of subscribers');
  // Closing returns to the card.
  await sheet(page).locator('.mx-close').click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.locator('.drawer.on article.card[data-card-id="equiano"]')).toBeVisible();
});

test('on a phone the scan pans and zooms to the line being read', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone layout');
  await page.goto('/#view=document&item=douglass-narrative');
  const paper = sheet(page).locator('.desk-paper');
  await expect(paper).toBeVisible();
  const notes = sheet(page).locator('.desk-note');
  await notes.nth(2).scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 200);
  await expect.poll(async () => paper.evaluate((el) => getComputedStyle(el).transform)).not.toBe('none');
  const t1 = await paper.evaluate((el) => el.style.transform);
  await notes.nth(5).scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 200);
  await expect.poll(async () => paper.evaluate((el) => el.style.transform)).not.toBe(t1);
});

test('the Workshop: one sound at a time, keyboard steps, a video only on request', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (r) => asked.push(r.url()));
  await page.goto('/#view=workshop');
  await expect(sheet(page).locator('.mx-object')).toHaveCount(5);
  const machine = sheet(page).locator('.mx-obj-tr808 .mx-machine');
  const play = machine.locator('.mx-play');
  await play.click();
  await expect(play).toHaveAttribute('aria-pressed', 'true');
  await expect(machine.locator('.mx-step.now').first()).toBeAttached();
  // The Amen machine takes over: the drum machine stops.
  const amenPlay = sheet(page).locator('.mx-obj-amen .mx-machine .mx-play');
  await amenPlay.click();
  await expect(amenPlay).toHaveAttribute('aria-pressed', 'true');
  await expect(play).toHaveAttribute('aria-pressed', 'false');
  await amenPlay.click();
  await expect(amenPlay).toHaveAttribute('aria-pressed', 'false');
  // Steps toggle by keyboard and move with the arrows.
  const first = machine.locator('.mx-step[tabindex="0"]');
  const before = await first.getAttribute('aria-pressed');
  await first.focus();
  await page.keyboard.press('Space');
  await expect(first).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true');
  await page.keyboard.press('ArrowRight');
  await expect(machine.locator('.mx-step[tabindex="0"]')).toHaveAttribute('data-k', '1');
  // Pads answer a tap.
  const pad = sheet(page).locator('.mx-pad').first();
  await pad.click();
  await expect(pad).toHaveClass(/hit/);
  // The Amen recording is the museum's shared listening block, with the video
  // from the listening list; nothing is asked of the video host before play.
  const video = sheet(page).locator('.mx-obj-amen .lb');
  expect(asked.some((u) => /youtube-nocookie|googlevideo/.test(u))).toBe(false);
  await expect(video.locator('iframe')).toHaveCount(0);
  await video.locator('.lb-facade').click();
  await expect(video.locator('iframe')).toHaveAttribute('src', /^https:\/\/www\.youtube-nocookie\.com\/embed\/HrrWhCbZAyY\?autoplay=1/);
  // Starting an instrument closes the video.
  await play.click();
  await expect(video.locator('iframe')).toHaveCount(0);
  await play.click();
});

test('one sound at a time: the gramophone, a card recording and the video stop each other', async ({ page }) => {
  await page.goto('/#focus=crazy-blues');
  const card = page.locator('.drawer.on');
  const g = card.locator('.mx-gramophone');
  const gBtn = g.locator('.g-controls .btn');
  const video = card.locator('figure.lb').first();
  const record = card.locator('figure.card-audio audio').first();
  await expect(g).toBeVisible();
  // The gramophone, then the card's listening block: the record stops.
  await gBtn.click();
  await expect(gBtn).toHaveAttribute('aria-pressed', 'true', { timeout: 15000 });
  await video.locator('.lb-facade').click();
  await expect(video.locator('iframe')).toHaveCount(1);
  await expect(gBtn).toHaveAttribute('aria-pressed', 'false');
  // The card's own recording (a plain <audio>) unloads the video.
  await record.evaluate((a: HTMLAudioElement) => {
    a.muted = true;
    return a.play();
  });
  await expect(video.locator('iframe')).toHaveCount(0);
  // The gramophone pauses that recording.
  await gBtn.click();
  await expect(gBtn).toHaveAttribute('aria-pressed', 'true', { timeout: 15000 });
  await expect.poll(() => record.evaluate((a: HTMLAudioElement) => a.paused)).toBe(true);
  // Closing the card silences what sounds in it.
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('audio')].every((a) => a.paused))).toBe(true);
});

test('the gramophone drops the needle where the record is pressed', async ({ page }) => {
  await page.goto('/#focus=crazy-blues');
  const g = page.locator('.drawer.on .mx-gramophone');
  await expect(g).toBeVisible();
  await g.scrollIntoViewIfNeeded();
  const deck = g.locator('.g-svg');
  const box = (await deck.boundingBox())!;
  // About two thirds of the way in from the edge of the record.
  await page.mouse.click(box.x + (170 / 420) * box.width, box.y + ((165 - 0.6 * 140) / 330) * box.height);
  const btn = g.locator('.g-controls .btn');
  await expect(btn).toHaveAttribute('aria-pressed', 'true', { timeout: 15000 });
  await expect.poll(async () => Number(await g.locator('.g-slider').inputValue()), { timeout: 15000 }).toBeGreaterThan(60);
  await expect(g).toHaveClass(/playing/);
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
});

test('every card says how it was checked, and the method page counts the ledgers', async ({ page, request }) => {
  const checks = await (await request.get('data/checks.json')).json();
  await page.goto('/#focus=douglass-covey');
  const panel = page.locator('.drawer.on .mx-checks');
  await expect(panel).toBeAttached();
  await panel.locator('summary').first().click();
  const facts = panel.locator('.ck-fact');
  await expect(facts).toHaveCount(checks.cards['douglass-covey'].facts.length);
  const i = checks.cards['douglass-covey'].facts.findIndex((f: { checks: unknown[] }) => f.checks.length === 2);
  const fact = facts.nth(i);
  await fact.locator('summary').click();
  await expect(fact.locator('.ck-agent')).toHaveCount(2);
  await expect(fact.locator('.ck-agent').first()).toContainText('Agent A');
  await expect(fact.locator('.ck-sources a').first()).toHaveAttribute('href', /^https?:/);
  await expect(panel.locator('.ck-media').first()).toBeAttached();
  await panel.locator('a[data-mech="method"]').click();
  await expect(sheet(page)).toBeVisible();
  const stats = sheet(page).locator('.ck-stat b');
  await expect(stats.nth(0)).toHaveText(String(checks.totals.claimsExamined));
  await expect(stats.nth(1)).toHaveText(String(checks.totals.facts));
  // The context rewrite is counted with the rest.
  await expect(sheet(page).locator('.ck-breakdown')).toContainText(`${checks.totals.context.kept} added when cards were rewritten for context and outcomes`);
});

test('a fact from the context rewrite shows the writer’s sources and the second check', async ({ page, request }) => {
  const checks = await (await request.get('data/checks.json')).json();
  await page.goto('/#focus=gullah');
  const panel = page.locator('.drawer.on .mx-checks');
  await panel.locator('summary').first().click();
  const facts = checks.cards.gullah.facts as { fact: string; checks: { agent: string; note?: string }[] }[];
  const i = facts.findIndex((f) => f.checks[0]?.agent === 'W');
  expect(i).toBeGreaterThanOrEqual(0);
  const fact = panel.locator('.ck-fact').nth(i);
  await fact.locator('summary').click();
  await expect(fact.locator('.ck-agent').first()).toContainText('The writer’s sources');
  await expect(fact.locator('.ck-agent').nth(1)).toContainText('Second agent');
  await expect(fact.locator('.ck-agent').nth(1).locator('.ck-sources a').first()).toHaveAttribute('href', /^https?:/);
});

test('the guide: from the top bar and from the copy note, with numbers filled in, in Russian too', async ({ page }, info) => {
  await page.goto('/');
  // On a phone the guide is in the labelled menu.
  if (info.project.name === 'mobile') {
    await page.locator('.nav-menu-btn').click();
    await page.locator('.nav-sheet [data-entry="guide"]').click();
  } else await page.locator('.nav-actions [data-mech="guide"]').click();
  await expect(sheet(page).locator('.mx-guide h2').first()).toHaveText('How to read this museum');
  await expect(sheet(page)).not.toContainText('{{');
  await expect(sheet(page).locator('.mx-prose h2')).toHaveCount(10);
  await sheet(page).locator('.mx-close').click();
  await expect(page.locator('.mx-help').first()).toBeAttached();
  await page.goto('/#view=guide&lang=ru');
  await expect(sheet(page).locator('.mx-guide h2').first()).toHaveText('Как читать этот музей');
  await expect(sheet(page)).not.toContainText('{{');
});

test('the dedication: absent without content, then reachable from the end and the footer, with its unseen line', async ({ page }) => {
  await page.route('**/data/dedication.json', (r) => r.fulfill({ status: 404, body: '' }));
  await page.goto('/');
  await expect(page.locator('.mx-colophon a[data-mech="dedication"]')).toBeHidden();
  await expect(page.locator('.mx-coda-ded')).toBeHidden();

  await page.unroute('**/data/dedication.json');
  await page.route('**/data/dedication.json', (r) =>
    r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        version: 1,
        ru: {
          title: 'Тестовая страница',
          blocks: [{ type: 'p', inline: [{ t: 'text', s: 'Это тестовая заготовка. ' }, { t: 'unseen', s: 'Скрытая часть.' }] }],
        },
      }),
    }),
  );
  await page.goto('/?fixture#lang=en');
  const link = page.locator('.mx-colophon a[data-mech="dedication"]');
  await expect(link).toBeVisible();
  await expect(page.locator('.mx-coda-ded')).toBeAttached();
  await link.click();
  // Only Russian exists, so the English reader gets the Russian text.
  await expect(sheet(page).locator('.mx-dedication h2')).toHaveText('Тестовая страница');
  await expect(sheet(page).locator('.mx-ded-prose')).toContainText('Это тестовая заготовка.');
  expect(page.url()).toContain('view=dedication');
  // The unseen line is there, in the colour of the page, in both themes.
  const span = sheet(page).locator('.mx-ded-prose span.unseen');
  await expect(span).toHaveText('Скрытая часть.');
  const colours = () => span.evaluate((el) => [getComputedStyle(el).color, getComputedStyle(el.closest('.mx-sheet')!).backgroundColor, getComputedStyle(el).userSelect]);
  let [fg, bg, sel] = await colours();
  expect(fg).toBe(bg);
  expect(sel).not.toBe('none');
  await page.evaluate(() => (document.documentElement.dataset.theme = 'light'));
  [fg, bg] = await colours();
  expect(fg).toBe(bg);
  await expect(span).not.toHaveAttribute('title');
});
