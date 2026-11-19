/**
 * Enemy attacks in co-op, over a mocked transport: the host's attack events and a guest's harmless copy of the attack
 * (attacks.ts), projectile copies (enemyFire.ts), warnings (warnings.ts), the Commander's words (villain.ts), and the host
 * testing every player for a swing or a slam, with a guest's dodge grace, shove and Ghost (targeting.ts).
 */
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../core/events';
import type { Ctx, GameEvents, PlayerDamage, PlayerSystem } from '../../core/contracts';
import type { ProjectileSpec } from '../../core/gameplay';
import { Enemy } from '../../enemies/Enemy';
import { PlayerSense, type AiWorld } from '../../enemies/aiWorld';
import { meleeConnect } from '../../enemies/attacks';
import { shockwave } from '../../enemies/bosses';
import { startAttack, tickAttack, finishAttack, type AttackDef } from '../../enemies/brain';
import type { Briefing } from '../../enemies/commander/events';
import type { CoopSession } from '../index';
import { Lobby } from '../lobby';
import type { Pose } from '../pose';
import type { NetRoom } from '../room';
import { CoopWorld } from '../world';
import type { WorldEvent } from '../worldProtocol';
import { goreDoubles } from './goreDoubles';
import { HostTime } from './hostTime';
import { DODGE_FRESH_MS } from './targeting';
import { cleanBriefing } from './villain';

