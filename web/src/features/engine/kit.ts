// The kit a feature is built with: scene sections with a sticky stage and a
// flow of text, the text itself (bilingual, from the content files, through
// the dictionary linker), the sound switch on every screen, calm mode with
// the system's reduce-motion setting, the
// reader's clap circle, and the bridge to the museum's docked player.
import { richText } from '../../app';
import { h } from '../../lib/dom';
import { plain } from '../../lib/links';
import { pick } from '../../lib/i18n';
import type { Recording } from '../../lib/listen';
import { audioContext } from '../../lib/sound';
import { miniPlayer } from '../../views/miniPlayer';
import type { FeatureContext } from '../host';
import type { LineageNode } from '../lineage';
import type { Bi, Block, Scene } from '../model';
import { isCalm, onCalm } from './calm';
import { ClapCircle } from './circle';
import { BEAT, clap, ClapBed, knock } from './clap';
import { inkDefs, LivingInk } from './ink';
import { clapInk, layered, type Picture } from './layers';
import { Scroller } from './scroll';

const TEXT_TAG: Record<string, string> = { kicker: 'p.ft-kicker', title: 'h2.ft-title', lede: 'p.ft-lede', text: 'p.ft-text', caption: 'p.ft-caption', line: 'p.ft-line', quote: 'p.ft-quote', note: 'p.ft-note' };

export interface SceneParts {
  /** The sticky picture (drawings, the mechanic). */
  stage?: Node | null;
  /** Controls placed after the text in the flow. */
  after?: (Node | null)[];
  /** Blocks not to put in the flow (shown by the stage instead). */
  skip?: string[];
  /** How many screens tall the scene is (its scroll length). */
  screens?: number;
}

export type AudioState = 'locked' | 'on' | 'off';

export class Kit {
  readonly ctx: FeatureContext;
  readonly ink: LivingInk;
  readonly circle: ClapCircle;
  readonly bed: ClapBed;
  private scroller?: Scroller;
  private sceneEls: HTMLElement[] = [];
  private enter = new Map<string, (el: HTMLElement) => void>();
  private progress = new Map<string, (p: number, el: HTMLElement) => void>();
  private disposers: (() => void)[] = [];
  private soundBtn: HTMLButtonElement;
  private nodes: Map<string, LineageNode>;
  /** Scenes where the space bar claps rather than scrolls. */
  clapScenes = new Set<string>();
  /** Where the circle is, by scene. */
  circlePlace: (sceneId: string, index: number) => 'hidden' | 'stage' | 'corner' = () => 'corner';
  audio: AudioState = 'locked';
  private wanted = true;

