/**
 * Co-op copies of call-ins: the context that hurts nothing, the seed that makes every screen's strike the same, and each
 * aircraft and beam following its caller's word (ghost.ts, mirror.ts, link.ts).
 */
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ctx } from '../../core/contracts';
import type { ExplosionSpec, ProjectileSpec } from '../../core/gameplay';
import { noop } from '../../core/stubs';
import { AirliftCopy } from '../../enemies/outpost/airlift';
import { FramePuppet, MECH_POSE } from '../../frame/puppet';
import { MECH_FIRING } from '../../frame/seat';
import { makeRange, type Range } from '../../weapons/testkit';
import { AIRSTRIKE, CALLINS, FRAME_DROP, ORBITAL, WARTHOG } from '../data';
import { ModelMaterials } from '../modelkit';
import { Airstrike } from './airstrike';
import { ghostCtx, type GhostStats } from './ghost';
import { GroundProbe } from './ground';
import { uplinkJammed, type CallOrder, type NewsKind } from './link';
import { CallinMirror, MAX_COPIES } from './mirror';
import type { NukeAftermath } from './nuke';
import { Orbital } from './orbital';
import { Ordnance } from './ordnance';
import { rngOf, TELL_EVERY, type StrikeKit, type StrikeOrder } from './shared';
import { Warthog } from './warthog';

let r: Range;
let scene: THREE.Scene;
let materials: ModelMaterials;
const stats = (): GhostStats => ({ blasts: 0, projectiles: 0, rays: 0 });

beforeEach(async () => {
  r = await makeRange();
  r.reset();
  const ctx = r.ctx as Ctx & Record<string, unknown>;
  scene = new THREE.Scene();
  ctx.render = new Proxy(ctx.render, {
    get: (t, k) => (k === 'scene' ? scene : k === 'materials' ? { patch: (m: THREE.Material) => m } : Reflect.get(t, k)),
  });
  ctx.hud = { feed() {}, banner() {}, marker: () => () => {}, follow: () => () => {}, hitMarker() {} } as unknown as Ctx['hud'];
  ctx.world = { nav: { nearest: (p: THREE.Vector3, _d: number, out: THREE.Vector3) => (out.copy(p), true) }, bounds: new THREE.Box3(new THREE.Vector3(-100, -5, -100), new THREE.Vector3(100, 60, 100)) } as unknown as Ctx['world'];
  r.player.position.set(0, 0, 0);
  materials = new ModelMaterials(r.ctx);
});

function kitOn(ctx: Ctx, cosmetic = false): StrikeKit {
  return { ctx, probe: new GroundProbe(ctx), materials, ordnance: new Ordnance(ctx, materials), jet: new THREE.Group(), cosmetic };
}

/** Runs a strike with the world it flies in, a sixtieth of a second at a time. */
function fly(strike: { update(dt: number): boolean }, kit: StrikeKit, seconds: number): boolean {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    const done = strike.update(1 / 60);
    kit.ordnance.update(1 / 60);
    r.run(1 / 60);
    if (done) return true;
  }
  return false;
}

const order = (seed: number, x = 0, z = -30): StrikeOrder => ({ point: new THREE.Vector3(x, 0, z), heading: new THREE.Vector3(1, 0, 0), seed });

