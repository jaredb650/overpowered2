/**
 * Mech Shotgun arm weapon plug-in: 6-shell tubular magazine, 0.42 s semi-auto cadence, 26 heavy pellets in a
 * stratified 5.5° spread cone with close-range devastation, smooth falloff past 25 m, massive ragdoll impulse,
 * and interruptible shell-by-shell reload (0.45 s per shell).
 */
import * as THREE from 'three';
import { CG, type Ctx, type PlayOptions, type RayHit } from '../../core/contracts';
import type { ShotSpec } from '../../core/gameplay';
import { TAU, clamp, rand } from '../../core/math';
import type { GunnerWeapon } from '../../vehicles/hud';
import { NEAR_SIGHT } from './shared';
import type { ArmPlugin, ArmUpdateContext, FrameArmGun } from './types';

const DEG = Math.PI / 180;

export const SHOTGUN = {
  /** Tubular under-barrel magazine capacity. */
  shells: 6,
  /** Semi-auto minimum interval between shots (seconds). */
  interval: 0.42,
  /** Time to load a single shell into the tube (seconds). */
  reloadPerShell: 0.45,
  /** Heavy tungsten-steel pellets fired per shell. */
  pellets: 26,
  /** Cone half-angle in degrees (shotguns always keep pellet spread). */
  spreadDeg: 5.5,
  /** Cone half-angle in radians (~5.5°). */
  spread: 5.5 * DEG,
  /** Close-range damage per pellet up to 25 m. */
  damage: 85,
  /** Full damage to 25 m, tapering smoothly down to 25% at 85 m. */
  falloff: { from: 25, to: 85, floor: 0.25 } as const,
  /** Maximum effective raycast reach (metres). */
  range: 140,
  /** Massive ragdoll impulse per pellet so struck targets fly across the arena. */
  force: 185,
  /** Heavy limb-sever multiplier for close-range dismemberment. */
  severMult: 4.5,
  headshotMult: 1.8,
  impactScale: 1.55,
  /** Recoil slide distance on the physical arm barrel assembly (metres). */
  recoilSlide: 0.58,
  /** Camera trauma and upward kick radians (scaled by `u.recoilMult`). */
  trauma: 0.34,
  kick: 0.032,
} as const;

/**
 * Stratified ring layout summing to 26 pellets (2 center + 6 inner + 8 mid + 10 outer),
 * so every shot delivers a consistent wall of pellets with a solid core and full 5.5° coverage.
 */
const RINGS: readonly (readonly [count: number, rMin: number, rMax: number])[] = [
  [2, 0.04, 0.18],
  [6, 0.28, 0.46],
  [8, 0.54, 0.72],
  [10, 0.80, 0.97],
];

/** 9 of 26 pellets emit crisp tracer streaks across all 4 rings (within draw budget). */
const TRACER_INDICES: readonly number[] = [0, 2, 5, 8, 11, 14, 17, 20, 23];
const TRACER_MASK: readonly boolean[] = Array.from({ length: SHOTGUN.pellets }, (_, i) => TRACER_INDICES.includes(i));

// Module-level scratch vectors & pools (zero allocations in hot paths).
const _muzzle = new THREE.Vector3();
const _bore = new THREE.Vector3();
const _rayAim = new THREE.Vector3();
const _newsDir = new THREE.Vector3();
const _at = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _basisRight = new THREE.Vector3();
const _basisUp = new THREE.Vector3();
const _remoteFrom = new THREE.Vector3();
const _remoteDir = new THREE.Vector3();
const _rayHit: RayHit = {
  point: new THREE.Vector3(),
  normal: new THREE.Vector3(),
  distance: 0,
  surface: 'concrete',
  collider: null,
};
const _play: PlayOptions = {};
const _pellets: THREE.Vector3[] = Array.from({ length: SHOTGUN.pellets }, () => new THREE.Vector3());
const _remotePellets: THREE.Vector3[] = Array.from({ length: SHOTGUN.pellets }, () => new THREE.Vector3());

/**
 * Fills `out` with unit pellet directions distributed across a cone of half-angle `coneRad` around `aim`
 * using stratified concentric rings plus per-shot twist and per-pellet jitter. Zero allocations.
 */
