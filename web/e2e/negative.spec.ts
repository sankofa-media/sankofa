import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const scenes = ['glass','observer','caliper','form','river','own','chorus','versions','family','words','war','reverse-camera','door','final'];
async function jump(page: Page, id: string, progress = 0) {
  await page.locator(`[data-scene="${id}"]`).evaluate((el, p) => {
    const sheet = document.querySelector('.ft-sheet')!;
    sheet.scrollTop += el.getBoundingClientRect().top - sheet.getBoundingClientRect().top - 70 + (el.clientHeight - 200) * p;
  }, progress);
}
// The feature is built only while content/features/index.yaml lists it.
const listed = /^\s*-\s*negative\s*$/m.test(readFileSync(new URL('../../content/features/index.yaml', import.meta.url), 'utf8'));
test.skip(!listed, 'Negative is hidden from the site');
test.beforeEach(async ({ page }, info) => {
  await page.setViewportSize(info.project.name === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await page.route(/youtube|ytimg|googlevideo|embed.music.apple.com/, route => route.abort());
});
for (const lang of ['ru', 'en']) {
  test(`opens from the list and retains the scene beneath a dictionary card (${lang})`, async ({ page }) => {
    const prefix = lang === 'ru' ? '/ru' : '';
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${prefix}/features/`);
    await page.locator(`a[data-feature="negative"]`).click();
    await expect(page).toHaveURL(new RegExp(`${prefix}/features/negative/`));
    await expect(page.locator('.negative')).toBeVisible();
    const card = page.locator('[data-scene="versions"] a[data-card="gannibal"]').first();
    await card.scrollIntoViewIfNeeded();
    await card.evaluate(el => el.addEventListener('click', () => {
      (window as unknown as { scrollAtCard: number }).scrollAtCard = document.querySelector('.ft-sheet')!.scrollTop;
    }, { once: true, capture: true }));
    await card.click();
    await expect(page.locator('.drawer.on [data-card-id="gannibal"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.drawer.on')).toHaveCount(0);
    const before = await page.evaluate(() => (window as unknown as { scrollAtCard: number }).scrollAtCard);
    expect(await page.locator('.ft-sheet').evaluate(el => el.scrollTop)).toBeCloseTo(before, 0);
  });
}

test('development, calm mode, a single flip and all scene review images', async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.goto('/ru/features/negative/');
  const opening = page.locator('[data-picture="glass"]');
  await expect(opening).toHaveAttribute('data-stage', 'contour');
  const dir = process.env.NEGATIVE_SCREENSHOTS ?? join(homedir(), 'projects', 'negative-shots');
  await mkdir(dir, { recursive: true });
  await jump(page, 'glass', .3);
  await expect(opening).toHaveAttribute('data-stage', 'fills', { timeout: 10_000 });
  await jump(page, 'glass', 0);
  await expect.poll(() => opening.locator('.ng-fills').evaluate(el => Number(getComputedStyle(el).opacity))).toBeGreaterThan(.4);
  await expect(opening).not.toHaveAttribute('data-stage', 'full');
  await page.screenshot({ path: `${dir}/${info.project.name}-glass-mid.png`, scale: 'css' });
  await jump(page, 'glass', .8);
  await expect(opening).toHaveAttribute('data-stage', 'full', { timeout: 15_000 });
  await page.locator('.ng-calm').click();
  for (const id of scenes) {
    await jump(page, id, 0);
    const scene = page.locator(`[data-scene="${id}"]`);
    await expect(scene.locator('.ng-picture:visible')).toHaveAttribute('data-stage', 'full');
    await expect.poll(() => scene.locator('img[src]').evaluateAll(imgs => imgs.length > 0 && imgs.every(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0))).toBe(true);
    await expect(scene.locator('.ng-picture:visible > .ng-full')).toHaveCSS('opacity', '1');
    if (id === 'chorus') await expect(scene.locator('.ng-chorus')).toHaveAttribute('data-rows', '3');
    if (id === 'river') {
      await expect(scene.locator('.ng-map-pins')).toContainText('Адзюбжа');
      await expect(scene.locator('.ng-map-pins')).toContainText('Сухум');
    }
    await page.screenshot({ path: `${dir}/${info.project.name}-${id}.png`, scale: 'css' });
  }
  await expect(page.locator('.negative')).toHaveAttribute('data-flipped', 'true');
  await expect(page.locator('.negative')).toHaveAttribute('data-flip-count', '1');
  await jump(page, 'glass'); await jump(page, 'words');
  await expect(page.locator('.negative')).toHaveAttribute('data-flip-count', '1');
  await expect(page.locator('.ng-notes')).toBeHidden();
});

test('three real drags break the caliper; form forgets input; camera needs a gesture', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    (window as unknown as { cameraCalls: number }).cameraCalls = 0;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
      (window as unknown as { cameraCalls: number }).cameraCalls++;
      throw new DOMException('Denied', 'NotAllowedError');
    } });
  });
  const sent: string[] = [];
  page.on('request', r => sent.push(r.url() + (r.postData() ?? '')));
  await page.goto('/ru/features/negative/');
  await jump(page, 'caliper');
  const handle = page.locator('.ng-handle');
  for (let i = 1; i <= 3; i++) {
    const from = await handle.boundingBox();
    const to = await page.locator('[data-picture="caliper"]').boundingBox();
    if (!from || !to) throw new Error('Missing drag surface');
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width * .5, to.y + to.height * .55, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator('.ng-caliper')).toHaveAttribute('data-tries', String(i));
  }
  await expect(page.locator('[data-scene="caliper"] .ng-status')).toContainText('рассыпался');
  const input = page.locator('#negative-origin');
  await input.fill('negative-private-canary-913');
  await page.locator('.ng-form button').click();
  await expect(input).toHaveValue('');
  await expect(page.locator('.ng-answer')).toContainText('Абхазкой, конечно. Я здесь родилась и выросла. Это — мой дом...');
  await expect(page.locator('[data-picture="form-torn"]')).toBeVisible();
  expect(sent.join('')).not.toContain('negative-private-canary-913');
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))).not.toContain('negative-private-canary-913');
  await jump(page, 'reverse-camera');
  expect(await page.evaluate(() => (window as unknown as { cameraCalls: number }).cameraCalls)).toBe(0);
  await expect(page.locator('.ng-reflection')).toBeHidden();
  await page.getByRole('button', { name: 'Показать моё отражение' }).click();
  await expect(page.locator('[data-scene="reverse-camera"] .ng-status')).toContainText('Камера выключена');
  expect(await page.evaluate(() => (window as unknown as { cameraCalls: number }).cameraCalls)).toBe(1);
});

test('lenses respect disabled art and official players only start on request', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/features/negative/');
  await expect(page.locator('.ng-dock iframe, .mp iframe')).toHaveCount(0);
  await page.getByRole('button', { name: 'Shipwreck', exact: true }).click();
  await expect(page.locator('[data-scene="versions"] .ng-status')).toHaveText('Legend');
  await expect(page.locator('.ng-routes [data-route="1"]').first()).toBeHidden();
  await expect(page.locator('.ng-routes [data-route="2"]').first()).toBeVisible();
  await page.getByRole('button', { name: 'Colchians', exact: true }).click();
  await expect(page.locator('.ng-routes [data-route="3"]')).toHaveCount(0);
  await page.getByRole('button', { name: '4. Radeda', exact: true }).first().click();
  await expect(page.locator('.ng-dock iframe')).toHaveAttribute('src', /1691528666/);
  await page.getByRole('button', { name: '12. Wedding song', exact: true }).first().click();
  await expect(page.locator('.ng-dock iframe')).toHaveCount(1);
  await expect(page.locator('.ng-dock iframe')).toHaveAttribute('src', /1691528866/);
  await page.getByRole('button', { name: '9. Song of Ozbak II', exact: true }).first().click();
  await expect(page.locator('.ng-dock iframe')).toHaveAttribute('src', /1691528682/);
  await page.getByRole('button', { name: '21. Abkhaz wedding sequence', exact: true }).first().click();
  await expect(page.locator('.ng-dock iframe')).toHaveCount(0);
  await expect(page.locator('.mp iframe')).toHaveAttribute('src', /6OmxlX_dg-4/);
  await page.getByRole('button', { name: 'Watch Maxim Samarin’s film (2022)', exact: true }).click();
  await expect(page.locator('.mp iframe')).toHaveAttribute('src', /-C9ksZ0Z9T4/);
});

test('camera permission racing with scene exit cannot leave a stream running', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    const state = window as unknown as { resolveCamera: () => void; stoppedTracks: number };
    state.stoppedTracks = 0;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: () => new Promise(resolve => {
      state.resolveCamera = () => resolve({ getTracks: () => [{ stop: () => state.stoppedTracks++ }] });
    }) });
  });
  await page.goto('/features/negative/');
  await page.getByRole('button', { name: 'Show my reflection', exact: true }).click();
  await jump(page, 'door', .3);
  await expect(page).toHaveURL(/scene=door/);
  await page.evaluate(() => (window as unknown as { resolveCamera: () => void }).resolveCamera());
  await expect.poll(() => page.evaluate(() => (window as unknown as { stoppedTracks: number }).stoppedTracks)).toBe(1);
  await expect(page.locator('.ng-reflection')).toBeHidden();
});

test('failed development layer falls back to the complete picture', async ({ page }) => {
  await page.route(/observer-contour[^/]*\.(?:png|webp)/, route => route.abort());
  await page.goto('/features/negative/');
  await jump(page, 'observer');
  const picture = page.locator('[data-picture="observer"]');
  await expect(picture).toHaveClass(/ng-stage-failed/);
  await expect(picture).toHaveAttribute('data-stage', 'full');
  await expect(picture.locator('.ng-full')).toHaveCSS('opacity', '1');
  await expect.poll(() => picture.locator('.ng-full').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
});

test('all pictures finish after scrolling past their scenes without calm mode', async ({ page }) => {
  await page.goto('/features/negative/');
  for (const id of scenes) {
    await jump(page, id, .99);
    await page.waitForTimeout(100);
  }
  await expect.poll(() => page.locator('.ng-picture').evaluateAll(pictures => pictures.every(p => p.getAttribute('data-stage') === 'full')), { timeout: 15_000 }).toBe(true);
  await expect(page.locator('[data-scene="final"] .ft-title')).toHaveCount(0);
});


test('map names have readable labels and status on hover or tap', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/features/negative/');
  await jump(page, 'river');
  const pins = page.locator('.ng-map-pins');
  await expect(pins.getByRole('button', { name: 'Sukhum', exact: true })).toBeVisible();
  await expect(pins.getByRole('button', { name: 'Adzyubzha', exact: true })).toBeVisible();
  const place = page.locator('.ng-dotted details').first();
  if (info.project.name === 'mobile') await place.locator('summary').tap();
  else await place.locator('summary').hover();
  await expect(place.locator('p')).toBeVisible();
  await expect(place.locator('p')).toHaveText('Name from lists; not independently confirmed.');
});

for (const lang of ['ru', 'en']) {
  test(`reader notes send, translate, paginate and delete (${lang})`, async ({ page }, info) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    let submitted = false;
    let deleted = false;
    await page.route('**/api/angel/notes**', async route => {
      const req = route.request();
      if (req.method() === 'POST') {
        expect(req.postDataJSON()).toEqual({ text: 'У нас дома говорили на двух языках.', lang });
        submitted = true;
        await route.fulfill({ status: 202, json: { status: 'received', delete_code: 'family-delete-code' } });
      } else if (req.method() === 'DELETE') {
        expect(new URL(req.url()).searchParams.get('code')).toBe('family-delete-code');
        deleted = true;
        await route.fulfill({ json: { status: 'deleted' } });
      } else {
        const older = new URL(req.url()).searchParams.get('before') === '2';
        await route.fulfill({ json: { notes: deleted ? [] : [{ id: older ? 1 : 2, text: 'At home we spoke two languages.', lang: 'en', translation: lang === 'ru' ? (older ? 'Старая история.' : 'Дома говорили на двух языках.') : (older ? 'An older story.' : 'At home we spoke two languages.') }], next: older || deleted ? 0 : 2 } });
      }
    });
    await page.goto(`${lang === 'ru' ? '/ru' : ''}/features/negative/`);
    await jump(page, 'door');
    const notes = page.locator('.ng-notes');
    await expect(notes).toBeVisible();
    await expect(notes.locator('.ng-note')).toHaveText(lang === 'ru' ? 'Дома говорили на двух языках.' : 'At home we spoke two languages.');
    await notes.locator('textarea').fill('У нас дома говорили на двух языках.');
    await notes.locator('.ng-note-form button').click();
    await expect(notes.locator('code')).toHaveText('family-delete-code');
    expect(submitted).toBe(true);
    await expect(notes.locator('textarea')).toHaveValue('');
    if (lang === 'ru') {
      const dir = process.env.NEGATIVE_SCREENSHOTS ?? join(homedir(), 'projects', 'negative-shots');
      await mkdir(dir, { recursive: true });
      await notes.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${dir}/${info.project.name}-door-notes.png`, scale: 'css' });
      await notes.screenshot({ path: `${dir}/${info.project.name}-door-notes-detail.png`, scale: 'css' });
    }
    await notes.getByRole('button', { name: lang === 'ru' ? 'Ещё заметки' : 'More notes', exact: true }).click();
    await expect(notes.locator('.ng-note')).toHaveCount(2);
    await notes.locator('summary').click();
    await notes.locator('.ng-note-delete button').click();
    await expect(notes.locator('.ng-note-list')).toBeEmpty();
    expect(deleted).toBe(true);
  });
}

