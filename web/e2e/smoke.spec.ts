import { serveFixtureRoots } from './support/roots';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sankofa.edition', 'm');
    localStorage.setItem('sankofa.navlegend', '1');
  });
});

test('the story loads and a chapter follows the scroll', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#cover-title')).toBeVisible();
  const chapter = page.locator('article.chapter').first();
  await expect(chapter).toBeAttached();
  await chapter.scrollIntoViewIfNeeded();
  const steps = chapter.locator('.step');
  expect(await steps.count()).toBeGreaterThan(1);
  await steps.nth(1).scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 200);
  await expect(chapter.locator('.step.on')).toHaveCount(1);
  await expect(chapter.locator('.graphic svg.geo .land')).toBeAttached();
});

test('a deep link opens the atlas at the point with the focused card', async ({ page, request }) => {
  const data = await (await request.get('data/cards.json')).json();
  const c = data.cards.find((x: { id: string }) => x.id === 'zong') ?? data.cards.find((x: { edition: string }) => x.edition === 'both');
  const slug = c.places[0].name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const t = c.years.length > 1 && c.years[1] !== c.years[0] ? `${c.years[0]}-${c.years[1]}` : `${c.years[0]}`;
  const frag = `focus=${c.id}&place=${slug}&t=${t}&zoom=${c.zoom}`;
  await page.goto('/#' + frag);
  await expect(page.locator('.atlas.open')).toBeVisible();
  const card = page.locator(`.drawer.on article.card[data-card-id="${c.id}"]`);
  await expect(card).toBeVisible();
  await expect(card.locator('h2')).toHaveText(c.title);
  await expect(page.locator(`.atlas .levels button[aria-pressed="true"] b`)).toHaveText(String(c.zoom));
  await card.getByRole('button', { name: 'Open in terminal' }).click();
  await expect(card.locator('.term code')).toHaveText(`sankofa atlas --at '${frag}'`);
  expect(page.url()).toContain(`focus=${c.id}`);
});

test('a shared path replays and records the visit', async ({ page, request }) => {
  const data = await (await request.get('data/cards.json')).json();
  const ids = data.cards.slice(0, 3).map((c: { id: string }) => c.id);
  await page.goto('/#path=' + ids.join('.'));
  await expect(page.locator('.pathbar.on')).toContainText(`/ ${ids.length}`);
  await page.getByRole('button', { name: 'Next card in the path' }).click();
  await expect(page.locator('.drawer.on article.card')).toBeVisible();
  const stored = await page.evaluate(() => localStorage.getItem('sankofa.path'));
  expect(stored).toBeTruthy();
});

test('keyboard: a card link opens with Enter and closes with Escape', async ({ page }) => {
  await page.goto('/');
  const link = page.locator('article.chapter a.xref').first();
  await link.focus();
  await page.keyboard.press('Enter');
  const drawer = page.locator('.drawer.on article.card');
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(link).toBeFocused();
});

test('reduced motion still reaches the deep-linked point', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto('/#t=1900-1935&zoom=3');
  await expect(page.locator('.atlas .levels button[aria-pressed="true"] b')).toHaveText('3');
  // Year ranges are bound with word joiners so they never break at the dash.
  await expect(page.locator('.atlas-bar .when')).toContainText(/1900\u2060?–\u2060?1935/);
  await ctx.close();
});

test('the descent opens at a deep-linked year and keeps the year in the link', async ({ page }) => {
  await page.goto('/#t=1803&view=descent');
  await expect(page.locator('.descent.open')).toBeVisible();
  await expect.poll(async () => Number(await page.locator('.dm-year').textContent())).toBeGreaterThan(1795);
  expect(Number(await page.locator('.dm-year').textContent())).toBeLessThan(1811);
  await page.locator('.descent').evaluate((el) => el.scrollBy(0, 3000));
  await expect.poll(() => page.evaluate(() => Number(new URLSearchParams(location.hash.slice(1)).get('t')))).toBeGreaterThan(1810);
  expect(page.url()).toContain('view=descent');
  const card = page.locator('.descent a.dc').first();
  const id = await card.getAttribute('data-card');
  await page.locator('.descent').evaluate((el, id) => el.querySelector(`a.dc[data-card="${id}"]`)!.scrollIntoView({ block: 'center' }), id);
  await card.click();
  await expect(page.locator('.drawer.on article.card')).toBeVisible();
});

test('the cover leads into the descent', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Descend through seven centuries' }).click();
  await expect(page.locator('.descent.open')).toBeVisible();
  await expect(page.locator('.dm-year')).toHaveText(/^13\d\d$/);
});

test('the listening room plays a labelled demo when the cluster is not reachable', async ({ page }) => {
  await page.goto('/#view=listen');
  await expect(page.locator('.listen.open')).toBeVisible();
  await expect(page.locator('.l-badge')).toHaveText(/Recorded\sdemo/, { timeout: 8000 });
  await expect(page.locator('.l-node')).toHaveCount(3);
  await page.getByRole('button', { name: 'Start listening' }).click();
  await expect(page.locator('.listen.playing')).toBeVisible();
  await expect(page.locator('.l-call .slot').first()).toBeAttached({ timeout: 8000 });
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.locator('.listen.playing')).toHaveCount(0);
});

test('the listening room plays the live cluster from /pulse', async ({ page }) => {
  const voices = { type: 'voices', at: '2026-11-12T10:00:00Z', voices: [{ node: 'cp-1', alive: true, late: 0.1, ready: 2, notReady: 1 }, { node: 'w-1', alive: false, late: 1.3, ready: 0, notReady: 2 }] };
  const lease = { type: 'lease', node: 'cp-1', at: '2026-11-12T10:00:01Z', leaseSeconds: 40 };
  await page.route('**/pulse', (r) => r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }, body: `retry: 60000\ndata: ${JSON.stringify(voices)}\n\ndata: ${JSON.stringify(lease)}\n\n` }));
  await page.goto('/#view=listen');
  await expect(page.locator('.l-badge')).toHaveText(/Live/);
  await expect(page.locator('.l-node')).toHaveCount(2);
  await expect(page.locator('.l-node.silent')).toHaveCount(1);
  await expect(page.locator('.l-status')).toContainText('1 of 2 drums playing');
});

