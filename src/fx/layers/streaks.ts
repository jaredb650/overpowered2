import * as THREE from 'three';
import { COMMON_VERT, OUTPUT_FRAG } from '../gpu/glsl';
import { InstanceRing } from '../gpu/ring';
import { quad } from '../gpu/shapes';
import { ORDER, type FxUniforms, type Rgb } from './shared';

/**
 * Sparks, debris streaks and embers: a screen-aligned sliver from the particle back along its own
 * velocity. Length comes from velocity rather than from dt, so a spark in SLOWMO is the same shape
 * as at full speed, only slower.
 *
 *   aP  origin xyz, birth      aV  velocity xyz, life
 *   aC  HDR colour rgb, width  aF  gravity, floor height, restitution, friction
 *   aR  trail seconds, max length, drag, turbulence
 */
const ATTRS = ['aP', 'aV', 'aC', 'aF', 'aR'] as const;

const VERT = /* glsl */ `
attribute vec4 aP;
attribute vec4 aV;
attribute vec4 aC;
attribute vec4 aF;
attribute vec4 aR;
varying vec3 vColor;
varying vec2 vUv;
uniform float uMinPx;
${COMMON_VERT}

void main() {
  float age = uTime - aP.w;
  float life = aV.w;
  if (age < 0.0 || age >= life) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float k = age / life;
  float sh = 1.0 - k;

  vec3 pos, vel;
  float moved, rest = 0.0;
  if (aR.z > 0.0) {
    pos = dragged(aP.xyz, aV.xyz, vec3(0.0, aF.x, 0.0), aR.z, age, vel);
    if (aR.w > 0.0) {
      // Embers wander: two out-of-phase sines are enough for a hot flake riding the air.
      float seed = float(gl_InstanceID) * 1.37;
      vec3 wobble = vec3(sin(age * 2.3 + seed), 0.0, cos(age * 1.7 + seed * 2.0)) * aR.w;
      pos += wobble * min(age, 1.0);
      vel += vec3(cos(age * 2.3 + seed) * 2.3, 0.0, -sin(age * 1.7 + seed * 2.0) * 1.7) * aR.w;
    }
  } else {
    pos = ballistic(aP.xyz, aV.xyz, aF.x, aF.y, aF.z, aF.w, age, vel, moved, rest);
  }

  float speed = length(vel);
  float len = min(speed * aR.x, aR.y);
  vec3 dir = speed > 0.001 ? vel / speed : vec3(0.0, 1.0, 0.0);
  vec3 tail = pos - dir * len * mix(0.4, 1.0, sh);

  mat4 vp = projectionMatrix * viewMatrix;
  vec4 ch = vp * vec4(pos, 1.0);
  vec4 ct = vp * vec4(tail, 1.0);
  if (ch.w < 0.05 || ct.w < 0.05) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 aspect = vec2(uRes.x / uRes.y, 1.0);
  vec2 d = (ch.xy / ch.w - ct.xy / ct.w) * aspect;
  float dl = length(d);
  d = dl > 1e-5 ? d / dl : vec2(0.0, 1.0);
  vec2 n = vec2(-d.y, d.x);

  // position.y: -1 tail, +1 head. position.x: side.
  float along = position.y * 0.5 + 0.5;
  vec4 c = mix(ct, ch, along);
  float depth = c.w;
  float width = max(aC.w, uPixelWorld * depth * uMinPx) * sh;
  float ndc = width / (uPixelWorld * depth) * 2.0 / uRes.y;
  c.xy += (n * position.x + d * position.y) * ndc / aspect * c.w;
  gl_Position = c;
  vColor = applyFog(aC.rgb, depth);
  vUv = vec2(position.x, along);
}
`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying vec2 vUv;
void main() {
  // Hard sliver: full width at the head, a point at the tail.
  float w = mix(0.05, 1.0, vUv.y);
  float a = 1.0 - smoothstep(w * 0.72, w, abs(vUv.x));
  if (a <= 0.003) discard;
  gl_FragColor = vec4(vColor * a, a);
  ${OUTPUT_FRAG}
}
`;

export class StreakLayer {
  readonly ring: InstanceRing;

  private birth = 0;
  private life = 0.5;
  private cr = 1;
  private cg = 1;
  private cb = 0;
  private gravity = -20;
  private floor = -1e6;
  private restitution = 0.4;
  private friction = 0.7;
  private trail = 0.02;
  private maxLen = 1;
  private drag = 0;
  private wander = 0;

  constructor(scene: THREE.Scene, uniforms: FxUniforms, cap = 5000) {
    this.ring = new InstanceRing(quad(), cap, ATTRS);
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { ...uniforms, uMinPx: { value: 1.25 } },
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
    mesh.renderOrder = ORDER.streaks;
    mesh.name = 'fx.streaks';
    this.ring.object = mesh;
    scene.add(mesh);
  }

  begin(
    color: Rgb, birth: number, life: number, gravity: number, floor: number,
    trail = 0.02, maxLen = 1, drag = 0, wander = 0, restitution = 0.42, friction = 0.7,
  ): this {
    this.cr = color.r;
    this.cg = color.g;
    this.cb = color.b;
    this.birth = birth;
    this.life = life;
    this.gravity = gravity > -0.01 ? -0.01 : gravity;
    this.floor = floor;
    this.trail = trail;
    this.maxLen = maxLen;
    this.drag = drag;
    this.wander = wander;
    this.restitution = restitution;
    this.friction = friction;
    return this;
  }

  setLife(life: number): void {
    this.life = life;
  }

  add(x: number, y: number, z: number, vx: number, vy: number, vz: number, width: number): void {
    const ring = this.ring;
    const d = ring.data;
    const o = ring.alloc(this.birth + this.life);
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = z;
    d[o + 3] = this.birth;
    d[o + 4] = vx;
    d[o + 5] = vy;
    d[o + 6] = vz;
    d[o + 7] = this.life;
    d[o + 8] = this.cr;
    d[o + 9] = this.cg;
    d[o + 10] = this.cb;
    d[o + 11] = width;
    d[o + 12] = this.gravity;
    d[o + 13] = this.floor;
    d[o + 14] = this.restitution;
    d[o + 15] = this.friction;
    d[o + 16] = this.trail;
    d[o + 17] = this.maxLen;
    d[o + 18] = this.drag;
    d[o + 19] = this.wander;
  }

  sync(now: number): void {
    this.ring.sync(now);
  }
}
