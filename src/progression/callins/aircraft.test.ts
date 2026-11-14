/**
 * The air support update, part 1: tap or hold, the crew taking over and no way back in, the gunship's circle staying
 * put, its magazines, flight times, AP through roofs, the flak cone, white phosphorus, and the glide bomb's steering.
 */
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CG, type Ctx, type RayHit } from '../../core/contracts';
import type { EnemyId, EnemyInstance, ExplosionSpec } from '../../core/gameplay';
import { CALLIN_HOLD } from '../../input/bindings';
import { makeBudget, loadBudget, type Raycaster } from '../../weapons/penetration';
import { CALLINS } from '../data';
import { Ac130, Phosphorus, type Ac130Rig } from './ac130';
import { AC130 } from './ac130Data';
import { Battery, flightSeconds, GUN_ORDER, Magazine } from './ac130Guns';
import { flakCone, fuze, pierce, steerBomb } from './ac130Rounds';
import { AntiAir, ANTI_AIR, type Sky } from './antiAir';
import { AttackChopper } from './attackChopper';
import { DoorGunner } from './doorGunner';
import { ATTACK, DOOR } from './heliData';
import { FLARE_LOCKOUT, TapOrHold, type Aircraft, type StrikeKit } from './shared';

const DT = 1 / 30;

// --- A world that answers what these strikes ask of it -----------------------------------------------------------------

/** Anything not given is a function that returns itself, so a strike can call into any system it likes. */
const sink: unknown = new Proxy(function () {}, { get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : sink), apply: () => sink });

function stub<T>(o: Record<string, unknown>): T {
  return new Proxy(o, {
    get(t, k) {
      if (!(k in t)) return sink;
      const v = t[k as string];
      return v && typeof v === 'object' && v.constructor === Object ? stub(v as Record<string, unknown>) : v;
    },
  }) as T;
}

function enemy(x: number, z: number, uid = 1): EnemyInstance {
  const position = new THREE.Vector3(x, 0, z);
  return { uid, alive: true, isBoss: false, id: 'grunt', position, center: position.clone().setY(1.2), velocity: new THREE.Vector3(), burning: 0, char: { mesh: new THREE.Object3D() } } as unknown as EnemyInstance;
}

interface World {
  ctx: Ctx;
  keys: { pressed: Set<string>; down: Set<string> };
  log: { parks: number; unparks: number; projectiles: number; hurt: number; blasts: ExplosionSpec[]; sounds: string[] };
  enemies: EnemyInstance[];
}

function world(): World {
  const keys = { pressed: new Set<string>(), down: new Set<string>() };
  const log = { parks: 0, unparks: 0, projectiles: 0, hurt: 0, blasts: [] as ExplosionSpec[], sounds: [] as string[] };
  const enemies = [enemy(0, 30)];
  const ctx = stub<Ctx>({
    input: { pressed: (a: string) => keys.pressed.has(a), isDown: (a: string) => keys.down.has(a), frameLook: { x: 0, y: 0 } },
    player: {
      position: new THREE.Vector3(), eye: new THREE.Vector3(0, 1.6, 0), forward: new THREE.Vector3(0, 0, -1), grounded: true, alive: true,
      sensitivity: 0.002, lookScale: 1, invertY: false,
      park: () => log.parks++, unpark: () => log.unparks++, takeDamage: () => log.hurt++,
    },
    enemies: {
      alive: enemies, vehicles: undefined,
      query: (c: THREE.Vector3, r: number, out: EnemyInstance[]) => {
        let n = 0;
        for (const e of enemies) if (e.alive && e.position.distanceTo(c) <= r) out[n++] = e;
        return n;
      },
    },
    world: {
      bounds: new THREE.Box3(new THREE.Vector3(-100, -10, -100), new THREE.Vector3(100, 60, 100)),
      nav: { nearest: () => false }, objects: { hazardAt: () => null }, playerSpawns: [],
    },
    physics: { raycastInto: () => false, raycast: () => null },
    combat: { spawnProjectile: () => log.projectiles++, explode: (_p: THREE.Vector3, spec: ExplosionSpec) => log.blasts.push(spec) },
    audio: { play: (id: string) => log.sounds.push(id) },
    events: { on: () => () => undefined },
    time: { dt: DT },
    render: { camera: { position: new THREE.Vector3(), fov: 60 }, renderer: { domElement: { clientHeight: 900, style: {} } } },
  });
  return { ctx, keys, log, enemies };
}

