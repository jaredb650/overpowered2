/**
 * The Lance: the rules of its charge, the pool its bursts wait in, and then the real Weapons and Combat on the test
 * range: a tap, each stage of the beam, the chain of bursts down a line of bodies, walls, the cell, and what cancels it.
 */
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import type { StruckList } from '../core/gameplay';
import { EXPLOSIONS, HIT_STOP, TUNING, WEAPONS } from './data';
import { LANCE_ON, PlasmaChain, chargeAfter, chargeCap, stageAfforded, stageAt, type Link } from './lance';
import { makeRange, type Dummy, type Range } from './testkit';

const T = TUNING.lance;
const [LOW, MID, FULL] = T.stages;
/** Seconds of trigger that reach each stage, with a frame or two to spare. */
const HOLD = { low: T.tapTime + LOW.at * T.chargeTime + 0.05, mid: T.tapTime + MID.at * T.chargeTime + 0.05, full: T.tapTime + T.chargeTime + 0.1 };
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

describe('the charge', () => {
  it('is on unless the page asks for the old gun', () => {
    expect(LANCE_ON).toBe(true);
  });

  it('is a ball under the first stage, then the last stage reached', () => {
    expect(stageAt(0)).toBe(-1);
    expect(stageAt(LOW.at - 0.01)).toBe(-1);
    expect(stageAt(LOW.at)).toBe(0);
    expect(stageAt(MID.at - 0.01)).toBe(0);
    expect(stageAt(MID.at)).toBe(1);
    expect(stageAt(0.99)).toBe(1);
    expect(stageAt(1)).toBe(2);
  });

  it('shows nothing for the length of a tap, then climbs in a line to full', () => {
    expect(chargeAfter(0)).toBe(0);
    expect(chargeAfter(T.tapTime)).toBe(0);
    expect(chargeAfter(T.tapTime + T.chargeTime / 2)).toBeCloseTo(0.5, 5);
    expect(chargeAfter(T.tapTime + T.chargeTime)).toBe(1);
    expect(chargeAfter(10)).toBe(1);
    expect(chargeAfter(10, MID.at)).toBe(MID.at);
  });

  it('climbs only as far as the cell can pay for', () => {
    expect(stageAfforded(0)).toBe(-1);
    expect(stageAfforded(1)).toBe(-1);
    expect(stageAfforded(LOW.cost)).toBeGreaterThanOrEqual(0);
    expect(stageAfforded(FULL.cost)).toBe(2);
    expect(stageAfforded(0, true)).toBe(2);
    expect(chargeCap(1)).toBe(0);
    expect(chargeCap(FULL.cost - 1)).toBe(MID.at);
    expect(chargeCap(WEAPONS.lance.magSize)).toBe(1);
  });

  it('has stages that get stronger, and a cell that holds a whole number of each shot', () => {
    for (let i = 1; i < T.stages.length; i++) {
      const a = T.stages[i - 1]!;
      const b = T.stages[i]!;
      expect(b.at).toBeGreaterThan(a.at);
      expect(b.cost).toBeGreaterThanOrEqual(a.cost);
      expect(b.damage).toBeGreaterThan(a.damage);
      expect(b.pierce).toBeGreaterThan(a.pierce);
      expect(b.burst).toBeGreaterThan(a.burst);
    }
    expect(FULL.at).toBe(1);
    expect(FULL.damage).toBe(1);
    expect(WEAPONS.lance.magSize % FULL.cost).toBe(0);
    expect(T.chain.max).toBeGreaterThan(FULL.pierce);
    // Twenty bursts in a second: quiet on the camera, and no stop of the clock each.
    expect(EXPLOSIONS.plasmaBurst.flash).toBe(0);
    expect(EXPLOSIONS.plasmaBurst.fovPunch).toBe(0);
    expect(EXPLOSIONS.plasmaBurst.noKillStop).toBe(true);
  });
});

