/**
 * The mission's hands in the real game. Every method here is the plainest thing that works with what the game has today, and any of
 * them can be replaced with `campaign.provide`, as `vehicle` is by the system that has the vehicles.
 */
import { CHIPS, type ChipId, type ChipRack } from '../contracts/chips';
import * as THREE from 'three';
import type { Ally, AllyType } from '../allies';
import type { Ctx, GameEvents, MusicState } from '../core/contracts';
import type { CallInId, EnemyId, EnemyInstance, ModId, PickupKind, WeaponId } from '../core/gameplay';
import type { AdaptationId } from '../enemies/commander/adaptations';
import type { Rank } from '../enemies/outpost/rank';
import type { Line } from '../enemies/commander/lines';
import type { Enemy } from '../enemies/Enemy';
import type { EnemyManager } from '../enemies/EnemyManager';
import { MAX_HOSTILE } from '../enemies/outpost/doctrine';
import type { ActionId } from '../enemies/outpost/planner';
import type { OutpostSquad } from '../enemies/outpost/squad';
import type { Emplacement } from '../vehicles/emplacement';
import { Courier } from './courier';
import { CutscenePlayer } from './cutscene';
import { Doors } from './doors';
import type { CampaignHud } from './hud';
import { Racks } from './racks';
import { WEAPONS } from '../weapons/data';
import type { MissionRunner } from './runner';
import type { BattleOrder, Beat, Callout, Cutscene, DoorDef, FrameAct, Loadout, Mark, MissionHost, ObjectiveState, SquadOrder, SquadOrders } from './types';
import { War } from './war';

/** Seconds between men coming on, the same walk-in the waves use. */
const MAN_GAP = 0.55;
/** A squad spreads over this much ground when it arrives, so nobody spawns inside anybody. */
const SPREAD = 1.6;
const SPAWN_SEARCH = 4;
const INTERMISSION = 8;
/** Share of the score the Council keeps for each replacement. */
const REDEPLOY_FEE = 0.1;
const MARKER_COLOR = '#ffc14a';
/** Seconds the picture takes to go, and to come back once the player is out of the dark room. */
const LIGHTS_OUT = 0.12;
const LIGHTS_BACK = 1.4;
/** Seconds of black after the Packmule goes in. */
const CRASH_SECONDS = 2.4;
/** How long a squad is held to a drill it was told to run. */
const DRILL_SECONDS = 14;
const DEPLOY_GRACE = 2.5;
/** Spots across a pane that go at once, so a wide one comes down as a sheet rather than as one hole. */
const PANE_BURSTS = 5;
/** A sniper's round into one of the player's own men (`wound`, `lose`): from this high over a mark, and what it does. */
const SNIPED = { height: 3.5, wound: 1, kill: 3 } as const;
/** Towards the player, who is on the Stack's side of it. */
const THROUGH_GLASS = new THREE.Vector3(0, 0, 1);

const _v = new THREE.Vector3();

interface Arrival {
  tag: string;
  men: readonly EnemyId[];
  at: THREE.Vector3;
  seat: number;
  orders: SquadOrders;
  light: boolean;
}

export class GameHost implements MissionHost {
  readonly doors: Doors;
  readonly racks: Racks;
  readonly film: CutscenePlayer;
  readonly war: War;
  readonly courier: Courier;
  runner!: MissionRunner;

  private readonly tagOf = new Map<number, string>();
  private readonly arrivals: Arrival[] = [];
  private readonly held = new Map<string, OutpostSquad[]>();
  private readonly markers = new Map<string, { at: Mark; off: () => void }>();
  private arrivalClock = 0;
  /** Tag for the next body to appear. */
  private tagging: string | null = null;
  private bossTag: string | null = null;
  private rideDone: (() => void) | null = null;
  /** Where a circling ride's missile comes from, once `comeAbout` has been called. Null keeps it circling. */
  private launcher: THREE.Vector3 | null = null;
  private level = 1;
  /** The player's Bailiffs, and each battle's. A man leaves these lists as he dies, before the pool can hand him out again. */
  readonly squadMen: Ally[] = [];
  private readonly battles = new Map<string, Ally[]>();

