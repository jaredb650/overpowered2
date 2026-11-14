/**
 * Call-in ownership, targeting flow and running strikes.
 *
 * Reward rule from the first game: a call-in is offered on any kill where the combo is high enough, it is not already
 * held, and its cooldown is over. The combo is not consumed, so 12 and 15 stay reachable.
 */
import * as THREE from 'three';
import type { Action, Ctx, GradeName } from '../../core/contracts';
import type { CallInId } from '../../core/gameplay';
import { ATTACK_AIRFRAME, type AttackMount } from '../../vehicles/attackModel';
import type { Flight } from '../../vehicles/flight';
import { Emplacements } from '../../vehicles/emplacement';
import { CALLIN_HOLD } from '../../input/bindings';
import { CHIN_CANNON, Gun, M134 } from '../../vehicles/guns';
import { SeatRig } from '../../vehicles/seat';
import type { MapSpec } from '../../world/map/spec';
import { UTILITY_AIRFRAME, type UtilityMount } from '../../vehicles/utilityModel';
import { ModelMaterials } from '../modelkit';
import { CALLIN_ORDER, CALLINS } from '../data';
import { Ac130, Ac130Rig } from './ac130';
import { Airframe } from './airframe';
import { Airstrike } from './airstrike';
import { AttackChopper } from './attackChopper';
import { BlackSun, blackSunMaterials } from './blacksun';
import { DoorGunner } from './doorGunner';
import { GroundProbe, groundMaterials } from './ground';
import type { Ride } from './gunnerStrike';
import { Nuke, NukeAftermath, nukeFrontMaterial } from './nuke';
import { Orbital, orbitalMaterials } from './orbital';
import { Ordnance } from './ordnance';
import { isAircraft, TapOrHold, type Strike, type StrikeKit, type StrikeOrder } from './shared';
import { Targeting } from './targeting';
import { Warthog, warthogModel } from './warthog';

const KEYS: Readonly<Record<CallInId, Action>> = {
  airstrike: 'streak',
  warthog: 'callinWarthog',
  doorGunner: 'callinDoorGunner',
  attackChopper: 'callinChopper',
  orbital: 'callinOrbital',
  ac130: 'callinAc130',
  blackSun: 'callinBlackSun',
  nuke: 'callinNuke',
};

/**
 * Aircraft: no mark to choose. A tap takes the seat, a hold sends it in with its crew on the guns. The helicopters find
 * the fight themselves, and the gunship circles whatever the crosshair was on, or the player's feet.
 */
const SEATED: ReadonlySet<CallInId> = new Set<CallInId>(['doorGunner', 'attackChopper', 'ac130']);

const UNDRAWN_LAYER = 31;
/** Seconds a call waits on a jammed uplink before it gets through regardless. Nothing the enemy does may eat a reward for good. */
const UPLINK_PATIENCE = 22;

/** On the Outpost contract, a man with a mast can hold a call-in back. Everywhere else this reads nothing. */
interface Uplink {
  outpost?: { commander: { callInDelay: number } } | null;
}

interface HeldCall {
  id: CallInId;
  /** Sent in with its crew, not flown. */
  ai: boolean;
  age: number;
  readonly point: THREE.Vector3;
  readonly heading: THREE.Vector3;
}
/** Seconds between the device leaving and the gun being drawn. */
const GUN_BACK_DELAY = 0.16;

export class CallInManager {
  readonly held = new Set<CallInId>();
  readonly targeting: Targeting;
  private readonly kit: StrikeKit;
  private readonly cooldowns: Record<CallInId, number> = { airstrike: 0, warthog: 0, doorGunner: 0, attackChopper: 0, orbital: 0, ac130: 0, blackSun: 0, nuke: 0 };
  private readonly strikes: Strike[] = [];
  private readonly aftermath: NukeAftermath;
  private readonly gunship: Ac130Rig;
  private readonly seats: SeatRig;
  /** Mounted guns. Here because they seat the player through the same rig as the aircraft. */
  readonly emplacements: Emplacements;
  private readonly harrow: Ride<AttackMount>;
  private readonly packmule: Ride<UtilityMount>;
  private readonly order: StrikeOrder = { point: new THREE.Vector3(), heading: new THREE.Vector3(1, 0, 0) };
  /** The Orbital Lance keeps the designator up and the gun away until it finishes or the player lets go. */
  private steering: Orbital | null = null;
  private holstered = false;
  private gunBackIn = 0;
  /** Which call-in each running strike is, so anti-air can find it. */
  private readonly flying = new Map<Strike, CallInId>();
  private readonly tapHold = new TapOrHold(CALLIN_HOLD);
  /** The aircraft key `tapHold` is timing. */
  private pressing: CallInId = 'airstrike';
  private readonly heldCall: HeldCall = { id: 'airstrike', ai: false, age: 0, point: new THREE.Vector3(), heading: new THREE.Vector3(1, 0, 0) };
  private calling = false;

