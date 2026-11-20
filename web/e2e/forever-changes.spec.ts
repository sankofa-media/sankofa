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

/** Open the feature: there is no door, it opens straight into the album. */
async function open(page: Page, hash = '#view=feature&item=forever-changes'): Promise<void> {
  await page.goto(`/${hash}`);
  await expect(feature(page)).toBeVisible();
}

async function goToScene(page: Page, id: string): Promise<void> {
  await scene(page, id).evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await expect.poll(() => page.url()).toContain(`scene=${id}`);
}

/** Nothing of the trip on screen: no layers, no melting, no swimming. */
async function expectNoTrip(page: Page): Promise<void> {
  for (const l of ['back', 'myc', 'over', 'vig']) await expect(feature(page).locator(`.fc-trip-${l}`)).toBeHidden();
  await expect(feature(page)).not.toHaveClass(/fx-trip|fx-swim/);
  for (const f of await feature(page).locator('.ft-scene.current .ft-stage .ft-art').evaluateAll((els) => els.map((e) => getComputedStyle(e).filter))) expect(f).not.toContain('url(');
  await expect(feature(page).locator('.fc-swap')).toHaveCount(0);
}

const opacity = (page: Page, l: string) => feature(page).locator(`.fc-trip-${l}`).evaluate((e) => (getComputedStyle(e).display === 'none' ? 0 : Number(getComputedStyle(e).opacity)));

const SCENES = ['warning', 'prologue', 'hillside', 'session-day', 'diary', 'orchestra', 'alone-again-or', 'a-house-is-not-a-motel', 'andmoreagain', 'the-daily-planet', 'old-man', 'the-red-telephone', 'flip', 'between-clark-and-hilldale', 'live-and-let-live', 'the-good-humor-man', 'bummer-in-the-summer', 'you-set-the-scene', 'after', 'return', 'end', 'echoes', 'lee'];

test('the list opens Forever Changes straight onto the album cover; back returns to the list', async ({ page }) => {
  await page.goto('/#view=features');
  const item = sheet(page).locator('[data-feature="forever-changes"]');
  await expect(item).toContainText('Forever Changes: the last words that were not the last');
  await item.click();
  await expect(feature(page)).toBeVisible();
  // No warning screen, no dialog, no calm switch: the first thing is the album's cover, then the title and Lee's epigraph.
  await expect(feature(page).locator('[role="dialog"]:visible')).toHaveCount(0);
  await expect(sheet(page).locator('.ft-calm')).toHaveCount(0);
  await expect(scene(page, 'warning').locator('.fc-cover:visible img')).toBeInViewport();
  await expect(scene(page, 'warning').locator('.fc-epigraph')).toContainText('my last words');
  const ids = await feature(page).locator('.ft-scene').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.scene));
  expect(ids).toEqual(SCENES);
  await expect(feature(page).locator('h1.ft-h1')).toContainText('Forever Changes');
  // Single-source stories never ship.
  expect(await page.evaluate(async () => JSON.stringify(await (await fetch('data/features/forever-changes.json')).json()))).not.toContain('Benny Goodman');
  await page.goBack();
  await expect(sheet(page).locator('.ft-list')).toBeVisible();
  await expect(feature(page)).toHaveCount(0);
});

