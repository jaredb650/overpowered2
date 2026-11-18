/**
 * The implants as parts on the contractor (docs/proposals/implants.md, "How they look"). Each implant is a piece of hardware on
 * one region of his body: Gun implants replace the left forearm (the one in view in first person), Kill implants are visors, Move implants are on both shins, and
 * the core is a spine down his back. Built here from three.js primitives, in the game's way: dark steel and polymer lit by the
 * scene, with an unlit HDR glow in the perk's colour, so the bloom picks it out at a glance.
 *
 * The parts mount on bones, never baked into a model:
 *   dressBody(body, worn)        the baked contractor (menu backdrop, the shop's studio): parts on his bones, shown or hidden
 *   wearOnViewmodel(ctx, gun)    the first-person left arm: the Gun implant's forearm and knuckles on the arm's own bones
 *
 * A part is built once per body in a canonical frame and placed by a matrix, so one design serves both rigs:
 *   forearm  origin at the wrist, +Y up the forearm to the elbow, +Z the back of the forearm (out, when the arm hangs)
 *   hand     origin at the wrist, +Y along the fingers, +Z the back of the hand
 *   upper    origin at the shoulder, +Y up the arm from the elbow, +Z outward
 *   head, shin, chest   the bone's own axes (+Y up, +Z the way he faces, +X his left)
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Ctx } from '../core/contracts';
import { IMPLANTS, JUMP_JET, type ImplantId } from '../progression/implants';
import { EFFECTS } from '../progression/data';
import type { Character } from './Character';
import { HumanoidBone as H } from './rig';

export type PartId = ImplantId | 'core';
type Layer = 'metal' | 'plate' | 'glow';
type V3 = readonly [number, number, number];

/** Accent per part: the perk's own colour, nudged where two perks share one (Blood Thirst and Berserk are both #ff0000). */
const ACCENT: Readonly<Record<PartId, string>> = {
  bloodthirst: '#ff1a3a', hellfire: EFFECTS.hellfire.color, berserk: '#ff3018', butcher: EFFECTS.butcher.color,
  chainReaction: EFFECTS.chainReaction.color, chainStorm: '#9a8cff', skyfall: EFFECTS.skyfall.color, overdrive: EFFECTS.overdrive.color,
  jumpJet: JUMP_JET.color, core: '#ff2a22',
};
/** Glow strength: above 1 is HDR, which the bloom spreads. */
const GLOW = 2.6;
const CARBON = 0x1b1d21;
const POLY = 0x3c4048;
const STEEL = 0x9aa1ab;
const DARK_STEEL = 0x50555d;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/** Collects primitives into three merged meshes: metal, painted plate and glow. Three draw calls a part at most. */
class Builder {
  private readonly parts: Record<Layer, THREE.BufferGeometry[]> = { metal: [], plate: [], glow: [] };

  add(layer: Layer, geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, at: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): this {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.deleteAttribute('uv');
    _q.setFromEuler(_e.set(rot[0], rot[1], rot[2]));
    g.applyMatrix4(_m.compose(_v.set(at[0], at[1], at[2]), _q, _s.set(scale[0], scale[1], scale[2])));
    g.computeVertexNormals();
    _c.set(color);
    if (layer === 'glow') _c.multiplyScalar(GLOW);
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([_c.r, _c.g, _c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.parts[layer].push(g);
    return this;
  }

  box(layer: Layer, w: number, h: number, d: number, color: THREE.ColorRepresentation, at?: V3, rot?: V3): this {
    return this.add(layer, new THREE.BoxGeometry(w, h, d), color, at, rot);
  }

  /** An armour plate: a box with its edges rounded, so the light runs along them. */
  plate(layer: Layer, w: number, h: number, d: number, color: THREE.ColorRepresentation, at?: V3, rot?: V3): this {
    return this.add(layer, new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * 0.45), color, at, rot);
  }

  /** A cylinder along +Y. */
  cyl(layer: Layer, r0: number, r1: number, h: number, color: THREE.ColorRepresentation, at?: V3, rot?: V3, seg = 14): this {
    return this.add(layer, new THREE.CylinderGeometry(r1, r0, h, seg), color, at, rot);
  }

  /**
   * A shell round the +Y axis from y0 (radius r0) to y1 (radius r1), centred on +Z and `arc` radians wide. Open, so the
   * materials are double sided.
   */
  shell(layer: Layer, r0: number, r1: number, y0: number, y1: number, arc: number, color: THREE.ColorRepresentation, centre = 0, seg = 20): this {
    const g = new THREE.CylinderGeometry(r1, r0, y1 - y0, seg, 1, arc >= Math.PI * 2 - 1e-3 ? false : true, centre - arc / 2, arc);
    return this.add(layer, g, color, [0, (y0 + y1) / 2, 0]);
  }

  /** A ring round the +Y axis at height y, or an arc of one centred on +Z. */
  ring(layer: Layer, r: number, tube: number, y: number, color: THREE.ColorRepresentation, arc = Math.PI * 2, scale: V3 = [1, 1, 1]): this {
    const g = new THREE.TorusGeometry(r, tube, 8, 28, arc);
    // The torus's arc starts on +X and turns toward +Y. Centre it on +Y, then lay it flat so +Y goes to +Z.
    g.rotateZ(Math.PI / 2 - arc / 2);
    g.rotateX(Math.PI / 2);
    return this.add(layer, g, color, [0, y, 0], [0, 0, 0], scale);
  }

  group(mats: ImplantMaterials): THREE.Group {
    const out = new THREE.Group();
    for (const layer of ['metal', 'plate', 'glow'] as const) {
      const list = this.parts[layer];
      if (!list.length) continue;
      const mesh = new THREE.Mesh(mergeGeometries(list, false), mats[layer]);
      mesh.castShadow = false;
      mesh.frustumCulled = false;
      out.add(mesh);
    }
    return out;
  }
}

export interface ImplantMaterials {
  metal: THREE.Material;
  plate: THREE.Material;
  glow: THREE.Material;
}

function makeMaterials(patch: (m: THREE.MeshStandardMaterial) => THREE.MeshStandardMaterial = m => m): ImplantMaterials {
  return {
    metal: patch(new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.85, roughness: 0.3, side: THREE.DoubleSide })),
    plate: patch(new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.25, roughness: 0.55, side: THREE.DoubleSide })),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false, side: THREE.DoubleSide }),
  };
}

