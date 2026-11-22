/**
 * The Distraint Frame's modular weapon coordinator, its smoke, and the blows its body lands.
 *
 *   Arms        left arm (LMB, tap 1 to cycle rounds/mode) and right arm (RMB, tap 2 to cycle rounds/mode).
 *               R triggers manual reload on magazine/tube arms; R never cycles ammo.
 *               Implementations live in `src/frame/arms/<kind>.ts` behind `ARM_REGISTRY`.
 *   Shoulders   up to 3 mounts set by the cockpit: G (slot 1), V (slot 2), B (slot 3); 3 / 4 / 5 cycle rounds.
 *               Implementations live in `src/frame/shoulders/<kind>.ts` behind `SHOULDER_REGISTRY`.
 *   Smoke       Q (always fitted on every Frame; upgraded by Countermeasure Rack).
 *
 * The clocks and blows are pure functions/classes with no world needed, tested in `weapons.test.ts`.
 */
import * as THREE from 'three';
import { CG, type Action, type Ctx, type DamageInfo } from '../core/contracts';
import type { EnemyInstance, EnemySystem, MissileTarget } from '../core/gameplay';
import { clamp, lerp, rand, wrapAngle } from '../core/math';
import type { Round40 } from '../progression/callins/ac130Guns';
import type { Ac130Rounds, ImpactKind } from '../progression/callins/ac130Rounds';
import type { MechKind } from '../progression/callins/link';
import type { GunnerWeapon } from '../vehicles/hud';
import { angleOff, type PaintCandidate } from '../weapons/swarm';
import { FRAME, type FrameArmWeapon, type RotaryMode } from './data';
import type { ArmKind, ArmSide, ShoulderKind } from './loadout';
import { ARM_REGISTRY } from './arms/registry';
import { Cannon, Cannon40ArmGun } from './arms/cannon40';
import { Howitzer, Howitzer105ArmGun } from './arms/howitzer105';
import { Rotary, RotaryArmGun } from './arms/rotary';
import { ROUND_NAMES, airburstPoint, howitzerShockwave, shellImpact } from './arms/shared';
import type { Arm, ArmUpdateContext, FrameArmGun, Sight } from './arms/types';
import { SHOULDER_REGISTRY } from './shoulders/registry';
import { Pod, Pod6Shoulder, podMissile } from './shoulders/pod6';
import type { FrameShoulderWeapon, ShoulderUpdateContext, SmokeModifier } from './shoulders/types';

export type { FrameArmWeapon, RotaryMode } from './data';
export type { ArmKind, ArmSide, ShoulderKind } from './loadout';
export type { Arm, ArmUpdateContext, FrameArmGun, Sight } from './arms/types';
export type { FrameShoulderWeapon, ShoulderUpdateContext, SmokeModifier } from './shoulders/types';
export { Rotary } from './arms/rotary';
export { Cannon } from './arms/cannon40';
export { Howitzer } from './arms/howitzer105';
export { ROUND_NAMES, airburstPoint, howitzerShockwave, shellImpact } from './arms/shared';
export { Pod, podMissile } from './shoulders/pod6';

const P = FRAME.pod;
const UP = new THREE.Vector3(0, 1, 0);
const MAX_IN_VIEW = 24;

const SHOULDER_TRIGGERS: readonly Action[] = ['grenade', 'callinOrbital', 'callinBlackSun'];
const SHOULDER_KEYS: readonly string[] = ['G', 'V', 'B'];
const SHOULDER_CYCLE_ACTIONS: readonly Action[] = ['weapon3', 'weapon4', 'weapon5'];
const SHOULDER_CYCLE_KEYS: readonly string[] = ['3', '4', '5'];

const _hits: EnemyInstance[] = [];
const _at = new THREE.Vector3();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _zero = new THREE.Vector3();
const blow: DamageInfo = { amount: 0, type: 'crush', point: new THREE.Vector3(), dir: new THREE.Vector3(), force: 0, source: 'frame_stomp' };

// ---- smoke clock ----------------------------------------------------------------------------------------------------

/** Three pops on hand by default (up to 6 with Countermeasure Rack), never inside the lockout, regenerating over time. */
export class Smoke {
  maxCount: number = FRAME.smoke.count;
  refillSeconds: number = FRAME.smoke.refill;
  screenScale = 1;
  count: number = FRAME.smoke.count;
  private wait = 0;
  private refillIn = 0;

  get progress(): number {
    return this.count < this.maxCount ? 1 - this.refillIn / this.refillSeconds : -1;
  }

