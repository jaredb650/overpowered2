/**
 * Last-Stand Fuse Core Expansion (`expTerminal`, passive safety net).
 * - 1 charge, 45 s recharge. Cannot be wasted manually: pressing `Q` displays its armed/recharging status and returns `false`.
 * - When `absorbDamage` intercepts a lethal hit (`damage >= currentHp`) while ready, it automatically fires:
 *   clamps hull HP to `1` (returns `Math.max(0, currentHp - 1)`), wraps the Frame in a blazing crimson `2500 HP`
 *   emergency shield for `5.5 s`, blasts back enemies within `10 m` for `250 dmg`, sets `visual.terminalActive = true`
 *   and `visual.aegisAlpha`, and broadcasts `onNews('expansion', [4, x, y, z])`.
 */
import * as THREE from 'three';
import type { Ctx, DamageInfo } from '../../core/contracts';
import type { EnemyInstance } from '../../core/gameplay';
import { clamp } from '../../core/math';
import type { GunnerWeapon } from '../../vehicles/hud';
import type { ExpansionContext, ExpansionPlugin, ExpansionVisualState, FrameExpansion } from './types';

export const TERMINAL_MAX_CHARGES = 1;
export const TERMINAL_REFILL_SECONDS = 45;
export const TERMINAL_SHIELD_HP = 2500;
export const TERMINAL_DURATION = 5.5;
export const TERMINAL_BLAST_RADIUS = 10;
export const TERMINAL_BLAST_DAMAGE = 250;
export const TERMINAL_BLAST_FORCE = 900;

const UP = new THREE.Vector3(0, 1, 0);
const _center = new THREE.Vector3();
const _hits: EnemyInstance[] = [];
const _dmg: DamageInfo = {
  amount: TERMINAL_BLAST_DAMAGE,
  type: 'explosive',
  point: new THREE.Vector3(),
  dir: new THREE.Vector3(),
  force: TERMINAL_BLAST_FORCE,
  source: 'frame_terminal',
  gib: false,
};

function playTerminalFx(ctx: Ctx, x: number, y: number, z: number): void {
  _center.set(x, y + 2.2, z);
  ctx.fx?.ring?.(_center, UP, '#ff2838', TERMINAL_BLAST_RADIUS);
  ctx.fx?.slam?.(_center.clone().setY(y), 1.15);
  ctx.fx?.sparks?.(_center, UP, 24, '#ff5060');
  ctx.render?.lights?.flash?.(_center, '#ff2438', 16, 20, 0.4);
  ctx.audio?.play?.('orbital_strike', { position: _center, pitch: 0.92, volume: 0.9 });
}

class TerminalExpansion implements FrameExpansion {
  readonly kind = 'terminal' as const;
  readonly visual: ExpansionVisualState = {
    novaProgress: 0,
    aegisAlpha: 0,
    terminalActive: false,
    domePos: null,
    domeAlpha: 0,
  };

  private charges = TERMINAL_MAX_CHARGES;
  private refillIn = 0;
  private shieldHp = 0;
  private shieldTimer = 0;

  trigger(u: ExpansionContext): boolean {
    // Passive safety net: never wasted on manual Q press — show status notification instead.
    if (this.shieldTimer > 0 && this.shieldHp > 0) {
      u.ctx.hud?.feed?.(`LAST-STAND FUSE ACTIVE — ${this.shieldTimer.toFixed(1)}s`, '#ff2838');
    } else if (this.charges > 0) {
      u.ctx.hud?.feed?.('LAST-STAND FUSE ARMED (AUTO-TRIGGERS ON LETHAL HIT)', '#ff6040');
    } else {
      u.ctx.hud?.feed?.(`LAST-STAND FUSE RECHARGING (${Math.ceil(this.refillIn)}s)`, '#ff9040');
    }
    return false;
  }

