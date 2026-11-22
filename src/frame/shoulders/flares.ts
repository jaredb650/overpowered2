/**
 * Countermeasure Rack shoulder plug-in (`flares`).
 *
 *   Smoke upgrade   Exposes `smokeModifier = { maxCharges: 6, refillSeconds: 7, screenScale: 1.5 }`
 *                   so the Frame's Q smoke gets 6 charges (up from 3), 7 s refill (down from 14 s),
 *                   and a 1.5× wider/longer smoke wall.
 *   Auto-flares     Watches incoming enemy missiles/rockets via `ctx.combat.hasIncomingEnemyMissile`
 *                   and automatically calls `u.popFreeFlares()` (zero Q charges spent) once every 5.0 s.
 */
import type { Ctx } from '../../core/contracts';
import { clamp } from '../../core/math';
import type { GunnerWeapon } from '../../vehicles/hud';
import type { FrameShoulderWeapon, ShoulderPlugin, ShoulderUpdateContext, SmokeModifier } from './types';

export const FLARES_AUTO_COOLDOWN = 5.0;
export const FLARES_DETECT_RADIUS = 45;

export const FLARES_SMOKE_MODIFIER: Readonly<SmokeModifier> = {
  maxCharges: 6,
  refillSeconds: 7,
  screenScale: 1.5,
};

export class FlaresShoulder implements FrameShoulderWeapon {
  readonly kind = 'flares' as const;
  readonly smokeModifier: SmokeModifier = FLARES_SMOKE_MODIFIER;
  private cooldown = 0;

  constructor(private readonly ctx: Ctx) {}

  /** Remaining seconds on the 5.0 s auto-flare cooldown (0 when ready). */
  get cooldownRemaining(): number {
    return this.cooldown;
  }

  /** True when auto-flares are ready to trigger on the next incoming missile. */
  get ready(): boolean {
    return this.cooldown <= 1e-6;
  }

  update(dt: number, u: ShoulderUpdateContext): void {
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    if (!u.online || this.cooldown > 1e-6) return;

    if (this.ctx.combat.hasIncomingEnemyMissile?.(u.feet, FLARES_DETECT_RADIUS)) {
      u.popFreeFlares();
      this.cooldown = FLARES_AUTO_COOLDOWN;
      this.ctx.audio?.play?.('quiver_lock', { position: u.feet, pitch: 1.5, volume: 0.45 });
    }
  }

  idleUpdate(dt: number): void {
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
  }

  fillRow(row: GunnerWeapon, _keyLabel: string, _cycleKeyLabel: string, online: boolean): void {
    row.max = 1;
    if (!online) {
      row.name = 'CM RACK AUTO-FLARE // OFFLINE';
      row.ammo = 0;
      row.reload = -1;
      return;
    }
    row.name = 'CM RACK AUTO-FLARE';
    if (this.ready) {
      row.ammo = 1;
      row.reload = -1;
    } else {
      row.ammo = 0;
      row.reload = clamp(1 - this.cooldown / FLARES_AUTO_COOLDOWN, 0, 1);
    }
  }

  reset(): void {
    this.cooldown = 0;
  }
}

export const FLARES_PLUGIN: ShoulderPlugin = {
  kind: 'flares',
  create: ctx => new FlaresShoulder(ctx),
};
