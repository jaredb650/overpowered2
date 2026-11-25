/**
 * Bunker Dome Core Expansion (`expDome`, `Q` key).
 * - 2 charges, 26 s refill each.
 * - Pressing `Q` drops a huge stationary 11 m-radius, 3200 HP armoured energy dome on the ground at `feet` for 14 s.
 * - `absorbDamage` blocks incoming damage whenever the Frame is inside the dome's 11 m radius and the damage
 *   originates from outside the dome (so allies and the Frame can fight freely inside while outside fire is blocked!).
 * - Sets `visual.domePos` + `visual.domeAlpha` and broadcasts `onNews('expansion', [3, x, y, z])`.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import { clamp } from '../../core/math';
import type { GunnerWeapon } from '../../vehicles/hud';
import type { ExpansionContext, ExpansionPlugin, ExpansionVisualState, FrameExpansion } from './types';

export const DOME_MAX_CHARGES = 2;
export const DOME_REFILL_SECONDS = 26;
export const DOME_RADIUS = 11;
export const DOME_HP = 3200;
export const DOME_DURATION = 14.0;

const UP = new THREE.Vector3(0, 1, 0);
const _pos = new THREE.Vector3();

function playDomeFx(ctx: Ctx, x: number, y: number, z: number): void {
  _pos.set(x, y + 0.25, z);
  ctx.fx?.ring?.(_pos, UP, '#38d8ff', DOME_RADIUS);
  ctx.render?.lights?.flash?.(_pos.clone().setY(y + 2.5), '#38d8ff', 12, 22, 0.35);
  ctx.audio?.play?.('railgun_ready', { position: _pos, pitch: 0.78, volume: 0.85 });
}

class DomeExpansion implements FrameExpansion {
  readonly kind = 'dome' as const;
  readonly visual: ExpansionVisualState = {
    novaProgress: 0,
    aegisAlpha: 0,
    terminalActive: false,
    domePos: null,
    domeAlpha: 0,
  };

  private readonly anchor = new THREE.Vector3();
  private charges = DOME_MAX_CHARGES;
  private refillIn = 0;
  private lockout = 0;
  private domeHp = 0;
  private domeTimer = 0;

  trigger(u: ExpansionContext): boolean {
    if (this.charges <= 0 || this.lockout > 0) return false;
    const wasFull = this.charges === DOME_MAX_CHARGES;
    this.charges--;
    if (wasFull) this.refillIn = DOME_REFILL_SECONDS;
    this.lockout = 0.5;

    this.anchor.copy(u.feet);
    this.domeHp = DOME_HP;
    this.domeTimer = DOME_DURATION;
    this.visual.domePos = this.anchor;
    this.visual.domeAlpha = 1;

    playDomeFx(u.ctx, this.anchor.x, this.anchor.y, this.anchor.z);
    u.ctx.hud?.feed?.(`BUNKER DOME DEPLOYED (${DOME_HP} HP)`, '#38d8ff');
    u.onNews?.('expansion', [3, this.anchor.x, this.anchor.y, this.anchor.z]);
    return true;
  }

  absorbDamage(damage: number, _currentHp: number, from: THREE.Vector3 | undefined, u: ExpansionContext): number {
    if (damage <= 0 || this.domeHp <= 0 || this.domeTimer <= 0 || !this.visual.domePos) return damage;

    // Check if the Frame is currently sheltered inside the stationary 11 m dome.
    const mechHoriz = Math.hypot(u.feet.x - this.anchor.x, u.feet.z - this.anchor.z);
    const mechVert = u.feet.y - this.anchor.y;
    if (mechHoriz > DOME_RADIUS || mechVert < -2 || mechVert > DOME_RADIUS + 1.5) {
      return damage;
    }

    // Only intercept damage originating from outside the dome wall; enemies who walked inside hit normally.
    if (from) {
      const fromHoriz = Math.hypot(from.x - this.anchor.x, from.z - this.anchor.z);
      const fromVert = from.y - this.anchor.y;
      if (fromHoriz <= DOME_RADIUS && fromVert >= -2 && fromVert <= DOME_RADIUS + 1.5) {
        return damage;
      }
    }

    const absorbed = Math.min(this.domeHp, damage);
    this.domeHp -= absorbed;
    const remaining = damage - absorbed;

    if (this.domeHp <= 0) {
      this.domeHp = 0;
      this.domeTimer = 0;
      this.visual.domePos = null;
      this.visual.domeAlpha = 0;
      _pos.set(this.anchor.x, this.anchor.y + 1.8, this.anchor.z);
      u.ctx.fx?.ring?.(_pos, UP, '#70e8ff', DOME_RADIUS);
      u.ctx.fx?.sparks?.(_pos, UP, 24, '#70e8ff');
      u.ctx.audio?.play?.('glass_break', { position: _pos, pitch: 0.72, volume: 0.85 });
      u.ctx.hud?.feed?.('BUNKER DOME COLLAPSED', '#ff8830');
    } else {
      this.syncAlpha();
      u.ctx.audio?.play?.('metal_clang', { pitch: 1.55, volume: 0.25 });
    }
    return remaining;
  }

  private syncAlpha(): void {
    if (this.domeHp <= 0 || this.domeTimer <= 0) {
      this.visual.domePos = null;
      this.visual.domeAlpha = 0;
      return;
    }
    const hpShare = this.domeHp / DOME_HP;
    const timeFade = Math.min(1, this.domeTimer);
    this.visual.domeAlpha = clamp((0.35 + 0.65 * hpShare) * timeFade, 0, 1);
  }

  private tick(dt: number): void {
    const h = Math.max(0, dt);
    if (this.lockout > 0) this.lockout = Math.max(0, this.lockout - h);
    if (this.domeTimer > 0) {
      this.domeTimer = Math.max(0, this.domeTimer - h);
      if (this.domeTimer <= 0) {
        this.domeHp = 0;
        this.visual.domePos = null;
        this.visual.domeAlpha = 0;
      } else {
        this.syncAlpha();
      }
    }
    if (this.charges < DOME_MAX_CHARGES) {
      this.refillIn -= h;
      if (this.refillIn <= 0) {
        this.charges++;
        this.refillIn = this.charges < DOME_MAX_CHARGES ? DOME_REFILL_SECONDS : 0;
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
    row.name = this.domeHp > 0 ? `Q DOME [${Math.ceil(this.domeHp)}]` : 'Q BUNKER DOME';
    row.ammo = this.charges;
    row.max = DOME_MAX_CHARGES;
    row.reload = this.charges < DOME_MAX_CHARGES ? 1 - this.refillIn / DOME_REFILL_SECONDS : -1;
  }

  reset(): void {
    this.charges = DOME_MAX_CHARGES;
    this.refillIn = 0;
    this.lockout = 0;
    this.domeHp = 0;
    this.domeTimer = 0;
    this.visual.domePos = null;
    this.visual.domeAlpha = 0;
  }
}

export const DOME_EXPANSION: ExpansionPlugin = {
  kind: 'dome',
  create: (_ctx: Ctx) => new DomeExpansion(),
  remoteNews(ctx: Ctx, values: number[]): void {
    playDomeFx(ctx, values[1] ?? 0, values[2] ?? 0, values[3] ?? 0);
  },
};
