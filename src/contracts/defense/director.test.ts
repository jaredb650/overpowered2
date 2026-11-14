/**
 * Outpost Defense's waves (pieces 7 and 8 of docs/proposals/outpost-defense.md): who comes in which wave and the boss order, satchel
 * charges on a real wall, enemy mortars that cannot fire on the move, the Commander kept from ending an endless run, the early start,
 * an ally's gun paying nothing, and the player's mortar teams never dropping a round inside the walls.
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Ctx, GameEvents } from '../../core/contracts';
import { EventBus } from '../../core/events';
import { mulberry32 } from '../../core/math';
import { noop } from '../../core/stubs';
import { waveScale } from '../../enemies/data';
import { MAX_ALIVE } from '../../enemies/waves';
import { Physics } from '../../physics/Physics';
import { gunSource } from '../../vehicles/emplacement';
import { RINGS } from '../../world/map/fort/plan';
import { MapSpec } from '../../world/map/spec';
import { Structures } from '../../world/structures';
import { paysFor } from './data';
import { FIELD_MORTAR, MortarCrew, pickMortarTarget, SATCHEL, satchelBlast, TEAM_MORTAR, tooClose, type MortarCandidate } from './field';
import { Defense } from './index';
import { TEAM_SOURCE } from './teams';
import { BOSS_ORDER, bossFor, DIRECTOR, footMen, menIn, planWave, previewLine } from './waves';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const kinds = (wave: number, seeds = 40): Set<string> => {
  const out = new Set<string>();
  for (let i = 0; i < seeds; i++) for (const s of planWave(wave, mulberry32(i + 1)).squads) for (const id of s) out.add(id);
  return out;
};

describe('the wave plan', () => {
  it('wave 1: riflemen and shotgunners on foot, two of them with charges, nothing else', () => {
    const p = planWave(1, mulberry32(7));
    expect([...kinds(1)].sort()).toEqual(['gunner', 'trooper']);
    expect(p.sappers).toBe(2);
    expect(menIn(p)).toBe(DIRECTOR.firstMen);
    expect(p).toMatchObject({ mortars: 0, engineers: 0, trucks: 0, humvees: 0, bombers: 0, boss: null });
    expect(previewLine(p)).toMatch(/8 men on foot, 2 with charges/);
  });

  it('wave 4: mortar teams and engineers join, in their own squads at the back', () => {
    const p = planWave(4, mulberry32(3));
    expect(p.mortars).toBe(1);
    expect(p.engineers).toBe(1);
    expect(p.squads.slice(-2)).toEqual([['trooper', 'trooper'], ['trooper']]);
    expect(kinds(4).has('rocketeer')).toBe(false);
    expect(previewLine(p)).toMatch(/1 mortar team, 1 engineer/);
  });

  it('wave 7: trucks and scout cars, and rocketeers in the squads', () => {
    const p = planWave(7, mulberry32(5));
    expect(p.trucks).toBe(1);
    expect(p.humvees).toBe(1);
    expect(kinds(6).has('rocketeer')).toBe(false);
    expect(kinds(7).has('rocketeer')).toBe(true);
    expect(p.mortars + p.engineers).toBeGreaterThan(0);
  });

  it('wave 10 on: bombers, snipers and machine gunners', () => {
    expect(kinds(9).has('sniper') || kinds(9).has('brute')).toBe(false);
    expect(kinds(10).has('sniper')).toBe(true);
    expect(kinds(10).has('brute')).toBe(true);
    expect(planWave(10).bombers).toBeGreaterThan(0);
    expect(planWave(11).bombers).toBe(2);
    expect(planWave(9).bombers).toBe(0);
  });

  it('a boss every fifth wave, in the owner\'s order, then round again harder', () => {
    expect(BOSS_ORDER).toEqual(['tanks', 'choppers', 'juggernaut', 'titan', 'all']);
    expect([5, 10, 15, 20, 25, 30, 35].map(bossFor)).toEqual(['tanks', 'choppers', 'juggernaut', 'titan', 'all', 'tanks', 'choppers']);
    for (const w of [1, 4, 6, 9, 11, 24, 26]) expect(bossFor(w)).toBeNull();
    const at = (w: number) => {
      const p = planWave(w, mulberry32(w));
      return [p.tanks, p.choppers, p.juggernauts, p.titans];
    };
    expect(at(5)).toEqual([1, 0, 0, 0]);
    expect(at(10)).toEqual([0, 1, 0, 0]);
    expect(at(15)).toEqual([0, 0, 1, 0]);
    expect(at(20)).toEqual([0, 0, 0, 1]);
    expect(at(25)).toEqual([1, 1, 1, 1]);
    expect(at(30)).toEqual([2, 0, 0, 0]);
    expect(at(40)).toEqual([0, 0, 1 + 1, 0]);
    expect(previewLine(planWave(5, mulberry32(1)))).toMatch(/^1 TANK, \d+ men on foot/);
    expect(previewLine(planWave(25, mulberry32(1)))).toMatch(/^1 TANK, 1 ATTACK HELICOPTER, 1 JUGGERNAUT, 1 TITAN/);
  });

  it('a boss wave brings an escort, not a full wave with a boss on top', () => {
    expect(menIn(planWave(5, mulberry32(2)))).toBeLessThan(menIn(planWave(6, mulberry32(2))));
  });

  it('grows in numbers and toughness and stays inside the alive caps', () => {
    for (let w = 2; w <= 60; w++) {
      expect(footMen(w)).toBeGreaterThanOrEqual(footMen(w - 1));
      expect(waveScale(w).health).toBeGreaterThan(waveScale(w - 1).health);
      const p = planWave(w, mulberry32(w));
      expect(p.mortars).toBeLessThanOrEqual(4);
      expect(p.trucks + p.humvees + p.tanks).toBeLessThanOrEqual(8);
      for (const s of p.squads) expect(s.length).toBeLessThanOrEqual(DIRECTOR.aliveCap);
    }
    // Men on foot, a truck's crew, the bombers' allowance and a boss or two still fit under the game's cap.
    expect(DIRECTOR.aliveCap + 4 + 5 + 4).toBeLessThan(MAX_ALIVE);
  });
});

describe('satchel charges', () => {
  it('wear a wall a stage a charge through the blast path, and open a gate in one', async () => {
    const physics = await Physics.create();
    const spec = new MapSpec();
    spec.wall(-6, 0, -2, 0);
    spec.wall(-2, 0, 2, 0);
    spec.wallGate(2, 0, 6, 0);
    const ctx = { physics, fx: noop('fx'), audio: noop('audio'), player: { position: V(100, 0, 100), alive: true }, enemies: { query: () => 0 } } as unknown as Ctx;
    const walls = new Structures(ctx, spec.structures, () => new THREE.MeshBasicMaterial());
    walls.attach(null);
    const objects = { damageExplosivesInRadius: (c: THREE.Vector3, r: number, a: number, s: string) => walls.blast(c, r, a, s) };
    const mid = walls.all.find(p => p.kind === 'wall' && walls.distance(p, V(0, 1, 0)) < 0.01)!;
    const gate = walls.all.find(p => p.kind === 'gate')!;
    // Set against the outer face, as a sapper sets it.
    satchelBlast(objects, V(0, 0, -0.35));
    expect(mid.stage).toBe('damaged');
    satchelBlast(objects, V(0.4, 0, -0.35));
    expect(mid.stage).toBe('breached');
    satchelBlast(objects, V(4, 0, -0.35));
    expect(gate.stage).toBe('breached');
    // Small arms do nothing to them; only a blast does.
    expect(SATCHEL.wall).toBeGreaterThan(300);
  });
});

describe('enemy mortar teams', () => {
  it('set up at the pit before they fire, and never fire while moving', () => {
    const crew = new MortarCrew();
    const dt = 0.4;
    let fired = 0;
    // Walking to the pit, for a minute: nothing.
    for (let t = 0; t < 60; t += dt) if (crew.tick(dt, t > 30, true)) fired++;
    expect(fired).toBe(0);
    // At the pit and still: the setup, then a salvo, then one a reload.
    let first = -1;
    for (let t = 0; t < 30; t += dt) {
      if (crew.tick(dt, true, false)) {
        fired++;
        if (first < 0) first = t;
      }
    }
    expect(first).toBeGreaterThanOrEqual(FIELD_MORTAR.setup - dt);
    expect(fired).toBeGreaterThanOrEqual(2);
    // Shoved off the pit, he has to set up all over again.
    crew.tick(dt, true, true);
    expect(crew.stage).toBe('moving');
    expect(crew.tick(dt, true, false)).toBe(false);
    expect(crew.stage).toBe('setup');
  });
});

describe('the Commander', () => {
  const personOn = async (search: string) => {
    vi.resetModules();
    vi.stubGlobal('location', { search });
    const { Person } = await import('../../enemies/commander/person');
    const p = new Person({ w: { now: 0 } } as never);
    p.arm();
    vi.unstubAllGlobals();
    return p;
  };

  it('never comes down in person on Outpost Defense, so his death cannot end the run', async () => {
    expect((await personOn('?contract=defense')).pending).toBe(false);
    expect((await personOn('?contract=outpost')).pending).toBe(true);
  });
});

function fakeCtx(phase: 'intermission' | 'spawning', wave = 2) {
  const feed = vi.fn();
  const events = new EventBus<GameEvents>();
  const ctx = {
    events,
    input: { pressed: (a: string) => a === 'nextWave', labelFor: () => 'L' },
    player: { alive: true, parked: false, position: V(500, 0, 500) },
    time: { elapsed: 0, dt: 0.016 },
    waves: { wave, phase, nextWaveIn: 0 },
    hud: { banner: vi.fn(), feed, follow: () => () => {} },
    world: { objects: { structures: [] } },
    render: {},
  } as unknown as Ctx;
  return { ctx, feed, events };
}

describe('the early start', () => {
  it('brings a break down to its last three seconds on the key, and does nothing in a wave', () => {
    const calm = fakeCtx('intermission');
    const d = new Defense(calm.ctx);
    d.update();
    expect(calm.ctx.waves.nextWaveIn).toBe(3);
    expect(calm.feed).toHaveBeenCalledWith('NEXT WAVE CALLED IN', expect.any(String));
    const fight = fakeCtx('spawning');
    (fight.ctx.waves as { nextWaveIn: number }).nextWaveIn = 0;
    new Defense(fight.ctx).update();
    expect(fight.ctx.waves.nextWaveIn).toBe(0);
  });
});

describe('who gets paid', () => {
  it('pays for the player on a mounted gun, never for an ally on one, nor for the player\'s mortar teams', () => {
    expect(gunSource('player')).toBe('emplacement');
    expect(gunSource({})).toBe('ally_emplacement');
    expect(paysFor(gunSource('player'))).toBe(true);
    expect(paysFor(gunSource({}))).toBe(false);
    expect(paysFor(TEAM_SOURCE)).toBe(false);
    expect(paysFor('satchel')).toBe(false);
    expect(paysFor('mortar')).toBe(false);
    expect(paysFor('harrow')).toBe(true);
  });

  it('credits nothing for a kill by an ally on a gun', () => {
    const { ctx, events } = fakeCtx('spawning');
    const d = new Defense(ctx);
    d.init();
    const kill = (source: string) => events.emit('enemy:killed', { damage: { source }, headshot: false } as never);
    kill('ally_emplacement');
    expect(d.credits).toBe(0);
    kill('emplacement');
    expect(d.credits).toBeGreaterThan(0);
  });
});

describe('the player\'s mortar teams', () => {
  it('never drop a round inside the walls, whatever is in there', () => {
    const roll = mulberry32(11);
    const out = new THREE.Vector3();
    const inside: MortarCandidate[] = [{ x: 0, z: 0, vehicle: false }, { x: 30, z: 10, vehicle: true }, { x: -50, z: 51, vehicle: false }, { x: 55, z: 0, vehicle: false }];
    const outside: MortarCandidate[] = [{ x: 0, z: -90, vehicle: false }, { x: 70, z: 70, vehicle: true }];
    for (let i = 0; i < 3000; i++) {
      const list = i % 3 === 0 ? inside : i % 3 === 1 ? [...inside, ...outside] : [];
      pickMortarTarget(list, roll, out);
      expect(tooClose(out.x, out.z)).toBe(false);
      expect(Math.max(Math.abs(out.x), Math.abs(out.z))).toBeGreaterThanOrEqual(RINGS[0]!.half + TEAM_MORTAR.clear - 1e-6);
    }
  });

  it('prefer groups and vehicles to a man on his own', () => {
    const roll = mulberry32(5);
    const out = new THREE.Vector3();
    const lone = { x: 0, z: -95, vehicle: false };
    const group = [0, 1, 2, 3].map(i => ({ x: 80 + i, z: 0, vehicle: false }));
    const truck = { x: 0, z: 85, vehicle: true };
    const hits = { lone: 0, group: 0, truck: 0 };
    for (let i = 0; i < 2000; i++) {
      pickMortarTarget([lone, ...group, truck], roll, out);
      if (out.z < -80) hits.lone++;
      else if (out.x > 70) hits.group++;
      else hits.truck++;
    }
    expect(hits.group).toBeGreaterThan(hits.truck);
    expect(hits.truck).toBeGreaterThan(hits.lone);
  });
});
