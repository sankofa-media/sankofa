// The handclap of the ring game, synthesized: filtered noise in three quick
// bursts and a short tail, like a hand meeting a hand. No recording is used.
// The quiet bed of claps on the second and fourth beats is one source of the
// museum's sound coordinator, so any recording the reader starts takes over
// from it; a single clap the reader makes is a short touch sound and claims
// nothing, so it can sound over the 1939 recording it claps along to.
import { audioContext, claim, playing, release } from '../../lib/sound';

let noise: AudioBuffer | null = null;
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noise && noise.sampleRate === ctx.sampleRate) return noise;
  const len = Math.floor(ctx.sampleRate * 0.3);
  noise = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noise.getChannelData(0);
  // A fixed sequence: every clap is the same hand.
  let s = 7;
  for (let i = 0; i < len; i++) {
    s = (s * 16807) % 2147483647;
    d[i] = (s / 2147483647) * 2 - 1;
  }
  return noise;
}

/** One clap at `at` (context time). `tone` shifts the hand: higher is smaller. */
export function clap(ctx: AudioContext, at: number, gain = 0.3, tone = 1): void {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1150 * tone;
  bp.Q.value = 1.1;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 500;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  // Three bursts ten milliseconds apart, then the decay.
  for (let i = 0; i < 3; i++) {
    const t = at + i * 0.01;
    g.gain.linearRampToValueAtTime(gain, t + 0.001);
    g.gain.exponentialRampToValueAtTime(gain * 0.25, t + 0.009);
  }
  g.gain.exponentialRampToValueAtTime(0.0008, at + 0.2);
  src.connect(bp).connect(hp).connect(g).connect(ctx.destination);
  src.start(at, Math.random() * 0.05, 0.25);
}

/** A knock on a wooden door: two low, dull thuds. */
export function knock(ctx: AudioContext, at = ctx.currentTime): void {
  for (const dt of [0, 0.22]) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, at + dt);
    o.frequency.exponentialRampToValueAtTime(70, at + dt + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at + dt);
    g.gain.exponentialRampToValueAtTime(0.5, at + dt + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dt + 0.16);
    o.connect(g).connect(ctx.destination);
    o.start(at + dt);
    o.stop(at + dt + 0.2);
  }
}

export const BPM = 100;
export const BEAT = 60 / BPM;
const SOURCE = 'feature-clap';

/**
 * The bed: claps on two and four, quietly, until stopped. `onBeat` hears
 * every beat (for drawing), `onStop` when it stops for any reason, another
 * source taking the sound included.
 */
export class ClapBed {
  private timer = 0;
  private next = 0;
  private beat = 0;
  private origin = 0;
  onBeat?: (beat: number, at: number) => void;
  onStop?: () => void;
  gain = 0.12;

  constructor(private readonly owner: Element) {}

  get running(): boolean {
    return this.timer !== 0;
  }

  /** Context time of beat 0, for placing the reader's claps on the bar. */
  get start(): number {
    return this.origin;
  }

  /** Call from a gesture (or once the context is unlocked). */
  play(): void {
    if (this.running) return;
    const ctx = audioContext();
    claim(SOURCE, () => this.halt(), this.owner);
    this.beat = 0;
    this.origin = this.next = ctx.currentTime + 0.05;
    const tick = () => {
      while (this.next < ctx.currentTime + 0.25) {
        // Beats 2 and 4 of every bar (counting from 1).
        if (this.beat % 2 === 1) clap(ctx, this.next, this.gain, 1 + (this.beat % 4 === 3 ? 0.04 : 0));
        const b = this.beat;
        const at = this.next;
        window.setTimeout(() => this.onBeat?.(b, at), Math.max(0, (at - ctx.currentTime) * 1000));
        this.beat++;
        this.next += BEAT;
      }
    };
    tick();
    this.timer = window.setInterval(tick, 80);
  }

  stop(): void {
    if (!this.running) return;
    this.halt();
    release(SOURCE);
  }

  private halt(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = 0;
    this.onStop?.();
  }

  /** The bed is the sound now (not something the reader started since). */
  static sounding(): boolean {
    return playing() === SOURCE;
  }
}
