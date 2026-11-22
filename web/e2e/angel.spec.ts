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
async function mockApi(page: Page, opts: { first: boolean; words?: string[]; rr?: number[] } = { first: true }): Promise<void> {
  await page.route('**/api/angel/**', async (r) => {
    const url = new URL(r.request().url());
    const json = (body: unknown, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.endsWith('/pulses') && r.request().method() === 'GET') return json({ first: opts.first ? { id: 1, rr: opts.rr ?? RR } : null, others: [] });
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
  expect(new URL(page.url()).pathname).toBe('/features/angel/');
});

test('the language switches inside the feature and the reader stays in the scene', async ({ page }) => {
  await mockApi(page, { first: false });
  await open(page, '#view=feature&item=angel&scene=bristol');
  await expect(scene(page, 'bristol')).toContainText(LINES.bristol[0]);
  const btn = sheet(page).locator('.ft-lang');
  await expect(btn).toHaveText('RU');
  await btn.click();
  // The language is in the page's path now: /ru/features/angel/.
  await expect.poll(() => new URL(page.url()).pathname).toBe('/ru/features/angel/');
  await expect(feature(page)).toBeVisible();
  expect(page.url()).toContain('scene=bristol');
  await expect(scene(page, 'bristol')).toContainText(LINES.bristol[1]);
  await expect(sheet(page).locator('.ft-lang')).toHaveText('EN');
  await sheet(page).locator('.ft-lang').click();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/features/angel/');
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
      // The videos' covers come from YouTube, which these tests keep offline.
      if (id !== 'crowd' && id !== 'screens') await expect.poll(() => imgs.first().evaluate((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0), { message: id }).toBe(true);
      if (LINES[id]) await expect(scene(page, id).locator('.ft-flow'), id).toContainText(LINES[id][k]);
    }
    // The real photographs carry their credit and a link to their source.
    await expect(scene(page, 'voice').locator('.an-photo .an-photo-credit')).toContainText('Simon Schoeters');
    await expect(scene(page, 'voice').locator('.an-photo a[href*="commons.wikimedia.org"]')).toHaveCount(1);
  });
}

test('the other versions turn one at a time with the arrows', async ({ page }) => {
  await mockApi(page, { first: false });
  await open(page);
  await goToScene(page, 'afterlife', 0.6);
  const shelf = scene(page, 'afterlife').locator('.an-versions');
  await expect(shelf.locator('.an-video-cover')).toHaveCount(1);
  await expect(shelf.locator('.an-version-title')).toContainText('Horace Andy');
  await expect(shelf.locator('.an-version-count')).toHaveText('1 / 5');
  await shelf.locator('.an-version-turn').nth(1).click();
  await expect(shelf.locator('.an-version-title')).toContainText('Angel Dust');
  await expect(shelf.locator('.an-version-count')).toHaveText('2 / 5');
  await shelf.locator('.an-version-turn').nth(0).click();
  await shelf.locator('.an-version-turn').nth(0).click();
  await expect(shelf.locator('.an-version-title')).toContainText('Grian Chatten');
});

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

test('the warm screen leads into the ending below it', async ({ page }) => {
  await mockApi(page, { first: true });
  await open(page, '#view=feature&item=angel&scene=warm');
  await expect(scene(page, 'warm').locator('.an-invite-lead')).toHaveCount(0);
  await expect(feature(page).locator('.an-ending .an-pulse')).toBeAttached();
});

