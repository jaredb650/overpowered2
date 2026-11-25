/**
 * Plasma Scatter Rifle arm weapon plug-in (`src/frame/arms/plasma.ts`).
 *
 * High-tech magnetic energy rifle (`16` charge cells, `2.2 s` cell-pack reload on `R` or empty):
 *   - Tap Fire: launches a fast `58 m/s` glowing plasma orb (`120 * energyMult` impact damage) that expands
 *     on impact into a lingering `4.8 m` electric-violet/cyan plasma dome lasting `2.2 s` (`85 * energyMult` DPS).
 *   - Hold Charge (`0.65 s`) & Release: unleashes a 3-orb horizontal fan (`-8°, 0°, +8°`), consuming `3` cells
 *     and dealing `150 * energyMult` impact damage per orb while blanketing the target zone with 3 overlapping domes.
 */
import * as THREE from 'three';
import { CG, type Ctx, type DamageInfo, type LoopHandle, type PlayOptions, type RayHit } from '../../core/contracts';
import type { EnemyInstance } from '../../core/gameplay';
import { clamp, rand } from '../../core/math';
import type { MechKind } from '../../progression/callins/link';
import type { GunnerWeapon } from '../../vehicles/hud';
import type { Combat } from '../../weapons/Combat';
import { bossHit } from '../../weapons/data';
import { NEAR_SIGHT } from './shared';
import type { ArmPlugin, ArmUpdateContext, FrameArmGun } from './types';

const DEG = Math.PI / 180;
const EPS = 1e-6;
const UP = new THREE.Vector3(0, 1, 0);

export const PLASMA = {
  /** Energy cell magazine capacity. */
  cells: 16,
  /** Reload duration on `R` or empty magazine (seconds). */
  reloadTime: 2.2,
  /** Minimum interval after a tap shot (seconds). */
  tapCadence: 0.42,
  /** Minimum interval after a charged 3-orb fan volley (seconds). */
  fanCadence: 0.62,
  /** Hold time to reach full 3-orb fan charge (seconds, scaled by `energyMult`). */
  chargeTime: 0.65,
  /** Cells consumed by a charged 3-orb fan volley. */
  fanCellCost: 3,
  /** Horizontal fan yaw offsets in degrees. */
  fanAnglesDeg: [-8, 0, 8] as readonly number[],
  /** Plasma orb flight speed (m/s). */
  orbSpeed: 58,
  /** Maximum orb flight lifetime before mid-air detonation (seconds). */
  orbMaxLife: 2.6,
  /** Proximity/hit radius of an orb in flight against enemies (metres). */
  orbHitRadius: 0.9,
  /** Splash radius of orb detonation impact damage (metres). */
  impactRadius: 2.6,
  /** Tap orb impact damage (multiplied by `energyMult`). */
  tapImpactDamage: 120,
  /** Charged fan orb impact damage each (multiplied by `energyMult`). */
  chargedImpactDamage: 150,
  /** Lingering plasma dome radius (metres). */
  domeRadius: 4.8,
  /** Lingering plasma dome duration (seconds). */
  domeDuration: 2.2,
  /** Lingering plasma dome damage per second (multiplied by `energyMult`). */
  domeDps: 85,
  /** Dome damage tick interval (seconds). */
  domeTickInterval: 0.2,
  /** Maximum concurrent tracked orbs (fixed pool). */
  maxOrbs: 24,
  /** Maximum concurrent tracked domes (fixed pool). */
  maxDomes: 24,
} as const;

export interface PlasmaOrb {
  active: boolean;
  readonly pos: THREE.Vector3;
  readonly vel: THREE.Vector3;
  age: number;
  impactDamage: number;
  energyMult: number;
  charged: boolean;
}

export interface PlasmaDome {
  active: boolean;
  readonly center: THREE.Vector3;
  remaining: number;
  duration: number;
  radius: number;
  dps: number;
  tickAccum: number;
  fxAccum: number;
}

