// Forever Changes: Love's album of 1967 and Arthur Lee, as a page that
// comes apart song by song and is put back together. All words come from
// content/features/forever-changes; this file arranges them with their
// illustrations, and wires the lenses, the decay and the Arthur Lee mode.
import { h } from '../../lib/dom';
import { pick } from '../../lib/i18n';
import type { FeatureContext, FeatureInstance } from '../host';
import type { Scene } from '../model';
import type { Picture } from '../engine/layers';
import { decayAt, type DecayPoint } from '../engine/decay';
import { Kit } from '../engine/kit';
import { onCalm } from '../engine/calm';
import * as art from './art';
import { DecayFx, watcher } from './decay-fx';
import { moodAt } from './trip';
import { lensPane } from './lenses';
import { LeeMode, sortOverlays, type LeeChapter } from './lee/mode';
import { isPhone, LeePin, qrSvg } from './lee/pin';
import { wantsLee } from './lee/url';
import { ECHOES, SONGS, type Official } from './recordings';
import { miniPlayer } from '../../views/miniPlayer';
import { mediaSrc } from '../../lib/media';
import '../engine/engine.css';
import './forever-changes.css';

interface Song {
  n: number;
  side: 'a' | 'b';
  title: string;
  writer?: string;
  length?: string;
}

/**
 * Pictures that change as the text reaches each part of a chapter: the
 * art's state, the block from which it shows (`at`: once that share of the
 * block has come up the screen), and a real photograph that takes the
 * drawing's place for that part. The first step shows first.
 */
