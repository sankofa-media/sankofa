import { expect, test, type Page } from '@playwright/test';

const SHOTS = process.env.ANGEL_SHOTS;

const SCENES = ['line', 'kingston', 'then-now', 'bristol', 'studio', 'olympic', 'voice', 'strata', 'break', 'crowd', 'beetle', 'screens', 'afterlife', 'warm'];
/** A line of each scene's text (the silent ones have none), in both languages. */
const LINES: Record<string, [string, string]> = {
  line: ['The song that was never meant to be', 'Песня, которой не должно было быть'],
  kingston: ['A new name', 'Новое имя'],
  'then-now': ['light and unhurried', 'светлая и неторопливая'],
  bristol: ['it turned out it was me', 'оказалось, что ищут меня'],
  studio: ['Three people in different rooms', 'Трое в разных комнатах'],
  olympic: ['A song that was not in the plan', 'Песня, которой не было в планах'],
  voice: ['high falsetto', 'высокий фальцет'],
  strata: ['programmed rather than played', 'запрограммированы, а не сыграны'],
  break: ['Angelo Bruschini’s guitars come in', 'вступают гитары Анджело Брускини'],
  crowd: ['Walter Stern', 'Уолтер Стерн'],
  beetle: ['Nick Knight', 'Ник Найт'],
  screens: ['Snatch', 'Большом куше'],
  afterlife: ['A song still being played', 'Песня, которую играют до сих пор'],
};

const RR = Array.from({ length: 40 }, (_, i) => 900 - i * 6);

/** The Angel service, stood in for: `first` decides whether there is a pulse to feel. */
async function mockApi(page: Page, opts: { first: boolean; words?: string[] } = { first: true }): Promise<void> {
  await page.route('**/api/angel/**', async (r) => {
    const url = new URL(r.request().url());
    const json = (body: unknown, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.endsWith('/pulses') && r.request().method() === 'GET') return json({ first: opts.first ? { id: 1, rr: RR } : null, others: opts.first ? [{ id: 2, rr: RR.map((v) => v - 100) }, { id: 3, rr: RR.map((v) => v + 80) }] : [] });
    if (url.pathname.endsWith('/words') && r.request().method() === 'GET') return json({ words: (opts.words ?? ['always', 'I miss you']).map((text, i) => ({ id: i + 1, text, lang: 'en', translation: text, theme: 'love' })) });
    if (url.pathname.endsWith('/words') && r.request().method() === 'POST') return json({ status: 'pending', delete_code: 'abc-def-ghi' }, 202);
    if (url.pathname.endsWith('/words/status')) return json({ status: 'published' });
    if (url.pathname.endsWith('/touch')) return r.fulfill({ status: 204 });
    if (url.pathname.endsWith('/presence')) return r.fulfill({ status: 200, contentType: 'text/event-stream', body: 'retry: 60000\n\nevent: presence\ndata: {"count":3,"watching":4,"points":[{"k":"a","x":0.2,"y":0.3},{"k":"b","x":0.7,"y":0.6},{"k":"c","x":0.5,"y":0.8}]}\n\n' });
    return r.fulfill({ status: 404, body: '' });
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sankofa.edition', 'm');
    localStorage.setItem('sankofa.navlegend', '1');
    // Every vibration asked for is written down instead.
    const w = window as unknown as { __buzz: unknown[] };
    w.__buzz = [];
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: (p: unknown) => (w.__buzz.push(p), true) });
  });
  await page.route(/youtube|ytimg|googlevideo/, (r) => r.abort());
});

const sheet = (page: Page) => page.locator('.ft-sheet:not([hidden])');
const feature = (page: Page) => sheet(page).locator('article.ft[data-feature-id="angel"]');
const scene = (page: Page, id: string) => feature(page).locator(`[data-scene="${id}"]`);

async function open(page: Page, hash = '#view=feature&item=angel'): Promise<void> {
  await page.goto(`/${hash}`);
  await expect(feature(page)).toBeVisible();
}

async function goToScene(page: Page, id: string, at = 0): Promise<void> {
  await scene(page, id).evaluate((el, f) => {
    const s = el.closest('.ft-sheet')!;
    s.scrollTop = (el as HTMLElement).offsetTop + Math.max(0, el.scrollHeight - s.clientHeight) * f;
  }, at);
  await expect.poll(() => page.url()).toContain(`scene=${id}`);
}

