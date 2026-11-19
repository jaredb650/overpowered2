/**
 * Co-op: where each thing a mission can do happens. The host's browser runs the mission (runner.ts); net/mission.ts carries it to the
 * guests by these tables. Plain data, like the rest of the mission: no three.js, nothing that needs a running game.
 *
 * Every operation is in exactly one class:
 *   mirrored   the host does it and every guest plays the same on its own (inert) mission host, at once
 *   shared     mirrored, and it is also state: the host keeps the latest, so a late joiner, a reconnecting player and a team coming
 *              back to a checkpoint all get it
 *   host       the host's alone, by design: `why` says how it reaches the guests anyway
 *
 * `coop.test.ts` fails when a host operation, a `call` name or a trigger's event is added without a row here.
 */
import type { GameEvents } from '../core/contracts';
import type { WeaponId } from '../core/gameplay';
import type { Mission, MissionHost, Script, Step, Trigger } from './types';

export type OpClass = 'mirrored' | 'shared' | 'host';

export interface OpRule {
  class: OpClass;
  /** What a guest gets, in a line. For the table in docs/notes/coop.md. */
  why: string;
}

/** What a mission host can be asked beyond `MissionHost`: the set pieces' own looks (host.ts, `cue`). */
export type HostOp = keyof MissionHost | 'cue';

const mirrored = (why: string): OpRule => ({ class: 'mirrored', why });
const shared = (why: string): OpRule => ({ class: 'shared', why });
const host = (why: string): OpRule => ({ class: 'host', why });

/** Every operation of the mission host. `satisfies` makes a new `MissionHost` method a compile error until it has a row. */
export const OPS = {
  playerAt: host('The runner\'s own feet. Zones read `crowd`, which is every living player'),
  crowd: host('Every living player\'s feet, read on the host from the pose lane'),
  listen: host('The host\'s own events, plus every guest\'s player actions, forwarded (`EVENTS`)'),
  speak: mirrored('The line: its box, its portrait and its voice, as the host\'s radio starts it'),
  hush: mirrored('The radio cut off'),
  objectives: shared('The whole list, with its world markers'),
  hint: mirrored('A teaching prompt, with each player\'s own keys'),
  banner: mirrored('A banner across the screen'),
  door: shared('Each door as it last moved; a closing door regroups the team'),
  squad: host('Enemies are the host\'s world: guests get them in the enemy snapshot'),
  release: host('Enemy orders: the host\'s AI'),
  sweep: host('The host withdraws them; they leave the snapshot, and the vehicles their own lane'),
  drill: host('Enemy orders: the host\'s AI'),
  place: mirrored('Everyone to the mark, a step apart'),
  vehicle: host('The host\'s vehicles, drawn on guests by the vehicles lane (net/world/vehicles.ts)'),
  boss: host('An enemy: the snapshot'),
  health: host('A question about an enemy'),
  rounds: host('A question: the lowest count among the players who own the gun (guests report theirs)'),
  give: shared('A gun handed to every player; part of the kit a late joiner gets'),
  grenades: shared('Grenades handed to every player; part of the kit'),
  rack: shared('A gun on the map: the first player to reach it takes it for the team, and everyone is issued one'),
  drop: shared('A pickup on every screen (each player\'s own); a late joiner gets those since the checkpoint'),
  cutscene: shared('The film on every screen in step; a skip is by vote; a late joiner comes in part way'),
  ride: shared('Everyone rides their own copy of the same flight; it ends for all when the host\'s does'),
  sortie: shared('Everyone gets a gunship seat over the same mark; it ends for all when the host\'s does'),
  frame: mirrored('The stand-in the game has today: its banner, and the eject\'s landing mark for everyone'),
  roster: host('The squad is the host\'s allies: drawn on guests by the allies lane'),
  callins: shared('The sky shut or open for every player'),
  battle: host('Allies and enemies: the allies lane and the snapshot'),
  stop: host('As `battle`'),
  adapt: host('The Commander\'s box between rounds: the villain\'s own mirror (the enemy-attacks lane) carries it'),
  field: host('Enemy doctrine: the host\'s AI'),
  threat: host('How hard the enemy hits: the host\'s AI'),
  music: shared('The music state'),
  call: mirrored('By name: see `CALLS`'),
  deploy: shared('The mark and the kit: each player lands a step apart with their own starter gun'),
  saved: mirrored('The "Checkpoint" notice; everyone down or dead gets up'),
  finished: mirrored('The mission is won on every screen, with its result for the team board'),
  cue: mirrored('A set piece\'s look: see `CUES`'),
} as const satisfies Record<HostOp, OpRule>;

