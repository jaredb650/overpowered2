/**
 * Attack Chopper: the player takes the gunner's seat in the Harrow and the pilot does the rest. He flies to wherever the
 * enemies are thickest, circles them with the nose on the fight, and keeps moving as the fight moves.
 *
 * LMB is the chin cannon and RMB the rockets, which can both run at once. Rounds and rockets are ordinary projectiles,
 * so unlike the gunship's they can set off barrels: the body is parked and cannot be hurt by it, and a Kill House
 * blown up from the air is the point. Both still take selfDamage 0 and playerPush 0, for rounds that land just after the
 * player is back on the ground.
 */
import * as THREE from 'three';
import type { PlayOptions } from '../../core/contracts';
import type { ProjectileSpec } from '../../core/gameplay';
import { damp, rand, randomInCone } from '../../core/math';
import type { AttackMount } from '../../vehicles/attackModel';
import { Autopilot } from '../../vehicles/pilot';
import type { SeatRig } from '../../vehicles/seat';
import { GunnerStrike, type Ride } from './gunnerStrike';
import { ATTACK as A, SMALL_MAP } from './heliData';
import type { StrikeKit } from './shared';

const C = A.cannon;
const R = A.rockets;

const _from = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _play: PlayOptions = { unaffectedByTime: true };

const SHELL: ProjectileSpec = {
  origin: _from, velocity: _vel, kind: 'shell', team: 'player', damage: C.damage, source: 'chopper_cannon',
  explosion: { radius: C.radius, damage: C.damage, kind: 'shell', selfDamage: 0, playerPush: 0 },
  trail: 'none', tracer: 'heavy', lifetime: 3,
};

const ROCKET: ProjectileSpec = {
  origin: _from, velocity: _vel, kind: 'rocket', team: 'player', damage: R.damage, source: 'chopper_rocket',
  explosion: { radius: R.radius, damage: R.damage, kind: 'rocket', selfDamage: 0, playerPush: 0 },
  trail: 'smoke', lifetime: 4,
};

export class AttackChopper extends GunnerStrike<AttackMount> {
  private readonly pilot: Autopilot;
  private readonly focus = new THREE.Vector3();
  private readonly away = new THREE.Vector3();
  private leaving = false;
  private cannonIn = 0;
  private rocketIn = 0;
  private leftPod = false;

  private readonly cannon = { name: '30MM CANNON', ammo: C.rounds, max: C.rounds };
  private readonly rockets = { name: 'ROCKETS', ammo: R.rounds, max: R.rounds };

  constructor(kit: StrikeKit, rig: SeatRig, ride: Ride<AttackMount>, ai = false) {
    super(kit, rig, A, ride, 'chin', 'chopper', ai);
    const { bounds } = kit.ctx.world;
    const span = (bounds.max.x - bounds.min.x) / 2;
    const plan = span < SMALL_MAP ? A.small : A.large;
    this.pilot = new Autopilot(plan);
    this.focus.copy(this.fight);
    this.seat.weapons.push(this.cannon, this.rockets);

    // In over the nearest edge, placed so it reaches the fight about as the view cuts to the seat.
    _dir.set(this.fight.x, 0, this.fight.z);
    if (_dir.lengthSq() < 1) _dir.set(1, 0, 0);
    _dir.normalize();
    _from.copy(this.fight).addScaledVector(_dir, plan.dash * A.boardSeconds + plan.standoff * 1.4);
    _from.y = Math.max(rig.skyline.at(_from.x, _from.z) + plan.clearance, plan.altitude);
    this.pilot.begin(_from, _aim.copy(_dir).negate());
    this.fly(0);
    this.begin();
  }

  protected fly(dt: number): void {
    const { pilot, frame } = this;
    this.focus.x = damp(this.focus.x, this.fight.x, A.focusRate, dt);
    this.focus.z = damp(this.focus.z, this.fight.z, A.focusRate, dt);
    const floor = this.rig.skyline.along(pilot.position, pilot.velocity, A.floorAhead);
    if (this.leaving) pilot.update(dt, this.away, floor + A.exitClimb);
    else pilot.update(dt, this.focus, floor);
    frame.fly(pilot.position, pilot.forward, pilot.roll);
  }

  protected shoot(dt: number): void {
    this.cannonIn = Math.max(0, this.cannonIn - dt);
    this.rocketIn = Math.max(0, this.rocketIn - dt);
    if (this.trigger.fire && this.cannon.ammo > 0 && this.cannonIn <= 0) this.fireCannon();
    if (this.trigger.alt && this.rockets.ammo > 0 && this.rocketIn <= 0) this.fireRocket();
  }

  /** A line from `_from` to the sight, opened by `spread`. Writes `_vel` at `speed`. */
  private lay(spread: number, speed: number): void {
    _aim.subVectors(this.seat.point, _from).normalize();
    randomInCone(_aim, spread, _dir);
    _vel.copy(_dir).multiplyScalar(speed);
  }

  private fireCannon(): void {
    const { audio, camera, combat, fx } = this.kit.ctx;
    const { gun } = this;
    this.cannonIn = C.interval;
    this.cannon.ammo--;
    gun.muzzle(_from);
    this.lay(C.spread, C.speed);
    combat.spawnProjectile(SHELL);
    // The barrel is right under the sight, and the autocannon's own flash would cover what it is shooting at.
    fx.muzzleFlash(_from, _dir, 'rifle');
    gun.recoil(C.recoil);
    if (!this.ai) {
      camera.kick(C.kick, rand(-C.kick, C.kick) * 0.5);
      camera.addTrauma(C.trauma);
    }
    _play.position = this.heard;
    _play.volume = 0.8;
    _play.pitch = rand(1.2, 1.3);
    audio.play('autocannon_fire', _play);
  }

  private fireRocket(): void {
    const { audio, camera, combat, fx } = this.kit.ctx;
    this.rocketIn = R.interval;
    this.rockets.ammo--;
    this.leftPod = !this.leftPod;
    this.frame.mount(this.leftPod ? 'podLeft' : 'podRight', _from);
    this.lay(R.spread, R.speed);
    combat.spawnProjectile(ROCKET);
    fx.muzzleFlash(_from, _dir, 'rocket');
    if (!this.ai) camera.addTrauma(R.trauma);
    _play.position = this.heard;
    _play.volume = 0.9;
    _play.pitch = rand(0.95, 1.1);
    audio.play('rocket_fire', _play);
  }

  protected get spent(): boolean {
    return this.cannon.ammo <= 0 && this.rockets.ammo <= 0;
  }

  protected depart(): void {
    const { pilot } = this;
    this.leaving = true;
    this.away.copy(pilot.position).addScaledVector(_dir.copy(pilot.position).setY(0).normalize(), A.exitReach);
  }
}
