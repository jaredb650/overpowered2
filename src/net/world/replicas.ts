/**
 * The host's enemies on every guest.
 *
 * **Host.** A steady 20-a-second tick (`SendClock`, never tied to the frame rate). On each tick every guest gets the enemies
 * due to them: the near ones (within `NEAR_M`, or ahead of them, or a boss, or one of the last few) every tick, the far ones
 * every fourth. One that stops being near is still sent every tick for a second, its records saying "far" for the last part
 * of it, so the guest has fallen back to the far tier's delay before its states thin out. They go as chunks of at most `CHUNK_BYTES` on the unreliable `world` lane (snapshot.ts), each stamped with
 * the host's clock, and a guest whose connection is behind is skipped for that tick. Twice a second a roster names everyone
 * still alive.
 *
 * **Guest.** Each copy ("replica") keeps its last few states in a `MotionBuffer` (motion.ts) and is drawn a little in the
 * past, between two of them: about one send interval plus the measured jitter behind the host's clock (`HostClock`). Packets
 * may be lost or come out of order. What a state says of the body (frozen, burning, posture, a limb gone) takes effect when
 * the playhead reaches it; health and armour at once. Clips are not started from states: attacks.ts plays attacks from its
 * own events, moves.ts everything else (the record's coarse animation bits are carried but no longer played). A killed uid is remembered (`dead`, bounded) so a late chunk never
 * brings it back, and something meant for an enemy not yet seen can wait for it (`whenSeen`).
 */
import * as THREE from 'three';
import { MISSION_ID } from '../../campaign/select';
import type { DamageInfo } from '../../core/contracts';
import type { Enemy } from '../../enemies/Enemy';
import type { ReplicaView } from '../../enemies/EnemyManager';
import { HELMET } from '../../enemies/wounds/armour';
import { capturable } from './capture';
import type { WorldContext, WorldModule } from './context';
import { HostClock, MotionBuffer, SendClock, motionSample, type MotionSample } from './motion';
import { AIRBORNE, BOSS_ENTRY, BURNING, CAPTURABLE, CEILING_BYTES, ChunkReader, ChunkWriter, DOWNED, FALL_BACK_TICKS, FAR_EVERY, FAR_EVERY_TIGHT, FROZEN, FULL_TICKS, NEAR_HOLD_TICKS,
  POSTURES, ROSTER_EVERY, SHIELD, TICK_MS, WARD, WAVE_PHASES, dueOn, intervalOf, keyOn, tierOf, unwrap, wireEnemy, type PostureId, type WireEnemy } from './snapshot';
import type { Targeting } from './targeting';
import { ENEMY_IDS, REGIONS } from './wire';

/** What is known of a replica from its newest state, whatever is being drawn. */
export interface ReplicaFacts { flags: number; posture: PostureId; target: number }

export interface Replica {
  enemy: Enemy;
  /** The newest state's facts. `flags` is read by capture.ts and the claim guess. */
  to: ReplicaFacts;
  motion: MotionBuffer;
  /** Host time of the newest state and of the first. */
  newest: number;
  first: number;
  /** Local time the roster first left it out; 0 while it is named. */
  missing: number;
  /** Local time (`performance.now()`) its newest state arrived: how old this page's knowledge of it is. */
  heard: number;
  /** The frost drawn on its skin, 0..1. */
  frost: number;
  /** When a limb the host has off was first seen still on this copy (0: none owed). */
  severAt: number;
  /** Its own ragdoll has it (a living knockdown, moves.ts): since when, and when the host's was first seen up again. */
  down: boolean;
  downAt: number;
  hostUpAt: number;
  /** When the host's was first seen down without this copy having fallen (-Infinity: it was down when first seen), and when this copy last got up. */
  hostDownAt: number;
  gotUpAt: number;
}

/** The posture a man is held in by his animator (postures.ts), as the snapshot carries it. */
export function postureOf(enemy: Enemy): PostureId {
  const name = (enemy.char.anim as unknown as { posture?: { name?: string } }).posture?.name;
  return (POSTURES as readonly string[]).includes(name ?? '') ? name as PostureId : 'stand';
}

