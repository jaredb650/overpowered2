/** FPV Drone Hive shoulder plug-in — Phase 0 placeholder (Lane H replaces). */
import type { GunnerWeapon } from '../../vehicles/hud';
import type { FrameShoulderWeapon, ShoulderPlugin } from './types';

class FpvPlaceholder implements FrameShoulderWeapon {
  readonly kind = 'fpv' as const;
  update(): void {}
  idleUpdate(): void {}
  fillRow(row: GunnerWeapon, keyLabel: string): void {
    row.name = `${keyLabel} FPV HIVE // NOT FITTED`;
    row.ammo = 0;
    row.max = 4;
    row.reload = -1;
  }
  reset(): void {}
}

export const FPV_PLUGIN: ShoulderPlugin = {
  kind: 'fpv',
  newsKinds: ['fpv'],
  create: () => new FpvPlaceholder(),
};
