// Drum pads: one synthesized hit per touch, click or key. Big targets for
// fingers; keys 1–4 play them while the pads have focus.
import { h } from '../../lib/dom';
import { pick } from '../../lib/i18n';
import { audioContext, claim } from './bus';
import type { Voice } from './voices';

export interface Pad {
  key: string;
  name: { en: string; ru: string };
}

export function pads(id: string, kit: Record<string, Voice>, list: Pad[]): HTMLElement {
  const hit = (key: string, el: HTMLElement) => {
    claim(id, () => undefined);
    const ctx = audioContext();
    const g = ctx.createGain();
    g.gain.value = 0.85;
    g.connect(ctx.destination);
    kit[key]?.(ctx, g, ctx.currentTime + 0.003);
    window.setTimeout(() => g.disconnect(), 2000);
    el.classList.remove('hit');
    void el.offsetWidth;
    el.classList.add('hit');
  };
  const wrap = h('div.mx-pads', { role: 'group', 'aria-label': pick({ en: 'Drum pads', ru: 'Пэды' }) });
  list.forEach((p, i) => {
    let byPointer = false;
    const b = h('button.mx-pad', { type: 'button', 'data-pad': p.key }, h('b', {}, pick(p.name)), h('kbd', { 'aria-hidden': 'true' }, String(i + 1)));
    b.addEventListener('pointerdown', (e) => {
      byPointer = true;
      e.preventDefault();
      b.focus({ preventScroll: true });
      hit(p.key, b);
    });
    // Keyboard and assistive technology arrive as a click without a pointer.
    b.addEventListener('click', () => {
      if (!byPointer) hit(p.key, b);
      byPointer = false;
    });
    wrap.append(b);
  });
  wrap.addEventListener('keydown', (e) => {
    const n = Number(e.key);
    if (n >= 1 && n <= list.length && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      hit(list[n - 1].key, wrap.children[n - 1] as HTMLElement);
    }
  });
  return wrap;
}
