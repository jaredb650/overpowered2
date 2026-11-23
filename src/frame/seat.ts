/**
 * The Distraint Frame: a persistent heavy-armoured Bureau walker (`4000 HP` standard) that stays on the map until destroyed.
 *
 *   Lifecycle     `deploy(feet, yaw)` parks a fresh Frame in the world; `board(feet, yaw)` deploys and climbs
 *                 straight in; `E` disembarks safely beside it (leaving it parked with preserved health and position)
 *                 and `E` beside a parked Frame climbs back in. At 0 HP it explodes, ejecting the pilot safely.
 *   Movement      WASD walk, mouse look (free within ±80° of the legs; dragging past turns them), Space jump-jets /
 *                 flight / hover, crouch in mid-air stomps (or Spider leg sweep), Shift charges / jet-mode / run,
 *                 walking tramples (or Treads crush) anyone hugging the chassis.
 *   Weapons       LMB left arm (tap `1` cycles left arm rounds/mode), RMB right arm (tap `2` cycles right arm
 *                 rounds/mode), `R` manual reload only (never cycles ammo), `G` / `V` / `B` shoulder slots 1–3
 *                 (`3` / `4` / `5` cycle shoulder rounds), `Q` smoke/flares + close concussive pulse, `F` alternating
 *                 2-arm melee sweep (190° front arc + 4 m 360° close-proximity sweep), wheel zooms.
 */
import * as THREE from 'three';
import { CG, type Ctx, type LoopHandle, type PlayerDamage, type RayHit } from '../core/contracts';
import { clamp, lerp, rand, wrapAngle } from '../core/math';
import { Ac130Rounds, ROUND_KINDS } from '../progression/callins/ac130Rounds';
import type { MechKind } from '../progression/callins/link';
import { TELL_EVERY, type Aircraft } from '../progression/callins/shared';
import { CALLINS } from '../progression/data';
import type { ModelMaterials } from '../progression/modelkit';
import { Gun } from '../vehicles/guns';
import type { GunnerWeapon } from '../vehicles/hud';
import { GunnerSeat, type SeatRig } from '../vehicles/seat';
import { ArmRack } from './arms';
import { FRAME_PLACES, StandIn } from './cockpit';
import { FrameCockpitSensor } from './cockpitSensor';
import { Walker, type WalkerIntent } from './controller';
import { FRAME, framePlan, type FrameArmWeapon } from './data';
import {
  armPart, armsOf, DEFAULT_FRAME_LOADOUT, defaultLoadout, frameStats, kitIds, normalizeLoadout, shouldersOf,
  type ArmKind, type ArmSide, type FrameLoadout, type FrameStats,
} from './loadout';
import { routeOpenSeatHit } from './openSeat';
import { FrameParts } from './parts';
import { backhand, crush, FrameGuns, legSweep, ROUND_NAMES, shove, stomp, trample, treadCrush, type Arm, type ArmMount } from './weapons';

/**
 * Co-op: how the Frame is told to the other screens, which draw a stand-in of it (puppet.ts `FramePuppet`).
 * `pose` is `MechPose` a few times a second (with `MECH_PARKED` when standing empty), and null when destroyed or cleared.
 */
export interface FrameNet {
  pose(values: number[] | null): void;
  news(kind: MechKind, values?: number[]): void;
}

/**
 * The `flags` bitmask of a `MechPose`: continuous arm fire, jets/flight/jet-mode/hover/treads, or parked empty on the field.
 * After the 13 numbers of the pose come the loadout's `kitIds` (loadout.ts), so the others draw the parts it really wears.
 */
export const MECH_FIRING = 1;
export const MECH_JETS = 2;
export const MECH_PARKED = 4;
export const MECH_FIRING_RIGHT = 8;
export const MECH_FLYING = 16;
export const MECH_JET_MODE = 32;
export const MECH_TREADS = 64;
export const MECH_HOVER = 128;

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
/** The parked body's eye over its feet, so it rides with its head in the cockpit. */
const BODY_EYE = 1.6;
/** Seconds the arm takes across the front in a melee sweep. */
const SWING = 0.28;
const GUN_REACH = 60;
const INTERACT_GUARD = 0.25;
const FRAME_COLOR = CALLINS.frame.color;
/** Seconds for the kneeling-to-standing cockpit startup self-test. */
const BOOT_SECONDS = 2.4;
/** Seconds for Old Mother's 25 m emergency canopy eject arc. */
const EJECT_SECONDS = 1.65;

interface KneelState {
  feet: THREE.Vector3;
  yaw: number;
  done: () => void;
  unprompt: (() => void) | null;
  unmark: (() => void) | null;
  standing: number;
}

interface EjectState {
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  done: () => void;
  slowed: boolean;
}

/** Candidate local (right, forward) exit offsets around the mech when disembarking (metres). */
const EXIT_OFFSETS: readonly (readonly [number, number])[] = [
  [-3.2, 1.4], [3.2, 1.4], [3.5, 0], [-3.5, 0], [0, 3.6], [0, -3.6], [2.6, -2.4], [-2.6, -2.4],
];

const _pivot = new THREE.Vector3();
const _to = new THREE.Vector3();
const _at = new THREE.Vector3();
const _v = new THREE.Vector3();
const _right = new THREE.Vector3();
const _cand = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _hit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'concrete', collider: null };

export class Frame {
  readonly walker: Walker;
  readonly guns: FrameGuns;
  readonly parts = new FrameParts();
  /** True while a live Frame stands in the world (either parked or piloted). */
  deployed = false;
  /** True while Old Mother is breaching the hull prior to canopy eject. */
  breach = false;
  private readonly body: StandIn;
  private readonly sensor = new FrameCockpitSensor();
  /** The arm guns, built per side and kind as the loadout wants them (arms.ts). */
  private readonly rack: ArmRack;
  /** The loadout this Frame is built from (loadout.ts), and what its parts add up to. */
  private kitNow: FrameLoadout = defaultLoadout();
  private stats: FrameStats = frameStats(this.kitNow);
  private seat: GunnerSeat | null = null;
  private readonly frame = new THREE.Quaternion();
  /** The eye, as posed this frame. */
  private readonly eye = new THREE.Vector3();
  private readonly intent: WalkerIntent = { moveX: 0, moveZ: 0, viewYaw: 0, jet: false, stomp: false, charge: false, chargeHeld: false, viewPitch: 0 };
  /** The hull sinking on its legs, metres (negative is down), and how fast: a critically damped spring back to 0. */
  private dip = 0;
  private dipV = 0;
  private swing = -1;
  /** Alternating melee arm: +1 right cannon gauntlet backhand, -1 left rotary forehand. */
  private swingArm: 1 | -1 = 1;
  private backhandIn = 0;
  private flameIn = 0;
  private smokeFxIn = 0;
  private interactGuard = 0;
  private trampleClock = 0;
  private readonly trampleTimes = new Map<number, number>();
  private wasStomping = false;
  private readonly struck = new Set<number>();
  private jetLoop: LoopHandle | null = null;
  private servo: LoopHandle | null = null;
  private servoQuiet = 0;
  private readonly jetRow: GunnerWeapon = { name: '', ammo: 0, max: 100 };
  private readonly intercept = (damage: PlayerDamage): boolean => this.hit(damage);
  private unmark: (() => void) | null = null;
  private unprompt: (() => void) | null = null;
  private readonly markerPos = new THREE.Vector3();
  private readonly promptPos = new THREE.Vector3();
  private boot = 1;
  private sapperLeft = -1;
  private sapperBeepIn = 0;
  private sapperSide: -1 | 1 = 1;
  private kneelState: KneelState | null = null;
  private ejectState: EjectState | null = null;
  private collapsedPose: { feet: THREE.Vector3; yaw: number } | null = null;
  private aircraftAdapter: Aircraft | null = null;
  /** Co-op: set while there are other players to tell (callins/manager.ts). */
  net: FrameNet | null = null;
  private tellIn = 0;
  private told = false;

