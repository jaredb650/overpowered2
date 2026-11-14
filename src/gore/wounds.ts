/**
 * What a hit leaves on a body: which wounds, how big and where. The weapon decides the character of the wound, and the
 * damage decides the size, as `docs/DESIGN.md` 14.6 lays out: small arms make small channels, shotguns tear, cannons
 * remove parts, swords cut clean, fire chars. All sizes here are metres on a 1.85 m body.
 */
import * as THREE from 'three';
import { WoundKind } from '../characters/anatomy/wounds';
import { HumanoidBone as B } from '../characters/rig';
import type { CharacterInstance, Ctx, DamageInfo, WoundHit } from '../core/contracts';
import { clamp, lerp, rand } from '../core/math';
import { boneRay, boneRayContact, rayBones, rayCapsule } from './raycast';
import { CAP_STRIDE, markSevered, MAX_BONES, rigInfo, type RigInfo } from './rigInfo';
import { SLOT8_OLD } from '../weapons/data';

export const WoundTuning = {
  /** The Gore setting. 0 paints blood and leaves bodies whole, 1 is the game as tuned, 2 opens them sooner and wider. */
  level: 1,
  /** Damage a limb takes, after each weapon's `breaks`, before its joint goes. Grows with the square of a body's size. */
  breakAt: 60,
  /** A limb hit by anything that breaks it twice as fast on the Excessive setting. */
  excessiveScale: 1.25,
  /** Pellets take a real bite under this range and are plain holes past that one. */
  pelletNear: 1.5,
  pelletFar: 10,
  /** Metres apart that pellets still make one crater, at point blank. It falls to nothing halfway out. */
  pelletMerge: 0.11,
};

/** One weapon's bite. */
interface Bite {
  /** Entry radius, and exit radius. No exit means the round stayed in. */
  entry: number;
  exit: number;
  /** An exit through a limb only, for rounds that stop in a trunk. */
  limbExit: number;
  depth: number;
  ragged: number;
  /** How hard a hit works a limb toward breaking, per point of damage. */
  breaks: number;
}

const SMALL: Bite = { entry: 0.0125, exit: 0, limbExit: 0.018, depth: 0.05, ragged: 0.35, breaks: 0.35 };
const REVOLVER: Bite = { entry: 0.0145, exit: 0.055, limbExit: 0.05, depth: 0.09, ragged: 0.95, breaks: 1.6 };
const STAKE: Bite = { entry: 0.022, exit: 0.04, limbExit: 0.04, depth: 0.1, ragged: 0.7, breaks: 1 };
const CANNON: Bite = { entry: 0.045, exit: 0.115, limbExit: 0.09, depth: 0.13, ragged: 1, breaks: 3 };
const LANCE: Bite = { entry: 0.03, exit: 0.07, limbExit: 0.06, depth: 0.1, ragged: 0.8, breaks: 2 };

const BITES: Record<string, Bite> = {
  // `buzzsaw` is the 20 mm rotary cannon now (the Trommel): two thirds of the autocannon's bite. `?slot8=old` is the old gun and its old hole.
  smg: SMALL, buzzsaw: SLOT8_OLD ? { ...SMALL, ragged: 0.75 } : { ...CANNON, entry: 0.03, exit: 0.085, limbExit: 0.07, depth: 0.11, breaks: 2 },
  judge: REVOLVER, stakegun: STAKE, autocannon: CANNON, lance: LANCE,
  // Family members (src/weapons/families.ts). The Harrow's rifle round tears like the Judge's; the Sabot's dart goes through like the Lance.
  harrow: REVOLVER, rivet: SMALL, sabot: LANCE,
  // Key 8's second gun: a heavy machine gun round goes in bigger than the Judge's and comes out bigger still.
  piledriver: { ...REVOLVER, entry: 0.018, exit: 0.075, limbExit: 0.065, breaks: 2.2 },
};

