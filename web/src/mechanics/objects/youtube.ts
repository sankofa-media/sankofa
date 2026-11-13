// The official recording, behind a click: nothing is loaded from YouTube until
// the reader asks for it, and then only from youtube-nocookie.com. Kept small
// and on its own so a shared player can replace it later.
import { h } from '../../lib/dom';
import { pick } from '../../lib/i18n';
import { claim, release } from './bus';

export interface Video {
  id: string;
  title: string;
  channel: string;
  start?: number;
}

export function youtubeFacade(owner: string, v: Video): HTMLElement {
  const id = `${owner}-video`;
  const box = h('div.mx-yt');
  const poster = () => {
    box.replaceChildren(
      h(
        'button.mx-yt-poster',
        {
          type: 'button',
          'aria-label': pick({ en: `Play “${v.title}” by ${v.channel} on YouTube`, ru: `Включить «${v.title}» (${v.channel}) на YouTube` }),
          onclick: load,
        },
        h('span.mx-yt-play', { 'aria-hidden': 'true' }),
        h('span.mx-yt-text', {}, h('b', {}, v.title), h('span', {}, v.channel), h('small', {}, pick({ en: 'The original recording, on YouTube. Loads only when you press play.', ru: 'Оригинальная запись на YouTube. Загрузится, только когда вы нажмёте «играть».' }))),
      ),
    );
  };
  const reset = () => {
    release(id);
    poster();
  };
  function load(): void {
    claim(id, reset);
    const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}?autoplay=1&rel=0${v.start ? `&start=${v.start}` : ''}`;
    box.replaceChildren(h('iframe', { src, title: `${v.title} — ${v.channel}`, allow: 'autoplay; encrypted-media; picture-in-picture', allowfullscreen: true, loading: 'lazy', referrerpolicy: 'strict-origin-when-cross-origin' }));
  }
  poster();
  return box;
}
