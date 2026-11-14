/**
 * The Distraint Frame: a gunner's seat whose mount walks. Section 3 of docs/proposals/mission-2-plan.md.
 *
 * Every frame: the keys become a `WalkerIntent`, the walker moves the legs, the stand-in body is posed round them, and the
 * seat (`GunnerSeat`, tone `frame`) takes its view from the eye in the cockpit, so the arc, the zoom, the sight, the HUD
 * and every way out are the seat's. The view is free within the arc of the legs; the mouse past it drags the Frame round.
 * The parked body rides in the cockpit (`player.carry`), and every hit on it goes to the Frame (`player.interceptor`).
 *
 * The weight is in the feet, never the aim: a plant dips and kicks the eye and rocks it side to side, a landing sinks the
 * hull on its legs, a stomp drops it hard. The guns and the blows are `weapons.ts`.
 *
 * Keys: WASD walk, mouse look, Space jets (hold to hover), crouch in the air stomps, Shift charges, F backhands, LMB the
 * rotary, RMB the 40 mm (R for the round), G held paints for the pod, Q smoke, the wheel zooms. No way out by choice.
 */
import * as THREE from 'three';
import type { Ctx, LoopHandle, PlayerDamage } from '../core/contracts';
import { clamp, rand, wrapAngle } from '../core/math';
import { Ac130Rounds } from '../progression/callins/ac130Rounds';
import type { ModelMaterials } from '../progression/modelkit';
import { Gun } from '../vehicles/guns';
import type { GunnerWeapon } from '../vehicles/hud';
import { GunnerSeat, type SeatRig } from '../vehicles/seat';
import { CANNON_ARM, FRAME_PLACES, ROTARY_ARM, StandIn } from './cockpit';
import { Walker, type WalkerIntent } from './controller';
import { FRAME, framePlan } from './data';
import { backhand, crush, FrameGuns, shove, stomp } from './weapons';

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
/** The parked body's eye over its feet, so it rides with its head in the cockpit. */
const BODY_EYE = 1.6;
/** Seconds the arm takes across the front in a backhand. */
const SWING = 0.32;
const GUN_REACH = 60;

const _pivot = new THREE.Vector3();
const _to = new THREE.Vector3();
const _at = new THREE.Vector3();
const _v = new THREE.Vector3();
const _right = new THREE.Vector3();

export class Frame {
  readonly walker: Walker;
  readonly guns: FrameGuns;
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
  private backhandIn = 0;
  private flameIn = 0;
  private wasStomping = false;
  private readonly struck = new Set<number>();
  private jetLoop: LoopHandle | null = null;
  private servo: LoopHandle | null = null;
  private servoQuiet = 0;
  private readonly jetRow: GunnerWeapon = { name: '', ammo: 0, max: 100 };
  private readonly chargeRow: GunnerWeapon = { name: '', ammo: 0, max: FRAME.charge.count, reload: -1 };
  private readonly intercept = (damage: PlayerDamage): boolean => this.hit(damage);

  constructor(private readonly ctx: Ctx, materials: ModelMaterials, private readonly rig: SeatRig, private readonly onBoard: () => void) {
    const { scene } = ctx.render;
    this.walker = new Walker(ctx.physics, ctx.world.bounds?.min?.y ?? -Infinity);
    this.body = new StandIn(materials, scene);
    this.rotaryGun = new Gun(materials, scene, ROTARY_ARM);
    this.cannonGun = new Gun(materials, scene, CANNON_ARM);
    this.guns = new FrameGuns(ctx, new Ac130Rounds(ctx, materials), this.rotaryGun, this.cannonGun, out => this.body.place(TUBES, out));
  }

  /** The player is in it. */
  get occupied(): boolean {
    return this.seat !== null && this.seat.stage !== 'left';
  }

  /** Into a fresh Frame standing on `feet`, facing `yaw`: full jets, full guns, three smoke. The way a beat in it starts. */
  board(feet: THREE.Vector3, yaw: number): void {
    const { audio, player } = this.ctx;
    if (this.seat) this.leave(true);
    this.walker.place(feet, yaw);
    this.guns.reset();
    this.dip = this.dipV = 0;
    this.swing = -1;
    const seat = new GunnerSeat(this.ctx, this.rig, framePlan());
    seat.fixed(this.walker.feet);
    seat.weapons.push(...this.guns.rows, this.jetRow, this.chargeRow);
    this.seat = seat;
    seat.board();
    player.interceptor = this.intercept;
    this.pose(0);
    this.rotaryGun.snap(yaw, 0);
    this.cannonGun.snap(yaw, 0);
    _to.set(-Math.sin(yaw), 0, -Math.cos(yaw)).multiplyScalar(30).add(this.eye);
    seat.sit(_to, this.eye);
    this.onBoard();
    audio.play('metal_groan', { pitch: 0.7 });
    audio.play('tank_turret_stop', { pitch: 0.7 });
  }

  /** Out, wherever it is: the body is put on the ground beside it. For a script; there is no key. */
  leave(quiet = false): void {
    const seat = this.seat;
    if (!seat) return;
    seat.leave(quiet);
    this.release();
    _at.copy(this.walker.feet).addScaledVector(_right.set(Math.cos(this.walker.viewYaw), 0, -Math.sin(this.walker.viewYaw)), 3);
    this.ctx.player.teleport(_at);
  }

