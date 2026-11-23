/** The walker on real Rapier: how it walks, what it climbs, the jets, the stomp, the charge, the turn, and no floor it falls through. */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mulberry32, wrapAngle } from '../core/math';
import { Physics } from '../physics/Physics';
import { Walker, type WalkerIntent } from './controller';
import { FRAME } from './data';

const DT = 1 / 60;
const DEG = Math.PI / 180;
let physics: Physics;
let placed: RAPIER.Collider[] = [];

/** A box from its floor corner up: x0..x1, y0..y1, z0..z1. */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
  const c = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const h = new THREE.Vector3((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2);
  placed.push(physics.addStaticBox(c, h, null, 'concrete'));
  physics.flushQueries();
}

const idle = (): WalkerIntent => ({ moveX: 0, moveZ: 0, viewYaw: 0, jet: false, stomp: false, charge: false });

function walker(x = 0, z = 0, yaw = 0): Walker {
  const w = new Walker(physics, 0);
  w.place(new THREE.Vector3(x, 0.5, z), yaw);
  return w;
}

function run(w: Walker, seconds: number, intent: WalkerIntent, each?: (t: number) => void): void {
  for (let t = 0; t < seconds - 1e-9; t += DT) {
    w.update(DT, intent);
    intent.stomp = intent.charge = false;
    each?.(t + DT);
  }
}

beforeAll(async () => {
  physics = await Physics.create();
});

afterEach(() => {
  for (const c of placed) physics.world.removeCollider(c, false);
  placed = [];
  physics.flushQueries();
});

const floor = () => box(-200, -1, -200, 200, 0, 200);

describe('walking', () => {
  it('takes about 1.1 s to reach 7 m/s ahead and about 0.6 s to stop, with 4.5 back and 5 sideways', () => {
    floor();
    const w = walker();
    expect(w.grounded).toBe(true);
    const go = { ...idle(), moveZ: 1 };
    run(w, 0.9, go);
    expect(w.speed).toBeLessThan(6.5);
    run(w, 0.25, go);
    expect(w.speed).toBeCloseTo(7, 1);
    run(w, 0.55, idle());
    expect(w.speed).toBeGreaterThan(0);
    run(w, 0.1, idle());
    expect(w.speed).toBe(0);
    run(w, 2, { ...idle(), moveZ: -1 });
    expect(w.speed).toBeCloseTo(4.5, 1);
    run(w, 2, { ...idle(), moveX: 1 });
    expect(w.speed).toBeCloseTo(5, 1);
  });

  it('plants a foot about every 0.7 s at a full walk, and the last one comes down when it stops', () => {
    floor();
    const w = walker();
    run(w, 2, { ...idle(), moveZ: 1 });
    let steps = 0;
    run(w, 7, { ...idle(), moveZ: 1 }, () => (steps += w.said.steps));
    expect(steps).toBeGreaterThanOrEqual(9);
    expect(steps).toBeLessThanOrEqual(11);
    run(w, 2, idle());
    expect(w.stride % 1).toBe(0);
  });

  it('walks onto 1.2 m and down off it, and is stopped by 1.6 m', () => {
    floor();
    box(-3, 0, -12, 3, 1.2, -8);
    box(-3, 0, -30, 3, 1.6, -26);
    const w = walker(0, 0);
    let top = 0;
    run(w, 3, { ...idle(), moveZ: 1 }, () => (top = Math.max(top, w.feet.y)));
    expect(top).toBeCloseTo(1.2, 2);
    expect(w.grounded).toBe(true);
    run(w, 4, { ...idle(), moveZ: 1 });
    expect(w.feet.z).toBeGreaterThan(-26);
    expect(w.feet.z).toBeLessThan(-24);
    expect(w.feet.y).toBeCloseTo(0, 2);
  });

  it('slides along a wall it walks into at an angle', () => {
    floor();
    box(-20, 0, -6, 20, 4, -5);
    const w = walker(0, 0, -30 * DEG);
    run(w, 4, { ...idle(), moveZ: 1, viewYaw: -30 * DEG });
    expect(w.feet.z).toBeGreaterThan(-5 + FRAME.body.radius - 0.4);
    expect(w.feet.x).toBeGreaterThan(5);
  });
});

