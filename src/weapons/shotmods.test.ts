/**
 * The shotgun and Judge mods: the Deuce's quad barrels and speed loader, the pump's choke, the Judge's extended hammer and
 * comfort grip. Each is a shop row, a lab row and a patch over its gun's row (mods.ts); the two pairs stack.
 */
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ModId, ShotSpec } from '../core/gameplay';
import { MOD_WARES } from '../contracts/shop/data';
import { modCheat } from '../lab/mods';
import { WEAPONS } from './data';
import { MODS, MOD_ORDER, moddedDef } from './mods';
import { makeRange, type Range } from './testkit';

const NEW: readonly ModId[] = ['deuceQuad', 'deuceLoader', 'shotgunChoke', 'judgeHammer', 'judgeGrip'];
const D = WEAPONS.deuce;
const shellsIn = (def: { reloadFoley: readonly (readonly [number, string])[] }) => def.reloadFoley.filter(c => c[1] === 'reload_shell_in').length;

let r: Range;
beforeEach(async () => {
  r = await makeRange();
  r.reset();
});

function fit(...ids: ModId[]): void {
  for (const id of ids) modCheat(r.weapons, id, 'fit');
}

/** Counts the pellets fired from now on, and their angles off the crosshair. */
function pellets(): number[] {
  const angles: number[] = [];
  const fire = r.combat.fireRay.bind(r.combat);
  r.combat.fireRay = (o: THREE.Vector3, d: THREE.Vector3, s: ShotSpec) => {
    angles.push(d.angleTo(r.player.forward));
    return fire(o, d, s);
  };
  return angles;
}

describe('the new mods are sold and in the lab', () => {
  it('each has a shop row with a price, a wave and a line, and a row in MOD_ORDER', () => {
    for (const id of NEW) {
      expect(MOD_ORDER, id).toContain(id);
      expect(MOD_WARES[id].price, id).toBeGreaterThan(0);
      expect(MOD_WARES[id].lore.length, id).toBeGreaterThan(40);
    }
    expect(MODS.deuceQuad.slot).not.toBe(MODS.deuceLoader.slot);
    expect(MODS.judgeHammer.slot).not.toBe(MODS.judgeGrip.slot);
  });

  it('the lab fits the quad and the loader together, and takes one off without the other', () => {
    fit('deuceQuad', 'deuceLoader');
    expect(r.weapons.fitted.has('deuceQuad')).toBe(true);
    expect(r.weapons.fitted.has('deuceLoader')).toBe(true);
    fit('deuceQuad');
    expect(r.weapons.fitted.has('deuceQuad')).toBe(false);
    expect(r.weapons.fitted.has('deuceLoader')).toBe(true);
  });
});

describe('the Deuce reloads', () => {
  it('a shell a hand plain (1.5 s, two), all four singly on the quad, two at a time on the speed loader', () => {
    const quad = moddedDef('deuce', new Set(['deuceQuad']));
    const loader = moddedDef('deuce', new Set(['deuceLoader']));
    const both = moddedDef('deuce', new Set(['deuceQuad', 'deuceLoader']));
    expect(D.reloadTime).toBeCloseTo(1.5, 6);
    expect(shellsIn(D)).toBe(2);
    expect(quad.magSize).toBe(4);
    expect(shellsIn(quad)).toBe(4);
    expect(quad.reloadTime).toBeCloseTo(1.98, 6);
    // Plain with the loader: one hand in and that is it.
    expect(loader.magSize).toBe(2);
    expect(shellsIn(loader)).toBe(1);
    expect(loader.reloadTime).toBeLessThan(D.reloadTime);
    // The quad with the loader reloads in the plain double's time.
    expect(both.magSize).toBe(4);
    expect(shellsIn(both)).toBe(2);
    expect(both.reloadTime).toBeCloseTo(D.reloadTime, 6);
    // Fitted in the other order it is the same gun.
    expect(moddedDef('deuce', new Set(['deuceLoader', 'deuceQuad']))).toEqual(both);
  });
});

