/**
 * What a mission is made of. All of it is plain data: no three.js, no DOM, nothing that needs a running game, so a mission can be
 * read, checked and played by a test. docs/campaign/MISSION.md is the plan these rows carry out.
 *
 * Coordinates are the map's: x east, y up, z south. A yaw of 0 looks north, along -z, as `player.teleport` takes it.
 */
import type { GameEvents, MusicState, WorldMaterialName } from '../core/contracts';
import type { CallInId, EnemyId, PickupKind, WeaponId } from '../core/gameplay';
import type { AdaptationId } from '../enemies/commander/adaptations';
import type { Line } from '../enemies/commander/lines';
import type { ActionId } from '../enemies/outpost/planner';
import type { Rank } from '../enemies/outpost/rank';

export type Vec3 = readonly [x: number, y: number, z: number];

export interface Mark {
  at: Vec3;
  yaw?: number;
  /** On a route: seconds to hover or wait here. */
  hold?: number;
  /** On a ride: the aircraft takes a hit here, and flies the rest of the way on fire. */
  hit?: boolean;
}

/** A box the player can be in. */
export interface Zone {
  min: Vec3;
  max: Vec3;
}

export type DoorKind = 'shutter' | 'slide' | 'split';

/** Something that shuts. `open` is always a share: 1 is fully open, 0 shut, and anything between is a leaf stopped part way. */
export interface DoorDef {
  /** Middle of the opening, on the floor. */
  at: Vec3;
  /** Direction of travel through it, in radians. */
  yaw: number;
  width: number;
  height: number;
  /** A shutter drops from the lintel, a slide runs sideways, a split parts in the middle. */
  kind: DoorKind;
  /** Seconds from fully open to fully shut, unless a step says otherwise. */
  seconds: number;
  /** How open it stands when the mission starts. */
  start: number;
  /** What the leaf is made of. Hazard paint unless it says otherwise. */
  look?: WorldMaterialName;
}

/** How a squad behaves when it arrives. Everyone drops what they were told the moment they are shot at. */
export type SquadOrders =
  /** Goes to find the player. */
  | 'hunt'
  /** Stays on its mark until `release`, or until it is shot at or the player gets close. */
  | 'hold'
  /** A held breath: holds through being seen and walked past, and only a bullet or a man at arm's length breaks it before `release`. */
  | 'ambush';

export type VehicleKind = 'humvee' | 'truck' | 'tank' | 'chopper';

/** Everything a mission must have on the player at a checkpoint, however they got there, so a restart can never strand them without the gun the next fight needs. */
export interface Loadout {
  /** In hand order. The first is drawn. */
  weapons: readonly WeaponId[];
  grenades: number;
}

export interface Checkpoint {
  /** A mark. */
  at: string;
  loadout: Loadout;
}

/** One camera move. The camera eases from the first pair to the second over `seconds`, and cuts to the next shot unless it fades. */
export interface Shot {
  from: Vec3;
  to: Vec3;
  lookFrom: Vec3;
  lookTo: Vec3;
  seconds: number;
  /** Vertical field of view. A long lens flattens a compound; a wide one sells a drop. */
  fov?: number;
  /** Seconds up from black at the start of the shot, and down to it at the end. */
  fadeIn?: number;
  fadeOut?: number;
  /** Words on the film, low on the left: a place, a form number. */
  caption?: string;
}

export interface Cutscene {
  shots: readonly Shot[];
  /** Somebody to look at, standing here for as long as the film runs. */
  figure?: Mark;
  /** The picture stays down when it ends, for a film the mission does not come back from. */
  endsBlack?: boolean;
}

// -------------------------------------------------------------------------------------------------
// Triggers: what the mission is waiting for. Every clock and count starts when the trigger is armed.
// -------------------------------------------------------------------------------------------------

export type Trigger =
  /** The player is in this zone, or with `outside`, is not. */
  | { zone: string; outside?: boolean }
  /** Seconds of mission time. */
  | { after: number }
  /** Kills by anyone. `tag` narrows to men and vehicles spawned under it, `by` to damage sources starting with this. */
  | { kills: number; tag?: string; by?: string }
  /** Everything spawned under this tag is gone: dead, fled or given up, with nobody still on their way in. */
  | { cleared: string | readonly string[] }
  /** At most this many left under the tag, with something spawned. */
  | { left: number; tag: string }
  /** The tag's first living body has this share of its health or less. For bosses. */
  | { below: number; tag: string }
  /** A signal: from a `signal` step, or `campaign.signal(name)` from any system. */
  | { signal: string }
  /** A game event. `where` compares fields of the payload. */
  | { event: keyof GameEvents; where?: Readonly<Record<string, string | number | boolean>> }
  /** The player owns this weapon and has fewer than this many rounds for it. What stops an armour fight running out of rockets. */
  | { ammo: WeaponId; under: number }
  | { all: readonly Trigger[] }
  | { any: readonly Trigger[] };

