/**
 * How a trunk breaks (docs/proposals/torso-gore.md). Three ways, and one choice made once per death:
 *
 *  - crack: anything that bursts a body (a rocket, a grenade, a barrel, a shell, a round that obliterates, a frozen body
 *    shattering). The trunk comes apart into 3 to 6 capped pieces: skin outside, flesh, ribs and spine on every broken face.
 *  - waist: one burst in five, for variety. One tilted tear across the belly: the chest and the pelvis, the guts between them.
 *  - blowout: a big single round (`BLOWOUT_ROUNDS`, a shotgun at point blank). The body stays; its far side is opened.
 *
 * The pieces are cut once per archetype from the model in its bind pose (`Character.bakePose(true)`), with every limb and
 * the head already off and capped, and kept: a gib costs a few meshes and bodies, never a cut. Each piece rides the chest
 * or the hips at the moment of the gib, so for a frame it is still the trunk it came from.
 */
import * as THREE from 'three';
import type { CharacterInstance, DamageInfo } from '../core/contracts';
import { HumanoidBone as B } from '../characters/rig';
import { mulberry32 } from '../core/math';
import { cutMesh, weldTable, type BoneCrossing, type CutSide } from './cut';
import type { OrganKind, RibKind } from './organs';
import { buildSlabs, SlabTuning, type Slab } from './slabs';

export type TorsoBreak = 'crack' | 'waist' | 'blowout';

/** Rounds big enough to blow a trunk out through its back. The shotgun's point blank is `POINT_BLANK`. */
export const BLOWOUT_ROUNDS: ReadonlySet<string> = new Set(['sabot', 'awl', 'ultramag', 'piledriver']);
/** Metres from the muzzle at which a shotgun's pellets blow a trunk out. */
export const POINT_BLANK = 3;

export const TorsoTuning = {
  /**
   * A blast of this force or more on the body it bursts cracks the trunk into five or six pieces; a smaller one, and
   * anything that is not a blast (a round that obliterates, a frozen body), into three. The break used to be chosen by
   * force alone, over a line (420) that no weapon reached: a rocket's fireball gives 73 to 84, a grenade's 65 to 74, a
   * barrel's 46 to 74, the Gimlet's grenade 50 to 58. Over `six` (a boss, the nuke) it is always six.
   */
  bigFrom: 60,
  six: 1500,
  /** Of the big ones, the share that go into six pieces and not five. */
  sixShare: 0.4,
  /** A share of bursts that tear at the waist all the same, for variety. */
  waistShare: 0.2,
  /** How far the broken faces are pushed in and out along the cut, so they read as torn. Metres on a 1.85 m body. */
  jag: 0.016,
  /** Gibs a frame that get everything. Past this, three pieces, two organs, no ribcage. */
  fullPerFrame: 3,
  /** The most a trunk piece, an organ or the ribcage is thrown at, m/s, whatever the blast: they land in sight. */
  pieceSpeed: 7,
};

/** One gib's choice, made from the damage alone, so a co-op guest replaying the same kill makes the same one. */
export interface GibPlan {
  mode: TorsoBreak;
  pieces: 2 | 3 | 5 | 6;
  organs: OrganKind[];
  /** Free strands of gut thrown out, and whether one hangs off a piece. */
  ropes: number;
  hang: boolean;
  /** Ribcage fragments thrown, in place. */
  ribs: RibKind[];
  /** Mid-size slabs of his own skin and meat thrown with the pieces (slabs.ts). */
  slabs: number;
  seed: number;
}

/** A stable seed from where the round landed and what fired it. Guests get the same point over the wire. */
export function seedOf(d: Pick<DamageInfo, 'point' | 'source'>): number {
  let h = 2166136261;
  const mix = (v: number) => {
    h ^= v;
    h = Math.imul(h, 16777619) >>> 0;
  };
  mix(Math.round(d.point.x * 1000));
  mix(Math.round(d.point.y * 1000));
  mix(Math.round(d.point.z * 1000));
  for (let i = 0; i < d.source.length; i++) mix(d.source.charCodeAt(i));
  return h >>> 0;
}

const ALL_RIBS: readonly RibKind[] = ['ribsUL', 'ribsLL', 'ribsUR', 'ribsLR', 'sternum', 'spine'];