test('a chapter without a photograph opens on its own night map', async ({ page, request }) => {
  const data = await (await request.get('data/chapters.json')).json();
  const ch = data.chapters.find((c: { hero?: { file?: string } }) => !c.hero?.file);
  test.skip(!ch, 'every chapter has a hero image');
  await page.goto('/');
  const hero = page.locator(`#ch-${ch.id} .hero`);
  await hero.scrollIntoViewIfNeeded();
  await expect(hero).toHaveClass(/map-hero/);
  await expect(hero.locator('svg.geo path.land')).toBeAttached();
  await expect(hero.locator('svg.geo g.pt').first()).toBeAttached();
});

test('landing mid-chapter still shows a picture or the map in the sticky panel', async ({ page }) => {
  await page.goto('/');
  for (const id of ['v2', 'v3', 'v5', 'v6']) {
    const step = page.locator(`article.chapter[data-chapter="${id}"] .step:nth-child(3)`);
    if (!(await step.count())) continue;
    await step.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await expect(step).toHaveClass(/on/);
    const graphic = page.locator(`#ch-${id} .graphic`);
    await expect
      .poll(async () =>
        graphic.evaluate((g) => {
          const vh = window.innerHeight;
          const inView = (el: Element | null) => {
            if (!el) return false;
            const r = el.getBoundingClientRect();
            return r.height > 50 && r.bottom > 0 && r.top < vh;
          };
          return g.classList.contains('show-img') ? inView(g.querySelector('figure.on img')) : inView(g.querySelector('svg.geo')) && !!g.querySelector('svg.geo path.land');
        }),
      )
      .toBe(true);
  }
});

test('the page is never wider than the screen', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(500);
  const [inner, client] = await page.evaluate(() => [window.innerWidth, document.documentElement.clientWidth]);
  expect(inner).toBe(client);
});

test('the language switch turns the museum Russian and remembers it', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('sankofa.lang', 'en');
      sessionStorage.setItem('seeded', '1');
    }
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.locator('[data-lang-switch]').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await expect(page).toHaveURL(/lang=ru/);
  await expect(page.locator('.deck:visible')).toContainText('Семь веков');
  await expect(page.locator('.toc-head h2')).toHaveText('Восемь глав');
  expect(await page.evaluate(() => localStorage.getItem('sankofa.lang'))).toBe('ru');
  await page.locator('[data-lang-switch]').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page).not.toHaveURL(/lang=ru/);
});

test('a deep link with lang=ru opens the atlas and the card in Russian', async ({ page, request }) => {
  const data = await (await request.get('data/cards.json')).json();
  const c = data.cards.find((x: { translations?: { ru?: { title: string } }; edition: string }) => x.translations?.ru?.title && x.edition === 'both');
  test.skip(!c, 'no translated card yet');
  await page.goto(`/#focus=${c.id}&lang=ru&zoom=${c.zoom}`);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await expect(page.locator('.atlas.open .atlas-bar h2')).toHaveText('Атлас');
  const card = page.locator(`.drawer.on article.card[data-card-id="${c.id}"]`);
  await expect(card.locator('h2')).toHaveText(c.translations.ru.title);
  await card.getByRole('button', { name: 'Открыть в терминале' }).click();
  await expect(card.locator('.term code')).toContainText('lang=ru');
});

test('the engine room shows cards as Kubernetes objects', async ({ page }) => {
  await page.goto('/#view=engine');
  await expect(page.locator('.engine.open')).toBeVisible();
  await expect(page.locator('.engine .term pre').first()).toContainText('kubectl get cards');
  await expect(page.locator('.e-yaml pre')).toContainText('kind: Card');
  await expect(page.locator('.e-card')).toHaveCount(7);
});

test('#view=atlas opens the atlas on first load, and a card shows its object', async ({ page }) => {
  await page.goto('/#view=atlas');
  await expect(page.locator('.atlas.open')).toBeVisible();
  await page.goto('about:blank');
  await page.goto('/#focus=equiano');
  await expect(page.locator('.drawer.on article.card')).toBeVisible();
  const det = page.locator('.drawer.on details.k8s');
  await det.locator('summary').click();
  await expect(det.locator('pre')).toContainText('sankofa dict equiano');
  await expect(det.locator('pre')).toContainText('apiVersion: sankofa.kuberoot.dev/v1alpha1');
});

test('the demo lets you break a node and hear it fall silent', async ({ page }) => {
  await page.goto('/#view=listen');
  await expect(page.locator('.l-badge')).toHaveText(/Recorded\sdemo/, { timeout: 8000 });
  await page.getByRole('button', { name: 'Break a node' }).click();
  // At once: the node is marked, its heartbeat is late and its pods are silent.
  const broken = page.locator('.l-node.broken');
  await expect(broken).toHaveCount(1);
  await expect(broken.locator('.st')).toContainText(/late|опаздывает/);
  await expect.poll(async () => Number((await broken.locator('.st').textContent())?.match(/(\d+)\s*s\s*late|late\s*(\d+)/)?.slice(1).find(Boolean) ?? 0)).toBeGreaterThan(1);
  await expect(page.getByRole('button', { name: 'Mend the node' })).toBeVisible();
});

