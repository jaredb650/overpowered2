/**
 * A laser module's visible beam (a fitted mod's `ModLook.laser`), locked to the crosshair. The dot sits where the camera's centre
 * ray meets a wall or a man within `LAM.range` (the shot's own ray, `Combat.fireRay`, is the same look from the eye; the camera
 * only adds a few centimetres of bob and the kick's spring), so it never leaves the centre pixel; a thin added red line runs to it
 * from the emitter of each gun in hand. With nothing in range there is no dot and the lines fade out down that ray.
 *
 * All of it is placed as the frame is drawn (`onBeforeRender`), from the two cameras that draw it, and everything that moves is a
 * uniform (uploaded at the draw, where a buffer write would only reach the next frame): the ray is cast from the camera as it is
 * drawn, and the beam leaves the gun where the gun is on screen. Nothing trails. Aimed, the dot is drawn a second time in the view pass over the gun (`overlay`), on the
 * sights, as the gun would otherwise hide it. One ray a frame, no light. First person only.
 */
import * as THREE from 'three';
import type { RayHit } from '../../core/contracts';

export const LAM = {
  /** How far a pistol/shotgun laser ray looks, metres; a beam with nothing at its end fades out over it. */
  range: 40,
  /** Reach of the Rocket launcher's guided laser sight, metres (matches TUNING.rocket.laserRange). */
  rocketRange: 400,
  /** Linear colour, past 1 for the bloom: the emitter's red. */
  color: [1.8, 0.16, 0.04],
  /** The beams' brightness, low so they read as a haze line, and the dot's. */
  beam: 0.3,
  dot: 1,
  /** Beam width at the emitter and the dot's radius, metres, and the fewest pixels each is drawn at. */
  width: 0.0012,
  widthPx: 1.2,
  radius: 0.02,
  radiusPx: 6.5,
  /** How far in front of the view camera the aimed dot is drawn, metres (inside its 12 m far plane). */
  overlayDepth: 0.5,
} as const;

export const ROCKET_LAM_RANGE = LAM.rocketRange;

export type LaserCast = (from: THREE.Vector3, dir: THREE.Vector3, max: number, out: RayHit) => boolean;

/** Where a ray from `from` along unit `dir` ends, into `end`: on the first surface within `range` (true: the dot shows), else at the range's end. */
export function laserEnd(
  from: THREE.Vector3, dir: THREE.Vector3, cast: LaserCast, hit: RayHit, end: THREE.Vector3, range: number = LAM.range,
): boolean {
  // A stand-in physics answers with a proxy, not a boolean: nothing hit.
  if (cast(from, dir, range, hit) === true) {
    end.copy(hit.point);
    return true;
  }
  end.copy(from).addScaledVector(dir, range);
  return false;
}

/**
 * Maps a point in the view scene (where the viewmodel is drawn) to the world point drawn on the same pixel. The two cameras share
 * an eye and a depth axis, so only x and y scale, by the ratio of their FOV tangents (rig.ts `toWorld` does the same).
 */
export function viewToWorld(p: THREE.Vector3, camera: THREE.PerspectiveCamera, viewCamera: THREE.PerspectiveCamera, out: THREE.Vector3): THREE.Vector3 {
  out.copy(p).applyMatrix4(viewCamera.matrixWorldInverse);
  const k = Math.tan((camera.fov * Math.PI) / 360) / Math.tan((viewCamera.fov * Math.PI) / 360);
  out.x *= k;
  out.y *= k;
  return out.applyMatrix4(camera.matrixWorld);
}

