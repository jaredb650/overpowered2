/**
 * Door Gunner: the player stands in the open left door of the Packmule with a 20 mm rotary cannon while it flies
 * left-hand circles over the fight. The gun spins up, then puts thirty rounds a second through the sight, every other
 * one a tracer, inside the arc the door allows. Each round bursts where it lands and goes on through a roof or a wall:
 * the gun's numbers, and why it has both, are `DOOR.gun` in heliData.ts. `?doorgun=old` is the M134 it replaced.
 *
 * The circle is an OrbitPath, and its centre slides slowly after the fight, so a lap stays a lap. Rounds are hitscan:
 * at this range a real one lands in a tenth of a second, and they go through combat like any gun, with the tracer
 * starting from the real muzzle.
 */
import * as THREE from 'three';
import type { EmitterHandle, LoopHandle } from '../../core/contracts';
import type { ShotSpec } from '../../core/gameplay';
import { clamp, damp, rand, randomInCone, TAU } from '../../core/math';
import type { UtilityMount } from '../../vehicles/utilityModel';
import { FlightPath, type Flight } from '../../vehicles/flight';
import type { SeatRig } from '../../vehicles/seat';
import { OrbitPath } from './airframe';
import { GunnerStrike, type Ride } from './gunnerStrike';
import { DOOR as D, SMALL_MAP } from './heliData';
import type { StrikeKit } from './shared';

const G = D.gun;
/** Points around the circle to check for anything tall. */
const RING_SAMPLES = 16;
/** Seconds ahead along the flight, which covers the spiral in. */
const PATH_AHEAD = 1.5;

const _pos = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _bore = new THREE.Vector3();
const _casing = new THREE.Vector3();

const SHOT: ShotSpec = {
  damage: G.damage, source: 'door_gun', team: 'player', maxDistance: G.range, tracerFrom: _muzzle,
  force: G.force, severMult: G.severMult, impactScale: G.impactScale,
  // Both at once, on this gun alone: the burst of the rotary cannon and the heavy machine gun's way through walls.
  burst: G.burst ?? undefined, penetrate: G.penetrate, bodyCost: G.bodyCost,
};
/** The spin loop's pitch with the barrels barely turning, and the seconds of the run-down sound that are the run-down. */
const SPIN_PITCH = 0.45;
const SPIN_RUNDOWN = 1.1;

export class DoorGunner extends GunnerStrike<UtilityMount> {
  private readonly path: OrbitPath | FlightPath;
  /** The same thing as `path` on an ordinary call, and null on a fixed flight. */
  private readonly orbit: OrbitPath | null;
  private nextMark = 1;
  private sunk = 0;
  private burning: EmitterHandle | null = null;
  private readonly limit: number;
  private readonly clearance: number;
  private shotIn = 0;
  private fired = 0;
  private spinning = false;
  private spinLoop: LoopHandle | null = null;
  private fireLoop: LoopHandle | null = null;
  private readonly belt = { name: G.name, ammo: G.rounds, max: G.rounds };

  constructor(kit: StrikeKit, rig: SeatRig, ride: Ride<UtilityMount>, private readonly flight: Flight | null = null, ai = false) {
    super(kit, rig, D, ride, 'door', 'door_gun', ai);
    const { bounds } = kit.ctx.world;
    const small = (bounds.max.x - bounds.min.x) / 2 < SMALL_MAP;
    this.limit = small ? D.limit.small : D.limit.large;
    this.clearance = small ? D.clearance.small : D.clearance.large;
    if (flight) {
      this.scripted = true;
      this.orbit = null;
      this.path = new FlightPath(flight.marks, D.flightSpeed);
      const end = flight.marks[flight.marks.length - 1]!;
      this.seat.fixed(_pos.set(end.x, end.y, end.z));
    } else {
      // A copy, because the hold is cut short the moment the aircraft heads home.
      this.orbit = this.path = new OrbitPath({ ...(small ? D.small : D.large), holdSeconds: D.aiSeconds + D.boardSeconds });
      const { center } = this.orbit;
      center.set(clamp(this.fight.x, -this.limit, this.limit), 0, clamp(this.fight.z, -this.limit, this.limit));
      this.orbit.begin(center, Math.atan2(center.z, center.x) + 2.4);
    }
    this.seat.weapons.push(this.belt);
    this.fly(0);
    this.begin();
  }

  /**
   * The centre follows the fight on the map, and the whole circle rises for the tallest thing anywhere on it, so a lap
   * stays level and does not rear up at each building.
   */
  private drift(path: OrbitPath, dt: number): void {
    const { center, plan } = path;
    const { skyline } = this.rig;
    center.x = damp(center.x, clamp(this.fight.x, -this.limit, this.limit), D.focusRate, dt);
    center.z = damp(center.z, clamp(this.fight.z, -this.limit, this.limit), D.focusRate, dt);
    path.at(this.clock + PATH_AHEAD, _dir);
    let top = skyline.at(_dir.x, _dir.z);
    for (let i = 0; i < RING_SAMPLES; i++) {
      const a = (i / RING_SAMPLES) * TAU;
      top = Math.max(top, skyline.at(center.x + Math.cos(a) * plan.radius, center.z + Math.sin(a) * plan.radius));
    }
    const lift = Math.max(0, top + this.clearance - plan.altitude);
    center.y = damp(center.y, lift, lift > center.y ? D.liftRate : D.liftRate * 0.25, dt);
  }

