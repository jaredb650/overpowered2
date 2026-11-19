/**
 * Test kit for the shared world's unit tests (pods, dropped guns, destructibles): a host and guests joined over a mocked relay,
 * each with a `CoopWorld` on a stub game. Not shipped: only `*.test.ts` files import it.
 */
import * as THREE from 'three';
import { vi } from 'vitest';
import { EventBus } from '../../core/events';
import type { Ctx, GameEvents } from '../../core/contracts';
import type { CoopSession } from '../index';
import { Lobby } from '../lobby';
import type { NetRoom } from '../room';
import { CoopWorld } from '../world';
import type { WorldEvent } from '../worldProtocol';
import { goreDoubles } from './goreDoubles';
import { eventOf } from './pack';

export class Relay {
  readonly rooms: Room[] = [];
  readonly queue: (() => void)[] = [];
  readonly packets: { lane: string; from: string; to?: string; data: unknown }[] = [];
  open(id: string): Room {
    const room = new Room(id, this);
    for (const peer of this.rooms) this.queue.push(() => { peer.join(id); room.join(peer.id); });
    this.rooms.push(room);
    return room;
  }
  flush(): void { while (this.queue.length) this.queue.shift()!(); }
  /** Every world event sent so far of one type. */
  sent<T extends WorldEvent['t']>(t: T): Extract<WorldEvent, { t: T }>[] {
    return this.packets.filter(p => p.lane === 'action').map(p => eventOf<WorldEvent>(p.data)).filter(d => d.t === t) as Extract<WorldEvent, { t: T }>[];
  }
}

export class Room implements NetRoom {
  readonly handlers = new Map<string, (data: unknown, from: string) => void>();
  join: (id: string) => void = () => {};
  constructor(readonly id: string, private readonly relay: Relay) {}
  channel<T>(lane: string) {
    return {
      on: (handler: (data: T, from: string) => void) => this.handlers.set(lane, handler as (data: unknown, from: string) => void),
      send: (data: T, to?: string) => {
        this.relay.packets.push({ lane, from: this.id, to, data: structuredClone(data) });
        for (const peer of this.relay.rooms) if (peer !== this && (!to || peer.id === to)) {
          const copied = structuredClone(data);
          this.relay.queue.push(() => peer.handlers.get(lane)?.(copied, this.id));
        }
      },
    };
  }
  onPeerJoin(handler: (id: string) => void) { this.join = handler; }
  onPeerLeave() {}
  onError() {}
  leave() {}
}

/** A stub game: enough for the world's modules to run. Tests replace what they exercise (`weapons`, `world`, `progression`...). */
export function stubGame() {
  const events = new EventBus<GameEvents>();
  const player = { position: new THREE.Vector3(0, 0, 0), eye: new THREE.Vector3(0, 1.6, 0), forward: new THREE.Vector3(0, 0, -1),
    velocity: new THREE.Vector3(), alive: true, health: 100, maxHealth: 100, armor: 0, grounded: true, downed: false, parked: false,
    reset: vi.fn(), teleport: vi.fn(), takeDamage: vi.fn(), launch: vi.fn(), heal: vi.fn(), addArmor: vi.fn() };
  const alive: unknown[] = [];
  const ctx = { events, player, enemies: { alive, spawn: vi.fn(), withdraw: vi.fn(), applyDamage: vi.fn(), replayDeath: vi.fn(), placeReplica: vi.fn(), ...goreDoubles() },
    weapons: { current: 'smg', owned: new Set(['smg']) }, waves: { wave: 1, phase: 'spawning', nextWaveIn: 0 },
    physics: { raycast: vi.fn(() => null), radialImpulse: vi.fn() },
    world: { playerSpawns: [{ position: new THREE.Vector3(4, 0, 4), yaw: 0 }] },
    hud: { feed: vi.fn(), follow: vi.fn(() => () => {}), callout: vi.fn(), marker: vi.fn(() => () => {}) },
    time: { dt: 0.016, realDt: 0.016, playerDt: 0.016, frame: 0, elapsed: 0 }, progression: { kills: 0, score: 0, headshots: 0, resume: vi.fn() },
    contracts: { wallet: { credits: 0 } }, camera: { setSeat: vi.fn(), addTrauma: vi.fn() },
    input: { pressed: vi.fn(() => false), isDown: vi.fn(() => false) },
    fx: { tracer: vi.fn(), muzzleFlash: vi.fn(), bloodHit: vi.fn(), impact: vi.fn(), explosion: vi.fn(), pickupSparkle: vi.fn(), ring: vi.fn() },
    gore: { wound: vi.fn(), sever: vi.fn() }, audio: { play: vi.fn() }, combat: { fireRay: vi.fn(), explode: vi.fn() }, viewmodel: {} } as unknown as Ctx;
  return { ctx, player };
}

