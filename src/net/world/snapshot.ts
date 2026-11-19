/**
 * The enemy snapshot lane's bytes, version 4: what the host sends of its enemies, and how both ends read it (replicas.ts).
 *
 * The lane is unreliable and unordered: a packet arrives once or never, in any order. So the host never sends "the snapshot".
 * It sends **chunks**, each one whole on its own and small enough for one packet (`CHUNK_BYTES`): a header with the host's
 * clock, then some enemies' states. A lost chunk costs those enemies one update and nothing else waits for it.
 *
 * Chunk header, 16 bytes, little endian:
 *
 * | 0 | u16 | `SNAPSHOT_MAGIC` (the format version) |
 * | 2 | u8 | kind: 0 states, 1 roster |
 * | 3 | u8 | records (states) or uids (roster) that follow |
 * | 4 | u32 | host time, ms (the host page's clock when the states were read; wraps) |
 * | 8 | u16 | send tick (wraps) |
 * | 10 | u16 | wave |
 * | 12 | u8 | wave phase |
 * | 13 | u8 | seconds to the next wave, rounded up, at most 255 |
 * | 14 | u8 | enemies alive on the host |
 * | 15 | u8 | ms between the host's ticks as they really run (50 at 20 fps or better; more on a slow host) |
 *
 * A states chunk then carries its records. Every record has the 27 motion bytes; a **full** record (bit 0 of `bits`) has 17
 * more, the slow-changing rest. A guest can only make an enemy from a full record: the host sends one when an enemy is new,
 * for `FULL_TICKS` after anything in it changes, and at least every `KEY_EVERY` ticks.
 *
 * | 0 | u32 | uid |
 * | 4 | u8 | bits: 1 full, 2|4 tier (0 near, 1 far, 2 far and thinned), 8|16 legs it can stand on (0-2), 32 getting up, 64 aiming at its target |
 * | 5 | u8 | flags: 1 airborne, 2 downed, 4 frozen, 8 burning, 16 shield, 32 ward, 64 boss entry, 128 can be cuffed |
 * | 6 | u8 | state: 1|2 coarse animation (0 move, 1 windup, 2 attack, 3 stagger), 4|8 the slot of the player it is after |
 * | 7 | 3 x f32 | feet position |
 * | 19 | i16 | yaw, radians x 10000 |
 * | 21 | 3 x i16 | velocity, cm/s |
 * | 27 | u8 | archetype (index into `ENEMY_IDS`) |
 * | 28 | u8 | intact plates |
 * | 29 | u8 | posture (index into `POSTURES`) |
 * | 30 | u16 | severed regions |
 * | 32 | f32 | health |
 * | 36 | f32 | max health |
 * | 40 | f32 | armour |
 *
 * A roster chunk carries the uid (u32) of every living enemy: a guest withdraws a copy the roster no longer names.
 */
import type { EnemyId, WavePhase } from '../../core/gameplay';
import { UNRELIABLE_SAFE_BYTES } from '../room';
import { ENEMY_IDS, type Vec } from './wire';

export const SNAPSHOT_MAGIC = 0xc204;
/** The host's send tick, ms: near enemies go every tick (20 a second). */
export const TICK_MS = 50;
/** A far enemy goes every this many ticks (5 a second); over the byte ceiling, every `FAR_EVERY_TIGHT` (2 a second). */
export const FAR_EVERY = 4;
export const FAR_EVERY_TIGHT = 10;
/** Every enemy sends a full record at least this often, in ticks (once a second). */
export const KEY_EVERY = 20;
/** After anything in the full record changes, the next this many ticks carry it (so two sends even on the far tier). */
export const FULL_TICKS = 8;
/** The roster goes every this many ticks (twice a second). */
export const ROSTER_EVERY = 10;
/** Snapshot bytes a second to one guest above which the far tier is thinned (research 5.3's hard ceiling). */
export const CEILING_BYTES = 64_000;
/** Within this many metres of a guest, or inside the cone ahead of them out to `CONE_M`, an enemy is near. */
export const NEAR_M = 25;
export const CONE_M = 70;
/** Cosine of the cone's half angle: 60 degrees either side of where the guest looks. */
export const CONE_COS = 0.5;
/** With this few enemies left, all of them are near. */
export const LAST_FEW = 4;

