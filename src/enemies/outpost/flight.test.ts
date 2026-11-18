import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mulberry32 } from '../../core/math';
import type { AiWorld } from '../aiWorld';
import type { Enemy } from '../Enemy';
import { SOLDIER_BEHAVIOURS } from './behaviours';
import { bestRuns, corner, cornerWeights, FLEE_LIMIT, pickReaction, REACTIONS, SELF_EXECUTIONS, SELF_MORALE, type CornerFacts, type FleeCandidate, type Reaction } from './flight';
import type { Outpost } from './index';
import { enlist, Soldier } from './soldier';

const v = (x: number, z: number) => new THREE.Vector3(x, 0, z);

const facts = (over: Partial<CornerFacts> = {}): CornerFacts => ({
  morale: 8, rank: 'regular', gives: 0.5, canSurrender: true, armed: true, grenade: true, pistol: true, wounded: 0, bravado: false,
  executed: 0, freed: 0, timeout: false, ...over,
});

/** Share of each reaction over many rolls. */
function shares(f: CornerFacts, n = 20000): Record<Reaction, number> {
  const rnd = mulberry32(7);
  const out = Object.fromEntries(REACTIONS.map(r => [r, 0])) as Record<Reaction, number>;
  const w = cornerWeights(f);
  for (let i = 0; i < n; i++) out[pickReaction(w, rnd())]++;
  for (const r of REACTIONS) out[r] /= n;
  return out;
}

afterEach(() => vi.restoreAllMocks());

describe('where a broken man runs', () => {
  it('away from the player, never past him, never a step or a marathon', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const me = v(10, 0);
    const places = [v(40, 0), v(-10, 0), v(12, 0), v(10, 200), v(10, 30)];
    const runs = bestRuns(me, places, [v(0, 0)], [] as FleeCandidate[]);
    expect(runs[0]!.at).toBe(places[0]);
    const picked = runs.map(r => r.at);
    // Behind the player, two metres away, and the other side of the map are no escape.
    expect(picked).not.toContain(places[1]);
    expect(picked).not.toContain(places[2]);
    expect(picked).not.toContain(places[3]);
  });

  it('in co-op, away from every player', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const me = v(0, 0);
    const places = [v(30, 0), v(-30, 0), v(0, 30)];
    // One player east, one west: north is the only way out.
    const runs = bestRuns(me, places, [v(25, 0), v(-25, 0)], []);
    expect(runs.map(r => r.at)).toEqual([places[2]]);
  });
});

describe('cornered', () => {
  it('only shoots himself with his nerve gone, a pistol, and a player known for shooting prisoners, and even then rarely', () => {
    const ready = facts({ morale: SELF_MORALE, executed: SELF_EXECUTIONS });
    expect(cornerWeights(ready).self).toBeGreaterThan(0);
    expect(cornerWeights({ ...ready, executed: SELF_EXECUTIONS - 1 }).self).toBe(0);
    expect(cornerWeights({ ...ready, morale: SELF_MORALE + 1 }).self).toBe(0);
    expect(cornerWeights({ ...ready, pistol: false }).self).toBe(0);
    const s = shares(ready);
    expect(s.self).toBeGreaterThan(0.01);
    expect(s.self).toBeLessThan(0.06);
    expect(shares(facts()).self).toBe(0);
  });

  it('fakes a surrender rarely, and only with a grenade and a surrender to fake', () => {
    expect(shares(facts()).fake).toBeLessThan(0.03);
    expect(shares(facts()).fake).toBeGreaterThan(0);
    expect(cornerWeights(facts({ grenade: false })).fake).toBe(0);
    expect(cornerWeights(facts({ canSurrender: false })).fake).toBe(0);
  });

  it('weighs rank, wounds and the player\'s record', () => {
    expect(shares(facts({ rank: 'elite' })).fight).toBeGreaterThan(shares(facts({ rank: 'conscript' })).fight);
    expect(shares(facts({ rank: 'conscript' })).cower).toBeGreaterThan(shares(facts({ rank: 'elite' })).cower);
    expect(cornerWeights(facts({ wounded: 0.2 })).taunt).toBe(0);
    expect(cornerWeights(facts({ wounded: 0.8 })).taunt).toBeGreaterThan(0);
    // Shot prisoners make kneeling look worse and fighting look better.
    expect(shares(facts({ executed: 3 })).surrender).toBeLessThan(shares(facts()).surrender);
    expect(shares(facts({ executed: 3 })).fight).toBeGreaterThan(shares(facts()).fight);
    expect(cornerWeights(facts({ canSurrender: false })).surrender).toBe(0);
    // Every reaction comes up.
    const all = shares(facts({ morale: 2, executed: 2, wounded: 0.9 }));
    for (const r of REACTIONS) expect(all[r]).toBeGreaterThan(0);
  });

  it('out of time, he gives up or fights, even with nothing to fight with and no surrender allowed', () => {
    const late = shares(facts({ timeout: true, wounded: 1, morale: 0, executed: 5 }));
    expect(late.surrender + late.fight).toBe(1);
    const w = cornerWeights(facts({ timeout: true, canSurrender: false, armed: false }));
    expect(w.fight).toBeGreaterThan(0);
  });
});

