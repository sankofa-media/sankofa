import { expect, test, type Page } from '@playwright/test';

const SHOTS = process.env.FC_SHOTS;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sankofa.edition', 'm');
    localStorage.setItem('sankofa.navlegend', '1');
    // The camera is never opened in a test: a painted canvas stands in for it.
    const w = window as unknown as { __cam: { asked: unknown[]; stopped: number } };
    w.__cam = { asked: [], stopped: 0 };
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia = async (c?: MediaStreamConstraints) => {
        w.__cam.asked.push(JSON.parse(JSON.stringify(c ?? {})));
        const cv = document.createElement('canvas');
        cv.width = 320;
        cv.height = 240;
        const g = cv.getContext('2d')!;
        let t = 0;
        setInterval(() => {
          t++;
          g.fillStyle = '#334';
          g.fillRect(0, 0, 320, 240);
          g.fillStyle = '#e8b33a';
          g.fillRect(40 + (t % 200), 80, 60, 60);
        }, 60);
        const stream = cv.captureStream(15);
        for (const tr of stream.getTracks()) {
          const stop = tr.stop.bind(tr);
          tr.stop = () => {
            w.__cam.stopped++;
            stop();
          };
        }
        return stream;
      };
    }
  });
  await page.route(/youtube|ytimg|googlevideo|tile\.loc\.gov/, (r) => r.abort());
});

const sheet = (page: Page) => page.locator('.ft-sheet:not([hidden])');
const feature = (page: Page) => sheet(page).locator('article.ft[data-feature-id="forever-changes"]');
const scene = (page: Page, id: string) => feature(page).locator(`[data-scene="${id}"]`);

async function open(page: Page, hash = '#view=feature&item=forever-changes', choice: 'full' | 'calm' | null = 'full'): Promise<void> {
  await page.goto(`/${hash}`);
  await expect(feature(page)).toBeVisible();
  if (choice) await feature(page).locator(`.fc-gate-${choice}`).click();
  await expect(feature(page).locator('.fc-gate')).toHaveCount(choice ? 0 : 1);
}

async function goToScene(page: Page, id: string): Promise<void> {
  await scene(page, id).evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await expect.poll(() => page.url()).toContain(`scene=${id}`);
}

const SCENES = ['warning', 'prologue', 'hillside', 'session-day', 'diary', 'orchestra', 'alone-again-or', 'a-house-is-not-a-motel', 'andmoreagain', 'the-daily-planet', 'old-man', 'the-red-telephone', 'flip', 'between-clark-and-hilldale', 'live-and-let-live', 'the-good-humor-man', 'bummer-in-the-summer', 'you-set-the-scene', 'after', 'return', 'end', 'echoes', 'lee'];

test('the list opens Forever Changes, behind a warning; back returns to the list', async ({ page }) => {
  await page.goto('/#view=features');
  const item = sheet(page).locator('[data-feature="forever-changes"]');
  await expect(item).toContainText('Forever Changes: the last words that were not the last');
  await item.click();
  await expect(feature(page)).toBeVisible();
  await expect(feature(page).locator('.fc-gate')).toBeVisible();
  await expect(feature(page).locator('.fc-gate h2')).not.toBeEmpty();
  await feature(page).locator('.fc-gate-full').click();
  const ids = await feature(page).locator('.ft-scene').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.scene));
  expect(ids).toEqual(SCENES);
  await expect(feature(page).locator('h1.ft-h1')).toContainText('Forever Changes');
  // Single-source stories never ship.
  expect(await page.evaluate(async () => JSON.stringify(await (await fetch('data/features/forever-changes.json')).json()))).not.toContain('Benny Goodman');
  await page.goBack();
  await expect(sheet(page).locator('.ft-list')).toBeVisible();
  await expect(feature(page)).toHaveCount(0);
});

test('choosing calm at the door: no decay anywhere, even at the peak', async ({ page }) => {
  await open(page, '#view=feature&item=forever-changes', 'calm');
  await expect(sheet(page).locator('.ft-calm')).toHaveAttribute('aria-pressed', 'true');
  await goToScene(page, 'the-red-telephone');
  await page.waitForTimeout(400);
  await expect(feature(page)).not.toHaveClass(/fx-on/);
  await expect(feature(page)).toHaveAttribute('data-decay', '0');
  const filter = await scene(page, 'the-red-telephone').locator('.ft-title').evaluate((e) => getComputedStyle(e).filter);
  expect(filter).toBe('none');
  // The door is not shown again in this session.
  await page.reload();
  await expect(feature(page)).toBeVisible();
  await expect(feature(page).locator('.fc-gate')).toHaveCount(0);
});

