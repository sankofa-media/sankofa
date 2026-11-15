// The "Rashomon" lenses: a switcher in every chapter that has witnesses.
// Choosing one restyles the whole scene as that person sees it (the
// engineer's console, the guitarist's photo album, the label's ledger…) and
// brings his account forward. Where the witnesses contradict each other
// (`differ`), every version stays on the page side by side and none is
// marked right; elsewhere the chosen witness's account is shown alone.
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
  const differ = sc.differ === true;
  const lensBlocks = sc.blocks.filter((b) => b.lens);
  const voice = (l: Lens) => {
    const own = lensBlocks.filter((b) => b.lens === l.id);
    return h(
      'article.fc-voice',
      { 'data-voice': l.id, ...(l.empty ? { 'data-empty': '' } : {}) },
      h('header.fc-voice-who', {}, h('b', {}, pick(l.name)), l.role ? h('span', {}, pick(l.role)) : null),
      ...(l.empty ? [h('p.fc-voice-silence', {}, l.silence ? pick(l.silence) : '')] : own.map((b) => kit.block(b))),
    );
  };
  const voices = ids.map((id) => voice(all.get(id)!));
  const buttons = ids.map((id) => {
    const l = all.get(id)!;
    const b = h(`button.fc-lens-btn`, { type: 'button', 'data-lens': id, 'aria-pressed': 'false', ...(l.empty ? { 'data-empty': '' } : {}) }, pick(l.name)) as HTMLButtonElement;
    b.addEventListener('click', () => choose(id));
    return b;
  });
  const el = h(
    `div.fc-lens${differ ? '.differ' : ''}`,
    { 'data-lenses': ids.join(' ') },
    h('p.fc-lens-label', { id: `lens-${sc.id}` }, kit.ui('lens-label')),
    h('div.fc-lens-btns', { role: 'group', 'aria-labelledby': `lens-${sc.id}` }, ...buttons),
    h('div.fc-voices', {}, ...voices),
    differ ? h('p.fc-lens-hint', {}, kit.ui('lens-hint')) : null,
  );
  const choose = (id: string) => {
    el.dataset.lens = id;
    section()?.setAttribute('data-lens', id);
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.lens === id));
    for (const v of voices) {
      const on = v.dataset.voice === id;
      v.classList.toggle('is-on', on);
      // Where they differ, every version stays; elsewhere one witness speaks.
      v.hidden = !differ && !on;
      v.querySelectorAll('.ft-block').forEach((b) => b.classList.add('on'));
    }
  };
  choose(ids.find((id) => !all.get(id)!.empty) ?? ids[0]);
  return { el, blocks: lensBlocks.map((b) => b.id), choose };
}