// Module-level scratch objects (zero per-frame allocations).
const _muzzle = new THREE.Vector3();
const _bore = new THREE.Vector3();
const _aimDir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _fanDir = new THREE.Vector3();
const _nextPos = new THREE.Vector3();
const _segDir = new THREE.Vector3();
const _segMid = new THREE.Vector3();
const _detPt = new THREE.Vector3();
const _ringDir = new THREE.Vector3();
const _arcPt = new THREE.Vector3();
const _remoteFrom = new THREE.Vector3();
const _remoteDir = new THREE.Vector3();
const _remoteEnd = new THREE.Vector3();
const _enemies: EnemyInstance[] = [];
const _play: PlayOptions = {};
const _rayHit: RayHit = {
  point: new THREE.Vector3(),
  normal: new THREE.Vector3(),
  distance: 0,
  surface: 'concrete',
  collider: null,
};
const _dmg: DamageInfo = {
  amount: 0,
  type: 'shock',
  point: new THREE.Vector3(),
  dir: new THREE.Vector3(),
  force: 26,
  source: 'frame_plasma',
  region: 'chest',
};

export type PlasmaFireKind = 'none' | 'tap' | 'fan';

/** Pure charge-cell magazine & hold-to-charge state machine for the Plasma Scatter Rifle. */
export class PlasmaClock {
  readonly capacity = PLASMA.cells;
  cells: number = PLASMA.cells;
  reloading = false;
  reloadTimer = 0;
  cooldown = 0;
  charging = false;
  /** Normalized hold charge 0..1. */
  charge = 0;
  holdElapsed = 0;

  /** One-frame transition flags. */
  reachedFull = false;
  finishedReload = false;
  firedKind: PlasmaFireKind = 'none';

  get ready(): boolean {
    return !this.reloading && this.cells > 0 && this.cooldown <= EPS;
  }

  get reloadProgress(): number {
    return this.reloading ? clamp(1 - this.reloadTimer / PLASMA.reloadTime) : -1;
  }

  /** Crosshair bar gauge: active charge ratio 0..1 while charging, or reload fill. */
  get heat(): number {
    if (this.charging) return clamp(this.charge);
    if (this.reloading) return clamp(1 - this.reloadTimer / PLASMA.reloadTime);
    return 0;
  }

  startReload(): boolean {
    if (this.reloading || this.cells >= this.capacity) return false;
    this.reloading = true;
    this.reloadTimer = PLASMA.reloadTime;
    this.cells = 0;
    this.charging = false;
    this.charge = 0;
    this.holdElapsed = 0;
    return true;
  }

  update(dt: number, pressed: boolean, held: boolean, energyMult = 1): PlasmaFireKind {
    this.reachedFull = false;
    this.finishedReload = false;
    this.firedKind = 'none';

    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);

    if (this.reloading) {
      this.reloadTimer = Math.max(0, this.reloadTimer - dt);
      if (this.reloadTimer <= EPS) {
        this.reloading = false;
        this.reloadTimer = 0;
        this.cells = this.capacity;
        this.finishedReload = true;
      }
      return 'none';
    }

    // Single-frame tap (`pressed && !held`): immediately fire a tap orb if ready.
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
        const canFan = this.cells >= PLASMA.fanCellCost;
        const maxCharge = canFan ? 1 : 0.85;
        const wasFull = this.charge >= 1 - EPS;
        const rate = Math.max(0.25, energyMult) / PLASMA.chargeTime;
        this.charge = Math.min(maxCharge, this.charge + dt * rate);
        if (canFan && !wasFull && this.charge >= 1 - EPS) {
          this.charge = 1;
          this.reachedFull = true;
        }
      }
      return 'none';
    }

    // Trigger released while charging: discharge either 3-orb fan (at full charge) or tap single orb.
    if (this.charging) {
      const fullFan = this.charge >= 1 - EPS && this.cells >= PLASMA.fanCellCost;
      this.charging = false;
      this.charge = 0;
      this.holdElapsed = 0;
      if (this.cells > 0) {
        this.consumeAndTrigger(fullFan ? 'fan' : 'tap');
      }
      return this.firedKind;
    }

    return 'none';
  }

  private consumeAndTrigger(kind: 'tap' | 'fan'): void {
    const cost = kind === 'fan' ? PLASMA.fanCellCost : 1;
    this.cells = Math.max(0, this.cells - cost);
    this.cooldown = kind === 'fan' ? PLASMA.fanCadence : PLASMA.tapCadence;
    this.firedKind = kind;
    if (this.cells === 0) {
      this.reloading = true;
      this.reloadTimer = PLASMA.reloadTime;
    }
  }

  reset(): void {
    this.cells = this.capacity;
    this.reloading = false;
    this.reloadTimer = 0;
    this.cooldown = 0;
    this.charging = false;
    this.charge = 0;
    this.holdElapsed = 0;
    this.reachedFull = false;
    this.finishedReload = false;
    this.firedKind = 'none';
  }
}

