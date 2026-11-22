/**
 * Pooled, zero-per-frame-allocation Red Beam mega-laser visual (`src/fx/recipes/redBeam.ts`).
 *
 * Renders the Distraint Frame's 1.4 m thick crimson beam:
 *   - White-hot crimson core cylinder + camera-facing inner plasma ribbon
 *   - 1.4 m diameter turbulent outer glow sheath (tapered near the muzzle so cockpit sight stays clear)
 *   - 6 pooled pulsing energy rings racing down the beam axis
 *   - Muzzle charge-up orb & bloom flare scaling smoothly with charge 0..1 (and flaring at full power while firing)
 *   - Endpoint impact bloom, wall-pierce scorch sparks/decals, heat shimmer, and dynamic red point lights
 *
 * Supports both live pilot-driven beams (updated each frame by `RedBeamArmGun`) and self-timed co-op beams
 * spawned from `remoteNews`, auto-cleaning up on `ctx.time.elapsed` when their 1.0 s duration completes.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import { clamp, rand, randomUnit, TAU } from '../../core/math';

/** Physical beam thickness: 1.4 m diameter = 0.7 m outer sheath radius. */
export const RED_BEAM_DIAMETER = 1.4;
export const RED_BEAM_RADIUS = RED_BEAM_DIAMETER * 0.5;
/** White-hot inner core cylinder radius (m). */
const CORE_RADIUS = 0.28;
/** Taper distance out of the muzzle (m) so the beam widens dramatically without blinding the pilot. */
const MUZZLE_TAPER = 3.5;
/** Max concurrent red beams pooled per scene (supports dual Red Beam arms + co-op teammates). */
export const RED_BEAM_POOL_SIZE = 4;
/** Pooled pulsing energy rings per beam slot. */
const RING_COUNT = 6;
/** Portion of beam duration at the end over which width and intensity collapse. */
const BEAM_FADE_TAIL = 0.15;

const UP = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _side = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _pt = new THREE.Vector3();
const _arcEnd = new THREE.Vector3();
const _rand = new THREE.Vector3();
const _basis = new THREE.Matrix4();

const RIBBON_VERT = /* glsl */ `
uniform float uLen;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  p.x *= mix(0.24, 1.0, clamp(p.y * uLen / ${MUZZLE_TAPER.toFixed(1)}, 0.0, 1.0));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const RIBBON_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uCore;
uniform vec3 uRim;
uniform float uTime;
uniform float uPower;
uniform float uLen;
varying vec2 vUv;
void main() {
  float x = 1.0 - abs(vUv.x * 2.0 - 1.0);
  float d = vUv.y * uLen;
  float pulse = 0.72 + 0.28 * sin(d * 0.85 - uTime * 52.0) * sin(d * 0.21 + uTime * 19.0);
  vec3 c = uRim * pow(x, 1.15) * pulse
         + uCore * (smoothstep(0.18, 0.58, x) + 0.35 * pow(x, 2.0) + 1.45 * smoothstep(0.8, 0.96, x));
  float lead = smoothstep(0.0, 1.6, d);
  gl_FragColor = vec4(c * uPower * lead, 1.0);
}`;

const CORE_CYL_VERT = /* glsl */ `
uniform float uLen;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vView;
void main() {
  vUv = uv;
  vec3 p = position;
  p.xz *= mix(0.28, 1.0, clamp(p.y * uLen / ${MUZZLE_TAPER.toFixed(1)}, 0.0, 1.0));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vN = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const CORE_CYL_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uCore;
uniform vec3 uRim;
uniform float uTime;
uniform float uPower;
uniform float uLen;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vView;
void main() {
  float d = vUv.y * uLen;
  float facing = abs(dot(normalize(vN), normalize(vView)));
  float surge = 0.8 + 0.2 * sin(d * 1.1 - uTime * 48.0);
  vec3 c = uRim * pow(facing, 0.9) * surge + uCore * pow(facing, 2.6);
  float ends = smoothstep(0.0, 0.9, d) * (1.0 - smoothstep(uLen - 1.5, uLen, d));
  gl_FragColor = vec4(c * uPower * ends, 1.0);
}`;