/** The few things a mission does that are nobody's system (`call` steps, host.ts). Retraining's own (`tut.*`) are single player only. */
export const CALLS: Readonly<Record<string, OpRule>> = {
  lights: shared('The blackout grade and its sound'),
  crash: mirrored('The curtain, the shake and the ring in the ears'),
  shatter: mirrored('The glass going'),
  comeAbout: shared('The circling ride turns for its route, on every player\'s copy'),
  mark: host('A kill mark on a host vehicle: the vehicles lane draws vehicles, not their marks'),
  quiet: mirrored('The Commander\'s box closed'),
  commanderToRoof: host('An enemy\'s order'),
  crew: host('An enemy on a mounted gun: the host\'s war'),
  charge: host('An ally\'s job: the host\'s war. Its countdown label is a `cue`'),
  watch: host('The host watches its own walls; the breach reaches guests as a signal\'s consequences'),
  wound: host('An ally shot: the host\'s allies. The round\'s tracer and report are a `cue`'),
  lose: host('As `wound`'),
  courier: shared('The courier\'s flight and the flak round it, on every screen'),
  wreck: shared('The smoke over the wreck'),
  chip: shared('A brain chip fitted for the mission, for every player'),
};

/** A set piece's look on a guest (`GameHost.show`). The host has already drawn its own. */
export const CUES: Readonly<Record<string, string>> = {
  alight: 'The ride or the sortie is over on the host: anyone still in a seat is out of it',
  filmEnd: 'The film is over on the host (run out, or skipped by vote): it ends here too',
  votes: 'How many have voted to skip the film, on the film\'s bar',
  callout: 'A call-out of the war, on the comms feed',
  charge: 'The breaching charge\'s countdown over the man setting it',
  sniped: 'A sniper\'s round into one of the squad: its tracer and report',
  frame: 'The Frame\'s stand-in banner',
};

/**
 * Events a trigger may wait on. `player`: something a player does, so any player doing it counts (a guest's is forwarded to the host).
 * `world`: something that happens in the host's world, heard on the host's own bus.
 */
export const EVENTS: Partial<Record<keyof GameEvents, 'player' | 'world'>> = {
  'weapon:fired': 'player',
  'weapon:unlocked': 'player',
  'weapon:switched': 'player',
  'weapon:reload': 'player',
  'stim:inject': 'player',
  'player:slam': 'player',
  'player:dashed': 'player',
  'player:jumped': 'player',
  'player:wallrun': 'player',
  'player:slide': 'player',
  'player:mantle': 'player',
  'sonar:ping': 'player',
  'chip:kata': 'player',
  'callin:used': 'player',
  'prisoner:questioned': 'player',
  'commander:done': 'world',
  'enemy:surrendered': 'world',
  'enemy:killed': 'world',
  'vehicle:destroyed': 'world',
};

/** How each kind of trigger counts players in co-op. For the table in docs/notes/coop.md. */
export const TRIGGERS: Readonly<Record<string, string>> = {
  zone: 'Any living player inside',
  'zone outside': 'Every living player has left',
  'zone that ends a beat': 'Any living player; the others get REGROUP_SECONDS to follow, then are moved up beside them',
  after: 'The host\'s mission clock',
  kills: 'Kills by anyone: the host\'s world counts them',
  cleared: 'The host\'s books',
  left: 'The host\'s books',
  below: 'The host\'s enemy',
  signal: 'The host\'s signals; `took:<weapon>` is raised by any player taking the rack',
  event: 'A player\'s action: any player. A world event: the host\'s (`EVENTS`)',
  ammo: 'The player worst off among those who own the gun',
};

