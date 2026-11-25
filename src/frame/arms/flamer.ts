/**
 * Heavy Incinerator arm weapon plug-in (`src/frame/arms/flamer.ts`).
 *
 * Pressurized 100-unit fuel tank (`18/s` burn while spraying, `2.6 s` canister reload when empty or on `R`).
 * Tap `1` (left arm) or `2` (right arm) toggles between two nozzle profiles:
 *   - `STREAM`: 26 m focused high-pressure napalm jet (`145 DPS`), ignites targets and lays burning napalm
 *     pools every `0.45 s` via `ctx.combat.napalmBurst`.
 *   - `WIDE`: 15 m wide 40° sweeping deluge (`115 DPS`) that clears dense swarms across a broad front.
 */
import * as THREE from 'three';
import { CG, type Ctx, type DamageInfo, type LoopHandle, type PlayOptions, type RayHit } from '../../core/contracts';
import type { EnemyInstance } from '../../core/gameplay';
import { clamp, rand } from '../../core/math';
import type { MechKind } from '../../progression/callins/link';
import type { GunnerWeapon } from '../../vehicles/hud';
import type { Combat } from '../../weapons/Combat';
import { bossHit } from '../../weapons/data';
import type { Arm, ArmPlugin, ArmRemoteState, ArmUpdateContext, FrameArmGun } from './types';

const DEG = Math.PI / 180;
const EPS = 1e-6;
const UP = new THREE.Vector3(0, 1, 0);

export type FlamerMode = 'stream' | 'wide';

export const FLAMER = {
  /** Pressurized twin-tank fuel capacity. */
  capacity: 100,
  /** Fuel units consumed per second while spraying. */
  burnRate: 18,
  /** Canister repressurization / reload time (seconds). */
  reloadTime: 2.6,
  /** Damage application tick interval (seconds). */
  tickInterval: 0.1,
  /** Burn affliction duration applied to struck targets (seconds). */
  burnSeconds: 6.5,
  /** Focused high-pressure napalm jet mode (`STREAM`). */
  stream: {
    reach: 26,
    /** Total cone angle in degrees (half-angle = 7°). */
    coneDeg: 14,
    halfAngleRad: 7 * DEG,
    bodyPad: 0.9,
    dps: 145,
    napalmInterval: 0.45,
    napalmRadius: 5.2,
  },
  /** Wide 40° sweeping deluge mode (`WIDE`). */
  wide: {
    reach: 15,
    /** Total sweeping cone angle in degrees (half-angle = 20°). */
    coneDeg: 40,
    halfAngleRad: 20 * DEG,
    bodyPad: 1.1,
    dps: 115,
    napalmInterval: 0,
    napalmRadius: 0,
  },
} as const;

// Module-level scratch objects (zero per-frame allocations).
const _muzzle = new THREE.Vector3();
const _bore = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _pt = new THREE.Vector3();
const _jetDir = new THREE.Vector3();
const _poolPos = new THREE.Vector3();
const _poolVel = new THREE.Vector3();
const _remotePos = new THREE.Vector3();
const _remoteVel = new THREE.Vector3();
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
  type: 'fire',
  point: new THREE.Vector3(),
  dir: new THREE.Vector3(),
  force: 6,
  source: 'frame_flamer',
  region: 'chest',
};

/** Pure state machine for the Heavy Incinerator's 100-unit pressurized tank, reload, and nozzle mode. */
export class FlamerTank {
  readonly capacity = FLAMER.capacity;
  fuel: number = FLAMER.capacity;
  reloading = false;
  reloadTimer = 0;
  mode: FlamerMode = 'stream';

  /** One-frame transition flag set when a reload completes this step. */
  finishedReload = false;

  get ready(): boolean {
    return !this.reloading && this.fuel > EPS;
  }

  /** 0..1 reload progress for HUD bar, or -1 when not reloading. */
  get reloadProgress(): number {
    return this.reloading ? clamp(1 - this.reloadTimer / FLAMER.reloadTime) : -1;
  }

