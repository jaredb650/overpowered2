/**
 * The flight every gunner's call-in shares: fly in while the player watches, cut to the seat, fight until the time or
 * the rounds run out, cut back, and leave. How each one flies and what each one fires are the abstract methods here.
 *
 * The strike outlives the seat. The aircraft is still leaving when the player has the body back, so the two end apart:
 * `seat.leave` hands control back at once, and `update` keeps returning false until the aircraft has gone. The seat can
 * also be emptied from outside, on death, so the strike notices that it is empty and never assumes it did it.
 */
import * as THREE from 'three';
import type { FriendlyAircraft, KillEvent } from '../../core/gameplay';
import type { Gun } from '../../vehicles/guns';
import { GunnerSeat, type SeatRig } from '../../vehicles/seat';
import { thickestKnot } from '../../vehicles/targets';
import { EngineSound, type Airframe } from './airframe';
import type { HeliPlan } from './heliData';
import { Radio } from './radio';
import type { Strike, StrikeKit } from './shared';

/** How a gun sits with nobody on it: on the middle of its arc, drooped. */
const STOWED_PITCH = -0.3;
const BINGO_AT = 10;
/** The crew says so once for this many bursts that land, and no more. */
const HITS_PER_CALL = 5;

const _pivot = new THREE.Vector3();
const _chase = new THREE.Vector3();
const _nose = new THREE.Vector3();

/** One aircraft and its gun, built at load like the Warthog's jet. */
export interface Ride<M extends string> {
  frame: Airframe<M>;
  gun: Gun;
}

export abstract class GunnerStrike<M extends string> implements Strike {
  protected readonly seat: GunnerSeat;
  protected readonly radio: Radio;
  protected readonly frame: Airframe<M>;
  protected readonly gun: Gun;
  /** The middle of the thickest knot of enemies, or the player's body when there is nobody. */
  protected readonly fight = new THREE.Vector3();
  protected clock = 0;
  private readonly engines: EngineSound;
  private readonly stopListening: () => void;
  private scanIn = 0;
  private confirmed = 0;
  private recentKills = 0;
  private killWindow = 0;
  private praiseIn = 0;
  /** Seconds until the view goes back on an empty gun. Negative while there is something left to fire. */
  private windDown = -1;
  private homebound = false;
  private departed = 0;
  private bingoCalled = false;
  private hitCalls = 0;

  constructor(
    protected readonly kit: StrikeKit,
    protected readonly rig: SeatRig,
    protected readonly plan: HeliPlan,
    ride: Ride<M>,
    private readonly gunMount: M,
    /** Every damage source this aircraft uses starts with this. */
    private readonly sources: string,
  ) {
    const { ctx } = kit;
    this.frame = ride.frame;
    this.gun = ride.gun;
    this.radio = new Radio(ctx, plan.callsign, plan.color);
    this.engines = new EngineSound(ctx, plan.engine);
    this.seat = new GunnerSeat(ctx, rig, plan.seat);
    this.stopListening = ctx.events.on('enemy:killed', e => this.onKill(e));
    this.scan();
    this.engines.start(1.2);
    ctx.audio.play('walkietalkie_fire');
    const aircraft: FriendlyAircraft = { position: this.frame.root.position, hit: seconds => this.struck(seconds) };
    ctx.enemies.vehicles?.setFriendly(aircraft);
  }

  /** Moves the airframe for this frame. */
  protected abstract fly(dt: number): void;
  /** Reads the triggers. Only called while seated. */
  protected abstract shoot(dt: number): void;
  /** Nothing left to fire. */
  protected abstract get spent(): boolean;
  /** Stops whatever the guns have running. Guns that only play one-shots have nothing to stop. */
  protected silence(): void {}
  /** The seat is empty: head for home. */
  protected abstract depart(): void;

  /** Call at the end of a subclass constructor, once the aircraft is in the air. */
  protected begin(): void {
    this.seat.board();
    this.chaseView();
  }

