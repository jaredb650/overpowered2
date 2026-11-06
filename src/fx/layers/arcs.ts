import * as THREE from 'three';
import { COMMON_VERT, OUTPUT_FRAG } from '../gpu/glsl';
import { InstanceRing } from '../gpu/ring';
import { ORDER, type FxUniforms, type Rgb } from './shared';

/**
 * Lightning. The whole bolt shape is a hash of (seed, segment, flicker step) in the vertex shader, so
 * an arc costs one record to emit and re-strikes on its own.
 *
 *   aA  from xyz, birth     aB  to xyz, life
 *   aC  HDR colour rgb, width
 *   aS  seed, jaggedness (fraction of length), flicker rate per second, core gain
 */
const ATTRS = ['aA', 'aB', 'aC', 'aS'] as const;
const STATIONS = 24;

const VERT = /* glsl */ `
attribute vec4 aA;
attribute vec4 aB;
attribute vec4 aC;
attribute vec4 aS;
varying vec3 vColor;
varying float vX;
varying float vCore;
${COMMON_VERT}

vec3 jitter(float i, float step, float seed) {
  return vec3(hash21(vec2(i * 1.7 + seed, step)), hash21(vec2(i * 3.1 + seed, step + 11.0)),
              hash21(vec2(i * 5.3 + seed, step + 23.0))) - 0.5;
}

vec3 strand(float t, float step, float seed, float amp, vec3 u, vec3 v) {
  // Two octaves of piecewise-linear noise, pinned to zero at both ends so the bolt lands on its targets.
  float a = t * 7.0;
  float ia = floor(a);
  vec3 lo = mix(jitter(ia, step, seed), jitter(ia + 1.0, step, seed), a - ia);
  float b = t * 23.0;
  float ib = floor(b);
  vec3 hi = mix(jitter(ib + 40.0, step, seed), jitter(ib + 41.0, step, seed), b - ib);
  vec3 o = lo + hi * 0.38;
  float env = sin(t * 3.14159265);
  env = sqrt(max(env, 0.0));
  return (u * o.x + v * o.y) * amp * env;
}

void main() {
  float age = uTime - aA.w;
  float life = aB.w;
  if (age < 0.0 || age >= life) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float k = age / life;
  vec3 span = aB.xyz - aA.xyz;
  float dist = length(span);
  vec3 dir = span / max(dist, 1e-4);
  vec3 ref = abs(dir.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 u = normalize(cross(ref, dir));
  vec3 v = cross(dir, u);

  float t = position.y;
  float dt = 1.0 / ${STATIONS.toFixed(1)};
  float step = floor(uTime * aS.z);
  float amp = aS.y * dist;
  vec3 p0 = aA.xyz + span * t + strand(t, step, aS.x, amp, u, v);
  float t1 = min(t + dt, 1.0);
  float t0 = max(t - dt, 0.0);
  vec3 pn = aA.xyz + span * t1 + strand(t1, step, aS.x, amp, u, v);
  vec3 pp = aA.xyz + span * t0 + strand(t0, step, aS.x, amp, u, v);

  mat4 vp = projectionMatrix * viewMatrix;
  vec4 c = vp * vec4(p0, 1.0);
  vec4 cn = vp * vec4(pn, 1.0);
  vec4 cp = vp * vec4(pp, 1.0);
  if (c.w < 0.05 || cn.w < 0.05 || cp.w < 0.05) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 aspect = vec2(uRes.x / uRes.y, 1.0);
  vec2 d = (cn.xy / cn.w - cp.xy / cp.w) * aspect;
  float dl = length(d);
  d = dl > 1e-6 ? d / dl : vec2(1.0, 0.0);
  vec2 n = vec2(-d.y, d.x);
  float depth = c.w;
  float w = max(aC.w * (1.0 - k * k), uPixelWorld * depth * 1.2);
  // Thin toward the far end, like a discharge running out of charge.
  w *= mix(1.0, 0.45, t);
  float ndc = w / (uPixelWorld * depth) * 2.0 / uRes.y;
  c.xy += n * position.x * ndc / aspect * c.w;
  gl_Position = c;
  vColor = aC.rgb;
  vX = position.x;
  vCore = aS.w;
}
`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vX;
varying float vCore;
void main() {
  float x = abs(vX);
  float a = 1.0 - smoothstep(0.7, 1.0, x);
  float core = 1.0 - smoothstep(0.2, 0.5, x);
  gl_FragColor = vec4(mix(vColor, vec3(vCore), core) * a, 0.0);
  ${OUTPUT_FRAG}
}
`;

function strip(): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= STATIONS; i++) {
    const t = i / STATIONS;
    pos.push(-1, t, 0, 1, t, 0);
    if (i < STATIONS) {
      const b = i * 2;
      idx.push(b, b + 1, b + 3, b, b + 3, b + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export class ArcLayer {
  readonly ring: InstanceRing;

  constructor(scene: THREE.Scene, uniforms: FxUniforms, cap = 192) {
    this.ring = new InstanceRing(strip(), cap, ATTRS);
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { ...uniforms },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    });
    const mesh = new THREE.Mesh(this.ring.geometry, material);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = ORDER.arcs;
    mesh.name = 'fx.arcs';
    this.ring.object = mesh;
    scene.add(mesh);
  }

  add(
    ax: number, ay: number, az: number, bx: number, by: number, bz: number, color: Rgb, width: number,
    birth: number, life: number, jagged: number, rate: number, coreGain: number,
  ): void {
    const d = this.ring.data;
    const o = this.ring.alloc(birth + life);
    d[o] = ax;
    d[o + 1] = ay;
    d[o + 2] = az;
    d[o + 3] = birth;
    d[o + 4] = bx;
    d[o + 5] = by;
    d[o + 6] = bz;
    d[o + 7] = life;
    d[o + 8] = color.r;
    d[o + 9] = color.g;
    d[o + 10] = color.b;
    d[o + 11] = width;
    d[o + 12] = Math.random() * 100;
    d[o + 13] = jagged;
    d[o + 14] = rate;
    d[o + 15] = coreGain;
  }

  sync(now: number): void {
    this.ring.sync(now);
  }
}
