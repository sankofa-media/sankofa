// The owner's review mode: point at anything in the museum (or select a piece
// of text) and leave a note on it, typed or dictated. Loaded only when the
// owner's token is on this device (lib/reviewGate.ts); readers never get it.

import './review.css';
import { pick } from '../lib/i18n';
import { forgetReviewToken } from '../lib/reviewGate';
import { ReviewApi, ReviewError, type Note, type NoteInput, type NoteSelection } from './api';
import { around, describe, deviceKind, excerpt, pageOf, pickable, resolve, type Target } from './locator';

const OFF_KEY = 'sankofa.review.off';
const REPLACED = new Set(['img', 'svg', 'video', 'audio', 'canvas', 'iframe', 'button', 'input', 'select', 'textarea', 'picture']);

const T = {
  comment: { en: 'Comment', ru: 'Комментарий' },
  list: { en: 'Notes', ru: 'Заметки' },
  off: { en: 'Off', ru: 'Скрыть' },
  pill: { en: 'Review', ru: 'Ревью' },
  pickHint: { en: 'Tap what the note is about', ru: 'Коснитесь того, о чём заметка' },
  cancel: { en: 'Cancel', ru: 'Отмена' },
  close: { en: 'Close', ru: 'Закрыть' },
  save: { en: 'Save', ru: 'Сохранить' },
  wider: { en: 'Wider', ru: 'Шире' },
  dictate: { en: 'Dictate', ru: 'Диктовать' },
  stopDictate: { en: 'Stop', ru: 'Стоп' },
  record: { en: 'Record voice', ru: 'Записать голос' },
  voice: { en: 'Voice attached', ru: 'Голос прикреплён' },
  removeVoice: { en: 'Remove voice', ru: 'Убрать голос' },
  placeholder: { en: 'What should change here?', ru: 'Что здесь поправить?' },
  done: { en: 'Done', ru: 'Готово' },
  reopen: { en: 'Reopen', ru: 'Открыть снова' },
  del: { en: 'Delete', ru: 'Удалить' },
  confirmDel: { en: 'Delete this note?', ru: 'Удалить заметку?' },
  show: { en: 'Show', ru: 'Показать' },
  edit: { en: 'Edit', ru: 'Изменить' },
  open: { en: 'Open', ru: 'Открытые' },
  all: { en: 'All', ru: 'Все' },
  none: { en: 'No notes yet.', ru: 'Заметок пока нет.' },
  forget: { en: 'Sign out of review on this device', ru: 'Выйти из ревью на этом устройстве' },
  saved: { en: 'Note saved', ru: 'Заметка сохранена' },
  failed: { en: 'Could not save the note', ru: 'Не удалось сохранить заметку' },
  rejected: { en: 'The review token was not accepted', ru: 'Токен ревью не принят' },
  closed: { en: 'Review is off on the server (no admin token)', ru: 'Ревью выключено на сервере (нет токена)' },
  unreachable: { en: 'Notes could not be loaded', ru: 'Заметки не загрузились' },
  notFound: { en: 'The element is not on this page now', ru: 'Элемента сейчас нет на странице' },
  selected: { en: 'Selected', ru: 'Выделено' },
};
const say = (k: keyof typeof T) => pick(T[k]);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
}

function button(cls: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', `rv-btn ${cls}`, { type: 'button' }, label);
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return b;
}

function toast(msg: string): void {
  const t = el('div', 'rv-toast', { role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null): void {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* per-device convenience only */
    }
  },
};

/** The block a tap means: inline bits stand for their block, a bare picture for its layer. */
function choose(target: Element): Element {
  let at: Element = pickable<Element>(target, (e) => {
    if (e instanceof SVGElement) return e.tagName === 'tspan' || e.tagName === 'textPath';
    return !REPLACED.has(e.tagName.toLowerCase()) && getComputedStyle(e).display === 'inline';
  });
  const layer = at.closest('[data-layer]');
  if (layer && !excerpt(at.textContent)) at = layer;
  return at;
}

function scroller(e: Element): Element {
  for (let at: Element | null = e.parentElement; at && at !== document.body; at = at.parentElement) {
    const s = getComputedStyle(at);
    if (/(auto|scroll)/.test(s.overflowY) && at.scrollHeight > at.clientHeight) return at;
  }
  return document.scrollingElement ?? document.documentElement;
}

