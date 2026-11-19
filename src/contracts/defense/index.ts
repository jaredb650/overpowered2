/**
 * Outpost Defense at run time (docs/proposals/outpost-defense.md, piece 5): the credits, the loadout at the start, the three
 * shops as places to walk up to, breaks between waves, a shop's loss and rebuild. `ctx.contracts.defense` on that
 * contract, null on every other. The rules are economy.ts and the prices data.ts; this file only reads the run and
 * carries purchases out.
 *
 * The wave hook is `DefenseWaves`: whatever `ctx.waves` is, this reads `wave` and `phase`, listens to `wave:start` and
 * `wave:clear`, writes `nextWaveIn` when a break begins, and asks it for `preview` and `breakSeconds` if it has them. On the fort it
 * is the wave director (director.ts); on the Test Range stand-in, Endless Humans' own waves (enemies/index.ts).
 */
import * as THREE from 'three';
import type { Ally } from '../../allies/ally';
import type { AllyType } from '../../allies/data';
import type { Ctx, Structure } from '../../core/contracts';
import { DEV_TOOLS } from '../../core/devflags';
import type { EnemyInstance, WaveSystem, WeaponId } from '../../core/gameplay';
import type { Emplacement } from '../../vehicles/emplacement';
import { MOUNT_LEVELS } from '../../vehicles/emplacement';
import { TUNING } from '../../weapons/data';
import { FORT_BREACH_POINTS, FORT_POSTS, FORT_RALLY, FORT_SHOPS, type FortPost, type Vec } from '../../world/map/fort/plan';
import type { StructureSpec } from '../../world/structures';
import { ACTIVE } from '../select';
import {
  ECONOMY, LOADOUT_MELEE, SHOPS, SHOP_ORDER, WEAPON_PRICES, killPay, paysFor, placeholderPreview, wavePay, type ShopId,
} from './data';
import { ShopState, checkLoadout, offers, sameAct, startPosts, type Act, type Offer, type ShopView } from './economy';
import type { EnemyManager } from '../../enemies/EnemyManager';
import type { Loadout } from '../../progression/implants';
import { outward } from './field';
import { Garrison } from './garrison';
import { Keepers, type KeeperPoint } from './keepers';
import { HandRepair, REPAIR_COLOR } from './repair';
import { Shells } from './shells';
import type { Siege, SiegeWire } from './siege';
import { MortarTeams } from './teams';
import { isGuest } from '../../core/coop';

/**
 * What Outpost Defense needs from whatever runs its waves. Endless Humans' `OutpostWaves` is all of this but the optional
 * two. The wave director (piece 7) is `ctx.waves` on this contract, and adds `preview` and `breakSeconds` to steer breaks.
 */
export interface DefenseWaves extends WaveSystem {
  /** Written once as each break begins. */
  nextWaveIn: number;
  /** The break's line about the wave that is coming. */
  preview?(wave: number): string;
  /** Seconds of the break before `wave`. */
  breakSeconds?(wave: number): number;
  /** The sides of the fort the wave on now comes from (0 north, clockwise), none in a break. The allies man them. */
  readonly fronts?: readonly number[];
  /** The attackers' orders, for the men running charges (the director's). */
  readonly siege?: Siege;
}

/**
 * Co-op (net/world/fort.ts): the fort is the host's. A guest asks the host for what changes it; the host tells every guest what
 * it should see and hear. Null in a solo run.
 */
export interface DefenseLink {
  readonly guest: boolean;
  /** Guest: asks the host to carry out a purchase that is the fort's (`fortAct`), numbered `n`. Answered through `Defense.sold`. */
  buy(n: number, shop: ShopId, act: Act): void;
  /** Guest: asks the host to put up the stage this player has boarded up. Answered through `HandRepair.answered`. */
  repair(index: number, from: number): void;
  /** Host: a mortar round left a tube, the team's own (`mine`) or the attackers'. */
  shell(from: THREE.Vector3, to: THREE.Vector3, radius: number, flight: number, delay: number, ring: number | null, mine: boolean): void;
  /** Host: a banner, a feed line or a floating label that every guest gets too. */
  say(kind: 'banner' | 'feed' | 'float', text: string, sub: string, color: string, at?: THREE.Vector3): void;
  /** Host: the feet of every living player, this browser's first. */
  feet(out: THREE.Vector3[]): THREE.Vector3[];
  /** Host: one of the garrison's callouts on the squad feed (radio.ts). A no-op on a guest. */
  squad(text: string, speaker: string, at: THREE.Vector3): void;
  /** This browser's seat in the lobby. */
  readonly slot: number;
  /** Guest: I am on mounted gun `gun` (or off it), pointing it so, firing or not. Sent while seated. */
  seat(gun: number, on: boolean, yaw: number, pitch: number, firing: boolean): void;
}

/** The fort's facts a guest cannot see for itself, as the host sends them. */
export interface FortState extends SiegeWire {
  /** Hired men alive, up or down. */
  squad: number;
  /** Each mounted gun's level. */
  mounts: number[];
  /** The team's mortar teams posted. */
  mortars: number;
  /** Health of the barracks, the armoury and the infirmary (`SHOP_ORDER`). */
  shops: number[];
  /** The line about the wave that is coming, in a break. */
  preview: string;
  /** The uids of the men running a charge to a wall. */
  carriers: number[];
  /** Each mounted gun: [who is on it (-1 nobody, -2 one of the garrison, else a player's slot), world yaw, pitch, firing 0 or 1]. */
  guns: number[][];
}

/** Someone on another screen, on a mounted gun here (`Emplacement.remote`). */
const RIDER = { remote: true } as unknown as NonNullable<Exclude<Emplacement['occupant'], 'player'>>;
/** Seconds between a seated guest's reports of where its gun points, and how long the host keeps a seat with none. */
const SEAT_EVERY = 0.15;
const SEAT_KEEP = 2.5;