const SHEATH_VERT = /* glsl */ `
uniform float uLen;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vView;
void main() {
  vUv = uv;
  vec3 p = position;
  p.xz *= mix(0.28, 1.0, clamp(p.y * uLen / ${MUZZLE_TAPER.toFixed(1)}, 0.0, 1.0));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vN = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const SHEATH_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uCore;
uniform vec3 uRim;
uniform float uTime;
uniform float uPower;
uniform float uLen;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vView;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wrapNoise(vec2 p, float period) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float x0 = mod(i.x, period);
  float x1 = mod(i.x + 1.0, period);
  return mix(
    mix(hash(vec2(x0, i.y)), hash(vec2(x1, i.y)), f.x),
    mix(hash(vec2(x0, i.y + 1.0)), hash(vec2(x1, i.y + 1.0)), f.x),
    f.y
  );
}
void main() {
  float d = vUv.y * uLen;
  float a = vUv.x * 8.0 + d * 0.32 - uTime * 8.5;
  float n = wrapNoise(vec2(a, d * 0.45 - uTime * 38.0), 8.0) * 0.6
          + wrapNoise(vec2(a * 2.0, d * 1.2 - uTime * 64.0), 16.0) * 0.4;
  float streak = smoothstep(0.38, 0.88, n);
  float edge = pow(1.0 - abs(dot(normalize(vN), normalize(vView))), 1.3);
  float ends = smoothstep(0.0, 0.8, d) * (1.0 - smoothstep(uLen - 2.5, uLen, d));
  vec3 c = uRim * (0.24 + streak * 1.45) * edge + uCore * streak * streak * 0.6 * edge;
  gl_FragColor = vec4(c * uPower * ends, 1.0);
}`;

const ORB_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vView;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const ORB_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uCore;
uniform vec3 uRim;
uniform float uTime;
uniform float uPower;
varying vec3 vN;
varying vec3 vView;
void main() {
  float f = abs(dot(normalize(vN), normalize(vView)));
  float flick = 0.84 + 0.16 * sin(uTime * 57.0 + vN.x * 9.0) * sin(uTime * 33.0 + vN.y * 7.0);
  vec3 c = uRim * pow(f, 1.55) * flick + uCore * pow(f, 4.6);
  gl_FragColor = vec4(c * uPower, 1.0);
}`;

const RING_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vView;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const RING_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform float uPower;
varying vec3 vN;
varying vec3 vView;
void main() {
  float f = 0.35 + 0.65 * abs(dot(normalize(vN), normalize(vView)));
  gl_FragColor = vec4(uColor * f * uPower, 1.0);
}`;

function bunched<T extends THREE.BufferGeometry>(geo: T): T {
  const pos = geo.attributes.position!;
  for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) ** 2);
  return geo;
}

/** Smooth beam power envelope: fast ramp-in, sustained blazing output, rapid tail collapse. */
export function redBeamPower(progress: number): number {
  const k = clamp(progress);
  const rampIn = clamp(k / 0.06 + 0.25);
  const tail = clamp((k - (1 - BEAM_FADE_TAIL)) / BEAM_FADE_TAIL);
  return rampIn * (1 - tail * 0.85);
}

/** Beam girth multiplier over its normalized lifetime `progress` (0..1). */
export function redBeamGirth(progress: number): number {
  const k = clamp(progress);
  const tail = clamp((k - (1 - BEAM_FADE_TAIL)) / BEAM_FADE_TAIL);
  return Math.max(0.18, (1 - 0.14 * k) * (1 - tail) + 0.18 * tail);
}

export interface RedBeamSlot {
  active: boolean;
  timed: boolean;
  /** Elapsed world clock when a timed beam started. */
  startTime: number;
  /** Lifetime in seconds for timed beams. */
  duration: number;
  /** Next world time to flash dynamic lights / shimmer for timed beams. */
  nextPulse: number;
  readonly from: THREE.Vector3;
  readonly to: THREE.Vector3;
  readonly ribbon: THREE.Mesh;
  readonly coreCyl: THREE.Mesh;
  readonly sheath: THREE.Mesh;
  readonly muzzleOrb: THREE.Mesh;
  readonly endBloom: THREE.Mesh;
  readonly rings: THREE.Mesh[];
  readonly ribbonMat: THREE.ShaderMaterial;
  readonly coreMat: THREE.ShaderMaterial;
  readonly sheathMat: THREE.ShaderMaterial;
  readonly orbMat: THREE.ShaderMaterial;
  readonly bloomMat: THREE.ShaderMaterial;
  readonly ringMat: THREE.ShaderMaterial;
  ctx: Ctx | null;
}

