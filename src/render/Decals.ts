import * as THREE from 'three';
import type { DecalKind, DecalSystem } from '../core/contracts';
import type { MaterialPatcher, ShaderHook } from './materials/patch';
import type { BakedSet } from './materials/TextureBaker';

export const MAX_DECALS = 2048;

/** First atlas cell and variant count per kind. Matches surface_decals. */
const CELLS: Record<DecalKind, readonly [number, number]> = {
  bullet: [0, 2],
  scorch: [2, 2],
  blood: [4, 4],
  bloodPool: [8, 2],
  bloodSmear: [10, 2],
  slash: [12, 2],
  crack: [14, 2],
};
const GROW_POOL = 1;
/** Length over width of the most glancing stain. Past this a drop has skimmed off, not landed. */
const MAX_STRETCH = 4.5;

declare module '../core/contracts' {
  interface DecalSystem {
    /**
     * A drop of blood arriving at `velocity`: elongated along its travel, by as much as the angle of
     * impact says, with its spatter thrown ahead of it. `size` is the edge of the quad before stretching.
     */
    splat(position: THREE.Vector3, normal: THREE.Vector3, size: number, velocity: THREE.Vector3): void;
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
if (vOpDecal.z >= 1.0) {
  // Pools spread out over a second, then keep creeping a little.
  float grow = 0.2 + 0.72 * (1.0 - exp(-opAge * 2.6)) + min(opAge * 0.006, 0.08);
  opP = (opP - 0.5) / grow + 0.5;
}
float opCell = vOpDecal.x;
bool opBlood = opCell > 3.5 && opCell < 11.5;
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
vec4 opA = texture2D(opDecalA, opAtlas);
if (opA.a < 0.004) discard;
vec4 opS = texture2D(opDecalS, opAtlas);
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
 * The ring buffer overwrites oldest first and only the ranges touched since the last frame are uploaded.
 */
export class Decals implements DecalSystem {
  readonly mesh: THREE.InstancedMesh;
  private readonly extra: THREE.InstancedBufferAttribute;
  private readonly matrices: Float32Array;
  private readonly data: Float32Array;
  private cursor = 0;
  private count = 0;
  private dirtyStart = -1;
  private dirtyCount = 0;
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

  /** Writes one instance. `a` and `b` are the quad's edges, already scaled. */
  private write(
    kind: DecalKind, position: THREE.Vector3, nx: number, ny: number, nz: number,
    ax: number, ay: number, az: number, bx: number, by: number, bz: number, stretch: number,
  ): void {
    const i = this.cursor;
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
    // Whole part: pool flag. Fraction: this decal's own seed for the shader.
    this.data[d + 2] = (kind === 'bloodPool' ? GROW_POOL : 0) + Math.random() * 0.99;
    this.data[d + 3] = stretch;

    if (this.dirtyStart < 0) this.dirtyStart = i;
    this.dirtyCount = Math.min(this.dirtyCount + 1, MAX_DECALS);
    this.cursor = (i + 1) % MAX_DECALS;
    this.count = Math.min(this.count + 1, MAX_DECALS);
    this.mesh.count = this.count;
  }

  clear(): void {
    this.cursor = 0;
    this.count = 0;
    this.dirtyStart = -1;
    this.dirtyCount = 0;
    this.mesh.count = 0;
  }

  /** Uploads what changed and prepares the draw. */
  update(worldTime: number, depth: THREE.Texture, camera: THREE.PerspectiveCamera): void {
    this.now = worldTime;
    this.time.value = worldTime;
    this.depth.value = depth;
    const e = camera.projectionMatrix.elements;
    this.proj.value.set(e[10]!, e[14]!);
    if (this.dirtyCount === 0) return;
    const start = this.dirtyStart;
    const count = this.dirtyCount;
    const first = Math.min(count, MAX_DECALS - start);
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.extra.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(start * 16, first * 16);
    this.extra.addUpdateRange(start * 4, first * 4);
    if (first < count) {
      this.mesh.instanceMatrix.addUpdateRange(0, (count - first) * 16);
      this.extra.addUpdateRange(0, (count - first) * 4);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.extra.needsUpdate = true;
    this.dirtyStart = -1;
    this.dirtyCount = 0;
  }
}
