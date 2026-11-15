// The Arthur Lee mode's picture: the camera (or a still) through WebGL
// shaders, all on this device. One pass draws into a feedback buffer, so
// whatever moves leaves trails; on top of the picture: liquid-light colour
// flowing like oil in a dish, a kaleidoscope that opens as the world grows
// stronger, contours that flow and glow, and the whole world breathing.
// Brightness changes slowly (well under one cycle a second), so nothing
// here flashes; flashes elsewhere in the mode go through the FlashGate.

const VERT = `
attribute vec2 a;
varying vec2 v;
void main() { v = a * 0.5 + 0.5; gl_Position = vec4(a, 0.0, 1.0); }
`;

const FRAG = `
precision mediump float;
uniform sampler2D u_src;
uniform sampler2D u_prev;
uniform float u_time;
uniform float u_int;
uniform float u_kal;
uniform float u_hue;
uniform vec2 u_cover;
uniform vec2 u_texel;
uniform float u_mirror;
varying vec2 v;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) { float s = 0.0; float a = 0.5; for (int k = 0; k < 4; k++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
vec3 hsv(vec3 c) { vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0); return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y); }
vec2 cover(vec2 uv) { vec2 c = (uv - 0.5) * u_cover + 0.5; c.x = mix(c.x, 1.0 - c.x, u_mirror); return vec2(c.x, 1.0 - c.y); }
float luma(vec2 uv) { return dot(texture2D(u_src, cover(uv)).rgb, vec3(0.299, 0.587, 0.114)); }

void main() {
  vec2 c = v - 0.5;
  // The world breathes: about once every eight seconds.
  c /= 1.0 + 0.03 * u_int * sin(u_time * 0.78);
  // It flows.
  vec2 w = vec2(fbm(c * 3.0 + u_time * 0.05), fbm(c * 3.0 - u_time * 0.04 + 7.3)) - 0.5;
  c += w * (0.015 + 0.05 * u_int);
  // The kaleidoscope opens slowly.
  float r = length(c);
  float a = atan(c.y, c.x) + u_time * 0.02;
  float seg = 6.2831853 / 6.0;
  float ka = abs(mod(a, seg) - seg * 0.5);
  vec2 kc = vec2(cos(ka), sin(ka)) * r;
  c = mix(c, kc, u_kal);
  vec2 uv = c + 0.5;
  vec3 cam = texture2D(u_src, cover(uv)).rgb;
  // Flowing contours.
  float gx = luma(uv + vec2(u_texel.x, 0.0)) - luma(uv - vec2(u_texel.x, 0.0));
  float gy = luma(uv + vec2(0.0, u_texel.y)) - luma(uv - vec2(0.0, u_texel.y));
  float edge = smoothstep(0.05, 0.3, length(vec2(gx, gy)));
  // Liquid light: colour moving like oil in a dish on a projector.
  float n = fbm(c * 2.2 + vec2(u_time * 0.03, -u_time * 0.021) + w * 2.0);
  vec3 oil = hsv(vec3(fract(u_hue + n * 0.9 + u_time * 0.008), 0.7, 1.0));
  vec3 col = mix(cam, cam * oil * 1.7, 0.2 + 0.5 * u_int);
  col += oil * edge * (0.35 + 0.65 * u_int);
  // Trails: what was here a moment ago stays a little.
  vec3 prev = texture2D(u_prev, v + w * 0.003).rgb;
  col = mix(col, max(col, prev * 0.965), 0.45 + 0.4 * u_int);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const COPY = `
precision mediump float;
uniform sampler2D u_prev;
varying vec2 v;
void main() { gl_FragColor = texture2D(u_prev, v); }
`;

export interface Look {
  /** 0..1, grows the longer the mode runs. */
  intensity: number;
  /** 0..1, how far the kaleidoscope has opened. */
  kaleidoscope: number;
  /** The chapter's colour, 0..1 around the hue circle. */
  hue: number;
}

export class Shader {
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private copy: WebGLProgram;
  private src: WebGLTexture;
  private fb: { tex: WebGLTexture; fbo: WebGLFramebuffer }[] = [];
  private flip = 0;
  private w = 0;
  private h = 0;
  private srcW = 1;
  private srcH = 1;
  mirror = false;

  private constructor(readonly canvas: HTMLCanvasElement, gl: WebGLRenderingContext) {
    this.gl = gl;
    this.prog = program(gl, VERT, FRAG);
    this.copy = program(gl, VERT, COPY);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.src = texture(gl);
  }

  /** A shader on `canvas`, or null when this device has no WebGL. */
  static create(canvas: HTMLCanvasElement): Shader | null {
    try {
      const gl = canvas.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: false, antialias: false });
      if (!gl) return null;
      return new Shader(canvas, gl);
    } catch {
      return null;
    }
  }

  resize(w: number, h: number): void {
    const gl = this.gl;
    if (w === this.w && h === this.h) return;
    this.w = this.canvas.width = Math.max(2, Math.round(w));
    this.h = this.canvas.height = Math.max(2, Math.round(h));
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

  draw(time: number, look: Look): void {
    const gl = this.gl;
    if (!this.fb.length) return;
    const from = this.fb[this.flip];
    const to = this.fb[1 - this.flip];
    gl.viewport(0, 0, this.w, this.h);
    // Into the feedback buffer.
    gl.bindFramebuffer(gl.FRAMEBUFFER, to.fbo);
    gl.useProgram(this.prog);
    bindQuad(gl, this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.src);
    gl.uniform1i(gl.getUniformLocation(this.prog, 'u_src'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, from.tex);
    gl.uniform1i(gl.getUniformLocation(this.prog, 'u_prev'), 1);
    gl.uniform1f(gl.getUniformLocation(this.prog, 'u_time'), time);
    gl.uniform1f(gl.getUniformLocation(this.prog, 'u_int'), look.intensity);
    gl.uniform1f(gl.getUniformLocation(this.prog, 'u_kal'), look.kaleidoscope);
    gl.uniform1f(gl.getUniformLocation(this.prog, 'u_hue'), look.hue);
    gl.uniform1f(gl.getUniformLocation(this.prog, 'u_mirror'), this.mirror ? 1 : 0);
    // Cover the screen with the picture, cropping what does not fit.
    const sa = this.srcW / this.srcH;
    const da = this.w / this.h;
    gl.uniform2f(gl.getUniformLocation(this.prog, 'u_cover'), da < sa ? da / sa : 1, da < sa ? 1 : sa / da);
    gl.uniform2f(gl.getUniformLocation(this.prog, 'u_texel'), 1.5 / this.srcW, 1.5 / this.srcH);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // To the screen.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(this.copy);
    bindQuad(gl, this.copy);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, to.tex);
    gl.uniform1i(gl.getUniformLocation(this.copy, 'u_prev'), 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.flip = 1 - this.flip;
  }

  dispose(): void {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
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

function program(gl: WebGLRenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  for (const [type, src] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader');
    gl.attachShader(p, sh);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'program');
  return p;
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