interface Step {
  state: string;
  from: string;
  at?: number;
  photo?: string;
}
const STEPS: Record<string, Step[]> = {
  prologue: [
    { state: 'memphis', from: 'kicker' },
    { state: 'dorsey', from: 'dorsey' },
    { state: 'love-named', from: 'byrds', photo: 'love-1966-ad' },
    { state: 'bido', from: 'holzman' },
    { state: 'red-book', from: 'holzman', at: 0.55, photo: 'love-red-book-ad' },
    { state: 'castle', from: 'tour' },
  ],
  after: [
    { state: 'after', from: 'kicker' },
    { state: 'prison', from: 'prison' },
  ],
  echoes: [
    { state: 'orchestra', from: 'kicker' },
    { state: 'echols', from: 'screen', photo: 'echols-2019' },
  ],
};
/** A photograph that develops out of the chapter's drawing as the reader goes on. */
const DEVELOP: Record<string, string> = { 'session-day': 'love-1967' };

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function mount(ctx: FeatureContext): FeatureInstance {
  const kit = new Kit(ctx);
  const root = ctx.root;
  root.classList.add('fc');
  kit.circlePlace = () => 'hidden';
  // This longread has no clap of its own: the songs play in the museum's player.
  ctx.tools.querySelector('.ft-sound')?.remove();
  const scenes = ctx.data.scenes;
  // The faces this longread sets its text in, fetched now, not when a chapter first needs one.
  for (const f of ['400 1em Literata', 'italic 400 1em Literata', '400 1em Fraunces', 'italic 400 1em Fraunces', '400 1em Inter', '600 1em Inter']) document.fonts?.load(f, 'Aa Аа').catch(() => {});
  const cleanups: (() => void)[] = [];
  const nameOf = (sc: Scene) => (sc.name ? pick(sc.name as { en: string; ru: string }) : (sc.blocks.find((b) => b.role === 'title') ? kit.text(sc.id, sc.blocks.find((b) => b.role === 'title')!.id) : sc.id));
  const aliasOf = (sc: Scene) => (sc.alias ? pick(sc.alias as { en: string; ru: string }) : undefined);

  // ---------- the bar: chapters, where we are, how far ----------
  const nowEl = h('span.fc-now', { 'aria-live': 'off' });
  const menuItems = scenes.map((sc) => {
    const label = h('span.fc-name', {}, nameOf(sc));
    const b = h('button.fc-menu-item', { type: 'button', 'data-go': sc.id, 'aria-label': nameOf(sc) }, label);
    b.addEventListener('click', () => {
      closeMenu();
      kit.goTo(sc.id, true);
    });
    return { sc, b, label };
  });
  const menu = h('nav.fc-menu', { hidden: true, 'aria-label': kit.ui('chapters') }, h('ol', {}, ...menuItems.map((m) => h('li', {}, m.b))));
  const menuBtn = h('button.btn.fc-menu-btn', { type: 'button', 'aria-expanded': 'false' }, kit.ui('chapters'));
  const closeMenu = () => {
    menu.hidden = true;
    menuBtn.setAttribute('aria-expanded', 'false');
  };
  menuBtn.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    menuBtn.setAttribute('aria-expanded', String(!menu.hidden));
  });
  menu.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    closeMenu();
    menuBtn.focus();
  });
  ctx.tools.prepend(h('div.fc-menubox', {}, menuBtn, menu));
  ctx.tools.prepend(nowEl);
  const bar = h('div.fc-progress', { role: 'progressbar', 'aria-label': kit.ui('progress'), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, h('span.fc-progress-fill'));
  root.append(bar);

  // ---------- scenes ----------
  const watch = watcher(kit.ui('watching'));
  const pictures = new Map<string, Picture>();
  // A real photograph inside a chapter's picture: whole, with its caption and credit (and links where the licence asks).
  const photo = (id: string, state?: string): HTMLElement | null => {
    const a = ctx.data.art.find((x) => x.id === id);
    const p = kit.photo(id);
    if (!a || !p) return null;
    const link = (href: string, text: string) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);
    return h(
      'figure.fc-photo',
      { 'data-photo': id, ...(state ? { 'data-state': state, 'aria-hidden': 'true' } : { 'data-develop-photo': '' }) },
      h('img', { 'data-src': p.src, alt: p.alt, decoding: 'async', draggable: 'false' }),
      h('figcaption.ft-credit.fc-photo-credit', {}, p.credit, a.source ? [' · ', link(a.source, 'Wikimedia Commons')] : null, a.license_url ? [' · ', link(a.license_url, pick({ en: 'licence', ru: 'лицензия' }))] : null),
    );
  };
  const photosOf = (sc: Scene): HTMLElement[] =>
    [...(STEPS[sc.id] ?? []).filter((st) => st.photo).map((st) => photo(st.photo!, st.state)), DEVELOP[sc.id] ? photo(DEVELOP[sc.id]) : null].filter((x): x is HTMLElement => !!x);
  const pictureOf = (sc: Scene, overlay?: Node | null): Picture | null => {
    const photos = photosOf(sc);
    const pic = kit.art(sc, { state: STEPS[sc.id]?.[0].state, overlay: photos.length || overlay ? h('div.fc-over', {}, overlay ?? null, ...photos) : null });
    if (pic) pictures.set(sc.id, pic);
    return pic;
  };
  const stageOf = (sc: Scene, overlay?: Node | null): Element | null => pictureOf(sc, overlay)?.el ?? null;

  const scene = (sc: Scene, stage: Element | null, opts: { after?: (Node | null)[]; screens?: number; long?: boolean; skip?: string[]; before?: Node | null } = {}): HTMLElement => {
    let el: HTMLElement | null = null;
    const pane = lensPane(kit, sc, () => el);
    el = kit.section(sc, { stage, skip: [...(pane?.blocks ?? []), ...(opts.skip ?? [])], after: [...(opts.before ? [opts.before] : []), ...(opts.after ?? []), pane?.el ?? null], screens: opts.screens ?? 1 });
    if (opts.long !== false) el.classList.add('ft-long');
    if (pane) el.dataset.lens = pane.el.dataset.lens;
    el.dataset.decayLevel = String(sc.decay ?? 0);
    return el;
  };

  // The album's cover, loaded at once: it is the first thing on the page.
  const cover = (where: 'stage' | 'flow'): HTMLElement | null => {
    const a = ctx.data.art.find((x) => x.id === 'cover');
    const p = kit.photo('cover');
    if (!a || !p) return null;
    const img = mediaSrc(ctx.app, a.file, [800]);
    return h(
      `figure.fc-cover.fc-cover-${where}`,
      {},
      h('img', { src: img.src, ...(img.srcset ? { srcset: img.srcset, sizes: '(min-width: 900px) 46vw, 100vw' } : {}), alt: p.alt, decoding: 'async', fetchpriority: 'high', draggable: 'false' }),
      h('figcaption.ft-credit.fc-photo-credit', {}, p.caption ? `${p.caption}. ` : null, p.credit),
    );
  };

  const render = (sc: Scene): HTMLElement | null => {
    switch (sc.kind) {
      case 'warning': {
        // The opening: the album's cover, the title, what this is, Lee's words, and the mode offered at once.
        // Beside the text on a wide screen; on a phone the text would run over it, so there it heads the text.
        const pic = cover('stage');
        const head = h('header.fc-cover-head', {}, pic ? cover('flow') : null, h('p.ft-kicker.fc-cover-kicker', {}, kit.ui('cover-kicker')), h('h1.ft-h1', {}, pick(ctx.data.title)), h('p.fc-cover-sub', {}, kit.ui('cover-sub')), ctx.data.reading ? h('p.ft-reading', {}, pick(ctx.data.reading)) : null);
        // Lee's words and who said them stay together, as one quotation.
        const said = sc.blocks.find((b) => b.role === 'quote');
        const who = sc.blocks.find((b) => b.role === 'caption');
        const quote = said ? h('figure.fc-epigraph', {}, h('blockquote.ft-quote', {}, pick({ en: said.en, ru: said.ru })), who ? h('figcaption.fc-epigraph-who', {}, pick({ en: who.en, ru: who.ru })) : null) : null;
        const go = h('button.btn.primary.fc-cover-go', { type: 'button' }, h('span.fc-lee-pin-eye', { 'aria-hidden': 'true' }), kit.ui('lee-open'));
        go.addEventListener('click', () => pin.press());
        const offer = h('div.fc-cover-mode', {}, h('p', {}, kit.ui('cover-mode')), go);
        return scene(sc, pic ?? stageOf(sc), { skip: [said?.id, who?.id].filter((x): x is string => !!x), before: head, after: [quote, offer], screens: 1, long: false });
      }
      case 'magazine':
      case 'after':
      case 'session':
      case 'orchestra':
        return scene(sc, stageOf(sc));
      case 'hillside':
        return scene(sc, stageOf(sc), { screens: 1.4 });
      case 'diary': {
        const el = scene(sc, stageOf(sc));
        el.classList.add('fc-diary');
        return el;
      }
      case 'song': {
        const song = sc.song as Song | undefined;
        // Someone is watching from the red telephone's picture.
        const stage = stageOf(sc, sc.id === 'the-red-telephone' ? watch.el : null);
        const rec = SONGS[sc.id];
        const el = scene(sc, stage, { after: [rec ? playButton(rec) : h('p.ft-none.fc-no-player', {}, kit.ui('no-recording'))] });
        el.dataset.side = song?.side ?? '';
        if (sc.id === 'live-and-let-live') scatter(el);
        return el;
      }
      case 'flip':
        return scene(sc, stageOf(sc), { long: false });
      case 'return':
        return scene(sc, stageOf(sc), { screens: 1.4 });
      case 'end':
        return scene(sc, stageOf(sc), { screens: 1.4, long: false });
      case 'echoes':
        return scene(sc, stageOf(sc), {
          after: [h('div.fc-plays', {}, h('p.fc-plays-label', {}, pick({ en: 'Other artists sing “Alone Again Or”', ru: 'Другие исполнители поют «Alone Again Or»' })), ...ECHOES.map((r) => playButton(r, r.year ? `${r.artist}, ${r.year}` : r.artist)))],
        });
      case 'lee': {
        const open = h('button.btn.primary.fc-lee-go', { type: 'button' }, kit.ui('lee-open'));
        open.addEventListener('click', () => openLee());
        const code = isPhone() ? null : h('figure.fc-lee-inline', {}, qrSvg(pin.url(), kit.ui('lee-qr')), h('figcaption', {}, kit.ui('lee-qr')));
        leeInline = code;
        return scene(sc, stageOf(sc), { after: [code, open], screens: 1.2 });
      }
      default:
        return null;
    }
  };

  // ---------- the official recordings, in the museum's docked player ----------
  const playButton = (r: Official, label?: string): HTMLElement => {
    const b = h(
      'button.btn.primary.ft-play.fc-play',
      { type: 'button', 'data-play': r.youtube, 'aria-label': pick({ en: `Play “${r.title}”, ${r.artist}${r.year ? `, ${r.year}` : ''}`, ru: `Слушать «${r.title}», ${r.artist}${r.year ? `, ${r.year}` : ''}` }) },
      h('span', { 'aria-hidden': 'true' }, '▶'),
      label ?? pick({ en: 'Play', ru: 'Слушать' }),
    );
    b.addEventListener('click', () => miniPlayer().play([{ ref: `feature:${r.youtube}`, label: `${r.artist} · ${r.title.replace(/ \(.*\)$/, '')}`, rec: { source: 'youtube', kind: 'official', youtube: r.youtube, title: r.title, channel: r.channel } }], 0));
    return b;
  };

  // ---------- the Arthur Lee mode, pinned ----------
  const visionsOf = (sc: Scene | undefined) => ((sc?.visions as string[] | undefined) ?? []).filter((v) => art.VISION_IDS.includes(v));
  const chapter = (id: string | undefined): LeeChapter => {
    const i = Math.max(0, scenes.findIndex((s) => s.id === id));
    const sc = scenes[i];
    return { id: sc?.id ?? 'warning', name: sc ? nameOf(sc) : '', visions: visionsOf(sc), hue: (0.92 + (i / scenes.length) * 0.75) % 1 };
  };
  // The mode's figures, faces and objects are the painted overlays of its own chapter.
  const overlays = sortOverlays(
    (scenes.find((x) => x.kind === 'lee')?.art?.overlays ?? []).map((l) => ({ file: l.file, src: ctx.app.media(`features/${ctx.data.id}/${l.file}`), alt: l.alt === '' ? '' : pick(l.alt) })),
  );
  const lee = new LeeMode({ host: root, say: (k, v) => kit.ui(k, v), phone: isPhone(), calm: () => kit.calm || reduced(), overlays });
  const pin = new LeePin({ host: root, say: (k) => kit.ui(k), current: () => kit.current() ?? ctx.scene, open: () => openLee() });
  let leeInline: HTMLElement | null = null;
  const openLee = () => lee.open(chapter(kit.current() ?? ctx.scene));

  for (const sc of scenes) {
    const el = render(sc);
    if (el) root.append(el);
  }

  // ---------- decay ----------
  const fx = new DecayFx({
    root,
    scroller: ctx.scroller,
    calm: () => kit.calm,
    bar,
    names: () => [...menuItems.map((m) => ({ el: m.label, alias: aliasOf(m.sc) })), { el: nowEl, alias: aliasOf(scenes.find((s) => s.id === kit.current()) ?? scenes[0]) }],
  });
  const points: DecayPoint[] = scenes.map((sc) => ({ decay: typeof sc.decay === 'number' ? sc.decay : 0, settle: sc.settle === true }));
  // The picture follows the text: the last step whose first block has come up the screen.
  const step = (sc: Scene, el: HTMLElement) => {
    const steps = STEPS[sc.id];
    const pic = pictures.get(sc.id);
    if (!steps || !pic) return;
    let state = steps[0].state;
    for (const st of steps) {
      const b = el.querySelector<HTMLElement>(`.ft-flow > [data-block="${st.from}"]`);
      if (!b) continue;
      const r = b.getBoundingClientRect();
      if (r.top + r.height * (st.at ?? 0) < innerHeight * 0.62) state = st.state;
    }
    if (pic.state === state) return;
    pic.setState(state);
    pic.el.querySelectorAll<HTMLElement>('.fc-photo[data-state]').forEach((f) => {
      const on = f.dataset.state === state;
      f.classList.toggle('al-on', on);
      f.setAttribute('aria-hidden', String(!on));
    });
  };
  const ids = scenes.map((sc) => sc.id);
  scenes.forEach((sc, i) => {
    kit.onProgress(sc.id, (p, el) => {
      step(sc, el);
      if (el.classList.contains('current')) fx.set(decayAt(points, i, p), el, moodAt(ids, i, p));
    });
    kit.onEnter(sc.id, (el) => {
      el.classList.add('entered');
      fx.set(decayAt(points, i, Number(el.dataset.p ?? 0)), el, moodAt(ids, i, Number(el.dataset.p ?? 0)));
      nowEl.textContent = nameOf(sc);
      delete nowEl.dataset.renamed;
      root.classList.toggle('ft-white', sc.kind === 'end');
      menuItems.forEach((m) => m.b.toggleAttribute('aria-current', m.sc.id === sc.id));
      pin.refresh();
      if (leeInline) leeInline.querySelector('svg')?.replaceWith(qrSvg(pin.url(), kit.ui('lee-qr')));
      if (lee.isOpen) lee.setChapter(chapter(sc.id));
    });
  });
  cleanups.push(onCalm(() => queueMicrotask(() => fx.apply())));
  const follow = (e: PointerEvent) => {
    if (root.classList.contains('fx-watching')) watch.follow(e.clientX, e.clientY);
  };
  ctx.scroller.addEventListener('pointermove', follow);
  cleanups.push(() => ctx.scroller.removeEventListener('pointermove', follow));

  kit.start(ctx.scene);
  fx.apply();
  if (wantsLee(location.hash)) openLee();

  return {
    goTo: (s) => kit.goTo(s),
    current: () => kit.current(),
    dispose: () => {
      cleanups.forEach((c) => c());
      lee.dispose();
      pin.dispose();
      fx.dispose();
      kit.dispose();
      document.body.classList.remove('fc-lee-on');
    },
  };
}

/** Live and Let Live: the title's words come apart and find their places again as the reader goes on. */
function scatter(section: HTMLElement): void {
  const t = section.querySelector('.ft-title');
  if (!t || t.querySelector('a')) return;
  const words = (t.textContent ?? '').split(/(\s+)/);
  t.replaceChildren(
    ...words.map((w, i) => {
      if (/^\s+$/.test(w)) return document.createTextNode(w);
      const k = (i * 7919) % 13;
      return h('span.fc-word', { style: `--dx:${(k - 6) * 9}px;--dy:${((k * 5) % 11) - 5}px;--r:${(k - 6) * 3}deg` }, w);
    }),
  );
}