export interface Seat { ctx: Ctx; player: { position: THREE.Vector3 }; lobby: Lobby; room: Room; world: CoopWorld; session: CoopSession }

/**
 * A host and `guests` guests in one match. `build()` makes their worlds. `begin` false leaves the guests' worlds not yet begun
 * (still loading the map): call `seat.world.begin()` when they should arrive. `games` are the games to run on, host first
 * (a test that needs real physics or weapons passes `makeRange()` contexts); a stub game stands in for any not given.
 */
export function party(guests = 1, begin = true, games: Ctx[] = []) {
  const game = (i: number) => (games[i] ? { ctx: games[i]!, player: games[i]!.player as unknown as { position: THREE.Vector3 } } : stubGame());
  const relay = new Relay();
  const door = () => new Room('door', new Relay());
  const hostRoom = relay.open('host-peer');
  const hostLobby = new Lobby({ main: hostRoom, door }, true, 'HOST', 'test');
  const joined: { room: Room; lobby: Lobby }[] = [];
  for (let i = 0; i < guests; i++) {
    const room = relay.open(`guest-${i + 1}`);
    joined.push({ room, lobby: new Lobby({ main: room, door }, false, `GUEST${i + 1}`, 'test') });
    relay.flush();
  }
  hostLobby.startMatch('crucible', 'shared-test'); relay.flush();
  const hostGame = game(0);
  const hostRemotes = new Map<string, unknown>();
  const hostSession = { lobby: hostLobby, hosting: true, match: hostLobby.match, remotes: hostRemotes } as unknown as CoopSession;
  const seats: Seat[] = [];
  joined.forEach(({ room, lobby }, i) => {
    const g = game(i + 1);
    // The host sees each guest's body where that guest's own game has its player.
    const root = new THREE.Group();
    Object.defineProperty(root, 'position', { get: () => g.player.position });
    hostRemotes.set(lobby.you, { player: lobby.me, char: { root, anim: { play: vi.fn() } }, buffer: { sample: () => ({ velocity: [0, 0, 0], yaw: 0 }) },
      setTag: vi.fn(), muzzle: (v: THREE.Vector3) => v.copy(g.player.position) });
    const session = { lobby, hosting: false, match: lobby.match, remotes: new Map() } as unknown as CoopSession;
    seats.push({ ...g, lobby, room, session, world: null as unknown as CoopWorld });
  });
  const host: Seat = { ...hostGame, lobby: hostLobby, room: hostRoom, session: hostSession, world: null as unknown as CoopWorld };
  return {
    relay, host, guests: seats,
    /** Builds every world (after the test has put its own systems on each `ctx`), and begins them. */
    build(): void {
      for (const seat of [host, ...seats]) {
        seat.world = new CoopWorld(seat.ctx, seat.session);
        (seat.session as { world: CoopWorld | null }).world = seat.world;
        seat.ctx.coop = seat.session;
      }
      host.world.begin();
      if (begin) for (const seat of seats) seat.world.begin();
      relay.flush();
    },
    /** One frame of every begun world, then the wire is drained. */
    step(): void {
      host.world.update();
      for (const seat of seats) seat.world.update();
      relay.flush();
    },
    dispose(): void {
      host.world.dispose();
      for (const seat of seats) seat.world.dispose();
    },
  };
}
