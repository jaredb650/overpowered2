/**
 * Linear Rail Rifle arm weapon plug-in (`src/frame/arms/rail.ts`).
 *
 * Precision electromagnetic anti-armour rifle (`10` sabot rounds, `2.4 s` reload on `R` or empty):
 *   - Tap Fire (`0.55 s` cadence): instant hyper-velocity rail slug (`220 dmg`, pierces up to `3` enemies
 *     in a line in `SABOT` mode, `severMult: 2.0`, electric-blue shockwave rings along the beam).
 *   - Hold Charge (`0.9 s`) & Release: Hyper-Piercing Sabot (`620 * energyMult` dmg, pierces ALL enemies
 *     AND up to `4.0 m` of cover/walls by continuing raycast past the first thin obstacle, massive sonic
 *     crack, vapor rings, `0.45` camera trauma, `0.7` barrel recoil). Walk speed `0.75x` while holding full charge.
 *   - Tap `1` (left) / `2` (right) toggles `SABOT` (max pierce) vs `ARC` (chains `140` dmg electric shock to
 *     up to `2` nearby enemies on hit).
 */
import * as THREE from 'three';
import { CG, type Ctx, type DamageInfo, type LoopHandle, type PlayOptions } from '../../core/contracts';
import type { EnemyInstance } from '../../core/gameplay';
import { clamp, rand } from '../../core/math';
import type { MechKind } from '../../progression/callins/link';
import type { GunnerWeapon } from '../../vehicles/hud';
import type { Combat } from '../../weapons/Combat';
import { bossHit } from '../../weapons/data';
import type { Raycaster } from '../../weapons/penetration';
import type { ArmPlugin, ArmUpdateContext, FrameArmGun } from './types';

const EPS = 1e-6;
const UP = new THREE.Vector3(0, 1, 0);

export type RailMode = 'sabot' | 'arc';

export const RAIL = {
  /** Sabot magazine capacity. */
  rounds: 10,
  /** Reload duration on `R` or empty (seconds). */
  reloadTime: 2.4,
  /** Semi-auto tap fire cadence (seconds). */
  tapCadence: 0.55,
  /** Post-shot recovery interval after a full charged shot (seconds). */
  chargedCadence: 0.85,
  /** Hold time to reach full Hyper-Piercing Sabot charge (seconds, scaled by `energyMult`). */
  chargeTime: 0.9,
  /** Tap slug damage. */
  tapDamage: 220,
  /** Maximum enemies pierced by a tap shot in `SABOT` mode. */
  tapMaxPierce: 3,
  /** Limb-sever multiplier on rail impacts. */
  severMult: 2.0,
  /** Charged Hyper-Piercing Sabot base damage (multiplied by `energyMult`). */
  chargedDamage: 620,
  /** Maximum obstacle/wall thickness pierced by a charged shot (metres). */
  chargedWallThickness: 4.0,
  /** Camera trauma on charged shot (scaled by `u.recoilMult`). */
  chargedTrauma: 0.45,
  /** Physical arm barrel recoil distance on charged shot (metres). */
  chargedRecoil: 0.7,
  /** Walk speed multiplier while holding full charge. */
  chargedWalkSpeedMult: 0.75,
  /** `ARC` mode chain-lightning shock damage per chained enemy. */
  arcDamage: 140,
  /** Maximum nearby enemies chained per hit in `ARC` mode. */
  arcMaxTargets: 2,
  /** Chain lightning search radius around struck target (metres). */
  arcRange: 11,
  /** Maximum raycast sniper reach (metres). */
  range: 240,
  /** Lateral hit corridor radius against enemy body columns (metres). */
  hitRadius: 0.85,
} as const;

export interface RailTrace {
  readonly end: THREE.Vector3;
  readonly endNormal: THREE.Vector3;
  reach: number;
  hitFinalWall: boolean;
  piercedWall: boolean;
  readonly wallEntry: THREE.Vector3;
  readonly wallEntryNormal: THREE.Vector3;
  readonly wallExit: THREE.Vector3;
  readonly wallExitNormal: THREE.Vector3;
}

export function makeRailTrace(): RailTrace {
  return {
    end: new THREE.Vector3(),
    endNormal: new THREE.Vector3(0, 1, 0),
    reach: 0,
    hitFinalWall: false,
    piercedWall: false,
    wallEntry: new THREE.Vector3(),
    wallEntryNormal: new THREE.Vector3(),
    wallExit: new THREE.Vector3(),
    wallExitNormal: new THREE.Vector3(),
  };
}