class RedBeamPool {
  readonly slots: RedBeamSlot[] = [];
  private readonly stripGeo: THREE.BufferGeometry;
  private readonly tubeGeo: THREE.BufferGeometry;
  private readonly ballGeo: THREE.BufferGeometry;
  private readonly ringGeo: THREE.BufferGeometry;

  constructor(private readonly scene: THREE.Scene) {
    this.stripGeo = bunched(new THREE.PlaneGeometry(1, 1, 1, 24).translate(0, 0.5, 0));
    this.tubeGeo = bunched(new THREE.CylinderGeometry(1, 1, 1, 20, 28, true).translate(0, 0.5, 0));
    this.ballGeo = new THREE.IcosahedronGeometry(1, 3);
    this.ringGeo = new THREE.TorusGeometry(1, 0.085, 8, 20);
    for (let i = 0; i < RED_BEAM_POOL_SIZE; i++) {
      this.slots.push(this.makeSlot());
    }
  }

  private addMesh(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.visible = false;
    this.scene.add(m);
    return m;
  }

  private makeSlot(): RedBeamSlot {
    const ribbonMat = new THREE.ShaderMaterial({
      vertexShader: RIBBON_VERT,
      fragmentShader: RIBBON_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false,
      uniforms: {
        uCore: { value: new THREE.Color('#fff2ec').multiplyScalar(18) },
        uRim: { value: new THREE.Color('#ff1c10').multiplyScalar(10) },
        uTime: { value: 0 },
        uPower: { value: 0 },
        uLen: { value: 1 },
      },
    });
    const coreMat = new THREE.ShaderMaterial({
      vertexShader: CORE_CYL_VERT,
      fragmentShader: CORE_CYL_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false,
      uniforms: {
        uCore: { value: new THREE.Color('#ffe8de').multiplyScalar(11) },
        uRim: { value: new THREE.Color('#ff2214').multiplyScalar(6) },
        uTime: { value: 0 },
        uPower: { value: 0 },
        uLen: { value: 1 },
      },
    });
    const sheathMat = new THREE.ShaderMaterial({
      vertexShader: SHEATH_VERT,
      fragmentShader: SHEATH_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false,
      uniforms: {
        uCore: { value: new THREE.Color('#ff9868').multiplyScalar(3.5) },
        uRim: { value: new THREE.Color('#ff160c').multiplyScalar(4.8) },
        uTime: { value: 0 },
        uPower: { value: 0 },
        uLen: { value: 1 },
      },
    });
    const orbMat = new THREE.ShaderMaterial({
      vertexShader: ORB_VERT,
      fragmentShader: ORB_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      fog: false,
      uniforms: {
        uCore: { value: new THREE.Color('#fff6f0').multiplyScalar(9) },
        uRim: { value: new THREE.Color('#ff1e12').multiplyScalar(5.5) },
        uTime: { value: 0 },
        uPower: { value: 0 },
      },
    });
    const bloomMat = orbMat.clone();
    const ringMat = new THREE.ShaderMaterial({
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      fog: false,
      uniforms: {
        uColor: { value: new THREE.Color('#ff341e').multiplyScalar(6.5) },
        uPower: { value: 0 },
      },
    });

    const ribbon = this.addMesh(this.stripGeo, ribbonMat);
    const coreCyl = this.addMesh(this.tubeGeo, coreMat);
    const sheath = this.addMesh(this.tubeGeo, sheathMat);
    const muzzleOrb = this.addMesh(this.ballGeo, orbMat);
    const endBloom = this.addMesh(this.ballGeo, bloomMat);
    const rings: THREE.Mesh[] = [];
    for (let i = 0; i < RING_COUNT; i++) rings.push(this.addMesh(this.ringGeo, ringMat));

    const slot: RedBeamSlot = {
      active: false,
      timed: false,
      startTime: 0,
      duration: 1,
      nextPulse: 0,
      from: new THREE.Vector3(),
      to: new THREE.Vector3(),
      ribbon,
      coreCyl,
      sheath,
      muzzleOrb,
      endBloom,
      rings,
      ribbonMat,
      coreMat,
      sheathMat,
      orbMat,
      bloomMat,
      ringMat,
      ctx: null,
    };

    // Timed (remote co-op) beams self-animate and auto-clean-up on the game clock via onBeforeRender.
    ribbon.onBeforeRender = () => {
      if (!slot.timed || !slot.active || !slot.ctx) return;
      this.stepTimedSlot(slot, slot.ctx);
    };

    return slot;
  }

