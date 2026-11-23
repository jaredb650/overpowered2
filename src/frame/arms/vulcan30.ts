/**
 * 30 mm three-barrel Explosive Rotary Cannon arm weapon plug-in (`vulcan30L/R`).
 *
 *   Spin-up   0.35 s, 24.5 rounds/s, overheats after ~5.0 s of continuous fire, vents in 2.5 s.
 *   Rounds    HE (60% of 40 mm blast radius, 45% of 40 mm damage),
 *             AP (high-velocity armor-piercing round, penetrates 1 body: `penetrate: 2`, `bodyCost: 1`),
 *             FLAK (proximity-fuzed airburst ahead of enemies, 60% of 40 mm flak pellets).
 *   Cycling   Tap `1` (left arm) or `2` (right arm) cycles HE -> AP -> FLAK independently per arm.
 *             `R` (`reloadPressed`) never cycles ammo.
 *   Accuracy  Zero bullet spread: every shell travels straight down the crosshair.
 */
import * as THREE from 'three';
import { CG, type Ctx, type LoopHandle, type PlayOptions, type RayHit } from '../../core/contracts';
import type { ExplosionSpec, ShotSpec } from '../../core/gameplay';
import { clamp, rand } from '../../core/math';
import { AC130 } from '../../progression/callins/ac130Data';
import type { Round40 } from '../../progression/callins/ac130Guns';
import { flakCone } from '../../progression/callins/ac130Rounds';
import type { MechKind } from '../../progression/callins/link';
import { Heat } from '../../vehicles/emplacement';
import type { GunnerWeapon } from '../../vehicles/hud';
import { ROUNDS_40, ROUND_NAMES, airburstPoint } from './shared';
import type { Arm, ArmPlugin, ArmRemoteState, ArmUpdateContext, FrameArmGun } from './types';

const B = AC130.bofors;

/** Tuning constants for the 30 mm three-barrel rotary cannon. */
export const VULCAN30 = {
  rate: 24.5,
  spinUp: 0.35,
  spinDown: 1.0,
  /** Trigger fires right at 0.35 s spin-up without floating-point boundary slip. */
  fireAt: 0.99,
  /** ~8.36 rev/s across 3 barrels (~25.1 barrels/s past the breech). */
  barrelRate: 52.5,
  range: 420,
  /** 123 rounds at 24.5 rds/s ≈ 5.0 s of continuous fire; 1 / 2.5 = 0.4/s vent lockout. */
  heatPerShot: 1 / 123,
  cool: 0.3,
  vent: 1 / 2.5,
  armRecoil: 0.16,
  trauma: 0.085,
  kick: 0.0055,
  /** HE: 60% of 40 mm blast radius (3.0 m), 45% of 40 mm damage (76.5). */
  he: {
    radius: B.he.radius * 0.6,
    damage: B.he.damage * 0.45,
    directDamage: 24,
    force: 46,
    severMult: 2.8,
  },
  /** AP: crisp high-velocity armor-piercing round that penetrates 1 body (`penetrate: 2`, `bodyCost: 1`). */
  ap: {
    damage: 145,
    penetrate: 2,
    bodyCost: 1,
    penetrateKeep: 0.85,
    force: 74,
    severMult: 3.8,
    impactScale: 2.0,
  },
  /** FLAK: proximity-fuzed airburst ahead of enemies with 60% of 40 mm flak pellets (8). */
  flak: {
    pellets: Math.round(B.flak.pellets * 0.6),
    pelletDamage: Math.round(B.flak.pelletDamage * 0.6),
    cone: B.flak.cone,
    reach: B.flak.reach,
    radius: B.flak.radius * 0.75,
    damage: Math.round(B.flak.damage * 0.5),
    force: 18,
    severMult: 2.4,
  },
} as const;

