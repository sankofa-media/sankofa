// Call and response, to play both ways. Lead: pick a call and the group
// answers on the beat. Answer: the leader calls, and the group's refrain
// sounds when you press "Answer"; the page says whether it came in on time.
// The calls and the refrain are short phrases written for this museum, sung
// by synthesized voices; they are not any song's melody.
import { h } from '../../lib/dom';
import { pick } from '../../lib/i18n';
import { audioContext, claim, release } from '../../lib/sound';
import { answerTiming } from './model';
import { sing } from './voices';

const BEAT = 60 / 88;
/** Three calls: [pitch in Hz, length in beats] each. */
const CALLS: [number, number][][] = [
  [[294, 0.5], [330, 0.5], [392, 1], [330, 1]],
  [[392, 0.5], [392, 0.5], [440, 0.5], [392, 0.5], [330, 1]],
  [[440, 1], [392, 0.5], [330, 0.5], [294, 1]],
];
/** The refrain the group sings back, as three voices in parallel. */
const ANSWER: [number, number][] = [[196, 0.5], [220, 0.5], [196, 1]];
const CHORUS = [1, 1.25, 1.5];

const beats = (ph: [number, number][]) => ph.reduce((s, [, b]) => s + b, 0);

let made = 0;

export function callResponse(): HTMLElement {
  const sid = `call-${++made}`;
  let timers: number[] = [];
  let due = -1;
  let busy = false;
  const status = h('p.mx-cr-status', { role: 'status', 'aria-live': 'polite' }, pick({ en: 'Lead the call, or let the leader call and answer.', ru: 'Запевайте сами — или пусть запевает ведущий, а вы отвечайте.' }));
  const leader = h('span.mx-cr-fig.mx-cr-leader', { 'aria-hidden': 'true' });
  const group = h('span.mx-cr-fig.mx-cr-group', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i'));
  const stage = h('div.mx-cr-stage', { 'aria-hidden': 'true' }, leader, group);

  const stop = () => {
    timers.forEach((t) => clearTimeout(t));
    timers = [];
    due = -1;
    busy = false;
    leader.classList.remove('on');
    group.classList.remove('on');
    answer.disabled = true;
    release(sid);
  };
  const out = () => {
    const ctx = audioContext();
    const g = ctx.createGain();
    g.gain.value = 0.7;
    g.connect(ctx.destination);
    return { ctx, g };
  };
  const light = (el: HTMLElement, at: number, len: number) => {
    timers.push(window.setTimeout(() => el.classList.add('on'), at * 1000));
    timers.push(window.setTimeout(() => el.classList.remove('on'), (at + len) * 1000));
  };
  const singPhrase = (ctx: AudioContext, g: AudioNode, t0: number, ph: [number, number][], voices: number[], formants?: [number, number]) => {
    let t = t0;
    for (const [p, b] of ph) {
      for (const [i, r] of voices.entries()) sing(ctx, g, t + i * 0.012, p * r, b * BEAT * 0.95, 0.32 / voices.length + 0.12, formants);
      t += b * BEAT;
    }
  };
  const answerAt = (ctx: AudioContext, g: AudioNode, t: number, delay: number) => {
    singPhrase(ctx, g, t, ANSWER, CHORUS, [600, 1000]);
    light(group, delay, beats(ANSWER) * BEAT);
  };

  /** You lead: your call, and the group answers on the next beat. */
  const lead = (i: number) => {
    stop();
    claim(sid, stop, root);
    const { ctx, g } = out();
    const t0 = ctx.currentTime + 0.05;
    const len = beats(CALLS[i]) * BEAT;
    singPhrase(ctx, g, t0, CALLS[i], [1]);
    light(leader, 0.05, len);
    answerAt(ctx, g, t0 + len, 0.05 + len);
    status.textContent = pick({ en: 'You called; the group answered on the beat.', ru: 'Вы запели — все ответили точно в долю.' });
    timers.push(window.setTimeout(stop, (len + beats(ANSWER) * BEAT + 0.3) * 1000));
  };

  /** The leader calls; your answer is due on the beat after the call. */
  const listen = () => {
    stop();
    claim(sid, stop, root);
    busy = true;
    const { ctx, g } = out();
    const i = Math.floor(Math.random() * CALLS.length);
    const t0 = ctx.currentTime + 0.05;
    const len = beats(CALLS[i]) * BEAT;
    singPhrase(ctx, g, t0, CALLS[i], [1], [800, 1300]);
    light(leader, 0.05, len);
    due = t0 + len;
    answer.disabled = false;
    answer.focus({ preventScroll: true });
    status.textContent = pick({ en: 'The leader is calling. Answer when the call ends.', ru: 'Ведущий запевает. Ответьте, когда зов закончится.' });
    // Nobody answered: the round ends by itself.
    timers.push(window.setTimeout(() => {
      if (!busy) return;
      stop();
      status.textContent = pick({ en: 'No answer came. Try again: the refrain belongs on the beat right after the call.', ru: 'Ответа не было. Попробуйте ещё раз: припев вступает в долю сразу после зова.' });
    }, (len + 2.5) * 1000));
  };

  const answer = h('button.btn.primary.mx-cr-answer', { type: 'button', disabled: true }, pick({ en: 'Answer', ru: 'Ответить' })) as HTMLButtonElement;
  answer.addEventListener('click', () => {
    if (due < 0) return;
    const { ctx, g } = out();
    const now = ctx.currentTime;
    const verdict = answerTiming(due, now);
    answerAt(ctx, g, now + 0.01, 0.01);
    due = -1;
    busy = false;
    answer.disabled = true;
    status.textContent = pick(
      verdict === 'on'
        ? { en: 'On the beat: the call and the answer are one song.', ru: 'Точно в долю: зов и отклик слились в одну песню.' }
        : verdict === 'early'
          ? { en: 'Too early: you came in over the leader. Let the call finish.', ru: 'Рано: вы вступили поверх ведущего. Дайте зову закончиться.' }
          : { en: 'A little late: the answer belongs right on the next beat.', ru: 'Чуть поздно: отклик должен прийти ровно в следующую долю.' },
    );
    timers.push(window.setTimeout(() => {
      leader.classList.remove('on');
      group.classList.remove('on');
      release(sid);
    }, beats(ANSWER) * BEAT * 1000 + 300));
  });

  const root = h(
    'div.mx-cr',
    {},
    stage,
    h(
      'div.mx-cr-row',
      { role: 'group', 'aria-label': pick({ en: 'Lead a call', ru: 'Запеть' }) },
      h('span.mx-cr-lbl', {}, pick({ en: 'You lead:', ru: 'Запевайте:' })),
      ...CALLS.map((_, i) => h('button.btn.mx-cr-call', { type: 'button', 'data-call': String(i), onclick: () => lead(i) }, pick({ en: `Call ${i + 1}`, ru: `Зов ${i + 1}` }))),
    ),
    h(
      'div.mx-cr-row',
      { role: 'group', 'aria-label': pick({ en: 'Answer the leader', ru: 'Ответить ведущему' }) },
      h('span.mx-cr-lbl', {}, pick({ en: 'You answer:', ru: 'Отвечайте:' })),
      h('button.btn.mx-cr-listen', { type: 'button', onclick: listen }, pick({ en: 'Let the leader call', ru: 'Пусть запоёт ведущий' })),
      answer,
    ),
    status,
    h('p.mx-preset', {}, pick({ en: 'The calls and the refrain are short phrases written for this museum and sung by synthesized voices. They are not the melody of any song.', ru: 'Зовы и припев — короткие фразы, написанные для этого музея; их поют синтезированные голоса. Это не мелодия какой-либо песни.' })),
  );
  return root;
}