const _dir = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _n = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _along = new THREE.Vector3();
const _from = new THREE.Vector3();
const _jitter = new THREE.Vector3();
const _skip = new Uint8Array(MAX_BONES);

const _hit: WoundHit = { kind: WoundKind.hole, bone: 0, point: _p, dir: _dir, radius: 0.02, depth: 0.05, ragged: 0 };

/** What can take a wound: a body, or a limb that has left one. */
interface Flesh {
  wound(hit: WoundHit): void;
  readonly bones: readonly THREE.Object3D[];
}

const isArmBone = (b: number): boolean => b >= B.upperArmL && b <= B.handR;
const isLegBone = (b: number): boolean => b >= B.thighL && b <= B.footR;

/** The hinge that goes when a hit lands on this bone, or the ball joint above a long bone. */
function jointFor(bone: number): number {
  if (bone === B.handL) return B.foreArmL;
  if (bone === B.handR) return B.foreArmR;
  if (bone === B.footL) return B.shinL;
  if (bone === B.footR) return B.shinR;
  return bone;
}

export class WoundPlanner {
  /** Whether the last hit on a body broke a limb. */
  broke = false;

  constructor(
    private readonly ctx: Ctx,
    /** Machines take dents, and their joints do not snap. */
    private readonly isMachine: (char: CharacterInstance) => boolean,
    /** Told about each joint that goes, so a ragdoll already running can open it. */
    private readonly onBreak: (char: CharacterInstance, bone: number) => void,
  ) {}

  private cut(on: Flesh, kind: number, bone: number, point: THREE.Vector3, dir: THREE.Vector3, radius: number, depth: number, ragged: number, length = 0): void {
    if (WoundTuning.level === 0 && kind !== WoundKind.burn) {
      kind = WoundKind.graze;
      radius = Math.max(radius * 1.8, 0.03);
    } else if (WoundTuning.level === 2) {
      radius *= WoundTuning.excessiveScale;
      depth *= WoundTuning.excessiveScale;
    }
    _hit.kind = kind;
    _hit.bone = bone;
    _hit.point = point;
    _hit.dir = dir;
    _hit.radius = radius;
    _hit.depth = depth;
    _hit.ragged = ragged;
    // A gash that level 0 turned into paint is only a mark.
    _hit.along = length > 0 && kind === WoundKind.gash ? _along : undefined;
    _hit.length = length;
    on.wound(_hit);
  }

  /** Writes where a line through `point` leaves the capsule of `bone`. False if that bone has no capsule. */
  private exitOf(info: RigInfo, bones: readonly THREE.Object3D[], bone: number, point: THREE.Vector3, dir: THREE.Vector3, out: THREE.Vector3): boolean {
    for (let c = 0; c < info.capCount; c++) {
      if (info.capBone[c] !== bone) continue;
      const o = c * CAP_STRIDE;
      const m = bones[bone]!.matrixWorld;
      _a.set(info.caps[o]!, info.caps[o + 1]!, info.caps[o + 2]!).applyMatrix4(m);
      _b.set(info.caps[o + 3]!, info.caps[o + 4]!, info.caps[o + 5]!).applyMatrix4(m);
      const r = info.caps[o + 6]!;
      // Shot back at it from well beyond, so the nearest surface found is the far side.
      const reach = _a.distanceTo(_b) + r * 2 + 0.5;
      out.copy(point).addScaledVector(dir, reach);
      const t = rayCapsule(out.x, out.y, out.z, -dir.x, -dir.y, -dir.z, _a.x, _a.y, _a.z, _b.x, _b.y, _b.z, r);
      if (t <= 0) return false;
      out.addScaledVector(dir, -t);
      return true;
    }
    return false;
  }

