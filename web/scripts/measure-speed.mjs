// Cold-cache measurements against vite preview, using Chromium's wire counter.
// PORT=4173 [FEATURE=sea-lion-girls] node scripts/measure-speed.mjs
// MODE=visits measures museum repeat visits and language switches with cache enabled.
import { chromium } from '@playwright/test';
const feature = process.env.FEATURE;
const visits = process.env.MODE === 'visits';
if (visits && feature) throw new Error('MODE=visits is only supported for the museum');
if (feature && !/^[a-z0-9-]+$/.test(feature)) throw new Error('Invalid feature id');
const browser = await chromium.launch({ headless: true });
for (const language of ['en', 'ru']) {
  const context = await browser.newContext({ locale: language, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: !visits });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 100, downloadThroughput: 100 * 1024, uploadThroughput: 100 * 1024 });
  let bytes = 0;
  const requests = new Map();
  cdp.on('Network.requestWillBeSent', e => requests.set(e.requestId, { url: e.request.url, bytes: 0 }));
  cdp.on('Network.dataReceived', e => { bytes += e.encodedDataLength; const r = requests.get(e.requestId); if (r) r.bytes += e.encodedDataLength; });
  cdp.on('Network.loadingFinished', e => {
    const r = requests.get(e.requestId);
    const streamed = r?.bytes ?? 0;
    bytes += e.encodedDataLength - streamed;
    if (r) r.bytes = e.encodedDataLength;
  });
  const url = `http://localhost:${process.env.PORT || 4173}/${language === 'ru' ? 'ru/' : ''}${feature ? `features/${feature}/` : ''}`;
  for (const visit of visits ? ['cold', 'warm', 'language-switch'] : ['cold']) {
    bytes = 0;
    requests.clear();
    const started = Date.now();
    if (visit === 'language-switch') {
      await Promise.all([
        page.waitForEvent('framenavigated', { predicate: frame => frame === page.mainFrame() }),
        page.locator('[data-lang-switch]:visible').first().click(),
      ]);
    } else await page.goto(url, { waitUntil: 'commit', timeout: 180000 });
    let ready = true;
    try {
      await page.waitForFunction(feature => feature
        ? !!document.querySelector(`article.ft[data-feature-id="${feature}"]`) && [...document.querySelectorAll('article.ft img')].some(img => img.naturalWidth > 0)
        : !!document.querySelector('article.chapter') && !document.querySelector('.loading'), feature, { timeout: 240000 });
    } catch { ready = false; }
    console.log(JSON.stringify({ language: visit === 'language-switch' ? (language === 'en' ? 'ru' : 'en') : language, ...(visits ? { visit, fromLanguage: language } : {}), page: feature ?? 'museum', ready, throughput: 100 * 1024, latency: 100, seconds: (Date.now() - started) / 1000, bytes, requests: [...requests.values()].filter(r => r.bytes).sort((a,b) => b.bytes-a.bytes) }));
    if (!ready) process.exitCode = 1;
    if (visits) await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  }
  await context.close();
}
await browser.close();
