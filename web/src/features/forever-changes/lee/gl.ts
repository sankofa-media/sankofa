// The Arthur Lee mode's picture: the camera (or a still) through a shader
// pipeline, all on this device. WebGL2 where there is one (WebGL1
// otherwise, same shaders). Pass one draws into a feedback buffer, so
// whatever moves leaves long colour trails: the walls breathe and bend
// through domain-warped noise, hues turn with the light, the picture
// posterises and its edges glow, a kaleidoscope opens, faces swirl out of
// the textures, and in the bad stretches the colour drains to green and
// purple, shadows thicken and tendrils crawl in from the edges. Pass two
// splits the colours and closes the vignette. Every value that carries
// light changes slowly (the phases take tens of seconds), so nothing here
// flashes; flashes elsewhere in the mode go through the FlashGate.
import { program } from '../acid';
import type { LeePhase } from '../trip';

const VERT = `
attribute vec2 a;
varying vec2 v;
void main() { v = a * 0.5 + 0.5; gl_Position = vec4(a, 0.0, 1.0); }
`;

const COMMON = `
precision mediump float;
varying vec2 v;
uniform float u_time;
uniform float u_oct;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0; float a = 0.5;
  for (int k = 0; k < 5; k++) { if (float(k) >= u_oct) break; s += a * noise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p; a *= 0.5; }
  return s;
}
vec3 hsv2rgb(vec3 c) { vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0); return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y); }
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
`;

