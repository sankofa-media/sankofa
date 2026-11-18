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
/** `{at Place · Year} `: the label a step shows, written for the paragraph itself. */
const LABEL = /^\{at ([^{}]+)\}\s+/;

/**
 * Paragraphs with their copy and label: a paragraph that opens with `{male} `
 * or `{female} ` belongs to that copy alone, the others are read in both; after
 * that marker a paragraph may carry its label as `{at Place · Year} `. Markers
 * are stripped; `copies` and `labels` are set only when some paragraph has one.
 */
export function markedParagraphs(body: string): { steps: string[]; copies?: StepCopy[]; labels?: string[] } {
  const steps: string[] = [];
  const copies: StepCopy[] = [];
  const labels: string[] = [];
  for (let p of paragraphs(body)) {
    const m = p.match(MARKER);
    if (m) p = p.slice(m[0].length);
    const l = p.match(LABEL);
    if (l) p = p.slice(l[0].length);
    steps.push(p);
    copies.push(m ? (m[1] === 'male' ? 'm' : 'f') : '');
    labels.push(l ? l[1].trim() : '');
  }
  return {
    steps,
    ...(copies.some(Boolean) ? { copies } : {}),
    ...(labels.some(Boolean) ? { labels } : {}),
  };
}

/** The chapter as one copy reads it: the other copy's paragraphs dropped. */
export function chapterForEdition<T extends { steps: string[]; stepCopies?: StepCopy[]; stepLabels?: string[] }>(ch: T, edition: 'm' | 'f'): T {
  if (!ch.stepCopies) return ch;
  const keep = ch.stepCopies.map((c) => !c || c === edition);
  const out = { ...ch, steps: ch.steps.filter((_, i) => keep[i]) };
  if (ch.stepLabels) out.stepLabels = ch.stepLabels.filter((_, i) => keep[i]);
  delete out.stepCopies;
  return out;
}

function stepsOf(body: string): { steps: string[]; stepCopies?: StepCopy[]; stepLabels?: string[] } {
  const { steps, copies, labels } = markedParagraphs(body);
  return { steps, ...(copies ? { stepCopies: copies } : {}), ...(labels ? { stepLabels: labels } : {}) };
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
  const { steps, stepCopies, stepLabels } = stepsOf(body);
  if (steps.length) out.steps = steps;
  if (stepCopies) out.stepCopies = stepCopies;
  if (stepLabels) out.stepLabels = stepLabels;
  return out;
}

export function sortChapters(chs: Chapter[]): Chapter[] {
  return [...chs].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
}