/** Hold a finger (or the mouse) on the touch area until released. */
async function hold(page: Page, isMobile: boolean): Promise<() => Promise<void>> {
  const t = page.locator('.an-pulse .ap-touch');
  await t.scrollIntoViewIfNeeded();
  const box = (await t.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.6;
  if (isMobile) await t.dispatchEvent('pointerdown', { pointerId: 7, pointerType: 'touch', clientX: x, clientY: y, width: 60, height: 60, isPrimary: true });
  else {
    await page.mouse.move(x, y);
    await page.mouse.down();
  }
  return async () => {
    if (isMobile) await t.dispatchEvent('pointerup', { pointerId: 7, pointerType: 'touch', clientX: x, clientY: y });
    else await page.mouse.up();
  };
}

test('the ending follows the device sequence through words to the finale', async ({ page, isMobile }) => {
  test.setTimeout(90_000);
  await mockApi(page, { first: true });
  await open(page, '#view=feature&item=angel&pulse=1');
  const p = page.locator('.an-pulse');
  await expect(p).toHaveAttribute('data-state', 'full');
  if (!isMobile) {
    // On a computer the pulse cannot be felt: the feel block is a calm centred
    // block — the words, a code that opens this ending on a phone — and the
    // words step opens at once, without pressing anything.
    await expect(p).toHaveAttribute('data-step', 'say');
    await expect(p.locator('.ap-say')).toBeVisible();
    await expect(p.locator('.ap-text')).toBeEditable();
    const desk = p.locator('.ap-touch.ap-desk');
    await expect(desk.locator('.ap-touch-step')).toHaveText('Someone’s pulse');
    await expect(desk.locator('.ap-touch-line')).toContainText('Point your phone');
    await expect(desk.locator('.ap-feel-qr svg')).toBeVisible();
    await expect(desk.locator('.ap-further')).toBeVisible();
    // No field, no sound, no own pulse on a computer.
    await expect(p.locator('.ap-sound')).toHaveCount(0);
    await expect(p.locator('.ap-own')).toHaveCount(0);
    await expect(p.locator('.ap-canvas')).toHaveCount(0);
    // Pressing the mouse on the block does nothing.
    const release = await hold(page, isMobile);
    await expect(p.locator('.ap-touch')).not.toHaveAttribute('data-touching', '');
    await release();
  } else {
    // On a phone the field stays: the way on appears after eight felt beats.
    await expect(p).toHaveAttribute('data-step', 'feel');
    await expect(p.locator('.ap-say')).toBeHidden();
    const release = await hold(page, isMobile);
    await expect(p.locator('.ap-touch')).toHaveAttribute('data-touching', '');
    // Lub-dub on the beats (vibrate is stubbed), a stranger's word near the hand, and the others here.
    await expect.poll(() => page.evaluate(() => (window as unknown as { __buzz: unknown[] }).__buzz.filter((b) => Array.isArray(b) && b.length === 3).length), { timeout: 6000 }).toBeGreaterThan(1);
    await expect(p.locator('.ap-word').first()).toBeAttached({ timeout: 6000 });
    await expect(p.locator('.ap-others')).toHaveText('2 more here now');
    await expect(p.locator('.ap-felt')).toContainText('Beats to go');
    // Eight beats do not advance the step by themselves: the button appears instead.
    await expect(p.locator('.ap-further')).toBeVisible({ timeout: 25_000 });
    await expect(p).toHaveAttribute('data-step', 'feel');
    await p.locator('.ap-further').click();
    await expect(p).toHaveAttribute('data-step', 'say');
    await release();
  }
  // The words others left are there before one's own.
  await expect(p.locator('.ap-cloud-word')).toHaveCount(2);
  await p.locator('.ap-text').fill('I never told you');
  const sent = page.waitForRequest((r) => r.url().endsWith('/api/angel/words') && r.method() === 'POST');
  await p.locator('.ap-release').click();
  expect(JSON.parse((await sent).postData() ?? '{}')).toMatchObject({ text: 'I never told you', lang: 'en' });
  await expect(p).toHaveAttribute('data-step', 'end');
  await expect(p.locator('.ap-end-count')).toHaveText('Unsaid words: 3.');
  await expect(p.locator('.ap-end .ap-code')).toContainText('abc-def-ghi');
  // One's own words stand in the cloud at once, whole.
  await expect(p.locator('.ap-cloud-word.ap-mine')).toHaveText('I never told you');
  await expect(p.locator('.ap-last-line')).toHaveText('You are not alone.');
  // ...and they are still there on this device after a reload.
  await page.reload();
  await expect(p).toHaveAttribute('data-state', 'full');
  await expect(p.locator('.ap-cloud-word.ap-mine')).toHaveText('I never told you');
});

test('surfacing words never overlap', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'the field is a phone only');
  // ~12 s of sampling plus loading the page; a busy machine needs the headroom.
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, { first: true, words: ['always', 'I miss you', 'forgive me', 'I still hear you', 'come home'] });
  await open(page, '#view=feature&item=angel&pulse=1');
  const p = page.locator('.an-pulse');
  await expect(p).toHaveAttribute('data-state', 'full');
  const release = await hold(page, isMobile);
  // Sample the surfaced words for ~12 s: at every sample the visible ones
  // must sit clear of one another.
  interface Box { x: number; y: number; w: number; h: number; o: number; t: string }
  const sample = () => page.evaluate(() =>
    [...document.querySelectorAll('.an-pulse .ap-word')].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, o: Number(getComputedStyle(el).opacity), t: el.textContent ?? '' };
    }),
  );
  const hit = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const seen = new Set<string>();
  const overlaps: string[] = [];
  for (let k = 0; k < 48; k++) {
    const up = (await sample()).filter((w) => w.o > 0.05);
    for (const w of up) seen.add(w.t);
    for (let i = 0; i < up.length; i++) for (let j = i + 1; j < up.length; j++) if (hit(up[i], up[j])) overlaps.push(`${up[i].t} × ${up[j].t}`);
    await page.waitForTimeout(250);
  }
  await release();
  expect(overlaps).toEqual([]);
  expect(seen.size).toBeGreaterThanOrEqual(3);
});