test('the page decays song by song, peaks at The Red Telephone, and reduced motion stops it', async ({ page }) => {
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
  // The system asking for less motion stills it at once.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(feature(page)).not.toHaveClass(/fx-on/);
  await expect(feature(page)).toHaveAttribute('data-decay', '0');
  // The keyboard still scrolls: nothing holds the page.
  const before = await sheet(page).evaluate((el) => el.scrollTop);
  await sheet(page).focus();
  await page.keyboard.press('PageDown');
  await expect.poll(() => sheet(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(before);
});

test('with reduced motion the page stays still from the start', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await expect(feature(page)).toHaveClass(/is-calm/);
  await goToScene(page, 'the-red-telephone');
  await page.waitForTimeout(400);
  await expect(feature(page)).not.toHaveClass(/fx-on/);
  await expect(feature(page)).toHaveAttribute('data-decay', '0');
  await expectNoTrip(page);
  expect(await scene(page, 'the-red-telephone').locator('.ft-text').first().evaluate((e) => getComputedStyle(e).filter)).toBe('none');
  // The pictures stand finished: no ink wipe, no breathing.
  const al = scene(page, 'the-red-telephone').locator('.ft-art .al').first();
  expect(await al.evaluate((e) => getComputedStyle(e).maskImage)).toBe('none');
});

test('the red telephone rings no more than three times a second', async ({ page }) => {
  await open(page, '#view=feature&item=forever-changes&scene=the-red-telephone');
  await expect.poll(() => page.url()).toContain('scene=the-red-telephone');
  await expect(feature(page)).toHaveClass(/fx-on/);
  // Every change of light the page makes (a ring, a blink) is counted over four seconds.
  const changes = await feature(page).evaluate(
    (root) =>
      new Promise<number[]>((done) => {
        const at: number[] = [];
        const mo = new MutationObserver((ms) => {
          for (const m of ms) if (m.attributeName === 'class' && (root.classList.contains('fx-ring') !== (m.oldValue ?? '').includes('fx-ring'))) at.push(performance.now());
        });
        mo.observe(root, { attributes: true, attributeOldValue: true, attributeFilter: ['class'] });
        setTimeout(() => {
          mo.disconnect();
          done(at);
        }, 4000);
      }),
  );
  for (let i = 0; i < changes.length; i++) expect(changes.filter((t) => t >= changes[i] && t < changes[i] + 1000).length).toBeLessThanOrEqual(6);
});

test('the lenses: one witness at a time, the first listed first, and the switch crossfades', async ({ page }) => {
  await open(page, '#view=feature&item=forever-changes&scene=session-day');
  const sc = scene(page, 'session-day');
  const lens = sc.locator('.fc-lens');
  const group = lens.locator('[role="radiogroup"]');
  await expect(group).toHaveAttribute('aria-labelledby', 'lens-session-day');
  const order = await group.locator('[role="radio"]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.lens));
  expect(order.length).toBeGreaterThan(1);
  // The first witness listed speaks first, alone.
  await expect(group.locator(`[data-lens="${order[0]}"]`)).toHaveAttribute('aria-checked', 'true');
  await expect(lens.locator('.fc-voice:visible')).toHaveCount(1);
  await expect(lens.locator(`.fc-voice[data-voice="${order[0]}"]`)).toBeVisible();
  await lens.locator('.fc-lens-btn[data-lens="echols"]').click();
  await expect(sc).toHaveAttribute('data-lens', 'echols');
  await expect(lens.locator('.fc-lens-btn[data-lens="echols"]')).toHaveAttribute('aria-checked', 'true');
  await expect(lens.locator(`.fc-lens-btn[data-lens="${order[0]}"]`)).toHaveAttribute('aria-checked', 'false');
  // It crossfades, then one voice is left.
  expect(await lens.locator('.fc-voice[data-voice="echols"]').evaluate((e) => getComputedStyle(e).transitionProperty)).toContain('opacity');
  await expect(lens.locator('.fc-voice:visible')).toHaveCount(1);
  await expect(lens.locator('.fc-voice[data-voice="echols"]')).toBeVisible();
  await expect(lens.locator(`.fc-voice[data-voice="${order[0]}"]`)).toHaveAttribute('aria-hidden', 'true');
  // The keyboard: arrows move the choice; only the chosen one is in the tab order.
  await lens.locator('.fc-lens-btn[data-lens="echols"]').focus();
  await page.keyboard.press('ArrowRight');
  const next = order[(order.indexOf('echols') + 1) % order.length];
  await expect(lens.locator(`.fc-lens-btn[data-lens="${next}"]`)).toBeFocused();
  await expect(lens.locator(`.fc-lens-btn[data-lens="${next}"]`)).toHaveAttribute('aria-checked', 'true');
  expect(await group.locator('[role="radio"]').evaluateAll((els) => els.map((e) => (e as HTMLElement).tabIndex))).toEqual(order.map((id) => (id === next ? 0 : -1)));
  // The scene is restyled per lens.
  const font = () => sc.locator('.ft-flow > .ft-b-lede, .ft-flow > .ft-b-text').first().evaluate((e) => getComputedStyle(e).fontFamily);
  await lens.locator('.fc-lens-btn[data-lens="echols"]').click();
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
  await expect(orch.locator('.fc-voice:visible')).toHaveCount(1);
});

test('every chapter has its picture, and the pictures load scene by scene', async ({ page }) => {
  await open(page);
  // The opening shows the album's cover instead of a drawing.
  await expect(scene(page, 'warning').locator('.fc-cover img').first()).toBeAttached();
  for (const id of SCENES.filter((x) => x !== 'warning')) await expect(scene(page, id).locator('.ft-stage .ft-art .al').first(), id).toBeAttached();
  // Far chapters have not loaded theirs yet.
  expect(await scene(page, 'echoes').locator('.ft-art img').first().getAttribute('src')).toBeNull();
  await goToScene(page, 'echoes');
  await expect.poll(() => scene(page, 'echoes').locator('.ft-art img').first().evaluate((e) => (e as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  // People are described, never named, in the generated pictures.
  const alts = await feature(page).locator('.ft-art .al img').evaluateAll((els) => els.map((e) => (e as HTMLImageElement).alt).join(' '));
  expect(alts).not.toMatch(/Arthur|Lee\b|Echols|Botnick|MacLean/);
});

test('the prologue’s picture follows the text: Memphis, Dorsey High, the club, the Castle', async ({ page }) => {
  await open(page, '#view=feature&item=forever-changes&scene=prologue');
  const art = scene(page, 'prologue').locator('.ft-art');
  await expect(art).toHaveAttribute('data-state', 'memphis');
  // Each part shows once its block's top has come half way up the screen.
  for (const [block, state] of [['dorsey', 'dorsey'], ['byrds', 'love-named'], ['holzman', 'bido'], ['tour', 'castle']]) {
    await scene(page, 'prologue').locator(`.ft-flow > [data-block="${block}"]`).evaluate((el) => {
      el.closest('.ft-sheet')!.scrollTop += el.getBoundingClientRect().top - innerHeight * 0.5;
    });
    await expect(art).toHaveAttribute('data-state', state);
  }
  await goToScene(page, 'after');
  const after = scene(page, 'after').locator('.ft-art');
  await expect(after).toHaveAttribute('data-state', 'after');
  await scene(page, 'after').locator('.ft-flow > [data-block="prison"]').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await expect(after).toHaveAttribute('data-state', 'prison');
});

test('the opening shows the cover, the title, Lee\'s words and offers the mode at once', async ({ page, isMobile }) => {
  await page.goto('/#view=feature&item=forever-changes&lang=ru');
  const first = scene(page, 'warning');
  await expect(first.locator('.fc-cover:visible img')).toHaveJSProperty('complete', true);
  expect(await first.locator('.fc-cover:visible img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(200);
  await expect(first.locator('h1.ft-h1')).toContainText('Forever Changes');
  await expect(first.locator('.fc-cover-sub')).toContainText('Артура Ли');
  await expect(first.locator('.fc-epigraph-who')).toContainText('автор песен и солист группы Love');
  await first.locator('.fc-cover-go').click();
  if (isMobile) await expect(feature(page).locator('.fc-lee')).toHaveAttribute('data-state', 'warning');
  else await expect(feature(page).locator('.fc-lee-panel')).toBeVisible();
});

test('between the sides there is text, not a record to turn over', async ({ page }) => {
  await open(page, '#view=feature&item=forever-changes&scene=flip');
  await expect(scene(page, 'flip').locator('.fc-record, .fc-flip')).toHaveCount(0);
  await expect(scene(page, 'flip').locator('.ft-flow')).toContainText('Side two');
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
  page.on('request', (r) => asked.push(`${r.method()} ${r.url()}`));
  await mode.locator('.fc-lee-still').click();
  await expect(mode).toHaveAttribute('data-state', 'running');
  await expect(mode).toHaveAttribute('data-source', 'still');
  await expect(mode).toHaveAttribute('data-chapter', 'the-red-telephone');
  // The chapter's own vision comes first: the red telephone rings.
  await expect(mode.locator('.fc-lee-vision[data-object="telephone"]')).toBeAttached({ timeout: 9000 });
  expect(await page.evaluate(() => (window as unknown as { __cam: { asked: unknown[] } }).__cam.asked.length)).toBe(0);
  // Only the mode's own painted overlays are fetched, from the museum itself; nothing is sent.
  const own = new URL('media/features/forever-changes/lee-mode-', page.url()).href;
  expect(asked.filter((a) => !(a.startsWith('GET ') && a.slice(4).startsWith(own)))).toEqual([]);
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
  await expect(scene(page, 'old-man')).toBeVisible();
});

test('in Russian, everything visible is Russian', async ({ page }) => {
  await page.goto('/#view=feature&item=forever-changes&lang=ru');
  await expect(feature(page).locator('h1.ft-h1')).toContainText('последние слова, которые не стали последними');
  await expect(sheet(page).locator('.fc-menu-btn')).toHaveText('Главы');
  await expect(feature(page).locator('.fc-lee-pin')).toContainText('Ваша комната под ЛСД');
  await expect(feature(page).locator('.fc-lens-label').first()).toBeAttached();
  await goToScene(page, 'session-day');
  await expect(scene(page, 'session-day').locator('.fc-lens-btn[data-lens="botnick"]')).toHaveText('Брюс Ботник');
});

test('the songs play their official recordings in the docked player', async ({ page }) => {
  await open(page, '#view=feature&item=forever-changes&scene=the-red-telephone');
  await expect.poll(() => page.url()).toContain('scene=the-red-telephone');
  for (const id of ['alone-again-or', 'old-man', 'you-set-the-scene']) await expect(scene(page, id).locator('.fc-play')).toHaveCount(1);
  await expect(feature(page).locator('.fc-no-player')).toHaveCount(0);
  const play = scene(page, 'the-red-telephone').locator('.fc-play');
  await expect(play).toHaveAttribute('data-play', 'm_j0qicK9mc');
  await play.scrollIntoViewIfNeeded();
  await play.click();
  await expect(page.locator('.mp')).toBeVisible();
  await expect(page.locator('.mp-now b')).toContainText('The Red Telephone');
  await goToScene(page, 'echoes');
  await expect(scene(page, 'echoes').locator('.fc-play')).toHaveCount(3);
  await expect(scene(page, 'echoes').locator('.fc-play[data-play="VOzHnbwZIUo"]')).toContainText('The Damned');
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
  for (const id of SCENES) {
    await goToScene(page, id);
    const over = await sheet(page).evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(over, id).toBeLessThanOrEqual(1);
  }
});

test('screenshots of every chapter and the mode', async ({ page, isMobile }) => {
  test.skip(!SHOTS, 'set FC_SHOTS=<dir>');
  test.setTimeout(300_000);
  const name = isMobile ? 'phone' : 'desktop';
  await open(page);
  let k = 1;
  for (const id of SCENES) {
    for (const p of id === 'prologue' ? [0.05, 0.3, 0.55, 0.8] : id === 'after' ? [0.2, 0.7] : [0.35]) {
      await scene(page, id).evaluate((el, f) => {
        const s = el.closest('.ft-sheet')!;
        s.scrollTop = (el as HTMLElement).offsetTop + Math.max(0, el.scrollHeight - s.clientHeight) * f;
      }, p);
      await page.waitForTimeout(2600);
      await page.screenshot({ path: `${SHOTS}/${name}-${String(k++).padStart(2, '0')}-${id}.png` });
    }
  }
  await goToScene(page, 'the-red-telephone');
  await feature(page).locator('.fc-lee-pin').click();
  if (!isMobile) await feature(page).locator('.fc-lee-here').click();
  const mode = feature(page).locator('.fc-lee');
  await mode.locator(isMobile ? '.fc-lee-camera' : '.fc-lee-still').click();
  await expect(mode.locator('.fc-lee-vision[data-object="telephone"]')).toBeAttached({ timeout: 9000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/${name}-90-lee-running.png` });
});

test('the trip scales with the chapters: calm prologue, dark mushrooms, the peak, a breath, the reassembly', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page);
  await goToScene(page, 'prologue');
  await page.waitForTimeout(600);
  await expect(feature(page).locator('.fc-trip-back')).toBeHidden();
  expect(['webgl2', 'webgl', '2d']).toContain(await feature(page).getAttribute('data-trip-gl'));
  // A House Is Not a Motel: colour behind the page, mycelium from the edges.
  await goToScene(page, 'a-house-is-not-a-motel');
  await expect.poll(() => opacity(page, 'back'), { timeout: 15_000 }).toBeGreaterThan(0.5);
  await expect(feature(page).locator('.fc-trip-myc')).toBeVisible();
  await expect.poll(() => opacity(page, 'vig'), { timeout: 15_000 }).toBeGreaterThan(0.3);
  const house = await opacity(page, 'over');
  // The peak: everything at full, the page swims, the stage melts.
  await goToScene(page, 'the-red-telephone');
  await expect.poll(() => opacity(page, 'back'), { timeout: 15_000 }).toBeGreaterThan(0.95);
  await expect.poll(() => opacity(page, 'over'), { timeout: 15_000 }).toBeGreaterThan(house);
  await expect(feature(page)).toHaveClass(/fx-swim/);
  // The painted picture melts too.
  expect(await scene(page, 'the-red-telephone').locator('.ft-stage .ft-art').first().evaluate((e) => getComputedStyle(e).filter)).toContain('fc-melt-art');
  expect(await scene(page, 'the-red-telephone').locator('.ft-text').first().evaluate((e) => getComputedStyle(e).filter)).toContain('fc-flow-soft');
  expect(Number(await page.locator('#fc-flow-strong feDisplacementMap').getAttribute('scale'))).toBeGreaterThan(15);
  // Body text melts, but within its bound.
  expect(Number(await page.locator('#fc-flow-soft feDisplacementMap').getAttribute('scale'))).toBeLessThanOrEqual(5);
  // The frames keep coming, and words that swap come back as they were.
  const text = await scene(page, 'the-red-telephone').locator('.ft-flow').evaluate((e) => (e.textContent ?? '').replace(/\s+/g, ' '));
  await expect.poll(() => feature(page).getAttribute('data-trip-fps'), { timeout: 15_000 }).not.toBeNull();
  await page.waitForTimeout(5000);
  expect(await scene(page, 'the-red-telephone').locator('.ft-flow').evaluate((e) => (e.textContent ?? '').replace(/\s+/g, ' '))).toBe(text);
  // The keyboard still scrolls at the peak: nothing holds the page.
  const before = await sheet(page).evaluate((el) => el.scrollTop);
  await sheet(page).focus();
  await page.keyboard.press('PageDown');
  await expect.poll(() => sheet(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(before);
  // A breath: the dark recedes.
  await goToScene(page, 'the-good-humor-man');
  await expect.poll(() => opacity(page, 'back'), { timeout: 15_000 }).toBeLessThan(0.75);
  await expect.poll(() => opacity(page, 'vig'), { timeout: 15_000 }).toBeLessThan(0.2);
  // The reassembly: warm, then nothing by the end.
  await goToScene(page, 'you-set-the-scene');
  await expect.poll(async () => Number(await feature(page).evaluate((e) => e.style.getPropertyValue('--trip-warm') || 0)), { timeout: 15_000 }).toBeGreaterThan(0.3);
  await goToScene(page, 'after');
  await expect(feature(page).locator('.fc-trip-back')).toBeHidden({ timeout: 15_000 });
  // Reduced motion stops it all at once.
  await goToScene(page, 'the-red-telephone');
  await expect.poll(() => opacity(page, 'back'), { timeout: 15_000 }).toBeGreaterThan(0.5);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expectNoTrip(page);
});

test('the Arthur Lee shader runs on a stubbed camera and ramps into its phases', async ({ page, isMobile }) => {
  test.setTimeout(90_000);
  await page.clock.install();
  await page.goto('/#view=feature&item=forever-changes&scene=the-red-telephone&lee=1');
  const mode = feature(page).locator('.fc-lee');
  await expect(mode).toHaveAttribute('data-state', 'warning');
  await mode.locator(isMobile ? '.fc-lee-camera' : '.fc-lee-still').click();
  await expect(mode).toHaveAttribute('data-source', isMobile ? 'camera' : 'still');
  expect(['webgl2', 'webgl']).toContain(await mode.getAttribute('data-gl'));
  await expect.poll(async () => Number(await mode.getAttribute('data-frames')), { timeout: 8000 }).toBeGreaterThan(30);
  const lee = async () => Number(await mode.evaluate((e) => e.style.getPropertyValue('--lee')));
  expect(await lee()).toBeLessThan(0.1);
  await expect(mode).toHaveAttribute('data-phase', 'euphoric');
  // After the ramp: strong, and the phases come round, the bad stretch among them.
  await page.clock.fastForward(8 * 60_000);
  await expect.poll(lee, { timeout: 8000 }).toBeGreaterThan(0.9);
  const seen = new Set<string>();
  for (let k = 0; k < 12 && seen.size < 3; k++) {
    await page.clock.fastForward(10_000);
    await page.waitForTimeout(150);
    seen.add((await mode.getAttribute('data-phase')) ?? '');
  }
  expect([...seen].sort()).toEqual(['bad', 'euphoric', 'kaleidoscope']);
  // Many visions by now, never more than the scheduler allows at once.
  await expect.poll(() => mode.locator('.fc-lee-vision:not(.melt):not(.gone)').count()).toBeGreaterThan(0);
  const frames = Number(await mode.getAttribute('data-frames'));
  await expect.poll(async () => Number(await mode.getAttribute('data-frames')), { timeout: 8000 }).toBeGreaterThan(frames);
  await mode.locator('.fc-lee-exit').click();
  await expect(mode).toBeHidden();
});

test('with reduced motion the Arthur Lee picture holds still and nothing appears', async ({ page, isMobile }) => {
  test.skip(isMobile, 'one run is enough');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#view=feature&item=forever-changes&scene=the-red-telephone&lee=1');
  const mode = feature(page).locator('.fc-lee');
  await mode.locator('.fc-lee-still').click();
  await expect(mode).toHaveAttribute('data-calm', '');
  await page.waitForTimeout(5000);
  await expect(mode.locator('.fc-lee-vision')).toHaveCount(0);
  expect(Number(await mode.evaluate((e) => e.style.getPropertyValue('--lee')))).toBe(0);
});

/** The worst contrast of a block's type against what lies under it (95th percentile of the background), the type hidden while it is measured. */
async function contrastOf(page: Page, block: ReturnType<Page['locator']>): Promise<number> {
  const box = await block.boundingBox();
  if (!box) return Infinity;
  const ink = await block.evaluate((e) => {
    const t = e.querySelector('p, h2, blockquote') ?? e;
    const c = getComputedStyle(t).color;
    e.classList.add('fc-measure');
    return c;
  });
  const shot = await page.screenshot({ clip: { x: Math.max(0, box.x), y: Math.max(0, box.y), width: Math.min(box.width, page.viewportSize()!.width - box.x), height: Math.min(box.height, page.viewportSize()!.height - box.y) }, animations: 'disabled' });
  await block.evaluate((e) => e.classList.remove('fc-measure'));
  return page.evaluate(
    async ({ png, ink }) => {
      const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], { type: 'image/png' }));
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext('2d')!;
      g.drawImage(bmp, 0, 0);
      const px = g.getImageData(0, 0, bmp.width, bmp.height).data;
      const lin = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      const lum = (r: number, gg: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b);
      // The type's colour as the browser paints it (rgb, oklab or a mix).
      const one = new OffscreenCanvas(1, 1).getContext('2d')!;
      one.fillStyle = ink;
      one.fillRect(0, 0, 1, 1);
      const [r, gg, b] = one.getImageData(0, 0, 1, 1).data;
      const L = lum(r, gg, b);
      const ls: number[] = [];
      for (let i = 0; i < px.length; i += 16) ls.push(lum(px[i], px[i + 1], px[i + 2]));
      ls.sort((a, z) => a - z);
      const bg = L > 0.4 ? ls[Math.floor(ls.length * 0.95)] : ls[Math.floor(ls.length * 0.05)];
      return (Math.max(L, bg) + 0.05) / (Math.min(L, bg) + 0.05);
    },
    { png: shot.toString('base64'), ink },
  );
}

test('the type stays readable over the pictures and the trip at every level of decay', async ({ page }) => {
  test.setTimeout(180_000);
  await open(page);
  await page.addStyleTag({ content: '.fc-measure, .fc-measure * { color: transparent !important; text-shadow: none !important; -webkit-text-fill-color: transparent !important; caret-color: transparent !important; } .fc-measure a { text-decoration-color: transparent !important; }' });
  const worst: [string, number][] = [];
  for (const id of ['prologue', 'hillside', 'session-day', 'a-house-is-not-a-motel', 'the-daily-planet', 'the-red-telephone', 'between-clark-and-hilldale', 'live-and-let-live', 'bummer-in-the-summer', 'you-set-the-scene', 'end']) {
    await goToScene(page, id);
    const lede = scene(page, id).locator('.ft-flow > .ft-b-lede, .ft-flow > .ft-b-text').first();
    await lede.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(3500);
    worst.push([id, await contrastOf(page, lede)]);
  }
  for (const [id, c] of worst) expect(c, `${id}: ${c.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
});

test('the real photographs: whole, credited, in their chapters, and through the trip', async ({ page }) => {
  test.setTimeout(90_000);
  await open(page, '#view=feature&item=forever-changes&scene=prologue');
  const shot = async (n: string) => SHOTS && (await page.screenshot({ path: `${SHOTS}/${page.viewportSize()!.width > 800 ? 'desktop' : 'phone'}-${n}.png` }));
  const art = scene(page, 'prologue').locator('.ft-art');
  // Love named: the band in a 1966 concert advertisement.
  await scene(page, 'prologue').locator('.ft-flow > [data-block="byrds"]').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await expect(art).toHaveAttribute('data-state', 'love-named');
  const band = art.locator('.fc-photo[data-photo="love-1966-ad"]');
  await expect(band).toHaveClass(/al-on/);
  await expect(band).toHaveAttribute('aria-hidden', 'false');
  await expect.poll(() => band.locator('img').evaluate((e) => (e as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  expect(await band.locator('img').evaluate((e) => getComputedStyle(e).objectFit)).toBe('contain');
  await expect(band.locator('figcaption')).toContainText('Ken Forssi, Arthur Lee');
  await expect(band.locator('figcaption a')).toHaveAttribute('href', 'https://commons.wikimedia.org/wiki/File:Love_ad_1966.png');
  await page.waitForTimeout(1400);
  await shot('80-photo-love-1966');
  // The singles: Elektra's advertisement for “My Little Red Book”.
  await scene(page, 'prologue').locator('.ft-flow > [data-block="holzman"]').evaluate((el) => {
    const s = el.closest('.ft-sheet')!;
    const r = el.getBoundingClientRect();
    s.scrollTop += r.top + r.height * 0.6 - innerHeight * 0.55;
  });
  await expect(art).toHaveAttribute('data-state', 'red-book');
  await expect(art.locator('.fc-photo[data-photo="love-red-book-ad"]')).toHaveClass(/al-on/);
  await page.waitForTimeout(1400);
  await shot('81-photo-red-book');
  // The band of the album develops out of the session drawing.
  await goToScene(page, 'session-day');
  const dev = scene(page, 'session-day').locator('.fc-photo[data-photo="love-1967"]');
  await scene(page, 'session-day').evaluate((el) => {
    const s = el.closest('.ft-sheet')!;
    s.scrollTop = (el as HTMLElement).offsetTop + (el.scrollHeight - s.clientHeight) * 0.85;
  });
  await expect.poll(() => dev.evaluate((e) => Number(getComputedStyle(e).opacity))).toBeGreaterThan(0.9);
  await expect(dev.locator('figcaption')).toContainText('Love in 1967');
  // Photographs go through the trip with their chapter's picture.
  expect(await scene(page, 'session-day').locator('.ft-art').evaluate((e) => getComputedStyle(e).filter)).toContain('fc-melt-art');
  await page.waitForTimeout(1500);
  await shot('82-photo-love-1967');
  // Echols, still playing the album: author and licence linked.
  await goToScene(page, 'echoes');
  await scene(page, 'echoes').locator('.ft-flow > [data-block="screen"]').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const echols = scene(page, 'echoes').locator('.fc-photo[data-photo="echols-2019"]');
  await expect(echols).toHaveClass(/al-on/);
  await expect(echols.locator('figcaption')).toContainText('Ghmyrtle, CC BY-SA 4.0');
  await expect(echols.locator('figcaption a[href="https://creativecommons.org/licenses/by-sa/4.0/"]')).toHaveCount(1);
  await page.waitForTimeout(1400);
  await shot('83-photo-echols');
});
