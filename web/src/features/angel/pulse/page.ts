// The end of Angel, in the page itself, three steps: feel, say, end. On a
// phone the first step is a field: a finger held on the screen feels the one
// pulse left here (whose it is is never said) beating under it in vibration,
// with a stranger's word surfacing on every beat, and the way on opens after
// eight beats. On a computer the pulse cannot be felt or heard: the first
// step is a calm block — a line of words and a code that opens this ending on
// a phone — and the page goes on to the words at once. Then the reader may
// leave the words that were never said; the end shows the one pulse beating
// in the middle, the words drifting around it, the reader's own whole under
// it. If the Angel service cannot be reached, only the last line is shown.
import { h } from '../../../lib/dom';
import { lang } from '../../../lib/i18n';
import * as api from '../api';
import { beatsBetween, lubDub, waveAt } from './wave';

export interface PulsePageOptions {
  host: HTMLElement;
  /** A phone: the pulse is felt here; elsewhere a code opens this ending on a phone. */
  phone: boolean;
  /** The code to open this ending on a phone. */
  qr(): Node;
  /** The feature's labels, with {vars}. */
  say(key: string, vars?: Record<string, string | number>): string;
  /** The engine's labels (close). */
  engine(key: string): string;
  calm(): boolean;
}

const WORDS_MAX = 280;
const VOICE_MAX = 30;
const PRINT_MS = 12_000;
const PALM_PX = 38;
/** Beats felt under the finger before the way on opens. */
const FEEL_BEATS = 8;
/** At most this many surfaced words stay on screen at once. */
const WORDS_ON_SCREEN = 2;
/** Where the reader's own words are kept between visits, on this device only. */
const MY_WORDS_KEY = 'sankofa.angel.mywords';
const STEPS = ['feel', 'say', 'end'] as const;
type Step = (typeof STEPS)[number];

interface Point {
  x: number;
  y: number;
  r: number;
}

const canVibrate = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
const buzz = (p: number | number[]) => {
  try {
    navigator.vibrate?.(p);
  } catch {
    /* not yet allowed */
  }
};

export class PulsePage {
  readonly el: HTMLElement;
  isOpen = false;
  private scroll: HTMLElement;
  private touchSec: HTMLElement;
  private canvas: HTMLCanvasElement;
  private floatBox: HTMLElement;
  private othersLine: HTMLElement;
  private sayEl: HTMLElement;
  private particles: HTMLCanvasElement;
  private endEl: HTMLElement;
  private endCanvas: HTMLCanvasElement;
  private endCount: HTMLElement;
  private cloud: HTMLElement;
  private feltLine: HTMLElement;
  private further: HTMLButtonElement;
  private mineCloud: HTMLElement | null = null;
  private felt = 0;
  private myWords = '';
  private endRaf = 0;
  private raf = 0;
  private t0 = 0;
  private lastT = 0;
  private first: number[] = [];
  private words: api.Word[] = [];
  private wordAt = 0;
  private pointers = new Map<number, { x: number; y: number; w: number; h: number }>();
  private centre: Point | null = null;
  private prints: (Point & { born: number })[] = [];
  private beatGlow = 0;
  private others: api.Presence = { count: 0, watching: 0, points: [] };
  private stopPresence: (() => void) | null = null;
  private id = api.tabId();
  private heartbeat = 0;
  private lastSent = 0;
  private haptic: HTMLLabelElement | null = null;

