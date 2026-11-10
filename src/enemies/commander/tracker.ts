/**
 * The Commander's notebook: what the player actually did, as counts. Nothing here touches the world, so a test can feed it a play
 * style and read back what it concluded.
 *
 * Two sets of books. `round` is this wave, and it is what the dialogue box quotes. `habit` is the run, fading a little each wave, so a
 * player who changes style gets answered for what they do now and not for what they did ten minutes ago.
 */
import { clamp } from '../../core/math';
import type { HabitId } from './adaptations';

/** Metres from where the player stopped that still counts as standing there. */
const STILL_RADIUS = 2.5;
/** Seconds in one spot before it counts as camping. A reload is not a habit. */
const STILL_AFTER = 2.5;
/** Metres up where the floor stops and the catwalks start. */
const HIGH_GROUND = 3;
/** Metres a second that count as running the map rather than walking it. */
const FAST = 10;
/** Metres from a door that still counts as firing from it. */
const DOOR_REACH = 3.5;
const CELL = 4;
/** What each wave's books keep of the last. */
const HABIT_FADE = 0.8;
const LONG_RANGE = 22;

export interface DoorMark {
  x: number;
  z: number;
  /** Unit travel direction through it. */
  dx: number;
  dz: number;
}

export interface Cell {
  x: number;
  y: number;
  z: number;
  visits: number;
}

export interface Tally {
  seconds: number;
  /** Seconds with somebody left to fight. */
  fightSeconds: number;
  stillSeconds: number;
  highSeconds: number;
  fastSeconds: number;
  shots: number;
  kills: number;
  headshots: number;
  limbs: number;
  executions: number;
  meleeKills: number;
  explosiveKills: number;
  damageTaken: number;
  pings: number;
  pickups: number;
  callIns: number;
  /** Men shot while going to help someone. */
  rescuersKilled: number;
  /** Times the player walked to where a voice on the radio said something was. */
  chatterFollowed: number;
  /** Men killed by their own side's fire. */
  gifts: number;
  killMetres: number;
  longestKill: number;
  doorCrossings: number;
}

const blank = (): Tally => ({
  seconds: 0, fightSeconds: 0, stillSeconds: 0, highSeconds: 0, fastSeconds: 0, shots: 0, kills: 0, headshots: 0, limbs: 0, executions: 0, meleeKills: 0,
  explosiveKills: 0, damageTaken: 0, pings: 0, pickups: 0, callIns: 0, rescuersKilled: 0, chatterFollowed: 0, gifts: 0, killMetres: 0, longestKill: 0, doorCrossings: 0,
});

/** The numbers a line can quote about the round just gone. */
export interface RoundReport extends Tally {
  wave: number;
  favouriteWeapon: string;
  favouriteShots: number;
  /** Most shots fired from within reach of one door. */
  doorShots: number;
  /** The room the player spent longest in. */
  room: string;
  roomShare: number;
  /** What hit the player that the Commander put there, worst first. */
  trapHits: readonly { cause: string; hits: number; damage: number }[];
  /** Named men who died this round. */
  fallen: readonly string[];
}

const EXPLOSIVE = /^(rocket|grenade|autocannon)/;
const MELEE = /^(sword|melee|knife|crowbar|shovel|baton)/;

export class StyleTracker {
  round: Tally = blank();
  /** The run's habits, fading. */
  readonly habit: Tally = blank();
  /** Waves finished, which is what call-ins are counted against. */
  waves = 0;

  private doors: readonly DoorMark[] = [];
  private doorSide = new Int8Array(0);
  private doorHits = new Float32Array(0);
  private doorFire = new Float32Array(0);
  private readonly cells = new Map<number, Cell>();
  private cellKey = NaN;
  private stillX = NaN;
  private stillZ = NaN;
  private stillFor = 0;
  /** Where the player last stayed put longest, for anything that wants to aim at it. */
  campX = NaN;
  campY = 0;
  campZ = NaN;
  private bestCamp = 0;

  private readonly shotsBy = new Map<string, number>();
  private readonly killsBy = new Map<string, number>();
  private readonly rooms = new Map<string, number>();
  private readonly traps = new Map<string, { cause: string; hits: number; damage: number }>();
  private fallen: string[] = [];