/** A set that forgets its oldest entries past `cap`: the killed uids, which only matter while a late chunk could still name them. */
export class RecentSet {
  private readonly set = new Set<number>();
  constructor(readonly cap: number) {}
  get size(): number { return this.set.size; }
  has(value: number): boolean { return this.set.has(value); }
  add(value: number): void {
    this.set.delete(value);
    this.set.add(value);
    if (this.set.size > this.cap) this.set.delete(this.set.values().next().value!);
  }
  /** Lets an id back in: for a death this page played ahead of the host's word and the host then denied (hits.ts). */
  delete(value: number): boolean { return this.set.delete(value); }
}

/** The far tier's spacing for a guest, from the snapshot bytes a second they are being sent: thinned over the ceiling. */
export const farEveryFor = (bytesPerSecond: number, current: number): number =>
  bytesPerSecond > CEILING_BYTES ? FAR_EVERY_TIGHT : bytesPerSecond < CEILING_BYTES * 0.6 ? FAR_EVERY : current;

/** The host's enemy is down and this copy has not fallen: it waits this long for its `down` move before lying in the posture, ms. */
const DOWN_POSTURE_MS = 300;
/** A copy that just got up from its own ragdoll is not laid back down by the posture for this long, ms. */
const GOT_UP_MS = 2500;
/** A copy still in its ragdoll this long after the host's is up is told to rise, ms. */
const HOST_UP_MS = 600;
/** A limb the host's state has off waits this long for its `sever` event before it simply drops, ms. */
const SEVER_WAIT_MS = 800;
/** A missing enemy waits this long for its `kill` before it is simply withdrawn, ms. */
const GONE_MS = 500;
/** Something for an enemy not yet seen waits this long for it, ms; and at most this many wait at once. */
const WAIT_MS = 1500;
const WAIT_MAX = 128;
/** Chunks kept while the map loads. */
const PENDING_MAX = 64;
const DEAD_MAX = 1024;

/** Host: what was last sent in an enemy's full record, to know when it changed. */
interface Sent { first: number; fullUntil: number; health: number; maxHealth: number; armor: number; rest: number; target: number }
/** Host: one guest's lane. `near`: the tick each enemy was last near this guest (it is held near a while after, `NEAR_HOLD_TICKS`). */
interface Guest { windowAt: number; bytes: number; farEvery: number; near: Map<number, number> }

const _eye = new THREE.Vector3();

export class Replicas implements WorldModule {
  /** A mission scales its enemies by a threat level of its own, not by a wave. */
  private readonly inMission = MISSION_ID !== null;
  /** Guest: the host's enemies as drawn here, by uid. */
  readonly map = new Map<number, Replica>();
  /** Guest: uids the host has said are dead. */
  readonly dead = new RecentSet(DEAD_MAX);
  /** Guest: the newest send tick heard. */
  receivedSeq: number | null = null;
  /** Guest: the host's clock, and how unevenly its chunks arrive. */
  readonly clock = new HostClock();
  /** Guest: chunks dropped as malformed or stale, states for an enemy that had no full record yet. */
  readonly counts = { bad: 0, stale: 0, waiting: 0, chunks: 0, skipped: 0 };

  // Guest.
  private readonly reader = new ChunkReader();
  private pending: { data: ArrayBuffer; at: number }[] = [];
  private newestTime = NaN;
  private rosterTime = -Infinity;
  private readonly roster = new Set<number>();
  private lastFrame = 0;
  private readonly sample = motionSample();
  private readonly waiting: { uid: number; until: number; run: (enemy: Enemy) => void }[] = [];
  private readonly view: ReplicaView = { frost: 0, frozen: false, burning: false, aiming: false, feet: null, eye: null, legs: 2, rising: false };
  private readonly slotFeet = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private readonly slotEye = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private readonly slotKnown = [false, false, false, false];