  /** A new run: out and gone, nothing left in the air. */
  clear(): void {
    this.seat?.leave(true);
    this.release();
    this.guns.reset();
  }

  update(dt: number): void {
    const seat = this.seat;
    if (!seat) return;
    if (seat.stage === 'left') {
      // Death or a new run emptied the seat: this only notices.
      this.release();
      return;
    }
    const { input, player, camera } = this.ctx;
    const w = this.walker;
    const it = this.intent;
    it.moveX = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
    it.moveZ = (input.isDown('forward') ? 1 : 0) - (input.isDown('back') ? 1 : 0);
    // Where the seat will put the view this frame, before the legs hold it: the walker decides how far they come round.
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
    if (input.pressed('weaponLast') && !this.guns.popSmoke(w.feet, w.viewYaw)) this.ctx.audio.play('weapon_dry');
    this.blows(dt);
    this.panel(seat);
    _at.copy(this.eye);
    _at.y -= BODY_EYE;
    player.carry(_at);
  }

  // ---- the body and the view ----------------------------------------------------------------------------------

  private pose(dt: number): void {
    const w = this.walker;
    const walk = w.grounded ? clamp(w.speed / FRAME.walk.forward) : 0;
    const sway = FRAME.feel.sway * Math.sin(w.stride * Math.PI) * walk;
    this.body.pose(w.feet, w.legYaw, w.viewYaw, w.stride, walk, this.dip, sway, true, this.eye);
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
    const { audio, camera, fx } = this.ctx;
    // A step up or down moves the feet at once; the eye eases over it.
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

  /** Both guns turn on the arms toward where the sight is, so their rounds converge on it; the right one swings a backhand. */
  private aimGuns(dt: number, seat: GunnerSeat): void {
    this.aim(this.rotaryGun, FRAME_PLACES.rotary, seat, dt, 0);
    let sweep = 0;
    if (this.swing >= 0) {
      this.swing += dt / SWING;
      // Out to the right, then hard across to the left.
      sweep = this.swing < 1 ? -0.5 + 2.1 * this.swing : -1;
      if (this.swing >= 1) this.swing = -1;
    }
    this.aim(this.cannonGun, FRAME_PLACES.cannon, seat, dt, this.swing >= 0 ? sweep : 0);
  }

  private aim(gun: Gun, place: readonly [number, number, number], seat: GunnerSeat, dt: number, sweep: number): void {
    this.body.place(place, _pivot);
    if (seat.range > 6) _to.subVectors(seat.point, _pivot);
    else _to.copy(seat.aim).multiplyScalar(GUN_REACH).add(seat.view.position).sub(_pivot);
    const yaw = Math.atan2(-_to.x, -_to.z) + sweep;
    const pitch = Math.atan2(_to.y, Math.hypot(_to.x, _to.z)) - Math.abs(sweep) * 0.3;
    if (sweep !== 0) gun.snap(yaw, pitch);
    gun.point(_pivot, yaw, pitch, dt);
  }

  // ---- the blows ----------------------------------------------------------------------------------------------

  private blows(dt: number): void {
    const w = this.walker;
    const s = w.said;
    const { audio, camera, fx, enemies, input, render } = this.ctx;
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
        if (shove(enemies, _at, _v, this.struck) > 0) {
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
      this.swing = 0;
      const n = backhand(enemies, w.feet, w.viewYaw);
      _at.copy(w.feet);
      _at.y += 2.2;
      _right.set(Math.cos(w.viewYaw), 0, -Math.sin(w.viewYaw));
      fx.slash(_at, UP, _right, FRAME.backhand.arc, FRAME.backhand.reach, 'sweep');
      audio.play('enemy_swing', { pitch: 0.45, volume: 1 });
      camera.kick(0.01, 0.025, -0.02);
      if (n > 0) {
        audio.play('hit_punch', { pitch: 0.55 });
        audio.play('bone_crack');
        camera.addTrauma(0.3);
      }
    }
  }

  // ---- the panel and the hits -----------------------------------------------------------------------------------

  private panel(seat: GunnerSeat): void {
    const w = this.walker;
    const { rotary } = this.guns;
    seat.heat = rotary.heat.value;
    seat.overheated = rotary.heat.overheated;
    seat.spin = rotary.spin;
    seat.legs = wrapAngle(w.legYaw - w.viewYaw);
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
   * Every hit on the body is the Frame's. shortcut: the plates take it all and nothing is counted yet; stage 5 maps a hit
   * to its part by `from` and `type`, and gives the Frame its 4000 health.
   */
  private hit(_damage: PlayerDamage): boolean {
    return true;
  }

  /** Whatever emptied the seat, everything the Frame set on the player is given back and its sounds stop. */
  private release(): void {
    this.seat = null;
    if (this.ctx.player.interceptor === this.intercept) this.ctx.player.interceptor = null;
    this.body.hide();
    this.rotaryGun.hide();
    this.cannonGun.hide();
    this.guns.silence();
    this.jetLoop?.stop(0.2);
    this.jetLoop = null;
    this.servo?.stop(0.1);
    this.servo = null;
  }
}

/** The pod's tube faces, at the front of the box on the right shoulder. */
const TUBES = [FRAME_PLACES.pod[0], FRAME_PLACES.pod[1], FRAME_PLACES.pod[2] - 0.7] as const;
