/**
 * Bomblet Cannon arm weapon plug-in — Phase 0 placeholder (fires 40 mm HE until Lane C replaces this file).
 */
import type { Ctx } from '../../core/contracts';
import { Magazine } from '../../progression/callins/ac130Guns';
import type { GunnerWeapon } from '../../vehicles/hud';
import { FRAME } from '../data';
import { fireCannon40Shell } from './shared';
import type { ArmPlugin, ArmUpdateContext, FrameArmGun } from './types';

const C = FRAME.cannon;

class ClusterPlaceholder implements FrameArmGun {
  readonly kind = 'cluster' as const;
  private readonly mag = new Magazine(C.magazine, C.reload, C.interval);

  constructor(private readonly ctx: Ctx) {}

  get firing(): boolean {
    return false;
  }

  update(dt: number, u: ArmUpdateContext): void {
    this.mag.update(dt);
    if (u.held && this.mag.ready && this.mag.take()) fireCannon40Shell(u, 'g40');
    else if (u.pressed && this.mag.ammo === 0) this.ctx.audio.play('weapon_dry');
  }

  idleUpdate(dt: number): void {
    this.mag.update(dt);
  }

  fillRow(row: GunnerWeapon, button: string): void {
    row.name = `${button} BOMBLET CANNON`;
    row.ammo = this.mag.ammo;
    row.max = C.magazine;
    row.reload = this.mag.progress;
    row.selected = false;
  }

  silence(): void {}

  reset(): void {
    this.mag.ammo = this.mag.size;
    this.mag.reloading = -1;
  }
}

export const CLUSTER_PLUGIN: ArmPlugin = {
  kind: 'cluster',
  newsKinds: ['cluster'],
  create: ctx => new ClusterPlaceholder(ctx),
};