test('the list names Angel after Forever Changes, and it opens', async ({ page }) => {
  await mockApi(page, { first: false });
  await page.goto('/#view=features');
  const items = sheet(page).locator('.ft-item-link');
  await expect(items).toHaveCount(3);
  expect(await items.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.feature))).toEqual(['sea-lion-girls', 'forever-changes', 'angel']);
  await items.nth(2).click();
  await expect(feature(page)).toBeVisible();
  expect(page.url()).toContain('item=angel');
});

test('the language switches inside the feature and the reader stays in the scene', async ({ page }) => {
  await mockApi(page, { first: false });
  await open(page, '#view=feature&item=angel&scene=bristol');
  await expect(scene(page, 'bristol')).toContainText(LINES.bristol[0]);
  const btn = sheet(page).locator('.ft-lang');
  await expect(btn).toHaveText('RU');
  await btn.click();
  await expect.poll(() => page.url()).toContain('lang=ru');
  await expect(feature(page)).toBeVisible();
  expect(page.url()).toContain('scene=bristol');
  await expect(scene(page, 'bristol')).toContainText(LINES.bristol[1]);
  await expect(sheet(page).locator('.ft-lang')).toHaveText('EN');
  await sheet(page).locator('.ft-lang').click();
  await expect.poll(() => page.url()).not.toContain('lang=ru');
  await expect(scene(page, 'bristol')).toContainText(LINES.bristol[0]);
});

for (const [lang, k] of [['en', 0], ['ru', 1]] as const) {
  test(`every scene is built with its picture and its text (${lang})`, async ({ page }) => {
    test.setTimeout(120_000);
    await mockApi(page, { first: false });
    await open(page, `#view=feature&item=angel${lang === 'ru' ? '&lang=ru' : ''}`);
    const ids = await feature(page).locator('.ft-scene').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.scene));
    expect(ids).toEqual(SCENES);
    for (const id of SCENES) {
      await goToScene(page, id, 0.3);
      // A picture in every scene, loaded as its scene comes near.
      const imgs = scene(page, id).locator('.ft-stage img');
      expect(await imgs.count(), id).toBeGreaterThan(0);
      // The video's cover comes from YouTube, which these tests keep offline.
      if (id !== 'crowd') await expect.poll(() => imgs.first().evaluate((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0), { message: id }).toBe(true);
      if (LINES[id]) await expect(scene(page, id).locator('.ft-flow'), id).toContainText(LINES[id][k]);
    }
    // The real photographs carry their credit and a link to their source.
    await expect(scene(page, 'voice').locator('.an-photo .an-photo-credit')).toContainText('Simon Schoeters');
    await expect(scene(page, 'voice').locator('.an-photo a[href*="commons.wikimedia.org"]')).toHaveCount(1);
  });
}

test('the progress bar never shows the end, and the page simply ends after the warm screen', async ({ page }) => {
  await mockApi(page, { first: false });
  await open(page);
  const bar = feature(page).locator('.an-progress');
  await goToScene(page, 'warm', 1);
  await page.waitForTimeout(300);
  const now = Number(await bar.getAttribute('aria-valuenow'));
  expect(now).toBeGreaterThan(90);
  expect(now).toBeLessThanOrEqual(99);
  expect(await bar.evaluate((e) => Number(getComputedStyle(e).getPropertyValue('--shown')))).toBeLessThanOrEqual(0.99);
  // Scrolling to the very bottom stays at the bottom: no loop back to the opening.
  await sheet(page).evaluate((s) => (s.scrollTop = s.scrollHeight));
  await page.waitForTimeout(1500);
  expect(await sheet(page).evaluate((s) => s.scrollTop)).toBeGreaterThan(100);
});

test('without a first pulse the warm screen still invites: the first pulse is left on the pulse page', async ({ page }) => {
  await mockApi(page, { first: false });
  await open(page, '#view=feature&item=angel&scene=warm');
  const warm = scene(page, 'warm');
  await expect(warm.locator('.an-invite-lead')).toContainText('you are not alone');
  await expect(warm.locator('.an-invite-line')).toHaveText('You are not alone. Feel the pulse.');
  await expect(warm.locator('.an-last')).toBeHidden();
});