  /** Applies an optional Countermeasure Rack modifier (undefined restores standard Frame smoke). */
  configure(mod?: SmokeModifier): void {
    const nextMax = mod?.maxCharges ?? FRAME.smoke.count;
    const nextRefill = mod?.refillSeconds ?? FRAME.smoke.refill;
    this.screenScale = mod?.screenScale ?? 1;
    const grew = nextMax > this.maxCount;
    this.maxCount = nextMax;
    this.refillSeconds = nextRefill;
    if (grew) this.count = nextMax;
    else this.count = Math.min(this.count, nextMax);
    if (this.count >= this.maxCount) this.refillIn = 0;
    else if (this.refillIn > this.refillSeconds) this.refillIn = this.refillSeconds;
  }

  update(dt: number): void {
    this.wait = Math.max(0, this.wait - dt);
    if (this.count < this.maxCount) {
      this.refillIn -= dt;
      if (this.refillIn <= 0) {
        this.count++;
        this.refillIn = this.count < this.maxCount ? this.refillSeconds : 0;
      }
    }
  }

  pop(): boolean {
    if (this.count <= 0 || this.wait > 0) return false;
    const wasFull = this.count === this.maxCount;
    this.count--;
    this.wait = FRAME.smoke.lockout;
    if (wasFull) this.refillIn = this.refillSeconds;
    return true;
  }

  reset(): void {
    this.count = this.maxCount;
    this.wait = 0;
    this.refillIn = 0;
  }
}

// ---- the blows ----------------------------------------------------------------------------------------------------

/**
 * The big slam at twice the size: damage from `center` at the middle falling to `edge` at the ring, and everyone within
 * `knock` thrown off their feet. A stomp from lower than `big` is a smaller one. `ringScale` and `powerScale` scale the
 * ring radius and damage/push for Sprinter / Pile-Driver legs and Afterburner dive-bombs (both 1 for standard).
 */
export function stomp(enemies: EnemySystem, at: THREE.Vector3, height: number, ringScale = 1, powerScale = 1): number {
  if (ringScale <= 0 || powerScale <= 0) return 0;
  const S = FRAME.stomp;
  const k = height >= S.big ? 1 : S.small;
  const radius = S.radius * k * ringScale;
  const n = Math.min(enemies.query(at, radius, _hits) || 0, _hits.length);
  for (let i = 0; i < n; i++) {
    const e = _hits[i]!;
    if (!e.alive) continue;
    const d = Math.hypot(e.position.x - at.x, e.position.z - at.z);
    const knocked = d < S.knock * k * ringScale;
    blow.source = 'frame_stomp';
    blow.amount = lerp(S.center, S.edge, clamp(d / radius)) * k * powerScale;
    blow.point.copy(e.center);
    blow.dir.set(e.position.x - at.x, 0, e.position.z - at.z);
    if (blow.dir.lengthSq() < 1e-4) blow.dir.set(1, 0, 0);
    blow.dir.normalize().setY(knocked ? 0.65 : 0.35).normalize();
    blow.force = (knocked ? S.knockForce * (k < 1 ? 0.8 : 1) : S.knockForce * 0.3) * powerScale;
    blow.gib = d < 3.5 * k * ringScale;
    enemies.applyDamage(e, blow);
    blow.gib = false;
  }
  return n;
}

/** Spider Legs landing replacement: 360° 5 m knockdown sweep around the chassis. */
export function legSweep(enemies: EnemySystem, at: THREE.Vector3): number {
  const radius = 5;
  const n = Math.min(enemies.query(at, radius, _hits) || 0, _hits.length);
  let struck = 0;
  for (let i = 0; i < n; i++) {
    const e = _hits[i]!;
    if (!e.alive) continue;
    const dx = e.position.x - at.x;
    const dz = e.position.z - at.z;
    if (Math.hypot(dx, dz) > radius) continue;
    blow.source = 'frame_stomp';
    blow.amount = 140;
    blow.point.copy(e.center);
    blow.dir.set(dx, 0, dz);
    if (blow.dir.lengthSq() < 1e-4) blow.dir.set(1, 0, 0);
    blow.dir.normalize().setY(0.6).normalize();
    blow.force = 920;
    blow.gib = false;
    enemies.applyDamage(e, blow);
    struck++;
  }
  return struck;
}

