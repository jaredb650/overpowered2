import * as THREE from 'three';
import type { DecalKind, DecalSystem } from '../core/contracts';
import type { MaterialPatcher, ShaderHook } from './materials/patch';
import type { BakedSet } from './materials/TextureBaker';

/**
 * The decal buffer is one instanced mesh and one draw call, cut into rings by kind. Each ring is a stretch of the buffer
 * with its own cursor, so a kind only ever overwrites its own oldest: bullet holes cannot erase blood, and a few big
 * stains cannot be pushed out by a thousand small ones. The order here is the order they are drawn in, bottom first:
 *
 * - `scorch`: burns. Under everything, so the blood of the man a rocket killed lands on the burn and not beneath it.
 * - `big`: large stains laid for coverage (a burst under a gib, a fan along a shot). Few, and kept longest.
 * - `blood`: every small stain, smear, run and pool. The detail on top of the big ones.
 * - `mark`: holes, exit craters, cracks and cuts. On top: a round into a bloody wall still leaves its hole.
 *
 * `capacity` is the room each ring has in the buffer and never changes. `limit` (`setLimit`, the "Mess" setting) is how
 * much of it is in use.
 */
export type DecalRing = 'scorch' | 'big' | 'blood' | 'mark';
export const DECAL_RINGS: readonly DecalRing[] = ['scorch', 'big', 'blood', 'mark'];
export const RING_CAPACITY: Readonly<Record<DecalRing, number>> = { scorch: 256, big: 256, blood: 8192, mark: 1536 };
/** Which ring a kind lives in. A new kind needs a row here and in `CELLS`. */
export const RING_OF: Readonly<Record<DecalKind, DecalRing>> = {
  bullet: 'mark',
  exit: 'mark',
  slash: 'mark',
  crack: 'mark',
  scorch: 'scorch',
  blood: 'blood',
  bloodPool: 'blood',
  bloodSmear: 'blood',
};
/** Every slot in the buffer, all rings together. */
export const MAX_DECALS = DECAL_RINGS.reduce((n, r) => n + RING_CAPACITY[r], 0);

/**
 * One decal that is about to be overwritten by a newer one of its ring (never called by `clear`). `matrices` holds 16
 * floats a slot from `slot * 16` (the quad's two edges, its normal and its place, as columns) and `data` 4 from
 * `slot * 4` (atlas cell, the world time it landed, flag plus seed, stretch). Read them now: the slot is rewritten as
 * soon as this returns. This is where old blood can be drawn into a floor texture before it goes.
 */
export type DecalRetire = (ring: DecalRing, matrices: Float32Array, data: Float32Array, slot: number) => void;

interface RingState {
  readonly name: DecalRing;
  /** First slot in the buffer. */
  readonly base: number;
  readonly capacity: number;
  /** Slots in use, at most `capacity`. */
  limit: number;
  /** Next slot to write, 0..limit-1, from `base`. */
  cursor: number;
  /** Slots that hold a decal. */
  live: number;
  /** Decals overwritten since the last `clear`. */
  retired: number;
  dirtyStart: number;
  dirtyCount: number;
  /** Slots from `base` to send whole on the next upload: they were emptied by `clear` or a lowered limit. */
  flush: number;
}

const _at = new THREE.Vector3();

/** First atlas cell and variant count per kind. Matches surface_decals. */
const CELLS: Record<DecalKind, readonly [number, number]> = {
  // One hole, not two: the second cell went to the exit crater. At 12 cm and any rotation the two could not be told apart.
  bullet: [0, 1],
  exit: [1, 1],
  scorch: [2, 2],
  blood: [4, 4],
  bloodPool: [8, 2],
  bloodSmear: [10, 2],
  slash: [12, 2],
  crack: [14, 2],
};
const GROW_POOL = 1;
/** Pool flag 2: a run of blood down a wall, drawn in the shader and grown from its top over a second or two. */
const GROW_RUN = 2;
/** Length over width of the most glancing stain. Past this a drop has skimmed off, not landed. */
const MAX_STRETCH = 4.5;
/** A wall stain this big (quad edge, m) or bigger can start a run down the wall, and is sure to from `RUN_SURE`. */
const RUN_FROM = 0.16;
const RUN_SURE = 0.6;
/** A surface counts as a wall for runs while its normal is this flat. */
const RUN_WALL = 0.55;

