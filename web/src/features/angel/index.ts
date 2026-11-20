// Angel: Massive Attack's song of 1998 and Horace Andy's of 1973, told along
// the shape of the track: the bass and the silence, the voice, the
// breakdown, the fade that does not end, and a warm last screen that leads
// to the pulse page on a phone. All words come from content/features/angel;
// this file arranges them with their pictures and wires each scene's
// mechanic. The mood of the whole page is in ./fx.ts, its arithmetic in
// ./mood.ts, the pulse page in ./pulse/.
import { h } from '../../lib/dom';
import { lang, pick } from '../../lib/i18n';
import { miniPlayer } from '../../views/miniPlayer';
import type { FeatureContext, FeatureInstance } from '../host';
import type { ArtLayer, Scene } from '../model';
import { FlashGate } from '../model';
import { StrataSound, type Stratum } from './strata-sound';
import { onCalm } from '../engine/calm';
import { Kit } from '../engine/kit';
import { isPhone, qrSvg } from '../engine/qr';
import * as api from './api';
import { MoodFx } from './fx';
import { anxietyAt, crowdShown, thenNowPeriod, pulsePeriod, BPM_1998 } from './mood';
import { ANDY, ANGEL, SNATCH, VIDEO, type Official } from './recordings';
import { pulseUrl, wantsPulse } from './url';
import { yieldStage } from './yield';
import '../engine/engine.css';
import './angel.css';

/** Scenes whose real photograph develops out of the drawing as the reader goes on. */
const DEVELOP = new Set<string>();
/** Scenes whose photograph stands in the text column (the stage is busy with the mechanic). */
// Every photo stands on its own in the text column, never over a drawing.
const IN_FLOW = new Set(['kingston', 'then-now', 'bristol', 'studio', 'voice', 'strata', 'spiral']);
/** The afterlife's photographs, each from the block it belongs to. */
const AFTER_STEPS: { from: string; photo: string }[] = [
  { from: 'berlin', photo: 'mezzanine-xxi' },
  { from: 'dub', photo: 'rock-en-seine-2024' },
  { from: 'still', photo: 'andy-moscow' },
];
const STRATA = ['bass', 'drums', 'voice', 'guitar'] as const;
/** Where each strip lies on the canvas (percent from the top) and where they meet. */
const STRATA_ROW: Record<(typeof STRATA)[number], number> = { bass: 31.5, drums: 44.3, voice: 56.3, guitar: 74 };
const STRATA_MEET = 50;

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const vibrate = (p: number[]) => {
  try {
    if (typeof navigator.vibrate === 'function') navigator.vibrate(p);
  } catch {
    /* not allowed yet */
  }
};


