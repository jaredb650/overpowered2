/**
 * What every co-op world module is handed: the game, the session, the two lanes, the router and the few lookups they share.
 * A module keeps its own state and reaches another module only through that module's public methods (passed to its constructor
 * in world.ts), never through this object.
 */
import * as THREE from 'three';
import { CG, type Ctx, type GameEvents } from '../../core/contracts';
import type { EnemyManager } from '../../enemies/EnemyManager';
import { ClaimValidator } from '../authority';
import type { CoopSession } from '../index';
import { metrics } from '../metrics';
import type { RemotePlayer } from '../remote';
import type { Team, TeamLife } from '../team';
import { droppable, type WorldEvent } from '../worldProtocol';
import type { EventLane } from '../lobby';
import { Router } from './router';
import type { Vec } from './wire';

/** A feature of the co-op world. world.ts runs `update` on each, in its list's order, once the world has begun. */
export interface WorldModule {
  /** Every frame, host and guest alike. `now` is `performance.now()`, read once for the frame. */
  update?(now: number): void;
  dispose?(): void;
  /**
   * Host: this player's connection dropped (their seat is kept, `SEAT_GRACE_MS`). Whatever they held in the world is let go:
   * a seat on a gun, a man in their hands, a slow-mo, a flag they set. `slot` is theirs; they are still in `lobby.players`.
   */
  lostSeat?(id: string, slot: number): void;
  /**
   * Guest: the host has this player in the world (for the first time, or again after a drop: its `sync`). Whatever this
   * module says to the host once, on a change, is said again as it stands now: the host drops every word from a player it
   * has marked away, and neither side is told.
   */
  resay?(): void;
  /** Host: this connection id will never be heard from again (the seat's new page has another, or the seat is gone). */
  forgetPeer?(id: string): void;
}

/** Host: work for a little later (an enemy's blast on a remote player, after its fuse), run from the world's update. */
export class Later implements WorldModule {
  private queue: { at: number; run: () => void }[] = [];
  private fuses: { left: number; run: () => void }[] = [];
  /** `worldDt`: the world clock's step this frame (`ctx.time.dt`), for `after`. */
  constructor(private readonly worldDt: () => number = () => 0) {}
  /** At `at` on the real clock (`performance.now()`). */
  push(at: number, run: () => void): void { this.queue.push({ at, run }); }
  /** After `seconds` of world time: slow-mo stretches it, as it stretches the fuse the players are watching. */
  after(seconds: number, run: () => void): void { this.fuses.push({ left: seconds, run }); }
  update(now: number): void {
    if (this.queue.length > 0) {
      const due = this.queue.filter(event => event.at <= now);
      this.queue = this.queue.filter(event => event.at > now);
      for (const event of due) event.run();
    }
    if (this.fuses.length === 0) return;
    const dt = this.worldDt();
    for (const fuse of this.fuses) fuse.left -= dt;
    const due = this.fuses.filter(fuse => fuse.left <= 0);
    if (due.length === 0) return;
    this.fuses = this.fuses.filter(fuse => fuse.left > 0);
    for (const fuse of due) fuse.run();
  }
  dispose(): void { this.queue = []; this.fuses = []; }
}

/** The first two bytes of a packet on the `world` lane that is not an enemy snapshot (snapshot.ts has its own). */
const SIDE_HEAD = [0x05, 0xc2] as const;
const encoder = new TextEncoder(), decoder = new TextDecoder();

export class WorldContext {
  readonly stats = { snapshotBytes: 0, eventBytes: 0, snapshotPackets: 0, eventPackets: 0, accepted: 0, rejected: 0, since: performance.now() };
  readonly validator = new ClaimValidator();
  readonly router = new Router();
  readonly later: Later;
  /** The team's lives. Set by world.ts as soon as the team is built (the team needs `send` first). */
  team!: Team;
  /** False until the map is up (`CoopWorld.begin`): events that arrive earlier are dropped, the latest snapshot is kept. */
  ready = false;
  /** The snapshot lane's receiver (replicas.ts sets it). */
  onSnapshot: (data: ArrayBuffer) => void = () => {};
  /** Host: called after each snapshot goes out, with the uids alive in it, for per-enemy state to be forgotten. */
  readonly snapshotSent: ((alive: Set<number>) => void)[] = [];
  /** Sends a snapshot chunk on the `world` lane, to every guest or the one named; returns how many players it went to. */
  readonly sendSnapshot: (data: ArrayBuffer, to?: string) => number;
  /** The reliable lane, batched: everything sent in a frame leaves as one message per peer (net/batch.ts). */
  private readonly action: EventLane<WorldEvent>;
  private readonly offs: (() => void)[] = [];

  constructor(readonly ctx: Ctx, readonly session: CoopSession) {
    this.later = new Later(() => ctx.time.dt);
    // Latest-wins bytes: unreliable and unordered, so a lost chunk never holds up the next, and none for a guest that is behind.
    this.sendSnapshot = session.lobby.gameplay<ArrayBuffer>('world', data => this.worldIn(data), { unreliable: true, latest: true });
    this.action = session.lobby.events<WorldEvent>('action', (data, from, bytes) => this.receive(data, from, bytes));
  }

