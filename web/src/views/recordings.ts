// A card's recordings: the official recording leads as a listening block,
// then a compact list of the others (field recordings, archival voices), each
// with its kind and its note, each played in the docked player, so one sound
// plays at a time (lib/sound). A voice brings its transcript: the line being
// spoken is marked as the docked player moves, and a line can be clicked (or
// chosen with Enter) to hear it from there.
import type { App } from '../app';
import type { Card } from '../lib/types';
import { h } from '../lib/dom';
import { lang, pick } from '../lib/i18n';
import { noteFor, orderRecordings, type Recording } from '../lib/listen';
import { recordedOn, voiceRecording, voiceRef, voicesFor, type Voice } from '../lib/voices';
import { clock, cueAt, type Cue } from '../lib/vtt';
import { miniPlayer, type Track } from './miniPlayer';
import { listenBlock } from './player';

const KIND_BADGE: Record<'field' | 'voice', { en: string; ru: string }> = {
  field: { en: 'field recording', ru: 'полевая запись' },
  voice: { en: 'voice', ru: 'голос' },
};

interface Item {
  track: Track;
  voice?: Voice;
}

/** Everything a card offers to hear, or null when it has nothing. */
export function cardRecordings(app: App, c: Card): HTMLElement | null {
  const voices = voicesFor(app.voices, c.id);
  const { lead, rest } = orderRecordings([...(app.listen.cards[c.id] ?? []), ...voices.map((v) => voiceRecording(v))]);
  if (!lead && !rest.length) return null;
  const items: Item[] = rest.map((rec, i) => {
    const voice = rec.kind === 'voice' ? voices.find((v) => voiceRef(v) === `voice:${voiceIdOf(voices, rec)}`) : undefined;
    return { voice, track: { ref: voice ? voiceRef(voice) : `card:${c.id}#${i + 1}`, label: voice ? voice.speaker[lang()] : c.title, rec } };
  });
  const queue = items.map((x) => x.track);
  const list = items.length
    ? h(
        'section.recs',
        { 'aria-labelledby': `recs-${c.id}` },
        h(
          'h3.recs-head',
          { id: `recs-${c.id}` },
          lead
            ? pick({ en: 'More recordings', ru: 'Другие записи' })
            : items.every((x) => x.voice)
              ? pick({ en: 'Voices', ru: 'Голоса' })
              : pick({ en: 'Listen', ru: 'Слушать' }),
        ),
        h(
          'ol.rec-list',
          {},
          items.map((x, i) => (x.voice ? voiceItem(x.voice, x.track, queue, i) : recItem(x.track, queue, i))),
        ),
      )
    : null;
  if (list) followPlayer(list);
  return h('div.card-listen', {}, lead ? listenBlock(lead) : null, list);
}

/** Which voice a recording was made from (they share the audio and start). */
function voiceIdOf(voices: Voice[], r: Recording): string | undefined {
  return voices.find((v) => v.mp3 === r.audio && v.start === r.start)?.id;
}

function playButton(tr: Track, queue: Track[], i: number, name: string): HTMLElement {
  return h(
    'button.rec-play',
    {
      type: 'button',
      'aria-label': pick({ en: `Play: ${name}`, ru: `Слушать: ${name}` }),
      onclick: () => {
        const mp = miniPlayer();
        if (mp.current() === tr.ref) mp.toggle();
        else mp.play(queue, i);
      },
    },
    h('span.rec-glyph', { 'aria-hidden': 'true' }),
  );
}

function badge(kind: Recording['kind']): HTMLElement | null {
  return kind === 'official' ? null : h(`span.rec-badge.${kind}`, {}, pick(KIND_BADGE[kind]));
}

function recItem(tr: Track, queue: Track[], i: number): HTMLElement {
  const r = tr.rec;
  const note = r.note ? noteFor(r) : null;
  return h(
    'li.rec',
    { 'data-ref': tr.ref, 'data-kind': r.kind },
    playButton(tr, queue, i, r.title),
    h(
      'div.rec-body',
      {},
      h('div.rec-line', {}, badge(r.kind), h('b.rec-title', {}, r.title), r.channel ? h('small.rec-src', {}, r.channel) : null),
      note ? h('p.rec-note', { lang: note.lang }, note.text) : null,
    ),
  );
}