  constructor(private readonly ctx: Ctx, materials: ModelMaterials, holdGrade: (grade: GradeName | null) => void) {
    const probe = new GroundProbe(ctx);
    const ordnance = new Ordnance(ctx, materials);
    const jet = warthogModel(materials);
    jet.visible = false;
    ctx.render.scene.add(jet);
    this.kit = { ctx, probe, materials, ordnance, jet };
    this.targeting = new Targeting(ctx);
    this.aftermath = new NukeAftermath(ctx);
    this.gunship = new Ac130Rig(ctx, materials);
    const { scene } = ctx.render;
    this.seats = new SeatRig(ctx, probe, holdGrade);
    this.harrow = { frame: new Airframe(materials, scene, ATTACK_AIRFRAME), gun: new Gun(materials, scene, CHIN_CANNON) };
    this.packmule = { frame: new Airframe(materials, scene, UTILITY_AIRFRAME), gun: new Gun(materials, scene, M134) };
    this.emplacements = new Emplacements(ctx, materials, this.seats, () => this.holster());
    // The map is built by the first run, and its guns stay for every run after.
    const unlisten = ctx.events.on('run:start', () => {
      unlisten();
      for (const spec of (ctx.world as unknown as { spec?: MapSpec }).spec?.emplacements ?? []) this.emplacements.place(spec);
    });
    this.warmShaders(materials);
  }

  /**
   * Strikes build their materials on launch, and a program compiled then stalls the frame of the biggest moment in the
   * game. The renderer's compile pass at load only walks visible objects, so these stand on a layer no camera draws.
   */
  private warmShaders(models: ModelMaterials): void {
    const nothing = new THREE.BufferGeometry();
    const all = [
      models.solid, models.glow, ...groundMaterials(), ...Object.values(orbitalMaterials()), ...Object.values(blackSunMaterials()),
      nukeFrontMaterial(), ...this.aftermath.materials, ...this.gunship.shaders, ...this.seats.shaders,
    ];
    for (const material of all) {
      const stand = new THREE.Mesh(nothing, material);
      stand.layers.set(UNDRAWN_LAYER);
      this.ctx.render.scene.add(stand);
    }
  }

  cooldown(id: CallInId): number {
    return this.cooldowns[id];
  }

  /** What the off hand should be holding. The viewmodel reads this through `progression.targeting`. */
  get aiming(): CallInId | null {
    return this.targeting.id ?? (this.steering ? 'orbital' : null);
  }

  /** Called on every kill with the combo after it. */
  offer(combo: number): void {
    for (const id of CALLIN_ORDER) {
      const def = CALLINS[id];
      if (combo >= def.combo && !this.held.has(id) && this.cooldowns[id] <= 0) this.grant(id);
    }
  }

  grant(id: CallInId): void {
    if (this.held.has(id)) return;
    this.held.add(id);
    this.ctx.audio.play(id === 'airstrike' ? 'perk_airstrike' : id === 'warthog' ? 'perk_warthog' : 'callin_ready');
    // The HUD stamps READY off this event, with the player's real key binding.
    this.ctx.events.emit('callin:ready', { id });
  }

  update(dt: number): void {
    for (const id of CALLIN_ORDER) if (this.cooldowns[id] > 0) this.cooldowns[id] = Math.max(0, this.cooldowns[id] - dt);

    if (this.ctx.player.alive) this.readKeys(dt);
    if (this.calling) this.waitOnUplink(dt);

    const result = this.targeting.update(dt);
    if (result === 'cancel') this.leaveTargeting('callin_cancel');
    else if (result === 'confirm') this.confirm();

    this.kit.ordnance.update(this.ctx.time.dt);
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const strike = this.strikes[i]!;
      if (strike.update(dt)) {
        strike.dispose();
        this.strikes.splice(i, 1);
        this.flying.delete(strike);
        if (strike === this.steering) this.lowerDevice();
      }
    }
    if (this.steering && this.ctx.input.pressed('aim')) {
      this.steering.release();
      this.lowerDevice();
    }

