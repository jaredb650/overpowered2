/**
 * Key 8: the rotary cannon (id `buzzsaw`, the Trommel), the heavy machine gun beside it (the Piledriver), the burst a
 * cannon round goes off in, the slowdown both guns put on the player, and the door gun, which has the burst and the way
 * through walls together.
 */
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShotSpec, WeaponId } from '../core/gameplay';
import { MOVE } from '../player/tuning';
import { DOOR } from '../progression/callins/heliData';
import { CACHE_ORDER } from '../progression/data';
import { EXPLOSIONS, TUNING, WEAPONS, WEAPON_ORDER } from './data';
import { familyOfSlot, membersOf } from './families';
import { Handling, holdSpeed, inMove, type Mover } from './handling';
import { makeRange, type Range } from './testkit';
import { lineById } from '../enemies/commander/lines';
import { spoken } from '../ui/commander/pick';

const DOWN_RANGE = new THREE.Vector3(0, 0, -1);
const EYE = new THREE.Vector3(0, 1, 0);
const rotary = WEAPONS.buzzsaw;
const hmg = WEAPONS.piledriver;

let r: Range;
beforeEach(async () => {
  r = await makeRange();
  r.reset();
});
afterEach(() => vi.restoreAllMocks());

/** Hands key 8 over and draws one of its guns. */
function draw(id: 'buzzsaw' | 'piledriver'): void {
  r.weapons.give('buzzsaw');
  r.weapons.switchTo(id);
  r.run(0.6);
  expect(r.weapons.current).toBe(id);
}

function rounds(id: WeaponId): number {
  return WEAPONS[id].magSize - r.weapons.ammo(id).mag;
}

/** Holds the trigger for `seconds` and lets go. */
function hold(seconds: number, fps = 60): void {
  r.input.simulate('fire', true);
  r.run(seconds, fps);
  r.input.simulate('fire', false);
  r.run(1 / fps, fps);
}

describe('key 8, the table', () => {
  it('holds the rotary cannon and the heavy machine gun, and the second comes with the first', () => {
    expect(familyOfSlot(8)).toEqual(['buzzsaw', 'piledriver']);
    expect(membersOf('buzzsaw')).toEqual(['piledriver']);
    expect(hmg.base).toBe('buzzsaw');
    // The cache that brings the cannon brings both: the heavy machine gun is in no cache of its own.
    expect(CACHE_ORDER).toContain('buzzsaw');
    expect(CACHE_ORDER).not.toContain('piledriver');
    expect(WEAPON_ORDER.indexOf('piledriver')).toBe(WEAPON_ORDER.indexOf('buzzsaw') + 1);
  });

  it('the cannon is no saw: a new name, big rounds, fewer of them, and nothing through walls', () => {
    expect(rotary.name).not.toMatch(/SAW/i);
    expect(rotary.mode).toBe('spin');
    // Under thirty a second, where it was fifty, and more than twice the round. More damage a second than it had.
    expect(1 / rotary.interval).toBeLessThanOrEqual(30);
    expect(1 / rotary.interval).toBeGreaterThanOrEqual(18);
    expect(rotary.damage).toBeGreaterThan(13 * 2);
    expect(rotary.damage / rotary.interval).toBeGreaterThan(13 * 50);
    expect(rotary.damage).toBeGreaterThan(WEAPONS.smg.damage);
    expect(rotary.penetration).toBe(0);
    expect(rotary.shake).toBeGreaterThan(WEAPONS.shotgun.shake);
    expect(rotary.kick).toBeGreaterThan(WEAPONS.smg.kick * 2);
  });

  it('its rounds burst small: a grapefruit, not the autocannon', () => {
    const b = rotary.burst!;
    expect(b.radius).toBeGreaterThanOrEqual(0.3);
    expect(b.radius).toBeLessThanOrEqual(0.5);
    expect(b.damage).toBeLessThan(rotary.damage / 2);
    expect(b.radius).toBeLessThan(TUNING.autocannon.radius / 8);
    expect(TUNING.burst.shake).toBeLessThan(EXPLOSIONS.shell.shake);
    expect(hmg.burst).toBeUndefined();
  });

  it('the heavy machine gun is slow, hits far harder a round, and is the one that goes through', () => {
    expect(hmg.mode).toBe('auto');
    expect(1 / hmg.interval).toBeGreaterThanOrEqual(8);
    expect(1 / hmg.interval).toBeLessThanOrEqual(10);
    expect(hmg.damage).toBeGreaterThan(rotary.damage * 2.5);
    expect(hmg.penetration).toBeGreaterThan(1.6);
    expect(hmg.kick).toBeGreaterThan(rotary.kick * 3);
    // No automatic bullet takes a limb more readily, and no other bullet bursts what it kills.
    for (const id of WEAPON_ORDER) {
      const w = WEAPONS[id];
      if (id === 'piledriver' || w.mode === 'melee' || w.mode === 'charge' || w.round !== undefined) continue;
      if (w.mode === 'auto' || w.mode === 'spin') expect(hmg.severMult, id).toBeGreaterThan(w.severMult);
      expect(w.gib, id).toBeUndefined();
    }
    expect(hmg.gib).toBeGreaterThan(0);
  });

  it('both slow the player, the cannon more', () => {
    expect(rotary.slow).toBeLessThan(hmg.slow!);
    expect(hmg.slow).toBeLessThan(1);
    expect(rotary.slow).toBeLessThan(TUNING.buzzsaw.moveSpeed);
    expect(TUNING.buzzsaw.moveSpeed).toBeLessThan(1);
  });
});

