// The phone's back camera as a pulse sensor: a fingertip over the lens with
// the flash on. Only the mean green of the frame's centre is read, frame by
// frame; the picture is never kept, drawn, recorded or sent, and the camera
// stops as soon as the reading does.
import type { Sample } from './ppg';

export interface Camera {
  stream: MediaStream;
  track: MediaStreamTrack;
  /** The flash is on. */
  torch: boolean;
}

type TorchCaps = MediaTrackCapabilities & { torch?: boolean };

async function lightUp(track: MediaStreamTrack): Promise<boolean> {
  const caps = (track.getCapabilities?.() ?? {}) as TorchCaps;
  if (!caps.torch) return false;
  try {
    await track.applyConstraints({ advanced: [{ torch: true } as MediaTrackConstraintSet] });
    return true;
  } catch {
    return false;
  }
}

const VIDEO: MediaTrackConstraints = { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 30 } };

/**
 * The back camera, with its flash if the browser can turn it on. Phones
 * with several back cameras (Pixel) often have the flash on only one of
 * them: each back camera is tried until one can light up.
 */
export async function openBackCamera(): Promise<Camera> {
  const md = navigator.mediaDevices;
  let stream = await md.getUserMedia({ audio: false, video: { ...VIDEO, facingMode: { ideal: 'environment' } } });
  let track = stream.getVideoTracks()[0];
  if (await lightUp(track)) return { stream, track, torch: true };
  try {
    const current = track.getSettings().deviceId;
    const backs = (await md.enumerateDevices()).filter((d) => d.kind === 'videoinput' && d.deviceId !== current && /back|rear|environment|задн/i.test(d.label));
    for (const d of backs) {
      let s: MediaStream;
      try {
        s = await md.getUserMedia({ audio: false, video: { ...VIDEO, deviceId: { exact: d.deviceId } } });
      } catch {
        continue;
      }
      const t = s.getVideoTracks()[0];
      if (await lightUp(t)) {
        stream.getTracks().forEach((x) => x.stop());
        return { stream: s, track: t, torch: true };
      }
      s.getTracks().forEach((x) => x.stop());
    }
  } catch {
    /* enumerating is a bonus */
  }
  return { stream, track, torch: false };
}

export function closeCamera(c: Camera | null): void {
  c?.stream.getTracks().forEach((t) => t.stop());
}

type FrameVideo = HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime?: number; expectedDisplayTime?: number }) => void) => number; cancelVideoFrameCallback?: (id: number) => void };

/**
 * Read the mean green of the middle half of every frame. Times come from
 * requestVideoFrameCallback (the frame's own time) where the browser has
 * it, otherwise from animation frames.
 */
export class FrameReader {
  private canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D | null;
  private id = 0;
  private stopped = false;
  private lastTime = -1;

  constructor(
    private readonly video: FrameVideo,
    private readonly onSample: (s: Sample) => void,
  ) {
    this.canvas.width = 24;
    this.canvas.height = 24;
    this.g = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  start(): void {
    this.stopped = false;
    this.next();
  }

  private next(): void {
    if (this.stopped) return;
    const v = this.video;
    if (v.requestVideoFrameCallback) {
      this.id = v.requestVideoFrameCallback((now, meta) => {
        this.read(meta.mediaTime ?? now / 1000);
        this.next();
      });
    } else {
      this.id = requestAnimationFrame((now) => {
        this.read(now / 1000);
        this.next();
      });
    }
  }

  private read(t: number): void {
    const v = this.video;
    if (!this.g || !v.videoWidth || t === this.lastTime) return;
    this.lastTime = t;
    const sw = v.videoWidth / 2;
    const sh = v.videoHeight / 2;
    this.g.drawImage(v, sw / 2, sh / 2, sw, sh, 0, 0, 24, 24);
    const px = this.g.getImageData(0, 0, 24, 24).data;
    let sum = 0;
    for (let i = 1; i < px.length; i += 4) sum += px[i];
    this.onSample({ t, v: sum / (px.length / 4) });
  }

  stop(): void {
    this.stopped = true;
    if (this.video.cancelVideoFrameCallback) this.video.cancelVideoFrameCallback(this.id);
    cancelAnimationFrame(this.id);
  }
}
