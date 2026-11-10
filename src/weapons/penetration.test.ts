/** Penetration: the budget, the wall probe, and both kinds of round going through walls and bodies. */
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ShotSpec } from '../core/gameplay';
import { rangeFalloff } from './Combat';
import { PENETRATION, TUNING, WEAPONS } from './data';
import { damageKept, loadBudget, makeBudget, passBody, passWall, perWall, wallExit } from './penetration';
import { makeRange, type Range } from './testkit';

const DOWN_RANGE = new THREE.Vector3(0, 0, -1);
const shot = (o: Partial<ShotSpec> = {}): ShotSpec => ({ damage: 100, source: 'test', team: 'player', tracer: 'bullet', ...o });

let r: Range;
beforeEach(async () => {
  r = await makeRange();
  r.reset();
});

describe('budget', () => {
  it('a round with none passes nothing and keeps all its damage', () => {
    const b = loadBudget(makeBudget(), 0, undefined);
    expect(passBody(b, false)).toBe(false);
    expect(damageKept(b)).toBe(1);
  });

  it('bodies are spent from it, and a blocked body costs more', () => {
    const b = loadBudget(makeBudget(), 1, undefined);
    expect(passBody(b, false)).toBe(true);
    expect(b.left).toBeCloseTo(1 - PENETRATION.body);
    expect(passBody(b, true)).toBe(false);
    expect(b.left).toBeCloseTo(1 - PENETRATION.body);
    expect(passBody(b, false)).toBe(true);
    expect(passBody(b, false)).toBe(false);
  });

  it('damage falls in a line to `keep` as the budget is spent', () => {
    const b = loadBudget(makeBudget(), 2, 1);
    expect(damageKept(b)).toBe(1);
    passBody(b, false);
    expect(damageKept(b)).toBeCloseTo((1 + PENETRATION.keep) / 2);
    passBody(b, false);
    expect(damageKept(b)).toBeCloseTo(PENETRATION.keep);
    expect(damageKept(loadBudget(makeBudget(), 2, 1, 1))).toBe(1);
  });

  it('the per-wall rule spends walls, not meters, and no surface costs it more', () => {
    r.wall(-10, 1.2, 'metal');
    r.wall(-20, 1.5);
    r.wall(-30, 0.3);
    const exit = new THREE.Vector3();
    const wall = (z: number, surface: 'metal' | 'concrete') => ({ point: new THREE.Vector3(0, 1, z), normal: new THREE.Vector3(0, 0, 1), distance: 0, surface, collider: null });
    const b = loadBudget(makeBudget(), 1.6, Infinity, 1, 2);
    expect(perWall(b)).toBe(true);
    expect(perWall(loadBudget(makeBudget(), 1.6, undefined))).toBe(false);
    // 1.2 m of steel would cost a metered round 1.8.
    expect(passWall(r.physics, b, wall(-10, 'metal'), DOWN_RANGE, exit)).toBe(true);
    expect(exit.z).toBeCloseTo(-11.2, 2);
    expect(passWall(r.physics, b, wall(-20, 'concrete'), DOWN_RANGE, exit)).toBe(true);
    expect(damageKept(b)).toBe(1);
    // Two walls is the count. The third is 0.3 m and still stops it, at no cost in rays.
    r.record.worldRays = 0;
    expect(passWall(r.physics, b, wall(-30, 'concrete'), DOWN_RANGE, exit)).toBe(false);
    expect(r.record.worldRays).toBe(0);
  });

  it('range falloff holds, slopes, then floors', () => {
    const f = { from: 20, to: 40, floor: 0.5 };
    expect(rangeFalloff(f, 5)).toBe(1);
    expect(rangeFalloff(f, 30)).toBeCloseTo(0.75);
    expect(rangeFalloff(f, 90)).toBe(0.5);
  });
});

