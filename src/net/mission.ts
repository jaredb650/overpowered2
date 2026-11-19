/**
 * Campaign co-op. The host's browser runs the mission: the runner, its triggers, the spawns, the battles. Every guest's own
 * mission host runs inert (its runner never starts) and plays what the host's does, so a guest plays the same mission from
 * the first line to the ending, and every player's actions count.
 *
 * Which operation goes where is one table, `src/campaign/coop.ts` (OPS, CALLS, CUES, EVENTS, TRIGGERS), printed in
 * docs/notes/coop.md, "Missions". This file carries it out:
 *
 *   host to guests   `mission` events: an operation to play (`speak`, `door`, `deploy`...), a `call` by name, a set piece's
 *                    `cue`, and the team's own (`beat`, `reset`, `taken`, `won`). The shared ones are also kept, so a late
 *                    joiner, a reconnecting player and a team back at a checkpoint get the state the mission is in (`catchUp`).
 *   guests to host   `mission` events too: `did` (a player action a trigger waits on), `took` (a gun off a rack), `skip`
 *                    (a vote to skip the film), `rounds` (how many rockets this player has left).
 *   `gather`         a regroup: a door closing, the team moving on to the next section, a player arriving late.
 *
 * The rules:
 * - A zone trigger fires when ANY living player is in it; an `outside` trigger when ALL have left (MissionHost.crowd).
 * - A zone that ends a section: the mission moves on with the first player in. The others get REGROUP_SECONDS to follow, then
 *   are put beside that player, so nobody is left behind a door that has shut.
 * - A door that closes regroups too: anyone more than REGROUP_METRES from the player nearest it is brought there after DOOR_SECONDS.
 * - `place` and `deploy` put everyone at the mark, each a step to the side by slot. Each player keeps their own starter gun.
 * - A gun on a rack is the team's: the first player to reach it takes it, and every player is issued one.
 * - A ride, a sortie and a film are everyone's. Whoever is down or dead is got up for them. They end for all when the host's
 *   ends. A film is skipped when every player has pressed skip.
 * - A checkpoint gets everyone up beside the leading player. Everyone down at once, or the host's "Restart from checkpoint",
 *   takes the whole team back: every screen rebuilds its run (`reset`), as the host's does.
 */
import * as THREE from 'three';
import type { Campaign } from '../campaign';
import { CALLS, DOOR_SECONDS, EVENTS, REGROUP_METRES, REGROUP_SECONDS, arrivalZones, countedGuns, matches, plainFields, playerEvents } from '../campaign/coop';
import type { MissionResult } from '../campaign/events';
import type { GameHost } from '../campaign/host';
import type { Beat, Zone } from '../campaign/types';
import { selectedStarter, starterLoadout } from '../contracts/starter';
import type { Ctx, GameEvents } from '../core/contracts';
import type { WeaponId } from '../core/gameplay';
import { WEAPONS } from '../weapons/data';
import type { CoopSession } from './index';
import type { WorldEvent } from './worldProtocol';
import type { Team } from './team';
import type { Router } from './world/router';
import type { Vec } from './world/wire';

/** The mission's events on the wire. */
export type MissionEvent =
  /** Host: something every guest plays on its own inert mission host. Guest: a report to the host (`did`, `took`, `skip`, `rounds`). */
  | { t: 'mission'; op: string; args: unknown[] }
  /**
   * Host: regroup on the player in `slot`, who stands at `at`. With `in`, after that many seconds and only if still apart
   * (`zone`: being inside this zone of the mission is being there). Without, now: a player arriving late.
   */
  | { t: 'gather'; at: Vec; yaw: number; in?: number; slot?: number; zone?: string };

/**
 * The operations of the mission host that go on the wire as themselves (coop.ts, OPS: every `mirrored` and `shared` one).
 * `frame` is not here: the game's stand-in is a banner (a `cue`) and, for the eject, a `place`.
 */
export const MIRRORED = ['speak', 'hush', 'objectives', 'hint', 'banner', 'door', 'music', 'cutscene', 'give', 'grenades', 'drop', 'rack',
  'place', 'deploy', 'ride', 'sortie', 'callins', 'call', 'saved', 'cue', 'finished'] as const;
export type MirroredOp = typeof MIRRORED[number];
/** What a guest tells the host. */
export const REPORTS = ['did', 'took', 'skip', 'rounds'] as const;
/** Most a late joiner is sent of the pickups dropped since the checkpoint. */
const DROPS_KEPT = 24;
/** Milliseconds between two reports of the same player action, and between two looks at the ammo. */
const DID_MS = 250;
const ROUNDS_MS = 500;
const noop = (): void => {};

type Feet = { x: number; y: number; z: number };

