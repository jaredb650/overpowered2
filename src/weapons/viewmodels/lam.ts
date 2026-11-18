/**
 * A laser module's visible beam (a fitted mod's `ModLook.laser`): a thin red line from the emitter down the bore into the world,
 * fading out over `LAM.range`, and a small bright dot where it meets a wall within it, as a laser pointer's does. Looks only: the
 * shot still goes to the crosshair. Added, so a lit wall washes it out and a dark room shows it. One ray a gun a frame; every
 * beam and dot is a quad in one mesh with one material; no light. First person only: other players' guns show none.
 */
import * as THREE from 'three';
import type { RayHit } from '../../core/contracts';

export const LAM = {
  /** How far the ray looks for a wall, metres; the beam fades out over it. */
  range: 40,
  /** Linear colour, past 1 for the bloom: the emitter's red. */
  color: [1.8, 0.16, 0.04],
  /** The beam's brightness, low so it reads as a haze line, and the dot's. */
  beam: 0.3,
  dot: 1,
  /** Beam width at the emitter and the dot's radius, metres, and the fewest pixels each is drawn at. */
  width: 0.0012,
  widthPx: 1.2,
  radius: 0.02,
  radiusPx: 6.5,
} as const;

export type LaserCast = (from: THREE.Vector3, dir: THREE.Vector3, max: number, out: RayHit) => boolean;

/** Where a beam from `from` along unit `dir` ends, into `end`: on the first wall within LAM.range (true: the dot shows), else at the range's end. */
export function laserEnd(from: THREE.Vector3, dir: THREE.Vector3, cast: LaserCast, hit: RayHit, end: THREE.Vector3): boolean {
  // A stand-in physics answers with a proxy, not a boolean: no wall.
  if (cast(from, dir, LAM.range, hit) === true) {
    end.copy(hit.point);
    return true;
  }
  end.copy(from).addScaledVector(dir, LAM.range);
  return false;
}

