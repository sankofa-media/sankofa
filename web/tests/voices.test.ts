import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { clock, cueAt, parseVtt, vttTime } from '../src/lib/vtt';
import { parseVoices, recordedOn, voiceRecording, voicesFor } from '../src/lib/voices';
import { orderRecordings, type Recording } from '../src/lib/listen';

const DIR = join(__dirname, '../../content/voices');
const read = (f: string) => readFileSync(join(DIR, f), 'utf8');

describe('WebVTT', () => {
  it('reads timestamps with and without hours', () => {
    expect(vttTime('00:09:39.000')).toBe(579);
    expect(vttTime('03:09.300')).toBeCloseTo(189.3);
    expect(vttTime('1:00:00.250')).toBeCloseTo(3600.25);
    expect(() => vttTime('9:39')).toThrow();
  });

  it('reads ids, times, voices and multi-line text, and skips notes', () => {
    const cues = parseVtt(read('laura-smalley.en.vtt'));
    expect(cues).toHaveLength(8);
    expect(cues[0]).toEqual({ id: 'laura-smalley-01', start: 579, end: 581.85, voice: 'Laura Smalley', text: "You know, and old master didn't tell you know, they was free." });
    expect(cues[1].voice).toBe('John Henry Faulk');
    expect(cues.map((c) => c.text).join(' ')).not.toMatch(/NOTE|Timestamps/);
  });

  it('handles CRLF, a BOM, settings after the timing, entities and cues without ids', () => {
    const cues = parseVtt('﻿WEBVTT\r\n\r\n00:01.000 --> 00:02.500 align:start\r\n<v.loud A &amp; B>One &lt;two&gt;</v>\r\n\r\nNOTE skipped\r\n\r\nx\r\n00:03.000 --> 00:04.000\r\nThree\r\n');
    expect(cues).toEqual([
      { id: '', start: 1, end: 2.5, voice: 'A &amp; B', text: 'One <two>' },
      { id: 'x', start: 3, end: 4, text: 'Three' },
    ]);
  });

  it('refuses what is not WebVTT or runs backwards', () => {
    expect(() => parseVtt('1\n00:00:01,000 --> 00:00:02,000\nSRT')).toThrow(/not a WebVTT/);
    expect(() => parseVtt('WEBVTT\n\n00:02.000 --> 00:01.000\nback')).toThrow(/ends before/);
  });

  it('finds the cue spoken at a time, holding the last one through a pause when asked', () => {
    const cues = parseVtt(read('laura-smalley.en.vtt'));
    expect(cueAt(cues, 578)).toBe(-1);
    expect(cueAt(cues, 579)).toBe(0);
    expect(cueAt(cues, 581.9)).toBe(-1); // the pause before Faulk's question
    expect(cueAt(cues, 581.9, true)).toBe(0);
    expect(cueAt(cues, 582.04)).toBe(1);
    expect(cueAt(cues, 583.08)).toBe(2); // one cue ends where the next starts
    expect(cueAt(cues, 599)).toBe(7);
    expect(cueAt(cues, 600.15)).toBe(-1);
    expect(cueAt(cues, 700, true)).toBe(-1);
    expect(cueAt([], 1, true)).toBe(-1);
  });

  it('writes transcript time marks as m:ss', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(9.9)).toBe('0:09');
    expect(clock(69.6)).toBe('1:09');
  });
});