describe('the rotary cannon', () => {
  it('fires nothing until the barrels are turning, then its rate, at any frame rate', () => {
    for (const fps of [30, 60, 144]) {
      r.reset();
      draw('buzzsaw');
      r.weapons.modifiers.bottomlessMag = true;
      let fired = 0;
      const off = r.ctx.events.on('weapon:fired', () => { fired++; });
      r.input.simulate('fire', true);
      r.run(TUNING.buzzsaw.spinUp * TUNING.buzzsaw.fireAt - 2 / fps, fps);
      expect(fired, `before spin @${fps}`).toBe(0);
      r.run(1, fps);
      fired = 0;
      r.run(2, fps);
      r.input.simulate('fire', false);
      off();
      expect(fired / 2, `rate @${fps}`).toBeGreaterThan(1 / rotary.interval - 0.6);
      expect(fired / 2, `rate @${fps}`).toBeLessThan(1 / rotary.interval + 0.6);
    }
  });

  it('every round that lands goes off once: a burst and its crack, and never a blast', () => {
    r.wall(-12, 1);
    draw('buzzsaw');
    hold(1.5);
    const fired = rounds('buzzsaw');
    expect(fired).toBeGreaterThan(10);
    expect(r.combat.bursts.stats.bursts).toBe(fired);
    expect(r.record.sounds.filter(id => id === 'cannon_burst').length).toBe(fired);
    expect(r.record.explosions).toBe(0);
  });

  it('goes through nothing: a man behind a sheet of cover is safe from it', () => {
    r.wall(-10, 0.3);
    const behind = r.enemies.add(0, -11.5);
    draw('buzzsaw');
    hold(1.2);
    expect(rounds('buzzsaw')).toBeGreaterThan(5);
    expect(behind.hits.length).toBe(0);
  });

  it('with Hellfire Rounds the real blast takes the burst\'s place', () => {
    r.wall(-12, 1);
    draw('buzzsaw');
    r.weapons.modifiers.explosiveRounds = true;
    hold(1);
    expect(r.record.explosions).toBeGreaterThan(0);
    expect(r.combat.bursts.stats.bursts).toBe(0);
  });

  it('is heard spinning up when the trigger goes down and running down when it is let go', () => {
    draw('buzzsaw');
    r.input.simulate('fire', true);
    r.run(0.3);
    expect(r.record.sounds).toContain('minigun_spinup');
    expect(r.record.sounds).not.toContain('minigun_spindown');
    r.input.simulate('fire', false);
    r.run(0.1);
    expect(r.record.sounds.filter(id => id === 'minigun_spindown').length).toBe(1);
  });
});