declare module '../core/contracts' {
  interface DecalSystem {
    /**
     * A drop of blood arriving at `velocity`: elongated along its travel, by as much as the angle of
     * impact says, with its spatter thrown ahead of it. `size` is the edge of the quad before stretching.
     */
    splat(position: THREE.Vector3, normal: THREE.Vector3, size: number, velocity: THREE.Vector3): void;
    /**
     * Blood running down a wall from `position`, as wide as a stain of `size` would feed. Grows downward over a second
     * or two. Does nothing on a floor or ceiling. `splat` calls it by itself for big enough wall stains.
     */
    run(position: THREE.Vector3, normal: THREE.Vector3, size: number): void;
  }
}

const VERT_PARS = /* glsl */ `
attribute vec4 aDecal;
varying vec2 vOpUv;
varying vec4 vOpDecal;
varying vec3 vOpT;
varying vec3 vOpB;
`;

const VERT_MAIN = /* glsl */ `
vOpUv = uv;
vOpDecal = aDecal;
vOpT = mat3(viewMatrix) * instanceMatrix[0].xyz;
vOpB = mat3(viewMatrix) * instanceMatrix[1].xyz;
`;

const FRAG_PARS = /* glsl */ `
uniform sampler2D opDecalA;
uniform sampler2D opDecalS;
uniform highp sampler2D opDepth;
uniform vec2 opProj;
uniform float opWorldTime;
varying vec2 vOpUv;
varying vec4 vOpDecal;
varying vec3 vOpT;
varying vec3 vOpB;
`;

/**
 * Decals test depth themselves against this frame's depth texture instead of using the hardware
 * test. A fragment survives only if the surface there lies within a few millimetres of the decal
 * plane, so nothing can z-fight, nothing hangs off a ledge, and anything in front hides it.
 */
const FRAG_MAIN = /* glsl */ `
float opZ = opProj.y / (texelFetch(opDepth, ivec2(gl_FragCoord.xy), 0).r * 2.0 - 1.0 + opProj.x);
if (abs(opZ - vViewPosition.z) > 0.03 + vViewPosition.z * 0.0025) discard;
vec2 opP = vOpUv;
float opAge = max(opWorldTime - vOpDecal.y, 0.0);
if (vOpDecal.z >= 1.0 && vOpDecal.z < 2.0) {
  // Pools spread slowly: most of the way in about four seconds, then keep creeping a little.
  float grow = 0.16 + 0.76 * (1.0 - exp(-opAge * 0.6)) + min(opAge * 0.004, 0.08);
  opP = (opP - 0.5) / grow + 0.5;
}
float opCell = vOpDecal.x;
bool opBlood = opCell > 3.5 && opCell < 11.5;
vec4 opA;
vec4 opS;
if (vOpDecal.z >= 2.0) {
  // A run down a wall. +X is down: the top sits in the stain that feeds it. The front creeps down over a second or
  // two and slows, with a bead of blood at its head, and the run thins and wanders on the way.
  float seed = fract(vOpDecal.z) * 57.0;
  float aspect = vOpDecal.w;
  float reach = 0.55 + 0.45 * fract(seed * 0.37);
  float front = reach * (1.0 - exp(-opAge * (1.3 + fract(seed * 0.71) * 1.2)));
  float x = opP.x;
  float across = (opP.y - 0.5) * 2.0 + (sin(x * 9.0 + seed) * 0.5 + sin(x * 23.0 - seed * 1.7) * 0.25) * 0.3;
  float halfW = mix(0.78, 0.32, x) * (0.85 + 0.15 * sin(x * 31.0 + seed * 3.0));
  float bead = 0.9 - length(vec2((x - front) * aspect * 2.0, across * 0.85));
  float body = x < front ? halfW - abs(across) : -1.0;
  float f = max(body, bead * 0.75);
  float aa = max(fwidth(f), 0.002);
  float cover = clamp(f / aa + 0.5, 0.0, 1.0) * smoothstep(0.0, 0.04, x);
  if (cover < 0.004) discard;
  float thick = clamp(1.0 - abs(across) / max(halfW, 0.05), 0.0, 1.0);
  opA = vec4(mix(vec3(0.6, 0.007, 0.015), vec3(0.27, 0.0, 0.006), thick), cover);
  // A rounded bead of liquid: the normal rolls across it.
  opS = vec4(0.5, 0.5 + clamp(across / max(halfW, 0.05), -1.0, 1.0) * 0.3 * thick, 0.1, 0.0);
} else {
if (opBlood) {
  vec2 q = opP * 2.0 - 1.0;
  float stretch = vOpDecal.w;
  if (stretch > 1.01) {
    // Travel runs along +X. The body sits back, the far side draws out into a tail, and spatter off to
    // the sides bends forward: a chevron pointing where the drop was going.
    float lean = 1.0 - 1.0 / stretch;
    q.x += lean * 0.42;
    q.x -= lean * 0.7 * q.y * q.y;
    if (q.x > 0.0) q.x *= 1.0 - 0.45 * lean;
  }
  // There are only a few blots in the atlas. Warping each one its own way keeps any two from matching.
  float seed = fract(vOpDecal.z) * 57.0;
  q += vec2(
    sin(q.y * 7.0 + seed) + 0.5 * sin(q.y * 17.0 - seed * 1.7) + 0.5 * sin(q.x * 5.0 + seed * 2.3),
    sin(q.x * 8.0 - seed * 0.7) + 0.5 * sin(q.x * 19.0 + seed * 1.3) + 0.5 * sin(q.y * 6.0 - seed)
  ) * 0.03;
  opP = q * 0.5 + 0.5;
}
if (opP.x < 0.0 || opP.y < 0.0 || opP.x > 1.0 || opP.y > 1.0) discard;
vec2 opAtlas = (vec2(mod(opCell, 4.0), floor(opCell / 4.0)) + opP) * 0.25;
opA = texture2D(opDecalA, opAtlas);
if (opA.a < 0.004) discard;
opS = texture2D(opDecalS, opAtlas);
}
// Fresh blood is dark and wet. Over a minute it goes darker still and loses its shine.
float opDry = opBlood ? smoothstep(5.0, 70.0, opAge) : 0.0;
vec3 opTint = opA.rgb * vec3(0.42, 0.5, 0.5) * (1.0 - 0.45 * opDry);
diffuseColor = vec4(opBlood ? vec3(1.0) : opA.rgb, opA.a);
`;

