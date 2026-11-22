/** Mortar Rack shoulder plug-in — Phase 0 placeholder (Lane C replaces). */
import type { GunnerWeapon } from '../../vehicles/hud';
import type { FrameShoulderWeapon, ShoulderPlugin, ShoulderUpdateContext } from './types';

const ROUNDS = ['HE', 'WP', 'CLUSTER'] as const;

class MortarPlaceholder implements FrameShoulderWeapon {
  readonly kind = 'mortar' as const;
  readonly hasCycle = true;
  private roundIndex = 0;

  update(_dt: number, u: ShoulderUpdateContext): void {
    if (u.cyclePressed) {
      this.roundIndex = (this.roundIndex + 1) % ROUNDS.length;
    }
  }
  idleUpdate(): void {}
  fillRow(row: GunnerWeapon, keyLabel: string, cycleKeyLabel: string): void {
    row.name = `${keyLabel} MORTAR ${ROUNDS[this.roundIndex]!} // ${cycleKeyLabel} (NOT FITTED)`;
    row.ammo = 0;
    row.max = 6;
    row.reload = -1;
  }
  reset(): void {
    this.roundIndex = 0;
  }
}

export const MORTAR_PLUGIN: ShoulderPlugin = {
  kind: 'mortar',
  newsKinds: ['mortar'],
  create: () => new MortarPlaceholder(),
};