  constructor(private readonly ctx: Ctx, private readonly ui: CampaignHud, calls: readonly Callout[] = [], fronts: Readonly<Record<string, { name: string; place: string }>> = {}) {
    this.doors = new Doors(ctx);
    this.racks = new Racks(ctx);
    this.film = new CutscenePlayer(ctx, ui);
    this.war = new War(ctx, {
      tagOf: uid => this.tagOf.get(uid),
      squadMen: this.squadMen,
      release: tag => this.release(tag),
      signal: name => this.runner.signal(name),
      // Read each time: co-op replaces both (net/mission.ts).
      cue: (name, ...args) => this.cue(name, ...args),
      crowd: () => this.crowd?.(),
    }, calls, fronts);
    this.courier = new Courier(ctx, name => this.runner.signal(name));
    const { events } = ctx;
    events.on('enemy:spawned', e => {
      if (this.tagging) this.tagOf.set(e.enemy.uid, this.tagging);
    });
    events.on('enemy:killed', e => this.gone(e.enemy, true, e.damage.source));
    events.on('enemy:surrendered', e => this.gone(e.enemy, false, ''));
    events.on('enemy:escaped', e => this.gone(e.enemy, false, ''));
    events.on('enemy:hit', e => {
      if (this.runner?.mission.stealth) return;
      const tag = this.tagOf.get(e.enemy.uid);
      if (tag) this.release(tag);
    });
    events.on('ally:dead', e => {
      for (const list of [this.squadMen, ...this.battles.values()]) {
        const i = list.indexOf(e.ally);
        if (i >= 0) list.splice(i, 1);
      }
    });
    events.on('commander:person', e => {
      const body = this.manager.outpost?.commander.person.body;
      if (e.arrived && body && this.bossTag) this.tagOf.set(body.uid, this.bossTag);
    });
  }

  private get manager(): EnemyManager {
    return this.ctx.enemies as EnemyManager;
  }

  enlist(e: EnemyInstance, tag: string): void {
    this.tagOf.set(e.uid, tag);
  }

  private gone(e: EnemyInstance, killed: boolean, source: string): void {
    const tag = this.tagOf.get(e.uid);
    if (tag === undefined) {
      if (killed) this.runner.noteKill(null, source);
      return;
    }
    this.tagOf.delete(e.uid);
    this.runner.unitGone(tag, killed, source);
  }

  playerAt(out: { x: number; y: number; z: number }): void {
    const { position } = this.ctx.player;
    out.x = position.x;
    out.y = position.y;
    out.z = position.z;
  }

  listen(name: keyof GameEvents, fn: (payload: unknown) => void): () => void {
    return this.ctx.events.on(name, fn);
  }

  speak(line: Line, done: () => void): void {
    this.ui.speak(line, done);
  }

  hush(): void {
    this.ui.hush();
  }

  objectives(list: readonly ObjectiveState[]): void {
    this.ui.objectives(list);
    const { hud } = this.ctx;
    for (const [id, marker] of this.markers) {
      if (list.some(o => o.id === id && !o.done && o.at === marker.at)) continue;
      marker.off();
      this.markers.delete(id);
    }
    for (const o of list) {
      if (o.done || !o.at || this.markers.has(o.id)) continue;
      this.markers.set(o.id, { at: o.at, off: hud.marker(_v.set(...o.at.at).clone(), '', MARKER_COLOR) });
    }
  }

  hint(text: string, seconds: number): void {
    this.ui.hint(text, seconds);
  }

  banner(text: string, sub?: string): void {
    this.ctx.hud.banner(text, sub);
  }

  door(id: string, def: DoorDef, open: number, seconds: number, done: () => void): void {
    this.doors.set(id, def, open, seconds, done);
  }

  squad(order: SquadOrder, at: Mark): void {
    this.arrivals.push({ tag: order.tag, men: order.men, at: new THREE.Vector3(...at.at), seat: 0, orders: order.orders ?? 'hunt', light: order.light === true });
  }

  release(tag: string): void {
    const squads = this.held.get(tag);
    if (!squads) return;
    for (const squad of squads) squad.stopLying();
    this.held.delete(tag);
  }

