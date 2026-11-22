/**
 * 20 mm six-barrel Rotary arm weapon plug-in.
 * Tap `1` (left arm) or `2` (right arm) cycles between standard 20 mm AP and proximity-fuzed airburst rounds.
 */
import * as THREE from 'three';
import { CG, type Ctx, type LoopHandle, type RayHit } from '../../core/contracts';
import type { ExplosionSpec, ShotSpec } from '../../core/gameplay';
import { clamp, rand, randomInCone } from '../../core/math';
import { Heat } from '../../vehicles/emplacement';
import type { GunnerWeapon } from '../../vehicles/hud';
import { FRAME, type RotaryMode } from '../data';
import { airburstPoint } from './shared';
import type { Arm, ArmPlugin, ArmRemoteState, ArmUpdateContext, FrameArmGun } from './types';

const R = FRAME.rotary;
const A = FRAME.rotaryAirburst;
const SPIN_PITCH = 0.45;
const LOOP_RATE = 25;

const _muzzle = new THREE.Vector3();
const _bore = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _at = new THREE.Vector3();
const _v = new THREE.Vector3();
const _rayHit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'concrete', collider: null };

const AIRBURST_BLAST: ExplosionSpec = {
  kind: 'shell', source: 'frame_rotary_airburst', radius: A.radius, damage: A.damage,
  shake: 0.008, team: 'player', selfDamage: 0, playerPush: 0, worldObject: true,
};

/** Pure clock for the 20 mm rotary: spin, heat, and standard/airburst mode. */
export class Rotary {
  readonly heat = new Heat(R);
  spin = 0;
  mode: RotaryMode = 'standard';
  private roundIn = 0;
  /** True on the frame the heat locked the trigger. */
  overheatedNow = false;

  get rate(): number {
    return this.mode === 'airburst' ? A.rate : R.rate;
  }

  /** Toggles between standard 20 mm AP and proximity-fuzed airburst rounds (tap 1 for left arm, tap 2 for right arm). */
  cycle(): RotaryMode {
    this.mode = this.mode === 'standard' ? 'airburst' : 'standard';
    return this.mode;
  }

  update(dt: number, held: boolean): number {
    const want = held && !this.heat.overheated;
    this.spin = clamp(this.spin + (want ? dt / R.spinUp : -dt / R.spinDown));
    const shooting = want && this.spin >= R.fireAt;
    const rate = this.rate;
    let n = 0;
    this.overheatedNow = false;
    if (shooting) {
      this.roundIn -= dt;
      while (this.roundIn <= 0 && n < 4) {
        this.roundIn += 1 / rate;
        n++;
        if (this.heat.shot()) {
          this.overheatedNow = true;
          break;
        }
      }
      if (this.roundIn < 0) this.roundIn = 0;
    } else {
      this.roundIn = Math.max(0, this.roundIn - dt);
    }
    this.heat.cool(dt, shooting);
    return n;
  }

  get firing(): boolean {
    return this.spin >= R.fireAt && !this.heat.overheated;
  }

  reset(): void {
    this.heat.value = 0;
    this.heat.overheated = false;
    this.spin = this.roundIn = 0;
    this.mode = 'standard';
  }
}

export class RotaryArmGun implements FrameArmGun {
  readonly kind = 'rotary' as const;
  readonly clock = new Rotary();
  private fired = 0;
  private spinLoop: LoopHandle | null = null;
  private fireLoop: LoopHandle | null = null;
  private readonly shot: ShotSpec = {
    damage: R.damage, source: 'frame_rotary', team: 'player', maxDistance: R.range, tracerFrom: _muzzle,
    force: R.force, severMult: R.severMult, impactScale: R.impactScale, burst: R.burst, penetrate: R.penetrate, bodyCost: R.bodyCost,
  };

  constructor(private readonly ctx: Ctx) {}

  get firing(): boolean {
    return this.clock.firing;
  }

