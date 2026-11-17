// Forever Changes: Love's album of 1967 and Arthur Lee, as a page that
// comes apart song by song and is put back together. All words come from
// content/features/forever-changes; this file arranges them, draws the
// placeholders, and wires the lenses, the decay and the Arthur Lee mode.
import { h } from '../../lib/dom';
import { pick } from '../../lib/i18n';
import type { FeatureContext, FeatureInstance } from '../host';
import type { Scene } from '../model';
import { decayAt, type DecayPoint } from '../engine/decay';
import { Kit } from '../engine/kit';
import { isCalm, onCalm, setCalm } from '../engine/calm';
import * as art from './art';
import { DecayFx, watcher } from './decay-fx';
import { lensPane } from './lenses';
import { LeeMode, type LeeChapter } from './lee/mode';
import { isPhone, LeePin, qrSvg } from './lee/pin';
import { wantsLee } from './lee/url';
import { ECHOES, SONGS, type Official } from './recordings';
import { miniPlayer } from '../../views/miniPlayer';
import '../engine/engine.css';
import './forever-changes.css';

interface Song {
  n: number;
  side: 'a' | 'b';
  title: string;
  writer?: string;
  length?: string;
}

const GATE_KEY = 'sankofa.feature.forever-changes.entered';

function entered(): boolean {
  try {
    return sessionStorage.getItem(GATE_KEY) === '1';
  } catch {
    return false;
  }
}

