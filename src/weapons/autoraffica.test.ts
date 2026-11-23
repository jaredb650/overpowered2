/**
 * The Autoraffica (docs/proposals/weapons-wishlist.md section 2): always suppressed; a three-round burst a pull, or hold R
 * for paint-then-snap smart mode. In smart mode, hold left click to paint visible heads inside the 8° circle one at a time
 * (0.25 s each, nearest unpainted head first, ascending lock beep); releasing while painting cancels all marks and fires nothing;
 * once every visible head in the circle is marked, drills them full-auto (800 RPM) in order with a ~0.08 s snap delay between
 * kills; releasing while firing stops immediately; clicking with no head in the circle fires one plain shot on pull.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { CACHE_ORDER } from '../progression/data';
import { MOD_WARES, WEAPON_WARES } from '../contracts/shop/data';
import { STARTING_WEAPONS, WEAPONS } from './data';
import { familyOfSlot } from './families';
import { AMMO_GUNS, MODS, MOD_ORDER } from './mods';
import { SMART_DEFAULTS } from './smartaim';
import { makeRange, type Dummy, type Range } from './testkit';

const A = WEAPONS.autoraffica;
const B = A.pullBurst!;
const S = A.smart!;
const PAINT_TIME = S.paintTime ?? SMART_DEFAULTS.paintTime;
const SNAP_DELAY = S.snapDelay ?? SMART_DEFAULTS.snapDelay;

let r: Range;
let callouts: string[];
let playPitches: Array<{ id: string; pitch: number }>;

beforeEach(async () => {
  r = await makeRange();
  r.reset();
  callouts = [];
  playPitches = [];
  (r.ctx.hud as { callout?: (t: string) => void }).callout = t => callouts.push(t);
  const origPlay = r.ctx.audio.play.bind(r.ctx.audio);
  r.ctx.audio.play = (id: string, opts?: { pitch?: number }) => {
    playPitches.push({ id, pitch: opts?.pitch ?? 1 });
    return origPlay(id, opts as never);
  };
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

describe('the Autoraffica on paper', () => {
  it('is on key 6 with the pistols, its own unlock from its own cache, sold in the shop with AP and HP rounds', () => {
    expect(familyOfSlot(6)).toContain('autoraffica');
    expect(A.base).toBe('judge');
    expect(STARTING_WEAPONS).not.toContain('autoraffica');
    expect(CACHE_ORDER.filter(id => id === 'autoraffica')).toHaveLength(1);
    expect(WEAPON_WARES.autoraffica!.price).toBeGreaterThan(0);
    expect(WEAPON_WARES.autoraffica!.wave).toBeGreaterThan(0);
    expect(WEAPON_WARES.autoraffica!.lore.length).toBeGreaterThan(40);
    expect(AMMO_GUNS).toContain('autoraffica');
    expect(MODS.autorafficaAp.slot).toBe('ammo');
    expect(MODS.autorafficaHp.slot).toBe('ammo');
    expect(MOD_WARES.autorafficaAp.lore.length).toBeGreaterThan(40);
  });

  it('is always suppressed: the shroud is part of the gun, and no mod changes its report or its flash', () => {
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

describe('smart aim (paint-then-snap)', () => {
  it('hold R switches between SMART and BURST with a callout; a short R tap reloads without toggling', () => {
    expect(r.weapons.smartAim.on).toBe(false);
    expect(r.weapons.ammoMode).toBe('BURST');
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

  it('does not passively lock at rest; holding LMB on 1 target paints for 0.25 s, beeps, then full-auto drills his head', () => {
    const d = r.enemies.add(0.4, -10);
    lookNear(d, 0.3);
    smartOn();
    r.run(0.2);
    // No passive lock while idle at rest.
    expect(r.weapons.smartAim.phase).toBe('idle');
    expect(r.weapons.smartAim.lock).toBeNull();
    expect(r.weapons.paint?.marks.length).toBe(0);

    // Hold LMB: paints for 0.25 s with zero shots fired during charge, exposing chargingAt for the radial head ring.
    r.input.simulate('fire', true);
    r.run(PAINT_TIME * 0.6);
    expect(r.weapons.smartAim.phase).toBe('painting');
    expect(r.weapons.smartAim.charge).toBeGreaterThan(0.3);
    const head = r.combat.headOf(d, d.center.clone());
    expect(r.weapons.smartAim.chargingAt).not.toBeNull();
    expect(r.weapons.smartAim.chargingAt!.distanceTo(head)).toBeLessThan(1e-6);
    expect(d.hits.length).toBe(0);

    // Finish painting: lock beep fires and full-auto immediately begins drilling his head.
    r.run(PAINT_TIME * 0.6);
    expect(r.weapons.smartAim.phase).toBe('firing');
    expect(r.weapons.smartAim.chargingAt).toBeNull();
    expect(r.weapons.ammoMode).toBe('SMART · LOCK');
    expect(playPitches.filter(p => p.id === 'quiver_lock').length).toBe(1);
    expect(r.weapons.smartAim.lock!.distanceTo(head)).toBeLessThan(1e-6);

    // Continue holding for 0.6 s: full-auto (800 RPM) drills his head on every round.
    r.run(0.6);
    r.input.simulate('fire', false);
    r.run(0.1);
    const fired = A.magSize - r.weapons.ammo('autoraffica').mag;
    expect(fired).toBeGreaterThanOrEqual(Math.floor(0.6 / S.interval));
    expect(heads(d)).toBe(fired);
  });

  it('paints multiple heads one at a time (nearest crosshair first) with ascending pitch, then kills in order with snap delay', () => {
    const near = r.enemies.add(0.3, -10, 50);
    const far = r.enemies.add(-0.9, -10, 50);
    lookNear(near, 0);
    smartOn();

    // Hold LMB: paints `near` first (0.25 s).
    r.input.simulate('fire', true);
    r.run(PAINT_TIME + 0.03);
    expect(r.weapons.smartAim.phase).toBe('painting');
    expect(r.weapons.smartAim.markCount).toBe(1);
    expect(r.weapons.paint?.marks.length).toBe(1);
    expect(r.weapons.ammoMode).toBe('SMART · MARK 1');
    expect(near.hits.length).toBe(0);
    expect(far.hits.length).toBe(0);

    // Paint `far` second (another 0.25 s): ascending pitch lock beep, then immediately kills `near`.
    r.run(PAINT_TIME);
    const locks = playPitches.filter(p => p.id === 'quiver_lock');
    expect(locks.length).toBe(2);
    expect(locks[1]!.pitch).toBeGreaterThan(locks[0]!.pitch);
    // `near` takes the first headshot and dies; `far` waits out the ~0.08 s snap delay.
    expect(near.alive).toBe(false);
    expect(heads(near)).toBe(1);
    expect(far.alive).toBe(true);
    expect(heads(far)).toBe(0);

    // After snap delay, snaps to `far`, drills him to death, and finishes idle even with LMB still down.
    r.run(SNAP_DELAY + 0.15);
    expect(far.alive).toBe(false);
    expect(heads(far)).toBe(1);
    expect(r.weapons.smartAim.phase).toBe('idle');
    expect(r.weapons.smartAim.lock).toBeNull();
    expect(r.weapons.ammo('autoraffica').mag).toBe(A.magSize - 2);
    r.input.simulate('fire', false);
  });

  it('cancels all marks and fires nothing if released while still painting (Q3a)', () => {
    const a = r.enemies.add(0.3, -10, 50);
    const b = r.enemies.add(-0.8, -10, 50);
    lookNear(a, 0);
    smartOn();

    // Paint first head, partway through painting second head, then release.
    r.input.simulate('fire', true);
    r.run(PAINT_TIME + PAINT_TIME * 0.4);
    expect(r.weapons.smartAim.phase).toBe('painting');
    expect(r.weapons.smartAim.markCount).toBe(1);
    r.input.simulate('fire', false);
    r.run(0.2);

    expect(r.weapons.smartAim.phase).toBe('idle');
    expect(r.weapons.smartAim.markCount).toBe(0);
    expect(r.weapons.ammo('autoraffica').mag).toBe(A.magSize);
    expect(a.hits.length).toBe(0);
    expect(b.hits.length).toBe(0);
    expect(r.record.sounds).toContain('quiver_cancel');
  });

  it('stops firing immediately and clears remaining marks if released while firing (Q3b)', () => {
    const a = r.enemies.add(0.3, -10, 500);
    const b = r.enemies.add(-0.8, -10, 500);
    lookNear(a, 0);
    smartOn();

    // Paint both heads and let firing begin on `a`.
    r.input.simulate('fire', true);
    r.run(PAINT_TIME * 2 + 0.05);
    expect(r.weapons.smartAim.phase).toBe('firing');
    const hitsBeforeRelease = a.hits.length;
    expect(hitsBeforeRelease).toBeGreaterThan(0);
    expect(b.hits.length).toBe(0);

    // Release while firing: stops immediately, clears remaining marks.
    r.input.simulate('fire', false);
    r.run(0.5);
    expect(r.weapons.smartAim.phase).toBe('idle');
    expect(r.weapons.smartAim.markCount).toBe(0);
    expect(a.hits.length).toBe(hitsBeforeRelease);
    expect(b.hits.length).toBe(0);
  });

  it('resets charging progress if a head leaves the circle or goes behind cover mid-paint', () => {
    const d = r.enemies.add(0, -10);
    lookNear(d, 0);
    smartOn();

    // Charge partway, then turn outside the 8° cone.
    r.input.simulate('fire', true);
    r.run(PAINT_TIME * 0.7);
    expect(r.weapons.smartAim.charge).toBeGreaterThan(0.5);
    lookNear(d, 2.5);
    r.run(1 / 60);
    expect(r.weapons.smartAim.charge).toBe(0);
    expect(r.weapons.smartAim.markCount).toBe(0);

    // Look back on him: must restart from 0, so half paintTime is not enough to finish.
    lookNear(d, 0);
    r.run(PAINT_TIME * 0.5);
    expect(r.weapons.smartAim.phase).toBe('painting');
    expect(r.weapons.smartAim.markCount).toBe(0);

    // Put a wall in front of him: charge resets to 0 again.
    r.wall(-6, 0.3);
    r.run(1 / 60);
    expect(r.weapons.smartAim.charge).toBe(0);
    expect(d.hits.length).toBe(0);
    r.input.simulate('fire', false);
  });

  it('fires a plain single shot on pull when clicking with no head in the circle', () => {
    const d = r.enemies.add(0, -10);
    // 2.5 m off at 10 m: outside the 0.14 rad (~8°) circle.
    lookNear(d, 2.5);
    smartOn();

    r.input.simulate('fire', true);
    r.run(0.6);
    r.input.simulate('fire', false);
    r.run(0.2);
    expect(r.weapons.ammo('autoraffica').mag).toBe(A.magSize - 1);
    expect(d.hits.length).toBe(0);

    // Second tap fires one more plain shot.
    r.tap('fire');
    r.run(0.2);
    expect(r.weapons.ammo('autoraffica').mag).toBe(A.magSize - 2);
  });

  it('never paints through a wall, and falls back to plain single shot', () => {
    r.wall(-6, 0.3);
    const d = r.enemies.add(0, -10);
    lookNear(d, 0.3);
    smartOn();

    r.input.simulate('fire', true);
    r.run(PAINT_TIME + 0.1);
    r.input.simulate('fire', false);
    expect(r.weapons.smartAim.markCount).toBe(0);
    expect(d.hits.length).toBe(0);
    expect(r.weapons.ammo('autoraffica').mag).toBe(A.magSize - 1);
  });

  it('is off with another gun in hand and back on with the Autoraffica; reset turns it off', () => {
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
