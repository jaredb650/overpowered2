/**
 * 40 mm Autocannon arm weapon plug-in.
 * Tap `1` (left arm) or `2` (right arm) cycles HE, AP, and FLAK. `R` triggers an early manual reload (never cycles ammo).
 */
import type { Ctx } from '../../core/contracts';
import { Magazine, type Round40 } from '../../progression/callins/ac130Guns';
import type { GunnerWeapon } from '../../vehicles/hud';
import { FRAME } from '../data';
import { ROUNDS_40, ROUND_NAMES, fireCannon40Shell } from './shared';
import type { ArmPlugin, ArmUpdateContext, FrameArmGun } from './types';

const C = FRAME.cannon;

/** Pure clock for the 40 mm autocannon: magazine + active shell type. */
export class Cannon {
  readonly mag = new Magazine(C.magazine, C.reload, C.interval);
  round: Round40 = 'g40';

  cycle(): void {
    this.round = ROUNDS_40[(ROUNDS_40.indexOf(this.round) + 1) % ROUNDS_40.length]!;
  }

  /** Starts a manual reload when partially spent (never cycles ammo). Returns true if a reload began. */
  startReload(): boolean {
    if (this.mag.reloading >= 0 || this.mag.ammo >= this.mag.size) return false;
    this.mag.ammo = 0;
    this.mag.reloading = this.mag.reload;
    return true;
  }

  reset(): void {
    this.mag.ammo = this.mag.size;
    this.mag.reloading = -1;
    this.round = 'g40';
  }
}

export class Cannon40ArmGun implements FrameArmGun {
  readonly kind = 'cannon40' as const;
  readonly clock = new Cannon();

  constructor(private readonly ctx: Ctx) {}

  get firing(): boolean {
    return false;
  }

  update(dt: number, u: ArmUpdateContext): void {
    const { audio } = this.ctx;
    const mag = this.clock.mag;
    const loading = mag.reloading >= 0;
    mag.update(dt);
    if (loading && mag.reloading < 0) audio.play('reload_shell_in', { volume: 0.8, pitch: 0.8 });
    if (u.cyclePressed) {
      this.clock.cycle();
      audio.play('reload_bolt', { pitch: 0.75 });
    }
    if (u.reloadPressed && this.clock.startReload()) {
      audio.play('reload_bolt', { pitch: 0.68, volume: 0.75 });
    }
    if (u.held && mag.ready && mag.take()) fireCannon40Shell(u, this.clock.round);
    else if (u.pressed && mag.ammo === 0) audio.play('weapon_dry');
  }

  idleUpdate(dt: number): void {
    this.clock.mag.update(dt);
  }

  fillRow(row: GunnerWeapon, button: string, cycleKey: string): void {
    const mag = this.clock.mag;
    row.name = `${button} 40MM ${ROUND_NAMES[this.clock.round]} // ${cycleKey}`;
    row.ammo = mag.ammo;
    row.max = C.magazine;
    row.reload = mag.progress;
    row.selected = false;
  }

  silence(): void {
    // No looping audio.
  }

  reset(): void {
    this.clock.reset();
  }
}

export const CANNON40_PLUGIN: ArmPlugin = {
  kind: 'cannon40',
  create: ctx => new Cannon40ArmGun(ctx),
};