  acquire(timed: boolean): RedBeamSlot | null {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i]!;
      if (!s.active) {
        s.active = true;
        s.timed = timed;
        return s;
      }
    }
    // Pool full: recycle oldest timed slot if requesting a timed beam.
    if (timed) {
      let oldest: RedBeamSlot | null = null;
      for (let i = 0; i < this.slots.length; i++) {
        const s = this.slots[i]!;
        if (s.timed && (!oldest || s.startTime < oldest.startTime)) oldest = s;
      }
      if (oldest) {
        this.hideSlot(oldest);
        oldest.active = true;
        oldest.timed = true;
        return oldest;
      }
    }
    return null;
  }

  hideSlot(slot: RedBeamSlot): void {
    slot.ribbon.visible = false;
    slot.coreCyl.visible = false;
    slot.sheath.visible = false;
    slot.muzzleOrb.visible = false;
    slot.endBloom.visible = false;
    for (let i = 0; i < slot.rings.length; i++) slot.rings[i]!.visible = false;
  }

  release(slot: RedBeamSlot): void {
    this.hideSlot(slot);
    slot.active = false;
    slot.timed = false;
    slot.ctx = null;
  }

  stepTimedSlot(slot: RedBeamSlot, ctx: Ctx): void {
    const now = ctx.time?.elapsed ?? 0;
    const elapsed = now - slot.startTime;
    if (elapsed < 0 || elapsed >= slot.duration) {
      this.release(slot);
      return;
    }
    const progress = clamp(elapsed / slot.duration);
    const power = redBeamPower(progress);
    const girth = redBeamGirth(progress);
    poseRedBeamSlot(slot, ctx, slot.from, slot.to, power, girth, true);
    if (now >= slot.nextPulse) {
      slot.nextPulse = now + 0.1;
      emitRedBeamLightsAndShimmer(ctx, slot.from, slot.to, power);
    }
  }

  stepAllTimed(ctx: Ctx): void {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i]!;
      if (s.active && s.timed) this.stepTimedSlot(s, ctx);
    }
  }

  activeCount(): number {
    let n = 0;
    for (let i = 0; i < this.slots.length; i++) if (this.slots[i]!.active) n++;
    return n;
  }
}

const POOLS = new WeakMap<THREE.Scene, RedBeamPool>();

function poolFor(ctx: Ctx): RedBeamPool | null {
  const scene = ctx.render?.scene;
  if (!scene) return null;
  let pool = POOLS.get(scene);
  if (!pool) {
    pool = new RedBeamPool(scene);
    POOLS.set(scene, pool);
  }
  return pool;
}

/** Acquires a persistent pooled beam slot for a local arm gun (or null if running headless without a scene). */
export function acquireRedBeamSlot(ctx: Ctx): RedBeamSlot | null {
  return poolFor(ctx)?.acquire(false) ?? null;
}

/** Releases a persistent pooled beam slot and hides all its meshes. */
export function releaseRedBeamSlot(ctx: Ctx, slot: RedBeamSlot | null): void {
  if (!slot) return;
  const pool = poolFor(ctx);
  if (pool) pool.release(slot);
  else {
    slot.ribbon.visible = slot.coreCyl.visible = slot.sheath.visible = slot.muzzleOrb.visible = slot.endBloom.visible = false;
    for (let i = 0; i < slot.rings.length; i++) slot.rings[i]!.visible = false;
    slot.active = false;
  }
}