  get heat(): number {
    return this.clock.heat.value;
  }

  update(dt: number, u: ArmUpdateContext): void {
    const { audio } = this.ctx;
    if (u.cyclePressed) {
      const mode = this.clock.cycle();
      audio.play('reload_bolt', { pitch: mode === 'airburst' ? 1.15 : 0.85, volume: 0.9 });
      const prefix = u.side === 'left' ? 'LEFT' : 'RIGHT';
      this.ctx.hud.callout?.(mode === 'airburst' ? `${prefix} ROTARY // AIRBURST` : `${prefix} ROTARY // 20MM AP`);
    }
    const n = this.clock.update(dt, u.held);
    u.arm.turn(this.clock.spin * R.barrelRate * dt);
    this.spinSound(u.held && !this.clock.heat.overheated);
    if (this.clock.firing && u.held) {
      const loopPitch = this.clock.rate / LOOP_RATE;
      if (!this.fireLoop) {
        this.fireLoop = audio.startLoop('minigun_fire_loop', { fadeIn: 0.03, pitch: loopPitch });
      } else {
        this.fireLoop.setPitch(loopPitch, 0.04);
      }
      for (let i = 0; i < n; i++) {
        if (this.clock.mode === 'airburst') this.airburstRound(u);
        else this.round(u);
      }
    } else {
      this.ceaseFire();
    }
    if (this.clock.overheatedNow) audio.play('steam_burst', { volume: 0.9 });
    if (u.pressed && this.clock.heat.overheated) audio.play('weapon_dry');
  }

  idleUpdate(dt: number): void {
    this.clock.update(dt, false);
  }

  fillRow(row: GunnerWeapon, button: string, cycleKey: string): void {
    const airburst = this.clock.mode === 'airburst';
    row.name = airburst ? `${button} ROTARY [AIRBURST] // ${cycleKey}` : `${button} ROTARY [STD] // ${cycleKey}`;
    row.ammo = Math.round((1 - this.clock.heat.value) * 100);
    row.max = 100;
    row.reload = this.clock.heat.overheated ? 1 - this.clock.heat.value : -1;
    row.selected = airburst;
  }

  silence(): void {
    this.ceaseFire();
    this.spinLoop?.stop(0.2);
    this.spinLoop = null;
  }

  reset(): void {
    this.silence();
    this.clock.reset();
    this.fired = 0;
  }

  private round(u: ArmUpdateContext): void {
    const { combat, fx, camera } = this.ctx;
    const fired = ++this.fired;
    u.arm.muzzle(_muzzle);
    u.arm.bore(_bore);
    randomInCone(u.sight.aim, R.spread, _dir);
    this.shot.tracer = fired % R.tracerEvery === 0 ? 'heavy' : undefined;
    combat.fireRay(u.sight.view.position, _dir, this.shot);
    if (fired % R.flashEvery === 0) fx.muzzleFlash(_muzzle, _bore, 'rotary');
    if (fired % 2 === 0) {
      _v.set(-_bore.z, 0, _bore.x).multiplyScalar(-2);
      _v.y = rand(1, 2.5);
      fx.shellCasing(_muzzle.addScaledVector(_bore, -1.2), _v, 'cannon');
    }
    if (u.recoilMult > 0) {
      camera.addTrauma(R.trauma * u.recoilMult);
      camera.kick(rand(0, R.kick) * u.recoilMult, rand(-R.kick, R.kick) * u.recoilMult);
    }
  }

