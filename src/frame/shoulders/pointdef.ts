/**
 * Point Defence active protection turret plug-in (`pointdef`).
 *
 *   Always-on APS       No trigger key required. Inspects live enemy rockets, grenades, and shells
 *                       within 15 m (or on course into 15 m) via `ctx.combat.interceptEnemyProjectiles`.
 *   Charges & timing    6 charges, 0.6 s cooldown between intercepts, refills 1 charge every 3.0 s
 *                       (including while parked via `idleUpdate`).
 *   Close-in defense    Alive enemies within 6 m take 12 damage 3 times per second (every 0.333 s),
 *                       with a crisp mini-tracer spark from the shoulder dome turret.
 *   Co-op               Emits `'pointdef'` news `[mx, my, mz, tx, ty, tz, isIntercept]` so teammates
 *                       see the intercept tracer and mid-air kill puff.
 */
import * as THREE from 'three';
import { CG, type Ctx, type DamageInfo } from '../../core/contracts';
import type { EnemyInstance } from '../../core/gameplay';
import { clamp } from '../../core/math';
import type { MechKind } from '../../progression/callins/link';
import type { GunnerWeapon } from '../../vehicles/hud';
import type { FrameShoulderWeapon, ShoulderPlugin, ShoulderUpdateContext } from './types';

export const POINTDEF_INTERCEPT_RADIUS = 15;
export const POINTDEF_MAX_CHARGES = 6;
export const POINTDEF_COOLDOWN = 0.6;
export const POINTDEF_REFILL_SECONDS = 3.0;
export const POINTDEF_ZAP_RADIUS = 6;
export const POINTDEF_ZAP_DAMAGE = 12;
export const POINTDEF_ZAP_RATE = 3;
export const POINTDEF_ZAP_INTERVAL = 1 / POINTDEF_ZAP_RATE;

// Module-level scratch — zero per-frame allocations.
const _mount = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _back = new THREE.Vector3();
const _hits: EnemyInstance[] = [];
const _zapBlow: DamageInfo = {
  amount: POINTDEF_ZAP_DAMAGE,
  type: 'bullet',
  point: new THREE.Vector3(),
  dir: new THREE.Vector3(),
  force: 18,
  source: 'frame_pointdef',
};

function playInterceptFx(ctx: Ctx, from: THREE.Vector3, at: THREE.Vector3): void {
  _dir.subVectors(at, from);
  const len = _dir.length();
  if (len > 1e-4) _dir.multiplyScalar(1 / len);
  else _dir.set(0, 0, -1);
  _back.copy(_dir).negate();

  ctx.fx?.tracer?.(from, at, 'heavy');
  ctx.fx?.muzzleFlash?.(from, _dir, 'smg');
  ctx.fx?.sparks?.(at, _back, 14, 0xffd060);
  ctx.fx?.ring?.(at, _dir, '#ffd470', 1.6);
  ctx.fx?.smoke?.(at, 0xe8ecf0, 1.05, 0.7);
  ctx.render?.lights?.flash?.(at, 0xffcc66, 6, 9, 0.08);
  ctx.audio?.play?.('bullet_snap', { position: at, volume: 0.9, pitch: 1.2 });
  ctx.audio?.play?.('raufoss_detonation', { position: at, volume: 0.65, pitch: 1.4 });
}

function playZapFx(ctx: Ctx, from: THREE.Vector3, at: THREE.Vector3, playSound: boolean): void {
  _dir.subVectors(at, from);
  const len = _dir.length();
  if (len > 1e-4) _dir.multiplyScalar(1 / len);
  else _dir.set(0, 0, -1);
  _back.copy(_dir).negate();

  ctx.fx?.tracer?.(from, at, 'bullet');
  ctx.fx?.sparks?.(at, _back, 4, 0xffaa44);
  if (playSound) {
    ctx.audio?.play?.('drone_gun', { position: from, volume: 0.35, pitch: 1.35 });
  }
}

export class PointDefShoulder implements FrameShoulderWeapon {
  readonly kind = 'pointdef' as const;
  charges: number = POINTDEF_MAX_CHARGES;
  private interceptCooldown = 0;
  private refillIn = 0;
  private zapCooldown = 0;

  constructor(private readonly ctx: Ctx) {}

  /** 0..1 refill progress toward the next intercept charge, or -1 when full. */
  get refillProgress(): number {
    return this.charges < POINTDEF_MAX_CHARGES
      ? clamp(1 - this.refillIn / POINTDEF_REFILL_SECONDS, 0, 1)
      : -1;
  }

  /** Remaining seconds before another projectile intercept can fire. */
  get cooldownRemaining(): number {
    return this.interceptCooldown;
  }