/** Hides all meshes of a slot without releasing ownership (used when idle or cooling down). */
export function hideRedBeamSlot(slot: RedBeamSlot | null): void {
  if (!slot) return;
  slot.ribbon.visible = false;
  slot.coreCyl.visible = false;
  slot.sheath.visible = false;
  slot.muzzleOrb.visible = false;
  slot.endBloom.visible = false;
  for (let i = 0; i < slot.rings.length; i++) slot.rings[i]!.visible = false;
}

/**
 * Updates the muzzle charge-up orb/bloom flare scaling with `charge` (0..1) while charging,
 * hiding the main beam column. Zero allocations.
 */
export function poseRedBeamChargeOrb(slot: RedBeamSlot | null, ctx: Ctx, muzzle: THREE.Vector3, charge: number): void {
  if (!slot) return;
  slot.ribbon.visible = false;
  slot.coreCyl.visible = false;
  slot.sheath.visible = false;
  slot.endBloom.visible = false;
  for (let i = 0; i < slot.rings.length; i++) slot.rings[i]!.visible = false;

  const k = clamp(charge);
  if (k <= 0.005) {
    slot.muzzleOrb.visible = false;
    return;
  }
  const time = ctx.time?.elapsed ?? 0;
  const flicker = 1 + Math.sin(time * 47) * 0.08 * k;
  slot.muzzleOrb.visible = true;
  slot.muzzleOrb.position.copy(muzzle);
  slot.muzzleOrb.scale.setScalar((0.06 + 0.52 * k * k) * flicker);
  slot.orbMat.uniforms.uTime!.value = time;
  slot.orbMat.uniforms.uPower!.value = 0.25 + 1.15 * k * k;
}

/**
 * Poses the full 1.4 m thick red mega-beam (white-hot crimson core cylinder + ribbon + outer sheath +
 * pulsing energy rings + muzzle flare + endpoint bloom). Zero per-frame allocations.
 */
export function poseRedBeamSlot(
  slot: RedBeamSlot | null,
  ctx: Ctx,
  from: THREE.Vector3,
  to: THREE.Vector3,
  power: number,
  girth: number,
  showEndBloom: boolean,
): void {
  if (!slot) return;
  const time = ctx.time?.elapsed ?? 0;
  const len = Math.max(0.2, from.distanceTo(to));
  _dir.subVectors(to, from).divideScalar(len);
  const flicker = 1 + Math.sin(time * 63) * 0.07 + Math.sin(time * 27) * 0.05;

  // Camera-facing ribbon basis so the beam reads massive even looking down the barrel from the cockpit.
  const eye = ctx.player?.eye;
  _mid.copy(from).lerp(to, 0.5);
  if (eye) _side.subVectors(_mid, eye).cross(_dir);
  else _side.set(1, 0, 0);
  if (_side.lengthSq() < 1e-6) _side.set(1, 0, 0);
  _side.normalize();
  _normal.crossVectors(_side, _dir);
  _basis.makeBasis(_side, _dir, _normal);

  slot.ribbon.visible = true;
  slot.ribbon.position.copy(from);
  slot.ribbon.quaternion.setFromRotationMatrix(_basis);
  slot.ribbon.scale.set(RED_BEAM_DIAMETER * 0.92 * girth * flicker, len, 1);
  slot.ribbonMat.uniforms.uTime!.value = time;
  slot.ribbonMat.uniforms.uPower!.value = power;
  slot.ribbonMat.uniforms.uLen!.value = len;

  // Inner white-hot crimson core cylinder.
  slot.coreCyl.visible = true;
  slot.coreCyl.position.copy(from);
  slot.coreCyl.quaternion.setFromUnitVectors(UP, _dir);
  const coreR = CORE_RADIUS * girth * flicker;
  slot.coreCyl.scale.set(coreR, len, coreR);
  slot.coreMat.uniforms.uTime!.value = time;
  slot.coreMat.uniforms.uPower!.value = power;
  slot.coreMat.uniforms.uLen!.value = len;

  // Outer 1.4 m diameter (0.7 m radius) turbulent crimson sheath.
  slot.sheath.visible = true;
  slot.sheath.position.copy(from);
  slot.sheath.quaternion.setFromUnitVectors(UP, _dir);
  const sheathR = RED_BEAM_RADIUS * girth * (1 + Math.sin(time * 43) * 0.06);
  slot.sheath.scale.set(sheathR, len, sheathR);
  slot.sheathMat.uniforms.uTime!.value = time;
  slot.sheathMat.uniforms.uPower!.value = power;
  slot.sheathMat.uniforms.uLen!.value = len;

  // Muzzle flare orb.
  slot.muzzleOrb.visible = true;
  slot.muzzleOrb.position.copy(from);
  slot.muzzleOrb.scale.setScalar(0.68 * girth * flicker);
  slot.orbMat.uniforms.uTime!.value = time;
  slot.orbMat.uniforms.uPower!.value = power * 1.4;

  // Endpoint bloom flare.
  slot.endBloom.visible = showEndBloom;
  if (showEndBloom) {
    slot.endBloom.position.copy(to);
    slot.endBloom.scale.setScalar(1.75 * girth * (1 + Math.sin(time * 31) * 0.12));
    slot.bloomMat.uniforms.uTime!.value = time;
    slot.bloomMat.uniforms.uPower!.value = power * 1.3;
  }

  // Pulsing energy rings racing outward along the first ~48 m of the beam.
  slot.ringMat.uniforms.uPower!.value = power * 0.9;
  const ringSpan = Math.min(len, 48);
  for (let i = 0; i < slot.rings.length; i++) {
    const ring = slot.rings[i]!;
    const phase = (i / RING_COUNT + time * 2.4) % 1;
    const dist = 1.6 + phase * Math.max(0.5, ringSpan - 1.6);
    if (dist >= len) {
      ring.visible = false;
      continue;
    }
    ring.visible = true;
    ring.position.copy(from).addScaledVector(_dir, dist);
    ring.quaternion.setFromUnitVectors(UP, _dir);
    // Rotate torus (which lies in XY around Z) so its axis aligns with +Y before quaternion rotates +Y to _dir.
    ring.rotateX(Math.PI / 2);
    const pulseR = (0.55 + 0.55 * Math.sin(phase * Math.PI)) * girth;
    ring.scale.setScalar(pulseR);
  }
}

