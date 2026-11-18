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
import { onCalm } from '../engine/calm';
import { Kit } from '../engine/kit';
import { isPhone, qrSvg } from '../engine/qr';
import * as api from './api';
import { MoodFx } from './fx';
import { anxietyAt, crowdShown, thenNowPeriod, pulsePeriod, BPM_1998 } from './mood';
import { ANDY, ANGEL, VIDEO, type Official } from './recordings';
import { pulseUrl, wantsPulse } from './url';
import { Oscilloscope } from './scope';
import '../engine/engine.css';
import './angel.css';

/** Scenes whose real photograph develops out of the drawing as the reader goes on. */
const DEVELOP = new Set(['kingston', 'bristol', 'studio', 'voice', 'beetle']);
/** Scenes whose photograph stands in the text column (the stage is busy with the mechanic). */
const IN_FLOW = new Set(['then-now', 'strata', 'spiral']);
/** The afterlife's photographs, each from the block it belongs to. */
const AFTER_STEPS: { from: string; photo: string }[] = [
  { from: 'berlin', photo: 'mezzanine-xxi' },
  { from: 'dub', photo: 'rock-en-seine-2024' },
  { from: 'still', photo: 'andy-moscow' },
];
const STRATA = ['bass', 'drums', 'voice', 'guitar'] as const;
/** Where each strip lies on the canvas (percent from the top) and where they meet. */
const STRATA_ROW: Record<(typeof STRATA)[number], number> = { bass: 13.7, drums: 39.6, voice: 59.9, guitar: 84 };
const STRATA_MEET = 50;

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const vibrate = (p: number[]) => {
  try {
    if (typeof navigator.vibrate === 'function') navigator.vibrate(p);
  } catch {
    /* not allowed yet */
  }
};

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
  const art = (file: string) => ctx.app.media(`features/${ctx.data.id}/${file}`);
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

  let scope: Oscilloscope | null = null;
  let firstWord: HTMLElement | null = null;
  let invite: HTMLElement | null = null;
  const gate = new FlashGate();
  let pulsePage: { open(): void; dispose(): void; isOpen: boolean } | null = null;
  const openPulse = async () => {
    if (!pulsePage) {
      const m = await import('./pulse/page');
      pulsePage = new m.PulsePage({ host: document.body, say: (k, v) => kit.ui(k, v), engine: (k) => kit.ui(k), calm });
    }
    pulsePage.open();
  };

  const render = (sc: Scene): HTMLElement => {
    switch (sc.kind) {
      case 'line': {
        scope = new Oscilloscope(calm);
        const pic = picture(sc, scope.el);
        firstWord = h('p.an-first-word', { 'aria-hidden': 'true' });
        const el = scene(sc, pic?.el ?? scope.el, {
          after: [playButton(ANGEL, pick({ en: 'Massive Attack, “Angel”', ru: 'Massive Attack, «Angel»' })), firstWord],
          screens: 1.3,
          long: false,
        });
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
        const el = scene(sc, picture(sc)?.el ?? null);
        // The three figures, cut apart, drift a little further from one another as the reader goes on.
        const fig = el.querySelector<HTMLElement>('.al[data-layer="studio-v1-figures"]');
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
        const live = h('p.ft-visually-hidden', { 'aria-live': 'polite' });
        const buttons = STRATA.map((k) => {
          const b = h('button.btn.an-stratum', { type: 'button', 'aria-pressed': 'false', 'data-stratum': k }, kit.ui(`strata-${k}`)) as HTMLButtonElement;
          b.addEventListener('click', () => {
            if (stacked.has(k)) stacked.delete(k);
            else stacked.add(k);
            b.setAttribute('aria-pressed', String(stacked.has(k)));
            paintStrata();
          });
          return b;
        });
        const el = scene(sc, pic?.el ?? null, { after: [h('p.ft-hint', {}, kit.ui('strata-hint')), h('div.an-strata-btns', {}, ...buttons), live, flowPhoto(sc)], screens: 1.4 });
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
            const img = el.querySelector<HTMLElement>(`.al[data-layer="strata-v1-${k}"] img`);
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
      case 'break': {
        const el = scene(sc, picture(sc)?.el ?? null, { screens: 1.5, long: false });
        el.classList.add('an-full');
        return el;
      }
      case 'crowd': {
        const el = scene(sc, picture(sc)?.el ?? null, { after: [playButton(VIDEO, pick({ en: 'The official video', ru: 'Официальный клип' }))], screens: 1.6 });
        return el;
      }
      case 'afterlife': {
        const box = h('div.ft-art.an-after', {}, ...AFTER_STEPS.map((s, i) => photo(s.photo, 'an-step', { 'data-step': String(i) })));
        const el = scene(sc, box, { screens: 1 });
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
  // After the warm screen the page does not end: scrolling on fades back into the bass of the opening.
  const again = h('div.an-again', { 'aria-hidden': 'true' });
  const returning = h('div.an-return', { 'aria-hidden': 'true' }, h('span.an-return-line'));
  root.append(again, returning);

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
      switch (sc.kind) {
        case 'crowd':
          el.dataset.shown = String(calm() ? 3 : crowdShown(p));
          break;
        case 'screens':
          el.dataset.lit = String(Math.min(2, Math.floor(p * 3)));
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
      if (sc.id === 'line') scope?.start();
      else scope?.stop();
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

  // ---------- the tail: back to the bass ----------
  let back = false;
  const tail = () => {
    if (back) return;
    const vh = ctx.scroller.clientHeight;
    const top = again.getBoundingClientRect().top - ctx.scroller.getBoundingClientRect().top;
    const t = Math.min(1, Math.max(0, 1 - top / vh));
    returning.style.opacity = t.toFixed(3);
    if (t < 0.97) return;
    // Under the dark, back to the opening; then the dark lifts and the bass is there again.
    back = true;
    returning.style.opacity = '1';
    ctx.scroller.scrollTo({ top: 0, behavior: 'auto' });
    window.setTimeout(() => {
      returning.classList.add('out');
      returning.style.opacity = '0';
      window.setTimeout(() => {
        returning.classList.remove('out');
        back = false;
      }, calm() ? 0 : 1700);
    }, 80);
  };
  ctx.scroller.addEventListener('scroll', tail, { passive: true });
  cleanups.push(() => ctx.scroller.removeEventListener('scroll', tail));

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
  void api.pulses().then((ps) => {
    if (!ps?.first || !invite) return;
    const url = pulseUrl(location.origin + location.pathname, lang());
    const here = h('button.btn.primary.an-feel', { type: 'button' }, kit.ui('invite-here'));
    here.addEventListener('click', () => void openPulse());
    invite.replaceChildren(
      h('p.ft-line.an-invite-line', {}, kit.ui('invite')),
      isPhone() ? here : h('figure.an-qr', {}, qrSvg(url, kit.ui('invite-qr'), 'an-qr-code'), h('figcaption', {}, kit.ui('invite-qr'))),
    );
    invite.hidden = false;
    invite.closest('.an-warm-words')?.classList.add('has-invite');
  });

  cleanups.push(onCalm(() => queueMicrotask(() => fx.progress())));
  kit.start(ctx.scene);
  fx.progress();
  if (wantsPulse(location.hash)) void openPulse();

  return {
    goTo: (s) => kit.goTo(s),
    current: () => kit.current(),
    dispose: () => {
      cleanups.forEach((c) => c());
      scope?.dispose();
      pulsePage?.dispose();
      fx.dispose();
      kit.dispose();
    },
  };
}