const FRAG = COMMON + `
uniform sampler2D u_src;
uniform sampler2D u_prev;
uniform float u_int;
uniform float u_eu;
uniform float u_bad;
uniform float u_kal;
uniform float u_trail;
uniform float u_breathe;
uniform float u_hue;
uniform float u_mirror;
uniform float u_still;
uniform vec2 u_cover;
uniform vec2 u_texel;
uniform vec3 u_face;
uniform vec2 u_behind;

vec2 cover(vec2 uv) { vec2 c = (uv - 0.5) * u_cover + 0.5; c.x = mix(c.x, 1.0 - c.x, u_mirror); return vec2(c.x, 1.0 - c.y); }
float luma(vec2 uv) { return dot(texture2D(u_src, cover(uv)).rgb, vec3(0.299, 0.587, 0.114)); }

void main() {
  float t = u_time;
  vec2 c = v - 0.5;
  // A still picture drifts, so the trails have something to follow.
  c = c * (1.0 - 0.07 * u_still * (0.5 + 0.5 * sin(t * 0.05))) + u_still * 0.035 * vec2(sin(t * 0.031), cos(t * 0.023));
  // The walls breathe and bend: a slow pulse and a ripple running out from the middle.
  float r0 = length(c);
  c *= 1.0 + u_breathe * (0.04 * sin(t * 0.8) + 0.028 * sin(r0 * 13.0 - t * 1.2));
  // Everything flows: domain-warped noise, warped again.
  vec2 w = vec2(fbm(c * 3.0 + t * 0.05), fbm(c * 3.0 - t * 0.04 + 7.3)) - 0.5;
  vec2 w2 = vec2(fbm(c * 2.4 + 4.0 * w + t * 0.03), fbm(c * 2.4 + 4.0 * w + vec2(3.1, 8.7) - t * 0.02)) - 0.5;
  c += (w * 0.6 + w2) * (0.02 + 0.1 * u_int);
  // Faces in the pattern: two eyes swirl out of the texture where its edges are busiest.
  if (u_face.z > 0.01) {
    for (int k = 0; k < 2; k++) {
      vec2 e = u_face.xy - 0.5 + vec2(k == 0 ? -0.06 : 0.06, -0.025);
      vec2 d = c - e;
      float fall = exp(-dot(d, d) / 0.0022);
      float ang = u_face.z * 4.0 * fall * (k == 0 ? 1.0 : -1.0);
      c = e + mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * d;
    }
    vec2 m = c - (u_face.xy - 0.5 + vec2(0.0, 0.07));
    c.y += u_face.z * 0.02 * exp(-dot(m * vec2(0.6, 3.0), m * vec2(0.6, 3.0)) / 0.003);
  }
  // The kaleidoscope.
  float ra = length(c);
  float an = atan(c.y, c.x) + t * 0.03;
  float seg = 6.2831853 / 8.0;
  float ka = abs(mod(an, seg) - seg * 0.5);
  c = mix(c, vec2(cos(ka), sin(ka)) * ra, u_kal);
  vec2 uv = c + 0.5;
  vec3 cam = texture2D(u_src, cover(uv)).rgb;
  float lum = dot(cam, vec3(0.299, 0.587, 0.114));
  float gx = luma(uv + vec2(u_texel.x, 0.0)) - luma(uv - vec2(u_texel.x, 0.0));
  float gy = luma(uv + vec2(0.0, u_texel.y)) - luma(uv - vec2(0.0, u_texel.y));
  float edge = smoothstep(0.03, 0.22, length(vec2(gx, gy)));
  // Euphoria: hue turns with the light, colour floods in, the picture posterises, edges glow like neon.
  vec3 hc = rgb2hsv(cam);
  float hue = fract(hc.x + u_hue + lum * (0.7 + 1.6 * u_int) + t * 0.015);
  vec3 eu = hsv2rgb(vec3(hue, min(1.0, 0.65 + hc.y * 0.5), clamp(lum * 1.35 + 0.12, 0.0, 1.0)));
  float levels = mix(9.0, 3.0, u_int);
  eu = floor(eu * levels + 0.5) / levels;
  vec3 oil = hsv2rgb(vec3(fract(u_hue + fbm(c * 2.2 + w * 2.0 + t * 0.03) * 0.9 + t * 0.01), 0.95, 1.0));
  vec3 col = mix(cam, eu, u_eu * (0.4 + 0.6 * u_int));
  col = mix(col, col * oil * 1.6, 0.15 + 0.35 * u_int * u_eu);
  col += oil * edge * (0.35 + 1.3 * u_int) * (0.3 + u_eu);
  // The bad stretch: colour drains to sick green and bruise purple, shadows thicken, tendrils crawl from the edges.
  vec3 sick = mix(vec3(0.17, 0.32, 0.05), vec3(0.34, 0.07, 0.4), smoothstep(0.3, 0.7, fbm(c * 3.0 - t * 0.05)));
  vec3 badc = sick * lum * 1.7;
  badc *= smoothstep(0.1 * u_bad, 0.55, lum);
  vec2 ev = v - 0.5;
  float ed = 0.5 - max(abs(ev.x), abs(ev.y));
  float tend = pow(1.0 - abs(2.0 * fbm(vec2(atan(ev.y, ev.x) * 4.0, ed * 9.0 - t * 0.12)) - 1.0), 9.0);
  float reach = smoothstep(0.34 * u_bad, 0.0, ed + 0.04 * (fbm(ev * 6.0 + t * 0.1) - 0.5));
  badc = mix(badc, vec3(0.01, 0.0, 0.02), reach * 0.75);
  badc += tend * reach * vec3(0.4, 0.6, 0.06);
  badc += edge * vec3(0.25, 0.05, 0.3) * u_bad;
  col = mix(col, badc, u_bad);
  // Someone behind you: the dark rises on one side, and a shape stands in it.
  if (u_behind.y > 0.01) {
    float sx = (v.x - 0.5) * u_behind.x;
    float side = smoothstep(-0.05, 0.5, sx);
    vec2 hp = vec2(sx - 0.33, v.y - 0.62);
    float head = smoothstep(0.1, 0.07, length(hp * vec2(1.0, 0.8)));
    vec2 bp = vec2(sx - 0.33, v.y - 0.3);
    float body = smoothstep(0.24, 0.2, length(bp * vec2(0.9, 0.55))) * step(v.y, 0.52);
    float shape = max(head, body) * (0.85 + 0.15 * fbm(v * 8.0 + t * 0.2));
    col *= 1.0 - u_behind.y * (0.55 * side + 0.9 * shape);
  }
  // Trails: what was here stays, slowly zooming in and turning, its colour drifting.
  float zr = 0.004 * sin(t * 0.11);
  vec2 pc = mat2(cos(zr), -sin(zr), sin(zr), cos(zr)) * (v - 0.5) * (0.993 - 0.008 * u_int) + 0.5;
  vec3 prev = texture2D(u_prev, pc + w * 0.004).rgb;
  prev = mix(prev, prev.gbr, 0.035 * u_eu);
  col = mix(col, max(col, prev * (0.9 + 0.085 * u_trail)), u_trail);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const POST = COMMON + `