/** A mark moved a step to the side for this slot, so four players never land in one spot. */
export function spread(at: readonly number[], yaw: number, slot: number): [number, number, number] {
  const side = slot === 0 ? 0 : (slot % 2 ? 1 : -1) * Math.ceil(slot / 2) * 1.3;
  return [at[0]! + Math.cos(yaw) * side, at[1]!, at[2]! - Math.sin(yaw) * side];
}

const inside = (z: Zone, p: Feet): boolean =>
  p.x >= z.min[0] && p.x <= z.max[0] && p.y >= z.min[1] && p.y <= z.max[1] && p.z >= z.min[2] && p.z <= z.max[2];
const vec = (v: unknown): v is Vec => Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n));
/** What goes on the wire: data only. A callback becomes null. */
const plain = (args: unknown[]): unknown[] => JSON.parse(JSON.stringify(args)) as unknown[];

/** `until`: `performance.now()` when the countdown runs out. */
interface Regroup { slot: number; at: Vec; zone: string | null; until: number; said: number }

export class CoopMission {
  private wrapped = false;
  private hooked = false;
  /** Guest: mirrored ops played, for the proofs. */
  mirrored = 0;
  /** The mission's numbers once it is won, on every screen, for the team board. */
  result: MissionResult | null = null;
  /** The beat's title over the objectives: the host's runner's, shown on every screen. */
  private beatTitle = '';

  // Host: the state the mission is in, for a late joiner (`catchUp`). A checkpoint restart empties what a new run empties.
  private readonly doors = new Map<string, unknown[]>();
  private readonly latest = new Map<string, unknown[]>();
  private kit: { weapons: string[]; grenades: number } | null = null;
  private readonly racks = new Map<string, unknown[]>();
  private drops: unknown[][] = [];
  private readonly chips = new Set<string>();
  private wreck: string | null = null;
  private film: { args: unknown[]; at: number } | null = null;
  private ride: { op: 'ride' | 'sortie'; args: unknown[]; about: string | null } | null = null;

  /** Host: who has voted to skip the film. */
  private readonly skips = new Set<string>();
  private votesShown = '';
  /** Host: each guest's rounds for the guns the mission counts, by lobby id. */
  private readonly reported = new Map<string, Map<string, number>>();
  /** Host: the runner's event triggers, which hear the guests' actions too. */
  private readonly hearing: { name: string; fn: (payload: unknown) => void }[] = [];
  /** Host: the guest whose rack take is being applied. */
  private takingFor: string | null = null;
  /** Host: the beat the runner was in last frame, and which zones end each beat. */
  private lastBeat: Beat | null = null;
  private arrivals = new Map<string, string[]>();
  /** Host: a checkpoint restart has just rebuilt the run; everyone is got up on the next frame. */
  private restarted = false;

  /** Guest: what was last told to the host. */
  private readonly told = new Map<string, number>();
  private counted: WeaponId[] = [];
  /** Guest: the racks standing on this screen, by gun. */
  private readonly standing = new Set<string>();
  private nextRounds = 0;
  /** Everyone: the regroup this player is being counted down to. */
  private regroup: Regroup | null = null;
  private readonly off: (() => void)[] = [];

  constructor(private readonly ctx: Ctx, private readonly session: CoopSession, private readonly send: (event: WorldEvent, to?: string) => void,
    private readonly team: Team, private readonly onRide: () => void, private readonly onRebuild: () => void = noop) {}

  private get campaign(): Campaign | null {
    const campaign = this.ctx.campaign as unknown as Campaign | undefined;
    return campaign?.active && campaign.host ? campaign : null;
  }

  private get me(): number { return this.session.lobby.me?.slot ?? 0; }

  // ---------------------------------------------------------------------------------------------
  // Starting
  // ---------------------------------------------------------------------------------------------

  /** The map is up. The host's mission host starts sending; a guest's starts reporting. */
  begin(): void {
    const campaign = this.campaign;
    if (!campaign) return;
    // A film's skip key is a vote on every screen.
    campaign.host.film.askSkip = () => this.skipPressed();
    if (this.session.hosting) this.wrap(campaign);
    else this.hook(campaign);
  }