/**
 * Red reflects nothing under cyan light, and this map is lit cyan, so blood would dry to black the moment
 * it landed. It takes its brightness from the light and keeps its own hue. It adds no light of its own.
 */
const LIGHT = /* glsl */ `
#include <lights_fragment_end>
if (opBlood) {
  float opLight = dot(reflectedLight.directDiffuse + reflectedLight.indirectDiffuse, vec3(0.2126, 0.7152, 0.0722));
  reflectedLight.directDiffuse = vec3(0.0);
  reflectedLight.indirectDiffuse = opTint * opLight * 2.0;
}
`;

const NORMAL = /* glsl */ `
{
  vec2 t = opS.xy * 2.0 - 1.0;
  vec3 T = normalize(vOpT);
  vec3 B = normalize(vOpB);
  normal = normalize(T * t.x + B * t.y + normal * sqrt(max(1.0 - dot(t, t), 0.0)));
}
`;

/**
 * Surface-aligned quads in one instanced draw, lit by the same patched PBR as the world.
 * Each ring (see `DECAL_RINGS`) overwrites its own oldest first, and only the ranges touched since the last frame are uploaded.
 */
export class Decals implements DecalSystem {
  readonly mesh: THREE.InstancedMesh;
  private readonly extra: THREE.InstancedBufferAttribute;
  private readonly matrices: Float32Array;
  private readonly data: Float32Array;
  private readonly rings: RingState[] = [];
  private readonly ringOf = {} as Record<DecalKind, RingState>;
  /** Called for a decal about to be overwritten. See `DecalRetire`. */
  onRetire: DecalRetire | null = null;
  private now = 0;
  private readonly time = { value: 0 };
  private readonly proj = { value: new THREE.Vector2() };
  private readonly depth: THREE.IUniform<THREE.Texture | null> = { value: null };