export const HEADER_BYTES = 16;
export const MOTION_BYTES = 27;
export const FULL_BYTES = 44;
/**
 * The most a chunk weighs: it then crosses in one packet (WebRTC cuts anything larger into packets of about 1,200 bytes, and
 * with no resend one lost packet would lose the lot).
 */
export const CHUNK_BYTES = UNRELIABLE_SAFE_BYTES;
/** Records in one chunk at most (all motion-only: 40). */
export const CHUNK_RECORDS = Math.floor((CHUNK_BYTES - HEADER_BYTES) / MOTION_BYTES);

/** A man's posture (characters/animation/postures.ts), so a guest sees him with his hands up, cuffed, cowering or in cover. */
export const POSTURES = ['stand', 'crouch', 'cover', 'peek', 'leanLeft', 'leanRight', 'handsUp', 'kneel', 'cower', 'flee', 'drag', 'revive', 'downed',
  'hunched', 'pistol', 'cuffed', 'bound', 'fumble', 'temple'] as const;
export type PostureId = typeof POSTURES[number];
/** Flag bits. */
export const AIRBORNE = 1, DOWNED = 2, FROZEN = 4, BURNING = 8, SHIELD = 16, WARD = 32, BOSS_ENTRY = 64;
/** Flag bit: he has surrendered and can be cuffed (Endless Humans). */
export const CAPTURABLE = 128;
export const WAVE_PHASES: readonly WavePhase[] = ['intermission', 'spawning', 'clearing', 'boss'];

/** One enemy's record, as numbers. Both ends keep one and reuse it: nothing is made per enemy. */
export interface WireEnemy {
  uid: number;
  full: boolean;
  tier: number;
  legs: number;
  rising: boolean;
  aiming: boolean;
  flags: number;
  /** 0 move, 1 windup, 2 attack, 3 stagger. */
  animation: number;
  /** The slot (0-3) of the player it is after. */
  target: number;
  x: number; y: number; z: number; yaw: number; vx: number; vy: number; vz: number;
  /** Full records only. */
  id: number; plates: number; posture: number; severed: number; health: number; maxHealth: number; armor: number;
}

export const wireEnemy = (): WireEnemy => ({ uid: 0, full: false, tier: 0, legs: 2, rising: false, aiming: false, flags: 0, animation: 0, target: 0,
  x: 0, y: 0, z: 0, yaw: 0, vx: 0, vy: 0, vz: 0, id: 0, plates: 0, posture: 0, severed: 0, health: 0, maxHealth: 0, armor: 0 });

/** A chunk's header. `time` and `tick` are as sent (wrapped); replicas.ts unwraps them. */
export interface ChunkHeader {
  kind: 0 | 1;
  count: number;
  time: number;
  tick: number;
  wave: number;
  phase: number;
  nextWaveIn: number;
  alive: number;
  tickMs: number;
}

export const chunkHeader = (): ChunkHeader => ({ kind: 0, count: 0, time: 0, tick: 0, wave: 0, phase: 0, nextWaveIn: 0, alive: 0, tickMs: TICK_MS });

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
const wrapAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

/**
 * Host: builds chunks in one scratch buffer. `begin` a chunk, `add` records while `fits`, `end` gives the bytes to send (a
 * copy: the lane may hold them a while).
 */
export class ChunkWriter {
  private readonly bytes = new ArrayBuffer(CHUNK_BYTES);
  private readonly view = new DataView(this.bytes);
  private at = 0;
  private records = 0;