test('cover opens on a real image with the first surprise, and the end returns to Sankofa', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.cover-art img')).toBeVisible();
  await expect(page.locator('.cover-wow:visible')).toContainText(/Mecca|Мекку/);
  await expect(page.locator('.cover .kicker')).toHaveCount(0);
  await expect(page.locator('.coda h2')).toHaveText(/Go\sback\sand\sfetch\sit|Вернись\sи\sзабери/);
});

test('a chapter leads with a few cards and reveals the rest on request', async ({ page }) => {
  await page.goto('/');
  const strip = page.locator('article.chapter').first().locator('.strip');
  const before = await strip.locator('.teaser').count();
  expect(before).toBeLessThanOrEqual(4);
  const more = strip.locator('.more');
  if (await more.count()) {
    await more.scrollIntoViewIfNeeded();
    await more.click();
    expect(await strip.locator('.teaser').count()).toBeGreaterThan(before);
  }
});

test('descent cards hold their text and the level control changes what is shown', async ({ page }) => {
  for (const url of ['/#view=descent&zoom=5', '/#view=descent&zoom=5&lang=ru']) {
    await page.goto('about:blank');
    await page.goto(url);
    await page.waitForLoadState('load');
    await expect(page.locator('.descent.open')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    const spill = await page.locator('.descent a.dc').evaluateAll((els) =>
      els.filter((e) => e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1 || [...e.querySelectorAll('.tx')].some((t) => t.scrollWidth > t.clientWidth + 1)).map((e) => e.getAttribute('data-card')),
    );
    expect(spill).toEqual([]);
  }
  const all = await page.locator('.descent a.dc').count();
  await page.locator('.d-levels button').first().click();
  await expect.poll(() => page.locator('.descent a.dc').count()).toBeLessThan(all);
  const one = await page.locator('.descent a.dc').count();
  expect(one).toBeGreaterThan(0);
  expect(page.url()).toContain('zoom=1');
  await page.locator('.d-levels button').nth(3).click();
  await expect.poll(() => page.locator('.descent a.dc').count()).toBeGreaterThan(one);
  await expect(page.locator('.descent .d-chapter')).toHaveCount(0);
  await expect(page.locator('.dm-era .main')).not.toBeEmpty();
});

test('each chapter ends on a quiet editorial beat, and maps never stack labels', async ({ page }) => {
  await page.goto('/');
  // A strip appears only where the chapter has cards its steps did not narrate.
  if (await page.locator('.strip').count()) await expect(page.locator('.strip h3').first()).toHaveText('More from this chapter');
  await expect(page.locator('.ch-cluster')).toHaveCount(0);
  await expect(page.locator('.toc-grid')).not.toContainText(/release/);
  await expect(page.locator('.toc-head h2')).toHaveText(/Eight\schapters|Восемь\sглав/);
  const step = page.locator('article.chapter').nth(4).locator('.step').nth(1);
  await step.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(2500);
  const overlaps = await page.locator('article.chapter').nth(4).locator('.graphic svg.geo').evaluate((svg) => {
    const boxes = [...svg.querySelectorAll('g.pt text.lbl')]
      .filter((t) => getComputedStyle(t).display !== 'none' && t.textContent)
      .map((t) => t.getBoundingClientRect());
    let n = 0;
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (a.left < b.right - 2 && a.right > b.left + 2 && a.top < b.bottom - 2 && a.bottom > b.top + 2) n++;
      }
    return n;
  });
  expect(overlaps).toBe(0);
});

test('interludes and strips never repeat a card the steps of this copy narrate', async ({ page }) => {
  await page.goto('/');
  for (const ch of await page.locator('article.chapter').all()) {
    const narrated = await ch.locator('.step a.xref').evaluateAll((as) => as.map((a) => a.getAttribute('data-card')));
    expect(narrated.length).toBeGreaterThan(0);
    const again = await ch.locator('.sig a[data-card], .interlude a[data-card], .strip a[data-card]').evaluateAll((as) => as.map((a) => a.getAttribute('data-card')));
    expect(again.filter((id) => narrated.includes(id))).toEqual([]);
  }
});

test('readers never see the internal chapter ids v0–v7', async ({ page }) => {
  for (const url of ['/', '/#lang=ru', '/#view=descent&zoom=1', '/#t=1925&view=descent&zoom=5', '/#zoom=1', '/#focus=equiano', '/#view=roots&artist=oasis']) {
    await page.goto('about:blank');
    await page.goto(url);
    await page.waitForTimeout(1500);
    const text = await page.evaluate(() => document.body.innerText);
    expect(text.match(/\bv[0-7]\b/g), url).toBeNull();
  }
  await page.goto('/#ch=v2&lang=ru');
  await expect(page.locator('#ch-v2 .hero .release .v')).toHaveText('Глава 3');
});

test('level 5 never shows an empty desk, and a phone reads the card in the column', async ({ page }, info) => {
  await page.goto('/#t=1300&view=descent&zoom=5');
  await page.waitForTimeout(1200);
  await expect(page.locator('.d-desk')).toBeHidden();
  await page.goto('about:blank');
  await page.goto('/#t=1925&view=descent&zoom=5');
  await page.waitForTimeout(1200);
  if (info.project.name === 'mobile') {
    await expect(page.locator('.d-desk')).toBeHidden();
    await expect(page.locator('.descent a.dc .dc-body').first()).not.toBeEmpty();
  } else {
    await expect(page.locator('.d-desk .desk-in h3')).toBeVisible();
  }
});