function enter(): void {
  try {
    sessionStorage.setItem(GATE_KEY, '1');
  } catch {
    /* this page only */
  }
}

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function mount(ctx: FeatureContext): FeatureInstance {
  const kit = new Kit(ctx);
  const root = ctx.root;
  root.classList.add('fc');
  kit.circlePlace = () => 'hidden';
  // This longread has no clap of its own: the songs play in the museum's player.
  ctx.tools.querySelector('.ft-sound')?.remove();
  const scenes = ctx.data.scenes;
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
  const songs = scenes.filter((sc) => sc.kind === 'song' && sc.song).map((sc) => sc.song as Song);
  const watch = watcher(kit.ui('watching'));
  const stageOf = (sc: Scene, placeholder: () => Element | null): Element | null => kit.art(sc)?.el ?? placeholder();

  const scene = (sc: Scene, stage: Element | null, opts: { after?: (Node | null)[]; screens?: number; long?: boolean; skip?: string[]; before?: Node | null } = {}): HTMLElement => {
    let el: HTMLElement | null = null;
    const pane = lensPane(kit, sc, () => el);
    el = kit.section(sc, { stage, skip: [...(pane?.blocks ?? []), ...(opts.skip ?? [])], after: [...(opts.before ? [opts.before] : []), ...(opts.after ?? []), pane?.el ?? null], screens: opts.screens ?? 1 });
    if (opts.long !== false) el.classList.add('ft-long');
    if (pane) el.dataset.lens = pane.el.dataset.lens;
    el.dataset.decayLevel = String(sc.decay ?? 0);
    return el;
  };

  const flip = (sc: Scene): HTMLElement => {
    const side = (s: 'a' | 'b') =>
      h(`div.fc-face.fc-${s}`, {}, h('small', {}, kit.ui(`side-${s}`)), h('ol', {}, ...songs.filter((x) => x.side === s).map((x) => h('li', {}, x.title))));
    const record = h('div.fc-record', { 'data-side': 'a' }, art.disc(), h('div.fc-faces', {}, side('a'), side('b')));
    const live = h('p.ft-visually-hidden.fc-flip-now', { 'aria-live': 'polite' });
    const btn = h('button.btn.primary.fc-flip', { type: 'button', 'aria-pressed': 'false' }, kit.ui('flip')) as HTMLButtonElement;
    btn.addEventListener('click', () => {
      const b = record.dataset.side !== 'b';
      record.dataset.side = b ? 'b' : 'a';
      btn.setAttribute('aria-pressed', String(b));
      live.textContent = kit.ui(b ? 'side-b' : 'side-a');
      fx.freeze(1200);
    });
    return scene(sc, h('div.ft-stack', {}, record), { after: [btn, live], screens: 1.6, long: false });
  };

  const render = (sc: Scene): HTMLElement | null => {
    switch (sc.kind) {
      case 'warning': {
        const title = h('h1.ft-h1', {}, pick(ctx.data.title));
        // Lee's words and who said them stay together, as one quotation.
        const said = sc.blocks.find((b) => b.role === 'quote');
        const who = sc.blocks.find((b) => b.role === 'caption');
        const quote = said ? h('figure.fc-epigraph', {}, h('blockquote.ft-quote', {}, pick({ en: said.en, ru: said.ru })), who ? h('figcaption.fc-epigraph-who', {}, pick({ en: who.en, ru: who.ru })) : null) : null;
        return scene(sc, null, { skip: [said?.id, who?.id].filter((x): x is string => !!x), before: quote, after: [title, ctx.data.reading ? h('p.ft-reading', {}, pick(ctx.data.reading)) : null], screens: 1.2, long: false });
      }
      case 'magazine':
        return scene(sc, stageOf(sc, () => art.magazine(false)));
      case 'after':
        return scene(sc, stageOf(sc, () => art.magazine(true)));
      case 'hillside':
        return scene(sc, stageOf(sc, () => art.hillside()), { screens: 1.4 });
      case 'session':
        return scene(sc, stageOf(sc, () => art.studio()));
      case 'diary': {
        const el = scene(sc, stageOf(sc, () => art.diary()));
        el.classList.add('fc-diary');
        return el;
      }
      case 'orchestra':
        return scene(sc, stageOf(sc, () => art.score()));
      case 'song': {
        const song = sc.song as Song | undefined;
        const visions = (sc.visions as string[] | undefined) ?? [];
        const stage = stageOf(sc, () => (sc.id === 'the-red-telephone' ? h('div.ft-stack', {}, art.song(visions[0], song?.n ?? 0), watch.el) : art.song(visions[0], song?.n ?? 0)));
        const rec = SONGS[sc.id];
        const el = scene(sc, stage, { after: [rec ? playButton(rec) : h('p.ft-none.fc-no-player', {}, kit.ui('no-recording'))] });
        el.dataset.side = song?.side ?? '';
        if (sc.id === 'live-and-let-live') scatter(el);
        return el;
      }
      case 'flip':
        return flip(sc);
      case 'return':
        return scene(sc, stageOf(sc, () => art.stands()), { screens: 1.4 });
      case 'end':
        return scene(sc, null, { screens: 1.4, long: false });
      case 'echoes':
        return scene(sc, stageOf(sc, () => art.echoes()), {
          after: [h('div.fc-plays', {}, h('p.fc-plays-label', {}, pick({ en: 'Official recordings', ru: 'Официальные записи' })), ...ECHOES.map((r) => playButton(r, r.year ? `${r.artist}, ${r.year}` : r.artist)))],
        });
      case 'lee': {
        const open = h('button.btn.primary.fc-lee-go', { type: 'button' }, kit.ui('lee-open'));
        open.addEventListener('click', () => openLee());
        const code = isPhone() ? null : h('figure.fc-lee-inline', {}, qrSvg(pin.url(), kit.ui('lee-qr')), h('figcaption', {}, kit.ui('lee-qr')));
        leeInline = code;
        return scene(sc, null, { after: [code, open], screens: 1.2 });
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
  const lee = new LeeMode({ host: root, say: (k, v) => kit.ui(k, v), phone: isPhone() });
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
  const standsOf = (el: HTMLElement) => [...el.querySelectorAll<SVGGElement>('.fc-stand')];
  scenes.forEach((sc, i) => {
    kit.onProgress(sc.id, (p, el) => {
      if (sc.kind === 'return') {
        const st = standsOf(el);
        st.forEach((s, k) => s.classList.toggle('on', kit.calm || p > 0.1 + (k / st.length) * 0.7));
      }
      if (el.classList.contains('current')) fx.set(decayAt(points, i, p), el);
    });
    kit.onEnter(sc.id, (el) => {
      el.classList.add('entered');
      fx.set(decayAt(points, i, Number(el.dataset.p ?? 0)), el);
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

  // ---------- the door: a warning, and the choice ----------
  const gate = (): void => {
    const done = (full: boolean) => {
      enter();
      // With the system asking for less motion, "as it is" still stays calm.
      if (!full || !reduced()) setCalm(!full);
      fx.choose(true);
      el.remove();
      root.removeAttribute('data-gate');
      (ctx.scroller as HTMLElement).focus({ preventScroll: true });
    };
    const calmBtn = h('button.btn.fc-gate-calm', { type: 'button' }, kit.ui('gate-calm'));
    const fullBtn = h('button.btn.primary.fc-gate-full', { type: 'button' }, kit.ui('gate-full'));
    calmBtn.addEventListener('click', () => done(false));
    fullBtn.addEventListener('click', () => done(true));
    const el = h(
      'div.fc-gate',
      { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'fc-gate-title' },
      h('div.fc-gate-box', {}, h('h2', { id: 'fc-gate-title' }, kit.ui('gate-title')), h('p', {}, kit.ui('gate-text')), reduced() ? h('p.fc-gate-reduced', {}, kit.ui('gate-reduced')) : null, h('div.fc-gate-go', {}, calmBtn, fullBtn)),
    );
    root.dataset.gate = '';
    root.append(el);
    queueMicrotask(() => (isCalm() ? calmBtn : fullBtn).focus({ preventScroll: true }));
  };
  if (entered()) fx.choose(true);
  else gate();

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
