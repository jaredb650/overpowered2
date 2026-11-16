/** A second kind of round: the Stakegun's exploding bolts on right click, the Piledriver's Raufoss rounds on R held. */
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import type { WeaponId } from '../core/gameplay';
import { TUNING, WEAPONS } from './data';
import { makeRange, type Dummy, type Range } from './testkit';

let r: Range;
beforeEach(async () => {
  r = await makeRange();
  r.reset();
});

function draw(id: WeaponId): void {
  r.weapons.give(id);
  r.weapons.switchTo(id);
  r.run(0.6);
  expect(r.weapons.current).toBe(id);
}

/** R held past its hold, then let go. */
function holdR(seconds: number): void {
  r.input.simulate('reload', true);
  r.run(seconds);
  r.input.simulate('reload', false);
  r.run(1 / 60);
}

/** The Piledriver in hand with its Raufoss rounds loaded: R held. */
function raufoss(): void {
  draw('piledriver');
  holdR(WEAPONS.piledriver.altAmmo!.hold! + 0.05);
  expect(r.weapons.ammoMode).toBe('RAUFOSS');
}

/** One round: the trigger down for a frame. */
function fire(): void {
  r.tap('fire');
}

/** The stand-in's chest bone stands where its chest is, so a bolt in it can ride it. */
function chestBone(d: Dummy): THREE.Bone {
  const b = d.char.bones[2] as THREE.Bone;
  b.position.set(d.position.x, d.position.y + 1, d.position.z);
  b.updateMatrixWorld(true);
  return b;
}

const bomb = TUNING.stake.bomb;
const rauf = TUNING.raufoss;

describe('the toggle', () => {
  it('right click loads the other round and back, with a click and no shot', () => {
    draw('stakegun');
    r.tap('aim');
    expect(r.weapons.ammoMode).toBe('EXPLODING BOLTS');
    expect(r.record.sounds).toContain('reload_bolt');
    expect(r.weapons.ammo('stakegun').mag).toBe(WEAPONS.stakegun.magSize);
    r.tap('aim');
    expect(r.weapons.ammoMode).toBe('');
  });

  it('on the Piledriver R held loads Raufoss and back, a tap still reloads, and right click aims', () => {
    raufoss();
    expect(r.record.sounds).toContain('reload_bolt');
    expect(r.weapons.ammo('piledriver').mag).toBe(WEAPONS.piledriver.magSize);
    expect(r.weapons.reloading).toBe(false);
    holdR(WEAPONS.piledriver.altAmmo!.hold! + 0.05);
    expect(r.weapons.ammoMode).toBe('');
    r.tap('aim');
    expect(r.weapons.ammoMode).toBe('');
    r.run(WEAPONS.piledriver.ads!.time + 0.1);
    expect(r.weapons.aim).toBe(1);
    r.tap('aim');
    r.run(0.5);
    r.weapons.ammo('piledriver').mag = 10;
    holdR(0.1);
    expect(r.weapons.reloading).toBe(true);
    expect(r.weapons.ammoMode).toBe('');
  });
});