  /** The map's doors. Kept across runs, because a door does not move. */
  setDoors(doors: readonly DoorMark[]): void {
    this.doors = doors;
    this.doorSide = new Int8Array(doors.length);
    this.doorHits = new Float32Array(doors.length);
    this.doorFire = new Float32Array(doors.length);
  }

  reset(): void {
    this.round = blank();
    Object.assign(this.habit, blank());
    this.waves = 0;
    this.doorSide.fill(0);
    this.doorHits.fill(0);
    this.doorFire.fill(0);
    this.cells.clear();
    this.cellKey = NaN;
    this.stillX = this.stillZ = this.campX = this.campZ = NaN;
    this.stillFor = this.bestCamp = 0;
    this.campY = 0;
    this.clearRound();
  }

  private clearRound(): void {
    this.shotsBy.clear();
    this.killsBy.clear();
    this.rooms.clear();
    this.traps.clear();
    this.fallen = [];
    this.doorFire.fill(0);
  }

  /** One look at the player, every `dt` seconds. */
  sample(dt: number, x: number, y: number, z: number, speed: number, fighting: boolean, room: string | null): void {
    const r = this.round;
    r.seconds += dt;
    if (fighting) r.fightSeconds += dt;
    if (room) this.rooms.set(room, (this.rooms.get(room) ?? 0) + dt);
    if (speed > FAST) r.fastSeconds += dt;
    if (y > HIGH_GROUND) r.highSeconds += dt;

    if (Number.isNaN(this.stillX) || Math.hypot(x - this.stillX, z - this.stillZ) > STILL_RADIUS) {
      this.stillX = x;
      this.stillZ = z;
      this.stillFor = 0;
    } else {
      this.stillFor += dt;
      if (this.stillFor >= STILL_AFTER && fighting) r.stillSeconds += dt;
      if (this.stillFor > this.bestCamp) {
        this.bestCamp = this.stillFor;
        this.campX = x;
        this.campY = y;
        this.campZ = z;
      }
    }
    this.trackDoors(x, z);
    this.trackCell(x, y, z);
  }

  private trackDoors(x: number, z: number): void {
    for (let i = 0; i < this.doors.length; i++) {
      const d = this.doors[i]!;
      const along = (x - d.x) * d.dx + (z - d.z) * d.dz;
      const across = Math.abs((x - d.x) * d.dz - (z - d.z) * d.dx);
      const side = along > 0 ? 1 : -1;
      // Only a crossing near the door itself: walking round the outside of a building flips the sign too.
      if (this.doorSide[i] !== 0 && side !== this.doorSide[i] && across < DOOR_REACH && Math.abs(along) < DOOR_REACH * 2) {
        this.doorHits[i]!++;
        this.round.doorCrossings++;
      }
      this.doorSide[i] = side;
    }
  }

  private trackCell(x: number, y: number, z: number): void {
    const key = Math.floor(x / CELL) * 4096 + Math.floor(z / CELL);
    if (key === this.cellKey) return;
    this.cellKey = key;
    const c = this.cells.get(key);
    if (c) {
      c.visits++;
      return;
    }
    this.cells.set(key, { x, y, z, visits: 1 });
  }

  shot(weapon: string, x: number, z: number): void {
    this.round.shots++;
    this.shotsBy.set(weapon, (this.shotsBy.get(weapon) ?? 0) + 1);
    for (let i = 0; i < this.doors.length; i++) {
      const d = this.doors[i]!;
      if (Math.hypot(x - d.x, z - d.z) < DOOR_REACH) this.doorFire[i]!++;
    }
  }

  kill(source: string, distance: number, headshot: boolean): void {
    const r = this.round;
    r.kills++;
    r.killMetres += distance;
    if (distance > r.longestKill) r.longestKill = distance;
    if (headshot) r.headshots++;
    if (MELEE.test(source)) r.meleeKills++;
    if (EXPLOSIVE.test(source)) r.explosiveKills++;
    const name = source.startsWith('sword') ? 'sword' : source;
    this.killsBy.set(name, (this.killsBy.get(name) ?? 0) + 1);
  }