/** Purchases that change the fort itself: in co-op the host carries them out for whoever paid. */
const FORT_ACTS: ReadonlySet<Act['kind']> = new Set<Act['kind']>(['ally', 'mortar', 'mount', 'repair', 'rebuild']);
export const fortAct = (act: Act): boolean => FORT_ACTS.has(act.kind);
/** Seconds a guest waits for the host's word on a purchase before the price comes back. */
const ASK_SECONDS = 6;
const FEED_COLOR = '#ffc14a';

/** Where a shop stands. The fort map exports these; until it does, the Test Range's stand in. */
export interface ShopAnchor {
  position: THREE.Vector3;
  /** Which way the counter faces, as a camera's yaw. */
  yaw: number;
}

export interface ShopAnchors {
  barracks: ShopAnchor;
  armoury: ShopAnchor;
  infirmary: ShopAnchor;
  /** Where a new hire takes his post. */
  rally: THREE.Vector3;
}

const anchor = (x: number, z: number, yaw: number): ShopAnchor => ({ position: new THREE.Vector3(x, 0, z), yaw });

/** The Test Range: behind the spawn, clear of the gallery and the guns. `?contract=defense&map=range` still plays here. */
export const RANGE_ANCHORS: ShopAnchors = {
  barracks: anchor(-16, 21, 0),
  armoury: anchor(-8, 23, 0),
  infirmary: anchor(0, 24, 0),
  rally: new THREE.Vector3(0, 0, 4),
};

/** The fort's shops (`FORT_SHOPS`). The fort's yaw is the buyer's facing; the counter faces back at him, so ours is that plus π. */
const fortShop = (id: ShopId): ShopAnchor => {
  const s = FORT_SHOPS.find(x => x.id === id)!;
  return { position: new THREE.Vector3(...s.anchor), yaw: s.yaw + Math.PI };
};

export const FORT_ANCHORS: ShopAnchors = {
  barracks: fortShop('barracks'),
  armoury: fortShop('armoury'),
  infirmary: fortShop('infirmary'),
  rally: new THREE.Vector3(...FORT_RALLY),
};

const ON_FORT = ACTIVE.map === 'fort';

/**
 * Where each shopkeeper stands: the fort's `keeper` point once the map exports one, else behind the counter (on the fort 2 m past the
 * buyer's spot, the counter between; on the Test Range just behind the box), facing the buyer.
 */
function keeperAt(id: ShopId, at: ShopAnchor): KeeperPoint {
  const shop = ON_FORT ? (FORT_SHOPS.find(x => x.id === id) as { keeper?: Vec | { pos: Vec } } | undefined) : undefined;
  if (shop?.keeper) {
    const [x, y, z] = 'pos' in shop.keeper ? shop.keeper.pos : shop.keeper;
    return { pos: new THREE.Vector3(x, y, z), yaw: Math.atan2(at.position.x - x, at.position.z - z) };
  }
  // The counter faces the buyer along `at.yaw` (a camera's: -sin, -cos); the keeper is behind it, facing that way.
  const fx = -Math.sin(at.yaw), fz = -Math.cos(at.yaw);
  const back = ON_FORT ? 2.05 : 0.9;
  return { pos: new THREE.Vector3(at.position.x - fx * back, at.position.y, at.position.z - fz * back), yaw: Math.atan2(fx, fz) };
}

/** A machine gunner's posts: the mounted guns first, the nearest the barracks first, then the rest in the map's order. */
const gunFirst = (p: FortPost): number => (p.gun === undefined ? 1000 : Math.hypot(p.pos[0] - FORT_RALLY[0], p.pos[2] - FORT_RALLY[2]));

/** Satchel carriers and bombers: a pulsing red outline and a blinking light over the head, and red on the minimap. */
const CARRIER_RED = 0xff2a12;

declare module '../../core/contracts' {
  interface GameEvents {
    /** The HUD puts up the loadout or a shop's menu, and pauses the run under it. */
    'defense:open': { screen: 'loadout' | ShopId };
  }
}

declare module '../../core/gameplay' {
  interface ContractSystem {
    /** Outpost Defense's economy. Null on any other contract. */
    readonly defense?: Defense | null;
  }
}

/** Metres from a counter at which E opens it. */
const REACH = 2.6;
const SIGN_HEIGHT = 2.3;
const LOST_COLOR = '#ff3a2a';

interface Kiosk {
  id: ShopId;
  root: THREE.Group;
  sign: THREE.MeshBasicMaterial;
  label: THREE.Vector3;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const BEACON_SHAPE = new THREE.OctahedronGeometry(0.13, 0);
const BEACON_GLOW = new THREE.MeshBasicMaterial({ color: new THREE.Color(CARRIER_RED).multiplyScalar(6), toneMapped: false, fog: false });

export class Defense {
  credits = 0;
  /** Credits earned this run, for the report and the tests. */
  earned = 0;
  readonly shops: Record<ShopId, ShopState> = { barracks: new ShopState('barracks'), armoury: new ShopState('armoury'), infirmary: new ShopState('infirmary') };
  /** Set by a new run, cleared by `deploy`. The run waits paused on the loadout screen until then. */
  needLoadout = false;
  anchors: ShopAnchors = ON_FORT ? FORT_ANCHORS : RANGE_ANCHORS;
  /** The player's mortar teams (piece 8). Only the fort has posts for them. */
  readonly mortars: MortarTeams;
  /** Boarding up walls by hand (repair.ts). */
  readonly repair: HandRepair;
  /** Who defends what (garrison.ts). Only the fort has posts to move. */
  readonly garrison: Garrison;
  /** The uids of every enemy carrying a charge now: sappers on their way to a wall and bombers. The minimap marks them. */
  readonly carriers = new Set<number>();
  /** Co-op: set by net/world/fort.ts once the world is up. Null alone. */
  link: DefenseLink | null = null;
  /** Co-op guest: the host's latest word on the fort, purchases waiting on the host, and the host's mortar rounds as drawn here. */
  private remote: FortState | null = null;
  private readonly pending = new Map<number, { price: number; label: string; at: number }>();
  private asks = 0;
  private shells: Shells | null = null;
  private readonly feet: THREE.Vector3[] = [];
  /** Co-op host: the guests on mounted guns, by gun. Guest: the gun this player is on, and when it last said so. */
  private readonly riders = new Map<number, { slot: number; yaw: number; pitch: number; firing: boolean; at: number }>();
  private seated = -1;
  private seatAt = 0;
  private readonly aim = new THREE.Vector3();

