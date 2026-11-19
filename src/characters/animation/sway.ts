/**
 * The struck part goes physical (the gore update's R3): a small powered ragdoll hung on the animated body.
 *
 * A hit turns the struck arm, the head and neck, or the whole upper body into a chain of point masses at its joints, held
 * at bone length from each other and hung on the joint the animation still owns (the shoulder, the neck's base, the
 * bottom of the spine). Each joint is pulled toward where the animation has it by a spring whose strength is the part's
 * `drive`: a hit drops it to a looseness by how hard it was, and it comes back over 0.3 to 0.6 s. While it is loose the
 * part has weight, lags what carries it, takes the round's snap along the shot, and whips at the elbow and wrist because
 * the bones cannot stretch. Once it is driven in full again the last of the difference is eased out and the animation has
 * the part back.
 *
 * It runs inside the animator, after the pose is made, on the frame's own pose. So there is nothing to hand over: a body
 * that is taken onto its muscles, or dies, is read by gore from the bones as they stand, and its speed by the same probe
 * that reads any animation's (`measureAnimVelocity` steps the animator, which steps this). It makes no rigid bodies and
 * touches no physics world; the cost is a few dozen vector operations a chain a frame.
 */
import * as THREE from 'three';
import { HumanoidBone as H } from '../rig';

export type SwayPart = 'armL' | 'armR' | 'head' | 'trunk';

export const SwayTuning = {
  /** A joint driven in full follows its animation at this rate, rad/s, critically damped; wholly loose it is damped this much. */
  rate: 22,
  looseRatio: 0.42,
  /** The loosest a hit leaves each part, as a share of full drive. A hand with a gun in it is held tighter. */
  floor: { arm: 0.16, gunArm: 0.34, head: 0.18, trunk: 0.36 },
  /** How much of its drive a hit of size 1 takes from a part. */
  slack: 0.6,
  /** Seconds the drive takes to come back, after a light hit and after a hard one (size 0.5 and 1.5). */
  recover: [0.3, 0.6] as readonly [number, number],
  /** Seconds the last of it is eased out over, once the part is driven in full again. */
  blend: 0.2,
  /** The snap along the shot on the struck part, m/s per unit of size, and the share its neighbours up the chain take. */
  snap: { arm: 1.1, head: 1.2, trunk: 0.8 },
  spread: 0.55,
  /** Share of its weight a wholly loose part hangs with. A driven muscle carries its own. */
  weight: 0.4,
  gravity: 19,
  /** Furthest a simulated bone may point from where its animation has it, radians; and a hand, which is light and would flap. */
  cone: 1.15,
  handCone: 0.5,
  /** Share of the speed its animation has at the moment it goes loose that a part starts with, over the body's own. */
  take: 0.3,
  /** A joint's animation moving further than this in a frame, in metres, is a teleport: the part starts again from it. */
  jump: 1,
  /** On the upper body, how loose its arms go with it, as a share of the trunk's own slack. */
  armsWithTrunk: 0.6,
  /**
   * A loose arm is simulated here and not in the physics world, so nothing stops it: it could swing through a wall the
   * body stands beside for the third of a second it is loose. One ray an arm a frame (`SwayWorld.ray`, the world's own),
   * from the shoulder the way the wrist is heading, the length of the arm: what it meets is a plane the arm's joints
   * stay `wall` metres in front of, unless the animation itself has them through it. The stop only ever moves a joint
   * out, and by no more than `outSpeed` metres a second, so it cannot pop.
   *
   * Its own trunk needs no stop. Measured on a Trooper, a Husk and a Brute, both arms, seven directions, at the hardest
   * hit: the loose arm's wrist and elbow come within 2 mm of as near the trunk as the flinch's own animation takes
   * them, and no nearer (the cone and the drive's floor hold it that close to its animation). An arm seen in a chest
   * is the animated flinch's pose, not this.
   */
  wall: 0.05,
  outSpeed: 3.5,
};

/**
 * The world, for the one thing a loose arm asks of it: what is along this ray. Set by whoever has a physics world and
 * animates bodies that sway (the enemies); left null (a test, the viewmodel sandbox), arms meet no walls, as before.
 */
export const SwayWorld: { ray: ((origin: THREE.Vector3, dir: THREE.Vector3, max: number, hit: { point: THREE.Vector3; normal: THREE.Vector3 }) => boolean) | null } = { ray: null };

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const BONES = 17;