const VERT = /* glsl */ `
attribute vec4 aA;
attribute vec4 aB;
uniform vec2 uRes;
uniform float uPixelWorld;
varying vec2 vUv;
varying float vAlong;
varying float vPixel;
varying float vStrength;
varying float vDot;
void main() {
  vStrength = aA.w;
  vDot = aB.w < 0.0 ? 1.0 : 0.0;
  vUv = position.xy;
  vAlong = 0.0;
  vPixel = 0.0;
  if (aA.w <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  if (aB.w < 0.0) {
    // The dot: a quad facing the eye, never under a few pixels across.
    vec4 v = viewMatrix * vec4(aA.xyz, 1.0);
    v.xy += position.xy * max(${LAM.radius}, uPixelWorld * -v.z * ${LAM.radiusPx});
    gl_Position = projectionMatrix * v;
    return;
  }
  // The beam: a screen-facing strip from A to B, a pixel or so wide however far (fx/layers/lines.ts does the same).
  vec4 va = viewMatrix * vec4(aA.xyz, 1.0);
  vec4 vb = viewMatrix * vec4(aB.xyz, 1.0);
  const float nearZ = -0.05;
  if (vb.z > nearZ) vb = mix(vb, va, (nearZ - vb.z) / (va.z - vb.z));
  vec4 ca = projectionMatrix * va;
  vec4 cb = projectionMatrix * vb;
  vec2 aspect = vec2(uRes.x / uRes.y, 1.0);
  vec2 d = (cb.xy / cb.w - ca.xy / ca.w) * aspect;
  float dl = length(d);
  d = dl > 1e-6 ? d / dl : vec2(1.0, 0.0);
  vec2 n = vec2(-d.y, d.x);
  float along = position.y * 0.5 + 0.5;
  vec4 c = mix(ca, cb, along);
  float w = max(${LAM.width}, uPixelWorld * c.w * ${LAM.widthPx});
  float px = w / (uPixelWorld * c.w);
  float quadPx = px + 1.0;
  c.xy += n * position.x * (quadPx * 2.0 / uRes.y) / aspect * c.w;
  gl_Position = c;
  vUv.x = position.x * quadPx / px;
  vAlong = along * aB.w;
  vPixel = 1.0 / px;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
varying vec2 vUv;
varying float vAlong;
varying float vPixel;
varying float vStrength;
varying float vDot;
void main() {
  vec3 col;
  if (vDot > 0.5) {
    float r = length(vUv);
    if (r > 1.0) discard;
    // A hot pinpoint in a red halo.
    col = uColor * exp(-r * r * 5.0) * 1.3 + vec3(1.0, 0.6, 0.45) * smoothstep(0.38, 0.0, r) * 3.0;
  } else {
    float x = abs(vUv.x);
    float cover = 1.0 - smoothstep(1.0 - vPixel * 0.5, 1.0 + vPixel * 0.5, x);
    if (cover <= 0.003) discard;
    // Brightest at the emitter, gone at the range's end.
    float fade = (1.0 - vAlong) * (1.0 - vAlong);
    col = uColor * cover * fade * (0.55 + 0.45 * (1.0 - x));
  }
  gl_FragColor = vec4(col * vStrength, 0.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Slots: the gun in the right hand, and the akimbo twin in the left. */
const SLOTS = 2;
const _hit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'concrete', collider: null };
const _end = new THREE.Vector3();
const _dot = new THREE.Vector3();

export class LamBeams {
  readonly mesh: THREE.Mesh;
  private readonly aA: THREE.BufferAttribute;
  private readonly aB: THREE.BufferAttribute;
  private readonly on = new Array<boolean>(SLOTS).fill(false);

  constructor() {
    // Per slot two quads, its beam then its dot.
    const quads = SLOTS * 2;
    const corners = [-1, -1, 1, -1, 1, 1, -1, 1];
    const position = new Float32Array(quads * 12);
    const index: number[] = [];
    for (let q = 0; q < quads; q++) {
      for (let v = 0; v < 4; v++) position.set([corners[v * 2]!, corners[v * 2 + 1]!, 0], (q * 4 + v) * 3);
      const o = q * 4;
      index.push(o, o + 1, o + 2, o, o + 2, o + 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    this.aA = new THREE.BufferAttribute(new Float32Array(quads * 16), 4).setUsage(THREE.DynamicDrawUsage);
    this.aB = new THREE.BufferAttribute(new Float32Array(quads * 16), 4).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aA', this.aA);
    geometry.setAttribute('aB', this.aB);
    geometry.setIndex(index);
    const uRes = { value: new THREE.Vector2(1280, 720) };
    const uPixelWorld = { value: 0.002 };
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uRes, uPixelWorld, uColor: { value: new THREE.Vector3(...LAM.color) } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'viewmodel.lam';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    // Drawn with the tracers' beams (fx/layers/shared.ts ORDER.beams).
    this.mesh.renderOrder = 22;
    // The pixel floor is the camera's, read as it draws.
    this.mesh.onBeforeRender = (renderer, _scene, camera) => {
      renderer.getDrawingBufferSize(uRes.value);
      uPixelWorld.value = 2 / (uRes.value.y * ((camera as THREE.PerspectiveCamera).projectionMatrix.elements[5] ?? 1));
    };
  }

  /** Slot `slot`'s beam from `from` along unit `dir` at `strength`, out to the first wall `cast` finds (its dot there) or the range. */
  aim(slot: number, from: THREE.Vector3, dir: THREE.Vector3, strength: number, cast: LaserCast): void {
    const wall = laserEnd(from, dir, cast, _hit, _end);
    this.write(slot * 2, from, strength * LAM.beam, _end, from.distanceTo(_end) / LAM.range);
    // Off the wall a touch toward the gun, so the dot is not cut by the surface it sits on.
    if (wall) _dot.copy(_hit.point).addScaledVector(_hit.normal, 0.012).addScaledVector(dir, -0.01);
    this.write(slot * 2 + 1, _dot, wall ? strength * LAM.dot : 0, _dot, -1);
    this.on[slot] = strength > 0;
    this.mesh.visible = this.on.includes(true);
  }

  hide(slot: number): void {
    if (!this.on[slot]) return;
    this.write(slot * 2, _end, 0, _end, 0);
    this.write(slot * 2 + 1, _end, 0, _end, -1);
    this.on[slot] = false;
    this.mesh.visible = this.on.includes(true);
  }

  /** Whether slot `slot`'s dot is lit: a wall within range. For tests. */
  dotOn(slot: number): boolean {
    return this.aA.getW(slot * 8 + 4) > 0;
  }

  private write(quad: number, a: THREE.Vector3, strength: number, b: THREE.Vector3, w: number): void {
    for (let v = 0; v < 4; v++) {
      this.aA.setXYZW(quad * 4 + v, a.x, a.y, a.z, strength);
      this.aB.setXYZW(quad * 4 + v, b.x, b.y, b.z, w);
    }
    this.aA.needsUpdate = true;
    this.aB.needsUpdate = true;
  }
}