export class PlasmaArmGun implements FrameArmGun {
  readonly kind = 'plasma' as const;
  readonly clock = new PlasmaClock();
  readonly orbs: PlasmaOrb[] = Array.from({ length: PLASMA.maxOrbs }, () => ({
    active: false,
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    age: 0,
    impactDamage: PLASMA.tapImpactDamage,
    energyMult: 1,
    charged: false,
  }));
  readonly domes: PlasmaDome[] = Array.from({ length: PLASMA.maxDomes }, () => ({
    active: false,
    center: new THREE.Vector3(),
    remaining: 0,
    duration: PLASMA.domeDuration,
    radius: PLASMA.domeRadius,
    dps: PLASMA.domeDps,
    tickAccum: 0,
    fxAccum: 0,
  }));

  private chargeLoop: LoopHandle | null = null;
  private fireFlash = 0;

  constructor(private readonly ctx: Ctx) {}

  get firing(): boolean {
    return this.clock.charging && this.clock.charge > 0.15;
  }

  get heat(): number {
    return this.clock.heat;
  }

  /** Number of currently active plasma orbs in flight. */
  get activeOrbCount(): number {
    let n = 0;
    for (let i = 0; i < this.orbs.length; i++) if (this.orbs[i]!.active) n++;
    return n;
  }

  /** Number of currently active lingering plasma domes. */
  get activeDomeCount(): number {
    let n = 0;
    for (let i = 0; i < this.domes.length; i++) if (this.domes[i]!.active) n++;
    return n;
  }

  update(dt: number, u: ArmUpdateContext): void {
    const { audio } = this.ctx;
    const energyMult = u.energyMult ?? 1;

    if (u.reloadPressed && this.clock.startReload()) {
      this.stopChargeAudio();
      _play.position = undefined;
      _play.volume = 0.78;
      _play.pitch = 0.94;
      _play.pitchJitter = 0;
      audio.play('reload_cell', _play);
    }

    if (u.pressed && this.clock.reloading) {
      audio.play('weapon_dry');
    }

    const fired = this.clock.update(dt, u.pressed, u.held, energyMult);

    if (this.clock.finishedReload) {
      _play.position = undefined;
      _play.volume = 0.82;
      _play.pitch = 1.06;
      _play.pitchJitter = 0;
      audio.play('reload_cell', _play);
    }

    if (this.clock.reachedFull) {
      _play.position = undefined;
      _play.volume = 0.72;
      _play.pitch = 1.12;
      _play.pitchJitter = 0;
      audio.play('railgun_ready', _play);
    }

    // Charge hum audio once held past quick-tap threshold.
    if (this.clock.charging && this.clock.holdElapsed >= 0.12) {
      if (!this.chargeLoop) {
        this.chargeLoop = audio.startLoop?.('railgun_charge_loop', { pitch: 0.65, volume: 0.25 }) ?? null;
      }
      this.chargeLoop?.setPitch(0.65 + this.clock.charge * 0.75, 0.05);
      this.chargeLoop?.setVolume(0.25 + this.clock.charge * 0.45, 0.06);
    } else {
      this.stopChargeAudio();
    }

    if (fired !== 'none') {
      this.stopChargeAudio();
      this.fireOrbs(u, fired === 'fan', energyMult);
      this.fireFlash = fired === 'fan' ? 1.0 : 0.7;
    }

    if (this.fireFlash > 0) this.fireFlash = Math.max(0, this.fireFlash - dt * 3.5);

    // Update sculpted plasma containment core brightness on the arm model.
    const visualCharge = Math.max(this.clock.charge, this.fireFlash);
    const fanReady = this.clock.charging && this.clock.charge >= 1 - EPS && this.clock.cells >= PLASMA.fanCellCost;
    u.arm.setActive?.(visualCharge, fanReady ? 1 : 0);

    // Step active plasma orbs and lingering domes every frame.
    this.stepOrbs(dt);
    this.stepDomes(dt);
  }

