/** The Frame's clocks (heat, magazines, the pod, smoke) and its blows, counted on a stand-in crowd. */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { DamageInfo } from '../core/contracts';
import type { EnemyInstance, EnemySystem, MissileTarget } from '../core/gameplay';
import type { PaintCandidate } from '../weapons/swarm';
import { FRAME } from './data';
import { backhand, Cannon, crush, Pod, Rotary, shove, Smoke, stomp } from './weapons';

const DT = 1 / 60;

describe('the rotary', () => {
  it('fires 20 a second once spun up, overheats in about 7 s, vents in about 2.5 s, and is locked out meanwhile', () => {
    const r = new Rotary();
    let rounds = 0;
    let t = 0;
    for (; !r.heat.overheated && t < 20; t += DT) rounds += r.update(DT, true);
    expect(t).toBeGreaterThan(6.6);
    expect(t).toBeLessThan(7.8);
    // 140 rounds of heat, give or take the last one's rounding.
    expect(rounds).toBeGreaterThanOrEqual(140);
    expect(rounds).toBeLessThanOrEqual(141);
    let locked = 0;
    for (; r.heat.overheated && locked < 10; locked += DT) expect(r.update(DT, true)).toBe(0);
    expect(locked).toBeGreaterThan(2.2);
    expect(locked).toBeLessThan(2.8);
  });

  it('spins up before it fires, and cools off the trigger', () => {
    const r = new Rotary();
    let first = -1;
    for (let t = 0; first < 0; t += DT) if (r.update(DT, true) > 0) first = t;
    expect(first).toBeGreaterThan(0.25);
    expect(first).toBeLessThan(0.35);
    for (let i = 0; i < 240; i++) r.update(DT, true);
    const hot = r.heat.value;
    for (let i = 0; i < 60; i++) r.update(DT, false);
    expect(r.heat.value).toBeCloseTo(hot - FRAME.rotary.cool, 2);
  });
});

describe('the 40 mm', () => {
  it('has eight shells, then 4.5 s of reload on its own clock', () => {
    const c = new Cannon();
    let shots = 0;
    let last = 0;
    let t = 0;
    for (; t < 3; t += DT) {
      c.mag.update(DT);
      if (c.mag.take()) {
        shots++;
        last = t;
      }
    }
    expect(shots).toBe(8);
    expect(last).toBeGreaterThan(7 * FRAME.cannon.interval);
    expect(c.mag.reloading).toBeGreaterThan(0);
    for (; c.mag.reloading >= 0; t += DT) c.mag.update(DT);
    expect(c.mag.ammo).toBe(8);
    expect(t - last).toBeCloseTo(FRAME.cannon.reload, 1);
  });

  it('cycles HE, AP, flak', () => {
    const c = new Cannon();
    const seen = [c.round];
    for (let i = 0; i < 3; i++) {
      c.cycle();
      seen.push(c.round);
    }
    expect(seen).toEqual(['g40', 'ap', 'flak', 'g40']);
  });
});

describe('the pod', () => {
  const target = (x: number): MissileTarget & { alive: boolean } => ({ center: new THREE.Vector3(x, 1, -30), alive: true });
  const a = target(0);
  const b = target(2);
  const c = target(-2);
  const view: PaintCandidate[] = [{ target: a, angle: 0 }, { target: b, angle: 0.05 }, { target: c, angle: 0.08 }];
  const look = () => view;

  it('paints while held, fires all six on release with spares on the marks, then reloads for 10 s', () => {
    const pod = new Pod();
    const fired: (MissileTarget | null)[] = [];
    let t = 0;
    for (; t < 1.2; t += DT) pod.update(DT, true, look);
    expect(pod.painter.marks.length).toBe(6);
    for (; t < 2; t += DT) {
      pod.update(DT, false, look);
      fired.push(...pod.queue);
    }
    expect(fired.length).toBe(6);
    expect(fired.slice(0, 3)).toEqual([a, b, c]);
    expect(fired.every(f => f !== null)).toBe(true);
    expect(pod.ammo).toBe(0);
    // Held again while it reloads: nothing.
    for (; t < 6; t += DT) pod.update(DT, true, look);
    expect(pod.painter.painting).toBe(false);
    for (; t < 12.6; t += DT) pod.update(DT, false, look);
    expect(pod.ammo).toBe(6);
  });

  it('fires six dumb on a tap', () => {
    const pod = new Pod();
    pod.update(DT, true, look);
    const fired: (MissileTarget | null)[] = [];
    for (let t = 0; t < 1; t += DT) {
      pod.update(DT, false, look);
      fired.push(...pod.queue);
    }
    expect(fired).toEqual([null, null, null, null, null, null]);
  });
});