/** Treads drive-over crush: flattens enemies run over by the tracks for 300 damage. */
export function treadCrush(enemies: EnemySystem, feet: THREE.Vector3, lastHit: Map<number, number>, now: number): number {
  const radius = FRAME.body.radius + 0.65;
  const n = Math.min(enemies.query(feet, radius + 0.4, _hits) || 0, _hits.length);
  let struck = 0;
  for (let i = 0; i < n; i++) {
    const e = _hits[i]!;
    if (!e.alive) continue;
    const dx = e.position.x - feet.x;
    const dz = e.position.z - feet.z;
    if (Math.hypot(dx, dz) > radius) continue;
    const prev = lastHit.get(e.uid);
    if (prev !== undefined && now - prev < 0.35) continue;
    lastHit.set(e.uid, now);
    blow.source = 'frame_foot';
    blow.amount = 300;
    blow.point.copy(e.center);
    blow.dir.set(dx, 0, dz);
    if (blow.dir.lengthSq() < 1e-4) blow.dir.set(1, 0, 0);
    blow.dir.normalize().setY(0.35).normalize();
    blow.force = 780;
    blow.gib = true;
    enemies.applyDamage(e, blow);
    blow.gib = false;
    struck++;
  }
  return struck;
}

/** Anyone in the way of a charge: flung on along it and up. `hit` keeps who has been struck, so each is once a charge. */
export function shove(enemies: EnemySystem, front: THREE.Vector3, dir: THREE.Vector3, hit: Set<number>, center?: THREE.Vector3): number {
  const H = FRAME.charge;
  let struck = 0;
  const sweep = (origin: THREE.Vector3, radius: number): void => {
    const n = Math.min(enemies.query(origin, radius, _hits) || 0, _hits.length);
    for (let i = 0; i < n; i++) {
      const e = _hits[i]!;
      if (!e.alive || hit.has(e.uid)) continue;
      hit.add(e.uid);
      blow.source = 'frame_charge';
      blow.amount = H.damage;
      blow.point.copy(e.center);
      blow.dir.copy(dir).setY(0.55).normalize();
      blow.force = H.force;
      blow.gib = true;
      enemies.applyDamage(e, blow);
      blow.gib = false;
      struck++;
    }
  };
  sweep(front, H.reach);
  if (center) sweep(center, FRAME.body.radius + 1.1);
  return struck;
}

/** Heavy arm sweep across the front + 360° close leg clear. */
export function backhand(enemies: EnemySystem, at: THREE.Vector3, yaw: number, swingDir = 1): number {
  const H = FRAME.backhand;
  const n = Math.min(enemies.query(at, H.reach + 1, _hits) || 0, _hits.length);
  let struck = 0;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const s = swingDir >= 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const e = _hits[i]!;
    const dx = e.position.x - at.x;
    const dz = e.position.z - at.z;
    const d = Math.hypot(dx, dz);
    if (!e.alive || d > H.reach) continue;
    const inFrontArc = Math.abs(wrapAngle(Math.atan2(-dx, -dz) - yaw)) <= H.arc / 2;
    const aroundLegs = d <= H.closeRadius;
    if (!inFrontArc && !aroundLegs) continue;
    blow.source = 'frame_backhand';
    blow.amount = H.damage;
    blow.point.copy(e.center);
    if (inFrontArc) {
      blow.dir.set(s * fz * 0.8 + fx * 0.45, 0.55, s * -fx * 0.8 + fz * 0.45).normalize();
    } else {
      blow.dir.set(dx, 0, dz);
      if (blow.dir.lengthSq() < 1e-4) blow.dir.set(-fx, 0, -fz);
      blow.dir.normalize().setY(0.6).normalize();
    }
    blow.force = H.force;
    blow.gib = aroundLegs;
    enemies.applyDamage(e, blow);
    blow.gib = false;
    struck++;
  }
  return struck;
}

/** A foot coming down on someone. */
export function crush(enemies: EnemySystem, foot: THREE.Vector3): number {
  const K = FRAME.crush;
  const n = Math.min(enemies.query(foot, K.radius + 0.5, _hits) || 0, _hits.length);
  let struck = 0;
  for (let i = 0; i < n; i++) {
    const e = _hits[i]!;
    if (!e.alive || Math.hypot(e.position.x - foot.x, e.position.z - foot.z) > K.radius) continue;
    blow.source = 'frame_foot';
    blow.amount = K.damage;
    blow.point.copy(e.center);
    blow.dir.set(0, -1, 0);
    blow.force = 260;
    blow.gib = true;
    enemies.applyDamage(e, blow);
    blow.gib = false;
    struck++;
  }
  return struck;
}