  /** 0..1 fuel spent gauge for crosshair heat/fuel meter. */
  get heat(): number {
    if (this.reloading) return clamp(1 - this.reloadTimer / FLAMER.reloadTime);
    return clamp(1 - this.fuel / this.capacity);
  }

  toggleMode(): FlamerMode {
    this.mode = this.mode === 'stream' ? 'wide' : 'stream';
    return this.mode;
  }

  /** Starts a manual 2.6 s repressurization reload if partially spent. Returns true if started. */
  startReload(): boolean {
    if (this.reloading || this.fuel >= this.capacity - EPS) return false;
    this.reloading = true;
    this.reloadTimer = FLAMER.reloadTime;
    this.fuel = 0;
    return true;
  }

  /**
   * Advances fuel consumption or reload timer.
   * Returns true if the weapon is actively spraying this step.
   */
  update(dt: number, held: boolean): boolean {
    this.finishedReload = false;

    if (this.reloading) {
      this.reloadTimer = Math.max(0, this.reloadTimer - dt);
      if (this.reloadTimer <= EPS) {
        this.reloading = false;
        this.reloadTimer = 0;
        this.fuel = this.capacity;
        this.finishedReload = true;
      }
      return false;
    }

    if (held && this.fuel > EPS) {
      this.fuel = Math.max(0, this.fuel - FLAMER.burnRate * dt);
      if (this.fuel <= EPS) {
        this.fuel = 0;
        this.reloading = true;
        this.reloadTimer = FLAMER.reloadTime;
      }
      return true;
    }

    return false;
  }

  reset(): void {
    this.fuel = this.capacity;
    this.reloading = false;
    this.reloadTimer = 0;
    this.mode = 'stream';
    this.finishedReload = false;
  }
}

export class FlamerArmGun implements FrameArmGun {
  readonly kind = 'flamer' as const;
  readonly clock = new FlamerTank();

  private _firing = false;
  private flameLoop: LoopHandle | null = null;
  private tickAccum = 0;
  private napalmTimer = FLAMER.stream.napalmInterval;
  private fxAccum = 0;

  constructor(private readonly ctx: Ctx) {}

  get firing(): boolean {
    return this._firing;
  }

  get heat(): number {
    return this.clock.heat;
  }

  update(dt: number, u: ArmUpdateContext): void {
    const { audio } = this.ctx;

    if (u.cyclePressed) {
      const next = this.clock.toggleMode();
      _play.position = undefined;
      _play.volume = 0.65;
      _play.pitch = next === 'wide' ? 0.85 : 1.15;
      _play.pitchJitter = 0;
      audio.play('rocket_laser', _play);
      if (this.flameLoop) {
        this.flameLoop.setPitch(next === 'wide' ? 0.86 : 1.02, 0.08);
      }
    }

    if (u.reloadPressed && this.clock.startReload()) {
      this.stopFlameAudio(true);
      this._firing = false;
      _play.position = undefined;
      _play.volume = 0.72;
      _play.pitch = 0.78;
      _play.pitchJitter = 0;
      audio.play('reload_mag_out', _play);
      audio.play('steam_burst', { volume: 0.45, pitch: 1.05 });
    }

    if (u.pressed && this.clock.reloading) {
      audio.play('weapon_dry');
    }

    const wasFiring = this._firing;
    const spraying = this.clock.update(dt, u.held);
    this._firing = spraying;

    if (this.clock.finishedReload) {
      _play.position = undefined;
      _play.volume = 0.8;
      _play.pitch = 0.92;
      _play.pitchJitter = 0;
      audio.play('reload_mag_in', _play);
    }

    // Pilot igniter glow: gentle pilot flame at idle (0.2), full roaring cone when spraying (1.0).
    u.arm.setActive?.(spraying ? 1 : 0.2, this.clock.mode === 'wide' ? 1 : 0);

    if (spraying) {
      if (!wasFiring) {
        this.startFlameAudio();
        this.tickAccum = FLAMER.tickInterval; // immediate first hit feedback on ignite
        this.napalmTimer = FLAMER.stream.napalmInterval;
      }
      this.stepSpray(dt, u);
    } else if (wasFiring) {
      this.stopFlameAudio(true);
      this.tickAccum = 0;
      this.napalmTimer = FLAMER.stream.napalmInterval;
    }
  }