class Relay {
  readonly rooms: Room[] = [];
  readonly queue: (() => void)[] = [];
  readonly packets: { lane: string; data: unknown; to?: string }[] = [];
  open(id: string): Room {
    const room = new Room(id, this);
    for (const peer of this.rooms) this.queue.push(() => { peer.join(id); room.join(peer.id); });
    this.rooms.push(room);
    return room;
  }
  flush(): void { while (this.queue.length) this.queue.shift()!(); }
  /** The world events sent so far, of one type. */
  sent<T extends WorldEvent['t']>(type: T): Extract<WorldEvent, { t: T }>[] {
    return this.packets.filter(p => p.lane === 'action').map(p => (p.data as { data: WorldEvent }).data).filter(e => e.t === type) as Extract<WorldEvent, { t: T }>[];
  }
}
class Room implements NetRoom {
  readonly handlers = new Map<string, (data: unknown, from: string) => void>();
  join: (id: string) => void = () => {};
  constructor(readonly id: string, private readonly relay: Relay) {}
  channel<T>(lane: string) {
    return {
      on: (handler: (data: T, from: string) => void) => this.handlers.set(lane, handler as (data: unknown, from: string) => void),
      send: (data: T, to?: string) => {
        this.relay.packets.push({ lane, data: structuredClone(data), to });
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
    enemy.def = { attacks: [], voice: { pitch: 1 } } as unknown as Enemy['def'];
    enemy.char = { root: new THREE.Group(), severed: new Set(), rig: { bones: [{ name: 'chest' }], height: 1.8 }, bones: [], hitFlash: vi.fn(),
      anim: { play: vi.fn() } } as unknown as Enemy['char'];
    alive.push(enemy); return enemy;
  });
  const player = { position: new THREE.Vector3(0, 0, 0), eye: new THREE.Vector3(0, 1.6, 0), forward: new THREE.Vector3(0, 0, -1),
    velocity: new THREE.Vector3(), alive: true, health: 100, maxHealth: 100, armor: 0, grounded: true, downed: false, parked: false,
    reset: vi.fn(), teleport: vi.fn(), launch: vi.fn(), push: vi.fn(),
    takeDamage: vi.fn((damage: PlayerDamage) => { player.health -= damage.amount; }),
  };
  const telegraphs = { zone: vi.fn(), glint: vi.fn(), acquireLaser: vi.fn(() => 3), aimLaser: vi.fn(), releaseLaser: vi.fn(), setLaserStrength: vi.fn() };
  const director = { release: vi.fn(), acquire: vi.fn(() => true), offscreenWindup: 1, clearLine: vi.fn(() => true) };
  const combat = { fireRay: vi.fn(), explode: vi.fn(), spawnProjectile: vi.fn(), enemyMuzzle: vi.fn(), spawnCopy: vi.fn((_spec: ProjectileSpec, _id: number) => {}),
    dropProjectileCopy: vi.fn(), detonateProjectile: vi.fn() };
  const ctx = { events, player, weapons: { current: 'smg', owned: [], ammo: () => ({ mag: 0, reserve: 0 }) }, waves: { wave: 1 }, physics: { raycast: vi.fn(() => null), radialImpulse: vi.fn() },
    world: { playerSpawns: [{ position: new THREE.Vector3(4, 0, 4), yaw: 0 }] }, hud: { feed: vi.fn(), follow: vi.fn(() => () => {}), callout: vi.fn(), banner: vi.fn() },
    time: { dt: 0.016, realDt: 0.016, frame: 0, elapsed: 0 }, progression: { kills: 0, score: 0, headshots: 0, resume: vi.fn(), isActive: vi.fn(() => false) },
    contracts: { wallet: { credits: 0 } }, camera: { setSeat: vi.fn(), addTrauma: vi.fn() }, input: { pressed: vi.fn(() => false), isDown: vi.fn(() => false) },
    fx: { tracer: vi.fn(), muzzleFlash: vi.fn(), bloodHit: vi.fn(), impact: vi.fn(), ring: vi.fn(), sparks: vi.fn(), smoke: vi.fn() },
    render: { decals: { add: vi.fn() }, lights: { flash: vi.fn() } }, gore: { wound: vi.fn(), sever: vi.fn() },
    audio: { play: vi.fn() }, combat } as unknown as Ctx;
  const manager = { alive, spawn, withdraw: vi.fn((enemy: Enemy) => { enemy.alive = false; alive.splice(alive.indexOf(enemy), 1); }),
    applyDamage: vi.fn(), afflict: vi.fn(), replayDeath: vi.fn(), placeReplica: vi.fn(), strike: vi.fn(), selfDestruct: vi.fn(), outpost: null, ...goreDoubles(),
    aiWorld: null as unknown as AiWorld };
  (ctx as { enemies: unknown }).enemies = manager;
  // The AI's own view of the game, as EnemyManager builds it.
  const ai = { ctx, director, telegraphs, enemies: manager, player: new PlayerSense(), now: 0 } as unknown as AiWorld;
  manager.aiWorld = ai;
  return { ctx, manager, player, telegraphs, combat, ai };
}

/** A friend's body on the host: where it is drawn, and the poses that came in (newest last). */
function body(at: THREE.Vector3) {
  const root = new THREE.Group(); root.position.copy(at);
  const pose: Pose = { seq: 1, position: at.toArray() as Pose['position'], velocity: [0, 0, 0], yaw: 0, pitch: 0, move: 'walk', weapon: 'smg' };
  const newest = { at: 0, pose };
  return { root, pose, newest, remote: { char: { root, anim: { play: vi.fn() } }, downed: false,
    buffer: { sample: () => newest.pose, latest: () => newest }, setTag: vi.fn(), muzzle: (v: THREE.Vector3) => v.copy(root.position) } };
}

function pair() {
  const relay = new Relay();
  const hr = relay.open('host-peer');
  const hostLobby = new Lobby({ main: hr, door: () => new Room('door', new Relay()) }, true, 'HOST', 'test');
  const gr = relay.open('guest-peer');
  const guestLobby = new Lobby({ main: gr, door: () => new Room('door', new Relay()) }, false, 'GUEST', 'test');
  relay.flush(); hostLobby.startMatch('crucible', 'attack-test'); relay.flush();
  const host = context(), guest = context();
  const friend = body(new THREE.Vector3(0, 0, -5));
  const hs = { lobby: hostLobby, hosting: true, match: hostLobby.match, remotes: new Map([[guestLobby.you, friend.remote]]) } as unknown as CoopSession;
  const gs = { lobby: guestLobby, hosting: false, match: guestLobby.match, remotes: new Map() } as unknown as CoopSession;
  const hw = new CoopWorld(host.ctx, hs), gw = new CoopWorld(guest.ctx, gs);
  (host.ctx as { coop: unknown }).coop = { world: hw, hosting: true };
  (guest.ctx as { coop: unknown }).coop = { world: gw, hosting: false };
  // The game's own combat tells co-op about every enemy projectile and flash (weapons/Combat.ts); the stand-in does the same.
  host.combat.spawnProjectile.mockImplementation((spec: ProjectileSpec) => { hw.projectile(spec); });
  host.telegraphs.zone.mockImplementation((at: THREE.Vector3, radius: number, seconds: number, color = 0xff3010) => { hw.warnings.zone(at, radius, seconds, color); });
  host.combat.enemyMuzzle.mockImplementation((at: THREE.Vector3, dir: THREE.Vector3, kind: 'enemy') => { hw.enemyFlash(at, dir, kind); });
  hw.begin(); gw.begin();
  /** One host frame and its delivery: the snapshot goes out and the guest takes everything. */
  const frame = (ms = 110) => { vi.advanceTimersByTime(ms); hw.update(); relay.flush(); gw.update(); relay.flush(); };
  return { relay, host, guest, hw, gw, hostLobby, guestLobby, friend, frame };
}

/** An attack whose every step is watched. `fire` spawns one bullet through the world it is given. */
function watched(name: string, extra: Partial<AttackDef> = {}): AttackDef & { calls: { step: string; cosmetic: boolean; index?: number }[] } {
  const calls: { step: string; cosmetic: boolean; index?: number }[] = [];
  return { name, calls, range: [0, 50], los: false, token: null, cooldown: [1, 1], windup: 0.5, active: 0.1, recover: 0.2, moveMul: 1,
    begin(_e, w) { calls.push({ step: 'begin', cosmetic: w.cosmetic === true }); },
    fire(e, w, index) {
      calls.push({ step: 'fire', cosmetic: w.cosmetic === true, index });
      w.ctx.combat.spawnProjectile({ origin: e.center.clone(), velocity: new THREE.Vector3(0, 0, 40), kind: 'bullet', team: 'enemy', damage: 9, source: 'husk' });
      w.ctx.combat.enemyMuzzle(e.center, new THREE.Vector3(1, 0, 0), 'enemy');
      w.ctx.player.takeDamage({ amount: 5, type: 'melee', source: 'husk' });
      w.telegraphs.zone(e.position, 4, 1);
      w.enemies.strike(e.position, 1, 4, 20, 'husk');
    },
    end(_e, w, interrupted) { calls.push({ step: interrupted ? 'cut' : 'end', cosmetic: w.cosmetic === true }); },
    ...extra };
}

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] }));
afterEach(() => vi.useRealTimers());