/** Continuous walking ankle-trample: knocks aside and crushes enemies camping against the Frame's legs while moving. */
export function trample(enemies: EnemySystem, feet: THREE.Vector3, lastHit: Map<number, number>, now: number): number {
  const K = FRAME.crush;
  const n = Math.min(enemies.query(feet, K.trampleRadius + 0.4, _hits) || 0, _hits.length);
  let struck = 0;
  for (let i = 0; i < n; i++) {
    const e = _hits[i]!;
    if (!e.alive) continue;
    const dx = e.position.x - feet.x;
    const dz = e.position.z - feet.z;
    if (Math.hypot(dx, dz) > K.trampleRadius) continue;
    const prev = lastHit.get(e.uid);
    if (prev !== undefined && now - prev < K.trampleEvery) continue;
    lastHit.set(e.uid, now);
    blow.source = 'frame_foot';
    blow.amount = K.trampleDamage;
    blow.point.copy(e.center);
    blow.dir.set(dx, 0, dz);
    if (blow.dir.lengthSq() < 1e-4) blow.dir.set(1, 0, 0);
    blow.dir.normalize().setY(0.45).normalize();
    blow.force = 520;
    blow.gib = true;
    enemies.applyDamage(e, blow);
    blow.gib = false;
    struck++;
  }
  return struck;
}

/** Close-range concussive countermeasure pulse when popping Q smoke: shoves enemies off the ankles. */
export function smokePulse(enemies: EnemySystem, at: THREE.Vector3): number {
  const S = FRAME.smoke;
  const n = Math.min(enemies.query(at, S.blastRadius, _hits) || 0, _hits.length);
  let struck = 0;
  for (let i = 0; i < n; i++) {
    const e = _hits[i]!;
    if (!e.alive) continue;
    const dx = e.position.x - at.x;
    const dz = e.position.z - at.z;
    if (Math.hypot(dx, dz) > S.blastRadius) continue;
    blow.source = 'frame_stomp';
    blow.amount = S.blastDamage;
    blow.point.copy(e.center);
    blow.dir.set(dx, 0, dz);
    if (blow.dir.lengthSq() < 1e-4) blow.dir.set(1, 0, 0);
    blow.dir.normalize().setY(0.55).normalize();
    blow.force = S.blastForce;
    enemies.applyDamage(e, blow);
    struck++;
  }
  return struck;
}

/** The smoke going: flares up and out of the back, and a ring of smoke round the legs that lasts. The look alone. */
export function smokeScreen(
  ctx: Ctx,
  rounds: Pick<Ac130Rounds, 'flare'>,
  at: THREE.Vector3,
  yaw: number,
  heard?: THREE.Vector3,
  screenScale = 1,
): void {
  const { fx, audio } = ctx;
  const S = FRAME.smoke;
  const flareCount = screenScale > 1 ? 14 : 10;
  for (let i = 0; i < flareCount; i++) {
    const a = yaw + Math.PI + ((i - (flareCount - 1) / 2) / ((flareCount - 1) / 2)) * 1.6;
    _v.set(-Math.sin(a) * rand(8, 14), rand(9, 15), -Math.cos(a) * rand(8, 14));
    _at.copy(at);
    _at.y += 5.4;
    rounds.flare(_at, _v, 2.6);
  }
  const puffCount = screenScale > 1 ? 12 : 8;
  for (let i = 0; i < puffCount; i++) {
    const a = (i / puffCount) * Math.PI * 2;
    const r = 4 * screenScale;
    _at.set(at.x + Math.cos(a) * r, at.y + rand(1.5, 4), at.z + Math.sin(a) * r);
    fx.smoke(_at, 0xc4c8cc, S.size * screenScale * rand(0.8, 1.2), S.seconds * screenScale);
  }
  audio.play('grenade_throw', { pitch: 0.6, position: heard });
  audio.play('steam_burst', { volume: 1, pitch: 0.7, position: heard });
}

// ---- modular arm mount & FrameGuns ----------------------------------------------------------------------------------

/**
 * One arm and what it carries: lazily instantiates and caches a `FrameArmGun` per `ArmKind` from `ARM_REGISTRY`.
 * Left arm fires on LMB (`fire`) and cycles ammo on `1` (`weapon1`); right arm fires on RMB (`aim`) and cycles on `2` (`weapon2`).
 */
export class ArmMount {
  private readonly cache: Partial<Record<ArmKind, FrameArmGun>> = {};
  private _kind: ArmKind;