  /** The player was hurt by something the Commander put there. */
  trapped(cause: string, damage: number): void {
    const t = this.traps.get(cause);
    if (t) {
      t.hits++;
      t.damage += damage;
    } else this.traps.set(cause, { cause, hits: 1, damage });
  }

  named(name: string): void {
    this.fallen.push(name);
  }

  /** The doors the player goes through most, busiest first. Indexes into `setDoors`. */
  hotDoors(limit: number): number[] {
    const order: number[] = [];
    for (let i = 0; i < this.doors.length; i++) if (this.doorHits[i]! > 0) order.push(i);
    order.sort((a, b) => this.doorHits[b]! - this.doorHits[a]!);
    return order.slice(0, limit);
  }

  hotCells(limit: number): Cell[] {
    return [...this.cells.values()].sort((a, b) => b.visits - a.visits).slice(0, limit);
  }

  /** Closes the wave's books and hands back what happened in it. */
  closeRound(wave: number): RoundReport {
    const r = this.round;
    let favouriteWeapon = '';
    let favouriteShots = 0;
    for (const [weapon, shots] of this.shotsBy) {
      if (shots > favouriteShots) {
        favouriteShots = shots;
        favouriteWeapon = weapon;
      }
    }
    let doorShots = 0;
    for (let i = 0; i < this.doorFire.length; i++) doorShots = Math.max(doorShots, this.doorFire[i]!);
    let room = '';
    let roomTime = 0;
    let allTime = 0;
    for (const [name, seconds] of this.rooms) {
      allTime += seconds;
      if (seconds > roomTime) {
        roomTime = seconds;
        room = name;
      }
    }
    const report: RoundReport = {
      ...r, wave, favouriteWeapon, favouriteShots, doorShots, room, roomShare: allTime > 0 ? roomTime / allTime : 0,
      trapHits: [...this.traps.values()].sort((a, b) => b.damage - a.damage),
      fallen: this.fallen,
    };
    const h = this.habit;
    for (const key of Object.keys(h) as (keyof Tally)[]) h[key] = h[key] * HABIT_FADE + r[key];
    this.waves = this.waves * HABIT_FADE + 1;
    this.round = blank();
    this.clearRound();
    return report;
  }

  /** How strongly the player leans on each habit, 0 to 1. Reads this wave's books as well, so a mid-wave look is honest. */
  habits(): Record<HabitId, number> {
    const a = this.habit;
    const b = this.round;
    const sum = (k: keyof Tally): number => a[k] + b[k];
    const minutes = Math.max(sum('seconds') / 60, 0.5);
    const fight = Math.max(sum('fightSeconds'), 1);
    const kills = Math.max(sum('kills'), 1);
    const crossings = sum('doorCrossings');
    const hot = this.hotDoors(2);
    let onHot = 0;
    for (const i of hot) onHot += this.doorHits[i]!;
    const repeat = crossings > 0 ? onHot / Math.max(this.totalDoorHits(), 1) : 0;
    const meanRange = sum('killMetres') / kills;
    return {
      camping: clamp(sum('stillSeconds') / fight / 0.45),
      sonar: clamp(sum('pings') / minutes / 4),
      routes: clamp(repeat * clamp(crossings / 8)),
      pickups: clamp(sum('pickups') / minutes / 3),
      explosives: clamp(sum('explosiveKills') / kills / 0.5),
      melee: clamp(sum('meleeKills') / kills / 0.4),
      speed: clamp(sum('fastSeconds') / fight / 0.4),
      highGround: clamp(sum('highSeconds') / fight / 0.4),
      callIns: clamp(sum('callIns') / Math.max(this.waves, 1) / 0.75),
      headshots: clamp(sum('headshots') / kills / 0.4),
      executions: clamp(sum('executions') / 2),
      baiting: clamp(sum('rescuersKilled') / 3),
      chatter: clamp(sum('chatterFollowed') / 3),
      range: clamp((meanRange - LONG_RANGE * 0.6) / LONG_RANGE),
    };
  }

  private totalDoorHits(): number {
    let n = 0;
    for (let i = 0; i < this.doorHits.length; i++) n += this.doorHits[i]!;
    return n;
  }
}
