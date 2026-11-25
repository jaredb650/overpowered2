/**
 * Aegis Barrier Core Expansion (`expAegis`, `Q` key).
 * - 2 charges, 24 s refill each.
 * - Pressing `Q` wraps the Frame in a mobile 1800 HP spherical energy barrier for 8 s, immediately clearing
 *   any attached leg sappers, absorbing incoming hull damage until the shield pool or timer expires, setting
 *   `visual.aegisAlpha`, and broadcasting `onNews('expansion', [2, x, y, z])`.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import { clamp } from '../../core/math';
import type { GunnerWeapon } from '../../vehicles/hud';
import type { ExpansionContext, ExpansionPlugin, ExpansionVisualState, FrameExpansion } from './types';

export const AEGIS_MAX_CHARGES = 2;
export const AEGIS_REFILL_SECONDS = 24;
export const AEGIS_SHIELD_HP = 1800;
export const AEGIS_DURATION = 8.0;

const UP = new THREE.Vector3(0, 1, 0);
const _pos = new THREE.Vector3();

function playAegisFx(ctx: Ctx, x: number, y: number, z: number): void {
  _pos.set(x, y + 2.4, z);
  ctx.fx?.ring?.(_pos, UP, '#38e8ff', 4.6);
  ctx.render?.lights?.flash?.(_pos, '#38e8ff', 10, 14, 0.3);
  ctx.audio?.play?.('railgun_ready', { position: _pos, pitch: 1.15, volume: 0.78 });
}

class AegisExpansion implements FrameExpansion {
  readonly kind = 'aegis' as const;
  readonly visual: ExpansionVisualState = {
    novaProgress: 0,
    aegisAlpha: 0,
    terminalActive: false,
    domePos: null,
    domeAlpha: 0,
  };

  private charges = AEGIS_MAX_CHARGES;
  private refillIn = 0;
  private lockout = 0;
  private shieldHp = 0;
  private shieldTimer = 0;

  trigger(u: ExpansionContext): boolean {
    if (this.charges <= 0 || this.lockout > 0) return false;
    const wasFull = this.charges === AEGIS_MAX_CHARGES;
    this.charges--;
    if (wasFull) this.refillIn = AEGIS_REFILL_SECONDS;
    this.lockout = 0.5;

    u.clearSapper();
    this.shieldHp = AEGIS_SHIELD_HP;
    this.shieldTimer = AEGIS_DURATION;
    this.visual.terminalActive = false;
    this.visual.aegisAlpha = 1;

    playAegisFx(u.ctx, u.feet.x, u.feet.y, u.feet.z);
    u.ctx.hud?.feed?.(`AEGIS BARRIER ONLINE (${AEGIS_SHIELD_HP} HP)`, '#38e8ff');
    u.onNews?.('expansion', [2, u.feet.x, u.feet.y, u.feet.z]);
    return true;
  }

  absorbDamage(damage: number, _currentHp: number, _from: THREE.Vector3 | undefined, u: ExpansionContext): number {
    if (damage <= 0 || this.shieldHp <= 0 || this.shieldTimer <= 0) return damage;
    const absorbed = Math.min(this.shieldHp, damage);
    this.shieldHp -= absorbed;
    const remaining = damage - absorbed;

    if (this.shieldHp <= 0) {
      this.shieldHp = 0;
      this.shieldTimer = 0;
      this.visual.aegisAlpha = 0;
      _pos.set(u.feet.x, u.feet.y + 2.4, u.feet.z);
      u.ctx.fx?.ring?.(_pos, UP, '#80f4ff', 5.4);
      u.ctx.fx?.sparks?.(_pos, UP, 18, '#7cf2ff');
      u.ctx.audio?.play?.('glass_break', { position: _pos, pitch: 0.92, volume: 0.72 });
      u.ctx.hud?.feed?.('AEGIS BARRIER SHATTERED', '#ff8830');
    } else {
      this.syncAlpha();
      u.ctx.audio?.play?.('metal_clang', { pitch: 1.75, volume: 0.28 });
    }
    return remaining;
  }

  private syncAlpha(): void {
    if (this.shieldHp <= 0 || this.shieldTimer <= 0) {
      this.visual.aegisAlpha = 0;
      return;
    }
    const hpShare = this.shieldHp / AEGIS_SHIELD_HP;
    const timeFade = Math.min(1, this.shieldTimer);
    this.visual.aegisAlpha = clamp((0.3 + 0.7 * hpShare) * timeFade, 0, 1);
  }

  private tick(dt: number): void {
    const h = Math.max(0, dt);
    if (this.lockout > 0) this.lockout = Math.max(0, this.lockout - h);
    if (this.shieldTimer > 0) {
      this.shieldTimer = Math.max(0, this.shieldTimer - h);
      if (this.shieldTimer <= 0) {
        this.shieldHp = 0;
        this.visual.aegisAlpha = 0;
      } else {
        this.syncAlpha();
      }
    }
    if (this.charges < AEGIS_MAX_CHARGES) {
      this.refillIn -= h;
      if (this.refillIn <= 0) {
        this.charges++;
        this.refillIn = this.charges < AEGIS_MAX_CHARGES ? AEGIS_REFILL_SECONDS : 0;
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
    row.name = this.shieldHp > 0 ? `Q AEGIS [${Math.ceil(this.shieldHp)}]` : 'Q AEGIS BARRIER';
    row.ammo = this.charges;
    row.max = AEGIS_MAX_CHARGES;
    row.reload = this.charges < AEGIS_MAX_CHARGES ? 1 - this.refillIn / AEGIS_REFILL_SECONDS : -1;
  }

  reset(): void {
    this.charges = AEGIS_MAX_CHARGES;
    this.refillIn = 0;
    this.lockout = 0;
    this.shieldHp = 0;
    this.shieldTimer = 0;
    this.visual.aegisAlpha = 0;
    this.visual.terminalActive = false;
  }
}

export const AEGIS_EXPANSION: ExpansionPlugin = {
  kind: 'aegis',
  create: (_ctx: Ctx) => new AegisExpansion(),
  remoteNews(ctx: Ctx, values: number[]): void {
    playAegisFx(ctx, values[1] ?? 0, values[2] ?? 0, values[3] ?? 0);
  },
};
