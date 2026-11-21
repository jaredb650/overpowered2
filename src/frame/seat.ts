/**
 * The Distraint Frame: a persistent heavy-armoured Bureau walker (`4000 HP`) that stays on the map until destroyed.
 *
 *   Lifecycle     `deploy(feet, yaw)` parks a fresh 4000 HP Frame in the world; `board(feet, yaw)` deploys and climbs
 *                 straight in; `E` disembarks safely beside it (leaving it parked with preserved health and position)
 *                 and `E` beside a parked Frame climbs back in. At 0 HP it explodes, ejecting the pilot safely.
 *   Movement      WASD walk, mouse look (free within ±80° of the legs; dragging past turns them), Space jump-jets
 *                 (hold to hover), crouch in mid-air stomps, Shift charges, walking tramples anyone hugging the ankles.
 *   Weapons       LMB 20 mm six-barrel Vulcan (heat), RMB 40 mm autocannon (R cycles HE/AP/FLAK), G held paints for the
 *                 6-tube missile pod, Q regenerating smoke/flares + close concussive pulse, F alternating 2-arm melee
 *                 sweep (190° front arc + 4 m 360° close-proximity sweep around the legs), wheel zooms.
 */
import * as THREE from 'three';
import { CG, type Ctx, type LoopHandle, type PlayerDamage, type RayHit } from '../core/contracts';
import { clamp, rand, wrapAngle } from '../core/math';
import { Ac130Rounds, ROUND_KINDS } from '../progression/callins/ac130Rounds';
import type { MechKind } from '../progression/callins/link';
import { TELL_EVERY } from '../progression/callins/shared';
import { CALLINS } from '../progression/data';
import type { ModelMaterials } from '../progression/modelkit';
import { Gun } from '../vehicles/guns';
import type { GunnerWeapon } from '../vehicles/hud';
import { GunnerSeat, type SeatRig } from '../vehicles/seat';
import { CANNON_ARM, FRAME_PLACES, ROTARY_ARM, StandIn } from './cockpit';
import { Walker, type WalkerIntent } from './controller';
import { FRAME, framePlan } from './data';
import { backhand, crush, FrameGuns, shove, stomp, trample } from './weapons';

/**
 * Co-op: how the Frame is told to the other screens, which draw a stand-in of it (puppet.ts `FramePuppet`).
 * `pose` is `MechPose` a few times a second (with `MECH_PARKED` when standing empty), and null when destroyed or cleared.
 */
export interface FrameNet {
  pose(values: number[] | null): void;
  news(kind: MechKind, values?: number[]): void;
}

