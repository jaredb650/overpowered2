/** Full-screen scopes use the same Toggle/Hold setting as ordinary ADS. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WeaponId } from '../core/gameplay';
import { TUNING, WEAPONS } from './data';
import { makeRange, type Range } from './testkit';

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

function aim(down: boolean): void {
  r.input.simulate('aim', down);
  r.run(0.4);
}

for (const hold of [false, true]) {
  describe(hold ? 'hold scope' : 'toggle scope', () => {
    it.each(['autocannon', 'awl', 'sabot'] as const)('%s follows press, release and a second press', id => {
      draw(id);
      r.weapons.aimHold = hold;
      const zoom = vi.fn();
      const scoped = vi.fn();
      r.ctx.camera.setZoom = zoom;
      r.ctx.viewmodel.setScoped = scoped;
      expect(r.weapons.scoped).toBe(false);
      aim(true);
      expect(r.weapons.scoped).toBe(true);
      expect(scoped).toHaveBeenLastCalledWith(true);
      expect(zoom).toHaveBeenLastCalledWith(WEAPONS[id].scopeFov ?? TUNING.autocannon.scopeFov);
      aim(false);
      expect(r.weapons.scoped).toBe(!hold);
      if (hold) {
        expect(zoom).toHaveBeenLastCalledWith(null);
        expect(scoped).toHaveBeenLastCalledWith(false);
      }
      aim(true);
      expect(r.weapons.scoped).toBe(hold);
      aim(false);
      expect(r.weapons.scoped).toBe(false);
      expect(zoom).toHaveBeenLastCalledWith(null);
      expect(scoped).toHaveBeenLastCalledWith(false);
      expect(r.weapons.aim).toBe(0);
    });

    it.each([false, true])('Awl bolt recovery with aim cancelled = %s', cancel => {
      draw('awl');
      r.weapons.aimHold = hold;
      aim(true);
      if (!hold) aim(false); // A toggle stays on after release.
      expect(r.weapons.scoped).toBe(true);
      r.tap('fire');
      expect(r.weapons.scoped).toBe(false);
      r.run(0.15);
      if (cancel) {
        if (hold) r.input.simulate('aim', false);
        else r.tap('aim'); // Switch the scope toggle off during the bolt stroke.
      }
      r.run(0.15);
      expect(r.weapons.scoped).toBe(false); // It cannot return before the bolt locks.
      r.run(WEAPONS.awl.cycleTime! + 0.4);
      expect(r.weapons.scoped).toBe(!cancel);
      // A recovered hold scope must still drop on release.
      if (hold) {
        aim(false);
        expect(r.weapons.scoped).toBe(false);
      }
    });

    it('keeps the Sabot brake fitted while scoping', () => {
      draw('sabot');
      r.weapons.grantMod('sabotBrake');
      expect(r.weapons.fitMod('sabotBrake', true)).toBe(true);
      r.weapons.aimHold = hold;
      aim(true);
      expect(r.weapons.scoped).toBe(true);
      expect(r.weapons.fitted.has('sabotBrake')).toBe(true);
      aim(false);
      expect(r.weapons.scoped).toBe(!hold);
    });

    it('keeps the Piledriver on ordinary ADS', () => {
      draw('piledriver');
      r.weapons.aimHold = hold;
      aim(true);
      expect(r.weapons.aim).toBe(1);
      expect(r.weapons.scoped).toBe(false);
      aim(false);
      expect(r.weapons.aim).toBe(hold ? 0 : 1);
      aim(true);
      expect(r.weapons.aim).toBe(hold ? 1 : 0);
      expect(r.weapons.scoped).toBe(false);
    });
  });
}