  /** Host: wraps the mission host so each mirrored op also goes to the guests, and the triggers see every player. */
  private wrap(campaign: Campaign): void {
    if (this.wrapped) return;
    this.wrapped = true;
    const host = campaign.host as unknown as Record<string, (...args: unknown[]) => unknown>;
    const real = (op: string): ((...args: unknown[]) => unknown) => host[op]!.bind(host);
    const tell = (op: string, args: unknown[]): unknown[] => {
      const wire = plain(args);
      this.send({ t: 'mission', op, args: wire });
      return wire;
    };
    const parts: Record<string, unknown> = {};
    // The plain ones: said, shown or handed to every player as they are to the host's.
    for (const op of ['speak', 'hush', 'hint', 'banner', 'place'] as const) {
      const run = real(op);
      parts[op] = (...args: unknown[]) => { tell(op, op === 'speak' ? [args[0]] : args); return run(...args); };
    }
    for (const op of ['objectives', 'music', 'callins'] as const) {
      const run = real(op);
      parts[op] = (...args: unknown[]) => { this.latest.set(op, tell(op, args)); return run(...args); };
    }
    const door = real('door');
    parts.door = (...args: unknown[]) => {
      const wire = tell('door', args.slice(0, 4));
      this.doors.set(String(args[0]), [wire[0], wire[1], wire[2], 0]);
      // A gate is closing: nobody is left on the far side of the map from it.
      const def = args[1] as { at?: unknown };
      if (args[2] === 0 && Number(args[3]) > 0 && vec(def?.at)) this.regroupOn(this.nearest(def.at), DOOR_SECONDS, null);
      return door(...args);
    };
    const deploy = real('deploy');
    parts.deploy = (...args: unknown[]) => {
      const wire = tell('deploy', args);
      const kit = wire[1] as { weapons?: unknown; grenades?: unknown } | null;
      this.kit = { weapons: Array.isArray(kit?.weapons) ? kit.weapons.map(String) : [], grenades: Number(kit?.grenades) || 0 };
      this.drops = [];
      return deploy(...args);
    };
    const give = real('give');
    parts.give = (...args: unknown[]) => { tell('give', args); this.issued(String(args[0])); return give(...args); };
    const grenades = real('grenades');
    parts.grenades = (...args: unknown[]) => { tell('grenades', args); if (this.kit) this.kit.grenades += Number(args[0]) || 0; return grenades(...args); };
    const drop = real('drop');
    parts.drop = (...args: unknown[]) => {
      this.drops.push(tell('drop', args));
      if (this.drops.length > DROPS_KEPT) this.drops.shift();
      return drop(...args);
    };
    // A rack is the team's. Whoever reaches their copy first takes it: the runner hears `took`, and everyone is issued the gun.
    const rack = real('rack');
    parts.rack = (weapon: unknown, at: unknown, took: unknown) => {
      const id = String(weapon);
      this.racks.set(id, tell('rack', [weapon, at]));
      return rack(weapon, at, () => {
        (took as () => void)();
        this.rackTaken(id, this.takingFor ?? this.session.lobby.you);
      });
    };
    // Everyone sees the film, rides the ride and flies the sortie: whoever is down or dead is got up for it.
    const cutscene = real('cutscene');
    parts.cutscene = (id: unknown, scene: unknown, done: unknown) => {
      this.team.respawnAll();
      this.skips.clear();
      this.film = { args: tell('cutscene', [id, scene]), at: performance.now() };
      return cutscene(id, scene, done);
    };
    const ride = real('ride');
    parts.ride = (seat: unknown, route: unknown, done: unknown, circle: unknown) => {
      this.team.respawnAll();
      this.onRide();
      this.ride = { op: 'ride', args: tell('ride', [seat, route, circle === true]), about: null };
      return ride(seat, route, done, circle);
    };
    const sortie = real('sortie');
    parts.sortie = (over: unknown, done: unknown) => {
      this.team.respawnAll();
      this.onRide();
      this.ride = { op: 'sortie', args: tell('sortie', [over]), about: null };
      return sortie(over, done);
    };
    const call = real('call');
    parts.call = (name: unknown, arg: unknown) => {
      const rule = CALLS[String(name)];
      if (rule && rule.class !== 'host') {
        tell('call', [name, arg ?? null]);
        if (rule.class === 'shared') this.recordCall(String(name), arg === undefined ? null : String(arg));
      }
      return call(name, arg);
    };
    // A set piece's look. The host has drawn its own; this is for the others.
    parts.cue = (name: unknown, ...args: unknown[]) => {
      if (name === 'alight') this.ride = null;
      if (name === 'filmEnd') { this.film = null; this.skips.clear(); this.votesShown = ''; }
      tell('cue', [name, ...args]);
    };
    // A checkpoint gets everyone up, beside whoever led the team into it.
    const saved = real('saved');
    parts.saved = (...args: unknown[]) => {
      const leader = this.arrivalLeader() ?? this.session.lobby.you;
      const at = this.where(leader);
      if (at) this.team.respawnAll(at, this.ctx.player.yaw);
      else this.team.respawnAll();
      const beat = args[0] as Beat | undefined;
      tell('saved', [{ id: beat?.id ?? '', title: beat?.title ?? '' }]);
      return saved(...args);
    };
    // The mission is won on every screen, with its numbers for the team board, before the team's own end goes out.
    const finished = real('finished');
    parts.finished = () => {
      this.result = campaign.tally();
      tell('finished', [this.result]);
      return finished();
    };
    // Any living player in a zone counts (watch.ts).
    parts.crowd = () => this.crowd();
    // A trigger waiting on something a player does hears every player do it.
    const listen = real('listen');
    parts.listen = (name: unknown, fn: unknown) => {
      const offLocal = listen(name, fn) as () => void;
      const entry = { name: String(name), fn: fn as (payload: unknown) => void };
      if (EVENTS[name as keyof GameEvents] === 'player') this.hearing.push(entry);
      return () => {
        offLocal();
        const i = this.hearing.indexOf(entry);
        if (i >= 0) this.hearing.splice(i, 1);
      };
    };
    // The player worst off among those who carry the gun decides whether the team is short.
    const rounds = real('rounds');
    parts.rounds = (weapon: unknown) => {
      let least = rounds(weapon) as number;
      for (const p of this.session.lobby.players) {
        if (p.away || p.id === this.session.lobby.you || this.team.life(p.id).state !== 'up') continue;
        const n = this.reported.get(p.id)?.get(String(weapon));
        if (n !== undefined && n >= 0) least = Math.min(least, n);
      }
      return least;
    };
    campaign.provide(parts as object);
    for (const beat of campaign.runner.mission.beats) {
      const zones = arrivalZones({ ...campaign.runner.mission, beats: [beat] });
      if (zones.length) this.arrivals.set(beat.id, zones);
    }
    this.lastBeat = campaign.runner.beat;
  }