describe('host time', () => {
  it('measures how much later than usual an event arrived, whatever the two clocks say', () => {
    const clock = new HostTime();
    // The host's clock is 5 s ahead and the link takes 40 ms.
    expect(clock.late(5000, 40)).toBe(0);
    expect(clock.late(5100, 140)).toBe(0);
    expect(clock.late(5200, 340)).toBeCloseTo(0.1, 3);
    expect(clock.late(5300, 2000)).toBe(0.4);
    expect(clock.late(Number.NaN, 2100)).toBe(0);
  });
});

describe('an enemy attack on a guest', () => {
  it('plays the same attack on the copy: its start, each shot with the host\'s projectile, its end; and can hurt nothing', () => {
    const game = pair();
    const a = watched('test');
    const enemy = game.host.manager.spawn('husk', new THREE.Vector3(0, 0, -10));
    enemy.attacks = [a];
    game.frame();
    const copy = game.guest.manager.alive[0]!;
    copy.attacks = [a];
    startAttack(enemy, game.host.ai, a);
    game.relay.flush();
    expect(game.relay.sent('atk')).toHaveLength(1);
    expect(game.relay.sent('atk')[0]).toMatchObject({ uid: enemy.uid, a: 'test', w: 0.5, to: game.hostLobby.me!.slot });
    expect(copy.attack).toBe(a);
    expect(copy.attackPhase).toBe('windup');
    // The host's wind-up ends and its shot goes off.
    tickAttack(enemy, game.host.ai, 0.6);
    game.relay.flush();
    const fired = game.relay.sent('atkf');
    expect(fired).toHaveLength(1);
    expect(fired[0]!.sh).toEqual([{ o: [0, 1, -10], v: [0, 0, 40], k: 'bullet' }]);
    // The host really spawned and hurt; nothing went out piece by piece.
    expect(game.host.combat.spawnProjectile).toHaveBeenCalledOnce();
    expect(game.host.player.takeDamage).toHaveBeenCalledOnce();
    expect(game.relay.sent('proj')).toHaveLength(0);
    expect(game.relay.sent('efx')).toHaveLength(0);
    // The guest's copy fired: the host's bullet as a harmless copy from its own gun, a flash, and no damage or decision.
    expect(copy.attackPhase).toBe('active');
    expect(game.guest.combat.spawnCopy).toHaveBeenCalledOnce();
    const spec = game.guest.combat.spawnCopy.mock.calls[0]![0];
    expect(spec.cosmetic).toBe(true);
    expect(spec.damage).toBe(0);
    expect(spec.velocity.toArray()).toEqual([0, 0, 40]);
    expect(game.guest.ctx.fx.muzzleFlash).toHaveBeenCalledOnce();
    expect(game.guest.combat.spawnProjectile).not.toHaveBeenCalled();
    expect(game.guest.player.takeDamage).not.toHaveBeenCalled();
    expect(game.guest.manager.strike).not.toHaveBeenCalled();
    // The ring is the host's word, sent once, never the copy's own.
    expect(game.relay.sent('zone')).toHaveLength(1);
    expect(game.guest.telegraphs.zone).toHaveBeenCalledOnce();
    finishAttack(enemy, game.host.ai, false);
    game.relay.flush();
    expect(copy.attack).toBeNull();
    expect(a.calls.filter(c => c.cosmetic).map(c => c.step)).toEqual(['begin', 'fire', 'end']);
    expect(a.calls.filter(c => !c.cosmetic).map(c => c.step)).toEqual(['begin', 'fire', 'end']);
    game.hw.dispose(); game.gw.dispose();
  });

  it('starts a late wind-up that far in, and keeps a start for an enemy that is not drawn yet', () => {
    const game = pair();
    const a = watched('test', { windup: 1 });
    const enemy = game.host.manager.spawn('husk', new THREE.Vector3(0, 0, -10));
    enemy.attacks = [a];
    // The attack starts before any snapshot: the guest has no copy of him.
    startAttack(enemy, game.host.ai, a);
    game.relay.flush();
    expect(game.guest.manager.alive).toHaveLength(0);
    game.frame();
    const copy = game.guest.manager.alive[0]!;
    copy.attacks = [a];
    game.gw.updateGuests();
    expect(copy.attack).toBe(a);
    expect(copy.attackWindup).toBeGreaterThan(0.9);
    // A second attack whose start is delivered 300 ms late.
    finishAttack(enemy, game.host.ai, true); game.relay.flush();
    startAttack(enemy, game.host.ai, a);
    vi.advanceTimersByTime(300);
    game.relay.flush();
    expect(copy.attackWindup).toBeCloseTo(0.7, 2);
    game.hw.dispose(); game.gw.dispose();
  });

  it('gives a copy up when the host goes quiet, and joins an attack at a shot whose start was lost', () => {
    const game = pair();
    const a = watched('test', { shots: 3, active: 0.1 });
    const enemy = game.host.manager.spawn('husk', new THREE.Vector3(0, 0, -10));
    enemy.attacks = [a];
    game.frame();
    const copy = game.guest.manager.alive[0]!;
    copy.attacks = [a];
    // Only a shot arrives.
    (game.hw as unknown as { w: { send(e: WorldEvent): void } }).w.send({ t: 'atkf', uid: enemy.uid, a: 'test', n: 1, to: 0 });
    game.relay.flush();
    expect(copy.attack).toBe(a);
    expect(copy.attackShots).toBe(2);
    // No more ever comes.
    (game.guest.ctx.time as { dt: number }).dt = 0.5;
    for (let i = 0; i < 4; i++) game.gw.updateGuests();
    expect(copy.attack).toBeNull();
    expect(a.calls.at(-1)).toMatchObject({ step: 'cut', cosmetic: true });
    game.hw.dispose(); game.gw.dispose();
  });

  it('sends only the first glob of a stream for show, and the copy makes the rest from the timeline', () => {
    const game = pair();
    const a = watched('flame', { shots: 6, active: 0.1, local: true, fire: vi.fn() });
    const enemy = game.host.manager.spawn('burner', new THREE.Vector3(0, 0, -10));
    enemy.attacks = [a];
    game.frame();
    const copy = game.guest.manager.alive[0]!;
    copy.attacks = [a];
    startAttack(enemy, game.host.ai, a);
    tickAttack(enemy, game.host.ai, 0.6);
    tickAttack(enemy, game.host.ai, 0.01);
    game.relay.flush();
    // The host's first glob, and the copy's from the host's word.
    expect(a.fire).toHaveBeenCalledTimes(2);
    (game.guest.ctx.time as { dt: number }).dt = 0.1;
    for (let i = 0; i < 8; i++) game.gw.updateGuests();
    // The copy made its other five itself.
    expect(a.fire).toHaveBeenCalledTimes(7);
    for (let i = 0; i < 8; i++) tickAttack(enemy, game.host.ai, 0.1);
    game.relay.flush();
    // The host's other five went out as nothing: one shot event in all.
    expect(a.fire).toHaveBeenCalledTimes(12);
    expect(game.relay.sent('atkf')).toHaveLength(1);
    game.hw.dispose(); game.gw.dispose();
  });

  it('ignores junk', () => {
    const game = pair();
    const send = (event: unknown) => (game.hw as unknown as { w: { send(e: unknown): void } }).w.send(event);
    const junk: unknown[] = [{ t: 'atk' }, { t: 'atk', uid: 1, a: 7, w: 'x' }, { t: 'atkf', uid: 1, a: 'test', n: -4 }, { t: 'atke' }, { t: 'say', uid: 1, l: 5 },
      { t: 'bossfx', uid: 1, k: 'constructor' }, { t: 'proj', p: { o: [0, 0], v: 'x', k: 'nuke' } }, { t: 'proj' }, { t: 'projx', id: -1 }, { t: 'efx', at: null },
      { t: 'zone', at: [0, 0, 0], r: 1e9, s: 1 }, { t: 'laser', id: 900 }, { t: 'shock', at: [0, 0, 0], r: 5, snd: 'nope' }, { t: 'strike', at: 'x', d: 1 },
      { t: 'bang', at: [0, 0, 0], d: -1 }, { t: 'cmd', k: 'briefing', b: 5 }, { t: 'cmd', k: 'bark', id: 9 }, { t: 'cmd', k: 'status', flag: 'x', on: 1 }, { t: 'shove', v: [1, 2] }];
    game.host.manager.spawn('husk', new THREE.Vector3(0, 0, -10));
    game.frame();
    for (const event of junk) send(event);
    expect(() => game.relay.flush()).not.toThrow();
    expect(game.guest.telegraphs.zone).not.toHaveBeenCalled();
    expect(game.guest.combat.spawnCopy).not.toHaveBeenCalled();
    game.hw.dispose(); game.gw.dispose();
  });
});