  /** Into the bone from a point on it: the way a wound with no line of its own goes in. */
  private inward(info: RigInfo, bones: readonly THREE.Object3D[], bone: number, point: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    for (let c = 0; c < info.capCount; c++) {
      if (info.capBone[c] !== bone) continue;
      const o = c * CAP_STRIDE;
      const m = bones[bone]!.matrixWorld;
      _a.set(info.caps[o]!, info.caps[o + 1]!, info.caps[o + 2]!).applyMatrix4(m);
      _b.set(info.caps[o + 3]!, info.caps[o + 4]!, info.caps[o + 5]!).applyMatrix4(m);
      _b.sub(_a);
      const len2 = _b.lengthSq();
      const t = len2 > 1e-8 ? clamp(_q.copy(point).sub(_a).dot(_b) / len2, 0, 1) : 0;
      out.copy(_a).addScaledVector(_b, t).sub(point);
      if (out.lengthSq() > 1e-8) return out.normalize();
      break;
    }
    return out.set(0, 0, -1);
  }

  private bullet(on: Flesh, info: RigInfo, bite: Bite, bone: number, point: THREE.Vector3, dir: THREE.Vector3, size: number, machine: boolean): void {
    const limb = isArmBone(bone) || isLegBone(bone);
    this.cut(on, bite.entry >= 0.03 ? WoundKind.crater : WoundKind.hole, bone, point, dir, bite.entry * size, bite.depth, Math.max(0.35, bite.ragged * 0.6));
    const exit = limb ? bite.limbExit : bite.exit;
    if (exit <= 0 || !this.exitOf(info, on.bones, bone, point, dir, _q)) return;
    // Inward from the far side, so the slot starts at the skin it comes out of.
    _n.copy(dir).negate();
    this.cut(on, WoundKind.exit, bone, _q, _n, exit * size, bite.depth * 0.7, bite.ragged);
    if (!machine) this.ctx.fx.bloodHit(_q, dir, exit > 0.05 ? 1.2 : 0.7);
  }

  private pellet(on: Flesh, bone: number, point: THREE.Vector3, dir: THREE.Vector3, size: number): number {
    const t = WoundTuning;
    const range = clamp((point.distanceTo(this.ctx.player.eye) - t.pelletNear) / (t.pelletFar - t.pelletNear), 0, 1);
    const radius = lerp(0.047, 0.0115, Math.sqrt(range)) * size;
    _hit.reach = lerp(t.pelletMerge, 0, Math.min(1, range * 2));
    this.cut(on, radius > 0.024 ? WoundKind.crater : WoundKind.hole, bone, point, dir, radius, lerp(0.09, 0.04, range), lerp(1, 0.35, range));
    _hit.reach = 0;
    return lerp(1.3, 0.3, range);
  }

  private gash(on: Flesh, info: RigInfo, d: DamageInfo, bone: number, point: THREE.Vector3, severity: number, size: number): void {
    this.inward(info, on.bones, bone, point, _n);
    // A blade's plane meets the skin along a line, and that is the cut. A swing with no plane left goes the way it was going.
    if (d.slicePlaneNormal) _along.crossVectors(d.slicePlaneNormal, _n);
    else _along.copy(d.dir).addScaledVector(_n, -d.dir.dot(_n));
    if (_along.lengthSq() < 1e-4) _along.set(1, 0, 0).addScaledVector(_n, -_n.x);
    _along.normalize();
    const s = clamp(severity * 2, 0, 1);
    const limb = isArmBone(bone) || isLegBone(bone);
    const length = lerp(0.085, limb ? 0.13 : 0.2, s) * size;
    this.cut(on, WoundKind.gash, bone, point, _n, lerp(0.009, 0.017, s) * size, lerp(0.05, 0.1, s), 0.08, length);
  }