describe('a burst', () => {
  const round = (o: Partial<ShotSpec> = {}): ShotSpec => ({ damage: rotary.damage, source: 'buzzsaw', team: 'player', burst: rotary.burst, ...o });

  it('puts fragments into a body beside it, as a small bullet and not as a blast', () => {
    r.wall(-10, 1);
    // Out of the round's line, and 0.4 m from where it lands once the body's own width is taken off.
    const beside = r.enemies.add(0.6, -9.7);
    const clear = r.enemies.add(1.6, -9.7);
    r.combat.fireRay(EYE, DOWN_RANGE, round());
    expect(r.combat.bursts.stats.bursts).toBe(1);
    expect(beside.hits.length).toBe(1);
    const hit = beside.hits[0]!;
    expect(hit.type).toBe('bullet');
    expect(hit.reach).toBeUndefined();
    expect(hit.blastKind).toBeUndefined();
    expect(hit.amount).toBeGreaterThan(0);
    expect(hit.amount).toBeLessThanOrEqual(rotary.burst!.damage);
    expect(hit.amount).toBeGreaterThanOrEqual(rotary.burst!.damage * 0.5);
    expect(hit.source).toBe('buzzsaw');
    expect(clear.hits.length).toBe(0);
    expect(r.combat.bursts.stats.fragments).toBe(1);
  });

  it('gives the body the round struck the round, and no fragments on top', () => {
    const struck = r.enemies.add(0, -8);
    // Shoulder to shoulder with where the round lands on him, and out of its line.
    const beside = r.enemies.add(0.62, -7.45);
    r.combat.fireRay(EYE, DOWN_RANGE, round());
    expect(struck.hits.length).toBe(1);
    expect(struck.hits[0]!.amount).toBe(rotary.damage);
    expect(beside.hits.length).toBe(1);
    expect(beside.hits[0]!.amount).toBeLessThanOrEqual(rotary.burst!.damage);
    expect(r.combat.bursts.stats.bursts).toBe(1);
    expect(r.combat.bursts.stats.fragments).toBe(1);
  });

  it('is stopped by cover between it and a body', () => {
    // A burst wide enough to reach the man behind a thin wall, which it lands on the front of.
    r.wall(-10, 0.2);
    const behind = r.enemies.add(0, -10.9);
    // As near to it on the side it landed on, with nothing in the way.
    const open = r.enemies.add(0.9, -9.4);
    r.combat.fireRay(EYE, DOWN_RANGE, round({ burst: { radius: 1.2, damage: 10 } }));
    expect(r.combat.bursts.stats.bursts).toBe(1);
    expect(behind.hits.length).toBe(0);
    expect(open.hits.length).toBe(1);
  });

  it('`?burst`-less rounds land as they always did', () => {
    r.wall(-10, 1);
    r.enemies.add(0.6, -9.6);
    r.combat.fireRay(EYE, DOWN_RANGE, round({ burst: undefined }));
    expect(r.combat.bursts.stats.bursts).toBe(0);
    expect(r.record.sounds).not.toContain('cannon_burst');
  });

  it('costs one enemy query and at most a ray for each body in reach', () => {
    r.wall(-10, 1);
    for (let i = 0; i < 12; i++) r.enemies.add(6 + i, -3);
    r.run(0.1);
    r.record.worldRays = 0;
    r.combat.fireRay(EYE, DOWN_RANGE, round());
    // The round's own ray, and nothing for twelve bodies out of reach.
    expect(r.record.worldRays).toBe(1);
  });
});