    this.emplacements.update(dt, !this.steering && !this.targeting.id);
    if (this.holstered && !this.aiming && !this.seats.occupied) {
      this.gunBackIn -= dt;
      if (this.gunBackIn <= 0) this.drawGun();
    }
    this.aftermath.update(dt);
  }

  /** Nothing can be called from a seat: leave it first. */
  private readKeys(dt: number): void {
    const { input } = this.ctx;
    if (this.steering || this.seats.occupied) {
      this.tapHold.cancel();
      return;
    }
    if (this.tapHold.waiting) {
      const how = this.tapHold.update(dt, input.isDown(KEYS[this.pressing]));
      if (how) this.board(this.pressing, how === 'hold');
      return;
    }
    for (const id of CALLIN_ORDER) {
      if (!input.pressed(KEYS[id])) continue;
      if (this.targeting.id === id) this.leaveTargeting('callin_cancel');
      else if (this.held.has(id)) {
        if (SEATED.has(id)) {
          this.pressing = id;
          this.tapHold.press();
        } else {
          this.enter(id);
        }
      }
      else this.deny(id);
      return;
    }
  }

  private deny(id: CallInId): void {
    const { audio, hud } = this.ctx;
    audio.play('callin_denied');
    const left = this.cooldowns[id];
    const def = CALLINS[id];
    // The first game failed silently here.
    hud.feed(left > 0 ? `${def.name} COOLDOWN ${Math.ceil(left)}s` : `${def.name} NOT READY`, def.color);
  }

  private enter(id: CallInId): void {
    const { audio, weapons } = this.ctx;
    audio.play('callin_confirm', { pitch: 1.3, volume: 0.6 });
    if (!this.holstered) {
      this.holstered = true;
      weapons.setHolstered(true);
    }
    this.targeting.enter(id);
  }

  private get uplinkDown(): boolean {
    return ((this.ctx.enemies as unknown as Uplink).outpost?.commander.callInDelay ?? 0) > 0;
  }

  /** The call is made and paid for, and it goes the moment the jammer stops or the patience runs out. */
  private hold(id: CallInId, ai = false): void {
    const { audio, hud } = this.ctx;
    this.calling = true;
    this.heldCall.id = id;
    this.heldCall.ai = ai;
    this.heldCall.age = 0;
    this.heldCall.point.copy(this.order.point);
    this.heldCall.heading.copy(this.order.heading);
    audio.play('callin_denied');
    hud.feed(`${CALLINS[id].name} HELD: UPLINK JAMMED`, CALLINS[id].color);
  }

  private waitOnUplink(dt: number): void {
    const call = this.heldCall;
    call.age += dt;
    if (this.uplinkDown && call.age < UPLINK_PATIENCE) return;
    if (this.steering || this.seats.occupied || !this.ctx.player.alive) return;
    this.calling = false;
    this.order.point.copy(call.point);
    this.order.heading.copy(call.heading);
    if (SEATED.has(call.id)) {
      this.takeOff(call.id, call.ai);
      return;
    }
    this.ctx.audio.play('callin_confirm');
    this.fly(call.id);
  }

  private fly(id: CallInId): void {
    const strike = this.launch(id);
    this.strikes.push(strike);
    this.flying.set(strike, id);
    if (strike instanceof Orbital) this.steering = strike;
    else this.lowerDevice();
    this.ctx.events.emit('callin:used', { id, position: this.order.point });
  }

  /** Anti-air on the newest of this kind. An aircraft goes down, with the player thrown out of its seat. Anything else is simply gone. */
  shootDown(id: CallInId): boolean {
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const strike = this.strikes[i]!;
      if (this.flying.get(strike) !== id) continue;
      if (isAircraft(strike)) {
        strike.down();
        return true;
      }
      strike.dispose();
      this.strikes.splice(i, 1);
      this.flying.delete(strike);
      return true;
    }
    return false;
  }

  /** An aircraft, flown (`ai` false) or sent in with its crew. Paid for here, whether or not a jammer holds it up. */
  board(id: CallInId, ai = false): void {
    if (this.targeting.id) this.targeting.exit();
    this.held.delete(id);
    this.cooldowns[id] = CALLINS[id].cooldown;
    if (!this.targeting.solve(this.order.point)) this.order.point.copy(this.ctx.player.position);
    if (this.uplinkDown && !this.calling && this.heldCall.age === 0) {
      this.hold(id, ai);
      return;
    }
    this.heldCall.age = 0;
    this.takeOff(id, ai);
  }

  private takeOff(id: CallInId, ai: boolean): void {
    const { audio, events, hud, player } = this.ctx;
    audio.play('callin_confirm');
    if (ai) hud.feed(`${CALLINS[id].name} SENT IN`, CALLINS[id].color);
    else this.holster();
    const strike = this.launch(id, ai);
    this.strikes.push(strike);
    this.flying.set(strike, id);
    events.emit('callin:used', { id, position: id === 'ac130' ? this.order.point : player.position });
  }

  /** Onto a mission's fixed flight in the Packmule. Nothing on the ground can hold this one up. */
  boardFlight(flight: Flight): void {
    const { audio, weapons } = this.ctx;
    if (this.targeting.id) this.targeting.exit();
    audio.play('callin_confirm');
    if (!this.holstered) {
      this.holstered = true;
      weapons.setHolstered(true);
    }
    const strike = new DoorGunner(this.kit, this.seats, this.packmule, flight);
    this.strikes.push(strike);
    this.flying.set(strike, 'doorGunner');
  }

  private leaveTargeting(sound: string | null): void {
    if (sound) this.ctx.audio.play(sound);
    this.targeting.exit();
    this.lowerDevice();
  }

  /** The hand comes down, and the gun follows it up once it is out of the way. */
  private lowerDevice(): void {
    this.steering = null;
    this.gunBackIn = GUN_BACK_DELAY;
  }

  private holster(): void {
    if (this.holstered) return;
    this.holstered = true;
    this.ctx.weapons.setHolstered(true);
  }

  private drawGun(): void {
    this.holstered = false;
    this.ctx.weapons.setHolstered(false);
  }

  private confirm(): void {
    const id = this.targeting.id!;
    const def = CALLINS[id];
    const { audio } = this.ctx;
    this.order.point.copy(this.targeting.point);
    this.order.heading.copy(this.targeting.heading);
    this.held.delete(id);
    this.cooldowns[id] = def.cooldown;
    this.targeting.exit();
    if (this.uplinkDown) {
      this.hold(id);
      this.lowerDevice();
      return;
    }
    audio.play('callin_confirm');
    this.fly(id);
  }

  private launch(id: CallInId, ai = false): Strike {
    switch (id) {
      case 'airstrike': return new Airstrike(this.kit, this.order);
      case 'warthog': return new Warthog(this.kit, this.order);
      case 'doorGunner': return new DoorGunner(this.kit, this.seats, this.packmule, null, ai);
      case 'attackChopper': return new AttackChopper(this.kit, this.seats, this.harrow, ai);
      case 'orbital': return new Orbital(this.kit, this.order, this.targeting);
      case 'ac130': return new Ac130(this.kit, this.order, this.gunship, this.seats, ai);
      case 'blackSun': return new BlackSun(this.kit, this.order);
      case 'nuke': return new Nuke(this.kit, this.order, this.aftermath);
    }
  }

  /** The player died: nothing is left half-open, but strikes already called in still land. */
  onDeath(): void {
    this.seats.eject();
    this.tapHold.cancel();
    this.calling = false;
    if (this.targeting.id) this.leaveTargeting(null);
    this.steering?.release();
    this.steering = null;
    if (this.holstered) this.drawGun();
  }

  clear(): void {
    this.emplacements.clear();
    if (this.targeting.id) this.targeting.exit();
    this.steering = null;
    for (const strike of this.strikes) strike.dispose();
    this.strikes.length = 0;
    this.flying.clear();
    this.tapHold.cancel();
    this.calling = false;
    this.kit.ordnance.clear();
    this.aftermath.clear();
    this.held.clear();
    for (const id of CALLIN_ORDER) this.cooldowns[id] = 0;
    if (this.holstered) this.drawGun();
  }
}
