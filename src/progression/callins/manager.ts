/**
 * Call-in ownership, targeting flow and running strikes.
 *
 * Reward rule from the first game: a call-in is offered on any kill where the combo is high enough, it is not already
 * held, and its cooldown is over. The combo is not consumed, so 12 and 15 stay reachable.
 */
import { proofPage } from '../../core/proofmode';
import * as THREE from 'three';
import type { Action, Ctx, GradeName } from '../../core/contracts';
import type { CallInId } from '../../core/gameplay';
import { ATTACK_AIRFRAME, type AttackMount } from '../../vehicles/attackModel';
import type { Flight } from '../../vehicles/flight';
import { Emplacements } from '../../vehicles/emplacement';
import { FRAME_ASKED } from '../../frame/data';
import { Frame } from '../../frame/seat';
import { CALLIN_HOLD } from '../../input/bindings';
import { CHIN_CANNON, Gun, M134 } from '../../vehicles/guns';
import { SeatRig } from '../../vehicles/seat';
import type { MapSpec } from '../../world/map/spec';
import { UTILITY_AIRFRAME, type UtilityMount } from '../../vehicles/utilityModel';
import { ModelMaterials } from '../modelkit';
import { CALLIN_ORDER, CALLINS } from '../data';
import { Ac130, Ac130Rig } from './ac130';
import { Ac130Rounds } from './ac130Rounds';
import { Airframe } from './airframe';
import { Airstrike } from './airstrike';
import { AntiAir } from './antiAir';
import { AttackChopper } from './attackChopper';
import { BlackSun, blackSunMaterials } from './blacksun';
import { DoorGunner } from './doorGunner';
import { FrameDrop } from './frameDrop';
import { GroundProbe, groundMaterials } from './ground';
import type { Ride } from './gunnerStrike';
import { uplinkJammed, type CallinLink, type CallinSend, type CallNews, type CallOrder, type MechKind } from './link';
import { CallinMirror } from './mirror';
import { Nuke, NukeAftermath, nukeFrontMaterial } from './nuke';
import { Orbital, orbitalMaterials } from './orbital';
import { Ordnance } from './ordnance';
import { isAircraft, TapOrHold, type Aircraft, type Strike, type StrikeKit, type StrikeNet, type StrikeOrder } from './shared';
import { Sentry, SentryRig } from './sentry';
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
  sentry: 'callinSentry',
  frame: 'callinFrame',
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
/** A page the proofs may drive (a dev build, or this computer): what exists only for them is made only there. */
const PROOF_PAGE = proofPage();
const NO_STRIKES: readonly Strike[] = [];
/** Seconds between the device leaving and the gun being drawn. */
const GUN_BACK_DELAY = 0.16;