  idleUpdate(dt: number): void {
    const wasFiring = this._firing;
    this._firing = false;
    this.clock.update(dt, false);
    if (wasFiring) this.stopFlameAudio(false);
  }

  fillRow(row: GunnerWeapon, button: string, cycleKey: string): void {
    const label = this.clock.mode === 'stream' ? 'STREAM' : 'WIDE';
    row.name = `${button} INCINERATOR ${label} // ${cycleKey}`;
    row.ammo = Math.ceil(this.clock.fuel);
    row.max = FLAMER.capacity;
    row.reload = this.clock.reloadProgress;
    row.selected = this._firing;
  }

  silence(): void {
    this._firing = false;
    this.stopFlameAudio(false);
  }

  reset(): void {
    this.silence();
    this.clock.reset();
    this.tickAccum = 0;
    this.napalmTimer = FLAMER.stream.napalmInterval;
    this.fxAccum = 0;
  }

  private startFlameAudio(): void {
    const { audio } = this.ctx;
    _play.position = undefined;
    _play.volume = 0.85;
    _play.pitch = this.clock.mode === 'wide' ? 0.88 : 1.0;
    _play.pitchJitter = 0.04;
    audio.play('flame_ignite', _play);
    if (!this.flameLoop) {
      this.flameLoop = audio.startLoop?.('flame_loop', {
        volume: 0.78,
        pitch: this.clock.mode === 'wide' ? 0.86 : 1.02,
        fadeIn: 0.06,
      }) ?? null;
    }
  }

  private stopFlameAudio(playTail: boolean): void {
    if (this.flameLoop) {
      this.flameLoop.stop(0.1);
      this.flameLoop = null;
    }
    if (playTail) {
      _play.position = undefined;
      _play.volume = 0.55;
      _play.pitch = 0.9;
      _play.pitchJitter = 0.05;
      this.ctx.audio.play('flame_stop', _play);
    }
  }

  private stepSpray(dt: number, u: ArmUpdateContext): void {
    const c = this.ctx;
    const { physics, fx, render, camera } = c;
    const spec = this.clock.mode === 'stream' ? FLAMER.stream : FLAMER.wide;

    u.arm.muzzle(_muzzle);
    u.arm.bore(_bore);
    _dir.copy(u.sight.aim);
    if (_dir.lengthSq() < 1e-6) _dir.copy(_bore);
    _dir.normalize();

    // Raycast along aim up to mode reach so solid walls block the flame stream and receive napalm pools.
    let reach: number = spec.reach;
    let hitWall = false;
    if (typeof physics.raycastInto === 'function') {
      hitWall = physics.raycastInto(_muzzle, _dir, spec.reach, CG.World, _rayHit);
    } else {
      const hit = physics.raycast(_muzzle, _dir, spec.reach, CG.World);
      if (hit) {
        _rayHit.point.copy(hit.point);
        _rayHit.normal.copy(hit.normal);
        _rayHit.distance = hit.distance;
        _rayHit.surface = hit.surface;
        hitWall = true;
      }
    }
    if (hitWall) {
      reach = Math.max(0.5, Math.min(spec.reach, _rayHit.distance));
    }

    // Continuous dense flame & smoke stream along the aim line.
    this.emitStreamFx(dt, _muzzle, _dir, reach, this.clock.mode === 'wide');

    // Subtle steady recoil & camera tremor while spraying pressurized napalm.
    u.arm.recoil(0.08);
    if (u.recoilMult > 0) {
      camera.addTrauma?.(0.03 * u.recoilMult);
    }
    render?.lights?.flash?.(_pt.copy(_muzzle).addScaledVector(_dir, Math.min(reach * 0.45, 5)), 0xff6a18, 10, 16, 0.09);

    // Damage & ignite enemies within the active cone at fixed 0.1 s ticks for exact DPS.
    this.tickAccum += dt;
    while (this.tickAccum >= FLAMER.tickInterval - EPS) {
      this.tickAccum -= FLAMER.tickInterval;
      this.applyFlameTick(_muzzle, _dir, reach, spec.halfAngleRad, spec.bodyPad, spec.dps * FLAMER.tickInterval);
    }

    // In STREAM mode, deposit persistent burning napalm pools every 0.45 s along the target impact zone.
    if (this.clock.mode === 'stream') {
      this.napalmTimer -= dt;
      if (this.napalmTimer <= EPS) {
        this.napalmTimer += FLAMER.stream.napalmInterval;
        this.dropNapalmPool(u, _muzzle, _dir, reach, hitWall);
      }
    }
  }

