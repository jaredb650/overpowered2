/**
 * The world that breaks, shared (props.ts, world/objects.ts, world/breakables.ts): a host and two guests, each with its own
 * copy of the same barrels and props on real physics and the real combat. One thing breaks once, for everyone, by number.
 */
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ctx, PlayerDamage } from '../../core/contracts';
import { makeRange, type Range } from '../../weapons/testkit';
import type { Kit } from '../../world/kit/kit';
import { MapSpec } from '../../world/map/spec';
import { Objects } from '../../world/objects';
import { party, type Seat } from './sharedkit';
import { batchOf } from '../batch';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** Numbers on the wire: explosives 0 and 1 stand 4 m apart (a chain), 2 is far off. Props: 0 pane, 1 copier, 2 chair, 3 monitor. */
function layout(): MapSpec {
  const spec = new MapSpec();
  spec.reactor = null;
  spec.explosives.push({ kind: 'barrel', pos: V(0, 0, -10) }, { kind: 'barrel', pos: V(4, 0, -10) }, { kind: 'barrel', pos: V(60, 0, 0) });
  spec.breakable('pane', 10, 1.5, -5, 0, 2, 2);
  spec.breakable('copier', -20, 0, -20);
  spec.breakable('chair', 10, 0, 5);
  spec.breakable('monitor', 14, 0.8, 5);
  return spec;
}

interface Side { r: Range; ctx: Ctx; objects: Objects; booms: { source: string; by: string | null }[]; hurt: { amount: number; allowed: boolean }[]; seat: Seat }

async function side(): Promise<Omit<Side, 'seat'>> {
  const r = await makeRange();
  r.reset();
  const ctx = r.ctx;
  const objects = new Objects(ctx, layout(), { rng: Math.random } as unknown as Kit, () => new THREE.MeshBasicMaterial());
  objects.walls.attach(null);
  objects.props.attach(null);
  r.physics.flushQueries();
  (ctx as unknown as { world: unknown }).world = { objects, playerSpawns: [{ position: V(0, 0, 0), yaw: 0 }] };
  (ctx as unknown as { hud: unknown }).hud = { hitMarker() {}, feed() {}, follow: () => () => {}, callout() {}, marker: () => () => {} };
  (ctx as unknown as { waves: unknown }).waves = { wave: 1, phase: 'spawning', nextWaveIn: 0 };
  const booms: Side['booms'] = [];
  const hurt: Side['hurt'] = [];
  ctx.events.on('world:explosion', e => booms.push({ source: e.source, by: ctx.coop?.world?.crediting ?? null }));
  r.player.takeDamage = (d: PlayerDamage) => { hurt.push({ amount: d.amount, allowed: ctx.coop?.world?.allowsLocalDamage(d) ?? true }); };
  // Nobody stands near anything unless a test puts them there.
  r.player.position.set(0, 0, 200);
  r.player.eye.set(0, 1.6, 200);
  return { r, ctx, objects, booms, hurt };
}

async function table(guests = 2, begin = true) {
  const sides = await Promise.all(Array.from({ length: guests + 1 }, side));
  const game = party(guests, begin, sides.map(s => s.ctx));
  game.build();
  const all = [game.host, ...game.guests].map((seat, i) => ({ ...sides[i]!, seat })) as Side[];
  /** Frames of every game: its clock, its world objects, its combat, then its co-op world, then the wire. */
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      vi.advanceTimersByTime(1000 / 60);
      for (const s of all) {
        s.ctx.time.tick(1 / 60);
        s.objects.update();
        s.r.combat.update();
        if ((s.seat.world as unknown as { w: { ready: boolean } }).w.ready) (s.seat.world as unknown as { props: { update(now: number): void } }).props.update(performance.now());
      }
      game.relay.flush();
    }
  };
  return { game, all, run, host: all[0]!, a: all[1]!, b: all[2]! };
}

/** The collider a round from above would hit at (x, z). */
const under = (s: Side, x: number, z: number, y = 6) => s.r.physics.raycast(V(x, y, z), V(0, -1, 0), 20)!.collider;
const shoot = (s: Side, x: number, z: number, amount = 500, y = 6) => s.objects.damageExplosive(under(s, x, z, y), amount, 'smg');
const alive = (s: Side) => s.objects.explosives.map(e => e.alive);
const whole = (s: Side) => s.objects.props.props.map(p => p.alive);
const stand = (s: Side, x: number, z: number) => { s.r.player.position.set(x, 0, z); s.r.player.eye.set(x, 1.6, z); };