  sweep(tag?: string): void {
    for (let n = this.arrivals.length - 1; n >= 0; n--) {
      const a = this.arrivals[n]!;
      if (tag !== undefined && a.tag !== tag) continue;
      for (let i = a.seat; i < a.men.length; i++) this.runner.unitGone(a.tag, false, '');
      this.arrivals.splice(n, 1);
    }
    const { events } = this.ctx;
    const { manager } = this;
    for (const e of [...manager.alive]) {
      if (tag !== undefined && this.tagOf.get(e.uid) !== tag) continue;
      events.emit('enemy:escaped', { enemy: e });
      manager.withdraw(e as Enemy);
    }
    if (tag === undefined) events.emit('campaign:sweep', {});
  }

  drill(tag: string, drill: ActionId): boolean {
    const o = this.manager.outpost;
    if (!o) return false;
    this.release(tag);
    let obeyed = false;
    const asked = new Set<OutpostSquad>();
    for (const e of this.manager.alive) {
      if (this.tagOf.get(e.uid) !== tag) continue;
      const squad = o.soldierOf(e)?.squad;
      if (!squad || asked.has(squad)) continue;
      asked.add(squad);
      if (squad.obey(drill, DRILL_SECONDS)) obeyed = true;
    }
    return obeyed;
  }

  place(at: Mark): void {
    this.ctx.player.teleport(_v.set(...at.at), at.yaw);
  }

  private spawnNext(dt: number): void {
    const head = this.arrivals[0];
    if (!head) return;
    this.arrivalClock -= dt;
    if (this.arrivalClock > 0) return;
    const o = this.manager.outpost;
    if (head.seat === 0 && o) {
      // The same rule as the waves: the rest wait outside the wire until there is room in the fight.
      if (o.hostile + head.men.length > MAX_HOSTILE) return;
      o.formSquad(head.men.length, head.at);
      if (head.orders !== 'hunt') {
        const squad = o.squads[o.squads.length - 1]!;
        squad.lieStill(head.orders === 'ambush');
        const list = this.held.get(head.tag);
        if (list) list.push(squad);
        else this.held.set(head.tag, [squad]);
      }
    }
    const angle = head.seat * 2.4;
    const reach = head.seat === 0 ? 0 : SPREAD * Math.sqrt(head.seat);
    _v.set(head.at.x + Math.cos(angle) * reach, head.at.y, head.at.z + Math.sin(angle) * reach);
    if (!this.ctx.world.nav.nearest(_v, SPAWN_SEARCH, _v)) _v.copy(head.at);
    this.tagging = head.tag;
    const body = this.ctx.enemies.spawn(head.men[head.seat]!, _v);
    this.tagging = null;
    // The pool is full. This man does not exist, and must not hold the mission open.
    if (!body) this.runner.unitGone(head.tag, false, '');
    else if (head.light) this.strip(body as Enemy);
    head.seat++;
    this.arrivalClock = MAN_GAP;
    if (head.seat >= head.men.length) this.arrivals.shift();
  }

  /** The pool keeps a man's plates on his body, so they have to be hidden as well as taken off the books. */
  private strip(e: Enemy): void {
    for (const plate of e.plates) plate.mesh.visible = false;
    e.plates = [];
    e.armor = 0;
  }

  /** `VehicleSystem` provides this on every page with a mission. */
  vehicle(): void {}

  boss(tag: string, at: Mark): void {
    this.bossTag = tag;
    this.manager.outpost?.commander.person.stage(new THREE.Vector3(...at.at));
  }

  health(tag: string): number {
    for (const e of this.ctx.enemies.alive) if (this.tagOf.get(e.uid) === tag) return e.health / e.maxHealth;
    return 1;
  }

  rounds(weapon: WeaponId): number {
    const { weapons } = this.ctx;
    if (!weapons.owned.has(weapon)) return Infinity;
    const { mag, reserve } = weapons.ammo(weapon);
    return mag + reserve;
  }

  give(weapon: WeaponId): void {
    this.ctx.weapons.give(weapon);
    this.ctx.weapons.switchTo(weapon);
  }

  grenades(count: number): void {
    this.ctx.weapons.addGrenades(count);
  }

