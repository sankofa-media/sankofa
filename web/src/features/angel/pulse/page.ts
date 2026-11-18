// The pulse page, made for a phone: a finger or a palm on the screen feels
// a living pulse (the first one left in the chorus; whose it is is never
// said), sees who else is touching a screen right now, the other pulses
// beating around it, and one stranger's word on every beat; then may say
// what was never said, by voice or in writing, and leave a pulse of its own
// through the camera. It ends with one line. If the Angel service cannot be
// reached, the page explains nothing and shows only that line.
import { h } from '../../../lib/dom';
import { lang } from '../../../lib/i18n';
import { isPhone } from '../../engine/qr';
import * as api from '../api';
import { closeCamera, FrameReader, openBackCamera, type Camera } from './camera';
import { analyse, checkRR, type Sample } from './ppg';
import { beatsBetween, lubDub, vibrationPattern, waveAt } from './wave';

export interface PulsePageOptions {
  host: HTMLElement;
  /** The feature's labels, with {vars}. */
  say(key: string, vars?: Record<string, string | number>): string;
  /** The engine's labels (close). */
  engine(key: string): string;
  calm(): boolean;
}

/** How long the camera reads a pulse, seconds (the server takes 20 to 120 beats). */
export const RECORD_SECONDS = 40;
const WORDS_MAX = 280;
const VOICE_MAX = 30;
const PRINT_MS = 12_000;
const PALM_PX = 38;

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
  private vibOff: HTMLElement;
  private sayEl: HTMLElement;
  private ownEl: HTMLElement;
  private particles: HTMLCanvasElement;
  private raf = 0;
  private t0 = 0;
  private lastT = 0;
  private first: number[] = [];
  private chorus: number[][] = [];
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
  private vibNoted = false;
  private haptic: HTMLLabelElement | null = null;
  private returnFocus: Element | null = null;
  private timers: number[] = [];
  private camera: Camera | null = null;
  private reader: FrameReader | null = null;

  constructor(private readonly o: PulsePageOptions) {
    const say = o.say;
    this.canvas = h('canvas.ap-canvas', { 'aria-hidden': 'true' }) as HTMLCanvasElement;
    this.floatBox = h('div.ap-float', { 'aria-hidden': 'true' });
    this.othersLine = h('p.ap-others', { 'aria-live': 'polite' });
    this.vibOff = h('p.ap-note.ap-vib-off', { hidden: true }, say('pulse-vibration-off'));
    const further = h('button.ap-further', { type: 'button', 'aria-label': say('pulse-further') }, h('span', { 'aria-hidden': 'true' }, '↓'));
    further.addEventListener('click', () => this.sayEl.scrollIntoView({ behavior: o.calm() ? 'auto' : 'smooth' }));
    this.touchSec = h('section.ap-sec.ap-touch', { 'aria-label': say('pulse-touch') }, this.canvas, h('p.ap-touch-line', {}, say('pulse-touch')), this.floatBox, h('div.ap-touch-foot', {}, this.othersLine, this.vibOff, further));
    this.sayEl = this.buildWords();
    this.ownEl = this.buildOwn();
    const last = h('section.ap-sec.ap-last', {}, h('p.ap-last-line', {}, say('last')));
    this.scroll = h('div.ap-scroll', {}, this.touchSec, this.sayEl, this.ownEl, last);
    const close = h('button.icon-btn.ap-close', { type: 'button', 'aria-label': o.engine('close') }, '×');
    close.addEventListener('click', () => this.close());
    this.particles = h('canvas.ap-particles', { 'aria-hidden': 'true' }) as HTMLCanvasElement;
    this.el = h('div.an-pulse', { role: 'dialog', 'aria-modal': 'true', 'aria-label': say('invite'), hidden: true, 'data-state': 'loading', tabindex: '-1' }, this.scroll, this.particles, close);
    this.el.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      this.close();
    });
    this.wireTouch();
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

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.returnFocus = document.activeElement;
    this.el.hidden = false;
    document.body.classList.add('an-pulse-on');
    this.el.focus({ preventScroll: true });
    this.scroll.scrollTop = 0;
    void this.load();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.hidden = true;
    document.body.classList.remove('an-pulse-on');
    this.lift(true);
    this.stopPresence?.();
    this.stopPresence = null;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.stopCamera();
    if (this.returnFocus instanceof HTMLElement && this.returnFocus.isConnected) this.returnFocus.focus({ preventScroll: true });
  }

  private async load(): Promise<void> {
    const ps = await api.pulses();
    if (!this.isOpen) return;
    if (!ps) {
      // No service: nothing to explain, only the last line.
      this.el.dataset.state = 'offline';
      return;
    }
    this.chorus = ps.others.map((p) => p.rr);
    if (!ps.first) {
      // The chorus is empty: no pulse to feel yet, but words and a first pulse can be left.
      this.el.dataset.state = 'empty';
      return;
    }
    this.first = ps.first.rr;
    this.el.dataset.state = 'full';
    this.t0 = performance.now();
    this.lastT = 0;
    this.stopPresence = api.presence((p) => (this.others = p));
    void api.words(lang()).then((w) => (this.words = w.sort(() => Math.random() - 0.5)));
    this.raf = requestAnimationFrame((t) => this.frame(t));
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
    if (!this.vibNoted && isPhone() && !canVibrate() && !this.haptic) {
      this.vibNoted = true;
      this.vibOff.hidden = false;
    }
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

  /** One beat of the first pulse: felt, seen, and a word surfaces near the hand. */
  private beat(rr: number, touching: boolean): void {
    this.beatGlow = 1;
    if (!touching) return;
    if (canVibrate()) buzz(lubDub(rr));
    else if (this.haptic) this.haptic.click();
    this.surfaceWord();
  }

  private surfaceWord(): void {
    if (!this.words.length || !this.centre || this.floatBox.childElementCount >= 4) return;
    const w = this.words[this.wordAt++ % this.words.length];
    const a = Math.random() * Math.PI * 2;
    const d = this.centre.r + 40 + Math.random() * 60;
    const r = this.touchSec.getBoundingClientRect();
    const x = Math.min(r.width - 40, Math.max(40, this.centre.x + Math.cos(a) * d));
    const y = Math.min(r.height - 60, Math.max(60, this.centre.y + Math.sin(a) * d));
    const tr = w.translation && w.translation !== w.text ? h('small', {}, w.translation) : null;
    const span = h('span.ap-word', { lang: w.lang || undefined, style: `left:${x.toFixed(0)}px;top:${y.toFixed(0)}px` }, w.text, tr);
    span.addEventListener('animationend', () => span.remove());
    this.floatBox.append(span);
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

    // The chorus: every other pulse left here, beating its own rhythm, further out and fainter.
    const maxR = Math.min(W, H) * 0.46;
    this.chorus.forEach((rr, i) => {
      const ring = Math.min(maxR, 120 + i * 22);
      const a = i * 2.399963;
      const x = centre.x + Math.cos(a) * ring;
      const y = centre.y + Math.sin(a) * ring;
      if (x < -10 || y < -10 || x > W + 10 || y > H + 10) return;
      const v = waveAt(t + i * 337, rr);
      const alpha = Math.max(0.14, 0.55 - i * 0.02);
      glow(g, x, y, 10 + v * 10, `rgba(255, 196, 140, ${(alpha * (0.4 + 0.6 * v)).toFixed(3)})`);
    });

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
    const checked = h('p.ap-note.ap-checked', {}, say('words-checked'));
    const release = h('button.btn.primary.ap-release', { type: 'button' }, say('words-release')) as HTMLButtonElement;
    const keep = h('button.btn.ap-keep', { type: 'button' }, say('words-keep')) as HTMLButtonElement;
    const said = h('div.ap-said', { 'aria-live': 'polite' });
    if (wasChecked()) checked.hidden = true;
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

    const done = (msg: HTMLElement[]) => said.replaceChildren(...msg);
    release.addEventListener('click', async () => {
      const words = text.value.trim();
      if (!words && !audio) {
        text.focus();
        return;
      }
      release.disabled = keep.disabled = true;
      this.dissolve(text);
      const code = await api.sendWords({ text: words, lang: lang(), audio, keepVoice: keepVoice.checked });
      release.disabled = keep.disabled = false;
      if (!code) {
        // Nothing on screen goes wrong: the words come back to the field.
        text.value = words;
        text.classList.remove('ap-gone');
        return;
      }
      markChecked();
      checked.hidden = true;
      text.value = '';
      text.classList.remove('ap-gone');
      audio = null;
      keepRow.hidden = true;
      clock.textContent = '';
      done([h('p.ap-said-line', {}, say('words-sent')), h('p.ap-note.ap-code', {}, say('words-delete', { code }))]);
      this.watchWords(code, said);
    });
    keep.addEventListener('click', () => {
      if (!text.value.trim() && !audio) return;
      this.dissolve(text);
      window.setTimeout(() => {
        text.value = '';
        text.classList.remove('ap-gone');
      }, this.o.calm() ? 0 : 1600);
      audio = null;
      keepRow.hidden = true;
      clock.textContent = '';
      done([h('p.ap-said-line', {}, say('words-kept'))]);
    });

    return h(
      'section.ap-sec.ap-say',
      {},
      h('p.ap-lead', {}, say('words-invite')),
      text,
      h('div.ap-row', {}, voiceBtn, clock),
      keepRow,
      checked,
      h('div.ap-row', {}, release, keep),
      said,
    );
  }

  /** Words went for checking: if they show someone in danger, say so gently (the pulse keeps beating). */
  private watchWords(code: string, said: HTMLElement): void {
    let tries = 0;
    const poll = window.setInterval(async () => {
      if (++tries > 24 || !this.isOpen) return clearInterval(poll);
      const st = await api.wordsStatus(code);
      if (st === 'crisis') {
        clearInterval(poll);
        const msg = this.o.say('words-crisis');
        const parts = msg.split('findahelpline.com');
        said.append(h('p.ap-crisis', { role: 'status' }, parts[0], parts.length > 1 ? h('a', { href: 'https://findahelpline.com', target: '_blank', rel: 'noopener noreferrer' }, 'findahelpline.com') : null, parts[1] ?? ''));
      } else if (st && st !== 'pending') clearInterval(poll);
    }, 5000);
    this.timers.push(poll);
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

  // ---------- a pulse of one's own ----------

  private buildOwn(): HTMLElement {
    const say = this.o.say;
    const start = h('button.btn.primary.ap-own-start', { type: 'button' }, say('own-pulse-start')) as HTMLButtonElement;
    const light = h('p.ap-note.ap-light', { hidden: true }, say('own-pulse-light'));
    const wave = h('canvas.ap-own-wave', { 'aria-hidden': 'true', hidden: true }) as HTMLCanvasElement;
    const beats = h('p.ap-beats', { 'aria-live': 'polite' });
    const failed = h('p.ap-note.ap-failed', { hidden: true }, say('own-pulse-failed'));
    const feel = h('button.btn.ap-feel', { type: 'button' }, say('own-pulse-feel')) as HTMLButtonElement;
    const again = h('button.btn.ap-again', { type: 'button' }, say('own-pulse-again')) as HTMLButtonElement;
    const consent = h('input', { type: 'checkbox' }) as HTMLInputElement;
    const send = h('button.btn.primary.ap-send', { type: 'button', disabled: true }, say('own-pulse-send')) as HTMLButtonElement;
    const result = h('div.ap-own-result', { hidden: true }, h('div.ap-row', {}, feel, again), h('label.ap-check', {}, consent, h('span', {}, say('own-pulse-consent'))), h('div.ap-row', {}, send));
    const sent = h('div.ap-said', { 'aria-live': 'polite' });
    const retry = h('button.btn.ap-again', { type: 'button', hidden: true }, say('own-pulse-again')) as HTMLButtonElement;
    let rr: number[] = [];

    const reset = () => {
      this.stopCamera();
      rr = [];
      start.hidden = false;
      start.disabled = false;
      light.hidden = failed.hidden = retry.hidden = result.hidden = true;
      wave.hidden = true;
      beats.textContent = '';
      consent.checked = false;
      send.disabled = true;
      sent.replaceChildren();
    };
    const fail = () => {
      this.stopCamera();
      start.hidden = true;
      failed.hidden = false;
      retry.hidden = false;
    };
    retry.addEventListener('click', reset);
    again.addEventListener('click', reset);
    consent.addEventListener('change', () => (send.disabled = !consent.checked));

    start.addEventListener('click', async () => {
      start.disabled = true;
      let cam: Camera;
      try {
        cam = await openBackCamera();
      } catch {
        start.disabled = false;
        return fail();
      }
      this.camera = cam;
      light.hidden = cam.torch;
      start.hidden = true;
      wave.hidden = false;
      const video = h('video', { muted: true, playsinline: true, autoplay: true }) as HTMLVideoElement;
      video.muted = true;
      video.srcObject = cam.stream;
      try {
        await video.play();
      } catch {
        return fail();
      }
      const samples: Sample[] = [];
      let t0 = -1;
      let tick = 0;
      this.reader = new FrameReader(video, (s) => {
        if (t0 < 0) t0 = s.t;
        samples.push(s);
        if (s.t - t0 >= RECORD_SECONDS) finish();
      });
      const show = () => {
        if (samples.length < 60) return;
        const a = analyse(samples);
        beats.textContent = say('own-pulse-beats', { n: a.beats.length });
        drawWave(wave, a.wave, a.hz);
      };
      tick = window.setInterval(show, 500);
      this.timers.push(tick);
      const finish = () => {
        clearInterval(tick);
        // The camera stops the moment the reading is done; nothing of the picture is kept.
        this.stopCamera();
        const a = analyse(samples);
        beats.textContent = say('own-pulse-beats', { n: a.beats.length });
        drawWave(wave, a.wave, a.hz);
        if (checkRR(a.rr)) return fail();
        rr = a.rr;
        result.hidden = false;
      };
      this.reader.start();
    });

    feel.addEventListener('click', () => {
      if (!rr.length) return;
      if (canVibrate()) buzz(vibrationPattern(rr.slice(0, 40)));
      // And in the light, beat by beat.
      let at = 0;
      for (const v of rr.slice(0, 40)) {
        const id = window.setTimeout(() => {
          wave.classList.remove('ap-flash');
          void wave.offsetWidth;
          wave.classList.add('ap-flash');
        }, at);
        this.timers.push(id);
        at += v;
      }
    });

    send.addEventListener('click', async () => {
      if (!consent.checked || !rr.length) return;
      send.disabled = true;
      const code = await api.sendPulse(rr);
      if (!code) {
        send.disabled = false;
        return;
      }
      api.forgetPulses();
      result.hidden = true;
      sent.replaceChildren(h('p.ap-said-line', {}, say('own-pulse-sent')), h('p.ap-note.ap-code', {}, say('own-pulse-delete', { code })));
    });

    return h('section.ap-sec.ap-own', {}, h('p.ap-lead', {}, say('own-pulse')), h('p.ap-note', {}, say('own-pulse-how')), start, light, wave, beats, failed, retry, result, sent);
  }

  private stopCamera(): void {
    this.reader?.stop();
    this.reader = null;
    closeCamera(this.camera);
    this.camera = null;
  }

  dispose(): void {
    this.close();
    this.timers.forEach((t) => clearInterval(t));
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

/** The last six seconds of the camera's pulse wave. */
function drawWave(c: HTMLCanvasElement, wave: Float64Array, hz: number): void {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W = c.clientWidth || 300;
  const H = c.clientHeight || 90;
  c.width = W * dpr;
  c.height = H * dpr;
  const g = c.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const n = Math.min(wave.length, Math.round(6 * hz));
  const seg = wave.subarray(wave.length - n);
  let m = 0.001;
  for (const v of seg) m = Math.max(m, Math.abs(v));
  g.strokeStyle = 'rgba(255, 220, 180, 0.95)';
  g.lineWidth = 1.6;
  g.beginPath();
  seg.forEach((v, i) => {
    const x = (i / Math.max(1, n - 1)) * W;
    const y = H / 2 - (v / m) * (H * 0.4);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  });
  g.stroke();
}

function wasChecked(): boolean {
  try {
    return localStorage.getItem('sankofa.angel.words-checked') === '1';
  } catch {
    return false;
  }
}

function markChecked(): void {
  try {
    localStorage.setItem('sankofa.angel.words-checked', '1');
  } catch {
    /* private window: it shows again next time */
  }
}
