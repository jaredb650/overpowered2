import * as THREE from 'three';
import { COMMON_VERT, OUTPUT_FRAG } from '../gpu/glsl';
import { FIRE } from '../palette';
import { ORDER, type FxUniforms } from './shared';

/**
 * The Kiln's stream: one camera-facing ribbon through the chain of napalm globs, rebuilt on the CPU each frame it is
 * fired. Unlike the particle rings this is the shape of the whole hose at once, so it bends as the aim swings and the
 * liquid in it is one rope, not a row of puffs. One draw call, and none while nothing is in the air.
 *
 * The texture rides on the glob serial, so the burning liquid is seen to move with the stream. A fresh stretch is a
 * narrow white-hot rope; an old one is wide, torn and red, the fire that wraps it having taken over.
 *
 *   position  world xyz        aS  across (-1..1), glob serial, age seconds, unused
 */
const SUB = 3;
/** Chain points the ribbon can take: every glob and the nozzle. */
const MAX_IN = 74;
const MAX_OUT = MAX_IN * SUB;
const STRIDE = 6;

const VERT = /* glsl */ `
attribute vec4 aS;
varying vec4 vS;
varying float vFog;
${COMMON_VERT}

void main() {
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * view;
  float d = -view.z;
  vFog = (1.0 - exp(-uFogDensity * uFogDensity * d * d)) * uFogAmount;
  vS = aS;
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uFogColor;
uniform vec3 uRed;
uniform vec3 uOrange;
uniform vec3 uAmber;
uniform vec3 uYellow;
varying vec4 vS;
varying float vFog;

float hash21(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0)), c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  float x = abs(vS.x);
  float k = clamp(vS.z / 1.15, 0.0, 1.0);
  // Rides with the liquid (one glob is a thirtieth of a second of hose), and boils in place on top of that.
  float n = vnoise(vec2(vS.y * 0.7, vS.x * 1.6)) * 0.55
    + vnoise(vec2(vS.y * 1.9 - uTime * 6.0, vS.x * 3.1 + uTime * 2.3)) * 0.3
    + vnoise(vec2(vS.y * 4.3, vS.x * 6.0 - uTime * 9.0)) * 0.15;
  // A smooth rope at the nozzle that tears at the edges as it ages and breaks up.
  float edge = mix(0.9, 0.55, k) + (n - 0.5) * mix(0.35, 1.1, k);
  float a = 1.0 - smoothstep(edge - mix(0.18, 0.3, k), edge, x);
  if (a <= 0.004) discard;

  float core = 1.0 - smoothstep(0.0, mix(0.55, 0.12, k), x + (0.5 - n) * 0.25);
  vec3 col = mix(uOrange, uAmber, smoothstep(0.35, 0.7, n));
  col = mix(col, uRed, smoothstep(0.55, 1.0, k) * (1.0 - n));
  col = mix(col, uYellow, core);
  // The liquid itself, white hot down the middle of the fresh stretch.
  col += vec3(4.0, 3.2, 2.0) * core * core * (1.0 - k) * (1.0 - k);
  col *= mix(1.0, 0.6, k * k);
  a *= 1.0 - smoothstep(1.6, 2.1, vS.z);
  col = mix(col, uFogColor, vFog);
  // Mostly light: it covers a little of what is behind it, so a stream crossing a bright sky still reads.
  gl_FragColor = vec4(col * a, a * 0.45);
  ${OUTPUT_FRAG}
}
`;

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _t = new THREE.Vector3();
const _e = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Catmull-Rom on one axis. */
function cr(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t2 * t);
}

/** Metres across, by age: a rope out of the nozzle that spreads as it flies. */
export function hoseWidth(age: number): number {
  return 0.09 + 0.55 * Math.min(1, age / 1.1) ** 0.8;
}

export class HoseLayer {
  readonly mesh: THREE.Mesh;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly pos = new Float32Array(MAX_OUT * 2 * 3);
  private readonly strip = new Float32Array(MAX_OUT * 2 * 4);
  private readonly index = new Uint16Array(MAX_OUT * 6);
  /** The resampled centre line, x y z age serial per point. */
  private readonly line = new Float32Array(MAX_OUT * 5);
  private count = 0;

  constructor(scene: THREE.Scene, uniforms: FxUniforms) {
    const g = this.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aS', new THREE.BufferAttribute(this.strip, 4).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(this.index, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        ...uniforms,
        uRed: { value: new THREE.Vector3(FIRE.red.r, FIRE.red.g, FIRE.red.b) },
        uOrange: { value: new THREE.Vector3(FIRE.orange.r, FIRE.orange.g, FIRE.orange.b).multiplyScalar(1.3) },
        uAmber: { value: new THREE.Vector3(FIRE.amber.r, FIRE.amber.g, FIRE.amber.b).multiplyScalar(1.5) },
        uYellow: { value: new THREE.Vector3(FIRE.yellow.r, FIRE.yellow.g, FIRE.yellow.b) },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    const mesh = (this.mesh = new THREE.Mesh(g, material));
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = ORDER.hose;
    mesh.name = 'fx.hose';
    scene.add(mesh);
  }