// -------------------------------------------------------------------------------------------------
// Steps: what the mission does. A script runs its steps in order, and only a waiting step holds it up.
// -------------------------------------------------------------------------------------------------

export type Step =
  /**
   * Queues a line on the radio, where lines are said one at a time, in turn. Heard once per mission, so a restart does not repeat a
   * speech, unless `again` is set. A line counts as heard once it starts: one still waiting when the player dies is said after the
   * restart. `wait` holds the script until it has been said.
   *
   * `now` is an order that cannot wait, given as a door shuts: the line on the radio is cut off, anything still waiting is dropped, and
   * this is said at once. `within` drops the line unsaid if it has not started this many seconds after it was asked for, for a reaction
   * that would rather not be heard than be heard late.
   */
  | { do: 'say'; line: string; wait?: boolean; again?: boolean; now?: boolean; within?: number }
  /** Puts an objective on the HUD. `at` is a mark for a world marker. */
  | { do: 'objective'; id: string; text: string; at?: string }
  /** Ticks one off. */
  | { do: 'done'; id: string }
  /** A teaching prompt. `{jump}` and the like become the player's own key. */
  | { do: 'hint'; text: string; seconds?: number }
  | { do: 'banner'; text: string; sub?: string }
  /** `open` is a share of fully open. `wait` holds the script until it stops moving. */
  | { do: 'door'; door: string; open: number; seconds?: number; wait?: boolean }
  /** `light` men go without carrier or helmet, so a shaped charge's splash takes them as written: what the armour lesson needs behind the plate. */
  | { do: 'squad'; tag: string; men: readonly EnemyId[]; at: string; orders?: SquadOrders; ensure?: boolean; light?: boolean }
  /** Lets a holding squad go. */
  | { do: 'release'; tag: string }
  /** Takes everyone still on the map off it, or everyone under a tag, unseen and unscored: the fight has moved on and they cannot follow. */
  | { do: 'sweep'; tag?: string }
  /**
   * What the Commander said he would do, done: his men under this tag are told to run the drill, and `line` is said only if one of their
   * squads really can. He must not be heard ordering something that does not then happen.
   */
  | { do: 'drill'; tag: string; drill: ActionId; line?: string }
  /** Puts the player on a mark. For the rare player fast enough to get somewhere the story says they cannot be. */
  | { do: 'place'; at: string }
  /**
   * `route` is what it drives or flies. `crew` get out at the end of it, under `crewTag`, or the vehicle's tag if unset. `holds` is a
   * mark it stays on once there. On this and `squad`, `ensure` only spawns if the tag has nothing on the books, which is how a beat
   * says "these should be here by now" and still has them after a restart. `state` is scenery and goes on nobody's books: `parked` has
   * nobody in it, and `wrecked` is one that died before this beat, which a restart has to put back.
   */
  | { do: 'vehicle'; tag: string; kind: VehicleKind; at: string; route?: string; crew?: readonly EnemyId[]; crewTag?: string; holds?: string; ensure?: boolean; state?: 'parked' | 'wrecked' }
  /** The Commander, in person. */
  | { do: 'boss'; tag: string; at: string }
  /** Hands over a weapon on the spot. */
  | { do: 'give'; weapon: WeaponId }
  | { do: 'grenades'; count: number }
  /** A weapon lying on the map, to be walked over. Raises `took:<weapon>`. `optional` is off the path: no checkpoint has to promise it. */
  | { do: 'rack'; weapon: WeaponId; at: string; optional?: boolean }
  | { do: 'drop'; item: PickupKind; at: string }
  | { do: 'wait'; seconds: number }
  | { do: 'until'; when: Trigger }
  | { do: 'signal'; name: string }
  /** Holds the script until the shots run out or the player skips. A skip clears the radio queue. */
  | { do: 'cutscene'; id: string }
  /** Into a gunner's seat, holding the script until the player is back in their body. `route` is a flight path, and a ride raises `ride:<mark>` as it reaches each one. */
  | { do: 'ride'; seat: CallInId; route?: string }
  /** The Commander answers the way the player has been fighting: the box between rounds, with the next answer fielded. */
  | { do: 'adapt' }
  /** One particular answer, for a fight built round it. */
  | { do: 'field'; answer: AdaptationId }
  /** How hard the humans hit, as the wave number they would have on the endless contract. `grade` fixes the rank of squads formed from here on. */
  | { do: 'threat'; level: number; grade?: Rank }
  | { do: 'music'; state: MusicState }
  /** Anything else: a system registers `name` with `campaign.provide({ call })`. */
  | { do: 'call'; name: string; arg?: string }
  | { do: 'goto'; beat: string }
  /** The mission is won, once the radio has finished what it is saying. */
  | { do: 'finish' };

