// The "Rashomon" lenses: a switcher in every chapter that has witnesses.
// Choosing one restyles the whole scene as that person sees it (the
// engineer's console, the guitarist's photo album, the label's ledger…) and
// shows his account, one witness at a time: the switch crossfades from one
// voice to the next, so no two accounts hang on the page at once and none
// is marked right. The first witness listed speaks first. The switcher is a
// radio group: arrow keys move between witnesses, and only the chosen one
// is in the tab order.
import { h } from '../../lib/dom';
import { pick } from '../../lib/i18n';
import type { Kit } from '../engine/kit';
import type { Lens, Scene } from '../model';

export interface LensPane {
  el: HTMLElement;
  /** Block ids the pane shows (left out of the scene's flow). */
  blocks: string[];
  choose(id: string): void;
}

export function lensPane(kit: Kit, sc: Scene, section: () => HTMLElement | null): LensPane | null {
  const all = new Map((kit.ctx.data.lenses ?? []).map((l) => [l.id, l]));
  const ids = ((sc.lenses as string[] | undefined) ?? []).filter((id) => all.has(id));
  if (!ids.length) return null;
  const lensBlocks = sc.blocks.filter((b) => b.lens);
  const voice = (l: Lens) => {
    const own = lensBlocks.filter((b) => b.lens === l.id);
    return h(
      'article.fc-voice',
      { 'data-voice': l.id, id: `voice-${sc.id}-${l.id}`, ...(l.empty ? { 'data-empty': '' } : {}) },
      h('header.fc-voice-who', {}, h('b', {}, pick(l.name)), l.role ? h('span', {}, pick(l.role)) : null),
      ...(l.empty ? [h('p.fc-voice-silence', {}, l.silence ? pick(l.silence) : '')] : own.map((b) => kit.block(b))),
    );
  };
  const voices = ids.map((id) => voice(all.get(id)!));
  const buttons = ids.map((id) => {
    const l = all.get(id)!;
    const b = h(
      'button.fc-lens-btn',
      { type: 'button', role: 'radio', 'data-lens': id, 'aria-checked': 'false', 'aria-controls': `voice-${sc.id}-${id}`, tabindex: '-1', ...(l.empty ? { 'data-empty': '' } : {}) },
      pick(l.name),
    ) as HTMLButtonElement;
    b.addEventListener('click', () => choose(id));
    return b;
  });
  const group = h('div.fc-lens-btns', { role: 'radiogroup', 'aria-labelledby': `lens-${sc.id}` }, ...buttons);
  group.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: -Infinity, End: Infinity }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const at = buttons.findIndex((b) => b.getAttribute('aria-checked') === 'true');
    const next = step === -Infinity ? 0 : step === Infinity ? buttons.length - 1 : (at + step + buttons.length) % buttons.length;
    choose(ids[next]);
    buttons[next].focus();
  });
  const el = h(
    'div.fc-lens',
    { 'data-lenses': ids.join(' ') },
    h('p.fc-lens-label.ft-visually-hidden', { id: `lens-${sc.id}` }, kit.ui('lens-label')),
    group,
    h('div.fc-voices', { 'aria-live': 'polite' }, ...voices),
  );
  const choose = (id: string) => {
    el.dataset.lens = id;
    section()?.setAttribute('data-lens', id);
    for (const b of buttons) {
      const on = b.dataset.lens === id;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    for (const v of voices) {
      const on = v.dataset.voice === id;
      // One witness speaks; the others fade out and leave the reading order.
      v.classList.toggle('is-on', on);
      v.toggleAttribute('inert', !on);
      v.setAttribute('aria-hidden', String(!on));
      v.querySelectorAll('.ft-block').forEach((b) => b.classList.add('on'));
    }
  };
  choose(ids[0]);
  return { el, blocks: lensBlocks.map((b) => b.id), choose };
}