/**
 * What a gib does with the trunk, chosen by what killed him. `torso` already on the damage (the host's choice, over the
 * wire) wins. `full` false is a gib past `fullPerFrame` this frame: the smallest version that still leaves the trunk's
 * pieces in its place. Everything it reads crosses the wire with the kill (the point, the source, the type, the force in
 * tenths), so every screen makes the same plan.
 */
export function planGib(d: Pick<DamageInfo, 'point' | 'source' | 'type'> & { torso?: TorsoBreak }, force: number, full = true): GibPlan {
  const seed = seedOf(d);
  const rnd = mulberry32(seed);
  const t = TorsoTuning;
  // Rolled whatever was told, so the rolls after it are the same on a guest told the answer.
  const roll = rnd();
  const waist = d.torso === 'waist' || (d.torso === undefined && roll < t.waistShare);
  if (waist) {
    return { mode: 'waist', pieces: 2, organs: full ? pickOrgans(rnd, ['liver', 'stomach'], 2) : ['liver'], ropes: full ? 1 : 0, hang: true, ribs: [], slabs: full ? SlabTuning.waist : SlabTuning.lite, seed };
  }
  // The wire carries a force in tenths: compared as the guest will see it.
  const f = Math.round(force * 10) / 10;
  const six = rnd() < t.sixShare;
  const pieces = !full ? 3 : f > t.six ? 6 : d.type === 'explosive' && f >= t.bigFrom ? (six ? 6 : 5) : 3;
  const organs = full ? pickOrgans(rnd, ['lung', 'lung', 'liver', 'heart', 'stomach'], 4) : pickOrgans(rnd, ['lung', 'liver'], 2);
  return { mode: 'crack', pieces, organs, ropes: full ? 1 + Math.floor(rnd() * 2) : 1, hang: full, ribs: full ? [...ALL_RIBS] : [], slabs: full ? SlabTuning.full : SlabTuning.lite, seed };
}

/** `n` of `from`, in a seeded order. */
function pickOrgans(rnd: () => number, from: readonly OrganKind[], n: number): OrganKind[] {
  const bag = [...from];
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [bag[i], bag[j]] = [bag[j]!, bag[i]!];
  }
  return bag.slice(0, n);
}

/** True for a killing round that blows the trunk out instead of dropping the body whole. `dist` is from the muzzle. */
export function blowsOut(d: Pick<DamageInfo, 'source' | 'type' | 'region' | 'torso'>, dist: number): boolean {
  if (d.torso === 'blowout') return true;
  if (d.torso !== undefined) return false;
  if (d.region !== 'chest' && d.region !== 'abdomen') return false;
  if (BLOWOUT_ROUNDS.has(d.source)) return true;
  return (d.type === 'pellet' || d.source === 'shotgun' || d.source === 'deuce' || d.source === 'thresher') && dist <= POINT_BLANK;
}

/** Pellets from this close open a belly wide enough to spill it. A little past point blank: the gut is soft. */
export const GUT_RANGE = 4.5;
/** A blast at belly height this share of a body's health or more spills it. */
export const GUT_BLAST = 0.45;

/**
 * Whether a hit on a living (or dead) body leaves its guts hanging out: a shotgun in the belly from close, a big round
 * through it, a hard blast at belly height. `belly` is whether it landed there; `dist` metres from the shooter.
 */
export function spillsGuts(d: Pick<DamageInfo, 'type' | 'source' | 'spill'>, belly: boolean, severity: number, dist: number): boolean {
  if (d.spill) return true;
  if (!belly) return false;
  if (d.type === 'pellet' || d.source === 'shotgun' || d.source === 'deuce' || d.source === 'thresher') return dist <= GUT_RANGE;
  if (BLOWOUT_ROUNDS.has(d.source)) return true;
  return d.type === 'explosive' && severity >= GUT_BLAST;
}

// ---------------------------------------------------------------------------------------------
// The kit
// ---------------------------------------------------------------------------------------------

export interface TorsoPiece {
  /** In the model's bind space, relative to `side.origin`. Shared by every gib of this archetype: never dispose it. */
  side: CutSide;
  /** The bone it rides: the chest or the hips. */
  bone: number;
}