test('notes stay absent without the API while doors retain text and art', async ({ page }) => {
  await page.route('**/api/angel/notes**', route => route.fulfill({ status: 404, body: '<html>Not found</html>', contentType: 'text/html' }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/ru/features/negative/');
  await jump(page, 'door');
  await expect(page.locator('.ng-notes')).toBeHidden();
  await expect(page.locator('[data-scene="door"] .ng-picture')).toBeVisible();
  await expect(page.locator('[data-scene="door"] .ft-text').first()).toBeVisible();
});

test('held note has only an acknowledgement and code', async ({ page }) => {
  await page.route('**/api/angel/notes**', route => route.fulfill({
    status: route.request().method() === 'POST' ? 202 : 200,
    json: route.request().method() === 'POST' ? { status: 'received', delete_code: 'held-delete-code' } : { notes: [], next: 0 },
  }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/ru/features/negative/');
  await page.locator('#negative-note').fill('История семьи.');
  await page.locator('.ng-note-form button').click();
  await expect(page.locator('.ng-note-receipt')).toHaveText('Получено.Сохраните код удаления: held-delete-code');
  await expect(page.locator('.ng-note-list')).toBeEmpty();
});

test('bowl button is outside the tamada picture', async ({ page }) => {
  await page.goto('/ru/features/negative/');
  await expect(page.locator('.ng-picture .ng-tamada')).toHaveCount(0);
  await expect(page.locator('.ng-tamada')).toHaveCount(1);
});