describe('the chain', () => {
  const struck = (...zs: number[]): StruckList => ({ count: zs.length, walls: 0, points: zs.map(z => v(0, 1, z)), enemies: zs.map(() => null) });
  const dir = v(0, 0, -1);

  it('books a burst a body, nearest first, a gap apart', () => {
    const chain = new PlasmaChain(8);
    expect(chain.load(struck(-5, -7, -9), dir, 10, 2.8, 160, 0.04, 0.035)).toBe(3);
    expect(chain.pending).toBe(3);
    const fired: Link[] = [];
    const at: number[] = [];
    const fire = (l: Link) => { fired.push(l); at.push(l.point.z); };
    expect(chain.drain(10.03, fire, 4)).toBe(0);
    expect(chain.drain(10.041, fire, 4)).toBe(1);
    expect(chain.drain(10.08, fire, 4)).toBe(1);
    expect(chain.drain(10.2, fire, 4)).toBe(1);
    expect(at).toEqual([-5, -7, -9]);
    // The bolt to each jumps from the body before it, and to the first from a little way back up the beam.
    expect(fired[0]!.from.z).toBeGreaterThan(-5);
    expect(fired[0]!.from.z).toBeLessThan(0);
    expect(fired[1]!.from.z).toBe(-5);
    expect(fired[2]!.from.z).toBe(-7);
    expect(fired[0]!.radius).toBe(2.8);
    expect(fired[0]!.damage).toBe(160);
    expect(chain.pending).toBe(0);
  });

  it('sets off no more than a few a frame, the earliest first, and keeps the rest for the next', () => {
    const chain = new PlasmaChain(8);
    chain.load(struck(-1, -2, -3, -4, -5), dir, 0, 2, 100, 0.01, 0.01);
    const at: number[] = [];
    // A long frame: all five are due.
    expect(chain.drain(1, l => at.push(l.point.z), 2)).toBe(2);
    expect(at).toEqual([-1, -2]);
    expect(chain.drain(1, l => at.push(l.point.z), 2)).toBe(2);
    expect(chain.drain(1, l => at.push(l.point.z), 2)).toBe(1);
    expect(at).toEqual([-1, -2, -3, -4, -5]);
  });

  it('books from an index on, at the pace of the whole list, for a beam that fills it over several frames', () => {
    const chain = new PlasmaChain(8);
    const list = struck(-5, -7, -9, -11);
    list.count = 2;
    expect(chain.load(list, dir, 10, 2, 100, 0.04, 0.035, 0)).toBe(2);
    list.count = 4;
    expect(chain.load(list, dir, 10, 2, 100, 0.04, 0.035, 2)).toBe(2);
    const at: [number, number][] = [];
    for (let t = 10; t < 10.3; t += 0.005) chain.drain(t, l => at.push([l.point.z, +(l.at - 10).toFixed(3)]), 4);
    expect(at).toEqual([[-5, 0.04], [-7, 0.075], [-9, 0.11], [-11, 0.145]]);
  });

  it('drops what the pool has no room for, and clears', () => {
    const chain = new PlasmaChain(3);
    expect(chain.load(struck(-1, -2, -3, -4, -5), dir, 0, 2, 100)).toBe(3);
    expect(chain.pending).toBe(3);
    chain.clear();
    expect(chain.pending).toBe(0);
    expect(chain.drain(99, () => { throw new Error('cleared'); })).toBe(0);
  });

  it('a burst that fires a second beam finds the pool free', () => {
    const chain = new PlasmaChain(2);
    chain.load(struck(-1, -2), dir, 0, 2, 100, 0, 0);
    let again = 0;
    chain.drain(1, () => { again += chain.load(struck(-9), dir, 5, 2, 100); }, 2);
    expect(again).toBe(2);
    expect(chain.pending).toBe(2);
  });
});