  private emitStreamFx(dt: number, muzzle: THREE.Vector3, dir: THREE.Vector3, reach: number, wide: boolean): void {
    const { fx } = this.ctx;
    // Primary jet puffs from the nozzle mouth and along the stream axis.
    fx.flame(muzzle, dir, wide ? 1.35 : 1.65);

    if (wide) {
      // Build tangent right vector to fan wide 40° deluge flames across left, center, and right.
      _right.crossVectors(dir, UP);
      if (_right.lengthSq() < 1e-4) _right.set(1, 0, 0);
      else _right.normalize();
      for (const s of [-0.32, 0.32]) {
        _jetDir.copy(dir).addScaledVector(_right, s).normalize();
        fx.flame(muzzle, _jetDir, 1.15);
      }
    } else {
      // High-pressure focused stream: extra mid-stream dense flame nodes out to 26 m.
      const midDist = reach * 0.42;
      if (midDist > 1.8) {
        _pt.copy(muzzle).addScaledVector(dir, midDist);
        fx.flame(_pt, dir, 1.25);
      }
    }

    // Throttled dark billowing smoke and drifting embers along the jet.
    this.fxAccum += dt;
    if (this.fxAccum >= 0.045) {
      this.fxAccum = 0;
      const tipDist = Math.max(1.2, reach * rand(0.55, 0.92));
      _pt.copy(muzzle).addScaledVector(dir, tipDist);
      fx.smoke(_pt, 0x26201c, wide ? 1.5 : 1.15, 0.95);
      fx.embers?.(_pt, wide ? 6 : 4, wide ? 2.4 : 1.2);
    }
  }

  private applyFlameTick(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    reach: number,
    halfAngleRad: number,
    bodyPad: number,
    damage: number,
  ): void {
    const c = this.ctx;
    const { enemies, fx, hud } = c;
    const tanCone = Math.tan(halfAngleRad);
    const queryRadius = reach * 0.5 + reach * tanCone + bodyPad + 2;

    _mid.copy(origin).addScaledVector(dir, reach * 0.5);
    const count = Math.min(enemies.query(_mid, queryRadius, _enemies) || 0, _enemies.length);
    let struck = 0;

    for (let i = 0; i < count; i++) {
      const e = _enemies[i]!;
      if (!e.alive) continue;
      const dx = e.center.x - origin.x;
      const dy = e.center.y - origin.y;
      const dz = e.center.z - origin.z;
      const along = dx * dir.x + dy * dir.y + dz * dir.z;
      if (along < -0.5 || along > reach + bodyPad) continue;

      const clampedAlong = Math.max(0, along);
      const px = dx - dir.x * clampedAlong;
      const py = dy - dir.y * clampedAlong;
      const pz = dz - dir.z * clampedAlong;
      const lateralSq = px * px + py * py + pz * pz;
      const allowedR = clampedAlong * tanCone + bodyPad;
      if (lateralSq > allowedR * allowedR) continue;

      this.damageEnemy(e, damage, dir);
      enemies.afflict?.(e, 'burn', FLAMER.burnSeconds);
      fx.embers?.(e.center, 3, 0.8);
      struck++;
    }
    _enemies.length = 0;

    if (struck > 0) hud.hitMarker?.('body');

    // Damage map explosives & enemy vehicles at the jet focal area.
    _pt.copy(origin).addScaledVector(dir, Math.min(reach, reach * 0.85));
    c.world?.objects?.damageExplosivesInRadius?.(_pt, 2.8, damage * 2, 'frame_flamer');
    enemies.vehicles?.frameBlow?.(_pt, 2.8, damage, dir, 'frame_flamer');
  }