test('timeline names are never cut by a neighbouring bar, and atlas level 1 has one name', async ({ page }) => {
  await page.goto('/#zoom=1');
  await expect(page.locator('.atlas .levels button').first()).toContainText('Centuries');
  await page.goto('about:blank');
  await page.goto('/');
  await page.locator('.finale .timeline-wrap').evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await expect(page.locator('.timeline-wrap g.life rect').first()).toBeAttached();
  await page.waitForTimeout(400);
  const hits = await page.locator('.timeline-wrap').evaluate((root) => {
    const lives = [...root.querySelectorAll('g.life:not(.bead)')];
    const out: string[] = [];
    for (const g of lives) {
      const t = g.querySelector('text');
      if (!t || !t.textContent) continue;
      const a = t.getBoundingClientRect();
      for (const o of lives) {
        if (o === g) continue;
        const b = o.querySelector('rect')!.getBoundingClientRect();
        if (a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1) out.push(`${t.textContent} / ${o.getAttribute('data-id')}`);
      }
    }
    return out;
  });
  expect(hits).toEqual([]);
});

test('the music map names as many roots as it draws, and a lit root does not pile up labels', async ({ page }, info) => {
  await page.goto('/#view=roots-map&lang=ru');
  await expect(page.locator('.rm-head h2')).not.toBeEmpty();
  await expect(page.locator('.rm-head h2')).not.toContainText('одному корню');
  await page.goto('about:blank');
  await page.goto('/#view=roots-map&lang=en');
  await expect(page.locator('.rm-head h2')).toContainText('lead back to');
  await page.waitForTimeout(1200);
  const visibleLabels = () => page.locator('.rm-node .lbl').evaluateAll((ls) => ls.filter((l) => getComputedStyle(l).display !== 'none' && l.textContent).length);
  const root = page.locator('.rm-node.card').filter({ hasText: /^Gospel$/ });
  await root.dispatchEvent('click');
  await page.waitForTimeout(400);
  if (info.project.name === 'mobile') expect(await visibleLabels()).toBeLessThanOrEqual(12);
  // No two visible labels overlap.
  const overlaps = await page.locator('.rm-node .lbl').evaluateAll((ls) => {
    const r = ls.filter((l) => getComputedStyle(l).display !== 'none' && l.textContent).map((l) => l.getBoundingClientRect());
    let n = 0;
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) if (r[i].left < r[j].right - 1 && r[i].right > r[j].left + 1 && r[i].top < r[j].bottom - 1 && r[i].bottom > r[j].top + 1) n++;
    return n;
  });
  expect(overlaps).toBe(0);
});

test('a roots search that finds nobody clears the previous chain', async ({ page }) => {
  await page.goto('/#view=roots&artist=oasis');
  await expect(page.locator('.r-stage .r-artist').first()).toBeVisible();
  await page.locator('.r-input').fill('zzqqxx');
  await expect(page.locator('.r-none')).toBeVisible();
  await expect(page.locator('.r-stage .r-artist')).toHaveCount(0);
  expect(page.url()).not.toContain('artist=oasis');
});

test('engine room commands stay on one line, the grid has no orphan, Russian names the components', async ({ page }, info) => {
  await page.goto('/#view=engine');
  const codes = page.locator('.e-card .term code');
  await expect(codes.first()).toBeVisible();
  for (const c of await codes.all()) {
    expect(await c.evaluate((e) => getComputedStyle(e).whiteSpace)).toBe('pre');
    const lineH = await c.evaluate((e) => parseFloat(getComputedStyle(e).lineHeight) || 20);
    expect(await c.evaluate((e) => e.clientHeight)).toBeLessThan(lineH * 2 + 24);
  }
  if (info.project.name === 'desktop') {
    const tops = await page.locator('.e-grid > .e-card').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    const rows = new Map<number, number>();
    tops.forEach((t) => rows.set(t, (rows.get(t) ?? 0) + 1));
    expect([...rows.values()].some((n) => n === 1)).toBe(false);
  }
  await page.goto('about:blank');
  await page.goto('/#view=engine&lang=ru');
  await expect(page.locator('.e-card h4').filter({ hasText: 'Родословная' })).toContainText('(Credits)');
});

test('phone step boxes look alike in every chapter and no map name peeks out around them', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'phones only');
  await page.goto('/#ch=v2');
  const step = page.locator('#ch-v2 .step').nth(1);
  await step.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(2500);
  const bg = (sel: string) => page.locator(sel).first().evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(await bg('#ch-v2 .step')).toBe(await bg('#ch-v0 .step'));
  const peeking = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('#ch-v2 .step')].map((s) => s.getBoundingClientRect()).filter((r) => r.bottom > 0 && r.top < innerHeight);
    return [...document.querySelectorAll<SVGTextElement>('#ch-v2 .graphic g.pt text.lbl')]
      .filter((l) => getComputedStyle(l).display !== 'none' && getComputedStyle(l).visibility !== 'hidden' && l.textContent)
      .map((l) => l.getBoundingClientRect())
      .filter((r) => boxes.some((b) => r.right > b.left && r.left < b.right && r.bottom > b.top - 30 && r.top < b.bottom + 30)).length;
  });
  expect(peeking).toBe(0);
});

test('a step label is never said twice running', async ({ page }) => {
  await page.goto('/');
  const repeats = await page.locator('article.chapter').evaluateAll((chs) =>
    chs.flatMap((ch) => {
      const labels = [...ch.querySelectorAll('.step')].map((s) => s.querySelector('.where')?.textContent ?? '');
      return labels.filter((l, i) => l && l === labels[i - 1]).map((l) => `${(ch as HTMLElement).dataset.chapter}: ${l}`);
    }),
  );
  expect(repeats).toEqual([]);
});

test('a card panel holds the page still; the counter keeps the card wording', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.cover-lang')).toHaveCount(0);
  await page.locator('a.xref').first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.locator('a.xref').first().click();
  await expect(page.locator('.drawer.on')).toBeVisible();
  await page.waitForTimeout(800); // let any smooth scroll settle
  const y = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, 800);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.scrollY)).toBe(y);
  await page.keyboard.press('Escape');
  const sig = page.locator('.sig-counter');
  if (await sig.count()) await expect(sig.locator('.sig-q')).toHaveText(/nearly|almost|about|почти|около/);
});