describe('smoke', () => {
  it('pops three times a beat, never inside the lockout', () => {
    const s = new Smoke();
    expect(s.pop()).toBe(true);
    expect(s.pop()).toBe(false);
    for (let t = 0; t < FRAME.smoke.lockout + 0.1; t += DT) s.update(DT);
    expect(s.pop()).toBe(true);
    for (let t = 0; t < FRAME.smoke.lockout + 0.1; t += DT) s.update(DT);
    expect(s.pop()).toBe(true);
    for (let t = 0; t < FRAME.smoke.lockout + 0.1; t += DT) s.update(DT);
    expect(s.pop()).toBe(false);
    s.reset();
    expect(s.pop()).toBe(true);
  });
});

/** A crowd standing where it is told, and every blow it takes. */
function crowd(places: [number, number][]): { enemies: EnemySystem; blows: Map<EnemyInstance, DamageInfo> } {
  const blows = new Map<EnemyInstance, DamageInfo>();
  const alive = places.map(([x, z], i) => ({
    uid: i, alive: true, position: new THREE.Vector3(x, 0, z), center: new THREE.Vector3(x, 1.2, z),
  }) as unknown as EnemyInstance);
  const enemies = {
    alive,
    query(at: THREE.Vector3, radius: number, out: EnemyInstance[]): number {
      out.length = 0;
      for (const e of alive) if (e.position.distanceTo(at) <= radius) out.push(e);
      return out.length;
    },
    applyDamage(e: EnemyInstance, d: DamageInfo) {
      blows.set(e, { ...d, dir: d.dir.clone(), point: d.point.clone() });
      return { dealt: d.amount, killed: false, headshot: false, severed: [], blocked: false };
    },
  } as unknown as EnemySystem;
  return { enemies, blows };
}

const ring = (r: number, n = 8): [number, number][] => Array.from({ length: n }, (_, i) => [Math.cos(i) * r, Math.sin(i) * r]);

describe('the stomp', () => {
  it('from 4 m knocks everyone in 10 m off their feet, and reaches 14 m, 160 at the middle falling to 40', () => {
    const S = FRAME.stomp;
    const { enemies, blows } = crowd([...ring(1), ...ring(5), ...ring(9.8), ...ring(13), ...ring(15)]);
    const at = new THREE.Vector3();
    stomp(enemies, at, 4);
    expect(blows.size).toBe(32);
    for (const [e, d] of blows) {
      const r = Math.hypot(e.position.x, e.position.z);
      if (r < S.knock) {
        // The big slam's knock, and more: enough to take a man off his feet.
        expect(d.force).toBeGreaterThanOrEqual(420);
        expect(d.dir.y).toBeGreaterThan(0.5);
      } else {
        expect(d.force).toBeLessThan(420);
      }
      expect(d.amount).toBeCloseTo(160 + (40 - 160) * (r / S.radius), 3);
      expect(d.type).toBe('crush');
    }
  });

  it('from lower is half of it', () => {
    const { enemies, blows } = crowd([...ring(4), ...ring(6.5), ...ring(8)]);
    stomp(enemies, new THREE.Vector3(), 3);
    expect(blows.size).toBe(16);
    for (const [e, d] of blows) if (Math.hypot(e.position.x, e.position.z) > 5) expect(d.force).toBeLessThan(420);
  });
});

describe('the blows', () => {
  it('a backhand takes everyone in a 120 degree arc in front within reach, nobody behind or past it', () => {
    const { enemies, blows } = crowd([[0, -3], [3, -3], [-3, -3], [0, 3], [0, -7], [5, 0.5]]);
    expect(backhand(enemies, new THREE.Vector3(), 0)).toBe(3);
    expect([...blows.keys()].map(e => e.uid).sort()).toEqual([0, 1, 2]);
    for (const d of blows.values()) expect(d.amount).toBe(FRAME.backhand.damage);
  });

  it('a charge strikes each man once, however long he is in front of it', () => {
    const { enemies, blows } = crowd([[0, -2], [1, -2.5]]);
    const hit = new Set<number>();
    const dir = new THREE.Vector3(0, 0, -1);
    expect(shove(enemies, new THREE.Vector3(0, 1, -2), dir, hit)).toBe(2);
    expect(shove(enemies, new THREE.Vector3(0, 1, -2), dir, hit)).toBe(0);
    for (const d of blows.values()) expect(d.dir.z).toBeLessThan(-0.5);
  });

  it('a foot crushes only who it lands on', () => {
    const { enemies, blows } = crowd([[0, 0.5], [0, 2.5]]);
    expect(crush(enemies, new THREE.Vector3())).toBe(1);
    expect([...blows.values()][0]!.gib).toBe(true);
  });
});