  constructor(
    private readonly ctx: Ctx,
    readonly side: ArmSide,
    readonly trigger: 'fire' | 'aim',
    readonly arm: Arm,
    kind: ArmKind,
  ) {
    this._kind = kind;
    this.ensure(kind);
  }

  get kind(): ArmKind {
    return this._kind;
  }

  set kind(next: ArmKind) {
    if (next === this._kind) return;
    this.gun.silence();
    this._kind = next;
    this.ensure(next);
  }

  /** The currently equipped arm weapon instance. */
  get gun(): FrameArmGun {
    return this.ensure(this._kind);
  }

  private ensure(kind: ArmKind): FrameArmGun {
    let g = this.cache[kind];
    if (!g) {
      g = ARM_REGISTRY[kind].create(this.ctx);
      this.cache[kind] = g;
    }
    return g;
  }

  /** Legacy clock accessors for existing tests and callers. */
  get rotary(): Rotary {
    return (this.ensure('rotary') as RotaryArmGun).clock;
  }

  get cannon(): Cannon {
    return (this.ensure('cannon40') as Cannon40ArmGun).clock;
  }

  get howitzer(): Howitzer {
    return (this.ensure('howitzer105') as Howitzer105ArmGun).clock;
  }

  /** The mouse button that fires it, for the panel. */
  get button(): string {
    return this.side === 'left' ? 'LMB' : 'RMB';
  }

  /** The key that cycles this arm's ammo/mode (`1` left, `2` right). */
  get cycleKey(): string {
    return this.side === 'left' ? '1' : '2';
  }

  /** True when this arm is actively firing/spinning (co-op pose bit). */
  get spinning(): boolean {
    return this.gun.firing;
  }

  /** Optional heat/charge 0..1 reported by the equipped arm. */
  get heat(): number {
    return this.gun.heat ?? 0;
  }

  /** Optional walk speed multiplier (e.g. Red Beam charging slowdown). */
  get walkSpeedMult(): number {
    return this.gun.walkSpeedMult ?? 1;
  }

  /** Every cached weapon's clocks back to ready. */
  resetClocks(): void {
    for (const g of Object.values(this.cache)) g?.reset();
  }

  /** Passive cooling/reloading for all cached arm weapons while parked. */
  idleUpdate(dt: number): void {
    for (const g of Object.values(this.cache)) g?.idleUpdate(dt);
  }

  silence(): void {
    for (const g of Object.values(this.cache)) g?.silence();
  }
}

export interface FrameGunsUpdateOptions {
  /** View recoil kick multiplier (`0` on Spider Legs `noRecoil`, `1` otherwise). */
  recoilMult?: number;
  /** Frame's feet position in world space (for Point Defence, Countermeasure Rack, Mortar, FPV). */
  feet?: THREE.Vector3;
  /** Frame's torso yaw in radians. */
  torsoYaw?: number;
}

export class FrameGuns {
  readonly smoke = new Smoke();
  /** The left arm (LMB / key 1) and the right arm (RMB / key 2). */
  readonly left: ArmMount;
  readonly right: ArmMount;
  /** Active shoulder weapons for slots 0..N-1 (G, V, B). */
  readonly shoulders: FrameShoulderWeapon[] = [];
  private readonly shoulderCache: Partial<Record<ShoulderKind, FrameShoulderWeapon>>[] = [{}, {}, {}];
  /** For the HUD panel: left arm, right arm, fitted shoulders (0..3), smoke. `Frame` appends jets after these. */
  readonly rows: GunnerWeapon[] = [
    { name: '', ammo: 100, max: 100, reload: -1 },
    { name: '', ammo: 0, max: FRAME.cannon.magazine, reload: -1 },
    { name: '', ammo: 0, max: P.tubes, reload: -1 },
    { name: '', ammo: 0, max: FRAME.smoke.count },
  ];
  private readonly inView: PaintCandidate[] = [];
  private readonly pool: PaintCandidate[] = [];
  private readonly paintables: MissileTarget[] = [];
  private sight: Sight | null = null;
  private feetRef: THREE.Vector3 = _zero;
  private yawRef = 0;
  /** Set false when shoulder slot 0 (right shoulder) has been knocked out or no pod is fitted. */
  podOnline = true;
  /**
   * Co-op callbacks: told of each 40 mm / 105 mm shell, each six-tube pod missile, or any new weapon's `MechKind` note.
   */
  onShell: ((round: Round40 | 'g105', from: THREE.Vector3, aim: THREE.Vector3, seconds: number, side: ArmSide) => void) | null = null;
  onMissile: ((from: THREE.Vector3, velocity: THREE.Vector3) => void) | null = null;
  onNews: ((kind: MechKind, values: number[]) => void) | null = null;

