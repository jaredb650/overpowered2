import * as THREE from 'three';
import type { MaterialLibrary } from '../../core/contracts';
import { COMMON_VERT } from '../gpu/glsl';
import { InstanceRing } from '../gpu/ring';
import { BLOOD } from '../palette';
import { ORDER, type FxUniforms } from './shared';

/**
 * Blood in the air. The first game's opaque chips are right for explosions and wrong for liquid, so this
 * is the one particle class that is lit: a patched standard material, the same light volume, moon shadow,
 * dynamic lights and fog as the wall behind it. Blood goes black in a dark tunnel and catches a muzzle
 * flash, and it cannot glow.
 *
 * One record is a whole strand, not a droplet. The vertex shader walks the strand down its own path,
 * head at `age` and tail `trail` seconds behind it, so a single instance is a curved arc that bends under
 * gravity. The fragment shader rounds the head, tapers the tail and pinches it into beads, the way a real
 * stream breaks up. That is why a jet needs thirteen of these where it used to need thirty-five chips and puffs.
 *
 * Motion is linear drag, so fine strands stall and drop while heavy drops carry. `stop` is the landing
 * time worked out at emission: the head sticks there and the rest of the strand runs into it.
 *
 *   aP  origin xyz, birth          aV  velocity xyz, life
 *   aC  tone 0 venous 1 arterial, half width, trail seconds, opacity (negative is a mist puff)
 *   aF  gravity, drag, stop time, seed
 */
const ATTRS = ['aP', 'aV', 'aC', 'aF'] as const;

const SEGMENTS = 7;
/** Room around the strand for the antialiased edge. */
const PAD = 1.4;

const VERT_PARS = /* glsl */ `
attribute vec4 aP;
attribute vec4 aV;
attribute vec4 aC;
attribute vec4 aF;
uniform float uMinPx;
varying vec4 vStrand;
varying vec4 vLook;
varying vec3 vSide;
${COMMON_VERT}
`;

const VERT_NORMAL = /* glsl */ `
float bAge = uTime - aP.w;
bool bDead = bAge < 0.0 || bAge >= aV.w;
bool bMist = aC.w < 0.0;
vec3 bGravity = vec3(0.0, aF.x, 0.0);
float bU = position.y;
float bTime = bMist ? min(bAge, aF.z) : clamp(bAge - bU * aC.z, 0.0, aF.z);
vec3 bVel;
vec3 bPos = dragged(aP.xyz, aV.xyz, bGravity, aF.y, bTime, bVel);

float bSpeed = length(bVel);
vec3 bAlong = bSpeed > 0.01 ? bVel / bSpeed : vec3(0.0, -1.0, 0.0);
vec3 bToEye = normalize(cameraPosition - bPos);
vec3 bSide = cross(bAlong, bToEye);
float bSideLen = length(bSide);
bSide = bSideLen > 0.001 ? bSide / bSideLen : normalize(cross(vec3(0.0, 1.0, 0.0), bToEye));

float bDepth = max(-(viewMatrix * vec4(bPos, 1.0)).z, 0.05);
float bFloor = uPixelWorld * bDepth * uMinPx;
float bHalf = aC.y;
float bK = bAge / aV.w;
float bOpacity = abs(aC.w);
if (bMist) {
  // Spreads as it thins. Gone before it can sit on the player's face, where it would cost a full screen.
  // At range the strands fall under a pixel, so the puff grows to carry the hit on its own.
  bHalf *= (1.0 + 1.6 * bK) * (1.0 + clamp((bDepth - 5.0) * 0.14, 0.0, 2.0));
  bOpacity *= (1.0 - bK) * (1.0 - bK) * clamp((bDepth - 0.7) / 1.3, 0.0, 1.0);
}
// Thinner than the pixel floor it gets paler, not fatter: a far spurt stays fine instead of turning to confetti.
float bWidth = max(bHalf, bFloor);
bOpacity *= sqrt(bHalf / bWidth);

vec3 objectNormal = bToEye;
`;

