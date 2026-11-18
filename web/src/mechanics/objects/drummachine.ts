// A playable step sequencer: rows of voices, sixteen steps a bar, play/stop,
// tempo, bars for longer patterns. On a phone one voice is shown at a time,
// its steps as two rows of big buttons. Arrow keys move around the grid.
import { h } from '../../lib/dom';
import { pick } from '../../lib/i18n';
import { audioContext, claim, release } from '../../lib/sound';
import { clearPattern, patternLength, toggle, type Pattern } from './model';
import { Sequencer } from './sequencer';
import type { Voice } from './voices';

export interface VoiceInfo {
  key: string;
  short: string;
  name: { en: string; ru: string };
}

export interface DrumMachineOpts {
  id: string;
  kit: Record<string, Voice>;
  voices: VoiceInfo[];
  pattern: Pattern;
  bpm: number;
  label: { en: string; ru: string };
  /** What the preset is, said plainly next to the reset button. */
  presetName: { en: string; ru: string };
}

let made = 0;

export function drumMachine(o: DrumMachineOpts): HTMLElement {
  // Unique per instance: the same machine can sit on its card and on the shelf.
  const sid = `${o.id}-${++made}`;
  const preset = o.pattern;
  const seq = new Sequencer(o.kit, preset, o.bpm);
  const steps = patternLength(preset);
  const bars = steps / 16;
  let bar = 0;
  let voice = o.voices[0].key;
  let focusAt: [number, number] = [0, 0];

  const play = h('button.btn.primary.mx-play', { type: 'button', 'aria-pressed': 'false' });
  const paintPlay = () => {
    play.setAttribute('aria-pressed', String(seq.running));
    play.textContent = seq.running ? pick({ en: 'Stop', ru: 'Стоп' }) : pick({ en: 'Play', ru: 'Играть' });
  };
  const stop = () => {
    seq.stop();
    release(sid);
    paintPlay();
  };
  play.addEventListener('click', () => {
    if (seq.running) return stop();
    claim(sid, stop, root);
    seq.start(audioContext());
    paintPlay();
  });
  paintPlay();

  const tempoOut = h('output.mx-tempo-val', {}, String(o.bpm));
  const tempo = h('input', { type: 'range', min: '70', max: '180', step: '1', value: String(o.bpm), 'aria-label': pick({ en: 'Tempo, beats per minute', ru: 'Темп, ударов в минуту' }) }) as HTMLInputElement;
  tempo.addEventListener('input', () => {
    seq.bpm = Number(tempo.value);
    tempoOut.textContent = tempo.value;
  });

  const grid = h('div.mx-grid', { role: 'grid', 'aria-label': pick(o.label) });
  const barTabs = h('div.mx-bars', { role: 'group', 'aria-label': pick({ en: 'Bar', ru: 'Такт' }) });
  const voiceTabs = h('div.mx-voices', { role: 'group', 'aria-label': pick({ en: 'Voice', ru: 'Голос' }) });

  const cell = (v: string, i: number): HTMLButtonElement => grid.querySelector<HTMLButtonElement>(`[data-v="${v}"][data-i="${i}"]`)!;

  function render(): void {
    grid.replaceChildren(
      ...o.voices.map((vi, r) =>
        h(
          `div.mx-row${vi.key === voice ? '.sel' : ''}`,
          { role: 'row' },
          h(
            'button.mx-voice',
            {
              type: 'button',
              role: 'rowheader',
              title: pick(vi.name),
              'aria-label': pick({ en: `Play one ${vi.name.en.toLowerCase()} hit`, ru: `Один удар: ${vi.name.ru.toLowerCase()}` }),
              onclick: () => {
                claim(sid, stop, root);
                seq.hit(audioContext(), vi.key);
              },
            },
            h('b', {}, vi.short),
            h('span', {}, pick(vi.name)),
          ),
          h(
            'div.mx-steps',
            {},
            Array.from({ length: 16 }, (_, k) => {
              const i = bar * 16 + k;
              const on = !!seq.pattern[vi.key]?.[i];
              return h('button.mx-step', {
                type: 'button',
                role: 'gridcell',
                'data-v': vi.key,
                'data-i': String(i),
                'data-r': String(r),
                'data-k': String(k),
                'aria-pressed': String(on),
                'aria-label': pick({ en: `${vi.name.en}, step ${k + 1}${bars > 1 ? `, bar ${bar + 1}` : ''}`, ru: `${vi.name.ru}, шаг ${k + 1}${bars > 1 ? `, такт ${bar + 1}` : ''}` }),
                tabindex: r === focusAt[0] && k === focusAt[1] ? '0' : '-1',
                class: k % 4 === 0 ? 'beat' : undefined,
              });
            }),
          ),
        ),
      ),
    );
    barTabs.replaceChildren(
      ...Array.from({ length: bars }, (_, b) =>
        h('button.mx-tab', { type: 'button', 'aria-pressed': String(b === bar), onclick: () => ((bar = b), render()) }, pick({ en: `Bar ${b + 1}`, ru: `Такт ${b + 1}` })),
      ),
    );
    voiceTabs.replaceChildren(
      ...o.voices.map((vi) => h('button.mx-tab', { type: 'button', 'aria-pressed': String(vi.key === voice), onclick: () => ((voice = vi.key), render()) }, vi.short)),
    );
  }

  grid.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('.mx-step');
    if (!b) return;
    const v = b.dataset.v!;
    const i = Number(b.dataset.i);
    seq.pattern = toggle(seq.pattern, v, i);
    b.setAttribute('aria-pressed', String(!!seq.pattern[v][i]));
  });
  grid.addEventListener('keydown', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('.mx-step');
    if (!b) return;
    const d: Record<string, [number, number]> = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
    const mv = d[e.key];
    if (!mv) return;
    e.preventDefault();
    const visible = [...grid.querySelectorAll<HTMLElement>('.mx-row')].filter((r) => r.offsetParent !== null).map((r) => o.voices.findIndex((v) => v.key === r.querySelector<HTMLElement>('.mx-step')?.dataset.v));
    let r = Number(b.dataset.r);
    const k = (Number(b.dataset.k) + mv[1] + 16) % 16;
    if (mv[0]) r = visible[(visible.indexOf(r) + mv[0] + visible.length) % visible.length] ?? r;
    focusAt = [r, k];
    grid.querySelectorAll('.mx-step').forEach((x) => x.setAttribute('tabindex', '-1'));
    const next = grid.querySelector<HTMLButtonElement>(`.mx-step[data-r="${r}"][data-k="${k}"]`);
    next?.setAttribute('tabindex', '0');
    next?.focus();
  });

  seq.onStep = (s) => {
    grid.querySelectorAll('.mx-step.now').forEach((x) => x.classList.remove('now'));
    if (s < 0) return;
    // Follow the playhead into the next bar.
    if (bars > 1 && Math.floor(s / 16) !== bar) {
      bar = Math.floor(s / 16);
      render();
    }
    for (const v of o.voices) cell(v.key, s)?.classList.add('now');
  };

  const reset = h('button.btn', { type: 'button', onclick: () => ((seq.pattern = preset), render()) }, pick({ en: 'Reset', ru: 'Сбросить' }));
  const clear = h('button.btn', { type: 'button', onclick: () => ((seq.pattern = clearPattern(seq.pattern)), render()) }, pick({ en: 'Clear', ru: 'Очистить' }));
  render();

  const root = h(
    'div.mx-machine',
    { 'data-object': o.id },
    h('div.mx-controls', {}, play, h('label.mx-tempo', {}, h('span', {}, pick({ en: 'Tempo', ru: 'Темп' })), tempo, tempoOut), reset, clear),
    bars > 1 ? barTabs : null,
    voiceTabs,
    grid,
    h('p.mx-preset', {}, pick(o.presetName)),
  );
  return root;
}