  private airburstRound(u: ArmUpdateContext): void {
    const { audio, combat, enemies, fx, physics, camera } = this.ctx;
    const fired = ++this.fired;
    u.arm.muzzle(_muzzle);
    u.arm.bore(_bore);
    randomInCone(u.sight.aim, A.spread, _dir);
    const hitWall = physics.raycastInto(u.sight.view.position, _dir, R.range, CG.World, _rayHit);
    const maxDist = hitWall ? _rayHit.distance : R.range;
    const prox = airburstPoint(u.sight.view.position, _dir, maxDist, enemies, _at);
    let burst = false;
    if (prox) {
      burst = true;
    } else if (hitWall) {
      _at.copy(_rayHit.point).addScaledVector(_rayHit.normal, 0.35);
      burst = true;
    } else {
      _at.copy(u.sight.view.position).addScaledVector(_dir, R.range);
    }
    if (fired % R.tracerEvery === 0) fx.tracer(_muzzle, _at, 'heavy');
    if (burst) {
      combat.explode(_at, AIRBURST_BLAST);
      fx.burst?.(_at, _dir, 1.35);
      if (fired % 2 === 0) fx.ring(_at, _dir, '#ffb040', A.radius * 0.9);
      fx.sparks(_at, _dir, 10, '#ff9830');
      fx.smoke(_at, 0x4a3b2c, 1.4, 0.55);
      if (fired % 2 === 0) {
        audio.play('cannon_burst', { position: _at, volume: 0.48, pitch: 1.35, pitchJitter: 0.14 });
      }
    }
    if (fired % R.flashEvery === 0) fx.muzzleFlash(_muzzle, _bore, 'rotary');
    if (fired % 2 === 0) {
      _v.set(-_bore.z, 0, _bore.x).multiplyScalar(-2);
      _v.y = rand(1, 2.5);
      fx.shellCasing(_muzzle.addScaledVector(_bore, -1.2), _v, 'cannon');
    }
    if (u.recoilMult > 0) {
      camera.addTrauma(A.trauma * u.recoilMult);
      camera.kick(rand(0, A.kick) * u.recoilMult, rand(-A.kick, A.kick) * u.recoilMult);
    }
  }

  private spinSound(want: boolean): void {
    const { audio } = this.ctx;
    if (want && !this.spinLoop) {
      audio.play('minigun_spinup');
      this.spinLoop = audio.startLoop('minigun_spin_loop', { fadeIn: 0.1 });
    } else if (!want && this.spinLoop) {
      this.spinLoop.stop(0.2);
      this.spinLoop = null;
      audio.play('minigun_spindown', { offset: (1 - this.clock.spin) * R.spinDown });
    }
    this.spinLoop?.setPitch(SPIN_PITCH + (1 - SPIN_PITCH) * this.clock.spin, 0.04);
  }

  private ceaseFire(): void {
    if (!this.fireLoop) return;
    this.fireLoop.stop(0.08);
    this.fireLoop = null;
    this.ctx.audio.play('minigun_fire');
  }
}

export const ROTARY_PLUGIN: ArmPlugin = {
  kind: 'rotary',
  create: ctx => new RotaryArmGun(ctx),
  remoteFiring(ctx: Ctx, arm: Arm, _side, dt: number, state: ArmRemoteState): void {
    arm.turn(R.barrelRate * dt);
    state.accum += dt * R.rate;
    const rounds = Math.min(3, Math.floor(state.accum));
    if (rounds <= 0) return;
    state.accum -= rounds;
    arm.muzzle(_muzzle);
    arm.bore(_bore);
    for (let i = 0; i < rounds; i++) {
      state.fired++;
      if (state.fired % R.tracerEvery === 0) {
        randomInCone(_bore, R.spread, _dir);
        const hit = ctx.physics.raycast(_muzzle, _dir, R.range, CG.World);
        if (hit) {
          ctx.fx.tracer(_muzzle, hit.point, 'heavy');
          ctx.fx.impact(hit.point, hit.normal, hit.surface, 0.7);
        } else {
          ctx.fx.tracer(_muzzle, _at.copy(_muzzle).addScaledVector(_dir, R.range), 'heavy');
        }
      }
      if (state.fired % R.flashEvery === 0) ctx.fx.muzzleFlash(_muzzle, _bore, 'rotary');
    }
  },
};