let plain: ImplantMaterials | null = null;
/** For the scenes the world renderer does not light: the menu's cabin and the shop's studio. */
export const plainMaterials = (): ImplantMaterials => (plain ??= makeMaterials());

// --- The parts ---------------------------------------------------------------------------------------------------

/** The forearm the parts wrap: its length, and its radius at the wrist and at the elbow. */
interface Fore { len: number; rw: number; re: number; }
const radiusAt = (f: Fore, y: number) => f.rw + (f.re - f.rw) * Math.min(1, Math.max(0, y / f.len));

/** Two glass lines of blood from the wrist to the elbow, a vial in a cage on the back of the wrist, and a band at each end. */
function bloodthirstFore(b: Builder, f: Fore): void {
  const a = ACCENT.bloodthirst;
  const L = f.len;
  b.ring('metal', radiusAt(f, 0.035) + 0.004, 0.008, 0.035, DARK_STEEL);
  b.ring('metal', radiusAt(f, L - 0.04) + 0.004, 0.009, L - 0.04, DARK_STEEL);
  b.shell('plate', radiusAt(f, 0.04) + 0.003, radiusAt(f, L - 0.045) + 0.003, 0.04, L - 0.045, 1.25, CARBON);
  for (const k of [-1, 1]) {
    const ang = k * 0.42;
    const y0 = 0.04, y1 = L - 0.045;
    const r = (radiusAt(f, y0) + radiusAt(f, y1)) / 2 + 0.011;
    const rx = Math.sin(ang) * r, rz = Math.cos(ang) * r;
    // A tube leans with the cone, so it lies on the surface all the way.
    const lean = Math.atan2(radiusAt(f, y1) - radiusAt(f, y0), y1 - y0);
    b.cyl('glow', 0.0062, 0.0062, y1 - y0, a, [rx, (y0 + y1) / 2, rz], [lean * Math.cos(ang), 0, -lean * Math.sin(ang)], 8);
    for (const y of [0.075, L * 0.55, L - 0.075]) b.box('metal', 0.016, 0.006, 0.016, STEEL, [rx, y, rz], [0, ang, 0]);
  }
  // The vial, standing proud on the back of the wrist.
  const z = radiusAt(f, 0.1) + 0.026;
  b.cyl('glow', 0.0125, 0.0125, 0.056, a, [0, 0.1, z]);
  for (const y of [0.068, 0.132]) b.cyl('metal', 0.0175, 0.0175, 0.01, STEEL, [0, y, z]);
  for (let i = 0; i < 3; i++) {
    const t = (i / 3) * Math.PI * 2 + 0.5;
    b.cyl('metal', 0.0024, 0.0024, 0.064, DARK_STEEL, [Math.sin(t) * 0.0155, 0.1, z + Math.cos(t) * 0.0155], [0, 0, 0], 6);
  }
  b.box('metal', 0.012, 0.05, 0.016, DARK_STEEL, [0, 0.1, z - 0.017]);
}

