// Sea Lion Girls: the scenes of the longread, each a mechanic from the
// storyboard. All words come from content/features/sea-lion-girls; this file
// only arranges them, draws, and wires the sound.
import { h } from '../../lib/dom';
import { pick } from '../../lib/i18n';
import { audioContext } from '../../lib/sound';
import type { FeatureContext, FeatureInstance } from '../host';
import { FlashGate, parseClock, formatClock, type Figure, type Frame, type Scene } from '../model';
import { BEAT, clap } from '../engine/clap';
import { drawing, ink, s, sketch } from '../engine/ink';
import { Kit, watchYouTubeTime } from '../engine/kit';
import * as art from './art';
import { river, stop, syncYear } from './river';
import '../engine/engine.css';
import './sea-lion-girls.css';

type Render = (kit: Kit, sc: Scene) => HTMLElement;

const door: Render = (kit, sc) => {
  const drawingEl = art.door();
  const opened = h('div.ft-opened', { 'aria-live': 'polite' });
  const btn = h('button.btn.primary.ft-knock', { type: 'button' }, kit.ui('knock')) as HTMLButtonElement;
  btn.addEventListener('click', () => {
    kit.unlock(true);
    kit.ctx.root.dataset.knocked = '';
    drawingEl.classList.add('open');
    btn.disabled = true;
    btn.textContent = kit.ui('knocked');
    opened.replaceChildren(kit.block(sc.blocks.find((b) => b.id === 'opened')!));
    opened.querySelector('.ft-block')?.classList.add('on');
  });
  const title = h('h1.ft-h1', {}, pick(kit.ctx.data.title));
  return kit.section(sc, { stage: drawingEl, skip: ['opened'], after: [title, btn, opened, kit.ctx.data.reading ? h('p.ft-reading', {}, pick(kit.ctx.data.reading)) : null], screens: 1.4 });
};

const ringScene: Render = (kit, sc) => {
  const hear = h('button.btn.ft-hear', { type: 'button', 'aria-pressed': 'false' }, kit.ui('hear-clap'));
  hear.addEventListener('click', () => kit.setSound(kit.audio !== 'on'));
  const sync = () => hear.setAttribute('aria-pressed', String(kit.audio === 'on'));
  new MutationObserver(sync).observe(kit.ctx.root, { attributes: true, attributeFilter: ['data-audio'] });
  return kit.section(sc, { stage: art.ring(), after: [hear] });
};

const expedition: Render = (kit, sc) => kit.section(sc, { stage: art.expedition(kit.text(sc.id, 'byhalia')) });

const family: Render = (kit, sc) => {
  const figs = (sc.figures as Figure[]) ?? [];
  const heights = figs.map((f) => (f.age && f.age >= 40 ? 1 : 0.8 + Math.min(0.18, ((f.age ?? 20) - 14) / 50)));
  const list = h(
    'ol.ft-figures',
    {},
    ...figs.map((f, i) => h(`li${f.lead ? '.lead' : ''}`, { 'data-figure': f.id, 'data-fade': `${0.1 + i * 0.1} ${0.3 + i * 0.1}` }, h('b', {}, pick(f.name)), h('span', {}, [f.age ? String(f.age) : '', f.role ? pick(f.role) : ''].filter(Boolean).join(' · ')))),
  );
  return kit.section(sc, { stage: h('div.ft-stack', {}, art.porch(heights, figs.map((f) => !!f.lead)), list), screens: 2.4 });
};

const minute: Render = (kit, sc) => {
  const loc = kit.node(sc.nodes?.[0] ?? '');
  return kit.section(sc, {
    stage: art.minute(),
    after: [loc ? kit.playButton(loc, kit.ui('play-1939')) : null, h('p.ft-hint', {}, kit.ui('clap-hint'))],
    screens: 2.6,
  });
};

const album: Render = (kit, sc) => kit.section(sc, { stage: art.album(kit.text(sc.id, 'label-paris'), kit.text(sc.id, 'label-washington')), screens: 2.4 });

const simone: Render = (kit, sc) => {
  const n = kit.node(sc.nodes?.[0] ?? '');
  return kit.section(sc, { stage: art.piano(), after: [n ? kit.playButton(n) : null] });
};

