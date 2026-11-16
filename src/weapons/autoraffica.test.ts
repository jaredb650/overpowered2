/**
 * The Autoraffica (weapons-update plan section 14): always suppressed; a three-round burst a pull, or hold R for the smart aim,
 * which locks the head nearest the crosshair inside its circle, in sight: locked, a held trigger is full auto into the heads in
 * the circle one after another; unlocked, it is semi-auto.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { CACHE_ORDER } from '../progression/data';
import { MOD_WARES, WEAPON_WARES } from '../contracts/shop/data';
import { STARTING_WEAPONS, WEAPONS } from './data';
import { familyOfSlot } from './families';
import { AMMO_GUNS, MODS, MOD_ORDER } from './mods';
import { makeRange, type Dummy, type Range } from './testkit';

const A = WEAPONS.autoraffica;
const B = A.pullBurst!;
const S = A.smart!;
let r: Range;
let callouts: string[];

beforeEach(async () => {
  r = await makeRange();
  r.reset();
  callouts = [];
  (r.ctx.hud as { callout?: (t: string) => void }).callout = t => callouts.push(t);
  r.weapons.give('autoraffica');
  r.weapons.switchTo('autoraffica');
  r.run(0.6);
  expect(r.weapons.current).toBe('autoraffica');
});

/** R held for `seconds`, then let go. */
function holdR(seconds: number): void {
  r.input.simulate('reload', true);
  r.run(seconds);
  r.input.simulate('reload', false);
  r.run(1 / 60);
}

/** Switched on with R, the crosshair where the test has put it first. */
function smartOn(): void {
  holdR(S.hold + 0.05);
  expect(r.weapons.smartAim.on).toBe(true);
}

/** The crosshair on a point beside his head: `off` metres to his right, at his head's height. */
function lookNear(d: Dummy, off = 0): void {
  r.player.forward.set(d.position.x + off, d.position.y + 1.65, d.position.z).sub(r.player.eye).normalize();
}

/** The crosshair on his chest. */
function lookAtBody(d: Dummy): void {
  r.player.forward.set(d.position.x, d.position.y + 1, d.position.z).sub(r.player.eye).normalize();
}

const heads = (d: Dummy) => d.hits.filter(h => h.source === 'autoraffica' && h.region === 'head').length;
const locked = () => (r.weapons.smartAim as unknown as { target: Dummy | null }).target;

describe('the Autoraffica on paper', () => {
  it('is on key 6 with the pistols, its own unlock from its own cache, sold in the shop with AP and HP rounds', () => {
    expect(familyOfSlot(6)).toContain('autoraffica');
    expect(A.base).toBe('judge');
    expect(STARTING_WEAPONS).not.toContain('autoraffica');
    expect(CACHE_ORDER.filter(id => id === 'autoraffica')).toHaveLength(1);
    expect(WEAPON_WARES.autoraffica!.price).toBeGreaterThan(0);
    expect(WEAPON_WARES.autoraffica!.wave).toBeGreaterThan(0);
    expect(AMMO_GUNS).toContain('autoraffica');
    expect(MODS.autorafficaAp.slot).toBe('ammo');
    expect(MODS.autorafficaHp.slot).toBe('ammo');
    expect(MOD_WARES.autorafficaAp.lore.length).toBeGreaterThan(40);
  });

  it('is always suppressed: the can is the gun, and no mod changes its report or its flash', () => {
    expect(A.muzzle).toBe('suppressed');
    expect(A.sounds[0]!.id).toBe('autoraffica_shot');
    for (const id of MOD_ORDER) {
      if (MODS[id].weapon !== 'autoraffica') continue;
      expect(MODS[id].patch.muzzle, id).toBeUndefined();
      expect(MODS[id].patch.sounds, id).toBeUndefined();
    }
  });
});