export type Script = readonly Step[];

/** A reaction while its beat lasts. Fires once, or with `repeat` whenever its trigger comes true again. */
export interface Cue {
  when: Trigger;
  run: Script;
  repeat?: boolean;
}

export interface Beat {
  id: string;
  title: string;
  /** Saves as the beat opens. A death comes back to the last one saved, with the beat played again from its top. */
  checkpoint?: Checkpoint;
  start?: Script;
  cues?: readonly Cue[];
  /** Ends the beat and opens the next row. Without one, only a `goto` or `finish` step leaves it. */
  until?: Trigger;
  /** Said after a restart here, in turn, in place of the mission's own: for a beat where some of those voices no longer fit. */
  redeployLines?: readonly string[];
}

export interface Mission {
  id: string;
  title: string;
  /** Beating it from the top opens what is shut until the campaign is beaten. */
  unlocks?: boolean;
  /** What the player holds at the start. */
  loadout: Loadout;
  zones: Readonly<Record<string, Zone>>;
  marks: Readonly<Record<string, Mark>>;
  /** Marks in order, for anything that drives or flies. */
  routes: Readonly<Record<string, readonly string[]>>;
  doors: Readonly<Record<string, DoorDef>>;
  cutscenes: Readonly<Record<string, Cutscene>>;
  lines: readonly Line[];
  /** Said after a restart, in turn. */
  redeployLines: readonly string[];
  beats: readonly Beat[];
}

// -------------------------------------------------------------------------------------------------
// The runner's view of the game. MissionRunner touches nothing else, which is how a test can play a mission.
// -------------------------------------------------------------------------------------------------

export interface ObjectiveState {
  id: string;
  text: string;
  at: Mark | null;
  done: boolean;
}

export type SquadOrder = Extract<Step, { do: 'squad' }>;
export type VehicleOrder = Extract<Step, { do: 'vehicle' }>;

/** Every body that counts under a tag has to end with one `unitGone`, or `cleared` waits for ever. */
export interface MissionHost {
  /** Writes the player's feet into `out`. */
  playerAt(out: { x: number; y: number; z: number }): void;
  /** Calls `fn` for each `name` until the returned function runs. */
  listen(name: keyof GameEvents, fn: (payload: unknown) => void): () => void;

  /** Starts `line` and calls `done` when it has been said and the breath after it taken. The next line may be spoken from inside `done`. */
  speak(line: Line, done: () => void): void;
  /** Stops what is being said. */
  hush(): void;
  objectives(list: readonly ObjectiveState[]): void;
  hint(text: string, seconds: number): void;
  banner(text: string, sub?: string): void;

  /** `seconds` of 0 puts it there at once. Calls `done` when it has stopped. */
  door(id: string, def: DoorDef, open: number, seconds: number, done: () => void): void;
  /** Sends these men to the map. The runner has already counted them. */
  squad(order: SquadOrder, at: Mark): void;
  release(tag: string): void;
  /** Each body taken off still ends in `unitGone`. */
  sweep(tag?: string): void;
  /** True if a squad under the tag took the order. */
  drill(tag: string, drill: ActionId): boolean;
  place(at: Mark): void;
  /** One body for the vehicle's tag, plus one per man of crew under the crew's. */
  vehicle(order: VehicleOrder, at: Mark, route: readonly Mark[]): void;
  boss(tag: string, at: Mark): void;
  /** Share of health of the tag's first living body, or 1 when none has arrived. */
  health(tag: string): number;
  /** Rounds left for a weapon the player owns. Infinity for one they do not, so nothing is short of a gun nobody has found. */
  rounds(weapon: WeaponId): number;

  give(weapon: WeaponId): void;
  grenades(count: number): void;
  rack(weapon: WeaponId, at: Mark, took: () => void): void;
  drop(item: PickupKind, at: Mark): void;
  /** `skipped` says the player pressed through it. */
  cutscene(id: string, scene: Cutscene, done: (skipped: boolean) => void): void;
  ride(seat: CallInId, route: readonly Mark[], done: () => void): void;
  adapt(): void;
  field(answer: AdaptationId): void;
  threat(level: number, grade?: Rank): void;
  music(state: MusicState): void;
  call(name: string, arg: string | undefined): void;

  /** The mission opened here, at the start or after a restart: place the player and hand over the kit. */
  deploy(at: Mark | null, loadout: Loadout): void;
  /** A checkpoint has just been saved in the course of play. */
  saved(beat: Beat): void;
  /** The mission is won. */
  finished(): void;
}
