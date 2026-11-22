/** Metal Storm Pod shoulder plug-in — Phase 0 placeholder (Lane E replaces). */
import type { GunnerWeapon } from '../../vehicles/hud';
import type { FrameShoulderWeapon, ShoulderPlugin } from './types';

class StormPlaceholder implements FrameShoulderWeapon {
  readonly kind = 'storm' as const;
  update(): void {}
  idleUpdate(): void {}
  fillRow(row: GunnerWeapon, keyLabel: string): void {
    row.name = `${keyLabel} METAL STORM // NOT FITTED`;
    row.ammo = 0;
    row.max = 8;
    row.reload = -1;
  }
  reset(): void {}
}

export const STORM_PLUGIN: ShoulderPlugin = {
  kind: 'storm',
  newsKinds: ['storm'],
  create: () => new StormPlaceholder(),
};