describe('jets', () => {
  it('go up about 7 m in 0.8 s, hover up to 1.5 s, and fill again in 3 s on the ground', () => {
    floor();
    const w = walker();
    const jet = { ...idle(), jet: true };
    run(w, 0.8, jet);
    expect(w.feet.y).toBeGreaterThan(6.5);
    expect(w.feet.y).toBeLessThan(7.5);
    const peak = w.feet.y;
    run(w, 1.4, jet);
    expect(Math.abs(w.feet.y - peak)).toBeLessThan(1);
    run(w, 4, jet);
    expect(w.grounded).toBe(true);
    expect(w.said.landed).toBe(0);
    expect(w.fuel).toBeLessThan(FRAME.jet.fuel);
    run(w, 3.4, idle());
    expect(w.fuel).toBeCloseTo(FRAME.jet.fuel, 5);
  });

  it('put it on a 2.6 m container, 10 of 10, from any of ten starts', () => {
    const rng = mulberry32(7);
    let made = 0;
    for (let i = 0; i < 10; i++) {
      floor();
      // A 40-foot container, its long side facing the Frame.
      box(-6, 0, -12.4, 6, 2.6, -10);
      const back = 3 + rng() * 6;
      const angle = (rng() - 0.5) * 50 * DEG;
      const x = Math.sin(angle) * back;
      const z = -10 + Math.cos(angle) * (back + FRAME.body.radius);
      const yaw = Math.atan2(x, z - -11.2);
      const w = walker(x, z, yaw);
      // As a player flies it: jets and W until a foot is over the edge, then off W and hold the jets to brake, until they run dry.
      const go = { ...idle(), viewYaw: yaw, jet: true };
      run(w, 4, go, () => (go.moveZ = w.feet.z > -9 ? 1 : 0));
      run(w, 2, idle());
      if (w.grounded && Math.abs(w.feet.y - 2.6) < 0.05) made++;
      for (const c of placed) physics.world.removeCollider(c, false);
      placed = [];
      physics.flushQueries();
    }
    expect(made).toBe(10);
  });

  it('stop at a ceiling', () => {
    floor();
    box(-10, 9, -10, 10, 10, 10);
    const w = walker();
    let top = 0;
    run(w, 2, { ...idle(), jet: true }, () => (top = Math.max(top, w.feet.y)));
    expect(top + FRAME.body.top).toBeLessThan(9.01);
  });
});

describe('the stomp', () => {
  it('from 4 m or more is the big one, then 0.6 s standing up that a charge cancels', () => {
    floor();
    const w = walker();
    run(w, 0.6, { ...idle(), jet: true });
    expect(w.clearance()).toBeGreaterThan(FRAME.stomp.big);
    run(w, DT, { ...idle(), jet: true, stomp: true });
    expect(w.stomping).toBe(true);
    let fell = -1;
    let t = 0;
    for (; fell < 0 && t < 1; t += DT) {
      w.update(DT, idle());
      fell = w.said.stomped;
    }
    expect(fell).toBeGreaterThanOrEqual(FRAME.stomp.big);
    // 30 m/s down: the fall is over in a fraction of a second.
    expect(t).toBeLessThan(0.3);
    expect(w.grounded).toBe(true);
    w.update(DT, { ...idle(), moveZ: 1 });
    w.update(DT, { ...idle(), moveZ: 1 });
    expect(w.speed).toBe(0);
    w.update(DT, { ...idle(), charge: true });
    expect(w.recover).toBe(0);
    expect(w.charging).toBeGreaterThan(0);
  });

  it('does nothing below 1.5 m', () => {
    floor();
    const w = walker();
    w.update(DT, { ...idle(), jet: true });
    w.update(DT, { ...idle(), stomp: true });
    expect(w.stomping).toBe(false);
  });

  it('dives diagonally onto a painted target with startTargetedStomp and credits angled travel toward big slam power', () => {
    floor();
    const w = walker();
    run(w, 0.55, { ...idle(), jet: true });
    expect(w.clearance()).toBeGreaterThan(2.5);
    const target = new THREE.Vector3(3, 0, -14);
    expect(w.startTargetedStomp(target)).toBe(true);
    expect(w.stomping).toBe(true);
    expect(w.stompTargeted).toBe(true);
    let fell = -1;
    let t = 0;
    for (; fell < 0 && t < 1.5; t += DT) {
      w.update(DT, idle());
      fell = w.said.stomped;
    }
    expect(w.grounded).toBe(true);
    expect(w.stompTargeted).toBe(false);
    expect(fell).toBeGreaterThanOrEqual(FRAME.stomp.big);
    expect(Math.hypot(w.feet.x - target.x, w.feet.z - target.z)).toBeLessThan(2.2);
  });

  it('engages air hover-brake while slamAiming is held so the pilot has time to paint a ground target', () => {
    floor();
    const w = walker();
    run(w, 0.65, { ...idle(), jet: true });
    const y0 = w.feet.y;
    run(w, 0.6, { ...idle(), slamAiming: true });
    expect(w.grounded).toBe(false);
    expect(w.velocity.y).toBeGreaterThan(-3.2);
    expect(y0 - w.feet.y).toBeLessThan(2.5);
  });
});