describe('the heavy machine gun', () => {
  it('fires eight a second held, and does not burst', () => {
    r.wall(-30, 1);
    draw('piledriver');
    hold(2);
    const fired = rounds('piledriver');
    expect(fired).toBeGreaterThanOrEqual(Math.floor(2 / hmg.interval));
    expect(fired).toBeLessThanOrEqual(Math.ceil(2 / hmg.interval) + 1);
    expect(r.combat.bursts.stats.bursts).toBe(0);
    expect(r.record.sounds.filter(id => id === 'piledriver_fire').length).toBe(fired);
  });

  it('goes through an inner wall and the men behind it, losing some of its damage on the way', () => {
    r.wall(-8, 0.6);
    const a = r.enemies.add(0, -10);
    const b = r.enemies.add(0, -12);
    const c = r.enemies.add(0, -14);
    draw('piledriver');
    r.input.simulate('fire', true);
    r.run(hmg.interval * 0.5);
    r.input.simulate('fire', false);
    expect(rounds('piledriver')).toBe(1);
    for (const d of [a, b, c]) expect(d.hits.length).toBe(1);
    expect(a.hits[0]!.amount).toBeLessThan(hmg.damage);
    expect(b.hits[0]!.amount).toBeLessThan(a.hits[0]!.amount);
    expect(c.hits[0]!.amount).toBeGreaterThan(hmg.damage * 0.5);
  });

  it('runs out: an outer wall and then an inner one is the end of it', () => {
    r.wall(-8, 1.6);
    r.wall(-12, 1);
    const behind = r.enemies.add(0, -15);
    draw('piledriver');
    hold(0.5);
    expect(behind.hits.length).toBe(0);
  });

  it('rolls a round for whether its kill bursts the body', () => {
    const near = r.enemies.add(0, -8, 10);
    draw('piledriver');
    vi.spyOn(Math, 'random').mockReturnValue(0);
    r.input.simulate('fire', true);
    r.run(hmg.interval * 0.5);
    r.input.simulate('fire', false);
    expect(near.hits[0]!.gib).toBe(true);
    vi.restoreAllMocks();

    r.reset();
    const far = r.enemies.add(0, -8, 10);
    draw('piledriver');
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    r.input.simulate('fire', true);
    r.run(hmg.interval * 0.5);
    r.input.simulate('fire', false);
    expect(far.hits[0]!.gib).toBeFalsy();
  });

  it('climbs, as the row says', () => {
    draw('piledriver');
    const before = r.player.pitch;
    hold(1);
    expect(r.player.pitch - before).toBeGreaterThan(hmg.climb!.pitch * 4);
  });
});

