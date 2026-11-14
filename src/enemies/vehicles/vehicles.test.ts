/** Section 17 as arithmetic, and how the machines move. No renderer: the armour rules and the driver are plain numbers. */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MissionRunner } from '../../campaign/runner';
import { FakeHost } from '../../campaign/testkit';
import type { Mission } from '../../campaign/types';
import { wrapAngle } from '../../core/math';
import { FlightPath, type FlightMark } from '../../vehicles/flight';
import { WEAPONS } from '../../weapons/data';
import { bulletDamage, directDamage, splashDamage } from './armour';
import { CHOPPER, HUMVEE, SOFT_FIRE_AT, TANK, TRUCK, type GroundDef, type PartDef, type VehicleDef } from './data';
import { Driver, type RoutePoint } from './drive';

const part = (def: VehicleDef, id: string): PartDef => def.parts.find(p => p.id === id)!;
const ROCKET = WEAPONS.rocket.damage;
const CANNON = WEAPONS.autocannon.damage;

describe('armour', () => {
  it('bullets do nothing to a tank, wherever they land', () => {
    for (const p of TANK.parts) {
      expect(bulletDamage(TANK, p, 420, 'lance')).toBe(0);
      expect(bulletDamage(TANK, p, 13, 'door_gun')).toBe(0);
    }
  });

  it('bullets do nothing to a chopper, except the door gun on its thin skin', () => {
    for (const p of CHOPPER.parts) expect(bulletDamage(CHOPPER, p, 25, 'smg')).toBe(0);
    expect(bulletDamage(CHOPPER, part(CHOPPER, 'tail'), 13, 'door_gun')).toBeGreaterThan(0);
    expect(bulletDamage(CHOPPER, part(CHOPPER, 'body'), 13, 'door_gun')).toBe(0);
  });

  it('the Sabot goes through armour anywhere, but a tank still takes a pile of darts', () => {
    const SABOT = WEAPONS.sabot.damage;
    const darts = (def: VehicleDef, id: string): number => Math.ceil(def.health / bulletDamage(def, part(def, id), SABOT, 'sabot'));
    for (const p of [...TANK.parts, ...CHOPPER.parts]) expect(bulletDamage(TANK, p, SABOT, 'sabot')).toBeGreaterThan(0);
    expect(darts(TANK, 'hull')).toBeGreaterThanOrEqual(15);
    expect(darts(CHOPPER, 'body')).toBeGreaterThanOrEqual(10);
    // A track is a pool of its own, and a few darts break it.
    const track = part(TANK, 'trackLeft');
    expect(Math.ceil(track.pool / bulletDamage(TANK, track, SABOT, 'sabot'))).toBeLessThanOrEqual(5);
  });

  it('a soft-skin dies to about a magazine or two of gunfire', () => {
    const rounds = (def: GroundDef, id: string): number => def.health / bulletDamage(def, part(def, id), WEAPONS.smg.damage, 'smg');
    expect(rounds(HUMVEE, 'cab')).toBeGreaterThan(20);
    expect(rounds(TRUCK, 'bed')).toBeLessThan(60);
    expect(rounds(TRUCK, 'engine')).toBeLessThan(rounds(TRUCK, 'bed'));
  });

  it('one good rocket puts a soft-skin on fire or kills it outright', () => {
    for (const def of [HUMVEE, TRUCK]) {
      for (const p of def.parts) {
        const dealt = directDamage(def, p, ROCKET, 'rocket', 'rocket') + splashDamage(def, ROCKET, 'rocket', 'rocket');
        expect(def.health - dealt).toBeLessThanOrEqual(def.health * SOFT_FIRE_AT);
      }
    }
  });

  it('a direct rocket does several times what the same rocket does beside it', () => {
    const direct = directDamage(TANK, part(TANK, 'hull'), ROCKET, 'rocket', 'rocket');
    const near = splashDamage(TANK, ROCKET, 'rocket', 'rocket');
    expect(direct / near).toBeGreaterThanOrEqual(4);
  });

  it('a tank takes more than one rocket and fewer than a full launcher', () => {
    const each = directDamage(TANK, part(TANK, 'hull'), ROCKET, 'rocket', 'rocket') + splashDamage(TANK, ROCKET, 'rocket', 'rocket');
    expect(TANK.health / each).toBeGreaterThan(3);
    expect(TANK.health / each).toBeLessThan(WEAPONS.rocket.reserve);
  });

  it('the engine is the soft part, and a rocket on a track breaks it', () => {
    expect(directDamage(TANK, part(TANK, 'engine'), ROCKET, 'rocket', 'rocket')).toBeGreaterThan(directDamage(TANK, part(TANK, 'hull'), ROCKET, 'rocket', 'rocket'));
    const track = part(TANK, 'trackLeft');
    expect(Math.ceil(track.pool / directDamage(TANK, track, ROCKET, 'rocket', 'rocket'))).toBeLessThanOrEqual(2);
  });

  it('a perfect autocannon round into the cockpit ends a chopper, and into the body does not', () => {
    expect(directDamage(CHOPPER, part(CHOPPER, 'cockpit'), CANNON, 'shell', 'autocannon')).toBeGreaterThanOrEqual(CHOPPER.health);
    expect(directDamage(CHOPPER, part(CHOPPER, 'body'), CANNON, 'shell', 'autocannon')).toBeLessThan(CHOPPER.health);
  });

  it('a rocket on the small tail takes it off, the wide rotor takes two, and the Harrow has to work for it', () => {
    const rocket = (id: string): number => directDamage(CHOPPER, part(CHOPPER, id), ROCKET, 'rocket', 'rocket') + splashDamage(CHOPPER, ROCKET, 'rocket', 'rocket');
    expect(rocket('tail')).toBeGreaterThanOrEqual(part(CHOPPER, 'tail').pool);
    expect(rocket('rotor')).toBeLessThan(part(CHOPPER, 'rotor').pool);
    expect(rocket('rotor') * 2).toBeGreaterThanOrEqual(part(CHOPPER, 'rotor').pool);
    expect(directDamage(CHOPPER, part(CHOPPER, 'rotor'), 100, 'shell', 'chopper_cannon')).toBeLessThan(part(CHOPPER, 'rotor').pool / 4);
  });

  it('nothing one-shots a tank by accident', () => {
    expect(splashDamage(TANK, Infinity, 'grenade', 'perk')).toBeLessThan(TANK.health);
    expect(splashDamage(TANK, Infinity, 'rocket', 'rocket')).toBeLessThan(TANK.health);
  });
});

