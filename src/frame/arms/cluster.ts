/**
 * Bomblet Cannon arm weapon plug-in (`clusterL` / `clusterR`).
 *
 * Single-shell breech (3.6 s auto-reload) firing a heavy standoff canister shell that airbursts 7 m short of the first
 * enemy body or world surface along its line, carpeting a ~14 m × 9 m patch ahead with 28 wall-bouncing bomblets that
 * ripple over 0.7 s.
 */
import * as THREE from 'three';
import { CG, type Ctx } from '../../core/contracts';
import { rand } from '../../core/math';
import { Magazine } from '../../progression/callins/ac130Guns';
import type { GunnerWeapon } from '../../vehicles/hud';
import { bombletCarpet, clearBomblets, stepBombletsIfUnhooked, type BombletSpec } from '../bomblets';
import { NEAR_SIGHT } from './shared';
import type { ArmPlugin, ArmUpdateContext, FrameArmGun } from './types';

export const CLUSTER_TUNING = {
  magazine: 1,
  reload: 3.6,
  interval: 0.25,
  standoff: 7,
  minBurst: 2,
  maxRange: 140,
  proxRadius: 2.2,
  trauma: 0.18,
  kick: 0.034,
} as const;

export const CLUSTER_SPEC: Readonly<BombletSpec> = {
  count: 28,
  length: 14,
  width: 9,
  ripple: 0.7,
  blastRadius: 2.4,
  damage: 70,
  circular: false,
  source: 'frame_cluster',
};

const CLUSTER_COSMETIC_SPEC: Readonly<BombletSpec> = {
  ...CLUSTER_SPEC,
  cosmetic: true,
};

const _muzzle = new THREE.Vector3();
const _bore = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _burst = new THREE.Vector3();
const _v = new THREE.Vector3();
const _at = new THREE.Vector3();

/**
 * Pure standoff fuze solver: finds the nearest world surface or live enemy body along `(muzzle, dir)` up to `maxRange`,
 * subtracts `CLUSTER_TUNING.standoff` (7 m), and clamps to at least `CLUSTER_TUNING.minBurst` (2 m) from the muzzle.
 * Writes the airburst point into `out` and returns the burst distance in metres.
 */
export function clusterBurstPoint(
  ctx: Ctx,
  muzzle: THREE.Vector3,
  dir: THREE.Vector3,
  out: THREE.Vector3,
  maxRange: number = CLUSTER_TUNING.maxRange,
): number {
  const wall = ctx.physics?.raycast?.(muzzle, dir, maxRange, CG.World) ?? null;
  let firstDist = wall ? wall.distance : maxRange;

  const enemyRay = ctx.enemies?.raycast?.(muzzle, dir, firstDist) ?? null;
  if (enemyRay && enemyRay.distance < firstDist) {
    firstDist = enemyRay.distance;
  }

  // Also check enemy bodies within proximity radius of the shell's line so crowds trigger standoff cleanly.
  const alive = ctx.enemies?.alive;
  if (alive && alive.length > 0) {
    const prox2 = CLUSTER_TUNING.proxRadius * CLUSTER_TUNING.proxRadius;
    for (let i = 0; i < alive.length; i++) {
      const e = alive[i]!;
      if (!e.alive) continue;
      const dx = e.center.x - muzzle.x;
      const dy = e.center.y - muzzle.y;
      const dz = e.center.z - muzzle.z;
      const proj = dx * dir.x + dy * dir.y + dz * dir.z;
      if (proj <= 0.5 || proj >= firstDist) continue;
      const px = dx - dir.x * proj;
      const py = dy - dir.y * proj;
      const pz = dz - dir.z * proj;
      if (px * px + py * py + pz * pz <= prox2) {
        firstDist = proj;
      }
    }
  }

  const burstDist = Math.max(CLUSTER_TUNING.minBurst, firstDist - CLUSTER_TUNING.standoff);
  out.copy(muzzle).addScaledVector(dir, burstDist);
  return burstDist;
}

/** Draws the standoff airburst flash, shock ring, smoke puff, sparks, and pop sound at `at`. */
function airburstFx(ctx: Ctx, at: THREE.Vector3, dir: THREE.Vector3, rounds?: ArmUpdateContext['rounds']): void {
  const { fx, audio, render } = ctx;
  rounds?.flash?.(at, 2.4, 0.14, 10, 12, 7.5, 2.8);
  fx?.ring?.(at, dir, '#ffaa30', 4.6);
  fx?.smoke?.(at, 0xd0d4da, 2.2, 1.4);
  fx?.sparks?.(at, dir, 24, '#ffcc66');
  render?.lights?.flash?.(at, 0xffaa44, 12, 12, 0.12);
  audio?.play?.('30mmshell_explode', { position: at, volume: 0.88, pitch: 0.78 });
}

/** Pure clock for the 1-shell Bomblet Cannon breech. */
export class ClusterCannon {
  readonly mag = new Magazine(CLUSTER_TUNING.magazine, CLUSTER_TUNING.reload, CLUSTER_TUNING.interval);