export function fillPelletCone(
  aim: THREE.Vector3,
  coneRad: number,
  out: readonly THREE.Vector3[],
  random: () => number = Math.random,
): void {
  const ax = aim.x;
  const ay = aim.y;
  const az = aim.z;
  const len = Math.hypot(ax, ay, az);
  if (len < 1e-6) return;
  const fx = ax / len;
  const fy = ay / len;
  const fz = az / len;

  // Build orthonormal tangent basis perpendicular to forward direction.
  if (Math.abs(fy) > 0.95) _basisRight.set(1, 0, 0);
  else _basisRight.set(0, 1, 0);
  _basisRight.set(
    _basisRight.y * fz - _basisRight.z * fy,
    _basisRight.z * fx - _basisRight.x * fz,
    _basisRight.x * fy - _basisRight.y * fx,
  ).normalize();
  _basisUp.set(
    fy * _basisRight.z - fz * _basisRight.y,
    fz * _basisRight.x - fx * _basisRight.z,
    fx * _basisRight.y - fy * _basisRight.x,
  ).normalize();

  const baseTwist = random() * TAU;
  let idx = 0;
  for (let r = 0; r < RINGS.length && idx < out.length; r++) {
    const [count, rMin, rMax] = RINGS[r]!;
    const sector = TAU / count;
    const ringOffset = baseTwist + r * 0.57;
    for (let k = 0; k < count && idx < out.length; k++) {
      const phi = ringOffset + k * sector + (random() - 0.5) * sector * 0.56;
      const frac = rMin + random() * (rMax - rMin);
      const theta = Math.min(coneRad, frac * coneRad);
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);
      const c = Math.cos(phi) * sinT;
      const s = Math.sin(phi) * sinT;
      out[idx++]!.set(
        fx * cosT + _basisRight.x * c + _basisUp.x * s,
        fy * cosT + _basisRight.y * c + _basisUp.y * s,
        fz * cosT + _basisRight.z * c + _basisUp.z * s,
      ).normalize();
    }
  }
}

/**
 * Pure clock for the 6-shell tubular magazine: 0.42 s semi-auto interval, auto-reload on empty,
 * manual partial reload, 0.45 s shell-by-shell insertion, and instant fire-to-interrupt when >= 1 shell loaded.
 */
export class ShotgunTube {
  readonly capacity = SHOTGUN.shells;
  shells: number = SHOTGUN.shells;
  reloading = false;
  private cooldown = 0;
  private reloadTimer = 0;

  /** True when at least one shell is chambered and the semi-auto cycle interval has elapsed. */
  get ready(): boolean {
    return this.shells > 0 && this.cooldown <= 0;
  }

  /** 0..1 progress of the shell currently being inserted, or -1 when not reloading. */
  get progress(): number {
    return this.reloading ? clamp(1 - this.reloadTimer / SHOTGUN.reloadPerShell) : -1;
  }

  /** Begins a shell-by-shell reload if partially spent and not already reloading. Returns true if started. */
  startReload(): boolean {
    if (this.reloading || this.shells >= this.capacity) return false;
    this.reloading = true;
    this.reloadTimer = SHOTGUN.reloadPerShell;
    return true;
  }

  /** Advances fire cooldown and shell-by-shell reload. Returns how many shells were inserted this step. */
  update(dt: number): number {
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    if (!this.reloading) {
      if (this.shells === 0) {
        this.reloading = true;
        this.reloadTimer = SHOTGUN.reloadPerShell;
      }
      return 0;
    }
    let inserted = 0;
    this.reloadTimer -= dt;
    while (this.reloadTimer <= 0 && this.shells < this.capacity) {
      this.shells++;
      inserted++;
      if (this.shells >= this.capacity) {
        this.reloading = false;
        this.reloadTimer = 0;
        break;
      }
      this.reloadTimer += SHOTGUN.reloadPerShell;
    }
    return inserted;
  }

  /**
   * Fires one shell if ready. Immediately interrupts an ongoing reload as long as >= 1 shell is in the tube.
   * Automatically begins reloading when the final shell is spent.
   */
  fire(): boolean {
    if (!this.ready) return false;
    this.reloading = false;
    this.reloadTimer = 0;
    this.shells--;
    this.cooldown = SHOTGUN.interval;
    if (this.shells === 0) {
      this.reloading = true;
      this.reloadTimer = SHOTGUN.reloadPerShell;
    }
    return true;
  }