const single: Render = (kit, sc) => {
  const t = (id: string) => kit.text(sc.id, id);
  const face = (side: 'a' | 'b') =>
    h(
      `div.sg-face.sg-${side}`,
      {},
      h('span.sg-hole', { 'aria-hidden': 'true' }),
      h('small.sg-side', {}, kit.ui(`side-${side}`)),
      h('b.sg-title', {}, t(`label-${side}`)),
      h('span.sg-credit', {}, t('credit')),
      side === 'b' ? h('span.sg-names', { 'data-develop': '0.35 0.8' }, t('names')) : null,
    );
  const disc = h('div.sg-disc', {}, face('a'), face('b'));
  const record = h('div.sg', { 'data-side': 'a' }, h('div.sg-vinyl', { 'aria-hidden': 'true' }), disc);
  const live = h('p.sg-now.ft-visually-hidden', { 'aria-live': 'polite' });
  const flip = h('button.btn.primary.sg-flip', { type: 'button', 'aria-pressed': 'false' }, kit.ui('flip')) as HTMLButtonElement;
  flip.addEventListener('click', () => {
    const b = record.dataset.side !== 'b';
    record.dataset.side = b ? 'b' : 'a';
    flip.setAttribute('aria-pressed', String(b));
    live.textContent = `${kit.ui(b ? 'side-b' : 'side-a')}: ${t(b ? 'label-b' : 'label-a')}`;
  });
  return kit.section(sc, { stage: h('div.ft-stack', {}, record, live), after: [flip], screens: 2.6 });
};

const textScene: Render = (kit, sc) => kit.section(sc, { stage: art.page() });

const riverScene: Render = (kit, sc) => {
  const r = river(kit);
  kit.onProgress(sc.id, (p) => r.grow(p));
  const el = kit.section(sc, { after: [r.el], screens: 1 });
  el.classList.add('ft-long');
  return el;
};

const stopScene: Render = (kit, sc) => kit.section(sc, { stage: drawing('0 0 400 300', 'art-stop', ink(sketch([[200, 0], [196, 120], [204, 300]], sc.id.length * 7, 3), 0, 0.6, { class: 'ink-line river' })), after: [stop(kit, sc.nodes ?? [])], screens: 1.6 });

const flashes: Render = (kit, sc) => {
  const times = ((sc.flashes as (string | number)[]) ?? []).map(parseClock);
  const end = Math.max(...times, 0) + 60;
  const W = 400;
  const x = (t: number) => 20 + (t / end) * (W - 40);
  const anchors = ((sc.threads as string[]) ?? []).map((id, i) => ({ id, x: 40 + i * 70, label: kit.text(sc.id, `label-${kit.node(id)?.year ?? ''}`) || String(kit.node(id)?.year ?? '') }));
  const marks = times.map((t, i) =>
    s('g', { class: 'fl-mark', 'data-at': t, 'data-i': i }, s('circle', { cx: x(t), cy: 220, r: 9, class: 'fl-dot' }), art.label(x(t) - 14, 250, formatClock(t), 'ink-label small')),
  );
  const threads = times.flatMap((t, i) =>
    anchors.map((a, j) => ink(`M${x(t)} 210 C${x(t)} ${150 - j * 30} ${a.x + 40} ${120 - j * 30} ${a.x} ${70 - j * 0}`, 0.2 + i * 0.15, 0.45 + i * 0.15, { class: `ink-line red thread t-${j}` })),
  );
  const svg = drawing(
    `0 0 ${W} 280`,
    'art-flashes',
    ink(sketch([[20, 220], [W - 20, 220]], 140, 0.8), 0, 0.2),
    ...anchors.map((a) => s('g', { class: 'fl-anchor' }, s('circle', { cx: a.x, cy: 60, r: 14, class: 'fl-year' }), art.label(a.x - 14, 64, a.label, 'ink-label small'))),
    ...threads,
    ...marks,
  );
  const gate = new FlashGate(3, 1000);
  const light = (i: number) => {
    const m = marks[i];
    if (!m) return;
    m.classList.add('seen');
    if (kit.calm || !gate.allow(performance.now())) return;
    m.classList.remove('lit');
    void (m as unknown as HTMLElement).getBoundingClientRect();
    m.classList.add('lit');
  };
  const show = h('button.btn.fl-show', { type: 'button' }, kit.ui('show-flashes'));
  show.addEventListener('click', () => times.forEach((_, i) => window.setTimeout(() => light(i), i * 1100)));
  // While the track plays in the docked player, its claps flash on time.
  const node = sc.nodes?.[0] ?? '';
  let last = -1;
  const stopYt = watchYouTubeTime();
  const poll = window.setInterval(() => {
    const t = kit.playerTime(node);
    if (t === null) return;
    times.forEach((at, i) => {
      if (last < at && t >= at) light(i);
    });
    last = t;
  }, 250);
  cleanups.push(() => {
    clearInterval(poll);
    stopYt();
  });
  return kit.section(sc, { stage: svg, after: [show, stop(kit, sc.nodes ?? [])], screens: 2.4 });
};