/** A furnace sleeve: dark fins over an orange glow, vented down both sides, two exhaust pipes to the elbow. */
function hellfireFore(b: Builder, f: Fore): void {
  const a = ACCENT.hellfire;
  const L = f.len;
  b.shell('glow', radiusAt(f, 0.03) + 0.012, radiusAt(f, L - 0.03) + 0.012, 0.03, L - 0.03, 3.6, a);
  b.shell('plate', radiusAt(f, 0.015) + 0.009, radiusAt(f, L - 0.015) + 0.009, 0.015, L - 0.015, 4.8, 0x2c2622);
  const fins = 7;
  for (let i = 0; i < fins; i++) {
    const y = 0.035 + (i / (fins - 1)) * (L - 0.07);
    const r = radiusAt(f, y) + 0.026;
    b.shell('metal', r, r, y - 0.0055, y + 0.0055, 3.9, 0x2a2b2f);
    // A fin is a short cylinder wall: cap its outer edge so it reads as a plate, not a ribbon.
    b.ring('metal', r, 0.0045, y, 0x34363b, 3.9);
  }
  for (const k of [-1, 1]) {
    const ang = k * 2.05;
    const r = radiusAt(f, L * 0.5) + 0.018;
    const x = Math.sin(ang) * r, z = Math.cos(ang) * r;
    b.cyl('metal', 0.009, 0.011, L * 0.9, DARK_STEEL, [x, L * 0.5, z], [0, 0, 0], 10);
    b.cyl('glow', 0.007, 0.007, 0.012, a, [x, L * 0.95 + 0.006, z], [0, 0, 0], 10);
    b.cyl('metal', 0.0135, 0.0135, 0.014, STEEL, [x, L * 0.95 - 0.004, z], [0, 0, 0], 10);
  }
  b.ring('metal', radiusAt(f, 0.012) + 0.01, 0.0075, 0.012, STEEL);
}

/** A slab of armour: a thick sleeve, plates layered over it, red seams and a lit core on the back. */
function berserkFore(b: Builder, f: Fore): void {
  const a = ACCENT.berserk;
  const L = f.len;
  const rw = radiusAt(f, 0) + 0.024, re = radiusAt(f, L) + 0.03;
  b.cyl('plate', rw, re, L + 0.01, 0x232429, [0, L / 2, 0], [0, 0, 0], 18);
  b.ring('glow', radiusAt(f, L * 0.36) + 0.028, 0.0035, L * 0.36, a);
  b.ring('glow', radiusAt(f, L * 0.7) + 0.031, 0.0035, L * 0.7, a);
  // Plates: one wide on the back, one each side, a lip over the wrist.
  const plate = (ang: number, y: number, w: number, h: number, out: number, tilt: number) => {
    const r = radiusAt(f, y) + out;
    b.plate('metal', w, h, 0.018, 0x4a4e57, [Math.sin(ang) * r, y, Math.cos(ang) * r], [tilt, ang, 0]);
  };
  plate(0, L * 0.22, 0.07, 0.085, 0.038, -0.12);
  plate(0, L * 0.53, 0.078, 0.075, 0.042, -0.1);
  plate(0, L * 0.82, 0.084, 0.07, 0.046, -0.08);
  for (const k of [-1, 1]) {
    plate(k * 1.25, L * 0.35, 0.055, 0.1, 0.034, 0);
    plate(k * 1.25, L * 0.72, 0.06, 0.09, 0.038, 0);
  }
  // The core on the back plate: what says "you cannot die".
  const zc = radiusAt(f, L * 0.53) + 0.051;
  b.cyl('glow', 0.016, 0.016, 0.006, a, [0, L * 0.53, zc], [Math.PI / 2, 0, 0], 16);
  b.add('metal', new THREE.TorusGeometry(0.019, 0.004, 6, 20), STEEL, [0, L * 0.53, zc + 0.002]);
  b.ring('metal', rw + 0.004, 0.009, 0.004, DARK_STEEL);
}

/** Berserk's knuckle plate, over the back of the hand, in the hand frame (+Y along the fingers, +Z its back). */
function berserkHand(b: Builder): void {
  b.plate('metal', 0.08, 0.065, 0.016, 0x4a4e57, [0, 0.05, 0.036], [0.12, 0, 0]);
  for (let i = 0; i < 4; i++) b.plate('metal', 0.018, 0.02, 0.018, 0x2e3036, [-0.029 + i * 0.0195, 0.088, 0.04], [0.2, 0, 0]);
  b.box('glow', 0.066, 0.004, 0.004, ACCENT.berserk, [0, 0.07, 0.0455], [0.12, 0, 0]);
}

/** Berserk's pauldron: stacked plates over the shoulder. Not in first person, where the shoulder is off screen. */
function berserkUpper(b: Builder): void {
  const a = ACCENT.berserk;
  // Domes over the top of the shoulder, each a step further down the arm, tipped out.
  for (let i = 0; i < 3; i++) {
    const r = 0.115 - i * 0.012;
    const g = new THREE.SphereGeometry(r, 20, 8, 0, Math.PI * 2, 0, Math.PI * 0.4);
    b.add(i === 0 ? 'metal' : 'plate', g, i === 0 ? 0x4a4e57 : 0x2c2e34, [0, -0.035 - i * 0.05, 0.045], [0.35, 0, 0], [1, 0.8, 1.05]);
  }
  b.add('glow', new THREE.TorusGeometry(0.105, 0.0045, 6, 32), a, [0, -0.057, 0.05], [Math.PI / 2 + 0.35, 0, 0], [1, 1.05, 1]);
}