test('as it is: the page decays song by song, peaks at The Red Telephone, and the calm switch stops it', async ({ page }) => {
  await open(page);
  await goToScene(page, 'prologue');
  await expect(feature(page)).toHaveAttribute('data-decay', '0');
  await goToScene(page, 'the-red-telephone');
  await expect(feature(page)).toHaveClass(/fx-on/);
  await expect(feature(page)).toHaveClass(/fx-watching/);
  await expect(feature(page)).toHaveAttribute('data-decay', '10');
  const title = scene(page, 'the-red-telephone').locator('.ft-title');
  expect(await title.evaluate((e) => getComputedStyle(e).filter)).toContain('fc-flow-strong');
  expect(await title.evaluate((e) => getComputedStyle(e).textShadow)).not.toBe('none');
  // The text stays text: still readable to the page.
  await expect(title).toHaveText('The Red Telephone');
  await expect(scene(page, 'the-red-telephone').locator('.fc-watch')).toBeVisible();
  // A breath in The Good Humor Man.
  await goToScene(page, 'the-good-humor-man');
  await expect.poll(async () => Number(await feature(page).getAttribute('data-decay'))).toBeLessThan(5);
  await goToScene(page, 'bummer-in-the-summer');
  await expect.poll(async () => Number(await feature(page).getAttribute('data-decay'))).toBeGreaterThan(5);
  // The progress bar always tells screen readers the truth.
  const bar = feature(page).locator('.fc-progress');
  expect(Number(await bar.getAttribute('aria-valuenow'))).toBeGreaterThan(40);
  // Calm at any time.
  await sheet(page).locator('.ft-calm').click();
  await expect(feature(page)).not.toHaveClass(/fx-on/);
  await expect(feature(page)).toHaveAttribute('data-decay', '0');
  // The keyboard still scrolls: nothing holds the page.
  const before = await sheet(page).evaluate((el) => el.scrollTop);
  await sheet(page).focus();
  await page.keyboard.press('PageDown');
  await expect.poll(() => sheet(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(before);
});

test('with reduced motion, "as it is" still stays calm', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#view=feature&item=forever-changes');
  await expect(feature(page).locator('.fc-gate-reduced')).toBeVisible();
  await feature(page).locator('.fc-gate-full').click();
  await goToScene(page, 'the-red-telephone');
  await page.waitForTimeout(400);
  await expect(feature(page)).not.toHaveClass(/fx-on/);
  await expect(feature(page)).toHaveAttribute('data-decay', '0');
});

test('the lenses: the session players’ day through three witnesses, none declared right', async ({ page }) => {
  await open(page, '#view=feature&item=forever-changes&scene=session-day');
  const sc = scene(page, 'session-day');
  const lens = sc.locator('.fc-lens');
  await expect(lens).toHaveClass(/differ/);
  for (const id of ['botnick', 'echols', 'stuart-ware']) await expect(lens.locator(`.fc-lens-btn[data-lens="${id}"]`)).toBeVisible();
  await lens.locator('.fc-lens-btn[data-lens="echols"]').click();
  await expect(sc).toHaveAttribute('data-lens', 'echols');
  await expect(lens.locator('.fc-lens-btn[data-lens="echols"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(lens.locator('.fc-voice[data-voice="echols"]')).toHaveClass(/is-on/);
  // Every version stays on the page.
  for (const id of ['botnick', 'echols', 'stuart-ware']) await expect(lens.locator(`.fc-voice[data-voice="${id}"]`)).toBeVisible();
  await expect(lens.locator('.fc-lens-hint')).toBeVisible();
  // The scene is restyled per lens.
  const font = () => sc.locator('.ft-flow > .ft-b-lede, .ft-flow > .ft-b-text').first().evaluate((e) => getComputedStyle(e).fontFamily);
  const echolsFont = await font();
  await lens.locator('.fc-lens-btn[data-lens="botnick"]').click();
  await expect(sc).toHaveAttribute('data-lens', 'botnick');
  expect(await font()).not.toBe(echolsFont);
  // David Angel did not tell: an empty lens.
  await goToScene(page, 'orchestra');
  const orch = scene(page, 'orchestra').locator('.fc-lens');
  await orch.locator('.fc-lens-btn[data-lens="angel"]').click();
  await expect(orch.locator('.fc-voice[data-voice="angel"] .fc-voice-silence')).toContainText('David Angel');
  await expect(orch.locator('.fc-voice[data-voice="angel"] .ft-block')).toHaveCount(0);
});

test('the record turns over between the sides, and everything stops for a moment', async ({ page }) => {
  await open(page, '#view=feature&item=forever-changes&scene=flip');
  const rec = scene(page, 'flip').locator('.fc-record');
  await expect(rec).toHaveAttribute('data-side', 'a');
  await expect(rec.locator('.fc-a li')).toHaveCount(6);
  await scene(page, 'flip').locator('.fc-flip').click();
  await expect(rec).toHaveAttribute('data-side', 'b');
  await expect(feature(page)).toHaveAttribute('data-frozen', '');
  await expect(rec.locator('.fc-b li')).toHaveCount(5);
  await expect(rec.locator('.fc-b')).toContainText('You Set the Scene');
  await expect(feature(page)).not.toHaveAttribute('data-frozen', '', { timeout: 3000 });
});

test('the Arthur Lee button is pinned in every chapter', async ({ page }) => {
  await open(page);
  const pin = feature(page).locator('.fc-lee-pin');
  for (const id of SCENES) {
    await scene(page, id).evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await expect(pin, id).toBeInViewport();
  }
});

test('on a computer: a QR code for the phone at this chapter, and the mode over a still picture', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop flow');
  await open(page, '#view=feature&item=forever-changes&scene=the-red-telephone');
  await expect.poll(() => page.url()).toContain('scene=the-red-telephone');
  await feature(page).locator('.fc-lee-pin').click();
  const panel = feature(page).locator('.fc-lee-panel');
  await expect(panel).toBeVisible();
  const url = await panel.locator('svg.fc-qr').getAttribute('data-url');
  expect(url).toMatch(/#view=feature&item=forever-changes&scene=the-red-telephone&lee=1$/);
  await expect(panel.locator('svg.fc-qr path')).toHaveAttribute('d', /^M/);
  // Nothing leaves the page while the mode runs.
  const asked: string[] = [];
  await panel.locator('.fc-lee-here').click();
  const mode = feature(page).locator('.fc-lee');
  await expect(mode).toHaveAttribute('data-state', 'warning');
  await expect(mode.locator('.fc-lee-privacy')).toBeVisible();
  // A computer offers the still picture only.
  await expect(mode.locator('.fc-lee-camera')).toHaveCount(0);
  page.on('request', (r) => asked.push(r.url()));
  await mode.locator('.fc-lee-still').click();
  await expect(mode).toHaveAttribute('data-state', 'running');
  await expect(mode).toHaveAttribute('data-source', 'still');
  await expect(mode).toHaveAttribute('data-chapter', 'the-red-telephone');
  // The chapter's own vision comes first: the red telephone rings.
  await expect(mode.locator('.fc-lee-vision[data-object="telephone"]')).toBeAttached({ timeout: 9000 });
  expect(await page.evaluate(() => (window as unknown as { __cam: { asked: unknown[] } }).__cam.asked.length)).toBe(0);
  expect(asked).toEqual([]);
  // Escape closes the mode, not the feature behind it.
  await page.keyboard.press('Escape');
  await expect(mode).toBeHidden();
  await expect(feature(page)).toBeVisible();
});

test('on a phone: the button opens the mode, the camera runs on the device, and the exit stops it', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone flow');
  await open(page, '#view=feature&item=forever-changes&scene=the-daily-planet');
  await expect.poll(() => page.url()).toContain('scene=the-daily-planet');
  await feature(page).locator('.fc-lee-pin').click();
  const mode = feature(page).locator('.fc-lee');
  await expect(mode).toHaveAttribute('data-state', 'warning');
  await expect(mode.locator('.fc-lee-exit')).toBeVisible();
  await mode.locator('.fc-lee-camera').click();
  await expect(mode).toHaveAttribute('data-source', 'camera');
  await expect(mode).toHaveAttribute('data-chapter', 'the-daily-planet');
  const asked = await page.evaluate(() => (window as unknown as { __cam: { asked: { audio?: boolean; video?: unknown }[] } }).__cam.asked);
  expect(asked).toHaveLength(1);
  expect(asked[0].audio).toBe(false);
  await expect(mode.locator('.fc-lee-vision[data-object="newspaper"]')).toBeAttached({ timeout: 9000 });
  await expect(mode.locator('.fc-lee-exit')).toBeVisible();
  await mode.locator('.fc-lee-exit').click();
  await expect(mode).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as { __cam: { stopped: number } }).__cam.stopped)).toBeGreaterThan(0);
  await expect(feature(page)).toBeVisible();
});

