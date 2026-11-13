// What a chapter paragraph may say about its own step, at its start:
//   {at Timbuktu · 2012}   the step's label (place · year), set by hand
//   {img card-id:1}        the picture the step shows: that card's image n
// The chapter build may strip these itself and hand them over as fields
// (step objects or arrays beside the steps); either way the story reads them
// here, as clean text with a label and a picture beside it.
import type { Chapter } from './types';

export interface StepImageRef {
  card: string;
  /** Index among the card's images, from 0. */
  index: number;
}

export interface StepMarks {
  text: string;
  label?: string;
  img?: StepImageRef;
}

/** A chapter whose steps carry their own labels and pictures. */
export type MarkedChapter = Chapter & {
  stepLabels?: (string | undefined)[];
  stepImages?: (StepImageRef | undefined)[];
};

const AT = /^\{at\s+([^}]*\S)\s*\}\s*/;
const IMG = /^\{img\s+([a-z0-9][\w-]*)(?::(\d+))?\s*\}\s*/i;
const COPY = /^\{(male|female)\}\s+/;

export function parseImageRef(s: string): StepImageRef | undefined {
  const m = s.trim().match(/^([a-z0-9][\w-]*)(?::(\d+))?$/i);
  return m ? { card: m[1], index: m[2] ? Number(m[2]) : 0 } : undefined;
}

/** Read the markers at the start of a paragraph, in any order, and strip them. */
export function stepMarks(paragraph: string): StepMarks {
  let text = paragraph;
  let label: string | undefined;
  let img: StepImageRef | undefined;
  let copy = '';
  for (;;) {
    const c = text.match(COPY);
    if (c && !copy) {
      copy = c[0];
      text = text.slice(c[0].length);
      continue;
    }
    const a = text.match(AT);
    if (a && label === undefined) {
      label = a[1].replace(/\s+/g, ' ');
      text = text.slice(a[0].length);
      continue;
    }
    const i = text.match(IMG);
    if (i && !img) {
      img = { card: i[1], index: i[2] ? Number(i[2]) : 0 };
      text = text.slice(i[0].length);
      continue;
    }
    break;
  }
  return { text: copy + text, ...(label ? { label } : {}), ...(img ? { img } : {}) };
}

type RawStep = string | { text?: string; body?: string; p?: string; label?: string; at?: string; img?: string | StepImageRef; image?: string | StepImageRef };

function refOf(x: unknown): StepImageRef | undefined {
  if (!x) return undefined;
  if (typeof x === 'string') return parseImageRef(x);
  const o = x as Partial<StepImageRef>;
  return typeof o.card === 'string' ? { card: o.card, index: Number(o.index ?? 0) || 0 } : undefined;
}

/** One step as a marked string, whatever shape the build gave it. */
function fold(step: RawStep, label?: unknown, img?: unknown): string {
  const o = typeof step === 'string' ? { text: step } : step ?? {};
  const text = String(o.text ?? o.body ?? o.p ?? '');
  const l = (typeof label === 'string' && label) || (typeof step === 'object' ? step.label || step.at : undefined);
  const r = refOf(img) ?? (typeof step === 'object' ? refOf(step.img ?? step.image) : undefined);
  // Keep a {male}/{female} marker first, as the copy filter expects.
  const copy = text.match(COPY)?.[0] ?? '';
  const rest = text.slice(copy.length);
  return copy + (l && !AT.test(rest) ? `{at ${l}} ` : '') + (r && !IMG.test(rest) ? `{img ${r.card}:${r.index}} ` : '') + rest;
}

interface StepFields {
  steps?: unknown[];
  stepLabels?: unknown[];
  stepImages?: unknown[];
}

function foldFields<T extends StepFields>(x: T): T {
  if (!Array.isArray(x.steps)) return x;
  const labels = x.stepLabels;
  const imgs = x.stepImages;
  const plain = x.steps.every((s) => typeof s === 'string') && !labels && !imgs;
  if (plain) return x;
  const out = { ...x, steps: x.steps.map((s, i) => fold(s as RawStep, labels?.[i], imgs?.[i])) };
  delete out.stepLabels;
  delete out.stepImages;
  return out;
}

/**
 * Before the language and the copy are chosen: every step (and every
 * translated step) as one string with its markers, so the filters that drop
 * paragraphs keep each label with its own paragraph.
 */
export function foldStepMarks(ch: Chapter): Chapter {
  const out = foldFields(ch as Chapter & StepFields);
  if (!out.translations) return out;
  const translations = Object.fromEntries(Object.entries(out.translations).map(([k, tr]) => [k, foldFields(tr as typeof tr & StepFields)]));
  return { ...out, translations };
}

/** After: clean step text, with the labels and pictures beside it. */
export function splitStepMarks(ch: Chapter): MarkedChapter {
  const marks = ch.steps.map(stepMarks);
  if (!marks.some((m) => m.label || m.img) && marks.every((m, i) => m.text === ch.steps[i])) return ch;
  return {
    ...ch,
    steps: marks.map((m) => m.text),
    stepLabels: marks.map((m) => m.label),
    stepImages: marks.map((m) => m.img),
  };
}