  // Host.
  private readonly ticks = new SendClock(TICK_MS);
  private readonly writer = new ChunkWriter();
  private readonly wire = wireEnemy();
  private readonly sent = new Map<number, Sent>();
  private readonly guests = new Map<string, Guest>();
  private readonly aliveNow = new Set<number>();

  constructor(private readonly w: WorldContext, private readonly targeting: Targeting) {
    w.onSnapshot = data => this.receive(data, performance.now());
  }

  /** Guest: the copy of this enemy, if it is drawn here. */
  enemy(uid: number): Enemy | undefined { return this.map.get(uid)?.enemy; }
  /** Guest: the flag bits of this enemy's latest state (0 if unknown). */
  flags(uid: number): number { return this.map.get(uid)?.to.flags ?? 0; }

  /**
   * Guest: runs `run` on this enemy's copy: now if it is drawn here, else when it first appears, if that is within
   * `WAIT_MS`. For an event that can outrun the enemy's first state (events are reliable, states are not). Never for a
   * uid already dead.
   */
  whenSeen(uid: number, run: (enemy: Enemy) => void): void {
    if (this.dead.has(uid)) return;
    const enemy = this.map.get(uid)?.enemy;
    if (enemy) { run(enemy); return; }
    if (this.waiting.length >= WAIT_MAX) this.waiting.shift();
    this.waiting.push({ uid, until: performance.now() + WAIT_MS, run });
  }

  /** The map is up: the chunks kept while it loaded are taken now, as they arrived. */
  begin(): void {
    const pending = this.pending;
    this.pending = [];
    for (const chunk of pending) this.receive(chunk.data, chunk.at);
  }

  // -------------------------------------------------------------------------------------------
  // Guest
  // -------------------------------------------------------------------------------------------

  private receive(data: ArrayBuffer, now: number): void {
    if (this.w.hosting) return;
    if (!this.w.ready) {
      if (this.pending.length >= PENDING_MAX) this.pending.shift();
      this.pending.push({ data, at: now });
      return;
    }
    const h = this.reader.open(data);
    if (!h) { this.counts.bad++; return; }
    this.counts.chunks++;
    // A first chunk, or one from a clock nowhere near the last (the host's page was reloaded): a new timeline.
    if (Number.isNaN(this.newestTime) || Math.abs(unwrap(h.time, this.newestTime, 32) - this.newestTime) > 60_000) {
      this.newestTime = h.time;
      this.rosterTime = -Infinity;
      this.receivedSeq = h.tick;
      this.clock.reset();
    }
    const t = unwrap(h.time, this.newestTime, 32);
    if (t < this.newestTime - 5000) { this.counts.stale++; return; }
    this.clock.observe(t, now);
    if (t >= this.newestTime) {
      this.newestTime = t;
      this.receivedSeq = unwrap(h.tick, this.receivedSeq ?? h.tick, 16);
      const waves = this.w.ctx.waves as { wave: number; phase?: unknown; nextWaveIn?: number };
      waves.wave = h.wave; waves.phase = WAVE_PHASES[h.phase]; waves.nextWaveIn = h.nextWaveIn;
      // The wave a copy is built for is the host's: this page's own manager never left wave 1, so every copy was made with
      // wave 1's numbers (what it hits for, its helmet by the Crucible's rules) whatever wave the host was on. Not in a
      // mission, where the host's enemies are scaled by a threat level that is not a wave.
      const manager = this.w.manager as Partial<Pick<typeof this.w.manager, 'level' | 'setWave'>>;
      if (h.wave >= 1 && !this.inMission && manager.setWave && manager.level !== h.wave) manager.setWave(h.wave);
    }
    if (h.kind === 1) this.rosterIn(t, now);
    else for (let e = this.reader.next(); e; e = this.reader.next()) this.stateIn(e, t, h.tickMs);
  }