describe('the context a copy flies on', () => {
  it('draws a blast and hurts nobody, and leaves the shared spec as it found it', () => {
    const target = r.enemies.add(0, -30, 100);
    const ghost = ghostCtx(r.ctx, stats());
    const spec: ExplosionSpec = { radius: 8, damage: 99999, kind: 'rocket', source: 'airstrike', team: 'player', instakill: true };
    ghost.combat.explode(new THREE.Vector3(0, 1, -30), spec);
    expect(r.record.explosions).toBe(1);
    expect(target.hits).toHaveLength(0);
    expect(target.alive).toBe(true);
    expect(spec.cosmetic).toBeUndefined();
    // The same blast from the player's own game is the real thing.
    r.ctx.combat.explode(new THREE.Vector3(0, 1, -30), spec);
    expect(target.hits.length).toBeGreaterThan(0);
  });

  it('flies a round to the first body or wall in its way, bursts there, and hurts nobody', () => {
    const beside = r.enemies.add(3, -15, 100);
    const atTheEnd = r.enemies.add(1.5, -29, 100);
    const inTheWay = beside;
    r.wall(-30, 1);
    const counted = stats();
    const ghost = ghostCtx(r.ctx, counted);
    const round: ProjectileSpec = { origin: new THREE.Vector3(0, 1.2, 0), velocity: new THREE.Vector3(0, 0, -60), kind: 'rocket', team: 'player', damage: 500, source: 'chopper_rocket',
      explosion: { radius: 6, damage: 500, kind: 'rocket' } };
    ghost.combat.spawnProjectile(round);
    r.run(1);
    expect(counted.projectiles).toBe(1);
    expect(round.ghost).toBeUndefined();
    expect(r.record.explosions).toBe(1);
    expect(r.record.blasts[0]!.z).toBeGreaterThan(-30.5);
    expect(r.record.blasts[0]!.z).toBeLessThan(-29);
    expect(inTheWay.hits).toHaveLength(0);
    expect(atTheEnd.hits).toHaveLength(0);
    // A man right on its line: it bursts on him, as the caller's does, and he is unhurt.
    const struck = r.enemies.add(0, -12, 100);
    ghost.combat.spawnProjectile(round);
    r.run(1);
    expect(r.record.explosions).toBe(2);
    expect(r.record.blasts[1]!.z).toBeGreaterThan(-13);
    expect(struck.hits).toHaveLength(0);
    expect(struck.alive).toBe(true);
  });

  it('a ray is a tracer and an impact, and never a hit', () => {
    const target = r.enemies.add(0, -10, 100);
    r.wall(-20, 1);
    const counted = stats();
    const ghost = ghostCtx(r.ctx, counted);
    const result = ghost.combat.fireRay(new THREE.Vector3(0, 1.2, 0), new THREE.Vector3(0, 0, -1), { damage: 60, source: 'door_gun', team: 'player', tracer: 'heavy' });
    expect(result.hitEnemy).toBe(false);
    expect(result.end.z).toBeCloseTo(-20, 1);
    expect(target.hits).toHaveLength(0);
    expect(r.record.tracers).toHaveLength(1);
    expect(r.record.impacts).toHaveLength(1);
    expect(counted.rays).toBe(1);
  });

  it('applies no damage and no fire, shows no banner, and never has a key down', () => {
    const target = r.enemies.add(0, -10, 100);
    let banners = 0;
    (r.ctx.hud as unknown as { banner: () => void }).banner = () => void banners++;
    const ghost = ghostCtx(r.ctx, stats());
    ghost.enemies.applyDamage(target, { amount: 500, type: 'fire', point: target.center, dir: new THREE.Vector3(0, 0, -1), force: 1, source: 'orbital' });
    ghost.enemies.afflict(target, 'burn', 5);
    expect(target.hits).toHaveLength(0);
    expect(target.burning).toBe(0);
    ghost.hud.banner('SPECTRE ON STATION', '', '#fff');
    expect(banners).toBe(0);
    r.input.simulate('fire', true);
    expect(ghost.input.isDown('fire')).toBe(false);
    expect(r.ctx.input.isDown('fire')).toBe(true);
    // Everything else is the real game's.
    expect(ghost.enemies.alive).toBe(r.ctx.enemies.alive);
    expect(ghost.physics).toBe(r.ctx.physics);
  });
});

