// Sea Lion Girls: the scenes of the longread, each a mechanic from the
// storyboard. All words come from content/features/sea-lion-girls; this file
// only arranges them, draws, and wires the sound.
import { h } from '../../lib/dom';
import { pick } from '../../lib/i18n';
import { audioContext } from '../../lib/sound';
import type { FeatureContext, FeatureInstance } from '../host';
import type { Figure, Frame, Scene } from '../model';
import { BEAT, clap } from '../engine/clap';
import { blot, develop, drawing, ink, s, sketch } from '../engine/ink';
import type { Picture } from '../engine/layers';
import { Kit, watchYouTubeTime } from '../engine/kit';
import * as art from './art';
import * as drawn from './drawn';
import { river, stop, syncYear } from './river';
import '../engine/engine.css';
import './sea-lion-girls.css';

type Render = (kit: Kit, sc: Scene) => HTMLElement;

/** The scene's generated layers, or the placeholder drawing until it has them. */
const picture = (kit: Kit, sc: Scene, placeholder: () => Element, opts: Parameters<Kit['art']>[1] = {}): Element => kit.art(sc, opts)?.el ?? placeholder();

/** The sketch each photographed stop develops out of. */
const MOTIF: Record<string, drawn.Motif> = { bass: 'desk', jazz: 'flute', beat: 'guitar', house: 'decks', feist: 'hands', kanye: 'pads', massive: 'stage' };
/** Drawings in code for the scenes still waiting for their generated art (ART-BRIEF-2). */
const DRAWN: Record<string, () => SVGSVGElement> = { words: drawn.words, burial: drawn.nightStreet, screen: drawn.projector, silence: drawn.silence };

/** A real photograph developing out of a drawing, shown whole on paper, with its caption and credit (and links where the licence asks). */
function print(kit: Kit, id: unknown, under: Element): HTMLElement | null {
  const p = kit.photo(id);
  if (!p) return null;
  const link = (href: string, text: string) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);
  return h(
    'figure.ft-photo.ft-print',
    { 'data-photo': String(id) },
    develop(under, { src: p.src, alt: p.alt }, 0.12, 0.45),
    h(
      'figcaption.ft-credit',
      {},
      p.caption ? h('span.ft-caption', {}, p.caption) : null,
      p.credit,
      p.source ? [' · ', link(p.source, pick({ en: 'source', ru: 'источник' }))] : null,
      p.license ? [' · ', link(p.license, pick({ en: 'licence', ru: 'лицензия' }))] : null,
    ),
  );
}

/** A scene's picture: its photo developing out of a sketch, its generated art, or its drawing in code; else `fallback`. */
function still(kit: Kit, sc: Scene, fallback?: () => Element): Element | null {
  const own = kit.art(sc)?.el ?? (DRAWN[sc.id] ? drawn.panel(sc.id, DRAWN[sc.id]()) : null);
  const photo = sc.photo ? print(kit, sc.photo, own ?? drawn.panel(sc.id, drawn.sketchOf(MOTIF[sc.id] ?? 'stage', sc.id.length * 131))) : null;
  return photo ?? own ?? fallback?.() ?? null;
}

/** The house: its layered picture with a door that opens, or the drawn placeholder. */
function house(kit: Kit, sc: Scene): { el: Element; open(on: boolean): void } {
  const pic: Picture | null = kit.art(sc, { state: 'closed' });
  if (pic) return { el: pic.el, open: (on) => pic.setState(on ? 'open' : 'closed') };
  const d = art.door();
  return { el: d, open: (on) => d.classList.toggle('open', on) };
}

/** The cover: the house with its door shut, the title, the lead, and the knock that turns the sound on. */
const door: Render = (kit, sc) => {
  const home = house(kit, sc);
  const btn = h('button.btn.primary.ft-knock', { type: 'button' }, kit.ui('knock')) as HTMLButtonElement;
  btn.addEventListener('click', () => {
    kit.unlock(true);
    kit.ctx.root.dataset.knocked = '';
    btn.disabled = true;
    btn.textContent = kit.ui('knocked');
  });
  const title = h('h1.ft-h1', {}, pick(kit.ctx.data.title));
  const block = (id: string) => {
    const b = sc.blocks.find((x) => x.id === id);
    return b ? kit.block(b) : null;
  };
  const later = ['lead', 'why-knock'];
  return kit.section(sc, { stage: home.el, skip: later, after: [title, block('lead'), btn, block('why-knock'), kit.ctx.data.reading ? h('p.ft-reading', {}, pick(kit.ctx.data.reading)) : null], screens: 1.4 });
};

/** 13 May 1939: the same door opens to the two strangers as the reader scrolls (open at once in calm mode). */
const arrival: Render = (kit, sc) => {
  const home = house(kit, sc);
  kit.onProgress(sc.id, (p) => home.open(kit.calm || p > 0.3));
  return kit.section(sc, { stage: home.el, screens: 2 });
};