  /**
   * Blasts arrive at the middle of the body, from the blast. Finds what faces it: the wound goes on the near side,
   * with shrapnel holes scattered round it. The worst of it opens the chest or the belly.
   */
  private blast(char: CharacterInstance, info: RigInfo, d: DamageInfo, severity: number, size: number, machine: boolean): void {
    const o = _from.copy(d.point).addScaledVector(d.dir, -3);
    markSevered(info, char.severed, _skip);
    // A blast is as wide as the body, so an arm held across the chest does not take it all for the chest.
    if (!machine) _skip.fill(1, B.upperArmL, B.footR + 1);
    if (!rayBones(info, char.bones, _skip, o.x, o.y, o.z, d.dir.x, d.dir.y, d.dir.z, 6)) return;
    const bone = boneRay.bone;
    boneRayContact(o.x, o.y, o.z, d.dir.x, d.dir.y, d.dir.z, _p, _n);
    markSevered(info, char.severed, _skip);
    const s = clamp(severity, 0, 1);
    const radius = lerp(0.045, 0.185, s) * size;
    _along.copy(d.dir);
    if (s > 0.16) this.cut(char, WoundKind.crater, bone, _p, _along, radius, lerp(0.045, 0.15, s), 1);
    if (!machine) this.cut(char, WoundKind.burn, bone, _p, _along, radius * 1.8 + 0.04, 0.05, 1);
    const pieces = Math.round(lerp(3, 9, s));
    for (let i = 0; i < pieces; i++) {
      _jitter.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(0.12).add(d.dir).normalize();
      if (!rayBones(info, char.bones, _skip, o.x, o.y, o.z, _jitter.x, _jitter.y, _jitter.z, 6)) continue;
      const struck = boneRay.bone;
      boneRayContact(o.x, o.y, o.z, _jitter.x, _jitter.y, _jitter.z, _a, _n);
      this.cut(char, WoundKind.hole, struck, _a, _jitter, rand(0.009, 0.02) * size, 0.05, 0.8);
      if (!machine) this.strain(char, info, struck, d.amount * 0.4, size);
    }
    if (!machine) this.strain(char, info, bone, d.amount * 2, size);
  }

  /** Flame arrives at a point near the body with no bone of its own, so it finds what it was licking at. */
  private burn(char: CharacterInstance, info: RigInfo, d: DamageInfo, bone: number, point: THREE.Vector3, size: number): void {
    if (bone < 0) {
      if (d.dir.lengthSq() < 0.5) return;
      const o = _from.copy(point).addScaledVector(d.dir, -2);
      markSevered(info, char.severed, _skip);
      if (!rayBones(info, char.bones, _skip, o.x, o.y, o.z, d.dir.x, d.dir.y, d.dir.z, 4)) return;
      bone = boneRay.bone;
      boneRayContact(o.x, o.y, o.z, d.dir.x, d.dir.y, d.dir.z, _p, _n);
      point = _p;
    }
    this.cut(char, WoundKind.burn, bone, point, this.inward(info, char.bones, bone, point, _n), rand(0.05, 0.09) * size, 0.04, 1);
  }

  /** Works a limb toward breaking, and breaks it. */
  private strain(char: CharacterInstance, info: RigInfo, bone: number, load: number, size: number): void {
    if (WoundTuning.level === 0 || !(isArmBone(bone) || isLegBone(bone))) return;
    const joint = jointFor(bone);
    if (char.isFractured(joint)) return;
    char.stress[joint] = char.stress[joint]! + load;
    const limit = WoundTuning.breakAt * size * size / (WoundTuning.level === 2 ? 1.5 : 1);
    if (char.stress[joint]! < limit) return;
    const hinge = char.rig.bones[joint]!.joint?.kind === 'hinge';
    if (!char.fracture(joint, hinge ? 'hyper' : 'limp', rand(-0.3, 0.3))) return;
    this.broke = true;
    this.onBreak(char, joint);
    this.boneOut(char, info, joint);
    this.ctx.audio.play('bone_snap', { position: char.bones[joint]!.getWorldPosition(_q), pitchJitter: 0.1 });
  }

