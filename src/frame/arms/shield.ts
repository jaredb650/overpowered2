/**
 * Armored Energy Shield arm weapon plug-in (`src/frame/arms/shield.ts`).
 *
 *   - Hold fire button (`LMB` / `RMB`) to angle the forearm kite-buckler across the front and project a wide
 *     directional hexagonal energy barrier (`shieldState`).
 *   - Perfect Guard Window: first `0.5 s` after raising (`0.7 s` in `BUCKLER` mode) sets `perfect: true` and
 *     `reduction: 0.95` (enabling `seat.ts` incoming rocket reflection!). After the window, sustains `0.80` DR
 *     (`0.72` in `BUCKLER` mode).
 *   - Heat Management: holding builds heat (`14/s` in `STANDARD`, `20/s` in `BUCKLER`), releasing cools (`26/s`);
 *     reaching `100` triggers a `2.5 s` vent lockout that drops the barrier until cooled.
 *   - Mode Toggle & Shield Bash:
 *       - Tap `1`/`2` while idle switches between `STANDARD` (80% DR / 0.5 s PG / low heat) and
 *         `BUCKLER` (72% DR / 0.7 s PG / higher heat).
 *       - Tap `1`/`2` (or `R`) while actively shielding triggers a Shield Bash shockwave (`6.5 m` frontal cone,
 *         `180` dmg, `160` knockback, costs `20` heat).
 */
import * as THREE from 'three';
import type { Ctx, DamageInfo, LoopHandle, PlayOptions } from '../../core/contracts';
import type { EnemyInstance } from '../../core/gameplay';
import { clamp } from '../../core/math';
import type { MechKind } from '../../progression/callins/link';
import type { GunnerWeapon } from '../../vehicles/hud';
import type { ArmSide } from '../loadout';
import type { ArmPlugin, ArmUpdateContext, FrameArmGun, ShieldState } from './types';

export type ShieldMode = 'STANDARD' | 'BUCKLER';

const DEG = Math.PI / 180;

export const ENERGY_SHIELD = {
  maxHeat: 100,
  coolRate: 26,
  overheatLockout: 2.5,
  absorbHeatFactor: 0.06,
  modes: {
    STANDARD: {
      reduction: 0.80,
      perfectReduction: 0.95,
      perfectWindow: 0.5,
      heatRate: 14,
    },
    BUCKLER: {
      reduction: 0.72,
      perfectReduction: 0.95,
      perfectWindow: 0.7,
      heatRate: 20,
    },
  },
  bash: {
    reach: 6.5,
    damage: 180,
    force: 160,
    heatCost: 20,
    cooldown: 0.8,
    coneCos: Math.cos(55 * DEG),
  },
} as const;

export interface ShieldRuntimeState extends ShieldState {
  readonly side: ArmSide;
}

const _origin = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _at = new THREE.Vector3();
const _to = new THREE.Vector3();
const _enemies: EnemyInstance[] = [];
const _play: PlayOptions = {};

function flatForward(aim: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  out.set(aim.x, 0, aim.z);
  if (out.lengthSq() < 1e-5) out.set(0, 0, -1);
  return out.normalize();
}

export class ShieldArmGun implements FrameArmGun {
  readonly kind = 'shield' as const;
  mode: ShieldMode = 'STANDARD';
  /** Heat gauge `0..100`. */
  heatValue = 0;
  overheated = false;
  /** Remaining seconds in the 2.5 s vent lockout. */
  lockoutTimer = 0;

  private active = false;
  private perfectTimer = 0;
  private bashCooldown = 0;
  private bashAnim = 0;
  private lastSide: ArmSide = 'left';
  private humLoop: LoopHandle | null = null;

  private readonly stateObj: {
    active: boolean;
    reduction: number;
    perfect: boolean;
    side: ArmSide;
    onAbsorb: (blockedDamage: number) => void;
  };

  constructor(private readonly ctx: Ctx) {
    this.stateObj = {
      active: false,
      reduction: ENERGY_SHIELD.modes.STANDARD.reduction,
      perfect: false,
      side: 'left',
      onAbsorb: (blockedDamage: number) => this.handleAbsorb(blockedDamage),
    };
  }

