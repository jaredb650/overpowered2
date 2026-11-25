/**
 * 4-Barrel Shoulder Minigun plug-in (`shoulderGatling`).
 *
 * Hold G / V / B for continuous high-RPM suppressive fire (28 rounds/s, 26 dmg/round, 120 m range,
 * 0.028 rad spread) from an independent shoulder turret while keeping both arm weapons free.
 * Uses a 100% heat gauge (builds 22/s while firing, cools 30/s when idle, 2.6 s overheat vent
 * lockout). Tap `3`/`4`/`5` (`hasCycle: true`) to toggle between `AP` and `INCENDIARY` rounds.
 */
import * as THREE from 'three';
import type { Ctx, LoopHandle } from '../../core/contracts';
import type { EnemyInstance, ShotSpec, StruckList } from '../../core/gameplay';
import { clamp, randomInCone } from '../../core/math';
import type { MechKind } from '../../progression/callins/link';
import type { GunnerWeapon } from '../../vehicles/hud';
import { NEAR_SIGHT } from '../arms/shared';
import type { FrameShoulderWeapon, ShoulderPlugin, ShoulderUpdateContext } from './types';

export const SHOULDER_GATLING_MODES = ['AP', 'INCENDIARY'] as const;
export type ShoulderGatlingMode = (typeof SHOULDER_GATLING_MODES)[number];

export const SHOULDER_GATLING = {
  rate: 28,
  damage: 26,
  range: 120,
  spread: 0.028,
  heatMax: 100,
  heatBuildPerSec: 22,
  heatCoolPerSec: 30,
  overheatLockout: 2.6,
  burnSeconds: 3.5,
  tracerEvery: 2,
  flashEvery: 3,
} as const;

const UP = new THREE.Vector3(0, 1, 0);
const _mount = new THREE.Vector3();
const _aimPoint = new THREE.Vector3();
const _baseDir = new THREE.Vector3();
const _shotDir = new THREE.Vector3();
const _rFrom = new THREE.Vector3();
const _rTo = new THREE.Vector3();
const _rDir = new THREE.Vector3();

export class ShoulderGatlingShoulder implements FrameShoulderWeapon {
  readonly kind = 'shoulderGatling' as const;
  readonly hasCycle = true;

  modeIndex = 0;
  /** Current heat in `0..100`. */
  heat = 0;
  overheated = false;
  overheatRemaining = 0;

  private fireAccum = 0;
  private roundsFired = 0;
  private wasFiring = false;
  private newsClock = 0;
  private fireLoop: LoopHandle | null = null;

  private readonly struck: StruckList = {
    count: 0,
    walls: 0,
    points: [new THREE.Vector3(), new THREE.Vector3()],
    enemies: [null, null],
  };

  private readonly shot: ShotSpec = {
    damage: SHOULDER_GATLING.damage,
    source: 'frame_shoulder_gatling_ap',
    team: 'player',
    maxDistance: SHOULDER_GATLING.range,
    force: 18,
    severMult: 1.15,
    impactScale: 0.9,
    tracerFrom: _mount,
  };

  constructor(private readonly ctx: Ctx) {}

  get mode(): ShoulderGatlingMode {
    return SHOULDER_GATLING_MODES[this.modeIndex]!;
  }

  get overheatProgress(): number {
    if (!this.overheated) return -1;
    return clamp(1 - this.overheatRemaining / SHOULDER_GATLING.overheatLockout, 0, 1);
  }

  cycleMode(): ShoulderGatlingMode {
    this.modeIndex = (this.modeIndex + 1) % SHOULDER_GATLING_MODES.length;
    return this.mode;
  }