  absorbDamage(damage: number, currentHp: number, _from: THREE.Vector3 | undefined, u: ExpansionContext): number {
    if (damage <= 0) return damage;

    // If emergency crimson shield is already active, absorb incoming damage from the 2500 HP pool.
    if (this.shieldTimer > 0 && this.shieldHp > 0) {
      const absorbed = Math.min(this.shieldHp, damage);
      this.shieldHp -= absorbed;
      const remaining = damage - absorbed;
      if (this.shieldHp <= 0) {
        this.shieldHp = 0;
        this.shieldTimer = 0;
        this.visual.terminalActive = false;
        this.visual.aegisAlpha = 0;
        u.ctx.audio?.play?.('glass_break', { pitch: 0.85, volume: 0.72 });
        u.ctx.hud?.feed?.('LAST-STAND SHIELD DEPLETED', '#ff4030');
      } else {
        this.syncAlpha();
        u.ctx.audio?.play?.('metal_clang', { pitch: 1.65, volume: 0.28 });
      }
      return remaining;
    }

    // Automatic lethal-hit trigger: clamp hull HP to 1, raise 2500 HP crimson emergency shield, blast back 10 m!
    if (damage >= currentHp && this.charges > 0) {
      this.charges--;
      this.refillIn = TERMINAL_REFILL_SECONDS;
      this.shieldHp = TERMINAL_SHIELD_HP;
      this.shieldTimer = TERMINAL_DURATION;
      this.visual.terminalActive = true;
      this.visual.aegisAlpha = 1;

      u.clearSapper();
      _center.set(u.feet.x, u.feet.y + 2.2, u.feet.z);

      const enemies = u.ctx.enemies;
      if (enemies && typeof enemies.query === 'function') {
        const n = Math.min(enemies.query(_center, TERMINAL_BLAST_RADIUS, _hits) || 0, _hits.length);
        for (let i = 0; i < n; i++) {
          const e = _hits[i]!;
          if (!e.alive) continue;
          const dx = e.position.x - u.feet.x;
          const dz = e.position.z - u.feet.z;
          const dist = Math.hypot(dx, dz);
          if (dist > TERMINAL_BLAST_RADIUS) continue;
          _dmg.amount = TERMINAL_BLAST_DAMAGE;
          _dmg.force = TERMINAL_BLAST_FORCE;
          _dmg.point.copy(e.center ?? e.position);
          _dmg.dir.set(dx, 0, dz);
          if (_dmg.dir.lengthSq() < 1e-4) _dmg.dir.set(1, 0, 0);
          _dmg.dir.normalize().setY(0.6).normalize();
          enemies.applyDamage(e, _dmg);
        }
        _hits.length = 0;
      }

      playTerminalFx(u.ctx, u.feet.x, u.feet.y, u.feet.z);
      u.ctx.camera?.addTrauma?.(0.48);
      u.ctx.render?.post?.flash?.('#ff2238', 0.45, 0.35);
      u.ctx.hud?.callout?.('LAST-STAND FUSE TRIGGERED');
      u.ctx.hud?.feed?.(`LAST-STAND FUSE ACTIVE — ${TERMINAL_DURATION.toFixed(1)}s`, '#ff2838');
      u.onNews?.('expansion', [4, u.feet.x, u.feet.y, u.feet.z]);

      // Clamp surviving hull HP cleanly to 1.
      return Math.max(0, currentHp - 1);
    }

    return damage;
  }

  private syncAlpha(): void {
    if (this.shieldHp <= 0 || this.shieldTimer <= 0) {
      this.visual.terminalActive = false;
      this.visual.aegisAlpha = 0;
      return;
    }
    const hpShare = this.shieldHp / TERMINAL_SHIELD_HP;
    const timeFade = Math.min(1, this.shieldTimer);
    this.visual.aegisAlpha = clamp((0.35 + 0.65 * hpShare) * timeFade, 0, 1);
  }

  private tick(dt: number): void {
    const h = Math.max(0, dt);
    if (this.shieldTimer > 0) {
      this.shieldTimer = Math.max(0, this.shieldTimer - h);
      if (this.shieldTimer <= 0) {
        this.shieldHp = 0;
        this.visual.terminalActive = false;
        this.visual.aegisAlpha = 0;
      } else {
        this.syncAlpha();
      }
    }
    if (this.charges < TERMINAL_MAX_CHARGES) {
      this.refillIn -= h;
      if (this.refillIn <= 0) {
        this.charges++;
        this.refillIn = 0;
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
    if (this.shieldTimer > 0 && this.shieldHp > 0) {
      row.name = `LAST-STAND [${Math.ceil(this.shieldHp)}]`;
      row.ammo = Math.ceil(this.shieldTimer);
      row.max = Math.ceil(TERMINAL_DURATION);
      row.reload = this.shieldTimer / TERMINAL_DURATION;
      return;
    }
    row.name = this.charges > 0 ? 'PASSIVE LAST-STAND [ARMED]' : 'PASSIVE LAST-STAND';
    row.ammo = this.charges;
    row.max = TERMINAL_MAX_CHARGES;
    row.reload = this.charges < TERMINAL_MAX_CHARGES ? 1 - this.refillIn / TERMINAL_REFILL_SECONDS : -1;
  }

  reset(): void {
    this.charges = TERMINAL_MAX_CHARGES;
    this.refillIn = 0;
    this.shieldHp = 0;
    this.shieldTimer = 0;
    this.visual.terminalActive = false;
    this.visual.aegisAlpha = 0;
  }
}

export const TERMINAL_EXPANSION: ExpansionPlugin = {
  kind: 'terminal',
  create: (_ctx: Ctx) => new TerminalExpansion(),
  remoteNews(ctx: Ctx, values: number[]): void {
    playTerminalFx(ctx, values[1] ?? 0, values[2] ?? 0, values[3] ?? 0);
  },
};
