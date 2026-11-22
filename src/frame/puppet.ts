/**
 * Another player's Distraint Frame, drawn on this screen (co-op). It is the same body and arms as the one a player sits in
 * (`StandIn`, the two `Gun`s), seen from outside, and it does only what it is told: the pilot's own Frame (seat.ts) sends
 * its pose a few times a second and a word for each shell, missile, stomp, smoke and backhand.
 *
 *   pose(values)      a `MechPose` from the pilot, or null as they leave it
 *   news(kind, v)     link.ts `MechKind`
 *   stand(feet, yaw)  empty and waiting: a call-in's Frame coming down, or standing for its pilot
 *   update(dt)        every frame
 *
 * It hurts nothing. Its rotary draws tracers to where the pilot's sight is, its shells and missiles fly and burst for the
 * look, and its feet raise dust; the damage is all the pilot's own game's. Give it a context that hurts nothing
 * (callins/ghost.ts) and it cannot.
 *
 * It wears the pilot's loadout (loadout.ts): the pose ends with its `kitIds`, so each arm carries what the pilot's does (a
 * rotary on either side draws its tracers, the 105 mm fires its own shell), and a swap mid-mission shows on the next pose.
 *
 * It also stands in for the Frame in a call-in's drop (`DroppedFrame`, callins/frameDrop.ts). Anything that puts a player in
 * a Frame gets a puppet on the other screens with no further work: a call-in, a mission's beat, `?frame=1`.
 */
import * as THREE from 'three';
import type { Ctx, LoopHandle } from '../core/contracts';
import type { ProjectileSpec, ShotSpec } from '../core/gameplay';
import { clamp, dampAngle, randomInCone } from '../core/math';
import { Ac130Rounds, ROUND_KINDS } from '../progression/callins/ac130Rounds';
import type { DroppedFrame } from '../progression/callins/frameDrop';
import type { MechKind } from '../progression/callins/link';
import { TELL_EVERY } from '../progression/callins/shared';
import type { ModelMaterials } from '../progression/modelkit';
import type { Gun } from '../vehicles/guns';
import { ArmRack } from './arms';
import { ARM_REGISTRY, dispatchArmRemoteNews } from './arms/registry';
import type { Arm, ArmRemoteState } from './arms/types';
import { FRAME_PLACES, StandIn } from './cockpit';
import { FRAME } from './data';
import { armsOf, defaultLoadout, KIT_LENGTH, kitFrom, LEGACY_KIT_LENGTH, type ArmKind, type ArmSide } from './loadout';
import {
  MECH_FIRING, MECH_FIRING_RIGHT, MECH_FLYING, MECH_HOVER, MECH_JET_MODE, MECH_JETS, MECH_PARKED, MECH_TREADS,
} from './seat';
import { dispatchShoulderRemoteNews } from './shoulders/registry';
import { podMissile, shellImpact, smokeScreen } from './weapons';

/**
 * `[feetX, feetY, feetZ, legYaw, viewYaw, stride, walk, dip, sway, sightX, sightY, sightZ, flags]`: where it stands, where
 * the legs and the hull point, how far through its stride it is and how hard it is walking, the hull's sink and sway, the
 * spot its guns are on, and `MECH_FIRING | MECH_JETS | MECH_PARKED | MECH_FIRING_RIGHT | MECH_FLYING | MECH_JET_MODE | MECH_TREADS | MECH_HOVER`.
 */
export const MECH_POSE = 13;
/** A pose with the pilot's loadout after it: `MECH_POSE` numbers, then `KIT_LENGTH` (8) part numbers. A bare pose is the standard Frame. */
export const MECH_POSE_KIT = MECH_POSE + KIT_LENGTH;
/** Legacy 2-shoulder pose length (`MECH_POSE + 7`), accepted when decoding older peers. */
export const MECH_POSE_LEGACY_KIT = MECH_POSE + LEGACY_KIT_LENGTH;

const R = FRAME.rotary;
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
/** Seconds without a word from the pilot before the puppet is taken for gone. */
const LOST = 4;
/** How fast the drawn pose closes on the told one, as a rate. */
const FOLLOW = 14;