test('without the service at all the warm screen says only the last line, and nothing goes wrong', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page, '#view=feature&item=angel&scene=warm');
  await expect(scene(page, 'warm').locator('.an-last')).toBeVisible();
  await expect(scene(page, 'warm').locator('.an-invite')).toBeHidden();
  expect(errors).toEqual([]);
});

test('with a first pulse the warm screen invites: a QR code on a computer, a button on a phone', async ({ page, isMobile }) => {
  await mockApi(page, { first: true });
  await open(page, '#view=feature&item=angel&scene=warm');
  const warm = scene(page, 'warm');
  await expect(warm.locator('.an-invite-line')).toHaveText('You are not alone. Feel the pulse.');
  await expect(warm.locator('.an-last')).toBeHidden();
  if (isMobile) {
    await expect(warm.locator('.an-qr')).toHaveCount(0);
    await warm.locator('.an-feel').click();
    await expect(page.locator('.an-pulse')).toBeVisible();
    await expect(page.locator('.an-pulse')).toHaveAttribute('data-state', 'full');
  } else {
    const qr = warm.locator('svg.an-qr-code');
    await expect(qr).toBeVisible();
    expect(await qr.getAttribute('data-url')).toMatch(/#view=feature&item=angel&scene=warm&pulse=1$/);
    await expect(warm.locator('.an-qr figcaption')).toHaveText('Point your phone’s camera at the code to open the page');
  }
});

test('the pulse page: a touch feels the pulse, others are here, words surface, and words can be let go', async ({ page, isMobile }) => {
  await mockApi(page, { first: true });
  await open(page, '#view=feature&item=angel&pulse=1');
  const p = page.locator('.an-pulse');
  await expect(p).toHaveAttribute('data-state', 'full');
  await expect(p.locator('.ap-touch-line')).toHaveText('Put your finger or your palm on the screen if things are hard right now.');
  const box = (await p.locator('.ap-touch').boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.6;
  if (isMobile) {
    await p.locator('.ap-touch').dispatchEvent('pointerdown', { pointerId: 7, pointerType: 'touch', clientX: x, clientY: y, width: 60, height: 60, isPrimary: true });
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
  }
  await expect(p.locator('.ap-touch')).toHaveAttribute('data-touching', '');
  // Lub-dub on the beats (vibrate is stubbed), and one stranger's word near the hand.
  await expect.poll(() => page.evaluate(() => (window as unknown as { __buzz: unknown[] }).__buzz.filter((b) => Array.isArray(b) && b.length === 3).length), { timeout: 6000 }).toBeGreaterThan(1);
  await expect(p.locator('.ap-word').first()).toBeAttached({ timeout: 6000 });
  // Three hands on screens, one of them this one.
  await expect(p.locator('.ap-others')).toHaveText('2 more here now');
  if (isMobile) await p.locator('.ap-touch').dispatchEvent('pointerup', { pointerId: 7, pointerType: 'touch', clientX: x, clientY: y });
  else await page.mouse.up();
  await expect(p.locator('.ap-touch')).not.toHaveAttribute('data-touching', '');

  // Words: the note about the check before the first send, then the delete code.
  await p.locator('.ap-say').scrollIntoViewIfNeeded();
  await expect(p.locator('.ap-checked')).toBeVisible();
  await p.locator('.ap-text').fill('I never told you');
  const sent = page.waitForRequest((r) => r.url().endsWith('/api/angel/words') && r.method() === 'POST');
  await p.locator('.ap-release').click();
  expect(JSON.parse((await sent).postData() ?? '{}')).toMatchObject({ text: 'I never told you', lang: 'en' });
  await expect(p.locator('.ap-said-line')).toHaveText('Your words are here.');
  await expect(p.locator('.ap-code')).toContainText('abc-def-ghi');
  await expect(p.locator('.ap-checked')).toBeHidden();
  // A pulse of one's own, and the last line.
  await expect(p.locator('.ap-own .ap-lead')).toHaveText('You can leave your pulse too.');
  await expect(p.locator('.ap-own-start')).toBeVisible();
  await expect(p.locator('.ap-last-line')).toHaveText('You are not alone.');
});

test('the pulse page in Russian', async ({ page }) => {
  await mockApi(page, { first: true });
  await open(page, '#view=feature&item=angel&lang=ru&pulse=1');
  const p = page.locator('.an-pulse');
  await expect(p.locator('.ap-touch-line')).toHaveText('Приложи палец или ладонь, если тебе сейчас тяжело.');
  await expect(p.locator('.ap-release')).toHaveText('Отпустить');
  await expect(p.locator('.ap-last-line')).toHaveText('Ты не один.');
});

test('the pulse page without the service shows only the last line', async ({ page }) => {
  await open(page, '#view=feature&item=angel&pulse=1');
  const p = page.locator('.an-pulse');
  await expect(p).toHaveAttribute('data-state', 'offline');
  await expect(p.locator('.ap-last-line')).toBeVisible();
  await expect(p.locator('.ap-touch')).toBeHidden();
  await expect(p.locator('.ap-say')).toBeHidden();
  await expect(p.locator('.ap-own')).toBeHidden();
});

test('the pulse page with an empty chorus: no pulse to feel, but words and a first pulse can be left', async ({ page }) => {
  await mockApi(page, { first: false });
  await open(page, '#view=feature&item=angel&pulse=1');
  const p = page.locator('.an-pulse');
  await expect(p).toHaveAttribute('data-state', 'empty');
  await expect(p.locator('.ap-touch')).toBeHidden();
  await expect(p.locator('.ap-say')).toBeVisible();
  await expect(p.locator('.ap-own-start')).toBeVisible();
});

test('strata: the layers stack and the clean line turns to noise', async ({ page }) => {
  await mockApi(page, { first: false });
  await open(page, '#view=feature&item=angel&scene=strata');
  const s = scene(page, 'strata');
  for (const k of ['bass', 'drums', 'voice', 'guitar']) await s.locator(`.an-stratum[data-stratum="${k}"]`).click();
  await expect(s).toHaveAttribute('data-stacked', '4');
  await expect(s.locator('.an-stratum[aria-pressed="true"]')).toHaveCount(4);
});

test('then and now: the slider moves the page from 1973 to 1998', async ({ page }) => {
  await mockApi(page, { first: false });
  await open(page, '#view=feature&item=angel&scene=then-now');
  const s = scene(page, 'then-now');
  await s.locator('.an-range').fill('100');
  await expect.poll(() => s.evaluate((e) => (e as HTMLElement).style.getPropertyValue('--tn'))).toBe('1.00');
  await expect(s.locator('.an-range')).toHaveAttribute('aria-valuetext', '1998');
});

test('the feature fits a phone: nothing runs off the side', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone layout');
  await mockApi(page, { first: true });
  await open(page);
  for (const id of SCENES) {
    await goToScene(page, id, 0.3);
    const over = await sheet(page).evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(over, id).toBeLessThanOrEqual(1);
  }
});

test('screenshots of every act and the pulse page', async ({ page, isMobile }) => {
  test.skip(!SHOTS, 'set ANGEL_SHOTS=<dir>');
  test.setTimeout(300_000);
  const name = isMobile ? 'phone' : 'desktop';
  await mockApi(page, { first: true, words: ['always', 'forgive me', 'I still hear you', 'come home', 'спасибо'] });
  await open(page);
  let k = 1;
  for (const id of SCENES) {
    for (const at of id === 'line' ? [0, 0.35] : id === 'then-now' ? [0.15, 0.85] : id === 'crowd' ? [0.2, 0.8] : [0.35]) {
      await goToScene(page, id, at);
      await page.waitForTimeout(2600);
      await page.screenshot({ path: `${SHOTS}/${name}-${String(k++).padStart(2, '0')}-${id}.png` });
    }
  }
  // A fresh page, as from the QR code.
  await page.goto('about:blank');
  await open(page, '#view=feature&item=angel&pulse=1');
  const p = page.locator('.an-pulse');
  await expect(p).toHaveAttribute('data-state', 'full');
  const box = (await p.locator('.ap-touch').boundingBox())!;
  await p.locator('.ap-touch').dispatchEvent('pointerdown', { pointerId: 3, pointerType: isMobile ? 'touch' : 'mouse', clientX: box.x + box.width / 2, clientY: box.y + box.height * 0.6, width: isMobile ? 70 : 1, height: isMobile ? 70 : 1, isPrimary: true });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/${name}-90-pulse-touch.png` });
  await p.locator('.ap-say').scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/${name}-91-pulse-words.png` });
  await p.locator('.ap-own').scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/${name}-92-pulse-own.png` });
});