describe('exploding bolts', () => {
  it('stick in a man, ride him as he moves, beep, and go off after the fuse', () => {
    const d = r.enemies.add(0, -10);
    const bone = chestBone(d);
    draw('stakegun');
    r.tap('aim');
    fire();
    r.run(0.1);
    const stuck = r.combat.projectiles.active.find(p => p.kind === 'stake');
    expect(stuck?.resting).toBe(true);
    expect(d.bolted).toBeGreaterThan(r.ctx.time.elapsed);
    // The bolt alone barely hurts him: he has to live to run.
    expect(d.hits.length).toBe(1);
    expect(d.hits[0]!.amount).toBe(bomb.direct);
    expect(r.record.explosions).toBe(0);

    // He runs 4 m to the side; the bolt goes with him.
    bone.position.x += 4;
    bone.updateMatrixWorld(true);
    d.position.x += 4;
    d.center.x += 4;
    r.run(0.05);
    expect(stuck!.position.x).toBeCloseTo(4, 1);
    expect(r.record.explosions).toBe(0);

    r.run(bomb.fuse);
    expect(r.record.explosions).toBe(1);
    expect(r.record.blasts[0]!.x).toBeCloseTo(4, 1);
    expect(r.record.sounds.filter(id => id === 'stake_beep').length).toBe(bomb.beeps.length);
    expect(d.hits.some(h => h.type === 'explosive')).toBe(true);
    expect(r.combat.projectiles.active.some(p => p.kind === 'stake')).toBe(false);
  });

  it('stick in a wall and go off there, a fuse after they stuck', () => {
    r.wall(-12, 1);
    draw('stakegun');
    r.tap('aim');
    fire();
    r.run(0.15);
    expect(r.record.explosions).toBe(0);
    r.run(bomb.fuse);
    expect(r.record.explosions).toBe(1);
    expect(r.record.blasts[0]!.z).toBeGreaterThan(-12);
    expect(r.record.blasts[0]!.z).toBeLessThan(-11);
  });

  it('the standard stake still goes off nowhere', () => {
    r.wall(-12, 1);
    draw('stakegun');
    fire();
    r.run(bomb.fuse + 0.3);
    expect(r.record.explosions).toBe(0);
  });
});

describe('Raufoss rounds', () => {
  it('burst on cover and throw their pellets out of the far side into the man behind it', () => {
    r.wall(-8, 0.3);
    const behind = r.enemies.add(0, -12);
    raufoss();
    fire();
    expect(r.weapons.ammo('piledriver').mag).toBe(WEAPONS.piledriver.magSize - 1);
    expect(r.combat.bursts.stats.bursts).toBe(1);
    expect(r.record.sounds).toContain('raufoss_detonation');
    // The pellets leave from the far face of the wall, not the near one, and all of them land.
    const pellets = r.record.tracers.filter(t => t.kind === 'bullet');
    expect(pellets.length).toBe(rauf.pellets);
    for (const t of pellets) expect(t.from.z).toBeCloseTo(-8.3, 1);
    expect(behind.hits.length).toBe(rauf.pellets);
    for (const h of behind.hits) {
      expect(h.type).toBe('pellet');
      expect(h.amount).toBeCloseTo(WEAPONS.piledriver.damage * rauf.share, 5);
    }
  });

  it('burst on a wall too thick to pass and stop there', () => {
    r.wall(-8, 2);
    const behind = r.enemies.add(0, -12);
    raufoss();
    fire();
    expect(r.combat.bursts.stats.bursts).toBe(1);
    expect(r.record.tracers.filter(t => t.kind === 'bullet').length).toBe(0);
    expect(behind.hits.length).toBe(0);
  });

  it('on a man, hit him hard and come out of his back into the man behind', () => {
    const front = r.enemies.add(0, -8);
    const back = r.enemies.add(0, -11);
    raufoss();
    fire();
    expect(front.hits.length).toBe(1);
    expect(front.hits[0]!.amount).toBeCloseTo(WEAPONS.piledriver.damage * rauf.direct, 5);
    expect(back.hits.length).toBe(rauf.pellets);
    for (const h of back.hits) expect(h.type).toBe('pellet');
  });

  it('on a man\'s plate, burst just behind it: the pellet cone lands in his body, past the plate, and nobody behind', () => {
    const front = r.enemies.add(0, -8);
    front.armor = 50;
    const back = r.enemies.add(0, -11);
    raufoss();
    fire();
    // The round itself on the plate, then every pellet into him through it.
    expect(front.hits.length).toBe(1 + rauf.pellets);
    expect(front.hits[0]!.pierces).toBeFalsy();
    const pellets = front.hits.slice(1);
    for (const h of pellets) {
      expect(h.type).toBe('pellet');
      expect(h.pierces).toBe(true);
      expect(h.amount).toBeCloseTo(WEAPONS.piledriver.damage * rauf.share, 5);
    }
    expect(front.maxHealth - front.health).toBeCloseTo(rauf.pellets * WEAPONS.piledriver.damage * rauf.share, 5);
    expect(back.hits.length).toBe(0);
  });
});