  rack(weapon: WeaponId, at: Mark, took: () => void, mods?: readonly ModId[], label?: string): void {
    this.racks.add(weapon, at, took, mods, label);
  }

  drop(item: PickupKind, at: Mark): void {
    if (item === 'weaponCache') this.ctx.progression.spawnPickup(item, _v.set(...at.at));
    else this.ctx.progression.placePickup(item, _v.set(...at.at));
  }

  /** `from`: seconds into it, for a co-op player who arrives while it runs. */
  cutscene(_id: string, scene: Cutscene, done: (skipped: boolean) => void, from = 0): void {
    this.film.play(scene, skipped => {
      this.cue('filmEnd', skipped);
      done(skipped);
    }, from);
  }

  /**
   * A route is flown as written, and calls its marks as `ride:<mark>`. `circle` circles over the fight first, until `comeAbout`. With no
   * route it is the ordinary call-in, circling for its time.
   */
  ride(seat: CallInId, route: readonly Mark[], done: () => void, circle = false): void {
    this.rideDone = done;
    this.launcher = null;
    this.riding = true;
    if (route.length < 2 || seat !== 'doorGunner') {
      this.ctx.progression.boardCallIn(seat);
      return;
    }
    const names = new Map(Object.entries(this.runner.mission.marks).map(([name, mark]) => [mark, name]));
    this.ctx.progression.boardFlight({
      marks: route.map(m => ({ x: m.at[0], y: m.at[1], z: m.at[2], hold: m.hold ?? 0, name: names.get(m) ?? '', hit: m.hit ?? false })),
      reached: name => this.runner.signal(`ride:${name}`),
      loiter: circle ? () => this.launcher : undefined,
    });
  }

  /** The gunship's circle is centred on the mark itself (`boardCallIn` with a point), not on wherever the crosshair falls from it. */
  sortie(over: Mark, done: () => void): void {
    this.place(over);
    this.rideDone = done;
    this.riding = true;
    this.ctx.progression.boardCallIn('ac130', _v.set(...over.at));
  }

  /** The Frame is stage 3's (src/frame), which provides this. Until it lands, a banner says what would happen and the beat goes on. */
  frame(act: FrameAct, at: Mark, done: () => void): void {
    if (act === 'eject') this.place(at);
    this.ctx.hud.banner('DISTRAINT FRAME', `Stand-in: ${act}`);
    this.cue('frame', act);
    done();
  }

  roster(men: readonly AllyType[], at: Mark | null): void {
    const allies = this.ctx.allies;
    if (!allies) return;
    while (this.squadMen.length > men.length) this.dismiss(this.squadMen.pop()!);
    const missing = men.slice(this.squadMen.length);
    if (missing.length === 0) return;
    const { player } = this.ctx;
    const center = at ? new THREE.Vector3(...at.at) : player.position.clone();
    for (const a of allies.spawnSquad(missing.length, center, (at?.yaw ?? player.yaw) + Math.PI, 3, missing)) {
      allies.setOrder(a, 'follow');
      this.squadMen.push(a);
    }
  }

  callins(held: boolean): void {
    (this.ctx.progression as unknown as { holdCallIns(held: boolean): void }).holdCallIns(held);
  }

  /** The Bureau's side posted and detached from the player's orders, the militia's held on their ground by the war (war.ts). */
  battle(order: BattleOrder, at: Mark, from: Mark): void {
    const facing = Math.atan2(from.at[0] - at.at[0], from.at[2] - at.at[2]);
    const men = this.ctx.allies?.spawnSquad(order.bailiffs.length, new THREE.Vector3(...at.at), facing, 4, order.bailiffs) ?? [];
    this.battles.set(order.id, men);
    this.war.front(order.id, at, from, men);
    this.squad({ do: 'squad', tag: order.id, men: order.militia, at: order.from, orders: 'hold' }, from);
  }

  stop(battle: string): void {
    for (const a of this.battles.get(battle) ?? []) this.dismiss(a);
    this.battles.delete(battle);
    this.war.end(battle);
    this.sweep(battle);
  }

  private dismiss(a: Ally): void {
    this.ctx.allies?.dismiss(a);
  }