  private stateIn(e: WireEnemy, t: number, tickMs: number): void {
    const { manager } = this.w;
    if (this.dead.has(e.uid)) return;
    let replica = this.map.get(e.uid);
    if (!replica) {
      // Only a full record says what it is. And not one the roster has since left out: that enemy is gone.
      if (!e.full) { this.counts.waiting++; return; }
      if (t < this.rosterTime && !this.roster.has(e.uid)) return;
      const enemy = manager.spawn(ENEMY_IDS[e.id]!, _eye.set(e.x, e.y, e.z));
      if (!enemy) return;
      enemy.uid = e.uid;
      enemy.yaw = e.yaw;
      // Its limb pools were sized for this page's own idea of its health: to the host's (EnemyManager.fitReplicaHealth).
      (manager as { fitReplicaHealth?(enemy: Enemy, maxHealth: number): void }).fitReplicaHealth?.(enemy, e.maxHealth);
      replica = { enemy, to: { flags: e.flags, posture: POSTURES[e.posture]!, target: e.target }, motion: new MotionBuffer(), newest: -Infinity, first: t,
        missing: 0, heard: 0, frost: 0, severAt: 0, down: false, downAt: 0, hostUpAt: 0, hostDownAt: (e.flags & DOWNED) !== 0 ? -Infinity : 0, gotUpAt: -Infinity };
      this.map.set(e.uid, replica);
      this.seen(enemy);
    }
    const enemy = replica.enemy;
    const newest = t >= replica.newest;
    if (newest) {
      replica.newest = t;
      replica.heard = performance.now();
      replica.missing = 0;
      replica.to.flags = e.flags;
      replica.to.target = e.target;
      replica.motion.interval = intervalOf(e.tier, tickMs);
      enemy.shield = (e.flags & SHIELD) !== 0;
      if (e.full) {
        replica.to.posture = POSTURES[e.posture]!;
        // While this player's own hits on it are unanswered, its health is what the host's answers say (`ack`, `hitfx`: in
        // order, each with the health after it). A state's health may or may not have those hits in it yet, and taking it
        // would count a hit twice against the enemy (`Enemy.owed`): the guess at a kill would run ahead of the truth.
        if (enemy.owed <= 0) enemy.health = e.health;
        enemy.maxHealth = e.maxHealth;
        if (e.plates && enemy.plates.length === 0) manager.fitPlates(enemy, [HELMET]);
        enemy.armor = e.armor;
        for (let index = 0; index < enemy.plates.length; index++) {
          const plate = enemy.plates[index]!;
          plate.mesh.visible = (e.plates & 1 << index) !== 0;
          if (!plate.mesh.visible) plate.hp = 0;
        }
      }
    }
    replica.motion.push(t, e.x, e.y, e.z, e.yaw, e.vx, e.vy, e.vz, e.flags,
      e.animation | e.target << 2 | e.legs << 4 | (e.rising ? 64 : 0) | (e.aiming ? 128 : 0),
      POSTURES.indexOf(replica.to.posture), e.full ? e.severed : -1);
  }

  /** A new copy: whatever was waiting for it runs now. */
  private seen(enemy: Enemy): void {
    const waiting = this.waiting;
    for (let index = 0; index < waiting.length; index++) {
      const wait = waiting[index]!;
      if (wait.uid !== enemy.uid) continue;
      waiting.splice(index--, 1);
      try { wait.run(enemy); } catch (error) { console.warn('[coop] Dropped something kept for a new enemy', error); }
    }
  }

  private rosterIn(t: number, now: number): void {
    if (t <= this.rosterTime) return;
    this.rosterTime = t;
    const roster = this.roster;
    roster.clear();
    for (let uid = this.reader.nextUid(); uid; uid = this.reader.nextUid()) roster.add(uid);
    // Gone from the host without a death: it waits a moment for a `kill` still on its way, then is withdrawn (`animate`).
    for (const [uid, replica] of this.map) {
      if (roster.has(uid)) replica.missing = 0;
      else if (!replica.missing && replica.first < t && replica.newest < t) replica.missing = now;
    }
  }