/** Emits dynamic red point lights, heat shimmer, and crackling crimson arcs along the beam. Zero allocations. */
export function emitRedBeamLightsAndShimmer(
  ctx: Ctx,
  from: THREE.Vector3,
  to: THREE.Vector3,
  power: number,
): void {
  const len = from.distanceTo(to);
  if (len <= 0.1) return;
  const { fx, render } = ctx;
  // Muzzle red point light.
  render?.lights?.flash?.(from, 0xff2214, 22 * power, 16, 0.1);
  // Mid-beam red point light (clamped near enough to illuminate surrounding walls/ground).
  const midFrac = Math.min(0.45, 22 / len);
  _pt.lerpVectors(from, to, midFrac);
  render?.lights?.flash?.(_pt, 0xff2416, 20 * power, 18, 0.1);
  // Endpoint red point light.
  render?.lights?.flash?.(to, 0xff2818, 28 * power, 20, 0.1);

  // Heat shimmer along the beam path.
  if (len > 4) {
    fx.heatShimmer?.(_pt.lerpVectors(from, to, Math.min(0.18, 12 / len)), 2.0, 0.22);
    fx.heatShimmer?.(_pt.lerpVectors(from, to, Math.min(0.52, 32 / len)), 2.6, 0.24);
  }

  // Occasional crackling crimson lightning arcs leaping off the beam column.
  if (len > 4 && typeof fx.arc === 'function') {
    for (let i = 0; i < 2; i++) {
      _pt.lerpVectors(from, to, rand(Math.min(0.15, 3 / len), Math.min(0.85, 55 / len)));
      _arcEnd.copy(_pt).add(randomUnit(_rand).multiplyScalar(rand(0.8, 1.9)));
      fx.arc(_pt, _arcEnd, i === 0 ? 0xff8866 : 0xff2014, 0.08, 0.045);
    }
  }
}