  constructor(ctx: FeatureContext) {
    this.ctx = ctx;
    this.nodes = new Map((ctx.data.lineage?.nodes ?? []).map((n) => [n.id, n]));
    const defs = inkDefs();
    ctx.root.append(defs);
    this.ink = new LivingInk(defs);
    this.bed = new ClapBed(ctx.root);
    this.bed.onBeat = (b) => {
      this.circle.pulse(b);
      // Ink spreads where the drawn hands meet, with the bed, on two and four.
      if (b % 2 === 1) this.clapInk();
    };
    this.bed.onStop = () => this.setAudio(this.audio === 'locked' ? 'locked' : 'off');
    this.circle = new ClapCircle(`sankofa.feature.${ctx.data.id}.claps`, this.ui('clap-circle'), (n) => this.ui('clap-count', { n }));
    this.circle.onClap = () => this.tap();
    ctx.root.append(this.circle.el);

    this.soundBtn = h('button.btn.ft-sound', { type: 'button', 'aria-pressed': 'false' }, h('span.ft-sound-ic', { 'aria-hidden': 'true' }), h('span.ft-sound-tx')) as HTMLButtonElement;
    this.soundBtn.addEventListener('click', () => this.setSound(this.audio !== 'on'));
    ctx.tools.replaceChildren(this.soundBtn);
    this.applyCalm(isCalm());
    this.disposers.push(onCalm((on) => this.applyCalm(on)));
    this.setAudio('locked');

    // In a clapping scene the space bar always claps, even when a button such as the
    // sound switch still has focus (otherwise Space would press that button instead).
    const clapping = (e: KeyboardEvent): boolean => {
      if (e.key !== ' ' || e.ctrlKey || e.metaKey || e.altKey) return false;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, select, textarea, [contenteditable]')) return false;
      if (t && !ctx.root.contains(t) && t !== document.body && !ctx.scroller.contains(t)) return false;
      const cur = this.scroller?.currentScene()?.dataset.scene;
      return !!cur && this.clapScenes.has(cur);
    };
    const down = (e: KeyboardEvent) => {
      if (!clapping(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) this.tap();
    };
    const up = (e: KeyboardEvent) => {
      if (clapping(e)) e.preventDefault();
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    this.disposers.push(() => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
    });
  }

  // ---------- text ----------

  say(b: Bi): string {
    return pick(b);
  }

  /** A label: the feature's own first, then the engine's, with {vars} filled in. */
  ui(key: string, vars: Record<string, string | number> = {}): string {
    const b = this.ctx.data.ui[key] ?? this.ctx.ui[key];
    const t = b ? pick(b) : key;
    return t.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
  }

  scene(id: string): Scene | undefined {
    return this.ctx.data.scenes.find((s) => s.id === id);
  }

  /** A block's text, from any scene. */
  text(sceneId: string, blockId: string): string {
    const b = this.scene(sceneId)?.blocks.find((x) => x.id === blockId);
    return b ? plain(pick(b)) : '';
  }

  /** The text blocks of a scene as elements (labels are for drawings and are left out). */
  blocks(sc: Scene, skip: string[] = []): HTMLElement[] {
    return sc.blocks.filter((b) => b.role !== 'label' && !skip.includes(b.id)).map((b) => this.block(b));
  }

  block(b: Block): HTMLElement {
    // Kickers are signposts ("1967 · jazz"): the dictionary is linked from the text under them.
    return h(`div.ft-block.ft-b-${b.role}`, { 'data-block': b.id, ...(b.draft ? { 'data-draft': '' } : {}), ...(b.role === 'kicker' ? { 'data-no-link': '' } : {}) }, h(TEXT_TAG[b.role] ?? 'p', {}, richText(this.ctx.app, pick(b))));
  }

  // ---------- scenes ----------

  section(sc: Scene, parts: SceneParts): HTMLElement {
    const title = sc.blocks.find((b) => b.role === 'kicker' || b.role === 'title' || b.role === 'line');
    const el = h(
      `section.ft-scene.ft-k-${sc.kind}`,
      { id: `scene-${sc.id}`, 'data-scene': sc.id, 'aria-label': title ? pick(title) : sc.id, style: `--screens:${parts.screens ?? 2}` },
      h('div.ft-stage', {}, parts.stage ?? null),
      h('div.ft-flow', {}, ...this.blocks(sc, parts.skip), ...(parts.after ?? []).filter((x): x is Node => !!x).map((n) => h('div.ft-block.ft-controls', {}, n))),
    );
    this.sceneEls.push(el);
    return el;
  }

  onEnter(sceneId: string, cb: (el: HTMLElement) => void): void {
    this.enter.set(sceneId, cb);
  }

  onProgress(sceneId: string, cb: (p: number, el: HTMLElement) => void): void {
    this.progress.set(sceneId, cb);
  }

  /** Start scrolling: call once every scene is in the page. */
  start(initial?: string): void {
    this.scroller = new Scroller({
      root: this.ctx.scroller,
      scenes: this.sceneEls,
      onProgress: (el, p) => {
        this.ink.draw(el, p);
        this.progress.get(el.dataset.scene!)?.(p, el);
      },
      onCurrent: (el, i) => {
        const id = el.dataset.scene!;
        this.circle.setPlace(this.circlePlace(id, i));
        this.ctx.onScene(id);
        this.enter.get(id)?.(el);
      },
    });
    if (this.ink.calm) this.scroller.revealAll();
    for (const el of this.sceneEls) this.ink.draw(el, 0);
    // A link to a scene opens there before the first frame says where we are.
    if (initial) this.goTo(initial);
  }

  goTo(id: string | undefined, smooth = false): void {
    const el = this.sceneEls.find((s) => s.dataset.scene === id) ?? this.sceneEls[0];
    if (el && this.scroller) this.scroller.goTo(el, smooth && !this.ink.calm);
    // A jump stays quiet about the scene change, but the circle must still find its place.
    if (el && !smooth) this.circle.setPlace(this.circlePlace(el.dataset.scene!, this.sceneEls.indexOf(el)));
  }

  current(): string | undefined {
    return this.scroller?.currentScene()?.dataset.scene;
  }

  // ---------- calm ----------

  private applyCalm(on: boolean): void {
    this.ink.calm = on;
    this.ctx.root.classList.toggle('is-calm', on);
    if (on) this.scroller?.revealAll();
    // Redraw every scene where it stands, and let its mechanics settle too (a door that opens, a river grown).
    for (const el of this.sceneEls) {
      const p = Number(el.dataset.p ?? 0);
      this.ink.draw(el, p);
      this.progress.get(el.dataset.scene!)?.(p, el);
    }
  }

  get calm(): boolean {
    return this.ink.calm;
  }

  // ---------- sound ----------

  /** The first gesture: unlock sound (and knock). Call from a click. */
  unlock(withKnock = false): void {
    const ctx = audioContext();
    if (withKnock) knock(ctx);
    if (this.audio === 'locked') this.setSound(this.wanted);
  }

  setSound(on: boolean): void {
    this.wanted = on;
    if (on) {
      audioContext();
      this.bed.play();
      this.setAudio('on');
    } else {
      this.bed.stop();
      this.setAudio('off');
    }
  }

  /** Quiet the bed for a stretch (the silence) without changing the reader's choice. */
  hush(quiet: boolean): void {
    if (quiet) {
      if (this.bed.running) {
        this.bed.stop();
        this.setAudio('on');
        this.ctx.root.dataset.hushed = '';
      }
    } else if (this.ctx.root.dataset.hushed !== undefined) {
      delete this.ctx.root.dataset.hushed;
      if (this.wanted && this.audio === 'on') this.bed.play();
    }
  }

  private setAudio(st: AudioState): void {
    this.audio = st;
    this.ctx.root.dataset.audio = st;
    this.soundBtn.setAttribute('aria-pressed', String(st === 'on'));
    this.soundBtn.querySelector('.ft-sound-tx')!.textContent = this.ui(st === 'on' ? 'sound-on' : 'sound-off');
  }

  /** The reader claps: a sound (once unlocked) and a drop on the circle. */
  tap(): void {
    if (this.audio === 'locked') this.unlock();
    const ctx = audioContext();
    clap(ctx, ctx.currentTime, 0.32);
    this.clapInk();
    this.circle.add(this.bed.running ? { now: ctx.currentTime, start: this.bed.start, beat: BEAT } : undefined);
  }

  // ---------- recordings ----------

  node(id: string): LineageNode | undefined {
    return this.nodes.get(id);
  }

  /** A node's recording for the docked player, when it has one. */
  recording(n: LineageNode): Recording | undefined {
    if (!n.play) return undefined;
    if (n.play.source === 'youtube') return { source: 'youtube', kind: 'official', youtube: n.play.youtube, title: n.title, channel: n.artist };
    return { source: 'audio', kind: 'field', audio: n.play.audio, title: n.title, channel: this.ui('loc-credit') };
  }

  /** The credit an archive recording plays under, with the way to its own page. */
  credit(n: LineageNode): HTMLElement | null {
    if (n.play?.source !== 'audio') return null;
    return h('p.ft-credit', { 'data-credit': n.id }, this.ui('loc-credit'), ' ', n.link ? h('a', { href: n.link, target: '_blank', rel: 'noopener noreferrer' }, this.ui('loc-item')) : null);
  }

  /** A scene's generated illustration as layers (null when it has none yet). */
  art(sc: Scene, opts: { state?: string; overlay?: Node | null } = {}): Picture | null {
    if (!sc.art?.layers?.length) return null;
    return layered(sc.art, (file) => this.ctx.app.media(`features/${this.ctx.data.id}/${file}`), { name: sc.id, ...opts });
  }

  /** A clap shows in the current scene's picture as ink where hands meet (not in calm mode). */
  private clapInk(): void {
    if (!this.ink.calm) clapInk(this.ctx.root);
  }

  /** Whether any scene shows generated art (the closing credits say so once). */
  get generated(): boolean {
    return this.ctx.data.scenes.some((sc) => sc.art?.generated);
  }

  /** A real photo from the feature's art list (cleared by the build), or null. */
  photo(id: unknown): { src: string; alt: string; credit: string; caption?: string; source?: string; license?: string } | null {
    const a = this.ctx.data.art.find((x) => x.id === id);
    if (!a || a.kind !== 'photo' || !a.alt || !a.credit) return null;
    return { src: this.ctx.app.media(a.file), alt: pick(a.alt), credit: pick(a.credit), ...(a.caption ? { caption: pick(a.caption) } : {}), ...(a.source ? { source: a.source } : {}), ...(a.license_url ? { license: a.license_url } : {}) };
  }

  /** Play a node in the museum's docked player (call from a click). */
  play(n: LineageNode): boolean {
    const rec = this.recording(n);
    if (!rec) return false;
    miniPlayer().play([{ ref: `feature:${n.id}`, label: n.year ? `${n.artist} · ${n.year}` : n.artist, rec }], 0);
    return true;
  }

  /** A play button for a node, or a link to listen at the source, or a note that there is none. */
  playButton(n: LineageNode, label?: string): HTMLElement {
    if (n.play) {
      const b = h('button.btn.primary.ft-play', { type: 'button', 'data-play': n.id, 'aria-label': this.ui('play-label', { title: n.title, artist: n.artist, year: n.year ?? '' }) }, h('span', { 'aria-hidden': 'true' }, '▶'), label ?? this.ui('play'));
      b.addEventListener('click', () => this.play(n));
      return b;
    }
    if (n.link) return h('a.btn.ft-play.ft-out', { href: n.link, target: '_blank', rel: 'noopener noreferrer' }, this.ui('listen-at-source'));
    return h('span.ft-none', {}, this.ui('no-recording'));
  }

  /** Where the docked player is in `id`'s recording, in seconds, or null when it is not playing it. */
  playerTime(id: string): number | null {
    if (miniPlayer().current() !== `feature:${id}`) return null;
    const a = document.querySelector<HTMLAudioElement>('.mp audio');
    if (a) return a.currentTime;
    return ytTime;
  }

  dispose(): void {
    this.scroller?.dispose();
    this.ink.dispose();
    this.bed.stop();
    this.disposers.forEach((d) => d());
  }
}

// The docked player's YouTube frame reports its time once asked to
// ("listening"); its messages carry infoDelivery.currentTime.
let ytTime: number | null = null;
let ytWatching = false;
/** Ask the docked YouTube player to report its time. */
export function watchYouTubeTime(): () => void {
  const onMsg = (e: MessageEvent) => {
    if (!/^https:\/\/www\.youtube(-nocookie)?\.com$/.test(e.origin) || typeof e.data !== 'string') return;
    try {
      const m = JSON.parse(e.data) as { event?: string; info?: { currentTime?: number } };
      if (m.event === 'infoDelivery' && typeof m.info?.currentTime === 'number') ytTime = m.info.currentTime;
    } catch {
      /* not ours */
    }
  };
  const hello = window.setInterval(() => {
    const f = document.querySelector<HTMLIFrameElement>('.mp iframe');
    if (!f) {
      ytTime = null;
      return;
    }
    f.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 'sankofa-feature', channel: 'widget' }), '*');
  }, 1000);
  if (!ytWatching) window.addEventListener('message', onMsg);
  ytWatching = true;
  return () => {
    clearInterval(hello);
    window.removeEventListener('message', onMsg);
    ytWatching = false;
    ytTime = null;
  };
}