test('the listening room moves pods off a node that is declared down', async ({ page }) => {
  await page.clock.install();
  await page.goto('/#view=listen');
  await page.clock.runFor(5000);
  await expect(page.locator('.l-badge')).toHaveText(/Recorded\sdemo/);
  const pods = await page.locator('.l-pod:not(.guest)').count();
  await page.getByRole('button', { name: 'Break a node' }).click();
  await expect(page.locator('.l-pod.off').first()).toBeAttached();
  await page.clock.runFor(17000);
  await expect(page.locator('.l-move')).toBeVisible();
  await expect(page.locator('.l-pod:not(.guest)')).toHaveCount(pods);
  await expect(page.locator('.l-node.broken .st')).toContainText(/moved|переехали/);
});

test('roots: Cyrillic search finds an artist and the chain ends at a museum card', async ({ page, request }) => {
  const data = await (await request.get('data/cards.json')).json();
  const artists = data.roots ?? [];
  test.skip(!artists.length, 'no roots exported');
  const a = [...artists].sort((x: { paths: string[][] }, y: { paths: string[][] }) => Math.max(...y.paths.map((p) => p.length)) - Math.max(...x.paths.map((p) => p.length)))[0];
  const cyr = [a.nameRu, ...(a.aliases ?? [])].find((n: string) => /[А-Яа-яЁё]/.test(n ?? ''));
  await page.goto('/#view=roots');
  await expect(page.locator('.roots.open')).toBeVisible();
  if (cyr) {
    await page.locator('.r-input').fill(cyr.slice(0, 4));
    await expect(page.locator(`.r-hit[data-id="${a.id}"]`)).toBeVisible();
    await page.locator('.r-input').press('Enter');
  } else {
    await page.goto(`/#view=roots&artist=${a.id}`);
  }
  await expect(page.locator(`.r-tree[data-root="${a.id}"]`)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`artist=${a.id}`));

  // A deep link renders the chain and it ends at a card.
  await page.goto('about:blank');
  await page.goto(`/#view=roots&artist=${a.id}`);
  const end = page.locator('.r-tree .r-card').last();
  await expect(end).toBeVisible();
  const cardId = await end.getAttribute('data-card');
  expect(a.paths.some((p: string[]) => p[p.length - 1] === `card:${cardId}` || p[p.length - 1].startsWith('card:'))).toBe(true);
  await expect(page.locator('.r-edge .r-say').first()).toBeVisible();
  await expect(page.locator('.r-edge-head').first()).toContainText('→');
  await expect(page.locator('.r-src a')).not.toHaveCount(0);
  await end.click();
  await expect(page.locator('.drawer.on article.card')).toBeVisible();
});

test('the listening room narrates leases, calls and a guest drummer joining and leaving', async ({ page }) => {
  const voices = { type: 'voices', at: '2026-11-12T10:00:00Z', voices: [{ node: 'cp-1', alive: true, late: 0.1, ready: 3, notReady: 0 }, { node: 'w-1', alive: true, late: 0.1, ready: 2, notReady: 0 }] };
  const ev = (o: object) => `data: ${JSON.stringify(o)}\n\n`;
  await page.route('**/pulse', (r) =>
    r.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
      body:
        'retry: 60000\n' +
        ev(voices) +
        ev({ type: 'lease', node: 'cp-1', at: 'x', leaseSeconds: 40 }) +
        ev({ type: 'pod', phase: 'joined', name: 'guest-drummer', node: 'w-1', at: 'x' }),
    }),
  );
  await page.goto('/#view=listen');
  await expect(page.locator('.l-badge')).toHaveText(/Live/);
  await expect(page.locator('.l-what')).toContainText('What you are hearing');
  await expect(page.locator('.l-subs')).toContainText('Atsimevu checked in: alive');
  await expect(page.locator('.l-subs li').first()).toHaveText('A guest drummer joins on Sogo');
  await expect(page.locator('.l-pod.guest')).toHaveCount(1);
  await expect(page.locator('.l-next')).toContainText(/Playing\snow:\sa\sguest\sdrummer/);
});

test('in the demo the guest drummer comes and goes, in Russian too', async ({ page }) => {
  await page.clock.install();
  await page.goto('/#view=listen&lang=ru');
  await page.clock.runFor(5000);
  await expect(page.locator('.l-badge')).toHaveText(/демо/);
  await page.clock.runFor(10000);
  await expect(page.locator('.l-subs')).toContainText(/Вступает\sприглашённый\sбарабанщик/);
  await expect(page.locator('.l-pod.guest')).toHaveCount(1);
  await page.clock.runFor(31000);
  await expect(page.locator('.l-subs')).toContainText(/Приглашённый\sбарабанщик\sуходит/);
  await expect(page.locator('.l-pod.guest')).toHaveCount(0);
});


test('roots unwind past the card, name the kind of each link and what was borrowed', async ({ page }) => {
  await serveFixtureRoots(page);
  await page.goto('/#view=roots&artist=the-prodigy');
  await expect(page.locator('.r-tree')).toBeVisible();
  await expect(page.locator('.r-edge.k-sample .r-kind')).toContainText('sample');
  await expect(page.locator('.r-edge.k-sample .r-say')).toContainText('handclaps');
  // gospel grows from spirituals: the chain goes on past the first card
  await expect(page.locator('.r-edge.r-lin').first()).toBeVisible();
  await expect(page.locator('.r-card.r-deep').first()).toBeVisible();

  await page.goto('about:blank');
  await page.goto('/#view=roots&artist=television&lang=ru');
  await expect(page.locator('.r-story')).toContainText('[заглушка]');
  await expect(page.locator('.r-kind').first()).toContainText('влияние');

  await page.goto('about:blank');
  await page.goto('/#view=roots');
  await expect(page.locator('.r-long').first()).toBeVisible();
});