describe('enemy projectiles and flashes outside an attack', () => {
  it('flies a harmless copy on the guest, removes it at the host\'s word, and lets a guest shoot it down', () => {
    const game = pair();
    const rocket: ProjectileSpec = { origin: new THREE.Vector3(1, 2, 3), velocity: new THREE.Vector3(0, 0, 30), kind: 'rocket', team: 'enemy', damage: 40, source: 'tank',
      explosion: { radius: 5, damage: 40, kind: 'enemy' }, lifetime: 6 };
    const id = game.hw.projectile(rocket);
    expect(id).toBeGreaterThan(0);
    game.relay.flush();
    expect(game.guest.combat.spawnCopy).toHaveBeenCalledOnce();
    const [spec, copyId] = game.guest.combat.spawnCopy.mock.calls[0]!;
    expect(copyId).toBe(id);
    expect(spec).toMatchObject({ kind: 'rocket', cosmetic: true, damage: 0, lifetime: 6 });
    expect(spec.explosion?.damage).toBe(0);
    // A bullet has no end to tell; a flame is never sent at all.
    expect(game.hw.projectile({ ...rocket, kind: 'bullet', explosion: undefined })).toBe(0);
    expect(game.hw.projectile({ ...rocket, kind: 'flame' })).toBe(0);
    game.relay.flush();
    expect(game.guest.combat.spawnCopy).toHaveBeenCalledTimes(2);
    game.hw.projectileGone(id); game.relay.flush();
    expect(game.guest.combat.dropProjectileCopy).toHaveBeenCalledWith(id);
    game.gw.projectileShot(id); game.relay.flush();
    expect(game.host.combat.detonateProjectile).toHaveBeenCalledWith(id);
    // A guest never sends these itself.
    expect(game.gw.projectile(rocket)).toBe(0);
    game.hw.dispose(); game.gw.dispose();
  });

  it('sends a vehicle\'s flash and sound, and caps a flood', () => {
    const game = pair();
    game.hw.enemyFlash(new THREE.Vector3(1, 2, 3), new THREE.Vector3(0, 0, 1), 'autocannon');
    game.hw.enemySound('tank_cannon', new THREE.Vector3(1, 2, 3));
    game.relay.flush();
    expect(game.guest.ctx.fx.muzzleFlash).toHaveBeenCalledOnce();
    expect(game.guest.ctx.audio.play).toHaveBeenCalledWith('tank_cannon', expect.objectContaining({ volume: 1 }));
    for (let i = 0; i < 200; i++) game.hw.enemyFlash(new THREE.Vector3(), new THREE.Vector3(0, 0, 1), 'enemy');
    expect(game.relay.sent('efx').length).toBeLessThanOrEqual(60);
    game.hw.dispose(); game.gw.dispose();
  });
});

