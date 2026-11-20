// The layers of the "What the song is made of" scene, as sound: eight bars
// of "Angel" itself, separated by machine into four tracks (bass, drums,
// voice, guitars and the rest). The four loop together from one start, so a
// layer the reader adds comes in on the beat, and all four sum back to the
// song.

export type Stratum = 'bass' | 'drums' | 'voice' | 'guitar';

const FILES: Record<Stratum, string> = {
  bass: 'media/angel-stem-bass.flac',
  drums: 'media/angel-stem-drums.flac',
  voice: 'media/angel-stem-vocals.flac',
  guitar: 'media/angel-stem-other.flac',
};

const FADE = 0.6; // seconds a layer takes to come in or go out
const KEYS = Object.keys(FILES) as Stratum[];

export class StrataSound {
  constructor(private readonly onLoading: (loading: boolean) => void = () => {}) {}

  private ac: AudioContext | null = null;
  private bus = new Map<Stratum, GainNode>();
  private on = new Set<Stratum>();
  private loading: Promise<boolean> | null = null;
  private started = false;

  /** Turn a layer on or off; the first one loads the tracks and starts them (from a click, so the browser lets the sound start). */
  set(k: Stratum, wanted: boolean): void {
    const ac = this.ensure();
    if (!ac) return;
    if (wanted) this.on.add(k);
    else this.on.delete(k);
    void ac.resume();
    void this.load().then((ok) => {
      if (!ok || this.ac !== ac) return;
      this.startAll();
      this.ramp(k);
    });
  }

  /** Fetch and decode the four tracks ahead (no sound: the context stays suspended until a click). */
  preload(): void {
    if (this.ensure()) void this.load();
  }

  /** Silence everything (the reader left the scene); the layers stay chosen and come back, in step, on resume(). */
  pause(): void {
    void this.ac?.suspend();
  }

  resume(): void {
    if (this.ac && this.on.size) void this.ac.resume();
  }

  dispose(): void {
    void this.ac?.close();
    this.ac = null;
    this.bus.clear();
    this.started = false;
    this.loading = null;
  }

  private ramp(k: Stratum): void {
    const ac = this.ac!;
    const g = this.bus.get(k)!.gain;
    const now = ac.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(this.on.has(k) ? 1 : 0, now + FADE);
  }

  private ensure(): AudioContext | null {
    if (this.ac) return this.ac;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    const ac = new Ctor();
    this.ac = ac;
    const master = ac.createGain();
    master.gain.value = 0.9;
    master.connect(ac.destination);
    for (const k of KEYS) {
      const g = ac.createGain();
      g.gain.value = 0;
      g.connect(master);
      this.bus.set(k, g);
    }
    return ac;
  }

  private buffers = new Map<Stratum, AudioBuffer>();

  private load(): Promise<boolean> {
    const ac = this.ac!;
    if (this.loading) return this.loading;
    this.onLoading(true);
    this.loading = Promise.all(
      KEYS.map(async (k) => {
        const res = await fetch(FILES[k]);
        if (!res.ok) throw new Error(String(res.status));
        this.buffers.set(k, await ac.decodeAudioData(await res.arrayBuffer()));
      }),
    ).then(
      () => {
        this.onLoading(false);
        return true;
      },
      () => {
        this.loading = null;
        this.onLoading(false);
        return false;
      },
    );
    return this.loading;
  }

  /** All four from one moment, looping, so they stay in step whichever are heard. */
  private startAll(): void {
    if (this.started || !this.ac) return;
    this.started = true;
    const ac = this.ac;
    const at = ac.currentTime + 0.05;
    for (const k of KEYS) {
      const s = ac.createBufferSource();
      s.buffer = this.buffers.get(k)!;
      s.loop = true;
      s.connect(this.bus.get(k)!);
      s.start(at);
    }
    for (const k of this.on) this.ramp(k);
  }
}