  private damageEnemy(enemy: EnemyInstance, amount: number, dir: THREE.Vector3): void {
    const combat = this.ctx.combat as Combat | undefined;
    if (combat && typeof combat.strike === 'function' && typeof combat.strikeOptions === 'function') {
      const o = combat.strikeOptions('fire', 'frame_flamer');
      o.force = 6;
      o.quiet = true;
      combat.strike(enemy, enemy.center, UP, dir, undefined, 'chest', amount, o);
      return;
    }
    _dmg.amount = bossHit(enemy.isBoss, amount);
    _dmg.point.copy(enemy.center);
    _dmg.dir.copy(dir);
    this.ctx.enemies.applyDamage(enemy, _dmg);
  }

  private dropNapalmPool(
    u: ArmUpdateContext,
    muzzle: THREE.Vector3,
    dir: THREE.Vector3,
    reach: number,
    hitWall: boolean,
  ): void {
    const combat = this.ctx.combat as Partial<Pick<Combat, 'napalmBurst'>> | undefined;
    if (hitWall) {
      _poolPos.copy(_rayHit.point).addScaledVector(_rayHit.normal, 0.2);
    } else {
      _poolPos.copy(muzzle).addScaledVector(dir, Math.min(reach * 0.78, 20));
      const navY = this.ctx.world?.nav?.groundHeight?.(_poolPos.x, _poolPos.y + 4, _poolPos.z);
      if (typeof navY === 'number' && Number.isFinite(navY)) {
        _poolPos.y = navY + 0.06;
      } else if (u.feet) {
        _poolPos.y = u.feet.y + 0.06;
      }
    }
    _poolVel.copy(dir).multiplyScalar(14);
    combat?.napalmBurst?.(_poolPos, _poolVel, 'frame_flamer', FLAMER.stream.napalmRadius);
    u.onNews?.('flamer', [
      _poolPos.x, _poolPos.y, _poolPos.z,
      _poolVel.x, _poolVel.y, _poolVel.z,
      FLAMER.stream.napalmRadius,
    ]);
  }
}

export const FLAMER_PLUGIN: ArmPlugin = {
  kind: 'flamer',
  newsKinds: ['flamer'],
  create: ctx => new FlamerArmGun(ctx),
  remoteFiring(ctx: Ctx, arm: Arm, _side, dt: number, state: ArmRemoteState): void {
    arm.setActive?.(1, 0);
    arm.muzzle(_muzzle);
    arm.bore(_bore);
    ctx.fx.flame(_muzzle, _bore, 1.35);
    state.accum += dt * 16;
    if (state.accum < 1) return;
    state.accum -= Math.floor(state.accum);
    ctx.fx.smoke(_pt.copy(_muzzle).addScaledVector(_bore, 6), 0x26201c, 1.1, 0.8);
    ctx.render?.lights?.flash?.(_muzzle, 0xff6a18, 9, 14, 0.09);
  },
  remoteNews(ctx: Ctx, kind: MechKind, values: number[]): void {
    if (kind !== 'flamer' || values.length < 6) return;
    _remotePos.set(values[0]!, values[1]!, values[2]!);
    _remoteVel.set(values[3]!, values[4]!, values[5]!);
    const radius = clamp(values[6] ?? FLAMER.stream.napalmRadius, 2, 10);
    const combat = ctx.combat as Partial<Pick<Combat, 'napalmBurst'>> | undefined;
    combat?.napalmBurst?.(_remotePos, _remoteVel, 'frame_flamer', radius, true);
    ctx.fx.napalmSplash?.(_remotePos, UP);
    _up.set(0, 1, 0);
    ctx.fx.flame(_remotePos, _up, 1.2);
  },
};
