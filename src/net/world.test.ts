import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/events';
import type { Ctx, DamageInfo, GameEvents, PlayerDamage } from '../core/contracts';
import { Enemy } from '../enemies/Enemy';
import { PlayerSense } from '../enemies/aiWorld';
import type { EnemyManager } from '../enemies/EnemyManager';
import type { CoopSession } from './index';
import { Lobby } from './lobby';
import type { NetRoom } from './room';
import { CoopWorld } from './world';
import { planGib } from '../gore/torso';
import { decodeWorld, encodeWorld, type WorldEvent } from './worldProtocol';
import { RULES } from '../enemies/outpost/chatter/lines';
import type { CommsLine } from '../enemies/outpost/events';

class Relay {
  readonly rooms: Room[] = [];
  readonly queue: (() => void)[] = [];
  readonly packets: { lane: string; data: unknown }[] = [];
  open(id: string): Room {
    const room = new Room(id, this);
    for (const peer of this.rooms) this.queue.push(() => { peer.join(id); room.join(peer.id); });
    this.rooms.push(room);
    return room;
  }
  flush(): void { while (this.queue.length) this.queue.shift()!(); }
}
class Room implements NetRoom {
  readonly handlers = new Map<string, (data: unknown, from: string) => void>();
  join: (id: string) => void = () => {};
  constructor(readonly id: string, private readonly relay: Relay) {}
  channel<T>(lane: string) {
    return {
      on: (handler: (data: T, from: string) => void) => this.handlers.set(lane, handler as (data: unknown, from: string) => void),
      send: (data: T, to?: string) => {
        this.relay.packets.push({ lane, data: structuredClone(data) });
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

function context() {
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
    velocity: new THREE.Vector3(), alive: true, health: 100, grounded: true,
    reset: vi.fn(() => { player.alive = true; player.health = 100; }), teleport: vi.fn(),
    takeDamage: vi.fn((damage: PlayerDamage) => {
      player.health -= damage.amount;
      if (player.health <= 0) { player.alive = false; events.emit('player:died', { source: damage.source }); }
    }),
  };
  const manager = { alive, spawn, withdraw: vi.fn((enemy: Enemy) => { enemy.alive = false; alive.splice(alive.indexOf(enemy), 1); }),
    applyDamage: vi.fn(), replayDeath: vi.fn((enemy: Enemy) => { enemy.alive = false; alive.splice(alive.indexOf(enemy), 1); }),
    placeReplica: vi.fn() };
  const ctx = { events, player, enemies: manager, weapons: { current: 'smg' }, waves: { wave: 1 }, physics: { raycast: vi.fn(() => null) },
    world: { playerSpawns: [{ position: new THREE.Vector3(4, 0, 4), yaw: 0 }] }, hud: { feed: vi.fn() }, time: { dt: 0.016 },
    fx: { tracer: vi.fn(), muzzleFlash: vi.fn(), bloodHit: vi.fn(), impact: vi.fn() }, gore: { wound: vi.fn(), sever: vi.fn() },
    audio: { play: vi.fn() }, combat: { fireRay: vi.fn(), explode: vi.fn() } } as unknown as Ctx;
  return { ctx, manager, player };
}

function pair(beginGuest = true) {
  const relay = new Relay();
  const hr = relay.open('host-peer');
  const hostLobby = new Lobby({ main: hr, door: () => new Room('door', new Relay()) }, true, 'HOST', 'test');
  const gr = relay.open('guest-peer');
  const guestLobby = new Lobby({ main: gr, door: () => new Room('door', new Relay()) }, false, 'GUEST', 'test');
  relay.flush(); hostLobby.startMatch('crucible', 'world-test'); relay.flush();
  const host = context(), guest = context();
  const root = new THREE.Group(); root.position.set(0, 0, -5);
  const remote = { player: guestLobby.me, char: { root, anim: { play: vi.fn() } }, buffer: { sample: () => ({ velocity: [0, 0, 0], yaw: 0 }) } };
  const hs = { lobby: hostLobby, hosting: true, match: hostLobby.match, remotes: new Map([[guestLobby.you, remote]]) } as unknown as CoopSession;
  const gs = { lobby: guestLobby, hosting: false, match: guestLobby.match, remotes: new Map() } as unknown as CoopSession;
  const hw = new CoopWorld(host.ctx, hs), gw = new CoopWorld(guest.ctx, gs);
  hw.begin(); if (beginGuest) gw.begin();
  return { relay, host, guest, hw, gw, hostLobby, guestLobby, hostRoom: hr, guestRoom: gr };
}

describe('host-authoritative world over the mocked lobby transport', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
  afterEach(() => vi.useRealTimers());
  it('buffers the latest snapshot while a guest builds its map', () => {
    const game = pair(false);
    game.host.manager.spawn('husk', new THREE.Vector3(0, 0, -10));
    game.hw.update(); game.relay.flush();
    expect(game.guest.manager.spawn).not.toHaveBeenCalled();
    game.gw.begin();
    expect(game.guest.manager.spawn).toHaveBeenCalledOnce();
    game.hw.dispose(); game.gw.dispose();
  });
  it('does not turn cosmetic enemy or status damage into a guest claim', () => {
    const game = pair();
    game.host.manager.spawn('husk', new THREE.Vector3(0, 0, -10));
    game.hw.update(); game.relay.flush();
    const enemy = game.guest.ctx.enemies.alive[0]!;
    for (const source of ['drone', 'bleed', 'hazard', 'coop']) {
      game.gw.claim(enemy, { amount: 100, type: 'explosive', point: enemy.center.clone(), dir: new THREE.Vector3(0, 1, 0), force: 10, source });
    }
    game.relay.flush();
    expect(game.host.manager.applyDamage).not.toHaveBeenCalled();
    expect(game.relay.packets.filter(packet => packet.lane === 'action')).toHaveLength(0);
    game.hw.dispose(); game.gw.dispose();
  });
  it('tracks a renamed remote through a replacement character root', () => {
    const game = pair();
    const enemy = game.host.manager.spawn('husk', new THREE.Vector3(0, 0, -6));
    const sense = new PlayerSense(); game.hw.select(enemy, sense);
    const remotes = (game.hw as unknown as { session: CoopSession }).session.remotes;
    const remote = remotes.get(game.guestLobby.you)!;
    const replacement = new THREE.Group(); replacement.position.set(0, 0, -4);
    remotes.set(game.guestLobby.you, { ...remote, char: { ...remote.char, root: replacement } } as unknown as typeof remote);
    game.hw.select(enemy, sense);
    expect(sense.position.z).toBe(-4);
    game.hw.dispose(); game.gw.dispose();
  });
  it('sends actual binary snapshots and ignores guest-forged worlds and out-of-order frames', () => {
    const game = pair();
    const enemy = game.host.manager.spawn('husk', new THREE.Vector3(0, 0, -10));
    game.hw.update(); game.relay.flush();
    expect(game.guest.manager.spawn).toHaveBeenCalledOnce();
    const packet = game.relay.packets.find(packet => packet.lane === 'world')!.data;
    expect(packet).toBeInstanceOf(ArrayBuffer);
    expect(decodeWorld(packet)?.enemies[0]?.uid).toBe(enemy.uid);
    game.guestRoom.channel('world').send(encodeWorld({ seq: 200, wave: 99, enemies: [] })); game.relay.flush();
    expect(game.host.ctx.waves.wave).toBe(1);
    game.hostRoom.channel('world').send(encodeWorld({ seq: 0, wave: 99, enemies: [] })); game.relay.flush();
    expect(game.guest.ctx.waves.wave).toBe(1);
    game.gw.updateGuests(); expect(game.guest.manager.placeReplica).toHaveBeenCalledOnce();
    game.hw.dispose(); game.gw.dispose();
  });
  it('routes local AP/HP and Raufoss hit inputs through host applyDamage and rejects a wall', () => {
    const game = pair();
    const enemy = game.host.manager.spawn('riot', new THREE.Vector3(0, 0, -10));
    game.hw.update(); game.relay.flush();
    game.guest.player.eye.set(0, 1.6, -5);
    const replica = game.guest.ctx.enemies.alive[0]!;
    const damage: DamageInfo = { amount: 16, type: 'bullet', point: enemy.center.clone(), dir: new THREE.Vector3(0, 0, -1), force: 12, source: 'smg', region: 'chest', load: 'ap' };
    game.gw.claim(replica, damage); game.relay.flush();
    expect(game.host.manager.applyDamage).toHaveBeenCalledOnce();
    expect(game.host.manager.applyDamage.mock.calls[0]![1]).toMatchObject({ load: 'ap', region: 'chest', amount: 16 });
    game.gw.claim(replica, { ...damage, load: 'hp' }); game.relay.flush();
    game.gw.claim(replica, { ...damage, load: undefined, type: 'pellet', pierces: true }); game.relay.flush();
    expect(game.host.manager.applyDamage).toHaveBeenCalledTimes(3);
    game.host.ctx.physics.raycast = vi.fn(() => ({}) as never);
    game.gw.claim(replica, damage); game.relay.flush();
    expect(game.host.manager.applyDamage).toHaveBeenCalledTimes(3); expect(game.hw.stats.rejected).toBe(1);
    game.hw.dispose(); game.gw.dispose();
  });
  it('replicates wounds, severing and deaths once and never resurrects a killed id', () => {
    const game = pair(); const enemy = game.host.manager.spawn('husk', new THREE.Vector3(0, 0, -10));
    game.hw.update(); game.relay.flush();
    const damage: DamageInfo = { amount: 500, type: 'bullet', point: enemy.center.clone(), dir: new THREE.Vector3(0, 0, -1), force: 20, source: 'smg', region: 'head' };
    game.host.ctx.events.emit('enemy:hit', { enemy, damage, result: { dealt: 1, killed: false, headshot: false, severed: [], blocked: false } }); game.relay.flush();
    expect(game.guest.ctx.gore.wound).toHaveBeenCalledOnce();
    game.host.ctx.events.emit('enemy:severed', { enemy, region: 'armL', damage }); game.relay.flush();
    expect(game.guest.ctx.gore.sever).toHaveBeenCalledOnce();
    game.hostRoom.channel('action').send({ match: 'world-test', data: { t: 'kill', uid: enemy.uid, id: enemy.id, at: enemy.position.toArray(), yaw: 0, damage: { ...damage, point: damage.point.toArray(), dir: damage.dir.toArray() }, gib: true } });
    game.relay.flush(); expect(game.guest.manager.replayDeath).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(101); game.hw.update(); game.relay.flush();
    expect(game.guest.manager.spawn).toHaveBeenCalledOnce();
    game.hw.dispose(); game.gw.dispose();
  });
  it('breaks a gibbed trunk on the guest the way the host did, and hangs the guts the host hung', () => {
    const game = pair(); const enemy = game.host.manager.spawn('trooper', new THREE.Vector3(0, 0, -10));
    game.hw.update(); game.relay.flush();
    // The host's gore writes what it chose on the damage before the events go out (Gore.wound, Gore.gib).
    const pellet: DamageInfo = { amount: 30, type: 'pellet', point: new THREE.Vector3(0.1, 1.05, -9.85), dir: new THREE.Vector3(0, 0, -1), force: 0, source: 'shotgun', region: 'abdomen', spill: true };
    game.host.ctx.events.emit('enemy:hit', { enemy, damage: pellet, result: { dealt: 30, killed: false, headshot: false, severed: [], blocked: false } }); game.relay.flush();
    const wounded = vi.mocked(game.guest.ctx.gore.wound).mock.calls[0]![1];
    expect(wounded.spill).toBe(true);
    game.hw.dispose(); game.gw.dispose();
    for (const force of [300, 900, 1700]) {
      const game = pair(); const enemy = game.host.manager.spawn('trooper', new THREE.Vector3(0, 0, -10));
      game.hw.update(); game.relay.flush();
      const blast: DamageInfo = { amount: 400, type: 'explosive', point: new THREE.Vector3(0.31, 1.13, -9.62 + force * 1e-4), dir: new THREE.Vector3(0, 0, -1), force, source: 'rocket', gib: true };
      const host = planGib(blast, force);
      blast.torso = host.mode;
      game.host.ctx.events.emit('enemy:killed', { enemy, damage: blast, gibbed: true, headshot: false } as never); game.relay.flush();
      const replayed = (vi.mocked(game.guest.manager.replayDeath).mock.calls.at(-1) as unknown as [unknown, DamageInfo])[1];
      expect(replayed.torso).toBe(host.mode);
      // Same pieces, organs, ribcage and guts from the same damage.
      expect(planGib(replayed, replayed.force)).toEqual(host);
      game.hw.dispose(); game.gw.dispose();
    }
  });
  it('sends the host\'s chatter as ids, so every guest sees the same man say the same words', () => {
    const game = pair(); const enemy = game.host.manager.spawn('trooper', new THREE.Vector3(0, 0, -10));
    game.hw.update(); game.relay.flush();
    const heard: CommsLine[] = [];
    game.guest.ctx.events.on('comms:line', line => heard.push({ ...line }));
    const row = RULES.findIndex(r => r.id === 'ch.garrison.manDown.namedPro.1');
    game.host.ctx.events.emit('comms:line', { kind: 'manDown', text: '', squad: 'Alpha', speaker: 'Cpl Marsh · Alpha', enemy, position: enemy.center.clone(), row, name: 0, dead: 1, voice: 1 });
    game.relay.flush();
    const packet = game.relay.packets.filter(p => p.lane === 'action').map(p => (p.data as { data: WorldEvent }).data).find(e => e.t === 'chatter');
    expect(packet).toEqual({ t: 'chatter', uid: enemy.uid, line: row, name: 0, dead: 1, rank: -1, squad: 'Alpha', voice: 1 });
    expect(heard).toHaveLength(1);
    // Same man, same voice, on every machine.
    expect(heard[0]).toMatchObject({ kind: 'manDown', text: 'Kade is down. Keep firing.', row, name: 0, dead: 1, squad: 'Alpha', voice: 1 });
    expect(heard[0]!.enemy).toBe(game.guest.ctx.enemies.alive[0]);
    // Cut off mid-word on the host: every guest sees the same dash at the same letter.
    const cuts: { enemy: unknown; at: number }[] = [];
    game.guest.ctx.events.on('comms:cut', cut => cuts.push(cut));
    game.host.ctx.events.emit('comms:cut', { enemy, at: 7, radio: false }); game.relay.flush();
    expect(cuts).toEqual([{ enemy: game.guest.ctx.enemies.alive[0], at: 7, radio: false }]);
    // Hand-written words stay on the host, and a guest cannot be fed a row that does not exist.
    game.host.ctx.events.emit('comms:line', { kind: 'order', text: 'Words.', squad: 'Command', speaker: null, enemy: null, position: new THREE.Vector3(), row: -1 });
    game.hostRoom.channel('action').send({ match: 'world-test', data: { t: 'chatter', uid: 0, line: RULES.length, name: 0, dead: -1, rank: 0, squad: 'Alpha' } });
    game.relay.flush();
    expect(heard).toHaveLength(1);
    game.hw.dispose(); game.gw.dispose();
  });
  it('selects guests, computes enemy hits and respawns dead players without stopping host simulation', () => {
    const game = pair(); const enemy = game.host.manager.spawn('husk', new THREE.Vector3(0, 0, -6));
    const sense = new PlayerSense(); game.hw.select(enemy, sense);
    expect(sense.position.z).toBe(-5); expect(game.hw.isRemoteTarget()).toBe(true);
    const hit = game.hw.enemyRay(new THREE.Vector3(0, 1, -10), new THREE.Vector3(0, 1, 2), 150, 'trooper');
    expect(hit).not.toBeNull(); game.relay.flush();
    expect(game.guest.player.alive).toBe(false);
    expect(game.hw.lives.get(game.guestLobby.you)?.down).toBe(true);
    game.hw.update(); game.relay.flush();
    vi.advanceTimersByTime(3500); game.hw.update(); game.relay.flush();
    expect(game.guest.player.reset).toHaveBeenCalledOnce(); expect(game.guest.player.alive).toBe(true);
    const stale: WorldEvent = { t: 'hurt', life: 0, amount: 200, from: [0, 1, -10], type: 'bullet', source: 'trooper' };
    game.hostRoom.channel('action').send({ match: 'world-test', data: stale }); game.relay.flush();
    expect(game.guest.player.health).toBe(100);
    game.host.ctx.events.emit('player:died', { source: 'husk' });
    vi.advanceTimersByTime(3500); game.hw.update(); game.relay.flush();
    expect(game.host.player.reset).toHaveBeenCalledOnce();
    expect(game.hw.stats.snapshotPackets).toBeGreaterThan(0);
    game.hw.dispose(); game.gw.dispose();
  });
});