describe('warnings', () => {
  it('draws the host\'s ring on a guest with the seconds it has left, and its shell and shock', () => {
    const game = pair();
    game.hw.warnings.zone(new THREE.Vector3(1, 0, 2), 6, 1.5, 0xff3010);
    game.relay.flush();
    expect(game.guest.telegraphs.zone).toHaveBeenCalledOnce();
    expect(game.guest.telegraphs.zone.mock.calls[0]![2]).toBeCloseTo(1.5, 3);
    game.hw.warnings.zone(new THREE.Vector3(1, 0, 2), 6, 1.5, 0x30ffc0);
    vi.advanceTimersByTime(250);
    game.relay.flush();
    expect(game.guest.telegraphs.zone.mock.calls[1]![2]).toBeCloseTo(1.25, 2);
    expect(game.guest.telegraphs.zone.mock.calls[1]![3]).toBe(0x30ffc0);
    game.hw.warnings.shock(new THREE.Vector3(0, 0, -3), 10, 'juggernaut_slam'); game.relay.flush();
    expect(game.guest.ctx.fx.ring).toHaveBeenCalledOnce();
    expect(game.guest.ctx.audio.play).toHaveBeenCalledWith('juggernaut_slam', expect.anything());
    game.hw.warnings.strike(new THREE.Vector3(3, 0, 3), 0.2); game.relay.flush();
    game.gw.update();
    expect(game.guest.ctx.fx.tracer).not.toHaveBeenCalled();
    (game.guest.ctx.time as { elapsed: number }).elapsed = 0.3;
    game.gw.update();
    expect(game.guest.ctx.fx.tracer).toHaveBeenCalledOnce();
    game.hw.dispose(); game.gw.dispose();
  });

  it('tells a guest about a laser that is not an attack\'s own, at 10 Hz, and never about an attack\'s', () => {
    const game = pair();
    const warnings = game.hw.warnings;
    const color = new THREE.Color(0xff2030);
    warnings.laserOn(2);
    for (let i = 0; i < 30; i++) { warnings.laserAim(2, new THREE.Vector3(0, 1, 0), new THREE.Vector3(i, 1, 9), color, 0.5); vi.advanceTimersByTime(16); }
    game.relay.flush();
    const sent = game.relay.sent('laser').length;
    expect(sent).toBeGreaterThanOrEqual(4);
    expect(sent).toBeLessThanOrEqual(6);
    expect(game.guest.telegraphs.acquireLaser).toHaveBeenCalledOnce();
    game.gw.update();
    expect(game.guest.telegraphs.aimLaser).toHaveBeenCalled();
    warnings.laserOff(2); game.relay.flush();
    expect(game.guest.telegraphs.releaseLaser).toHaveBeenCalledWith(3);
    // Taken while an attack's own code runs: that attack draws it on every screen.
    game.hw.attacks.enter(); warnings.laserOn(5); game.hw.attacks.leave();
    warnings.laserAim(5, new THREE.Vector3(), new THREE.Vector3(1, 1, 1), color, 0.5);
    warnings.laserOff(5);
    expect(game.relay.sent('laser')).toHaveLength(sent + 1);
    game.hw.dispose(); game.gw.dispose();
  });
});