  /** Guest: tells the host what this player does that the mission may be waiting on, and how many rounds they have. */
  private hook(campaign: Campaign): void {
    if (this.hooked) return;
    this.hooked = true;
    const { mission } = campaign.runner;
    playerEvents(mission).forEach((watch, index) => {
      this.off.push(this.ctx.events.on(watch.event, payload => {
        if (!matches(payload, watch.where)) return;
        const key = `did:${index}`;
        const now = performance.now();
        if (now - (this.told.get(key) ?? -Infinity) < DID_MS) return;
        this.told.set(key, now);
        this.send({ t: 'mission', op: 'did', args: [watch.event, plainFields(payload)] });
      }));
    });
    this.counted = countedGuns(mission);
  }

  // ---------------------------------------------------------------------------------------------
  // Host: the mission's state
  // ---------------------------------------------------------------------------------------------

  private issued(weapon: string): void {
    if (this.kit && !this.kit.weapons.includes(weapon)) this.kit.weapons.push(weapon);
  }

  private recordCall(name: string, arg: string | null): void {
    if (name === 'lights') this.latest.set('call:lights', ['lights', arg]);
    else if (name === 'chip' && arg) this.chips.add(arg);
    else if (name === 'wreck') this.wreck = arg;
    else if (name === 'comeAbout' && this.ride) this.ride.about = arg;
    // The courier is in the air for a quarter of a minute and its smoke is `wreck`: a player arriving in that time misses the flight.
  }

  private rackTaken(weapon: string, by: string): void {
    this.racks.delete(weapon);
    this.issued(weapon);
    const player = this.session.lobby.players.find(p => p.id === by);
    this.send({ t: 'mission', op: 'taken', args: [weapon, player?.slot ?? 0] });
    if (by !== this.session.lobby.you && Object.hasOwn(WEAPONS, weapon)) {
      this.ctx.hud.feed(`${player?.name ?? 'A teammate'} took the ${WEAPONS[weapon as WeaponId].name}: one issued to you`, '#ffc14a');
    }
  }

  /**
   * Host: the team is going back to the last checkpoint (everyone down, or the host's pause menu). Called by the campaign as the
   * host's own run is about to be rebuilt: every guest rebuilds theirs, and what a new run empties is forgotten here too.
   */
  restarting(): void {
    if (!this.wrapped) return;
    this.send({ t: 'mission', op: 'reset', args: [] });
    this.racks.clear();
    this.drops = [];
    this.chips.clear();
    this.wreck = null;
    this.film = null;
    this.ride = null;
    this.skips.clear();
    this.votesShown = '';
    // A new run opens the sky and puts the lights back (Renderer.reset), on every screen.
    this.latest.delete('callins');
    this.latest.delete('call:lights');
    this.regroup = null;
    this.restarted = true;
    this.ctx.hud.feed('BACK TO THE CHECKPOINT · the whole team', '#ffc14a');
  }

  /**
   * Host: takes the whole team back to the last checkpoint, as everyone going down does. For the pause menu and the team's
   * wipe (net/team.ts). False off a mission, or before the first checkpoint.
   */
  restart(): boolean {
    return this.session.hosting && !!this.campaign?.restart();
  }