describe('on the range', () => {
  let r: Range;
  beforeEach(async () => {
    r = await makeRange();
    r.reset();
    r.weapons.give('lance');
    r.tap('weapon7');
    r.run(0.5);
    r.record.sounds.length = 0;
  });

  const cell = () => r.weapons.ammo('lance').mag;
  const click = (fps = 60) => {
    r.input.simulate('fire', true);
    r.run(1 / fps, fps);
    r.input.simulate('fire', false);
    r.run(1 / fps, fps);
  };
  const hold = (seconds: number, fps = 60) => {
    r.input.simulate('fire', true);
    r.run(seconds, fps);
    r.input.simulate('fire', false);
    r.run(1 / fps, fps);
  };
  const beamHits = (d: Dummy) => d.hits.filter(h => h.type === 'bullet');
  const burstHits = (d: Dummy) => d.hits.filter(h => h.type === 'explosive');
  const balls = () => r.combat.projectiles.active.filter(p => p.kind === 'plasma');

  it('draws on key 7 with a full cell', () => {
    expect(r.weapons.current).toBe('lance');
    expect(cell()).toBe(WEAPONS.lance.magSize);
  });

  describe('a tap', () => {
    it('is one plasma ball, for one of the cell, with no charge shown or heard', () => {
      click();
      expect(balls().length).toBe(1);
      expect(balls()[0]!.velocity.length()).toBeCloseTo(T.ball.speed, 3);
      expect(cell()).toBe(WEAPONS.lance.magSize - T.ball.cost);
      expect(r.weapons.lance.fired.balls).toBe(1);
      expect(r.weapons.lance.fired.beams).toEqual([0, 0, 0]);
      expect(r.record.sounds).toContain('lance_plasma');
      expect(r.record.sounds).not.toContain('lance_stage');
      expect(r.record.sounds).not.toContain('railgun_fire');
      expect(r.weapons.charge).toBe(0);
    });

    it('hits what it lands on and splashes whoever stands beside it', () => {
      const hit = r.enemies.add(0, -10);
      const beside = r.enemies.add(1.5, -10);
      const far = r.enemies.add(4, -10);
      click();
      r.run(0.3);
      expect(balls().length).toBe(0);
      expect(beamHits(hit).map(h => h.amount)).toEqual([T.ball.damage]);
      expect(beamHits(hit)[0]!.force).toBe(T.ball.force);
      expect(burstHits(hit).length).toBe(1);
      expect(burstHits(beside).length).toBe(1);
      expect(burstHits(beside)[0]!.amount).toBeGreaterThan(T.ball.splash * 0.5);
      expect(burstHits(beside)[0]!.amount).toBeLessThanOrEqual(T.ball.splash);
      expect(burstHits(beside)[0]!.blastKind).toBe('plasmaBurst');
      expect(far.hits.length).toBe(0);
      expect(r.record.explosions).toBe(1);
      expect(r.record.blasts[0]!.z).toBeCloseTo(-9.45, 1);
    });

    it.each([30, 60, 144])('fires as fast as four a second at %s fps', fps => {
      for (let i = 0; i < 8; i++) {
        click(fps);
        r.run(0.25 - 2 / fps, fps);
      }
      expect(r.weapons.lance.fired.balls).toBe(8);
      expect(cell()).toBe(WEAPONS.lance.magSize - 8);
    });

    it('a click late in the wait after a shot fires when the wait ends; one too early is dropped', () => {
      click();
      expect(r.weapons.lance.fired.balls).toBe(1);
      // 0.03 s in: the buffer runs out long before the gun is ready again.
      click();
      r.run(WEAPONS.lance.interval);
      expect(r.weapons.lance.fired.balls).toBe(1);
      click();
      r.run(WEAPONS.lance.interval - 0.1);
      click();
      expect(r.weapons.lance.fired.balls).toBe(2);
      r.run(0.12);
      expect(r.weapons.lance.fired.balls).toBe(3);
    });

    it('a ball that kills nothing still stops at a wall and bursts there', () => {
      r.wall(-12, 0.6);
      const behind = r.enemies.add(0, -15);
      click();
      r.run(0.3);
      expect(r.record.explosions).toBe(1);
      expect(r.record.blasts[0]!.z).toBeGreaterThan(-12.01);
      expect(behind.hits.length).toBe(0);
    });
  });

  describe('a hold', () => {
    it.each([30, 60, 144])('reaches each stage on time at %s fps, with a tick for each', fps => {
      r.input.simulate('fire', true);
      r.run(T.tapTime - 2 / fps, fps);
      expect(r.weapons.charge).toBe(0);
      r.run(LOW.at * T.chargeTime + 3 / fps, fps);
      expect(r.weapons.lance.stage).toBe(0);
      expect(r.weapons.charge).toBeGreaterThanOrEqual(LOW.at);
      r.run((MID.at - LOW.at) * T.chargeTime + 1 / fps, fps);
      expect(r.weapons.lance.stage).toBe(1);
      r.run((1 - MID.at) * T.chargeTime + 1 / fps, fps);
      expect(r.weapons.lance.stage).toBe(2);
      expect(r.weapons.charge).toBe(1);
      expect(r.record.sounds.filter(s => s === 'lance_stage').length).toBe(3);
      expect(r.record.sounds).toContain('railgun_ready');
      // Held at full it stays there, and nothing has left the gun.
      r.run(0.5, fps);
      expect(r.weapons.charge).toBe(1);
      expect(cell()).toBe(WEAPONS.lance.magSize);
    });

    it('let go at the first stage: a weak beam through one body, into the next and no further', () => {
      const line = [-6, -9, -12].map(z => r.enemies.add(0, z));
      hold(HOLD.low);
      expect(r.weapons.lance.fired.beams).toEqual([1, 0, 0]);
      expect(line.map(d => beamHits(d).length)).toEqual([1, 1, 0]);
      expect(beamHits(line[0]!)[0]!.amount).toBeCloseTo(WEAPONS.lance.damage * LOW.damage, 5);
      expect(cell()).toBe(WEAPONS.lance.magSize - LOW.cost);
      expect(r.record.sounds).not.toContain('lance_thunder');
    });

    it('let go at the second: through four and into the fifth', () => {
      const line = [-5, -7, -9, -11, -13, -15, -17].map(z => r.enemies.add(0, z));
      hold(HOLD.mid);
      expect(r.weapons.lance.fired.beams).toEqual([0, 1, 0]);
      expect(line.map(d => beamHits(d).length)).toEqual([1, 1, 1, 1, 1, 0, 0]);
      expect(beamHits(line[4]!)[0]!.amount).toBeCloseTo(WEAPONS.lance.damage * MID.damage, 5);
      expect(cell()).toBe(WEAPONS.lance.magSize - MID.cost);
    });

    it('a full charge goes through everyone in line at full damage, and severs', () => {
      const line = Array.from({ length: 20 }, (_, i) => r.enemies.add(0, -5 - i * 2));
      hold(HOLD.full);
      r.run(0.2);
      expect(r.weapons.lance.sweeping).toBe(false);
      expect(r.weapons.lance.fired.beams).toEqual([0, 0, 1]);
      expect(line.map(d => beamHits(d).length)).toEqual(line.map(() => 1));
      for (const d of line) expect(beamHits(d)[0]!.amount).toBe(WEAPONS.lance.damage);
      expect(beamHits(line[0]!)[0]!.severMult).toBeGreaterThanOrEqual(1000);
      expect(cell()).toBe(WEAPONS.lance.magSize - FULL.cost);
      expect(r.record.sounds).toContain('railgun_fire');
      expect(r.record.sounds).toContain('lance_thunder');
    });

    it.each([30, 60, 144])('a full beam strikes a few bodies a frame, never one of them twice, at %s fps', fps => {
      // Nobody here dies, so every body is one the beam has to pass over on its next ray.
      const line = Array.from({ length: 20 }, (_, i) => r.enemies.add(0, -5 - i * 1.1));
      r.input.simulate('fire', true);
      r.run(HOLD.full, fps);
      r.input.simulate('fire', false);
      const perFrame: number[] = [];
      let seen = 0;
      for (let f = 0; f < 12; f++) {
        r.run(1 / fps, fps);
        const now = line.reduce((n, d) => n + beamHits(d).length, 0);
        perFrame.push(now - seen);
        seen = now;
      }
      expect(Math.max(...perFrame)).toBe(T.sweep.perFrame);
      expect(perFrame.filter(n => n > 0).length).toBe(Math.ceil(20 / T.sweep.perFrame));
      expect(line.map(d => beamHits(d).length)).toEqual(line.map(() => 1));
      // Nearest first: each body was struck no later than the one behind it.
      expect(r.weapons.lance.sweeping).toBe(false);
      expect(r.weapons.lance.chain.pending + r.weapons.lance.fired.bursts).toBe(20);
    });

    it('a beam that a perk bounces or blows up at its end is one ray, as it always was', () => {
      const line = Array.from({ length: 9 }, (_, i) => r.enemies.add(0, -5 - i * 2));
      r.weapons.modifiers.explosiveRounds = true;
      hold(HOLD.full);
      expect(line.map(d => beamHits(d).length)).toEqual(line.map(() => 1));
      expect(r.weapons.lance.sweeping).toBe(false);
      r.weapons.modifiers.explosiveRounds = false;
    });

    it('a sweep goes on through the walls it is allowed, counted across its rays', () => {
      // Four bodies, a wall, four more, a second wall, two more, a third wall and one behind it.
      r.wall(-14, 0.6);
      r.wall(-24, 1);
      r.wall(-30, 0.3);
      const line = [-5, -7, -9, -11, -16, -18, -20, -22, -26, -28, -33].map(z => r.enemies.add(0, z));
      hold(HOLD.full);
      r.run(0.2);
      expect(line.map(d => beamHits(d).length)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0]);
    });

    it('a full beam is not stopped by armour; a weaker one is', () => {
      const plated = [-6, -9].map(z => r.enemies.add(0, z));
      for (const d of plated) d.armor = 100;
      hold(HOLD.mid);
      // Stopped on the plate, as any round that is not armour-piercing: nothing lands on the man.
      expect(plated[0]!.health).toBe(plated[0]!.maxHealth);
      r.run(1);
      hold(HOLD.full);
      expect(plated.map(d => d.maxHealth - d.health)).toEqual([WEAPONS.lance.damage, WEAPONS.lance.damage]);
      expect(beamHits(plated[0]!).at(-1)!.armorPiercing).toBe(true);
    });

    it('a full shot shoves the player back and holds the world on what it struck', () => {
      const stops: number[] = [];
      const time = r.ctx.time;
      const hitStop = time.hitStop.bind(time);
      time.hitStop = (seconds: number, scale?: number) => { stops.push(seconds); hitStop(seconds, scale); };
      hold(HOLD.full);
      expect(stops.length).toBe(0);
      expect(r.player.velocity.z).toBeCloseTo(T.push, 5);
      r.run(1);
      r.player.velocity.set(0, 0, 0);
      r.enemies.add(0, -8);
      hold(HOLD.full);
      expect(stops).toEqual([HIT_STOP.lanceShot]);
      expect(r.player.velocity.z).toBeCloseTo(T.push, 5);
    });

    it('right click lets the charge go: nothing fired, nothing spent', () => {
      const d = r.enemies.add(0, -8);
      r.input.simulate('fire', true);
      r.run(0.6);
      expect(r.weapons.charge).toBeGreaterThan(0.3);
      r.input.simulate('aim', true);
      r.run(1 / 60);
      r.input.simulate('aim', false);
      expect(r.weapons.charge).toBe(0);
      expect(r.record.sounds).toContain('railgun_fizzle');
      // Still holding the trigger: it does not start again by itself.
      r.run(1.5);
      r.input.simulate('fire', false);
      r.run(0.1);
      expect(d.hits.length).toBe(0);
      expect(cell()).toBe(WEAPONS.lance.magSize);
      expect(r.weapons.lance.fired.balls).toBe(0);
    });

    it('a weapon switch lets the charge go too', () => {
      r.input.simulate('fire', true);
      r.run(0.8);
      expect(r.weapons.charge).toBeGreaterThan(0.5);
      r.tap('weapon1');
      expect(r.weapons.current).toBe('smg');
      expect(r.weapons.lance.held).toBe(false);
      r.input.simulate('fire', false);
      r.run(0.5);
      expect(r.weapons.ammo('lance').mag).toBe(WEAPONS.lance.magSize);
      expect(r.weapons.lance.fired.beams).toEqual([0, 0, 0]);
    });

    it('the cell caps the charge: two left is a second-stage beam, one left is a ball', () => {
      const line = [-6, -9].map(z => r.enemies.add(0, z));
      r.weapons.ammo('lance').mag = FULL.cost - 1;
      r.weapons.ammo('lance').reserve = 0;
      r.input.simulate('fire', true);
      r.run(2);
      expect(r.weapons.charge).toBe(MID.at);
      r.input.simulate('fire', false);
      r.run(1 / 60);
      expect(r.weapons.lance.fired.beams).toEqual([0, 1, 0]);
      expect(beamHits(line[0]!)[0]!.amount).toBeCloseTo(WEAPONS.lance.damage * MID.damage, 5);
      expect(cell()).toBe(FULL.cost - 1 - MID.cost);

      r.weapons.ammo('lance').mag = 1;
      r.run(1);
      r.input.simulate('fire', true);
      r.run(2);
      expect(r.weapons.charge).toBe(0);
      r.input.simulate('fire', false);
      r.run(1 / 60);
      expect(r.weapons.lance.fired.balls).toBe(1);
      expect(cell()).toBe(0);
    });

    it('a bottomless magazine charges to full on an empty cell and spends nothing', () => {
      r.weapons.modifiers.bottomlessMag = true;
      r.weapons.ammo('lance').mag = 0;
      const d = r.enemies.add(0, -8);
      hold(HOLD.full);
      expect(beamHits(d).length).toBe(1);
      expect(cell()).toBe(0);
    });

    it('a hold begun during the wait after a shot charges as soon as the wait is over', () => {
      const d = r.enemies.add(0, -8);
      hold(HOLD.full);
      expect(beamHits(d).length).toBe(1);
      r.input.simulate('fire', true);
      r.run(T.recover + HOLD.full);
      expect(r.weapons.charge).toBe(1);
      r.input.simulate('fire', false);
      r.run(1 / 60);
      expect(beamHits(d).length).toBe(2);
    });

    it('does not leave its list on the shot every gun shares', () => {
      const d = r.enemies.add(0, -8);
      hold(HOLD.full);
      r.run(1);
      const before = r.record.explosions;
      r.tap('weapon1');
      r.run(0.5);
      r.input.simulate('fire', true);
      r.run(0.3);
      r.input.simulate('fire', false);
      r.run(1);
      expect(d.hits.filter(h => h.source === 'smg').length).toBeGreaterThan(1);
      // The SMG's rounds struck a body and booked nothing.
      expect(r.record.explosions).toBe(before);
      expect(r.weapons.lance.chain.pending).toBe(0);
    });

    it('a sweep strikes corpses on its first ray only, never its own kills of a frame before', () => {
      Array.from({ length: 12 }, (_, i) => r.enemies.add(0, -5 - i * 2));
      let ray = 0;
      const corpseRays: number[] = [];
      const fireRay = r.combat.fireRay.bind(r.combat);
      r.combat.fireRay = (o, d, spec) => {
        if (spec.source === 'lance') ray++;
        return fireRay(o, d, spec);
      };
      const gore = r.ctx.gore;
      r.ctx.gore = new Proxy(gore, {
        get: (t, k) => (k === 'raycastCorpses' ? () => { corpseRays.push(ray); return null; } : Reflect.get(t, k)),
      });
      hold(HOLD.full);
      r.run(0.3);
      r.ctx.gore = gore;
      expect(ray).toBeGreaterThan(2);
      expect(corpseRays.length).toBeGreaterThan(0);
      expect(corpseRays.every(n => n === 1)).toBe(true);
      // And the flag is off the shot every gun shares.
      expect((r.weapons as unknown as { shot: { skipCorpses?: boolean } }).shot.skipCorpses).toBeUndefined();
    });
  });

  describe('the FOV punch', () => {
    /** A camera with a field of view, recording every zoom the Lance asks of it. */
    const camera = () => {
      const zooms: (number | null)[] = [];
      r.ctx.camera = { addTrauma() {}, kick() {}, fovPunch() {}, fov: 90, setZoom: (f: number | null) => zooms.push(f) } as unknown as typeof r.ctx.camera;
      return zooms;
    };

    it('a full beam throws the view wide from the narrowed charge, then lets go where it started', () => {
      const zooms = camera();
      r.input.simulate('fire', true);
      r.run(HOLD.full);
      const charged = zooms[zooms.length - 1] as number;
      expect(charged).toBeCloseTo(90 - T.fovPull, 5);
      const before = zooms.length;
      r.input.simulate('fire', false);
      r.run(1 / 60);
      const after = zooms.slice(before);
      // The frame of the shot ends wide by the row's punch, not let go to the free view, which would hide it.
      expect(after[after.length - 1]).toBeCloseTo(90 + WEAPONS.lance.fovPunch, 5);
      r.run(T.punchTime + 0.05);
      const rest = zooms.slice(before);
      expect(rest[rest.length - 1]).toBe(null);
      const out = rest.filter((z): z is number => z !== null);
      for (let i = 1; i < out.length; i++) expect(out[i]!).toBeLessThanOrEqual(out[i - 1]! + 1e-9);
      expect(out[out.length - 1]!).toBeLessThan(91);
    });

    it('a weaker beam punches by its weight; a ball not at all', () => {
      const zooms = camera();
      click();
      expect(zooms.length).toBe(0);
      r.run(0.5);
      hold(HOLD.low);
      expect(Math.max(...zooms.filter((z): z is number => z !== null))).toBeCloseTo(90 + WEAPONS.lance.fovPunch * LOW.weight, 5);
    });

    it('a switch during the punch lets go of the view at once', () => {
      const zooms = camera();
      hold(HOLD.full);
      r.tap('weapon1');
      expect(zooms[zooms.length - 1]).toBe(null);
      const n = zooms.length;
      r.run(0.5);
      expect(zooms.slice(n).every(z => z === null)).toBe(true);
    });
  });

  describe('the bursts', () => {
    /** Steps a frame at a time until the chain is spent, and returns the world time and place of each burst. */
    const ripple = (fps = 60, seconds = 2.5) => {
      const out: { t: number; z: number; frame: number }[] = [];
      const t0 = r.ctx.time.elapsed;
      for (let f = 0; f < seconds * fps; f++) {
        const n = r.record.blasts.length;
        r.run(1 / fps, fps);
        for (let i = n; i < r.record.blasts.length; i++) out.push({ t: r.ctx.time.elapsed - t0, z: r.record.blasts[i]!.z, frame: f });
      }
      return out;
    };

    it.each([30, 60, 144])('one at every body the beam struck, nearest first, a gap apart, at %s fps', fps => {
      const line = Array.from({ length: 20 }, (_, i) => r.enemies.add(0, -5 - i * 2));
      r.input.simulate('fire', true);
      r.run(HOLD.full, fps);
      r.input.simulate('fire', false);
      const bursts = ripple(fps);
      expect(bursts.length).toBe(20);
      expect(r.weapons.lance.fired.bursts).toBe(20);
      // Where each body was struck: the near side of its chest.
      bursts.forEach((b, i) => expect(b.z).toBeCloseTo(line[i]!.position.z + 0.55, 1));
      // None on the frame of the shot, and the world clock between two is the gap, give or take a frame.
      expect(bursts[0]!.t).toBeGreaterThanOrEqual(T.chain.first - 1e-6);
      for (let i = 1; i < bursts.length; i++) {
        const gap = bursts[i]!.t - bursts[i - 1]!.t;
        expect(gap).toBeGreaterThan(-1e-9);
        expect(gap).toBeLessThanOrEqual(T.chain.gap + 1 / fps + 1e-6);
      }
      const span = bursts[19]!.t - bursts[0]!.t;
      expect(span).toBeGreaterThan(19 * T.chain.gap - 1 / fps - 1e-6);
      expect(span).toBeLessThan(19 * T.chain.gap + 2 / fps);
      // Never more than a few in one frame.
      const perFrame = new Map<number, number>();
      for (const b of bursts) perFrame.set(b.frame, (perFrame.get(b.frame) ?? 0) + 1);
      expect(Math.max(...perFrame.values())).toBeLessThanOrEqual(T.chain.perFrame);
    });

    it('after a hitch as long as the whole chain, still only a few a frame, and the rest follow', () => {
      Array.from({ length: 12 }, (_, i) => r.enemies.add(0, -5 - i * 2));
      hold(HOLD.full);
      r.run(0.1);
      expect(r.weapons.lance.sweeping).toBe(false);
      expect(r.weapons.lance.chain.pending).toBe(12);
      // The world runs on for a second with nobody to set them off: all twelve are overdue.
      r.ctx.time.clearScales();
      for (let i = 0; i < 20; i++) r.ctx.time.tick(1 / 20);
      const perFrame: number[] = [];
      for (let f = 0; f < 8; f++) {
        const n = r.record.explosions;
        r.run(1 / 60);
        perFrame.push(r.record.explosions - n);
      }
      expect(perFrame).toEqual([2, 2, 2, 2, 2, 2, 0, 0]);
      // Still nearest first.
      r.record.blasts.forEach((b, i) => expect(b.z).toBeCloseTo(-5 - i * 2 + 0.55, 1));
    });

    it('hurt whoever stands beside the line, at the size and strength of the stage', () => {
      r.enemies.add(0, -10);
      const beside = r.enemies.add(1.5, -10);
      const outside = r.enemies.add(4.5, -10);
      hold(HOLD.full);
      r.run(0.5);
      expect(beamHits(beside).length).toBe(0);
      expect(burstHits(beside).length).toBe(1);
      const hit = burstHits(beside)[0]!;
      expect(hit.source).toBe('lance');
      expect(hit.blastKind).toBe('plasmaBurst');
      expect(hit.amount).toBeGreaterThan(FULL.burstDamage * 0.5);
      expect(hit.amount).toBeLessThan(FULL.burstDamage);
      expect(outside.hits.length).toBe(0);

      // The first stage's burst is smaller: the same neighbour is out of its reach at 2 m.
      r.reset();
      r.weapons.give('lance');
      r.tap('weapon7');
      r.run(0.5);
      r.enemies.add(0, -10);
      const near = r.enemies.add(1.2, -10);
      const wide = r.enemies.add(2.2, -10);
      hold(HOLD.low);
      r.run(0.5);
      expect(burstHits(near).length).toBe(1);
      expect(burstHits(near)[0]!.amount).toBeLessThanOrEqual(LOW.burstDamage);
      expect(burstHits(wide).length).toBe(0);
    });

    it('do nothing to the player who fired them', () => {
      r.enemies.add(0, -1.5);
      hold(HOLD.full);
      r.run(0.5);
      expect(r.record.explosions).toBe(1);
      expect(r.player.damage.length).toBe(0);
    });

    it('scale with the damage perks in force when the beam was fired', () => {
      r.enemies.add(0, -10);
      const beside = r.enemies.add(1.5, -10);
      r.weapons.modifiers.damage = 2;
      hold(HOLD.full);
      r.weapons.modifiers.damage = 1;
      r.run(0.5);
      expect(burstHits(beside)[0]!.amount).toBeGreaterThan(FULL.burstDamage);
    });

    it('still go off after the gun is put away', () => {
      Array.from({ length: 6 }, (_, i) => r.enemies.add(0, -5 - i * 2));
      hold(HOLD.full);
      r.tap('weapon1');
      r.run(1);
      expect(r.weapons.current).toBe('smg');
      expect(r.record.explosions).toBe(6);
    });

    it('are dropped by a new run', () => {
      Array.from({ length: 6 }, (_, i) => r.enemies.add(0, -5 - i * 2));
      hold(HOLD.full);
      expect(r.weapons.lance.chain.pending).toBeGreaterThan(0);
      r.weapons.reset();
      expect(r.weapons.lance.chain.pending).toBe(0);
    });
  });

  describe('walls', () => {
    it('a full beam goes through two walls and bursts on the bodies beyond; a weaker one stops at the first', () => {
      r.wall(-10, 0.6);
      r.wall(-20, 1.5);
      r.wall(-30, 0.3);
      const line = [-6, -15, -25, -35].map(z => r.enemies.add(0, z));
      hold(HOLD.full);
      r.run(0.6);
      expect(line.map(d => beamHits(d).length)).toEqual([1, 1, 1, 0]);
      expect(r.record.blasts.length).toBe(3);
      [-5.45, -14.45, -24.45].forEach((z, i) => expect(r.record.blasts[i]!.z).toBeCloseTo(z, 1));

      r.reset();
      r.weapons.give('lance');
      r.tap('weapon7');
      r.run(0.5);
      r.wall(-10, 0.3);
      const near = r.enemies.add(0, -6);
      const behind = r.enemies.add(0, -15);
      hold(HOLD.mid);
      r.run(0.6);
      expect(beamHits(near).length).toBe(1);
      expect(behind.hits.length).toBe(0);
    });

    it('a burst behind a wall does not reach through it', () => {
      r.wall(-10, 0.6);
      const front = r.enemies.add(0, -9);
      const behind = r.enemies.add(0, -11.7);
      r.weapons.ammo('lance').mag = WEAPONS.lance.magSize;
      hold(HOLD.low);
      r.run(0.5);
      // The weak beam stops in the wall. Its one burst is on the near body, and the wall shelters the far one.
      expect(beamHits(front).length).toBe(1);
      expect(behind.hits.length).toBe(0);
    });
  });
});