/** The head: a visor band at eye level, as wide as the helmet's front. */
interface Head { y: number; z: number; r: number; }

function visorBand(b: Builder, h: Head, arc: number, depth: number, color: number): void {
  b.ring('plate', h.r, depth, h.y, color, arc, [1, 1.3, 1.08]);
}

/** One narrow slot with one bright line across it, and a cleaver's crest over the crown. */
function butcherHead(b: Builder, h: Head): void {
  const a = ACCENT.butcher;
  visorBand(b, h, Math.PI * 1.05, 0.017, 0x15161a);
  b.ring('glow', h.r + 0.021, 0.0045, h.y, a, Math.PI * 0.9, [1, 1, 1.08]);
  b.ring('metal', h.r + 0.004, 0.0045, h.y + 0.024, DARK_STEEL, Math.PI * 1.05, [1, 1, 1.08]);
  // The crest: a blade standing fore and aft over the crown, its edge lit.
  const top = h.y + 0.125;
  const shape = new THREE.Shape();
  shape.moveTo(-0.1, 0);
  shape.lineTo(0.08, 0);
  shape.quadraticCurveTo(0.11, 0.03, 0.06, 0.05);
  shape.lineTo(-0.08, 0.035);
  shape.lineTo(-0.1, 0);
  const blade = new THREE.ExtrudeGeometry(shape, { depth: 0.008, bevelEnabled: false, curveSegments: 6 });
  b.add('metal', blade, 0x6a7079, [0.004, top - 0.02, h.z - 0.005], [0, -Math.PI / 2, 0], [1, 1.3, 1]);
  b.box('glow', 0.004, 0.005, 0.16, a, [0, top + 0.022, h.z - 0.01], [-0.14, 0, 0]);
}

/** Five amber lenses in a row that count the dead, and a fuse can at the left temple. */
function chainReactionHead(b: Builder, h: Head): void {
  const a = ACCENT.chainReaction;
  visorBand(b, h, Math.PI * 1.05, 0.02, 0x1a1b1f);
  for (let i = 0; i < 5; i++) {
    const ang = (i - 2) * 0.34;
    const r = h.r * 1.08 + 0.016;
    const at: V3 = [Math.sin(ang) * r * 0.93, h.y + 0.002, h.z + Math.cos(ang) * r];
    const big = i === 2 ? 1.25 : 1;
    b.cyl('glow', 0.0125 * big, 0.0125 * big, 0.006, a, at, [Math.PI / 2, 0, ang], 14);
    b.add('metal', new THREE.TorusGeometry(0.0145 * big, 0.003, 6, 16), STEEL, at, [0, ang, 0]);
  }
  b.cyl('metal', 0.014, 0.014, 0.05, DARK_STEEL, [h.r * 1.02 + 0.012, h.y + 0.01, h.z - 0.03], [Math.PI / 2, 0, 0], 12);
  b.cyl('glow', 0.008, 0.008, 0.052, a, [h.r * 1.02 + 0.012, h.y + 0.01, h.z - 0.03], [Math.PI / 2, 0, 0], 10);
}

/** A visor that hums, and two coils at the temples with lit tips. */
function chainStormHead(b: Builder, h: Head): void {
  const a = ACCENT.chainStorm;
  visorBand(b, h, Math.PI * 1.1, 0.019, 0x17171d);
  b.ring('glow', h.r + 0.015, 0.006, h.y, a, Math.PI * 0.75, [1, 1.2, 1.08]);
  for (const k of [-1, 1]) {
    const x = k * (h.r * 1.04 + 0.01);
    const base: V3 = [x, h.y + 0.02, h.z - 0.02];
    b.cyl('metal', 0.012, 0.009, 0.03, DARK_STEEL, base, [0, 0, -k * 0.25], 10);
    const tilt = -k * 0.25;
    const up = (d: number): V3 => [base[0] - Math.sin(tilt) * d, base[1] + Math.cos(tilt) * d, base[2]];
    b.cyl('metal', 0.003, 0.003, 0.11, STEEL, up(0.07), [0, 0, tilt], 6);
    for (let i = 0; i < 4; i++) b.add('metal', new THREE.TorusGeometry(0.009 - i * 0.0012, 0.0022, 6, 14), 0xb8862f, up(0.035 + i * 0.018), [Math.PI / 2, 0, tilt]);
    b.add('glow', new THREE.SphereGeometry(0.0075, 10, 8), a, up(0.128));
  }
}

/** A shin's length and which side is the outside. */
interface Shin { len: number; side: 1 | -1; }

