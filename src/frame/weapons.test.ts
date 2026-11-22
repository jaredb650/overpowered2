/** The Frame's clocks (heat, magazines, the pod, smoke) and its blows, counted on a stand-in crowd. */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Ctx, DamageInfo } from '../core/contracts';
import type { EnemyInstance, EnemySystem, MissileTarget } from '../core/gameplay';
import type { Ac130Rounds } from '../progression/callins/ac130Rounds';
import type { PaintCandidate } from '../weapons/swarm';
import { FRAME } from './data';
import {
  airburstPoint, backhand, Cannon, crush, FrameGuns, Howitzer, howitzerShockwave,
  Pod, Rotary, shove, Smoke, smokePulse, stomp, trample, type Arm, type Sight,
} from './weapons';

const DT = 1 / 60;

describe('the rotary', () => {
  it('fires 24 a second once spun up, overheats in about 6.8 s, vents in about 2.2 s, and is locked out meanwhile', () => {
    const r = new Rotary();
    let rounds = 0;
    let t = 0;
    for (; !r.heat.overheated && t < 20; t += DT) rounds += r.update(DT, true);
    expect(t).toBeGreaterThan(6.3);
    expect(t).toBeLessThan(7.4);
    // 160 rounds of heat, give or take the last one's rounding.
    expect(rounds).toBeGreaterThanOrEqual(160);
    expect(rounds).toBeLessThanOrEqual(161);
    let locked = 0;
    for (; r.heat.overheated && locked < 10; locked += DT) expect(r.update(DT, true)).toBe(0);
    expect(locked).toBeGreaterThan(1.9);
    expect(locked).toBeLessThan(2.6);
  });

  it('spins up before it fires, and cools off the trigger', () => {
    const r = new Rotary();
    let first = -1;
    for (let t = 0; first < 0; t += DT) if (r.update(DT, true) > 0) first = t;
    expect(first).toBeGreaterThan(0.14);
    expect(first).toBeLessThan(0.28);
    for (let i = 0; i < 240; i++) r.update(DT, true);
    const hot = r.heat.value;
    for (let i = 0; i < 60; i++) r.update(DT, false);
    expect(r.heat.value).toBeCloseTo(hot - FRAME.rotary.cool, 2);
  });

  it('cycles between standard and airburst mode on tap (1 left / 2 right) and slows cadence to 16/s', () => {
    const r = new Rotary();
    expect(r.mode).toBe('standard');
    expect(r.rate).toBe(FRAME.rotary.rate);
    expect(r.cycle()).toBe('airburst');
    expect(r.mode).toBe('airburst');
    expect(r.rate).toBe(FRAME.rotaryAirburst.rate);
    // Airburst fire rate over 1 second after spin-up is ~16 rounds/s.
    for (let i = 0; i < 30; i++) r.update(DT, true);
    let burstRounds = 0;
    for (let i = 0; i < 60; i++) burstRounds += r.update(DT, true);
    expect(burstRounds).toBeGreaterThanOrEqual(15);
    expect(burstRounds).toBeLessThanOrEqual(17);
    expect(r.cycle()).toBe('standard');
    expect(r.mode).toBe('standard');
  });

  it('airburst proximity fuse detonates ahead of infantry within prox radius and respects walls', () => {
    const { enemies } = crowd([[0, -20], [5, -20]]);
    const origin = new THREE.Vector3(0, 1.2, 0);
    const dir = new THREE.Vector3(0, 0, -1);
    const out = new THREE.Vector3();
    // Triggers ahead of the on-axis enemy at z = -20.
    expect(airburstPoint(origin, dir, 100, enemies, out)).toBe(true);
    expect(out.z).toBeCloseTo(-(20 - FRAME.rotaryAirburst.standoff), 2);
    // Does not penetrate a wall in front of the enemy (maxDist = 12 < 20).
    expect(airburstPoint(origin, dir, 12, enemies, out)).toBe(false);
    // Off-axis enemy outside prox (x = 5 > 2.6 m) does not trigger when aiming down x = 10.
    expect(airburstPoint(new THREE.Vector3(10, 1.2, 0), dir, 100, enemies, out)).toBe(false);
    // Off-axis enemy inside prox (x = 2.0 <= 2.6 m) still triggers.
    expect(airburstPoint(new THREE.Vector3(2.0, 1.2, 0), dir, 100, enemies, out)).toBe(true);
  });
});

