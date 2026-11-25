/**
 * Hydraulic Pile Bunker arm weapon plug-in (`src/frame/arms/bunker.ts`).
 *
 *   - Tap (< 0.5 s): quick hydraulic shove-jab (`5.5 m` reach, `260` dmg, `140` knockback force, `0.65 s` cooldown)
 *     that sends enemies flying.
 *   - Hold (>= 0.5 s) & Release: Explosive Pile Bunker Drive! Forward lunge (`u.lungeImpulse?.(fwd, 32, 0.2)`),
 *     massive `920` dmg single-point armour-piercing spike (`6.5 m` reach, `220` force, `+2.0x` stagger/vehicle blow
 *     via `ctx.enemies.vehicles?.frameBlow`, giant conical shockwave + sparks + trauma `0.75`), `2.2 s` hydraulic
 *     recharge/vent cooldown.
 *   - Drives physical piston slam via `u.arm.recoil(-1.6)`, `u.arm.setPose`, and thermal charge glow via `u.arm.setActive`.
 */
import * as THREE from 'three';
import type { Ctx, DamageInfo, LoopHandle, PlayOptions } from '../../core/contracts';
import type { EnemyInstance } from '../../core/gameplay';
import { clamp, rand } from '../../core/math';
import type { MechKind } from '../../progression/callins/link';
import type { GunnerWeapon } from '../../vehicles/hud';
import type { ArmPlugin, ArmUpdateContext, FrameArmGun } from './types';

export const PILE_BUNKER = {
  /** Hold duration in seconds required to arm the explosive Pile Bunker Drive. */
  chargeThreshold: 0.5,
  jab: {
    reach: 5.5,
    damage: 260,
    force: 140,
    cooldown: 0.65,
    coneCos: 0.45,
    recoilExtend: -0.85,
  },
  drive: {
    reach: 6.5,
    damage: 920,
    force: 220,
    cooldown: 2.2,
    lungeSpeed: 32,
    lungeDuration: 0.2,
    /** +2.0x vehicle/stagger blow multiplier for `enemies.vehicles?.frameBlow`. */
    vehicleBlowMult: 2.0,
    coneCos: 0.62,
    recoilExtend: -1.6,
    trauma: 0.75,
  },
} as const;

const _origin = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _tip = new THREE.Vector3();
const _ringAt = new THREE.Vector3();
const _to = new THREE.Vector3();
const _enemies: EnemyInstance[] = [];
const _play: PlayOptions = {};

function flatForward(aim: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  out.set(aim.x, 0, aim.z);
  if (out.lengthSq() < 1e-5) out.set(0, 0, -1);
  return out.normalize();
}

export class BunkerArmGun implements FrameArmGun {
  readonly kind = 'bunker' as const;

  private holding = false;
  private holdTime = 0;
  private armedNotified = false;
  private cooldown = 0;
  private maxCooldown: number = PILE_BUNKER.jab.cooldown;
  private slamAnim = 0;
  private slamWasCharged = false;
  private chargeLoop: LoopHandle | null = null;

  constructor(private readonly ctx: Ctx) {}

  get firing(): boolean {
    return this.slamAnim > 0;
  }

  /** Normalized charge ratio `0..1` while holding (or venting cooldown bar). */
  get heat(): number {
    if (this.holding) return clamp(this.holdTime / PILE_BUNKER.chargeThreshold);
    if (this.cooldown > 0) return clamp(this.cooldown / this.maxCooldown);
    return 0;
  }

  /** Remaining hydraulic recharge / vent cooldown in seconds. */
  get cooldownRemaining(): number {
    return this.cooldown;
  }

  /** True when the pilot has held >= 0.5 s and the explosive charge is armed. */
  get chargedArmed(): boolean {
    return this.holding && this.holdTime >= PILE_BUNKER.chargeThreshold;
  }