  private kiosks: Kiosk[] = [];
  private prompted: Kiosk | null = null;
  private unprompt: (() => void) | null = null;
  private asked = false;
  /** The wave whose break has had its length set, or -1 while a wave is on. */
  private breakFor = -1;

  /** The breach the riot police are holding, if any. */
  private breach: Structure | null = null;
  private keepers: Keepers | null = null;
  /** The first worn wall of a run says how to board it up. */
  private hinted = false;
  private readonly carrierList: EnemyInstance[] = [];
  private readonly carrierMeshes: THREE.Object3D[] = [];
  private readonly beacons: THREE.Mesh[] = [];

  constructor(private readonly ctx: Ctx) {
    this.mortars = new MortarTeams(ctx, ON_FORT);
    this.repair = new HandRepair(ctx, n => this.earn(n), () => this.link);
    this.garrison = new Garrison((p, r, out) => ctx.world.nav.nearest(p, r, out));
  }

  init(): void {
    const { events } = this.ctx;
    events.on('enemy:killed', e => {
      if (paysFor(e.damage.source) && !this.ctx.coop?.world?.notMine(e.enemy)) this.earn(killPay(e.headshot));
    });
    events.on('wave:clear', e => {
      const pay = wavePay(e.wave);
      this.earn(pay);
      this.ctx.hud.feed(`+${pay} CREDITS: WAVE ${e.wave} HELD`, '#ffc14a');
      this.garrison.stand(this.ctx.allies?.allies ?? []);
    });
    events.on('wave:start', e => {
      this.garrison.fronts = [...(this.waves.fronts ?? [])];
      this.garrison.plan(this.ctx.allies?.allies ?? []);
      // Co-op guest: the director that sounds a wave in runs on the host.
      if (this.guest && ON_FORT) {
        const { audio } = this.ctx;
        if (e.wave >= 10) audio.music('hard');
        audio.play(e.wave >= 10 || e.boss ? 'wave_start_hard' : 'wave_start');
        if (e.boss) audio.play('boss_alarm');
      }
    });
    // The host's rounds leave their tubes on every screen.
    this.mortars.shells.onFire = (from, to, o, delay) => this.link?.shell(from, to, o.radius, o.flight, delay, o.ring, true);
    if (this.waves.siege) this.waves.siege.shells.onFire = (from, to, o, delay) => this.link?.shell(from, to, o.radius, o.flight, delay, o.ring, false);
    this.repair.init();
    if (this.ctx.allies) this.ctx.allies.keyTaken = () => this.repair.piece !== null;
    // The garrison and the shopkeepers wear the Bailiffs: load them while the player picks a loadout.
    void this.ctx.allies?.preload();
    this.build();
    if (DEV_TOOLS) this.debug();
  }

  /** Riot police go to a breach in the fort's walls, and back to their posts once it is repaired (allies' `markBreach`). */
  private watchBreaches(): void {
    const pieces = this.ctx.world.objects.structures;
    if (!ON_FORT || !pieces || this.watching) return;
    this.watching = true;
    for (const piece of pieces) {
      if (piece.kind === 'shack') continue;
      piece.onStageChange((stage, from) => {
        if (stage !== 'intact' && from === 'intact') this.hint();
        if (stage === 'breached') this.markBreach(piece);
        else if (this.breach === piece) this.markBreach(pieces.find(p => p.kind !== 'shack' && p.stage === 'breached') ?? null);
      });
    }
  }

  private watching = false;

  /** Co-op: this browser is a guest, so the fort it sees is the host's. */
  get guest(): boolean {
    return isGuest(this.ctx);
  }

  /** Every living player's feet: this browser's, and in co-op on the host the others' too. */
  players(): readonly THREE.Vector3[] {
    if (this.link && !this.link.guest) return this.link.feet(this.feet);
    this.feet.length = 0;
    if (this.ctx.player.alive) this.feet.push(this.ctx.player.position);
    return this.feet;
  }

  /** Once a run, as the first wall or gate wears: how to board it up. */
  private hint(): void {
    if (this.hinted) return;
    this.hinted = true;
    const key = this.ctx.input.labelFor?.('interact') ?? 'E';
    this.ctx.hud.feed(`WALL HIT: HOLD ${key} AT IT TO BOARD UP, +${ECONOMY.handPay}`, REPAIR_COLOR);
  }

  private markBreach(piece: Structure | null): void {
    const allies = this.ctx.allies;
    this.breach = piece;
    // Co-op guest: the riot line is the host's to send.
    if (!allies || this.guest) return;
    if (!piece) {
      allies.clearBreach();
      this.garrison.breach = null;
      return;
    }
    const spec = (piece as Structure & { spec: StructureSpec }).spec;
    const out = outward(spec.x, spec.z, _a);
    // The line forms in the yard behind the gap, facing out through it.
    _b.set(spec.x, 0, spec.z).addScaledVector(out, -(piece.kind === 'gate' ? 4 : 5.5));
    allies.markBreach(_b, Math.atan2(-out.x, -out.z));
    this.garrison.breach = _b.clone();
  }

  reset(): void {
    this.credits = this.earned = 0;
    for (const id of SHOP_ORDER) this.shops[id].restore();
    this.paint();
    this.needLoadout = true;
    this.asked = false;
    this.breakFor = -1;
    this.prompt(null);
    this.mortars.reset();
    this.breach = null;
    this.hinted = false;
    this.repair.reset();
    this.garrison.reset();
    this.carriers.clear();
    this.remote = null;
    this.riders.clear();
    this.seated = -1;
    this.pending.clear();
    this.shells?.reset();
    this.watchBreaches();
    // Each gun starts the run as a heavy machine gun (proposal: Mounted guns).
    for (const gun of this.mounts()) gun.upgrade(1);
  }

  /**
   * Co-op: this player is back in a match they had left (a reload, a rejoin) and the host has put their kit back
   * (net/team.ts). The restored kit wins: no loadout is asked for, and nothing replaces what they came back with.
   */
  resumed(): void {
    this.needLoadout = false;
  }

