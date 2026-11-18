// The listening facade: a poster and a caption until the reader asks for
// sound, then the player itself. Nothing is fetched from the video host
// before that click. A loaded player is a source like any other (lib/sound):
// starting it stops whatever sounds, and starting anything else unloads it
// back to its facade.
import type { Recording } from '../lib/listen';
import { embedUrl, noteFor, posterUrl } from '../lib/listen';
import { h } from '../lib/dom';
import { pick } from '../lib/i18n';
import { adopt, claim, playing, release } from '../lib/sound';

let made = 0;

function sourceLine(r: Recording): string {
  if (!r.channel) return '';
  if (r.kind === 'official') return pick({ en: `Official upload: ${r.channel}`, ru: `Официальная загрузка: ${r.channel}` });
  return r.channel;
}

export interface ListenOpts {
  /** A heading over the block; "Listen" by default, '' for none. */
  heading?: string;
  /** Something under the player, e.g. the way on to the next stop of a chain. */
  after?: HTMLElement | null;
  compact?: boolean;
  /** Let the page pause and resume the player (the docked mini-player). */
  api?: boolean;
  /** Called when the player is unloaded back to its facade (stopped by another source). */
  onUnload?: () => void;
}

/** A listening block for one recording. Start it with playBlock(el) or a click. */
export function listenBlock(r: Recording, opts: ListenOpts = {}): HTMLElement {
  const label = pick({ en: `Play “${r.title}”`, ru: `Включить «${r.title}»` });
  const poster = posterUrl(r);
  const stage = h('div.lb-stage');
  const facade = () =>
    h(
      'button.lb-facade',
      { type: 'button', 'aria-label': label, onclick: () => play() },
      poster ? h('img', { src: poster, alt: '', loading: 'lazy', decoding: 'async' }) : h('span.lb-blank', { 'aria-hidden': 'true' }),
      h('span.lb-play', { 'aria-hidden': 'true' }),
    );
  stage.append(facade());
  const heading = opts.heading ?? pick({ en: 'Listen', ru: 'Слушать' });
  const el = h(
    `figure.lb${opts.compact ? '.compact' : ''}`,
    { 'data-source': r.source },
    heading ? h('div.lb-head', {}, heading) : null,
    stage,
    h('figcaption', {}, r.note ? h('span.lb-note', { lang: noteFor(r).lang }, noteFor(r).text) : h('span.lb-note', {}, r.title), sourceLine(r) ? h('small.lb-src', {}, sourceLine(r)) : null),
    opts.after ?? null,
  );
  const id = `player-${++made}`;
  const play = () => {
    if (playing() === id) return;
    const src = embedUrl(r) && opts.api ? `${embedUrl(r)}&enablejsapi=1` : embedUrl(r);
    let media: HTMLElement;
    if (src) {
      media = h('iframe.lb-frame', {
        src,
        title: r.channel ? `${r.title} · ${r.channel}` : r.title,
        allow: 'autoplay; encrypted-media; picture-in-picture',
        allowfullscreen: '',
        referrerpolicy: 'strict-origin-when-cross-origin',
      });
    } else if (r.audio) {
      media = audioFor(r);
    } else return;
    claim(id, unload, el);
    stage.replaceChildren(media);
    el.classList.add('on');
  };
  const unload = () => {
    release(id);
    stage.replaceChildren(facade());
    el.classList.remove('on');
    opts.onUnload?.();
  };
  el.addEventListener('lb-play', play);
  el.addEventListener('lb-unload', () => playing() === id && unload());
  return el;
}

/**
 * The element for a direct audio file: its caption tracks as real <track>
 * elements and, for an excerpt, a stop at its end. Playing again after the
 * end, or from before the excerpt, starts it over from its beginning.
 */
function audioFor(r: Recording): HTMLAudioElement {
  const a = h(
    'audio.lb-audio',
    { controls: true, autoplay: true, src: r.start ? `${r.audio}#t=${r.start}` : r.audio! },
    ...(r.tracks ?? []).map((tr) => h('track', { kind: 'captions', src: tr.src, srclang: tr.lang, label: tr.label, ...(tr.default ? { default: '' } : {}) })),
  ) as HTMLAudioElement;
  adopt(a);
  // A seek asked for before the file is ready lands once it is.
  a.addEventListener('loadedmetadata', () => {
    const at = a.dataset.seek ? Number(a.dataset.seek) : r.start;
    delete a.dataset.seek;
    if (at) a.currentTime = at;
  });
  if (r.end !== undefined) {
    const start = r.start ?? 0;
    const end = r.end;
    a.addEventListener('timeupdate', () => {
      if (a.currentTime >= end) a.pause();
    });
    a.addEventListener('play', () => {
      if (a.currentTime >= end - 0.05 || a.currentTime < start - 0.5) a.currentTime = start;
    });
  }
  return a;
}

/** Move a loaded audio block to `t` seconds and keep it sounding. */
export function seekBlock(el: HTMLElement, t: number): void {
  const a = el.querySelector<HTMLAudioElement>('audio');
  if (!a) return;
  if (a.readyState < 1) a.dataset.seek = String(t);
  a.currentTime = t;
  if (a.paused) void a.play().catch(() => undefined);
}

/** Pause or resume a loaded block (YouTube through its iframe API, audio directly). */
export function pauseBlock(el: HTMLElement, pause: boolean): void {
  const audio = el.querySelector<HTMLAudioElement>('audio');
  if (audio) {
    if (pause) audio.pause();
    else void audio.play();
    return;
  }
  const frame = el.querySelector<HTMLIFrameElement>('iframe');
  frame?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: pause ? 'pauseVideo' : 'playVideo', args: [] }), '*');
}

/** Start a block's player, as its own button would (call it from a click). */
export function playBlock(el: HTMLElement): void {
  el.dispatchEvent(new CustomEvent('lb-play'));
}