/** A thruster on the outside of the calf, nozzle down and lit, with a blue flame; a stabiliser ring at the ankle. */
function skyfallShin(b: Builder, s: Shin): void {
  const a = ACCENT.skyfall;
  const x = s.side * 0.072;
  const yc = -s.len * 0.5, z = -0.03;
  // The mount: a saddle round the back of the calf, and an arm out to the pod.
  b.shell('plate', 0.062, 0.058, yc - 0.02, yc + 0.07, 2.2, 0x2a2e35, s.side > 0 ? 2.1 : -2.1);
  b.plate('metal', 0.03, 0.06, 0.03, DARK_STEEL, [s.side * 0.05, yc + 0.03, z]);
  // The pod.
  b.cyl('plate', 0.032, 0.036, 0.17, 0x353a43, [x, yc, z], [0, 0, 0], 18);
  b.add('metal', new THREE.SphereGeometry(0.032, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0x4a4f58, [x, yc + 0.085, z]);
  for (const y of [yc + 0.055, yc - 0.035]) b.add('metal', new THREE.TorusGeometry(0.036, 0.0045, 6, 20), STEEL, [x, y, z], [Math.PI / 2, 0, 0]);
  // A lit strip down the outside, and two vents.
  b.box('glow', 0.006, 0.12, 0.012, a, [x + s.side * 0.034, yc + 0.005, z]);
  for (const y of [yc + 0.02, yc - 0.01]) b.box('glow', 0.004, 0.006, 0.03, a, [x, y, z - 0.034]);
  // The nozzle: a bell, open, the burner lit inside, and a short flame.
  b.add('metal', new THREE.CylinderGeometry(0.027, 0.04, 0.045, 18, 1, true), 0x7a808a, [x, yc - 0.107, z]);
  b.add('glow', new THREE.CircleGeometry(0.028, 18), a, [x, yc - 0.092, z], [Math.PI / 2, 0, 0]);
  b.add('glow', new THREE.ConeGeometry(0.026, 0.05, 16, 1, true), a, [x, yc - 0.152, z], [Math.PI, 0, 0]);
  // The stabiliser ring at the ankle, lit on the outside.
  const ankle = -s.len + 0.045;
  b.add('metal', new THREE.TorusGeometry(0.06, 0.008, 6, 24), DARK_STEEL, [0, ankle, 0.005], [Math.PI / 2, 0, 0], [1, 1.1, 1]);
  b.add('glow', new THREE.TorusGeometry(0.06, 0.0035, 6, 24, Math.PI), a, [0, ankle - 0.004, 0.005], [Math.PI / 2, 0, s.side > 0 ? -Math.PI / 2 : Math.PI / 2], [1, 1.1, 1]);
}

/** A carbon sprinter blade behind the calf, lit down both faces, and an actuator drum on the outside of the knee. */
function overdriveShin(b: Builder, s: Shin): void {
  const a = ACCENT.overdrive;
  const L = s.len;
  // The blade's spine in the leg's side view (u fore and aft, v up): down the back of the calf, round under the heel, a toe kick.
  const spine = new THREE.CatmullRomCurve3([
    new THREE.Vector2(-0.07, 0.0), new THREE.Vector2(-0.125, -L * 0.36), new THREE.Vector2(-0.12, -L * 0.74),
    new THREE.Vector2(-0.09, -L - 0.035), new THREE.Vector2(-0.045, -L - 0.07),
  ].map(v => new THREE.Vector3(v.x, v.y, 0)));
  const n = 48;
  const outer: THREE.Vector2[] = [];
  const inner: THREE.Vector2[] = [];
  const faces: THREE.Vector3[][] = [[], []];
  const width = 0.036;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = spine.getPoint(t);
    const tan = spine.getTangent(t);
    const nx = -tan.y, ny = tan.x;
    // Thick at the knee, thin where it flexes.
    const w = 0.015 + 0.016 * (1 - t);
    outer.push(new THREE.Vector2(p.x - nx * w, p.y - ny * w));
    inner.push(new THREE.Vector2(p.x + nx * w * 0.5, p.y + ny * w * 0.5));
    // A lit line down each face, just off the blade.
    if (t > 0.04 && t < 0.9) for (const k of [0, 1]) faces[k]!.push(new THREE.Vector3((k ? 1 : -1) * (width / 2 + 0.0035), p.y - ny * w * 0.2, p.x - nx * w * 0.2));
  }
  const shape = new THREE.Shape([...outer, ...inner.reverse()]);
  const blade = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, bevelSegments: 2, curveSegments: 8 });
  // The shape is drawn in (u, v) and extruded along +Z: turn it so u runs along +Z and the extrusion across the leg.
  blade.rotateY(-Math.PI / 2);
  b.add('metal', blade, 0x5a606a, [width / 2, 0, 0]);
  for (const f of faces) b.add('glow', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(f), 40, 0.0028, 5), a);
  // The cuff that holds it under the knee.
  b.shell('plate', 0.064, 0.06, -0.12, -0.05, 2.4, 0x30333a, Math.PI);
  // The actuator on the outside of the knee: a drum on the joint's axis, its rim lit.
  const x = s.side * 0.07;
  b.cyl('metal', 0.032, 0.032, 0.026, DARK_STEEL, [x, 0, -0.005], [0, 0, Math.PI / 2], 20);
  b.cyl('metal', 0.02, 0.02, 0.03, STEEL, [x + s.side * 0.004, 0, -0.005], [0, 0, Math.PI / 2], 16);
  b.add('glow', new THREE.TorusGeometry(0.032, 0.0032, 6, 24), a, [x + s.side * 0.014, 0, -0.005], [0, Math.PI / 2, 0]);
  b.plate('metal', 0.018, 0.1, 0.03, 0x30333a, [x - s.side * 0.004, -0.06, -0.02], [-0.1, 0, 0]);
}