describe('every player is in the same danger', () => {
  const hostAi = (game: ReturnType<typeof pair>): AiWorld => game.host.ai;

  it('lands a swing on every player in reach, and spares a guest whose own screen had them clear', () => {
    const game = pair();
    const enemy = game.host.manager.spawn('husk', new THREE.Vector3(0, 0, -3));
    enemy.damageMul = 1;
    game.host.player.position.set(0, 0, -2);
    game.friend.root.position.set(0.5, 0, -2.5);
    game.friend.newest.pose = { ...game.friend.pose, position: [0.5, 0, -2.5] };
    game.friend.newest.at = performance.now();
    game.hw.update();
    expect(meleeConnect(enemy, hostAi(game), 2, -1, 10, 'husk', 6)).toBe(true);
    expect(game.host.player.takeDamage).toHaveBeenCalledOnce();
    game.relay.flush();
    expect(game.guest.player.takeDamage).toHaveBeenCalledWith(expect.objectContaining({ amount: 10, type: 'melee' }));
    expect(game.guest.player.launch).toHaveBeenCalledOnce();
    // The guest has stepped back on their own screen: the newest pose is 4 m away, the body the host draws is still in reach.
    game.friend.newest.pose = { ...game.friend.pose, position: [0, 0, -7] };
    game.friend.newest.at = performance.now();
    expect(meleeConnect(enemy, hostAi(game), 2, -1, 10, 'husk')).toBe(true);
    game.relay.flush();
    expect(game.host.player.takeDamage).toHaveBeenCalledTimes(2);
    expect(game.guest.player.takeDamage).toHaveBeenCalledOnce();
    expect(game.hw.dodges).toBe(1);
    // A pose that old proves nothing: the swing lands.
    vi.advanceTimersByTime(DODGE_FRESH_MS + 50);
    meleeConnect(enemy, hostAi(game), 2, -1, 10, 'husk');
    game.relay.flush();
    expect(game.guest.player.takeDamage).toHaveBeenCalledTimes(2);
    game.hw.dispose(); game.gw.dispose();
  });

  it('slams every grounded player in the ring, throws each, and a guest in the air jumps it', () => {
    const game = pair();
    const at = new THREE.Vector3(0, 0, -4);
    game.host.player.position.set(0, 0, -2);
    game.hw.update();
    shockwave(hostAi(game), at, 10, 30, 'juggernaut', 14);
    game.relay.flush();
    expect(game.host.player.takeDamage).toHaveBeenCalledOnce();
    expect(game.host.player.launch).toHaveBeenCalledOnce();
    expect(game.guest.player.takeDamage).toHaveBeenCalledWith(expect.objectContaining({ type: 'crush', source: 'juggernaut' }));
    expect(game.guest.player.launch).toHaveBeenCalledOnce();
    const thrown = game.guest.player.launch.mock.calls[0]![0] as THREE.Vector3;
    expect(thrown.y).toBeCloseTo(14 * 0.7, 1);
    // The guest draws it from the host's word.
    expect(game.guest.ctx.fx.ring).toHaveBeenCalledOnce();
    // The guest is in the air for the next one.
    game.friend.newest.pose = { ...game.friend.pose, move: 'airborne' };
    shockwave(hostAi(game), at, 10, 30, 'juggernaut', 14);
    game.relay.flush();
    expect(game.host.player.takeDamage).toHaveBeenCalledTimes(2);
    expect(game.guest.player.takeDamage).toHaveBeenCalledOnce();
    expect(game.guest.ctx.fx.ring).toHaveBeenCalledTimes(2);
    game.hw.dispose(); game.gw.dispose();
  });

  it('hides a guest with the Ghost power-up from the host\'s enemies', () => {
    const game = pair();
    const enemy = game.host.manager.spawn('husk', new THREE.Vector3(0, 0, -6));
    const sense = new PlayerSense();
    game.hw.select(enemy, sense);
    expect(sense.ghost).toBe(false);
    (game.guest.ctx.progression.isActive as ReturnType<typeof vi.fn>).mockReturnValue(true);
    game.gw.update(); game.relay.flush();
    game.hw.select(enemy, sense);
    expect(sense.ghost).toBe(true);
    (game.guest.ctx.progression.isActive as ReturnType<typeof vi.fn>).mockReturnValue(false);
    game.gw.update(); game.relay.flush();
    game.hw.select(enemy, sense);
    expect(sense.ghost).toBe(false);
    game.hw.dispose(); game.gw.dispose();
  });

  it('fires a soldier\'s round at a guest as the same slow bullet the host\'s player gets, and never a second rocket blast', () => {
    const game = pair();
    const enemy = game.host.manager.spawn('trooper', new THREE.Vector3(0, 0, -30));
    game.hw.select(enemy, new PlayerSense());
    const foe = (game.hw as unknown as { targeting: { players(): { id: string; foe: { shotAt(from: THREE.Vector3, damage: number, miss: number, source: string): void;
      blast(at: THREE.Vector3, radius: number, damage: number, delay: number, source: string): void } }[] } }).targeting.players().find(p => p.id === game.guestLobby.you)!.foe;
    foe.shotAt(new THREE.Vector3(0, 1.4, -30), 7, 0, 'trooper');
    expect(game.host.combat.fireRay).not.toHaveBeenCalled();
    expect(game.host.combat.spawnProjectile).toHaveBeenCalledOnce();
    const spec = game.host.combat.spawnProjectile.mock.calls[0]![0] as ProjectileSpec;
    expect(spec).toMatchObject({ kind: 'bullet', team: 'enemy', damage: 7, source: 'trooper' });
    expect(spec.velocity.length()).toBeCloseTo(85, 3);
    // Straight at the friend's chest (they stand at 0, 0, -5).
    expect(spec.velocity.z).toBeGreaterThan(84);
    game.relay.flush();
    expect(game.guest.combat.spawnCopy).toHaveBeenCalledOnce();
    foe.blast(new THREE.Vector3(0, 0, -5), 5, 44, 0, 'rocketeer');
    vi.advanceTimersByTime(500); game.hw.update();
    expect(game.host.combat.explode).not.toHaveBeenCalled();
    game.hw.dispose(); game.gw.dispose();
  });

  it('gives the host every player as a target for flames, rams and fires, and none to a guest', () => {
    const game = pair();
    const everyone = game.hw.hostPlayers()!;
    expect(everyone).toHaveLength(2);
    expect(everyone[0]).toBe(game.host.player as unknown as PlayerSystem);
    expect(everyone[1]!.position.toArray()).toEqual([0, 0, -5]);
    everyone[1]!.takeDamage({ amount: 4, type: 'fire', source: 'burner' });
    game.relay.flush();
    expect(game.guest.player.takeDamage).toHaveBeenCalledWith(expect.objectContaining({ amount: 4, type: 'fire', source: 'burner' }));
    expect(game.gw.hostPlayers()).toBeNull();
    game.hw.dispose(); game.gw.dispose();
  });
});