const _pivot = new THREE.Vector3();
const _to = new THREE.Vector3();
const _at = new THREE.Vector3();
const _v = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _bore = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _aim = new THREE.Vector3();

export class FramePuppet implements DroppedFrame {
  /** Where it stands, as drawn. */
  readonly walker = { feet: new THREE.Vector3() };
  /** A pilot is currently seated inside it (false while parked empty, so the remote player's body reappears). */
  occupied = false;
  /** Live on the map (either piloted or parked empty). */
  deployed = false;
  private readonly body: StandIn;
  private readonly rack: ArmRack;
  /** What each arm carries, from the pilot's last pose. */
  private leftKind: ArmKind = 'rotary';
  private rightKind: ArmKind = 'cannon40';
  private readonly kit = new Float64Array(KIT_LENGTH).fill(Number.NaN);
  private readonly rounds: Ac130Rounds;
  private readonly missile: ProjectileSpec = podMissile();
  private readonly shot: ShotSpec = {
    damage: 0, source: 'frame_rotary', team: 'player', maxDistance: R.range, tracerFrom: _muzzle, impactScale: R.impactScale, burst: R.burst,
  };
  /** The pose as told, and as drawn. */
  private readonly target = new Float64Array(MECH_POSE);
  private legYaw = 0;
  private viewYaw = 0;
  private stride = 0;
  private walk = 0;
  private dip = 0;
  private sway = 0;
  private readonly sight = new THREE.Vector3();
  private flags = 0;
  private quiet = 0;
  /** Per arm, left then right: the rotary's spin, the next round, rounds fired, fire loop, and plugin remote state. */
  private readonly spin = [0, 0];
  private readonly shotIn = [0, 0];
  private readonly fired = [0, 0];
  private readonly fireLoop: (LoopHandle | null)[] = [null, null];
  private readonly remoteState: [ArmRemoteState, ArmRemoteState] = [{ accum: 0, fired: 0 }, { accum: 0, fired: 0 }];
  private readonly armProxies: [Arm, Arm];
  private flameIn = 0;
  /** Seconds left of the backhand's swing, or below zero. */
  private swing = -1;
  private jetLoop: LoopHandle | null = null;

  /** `ctx` must be one that hurts nothing (callins/ghost.ts): the shells, missiles and tracers here go through its combat. */
  constructor(private readonly ctx: Ctx, materials: ModelMaterials) {
    const { scene } = ctx.render;
    this.body = new StandIn(materials, scene);
    this.rack = new ArmRack(materials, scene, [['left', 'rotary'], ['right', 'cannon40']]);
    this.rounds = new Ac130Rounds(ctx, materials);
    this.rounds.onImpact = (kind, point, normal, dir) => shellImpact(ctx, kind, point, normal, dir);
    const makeArm = (side: ArmSide): Arm => ({
      muzzle: out => this.gunOf(side).muzzle(out),
      bore: out => this.gunOf(side).bore(out),
      turn: radians => this.gunOf(side).turn(radians),
      recoil: metres => this.gunOf(side).recoil(metres),
    });
    this.armProxies = [makeArm('left'), makeArm('right')];
  }

  /** The hull's own position, for whoever needs to know where another player's Frame is. */
  get position(): THREE.Vector3 {
    return this.walker.feet;
  }

  /** What `side` carries, as the pilot last said. */
  armOf(side: ArmSide): ArmKind {
    return side === 'left' ? this.leftKind : this.rightKind;
  }

  private gunOf(side: ArmSide): Gun {
    return this.rack.gun(side, this.armOf(side));
  }

  /** The two arm guns where they hang, every other one hidden. */
  private armPlaces(): readonly (readonly [Gun, readonly [number, number, number]])[] {
    const left = this.gunOf('left'), right = this.gunOf('right');
    this.rack.only(left, right);
    return [[left, FRAME_PLACES.rotary], [right, FRAME_PLACES.cannon]];
  }