/** One hung chain: `bones[k]` runs from joint k to joint k + 1, and the last joint is the tip of the last bone. */
class Chain {
  on = false;
  /** No target velocity yet: it starts from its animation on the next step. */
  fresh = true;
  /** It has taken its first step, so its joints have speeds of their own. */
  primed = false;
  drive = 1;
  floor = 1;
  /** Seconds since the last hit, and how long the drive takes to come back from it. */
  since = 0;
  recover = 0.4;
  /** How much of the simulated pose is shown, 1 until the drive is back and then eased to 0. */
  weight = 0;
  readonly x: THREE.Vector3[];
  readonly v: THREE.Vector3[];
  /** Where the animation has each joint this frame and had it the last, in the world. */
  readonly a: THREE.Vector3[];
  readonly prev: THREE.Vector3[];
  /** A snap waiting for the next step. */
  readonly kick: THREE.Vector3[];
  readonly length: number[];
  count = 0;
  /** A wall within the arm's reach this frame: its normal, and how far along it the arm must stay (`SwayTuning.wall`). */
  walled = false;
  readonly wallN = new THREE.Vector3();
  wallD = 0;

  constructor(readonly part: SwayPart, readonly bones: number[], readonly tip: THREE.Vector3, readonly hungOn: number) {
    const n = bones.length + 1;
    const make = () => Array.from({ length: n }, () => new THREE.Vector3());
    this.x = make(); this.v = make(); this.a = make(); this.prev = make(); this.kick = make();
    this.length = new Array<number>(n).fill(0);
  }
}

const _wq = Array.from({ length: BONES }, () => new THREE.Quaternion());
const _wp = Array.from({ length: BONES }, () => new THREE.Vector3());
/** Each bone's world rotation as shown: the animation's, or the simulated one. */
const _sq = Array.from({ length: BONES }, () => new THREE.Quaternion());
const _q = new THREE.Quaternion();
const _carry = new THREE.Quaternion();
const _d = new THREE.Vector3();
const _e = new THREE.Vector3();
const _f = new THREE.Vector3();
const _old = new THREE.Vector3();
const _vt = new THREE.Vector3();
const _shown = Array.from({ length: 6 }, () => new THREE.Vector3());
const _axis = new THREE.Vector3();
const _g = new THREE.Vector3();
const _ray = { point: new THREE.Vector3(), normal: new THREE.Vector3() };

/** The physical parts of one humanoid body. Made by its animator the first time a hit asks for one. */
export class Sway {
  private readonly trunk: Chain;
  private readonly head: Chain;
  private readonly arms: [Chain, Chain];
  private readonly order: Chain[];
  /** Any part live. */
  live = false;
  private readonly parentOf: number[];

  constructor(
    private readonly bones: readonly THREE.Bone[],
    private readonly root: THREE.Object3D,
    private readonly hidden: (bone: number) => boolean,
  ) {
    this.parentOf = bones.map(bone => Math.max(0, bones.indexOf(bone.parent as THREE.Bone)));
    const tipOf = (bone: number, scale: number) => bones[bone]!.position.clone().multiplyScalar(scale);
    // The head's own length is not a bone: about twice the neck's, along it.
    const crown = bones[H.head]!.position.clone().normalize().multiplyScalar(bones[H.head]!.position.length() * 2.2);
    this.trunk = new Chain('trunk', [H.spine, H.chest, H.neck, H.head], crown, H.hips);
    this.head = new Chain('head', [H.neck, H.head], crown, H.chest);
    this.arms = [
      new Chain('armL', [H.upperArmL, H.foreArmL, H.handL], tipOf(H.handL, 0.45), H.chest),
      new Chain('armR', [H.upperArmR, H.foreArmR, H.handR], tipOf(H.handR, 0.45), H.chest),
    ];
    // The trunk first: its arms hang on the chest it leaves.
    this.order = [this.trunk, this.head, this.arms[0], this.arms[1]];
  }

  /** How much of any part is on physics, 0..1: for probes and tests. */
  get weight(): number {
    let w = 0;
    for (const c of this.order) if (c.on) w = Math.max(w, c.weight);
    return w;
  }