  constructor(private readonly o: PulsePageOptions) {
    const say = o.say;
    try {
      this.myWords = localStorage.getItem(MY_WORDS_KEY) ?? '';
    } catch {
      /* storage is unavailable */
    }
    this.canvas = h('canvas.ap-canvas', { 'aria-hidden': 'true' }) as HTMLCanvasElement;
    this.floatBox = h('div.ap-float', { 'aria-hidden': 'true' });
    this.othersLine = h('p.ap-others', { 'aria-live': 'polite' });
    this.feltLine = h('p.ap-felt', { 'aria-live': 'polite' });
    this.further = h('button.btn.primary.ap-further', { type: 'button' }, say('pulse-further')) as HTMLButtonElement;
    this.further.addEventListener('click', () => this.goWords());
    if (o.phone) {
      this.further.hidden = true;
      this.touchSec = h(
        'section.ap-sec.ap-touch',
        { 'aria-label': say('pulse-touch') },
        this.canvas,
        h('p.ap-step.ap-touch-step', {}, say('step-feel')),
        h('div.ap-touch-intro', {}, h('p.ap-touch-line', {}, say('pulse-touch'))),
        this.floatBox,
        h('div.ap-touch-foot', {}, this.othersLine, this.feltLine, this.further),
      );
      this.wireTouch();
    } else {
      // No field on a computer: the words, the code, and on to the words.
      this.touchSec = h(
        'section.ap-sec.ap-touch.ap-desk',
        {},
        h('p.ap-step.ap-touch-step', {}, say('step-feel')),
        h('p.ap-touch-line', {}, say('pulse-phone')),
        h('figure.ap-qr.ap-feel-qr', {}, o.qr()),
        this.further,
      );
    }
    this.cloud = h('div.ap-cloud', { 'aria-label': say('words-cloud') });
    this.sayEl = this.buildWords();
    this.endCanvas = h('canvas.ap-end-canvas', { 'aria-hidden': 'true' }) as HTMLCanvasElement;
    this.endCount = h('p.ap-end-count');
    this.endEl = h('section.ap-sec.ap-end', {}, this.endCanvas, h('div.ap-end-words', {}, this.endCount, h('p.ap-last-line', {}, say('last'))));
    this.scroll = h('div.ap-scroll', {}, this.touchSec, this.sayEl, this.endEl);
    this.particles = h('canvas.ap-particles', { 'aria-hidden': 'true' }) as HTMLCanvasElement;
    this.el = h('section.an-pulse', { 'aria-label': say('ending'), 'data-state': 'loading', 'data-step': 'feel' }, this.scroll, this.particles);
    o.host.append(this.el);
    // The iOS switch's tactile click, behind a flag until it is proven on a device.
    if (this.switchHaptic()) {
      const input = h('input', { type: 'checkbox', switch: '', tabindex: '-1', 'aria-hidden': 'true' });
      this.haptic = h('label.ap-haptic', { 'aria-hidden': 'true' }, input) as HTMLLabelElement;
      this.el.append(this.haptic);
    }
  }

