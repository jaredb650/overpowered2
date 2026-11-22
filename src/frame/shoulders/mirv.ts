/** MIRV Launcher shoulder plug-in — Phase 0 placeholder (Lane F replaces). */
import type { GunnerWeapon } from '../../vehicles/hud';
import type { FrameShoulderWeapon, ShoulderPlugin } from './types';

class MirvPlaceholder implements FrameShoulderWeapon {
  readonly kind = 'mirv' as const;
  update(): void {}
  idleUpdate(): void {}
  fillRow(row: GunnerWeapon, keyLabel: string): void {
    row.name = `${keyLabel} MIRV // NOT FITTED`;
    row.ammo = 0;
    row.max = 1;
    row.reload = -1;
  }
  reset(): void {}
}

export const MIRV_PLUGIN: ShoulderPlugin = {
  kind: 'mirv',
  newsKinds: ['mirv'],
  create: () => new MirvPlaceholder(),
};
