/** Point Defence active protection turret plug-in — Phase 0 placeholder (Lane H replaces). */
import type { GunnerWeapon } from '../../vehicles/hud';
import type { FrameShoulderWeapon, ShoulderPlugin } from './types';

class PointDefPlaceholder implements FrameShoulderWeapon {
  readonly kind = 'pointdef' as const;
  update(): void {}
  idleUpdate(): void {}
  fillRow(row: GunnerWeapon): void {
    row.name = 'APS // NOT FITTED';
    row.ammo = 0;
    row.max = 6;
    row.reload = -1;
  }
  reset(): void {}
}

export const POINTDEF_PLUGIN: ShoulderPlugin = {
  kind: 'pointdef',
  newsKinds: ['pointdef'],
  create: () => new PointDefPlaceholder(),
};