describe('wall thickness by reverse rays', () => {
  const exit = new THREE.Vector3();
  const entry = (z: number) => new THREE.Vector3(0, 1, z);

  it.each([0.04, 0.3, 0.6, 1, 1.6, 2.5])('measures a %s m wall', thick => {
    r.wall(-10, thick);
    expect(wallExit(r.physics, entry(-10), DOWN_RANGE, 3, exit)).toBeCloseTo(thick, 2);
    expect(exit.z).toBeCloseTo(-10 - thick, 2);
  });

  it('stays buried in a wall thicker than it may look', () => {
    r.wall(-10, 1.6);
    expect(wallExit(r.physics, entry(-10), DOWN_RANGE, 1, exit)).toBe(-1);
    r.wall(-30, 5);
    expect(wallExit(r.physics, entry(-30), DOWN_RANGE, 10, exit)).toBe(-1);
  });

  it('finds the first wall\'s far face, not the next wall\'s', () => {
    r.wall(-10, 0.3);
    r.wall(-11.2, 0.3);
    expect(wallExit(r.physics, entry(-10), DOWN_RANGE, 3, exit)).toBeCloseTo(0.3, 2);
  });

  it('measures along a slanted line', () => {
    r.wall(-10, 0.5);
    const dir = new THREE.Vector3(1, 0, -1).normalize();
    expect(wallExit(r.physics, entry(-10), dir, 3, exit)).toBeCloseTo(0.5 * Math.SQRT2, 2);
  });

  it('reports the far face, not the line of the shot, so a mark lies flat on a wall left at a slant', () => {
    r.wall(-10, 0.5);
    const normal = new THREE.Vector3();
    wallExit(r.physics, entry(-10), new THREE.Vector3(1, 0, -1).normalize(), 3, exit, normal);
    expect(normal.x).toBeCloseTo(0, 3);
    expect(normal.z).toBeCloseTo(-1, 3);
  });
});