  constructor(
    private readonly ctx: Ctx,
    private readonly rounds: Ac130Rounds,
    leftArm: Arm,
    rightArm: Arm,
    /** Where slot 0's shoulder tubes are, in the world, this frame (backward-compatible 1-arg signature). */
    private readonly tubes: (out: THREE.Vector3) => THREE.Vector3,
    /** Optional per-slot shoulder mount lookup (0 = right, 1 = left, 2 = top). Falls back to `tubes`. */
    private readonly shoulderMountPos?: (slot: number, out: THREE.Vector3) => THREE.Vector3,
  ) {
    this.left = new ArmMount(ctx, 'left', 'fire', leftArm, 'rotary');
    this.right = new ArmMount(ctx, 'right', 'aim', rightArm, 'cannon40');
    rounds.onImpact = (kind, point, normal, dir) => this.impact(kind, point, normal, dir);
    this.fitShoulders(['pod6']);
    this.label();
  }

  /** The arm carrying `kind`, the default's side first; null if neither does. */
  private carrying(kind: ArmKind): ArmMount | null {
    const [first, second] = kind === 'rotary' ? [this.left, this.right] : [this.right, this.left];
    return first.kind === kind ? first : second.kind === kind ? second : null;
  }

  /** Legacy accessors for existing tests and callers. */
  get rotary(): Rotary {
    return (this.carrying('rotary') ?? this.left).rotary;
  }

  get cannon(): Cannon {
    return (this.carrying('cannon40') ?? this.right).cannon;
  }

  get howitzer(): Howitzer {
    return (this.carrying('howitzer105') ?? this.right).howitzer;
  }

  /** The six-tube pod clock (the fitted one, or slot 0's cached pod6 clock). */
  get pod(): Pod {
    for (let i = 0; i < this.shoulders.length; i++) {
      if (this.shoulders[i]!.kind === 'pod6') return (this.shoulders[i] as Pod6Shoulder).clock;
    }
    let fallback = this.shoulderCache[0]!.pod6 as Pod6Shoulder | undefined;
    if (!fallback) {
      fallback = SHOULDER_REGISTRY.pod6.create(this.ctx) as Pod6Shoulder;
      this.shoulderCache[0]!.pod6 = fallback;
    }
    return fallback.clock;
  }

  /** What the right arm carries. */
  get armWeapon(): ArmKind {
    return this.right.kind;
  }

  /** Highest heat/charge value across both arms (shown on the crosshair heat bar). */
  get heat(): number {
    return Math.max(this.left.heat, this.right.heat);
  }

  /** Combined walk speed multiplier from charging/heavy arms (e.g. Red Beam 0.6x while charging). */
  get walkSpeedMult(): number {
    return Math.min(this.left.walkSpeedMult, this.right.walkSpeedMult);
  }

  /** Both arms, from the loadout: each with a fresh clock. */
  fitArms(left: ArmKind, right: ArmKind): void {
    this.silence();
    this.left.kind = left;
    this.right.kind = right;
    this.left.resetClocks();
    this.right.resetClocks();
    this.label();
  }

  /** Fits 0..3 shoulder weapons from the loadout and updates smoke modifiers and HUD rows. */
  fitShoulders(kinds: readonly ShoulderKind[]): void {
    for (let i = 0; i < this.shoulders.length; i++) this.shoulders[i]!.silence?.();
    this.shoulders.length = 0;
    const count = Math.min(3, kinds.length);
    for (let slot = 0; slot < count; slot++) {
      const kind = kinds[slot]!;
      const cache = this.shoulderCache[slot]!;
      let w = cache[kind];
      if (!w) {
        w = SHOULDER_REGISTRY[kind].create(this.ctx);
        cache[kind] = w;
      }
      w.reset();
      this.shoulders.push(w);
    }
    // Apply Countermeasure Rack (or any shoulder) smoke modifier.
    let smokeMod: SmokeModifier | undefined;
    for (let i = 0; i < this.shoulders.length; i++) {
      if (this.shoulders[i]!.smokeModifier) {
        smokeMod = this.shoulders[i]!.smokeModifier;
        break;
      }
    }
    this.smoke.configure(smokeMod);
    this.syncRowCount();
    this.label();
  }

