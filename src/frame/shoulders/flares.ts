/** Countermeasure Rack shoulder plug-in — Phase 0 placeholder (Lane H replaces). */
import type { GunnerWeapon } from '../../vehicles/hud';
import type { FrameShoulderWeapon, ShoulderPlugin } from './types';

class FlaresPlaceholder implements FrameShoulderWeapon {
  readonly kind = 'flares' as const;
  update(): void {}
  idleUpdate(): void {}
  fillRow(row: GunnerWeapon): void {
    row.name = 'COUNTERMEASURES // NOT FITTED';
    row.ammo = 0;
    row.max = 6;
    row.reload = -1;
  }
  reset(): void {}
}

export const FLARES_PLUGIN: ShoulderPlugin = {
  kind: 'flares',
  create: () => new FlaresPlaceholder(),
};