describe('alone there is no seed: a strike rolls from Math.random, draw for draw as before co-op', () => {
  afterEach(() => vi.restoreAllMocks());
  const alone = (): StrikeOrder => ({ point: new THREE.Vector3(0, 0, -30), heading: new THREE.Vector3(1, 0, 0) });

  it('an order with no seed hands back Math.random itself, one draw a roll, and a seeded one never touches it', () => {
    const draws = vi.spyOn(Math, 'random').mockReturnValueOnce(0.125).mockReturnValueOnce(0.75);
    const rng = rngOf(alone());
    expect(draws).toHaveBeenCalledTimes(0);
    expect([rng(), rng()]).toEqual([0.125, 0.75]);
    expect(draws).toHaveBeenCalledTimes(2);
    const seeded = rngOf(order(7));
    seeded();
    seeded();
    expect(draws).toHaveBeenCalledTimes(2);
  });

  it('the Airstrike draws five numbers a rocket, in the order it always did', () => {
    const seen: number[][] = [];
    const spy = new Proxy(r.ctx, { get: (t, k) => (k === 'combat' ? { ...noop<object>('combat'), spawnProjectile: (s: ProjectileSpec) => void seen.push([...s.origin.toArray(), ...s.velocity.toArray()]), explode() {} } : Reflect.get(t, k)) });
    const kit = kitOn(spy);
    const strike = new Airstrike(kit, alone());
    // Up to the moment before the first rocket, then the dice are watched over that one rocket.
    fly(strike, kit, AIRSTRIKE.rocketsAt - 0.05);
    expect(seen).toHaveLength(0);
    const dice = [0.5, 0.25, 0.5, 0.5, 0.5];
    let i = 0;
    const draws = vi.spyOn(Math, 'random').mockImplementation(() => dice[i++ % dice.length]!);
    fly(strike, kit, 0.1);
    expect(seen).toHaveLength(1);
    expect(draws).toHaveBeenCalledTimes(5);
    // The radius from the first draw, the angle from the second (a quarter turn: straight along +z).
    expect(seen[0]![0]).toBeCloseTo(0, 5);
    expect(seen[0]![2]).toBeCloseTo(-30 + 0.5 * AIRSTRIKE.scatter, 5);
    // No drift at 0.5 and 0.5: straight down.
    expect(seen[0]![3]).toBeCloseTo(0, 6);
    expect(seen[0]![5]).toBeCloseTo(0, 6);
  });
});

describe('the seed', () => {
  /** Where every rocket or shell of a strike starts and which way it goes. */
  function launches(make: (kit: StrikeKit) => { update(dt: number): boolean }, seconds: number): number[][] {
    const seen: number[][] = [];
    const spy = new Proxy(r.ctx, { get: (t, k) => (k === 'combat' ? { ...noop<object>('combat'), spawnProjectile: (s: ProjectileSpec) => void seen.push([...s.origin.toArray(), ...s.velocity.toArray()]), explode() {} } : Reflect.get(t, k)) });
    const kit = kitOn(spy);
    fly(make(kit), kit, seconds);
    return seen;
  }

  it("gives two screens' airstrikes the same fifteen rockets from the same places", () => {
    const mine = launches(kit => new Airstrike(kit, order(4242)), AIRSTRIKE.rocketsAt + AIRSTRIKE.rockets * AIRSTRIKE.rocketGap + 0.2);
    const theirs = launches(kit => new Airstrike(kit, order(4242)), AIRSTRIKE.rocketsAt + AIRSTRIKE.rockets * AIRSTRIKE.rocketGap + 0.2);
    const other = launches(kit => new Airstrike(kit, order(4243)), AIRSTRIKE.rocketsAt + AIRSTRIKE.rockets * AIRSTRIKE.rocketGap + 0.2);
    expect(mine).toHaveLength(AIRSTRIKE.rockets);
    expect(theirs).toEqual(mine);
    expect(other).not.toEqual(mine);
  });

  it("gives two screens' Warthogs the same line of shells", () => {
    const seconds = WARTHOG.shellsAt + WARTHOG.shells * WARTHOG.shellGap + 0.2;
    const mine = launches(kit => new Warthog(kit, order(77)), seconds);
    const theirs = launches(kit => new Warthog(kit, order(77)), seconds);
    expect(mine).toHaveLength(WARTHOG.shells);
    expect(theirs).toEqual(mine);
    expect(launches(kit => new Warthog(kit, order(78)), seconds)).not.toEqual(mine);
  });
});