uniform sampler2D u_img;
uniform float u_int;
uniform float u_bad;
void main() {
  vec2 d = v - 0.5;
  float k = 0.004 + 0.014 * u_int;
  vec3 col = vec3(texture2D(u_img, v + d * k).r, texture2D(u_img, v).g, texture2D(u_img, v - d * k).b);
  // A soft glow round the bright parts.
  vec3 glow = texture2D(u_img, v + vec2(0.006, 0.0)).rgb + texture2D(u_img, v - vec2(0.006, 0.0)).rgb + texture2D(u_img, v + vec2(0.0, 0.008)).rgb + texture2D(u_img, v - vec2(0.0, 0.008)).rgb;
  col += max(glow * 0.25 - 0.55, 0.0) * (0.5 + u_int);
  float vig = smoothstep(0.32, 0.86, length(d * vec2(1.1, 1.0)));
  col *= 1.0 - vig * (0.3 + 0.55 * u_bad + 0.1 * sin(u_time * 0.7));
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

export interface Look {
  phase: LeePhase;
  /** The chapter's colour, 0..1 around the hue circle (drifts with time). */
  hue: number;
  /** A face in the pattern: where (0..1) and how strong (0..1). */
  face: [number, number, number];
  /** Someone behind: on which side (-1 left, 1 right) and how much (0..1). */
  behind: [number, number];
  /** The picture is a still (it drifts slowly). */
  still: boolean;
  /** Noise octaves (fewer when frames drop). */
  octaves: number;
}

export type GlKind = 'webgl2' | 'webgl';

export class Shader {
  readonly kind: GlKind;
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private post: WebGLProgram;
  private src: WebGLTexture;
  private fb: { tex: WebGLTexture; fbo: WebGLFramebuffer }[] = [];
  private flip = 0;
  private w = 0;
  private h = 0;
  private srcW = 1;
  private srcH = 1;
  private loc = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  mirror = false;

  private constructor(readonly canvas: HTMLCanvasElement, gl: WebGLRenderingContext, kind: GlKind) {
    this.gl = gl;
    this.kind = kind;
    this.prog = program(gl, VERT, FRAG);
    this.post = program(gl, VERT, POST);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.src = texture(gl);
  }

  /** A shader on `canvas`, or null when this device has no WebGL. */
  static create(canvas: HTMLCanvasElement): Shader | null {
    const opts = { premultipliedAlpha: false, preserveDrawingBuffer: false, antialias: false, depth: false, stencil: false };
    try {
      const gl2 = canvas.getContext('webgl2', opts) as WebGLRenderingContext | null;
      if (gl2) return new Shader(canvas, gl2, 'webgl2');
    } catch {
      /* fall back to WebGL1 below */
    }
    try {
      const gl = canvas.getContext('webgl', opts) as WebGLRenderingContext | null;
      return gl ? new Shader(canvas, gl, 'webgl') : null;
    } catch {
      return null;
    }
  }

  resize(w: number, h: number): void {
    const gl = this.gl;
    w = Math.max(2, Math.round(w));
    h = Math.max(2, Math.round(h));
    if (w === this.w && h === this.h) return;
    this.w = this.canvas.width = w;
    this.h = this.canvas.height = h;
    for (const f of this.fb) {
      gl.deleteTexture(f.tex);
      gl.deleteFramebuffer(f.fbo);
    }
    this.fb = [0, 1].map(() => {
      const tex = texture(gl);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.w, this.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { tex, fbo };
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Take the next picture from the camera or the still. */
  upload(source: TexImageSource, w: number, h: number): void {
    const gl = this.gl;
    if (!w || !h) return;
    this.srcW = w;
    this.srcH = h;
    gl.bindTexture(gl.TEXTURE_2D, this.src);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  private u(p: WebGLProgram, name: string): WebGLUniformLocation | null {
    let m = this.loc.get(p);
    if (!m) this.loc.set(p, (m = new Map()));
    if (!m.has(name)) m.set(name, this.gl.getUniformLocation(p, name));
    return m.get(name)!;
  }

  draw(time: number, look: Look): void {
    const gl = this.gl;
    if (!this.fb.length) return;
    const ph = look.phase;
    const from = this.fb[this.flip];
    const to = this.fb[1 - this.flip];
    gl.viewport(0, 0, this.w, this.h);
    // Into the feedback buffer.
    gl.bindFramebuffer(gl.FRAMEBUFFER, to.fbo);
    const p = this.prog;
    gl.useProgram(p);
    bindQuad(gl, p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.src);
    gl.uniform1i(this.u(p, 'u_src'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, from.tex);
    gl.uniform1i(this.u(p, 'u_prev'), 1);
    const f1 = (n: string, x: number) => gl.uniform1f(this.u(p, n), x);
    f1('u_time', time);
    f1('u_oct', look.octaves);
    f1('u_int', ph.intensity);
    f1('u_eu', ph.euphoria);
    f1('u_bad', ph.bad);
    f1('u_kal', ph.kaleidoscope);
    f1('u_trail', ph.trails);
    f1('u_breathe', ph.breathe);
    f1('u_hue', look.hue);
    f1('u_mirror', this.mirror ? 1 : 0);
    f1('u_still', look.still ? 1 : 0);
    gl.uniform3f(this.u(p, 'u_face'), look.face[0], look.face[1], look.face[2]);
    gl.uniform2f(this.u(p, 'u_behind'), look.behind[0], look.behind[1]);
    // Cover the screen with the picture, cropping what does not fit.
    const sa = this.srcW / this.srcH;
    const da = this.w / this.h;
    gl.uniform2f(this.u(p, 'u_cover'), da < sa ? da / sa : 1, da < sa ? 1 : sa / da);
    gl.uniform2f(this.u(p, 'u_texel'), 1.5 / this.srcW, 1.5 / this.srcH);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // To the screen, through the colour split and the vignette.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const q = this.post;
    gl.useProgram(q);
    bindQuad(gl, q);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, to.tex);
    gl.uniform1i(this.u(q, 'u_img'), 0);
    gl.uniform1f(this.u(q, 'u_time'), time);
    gl.uniform1f(this.u(q, 'u_oct'), look.octaves);
    gl.uniform1f(this.u(q, 'u_int'), ph.intensity);
    gl.uniform1f(this.u(q, 'u_bad'), ph.bad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.flip = 1 - this.flip;
  }

  dispose(): void {
    (this.gl.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext();
  }
}

function bindQuad(gl: WebGLRenderingContext, p: WebGLProgram): void {
  const loc = gl.getAttribLocation(p, 'a');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
}

function texture(gl: WebGLRenderingContext): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return t;
}

/** A still room for when there is no camera: a window on the city at night, a lamp, a table. */
export function stillRoom(w = 960, h = 640): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) return c;
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#2a2118');
  bg.addColorStop(1, '#120e0a');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  // Wallpaper with a pattern (the patterns are where faces come from), and floorboards.
  g.save();
  g.globalAlpha = 0.22;
  g.strokeStyle = '#c9a26a';
  g.lineWidth = 2;
  for (let y = 20; y < h * 0.7; y += 46)
    for (let x = (y / 46) % 2 ? 0 : 23; x < w; x += 46) {
      g.beginPath();
      g.ellipse(x, y, 12, 17, 0, 0, Math.PI * 2);
      g.moveTo(x - 6, y);
      g.quadraticCurveTo(x, y - 12, x + 6, y);
      g.stroke();
    }
  g.restore();
  g.fillStyle = '#2b1d12';
  g.fillRect(0, h * 0.7, w, h * 0.3);
  g.strokeStyle = '#1a110a';
  g.lineWidth = 3;
  for (let x = -w; x < w * 2; x += 70) {
    g.beginPath();
    g.moveTo(w / 2 + (x - w / 2) * 0.35, h * 0.7);
    g.lineTo(x, h);
    g.stroke();
  }
  // A poster on the wall: a sun, circles in circles.
  g.fillStyle = '#d9c39a';
  g.fillRect(w * 0.6, h * 0.1, w * 0.1, h * 0.2);
  for (let r = 6; r < w * 0.045; r += 7) {
    g.strokeStyle = r % 14 < 7 ? '#a8322a' : '#1d4a6b';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(w * 0.65, h * 0.2, r, 0, Math.PI * 2);
    g.stroke();
  }
  // A curtain with its folds.
  for (let i = 0; i < 9; i++) {
    g.fillStyle = i % 2 ? '#5a1d2a' : '#6e2633';
    g.fillRect(w * 0.02 + i * 9, h * 0.06, 10, h * 0.62);
  }
  // The window and the city in it.
  g.fillStyle = '#0b0f1e';
  g.fillRect(w * 0.12, h * 0.12, w * 0.42, h * 0.46);
  for (let i = 0; i < 120; i++) {
    g.fillStyle = i % 7 === 0 ? '#e0574a' : '#f3d58a';
    g.globalAlpha = 0.35 + ((i * 37) % 60) / 100;
    g.fillRect(w * 0.13 + ((i * 53) % Math.round(w * 0.4)), h * 0.36 + ((i * 29) % Math.round(h * 0.2)), 3, 3);
  }
  g.globalAlpha = 1;
  g.strokeStyle = '#efe4cf';
  g.lineWidth = 4;
  g.strokeRect(w * 0.12, h * 0.12, w * 0.42, h * 0.46);
  g.beginPath();
  g.moveTo(w * 0.33, h * 0.12);
  g.lineTo(w * 0.33, h * 0.58);
  g.stroke();
  // The lamp.
  const lamp = g.createRadialGradient(w * 0.76, h * 0.3, 10, w * 0.76, h * 0.3, h * 0.5);
  lamp.addColorStop(0, 'rgba(255,214,150,0.55)');
  lamp.addColorStop(1, 'rgba(255,214,150,0)');
  g.fillStyle = lamp;
  g.fillRect(0, 0, w, h);
  g.beginPath();
  g.moveTo(w * 0.7, h * 0.22);
  g.lineTo(w * 0.82, h * 0.22);
  g.lineTo(w * 0.79, h * 0.12);
  g.lineTo(w * 0.73, h * 0.12);
  g.closePath();
  g.fillStyle = '#c7b89c';
  g.fill();
  g.fillRect(w * 0.757, h * 0.22, 6, h * 0.42);
  // The table, a cup, a record sleeve.
  g.fillStyle = '#3b2c1e';
  g.fillRect(w * 0.05, h * 0.68, w * 0.9, h * 0.06);
  g.fillRect(w * 0.1, h * 0.74, 14, h * 0.26);
  g.fillRect(w * 0.88, h * 0.74, 14, h * 0.26);
  g.fillStyle = '#efe4cf';
  g.fillRect(w * 0.6, h * 0.6, w * 0.05, h * 0.08);
  g.save();
  g.translate(w * 0.3, h * 0.62);
  g.rotate(-0.08);
  g.fillStyle = '#a8322a';
  g.fillRect(0, 0, w * 0.16, h * 0.06);
  g.restore();
  return c;
}
