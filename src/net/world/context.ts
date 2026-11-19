/**
 * What every co-op world module is handed: the game, the session, the two lanes, the router and the few lookups they share.
 * A module keeps its own state and reaches another module only through that module's public methods (passed to its constructor
 * in world.ts), never through this object.
 */
import * as THREE from 'three';
import { CG, type Ctx, type DamageInfo, type GameEvents } from '../../core/contracts';
import type { EnemyManager } from '../../enemies/EnemyManager';
import { ClaimValidator } from '../authority';
import type { CoopSession } from '../index';
import type { RemotePlayer } from '../remote';
import type { Team, TeamLife } from '../team';
import type { WorldEvent } from '../worldProtocol';
import { Router } from './router';
import type { Vec, WireDamage } from './wire';

/** A feature of the co-op world. world.ts runs `update` on each, in its list's order, once the world has begun. */
export interface WorldModule {
  /** Every frame, host and guest alike. `now` is `performance.now()`, read once for the frame. */
  update?(now: number): void;
  dispose?(): void;
}

/** Damage as it came over the wire, with its vectors back. */
export function unpackDamage(damage: WireDamage): DamageInfo {
  return { ...damage, point: new THREE.Vector3(...damage.point), dir: new THREE.Vector3(...damage.dir),
    slicePlaneNormal: damage.slicePlaneNormal ? new THREE.Vector3(...damage.slicePlaneNormal) : undefined };
}

/** Host: work for a little later (an enemy's blast on a remote player, after its fuse), run from the world's update. */
export class Later implements WorldModule {
  private queue: { at: number; run: () => void }[] = [];
  push(at: number, run: () => void): void { this.queue.push({ at, run }); }
  update(now: number): void {
    const due = this.queue.filter(event => event.at <= now);
    this.queue = this.queue.filter(event => event.at > now);
    for (const event of due) event.run();
  }
  dispose(): void { this.queue = []; }
}

export class WorldContext {
  readonly stats = { snapshotBytes: 0, eventBytes: 0, snapshotPackets: 0, eventPackets: 0, accepted: 0, rejected: 0, since: performance.now() };
  readonly validator = new ClaimValidator();
  readonly router = new Router();
  readonly later = new Later();
  /** The team's lives. Set by world.ts as soon as the team is built (the team needs `send` first). */
  team!: Team;
  /** False until the map is up (`CoopWorld.begin`): events that arrive earlier are dropped, the latest snapshot is kept. */
  ready = false;
  /** The snapshot lane's receiver (replicas.ts sets it). */
  onSnapshot: (data: ArrayBuffer) => void = () => {};
  /** Host: called after each snapshot goes out, with the uids alive in it, for per-enemy state to be forgotten. */
  readonly snapshotSent: ((alive: Set<number>) => void)[] = [];
  /** Sends a snapshot on the `world` lane; returns how many players it went to. */
  readonly sendSnapshot: (data: ArrayBuffer) => number;
  private readonly sendAction: (data: WorldEvent, to?: string) => number;
  private readonly offs: (() => void)[] = [];

  constructor(readonly ctx: Ctx, readonly session: CoopSession) {
    this.sendSnapshot = session.lobby.gameplay<ArrayBuffer>('world', data => this.onSnapshot(data));
    this.sendAction = session.lobby.gameplay<WorldEvent>('action', (data, from) => this.receive(data, from));
  }

  get hosting(): boolean { return this.session.hosting; }
  get manager(): EnemyManager { return this.ctx.enemies as EnemyManager; }
  life(id: string): TeamLife { return this.team.life(id); }

  /** An event on the reliable lane: from a guest to the host; from the host to every guest, or to the one named. */
  send(event: WorldEvent, to?: string): void {
    const recipients = this.sendAction(event, to);
    this.stats.eventBytes += new TextEncoder().encode(JSON.stringify({ match: this.session.match.id, data: event })).byteLength * recipients;
    this.stats.eventPackets += recipients;
  }

  /** Host: passes a guest's event on to every other guest. */
  relay(event: WorldEvent, from: string): void {
    for (const peer of this.session.lobby.players) if (!peer.host && peer.id !== from) this.send(event, peer.id);
  }

  private receive(value: WorldEvent, from: string): void {
    if (!this.ready || !value || typeof value !== 'object' || typeof value.t !== 'string') return;
    try { this.router.dispatch(value, from, this.session.hosting, performance.now()); }
    catch (error) { console.warn('[coop] Dropped an event that could not be applied', value.t, error); }
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