function seatRig(): Record<string, unknown> {
  return {
    seat: null, prisoners: new Set<number>(),
    shell: { show() {}, hide() {}, update() {} }, hud: { open() {} }, holdGrade() {},
    skyline: { at: () => 0, along: () => 0, ground: () => 0 },
  };
}

function frame(): Record<string, unknown> {
  const root = new THREE.Group();
  return {
    root,
    fly(p: THREE.Vector3, f: THREE.Vector3) {
      root.position.copy(p);
      root.lookAt(p.clone().add(f));
    },
    update() {},
    hide() {},
    mount: (_name: string, out: THREE.Vector3) => out.copy(root.position).setY(root.position.y - 1),
  };
}

function chopper(w: World, ai: boolean): { strike: AttackChopper; rig: Record<string, unknown> } {
  const rig = seatRig();
  const gun = { point() {}, snap() {}, recoil() {}, hide() {}, muzzle: (out: THREE.Vector3) => out.set(0, 40, 0) };
  const kit = { ctx: w.ctx } as StrikeKit;
  const strike = new AttackChopper(kit, rig as never, { frame: frame(), gun } as never, ai);
  return { strike, rig };
}

function run(strike: { update(dt: number): boolean }, seconds: number, each?: (t: number) => void): boolean {
  for (let t = 0; t < seconds; t += DT) {
    each?.(t);
    if (strike.update(DT)) return true;
  }
  return false;
}

// --- Tap or hold -------------------------------------------------------------------------------------------------------

describe('a call-in key', () => {
  it('is a tap when let go inside the hold time', () => {
    const k = new TapOrHold(CALLIN_HOLD);
    k.press();
    expect(k.update(0.1, true)).toBeNull();
    expect(k.update(0.1, false)).toBe('tap');
    expect(k.waiting).toBe(false);
    expect(k.update(0.1, false)).toBeNull();
  });

  it('is a hold once kept down that long, and only once', () => {
    const k = new TapOrHold(CALLIN_HOLD);
    k.press();
    let answer: string | null = null;
    for (let t = 0; t < CALLIN_HOLD + 0.2 && !answer; t += 0.05) answer = k.update(0.05, true);
    expect(answer).toBe('hold');
    expect(k.update(0.05, false)).toBeNull();
  });
});

// --- The helicopters' crews --------------------------------------------------------------------------------------------

describe('a helicopter handed to its crew', () => {
  it('keeps fighting after E, with the player back in the body and no way back into the seat', () => {
    const w = world();
    const { strike, rig } = chopper(w, false);
    expect(rig['seat']).not.toBeNull();
    run(strike, ATTACK.boardSeconds + 1);
    w.keys.pressed.add('interact');
    strike.update(DT);
    w.keys.pressed.clear();
    expect(rig['seat']).toBeNull();
    expect(w.log.unparks).toBe(1);
    const before = w.log.projectiles;
    run(strike, 6);
    expect(w.log.projectiles).toBeGreaterThan(before);
    // Fighting on, with the seat still empty, and nothing that boards it again.
    expect(rig['seat']).toBeNull();
    expect(w.log.parks).toBe(1);
  });

  it('sent in with a hold, never takes the player, and goes home when its time is up', () => {
    const w = world();
    const { strike, rig } = chopper(w, true);
    expect(rig['seat']).toBeNull();
    expect(w.log.parks).toBe(0);
    const done = run(strike, ATTACK.boardSeconds + ATTACK.aiSeconds + ATTACK.departSeconds + 1);
    expect(done).toBe(true);
    expect(w.log.projectiles).toBeGreaterThan(20);
    expect(w.log.parks).toBe(0);
  });

  it('is home before the call-in can come round again', () => {
    expect(CALLINS.attackChopper.cooldown).toBeGreaterThan(ATTACK.boardSeconds + ATTACK.aiSeconds + ATTACK.departSeconds);
    expect(CALLINS.doorGunner.cooldown).toBeGreaterThan(DOOR.boardSeconds + DOOR.aiSeconds + DOOR.departSeconds);
  });

  it('goes down to missiles: two hits for the chopper, the seat is emptied, and it crashes before it is gone', () => {
    const w = world();
    const { strike, rig } = chopper(w, false);
    expect(strike.hit()).toBe(false);
    expect(strike.hit()).toBe(true);
    expect(rig['seat']).toBeNull();
    expect(strike.update(DT)).toBe(false);
    expect(run(strike, 40)).toBe(true);
  });
});