describe('the charge', () => {
  it('goes about 13.5 m in 0.75 s, two charges, each back 3.5 s after', () => {
    floor();
    const w = walker();
    const z0 = w.feet.z;
    run(w, FRAME.charge.seconds, { ...idle(), charge: true });
    expect(z0 - w.feet.z).toBeGreaterThan(12.2);
    expect(z0 - w.feet.z).toBeLessThan(14.5);
    expect(w.charges).toBe(1);
    run(w, 0.1, { ...idle(), charge: true });
    expect(w.charges).toBe(0);
    run(w, 0.9, { ...idle(), charge: true });
    expect(w.said.charged).toBe(false);
    run(w, 2.7, idle());
    expect(w.charges).toBe(1);
    run(w, FRAME.charge.refill + 0.1, idle());
    expect(w.charges).toBe(2);
  });

  it('stops dead at a wall, and re-plants the legs under the view', () => {
    floor();
    box(-10, 0, -8, 10, 5, -7);
    const w = walker();
    w.legYaw = 60 * DEG;
    let bumped = 0;
    run(w, 0.7, { ...idle(), charge: true }, () => (bumped = Math.max(bumped, w.said.bumped)));
    expect(bumped).toBeGreaterThan(0);
    expect(w.feet.z).toBeGreaterThan(-7 + FRAME.body.radius - 0.6);
    expect(w.legYaw).toBeCloseTo(0, 5);
  });
});

describe('turning', () => {
  it('leaves the view free within 80 degrees, then drags the legs at 140 degrees a second', () => {
    floor();
    const w = walker();
    run(w, 0.5, { ...idle(), viewYaw: 70 * DEG });
    expect(w.legYaw).toBe(0);
    expect(w.viewYaw).toBeCloseTo(70 * DEG, 6);
    // The mouse pushing on past the edge: each frame asks for more than the legs can give.
    for (let i = 0; i < 30; i++) w.update(DT, { ...idle(), viewYaw: w.viewYaw + 20 * DEG });
    expect(w.legYaw).toBeCloseTo(0.5 * 140 * DEG, 2);
    expect(wrapAngle(w.viewYaw - w.legYaw)).toBeCloseTo(80 * DEG, 5);
    // Let go, and nothing turns on its own.
    const legs = w.legYaw;
    run(w, 1, { ...idle(), viewYaw: w.viewYaw });
    expect(w.legYaw).toBe(legs);
  });

  it('brings the legs round under the view while walking', () => {
    floor();
    const w = walker();
    run(w, 2, { ...idle(), moveZ: 1, viewYaw: 60 * DEG });
    expect(w.legYaw).toBeCloseTo(60 * DEG, 3);
  });

  it('with ?frameturn=free has no limit', () => {
    floor();
    const w = walker();
    w.free = true;
    w.update(DT, { ...idle(), viewYaw: 170 * DEG });
    expect(w.viewYaw).toBeCloseTo(170 * DEG, 6);
    run(w, 1, { ...idle(), viewYaw: 170 * DEG });
    expect(w.legYaw).toBeCloseTo(170 * DEG, 2);
  });
});

