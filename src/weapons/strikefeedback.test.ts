/**
 * What a round tells its shooter when the damage itself sets off a blast (a struck tank on a Burner or Rocketeer, a Skitter
 * or Bomber going up: enemies/damage.ts `blowTank`). The blast's own strikes fill the same scratch options the round was
 * given, so the round must have read its own before the damage. It lost its sound, blood, marker and hit-stop once.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { EnemyInstance } from '../core/gameplay';
import { HIT_STOP } from './data';
import { makeRange, type Range } from './testkit';

const UP = new THREE.Vector3(0, 0, 1);
const IN = new THREE.Vector3(0, 0, -1);

interface Heard {
  marks: string[];
  stops: number[];
  bloodHits: number;
  mists: number;
}

function listen(r: Range): Heard {
  const heard: Heard = { marks: [], stops: [], bloodHits: 0, mists: 0 };
  r.ctx.hud = { hitMarker: (k: string) => heard.marks.push(k), feed() {} } as never;
  // What the round asks for: a blast with a hit of its own stops first, and `Feel` drops a second stop that close behind.
  const feel = (r.combat as never as { feel: { stop(seconds: number): void } }).feel;
  feel.stop = (seconds: number) => void heard.stops.push(seconds);
  const fx = r.ctx.fx;
  r.ctx.fx = new Proxy(fx, {
    get: (t, k) => {
      if (k === 'bloodHit') return () => void heard.bloodHits++;
      if (k === 'bloodMist') return () => void heard.mists++;
      return Reflect.get(t, k);
    },
  });
  return heard;
}

/** The damage on `tank` sets off a blast before it returns, as a struck tank does, and the blast catches a bystander. */
function rigTank(r: Range, tank: EnemyInstance): { blew: () => boolean } {
  const real = r.enemies.applyDamage.bind(r.enemies);
  let nested = false;
  r.enemies.applyDamage = (e, d) => {
    if (e === tank && !nested) {
      nested = true;
      r.ctx.combat.explode(tank.center, { radius: 5, damage: 50, kind: 'barrel', source: 'smg', team: 'player', selfDamage: 0 });
    }
    return real(e, d);
  };
  return { blew: () => nested };
}

describe('a round that sets off a blast inside its own damage keeps its own feedback', () => {
  it('a body hit: its sound, its blood and its own marker, as with no blast', async () => {
    const r = await makeRange();
    const heard = listen(r);
    const a = r.enemies.add(0, -10, 100);
    const bystander = r.enemies.add(1.5, -10, 100000);
    const tank = rigTank(r, a);
    r.record.sounds.length = 0;
    const o = r.combat.strikeOptions('bullet', 'smg');
    r.combat.strike(a, a.center, UP, IN, undefined, 'chest', 10, o);
    expect(tank.blew()).toBe(true);
    expect((bystander as never as { hits: unknown[] }).hits.length).toBe(1);
    expect(r.record.sounds).toContain('bullet_body');
    // The round's own marker comes last: the blast's (inside the damage) is first.
    expect(heard.marks[heard.marks.length - 1]).toBe('body');
    // The blast draws blood on both bodies in its reach; the round draws its own on the body it hit.
    expect(heard.bloodHits).toBe(3);
  });

  it('a killing headshot: the headshot sounds, the mist, the kill marker and the headshot stop', async () => {
    const r = await makeRange();
    const heard = listen(r);
    const a = r.enemies.add(0, -10, 15);
    r.enemies.add(1.5, -10, 100000);
    rigTank(r, a);
    r.record.sounds.length = 0;
    const o = r.combat.strikeOptions('bullet', 'smg');
    const res = r.combat.strike(a, a.center, UP, IN, 4, 'head', 10, o);
    expect(res.killed).toBe(true);
    expect(r.record.sounds).toContain('headshot');
    expect(r.record.sounds).toContain('headshot_puff');
    expect(heard.mists).toBe(1);
    expect(heard.marks[heard.marks.length - 1]).toBe('kill');
    expect(heard.stops).toContain(HIT_STOP.headshotKill);
  });

  it('a kill with a kill stop (the shotgun) still stops', async () => {
    const r = await makeRange();
    const heard = listen(r);
    const a = r.enemies.add(0, -10, 5);
    r.enemies.add(1.5, -10, 100000);
    rigTank(r, a);
    const o = r.combat.strikeOptions('pellet', 'shotgun');
    o.killStop = 0.07;
    r.combat.strike(a, a.center, UP, IN, undefined, 'chest', 10, o);
    expect(heard.stops).toContain(0.07);
  });

  it('a blast\'s own strikes stay quiet: one marker for the blast, no body sound per body', async () => {
    const r = await makeRange();
    const heard = listen(r);
    r.enemies.add(0, -10, 100000);
    r.enemies.add(1, -10, 100000);
    r.record.sounds.length = 0;
    r.ctx.combat.explode(new THREE.Vector3(0, 1.2, -10), { radius: 5, damage: 50, kind: 'barrel', source: 'smg', team: 'player', selfDamage: 0 });
    expect(r.record.sounds).not.toContain('bullet_body');
    expect(heard.marks).toEqual(['body']);
  });

  it('control: with no blast the same hit says the same', async () => {
    const r = await makeRange();
    const heard = listen(r);
    const a = r.enemies.add(0, -10, 100);
    r.record.sounds.length = 0;
    const o = r.combat.strikeOptions('bullet', 'smg');
    r.combat.strike(a, a.center, UP, IN, undefined, 'chest', 10, o);
    expect(heard.marks).toEqual(['body']);
    expect(r.record.sounds).toContain('bullet_body');
    expect(heard.bloodHits).toBe(1);
  });
});