test('the music map counts its roots, finds an artist and lights its way down', async ({ page }) => {
  await serveFixtureRoots(page);
  await page.goto('/#view=roots-map');
  await expect(page.locator('.rmap.open')).toBeVisible();
  await expect(page.locator('.rm-head h2')).toHaveText(/(Of\s\d+\sartists,\s\d+|All\s\d+\sartists)\slead\sback\sto/);
  await expect(page.locator('.rm-node.card').first()).toBeAttached();
  await page.locator('.rm-input').fill('telev');
  await page.locator('.rm-input').press('Enter');
  await expect(page.locator('.rmap.lit')).toBeAttached();
  await expect(page.locator('.rm-info b')).toHaveText('Television');
  await expect(page.locator('.rm-info p')).toContainText('[placeholder]');
  // its way down reaches a museum card
  expect(await page.locator('.rm-node.card.on').count()).toBeGreaterThan(0);

  await page.goto('about:blank');
  await page.goto('/#view=roots-map&lang=ru');
  await expect(page.locator('.rm-head h2')).toHaveText(/^(Из|Все)\s\d+\sисполнител/);
});

test('breaking a node is told at once and the stopped node never checks in', async ({ page }) => {
  const voices = { type: 'voices', at: 'x', voices: [{ node: 'cp-1', alive: true, late: 0.1, ready: 3, notReady: 0 }, { node: 'w-1', alive: true, late: 0.1, ready: 2, notReady: 0 }] };
  const ev = (o: object) => `data: ${JSON.stringify(o)}\n\n`;
  await page.route('**/pulse', (r) =>
    r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: 'retry: 1500\n' + ev(voices) + ev({ type: 'lease', node: 'w-1', at: 'x', leaseSeconds: 40 }) }),
  );
  await page.goto('/#view=listen');
  await expect(page.locator('.l-badge')).toHaveText('Live: this museum’s own cluster');
  await page.getByRole('button', { name: 'Break a node' }).click();
  await expect(page.locator('.l-subs')).toContainText(/You\s+stopped\s+Sogo\.\s+Its\s+heartbeat\s+is\s+late;\s+the\s+cluster\s+will\s+give\s+up\s+on\s+it\s+in\s+\d+\s+s\./);
  // the stream reconnects and sends Sogo's check-in again: it is not shown
  await page.waitForTimeout(3500);
  await expect(page.locator('.l-subs')).toContainText(/Sogo\s+has\s+been\s+silent\s+for\s+\d+/);
  const lines = await page.locator('.l-subs li').allTextContents();
  const since = lines.findIndex((l) => /You\s+stopped/.test(l));
  expect(lines.slice(0, since).some((l) => /Sogo\s+checked\s+in/.test(l))).toBe(false);
});

test('the music map fits the viewport; descent level 1 shows eras; Renaissance opens on a photograph', async ({ page }) => {
  await page.goto('/#view=roots-map');
  await page.waitForTimeout(1500);
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll('.rm-node .lbl:not(.hide)')].filter((t) => {
      const r = t.getBoundingClientRect();
      return r.width && (r.right > innerWidth + 1 || r.left < -1);
    }).length,
  );
  expect(clipped).toBe(0);
  await page.goto('about:blank');
  await page.goto('/#view=descent&zoom=1');
  await expect(page.locator('.d-era').first()).toBeAttached();
  await page.goto('about:blank');
  await page.goto('/');
  // Chapter pictures load only as they come near.
  await expect(page.locator('#ch-v5 .hero.portrait img')).not.toHaveAttribute('src', /./);
  await page.locator('#ch-v5 .hero').scrollIntoViewIfNeeded();
  await expect(page.locator('#ch-v5 .hero.portrait img')).toHaveAttribute('src', /hurston/);
});

test('the room state stays consistent: late node not counted, pods return gradually after a mend', async ({ page }) => {
  await page.clock.install();
  await page.goto('/#view=listen');
  await page.clock.runFor(5000);
  await expect(page.locator('.l-badge')).toHaveText(/Recorded\sdemo/);
  await page.getByRole('button', { name: 'Break a node' }).click();
  await page.clock.runFor(1000);
  await expect(page.locator('.l-status')).toContainText(/2\sof\s3\sdrums\splaying.*Sogo\slate/);
  const label = await page.locator('.l-node.broken .st').textContent();
  const sub = await page.locator('.l-subs').textContent();
  expect(label!.match(/down\sin\s(\d+)/)?.[1]).toBeTruthy();
  expect(sub).toMatch(/in\s+\d+\s+s/);
  await page.clock.runFor(17000);
  await expect(page.locator('.l-node.broken .st')).toContainText(/moved/);
  await page.getByRole('button', { name: 'Mend the node' }).click();
  await page.clock.runFor(500);
  await expect(page.locator('.l-subs')).toContainText(/does\snot\smove\spods\sback/);
  await expect(page.locator('.l-node').nth(1).locator('.st')).toContainText(/back\s·\s0\sanswering/);
  await page.clock.runFor(7000);
  await expect(page.locator('.l-node').nth(1).locator('.st')).toContainText(/back\s·\s[12]\sanswering/);
});

test('a step reached by a jump is the active one and never shows the previous picture', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'phones show pictures inside the steps');
  await page.goto('/');
  const steel = page.locator('.step', { hasText: 'oil drums' });
  await steel.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await expect(steel).toHaveClass(/\bon\b/);
  await page.waitForTimeout(600);
  await expect(page.locator('#ch-v4 .graphic.show-img, #ch-v4 .show-img')).toHaveCount(0);
});