  update(dt: number, u: ShoulderUpdateContext): void {
    this.tickClocks(dt);
    if (!u.online) return;

    // 1. Passive hard-kill projectile interception (15 m radius, 6 charges, 0.6 s cooldown).
    if (this.charges > 0 && this.interceptCooldown <= 1e-6) {
      let intercepted = false;
      const count = this.ctx.combat.interceptEnemyProjectiles?.(
        u.feet,
        POINTDEF_INTERCEPT_RADIUS,
        1,
        at => {
          _hit.copy(at);
          intercepted = true;
        },
      ) ?? 0;

      if (count > 0 && intercepted) {
        const wasFull = this.charges === POINTDEF_MAX_CHARGES;
        this.charges--;
        this.interceptCooldown = POINTDEF_COOLDOWN;
        if (wasFull) this.refillIn = POINTDEF_REFILL_SECONDS;

        u.mountPos(_mount);
        playInterceptFx(this.ctx, _mount, _hit);
        u.onNews?.('pointdef', [_mount.x, _mount.y, _mount.z, _hit.x, _hit.y, _hit.z, 1]);
      }
    }

    // 2. Close-in infantry defense: alive enemies within 6 m take 12 dmg @ 3/s (every 0.333 s).
    if (this.zapCooldown > 0) this.zapCooldown -= dt;
    if (this.zapCooldown <= 1e-6) {
      const zapped = this.zapCloseInfantry(u);
      if (zapped > 0) {
        this.zapCooldown = Math.max(0, this.zapCooldown) + POINTDEF_ZAP_INTERVAL;
      } else {
        this.zapCooldown = 0;
      }
    }
  }

  idleUpdate(dt: number): void {
    this.tickClocks(dt);
    if (this.zapCooldown > 0) this.zapCooldown = Math.max(0, this.zapCooldown - dt);
  }

  fillRow(row: GunnerWeapon, _keyLabel: string, _cycleKeyLabel: string, online: boolean): void {
    row.max = POINTDEF_MAX_CHARGES;
    if (!online) {
      row.name = 'APS POINT DEFENCE // OFFLINE';
      row.ammo = 0;
      row.reload = -1;
      return;
    }
    row.name = 'APS POINT DEFENCE';
    row.ammo = this.charges;
    row.reload = this.refillProgress;
  }

  reset(): void {
    this.charges = POINTDEF_MAX_CHARGES;
    this.interceptCooldown = 0;
    this.refillIn = 0;
    this.zapCooldown = 0;
  }

  private tickClocks(dt: number): void {
    if (this.interceptCooldown > 0) {
      this.interceptCooldown = Math.max(0, this.interceptCooldown - dt);
    }
    if (this.charges < POINTDEF_MAX_CHARGES) {
      this.refillIn -= dt;
      while (this.refillIn <= 1e-6 && this.charges < POINTDEF_MAX_CHARGES) {
        this.charges++;
        this.refillIn = this.charges < POINTDEF_MAX_CHARGES ? this.refillIn + POINTDEF_REFILL_SECONDS : 0;
      }
    } else {
      this.refillIn = 0;
    }
  }

  private zapCloseInfantry(u: ShoulderUpdateContext): number {
    const enemies = this.ctx.enemies;
    if (!enemies) return 0;

    // Gather candidates from `alive` (zero-alloc) with fallback to `query` for minimal mocks.
    let list: readonly EnemyInstance[] = enemies.alive;
    let count = list ? list.length : 0;
    if (count === 0 && typeof enemies.query === 'function') {
      _hits.length = 0;
      count = enemies.query(u.feet, POINTDEF_ZAP_RADIUS + 0.5, _hits) || 0;
      list = _hits;
    }
    if (count === 0) return 0;

    const r2 = POINTDEF_ZAP_RADIUS * POINTDEF_ZAP_RADIUS;
    let zapped = 0;
    let mountReady = false;

    for (let i = 0; i < count; i++) {
      const e = list[i]!;
      if (!e.alive) continue;
      const dx = e.position.x - u.feet.x;
      const dz = e.position.z - u.feet.z;
      const dy = Math.abs(e.position.y - u.feet.y);
      if (dx * dx + dz * dz > r2 || dy > 4.5) continue;

      if (!mountReady) {
        u.mountPos(_mount);
        mountReady = true;
      }

      // Respect solid walls between turret mount and target.
      _dir.subVectors(e.center, _mount);
      const dist = _dir.length();
      if (dist > 1e-4) {
        _dir.multiplyScalar(1 / dist);
        const wall = this.ctx.physics?.raycast?.(_mount, _dir, dist, CG.World);
        if (wall && wall.distance < dist - 0.6) continue;
      } else {
        _dir.set(0, -1, 0);
      }

      _zapBlow.amount = POINTDEF_ZAP_DAMAGE;
      _zapBlow.point.copy(e.center);
      _zapBlow.dir.copy(_dir);
      enemies.applyDamage(e, _zapBlow);

      playZapFx(this.ctx, _mount, e.center, zapped === 0);
      if (zapped === 0) {
        u.onNews?.('pointdef', [_mount.x, _mount.y, _mount.z, e.center.x, e.center.y, e.center.z, 0]);
      }
      zapped++;
    }
    return zapped;
  }
}

function remotePointDefNews(ctx: Ctx, _kind: MechKind, values: number[]): void {
  if (values.length < 6) return;
  _mount.set(values[0]!, values[1]!, values[2]!);
  _hit.set(values[3]!, values[4]!, values[5]!);
  const isIntercept = (values[6] ?? 1) !== 0;
  if (isIntercept) playInterceptFx(ctx, _mount, _hit);
  else playZapFx(ctx, _mount, _hit, true);
}

export const POINTDEF_PLUGIN: ShoulderPlugin = {
  kind: 'pointdef',
  newsKinds: ['pointdef'],
  create: ctx => new PointDefShoulder(ctx),
  remoteNews: remotePointDefNews,
};