export interface TorsoKit {
  waist: TorsoPiece[];
  crack3: TorsoPiece[];
  crack5: TorsoPiece[];
  crack6: TorsoPiece[];
  /** The mid-size pieces lifted off this trunk's skin (slabs.ts). */
  slabs: Slab[];
  /** What building it cost, for the notes. */
  ms: number;
}

/** The bones a trunk is cut off at before it is cut up: the head and the four limbs, each with its cap. */
export const TRUNK_EXITS: readonly number[] = [B.neck, B.upperArmL, B.upperArmR, B.thighL, B.thighR];

interface Plane { p: THREE.Vector3; n: THREE.Vector3 }

/** Where bone `b` sits in bind: its rig offsets, summed (bind rotations are the identity). */
function bindPos(char: CharacterInstance, b: number, out: THREE.Vector3): THREE.Vector3 {
  out.set(0, 0, 0);
  for (let i = b; i >= 0; i = char.rig.bones[i]!.parent) {
    const o = char.rig.bones[i]!.offset;
    out.x += o[0];
    out.y += o[1];
    out.z += o[2];
  }
  return out;
}

/**
 * Only the vertices the triangles use. A bake keeps every vertex of the body, limbs and head folded away included, and a
 * cut walks all of them: the trunk alone is about a third.
 */
function compact(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const index = g.getIndex()!;
  const count = g.getAttribute('position').count;
  const remap = new Int32Array(count).fill(-1);
  let n = 0;
  const idx = new Uint32Array(index.count);
  for (let i = 0; i < index.count; i++) {
    const v = index.getX(i);
    if (remap[v]! < 0) remap[v] = n++;
    idx[i] = remap[v]!;
  }
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(g.attributes)) {
    const a = attr as THREE.BufferAttribute;
    const src = a.array as THREE.TypedArray;
    const dst = new (src.constructor as new (n: number) => THREE.TypedArray)(n * a.itemSize);
    for (let v = 0; v < count; v++) {
      const to = remap[v]!;
      if (to < 0) continue;
      for (let c = 0; c < a.itemSize; c++) dst[to * a.itemSize + c] = src[v * a.itemSize + c]!;
    }
    out.setAttribute(name, new THREE.BufferAttribute(dst, a.itemSize, a.normalized));
  }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  g.dispose();
  return out;
}

/** Cuts every side by the plane, in each side's own frame. Pieces that miss it stay as they are. */
function split(sides: readonly CutSide[], plane: Plane, discs: readonly BoneCrossing[]): { above: CutSide[]; below: CutSide[] } {
  const above: CutSide[] = [];
  const below: CutSide[] = [];
  const p = new THREE.Vector3();
  for (const side of sides) {
    p.copy(plane.p).sub(side.origin);
    const local = discs.map(d => ({ x: d.x - side.origin.x, y: d.y - side.origin.y, z: d.z - side.origin.z, radius: d.radius }))
      // A disc outside the piece would float beside it.
      .filter(d => d.x > side.min.x && d.x < side.max.x && d.y > side.min.y && d.y < side.max.y && d.z > side.min.z && d.z < side.max.z);
    // One rigid piece a side: a trunk's caps and kit are islands of its mesh, and they go where the piece goes.
    const r = cutMesh(side.geometry, p, plane.n, local, null, 1);
    if (r.above.length === 0 || r.below.length === 0) {
      (side.origin.dot(plane.n) - plane.p.dot(plane.n) > 0 ? above : below).push(side);
      continue;
    }
    for (const s of [...r.above, ...r.below]) s.origin.add(side.origin);
    above.push(...r.above);
    below.push(...r.below);
    side.geometry.dispose();
  }
  return { above, below };
}

/** A position hash in -1..1 on a 3 mm grid, so both faces of one break move together. */
function jagNoise(x: number, y: number, z: number): number {
  let h = Math.imul(Math.round(x * 330), 73856093) ^ Math.imul(Math.round(y * 330), 19349663) ^ Math.imul(Math.round(z * 330), 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) & 0xffff) / 32767.5 - 1;
}

/**
 * Points for a piece's convex hull: its extreme vertex along each of 26 directions, then an even sample of the rest. The
 * cut's own sample is every nth vertex, which misses the corners a piece lands on, so the mesh sank a few centimetres
 * into the floor past its hull.
 */