  begin(kind: 0 | 1, time: number, tick: number, wave: number, phase: WavePhase | undefined, nextWaveIn: number | undefined, alive: number, tickMs: number): void {
    const v = this.view;
    v.setUint16(0, SNAPSHOT_MAGIC, true);
    v.setUint8(2, kind);
    v.setUint32(4, Math.round(time) >>> 0, true);
    v.setUint16(8, tick & 0xffff, true);
    v.setUint16(10, clamp(wave, 0, 0xffff), true);
    v.setUint8(12, Math.max(0, WAVE_PHASES.indexOf(phase ?? 'intermission')));
    v.setUint8(13, clamp(Math.ceil(nextWaveIn ?? 0), 0, 255));
    v.setUint8(14, clamp(alive, 0, 255));
    v.setUint8(15, clamp(Math.round(tickMs), 1, 255));
    this.at = HEADER_BYTES;
    this.records = 0;
  }

  /** Records in the chunk being built. */
  get count(): number { return this.records; }

  /** Room for one more record of this kind (a uid, in a roster)? */
  fits(full: boolean): boolean {
    return this.records < 255 && this.at + (this.view.getUint8(2) === 1 ? 4 : full ? FULL_BYTES : MOTION_BYTES) <= CHUNK_BYTES;
  }

  add(e: WireEnemy): void {
    const v = this.view, o = this.at;
    v.setUint32(o, e.uid, true);
    v.setUint8(o + 4, (e.full ? 1 : 0) | (e.tier & 3) << 1 | (e.legs & 3) << 3 | (e.rising ? 32 : 0) | (e.aiming ? 64 : 0));
    v.setUint8(o + 5, e.flags & 255);
    v.setUint8(o + 6, (e.animation & 3) | (e.target & 3) << 2);
    // Whatever the game holds, what goes out can be read: one enemy with a broken number (a `NaN` health, a fall past the
    // edge of the world) must not cost every enemy that shares its chunk their state on every guest.
    v.setFloat32(o + 7, sane(e.x, -PLACE_MOST, PLACE_MOST), true); v.setFloat32(o + 11, sane(e.y, -PLACE_MOST, PLACE_MOST), true); v.setFloat32(o + 15, sane(e.z, -PLACE_MOST, PLACE_MOST), true);
    v.setInt16(o + 19, Math.round(wrapAngle(e.yaw) * 10000), true);
    v.setInt16(o + 21, Math.round(clamp(e.vx, -327, 327) * 100), true);
    v.setInt16(o + 23, Math.round(clamp(e.vy, -327, 327) * 100), true);
    v.setInt16(o + 25, Math.round(clamp(e.vz, -327, 327) * 100), true);
    if (e.full) {
      v.setUint8(o + 27, e.id);
      v.setUint8(o + 28, e.plates & 255);
      v.setUint8(o + 29, e.posture);
      v.setUint16(o + 30, e.severed & 0xffff, true);
      v.setFloat32(o + 32, sane(e.health, 0, HEALTH_MOST), true); v.setFloat32(o + 36, sane(e.maxHealth, 0, HEALTH_MOST), true); v.setFloat32(o + 40, sane(e.armor, 0, HEALTH_MOST), true);
    }
    this.at = o + (e.full ? FULL_BYTES : MOTION_BYTES);
    this.records++;
  }

  /** Roster: one living enemy's uid. */
  addUid(uid: number): void {
    this.view.setUint32(this.at, uid, true);
    this.at += 4;
    this.records++;
  }

  end(): ArrayBuffer {
    this.view.setUint8(3, this.records);
    return this.bytes.slice(0, this.at);
  }
}

/** The furthest from the origin an enemy's place may be, metres, and the most health or armour a record carries. */
export const PLACE_MOST = 100000, HEALTH_MOST = 1e9;
/** A number made fit to send: not-a-number is 0 (as is an infinity), and the rest is held to the range. */
export const sane = (n: number, least: number, most: number): number => Number.isFinite(n) ? n < least ? least : n > most ? most : n : 0;