// --- The gunship -------------------------------------------------------------------------------------------------------

interface Gunship {
  strike: Ac130;
  rig: Record<string, unknown>;
  fired: string[];
  positions: THREE.Vector3[];
}

function gunship(w: World, ai: boolean): Gunship {
  const fired: string[] = [];
  const positions: THREE.Vector3[] = [];
  const airframe = frame();
  const fly = airframe['fly'] as (p: THREE.Vector3, f: THREE.Vector3) => void;
  airframe['fly'] = (p: THREE.Vector3, f: THREE.Vector3) => {
    positions.push(p.clone());
    fly(p, f);
  };
  const rounds = {
    laser: new THREE.Vector3(), laserFrom: new THREE.Vector3(), laserOn: false, idle: true, bombLive: false,
    fire: (kind: string) => fired.push(kind), drop: () => fired.push('bomb'), update() {}, flare() {}, flash() {}, clear() {}, onImpact: null,
  };
  const rig = seatRig();
  const kit = { ctx: w.ctx, probe: { heightAt: () => 0, clearance: (..._a: number[]) => _a[6]! } } as unknown as StrikeKit;
  const order = { point: new THREE.Vector3(), heading: new THREE.Vector3(1, 0, 0) };
  const strike = new Ac130(kit, order, { airframe, rounds, prisoners: new Set(), probe: kit.probe } as unknown as Ac130Rig, rig as never, ai);
  return { strike, rig, fired, positions };
}

describe('the AC-130', () => {
  it('holds its circle over the spot it was called to for the whole sortie', () => {
    const w = world();
    const g = gunship(w, true);
    const { entrySeconds, holdSeconds, radius } = AC130.orbit;
    run(g.strike, entrySeconds + holdSeconds);
    const held = g.positions.slice(Math.ceil(entrySeconds / DT) + 1);
    expect(held.length).toBeGreaterThan(100);
    for (const p of held) expect(Math.hypot(p.x, p.z)).toBeCloseTo(radius, 0);
  });

  it('under its crew fires every gun, switching rounds, and drops the bomb once', () => {
    const w = world();
    // A knot under no roof: flak and HE; a boss for the bomb; far enough from the player for the 105.
    w.enemies.length = 0;
    for (let i = 0; i < 4; i++) w.enemies.push(enemy(20 + i, 15, i + 1));
    (w.enemies[0] as { isBoss: boolean }).isBoss = true;
    const g = gunship(w, true);
    run(g.strike, AC130.orbit.entrySeconds + 60);
    const kinds = new Set(g.fired);
    for (const k of ['g25', 'flak', 'g105', 'wp', 'bomb']) expect(kinds.has(k), k).toBe(true);
    expect(g.fired.filter(k => k === 'bomb').length).toBe(1);
  });

  it('tapped, puts the player in the seat, and E hands it to the crew for good', () => {
    const w = world();
    const g = gunship(w, false);
    run(g.strike, AC130.orbit.entrySeconds + 1);
    expect(g.rig['seat']).not.toBeNull();
    expect(g.fired.length).toBe(0);
    w.keys.pressed.add('interact');
    g.strike.update(DT);
    w.keys.pressed.clear();
    expect(g.rig['seat']).toBeNull();
    run(g.strike, 20);
    expect(g.fired.length).toBeGreaterThan(0);
    expect(g.rig['seat']).toBeNull();
    expect(w.log.parks).toBe(1);
  });

  it('fires the seat\'s selected gun, and a second press of 2 changes the round', () => {
    const w = world();
    const g = gunship(w, false);
    run(g.strike, AC130.orbit.entrySeconds + 1);
    const tap = (key: string) => {
      w.keys.pressed.add(key);
      g.strike.update(DT);
      w.keys.pressed.clear();
    };
    tap('weapon2');
    tap('weapon2');
    w.keys.down.add('fire');
    run(g.strike, 0.5);
    w.keys.down.clear();
    expect(g.fired).toContain('ap');
    expect(g.fired).not.toContain('g25');
  });
});