  idleUpdate(dt: number): void {
    this.clock.update(dt, false, false, 1);
    this.stopChargeAudio();
    this.stepOrbs(dt);
    this.stepDomes(dt);
  }

  fillRow(row: GunnerWeapon, button: string): void {
    const chargingFan = this.clock.charging && this.clock.charge >= 1 - EPS && this.clock.cells >= PLASMA.fanCellCost;
    row.name = chargingFan ? `${button} PLASMA [FAN READY]` : `${button} PLASMA RIFLE`;
    row.ammo = this.clock.cells;
    row.max = PLASMA.cells;
    row.reload = this.clock.reloadProgress;
    row.selected = chargingFan;
  }

  silence(): void {
    this.stopChargeAudio();
  }

  reset(): void {
    this.silence();
    this.clock.reset();
    this.fireFlash = 0;
    for (let i = 0; i < this.orbs.length; i++) this.orbs[i]!.active = false;
    for (let i = 0; i < this.domes.length; i++) this.domes[i]!.active = false;
  }

  private stopChargeAudio(): void {
    if (!this.chargeLoop) return;
    this.chargeLoop.stop(0.06);
    this.chargeLoop = null;
  }

  private fireOrbs(u: ArmUpdateContext, fan: boolean, energyMult: number): void {
    const { audio, camera, fx, render } = this.ctx;
    u.arm.muzzle(_muzzle);
    u.arm.bore(_bore);

    if (u.sight.range > NEAR_SIGHT) _aimDir.subVectors(u.sight.point, _muzzle);
    else _aimDir.copy(u.sight.aim);
    if (_aimDir.lengthSq() < 1e-6) _aimDir.copy(_bore);
    _aimDir.normalize();

    if (fan) {
      _right.crossVectors(_aimDir, UP);
      if (_right.lengthSq() < 1e-4) _right.set(1, 0, 0);
      else _right.normalize();
      const dmg = PLASMA.chargedImpactDamage * energyMult;
      for (let i = 0; i < PLASMA.fanAnglesDeg.length; i++) {
        const ang = PLASMA.fanAnglesDeg[i]! * DEG;
        _fanDir.copy(_aimDir).multiplyScalar(Math.cos(ang)).addScaledVector(_right, Math.sin(ang)).normalize();
        this.spawnOrb(_muzzle, _fanDir, dmg, energyMult, true);
      }
    } else {
      this.spawnOrb(_muzzle, _aimDir, PLASMA.tapImpactDamage * energyMult, energyMult, false);
    }

    // Co-op notification for teammates.
    u.onNews?.('plasma', [_muzzle.x, _muzzle.y, _muzzle.z, _aimDir.x, _aimDir.y, _aimDir.z, fan ? 1 : 0]);

    // Muzzle visuals & audio.
    fx.muzzleFlash(_muzzle, _bore, 'plasma');
    fx.ring(_detPt.copy(_muzzle).addScaledVector(_bore, 0.35), _bore, fan ? '#b84dff' : '#42f0ff', fan ? 2.4 : 1.5);
    fx.sparks(_muzzle, _bore, fan ? 18 : 10, fan ? '#cc66ff' : '#55eeff');
    render?.lights?.flash?.(_muzzle, fan ? 0xb84dff : 0x42e8ff, fan ? 12 : 8, fan ? 16 : 12, 0.14);

    _play.position = undefined;
    _play.volume = fan ? 1.05 : 0.82;
    _play.pitch = fan ? 0.78 : 1.02;
    _play.pitchJitter = 0.04;
    audio.play('lance_plasma', _play);
    if (fan) {
      audio.play('plasma_burst', { volume: 0.72, pitch: 0.86 });
    }

    u.arm.recoil(fan ? 0.44 : 0.24);
    if (u.recoilMult > 0) {
      camera.addTrauma?.((fan ? 0.28 : 0.12) * u.recoilMult);
      camera.kick?.((fan ? 0.024 : 0.011) * u.recoilMult, rand(-0.005, 0.005) * u.recoilMult);
    }
  }