describe('the voices', () => {
  const data = parseVoices(read('voices.yaml'), read, new Set(['wpa-narratives']));

  it('are three, all on the WPA narratives card, streamed from the Library', () => {
    expect(data.voices.map((v) => v.id)).toEqual(['fountain-hughes', 'laura-smalley', 'billy-mccrea']);
    expect(voicesFor(data, 'wpa-narratives')).toHaveLength(3);
    for (const v of data.voices) {
      expect(v.mp3).toMatch(/^https:\/\/tile\.loc\.gov\//);
      expect(v.locUrl).toMatch(/^https:\/\/www\.loc\.gov\/item\//);
      expect(v.tracks.ru).toBe(`data/voices/${v.id}.ru.vtt`);
      expect(v.cues.ru.map((c) => c.id)).toEqual(v.cues.en.map((c) => c.id));
      expect(v.cues.en[0].start).toBe(v.start);
      expect(v.cues.en.at(-1)!.end).toBe(v.end);
      expect(v.speaker.ru).toBeTruthy();
    }
  });

  it('keep the transcript as prepared: no slur in any cue', () => {
    const all = data.voices.flatMap((v) => [...v.cues.en, ...v.cues.ru]).map((c) => c.text).join('\n');
    expect(all).not.toMatch(/\bnig+(?:er|a|ah)s?\b|нигер|негр/i);
  });

  it('stop the build on a card that does not exist, audio off the Library, or tracks that disagree', () => {
    const yaml = read('voices.yaml');
    expect(() => parseVoices(yaml, read, new Set(['other']))).toThrow(/no card wpa-narratives/);
    expect(() => parseVoices(yaml.replace('https://tile.loc.gov/storage-services/service/afc/afc1950037/afc1950037_afs09990/afc1950037_afs09990a.mp3', 'https://example.org/a.mp3'), read)).toThrow(/mp3_url/);
    const shifted = (f: string) => (f === 'laura-smalley.ru.vtt' ? read(f).replace('00:09:42.040', '00:09:42.100') : read(f));
    expect(() => parseVoices(yaml, shifted)).toThrow(/laura-smalley.*differs/);
    const outside = (f: string) => (f.startsWith('billy-mccrea.') ? read(f).replace('00:03:44.950', '00:03:50.000') : read(f));
    expect(() => parseVoices(yaml, outside)).toThrow(/outside the excerpt/);
    expect(() => parseVoices(yaml.replace('      speaker: "Лора Смолли"\n', ''), read)).toThrow(/ru\.speaker/);
  });

  it('give dates at the precision the source has', () => {
    expect(recordedOn('1949-06-11', 'en')).toBe('June 11, 1949');
    expect(recordedOn('1949-06-11', 'ru')).toBe('11 июня 1949 года');
    expect(recordedOn('1941', 'ru')).toBe('1941');
    expect(recordedOn('1941-03', 'ru')).toBe('март 1941 года');
  });

  it('play as an excerpt with both tracks, the reader’s language by default', () => {
    const v = data.voices[1];
    const ru = voiceRecording(v, 'ru');
    expect(ru).toMatchObject({ source: 'audio', kind: 'voice', audio: v.mp3, start: 579, end: 600.15, channel: 'Библиотека Конгресса' });
    expect(ru.title).toBe('Лора Смолли · Хемпстед, 1941');
    expect(ru.tracks!.find((t) => t.default)?.lang).toBe('ru');
    expect(ru.cues![0].text).toMatch(/^А старый хозяин/);
    expect(voiceRecording(v, 'en').tracks!.find((t) => t.default)?.lang).toBe('en');
  });
});

describe('a card’s recordings', () => {
  const rec = (kind: Recording['kind'], title: string): Recording => ({ source: 'youtube', kind, youtube: 'aaaaaaaaaaa', title });

  it('lead with the official recording, then field recordings, then voices, each in file order', () => {
    const { lead, rest } = orderRecordings([rec('field', 'f1'), rec('voice', 'v1'), rec('official', 'o1'), rec('field', 'f2'), rec('official', 'o2')]);
    expect(lead?.title).toBe('o1');
    expect(rest.map((r) => r.title)).toEqual(['o2', 'f1', 'f2', 'v1']);
  });

  it('lead with the first field recording when there is no official one, as before', () => {
    const { lead, rest } = orderRecordings([rec('field', 'f1'), rec('field', 'f2')]);
    expect(lead?.title).toBe('f1');
    expect(rest.map((r) => r.title)).toEqual(['f2']);
  });

  it('never lead with a voice: voices are listed with their transcripts', () => {
    const { lead, rest } = orderRecordings([rec('voice', 'v1'), rec('voice', 'v2')]);
    expect(lead).toBeUndefined();
    expect(rest).toHaveLength(2);
    expect(orderRecordings([])).toEqual({ lead: undefined, rest: [] });
  });
});