test('the engine room folds long YAML values and scrolls, never soft-wraps; copy is a corner icon', async ({ page }) => {
  await page.goto('/#view=engine');
  const pre = page.locator('.term.multi:not(.table) pre').first();
  await expect(pre).toContainText('wow: >-');
  expect(await pre.evaluate((e) => getComputedStyle(e).whiteSpace)).toBe('pre');
  await expect(page.locator('.term.multi button.copy').first()).toHaveAttribute('aria-label', /Copy/);
});

test('the copy switch flips a paired card at once, and the pairs list links both voices', async ({ browser, baseURL }) => {
  // A page of its own: the shared setup pins the male copy on every load.
  const page = await (await browser.newContext({ baseURL })).newPage();
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('sankofa.edition', 'f');
      sessionStorage.setItem('seeded', '1');
    }
  });
  await page.goto('/#focus=douglass-covey');
  await expect(page.locator('.card h2, #card-title').first()).toContainText('Harriet Jacobs');
  await expect(page.locator('.notice.edition')).toContainText('This story belongs to the other copy');
  await page.goto('/');
  const note = page.locator('.opener .ed-note:visible');
  await expect(note).toContainText(/Yours\sis\sthe\sfemale\scopy;\sin\sit\syou\sread\s.*Harriet\sJacobs/);
  // The note names the reader's own stories, never both copies' (the list is behind a button).
  await expect(note.locator('p').first()).not.toContainText('Frederick Douglass');
  // The pairs come from the data: count them there.
  const pairs = await page.evaluate(async () => {
    const d = await (await fetch('data/cards.json')).json();
    return new Set(d.cards.filter((c: { edition?: string; pair?: string }) => c.edition === 'm' || c.edition === 'f').map((c: { pair?: string }) => c.pair)).size;
  });
  const words = ['', 'one', 'Both', 'three', 'four', 'five', 'six'];
  await note.getByRole('button', { name: pairs === 2 ? 'Both pairs' : `All ${words[pairs]} pairs` }).click();
  await expect(note.locator('.ed-pairs li')).toHaveCount(pairs);
  await expect(note).toContainText(`They differ in ${words[pairs]} places`);
  await note.getByRole('button', { name: 'Open the male copy' }).click();
  await expect(page.locator('.opener .ed-note:visible')).toContainText(/Yours\sis\sthe\smale\scopy/);
  await page.goto('/#focus=jacobs-garret');
  await expect(page.locator('.card h2, #card-title').first()).toContainText('Frederick Douglass');
});

test('one name per chapter: era tags read the chapter titles', async ({ page }) => {
  await page.goto('/#view=atlas');
  await expect(page.locator('.atlas')).toContainText('Renaissance');
  await expect(page.locator('body')).not.toContainText('Harlem and Négritude');
  await page.goto('/#lang=ru');
  await expect(page.locator('.opener .lede:visible')).toContainText('«Сопротивление»');
});

test('a band goes on through its member instead of a separate step', async ({ page }) => {
  await page.goto('/#view=roots&artist=the-velvet-underground');
  await expect(page.locator('.r-member').first()).toContainText('Lou Reed, of The Velvet Underground');
  await expect(page.locator('.r-col')).not.toContainText('years back');
});

test('Russian descent speaks Russian in its empty stretches', async ({ page }) => {
  await page.goto('/#view=descent&lang=ru');
  const quiet = page.locator('.d-quiet').first();
  await expect(quiet).toBeAttached();
  await expect(quiet).not.toContainText(/archive|records|stretch|sources/i);
});

test('counts agree: a chapter has as many cards in the contents, its end and the descent', async ({ page }) => {
  await page.goto('/');
  // The chapter's cards in the male copy (the setup pins it), counted from the data.
  const n = await page.evaluate(async () => {
    const d = await (await fetch('data/cards.json')).json();
    return d.cards.filter((c: { era?: string; edition?: string }) => c.era === 'v5' && (!c.edition || c.edition === 'both' || c.edition === 'm')).length;
  });
  expect(n).toBeGreaterThan(0);
  await page.goto('/#view=descent&zoom=1');
  const era = (await page.locator('a.d-era[data-chapter="v5"]').textContent()) ?? '';
  expect(Number(era.match(/(\d+)\s+cards?\s+in\s+this\s+era/)?.[1])).toBe(n);
});

test('roots: a person is not written as a band', async ({ page }) => {
  await page.goto('/#view=roots&artist=john-coltrane');
  const m = page.locator('.r-member').first();
  await expect(m).toContainText('Miles Davis, who led the band John Coltrane played in');
  await expect(page.locator('.r-col')).not.toContainText('Miles Davis, of John Coltrane');
});

test('a first visit to the engine room does not claim a card was opened', async ({ page }) => {
  await page.goto('/#view=engine');
  await expect(page.locator('.e-yaml p').first()).toContainText('One card');
});

test('on a phone the top bar is a labelled menu that names every way in', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'phones only');
  await page.goto('/');
  const menu = page.locator('.nav-menu-btn');
  await expect(menu).toBeVisible();
  await expect(menu).toHaveText('Menu');
  // No bare icons and no "0" badge in the bar.
  await expect(page.locator('.nav [data-open-atlas]')).toBeHidden();
  await expect(page.locator('.nav [data-path-count]')).toBeHidden();
  await menu.click();
  const sheet = page.locator('.nav-sheet');
  await expect(sheet).toBeVisible();
  for (const name of ['Descend', 'Atlas', 'Listen', 'Roots', 'Engine room', 'Your book', 'Objects', 'Guide']) await expect(sheet.locator('.nav-sheet-item b', { hasText: name }).first()).toBeVisible();
  // Every entry says in a line what it is.
  expect(await sheet.locator('.nav-sheet-item small').count()).toBeGreaterThanOrEqual(8);
  await sheet.locator('[data-entry="atlas"]').click();
  await expect(sheet).toBeHidden();
  await expect(page.locator('.atlas.open')).toBeVisible();
});

