/**
 * The mission's hands in the real game. Every method here is the plainest thing that works with what the game has today, and any of
 * them can be replaced with `campaign.provide`, as `vehicle` is by the system that has the vehicles.
 */
import * as THREE from 'three';
import type { Ctx, GameEvents, MusicState } from '../core/contracts';
import type { CallInId, EnemyId, EnemyInstance, PickupKind, WeaponId } from '../core/gameplay';
import type { AdaptationId } from '../enemies/commander/adaptations';
import type { Line } from '../enemies/commander/lines';
import type { Enemy } from '../enemies/Enemy';
import type { EnemyManager } from '../enemies/EnemyManager';
import { MAX_HOSTILE } from '../enemies/outpost/doctrine';
import type { OutpostSquad } from '../enemies/outpost/squad';
import { CutscenePlayer } from './cutscene';
import { Doors } from './doors';
import type { CampaignHud } from './hud';
import { Racks } from './racks';
import type { MissionRunner } from './runner';
import type { Cutscene, DoorDef, Loadout, Mark, MissionHost, ObjectiveState, SquadOrder } from './types';

/** Seconds between men coming on, the same walk-in the waves use. */
const MAN_GAP = 0.55;
/** A squad spreads over this much ground when it arrives, so nobody spawns inside anybody. */
const SPREAD = 1.6;
const SPAWN_SEARCH = 4;
const INTERMISSION = 8;
/** Share of the score the Council keeps for each replacement. */
const REDEPLOY_FEE = 0.1;
const MARKER_COLOR = '#ffc14a';

const _v = new THREE.Vector3();

interface Arrival {
  tag: string;
  men: readonly EnemyId[];
  at: THREE.Vector3;
  seat: number;
  hold: boolean;
}

export class GameHost implements MissionHost {
  readonly doors: Doors;
  readonly racks: Racks;
  readonly film: CutscenePlayer;
  runner!: MissionRunner;

  private readonly tagOf = new Map<number, string>();
  private readonly arrivals: Arrival[] = [];
  private readonly held = new Map<string, OutpostSquad[]>();
  private readonly markers = new Map<string, () => void>();
  private arrivalClock = 0;
  /** Tag for the next body to appear. */
  private tagging: string | null = null;
  private bossTag: string | null = null;
  private rideDone: (() => void) | null = null;
  private level = 1;

  constructor(private readonly ctx: Ctx, private readonly ui: CampaignHud) {
    this.doors = new Doors(ctx);
    this.racks = new Racks(ctx);
    this.film = new CutscenePlayer(ctx, ui.cinema);
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
    for (const [id, unmark] of this.markers) {
      if (list.some(o => o.id === id && !o.done)) continue;
      unmark();
      this.markers.delete(id);
    }
    for (const o of list) {
      if (o.done || !o.at || this.markers.has(o.id)) continue;
      this.markers.set(o.id, hud.marker(_v.set(...o.at.at).clone(), '', MARKER_COLOR));
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
    this.arrivals.push({ tag: order.tag, men: order.men, at: new THREE.Vector3(...at.at), seat: 0, hold: order.orders === 'hold' });
  }

  release(tag: string): void {
    const squads = this.held.get(tag);
    if (!squads) return;
    for (const squad of squads) squad.stopLying();
    this.held.delete(tag);
  }

  sweep(): void {
    for (const a of this.arrivals) for (let i = a.seat; i < a.men.length; i++) this.runner.unitGone(a.tag, false, '');
    this.arrivals.length = 0;
    const { events } = this.ctx;
    const { manager } = this;
    for (const e of [...manager.alive]) {
      events.emit('enemy:escaped', { enemy: e });
      manager.withdraw(e as Enemy);
    }
    events.emit('campaign:sweep', {});
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
      if (head.hold) {
        const squad = o.squads[o.squads.length - 1]!;
        squad.lieStill();
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
    head.seat++;
    this.arrivalClock = MAN_GAP;
    if (head.seat >= head.men.length) this.arrivals.shift();
  }

  /** `VehicleSystem` provides this on every page with a mission. */
  vehicle(): void {}

  boss(tag: string, _at: Mark): void {
    this.bossTag = tag;
    this.manager.outpost?.commander.person.summon();
  }

  health(tag: string): number {
    for (const e of this.ctx.enemies.alive) if (this.tagOf.get(e.uid) === tag) return e.health / e.maxHealth;
    return 1;
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
    this.ctx.progression.spawnPickup(item, _v.set(...at.at));
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

  adapt(): void {
    this.manager.outpost?.commander.intermission(this.level, INTERMISSION);
  }

  field(answer: AdaptationId): void {
    this.manager.outpost?.commander.adopt(answer);
  }

  threat(level: number): void {
    this.level = level;
    this.manager.setWave(level);
  }

  music(state: MusicState): void {
    this.ctx.audio.music(state);
  }

  call(name: string): void {
    console.warn(`[campaign] nothing provides the call "${name}"`);
  }

  deploy(at: Mark | null, loadout: Loadout): void {
    const { player, weapons } = this.ctx;
    if (at) player.teleport(_v.set(...at.at), at.yaw);
    weapons.setLoadout(loadout.weapons, loadout.grenades);
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
    this.arrivalClock = 0;
    this.level = 1;
    for (const unmark of this.markers.values()) unmark();
    this.markers.clear();
    this.racks.reset();
    this.film.reset();
  }
}