/** A chamfered outline in XY, `w` by `h`, centred `oy` above the origin, corners cut by `c`. */
function chamfered(w: number, h: number, c: number, oy = 0): THREE.Shape {
  const x = w / 2, y = h / 2;
  return new THREE.Shape([
    [-x + c, -y], [x - c, -y], [x, -y + c], [x, y - c], [x - c, y], [-x + c, y], [-x, y - c], [-x, -y + c],
  ].map(([u, v]) => new THREE.Vector2(u!, v! + oy)));
}

/**
 * Jump Jet: two fuel cells on a mount plate across his back, a bell nozzle under each, a crossover pipe over the top. The plate
 * is slotted down the middle, so the core's spine still shows between the cells.
 */
function jumpJetBack(b: Builder, back: number): void {
  const a = ACCENT.jumpJet;
  // The mount plate, bevelled, with the slot for the spine cut through it.
  const plate = chamfered(0.24, 0.29, 0.04);
  plate.holes.push(chamfered(0.056, 0.23, 0.014, 0.02));
  const pz = back - 0.046;
  b.add('plate', new THREE.ExtrudeGeometry(plate, { depth: 0.012, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 2 }),
    0x2a2e35, [0, 0.16, pz]);
  const cz = back - 0.078;
  const cell = new THREE.LatheGeometry([
    [0.0, 0.0], [0.03, 0.0], [0.04, 0.008], [0.044, 0.024], [0.044, 0.25], [0.04, 0.268], [0.026, 0.282], [0.0, 0.288],
  ].map(([r, y]) => new THREE.Vector2(r!, y!)), 24);
  for (const k of [-1, 1]) {
    const x = k * 0.079;
    b.add('plate', cell.clone(), 0x3a3f48, [x, 0.02, cz]);
    // Steel bands, and a lit line down the outer back of each cell, set into it.
    for (const y of [0.07, 0.25]) b.add('metal', new THREE.TorusGeometry(0.0455, 0.0042, 6, 24), STEEL, [x, y, cz], [Math.PI / 2, 0, 0]);
    const t = k * 0.65;
    b.box('glow', 0.004, 0.13, 0.004, a, [x + Math.sin(t) * 0.0425, 0.16, cz - Math.cos(t) * 0.0425], [0, t, 0]);
    // The clamp that holds the cell to the plate.
    b.plate('metal', 0.03, 0.05, 0.026, DARK_STEEL, [k * 0.062, 0.16, cz + 0.03]);
    // A valve on top.
    b.cyl('metal', 0.011, 0.011, 0.02, STEEL, [x, 0.315, cz], [0, 0, 0], 12);
    // The nozzle: a neck, then a bell, open, its burner lit inside and a thin lit lip.
    b.cyl('metal', 0.022, 0.026, 0.02, DARK_STEEL, [x, 0.012, cz], [0, 0, 0], 18);
    b.add('metal', new THREE.CylinderGeometry(0.022, 0.035, 0.05, 20, 1, true), 0x7a808a, [x, -0.022, cz]);
    b.add('glow', new THREE.CircleGeometry(0.021, 18), a, [x, -0.004, cz], [Math.PI / 2, 0, 0]);
    b.add('glow', new THREE.TorusGeometry(0.0352, 0.0018, 5, 24), a, [x, -0.047, cz], [Math.PI / 2, 0, 0]);
  }
  // The manifold between the nozzles, and the crossover pipe over the top.
  b.add('metal', new THREE.ExtrudeGeometry(chamfered(0.1, 0.026, 0.008), { depth: 0.024, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, bevelSegments: 1 }),
    DARK_STEEL, [0, 0.03, cz - 0.012]);
  const pipe = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.079, 0.3, cz), new THREE.Vector3(0.045, 0.34, cz + 0.006), new THREE.Vector3(-0.045, 0.34, cz + 0.006),
    new THREE.Vector3(-0.079, 0.3, cz),
  ]);
  b.add('metal', new THREE.TubeGeometry(pipe, 24, 0.0055, 8), STEEL);
}

/** Standard issue: a spine down his back, vertebra plates over a red line. Small, because it is always there. */
function coreChest(b: Builder, back: number): void {
  const a = ACCENT.core;
  for (let i = 0; i < 6; i++) {
    const y = 0.33 - i * 0.05;
    const w = 0.05 - i * 0.003;
    b.box('metal', w, 0.03, 0.016, i % 2 ? 0x30333a : 0x3a3e46, [0, y, back - 0.012 + i * 0.002], [0.05 * i, 0, 0]);
  }
  b.box('glow', 0.006, 0.28, 0.004, a, [0, 0.2, back - 0.019]);
  b.cyl('metal', 0.016, 0.016, 0.02, DARK_STEEL, [0, 0.38, back + 0.035], [Math.PI / 2 + 0.4, 0, 0], 12);
}

