import { test, expect } from '@playwright/test';
for (const language of ['en', 'ru']) for (const path of ['/', '/features/', '/features/angel/', '/features/sea-lion-girls/', '/features/forever-changes/', '/cards/sun-ra/', '/guide/', '/#view=atlas']) {
 test(`${language} feedback on ${path}`, async ({ page }, info) => {
  if (info.project.name === 'mobile') await page.setViewportSize({width:390,height:844});
  await page.route('**/*', route => new URL(route.request().url()).hostname === 'localhost' ? route.continue() : route.abort());
  let submission: any;
  let attempts = 0;
  await page.route('**/api/angel/feedback', async route => {
   submission = route.request().postDataJSON();
   attempts++;
   await route.fulfill({status: attempts === 1 ? 500 : 201, contentType:'application/json',body:'{}'});
  });
  await page.goto((language === 'ru' ? '/ru' : '') + path);
  if (path === '/features/') await expect(page.locator('.ft-list')).toBeVisible();
  if (path.startsWith('/features/') && path !== '/features/') await expect(page.locator(`[data-feature-id="${path.split('/')[2]}"]`)).toBeVisible();
  if (path.startsWith('/cards/')) await expect(page.locator('.drawer.on .card')).toBeVisible();
  if (path === '/guide/') await expect(page.locator('.mx-sheet.open')).toBeVisible();
  if (path.includes('view=atlas')) await expect(page.locator('.atlas.open')).toBeVisible();
  const label = language === 'ru' ? 'Предложить или поправить' : 'Suggest or correct';
  const host = path.startsWith('/features/') ? '.ft-sheet' : path.startsWith('/cards/') ? '.drawer.on .card' : path === '/guide/' ? '.mx-sheet.open' : path.includes('view=atlas') ? '.atlas.open' : '.mx-colophon';
  const button = page.locator(host).getByRole('button', {name:label,exact:true});
  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeVisible();
  await button.click();
  const dialog = page.getByRole('dialog', {name:language === 'ru' ? 'Написать музею' : 'Write to the museum',exact:true});
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(button).toBeFocused();
  await button.click();
  const contextURL = page.url();
  await dialog.locator('textarea').fill('A museum suggestion');
  await dialog.locator('input[type=text]').fill('reader@example.test');
  await dialog.getByRole('button', {name:language === 'ru' ? 'Отправить' : 'Send',exact:true}).click();
  await expect(dialog.getByRole('status')).toHaveText(language === 'ru' ? 'Сообщение не отправилось. Попробуйте ещё раз.' : 'The message did not go through. Try again.');
  await dialog.getByRole('button', {name:language === 'ru' ? 'Отправить' : 'Send',exact:true}).click();
  await expect(dialog.getByRole('status')).toHaveText(language === 'ru' ? 'Спасибо. Мы читаем каждое сообщение.' : 'Thank you. We read every message.');
  expect(submission).toMatchObject({kind:'correction',text:'A museum suggestion',contact:'reader@example.test',page:{language}});
  expect(submission.page.url).toBe(contextURL);
  if (path.includes('view=atlas')) expect(submission.page.view).toBe('atlas');
  if (path.startsWith('/cards/')) expect(submission.page.item).toBe('sun-ra');
  const close = dialog.getByRole('button', {name:language === 'ru' ? 'Закрыть' : 'Close',exact:true});
  await close.focus(); await page.keyboard.press('Tab');
  await expect(dialog.locator('a')).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
 });
}