describe('the Orbital Lance, steered', () => {
  it("the caller's own tells its aim; a copy follows that, at the beam's own speed, and never its own screen's aim", () => {
    const said: { kind: NewsKind; values: number[] }[] = [];
    const aim = new THREE.Vector3(20, 0, -30);
    const own = kitOn(r.ctx);
    const mine = new Orbital(own, order(1), { solve: out => (out.copy(aim), true) }, { tell: (kind, values) => void said.push({ kind, values: values ?? [] }) });
    const ghost = kitOn(ghostCtx(r.ctx, stats()), true);
    // The copy's own targeting would send it the other way: it must not be asked.
    const copy = new Orbital(ghost, order(1), { solve: out => (out.set(-50, 0, -30), true) }, { puppet: true });
    for (let i = 0; i < 120; i++) {
      mine.update(1 / 60);
      for (const word of said.splice(0)) copy.news(word.kind, word.values);
      copy.update(1 / 60);
    }
    // Two seconds at the beam's speed toward the caller's aim, on both.
    expect(mine.where.x).toBeCloseTo(Math.min(20, ORBITAL.steerSpeed * 2), 0);
    expect(copy.where.x).toBeGreaterThan(mine.where.x - ORBITAL.steerSpeed * (TELL_EVERY + 2 / 60) - 0.01);
    expect(copy.where.x).toBeLessThanOrEqual(mine.where.x + 0.01);
    // Let go: the copy stops where it stands.
    mine.release();
    const told = said.splice(0);
    expect(told.some(word => word.kind === 'release')).toBe(true);
    for (const word of told) copy.news(word.kind, word.values);
    const stopped = copy.where.x;
    aim.set(-40, 0, -30);
    for (let i = 0; i < 60; i++) { mine.update(1 / 60); copy.update(1 / 60); }
    expect(copy.where.x).toBeCloseTo(stopped, 5);
    expect(said.filter(word => word.kind === 'steer')).toHaveLength(0);
    mine.dispose(); copy.dispose();
  });

  it('a copy sets nobody alight and burns nobody under its beam', () => {
    const target = r.enemies.add(0, -30, 5000);
    const ghost = kitOn(ghostCtx(r.ctx, stats()), true);
    const copy = new Orbital(ghost, order(1), { solve: () => false }, { puppet: true });
    fly(copy, ghost, ORBITAL.chargeTime + 2);
    expect(target.hits).toHaveLength(0);
    expect(target.burning).toBe(0);
    // The player's own does both.
    const own = kitOn(r.ctx);
    fly(new Orbital(own, order(1), { solve: () => false }), own, ORBITAL.chargeTime + 2);
    expect(target.hits.length).toBeGreaterThan(0);
    expect(target.burning).toBeGreaterThan(0);
  });
});