/** Emits wall-pierce scorch sparks, embers, shock ring, scorch decal, and red flash at a wall entry/exit. */
export function emitRedBeamWallPierce(
  ctx: Ctx,
  point: THREE.Vector3,
  normal: THREE.Vector3,
  isFinalWall: boolean,
  addDecal = true,
): void {
  const { fx, render } = ctx;
  fx.sparks?.(point, normal, isFinalWall ? 22 : 16, 0xff3b22);
  fx.embers?.(point, isFinalWall ? 8 : 5, 1.5);
  fx.ring?.(point, normal, '#ff2a1a', isFinalWall ? 4.0 : 2.8);
  fx.heatShimmer?.(point, isFinalWall ? 2.8 : 2.0, 0.25);
  render?.lights?.flash?.(point, 0xff2a1a, isFinalWall ? 30 : 22, 16, 0.1);
  if (addDecal) {
    render?.decals?.add?.('scorch', point, normal, isFinalWall ? 2.6 : 1.8, rand(0, TAU));
  }
}

/** Emits muzzle charge-up inhale slivers, red crackle arcs, and warm crimson glow light while charging. */
export function emitRedBeamChargeFx(
  ctx: Ctx,
  muzzle: THREE.Vector3,
  charge: number,
  dt: number,
): void {
  const k = clamp(charge);
  if (k <= 0.02) return;
  const { fx, render } = ctx;
  const count = Math.max(1, Math.round(14 * k * k * dt * 60 / 12));
  if (Math.random() < 0.45 + 0.5 * k) {
    fx.inhale?.(muzzle, 2.4 * (1 - 0.3 * k), count, 0xff2818);
  }
  if (Math.random() < 10 * k * k * dt && typeof fx.arc === 'function') {
    randomUnit(_rand).multiplyScalar(rand(0.55, 1.45)).add(muzzle);
    fx.arc(_rand, muzzle, k > 0.85 ? 0xff9977 : 0xff2214, 0.07, 0.014);
  }
  render?.lights?.flash?.(muzzle, 0xff2014, 4 + 18 * k * k, 6 + 8 * k, 0.08);
}

/**
 * Spawns a pooled, self-timed 1.0 s Red Beam visual (used by co-op `remoteNews` playback).
 * Auto-cleans up via `ctx.time.elapsed` once `duration` seconds have passed.
 */
export function spawnTimedRedBeam(
  ctx: Ctx,
  from: THREE.Vector3,
  to: THREE.Vector3,
  duration = 1.0,
): RedBeamSlot | null {
  const dur = clamp(duration, 0.1, 3.0);
  // Always emit core FX beam fallback + sparks/rings so both WebGL and headless/minimal FX contexts see it.
  ctx.fx.beam?.(from, to, 'lance', RED_BEAM_DIAMETER, dur);
  _dir.subVectors(to, from);
  const len = _dir.length();
  if (len > 0.05) {
    _dir.divideScalar(len);
    ctx.fx.ring?.(from, _dir, '#ff2a1a', 3.0);
    ctx.fx.ring?.(to, _dir, '#ff2a1a', 4.0);
    ctx.fx.sparks?.(to, _dir, 20, 0xff3b22);
  }
  emitRedBeamLightsAndShimmer(ctx, from, to, 1.0);

  const pool = poolFor(ctx);
  if (!pool) return null;
  const slot = pool.acquire(true);
  if (!slot) return null;
  const now = ctx.time?.elapsed ?? 0;
  slot.startTime = now;
  slot.duration = dur;
  slot.nextPulse = now + 0.1;
  slot.from.copy(from);
  slot.to.copy(to);
  slot.ctx = ctx;
  poseRedBeamSlot(slot, ctx, slot.from, slot.to, redBeamPower(0), redBeamGirth(0), true);
  return slot;
}

/** Steps all active timed beams in `ctx.render.scene`'s pool (useful in tests and non-WebGL stepping). */
export function stepRedBeamPool(ctx: Ctx): void {
  poolFor(ctx)?.stepAllTimed(ctx);
}

/** Returns how many Red Beam pool slots are currently active for `ctx.render.scene`. */
export function activeRedBeamCount(ctx: Ctx): number {
  return poolFor(ctx)?.activeCount() ?? 0;
}