// Module-level scratch objects (zero per-frame allocations).
const _muzzle = new THREE.Vector3();
const _bore = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _probe = new THREE.Vector3();
const _back = new THREE.Vector3();
const _traceOrigin = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _pt = new THREE.Vector3();
const _hitPt = new THREE.Vector3();
const _remoteFrom = new THREE.Vector3();
const _remoteTo = new THREE.Vector3();
const _remoteDir = new THREE.Vector3();
const _enemies: EnemyInstance[] = [];
const _arcPool: EnemyInstance[] = [];
const _play: PlayOptions = {};
const _dmg: DamageInfo = {
  amount: 0,
  type: 'bullet',
  point: new THREE.Vector3(),
  dir: new THREE.Vector3(),
  force: 95,
  source: 'frame_rail',
  region: 'chest',
  severMult: RAIL.severMult,
  armorPiercing: true,
};

interface LineHit {
  enemy: EnemyInstance | null;
  along: number;
  readonly point: THREE.Vector3;
}
const _lineHits: LineHit[] = Array.from({ length: 64 }, () => ({
  enemy: null,
  along: 0,
  point: new THREE.Vector3(),
}));
const _hitSet = new Set<number>();

/**
 * Probes along `dir` from `entry` up to `maxThickness` (4.0 m for charged rail shots) to find the far face
 * of a solid obstacle. Returns thickness in metres when pierced, or `-1` if thicker than `maxThickness`.
 */
export function probeRailWallExit(
  physics: Raycaster,
  entry: THREE.Vector3,
  dir: THREE.Vector3,
  maxThickness: number,
  outExit: THREE.Vector3,
  outNormal: THREE.Vector3,
): number {
  const step = 0.2;
  const maxProbe = maxThickness + step;
  _back.copy(dir).negate();
  for (let depth = step; depth <= maxProbe + 1e-4; depth += step) {
    _probe.copy(entry).addScaledVector(dir, depth);
    const hit = physics.raycast(_probe, _back, depth - 0.005, CG.World);
    if (!hit) {
      // Thin hollow trimesh/skin with open air behind it.
      if (depth <= maxThickness + 1e-3) {
        outExit.copy(_probe);
        outNormal.copy(dir);
        return depth;
      }
      return -1;
    }
    if (hit.distance > 0.002) {
      const thickness = depth - hit.distance;
      if (thickness <= maxThickness + 1e-3) {
        outExit.copy(entry).addScaledVector(dir, thickness);
        if (outNormal.copy(hit.normal).dot(dir) <= 0) outNormal.copy(dir);
        return thickness;
      }
      return -1;
    }
  }
  return -1;
}

/**
 * Traces a Linear Rail Rifle shot along `(origin, dir)` up to `maxRange`.
 * When `pierceWall` is true, penetrates the first obstacle up to `maxWallThickness` (4.0 m) and continues
 * raycasting past it so enemies behind cover are struck cleanly.
 */
export function traceRailShot(
  physics: Raycaster,
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  pierceWall: boolean,
  maxRange: number = RAIL.range,
  maxWallThickness: number = RAIL.chargedWallThickness,
  out: RailTrace = makeRailTrace(),
): RailTrace {
  out.hitFinalWall = false;
  out.piercedWall = false;
  out.endNormal.set(0, 1, 0);

  const first = physics.raycast(origin, dir, maxRange, CG.World);
  if (!first) {
    out.reach = maxRange;
    out.end.copy(origin).addScaledVector(dir, maxRange);
    return out;
  }

  const firstDist = Math.min(maxRange, Math.max(0, first.distance));
  if (!pierceWall) {
    out.reach = firstDist;
    out.end.copy(first.point);
    out.endNormal.copy(first.normal);
    out.hitFinalWall = true;
    return out;
  }

  const thickness = probeRailWallExit(physics, first.point, dir, maxWallThickness, out.wallExit, out.wallExitNormal);
  if (thickness < 0) {
    out.reach = firstDist;
    out.end.copy(first.point);
    out.endNormal.copy(first.normal);
    out.hitFinalWall = true;
    return out;
  }

  out.piercedWall = true;
  out.wallEntry.copy(first.point);
  out.wallEntryNormal.copy(first.normal);

  const advance = thickness + 0.05;
  const remaining = maxRange - firstDist - advance;
  if (remaining <= 0.05) {
    out.reach = maxRange;
    out.end.copy(origin).addScaledVector(dir, maxRange);
    return out;
  }

  _traceOrigin.copy(out.wallExit).addScaledVector(dir, 0.05);
  const second = physics.raycast(_traceOrigin, dir, remaining, CG.World);
  if (!second) {
    out.reach = maxRange;
    out.end.copy(origin).addScaledVector(dir, maxRange);
    return out;
  }

  out.reach = Math.min(maxRange, firstDist + advance + Math.max(0, second.distance));
  out.end.copy(second.point);
  out.endNormal.copy(second.normal);
  out.hitFinalWall = true;
  return out;
}