  private syncRowCount(): void {
    const want = 2 + this.shoulders.length + 1;
    while (this.rows.length < want) this.rows.push({ name: '', ammo: 0, max: 1, reload: -1 });
    if (this.rows.length > want) this.rows.length = want;
  }

  /** Permanently swaps the right-arm ordnance (`cannon40` or `howitzer105`, Foreclosure's upgrade) and loads a ready chamber. */
  installArmWeapon(weapon: FrameArmWeapon): void {
    this.right.kind = weapon;
    this.right.gun.reset();
    this.label();
  }

  update(dt: number, sight: Sight, opts?: FrameGunsUpdateOptions): void {
    const { input } = this.ctx;
    this.sight = sight;
    const recoilMult = opts?.recoilMult ?? 1;
    this.feetRef = opts?.feet ?? _zero;
    this.yawRef = opts?.torsoYaw ?? 0;

    // Independent per-arm ammo/mode cycling: tap 1 = left arm ONLY, tap 2 = right arm ONLY.
    // R = manual reload only (never cycles ammo).
    const reloadPressed = input.pressed('reload');
    this.stepArm(this.left, dt, sight, input.pressed('weapon1'), reloadPressed, recoilMult);
    this.stepArm(this.right, dt, sight, input.pressed('weapon2'), reloadPressed, recoilMult);

    // Shoulders: G (slot 0), V (slot 1), B (slot 2); 3 / 4 / 5 cycle rounds (3 falls back to first cycleable shoulder).
    const c3 = input.pressed(SHOULDER_CYCLE_ACTIONS[0]!);
    const c4 = input.pressed(SHOULDER_CYCLE_ACTIONS[1]!);
    const c5 = input.pressed(SHOULDER_CYCLE_ACTIONS[2]!);
    const slot0Cycles = this.shoulders[0]?.hasCycle === true;
    let fallbackSlot = -1;
    if (c3 && !slot0Cycles) {
      for (let i = 1; i < this.shoulders.length; i++) {
        if (this.shoulders[i]!.hasCycle) { fallbackSlot = i; break; }
      }
    }
    for (let slot = 0; slot < this.shoulders.length; slot++) {
      const trigger = SHOULDER_TRIGGERS[slot]!;
      const cyclePressed = (slot === 0 && c3 && slot0Cycles)
        || (slot === 1 && c4)
        || (slot === 2 && c5)
        || slot === fallbackSlot;
      const online = slot === 0 ? this.podOnline : true;
      const u: ShoulderUpdateContext = {
        ctx: this.ctx,
        rounds: this.rounds,
        slot,
        keyLabel: SHOULDER_KEYS[slot]!,
        cycleKeyLabel: SHOULDER_CYCLE_KEYS[slot]!,
        sight,
        mountPos: out => (this.shoulderMountPos ? this.shoulderMountPos(slot, out) : this.tubes(out)),
        feet: this.feetRef,
        torsoYaw: this.yawRef,
        held: input.isDown(trigger),
        pressed: input.pressed(trigger),
        cyclePressed,
        online,
        gatherTargets: (range, coneCos) => this.gather(range, coneCos),
        onMissile: this.onMissile,
        onNews: this.onNews,
        popFreeFlares: () => {
          smokeScreen(this.ctx, this.rounds, this.feetRef, this.yawRef, undefined, this.smoke.screenScale);
          this.onNews?.('smoke', []);
        },
      };
      this.shoulders[slot]!.update(dt, u);
    }

    // Smoke & in-flight rounds.
    this.smoke.update(dt);
    this.rounds.update(dt);
    this.label();
  }

  private stepArm(
    m: ArmMount,
    dt: number,
    sight: Sight,
    cyclePressed: boolean,
    reloadPressed: boolean,
    recoilMult: number,
  ): void {
    const { input } = this.ctx;
    const u: ArmUpdateContext = {
      ctx: this.ctx,
      rounds: this.rounds,
      arm: m.arm,
      side: m.side,
      button: m.button,
      cycleKey: m.cycleKey,
      sight,
      held: input.isDown(m.trigger),
      pressed: input.pressed(m.trigger),
      cyclePressed,
      reloadPressed,
      recoilMult,
      onShell: this.onShell,
      onNews: this.onNews,
    };
    m.gun.update(dt, u);
  }

