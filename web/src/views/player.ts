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
    const src = embedUrl(r);
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
      const a = h('audio.lb-audio', { controls: true, autoplay: true, src: r.start ? `${r.audio}#t=${r.start}` : r.audio }) as HTMLAudioElement;
      adopt(a);
      media = a;
    } else return;
    claim(id, unload, el);
    stage.replaceChildren(media);
    el.classList.add('on');
  };
  const unload = () => {
    release(id);
    stage.replaceChildren(facade());
    el.classList.remove('on');
  };
  el.addEventListener('lb-play', play);
  return el;
}

/** Start a block's player, as its own button would (call it from a click). */
export function playBlock(el: HTMLElement): void {
  el.dispatchEvent(new CustomEvent('lb-play'));
}