  constructor(private readonly ctx: Ctx, materials: ModelMaterials, private readonly rig: SeatRig, private readonly onBoard: () => void) {
    const { scene } = ctx.render;
    this.walker = new Walker(ctx.physics, ctx.world.bounds?.min?.y ?? -Infinity);
    this.body = new StandIn(materials, scene);
    // The standard Frame's guns and Foreclosure's howitzer now; any other only when a loadout first wears it.
    this.rack = new ArmRack(materials, scene, [['left', 'rotary'], ['right', 'cannon40'], ['right', 'howitzer105']]);
    // Each arm is whichever gun its side carries now.
    const arm = (side: ArmSide): Arm => ({
      muzzle: out => this.armGun(side).muzzle(out),
      bore: out => this.armGun(side).bore(out),
      turn: radians => this.armGun(side).turn(radians),
      recoil: metres => this.armGun(side).recoil(metres),
    });
    const shoulderMount = (slot: number, out: THREE.Vector3): THREE.Vector3 => {
      const p = FRAME_PLACES.shoulders[slot] ?? FRAME_PLACES.pod;
      return this.body.place([p[0], p[1], p[2] - 0.7], out);
    };
    this.guns = new FrameGuns(
      ctx,
      new Ac130Rounds(ctx, materials),
      arm('left'),
      arm('right'),
      out => this.body.place(TUBES, out),
      shoulderMount,
    );
    this.guns.onShell = (round, from, aim, seconds, side) =>
      this.net?.news('shell', [ROUND_KINDS.indexOf(round), from.x, from.y, from.z, aim.x, aim.y, aim.z, seconds, side === 'left' ? 0 : 1]);
    this.guns.onMissile = (from, velocity) => this.net?.news('missile', [from.x, from.y, from.z, velocity.x, velocity.y, velocity.z]);
    this.guns.onNews = (kind, values) => this.net?.news(kind, values);
  }

  /** Maximum hull hit points for the active loadout (`4000` for standard legs + standard cockpit). */
  get maxHealth(): number {
    return this.parts.maxHp;
  }

  /** What the right arm carries now. */
  get armWeapon(): ArmKind {
    return this.guns.right.kind;
  }

  /** The loadout this Frame is built from now (Foreclosure's howitzer included). */
  get loadout(): FrameLoadout {
    return this.kitNow;
  }

  private mount(side: ArmSide): ArmMount {
    return side === 'left' ? this.guns.left : this.guns.right;
  }

  private armGun(side: ArmSide): Gun {
    return this.rack.gun(side, this.mount(side).kind);
  }

  private get leftGun(): Gun {
    return this.armGun('left');
  }

  private get rightGun(): Gun {
    return this.armGun('right');
  }

  /** The two arm guns where they hang, every other one hidden. */
  private armPlaces(): readonly (readonly [Gun, readonly [number, number, number]])[] {
    const left = this.leftGun, right = this.rightGun;
    this.rack.only(left, right);
    return [[left, FRAME_PLACES.rotary], [right, FRAME_PLACES.cannon]];
  }

  /** Builds it from `loadout`: arms, shoulders, visual chassis, armour pools, and gait/drive plug-ins. */
  private fit(loadout: FrameLoadout): void {
    this.kitNow = normalizeLoadout(loadout);
    this.stats = frameStats(this.kitNow);
    const arms = armsOf(this.kitNow);
    this.guns.fitArms(arms.left, arms.right);
    this.guns.fitShoulders(shouldersOf(this.kitNow));
    this.body.setLoadout(this.kitNow);
    this.parts.configure({
      hullScale: this.stats.hullScale,
      legArmor: this.stats.legArmor,
      canopyScale: this.stats.canopyScale,
    });
    this.walker.fuelScale = this.stats.fuelScale;
    this.walker.setMovement(this.stats.gait, this.stats.drive);
    this.rack.only(this.leftGun, this.rightGun);
    if (this.seat) {
      this.seat.weapons.length = 0;
      this.seat.weapons.push(...this.guns.rows, this.jetRow);
    }
  }

  /**
   * A call-in's Frame on its way down shows the loadout it will land with (callins/frameDrop.ts). Never while someone is in it;
   * `deploy` builds it for real.
   */
  wear(loadout: FrameLoadout): void {
    if (this.occupied) return;
    this.fit(loadout);
  }

  /**
   * Permanently installs a modular right-arm ordnance package (`cannon40` or `howitzer105`): swaps the 3D right-arm
   * cannon mesh, updates HUD and ammo clocks, and plays heavy hydraulic install audio + callout unless `quiet`.
   */
  installWeapon(weapon: FrameArmWeapon, quiet = false): void {
    this.kitNow = { ...this.kitNow, rightArm: armPart('right', weapon) };
    this.guns.installArmWeapon(weapon);
    this.rack.only(this.leftGun, this.rightGun);
    if (this.occupied && this.seat) {
      this.aim(this.rightGun, FRAME_PLACES.cannon, this.seat, 0, 0);
      this.panel(this.seat);
    } else if (this.deployed) {
      this.poseParked();
    }
    if (!quiet) {
      const { audio, hud, camera } = this.ctx;
      audio.play('metal_groan', { pitch: 0.62, volume: 0.95 });
      audio.play('steam_burst', { pitch: 0.7, volume: 0.85 });
      audio.play('tank_turret_stop', { pitch: 0.65, volume: 0.9 });
      hud.callout?.(weapon === 'howitzer105' ? '105MM HOWITZER INSTALLED' : '40MM AUTOCANNON INSTALLED');
      camera?.addTrauma?.(0.35);
    }
  }

  /** Remaining hull hit points (`0..maxHealth`), backed by `parts`. */
  get health(): number {
    return this.parts.hp;
  }

  /** Co-op: this frame's pose for the other screens, `TELL_EVERY` seconds apart. */
  private say(dt: number, seat: GunnerSeat): void {
    this.tellIn -= dt;
    if (this.tellIn > 0) return;
    this.tellIn = Math.max(0, this.tellIn + TELL_EVERY);
    this.told = true;
    const w = this.walker;
    const walk = w.grounded ? clamp(w.speed / FRAME.walk.forward) : 0;
    const sway = this.stats.noSway ? 0 : FRAME.feel.sway * Math.sin(w.stride * Math.PI) * walk;
    const { input } = this.ctx;
    const leftFiring = this.guns.left.spinning && (this.guns.left.kind !== 'rotary' || input.isDown('fire'));
    const rightFiring = this.guns.right.spinning && (this.guns.right.kind !== 'rotary' || input.isDown('aim'));
    const flags = (leftFiring ? MECH_FIRING : 0)
      | (rightFiring ? MECH_FIRING_RIGHT : 0)
      | (w.jetting && !w.grounded ? MECH_JETS : 0)
      | (w.flying ? MECH_FLYING : 0)
      | (w.jetMode ? MECH_JET_MODE : 0)
      | (this.stats.gait === 'treads' ? MECH_TREADS : 0)
      | (w.hovering ? MECH_HOVER : 0);
    if (seat.range > 6) _to.copy(seat.point);
    else _to.copy(seat.aim).multiplyScalar(GUN_REACH).add(seat.view.position);
    this.net!.pose([w.feet.x, w.feet.y, w.feet.z, w.legYaw, w.viewYaw, w.stride, walk, this.dip, sway, _to.x, _to.y, _to.z,
      flags, ...kitIds(this.kitNow)]);
  }

  private sayParked(dt: number): void {
    if (!this.net) return;
    this.tellIn -= dt;
    if (this.tellIn > 0) return;
    this.tellIn = 0.5;
    this.told = true;
    const w = this.walker;
    const flags = MECH_PARKED | (this.stats.gait === 'treads' ? MECH_TREADS : 0);
    _to.set(-Math.sin(w.viewYaw), -0.35, -Math.cos(w.viewYaw)).multiplyScalar(20).add(this.eye);
    this.net.pose([w.feet.x, w.feet.y, w.feet.z, w.legYaw, w.viewYaw, w.stride, 0, 0, 0, _to.x, _to.y, _to.z, flags, ...kitIds(this.kitNow)]);
  }

