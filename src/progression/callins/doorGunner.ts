/**
 * Door Gunner: the player stands in the open left door of the Packmule with a 20 mm rotary cannon while it flies
 * left-hand circles over the fight. The gun spins up, then puts thirty rounds a second through the sight, every other
 * one a tracer, inside the arc the door allows. Each round bursts where it lands and goes on through a roof or a wall:
 * the gun's numbers, and why it has both, are `DOOR.gun` in heliData.ts. `?doorgun=old` is the M134 it replaced.
 *
 * The circle is an OrbitPath, and its centre slides slowly after the fight, so a lap stays a lap. Rounds are hitscan:
 * at this range a real one lands in a tenth of a second, and they go through combat like any gun, with the tracer
 * starting from the real muzzle.
 *
 * A mission's ride is either a fixed flight along its marks, or (`Flight.loiter`) this same circle over the fight, crewed by the
 * player with no way out, until the mission says come about: then it flies its marks from wherever it is. The leg into the `hit`
 * mark is the hot zone: as it turns onto it, anti-air's own missile locks on from the mission's launcher, comes up and hits, and the
 * rest of the marks are flown burning. It waits on the hit mark for the missile, so the crash always starts from the same place.
 */
import * as THREE from 'three';
import type { EmitterHandle, LoopHandle } from '../../core/contracts';
import type { ShotSpec } from '../../core/gameplay';
import { clamp, damp, rand, randomInCone, TAU } from '../../core/math';
import type { UtilityMount } from '../../vehicles/utilityModel';
import { FlightPath, type Flight, type FlightMark } from '../../vehicles/flight';
import type { SeatRig } from '../../vehicles/seat';
import { OrbitPath } from './airframe';
import type { AntiAir, Hunt } from './antiAir';
import { GunnerStrike, type Ride } from './gunnerStrike';
import { DOOR as D, SMALL_MAP } from './heliData';
import type { StrikeKit } from './shared';