function hullPoints(g: THREE.BufferGeometry): Float32Array {
  const a = g.getAttribute('position').array as Float32Array;
  const n = a.length / 3;
  const picks = new Set<number>();
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    if (dx === 0 && dy === 0 && dz === 0) continue;
    let best = -Infinity;
    let at = 0;
    for (let i = 0; i < n; i++) {
      const d = a[i * 3]! * dx + a[i * 3 + 1]! * dy + a[i * 3 + 2]! * dz;
      if (d > best) {
        best = d;
        at = i;
      }
    }
    picks.add(at);
  }
  const stride = Math.max(1, Math.floor(n / 70));
  for (let i = 0; i < n; i += stride) picks.add(i);
  const out = new Float32Array(picks.size * 3);
  let k = 0;
  for (const i of picks) {
    out[k++] = a[i * 3]!;
    out[k++] = a[i * 3 + 1]!;
    out[k++] = a[i * 3 + 2]!;
  }
  return out;
}

/** Pushes every vertex on a cut plane in or out along it, so a break is torn rather than sliced. */
function roughen(side: CutSide, planes: readonly Plane[], amount: number): void {
  const pos = side.geometry.getAttribute('position') as THREE.BufferAttribute;
  const a = pos.array as Float32Array;
  const o = side.origin;
  for (const { p, n } of planes) {
    const off = p.dot(n);
    for (let i = 0; i < a.length; i += 3) {
      const x = a[i]! + o.x, y = a[i + 1]! + o.y, z = a[i + 2]! + o.z;
      if (Math.abs(x * n.x + y * n.y + z * n.z - off) > 4e-4) continue;
      const k = jagNoise(x, y, z) * amount;
      a[i] = a[i]! + n.x * k;
      a[i + 1] = a[i + 1]! + n.y * k;
      a[i + 2] = a[i + 2]! + n.z * k;
    }
  }
  pos.needsUpdate = true;
  side.geometry.computeBoundingSphere();
}

/**
 * Cuts this character's trunk into the kit. The character must have every one of `TRUNK_EXITS` hidden, so its bind copy is
 * the trunk alone with its five caps. Planes are fixed per archetype: four cuts give all four ways to break.
 */