const filmstrip: Render = (kit, sc) => {
  const frames = (sc.frames as Frame[]) ?? [];
  const strip = h(
    'ol.fs',
    { tabindex: '0', 'aria-label': kit.ui('filmstrip') },
    ...frames.map((f, i) => {
      const n = f.node ? kit.node(f.node) : undefined;
      const y = syncYear(kit, f.work);
      return h('li.fs-frame', { 'data-work': f.work }, art.frame(i), h('b.fs-year', {}, y ? String(y) : ''), h('p', {}, pick(f.caption)), n?.play ? kit.playButton(n) : null);
    }),
  );
  return kit.section(sc, { after: [strip], screens: 1.4 });
};

const silence: Render = (kit, sc) => kit.section(sc, { screens: 2 });

const classroom: Render = (kit, sc) => kit.section(sc, { stage: art.classroom(), screens: 2.2 });

const finale: Render = (kit, sc) => {
  const credit = kit.text('single', 'credit');
  const lines = sc.blocks.filter((b) => b.role === 'quote');
  const label = h(
    'div.fn-label',
    {},
    h('span.sg-hole', { 'aria-hidden': 'true' }),
    h('span.fn-old', { 'data-develop': '0.15 0.5' }, credit),
    h('div.fn-new', { 'data-develop': '0.3 0.75' }, ...lines.map((b) => h('span', {}, pick(b)))),
  );
  const doorEl = art.door();
  doorEl.classList.add('open', 'fn-door');
  kit.onProgress(sc.id, (p) => doorEl.classList.toggle('open', kit.calm ? false : p < 0.85));
  const together = h('button.btn.primary.fn-together', { type: 'button' }, kit.ui('play-together'));
  together.addEventListener('click', () => {
    const loc = kit.node(sc.nodes?.[0] ?? '');
    if (loc) kit.play(loc);
    playTogether(kit);
  });
  return kit.section(sc, { stage: h('div.ft-stack', {}, label, doorEl), skip: lines.map((b) => b.id), after: [together], screens: 3 });
};

/** Four bars of the reader's claps (where they fell on the circle) and the children's, over the 1939 voices. */
function playTogether(kit: Kit): void {
  const ctx = audioContext();
  const t0 = ctx.currentTime + 0.1;
  const bar = BEAT * 4;
  const mine = kit.circle.claps.slice(-24);
  for (let b = 0; b < 4; b++) {
    for (const d of mine) clap(ctx, t0 + b * bar + (d.angle / 360) * bar, 0.22, 1.05);
    // The children: a ragged handful on two and four.
    for (const beat of [1, 3])
      for (let k = 0; k < 5; k++) clap(ctx, t0 + b * bar + beat * BEAT + (((k * 37) % 30) - 15) / 1000, 0.1, 0.9 + k * 0.05);
  }
  kit.ctx.root.dataset.together = '';
  window.setTimeout(() => delete kit.ctx.root.dataset.together, bar * 4 * 1000);
}

const RENDER: Record<string, Render> = { door, ring: ringScene, expedition, family, minute, album, simone, single, text: textScene, river: riverScene, stop: stopScene, flashes, filmstrip, silence, classroom, finale };

let cleanups: (() => void)[] = [];

export function mount(ctx: FeatureContext): FeatureInstance {
  cleanups = [];
  const kit = new Kit(ctx);
  const scenes = ctx.data.scenes.filter((sc) => RENDER[sc.kind]);
  for (const sc of scenes) ctx.root.append(RENDER[sc.kind](kit, sc));
  const minuteAt = scenes.findIndex((sc) => sc.kind === 'minute');
  const stageAt = new Set(['minute', 'finale']);
  kit.clapScenes = new Set(scenes.filter((sc) => ['minute', 'classroom', 'finale'].includes(sc.kind)).map((sc) => sc.id));
  kit.circlePlace = (id, i) => {
    const kind = scenes.find((sc) => sc.id === id)?.kind ?? '';
    if (minuteAt < 0 || i < minuteAt) return 'hidden';
    return stageAt.has(kind) ? 'stage' : 'corner';
  };
  const quiet = new Set(scenes.filter((sc) => sc.kind === 'silence').map((sc) => sc.id));
  for (const sc of scenes) kit.onEnter(sc.id, (el) => {
    kit.hush(quiet.has(sc.id));
    ctx.root.classList.toggle('ft-white', quiet.has(sc.id));
    el.classList.add('entered');
  });
  kit.start(ctx.scene);
  return {
    goTo: (scene) => kit.goTo(scene),
    current: () => kit.current(),
    dispose: () => {
      cleanups.forEach((c) => c());
      cleanups = [];
      kit.dispose();
    },
  };
}
