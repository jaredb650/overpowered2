import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Enemy } from '../../enemies/Enemy';
import { GEAR_HEAVY } from '../../enemies/commander/props';
import { enlist, Soldier } from '../../enemies/outpost/soldier';
import type { WorldEvent } from '../worldProtocol';
import type { WorldContext } from './context';
import { Identity, type WhoEvent } from './identity';
import { MotionBuffer } from './motion';
import { MOVES_PER_SECOND, Moves, SAME_KIND_MS, type MoveEvent } from './moves';
import type { Replicas } from './replicas';
import { Router } from './router';

const at = (t: number): void => { if (t > performance.now()) vi.advanceTimersByTime(t - performance.now()); };

type Spy = ReturnType<typeof vi.fn>;
/** The animator's own methods, under the module's wrapping. */
const under = new WeakMap<object, { play: Spy; stumble: Spy; daze: Spy; getUp: Spy }>();

/** One side with what moves.ts and identity.ts touch: the animator and gore they listen at, and the lane they send on. */
function side(hosting: boolean) {
  const spawned: ((event: { enemy: Enemy }) => void)[] = [];
  const sent: { event: WorldEvent; to?: string }[] = [];
  const downed = new Set<object>();
  const gore = { knockdown: vi.fn((char: object) => { downed.add(char); return true; }), downed: (char: object) => (downed.has(char) ? { center: new THREE.Vector3() } : null), rouse: vi.fn() };
  // The module wraps these: the spies underneath are kept to see what reached them.
  const spies = { knockdown: gore.knockdown, rouse: gore.rouse };
  const router = new Router();
  const alive: Enemy[] = [];
  const players = [{ id: 'host', host: true, slot: 0, away: false }, { id: 'guest', host: false, slot: 1, away: false }];
  const w = { hosting, ready: true, router, ctx: { gore }, manager: { alive }, session: { lobby: { players } }, snapshotSent: [] as ((alive: Set<number>) => void)[],
    listen: (_type: string, handler: (event: { enemy: Enemy }) => void) => void spawned.push(handler),
    send: (event: WorldEvent, to?: string) => void sent.push({ event, to }) };
  const map = new Map<number, { enemy: Enemy; motion: MotionBuffer }>();
  const dead = new Set<number>();
  const waiting: [number, (enemy: Enemy) => void][] = [];
  const replicas = { map, dead, whenSeen: (uid: number, run: (enemy: Enemy) => void) => { const r = map.get(uid); if (r) run(r.enemy); else waiting.push([uid, run]); } };
  const moves = new Moves(w as unknown as WorldContext, replicas as unknown as Replicas);
  let uid = 0;
  const enemy = (): Enemy => {
    const e = new Enemy(); e.uid = ++uid; e.alive = true;
    const anim = { play: vi.fn(() => 1), stumble: vi.fn(), daze: vi.fn(), getUp: vi.fn(() => 1), flinch: vi.fn(), setLocomotion: vi.fn(), update: vi.fn() };
    e.char = { anim, root: new THREE.Group(), rig: { bones: Array.from({ length: 20 }, () => ({})) } } as unknown as Enemy['char'];
    under.set(e.char.anim, { ...anim });
    alive.push(e);
    for (const handler of spawned) handler({ enemy: e });
    return e;
  };
  /** Guest: the copy of host enemy `uid`, with a playhead. */
  const copy = (id: number, playhead: number): Enemy => {
    const e = enemy(); e.uid = id;
    const motion = new MotionBuffer(); motion.playhead = playhead;
    map.set(id, { enemy: e, motion });
    for (let i = waiting.length - 1; i >= 0; i--) if (waiting[i]![0] === id) waiting.splice(i, 1)[0]![1](e);
    return e;
  };
  const moved = () => sent.map(packet => packet.event).filter((event): event is MoveEvent => event.t === 'move');
  const take = (event: WorldEvent) => router.dispatch(event, 'host', false, performance.now());
  return { w, moves, gore: spies, enemy, copy, sent, moved, take, map, dead, downed, alive, players, replicas };
}
const inner = (e: Enemy) => under.get(e.char.anim)!;