const VERT_POSITION = /* glsl */ `
vec3 transformed = bPos + bSide * (position.x * bWidth * ${PAD.toFixed(2)});
if (bMist) transformed += bAlong * (bU * 2.0 - 1.0) * bWidth * (1.0 + min(bSpeed * 0.16, 1.6));
vStrand = vec4(position.x * ${PAD.toFixed(2)}, bU, bMist ? -1.0 : aC.z * length(aV.xyz) / max(aC.y * 7.0, 0.01), aF.w);
vLook = vec4(aC.x, bOpacity, 0.0, 0.0);
vSide = mat3(viewMatrix) * bSide;
`;

const VERT_PROJECT = /* glsl */ `
#include <project_vertex>
if (bDead || bOpacity < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
`;

const FRAG_PARS = /* glsl */ `
varying vec4 vStrand;
varying vec4 vLook;
varying vec3 vSide;

uniform vec3 uVenous;
uniform vec3 uArterial;
uniform float uLift;

float bloodSpeck(vec2 p) { return fract(sin(dot(floor(p), vec2(127.1, 311.7))) * 43758.5453); }
`;

const FRAG_COVER = /* glsl */ `
float bAcross = vStrand.x;
float bU = vStrand.y;
float bSeed = vStrand.w;
float bHalf = 1.0;
float bAlpha;
if (vStrand.z < 0.0) {
  // Mist is a spray of very fine drops, so a soft body with grain in it, never a smooth gel.
  vec2 q = vec2(bAcross / ${PAD.toFixed(2)}, bU * 2.0 - 1.0);
  float body = 1.0 - smoothstep(0.1, 1.0, length(q));
  float grain = bloodSpeck(q * 26.0 + bSeed * 91.0);
  bAlpha = body * body * (0.3 + 0.7 * step(0.62, grain));
} else {
  float beads = max(vStrand.z, 1.0);
  // The head is a round cap about as long as the strand is wide.
  float cap = sqrt(clamp(bU * beads * 1.6, 0.0, 1.0));
  float taper = pow(max(1.0 - bU, 0.0), 0.8);
  // Surface tension breaks the tail into beads and leaves the head whole.
  float x = bU * beads + bSeed * 13.0;
  float wave = 0.5 + 0.5 * sin(x * 6.2831 + 2.4 * sin(x * 2.3 + bSeed * 6.0));
  float pinch = mix(1.0, smoothstep(0.2, 0.62, wave), smoothstep(0.12, 0.6, bU));
  bHalf = max(cap * taper * pinch, 0.001);
  float edge = max(fwidth(bAcross), 0.001);
  bAlpha = clamp((bHalf - abs(bAcross)) / edge + 0.5, 0.0, 1.0);
}
bAlpha *= vLook.y;
if (bAlpha < 0.006) discard;
vec3 bTint = mix(uVenous, uArterial, vLook.x);
// A fine spray scatters what a solid drop absorbs, so it reads paler than the blood it came from.
if (vStrand.z < 0.0) bTint *= 2.2;
diffuseColor = vec4(vec3(1.0), bAlpha);
`;

/**
 * Red under this map's cyan light reflects nothing, so the correct answer is black, and black blood reads
 * as oil. It takes its brightness from the light and keeps its own hue. It still goes dark where the
 * scene is dark, and it adds no light of its own.
 */
const FRAG_LIGHT = /* glsl */ `
#include <lights_fragment_end>
{
  float bLight = dot(reflectedLight.directDiffuse + reflectedLight.indirectDiffuse, vec3(0.2126, 0.7152, 0.0722));
  reflectedLight.directDiffuse = vec3(0.0);
  reflectedLight.indirectDiffuse = bTint * bLight * uLift;
}
`;