describe('the gunship\'s magazines', () => {
  it('reload each on their own clock, at the same time', () => {
    const g105 = new Magazine(AC130.howitzer.magazine, AC130.howitzer.reload, AC130.howitzer.interval);
    const g25 = new Magazine(AC130.gatling.magazine, AC130.gatling.reload, AC130.gatling.interval);
    while (g105.ammo > 0) {
      g105.take();
      g105.update(AC130.howitzer.interval);
    }
    let t = 0;
    while (g25.ammo > 0) {
      if (g25.take()) t += AC130.gatling.interval;
      g25.update(AC130.gatling.interval);
      g105.update(AC130.gatling.interval);
    }
    // The 105's crew was loading the whole time the Gatling was being emptied.
    expect(g105.reloading).toBeLessThan(AC130.howitzer.reload - t + 0.2);
    expect(g25.reloading).toBeGreaterThan(AC130.gatling.reload - 0.1);
    for (let i = 0; i < 400; i++) {
      g25.update(0.05);
      g105.update(0.05);
    }
    expect(g25.ammo).toBe(AC130.gatling.magazine);
    expect(g105.ammo).toBe(AC130.howitzer.magazine);
  });

  it('hold one glide bomb a sortie, never reloaded', () => {
    const bomb = new Magazine(1, 0, 0);
    expect(bomb.take()).toBe(true);
    for (let i = 0; i < 100; i++) bomb.update(1);
    expect(bomb.ammo).toBe(0);
    expect(bomb.take()).toBe(false);
  });

  it('show one row a gun on the panel', () => {
    expect(GUN_ORDER).toEqual(['g25', 'g40', 'g105', 'bomb']);
    expect(Battery.prototype.cycle).toBeTypeOf('function');
  });
});

describe('the gunship\'s rounds', () => {
  const slant = Math.hypot(AC130.orbit.radius, AC130.orbit.altitude);

  it('all take real time to come down', () => {
    for (const k of ['g25', 'g40', 'ap', 'flak', 'g105', 'wp'] as const) expect(flightSeconds(k, slant), k).toBeGreaterThan(1);
    expect(flightSeconds('g25', slant)).toBeLessThan(flightSeconds('g40', slant));
    expect(flightSeconds('g105', slant)).toBe(AC130.howitzer.flight);
  });

  /** Two roofs over a floor slab, with nothing under the slab. */
  const slabs: [number, number][] = [[10, 10.3], [5, 5.25], [-0.5, 0]];
  const physics: Raycaster = {
    raycast(origin, dir, max, mask) {
      expect(mask).toBe(CG.World);
      let best: RayHit | null = null;
      for (const [lo, hi] of slabs) {
        if (origin.y > lo && origin.y < hi) return { point: origin.clone(), normal: new THREE.Vector3(0, 1, 0), distance: 0, surface: 'concrete', collider: null };
        const face = dir.y < 0 ? hi : lo;
        const t = (face - origin.y) / dir.y;
        if (dir.y === 0 || t < 0 || t > max || (best && best.distance <= t)) continue;
        best = { point: origin.clone().addScaledVector(dir, t), normal: new THREE.Vector3(0, dir.y < 0 ? 1 : -1, 0), distance: t, surface: 'concrete', collider: null };
      }
      return best;
    },
  };

  it('AP goes through roofs and stops on the ground', () => {
    const down = new THREE.Vector3(0, -1, 0);
    const budget = loadBudget(makeBudget(), AC130.bofors.ap.wall, 0, 1, AC130.bofors.ap.walls);
    const exit = new THREE.Vector3();
    let from = new THREE.Vector3(0, 30, 0);
    const passed: number[] = [];
    for (;;) {
      const hit = physics.raycast(from, down, 100, CG.World)!;
      if (!pierce(physics, budget, hit, down, exit)) {
        expect(hit.point.y).toBeCloseTo(0, 3);
        break;
      }
      passed.push(hit.point.y);
      from = exit.clone().addScaledVector(down, 0.05);
    }
    expect(passed.map(y => Math.round(y * 10) / 10)).toEqual([10.3, 5.3]);
  });

  it('flak goes off short of the first thing on its line, and not before', () => {
    const f = AC130.bofors.flak.fuze;
    expect(fuze(Infinity, Infinity, 2, f)).toBe(-1);
    expect(fuze(10, Infinity, 2, f)).toBe(-1);
    expect(fuze(4, Infinity, 2, f)).toBeCloseTo(4 - f);
    expect(fuze(Infinity, 3, 2, f)).toBeCloseTo(3 - f);
    expect(fuze(6, 3.5, 2, f)).toBeCloseTo(3.5 - f);
    expect(fuze(1, Infinity, 2, f)).toBe(0);
  });

  it('flak throws its pellets forward in a cone', () => {
    const dir = new THREE.Vector3(0.3, -1, 0.2).normalize();
    const pellets = flakCone(dir, AC130.bofors.flak.cone, Array.from({ length: 200 }, () => new THREE.Vector3()));
    const widest = Math.asin(Math.tan(AC130.bofors.flak.cone)) + 1e-6;
    let spread = 0;
    for (const p of pellets) {
      const angle = p.angleTo(dir);
      expect(angle).toBeLessThanOrEqual(widest);
      spread = Math.max(spread, angle);
    }
    expect(spread).toBeGreaterThan(AC130.bofors.flak.cone * 0.6);
  });

  it('the glide bomb steers onto a laser dragged across the ground, all the way down', () => {
    const p = new THREE.Vector3(AC130.orbit.radius, AC130.orbit.altitude, 0);
    const v = new THREE.Vector3(0, -3, 30);
    const laser = new THREE.Vector3(10, 0, 0);
    let t = 0;
    for (; p.y > 0 && t < AC130.bomb.life; t += DT) {
      // A man running at 6 m/s, painted the whole way.
      laser.z += 6 * DT;
      steerBomb(p, v, laser, t, DT, AC130.bomb);
    }
    expect(t).toBeGreaterThan(3);
    expect(Math.hypot(p.x - laser.x, p.z - laser.z)).toBeLessThan(3);
  });
});

