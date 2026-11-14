/**
 * The mission's hands in the real game. Every method here is the plainest thing that works with what the game has today, and any of
 * them can be replaced with `campaign.provide`, as `vehicle` is by the system that has the vehicles.
 */
import * as THREE from 'three';
import type { Ally, AllyType } from '../allies';
import type { Ctx, GameEvents, MusicState } from '../core/contracts';
import type { CallInId, EnemyId, EnemyInstance, PickupKind, WeaponId } from '../core/gameplay';
import type { AdaptationId } from '../enemies/commander/adaptations';
import type { Rank } from '../enemies/outpost/rank';
import type { Line } from '../enemies/commander/lines';
import type { Enemy } from '../enemies/Enemy';
import type { EnemyManager } from '../enemies/EnemyManager';
import { MAX_HOSTILE } from '../enemies/outpost/doctrine';
import type { ActionId } from '../enemies/outpost/planner';
import type { OutpostSquad } from '../enemies/outpost/squad';
import { CutscenePlayer } from './cutscene';
import { Doors } from './doors';
import type { CampaignHud } from './hud';
import { Racks } from './racks';
import type { MissionRunner } from './runner';
import type { BattleOrder, Cutscene, DoorDef, FrameAct, Loadout, Mark, MissionHost, ObjectiveState, SquadOrder, SquadOrders } from './types';

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
  private level = 1;
  /** The player's Bailiffs, and each battle's. A man leaves these lists as he dies, before the pool can hand him out again. */
  private readonly squadMen: Ally[] = [];
  private readonly battles = new Map<string, Ally[]>();

  constructor(private readonly ctx: Ctx, private readonly ui: CampaignHud) {
    this.doors = new Doors(ctx);
    this.racks = new Racks(ctx);
    this.film = new CutscenePlayer(ctx, ui);
    const { events } = ctx;
    events.on('enemy:spawned', e => {
      if (this.tagging) this.tagOf.set(e.enemy.uid, this.tagging);
    });
    events.on('enemy:killed', e => this.gone(e.enemy, true, e.damage.source));
    events.on('enemy:surrendered', e => this.gone(e.enemy, false, ''));
    events.on('enemy:escaped', e => this.gone(e.enemy, false, ''));
    events.on('enemy:hit', e => {
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

  rack(weapon: WeaponId, at: Mark, took: () => void): void {
    this.racks.add(weapon, at, took);
  }

  drop(item: PickupKind, at: Mark): void {
    if (item === 'weaponCache') this.ctx.progression.spawnPickup(item, _v.set(...at.at));
    else this.ctx.progression.placePickup(item, _v.set(...at.at));
  }

  cutscene(_id: string, scene: Cutscene, done: (skipped: boolean) => void): void {
    this.film.play(scene, done);
  }

  /** A route is flown as written, and calls its marks as `ride:<mark>`. With no route it is the ordinary call-in, circling for its time. */
  ride(seat: CallInId, route: readonly Mark[], done: () => void): void {
    this.rideDone = done;
    if (route.length < 2 || seat !== 'doorGunner') {
      this.ctx.progression.boardCallIn(seat);
      return;
    }
    const names = new Map(Object.entries(this.runner.mission.marks).map(([name, mark]) => [mark, name]));
    this.ctx.progression.boardFlight({
      marks: route.map(m => ({ x: m.at[0], y: m.at[1], z: m.at[2], hold: m.hold ?? 0, name: names.get(m) ?? '', hit: m.hit ?? false })),
      reached: name => this.runner.signal(`ride:${name}`),
    });
  }

  /** shortcut: the gunship circles where the crosshair falls from the mark, not the mark itself; give `boardCallIn` a point when a beat needs it exact. */
  sortie(over: Mark, done: () => void): void {
    this.place(over);
    this.ride('ac130', [], done);
  }

  /** The Frame is stage 3's (src/frame), which provides this. Until it lands, a banner says what would happen and the beat goes on. */
  frame(act: FrameAct, at: Mark, done: () => void): void {
    if (act === 'eject') this.place(at);
    this.ctx.hud.banner('DISTRAINT FRAME', `Stand-in: ${act}`);
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

  battle(order: BattleOrder, at: Mark, from: Mark): void {
    const facing = Math.atan2(from.at[0] - at.at[0], from.at[2] - at.at[2]);
    const men = this.ctx.allies?.spawnSquad(order.bailiffs.length, new THREE.Vector3(...at.at), facing, 4, order.bailiffs) ?? [];
    this.battles.set(order.id, men);
    this.squad({ do: 'squad', tag: order.id, men: order.militia, at: order.from, orders: 'hold' }, from);
  }

  stop(battle: string): void {
    for (const a of this.battles.get(battle) ?? []) this.dismiss(a);
    this.battles.delete(battle);
    this.sweep(battle);
  }

  /** shortcut: reaches AllySystem's private `release`, the one way a man leaves unseen; ask src/allies for a public one when it is free. */
  private dismiss(a: Ally): void {
    (this.ctx.allies as unknown as { release(a: Ally, withBody: boolean): void }).release(a, true);
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
      case 'mark':
        if (arg) this.manager.vehicles?.target(arg);
        return;
      case 'quiet':
        ctx.events.emit('commander:quiet', {});
        return;
      case 'commanderToRoof':
        if (arg) this.manager.outpost?.commander.person.fallBack(new THREE.Vector3(...this.runner.mission.marks[arg]!.at));
        return;
      default:
        console.warn(`[campaign] nothing provides the call "${name}"`);
    }
  }

  deploy(at: Mark | null, loadout: Loadout): void {
    const { player, weapons } = this.ctx;
    if (at) {
      player.teleport(_v.set(...at.at), at.yaw);
      // Back at a checkpoint with the guns already on it: the first second is the player's, so a death cannot start another.
      player.park(_v);
      player.unpark(DEPLOY_GRACE);
    }
    weapons.setLoadout(loadout.weapons, loadout.grenades);
  }

  saved(): void {
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
    if (this.rideDone && !this.ctx.player.parked) {
      const done = this.rideDone;
      this.rideDone = null;
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
    this.squadMen.length = 0;
    this.battles.clear();
    this.arrivalClock = 0;
    this.level = 1;
    for (const marker of this.markers.values()) marker.off();
    this.markers.clear();
    this.racks.reset();
    this.film.reset();
  }
}