/** A video, large: its cover first, the player only when the reader asks for it. */
function bigVideo(id: string, alt: { en: string; ru: string }, title: { en: string; ru: string }): HTMLElement {
  const label = pick({ en: 'Play the video', ru: 'Смотреть видео' });
  const cover = h('button.an-video-cover', { type: 'button', 'aria-label': `${label}: ${pick(title)}` },
    h('img', { src: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, alt: pick(alt), decoding: 'async', draggable: 'false' }),
    h('span.an-video-play', { 'aria-hidden': 'true' }, '▶'));
  const box = h('div.ft-art.an-video', {}, cover);
  cover.addEventListener('click', () => {
    miniPlayer().pause();
    box.replaceChildren(h('iframe', {
      src: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`,
      title: pick(title),
      allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
      allowfullscreen: '',
      loading: 'lazy',
    }));
  });
  return box;
}

export function mount(ctx: FeatureContext): FeatureInstance {
  const kit = new Kit(ctx);
  const root = ctx.root;
  root.classList.add('an');
  kit.circlePlace = () => 'hidden';
  // The songs play in the museum's player; this longread has no clap of its own.
  ctx.tools.querySelector('.ft-sound')?.remove();
  const scenes = ctx.data.scenes;
  const ids = scenes.map((s) => s.id);
  const cleanups: (() => void)[] = [];
  const calm = () => kit.calm || reduced();
  const art = (file: string) => kit.artSrc(file);
  const link = (href: string, text: string) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);

  const bar = h('div.an-progress', { role: 'progressbar', 'aria-label': kit.ui('progress'), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, h('span.an-progress-fill'));
  root.append(bar);

  // ---------- photographs ----------
  /** A real photograph, whole, with its caption, credit and links. */
  const photo = (id: string, cls: string, attrs: Record<string, string> = {}): HTMLElement | null => {
    const a = ctx.data.art.find((x) => x.id === id);
    const p = kit.photo(id);
    if (!a || !p) return null;
    return h(
      `figure.an-photo.${cls}`,
      { 'data-photo': id, ...attrs },
      h('img', { 'data-src': p.src, alt: p.alt, decoding: 'async', draggable: 'false' }),
      h('figcaption.an-photo-credit', {}, p.caption ? h('span.an-photo-caption', {}, p.caption) : null, h('span', {}, p.credit, a.source ? [' · ', link(a.source, 'Wikimedia Commons')] : null, a.license_url ? [' · ', link(a.license_url, pick({ en: 'licence', ru: 'лицензия' }))] : null)),
    );
  };

  // ---------- the official recordings ----------
  const playButton = (r: Official, label: string): HTMLElement => {
    const b = h('button.btn.primary.ft-play.an-play', { type: 'button', 'data-play': r.youtube, 'aria-label': pick({ en: `Play “${r.title}”, ${r.artist}`, ru: `Слушать «${r.title}», ${r.artist}` }) }, h('span', { 'aria-hidden': 'true' }, '▶'), label);
    b.addEventListener('click', () => miniPlayer().play([{ ref: `feature:${r.youtube}`, label: `${r.artist} · ${r.title.replace(/ \(.*\)$/, '')}`, rec: { source: 'youtube', kind: 'official', youtube: r.youtube, title: r.title, channel: r.channel } }], 0));
    return b;
  };

  // ---------- scenes ----------
  const scene = (sc: Scene, stage: Element | null, opts: { after?: (Node | null)[]; screens?: number; long?: boolean; skip?: string[] } = {}): HTMLElement => {
    const el = kit.section(sc, { stage, skip: opts.skip, after: opts.after ?? [], screens: opts.screens ?? 1 });
    if (opts.long !== false) el.classList.add('ft-long');
    el.dataset.act = String(sc.act ?? '');
    return el;
  };
  const picture = (sc: Scene, overlay?: Node | null) => kit.art(sc, { overlay: overlay ?? (DEVELOP.has(sc.id) && sc.photo ? photo(String(sc.photo), 'an-develop', { 'data-develop-photo': '' }) : null) });
  const flowPhoto = (sc: Scene) => (IN_FLOW.has(sc.id) && sc.photo ? photo(String(sc.photo), 'an-inline') : null);

  let firstWord: HTMLElement | null = null;
  let strataSound: StrataSound | null = null;
  let invite: HTMLElement | null = null;
  const gate = new FlashGate();
  let pulsePage: { open(): void; close(): void; dispose(): void; el: HTMLElement } | null = null;

  const render = (sc: Scene): HTMLElement => {
    switch (sc.kind) {
      case 'line': {
        const pic = picture(sc);
        firstWord = h('p.an-first-word', { 'aria-hidden': 'true' });
        const el = scene(sc, pic?.el ?? null, {
          after: [playButton(ANGEL, pick({ en: 'Massive Attack, “Angel”', ru: 'Massive Attack, «Angel»' })), firstWord],
          screens: 1.3,
          long: false,
        });
        // The subtitle belongs to the title: one block, one line under it.
        const title = el.querySelector('[data-block="title"]');
        const sub = el.querySelector('[data-block="subtitle"]');
        const line = sub?.firstElementChild;
        if (title && sub && line) {
          line.classList.add('an-subtitle');
          title.append(line);
          sub.remove();
        }
        return el;
      }
      case 'then-now': {
        const pic = picture(sc);
        const oil = h('div.an-oil', { 'aria-hidden': 'true' }, ...((sc.art?.overlays ?? []) as ArtLayer[]).map((l) => h('img', { 'data-src': art(l.file), alt: '', decoding: 'async', draggable: 'false', 'data-oil': l.file.replace(/\.[a-z]+$/, '') })));
        const range = h('input.an-range', { type: 'range', min: '0', max: '100', step: '1', value: '0', 'aria-label': kit.ui('then-now-hint'), 'aria-valuetext': kit.ui('then') }) as HTMLInputElement;
        const slider = h('div.an-slider', {}, h('span.an-year', { 'aria-hidden': 'true' }, kit.ui('then')), range, h('span.an-year', { 'aria-hidden': 'true' }, kit.ui('now')));
        const el = scene(sc, pic?.el ?? null, { after: [slider, h('p.ft-hint', {}, kit.ui('then-now-hint')), playButton(ANDY, pick({ en: 'Horace Andy, “You Are My Angel”', ru: 'Хорас Энди, «You Are My Angel»' })), flowPhoto(sc)], screens: 1.6 });
        el.querySelector('.ft-stage')?.append(oil);
        const setTn = () => {
          const t = Number(range.value) / 100;
          el.style.setProperty('--tn', t.toFixed(2));
          range.setAttribute('aria-valuetext', t < 0.5 ? kit.ui('then') : kit.ui('now'));
          if (el.classList.contains('current')) beatAt(thenNowPeriod(t), 1 - t);
        };
        range.addEventListener('input', setTn);
        el.style.setProperty('--tn', '0');
        return el;
      }
      case 'studio': {
        const el = scene(sc, picture(sc)?.el ?? null, { after: [flowPhoto(sc)] });
        // The three figures, cut apart, drift a little further from one another as the reader goes on.
        const fig = el.querySelector<HTMLElement>('.al[data-layer="studio-r2-figures"]');
        if (fig) {
          const img = fig.querySelector('img')!;
          fig.replaceChildren(...[0, 1, 2].map((k) => {
            const c = img.cloneNode() as HTMLImageElement;
            if (k) c.alt = '';
            c.classList.add('an-third');
            c.style.setProperty('--third', String(k));
            return c;
          }));
        }
        return el;
      }
      case 'strata': {
        const clean = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        clean.setAttribute('class', 'an-clean');
        clean.setAttribute('viewBox', '0 0 100 10');
        clean.setAttribute('preserveAspectRatio', 'none');
        clean.setAttribute('aria-hidden', 'true');
        const pic = picture(sc, clean);
        const stacked = new Set<string>();
        strataSound = new StrataSound((loading) => el.classList.toggle('an-strata-loading', loading));
        const live = h('p.ft-visually-hidden', { 'aria-live': 'polite' });
        const buttons = STRATA.map((k) => {
          const b = h('button.btn.an-stratum', { type: 'button', 'aria-pressed': 'false', 'data-stratum': k }, kit.ui(`strata-${k}`)) as HTMLButtonElement;
          b.addEventListener('click', () => {
            if (stacked.has(k)) stacked.delete(k);
            else stacked.add(k);
            b.setAttribute('aria-pressed', String(stacked.has(k)));
            if (stacked.has(k)) miniPlayer().pause();
            strataSound?.set(k as Stratum, stacked.has(k));
            paintStrata();
          });
          return b;
        });
        const el = scene(sc, pic?.el ?? null, { after: [h('p.ft-hint', {}, kit.ui('strata-hint')), h('div.an-strata-btns', {}, ...buttons), h('p.ft-hint.an-strata-note', {}, kit.ui('strata-sound-note')), live, flowPhoto(sc)], screens: 1.4 });
        const svg = el.querySelector<SVGSVGElement>('svg.an-clean');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        svg?.append(path);
        let noise = 0;
        const draw = () => {
          const n = stacked.size;
          const amp = n === 0 ? 0 : (n * n) / 16;
          let d = 'M0 5';
          for (let x = 1; x <= 100; x += 1) d += ` L${x} ${(5 + (Math.random() * 2 - 1) * 4.6 * amp * (0.4 + Math.random() * 0.6)).toFixed(2)}`;
          path.setAttribute('d', d);
        };
        const paintStrata = () => {
          for (const k of STRATA) {
            const img = el.querySelector<HTMLElement>(`.al[data-layer="strata-r2-${k}"] img`);
            img?.style.setProperty('--y', stacked.has(k) ? `${STRATA_MEET - STRATA_ROW[k]}%` : '0%');
          }
          el.dataset.stacked = String(stacked.size);
          live.textContent = [...stacked].map((k) => kit.ui(`strata-${k}`)).join(' + ');
          draw();
          clearInterval(noise);
          if (stacked.size && !calm()) noise = window.setInterval(() => el.classList.contains('current') && draw(), 110);
        };
        cleanups.push(() => clearInterval(noise));
        draw();
        return el;
      }
      case 'beetle': {
        // The album's own cover, as every review of it shows.
        return scene(sc, sc.photo ? photo(String(sc.photo), 'an-stage-photo.an-cover') : null, { screens: 1 });
      }
      case 'break': {
        // The guitars come in: the man who played them, not a metaphor.
        return scene(sc, sc.photo ? photo(String(sc.photo), 'an-stage-photo') : null, { screens: 1.5, long: false });
      }
      case 'crowd':
        return scene(sc, bigVideo(VIDEO.youtube, { en: 'The official video of “Angel”', ru: 'Официальный клип «Angel»' }, { en: 'Massive Attack, “Angel”, official video', ru: 'Massive Attack, «Angel», официальный клип' }), { screens: 1.6 });
      case 'screens':
        // The scene from the film itself, in place of the pictures of screens.
        return scene(sc, bigVideo(SNATCH.youtube, { en: 'The scene from “Snatch” with “Angel”', ru: 'Сцена из «Большого куша» с «Angel»' }, { en: '“Snatch” (2000), the scene with “Angel”', ru: '«Большой куш» (2000), сцена с «Angel»' }), { screens: 1.6 });
      case 'afterlife': {
        const box = h('div.ft-art.an-after', {}, ...AFTER_STEPS.map((s, i) => photo(s.photo, 'an-step', { 'data-step': String(i) })));
        // The other lives of the song, one player at a time, turned with the arrows (a playing one stops when the reader turns on).
        const list = (sc.versions ?? []) as { youtube: string; en: string; ru: string }[];
        let at = 0;
        const frame = h('div.an-video');
        const caption = h('figcaption.an-version-title');
        const counter = h('span.an-version-count', { 'aria-live': 'polite' });
        const showVersion = (k: number) => {
          at = (k + list.length) % list.length;
          const v = list[at];
          const title = pick(v);
          const cover = h('button.an-video-cover', { type: 'button', 'aria-label': title },
            h('img', { src: `https://i.ytimg.com/vi/${v.youtube}/hqdefault.jpg`, alt: '', decoding: 'async', draggable: 'false' }),
            h('span.an-video-play', { 'aria-hidden': 'true' }, '▶'));
          cover.addEventListener('click', () => {
            miniPlayer().pause();
            frame.replaceChildren(h('iframe', { src: `https://www.youtube-nocookie.com/embed/${v.youtube}?autoplay=1&rel=0`, title, allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: '' }));
          });
          frame.replaceChildren(cover);
          caption.textContent = title;
          counter.textContent = `${at + 1} / ${list.length}`;
        };
        const arrow = (dir: -1 | 1) => h('button.btn.an-version-turn', { type: 'button', 'aria-label': dir < 0 ? pick({ en: 'Previous version', ru: 'Предыдущая версия' }) : pick({ en: 'Next version', ru: 'Следующая версия' }), onclick: () => showVersion(at + dir) }, dir < 0 ? '←' : '→');
        let shelf: HTMLElement | null = null;
        if (list.length) {
          showVersion(0);
          shelf = h('figure.an-versions', {}, frame, h('div.an-version-bar', {}, arrow(-1), counter, arrow(1)), caption);
        }
        const el = scene(sc, box, { after: [shelf], screens: 1 });
        el.dataset.step = '0';
        return el;
      }
      case 'warm': {
        invite = h('div.an-invite', { hidden: true });
        const last = h('p.ft-line.an-last', {}, kit.ui('last'));
        const el = scene(sc, picture(sc)?.el ?? null, { after: [h('div.an-warm-words', {}, invite, last)], screens: 1.3, long: false });
        return el;
      }
      default: {
        const el = scene(sc, picture(sc)?.el ?? null, { after: [flowPhoto(sc)], screens: sc.kind === 'fall' ? 1.2 : 1 });
        if (sc.silent) el.classList.add('an-silent');
        return el;
      }
    }
  };

  for (const sc of scenes) root.append(render(sc));
  // Where the reading ends (the progress bar counts up to here).
  const again = h('div.an-again', { 'aria-hidden': 'true' });
  root.append(again);

  // ---------- the mood ----------
  const watchers = ((scenes.find((s) => s.id === 'crowd')?.art?.overlays ?? []) as ArtLayer[]).map((l) => ({ src: art(l.file), alt: l.alt === '' ? '' : pick(l.alt) }));
  const fx = new MoodFx({ root, scroller: ctx.scroller, bar, title: 'Angel', calm, watchers, end: () => again.offsetTop });
  /** The light's beat: its period in seconds and how warm the page is. */
  const beatAt = (period: number, warmth: number) => {
    root.style.setProperty('--an-period', `${period.toFixed(3)}s`);
    root.style.setProperty('--an-warmth', warmth.toFixed(2));
  };
  beatAt(pulsePeriod(BPM_1998), 0);

  const step = (el: HTMLElement) => {
    let k = 0;
    AFTER_STEPS.forEach((s, i) => {
      const b = el.querySelector<HTMLElement>(`.ft-flow > [data-block="${s.from}"]`);
      if (b && b.getBoundingClientRect().top < innerHeight * 0.62) k = i;
    });
    if (el.dataset.step !== String(k)) el.dataset.step = String(k);
  };

  scenes.forEach((sc, i) => {
    kit.onProgress(sc.id, (p, el) => {
      if (el.classList.contains('current')) fx.set(anxietyAt(ids, i, p), sc.id);
      yieldStage(el, ctx.scroller);
      switch (sc.kind) {
        case 'crowd':
          el.dataset.shown = String(calm() ? 3 : crowdShown(p));
          break;
        case 'afterlife':
          step(el);
          break;
      }
    });
    kit.onEnter(sc.id, (el) => {
      fx.set(anxietyAt(ids, i, Number(el.dataset.p ?? 0)), sc.id);
      root.dataset.scene = sc.id;
      root.classList.toggle('an-warm', sc.id === 'kingston' || sc.id === 'warm');
      if (sc.id === 'then-now') {
        const t = Number(el.style.getPropertyValue('--tn') || 0);
        beatAt(thenNowPeriod(t), 1 - t);
      } else beatAt(pulsePeriod(BPM_1998), sc.id === 'kingston' || sc.id === 'warm' ? 1 : 0);
      if (sc.id === 'strata') strataSound?.resume();
      else strataSound?.pause();
      // The four tracks start loading a scene before they are needed, so the first button sounds at once.
      if (Math.abs(i - ids.indexOf('strata')) <= 1) strataSound?.preload();
      if (sc.id === 'break') breakdown(el);
      if (sc.id === 'crowd') vibrate([90, 60, 90, 60, 90]);
    });
  });

  /** The guitars: a red flash, once (never more than three a second), and a growl on a phone. */
  const breakdown = (el: HTMLElement) => {
    vibrate([60, 40, 60, 40, 120, 60, 220]);
    if (calm() || !gate.allow(performance.now())) return;
    el.classList.remove('an-flash');
    void el.offsetWidth;
    el.classList.add('an-flash');
  };



  // ---------- the readers' words and the pulse ----------
  void api.words(lang()).then((ws) => {
    const texts = ws.map((w) => w.text);
    fx.setWords(texts);
    // On the empty first screen one stranger's word surfaces, barely, and is gone.
    if (texts.length && firstWord) {
      firstWord.textContent = texts[Math.floor(Math.random() * texts.length)];
      firstWord.classList.add('on');
    }
  });
  // The end of the page: feel a pulse, leave one's own, say the words, and see them all together.
  // Asked for before the scenes rewrite the address.
  const askPulse = wantsPulse(location.hash);
  const ending = h('div.an-ending');
  root.append(ending);
  const pulseLink = pulseUrl(location.origin + location.pathname, lang());
  void import('./pulse/page').then((m) => {
    const page = new m.PulsePage({ host: ending, phone: isPhone(), qr: () => qrSvg(pulseLink, kit.ui('invite-qr'), 'an-qr-code'), say: (k, v) => kit.ui(k, v), engine: (k) => kit.ui(k), calm });
    pulsePage = page;
    const io = new IntersectionObserver((es) => {
      for (const e of es) e.isIntersecting ? page.open() : page.close();
    }, { rootMargin: '200px 0px' });
    io.observe(ending);
    cleanups.push(() => io.disconnect());
    if (askPulse) {
      // From the code on another screen: straight to the ending, once the scenes have laid themselves out.
      page.open();
      for (const ms of [400, 1200]) window.setTimeout(() => ending.scrollIntoView({ block: 'start' }), ms);
    }
  });
  const inv = invite as HTMLElement | null;
  if (inv) {
    inv.replaceChildren(h('p.an-invite-lead', {}, kit.ui('invite-lead')));
    inv.hidden = false;
    inv.closest('.an-warm-words')?.classList.add('has-invite');
  }

  cleanups.push(onCalm(() => queueMicrotask(() => fx.progress())));
  kit.start(ctx.scene);
  fx.progress();

  return {
    goTo: (s) => kit.goTo(s),
    current: () => kit.current(),
    dispose: () => {
      cleanups.forEach((c) => c());
      pulsePage?.dispose();
      strataSound?.dispose();
      fx.dispose();
      kit.dispose();
    },
  };
}
