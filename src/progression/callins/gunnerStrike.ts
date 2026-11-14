/**
 * The flight every gunner's call-in shares: fly in while the player watches, cut to the seat, fight, cut back, and leave.
 * How each one flies and what each one fires are the abstract methods here.
 *
 * Every helicopter is also an AI. Sent in with a held key it never takes the player at all, and a player who leaves the
 * seat (E, the seat's clock, death) leaves the gun to the crew: the same `shoot`, with the triggers pulled by `aiFight`
 * instead of the mouse. The crew fights until the rounds are gone or `aiSeconds` is up, and there is no way back in.
 *
 * The strike outlives the seat. The aircraft is still fighting or leaving when the player has the body back, so the two
 * end apart: `seat.leave` hands control back at once, and `update` keeps returning false until the aircraft has gone. The
 * seat can also be emptied from outside, on death, so the strike notices that it is empty and never assumes it did it.
 */
import * as THREE from 'three';
import type { EnemyInstance, KillEvent } from '../../core/gameplay';
import { clamp, rand, wrapAngle } from '../../core/math';
import type { Gun } from '../../vehicles/guns';
import type { GunnerWeapon } from '../../vehicles/hud';
import { GunnerSeat, type SeatRig } from '../../vehicles/seat';
import { thickestKnot } from '../../vehicles/targets';
import { EngineSound, type Airframe } from './airframe';
import { Crash, type CrashPlan } from './crash';
import type { HeliPlan } from './heliData';
import { Radio } from './radio';
import { FLARE_LOCKOUT, type Aircraft, type StrikeKit } from './shared';

/** How a gun sits with nobody on it: on the middle of its arc, drooped. */
const STOWED_PITCH = -0.3;
const BINGO_AT = 10;
/** Seconds a fixed flight's rotors take to stop once it is down. */
const WIND_DOWN = 5;
/** The crew says so once for this many bursts that land, and no more. */
const HITS_PER_CALL = 5;
/** A helicopter shot down: it spins as it falls, and the blast where it lands is a big rocket's. */
const CRASH: CrashPlan = { gravity: 11, spin: 4.5, spinUp: 3, pitchRate: 0.5, pitch: 0.5, belly: 1.2, radius: 9, damage: 420, wreck: 9, scale: 1.3 };

const _pivot = new THREE.Vector3();
const _chase = new THREE.Vector3();
const _nose = new THREE.Vector3();
const _to = new THREE.Vector3();
const _was = new THREE.Vector3();

/** One aircraft and its gun, built at load like the Warthog's jet. */
export interface Ride<M extends string> {
  frame: Airframe<M>;
  gun: Gun;
}

