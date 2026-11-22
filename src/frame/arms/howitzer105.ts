/**
 * 105 mm Siege Howitzer arm weapon plug-in: single massive artillery shell with weighty 3.1 s auto-reload.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import { rand, randomInCone } from '../../core/math';
import { Magazine } from '../../progression/callins/ac130Guns';
import type { GunnerWeapon } from '../../vehicles/hud';
import { FRAME } from '../data';
import { NEAR_SIGHT } from './shared';
import type { ArmPlugin, ArmUpdateContext, FrameArmGun } from './types';

const H = FRAME.howitzer;
const _muzzle = new THREE.Vector3();
const _bore = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _v = new THREE.Vector3();
const _at = new THREE.Vector3();

/** Pure clock for the 105 mm siege howitzer. */
export class Howitzer {
  readonly mag = new Magazine(H.magazine, H.reload, H.interval);

  reset(): void {
    this.mag.ammo = this.mag.size;
    this.mag.reloading = -1;
  }
}

export class Howitzer105ArmGun implements FrameArmGun {
  readonly kind = 'howitzer105' as const;
  readonly clock = new Howitzer();

  constructor(private readonly ctx: Ctx) {}

  get firing(): boolean {
    return false;
  }

  update(dt: number, u: ArmUpdateContext): void {
    const { audio } = this.ctx;
    const mag = this.clock.mag;
    const loading = mag.reloading >= 0;
    mag.update(dt);
    if (loading && mag.reloading < 0) {
      audio.play('reload_shell_in', { volume: 1.0, pitch: 0.52 });
      audio.play('metal_clang', { volume: 0.85, pitch: 0.58 });
    }
    if (u.held && mag.ready) this.fire(u);
    else if (u.pressed && mag.ammo === 0) audio.play('weapon_dry', { pitch: 0.72 });
  }

  idleUpdate(dt: number): void {
    this.clock.mag.update(dt);
  }

  fillRow(row: GunnerWeapon, button: string): void {
    const mag = this.clock.mag;
    row.name = `${button} 105MM HOWITZER`;
    row.ammo = mag.ammo;
    row.max = H.magazine;
    row.reload = mag.progress;
    row.selected = true;
  }

  silence(): void {
    // No looping audio.
  }

  reset(): void {
    this.clock.reset();
  }

  private fire(u: ArmUpdateContext): void {
    const { audio, camera, fx, render } = this.ctx;
    if (!this.clock.mag.take()) return;
    u.arm.muzzle(_muzzle);
    u.arm.bore(_bore);
    if (u.sight.range > NEAR_SIGHT) _aim.copy(u.sight.point);
    else _aim.copy(_muzzle).addScaledVector(_bore, 80);
    randomInCone(_dir.subVectors(_aim, _muzzle).normalize(), H.spread, _dir);
    const reach = _muzzle.distanceTo(_aim);
    _aim.copy(_muzzle).addScaledVector(_dir, reach);
    u.rounds.fire('g105', _muzzle, _aim, reach / H.speed, 0, Infinity);
    u.onShell?.('g105', _muzzle, _aim, reach / H.speed, u.side);
    u.rounds.flash(_muzzle, 3.4, 0.12, 12, 8.5, 4, 2.2);
    fx.muzzleFlash(_muzzle, _bore, 'autocannon');
    fx.vaporRing?.(_v.copy(_muzzle).addScaledVector(_bore, 1.0), _bore, 1.8);
    fx.vaporRing?.(_v.copy(_muzzle).addScaledVector(_bore, 2.8), _bore, 1.35);
    fx.ring(_v.copy(_muzzle).addScaledVector(_bore, 0.8), _bore, '#ffaa44', 3.4);
    fx.smoke(_v.copy(_muzzle).addScaledVector(_bore, 3.6), 0x9aa0a6, 2.6, 1.8);
    fx.sparks(_v.copy(_muzzle).addScaledVector(_bore, 0.6), _bore, 24, '#ffcc66');
    _v.set(-_bore.z, 0, _bore.x).multiplyScalar(3.4);
    _v.y = rand(2.2, 3.6);
    fx.shellCasing(_at.copy(_muzzle).addScaledVector(_bore, -2.8), _v, 'cannon');
    render?.lights?.flash?.(_muzzle, 0xffaa44, 9, 16, 0.14);
    audio.play('howitzer_shot', { volume: 1.35, pitch: 0.96 });
    u.arm.recoil(1.15);
    if (u.recoilMult > 0) {
      camera.addTrauma(H.trauma * u.recoilMult);
      camera.kick(H.kick * u.recoilMult, rand(-0.012, 0.012) * u.recoilMult);
    }
  }
}

export const HOWITZER105_PLUGIN: ArmPlugin = {
  kind: 'howitzer105',
  create: ctx => new Howitzer105ArmGun(ctx),
};