const SPIN_PITCH_MIN = 0.34;
const SPIN_PITCH_SPAN = 0.44;
/** `minigun_fire_loop` is synthesized at 25 rounds/s; pitching by rate/25 matches the 24.5 rds/s cadence. */
const LOOP_BASE_RATE = 25;
const REMOTE_FLAK_TRACERS = 3;

// Zero-allocation module-level scratch buffers.
const _muzzle = new THREE.Vector3();
const _bore = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _negDir = new THREE.Vector3();
const _at = new THREE.Vector3();
const _blastPos = new THREE.Vector3();
const _v = new THREE.Vector3();
const _rayHit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'concrete', collider: null };
const _flakPellets: THREE.Vector3[] = Array.from({ length: VULCAN30.flak.pellets }, () => new THREE.Vector3());

const _rFrom = new THREE.Vector3();
const _rTo = new THREE.Vector3();
const _rDir = new THREE.Vector3();
const _rNegDir = new THREE.Vector3();
const _rBore = new THREE.Vector3();
const _rEnd = new THREE.Vector3();
const _rHit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'concrete', collider: null };
const _rFlakPellets: THREE.Vector3[] = Array.from({ length: REMOTE_FLAK_TRACERS }, () => new THREE.Vector3());

const _play: PlayOptions = {};
const _playExplode: PlayOptions = { position: _at, volume: 0.52, pitch: 1.25, pitchJitter: 0.08 };
const _playFlak: PlayOptions = { position: _at, volume: 0.5, pitch: 1.25, pitchJitter: 0.12 };
const _playRemoteShot: PlayOptions = { position: _rFrom, volume: 0.5, pitch: 1.04, pitchJitter: 0.06 };
const _playRemoteHe: PlayOptions = { position: _rTo, volume: 0.45, pitch: 1.25 };
const _playRemoteFlak: PlayOptions = { position: _rTo, volume: 0.45, pitch: 1.25 };
const _heFxOpts = { kind: 'shell' as const, radius: VULCAN30.he.radius, scale: 0.62 };
const _flakFxOpts = { kind: 'shell' as const, radius: VULCAN30.flak.radius, scale: 0.55 };
const _newsValues: number[] = [0, 0, 0, 0, 0, 0, 0, 0];

const HE_BLAST: ExplosionSpec = {
  kind: 'shell',
  source: 'frame_vulcan30_he',
  radius: VULCAN30.he.radius,
  damage: VULCAN30.he.damage,
  shake: 0.012,
  team: 'player',
  selfDamage: 0,
  playerPush: 0,
  worldObject: true,
};

const FLAK_BLAST: ExplosionSpec = {
  kind: 'shell',
  source: 'frame_vulcan30_flak',
  radius: VULCAN30.flak.radius,
  damage: VULCAN30.flak.damage,
  shake: 0.008,
  team: 'player',
  selfDamage: 0,
  playerPush: 0,
  worldObject: true,
};

const FLAK_PELLET_SHOT: ShotSpec = {
  damage: VULCAN30.flak.pelletDamage,
  source: 'frame_vulcan30_flak',
  team: 'player',
  maxDistance: VULCAN30.flak.reach,
  force: VULCAN30.flak.force,
  severMult: VULCAN30.flak.severMult,
  impactScale: 1.25,
  type: 'pellet',
};

/** Pure clock for the 30 mm rotary cannon: spin-up, 24.5 rds/s cadence, heat/vent, and HE/AP/FLAK selection. */
export class Vulcan30 {
  readonly heat = new Heat(VULCAN30);
  spin = 0;
  round: Round40 = 'g40';
  private roundIn = 0;
  private _firing = false;
  /** True on the frame heat hits 1.0 and locks out the trigger for venting. */
  overheatedNow = false;

  get roundLabel(): string {
    return ROUND_NAMES[this.round];
  }

  get firing(): boolean {
    return this._firing;
  }

  /** Cycles HE (`g40`) -> AP (`ap`) -> FLAK (`flak`) -> HE. */
  cycle(): Round40 {
    this.round = ROUNDS_40[(ROUNDS_40.indexOf(this.round) + 1) % ROUNDS_40.length]!;
    return this.round;
  }