export abstract class GunnerStrike<M extends string> implements Aircraft {
  protected readonly seat: GunnerSeat;
  protected readonly radio: Radio;
  protected readonly frame: Airframe<M>;
  protected readonly gun: Gun;
  /** The middle of the thickest knot of enemies, or the player's body when there is nobody. */
  protected readonly fight = new THREE.Vector3();
  protected clock = 0;
  /** A fixed flight: no way out, no clock, and nothing runs out. It ends where it ends, and the aircraft stays there. */
  protected scripted = false;
  /** What `shoot` reads: the mouse in the seat, the crew's choice under AI. */
  protected readonly trigger = { fire: false, alt: false };
  /** The crew has the gun. Once true it stays true. */
  protected ai: boolean;
  protected homebound = false;
  hits: number;
  flares: number;
  rounds: number;
  /** Seconds left of the lockout after a pop. */
  private flareLock = 0;
  /** The flares' line on the panel. */
  private readonly flareRow: GunnerWeapon;
  /** Set when it is shot down. It falls on this, and the strike ends when the wreck has burnt out. */
  private crash: Crash | null = null;
  /** m/s as flown last frame, for the fall to start from. */
  private readonly velocity = new THREE.Vector3();
  private target: EnemyInstance | null = null;
  /** Seconds left of the crew's burst, or below zero, of the pause after it. */
  private burst = 0;
  private knot = 0;
  private readonly engines: EngineSound;
  private readonly stopListening: () => void;
  private scanIn = 0;
  private confirmed = 0;
  private recentKills = 0;
  private killWindow = 0;
  private praiseIn = 0;
  /** Seconds until the view goes back on an empty gun. Negative while there is something left to fire. */
  private windDown = -1;
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
    readonly sources: string,
    ai: boolean,
  ) {
    const { ctx } = kit;
    this.ai = ai;
    this.hits = plan.armour.hits;
    this.flares = plan.armour.flares;
    this.rounds = plan.armour.rounds;
    this.frame = ride.frame;
    this.gun = ride.gun;
    this.radio = new Radio(ctx, plan.callsign, plan.color);
    this.engines = new EngineSound(ctx, plan.engine);
    this.seat = new GunnerSeat(ctx, rig, plan.seat);
    this.flareRow = { name: plan.armour.pilot ? 'PILOT FLARES' : 'FLARES', ammo: this.flares, max: this.flares, reload: -1 };
    this.stopListening = ctx.events.on('enemy:killed', e => this.onKill(e));
    this.scan();
    this.engines.start(1.2);
    ctx.audio.play('walkietalkie_fire');
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
    // Last, after the guns: the flares are the bottom line of the panel.
    this.seat.weapons.push(this.flareRow);
    if (this.ai) {
      this.radio.say('INBOUND. WE HAVE THE GUN.');
      this.kit.ctx.hud.banner(this.plan.callsign, 'CREW ON THE GUN', this.plan.color);
      return;
    }
    this.seat.board();
    this.chaseView();
  }

  get position(): THREE.Vector3 {
    return this.frame.root.position;
  }

  /** Where the guns are heard from: the aircraft under AI, and nowhere in particular (in the head) from the seat. */
  protected get heard(): THREE.Vector3 | undefined {
    return this.ai ? this.frame.root.position : undefined;
  }

  get flown(): boolean {
    return !this.ai && this.seat.stage !== 'left';
  }

  get autoFlares(): boolean {
    return this.plan.armour.pilot || !this.flown;
  }

  get huntable(): boolean {
    return !this.crash && !this.scripted;
  }

  hit(): boolean {
    if (this.crash) return false;
    if (--this.hits > 0) {
      this.radio.say('WE ARE HIT. STILL FLYING.');
      if (this.flown) this.kit.ctx.camera.addTrauma(0.7);
      return false;
    }
    this.down();
    return true;
  }

  shot(): boolean {
    // A mission's fixed flight goes down where the mission says, and nowhere else.
    if (this.crash || this.scripted || this.plan.armour.rounds <= 0) return false;
    if (this.flown) this.kit.ctx.camera.addTrauma(0.12);
    this.kit.ctx.audio.play('impact_metal', { volume: 0.7, position: this.heard });
    if (--this.rounds > 0) {
      if (this.rounds % 8 === 0) this.radio.say('TAKING ROUNDS. TAKING ROUNDS.');
      return false;
    }
    this.down();
    return true;
  }

  popFlares(): boolean {
    if (this.crash || this.flares <= 0 || this.flareLock > 0) return false;
    this.flares--;
    this.flareLock = FLARE_LOCKOUT;
    this.kit.ctx.audio.play('flame_ignite', { volume: 0.8, pitch: 1.5, position: this.heard });
    if (this.plan.armour.pilot) this.radio.say('FLARES. FLARES.');
    return true;
  }

  /** Shot down: the seat is empty at once, and the aircraft falls. Nothing it does from here can hurt the player. */
  down(): void {
    if (this.crash) return;
    const { frame, kit, rig } = this;
    this.hits = 0;
    this.seat.leave();
    this.silence();
    this.engines.stop(2.5);
    this.radio.say('MAYDAY. MAYDAY. WE ARE GOING DOWN.');
    this.crash = new Crash(kit.ctx, frame.root, this.velocity, (x, z) => rig.skyline.ground(x, z), CRASH, `${this.sources}_crash`);
  }

  update(dt: number): boolean {
    if (this.crash) {
      this.frame.update(dt * 0.5);
      this.frame.mount(this.gunMount, _pivot);
      this.radio.update(dt);
      this.stow(dt);
      return this.crash.update(dt);
    }
    const { frame, gunMount, seat, kit } = this;
    this.clock += dt;
    this.flareLock = Math.max(0, this.flareLock - dt);
    this.flareRow.ammo = this.flares;
    // The lockout is shown as a reload on the player's own flares, so a second press can be seen to wait.
    this.flareRow.reload = this.flareLock > 0 && !this.plan.armour.pilot ? 1 - this.flareLock / FLARE_LOCKOUT : -1;
    this.radio.update(dt);
    this.scanIn -= dt;
    if (this.scanIn <= 0) this.scan();

    _was.copy(frame.root.position);
    this.fly(dt);
    if (dt > 0) this.velocity.subVectors(frame.root.position, _was).divideScalar(dt);
    const running = this.scripted ? Math.max(0, 1 - this.departed / WIND_DOWN) : 1;
    frame.update(dt * running);
    frame.mount(gunMount, _pivot);
    const { position } = frame.root;
    this.engines.update(position, running, dt, kit.ctx.render.camera.position);
    seat.altitude = position.y - this.rig.skyline.ground(position.x, position.z);

    if (!this.ai && !this.homebound && seat.stage === 'left') this.handOver();
    if (this.homebound) {
      this.stow(dt);
      this.departed += dt;
      return !this.scripted && this.departed >= this.plan.departSeconds;
    }
    if (this.ai) {
      this.aiFight(dt);
      return false;
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

    this.trigger.fire = kit.ctx.input.isDown('fire');
    this.trigger.alt = kit.ctx.input.isDown('aim');
    if (this.scripted) {
      seat.left = plan.seat.seconds;
      this.shoot(dt);
      return;
    }
    if (!plan.armour.pilot && kit.ctx.input.pressed('jump')) this.popFlares();
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

  /** The seat is empty with rounds left: the crew takes the gun and fights on. A fixed flight just goes on to its end. */
  private handOver(): void {
    if (this.scripted || this.spent) {
      this.headHome();
      return;
    }
    this.ai = true;
    this.trigger.fire = this.trigger.alt = false;
    this.silence();
    this.radio.say('COPY. WE HAVE THE GUN.');
  }

  /**
   * The crew's turn on the gun: the man nearest the middle of the fight, in bursts, through the same `shoot` the player
   * uses. Done when the rounds are, or when `aiSeconds` from the call is up, so the one airframe is home before the
   * call-in can come round again.
   */
  private aiFight(dt: number): void {
    const { plan, seat } = this;
    if (this.spent || this.clock >= plan.boardSeconds + plan.aiSeconds) {
      this.radio.say(this.spent ? 'WINCHESTER. NOTHING LEFT.' : 'BINGO FUEL. RETURNING TO BASE.');
      this.headHome();
      return;
    }
    if (this.clock < plan.boardSeconds) {
      this.stow(dt);
      return;
    }
    const onHim = this.aiAim();
    this.gun.point(_pivot, seat.yaw, seat.pitch, dt);
    this.burst -= dt;
    if (this.burst < 0 && (!onHim || this.burst < -rand(plan.ai.rest[0], plan.ai.rest[1]))) {
      this.burst = onHim ? rand(plan.ai.burst[0], plan.ai.burst[1]) : 0;
    }
    this.trigger.fire = onHim && this.burst > 0;
    this.trigger.alt = this.trigger.fire && this.knot >= plan.ai.altKnot;
    this.shoot(dt);
  }

  /** Swings the gun onto the target, inside its arc. True once it is on him. */
  private aiAim(): boolean {
    const { frame, plan, seat } = this;
    if (!this.target?.alive) this.target = this.nearestToFight();
    const t = this.target;
    if (!t) return false;
    const p = plan.seat;
    _to.subVectors(t.center, _pivot);
    const yaw = Math.atan2(-_to.x, -_to.z);
    const pitch = Math.atan2(_to.y, Math.hypot(_to.x, _to.z));
    _nose.set(0, 0, 1).applyQuaternion(frame.root.quaternion);
    const middle = Math.atan2(-_nose.x, -_nose.z) + p.arcCenter;
    const off = wrapAngle(yaw - middle);
    // The sight goes straight to him; the gun itself swings there at its own pace in `gun.point`.
    seat.yaw = middle + clamp(off, -p.arcHalf, p.arcHalf);
    seat.pitch = clamp(pitch, p.pitchMin, p.pitchMax);
    const cp = Math.cos(seat.pitch);
    seat.aim.set(-Math.sin(seat.yaw) * cp, Math.sin(seat.pitch), -Math.cos(seat.yaw) * cp);
    seat.point.copy(t.center);
    seat.view.position.copy(_pivot);
    return Math.abs(off) <= p.arcHalf && pitch >= p.pitchMin && pitch <= p.pitchMax;
  }

  private nearestToFight(): EnemyInstance | null {
    let best: EnemyInstance | null = null;
    let bestD = Infinity;
    for (const e of this.kit.ctx.enemies.alive) {
      if (!e.alive || this.rig.prisoners.has(e.uid)) continue;
      const d = e.position.distanceToSquared(this.fight);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  private headHome(): void {
    const { color, callsign } = this.plan;
    this.homebound = true;
    this.silence();
    this.depart();
    if (!this.scripted) this.kit.ctx.hud.banner(`${callsign} OFF STATION`, `${this.confirmed} CONFIRMED`, color);
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
    this.knot = thickestKnot(enemies.alive, knotRadius, this.rig.prisoners, this.fight);
    if (this.knot === 0) this.fight.copy(player.position);
    // The crew moves on to whoever is now nearest the fight, so it does not chase one man across the map.
    this.target = null;
  }

  /**
   * A burst from an enemy chopper landed. It comes off the time left: the seat's, or under the crew the time to go home.
   * An airframe bullets can hurt takes a round as well.
   */
  struck(seconds: number): void {
    const { seat, kit, radio } = this;
    if (this.crash) return;
    if (this.ai) this.clock += seconds;
    else if (seat.stage === 'seated') seat.left = Math.max(0, seat.left - seconds);
    else return;
    this.hitCalls++;
    if (this.plan.armour.rounds > 0) {
      this.shot();
      return;
    }
    if (!this.ai) kit.ctx.camera.addTrauma(0.3);
    kit.ctx.audio.play('impact_metal', { volume: 0.9, position: this.heard });
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
    this.crash?.dispose();
    this.frame.hide();
    this.gun.hide();
  }
}