  /** Host: a guest who joined (or rejoined) mid-mission is brought to where the mission is: place, kit, doors, lights, the lot. */
  catchUp(id: string): void {
    if (!this.wrapped) return;
    const to = (op: string, args: unknown[]): void => this.send({ t: 'mission', op, args }, id);
    // Beside whoever is up, first: a film or a ride parks the body where it stands.
    const lead = this.team.life(this.session.lobby.you).state === 'up' ? this.session.lobby.you
      : this.session.lobby.players.find(p => !p.away && p.id !== id && this.team.life(p.id).state === 'up')?.id ?? this.session.lobby.you;
    const at = this.where(lead) ?? this.ctx.player.position;
    this.send({ t: 'gather', at: [at.x, at.y, at.z], yaw: this.ctx.player.yaw }, id);
    to('beat', [this.beatTitle]);
    for (const args of this.doors.values()) to('door', args);
    for (const [key, args] of this.latest) to(key.startsWith('call:') ? 'call' : key, args);
    // The kit the mission has handed out so far, never the checkpoint's mark: the mission has moved on from there.
    if (this.kit) to('deploy', [null, this.kit]);
    for (const chip of this.chips) to('call', ['chip', chip]);
    if (this.wreck) to('call', ['wreck', this.wreck]);
    for (const args of this.racks.values()) to('rack', args);
    for (const args of this.drops) to('drop', args);
    if (this.film) to('cutscene', [...this.film.args, (performance.now() - this.film.at) / 1000]);
    else if (this.ride) {
      to(this.ride.op, this.ride.args);
      if (this.ride.about) to('call', ['comeAbout', this.ride.about]);
    }
    if (this.result) to('finished', [this.result]);
  }

  // ---------------------------------------------------------------------------------------------
  // Where the players are
  // ---------------------------------------------------------------------------------------------

  /** Where this player's feet are, if their body is in the world. */
  private where(id: string): THREE.Vector3 | null {
    if (id === this.session.lobby.you) return this.ctx.player.position;
    const remote = this.session.remotes.get(id);
    return remote?.char.root.visible ? remote.char.root.position : null;
  }

  private living(): { id: string; slot: number; at: THREE.Vector3 }[] {
    const out: { id: string; slot: number; at: THREE.Vector3 }[] = [];
    for (const p of this.session.lobby.players) {
      if (p.away || this.team.life(p.id).state !== 'up') continue;
      const at = this.where(p.id);
      if (at) out.push({ id: p.id, slot: p.slot, at });
    }
    return out;
  }

  /**
   * A step to the side of a mark for this slot, if that is floor at the mark's own height. A mark on a narrow deck or against a
   * wall has no such step: then the mark itself, where players may stand in one another (their bodies do not collide).
   */
  private beside(at: Vec, yaw: number, slot: number): Vec {
    const to = spread(at, yaw, slot);
    const nav = this.ctx.world?.nav as { nearest?(point: THREE.Vector3, radius: number, out: THREE.Vector3): boolean } | undefined;
    if (!nav?.nearest) return to;
    const point = new THREE.Vector3(...to);
    const found = new THREE.Vector3();
    try {
      return nav.nearest(point, 0.5, found) && Math.abs(found.y - at[1]) < 0.6 ? to : [at[0], at[1], at[2]];
    } catch { return to; }
  }

  /** Where every living player stands, for the mission's zones. */
  crowd(): Feet[] {
    return this.living().map(p => ({ x: p.at.x, y: p.at.y, z: p.at.z }));
  }

  /** The living player nearest a point: the one a door is closing in front of. */
  private nearest(point: Vec): string | null {
    let best: string | null = null;
    let least = Infinity;
    for (const p of this.living()) {
      const d = Math.hypot(p.at.x - point[0], p.at.y - point[1], p.at.z - point[2]);
      if (d < least) { least = d; best = p.id; }
    }
    return best;
  }

  /** Host: the living player standing in a zone that ended the beat before this one, with that zone. */
  private arrival(): { id: string; zone: string } | null {
    const campaign = this.campaign;
    const from = this.lastBeat;
    if (!campaign || !from) return null;
    for (const zone of this.arrivals.get(from.id) ?? []) {
      const box = campaign.runner.mission.zones[zone];
      const first = box && this.living().find(p => inside(box, p.at));
      if (first) return { id: first.id, zone };
    }
    return null;
  }

  private arrivalLeader(): string | null {
    return this.campaign?.runner.beat !== this.lastBeat ? this.arrival()?.id ?? null : null;
  }

  // ---------------------------------------------------------------------------------------------
  // Regrouping
  // ---------------------------------------------------------------------------------------------

  /** Host: everyone regroups on this player in `seconds`, unless they get there (or into `zone`) first. */
  private regroupOn(leader: string | null, seconds: number, zone: string | null): void {
    const player = leader ? this.session.lobby.players.find(p => p.id === leader) : null;
    const at = leader ? this.where(leader) : null;
    if (!player || !at) return;
    const event: Extract<MissionEvent, { t: 'gather' }> = { t: 'gather', at: [at.x, at.y, at.z], yaw: this.ctx.player.yaw, in: seconds, slot: player.slot, ...(zone ? { zone } : {}) };
    this.send(event);
    this.gathered(event);
  }

