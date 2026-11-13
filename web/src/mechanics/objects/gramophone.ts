// A turntable for a 78: the card's own public-domain recording. Drop the
// needle anywhere on the record (the outer groove is the start), drag the arm,
// or use the slider; the record turns while it plays.
import { h, reducedMotion } from '../../lib/dom';
import { pick } from '../../lib/i18n';
import { adopt, claim, release } from '../../lib/sound';
import { formatTime, GROOVE, radiusAtTime, timeAtRadius } from './model';

const NS = 'http://www.w3.org/2000/svg';
const s = (tag: string, attrs: Record<string, string | number>, ...kids: SVGElement[]): SVGElement => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  el.append(...kids);
  return el;
};

// Geometry, in SVG units.
const C = { x: 170, y: 165 };
const R = 140;
const P = { x: 372, y: 52 };
const L = 214;
const D = Math.hypot(C.x - P.x, C.y - P.y);
const TOWARD = Math.atan2(C.y - P.y, C.x - P.x);
const REST = R + 26;

/** The arm's angle (radians) for the needle at distance `r` from the spindle. */
function armAngle(r: number): number {
  const cos = (D * D + L * L - r * r) / (2 * D * L);
  return TOWARD - Math.acos(Math.max(-1, Math.min(1, cos)));
}

export interface GramophoneOpts {
  src: string;
  title: string;
  artist: string;
  year: string;
  rpm: number;
}

let made = 0;