describe('the mirror', () => {
  const call = (id: CallOrder['id'], n = 1, at: [number, number, number] = [0, 0, -30]): CallOrder => ({ n, id, at, yaw: 0, seed: 99, ai: true, age: 0 });
  const mirror = () => new CallinMirror(r.ctx, materials, { skyline: { at: () => 0, along: () => 0, ground: () => 0 }, prisoners: new Set() } as never,
    { begin() {}, update() {}, clear() {}, materials: [] } as unknown as NukeAftermath);
  function run(m: CallinMirror, seconds: number): void {
    for (let i = 0; i < Math.round(seconds * 60); i++) { m.update(1 / 60); r.run(1 / 60); }
  }

  it("flies another player's airstrike: fifteen rockets and the finale drawn, and the men under it unhurt", () => {
    const target = r.enemies.add(0, -30, 100);
    const m = mirror();
    m.begin(2, call('airstrike'));
    expect(m.copies(2)).toHaveLength(1);
    run(m, AIRSTRIKE.finaleAt + 3);
    expect(m.stats.projectiles).toBe(AIRSTRIKE.rockets);
    expect(m.stats.blasts).toBe(1);
    expect(r.record.explosions).toBe(AIRSTRIKE.rockets + 1);
    expect(target.hits).toHaveLength(0);
    // Over: nothing is left of it.
    expect(m.copies(2)).toHaveLength(0);
  });

  it('plays one call once, keeps each player their own, and caps what one player can have up', () => {
    const m = mirror();
    m.begin(1, call('airstrike', 5));
    m.begin(1, call('airstrike', 5));
    m.begin(3, call('blackSun', 5));
    expect(m.copies(1)).toHaveLength(1);
    expect(m.copies(3)).toHaveLength(1);
    for (let n = 10; n < 10 + MAX_COPIES + 3; n++) m.begin(1, call('airstrike', n));
    expect(m.copies(1)).toHaveLength(MAX_COPIES);
    // A slot that is no player's, and a call-in that is no call-in, start nothing.
    m.begin(9, call('airstrike'));
    m.begin(2, call('bfg' as CallOrder['id']));
    expect(m.copies(2)).toHaveLength(0);
    m.drop(1);
    expect(m.copies(1)).toHaveLength(0);
    expect(m.copies(3)).toHaveLength(1);
    m.clear();
    expect(m.copies(3)).toHaveLength(0);
  });

  describe('a copy keeps up with the wall clock since its caller\'s began', () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ['performance'] }));
    afterEach(() => vi.useRealTimers());
    /** Frames with the wall clock moving with them, as on a screen that keeps time. */
    const play = (m: CallinMirror, seconds: number): void => {
      for (let i = 0; i < Math.round(seconds * 60); i++) { vi.advanceTimersByTime(1000 / 60); m.update(1 / 60); r.run(1 / 60); }
    };
    const copy = (m: CallinMirror, slot: number) => m.copies(slot)[0] as unknown as { age: number; strike: { where: THREE.Vector3 } } | undefined;

    it('a player who arrives part-way gets it from where it is: the skipped stretch runs without picture or sound, the rest is drawn', () => {
      const whole = mirror(), late = mirror();
      whole.begin(1, call('warthog', 3));
      play(whole, 2);
      const sounds = r.record.sounds.length, blasts = whole.stats.blasts, rounds = whole.stats.projectiles;
      // Told two seconds in (the order carries its age): one frame later it is where the other screen's is.
      late.begin(1, { ...call('warthog', 3), age: 2 });
      vi.advanceTimersByTime(1000 / 60); late.update(1 / 60); whole.update(1 / 60); r.run(1 / 60);
      expect(copy(late, 1)!.age).toBeCloseTo(copy(whole, 1)!.age, 1);
      expect(copy(late, 1)!.strike.where.distanceTo(copy(whole, 1)!.strike.where)).toBeLessThan(3);
      // Nothing of the two seconds it skipped was drawn or heard.
      expect(late.stats.blasts + late.stats.projectiles + late.stats.rays).toBeLessThanOrEqual((whole.stats.blasts - blasts) + (whole.stats.projectiles - rounds) + 2);
      expect(r.record.sounds.length - sounds).toBeLessThan(12);
      // And it is told on, with its age, to whoever arrives next.
      expect(late.orders(1)[0]).toMatchObject({ id: 'warthog', n: 3 });
      expect(late.orders(1)[0]!.age).toBeGreaterThan(2); expect(late.orders(1)[0]!.age).toBeLessThan(2.2);
      // From there the two fly on together.
      for (let i = 0; i < 60; i++) { vi.advanceTimersByTime(1000 / 60); whole.update(1 / 60); late.update(1 / 60); r.run(1 / 60); }
      expect(copy(late, 1)!.strike.where.distanceTo(copy(whole, 1)!.strike.where)).toBeLessThan(3);
    });

    it('a short strike that is already over when a player arrives is never shown, and one in its last moments shows only what is left', () => {
      const m = mirror();
      m.begin(2, { ...call('airstrike', 8), age: AIRSTRIKE.finaleAt + 20 });
      // Twenty seconds of a strike's time are made up a frame, so a long-gone one takes two.
      for (let i = 0; i < 3; i++) { vi.advanceTimersByTime(1000 / 60); m.update(1 / 60); }
      expect(m.copies(2)).toHaveLength(0);
      expect(m.stats.projectiles).toBe(0); expect(m.stats.blasts).toBe(0);
      const rest = mirror();
      rest.begin(2, { ...call('airstrike', 9), age: AIRSTRIKE.finaleAt - 0.5 });
      play(rest, 4);
      expect(rest.stats.projectiles).toBeLessThan(AIRSTRIKE.rockets);
      expect(rest.stats.blasts).toBe(1);
    });

    it('a screen that stood still for a while catches its copy up instead of flying it late for the rest of its life', () => {
      const steady = mirror(), stalled = mirror();
      steady.begin(1, call('warthog', 3)); stalled.begin(1, call('warthog', 3));
      for (let i = 0; i < 30; i++) { vi.advanceTimersByTime(1000 / 60); steady.update(1 / 60); stalled.update(1 / 60); r.run(1 / 60); }
      // One and a half seconds in which only the steady screen draws frames (a hidden tab, a long hitch).
      for (let i = 0; i < 90; i++) { vi.advanceTimersByTime(1000 / 60); steady.update(1 / 60); r.run(1 / 60); }
      expect(copy(steady, 1)!.age - copy(stalled, 1)!.age).toBeGreaterThan(1.4);
      stalled.update(1 / 60); steady.update(1 / 60);
      expect(Math.abs(copy(steady, 1)!.age - copy(stalled, 1)!.age)).toBeLessThan(0.1);
      expect(copy(stalled, 1)!.strike.where.distanceTo(copy(steady, 1)!.strike.where)).toBeLessThan(6);
    });

    it("an enemy's missile at the caller's aircraft is flown on the watcher's screen from the same spot, and bursts where the caller's did", () => {
      const m = mirror();
      m.begin(1, call('airstrike', 4));
      const before = scene.children.length;
      m.news(1, { n: 4, k: 'aa', v: [40, 1, 40] });
      const missiles = (m as unknown as { hangars: ({ missiles: { body: THREE.Object3D; end: THREE.Vector3 | null }[] } | null)[] }).hangars[1]!.missiles;
      expect(missiles).toHaveLength(1);
      expect(scene.children.length).toBe(before + 1);
      const from = missiles[0]!.body.position.clone();
      play(m, 0.6);
      // It climbs and turns toward this screen's copy of the aircraft.
      expect(missiles[0]!.body.position.y).toBeGreaterThan(from.y + 3);
      // The caller's missile burst there (on the aircraft, on a flare): this one ends there too, and leaves nothing behind.
      m.news(1, { n: 4, k: 'aax', v: [20, 30, 20] });
      expect(missiles[0]!.end).not.toBeNull();
      play(m, 4);
      expect(missiles).toHaveLength(0);
      expect(scene.children.length).toBeLessThanOrEqual(before);
      // News for a call-in this screen has no copy of, or with no place in it, starts nothing.
      m.news(1, { n: 99, k: 'aa', v: [0, 0, 0] });
      m.news(3, { n: 4, k: 'aa', v: [0, 0, 0] });
      expect(missiles).toHaveLength(0);
    });
  });

  it('the uplink jammer holds a guest as it holds the host: a guest goes by the host\'s word, everyone else by their own radio men', () => {
    // Alone, or hosting: the Commander's own count of radio men, whatever anyone said.
    expect(uplinkJammed(false, false, 1)).toBe(true);
    expect(uplinkJammed(false, true, 0)).toBe(false);
    // A guest has no radio men of its own (its count is always 0): the host's word decides.
    expect(uplinkJammed(true, true, 0)).toBe(true);
    expect(uplinkJammed(true, false, 0)).toBe(false);
  });

  it("a strike the Commander shot down is gone from the copy's screen too", () => {
    const m = mirror();
    m.begin(1, call('airstrike', 4));
    m.news(1, { n: 4, k: 'end' });
    expect(m.copies(1)).toHaveLength(1);
    m.news(1, { n: 4, k: 'down' });
    expect(m.copies(1)).toHaveLength(0);
  });

  it("the AA sentry comes down on the caller's mark, and the Frame's pod on the caller's spot facing the caller's way", () => {
    const m = mirror();
    m.begin(1, call('sentry', 1, [10, 0, -20]));
    m.begin(2, { ...call('frame', 2, [-12, 0, -18]), yaw: 1.1 });
    run(m, Math.max(FRAME_DROP.warn + FRAME_DROP.height / FRAME_DROP.speed, 4) + 0.5);
    expect(m.copies(1)[0]!.strike.where.distanceTo(new THREE.Vector3(10, 0, -20))).toBeLessThan(0.2);
    expect(m.copies(2)[0]!.strike.where.distanceTo(new THREE.Vector3(-12, 0, -18))).toBeLessThan(0.2);
    // It waits for its own pilot: nobody here is offered the seat, and it is not taken back on this screen's clock.
    run(m, FRAME_DROP.wait + 2);
    expect(m.copies(2)).toHaveLength(1);
    // The pilot climbs in: the puppet is the Frame.
    const pose = [-12, 0, -18, 1.1, 1.1, 0, 0, 0, 0, -12, 2, -60, 0];
    m.mech(2, pose);
    expect(m.inFrame(2)).toBe(true);
    m.mech(2, [-8, 0, -18, 1.1, 1.1, 2, 1, 0, 0, -12, 2, -60, 0]);
    run(m, 1);
    expect(m.frameOf(2)!.position.x).toBeGreaterThan(-9);
    expect(m.copies(2)[0]!.strike.where.x).toBeGreaterThan(-9);
    // They leave it: the drop is over, here too.
    m.mech(2, null);
    expect(m.inFrame(2)).toBe(false);
    run(m, 0.2);
    expect(m.copies(2)).toHaveLength(0);
    expect(CALLINS.frame.name.length).toBeGreaterThan(0);
  });
});

