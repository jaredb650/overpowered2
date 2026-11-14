/**
 * Aim down sights: right click on a gun whose right button does nothing else. Toggled by default, held with `aimHold`; a
 * dash or a slide drops it, a reload suspends it; it tightens the cone and walks the player. The scoped guns and every gun
 * with its own use for the button keep it.
 */
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ShotSpec, WeaponId } from '../core/gameplay';
import { MOVE } from '../player/tuning';
import { TUNING, WEAPONS } from './data';
import { makeRange, type Range } from './testkit';

let r: Range;
let fov = 1;
beforeEach(async () => {
  r = await makeRange();
  r.reset();
  r.weapons.setLoadout(['smg', 'shotgun', 'sabot', 'autocannon', 'lance', 'buzzsaw', 'quiver', 'sword', 'kiln', 'rocket'], 0);
  (r.ctx.camera as unknown as { setAim(f: number, l: number): void }).setAim = f => { fov = f; };
  fov = 1;
  r.run(0.5);
});

function draw(id: WeaponId): void {
  r.weapons.switchTo(id);
  r.run(0.6);
  expect(r.weapons.current).toBe(id);
}

/** Every pellet's angle off the look, over `shots` trigger pulls. */
function pelletAngles(shots: number): number[] {
  const angles: number[] = [];
  const fire = r.combat.fireRay.bind(r.combat);
  r.combat.fireRay = (o: THREE.Vector3, d: THREE.Vector3, s: ShotSpec) => {
    angles.push(d.angleTo(r.player.forward));
    return fire(o, d, s);
  };
  for (let i = 0; i < shots; i++) {
    r.tap('fire');
    r.run(WEAPONS.shotgun.interval + 0.05);
  }
  r.weapons.refillMagazines();
  return angles;
}

describe('aim down sights', () => {
  it('is on the guns whose right button does nothing else, and only them', () => {
    const ads = (Object.keys(WEAPONS) as WeaponId[]).filter(id => WEAPONS[id].ads);
    expect(ads).toEqual(['smg', 'harrow', 'shotgun', 'thresher', 'rocket', 'judge', 'rivet', 'piledriver', 'stakegun']);
    for (const id of ['sabot', 'autocannon', 'lance', 'buzzsaw', 'quiver', 'sword', 'knife', 'kiln'] as WeaponId[]) {
      expect(WEAPONS[id].ads, id).toBeUndefined();
    }
  });

  it('toggles on a click by default, over the gun’s time, and narrows the view', () => {
    expect(r.weapons.aimHold).toBe(false);
    r.tap('aim');
    r.run(WEAPONS.smg.ads!.time / 2);
    expect(r.weapons.aim).toBeGreaterThan(0.1);
    expect(r.weapons.aim).toBeLessThan(0.9);
    r.run(WEAPONS.smg.ads!.time);
    expect(r.weapons.aim).toBe(1);
    expect(fov).toBeCloseTo(1 - WEAPONS.smg.ads!.zoom, 5);
    r.tap('aim');
    r.run(0.4);
    expect(r.weapons.aim).toBe(0);
    expect(fov).toBe(1);
  });

  it('in hold mode is up only while the button is down', () => {
    r.weapons.aimHold = true;
    r.input.simulate('aim', true);
    r.run(0.4);
    expect(r.weapons.aim).toBe(1);
    r.input.simulate('aim', false);
    r.run(0.4);
    expect(r.weapons.aim).toBe(0);
    // A click is not a toggle in this mode.
    r.tap('aim');
    r.run(0.4);
    expect(r.weapons.aim).toBe(0);
  });

  it('tightens the shotgun’s cone', () => {
    draw('shotgun');
    const hip = pelletAngles(8);
    r.tap('aim');
    r.run(0.5);
    expect(r.weapons.aim).toBe(1);
    const aimed = pelletAngles(8);
    const cone = WEAPONS.shotgun.spread;
    expect(Math.max(...aimed)).toBeLessThanOrEqual(cone * TUNING.ads.spread + 1e-6);
    expect(Math.max(...hip)).toBeGreaterThan(cone * TUNING.ads.spread);
  });

  it('is dropped by a dash or a slide, and a toggle does not come back after', () => {
    for (const move of ['dashing', 'sliding'] as const) {
      r.tap('aim');
      r.run(0.4);
      expect(r.weapons.aim).toBe(1);
      (r.player as unknown as Record<string, boolean>)[move] = true;
      r.run(0.4);
      expect(r.weapons.aim, move).toBe(0);
      (r.player as unknown as Record<string, boolean>)[move] = false;
      r.run(0.4);
      expect(r.weapons.aim, move).toBe(0);
    }
  });

  it('in hold mode comes back after a dash if the button is still down', () => {
    r.weapons.aimHold = true;
    r.input.simulate('aim', true);
    r.run(0.4);
    (r.player as unknown as { dashing: boolean }).dashing = true;
    r.run(0.3);
    expect(r.weapons.aim).toBe(0);
    (r.player as unknown as { dashing: boolean }).dashing = false;
    r.run(0.4);
    expect(r.weapons.aim).toBe(1);
  });

  it('drops for a reload and comes back after it when toggled', () => {
    r.tap('aim');
    r.run(0.4);
    r.weapons.ammo().mag = 5;
    r.tap('reload');
    r.run(0.3);
    expect(r.weapons.reloading).toBe(true);
    expect(r.weapons.aim).toBe(0);
    r.run(WEAPONS.smg.reloadTime + 0.4);
    expect(r.weapons.reloading).toBe(false);
    expect(r.weapons.aim).toBe(1);
  });

  it('is dropped by a weapon switch', () => {
    r.tap('aim');
    r.run(0.4);
    draw('shotgun');
    expect(r.weapons.aim).toBe(0);
  });

  it('walks the player', () => {
    r.tap('aim');
    r.run(0.4);
    r.player.velocity.set(MOVE.runSpeed, 0, 0);
    r.run(1 / 60);
    const speed = Math.hypot(r.player.velocity.x, r.player.velocity.z);
    expect(speed).toBeLessThanOrEqual(MOVE.runSpeed * TUNING.ads.speed + 1e-6);
  });

  it('leaves the scoped guns’ zoom as it was', () => {
    for (const id of ['sabot', 'autocannon'] as WeaponId[]) {
      draw(id);
      r.tap('aim');
      r.run(0.4);
      expect(r.weapons.scoped, id).toBe(true);
      expect(r.weapons.aim, id).toBe(0);
      expect(fov, id).toBe(1);
      r.tap('aim');
      r.run(0.4);
      expect(r.weapons.scoped, id).toBe(false);
    }
  });

  it('leaves every gun with its own right-button use alone', () => {
    for (const id of ['lance', 'buzzsaw', 'quiver', 'sword', 'kiln'] as WeaponId[]) {
      draw(id);
      r.tap('aim');
      r.input.simulate('aim', true);
      r.run(0.4);
      expect(r.weapons.aim, id).toBe(0);
      expect(fov, id).toBe(1);
      if (id === 'buzzsaw') expect(r.weapons.charge).toBeGreaterThan(0);
      r.input.simulate('aim', false);
      r.run(0.4);
    }
    // And a toggle pressed on one of them is not waiting when an ADS gun comes out.
    draw('smg');
    r.run(0.4);
    expect(r.weapons.aim).toBe(0);
  });
});