export function gramophone(o: GramophoneOpts): HTMLElement {
  const id = `gramophone-${++made}`;
  const audio = new Audio();
  audio.preload = 'none';
  adopt(audio);
  let duration = 0;
  let dragging = false;
  let angle = 0;
  let last = 0;
  let raf = 0;

  const grooves = Array.from({ length: 34 }, (_, i) => s('circle', { cx: C.x, cy: C.y, r: R * (GROOVE.inner + ((GROOVE.outer - GROOVE.inner) * i) / 33), class: 'g-groove' }));
  const label = s(
    'g',
    {},
    s('circle', { cx: C.x, cy: C.y, r: R * 0.34, class: 'g-label' }),
    s('text', { x: C.x, y: C.y - 16, class: 'g-l1', 'text-anchor': 'middle' }),
    s('text', { x: C.x, y: C.y + 20, class: 'g-l2', 'text-anchor': 'middle' }),
    s('text', { x: C.x, y: C.y + 30, class: 'g-l2', 'text-anchor': 'middle' }),
    s('text', { x: C.x, y: C.y + 42, class: 'g-l3', 'text-anchor': 'middle' }),
    s('circle', { cx: C.x, cy: C.y, r: 3.2, class: 'g-spindle' }),
  );
  const [t1, t2a, t2b, t3] = [...label.querySelectorAll('text')];
  t1.textContent = o.title.toUpperCase();
  // The artist on two lines, split at the word nearest the middle.
  const words = o.artist.split(' ');
  const cut = Math.max(1, Math.round(words.length / 2) - 1);
  t2a.textContent = words.slice(0, cut).join(' ');
  t2b.textContent = words.slice(cut).join(' ');
  t3.textContent = o.year;
  const disc = s('g', { class: 'g-disc' }, s('circle', { cx: C.x, cy: C.y, r: R, class: 'g-vinyl' }), ...grooves, label);
  const arm = s(
    'g',
    { class: 'g-arm' },
    s('line', { x1: P.x, y1: P.y, x2: P.x + L, y2: P.y, class: 'g-tube' }),
    s('rect', { x: P.x + L - 8, y: P.y - 7, width: 22, height: 14, rx: 3, class: 'g-head' }),
    s('circle', { cx: P.x, cy: P.y, r: 15, class: 'g-pivot' }),
    s('circle', { cx: P.x, cy: P.y, r: 6, class: 'g-pivot-cap' }),
  );
  const svg = s(
    'svg',
    { viewBox: '0 0 420 330', class: 'g-svg', 'aria-hidden': 'true' },
    s('rect', { x: 4, y: 4, width: 412, height: 322, rx: 16, class: 'g-plinth' }),
    s('circle', { cx: C.x, cy: C.y, r: R + 8, class: 'g-platter' }),
    disc,
    arm,
  );

  const setArm = (r: number) => arm.setAttribute('transform', `rotate(${(armAngle(r) * 180) / Math.PI} ${P.x} ${P.y})`);
  setArm(REST);

  const time = h('span.g-time', {}, '0:00');
  const slider = h('input.g-slider', { type: 'range', min: '0', max: '210', step: '1', value: '0', 'aria-label': pick({ en: 'Needle position', ru: 'Положение иглы' }) }) as HTMLInputElement;
  const btn = h('button.btn.primary', { type: 'button', 'aria-pressed': 'false' });

  const paint = () => {
    const on = !audio.paused;
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? pick({ en: 'Lift the needle', ru: 'Поднять иглу' }) : pick({ en: 'Lower the needle', ru: 'Опустить иглу' });
    wrap.classList.toggle('playing', on);
    if (!dragging) setArm(on || audio.currentTime > 0 ? radiusAtTime(audio.currentTime, duration || 210) * R : REST);
    time.textContent = duration ? `${formatTime(audio.currentTime)} / ${formatTime(duration)}` : formatTime(audio.currentTime);
    if (!dragging) slider.value = String(Math.floor(audio.currentTime));
  };

  const spin = (now: number) => {
    const dt = last ? (now - last) / 1000 : 0;
    last = now;
    if (!reducedMotion()) {
      angle = (angle + dt * (o.rpm / 60) * 360) % 360;
      disc.setAttribute('transform', `rotate(${angle} ${C.x} ${C.y})`);
    }
    paint();
    raf = audio.paused ? 0 : requestAnimationFrame(spin);
  };

  const stop = () => {
    audio.pause();
    release(id);
    paint();
  };
  const ensureSrc = () => {
    if (!audio.src) {
      audio.src = o.src;
      audio.preload = 'auto';
    }
  };
  const playAt = (t?: number) => {
    ensureSrc();
    claim(id, stop, wrap);
    if (t !== undefined) {
      const seek = () => (audio.currentTime = Math.min(t, Math.max(0, (audio.duration || t + 1) - 0.5)));
      if (audio.readyState >= 1) seek();
      else audio.addEventListener('loadedmetadata', seek, { once: true });
    }
    void audio.play().catch(() => paint());
  };
  audio.addEventListener('loadedmetadata', () => {
    duration = audio.duration || 0;
    slider.max = String(Math.floor(duration));
    paint();
  });
  audio.addEventListener('play', () => {
    last = 0;
    if (!raf) raf = requestAnimationFrame(spin);
    paint();
  });
  audio.addEventListener('pause', () => paint());
  audio.addEventListener('ended', () => {
    audio.currentTime = 0;
    stop();
  });

  btn.addEventListener('click', () => (audio.paused ? playAt() : stop()));
  slider.addEventListener('input', () => {
    if (duration) setArm(radiusAtTime(Number(slider.value), duration) * R);
  });
  slider.addEventListener('change', () => playAt(Number(slider.value)));

  // Drop or drag the needle on the record.
  const local = (e: PointerEvent) => {
    const pt = svg.getBoundingClientRect();
    const x = ((e.clientX - pt.left) / pt.width) * 420;
    const y = ((e.clientY - pt.top) / pt.height) * 330;
    return Math.hypot(x - C.x, y - C.y) / R;
  };
  svg.addEventListener('pointerdown', (e) => {
    const r = local(e);
    if (r > 1.02 && !(e.target as Element).closest('.g-arm')) return;
    dragging = true;
    svg.setPointerCapture(e.pointerId);
    setArm(Math.min(GROOVE.outer, Math.max(GROOVE.inner, r)) * R);
  });
  svg.addEventListener('pointermove', (e) => {
    if (dragging) setArm(Math.min(GROOVE.outer, Math.max(GROOVE.inner, local(e))) * R);
  });
  svg.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    const r = Math.min(GROOVE.outer, Math.max(GROOVE.inner, local(e)));
    playAt(timeAtRadius(r, duration || 210));
  });
  svg.addEventListener('pointercancel', () => {
    dragging = false;
    paint();
  });

  const wrap = h(
    'div.mx-gramophone',
    { 'data-object': 'gramophone' },
    h('div.g-deck', { title: pick({ en: 'Drop the needle anywhere on the record', ru: 'Опустите иглу в любом месте пластинки' }) }, svg as unknown as HTMLElement),
    h('div.g-controls', {}, btn, h('label.g-pos', {}, h('span.mx-sr', {}, pick({ en: 'Needle position', ru: 'Положение иглы' })), slider), time),
    h('p.mx-hint', {}, pick({ en: 'Press on the record to drop the needle there: the outer groove is the beginning.', ru: 'Нажмите на пластинку, чтобы опустить туда иглу: внешняя бороздка — начало записи.' })),
  );
  paint();
  return wrap;
}