/** A strand is a thin cylinder seen side on, so the normal rolls across its width and the highlight is a line. */
const FRAG_NORMAL = /* glsl */ `
if (vStrand.z >= 0.0) {
  float bRoll = clamp(bAcross / bHalf, -1.0, 1.0);
  normal = normalize(normalize(vSide) * bRoll + normal * sqrt(1.0 - bRoll * bRoll));
}
`;

/** The soft knee of the bloom starts at 0.55. Below that, nothing here can reach it. */
const FRAG_LIMIT = /* glsl */ `
gl_FragColor.rgb = min(gl_FragColor.rgb, vec3(0.5));
#include <tonemapping_fragment>
`;

function strip(): THREE.BufferGeometry {
  const position: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    position.push(-1, i / SEGMENTS, 0, 1, i / SEGMENTS, 0);
    if (i < SEGMENTS) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  g.setIndex(index);
  return g;
}

/** Where a dragged path stands against a plane, at time t. Positive is in front of it. */
function height(h: number, hv: number, ha: number, k: number, t: number): number {
  const f = (1 - Math.exp(-k * t)) / k;
  return h + hv * f + (ha * (t - f)) / k;
}

const SCAN_STEP = 0.07;
/** Seconds. Anything still in the air by then is over a drop, and no stain is owed. */
const MAX_FLIGHT = 1.6;

/**
 * First time a dragged path crosses a plane, or `limit` if it never does. `h` is the start height above
 * the plane, `hv` and `ha` the velocity and acceleration along its normal. A coarse scan brackets the
 * crossing and a few bisections pin it down. There is no closed form once drag is in.
 */
export function crossing(h: number, hv: number, ha: number, k: number, limit: number): number {
  if (h <= 0) return limit;
  for (let t = SCAN_STEP; t < limit + SCAN_STEP; t += SCAN_STEP) {
    if (height(h, hv, ha, k, t) > 0) continue;
    let lo = t - SCAN_STEP;
    let hi = t;
    for (let i = 0; i < 6; i++) {
      const mid = (lo + hi) * 0.5;
      if (height(h, hv, ha, k, mid) > 0) lo = mid;
      else hi = mid;
    }
    return hi;
  }
  return limit;
}

/** Plane a burst can land on, in addition to its floor. */
export interface BloodWall {
  x: number; y: number; z: number;
  nx: number; ny: number; nz: number;
}

/** Everything `add` works out about where a strand ends. Reused, so emission makes no garbage. */
export interface Landing {
  /** Seconds in flight. */
  time: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** Surface normal, or all zero when the strand ran out of life in the air. */
  nx: number; ny: number; nz: number;
}

export class BloodLayer {
  readonly ring: InstanceRing;
  readonly landing: Landing = { time: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, nx: 0, ny: 0, nz: 0 };

  private birth = 0;
  private gravity = -14;
  private floor = -1e6;
  private wall: BloodWall | null = null;
  private tone = 0;

  constructor(scene: THREE.Scene, uniforms: FxUniforms, materials: MaterialLibrary, cap = 1200) {
    this.ring = new InstanceRing(strip(), cap, ATTRS);
    const material = new THREE.MeshStandardMaterial({
      name: 'fx.blood', roughness: 0.16, metalness: 0, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const own = {
      uMinPx: { value: 1.3 },
      uLift: { value: 3.2 },
      uVenous: { value: new THREE.Vector3(BLOOD.venous.r, BLOOD.venous.g, BLOOD.venous.b) },
      uArterial: { value: new THREE.Vector3(BLOOD.arterial.r, BLOOD.arterial.g, BLOOD.arterial.b) },
    };
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, uniforms, own);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
        .replace('#include <beginnormal_vertex>', VERT_NORMAL)
        .replace('#include <begin_vertex>', VERT_POSITION)
        .replace('#include <project_vertex>', VERT_PROJECT);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <map_pars_fragment>', `#include <map_pars_fragment>\n${FRAG_PARS}`)
        .replace('#include <map_fragment>', FRAG_COVER)
        .replace('#include <normal_fragment_maps>', FRAG_NORMAL)
        .replace('#include <lights_fragment_end>', FRAG_LIGHT)
        .replace('#include <tonemapping_fragment>', FRAG_LIMIT);
    };
    const mesh = new THREE.Mesh(this.ring.geometry, materials.patch(material) ?? material);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.receiveShadow = true;
    mesh.renderOrder = ORDER.blood;
    mesh.name = 'fx.blood';
    this.ring.object = mesh;
    scene.add(mesh);
  }