  /** Rebuilds the ribbon from `chain` (see FxSystem.hose), facing `eye`. */
  draw(chain: Float32Array, count: number, eye: THREE.Vector3): void {
    const n = Math.min(count, MAX_IN);
    let verts = 0;
    let tris = 0;
    let s = 0;
    while (s < n) {
      let e = s + 1;
      while (e < n && chain[e * STRIDE + 5]! === 0) e++;
      if (e - s >= 2) {
        const m = this.resample(chain, s, e);
        const r = this.ribbon(m, verts, tris, eye);
        verts = r[0];
        tris = r[1];
      }
      s = e;
    }
    this.count = tris;
    const g = this.geometry;
    g.setDrawRange(0, tris * 3);
    this.mesh.visible = tris > 0;
    if (tris === 0) return;
    const pa = g.getAttribute('position') as THREE.BufferAttribute;
    const sa = g.getAttribute('aS') as THREE.BufferAttribute;
    pa.clearUpdateRanges();
    pa.addUpdateRange(0, verts * 3);
    pa.needsUpdate = true;
    sa.clearUpdateRanges();
    sa.addUpdateRange(0, verts * 4);
    sa.needsUpdate = true;
    const ia = g.index!;
    ia.clearUpdateRanges();
    ia.addUpdateRange(0, tris * 3);
    ia.needsUpdate = true;
  }

  /** One strand, chain points s..e-1, through Catmull-Rom into `line`. Returns its point count. */
  private resample(chain: Float32Array, s: number, e: number): number {
    const L = this.line;
    let m = 0;
    const at = (i: number, k: number) => chain[Math.min(Math.max(i, s), e - 1) * STRIDE + k]!;
    for (let i = s; i < e - 1; i++) {
      for (let j = 0; j < SUB; j++) {
        const t = j / SUB;
        const o = m * 5;
        if (o + 5 > L.length) return m;
        for (let k = 0; k < 3; k++) L[o + k] = cr(at(i - 1, k), at(i, k), at(i + 1, k), at(i + 2, k), t);
        L[o + 3] = at(i, 3) + (at(i + 1, 3) - at(i, 3)) * t;
        L[o + 4] = at(i, 4) + (at(i + 1, 4) - at(i, 4)) * t;
        m++;
      }
    }
    const o = m * 5;
    if (o + 5 <= L.length) {
      for (let k = 0; k < 5; k++) L[o + k] = at(e - 1, k);
      m++;
    }
    return m;
  }

  private readonly out: [number, number] = [0, 0];

  private ribbon(m: number, verts: number, tris: number, eye: THREE.Vector3): [number, number] {
    const L = this.line;
    const P = this.pos;
    const S = this.strip;
    const I = this.index;
    const first = verts;
    for (let i = 0; i < m && verts + 2 <= MAX_OUT * 2; i++) {
      const o = i * 5;
      _p.set(L[o]!, L[o + 1]!, L[o + 2]!);
      const a = Math.max(0, i - 1) * 5;
      const b = Math.min(m - 1, i + 1) * 5;
      _t.set(L[b]! - L[a]!, L[b + 1]! - L[a + 1]!, L[b + 2]! - L[a + 2]!);
      _e.subVectors(eye, _p);
      _s.crossVectors(_t, _e);
      const len = _s.length();
      if (len < 1e-6) _s.set(0, 1, 0);
      else _s.multiplyScalar(1 / len);
      const age = L[o + 3]!;
      // The open end tapers off instead of stopping square.
      const tip = i === m - 1 ? 0.35 : 1;
      const w = hoseWidth(age) * 0.5 * tip;
      for (let side = -1; side <= 1; side += 2) {
        _q.copy(_p).addScaledVector(_s, w * side);
        P[verts * 3] = _q.x;
        P[verts * 3 + 1] = _q.y;
        P[verts * 3 + 2] = _q.z;
        S[verts * 4] = side;
        S[verts * 4 + 1] = L[o + 4]!;
        S[verts * 4 + 2] = age;
        S[verts * 4 + 3] = 0;
        verts++;
      }
    }
    for (let v = first; v + 3 < verts && tris + 2 <= MAX_OUT * 2; v += 2) {
      I[tris * 3] = v;
      I[tris * 3 + 1] = v + 1;
      I[tris * 3 + 2] = v + 2;
      I[tris * 3 + 3] = v + 1;
      I[tris * 3 + 4] = v + 3;
      I[tris * 3 + 5] = v + 2;
      tris += 2;
    }
    this.out[0] = verts;
    this.out[1] = tris;
    return this.out;
  }

  /** Shown with one empty triangle, so its program is asked about at load and not on the first squeeze. */
  warm(): void {
    if (this.count > 0) return;
    this.index.fill(0, 0, 3);
    this.geometry.setDrawRange(0, 3);
    this.mesh.visible = true;
  }

  /** Hides it again after a warm frame. A drawn hose stays up until the next draw, so pause and hit-stop hold it. */
  sync(): void {
    if (this.count === 0) this.mesh.visible = false;
  }

  clear(): void {
    this.count = 0;
    this.geometry.setDrawRange(0, 0);
    this.mesh.visible = false;
  }
}