  reset(): void {
    this.shells = this.capacity;
    this.reloading = false;
    this.cooldown = 0;
    this.reloadTimer = 0;
  }
}

export class MechShotgunArmGun implements FrameArmGun {
  readonly kind = 'shotgun' as const;
  readonly clock = new ShotgunTube();
  private readonly shot: ShotSpec = {
    damage: SHOTGUN.damage,
    source: 'frame_shotgun',
    team: 'player',
    type: 'pellet',
    armour: 'heavy',
    maxDistance: SHOTGUN.range,
    tracerFrom: _muzzle,
    force: SHOTGUN.force,
    severMult: SHOTGUN.severMult,
    headshotMult: SHOTGUN.headshotMult,
    impactScale: SHOTGUN.impactScale,
    falloff: SHOTGUN.falloff,
  };

  constructor(private readonly ctx: Ctx) {}

  get firing(): boolean {
    return false;
  }

  update(dt: number, u: ArmUpdateContext): void {
    const { audio } = this.ctx;
    const inserted = this.clock.update(dt);
    if (inserted > 0) {
      _play.position = undefined;
      _play.volume = 0.9;
      _play.pitch = 0.74 + (this.clock.shells / SHOTGUN.shells) * 0.16;
      _play.pitchJitter = 0.02;
      audio.play('reload_shell_in', _play);
      if (!this.clock.reloading && this.clock.shells === SHOTGUN.shells) {
        _play.volume = 0.55;
        _play.pitch = 0.82;
        _play.pitchJitter = 0;
        audio.play('reload_bolt', _play);
      }
    }

    if (u.reloadPressed && this.clock.startReload()) {
      _play.position = undefined;
      _play.volume = 0.6;
      _play.pitch = 0.72;
      _play.pitchJitter = 0;
      audio.play('reload_bolt', _play);
    }

    if ((u.pressed || u.held) && this.clock.fire()) {
      this.shoot(u);
    } else if (u.pressed && this.clock.shells === 0) {
      _play.position = undefined;
      _play.volume = 0.85;
      _play.pitch = 0.78;
      _play.pitchJitter = 0;
      audio.play('weapon_dry', _play);
    }
  }

  idleUpdate(dt: number): void {
    this.clock.update(dt);
  }

  fillRow(row: GunnerWeapon, button: string): void {
    row.name = `${button} MECH SHOTGUN`;
    row.ammo = this.clock.shells;
    row.max = SHOTGUN.shells;
    row.reload = this.clock.progress;
    row.selected = false;
  }

  silence(): void {
    // Semi-auto weapon with no looping audio.
  }

  reset(): void {
    this.clock.reset();
  }

  private shoot(u: ArmUpdateContext): void {
    const { audio, camera, combat, fx, render } = this.ctx;
    u.arm.muzzle(_muzzle);
    u.arm.bore(_bore);
    _rayAim.copy(u.sight.aim).normalize();

    // Fire 26 heavy pellets through Combat.fireRay so co-op claims, gore, severing, and decals work natively.
    fillPelletCone(_rayAim, SHOTGUN.spread, _pellets);
    for (let i = 0; i < SHOTGUN.pellets; i++) {
      this.shot.tracer = TRACER_MASK[i] ? 'heavy' : undefined;
      combat.fireRay(u.sight.view.position, _pellets[i]!, this.shot);
    }

    // Emit co-op news so teammates see the muzzle blast and tracer cone.
    if (u.sight.range > NEAR_SIGHT) _newsDir.subVectors(u.sight.point, _muzzle).normalize();
    else _newsDir.copy(_rayAim);
    u.onNews?.('shotgun', [_muzzle.x, _muzzle.y, _muzzle.z, _newsDir.x, _newsDir.y, _newsDir.z]);

    // Heavy muzzle blast visuals & ejected shotgun hull.
    u.rounds.flash(_muzzle, 2.2, 0.08, 11, 10, 5, 1.6);
    fx.muzzleFlash(_muzzle, _bore, 'shotgun');
    fx.muzzleFlash(_muzzle, _bore, 'autocannon');
    fx.ring(_at.copy(_muzzle).addScaledVector(_bore, 0.65), _bore, '#ffaa44', 2.4);
    fx.sparks(_at.copy(_muzzle).addScaledVector(_bore, 0.4), _bore, 16, '#ffcc66');
    fx.smoke(_at.copy(_muzzle).addScaledVector(_bore, 2.2), 0xa8aeb4, 1.3, 1.1);
    render?.lights?.flash?.(_muzzle, 0xffaa44, 8, 14, 0.1);

    const outSign = u.side === 'right' ? 1 : -1;
    _vel.set(-_bore.z * outSign, 0, _bore.x * outSign).multiplyScalar(2.8);
    _vel.y = rand(1.8, 3.2);
    fx.shellCasing(_at.copy(_muzzle).addScaledVector(_bore, -2.1), _vel, 'shotgun');

    // Deep layered mech shotgun roar.
    _play.position = undefined;
    _play.volume = 1.25;
    _play.pitch = 0.74;
    _play.pitchJitter = 0.04;
    audio.play('dbshotgun_shot', _play);
    _play.volume = 0.75;
    _play.pitch = 0.64;
    audio.play('autocannon_fire', _play);

    // Chunky barrel slide & view recoil kick.
    u.arm.recoil(SHOTGUN.recoilSlide);
    if (u.recoilMult > 0) {
      camera.addTrauma(SHOTGUN.trauma * u.recoilMult);
      camera.kick(SHOTGUN.kick * u.recoilMult, rand(-0.008, 0.008) * u.recoilMult);
    }
  }
}