const VERT = /* glsl */ `
attribute float aSlot;
uniform vec3 uFrom0;
uniform vec3 uFrom1;
uniform vec3 uEnd;
uniform vec3 uDot;
uniform vec3 uStrength;
uniform vec2 uShare;
uniform float uRadius;
uniform vec2 uRes;
uniform float uPixelWorld;
varying vec2 vUv;
varying float vAlong;
varying float vPixel;
varying float vStrength;
varying float vDot;
void main() {
  float strength = aSlot < 0.5 ? uStrength.x : aSlot < 1.5 ? uStrength.y : uStrength.z;
  vStrength = strength;
  vDot = aSlot > 1.5 ? 1.0 : 0.0;
  vUv = position.xy;
  vAlong = 0.0;
  vPixel = 0.0;
  if (strength <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  if (aSlot > 1.5) {
    // The dot: a quad facing the eye, never under a few pixels across.
    vec4 v = viewMatrix * vec4(uDot, 1.0);
    v.xy += position.xy * max(uRadius, uPixelWorld * -v.z * ${LAM.radiusPx.toFixed(2)});
    gl_Position = projectionMatrix * v;
    return;
  }
  // A beam: a screen-facing strip from its emitter to the end, a pixel or so wide however far (as fx/layers/lines.ts).
  vec4 va = viewMatrix * vec4(aSlot < 0.5 ? uFrom0 : uFrom1, 1.0);
  vec4 vb = viewMatrix * vec4(uEnd, 1.0);
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
  float w = max(${LAM.width.toFixed(4)}, uPixelWorld * c.w * ${LAM.widthPx.toFixed(2)});
  float px = w / (uPixelWorld * c.w);
  float quadPx = px + 1.0;
  c.xy += n * position.x * (quadPx * 2.0 / uRes.y) / aspect * c.w;
  gl_Position = c;
  vUv.x = position.x * quadPx / px;
  vAlong = along * (aSlot < 0.5 ? uShare.x : uShare.y);
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
const _p = new THREE.Vector3();
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _v = new THREE.Vector3();

function lamMaterial(overlay: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: {
      uFrom0: { value: new THREE.Vector3() }, uFrom1: { value: new THREE.Vector3() }, uEnd: { value: new THREE.Vector3() },
      uDot: { value: new THREE.Vector3() }, uStrength: { value: new THREE.Vector3() }, uShare: { value: new THREE.Vector2() },
      uRadius: { value: LAM.radius }, uRes: { value: new THREE.Vector2(1280, 720) }, uPixelWorld: { value: 0.002 },
      uColor: { value: new THREE.Vector3(...LAM.color) },
    },
    // The overlay is drawn over the gun: no depth test.
    transparent: true, depthWrite: false, depthTest: !overlay, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  });
}

type Uniforms = Record<string, THREE.IUniform>;
const vec3 = (u: Uniforms, name: string) => u[name]!.value as THREE.Vector3;

/** The camera's pixel size, for the beams' and the dot's pixel floor, read as it draws. */
function pixelFloor(u: Uniforms, renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
  const res = u.uRes!.value as THREE.Vector2;
  renderer.getDrawingBufferSize(res);
  u.uPixelWorld!.value = 2 / (res.y * (camera.projectionMatrix.elements[5] ?? 1));
}

export class LamBeams {
  /** In the world scene: a beam a slot and the dot, in one draw. */
  readonly mesh: THREE.Mesh;
  /** In the view scene: the dot again, over the gun, while aimed. */
  readonly overlay: THREE.Mesh;
  /** The camera the viewmodel is drawn with, and the ray the dot is found with; set by the rig. Without them nothing is drawn. */
  viewCamera: THREE.PerspectiveCamera | null = null;
  cast: LaserCast | null = null;
  /** 0 to 1, how far the gun is up at the eye: the dot moves from the world to over the gun. */
  aim = 0;
  /** Default laser reach, metres (40 m for pistol/shotgun LAMs; set to ROCKET_LAM_RANGE or pass `range` to `set()` for 400 m). */
  range: number = LAM.range;
  /** Where the shot's ray ends this frame, whether something is there, and the dot (a touch back toward the eye). */
  readonly end = new THREE.Vector3();
  readonly dotAt = new THREE.Vector3();
  hit = false;
  private readonly sockets: (THREE.Object3D | null)[] = new Array<THREE.Object3D | null>(SLOTS).fill(null);
  private readonly strength = new Array<number>(SLOTS).fill(0);
  private readonly slotRange: (number | undefined)[] = new Array<number | undefined>(SLOTS).fill(undefined);
  /** The world camera of this frame's world pass, for the view pass that follows it. */
  private camera: THREE.PerspectiveCamera | null = null;

  constructor() {
    // Three quads: beam 0, beam 1, the dot. Everything that moves is a uniform.
    const corners = [-1, -1, 1, -1, 1, 1, -1, 1];
    const position = new Float32Array(3 * 12);
    const slot = new Float32Array(3 * 4);
    const index: number[] = [];
    for (let q = 0; q < 3; q++) {
      for (let v = 0; v < 4; v++) {
        position.set([corners[v * 2]!, corners[v * 2 + 1]!, 0], (q * 4 + v) * 3);
        slot[q * 4 + v] = q;
      }
      index.push(q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('aSlot', new THREE.BufferAttribute(slot, 1));
    geometry.setIndex(index);
    const make = (overlay: boolean) => {
      const mesh = new THREE.Mesh(geometry, lamMaterial(overlay));
      mesh.name = overlay ? 'viewmodel.lamOverlay' : 'viewmodel.lam';
      mesh.frustumCulled = false;
      mesh.visible = false;
      // With the tracers' beams (fx/layers/shared.ts ORDER.beams); the overlay after the gun.
      mesh.renderOrder = overlay ? 999 : 22;
      return mesh;
    };
    this.mesh = make(false);
    this.overlay = make(true);
    this.mesh.onBeforeRender = (renderer, _scene, camera) => this.draw(renderer, camera as THREE.PerspectiveCamera);
    this.overlay.onBeforeRender = (renderer, _scene, camera) => this.drawOverlay(renderer, camera as THREE.PerspectiveCamera);
  }

  /**
   * Slot `slot`'s emitter, a socket in the view scene facing down the bore, at `strength`; null or 0 takes its beam away.
   * Optional `range` overrides `this.range` for this slot (e.g. `ROCKET_LAM_RANGE` = 400 m for the Rocket launcher's guided laser).
   */
  set(slot: number, socket: THREE.Object3D | null, strength: number, range?: number): void {
    this.sockets[slot] = socket;
    this.strength[slot] = socket ? strength : 0;
    this.slotRange[slot] = socket && strength > 0 ? range : undefined;
    this.mesh.visible = this.overlay.visible = this.active;
  }

  /** Active laser reach in metres: the longest explicit active slot range, or `this.range`. */
  effectiveRange(): number {
    let best = 0;
    for (let i = 0; i < SLOTS; i++) {
      const r = this.strength[i]! > 0 ? this.slotRange[i] : undefined;
      if (r !== undefined && r > best) best = r;
    }
    return best > 0 ? best : this.range;
  }

  get active(): boolean {
    return this.strength.some(s => s > 0);
  }

  /** The shot's ray this frame, from `from` along unit `dir`: where the beams end, and the dot on what `cast` finds. */
  target(from: THREE.Vector3, dir: THREE.Vector3, cast: LaserCast, range: number = this.effectiveRange()): void {
    this.hit = laserEnd(from, dir, cast, _hit, this.end, range);
    // Back along the ray a touch, so the surface does not cut the dot (scales slightly at long 400 m distances); still on the same pixel.
    const dist = this.hit ? _hit.distance : range;
    const pull = Math.max(0.02, Math.min(0.15, dist * 0.0004));
    this.dotAt.copy(this.end).addScaledVector(dir, -pull);
  }

  /** The world pass: each beam from its emitter, mapped from the view scene with this frame's cameras, to the ray's end. */
  draw(renderer: THREE.WebGLRenderer | null, camera: THREE.PerspectiveCamera): void {
    this.camera = camera;
    const reach = this.effectiveRange();
    // The one ray a frame, down the centre of the camera as it is drawn.
    if (this.cast && this.active) this.target(_o.setFromMatrixPosition(camera.matrixWorld), camera.getWorldDirection(_d), this.cast, reach);
    const u = (this.mesh.material as THREE.ShaderMaterial).uniforms;
    if (renderer) pixelFloor(u, renderer, camera);
    const strength = vec3(u, 'uStrength');
    for (let slot = 0; slot < SLOTS; slot++) {
      const socket = this.sockets[slot];
      const on = socket && this.viewCamera ? this.strength[slot]! : 0;
      strength.setComponent(slot, on * LAM.beam);
      if (!on) continue;
      const from = vec3(u, slot === 0 ? 'uFrom0' : 'uFrom1');
      viewToWorld(_p.setFromMatrixPosition(socket!.matrixWorld), camera, this.viewCamera!, from);
      const slotReach = this.slotRange[slot] ?? reach;
      (u.uShare!.value as THREE.Vector2).setComponent(slot, Math.min(1, from.distanceTo(this.end) / slotReach));
    }
    vec3(u, 'uEnd').copy(this.end);
    vec3(u, 'uDot').copy(this.dotAt);
    u.uRadius!.value = LAM.radius;
    strength.z = this.hit ? Math.max(...this.strength) * LAM.dot * (1 - this.aim) : 0;
  }

  /** The view pass, aimed: the dot on the pixel the world's falls on, in front of the view camera, the same size on screen. */
  drawOverlay(renderer: THREE.WebGLRenderer | null, viewCamera: THREE.PerspectiveCamera): void {
    const u = (this.overlay.material as THREE.ShaderMaterial).uniforms;
    const strength = vec3(u, 'uStrength');
    strength.set(0, 0, 0);
    const camera = this.camera;
    if (!camera || !this.hit || this.aim <= 0.01) return;
    if (renderer) pixelFloor(u, renderer, viewCamera);
    _v.copy(this.dotAt).applyMatrix4(camera.matrixWorldInverse);
    const depth = -_v.z;
    if (depth <= 0.05) return;
    const k = Math.tan((camera.fov * Math.PI) / 360) / Math.tan((viewCamera.fov * Math.PI) / 360);
    const s = LAM.overlayDepth / depth;
    vec3(u, 'uDot').set((_v.x * s) / k, (_v.y * s) / k, -LAM.overlayDepth).applyMatrix4(viewCamera.matrixWorld);
    u.uRadius!.value = (LAM.radius * s) / k;
    strength.z = Math.max(...this.strength) * LAM.dot * this.aim;
  }

  /** Whether the dot shows this frame: something in range on the centre ray and a beam on. For tests. */
  dotOn(): boolean {
    return this.hit && this.active;
  }
}