  private switchHaptic(): boolean {
    try {
      return /(^|[#&])haptic=switch(&|$)/.test(location.hash) || localStorage.getItem('sankofa.angel.haptic') === 'switch';
    } catch {
      return false;
    }
  }

  // ---------- open and close ----------

  /** Start: the ending has come into view. */
  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    void this.load();
  }

  /** The reader scrolled back up: stop the presence and the frame loops, keep the steps. */
  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.lift(true);
    this.stopPresence?.();
    this.stopPresence = null;
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.endRaf);
    this.raf = this.endRaf = 0;
  }

  private stepAt(): number {
    return STEPS.indexOf(this.el.dataset.step as Step);
  }

  /** Open the next step (never go back) and, unless asked not to, bring it into view. */
  private reach(step: Step, scroll = true): void {
    if (STEPS.indexOf(step) <= this.stepAt()) return;
    this.el.dataset.step = step;
    const target = { feel: this.touchSec, say: this.sayEl, end: this.endEl }[step];
    if (scroll) requestAnimationFrame(() => target.scrollIntoView({ behavior: this.o.calm() ? 'auto' : 'smooth', block: 'start' }));
    if (step === 'end') this.finale();
  }

  /** On to the words, and bring them under the eye (a no-op where they already are). */
  private goWords(): void {
    this.reach('say', false);
    requestAnimationFrame(() => this.sayEl.scrollIntoView({ behavior: this.o.calm() ? 'auto' : 'smooth', block: 'start' }));
  }

  private async load(): Promise<void> {
    const ps = await api.pulses();
    if (!ps) {
      // No service: nothing to explain, only the last line.
      this.el.dataset.state = 'offline';
      this.el.dataset.step = 'end';
      return;
    }
    if (!this.words.length) void api.words(lang()).then((w) => this.setWords(w));
    if (!ps.first) {
      // No pulse yet: nothing to feel, but the words can be left.
      this.el.dataset.state = 'empty';
      this.reach('say', false);
      return;
    }
    this.first = ps.first.rr;
    this.el.dataset.state = 'full';
    this.t0 = performance.now();
    this.lastT = 0;
    if (this.o.phone) {
      // The field, the presence and the beating run on a phone only.
      this.stopPresence = api.presence((p) => (this.others = p));
      this.paintFelt();
      if (this.isOpen && !this.raf) this.raf = requestAnimationFrame((t) => this.frame(t));
    } else {
      // On a computer the words step opens at once: the feel block stays right above it.
      this.reach('say', false);
    }
    if (this.el.dataset.step === 'end') this.finale();
  }

  // ---------- touch ----------

  private wireTouch(): void {
    const c = this.touchSec;
    const pos = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top, w: e.width || 1, h: e.height || 1 };
    };
    c.addEventListener('pointerdown', (e) => {
      if ((e.target as Element).closest('button')) return;
      if (this.el.dataset.state !== 'full') return;
      e.preventDefault();
      try {
        c.setPointerCapture(e.pointerId);
      } catch {
        /* a pointer the browser no longer tracks */
      }
      const first = this.pointers.size === 0;
      this.pointers.set(e.pointerId, pos(e));
      this.updateCentre();
      if (first) this.down();
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, pos(e));
      this.updateCentre();
      const now = performance.now();
      if (now - this.lastSent > 250) this.report(true);
    });
    const up = (e: PointerEvent) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size === 0) this.lift(false);
      else this.updateCentre();
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Where the hand is: the middle of the fingers, and how far the warmth spreads (a palm is large). */
  private updateCentre(): void {
    const ps = [...this.pointers.values()];
    if (!ps.length) return;
    const x = ps.reduce((s, p) => s + p.x, 0) / ps.length;
    const y = ps.reduce((s, p) => s + p.y, 0) / ps.length;
    const contact = Math.max(...ps.map((p) => Math.max(p.w, p.h)));
    const spread = Math.max(...ps.map((p) => Math.hypot(p.x - x, p.y - y)));
    const palm = ps.length >= 3 || contact >= PALM_PX;
    this.centre = { x, y, r: palm ? Math.max(140, spread + contact * 1.6) : 70 };
    this.touchSec.dataset.palm = String(palm);
  }

  private down(): void {
    this.touchSec.dataset.touching = '';
    this.report(true);
    clearInterval(this.heartbeat);
    this.heartbeat = window.setInterval(() => this.report(true), 5000);
  }

  private lift(quiet: boolean): void {
    const was = this.touchSec.dataset.touching !== undefined;
    this.pointers.clear();
    delete this.touchSec.dataset.touching;
    clearInterval(this.heartbeat);
    if (!was) return;
    if (this.centre && !quiet) this.prints.push({ ...this.centre, born: performance.now() });
    api.touch(this.id, false);
    buzz(0);
  }

  private report(down: boolean): void {
    if (!this.centre) return;
    this.lastSent = performance.now();
    const r = this.touchSec.getBoundingClientRect();
    api.touch(this.id, down, Math.min(1, Math.max(0, this.centre.x / r.width)), Math.min(1, Math.max(0, this.centre.y / r.height)));
  }

  // ---------- the beat and the picture ----------

  private frame(now: number): void {
    if (!this.isOpen) return;
    const t = now - this.t0;
    const touching = this.touchSec.dataset.touching !== undefined;
    for (const b of beatsBetween(this.lastT, t, this.first)) this.beat(b.rr, touching);
    this.lastT = t;
    this.beatGlow *= 0.93;
    this.draw(t, touching);
    this.raf = requestAnimationFrame((tt) => this.frame(tt));
  }

  /** One beat of the pulse: felt in the hand, seen in the light, and a word surfaces near it. */
  private beat(rr: number, touching: boolean): void {
    this.beatGlow = 1;
    if (!touching) return;
    if (canVibrate()) buzz(lubDub(rr));
    else if (this.haptic) this.haptic.click();
    this.surfaceWord();
    if (this.el.dataset.step === 'feel') {
      this.felt = Math.min(FEEL_BEATS, this.felt + 1);
      this.paintFelt();
    }
  }

  private paintFelt(): void {
    const left = FEEL_BEATS - this.felt;
    this.feltLine.textContent = this.el.dataset.step !== 'feel' || this.felt === 0 || left <= 0 ? '' : this.o.say('pulse-felt', { n: left });
    if (left <= 0 && this.o.phone) this.further.hidden = false;
  }

  /** The words others left: the cloud above the field, and the words that surface under the finger. */
  private setWords(ws: api.Word[]): void {
    this.words = ws.sort(() => Math.random() - 0.5);
    this.cloud.replaceChildren(...this.words.slice(0, 40).map((w, i) => cloudWord(w.text, w.translation, w.lang, i)));
    this.showMine();
  }

  /** The reader's own words stand in the cloud at once, here and on this device later; the others see them only after moderation. */
  private showMine(): void {
    if (!this.myWords) return;
    this.mineCloud ??= h('span.ap-cloud-word.ap-mine', { style: '--s:1.15;--o:0.95' }, this.myWords);
    if (this.mineCloud.parentElement !== this.cloud) this.cloud.append(this.mineCloud);
  }

  /** A word surfaces on the beat and stays a while: fully inside the field, clear of the finger and of the words still up. */
  private surfaceWord(): void {
    if (!this.words.length || !this.centre || this.floatBox.childElementCount >= WORDS_ON_SCREEN) return;
    const w = this.words[this.wordAt++ % this.words.length];
    const tr = w.translation && w.translation !== w.text ? h('small', {}, w.translation) : null;
    const span = h('span.ap-word', { lang: w.lang || undefined }, w.text, tr);
    span.addEventListener('animationend', () => span.remove());
    this.floatBox.append(span);
    const spot = this.wordSpot(span);
    if (!spot) {
      // No room: the beat passes without a word.
      span.remove();
      return;
    }
    span.style.left = `${spot.x.toFixed(0)}px`;
    span.style.top = `${spot.y.toFixed(0)}px`;
  }

  /** A free place for a surfaced word, tried around the finger (a few radii, eight angles, a little jitter). */
  private wordSpot(span: HTMLElement): { x: number; y: number } | null {
    const c = this.centre;
    if (!c) return null;
    const field = this.touchSec.getBoundingClientRect();
    const intro = this.touchSec.querySelector('.ap-touch-intro')?.getBoundingClientRect();
    const foot = this.touchSec.querySelector('.ap-touch-foot')?.getBoundingClientRect();
    const pad = 16;
    const topLim = (intro ? intro.bottom - field.top : 0) + 14;
    const botLim = (foot ? foot.top - field.top : field.height) - 14;
    const up = ([...this.floatBox.children] as HTMLElement[])
      .filter((s) => s !== span)
      .map((s) => {
        const r = s.getBoundingClientRect();
        return { left: r.left - field.left, top: r.top - field.top, right: r.right - field.left, bottom: r.bottom - field.top };
      });
    const fits = (r: { left: number; top: number; right: number; bottom: number }) => {
      if (r.left < pad || r.right > field.width - pad || r.top < topLim || r.bottom > botLim) return false;
      // Clear of the finger: the box stays outside the circle around it.
      const nx = Math.max(r.left, Math.min(c.x, r.right));
      const ny = Math.max(r.top, Math.min(c.y, r.bottom));
      if (Math.hypot(nx - c.x, ny - c.y) < c.r + 24) return false;
      return !up.some((o) => r.left < o.right && r.right > o.left && r.top < o.bottom && r.bottom > o.top);
    };
    const a0 = Math.random() * Math.PI * 2;
    for (const radius of [c.r + 84, c.r + 150, c.r + 216]) {
      for (let k = 0; k < 8; k++) {
        const a = a0 + (k * Math.PI) / 4;
        const d = radius + (Math.random() - 0.5) * 28;
        const x = c.x + Math.cos(a) * d;
        const y = c.y + Math.sin(a) * d;
        span.style.left = `${x.toFixed(0)}px`;
        span.style.top = `${y.toFixed(0)}px`;
        const r = span.getBoundingClientRect();
        if (fits({ left: r.left - field.left, top: r.top - field.top, right: r.right - field.left, bottom: r.bottom - field.top })) return { x, y };
      }
    }
    return null;
  }

  private draw(t: number, touching: boolean): void {
    const c = this.canvas;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const W = c.clientWidth;
    const H = c.clientHeight;
    if (!W || !H) return;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const now = performance.now();
    const calm = this.o.calm();
    const centre = this.centre ?? { x: W / 2, y: H * 0.55, r: 70 };
    const wave = waveAt(t, this.first);
    // Without vibration the pulse is in the light: a stronger swell and a slight scale.
    const light = canVibrate() ? 0.35 : 0.7;

    // The warm prints left by fingers, melting.
    this.prints = this.prints.filter((p) => now - p.born < PRINT_MS);
    for (const p of this.prints) {
      const a = 1 - (now - p.born) / PRINT_MS;
      glow(g, p.x, p.y, p.r * 1.3, `rgba(255, 176, 102, ${(0.35 * a).toFixed(3)})`);
    }

    // Others touching a screen right now: dots, thin threads between them, rings spreading like on water.
    const r = this.touchSec.getBoundingClientRect();
    let pts = this.others.points.map((p) => ({ x: p.x * r.width, y: p.y * r.height }));
    if (touching && pts.length) {
      // One of them is this hand: leave out the point nearest to it.
      let k = 0;
      pts.forEach((p, i) => {
        if (Math.hypot(p.x - centre.x, p.y - centre.y) < Math.hypot(pts[k].x - centre.x, pts[k].y - centre.y)) k = i;
      });
      pts = pts.filter((_, i) => i !== k);
    }
    g.lineWidth = 1;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = touching ? centre : pts[(i + 1) % pts.length];
      if (q !== p) {
        g.strokeStyle = 'rgba(255, 214, 170, 0.22)';
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(q.x, q.y);
        g.stroke();
      }
      g.fillStyle = 'rgba(255, 226, 190, 0.85)';
      g.beginPath();
      g.arc(p.x, p.y, 4, 0, Math.PI * 2);
      g.fill();
      if (!calm) {
        const ph = ((now + i * 700) % 2600) / 2600;
        g.strokeStyle = `rgba(255, 214, 170, ${(0.4 * (1 - ph)).toFixed(3)})`;
        g.beginPath();
        g.arc(p.x, p.y, 6 + ph * 110, 0, Math.PI * 2);
        g.stroke();
      }
    }
    const n = Math.max(0, this.others.count - (touching ? 1 : 0));
    const line = n > 0 ? this.o.say('pulse-others', { n }) : '';
    if (this.othersLine.textContent !== line) this.othersLine.textContent = line;

    // The pulse: warmth under the hand that swells with every beat.
    const swell = 1 + (calm ? 0.08 : 0.16 + (light - 0.35) * 0.3) * Math.max(wave, this.beatGlow * 0.6);
    const R = centre.r * swell * (touching ? 1 : 0.8);
    glow(g, centre.x, centre.y, R * 1.9, `rgba(255, 170, 92, ${((touching ? 0.32 : 0.14) + light * 0.35 * wave).toFixed(3)})`);
    glow(g, centre.x, centre.y, R * 0.8, `rgba(255, 232, 196, ${((touching ? 0.3 : 0.1) + light * 0.3 * wave).toFixed(3)})`);
    this.touchSec.style.setProperty('--ap-beat', (wave * light).toFixed(3));

    // The wave rebuilt from the rhythm, passing under the hand: three seconds across the screen.
    const span = 3200;
    g.strokeStyle = `rgba(255, 238, 214, ${touching ? 0.9 : 0.4})`;
    g.lineWidth = 1.6;
    g.beginPath();
    for (let x = 0; x <= W; x += 3) {
      // The hand is now; to its left, the beats just gone.
      const tt = t - ((centre.x - x) / W) * span;
      const y = centre.y - waveAt(tt, this.first) * Math.min(90, H * 0.12);
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }

  // ---------- words ----------

  private buildWords(): HTMLElement {
    const say = this.o.say;
    const text = h('textarea.ap-text', { maxlength: String(WORDS_MAX), rows: '4', placeholder: say('words-placeholder'), 'aria-label': say('words-placeholder') }) as HTMLTextAreaElement;
    const voiceBtn = h('button.btn.ap-voice', { type: 'button', 'aria-pressed': 'false' }, h('span.ap-rec', { 'aria-hidden': 'true' }), h('span.ap-voice-tx', {}, say('words-voice'))) as HTMLButtonElement;
    const clock = h('span.ap-clock', { 'aria-live': 'off' });
    const keepVoice = h('input', { type: 'checkbox' }) as HTMLInputElement;
    const keepRow = h('label.ap-check', { hidden: true }, keepVoice, h('span', {}, say('words-keep-voice')));
    const send = h('button.btn.primary.ap-release', { type: 'button' }, say('words-send')) as HTMLButtonElement;
    const skip = h('button.btn.ap-skip', { type: 'button' }, say('words-skip')) as HTMLButtonElement;
    const said = h('div.ap-said', { 'aria-live': 'polite' });
    skip.addEventListener('click', () => this.reach('end'));
    if (typeof MediaRecorder !== 'function' || !navigator.mediaDevices?.getUserMedia) voiceBtn.hidden = true;

    let audio: Blob | null = null;
    let rec: MediaRecorder | null = null;
    let recTimer = 0;
    const stopRec = () => {
      if (rec && rec.state !== 'inactive') rec.stop();
    };
    voiceBtn.addEventListener('click', async () => {
      if (rec && rec.state === 'recording') return stopRec();
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        return;
      }
      const chunks: Blob[] = [];
      rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(recTimer);
        audio = chunks.length ? new Blob(chunks, { type: rec?.mimeType || 'audio/webm' }) : null;
        voiceBtn.setAttribute('aria-pressed', 'false');
        voiceBtn.querySelector('.ap-voice-tx')!.textContent = say('words-voice');
        keepRow.hidden = !audio;
      };
      const started = performance.now();
      rec.start();
      voiceBtn.setAttribute('aria-pressed', 'true');
      voiceBtn.querySelector('.ap-voice-tx')!.textContent = say('words-voice-stop');
      recTimer = window.setInterval(() => {
        const s = Math.floor((performance.now() - started) / 1000);
        clock.textContent = `0:${String(Math.min(VOICE_MAX, s)).padStart(2, '0')}`;
        if (s >= VOICE_MAX) stopRec();
      }, 250);
    });

    send.addEventListener('click', async () => {
      const words = text.value.trim();
      if (!words && !audio) {
        text.focus();
        return;
      }
      send.disabled = skip.disabled = true;
      this.dissolve(text);
      const code = await api.sendWords({ text: words, lang: lang(), audio, keepVoice: keepVoice.checked });
      send.disabled = skip.disabled = false;
      if (!code) {
        // Nothing on screen goes wrong: the words come back to the field.
        text.value = words;
        text.classList.remove('ap-gone');
        return;
      }
      this.myWords = words;
      try {
        localStorage.setItem(MY_WORDS_KEY, words);
      } catch {
        /* storage is unavailable: the words still live on this page */
      }
      this.showMine();
      text.value = '';
      text.classList.remove('ap-gone');
      audio = null;
      keepRow.hidden = true;
      clock.textContent = '';
      const kept = h('p.ap-note.ap-code', {}, say('words-delete', { code }));
      this.endEl.querySelector('.ap-end-words')?.append(kept);
      this.reach('end');
    });

    return h(
      'section.ap-sec.ap-say',
      {},
      h('p.ap-step', {}, say('step-say')),
      this.cloud,
      h('p.ap-lead', {}, say('words-invite')),
      text,
      h('div.ap-row', {}, voiceBtn, clock),
      keepRow,
      h('div.ap-row', {}, send, skip),
      said,
    );
  }

  /** The letters come apart into warm specks that drift up into the wave. */
  private dissolve(field: HTMLTextAreaElement): void {
    field.classList.add('ap-gone');
    if (this.o.calm() || !field.value.trim()) return;
    const c = this.particles;
    const dpr = Math.min(2, devicePixelRatio || 1);
    c.width = innerWidth * dpr;
    c.height = innerHeight * dpr;
    const g = c.getContext('2d');
    if (!g) return;
    const box = field.getBoundingClientRect();
    const n = Math.min(420, 30 + field.value.length * 4);
    const ps = Array.from({ length: n }, () => ({ x: box.left + 14 + Math.random() * (box.width - 28), y: box.top + 14 + Math.random() * (box.height - 28), vx: (Math.random() - 0.5) * 0.6, vy: -0.4 - Math.random() * 1.6, a: 0.9 }));
    const start = performance.now();
    const step = (now: number) => {
      const k = (now - start) / 1800;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, innerWidth, innerHeight);
      for (const p of ps) {
        p.vx += Math.sin(p.y / 40 + now / 300) * 0.05;
        p.vy -= 0.04;
        p.x += p.vx;
        p.y += p.vy;
        g.fillStyle = `rgba(255, 210, 160, ${Math.max(0, p.a * (1 - k)).toFixed(3)})`;
        g.fillRect(p.x, p.y, 2, 2);
      }
      if (k < 1) requestAnimationFrame(step);
      else g.clearRect(0, 0, innerWidth, innerHeight);
    };
    requestAnimationFrame(step);
  }

  // ---------- the end ----------

  /** The end: the one pulse beating in the middle, the words drifting around it, the reader's own whole under it. */
  private finale(): void {
    const words = this.words.length + (this.myWords ? 1 : 0);
    this.endCount.textContent = words ? this.o.say('end-count', { w: words }) : '';
    if (!this.first.length || this.endRaf) return;
    const floating = this.words.slice(0, 14).map((w) => w.text);
    const t0 = performance.now();
    const draw = (now: number) => {
      if (!this.isOpen) return;
      const c = this.endCanvas;
      const dpr = Math.min(2, devicePixelRatio || 1);
      const W = c.clientWidth;
      const H = c.clientHeight;
      if (W && H) {
        if (c.width !== Math.round(W * dpr)) c.width = Math.round(W * dpr);
        if (c.height !== Math.round(H * dpr)) c.height = Math.round(H * dpr);
        const g = c.getContext('2d')!;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, W, H);
        const t = now - t0;
        const calm = this.o.calm();
        const cx = W / 2;
        const cy = H * 0.42;
        const R = Math.min(W, H) * 0.36;
        // A short fade-in, then the picture holds: one pulse, no gathering.
        const k = calm ? 1 : Math.min(1, t / 1600);
        const ease = 1 - (1 - k) ** 3;
        const v = waveAt(t, this.first);
        // One faint static halo around the middle, then the beating warmth and the bright core.
        g.strokeStyle = 'rgba(255, 214, 170, 0.12)';
        g.lineWidth = 1;
        g.beginPath();
        g.arc(cx, cy, 44 + R * 0.18, 0, Math.PI * 2);
        g.stroke();
        glow(g, cx, cy, 34 + v * 30, `rgba(255, 196, 132, ${(0.45 + 0.4 * v).toFixed(3)})`);
        glow(g, cx, cy, 12 + v * 8, `rgba(255, 238, 214, ${(0.6 + 0.35 * v).toFixed(3)})`);
        // The words drift slowly around the pulse; the reader's own stand under the middle, whole.
        g.textAlign = 'center';
        const font = getComputedStyle(this.el).fontFamily;
        if (this.myWords) {
          g.font = `20px ${font}`;
          g.fillStyle = `rgba(255, 236, 210, ${(0.95 * ease).toFixed(3)})`;
          wrapLines(g, this.myWords, W - 48).forEach((line, k2) => g.fillText(line, cx, cy + 74 + k2 * 26));
        }
        floating.forEach((w, i) => {
          const a = i * 1.7 + t / (calm ? 1e9 : 26000);
          const r = R * (1.05 + (i % 3) * 0.12);
          g.font = `15px ${font}`;
          const line = w.length > 40 ? w.slice(0, 38) + '…' : w;
          const half = g.measureText(line).width / 2 + 8;
          const x = Math.min(W - half, Math.max(half, cx + Math.cos(a) * r));
          const y = cy + Math.sin(a) * r * 0.62;
          g.fillStyle = `rgba(246, 232, 214, ${(0.32 * ease).toFixed(3)})`;
          g.fillText(line, x, y);
        });
      }
      this.endRaf = requestAnimationFrame(draw);
    };
    this.endRaf = requestAnimationFrame(draw);
  }

  dispose(): void {
    this.close();
    this.el.remove();
  }
}

function glow(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  if (r <= 0) return;
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, color);
  grad.addColorStop(1, 'rgba(255, 170, 92, 0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

/** Words broken into lines no wider than `max` (at most four). */
function wrapLines(g: CanvasRenderingContext2D, text: string, max: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (g.measureText(next).width > max && line) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out.slice(0, 4);
}

/** A word of the cloud: sizes and brightness vary, so it reads as a crowd of voices, not a list. */
function cloudWord(text: string, translation: string | undefined, wordLang: string | undefined, i: number): HTMLElement {
  const size = [1.25, 1, 0.9, 1.1, 0.85, 1.4, 0.95][i % 7];
  const tr = translation && translation !== text ? h('small', {}, translation) : null;
  return h('span.ap-cloud-word', { lang: wordLang || undefined, style: `--s:${size};--o:${(0.55 + ((i * 37) % 45) / 100).toFixed(2)}` }, text, tr);
}