  get firing(): boolean {
    return this.active;
  }

  /** Normalized heat bar `0..1` for the crosshair gauge. */
  get heat(): number {
    return clamp(this.heatValue / ENERGY_SHIELD.maxHeat);
  }

  /** Active directional shield state for `FrameGuns.activeShield()` and `Frame.hit()`, or `undefined` when dropped/overheated. */
  get shieldState(): ShieldRuntimeState | undefined {
    if (!this.active || this.overheated) return undefined;
    return this.stateObj;
  }

  update(dt: number, u: ArmUpdateContext): void {
    const { audio } = this.ctx;
    const energyMult = u.energyMult ?? 1;
    const spec = ENERGY_SHIELD.modes[this.mode];
    this.lastSide = u.side;

    if (this.bashCooldown > 0) this.bashCooldown = Math.max(0, this.bashCooldown - dt);
    if (this.bashAnim > 0) this.bashAnim = Math.max(0, this.bashAnim - dt);

    // Handle vent lockout countdown when overheated.
    if (this.overheated) {
      this.dropShield();
      this.lockoutTimer = Math.max(0, this.lockoutTimer - dt);
      this.heatValue = clamp(
        (this.lockoutTimer / ENERGY_SHIELD.overheatLockout) * ENERGY_SHIELD.maxHeat,
        0,
        ENERGY_SHIELD.maxHeat,
      );
      if (this.lockoutTimer <= 0) {
        this.overheated = false;
        this.heatValue = 0;
        audio?.play?.('railgun_ready', { pitch: 1.15, volume: 0.65 });
      } else if (u.pressed) {
        audio?.play?.('weapon_dry', { pitch: 0.72 });
      }
      u.arm.setPose?.(0, 0, 0, 0);
      u.arm.setActive?.(0, this.mode === 'BUCKLER' ? 1 : 0);
      return;
    }

    // Mode switch when idle; Shield Bash pulse when actively guarding!
    if (u.cyclePressed && !u.held) {
      this.mode = this.mode === 'STANDARD' ? 'BUCKLER' : 'STANDARD';
      audio?.play?.('reload_bolt', { pitch: this.mode === 'BUCKLER' ? 1.18 : 0.88, volume: 0.82 });
      this.ctx.hud?.callout?.(
        this.mode === 'BUCKLER' ? 'ENERGY SHIELD // BUCKLER (0.7s PG)' : 'ENERGY SHIELD // STANDARD (80% DR)',
      );
    }

    if (u.held) {
      const wasActive = this.active;
      this.active = true;
      if (!wasActive) {
        this.perfectTimer = spec.perfectWindow;
        audio?.play?.('railgun_ready', { pitch: 1.28, volume: 0.72 });
        this.startHumAudio();
        u.arm.muzzle(_origin);
        u.onNews?.('shield', [1, _origin.x, _origin.y, _origin.z]);
      } else {
        this.perfectTimer = Math.max(0, this.perfectTimer - dt);
      }

      // Trigger Shield Bash if tapping cycle key (`1`/`2`) or `R` while holding the shield.
      if ((u.cyclePressed || u.reloadPressed) && this.bashCooldown <= 0) {
        this.bash(u);
      }

      this.heatValue = Math.min(ENERGY_SHIELD.maxHeat, this.heatValue + spec.heatRate * dt);
      if (this.heatValue >= ENERGY_SHIELD.maxHeat) {
        this.triggerOverheat();
        u.arm.setPose?.(0, 0, 0, 0);
        u.arm.setActive?.(0, this.mode === 'BUCKLER' ? 1 : 0);
        return;
      }

      const perfect = this.perfectTimer > 0;
      this.stateObj.active = true;
      this.stateObj.perfect = perfect;
      this.stateObj.reduction = perfect ? spec.perfectReduction : spec.reduction;
      this.stateObj.side = u.side;

      const bashPush = this.bashAnim > 0 ? -0.85 * (this.bashAnim / 0.24) : 0;
      u.arm.setPose?.(u.side === 'left' ? -0.55 : 0.55, 0.08, 0, 0.35 + bashPush);
      u.arm.setActive?.(perfect ? 1 : 0.72, this.mode === 'BUCKLER' ? 1 : 0);
    } else {
      if (this.active) {
        this.dropShield();
      }
      if (this.heatValue > 0) {
        this.heatValue = Math.max(0, this.heatValue - ENERGY_SHIELD.coolRate * energyMult * dt);
      }
      u.arm.setPose?.(0, 0, 0, 0);
      u.arm.setActive?.(0, this.mode === 'BUCKLER' ? 1 : 0);
    }
  }

