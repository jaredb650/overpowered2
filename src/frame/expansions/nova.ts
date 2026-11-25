/**
 * Breacher Nova Core Expansion (`expNova`, `Q` key).
 * - 2 charges, 20 s refill each.
 * - Pressing `Q` triggers a violent 16 m 360° thermobaric/EMP shock sphere dealing 480 damage with heavy 180
 *   knockback to all enemies in range, clears attached leg sappers, detonates nearby explosive props, animates
 *   `visual.novaProgress` from `1 -> 0` over 0.65 s, and broadcasts `onNews('expansion', [1, x, y, z])`.
 */
import * as THREE from 'three';
import type { Ctx, DamageInfo } from '../../core/contracts';
import type { EnemyInstance } from '../../core/gameplay';
import type { GunnerWeapon } from '../../vehicles/hud';
import type { ExpansionContext, ExpansionPlugin, ExpansionVisualState, FrameExpansion } from './types';

export const NOVA_MAX_CHARGES = 2;
export const NOVA_REFILL_SECONDS = 20;
export const NOVA_RADIUS = 16;
export const NOVA_DAMAGE = 480;
export const NOVA_KNOCKBACK = 180;
export const NOVA_VISUAL_SECONDS = 0.65;

const UP = new THREE.Vector3(0, 1, 0);
const _center = new THREE.Vector3();
const _hits: EnemyInstance[] = [];
const _dmg: DamageInfo = {
  amount: NOVA_DAMAGE,
  type: 'explosive',
  point: new THREE.Vector3(),
  dir: new THREE.Vector3(),
  force: NOVA_KNOCKBACK,
  source: 'frame_nova',
  gib: false,
};

function playNovaFx(ctx: Ctx, x: number, y: number, z: number): void {
  _center.set(x, y + 2.2, z);
  ctx.fx?.ring?.(_center, UP, '#ff8830', NOVA_RADIUS);
  ctx.fx?.slam?.(_center.clone().setY(y), 1.4);
  ctx.fx?.sparks?.(_center, UP, 28, '#ffd480');
  ctx.render?.lights?.flash?.(_center, '#ff9038', 18, 26, 0.45);
  ctx.audio?.play?.('orbital_strike', { position: _center, pitch: 1.12, volume: 0.9 });
  ctx.audio?.play?.('steam_burst', { position: _center, pitch: 0.58, volume: 0.85 });
}

class NovaExpansion implements FrameExpansion {
  readonly kind = 'nova' as const;
  readonly visual: ExpansionVisualState = {
    novaProgress: 0,
    aegisAlpha: 0,
    terminalActive: false,
    domePos: null,
    domeAlpha: 0,
  };

  private charges = NOVA_MAX_CHARGES;
  private refillIn = 0;
  private lockout = 0;
  private novaTimer = 0;

  trigger(u: ExpansionContext): boolean {
    if (this.charges <= 0 || this.lockout > 0) return false;
    const wasFull = this.charges === NOVA_MAX_CHARGES;
    this.charges--;
    if (wasFull) this.refillIn = NOVA_REFILL_SECONDS;
    this.lockout = NOVA_VISUAL_SECONDS;

    // Clear any attached leg sapper immediately.
    u.clearSapper();

    _center.set(u.feet.x, u.feet.y + 2.2, u.feet.z);

    // 360° 16 m thermobaric / EMP shock blast against all enemies.
    const enemies = u.ctx.enemies;
    if (enemies && typeof enemies.query === 'function') {
      const n = Math.min(enemies.query(_center, NOVA_RADIUS, _hits) || 0, _hits.length);
      for (let i = 0; i < n; i++) {
        const e = _hits[i]!;
        if (!e.alive) continue;
        const dx = e.position.x - u.feet.x;
        const dz = e.position.z - u.feet.z;
        const dist = Math.hypot(dx, dz);
        if (dist > NOVA_RADIUS) continue;
        _dmg.amount = NOVA_DAMAGE;
        _dmg.force = NOVA_KNOCKBACK;
        _dmg.point.copy(e.center ?? e.position);
        _dmg.dir.set(dx, 0, dz);
        if (_dmg.dir.lengthSq() < 1e-4) _dmg.dir.set(1, 0, 0);
        _dmg.dir.normalize().setY(0.55).normalize();
        _dmg.gib = dist < 6;
        enemies.applyDamage(e, _dmg);
        _dmg.gib = false;
      }
      _hits.length = 0;
    }

    // Destroy nearby explosive barrels, tanks, and destructible cover.
    const objects = u.ctx.world?.objects;
    objects?.damageExplosivesInRadius?.(_center, NOVA_RADIUS, NOVA_DAMAGE, 'frame_nova');
    objects?.destruction?.blast?.(_center, NOVA_RADIUS, NOVA_DAMAGE, 'frame_nova');

    // Animate shock sphere `1 -> 0` over 0.65 s and trigger local + co-op FX.
    this.novaTimer = NOVA_VISUAL_SECONDS;
    this.visual.novaProgress = 1;
    playNovaFx(u.ctx, u.feet.x, u.feet.y, u.feet.z);
    u.ctx.camera?.addTrauma?.(0.55);
    u.ctx.render?.post?.flash?.('#ffaa55', 0.28, 0.25);
    u.ctx.hud?.feed?.('BREACHER NOVA DETONATED', '#ff8830');
    u.onNews?.('expansion', [1, u.feet.x, u.feet.y, u.feet.z]);
    return true;
  }

  private tick(dt: number): void {
    const h = Math.max(0, dt);
    if (this.lockout > 0) this.lockout = Math.max(0, this.lockout - h);
    if (this.novaTimer > 0) {
      this.novaTimer = Math.max(0, this.novaTimer - h);
      this.visual.novaProgress = this.novaTimer / NOVA_VISUAL_SECONDS;
    } else {
      this.visual.novaProgress = 0;
    }
    if (this.charges < NOVA_MAX_CHARGES) {
      this.refillIn -= h;
      if (this.refillIn <= 0) {
        this.charges++;
        this.refillIn = this.charges < NOVA_MAX_CHARGES ? NOVA_REFILL_SECONDS : 0;
      }
    }
  }

  update(dt: number, _u: ExpansionContext): void {
    this.tick(dt);
  }

  idleUpdate(dt: number): void {
    this.tick(dt);
  }

  fillRow(row: GunnerWeapon): void {
    row.name = 'Q BREACHER NOVA';
    row.ammo = this.charges;
    row.max = NOVA_MAX_CHARGES;
    row.reload = this.charges < NOVA_MAX_CHARGES ? 1 - this.refillIn / NOVA_REFILL_SECONDS : -1;
  }

  reset(): void {
    this.charges = NOVA_MAX_CHARGES;
    this.refillIn = 0;
    this.lockout = 0;
    this.novaTimer = 0;
    this.visual.novaProgress = 0;
  }
}

export const NOVA_EXPANSION: ExpansionPlugin = {
  kind: 'nova',
  create: (_ctx: Ctx) => new NovaExpansion(),
  remoteNews(ctx: Ctx, values: number[]): void {
    playNovaFx(ctx, values[1] ?? 0, values[2] ?? 0, values[3] ?? 0);
  },
};