describe('white phosphorus', () => {
  it('sets men in the cloud alight, leaves men outside it, and never touches the player', () => {
    const w = world();
    const inside = enemy(2, 1, 1);
    const outside = enemy(40, 0, 2);
    w.enemies.length = 0;
    w.enemies.push(inside, outside);
    w.ctx.player.position.set(0, 0, 0);
    const wp = new Phosphorus(w.ctx);
    wp.add(new THREE.Vector3(0, 0, 0));
    for (let t = 0; t < 2; t += DT) wp.update(DT);
    expect(inside.burning).toBeGreaterThan(0);
    expect(outside.burning).toBe(0);
    expect(w.log.hurt).toBe(0);
    for (let t = 0; t < AC130.howitzer.wp.seconds; t += DT) wp.update(DT);
    expect(wp.count).toBe(0);
  });
});

// --- Part 2: the enemy fights the aircraft -------------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
});

function door(w: World, ai: boolean): { strike: DoorGunner; rig: Record<string, unknown> } {
  const rig = seatRig();
  const gun = {
    point() {}, snap() {}, turn() {}, recoil() {}, hide() {},
    muzzle: (out: THREE.Vector3) => out.set(0, 30, 0), bore: (out: THREE.Vector3) => out.set(0, -1, 0),
  };
  const strike = new DoorGunner({ ctx: w.ctx } as StrikeKit, rig as never, { frame: frame(), gun } as never, null, ai);
  return { strike, rig };
}

/** An aircraft that only counts what is done to it, standing where it is put. */
interface Dummy extends Aircraft {
  struckBy: number;
  popped: number;
}

function dummy(at: THREE.Vector3, o: Partial<Aircraft> = {}): Dummy {
  const d: Dummy = {
    position: at, sources: 'chopper', hits: 2, flares: 3, rounds: 0, flown: true, autoFlares: false, huntable: true,
    struckBy: 0, popped: 0,
    hit() { d.struckBy++; return --d.hits <= 0; },
    shot: () => false,
    popFlares() { if (d.flares <= 0) return false; d.flares--; d.popped++; return true; },
    down() {}, update: () => false, dispose() {},
    ...o,
  };
  return d;
}

const sky = (): Sky => ({ flash() {}, flare() {}, update() {}, clear() {} }) as unknown as Sky;

function hunter(id: EnemyId, x: number, z: number, uid: number): EnemyInstance {
  const e = enemy(x, z, uid) as { id: EnemyId };
  e.id = id;
  return e as unknown as EnemyInstance;
}

function antiAir(w: World): AntiAir {
  return new AntiAir(w.ctx, sky(), new Set());
}

/** Steps anti-air with these aircraft up, until `until` says so or the time runs out. Returns the seconds it took. */
function step(aa: AntiAir, aircraft: Aircraft[], seconds: number, until?: () => boolean): number {
  for (let t = 0; t < seconds; t += DT) {
    aa.update(DT, aircraft);
    if (until?.()) return t;
  }
  return seconds;
}