test('the QR link opens the mode at its chapter', async ({ page }) => {
  await page.goto('/#view=feature&item=forever-changes&scene=old-man&lee=1');
  const mode = feature(page).locator('.fc-lee');
  await expect(mode).toHaveAttribute('data-state', 'warning');
  await expect(mode).toHaveAttribute('data-chapter', 'old-man');
  await mode.locator('.fc-lee-exit').click();
  await expect(mode).toBeHidden();
  await expect(feature(page).locator('.fc-gate')).toBeVisible();
});

test('in Russian, everything visible is Russian', async ({ page }) => {
  await page.goto('/#view=feature&item=forever-changes&lang=ru');
  await expect(feature(page).locator('.fc-gate-full')).toHaveText('Как есть');
  await feature(page).locator('.fc-gate-full').click();
  await expect(feature(page).locator('h1.ft-h1')).toContainText('последние слова, которые не стали последними');
  await expect(sheet(page).locator('.fc-menu-btn')).toHaveText('Главы');
  await expect(feature(page).locator('.fc-lee-pin')).toContainText('Артура Ли');
  await goToScene(page, 'session-day');
  await expect(scene(page, 'session-day').locator('.fc-lens-btn[data-lens="botnick"]')).toHaveText('Брюс Ботник');
});

test('the chapter menu goes to a chapter', async ({ page }) => {
  await open(page);
  await sheet(page).locator('.fc-menu-btn').click();
  await sheet(page).locator('.fc-menu-item[data-go="echoes"]').click();
  await expect.poll(() => page.url()).toContain('scene=echoes');
  await expect(sheet(page).locator('.fc-menu')).toBeHidden();
});