  update(dt: number, u: ShoulderUpdateContext): void {
    const { audio, fx, render } = this.ctx;

    if (u.cyclePressed) {
      const next = this.cycleMode();
      audio?.play?.('veh_seat_click', { pitch: next === 'INCENDIARY' ? 1.16 : 0.94, volume: 0.6 });
    }

    if (this.overheated) {
      this.stopFireLoop();
      this.wasFiring = false;
      this.fireAccum = 0;
      this.overheatRemaining -= dt;
      if (this.overheatRemaining <= 1e-6) {
        this.overheated = false;
        this.overheatRemaining = 0;
        this.heat = 0;
        audio?.play?.('reload_cell', { volume: 0.72, pitch: 1.05 });
      } else {
        this.heat = clamp((this.overheatRemaining / SHOULDER_GATLING.overheatLockout) * SHOULDER_GATLING.heatMax, 0, SHOULDER_GATLING.heatMax);
      }
      if (u.pressed) audio?.play?.('weapon_dry');
      return;
    }

    if (!u.online || !u.held) {
      this.stopFireLoop();
      this.wasFiring = false;
      this.fireAccum = 0;
      if (this.heat > 0) {
        this.heat = Math.max(0, this.heat - SHOULDER_GATLING.heatCoolPerSec * dt);
      }
      if (u.pressed && !u.online) audio?.play?.('weapon_dry');
      return;
    }

    // Active continuous high-RPM suppressive fire.
    u.mountPos(_mount);
    if (Number.isFinite(u.sight.range) && u.sight.range > NEAR_SIGHT) {
      _aimPoint.copy(u.sight.point);
    } else {
      _aimPoint.copy(u.sight.view.position).addScaledVector(u.sight.aim, 60);
    }
    _baseDir.subVectors(_aimPoint, _mount);
    if (_baseDir.lengthSq() > 1e-4) _baseDir.normalize();
    else _baseDir.copy(u.sight.aim).normalize();

    if (!this.wasFiring) {
      this.wasFiring = true;
      this.fireAccum = 1; // Fire immediately on initial trigger press.
      if (!this.fireLoop) {
        this.fireLoop = audio?.startLoop?.('minigun_fire_loop', {
          fadeIn: 0.03,
          pitch: 1.15,
          volume: 0.72,
        }) ?? null;
      }
    } else {
      this.fireAccum += dt * SHOULDER_GATLING.rate;
    }

    let lastEnd: THREE.Vector3 | null = null;
    while (this.fireAccum >= 1) {
      this.fireAccum -= 1;
      lastEnd = this.fireOneRound();
    }

    // Throttle co-op tracer notifications to ~12 Hz.
    this.newsClock += dt;
    if (lastEnd && this.newsClock >= 0.08) {
      this.newsClock = 0;
      u.onNews?.('shoulderGatling', [
        this.modeIndex,
        _mount.x, _mount.y, _mount.z,
        lastEnd.x, lastEnd.y, lastEnd.z,
      ]);
    }

    // Build heat at 22/s; trigger 2.6 s overheat vent lockout at 100%.
    this.heat = Math.min(SHOULDER_GATLING.heatMax, this.heat + SHOULDER_GATLING.heatBuildPerSec * dt);
    if (this.heat >= SHOULDER_GATLING.heatMax - 1e-6) {
      this.heat = SHOULDER_GATLING.heatMax;
      this.overheated = true;
      this.overheatRemaining = SHOULDER_GATLING.overheatLockout;
      this.wasFiring = false;
      this.fireAccum = 0;
      this.stopFireLoop();
      fx?.smoke?.(_mount, 0xd8dfe6, 1.15, 1.25);
      render?.lights?.flash?.(_mount, 0xff5a20, 4.5, 7, 0.14);
      audio?.play?.('steam_burst', { position: _mount, volume: 0.82, pitch: 1.25 });
      audio?.play?.('railgun_fizzle', { position: _mount, volume: 0.6, pitch: 0.9 });
    }
  }

  idleUpdate(dt: number): void {
    this.stopFireLoop();
    this.wasFiring = false;
    this.fireAccum = 0;
    if (this.overheated) {
      this.overheatRemaining -= dt;
      if (this.overheatRemaining <= 1e-6) {
        this.overheated = false;
        this.overheatRemaining = 0;
        this.heat = 0;
      } else {
        this.heat = clamp((this.overheatRemaining / SHOULDER_GATLING.overheatLockout) * SHOULDER_GATLING.heatMax, 0, SHOULDER_GATLING.heatMax);
      }
    } else if (this.heat > 0) {
      this.heat = Math.max(0, this.heat - SHOULDER_GATLING.heatCoolPerSec * dt);
    }
  }

