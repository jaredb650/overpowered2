import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/events';
import type { Ctx, DamageInfo, GameEvents, PlayerDamage } from '../core/contracts';
import type { DamageResult } from '../core/gameplay';
import type { GoreRegion } from '../characters/rig';
import { newFacts, type HitFacts, type KillFacts } from '../enemies/damage';
import { Enemy } from '../enemies/Enemy';
import { PlayerSense } from '../enemies/aiWorld';
import type { EnemyManager } from '../enemies/EnemyManager';
import type { CoopSession } from './index';
import { Lobby } from './lobby';
import type { NetRoom } from './room';
import { CoopWorld } from './world';
import { planGib } from '../gore/torso';
import { decodeChunk, encodeChunk, type WorldEvent } from './worldProtocol';
import { RULES } from '../enemies/outpost/chatter/lines';
import { TUNING } from '../weapons/data';
import type { CommsLine } from '../enemies/outpost/events';
import { eventOf, batchOf } from './world/pack';

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
    velocity: new THREE.Vector3(), alive: true, health: 100, maxHealth: 100, armor: 0, grounded: true, downed: false, parked: false,
    reset: vi.fn(() => { player.alive = true; player.health = 100; }), teleport: vi.fn(),
    takeDamage: vi.fn((damage: PlayerDamage) => {
      player.health -= damage.amount;
      if (player.health <= 0) { player.alive = false; events.emit('player:died', { source: damage.source }); }
    }),
  };
  // The damage model's part is src/enemies/damage.coop.test.ts: here it is counted, and says what it is told to have found.
  const model = { found: newFacts(), foundKill: { blast: null, shatter: false, heavyHead: false } as KillFacts };
  const guess = { dealt: 0, killed: false, headshot: false, severed: [], blocked: false } as DamageResult;
  const manager = { alive, spawn, model, guess, withdraw: vi.fn((enemy: Enemy) => { enemy.alive = false; alive.splice(alive.indexOf(enemy), 1); }),
    applyDamage: vi.fn(), afflict: vi.fn(), replayDeath: vi.fn((enemy: Enemy, _damage: DamageInfo, _gib: boolean, _told?: KillFacts, _eye?: THREE.Vector3 | null) => { enemy.alive = false; alive.splice(alive.indexOf(enemy), 1); }),
    predictDamage: vi.fn((_enemy: Enemy, damage: DamageInfo) => ({ ...guess, dealt: guess.blocked ? 0 : damage.amount })),
    showDamage: vi.fn((_enemy: Enemy, _damage: DamageInfo, told: HitFacts, _eye: THREE.Vector3 | null) => ({ dealt: told.amount, killed: false, headshot: told.headshot, severed: [], blocked: told.stop !== 'none' }) as DamageResult),
    showSever: vi.fn((enemy: Enemy, region: GoreRegion, _damage: DamageInfo, _eye: THREE.Vector3 | null, _mine: boolean) => { (enemy.char.severed as Set<GoreRegion>).add(region); }),
    showReaction: vi.fn(), rouseReplica: vi.fn(), placeReplica: vi.fn() };
  const ctx = { events, player, enemies: manager, weapons: { current: 'smg' }, waves: { wave: 1 }, physics: { raycast: vi.fn(() => null) },
    world: { playerSpawns: [{ position: new THREE.Vector3(4, 0, 4), yaw: 0 }] }, hud: { feed: vi.fn(), follow: vi.fn(() => () => {}), callout: vi.fn() },
    time: { dt: 0.016, realDt: 0.016, frame: 0 }, progression: { kills: 0, score: 0, headshots: 0, resume: vi.fn() }, contracts: { wallet: { credits: 0 } },
    camera: { setSeat: vi.fn(), addTrauma: vi.fn() }, input: { pressed: vi.fn(() => false), isDown: vi.fn(() => false) },
    fx: { tracer: vi.fn(), muzzleFlash: vi.fn(), bloodHit: vi.fn(), impact: vi.fn() }, gore: { wound: vi.fn(), sever: vi.fn() },
    audio: { play: vi.fn() }, combat: { fireRay: vi.fn(), explode: vi.fn(), remoteHit: vi.fn(), killConfirm: vi.fn(), severConfirm: vi.fn() } } as unknown as Ctx;
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
  const remote = { player: guestLobby.me, char: { root, anim: { play: vi.fn() } }, buffer: { sample: () => ({ velocity: [0, 0, 0], yaw: 0 }) },
    setTag: vi.fn(), muzzle: (v: THREE.Vector3) => v.copy(root.position),
    // The friend's weapons as this screen draws them (weapons/watch.ts): its own tests are remoteFire.test.ts.
    watcher: { held: true, hold: vi.fn(), fire: vi.fn(), loop: vi.fn(), launch: vi.fn() } };
  const hs = { lobby: hostLobby, hosting: true, match: hostLobby.match, remotes: new Map([[guestLobby.you, remote]]) } as unknown as CoopSession;
  const gs = { lobby: guestLobby, hosting: false, match: guestLobby.match, remotes: new Map() } as unknown as CoopSession;
  const hw = new CoopWorld(host.ctx, hs), gw = new CoopWorld(guest.ctx, gs);
  hw.begin(); if (beginGuest) gw.begin();
  // The guest's world says it is up (`worldsync`) and the host settles its seat and catches it up, before the test begins.
  relay.flush();
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
    expect(game.relay.packets.filter(packet => packet.lane === 'action' && eventOf<WorldEvent>(packet.data).t === 'hit')).toHaveLength(0);
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
    const sent = decodeChunk(packet)!;
    expect(sent.enemies[0]?.uid).toBe(enemy.uid);
    game.guestRoom.channel('world').send(encodeChunk({ time: sent.time + 1000, tick: 200, wave: 99, enemies: [] })); game.relay.flush();
    expect(game.host.ctx.waves.wave).toBe(1);
    // A chunk from before the newest one heard says nothing new about the wave.
    game.hostRoom.channel('world').send(encodeChunk({ time: sent.time - 40, tick: 0, wave: 99, enemies: [] })); game.relay.flush();
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
    // A wall on the host only (the two machines' worlds differ): AP goes through it; a plain round from 20 m gets the benefit
    // of the doubt eight times, then a wall is a wall.
    game.host.ctx.physics.raycast = vi.fn(() => ({}) as never);
    game.gw.claim(replica, damage); game.relay.flush();
    expect(game.host.manager.applyDamage).toHaveBeenCalledTimes(4);
    game.guest.player.eye.set(0, 1.6, 8);
    const plain = { ...damage, load: undefined };
    for (let i = 0; i < 9; i++) game.gw.claim(replica, plain);
    game.relay.flush();
    expect(game.host.manager.applyDamage).toHaveBeenCalledTimes(12); expect(game.hw.stats.rejected).toBe(1);
    expect(game.hw.validator.refused.sight).toBe(1);
    game.hw.dispose(); game.gw.dispose();
  });
  it('numbers a guest\'s shots itself, never invents a fire event, and flags a round that did not come straight from the eye', () => {
    const game = pair();
    const enemy = game.host.manager.spawn('husk', new THREE.Vector3(0, 0, -10));
    game.hw.update(); game.relay.flush();
    game.guest.player.eye.set(0, 1.6, -5);
    const replica = game.guest.ctx.enemies.alive[0]!;
    const sent = () => game.relay.packets.filter(packet => packet.lane === 'action').map(packet => eventOf<WorldEvent>(packet.data));
    const hits = () => sent().filter(event => event.t === 'hit') as Extract<WorldEvent, { t: 'hit' }>[];
    const at = (source: string, type: DamageInfo['type'] = 'bullet'): DamageInfo =>
      ({ amount: 20, type, point: enemy.center.clone(), dir: new THREE.Vector3(0, 0, -1), force: 5, source, region: 'chest' });
    // A ground slam, a parried round, a mounted gun and a perk: claims of their own kind, and no made-up gun shot for anyone to see.
    for (const [source, type] of [['slam', 'crush'], ['sword_deflect', 'bullet'], ['emplacement', 'bullet'], ['chain_storm', 'shock']] as const) game.gw.claim(replica, at(source, type));
    game.relay.flush();
    expect(sent().filter(event => event.t === 'fire')).toHaveLength(0);
    expect(game.host.manager.applyDamage).toHaveBeenCalledTimes(4);
    expect(game.hw.stats.rejected).toBe(0);
    // Every real shot is a new shot id; hits of one shot share it; a round that lands 100 ms after the last shot gets its own.
    const first = hits().at(-1)!.shot;
    game.guest.ctx.events.emit('weapon:fired', { weapon: 'smg', origin: game.guest.player.eye, dir: game.guest.player.forward });
    game.gw.claim(replica, at('smg')); game.gw.claim(replica, at('smg'));
    game.guest.ctx.events.emit('weapon:fired', { weapon: 'smg', origin: game.guest.player.eye, dir: game.guest.player.forward });
    game.gw.claim(replica, at('smg'));
    vi.advanceTimersByTime(150);
    game.gw.claim(replica, at('stakegun'));
    expect(hits().slice(-4).map(hit => hit.shot - first)).toEqual([1, 1, 2, 3]);
    expect(game.gw.shot).toBe(first + 3);
    expect(hits().at(-1)!.at).toBeGreaterThan(hits().at(-2)!.at!);
    expect(hits().every(hit => hit.hop === undefined)).toBe(true);
    // A ricochet comes from another direction; a round through a wall has the guest's own wall on its line.
    game.gw.claim(replica, { ...at('smg'), dir: new THREE.Vector3(1, 0, 0) });
    expect(hits().at(-1)!.hop).toBe(1);
    game.guest.player.eye.set(0, 1.6, 8);
    game.guest.ctx.physics.raycast = vi.fn(() => ({}) as never);
    game.gw.claim(replica, { ...at('smg'), dir: new THREE.Vector3(0, 0, -1) });
    expect(hits().at(-1)!.hop).toBe(1);
    // The host, whose own world has a wall there too, takes both: there is no straight line to test.
    game.host.ctx.physics.raycast = vi.fn(() => ({}) as never);
    game.relay.flush();
    expect(game.hw.stats.rejected).toBe(0);
    // The shot being applied is readable on the host while it is applied, for the answer that goes back.
    let seen: [string | null, number] = [null, 0];
    game.host.manager.applyDamage.mockImplementationOnce(() => { seen = [game.hw.applying, game.hw.applyingShot]; });
    game.gw.claim(replica, at('smg')); game.relay.flush();
    expect(seen).toEqual([game.guestLobby.you, game.gw.shot]);
    expect(game.hw.applying).toBeNull();
    game.hw.dispose(); game.gw.dispose();
  });
  it('takes a hit on where an enemy stood a moment ago: a man thrown across the room is still there on the shooter\'s screen', () => {
    const game = pair();
    const enemy = game.host.manager.spawn('husk', new THREE.Vector3(0, 0, -10));
    game.hw.update(); game.relay.flush();
    game.guest.player.eye.set(0, 1.6, -5);
    const replica = game.guest.ctx.enemies.alive[0]!;
    const damage: DamageInfo = { amount: 16, type: 'pellet', point: replica.center.clone(), dir: new THREE.Vector3(0, 0, -1), force: 12, source: 'deuce', region: 'chest' };
    // The host's body is flung 30 m between two of the guest's shots; the host has noted where it was.
    vi.advanceTimersByTime(150); game.hw.update();
    enemy.position.set(0, 0, -40); enemy.center.set(0, 1, -40);
    vi.advanceTimersByTime(150); game.hw.update();
    game.gw.claim(replica, damage); game.relay.flush();
    expect(game.host.manager.applyDamage).toHaveBeenCalledOnce();
    // Still his three seconds later, on a link that runs that far behind.
    for (let i = 0; i < 30; i++) { vi.advanceTimersByTime(100); game.hw.update(); }
    game.gw.claim(replica, damage); game.relay.flush();
    expect(game.host.manager.applyDamage).toHaveBeenCalledTimes(2);
    game.host.manager.applyDamage.mockClear(); game.gw.claim(replica, damage); game.relay.flush();
    // Eight seconds on, the place he left is no longer his.
    for (let i = 0; i < 80; i++) { vi.advanceTimersByTime(100); game.hw.update(); }
    game.gw.claim(replica, damage); game.relay.flush();
    expect(game.host.manager.applyDamage).toHaveBeenCalledOnce();
    expect(game.hw.validator.refused.point).toBe(1);
    // Knocked down on the host: the ragdoll (his centre) lies 30 m off, but his root, which is where a guest draws him standing, has not moved.
    enemy.position.set(0, 0, -10);
    game.gw.claim(replica, damage); game.relay.flush();
    expect(game.host.manager.applyDamage).toHaveBeenCalledTimes(2);
    // Down on the host, he lies wherever each screen's own ragdoll fell: a hit on the guest's is a hit.
    enemy.position.set(0, 0, -40); enemy.downed = true;
    for (let i = 0; i < 80; i++) { vi.advanceTimersByTime(100); game.hw.update(); }
    game.gw.claim(replica, damage); game.relay.flush();
    expect(game.host.manager.applyDamage).toHaveBeenCalledTimes(3);
    game.hw.dispose(); game.gw.dispose();
  });
  it('takes a guest\'s round and blast to the host\'s vehicles, as claims and not as part of the drawing', () => {
    const game = pair();
    const truck = { alive: true, def: { kind: 'truck' }, position: new THREE.Vector3(0, 0, -20), quaternion: new THREE.Quaternion() };
    const claimed = vi.fn(() => true), blast = vi.fn(() => 1);
    (game.host.ctx.enemies as unknown as { vehicles: unknown }).vehicles = { live: [truck], claimed, blast };
    game.hw.update(); game.relay.flush();
    const sent = () => game.relay.packets.filter(packet => packet.lane === 'action').map(packet => eventOf<WorldEvent>(packet.data));
    // The vehicles' state rides the unreliable lane as a side packet (world/sideList.ts): two bytes of head, the kind, then JSON.
    const side = game.relay.packets.filter(packet => packet.lane === 'world' && packet.data instanceof ArrayBuffer).map(packet => new Uint8Array(packet.data as ArrayBuffer))
      .filter(bytes => bytes[0] === 0x05 && bytes[1] === 0xc2 && bytes[2] === 1).map(bytes => JSON.parse(new TextDecoder().decode(bytes.subarray(3))) as { list: { id: number }[] });
    expect(sent().some(event => event.t === 'vehicles')).toBe(false);
    const id = side[0]!.list[0]!.id;
    // Straight to the claim: the guest's hit boxes need the real physics world (the browser proof covers them).
    const guestClaims = (game.gw as unknown as { claims: { vehicleHit(...args: unknown[]): void; vehicleBlast(...args: unknown[]): void } }).claims;
    guestClaims.vehicleHit(id, 'engine', new THREE.Vector3(0.2, 1, 1.5), 60, 'harrow');
    guestClaims.vehicleHit(id, 'cab', new THREE.Vector3(0, 1.4, 0.5), 300, 'rocket', 'rocket');
    guestClaims.vehicleHit(999, 'cab', new THREE.Vector3(), 300, 'rocket');
    guestClaims.vehicleBlast(new THREE.Vector3(1, 0, -20), { radius: 6, damage: 500, kind: 'rocket', source: 'rocket', team: 'player' });
    guestClaims.vehicleBlast(new THREE.Vector3(1, 0, -20), { radius: 5, damage: 99999, kind: 'shell', source: 'autocannon', team: 'player', instakill: true });
    guestClaims.vehicleBlast(new THREE.Vector3(1, 0, -20), { radius: 5, damage: 99, kind: 'rocket', source: 'trooper', team: 'enemy' });
    game.relay.flush();
    expect(claimed.mock.calls.map(call => (call as unknown[]).slice(1, 2).concat((call as unknown[]).slice(3)))).toEqual([['engine', 60, 'harrow', undefined], ['cab', 300, 'rocket', 'rocket']]);
    expect((claimed.mock.calls[0] as unknown[])[0]).toBe(truck);
    expect(blast.mock.calls.map(call => (call as unknown[])[1])).toEqual([
      { radius: 6, damage: 500, kind: 'rocket', source: 'rocket', team: 'player', instakill: undefined },
      { radius: 5, damage: 20000, kind: 'shell', source: 'autocannon', team: 'player', instakill: true }]);
    expect(game.hw.stats.rejected).toBe(0);
    expect(game.hw.validator.refused).toMatchObject({ gone: 1 });
    // The drawing of an explosion carries no damage any more.
    game.gw.blast(new THREE.Vector3(0, 0, -20), { radius: 6, damage: 500, kind: 'rocket', source: 'rocket', team: 'player' });
    expect(sent().filter(event => event.t === 'boom').every(event => !('damage' in event))).toBe(true);
    game.hw.dispose(); game.gw.dispose();
  });
  it('takes a guest\'s fire, frost and live bolt to the host, a renewed one four times a second and once more at the end', () => {
    const game = pair();
    game.host.manager.spawn('husk', new THREE.Vector3(0, 0, -10));
    game.hw.update(); game.relay.flush();
    const replica = game.guest.ctx.enemies.alive[0]!;
    const hostEnemy = game.host.ctx.enemies.alive[0]!;
    // Standing in napalm: renewed every frame for half a second.
    for (let frame = 0; frame < 30; frame++) { game.gw.status(replica, 'burn', 6); vi.advanceTimersByTime(16); game.gw.update(); }
    vi.advanceTimersByTime(300); game.gw.update();
    game.gw.status(replica, 'freeze', 4); game.gw.status(replica, 'bolt', 1.2);
    game.relay.flush();
    const calls = game.host.manager.afflict.mock.calls;
    expect(calls.every(call => call[0] === hostEnemy)).toBe(true);
    const burns = calls.filter(call => call[1] === 'burn');
    expect(burns.length).toBeGreaterThanOrEqual(2); expect(burns.length).toBeLessThanOrEqual(4);
    expect(burns.every(call => call[2] === 6)).toBe(true);
    expect(calls.filter(call => call[1] === 'freeze').map(call => call[2])).toEqual([4]);
    expect(calls.filter(call => call[1] === 'bolt').map(call => call[2])).toEqual([1.2]);
    // The host's own never goes out as a claim.
    const before = game.relay.packets.length;
    game.hw.status(hostEnemy, 'burn', 6);
    expect(game.relay.packets.length).toBe(before);
    game.hw.dispose(); game.gw.dispose();
  });
  it('turns a guest\'s instakill on a boss into the boss hit a host player gets', () => {
    const game = pair();
    const boss = game.host.manager.spawn('husk', new THREE.Vector3(0, 0, -10)); boss.isBoss = true;
    game.host.manager.spawn('husk', new THREE.Vector3(2, 0, -10));
    game.hw.update(); game.relay.flush();
    game.guest.player.eye.set(0, 1.6, -5);
    game.hw.validator.callIn(game.guestLobby.you, performance.now());
    const [bossReplica, gruntReplica] = game.guest.ctx.enemies.alive;
    const hit = (target: { center: THREE.Vector3 }, amount: number, source: string, type: string, blastKind?: string) =>
      ({ amount, type, point: target.center.clone(), dir: new THREE.Vector3(0, -1, 0), force: 10, source, blastKind }) as DamageInfo;
    game.gw.claim(bossReplica!, hit(bossReplica!, 99999, 'black_sun', 'explosive', 'finisher'));
    game.gw.claim(bossReplica!, hit(bossReplica!, 999999, 'nuke', 'true'));
    game.gw.claim(gruntReplica!, hit(gruntReplica!, 99999, 'black_sun', 'explosive', 'finisher'));
    game.relay.flush();
    expect(game.host.manager.applyDamage.mock.calls.map(([enemy, damage]) => [(enemy as Enemy).isBoss, (damage as DamageInfo).amount]))
      .toEqual([[true, TUNING.autocannon.bossDamage], [true, TUNING.autocannon.bossDamage], [false, 99999]]);
    game.hw.dispose(); game.gw.dispose();
  });
  it('shows a hit, a cut and a death once each on a guest and never resurrects a killed id', () => {
    const game = pair(); const enemy = game.host.manager.spawn('husk', new THREE.Vector3(0, 0, -10));
    game.hw.update(); game.relay.flush();
    const replica = game.guest.ctx.enemies.alive[0]!;
    const damage: DamageInfo = { amount: 500, type: 'bullet', point: enemy.center.clone(), dir: new THREE.Vector3(0, 0, -1), force: 20, source: 'smg', region: 'head' };
    // The host's damage model found this much; the guest shows the hit from that, not from a guess of its own.
    Object.assign(game.host.manager.model.found, { amount: 37.5, headshot: true, level: 'stagger', strength: 0.4 });
    enemy.health = 62.5;
    game.host.ctx.events.emit('enemy:hit', { enemy, damage, result: { dealt: 37.5, killed: false, headshot: true, severed: [], blocked: false } }); game.relay.flush();
    expect(game.guest.manager.showDamage).toHaveBeenCalledOnce();
    const [shown, round, told, eye] = game.guest.manager.showDamage.mock.calls[0]!;
    expect(shown).toBe(replica);
    expect(round).toMatchObject({ amount: 500, type: 'bullet', source: 'smg', region: 'head', force: 20 });
    expect(told).toMatchObject({ amount: 37.5, headshot: true, level: 'stagger', strength: 0.4, stop: 'none' });
    // The host fired it: gore sizes by range from the host's body, which this guest has no copy of in this test.
    expect(eye).toBeNull();
    expect(replica.health).toBe(62.5);
    // The round lands on the guest's screen as it did on the shooter's: blood or sparks where it struck.
    expect(game.guest.ctx.combat.remoteHit).toHaveBeenCalledOnce();
    // A cut is one event, at the region it was made; the events for the other regions it took send nothing.
    game.host.ctx.events.emit('enemy:severed', { enemy, region: 'forearmL', damage, cut: 'armL' });
    game.host.ctx.events.emit('enemy:severed', { enemy, region: 'armL', damage }); game.relay.flush();
    expect(game.guest.manager.showSever).toHaveBeenCalledOnce();
    expect(game.guest.manager.showSever.mock.calls[0]![1]).toBe('armL');
    expect(game.guest.manager.showSever.mock.calls[0]![4]).toBe(false);
    Object.assign(game.host.manager.model.foundKill, { blast: 'waist', shatter: true, heavyHead: true });
    game.host.ctx.events.emit('enemy:killed', { enemy, damage, gibbed: true, headshot: false } as never); game.relay.flush();
    expect(game.guest.manager.replayDeath).toHaveBeenCalledOnce();
    // What the host found about the death that this screen could not work out.
    expect(game.guest.manager.replayDeath.mock.calls[0]![3]).toEqual({ blast: 'waist', shatter: true, heavyHead: true, wound: 0 });
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
    const wounded = game.guest.manager.showDamage.mock.calls[0]![1];
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
  it('draws a guest\'s own hit at once and sends it no picture back: the host\'s answer only puts right what was guessed wrong', () => {
    const game = pair();
    const enemy = game.host.manager.spawn('husk', new THREE.Vector3(0, 0, -10));
    game.hw.update(); game.relay.flush();
    game.guest.player.eye.set(0, 1.6, -5);
    const replica = game.guest.ctx.enemies.alive[0] as Enemy;
    const hostEvents: GameEvents['enemy:hit'][] = [];
    // The host's damage model: it takes 40 off, and says what it found.
    const answer = { level: 'stagger', stop: 'none' as HitFacts['stop'] };
    game.host.manager.applyDamage.mockImplementation((target: Enemy, damage: DamageInfo) => {
      const stopped = answer.stop !== 'none';
      if (!stopped) target.health -= 40;
      Object.assign(game.host.manager.model.found, newFacts(), { amount: 40, level: answer.level, stop: answer.stop, armour: stopped ? 'stopped' : undefined });
      const result = { dealt: 40, killed: false, headshot: false, severed: [], blocked: stopped } as DamageResult;
      hostEvents.push({ enemy: target, damage, result });
      game.host.ctx.events.emit('enemy:hit', { enemy: target, damage, result });
    });
    const shot = (): DamageInfo => ({ amount: 40, type: 'bullet', point: enemy.center.clone(), dir: new THREE.Vector3(0, 0, -1), force: 12, source: 'smg', region: 'chest' });
    const packets = () => game.relay.packets.filter(p => p.lane === 'action').map(p => eventOf<WorldEvent>(p.data));

    // On the frame of the shot, before anything has crossed the wire: the guest's own model has drawn it.
    game.gw.claim(replica, shot());
    expect(game.guest.manager.predictDamage).toHaveBeenCalledOnce();
    expect(game.host.manager.applyDamage).not.toHaveBeenCalled();
    expect(replica.owed).toBe(40);
    game.relay.flush();
    // The host applied the claim with the guest's number on it, and answered the shooter with an `ack`, not a `hitfx`.
    expect(game.host.manager.applyDamage).toHaveBeenCalledOnce();
    expect(hostEvents[0]!.damage.claim).toBe(1);
    expect(packets().filter(e => e.t === 'ack')).toHaveLength(1);
    expect(packets().filter(e => e.t === 'hitfx')).toHaveLength(0);
    // Nothing is drawn twice: the answer settles the health and what the hit still owed.
    expect(game.guest.manager.showDamage).not.toHaveBeenCalled();
    expect(game.guest.manager.showReaction).not.toHaveBeenCalled();
    expect(replica.health).toBe(60);
    expect(replica.owed).toBe(0);
    expect(game.gw.hitsSeen).toMatchObject({ predicted: 1, acks: 1, corrected: 0 });
    // The host's own screen shows where the guest's round landed, and its own hit sounds stay out of it (`notMine`).
    expect(game.host.ctx.combat.remoteHit).toHaveBeenCalledOnce();

    // The host's body went down and the guest's did not: it goes down now, from the host's findings, with no second wound.
    answer.level = 'felled';
    game.gw.claim(replica, shot()); game.relay.flush();
    expect(game.guest.manager.showReaction).toHaveBeenCalledOnce();
    expect(game.guest.manager.showReaction.mock.calls[0]![2]).toMatchObject({ level: 'felled' });
    expect(game.guest.manager.showDamage).not.toHaveBeenCalled();
    // The guest's went down and the host's only flinched: it gets up.
    answer.level = 'flinch';
    game.guest.manager.model.found.level = 'felled';
    game.gw.claim(replica, shot()); game.relay.flush();
    expect(game.guest.manager.rouseReplica).toHaveBeenCalledOnce();
    game.guest.manager.model.found.level = 'flinch';
    // Drawn as blood, and the host's armour stopped it: the sparks of it, late.
    answer.stop = 'plate';
    game.gw.claim(replica, shot()); game.relay.flush();
    expect(game.guest.ctx.combat.remoteHit).toHaveBeenCalledOnce();
    expect(vi.mocked(game.guest.ctx.combat.remoteHit!).mock.calls[0]![2]).toMatchObject({ blocked: true });
    // Drawn as stopped, and it went in: the whole hit, now.
    answer.stop = 'none';
    game.guest.manager.guess.blocked = true;
    game.gw.claim(replica, shot()); game.relay.flush();
    expect(game.guest.manager.showDamage).toHaveBeenCalledOnce();
    expect(game.gw.hitsSeen.corrected).toBe(4);
    game.hw.dispose(); game.gw.dispose();
  });
  it('forgets a hit the host never answered, so a dropped claim does not go on counting against the enemy\'s health', () => {
    const game = pair();
    game.host.manager.spawn('husk', new THREE.Vector3(0, 0, -10));
    game.hw.update(); game.relay.flush();
    const replica = game.guest.ctx.enemies.alive[0] as Enemy;
    // Shot from where the host cannot credit it: no answer comes.
    game.host.ctx.physics.raycast = vi.fn(() => ({}) as never);
    game.guest.player.eye.set(0, 1.6, -5);
    game.gw.claim(replica, { amount: 40, type: 'bullet', point: replica.center.clone(), dir: new THREE.Vector3(0, 0, -1), force: 12, source: 'smg', region: 'chest' });
    game.relay.flush();
    expect(replica.owed).toBe(40);
    vi.advanceTimersByTime(3000); game.gw.update();
    expect(replica.owed).toBe(0);
    game.hw.dispose(); game.gw.dispose();
  });
  it('tells the shooter of a kill its gun did not announce, and runs what was waiting on the body', () => {
    const game = pair();
    const enemy = game.host.manager.spawn('husk', new THREE.Vector3(0, 0, -10));
    game.hw.update(); game.relay.flush();
    game.guest.player.eye.set(0, 1.6, -5);
    const replica = game.guest.ctx.enemies.alive[0]!;
    game.host.manager.applyDamage.mockImplementation((target: Enemy, damage: DamageInfo) => {
      target.alive = false;
      game.host.ctx.events.emit('enemy:killed', { enemy: target, damage, headshot: true, gibbed: false } as never);
    });
    const pinned = vi.fn();
    game.gw.whenKilled(replica, pinned);
    game.gw.claim(replica, { amount: 40, type: 'bullet', point: enemy.center.clone(), dir: new THREE.Vector3(0, 0, -1), force: 12, source: 'smg', region: 'head' });
    expect(pinned).not.toHaveBeenCalled();
    game.relay.flush();
    // The guest's model had not guessed the kill: the marker, the headshot's sound and its mist come with the host's word.
    expect(game.guest.ctx.combat.killConfirm).toHaveBeenCalledOnce();
    expect(vi.mocked(game.guest.ctx.combat.killConfirm!).mock.calls[0]![1]).toBe(true);
    expect(pinned).toHaveBeenCalledOnce();
    expect(game.gw.hitsSeen.lateKills).toBe(1);

    // A kill the guest's gun did announce (`killSoon`) is not announced twice.
    const second = game.host.manager.spawn('husk', new THREE.Vector3(1, 0, -10));
    vi.advanceTimersByTime(101); game.hw.update(); game.relay.flush();
    const copy = game.guest.ctx.enemies.alive.find(e => e.uid === second.uid)!;
    game.guest.manager.guess.killSoon = true;
    vi.advanceTimersByTime(200);
    game.guest.ctx.events.emit('weapon:fired', { weapon: 'smg', origin: new THREE.Vector3(0, 1.6, -5), dir: new THREE.Vector3(0, 0, -1) } as never);
    game.gw.claim(copy, { amount: 40, type: 'bullet', point: second.center.clone(), dir: new THREE.Vector3(0, 0, -1), force: 12, source: 'smg', region: 'head' });
    game.relay.flush();
    expect(game.guest.ctx.combat.killConfirm).toHaveBeenCalledOnce();
    game.hw.dispose(); game.gw.dispose();
  });
  it('sends the host\'s chatter as ids, so every guest sees the same man say the same words', () => {
    const game = pair(); const enemy = game.host.manager.spawn('trooper', new THREE.Vector3(0, 0, -10));
    game.hw.update(); game.relay.flush();
    const heard: CommsLine[] = [];
    game.guest.ctx.events.on('comms:line', line => heard.push({ ...line }));
    const row = RULES.findIndex(r => r.id === 'ch.garrison.manDown.namedPro.1');
    game.host.ctx.events.emit('comms:line', { kind: 'manDown', text: '', squad: 'Alpha', speaker: 'Cpl Marsh · Alpha', enemy, position: enemy.center.clone(), row, name: 0, dead: 1, voice: 1 });
    game.relay.flush();
    const packet = game.relay.packets.filter(p => p.lane === 'action').map(p => eventOf<WorldEvent>(p.data)).find(e => e.t === 'chatter');
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
    game.hostRoom.channel('action').send(batchOf('world-test', [{ t: 'chatter', uid: 0, line: RULES.length, name: 0, dead: -1, rank: 0, squad: 'Alpha' }]));
    game.relay.flush();
    expect(heard).toHaveLength(1);
    game.hw.dispose(); game.gw.dispose();
  });
  it('selects guests, computes enemy hits, downs a guest instead of killing them, and drops stale damage', () => {
    const game = pair(); const enemy = game.host.manager.spawn('husk', new THREE.Vector3(0, 0, -6));
    const sense = new PlayerSense(); game.hw.select(enemy, sense);
    expect(sense.position.z).toBe(-5); expect(game.hw.isRemoteTarget()).toBe(true);
    const hit = game.hw.enemyRay(new THREE.Vector3(0, 1, -10), new THREE.Vector3(0, 1, 2), 150, 'trooper');
    expect(hit).not.toBeNull(); game.relay.flush();
    expect(game.guest.player.alive).toBe(false);
    expect(game.guest.player.downed).toBe(true);
    expect(game.hw.team.lives.get(game.guestLobby.you)?.state).toBe('down');
    // Down is not a target: the enemy turns to the host.
    game.hw.select(enemy, sense);
    expect(game.hw.isRemoteTarget()).toBe(false);
    // Damage meant for the life before is dropped.
    const stale: WorldEvent = { t: 'hurt', life: 0, amount: 200, from: [0, 1, -10], type: 'bullet', source: 'trooper' };
    game.hostRoom.channel('action').send(batchOf('world-test', [stale])); game.relay.flush();
    expect(game.guest.player.takeDamage).toHaveBeenCalledTimes(1);
    expect(game.hw.stats.snapshotPackets).toBe(0);
    game.hw.update(); game.relay.flush();
    expect(game.hw.stats.snapshotPackets).toBeGreaterThan(0);
    game.hw.dispose(); game.gw.dispose();
  });
});

