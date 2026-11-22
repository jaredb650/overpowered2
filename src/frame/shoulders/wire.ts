/** Guided Heavy Missile shoulder plug-in — Phase 0 placeholder (Lane F replaces). */
import type { GunnerWeapon } from '../../vehicles/hud';
import type { FrameShoulderWeapon, ShoulderPlugin } from './types';

class WirePlaceholder implements FrameShoulderWeapon {
  readonly kind = 'wire' as const;
  update(): void {}
  idleUpdate(): void {}
  fillRow(row: GunnerWeapon, keyLabel: string): void {
    row.name = `${keyLabel} GUIDED MISSILE // NOT FITTED`;
    row.ammo = 0;
    row.max = 1;
    row.reload = -1;
  }
  reset(): void {}
}

export const WIRE_PLUGIN: ShoulderPlugin = {
  kind: 'wire',
  newsKinds: ['wire'],
  create: () => new WirePlaceholder(),
};
