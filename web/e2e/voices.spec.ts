// The voices remembering slavery and a card's other recordings: everything
// plays in the docked player, one sound at a time. Nothing reaches the
// Library or the video host here: their requests are refused, and the voice's
// clock is driven by the test (the audio element's time is stubbed).
import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sankofa.edition', 'm'));
  await page.route(/^https:\/\/(tile\.loc\.gov|www\.youtube-nocookie\.com|i\.ytimg\.com)\//, (route) => route.abort());
});

const card = (page: Page, id: string) => page.locator(`.drawer.on article.card[data-card-id="${id}"]`);
const voice = (page: Page, id: string) => page.locator(`.drawer.on li.rec.voice[data-voice="${id}"]`);

/** Take over the docked audio's clock: returns a setter that moves it and tells the page. */
async function stubClock(page: Page): Promise<void> {
  await expect(page.locator('.mp audio')).toHaveCount(1);
  await page.evaluate(() => {
    const a = document.querySelector<HTMLAudioElement>('.mp audio')!;
    let t = 0;
    Object.defineProperty(a, 'currentTime', { configurable: true, get: () => t, set: (v: number) => void (t = v) });
    (window as unknown as { setClock: (v: number) => void }).setClock = (v) => {
      t = v;
      a.dispatchEvent(new Event('timeupdate'));
    };
  });
}
const setClock = (page: Page, t: number) => page.evaluate((v) => (window as unknown as { setClock: (v: number) => void }).setClock(v), t);
/** The text as the museum's typography sets it: typographer's apostrophes, non-breaking spaces. */
const like = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "['’]").replace(/ /g, '\\s')}$`);
const clockNow = (page: Page) => page.evaluate(() => document.querySelector<HTMLAudioElement>('.mp audio')!.currentTime);

test('a voice plays from the Library with its subtitles following, credited', async ({ page }) => {
  await page.goto('/#focus=wpa-narratives');
  await expect(card(page, 'wpa-narratives')).toBeVisible();
  const recs = page.locator('.drawer.on .recs');
  await expect(recs.locator('.recs-head')).toHaveText('Voices');
  await expect(recs.locator('li.rec.voice')).toHaveCount(3);
  const v = voice(page, 'laura-smalley');
  await expect(v.locator('.rec-badge')).toHaveText('voice');
  await expect(v.locator('.vp-line')).toHaveCount(8);
  await expect(v.locator('.vp-credit a').first()).toHaveAttribute('href', 'https://www.loc.gov/item/afc1941016_afs05496a/');
  await expect(v.locator('.vp-credit')).toContainText('Library of Congress');
  await expect(v.locator('.vp-credit')).toContainText('educational use');

  // By keyboard: the play button is a real button.
  await v.locator('.rec-play').focus();
  await page.keyboard.press('Enter');
  const mp = page.locator('.mp');
  await expect(mp).toBeVisible();
  await expect(mp.locator('.mp-now b')).toHaveText('Laura Smalley');
  await expect(mp.locator('audio')).toHaveAttribute('src', /^https:\/\/tile\.loc\.gov\/.*afc1941016_afs05496a\.mp3#t=579$/);
  await expect(mp.locator('audio track')).toHaveCount(2);
  await expect(mp.locator('audio track[default]')).toHaveAttribute('srclang', 'en');
  await expect(mp.locator('audio track[default]')).toHaveAttribute('src', 'data/voices/laura-smalley.en.vtt');
  await expect(v).toHaveClass(/\bon\b/);
  await expect(v).toHaveAttribute('aria-current', 'true');

  await stubClock(page);
  await setClock(page, 579.5);
  await expect(mp.locator('.mp-cue')).toHaveText(like("You know, and old master didn't tell you know, they was free."));
  await expect(v.locator('.vp-line.now')).toHaveAttribute('data-cue', '0');
  await setClock(page, 582.5);
  await expect(mp.locator('.mp-cue')).toHaveText(like("John Henry Faulk: He didn't tell you that?"));
  await expect(v.locator('.vp-line.now')).toHaveAttribute('data-cue', '1');
  await expect(v.locator('.vp-line.now button')).toHaveAttribute('aria-current', 'time');
  await setClock(page, 598);
  await expect(mp.locator('.mp-cue')).toHaveText(like('Colored folks—celebrates that day.'));
  await expect(v.locator('.vp-line.now')).toHaveAttribute('data-cue', '7');

  // The subtitle file itself is served for the <track>.
  const vtt = await page.request.get('/data/voices/laura-smalley.en.vtt');
  expect(vtt.ok()).toBe(true);
  expect(await vtt.text()).toMatch(/^WEBVTT/);
});

test('a click on a transcript line seeks the voice there', async ({ page }) => {
  await page.goto('/#focus=wpa-narratives');
  const v = voice(page, 'laura-smalley');
  await v.locator('.rec-play').click();
  await stubClock(page);
  await setClock(page, 580);
  const line = v.locator('.vp-line').nth(5);
  await expect(line).toContainText('nineteenth of June');
  await expect(line.locator('.vp-time')).toContainText('0:12');
  await line.locator('button').click();
  expect(await clockNow(page)).toBeCloseTo(591.62, 2);
  await expect(v.locator('.vp-line.now')).toHaveAttribute('data-cue', '5');
  await expect(page.locator('.mp .mp-cue')).toHaveText(like('And turn them loose on the nineteenth of June.'));

  // A line of a voice not yet playing starts that voice from the line.
  const h = voice(page, 'fountain-hughes');
  await h.locator('.vp-line').nth(3).locator('button').click();
  await expect(page.locator('.mp .mp-now b')).toHaveText('Fountain Hughes');
  await expect(h).toHaveClass(/\bon\b/);
  await expect(v).not.toHaveClass(/\bon\b/);
  await expect(v.locator('.vp-line.now')).toHaveCount(0);
  await expect(page.locator('.mp audio')).toHaveAttribute('src', /afc1950037_afs09990a\.mp3/);
  expect(await clockNow(page)).toBeCloseTo(1141.06, 2);
});

test('in Russian the voice speaks with Russian subtitles and a Russian transcript', async ({ page }) => {
  await page.goto('/#lang=ru&focus=wpa-narratives');
  await expect(card(page, 'wpa-narratives')).toBeVisible();
  const recs = page.locator('.drawer.on .recs');
  await expect(recs.locator('.recs-head')).toHaveText('Голоса');
  const v = voice(page, 'fountain-hughes');
  await expect(v.locator('.rec-badge')).toHaveText('голос');
  await expect(v.locator('.rec-title')).toHaveText('Фаунтин Хьюз');
  await expect(v.locator('.rec-src')).toContainText('11 июня 1949 года');
  await expect(v.locator('.rec-src')).toContainText('интервью: Хермонд Норвуд');
  await expect(v.locator('.vp-head')).toHaveText('Расшифровка');
  await expect(v.locator('.vp-transcript')).toHaveAttribute('lang', 'ru');
  await expect(v.locator('.vp-line').first()).toContainText('Цветным, кто теперь свободен');
  await expect(v.locator('.vp-credit')).toContainText('Библиотека Конгресса');
  await expect(v.locator('.rec-play')).toHaveAttribute('aria-label', 'Слушать: Фаунтин Хьюз');

  await v.locator('.rec-play').click();
  const mp = page.locator('.mp');
  await expect(mp.locator('audio track[default]')).toHaveAttribute('srclang', 'ru');
  await stubClock(page);
  await setClock(page, 1132.5);
  await expect(mp.locator('.mp-cue')).toHaveText(like('Цветным, кто теперь свободен, надо бы ох как быть благодарными.'));
  await expect(mp.locator('.mp-cue')).toHaveAttribute('lang', 'ru');
  await setClock(page, 1141.5);
  await expect(mp.locator('.mp-cue')).toContainText('Хермонд Норвуд: ');
  await expect(v.locator('.vp-line.now')).toHaveAttribute('data-cue', '3');
});

test('a card with several recordings leads with the official one and lists the others to play', async ({ page }) => {
  const listen = await (await page.request.get('/data/listen.json')).json();
  const recs = listen.cards.banjo as { kind: string; youtube: string; title: string }[];
  expect(recs[0].kind).toBe('official');
  expect(recs.filter((r) => r.kind === 'field')).toHaveLength(2);
  await page.goto('/#focus=banjo');
  const c = card(page, 'banjo');
  await expect(c).toBeVisible();
  await expect(c.locator('.card-listen > figure.lb')).toHaveCount(1);
  await expect(c.locator('.card-listen > figure.lb .lb-facade')).toHaveAttribute('aria-label', `Play “${recs[0].title}”`);
  const list = c.locator('.recs');
  await expect(list.locator('.recs-head')).toHaveText('More recordings');
  const items = list.locator('li.rec');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0).locator('.rec-badge')).toHaveText('field recording');
  await expect(items.nth(1).locator('.rec-title')).toHaveText(recs[2].title);
  await expect(items.nth(1).locator('.rec-note')).toContainText('fretless banjo');

  // The second of the others plays in the docked player, and the card's own block stays a poster.
  await items.nth(1).locator('.rec-play').click();
  const mp = page.locator('.mp');
  await expect(mp).toBeVisible();
  await expect(mp.locator('iframe.lb-frame')).toHaveAttribute('src', new RegExp(`/embed/${recs[2].youtube}\\?`));
  await expect(mp.locator('.mp-rec')).toHaveText(recs[2].title);
  await expect(items.nth(1)).toHaveClass(/\bon\b/);
  await expect(mp.locator('.mp-cue')).toBeHidden();
  // Next goes on down the card's list.
  await expect(mp.locator('.mp-next')).toBeDisabled();

  // One sound at a time: the card's official block takes over from the docked player.
  await c.locator('.card-listen > figure.lb .lb-facade').click();
  await expect(c.locator('.card-listen > figure.lb iframe')).toHaveCount(1);
  await expect(mp.locator('iframe')).toHaveCount(0);
  await expect(items.nth(1)).not.toHaveClass(/\bon\b/);
});

test('in Russian the other recordings carry Russian badges and notes', async ({ page }) => {
  await page.goto('/#lang=ru&focus=banjo');
  const items = card(page, 'banjo').locator('.recs li.rec');
  await expect(card(page, 'banjo').locator('.recs-head')).toHaveText('Другие записи');
  await expect(items.nth(0).locator('.rec-badge')).toHaveText('полевая запись');
  await expect(items.nth(0).locator('.rec-note')).toHaveAttribute('lang', 'ru');
  await expect(items.nth(0).locator('.rec-note')).toContainText('Сида Хемпхилла');
});

test('on a phone the voices fit the card and the subtitles show above the controls', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'the phone layout');
  await page.goto('/#focus=wpa-narratives');
  const v = voice(page, 'billy-mccrea');
  await v.scrollIntoViewIfNeeded();
  const drawer = page.locator('.drawer.on');
  expect(await drawer.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await v.locator('.rec-play').click();
  await stubClock(page);
  await setClock(page, 190);
  const cue = page.locator('.mp .mp-cue');
  await expect(cue).toHaveText(like('And the Yankees had come,'));
  const box = await cue.boundingBox();
  const vw = page.viewportSize()!.width;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vw);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