  startReload(): boolean {
    if (this.mag.reloading >= 0 || this.mag.ammo >= this.mag.size) return false;
    this.mag.ammo = 0;
    this.mag.reloading = this.mag.reload;
    return true;
  }

  reset(): void {
    this.mag.ammo = this.mag.size;
    this.mag.reloading = -1;
  }
}

export class ClusterArmGun implements FrameArmGun {
  readonly kind = 'cluster' as const;
  readonly clock = new ClusterCannon();

  constructor(private readonly ctx: Ctx) {}

  get firing(): boolean {
    return false;
  }

  update(dt: number, u: ArmUpdateContext): void {
    const { audio } = this.ctx;
    const mag = this.clock.mag;
    const wasLoading = mag.reloading >= 0;
    mag.update(dt);
    stepBombletsIfUnhooked(dt, this.ctx);

    if (wasLoading && mag.reloading < 0) {
      audio.play('reload_shell_in', { volume: 0.95, pitch: 0.56 });
      audio.play('metal_clang', { volume: 0.8, pitch: 0.62 });
    }
    if (u.reloadPressed && this.clock.startReload()) {
      audio.play('reload_bolt', { pitch: 0.62, volume: 0.8 });
    }
    if (u.held && mag.ready) {
      this.fire(u);
    } else if (u.pressed && mag.ammo === 0) {
      audio.play('weapon_dry', { pitch: 0.75 });
    }
  }

  idleUpdate(dt: number): void {
    this.clock.mag.update(dt);
    stepBombletsIfUnhooked(dt, this.ctx);
  }

  fillRow(row: GunnerWeapon, button: string): void {
    const mag = this.clock.mag;
    row.name = `${button} BOMBLET CANNON`;
    row.ammo = mag.ammo;
    row.max = CLUSTER_TUNING.magazine;
    row.reload = mag.progress;
    row.selected = false;
  }

  silence(): void {
    // No looping audio.
  }

  reset(): void {
    this.clock.reset();
    clearBomblets(this.ctx);
  }

  private fire(u: ArmUpdateContext): void {
    const { audio, camera, fx, render } = this.ctx;
    if (!this.clock.mag.take()) return;

    u.arm.muzzle(_muzzle);
    u.arm.bore(_bore);
    if (u.sight.range > NEAR_SIGHT) _aim.copy(u.sight.point);
    else _aim.copy(_muzzle).addScaledVector(_bore, CLUSTER_TUNING.maxRange);
    _dir.subVectors(_aim, _muzzle);
    if (_dir.lengthSq() < 1e-6) _dir.copy(_bore);
    else _dir.normalize();

    clusterBurstPoint(this.ctx, _muzzle, _dir, _burst);

    // Muzzle blast + canister streak to standoff burst point.
    u.rounds?.flash?.(_muzzle, 2.4, 0.09, 10, 11, 7, 3);
    fx?.muzzleFlash?.(_muzzle, _bore, 'autocannon');
    fx?.tracer?.(_muzzle, _burst, 'heavy');
    fx?.smoke?.(_v.copy(_muzzle).addScaledVector(_bore, 2.2), 0xa8aeb6, 1.5, 1.2);
    fx?.sparks?.(_v.copy(_muzzle).addScaledVector(_bore, 0.5), _bore, 16, '#ffbb55');
    _v.set(-_bore.z, 0, _bore.x).multiplyScalar(2.8);
    _v.y = rand(1.8, 3.0);
    fx?.shellCasing?.(_at.copy(_muzzle).addScaledVector(_bore, -2.0), _v, 'cannon');
    render?.lights?.flash?.(_muzzle, 0xffaa44, 7.5, 12, 0.1);
    audio?.play?.('mgl_shot', { volume: 1.25, pitch: 0.65 });

    // Standoff airburst + bomblet carpet release.
    airburstFx(this.ctx, _burst, _dir, u.rounds);
    bombletCarpet(this.ctx, _burst, _dir, CLUSTER_SPEC);
    u.onNews?.('cluster', [_burst.x, _burst.y, _burst.z, _dir.x, _dir.y, _dir.z]);

    u.arm.recoil(0.85);
    if (u.recoilMult > 0) {
      camera?.addTrauma?.(CLUSTER_TUNING.trauma * u.recoilMult);
      camera?.kick?.(CLUSTER_TUNING.kick * u.recoilMult, rand(-0.008, 0.008) * u.recoilMult);
    }
  }
}

export const CLUSTER_PLUGIN: ArmPlugin = {
  kind: 'cluster',
  newsKinds: ['cluster'],
  create: ctx => new ClusterArmGun(ctx),
  remoteNews(ctx, _kind, values): void {
    if (values.length < 6) return;
    _burst.set(values[0]!, values[1]!, values[2]!);
    _dir.set(values[3]!, values[4]!, values[5]!);
    if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, -1);
    else _dir.normalize();
    airburstFx(ctx, _burst, _dir);
    bombletCarpet(ctx, _burst, _dir, CLUSTER_COSMETIC_SPEC);
  },
};