  /** A sniper's round into the player's man of this type (or the last man up), from over `from`: `wound` puts him down, `lose` kills him. */
  private snipe(type: string, from: string, kill: boolean): void {
    const allies = this.ctx.allies;
    const up = this.squadMen.filter(a => a.state === 'up');
    const a = up.find(m => m.type === type) ?? up[up.length - 1];
    const mark = this.runner.mission.marks[from];
    if (!allies || !a || !mark) return;
    const shooter = new THREE.Vector3(mark.at[0], mark.at[1] + SNIPED.height, mark.at[2]);
    const dir = a.body.center.clone().sub(shooter).normalize();
    this.ctx.fx.tracer(shooter, a.body.center, 'sabot');
    this.ctx.audio.play('sniper_fire', { position: shooter, volume: 1 });
    this.cue('sniped', shooter.toArray(), a.body.center.toArray());
    // Just enough to put him down, or plenty: the wound table decides how he falls, `takeHit` whether he gets up.
    const amount = kill ? a.maxHealth * SNIPED.kill : a.health * SNIPED.wound;
    allies.hurt(a, amount, a.body.center, dir, undefined, 'chest', 'bullet', 'sniper');
  }

  private gun(index: number): Emplacement | undefined {
    const p = this.ctx.progression as unknown as { callInsManager?: { emplacements?: { all: readonly Emplacement[] } } };
    return p.callInsManager?.emplacements?.all[index];
  }

  adapt(): void {
    this.manager.outpost?.commander.intermission(this.level, INTERMISSION, true);
  }

  field(answer: AdaptationId): void {
    this.manager.outpost?.commander.adopt(answer);
  }

  threat(level: number, grade?: Rank): void {
    this.level = level;
    this.manager.setWave(level);
    this.manager.outpost?.setGrade(grade ?? null);
  }

  music(state: MusicState): void {
    this.ctx.audio.music(state);
  }