describe("another player's Frame", () => {
  it('stands where its pilot says, fires where they fire, and empties when they leave or go quiet', () => {
    const counted = stats();
    const puppet = new FramePuppet(ghostCtx(r.ctx, counted), materials);
    expect(puppet.occupied).toBe(false);
    const pose = (x: number, flags = 0) => [x, 0, -10, 0, 0, 0, 0, 0, 0, x, 2, -60, flags];
    expect(pose(0)).toHaveLength(MECH_POSE);
    puppet.pose(pose(5));
    expect(puppet.occupied).toBe(true);
    expect(puppet.position.x).toBe(5);
    // A short pose is no pose: it leaves the player out of it rather than half in.
    puppet.pose([1, 2, 3]);
    expect(puppet.occupied).toBe(false);
    puppet.pose(pose(5, MECH_FIRING));
    for (let i = 0; i < 60; i++) { puppet.update(1 / 60); r.run(1 / 60); }
    expect(counted.rays).toBeGreaterThan(10);
    // A 40 mm from the arm flies and bursts for the look, and a man beside the burst is unhurt.
    const target = r.enemies.add(5, -40, 100);
    puppet.news('shell', [1, 5, 3, -12, 5, 0.3, -40, 0.2]);
    for (let i = 0; i < 30; i++) { puppet.pose(pose(5)); puppet.update(1 / 60); r.run(1 / 60); }
    expect(r.record.explosions).toBeGreaterThan(0);
    expect(target.hits).toHaveLength(0);
    puppet.news('missile', [5, 5, -11, 0, 0, -40]);
    expect(counted.projectiles).toBe(1);
    // Nothing more is said: it is taken for empty.
    for (let i = 0; i < 60 * 5; i++) puppet.update(1 / 60);
    expect(puppet.occupied).toBe(false);
  });
});

