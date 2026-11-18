// Voices remembering slavery (content/voices -> data/voices.json): excerpts
// of Library of Congress field recordings, streamed from the Library, with
// subtitles in English (the Library's transcript) and Russian. Every time is
// on the original MP3's clock, cues included, so the tracks fit the full file.
import { parse as parseYaml } from 'yaml';
import { lang, type Lang } from './i18n.ts';
import type { Recording } from './listen.ts';
import { parseVtt, type Cue } from './vtt.ts';

export interface Bi {
  en: string;
  ru: string;
}

export interface Voice {
  id: string;
  speaker: Bi;
  /** The card the voice is heard on. */
  card: string;
  recorded: { date: string; place: Bi; interviewer: Bi };
  /** The item page at the Library of Congress. */
  locUrl: string;
  /** The Library's own MP3 (tile.loc.gov). */
  mp3: string;
  rightsQuote: string;
  rightsUrl: string;
  credit: string;
  birthNote: Bi;
  start: number;
  end: number;
  /** The WebVTT files as served, relative to the page (data/voices/...). */
  tracks: Bi;
  cues: { en: Cue[]; ru: Cue[] };
}

export interface VoicesFile {
  version: 1;
  voices: Voice[];
}

export const EMPTY_VOICES: VoicesFile = { version: 1, voices: [] };

/** Where the subtitle files are served from. */
export const TRACK_DIR = 'data/voices';

const str = (v: unknown, where: string): string => {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${where} is missing`);
  return v.trim();
};

function https(url: string, host: RegExp, where: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`${where}: not a URL: ${url}`);
  }
  if (u.protocol !== 'https:' || !host.test(u.hostname)) throw new Error(`${where}: unexpected host in ${url}`);
  return url;
}

/**
 * Read content/voices/voices.yaml and its subtitle files (`read(name)` gives a
 * file's text). Stops at anything a reader would see wrong: a track that
 * leaves the excerpt, English and Russian cues that do not line up, a
 * speaker missing from their own subtitles, audio not from the Library.
 */
export function parseVoices(src: string, read: (file: string) => string, cards?: ReadonlySet<string>): VoicesFile {
  const y = (parseYaml(src) ?? {}) as { voices?: Record<string, unknown>[] };
  const seen = new Set<string>();
  const voices = (y.voices ?? []).map((r, k): Voice => {
    const id = str(r.id, `voices[${k}].id`);
    const at = (f: string) => `voices.${id}.${f}`;
    if (seen.has(id)) throw new Error(`${at('id')}: duplicate`);
    seen.add(id);
    const ru = (r.ru ?? {}) as Record<string, unknown>;
    const rec = (r.recorded ?? {}) as Record<string, unknown>;
    const subs = (r.subtitles ?? {}) as Record<string, unknown>;
    const card = str(r.card, at('card'));
    if (cards && !cards.has(card)) throw new Error(`${at('card')}: no card ${card}`);
    const start = Number(r.start);
    const end = Number(r.end);
    if (!(Number.isFinite(start) && start >= 0 && end > start)) throw new Error(`${at('start')}: the excerpt needs start < end`);
    const date = String(rec.date ?? '');
    if (!/^\d{4}(-\d{2}(-\d{2})?)?$/.test(date)) throw new Error(`${at('recorded.date')}: expected YYYY, YYYY-MM or YYYY-MM-DD`);
    const files = { en: str(subs.en, at('subtitles.en')), ru: str(subs.ru, at('subtitles.ru')) };
    const cues = { en: parseVtt(read(files.en)), ru: parseVtt(read(files.ru)) };
    if (!cues.en.length) throw new Error(`${at('subtitles.en')}: no cues`);
    cues.en.forEach((c, i) => {
      const o = cues.ru[i];
      if (!o || o.id !== c.id || o.start !== c.start || o.end !== c.end) throw new Error(`${at('subtitles')}: cue ${c.id || i + 1} differs between English and Russian`);
      if (c.start < start - 0.001 || c.end > end + 0.001) throw new Error(`${at('subtitles')}: cue ${c.id || i + 1} lies outside the excerpt`);
      if (i && c.start < cues.en[i - 1].start) throw new Error(`${at('subtitles')}: cue ${c.id} is out of order`);
    });
    if (cues.ru.length !== cues.en.length) throw new Error(`${at('subtitles')}: English and Russian have different cue counts`);
    const speaker = { en: str(r.speaker, at('speaker')), ru: str(ru.speaker, at('ru.speaker')) };
    for (const l of ['en', 'ru'] as const) {
      if (!cues[l].some((c) => c.voice === speaker[l])) throw new Error(`${at(`subtitles.${l}`)}: no cue is voiced by ${speaker[l]}`);
    }
    return {
      id,
      speaker,
      card,
      recorded: {
        date,
        place: { en: str(rec.place, at('recorded.place')), ru: str(ru.place, at('ru.place')) },
        interviewer: { en: str(rec.interviewer, at('recorded.interviewer')), ru: str(ru.interviewer, at('ru.interviewer')) },
      },
      locUrl: https(str(r.loc_url, at('loc_url')), /^www\.loc\.gov$/, at('loc_url')),
      mp3: https(str(r.mp3_url, at('mp3_url')), /^tile\.loc\.gov$/, at('mp3_url')),
      rightsQuote: str(r.rights_quote, at('rights_quote')),
      rightsUrl: https(str(r.rights_url, at('rights_url')), /^www\.loc\.gov$/, at('rights_url')),
      credit: str(r.credit, at('credit')),
      birthNote: { en: str(r.birth_note, at('birth_note')), ru: str(ru.birth_note, at('ru.birth_note')) },
      start,
      end,
      tracks: { en: `${TRACK_DIR}/${files.en}`, ru: `${TRACK_DIR}/${files.ru}` },
      cues,
    };
  });
  return { version: 1, voices };
}

/** The voices heard on a card, in the file's order. */
export function voicesFor(data: VoicesFile, card: string): Voice[] {
  return data.voices.filter((v) => v.card === card);
}

const MONTHS: Record<Lang, string[]> = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  ru: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
};
const MONTHS_RU_ALONE = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

/** A recording date at the precision the source gives: "June 11, 1949" / «11 июня 1949 года», or the year alone. */
export function recordedOn(date: string, l: Lang = lang()): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!m) return String(y);
  if (!d) return l === 'ru' ? `${MONTHS_RU_ALONE[m - 1]} ${y} года` : `${MONTHS.en[m - 1]} ${y}`;
  return l === 'ru' ? `${d} ${MONTHS.ru[m - 1]} ${y} года` : `${MONTHS.en[m - 1]} ${d}, ${y}`;
}

/** The docked player's reference for a voice. */
export const voiceRef = (v: Voice): string => `voice:${v.id}`;

/** A voice as a recording the docked player can play: the excerpt, its tracks and the reader's cues. */
export function voiceRecording(v: Voice, l: Lang = lang()): Recording {
  const city = v.recorded.place[l].split(',')[0];
  const year = v.recorded.date.slice(0, 4);
  return {
    source: 'audio',
    kind: 'voice',
    audio: v.mp3,
    start: v.start,
    end: v.end,
    title: `${v.speaker[l]} · ${city}, ${year}`,
    channel: l === 'ru' ? 'Библиотека Конгресса' : 'Library of Congress',
    note: v.birthNote.en,
    noteRu: v.birthNote.ru,
    tracks: (['en', 'ru'] as const).map((tl) => ({ lang: tl, src: v.tracks[tl], label: tl === 'ru' ? 'Русский' : 'English', default: tl === l })),
    cues: v.cues[l],
  };
}