  private spawnOrb(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    impactDamage: number,
    energyMult: number,
    charged: boolean,
  ): void {
    let slot: PlasmaOrb | null = null;
    for (let i = 0; i < this.orbs.length; i++) {
      if (!this.orbs[i]!.active) {
        slot = this.orbs[i]!;
        break;
      }
    }
    if (!slot) slot = this.orbs[0]!;
    slot.active = true;
    slot.pos.copy(origin);
    slot.vel.copy(dir).multiplyScalar(PLASMA.orbSpeed);
    slot.age = 0;
    slot.impactDamage = impactDamage;
    slot.energyMult = energyMult;
    slot.charged = charged;
  }

  private stepOrbs(dt: number): void {
    const { physics, enemies, fx } = this.ctx;
    for (let i = 0; i < this.orbs.length; i++) {
      const orb = this.orbs[i]!;
      if (!orb.active) continue;

      orb.age += dt;
      const stepDist = PLASMA.orbSpeed * dt;
      _segDir.copy(orb.vel).normalize();
      _nextPos.copy(orb.pos).addScaledVector(orb.vel, dt);

      // 1. Check solid world impact along this frame's flight segment via raycastInto.
      let worldDist = Infinity;
      let hitWorld = false;
      if (typeof physics.raycastInto === 'function') {
        hitWorld = physics.raycastInto(orb.pos, _segDir, stepDist, CG.World, _rayHit);
      } else {
        const hit = physics.raycast(orb.pos, _segDir, stepDist, CG.World);
        if (hit) {
          _rayHit.point.copy(hit.point);
          _rayHit.normal.copy(hit.normal);
          _rayHit.distance = hit.distance;
          hitWorld = true;
        }
      }
      if (hitWorld) worldDist = _rayHit.distance;

      // 2. Check direct enemy intersection along this frame's flight segment.
      let bestEnemyDist = Infinity;
      let directEnemy: EnemyInstance | null = null;
      _segMid.copy(orb.pos).addScaledVector(_segDir, stepDist * 0.5);
      const n = Math.min(enemies.query(_segMid, stepDist * 0.5 + PLASMA.orbHitRadius + 1.4, _enemies) || 0, _enemies.length);
      const hitR2 = PLASMA.orbHitRadius * PLASMA.orbHitRadius;
      for (let j = 0; j < n; j++) {
        const e = _enemies[j]!;
        if (!e.alive) continue;
        const dx = e.center.x - orb.pos.x;
        const dy = e.center.y - orb.pos.y;
        const dz = e.center.z - orb.pos.z;
        const along = dx * _segDir.x + dy * _segDir.y + dz * _segDir.z;
        if (along < -PLASMA.orbHitRadius || along > stepDist + PLASMA.orbHitRadius) continue;
        const clamped = clamp(along, 0, stepDist);
        const px = dx - _segDir.x * clamped;
        const py = dy - _segDir.y * clamped;
        const pz = dz - _segDir.z * clamped;
        if (px * px + py * py + pz * pz <= hitR2 && clamped < bestEnemyDist) {
          bestEnemyDist = clamped;
          directEnemy = e;
        }
      }
      _enemies.length = 0;

      if (directEnemy && bestEnemyDist <= worldDist) {
        _detPt.copy(orb.pos).addScaledVector(_segDir, bestEnemyDist);
        fx.tracer(orb.pos, _detPt, 'plasma');
        this.detonateOrb(orb, _detPt, _segDir, directEnemy);
        orb.active = false;
        continue;
      }

      if (hitWorld) {
        _detPt.copy(_rayHit.point).addScaledVector(_rayHit.normal, 0.15);
        fx.tracer(orb.pos, _detPt, 'plasma');
        this.detonateOrb(orb, _detPt, _segDir, null);
        orb.active = false;
        continue;
      }

      // Draw glowing orb flight trail.
      fx.tracer(orb.pos, _nextPos, 'plasma');
      orb.pos.copy(_nextPos);

      if (orb.age >= PLASMA.orbMaxLife) {
        this.detonateOrb(orb, orb.pos, _segDir, null);
        orb.active = false;
      }
    }
  }