test('the menu speaks Russian, and the book counts only once there is something in it', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'phones only');
  await page.goto('/#lang=ru');
  await expect(page.locator('.nav-menu-btn')).toHaveText('Меню');
  await page.locator('.nav-menu-btn').click();
  await expect(page.locator('.nav-sheet [data-entry="book"] b')).toHaveText('Ваша книга');
  await page.keyboard.press('Escape');
  await page.goto('/#focus=equiano&lang=ru');
  await expect(page.locator('.drawer.on')).toBeVisible();
  await page.locator('.drawer.on .close').click();
  await page.locator('.nav-menu-btn').click();
  await expect(page.locator('.nav-sheet [data-entry="book"] b')).toContainText('1 карточка');
});

test('the chapter chip stays on one line on a phone', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'phones only');
  await page.goto('/#lang=ru');
  for (const id of ['v0', 'v7']) {
    const chip = page.locator(`#ch-${id} .hero .release .v`);
    await chip.scrollIntoViewIfNeeded();
    const box = await chip.boundingBox();
    // One line of 13px text with its padding is well under two lines.
    expect(box!.height).toBeLessThan(32);
  }
});

test('switching language keeps the reader in the same chapter', async ({ page }) => {
  await page.goto('/#ch=v4');
  await page.waitForTimeout(800);
  await page.locator('#ch-v4 .step').nth(2).evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(500);
  await page.locator('[data-lang-switch]').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  const mid = () =>
    page.evaluate(() => {
      const y = innerHeight / 2;
      return [...document.querySelectorAll<HTMLElement>('article.chapter')].find((a) => {
        const r = a.getBoundingClientRect();
        return r.top <= y && r.bottom >= y;
      })?.dataset.chapter;
    });
  await expect.poll(mid, { timeout: 6000 }).toBe('v4');
});

/** Record requests to the video host; answer them locally so tests stay offline. */
async function watchYouTube(page: import('@playwright/test').Page): Promise<string[]> {
  const seen: string[] = [];
  page.on('request', (r) => {
    if (/(^|\.)youtube(-nocookie)?\.com\//.test(new URL(r.url()).host + '/')) seen.push(r.url());
  });
  await page.route(/https:\/\/(www\.)?youtube(-nocookie)?\.com\/.*/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>player</title>' }));
  await page.route(/https:\/\/i\.ytimg\.com\/.*/, (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"/>' }));
  return seen;
}

test('a card with a recording shows a facade and loads the player only on click', async ({ page }) => {
  const yt = await watchYouTube(page);
  await page.goto('/#focus=big-mama-thornton');
  const block = page.locator('.drawer.on .lb');
  await expect(block).toBeVisible();
  await expect(block.locator('.lb-head')).toHaveText('Listen');
  await expect(block.locator('img')).toHaveAttribute('src', 'https://i.ytimg.com/vi/aKicGqIMpqk/hqdefault.jpg');
  await expect(block.locator('img')).toHaveAttribute('loading', 'lazy');
  await expect(block.locator('.lb-src')).toHaveText('Official upload: Big Mama Thornton - Topic');
  await expect(block.locator('iframe')).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(yt).toEqual([]);
  await block.locator('.lb-facade').click();
  const frame = block.locator('iframe');
  await expect(frame).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/aKicGqIMpqk?autoplay=1');
  await expect(frame).toHaveAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
  await expect(frame).toHaveAttribute('title', /Hound Dog/);
  // Closing the card unloads the player.
  await page.keyboard.press('Escape');
  await expect(page.locator('iframe.lb-frame')).toHaveCount(0);
});

test('Russian names the listening block and the uploader in Russian', async ({ page }) => {
  await watchYouTube(page);
  await page.goto('/#focus=big-mama-thornton&lang=ru');
  const block = page.locator('.drawer.on .lb');
  await expect(block.locator('.lb-head')).toHaveText('Слушать');
  await expect(block.locator('.lb-src')).toHaveText('Официальная загрузка: Big Mama Thornton - Topic');
});

test('stepping through a roots chain loads exactly one player at a time', async ({ page }) => {
  const yt = await watchYouTube(page);
  await page.goto('/#view=roots&artist=the-beatles');
  await expect(page.locator('.r-listen').first()).toBeVisible();
  await page.waitForTimeout(500);
  expect(yt).toEqual([]);
  await expect(page.locator('iframe.lb-frame')).toHaveCount(0);
  await page.getByRole('button', { name: 'Play the chain' }).click();
  await expect(page.locator('iframe.lb-frame')).toHaveCount(1);
  const first = await page.locator('iframe.lb-frame').getAttribute('src');
  await page.locator('.r-listen.on .lb-next').click();
  await expect(page.locator('iframe.lb-frame')).toHaveCount(1);
  await expect(page.locator('iframe.lb-frame')).not.toHaveAttribute('src', first!);
  // The edge between the two stops says how the borrowing happened.
  await expect(page.locator('.r-edge .r-kind').first()).toBeVisible();
});

test('the music map steps along a lit path with one player at a time', async ({ page }) => {
  const yt = await watchYouTube(page);
  await page.goto('/#view=roots-map');
  await page.locator('.rm-input').fill('beatles');
  await page.locator('.rm-input').press('Enter');
  const chain = page.locator('.rm-chain');
  await expect(chain).toBeVisible();
  await page.waitForTimeout(500);
  expect(yt).toEqual([]);
  await chain.locator('.lb-facade').click();
  await expect(page.locator('iframe.lb-frame')).toHaveCount(1);
  await chain.getByRole('button', { name: 'Next →' }).click();
  await expect(chain).toContainText('stop 2 of');
  await expect(page.locator('iframe.lb-frame')).toHaveCount(1);
});