describe('the Commander on a guest', () => {
  const briefing = (): Briefing => ({ wave: 2, next: 3, phase: 'contact', adaptation: 'mortars', tricks: ['playDead'], fielded: ['mortars'], seconds: 20,
    report: { wave: 2, favouriteWeapon: 'smg', favouriteShots: 40, doorShots: 3, room: 'Yard', roomShare: 0.5, trapHits: [{ cause: 'mine', hits: 1, damage: 30 }], fallen: ['Voss'],
      seconds: 60, fightSeconds: 50, stillSeconds: 4, highSeconds: 0, fastSeconds: 9, shots: 80, kills: 12, headshots: 3, limbs: 2, executions: 0, meleeKills: 1, explosiveKills: 0,
      damageTaken: 20, pings: 1, pickups: 2, callIns: 0, rescuersKilled: 0, chatterFollowed: 0, gifts: 0, killMetres: 100, longestKill: 30, doorCrossings: 4 } });

  it('raises his briefing, barks and warning chips on the guest as its own game events', () => {
    const game = pair();
    const heard: string[] = [];
    game.guest.ctx.events.on('commander:briefing', b => heard.push(`briefing ${b.wave} ${b.report.room}`));
    game.guest.ctx.events.on('commander:bark', e => heard.push(`bark ${e.id} ${e.vars?.squad ?? ''}`));
    game.guest.ctx.events.on('commander:status', e => heard.push(`status ${e.flag} ${e.on}`));
    game.guest.ctx.events.on('commander:person', e => heard.push(`person ${e.arrived}`));
    game.host.ctx.events.emit('commander:briefing', briefing());
    game.host.ctx.events.emit('commander:bark', { id: 'order_flank', vars: { squad: 'Alpha' } });
    game.host.ctx.events.emit('commander:status', { flag: 'painted', on: true });
    game.host.ctx.events.emit('commander:person', { arrived: true });
    game.relay.flush();
    expect(heard).toEqual(['briefing 2 Yard', 'bark order_flank Alpha', 'status painted true', 'person true']);
    // The guest's own events never go back to the host.
    expect(game.relay.sent('cmd')).toHaveLength(4);
    game.hw.dispose(); game.gw.dispose();
  });

  it('refuses a briefing that is not one', () => {
    expect(cleanBriefing(briefing())).not.toBeNull();
    expect(cleanBriefing(null)).toBeNull();
    expect(cleanBriefing({ ...briefing(), wave: 'two' })).toBeNull();
    expect(cleanBriefing({ ...briefing(), tricks: ['x'.repeat(500)] })).toBeNull();
    expect(cleanBriefing({ ...briefing(), report: { ...briefing().report, trapHits: [{ cause: 5 }] } })).toBeNull();
    expect(cleanBriefing({ ...briefing(), report: { ...briefing().report, kills: Number.POSITIVE_INFINITY } })).toBeNull();
  });
});