  update(): void {
    if (this.needLoadout) {
      // Co-op guest: whether this is a returning player is the host's word (their seat). The loadout waits for it, a moment.
      if (this.guest && this.ctx.coop?.world?.team.seated === false) return;
      if (!this.asked) {
        this.asked = true;
        this.ctx.events.emit('defense:open', { screen: 'loadout' });
      }
      return;
    }
    const { ctx } = this;
    const dt = ctx.time.dt;
    const guest = this.guest;
    // Co-op guest: the break is the host's to time (the snapshot carries its clock).
    if (!guest) this.hookBreak();
    this.readCounter();
    // E goes to a counter, a man in front of the player or a mounted gun before a wall.
    // Co-op: a guest boards up too; the host puts the stage up and the guest is paid (repair.ts).
    this.repair.update(dt, this.prompted !== null || Number.isFinite(ctx.allies?.focusDistance ?? Infinity) || this.gunNear());
    // Co-op: the key is the team's ready vote (net/teamBreak.ts), never one player's skip.
    if (this.inBreak && !ctx.coop?.world && ctx.input.pressed('nextWave')) this.startNow();
    if (guest) {
      // The host's teams fire; here their rounds are only drawn.
      this.mortars.shells.update();
      this.shells?.update();
      this.refunds();
    } else this.mortars.update(!this.inBreak);
    if (ON_FORT && ctx.allies) {
      if (!this.inBreak) this.garrison.watch(ctx.enemies.alive);
      this.garrison.update(ctx.time.elapsed, ctx.allies.allies);
    }
    this.markCarriers();
    this.keepers?.update(dt);
    if (this.link) this.seats();
  }

  // --- Co-op: the mounted guns' seats -----------------------------------------------------------

  /** A gun someone on another screen is on: taken here too, swung where theirs points, firing when theirs does. */
  private ride(gun: Emplacement, yaw: number, pitch: number, firing: boolean): void {
    if (!gun.occupant) gun.occupy(RIDER);
    if (gun.occupant !== RIDER) return;
    gun.remote = true;
    const flat = Math.cos(pitch);
    gun.aimAt(this.aim.set(-Math.sin(yaw) * flat, Math.sin(pitch), -Math.cos(yaw) * flat).multiplyScalar(60).add(gun.pivot));
    gun.trigger(firing);
  }

  /**
   * Co-op: one gun, one gunner, on every screen. A guest on a gun tells the host where it points; the host keeps the seat for
   * them (so neither the host nor a garrison gunner takes it) and tells everyone; every other screen shows the gun manned.
   */
  private seats(): void {
    const { link, ctx } = this;
    if (!link) return;
    const guns = this.mounts();
    const now = ctx.time.elapsed;
    if (!link.guest) {
      for (const [i, rider] of this.riders) {
        const gun = guns[i];
        if (!gun || now - rider.at > SEAT_KEEP) {
          gun?.vacate(RIDER);
          this.riders.delete(i);
        } else this.ride(gun, rider.yaw, rider.pitch, rider.firing);
      }
      return;
    }
    // This player's own seat, reported while they sit and once as they leave.
    const mine = guns.findIndex(g => g.occupant === 'player');
    if (mine !== this.seated || (mine >= 0 && now >= this.seatAt)) {
      if (this.seated >= 0 && mine !== this.seated) link.seat(this.seated, false, 0, 0, false);
      this.seated = mine;
      this.seatAt = now + SEAT_EVERY;
      if (mine >= 0) link.seat(mine, true, guns[mine]!.aimYaw, guns[mine]!.aimPitch, guns[mine]!.shooting);
    }
    // Everyone else's, as the host has them.
    const told = this.remote?.guns;
    if (!told) return;
    guns.forEach((gun, i) => {
      const row = told[i];
      const seat = row ? row[0]! : -1;
      if (gun.occupant === 'player') return;
      if (seat === -1 || seat === link.slot) gun.vacate(RIDER);
      else this.ride(gun, row![1]!, row![2]!, row![3] === 1);
    });
  }

  /**
   * Co-op host: a guest (in `slot`) says it is on gun `gun`, or off it. False when the gun is someone else's: the guest steps
   * off (`unseat`). The seat is kept while the guest goes on saying so.
   */
  seatFor(slot: number, gun: number, on: boolean, yaw: number, pitch: number, firing: boolean): boolean {
    const g = this.mounts()[gun];
    if (!g) return false;
    const rider = this.riders.get(gun);
    if (!on) {
      if (rider?.slot === slot) {
        g.vacate(RIDER);
        this.riders.delete(gun);
      }
      return true;
    }
    if (rider ? rider.slot !== slot : g.occupant !== null) return false;
    this.riders.set(gun, { slot, yaw, pitch, firing, at: this.ctx.time.elapsed });
    this.ride(g, yaw, pitch, firing);
    return true;
  }

  /** Co-op host: the player in `slot` is out of the world (their connection dropped): any gun they were on is free. */
  leftSeats(slot: number): void {
    const guns = this.mounts();
    for (const [i, rider] of this.riders) if (rider.slot === slot) {
      guns[i]?.vacate(RIDER);
      this.riders.delete(i);
    }
  }

  /** Co-op guest: the host says the gun this player stepped onto is taken. */
  unseat(gun: number): void {
    const g = this.mounts()[gun];
    if (g?.occupant !== 'player') return;
    g.clear();
    this.seated = -1;
    this.ctx.hud.feed('THAT GUN IS TAKEN', LOST_COLOR);
  }

  /** A mounted gun within a step: E is the gun's. */
  private gunNear(): boolean {
    const p = this.ctx.player.position;
    return this.mounts().some(g => Math.min(Math.hypot(p.x - g.standAt.x, p.z - g.standAt.z), Math.hypot(p.x - g.pivot.x, p.z - g.pivot.z)) < 2.2 &&
      Math.abs(p.y - g.standAt.y) < 1.5);
  }