  /**
   * A hit on a part. `dir` is the round's way in the world, `size` the flinch's for this build, `bone` the bone it struck,
   * `gunHand` whether the right hand holds a gun. A part already live is loosened again from where it is; nothing restarts.
   */
  hit(part: SwayPart, dir: THREE.Vector3, size: number, bone: number, gunHand: boolean): void {
    const t = SwayTuning;
    if (part === 'trunk') {
      if (this.hidden(H.chest) || this.hidden(H.spine)) return;
      // The head and neck are part of the upper body's chain: a head that was swinging alone carries on in it.
      this.head.on = false;
      this.loosen(this.trunk, t.floor.trunk, size, t.snap.trunk, dir, this.trunk.bones.indexOf(bone));
      for (let i = 0; i < 2; i++) {
        const gun = i === 1 && gunHand;
        this.loosen(this.arms[i]!, gun ? t.floor.gunArm : t.floor.arm, size * t.armsWithTrunk, 0, dir, -1);
      }
    } else if (part === 'head') {
      if (this.trunk.on) this.loosen(this.trunk, t.floor.trunk, size * 0.5, t.snap.head, dir, 3);
      else this.loosen(this.head, t.floor.head, size, t.snap.head, dir, 1);
    } else {
      const i = part === 'armL' ? 0 : 1;
      const gun = i === 1 && gunHand;
      const c = this.arms[i]!;
      this.loosen(c, gun ? t.floor.gunArm : t.floor.arm, size, t.snap.arm * (gun ? 0.7 : 1), dir, c.bones.indexOf(bone));
    }
    this.live = this.order.some(c => c.on);
  }

  private loosen(c: Chain, floor: number, size: number, snap: number, dir: THREE.Vector3, struck: number): void {
    const t = SwayTuning;
    if (this.hidden(c.bones[0]!)) return;
    const to = Math.max(floor, 1 - size * t.slack);
    if (!c.on) {
      c.on = true;
      c.fresh = true;
      c.primed = false;
      c.drive = 1;
      c.weight = 1;
      for (const k of c.kick) k.set(0, 0, 0);
    }
    c.weight = 1;
    c.floor = Math.min(c.drive, to);
    c.since = 0;
    c.recover = THREE.MathUtils.lerp(t.recover[0], t.recover[1], THREE.MathUtils.clamp(size - 0.5, 0, 1));
    if (snap <= 0) return;
    // The struck bone's far end takes the snap whole, the joints beyond it most of it, and those above it a share.
    const at = (struck < 0 ? 0 : struck) + 1;
    for (let j = 1; j < c.kick.length; j++) {
      const share = j >= at ? (j === at ? 1 : 0.8) : t.spread ** (at - j);
      c.kick[j]!.addScaledVector(dir, snap * size * share);
    }
  }

  /** Lets every part go back to its animation over `seconds`: the body has been taken by something else. */
  ease(seconds: number): void {
    for (const c of this.order) {
      if (!c.on) continue;
      c.recover = Math.min(c.recover, seconds);
    }
  }

  stop(): void {
    for (const c of this.order) c.on = false;
    this.live = false;
  }

  /**
   * One frame, on the pose the animator has just written: reads where the animation has each joint, moves the live chains,
   * and writes the simulated bones back over it. `dt` is the animator's step.
   */
  step(dt: number): void {
    if (!this.live || dt <= 0) return;
    const { bones, root } = this;
    // How fast the body as a whole is going: the root, frame to frame.
    if (this.rootAt.distanceToSquared(root.position) > SwayTuning.jump * SwayTuning.jump) this.rootAt.copy(root.position);
    this.rootV.copy(root.position).sub(this.rootAt).divideScalar(dt);
    this.rootAt.copy(root.position);
    // Where the animation has every bone, in the world. The root carries no scale and its parent is the scene.
    _wq[0]!.copy(root.quaternion).multiply(bones[0]!.quaternion);
    _wp[0]!.copy(bones[0]!.position).applyQuaternion(root.quaternion).add(root.position);
    _sq[0]!.copy(_wq[0]!);
    for (let i = 1; i < BONES; i++) {
      const b = bones[i]!;
      const pi = this.parentOf[i]!;
      _wq[i]!.copy(_wq[pi]!).multiply(b.quaternion);
      _wp[i]!.copy(b.position).applyQuaternion(_wq[pi]!).add(_wp[pi]!);
      _sq[i]!.copy(_wq[i]!);
    }
    let any = false;
    for (const c of this.order) {
      if (!c.on) continue;
      if (this.hidden(c.bones[0]!)) {
        c.on = false;
        continue;
      }
      this.stepChain(c, dt);
      any ||= c.on;
    }
    this.live = any;
  }