  /** The pilot's loadout from the end of a pose; nothing changes unless a number did. A bare pose is the standard Frame. */
  private wearKit(values: readonly number[]): void {
    const kitLen = values.length >= MECH_POSE_KIT ? KIT_LENGTH
      : values.length >= MECH_POSE_LEGACY_KIT ? LEGACY_KIT_LENGTH
      : 0;
    let same = true;
    for (let i = 0; i < KIT_LENGTH; i++) {
      const v = i < kitLen ? values[MECH_POSE + i]! : -2;
      if (this.kit[i] !== v) same = false;
      this.kit[i] = v;
    }
    if (same) return;
    const loadout = kitLen > 0 ? kitFrom(values.slice(MECH_POSE, MECH_POSE + kitLen)) : defaultLoadout();
    const arms = armsOf(loadout);
    const yaw = this.viewYaw;
    this.leftKind = arms.left;
    this.rightKind = arms.right;
    this.body.setLoadout(loadout);
    this.gunOf('left').snap(yaw, 0);
    this.gunOf('right').snap(yaw, 0);
    this.rack.only(this.gunOf('left'), this.gunOf('right'));
  }

  /** The pilot's word: where the Frame is and what it is doing. Null when destroyed or cleared. */
  pose(values: readonly number[] | null): void {
    if (!values || values.length < MECH_POSE) {
      if (this.deployed || this.occupied) this.empty();
      return;
    }
    for (let i = 0; i < MECH_POSE; i++) this.target[i] = values[i]!;
    this.wearKit(values);
    this.quiet = 0;
    const parked = ((values[12]! | 0) & MECH_PARKED) !== 0;
    this.occupied = !parked;
    if (this.deployed) {
      if (parked) this.silence();
      return;
    }
    // The first word: it is simply there.
    this.deployed = true;
    this.walker.feet.set(values[0]!, values[1]!, values[2]!);
    this.legYaw = values[3]!;
    this.viewYaw = values[4]!;
    this.stride = values[5]!;
    this.sight.set(values[9]!, values[10]!, values[11]!);
    this.gunOf('left').snap(this.viewYaw, parked ? -0.35 : 0);
    this.gunOf('right').snap(this.viewYaw, parked ? -0.35 : 0);
  }