describe('a hit the host refuses, and a death started ahead of the host\'s word', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  /** A host and a guest with one husk between them, the guest standing where the host has its body. */
  function fight(health = 100) {
    const game = pair();
    const enemy = game.host.manager.spawn('husk', new THREE.Vector3(0, 0, -10));
    enemy.health = enemy.maxHealth = health;
    game.hw.update(); game.relay.flush();
    game.guest.player.eye.set(0, 1.6, -5);
    const replica = game.guest.ctx.enemies.alive[0] as Enemy;
    const shot = (amount = 40): DamageInfo => ({ amount, type: 'bullet', point: enemy.center.clone(), dir: new THREE.Vector3(0, 0, -1), force: 12, source: 'smg', region: 'armL' });
    /** The host's damage model: takes the amount off, answers, and kills at zero. */
    const decide = () => game.host.manager.applyDamage.mockImplementation((target: Enemy, damage: DamageInfo) => {
      target.health -= damage.amount;
      const killed = target.health <= 0;
      Object.assign(game.host.manager.model.found, newFacts(), { amount: damage.amount });
      const result = { dealt: damage.amount, killed, headshot: false, severed: [], blocked: false } as DamageResult;
      if (killed) { target.alive = false; game.host.ctx.events.emit('enemy:killed', { enemy: target, damage, headshot: false, gibbed: false } as never); }
      else game.host.ctx.events.emit('enemy:hit', { enemy: target, damage, result });
    });
    const events = () => game.relay.packets.filter(p => p.lane === 'action').map(p => eventOf<WorldEvent>(p.data));
    const fire = () => { vi.advanceTimersByTime(120); game.guest.ctx.events.emit('weapon:fired', { weapon: 'smg', origin: new THREE.Vector3(0, 1.6, -5), dir: new THREE.Vector3(0, 0, -1) } as never); };
    return { ...game, enemy, replica, shot, decide, events, fire };
  }

  it('a refused hit stops counting against the enemy at once: the health base, the limb pool, the kill it was told, the body it floored', () => {
    const game = fight();
    const { replica } = game;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    replica.limbHp.set('armL', 50);
    // The guest's model wears the limb's pool, floors the body and guesses a kill.
    game.guest.manager.predictDamage.mockImplementation((target: Enemy, damage: DamageInfo) => {
      target.limbHp.set('armL', target.limbHp.get('armL')! - 30);
      game.guest.manager.model.found.level = 'felled';
      return { dealt: damage.amount, killed: false, headshot: false, severed: [], blocked: false, killSoon: true } as DamageResult;
    });
    // Fired from where the host cannot credit it (300 m from the guest's body): refused for `eye`.
    game.guest.player.eye.set(300, 1.6, -5);
    game.fire();
    game.gw.claim(replica, game.shot(120));
    // On the guest's screen, before the answer: the hit counts.
    expect(replica.owed).toBe(120);
    expect(replica.limbHp.get('armL')).toBe(20);
    game.relay.flush();
    expect(game.host.manager.applyDamage).not.toHaveBeenCalled();
    const nack = game.events().find(e => e.t === 'nack') as { n: number[] };
    expect(nack.n).toEqual([1, game.enemy.uid, 3]);
    // After it: the enemy's health is what the host says, nothing is owed, the pool is back, the body gets up.
    expect(replica.health).toBe(100);
    expect(replica.owed).toBe(0);
    expect(replica.limbHp.get('armL')).toBe(50);
    expect(game.guest.manager.rouseReplica).toHaveBeenCalledOnce();
    expect(game.gw.hitsSeen).toMatchObject({ predicted: 1, nacks: 1, gone: 0, acks: 0 });
    // And the next, honest, round is drawn as a hit on a living enemy (the guess starts from the truth again).
    game.guest.player.eye.set(0, 1.6, -5);
    game.decide();
    game.guest.manager.predictDamage.mockImplementation((_t: Enemy, damage: DamageInfo) => ({ dealt: damage.amount, killed: false, headshot: false, severed: [], blocked: false }) as DamageResult);
    game.fire();
    game.gw.claim(replica, game.shot(40)); game.relay.flush();
    expect(replica.health).toBe(60);
    expect(replica.owed).toBe(0);
    game.hw.dispose(); game.gw.dispose();
  });

  it('a hit on an enemy already dead on the host is answered `gone`, settled at once, and is no refusal', () => {
    const game = fight();
    game.host.manager.withdraw(game.enemy);
    game.fire();
    game.gw.claim(game.replica, game.shot(40));
    expect(game.replica.owed).toBe(40);
    game.relay.flush();
    expect((game.events().find(e => e.t === 'nack') as { n: number[] }).n[2]).toBe(0);
    expect(game.replica.owed).toBe(0);
    expect(game.gw.hitsSeen).toMatchObject({ nacks: 0, gone: 1 });
    expect(game.hw.claimBooks.refusedTotal).toBe(0);
    game.hw.dispose(); game.gw.dispose();
  });

  it('a claim the host cuts to its cap is answered with the health it really left', () => {
    const game = fight(5000);
    game.decide();
    game.fire();
    // No SMG round does 50,000: the host cuts it to the gun's cap and applies that.
    game.gw.claim(game.replica, game.shot(50000)); game.relay.flush();
    expect(game.hw.validator.clamped).toBe(1);
    const applied = (game.host.manager.applyDamage.mock.calls[0]![1] as DamageInfo).amount;
    expect(applied).toBeLessThan(50000);
    expect(game.replica.health).toBe(5000 - applied);
    expect(game.replica.owed).toBe(0);
    game.hw.dispose(); game.gw.dispose();
  });

  it('while its own hits are unanswered, a guest takes an enemy\'s health from the answers, never from a state that may count a hit twice', () => {
    const game = fight();
    const { replica, enemy } = game;
    // The host never answers (its damage model is a stub here), but its enemy's health moves and a new state goes out.
    game.fire();
    game.gw.claim(replica, game.shot(40));
    game.relay.flush();
    enemy.health = 60;
    vi.advanceTimersByTime(120); game.hw.update(); game.relay.flush();
    expect(replica.health).toBe(100);
    expect(replica.health - replica.owed).toBe(60);
    // Once nothing of its own is in the air, the states are the word again.
    vi.advanceTimersByTime(3000); game.gw.update();
    expect(replica.owed).toBe(0);
    enemy.health = 55;
    vi.advanceTimersByTime(1200); game.hw.update(); game.relay.flush();
    expect(replica.health).toBe(55);
    game.hw.dispose(); game.gw.dispose();
  });

  it('a body dropped for dead lies until the host answers: the kill makes it the corpse where it lies, without a second kick', () => {
    const game = fight(50);
    const { replica } = game;
    game.decide();
    game.guest.manager.predictDamage.mockImplementation((target: Enemy, damage: DamageInfo) => {
      target.downed = true;
      return { dealt: damage.amount, killed: false, headshot: false, severed: [], blocked: false, killSoon: true, sure: 'fall' } as DamageResult;
    });
    const kills = vi.fn(); game.guest.ctx.events.on('enemy:killed', kills);
    game.fire();
    game.gw.claim(replica, game.shot(80));
    // On the frame of the shot: down, alive, waiting.
    expect(replica.predead).toBeGreaterThan(0);
    expect(replica.alive).toBe(true);
    expect(game.guest.manager.replayDeath).not.toHaveBeenCalled();
    expect(game.gw.hitsSeen).toMatchObject({ falls: 1, deaths: 0 });
    game.relay.flush();
    // The host's `kill`: the one death, on the body already down, with the killing round's force taken out.
    expect(game.guest.manager.replayDeath).toHaveBeenCalledOnce();
    const [, round, , told] = game.guest.manager.replayDeath.mock.calls[0]!;
    expect((round as DamageInfo).force).toBeLessThan(0.1);
    expect((told as KillFacts).wound).toBe(0);
    expect(kills).toHaveBeenCalledOnce();
    expect(game.guest.manager.rouseReplica).not.toHaveBeenCalled();
    expect(game.guest.ctx.combat.killConfirm).not.toHaveBeenCalled();
    expect(game.gw.hitsSeen).toMatchObject({ falls: 1, fallsRight: 1, fallsWrong: 0, lateKills: 0 });
    game.hw.dispose(); game.gw.dispose();
  });

  it('a body dropped for dead that the host says lives gets up: a knockdown, never a corpse that stands', () => {
    const game = fight(500);
    const { replica } = game;
    game.decide();
    game.guest.manager.predictDamage.mockImplementation((target: Enemy, damage: DamageInfo) => {
      target.downed = true;
      return { dealt: damage.amount, killed: false, headshot: false, severed: [], blocked: false, killSoon: true, sure: 'fall' } as DamageResult;
    });
    // Two rounds in the air, both guessed as the kill.
    game.fire(); game.gw.claim(replica, game.shot(80));
    game.fire(); game.gw.claim(replica, game.shot(80));
    expect(game.gw.hitsSeen.falls).toBe(1);
    game.relay.flush();
    // Both answered, the enemy has 340 left: up it gets, once, and it was never a corpse.
    expect(replica.health).toBe(340);
    expect(replica.predead).toBe(0);
    expect(replica.alive).toBe(true);
    expect(game.guest.manager.rouseReplica).toHaveBeenCalledOnce();
    expect(game.guest.manager.replayDeath).not.toHaveBeenCalled();
    expect(game.gw.hitsSeen).toMatchObject({ fallsWrong: 1, fallsRight: 0 });
    game.hw.dispose(); game.gw.dispose();
  });

  it('a dropped body whose hit was never answered is judged when the wait runs out', () => {
    const game = fight(500);
    const { replica } = game;
    game.guest.manager.predictDamage.mockImplementation((target: Enemy, damage: DamageInfo) => {
      target.downed = true;
      return { dealt: damage.amount, killed: false, headshot: false, severed: [], blocked: false, killSoon: true, sure: 'fall' } as DamageResult;
    });
    game.fire(); game.gw.claim(replica, game.shot(80)); game.relay.flush();
    expect(replica.predead).toBeGreaterThan(0);
    vi.advanceTimersByTime(3000); game.gw.update();
    expect(replica.predead).toBe(0);
    expect(game.guest.manager.rouseReplica).toHaveBeenCalledOnce();
    game.hw.dispose(); game.gw.dispose();
  });

  it('a whole death played ahead of the host: the body dies on the frame of the shot, and the kill is this player\'s when the host says so', () => {
    const game = fight(20);
    const { replica, enemy } = game;
    game.decide();
    Object.assign(game.guest.manager, { model: { ...game.guest.manager.model, guessKill: vi.fn((_e: Enemy, _d: DamageInfo, out: KillFacts) => out) } });
    game.guest.manager.predictDamage.mockImplementation((_t: Enemy, damage: DamageInfo) => ({ dealt: damage.amount, killed: false, headshot: false, severed: [], blocked: false, killSoon: true, sure: 'kill' }) as DamageResult);
    const kills: GameEvents['enemy:killed'][] = []; game.guest.ctx.events.on('enemy:killed', k => kills.push(k));
    const feed = vi.fn(); game.guest.ctx.events.on('coop:kill', feed);
    game.fire();
    game.gw.claim(replica, game.shot(200));
    // Now, with nothing yet across the wire.
    expect(game.guest.manager.replayDeath).toHaveBeenCalledOnce();
    expect(replica.alive).toBe(false);
    expect(kills).toHaveLength(0);
    expect(game.gw.hitsSeen).toMatchObject({ deaths: 1 });
    // What needs the corpse (a stake's pin, a blade's fling) has it now, and does not wait.
    const pinned = vi.fn();
    game.gw.whenKilled(replica, pinned);
    expect(pinned).toHaveBeenCalledOnce();
    // A state that still lists it (the host has not heard yet) does not bring it back.
    vi.advanceTimersByTime(60); game.hw.update(); game.relay.flush();
    expect(game.guest.ctx.enemies.alive).toHaveLength(0);
    // The host's word: nothing more is drawn, and the score, the pay and the feed happen once.
    expect(game.guest.manager.replayDeath).toHaveBeenCalledOnce();
    expect(kills).toHaveLength(1);
    expect(kills[0]!.enemy.uid).toBe(enemy.uid);
    expect(feed).toHaveBeenCalledOnce();
    expect(game.gw.hitsSeen).toMatchObject({ deaths: 1, deathsRight: 1, deathsWrong: 0, lateKills: 0 });
    game.hw.dispose(); game.gw.dispose();
  });

  it('a whole death the host denies is counted as wrong and the enemy is let back from its next state', () => {
    const game = fight(900);
    const { replica, enemy } = game;
    game.decide();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    Object.assign(game.guest.manager, { model: { ...game.guest.manager.model, guessKill: vi.fn((_e: Enemy, _d: DamageInfo, out: KillFacts) => out) } });
    game.guest.manager.predictDamage.mockImplementation((_t: Enemy, damage: DamageInfo) => ({ dealt: damage.amount, killed: false, headshot: false, severed: [], blocked: false, killSoon: true, sure: 'kill' }) as DamageResult);
    game.fire();
    game.gw.claim(replica, game.shot(200)); game.relay.flush();
    expect(game.gw.hitsSeen).toMatchObject({ deaths: 1, deathsWrong: 1, deathsRight: 0 });
    vi.advanceTimersByTime(1200); game.hw.update(); game.relay.flush();
    expect(game.guest.ctx.enemies.alive.map(e => e.uid)).toEqual([enemy.uid]);
    game.hw.dispose(); game.gw.dispose();
  });
});