  /** Any player: a regroup. With no countdown it is now (arriving late); with one, only if still apart when it runs out. */
  private gathered(event: Extract<MissionEvent, { t: 'gather' }>): void {
    if (!vec(event.at)) return;
    const yaw = Number.isFinite(event.yaw) ? event.yaw : 0;
    const seconds = typeof event.in === 'number' && Number.isFinite(event.in) ? Math.max(0, Math.min(60, event.in)) : 0;
    if (seconds <= 0) {
      // Onto the very spot: a living player stands there, so it is ground, which a step to the side of it may not be.
      const here = this.ctx.player.position;
      if (Math.hypot(here.x - event.at[0], here.z - event.at[2]) > REGROUP_METRES) this.ctx.player.teleport(new THREE.Vector3(...event.at), yaw);
      return;
    }
    const slot = Number.isInteger(event.slot) ? event.slot! : -1;
    // The leader stays where they are, and the dead come back at the checkpoint.
    if (slot === this.me || !this.ctx.player.alive && !(this.ctx.player as unknown as { downed?: boolean }).downed) return;
    this.regroup = { slot, at: [...event.at], zone: typeof event.zone === 'string' ? event.zone.slice(0, 40) : null, until: performance.now() + seconds * 1000, said: -1 };
    if (this.together(this.regroup)) this.regroup = null;
  }

  /** True when this player is where the regroup wants them. */
  private together(r: Regroup): boolean {
    const here = this.ctx.player.position;
    if (r.zone) {
      // A new section: only being in its zone is being there. Beside the player who opened it is not enough: a door that has
      // just shut may stand between, and their body on this screen is a moment behind where they are.
      const box = this.campaign?.runner.mission.zones[r.zone];
      return !!box && inside(box, here);
    }
    // A closing door: within reach of where its nearest player stood, or of where they are now.
    if (Math.hypot(here.x - r.at[0], here.y - r.at[1], here.z - r.at[2]) <= REGROUP_METRES) return true;
    const leader = this.session.lobby.players.find(p => p.slot === r.slot);
    const at = leader ? this.where(leader.id) : null;
    return !!at && here.distanceTo(at) <= REGROUP_METRES;
  }

  /** The countdown is on the real clock: a screen running slowly must not make its player wait longer. */
  private countRegroup(): void {
    const r = this.regroup;
    if (!r) return;
    if (this.together(r)) { this.regroup = null; return; }
    const left = (r.until - performance.now()) / 1000;
    const leader = this.session.lobby.players.find(p => p.slot === r.slot);
    const name = leader?.name ?? 'the team';
    const shown = Math.max(0, Math.ceil(left));
    if (shown !== r.said) {
      r.said = shown;
      this.ctx.hud.callout?.(`REGROUP · moving you up to ${name} in ${shown}`);
    }
    if (left > 0) return;
    this.regroup = null;
    // Onto the leader's own spot (bodies do not collide): where they stand is ground, and a step to the side may be a wall or a drop.
    const at = leader ? this.where(leader.id) : null;
    const to: Vec = at ? [at.x, at.y, at.z] : r.at;
    this.ctx.player.teleport(new THREE.Vector3(...to), this.ctx.player.yaw);
    this.ctx.hud.feed(`Moved up to ${name}`, '#79f1ad');
  }

  // ---------------------------------------------------------------------------------------------
  // The film's skip vote
  // ---------------------------------------------------------------------------------------------

  /** This player pressed skip in a film. Never ends it here: the host ends every screen's when everyone has. */
  private skipPressed(): boolean {
    if (this.session.hosting) this.vote(this.session.lobby.you);
    else this.send({ t: 'mission', op: 'skip', args: [] });
    return false;
  }

  private vote(id: string): void {
    if (!this.film) return;
    this.skips.add(id);
    this.tally();
  }

  /** Host: shows the vote, and ends the film for everyone once every player in the match has voted. */
  private tally(): void {
    const campaign = this.campaign;
    if (!campaign || !this.film || this.skips.size === 0) return;
    const voters = this.session.lobby.players.filter(p => !p.away);
    const votes = voters.filter(p => this.skips.has(p.id)).length;
    const text = `${votes}/${voters.length}`;
    if (text !== this.votesShown) {
      this.votesShown = text;
      campaign.ui.votes(text);
      this.send({ t: 'mission', op: 'cue', args: ['votes', text] });
    }
    if (votes >= voters.length) campaign.host.film.end(true);
  }

  // ---------------------------------------------------------------------------------------------
  // Arriving events
  // ---------------------------------------------------------------------------------------------

  /** Registers the mission's events with the world's router (world/router.ts). */
  plug(router: Router): void {
    router.guest('mission', event => { this.receive(event); });
    router.guest('gather', event => { this.receive(event); });
    router.host('mission', (event, from) => { this.report(event, from); });
  }