/** Seconds a player has to follow the team into the next section before being moved up. */
export const REGROUP_SECONDS = 10;
/** Seconds before a player far from a closing door is moved to it. */
export const DOOR_SECONDS = 5;
/** Metres from the leader past which a player is a straggler. */
export const REGROUP_METRES = 30;

// -------------------------------------------------------------------------------------------------
// Reading a mission
// -------------------------------------------------------------------------------------------------

function eachTrigger(trigger: Trigger | undefined, visit: (t: Trigger) => void): void {
  if (!trigger) return;
  visit(trigger);
  if ('not' in trigger) eachTrigger(trigger.not, visit);
  else if ('all' in trigger) for (const t of trigger.all) eachTrigger(t, visit);
  else if ('any' in trigger) for (const t of trigger.any) eachTrigger(t, visit);
}

function eachScriptTrigger(steps: Script | undefined, visit: (t: Trigger) => void): void {
  for (const step of steps ?? []) if (step.do === 'until') eachTrigger(step.when, visit);
}

/** Every trigger a mission can arm, nested ones included. */
export function triggers(mission: Mission, visit: (t: Trigger) => void): void {
  for (const beat of mission.beats) {
    eachTrigger(beat.until, visit);
    eachScriptTrigger(beat.start, visit);
    for (const cue of beat.cues ?? []) {
      eachTrigger(cue.when, visit);
      eachScriptTrigger(cue.run, visit);
    }
  }
}

/** Every step a mission can run. */
export function steps(mission: Mission, visit: (s: Step) => void): void {
  for (const beat of mission.beats) {
    for (const s of beat.start ?? []) visit(s);
    for (const cue of beat.cues ?? []) for (const s of cue.run) visit(s);
  }
}

export interface EventWatch {
  event: keyof GameEvents;
  where: Readonly<Record<string, string | number | boolean>> | null;
}

/** The player actions this mission waits on: what a guest has to tell the host about. */
export function playerEvents(mission: Mission): EventWatch[] {
  const out: EventWatch[] = [];
  triggers(mission, t => {
    if (!('event' in t) || EVENTS[t.event] !== 'player') return;
    const where = t.where ?? null;
    if (!out.some(w => w.event === t.event && JSON.stringify(w.where) === JSON.stringify(where))) out.push({ event: t.event, where });
  });
  return out;
}

/** The guns this mission counts rounds for (`ammo` triggers): what a guest reports. */
export function countedGuns(mission: Mission): WeaponId[] {
  const out: WeaponId[] = [];
  triggers(mission, t => {
    if ('ammo' in t && !out.includes(t.ammo)) out.push(t.ammo);
  });
  return out;
}

/** Zones that end a beat when someone walks into them: the team regroups there. Zones under a `not` or an `outside` are not arrivals. */
export function arrivalZones(mission: Mission): string[] {
  const out: string[] = [];
  const read = (t: Trigger | undefined): void => {
    if (!t) return;
    if ('zone' in t) {
      if (!t.outside && !out.includes(t.zone)) out.push(t.zone);
    } else if ('all' in t) t.all.forEach(read);
    else if ('any' in t) t.any.forEach(read);
  };
  for (const beat of mission.beats) read(beat.until);
  return out;
}

/** The fields of an event a `where` can compare, small enough to send. */
export function plainFields(payload: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!payload || typeof payload !== 'object') return out;
  let n = 0;
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (n >= 8) break;
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= 40)) {
      out[key] = value;
      n++;
    }
  }
  return out;
}

export function matches(payload: unknown, where: Readonly<Record<string, string | number | boolean>> | null): boolean {
  if (!where) return true;
  const fields = (payload ?? {}) as Record<string, unknown>;
  for (const key in where) if (fields[key] !== where[key]) return false;
  return true;
}
