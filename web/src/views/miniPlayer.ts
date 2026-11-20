// One small player docked at the bottom of the screen for the roots and the
// music map: "Now playing X · next: Y", play/pause, next, close. Stations
// carry only a ▶ button; pressing it (or "Play the route") hands the route's
// recordings to this player. It keeps the listening facade's rule: nothing
// loads from the video host before a click, and it never moves on by
// itself. It is one source of the museum's sound coordinator (lib/sound).
// A recording with subtitles (an archival voice) shows the line being spoken
// under the controls, and tells the page where it is ("mp-time"), so a
// transcript elsewhere can follow and seek it.
import type { Recording } from '../lib/listen';
import { h, svgIcon } from '../lib/dom';
import { pick, t } from '../lib/i18n';
import { cueAt } from '../lib/vtt';
import { listenBlock, pauseBlock, playBlock, seekBlock } from './player';

export interface Track {
  ref: string;
  label: string;
  rec: Recording;
}

type State = 'idle' | 'playing' | 'paused';

export class MiniPlayer {
  readonly el: HTMLElement;
  private media: HTMLElement;
  private now: HTMLElement;
  private cue: HTMLElement;
  private toggleBtn: HTMLButtonElement;
  private nextBtn: HTMLButtonElement;
  private queue: Track[] = [];
  private i = -1;
  private state: State = 'idle';
  private block?: HTMLElement;
  private closing = false;

  constructor() {
    this.media = h('div.mp-media');
    this.now = h('div.mp-now', { 'aria-live': 'polite' });
    // Not a live region: the subtitles would talk over the voice. The
    // transcript and the <track> carry them for a screen reader.
    this.cue = h('p.mp-cue', { hidden: '' });
    this.toggleBtn = h('button.mp-btn.mp-toggle', { type: 'button', onclick: () => this.toggle() }) as HTMLButtonElement;
    this.nextBtn = h('button.mp-btn.mp-next', { type: 'button', 'aria-label': pick({ en: 'Next station', ru: 'Следующая станция' }), onclick: () => this.next() }, svgIcon('next')) as HTMLButtonElement;
    this.el = h(
      'section.mp',
      { 'aria-label': pick({ en: 'Player', ru: 'Плеер' }), hidden: '' },
      this.media,
      this.now,
      h('div.mp-ctl', {}, this.toggleBtn, this.nextBtn, h('button.mp-btn.mp-close', { type: 'button', 'aria-label': t('Close'), onclick: () => this.close() }, svgIcon('close'))),
      this.cue,
    );
    document.body.append(this.el);
    this.paint();
  }

  /** Play `queue[i]`, from `at` seconds if given: call it from the reader's click. */
  play(queue: Track[], i: number, at?: number): void {
    if (!queue[i]) return;
    this.queue = queue;
    this.load(i);
    if (at !== undefined) this.seek(at);
  }

  /** The audio element sounding now (direct files only; a video plays in its frame). */
  audio(): HTMLAudioElement | null {
    return this.block?.querySelector('audio') ?? null;
  }

  /** Move the current audio to `t` seconds and keep it playing. */
  seek(t: number): void {
    if (!this.block || !this.audio()) return;
    seekBlock(this.block, t);
    this.tick();
  }