export class CallInManager implements CallinLink {
  readonly held = new Set<CallInId>();
  /** A mission has shut the sky: every key is refused, and what is held stays held. */
  shut = false;
  readonly targeting: Targeting;
  private readonly kit: StrikeKit;
  private readonly cooldowns: Record<CallInId, number> = { airstrike: 0, warthog: 0, doorGunner: 0, sentry: 0, attackChopper: 0, orbital: 0, ac130: 0, frame: 0, blackSun: 0, nuke: 0 };
  private readonly strikes: Strike[] = [];
  private readonly aftermath: NukeAftermath;
  private readonly gunship: Ac130Rig;
  private readonly seats: SeatRig;
  /** Mounted guns. Here because they seat the player through the same rig as the aircraft. */
  readonly emplacements: Emplacements;
  /** The Distraint Frame, here for the same reason. Built the first time it is asked for. */
  private frameRig: Frame | null = null;
  private readonly harrow: Ride<AttackMount>;
  private readonly packmule: Ride<UtilityMount>;
  private readonly mark: StrikeOrder = { point: new THREE.Vector3(), heading: new THREE.Vector3(1, 0, 0), seed: 0 };
  /**
   * Co-op (link.ts). `send` is set while there are other players to tell: every call-in this player makes goes out through
   * it as an order, with whatever it does afterwards as news, under `serial`, its own number. `mirror` plays theirs here.
   */
  private sender: CallinSend | null = null;
  readonly mirror: CallinMirror;
  private serial = 0;
  /** The number each running strike was told under, so its end can be told too. */
  private readonly told = new Map<Strike, number>();
  /** Co-op: each told strike's order and when it began (`performance.now()`), for a player who arrives while it runs. */
  private readonly orders = new Map<Strike, { order: CallOrder; at: number }>();
  /** Co-op guest: the host's word that the call-in uplink is jammed (the radio men are the host's). */
  private uplinkTold = false;
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
  /** The enemy's side of the air war: hunters, their missiles, the flares, the rounds that reach a door gunner. */
  private readonly antiAir: AntiAir;
  /** The one AA sentry: its cooldown outlasts its minute on station. */
  private readonly sentryRig: SentryRig;
  private readonly aircraft: Aircraft[] = [];

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
    this.antiAir = new AntiAir(ctx, new Ac130Rounds(ctx, materials), this.seats.prisoners);
    this.sentryRig = new SentryRig(materials, scene);
    this.mirror = new CallinMirror(ctx, materials, this.seats, this.aftermath);
    this.emplacements = new Emplacements(ctx, materials, this.seats, () => this.holster());
    // Co-op guest: the uplink is jammed when the host says so, and clear again with a new run.
    ctx.events.on('commander:status', e => { if (e.flag === 'uplink') this.uplinkTold = e.on; });
    ctx.events.on('run:start', () => { this.uplinkTold = false; });
    // The map is built by the first run, and its guns stay for every run after.
    const unlisten = ctx.events.on('run:start', () => {
      unlisten();
      for (const spec of (ctx.world as unknown as { spec?: MapSpec }).spec?.emplacements ?? []) this.emplacements.place(spec);
    });
    // `?frame=1`: every run starts in a Frame at the player's spawn.
    if (FRAME_ASKED) {
      ctx.events.on('run:start', () => {
        const spawn = ctx.world.playerSpawns[0];
        if (spawn) this.frame.board(spawn.position, spawn.yaw);
      });
    }
    ctx.campaign.provide({
      frame: (act, at, done) => {
        const pos = new THREE.Vector3(...at.at);
        const yaw = at.yaw ?? 0;
        if (act === 'kneel') {
          this.frame.kneel(pos, yaw, done);
        } else if (act === 'board') {
          if (!this.frame.occupied) this.frame.board(pos, yaw, Infinity, false);
          done();
        } else if (act === 'eject') {
          this.frame.ejectTo(pos, done);
        } else {
          done();
        }
      },
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

  /** The Distraint Frame (src/frame). `board` puts the player in a fresh one. */
  get frame(): Frame {
    if (!this.frameRig) {
      this.frameRig = new Frame(this.ctx, this.kit.materials, this.seats, () => this.holster());
      this.linkFrame();
    }
    return this.frameRig;
  }

  // --- Co-op: this player's call-ins told to the others, and theirs played here (link.ts) -------------------------------

  get send(): CallinSend | null {
    return this.sender;
  }

  set send(send: CallinSend | null) {
    this.sender = send;
    this.linkFrame();
    // An enemy's missile at one of this player's aircraft is told to the screens that fly a copy of it.
    this.antiAir.net = send ? {
      launch: (target, from) => { const n = this.told.get(target as unknown as Strike); if (n !== undefined) send.news({ n, k: 'aa', v: [from.x, from.y, from.z] }); },
      burst: (target, at) => { const n = this.told.get(target as unknown as Strike); if (n !== undefined) send.news({ n, k: 'aax', v: [at.x, at.y, at.z] }); },
    } : null;
  }

  /** The Frame tells the others of itself whenever the player is in it, however they got there. */
  private linkFrame(): void {
    const frame = this.frameRig;
    if (!frame) return;
    const send = this.sender;
    frame.net = send ? { pose: values => send.mech(values), news: (kind, values) => send.mechNews(kind, values) } : null;
  }

  order(slot: number, order: CallOrder): void { this.mirror.begin(slot, order); }
  news(slot: number, news: CallNews): void { this.mirror.news(slot, news); }
  mech(slot: number, pose: number[] | null): void { this.mirror.mech(slot, pose); }
  mechNews(slot: number, kind: MechKind, values: number[]): void { this.mirror.mechNews(slot, kind, values); }
  drop(slot: number): void { this.mirror.drop(slot); }
  runningOrders(): CallOrder[] {
    const now = performance.now();
    return [...this.orders.values()].map(({ order, at }) => ({ ...order, age: Math.max(0, (now - at) / 1000) }));
  }
  copyOrders(slot: number): CallOrder[] { return this.mirror.orders(slot); }
  inFrame(slot: number): boolean { return this.mirror.inFrame(slot); }
  has(slot: number, id: CallInId): boolean { return this.mirror.copies(slot).some(copy => copy.id === id); }

  /** A strike's line to the other screens' copies of it, or nothing to say alone. Call before the strike is built. */
  private net(): StrikeNet {
    const send = this.sender;
    if (!send) return {};
    const n = this.serial = (this.serial + 1) & 255;
    return { tell: (k, v) => send.news(v ? { n, k, v } : { n, k }) };
  }

  /** Tells the others of a strike just launched: `yaw` is the one angle it needs (see `CallOrder.yaw`). */
  private announce(strike: Strike, id: CallInId, ai: boolean, at: THREE.Vector3, yaw: number): void {
    const send = this.sender;
    if (!send) return;
    const n = this.serial;
    this.told.set(strike, n);
    const order: CallOrder = { n, id, at: [at.x, at.y, at.z], yaw, seed: this.mark.seed ?? 0, ai, age: 0 };
    this.orders.set(strike, { order, at: performance.now() });
    send.order(order);
  }

  /** A told strike is over: its copies that cannot know (an aircraft's, a waiting Frame's) are told. */
  private retire(strike: Strike): void {
    const n = this.told.get(strike);
    this.orders.delete(strike);
    if (n === undefined) return;
    this.told.delete(strike);
    this.sender?.news({ n, k: 'end' });
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
        this.retire(strike);
        if (strike === this.steering) this.lowerDevice();
      }
    }
    this.mirror.update(dt);
    this.aircraft.length = 0;
    for (const strike of this.strikes) if (isAircraft(strike)) this.aircraft.push(strike);
    if (this.frameRig?.occupied) this.aircraft.push(this.frameRig.asAircraft());
    this.antiAir.update(dt, this.aircraft);
    if (this.steering && this.ctx.input.pressed('aim')) {
      this.steering.release();
      this.lowerDevice();
    }

    this.frameRig?.update(this.ctx.time.playerDt);
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
      else if (this.held.has(id) && !this.shut) {
        if (SEATED.has(id)) {
          this.pressing = id;
          this.tapHold.press();
        } else if (id === 'frame') {
          // No mark: it lands ahead of the player, who walks to it.
          this.board(id, true);
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
    hud.feed(this.shut ? `${def.name} HELD: AIRSPACE CLOSED` : left > 0 ? `${def.name} COOLDOWN ${Math.ceil(left)}s` : `${def.name} NOT READY`, def.color);
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
    // Co-op guest: the jammer holds every player's call-ins alike. The radio men live on the host, which says so
    // (`commander:status`, mirrored by net/world/villain.ts and told again to a player who arrives).
    const coop = this.ctx.coop;
    return uplinkJammed(!!coop?.world && !coop.hosting, this.uplinkTold, (this.ctx.enemies as unknown as Uplink).outpost?.commander.callInDelay ?? 0);
  }

  /** The call is made and paid for, and it goes the moment the jammer stops or the patience runs out. */
  private hold(id: CallInId, ai = false): void {
    const { audio, hud } = this.ctx;
    this.calling = true;
    this.heldCall.id = id;
    this.heldCall.ai = ai;
    this.heldCall.age = 0;
    this.heldCall.point.copy(this.mark.point);
    this.heldCall.heading.copy(this.mark.heading);
    audio.play('callin_denied');
    hud.feed(`${CALLINS[id].name} HELD: UPLINK JAMMED`, CALLINS[id].color);
  }

  private waitOnUplink(dt: number): void {
    const call = this.heldCall;
    call.age += dt;
    if (this.uplinkDown && call.age < UPLINK_PATIENCE) return;
    if (this.steering || this.seats.occupied || !this.ctx.player.alive) return;
    this.calling = false;
    this.mark.point.copy(call.point);
    this.mark.heading.copy(call.heading);
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
    this.ctx.events.emit('callin:used', { id, position: this.mark.point });
  }

  /** The Commander's MANPADS, on the newest of this kind. An aircraft crashes, with the player thrown out of its seat. Anything else is simply gone. */
  shootDown(id: CallInId): boolean {
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const strike = this.strikes[i]!;
      if (this.flying.get(strike) !== id) continue;
      if (isAircraft(strike)) {
        strike.down();
        return true;
      }
      // Not an aircraft: it is simply gone, here and (co-op) on every screen flying a copy of it.
      const n = this.told.get(strike);
      if (n !== undefined) this.sender?.news({ n, k: 'down' });
      strike.dispose();
      this.strikes.splice(i, 1);
      this.flying.delete(strike);
      this.retire(strike);
      return true;
    }
    return false;
  }

  /**
   * An aircraft, flown (`ai` false) or sent in with its crew. Paid for here, whether or not a jammer holds it up. `over` is where it
   * works (a mission's sortie); otherwise where the crosshair falls, or the player's feet.
   */
  board(id: CallInId, ai = false, over?: THREE.Vector3): void {
    if (this.targeting.id) this.targeting.exit();
    this.held.delete(id);
    this.cooldowns[id] = CALLINS[id].cooldown;
    if (over) this.mark.point.copy(over);
    else if (!this.targeting.solve(this.mark.point)) this.mark.point.copy(this.ctx.player.position);
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
    if (ai) hud.feed(`${CALLINS[id].name} ${id === 'frame' ? 'INBOUND' : 'SENT IN'}`, CALLINS[id].color);
    else this.holster();
    const strike = this.launch(id, ai);
    this.strikes.push(strike);
    this.flying.set(strike, id);
    events.emit('callin:used', { id, position: id === 'ac130' ? this.mark.point : player.position });
  }

  /**
   * For the co-op proofs (tools/scripts/coop-callins-matrix.mjs) and the dev panel, and absent from the public site
   * (`proofPage`): this call-in now, on `point`, with no key pressed, nothing spent and no jammer asked. `heading` is the
   * Warthog's run on the ground; `ai` sends an aircraft in with its crew instead of seating the player.
   */
  readonly callAt: ((id: CallInId, point: THREE.Vector3, heading?: THREE.Vector3, ai?: boolean) => void) | undefined = !PROOF_PAGE ? undefined
    : (id, point, heading, ai = true) => {
      this.mark.point.copy(point);
      if (heading) this.mark.heading.copy(heading).setY(0).normalize();
      if (SEATED.has(id) || id === 'frame') this.takeOff(id, ai);
      else this.fly(id);
    };

  /** The player's own running strikes, newest last, for the proofs: nothing on the public site. */
  get running(): readonly Strike[] {
    return PROOF_PAGE ? this.strikes : NO_STRIKES;
  }

  /** Onto a mission's ride in the Packmule: a fixed flight, or its circle first (`Flight.loiter`). Nothing on the ground can hold this one up. */
  boardFlight(flight: Flight): void {
    const { audio, weapons } = this.ctx;
    if (this.targeting.id) this.targeting.exit();
    audio.play('callin_confirm');
    if (!this.holstered) {
      this.holstered = true;
      weapons.setHolstered(true);
    }
    const strike = new DoorGunner(this.kit, this.seats, this.packmule, flight, false, this.antiAir);
    this.strikes.push(strike);
    this.flying.set(strike, 'doorGunner');
  }

  /** The Packmule on a mission's fixed flight with its own crew and nobody in the seat: a courier crossing. `down()` brings it down. */
  flyFlight(flight: Flight): { down(): void; readonly position: THREE.Vector3 } {
    // Co-op: the others see it cross too, as a copy that follows this one's pose (a mission's courier is the host's alone to fly).
    const strike = new DoorGunner(this.kit, this.seats, this.packmule, flight, true, null, this.net());
    this.strikes.push(strike);
    this.flying.set(strike, 'doorGunner');
    this.announce(strike, 'doorGunner', true, strike.position, 0);
    return strike;
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
    this.mark.point.copy(this.targeting.point);
    this.mark.heading.copy(this.targeting.heading);
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
    const order = this.mark;
    // Co-op: a fresh seed for every call, which the others get with the order, so their copies roll the same scatter. Alone
    // there is no seed and no draw for one: the strike rolls from `Math.random`, as it did before co-op.
    order.seed = this.sender ? Math.floor(Math.random() * 0x100000000) : undefined;
    order.yaw = undefined;
    const net = this.net();
    const strike = this.build(id, ai, net);
    const yaw = strike instanceof Ac130 ? strike.angle : strike instanceof FrameDrop ? strike.yaw : Math.atan2(order.heading.z, order.heading.x);
    this.announce(strike, id, ai, strike instanceof FrameDrop ? strike.feet : order.point, yaw);
    return strike;
  }

  private build(id: CallInId, ai: boolean, net: StrikeNet): Strike {
    switch (id) {
      case 'airstrike': return new Airstrike(this.kit, this.mark);
      case 'warthog': return new Warthog(this.kit, this.mark);
      case 'doorGunner': return new DoorGunner(this.kit, this.seats, this.packmule, null, ai, null, net);
      case 'attackChopper': return new AttackChopper(this.kit, this.seats, this.harrow, ai, net);
      case 'orbital': return new Orbital(this.kit, this.mark, this.targeting, net);
      case 'ac130': return new Ac130(this.kit, this.mark, this.gunship, this.seats, ai, net);
      case 'blackSun': return new BlackSun(this.kit, this.mark);
      case 'nuke': return new Nuke(this.kit, this.mark, this.aftermath);
      case 'sentry': return new Sentry(this.kit, this.mark, this.sentryRig, this.antiAir);
      case 'frame': return new FrameDrop(this.kit, this.frame);
    }
  }

  /** Co-op: out of whatever seat the player is in, now (a mission's ride ended on the host). */
  leaveSeat(): void {
    this.seats.eject();
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
    this.shut = false;
    this.frameRig?.clear();
    this.emplacements.clear();
    if (this.targeting.id) this.targeting.exit();
    this.steering = null;
    for (const strike of this.strikes) {
      strike.dispose();
      this.retire(strike);
    }
    this.strikes.length = 0;
    this.flying.clear();
    this.mirror.clear();
    this.antiAir.clear();
    this.aircraft.length = 0;
    this.tapHold.cancel();
    this.calling = false;
    this.kit.ordnance.clear();
    this.aftermath.clear();
    this.held.clear();
    for (const id of CALLIN_ORDER) this.cooldowns[id] = 0;
    if (this.holstered) this.drawGun();
  }
}
