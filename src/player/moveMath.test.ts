import { describe, expect, it } from 'vitest';
import {
  airSteer, approachVector, clipVelocity, idealStrafeGain, moveToward, quakeAccelerate, redirectOntoPlane, rotateToward,
  settle, slamBounceSpeed, softLimit, springStep,
} from './moveMath';

const v3 = (x: number, y: number, z: number) => ({ x, y, z });
const hspeed = (v: { x: number; z: number }) => Math.hypot(v.x, v.z);

describe('quakeAccelerate', () => {
  it('reaches wish speed along the wish direction and stops there', () => {
    const v = v3(0, 0, 0);
    for (let i = 0; i < 500; i++) quakeAccelerate(v, 1, 0, 17, 10, 1 / 120);
    expect(v.x).toBeCloseTo(17, 6);
  });

  it('adds nothing when already at wish speed along the wish direction', () => {
    const v = v3(17, 0, 0);
    quakeAccelerate(v, 1, 0, 17, 10, 1 / 120);
    expect(v.x).toBe(17);
  });

  it('gains speed past wish speed when the wish is nearly perpendicular to velocity', () => {
    const v = v3(30, 0, 0);
    const a = Math.acos(16 / 30);
    quakeAccelerate(v, Math.cos(a), Math.sin(a), 17, 0.7, 1 / 120);
    expect(hspeed(v)).toBeGreaterThan(30);
  });

  it('matches the analytic gain of perfect strafing', () => {
    const wish = 17;
    const accel = 0.7;
    const h = 1 / 120;
    const v = v3(wish, 0, 0);
    let t = 0;
    while (t < 4) {
      const s = hspeed(v);
      const add = accel * wish * h;
      const theta = Math.acos((wish - add) / s);
      const heading = Math.atan2(v.z, v.x) + theta;
      quakeAccelerate(v, Math.cos(heading), Math.sin(heading), wish, accel, h);
      t += h;
    }
    const expected = Math.sqrt(wish * wish + 2 * accel * wish * wish * 4);
    expect(hspeed(v)).toBeGreaterThan(expected * 0.97);
    expect(hspeed(v)).toBeLessThan(expected * 1.03);
    expect(idealStrafeGain(30, wish, accel)).toBeCloseTo((accel * wish * wish) / 30, 6);
  });
});

describe('airSteer', () => {
  it('turns velocity toward the wish and keeps its length', () => {
    const v = v3(30, 5, 0);
    const a = Math.PI / 4;
    for (let i = 0; i < 12; i++) airSteer(v, Math.cos(a), Math.sin(a), 170, 1 / 120);
    expect(hspeed(v)).toBeCloseTo(30, 8);
    expect(v.z).toBeGreaterThan(0.5);
    expect(v.y).toBe(5);
  });

  it('does nothing when the wish points backward', () => {
    const v = v3(30, 0, 0);
    airSteer(v, -1, 0, 170, 1 / 120);
    expect(v.x).toBe(30);
    expect(v.z).toBe(0);
  });
});

describe('vectors', () => {
  it('moveToward does not overshoot', () => {
    expect(moveToward(0, 10, 3)).toBe(3);
    expect(moveToward(9, 10, 3)).toBe(10);
    expect(moveToward(10, 0, 3)).toBe(7);
  });

  it('approachVector lands exactly on the target', () => {
    const v = v3(1, 2, 3);
    approachVector(v, 4, 2, 3, 100);
    expect(v).toEqual(v3(4, 2, 3));
  });

  it('clipVelocity removes only speed into the surface', () => {
    const v = v3(3, -4, 0);
    clipVelocity(v, v3(0, 1, 0));
    expect(v).toEqual(v3(3, 0, 0));
    const away = v3(3, 4, 0);
    clipVelocity(away, v3(0, 1, 0));
    expect(away).toEqual(v3(3, 4, 0));
  });

  it('redirectOntoPlane keeps speed on a ramp', () => {
    const v = v3(0, 0, -30);
    const a = (20 * Math.PI) / 180;
    const n = v3(0, Math.cos(a), -Math.sin(a));
    redirectOntoPlane(v, n);
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(30, 8);
    expect(v.x * n.x + v.y * n.y + v.z * n.z).toBeCloseTo(0, 8);
  });

  it('rotateToward honours both fraction and cap, and takes the short way round', () => {
    const v = v3(10, 0, 0);
    rotateToward(v, 0, 1, 0.5);
    expect(Math.atan2(v.z, v.x)).toBeCloseTo(Math.PI / 4, 6);
    const c = v3(10, 0, 0);
    rotateToward(c, 0, 1, 1, 0.1);
    expect(Math.atan2(c.z, c.x)).toBeCloseTo(0.1, 6);
    const w = v3(Math.cos(3), 0, Math.sin(3));
    rotateToward(w, Math.cos(-3), Math.sin(-3), 1);
    expect(Math.abs(Math.atan2(w.z, w.x))).toBeCloseTo(3, 6);
  });
});

describe('softLimit', () => {
  it('leaves speeds under the limit alone', () => {
    expect(softLimit(44, 45, 0.35, 1)).toBe(44);
  });

  it('decays toward the limit by the same amount whatever the step size', () => {
    let a = 80;
    for (let i = 0; i < 120; i++) a = softLimit(a, 45, 0.35, 1 / 120);
    expect(a).toBeCloseTo(softLimit(80, 45, 0.35, 1), 8);
  });
});

describe('slamBounceSpeed', () => {
  it('rises with fall height and respects its clamp', () => {
    const low = slamBounceSpeed(2, 28, 0.6, 13, 30);
    const mid = slamBounceSpeed(10, 28, 0.6, 13, 30);
    const high = slamBounceSpeed(200, 28, 0.6, 13, 30);
    expect(low).toBe(13);
    expect(mid).toBeGreaterThan(low);
    expect(high).toBe(30);
  });
});

describe('springStep', () => {
  it('is independent of step size', () => {
    const a = { x: 1, v: 0 };
    const b = { x: 1, v: 0 };
    springStep(a, 30, 0.6, 0.1);
    for (let i = 0; i < 100; i++) springStep(b, 30, 0.6, 0.001);
    expect(a.x).toBeCloseTo(b.x, 8);
    expect(a.v).toBeCloseTo(b.v, 6);
  });

  it('stays bounded on a huge frame', () => {
    const s = { x: 1, v: 0 };
    springStep(s, 200, 0.6, 0.05);
    expect(Math.abs(s.x)).toBeLessThan(1);
  });
});

describe('rest', () => {
  it('lands a spring on exactly 0 instead of approaching it forever', () => {
    const s = { x: 0.05, v: 0 };
    for (let i = 0; i < 600; i++) springStep(s, 32, 0.62, 1 / 60);
    expect(s.x).toBe(0);
    expect(s.v).toBe(0);
  });

  it('snaps to the target only once the gap is invisible', () => {
    expect(settle(0.00005, 0)).toBe(0);
    expect(settle(0.002, 0)).toBe(0.002);
  });
});