describe('the extended magazine', () => {
  it('holds 30 where the gun holds 21: a reload fills it, and taking it off puts the rounds over 21 back in the reserve', () => {
    const ext = MODS.autorafficaMag;
    expect(ext.weapon).toBe('autoraffica');
    expect(MOD_ORDER).toContain('autorafficaMag');
    expect(MOD_WARES.autorafficaMag.price).toBeGreaterThan(0);
    expect(MOD_WARES.autorafficaMag.wave).toBeGreaterThan(0);
    r.weapons.grantMod('autorafficaMag');
    r.weapons.fitMod('autorafficaMag', true);
    const a = r.weapons.ammo('autoraffica');
    expect(a.magSize).toBe(30);
    expect(a.mag).toBe(A.magSize);
    r.tap('reload');
    r.run(ext.patch.reloadTime! + 0.2);
    expect(a.mag).toBe(30);
    const total = a.mag + a.reserve;
    r.weapons.fitMod('autorafficaMag', false);
    expect(a.magSize).toBe(A.magSize);
    expect(a.mag).toBe(A.magSize);
    expect(a.mag + a.reserve).toBe(total);
  });
});

describe('the burst', () => {
  it('fires three rounds a pull at its rate, then waits; a pull inside the wait fires nothing more', () => {
    const d = r.enemies.add(0, -10);
    lookAtBody(d);
    r.tap('fire');
    r.run(A.interval * B.rounds);
    expect(d.hits.length).toBe(B.rounds);
    expect(r.weapons.ammo('autoraffica').mag).toBe(A.magSize - B.rounds);
    expect(r.record.sounds.filter(s => s === 'autoraffica_shot').length).toBe(B.rounds);
    // Holding the trigger is still one pull.
    r.input.simulate('fire', true);
    r.run(0.05);
    expect(d.hits.length).toBe(B.rounds);
    r.input.simulate('fire', false);
    r.run(B.recover + 0.4);
    expect(d.hits.length).toBe(B.rounds);
    r.tap('fire');
    r.run(A.interval * B.rounds);
    expect(d.hits.length).toBe(B.rounds * 2);
  });

  it('cuts a burst short when the magazine runs dry', () => {
    const d = r.enemies.add(0, -10);
    lookAtBody(d);
    r.weapons.ammo('autoraffica').mag = 2;
    r.tap('fire');
    r.run(0.3);
    expect(d.hits.length).toBe(2);
  });
});