  constructor(patcher: MaterialPatcher, atlas: BakedSet) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    this.extra = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DECALS * 4), 4);
    this.extra.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aDecal', this.extra);
    const material = new THREE.MeshStandardMaterial({
      name: 'decals', roughness: 1, metalness: 1, transparent: true, depthWrite: false, depthTest: false,
      // Leaves destination alpha alone: it holds the floor's reflectivity, and wet stays wet under blood.
      blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
    const own = { opDecalA: { value: atlas.albedo }, opDecalS: { value: atlas.surface }, opDepth: this.depth, opProj: this.proj, opWorldTime: this.time };
    const hook: ShaderHook = shader => {
      Object.assign(shader.uniforms, own);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
        .replace('#include <uv_vertex>', `#include <uv_vertex>\n${VERT_MAIN}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <map_pars_fragment>', `#include <map_pars_fragment>\n${FRAG_PARS}`)
        .replace('#include <map_fragment>', FRAG_MAIN)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = opS.z + opDry * 0.3;')
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = opS.w;')
        .replace('#include <normal_fragment_maps>', NORMAL)
        .replace('#include <lights_fragment_end>', LIGHT);
    };
    patcher.apply(material, hook, 'decals');
    this.mesh = new THREE.InstancedMesh(geometry, material, MAX_DECALS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = -10;
    this.matrices = this.mesh.instanceMatrix.array as Float32Array;
    this.data = this.extra.array as Float32Array;
    // An empty slot is a quad of no size (all zeros), so the draw can run to the last slot in use without drawing it.
    this.matrices.fill(0);
    let base = 0;
    for (const name of DECAL_RINGS) {
      const capacity = RING_CAPACITY[name];
      this.rings.push({ name, base, capacity, limit: capacity, cursor: 0, live: 0, retired: 0, dirtyStart: -1, dirtyCount: 0, flush: 0 });
      base += capacity;
    }
    for (const kind of Object.keys(RING_OF) as DecalKind[]) this.ringOf[kind] = this.rings[DECAL_RINGS.indexOf(RING_OF[kind])]!;
  }

  /** How many decals a ring holds now. */
  live(ring: DecalRing): number {
    return this.ring(ring).live;
  }

  /** Decals in all rings together. `mesh.count` is not this: it is how far the draw runs. */
  get total(): number {
    let n = 0;
    for (const r of this.rings) n += r.live;
    return n;
  }

  /** A ring's first slot in the buffer. */
  base(ring: DecalRing): number {
    return this.ring(ring).base;
  }

  /** How many a ring may hold: `capacity` unless `setLimit` lowered it. */
  limit(ring: DecalRing): number {
    return this.ring(ring).limit;
  }

  /** Decals of a ring overwritten by newer ones since the last `clear`: 0 means nothing has been erased yet. */
  retired(ring: DecalRing): number {
    return this.ring(ring).retired;
  }

  /**
   * Sets how many slots of a ring are in use, 1 to its capacity. Lowering it drops what lay past the new end (without
   * `onRetire`: the player asked for less) and the ring goes on from its start.
   */
  setLimit(ring: DecalRing, limit: number): void {
    const r = this.ring(ring);
    const next = Math.max(1, Math.min(r.capacity, Math.floor(limit)));
    if (next === r.limit) return;
    if (r.live > next) {
      this.matrices.fill(0, (r.base + next) * 16, (r.base + r.live) * 16);
      r.flush = Math.max(r.flush, r.live);
      r.live = next;
    }
    // A ring with room left always writes at its end; a full one that is given room goes on from there.
    if (r.cursor >= next || r.live < next) r.cursor = r.live % next;
    // Writes waiting to be sent were counted against the old limit: send the ring whole instead.
    if (r.dirtyCount > 0) {
      r.flush = Math.max(r.flush, r.limit);
      r.dirtyStart = -1;
      r.dirtyCount = 0;
    }
    r.limit = next;
  }

  private ring(name: DecalRing): RingState {
    return this.rings[DECAL_RINGS.indexOf(name)]!;
  }

  /** The draw covers every slot up to the last one in use. */
  private recount(): void {
    let end = 0;
    for (const r of this.rings) if (r.live > 0) end = r.base + r.live;
    this.mesh.count = end;
  }

  add(kind: DecalKind, position: THREE.Vector3, normal: THREE.Vector3, size: number, rotation = Math.random() * Math.PI * 2): void {
    const inv = 1 / Math.hypot(normal.x, normal.y, normal.z);
    const nx = normal.x * inv, ny = normal.y * inv, nz = normal.z * inv;
    // Tangent from whichever world axis is least aligned with the normal.
    let tx: number, ty: number, tz: number;
    if (Math.abs(ny) < 0.9) {
      const l = 1 / Math.hypot(nz, nx);
      tx = nz * l;
      ty = 0;
      tz = -nx * l;
    } else {
      const l = 1 / Math.hypot(ny, nz);
      tx = 0;
      ty = -nz * l;
      tz = ny * l;
    }
    const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
    const c = Math.cos(rotation) * size, s = Math.sin(rotation) * size;
    this.write(
      kind, position, nx, ny, nz,
      tx * c + bx * s, ty * c + by * s, tz * c + bz * s,
      -tx * s + bx * c, -ty * s + by * c, -tz * s + bz * c,
      0,
    );
  }

  splat(position: THREE.Vector3, normal: THREE.Vector3, size: number, velocity: THREE.Vector3): void {
    const inv = 1 / Math.hypot(normal.x, normal.y, normal.z);
    const nx = normal.x * inv, ny = normal.y * inv, nz = normal.z * inv;
    const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
    const into = -(velocity.x * nx + velocity.y * ny + velocity.z * nz);
    let tx = velocity.x + nx * into, ty = velocity.y + ny * into, tz = velocity.z + nz * into;
    const skim = Math.hypot(tx, ty, tz);
    this.feedRun(position, normal, ny, size);
    if (speed < 0.01 || skim < 0.01) {
      this.add('blood', position, normal, size);
      return;
    }
    tx /= skim;
    ty /= skim;
    tz /= skim;
    // A stain's width over its length is the sine of the angle it arrived at.
    const stretch = Math.min(speed / Math.max(into, 1e-3), MAX_STRETCH);
    const wide = size * (1 + Math.min(speed * 0.025, 0.5));
    const long = wide * stretch;
    this.write(
      'blood', position, nx, ny, nz,
      tx * long, ty * long, tz * long,
      (ny * tz - nz * ty) * wide, (nz * tx - nx * tz) * wide, (nx * ty - ny * tx) * wide,
      stretch,
    );
  }

  /** A big enough stain on a wall runs. Bigger stains feed more runs. */
  private feedRun(position: THREE.Vector3, normal: THREE.Vector3, ny: number, size: number): void {
    if (Math.abs(ny) > RUN_WALL || size < RUN_FROM) return;
    const odds = (size - RUN_FROM) / (RUN_SURE - RUN_FROM);
    let runs = Math.floor(odds) + (Math.random() < odds % 1 ? 1 : 0);
    runs = Math.min(runs, 3);
    for (let i = 0; i < runs; i++) {
      _at.copy(position);
      if (i > 0) _at.y += (Math.random() - 0.5) * size * 0.3;
      this.run(_at, normal, size * (i === 0 ? 1 : 0.6));
    }
  }

  run(position: THREE.Vector3, normal: THREE.Vector3, size: number): void {
    const inv = 1 / Math.hypot(normal.x, normal.y, normal.z);
    const nx = normal.x * inv, ny = normal.y * inv, nz = normal.z * inv;
    if (Math.abs(ny) > RUN_WALL) return;
    // Down the wall: gravity with the part into the wall taken out.
    let dx = ny * nx, dy = -1 + ny * ny, dz = ny * nz;
    const dl = Math.hypot(dx, dy, dz);
    dx /= dl;
    dy /= dl;
    dz /= dl;
    const long = Math.min(Math.max(size * (2 + Math.random() * 3.5), 0.18), 1.4);
    const wide = Math.min(Math.max(size * (0.08 + Math.random() * 0.1), 0.014), 0.08);
    // Off to one side of the stain and starting inside it, so it reads as running out of it.
    const side = (Math.random() - 0.5) * size * 0.45;
    // Across it: the normal crossed with down, so the quad faces out of the wall.
    const sx = ny * dz - nz * dy, sy = nz * dx - nx * dz, sz = nx * dy - ny * dx;
    const start = long * 0.5 - size * 0.12;
    _at.set(
      position.x + dx * start + sx * side,
      position.y + dy * start + sy * side,
      position.z + dz * start + sz * side,
    );
    this.write(
      'bloodSmear', _at, nx, ny, nz,
      dx * long, dy * long, dz * long,
      sx * wide, sy * wide, sz * wide,
      long / wide, GROW_RUN,
    );
  }

  /** Writes one instance. `a` and `b` are the quad's edges, already scaled. */
  private write(
    kind: DecalKind, position: THREE.Vector3, nx: number, ny: number, nz: number,
    ax: number, ay: number, az: number, bx: number, by: number, bz: number, stretch: number,
    flag = kind === 'bloodPool' ? GROW_POOL : 0,
  ): void {
    const r = this.ringOf[kind];
    const i = r.base + r.cursor;
    if (r.live === r.limit) {
      r.retired++;
      if (this.onRetire) this.onRetire(r.name, this.matrices, this.data, i);
    } else {
      r.live++;
      const end = r.base + r.live;
      if (end > this.mesh.count) this.mesh.count = end;
    }
    const m = this.matrices;
    const o = i * 16;
    m[o] = ax;
    m[o + 1] = ay;
    m[o + 2] = az;
    m[o + 3] = 0;
    m[o + 4] = bx;
    m[o + 5] = by;
    m[o + 6] = bz;
    m[o + 7] = 0;
    m[o + 8] = nx;
    m[o + 9] = ny;
    m[o + 10] = nz;
    m[o + 11] = 0;
    m[o + 12] = position.x + nx * 0.002;
    m[o + 13] = position.y + ny * 0.002;
    m[o + 14] = position.z + nz * 0.002;
    m[o + 15] = 1;
    const [first, variants] = CELLS[kind];
    const d = i * 4;
    this.data[d] = first + Math.floor(Math.random() * variants);
    this.data[d + 1] = this.now;
    // Whole part: pool or run flag. Fraction: this decal's own seed for the shader.
    this.data[d + 2] = flag + Math.random() * 0.99;
    this.data[d + 3] = stretch;

    if (r.dirtyStart < 0) r.dirtyStart = r.cursor;
    r.dirtyCount = Math.min(r.dirtyCount + 1, r.limit);
    r.cursor = (r.cursor + 1) % r.limit;
  }

  clear(): void {
    for (const r of this.rings) {
      if (r.live > 0) {
        this.matrices.fill(0, r.base * 16, (r.base + r.live) * 16);
        r.flush = Math.max(r.flush, r.live);
      }
      r.dirtyStart = -1;
      r.dirtyCount = 0;
      r.cursor = 0;
      r.live = 0;
      r.retired = 0;
    }
    // The zeroed slots still have to reach the GPU, so the draw keeps its length until `update` has sent them.
  }

  /** Uploads what changed and prepares the draw. */
  update(worldTime: number, depth: THREE.Texture, camera: THREE.PerspectiveCamera): void {
    this.now = worldTime;
    this.time.value = worldTime;
    this.depth.value = depth;
    const e = camera.projectionMatrix.elements;
    this.proj.value.set(e[10]!, e[14]!);
    let any = false;
    for (const r of this.rings) {
      if (r.dirtyCount === 0 && r.flush === 0) continue;
      if (!any) {
        this.mesh.instanceMatrix.clearUpdateRanges();
        this.extra.clearUpdateRanges();
        any = true;
      }
      if (r.flush > 0) {
        this.mesh.instanceMatrix.addUpdateRange(r.base * 16, r.flush * 16);
        this.extra.addUpdateRange(r.base * 4, r.flush * 4);
        r.flush = 0;
      }
      if (r.dirtyCount > 0) {
        // A ring's dirty stretch can wrap past its end: then it is two ranges.
        const start = r.dirtyStart;
        const count = r.dirtyCount;
        const first = Math.min(count, r.limit - start);
        this.mesh.instanceMatrix.addUpdateRange((r.base + start) * 16, first * 16);
        this.extra.addUpdateRange((r.base + start) * 4, first * 4);
        if (first < count) {
          this.mesh.instanceMatrix.addUpdateRange(r.base * 16, (count - first) * 16);
          this.extra.addUpdateRange(r.base * 4, (count - first) * 4);
        }
        r.dirtyStart = -1;
        r.dirtyCount = 0;
      }
    }
    if (!any) return;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.extra.needsUpdate = true;
    this.recount();
  }
}