  /** The player is currently seated inside it. */
  get occupied(): boolean {
    return this.seat !== null && this.seat.stage !== 'left';
  }

  /** Standing empty on the map, waiting for the player to walk up and board with E. */
  get parked(): boolean {
    return this.deployed && !this.occupied;
  }

  /** True while a sapper explosive is ticking on one of the Frame's legs. */
  get hasSapper(): boolean {
    return this.sapperLeft >= 0;
  }

  /** Arms a sapper charge on a leg. Stomp or backhand knocks it loose before detonation. */
  attachSapper(seconds = 5, side?: -1 | 1): void {
    if (!this.occupied || this.sapperLeft >= 0) return;
    this.sapperLeft = seconds;
    this.sapperBeepIn = 0;
    this.sapperSide = side ?? (Math.random() < 0.5 ? -1 : 1);
    this.ctx.audio.play('metal_clang', { pitch: 1.4, volume: 0.7 });
    this.ctx.hud.feed('CHARGE ON LEG — STOMP OR BACKHAND', FRAME_COLOR);
  }

  /** Clears an active sapper charge safely (stomp or backhand). */
  clearSapper(): boolean {
    if (this.sapperLeft < 0) return false;
    this.sapperLeft = -1;
    this.ctx.audio.play('metal_clang', { pitch: 0.9, volume: 0.8 });
    this.ctx.hud.feed('SAPPER CHARGE KNOCKED FREE', '#7ee787');
    return true;
  }

  /** Progressive cockpit canopy crack stage (0..3) from hull wear and direct canopy hits (0 when no canopy). */
  get crackStage(): number {
    if (this.stats.canopyScale <= 0) return 0;
    const ratio = this.health / this.maxHealth;
    const hullCracks = ratio <= 0.2 ? 3 : ratio <= 0.45 ? 2 : ratio <= 0.7 ? 1 : 0;
    return Math.max(this.parts.cracks, hullCracks);
  }

  /**
   * Deploy a fresh Frame standing parked at `feet`, facing `yaw`, built from `loadout` (a call-in passes the player's;
   * a mission's beat the standard Frame). Replaces any previously deployed Frame.
   */
  deploy(feet: THREE.Vector3, yaw: number, loadout: Readonly<FrameLoadout> = DEFAULT_FRAME_LOADOUT): void {
    if (this.seat) {
      this.seat.leave(true);
      this.releaseSeat();
    }
    this.clearKneel();
    this.clearParkedUi();
    this.collapsedPose = null;
    this.breach = false;
    this.sapperLeft = -1;
    this.boot = 1;
    this.guns.reset();
    this.fit(loadout);
    this.parts.reset();
    this.walker.speedScale = 1;
    this.walker.place(feet, yaw);
    this.guns.podOnline = this.parts.podOnline && this.stats.shoulders > 0;
    this.deployed = true;
    this.dip = this.dipV = 0;
    this.swing = -1;
    this.swingArm = 1;
    this.backhandIn = 0;
    this.trampleTimes.clear();
    this.interactGuard = 0.15;
    this.poseParked();
    this.showParkedMarker();
    this.tellIn = 0;
    this.sayParked(0);
  }

  /** Deploy a fresh Frame at `feet`, facing `yaw`, and climb straight in. */
  board(feet: THREE.Vector3, yaw: number, seconds = Infinity, playBoot = false, loadout: Readonly<FrameLoadout> = DEFAULT_FRAME_LOADOUT): void {
    this.deploy(feet, yaw, loadout);
    this.boot = playBoot ? 0 : 1;
    this.enter(seconds);
    if (playBoot) this.ctx.audio.play('steam_burst', { pitch: 0.7, volume: 0.8 });
  }

  /** Climb into the already-deployed parked Frame, preserving its health, position, and weapon state. */
  enter(seconds = Infinity): void {
    if (!this.deployed || this.occupied || this.health <= 0) return;
    const { audio, player } = this.ctx;
    this.clearParkedUi();
    this.dip = this.dipV = 0;
    this.swing = -1;
    this.interactGuard = INTERACT_GUARD;
    const yaw = this.walker.viewYaw;
    const seat = new GunnerSeat(this.ctx, this.rig, { ...framePlan(), seconds });
    seat.fixed(this.walker.feet);
    seat.noWayOut = false;
    seat.weapons.push(...this.guns.rows, this.jetRow);
    this.seat = seat;
    seat.board();
    player.interceptor = this.intercept;
    this.pose(0);
    this.rack.only(this.leftGun, this.rightGun);
    this.leftGun.snap(yaw, 0);
    this.rightGun.snap(yaw, 0);
    _to.set(-Math.sin(yaw), 0, -Math.cos(yaw)).multiplyScalar(30).add(this.eye);
    seat.sit(_to, this.eye);
    this.panel(seat);
    this.onBoard();
    audio.play('metal_groan', { pitch: 0.7 });
    audio.play('tank_turret_stop', { pitch: 0.7 });
  }

  /**
   * Campaign `mount`: the Frame kneels on `feet`, waiting for the player to press E beside it.
   * Boarding plays the hydraulic rise + cockpit boot diagnostic and fires `done()`.
   */
  kneel(feet: THREE.Vector3, yaw: number, done: () => void): void {
    if (this.seat) this.leave(true);
    this.clearKneel();
    this.clearParkedUi();
    this.deployed = false;
    this.collapsedPose = null;
    const f = feet.clone();
    const unmark = this.ctx.hud.marker(_at.copy(f).setY(f.y + 4.5).clone(), 'DISTRAINT FRAME', FRAME_COLOR);
    this.kneelState = { feet: f, yaw, done, unprompt: null, unmark, standing: -1 };
    this.poseKneeling(1);
    this.ctx.audio.play('steam_burst', { position: f, pitch: 0.65, volume: 0.8 });
  }

  /**
   * Campaign `mother` -> `deck`: Old Mother's cutter wheel breaches the hull; the canopy blows, the Frame collapses smoking,
   * and the player arcs 25 m through the air onto `target` with a brief slow-mo slam window.
   */
  ejectTo(target: THREE.Vector3, done: () => void): void {
    const { audio, camera, fx, player, render } = this.ctx;
    const from = this.occupied ? this.eye.clone() : player.position.clone().setY(player.position.y + 2);
    const feet = this.walker.feet.clone();
    const yaw = this.walker.legYaw;
    this.deployed = false;
    this.clearParkedUi();
    if (this.seat) {
      this.seat.leave(true);
      this.releaseSeat();
    }
    this.collapsedPose = { feet, yaw };
    this.body.setPoseState(0, 1, 3, 0, true);
    this.body.pose(feet, yaw, yaw, 0, 0, -0.4, 0, false, this.eye, { parked: true });
    fx.explosion(from, { radius: 4, kind: 'rocket', scale: 1.1 });
    fx.chips(from, 0x8a9aa8, 22);
    audio.play('glass_break', { volume: 1 });
    audio.play('explosion_debris', { volume: 0.9 });
    audio.play('titan_stomp', { pitch: 0.7 });
    camera.addTrauma(0.9);
    render.post.radialBlur(0.65, 0.5);
    player.teleport(from);
    this.ejectState = { from, to: target.clone(), t: 0, done, slowed: false };
    this.ctx.hud.feed('EJECTED — HOLD CROUCH TO SLAM ONTO THE DECK', '#ffc14a');
  }

  /** Adapter handed to `AntiAir` while the Frame is crewed so rocketeers can lock top-attack missiles onto it. */
  asAircraft(): Aircraft {
    if (!this.aircraftAdapter) {
      const self = this;
      this.aircraftAdapter = {
        get position() { return self.eye; },
        get where() { return self.walker.feet; },
        sources: 'frame_',
        hits: 99,
        get flares() { return self.guns.smoke.count; },
        set flares(_v: number) {},
        rounds: 0,
        get flown() { return self.occupied; },
        autoFlares: false,
        get huntable() { return self.occupied; },
        drawsFlares: false,
        hit() {
          self.hit({ amount: 420, type: 'explosive', source: 'aa_top_attack', from: _at.copy(self.eye).setY(self.eye.y + 18) });
          self.ctx.audio.play('rocket_explosion', { volume: 1 });
          self.ctx.camera.addTrauma(0.75);
          return !self.parts.alive;
        },
        shot() { return false; },
        popFlares() { return self.guns.popSmoke(self.walker.feet, self.walker.viewYaw); },
        down() {},
        update() { return !self.occupied; },
        dispose() {},
      };
    }
    return this.aircraftAdapter;
  }