  /** The few things a mission does that are nobody's system. Anyone else's goes through `provide`, which replaces this. */
  call(name: string, arg: string | undefined): void {
    const { ctx } = this;
    switch (name) {
      case 'lights':
        ctx.render.post.setGrade(arg === 'emergency' ? 'blackout' : 'default', arg === 'emergency' ? LIGHTS_OUT : LIGHTS_BACK);
        if (arg === 'emergency') ctx.audio.play('lights_out');
        return;
      case 'crash':
        this.ui.curtain(1);
        this.ui.lift(CRASH_SECONDS);
        ctx.camera.addTrauma(1);
        ctx.audio.play('wreck_land', { unaffectedByTime: true });
        ctx.audio.play('ear_ring', { volume: 0.5, duration: CRASH_SECONDS * 2, unaffectedByTime: true });
        return;
      case 'shatter': {
        const { at, width, height } = this.runner.mission.doors[arg!]!;
        for (let i = 0; i < PANE_BURSTS; i++) {
          _v.set(at[0] + (i / (PANE_BURSTS - 1) - 0.5) * width, at[1] + height * (0.25 + 0.5 * (i % 2)), at[2]);
          ctx.fx.impact(_v, THROUGH_GLASS, 'glass', 2);
        }
        ctx.audio.play('glass_break', { position: _v.set(...at) });
        return;
      }
      // A circling ride heads for its route, with the missile to come from the `arg` mark.
      case 'comeAbout':
        if (arg) this.launcher = new THREE.Vector3(...this.runner.mission.marks[arg]!.at);
        return;
      case 'mark':
        if (arg) this.manager.vehicles?.target(arg);
        return;
      case 'quiet':
        ctx.events.emit('commander:quiet', {});
        return;
      case 'commanderToRoof':
        if (arg) this.manager.outpost?.commander.person.fallBack(new THREE.Vector3(...this.runner.mission.marks[arg]!.at));
        return;
      // Foreclosure's war (war.ts, courier.ts). `crew` is `tag:gun`, a tag's man on the map's mounted gun of that index.
      case 'crew': {
        const [tag, index] = (arg ?? '').split(':');
        const gun = this.gun(Number(index));
        if (tag && gun) this.war.crew(gun, tag);
        return;
      }
      case 'charge':
        if (arg) this.war.breach(this.runner.mission.marks[arg]!);
        return;
      // Marks, comma separated: the wall or gate by any of them going raises `war:breached`.
      case 'watch':
        this.war.watch((arg ?? '').split(',').map(m => this.runner.mission.marks[m]!).filter(Boolean));
        return;
      // `type@mark`: one of the player's own is shot from over the mark.
      case 'wound':
      case 'lose': {
        const [type, from] = (arg ?? '').split('@');
        this.snipe(type ?? '', from ?? '', name === 'lose');
        return;
      }
      // The mission's `courier` route, shot at from its `flak` route, down onto the `arg` mark.
      case 'courier': {
        const { marks, routes } = this.runner.mission;
        this.courier.fly(routes.courier!.map(m => marks[m]!), (routes.flak ?? []).map(m => marks[m]!), marks[arg!]!);
        return;
      }
      case 'wreck':
        if (arg) this.courier.burn(this.runner.mission.marks[arg]!);
        return;
      // A brain chip fitted for the mission (contracts/chips.ts): `{ do: 'call', name: 'chip', arg: 'thermal' }`. A mission
      // starts on Sonar alone.
      case 'chip': {
        const chips = (ctx.contracts as unknown as { chips?: { rack: ChipRack } }).chips;
        if (arg && Object.hasOwn(CHIPS, arg)) chips?.rack.fit(arg as ChipId, true);
        return;
      }
      case 'fc.flakSalvo':
      case 'fc.slipWreck':
      case 'fc.slipBoot':
      case 'fc.slipBootOff':
      case 'fc.sappers':
      case 'fc.flakStart':
      case 'fc.motherReveal':
      case 'fc.motherFight':
      case 'fc.motherDeck':
      case 'fc.surrender':
      case 'fc.hideBoss':
        this.foreclosureCall?.(name, arg);
        return;
      default:
        if (name.startsWith('fc.')) {
          this.foreclosureCall?.(name, arg);
          return;
        }
        if (name.startsWith('qt.')) {
          this.chanceryCall?.(name, arg);
          return;
        }
        if (name.startsWith('bk.')) {
          this.bankRunCall?.(name, arg);
          return;
        }
        console.warn(`[campaign] nothing provides the call "${name}"`);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Co-op (campaign/coop.ts has the table; net/mission.ts does the carrying)
  // ---------------------------------------------------------------------------------------------

  /** Foreclosure's set-piece call handler (campaign/foreclosure.ts), wired by Campaign when running Foreclosure. */
  foreclosureCall?: (name: string, arg: string | undefined) => void;
  /** Quiet Title's Chancery Estate runtime handler (campaign/chancery.ts), wired by Campaign when running Quiet Title. */
  chanceryCall?: (name: string, arg: string | undefined) => void;
  /** Bank Run's heist & highway chase runtime handler (campaign/bankRun.ts), wired by Campaign when running Bank Run. */
  bankRunCall?: (name: string, arg: string | undefined) => void;

  /** Co-op: every living player's feet (types.ts). net/mission.ts provides it; alone it is unset. */
  crowd?: () => readonly { x: number; y: number; z: number }[];

  /**
   * A set piece's look, for the other screens (coop.ts, CUES). Alone, and on the host itself, this does nothing: the host has
   * already drawn its own. In co-op net/mission.ts replaces it on the host with one that sends the cue, and a guest plays it (`show`).
   */
  cue(_name: string, ..._args: unknown[]): void {}

  /** Co-op, on a guest: plays a cue the host sent. What arrives came from another browser, so every field is checked. */
  show(name: string, args: readonly unknown[]): void {
    const { ctx } = this;
    const vec = (v: unknown): THREE.Vector3 | null =>
      Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n)) ? new THREE.Vector3(v[0], v[1], v[2]) : null;
    switch (name) {
      // The host's ride is over. A seat that is still flying its own copy lets go; nothing else is touched.
      case 'alight':
        if (this.riding) (ctx.progression as unknown as { leaveSeat?(): void }).leaveSeat?.();
        this.riding = false;
        return;
      case 'filmEnd':
        this.film.end(args[0] === true);
        return;
      case 'votes':
        this.ui.votes(typeof args[0] === 'string' ? args[0].slice(0, 12) : '');
        return;
      case 'callout': {
        const at = vec(args[3]);
        if (at) this.war.heard(String(args[0] ?? '').slice(0, 160), args[1] === null ? null : String(args[1] ?? '').slice(0, 60), String(args[2] ?? '').slice(0, 40), at, args[4] === true);
        return;
      }
      case 'charge': {
        const at = vec(args[0]);
        if (at) this.war.showCharge(at, typeof args[1] === 'number' ? args[1] : -1);
        return;
      }
      case 'sniped': {
        const from = vec(args[0]);
        const to = vec(args[1]);
        if (!from || !to) return;
        ctx.fx.tracer(from, to, 'sabot');
        ctx.audio.play('sniper_fire', { position: from, volume: 1 });
        return;
      }
      case 'frame':
        ctx.hud.banner('DISTRAINT FRAME', `Stand-in: ${String(args[0] ?? '').slice(0, 12)}`);
        return;
      default:
        console.warn(`[campaign] no cue "${name}"`);
    }
  }