function voiceItem(v: Voice, tr: Track, queue: Track[], i: number): HTMLElement {
  const l = lang();
  const cues = v.cues[l];
  const rows = cues.map((c, k) => {
    // Name a speaker when the voice changes; the interviewee's first line needs no name.
    const who = c.voice && c.voice !== (cues[k - 1]?.voice ?? v.speaker[l]) ? c.voice : null;
    return h(
      'li.vp-line',
      { 'data-cue': String(k) },
      h(
        'button.vp-seek',
        {
          type: 'button',
          onclick: () => {
            const mp = miniPlayer();
            if (mp.current() === tr.ref && mp.audio()) mp.seek(c.start);
            else mp.play(queue, i, c.start);
          },
        },
        h('span.vp-time', {}, h('span.sr-only', {}, pick({ en: 'Play from ', ru: 'Слушать с ' })), clock(c.start - v.start)),
        h('span.vp-text', {}, who ? h('span.vp-who', {}, `${who}: `) : null, c.text),
      ),
    );
  });
  const meta = [v.recorded.place[l], recordedOn(v.recorded.date, l), pick({ en: `interview: ${v.recorded.interviewer.en}`, ru: `интервью: ${v.recorded.interviewer.ru}` })];
  const el = h(
    'li.rec.voice',
    { 'data-ref': tr.ref, 'data-kind': 'voice', 'data-voice': v.id },
    playButton(tr, queue, i, v.speaker[l]),
    h(
      'div.rec-body',
      {},
      h('div.rec-line', {}, badge('voice'), h('b.rec-title', {}, v.speaker[l]), h('small.rec-src', {}, meta.join(' · '))),
      h('p.rec-note', {}, cap(v.birthNote[l]) + '.'),
    ),
    h(
      'div.vp',
      {},
      h('h4.vp-head', { id: `vp-${v.id}` }, pick({ en: 'Transcript', ru: 'Расшифровка' })),
      h('ol.vp-transcript', { 'aria-labelledby': `vp-${v.id}`, lang: l }, rows),
      h(
        'p.vp-credit',
        {},
        pick({ en: 'Subtitles follow the Library’s transcript. ', ru: 'Субтитры — перевод расшифровки Библиотеки Конгресса. ' }),
        h('a', { href: v.locUrl, target: '_blank', rel: 'noopener noreferrer' }, pick({ en: 'Library of Congress', ru: 'Библиотека Конгресса (Library of Congress)' })),
        ' · ',
        h('span', { lang: 'en' }, v.credit),
        '. ',
        pick({ en: 'Shown for educational use; ', ru: 'Показано в образовательных целях; ' }),
        h(
          'a',
          { href: v.rightsUrl, target: '_blank', rel: 'noopener noreferrer' },
          pick({ en: 'the Library knows of no copyright or other restrictions on this collection', ru: 'Библиотеке не известно об авторских правах или иных ограничениях на эту коллекцию' }),
        ),
        '.',
      ),
    ),
  );
  CUES.set(el, cues);
  return el;
}

/** The cues a voice item's transcript shows. */
const CUES = new WeakMap<HTMLElement, Cue[]>();

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Mark the item the docked player plays, and the transcript line it is on. */
function followPlayer(list: HTMLElement): void {
  const mark = (ref: string | undefined) => {
    list.querySelectorAll<HTMLElement>('li.rec').forEach((li) => {
      const on = li.dataset.ref === ref;
      li.classList.toggle('on', on);
      if (on) li.setAttribute('aria-current', 'true');
      else li.removeAttribute('aria-current');
      li.querySelector('.rec-play')?.classList.toggle('playing', on && playingNow());
      if (!on) setLine(li, -1);
    });
  };
  const playingNow = () => !!miniPlayer().current() && !miniPlayer().audio()?.paused;
  const onChange = (e: Event) => {
    if (!list.isConnected) return off();
    mark((e as CustomEvent<{ ref?: string }>).detail.ref);
  };
  const onTime = (e: Event) => {
    if (!list.isConnected) return off();
    const { ref, t } = (e as CustomEvent<{ ref: string; t: number }>).detail;
    const li = list.querySelector<HTMLElement>(`li.rec.voice[data-ref="${CSS.escape(ref)}"]`);
    if (!li) return;
    setLine(li, cueAt(CUES.get(li) ?? [], t, true));
  };
  const off = () => {
    document.removeEventListener('mp-change', onChange);
    document.removeEventListener('mp-time', onTime);
  };
  document.addEventListener('mp-change', onChange);
  document.addEventListener('mp-time', onTime);
  // A card opened while its voice plays shows it at once.
  queueMicrotask(() => mark(miniPlayer().current()));
}

function setLine(li: HTMLElement, k: number): void {
  li.querySelectorAll<HTMLElement>('.vp-line').forEach((x, i) => {
    const on = i === k;
    x.classList.toggle('now', on);
    const b = x.querySelector('button');
    if (on) b?.setAttribute('aria-current', 'time');
    else b?.removeAttribute('aria-current');
  });
}