  update(dt: number, u: ArmUpdateContext): void {
    const { audio } = this.ctx;

    if (this.cooldown > 0) {
      const wasCooling = this.cooldown > 0;
      this.cooldown = Math.max(0, this.cooldown - dt);
      if (wasCooling && this.cooldown === 0) {
        audio?.play?.('reload_shell_in', { volume: 0.72, pitch: 0.7 });
      }
    }

    if (this.slamAnim > 0) {
      this.slamAnim = Math.max(0, this.slamAnim - dt);
    }

    if (this.cooldown > 0) {
      this.holding = false;
      this.holdTime = 0;
      this.armedNotified = false;
      this.stopChargeAudio();
      if (u.pressed) audio?.play?.('weapon_dry', { pitch: 0.68 });
      this.poseArm(u);
      return;
    }

    if (u.pressed && !this.holding) {
      this.holding = true;
      this.holdTime = 0;
      this.armedNotified = false;
      audio?.play?.('reload_bolt', { pitch: 0.68, volume: 0.65 });
    }

    if (this.holding && u.held) {
      this.holdTime += dt;
      if (this.holdTime >= 0.14 && !this.chargeLoop) {
        this.startChargeAudio();
      }
      const ratio = clamp(this.holdTime / PILE_BUNKER.chargeThreshold);
      this.chargeLoop?.setPitch(0.55 + ratio * 0.65, 0.05);
      if (!this.armedNotified && this.holdTime >= PILE_BUNKER.chargeThreshold) {
        this.armedNotified = true;
        audio?.play?.('railgun_ready', { pitch: 0.78, volume: 0.9 });
      }
    } else if (this.holding && !u.held) {
      const heldFor = this.holdTime;
      this.holding = false;
      this.holdTime = 0;
      this.armedNotified = false;
      this.stopChargeAudio();

      if (heldFor >= PILE_BUNKER.chargeThreshold) {
        this.fireExplosiveDrive(u);
      } else {
        this.fireQuickJab(u);
      }
    }

    this.poseArm(u);
  }