function enemyLineDistanceSq(
  e: EnemyInstance,
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  reach: number,
  outPoint: THREE.Vector3,
): number {
  const top = e.char?.rig ? e.char.rig.height : 1.8;
  let bestD2 = Infinity;
  let bestAlong = -1;

  for (let i = 0; i < 3; i++) {
    const sy = i === 1 ? e.center.y : e.position.y + 0.3 + (top - 0.3) * (i / 2);
    const sx = i === 1 ? e.center.x : e.position.x;
    const sz = i === 1 ? e.center.z : e.position.z;
    const dx = sx - origin.x;
    const dy = sy - origin.y;
    const dz = sz - origin.z;
    const along = dx * dir.x + dy * dir.y + dz * dir.z;
    if (along < 0 || along > reach + 0.4) continue;
    const clamped = clamp(along, 0, reach);
    const px = dx - dir.x * clamped;
    const py = dy - dir.y * clamped;
    const pz = dz - dir.z * clamped;
    const d2 = px * px + py * py + pz * pz;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestAlong = clamped;
    }
  }

  if (bestAlong >= 0) {
    outPoint.copy(origin).addScaledVector(dir, bestAlong);
  }
  return bestD2;
}

export type RailFireKind = 'none' | 'tap' | 'charged';

/** Pure state machine for the Linear Rail Rifle's 10-round magazine, 0.9 s charge, and SABOT/ARC toggle. */
export class RailClock {
  readonly capacity = RAIL.rounds;
  rounds: number = RAIL.rounds;
  reloading = false;
  reloadTimer = 0;
  cooldown = 0;
  charging = false;
  /** Normalized hold charge 0..1. */
  charge = 0;
  holdElapsed = 0;
  mode: RailMode = 'sabot';

  /** One-frame transition flags. */
  reachedFull = false;
  finishedReload = false;
  firedKind: RailFireKind = 'none';

  get ready(): boolean {
    return !this.reloading && this.rounds > 0 && this.cooldown <= EPS;
  }

  get holdingFull(): boolean {
    return this.charging && this.charge >= 1 - EPS;
  }

  /** Walk-speed multiplier: `0.75` while holding full charge, `1` otherwise. */
  get walkSpeedMult(): number {
    return this.holdingFull ? RAIL.chargedWalkSpeedMult : 1;
  }

  get reloadProgress(): number {
    return this.reloading ? clamp(1 - this.reloadTimer / RAIL.reloadTime) : -1;
  }

  get heat(): number {
    if (this.charging) return clamp(this.charge);
    if (this.reloading) return clamp(1 - this.reloadTimer / RAIL.reloadTime);
    return 0;
  }

  toggleMode(): RailMode {
    this.mode = this.mode === 'sabot' ? 'arc' : 'sabot';
    return this.mode;
  }

  startReload(): boolean {
    if (this.reloading || this.rounds >= this.capacity) return false;
    this.reloading = true;
    this.reloadTimer = RAIL.reloadTime;
    this.rounds = 0;
    this.charging = false;
    this.charge = 0;
    this.holdElapsed = 0;
    return true;
  }

  update(dt: number, pressed: boolean, held: boolean, energyMult = 1): RailFireKind {
    this.reachedFull = false;
    this.finishedReload = false;
    this.firedKind = 'none';

    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);

    if (this.reloading) {
      this.reloadTimer = Math.max(0, this.reloadTimer - dt);
      if (this.reloadTimer <= EPS) {
        this.reloading = false;
        this.reloadTimer = 0;
        this.rounds = this.capacity;
        this.finishedReload = true;
      }
      return 'none';
    }