  /** Guest, each frame before the enemies draw: every replica where its playhead has it. */
  animate(now: number): void {
    const { ctx, manager } = this.w;
    const dt = Math.max(0, Math.min(250, now - this.lastFrame));
    this.lastFrame = now;
    if (this.clock.empty) return;
    const hostNow = this.clock.now(now), jitter = this.clock.jitter;
    this.findPlayers();
    const view = this.view;
    for (const [uid, replica] of this.map) {
      if (replica.missing && now - replica.missing > GONE_MS) {
        if (replica.enemy.alive) manager.withdraw(replica.enemy);
        this.map.delete(uid);
        continue;
      }
      const motion = replica.motion;
      const s = motion.advance(dt, hostNow, jitter, this.sample);
      if (s.mode === 2) continue;
      const enemy = replica.enemy;
      // On the skyhook's line (world/airlift.ts): this screen's drone has him, and puts him where its hook is.
      if (enemy.carried) continue;
      const flags = motion.tag(s.at, 0), state = motion.tag(s.at, 1), severed = motion.tag(s.at, 3);
      const posture = POSTURES[motion.tag(s.at, 2)] ?? 'stand';
      const hostDown = (flags & DOWNED) !== 0;
      if (this.ragdoll(replica, hostDown, s, now)) continue;
      if (hostDown) { if (replica.hostDownAt === 0) replica.hostDownAt = now; } else replica.hostDownAt = 0;
      enemy.position.set(s.x, s.y, s.z);
      enemy.yaw = s.yaw;
      enemy.velocity.set(s.vx, s.vy, s.vz);
      enemy.groundY = s.y;
      enemy.airborne = (flags & AIRBORNE) !== 0;
      // A limb the host has off and this copy still has. Its `sever` event carries the cut as it really was (the round, the
      // way the limb flew) and is on its way on the reliable lane, which a lost packet can hold up for a while: the limb waits
      // for it. Only if the event never comes does it simply drop.
      let owed = false;
      if (severed > 0) for (let index = 0; index < REGIONS.length; index++) if ((severed & 1 << index) && !enemy.char.severed.has(REGIONS[index]!)) {
        owed = true;
        if (replica.severAt === 0 || now - replica.severAt < SEVER_WAIT_MS) continue;
        const damage: DamageInfo = { amount: 1, type: 'slash', point: enemy.center.clone(), dir: new THREE.Vector3(0, 1, 0), force: 1, source: 'coop' };
        // And what is left of the body is read again, as the event's own path does (DamageModel.sever): a limb that only
        // dropped left the copy counting arms and legs it no longer had.
        if (ctx.gore.sever(enemy.char, REGIONS[index]!, damage)) (manager as { model?: { updateMaim?(e: Enemy): void } }).model?.updateMaim?.(enemy);
      }
      replica.severAt = owed ? replica.severAt || now : 0;
      const frozen = (flags & FROZEN) !== 0;
      replica.frost += ((frozen ? 1 : 0) - replica.frost) * Math.min(1, dt / 200);
      view.frost = frozen ? Math.max(replica.frost, 0.5) : replica.frost < 0.02 ? 0 : replica.frost;
      view.frozen = frozen;
      view.burning = (flags & BURNING) !== 0;
      view.legs = state >> 4 & 3;
      view.rising = (state & 64) !== 0;
      const slot = state >> 2 & 3;
      // Aiming by the host's word, or because an attack is running on the copy right now (attacks.ts starts those on arrival).
      view.aiming = ((state & 128) !== 0 || enemy.attack !== null) && this.slotKnown[slot]!;
      view.feet = this.slotFeet[slot]!;
      view.eye = this.slotEye[slot]!;
      // Down on the host with no fall of its own here (it was down when first seen, or gore had no room): it lies in the
      // posture. Not in the moment before its `down` move plays, and not straight after its own ragdoll got up.
      const lying = hostDown && now - replica.hostDownAt > DOWN_POSTURE_MS && now - replica.gotUpAt > GOT_UP_MS;
      manager.placeReplica(enemy, ctx.time.dt, lying ? 'downed' : posture, view);
    }
    for (let index = this.waiting.length - 1; index >= 0; index--) if (now > this.waiting[index]!.until) this.waiting.splice(index, 1);
  }