describe('anti-air hunters', () => {
  it('picks one at a time across the map, and the next only after a rest', () => {
    const w = world();
    w.enemies.length = 0;
    for (let i = 0; i < 6; i++) w.enemies.push(hunter('rocketeer', i * 3, 0, i + 1));
    const a = dummy(new THREE.Vector3(0, 40, 60), { hits: 99 });
    const aa = antiAir(w);
    // Nobody looks at it until it has been up a while.
    expect(step(aa, [a], ANTI_AIR.firstRest - 0.5, () => aa.hunts.length > 0)).toBe(ANTI_AIR.firstRest - 0.5);
    let most = 0;
    let started = 0;
    let lastEnd = -1;
    let shortestRest = Infinity;
    let was = 0;
    for (let t = 0; t < 120; t += DT) {
      aa.update(DT, [a]);
      most = Math.max(most, aa.hunts.length);
      if (aa.hunts.length > was) {
        started++;
        if (lastEnd >= 0) shortestRest = Math.min(shortestRest, t - lastEnd);
      }
      if (aa.hunts.length < was) lastEnd = t;
      was = aa.hunts.length;
    }
    expect(most).toBe(1);
    expect(started).toBeGreaterThan(2);
    expect(shortestRest).toBeGreaterThanOrEqual(ANTI_AIR.rest[0] - DT);
  });

  it('only takes men who fire explosives, and never a prisoner', () => {
    const w = world();
    w.enemies.length = 0;
    w.enemies.push(hunter('trooper', 0, 0, 1), hunter('sniper', 2, 0, 2), hunter('rocketeer', 4, 0, 3));
    const aa = new AntiAir(w.ctx, sky(), new Set([3]));
    const a = dummy(new THREE.Vector3(0, 40, 60));
    step(aa, [a], 40);
    expect(aa.hunts.length).toBe(0);
  });

  it('turns a boss pounded from the air on that aircraft at once, as a second hunter', () => {
    const w = world();
    let onHit: ((e: { enemy: EnemyInstance; damage: { source: string } }) => void) | null = null;
    (w.ctx as unknown as { events: unknown }).events = { on: (_k: string, f: typeof onHit) => { onHit = f; return () => undefined; } };
    w.enemies.length = 0;
    const boss = hunter('juggernaut', 0, 0, 7);
    (boss as { isBoss: boolean }).isBoss = true;
    w.enemies.push(hunter('rocketeer', 5, 0, 1), boss);
    const chopper = dummy(new THREE.Vector3(0, 40, 60), { sources: 'chopper', hits: 99 });
    const gunship = dummy(new THREE.Vector3(200, 185, 0), { sources: 'ac130', hits: 99, flown: false });
    const aa = new AntiAir(w.ctx, sky(), new Set());
    // The pick takes the first man in the list: the Rocketeer, so the boss is free.
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    step(aa, [chopper, gunship], ANTI_AIR.firstRest + 0.2);
    expect(aa.hunts.map(h => h.enemy.id)).toEqual(['rocketeer']);
    onHit!({ enemy: boss, damage: { source: 'ac130_105mm' } });
    expect(aa.hunts.length).toBe(2);
    expect(aa.hunts.find(h => h.enemy === boss)?.target).toBe(gunship);
    // Never a third.
    onHit!({ enemy: boss, damage: { source: 'chopper_rocket' } });
    expect(aa.hunts.length).toBe(2);
  });
});