  get hosting(): boolean { return this.session.hosting; }
  get manager(): EnemyManager { return this.ctx.enemies as EnemyManager; }
  life(id: string): TeamLife { return this.team.life(id); }

  private readonly sides = new Map<number, (value: unknown, now: number) => void>();

  /** Guest: hears one kind of side packet (sideList.ts `SIDE`). */
  side(kind: number, handler: (value: unknown, now: number) => void): void { this.sides.set(kind, handler); }

  /**
   * Host: latest-wins state as JSON on the unreliable `world` lane, beside the enemies' snapshots: never resent, never in the
   * way of a real event, and none for a guest that is behind. Keep it under the safe unreliable size (sideList.ts cuts lists).
   */
  sendSide(kind: number, value: unknown, to?: string): void {
    const text = encoder.encode(JSON.stringify(value));
    const frame = new Uint8Array(3 + text.byteLength);
    frame[0] = SIDE_HEAD[0]; frame[1] = SIDE_HEAD[1]; frame[2] = kind & 0xff;
    frame.set(text, 3);
    const recipients = this.sendSnapshot(frame.buffer, to);
    this.stats.snapshotBytes += frame.byteLength * recipients;
    this.stats.snapshotPackets += recipients;
  }

  /** The `world` lane: an enemy snapshot chunk, or a side packet. */
  private worldIn(data: ArrayBuffer): void {
    if (data.byteLength >= 3) {
      const head = new Uint8Array(data, 0, 3);
      if (head[0] === SIDE_HEAD[0] && head[1] === SIDE_HEAD[1]) {
        const handler = this.sides.get(head[2]!);
        if (!handler || !this.ready || this.hosting) return;
        try { handler(JSON.parse(decoder.decode(new Uint8Array(data, 3))), performance.now()); }
        catch (error) { console.warn('[coop] Dropped a side packet that could not be read', error); }
        return;
      }
    }
    this.onSnapshot(data);
  }

  /**
   * An event on the reliable lane: from a guest to the host; from the host to every guest, or to the one named. It leaves
   * with the frame's other events, in order. One classed cosmetic or latest in its module is not sent to a peer that is behind.
   */
  send(event: WorldEvent, to?: string): void {
    this.queue(event, to, undefined);
  }

  /** Host: passes a guest's event on to every other guest. */
  relay(event: WorldEvent, from: string): void {
    this.queue(event, undefined, from);
  }

  private queue(event: WorldEvent, to: string | undefined, except: string | undefined): void {
    const started = performance.now();
    const recipients = this.action.send(event, to, except, droppable(event.t));
    // The size is the encoded record's, as it travels: nothing is turned to text again to be counted.
    const bytes = this.action.bytes;
    this.stats.eventBytes += bytes * recipients;
    this.stats.eventPackets += recipients;
    metrics.event(event.t, bytes, recipients);
    metrics.spend('coop.send', performance.now() - started);
  }

  private receive(value: WorldEvent, from: string, bytes: number): void {
    if (!this.ready || !value || typeof value !== 'object' || typeof value.t !== 'string') return;
    const started = performance.now();
    metrics.heard(value.t, bytes);
    try { this.router.dispatch(value, from, this.session.hosting, started); }
    catch (error) { console.warn('[coop] Dropped an event that could not be applied', value.t, error); }
    metrics.spend('coop.receive', performance.now() - started);
  }

  /** A game event listened to for as long as the world lives. Listeners run in the order they were added, per event. */
  listen<K extends keyof GameEvents>(type: K, handler: (payload: GameEvents[K]) => void): void {
    this.offs.push(this.ctx.events.on(type, handler));
  }

  /** Host: the guest who sent an event, if their body is in the world (a pose has come in). */
  sender(from: string, now: number): RemotePlayer | null {
    const remote = this.session.remotes.get(from);
    return remote && remote.buffer.sample(now) ? remote : null;
  }

  /** Who an event is about: on the host its sender, on a guest the player in the slot the host stamped on it. */
  playerOf(from: string, slot: number | undefined) {
    return this.session.hosting ? this.session.lobby.players.find(p => p.id === from) : this.session.lobby.players.find(p => p.slot === slot);
  }

  /** Nothing of the world between the two points (the last metre before the target is not checked). */
  visible(origin: Vec, target: Vec): boolean {
    const start = new THREE.Vector3(...origin), direction = new THREE.Vector3(...target).sub(start);
    const range = direction.length();
    return range < 0.1 || !this.ctx.physics.raycast(start, direction.divideScalar(range), Math.max(0, range - 1), CG.World);
  }

  /** Drops every game listener added with `listen`. */
  dispose(): void {
    for (const off of this.offs) off();
  }
}