describe('the quad barrels', () => {
  it('fire a barrel a left click and every loaded barrel on a right click, each heard, and shove harder', () => {
    fit('deuceQuad');
    r.weapons.give('deuce');
    r.weapons.switchTo('deuce');
    r.run(0.6);
    const a = r.weapons.ammo('deuce');
    expect(a.magSize).toBe(4);
    r.tap('reload');
    r.run(moddedDef('deuce', r.weapons.fitted).reloadTime + 0.2);
    expect(a.mag).toBe(4);

    const shots = pellets();
    const P = r.player;
    const pull = (button: 'fire' | 'aim') => {
      shots.length = 0;
      r.record.sounds.length = 0;
      P.velocity.set(0, 0, 0);
      r.tap(button);
      r.run(1 / 60);
    };
    pull('fire');
    expect(shots).toHaveLength(D.pellets);
    expect(a.mag).toBe(3);
    r.run(D.interval + 0.05);
    P.forward.set(0, 0, -1);
    P.grounded = false;
    pull('aim');
    // The three left go together: their pellets, the double blast three times, two barrels' worth of push past the first.
    expect(shots).toHaveLength(D.pellets * 3);
    expect(a.mag).toBe(0);
    expect(r.record.sounds.filter(id => id === 'dbshotgun_shot')).toHaveLength(3);
    expect(P.velocity.z).toBeCloseTo(MODS.deuceQuad.patch.altBoth!.push * 2, 5);
    P.grounded = true;
  });
});

describe('the choke', () => {
  it('holds the pump\'s pellets inside a tighter cone', () => {
    const choked = moddedDef('shotgun', new Set(['shotgunChoke']));
    expect(choked.spread).toBeLessThan(WEAPONS.shotgun.spread * 0.7);
    fit('shotgunChoke');
    r.weapons.switchTo('shotgun');
    r.run(0.6);
    const shots = pellets();
    for (let i = 0; i < 4; i++) {
      r.tap('fire');
      r.run(WEAPONS.shotgun.interval + 0.05);
    }
    expect(shots.length).toBe(WEAPONS.shotgun.pellets * 4);
    expect(Math.max(...shots)).toBeLessThanOrEqual(choked.spread + 1e-6);
    expect(Math.max(...shots)).toBeGreaterThan(choked.spread * 0.3);
  });
});

describe('the Judge\'s hammer and grip', () => {
  const T = WEAPONS.judge.altFan!;
  beforeEach(() => {
    r.weapons.setLoadout(['judge'], 0);
    r.run(0.6);
  });
  const ticks = () => r.record.sounds.filter(s => s === 'judge_fan_tick').length;

  it('stack: a bar every 0.28 s and up to six, either fitted first', () => {
    const both = moddedDef('judge', new Set(['judgeHammer', 'judgeGrip']));
    expect(both.altFan!.perBar).toBeCloseTo(0.28, 6);
    expect(both.altFan!.bars).toBe(6);
    expect(moddedDef('judge', new Set(['judgeHammer'])).altFan!.bars).toBe(T.bars);
    expect(moddedDef('judge', new Set(['judgeGrip'])).altFan!.perBar).toBe(T.perBar);
  });

  it('the extended hammer charges a bar faster', () => {
    fit('judgeHammer');
    r.player.forward.set(-1, 0, -1).normalize();
    r.input.simulate('aim', true);
    r.run(0.3);
    expect(ticks()).toBe(1);
    r.run(0.5);
    expect(ticks()).toBe(2);
  });

  it('the comfort grip charges all six chambers and fans six', () => {
    fit('judgeGrip');
    r.player.forward.set(-1, 0, -1).normalize();
    const shots = pellets();
    r.input.simulate('aim', true);
    r.run(T.perBar * 7);
    expect(ticks()).toBe(6);
    expect(r.weapons.charge).toBeCloseTo(1, 5);
    r.input.simulate('aim', false);
    r.run(1);
    expect(shots).toHaveLength(6);
    expect(r.weapons.ammo('judge').mag).toBe(0);
  });
});