/**
 * Either end: reads a chunk. `open` checks every byte of it first (it came from another browser, possibly not whole) and
 * says null for anything malformed; then `next` hands out the records one at a time in the same scratch object.
 */
export class ChunkReader {
  readonly header = chunkHeader();
  readonly enemy = wireEnemy();
  private view: DataView | null = null;
  private at = 0;
  private left = 0;
  private readonly seen: number[] = [];
  /** Records of the open chunk whose numbers cannot be used (by index): `next` passes over them. */
  private readonly bad: boolean[] = [];
  private index = 0;
  /** Records passed over since this reader was made: a number in one that no enemy can have. For the proofs and the log. */
  skipped = 0;

  open(data: unknown): ChunkHeader | null {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data instanceof Uint8Array ? data : null;
    this.view = null;
    this.left = 0;
    if (!bytes || bytes.byteLength < HEADER_BYTES || bytes.byteLength > CHUNK_BYTES) return null;
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (v.getUint16(0, true) !== SNAPSHOT_MAGIC) return null;
    const kind = v.getUint8(2), count = v.getUint8(3), phase = v.getUint8(12);
    if (kind > 1 || phase >= WAVE_PHASES.length) return null;
    const seen = this.seen, bad = this.bad;
    seen.length = 0;
    bad.length = 0;
    let at = HEADER_BYTES;
    // The chunk's shape is checked whole: a record that runs off the end, or a uid given twice, is a chunk that cannot be
    // trusted at all. A record of the right shape with a number no enemy can have is one bad record: it alone is passed
    // over, and the enemies that share its chunk (up to 40 of them) keep their state.
    for (let index = 0; index < count; index++) {
      if (at + 4 > bytes.byteLength) return null;
      const uid = v.getUint32(at, true);
      if (!uid || seen.includes(uid)) return null;
      seen.push(uid);
      if (kind === 1) { at += 4; continue; }
      if (at + MOTION_BYTES > bytes.byteLength) return null;
      const full = (v.getUint8(at + 4) & 1) !== 0;
      if (full && at + FULL_BYTES > bytes.byteLength) return null;
      let usable = true;
      for (let axis = 0; axis < 3; axis++) {
        const p = v.getFloat32(at + 7 + axis * 4, true);
        if (!Number.isFinite(p) || Math.abs(p) > PLACE_MOST) usable = false;
      }
      if (full) {
        if (v.getUint8(at + 27) >= ENEMY_IDS.length) usable = false;
        for (let field = 0; field < 3; field++) {
          const n = v.getFloat32(at + 32 + field * 4, true);
          if (!Number.isFinite(n) || n < 0) usable = false;
        }
      }
      if (!usable) bad[index] = true;
      at += full ? FULL_BYTES : MOTION_BYTES;
    }
    if (at !== bytes.byteLength) return null;
    this.index = 0;
    const h = this.header;
    h.kind = kind as 0 | 1; h.count = count;
    h.time = v.getUint32(4, true); h.tick = v.getUint16(8, true); h.wave = v.getUint16(10, true);
    h.phase = phase; h.nextWaveIn = v.getUint8(13); h.alive = v.getUint8(14); h.tickMs = v.getUint8(15);
    this.view = v;
    this.at = HEADER_BYTES;
    this.left = count;
    return h;
  }

