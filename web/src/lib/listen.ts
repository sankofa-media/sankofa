// Recordings to listen to, by card or roots artist (content/listen.yaml ->
// data/listen.json). A recording names its source, so other kinds can join
// later (a field recording with a direct audio file, an archival voice clip
// with subtitles) without changing what a card or an artist holds.
import { parse as parseYaml } from 'yaml';
import { lang, type Lang } from './i18n.ts';
import type { Cue } from './vtt.ts';

export type RecordingSource = 'youtube' | 'audio';
/** Why the museum offers it: an official upload, a field recording, an archival voice. */
export type RecordingKind = 'official' | 'field' | 'voice';

export interface Recording {
  source: RecordingSource;
  kind: RecordingKind;
  /** YouTube video id (source: youtube). */
  youtube?: string;
  /** A direct audio file (source: audio). */
  audio?: string;
  /** Seconds into the recording where listening starts. */
  start?: number;
  title: string;
  /** The uploader or the archive. */
  channel?: string;
  /** What to listen for, in English. */
  note?: string;
  /** The same note in Russian, shown in Russian mode when present. */
  noteRu?: string;
  /** Seconds where listening stops: an excerpt of a longer file (source: audio). */
  end?: number;
  /** Caption tracks for an audio file, as <track> elements. */
  tracks?: { lang: Lang; src: string; label: string; default?: boolean }[];
  /** The cues in the reader's language, shown under the docked player. */
  cues?: Cue[];
}

export interface ListenFile {
  version: 1;
  cards: Record<string, Recording[]>;
  roots: Record<string, Recording[]>;
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

function entry(raw: unknown, where: string): Recording {
  const r = (raw ?? {}) as Record<string, unknown>;
  const start = r.start === undefined ? undefined : Number(r.start);
  if (start !== undefined && !(Number.isInteger(start) && start >= 0)) throw new Error(`${where}: start must be whole seconds`);
  const note = r.note ? String(r.note) : undefined;
  const noteRu = r.noteRu ? String(r.noteRu) : undefined;
  if (typeof r.youtube === 'string') {
    if (!YT_ID.test(r.youtube)) throw new Error(`${where}: not a YouTube video id: ${r.youtube}`);
    const kind = r.kind === 'field' || r.kind === 'voice' ? r.kind : 'official';
    return { source: 'youtube', kind, youtube: r.youtube, start, title: String(r.title ?? ''), channel: r.channel ? String(r.channel) : undefined, note, noteRu };
  }
  if (typeof r.audio_url === 'string' || typeof r.audio === 'string') {
    const kind = r.kind === 'voice' || r.kind === 'official' ? r.kind : 'field';
    return { source: 'audio', kind, audio: String(r.audio_url ?? r.audio), start, title: String(r.title ?? ''), channel: r.channel ? String(r.channel) : undefined, note, noteRu };
  }
  throw new Error(`${where}: a recording needs youtube or audio_url`);
}

function section(raw: unknown, name: string): Record<string, Recording[]> {
  const out: Record<string, Recording[]> = {};
  for (const [id, v] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
    // One recording or a list of them.
    out[id] = (Array.isArray(v) ? v : [v]).map((x, i) => entry(x, `${name}.${id}${Array.isArray(v) ? `[${i}]` : ''}`));
  }
  return out;
}

/** Parse content/listen.yaml. The `missing` list is for editors and is dropped. */
export function parseListen(src: string): ListenFile {
  const y = (parseYaml(src) ?? {}) as Record<string, unknown>;
  return { version: 1, cards: section(y.cards, 'cards'), roots: section(y.roots, 'roots') };
}

export const EMPTY_LISTEN: ListenFile = { version: 1, cards: {}, roots: {} };

/** The poster frame YouTube serves for a video. */
export function posterUrl(r: Recording): string | undefined {
  return r.source === 'youtube' && r.youtube ? `https://i.ytimg.com/vi/${r.youtube}/hqdefault.jpg` : undefined;
}

/** The privacy-enhanced embed, started on the reader's click. */
export function embedUrl(r: Recording): string | undefined {
  if (r.source !== 'youtube' || !r.youtube) return undefined;
  return `https://www.youtube-nocookie.com/embed/${r.youtube}?autoplay=1${r.start ? `&start=${r.start}` : ''}`;
}

/** The caption's note in the reader's language: Russian mode prefers noteRu. */
export function noteFor(r: Recording, l: Lang = lang()): { text: string; lang: 'en' | 'ru' } {
  const ru = l === 'ru' ? r.noteRu : undefined;
  return { text: ru ?? r.note ?? r.title, lang: ru ? 'ru' : 'en' };
}

/** The first recording the museum offers for a card or a roots artist ("card:<id>" or an artist id). */
export function recordingFor(data: ListenFile, ref: string): Recording | undefined {
  return ref.startsWith('card:') ? data.cards[ref.slice(5)]?.[0] : data.roots[ref]?.[0];
}

const KIND_ORDER: Record<RecordingKind, number> = { official: 0, field: 1, voice: 2 };

/**
 * A card's recordings in the order it offers them: the official recording
 * leads (or, without one, the first field recording, as the card always
 * showed), then the others by kind, field recordings before voices, each
 * kind in its file order. Voices never lead: they come with their transcript.
 */
export function orderRecordings(rs: readonly Recording[]): { lead?: Recording; rest: Recording[] } {
  const sorted = rs
    .map((r, i) => ({ r, i }))
    .sort((a, b) => KIND_ORDER[a.r.kind] - KIND_ORDER[b.r.kind] || a.i - b.i)
    .map((x) => x.r);
  const lead = sorted[0] && sorted[0].kind !== 'voice' ? sorted[0] : undefined;
  return { lead, rest: lead ? sorted.slice(1) : sorted };
}