  /** The hole a bone end comes out through, on the side the end points. */
  private boneOut(char: CharacterInstance, info: RigInfo, joint: number): void {
    const bones = char.bones;
    const def = char.rig.bones[joint]!;
    const hinge = def.joint?.kind === 'hinge';
    const elbow = hinge && isArmBone(joint);
    const parent = bones[def.parent]!;
    parent.updateWorldMatrix(true, true);
    const radius = (def.hit?.radius ?? 0.06) * 0.85;
    const hingeAt = _p.setFromMatrixPosition(bones[joint]!.matrixWorld);
    if (hinge) {
      // Out through the back of an elbow or the front of a knee, in the upper bone's frame.
      _n.set(0, 0, elbow ? 1 : -1).transformDirection(parent.matrixWorld);
      _q.copy(hingeAt).addScaledVector(_n, -radius);
      this.cut(char, WoundKind.crater, def.parent, _q, _n, radius * 0.72, 0.05, 1);
      return;
    }
    // A shoulder or hip has gone by way of the shaft below it, so the hole is in the side of the limb.
    const child = info.children[joint]![0]!;
    const side = joint === B.upperArmL || joint === B.thighL ? 1 : -1;
    _a.setFromMatrixPosition(bones[child]!.matrixWorld);
    _q.copy(hingeAt).lerp(_a, 0.55);
    _n.set(-side, 0, 0).transformDirection(bones[joint]!.matrixWorld);
    _b.copy(_q).addScaledVector(_n, -radius);
    this.cut(char, WoundKind.crater, joint, _b, _n, radius * 0.72, 0.05, 1);
  }

  /** A hit on a body, alive or dead. `bone` and `point` default to the ones in the damage. */
  onBody(char: CharacterInstance, d: DamageInfo, severity: number, bone = d.bone ?? -1, point = d.point): void {
    this.broke = false;
    const info = rigInfo(char.rig);
    const size = (char.rig.height / 1.85) ** 0.7;
    const machine = this.isMachine(char);
    switch (d.type) {
      case 'shock':
      case 'true':
        return;
      case 'explosive':
        this.blast(char, info, d, severity, size, machine);
        return;
      case 'fire':
        this.burn(char, info, d, bone, point, size);
        return;
      default:
        break;
    }
    if (bone < 0) return;
    char.bones[bone]!.updateWorldMatrix(true, false);
    if (d.type === 'slash') {
      this.gash(char, info, d, bone, point, severity, size);
      if (!machine) this.strain(char, info, bone, d.amount * 0.3, size);
    } else if (d.type === 'melee' || d.type === 'crush') {
      this.cut(char, WoundKind.graze, bone, point, this.inward(info, char.bones, bone, point, _n), lerp(0.05, 0.12, clamp(severity, 0, 1)) * size, 0.03, 0.4);
      if (!machine) this.strain(char, info, bone, d.amount * (d.type === 'crush' ? 2 : 1), size);
    } else if (d.type === 'pellet' || d.source === 'shotgun') {
      const load = this.pellet(char, bone, point, d.dir, size);
      if (!machine) this.strain(char, info, bone, d.amount * load, size);
    } else {
      const bite = BITES[d.source] ?? SMALL;
      this.bullet(char, info, bite, bone, point, d.dir, size, machine);
      if (!machine) this.strain(char, info, bone, d.amount * bite.breaks, size);
    }
  }

  /** A hit on a loose limb: holes, but nothing left to break. */
  onLimb(limb: Flesh, info: RigInfo, d: DamageInfo, bone: number, point: THREE.Vector3): void {
    if (d.type === 'fire' || d.type === 'shock' || d.type === 'true' || d.type === 'explosive') return;
    const size = (info.rig.height / 1.85) ** 0.7;
    limb.bones[bone]!.updateWorldMatrix(true, false);
    if (d.type === 'slash') this.gash(limb, info, d, bone, point, 0.4, size);
    else if (d.type === 'melee' || d.type === 'crush') return;
    else if (d.type === 'pellet' || d.source === 'shotgun') this.pellet(limb, bone, point, d.dir, size);
    else this.bullet(limb, info, BITES[d.source] ?? SMALL, bone, point, d.dir, size, false);
  }
}