  /** Everyone carrying a charge: outlined red, pulsing, through walls; a blinking red light over each; red on the minimap. */
  private markCarriers(): void {
    const { ctx } = this;
    const list = this.carrierList;
    list.length = 0;
    // Co-op guest: who runs a charge is the host's to say.
    const told = this.guest ? this.remote?.carriers : null;
    if (!this.guest) this.waves.siege?.sappers(list);
    for (const e of ctx.enemies.alive) if (e.alive && (e.id === 'bomber' || told?.includes(e.uid))) list.push(e);
    this.carriers.clear();
    const meshes = this.carrierMeshes;
    meshes.length = 0;
    for (const e of list) {
      this.carriers.add(e.uid);
      meshes.push(e.char.mesh);
    }
    const t = ctx.time.elapsed;
    if (meshes.length > 0) ctx.render.highlight?.(meshes, CARRIER_RED, 0.55 + 0.45 * Math.abs(Math.sin(t * 5)));
    const on = t % 0.5 < 0.25;
    const eye = ctx.player.position;
    for (let i = 0; i < Math.max(list.length, this.beacons.length); i++) {
      const e = list[i];
      if (!e) {
        this.beacons[i]!.visible = false;
        continue;
      }
      const b = this.beacons[i] ?? this.beacon();
      b.visible = on;
      b.position.set(e.position.x, e.position.y + 2.15, e.position.z);
      // Grows with distance, so it still reads as a light at the fence.
      b.scale.setScalar(Math.max(1, b.position.distanceTo(eye) / 22));
    }
  }

  private beacon(): THREE.Mesh {
    const b = new THREE.Mesh(BEACON_SHAPE, BEACON_GLOW);
    this.ctx.render.scene.add(b);
    this.beacons.push(b);
    return b;
  }

  // --- Waves -----------------------------------------------------------------------------------

  get waves(): DefenseWaves {
    return this.ctx.waves as DefenseWaves;
  }

  get inBreak(): boolean {
    return this.waves.phase === 'intermission';
  }

  /** The line under the break's countdown. */
  get preview(): string {
    const next = this.waves.wave + 1;
    if (this.guest) return this.remote?.preview || placeholderPreview(next);
    return this.waves.preview?.(next) ?? placeholderPreview(next);
  }

  /** A break's length is set once, as it begins: the director's if it has one, else the table's. */
  private hookBreak(): void {
    const w = this.waves;
    const key = w.phase === 'intermission' ? w.wave : -1;
    if (key === this.breakFor) return;
    this.breakFor = key;
    if (key < 0) return;
    w.nextWaveIn = w.breakSeconds?.(key + 1) ?? (key === 0 ? ECONOMY.firstBreak : ECONOMY.breakSeconds);
  }

  /** Ends the break now. For the lab and bots. */
  skipBreak(): void {
    if (this.inBreak) this.waves.nextWaveIn = 0;
  }

  /** The player calls the next wave in early (the `nextWave` key, L). The break's countdown goes to its last three seconds. */
  startNow(): void {
    if (!this.inBreak || this.waves.nextWaveIn <= 3) return;
    this.waves.nextWaveIn = 3;
    this.ctx.hud.feed('NEXT WAVE CALLED IN', '#ff8a3a');
  }

  // --- Credits and the loadout -----------------------------------------------------------------

  earn(amount: number): void {
    this.credits += amount;
    this.earned += amount;
  }

  /** Arms the player from the loadout screen. The budget not spent becomes credits. Returns why not, or null. */
  deploy(primary: WeaponId | null, secondary: WeaponId | null): string | null {
    const check = checkLoadout(primary, secondary);
    if (check.why) return check.why;
    this.ctx.weapons.setLoadout([primary!, secondary!, LOADOUT_MELEE], 0);
    this.credits = check.left;
    this.needLoadout = false;
    this.postGarrison();
    return null;
  }