  /** Host: a guest's report. It came from another browser: every field is checked, and nothing here can move the mission but a trigger. */
  private report(value: Extract<MissionEvent, { t: 'mission' }>, from: string): void {
    const campaign = this.campaign;
    const player = this.session.lobby.players.find(p => p.id === from);
    if (!campaign || !this.wrapped || !player || !Array.isArray(value.args) || value.args.length > 4) return;
    const args = value.args;
    switch (value.op) {
      case 'did': {
        const name = String(args[0]);
        if (EVENTS[name as keyof GameEvents] !== 'player' || this.team.life(from).state === 'dead') return;
        const payload = plainFields(args[1]);
        for (const hearer of [...this.hearing]) if (hearer.name === name) hearer.fn(payload);
        return;
      }
      case 'took': {
        const weapon = String(args[0]);
        if (!this.racks.has(weapon) || this.team.life(from).state !== 'up') return;
        this.takingFor = from;
        try { campaign.host.taken(weapon as WeaponId); } finally { this.takingFor = null; }
        return;
      }
      case 'skip':
        this.vote(from);
        return;
      case 'rounds': {
        const weapon = String(args[0]);
        const n = Number(args[1]);
        if (!Object.hasOwn(WEAPONS, weapon) || !Number.isFinite(n)) return;
        let counts = this.reported.get(from);
        if (!counts) this.reported.set(from, counts = new Map());
        counts.set(weapon, Math.max(-1, Math.min(9999, Math.round(n))));
        return;
      }
      default:
    }
  }

  /** Guest: plays what the host's mission did, on this screen's own (inert) mission host. */
  receive(value: WorldEvent): boolean {
    if (value.t === 'gather') { this.gathered(value); return true; }
    if (value.t !== 'mission') return false;
    const campaign = this.campaign;
    if (!campaign || this.session.hosting || !Array.isArray(value.args) || value.args.length > 6) return true;
    try { this.play(campaign, value.op, [...value.args]); this.mirrored++; }
    catch (error) { console.warn('[coop] Could not mirror the mission\'s', value.op, error); }
    return true;
  }