  private detonateOrb(
    orb: PlasmaOrb,
    point: THREE.Vector3,
    dir: THREE.Vector3,
    directEnemy: EnemyInstance | null,
  ): void {
    const c = this.ctx;
    const { audio, enemies, fx, hud, render } = c;

    // Impact burst damage (120 * energyMult tap, 150 * energyMult charged fan).
    const count = Math.min(enemies.query(point, PLASMA.impactRadius, _enemies) || 0, _enemies.length);
    let struck = 0;
    let hitDirect = false;
    for (let i = 0; i < count; i++) {
      const e = _enemies[i]!;
      if (!e.alive) continue;
      if (e === directEnemy) hitDirect = true;
      this.applyPlasmaDamage(e, orb.impactDamage, point, dir, 'frame_plasma');
      struck++;
    }
    _enemies.length = 0;

    if (directEnemy && directEnemy.alive && !hitDirect) {
      this.applyPlasmaDamage(directEnemy, orb.impactDamage, point, dir, 'frame_plasma');
      struck++;
    }
    if (struck > 0) hud.hitMarker?.('body');

    c.world?.objects?.damageExplosivesInRadius?.(point, PLASMA.impactRadius, orb.impactDamage, 'frame_plasma');
    enemies.vehicles?.frameBlow?.(point, PLASMA.impactRadius, orb.impactDamage * 0.65, dir, 'frame_plasma');

    // Electric-violet & cyan plasma expansion visuals + burst sound.
    fx.ring(point, UP, '#b84dff', PLASMA.domeRadius * 2.0);
    fx.ring(point, dir, '#38f0ff', PLASMA.domeRadius * 1.45);
    fx.sparks(point, UP, orb.charged ? 26 : 18, '#b84dff');
    fx.sparks(point, dir, 12, '#42f0ff');
    render?.lights?.flash?.(point, 0x9944ff, 12, PLASMA.domeRadius * 2.4, 0.25);

    _play.position = point;
    _play.volume = orb.charged ? 0.92 : 0.78;
    _play.pitch = orb.charged ? 0.86 : 1.0;
    _play.pitchJitter = 0.06;
    audio.play('plasma_burst', _play);

    this.spawnDome(point, orb.energyMult);
  }

  private spawnDome(center: THREE.Vector3, energyMult: number): void {
    let slot: PlasmaDome | null = null;
    for (let i = 0; i < this.domes.length; i++) {
      if (!this.domes[i]!.active) {
        slot = this.domes[i]!;
        break;
      }
    }
    if (!slot) slot = this.domes[0]!;
    slot.active = true;
    slot.center.copy(center);
    slot.remaining = PLASMA.domeDuration;
    slot.duration = PLASMA.domeDuration;
    slot.radius = PLASMA.domeRadius;
    slot.dps = PLASMA.domeDps * energyMult;
    slot.tickAccum = 0;
    slot.fxAccum = 0;
  }