  /**
   * The free riflemen the run starts with (`ECONOMY.startRiflemen`), already on their posts: on the fort spread round the outer
   * ring (`startPosts`), on the Test Range in a ring round the rally point, facing out. Ordinary allies from then on.
   */
  private postGarrison(): void {
    const allies = this.ctx.allies;
    // Co-op: the garrison is the host's, posted once by the host's own deployment.
    if (!allies || this.guest) return;
    const { nav } = this.ctx.world;
    const n = ECONOMY.startRiflemen;
    const posts = ON_FORT ? startPosts(n) : Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      const r = this.anchors.rally;
      // A camera's yaw looks down -z, so facing out along `a` is `a + π`.
      return { pos: [r.x + Math.sin(a) * 10, r.y, r.z + Math.cos(a) * 10] as Vec, yaw: a + Math.PI };
    });
    for (const p of posts) {
      _a.set(p.pos[0], p.pos[1] + 1, p.pos[2]);
      if (!nav.nearest(_a, ON_FORT ? 3 : 8, _a)) continue;
      const a = allies.spawn('rifleman', _a.clone(), _a.clone(), 5, p.yaw);
      if (a && ON_FORT) this.garrison.enlist(a);
    }
  }

  // --- Shops -----------------------------------------------------------------------------------

  /** The run as the rules read it, now. */
  view(): ShopView {
    const { weapons, progression } = this.ctx;
    const pieces = this.ctx.world.objects.structures ?? [];
    return {
      credits: this.credits,
      inBreak: this.inBreak,
      owned: weapons.owned,
      ammo: id => weapons.ammo(id),
      grenades: weapons.grenades,
      grenadesMax: TUNING.grenade.max,
      stims: progression.stims.count,
      stimsMax: progression.stims.max,
      squad: this.guest ? this.remote?.squad ?? 0 : this.ctx.allies?.allies.length ?? 0,
      held: progression.callIns,
      cooldown: id => progression.callInCooldown(id),
      mounts: this.mounts().map(g => ({ level: g.levelNumber, names: MOUNT_LEVELS.map(l => l.name.split(' //')[0]!) })),
      pieces,
      lost: id => this.shops[id].lost,
      mortars: this.mortars.count,
      mortarsMax: this.mortars.max,
      implants: this.loadout && {
        owned: this.loadout.owned, fitted: this.loadout.fitted, slots: this.loadout.slots, cleared: this.inBreak ? this.waves.wave : this.waves.wave - 1,
      },
    };
  }

  /** Progression's implant loadout (progression/implants.ts), which the interface does not carry. A stand-in progression has none. */
  private get loadout(): Loadout | undefined {
    return (this.ctx.progression as unknown as { loadout?: Loadout }).loadout;
  }

  offers(shop: ShopId): Offer[] {
    return offers(shop, this.view());
  }

  /** Buys `act` at `shop` if the rules allow it now. Returns why not, or null once it is done and paid for. */
  buy(shop: ShopId, act: Act): string | null {
    const offer = this.offers(shop).find(o => sameAct(o.act, act));
    if (!offer) return 'Not sold here';
    if (offer.why) return offer.why;
    if (this.link?.guest && FORT_ACTS.has(act.kind)) {
      // The fort is the host's: this player pays now, the host carries it out, and a refusal sends the price back (`sold`).
      const n = ++this.asks;
      this.pending.set(n, { price: offer.price, label: offer.label, at: this.ctx.time.elapsed });
      this.credits -= offer.price;
      this.link.buy(n, shop, act);
      this.keepers?.nod(shop);
      return null;
    }
    const failed = this.carryOut(act);
    if (failed) return failed;
    this.credits -= offer.price;
    this.keepers?.nod(shop);
    if (this.link && FORT_ACTS.has(act.kind)) this.link.say('feed', `HOST: ${this.what(act, offer.label)}`, '', FEED_COLOR);
    return null;
  }

  /** A fort purchase as the team's feed words it. */
  private what(act: Act, label: string): string {
    const name = label.toUpperCase();
    return act.kind === 'ally' || act.kind === 'mortar' ? `HIRED ${name}` : act.kind === 'repair' ? `WORK CREW TO ${name}` : act.kind === 'mount' ? `UPGRADED ${name}` : name;
  }

  /**
   * Co-op host: a guest's purchase that is the fort's, already paid for on their side. Every rule but the price is checked here,
   * where the fort is. Returns why not, or null once it is done.
   */
  buyFor(shop: ShopId, act: Act, name: string): string | null {
    if (!FORT_ACTS.has(act.kind)) return 'Not sold here';
    const offer = offers(shop, { ...this.view(), credits: Number.MAX_SAFE_INTEGER }).find(o => sameAct(o.act, act));
    if (!offer) return 'Not sold here';
    if (offer.why) return offer.why;
    const failed = this.carryOut(act);
    if (failed) return failed;
    this.keepers?.nod(shop);
    const line = `${name.toUpperCase()}: ${this.what(act, offer.label)}`;
    this.ctx.hud.feed(line, FEED_COLOR);
    this.link?.say('feed', line, '', FEED_COLOR);
    return null;
  }

  /** Co-op guest: the host's word on purchase `n`. Refused, the price comes back. */
  sold(n: number, why: string | null): void {
    const ask = this.pending.get(n);
    if (!ask) return;
    this.pending.delete(n);
    if (why === null) return;
    this.credits += ask.price;
    this.ctx.hud.feed(`${ask.label.toUpperCase()}: ${why.toUpperCase()}. ${ask.price} BACK`, LOST_COLOR);
  }

  /** Co-op guest: a purchase the host never answered (it left, or the message was refused) is refunded. */
  private refunds(): void {
    if (this.pending.size === 0) return;
    const now = this.ctx.time.elapsed;
    for (const [n, ask] of this.pending) if (now - ask.at > ASK_SECONDS) this.sold(n, 'No answer from the host');
  }

  /** Co-op host: the fort's facts for the guests (`FortState`). */
  state(): FortState {
    const siege = this.waves.siege?.wire() ?? { pads: [], covers: [], marks: [] };
    return {
      squad: this.ctx.allies?.allies.length ?? 0,
      mounts: this.mounts().map(g => g.levelNumber),
      mortars: this.mortars.count,
      shops: SHOP_ORDER.map(id => Math.round(this.shops[id].health)),
      // Only in a break: the director rolls a wave's plan when it is first asked for.
      preview: this.inBreak ? this.preview : '',
      carriers: [...this.carriers],
      guns: this.mounts().map((g, i) => {
        const r = (n: number) => Math.round(n * 100) / 100;
        const rider = this.riders.get(i);
        if (rider) return [rider.slot, r(rider.yaw), r(rider.pitch), rider.firing ? 1 : 0];
        if (!g.occupant) return [-1, 0, 0, 0];
        return [g.occupant === 'player' ? this.link?.slot ?? 0 : -2, r(g.aimYaw), r(g.aimPitch), g.shooting ? 1 : 0];
      }),
      ...siege,
    };
  }

  /** Co-op guest: the host's word on the fort. Guns, mortar tubes, shop signs and the attackers' works are made to match. */
  applyState(state: FortState): void {
    if (!this.guest) return;
    const nums = (v: unknown, max: number): number[] => (Array.isArray(v) ? v.slice(0, max).filter((x): x is number => typeof x === 'number' && Number.isFinite(x)) : []);
    const rows = (v: unknown, max: number, width: number): number[][] => (Array.isArray(v) ? v.slice(0, max).map(r => nums(r, width)).filter(r => r.length === width) : []);
    const clean: FortState = {
      squad: Number.isFinite(state.squad) ? Math.max(0, Math.min(64, Math.round(state.squad))) : 0,
      mounts: nums(state.mounts, 16), mortars: Number.isFinite(state.mortars) ? Math.max(0, Math.min(16, Math.round(state.mortars))) : 0,
      shops: nums(state.shops, 3), preview: typeof state.preview === 'string' ? state.preview.slice(0, 160) : '', carriers: nums(state.carriers, 48),
      pads: nums(state.pads, 16), covers: rows(state.covers, 24, 3), marks: rows(state.marks, 16, 3), guns: rows(state.guns, 16, 4),
    };
    this.remote = clean;
    const guns = this.mounts();
    clean.mounts.forEach((level, i) => {
      const gun = guns[i];
      if (gun && gun.levelNumber !== level && level >= 1 && level <= MOUNT_LEVELS.length) gun.upgrade(level);
    });
    this.mortars.mirror(clean.mortars);
    let repaint = false;
    SHOP_ORDER.forEach((id, i) => {
      const health = clean.shops[i];
      if (health === undefined) return;
      const shop = this.shops[id];
      const was = shop.lost;
      shop.health = Math.max(0, Math.min(shop.max, health));
      if (shop.lost !== was) repaint = true;
      if (shop.lost && this.prompted?.id === id) this.prompt(null);
    });
    if (repaint) this.paint();
    this.waves.siege?.mirror(clean);
  }

  /** Co-op guest: one of the host's mortar rounds, drawn here. The team's own burst like a rocket; the attackers' land as the host's blast. */
  shellIn(from: THREE.Vector3, to: THREE.Vector3, radius: number, flight: number, delay: number, ring: number | null, mine: boolean): void {
    if (!this.guest) return;
    if (mine) {
      this.mortars.shells.fire(from, to, { radius, damage: 0, source: 'coop', ring: null, flight }, delay);
      return;
    }
    this.shells ??= new Shells(this.ctx, () => {}, (at, r, t, c) => (this.ctx.enemies as unknown as { telegraphs?: EnemyManager['telegraphs'] }).telegraphs?.zone(at, r, t, c));
    this.shells.fire(from, to, { radius, damage: 0, source: 'coop', ring, flight }, delay);
  }

  /** Does it. Returns why it could not, before anything is paid. */
  private carryOut(act: Act): string | null {
    const { ctx } = this;
    switch (act.kind) {
      case 'weapon':
        ctx.weapons.give(act.id);
        return null;
      case 'ammo': {
        const a = ctx.weapons.ammo(act.id);
        a.reserve = Math.min(a.maxReserve, a.reserve + Math.ceil(a.maxReserve / 2));
        return null;
      }
      case 'refill':
        for (const id of ctx.weapons.owned) {
          if (WEAPON_PRICES[id]?.ammo !== 'basic') continue;
          const a = ctx.weapons.ammo(id);
          a.reserve = Math.min(a.maxReserve, a.reserve + Math.ceil(a.maxReserve / 2));
        }
        return null;
      case 'grenade':
        ctx.weapons.addGrenades(1);
        return null;
      case 'stim':
        return ctx.progression.stims.give(1) > 0 ? null : 'Full';
      case 'callin':
        ctx.progression.grantCallIn(act.id);
        return null;
      case 'mount': {
        const gun = this.mounts()[act.index];
        if (!gun) return 'No such gun';
        gun.upgrade(gun.levelNumber + 1);
        return null;
      }
      case 'repair': {
        const piece = ctx.world.objects.structures?.[act.index];
        return piece?.repair(ECONOMY.repairSeconds) ? null : 'Nothing to repair';
      }
      case 'ally':
        return this.hire(act.type);
      case 'implant': {
        // Only sold where there is a loadout (`view`).
        const l = this.loadout!;
        return l.fit(act.id, !l.fitted.has(act.id)) ? null : 'No free slot';
      }
      case 'slot':
        return this.loadout!.openSlot() ? null : 'Every slot is open';
      case 'rebuild':
        this.shops[act.shop].restore();
        this.paint();
        ctx.hud.banner(`${SHOPS[act.shop].name.toUpperCase()} REBUILT`, '', SHOPS[act.shop].color);
        this.link?.say('banner', `${SHOPS[act.shop].name.toUpperCase()} REBUILT`, '', SHOPS[act.shop].color);
        return null;
      case 'mortar':
        return this.mortars.add();
    }
  }

  /**
   * A new man at the barracks. On the fort he gathers at the rally point and walks to the first free post of his type (`FORT_POSTS`,
   * riot police at `FORT_BREACH_POINTS`), outer ring first. Elsewhere he holds his own patch of the rally point.
   */
  private hire(type: AllyType): string | null {
    const allies = this.ctx.allies;
    if (!allies) return 'No troops on this page';
    const { nav } = this.ctx.world;
    const n = allies.allies.length;
    if (ON_FORT) {
      _a.set(FORT_RALLY[0] + ((n % 3) - 1) * 1.5, 1, FORT_RALLY[2]);
      if (!nav.nearest(_a, 6, _a)) return 'No room at the barracks';
      const post = this.postFor(type);
      if (post) {
        _b.set(post.pos[0], post.pos[1] + 1, post.pos[2]);
        if (!nav.nearest(_b, 3, _b)) _b.copy(_a);
      } else _b.copy(_a);
      const radius = type === 'riot' || type === 'gunner' || type === 'sniper' ? 2 : type === 'shotgunner' ? 4 : 5;
      const a = allies.spawn(type, _a.clone(), _b.clone(), radius, post?.yaw ?? Number.NaN);
      if (!a) return 'No room for him';
      this.enlist(a, post);
      return null;
    }
    const from = this.anchors.barracks.position;
    _a.set(from.x, from.y + 1, from.z - 2);
    if (!nav.nearest(_a, 8, _a)) return 'No room at the barracks';
    const rally = this.anchors.rally;
    _b.set(rally.x + ((n % 5) - 2) * 3.5, rally.y + 1, rally.z - Math.floor(n / 5) * 3);
    if (!nav.nearest(_b, 8, _b)) _b.copy(_a);
    return allies.spawn(type, _a.clone(), _b.clone()) ? null : 'No room for him';
  }

  /** On the garrison's roll, and on the gun at his post if it has one. */
  private enlist(a: Ally, post: { gun?: number } | null): void {
    this.garrison.enlist(a, post?.gun === undefined ? null : this.mounts()[post.gun] ?? null);
  }

  /** The first post of his type nobody alive holds, outer ring first; for a machine gunner the mounted guns first. Medics share theirs. */
  private postFor(type: AllyType): { pos: Vec; yaw: number; gun?: number } | null {
    const list: { pos: Vec; yaw: number; gun?: number }[] = type === 'riot'
      ? FORT_BREACH_POINTS.map(b => ({ pos: b.pos, yaw: Math.atan2(-b.pos[0], -b.pos[2]) }))
      : FORT_POSTS.filter(p => p.type === type).sort((a: FortPost, b: FortPost) => gunFirst(a) - gunFirst(b));
    const held = this.ctx.allies?.allies ?? [];
    return list.find(p => !held.some(a => Math.hypot(a.post.x - p.pos[0], a.post.z - p.pos[2]) < 1.5)) ?? list[0] ?? null;
  }

  /**
   * Hurts a shop. Nothing calls this yet but the lab: a later agent wires attackers in its ring to it (Q1). A lost shop sells
   * nothing until it is rebuilt in a break (Q7).
   */
  damageShop(id: ShopId, amount: number): void {
    if (!this.shops[id].damage(amount)) return;
    this.paint();
    if (this.prompted?.id === id) this.prompt(null);
    this.ctx.hud.banner(`${SHOPS[id].name.toUpperCase()} LOST`, 'rebuild it in a break', LOST_COLOR);
    this.link?.say('banner', `${SHOPS[id].name.toUpperCase()} LOST`, 'rebuild it in a break', LOST_COLOR);
  }

  /** The guns on the walls. They hang off the call-in manager, which has no public way to them; the lab reads them the same way. */
  private mounts(): Emplacement[] {
    const p = this.ctx.progression as unknown as { callInsManager?: { emplacements?: { all: Emplacement[] } } };
    return p.callInsManager?.emplacements?.all ?? [];
  }

  // --- The counters in the world -----------------------------------------------------------------

  /** A steel counter and a lit sign at each anchor. On the fort the buildings have counters, so only the sign goes up. */
  private build(): void {
    const { render } = this.ctx;
    if (!render?.scene) return;
    const steel = render.materials.world('steelDark');
    const base = new THREE.BoxGeometry(1.6, 1.05, 0.8);
    const post = new THREE.BoxGeometry(0.12, SIGN_HEIGHT, 0.12);
    const board = new THREE.BoxGeometry(1.5, 0.42, 0.06);
    for (const id of SHOP_ORDER) {
      const at = this.anchors[id];
      const root = new THREE.Group();
      root.position.copy(at.position);
      root.rotation.y = at.yaw;
      const sign = new THREE.MeshBasicMaterial({ color: SHOPS[id].color });
      const plate = new THREE.Mesh(board, sign);
      if (ON_FORT) {
        // The fort's building has the counter, 1.3 m in front of where the buyer stands. Only the lit board goes up, over it.
        plate.position.set(0, SIGN_HEIGHT + 0.3, 1.3);
        root.add(plate);
      } else {
        const counter = new THREE.Mesh(base, steel);
        counter.position.y = 0.525;
        const pole = new THREE.Mesh(post, steel);
        pole.position.set(0.7, SIGN_HEIGHT / 2, 0);
        plate.position.set(0, SIGN_HEIGHT, 0);
        root.add(counter, pole, plate);
      }
      render.scene.add(root);
      this.kiosks.push({ id, root, sign, label: at.position.clone().setY(at.position.y + SIGN_HEIGHT + 0.5) });
    }
    this.keepers = new Keepers(this.ctx, SHOP_ORDER.map(id => ({ id, at: keeperAt(id, this.anchors[id]) })));
  }

  /** Signs go red while their shop is lost. */
  private paint(): void {
    for (const k of this.kiosks) k.sign.color.set(this.shops[k.id].lost ? LOST_COLOR : SHOPS[k.id].color);
  }

  /** E at a counter opens its menu. An ally the player is looking at keeps E, as a mounted gun lets him. */
  private readCounter(): void {
    const { input, player } = this.ctx;
    const ally = Number.isFinite(this.ctx.allies?.focusDistance ?? Infinity);
    let near: Kiosk | null = null;
    if (player.alive && !player.parked && !ally) {
      let best = REACH;
      for (const k of this.kiosks) {
        const p = k.root.position;
        const d = Math.hypot(player.position.x - p.x, player.position.z - p.z);
        if (d < best && Math.abs(player.position.y - p.y) < 1.5) {
          best = d;
          near = k;
        }
      }
    }
    this.prompt(near);
    if (near && input.pressed('interact')) {
      this.prompt(null);
      this.ctx.events.emit('defense:open', { screen: near.id });
    }
  }

  private prompt(k: Kiosk | null): void {
    if (k === this.prompted) return;
    this.unprompt?.();
    this.unprompt = null;
    this.prompted = k;
    if (!k) return;
    const key = this.ctx.input.labelFor?.('interact') ?? 'E';
    const lost = this.shops[k.id].lost;
    this.unprompt = this.ctx.hud.follow(k.label, `${key} ${lost ? 'REBUILD ' : ''}${SHOPS[k.id].name.toUpperCase()}`, lost ? LOST_COLOR : SHOPS[k.id].color);
  }

  // --- Dev ---------------------------------------------------------------------------------------

  /** `window.__defense` for bots, and a DEFENSE section on the lab's panel. */
  private debug(): void {
    (window as unknown as { __defense: Defense }).__defense = this;
    this.ctx.events.on('run:start', () => setTimeout(() => this.panel(), 300));
  }

  private panel(): void {
    const host = document.querySelector('.lab-panel');
    if (!host || host.querySelector('.lab-defense')) return;
    const section = document.createElement('div');
    section.className = 'lab-defense';
    const h = document.createElement('h2');
    h.textContent = 'DEFENSE';
    const row = document.createElement('div');
    row.className = 'lab-row';
    const button = (label: string, run: () => void): void => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', run);
      row.appendChild(b);
    };
    button('+1000 credits', () => this.earn(1000));
    button('Skip break', () => this.skipBreak());
    for (const id of SHOP_ORDER) button(`Hit ${SHOPS[id].name} 500`, () => this.damageShop(id, 500));
    section.append(h, row);
    for (const type of ['mousedown', 'wheel', 'keydown'] as const) section.addEventListener(type, e => e.stopPropagation());
    host.insertBefore(section, host.querySelector('.lab-keys'));
  }
}

/** Only on a contract with an economy. */
export const createDefense = (ctx: Ctx): Defense | null => (ACTIVE.def.economy ? new Defense(ctx) : null);

