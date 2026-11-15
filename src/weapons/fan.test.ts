/**
 * The Judge's fanning (docs/proposals/weapons-update.md section 5): right click charges a bar a round, up to three and no
 * more than are loaded, and paints heads while it is held, more than one lock on a man held under the crosshair. Let go
 * and it fires a shot a bar at once: the locks into their heads, the rest down the crosshair.
 */
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ShotSpec } from '../core/gameplay';
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
const ticks = () => r.record.sounds.filter(s => s === 'judge_fan_tick').length;
const locked = () => r.weapons.paint!.marks.map(m => (m as unknown as { enemy: Dummy }).enemy);
const mag = () => r.weapons.ammo('judge').mag;

/** Every plain ray the gun fires, by its angle off the crosshair. */
function rays(): number[] {
  const angles: number[] = [];
  const fire = r.combat.fireRay.bind(r.combat);
  r.combat.fireRay = (o: THREE.Vector3, d: THREE.Vector3, s: ShotSpec) => {
    angles.push(d.angleTo(r.player.forward));
    return fire(o, d, s);
  };
  return angles;
}

/** Looking at nobody: down the range, off to the left of anyone placed. */
function lookAway(): void {
  r.player.forward.set(-1, 0, -1).normalize();
}

describe('the Judge fanning', () => {
  it('has no ADS: right click is the fan', () => {
    expect(WEAPONS.judge.ads).toBeUndefined();
    expect(T.bars).toBe(3);
  });

  it('charges a bar a round, and stops at three', () => {
    lookAway();
    charge(T.perBar * 1.5);
    expect(ticks()).toBe(1);
    charge(T.perBar * 5);
    expect(ticks()).toBe(3);
    expect(r.weapons.charge).toBeCloseTo(1, 5);
  });

  it('cannot charge past the rounds in the cylinder', () => {
    r.weapons.ammo('judge').mag = 2;
    lookAway();
    charge(T.perBar * 5);
    expect(ticks()).toBe(2);
    expect(r.weapons.charge).toBeCloseTo(2 / 3, 5);
  });

  it('paints while charging: a head under the crosshair locks as soon as a bar is there for it', () => {
    const d = r.enemies.add(0, -20);
    lookAt(d);
    charge(T.perBar * 0.75);
    expect(r.weapons.paint!.marks.length).toBe(0);
    charge(T.perBar * 0.35);
    expect(locked()).toEqual([d]);
    expect(r.record.sounds).toContain('judge_fan_lock');
    expect(heads(d)).toBe(0);
  });

  it('stacks locks on a man held under the crosshair, one a bar and never more, and fires them all into him', () => {
    const d = r.enemies.add(0, -20);
    lookAt(d);
    charge(T.perBar * 3.2);
    expect(locked()).toEqual([d, d, d]);
    // The HUD's bracket counts a target by how often it is in the marks: one bracket, x3.
    expect(new Set(r.weapons.paint!.marks).size).toBe(1);
    charge(2);
    expect(r.weapons.paint!.marks.length).toBe(3);
    letGo();
    r.run(T.gap * 2 + 0.02);
    expect(heads(d)).toBe(3);
    expect(mag()).toBe(WEAPONS.judge.magSize - 3);
  });

  it('fires a shot a bar the moment it is let go, the locks into their heads in the order painted, a gap apart', () => {
    const a = r.enemies.add(-6, -20);
    const b = r.enemies.add(0, -20);
    const c = r.enemies.add(6, -20);
    lookAt(c);
    charge(T.perBar + 0.05);
    lookAt(b);
    charge(T.perBar);
    lookAt(a);
    charge(T.perBar);
    expect(locked()).toEqual([c, b, a]);
    letGo();
    expect(heads(c)).toBe(1);
    expect(heads(a) + heads(b)).toBe(0);
    r.run(T.gap);
    expect(heads(b)).toBe(1);
    expect(heads(a)).toBe(0);
    r.run(T.gap);
    expect(heads(a)).toBe(1);
    expect(mag()).toBe(WEAPONS.judge.magSize - 3);
    for (const d of [a, b, c]) expect(d.hits.length).toBe(1);
  });

  it('fires the bars with no lock down the crosshair, after the locks', () => {
    const d = r.enemies.add(0, -20);
    lookAt(d);
    charge(T.perBar + 0.05);
    expect(locked()).toEqual([d]);
    lookAway();
    charge(T.perBar * 2.2);
    const angles = rays();
    letGo();
    r.run(T.gap * 2 + 0.02);
    expect(heads(d)).toBe(1);
    expect(angles.length).toBe(2);
    for (const a of angles) expect(a).toBeLessThan(0.01);
    expect(mag()).toBe(WEAPONS.judge.magSize - 3);
  });

  it('with no lock dumps every charged round down the crosshair, at normal speed', () => {
    r.enemies.add(30, -10);
    lookAway();
    charge(T.perBar * 2.2);
    const angles = rays();
    letGo();
    let slowest = r.ctx.time.slowmo;
    for (let i = 0; i < 20; i++) {
      r.run(1 / 60);
      slowest = Math.min(slowest, r.ctx.time.slowmo);
    }
    expect(angles.length).toBe(2);
    expect(mag()).toBe(WEAPONS.judge.magSize - 2);
    expect(slowest).toBe(1);
  });

  it('slows the world from the release to the last shot when someone is painted, and not the player', () => {
    const d = r.enemies.add(0, -20);
    lookAt(d);
    charge(T.perBar * 2.2);
    expect(r.ctx.time.slowmo).toBe(1);
    letGo();
    r.run(0.05);
    expect(r.ctx.time.slowmo).toBeLessThan(0.6);
    expect(r.ctx.time.playerDt).toBeCloseTo(1 / 60, 6);
    r.run(T.gap + 0.02);
    expect(heads(d)).toBe(2);
    r.run(0.3);
    expect(r.ctx.time.slowmo).toBe(1);
  });

  it('lets the slow motion go when the fan is cut short', () => {
    const d = r.enemies.add(0, -20);
    lookAt(d);
    charge(T.perBar * 3.2);
    letGo();
    r.weapons.setLoadout(['smg'], 0);
    r.run(0.5);
    expect(r.ctx.time.slowmo).toBe(1);
  });

  it('fires nothing on a tap that charged no bar', () => {
    lookAway();
    charge(T.perBar * 0.5);
    letGo();
    r.run(0.5);
    expect(mag()).toBe(WEAPONS.judge.magSize);
    expect(r.record.sounds).not.toContain('revolver_shot');
  });

  it('hits the cover, not the man, when he is behind it at the moment it fires', () => {
    const d = r.enemies.add(0, -20);
    lookAt(d);
    charge(T.perBar + 0.05);
    expect(locked()).toEqual([d]);
    r.wall(-10, 0.5);
    letGo();
    expect(d.hits.length).toBe(0);
    expect(r.record.impacts.some(m => m.surface === 'concrete' && Math.abs(m.at.z + 10) < 0.05)).toBe(true);
    expect(mag()).toBe(WEAPONS.judge.magSize - 1);
  });
});