const ringScene: Render = (kit, sc) => {
  const hear = h('button.btn.ft-hear', { type: 'button', 'aria-pressed': 'false' }, kit.ui('hear-clap'));
  hear.addEventListener('click', () => kit.setSound(kit.audio !== 'on'));
  const sync = () => hear.setAttribute('aria-pressed', String(kit.audio === 'on'));
  new MutationObserver(sync).observe(kit.ctx.root, { attributes: true, attributeFilter: ['data-audio'] });
  return kit.section(sc, { stage: kit.art(sc)?.el, after: [hear] });
};

const expedition: Render = (kit, sc) => {
  // Where the road leads: a pin on the horizon with the place's name above it.
  const place = kit.text(sc.id, 'byhalia');
  const overlay = drawing('0 0 1600 1067', 'art-over', ink(sketch([[150, 634], [146, 560], [150, 500]], 44, 2), 0.05, 0.3, { class: 'ink-line red route' }), blot(150, 636, 7, 'red'), art.label(96, 482, place, 'ink-label place', '0.2 0.35'));
  return kit.section(sc, { stage: picture(kit, sc, () => art.expedition(place), { overlay }) });
};

const family: Render = (kit, sc) => {
  const figs = (sc.figures as Figure[]) ?? [];
  const list = h(
    'ol.ft-figures',
    {},
    ...figs.map((f, i) => h(`li${f.lead ? '.lead' : ''}`, { 'data-figure': f.id, 'data-fade': `${0.1 + i * 0.1} ${0.3 + i * 0.1}` }, h('b', {}, pick(f.name)), h('span', {}, [f.age ? String(f.age) : '', f.role ? pick(f.role) : ''].filter(Boolean).join(' · ')))),
  );
  return kit.section(sc, { stage: h('div.ft-stack', {}, kit.art(sc)?.el ?? null, list), screens: 2.4 });
};

const minute: Render = (kit, sc) => {
  const loc = kit.node(sc.nodes?.[0] ?? '');
  return kit.section(sc, {
    stage: kit.art(sc)?.el,
    after: [loc ? kit.playButton(loc, kit.ui('play-1939')) : null, loc ? kit.credit(loc) : null, h('p.ft-hint', {}, kit.ui('clap-hint'))],
    screens: 2.6,
  });
};

const album: Render = (kit, sc) => {
  const paris = kit.text(sc.id, 'label-paris');
  const washington = kit.text(sc.id, 'label-washington');
  // Across the empty paper above the album: Washington to Paris, in red ink.
  const overlay = drawing(
    '0 0 1600 1067',
    'art-over',
    ink(sketch([[170, 300], [520, 170], [900, 140], [1230, 190], [1440, 290]], 96, 4), 0.45, 0.95, { class: 'ink-line red route' }),
    art.label(110, 360, washington, 'ink-label place', '0.4 0.55'),
    art.label(1330, 360, paris, 'ink-label place', '0.85 1'),
  );
  return kit.section(sc, { stage: picture(kit, sc, () => art.album(paris, washington), { overlay }), screens: 2.4 });
};

const simone: Render = (kit, sc) => {
  const n = kit.node(sc.nodes?.[0] ?? '');
  // The drawing at the piano develops into the photograph, when there is a cleared one.
  const photo = kit.photo(sc.photo);
  const drawn = picture(kit, sc, () => art.piano());
  const stage = photo ? h('figure.ft-photo', {}, develop(drawn, { src: photo.src, alt: photo.alt }, 0.25, 0.7), h('figcaption.ft-credit', {}, photo.credit)) : drawn;
  return kit.section(sc, { stage, after: [n ? kit.playButton(n) : null] });
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
      // Bass is credited on the B side only: "Mississippi Goddam" is Simone's own.
      side === 'b' ? h('span.sg-credit', {}, t('credit')) : null,
      side === 'b' ? h('span.sg-names', { 'data-develop': '0.35 0.8' }, t('names')) : null,
    );
  const disc = h('div.sg-disc', {}, face('a'), face('b'));
  const record = h('div.sg', { 'data-side': 'a' }, h('div.sg-vinyl', { 'aria-hidden': 'true' }), disc);
  // The record lies on the platter of a player on the table (generated art, when the scene has it).
  const table = h('div.sg-table', {}, kit.art(sc)?.el ?? drawn.panel('single', drawn.recordTable()), record);
  const live = h('p.sg-now.ft-visually-hidden', { 'aria-live': 'polite' });
  const flip = h('button.btn.primary.sg-flip', { type: 'button', 'aria-pressed': 'false' }, kit.ui('flip')) as HTMLButtonElement;
  flip.addEventListener('click', () => {
    const b = record.dataset.side !== 'b';
    record.dataset.side = b ? 'b' : 'a';
    flip.setAttribute('aria-pressed', String(b));
    live.textContent = `${kit.ui(b ? 'side-b' : 'side-a')}: ${t(b ? 'label-b' : 'label-a')}`;
  });
  return kit.section(sc, { stage: h('div.ft-stack', {}, table, live), after: [flip], screens: 2.6 });
};

const textScene: Render = (kit, sc) => kit.section(sc, { stage: still(kit, sc, () => art.page()) });

const riverScene: Render = (kit, sc) => {
  const r = river(kit, kit.art(sc));
  kit.onProgress(sc.id, (p) => r.grow(p));
  const el = kit.section(sc, { after: [r.el], screens: 1 });
  el.classList.add('ft-long');
  return el;
};