  /** Co-op: true from a mirrored ride or sortie until the host says it is over. */
  riding = false;

  /**
   * Co-op: a teammate took the gun off a rack, for the team. This player's copy of the rack goes and the gun is issued, in the hand
   * they already hold: only the one who walked over it draws it.
   */
  issue(weapon: WeaponId, by: string): void {
    this.racks.pull(weapon);
    if (this.ctx.weapons.owned.has(weapon)) return;
    this.ctx.weapons.give(weapon);
    this.ctx.hud.feed(`${by} took the ${WEAPONS[weapon].name}: one issued to you`, MARKER_COLOR);
  }

  /** Co-op, on the host: a guest walked over their copy of this rack. True when it was still there to take. */
  taken(weapon: WeaponId): boolean {
    const took = this.racks.pull(weapon);
    if (!took) return false;
    this.ctx.weapons.give(weapon);
    took();
    return true;
  }

  deploy(at: Mark | null, loadout: Loadout): void {
    const { player, weapons } = this.ctx;
    if (at) {
      player.teleport(_v.set(...at.at), at.yaw);
      // Back at a checkpoint with the guns already on it: the first second is the player's, so a death cannot start another.
      player.park(_v);
      player.unpark(DEPLOY_GRACE);
    }
    if (loadout.mods !== undefined || loadout.exclusiveMods) {
      weapons.setLoadout(loadout.weapons, loadout.grenades, { mods: loadout.mods, exclusiveMods: loadout.exclusiveMods });
    } else {
      weapons.setLoadout(loadout.weapons, loadout.grenades);
    }
    if (loadout.chip) this.call('chip', loadout.chip);
  }

  saved(_beat?: Beat): void {
    this.ui.saved();
  }

  finished(): void {
    this.ctx.events.emit('campaign:complete', {});
  }

  /** What the next run opens with, once the Council has taken its cut. */
  bank(): { score: number; kills: number; headshots: number } {
    const { progression: p } = this.ctx;
    return { score: Math.round(p.score * (1 - REDEPLOY_FEE)), kills: p.kills, headshots: p.headshots };
  }

  update(dt: number): void {
    this.spawnNext(dt);
    this.doors.update(dt);
    this.racks.update(dt);
    this.film.update(this.ctx.time.realDt);
    this.war.update(dt);
    this.courier.update(dt);
    if (this.rideDone && !this.ctx.player.parked) {
      const done = this.rideDone;
      this.rideDone = null;
      this.riding = false;
      this.cue('alight');
      done();
    }
  }

  /** A new run has emptied the map, so nothing that was tracking it can be right any more. */
  clear(): void {
    this.tagOf.clear();
    this.arrivals.length = 0;
    this.held.clear();
    this.tagging = null;
    this.bossTag = null;
    this.rideDone = null;
    this.launcher = null;
    this.riding = false;
    this.squadMen.length = 0;
    this.battles.clear();
    this.arrivalClock = 0;
    this.level = 1;
    for (const marker of this.markers.values()) marker.off();
    this.markers.clear();
    this.racks.reset();
    this.film.reset();
    this.war.clear();
    this.courier.clear();
  }
}