describe('stage 3: the team, the economy and what else crosses the wire', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
  afterEach(() => vi.useRealTimers());
  const send = (game: ReturnType<typeof pair>, from: 'host' | 'guest', data: WorldEvent) => {
    (from === 'host' ? game.hostRoom : game.guestRoom).channel('action').send(batchOf('world-test', [data])); game.relay.flush();
  };
  it("pays the killer: a guest's kill is not the host's, and the guest replays it as its own", () => {
    const game = pair();
    const enemy = game.host.manager.spawn('husk', new THREE.Vector3(0, 0, -10));
    game.hw.update(); game.relay.flush();
    const guestKills: unknown[] = [];
    game.guest.ctx.events.on('enemy:killed', e => guestKills.push(e));
    // The host applies the guest's claim; the kill it causes is attributed to the guest.
    let duringKill: boolean | null = null;
    game.host.manager.applyDamage.mockImplementation((target: Enemy) => {
      target.alive = false;
      game.host.ctx.events.emit('enemy:killed', { enemy: target, damage: { source: 'smg', point: target.center, dir: new THREE.Vector3(0, 0, -1), amount: 99, type: 'bullet', force: 1 }, headshot: true, gibbed: false } as never);
    });
    game.host.ctx.events.on('enemy:killed', e => { duringKill = game.hw.notMine(e.enemy); });
    game.guest.ctx.events.emit('weapon:fired', { weapon: 'smg', origin: new THREE.Vector3(0, 1.6, -5), dir: new THREE.Vector3(0, 0, -1) } as never);
    game.relay.flush();
    game.gw.claim(game.guest.ctx.enemies.alive[0]!, { amount: 99, type: 'bullet', source: 'smg', point: game.guest.ctx.enemies.alive[0]!.center.clone(), dir: new THREE.Vector3(0, 0, -1), force: 1 });
    game.relay.flush();
    expect(game.host.manager.applyDamage).toHaveBeenCalledOnce();
    expect(duringKill).toBe(true);
    expect(guestKills).toHaveLength(1);
    expect((guestKills[0] as { headshot: boolean }).headshot).toBe(true);
    // The host's own kill is its own, and is not replayed as a guest's.
    const own = game.host.manager.spawn('husk', new THREE.Vector3(0, 0, -12));
    game.host.ctx.events.emit('enemy:killed', { enemy: own, damage: { source: 'smg', point: own.center, dir: new THREE.Vector3(), amount: 1, type: 'bullet', force: 1 }, headshot: false, gibbed: false } as never);
    expect(duringKill).toBe(false);
    game.relay.flush();
    expect(guestKills).toHaveLength(1);
    expect(enemy.uid).toBeGreaterThan(0);
    game.hw.dispose(); game.gw.dispose();
  });
  it('a guest revive only counts beside the downed player, and the revived get up where they lay', () => {
    const game = pair();
    game.host.ctx.events.emit('player:died', { source: 'husk' });
    expect(game.hw.team.lives.get('host')?.state).toBe('down');
    // The guest's body (pose) is 5 m away: too far.
    send(game, 'guest', { t: 'revive', slot: 0 });
    expect(game.hw.team.lives.get('host')?.state).toBe('down');
    game.host.player.position.set(0, 0, -3);
    send(game, 'guest', { t: 'revive', slot: 0 });
    expect(game.hw.team.lives.get('host')?.state).toBe('up');
    expect(game.host.player.alive).toBe(true); expect(game.host.player.health).toBe(40);
    // A forged revive of someone who is up does nothing.
    send(game, 'guest', { t: 'revive', slot: 0 });
    expect(game.hw.team.lives.get('host')?.life).toBe(1);
    game.hw.dispose(); game.gw.dispose();
  });
  it('bleeds out, wipes when nobody is up, and tells everyone', () => {
    const game = pair();
    const overs: number[] = [];
    game.gw.team.onOver = (_cards, wave) => overs.push(wave);
    // The guest's world is up (its first card is in): only then does it count for the wipe.
    game.gw.update(); game.relay.flush();
    game.host.ctx.events.emit('player:died', { source: 'husk' });
    game.hw.update(); game.relay.flush();
    expect(overs).toEqual([]);
    game.guest.player.alive = false; game.guest.ctx.events.emit('player:died', { source: 'husk' }); game.relay.flush();
    game.hw.update(); game.relay.flush();
    expect(overs).toEqual([1]);
    expect(game.gw.team.final?.length).toBe(2);
    game.hw.dispose(); game.gw.dispose();
  });
  it('replays the waves on guests, respawns the dead with the next wave, and restores a rejoining purse', () => {
    const game = pair();
    const waves: string[] = [];
    game.guest.ctx.events.on('wave:start', e => waves.push(`start ${e.wave}`));
    game.guest.ctx.events.on('wave:clear', e => waves.push(`clear ${e.wave} ${e.bonus}`));
    game.host.ctx.events.emit('wave:clear', { wave: 3, bonus: 500 }); game.relay.flush();
    const life = game.hw.team.lives.get(game.guestLobby.you) ?? game.hw.team.life(game.guestLobby.you);
    life.fall(0); life.bleed(Infinity);
    game.host.ctx.events.emit('wave:start', { wave: 4, total: 20, boss: false }); game.relay.flush();
    expect(waves).toEqual(['clear 3 500', 'start 4']);
    expect(life.state).toBe('up');
    expect(game.guest.player.teleport).toHaveBeenCalled();
    // A page that has not been settled yet (a new page of a returning player) takes the seat the host kept.
    (game.gw.team as unknown as { settled: boolean }).settled = false;
    send(game, 'host', { t: 'restore', credits: 1234, score: 5000, kills: 12 });
    expect(game.guest.ctx.contracts.wallet).toMatchObject({ credits: 1234 });
    expect(game.guest.ctx.progression.resume).toHaveBeenCalledWith(5000, 12, 0);
    game.hw.dispose(); game.gw.dispose();
  });
  it("draws another player's explosion without damage, and relays it once", () => {
    const game = pair();
    const fx = game.host.ctx.fx as unknown as { explosion: ReturnType<typeof vi.fn> };
    fx.explosion = vi.fn(); (game.guest.ctx.fx as unknown as { explosion: unknown }).explosion = vi.fn();
    (game.host.ctx.camera as unknown as { addTrauma: unknown }).addTrauma = vi.fn();
    send(game, 'guest', { t: 'boom', at: [0, 0, -20], kind: 'rocket', radius: 6 });
    expect(fx.explosion).toHaveBeenCalledOnce();
    expect(game.host.ctx.combat.explode).not.toHaveBeenCalled();
    send(game, 'guest', { t: 'boom', at: [0, 0, -20], kind: 'notakind', radius: 6 });
    send(game, 'guest', { t: 'boom', at: [0, 0, -20], kind: 'rocket', radius: 1e9 });
    expect(fx.explosion).toHaveBeenCalledOnce();
    game.hw.dispose(); game.gw.dispose();
  });
  it("slows the host's world for a guest's slow-mo and tells every guest who (the rules and the rest: world/clock.test.ts)", () => {
    const game = pair();
    const hostTime = { share: vi.fn(), unshare: vi.fn() }, guestTime = { share: vi.fn(), unshare: vi.fn() };
    Object.assign(game.host.ctx.time, hostTime); Object.assign(game.guest.ctx.time, guestTime);
    // The guest's game asks its own clock (progression's SLOWMO perk); in co-op the clock hands the request to the world.
    (game.guest.ctx.time as unknown as { gate: { push(id: string, scale: number, fadeIn: number, fadeOut: number): void } }).gate.push('slowmo', 0.25, 0.18, 0.4);
    game.relay.flush(); game.hw.clock(); game.hw.update(); game.relay.flush(); game.gw.clock();
    expect(hostTime.share).toHaveBeenCalledWith(expect.stringMatching(/^coop:\d:slowmo$/), 0.25, 0.18, 0.5);
    expect(guestTime.share).toHaveBeenCalledWith(expect.stringMatching(/^coop:\d:slowmo$/), 0.25, 0.18, 0.5);
    expect(game.hw.slows.map(e => e.slot)).toEqual([game.guestLobby.me!.slot]);
    // It cannot outlive its cap, whatever the guest does or does not send.
    vi.advanceTimersByTime(9000); game.hw.clock();
    expect(hostTime.unshare).toHaveBeenCalled();
    expect(game.hw.slows).toHaveLength(0);
    game.hw.dispose(); game.gw.dispose();
  });
  it("shares a sonar ping both ways with a feed line, and never a teammate's thermal or focus", () => {
    const game = pair();
    const hostSonar = { share: vi.fn() }, guestSonar = { share: vi.fn() };
    Object.assign(game.host.ctx.contracts!, { sonar: hostSonar }); Object.assign(game.guest.ctx.contracts!, { sonar: guestSonar });
    game.guest.ctx.events.emit('sonar:ping', { origin: new THREE.Vector3(1, 2, 3) }); game.relay.flush();
    expect(hostSonar.share).toHaveBeenCalledWith(new THREE.Vector3(1, 2, 3));
    expect(game.host.ctx.hud.feed).toHaveBeenCalledWith('GUEST used sonar', expect.any(String));
    expect(guestSonar.share).not.toHaveBeenCalled();
    game.host.ctx.events.emit('sonar:ping', { origin: new THREE.Vector3(4, 5, 6) }); game.relay.flush();
    expect(guestSonar.share).toHaveBeenCalledWith(new THREE.Vector3(4, 5, 6));
    expect(game.guest.ctx.hud.feed).toHaveBeenCalledWith('HOST used sonar', expect.any(String));
    expect(hostSonar.share).toHaveBeenCalledOnce();
    const sent = game.relay.packets.filter(p => p.lane === 'action').map(p => eventOf<WorldEvent>(p.data).t);
    expect(sent.filter(t => t === 'sonar')).toHaveLength(2);
    game.hw.dispose(); game.gw.dispose();
  });
  it('survives junk from a peer: wrong types, missing fields, huge numbers', () => {
    const game = pair();
    const junk: unknown[] = [null, 7, 'x', [], { t: 9 }, { t: 'kill' }, { t: 'hurt', amount: 'lots' }, { t: 'team', list: 'no' }, { t: 'team', list: [{ slot: 'a' }] },
      { t: 'up', slot: 99, life: 1 }, { t: 'wave', kind: 'start', wave: -1 }, { t: 'over', cards: 3 }, { t: 'restore', credits: 'x' }, { t: 'boom', at: 'here' },
      { t: 'callin', id: 42 }, { t: 'hitfx', uid: 'q' }, { t: 'sever', uid: 1, region: 'soul' }, { t: 'chatter', line: 1e9 }, { t: 'card', card: null },
      { t: 'sonar', at: 'here' }, { t: 'sonar', at: [1, 2, 3], slot: 9 }, { t: 'revive', slot: -4 }, { t: 'slow', id: 'x', on: 'yes' }, { t: 'hit', target: 'all' }, { t: 'life', alive: 'no' }];
    for (const data of junk) { send(game, 'host', data as WorldEvent); send(game, 'guest', data as WorldEvent); }
    expect(game.host.player.alive).toBe(true); expect(game.guest.player.alive).toBe(true);
    expect(game.hw.team.final).toBeNull();
    game.hw.dispose(); game.gw.dispose();
  });
});