  private play(campaign: Campaign, op: string, args: unknown[]): void {
    const host: GameHost = campaign.host;
    const slot = this.me || 1;
    /** Everyone lands at the mark, a step apart where there is floor for it. */
    const marked = (mark: unknown): unknown => {
      const m = mark as { at?: unknown; yaw?: number } | null;
      return m && vec(m.at) ? { ...m, at: this.beside(m.at, m.yaw ?? 0, slot) } : mark;
    };
    switch (op) {
      // The team's own.
      case 'beat':
        this.beatTitle = String(args[0] ?? '').slice(0, 80);
        return;
      case 'reset':
        // Back to the checkpoint: this screen's run is rebuilt as the host's is. The copies of the host's world go first.
        this.regroup = null;
        this.told.clear();
        this.standing.clear();
        this.onRebuild();
        campaign.follow();
        this.retag();
        this.ctx.hud.feed('BACK TO THE CHECKPOINT · the whole team', '#ffc14a');
        return;
      case 'taken': {
        const weapon = String(args[0]);
        const by = this.session.lobby.players.find(p => p.slot === args[1]);
        this.standing.delete(weapon);
        if (Object.hasOwn(WEAPONS, weapon) && by?.id !== this.session.lobby.you) host.issue(weapon as WeaponId, by?.name ?? 'A teammate');
        return;
      }
      // The mission host's.
      case 'speak': host.speak(args[0] as Parameters<GameHost['speak']>[0], noop); return;
      case 'hush': host.hush(); return;
      case 'objectives': host.objectives(args[0] as Parameters<GameHost['objectives']>[0]); return;
      case 'hint': host.hint(String(args[0] ?? ''), Number(args[1]) || 7); return;
      case 'banner': host.banner(String(args[0] ?? ''), args[1] === undefined || args[1] === null ? undefined : String(args[1])); return;
      case 'music': host.music(args[0] as Parameters<GameHost['music']>[0]); return;
      case 'callins': host.callins(args[0] === true); return;
      case 'door': host.door(String(args[0]), args[1] as Parameters<GameHost['door']>[1], Number(args[2]), Number(args[3]) || 0, noop); return;
      case 'place': host.place(marked(args[0]) as Parameters<GameHost['place']>[0]); return;
      case 'deploy': {
        // Each player keeps the starter gun they picked in the lobby: the host's stands where theirs goes.
        const kit = args[1] as { weapons?: unknown; grenades?: unknown } | null;
        const weapons = (Array.isArray(kit?.weapons) ? kit.weapons : []).filter((w): w is WeaponId => typeof w === 'string' && Object.hasOwn(WEAPONS, w));
        if (weapons.length === 0) return;
        const mine = starterLoadout(weapons, selectedStarter(this.session.match.mode));
        host.deploy(args[0] ? marked(args[0]) as Parameters<GameHost['deploy']>[0] : null, { weapons: [...new Set(mine)], grenades: Math.max(0, Math.min(99, Number(kit?.grenades) || 0)) });
        return;
      }
      case 'give': if (Object.hasOwn(WEAPONS, String(args[0]))) host.give(args[0] as WeaponId); return;
      case 'grenades': host.grenades(Math.max(0, Math.min(99, Number(args[0]) || 0))); return;
      case 'drop': host.drop(args[0] as Parameters<GameHost['drop']>[0], args[1] as Parameters<GameHost['drop']>[1]); return;
      case 'rack': {
        const weapon = String(args[0]);
        // Sent again (a catch-up that crossed it), it is the one already standing.
        if (!Object.hasOwn(WEAPONS, weapon) || this.ctx.weapons.owned.has(weapon as WeaponId) || this.standing.has(weapon)) return;
        this.standing.add(weapon);
        // This player's own copy of the rack. Walking over it takes it for the team.
        host.rack(weapon as WeaponId, args[1] as Parameters<GameHost['rack']>[1], () => this.send({ t: 'mission', op: 'took', args: [weapon] }));
        return;
      }
      case 'cutscene':
        host.cutscene(String(args[0]), args[1] as Parameters<GameHost['cutscene']>[1], noop, Math.max(0, Number(args[2]) || 0));
        return;
      case 'ride':
        // A ride already being flown (a catch-up that crossed its start) is the one.
        if (!host.riding) host.ride(args[0] as Parameters<GameHost['ride']>[0], args[1] as Parameters<GameHost['ride']>[1], noop, args[2] === true);
        return;
      case 'sortie':
        if (!host.riding) host.sortie(args[0] as Parameters<GameHost['sortie']>[0], noop);
        return;
      case 'call': {
        const name = String(args[0]);
        const rule = CALLS[name];
        if (rule && rule.class !== 'host') host.call(name, args[1] === null || args[1] === undefined ? undefined : String(args[1]));
        return;
      }
      case 'cue': host.show(String(args[0]), args.slice(1)); return;
      case 'saved': host.saved(args[0] as Beat); return;
      case 'finished': {
        const r = args[0] as Partial<MissionResult> | null;
        if (r) this.result = { title: String(r.title ?? '').slice(0, 60), seconds: Number(r.seconds) || 0, deaths: Number(r.deaths) || 0, vehicles: Number(r.vehicles) || 0, unlocked: false };
        return;
      }
      default:
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Every frame
  // ---------------------------------------------------------------------------------------------

  update(): void {
    const campaign = this.campaign;
    if (!campaign) return;
    this.countRegroup();
    if (this.session.hosting) this.updateHost(campaign);
    else this.updateGuest(campaign);
  }

  private updateHost(campaign: Campaign): void {
    if (this.restarted) {
      // The run is rebuilt: everyone is on their feet for the checkpoint, and the friends' name tags are put back.
      this.restarted = false;
      this.team.respawnAll();
      this.retag();
    }
    const beat = campaign.runner.beat;
    const title = beat?.title ?? '';
    if (title !== this.beatTitle) {
      this.beatTitle = title;
      this.send({ t: 'mission', op: 'beat', args: [title] });
    }
    if (beat !== this.lastBeat) {
      // The team has moved on to the next section: whoever is not there is given a moment, then brought up.
      const arrival = this.arrival();
      this.lastBeat = beat;
      if (arrival) this.regroupOn(arrival.id, REGROUP_SECONDS, arrival.zone);
    }
    if (this.film) this.tally();
    for (const id of this.reported.keys()) if (!this.session.lobby.players.some(p => p.id === id)) this.reported.delete(id);
  }

  private updateGuest(campaign: Campaign): void {
    campaign.ui.beat(this.beatTitle);
    const now = performance.now();
    if (this.counted.length === 0 || now < this.nextRounds) return;
    this.nextRounds = now + ROUNDS_MS;
    const { weapons } = this.ctx;
    for (const weapon of this.counted) {
      const ammo = weapons.owned.has(weapon) ? weapons.ammo(weapon) : null;
      const n = ammo ? ammo.mag + ammo.reserve : -1;
      if (this.told.get(`rounds:${weapon}`) === n) continue;
      this.told.set(`rounds:${weapon}`, n);
      this.send({ t: 'mission', op: 'rounds', args: [weapon, n] });
    }
  }

  /** A rebuilt run has cleared the HUD's world markers: the friends' name tags go back on. */
  private retag(): void {
    for (const remote of this.session.remotes.values()) remote.retag();
  }

  dispose(): void {
    for (const off of this.off) off();
    this.off.length = 0;
    const film = this.campaign?.host.film;
    if (film) film.askSkip = null;
  }
}