  /** Fires a 6.5 m frontal Shield Bash concussive pulse (`180 dmg`, `160` knockback, costs `20` heat). */
  bash(u: ArmUpdateContext): boolean {
    if (this.overheated || this.bashCooldown > 0) return false;
    const B = ENERGY_SHIELD.bash;
    const { audio, camera, enemies, fx, hud, physics, world, combat, render } = this.ctx;

    if (u.feet) _origin.set(u.feet.x, u.feet.y + 2.2, u.feet.z);
    else _origin.copy(u.sight.view.position);
    flatForward(u.sight.aim, _fwd);
    _at.copy(_origin).addScaledVector(_fwd, 2.8);

    const count = Math.min(enemies?.query?.(_origin, B.reach + 2, _enemies) || 0, _enemies.length);
    let struck = 0;
    for (let i = 0; i < count; i++) {
      const e = _enemies[i]!;
      if (!e.alive) continue;
      _to.subVectors(e.center, _origin);
      const dist = _to.length();
      if (dist > B.reach + 0.9) continue;
      if (dist > 1.8) {
        const horiz = Math.hypot(_to.x, _to.z) || 1;
        if ((_to.x * _fwd.x + _to.z * _fwd.z) / horiz < B.coneCos) continue;
      }
      const dmg: DamageInfo = {
        amount: B.damage,
        type: 'crush',
        point: e.center.clone(),
        dir: _fwd.clone().setY(0.42).normalize(),
        force: B.force,
        source: 'frame_shield_bash',
        region: 'chest',
      };
      enemies.applyDamage(e, dmg);
      struck++;
    }
    _enemies.length = 0;

    if (struck > 0) hud?.hitMarker?.('body');

    world?.objects?.damageExplosivesInRadius?.(_at, B.reach, B.damage, 'frame_shield_bash');
    enemies?.vehicles?.frameBlow?.(_at, B.reach, B.damage, _fwd, 'frame_shield_bash');
    physics?.radialImpulse?.(_at, B.reach, B.force);
    combat?.puntEnemyGrenades?.(_at, B.reach + 1.0, _origin, 48);

    fx?.ring?.(_at, _fwd, '#66eeff', B.reach * 1.15);
    fx?.sparks?.(_at, _fwd, 26, '#99f6ff');
    render?.lights?.flash?.(_at, 0x55e8ff, 12, 14, 0.16);
    audio?.play?.('slam_impact', { pitch: 1.05, volume: 0.9 });
    audio?.play?.('metal_clang', { pitch: 1.35, volume: 0.85 });

    if (u.recoilMult > 0) {
      camera?.addTrauma?.(0.28 * u.recoilMult);
      camera?.kick?.(0.02 * u.recoilMult, 0);
    }

    this.bashCooldown = B.cooldown;
    this.bashAnim = 0.24;
    this.heatValue = Math.min(ENERGY_SHIELD.maxHeat, this.heatValue + B.heatCost);
    u.onNews?.('shield', [2, _at.x, _at.y, _at.z, _fwd.x, _fwd.y, _fwd.z]);
    return true;
  }

  idleUpdate(dt: number): void {
    this.dropShield();
    if (this.bashCooldown > 0) this.bashCooldown = Math.max(0, this.bashCooldown - dt);
    if (this.overheated) {
      this.lockoutTimer = Math.max(0, this.lockoutTimer - dt);
      this.heatValue = clamp(
        (this.lockoutTimer / ENERGY_SHIELD.overheatLockout) * ENERGY_SHIELD.maxHeat,
        0,
        ENERGY_SHIELD.maxHeat,
      );
      if (this.lockoutTimer <= 0) {
        this.overheated = false;
        this.heatValue = 0;
      }
    } else if (this.heatValue > 0) {
      this.heatValue = Math.max(0, this.heatValue - ENERGY_SHIELD.coolRate * dt);
    }
  }