// Stage 5, a mission run by the host and played on every screen: src/net/mission.test.ts and src/campaign/coop.test.ts.

describe('a rejoining player', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
  afterEach(() => vi.useRealTimers());
  it('gets their purse back once their world is up and talking', () => {
    const game = pair();
    // `ok`: the guest's seat is settled (the host's `restore` was applied), so the host keeps its purse.
    const card = (credits: number) => ({ slot: 1, state: 'up', bleed: 0, life: 0, hp: 100, max: 100, armor: 0, kills: 3, score: 300, credits, downs: 0, revives: 0, ping: 0, ok: true });
    game.guestRoom.channel('action').send(batchOf('world-test', [{ t: 'card', card: card(250) }])); game.relay.flush();
    // The same player comes back on a new page (its seat is not settled yet): its first card is an empty purse.
    (game.hw.team as unknown as { arrived: Set<string> }).arrived.clear();
    (game.gw.team as unknown as { settled: boolean }).settled = false;
    (game.guest.ctx.contracts.wallet as unknown as { credits: number }).credits = 0;
    game.guestRoom.channel('action').send(batchOf('world-test', [{ t: 'card', card: card(0) }])); game.relay.flush();
    expect(game.guest.ctx.contracts.wallet).toMatchObject({ credits: 250 });
    game.hw.dispose(); game.gw.dispose();
  });
});
