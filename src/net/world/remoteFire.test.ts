/**
 * A player's weapons on the wire (remoteFire.ts): what one game sends of a shot, a projectile, a loop's end, a swing and a
 * kit, what the host lets through, and what the watcher on the other screen is then handed. Over a stand-in world context:
 * the sender's events go through JSON, as the transport sends them, into the receiver's router.
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Ctx, GameEvents } from '../../core/contracts';
import type { FireNote, MeleeFx, ProjectileSpec } from '../../core/gameplay';
import { SeededRandom, randomInCone } from '../../core/math';
import { DOING } from '../pose';
import type { WorldEvent } from '../worldProtocol';
import type { WorldContext } from './context';
import { PERK_TRACERS, RemoteFire, originSlack, type FireEvent, type LoopEvent, type ProjEvent } from './remoteFire';
import { Router } from './router';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const note = (over: Partial<FireNote> = {}): FireNote => ({ kind: 'gun', left: false, barrel: 0, rays: 1, cone: 0, seed: 0, alt: false, aimed: false, to: v(0, 0, 0), ...over });

function side(hosting: boolean, slot: number) {
  const listeners = new Map<string, ((payload: unknown) => void)[]>();
  const sent: WorldEvent[] = [];
  const relayed: WorldEvent[] = [];
  const watcher = { held: false, hold: vi.fn(function (this: { held: boolean }) { this.held = true; }), fire: vi.fn(), loop: vi.fn(), launch: vi.fn(), meleeFx: vi.fn(), landed: vi.fn() };
  const root = new THREE.Group();
  const remote = { player: { slot: hosting ? 1 : 0 }, char: { root }, watcher };
  const weapons = { current: 'smg', fitted: new Set<string>(), akimbo: false, reloading: false, charge: 0 };
  const enemy = { uid: 7, alive: true };
  const ctx = { player: { alive: true }, weapons, time: { realDt: 1 }, enemies: { alive: [enemy] } } as unknown as Ctx;
  const validator = { acceptFire: vi.fn(() => true), kata: vi.fn() };
  const w = {
    ctx, hosting, ready: true, router: new Router(), validator,
    session: { lobby: { me: { slot }, you: hosting ? 'host' : 'guest', players: [{ id: 'guest', slot: 1 }, { id: 'host', slot: 0, host: true }] }, remotes: new Map([[hosting ? 'guest' : 'host', remote]]) },
    listen: (type: string, handler: (payload: unknown) => void) => { listeners.set(type, [...(listeners.get(type) ?? []), handler]); },
    send: (event: WorldEvent) => { sent.push(JSON.parse(JSON.stringify(event)) as WorldEvent); },
    relay: (event: WorldEvent) => { relayed.push(event); },
    sender: () => remote,
    life: () => ({ down: false }),
  } as unknown as WorldContext;
  const fire = new RemoteFire(w);
  const emit = <K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void => { for (const h of listeners.get(type) ?? []) h(payload); };
  const hear = (event: WorldEvent, from = hosting ? 'guest' : 'host'): void => w.router.dispatch(event, from, hosting, 1000);
  return { fire, emit, hear, sent, relayed, watcher, remote, root, weapons, validator, enemy };
}

describe('a shot on the wire', () => {
  it('a plain round is small, and the watcher is handed one round down the aim', () => {
    const host = side(true, 0), guest = side(false, 1);
    host.emit('weapon:fired', { weapon: 'smg', origin: v(1.23456, 1.62, -3.3333), dir: v(0, 0, -1), note: note() });
    const event = host.sent[0] as FireEvent;
    expect(event).toEqual({ t: 'fire', weapon: 'smg', origin: [1.235, 1.62, -3.333], dir: [0, 0, -1], slot: 0 });
    expect(JSON.stringify(event).length).toBeLessThan(90);
    guest.hear(event);
    const [weapon, origin, dir, told] = guest.watcher.fire.mock.calls[0]!;
    expect(weapon).toBe('smg');
    expect((origin as THREE.Vector3).x).toBeCloseTo(1.235);
    expect((dir as THREE.Vector3).z).toBe(-1);
    expect(told).toMatchObject({ kind: 'gun', rays: 1, cone: 0, seed: 0, left: false, alt: false });
  });

  it('a shotgun sends its pellets as a count, a cone and a seed, in about a hundred bytes', () => {
    const host = side(true, 0), guest = side(false, 1);
    host.emit('weapon:fired', { weapon: 'shotgun', origin: v(0, 1.62, 0), dir: v(0, 0, -1), note: note({ rays: 6, cone: 0.05, seed: 123456789 }) });
    const event = host.sent[0] as FireEvent;
    expect(event).toMatchObject({ n: 6, c: 0.05, s: 123456789 });
    expect(JSON.stringify(event).length).toBeLessThan(110);
    guest.hear(event);
    expect(guest.watcher.fire.mock.calls[0]![3]).toMatchObject({ rays: 6, cone: 0.05, seed: 123456789 });
  });

  it('one round off the aim goes as its own direction; a locked shot goes at the head it locked', () => {
    const host = side(true, 0), guest = side(false, 1);
    host.emit('weapon:fired', { weapon: 'buzzsaw', origin: v(0, 1.62, 0), dir: v(0, 0, -1), note: note({ cone: 0.02, seed: 99 }) });
    const want = randomInCone(v(0, 0, -1), 0.02, v(0, 0, 0), new SeededRandom().seed(99));
    const wobble = host.sent[0] as FireEvent;
    expect(wobble.c).toBeUndefined();
    expect(wobble.s).toBeUndefined();
    expect(wobble.dir[0]).toBeCloseTo(want.x, 3);
    expect(wobble.dir[1]).toBeCloseTo(want.y, 3);
    host.emit('weapon:fired', { weapon: 'judge', origin: v(0, 1.6, 0), dir: v(0, 0, -1), note: note({ aimed: true, to: v(10, 1.6, 0), left: true }) });
    const locked = host.sent[1] as FireEvent;
    expect(locked.dir).toEqual([1, 0, 0]);
    expect(locked.f).toBe(1);
    guest.hear(locked);
    expect(guest.watcher.fire.mock.calls[0]![3]).toMatchObject({ left: true, rays: 1 });
  });

  it('a gun that fires no hitscan round says so, with its barrel and its second load', () => {
    const host = side(true, 0), guest = side(false, 1);
    host.emit('weapon:fired', { weapon: 'quiver', origin: v(0, 1.6, 0), dir: v(0, 0, -1), note: note({ rays: 0, barrel: 3, alt: true }) });
    const event = host.sent[0] as FireEvent;
    expect(event).toMatchObject({ n: 0, f: 2 | (3 << 2) });
    guest.hear(event);
    expect(guest.watcher.fire.mock.calls[0]![3]).toMatchObject({ rays: 0, barrel: 3, alt: true });
  });

  it('the Lance\'s shots carry their kind; the Kiln is told a few times a second, not thirty', () => {
    const host = side(true, 0), guest = side(false, 1);
    for (const kind of ['rail', 'beam', 'ball', 'giant'] as const) host.emit('weapon:fired', { weapon: 'lance', origin: v(0, 1.6, 0), dir: v(0, 0, -1), note: note({ kind }) });
    expect(host.sent.map(e => (e as FireEvent).k)).toEqual(['rail', 'beam', 'ball', 'giant']);
    // The watcher is handed one reused note: read each as it comes.
    const kinds: string[] = [];
    guest.watcher.fire.mockImplementation((_w: unknown, _o: unknown, _d: unknown, told: FireNote) => { kinds.push(told.kind); });
    for (const event of host.sent) guest.hear(event);
    expect(kinds).toEqual(['rail', 'beam', 'ball', 'giant']);
    host.sent.length = 0;
    const now = vi.spyOn(performance, 'now');
    for (let i = 0; i < 30; i++) {
      now.mockReturnValue(50_000 + i * 33.3);
      host.emit('weapon:fired', { weapon: 'kiln', origin: v(0, 1.6, 0), dir: v(0, 0, -1), note: note({ kind: 'hose' }) });
    }
    now.mockRestore();
    expect(host.sent.length).toBeGreaterThanOrEqual(7);
    expect(host.sent.length).toBeLessThanOrEqual(9);
  });

  it('a swing carries its sound, its weight and the energy blade; junk in those fields is dropped', () => {
    const host = side(true, 0), guest = side(false, 1);
    host.emit('weapon:fired', { weapon: 'sword', origin: v(0, 1.6, 0), dir: v(0, 0, -1), note: note({ kind: 'swing', swing: { sound: 'sword_swing', pitch: 1.12, heavy: true, energy: true } }) });
    const event = host.sent[0] as FireEvent;
    expect(event).toMatchObject({ k: 'swing', f: 3, snd: 'sword_swing', p: 1.12 });
    guest.hear(event);
    expect((guest.watcher.fire.mock.calls[0]![3] as FireNote).swing).toEqual({ sound: 'sword_swing', pitch: 1.12, heavy: true, energy: true });
    guest.hear({ ...event, snd: '../../etc', p: 900 } as FireEvent);
    expect((guest.watcher.fire.mock.calls[1]![3] as FireNote).swing).toMatchObject({ sound: '', pitch: 1 });
  });

  it('the host checks a guest\'s shot (it left their body, it is not a flood), draws it and passes it on with their slot', () => {
    const host = side(true, 0);
    host.root.position.set(0, 0, 0);
    const shot: FireEvent = { t: 'fire', weapon: 'smg', origin: [0, 1.6, 0], dir: [0, 0, -1], slot: 3 };
    host.hear(shot);
    expect(host.watcher.fire).toHaveBeenCalledOnce();
    expect(host.relayed[0]).toMatchObject({ slot: 1 });
    host.hear({ ...shot, origin: [40, 1.6, 0] });
    host.validator.acceptFire.mockReturnValue(false);
    host.hear(shot);
    host.hear({ ...shot, origin: ['x', 0, 0] } as unknown as FireEvent);
    expect(host.watcher.fire).toHaveBeenCalledOnce();
    expect(host.relayed).toHaveLength(1);
  });
});

describe('projectiles, loops, swings in the air and kits on the wire', () => {
  const rocket = (over: Partial<ProjectileSpec> = {}): ProjectileSpec => ({
    origin: v(0, 1.6, -0.25), velocity: v(0, 0, -60), kind: 'rocket', team: 'player', damage: 100, source: 'rocket', trail: 'smoke',
    explosion: { radius: 8, damage: 100, kind: 'rocket' }, ...over,
  });

  it('a rocket crosses as its kind, start and speed, and is launched there as a copy that knows it explodes', () => {
    const host = side(true, 0), guest = side(false, 1);
    host.fire.projectile(rocket({ wired: true }));
    const event = host.sent[0] as ProjEvent;
    expect(event).toMatchObject({ t: 'round', k: 'rocket', src: 'rocket', v: [0, 0, -60], tr: 'smoke', x: 1, w: 1, i: 1 });
    expect(JSON.stringify(event).length).toBeLessThan(130);
    guest.hear(event);
    const spec = guest.watcher.launch.mock.calls[0]![0] as ProjectileSpec;
    expect(spec.kind).toBe('rocket');
    expect(spec.cosmetic).toBe(true);
    expect(spec.wired).toBe(true);
    expect(spec.explosion).toBeDefined();
    expect(spec.velocity.z).toBe(-60);
    expect(spec.tag).toBe(1);
    // When the shooter's goes off, the copy is ended there by the same number.
    host.fire.landed(1, v(0, 1.6, -30));
    expect(host.sent[1]).toEqual({ t: 'loop', k: 'proj', i: 1, at: [0, 1.6, -30], slot: 0 });
    guest.hear(host.sent[1]!);
    expect(guest.watcher.landed).toHaveBeenCalledOnce();
    expect(guest.watcher.landed.mock.calls[0]![0]).toBe(1);
    expect(guest.watcher.loop).not.toHaveBeenCalled();
  });

  it('a guided missile keeps its mark and its flight; a helix salvo its six numbers; a grenade its fuse', () => {
    const host = side(true, 0), guest = side(false, 1);
    host.fire.projectile(rocket({ source: 'quiver', target: host.enemy as never, turnRate: 3.6, steerDelay: 0.14, weave: 0.1, accel: 80, topSpeed: 58, size: 0.6 }));
    host.fire.projectile(rocket({ source: 'quiver', turnRate: 3.6, helix: { phase: 0.7854, reach: 40, radius: 0.7, pitch: 15, startRadius: 0.42, convergence: 12 } }));
    host.fire.projectile({ origin: v(0, 1.4, 0), velocity: v(0, 4, -12), kind: 'grenade', team: 'player', damage: 100, source: 'grenade', gravity: -20, fuse: 2.2, lifetime: 3.2, explosion: { radius: 6, damage: 100, kind: 'grenade' } });
    for (const event of host.sent) guest.hear(event);
    const [missile, braid, frag] = guest.watcher.launch.mock.calls.map(c => ({ ...(c[0] as ProjectileSpec) }));
    // The receiver's scratch spec is reused: read each as it was handed over.
    expect(guest.watcher.launch).toHaveBeenCalledTimes(3);
    expect(frag!.kind).toBe('grenade');
    expect(frag!.fuse).toBe(2.2);
    expect(frag!.gravity).toBe(20);
    expect((host.sent[0] as ProjEvent).tg).toBe(7);
    expect((host.sent[0] as ProjEvent).q).toEqual([3.6, 0.14, 0.1, 80, 58]);
    expect((host.sent[1] as ProjEvent).hx).toEqual([0.7854, 40, 0.7, 15, 0.42, 12]);
    void missile; void braid;
  });

  it('only a gun\'s own round or a thrown grenade is sent: not a copy, not napalm, not a call-in\'s shell', () => {
    const host = side(true, 0);
    host.fire.projectile(rocket({ cosmetic: true }));
    host.fire.projectile(rocket({ kind: 'flame', source: 'kiln' }));
    host.fire.projectile(rocket({ source: 'ac130' }));
    host.fire.projectile(rocket({ team: 'enemy', source: 'rocketeer' }));
    expect(host.sent).toHaveLength(0);
  });

  it('a beam\'s end and a giant ball\'s end reach the watcher, the ball\'s with where it went off', () => {
    const host = side(true, 0), guest = side(false, 1);
    host.emit('weapon:loop', { weapon: 'lance', kind: 'beam', on: false, at: v(0, 0, 0), normal: null });
    host.emit('weapon:loop', { weapon: 'lance', kind: 'giant', on: false, at: v(3, 1, -20), normal: v(0, 0, 1) });
    host.emit('weapon:loop', { weapon: 'kiln', kind: 'hose', on: false, at: v(0, 0, 0), normal: null });
    expect(host.sent).toEqual([{ t: 'loop', k: 'beam', slot: 0 }, { t: 'loop', k: 'giant', at: [3, 1, -20], n: [0, 0, 1], slot: 0 }, { t: 'loop', k: 'hose', slot: 0 }]);
    for (const event of host.sent) guest.hear(event);
    expect(guest.watcher.loop.mock.calls.map(c => c[0])).toEqual(['beam', 'giant', 'hose']);
    expect((guest.watcher.loop.mock.calls[1]![1] as THREE.Vector3).toArray()).toEqual([3, 1, -20]);
  });

  it('a slash drawn by a swing is drawn there with the same numbers', () => {
    const host = side(true, 0), guest = side(false, 1);
    const fx: MeleeFx = { kind: 'slash', a: v(1, 1.5, -2), b: v(0, 1, 0), c: v(1, 0, 0), x: 2.4, y: 2.5, look: 'heavy' };
    host.emit('melee:fx', fx);
    expect(JSON.stringify(host.sent[0]).length).toBeLessThan(110);
    guest.hear(host.sent[0]!);
    const got = guest.watcher.meleeFx.mock.calls[0]![0] as MeleeFx;
    expect(got.kind).toBe('slash');
    expect(got.a.toArray()).toEqual([1, 1.5, -2]);
    expect(got.x).toBe(2.4);
    expect(got.y).toBe(2.5);
    expect(got.look).toBe('heavy');
  });

  it('the kit goes out when the gun or its mods change, and reaches a body built after it', () => {
    const host = side(true, 0), guest = side(false, 1);
    host.weapons.current = 'smg';
    host.weapons.fitted.add('suppressor').add('gimletCan');
    host.fire.update();
    host.fire.update();
    expect(host.sent).toEqual([{ t: 'held', weapon: 'smg', mods: ['suppressor'], slot: 0 }]);
    guest.hear(host.sent[0]!);
    expect(guest.watcher.hold).toHaveBeenCalledWith('smg', ['suppressor']);
    host.weapons.fitted.delete('suppressor');
    host.fire.update();
    expect(host.sent[1]).toEqual({ t: 'held', weapon: 'smg', mods: [], slot: 0 });
    // A friend whose body is built later takes the kit they sent before it.
    const late = side(false, 1);
    const body = late.remote;
    (late.fire as unknown as { w: WorldContext }).w.session.remotes.clear();
    late.hear({ t: 'held', weapon: 'lance', mods: [], slot: 0 });
    expect(late.watcher.hold).not.toHaveBeenCalled();
    (late.fire as unknown as { w: WorldContext }).w.session.remotes.set('host', body as never);
    late.fire.update();
    expect(late.watcher.hold).toHaveBeenCalledWith('lance', []);
  });

  it('what the player is doing rides in the pose as bits', () => {
    const host = side(true, 0);
    expect(host.fire.doing()).toBe(0);
    host.weapons.reloading = true;
    expect(host.fire.doing() & DOING.reload).toBe(DOING.reload);
    host.weapons.reloading = false;
    host.emit('stim:inject', {});
    expect(host.fire.doing() & DOING.stim).toBe(DOING.stim);
    host.weapons.current = 'lance';
    host.weapons.charge = 0.4;
    expect(host.fire.doing() & DOING.charge).toBe(DOING.charge);
  });
});

describe('what a watcher was missing (fix-hits)', () => {
  it('a perk\'s tracer is the shooter\'s to say: Hellfire, Bloodthirst and Berserk rounds are drawn in their colour', () => {
    const host = side(true, 0), guest = side(false, 1);
    const perks = host.weapons as unknown as { modifiers: { tracer: string | null } };
    perks.modifiers = { tracer: null };
    host.emit('weapon:fired', { weapon: 'smg', origin: v(0, 1.6, 0), dir: v(0, 0, -1), note: note() });
    expect((host.sent[0] as FireEvent).tc).toBeUndefined();
    const seen: (string | null | undefined)[] = [];
    guest.watcher.fire.mockImplementation((_w: unknown, _o: unknown, _d: unknown, told: FireNote) => { seen.push(told.tracer); });
    guest.hear(host.sent[0]!);
    for (const perk of PERK_TRACERS) {
      perks.modifiers.tracer = perk;
      host.emit('weapon:fired', { weapon: 'smg', origin: v(0, 1.6, 0), dir: v(0, 0, -1), note: note() });
      guest.hear(host.sent.at(-1)!);
    }
    expect(seen).toEqual([null, ...PERK_TRACERS]);
    // A number that names no perk's tracer is the gun's own.
    guest.hear({ ...(host.sent.at(-1) as FireEvent), tc: 99 });
    expect(seen.at(-1)).toBeNull();
    // A swing has no tracer to send.
    host.emit('weapon:fired', { weapon: 'sword', origin: v(0, 1.6, 0), dir: v(0, 0, -1), note: note({ kind: 'swing', swing: { sound: 'sword_swing', pitch: 1, heavy: false, energy: false } }) });
    expect((host.sent.at(-1) as FireEvent).tc).toBeUndefined();
  });

  it('the rotary cannon\'s barrels are heard to spin up and to run down', () => {
    const host = side(true, 0), guest = side(false, 1);
    host.emit('weapon:loop', { weapon: 'buzzsaw', kind: 'whine', on: true, at: v(0, 0, 0), normal: null });
    host.emit('weapon:loop', { weapon: 'buzzsaw', kind: 'whine', on: false, at: v(0, 0, 0), normal: null });
    expect(host.sent).toMatchObject([{ t: 'loop', k: 'whine', on: 1 }, { t: 'loop', k: 'whine' }]);
    expect((host.sent[1] as LoopEvent).on).toBeUndefined();
    for (const event of host.sent) guest.hear(event);
    expect(guest.watcher.loop.mock.calls.map(call => [call[0], call[3]])).toEqual([['whine', true], ['whine', false]]);
  });

  it('a stake is numbered, so the others\' copies can be ended where the shooter\'s stopped in a body', () => {
    const host = side(true, 0), guest = side(false, 1);
    const spec: ProjectileSpec = { origin: v(0, 1.6, 0), velocity: v(0, 0, -120), kind: 'stake', team: 'player', damage: 90, source: 'stakegun' };
    const tag = host.fire.projectile(spec);
    expect(tag).toBeGreaterThan(0);
    expect((host.sent[0] as ProjEvent).i).toBe(tag);
    host.fire.landed(tag, v(0, 1.2, -14));
    guest.hear(host.sent[0]!); guest.hear(host.sent[1]!);
    expect(guest.watcher.launch).toHaveBeenCalledOnce();
    expect(guest.watcher.landed).toHaveBeenCalledOnce();
    expect(guest.watcher.landed.mock.calls[0]![0]).toBe(tag);
    expect((guest.watcher.landed.mock.calls[0]![1] as THREE.Vector3).z).toBe(-14);
  });

  it('launches and landings have their own counts: forty explosive rounds a second all fly and all end', () => {
    const host = side(true, 0);
    host.root.position.set(0, 0, 0);
    for (let i = 1; i <= 40; i++) {
      host.hear({ t: 'round', k: 'shell', src: 'autocannon', o: [0, 1.6, 0], v: [0, 0, -200], i, x: 1 });
      host.hear({ t: 'loop', k: 'proj', i, at: [0, 1, -30] });
    }
    expect(host.watcher.launch).toHaveBeenCalledTimes(40);
    expect(host.watcher.landed).toHaveBeenCalledTimes(40);
    expect(host.relayed).toHaveLength(80);
    expect(host.fire.dropped).toBe(0);
    // A flood is still a flood: past its own count a kind is left out, and counted. A landing is the last thing dropped.
    for (let i = 41; i <= 200; i++) host.hear({ t: 'round', k: 'shell', src: 'autocannon', o: [0, 1.6, 0], v: [0, 0, -200], i, x: 1 });
    expect(host.watcher.launch).toHaveBeenCalledTimes(80);
    expect(host.fire.dropped).toBe(120);
    for (let i = 41; i <= 200; i++) host.hear({ t: 'loop', k: 'proj', i, at: [0, 1, -30] });
    expect(host.watcher.landed).toHaveBeenCalledTimes(200);
  });

  it('a friend dashing on a slow link still has their shots drawn: the origin is allowed what a hit claim is', () => {
    expect(originSlack(0)).toBeCloseTo(16.1, 1);
    expect(originSlack(300)).toBeCloseTo(23.9, 1);
    expect(originSlack(undefined)).toBeCloseTo(22.6, 1);
    expect(originSlack(99999)).toBeCloseTo(originSlack(1500), 5);
    const host = side(true, 0);
    host.root.position.set(0, 0, 0);
    // 12 m from where the host has their body: a dash and a tenth of a second of lag. It was dropped at 7 m.
    host.hear({ t: 'fire', weapon: 'smg', origin: [12, 1.6, 0], dir: [0, 0, -1] });
    host.hear({ t: 'round', k: 'rocket', src: 'rocket', o: [12, 1.6, 0], v: [0, 0, -60], x: 1, i: 3 });
    expect(host.watcher.fire).toHaveBeenCalledOnce();
    expect(host.watcher.launch).toHaveBeenCalledOnce();
    // The other side of the map is still nowhere near them.
    host.hear({ t: 'fire', weapon: 'smg', origin: [120, 1.6, 0], dir: [0, 0, -1] });
    expect(host.watcher.fire).toHaveBeenCalledOnce();
  });
});