  news(kind: MechKind, v: readonly number[]): void {
    const { ctx } = this;
    const { audio, camera, fx, physics, player, render } = ctx;
    const feet = this.walker.feet;
    switch (kind) {
      case 'shell': {
        const round = ROUND_KINDS[v[0]!];
        if (v.length < 8 || (round !== 'g40' && round !== 'ap' && round !== 'flak' && round !== 'g105')) return;
        // Which arm: the ninth number, 0 left and 1 right; a shell without it is the right arm's, as it always was.
        const gun = this.gunOf(v[8] === 0 ? 'left' : 'right');
        _muzzle.set(v[1]!, v[2]!, v[3]!);
        _aim.set(v[4]!, v[5]!, v[6]!);
        this.rounds.fire(round, _muzzle, _aim, clamp(v[7]!, 0.01, 10), 0, Infinity);
        fx.muzzleFlash(_muzzle, _dir.subVectors(_aim, _muzzle).normalize(), 'autocannon');
        if (round === 'g105') {
          // The 105 mm as its pilot hears it, from outside: the big flash, the rings and the boom (weapons.ts `howitzerShell`).
          this.rounds.flash(_muzzle, 3.4, 0.12, 12, 8.5, 4, 2.2);
          fx.ring(_v.copy(_muzzle).addScaledVector(_dir, 0.8), _dir, '#ffaa44', 3.4);
          fx.smoke(_v.copy(_muzzle).addScaledVector(_dir, 3.6), 0x9aa0a6, 2.6, 1.8);
          audio.play('howitzer_shot', { position: _muzzle, volume: 1.35, pitch: 0.96 });
          gun.recoil(1.1);
        } else {
          this.rounds.flash(_muzzle, 1.6, 0.07, 9, 10, 5, 1.4);
          audio.play('autocannon_fire', { position: _muzzle, volume: 1.4, pitch: round === 'ap' ? 0.8 : 0.72 });
          gun.recoil(0.45);
        }
        break;
      }
      case 'missile': {
        if (v.length < 6) return;
        const p = this.missile;
        p.origin.set(v[0]!, v[1]!, v[2]!);
        p.velocity.set(v[3]!, v[4]!, v[5]!);
        ctx.combat.spawnProjectile(p);
        fx.smoke(p.origin, 0xb9b4aa, 0.9, 1.4);
        audio.play('quiver_fire', { position: p.origin, pitchJitter: 0.05, pitch: 0.85 });
        break;
      }
      case 'stomp': {
        const k = (v[0] ?? 0) >= FRAME.stomp.big ? 1 : FRAME.stomp.small;
        fx.slam(feet, 3.2 * k);
        this.dustRing(feet, 2.4 * k, 10, 2.4 * k);
        this.dustRing(feet, 5.2 * k, 16, 3 * k);
        fx.chips(feet, 0x6f6a63, Math.round(28 * k));
        render.decals?.add('crack', feet, UP, 11 * k, 0);
        physics.radialImpulse(_v.copy(feet).setY(feet.y + 0.5), FRAME.stomp.radius * k, 90 * k);
        audio.play('titan_stomp', { position: feet, pitch: 0.85 });
        audio.play('slam_impact', { position: feet, pitch: 0.55 });
        audio.play('explosion_debris', { position: feet, volume: 0.7 * k });
        camera.addTrauma(Math.max(0, (0.55 + 0.45 * k) * (1 - player.position.distanceTo(feet) / 40)));
        break;
      }
      case 'sweep': {
        const at = v.length >= 3 ? _at.set(v[0]!, v[1]!, v[2]!) : feet;
        fx.ring(_v.copy(at).setY(at.y + 0.8), UP, '#ffaa40', 5.2);
        this.dustRing(at, 3.2, 12, 1.8);
        audio.play('enemy_swing', { position: at, pitch: 0.48, volume: 0.9 });
        audio.play('slam_impact', { position: at, pitch: 0.75, volume: 0.7 });
        break;
      }
      case 'smoke':
        smokeScreen(ctx, this.rounds, feet, this.viewYaw, feet);
        break;
      case 'swing':
        this.swing = 0;
        _at.copy(feet);
        _at.y += 2.2;
        fx.slash(_at, UP, _v.set(Math.cos(this.viewYaw), 0, -Math.sin(this.viewYaw)), FRAME.backhand.arc, FRAME.backhand.reach, 'sweep');
        audio.play('enemy_swing', { position: _at, pitch: 0.45 });
        break;
      default: {
        const arr = v as number[];
        if (!dispatchArmRemoteNews(ctx, kind, arr)) {
          dispatchShoulderRemoteNews(ctx, kind, arr);
        }
        break;
      }
    }
  }

  /** Standing empty on `feet`, facing `yaw`. */
  stand(feet: THREE.Vector3, yaw: number): void {
    if (this.deployed) return;
    this.walker.feet.copy(feet);
    this.legYaw = this.viewYaw = yaw;
    this.body.pose(feet, yaw, yaw, 0, 0, 0, 0, false, _eye, { parked: true });
    for (const [gun, place] of this.armPlaces()) {
      this.body.place(place, _pivot);
      gun.snap(yaw, -0.35);
      gun.point(_pivot, yaw, -0.35, 0);
    }
  }

  /** Nobody on this screen ever boards a puppet. */
  board(): void {}

  /** An empty one gone from the scene. A deployed one stays until its pilot's word. */
  hide(): void {
    if (this.deployed) return;
    this.body.hide();
    this.rack.hideAll();
  }

  /** Gone, whoever was in it: the player left the match, or a new run. Shells in the air are dropped. */
  clear(): void {
    this.empty();
    this.rounds.clear();
  }

  private empty(): void {
    this.deployed = false;
    this.occupied = false;
    this.flags = 0;
    this.silence();
    this.body.hide();
    this.rack.hideAll();
  }

  private silence(): void {
    for (let i = 0; i < 2; i++) {
      this.fireLoop[i]?.stop(0.08);
      this.fireLoop[i] = null;
    }
    this.jetLoop?.stop(0.2);
    this.jetLoop = null;
  }

