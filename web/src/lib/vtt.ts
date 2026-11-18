// WebVTT subtitles: the cues of a track, and which one is spoken at a moment.
// Only what the museum's voice tracks use: cue ids, timings, multi-line text
// and <v Speaker> voice tags; NOTE and STYLE blocks are skipped.

export interface Cue {
  id: string;
  /** Seconds, on the clock of the file the track belongs to. */
  start: number;
  end: number;
  /** The speaker named by the cue's voice tag. */
  voice?: string;
  /** The text without tags, lines joined by spaces. */
  text: string;
}

const TIME = /^(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})$/;

/** "00:09:39.000" or "09:39.000" in seconds. */
export function vttTime(s: string): number {
  const m = TIME.exec(s.trim());
  if (!m) throw new Error(`not a WebVTT timestamp: ${s}`);
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', nbsp: '\u00a0', lrm: '\u200e', rlm: '\u200f' };

/** Parse a WebVTT file into its cues, in file order. */
export function parseVtt(src: string): Cue[] {
  const text = src.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!/^WEBVTT(?:[ \t\n]|$)/.test(text)) throw new Error('not a WebVTT file');
  const cues: Cue[] = [];
  for (const block of text.split(/\n{2,}/).slice(1)) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    if (!lines.length || /^(NOTE|STYLE|REGION)\b/.test(lines[0])) continue;
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at < 0 || at > 1) continue;
    const id = at === 1 ? lines[0].trim() : '';
    const [from, rest] = lines[at].split('-->');
    const start = vttTime(from);
    const end = vttTime(rest.trim().split(/\s+/)[0]);
    if (!(end > start)) throw new Error(`cue ${id || cues.length + 1} ends before it starts`);
    const raw = lines.slice(at + 1).join('\n');
    const voice = /<v(?:\.[\w.-]+)?\s+([^>]+)>/.exec(raw)?.[1].trim();
    const plain = raw
      .replace(/<[^>]*>/g, '')
      .replace(/&(amp|lt|gt|nbsp|lrm|rlm);/g, (_, e: string) => ENTITIES[e])
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join(' ');
    cues.push({ id, start, end, ...(voice ? { voice } : {}), text: plain });
  }
  return cues;
}

/**
 * The index of the cue spoken at `t`, or -1 between cues and outside them.
 * With `hold`, a pause between two cues keeps the one before it, so a
 * transcript's highlight does not flicker off between lines.
 */
export function cueAt(cues: readonly Cue[], t: number, hold = false): number {
  let lo = 0;
  let hi = cues.length - 1;
  let found = -1;
  // The last cue that has started by t.
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (found < 0) return -1;
  if (t < cues[found].end) return found;
  return hold && found < cues.length - 1 ? found : -1;
}

/** Seconds as m:ss, for a transcript's time marks. */
export function clock(s: number): string {
  const whole = Math.max(0, Math.floor(s));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