export const SHOTGUN_PLUGIN: ArmPlugin = {
  kind: 'shotgun',
  newsKinds: ['shotgun'],
  create: ctx => new MechShotgunArmGun(ctx),
  remoteNews(ctx: Ctx, kind, values): void {
    if (kind !== 'shotgun' || values.length < 6) return;
    _remoteFrom.set(values[0]!, values[1]!, values[2]!);
    _remoteDir.set(values[3]!, values[4]!, values[5]!);
    if (_remoteDir.lengthSq() < 1e-6) return;
    _remoteDir.normalize();

    const { audio, fx, physics, render } = ctx;
    fx.muzzleFlash(_remoteFrom, _remoteDir, 'shotgun');
    fx.muzzleFlash(_remoteFrom, _remoteDir, 'autocannon');
    fx.ring(_at.copy(_remoteFrom).addScaledVector(_remoteDir, 0.6), _remoteDir, '#ffaa44', 2.2);
    fx.sparks(_at.copy(_remoteFrom).addScaledVector(_remoteDir, 0.4), _remoteDir, 12, '#ffcc66');
    fx.smoke(_at.copy(_remoteFrom).addScaledVector(_remoteDir, 2.0), 0xa8aeb4, 1.1, 1.0);
    render?.lights?.flash?.(_remoteFrom, 0xffaa44, 7, 12, 0.09);

    _play.position = _remoteFrom;
    _play.volume = 1.15;
    _play.pitch = 0.74;
    _play.pitchJitter = 0.04;
    audio.play('dbshotgun_shot', _play);
    _play.volume = 0.65;
    _play.pitch = 0.64;
    audio.play('autocannon_fire', _play);

    fillPelletCone(_remoteDir, SHOTGUN.spread, _remotePellets);
    for (let t = 0; t < TRACER_INDICES.length; t++) {
      const dir = _remotePellets[TRACER_INDICES[t]!]!;
      let hit = false;
      if (typeof physics.raycastInto === 'function') {
        hit = physics.raycastInto(_remoteFrom, dir, SHOTGUN.range, CG.World, _rayHit);
      } else {
        const res = physics.raycast(_remoteFrom, dir, SHOTGUN.range, CG.World);
        if (res) {
          _rayHit.point.copy(res.point);
          _rayHit.normal.copy(res.normal);
          _rayHit.surface = res.surface;
          hit = true;
        }
      }
      if (hit) {
        fx.tracer(_remoteFrom, _rayHit.point, 'heavy');
        fx.impact(_rayHit.point, _rayHit.normal, _rayHit.surface, 1.0);
      } else {
        fx.tracer(_remoteFrom, _at.copy(_remoteFrom).addScaledVector(dir, SHOTGUN.range), 'heavy');
      }
    }
  },
};