describe('hitscan', () => {
  const fire = (o: Partial<ShotSpec> = {}) => r.combat.fireRay(r.player.eye, DOWN_RANGE, shot(o));

  it('a round with no budget stops at the first body and costs one world ray', () => {
    const a = r.enemies.add(0, -10);
    const b = r.enemies.add(0, -14);
    r.wall(-20, 0.3);
    r.record.worldRays = 0;
    fire();
    expect(a.hits.length).toBe(1);
    expect(b.hits.length).toBe(0);
    expect(r.record.worldRays).toBe(1);
    a.alive = b.alive = false;
    r.record.worldRays = 0;
    fire();
    expect(r.record.worldRays).toBe(1);
    expect(r.record.impacts.length).toBe(1);
  });

  it('goes through as many bodies as the budget buys, losing damage on the way', () => {
    const line = [-10, -14, -18, -22].map(z => r.enemies.add(0, z));
    fire({ penetrate: PENETRATION.body * 2 + 0.05 });
    expect(line.map(d => d.hits.length)).toEqual([1, 1, 1, 0]);
    const dealt = line.slice(0, 3).map(d => d.hits[0]!.amount);
    expect(dealt[0]).toBe(100);
    expect(dealt[1]).toBeLessThan(dealt[0]!);
    expect(dealt[2]).toBeLessThan(dealt[1]!);
    expect(dealt[2]).toBeGreaterThan(100 * PENETRATION.keep);
  });

  it('a free body cost passes everyone in line', () => {
    const line = Array.from({ length: 12 }, (_, i) => r.enemies.add(0, -10 - i * 3));
    fire({ penetrate: 1, bodyCost: 0 });
    expect(line.every(d => d.hits.length === 1)).toBe(true);
  });

  it('goes through a wall it can afford and marks both faces', () => {
    r.wall(-10, 0.3);
    const behind = r.enemies.add(0, -14);
    const res = fire({ penetrate: 0.5 });
    expect(behind.hits.length).toBe(1);
    expect(res.hitEnemy).toBe(true);
    expect(behind.hits[0]!.amount).toBeCloseTo(100 * (PENETRATION.keep + (1 - PENETRATION.keep) * 0.4), 1);
    expect(r.record.impacts.map(m => +m.at.z.toFixed(2))).toEqual([-10, -10.3]);
    // The puff comes off the far face, and the tracer is redrawn from the hole.
    expect(r.record.puffs.length).toBe(1);
    expect(r.record.puffs[0]!.z).toBeLessThan(-10.3);
    expect(r.record.tracers.length).toBe(2);
    expect(r.record.tracers[1]!.from.z).toBeCloseTo(-10.3, 2);
  });

  it('leaves an exit crater flat on the far face, however the round crossed the wall', () => {
    r.wall(-10, 0.3);
    r.combat.fireRay(r.player.eye, new THREE.Vector3(0.6, 0, -1).normalize(), shot({ penetrate: 1 }));
    const craters = r.record.decals.filter(d => d.kind === 'exit');
    expect(craters.length).toBe(1);
    expect(craters[0]!.at.z).toBeCloseTo(-10.3, 2);
    expect(craters[0]!.normal.x).toBeCloseTo(0, 3);
    expect(craters[0]!.normal.z).toBeCloseTo(-1, 3);
    // And none for a round that stayed in the wall.
    r.record.decals.length = 0;
    fire();
    expect(r.record.decals.some(d => d.kind === 'exit')).toBe(false);
  });

  it('stops in a wall it cannot afford', () => {
    r.wall(-10, 0.6);
    const behind = r.enemies.add(0, -14);
    fire({ penetrate: 0.5 });
    expect(behind.hits.length).toBe(0);
    expect(r.record.impacts.length).toBe(1);
    expect(r.record.puffs.length).toBe(0);
  });

  it('steel costs more than concrete, glass nearly nothing, a shield everything', () => {
    r.wall(-10, 0.4, 'metal', 0, 2);
    r.wall(-10, 0.4, 'concrete', 10, 2);
    r.wall(-10, 0.4, 'glass', 20, 2);
    r.wall(-10, 0.02, 'energy', 30, 2);
    const hit = (x: number, penetrate: number) => {
      const d = r.enemies.add(x, -14);
      r.combat.fireRay(new THREE.Vector3(x, 1, 0), DOWN_RANGE, shot({ penetrate }));
      return d.hits.length;
    };
    expect(hit(0, 0.5)).toBe(0);
    expect(hit(10, 0.5)).toBe(1);
    expect(hit(20, 0.1)).toBe(1);
    expect(hit(30, 50)).toBe(0);
  });

  it('a body then a wall then a body all come out of one budget', () => {
    const a = r.enemies.add(0, -6);
    r.wall(-10, 0.3);
    const b = r.enemies.add(0, -14);
    const c = r.enemies.add(0, -18);
    fire({ penetrate: PENETRATION.body + 0.3 + PENETRATION.body - 0.05 });
    expect([a, b, c].map(d => d.hits.length)).toEqual([1, 1, 0]);
  });

  it('range is measured through the wall', () => {
    r.wall(-10, 0.5);
    const d = r.enemies.add(0, -20.5);
    fire({ penetrate: 4, maxDistance: 15 });
    expect(d.hits.length).toBe(0);
    fire({ penetrate: 4, maxDistance: 25 });
    expect(d.hits.length).toBe(1);
  });

  it('an armour-piercing round says so to armour, and no other round does', () => {
    const d = r.enemies.add(0, -10);
    d.armor = 50;
    fire();
    fire({ armorPiercing: true });
    expect(d.hits.map(h => h.pierces === true)).toEqual([false, true]);
  });

  it('an armour-piercing round says so to a bare body too, which is what a carried shield reads', () => {
    const d = r.enemies.add(0, -10);
    fire();
    fire({ armorPiercing: true });
    expect(d.hits.map(h => h.armorPiercing === true)).toEqual([false, true]);
    expect(d.hits.map(h => h.pierces === true)).toEqual([false, false]);
  });

  it('a bursting round goes off on every body it goes through, and where it stops', () => {
    const line = [-10, -20].map(z => r.enemies.add(0, z));
    r.wall(-40, 5);
    fire({ penetrate: 1, bodyCost: 0.1, blastRadius: 2 });
    expect(line.map(d => d.hits.filter(h => h.type === 'bullet').length)).toEqual([1, 1]);
    // One on each man, where the round went in, and one on the wall that stopped it.
    expect(r.record.blasts.length).toBe(3);
    [-9.45, -19.45, -40].forEach((z, i) => expect(r.record.blasts[i]!.z).toBeCloseTo(z, 1));
  });

  it('a bursting round with no budget bursts once, where it always did', () => {
    const line = [-10, -20].map(z => r.enemies.add(0, z));
    fire({ blastRadius: 2 });
    expect(r.record.blasts.length).toBe(1);
    expect(r.record.blasts[0]!.z).toBeCloseTo(-9.45, 1);
    expect(line[1]!.hits.length).toBe(0);
  });

  it('a free body, the Lance\'s kind, is passed without a burst, as before', () => {
    r.enemies.add(0, -10);
    r.wall(-40, 5);
    fire({ pierce: 4, blastRadius: 2 });
    expect(r.record.blasts.length).toBe(1);
    expect(r.record.blasts[0]!.z).toBeCloseTo(-40, 1);
  });
});