  update(dt: number): void {
    // Shells already in the air land whether or not anyone is still in it.
    this.rounds.update(this.ctx.time.dt);
    if (!this.deployed) return;
    this.quiet += dt;
    if (this.quiet > LOST) {
      this.empty();
      return;
    }
    const t = this.target;
    const k = 1 - Math.exp(-FOLLOW * dt);
    const feet = this.walker.feet;
    _to.set(t[0]!, t[1]!, t[2]!);
    // A jump across the map (a mission's beat, a redeploy) is not flown through.
    if (feet.distanceToSquared(_to) > 30 * 30) feet.copy(_to);
    else feet.lerp(_to, k);
    this.legYaw = dampAngle(this.legYaw, t[3]!, FOLLOW, dt);
    this.viewYaw = dampAngle(this.viewYaw, t[4]!, FOLLOW, dt);
    const strideWas = this.stride;
    // The stride only ever runs on, so it is closed on and never eased back over a plant.
    this.stride = Math.max(this.stride, this.stride + (t[5]! - this.stride) * k);
    if (Math.abs(t[5]! - this.stride) > 4) this.stride = t[5]!;
    this.walk += (t[6]! - this.walk) * k;
    this.dip += (t[7]! - this.dip) * k;
    this.sway += (t[8]! - this.sway) * k;
    this.sight.lerp(_to.set(t[9]!, t[10]!, t[11]!), k);
    this.flags = t[12]! | 0;
    const parked = (this.flags & MECH_PARKED) !== 0;
    const jets = (this.flags & MECH_JETS) !== 0;
    const flying = (this.flags & MECH_FLYING) !== 0;
    const jetMode = (this.flags & MECH_JET_MODE) !== 0;
    const hover = (this.flags & MECH_HOVER) !== 0;
    const treads = (this.flags & MECH_TREADS) !== 0;

    this.body.pose(feet, this.legYaw, this.viewYaw, this.stride, this.walk, this.dip, this.sway, false, _eye, {
      parked, jets, flying, jetMode, hover, treads, dt,
    });
    if (!parked && Math.floor(this.stride) !== Math.floor(strideWas) && this.walk > 0.05) this.footfall();
    if (parked) {
      for (const [gun, place] of this.armPlaces()) {
        this.body.place(place, _pivot);
        gun.point(_pivot, this.viewYaw, -0.35, dt);
      }
      this.silence();
      return;
    }
    this.arms(dt);
    this.remoteFire(dt, 'left', MECH_FIRING);
    this.remoteFire(dt, 'right', MECH_FIRING_RIGHT);
    this.jets(dt);
  }

  private arms(dt: number): void {
    let sweep = 0;
    if (this.swing >= 0) {
      this.swing += dt / 0.32;
      sweep = this.swing < 1 ? -0.5 + 2.1 * this.swing : -1;
      if (this.swing >= 1) this.swing = -1;
    }
    const left = this.gunOf('left'), right = this.gunOf('right');
    this.rack.only(left, right);
    this.aim(left, FRAME_PLACES.rotary, dt, 0);
    this.aim(right, FRAME_PLACES.cannon, dt, this.swing >= 0 ? sweep : 0);
  }

  private aim(gun: Gun, place: readonly [number, number, number], dt: number, sweep: number): void {
    this.body.place(place, _pivot);
    _to.subVectors(this.sight, _pivot);
    const yaw = Math.atan2(-_to.x, -_to.z) + sweep;
    const pitch = Math.atan2(_to.y, Math.hypot(_to.x, _to.z)) - Math.abs(sweep) * 0.3;
    if (sweep !== 0) gun.snap(yaw, pitch);
    gun.point(_pivot, yaw, pitch, dt);
  }