  /** Disembark beside the Frame cleanly, leaving it parked where you stood with its health preserved. */
  leave(quiet = false): void {
    const seat = this.seat;
    if (!seat) return;
    const { audio, player } = this.ctx;
    seat.leave(quiet);
    this.releaseSeat();
    this.interactGuard = INTERACT_GUARD;
    this.findExitSpot(_at);
    player.teleport(_at, this.walker.viewYaw);
    if (this.deployed && this.health > 0) {
      this.poseParked();
      this.showParkedMarker();
      this.tellIn = 0;
      this.sayParked(0);
      if (!quiet) {
        audio.play('steam_burst', { volume: 0.75, pitch: 0.75 });
        audio.play('metal_groan', { pitch: 0.85, volume: 0.65 });
      }
    } else {
      this.hideMeshes();
      this.clearNet();
    }
  }

  /** Standing empty on `feet`, facing `yaw`, seen from outside (during drop-pod descent before landing). */
  stand(feet: THREE.Vector3, yaw: number): void {
    if (this.seat) return;
    this.body.setPoseState(0, 0, 0, 0, false);
    this.body.pose(feet, yaw, yaw, 0, 0, 0, 0, false, this.eye, { parked: true, treads: this.stats.gait === 'treads' });
    for (const [gun, place] of this.armPlaces()) {
      this.body.place(place, _pivot);
      gun.snap(yaw, -0.35);
      gun.point(_pivot, yaw, -0.35, 0);
    }
  }

  /** An empty Frame gone from the scene (if not deployed and not occupied). */
  hide(): void {
    this.clearKneel();
    this.collapsedPose = null;
    if (!this.seat && !this.deployed) this.hideMeshes();
  }

  /** A new run: out and gone, nothing left on the map or in the air. */
  clear(): void {
    this.clearKneel();
    if (this.ejectState?.slowed) this.ctx.time.popScale('frame_eject');
    this.ejectState = null;
    this.collapsedPose = null;
    this.breach = false;
    this.sapperLeft = -1;
    this.boot = 1;
    this.kitNow = defaultLoadout();
    this.stats = frameStats(this.kitNow);
    this.parts.configure();
    this.parts.reset();
    this.walker.speedScale = 1;
    this.walker.fuelScale = 1;
    this.walker.setMovement('walker', 'jets');
    this.body.setLoadout(this.kitNow);
    this.guns.podOnline = true;
    this.deployed = false;
    this.clearParkedUi();
    this.seat?.leave(true);
    this.releaseSeat();
    this.sensor.clear();
    this.hideMeshes();
    this.clearNet();
    this.guns.reset();
    this.trampleTimes.clear();
  }

  private clearKneel(): void {
    if (!this.kneelState) return;
    this.kneelState.unprompt?.();
    this.kneelState.unmark?.();
    this.kneelState = null;
  }

  private poseKneeling(kneel: number): void {
    const ks = this.kneelState;
    if (!ks) return;
    this.body.setPoseState(kneel, 0, 0, 0, false);
    this.body.pose(ks.feet, ks.yaw, ks.yaw, 0, 0, 0, 0, false, this.eye, { parked: true });
    for (const [gun, place] of this.armPlaces()) {
      this.body.place(place, _pivot);
      gun.snap(ks.yaw, -0.45);
      gun.point(_pivot, ks.yaw, -0.45, 0);
    }
  }

  update(dt: number): void {
    if (this.interactGuard > 0) this.interactGuard = Math.max(0, this.interactGuard - dt);
    if (this.ejectState) this.updateEject(dt);
    if (this.kneelState) {
      this.updateKneel(dt);
      return;
    }
    const seat = this.seat;
    if (!seat) {
      if (this.collapsedPose) {
        const c = this.collapsedPose;
        this.body.setPoseState(0, 1, 3, 0, true);
        this.body.pose(c.feet, c.yaw, c.yaw, 0, 0, -0.4, 0, false, this.eye, { parked: true });
        return;
      }
      if (this.deployed) this.updateParked(dt);
      return;
    }
    if (seat.stage === 'left') {
      // Death or external eject emptied the seat: release controls and leave mech parked if still intact.
      this.releaseSeat();
      if (this.deployed && this.health > 0) {
        this.poseParked();
        this.showParkedMarker();
        this.tellIn = 0;
        this.sayParked(0);
      } else {
        this.hideMeshes();
        this.clearNet();
      }
      return;
    }
    if (seat.left <= 0) {
      this.leave();
      return;
    }
    if (this.boot < 1) {
      this.boot = Math.min(1, this.boot + dt / BOOT_SECONDS);
    }
    this.parts.tick(dt);
    this.tickSapper(dt);
    const { input, player, camera } = this.ctx;
    // E disembarks cleanly like a vehicle, leaving the mech parked on the map.
    if (!seat.noWayOut && this.interactGuard <= 0 && input.pressed('interact')) {
      this.leave();
      return;
    }
    const w = this.walker;
    w.speedScale = this.parts.speedScale * this.stats.walk * this.guns.walkSpeedMult;
    w.jumpScale = this.stats.jump;
    w.dashScale = this.stats.dash;
    w.strafeScale = this.stats.strafe;
    w.turnScale = this.stats.turnRate;
    w.fuelScale = this.stats.fuelScale;
    this.guns.podOnline = this.parts.podOnline && this.stats.shoulders > 0;
    const it = this.intent;
    it.moveX = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
    it.moveZ = (input.isDown('forward') ? 1 : 0) - (input.isDown('back') ? 1 : 0);
    it.viewYaw = seat.yaw - input.frameLook.x * player.sensitivity * player.lookScale;
    it.jet = input.isDown('jump');
    it.stomp = input.pressed('slide');
    it.charge = input.pressed('dash');
    it.chargeHeld = input.isDown('dash');
    it.viewPitch = seat.pitch;
    w.update(dt, it);
    this.feel(dt);
    this.pose(dt);
    this.frame.setFromAxisAngle(UP, w.legYaw + Math.PI);
    seat.update(dt, this.frame, this.eye);
    seat.view.roll = this.stats.noSway ? 0
      : FRAME.feel.roll * Math.sin(w.stride * Math.PI) * clamp(w.speed / FRAME.walk.forward) * (w.grounded ? 1 : 0);
    camera.syncSeat();
    this.aimGuns(dt, seat);
    this.guns.update(dt, seat, {
      recoilMult: this.stats.noRecoil ? 0 : 1,
      feet: w.feet,
      torsoYaw: w.viewYaw,
    });
    if (this.net) this.say(dt, seat);
    if (input.pressed('weaponLast') || input.pressed('stim')) {
      if (this.guns.popSmoke(w.feet, w.viewYaw)) this.net?.news('smoke');
      else this.ctx.audio.play('weapon_dry');
    }
    this.sensor.update(this.ctx, this.stats.sensorRange, w.feet, this.stats.sensorRange > 0);
    this.blows(dt);
    this.damageEffects(dt);
    this.panel(seat);
    _at.copy(this.eye);
    _at.y -= BODY_EYE;
    player.carry(_at);
  }