describe('smart aim', () => {
  it('hold R switches it on and off with a callout; a tap of R reloads', () => {
    expect(r.weapons.smartAim.on).toBe(false);
    smartOn();
    expect(callouts).toEqual(['SMART']);
    expect(r.weapons.ammoMode).toBe('SMART');
    r.weapons.ammo('autoraffica').mag = 5;
    holdR(0.1);
    expect(r.weapons.reloading).toBe(true);
    expect(r.weapons.smartAim.on).toBe(true);
    r.run(A.reloadTime + 0.1);
    holdR(S.hold + 0.05);
    expect(r.weapons.smartAim.on).toBe(false);
    expect(callouts).toEqual(['SMART', 'BURST']);
    expect(r.weapons.ammoMode).toBe('BURST');
  });

  it('locks the head nearest the crosshair inside the circle, the crosshair is on it, and a held trigger is full auto into it', () => {
    const near = r.enemies.add(0.5, -10);
    const far = r.enemies.add(-1, -10);
    lookNear(near, 0.4);
    smartOn();
    r.run(1 / 60);
    expect(locked()).toBe(near);
    const head = r.combat.headOf(near, near.center.clone());
    expect(r.weapons.smartAim.lock!.distanceTo(head)).toBeLessThan(1e-6);
    expect(r.weapons.ammoMode).toBe('SMART · LOCK');
    // He never dies (the dummy's health), so a second of trigger is a second of full auto, every round to his head.
    r.input.simulate('fire', true);
    r.run(1);
    r.input.simulate('fire', false);
    r.run(0.2);
    const fired = A.magSize - r.weapons.ammo('autoraffica').mag;
    expect(fired).toBeGreaterThanOrEqual(Math.floor(1 / S.interval) - 1);
    expect(heads(near)).toBe(fired);
    expect(far.hits.length).toBe(0);
  });

  it('with no head in the circle it is semi-auto: one round a pull however long the trigger is held', () => {
    const d = r.enemies.add(0, -10);
    lookAtBody(d);
    r.player.forward.x += 0.4;
    r.player.forward.normalize();
    smartOn();
    r.input.simulate('fire', true);
    r.run(1);
    r.input.simulate('fire', false);
    r.run(0.2);
    expect(r.weapons.ammo('autoraffica').mag).toBe(A.magSize - 1);
    r.tap('fire');
    r.run(0.2);
    expect(r.weapons.ammo('autoraffica').mag).toBe(A.magSize - 2);
  });

  it('a head outside the circle is not locked; off, the rounds go down the crosshair', () => {
    const d = r.enemies.add(0, -10);
    // 2 m off at 10 m: 0.2 rad, outside the 0.14 circle.
    lookNear(d, 2);
    smartOn();
    r.run(1 / 60);
    expect(locked()).toBeNull();
    lookAtBody(d);
    holdR(S.hold + 0.05);
    expect(r.weapons.smartAim.on).toBe(false);
    r.tap('fire');
    r.run(0.2);
    expect(heads(d)).toBe(0);
    expect(d.hits.length).toBe(B.rounds);
  });

  it('never locks through a wall', () => {
    r.wall(-6, 0.3);
    const d = r.enemies.add(0, -10);
    lookNear(d, 0.4);
    smartOn();
    r.run(0.2);
    expect(locked()).toBeNull();
  });

  it('holds its man while he is in the circle, never jumping to a nearer head; full auto hands on as each dies, and stops with none left', () => {
    const a = r.enemies.add(0.9, -10, 50);
    const b = r.enemies.add(-0.6, -10, 50);
    lookNear(a, 0);
    smartOn();
    r.run(1 / 60);
    expect(locked()).toBe(a);
    // Now b is nearer the crosshair, and both are in the circle: the lock stays on a.
    lookNear(a, -1.1);
    r.run(0.2);
    expect(locked()).toBe(a);
    // The trigger held: a round kills a (24 times 3 to the head over his 50), the lock hands on to b, a round kills him, and
    // with no head left in the circle the gun stops, the trigger still down.
    r.input.simulate('fire', true);
    r.run(1);
    expect(a.alive).toBe(false);
    expect(b.alive).toBe(false);
    expect(heads(a)).toBe(1);
    expect(heads(b)).toBe(1);
    expect(locked()).toBeNull();
    expect(r.weapons.ammo('autoraffica').mag).toBe(A.magSize - 2);
    r.input.simulate('fire', false);
  });

  it('lets a man go after its track time and passes him over for its rest, moving to another in the circle', () => {
    const a = r.enemies.add(0, -10);
    const b = r.enemies.add(1, -10);
    lookNear(a, 0);
    smartOn();
    r.run(1 / 60);
    expect(locked()).toBe(a);
    r.run(S.track + 0.05);
    expect(locked()).toBe(b);
    // Alone in the circle, he is locked again once his rest is over.
    b.alive = false;
    r.run(1 / 60);
    expect(locked()).toBeNull();
    r.run(S.rest);
    expect(locked()).toBe(a);
  });

  it('a lock outlives a moment out of sight, and no longer', () => {
    const d = r.enemies.add(0, -10);
    lookNear(d, 0);
    smartOn();
    r.run(1 / 60);
    expect(locked()).toBe(d);
    r.wall(-6, 0.3);
    r.run(S.grace / 2);
    expect(locked()).toBe(d);
    r.run(S.grace);
    expect(locked()).toBeNull();
  });

  it('is off with another gun in hand and back on with the Autoraffica', () => {
    smartOn();
    r.weapons.give('rivet');
    r.weapons.switchTo('rivet');
    r.run(0.3);
    expect(r.weapons.smartAim.on).toBe(false);
    r.weapons.switchTo('autoraffica');
    r.run(0.3);
    expect(r.weapons.smartAim.on).toBe(true);
    r.reset();
    expect(r.weapons.smartAim.on).toBe(false);
  });
});
