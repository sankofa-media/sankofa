import { parse as parseYaml } from 'yaml';
import type { Chapter, ChapterTranslation, StepCopy } from './types';

function split(src: string, file: string): { fm: Record<string, any>; body: string } {
  const data = src.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  if (!data.startsWith('---\n')) throw new Error(`${file}: missing front matter`);
  const rest = data.slice(4);
  const end = rest.indexOf('\n---\n');
  if (end < 0) throw new Error(`${file}: unterminated front matter`);
  return { fm: parseYaml(rest.slice(0, end)) ?? {}, body: rest.slice(end + 5).trim() };
}

/** Each paragraph is one scroll step. */
function paragraphs(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);
}

const MARKER = /^\{(male|female)\}\s+/;

/**
 * Paragraphs with their copy: a paragraph that opens with `{male} ` or
 * `{female} ` belongs to that copy alone (the marker is stripped); the others
 * are read in both. `copies` is set only when some paragraph is marked.
 */
export function markedParagraphs(body: string): { steps: string[]; copies?: StepCopy[] } {
  const steps: string[] = [];
  const copies: StepCopy[] = [];
  for (const p of paragraphs(body)) {
    const m = p.match(MARKER);
    steps.push(m ? p.slice(m[0].length) : p);
    copies.push(m ? (m[1] === 'male' ? 'm' : 'f') : '');
  }
  return copies.some(Boolean) ? { steps, copies } : { steps };
}

/** The chapter as one copy reads it: the other copy's paragraphs dropped. */
export function chapterForEdition<T extends { steps: string[]; stepCopies?: StepCopy[] }>(ch: T, edition: 'm' | 'f'): T {
  if (!ch.stepCopies) return ch;
  const keep = ch.stepCopies.map((c) => !c || c === edition);
  const out = { ...ch, steps: ch.steps.filter((_, i) => keep[i]) };
  delete out.stepCopies;
  return out;
}

function stepsOf(body: string): { steps: string[]; stepCopies?: StepCopy[] } {
  const { steps, copies } = markedParagraphs(body);
  return copies ? { steps, stepCopies: copies } : { steps };
}

/** Parse a chapter Markdown file (docs/card-format.md, "Chapter format"). */
export function parseChapter(src: string, file = 'chapter'): Chapter {
  const { fm, body } = split(src, file);
  if (!fm.id || typeof fm.id !== 'string') throw new Error(`${file}: id is required`);
  if (!fm.title) throw new Error(`${file}: title is required`);
  return {
    id: fm.id,
    title: String(fm.title),
    kicker: String(fm.kicker ?? ''),
    years: Array.isArray(fm.years) ? fm.years.map(Number) : [],
    hero: fm.hero ? { type: 'image', ...fm.hero } : undefined,
    places: Array.isArray(fm.places) ? fm.places : [],
    cards: Array.isArray(fm.cards) ? fm.cards.map(String) : [],
    ...stepsOf(body),
  };
}

/** Parse a chapter translation (<id>.<lang>.md): title, kicker, hero caption, credit and licence, body. */
export function parseChapterTranslation(src: string, file = 'translation'): ChapterTranslation {
  const { fm, body } = split(src, file);
  const out: ChapterTranslation = {};
  if (fm.title) out.title = String(fm.title);
  if (fm.kicker) out.kicker = String(fm.kicker);
  const cap = fm.heroCaption ?? (fm.hero && typeof fm.hero === 'object' ? fm.hero.caption : undefined);
  if (cap) out.heroCaption = String(cap);
  if (fm.heroCredit) out.heroCredit = String(fm.heroCredit);
  if (fm.heroLicense) out.heroLicense = String(fm.heroLicense);
  const { steps, stepCopies } = stepsOf(body);
  if (steps.length) out.steps = steps;
  if (stepCopies) out.stepCopies = stepCopies;
  return out;
}

export function sortChapters(chs: Chapter[]): Chapter[] {
  return [...chs].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
}
