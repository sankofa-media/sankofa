// The layers of the "What the song is made of" scene, as sound. Massive
// Attack's recording cannot be taken apart, so these four tracks are our own
// sketch, synthesised in the browser: a slow sub-bass, drums, a high voice-like
// tone and distorted guitars. They share one clock, so each layer the reader
// adds falls into the same beat and the change is heard at once.

export type Stratum = 'bass' | 'drums' | 'voice' | 'guitar';

const LOOKAHEAD = 0.12; // seconds of notes scheduled ahead
const TICK_MS = 25;
const FADE = 0.6; // seconds a layer takes to come in or go out

/** The level each layer settles at when it is on. */
const LEVEL: Record<Stratum, number> = { bass: 0.9, drums: 0.55, voice: 0.22, guitar: 0.32 };

export class StrataSound {
  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private bus = new Map<Stratum, GainNode>();
  private on = new Set<Stratum>();
  private timer = 0;
  private nextBeat = 0;
  private beat = 0;
  private noise: AudioBuffer | null = null;
  private guitar: { stop(): void } | null = null;

  /** bpm: the beat the layers share. */
  constructor(private readonly bpm: number) {}

  /** Turn a layer on or off; the first one starts the clock (it runs from a click, so the browser lets the sound start). */
  set(k: Stratum, wanted: boolean): void {
    const ac = this.ensure();
    if (!ac) return;
    if (wanted) this.on.add(k);
    else this.on.delete(k);
    const g = this.bus.get(k)!;
    const now = ac.currentTime;
    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(g.gain.value, now);
    g.gain.linearRampToValueAtTime(wanted ? LEVEL[k] : 0, now + FADE);
    if (this.on.size && !this.timer) this.start();
    if (k === 'guitar') this.toggleGuitar(wanted);
  }

