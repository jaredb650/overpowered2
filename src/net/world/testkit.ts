/**
 * For unit tests of the co-op world: a host and guests wired through a mocked lobby transport, each with a fake game `Ctx`.
 * Messages queue in `relay` and arrive on `relay.flush()`. `extra` adds to (or replaces parts of) a side's fake `Ctx`.
 */
import * as THREE from 'three';
import { vi } from 'vitest';
import type { Ctx, GameEvents, PlayerDamage } from '../../core/contracts';
import { EventBus } from '../../core/events';
import { Enemy } from '../../enemies/Enemy';
import type { CoopSession } from '../index';
import { Lobby } from '../lobby';
import type { NetRoom } from '../room';
import { CoopWorld } from '../world';

export class Relay {
  readonly rooms: Room[] = [];
  readonly queue: (() => void)[] = [];
  readonly packets: { lane: string; data: unknown; from: string; to?: string }[] = [];
  open(id: string): Room {
    const room = new Room(id, this);
    for (const peer of this.rooms) this.queue.push(() => { peer.join(id); room.join(peer.id); });
    this.rooms.push(room);
    return room;
  }
  flush(): void { while (this.queue.length) this.queue.shift()!(); }
  /** The events of type `t` sent on the reliable lane so far. */
  sent<T extends { t: string }>(t: string): T[] {
    return this.packets.filter(p => p.lane === 'action').map(p => (p.data as { data: T }).data).filter(d => d?.t === t);
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
        this.relay.packets.push({ lane, data: structuredClone(data), from: this.id, to });
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

export type Side = ReturnType<typeof context>;

export function context(extra: Record<string, unknown> = {}) {
  const events = new EventBus<GameEvents>();
  let uid = 0;
  const alive: Enemy[] = [];
  const spawn = vi.fn((id: Enemy['id'], at: THREE.Vector3) => {
    const enemy = new Enemy(); enemy.uid = ++uid; enemy.id = id; enemy.health = enemy.maxHealth = 100; enemy.alive = true;
    enemy.position.copy(at); enemy.center.copy(at).y += 1;
    enemy.char = { root: new THREE.Group(), severed: new Set(), rig: { bones: [{ name: 'chest' }] }, hitFlash: vi.fn(),
      anim: { play: vi.fn() } } as unknown as Enemy['char'];
    alive.push(enemy); return enemy;
  });
  const player = { position: new THREE.Vector3(0, 0, 0), eye: new THREE.Vector3(0, 1.6, 0), forward: new THREE.Vector3(0, 0, -1),
    velocity: new THREE.Vector3(), alive: true, health: 100, maxHealth: 100, armor: 0, grounded: true, downed: false, parked: false,
    reset: vi.fn(() => { player.alive = true; player.health = 100; }), teleport: vi.fn(), push: vi.fn(),
    takeDamage: vi.fn((damage: PlayerDamage) => {
      player.health -= damage.amount;
      if (player.health <= 0) { player.alive = false; events.emit('player:died', { source: damage.source }); }
    }),
  };
  const manager = { alive, spawn, withdraw: vi.fn((enemy: Enemy) => { enemy.alive = false; alive.splice(alive.indexOf(enemy), 1); }),
    applyDamage: vi.fn(), replayDeath: vi.fn((enemy: Enemy) => { enemy.alive = false; alive.splice(alive.indexOf(enemy), 1); }),
    placeReplica: vi.fn() };
  const ctx = { events, player, enemies: manager, weapons: { current: 'smg', owned: new Set(['smg']), ammo: () => ({ mag: 30, magSize: 30, reserve: 90, maxReserve: 120 }) }, waves: { wave: 1, phase: 'spawning', nextWaveIn: 0 }, physics: { raycast: vi.fn(() => null) },
    world: { playerSpawns: [{ position: new THREE.Vector3(4, 0, 4), yaw: 0 }] },
    hud: { feed: vi.fn(), follow: vi.fn(() => () => {}), callout: vi.fn(), banner: vi.fn(), floatText: vi.fn(), marker: vi.fn(() => () => {}), hold: vi.fn() },
    time: { dt: 0.016, realDt: 0.016, frame: 0, elapsed: 0 }, progression: { kills: 0, score: 0, headshots: 0, resume: vi.fn() }, contracts: { wallet: { credits: 0 } },
    camera: { setSeat: vi.fn(), addTrauma: vi.fn() }, input: { pressed: vi.fn(() => false), isDown: vi.fn(() => false) },
    fx: { tracer: vi.fn(), muzzleFlash: vi.fn(), bloodHit: vi.fn(), impact: vi.fn(), sparks: vi.fn(), dust: vi.fn(), chips: vi.fn(), smoke: vi.fn(), explosion: vi.fn() },
    gore: { wound: vi.fn(), sever: vi.fn() }, render: { highlight: vi.fn() },
    audio: { play: vi.fn() }, combat: { fireRay: vi.fn(), explode: vi.fn() }, ...extra } as unknown as Ctx;
  return { ctx, manager, player, events };
}

/**
 * A host and `guests` guests in one match, their worlds begun. `extras[0]` goes into the host's `Ctx`, `extras[i]` into guest i's.
 * Each guest's body stands on the host at `bodies[i - 1]` (move it to move where the host thinks that guest is).
 */
export function party(guests = 1, extras: (Record<string, unknown> | undefined)[] = [], mode = 'crucible') {
  const relay = new Relay();
  const door = () => new Room('door', new Relay());
  const hostRoom = relay.open('host-peer');
  const hostLobby = new Lobby({ main: hostRoom, door }, true, 'HOST', 'test');
  const guestLobbies = Array.from({ length: guests }, (_, i) => new Lobby({ main: relay.open(`guest-peer-${i + 1}`), door }, false, `GUEST${i + 1}`, 'test'));
  relay.flush(); hostLobby.startMatch(mode as never, 'world-test'); relay.flush();
  const host = context(extras[0]);
  const sides = guestLobbies.map((_, i) => context(extras[i + 1]));
  const bodies = guestLobbies.map((_, i) => { const root = new THREE.Group(); root.position.set(3 * (i + 1), 0, -5); return root; });
  const remotes = new Map(guestLobbies.map((lobby, i) => [lobby.you, { player: lobby.me, char: { root: bodies[i]!, anim: { play: vi.fn() } },
    buffer: { sample: () => ({ velocity: [0, 0, 0], yaw: 0 }) }, setTag: vi.fn(), muzzle: (v: THREE.Vector3) => v.copy(bodies[i]!.position) }]));
  const hs = { lobby: hostLobby, hosting: true, match: hostLobby.match, remotes } as unknown as CoopSession;
  const hw = new CoopWorld(host.ctx, hs);
  (host.ctx as { coop?: unknown }).coop = { world: hw, hosting: true };
  const gws = guestLobbies.map((lobby, i) => {
    const gs = { lobby, hosting: false, match: lobby.match, remotes: new Map() } as unknown as CoopSession;
    const gw = new CoopWorld(sides[i]!.ctx, gs);
    (sides[i]!.ctx as { coop?: unknown }).coop = { world: gw, hosting: false };
    return gw;
  });
  hw.begin(); for (const gw of gws) gw.begin();
  /** One frame on every side, then every message delivered. */
  const step = () => { hw.update(); for (const gw of gws) gw.update(); relay.flush(); };
  const dispose = () => { hw.dispose(); for (const gw of gws) gw.dispose(); };
  /** Guest `i` sends the host any event at all, as a modified or broken client could. */
  const sendFrom = (i: number, event: unknown) => (gws[i] as unknown as { w: { send(e: unknown): void } }).w.send(event);
  return { relay, host, guests: sides, hw, gws, hostLobby, guestLobbies, bodies, step, dispose, sendFrom };
}