describe('300 s of random driving', () => {
  it('never falls through a floor, a block or a deck, and is never lost', () => {
    floor();
    // A walled yard with blocks of every height, a deck on legs, and a ramp up to it.
    const blocks: [number, number, number, number, number, number][] = [
      [-40, 0, -41, 40, 12, -40], [-40, 0, 40, 40, 12, 41], [-41, 0, -40, -40, 12, 40], [40, 0, -40, 41, 12, 40],
    ];
    const rng = mulberry32(3);
    for (let i = 0; i < 26; i++) {
      const x = -34 + rng() * 64;
      const z = -34 + rng() * 64;
      const h = [0.3, 0.8, 1.2, 1.25, 1.6, 2.6, 3.4, 5.2][i % 8]!;
      blocks.push([x, 0, z, x + 2 + rng() * 6, h, z + 2 + rng() * 6]);
    }
    // A thin deck on legs: a floor in the air.
    blocks.push([-12, 3, 18, 6, 3.25, 30]);
    for (const [x, z] of [[-12, 18], [5.6, 18], [-12, 29.6], [5.6, 29.6]] as const) blocks.push([x, 0, z, x + 0.4, 3, z + 0.4]);
    for (const b of blocks) box(...b);
    const ramp = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 14 * DEG);
    placed.push(physics.addStaticBox(new THREE.Vector3(-20, 1.2, 10), new THREE.Vector3(3, 0.2, 7), ramp, 'concrete'));
    physics.flushQueries();

    const w = walker(0, 0);
    const intent = idle();
    let next = 0;
    let lost = 0;
    let under = 0;
    let worst = '';
    let landedOnDeck = 0;
    for (let t = 0; t < 300; t += DT) {
      // Every 20 s it flies for the deck as a player would, so the deck is tested as a floor too.
      const deck = t % 20 < 4;
      if (deck) {
        intent.viewYaw = Math.atan2(-(-3 - w.feet.x), -(24 - w.feet.z));
        intent.moveX = 0;
        intent.moveZ = Math.hypot(w.feet.x + 3, w.feet.z - 24) > 3 ? 1 : 0;
        intent.jet = t % 20 < 3;
        intent.stomp = intent.charge = false;
        next = t;
      } else if (t >= next) {
        next = t + 0.4 + rng() * 1.6;
        intent.moveX = Math.round(rng() * 2 - 1);
        intent.moveZ = rng() < 0.75 ? 1 : Math.round(rng() * 2 - 1);
        intent.viewYaw += (rng() - 0.5) * 3;
        intent.jet = rng() < 0.3;
        intent.stomp = rng() < 0.2;
        intent.charge = rng() < 0.15;
      }
      w.update(DT, intent);
      intent.stomp = intent.charge = false;
      if (w.said.rescued) lost++;
      if (w.feet.y < -0.01) {
        under++;
        worst ||= `under the floor at ${t.toFixed(2)}: ${w.feet.toArray().map(n => n.toFixed(2))}`;
      }
      for (const [x0, y0, z0, x1, y1, z1] of blocks) {
        const inside = w.feet.x > x0 + 0.05 && w.feet.x < x1 - 0.05 && w.feet.z > z0 + 0.05 && w.feet.z < z1 - 0.05;
        if (inside && w.feet.y > y0 - 0.5 && w.feet.y < y1 - 0.05) {
          under++;
          worst ||= `inside a block at ${t.toFixed(2)}: ${w.feet.toArray().map(n => n.toFixed(2))} in ${[x0, y0, z0, x1, y1, z1]}`;
        }
      }
      if (w.grounded && w.feet.y > 3.2 && w.feet.x > -12 && w.feet.x < 6 && w.feet.z > 18 && w.feet.z < 30) landedOnDeck++;
    }
    expect(worst).toBe('');
    expect(under).toBe(0);
    expect(lost).toBe(0);
    // It went up there at least once, so the deck was tested as a floor.
    expect(landedOnDeck).toBeGreaterThan(0);
  });
});
