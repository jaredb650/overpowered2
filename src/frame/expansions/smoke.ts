/** Default Core Expansion (`expSmoke`): delegates `Q` directly to standard Smoke & Flares. */
import type { Ctx } from '../../core/contracts';
import type { GunnerWeapon } from '../../vehicles/hud';
import type { ExpansionContext, ExpansionPlugin, ExpansionVisualState, FrameExpansion } from './types';

class SmokeExpansion implements FrameExpansion {
  readonly kind = 'smoke' as const;
  readonly visual: ExpansionVisualState = {
    novaProgress: 0,
    aegisAlpha: 0,
    terminalActive: false,
    domePos: null,
    domeAlpha: 0,
  };

  trigger(u: ExpansionContext): boolean {
    return u.popSmoke();
  }

  update(_dt: number, _u: ExpansionContext): void {}
  idleUpdate(_dt: number): void {}
  fillRow(_row: GunnerWeapon): void {
    // FrameGuns fills the standard Q SMOKE row directly from `this.smoke` when `kind === 'smoke'`.
  }
  reset(): void {}
}

export const SMOKE_EXPANSION: ExpansionPlugin = {
  kind: 'smoke',
  create: (_ctx: Ctx) => new SmokeExpansion(),
};