/** A fleeing man on a mock map: flee planning always finds somewhere, and nothing can take him off the map. */
function runner() {
  const s = new Soldier();
  const e = {
    uid: 1, id: 'trooper', alive: true, position: v(0, 0), moveTarget: new THREE.Vector3(), center: new THREE.Vector3(), dist: 30, hasLos: false,
    def: { speed: 5 }, health: 100, maxHealth: 100, attacks: [], thinkAt: 0, behaviourUntil: 0, mode: 'hold', face: 'move', pace: 1, yaw: 0,
    attack: null, stagger: 0, char: { anim: { setPosture: vi.fn(), play: vi.fn() } },
  } as unknown as Enemy;
  s.e = e;
  s.fate = 'flee';
  enlist(e, s);
  const o = {
    fleeTo: vi.fn(() => true), escape: vi.fn(() => true), routeToGate: vi.fn(() => true), rejoin: vi.fn(), reclaimWeapon: vi.fn(),
    comms: { say: vi.fn() }, doctrine: { surrender: true }, captives: { executed: 0, freed: 0 },
    wounds: { drawSidearm: vi.fn() }, w: null as unknown as AiWorld,
  };
  const w = { now: 0, enemies: { outpost: o }, ctx: { audio: { play: vi.fn() } }, telegraphs: { glint: vi.fn() } } as unknown as AiWorld;
  o.w = w;
  return { s, e, o, w };
}

describe('running', () => {
  const flee = SOLDIER_BEHAVIOURS.find(b => b.name === 'flee')!;

  it('never leaves the map, keeps finding somewhere new to run, and stops running before the wave can stall', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { s, e, o, w } = runner();
    flee.enter!(e, w);
    for (let t = 0; t < FLEE_LIMIT - 1; t += 0.1) {
      w.now = t;
      // Every run ends at once: he is always at his destination, the moment a gate used to swallow him.
      s.route.clear();
      flee.frame!(e, w, 0.1);
      flee.think!(e, w);
    }
    expect(o.escape).not.toHaveBeenCalled();
    expect(o.routeToGate).not.toHaveBeenCalled();
    expect(e.alive).toBe(true);
    expect(o.fleeTo.mock.calls.length).toBeGreaterThan(10);
    expect(s.fate).toBe('flee');
    w.now = FLEE_LIMIT + 1;
    flee.think!(e, w);
    // Out of time: on his knees or back in the fight, either of which ends the wave.
    expect(s.fate === 'surrender' || s.fate === 'none').toBe(true);
  });

  it('is caught with a player on top of him and in sight, and does one thing about it', () => {
    const { s, e, w } = runner();
    flee.enter!(e, w);
    e.hasLos = true;
    e.dist = 3;
    w.now = 1;
    flee.think!(e, w);
    expect(s.fate !== 'flee' || s.corner !== 'none').toBe(true);
  });

  it('a player watching him from close for a few seconds is as good as caught', () => {
    const { s, e, w } = runner();
    flee.enter!(e, w);
    e.hasLos = true;
    e.dist = 10;
    w.now = 1;
    flee.think!(e, w);
    expect(s.fate === 'flee' && s.corner === 'none').toBe(true);
    w.now = 6;
    flee.think!(e, w);
    expect(s.fate !== 'flee' || s.corner !== 'none').toBe(true);
  });

  it('a cornered fake surrender kneels with the plot already laid', () => {
    const { s, o } = runner();
    const r = corner(o as unknown as Outpost, s, false, 0);
    // A roll of 0 is the first reaction on the table: surrender. A roll that lands on fake lays the plot.
    expect(r).toBe('surrender');
    const w = cornerWeights(facts());
    let before = 0;
    for (const x of REACTIONS) {
      if (x === 'fake') break;
      before += w[x];
    }
    const total = REACTIONS.reduce((n, x) => n + w[x], 0);
    const t = runner();
    t.s.grenades = 1;
    t.s.morale = 8;
    expect(corner(t.o as unknown as Outpost, t.s, false, (before + w.fake / 2) / total)).toBe('fake');
    expect(t.s.fate).toBe('surrender');
    expect(t.s.fake).toBe('waiting');
  });
});