describe('a heavy gun slows the player', () => {
  const mover = (over: Partial<Mover> = {}): Mover => ({
    velocity: new THREE.Vector3(MOVE.runSpeed, 0, 0), grounded: true, sliding: false,
    modifiers: { speed: 1, jump: 1, damageTaken: 1, invulnerable: false, infiniteDash: false }, ...over,
  });

  it('a little while the barrels turn, a lot while it fires, and lets go again', () => {
    const h = new Handling();
    const dt = 1 / 60;
    expect(h.cap(dt, WEAPONS.smg, 0)).toBe(1);
    expect(h.cap(dt, rotary, 1)).toBeCloseTo(TUNING.buzzsaw.moveSpeed);
    expect(h.cap(dt, rotary, 0.5)).toBeCloseTo((1 + TUNING.buzzsaw.moveSpeed) / 2);
    let cap = 1;
    for (let i = 0; i < 30; i++) {
      h.shot();
      cap = h.cap(dt, rotary, 1);
    }
    expect(cap).toBeCloseTo(rotary.slow!);
    // It comes on over a few frames, not in one.
    const fresh = new Handling();
    fresh.shot();
    expect(fresh.cap(dt, rotary, 1)).toBeGreaterThan(rotary.slow! + 0.1);
    for (let i = 0; i < 60; i++) cap = h.cap(dt, rotary, 1);
    expect(cap).toBeCloseTo(TUNING.buzzsaw.moveSpeed);
    expect(h.weight).toBe(0);
  });

  it('the heavy machine gun only while it fires', () => {
    const h = new Handling();
    const dt = 1 / 60;
    expect(h.cap(dt, hmg, 0)).toBe(1);
    let cap = 1;
    for (let i = 0; i < 40; i++) {
      if (i % 7 === 0) h.shot();
      cap = h.cap(dt, hmg, 0);
    }
    expect(cap).toBeCloseTo(hmg.slow!);
  });

  it('on the ground, to the cap', () => {
    const p = mover();
    for (let i = 0; i < 4; i++) holdSpeed(p, 0.5, 1 / 60);
    expect(p.velocity.x).toBeLessThanOrEqual(MOVE.runSpeed * 0.5);
    expect(p.velocity.x).toBeGreaterThan(MOVE.runSpeed * 0.5 - MOVE.groundAccel / 60);
    // A player already under the cap is left alone.
    const slow = mover({ velocity: new THREE.Vector3(2, 0, 0) });
    holdSpeed(slow, 0.5, 1 / 60);
    expect(slow.velocity.x).toBe(2);
  });

  it('never in a dash, a slide, a wall run, a climb, a vault or a slam', () => {
    for (const move of ['sliding', 'dashing', 'wallRunning', 'mantling', 'vaulting', 'slamming'] as const) {
      const p = mover({ [move]: true, velocity: new THREE.Vector3(MOVE.runSpeed, 0, 0) });
      expect(inMove(p), move).toBe(true);
      holdSpeed(p, 0.5, 1 / 60);
      expect(p.velocity.x, move).toBe(MOVE.runSpeed);
    }
  });

  it('holds in the air too, where a hop would otherwise get all of it back', () => {
    const jump = mover({ grounded: false });
    holdSpeed(jump, 0.5, 1 / 60);
    expect(jump.velocity.x).toBeCloseTo(MOVE.runSpeed * 0.5);
    // Eased by the caller: a cap that has only begun to come on takes only a little.
    const early = mover({ grounded: false });
    holdSpeed(early, 0.95, 1 / 60);
    expect(early.velocity.x).toBeCloseTo(MOVE.runSpeed * 0.95);
  });

  it('a player thrown by a pad, a blast or a dash keeps all of it, in the air and on landing', () => {
    const fast = MOVE.runSpeed * TUNING.handling.leave + 2;
    for (const grounded of [false, true]) {
      const thrown = mover({ grounded, velocity: new THREE.Vector3(fast, 0, 0) });
      holdSpeed(thrown, 0.5, 1 / 60);
      expect(thrown.velocity.x, String(grounded)).toBe(fast);
    }
  });

  it('lets what a dash or a dash-jump left bleed down to the cap, and never cuts it in one frame', () => {
    const dt = 1 / 60;
    for (const [from, grounded] of [[MOVE.dashExit, true], [MOVE.dashKeep, false]] as const) {
      const h = new Handling();
      const velocity = new THREE.Vector3(from, 0, 0);
      holdSpeed(mover({ grounded, dashing: true, velocity }), 0.5, dt, h);
      expect(h.carrying).toBe(true);
      const p = mover({ grounded, velocity });
      holdSpeed(p, 0.5, dt, h);
      // One frame takes at most `carry` plus what the legs would give back, nothing like the drop to the cap.
      const most = (TUNING.handling.carry + MOVE.groundAccel) * dt;
      expect(p.velocity.x, String(from)).toBeGreaterThanOrEqual(from - most - 1e-9);
      expect(p.velocity.x, String(from)).toBeGreaterThan(MOVE.runSpeed * 0.5 + 3);
      // With nothing pushing back (no legs here) it is down within half a second, and the clamp holds from then on.
      let frames = 1;
      while (h.carrying && frames < 120) { holdSpeed(p, 0.5, dt, h); frames++; }
      expect(frames * dt).toBeLessThan(0.5);
      expect(p.velocity.x).toBeLessThanOrEqual(MOVE.runSpeed * 0.5 + 1e-9);
    }
    // Run speed with no move behind it is not carried: the trigger's own easing is the only one (the weight in `cap`).
    const h = new Handling();
    const p = mover();
    holdSpeed(p, 0.5, dt, h);
    expect(h.carrying).toBe(false);
    expect(p.velocity.x).toBeLessThanOrEqual(MOVE.runSpeed * 0.5);
  });

  it('for real: firing each gun on the run brings the player down to its share of run speed', () => {
    for (const id of ['buzzsaw', 'piledriver'] as const) {
      r.reset();
      draw(id);
      r.weapons.modifiers.bottomlessMag = true;
      r.input.simulate('fire', true);
      r.run(1.2);
      r.player.velocity.set(MOVE.runSpeed, 0, 0);
      r.run(0.2);
      r.input.simulate('fire', false);
      const target = MOVE.runSpeed * WEAPONS[id].slow!;
      expect(r.player.velocity.x, id).toBeLessThanOrEqual(target + 1e-6);
      expect(r.player.velocity.x, id).toBeGreaterThan(target - MOVE.groundAccel / 60);
    }
    // A gun with no `slow` leaves a running player alone.
    r.reset();
    r.input.simulate('fire', true);
    r.run(0.3);
    r.player.velocity.set(MOVE.runSpeed, 0, 0);
    r.run(0.3);
    r.input.simulate('fire', false);
    expect(r.player.velocity.x).toBe(MOVE.runSpeed);
  });
});