function targetOf(e: Element): Target {
  const t = describe(e);
  const r = e.getBoundingClientRect();
  t.rect = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  return t;
}

function pageNow(e: Element): NoteInput['page'] {
  const p = pageOf(location.hash);
  return {
    url: location.href,
    hash: location.hash,
    ...p,
    lang: document.documentElement.lang || 'en',
    theme: document.documentElement.dataset.theme,
    device: deviceKind(screen.width, screen.height, matchMedia('(pointer: coarse)').matches),
    width: innerWidth,
    height: innerHeight,
    dpr: devicePixelRatio,
    scroll: Math.round(scroller(e).scrollTop),
    user_agent: navigator.userAgent,
  };
}

function selectionOf(sel: Selection | null): { range: Range; el: Element; selection: NoteSelection } | null {
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!range.toString().trim()) return null;
  const node = range.commonAncestorContainer;
  const host = node instanceof Element ? node : node.parentElement;
  if (!host || host.closest('.rv-root')) return null;
  const block = choose(host);
  const pre = document.createRange();
  pre.selectNodeContents(block);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  const full = block.textContent ?? '';
  return { range: range.cloneRange(), el: block, selection: around(full, start, start + range.toString().length) };
}

interface SpeechLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function speechCtor(): (new () => SpeechLike) | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechLike; webkitSpeechRecognition?: new () => SpeechLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export class Review {
  private readonly root = el('div', 'rv-root', { 'data-rv': '' });
  private readonly marks = el('div', 'rv-marks');
  private readonly hl = el('div', 'rv-hl', { hidden: '' });
  private readonly bar = el('div', 'rv-bar', { role: 'toolbar', 'aria-label': say('pill') });
  private readonly panel = el('div', 'rv-panel', { hidden: '', role: 'dialog', 'aria-label': say('list') });
  private notes: Note[] = [];
  private picking = false;
  private collapsed = store.get(OFF_KEY) === '1';
  private lastSel: ReturnType<typeof selectionOf> = null;
  private focusEl: Element | null = null;
  private resolved = new Map<number, Element>();
  private raf = 0;
  private listAll = false;
  private stopVoice: (() => void) | null = null;

  constructor(private readonly api: ReviewApi) {}