test('a dictionary link opens its card over the longread and returns to the same scene', async ({ page }) => {
  await open(page, '#view=feature&item=forever-changes&scene=prologue');
  await expect.poll(() => page.url()).toContain('scene=prologue');
  const link = scene(page, 'prologue').locator('a.xref[data-card="rhythm-and-blues"]').first();
  await link.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const at = page.url().match(/scene=([a-z-]+)/)?.[1];
  await link.click();
  await expect(page.locator('.drawer.on article.card[data-card-id="rhythm-and-blues"]')).toBeVisible();
  const top = await sheet(page).evaluate((el) => el.scrollTop);
  await page.keyboard.press('Escape');
  await expect(page.locator('.drawer.on')).toHaveCount(0);
  await expect(feature(page)).toBeVisible();
  expect(page.url()).toContain(`scene=${at}`);
  expect(await sheet(page).evaluate((el) => el.scrollTop)).toBe(top);
});

test('the feature fits a phone: nothing runs off the side', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone layout');
  await open(page);
  for (const id of ['warning', 'prologue', 'session-day', 'orchestra', 'the-red-telephone', 'flip', 'after', 'return', 'lee']) {
    await goToScene(page, id);
    const over = await sheet(page).evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(over, id).toBeLessThanOrEqual(1);
  }
});

test('screenshots of the key chapters and the mode', async ({ page, isMobile }) => {
  test.skip(!SHOTS, 'set FC_SHOTS=<dir>');
  test.setTimeout(120_000);
  const name = isMobile ? 'phone' : 'desktop';
  await page.goto('/#view=feature&item=forever-changes');
  await expect(feature(page).locator('.fc-gate')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/${name}-00-warning.png` });
  await feature(page).locator('.fc-gate-full').click();
  const shots: [string, number][] = [['warning', 0], ['prologue', 0.3], ['hillside', 0.5], ['session-day', 0.6], ['diary', 0.5], ['orchestra', 0.6], ['a-house-is-not-a-motel', 0.5], ['the-daily-planet', 0.5], ['the-red-telephone', 0.4], ['flip', 0.6], ['live-and-let-live', 0.3], ['the-good-humor-man', 0.5], ['you-set-the-scene', 0.9], ['after', 0.3], ['return', 0.8], ['end', 0.5], ['lee', 0.5]];
  let k = 1;
  for (const [id, p] of shots) {
    await scene(page, id).evaluate((el, f) => {
      const s = el.closest('.ft-sheet')!;
      s.scrollTop = (el as HTMLElement).offsetTop + Math.max(0, el.scrollHeight - s.clientHeight) * f;
    }, p);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}/${name}-${String(k++).padStart(2, '0')}-${id}.png` });
  }
  await goToScene(page, 'the-red-telephone');
  await feature(page).locator('.fc-lee-pin').click();
  if (!isMobile) {
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/${name}-30-lee-qr.png` });
    await feature(page).locator('.fc-lee-here').click();
  }
  const mode = feature(page).locator('.fc-lee');
  await page.screenshot({ path: `${SHOTS}/${name}-31-lee-warning.png` });
  await mode.locator(isMobile ? '.fc-lee-camera' : '.fc-lee-still').click();
  await expect(mode.locator('.fc-lee-vision[data-object="telephone"]')).toBeAttached({ timeout: 9000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/${name}-32-lee-running.png` });
});