export function buildKit(char: CharacterInstance): TorsoKit {
  const started = performance.now();
  const s = char.rig.height / 1.85;
  const rnd = mulberry32([...char.archetype].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261));
  const hips = bindPos(char, B.hips, new THREE.Vector3());
  const spine = bindPos(char, B.spine, new THREE.Vector3());
  const chest = bindPos(char, B.chest, new THREE.Vector3());
  const chestR = char.rig.bones[B.chest]!.hit?.radius ?? 0.16;
  const plane = (p: THREE.Vector3, n: THREE.Vector3): Plane => ({ p, n: n.normalize() });
  const waist = plane(new THREE.Vector3(0, spine.y + 0.05 * s, 0), new THREE.Vector3(rnd() * 0.3 - 0.15, 1, 0.22));
  const middle = plane(new THREE.Vector3(0.012 * s, 0, 0), new THREE.Vector3(1, 0.1, rnd() * 0.2 - 0.1));
  const ribL = plane(new THREE.Vector3(0, chest.y + 0.1 * s, 0), new THREE.Vector3(0.28, 1, -0.22));
  const ribR = plane(new THREE.Vector3(0, chest.y + 0.12 * s, 0), new THREE.Vector3(-0.3, 1, 0.26));
  const pelvis = plane(new THREE.Vector3(-0.01 * s, 0, 0), new THREE.Vector3(1, -0.12, 0.16));

  // Bone on the broken faces: the spine at the back, the rib ring round a cut through the chest, the sternum in front.
  const spineZ = -0.06 * s;
  const ring = (y: number): BoneCrossing[] => Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2 + 0.3;
    return { x: Math.sin(a) * chestR * 0.8, y, z: 0.012 * s - Math.cos(a) * chestR * 0.55, radius: 0.009 * s };
  });
  const spineDisc = (y: number): BoneCrossing => ({ x: 0, y, z: spineZ, radius: 0.022 * s });
  const column: BoneCrossing[] = [];
  for (let y = spine.y; y < chest.y + 0.26 * s; y += 0.045 * s) column.push({ x: 0, y, z: spineZ, radius: 0.016 * s });
  column.push({ x: 0, y: chest.y + 0.12 * s, z: 0.09 * s, radius: 0.012 * s });

  const geometry = compact(char.bakePose(true));
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const whole: CutSide = {
    geometry, origin: new THREE.Vector3(), capCenter: new THREE.Vector3(), capNormal: new THREE.Vector3(0, 1, 0),
    hull: new Float32Array(0), min: box.min.clone(), max: box.max.clone(), capArea: 0,
  };
  // Before the trunk is cut up: the slabs are lifted off its whole skin.
  const slabs = buildSlabs(geometry, char, hips.y, chest.y);
  const byWaist = split([whole], waist, [spineDisc(waist.p.y)]);
  // Kept whole for the waist tear, and cut on for the rest: `split` disposes what it cuts, so the waist keeps copies.
  const keep = (sides: CutSide[]): CutSide[] => sides.map(c => ({ ...c, geometry: c.geometry.clone(), origin: c.origin.clone() }));
  const upper = keep(byWaist.above);
  const lower = keep(byWaist.below);
  const halves = split(byWaist.above, middle, column);
  const left = keep(halves.above);
  const right = keep(halves.below);
  const leftRibs = split(halves.above, ribL, ring(ribL.p.y));
  const rightRibs = split(halves.below, ribR, ring(ribR.p.y));
  const pelvisHalves = split(keep(lower), pelvis, [{ x: 0, y: hips.y, z: spineZ, radius: 0.02 * s }]);

  const all = [waist, middle, ribL, ribR, pelvis];
  const split2 = (y: number) => (y > (spine.y + chest.y) / 2 ? B.chest : B.hips);
  const made = new Map<CutSide, TorsoPiece>();
  const piece = (side: CutSide): TorsoPiece => {
    let out = made.get(side);
    if (!out) {
      roughen(side, all, TorsoTuning.jag * s);
      side.hull = hullPoints(side.geometry);
      made.set(side, (out = { side, bone: split2(side.origin.y) }));
    }
    return out;
  };
  const pieces = (sides: CutSide[]) => sides.map(piece);
  const L = pieces(lower);
  const kit: TorsoKit = {
    waist: [...pieces(upper), ...L],
    crack3: [...pieces(left), ...pieces(right), ...L],
    crack5: [...pieces(leftRibs.above), ...pieces(leftRibs.below), ...pieces(rightRibs.above), ...pieces(rightRibs.below), ...L],
    crack6: [...pieces(leftRibs.above), ...pieces(leftRibs.below), ...pieces(rightRibs.above), ...pieces(rightRibs.below), ...pieces(pelvisHalves.above), ...pieces(pelvisHalves.below)],
    slabs,
    ms: 0,
  };
  kit.ms = performance.now() - started;
  return kit;
}

/** The kit's pieces for a plan. */
export function kitPieces(kit: TorsoKit, plan: GibPlan): TorsoPiece[] {
  if (plan.mode === 'waist') return kit.waist;
  return plan.pieces === 3 ? kit.crack3 : plan.pieces === 6 ? kit.crack6 : kit.crack5;
}

const _m = new THREE.Matrix4();
const _o = new THREE.Matrix4();
const _b = new THREE.Vector3();
const _sc = new THREE.Vector3();

/**
 * Where a piece is now: its bone's world matrix, back from where that bone sits in bind (rig offsets, unturned, so the
 * same as the skin's inverse bind), to the piece's origin. Written into `p` and `q`. Exactly where its skin is this frame.
 */
export function placePiece(char: CharacterInstance, piece: TorsoPiece, p: THREE.Vector3, q: THREE.Quaternion): void {
  placeAt(char, piece.bone, piece.side.origin, p, q);
}

/** The same for anything that sits at `at` in the model's bind space and rides bone `b`: a slab. */
export function placeAt(char: CharacterInstance, b: number, at: THREE.Vector3, p: THREE.Vector3, q: THREE.Quaternion): void {
  const bone = char.bones[b]!;
  bone.updateWorldMatrix(true, false);
  bindPos(char, b, _b);
  _o.makeTranslation(at.x - _b.x, at.y - _b.y, at.z - _b.z);
  _m.multiplyMatrices(bone.matrixWorld, _o);
  _m.decompose(p, q, _sc);
}
