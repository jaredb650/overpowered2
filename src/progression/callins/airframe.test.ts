import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ASSIST_SOURCES, CALLIN_ORDER, CALLINS } from '../data';
import { AC130 } from './ac130Data';
import { OrbitPath, flightDelay, soundPoint } from './airframe';

const flat = (p: THREE.Vector3, c: THREE.Vector3) => Math.hypot(p.x - c.x, p.z - c.z);

function path(): OrbitPath {
  const orbit = new OrbitPath(AC130.orbit);
  orbit.begin(new THREE.Vector3(10, 4, -6), 1);
  return orbit;
}

describe('OrbitPath', () => {
  it('holds radius and altitude for the whole time on station', () => {
    const o = path();
    const p = new THREE.Vector3();
    for (let t = o.holdsFrom; t <= o.holdsUntil; t += 3.7) {
      o.at(t, p);
      expect(flat(p, o.center)).toBeCloseTo(AC130.orbit.radius, 3);
      expect(p.y).toBeCloseTo(o.center.y + AC130.orbit.altitude, 3);
    }
  });

  it('arrives at the angle it was told to', () => {
    const o = path();
    const p = o.at(o.holdsFrom, new THREE.Vector3());
    expect(Math.atan2(p.z - o.center.z, p.x - o.center.x)).toBeCloseTo(1, 5);
  });

  it('comes in from far off and leaves further and higher', () => {
    const o = path();
    const start = o.at(0, new THREE.Vector3());
    const end = o.at(o.ends, new THREE.Vector3());
    expect(flat(start, o.center)).toBeCloseTo(AC130.orbit.radius + AC130.orbit.entryReach, 3);
    expect(flat(end, o.center)).toBeCloseTo(AC130.orbit.radius + AC130.orbit.exitReach, 3);
    expect(end.y).toBeGreaterThan(start.y);
  });

  it('has no jump anywhere along the flight', () => {
    const o = path();
    const a = new THREE.Vector3();
    const b = o.at(0, new THREE.Vector3());
    for (let t = 0.05; t < o.ends; t += 0.05) {
      o.at(t, a);
      expect(a.distanceTo(b)).toBeLessThan(0.05 * 260);
      b.copy(a);
    }
  });

  it('keeps the gun side toward the middle, rolled down into the turn', () => {
    const o = path();
    const p = new THREE.Vector3();
    const f = new THREE.Vector3();
    const left = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const toCentre = new THREE.Vector3();
    for (let t = o.holdsFrom; t <= o.holdsUntil; t += 11) {
      o.at(t, p);
      o.heading(t, f);
      left.crossVectors(up, f);
      toCentre.subVectors(o.center, p).setY(0).normalize();
      expect(left.dot(toCentre)).toBeGreaterThan(0.99);
      expect(o.roll(t)).toBeCloseTo(-AC130.orbit.bank, 5);
    }
  });

  it('flies wings level when it arrives and when it has gone', () => {
    const o = path();
    expect(o.roll(0)).toBeCloseTo(0, 5);
    expect(o.roll(o.ends)).toBeCloseTo(0, 5);
  });
});

describe('soundPoint', () => {
  it('sits on the true bearing at the given range and reports the true distance', () => {
    const out = new THREE.Vector3();
    const listener = new THREE.Vector3(1, 2, 3);
    const source = new THREE.Vector3(1, 302, 3);
    expect(soundPoint(source, listener, 30, out)).toBeCloseTo(300, 5);
    expect(out.distanceTo(listener)).toBeCloseTo(30, 5);
    expect(out.y).toBeCloseTo(32, 5);
  });

  it('takes sound about a second to come down from the circle', () => {
    expect(flightDelay(343)).toBeCloseTo(1, 5);
  });
});

describe('the gunship on the ladder', () => {
  it('sits between the Warthog and Black Sun, in order', () => {
    const combos = CALLIN_ORDER.map(id => CALLINS[id].combo);
    expect(combos).toEqual([...combos].sort((a, b) => a - b));
    expect(CALLINS.ac130.combo).toBeGreaterThan(CALLINS.warthog.combo);
    expect(CALLINS.ac130.combo).toBeLessThan(CALLINS.blackSun.combo);
  });

  it('cannot be earned again while the one airframe is still flying', () => {
    const { entrySeconds, holdSeconds, exitSeconds } = AC130.orbit;
    expect(CALLINS.ac130.cooldown).toBeGreaterThan(entrySeconds + holdSeconds + exitSeconds);
  });

  it('stays on station for two minutes', () => {
    expect(AC130.orbit.holdSeconds).toBe(120);
  });

  it('pays at the assist rate for every weapon', () => {
    for (const source of ['ac130_25mm', 'ac130_40mm', 'ac130_105mm', 'ac130_hellfire']) expect(ASSIST_SOURCES.test(source)).toBe(true);
  });

  it('opens with one gun and only ever adds more', () => {
    const { phases } = AC130;
    expect(phases[0]!.at).toBe(0);
    expect(phases[0]!.boforsGap + phases[0]!.howitzerGap + phases[0]!.hellfireGap).toBe(0);
    const up = (p: (typeof phases)[number]) => [p.gatlingGap, p.boforsGap, p.howitzerGap, p.hellfireGap].filter(g => g > 0).length;
    for (let i = 1; i < phases.length; i++) {
      expect(phases[i]!.at).toBeGreaterThan(phases[i - 1]!.at);
      expect(up(phases[i]!)).toBeGreaterThanOrEqual(up(phases[i - 1]!));
      expect(phases[i]!.gatlingGap).toBeLessThan(phases[i - 1]!.gatlingGap);
    }
  });
});
