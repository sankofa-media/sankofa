// The acid colour of the page: a full-screen field of domain-warped noise in
// magenta, electric cyan, lime and orange, its hues drifting round over
// seconds (never a strobe), turning to bruise and bile in the dark chapters
// and to gold in the reassembly. At the peak a kaleidoscope tunnel opens in
// it, built from the chapter's own picture, with an eye at its end. One
// WebGL canvas behind the text; a copy of it is laid over the page with a
// blend mode. Without WebGL a 2D canvas paints softer blobs instead.

const VERT = `
attribute vec2 a;
varying vec2 v;
void main() { v = a * 0.5 + 0.5; gl_Position = vec4(a, 0.0, 1.0); }
`;

const FRAG = `
precision mediump float;
uniform float u_time;
uniform float u_hue;
uniform float u_warp;
uniform float u_dark;
uniform float u_warm;
uniform float u_tunnel;
uniform float u_oct;
uniform float u_pic_on;
uniform vec2 u_res;
uniform vec3 u_eye;
uniform sampler2D u_pic;
varying vec2 v;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0; float a = 0.5;
  for (int k = 0; k < 6; k++) {
    if (float(k) >= u_oct) break;
    s += a * noise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p; a *= 0.5;
  }
  return s;
}
// Magenta, electric cyan, lime, orange, round and round.
vec3 acid(float x) {
  x = fract(x) * 4.0;
  vec3 m = vec3(1.0, 0.08, 0.86);
  vec3 c = vec3(0.0, 0.95, 1.0);
  vec3 l = vec3(0.62, 1.0, 0.0);
  vec3 o = vec3(1.0, 0.45, 0.0);
  float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  if (x < 1.0) return mix(m, c, f);
  if (x < 2.0) return mix(c, l, f);
  if (x < 3.0) return mix(l, o, f);
  return mix(o, m, f);
}

void main() {
  float asp = u_res.x / max(1.0, u_res.y);
  vec2 p = (v - 0.5) * vec2(asp, 1.0) * 2.4;
  float t = u_time;
  vec2 q = vec2(fbm(p + vec2(0.0, t * 0.05)), fbm(p + vec2(5.2, 1.3) - t * 0.043));
  vec2 r = vec2(fbm(p + 3.8 * q * u_warp + vec2(1.7, 9.2) + t * 0.071), fbm(p + 3.8 * q * u_warp + vec2(8.3, 2.8) - t * 0.063));
  float f = fbm(p + 4.2 * r * u_warp);
  float x = f * 1.7 + length(q) * 0.7 + u_hue;
  vec3 col = acid(x);
  // Oil on a projector dish: bright where the layers fold.
  col *= 0.5 + 0.8 * smoothstep(0.15, 0.85, f);
  col += 0.35 * acid(x + 0.5) * pow(smoothstep(0.55, 0.0, abs(r.x - q.y)), 6.0);
  // The dark: near black, bruised purple, and veins of bile green and violet glowing through it, crawling.
  float vr = fbm(p * 2.6 + r * 2.4 - vec2(0.0, t * 0.09));
  float vein = pow(1.0 - abs(2.0 * vr - 1.0), 9.0);
  float vein2 = pow(1.0 - abs(2.0 * fbm(p * 4.1 - q * 3.0 + t * 0.05) - 1.0), 14.0);
  vec3 bruise = mix(vec3(0.01, 0.0, 0.02), vec3(0.24, 0.03, 0.3), smoothstep(0.35, 0.95, f));
  bruise += vein * mix(vec3(0.55, 0.85, 0.05), vec3(0.75, 0.15, 0.95), smoothstep(0.3, 0.7, q.x)) * (0.75 + 0.25 * sin(t * 0.7 + f * 6.0));
  bruise += vein2 * vec3(0.9, 0.2, 0.6) * 0.6;
  col = mix(col, bruise, u_dark * 0.8);
  // The warm reassembly.
  vec3 gold = mix(vec3(0.6, 0.12, 0.08), vec3(1.0, 0.78, 0.3), smoothstep(0.2, 0.9, f)) + vec3(1.0, 0.9, 0.6) * pow(smoothstep(0.55, 0.0, abs(r.x - q.y)), 5.0) * 0.5;
  col = mix(col, gold, u_warm * 0.85);
  // The tunnel: the chapter's picture folded into a kaleidoscope, falling away.
  if (u_tunnel > 0.001) {
    vec2 c = (v - 0.5) * vec2(asp, 1.0);
    c += (q - 0.5) * 0.05;
    float rr = length(c);
    float an = atan(c.y, c.x) + t * 0.06;
    float seg = 6.2831853 / 8.0;
    an = abs(mod(an, seg) - seg * 0.5);
    float depth = 0.32 / max(rr, 0.015) + t * 0.22;
    vec2 tuv = vec2(an / seg * 1.6 + 0.1, fract(depth));
    float pic = u_pic_on * texture2D(u_pic, tuv).a;
    float rings = smoothstep(0.42, 0.5, abs(fract(depth * 1.5) - 0.5));
    vec3 tc = acid(depth * 0.25 + u_hue) * (0.3 + 0.9 * pic) + rings * 0.35 * acid(depth * 0.25 + u_hue + 0.5);
    tc *= smoothstep(0.0, 0.22, rr) + 0.25;
    // The eye at the end of the tunnel: it opens, and it looks at the reader.
    vec2 e = c / 0.15;
    float lid = (1.0 - e.x * e.x) * 0.55 * u_eye.z;
    float white = smoothstep(0.09, -0.02, abs(e.y) - lid) * smoothstep(1.02, 0.9, abs(e.x));
    vec2 pup = e - u_eye.xy * vec2(0.45, 0.2);
    float pr = length(pup);
    float pa = atan(pup.y, pup.x);
    float iris = smoothstep(0.46, 0.4, pr);
    float dil = 0.15 + 0.05 * sin(t * 0.9);
    float pupil = smoothstep(dil + 0.03, dil, pr);
    float veins = pow(1.0 - abs(2.0 * noise(vec2(pa * 3.0, pr * 6.0 - t * 0.2)) - 1.0), 10.0) * smoothstep(0.4, 1.0, pr);
    vec3 eye = mix(vec3(0.92, 0.86, 0.78), vec3(0.85, 0.08, 0.1), veins * 0.8);
    vec3 irisCol = acid(u_hue + pr * 1.5 + 0.08 * sin(pa * 24.0)) * (0.6 + 0.4 * sin(pa * 36.0 + pr * 20.0));
    eye = mix(eye, irisCol, iris);
    eye = mix(eye, vec3(0.01, 0.0, 0.02), pupil);
    tc = mix(tc, eye, white * smoothstep(0.0, 0.6, u_tunnel));
    col = mix(col, tc, u_tunnel * 0.9);
  }
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

export interface FieldLook {
  time: number;
  /** Where the hue circle stands (grows by the look's hue speed). */
  hue: number;
  warp: number;
  dark: number;
  warm: number;
  tunnel: number;
  octaves: number;
  /** The eye: where the pupil looks (-1..1) and how open it is (0..1). */
  eye: [number, number, number];
}

export type FieldKind = 'webgl2' | 'webgl' | '2d' | 'none';

export class AcidField {
  readonly canvas: HTMLCanvasElement;
  readonly kind: FieldKind;
  private gl: WebGLRenderingContext | null = null;
  private g2: CanvasRenderingContext2D | null = null;
  private prog: WebGLProgram | null = null;
  private pic: WebGLTexture | null = null;
  private picOn = 0;
  private loc = new Map<string, WebGLUniformLocation | null>();
  w = 0;
  h = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    let kind: FieldKind = 'none';
    try {
      const opts = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'low-power' } as const;
      const gl2 = this.canvas.getContext('webgl2', opts) as WebGLRenderingContext | null;
      const gl = gl2 ?? (this.canvas.getContext('webgl', opts) as WebGLRenderingContext | null);
      if (gl) {
        this.gl = gl;
        this.prog = program(gl, VERT, FRAG);
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        gl.useProgram(this.prog);
        const la = gl.getAttribLocation(this.prog, 'a');
        gl.enableVertexAttribArray(la);
        gl.vertexAttribPointer(la, 2, gl.FLOAT, false, 0, 0);
        this.pic = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.pic);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
        for (const [k, val] of [[gl.TEXTURE_WRAP_S, gl.REPEAT], [gl.TEXTURE_WRAP_T, gl.REPEAT], [gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR]] as const) gl.texParameteri(gl.TEXTURE_2D, k, val);
        kind = gl2 ? 'webgl2' : 'webgl';
      }
    } catch {
      this.gl = null;
    }
    if (!this.gl) {
      this.canvas = document.createElement('canvas');
      this.g2 = this.canvas.getContext('2d');
      kind = this.g2 ? '2d' : 'none';
    }
    this.kind = kind;
  }

  resize(w: number, h: number): void {
    w = Math.max(8, Math.round(w));
    h = Math.max(8, Math.round(h));
    if (w === this.w && h === this.h) return;
    this.w = this.canvas.width = w;
    this.h = this.canvas.height = h;
  }

  /** The chapter's picture for the tunnel (a power-of-two canvas, ink on transparent). */
  picture(src: HTMLCanvasElement | null): void {
    const gl = this.gl;
    if (!gl || !this.pic) return;
    gl.bindTexture(gl.TEXTURE_2D, this.pic);
    if (src) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    this.picOn = src ? 1 : 0;
  }

  private u(name: string): WebGLUniformLocation | null {
    if (!this.loc.has(name)) this.loc.set(name, this.gl!.getUniformLocation(this.prog!, name));
    return this.loc.get(name)!;
  }

  draw(l: FieldLook): void {
    if (this.gl && this.prog) return this.drawGl(l);
    if (this.g2) this.draw2d(l);
  }

  private drawGl(l: FieldLook): void {
    const gl = this.gl!;
    gl.viewport(0, 0, this.w, this.h);
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.pic);
    gl.uniform1i(this.u('u_pic'), 0);
    gl.uniform1f(this.u('u_time'), l.time);
    gl.uniform1f(this.u('u_hue'), l.hue);
    gl.uniform1f(this.u('u_warp'), 0.35 + 0.65 * l.warp);
    gl.uniform1f(this.u('u_dark'), l.dark);
    gl.uniform1f(this.u('u_warm'), l.warm);
    gl.uniform1f(this.u('u_tunnel'), l.tunnel);
    gl.uniform1f(this.u('u_oct'), l.octaves);
    gl.uniform1f(this.u('u_pic_on'), this.picOn);
    gl.uniform2f(this.u('u_res'), this.w, this.h);
    gl.uniform3f(this.u('u_eye'), l.eye[0], l.eye[1], l.eye[2]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** Without WebGL: big soft blobs of the same colours, drifting and turning. */
  private draw2d(l: FieldLook): void {
    const g = this.g2!;
    const { w, h } = this;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = l.dark > 0.5 ? '#07020a' : '#140818';
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'lighter';
    const hues = [310, 185, 85, 30];
    for (let i = 0; i < 6; i++) {
      const a = l.time * (0.05 + i * 0.013) + i * 1.7;
      const x = w * (0.5 + 0.42 * Math.sin(a * 1.3 + i));
      const y = h * (0.5 + 0.42 * Math.cos(a + i * 2.1));
      const r = Math.max(w, h) * (0.35 + 0.1 * Math.sin(a * 0.7));
      const hue = (hues[i % 4] + l.hue * 360) % 360;
      const sat = 100 * (1 - l.dark * 0.6);
      const light = 50 * (1 - l.dark * 0.7) + l.warm * 10;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `hsla(${l.warm > 0.5 ? 35 : hue}, ${sat}%, ${light}%, 0.55)`);
      grad.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    }
    g.globalCompositeOperation = 'source-over';
  }

  dispose(): void {
    (this.gl?.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext();
  }
}

/**
 * The chapter's picture as ink on a transparent power-of-two canvas, for the
 * tunnel: a real picture is drawn as it is; a drawn placeholder (an SVG) is
 * serialised with its lines made solid.
 */
export async function rasterise(el: Element | null, size = 256): Promise<HTMLCanvasElement | null> {
  if (!el) return null;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) return null;
  const img = el.querySelector('img');
  try {
    if (img && img.complete && img.naturalWidth) {
      g.drawImage(img, 0, 0, size, size);
      return c;
    }
    const svg = (el instanceof SVGSVGElement ? el : el.querySelector('svg')) as SVGSVGElement | null;
    if (!svg) return null;
    const copy = svg.cloneNode(true) as SVGSVGElement;
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    copy.setAttribute('width', String(size));
    copy.setAttribute('height', String(size));
    copy.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = 'path,circle,ellipse,line,polyline{fill:none;stroke:#fff;stroke-width:3;stroke-dasharray:none!important;stroke-dashoffset:0!important}.ink-paper,rect{fill:none;stroke:none}.ink-blot,.ink-dot{fill:#fff;stroke:none;transform:none}';
    copy.prepend(style);
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }));
    try {
      const im = new Image();
      im.src = url;
      await im.decode();
      g.drawImage(im, 0, 0, size, size);
    } finally {
      URL.revokeObjectURL(url);
    }
    return c;
  } catch {
    return null;
  }
}

export function program(gl: WebGLRenderingContext, vs: string, fs: string): WebGLProgram {
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