  /** The next record of a states chunk, or null when there are no more. */
  next(): WireEnemy | null {
    const v = this.view;
    if (!v || this.header.kind !== 0) return null;
    // Past any record `open` found unusable.
    while (this.left > 0 && this.bad[this.index] === true) {
      this.at += (v.getUint8(this.at + 4) & 1) !== 0 ? FULL_BYTES : MOTION_BYTES;
      this.left--;
      this.index++;
      this.skipped++;
    }
    if (this.left <= 0) return null;
    this.left--;
    this.index++;
    const e = this.enemy, o = this.at;
    e.uid = v.getUint32(o, true);
    const bits = v.getUint8(o + 4);
    e.full = (bits & 1) !== 0; e.tier = bits >> 1 & 3; e.legs = Math.min(2, bits >> 3 & 3); e.rising = (bits & 32) !== 0; e.aiming = (bits & 64) !== 0;
    e.flags = v.getUint8(o + 5);
    const state = v.getUint8(o + 6);
    e.animation = state & 3; e.target = state >> 2 & 3;
    e.x = v.getFloat32(o + 7, true); e.y = v.getFloat32(o + 11, true); e.z = v.getFloat32(o + 15, true);
    e.yaw = v.getInt16(o + 19, true) / 10000;
    e.vx = v.getInt16(o + 21, true) / 100; e.vy = v.getInt16(o + 23, true) / 100; e.vz = v.getInt16(o + 25, true) / 100;
    if (e.full) {
      e.id = v.getUint8(o + 27); e.plates = v.getUint8(o + 28);
      e.posture = Math.min(POSTURES.length - 1, v.getUint8(o + 29));
      e.severed = v.getUint16(o + 30, true) & 2047;
      e.health = v.getFloat32(o + 32, true); e.maxHealth = v.getFloat32(o + 36, true); e.armor = v.getFloat32(o + 40, true);
    }
    this.at = o + (e.full ? FULL_BYTES : MOTION_BYTES);
    return e;
  }

  /** The next uid of a roster chunk, or 0 when there are no more. */
  nextUid(): number {
    const v = this.view;
    if (!v || this.left <= 0 || this.header.kind !== 1) return 0;
    this.left--;
    const uid = v.getUint32(this.at, true);
    this.at += 4;
    return uid;
  }
}

/**
 * Which tier an enemy is in for one guest: 0 near (every tick) or 1 far. `dx, dy, dz` run from the guest to the enemy and
 * `fx, fz` is the way the guest looks, flat. Bosses and the last few enemies are always near.
 */
export function tierOf(dx: number, dy: number, dz: number, fx: number, fz: number, boss: boolean, alive: number): 0 | 1 {
  if (boss || alive <= LAST_FEW) return 0;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 <= NEAR_M * NEAR_M) return 0;
  if (d2 <= CONE_M * CONE_M && dx * fx + dz * fz > CONE_COS * Math.hypot(dx, dz)) return 0;
  return 1;
}

/** Does this enemy go to a guest on this tick? Far enemies take turns by uid, so each tick carries about the same load. */
export const dueOn = (uid: number, tick: number, tier: number, farEvery: number): boolean => tier === 0 || (uid + tick) % farEvery === 0;

/** Is this tick the enemy's once-a-second full record? Always a tick a far enemy goes on. */
export const keyOn = (uid: number, tick: number): boolean => (uid + tick) % KEY_EVERY === 0;

/** Ms between a guest's updates of an enemy in this tier, given the host's real tick. */
export const intervalOf = (tier: number, tickMs: number): number => tickMs * (tier === 0 ? 1 : tier === 1 ? FAR_EVERY : FAR_EVERY_TIGHT);

/** An unwrapped counter from its wrapped wire value: the value nearest `last` that matches `wire` in its low `bits`. */
export function unwrap(wire: number, last: number, bits: 16 | 32): number {
  const span = 2 ** bits;
  const delta = ((wire - last) % span + span) % span;
  return last + (delta >= span / 2 ? delta - span : delta);
}

// ---------------------------------------------------------------------------------------------
// The same bytes as plain objects, for tests and tools. The game's own path uses the writer and reader above.
// ---------------------------------------------------------------------------------------------