  private stepDomes(dt: number): void {
    const { enemies, fx, hud, render } = this.ctx;
    for (let i = 0; i < this.domes.length; i++) {
      const dome = this.domes[i]!;
      if (!dome.active) continue;

      const step = Math.min(dt, dome.remaining);
      dome.remaining -= step;
      dome.tickAccum += step;
      dome.fxAccum += step;

      // Apply exact 85 * energyMult DPS to every alive enemy inside the 4.8 m dome.
      while (dome.tickAccum >= PLASMA.domeTickInterval - EPS) {
        dome.tickAccum -= PLASMA.domeTickInterval;
        const tickDmg = dome.dps * PLASMA.domeTickInterval;
        const r2 = dome.radius * dome.radius;
        const n = Math.min(enemies.query(dome.center, dome.radius, _enemies) || 0, _enemies.length);
        let struck = 0;
        for (let j = 0; j < n; j++) {
          const e = _enemies[j]!;
          if (!e.alive) continue;
          if (e.center.distanceToSquared(dome.center) > r2 + 0.6) continue;
          _segDir.subVectors(e.center, dome.center);
          if (_segDir.lengthSq() < 1e-4) _segDir.copy(UP);
          else _segDir.normalize();
          this.applyPlasmaDamage(e, tickDmg, e.center, _segDir, 'frame_plasma_dome');
          struck++;
        }
        _enemies.length = 0;
        if (struck > 0) hud.hitMarker?.('body');
      }

      // Lingering crackling electric-violet / cyan dome visuals.
      if (dome.fxAccum >= 0.18) {
        dome.fxAccum -= 0.18;
        const lifeFrac = clamp(dome.remaining / dome.duration);
        const scale = dome.radius * (1.7 + 0.3 * lifeFrac);
        fx.ring(dome.center, UP, '#a84dff', scale);
        _ringDir.set(rand(-1, 1), rand(0.2, 1), rand(-1, 1)).normalize();
        fx.ring(dome.center, _ringDir, '#38f0ff', scale * 0.82);
        fx.sparks(dome.center, UP, 6, '#cc66ff');
        _arcPt.set(
          dome.center.x + rand(-dome.radius * 0.7, dome.radius * 0.7),
          dome.center.y + rand(0.1, dome.radius * 0.6),
          dome.center.z + rand(-dome.radius * 0.7, dome.radius * 0.7),
        );
        fx.tracer(dome.center, _arcPt, 'plasma');
        render?.lights?.flash?.(dome.center, 0x8838ff, 7 * lifeFrac + 2, dome.radius * 2, 0.2);
      }

      if (dome.remaining <= EPS) {
        dome.active = false;
      }
    }
  }

  private applyPlasmaDamage(
    enemy: EnemyInstance,
    amount: number,
    point: THREE.Vector3,
    dir: THREE.Vector3,
    source: string,
  ): void {
    const combat = this.ctx.combat as Combat | undefined;
    if (combat && typeof combat.strike === 'function' && typeof combat.strikeOptions === 'function') {
      const o = combat.strikeOptions('shock', source);
      o.force = 24;
      o.quiet = true;
      o.pierces = true;
      combat.strike(enemy, point, UP, dir, undefined, 'chest', amount, o);
      return;
    }
    _dmg.amount = bossHit(enemy.isBoss, amount);
    _dmg.source = source;
    _dmg.point.copy(point);
    _dmg.dir.copy(dir);
    this.ctx.enemies.applyDamage(enemy, _dmg);
  }
}

export const PLASMA_PLUGIN: ArmPlugin = {
  kind: 'plasma',
  newsKinds: ['plasma'],
  create: ctx => new PlasmaArmGun(ctx),
  remoteNews(ctx: Ctx, kind: MechKind, values: number[]): void {
    if (kind !== 'plasma' || values.length < 6) return;
    _remoteFrom.set(values[0]!, values[1]!, values[2]!);
    _remoteDir.set(values[3]!, values[4]!, values[5]!);
    if (_remoteDir.lengthSq() < 1e-6) return;
    _remoteDir.normalize();
    const fan = (values[6] ?? 0) >= 0.5;

    ctx.fx.muzzleFlash(_remoteFrom, _remoteDir, 'plasma');
    ctx.fx.ring(_remoteFrom, _remoteDir, fan ? '#b84dff' : '#38f0ff', fan ? 2.2 : 1.4);
    ctx.fx.sparks(_remoteFrom, _remoteDir, fan ? 16 : 8, '#bb55ff');
    _remoteEnd.copy(_remoteFrom).addScaledVector(_remoteDir, 38);
    ctx.fx.tracer(_remoteFrom, _remoteEnd, 'plasma');
    ctx.render?.lights?.flash?.(_remoteFrom, fan ? 0xb84dff : 0x38e8ff, 9, 14, 0.14);

    _play.position = _remoteFrom;
    _play.volume = fan ? 0.95 : 0.75;
    _play.pitch = fan ? 0.78 : 1.02;
    _play.pitchJitter = 0.04;
    ctx.audio.play('lance_plasma', _play);
  },
};
