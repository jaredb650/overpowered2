/**
 * The Judge's fanning (docs/proposals/weapons-update.md section 5): right click charges a bar a round, up to three and no
 * more than are loaded; let go and the crosshair paints a head a bar while they drain; then a headshot at each lock.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { WEAPONS } from './data';
import { makeRange, type Dummy, type Range } from './testkit';

const T = WEAPONS.judge.altFan!;
let r: Range;

beforeEach(async () => {
  r = await makeRange();
  r.reset();
  r.weapons.setLoadout(['judge'], 0);
  r.run(0.6);
  expect(r.weapons.current).toBe('judge');
});

/** Crosshair on his head. The testkit's head is a 0.14 m ball 1.6 m up; the rig's head bone sits a little above that. */
function lookAt(d: Dummy): void {
  r.player.forward.set(d.position.x, d.position.y + 1.65, d.position.z).sub(r.player.eye).normalize();
}

function charge(seconds: number): void {
  r.input.simulate('aim', true);
  r.run(seconds);
}

function letGo(): void {
  r.input.simulate('aim', false);
  r.run(1 / 60);
}

const heads = (d: Dummy) => d.hits.filter(h => h.source === 'judge' && h.region === 'head').length;

describe('the Judge fanning', () => {
  it('has no ADS: right click is the fan', () => {
    expect(WEAPONS.judge.ads).toBeUndefined();
    expect(T.bars).toBe(3);
  });

  it('charges a bar a round, and stops at three', () => {
    charge(T.perBar * 1.5);
    expect(r.record.sounds.filter(s => s === 'judge_fan_tick').length).toBe(1);
    charge(T.perBar * 5);
    expect(r.record.sounds.filter(s => s === 'judge_fan_tick').length).toBe(3);
    expect(r.weapons.charge).toBeCloseTo(1, 5);
  });

  it('cannot charge past the rounds in the cylinder', () => {
    r.weapons.ammo('judge').mag = 2;
    charge(T.perBar * 5);
    expect(r.record.sounds.filter(s => s === 'judge_fan_tick').length).toBe(2);
    expect(r.weapons.charge).toBeCloseTo(2 / 3, 5);
  });

  it('locks only while the bars drain, not while charging', () => {
    const d = r.enemies.add(0, -20);
    lookAt(d);
    charge(T.perBar * 3.2);
    expect(r.weapons.paint!.marks.length).toBe(0);
    expect(r.record.sounds).not.toContain('judge_fan_lock');
    letGo();
    expect(r.weapons.paint!.marks.length).toBe(1);
    expect(r.record.sounds).toContain('judge_fan_lock');
  });

  it('fans a headshot at every lock in the order painted, a gap apart, and never locks one man twice', () => {
    const a = r.enemies.add(-6, -20);
    const b = r.enemies.add(0, -20);
    const c = r.enemies.add(6, -20);
    charge(T.perBar * 3.2);
    r.input.simulate('aim', false);
    // Sweep right to left: c, then b, then a, with a look back at c on the way that must not take a second lock.
    lookAt(c);
    r.run(0.1);
    lookAt(b);
    r.run(0.1);
    lookAt(c);
    r.run(0.1);
    expect(r.weapons.paint!.marks.map(m => (m as unknown as { enemy: Dummy }).enemy)).toEqual([c, b]);
    lookAt(a);
    r.run(1 / 60);
    // Three locks for three bars: the fan does not wait for the drain. The first shot goes a gap later.
    expect(r.weapons.paint!.marks.length).toBe(3);
    expect(heads(a) + heads(b) + heads(c)).toBe(0);
    r.run(T.gap + 1 / 60);
    expect(heads(c)).toBe(1);
    expect(heads(b) + heads(a)).toBe(0);
    r.run(T.gap);
    expect(heads(b)).toBe(1);
    expect(heads(a)).toBe(0);
    r.run(T.gap);
    expect(heads(a)).toBe(1);
    expect(r.weapons.ammo('judge').mag).toBe(WEAPONS.judge.magSize - 3);
    for (const d of [a, b, c]) expect(d.hits.length).toBe(1);
  });

  it('fires at the locks it has when the drain runs out', () => {
    const d = r.enemies.add(4, -15);
    charge(T.perBar * 3.2);
    lookAt(d);
    letGo();
    r.player.forward.set(0, 0, -1);
    r.run(T.drain - 0.1);
    expect(heads(d)).toBe(0);
    r.run(0.1 + T.gap + 0.02);
    expect(heads(d)).toBe(1);
    expect(r.weapons.ammo('judge').mag).toBe(WEAPONS.judge.magSize - 1);
  });

  it('fires nothing and spends nothing with no lock', () => {
    r.enemies.add(30, -10);
    charge(T.perBar * 3.2);
    letGo();
    r.run(T.drain + 0.5);
    expect(r.weapons.ammo('judge').mag).toBe(WEAPONS.judge.magSize);
    expect(r.record.sounds).not.toContain('revolver_shot');
    expect(r.record.tracers.length).toBe(0);
    expect(r.weapons.charge).toBe(0);
  });

  it('hits the cover, not the man, when he is behind it at the moment it fires', () => {
    const d = r.enemies.add(0, -20);
    charge(T.perBar * 2.2);
    lookAt(d);
    letGo();
    expect(r.weapons.paint!.marks.length).toBe(1);
    // Two bars, one lock: it waits out the drain. A wall goes up between in that time.
    r.wall(-10, 0.5);
    r.run(T.drain + T.gap + 0.1);
    expect(d.hits.length).toBe(0);
    expect(r.record.impacts.some(m => m.surface === 'concrete' && Math.abs(m.at.z + 10) < 0.05)).toBe(true);
    expect(r.weapons.ammo('judge').mag).toBe(WEAPONS.judge.magSize - 1);
  });
});