describe('the 40 mm', () => {
  it('has ten shells, then 3.8 s of reload on its own clock', () => {
    const c = new Cannon();
    let shots = 0;
    let last = 0;
    let t = 0;
    for (; t < 3.5; t += DT) {
      c.mag.update(DT);
      if (c.mag.take()) {
        shots++;
        last = t;
      }
    }
    expect(shots).toBe(FRAME.cannon.magazine);
    expect(last).toBeGreaterThan((FRAME.cannon.magazine - 1) * FRAME.cannon.interval);
    expect(c.mag.reloading).toBeGreaterThan(0);
    for (; c.mag.reloading >= 0; t += DT) c.mag.update(DT);
    expect(c.mag.ammo).toBe(FRAME.cannon.magazine);
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

describe('the 105 mm howitzer upgrade', () => {
  it('fires a single monolithic shell and auto-reloads in 3.1 s', () => {
    const h = new Howitzer();
    expect(h.mag.ammo).toBe(1);
    expect(h.mag.ready).toBe(true);
    expect(h.mag.take()).toBe(true);
    expect(h.mag.ammo).toBe(0);
    expect(h.mag.ready).toBe(false);
    expect(h.mag.reloading).toBeCloseTo(FRAME.howitzer.reload, 3);
    expect(h.mag.take()).toBe(false);
    let t = 0;
    for (; h.mag.reloading >= 0 && t < 5; t += DT) h.mag.update(DT);
    expect(h.mag.ammo).toBe(1);
    expect(h.mag.ready).toBe(true);
    expect(t).toBeCloseTo(FRAME.howitzer.reload, 1);
  });

  it('shockwave flings everyone within 22 m and spares those beyond', () => {
    const { enemies, blows } = crowd([[0, -5], [0, -18], [0, -26]]);
    expect(howitzerShockwave(enemies, new THREE.Vector3())).toBe(2);
    expect([...blows.keys()].map(e => e.uid).sort()).toEqual([0, 1]);
    expect(blows.get(enemies.alive[0]!)!.gib).toBe(true);
    expect(blows.get(enemies.alive[1]!)!.dir.y).toBeGreaterThan(0.45);
    expect(blows.get(enemies.alive[1]!)!.source).toBe('frame_howitzer');
  });

  it('FrameGuns.installArmWeapon permanently replaces 40 mm with 105 mm Howitzer, ignores R cycling, and updates HUD labels', () => {
    const down = new Set<string>();
    const pressed = new Set<string>();
    const firedRounds: string[] = [];
    const callouts: string[] = [];
    const ctx = {
      input: { isDown: (a: string) => down.has(a), pressed: (a: string) => pressed.has(a) },
      audio: { play: () => undefined, startLoop: () => ({ stop: () => undefined, setPitch: () => undefined }) },
      hud: { callout: (t: string) => callouts.push(t) },
      fx: { muzzleFlash: () => undefined, ring: () => undefined, smoke: () => undefined, sparks: () => undefined, shellCasing: () => undefined, tracer: () => undefined },
      camera: { addTrauma: () => undefined, kick: () => undefined },
      combat: { fireRay: () => undefined, explode: () => undefined, spawnProjectile: () => undefined },
      enemies: { alive: [], query: () => 0, vehicles: null },
      physics: { raycast: () => null, raycastInto: () => false },
      render: { lights: { flash: () => undefined } },
    } as unknown as Ctx;
    const rounds = {
      onImpact: null,
      fire: (kind: string) => firedRounds.push(kind),
      flash: () => undefined,
      update: () => undefined,
      clear: () => undefined,
    } as unknown as Ac130Rounds;
    const arm: Arm = {
      muzzle: out => out.set(1, 3, 0),
      bore: out => out.set(0, 0, -1),
      turn: () => undefined,
      recoil: () => undefined,
    };
    const sight: Sight = {
      view: { position: new THREE.Vector3(0, 5, 0) } as Sight['view'],
      aim: new THREE.Vector3(0, 0, -1),
      point: new THREE.Vector3(0, 1, -40),
      range: 40,
    };
    const guns = new FrameGuns(ctx, rounds, arm, arm, out => out.set(1, 5, 0));
    expect(guns.rows[0]!.name).toBe('LMB ROTARY [STD] // 1');
    expect(guns.rows[1]!.name).toContain('RMB 40MM HE');
    // Tap 1 cycles left arm (rotary) to airburst and updates HUD + callout.
    pressed.add('weapon1');
    guns.update(DT, sight);
    pressed.clear();
    expect(guns.rotary.mode).toBe('airburst');
    expect(guns.rows[0]!.name).toBe('LMB ROTARY [AIRBURST] // 1');
    expect(callouts).toContain('LEFT ROTARY // AIRBURST');
    // Install 105 mm Howitzer.
    guns.installArmWeapon('howitzer105');
    expect(guns.armWeapon).toBe('howitzer105');
    expect(guns.rows[1]!.name).toBe('RMB 105MM HOWITZER');
    expect(guns.rows[1]!.ammo).toBe(1);
    expect(guns.rows[1]!.max).toBe(1);
    // Pressing 2 does not cycle 40 mm rounds when 105 mm Howitzer is installed on the right arm.
    const roundBefore = guns.cannon.round;
    pressed.add('weapon2');
    guns.update(DT, sight);
    pressed.clear();
    expect(guns.cannon.round).toBe(roundBefore);
    expect(guns.rows[1]!.name).toBe('RMB 105MM HOWITZER');
    // Firing RMB launches 'g105' and immediately starts reload (ammo 0, reload >= 0).
    down.add('aim');
    guns.update(DT, sight);
    down.delete('aim');
    expect(firedRounds).toEqual(['g105']);
    expect(guns.howitzer.mag.ammo).toBe(0);
    expect(guns.rows[1]!.ammo).toBe(0);
    expect(guns.rows[1]!.reload).toBeGreaterThanOrEqual(0);
  });
});

describe('the pod', () => {
  const target = (x: number): MissileTarget & { alive: boolean } => ({ center: new THREE.Vector3(x, 1, -30), alive: true });
  const a = target(0);
  const b = target(2);
  const c = target(-2);
  const view: PaintCandidate[] = [{ target: a, angle: 0 }, { target: b, angle: 0.05 }, { target: c, angle: 0.08 }];
  const look = () => view;

  it('paints while held, fires all six on release with spares on the marks, then reloads', () => {
    const pod = new Pod();
    const fired: (MissileTarget | null)[] = [];
    let t = 0;
    for (; t < 1.0; t += DT) pod.update(DT, true, look);
    expect(pod.painter.marks.length).toBe(6);
    for (; t < 1.8; t += DT) {
      pod.update(DT, false, look);
      fired.push(...pod.queue);
    }
    expect(fired.length).toBe(6);
    expect(fired.slice(0, 3)).toEqual([a, b, c]);
    expect(fired.every(f => f !== null)).toBe(true);
    expect(pod.ammo).toBe(0);
    // Held again while it reloads: nothing.
    for (; t < 5; t += DT) pod.update(DT, true, look);
    expect(pod.painter.painting).toBe(false);
    for (; t < 11.2; t += DT) pod.update(DT, false, look);
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
  it('pops three charges outside lockout, then regenerates charges over time', () => {
    const s = new Smoke();
    expect(s.pop()).toBe(true);
    expect(s.pop()).toBe(false);
    for (let t = 0; t < FRAME.smoke.lockout + 0.1; t += DT) s.update(DT);
    expect(s.pop()).toBe(true);
    for (let t = 0; t < FRAME.smoke.lockout + 0.1; t += DT) s.update(DT);
    expect(s.pop()).toBe(true);
    for (let t = 0; t < FRAME.smoke.lockout + 0.1; t += DT) s.update(DT);
    expect(s.pop()).toBe(false);
    // Wait out the recharge clock and verify a charge refills automatically.
    for (let t = 0; t < FRAME.smoke.refill; t += DT) s.update(DT);
    expect(s.count).toBeGreaterThanOrEqual(1);
    expect(s.pop()).toBe(true);
    s.reset();
    expect(s.count).toBe(FRAME.smoke.count);
  });

  it('concussive pulse shoves enemies crowding within blastRadius', () => {
    const { enemies, blows } = crowd([[0, -3], [4, 2], [0, -10]]);
    expect(smokePulse(enemies, new THREE.Vector3())).toBe(2);
    expect([...blows.keys()].map(e => e.uid).sort()).toEqual([0, 1]);
    for (const d of blows.values()) expect(d.force).toBeGreaterThan(200);
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
  it('from 4 m knocks everyone in 12 m off their feet, and reaches 16 m, 240 at the middle falling to 60', () => {
    const S = FRAME.stomp;
    const { enemies, blows } = crowd([...ring(1), ...ring(6), ...ring(11.5), ...ring(15), ...ring(17.5)]);
    const at = new THREE.Vector3();
    stomp(enemies, at, 4);
    expect(blows.size).toBe(32);
    for (const [e, d] of blows) {
      const r = Math.hypot(e.position.x, e.position.z);
      if (r < S.knock) {
        expect(d.force).toBeGreaterThanOrEqual(420);
        expect(d.dir.y).toBeGreaterThan(0.5);
      } else {
        expect(d.force).toBeLessThan(420);
      }
      expect(d.amount).toBeCloseTo(S.center + (S.edge - S.center) * (r / S.radius), 3);
      expect(d.type).toBe('crush');
    }
  });

  it('from lower uses the small multiplier', () => {
    const { enemies, blows } = crowd([...ring(4), ...ring(7.5), ...ring(10)]);
    stomp(enemies, new THREE.Vector3(), 3);
    expect(blows.size).toBe(16);
    for (const [e, d] of blows) if (Math.hypot(e.position.x, e.position.z) > FRAME.stomp.knock * FRAME.stomp.small) {
      expect(d.force).toBeLessThan(420);
    }
  });
});

describe('the blows', () => {
  it('a backhand sweeps a 190-degree front arc to 7.2 m PLUS a 360-degree 4 m close sweep around the legs', () => {
    // 0: front 3 m, 1: front-right 5 m, 2: front-left 5 m, 3: behind 3 m (close 360 sweep!), 4: behind 5.2 m (miss), 5: front 8.5 m (miss).
    const { enemies, blows } = crowd([[0, -3], [4, -3], [-4, -3], [0, 3], [0, 5.2], [0, -8.5]]);
    expect(backhand(enemies, new THREE.Vector3(), 0)).toBe(4);
    expect([...blows.keys()].map(e => e.uid).sort()).toEqual([0, 1, 2, 3]);
    for (const d of blows.values()) expect(d.amount).toBe(FRAME.backhand.damage);
    // Close enemies get gibbed.
    expect(blows.get(enemies.alive[3]!)!.gib).toBe(true);
  });

  it('a charge strikes each man once, however long he is in front of it', () => {
    const { enemies, blows } = crowd([[0, -2], [1, -2.5]]);
    const hit = new Set<number>();
    const dir = new THREE.Vector3(0, 0, -1);
    expect(shove(enemies, new THREE.Vector3(0, 1, -2), dir, hit)).toBe(2);
    expect(shove(enemies, new THREE.Vector3(0, 1, -2), dir, hit)).toBe(0);
    for (const d of blows.values()) expect(d.dir.z).toBeLessThan(-0.5);
  });

  it('a foot crushes only who it lands on, and walking tramples enemies hugging the ankles on a cooldown', () => {
    const { enemies, blows } = crowd([[0, 0.8], [0, 3.5]]);
    expect(crush(enemies, new THREE.Vector3())).toBe(1);
    expect([...blows.values()][0]!.gib).toBe(true);
    blows.clear();
    const last = new Map<number, number>();
    expect(trample(enemies, new THREE.Vector3(), last, 1.0)).toBe(1);
    expect(trample(enemies, new THREE.Vector3(), last, 1.2)).toBe(0);
    expect(trample(enemies, new THREE.Vector3(), last, 1.6)).toBe(1);
  });
});