  /**
   * A copy knocked off its feet is its own ragdoll (moves.ts `down`, or this page's gore from a hit): gore has the body and
   * nothing here may place or animate it. True while that lasts. When gore hands it back it is getting up where it landed,
   * which is not quite where the host's lies: the motion buffer eases it from there to the host's place, starting on this
   * very frame (`s`, this frame's sample, is put where the body is: one frame at the buffer's place was a pop of a metre
   * or two there and back).
   */
  private ragdoll(replica: Replica, hostDown: boolean, s: MotionSample, now: number): boolean {
    const { enemy } = replica;
    const groundY = s.y;
    const gore = this.w.ctx.gore as { downed?(char: Enemy['char']): { center: THREE.Vector3 } | null; rouse?(char: Enemy['char']): void };
    const body = gore.downed?.(enemy.char) ?? null;
    if (body) {
      if (!replica.down) { replica.down = true; replica.downAt = now; replica.hostUpAt = 0; }
      enemy.downed = enemy.airborne = true;
      enemy.velocity.set(0, 0, 0);
      enemy.position.set(body.center.x, Math.max(body.center.y - enemy.def.chest, groundY), body.center.z);
      enemy.center.copy(body.center);
      // The host's is on its feet and this one still lies (its `getUp` came while it was in the air, or never): up it gets.
      if (hostDown) replica.hostUpAt = 0;
      else if (!replica.hostUpAt) replica.hostUpAt = now;
      // (One this player's own hit dropped for dead is waiting on the host's answer to that hit, which is what the host's
      // body standing would otherwise be mistaken for: hits.ts gets it up if the answer is that it lives.)
      else if (enemy.predead === 0 && now - replica.hostUpAt > HOST_UP_MS && now - replica.downAt > HOST_UP_MS) gore.rouse?.(enemy.char);
      return true;
    }
    if (replica.down) {
      replica.down = enemy.downed = enemy.airborne = false;
      replica.gotUpAt = now;
      const root = enemy.char.root;
      replica.motion.drawnAt(root.position.x, root.position.y, root.position.z, root.rotation.y, s);
    }
    return false;
  }