  idleUpdate(dt: number): void {
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.slamAnim > 0) this.slamAnim = Math.max(0, this.slamAnim - dt);
  }

  fillRow(row: GunnerWeapon, button: string): void {
    const status = this.cooldown > 0
      ? 'VENTING'
      : this.chargedArmed
        ? 'ARMED'
        : this.holding
          ? 'PRESSURIZING'
          : 'READY';
    row.name = `${button} PILE BUNKER [${status}]`;
    row.ammo = this.cooldown > 0 ? 0 : 1;
    row.max = 1;
    row.reload = this.cooldown > 0 ? clamp(1 - this.cooldown / this.maxCooldown) : -1;
    row.selected = this.chargedArmed;
  }

  silence(): void {
    this.stopChargeAudio();
  }

  reset(): void {
    this.silence();
    this.holding = false;
    this.holdTime = 0;
    this.armedNotified = false;
    this.cooldown = 0;
    this.maxCooldown = PILE_BUNKER.jab.cooldown;
    this.slamAnim = 0;
    this.slamWasCharged = false;
  }

  private fireQuickJab(u: ArmUpdateContext): void {
    const J = PILE_BUNKER.jab;
    const { audio, camera, enemies, fx, hud, physics, world, combat } = this.ctx;

    this.resolveOrigin(u, _origin);
    flatForward(u.sight.aim, _fwd);
    _tip.copy(_origin).addScaledVector(_fwd, J.reach * 0.72);

    const count = Math.min(enemies?.query?.(_origin, J.reach + 2, _enemies) || 0, _enemies.length);
    let struck = 0;
    for (let i = 0; i < count; i++) {
      const e = _enemies[i]!;
      if (!e.alive) continue;
      _to.subVectors(e.center, _origin);
      const dist = _to.length();
      if (dist > J.reach + 0.9) continue;
      if (dist > 1.6) {
        const horiz = Math.hypot(_to.x, _to.z) || 1;
        if ((_to.x * _fwd.x + _to.z * _fwd.z) / horiz < J.coneCos) continue;
      }
      const dmg: DamageInfo = {
        amount: J.damage,
        type: 'melee',
        point: e.center.clone(),
        dir: _fwd.clone().setY(0.38).normalize(),
        force: J.force,
        source: 'frame_bunker_jab',
        region: 'chest',
      };
      enemies.applyDamage(e, dmg);
      struck++;
      fx?.sparks?.(e.center, _fwd, 10, '#ffcc77');
    }
    _enemies.length = 0;

    if (struck > 0) hud?.hitMarker?.('body');

    world?.objects?.damageExplosivesInRadius?.(_tip, J.reach * 0.7, J.damage, 'frame_bunker_jab');
    enemies?.vehicles?.frameBlow?.(_tip, J.reach, J.damage, _fwd, 'frame_bunker_jab');
    physics?.radialImpulse?.(_tip, J.reach, J.force);
    combat?.puntEnemyGrenades?.(_tip, J.reach, _origin, 42);

    // Hydraulic piston shove forward.
    u.arm.recoil(J.recoilExtend);
    u.arm.setActive?.(0.45);
    fx?.ring?.(_tip, _fwd, '#ffbb66', 3.4);
    fx?.sparks?.(_tip, _fwd, 18, '#ffcc77');
    audio?.play?.('hit_punch', { pitch: 0.65, volume: 0.95 });
    audio?.play?.('metal_clang', { pitch: 0.9, volume: 0.75 });

    if (u.recoilMult > 0) {
      camera?.addTrauma?.(0.24 * u.recoilMult);
      camera?.kick?.(0.018 * u.recoilMult, rand(-0.006, 0.006) * u.recoilMult);
    }

    this.slamWasCharged = false;
    this.slamAnim = 0.24;
    this.maxCooldown = J.cooldown;
    this.cooldown = J.cooldown;

    u.onNews?.('bunker', [0, _tip.x, _tip.y, _tip.z, _fwd.x, _fwd.y, _fwd.z]);
  }

  private fireExplosiveDrive(u: ArmUpdateContext): void {
    const D = PILE_BUNKER.drive;
    const { audio, camera, enemies, fx, hud, physics, world, render, combat } = this.ctx;

    this.resolveOrigin(u, _origin);
    flatForward(u.sight.aim, _fwd);
    _tip.copy(_origin).addScaledVector(_fwd, D.reach * 0.75);

    // Explosive forward pile-driver lunge.
    u.lungeImpulse?.(_fwd.clone(), D.lungeSpeed, D.lungeDuration);

    const count = Math.min(enemies?.query?.(_origin, D.reach + 2.5, _enemies) || 0, _enemies.length);
    let struck = 0;
    for (let i = 0; i < count; i++) {
      const e = _enemies[i]!;
      if (!e.alive) continue;
      _to.subVectors(e.center, _origin);
      const dist = _to.length();
      if (dist > D.reach + 1.0) continue;
      if (dist > 1.8) {
        const horiz = Math.hypot(_to.x, _to.z) || 1;
        if ((_to.x * _fwd.x + _to.z * _fwd.z) / horiz < D.coneCos) continue;
      }

      const dmg: DamageInfo = {
        amount: D.damage,
        type: 'crush',
        point: e.center.clone(),
        dir: _fwd.clone().setY(0.32).normalize(),
        force: D.force,
        source: 'frame_bunker_charged',
        region: 'chest',
        armorPiercing: true,
        pierces: true,
        gib: true,
        severMult: 3.5,
      };
      enemies.applyDamage(e, dmg);
      struck++;
      fx?.sparks?.(e.center, _fwd, 22, '#ffaa44');
    }
    _enemies.length = 0;

    if (struck > 0) hud?.hitMarker?.('kill');

    // +2.0x stagger / vehicle demolition blow & map explosive shatter.
    world?.objects?.damageExplosivesInRadius?.(_tip, D.reach, D.damage, 'frame_bunker_charged');
    enemies?.vehicles?.frameBlow?.(_tip, D.reach, D.damage * D.vehicleBlowMult, _fwd, 'frame_bunker_charged');
    physics?.radialImpulse?.(_tip, D.reach + 1.5, D.force);
    combat?.puntEnemyGrenades?.(_tip, D.reach + 1.5, _origin, 55);

    // Violently slam the 3.4 m tungsten stake forward (`recoil(-1.6)`).
    u.arm.recoil(D.recoilExtend);
    u.arm.setActive?.(1);

    // Giant conical shockwave rings + directional spark blast + steam vent.
    for (let r = 0; r < 3; r++) {
      _ringAt.copy(_origin).addScaledVector(_fwd, 2.2 + r * 2.0);
      fx?.ring?.(_ringAt, _fwd, r === 0 ? '#fff0c0' : '#ff8c28', 2.6 + r * 2.2);
    }
    fx?.sparks?.(_tip, _fwd, 48, '#ffaa44');
    fx?.slam?.(_tip, 2.8);
    fx?.smoke?.(_tip, 0xd8dce0, 2.8, 1.4);
    render?.lights?.flash?.(_tip, 0xff9933, 18, 16, 0.24);
    render?.post?.radialBlur?.(0.38, 0.24);
    render?.post?.chromatic?.(0.45, 0.18);

    audio?.play?.('railgun_fire', { pitch: 0.56, volume: 1.1 });
    audio?.play?.('slam_impact', { pitch: 0.62, volume: 1.05 });
    audio?.play?.('metal_clang', { pitch: 0.68, volume: 0.95 });
    audio?.play?.('steam_burst', { pitch: 0.85, volume: 0.8 });

    if (u.recoilMult > 0) {
      camera?.addTrauma?.(D.trauma * u.recoilMult);
      camera?.kick?.(0.042 * u.recoilMult, rand(-0.01, 0.01) * u.recoilMult);
      camera?.fovPunch?.(6.5 * u.recoilMult, 0.26);
    }

    this.slamWasCharged = true;
    this.slamAnim = 0.36;
    this.maxCooldown = D.cooldown;
    this.cooldown = D.cooldown;

    u.onNews?.('bunker', [1, _tip.x, _tip.y, _tip.z, _fwd.x, _fwd.y, _fwd.z]);
  }

  private poseArm(u: ArmUpdateContext): void {
    const sideSign = u.side === 'left' ? 1 : -1;

    if (this.slamAnim > 0) {
      const dur = this.slamWasCharged ? 0.36 : 0.24;
      const rem = clamp(this.slamAnim / dur);
      const extend = (this.slamWasCharged ? PILE_BUNKER.drive.recoilExtend : PILE_BUNKER.jab.recoilExtend) * rem;
      u.arm.setPose?.(0, 0.04 * rem, 0, extend);
      u.arm.setActive?.(this.slamWasCharged ? rem : rem * 0.45);
      return;
    }

    if (this.holding) {
      const chargeRatio = clamp(this.holdTime / PILE_BUNKER.chargeThreshold);
      u.arm.setPose?.(0.16 * sideSign * chargeRatio, -0.06 * chargeRatio, 0, 0.38 * chargeRatio);
      u.arm.setActive?.(chargeRatio);
      return;
    }

    u.arm.setPose?.(0, 0, 0, 0);
    u.arm.setActive?.(this.cooldown > 0 ? 0.15 * (this.cooldown / this.maxCooldown) : 0);
  }

  private resolveOrigin(u: ArmUpdateContext, out: THREE.Vector3): THREE.Vector3 {
    if (u.feet) {
      return out.set(u.feet.x, u.feet.y + 2.3, u.feet.z);
    }
    return out.copy(u.sight.view.position);
  }

  private startChargeAudio(): void {
    if (this.chargeLoop) return;
    this.chargeLoop = this.ctx.audio?.startLoop?.('railgun_charge_loop', { pitch: 0.55, volume: 0.32 }) ?? null;
  }

  private stopChargeAudio(): void {
    if (!this.chargeLoop) return;
    this.chargeLoop.stop(0.06);
    this.chargeLoop = null;
  }
}

export const BUNKER_PLUGIN: ArmPlugin = {
  kind: 'bunker',
  newsKinds: ['bunker'],
  create: ctx => new BunkerArmGun(ctx),
  remoteNews(ctx: Ctx, kind: MechKind, values: number[]): void {
    if (kind !== 'bunker' || values.length < 7) return;
    const charged = values[0]! >= 0.5;
    _tip.set(values[1]!, values[2]!, values[3]!);
    _fwd.set(values[4]!, values[5]!, values[6]!);
    ctx.fx?.ring?.(_tip, _fwd, charged ? '#ff8c28' : '#ffbb66', charged ? 6.2 : 3.2);
    ctx.fx?.sparks?.(_tip, _fwd, charged ? 36 : 16, '#ffaa44');
    _play.position = _tip;
    _play.volume = charged ? 1.0 : 0.78;
    ctx.audio?.play?.(charged ? 'slam_impact' : 'hit_punch', _play);
  },
};