    // Single-frame tap (`pressed && !held`): immediately fire a hyper-velocity tap slug if ready.
    if (pressed && !held && !this.charging && this.ready) {
      this.consumeAndTrigger('tap');
      return this.firedKind;
    }

    if (held) {
      if (!this.charging && this.ready) {
        this.charging = true;
        this.charge = 0;
        this.holdElapsed = 0;
      }
      if (this.charging) {
        this.holdElapsed += dt;
        const wasFull = this.charge >= 1 - EPS;
        const rate = Math.max(0.25, energyMult) / RAIL.chargeTime;
        this.charge = Math.min(1, this.charge + dt * rate);
        if (!wasFull && this.charge >= 1 - EPS) {
          this.charge = 1;
          this.reachedFull = true;
        }
      }
      return 'none';
    }

    // Released trigger while charging: fire charged Hyper-Piercing Sabot if full, otherwise tap slug.
    if (this.charging) {
      const isCharged = this.charge >= 1 - EPS;
      this.charging = false;
      this.charge = 0;
      this.holdElapsed = 0;
      if (this.rounds > 0) {
        this.consumeAndTrigger(isCharged ? 'charged' : 'tap');
      }
      return this.firedKind;
    }

    return 'none';
  }

  private consumeAndTrigger(kind: 'tap' | 'charged'): void {
    this.rounds = Math.max(0, this.rounds - 1);
    this.cooldown = kind === 'charged' ? RAIL.chargedCadence : RAIL.tapCadence;
    this.firedKind = kind;
    if (this.rounds === 0) {
      this.reloading = true;
      this.reloadTimer = RAIL.reloadTime;
    }
  }

  reset(): void {
    this.rounds = this.capacity;
    this.reloading = false;
    this.reloadTimer = 0;
    this.cooldown = 0;
    this.charging = false;
    this.charge = 0;
    this.holdElapsed = 0;
    this.mode = 'sabot';
    this.reachedFull = false;
    this.finishedReload = false;
    this.firedKind = 'none';
  }
}

export class RailArmGun implements FrameArmGun {
  readonly kind = 'rail' as const;
  readonly clock = new RailClock();
  private readonly trace = makeRailTrace();
  private chargeLoop: LoopHandle | null = null;
  private fireFlash = 0;

  constructor(private readonly ctx: Ctx) {}

  get firing(): boolean {
    return this.clock.charging && this.clock.charge > 0.15;
  }

  get heat(): number {
    return this.clock.heat;
  }

  get walkSpeedMult(): number {
    return this.clock.walkSpeedMult;
  }

  update(dt: number, u: ArmUpdateContext): void {
    const { audio } = this.ctx;
    const energyMult = u.energyMult ?? 1;

    if (u.cyclePressed) {
      const next = this.clock.toggleMode();
      _play.position = undefined;
      _play.volume = 0.68;
      _play.pitch = next === 'arc' ? 1.24 : 0.92;
      _play.pitchJitter = 0;
      audio.play('rocket_laser', _play);
    }

    if (u.reloadPressed && this.clock.startReload()) {
      this.stopChargeAudio();
      _play.position = undefined;
      _play.volume = 0.78;
      _play.pitch = 0.8;
      _play.pitchJitter = 0;
      audio.play('reload_bolt', _play);
    }

    if (u.pressed && this.clock.reloading) {
      audio.play('weapon_dry');
    }

    const fired = this.clock.update(dt, u.pressed, u.held, energyMult);

    if (this.clock.finishedReload) {
      _play.position = undefined;
      _play.volume = 0.82;
      _play.pitch = 0.96;
      _play.pitchJitter = 0;
      audio.play('reload_mag_in', _play);
    }

    if (this.clock.reachedFull) {
      _play.position = undefined;
      _play.volume = 0.85;
      _play.pitch = 1.05;
      _play.pitchJitter = 0;
      audio.play('railgun_ready', _play);
    }

    if (this.clock.charging && this.clock.holdElapsed >= 0.14) {
      if (!this.chargeLoop) {
        this.chargeLoop = audio.startLoop?.('railgun_charge_loop', { pitch: 0.55, volume: 0.28 }) ?? null;
      }
      this.chargeLoop?.setPitch(0.55 + this.clock.charge * 0.85, 0.05);
      this.chargeLoop?.setVolume(0.28 + this.clock.charge * 0.52, 0.06);
    } else {
      this.stopChargeAudio();
    }

    if (fired !== 'none') {
      this.stopChargeAudio();
      this.shoot(u, fired === 'charged', energyMult);
      this.fireFlash = fired === 'charged' ? 1.0 : 0.65;
    }

    if (this.fireFlash > 0) this.fireFlash = Math.max(0, this.fireFlash - dt * 3.2);

    u.arm.setActive?.(Math.max(this.clock.charge, this.fireFlash), this.clock.mode === 'arc' ? 1 : 0);
  }