/** The `flags` bitmask of a `MechPose`: rotary firing, jets lit, or parked empty on the field. */
export const MECH_FIRING = 1;
export const MECH_JETS = 2;
export const MECH_PARKED = 4;

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
/** The parked body's eye over its feet, so it rides with its head in the cockpit. */
const BODY_EYE = 1.6;
/** Seconds the arm takes across the front in a melee sweep. */
const SWING = 0.28;
const GUN_REACH = 60;
const INTERACT_GUARD = 0.25;
const FRAME_COLOR = CALLINS.frame.color;

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
  readonly maxHealth: number = FRAME.hull.maxHealth;
  health: number = FRAME.hull.maxHealth;
  /** True while a live Frame stands in the world (either parked or piloted). */
  deployed = false;
  private readonly body: StandIn;
  private readonly rotaryGun: Gun;
  private readonly cannonGun: Gun;
  private seat: GunnerSeat | null = null;
  private readonly frame = new THREE.Quaternion();
  /** The eye, as posed this frame. */
  private readonly eye = new THREE.Vector3();
  private readonly intent: WalkerIntent = { moveX: 0, moveZ: 0, viewYaw: 0, jet: false, stomp: false, charge: false };
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
  private readonly chargeRow: GunnerWeapon = { name: '', ammo: 0, max: FRAME.charge.count, reload: -1 };
  private readonly intercept = (damage: PlayerDamage): boolean => this.hit(damage);
  private unmark: (() => void) | null = null;
  private unprompt: (() => void) | null = null;
  private readonly markerPos = new THREE.Vector3();
  private readonly promptPos = new THREE.Vector3();
  /** Co-op: set while there are other players to tell (callins/manager.ts). */
  net: FrameNet | null = null;
  private tellIn = 0;
  private told = false;

  constructor(private readonly ctx: Ctx, materials: ModelMaterials, private readonly rig: SeatRig, private readonly onBoard: () => void) {
    const { scene } = ctx.render;
    this.walker = new Walker(ctx.physics, ctx.world.bounds?.min?.y ?? -Infinity);
    this.body = new StandIn(materials, scene);
    this.rotaryGun = new Gun(materials, scene, ROTARY_ARM);
    this.cannonGun = new Gun(materials, scene, CANNON_ARM);
    this.guns = new FrameGuns(ctx, new Ac130Rounds(ctx, materials), this.rotaryGun, this.cannonGun, out => this.body.place(TUBES, out));
    this.guns.onShell = (round, from, aim, seconds) => this.net?.news('shell', [ROUND_KINDS.indexOf(round), from.x, from.y, from.z, aim.x, aim.y, aim.z, seconds]);
    this.guns.onMissile = (from, velocity) => this.net?.news('missile', [from.x, from.y, from.z, velocity.x, velocity.y, velocity.z]);
  }

  /** Co-op: this frame's pose for the other screens, `TELL_EVERY` seconds apart. */
  private say(dt: number, seat: GunnerSeat): void {
    this.tellIn -= dt;
    if (this.tellIn > 0) return;
    this.tellIn = Math.max(0, this.tellIn + TELL_EVERY);
    this.told = true;
    const w = this.walker;
    const walk = w.grounded ? clamp(w.speed / FRAME.walk.forward) : 0;
    const sway = FRAME.feel.sway * Math.sin(w.stride * Math.PI) * walk;
    const firing = this.guns.rotary.firing && this.ctx.input.isDown('fire');
    if (seat.range > 6) _to.copy(seat.point);
    else _to.copy(seat.aim).multiplyScalar(GUN_REACH).add(seat.view.position);
    this.net!.pose([w.feet.x, w.feet.y, w.feet.z, w.legYaw, w.viewYaw, w.stride, walk, this.dip, sway, _to.x, _to.y, _to.z,
      (firing ? MECH_FIRING : 0) | (w.jetting && !w.grounded ? MECH_JETS : 0)]);
  }

  private sayParked(dt: number): void {
    if (!this.net) return;
    this.tellIn -= dt;
    if (this.tellIn > 0) return;
    this.tellIn = 0.5;
    this.told = true;
    const w = this.walker;
    _to.set(-Math.sin(w.viewYaw), -0.35, -Math.cos(w.viewYaw)).multiplyScalar(20).add(this.eye);
    this.net.pose([w.feet.x, w.feet.y, w.feet.z, w.legYaw, w.viewYaw, w.stride, 0, 0, 0, _to.x, _to.y, _to.z, MECH_PARKED]);
  }

  /** The player is currently seated inside it. */
  get occupied(): boolean {
    return this.seat !== null && this.seat.stage !== 'left';
  }

  /** Standing empty on the map, waiting for the player to walk up and board with E. */
  get parked(): boolean {
    return this.deployed && !this.occupied;
  }

  /** Progressive cockpit canopy crack stage (0..3) based on remaining hull integrity. */
  get crackStage(): number {
    const ratio = this.health / this.maxHealth;
    if (ratio <= 0.2) return 3;
    if (ratio <= 0.45) return 2;
    if (ratio <= 0.7) return 1;
    return 0;
  }

  /** Deploy a fresh 4000 HP Frame standing parked at `feet`, facing `yaw`. Replaces any previously deployed Frame. */
  deploy(feet: THREE.Vector3, yaw: number): void {
    if (this.seat) {
      this.seat.leave(true);
      this.releaseSeat();
    }
    this.clearParkedUi();
    this.walker.place(feet, yaw);
    this.guns.reset();
    this.health = this.maxHealth;
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
  board(feet: THREE.Vector3, yaw: number, seconds = Infinity): void {
    this.deploy(feet, yaw);
    this.enter(seconds);
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
    seat.weapons.push(...this.guns.rows, this.jetRow, this.chargeRow);
    this.seat = seat;
    seat.board();
    player.interceptor = this.intercept;
    this.pose(0);
    this.rotaryGun.snap(yaw, 0);
    this.cannonGun.snap(yaw, 0);
    _to.set(-Math.sin(yaw), 0, -Math.cos(yaw)).multiplyScalar(30).add(this.eye);
    seat.sit(_to, this.eye);
    this.panel(seat);
    this.onBoard();
    audio.play('metal_groan', { pitch: 0.7 });
    audio.play('tank_turret_stop', { pitch: 0.7 });
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
    this.body.pose(feet, yaw, yaw, 0, 0, 0, 0, false, this.eye, { parked: true });
    for (const [gun, place] of [[this.rotaryGun, FRAME_PLACES.rotary], [this.cannonGun, FRAME_PLACES.cannon]] as const) {
      this.body.place(place, _pivot);
      gun.snap(yaw, -0.35);
      gun.point(_pivot, yaw, -0.35, 0);
    }
  }

  /** An empty Frame gone from the scene (if not deployed and not occupied). */
  hide(): void {
    if (!this.seat && !this.deployed) this.hideMeshes();
  }

  /** A new run: out and gone, nothing left on the map or in the air. */
  clear(): void {
    this.deployed = false;
    this.health = this.maxHealth;
    this.clearParkedUi();
    this.seat?.leave(true);
    this.releaseSeat();
    this.hideMeshes();
    this.clearNet();
    this.guns.reset();
    this.trampleTimes.clear();
  }

  update(dt: number): void {
    if (this.interactGuard > 0) this.interactGuard = Math.max(0, this.interactGuard - dt);
    const seat = this.seat;
    if (!seat) {
      if (this.deployed) this.updateParked(dt);
      return;
    }
    if (seat.stage === 'left') {
      // Death or external eject emptied the seat: release controls and leave mech parked if still intact.
      this.releaseSeat();
      if (this.deployed && this.health > 0) {
        this.poseParked();
        this.showParkedMarker();
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
    const { input, player, camera } = this.ctx;
    // E disembarks cleanly like a vehicle, leaving the mech parked on the map.
    if (!seat.noWayOut && this.interactGuard <= 0 && input.pressed('interact')) {
      this.leave();
      return;
    }
    const w = this.walker;
    const it = this.intent;
    it.moveX = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
    it.moveZ = (input.isDown('forward') ? 1 : 0) - (input.isDown('back') ? 1 : 0);
    it.viewYaw = seat.yaw - input.frameLook.x * player.sensitivity * player.lookScale;
    it.jet = input.isDown('jump');
    it.stomp = input.pressed('slide');
    it.charge = input.pressed('dash');
    w.update(dt, it);
    this.feel(dt);
    this.pose(dt);
    this.frame.setFromAxisAngle(UP, w.legYaw + Math.PI);
    seat.update(dt, this.frame, this.eye);
    seat.view.roll = FRAME.feel.roll * Math.sin(w.stride * Math.PI) * clamp(w.speed / FRAME.walk.forward) * (w.grounded ? 1 : 0);
    camera.syncSeat();
    this.aimGuns(dt, seat);
    this.guns.update(dt, seat);
    if (this.net) this.say(dt, seat);
    if (input.pressed('weaponLast')) {
      if (this.guns.popSmoke(w.feet, w.viewYaw)) this.net?.news('smoke');
      else this.ctx.audio.play('weapon_dry');
    }
    this.blows(dt);
    this.damageEffects(dt);
    this.panel(seat);
    _at.copy(this.eye);
    _at.y -= BODY_EYE;
    player.carry(_at);
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
    this.body.pose(w.feet, w.legYaw, w.viewYaw, 0, 0, 0, 0, false, this.eye, { parked: true, jets: false, cracks: this.crackStage });
    for (const [gun, place] of [[this.rotaryGun, FRAME_PLACES.rotary], [this.cannonGun, FRAME_PLACES.cannon]] as const) {
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
    const sway = FRAME.feel.sway * Math.sin(w.stride * Math.PI) * walk;
    this.body.pose(w.feet, w.legYaw, w.viewYaw, w.stride, walk, this.dip, sway, true, this.eye, {
      parked: false, jets: w.jetting && !w.grounded, cracks: this.crackStage,
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
    if (s.stomped >= 0) this.stomped(s.stomped);
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

  /** A foot down: a thump in the eye, dust, and anyone under it. */
  private footfall(): void {
    const F = FRAME.feel;
    const w = this.walker;
    const { audio, camera, fx, enemies } = this.ctx;
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
  }

  /** The big slam, twice the size, from `height`. */
  private stomped(height: number): void {
    const S = FRAME.stomp;
    const { audio, camera, fx, physics, render, enemies } = this.ctx;
    const at = this.walker.feet;
    const k = height >= S.big ? 1 : S.small;
    this.net?.news('stomp', [height]);
    stomp(enemies, at, height);
    fx.slam(at, 3.2 * k);
    this.dustRing(at, 2.4 * k, 10, 2.4 * k);
    this.dustRing(at, 5.2 * k, 16, 3 * k);
    fx.chips(at, 0x6f6a63, Math.round(28 * k));
    render.decals?.add('crack', at, UP, 11 * k, rand(0, Math.PI * 2));
    physics.radialImpulse(_v.copy(at).setY(at.y + 0.5), S.radius * k, 90 * k);
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
    this.aim(this.rotaryGun, FRAME_PLACES.rotary, seat, dt, leftSweep);
    this.aim(this.cannonGun, FRAME_PLACES.cannon, seat, dt, rightSweep);
  }

  private aim(gun: Gun, place: readonly [number, number, number], seat: GunnerSeat, dt: number, sweep: number): void {
    this.body.place(place, _pivot);
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
    const { audio, camera, fx, enemies, input, render } = this.ctx;
    this.trampleClock += dt;
    if (w.grounded && w.speed > 1.5) {
      if (trample(enemies, w.feet, this.trampleTimes, this.trampleClock) > 0) {
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
      }
    }
    if (s.bumped > 0) {
      _at.copy(w.feet).addScaledVector(_v.set(-Math.sin(w.viewYaw), 0, -Math.cos(w.viewYaw)), FRAME.body.radius);
      _at.y += 2;
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
      const n = backhand(enemies, w.feet, w.viewYaw, this.swingArm);
      _at.copy(w.feet);
      _at.y += 2.2;
      _right.set(Math.cos(w.viewYaw) * this.swingArm, 0, -Math.sin(w.viewYaw) * this.swingArm);
      fx.slash(_at, UP, _right, FRAME.backhand.arc, FRAME.backhand.reach, 'sweep');
      fx.ring(_v.copy(w.feet).setY(w.feet.y + 0.8), UP, '#ffaa40', FRAME.backhand.closeRadius * 1.15);
      audio.play('enemy_swing', { pitch: 0.42, volume: 1 });
      camera.kick(0.015, 0.028 * this.swingArm, -0.022 * this.swingArm);
      if (n > 0) {
        audio.play('hit_punch', { pitch: 0.52, volume: 1 });
        audio.play('metal_clang', { pitch: 0.72, volume: 0.75 });
        audio.play('bone_crack');
        fx.sparks(_at, _right, 14, '#ffcc66');
        camera.addTrauma(0.35);
      }
    }
  }

  // ---- the panel and hull integrity ---------------------------------------------------------------------------

  private panel(seat: GunnerSeat): void {
    const w = this.walker;
    const { rotary } = this.guns;
    seat.heat = rotary.heat.value;
    seat.overheated = rotary.heat.overheated;
    seat.spin = rotary.spin;
    seat.legs = wrapAngle(w.legYaw - w.viewYaw);
    seat.hull = clamp(this.health / this.maxHealth);
    seat.hullText = `${Math.ceil(this.health)} / ${this.maxHealth}`;
    seat.marks = this.guns.marks;
    seat.altitude = w.grounded ? 0 : w.clearance();
    const key = (a: Parameters<Ctx['input']['labelFor']>[0]) => this.ctx.input.labelFor(a);
    this.jetRow.name = `${key('jump')} JETS`;
    this.jetRow.ammo = Math.round((w.fuel / FRAME.jet.fuel) * 100);
    this.chargeRow.name = `${key('dash')} CHARGE`;
    this.chargeRow.ammo = w.charges;
    this.chargeRow.reload = w.charges < FRAME.charge.count ? 1 - w.chargeIn / FRAME.charge.refill : -1;
  }

  /**
   * Every hit while piloted goes to the Frame's 4000 HP hull: small-arms fire chips off heavy armor plates with sparks,
   * snipers punch deeper, heavy ordnance deals full damage, and hits from behind into the reactor vents deal 1.5x.
   */
  private hit(damage: PlayerDamage): boolean {
    if (!this.deployed || this.health <= 0) return false;
    const H = FRAME.hull;
    const src = damage.source ?? '';
    let mult: number = H.heavyMult;
    if (damage.type === 'bullet') mult = src.includes('sniper') ? H.sniperMult : H.bulletMult;
    if (damage.from) {
      const feet = this.walker.feet;
      const dx = damage.from.x - feet.x;
      const dz = damage.from.z - feet.z;
      const len = Math.hypot(dx, dz);
      if (len > 0.1) {
        const fx = -Math.sin(this.walker.viewYaw);
        const fz = -Math.cos(this.walker.viewYaw);
        if ((dx * fx + dz * fz) / len < -0.45) mult *= H.rearMult;
      }
    }
    const prevCracks = this.crackStage;
    const dealt = Math.max(1, damage.amount * mult);
    this.health = Math.max(0, this.health - dealt);
    const { audio, camera, render } = this.ctx;
    if (dealt >= 40) {
      audio.play('metal_clang', { pitch: rand(0.6, 0.85), volume: 0.85 });
      audio.play('metal_groan', { pitch: rand(0.7, 0.95), volume: 0.55 });
      camera.addTrauma(clamp(dealt / 180, 0.12, 0.42));
      render.post.chromatic(0.22, 0.14);
    } else {
      audio.play('metal_clang', { pitch: rand(0.95, 1.3), volume: 0.38 });
      camera.addTrauma(0.035);
    }
    if (this.crackStage > prevCracks) {
      audio.play('concrete_crumble', { pitch: 1.4, volume: 0.75 });
      this.body.setCracks(this.crackStage);
    }
    if (this.seat) this.panel(this.seat);
    if (this.health <= 0) this.destroy();
    return true;
  }

  /** Hull failure: dramatic blast hurting surrounding enemies, safe emergency eject if piloted, and the Frame is gone. */
  destroy(): void {
    if (!this.deployed && !this.occupied) return;
    const { audio, camera, combat, fx, hud, player } = this.ctx;
    const H = FRAME.hull;
    const wasOccupied = this.occupied;
    this.deployed = false;
    this.health = 0;
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
    this.jetLoop?.stop(0.2);
    this.jetLoop = null;
    this.servo?.stop(0.1);
    this.servo = null;
  }

  private hideMeshes(): void {
    this.body.hide();
    this.rotaryGun.hide();
    this.cannonGun.hide();
  }

  private clearNet(): void {
    if (this.told) this.net?.pose(null);
    this.told = false;
    this.tellIn = 0;
  }
}

/** The pod's tube faces, at the front of the box on the right shoulder. */
const TUBES = [FRAME_PLACES.pod[0], FRAME_PLACES.pod[1], FRAME_PLACES.pod[2] - 0.7] as const;