  private updateKneel(dt: number): void {
    const ks = this.kneelState;
    if (!ks) return;
    const { hud, input, player } = this.ctx;
    if (ks.standing >= 0) {
      ks.standing = Math.min(1, ks.standing + dt / 0.85);
      this.poseKneeling(1 - ks.standing);
      if (ks.standing >= 1) {
        const { feet, yaw, done } = ks;
        this.clearKneel();
        this.board(feet, yaw, Infinity, true);
        done();
      }
      return;
    }
    this.poseKneeling(1);
    const near = player.alive
      && Math.hypot(player.position.x - ks.feet.x, player.position.z - ks.feet.z) < FRAME.hull.boardReach
      && Math.abs(player.position.y - ks.feet.y) < 4;
    if (near && !ks.unprompt) {
      ks.unprompt = hud.follow(_at.copy(ks.feet).setY(ks.feet.y + 2.4).clone(), `${input.labelFor?.('interact') ?? 'E'} BOARD DISTRAINT FRAME`, FRAME_COLOR);
    } else if (!near && ks.unprompt) {
      ks.unprompt();
      ks.unprompt = null;
    }
    if (near && input.pressed('interact')) {
      ks.unprompt?.();
      ks.unprompt = null;
      ks.unmark?.();
      ks.unmark = null;
      this.ctx.audio.play('metal_groan', { pitch: 0.72, volume: 0.9 });
      this.ctx.audio.play('steam_burst', { pitch: 0.65, volume: 0.85 });
      const { feet, yaw, done } = ks;
      this.clearKneel();
      this.board(feet, yaw, Infinity, true);
      done();
    }
  }

  private updateEject(dt: number): void {
    const ej = this.ejectState;
    if (!ej) return;
    const realDt = this.ctx.time.realDt || dt;
    ej.t += realDt;
    const u = clamp(ej.t / EJECT_SECONDS, 0, 1);
    // Dramatic 25 m apex arc onto the target deck.
    const apex = Math.max(ej.from.y, ej.to.y) + 25;
    const x = lerp(ej.from.x, ej.to.x, u);
    const z = lerp(ej.from.z, ej.to.z, u);
    const base = lerp(ej.from.y, ej.to.y, u);
    const y = base + 4 * (apex - base) * u * (1 - u);
    _at.set(x, y, z);
    this.ctx.player.teleport(_at);
    // Brief slow-motion peak over Old Mother's deck so the player reads the slam opportunity.
    if (u >= 0.42 && u <= 0.82 && !ej.slowed) {
      ej.slowed = true;
      this.ctx.time.pushScale('frame_eject', 0.35, 0.08, 0.3);
    } else if (u > 0.82 && ej.slowed) {
      ej.slowed = false;
      this.ctx.time.popScale('frame_eject');
    }
    if (u >= 1) {
      if (ej.slowed) this.ctx.time.popScale('frame_eject');
      const done = ej.done;
      this.ejectState = null;
      this.ctx.player.teleport(ej.to);
      this.ctx.audio.play('slam_impact', { volume: 0.8 });
      this.ctx.camera.addTrauma(0.55);
      done();
    }
  }

  private tickSapper(dt: number): void {
    if (this.sapperLeft < 0) return;
    this.sapperLeft -= dt;
    this.sapperBeepIn -= dt;
    if (this.sapperBeepIn <= 0) {
      this.sapperBeepIn = lerp(0.1, 0.42, clamp(this.sapperLeft / 5));
      this.ctx.audio.play('aa_lock', { pitch: 1.35, volume: 0.8 });
    }
    if (this.sapperLeft <= 0) {
      this.sapperLeft = -1;
      const w = this.walker;
      _at.set(
        w.feet.x + Math.cos(w.viewYaw) * this.sapperSide * 1.4,
        w.feet.y + 1.2,
        w.feet.z - Math.sin(w.viewYaw) * this.sapperSide * 1.4,
      );
      this.ctx.fx.explosion(_at, { radius: 4, kind: 'rocket', scale: 1.2 });
      this.ctx.audio.play('rocket_explosion', { position: _at, volume: 1 });
      this.hit({ amount: 650, type: 'explosive', source: 'sapper_charge', from: _at });
    }
  }

  /** Parked empty on the map: cool/reload weapons passively, show board prompt when near, E climbs back in. */
  private updateParked(dt: number): void {
    this.guns.idleUpdate(dt);
    this.poseParked();
    this.damageEffects(dt);
    this.sayParked(dt);
    const { hud, input, player } = this.ctx;
    const feet = this.walker.feet;
    const near = player.alive && !this.rig.occupied
      && Math.hypot(player.position.x - feet.x, player.position.z - feet.z) <= FRAME.hull.boardReach
      && Math.abs(player.position.y - feet.y) < 3.5;
    if (near && !this.unprompt) {
      const pct = Math.ceil((this.health / this.maxHealth) * 100);
      this.promptPos.set(feet.x, feet.y + 2.6, feet.z);
      this.unprompt = hud.follow(this.promptPos, `${input.labelFor?.('interact') ?? 'E'} BOARD DISTRAINT 4 (${pct}%)`, FRAME_COLOR);
    } else if (!near && this.unprompt) {
      this.unprompt();
      this.unprompt = null;
    }
    if (near && this.interactGuard <= 0 && input.pressed('interact')) this.enter();
  }

  private poseParked(): void {
    const w = this.walker;
    this.body.setPoseState(0, 0, this.crackStage, this.parts.limpSide, !this.parts.podOnline);
    this.body.pose(w.feet, w.legYaw, w.viewYaw, 0, 0, 0, 0, false, this.eye, {
      parked: true, jets: false, cracks: this.crackStage, treads: this.stats.gait === 'treads',
    });
    for (const [gun, place] of this.armPlaces()) {
      this.body.place(place, _pivot);
      gun.snap(w.viewYaw, -0.35);
      gun.point(_pivot, w.viewYaw, -0.35, 0);
    }
  }

  private showParkedMarker(): void {
    this.unmark?.();
    const feet = this.walker.feet;
    const pct = Math.ceil((this.health / this.maxHealth) * 100);
    this.markerPos.set(feet.x, feet.y + 6.4, feet.z);
    this.unmark = this.ctx.hud.marker(this.markerPos, `DISTRAINT 4 · ${pct}%`, FRAME_COLOR);
  }

  private clearParkedUi(): void {
    this.unmark?.();
    this.unmark = null;
    this.unprompt?.();
    this.unprompt = null;
  }

  /** Finds a clear, walkable ground spot beside the mech so exiting never clips into walls or drops through geometry. */
  private findExitSpot(out: THREE.Vector3): THREE.Vector3 {
    const { physics, world } = this.ctx;
    const feet = this.walker.feet;
    const yaw = this.walker.viewYaw;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    _origin.set(feet.x, feet.y + 1.5, feet.z);
    for (const [rx, fwd] of EXIT_OFFSETS) {
      // Right = (c, 0, -s), Forward = (-s, 0, -c).
      const dx = c * rx - s * fwd;
      const dz = -s * rx - c * fwd;
      const dist = Math.hypot(dx, dz);
      _v.set(dx / dist, 0, dz / dist);
      // 1. No wall between the mech center and the exit spot.
      if (physics.raycastInto(_origin, _v, dist + 0.6, CG.World, _hit)) continue;
      // 2. Solid floor underneath within step range.
      _cand.set(feet.x + dx, feet.y + 2.8, feet.z + dz);
      if (physics.raycastInto(_cand, DOWN, 6.0, CG.World, _hit)) {
        const fy = _hit.point.y;
        if (Math.abs(fy - feet.y) <= 2.6) {
          // 3. Headroom above the landing spot.
          _cand.set(feet.x + dx, fy + 0.25, feet.z + dz);
          if (!physics.raycastInto(_cand, UP, 2.0, CG.World, _hit)) {
            return out.set(feet.x + dx, fy + 0.05, feet.z + dz);
          }
        }
      }
    }
    if (world.nav.nearest(feet, 8, out)) return out;
    return out.set(feet.x + c * 3.2, feet.y, feet.z - s * 3.2);
  }

  // ---- the body and the view ----------------------------------------------------------------------------------