// --- Fitting them to the baked contractor ------------------------------------------------------------------------

/** Where each part goes on the body. */
const BODY_PARTS: Readonly<Record<PartId, readonly { bone: number; kind: 'fore' | 'hand' | 'upper' | 'head' | 'shinL' | 'shinR' | 'chest' | 'back' }[]>> = {
  bloodthirst: [{ bone: H.foreArmL, kind: 'fore' }],
  hellfire: [{ bone: H.foreArmL, kind: 'fore' }],
  berserk: [{ bone: H.foreArmL, kind: 'fore' }, { bone: H.handL, kind: 'hand' }, { bone: H.upperArmL, kind: 'upper' }],
  butcher: [{ bone: H.head, kind: 'head' }],
  chainReaction: [{ bone: H.head, kind: 'head' }],
  chainStorm: [{ bone: H.head, kind: 'head' }],
  skyfall: [{ bone: H.shinL, kind: 'shinL' }, { bone: H.shinR, kind: 'shinR' }],
  overdrive: [{ bone: H.shinL, kind: 'shinL' }, { bone: H.shinR, kind: 'shinR' }],
  jumpJet: [{ bone: H.chest, kind: 'back' }],
  core: [{ bone: H.chest, kind: 'chest' }],
};

/** The baked contractor's forearm and helmet, measured off the model (see docs). Metres. */
const BODY = {
  fore: { rw: 0.044, re: 0.054 },
  head: { y: 0.08, z: 0.012, r: 0.118 },
  /** Just proud of the back panel of the plate carrier, in chest space. */
  back: -0.205,
} as const;

/** A part's matrix from its canonical frame: origin, +Y along `y`, +Z toward `z` (made square to y). */
function frame(origin: THREE.Vector3, y: THREE.Vector3, z: THREE.Vector3, scaleX = 1): THREE.Matrix4 {
  const ay = y.clone().normalize();
  const ax = new THREE.Vector3().crossVectors(ay, z).normalize();
  const az = new THREE.Vector3().crossVectors(ax, ay);
  return new THREE.Matrix4().makeBasis(ax.multiplyScalar(scaleX), ay, az).setPosition(origin);
}

function buildBodyPart(id: PartId, kind: string, body: Character): THREE.Group {
  const bp = body.a.bindPositions;
  const b = new Builder();
  const g = new THREE.Group();
  if (kind === 'fore') {
    const toWrist = bp[H.handL]!.clone().sub(bp[H.foreArmL]!);
    const f: Fore = { len: toWrist.length(), ...BODY.fore };
    if (id === 'bloodthirst') bloodthirstFore(b, f);
    else if (id === 'hellfire') hellfireFore(b, f);
    else berserkFore(b, f);
    g.matrix.copy(frame(toWrist, toWrist.clone().negate(), new THREE.Vector3(1, 0, 0.15)));
  } else if (kind === 'hand') {
    berserkHand(b);
    // The fingers carry on the line of the forearm, the back of the hand out, as the forearm's.
    const toWrist = bp[H.handL]!.clone().sub(bp[H.foreArmL]!);
    g.matrix.copy(frame(new THREE.Vector3(), toWrist, new THREE.Vector3(1, 0, 0.15)));
  } else if (kind === 'upper') {
    berserkUpper(b);
    const toElbow = bp[H.foreArmL]!.clone().sub(bp[H.upperArmL]!);
    g.matrix.copy(frame(new THREE.Vector3(), toElbow.negate(), new THREE.Vector3(1, 0, 0)));
  } else if (kind === 'head') {
    if (id === 'butcher') butcherHead(b, BODY.head);
    else if (id === 'chainReaction') chainReactionHead(b, BODY.head);
    else chainStormHead(b, BODY.head);
  } else if (kind === 'shinL' || kind === 'shinR') {
    const shin = kind === 'shinL' ? H.shinL : H.shinR;
    const s: Shin = { len: bp[shin + 1]!.distanceTo(bp[shin]!), side: kind === 'shinL' ? 1 : -1 };
    if (id === 'skyfall') skyfallShin(b, s);
    else overdriveShin(b, s);
  } else if (kind === 'back') {
    jumpJetBack(b, BODY.back);
    // Raised, so the cells' tops and the pipe show over his shoulders from the front: the menu's man faces the lens.
    g.position.y = 0.08;
  } else {
    coreChest(b, BODY.back);
  }
  const part = b.group(plainMaterials());
  if (kind === 'fore' || kind === 'hand' || kind === 'upper') {
    g.matrixAutoUpdate = false;
    g.matrixWorldNeedsUpdate = true;
  }
  g.add(part);
  g.name = `implant:${id}`;
  return g;
}