test('the ending in Russian', async ({ page, isMobile }) => {
  test.setTimeout(90_000);
  await mockApi(page, { first: true });
  await open(page, '#view=feature&item=angel&lang=ru&pulse=1');
  const p = page.locator('.an-pulse');
  await expect(p).toHaveAttribute('data-state', 'full');
  // The pulse is not listened to anywhere any more.
  await expect(p.getByRole('button', { name: 'Слушать пульс' })).toHaveCount(0);
  await expect(p.locator('.ap-touch-step')).toHaveText('Чужой пульс');
  if (!isMobile) await expect(p).toHaveAttribute('data-step', 'say');
  else {
    // The field stays until the way on is pressed, after eight felt beats.
    const release = await hold(page, isMobile);
    await expect(p.locator('.ap-further')).toBeVisible({ timeout: 25_000 });
    await expect(p).toHaveAttribute('data-step', 'feel');
    await p.locator('.ap-further').click();
    await expect(p).toHaveAttribute('data-step', 'say');
    await release();
  }
  await expect(p.locator('.ap-say .ap-step')).toHaveText('Слова');
  await expect(p.locator('.ap-release')).toHaveText('Отправить');
  await p.locator('.ap-text').fill('Я так и не сказал');
  await p.locator('.ap-release').click();
  await expect(p).toHaveAttribute('data-step', 'end');
  // Two cloud words plus one's own.
  await expect(p.locator('.ap-end-count')).toHaveText('Несказанных слов: 3.');
});

test('the ending without the service shows only the last line', async ({ page }) => {
  await open(page, '#view=feature&item=angel&pulse=1');
  const p = page.locator('.an-pulse');
  await expect(p).toHaveAttribute('data-state', 'offline');
  await expect(p.locator('.ap-last-line')).toBeVisible();
  await expect(p.locator('.ap-touch')).toBeHidden();
  await expect(p.locator('.ap-say')).toBeHidden();
});

test('an empty chorus starts at the first available step for the device', async ({ page }) => {
  await mockApi(page, { first: false });
  await open(page, '#view=feature&item=angel&pulse=1');
  const p = page.locator('.an-pulse');
  await expect(p).toHaveAttribute('data-state', 'empty');
  // Nothing to feel anywhere: both devices go straight to the words.
  await expect(p).toHaveAttribute('data-step', 'say');
  await expect(p.locator('.ap-touch')).toBeHidden();
  await expect(p.locator('.ap-say')).toBeVisible();
  await p.locator('.ap-say .ap-skip').click();
  await expect(p).toHaveAttribute('data-step', 'end');
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
  await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await mockApi(page, { first: true, words: ['always', 'forgive me', 'I still hear you', 'come home', 'спасибо'] });
  await open(page);
  let k = 1;
  for (const id of process.env.ANGEL_ENDING_ONLY ? [] : SCENES) {
    for (const at of id === 'line' ? [0, 0.35] : id === 'then-now' ? [0.15, 0.85] : id === 'crowd' ? [0.2, 0.8] : [0.35]) {
      await goToScene(page, id, at);
      await page.waitForTimeout(2600);
      await page.screenshot({ scale: 'css', path: `${SHOTS}/${name}-${String(k++).padStart(2, '0')}-${id}.png` });
    }
  }
  // The ending, from the start.
  await page.goto('about:blank');
  await open(page, '#view=feature&item=angel&pulse=1');
  const p = page.locator('.an-pulse');
  await expect(p).toHaveAttribute('data-state', 'full');
  if (!isMobile) {
    // The desk block, the words right below it, and the finale after a send.
    await page.waitForTimeout(900);
    await page.screenshot({ scale: 'css', path: `${SHOTS}/${name}-90-ending-feel.png` });
    await p.locator('.ap-further').click();
    await page.waitForTimeout(900);
    await page.screenshot({ scale: 'css', path: `${SHOTS}/${name}-92-ending-words.png` });
  } else {
    const release = await hold(page, isMobile);
    await page.waitForTimeout(2500);
    await page.screenshot({ scale: 'css', path: `${SHOTS}/${name}-90-ending-feel.png` });
    await expect(p.locator('.ap-further')).toBeVisible({ timeout: 25_000 });
    await p.locator('.ap-further').click();
    await release();
    await page.waitForTimeout(900);
    await page.screenshot({ scale: 'css', path: `${SHOTS}/${name}-92-ending-words.png` });
  }
  await p.locator('.ap-text').fill('I never told you how much that winter meant');
  await p.locator('.ap-release').click();
  await page.waitForTimeout(4200);
  await page.screenshot({ scale: 'css', path: `${SHOTS}/${name}-93-ending-end.png` });
});