  idleUpdate(dt: number): void {
    this.clock.update(dt, false, false, 1);
    this.stopChargeAudio();
  }

  fillRow(row: GunnerWeapon, button: string, cycleKey: string): void {
    const modeLabel = this.clock.mode === 'sabot' ? 'SABOT' : 'ARC';
    const chargeTag = this.clock.holdingFull ? ' [FULL]' : '';
    row.name = `${button} RAIL ${modeLabel}${chargeTag} // ${cycleKey}`;
    row.ammo = this.clock.rounds;
    row.max = RAIL.rounds;
    row.reload = this.clock.reloadProgress;
    row.selected = this.clock.holdingFull;
  }

  silence(): void {
    this.stopChargeAudio();
  }

  reset(): void {
    this.silence();
    this.clock.reset();
    this.fireFlash = 0;
  }

  private stopChargeAudio(): void {
    if (!this.chargeLoop) return;
    this.chargeLoop.stop(0.06);
    this.chargeLoop = null;
  }

  private shoot(u: ArmUpdateContext, charged: boolean, energyMult: number): void {
    const c = this.ctx;
    const { audio, camera, enemies, fx, hud, physics, render } = c;

    u.arm.muzzle(_muzzle);
    u.arm.bore(_bore);
    _dir.copy(u.sight.aim);
    if (_dir.lengthSq() < 1e-6) _dir.copy(_bore);
    _dir.normalize();

    const origin = u.sight.view.position;
    traceRailShot(physics, origin, _dir, charged, RAIL.range, RAIL.chargedWallThickness, this.trace);
    const reach = this.trace.reach;

    // Gather and sort all alive enemies intersecting the rail line along [0, reach].
    _mid.copy(origin).addScaledVector(_dir, reach * 0.5);
    const found = Math.min(enemies.query(_mid, reach * 0.5 + 3, _enemies) || 0, _enemies.length);
    const r2 = RAIL.hitRadius * RAIL.hitRadius;
    let hitCount = 0;
    for (let i = 0; i < found; i++) {
      const e = _enemies[i]!;
      if (!e.alive) continue;
      const d2 = enemyLineDistanceSq(e, origin, _dir, reach, _hitPt);
      if (d2 > r2) continue;
      if (hitCount >= _lineHits.length) break;
      const slot = _lineHits[hitCount++]!;
      slot.enemy = e;
      slot.along = _hitPt.distanceTo(origin);
      slot.point.copy(_hitPt);
    }
    _enemies.length = 0;

    // Insertion sort by distance along ray (tiny array, zero allocations).
    for (let i = 1; i < hitCount; i++) {
      const keyE = _lineHits[i]!.enemy;
      const keyAlong = _lineHits[i]!.along;
      const kx = _lineHits[i]!.point.x;
      const ky = _lineHits[i]!.point.y;
      const kz = _lineHits[i]!.point.z;
      let j = i - 1;
      while (j >= 0 && _lineHits[j]!.along > keyAlong) {
        _lineHits[j + 1]!.enemy = _lineHits[j]!.enemy;
        _lineHits[j + 1]!.along = _lineHits[j]!.along;
        _lineHits[j + 1]!.point.copy(_lineHits[j]!.point);
        j--;
      }
      _lineHits[j + 1]!.enemy = keyE;
      _lineHits[j + 1]!.along = keyAlong;
      _lineHits[j + 1]!.point.set(kx, ky, kz);
    }

    const maxPierce = charged
      ? Infinity
      : (this.clock.mode === 'sabot' ? RAIL.tapMaxPierce : 1);
    const damage = charged ? RAIL.chargedDamage * energyMult : RAIL.tapDamage;
    const sever = charged ? 2.5 : RAIL.severMult;
    const force = charged ? 210 : 95;

    _hitSet.clear();
    let struck = 0;
    let firstStruck: EnemyInstance | null = null;
    for (let i = 0; i < hitCount && struck < maxPierce; i++) {
      const h = _lineHits[i]!;
      const e = h.enemy;
      if (!e || !e.alive) continue;
      this.applyRailDamage(e, damage, h.point, _dir, sever, force, 'bullet', 'frame_rail');
      _hitSet.add(e.uid);
      if (!firstStruck) firstStruck = e;
      fx.sparks(h.point, _dir, charged ? 18 : 10, '#48e8ff');
      struck++;
    }
    for (let i = 0; i < hitCount; i++) _lineHits[i]!.enemy = null;

    // ARC mode: chain 140 electric shock damage to up to 2 nearby enemies on hit!
    if (this.clock.mode === 'arc' && firstStruck) {
      this.chainArcShock(firstStruck);
    }

    if (struck > 0) hud.hitMarker?.('body');

    // Explosives & enemy vehicles along wall strikes / impact end.
    c.world?.objects?.damageExplosivesInRadius?.(this.trace.end, charged ? 3.2 : 1.8, damage, 'frame_rail');
    enemies.vehicles?.frameBlow?.(this.trace.end, charged ? 3.5 : 2.0, charged ? 180 : 75, _dir, 'frame_rail');

    // Visuals: crisp electric-blue rail beam + spaced shockwave & supersonic vapor rings.
    fx.muzzleFlash(_muzzle, _bore, 'railgun');
    fx.beam(_muzzle, this.trace.end, 'rail', charged ? 0.34 : 0.14, charged ? 0.45 : 0.24);
    const ringCount = charged ? 6 : 3;
    for (let r = 1; r <= ringCount; r++) {
      const frac = r / (ringCount + 1);
      _pt.lerpVectors(_muzzle, this.trace.end, frac);
      fx.ring(_pt, _dir, this.clock.mode === 'arc' ? '#88c8ff' : '#38d8ff', charged ? 2.4 : 1.35);
      if (charged) {
        fx.vaporRing?.(_pt, _dir, 1.55);
      }
    }
    if (this.trace.piercedWall) {
      fx.sparks(this.trace.wallEntry, this.trace.wallEntryNormal, 20, '#55e8ff');
      fx.sparks(this.trace.wallExit, this.trace.wallExitNormal, 24, '#88f0ff');
      fx.ring(this.trace.wallExit, _dir, '#55e8ff', 2.2);
    }
    if (this.trace.hitFinalWall) {
      fx.impact(this.trace.end, this.trace.endNormal, 'concrete', charged ? 1.8 : 1.1);
      fx.sparks(this.trace.end, this.trace.endNormal, charged ? 24 : 12, '#48e8ff');
    }
    render?.lights?.flash?.(_muzzle, 0x48e8ff, charged ? 16 : 9, charged ? 20 : 12, charged ? 0.22 : 0.1);

    // Co-op notification for teammates.
    u.onNews?.('rail', [
      _muzzle.x, _muzzle.y, _muzzle.z,
      this.trace.end.x, this.trace.end.y, this.trace.end.z,
      charged ? 1 : 0,
    ]);

    // Audio: crisp electromagnetic snap on tap, massive sonic crack on Hyper-Piercing Sabot.
    _play.position = undefined;
    _play.volume = charged ? 1.2 : 0.88;
    _play.pitch = charged ? 0.78 : 1.16;
    _play.pitchJitter = 0.03;
    audio.play('railgun_fire', _play);
    if (charged) {
      audio.play('railgun_beam', { volume: 0.95, pitch: 0.88 });
    }

    // Recoil & camera shake: 0.7 m barrel recoil & 0.45 trauma on charged shot.
    u.arm.recoil(charged ? RAIL.chargedRecoil : 0.34);
    if (u.recoilMult > 0) {
      camera.addTrauma?.((charged ? RAIL.chargedTrauma : 0.18) * u.recoilMult);
      camera.kick?.((charged ? 0.042 : 0.018) * u.recoilMult, rand(-0.006, 0.006) * u.recoilMult);
      if (charged) {
        camera.fovPunch?.(4.5 * u.recoilMult, 0.2);
      }
    }
  }