  update(dt: number): boolean {
    const { frame, gunMount, seat, kit } = this;
    this.clock += dt;
    this.radio.update(dt);
    this.scanIn -= dt;
    if (this.scanIn <= 0) this.scan();

    this.fly(dt);
    frame.update(dt);
    frame.mount(gunMount, _pivot);
    const { position } = frame.root;
    this.engines.update(position, 1, dt, kit.ctx.render.camera.position);
    seat.altitude = position.y - this.rig.skyline.ground(position.x, position.z);

    if (seat.stage === 'left') {
      if (!this.homebound) this.headHome();
      this.stow(dt);
      this.departed += dt;
      return this.departed >= this.plan.departSeconds;
    }
    if (seat.stage === 'boarding') this.boarding();
    seat.update(dt, frame.root.quaternion, _pivot);
    if (seat.stage === 'seated') this.fighting(dt);
    else this.stow(dt);
    return false;
  }

  private chaseView(): void {
    const { frame, seat } = this;
    const c = this.plan.chase;
    _chase.set(c[0], c[1], c[2]).applyQuaternion(frame.root.quaternion).add(frame.root.position);
    seat.chase(_chase, frame.root.position);
  }

  private boarding(): void {
    const { gun, plan, radio, seat } = this;
    this.chaseView();
    if (this.clock < plan.boardSeconds) return;
    seat.sit(this.fight, _pivot);
    gun.snap(seat.yaw, seat.pitch);
    radio.say('GUNS FREE. YOUR TRIGGER.');
    this.kit.ctx.hud.banner(plan.callsign, 'ON STATION', plan.color);
  }

  private fighting(dt: number): void {
    const { gun, kit, plan, radio, seat } = this;
    gun.point(_pivot, seat.yaw, seat.pitch, dt);
    this.killWindow -= dt;
    this.praiseIn -= dt;
    if (this.killWindow <= 0) this.recentKills = 0;

    if (kit.ctx.input.pressed('interact') || seat.left <= 0) {
      seat.leave();
      return;
    }
    if (seat.left <= BINGO_AT && !this.bingoCalled) {
      this.bingoCalled = true;
      radio.say('TEN SECONDS. BINGO FUEL.');
    }
    this.shoot(dt);
    if (this.windDown < 0) {
      if (!this.spent) return;
      this.windDown = plan.winchester;
      radio.say('WINCHESTER. NOTHING LEFT.');
    }
    this.windDown -= dt;
    if (this.windDown <= 0) seat.leave();
  }

  private headHome(): void {
    const { color, callsign } = this.plan;
    this.homebound = true;
    this.silence();
    this.depart();
    this.kit.ctx.hud.banner(`${callsign} OFF STATION`, `${this.confirmed} CONFIRMED`, color);
  }

  private stow(dt: number): void {
    const { frame, gun, plan } = this;
    _nose.set(0, 0, 1).applyQuaternion(frame.root.quaternion);
    gun.point(_pivot, Math.atan2(-_nose.x, -_nose.z) + plan.seat.arcCenter, STOWED_PITCH, dt);
  }

  private scan(): void {
    const { enemies, player } = this.kit.ctx;
    const { knotRadius, scanEvery } = this.plan;
    this.scanIn = scanEvery;
    // The one thing in the sky that can shoot back outranks any number of men on the ground.
    if (enemies.vehicles?.chopperAt(this.fight)) return;
    if (thickestKnot(enemies.alive, knotRadius, this.rig.prisoners, this.fight) === 0) this.fight.copy(player.position);
  }

  /** A burst from an enemy chopper landed. It comes off the time left in the seat. */
  private struck(seconds: number): void {
    const { seat, kit, radio } = this;
    if (seat.stage !== 'seated') return;
    seat.left = Math.max(0, seat.left - seconds);
    kit.ctx.camera.addTrauma(0.3);
    kit.ctx.audio.play('impact_metal', { volume: 0.9 });
    this.hitCalls++;
    if (this.hitCalls % HITS_PER_CALL === 1) radio.say('TAKING FIRE. KILL THAT GUNSHIP.');
  }

  private onKill(e: KillEvent): void {
    if (!e.damage.source.startsWith(this.sources)) return;
    const { praise } = this.plan;
    this.confirmed++;
    this.recentKills++;
    this.killWindow = praise.window;
    if (this.recentKills < praise.kills || this.praiseIn > 0) return;
    this.praiseIn = praise.every;
    this.radio.say('GOOD HITS. KEEP IT ON THEM.');
  }

  dispose(): void {
    this.seat.leave(true);
    this.silence();
    this.engines.stop(1.2);
    this.stopListening();
    this.frame.hide();
    this.gun.hide();
    this.kit.ctx.enemies.vehicles?.setFriendly(null);
  }
}