describe('the skyhook on a guest', () => {
  it("flies the drone in on the host's pass, lifts the copy of the man as the hook reaches him, and lets go of him if the pass is called off", () => {
    const man = r.enemies.add(4, -20, 100) as ReturnType<typeof r.enemies.add> & { carried?: boolean };
    const copy = new AirliftCopy(r.ctx);
    const at = new THREE.Vector3(4, 0.9, -20);
    copy.begin(man.uid, at, new THREE.Vector3(1, 0, 0), 1.5);
    expect(copy.flying).toBe(1);
    // On the way in: the drone is behind the man along the pass and high, and he has not moved.
    for (let i = 0; i < 30; i++) copy.update(1 / 60);
    const drone = copy.positions[0]!;
    expect(drone.x).toBeLessThan(4);
    expect(drone.y).toBeGreaterThan(8);
    expect(man.carried).toBeFalsy();
    expect(man.position.y).toBe(0);
    // The hook reaches him and he goes up with it.
    for (let i = 0; i < 90; i++) copy.update(1 / 60);
    expect(man.carried).toBe(true);
    expect(man.position.y).toBeGreaterThan(2);
    expect(man.position.x).toBeGreaterThan(4);
    const height = man.position.y;
    for (let i = 0; i < 30; i++) copy.update(1 / 60);
    expect(man.position.y).toBeGreaterThan(height);
    // He came off the line on the host: the copy is the host's to place again.
    copy.cancel(man.uid);
    expect(man.carried).toBe(false);
    expect(copy.flying).toBe(0);
    // A pass flown to its end parks the drone by itself.
    copy.begin(man.uid, at, new THREE.Vector3(0, 0, 1), 0.2);
    for (let i = 0; i < 60 * 8; i++) copy.update(1 / 60);
    expect(copy.flying).toBe(0);
    expect(man.carried).toBe(false);
  });
});