  private chainArcShock(originEnemy: EnemyInstance): void {
    const { audio, enemies, fx } = this.ctx;
    const count = Math.min(enemies.query(originEnemy.center, RAIL.arcRange, _arcPool) || 0, _arcPool.length);

    let chained = 0;
    for (let k = 0; k < RAIL.arcMaxTargets; k++) {
      let best: EnemyInstance | null = null;
      let bestD2 = RAIL.arcRange * RAIL.arcRange;
      for (let i = 0; i < count; i++) {
        const candidate = _arcPool[i]!;
        if (!candidate.alive || _hitSet.has(candidate.uid)) continue;
        const d2 = candidate.center.distanceToSquared(originEnemy.center);
        if (d2 <= bestD2) {
          bestD2 = d2;
          best = candidate;
        }
      }
      if (!best) break;

      _hitSet.add(best.uid);
      _pt.subVectors(best.center, originEnemy.center);
      if (_pt.lengthSq() < 1e-4) _pt.copy(UP);
      else _pt.normalize();

      this.applyRailDamage(best, RAIL.arcDamage, best.center, _pt, 1.0, 28, 'shock', 'frame_rail_arc');
      fx.arc(originEnemy.center, best.center, '#66e4ff', 0.28, 0.14);
      fx.sparks(best.center, UP, 10, '#77e8ff');
      _play.position = best.center;
      _play.volume = 0.82;
      _play.pitch = 1.05 + chained * 0.12;
      _play.pitchJitter = 0.04;
      audio.play('lightning_arc', _play);
      chained++;
    }
    _arcPool.length = 0;
  }