describe('the guns', () => {
  const pull = (seconds = 0.1) => {
    r.input.simulate('fire', true);
    r.run(seconds);
    r.input.simulate('fire', false);
    r.run(0.05);
  };
  const draw = (...keys: ('weapon1' | 'weapon4' | 'weapon6' | 'weapon7')[]) => {
    for (const key of keys) {
      r.tap(key);
      r.run(0.5);
    }
  };

  it('Harrow: one body and no more, a sheet of cover and no real wall', () => {
    draw('weapon1');
    expect(r.weapons.current).toBe('harrow');
    const line = [-8, -12, -16].map(z => r.enemies.add(0, z));
    pull(0.05);
    expect(line.map(d => d.hits.length)).toEqual([1, 1, 0]);
    expect(line[1]!.hits[0]!.amount).toBeLessThan(WEAPONS.harrow.damage);
    expect(line[0]!.hits[0]!.severMult).toBe(WEAPONS.harrow.severMult);

    r.reset();
    draw('weapon1');
    r.wall(-10, 0.25, 'metal');
    r.wall(-30, 0.6);
    const sheet = r.enemies.add(0, -14);
    const wall = r.enemies.add(0, -34);
    pull(0.05);
    expect(sheet.hits.length).toBe(1);
    sheet.alive = false;
    pull(0.05);
    expect(wall.hits.length).toBe(0);
  });

  it('SMG: unchanged, stops at the first thing', () => {
    const line = [-8, -12].map(z => r.enemies.add(0, z));
    pull(0.05);
    expect(line.map(d => d.hits.length)).toEqual([1, 0]);
    expect(line[0]!.hits[0]!.amount).toBe(WEAPONS.smg.damage);
    expect(line[0]!.hits[0]!.severMult).toBe(1);
    expect(WEAPONS.smg.canSever).toBe(true);
  });

  it('Sabot: several walls of normal thickness and everyone between them, with no blast', () => {
    draw('weapon4');
    expect(r.weapons.current).toBe('sabot');
    r.wall(-10, 1);
    r.wall(-20, 0.6);
    r.wall(-30, 1.6);
    const line = [-6, -8, -15, -17, -25, -35, -38].map(z => r.enemies.add(0, z));
    line[2]!.armor = 80;
    pull();
    expect(line.map(d => d.hits.length)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(r.record.explosions).toBe(0);
    expect(line[2]!.hits[0]!.pierces).toBe(true);
    const far = line[6]!.hits[0]!.amount;
    expect(far).toBeLessThan(WEAPONS.sabot.damage);
    expect(far).toBeGreaterThan(WEAPONS.sabot.damage * PENETRATION.keep);
    // Three walls: an entry and an exit each, a puff behind each, and the thick tracer in four pieces.
    expect(r.record.impacts.length).toBe(6);
    expect(r.record.puffs.length).toBe(3);
    expect(r.record.tracers.filter(t => t.kind === 'sabot').length).toBe(4);
    expect(r.weapons.ammo('sabot').mag).toBe(WEAPONS.sabot.magSize - 1);
    expect(r.weapons.ammo('autocannon').mag).toBe(WEAPONS.autocannon.magSize);
  });

  it('Sabot: its budget runs out', () => {
    draw('weapon4');
    for (let i = 0; i < 4; i++) r.wall(-10 - i * 6, 1.6);
    const behind3 = r.enemies.add(0, -26);
    const behind4 = r.enemies.add(0, -32);
    pull();
    expect(behind3.hits.length).toBe(1);
    expect(behind4.hits.length).toBe(0);
  });

  it('autocannon: still a shell that bursts on the wall', () => {
    // The Sabot's upgrade, second on key 4 once a cache has brought it.
    r.weapons.give('autocannon');
    draw('weapon4', 'weapon4');
    expect(r.weapons.current).toBe('autocannon');
    r.wall(-10, 0.3);
    const behind = r.enemies.add(0, -18);
    pull();
    r.run(0.5);
    expect(r.record.explosions).toBe(1);
    expect(behind.hits.length).toBe(0);
  });

  it('Rivet: no limbs, triple headshots, half damage far away', () => {
    r.weapons.give('judge');
    draw('weapon6', 'weapon6');
    expect(r.weapons.current).toBe('rivet');
    const near = r.enemies.add(0, -10);
    pull(0.03);
    expect(near.hits[0]!.amount).toBe(WEAPONS.rivet.damage);
    expect(near.hits[0]!.severMult).toBe(0);
    expect(near.hits[0]!.headshotMult).toBe(3);
    near.alive = false;
    const far = r.enemies.add(0, -80);
    r.run(0.2);
    pull(0.03);
    expect(far.hits[0]!.amount).toBeCloseTo(WEAPONS.rivet.damage * WEAPONS.rivet.falloff!.floor);
  });

  it('Rivet: fires as fast as the trigger, far faster than the Judge', () => {
    r.weapons.give('judge');
    draw('weapon6', 'weapon6');
    const d = r.enemies.add(0, -10);
    for (let i = 0; i < 6; i++) r.tap('fire');
    r.run(0.2);
    expect(d.hits.length).toBeGreaterThanOrEqual(2);
    expect(WEAPONS.rivet.interval).toBeLessThan(WEAPONS.judge.interval / 3);
    expect(WEAPONS.rivet.drawTime).toBeLessThan(WEAPONS.judge.drawTime);
  });

  it('SMG and Harrow: the rifle reaches, the SMG fades with range', () => {
    const far = r.enemies.add(0, -100);
    pull(0.05);
    expect(far.hits[0]!.amount).toBeCloseTo(WEAPONS.smg.damage * WEAPONS.smg.falloff!.floor);
    draw('weapon1');
    pull(0.05);
    expect(far.hits[far.hits.length - 1]!.amount).toBe(WEAPONS.harrow.damage);
    expect(WEAPONS.harrow.falloff).toBeUndefined();
  });

  it('Harrow and Sabot with Hellfire Rounds: the burst is on the man you hit', () => {
    r.weapons.modifiers.explosiveRounds = true;
    draw('weapon1');
    r.enemies.add(0, -10);
    r.wall(-60, 5);
    pull(0.05);
    expect(r.record.blasts[0]!.z).toBeCloseTo(-9.45, 1);

    r.reset();
    r.weapons.modifiers.explosiveRounds = true;
    draw('weapon4');
    r.enemies.add(0, -10);
    pull();
    expect(r.record.blasts.length).toBeGreaterThanOrEqual(1);
    expect(r.record.blasts[0]!.z).toBeCloseTo(-9.45, 1);
  });

  describe('Lance, as it was before budgets', () => {
    const full = () => {
      r.weapons.give('lance');
      draw('weapon7');
      r.input.simulate('fire', true);
      r.run(TUNING.lance.tapTime + TUNING.lance.chargeTime + 0.1);
      r.input.simulate('fire', false);
      // Long enough for the beam, and over before the first of its plasma bursts: those are lance.test.ts's.
      r.run(0.03);
    };

    it('bodies are free, and a wall takes nothing off its damage', () => {
      r.wall(-10, 0.6);
      const line = [-4, -6, -14, -16].map(z => r.enemies.add(0, z));
      full();
      expect(line.map(d => d.hits.length)).toEqual([1, 1, 1, 1]);
      expect(line.map(d => d.hits[0]!.amount)).toEqual(line.map(() => WEAPONS.lance.damage));
    });

    it('two walls, each up to 1.6 m, and not a third', () => {
      r.wall(-10, 1);
      r.wall(-20, 1.5);
      r.wall(-30, 0.3);
      const line = [-15, -25, -35].map(z => r.enemies.add(0, z));
      full();
      expect(line.map(d => d.hits.length)).toEqual([1, 1, 0]);
    });

    it('steel costs it no more than concrete, and a wall over 1.6 m stops it', () => {
      r.wall(-10, 1.2, 'metal');
      const behind = r.enemies.add(0, -15);
      r.wall(-20, 1.7);
      const beyond = r.enemies.add(0, -25);
      full();
      expect(behind.hits.length).toBe(1);
      expect(beyond.hits.length).toBe(0);
    });

    it('an energy surface is a wall like any other to it', () => {
      r.wall(-10, 0.05, 'energy');
      const behind = r.enemies.add(0, -15);
      full();
      expect(behind.hits.length).toBe(1);
    });

    it('a part charge goes through nothing', () => {
      r.weapons.give('lance');
      draw('weapon7');
      r.wall(-10, 0.3);
      const behind = r.enemies.add(0, -15);
      r.input.simulate('fire', true);
      // The stage under full, the strongest beam that is not a full one.
      r.run(TUNING.lance.tapTime + TUNING.lance.chargeTime * 0.8);
      r.input.simulate('fire', false);
      r.run(0.05);
      expect(r.weapons.lance.fired.beams).toEqual([0, 1, 0]);
      expect(behind.hits.length).toBe(0);
    });
  });
});

describe('projectiles', () => {
  const launch = (penetrate: number, bodyCost?: number) => r.combat.spawnProjectile({
    origin: new THREE.Vector3(0, 1, 0), velocity: new THREE.Vector3(0, 0, -300), kind: 'bullet', team: 'player', damage: 100, source: 'test',
    penetrate, bodyCost,
  });

  it.each([30, 60, 144])('a round with a budget goes through a wall and bodies at %s fps', fps => {
    r.wall(-10, 0.6);
    const line = [-5, -6.5, -14, -18].map(z => r.enemies.add(0, z));
    launch(0.6 + PENETRATION.body * 3 + 0.05);
    r.run(0.4, fps);
    expect(line.map(d => d.hits.length)).toEqual([1, 1, 1, 1]);
    expect(line[3]!.hits[0]!.amount).toBeLessThan(line[0]!.hits[0]!.amount);
    expect(r.record.impacts.map(m => +m.at.z.toFixed(2))).toEqual([-10, -10.6]);
    expect(r.record.puffs.length).toBe(1);
    expect(r.combat.projectiles.count).toBe(0);
  });

  it('a round with none stops where it always did', () => {
    r.wall(-10, 0.04);
    const before = r.enemies.add(0, -5);
    const behind = r.enemies.add(0, -14);
    launch(0);
    r.run(0.3);
    expect(before.hits.length).toBe(1);
    expect(behind.hits.length).toBe(0);
    before.alive = false;
    launch(0);
    r.run(0.3);
    expect(behind.hits.length).toBe(0);
    expect(r.combat.projectiles.count).toBe(0);
  });

  it('is spent by what it passes', () => {
    r.wall(-10, 0.6);
    const behind = r.enemies.add(0, -14);
    launch(0.5);
    r.run(0.3);
    expect(behind.hits.length).toBe(0);
    launch(0.7, 0.3);
    r.run(0.3);
    expect(behind.hits.length).toBe(1);
    // 0.1 left after the wall is not a body's worth, so it stopped in this one.
    expect(r.combat.projectiles.count).toBe(0);
  });
});