const dressed = new WeakMap<Character, Map<PartId, THREE.Object3D[]>>();

/**
 * Shows the parts for `worn` on the baked contractor (and the core's spine always), hiding the rest. Built the first time a body
 * is dressed, then only shown and hidden. They mount as props until the body's reset, so a pooled body comes back bare.
 */
export function dressBody(body: Character, worn: Iterable<ImplantId>): void {
  let parts = dressed.get(body);
  // A reset took them off: build again.
  if (parts && [...parts.values()][0]?.[0]?.parent === null) parts = undefined;
  if (!parts) {
    parts = new Map();
    for (const id of [...Object.keys(IMPLANTS), 'core'] as PartId[]) {
      const list: THREE.Object3D[] = [];
      for (const p of BODY_PARTS[id]) {
        const g = buildBodyPart(id, p.kind, body);
        body.attachProp(p.bone, g, true);
        list.push(g);
      }
      parts.set(id, list);
    }
    dressed.set(body, parts);
  }
  const on = new Set<PartId>(worn);
  on.add('core');
  for (const [id, list] of parts) for (const g of list) g.visible = on.has(id);
}

/**
 * Takes the parts off and frees their geometry, and the plain materials with it: for the menu and the studio giving the model
 * back. A material freed while another body still wears it is only uploaded again on its next draw.
 */
export function undressBody(body: Character): void {
  const parts = dressed.get(body);
  if (!parts) return;
  dressed.delete(body);
  for (const list of parts.values()) {
    for (const g of list) {
      g.removeFromParent();
      g.traverse(o => (o as THREE.Mesh).geometry?.dispose());
    }
  }
  if (plain) for (const m of Object.values(plain)) m.dispose();
  plain = null;
}

// --- First person -------------------------------------------------------------------------------------------------

/** The viewmodel arm's bones (weapons/viewmodels/arms.ts): index 2 is the forearm's twist bone, 3 the hand. */
interface VmArm { bones: THREE.Bone[]; }
/**
 * The first-person left forearm, the one in view on every two-handed gun: twist bone at its middle, wrist half its length down -Z,
 * its section wider than deep. The part starts `from` up from the wrist, past the wrist computer, which stays in sight, and its
 * face turns to -Y, the side with the screen, which is the side the camera sees.
 */
const VM_FORE = { half: 0.135, from: 0.105, rw: 0.05, re: 0.057, wide: 1.12 } as const;

const vmParts = new WeakMap<VmArm, Map<ImplantId, THREE.Object3D[]>>();
const vmMats = new WeakMap<Ctx['render'], ImplantMaterials>();

function buildVmParts(ctx: Ctx, arm: VmArm): Map<ImplantId, THREE.Object3D[]> {
  let mats = vmMats.get(ctx.render);
  if (!mats) {
    const lib = ctx.render.materials as { patch?: <T extends THREE.MeshStandardMaterial>(m: T) => T } | undefined;
    mats = makeMaterials(m => lib?.patch?.(m) ?? m);
    vmMats.set(ctx.render, mats);
  }
  const out = new Map<ImplantId, THREE.Object3D[]>();
  const twist = arm.bones[2]!, hand = arm.bones[3]!;
  const f: Fore = { len: VM_FORE.half * 2 - VM_FORE.from, rw: VM_FORE.rw, re: VM_FORE.re };
  for (const id of ['bloodthirst', 'hellfire', 'berserk'] as const) {
    const b = new Builder();
    if (id === 'bloodthirst') bloodthirstFore(b, f);
    else if (id === 'hellfire') hellfireFore(b, f);
    else berserkFore(b, f);
    const fore = b.group(mats);
    fore.matrixAutoUpdate = false;
    fore.matrix.copy(frame(new THREE.Vector3(0, 0, VM_FORE.from - VM_FORE.half), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0), VM_FORE.wide));
    twist.add(fore);
    const list: THREE.Object3D[] = [fore];
    if (id === 'berserk') {
      const hb = new Builder();
      berserkHand(hb);
      const knuckles = hb.group(mats);
      knuckles.matrixAutoUpdate = false;
      knuckles.matrix.copy(frame(new THREE.Vector3(0, -0.012, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)));
      hand.add(knuckles);
      list.push(knuckles);
    }
    out.set(id, list);
  }
  return out;
}

/**
 * Puts the Gun implant's forearm on the first-person left arm, or takes it off (null). The rig is the viewmodel's own
 * (`ctx.viewmodel`); its left arm is read past the interface, as the shop's studio reads its models. Does nothing until it is built.
 */
export function wearOnViewmodel(ctx: Ctx, gun: ImplantId | null): void {
  const arm = (ctx.viewmodel as unknown as { armL?: VmArm } | undefined)?.armL;
  if (!arm?.bones?.[3]) return;
  let parts = vmParts.get(arm);
  if (!parts) {
    parts = buildVmParts(ctx, arm);
    vmParts.set(arm, parts);
  }
  for (const [id, list] of parts) for (const o of list) o.visible = id === gun;
}