  private stepChain(c: Chain, dt: number): void {
    const t = SwayTuning;
    const bones = this.bones;
    // How many of its bones the body still has.
    let n = 0;
    while (n < c.bones.length && !this.hidden(c.bones[n]!)) n++;
    c.count = n;
    // What it hangs on may itself be simulated (an arm on the upper body's chest): its targets ride on that, rigidly.
    const on = c.hungOn;
    _carry.copy(_wq[on]!).invert().premultiply(_sq[on]!);
    const carried = Math.abs(_carry.w) < 0.999999;
    const base = c.bones[0]!;
    // The joint it hangs from, as shown: the simulated parent's own child joint.
    _f.copy(bones[base]!.position).applyQuaternion(_sq[on]!);
    const hung = this.hungAt(c, on);
    c.a[0]!.copy(hung).add(_f);
    for (let k = 0; k < n; k++) {
      const next = k + 1 < c.bones.length ? bones[c.bones[k + 1]!]!.position : c.tip;
      _d.copy(next).applyQuaternion(_wq[c.bones[k]!]!);
      if (carried) _d.applyQuaternion(_carry);
      c.length[k + 1] = _d.length();
      c.a[k + 1]!.copy(c.a[k]!).add(_d);
    }
    if (c.fresh || c.a[0]!.distanceToSquared(c.prev[0]!) > t.jump * t.jump) {
      // From its animation, at rest against it. The snap lands on the next step, when how fast the animation moves is known.
      for (let j = 0; j <= n; j++) {
        c.x[j]!.copy(c.a[j]!);
        c.v[j]!.set(0, 0, 0);
        c.prev[j]!.copy(c.a[j]!);
      }
      c.primed = false;
      if (!c.fresh) for (const k of c.kick) k.set(0, 0, 0);
      const started = c.fresh;
      c.fresh = false;
      if (started) return;
    }
    // The drive comes back, and once it is back the last of the difference is eased out.
    c.since += dt;
    const back = smooth(c.since / c.recover);
    c.drive = c.floor + (1 - c.floor) * back;
    if (back >= 1) {
      c.weight -= dt / t.blend;
      if (c.weight <= 0) {
        c.on = false;
        return;
      }
    }
    const arm = c.part === 'armL' || c.part === 'armR';
    // The wall the arm is heading for, if one is in its reach: one ray, from the shoulder the way the wrist is going.
    c.walled = false;
    if (arm && n >= 2 && SwayWorld.ray && c.primed) {
      _g.copy(c.x[2]!).addScaledVector(c.v[2]!, dt * 2).sub(c.a[0]!);
      const reach = c.length[1]! + c.length[2]! + (n >= 3 ? c.length[3]! : 0);
      const far = _g.length();
      if (far > 1e-4 && SwayWorld.ray(c.a[0]!, _g.multiplyScalar(1 / far), reach + t.wall, _ray) && _ray.normal.dot(_g) < 0) {
        c.walled = true;
        c.wallN.copy(_ray.normal);
        c.wallD = _ray.normal.dot(_ray.point) + t.wall;
      }
    }
    const steps = dt > 1 / 80 ? 2 : 1;
    const h = dt / steps;
    const rate = t.rate * Math.sqrt(c.drive);
    const stiff = rate * rate;
    const damp = 2 * THREE.MathUtils.lerp(t.looseRatio, 1, c.drive) * rate;
    const g = t.gravity * t.weight * (1 - c.drive);
    for (let j = 1; j <= n; j++) {
      // The animation's own speed at this joint: what the spring's damping is measured against, so a part on a body that
      // is walking or reeling is carried with it and only lags what changes.
      _vt.copy(c.a[j]!).sub(c.prev[j]!).divideScalar(dt);
      const x = c.x[j]!, v = c.v[j]!;
      // Its first step. It starts with the body's own speed (a walk, a reel) and `take` of what the animation is doing to
      // this joint on top, which on a hit is the flinch's throw: with all of it, a limb that then went loose carried the
      // whole throw on by itself and a struck hand travelled twice as far as the flinch sends it (0.82 m against 0.42).
      if (!c.primed) v.copy(this.rootV).addScaledVector(_d.copy(_vt).sub(this.rootV), t.take);
      v.add(c.kick[j]!);
      c.kick[j]!.set(0, 0, 0);
      for (let s = 0; s < steps; s++) {
        _old.copy(x);
        // Toward where the animation will have it at the end of this sub-step.
        _e.copy(c.prev[j]!).lerp(c.a[j]!, (s + 1) / steps).sub(x);
        v.x += (stiff * _e.x - damp * (v.x - _vt.x)) * h;
        v.y += (stiff * _e.y - damp * (v.y - _vt.y) - g) * h;
        v.z += (stiff * _e.z - damp * (v.z - _vt.z)) * h;
        x.addScaledVector(v, h);
        // Bones do not stretch: back onto the sphere round the joint above, which has already been placed.
        const above = j === 1 ? _f.copy(c.prev[0]!).lerp(c.a[0]!, (s + 1) / steps) : c.x[j - 1]!;
        _d.copy(x).sub(above);
        const len = _d.length();
        if (len > 1e-6) _d.multiplyScalar(c.length[j]! / len);
        else _d.copy(c.a[j]!).sub(c.a[j - 1]!);
        // And no further from its animation than the cone allows.
        _e.copy(c.a[j]!).sub(c.a[j - 1]!);
        const angle = _d.angleTo(_e);
        const cone = j === 3 && c.part !== 'trunk' ? t.handCone : t.cone;
        if (angle > cone) {
          _axis.crossVectors(_e, _d);
          if (_axis.lengthSq() > 1e-10) _d.copy(_e).applyAxisAngle(_axis.normalize(), cone).setLength(c.length[j]!);
        }
        x.copy(above).add(_d);
        if (c.walled && this.keepOut(c, j, x, t.outSpeed * h)) {
          // Pushed off a wall: back to the bone's length from the joint above, along the new line.
          _d.copy(x).sub(above);
          if (_d.lengthSq() > 1e-10) x.copy(above).add(_d.setLength(c.length[j]!));
        }
        v.copy(x).sub(_old).divideScalar(h);
      }
    }
    c.primed = true;
    c.x[0]!.copy(c.a[0]!);
    for (let j = 0; j <= n; j++) c.prev[j]!.copy(c.a[j]!);

    // Shown: the simulated joints, by its weight. Then each bone turned from where its animation points to where they are.
    const w = smooth(THREE.MathUtils.clamp(c.weight, 0, 1));
    _shown[0]!.copy(c.a[0]!);
    for (let j = 1; j <= n; j++) {
      _d.copy(c.a[j]!).lerp(c.x[j]!, w).sub(_shown[j - 1]!);
      _shown[j]!.copy(_shown[j - 1]!).add(_d.setLength(c.length[j]!));
    }
    for (let kk = 0; kk < n; kk++) {
      const bone = c.bones[kk]!;
      _d.copy(c.a[kk + 1]!).sub(c.a[kk]!).normalize();
      _e.copy(_shown[kk + 1]!).sub(_shown[kk]!).normalize();
      _q.setFromUnitVectors(_d, _e);
      _sq[bone]!.copy(_wq[bone]!);
      if (carried) _sq[bone]!.premultiply(_carry);
      _sq[bone]!.premultiply(_q);
      const parent = kk === 0 ? on : c.bones[kk - 1]!;
      bones[bone]!.quaternion.copy(_sq[parent]!).invert().multiply(_sq[bone]!);
    }
    // What is left of the chain below a lost limb rides rigidly on the last simulated bone: nothing to write.
    if (c.part === 'trunk') this.trunkJoint.copy(_shown[1]!);
  }

  /**
   * Keeps joint `j` of a loose arm in front of the wall it is heading for (`SwayTuning.wall`), moving it at most `most`
   * metres. True if it moved it.
   */
  private keepOut(c: Chain, j: number, x: THREE.Vector3, most: number): boolean {
    const behind = c.wallD - c.wallN.dot(x);
    // Only if the animation is on this side of it: a body stood half in a wall keeps its arm where its animation has it.
    if (behind <= 0 || c.wallN.dot(c.a[j]!) < c.wallD - 0.02) return false;
    x.addScaledVector(c.wallN, Math.min(behind, most));
    return true;
  }

  private readonly rootAt = new THREE.Vector3(Infinity, 0, 0);
  private readonly rootV = new THREE.Vector3();

  /** Where the simulated chest's joint is: what the arms hang from while the upper body is live. */
  private readonly trunkJoint = new THREE.Vector3();

  /** The world position of the joint of the bone a chain hangs on, as shown. */
  private hungAt(c: Chain, on: number): THREE.Vector3 {
    if (on === H.chest && this.trunk.on && c !== this.trunk) return this.trunkJoint;
    return _wp[on]!;
  }
}