  async start(): Promise<void> {
    this.root.append(this.marks, this.hl, this.panel, this.bar);
    document.body.append(this.root);
    // Typing in a note must not reach the museum's keys.
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closePanel();
      e.stopPropagation();
    });
    // Our own buttons keep the reader's text selection alive.
    this.bar.addEventListener('pointerdown', (e) => e.preventDefault());
    this.bar.addEventListener('mousedown', (e) => e.preventDefault());
    document.addEventListener('selectionchange', () => {
      const s = selectionOf(document.getSelection());
      if (s) this.lastSel = s;
    });
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click', 'dblclick', 'contextmenu']) window.addEventListener(type, this.intercept, { capture: true, passive: type.startsWith('touch') });
    window.addEventListener('pointermove', this.hover, true);
    window.addEventListener('keydown', (e) => {
      if (this.picking && e.key === 'Escape') this.setPicking(false);
    });
    const later = () => (this.raf ||= requestAnimationFrame(() => ((this.raf = 0), this.place())));
    window.addEventListener('scroll', later, { capture: true, passive: true });
    window.addEventListener('resize', later);
    window.addEventListener('hashchange', () => {
      this.resolved.clear();
      later();
    });
    setInterval(() => this.place(), 800);
    this.paintBar();
    try {
      this.notes = await this.api.list();
    } catch (e) {
      if (e instanceof ReviewError && e.status === 401) {
        toast(say('rejected'));
        forgetReviewToken();
        this.root.remove();
        return;
      }
      toast(e instanceof ReviewError && e.status === 403 ? say('closed') : say('unreachable'));
    }
    this.paintBar();
    this.place();
  }

  // --- the bar --------------------------------------------------------------

  private paintBar(): void {
    this.root.classList.toggle('rv-collapsed', this.collapsed);
    if (this.collapsed) {
      this.bar.replaceChildren(
        button('rv-pill', say('pill'), () => {
          this.collapsed = false;
          store.set(OFF_KEY, null);
          this.paintBar();
          this.place();
        }),
      );
      return;
    }
    if (this.picking) {
      this.bar.replaceChildren(el('span', 'rv-hint', {}, say('pickHint')), button('', say('cancel'), () => this.setPicking(false)));
      return;
    }
    const open = this.notes.filter((n) => n.status === 'open').length;
    this.bar.replaceChildren(
      button('rv-primary rv-comment', say('comment'), () => this.onComment()),
      button('rv-list', `${say('list')} ${open}`, () => this.openList()),
      button('rv-off', say('off'), () => {
        this.setPicking(false);
        this.closePanel();
        this.collapsed = true;
        store.set(OFF_KEY, '1');
        this.paintBar();
        this.place();
      }),
    );
  }

  private onComment(): void {
    const s = selectionOf(document.getSelection()) ?? (this.lastSel && this.lastSel.el.isConnected ? this.lastSel : null);
    this.lastSel = null;
    if (s) {
      this.compose({ el: s.el, selection: s.selection });
      return;
    }
    this.setPicking(true);
  }

  private setPicking(on: boolean): void {
    this.picking = on;
    document.documentElement.classList.toggle('rv-picking', on);
    if (!on && !this.focusEl) this.highlight(null);
    this.paintBar();
  }

  // --- picking --------------------------------------------------------------

  private readonly intercept = (e: Event): void => {
    if (!this.picking) return;
    const t = e.target as Element | null;
    if (!t || !(t instanceof Element) || t.closest('.rv-root')) return;
    e.stopPropagation();
    e.stopImmediatePropagation();
    // Taps and clicks pick; presses only stop the museum from acting on them,
    // so text can still be selected with a drag.
    if (e.type === 'click' || e.type === 'contextmenu' || e.type === 'dblclick') e.preventDefault();
    if (e.type !== 'click') return;
    const s = selectionOf(document.getSelection());
    this.setPicking(false);
    if (s) this.compose({ el: s.el, selection: s.selection });
    else this.compose({ el: choose(t) });
  };

  private readonly hover = (e: PointerEvent): void => {
    if (!this.picking || e.pointerType !== 'mouse') return;
    const t = e.target as Element | null;
    if (!t || !(t instanceof Element) || t.closest('.rv-root')) return;
    this.highlight(choose(t));
  };

  private highlight(target: Element | null): void {
    if (!target) {
      this.hl.hidden = true;
      return;
    }
    const r = target.getBoundingClientRect();
    Object.assign(this.hl.style, { left: `${r.left - 3}px`, top: `${r.top - 3}px`, width: `${r.width + 6}px`, height: `${r.height + 6}px` });
    this.hl.hidden = false;
  }

  // --- markers --------------------------------------------------------------

  private place(): void {
    if (this.focusEl) this.highlight(this.focusEl.isConnected ? this.focusEl : null);
    const key = pageOf(location.hash).key;
    const shown = this.collapsed ? [] : this.notes.filter((n) => n.status === 'open' && n.page.key === key);
    const keep = new Set<string>();
    shown.forEach((n, i) => {
      let target = this.resolved.get(n.id);
      if (!target || !target.isConnected) {
        target = resolve<Element>(n.target, document) ?? undefined;
        if (target) this.resolved.set(n.id, target);
      }
      if (!target) return;
      const r = target.getBoundingClientRect();
      if (!r.width && !r.height) return;
      if (r.bottom < 0 || r.top > innerHeight) return;
      keep.add(String(n.id));
      let m = this.marks.querySelector<HTMLButtonElement>(`[data-rv-note="${n.id}"]`);
      if (!m) {
        m = button('rv-mark', String(i + 1), () => this.compose({ el: this.resolved.get(n.id) ?? target!, note: n }));
        m.dataset.rvNote = String(n.id);
        m.title = excerpt(n.comment, 120);
        m.setAttribute('aria-label', `${say('list')} #${n.id}: ${excerpt(n.comment, 80)}`);
        this.marks.append(m);
      }
      m.textContent = String(i + 1);
      m.style.left = `${Math.min(innerWidth - 30, Math.max(4, r.right - 12))}px`;
      m.style.top = `${Math.min(innerHeight - 30, Math.max(4, r.top - 12))}px`;
    });
    for (const m of [...this.marks.children] as HTMLElement[]) if (!keep.has(m.dataset.rvNote ?? '')) m.remove();
  }

  // --- the note -------------------------------------------------------------

  private closePanel(): void {
    this.stopVoice?.();
    this.panel.hidden = true;
    this.panel.replaceChildren();
    this.focusEl = null;
    this.highlight(null);
  }

  private compose(o: { el: Element; selection?: NoteSelection; note?: Note }): void {
    this.closePanel();
    let target = o.el;
    const note = o.note;
    this.focusEl = target;
    this.highlight(target);
    let audio: Blob | undefined;

    const what = el('div', 'rv-what');
    const paintWhat = () => {
      const t = note ? note.target : describe(target);
      const ids = Object.entries(t.data ?? {})
        .slice(0, 4)
        .map(([k, v]) => `${k}=${v}`)
        .join(' · ');
      const sel = note?.selection ?? o.selection;
      what.replaceChildren(
        el('div', 'rv-tag', {}, `<${t.tag}>${ids ? ` ${ids}` : ''}`),
        sel ? el('blockquote', 'rv-quote', {}, `${say('selected')}: «${excerpt(sel.text, 200)}»`) : el('div', 'rv-excerpt', {}, excerpt(t.text, 160)),
      );
    };
    paintWhat();

    const text = el('textarea', 'rv-text', { rows: '4', placeholder: say('placeholder'), 'aria-label': say('placeholder') });
    text.value = note?.comment ?? '';
    const voiceLine = el('div', 'rv-voice');
    const tools = el('div', 'rv-row');
    const actions = el('div', 'rv-row rv-actions');

    if (!note) {
      const wider = button('', say('wider'), () => {
        const up = target.parentElement;
        if (!up || up === document.body) return;
        target = up;
        this.focusEl = up;
        this.highlight(up);
        paintWhat();
      });
      tools.append(wider);
      const mic = this.voiceButton(text, voiceLine, (b) => (audio = b));
      if (mic) tools.append(mic);
    } else if (note.audio) voiceLine.textContent = `${say('voice')} (${note.audio_type ?? 'audio'})`;

    const save = button('rv-primary rv-save', say('save'), async () => {
      this.stopVoice?.();
      const comment = text.value.trim();
      if (!comment && !audio) {
        text.focus();
        return;
      }
      save.disabled = true;
      try {
        if (note) {
          const n = await this.api.update(note.id, { comment });
          this.notes = this.notes.map((x) => (x.id === n.id ? n : x));
        } else {
          const input: NoteInput = { comment, page: pageNow(target), target: targetOf(target), ...(o.selection ? { selection: o.selection } : {}) };
          const n = await this.api.create(input, audio);
          this.notes.push(n);
          this.resolved.set(n.id, target);
        }
        toast(say('saved'));
        this.closePanel();
        this.paintBar();
        this.place();
      } catch {
        save.disabled = false;
        toast(say('failed'));
      }
    });
    actions.append(save);
    if (note) {
      actions.append(
        button('', note.status === 'open' ? say('done') : say('reopen'), () => void this.setStatus(note, note.status === 'open' ? 'done' : 'open')),
        button('rv-danger', say('del'), () => void this.remove(note)),
      );
    }
    actions.append(button('', say('cancel'), () => this.closePanel()));

    this.panel.replaceChildren(what, text, voiceLine, tools, actions);
    this.panel.hidden = false;
    if (!matchMedia('(pointer: coarse)').matches) text.focus();
  }

  /** Dictation into the text field, or, where the browser has none, a voice recording. */
  private voiceButton(text: HTMLTextAreaElement, line: HTMLElement, setAudio: (b: Blob | undefined) => void): HTMLButtonElement | null {
    const Speech = speechCtor();
    const canRecord = typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
    if (!Speech && !canRecord) return null;
    let fallback = !Speech;
    const b = button('rv-mic', fallback ? say('record') : say('dictate'), () => (this.stopVoice ? this.stopVoice() : fallback ? void record() : dictate()));
    const idle = () => {
      this.stopVoice = null;
      b.classList.remove('rv-on');
      b.textContent = fallback ? say('record') : say('dictate');
    };
    const dictate = () => {
      const r = new Speech!();
      r.lang = document.documentElement.lang === 'ru' ? 'ru-RU' : 'en-US';
      r.continuous = true;
      r.interimResults = true;
      const base = text.value ? `${text.value.trimEnd()} ` : '';
      let final = '';
      r.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) final += res[0].transcript;
          else interim += res[0].transcript;
        }
        text.value = base + final + interim;
      };
      r.onerror = (e) => {
        if (['not-allowed', 'service-not-allowed', 'network', 'language-not-supported'].includes(e.error) && canRecord) {
          fallback = true;
          idle();
        }
      };
      r.onend = () => {
        text.value = (base + final).trimEnd() || text.value;
        idle();
      };
      r.start();
      this.stopVoice = () => r.stop();
      b.classList.add('rv-on');
      b.textContent = say('stopDictate');
    };
    const record = async () => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        return;
      }
      const type = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported?.(t));
      const rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined);
      const chunks: Blob[] = [];
      const began = Date.now();
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: (rec.mimeType || type || 'audio/webm').split(';')[0] });
        setAudio(blob);
        const secs = Math.round((Date.now() - began) / 1000);
        line.replaceChildren(
          `${say('voice')} · ${secs} s `,
          button('rv-link', say('removeVoice'), () => {
            setAudio(undefined);
            line.replaceChildren();
          }),
        );
        idle();
      };
      rec.start();
      this.stopVoice = () => rec.state !== 'inactive' && rec.stop();
      b.classList.add('rv-on');
      b.textContent = say('stopDictate');
    };
    return b;
  }

  private async setStatus(note: Note, status: 'open' | 'done'): Promise<void> {
    try {
      const n = await this.api.update(note.id, { status });
      this.notes = this.notes.map((x) => (x.id === n.id ? n : x));
      this.closePanel();
      this.paintBar();
      this.place();
    } catch {
      toast(say('failed'));
    }
  }

  private async remove(note: Note): Promise<void> {
    if (!confirm(say('confirmDel'))) return;
    try {
      await this.api.remove(note.id);
      this.notes = this.notes.filter((x) => x.id !== note.id);
      this.resolved.delete(note.id);
      this.closePanel();
      this.paintBar();
      this.place();
    } catch {
      toast(say('failed'));
    }
  }

  // --- the list -------------------------------------------------------------

  private openList(): void {
    this.closePanel();
    const shown = this.notes.filter((n) => this.listAll || n.status === 'open').slice().reverse();
    const head = el(
      'div',
      'rv-row rv-listhead',
      {},
      button(this.listAll ? '' : 'rv-primary', say('open'), () => ((this.listAll = false), this.openList())),
      button(this.listAll ? 'rv-primary' : '', say('all'), () => ((this.listAll = true), this.openList())),
      button('', say('close'), () => this.closePanel()),
    );
    const items = el('ol', 'rv-items');
    for (const n of shown) {
      const where = [n.page.key, n.page.scene].filter(Boolean).join(' · ');
      items.append(
        el(
          'li',
          `rv-item rv-${n.status}`,
          {},
          el('div', 'rv-tag', {}, `#${n.id} · ${where} · ${n.status}`),
          el('div', 'rv-comment-text', {}, excerpt(n.comment, 240) || (n.audio ? say('voice') : '')),
          el('div', 'rv-excerpt', {}, excerpt(n.selection?.text ?? n.target.text, 120)),
          el(
            'div',
            'rv-row',
            {},
            button('', say('show'), () => void this.show(n)),
            button('', n.status === 'open' ? say('done') : say('reopen'), () => void this.setStatus(n, n.status === 'open' ? 'done' : 'open').then(() => this.openList())),
          ),
        ),
      );
    }
    const forget = button('rv-link', say('forget'), () => {
      forgetReviewToken();
      store.set(OFF_KEY, null);
      this.root.remove();
    });
    this.panel.replaceChildren(head, shown.length ? items : el('p', 'rv-excerpt', {}, say('none')), forget);
    this.panel.hidden = false;
  }

  private async show(n: Note): Promise<void> {
    this.closePanel();
    if (n.page.hash !== location.hash && pageOf(n.page.hash).key !== pageOf(location.hash).key) location.hash = n.page.hash;
    // The page may still be opening: look for the element for a few seconds.
    for (let i = 0; i < 25; i++) {
      const t = resolve<Element>(n.target, document);
      if (t && t.getClientRects().length) {
        t.scrollIntoView({ block: 'center', behavior: 'smooth' });
        this.resolved.set(n.id, t);
        setTimeout(() => this.compose({ el: t, note: n }), 450);
        return;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    toast(say('notFound'));
  }
}

/** Start the review mode with the owner's token. */
export function install(token: string): Review {
  const r = new Review(new ReviewApi(token));
  void r.start();
  return r;
}