function drive(def: GroundDef, route: RoutePoint[], seconds: number, step: number, setup?: (d: Driver) => void): Driver {
  const d = new Driver(def.drive);
  const first = route[0]!;
  const yaw = Math.atan2(first.x, first.z);
  d.begin(0, 0, yaw, route);
  setup?.(d);
  for (let i = Math.round(seconds / step); i > 0; i--) d.update(step, Infinity);
  return d;
}

describe('the driver', () => {
  const straight: RoutePoint[] = [{ x: 0, z: 60, hold: 0 }];

  it('arrives and stops, and gets there by braking', () => {
    const d = drive(TRUCK, straight, 14, 1 / 60);
    expect(d.done).toBe(true);
    expect(Math.abs(d.speed)).toBeLessThan(0.2);
    expect(Math.hypot(d.x, d.z - 60)).toBeLessThan(3);
  });

  it('takes time to get going: a tank is slower off the line than a scout car', () => {
    const car = drive(HUMVEE, straight, 3, 1 / 60);
    const tank = drive(TANK, straight, 3, 1 / 60);
    expect(tank.z).toBeLessThan(car.z * 0.6);
    expect(tank.speed).toBeLessThan(TANK.drive.top);
  });

  it('is the same at 30 and 144 frames a second', () => {
    const slow = drive(TRUCK, [{ x: 0, z: 20, hold: 0 }, { x: 30, z: 40, hold: 0 }], 5, 1 / 30);
    const fast = drive(TRUCK, [{ x: 0, z: 20, hold: 0 }, { x: 30, z: 40, hold: 0 }], 5, 1 / 144);
    expect(Math.hypot(slow.x - fast.x, slow.z - fast.z)).toBeLessThan(0.3);
  });

  it('does not orbit a mark inside its turning circle', () => {
    const d = drive(TRUCK, [{ x: 12, z: 2, hold: 0 }], 12, 1 / 60);
    expect(d.done).toBe(true);
  });

  it('dips its nose under braking, and sits back under power', () => {
    const d = new Driver(TRUCK.drive);
    d.begin(0, 0, 0, [{ x: 0, z: 200, hold: 0 }]);
    for (let t = 0; t < 0.8; t += 1 / 60) d.update(1 / 60, Infinity);
    expect(d.pitch).toBeLessThan(0);
    for (let t = 0; t < 5; t += 1 / 60) d.update(1 / 60, Infinity);
    for (let t = 0; t < 0.6; t += 1 / 60) d.update(1 / 60, 0);
    expect(d.pitch).toBeGreaterThan(0);
  });

  it('stops short of something parked in the road', () => {
    const d = new Driver(TRUCK.drive);
    d.begin(0, 0, 0, [{ x: 0, z: 200, hold: 0 }]);
    for (let t = 0; t < 30; t += 1 / 60) d.update(1 / 60, Math.max(0, 40 - d.z));
    expect(d.z).toBeGreaterThan(36);
    expect(d.z).toBeLessThan(41);
    expect(Math.abs(d.speed)).toBeLessThan(0.3);
  });

  it('reverses tail first, then turns on its tracks to face the way it was told', () => {
    const d = new Driver(TANK.drive);
    d.begin(0, 0, Math.PI, [{ x: 0, z: 14, hold: 0 }]);
    d.reversing = true;
    d.face(Math.PI / 2);
    for (let t = 0; t < 14; t += 1 / 60) d.update(1 / 60, Infinity);
    expect(d.done).toBe(true);
    expect(Math.hypot(d.x, d.z - 14)).toBeLessThan(2);
    expect(Math.abs(wrapAngle(d.yaw - Math.PI / 2))).toBeLessThan(0.1);
  });

  it('coasts to a stop with nobody at the wheel', () => {
    const d = new Driver(TRUCK.drive);
    d.begin(0, 0, 0, [{ x: 0, z: 200, hold: 0 }]);
    for (let t = 0; t < 4; t += 1 / 60) d.update(1 / 60, Infinity);
    d.coasting = true;
    const at = d.z;
    for (let t = 0; t < 8; t += 1 / 60) d.update(1 / 60, Infinity);
    expect(d.z).toBeGreaterThan(at);
    expect(Math.abs(d.speed)).toBeLessThan(0.05);
  });
});