  update(dt: number, held: boolean): number {
    const want = held && !this.heat.overheated;
    this.spin = clamp(this.spin + (want ? dt / VULCAN30.spinUp : -dt / VULCAN30.spinDown));
    const shooting = want && this.spin >= VULCAN30.fireAt;
    let n = 0;
    this.overheatedNow = false;
    if (shooting) {
      this.roundIn -= dt;
      while (this.roundIn <= 0 && n < 4) {
        this.roundIn += 1 / VULCAN30.rate;
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
    this._firing = shooting && !this.heat.overheated;
    this.heat.cool(dt, shooting);
    return n;
  }

  reset(): void {
    this.heat.value = 0;
    this.heat.overheated = false;
    this.spin = 0;
    this.roundIn = 0;
    this._firing = false;
    this.overheatedNow = false;
    this.round = 'g40';
  }
}

export class Vulcan30ArmGun implements FrameArmGun {
  readonly kind = 'vulcan30' as const;
  readonly clock = new Vulcan30();
  private fired = 0;
  private spinLoop: LoopHandle | null = null;
  private fireLoop: LoopHandle | null = null;

  private readonly heShot: ShotSpec = {
    damage: VULCAN30.he.directDamage,
    source: 'frame_vulcan30_he',
    team: 'player',
    maxDistance: VULCAN30.range,
    tracer: 'hellfire',
    tracerFrom: _muzzle,
    force: VULCAN30.he.force,
    severMult: VULCAN30.he.severMult,
    impactScale: 1.5,
  };

  private readonly apShot: ShotSpec = {
    damage: VULCAN30.ap.damage,
    source: 'frame_vulcan30_ap',
    team: 'player',
    maxDistance: VULCAN30.range,
    tracer: 'ap',
    tracerFrom: _muzzle,
    force: VULCAN30.ap.force,
    severMult: VULCAN30.ap.severMult,
    impactScale: VULCAN30.ap.impactScale,
    penetrate: VULCAN30.ap.penetrate,
    bodyCost: VULCAN30.ap.bodyCost,
    penetrateKeep: VULCAN30.ap.penetrateKeep,
    armorPiercing: true,
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
    // Cycle HE -> AP -> FLAK ONLY on cyclePressed (tap 1 left, tap 2 right). R (`reloadPressed`) never cycles ammo.
    if (u.cyclePressed) {
      const round = this.clock.cycle();
      const pitch = round === 'g40' ? 0.82 : round === 'ap' ? 1.05 : 1.22;
      audio.play('reload_bolt', { pitch, volume: 0.9 });
      const prefix = u.side === 'left' ? 'LEFT' : 'RIGHT';
      this.ctx.hud.callout?.(`${prefix} 30MM // ${ROUND_NAMES[round]}`);
    }

    const n = this.clock.update(dt, u.held);
    u.arm.turn(this.clock.spin * VULCAN30.barrelRate * dt);
    this.spinSound(u.held && !this.clock.heat.overheated);

    if (this.clock.firing || n > 0) {
      const loopPitch = VULCAN30.rate / LOOP_BASE_RATE;
      if (!this.fireLoop) {
        this.fireLoop = audio.startLoop('minigun_fire_loop', { fadeIn: 0.03, pitch: loopPitch });
      } else {
        this.fireLoop.setPitch(loopPitch, 0.04);
      }
      for (let i = 0; i < n; i++) {
        this.fireRound(u);
      }
      if (!this.clock.firing) this.ceaseFire();
    } else {
      this.ceaseFire();
    }

    if (this.clock.overheatedNow) audio.play('steam_burst', { volume: 0.95, pitch: 0.9 });
    if (u.pressed && this.clock.heat.overheated) audio.play('weapon_dry');
  }

  idleUpdate(dt: number): void {
    this.clock.update(dt, false);
  }

  fillRow(row: GunnerWeapon, button: string, cycleKey: string): void {
    row.name = `${button} 30MM ${this.clock.roundLabel} // ${cycleKey}`;
    row.ammo = Math.round((1 - this.clock.heat.value) * 100);
    row.max = 100;
    row.reload = this.clock.heat.overheated ? 1 - this.clock.heat.value : -1;
    row.selected = this.clock.round !== 'g40';
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

  private fireRound(u: ArmUpdateContext): void {
    const { audio, fx, camera } = this.ctx;
    const fired = ++this.fired;
    const round = this.clock.round;
    u.arm.muzzle(_muzzle);
    u.arm.bore(_bore);
    // Zero bullet spread: every shell travels straight down the crosshair aim vector.
    _dir.copy(u.sight.aim);
    if (_dir.lengthSq() < 1e-6) _dir.copy(_bore);
    else _dir.normalize();
    _negDir.copy(_dir).negate();

    let burst = false;
    if (round === 'g40') {
      burst = this.fireHe(u, fired);
    } else if (round === 'ap') {
      burst = this.fireAp(u);
    } else {
      burst = this.fireFlak(u, fired);
    }

    // Muzzle flash, warm bloom, shell ejection, barrel recoil slide, and heavy cannon audio punch.
    fx.muzzleFlash(_muzzle, _bore, fired % 2 === 0 ? 'autocannon' : 'rotary');
    if (fired % 2 === 0) {
      u.rounds.flash(_muzzle, 0.95, 0.045, 9, 6.5, 2.8, 1.1);
      _play.volume = 0.44;
      _play.pitch = round === 'ap' ? 1.18 : round === 'flak' ? 1.08 : 0.98;
      _play.position = undefined;
      audio.play('autocannon_fire', _play);
    }
    const ejectSign = u.side === 'left' ? -1 : 1;
    _v.set(-_bore.z, 0, _bore.x).multiplyScalar(ejectSign * 2.4);
    _v.y = rand(1.4, 2.8);
    fx.shellCasing(_blastPos.copy(_muzzle).addScaledVector(_bore, -1.35), _v, 'cannon');

    u.arm.recoil(VULCAN30.armRecoil);
    if (u.recoilMult > 0) {
      camera.addTrauma(VULCAN30.trauma * u.recoilMult);
      camera.kick(
        rand(VULCAN30.kick * 0.45, VULCAN30.kick) * u.recoilMult,
        rand(-VULCAN30.kick * 0.5, VULCAN30.kick * 0.5) * u.recoilMult,
      );
    }

    if (u.onNews) {
      _newsValues[0] = ROUNDS_40.indexOf(round);
      _newsValues[1] = _muzzle.x;
      _newsValues[2] = _muzzle.y;
      _newsValues[3] = _muzzle.z;
      _newsValues[4] = _at.x;
      _newsValues[5] = _at.y;
      _newsValues[6] = _at.z;
      _newsValues[7] = burst ? 1 : 0;
      u.onNews('vulcan30', _newsValues);
    }
  }

  private fireHe(u: ArmUpdateContext, fired: number): boolean {
    const { audio, combat, fx, physics } = this.ctx;
    const origin = u.sight.view.position;
    const res = combat.fireRay(origin, _dir, this.heShot);
    let hit = false;
    if (res && res.end) {
      _at.copy(res.end);
      const maxReach = VULCAN30.range - 1;
      hit = res.hitEnemy || _at.distanceToSquared(origin) < maxReach * maxReach;
    } else if (physics.raycastInto(origin, _dir, VULCAN30.range, CG.World, _rayHit)) {
      _at.copy(_rayHit.point);
      hit = true;
    } else {
      _at.copy(origin).addScaledVector(_dir, VULCAN30.range);
    }

    if (!hit) return false;
    _blastPos.copy(_at).addScaledVector(_dir, -0.2);
    combat.explode(_blastPos, HE_BLAST);
    this.ctx.world?.objects?.damageExplosivesInRadius?.(_blastPos, HE_BLAST.radius, HE_BLAST.damage, HE_BLAST.source);
    fx.explosion(_at, _heFxOpts);
    if (fired % 2 === 0) fx.ring(_at, _negDir, '#ff9830', HE_BLAST.radius * 1.15);
    fx.sparks(_at, _negDir, 10, '#ffb040');
    audio.play('30mmshell_explode', _playExplode);
    return true;
  }

  private fireAp(u: ArmUpdateContext): boolean {
    const { combat, fx, physics } = this.ctx;
    const origin = u.sight.view.position;
    const res = combat.fireRay(origin, _dir, this.apShot);
    let hit = false;
    if (res && res.end) {
      _at.copy(res.end);
      const maxReach = VULCAN30.range - 1;
      hit = res.hitEnemy || _at.distanceToSquared(origin) < maxReach * maxReach;
    } else if (physics.raycastInto(origin, _dir, VULCAN30.range, CG.World, _rayHit)) {
      _at.copy(_rayHit.point);
      hit = true;
    } else {
      _at.copy(origin).addScaledVector(_dir, VULCAN30.range);
    }

    if (hit) fx.sparks(_at, _negDir, 12, '#cfe4ff');
    return hit;
  }

  private fireFlak(u: ArmUpdateContext, fired: number): boolean {
    const { audio, combat, enemies, fx, physics } = this.ctx;
    const origin = u.sight.view.position;
    const hitWall = physics.raycastInto(origin, _dir, VULCAN30.range, CG.World, _rayHit);
    const maxDist = hitWall ? _rayHit.distance : VULCAN30.range;
    const prox = airburstPoint(origin, _dir, maxDist, enemies, _at);
    let burst = false;
    if (prox) {
      burst = true;
    } else if (hitWall) {
      _at.copy(_rayHit.point).addScaledVector(_rayHit.normal, 0.45);
      burst = true;
    } else {
      _at.copy(origin).addScaledVector(_dir, VULCAN30.range);
    }

    fx.tracer(_muzzle, _at, 'api');
    if (!burst) return false;

    combat.explode(_at, FLAK_BLAST);
    this.ctx.world?.objects?.damageExplosivesInRadius?.(_at, FLAK_BLAST.radius, FLAK_BLAST.damage, FLAK_BLAST.source);
    flakCone(_dir, VULCAN30.flak.cone, _flakPellets);
    for (let i = 0; i < _flakPellets.length; i++) {
      FLAK_PELLET_SHOT.tracer = i % 3 === 0 ? 'heavy' : undefined;
      combat.fireRay(_at, _flakPellets[i]!, FLAK_PELLET_SHOT);
    }
    fx.explosion(_at, _flakFxOpts);
    fx.ring(_at, _dir, '#ff7030', FLAK_BLAST.radius * 1.8);
    fx.sparks(_at, _dir, 12, '#ff9830');
    fx.smoke(_at, 0x3b3530, 1.3, 0.5);
    if (fired % 2 === 0) {
      audio.play('cannon_burst', _playFlak);
    }
    return true;
  }

  private spinSound(want: boolean): void {
    const { audio } = this.ctx;
    if (want && !this.spinLoop) {
      audio.play('minigun_spinup', { pitch: 0.78 });
      this.spinLoop = audio.startLoop('minigun_spin_loop', { fadeIn: 0.1, pitch: SPIN_PITCH_MIN });
    } else if (!want && this.spinLoop) {
      this.spinLoop.stop(0.2);
      this.spinLoop = null;
      audio.play('minigun_spindown', { offset: (1 - this.clock.spin) * VULCAN30.spinDown, pitch: 0.78 });
    }
    this.spinLoop?.setPitch(SPIN_PITCH_MIN + SPIN_PITCH_SPAN * this.clock.spin, 0.04);
  }

  private ceaseFire(): void {
    if (!this.fireLoop) return;
    this.fireLoop.stop(0.08);
    this.fireLoop = null;
    this.ctx.audio.play('minigun_fire', { pitch: 0.78 });
  }
}

export const VULCAN30_PLUGIN: ArmPlugin = {
  kind: 'vulcan30',
  newsKinds: ['vulcan30'],
  create: ctx => new Vulcan30ArmGun(ctx),

  remoteFiring(ctx: Ctx, arm: Arm, _side, dt: number, state: ArmRemoteState): void {
    arm.turn(VULCAN30.barrelRate * dt);
    state.accum += dt * VULCAN30.rate;
    const rounds = Math.min(3, Math.floor(state.accum));
    if (rounds <= 0) return;
    state.accum -= rounds;
    arm.muzzle(_rFrom);
    arm.bore(_rBore);
    for (let i = 0; i < rounds; i++) {
      state.fired++;
      arm.recoil(VULCAN30.armRecoil);
      if (state.fired % 2 === 0) {
        ctx.fx.muzzleFlash(_rFrom, _rBore, 'autocannon');
        ctx.audio.play('autocannon_fire', _playRemoteShot);
        if (ctx.physics.raycastInto(_rFrom, _rBore, VULCAN30.range, CG.World, _rHit)) {
          ctx.fx.tracer(_rFrom, _rHit.point, 'hellfire');
          ctx.fx.impact(_rHit.point, _rHit.normal, _rHit.surface, 1.1);
        } else {
          ctx.fx.tracer(_rFrom, _rEnd.copy(_rFrom).addScaledVector(_rBore, VULCAN30.range), 'hellfire');
        }
      }
    }
  },

  remoteNews(ctx: Ctx, kind: MechKind, values: number[]): void {
    if (kind !== 'vulcan30' || values.length < 7) return;
    const roundIdx = Math.round(values[0]!);
    _rFrom.set(values[1]!, values[2]!, values[3]!);
    _rTo.set(values[4]!, values[5]!, values[6]!);
    const burst = values.length < 8 || values[7]! >= 0.5;
    _rDir.subVectors(_rTo, _rFrom);
    if (_rDir.lengthSq() < 1e-6) _rDir.set(0, 0, -1);
    else _rDir.normalize();
    _rNegDir.copy(_rDir).negate();

    const { fx, audio } = ctx;
    fx.muzzleFlash(_rFrom, _rDir, 'autocannon');
    const tracerKind = roundIdx === 1 ? 'ap' : roundIdx === 2 ? 'api' : 'hellfire';
    fx.tracer(_rFrom, _rTo, tracerKind);

    if (!burst) return;
    if (roundIdx === 1) {
      fx.sparks(_rTo, _rNegDir, 12, '#cfe4ff');
      fx.impact(_rTo, _rNegDir, 'metal', 1.4);
    } else if (roundIdx === 2) {
      fx.explosion(_rTo, _flakFxOpts);
      fx.ring(_rTo, _rDir, '#ff7030', VULCAN30.flak.radius * 1.8);
      fx.sparks(_rTo, _rDir, 12, '#ff9830');
      fx.smoke(_rTo, 0x3b3530, 1.3, 0.5);
      audio.play('cannon_burst', _playRemoteFlak);
      flakCone(_rDir, VULCAN30.flak.cone, _rFlakPellets);
      for (let i = 0; i < _rFlakPellets.length; i++) {
        fx.tracer(_rTo, _rEnd.copy(_rTo).addScaledVector(_rFlakPellets[i]!, VULCAN30.flak.reach * 0.6), 'heavy');
      }
    } else {
      fx.explosion(_rTo, _heFxOpts);
      fx.ring(_rTo, _rNegDir, '#ff9830', VULCAN30.he.radius * 1.15);
      fx.sparks(_rTo, _rNegDir, 10, '#ffb040');
      audio.play('30mmshell_explode', _playRemoteHe);
    }
  },
};