  /** Where each slot's player stands and looks from, for the replicas to aim at: this player, or a friend's body. */
  private findPlayers(): void {
    const { ctx, session } = this.w;
    this.slotKnown.fill(false);
    for (const player of session.lobby.players) {
      const slot = player.slot;
      if (!(slot >= 0 && slot < 4)) continue;
      if (player.id === session.lobby.you) {
        this.slotFeet[slot]!.copy(ctx.player.position);
        this.slotEye[slot]!.copy(ctx.player.eye);
        this.slotKnown[slot] = true;
        continue;
      }
      const root = session.remotes.get(player.id)?.char.root;
      if (!root?.visible) continue;
      this.slotFeet[slot]!.copy(root.position);
      this.slotEye[slot]!.copy(root.position).y += 1.6;
      this.slotKnown[slot] = true;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Host
  // -------------------------------------------------------------------------------------------

  /** Host: the tick, when it is due. Last in the world's update. */
  update(now: number): void {
    if (!this.w.hosting || !this.ticks.due(now)) return;
    const { manager, session } = this.w;
    const tick = this.ticks.tick;
    const alive = manager.alive;
    for (let index = 0; index < alive.length; index++) this.note(alive[index]!, tick);
    const roster = tick % ROSTER_EVERY === 0 || (alive.length === 0 && tick % 5 === 0);
    for (const player of session.lobby.players) {
      if (player.host || player.away) continue;
      // Latest-wins data for a guest whose connection is behind would only queue up stale: they get the next tick instead.
      if (session.lobby.behind(player.id)) { this.counts.skipped++; continue; }
      this.sendTo(player.id, now, tick, roster);
    }
    if (roster) this.forget();
  }

  /** Host: has anything in this enemy's full record changed since it was last noted? Then the next ticks carry it. */
  private note(enemy: Enemy, tick: number): void {
    let sent = this.sent.get(enemy.uid);
    const rest = this.restOf(enemy);
    const target = this.targeting.targetOf(enemy.uid);
    let slot = 0;
    if (target !== undefined) for (const player of this.w.session.lobby.players) if (player.id === target) { slot = player.slot; break; }
    if (!sent) this.sent.set(enemy.uid, sent = { first: tick, fullUntil: tick + FULL_TICKS, health: enemy.health, maxHealth: enemy.maxHealth, armor: enemy.armor, rest, target: 0 });
    else if (sent.health !== enemy.health || sent.maxHealth !== enemy.maxHealth || sent.armor !== enemy.armor || sent.rest !== rest) {
      sent.health = enemy.health; sent.maxHealth = enemy.maxHealth; sent.armor = enemy.armor; sent.rest = rest;
      sent.fullUntil = tick + FULL_TICKS;
    }
    // The slot of the player it is after, worked out once a tick for every guest's record.
    sent.target = slot;
  }

  /** Plates, posture and severed regions as one number. */
  private restOf(enemy: Enemy): number {
    let plates = 0, severed = 0;
    for (let index = 0; index < enemy.plates.length; index++) if (enemy.plates[index]!.hp > 0) plates |= 1 << index;
    for (let index = 0; index < REGIONS.length; index++) if (enemy.char.severed.has(REGIONS[index]!)) severed |= 1 << index;
    return plates + POSTURES.indexOf(postureOf(enemy)) * 256 + severed * 65536;
  }

  private sendTo(id: string, now: number, tick: number, roster: boolean): void {
    const { ctx, manager, session } = this.w;
    const alive = manager.alive;
    let guest = this.guests.get(id);
    if (!guest) this.guests.set(id, guest = { windowAt: now, bytes: 0, farEvery: FAR_EVERY, near: new Map() });
    if (now - guest.windowAt >= 1000) {
      guest.farEvery = farEveryFor(guest.bytes * 1000 / (now - guest.windowAt), guest.farEvery);
      guest.windowAt = now;
      guest.bytes = 0;
    }
    // Where this guest stands and looks. Until their body is in the world, everything is near.
    const root = session.remotes.get(id)?.char.root;
    const placed = !!root?.visible;
    const gx = root?.position.x ?? 0, gy = root?.position.y ?? 0, gz = root?.position.z ?? 0;
    const fx = root ? Math.sin(root.rotation.y) : 0, fz = root ? Math.cos(root.rotation.y) : 0;
    const writer = this.writer, e = this.wire;
    const waves = ctx.waves;
    const tickMs = this.ticks.actual;
    let open = false;
    for (let index = 0; index < alive.length; index++) {
      const enemy = alive[index]!;
      const sent = this.sent.get(enemy.uid)!;
      const tier = placed ? tierOf(enemy.position.x - gx, enemy.position.y - gy, enemy.position.z - gz, fx, fz, enemy.isBoss, alive.length) : 0;
      // Near a moment ago is still sent every tick (no flipping between the tiers at the edge of the ring or of the cone),
      // and for the last part of that its records say "far", so the guest falls back before the states thin out.
      if (tier === 0) guest.near.set(enemy.uid, tick);
      const left = tier === 0 ? 0 : tick - (guest.near.get(enemy.uid) ?? -Infinity);
      // (Not while this guest is over the byte ceiling and the far tier is thinned: then nothing extra is sent.)
      const held = tier !== 0 && left <= NEAR_HOLD_TICKS && guest.farEvery === FAR_EVERY;
      const sentTier = tier === 0 || (held && left <= NEAR_HOLD_TICKS - FALL_BACK_TICKS) ? 0 : guest.farEvery === FAR_EVERY ? 1 : 2;
      // A new enemy goes to everyone on its first two ticks, wherever it is, so it appears on time.
      if (!held && !dueOn(enemy.uid, tick, tier, guest.farEvery) && tick > sent.first + 1) continue;
      this.fill(e, enemy, sentTier, tick <= sent.fullUntil || keyOn(enemy.uid, tick), sent.target);
      if (open && !writer.fits(e.full)) { this.flush(id, guest); open = false; }
      if (!open) { writer.begin(0, now, tick, waves.wave, waves.phase, waves.nextWaveIn, alive.length, tickMs); open = true; }
      writer.add(e);
    }
    if (open) this.flush(id, guest);
    if (!roster) return;
    writer.begin(1, now, tick, waves.wave, waves.phase, waves.nextWaveIn, alive.length, tickMs);
    for (let index = 0; index < alive.length && writer.fits(false); index++) writer.addUid(alive[index]!.uid);
    this.flush(id, guest);
  }

  private flush(id: string, guest: Guest): void {
    const bytes = this.writer.end();
    const recipients = this.w.sendSnapshot(bytes, id);
    this.w.stats.snapshotBytes += bytes.byteLength * recipients;
    this.w.stats.snapshotPackets += recipients;
    guest.bytes += bytes.byteLength;
  }

  private fill(e: WireEnemy, enemy: Enemy, tier: number, full: boolean, target: number): void {
    e.uid = enemy.uid; e.full = full; e.tier = tier;
    e.legs = enemy.maim.legs; e.rising = enemy.rising > 0;
    e.aiming = enemy.attack !== null || enemy.face === 'player';
    e.flags = (enemy.airborne ? AIRBORNE : 0) | (enemy.downed ? DOWNED : 0) | (enemy.frozen > 0 ? FROZEN : 0) | (enemy.burning > 0 ? BURNING : 0)
      | (enemy.shield ? SHIELD : 0) | (enemy.ward > 0 ? WARD : 0) | (enemy.entrance === 'boss' ? BOSS_ENTRY : 0) | (capturable(enemy) ? CAPTURABLE : 0);
    e.animation = enemy.attack ? enemy.attackPhase === 'windup' ? 1 : 2 : enemy.stagger > 0 ? 3 : 0;
    e.target = target;
    e.x = enemy.position.x; e.y = enemy.position.y; e.z = enemy.position.z; e.yaw = enemy.yaw;
    e.vx = enemy.velocity.x; e.vy = enemy.velocity.y; e.vz = enemy.velocity.z;
    if (!full) return;
    e.id = Math.max(0, ENEMY_IDS.indexOf(enemy.id));
    e.posture = POSTURES.indexOf(postureOf(enemy));
    // (`Math.max(0, NaN)` is `NaN`: the writer makes each of these a number a reader will take, snapshot.ts `sane`.)
    e.health = enemy.health; e.maxHealth = enemy.maxHealth; e.armor = enemy.armor;
    let plates = 0, severed = 0;
    for (let index = 0; index < enemy.plates.length; index++) if (enemy.plates[index]!.hp > 0) plates |= 1 << index;
    for (let index = 0; index < REGIONS.length; index++) if (enemy.char.severed.has(REGIONS[index]!)) severed |= 1 << index;
    e.plates = plates; e.severed = severed;
  }

  /** Host, twice a second: per-enemy state of enemies no longer alive is dropped, here and in the modules that asked. */
  private forget(): void {
    const alive = this.aliveNow;
    alive.clear();
    for (const enemy of this.w.manager.alive) alive.add(enemy.uid);
    for (const uid of this.sent.keys()) if (!alive.has(uid)) this.sent.delete(uid);
    for (const guest of this.guests.values()) for (const uid of guest.near.keys()) if (!alive.has(uid)) guest.near.delete(uid);
    for (const id of this.guests.keys()) if (!this.w.session.lobby.players.some(player => player.id === id)) this.guests.delete(id);
    for (const sent of this.w.snapshotSent) sent(alive);
  }

  dispose(): void {
    for (const replica of this.map.values()) if (replica.enemy.alive) this.w.manager.withdraw(replica.enemy);
    this.map.clear();
    this.waiting.length = 0;
    this.pending = [];
  }
}