describe('scenery on a mission', () => {
  it('goes on nobody\'s books', () => {
    const m: Mission = {
      id: 'test', title: 'Test', loadout: { weapons: ['smg'], grenades: 0 }, zones: {}, marks: { a: { at: [1, 2, 3] } }, routes: {}, doors: {}, cutscenes: {}, lines: [], redeployLines: [],
      beats: [{ id: 'a', title: 'A', start: [{ do: 'vehicle', tag: 'old', kind: 'tank', at: 'a', state: 'wrecked' }], until: { after: 99 } }],
    };
    const host = new FakeHost();
    const run = new MissionRunner(m, host);
    run.start();
    expect(host.log).toContain('vehicle old');
    expect(run.left('old')).toBe(0);
  });
});

describe('a fixed flight', () => {
  const mark = (x: number, z: number, hold = 0, name = ''): FlightMark => ({ x, y: 30, z, hold, name, hit: false });
  const marks = [mark(0, 0), mark(100, 0, 0, 'a'), mark(200, 0, 10, 'b'), mark(200, 100, 0, 'c')];
  const path = new FlightPath(marks, 14);
  const v = new THREE.Vector3();

  it('takes about as long as its length and its hovers', () => {
    expect(path.ends).toBeGreaterThan(300 / 14 + 10);
    expect(path.ends).toBeLessThanOrEqual((300 / 14) * 1.45 + 10);
  });

  it('passes through its marks, and stays on one for its hold', () => {
    const arrive = path.arrival(2);
    expect(path.at(arrive, v).distanceTo(new THREE.Vector3(200, 30, 0))).toBeLessThan(0.01);
    expect(path.at(arrive + 9, v).distanceTo(new THREE.Vector3(200, 30, 0))).toBeLessThan(0.01);
    expect(path.at(path.ends, v).distanceTo(new THREE.Vector3(200, 30, 100))).toBeLessThan(0.01);
  });

  it('points along the way it is going, and does not swing in a hover', () => {
    expect(path.heading(path.arrival(1), v).x).toBeGreaterThan(0.9);
    const stopped = path.heading(path.arrival(2) + 1, new THREE.Vector3()).clone();
    expect(path.heading(path.arrival(2) + 8, v).distanceTo(stopped)).toBeLessThan(1e-6);
  });

  it('never jumps', () => {
    const a = new THREE.Vector3();
    let worst = 0;
    path.at(0, v);
    for (let t = 0; t < path.ends; t += 0.05) {
      path.at(t, a);
      worst = Math.max(worst, a.distanceTo(v) / 0.05);
      v.copy(a);
    }
    expect(worst).toBeLessThan(30);
  });
});