  /** The painted marks for the HUD panel (from whichever fitted shoulder currently has marks). */
  get marks(): readonly MissileTarget[] {
    for (let i = 0; i < this.shoulders.length; i++) {
      const m = this.shoulders[i]!.marks;
      if (m && m.length > 0) return m;
    }
    return this.pod.painter.marks;
  }

  /** Syncs HUD weapon row names and ammo counts. */
  label(): void {
    this.syncRowCount();
    this.left.gun.fillRow(this.rows[0]!, this.left.button, this.left.cycleKey);
    this.right.gun.fillRow(this.rows[1]!, this.right.button, this.right.cycleKey);
    for (let slot = 0; slot < this.shoulders.length; slot++) {
      const row = this.rows[2 + slot]!;
      const online = slot === 0 ? this.podOnline : true;
      this.shoulders[slot]!.fillRow(row, SHOULDER_KEYS[slot]!, SHOULDER_CYCLE_KEYS[slot]!, online);
    }
    const smoke = this.rows[2 + this.shoulders.length]!;
    smoke.name = 'Q SMOKE';
    smoke.ammo = this.smoke.count;
    smoke.max = this.smoke.maxCount;
    smoke.reload = this.smoke.progress;
  }

  /** Passive cooling, reloads, smoke refill, and in-flight shells while parked empty on the map. */
  idleUpdate(dt: number): void {
    this.left.idleUpdate(dt);
    this.right.idleUpdate(dt);
    for (let i = 0; i < this.shoulders.length; i++) this.shoulders[i]!.idleUpdate(dt);
    this.smoke.update(dt);
    this.rounds.update(dt);
  }

  private impact(kind: ImpactKind, point: THREE.Vector3, normal: THREE.Vector3 | null, dir: THREE.Vector3): void {
    shellImpact(this.ctx, kind, point, normal, dir);
  }

  /** Everyone near the sight with a clear line to them, enemies and then vehicles: the Quiver's rule, from the cockpit. */
  private gather(range: number = P.range, coneCos: number = Math.cos(P.cone)): readonly PaintCandidate[] {
    const out = this.inView;
    out.length = 0;
    const { enemies } = this.ctx;
    for (let i = 0; i < enemies.alive.length && out.length < MAX_IN_VIEW; i++) this.consider(enemies.alive[i]!, range, coneCos);
    const v = enemies.vehicles;
    if (v && typeof v.paintable === 'function') {
      const n = v.paintable(this.paintables);
      for (let i = 0; i < n && out.length < MAX_IN_VIEW; i++) this.consider(this.paintables[i]!, range, coneCos);
      this.paintables.length = 0;
    }
    return out;
  }

  private consider(target: MissileTarget, range: number, coneCos: number): void {
    const sight = this.sight;
    if (!target.alive || !sight) return;
    const at = _v.copy(target.center);
    at.y += target.aimLift ?? 0;
    const angle = angleOff(sight.view.position, sight.aim, at, range, coneCos);
    if (angle < 0) return;
    const dir = _w.subVectors(at, sight.view.position);
    const dist = dir.length();
    dir.divideScalar(dist);
    const wall = this.ctx.physics.raycast(sight.view.position, dir, dist, CG.World);
    if (wall && wall.distance < dist - (target.paintRadius ?? 0.6)) return;
    const k = this.inView.length;
    const slot = this.pool[k] ?? (this.pool[k] = { target, angle });
    slot.target = target;
    slot.angle = angle;
    this.inView.push(slot);
  }

  /** Flares up and out of the back, smoke wall around the legs, and a concussive countermeasure pulse that clears close enemies. */
  popSmoke(at: THREE.Vector3, yaw: number): boolean {
    if (!this.smoke.pop()) return false;
    smokeScreen(this.ctx, this.rounds, at, yaw, undefined, this.smoke.screenScale);
    smokePulse(this.ctx.enemies, at);
    this.ctx.fx.ring(_at.copy(at).setY(at.y + 1.2), UP, '#ffd080', FRAME.smoke.blastRadius * this.smoke.screenScale);
    return true;
  }

  /** Off the trigger, quietly: a new run or out of the seat. Shells and missiles in the air still land. */
  silence(): void {
    this.left.silence();
    this.right.silence();
    for (let i = 0; i < this.shoulders.length; i++) this.shoulders[i]!.silence?.();
  }

  reset(): void {
    this.silence();
    this.left.resetClocks();
    this.right.resetClocks();
    this.left.kind = 'rotary';
    this.right.kind = 'cannon40';
    this.fitShoulders(['pod6']);
    this.smoke.reset();
    this.rounds.clear();
    this.label();
  }
}