describe('barrels and props are one world in co-op', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }); vi.spyOn(console, 'info').mockImplementation(() => {}); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("the host's barrel goes off once, on every screen; only the host's copy hurts the enemies; the chain is the host's", async () => {
    const { game, all, run, host, a, b } = await table();
    for (const s of all) s.r.enemies.add(1, -10);
    shoot(host, 0, -10);
    game.relay.flush();
    // Barrel 0 is gone everywhere at once; its neighbour follows a beat later, on the host's word; the far one stands.
    expect(all.map(s => alive(s)[0])).toEqual([false, false, false]);
    run(0.5);
    expect(all.map(alive)).toEqual(Array(3).fill([false, false, true]));
    // Two blasts on the host. None counted on a guest: its copy is a picture.
    expect([host, a, b].map(s => s.booms.length)).toEqual([2, 0, 0]);
    expect(host.r.enemies.alive[0]!).toHaveProperty('hits.length', 2);
    expect(a.r.enemies.alive[0]!).toHaveProperty('hits.length', 0);
    // Each screen drew both explosions itself.
    expect(all.map(s => s.r.record.sounds.filter(id => id === 'explosion_barrel').length)).toEqual([2, 2, 2]);
    game.dispose();
  });

  it("a guest's shot sets it off at once on its own screen, once on the host as that guest's doing, and every player in reach is hurt", async () => {
    const { game, run, host, a, b } = await table();
    host.r.enemies.add(1, -10);
    a.r.enemies.add(1, -10);
    // The shooter stands 3 m from the barrel, the host 4 m, the other guest far away.
    stand(a, 0, -7); stand(host, 0, -14);
    shoot(a, 0, -10);
    expect(alive(a)[0]).toBe(false);
    expect(alive(host)[0]).toBe(true);
    run(0.1);
    expect([host, a, b].map(s => alive(s)[0])).toEqual([false, false, false]);
    // One blast, on the host, credited to the guest who shot (the chain after it too).
    run(0.5);
    expect(host.booms.map(x => x.by)).toEqual([game.guests[0]!.lobby.you, game.guests[0]!.lobby.you]);
    expect(a.booms).toHaveLength(0);
    // The guest's own copy of the enemy took nothing from here: no second helping through a claim.
    expect(a.r.enemies.alive[0]!).toHaveProperty('hits.length', 0);
    expect(host.r.enemies.alive[0]!).toHaveProperty('hits.length', 2);
    // The shooter is hurt by the barrel it shot, on its own screen, and that damage is let through; so is the host.
    expect(a.hurt.length).toBeGreaterThan(0);
    expect(a.hurt.every(h => h.allowed && h.amount > 0)).toBe(true);
    expect(host.hurt.length).toBeGreaterThan(0);
    expect(b.hurt).toHaveLength(0);
    game.dispose();
  });

  it('a window broken by any player is broken for all, and its way through is open on every screen', async () => {
    const { game, all, run, host, a, b } = await table();
    const blocked = (s: Side) => s.r.physics.raycast(V(10, 1.5, -8), V(0, 0, 1), 6) !== null;
    expect(all.map(blocked)).toEqual([true, true, true]);
    // A guest's round through the pane: gone at once for the shooter.
    a.objects.damageExplosive(a.r.physics.raycast(V(10, 1.5, -8), V(0, 0, 1), 6)!.collider, 20, 'smg');
    expect(whole(a)[0]).toBe(false);
    run(0.1);
    for (const s of all) s.r.physics.flushQueries();
    expect(all.map(s => whole(s)[0])).toEqual([false, false, false]);
    expect(all.map(blocked)).toEqual([false, false, false]);
    // The host's blast takes the monitor: on every screen.
    host.objects.damageExplosivesInRadius(V(14, 1, 5), 3, 200, 'rocket');
    run(0.1);
    expect(all.map(s => whole(s)[3])).toEqual([false, false, false]);
    // A guest's blast takes the copier, which goes up: the host's copy does the damage, each screen draws it.
    b.objects.damageExplosivesInRadius(V(-20, 0.5, -20), 4, 400, 'rocket');
    expect(whole(b)[1]).toBe(false);
    run(0.1);
    expect(all.map(s => whole(s)[1])).toEqual([false, false, false]);
    expect(host.booms.map(x => x.by)).toEqual([game.guests[1]!.lobby.you]);
    expect(b.booms).toHaveLength(0);
    game.dispose();
  });

  it('a guess the host does not confirm is put right: the thing stands again', async () => {
    const { game, run, host, a } = await table();
    // The guest's body is half a kilometre from the pane on the host's screen: the host refuses the hit.
    a.r.player.position.set(0, 0, 900);
    a.objects.damageExplosive(a.r.physics.raycast(V(10, 1.5, -8), V(0, 0, 1), 6)!.collider, 20, 'smg');
    expect(whole(a)[0]).toBe(false);
    run(0.2);
    expect(whole(host)[0]).toBe(true);
    expect(game.host.world.propStats.refused).toBe(1);
    run(3);
    expect(game.guests[0]!.world.propStats.asks).toBe(1);
    expect(whole(a)[0]).toBe(true);
    a.r.physics.flushQueries();
    expect(a.r.physics.raycast(V(10, 1.5, -8), V(0, 0, 1), 6)).not.toBeNull();
    game.dispose();
  });

  it('a late guest finds the world as broken as it is, with the chairs where they came to rest', async () => {
    const { game, all, run, host, a, b } = await table(2, false);
    shoot(host, 0, -10);
    host.objects.damageExplosive(host.r.physics.raycast(V(10, 1.5, -8), V(0, 0, 1), 6)!.collider, 20, 'smg');
    // A hit throws the chair; it comes to rest somewhere else.
    host.objects.damageExplosive(under(host, 10, 5, 3), 10, 'smg');
    for (let i = 0; i < 60 * 7; i++) { host.r.physics.step(1 / 60); host.ctx.time.tick(1 / 60); host.objects.update(); host.r.combat.update(); }
    const chair = host.objects.props.props[2]!;
    expect(chair.p.distanceTo(V(10, 0, 5))).toBeGreaterThan(0.2);
    // All of that went out while the guests' worlds were not up: dropped on their floor.
    game.relay.flush();
    expect(alive(a)).toEqual([true, true, true]);
    game.guests[0]!.world.begin();
    game.relay.flush();
    expect(alive(a)).toEqual(alive(host));
    expect(whole(a)).toEqual(whole(host));
    expect(a.objects.props.props[2]!.p.distanceTo(chair.p)).toBeLessThan(0.01);
    // No explosion was drawn or felt for what happened before it came.
    expect(a.r.record.sounds.filter(id => id === 'explosion_barrel')).toHaveLength(0);
    expect(a.hurt).toHaveLength(0);
    // The other guest, later still, and asked twice.
    game.guests[1]!.world.begin(); game.guests[1]!.world.begin();
    game.relay.flush();
    expect(alive(b)).toEqual(alive(host));
    expect(whole(b)).toEqual(whole(host));
    run(0.1);
    expect(all.map(alive)).toEqual(Array(3).fill(alive(host)));
    game.dispose();
  });

  it('a chair flies and comes to rest on the host, and every guest ends with it in the same place', async () => {
    const { game, all, run, host, a, b } = await table();
    // A guest shoots the chair: nothing moves there until the host says so.
    a.objects.damageExplosive(under(a, 10, 5, 3), 10, 'smg');
    expect(a.objects.props.props[2]!.body).toBeNull();
    run(0.1);
    expect(all.map(s => s.objects.props.props[2]!.body !== null)).toEqual([true, true, true]);
    for (let i = 0; i < 60 * 7; i++) { for (const s of all) s.r.physics.step(1 / 60); run(1 / 60); }
    const rest = host.objects.props.props[2]!.p;
    expect(rest.distanceTo(V(10, 0, 5))).toBeGreaterThan(0.2);
    expect([a, b].map(s => s.objects.props.props[2]!.p.distanceTo(rest) < 0.01)).toEqual([true, true]);
    expect(all.map(s => s.objects.props.props[2]!.body)).toEqual([null, null, null]);
    game.dispose();
  });

  it('a barrel comes back on the host and on every guest together, never on its own clock on a guest', async () => {
    const { game, all, run, host } = await table(1);
    shoot(host, 60, 0);
    run(0.1);
    expect(all.map(s => alive(s)[2])).toEqual([false, false]);
    // A guest's own clock would bring it back at 45 s; the host's player is 20 m away from it for longer.
    stand(host, 60, 10);
    run(47);
    expect(all.map(s => alive(s)[2])).toEqual([false, false]);
    stand(host, 0, 200);
    run(5);
    expect(all.map(s => alive(s)[2])).toEqual([true, true]);
    game.dispose();
  }, 60000);

  it("the map's machinery runs on the host's clock on every screen, and the reactor is in the host's state", async () => {
    const { game, all, run, host, a } = await table(2, false);
    // The host has been running for a while before the guests' worlds come up, as it always has.
    for (let i = 0; i < 60 * 30; i++) host.ctx.time.tick(1 / 60);
    host.objects.setReactorState('critical');
    game.guests[0]!.world.begin();
    run(0.1);
    expect(a.ctx.time.elapsed + a.objects.clockSkew).toBeCloseTo(host.ctx.time.elapsed, 1);
    expect(a.objects.reactorNow).toBe('critical');
    expect(host.objects.clockSkew).toBe(0);
    // It stays on it, and a change of the reactor reaches a guest within a frame or two.
    run(5);
    expect(a.ctx.time.elapsed + a.objects.clockSkew).toBeCloseTo(host.ctx.time.elapsed, 1);
    host.objects.setReactorState('stable');
    run(0.1);
    expect(a.objects.reactorNow).toBe('stable');
    expect(all).toHaveLength(3);
    game.dispose();
    expect(a.objects.clockSkew).toBe(0);
  });

  it('junk on the wire breaks nothing and throws nothing', async () => {
    const { game, all, run, host, a } = await table(1);
    const before = [alive(host), whole(host), alive(a), whole(a)];
    const junk: unknown[] = [
      { t: 'prop' }, { t: 'prop', op: 'hit' }, { t: 'prop', op: 'hit', set: 'q', id: 0, amount: 50, source: 'smg' },
      { t: 'prop', op: 'hit', set: 'x', id: 99, amount: 50, source: 'smg' }, { t: 'prop', op: 'hit', set: 'x', id: -1, amount: 50, source: 'smg' },
      { t: 'prop', op: 'hit', set: 'x', id: 0, amount: -5, source: 'smg' }, { t: 'prop', op: 'hit', set: 'x', id: 0, amount: NaN, source: 'smg' },
      { t: 'prop', op: 'hit', set: 'b', id: 0, amount: 50 }, { t: 'prop', op: 'blast', at: [0, 0], r: 5, amount: 50, source: 'x' },
      { t: 'prop', op: 'blast', at: [0, 0, -10], r: 5000, amount: 50, source: 'x' }, { t: 'prop', op: 'blast', at: [0, 0, 1e9], r: 5, amount: 50, source: 'x' },
      { t: 'prop', op: 'break', set: 'x', id: 0, source: 'smg' }, { t: 'prop', op: 'state', x: [0, 1, 2], b: [0, 1, 2, 3], chairs: [] }, { t: 'prop', op: 'restore', id: 0 },
    ];
    // From a guest: the host's world does not move (a guest cannot send the host's own words).
    for (const data of junk) game.guests[0]!.room.channel('action').send(batchOf('shared-test', [data]));
    run(0.2);
    expect([alive(host), whole(host)]).toEqual(before.slice(0, 2));
    // From the host: malformed words change nothing on the guest.
    for (const data of [{ t: 'prop', op: 'break' }, { t: 'prop', op: 'break', set: 'x', id: 'a' }, { t: 'prop', op: 'state', x: 'all', b: [] }, { t: 'prop', op: 'state', x: [1.5], b: [], chairs: [] },
      { t: 'prop', op: 'rest', id: 2, p: [0, 0], q: [0, 0, 0, 1] }, { t: 'prop', op: 'knock', id: 2, v: [1e9, 0, 0] }, { t: 'prop', op: 'state', x: [], b: [], chairs: [[2, [1, 2], [0, 0, 0, 1]]] }]) {
      game.host.room.channel('action').send(batchOf('shared-test', [data]));
    }
    run(0.2);
    expect([alive(a), whole(a)]).toEqual(before.slice(2));
    expect(all).toHaveLength(2);
    game.dispose();
  });
});

describe('solo, the barrels and props are as they were', () => {
  it('a barrel goes off on its own blast event, chains to its neighbour, and comes back by its own clock', async () => {
    const s = await side();
    s.r.enemies.add(1, -10);
    shoot(s as Side, 0, -10);
    expect(s.booms).toHaveLength(1);
    for (let i = 0; i < 40; i++) { s.ctx.time.tick(1 / 60); s.objects.update(); s.r.combat.update(); }
    expect(s.booms).toHaveLength(2);
    expect(alive(s as Side)).toEqual([false, false, true]);
    expect(s.r.enemies.alive[0]!).toHaveProperty('hits.length', 2);
    for (let i = 0; i < 60 * 46; i++) { s.ctx.time.tick(1 / 60); s.objects.update(); }
    expect(alive(s as Side)).toEqual([true, true, true]);
  });
});