  private applyRailDamage(
    enemy: EnemyInstance,
    amount: number,
    point: THREE.Vector3,
    dir: THREE.Vector3,
    severMult: number,
    force: number,
    type: 'bullet' | 'shock',
    source: string,
  ): void {
    const combat = this.ctx.combat as Combat | undefined;
    if (combat && typeof combat.strike === 'function' && typeof combat.strikeOptions === 'function') {
      const o = combat.strikeOptions(type, source);
      o.force = force;
      o.severMult = severMult;
      o.quiet = true;
      o.pierces = true;
      combat.strike(enemy, point, UP, dir, undefined, 'chest', amount, o);
      return;
    }
    _dmg.amount = bossHit(enemy.isBoss, amount);
    _dmg.type = type;
    _dmg.source = source;
    _dmg.force = force;
    _dmg.severMult = severMult;
    _dmg.armorPiercing = type === 'bullet';
    _dmg.point.copy(point);
    _dmg.dir.copy(dir);
    this.ctx.enemies.applyDamage(enemy, _dmg);
  }
}

export const RAIL_PLUGIN: ArmPlugin = {
  kind: 'rail',
  newsKinds: ['rail'],
  create: ctx => new RailArmGun(ctx),
  remoteNews(ctx: Ctx, kind: MechKind, values: number[]): void {
    if (kind !== 'rail' || values.length < 6) return;
    _remoteFrom.set(values[0]!, values[1]!, values[2]!);
    _remoteTo.set(values[3]!, values[4]!, values[5]!);
    const charged = (values[6] ?? 0) >= 0.5;

    _remoteDir.subVectors(_remoteTo, _remoteFrom);
    if (_remoteDir.lengthSq() < 1e-6) return;
    _remoteDir.normalize();

    ctx.fx.muzzleFlash(_remoteFrom, _remoteDir, 'railgun');
    ctx.fx.beam(_remoteFrom, _remoteTo, 'rail', charged ? 0.34 : 0.14, charged ? 0.42 : 0.22);
    const rings = charged ? 4 : 2;
    for (let i = 1; i <= rings; i++) {
      _pt.lerpVectors(_remoteFrom, _remoteTo, i / (rings + 1));
      ctx.fx.ring(_pt, _remoteDir, '#38d8ff', charged ? 2.2 : 1.25);
      if (charged) ctx.fx.vaporRing?.(_pt, _remoteDir, 1.4);
    }
    ctx.render?.lights?.flash?.(_remoteFrom, 0x48e8ff, charged ? 14 : 8, charged ? 18 : 11, 0.16);

    _play.position = _remoteFrom;
    _play.volume = charged ? 1.05 : 0.8;
    _play.pitch = charged ? 0.78 : 1.15;
    _play.pitchJitter = 0.03;
    ctx.audio.play('railgun_fire', _play);
  },
};