  protected fly(dt: number): void {
    const { frame, path, clock, seat, orbit } = this;
    if (orbit && !this.homebound) this.drift(orbit, dt);
    path.at(clock, _pos);
    path.heading(clock, _fwd);
    if (seat.stage === 'left' && !orbit) this.settle(dt);
    frame.fly(_pos, _fwd, path.roll(clock));
    if (!orbit) this.follow();
  }

  /** Down the last of the way, onto whatever the flight ended over. */
  private settle(dt: number): void {
    const floor = this.rig.skyline.ground(_pos.x, _pos.z) + D.flightRest;
    this.sunk += D.flightSink * dt;
    _pos.y = Math.max(_pos.y - this.sunk, floor);
  }

  /** Calls each mark as it comes up, and gets out at the last. */
  private follow(): void {
    const { flight, seat, clock } = this;
    const path = this.path as FlightPath;
    const marks = flight!.marks;
    while (this.nextMark < marks.length && clock >= path.arrival(this.nextMark)) {
      const mark = marks[this.nextMark++]!;
      if (mark.hit) this.struckDown();
      flight!.reached(mark.name);
    }
    if (clock >= path.ends && seat.stage === 'seated') seat.leave();
  }

  /** The rest of the flight is a controlled fall with fire coming out of it. */
  private struckDown(): void {
    const { audio, camera, fx, render } = this.kit.ctx;
    const { position } = this.frame.root;
    fx.explosion(position, { radius: 4, kind: 'rocket', scale: 1.2 });
    render.post.flash('#ffb060', 0.5, 0.25);
    camera.addTrauma(0.9);
    audio.play('vehicle_explode', { volume: 0.7, unaffectedByTime: true });
    this.burning = fx.attachEmitter(this.frame.root, 'fireTrail', _dir.set(0, 1.4, -2), 120);
  }

  protected shoot(dt: number): void {
    const { audio } = this.kit.ctx;
    const { gun, seat } = this;
    if (this.scripted) this.belt.ammo = this.belt.max;
    const held = this.trigger.fire && this.belt.ammo > 0;
    seat.spin = clamp(seat.spin + (held ? dt / G.spinUp : -dt / G.spinDown));
    gun.turn(seat.spin * G.barrelRate * dt);
    if (held && !this.spinning) {
      this.spinning = true;
      audio.play('minigun_spinup', { position: this.heard });
      this.spinLoop = audio.startLoop('minigun_spin_loop', { fadeIn: 0.1, position: this.heard });
    } else if (!held && this.spinning) {
      this.spinDown();
    }
    // The drive is heard coming up with the barrels.
    this.spinLoop?.setPitch(SPIN_PITCH + (1 - SPIN_PITCH) * seat.spin, 0.04);
    const heard = this.heard;
    if (heard) {
      this.spinLoop?.setPosition(heard);
      this.fireLoop?.setPosition(heard);
    }
    if (held && seat.spin >= G.fireAt) this.stream(dt);
    else this.ceaseFire();
  }

  private spinDown(): void {
    this.spinning = false;
    this.spinLoop?.stop(0.2);
    this.spinLoop = null;
    // Written from full spin: a gun let go part way up starts it part way down.
    this.kit.ctx.audio.play('minigun_spindown', { offset: (1 - this.seat.spin) * SPIN_RUNDOWN, position: this.heard });
  }

  private ceaseFire(): void {
    if (!this.fireLoop) return;
    this.fireLoop.stop(0.08);
    this.fireLoop = null;
    // The last round's report and its roll-off, so the barrage ends on a shot and not on a fade.
    this.kit.ctx.audio.play('minigun_fire', { position: this.heard });
  }

  private stream(dt: number): void {
    const { audio, camera } = this.kit.ctx;
    this.fireLoop ??= audio.startLoop('minigun_fire_loop', { fadeIn: 0.03, pitch: G.loopPitch, position: this.heard });
    this.shotIn -= dt;
    for (let i = 0; this.shotIn <= 0 && i < G.perFrame && this.belt.ammo > 0; i++) {
      this.shotIn += 1 / G.roundsPerSecond;
      this.round();
    }
    // A short frame's debt is paid above. A long frame's is forgiven, so the rate never bursts to catch up.
    if (this.shotIn < 0) this.shotIn = 0;
    if (this.ai) return;
    camera.addTrauma(G.trauma);
    camera.kick(rand(-G.kick, G.kick), rand(-G.kick, G.kick));
  }

  private round(): void {
    const { combat, fx } = this.kit.ctx;
    const { gun, seat } = this;
    this.belt.ammo--;
    this.fired++;
    gun.muzzle(_muzzle);
    gun.bore(_bore);
    randomInCone(seat.aim, G.spread, _dir);
    SHOT.tracer = this.fired % G.tracerEvery === 0 ? 'heavy' : undefined;
    combat.fireRay(seat.view.position, _dir, SHOT);
    if (this.fired % G.flashEvery === 0) fx.muzzleFlash(_muzzle, _bore, G.flash);
    if (this.fired % G.casingEvery === 0) {
      _casing.copy(_bore).multiplyScalar(-1.5);
      _casing.y -= rand(3, 5);
      fx.shellCasing(gun.root.position, _casing, G.casing);
    }
  }

  protected get spent(): boolean {
    return this.belt.ammo <= 0;
  }

  protected override silence(): void {
    this.ceaseFire();
    if (this.spinning) this.spinDown();
    this.seat.spin = 0;
  }

  protected depart(): void {
    const { orbit } = this;
    if (orbit) orbit.plan.holdSeconds = Math.max(0, this.clock - orbit.plan.entrySeconds);
  }

  override dispose(): void {
    super.dispose();
    this.burning?.stop();
    this.burning = null;
  }
}
