import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { embedUrl, noteFor, parseListen, posterUrl } from '../src/lib/listen';

describe('listen data', () => {
  it('reads cards and roots, with an optional start, and drops the editors’ missing list', () => {
    const d = parseListen(`cards:
  amen-break:
    youtube: "HrrWhCbZAyY"
    title: "Amen Brother"
    channel: "The Winstons - Topic"
    note: "the break at 1:26"
    start: 85
roots:
  abba:
    youtube: "xFrGuyw1V8s"
    title: "Dancing Queen"
    channel: "AbbaVEVO"
missing:
  - {id: x, reason: y}
`);
    expect(d.cards['amen-break']).toEqual([{ source: 'youtube', kind: 'official', youtube: 'HrrWhCbZAyY', start: 85, title: 'Amen Brother', channel: 'The Winstons - Topic', note: 'the break at 1:26' }]);
    expect(d.roots.abba[0].start).toBeUndefined();
    expect(Object.keys(d)).toEqual(['version', 'cards', 'roots']);
    expect(embedUrl(d.cards['amen-break'][0])).toBe('https://www.youtube-nocookie.com/embed/HrrWhCbZAyY?autoplay=1&start=85');
    expect(embedUrl(d.roots.abba[0])).toBe('https://www.youtube-nocookie.com/embed/xFrGuyw1V8s?autoplay=1');
    expect(posterUrl(d.roots.abba[0])).toBe('https://i.ytimg.com/vi/xFrGuyw1V8s/hqdefault.jpg');
  });

  it('leaves room for other sources: a direct archive file is a field recording', () => {
    const d = parseListen(`cards:\n  work-songs:\n    - {audio_url: "https://archive.example/a.mp3", title: "Holler", channel: "An archive"}\n`);
    expect(d.cards['work-songs'][0]).toMatchObject({ source: 'audio', kind: 'field', audio: 'https://archive.example/a.mp3' });
    expect(embedUrl(d.cards['work-songs'][0])).toBeUndefined();
  });

  it('reads a Russian note and a non-official kind, on YouTube too', () => {
    const d = parseListen(`cards:\n  gullah:\n    - {youtube: "HocmOCVoVOE", kind: field, title: "Mende Song", channel: "Release - Topic", note: "antiphony", noteRu: "антифония"}\n`);
    const r = d.cards.gullah[0];
    expect(r).toMatchObject({ source: 'youtube', kind: 'field', note: 'antiphony', noteRu: 'антифония' });
    expect(noteFor(r, 'ru')).toEqual({ text: 'антифония', lang: 'ru' });
    expect(noteFor(r, 'en')).toEqual({ text: 'antiphony', lang: 'en' });
  });

  it('falls back to the English note, then to the title, in Russian mode', () => {
    const enOnly = parseListen(`cards:\n  x:\n    - {youtube: "HocmOCVoVOE", title: "Song", note: "about it"}\n`);
    expect(noteFor(enOnly.cards.x[0], 'ru')).toEqual({ text: 'about it', lang: 'en' });
    const noNote = parseListen(`cards:\n  x:\n    - {youtube: "HocmOCVoVOE", title: "Song"}\n`);
    expect(noteFor(noNote.cards.x[0], 'ru')).toEqual({ text: 'Song', lang: 'en' });
  });

  it('rejects what would break a player', () => {
    expect(() => parseListen('cards:\n  x: {youtube: "not an id", title: t}\n')).toThrow(/YouTube video id/);
    expect(() => parseListen('cards:\n  x: {youtube: "HrrWhCbZAyY", title: t, start: -3}\n')).toThrow(/whole seconds/);
    expect(() => parseListen('cards:\n  x: {title: t}\n')).toThrow(/youtube or audio_url/);
  });

  it('parses the museum’s own list', () => {
    const d = parseListen(readFileSync(new URL('../../content/listen.yaml', import.meta.url), 'utf8'));
    const n = Object.values(d.cards).flat().length + Object.values(d.roots).flat().length;
    expect(n).toBe(148);
  });
});