describe('the lock and the missile', () => {
  it('beeps a lock tone for the lock, warns at launch, and climbs to the gunship in a few seconds', () => {
    const w = world();
    w.enemies.length = 0;
    w.enemies.push(hunter('rocketeer', 0, 0, 1));
    const ship = dummy(new THREE.Vector3(160, 185, 0), { hits: 3 });
    const aa = antiAir(w);
    step(aa, [ship], ANTI_AIR.firstRest + 1, () => aa.hunts.length > 0);
    const locked = step(aa, [ship], 10, () => aa.missiles.length > 0);
    expect(locked).toBeGreaterThan(ANTI_AIR.lock - 0.2);
    expect(locked).toBeLessThan(ANTI_AIR.lock + 0.1);
    expect(w.log.sounds.filter(id => id === 'aa_lock').length).toBeGreaterThan(8);
    expect(w.log.sounds).toContain('aa_launch');
    const m = aa.missiles[0]!;
    const start = m.body.position.y;
    step(aa, [ship], 1);
    expect(m.body.position.y).toBeGreaterThan(start + 15);
    const flight = 1 + step(aa, [ship], 10, () => ship.struckBy > 0);
    expect(ship.struckBy).toBe(1);
    expect(flight).toBeGreaterThan(3);
    expect(flight).toBeLessThan(7);
  });

  it('is never heard from the ground: no tone when the player is not in that aircraft', () => {
    const w = world();
    w.enemies.length = 0;
    w.enemies.push(hunter('rocketeer', 0, 0, 1));
    const a = dummy(new THREE.Vector3(0, 40, 60), { flown: false });
    const aa = antiAir(w);
    step(aa, [a], ANTI_AIR.firstRest + ANTI_AIR.lock + 1);
    expect(aa.missiles.length).toBe(1);
    expect(w.log.sounds).not.toContain('aa_lock');
    expect(w.log.sounds).not.toContain('aa_launch');
  });
});

describe('flares', () => {
  function inFlight(w: World, a: Dummy): AntiAir {
    w.enemies.length = 0;
    w.enemies.push(hunter('rocketeer', 0, 0, 1));
    const aa = antiAir(w);
    step(aa, [a], 30, () => aa.missiles.length > 0);
    return aa;
  }

  it('pull a missile still far enough out onto a decoy, where it bursts in mid-air', () => {
    const w = world();
    const ship = dummy(new THREE.Vector3(160, 185, 0), { hits: 3 });
    const aa = inFlight(w, ship);
    step(aa, [ship], 1.5);
    expect(ship.popFlares()).toBe(true);
    aa.update(DT, [ship]);
    const m = aa.missiles[0]!;
    expect(m.target).toBeNull();
    expect(m.decoy).not.toBeNull();
    step(aa, [ship], 10, () => aa.missiles.length === 0);
    expect(aa.missiles.length).toBe(0);
    expect(ship.struckBy).toBe(0);
  });

  it('are too late for a missile already on the aircraft', () => {
    const w = world();
    const ship = dummy(new THREE.Vector3(160, 185, 0), { hits: 3 });
    const aa = inFlight(w, ship);
    step(aa, [ship], 10, () => aa.missiles[0]!.body.position.distanceTo(ship.position) < ANTI_AIR.decoy.least - 2);
    ship.popFlares();
    step(aa, [ship], 3, () => ship.struckBy > 0);
    expect(ship.struckBy).toBe(1);
  });

  it('are thrown by the pilot or the crew on their own when it is theirs to do', () => {
    const w = world();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const crewed = dummy(new THREE.Vector3(0, 40, 80), { autoFlares: true });
    const aa = inFlight(w, crewed);
    step(aa, [crewed], 10, () => aa.missiles.length === 0);
    expect(crewed.popped).toBe(1);
    expect(crewed.struckBy).toBe(0);
  });

  it('three in the chopper and the gunship seats, on the jump key, with a lockout after each', () => {
    const w = world();
    const { strike } = chopper(w, false);
    run(strike, ATTACK.boardSeconds + 0.5);
    w.keys.pressed.add('jump');
    strike.update(DT);
    strike.update(DT);
    w.keys.pressed.clear();
    expect(strike.flares).toBe(ATTACK.armour.flares - 1);
    expect(strike.popFlares()).toBe(false);
    run(strike, FLARE_LOCKOUT + 0.1);
    expect(strike.popFlares()).toBe(true);
    run(strike, FLARE_LOCKOUT + 0.1);
    expect(strike.popFlares()).toBe(true);
    run(strike, FLARE_LOCKOUT + 0.1);
    expect(strike.flares).toBe(0);
    expect(strike.popFlares()).toBe(false);

    const g = gunship(w, false);
    run(g.strike, AC130.orbit.entrySeconds + 1);
    let thrown = 0;
    for (let i = 0; i < 6; i++) {
      w.keys.pressed.add('jump');
      g.strike.update(DT);
      w.keys.pressed.clear();
      if (g.strike.flares === AC130.armour.flares - thrown - 1) thrown++;
      run(g.strike, i % 2 ? FLARE_LOCKOUT + 0.1 : 0.5);
    }
    expect(AC130.armour.flares).toBe(3);
    expect(thrown).toBe(3);
    expect(g.strike.flares).toBe(0);
  });

  it('in the door gunner are the pilot\'s: two, the key does nothing, and sometimes they are late', () => {
    const w = world();
    const { strike } = door(w, false);
    run(strike, DOOR.boardSeconds + 0.5);
    expect(strike.flares).toBe(2);
    w.keys.pressed.add('jump');
    strike.update(DT);
    w.keys.pressed.clear();
    expect(strike.flares).toBe(2);
    expect(strike.flown).toBe(true);
    expect(strike.autoFlares).toBe(true);

    // On time: a missile on it is pulled off.
    w.enemies.length = 0;
    w.enemies.push(hunter('rocketeer', 0, 0, 1));
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const aa = antiAir(w);
    step(aa, [strike], 30, () => aa.missiles.length > 0);
    step(aa, [strike], 10, () => aa.missiles.length === 0);
    expect(strike.flares).toBe(1);
    expect(strike.hits).toBe(1);

    // Late: he throws them, but the missile is already there.
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    const late = door(world(), true).strike;
    const aa2 = antiAir(w);
    step(aa2, [late], 40, () => aa2.missiles.length > 0);
    step(aa2, [late], 10, () => aa2.missiles.length === 0);
    expect(late.flares).toBe(1);
    expect(late.hits).toBe(0);
  });
});