  fillRow(row: GunnerWeapon, keyLabel: string, cycleKeyLabel: string, online: boolean): void {
    row.max = SHOULDER_GATLING.heatMax;
    row.selected = this.wasFiring;
    if (!online) {
      row.name = `${keyLabel} ROTARY POD // OFFLINE`;
      row.ammo = 0;
      row.reload = -1;
      return;
    }
    if (this.overheated) {
      row.name = `${keyLabel} ROTARY [${this.mode}] // VENTING`;
      row.ammo = 0;
      row.reload = this.overheatProgress;
      return;
    }
    row.name = `${keyLabel} ROTARY [${this.mode}] // ${cycleKeyLabel}`;
    row.ammo = Math.round(SHOULDER_GATLING.heatMax - this.heat);
    row.reload = -1;
  }

  silence(): void {
    this.stopFireLoop();
    this.wasFiring = false;
  }

  reset(): void {
    this.stopFireLoop();
    this.modeIndex = 0;
    this.heat = 0;
    this.overheated = false;
    this.overheatRemaining = 0;
    this.fireAccum = 0;
    this.roundsFired = 0;
    this.wasFiring = false;
    this.newsClock = 0;
  }

  private fireOneRound(): THREE.Vector3 {
    const { combat, enemies, fx, camera } = this.ctx;
    const n = ++this.roundsFired;
    const isIncendiary = this.mode === 'INCENDIARY';

    randomInCone(_baseDir, SHOULDER_GATLING.spread, _shotDir);

    this.shot.damage = SHOULDER_GATLING.damage;
    this.shot.source = isIncendiary ? 'frame_shoulder_gatling_inc' : 'frame_shoulder_gatling_ap';
    this.shot.armorPiercing = !isIncendiary;
    this.shot.pierce = isIncendiary ? 0 : 1;
    this.shot.load = isIncendiary ? 'api' : 'ap';
    this.shot.tracer = n % SHOULDER_GATLING.tracerEvery === 0
      ? (isIncendiary ? 'hellfire' : 'ap')
      : undefined;
    this.shot.tracerFrom = _mount;

    this.struck.count = 0;
    this.struck.walls = 0;
    this.struck.enemies[0] = null;
    this.struck.enemies[1] = null;
    this.shot.struck = isIncendiary ? this.struck : undefined;

    const result = combat.fireRay(_mount, _shotDir, this.shot);

    if (isIncendiary && this.struck.count > 0) {
      for (let i = 0; i < this.struck.count && i < this.struck.enemies.length; i++) {
        const e: EnemyInstance | null = this.struck.enemies[i] ?? null;
        if (e && e.alive) {
          enemies?.afflict?.(e, 'burn', SHOULDER_GATLING.burnSeconds);
          fx?.sparks?.(this.struck.points[i]!, UP, 5, '#ff6818');
        }
      }
    }

    if (n % SHOULDER_GATLING.flashEvery === 0) {
      fx?.muzzleFlash?.(_mount, _baseDir, 'rotary');
      camera?.addTrauma?.(0.025);
    }

    return result.end;
  }

  private stopFireLoop(): void {
    if (!this.fireLoop) return;
    this.fireLoop.stop?.(0.08);
    this.fireLoop = null;
  }
}

/** Co-op playback for teammates when a Shoulder Rotary Pod fires. */
export function playRemoteShoulderGatling(ctx: Ctx, kind: MechKind, values: number[]): void {
  if (kind !== 'shoulderGatling' || values.length < 7) return;
  const isIncendiary = values[0]! > 0.5;
  _rFrom.set(values[1]!, values[2]!, values[3]!);
  _rTo.set(values[4]!, values[5]!, values[6]!);
  _rDir.subVectors(_rTo, _rFrom);
  if (_rDir.lengthSq() > 1e-4) _rDir.normalize();
  else _rDir.set(0, 0, -1);

  ctx.fx?.tracer?.(_rFrom, _rTo, isIncendiary ? 'hellfire' : 'ap');
  ctx.fx?.muzzleFlash?.(_rFrom, _rDir, 'rotary');
  ctx.audio?.play?.('minigun_fire', { position: _rFrom, volume: 0.55, pitch: 1.15 });
}

export const SHOULDER_GATLING_PLUGIN: ShoulderPlugin = {
  kind: 'shoulderGatling',
  newsKinds: ['shoulderGatling'],
  create: ctx => new ShoulderGatlingShoulder(ctx),
  remoteNews: playRemoteShoulderGatling,
};

export const SHOULDER_GATLING_SHOULDER = SHOULDER_GATLING_PLUGIN;