  /** Continuous firing playback on an arm: standard rotary tracers/loop, or delegated to `ARM_REGISTRY[kind].remoteFiring`. */
  private remoteFire(dt: number, side: ArmSide, flag: number): void {
    const { audio, combat, fx } = this.ctx;
    const i = side === 'left' ? 0 : 1;
    const kind = this.armOf(side);
    const active = (this.flags & flag) !== 0;

    if (kind !== 'rotary') {
      if (this.fireLoop[i]) {
        this.fireLoop[i]!.stop(0.08);
        this.fireLoop[i] = null;
      }
      this.spin[i] = 0;
      if (active) {
        ARM_REGISTRY[kind].remoteFiring?.(this.ctx, this.armProxies[i]!, side, dt, this.remoteState[i]!);
      }
      return;
    }

    const firing = active;
    this.spin[i] = clamp(this.spin[i]! + (firing ? dt / R.spinUp : -dt / R.spinDown));
    const gun = this.gunOf(side);
    gun.turn(this.spin[i]! * R.barrelRate * dt);
    if (!firing) {
      const loop = this.fireLoop[i];
      if (loop) {
        loop.stop(0.08);
        this.fireLoop[i] = null;
        audio.play('minigun_fire', { position: this.walker.feet });
      }
      this.shotIn[i] = 0;
      return;
    }
    gun.muzzle(_muzzle);
    const loop = this.fireLoop[i] ??= audio.startLoop('minigun_fire_loop', { fadeIn: 0.03, pitch: R.rate / 25, position: _muzzle });
    loop?.setPosition(_muzzle);
    this.shotIn[i]! -= dt;
    for (let k = 0; this.shotIn[i]! <= 0 && k < 3; k++) {
      this.shotIn[i]! += 1 / R.rate;
      const fired = ++this.fired[i]!;
      gun.bore(_bore);
      randomInCone(_dir.subVectors(this.sight, _muzzle).normalize(), R.spread, _dir);
      this.shot.tracer = fired % R.tracerEvery === 0 ? 'heavy' : undefined;
      combat.fireRay(_muzzle, _dir, this.shot);
      if (fired % R.flashEvery === 0) fx.muzzleFlash(_muzzle, _bore, 'rotary');
    }
    if (this.shotIn[i]! < 0) this.shotIn[i] = 0;
  }

  private jets(dt: number): void {
    const { audio, fx } = this.ctx;
    if ((this.flags & MECH_JETS) === 0) {
      this.jetLoop?.stop(0.25);
      this.jetLoop = null;
      return;
    }
    this.body.place(FRAME_PLACES.jets, _at);
    this.jetLoop ??= audio.startLoop('flame_loop', { fadeIn: 0.05, pitch: 0.55, position: _at });
    this.jetLoop?.setPosition(_at);
    this.flameIn -= dt;
    if (this.flameIn > 0) return;
    this.flameIn = 0.05;
    fx.flame(_at, DOWN, 1.4);
    fx.smoke(_at.setY(_at.y - 1.5), 0x9a9690, 1.6, 1.2);
  }

  /** A foot down, heard and seen from outside. */
  private footfall(): void {
    const { audio, camera, fx, player } = this.ctx;
    const feet = this.walker.feet;
    const side = Math.floor(this.stride) % 2 === 0 ? -1 : 1;
    const c = Math.cos(this.legYaw);
    const s = Math.sin(this.legYaw);
    _at.set(feet.x + c * side * 1.05 - s * 0.4, feet.y, feet.z - s * side * 1.05 - c * 0.4);
    const k = clamp(this.walk, 0.4, 1);
    audio.play('juggernaut_step', { position: _at, pitch: 0.7, volume: 0.9 * k, pitchJitter: 0.05 });
    fx.dust(_at, UP, 1.1 * k);
    camera.addTrauma(Math.max(0, 0.12 * k * (1 - player.position.distanceTo(feet) / 25)));
  }

  private dustRing(at: THREE.Vector3, radius: number, count: number, scale: number): void {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      _v.set(at.x + Math.cos(a) * radius, at.y, at.z + Math.sin(a) * radius);
      this.ctx.fx.dust(_v, UP, scale);
    }
  }
}

/** Seconds between a pilot's poses: the caller's own clock for them is the call-ins' (`TELL_EVERY`). */
export const MECH_EVERY = TELL_EVERY;