describe('the door gun', () => {
  const G = DOOR.gun;
  const round = (): ShotSpec => ({
    damage: G.damage, source: 'door_gun', team: 'player', burst: G.burst ?? undefined, penetrate: G.penetrate, bodyCost: G.bodyCost,
  });

  it('is the one gun with both: it bursts, and it goes through', () => {
    expect(G.burst).not.toBeNull();
    expect(G.penetrate).toBeGreaterThan(1);
    expect(G.penetrate).toBeLessThan(1.6);
    expect(rotary.burst !== undefined && rotary.penetration > 0).toBe(false);
    expect(hmg.burst !== undefined && hmg.penetration > 0).toBe(false);
    // Buffed: more a round and more a second than the gun it replaced, which did 22 at 60.
    expect(G.damage).toBeGreaterThan(22 * 2);
    expect(G.damage * G.roundsPerSecond).toBeGreaterThan(22 * 60);
  });

  it('bursts on the roof it strikes, goes through it and the man under it, and bursts again where it stops', () => {
    r.wall(-10, 0.6);
    const under = r.enemies.add(0, -12);
    r.wall(-20, 3);
    r.combat.fireRay(EYE, DOWN_RANGE, round());
    expect(under.hits.length).toBe(1);
    expect(under.hits[0]!.amount).toBeLessThan(G.damage);
    expect(r.combat.bursts.stats.bursts).toBe(2);
    expect(r.record.explosions).toBe(0);
  });

  it('never bursts more than twice a round, however much it goes through', () => {
    r.wall(-10, 0.2);
    r.enemies.add(0, -11);
    r.wall(-12, 0.2);
    r.enemies.add(0, -13);
    r.wall(-14, 0.2);
    r.wall(-30, 3);
    r.combat.fireRay(EYE, DOWN_RANGE, round());
    expect(r.combat.bursts.stats.bursts).toBe(2);
  });

  it('a round that stops where it first lands bursts once', () => {
    r.wall(-10, 3);
    r.combat.fireRay(EYE, DOWN_RANGE, round());
    expect(r.combat.bursts.stats.bursts).toBe(1);
  });
});

describe('the Commander', () => {
  it('calls key 8 the Trommel, and does not play the takes that say "Buzzsaw"', () => {
    const line = lineById('cmd.weapon.smug.others')!;
    const said = spoken(line, { weapon: 'buzzsaw' }, 'weapon');
    expect(said.text).toContain('Trommel');
    expect(said.text).not.toContain('Buzzsaw');
    expect(said.clip).toBeNull();
    // Every other gun keeps its takes.
    expect(spoken(line, { weapon: 'rocket' }, 'weapon').clip).toBe('cmd.weapon.smug.others~rocket');
  });
});