  /** The station sounding now, if any. */
  current(): string | undefined {
    return this.state === 'idle' ? undefined : this.queue[this.i]?.ref;
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  private load(i: number): void {
    this.unloadBlock();
    this.i = i;
    const tr = this.queue[i];
    this.block = listenBlock(tr.rec, { compact: true, heading: '', api: true, onUnload: () => this.stopped() });
    this.media.replaceChildren(this.block);
    this.el.hidden = false;
    document.body.classList.add('mp-on');
    playBlock(this.block);
    this.state = 'playing';
    this.follow();
    this.paint();
  }

  /** Keep the state and the subtitle line with the audio's own play, pause and time. */
  private follow(): void {
    const a = this.audio();
    if (!a) return;
    const mine = () => a === this.audio();
    a.addEventListener('play', () => {
      if (!mine() || this.state === 'playing') return;
      this.state = 'playing';
      this.paint();
    });
    a.addEventListener('pause', () => {
      if (!mine() || this.state !== 'playing') return;
      this.state = 'paused';
      this.paint();
    });
    a.addEventListener('timeupdate', () => mine() && this.tick());
    a.addEventListener('seeked', () => mine() && this.tick());
  }

  /** Show the line spoken now and tell the page the time. */
  private tick(): void {
    const a = this.audio();
    const tr = this.queue[this.i];
    if (!a || !tr) return;
    const time = a.currentTime;
    const cues = tr.rec.cues;
    if (cues?.length) {
      const k = cueAt(cues, time);
      const c = cues[k];
      this.cue.hidden = false;
      this.cue.lang = pick({ en: 'en', ru: 'ru' });
      const who = c?.voice && c.voice !== tr.label ? [h('span.mp-who', {}, `${c.voice}: `)] : [];
      this.cue.replaceChildren(...(c ? [...who, c.text] : ['\u00a0']));
    }
    document.dispatchEvent(new CustomEvent('mp-time', { detail: { ref: tr.ref, t: time } }));
  }

  private unloadBlock(): void {
    if (!this.block) return;
    this.closing = true;
    this.block.dispatchEvent(new CustomEvent('lb-unload'));
    this.closing = false;
    this.block = undefined;
  }

  /** Another source took the sound, or the player was unloaded. */
  private stopped(): void {
    if (this.closing) return;
    this.state = 'idle';
    this.paint();
  }

  toggle(): void {
    if (!this.queue[this.i]) return;
    if (this.state === 'idle') return this.load(this.i);
    const pause = this.state === 'playing';
    pauseBlock(this.block!, pause);
    this.state = pause ? 'paused' : 'playing';
    this.paint();
  }

  /** Pause what is playing (another sound on the page is starting); nothing if it is not playing. */
  pause(): void {
    if (this.state === 'playing') this.toggle();
  }

  next(): void {
    if (this.queue[this.i + 1]) this.load(this.i + 1);
  }

  close(): void {
    this.unloadBlock();
    this.media.replaceChildren();
    this.cue.hidden = true;
    this.cue.replaceChildren();
    this.state = 'idle';
    this.queue = [];
    this.i = -1;
    this.el.hidden = true;
    document.body.classList.remove('mp-on');
    this.paint();
  }

  private paint(): void {
    const tr = this.queue[this.i];
    const nx = this.queue[this.i + 1];
    const playing = this.state === 'playing';
    this.toggleBtn.replaceChildren(h('span.mp-glyph', { 'aria-hidden': 'true' }, playing ? '❚❚' : '▶'));
    this.toggleBtn.setAttribute('aria-label', playing ? pick({ en: 'Pause', ru: 'Пауза' }) : pick({ en: 'Play', ru: 'Играть' }));
    this.nextBtn.disabled = !nx;
    if (!tr?.rec.cues?.length) {
      this.cue.hidden = true;
      this.cue.replaceChildren();
    }
    this.now.replaceChildren(
      ...(tr
        ? [
            h('small', {}, this.state === 'paused' ? pick({ en: 'Paused', ru: 'Пауза' }) : this.state === 'idle' ? pick({ en: 'Stopped', ru: 'Остановлено' }) : pick({ en: 'Now playing', ru: 'Сейчас звучит' })),
            h('b', {}, tr.label),
            h('span.mp-rec', {}, tr.rec.title),
            nx ? h('span.mp-upnext', {}, pick({ en: `next: ${nx.label}`, ru: `дальше: ${nx.label}` })) : h('span.mp-upnext', {}, pick({ en: 'last on this route', ru: 'последняя на этом маршруте' })),
          ]
        : []),
    );
    document.dispatchEvent(new CustomEvent('mp-change', { detail: { ref: this.current() } }));
  }
}

let one: MiniPlayer | undefined;
/** The museum's one docked player. */
export function miniPlayer(): MiniPlayer {
  return (one ??= new MiniPlayer());
}