const G = D.gun;
/** Points around the circle to check for anything tall. */
const RING_SAMPLES = 16;
/** Seconds ahead along the flight, which covers the spiral in. */
const PATH_AHEAD = 1.5;
/** A mission's circle holds until it is told to come about. */
const FOREVER = 1e6;
/** Metres ahead of the aircraft the come-about's second mark is put, so the new flight leaves along the old one's heading. */
const ABOUT_AHEAD = 15;
/** Seconds of lock tone on the mission's missile, and longest it may wait on the hit mark for it before the hit is called anyway. */
const MISSION_LOCK = 2.4;
const MISSION_WAIT = 5;
/** How fast the roll follows the flight on a mission's circle, so the come-about does not snap the horizon. */
const ROLL_RATE = 3;

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
  private path: OrbitPath | FlightPath;
  /** The same thing as `path` on an ordinary call or a mission's circle, and null on a fixed flight. */
  private orbit: OrbitPath | null;
  /** The marks `path` flies, once it is a fixed flight. */
  private marks: readonly FlightMark[] = [];
  /** Strike-clock time the fixed flight began: 0, or the moment a mission's circle came about. */
  private since = 0;
  private nextMark = 1;
  /** Where a mission's missile comes from, once its circle has come about. */
  private launcher: THREE.Vector3 | null = null;
  /** That missile, once it is fired, whether it is off the rail, and whether it has landed. */
  private hunt: Hunt | null = null;
  private launched = false;
  private missileHit = false;
  private waited = 0;
  private rolled = 0;
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

  constructor(
    kit: StrikeKit,
    rig: SeatRig,
    ride: Ride<UtilityMount>,
    private readonly flight: Flight | null = null,
    ai = false,
    /** Fires a mission's missile. Only a ride that loiters needs it. */
    private readonly antiAir: AntiAir | null = null,
  ) {
    super(kit, rig, D, ride, 'door', 'door_gun', ai);
    const { bounds } = kit.ctx.world;
    const small = (bounds.max.x - bounds.min.x) / 2 < SMALL_MAP;
    this.limit = small ? D.limit.small : D.limit.large;
    this.clearance = small ? D.clearance.small : D.clearance.large;
    if (flight && !flight.loiter) {
      this.scripted = true;
      this.orbit = null;
      this.marks = flight.marks;
      this.path = new FlightPath(flight.marks, D.flightSpeed);
    } else {
      this.scripted = flight !== null;
      // A copy, because the hold is cut short the moment the aircraft heads home.
      const holdSeconds = flight ? FOREVER : D.aiSeconds + D.boardSeconds;
      this.orbit = this.path = new OrbitPath({ ...(small ? D.small : D.large), holdSeconds });
      const { center } = this.orbit;
      center.set(clamp(this.fight.x, -this.limit, this.limit), 0, clamp(this.fight.z, -this.limit, this.limit));
      this.orbit.begin(center, Math.atan2(center.z, center.x) + 2.4);
    }
    if (flight) {
      const end = flight.marks[flight.marks.length - 1]!;
      this.seat.fixed(_pos.set(end.x, end.y, end.z));
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
    if (this.orbit && this.flight) this.comeAbout();
    const { frame, path, seat, orbit } = this;
    if (orbit && !this.homebound) this.drift(orbit, dt);
    const t = orbit ? this.clock : this.waitForHit(dt);
    path.at(t, _pos);
    path.heading(t, _fwd);
    if (seat.stage === 'left' && !orbit) this.settle(dt);
    // A mission's ride changes paths in the air, and the roll follows rather than snapping to the new one.
    this.rolled = this.flight?.loiter ? damp(this.rolled, path.roll(t), ROLL_RATE, dt) : path.roll(t);
    frame.fly(_pos, _fwd, this.rolled);
    if (!orbit) this.follow(t);
    this.guideSight();
  }

  /** A mission's circle, told to come about: onto the marks from here, along the heading it has. */
  private comeAbout(): void {
    const from = this.flight!.loiter!();
    if (!from) return;
    const { position } = this.frame.root;
    this.orbit!.heading(this.clock, _fwd).setY(0).normalize();
    const here = (x: number, y: number, z: number): FlightMark => ({ x, y, z, hold: 0, name: '', hit: false });
    this.marks = [
      here(position.x, position.y, position.z),
      here(position.x + _fwd.x * ABOUT_AHEAD, position.y, position.z + _fwd.z * ABOUT_AHEAD),
      ...this.flight!.marks,
    ];
    this.path = new FlightPath(this.marks, D.flightSpeed, true);
    this.orbit = null;
    this.since = this.clock;
    this.nextMark = 2;
    this.launcher = from.clone();
  }

  /**
   * Seconds into the fixed flight. On a mission's ride it stops on the hit mark until the missile lands, so the rest of the flight
   * starts from there whatever the missile did, and calls the hit itself if the missile is lost.
   */
  private waitForHit(dt: number): number {
    let t = this.clock - this.since;
    const hit = this.launcher ? this.marks.findIndex(m => m.hit) : -1;
    if (hit < 0 || this.missileHit) return t;
    const path = this.path as FlightPath;
    const holdEnd = path.arrival(hit) + this.marks[hit]!.hold;
    if (t <= holdEnd) return t;
    this.since += t - holdEnd;
    t = holdEnd;
    this.waited += dt;
    if (this.waited >= MISSION_WAIT) this.hitBy();
    return t;
  }

  /** The sight goes to the launcher through the lock, then rides the missile in. */
  private guideSight(): void {
    const { hunt, seat } = this;
    if (!hunt) return;
    if (hunt.missile && !this.launched) {
      this.launched = true;
      this.flight!.reached('launch');
    }
    seat.guide = this.missileHit ? null : hunt.missile?.body.position ?? hunt.enemy.center;
  }

  /** Down the last of the way, onto whatever the flight ended over. */
  private settle(dt: number): void {
    const floor = this.rig.skyline.ground(_pos.x, _pos.z) + D.flightRest;
    this.sunk += D.flightSink * dt;
    _pos.y = Math.max(_pos.y - this.sunk, floor);
  }

  /** Calls each mark as it comes up, and gets out at the last. On a mission's ride the hit is the missile's, and is called when it lands. */
  private follow(t: number): void {
    const { flight, seat, marks, launcher } = this;
    const path = this.path as FlightPath;
    while (this.nextMark < marks.length && t >= path.arrival(this.nextMark)) {
      const mark = marks[this.nextMark++]!;
      if (mark.hit && launcher) continue;
      if (mark.hit) this.struckDown();
      flight!.reached(mark.name);
      // Onto the leg into the hit mark: the hot zone.
      if (launcher && !this.hunt && marks[this.nextMark]?.hit) this.lockOn(launcher);
    }
    if (t >= path.ends && seat.stage === 'seated') seat.leave();
  }

  /** The lock from the launcher, and the missile after it. With no anti-air to fire it, the hit is called on the hit mark. */
  private lockOn(from: THREE.Vector3): void {
    if (!this.antiAir) return;
    this.hunt = this.antiAir.fire(from, this, MISSION_LOCK);
    this.flight!.reached('lock');
  }

  /** The mission's missile landed, or was lost: either way the aircraft is hit here. */
  private hitBy(): void {
    if (this.missileHit) return;
    this.missileHit = true;
    this.seat.guide = null;
    this.struckDown();
    const mark = this.marks.find(m => m.hit);
    if (mark) this.flight!.reached(mark.name);
  }

  override hit(): boolean {
    if (!this.launcher) return super.hit();
    this.hitBy();
    return false;
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