  fillRow(row: GunnerWeapon, button: string, cycleKey: string): void {
    const tag = this.overheated
      ? 'VENTING'
      : this.active
        ? this.perfectTimer > 0
          ? 'PERFECT'
          : 'GUARD'
        : this.mode;
    row.name = `${button} ENERGY SHIELD [${tag}] // ${cycleKey}`;
    row.ammo = Math.round(ENERGY_SHIELD.maxHeat - this.heatValue);
    row.max = ENERGY_SHIELD.maxHeat;
    row.reload = this.overheated ? clamp(1 - this.lockoutTimer / ENERGY_SHIELD.overheatLockout) : -1;
    row.selected = this.active;
  }

  silence(): void {
    this.stopHumAudio();
  }

  reset(): void {
    this.silence();
    this.mode = 'STANDARD';
    this.heatValue = 0;
    this.overheated = false;
    this.lockoutTimer = 0;
    this.active = false;
    this.perfectTimer = 0;
    this.bashCooldown = 0;
    this.bashAnim = 0;
    this.stateObj.active = false;
    this.stateObj.perfect = false;
  }

  private handleAbsorb(blockedDamage: number): void {
    if (this.overheated || !this.active) return;
    // Perfect Guard absorbs incoming impacts cleanly with minimal heat spike.
    const mult = this.perfectTimer > 0 ? 0.25 : 1.0;
    this.heatValue = Math.min(
      ENERGY_SHIELD.maxHeat,
      this.heatValue + Math.max(0, blockedDamage) * ENERGY_SHIELD.absorbHeatFactor * mult,
    );
    if (this.heatValue >= ENERGY_SHIELD.maxHeat) {
      this.triggerOverheat();
    }
  }

  private triggerOverheat(): void {
    this.dropShield();
    this.overheated = true;
    this.heatValue = ENERGY_SHIELD.maxHeat;
    this.lockoutTimer = ENERGY_SHIELD.overheatLockout;
    this.ctx.audio?.play?.('steam_burst', { volume: 0.9, pitch: 0.88 });
    this.ctx.audio?.play?.('railgun_fizzle', { volume: 0.7, pitch: 0.82 });
    this.ctx.hud?.callout?.('ENERGY SHIELD OVERHEATED — VENTING');
  }

  private dropShield(): void {
    this.active = false;
    this.perfectTimer = 0;
    this.stateObj.active = false;
    this.stateObj.perfect = false;
    this.stopHumAudio();
  }

  private startHumAudio(): void {
    if (this.humLoop) return;
    this.humLoop = this.ctx.audio?.startLoop?.('railgun_charge_loop', { pitch: 0.62, volume: 0.18 }) ?? null;
  }

  private stopHumAudio(): void {
    if (!this.humLoop) return;
    this.humLoop.stop(0.08);
    this.humLoop = null;
  }
}

export const SHIELD_PLUGIN: ArmPlugin = {
  kind: 'shield',
  newsKinds: ['shield'],
  create: ctx => new ShieldArmGun(ctx),
  remoteNews(ctx: Ctx, kind: MechKind, values: number[]): void {
    if (kind !== 'shield' || values.length < 4) return;
    const phase = values[0]!;
    _at.set(values[1]!, values[2]!, values[3]!);
    _play.position = _at;
    if (phase === 2 && values.length >= 7) {
      _fwd.set(values[4]!, values[5]!, values[6]!);
      ctx.fx?.ring?.(_at, _fwd, '#66eeff', ENERGY_SHIELD.bash.reach);
      ctx.fx?.sparks?.(_at, _fwd, 20, '#99f6ff');
      _play.volume = 0.85;
      ctx.audio?.play?.('slam_impact', _play);
    } else {
      ctx.fx?.sparks?.(_at, _fwd.set(0, 1, 0), 10, '#66eeff');
      _play.volume = 0.6;
      ctx.audio?.play?.('railgun_ready', _play);
    }
  },
};