  private pose(dt: number): void {
    const w = this.walker;
    const walk = w.grounded ? clamp(w.speed / FRAME.walk.forward) : 0;
    const sway = this.stats.noSway ? 0 : FRAME.feel.sway * Math.sin(w.stride * Math.PI) * walk;
    const kneel = this.boot < 1 ? (1 - this.boot) * 0.8 : 0;
    this.body.setPoseState(kneel, 0, this.crackStage, this.parts.limpSide, !this.parts.podOnline);
    this.body.pose(w.feet, w.legYaw, w.viewYaw, w.stride, walk, this.dip, sway, true, this.eye, {
      parked: false,
      jets: w.jetting && !w.grounded,
      cracks: this.crackStage,
      flying: w.flying,
      jetMode: w.jetMode,
      hover: w.hovering,
      treads: this.stats.gait === 'treads',
      dt,
    });
    if (dt > 0) this.backhandIn = Math.max(0, this.backhandIn - dt);
  }

  /** Down into the legs by `depth` metres at most, and back up on the spring. */
  private sink(depth: number): void {
    this.dipV -= depth * FRAME.feel.spring * Math.E;
  }

  private feel(dt: number): void {
    const F = FRAME.feel;
    const w = this.walker;
    const s = w.said;
    const { audio, camera } = this.ctx;
    this.dip = clamp(this.dip - s.shift, -2, 1.5);
    if (s.steps > 0) this.footfall();
    if (s.swept) this.swept();
    if (s.stomped >= 0) this.stomped(s.stomped, s.stompMult);
    else if (s.landed > 3) {
      const k = clamp(s.landed / 18);
      this.sink(Math.min(F.landDipMax, s.landed * F.landDip));
      camera.addTrauma(0.15 + 0.45 * k);
      camera.kick(0.02 + 0.03 * k, 0, 0);
      audio.play('land_hard', { pitch: 0.5, volume: 0.6 + 0.4 * k });
      audio.play('juggernaut_slam', { pitch: 0.8, volume: 0.5 * k });
      this.dustRing(w.feet, 2.6, 8, 0.8 + k);
    }
    if (w.stomping && !this.wasStomping) {
      audio.play('slam_start', { pitch: 0.6 });
      this.ctx.render.post.radialBlur(0.35, 0.4);
    }
    this.wasStomping = w.stomping;
    if (s.lifted) {
      audio.play('flame_ignite', { pitch: 0.7 });
      audio.play('steam_burst', { pitch: 0.6, volume: 0.9 });
      camera.addTrauma(0.3);
      camera.kick(0.025, 0, 0);
      this.sink(0.35);
      this.dustRing(w.feet, 3, 10, 1.2);
    }
    this.jets(dt);
    this.servos(dt);
    const k2 = F.spring * F.spring;
    this.dipV += (-k2 * this.dip - 2 * F.spring * this.dipV) * dt;
    this.dip += this.dipV * dt;
  }

  /** Spider Legs 360° 5 m knockdown sweep around the chassis. */
  private swept(): void {
    const { audio, camera, fx, enemies, world } = this.ctx;
    const at = this.walker.feet;
    this.net?.news('sweep', [at.x, at.y, at.z]);
    this.clearSapper();
    legSweep(enemies, at);
    world.objects?.damageExplosivesInRadius?.(at, 5, 110, 'frame_stomp');
    fx.ring(_v.copy(at).setY(at.y + 0.8), UP, '#ffaa40', 5.2);
    this.dustRing(at, 3.2, 12, 1.8);
    audio.play('enemy_swing', { pitch: 0.48, volume: 1 });
    audio.play('slam_impact', { pitch: 0.75, volume: 0.8 });
    camera.addTrauma(0.4);
    this.sink(0.28);
  }

  /** A foot down: a thump in the eye, dust, and anyone or any market stall under it. */
  private footfall(): void {
    const F = FRAME.feel;
    const w = this.walker;
    const { audio, camera, fx, enemies, world } = this.ctx;
    const k = clamp(w.speed / FRAME.walk.forward, 0.4, 1);
    const side = Math.floor(w.stride) % 2 === 0 ? -1 : 1;
    const c = Math.cos(w.legYaw);
    const sn = Math.sin(w.legYaw);
    _at.set(w.feet.x + c * side * 1.05 - sn * 0.4, w.feet.y, w.feet.z - sn * side * 1.05 - c * 0.4);
    this.sink(F.stepDip * k);
    camera.kick(F.stepKick * k, 0, side * 0.004);
    camera.addTrauma(F.stepTrauma * k);
    audio.play('land_hard', { pitch: 0.48, volume: 0.45 + 0.35 * k, pitchJitter: 0.04 });
    audio.play('juggernaut_step', { pitch: 0.7, volume: 0.6 * k, pitchJitter: 0.05 });
    fx.dust(_at, UP, 1.1 * k);
    if (crush(enemies, _at) > 0) audio.play('gib_squelch', { position: _at });
    world.objects?.damageExplosivesInRadius?.(_at, 2.4, 60, 'frame_stomp');
  }

  /** The big slam, twice the size, from `height`, scaled by leg stomp stats and dive-bomb multiplier. */
  private stomped(height: number, mult = 1): void {
    const S = FRAME.stomp;
    const { audio, camera, fx, physics, render, enemies, world } = this.ctx;
    const at = this.walker.feet;
    const ringScale = this.stats.stomp * mult;
    const powerScale = this.stats.stompPower * mult;
    const k = height >= S.big ? 1 : S.small;
    this.net?.news('stomp', [height]);
    this.clearSapper();
    stomp(enemies, at, height, ringScale, powerScale);
    world.objects?.damageExplosivesInRadius?.(at, S.radius * k * ringScale, 160 * k * powerScale, 'frame_stomp');
    enemies.vehicles?.frameBlow?.(at, S.radius * k * ringScale, 240 * k * powerScale, null, 'frame_stomp');
    fx.slam(at, 3.2 * k * ringScale);
    this.dustRing(at, 2.4 * k * ringScale, 10, 2.4 * k * ringScale);
    this.dustRing(at, 5.2 * k * ringScale, 16, 3 * k * ringScale);
    fx.chips(at, 0x6f6a63, Math.round(28 * k * ringScale));
    render.decals?.add('crack', at, UP, 11 * k * ringScale, rand(0, Math.PI * 2));
    physics.radialImpulse(_v.copy(at).setY(at.y + 0.5), S.radius * k * ringScale, 90 * k * powerScale);
    audio.play('titan_stomp', { pitch: 0.85 });
    audio.play('land_hard', { pitch: 0.42 });
    audio.play('slam_impact', { pitch: 0.55 });
    audio.play('explosion_debris', { volume: 0.7 * k });
    render.post.radialBlur(0.55 * k, 0.3);
    render.post.chromatic(0.4 * k, 0.25);
    camera.addTrauma(0.55 + 0.45 * k);
    camera.kick(0.05, 0, 0);
    this.sink(FRAME.feel.stompDip * k);
  }