  /** Starts a burst. `tone` runs from dark venous at 0 to brighter arterial at 1. */
  begin(birth: number, floor: number, wall: BloodWall | null, tone: number, gravity = -14): this {
    this.birth = birth;
    this.floor = floor;
    this.wall = wall;
    this.tone = tone;
    this.gravity = gravity;
    return this;
  }

  setTone(tone: number): void {
    this.tone = tone;
  }

  /**
   * One strand, `delay` seconds from now. `half` is its half width in meters, `trail` how many seconds of
   * its path it shows, `drag` how fast the air stops it. Returns where it ends, in `this.landing`.
   */
  add(
    x: number, y: number, z: number, vx: number, vy: number, vz: number,
    half: number, trail: number, drag: number, delay = 0,
  ): Landing {
    const l = this.landing;
    const g = this.gravity;
    const k = Math.max(drag, 0.001);
    let stop = crossing(y - this.floor, vy, g, k, MAX_FLIGHT);
    l.nx = 0;
    l.ny = stop < MAX_FLIGHT ? 1 : 0;
    l.nz = 0;
    const w = this.wall;
    if (w) {
      const h = (x - w.x) * w.nx + (y - w.y) * w.ny + (z - w.z) * w.nz;
      const t = crossing(h, vx * w.nx + vy * w.ny + vz * w.nz, g * w.ny, k, stop);
      if (t < stop) {
        stop = t;
        l.nx = w.nx;
        l.ny = w.ny;
        l.nz = w.nz;
      }
    }

    const ring = this.ring;
    const d = ring.data;
    const birth = this.birth + delay;
    const life = stop + trail;
    const o = ring.alloc(birth + life);
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = z;
    d[o + 3] = birth;
    d[o + 4] = vx;
    d[o + 5] = vy;
    d[o + 6] = vz;
    d[o + 7] = life;
    d[o + 8] = this.tone;
    d[o + 9] = half;
    d[o + 10] = trail;
    d[o + 11] = 1;
    d[o + 12] = g;
    d[o + 13] = k;
    d[o + 14] = stop;
    d[o + 15] = Math.random();

    const e = Math.exp(-k * stop);
    const f = (1 - e) / k;
    l.time = stop;
    l.x = x + vx * f;
    l.y = y + vy * f + (g * (stop - f)) / k;
    l.z = z + vz * f;
    l.vx = vx * e;
    l.vy = vy * e + g * f;
    l.vz = vz * e;
    return l;
  }

  /** A soft puff of very fine drops. It moves with the strands but never lands, it only thins out. */
  mist(x: number, y: number, z: number, vx: number, vy: number, vz: number, half: number, life: number, drag: number, opacity: number, delay = 0): void {
    const ring = this.ring;
    const d = ring.data;
    const birth = this.birth + delay;
    const o = ring.alloc(birth + life);
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = z;
    d[o + 3] = birth;
    d[o + 4] = vx;
    d[o + 5] = vy;
    d[o + 6] = vz;
    d[o + 7] = life;
    d[o + 8] = this.tone;
    d[o + 9] = half;
    d[o + 10] = 0;
    d[o + 11] = -opacity;
    d[o + 12] = this.gravity * 0.1;
    d[o + 13] = drag;
    d[o + 14] = life;
    d[o + 15] = Math.random();
  }

  sync(now: number): void {
    this.ring.sync(now);
  }
}