  /** Silence everything (the reader left the scene); the layers stay chosen and come back on resume(). */
  pause(): void {
    if (!this.ac || !this.master) return;
    const now = this.ac.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0, now + 0.3);
    window.clearInterval(this.timer);
    this.timer = 0;
  }

  resume(): void {
    if (!this.ac || !this.master || !this.on.size) return;
    const now = this.ac.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.linearRampToValueAtTime(0.8, now + 0.4);
    if (!this.timer) this.start();
  }

  dispose(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
    this.guitar?.stop();
    void this.ac?.close();
    this.ac = null;
  }

  private ensure(): AudioContext | null {
    if (this.ac) {
      void this.ac.resume();
      return this.ac;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    const ac = new Ctor();
    this.ac = ac;
    this.master = ac.createGain();
    this.master.gain.value = 0.8;
    const comp = ac.createDynamicsCompressor();
    this.master.connect(comp).connect(ac.destination);
    for (const k of ['bass', 'drums', 'voice', 'guitar'] as Stratum[]) {
      const g = ac.createGain();
      g.gain.value = 0;
      g.connect(this.master);
      this.bus.set(k, g);
    }
    const len = ac.sampleRate;
    this.noise = ac.createBuffer(1, len, ac.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return ac;
  }

  private start(): void {
    const ac = this.ac!;
    this.nextBeat = ac.currentTime + 0.05;
    this.timer = window.setInterval(() => this.schedule(), TICK_MS);
    this.master!.gain.setValueAtTime(0.8, ac.currentTime);
  }

  private schedule(): void {
    const ac = this.ac;
    if (!ac) return;
    const spb = 60 / this.bpm; // seconds per beat
    while (this.nextBeat < ac.currentTime + LOOKAHEAD) {
      this.playBeat(this.beat, this.nextBeat, spb);
      this.nextBeat += spb / 2; // eighth notes
      this.beat = (this.beat + 1) % 32; // four bars of eighths
    }
  }

  /** One eighth note of every layer (the layers that are off still play, silently, so they come in on the beat). */
  private playBeat(i: number, t: number, spb: number): void {
    const inBar = i % 8;
    // Drums: kick on 1 and the "and" of 3, snare on 2 and 4, a hat on every eighth.
    if (inBar === 0 || inBar === 5) this.kick(t);
    if (inBar === 2 || inBar === 6) this.snare(t);
    this.hat(t, inBar % 2 === 0 ? 0.5 : 0.28);
    // Bass: one long low note per half bar, falling a tone at the end of each phrase.
    if (inBar === 0 || inBar === 4) {
      const phraseEnd = i >= 24;
      this.bass(t, phraseEnd && inBar === 4 ? 43.65 : 49, spb * 2 * 0.95);
    }
    // Voice: a long high note held over two bars, then a bar of rest.
    if (i === 0 || i === 16) this.voice(t, i === 0 ? 659.3 : 587.3, spb * 7);
  }

  private env(t: number, peak: number, attack: number, decay: number, bus: Stratum): GainNode {
    const g = this.ac!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(this.bus.get(bus)!);
    return g;
  }

  private kick(t: number): void {
    const ac = this.ac!;
    const o = ac.createOscillator();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    o.connect(this.env(t, 1, 0.005, 0.32, 'drums'));
    o.start(t);
    o.stop(t + 0.4);
  }

  private snare(t: number): void {
    const ac = this.ac!;
    const s = ac.createBufferSource();
    s.buffer = this.noise;
    const f = ac.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1800;
    s.connect(f).connect(this.env(t, 0.5, 0.003, 0.18, 'drums'));
    s.start(t);
    s.stop(t + 0.25);
  }

  private hat(t: number, level: number): void {
    const ac = this.ac!;
    const s = ac.createBufferSource();
    s.buffer = this.noise;
    const f = ac.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    s.connect(f).connect(this.env(t, level * 0.25, 0.002, 0.05, 'drums'));
    s.start(t);
    s.stop(t + 0.08);
  }

  private bass(t: number, hz: number, dur: number): void {
    const ac = this.ac!;
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(hz, t);
    const g = this.ac!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.04);
    g.gain.setValueAtTime(0.9, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.bus.get('bass')!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private voice(t: number, hz: number, dur: number): void {
    const ac = this.ac!;
    const o = ac.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(hz, t);
    // A slow, low vibrato.
    const lfo = ac.createOscillator();
    lfo.frequency.value = 4.8;
    const depth = ac.createGain();
    depth.gain.value = hz * 0.012;
    lfo.connect(depth).connect(o.frequency);
    const f = ac.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = hz * 1.5;
    f.Q.value = 1.2;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1, t + 0.6);
    g.gain.setValueAtTime(1, t + dur - 1.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(this.bus.get('voice')!);
    o.start(t);
    lfo.start(t);
    o.stop(t + dur + 0.05);
    lfo.stop(t + dur + 0.05);
  }

  /** The guitars: a sustained, heavily distorted low chord that breathes a little; on while the layer is on. */
  private toggleGuitar(wanted: boolean): void {
    if (!wanted || this.guitar) return;
    const ac = this.ac!;
    const shaper = ac.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 9);
    }
    shaper.curve = curve;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    const tremolo = ac.createGain();
    tremolo.gain.value = 0.8;
    const lfo = ac.createOscillator();
    lfo.frequency.value = this.bpm / 60 / 2;
    const lfoDepth = ac.createGain();
    lfoDepth.gain.value = 0.2;
    lfo.connect(lfoDepth).connect(tremolo.gain);
    const oscs = [98, 146.8, 196, 99.2].map((hz) => {
      const o = ac.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = hz;
      o.connect(shaper);
      o.start();
      return o;
    });
    shaper.connect(lp).connect(tremolo).connect(this.bus.get('guitar')!);
    lfo.start();
    this.guitar = {
      stop: () => {
        for (const o of oscs) o.stop();
        lfo.stop();
      },
    };
  }
}