  private dustRing(at: THREE.Vector3, radius: number, count: number, scale: number): void {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      _v.set(at.x + Math.cos(a) * radius, at.y, at.z + Math.sin(a) * radius);
      this.ctx.fx.dust(_v, UP, scale);
    }
  }

  /** Smoke & sparks leaking from the dorsal reactor when hull integrity drops below 35%. */
  private damageEffects(dt: number): void {
    const ratio = this.health / this.maxHealth;
    if (ratio > 0.35) return;
    this.smokeFxIn -= dt;
    if (this.smokeFxIn > 0) return;
    this.smokeFxIn = ratio <= 0.2 ? 0.14 : 0.28;
    const { fx } = this.ctx;
    this.body.place(FRAME_PLACES.jets, _at);
    _at.y += 0.6;
    fx.smoke(_at, 0x2a2d32, ratio <= 0.2 ? 1.8 : 1.1, 1.5);
    if (ratio <= 0.2) fx.sparks(_at, UP, 6, '#ffaa30');
  }

  /** The burn while the jets are lit: a roar in the cockpit, a rumble in the eye, fire and smoke under the back. */
  private jets(dt: number): void {
    const w = this.walker;
    const { audio, camera, fx } = this.ctx;
    const lit = w.jetting && !w.grounded;
    if (lit) {
      this.jetLoop ??= audio.startLoop('flame_loop', { fadeIn: 0.05, pitch: 0.55, volume: 1 });
      camera.addTrauma(0.06);
      this.flameIn -= dt;
      if (this.flameIn <= 0) {
        this.flameIn = 0.05;
        this.body.place(FRAME_PLACES.jets, _at);
        fx.flame(_at, DOWN, 1.4);
        fx.smoke(_at.setY(_at.y - 1.5), 0x9a9690, 1.6, 1.2);
      }
    } else if (this.jetLoop) {
      this.jetLoop.stop(0.25);
      this.jetLoop = null;
    }
  }

  /** The hip servos, heard while the legs come round. */
  private servos(dt: number): void {
    const turned = this.walker.said.turned;
    const { audio } = this.ctx;
    if (turned > 1e-4) {
      this.servo ??= audio.startLoop('tank_turret_loop', { fadeIn: 0.06, volume: 0.55, pitch: 0.85 });
      this.servo.setPitch(0.75 + clamp(turned / Math.max(dt, 1e-3) / FRAME.turn.rate) * 0.35, 0.05);
      this.servoQuiet = 0.12;
    } else if (this.servo) {
      this.servoQuiet -= dt;
      if (this.servoQuiet > 0) return;
      this.servo.stop(0.1);
      this.servo = null;
      audio.play('tank_turret_stop', { volume: 0.6, pitch: 0.8 });
    }
  }

  // ---- the arms -----------------------------------------------------------------------------------------------

  /** Both guns turn toward the sight; melee swings alternate between right gauntlet backhand and left Vulcan forehand. */
  private aimGuns(dt: number, seat: GunnerSeat): void {
    let sweep = 0;
    if (this.swing >= 0) {
      this.swing += dt / SWING;
      // Wind-up then fast violent sweep across the front.
      sweep = this.swing < 1 ? (-0.55 + 2.3 * this.swing) * this.swingArm : 0;
      if (this.swing >= 1) this.swing = -1;
    }
    const leftSweep = this.swing >= 0 && this.swingArm === -1 ? sweep : 0;
    const rightSweep = this.swing >= 0 && this.swingArm === 1 ? sweep : 0;
    this.rack.only(this.leftGun, this.rightGun);
    this.aim(this.leftGun, FRAME_PLACES.rotary, seat, dt, leftSweep);
    this.aim(this.rightGun, FRAME_PLACES.cannon, seat, dt, rightSweep);
  }

  private aim(gun: Gun, place: readonly [number, number, number], seat: GunnerSeat, dt: number, sweep: number): void {
    this.body.place(place, _pivot);
    if (this.walker.armsLockedForward) {
      gun.point(_pivot, this.walker.viewYaw, seat.pitch, dt);
      return;
    }
    if (seat.range > 6) _to.subVectors(seat.point, _pivot);
    else _to.copy(seat.aim).multiplyScalar(GUN_REACH).add(seat.view.position).sub(_pivot);
    const yaw = Math.atan2(-_to.x, -_to.z) + sweep;
    const pitch = Math.atan2(_to.y, Math.hypot(_to.x, _to.z)) - Math.abs(sweep) * 0.25;
    if (sweep !== 0) gun.snap(yaw, pitch);
    gun.point(_pivot, yaw, pitch, dt);
  }

  // ---- the blows ----------------------------------------------------------------------------------------------

  private blows(dt: number): void {
    const w = this.walker;
    const s = w.said;
    const { audio, camera, fx, enemies, input, render, world } = this.ctx;
    this.trampleClock += dt;
    if (w.grounded && w.speed > 1.5) {
      const crushed = this.stats.crushOnDrive
        ? treadCrush(enemies, w.feet, this.trampleTimes, this.trampleClock)
        : trample(enemies, w.feet, this.trampleTimes, this.trampleClock);
      if (crushed > 0) {
        audio.play('gib_squelch', { position: w.feet, volume: 0.7 });
        camera.addTrauma(0.12);
      }
    }
    if (s.charged) {
      this.struck.clear();
      audio.play('titan_charge', { pitch: 1.2, volume: 0.8 });
      audio.play('dash', { pitch: 0.6 });
      render.post.radialBlur(0.4, 0.7);
      camera.fovPunch(9, 0.7);
      camera.addTrauma(0.3);
    }
    if (w.charging > 0) {
      const speed = w.speed;
      if (speed > 1) {
        _v.set(w.velocity.x / speed, 0, w.velocity.z / speed);
        _at.copy(w.feet).addScaledVector(_v, FRAME.body.radius + 0.6);
        _at.y += 1;
        if (shove(enemies, _at, _v, this.struck, w.feet) > 0) {
          audio.play('hit_punch', { pitch: 0.6 });
          audio.play('bone_crack');
          camera.addTrauma(0.25);
        }
        world.objects?.damageExplosivesInRadius?.(_at, FRAME.body.radius + 1.5, 180, 'frame_charge');
        const hit = enemies.vehicles?.frameCharge?.(_at, _v);
        if (hit === 'tank') {
          w.stopCharge(0.8);
          audio.play('metal_clang', { pitch: 0.55, volume: 1 });
          audio.play('land_hard', { pitch: 0.42 });
          fx.chips(_at, 0xffa040, 24);
          camera.addTrauma(0.8);
          camera.kick(0.06, 0, 0);
          this.sink(0.3);
        } else if (hit === 'soft') {
          audio.play('metal_clang', { pitch: 0.7, volume: 0.9 });
          audio.play('explosion_debris', { volume: 0.8 });
          fx.chips(_at, 0xffa040, 18);
          camera.addTrauma(0.5);
          this.sink(0.18);
        }
      }
    }
    if (s.bumped > 0) {
      _at.copy(w.feet).addScaledVector(_v.set(-Math.sin(w.viewYaw), 0, -Math.cos(w.viewYaw)), FRAME.body.radius);
      _at.y += 2;
      world.objects?.damageExplosivesInRadius?.(_at, 3.2, 220, 'frame_charge');
      audio.play('land_hard', { pitch: 0.45 });
      audio.play('metal_clang', { pitch: 0.6 });
      audio.play('concrete_crumble');
      fx.chips(_at, 0x8a8580, 16);
      fx.dust(_at, _v.negate(), 2);
      camera.addTrauma(0.7);
      camera.kick(0.05, 0, 0);
      this.sink(0.25);
    }
    if (input.pressed('melee') && this.backhandIn <= 0) {
      this.backhandIn = FRAME.backhand.every;
      this.swingArm = this.swingArm === 1 ? -1 : 1;
      this.swing = 0;
      this.net?.news('swing');
      this.clearSapper();
      const n = backhand(enemies, w.feet, w.viewYaw, this.swingArm);
      _at.copy(w.feet);
      _at.y += 2.2;
      _v.set(-Math.sin(w.viewYaw), 0, -Math.cos(w.viewYaw));
      _right.set(Math.cos(w.viewYaw) * this.swingArm, 0, -Math.sin(w.viewYaw) * this.swingArm);
      const ahead = _at.clone().addScaledVector(_v, 3.2);
      world.objects?.damageExplosivesInRadius?.(ahead, FRAME.backhand.reach, 110, 'frame_backhand');
      const vHit = enemies.vehicles?.frameBlow?.(ahead, FRAME.backhand.reach, 160, _v, 'frame_backhand') ?? 0;
      fx.slash(_at, UP, _right, FRAME.backhand.arc, FRAME.backhand.reach, 'sweep');
      fx.ring(_v.copy(w.feet).setY(w.feet.y + 0.8), UP, '#ffaa40', FRAME.backhand.closeRadius * 1.15);
      audio.play('enemy_swing', { pitch: 0.42, volume: 1 });
      camera.kick(0.015, 0.028 * this.swingArm, -0.022 * this.swingArm);
      if (n > 0 || vHit > 0) {
        audio.play('hit_punch', { pitch: 0.52, volume: 1 });
        audio.play('metal_clang', { pitch: 0.72, volume: 0.75 });
        if (n > 0) audio.play('bone_crack');
        fx.sparks(_at, _right, 14, '#ffcc66');
        camera.addTrauma(0.35);
      }
    }
  }

  // ---- the panel and hull integrity ---------------------------------------------------------------------------

  private panel(seat: GunnerSeat): void {
    const w = this.walker;
    const { rotary } = this.guns;
    this.guns.label();
    seat.heat = this.guns.heat || rotary.heat.value;
    seat.overheated = rotary.heat.overheated;
    seat.spin = rotary.spin;
    seat.legs = wrapAngle(w.legYaw - w.viewYaw);
    seat.hull = clamp(this.health / this.maxHealth);
    seat.hullText = `${Math.ceil(this.health)} / ${this.maxHealth}`;
    const snap = this.parts.snapshot(this.boot, this.breach, this.sapperLeft >= 0);
    snap.cracks = this.crackStage;
    seat.frameHud = snap;
    seat.marks = this.guns.marks;
    seat.altitude = w.grounded ? 0 : w.clearance();
    const key = (a: Parameters<Ctx['input']['labelFor']>[0]) => this.ctx.input.labelFor(a);
    this.jetRow.name = `${key('jump')} ${w.driveHudLabel} // ${key('dash')} CHG:${w.charges}`;
    this.jetRow.ammo = w.maxFuel > 0 ? Math.round((w.fuel / w.maxFuel) * 100) : 0;
    const tag = (m: ArmMount): string => {
      switch (m.kind) {
        case 'rotary': return m.rotary.mode === 'airburst' ? 'ROTARY AIRBURST' : 'ROTARY 20MM AP';
        case 'cannon40': return `40MM ${ROUND_NAMES[m.cannon.round]}`;
        case 'howitzer105': return '105MM HOWITZER';
        case 'vulcan30': return '30MM ROTARY';
        case 'beam': return 'RED BEAM';
        case 'cluster': return 'BOMBLET CANNON';
        case 'shotgun': return 'MECH SHOTGUN';
      }
    };
    seat.status = `${tag(this.guns.left)} · ${tag(this.guns.right)}`;
  }

  /**
   * Every hit while piloted routes through the Frame's armoured hull and locational parts (`parts.ts`):
   * Open Frame seat hits pass through directly to the pilot (`openSeat.ts`), Rotor Engine airborne hits take ×1.25,
   * light small-arms bounce cleanly with sparks, heavy bullets chip plates, snipers crack the canopy glass,
   * heavy ordnance damages legs/pod/hull, and hits from behind into the reactor vents deal bonus damage.
   */
  private hit(damage: PlayerDamage): boolean {
    if (!this.deployed || this.health <= 0) return false;
    if (routeOpenSeatHit(damage, this.walker.feet, this.walker.viewYaw, this.stats.openSeat)) {
      return false;
    }
    const effective = !this.walker.grounded && this.stats.airborneDamageMult !== 1
      ? { ...damage, amount: damage.amount * this.stats.airborneDamageMult }
      : damage;
    const prevCracks = this.crackStage;
    const res = this.parts.hit(effective, this.walker.feet, this.walker.viewYaw);
    const { audio, camera, hud, render } = this.ctx;
    if (res.blocked) {
      audio.play('metal_clang', { pitch: rand(1.45, 1.85), volume: 0.24 });
      camera.addTrauma(0.015);
      return true;
    }
    if (res.cracked) {
      audio.play('glass_break', { pitch: 1.15, volume: 0.7 });
      camera.kick(0.02, rand(-0.015, 0.015), 0);
      hud.feed('CANOPY GLASS FRACTURED', '#ff7a30');
    }
    if (res.part === 'reactor') {
      audio.play('plate_destroyed', { pitch: 0.75, volume: 0.9 });
      camera.addTrauma(0.45);
      render.post.chromatic(0.24, 0.16);
      hud.feed('REAR REACTOR HIT', FRAME_COLOR);
    } else if (res.dealt >= 40) {
      audio.play('metal_clang', { pitch: rand(0.6, 0.85), volume: 0.85 });
      audio.play('metal_groan', { pitch: rand(0.7, 0.95), volume: 0.55 });
      camera.addTrauma(clamp(res.dealt / 180, 0.12, 0.42));
      render.post.chromatic(0.22, 0.14);
    } else {
      audio.play('metal_clang', { pitch: rand(0.95, 1.3), volume: 0.38 });
      camera.addTrauma(0.035);
    }
    if (res.broke === 'leftLeg' || res.broke === 'rightLeg') {
      audio.play('metal_groan', { pitch: 0.55, volume: 0.9 });
      audio.play('explosion_debris', { volume: 0.65 });
      camera.addTrauma(0.65);
      hud.feed(res.broke === 'leftLeg' ? 'LEFT LEG CRIPPLED' : 'RIGHT LEG CRIPPLED', FRAME_COLOR);
    } else if (res.broke === 'pod') {
      audio.play('plate_destroyed', { pitch: 0.65, volume: 0.9 });
      camera.addTrauma(0.5);
      hud.feed('SHOULDER POD DESTROYED', FRAME_COLOR);
    }
    if (this.crackStage > prevCracks) {
      audio.play('concrete_crumble', { pitch: 1.4, volume: 0.75 });
      this.body.setCracks(this.crackStage);
    }
    this.walker.speedScale = this.parts.speedScale * this.stats.walk * this.guns.walkSpeedMult;
    this.guns.podOnline = this.parts.podOnline && this.stats.shoulders > 0;
    if (this.seat) this.panel(this.seat);
    if (res.killed || this.health <= 0) this.destroy();
    return true;
  }

  /** Hull failure: dramatic blast hurting surrounding enemies, safe emergency eject if piloted, and the Frame is gone. */
  destroy(): void {
    if (!this.deployed && !this.occupied) return;
    const { audio, camera, combat, fx, hud, player } = this.ctx;
    const H = FRAME.hull;
    const wasOccupied = this.occupied;
    this.deployed = false;
    this.parts.hp = 0;
    this.clearParkedUi();

    _at.copy(this.walker.feet);
    _at.y += 2.6;
    combat.explode(_at, {
      kind: 'rocket', source: 'frame_stomp', radius: H.explodeRadius, damage: H.explodeDamage,
      shake: 0.9, team: 'player', selfDamage: 0, playerPush: 0, worldObject: true,
    });
    fx.explosion(_at, { kind: 'rocket', radius: H.explodeRadius, scale: 2.2 });
    fx.ring(this.walker.feet, UP, '#ff5020', H.explodeRadius * 1.4);
    fx.sparks(_at, UP, 32, '#ffaa40');
    audio.play('explosion_debris', { position: _at, volume: 1 });
    audio.play('metal_groan', { position: _at, pitch: 0.55, volume: 1 });
    camera.addTrauma(0.9);
    hud.feed(wasOccupied ? 'DISTRAINT 4 DESTROYED // EMERGENCY EJECT' : 'DISTRAINT 4 DESTROYED', '#ff4a3a');

    if (this.seat) {
      this.seat.plan.grace = H.exitGrace;
      this.seat.leave(false);
    }
    this.releaseSeat();
    this.hideMeshes();
    this.clearNet();
    if (wasOccupied) {
      this.findExitSpot(_at);
      _at.y += 1.4;
      player.teleport(_at, this.walker.viewYaw);
    }
  }

  /** Releases seat ownership and active audio loops without hiding a still-deployed parked mech. */
  private releaseSeat(): void {
    this.seat = null;
    if (this.ctx.player.interceptor === this.intercept) this.ctx.player.interceptor = null;
    this.guns.silence();
    this.sensor.clear();
    this.jetLoop?.stop(0.2);
    this.jetLoop = null;
    this.servo?.stop(0.1);
    this.servo = null;
  }

  private hideMeshes(): void {
    this.body.hide();
    this.rack.hideAll();
  }

  private clearNet(): void {
    if (this.told) this.net?.pose(null);
    this.told = false;
    this.tellIn = 0;
  }
}

/** The pod's tube faces, at the front of the box on the right shoulder. */
const TUBES = [FRAME_PLACES.pod[0], FRAME_PLACES.pod[1], FRAME_PLACES.pod[2] - 0.7] as const;