export interface EnemyFrame {
  uid: number; id: EnemyId; position: Vec; velocity: Vec; yaw: number; health: number; maxHealth: number; armor: number;
  flags: number; animation: number; severed: number; plates: number; posture?: PostureId;
  /** Absent: a full record, near, both legs, not rising, not aiming, after slot 0. */
  full?: boolean; tier?: number; legs?: number; rising?: boolean; aiming?: boolean; target?: number;
}
export interface WorldChunk { time: number; tick: number; wave: number; phase?: WavePhase; nextWaveIn?: number; alive?: number; tickMs?: number; enemies: EnemyFrame[] }

/** One states chunk from plain objects. Throws if they do not fit one chunk. */
export function encodeChunk(chunk: WorldChunk): ArrayBuffer {
  const writer = new ChunkWriter();
  const e = wireEnemy();
  writer.begin(0, chunk.time, chunk.tick, chunk.wave, chunk.phase, chunk.nextWaveIn, chunk.alive ?? chunk.enemies.length, chunk.tickMs ?? TICK_MS);
  for (const enemy of chunk.enemies) {
    e.uid = enemy.uid; e.full = enemy.full ?? true; e.tier = enemy.tier ?? 0; e.legs = enemy.legs ?? 2; e.rising = enemy.rising ?? false; e.aiming = enemy.aiming ?? false;
    e.flags = enemy.flags; e.animation = enemy.animation; e.target = enemy.target ?? 0;
    [e.x, e.y, e.z] = enemy.position; [e.vx, e.vy, e.vz] = enemy.velocity; e.yaw = enemy.yaw;
    e.id = Math.max(0, ENEMY_IDS.indexOf(enemy.id)); e.plates = enemy.plates; e.posture = Math.max(0, POSTURES.indexOf(enemy.posture ?? 'stand'));
    e.severed = enemy.severed; e.health = enemy.health; e.maxHealth = enemy.maxHealth; e.armor = enemy.armor;
    if (!writer.fits(e.full)) throw new Error('Too many enemies for one chunk');
    writer.add(e);
  }
  return writer.end();
}

export function encodeRoster(chunk: Omit<WorldChunk, 'enemies'>, uids: readonly number[]): ArrayBuffer {
  const writer = new ChunkWriter();
  writer.begin(1, chunk.time, chunk.tick, chunk.wave, chunk.phase, chunk.nextWaveIn, chunk.alive ?? uids.length, chunk.tickMs ?? TICK_MS);
  for (const uid of uids) writer.addUid(uid);
  return writer.end();
}

/** A chunk as plain objects, or null if it is malformed. A roster comes back as `roster`. */
export function decodeChunk(data: unknown): (WorldChunk & { roster?: number[] }) | null {
  const reader = new ChunkReader();
  const h = reader.open(data);
  if (!h) return null;
  const out: WorldChunk & { roster?: number[] } = { time: h.time, tick: h.tick, wave: h.wave, phase: WAVE_PHASES[h.phase]!, nextWaveIn: h.nextWaveIn, alive: h.alive, tickMs: h.tickMs, enemies: [] };
  if (h.kind === 1) {
    out.roster = [];
    for (let uid = reader.nextUid(); uid; uid = reader.nextUid()) out.roster.push(uid);
    return out;
  }
  for (let e = reader.next(); e; e = reader.next()) {
    out.enemies.push({ uid: e.uid, id: ENEMY_IDS[e.full ? e.id : 0]!, position: [e.x, e.y, e.z], velocity: [e.vx, e.vy, e.vz], yaw: e.yaw,
      health: e.full ? e.health : 0, maxHealth: e.full ? e.maxHealth : 0, armor: e.full ? e.armor : 0, flags: e.flags, animation: e.animation,
      severed: e.full ? e.severed : 0, plates: e.full ? e.plates : 0, posture: POSTURES[e.full ? e.posture : 0], full: e.full, tier: e.tier, legs: e.legs,
      rising: e.rising, aiming: e.aiming, target: e.target });
  }
  return out;
}