describe('enemy moves', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['performance'] }); at(5000); });
  afterEach(() => vi.useRealTimers());

  it('the host sends what an enemy\'s animator begins, stamped with its clock, and never the attack clips', () => {
    const host = side(true);
    const e = host.enemy();
    const anim = e.char.anim as unknown as { play(a: string, s?: number): number; stumble(d: THREE.Vector3, s: number, b: number): void; daze(s: number): void; getUp(k: string, s: number, h: number, u?: number): number };
    anim.play('roar', 1.6); anim.play('attackMelee'); anim.play('shoot', 1.4); anim.play('throw'); anim.play('attackHeavy');
    anim.stumble(new THREE.Vector3(1, 0, 0), 0.7, 3); anim.daze(1.25); anim.getUp('supine', 1.4, 0.6, 0.2);
    expect(host.moved().map(m => [m.m, m.a])).toEqual([['roar', [1.6]], ['stumble', [1, 0, 0, 0.7, 3]], ['daze', [1.25]], ['getUp', [1, 1.4, 0.6, 0.2]]]);
    expect(host.moved().every(m => m.uid === e.uid && m.at === 5000)).toBe(true);
  });

  it('does not repeat itself, forgets a dead enemy, and stops at its cap for the second', () => {
    const host = side(true);
    const e = host.enemy();
    e.char.anim.play('stagger'); e.char.anim.play('stagger');
    expect(host.moved()).toHaveLength(1);
    at(5200); e.char.anim.play('stagger');
    expect(host.moved()).toHaveLength(2);
    e.alive = false; e.char.anim.play('roar');
    expect(host.moved()).toHaveLength(2);
    at(6000);
    for (let index = 0; index < MOVES_PER_SECOND + 30; index++) host.enemy().char.anim.play('land');
    expect(host.moved()).toHaveLength(2 + MOVES_PER_SECOND);
    expect(host.moves.counts.capped).toBe(30);
  });

  it('a body used again for another enemy speaks for the new one', () => {
    const host = side(true);
    const first = host.enemy();
    first.alive = false;
    // The pool hands the first's body to a new enemy.
    const again = host.enemy(); again.char = first.char;
    again.uid = 77;
    // Spawned with that body: tell the module, as the manager's spawn event does.
    (host.moves as unknown as { tap(e: Enemy): void }).tap(again);
    first.char.anim.play('leap');
    expect(host.moved().at(-1)).toMatchObject({ uid: 77, m: 'leap' });
  });

  it('the host sends a fall with the push that made it, once; a hit on a body already down is not a new fall', () => {
    const host = side(true);
    const e = host.enemy(); e.position.set(10, 0, 5);
    const gore = host.w.ctx.gore as unknown as { knockdown(c: object, o: object): boolean };
    const o = { velocity: new THREE.Vector3(1, 0, 2), impact: { dir: new THREE.Vector3(0, 0, 1), strength: 0.4 }, topple: new THREE.Vector3(0, 0, 3), lie: 2, rise: 1.2, hurt: 0.5,
      wound: { bone: 4, point: new THREE.Vector3(10.2, 1.4, 5.1) } };
    expect(gore.knockdown(e.char, o)).toBe(true);
    expect(gore.knockdown(e.char, o)).toBe(true);
    expect(host.moved()).toHaveLength(1);
    expect(host.moved()[0]).toMatchObject({ m: 'down', uid: e.uid });
    const a = host.moved()[0]!.a;
    expect(a.slice(0, 14)).toEqual([0, 0, 1, 0.4, 1, 0, 0, 3, 1, 0, 2, 2, 1.2, 0.5]);
    expect(a[14]).toBe(4);
    expect(a.slice(15, 18).map(n => Math.round(n * 10) / 10)).toEqual([0.2, 1.4, 0.1]);
  });

  it('a guest plays a move when the copy\'s playhead reaches its stamp, or after a while anyway', () => {
    const guest = side(false);
    const e = guest.copy(7, 4900);
    guest.take({ t: 'move', uid: 7, at: 5000, m: 'roar', a: [1.6] });
    guest.moves.update(performance.now());
    expect(inner(e).play).not.toHaveBeenCalled();
    guest.map.get(7)!.motion.playhead = 5001;
    guest.moves.update(performance.now());
    expect(inner(e).play).toHaveBeenCalledWith('roar', 1.6);
    guest.map.get(7)!.motion.playhead = 0;
    guest.take({ t: 'move', uid: 7, at: 9000, m: 'land', a: [1] });
    at(5600); guest.moves.update(performance.now());
    expect(inner(e).play).toHaveBeenCalledTimes(1);
    at(5800); guest.moves.update(performance.now());
    expect(inner(e).play).toHaveBeenLastCalledWith('land', 1);
  });

  it('never restarts a stagger or a fall that began on the copy a moment ago, whoever began it', () => {
    const guest = side(false);
    const e = guest.copy(7, 9999);
    // The guest's own gore staggered it from a hit it saw.
    e.char.anim.play('stagger', 1);
    at(5000 + SAME_KIND_MS - 50);
    guest.take({ t: 'move', uid: 7, at: 5000, m: 'stumble', a: [1, 0, 0, 0.5, 2] });
    guest.moves.update(performance.now());
    expect(inner(e).stumble).not.toHaveBeenCalled();
    expect(guest.moves.counts.covered).toBe(1);
    // A roar is not that kind of clip: it plays.
    guest.take({ t: 'move', uid: 7, at: 5000, m: 'roar', a: [1] });
    guest.moves.update(performance.now());
    expect(inner(e).play).toHaveBeenLastCalledWith('roar', 1);
    // Later, the same stumble is news.
    at(5000 + SAME_KIND_MS + 100);
    guest.take({ t: 'move', uid: 7, at: 5000, m: 'stumble', a: [1, 0, 0, 0.5, 2] });
    guest.moves.update(performance.now());
    expect(inner(e).stumble).toHaveBeenCalledOnce();
    // And the stumble this module just played covers a second one straight after.
    guest.take({ t: 'move', uid: 7, at: 5000, m: 'stagger', a: [1] });
    guest.moves.update(performance.now());
    expect(guest.moves.counts.covered).toBe(2);
    // Its own gore knocked it down: the host's `down` for the same fall is covered too.
    const other = guest.copy(8, 9999);
    (guest.w.ctx.gore as unknown as { knockdown(c: object): boolean }).knockdown(other.char);
    guest.gore.knockdown.mockClear();
    guest.take({ t: 'move', uid: 8, at: 5000, m: 'down', a: [0, 0, 1, 0.4] });
    guest.moves.update(performance.now());
    expect(guest.gore.knockdown).not.toHaveBeenCalled();
  });

  it('knocks the copy down with the host\'s push, and gets it up on the host\'s word', () => {
    const guest = side(false);
    const e = guest.copy(7, 9999); e.position.set(3, 0, 4);
    guest.take({ t: 'move', uid: 7, at: 5000, m: 'down', a: [0, 0, 1, 0.4, 1, 0, 0, 3, 1, 0, 2, 2, 1.2, 0.5, 4, 0.2, 1.4, 0.1, 0, 0, -1, 0] });
    guest.moves.update(performance.now());
    expect(guest.gore.knockdown).toHaveBeenCalledOnce();
    const [char, o] = guest.gore.knockdown.mock.calls[0] as unknown as [object, { velocity: THREE.Vector3; impact: { dir: THREE.Vector3; strength: number }; topple: THREE.Vector3; lie: number; rise: number; hurt: number; wound: { bone: number; point: THREE.Vector3 } }];
    expect(char).toBe(e.char);
    expect(o.velocity.toArray()).toEqual([1, 0, 2]);
    expect(o.impact).toMatchObject({ strength: 0.4 });
    expect(o.topple.toArray()).toEqual([0, 0, 3]);
    // It lies longer than the host's would: only the host's word gets it up.
    expect(o.lie).toBeGreaterThan(2);
    expect([o.rise, o.hurt, o.wound.bone]).toEqual([1.2, 0.5, 4]);
    expect(o.wound.point.toArray().map(n => Math.round(n * 10) / 10)).toEqual([3.2, 1.4, 4.1]);
    expect(e.downed).toBe(true);
    // Down in its own ragdoll: a stagger is nothing to it, and `getUp` rouses it rather than playing a clip over gore.
    guest.take({ t: 'move', uid: 7, at: 5000, m: 'roar', a: [1] });
    guest.take({ t: 'move', uid: 7, at: 5000, m: 'getUp', a: [0, 1.2, 0.5, 0] });
    guest.moves.update(performance.now());
    expect(inner(e).play).not.toHaveBeenCalled();
    expect(inner(e).getUp).not.toHaveBeenCalled();
    expect(guest.gore.rouse).toHaveBeenCalledWith(e.char);
    // A copy that never fell here plays the get-up clip.
    const lying = guest.copy(8, 9999);
    guest.take({ t: 'move', uid: 8, at: 5000, m: 'getUp', a: [1, 1.4, 0.6, 0.2] });
    guest.moves.update(performance.now());
    expect(inner(lying).getUp).toHaveBeenCalledWith('supine', 1.4, 0.6, 0.2);
  });

  it('the host says when a downed body begins to get itself up, or is back on its feet without lying; a copy starts up then', () => {
    const host = side(true);
    const rising = new Set<object>();
    Object.assign(host.w.ctx.gore, { rising: (char: object) => rising.has(char) });
    const a = host.enemy(), b = host.enemy();
    const rises = () => host.moved().filter(m => m.m === 'rise').map(m => m.uid);
    // On the floor, lying: nothing to say yet.
    a.downed = true; host.downed.add(a.char);
    host.moves.update(performance.now());
    expect(rises()).toEqual([]);
    // It begins to push itself up: said once, however many frames it takes.
    rising.add(a.char);
    for (let i = 0; i < 5; i++) { at(5000 + 200 * (i + 1)); host.moves.update(performance.now()); }
    expect(rises()).toEqual([a.uid]);
    // Handed back: nothing more. The next fall is a new one.
    a.downed = false; rising.delete(a.char);
    host.moves.update(performance.now());
    expect(rises()).toEqual([a.uid]);
    // A body that stumbled on its muscles and caught its balance never lay down to get up: it says so as it is handed back.
    b.downed = true;
    host.moves.update(performance.now());
    b.downed = false;
    host.moves.update(performance.now());
    expect(rises()).toEqual([a.uid, b.uid]);

    const guest = side(false);
    const copy = guest.copy(7, 9999), dropped = guest.copy(8, 9999), standing = guest.copy(9, 9999);
    guest.downed.add(copy.char); guest.downed.add(dropped.char);
    // One this player's own hit dropped for dead waits for the host's answer to that hit, not for this.
    dropped.predead = 1234;
    for (const uid of [7, 8, 9]) guest.take({ t: 'move', uid, at: 5000, m: 'rise', a: [] });
    guest.moves.update(performance.now());
    expect(guest.gore.rouse).toHaveBeenCalledTimes(1);
    expect(guest.gore.rouse).toHaveBeenCalledWith(copy.char);
    // A copy that never fell has nothing to do about it.
    expect(inner(standing).getUp).not.toHaveBeenCalled();
  });

  it('throws the copy the way the host\'s body went when a blast carried it', () => {
    const guest = side(false);
    const e = guest.copy(7, 9999);
    const motion = guest.map.get(7)!.motion;
    // The host's body, 8 m/s along x and rising, in the moments after the fall.
    for (let t = 5000; t <= 5200; t += 50) motion.push(t, (t - 5000) * 0.008, (t - 5000) * 0.003, 0, 0, 0, 0, 0);
    guest.take({ t: 'move', uid: 7, at: 5000, m: 'down', a: [1, 0, 0, 1, 0, 0, 0, 0, 0.5, 0, 0, 2, 1, 0.5] });
    guest.moves.update(performance.now());
    const o = guest.gore.knockdown.mock.calls[0]![1 as never] as unknown as { velocity: THREE.Vector3 };
    expect(o.velocity.x).toBeCloseTo(8, 0);
    expect(o.velocity.y).toBeCloseTo(3, 0);
    expect(e.downed).toBe(true);
  });

  it('keeps a move for an enemy not drawn yet, drops it if the enemy never comes or is dead, and refuses junk', () => {
    const guest = side(false);
    guest.take({ t: 'move', uid: 7, at: 5000, m: 'roar', a: [1] });
    guest.moves.update(performance.now());
    at(5400);
    const e = guest.copy(7, 9999);
    guest.moves.update(performance.now());
    expect(inner(e).play).toHaveBeenCalledWith('roar', 1);
    guest.take({ t: 'move', uid: 8, at: 5000, m: 'roar', a: [1] });
    at(7200); guest.moves.update(performance.now());
    const late = guest.copy(8, 9999);
    guest.moves.update(performance.now());
    expect(inner(late).play).not.toHaveBeenCalled();
    guest.dead.add(9);
    guest.take({ t: 'move', uid: 9, at: 5000, m: 'roar', a: [1] });
    for (const junk of [{ t: 'move', uid: 7, at: 1, m: 'attackMelee', a: [] }, { t: 'move', uid: 7, at: 1, m: 'roar', a: [NaN] }, { t: 'move', uid: 7, at: 1, m: 'roar', a: 'x' },
      { t: 'move', uid: -1, at: 1, m: 'roar', a: [] }, { t: 'move', uid: 7, at: Infinity, m: 'roar', a: [] }, { t: 'move', uid: 7, at: 1, m: 'down', a: new Array(40).fill(1) }]) guest.take(junk as never);
    inner(e).play.mockClear();
    guest.moves.update(performance.now());
    expect(inner(e).play).not.toHaveBeenCalled();
    // A stumble with a bone the copy does not have falls back to the plain stagger.
    at(9000);
    guest.take({ t: 'move', uid: 7, at: 5000, m: 'stumble', a: [1, 0, 0, 0.5, 999] });
    guest.moves.update(performance.now());
    expect(inner(e).stumble).not.toHaveBeenCalled();
    expect(inner(e).play).toHaveBeenLastCalledWith('stagger', 1);
  });

  it('puts the animators and gore back as they were when the match ends', () => {
    const host = side(true);
    const e = host.enemy();
    const wrapped = e.char.anim.play, knock = host.w.ctx.gore.knockdown;
    host.moves.dispose();
    expect(e.char.anim.play).not.toBe(wrapped);
    expect(host.w.ctx.gore.knockdown).not.toBe(knock);
    e.char.anim.play('roar');
    expect(host.moved()).toHaveLength(0);
  });
});

