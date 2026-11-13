// Drum voices synthesized with Web Audio: no samples. Two kits: the analog
// voices of a TR-808 style drum machine, and an acoustic-sounding kit for the
// Amen pads. Each voice schedules one hit at `when` into `out`.

export type Voice = (ctx: AudioContext, out: AudioNode, when: number, level?: number) => void;

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
function noise(ctx: AudioContext): AudioBuffer {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, b);
  }
  return b;
}

function env(ctx: AudioContext, out: AudioNode, when: number, peak: number, decay: number, attack = 0.001): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), when + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
  g.connect(out);
  return g;
}

function noiseHit(ctx: AudioContext, out: AudioNode, when: number, peak: number, decay: number, filters: { type: BiquadFilterType; f: number; q?: number }[]): void {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  let node: AudioNode = src;
  for (const f of filters) {
    const bq = ctx.createBiquadFilter();
    bq.type = f.type;
    bq.frequency.value = f.f;
    if (f.q) bq.Q.value = f.q;
    node.connect(bq);
    node = bq;
  }
  node.connect(env(ctx, out, when, peak, decay));
  src.start(when);
  src.stop(when + decay + 0.05);
}

function tone(ctx: AudioContext, out: AudioNode, when: number, type: OscillatorType, from: number, to: number, sweep: number, peak: number, decay: number): void {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(from, when);
  o.frequency.exponentialRampToValueAtTime(to, when + sweep);
  o.connect(env(ctx, out, when, peak, decay));
  o.start(when);
  o.stop(when + decay + 0.05);
}

/** Six detuned square waves: the metallic source of 808 hats and cymbals. */
const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];
function metal(ctx: AudioContext, out: AudioNode, when: number, peak: number, decay: number, band: number, high: number, ratios = METAL): void {
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = band;
  bp.Q.value = 0.8;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = high;
  bp.connect(hp);
  hp.connect(env(ctx, out, when, peak, decay));
  for (const f of ratios) {
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = f;
    o.connect(bp);
    o.start(when);
    o.stop(when + decay + 0.05);
  }
}

export const KIT_808: Record<string, Voice> = {
  bd: (ctx, out, t, l = 1) => tone(ctx, out, t, 'sine', 150, 46, 0.09, 1.0 * l, 0.75),
  sd: (ctx, out, t, l = 1) => {
    tone(ctx, out, t, 'triangle', 238, 180, 0.05, 0.45 * l, 0.12);
    tone(ctx, out, t, 'triangle', 476, 330, 0.05, 0.25 * l, 0.08);
    noiseHit(ctx, out, t, 0.45 * l, 0.18, [{ type: 'highpass', f: 1800 }]);
  },
  lt: (ctx, out, t, l = 1) => tone(ctx, out, t, 'sine', 140, 92, 0.12, 0.8 * l, 0.42),
  cp: (ctx, out, t, l = 1) => {
    for (const d of [0, 0.011, 0.022]) noiseHit(ctx, out, t + d, 0.5 * l, 0.012, [{ type: 'bandpass', f: 1100, q: 1.2 }]);
    noiseHit(ctx, out, t + 0.03, 0.42 * l, 0.16, [{ type: 'bandpass', f: 1100, q: 1.2 }]);
  },
  cb: (ctx, out, t, l = 1) => metal(ctx, out, t, 0.22 * l, 0.28, 2640, 600, [540, 800]),
  ch: (ctx, out, t, l = 1) => metal(ctx, out, t, 0.28 * l, 0.045, 10000, 7000),
  oh: (ctx, out, t, l = 1) => metal(ctx, out, t, 0.24 * l, 0.32, 10000, 7000),
};

export const KIT_ACOUSTIC: Record<string, Voice> = {
  kick: (ctx, out, t, l = 1) => {
    tone(ctx, out, t, 'sine', 120, 52, 0.07, 1.0 * l, 0.32);
    noiseHit(ctx, out, t, 0.18 * l, 0.02, [{ type: 'lowpass', f: 3000 }]);
  },
  snare: (ctx, out, t, l = 1) => {
    tone(ctx, out, t, 'triangle', 220, 170, 0.04, 0.4 * l, 0.09);
    noiseHit(ctx, out, t, 0.62 * l, 0.2, [{ type: 'bandpass', f: 2600, q: 0.6 }]);
  },
  hat: (ctx, out, t, l = 1) => noiseHit(ctx, out, t, 0.24 * l, 0.05, [{ type: 'highpass', f: 8000 }]),
  ride: (ctx, out, t, l = 1) => {
    metal(ctx, out, t, 0.12 * l, 0.7, 6500, 3500, [312, 459, 581, 722, 897, 1103]);
    noiseHit(ctx, out, t, 0.06 * l, 0.25, [{ type: 'bandpass', f: 7000, q: 2 }]);
  },
  crash: (ctx, out, t, l = 1) => {
    metal(ctx, out, t, 0.12 * l, 1.4, 5200, 3000, [312, 459, 581, 722, 897, 1103]);
    noiseHit(ctx, out, t, 0.3 * l, 1.2, [{ type: 'highpass', f: 4200 }]);
  },
};
