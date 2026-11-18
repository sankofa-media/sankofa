// A step sequencer clock: schedules hits a little ahead on the audio clock
// and tells the page which step is sounding, so the lights match the sound.
import { hits, patternLength, stepSeconds, type Pattern } from './model';
import type { Voice } from './voices';

export class Sequencer {
  pattern: Pattern;
  bpm: number;
  private kit: Record<string, Voice>;
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private timer = 0;
  private next = 0;
  private step = 0;
  private uiTimers: number[] = [];
  onStep?: (step: number) => void;

  constructor(kit: Record<string, Voice>, pattern: Pattern, bpm: number) {
    this.kit = kit;
    this.pattern = pattern;
    this.bpm = bpm;
  }

  get running(): boolean {
    return !!this.timer;
  }

  start(ctx: AudioContext): void {
    if (this.timer) return;
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.8;
    this.out.connect(ctx.destination);
    this.step = 0;
    this.next = ctx.currentTime + 0.06;
    const tick = () => {
      const c = this.ctx!;
      while (this.next < c.currentTime + 0.12) {
        const s = this.step;
        for (const v of hits(this.pattern, s)) this.kit[v]?.(c, this.out!, this.next, s % 4 === 0 ? 1 : 0.82);
        const delay = Math.max(0, (this.next - c.currentTime) * 1000);
        this.uiTimers.push(window.setTimeout(() => this.onStep?.(s), delay));
        this.next += stepSeconds(this.bpm);
        this.step = (s + 1) % patternLength(this.pattern);
      }
      if (this.uiTimers.length > 64) this.uiTimers = this.uiTimers.slice(-32);
    };
    tick();
    this.timer = window.setInterval(tick, 25);
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
    this.uiTimers.forEach((t) => window.clearTimeout(t));
    this.uiTimers = [];
    const out = this.out;
    if (out && this.ctx) {
      out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
      window.setTimeout(() => out.disconnect(), 200);
    }
    this.out = null;
    this.onStep?.(-1);
  }

  /** One hit now, for pads and for auditioning a voice. */
  hit(ctx: AudioContext, voice: string): void {
    const g = ctx.createGain();
    g.gain.value = 0.8;
    g.connect(ctx.destination);
    this.kit[voice]?.(ctx, g, ctx.currentTime + 0.005);
    window.setTimeout(() => g.disconnect(), 2000);
  }
}