describe('hits, rounds and the crash', () => {
  it('missiles: one brings the door gunner down, two the chopper, three the gunship', () => {
    const w = world();
    const d = door(w, true).strike;
    expect(d.hit()).toBe(true);
    const c = chopper(w, true).strike;
    expect([c.hit(), c.hit()]).toEqual([false, true]);
    const g = gunship(w, true).strike;
    expect([g.hit(), g.hit(), g.hit()]).toEqual([false, false, true]);
    for (const a of [d, c, g]) {
      expect(a.huntable).toBe(false);
      expect(a.hit()).toBe(false);
    }
  });

  it('bullets hurt the door gunner and nothing else', () => {
    const w = world();
    const d = door(w, true).strike;
    const c = chopper(w, true).strike;
    const g = gunship(w, true).strike;
    for (let i = 0; i < 200; i++) {
      expect(c.shot()).toBe(false);
      expect(g.shot()).toBe(false);
    }
    expect(c.huntable && g.huntable).toBe(true);
    let downAt = 0;
    for (let i = 1; i <= 100 && !downAt; i++) if (d.shot()) downAt = i;
    expect(downAt).toBe(DOOR.armour.rounds);

    // And under fire, men close under it land rounds on it, and on nothing armoured.
    const w2 = world();
    w2.enemies.length = 0;
    for (let i = 0; i < 8; i++) w2.enemies.push(hunter('trooper', i * 2, 0, i + 1));
    const shots = { door: 0, other: 0 };
    const low = dummy(new THREE.Vector3(0, 30, 10), { rounds: 99, shot: () => (shots.door++, false), huntable: true });
    const armoured = dummy(new THREE.Vector3(0, 30, -10), { rounds: 0, shot: () => (shots.other++, false) });
    const aa = new AntiAir(w2.ctx, sky(), new Set());
    step(aa, [low, armoured], 60);
    expect(shots.door).toBeGreaterThan(2);
    expect(shots.other).toBe(0);
  });

  it('a crash falls, hits the ground with a blast that hurts enemies and never the player, then is gone', () => {
    for (const make of ['door', 'chopper', 'gunship'] as const) {
      const w = world();
      const strike = make === 'door' ? door(w, false).strike : make === 'chopper' ? chopper(w, false).strike : gunship(w, false).strike;
      run(strike, 12);
      const before = strike.position.y;
      strike.down();
      expect(strike.flown).toBe(false);
      expect(w.log.unparks).toBe(1);
      run(strike, 0.5);
      expect(strike.position.y).toBeLessThan(before);
      expect(run(strike, 60)).toBe(true);
      const crash = w.log.blasts.filter(b => b.source.endsWith('_crash'));
      expect(crash.length, make).toBe(1);
      for (const b of crash) {
        expect(b.team).toBe('player');
        expect(b.selfDamage).toBe(0);
        expect(b.playerPush).toBe(0);
        expect(b.worldObject).toBe(true);
        expect(b.damage).toBeGreaterThan(0);
      }
      expect(w.log.hurt).toBe(0);
    }
  });
});
