/**
 * Door Gunner: the player stands in the open left door of the Packmule with an M134 while it flies left-hand circles
 * over the fight. The gun spins up, then puts sixty rounds a second through the sight, one in four a tracer, inside the
 * arc the door allows.
 *
 * The circle is an OrbitPath, and its centre slides slowly after the fight, so a lap stays a lap. Rounds are hitscan:
 * at this range a real one lands in a tenth of a second, and they go through combat like any gun, with the tracer
 * starting from the real muzzle.
 */
import * as THREE from 'three';
import type { LoopHandle } from '../../core/contracts';
import type { ShotSpec } from '../../core/gameplay';
import { clamp, damp, rand, randomInCone } from '../../core/math';
import type { UtilityMount } from '../../vehicles/utilityModel';
import type { SeatRig } from '../../vehicles/seat';
import { OrbitPath } from './airframe';
import { GunnerStrike, type Ride } from './gunnerStrike';
import { DOOR as D, SMALL_MAP } from './heliData';
import type { StrikeKit } from './shared';

const G = D.gun;

const _pos = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _bore = new THREE.Vector3();
const _casing = new THREE.Vector3();

const SHOT: ShotSpec = {
  damage: G.damage, source: 'door_gun', team: 'player', maxDistance: G.range, tracerFrom: _muzzle,
  force: G.force, severMult: G.severMult, impactScale: G.impactScale,
};

export class DoorGunner extends GunnerStrike<UtilityMount> {
  private readonly path: OrbitPath;
  private readonly limit: number;
  private readonly ceiling: number;
  private readonly drop: number;
  private floorIn = 0;
  /** How far the whole circle has to rise to clear what it flies over. */
  private lift = 0;
  private shotIn = 0;
  private fired = 0;
  private spinning = false;
  private spinLoop: LoopHandle | null = null;
  private fireLoop: LoopHandle | null = null;
  private readonly belt = { name: 'M134 7.62', ammo: G.rounds, max: G.rounds };

  constructor(kit: StrikeKit, rig: SeatRig, ride: Ride<UtilityMount>) {
    super(kit, rig, D, ride, 'door', 'door_gun');
    const { bounds } = kit.ctx.world;
    const small = (bounds.max.x - bounds.min.x) / 2 < SMALL_MAP;
    this.limit = small ? D.limit.small : D.limit.large;
    this.ceiling = bounds.max.y - 1;
    this.drop = this.ceiling - bounds.min.y;
    // A copy, because the hold is cut short the moment the seat empties.
    this.path = new OrbitPath({ ...(small ? D.small : D.large), holdSeconds: D.seat.seconds + D.boardSeconds });
    const { center } = this.path;
    center.set(clamp(this.fight.x, -this.limit, this.limit), 0, clamp(this.fight.z, -this.limit, this.limit));
    this.path.begin(center, Math.atan2(center.z, center.x) + 2.4);
    this.seat.weapons.push(this.belt);
    this.fly(0);
    this.begin();
  }

  private topAt(x: number, z: number): number {
    const h = this.kit.probe.heightAt(x, this.ceiling, z, this.drop);
    return Number.isNaN(h) ? 0 : h;
  }

  /** The centre follows the fight on the map, and rises for anything tall on the circle. */
  private drift(dt: number): void {
    const { center, plan } = this.path;
    center.x = damp(center.x, clamp(this.fight.x, -this.limit, this.limit), D.focusRate, dt);
    center.z = damp(center.z, clamp(this.fight.z, -this.limit, this.limit), D.focusRate, dt);
    this.floorIn -= dt;
    if (this.floorIn <= 0) {
      this.floorIn = D.floorEvery;
      this.path.at(this.clock + 1.5, _dir);
      this.lift = Math.max(0, this.topAt(_dir.x, _dir.z) + D.clearance - plan.altitude);
    }
    center.y = damp(center.y, this.lift, 1, dt);
  }

  protected fly(dt: number): void {
    const { frame, path, clock, seat } = this;
    if (seat.stage !== 'left') this.drift(dt);
    path.at(clock, _pos);
    path.heading(clock, _fwd);
    frame.fly(_pos, _fwd, path.roll(clock));
    seat.altitude = _pos.y - this.topAt(_pos.x, _pos.z);
  }

  protected shoot(dt: number): void {
    const { audio, input } = this.kit.ctx;
    const { gun, seat } = this;
    const held = input.isDown('fire') && this.belt.ammo > 0;
    seat.spin = clamp(seat.spin + (held ? dt / G.spinUp : -dt / G.spinDown));
    gun.turn(seat.spin * G.barrelRate * dt);
    if (held && !this.spinning) {
      this.spinning = true;
      audio.play('minigun_spinup');
      this.spinLoop = audio.startLoop('minigun_spin_loop', { fadeIn: 0.1 });
    } else if (!held && this.spinning) {
      this.spinDown();
    }
    if (held && seat.spin >= G.fireAt) this.stream(dt);
    else this.ceaseFire();
  }

  private spinDown(): void {
    this.spinning = false;
    this.spinLoop?.stop(0.2);
    this.spinLoop = null;
    this.kit.ctx.audio.play('minigun_spindown');
  }

  private ceaseFire(): void {
    this.fireLoop?.stop(0.08);
    this.fireLoop = null;
  }

  private stream(dt: number): void {
    const { audio, camera } = this.kit.ctx;
    this.fireLoop ??= audio.startLoop('minigun_fire_loop', { fadeIn: 0.03 });
    this.shotIn -= dt;
    for (let i = 0; this.shotIn <= 0 && i < G.perFrame && this.belt.ammo > 0; i++) {
      this.shotIn += 1 / G.roundsPerSecond;
      this.round();
    }
    // A short frame's debt is paid above. A long frame's is forgiven, so the rate never bursts to catch up.
    if (this.shotIn < 0) this.shotIn = 0;
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
    if (this.fired % G.flashEvery === 0) fx.muzzleFlash(_muzzle, _bore, 'minigun');
    if (this.fired % G.casingEvery === 0) {
      _casing.copy(_bore).multiplyScalar(-1.5);
      _casing.y -= rand(3, 5);
      fx.shellCasing(gun.root.position, _casing, 'rifle');
    }
  }

  protected get spent(): boolean {
    return this.belt.ammo <= 0;
  }

  protected silence(): void {
    this.ceaseFire();
    if (this.spinning) this.spinDown();
    this.seat.spin = 0;
  }

  protected depart(): void {
    const { path } = this;
    path.plan.holdSeconds = Math.max(0, this.clock - path.plan.entrySeconds);
  }
}