describe('soldier identity', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['performance'] }); at(5000); });
  afterEach(() => vi.useRealTimers());
  const soldier = (e: Enemy, name: number, squad: string, leads: boolean): Soldier => {
    const s = new Soldier(); s.e = e; s.name = name; s.desig = 21; s.nick = -1; s.rank = 'veteran'; s.seat = 2; s.voice = 3; s.known = true;
    s.squad = { name: squad, leader: leads ? s : null } as unknown as Soldier['squad'];
    enlist(e, s); return s;
  };

  it('the host tells each guest once who each man is, and a guest who comes late about everyone', () => {
    const host = side(true);
    const identity = new Identity(host.w as unknown as WorldContext, host.replicas as unknown as Replicas);
    const a = host.enemy(), b = host.enemy(), husk = host.enemy();
    soldier(a, 0, 'Alpha', true); soldier(b, 1, 'Alpha', false);
    identity.update(5000);
    const who = () => host.sent.filter(packet => packet.event.t === 'who');
    expect(who()).toHaveLength(1);
    expect(who()[0]).toMatchObject({ to: 'guest', event: { list: [[a.uid, 0, 21, -1, 2, 2, 3, 3, 'Alpha', 0], [b.uid, 1, 21, -1, 2, 2, 3, 1, 'Alpha', 0]] } });
    identity.update(5100); identity.update(5300);
    expect(who()).toHaveLength(1);
    void husk;
    host.players.push({ id: 'late', host: false, slot: 2, away: false });
    identity.update(5600);
    expect(who()).toHaveLength(2);
    expect(who()[1]).toMatchObject({ to: 'late' });
    expect((who()[1]!.event as { list: unknown[] }).list).toHaveLength(2);
  });

  it('a guest gives its copy the host\'s names, rank and squad, even when the word comes before the man', () => {
    const guest = side(false);
    const identity = new Identity(guest.w as unknown as WorldContext, guest.replicas as unknown as Replicas);
    guest.take({ t: 'who', list: [[7, 4, 22, 45, 3, 1, 5, 7, 'Bravo', 0], [8, 999, 0, 0, 0, 0, 0, 0, 'X', 0], [9, 1, 2, 3, 9, 0, 0, 0, 'X', 0]] });
    expect(identity.applied).toBe(0);
    const e = guest.copy(7, 0);
    // The copy enlisted with names of its own, as the guest's outpost code dealt them.
    const s = soldier(e, 11, 'Zulu', false);
    guest.take({ t: 'who', list: [[7, 4, 22, 45, 3, 1, 5, 7, 'Bravo', 0]] });
    expect(identity.applied).toBe(1);
    expect([s.name, s.desig, s.nick, s.rank, s.seat, s.voice, s.known, s.bravado]).toEqual([4, 22, 45, 'elite', 1, 5, true, true]);
    expect(s.rankDef.label).toBe('Lt');
    expect(s.squad.name).toBe('Bravo');
    expect(s.isLeader).toBe(true);
    expect(s.titled).toBe('Lt Bravo-1');
  });

  it('the host says what each man wears, says it again when that changes, and a guest dresses its copy by the host\'s word', () => {
    const host = side(true);
    const worn = new Map<Soldier, number>();
    (host.w.manager as unknown as { outpost: unknown }).outpost = { commander: { gearOf: (s: Soldier) => worn.get(s) ?? 0 } };
    const identity = new Identity(host.w as unknown as WorldContext, host.replicas as unknown as Replicas);
    const a = host.enemy(), b = host.enemy();
    const jammer = soldier(a, 0, 'Alpha', true), plain = soldier(b, 1, 'Alpha', false);
    // A whip antenna (bit 0) and the heavy helmet with its visor (bit 3 and GEAR_HEAVY).
    worn.set(jammer, 1 | 8 | GEAR_HEAVY);
    identity.update(5000);
    const rows = () => host.sent.filter(packet => packet.event.t === 'who').flatMap(packet => (packet.event as WhoEvent).list);
    expect(rows().map(row => [row[0], row[9]])).toEqual([[a.uid, 1 | 8 | GEAR_HEAVY], [b.uid, 0]]);
    identity.update(5200);
    expect(rows()).toHaveLength(2);
    // The plain man raises a hand with a live grenade in it: he alone is told again.
    worn.set(plain, 32);
    identity.update(5400);
    expect(rows().slice(2).map(row => [row[0], row[9]])).toEqual([[b.uid, 32]]);
    identity.update(5600);
    expect(rows()).toHaveLength(3);

    const guest = side(false);
    const wear = vi.fn();
    (guest.w.manager as unknown as { outpost: unknown }).outpost = { commander: { wear } };
    void new Identity(guest.w as unknown as WorldContext, guest.replicas as unknown as Replicas);
    const copy = soldier(guest.copy(7, 0), 11, 'Zulu', false);
    guest.take({ t: 'who', list: [[7, 4, 22, 45, 3, 1, 5, 7, 'Bravo', 1 | 8 | GEAR_HEAVY]] });
    expect(wear).toHaveBeenLastCalledWith(copy, 1 | 8 | GEAR_HEAVY);
    // Gear no man can have is no gear; the rest of the row still counts.
    guest.take({ t: 'who', list: [[7, 4, 22, 45, 3, 1, 5, 7, 'Bravo', -4]] });
    expect(wear).toHaveBeenLastCalledWith(copy, 0);
    guest.take({ t: 'who', list: [[7, 4, 22, 45, 3, 1, 5, 7, 'Bravo', 1e9]] });
    expect(wear).toHaveBeenLastCalledWith(copy, 0);
  });
});