const stopScene: Render = (kit, sc) =>
  kit.section(sc, { stage: still(kit, sc, () => drawing('0 0 400 300', 'art-stop', ink(sketch([[200, 0], [196, 120], [204, 300]], sc.id.length * 7, 3), 0, 0.6, { class: 'ink-line river' }))), after: [stop(kit, sc.nodes ?? [])], screens: 1.6 });

/**
 * Paradise Circus: the clap of Simone's record runs under the whole song.
 * A thread of ink from the 2010 track back to 1964 and on to 1939 pulses
 * with it, on two and four, while the track plays in the docked player
 * (in time with it) or while the scene is on screen. Calm mode: still.
 */
export const CIRCUS_BEAT = 60 / 94;

const flashes: Render = (kit, sc) => {
  const node = sc.nodes?.[0] ?? '';
  const year = (id: string) => kit.node(id)?.year ?? '';
  const anchors = ((sc.threads as string[]) ?? []).map((id, i) => ({ id, x: 220 - i * 150, label: kit.text(sc.id, `label-${year(id)}`) || String(year(id)) }));
  const from = { x: 340, y: 150 };
  // 2010 → 1964, then 1964 → 1939: drawn as the scene opens, then pulsing.
  const threads = anchors.map((a, j) => {
    const d = j === 0 ? `M${from.x} ${from.y - 14} C${from.x} 95 ${a.x + 40} 60 ${a.x + 14} 60` : `M${anchors[j - 1].x - 14} 60 C${anchors[j - 1].x - 50} 25 ${a.x + 50} 25 ${a.x + 14} 60`;
    return ink(d, j * 0.06, 0.08 + j * 0.06, { class: `ink-line red thread t-${j}` });
  });
  const svg = drawing(
    '0 0 400 200',
    'art-flashes',
    ...anchors.map((a) => s('g', { class: 'fl-anchor' }, s('circle', { cx: a.x, cy: 60, r: 14, class: 'fl-year' }), art.label(a.x - 14, 64, a.label, 'ink-label small'))),
    ...threads,
    s('g', { class: 'fl-anchor fl-source' }, s('circle', { cx: from.x, cy: from.y, r: 14, class: 'fl-dot' }), art.label(from.x - 15, from.y + 36, String(year(node)), 'ink-label small')),
  );
  const pulse = () => {
    if (kit.calm) return;
    svg.classList.remove('pulse');
    void (svg as unknown as HTMLElement).getBoundingClientRect();
    svg.classList.add('pulse');
  };
  // Beats 2 and 4: every other beat, half a bar after the downbeat.
  const bar2 = CIRCUS_BEAT * 2;
  let last = -1;
  const stopYt = watchYouTubeTime();
  const t0 = performance.now() / 1000;
  const poll = window.setInterval(() => {
    const played = kit.playerTime(node);
    const onScreen = kit.current() === sc.id;
    if (played === null && !onScreen) return;
    const t = played ?? performance.now() / 1000 - t0;
    const k = Math.floor((t - CIRCUS_BEAT) / bar2);
    if (k !== last && t >= CIRCUS_BEAT) pulse();
    last = k;
  }, 50);
  cleanups.push(() => {
    clearInterval(poll);
    stopYt();
  });
  const photo = still(kit, sc);
  return kit.section(sc, { stage: photo ? h('div.ft-stack.fl-stack', {}, photo, svg) : svg, after: [stop(kit, sc.nodes ?? [])], screens: 2.4 });
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
  return kit.section(sc, { stage: still(kit, sc), after: [strip], screens: 1.4 });
};

const silence: Render = (kit, sc) => kit.section(sc, { stage: still(kit, sc), screens: 2 });

const classroom: Render = (kit, sc) => kit.section(sc, { stage: picture(kit, sc, () => art.classroom()), screens: 2.2 });

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
  // The door of the first scene, closed until the reader is well into the
  // finale, then open with the light behind it (open at once in calm mode).
  const home = house(kit, sc);
  home.el.classList.add('fn-door');
  kit.onProgress(sc.id, (p) => home.open(kit.calm || p > 0.3));
  const together = h('button.btn.primary.fn-together', { type: 'button' }, kit.ui('play-together'));
  together.addEventListener('click', () => {
    const loc = kit.node(sc.nodes?.[0] ?? '');
    if (loc) kit.play(loc);
    playTogether(kit);
  });
  const loc = kit.node(sc.nodes?.[0] ?? '');
  const artCredit = kit.generated ? h('p.ft-credit.ft-art-credit', {}, kit.ui('art-credit')) : null;
  return kit.section(sc, { stage: h('div.ft-stack', {}, label, home.el), skip: lines.map((b) => b.id), after: [together, loc ? kit.credit(loc) : null, artCredit], screens: 3 });
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

const RENDER: Record<string, Render> = { door, ring: ringScene, expedition, arrival, family, minute, album, simone, single, text: textScene, river: riverScene, stop: stopScene, flashes, filmstrip, silence, classroom, finale };

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
