import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Autopilot, type PilotPlan } from './pilot';

const PLAN: PilotPlan = {
  standoff: 40, altitude: 30, clearance: 10, cruise: 15, dash: 50, response: 1.2, climb: 0.9, turn: 2,
  lean: 0.02, maxRoll: 0.5, maxPitch: 0.3, reverse: [12, 20], limit: 200,
};

const flat = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z);

function flown(plan: PilotPlan = PLAN): Autopilot {
  const pilot = new Autopilot(plan);
  pilot.begin(new THREE.Vector3(180, 30, 0), new THREE.Vector3(-1, 0, 0));
  return pilot;
}

describe('Autopilot', () => {
  it('runs in and settles on a circle at its standoff', () => {
    const pilot = flown();
    const focus = new THREE.Vector3(0, 0, 0);
    for (let i = 0; i < 60 * 20; i++) pilot.update(1 / 60, focus, 0);
    for (let i = 0; i < 60 * 15; i++) {
      pilot.update(1 / 60, focus, 0);
      expect(flat(pilot.position, focus)).toBeGreaterThan(PLAN.standoff * 0.7);
      expect(flat(pilot.position, focus)).toBeLessThan(PLAN.standoff * 1.35);
    }
  });

  it('keeps moving around the target and does not just hover', () => {
    const pilot = flown();
    const focus = new THREE.Vector3(0, 0, 0);
    for (let i = 0; i < 60 * 20; i++) pilot.update(1 / 60, focus, 0);
    let travelled = 0;
    const last = pilot.position.clone();
    for (let i = 0; i < 60 * 6; i++) {
      pilot.update(1 / 60, focus, 0);
      travelled += flat(pilot.position, last);
      last.copy(pilot.position);
    }
    expect(travelled).toBeGreaterThan(40);
  });

  it('banks into the circle while the nose stays on the target', () => {
    const pilot = flown();
    const focus = new THREE.Vector3(0, 0, 0);
    for (let i = 0; i < 60 * 8; i++) pilot.update(1 / 60, focus, 0);
    let bank = 0;
    for (let i = 0; i < 60 * 4; i++) {
      pilot.update(1 / 60, focus, 0);
      bank = Math.max(bank, Math.abs(pilot.roll));
    }
    expect(bank).toBeGreaterThan(0.12);
    expect(bank).toBeLessThanOrEqual(PLAN.maxRoll);
    const toFocus = focus.clone().sub(pilot.position).setY(0).normalize();
    expect(pilot.forward.clone().setY(0).normalize().dot(toFocus)).toBeGreaterThan(0.7);
  });

  it('follows the fight when it moves', () => {
    const pilot = flown();
    const focus = new THREE.Vector3(0, 0, 0);
    for (let i = 0; i < 60 * 12; i++) pilot.update(1 / 60, focus, 0);
    focus.set(-150, 0, 90);
    for (let i = 0; i < 60 * 12; i++) pilot.update(1 / 60, focus, 0);
    expect(flat(pilot.position, focus)).toBeLessThan(PLAN.standoff * 1.5);
  });

  it('holds its lowest altitude over flat ground and climbs over anything tall', () => {
    const pilot = flown();
    const focus = new THREE.Vector3(0, 0, 0);
    for (let i = 0; i < 60 * 8; i++) pilot.update(1 / 60, focus, 0);
    expect(pilot.position.y).toBeGreaterThan(PLAN.altitude - 1.5);
    expect(pilot.position.y).toBeLessThan(PLAN.altitude + 1.5);
    // A tower 50 m tall seen two seconds out has to be cleared inside those two seconds.
    for (let i = 0; i < 120; i++) pilot.update(1 / 60, focus, 50);
    expect(pilot.position.y).toBeGreaterThan(50 + PLAN.clearance * 0.5);
  });

  it('comes down slower than it goes up', () => {
    const rise = flown();
    const fall = flown();
    const focus = new THREE.Vector3(0, 0, 0);
    for (let i = 0; i < 60 * 8; i++) fall.update(1 / 60, focus, 60);
    const top = fall.position.y;
    for (let i = 0; i < 60; i++) {
      rise.update(1 / 60, focus, 60);
      fall.update(1 / 60, focus, 0);
    }
    expect(rise.position.y - 30).toBeGreaterThan(top - fall.position.y);
  });

  it('stays inside its limit even for a fight beyond it', () => {
    const pilot = flown({ ...PLAN, limit: 60, standoff: 20 });
    const focus = new THREE.Vector3(300, 0, 300);
    for (let i = 0; i < 60 * 25; i++) pilot.update(1 / 60, focus, 0);
    expect(Math.abs(pilot.position.x)).toBeLessThan(90);
    expect(Math.abs(pilot.position.z)).toBeLessThan(90);
  });

  it('flies the same line at any frame rate', () => {
    const run = (fps: number) => {
      const pilot = new Autopilot({ ...PLAN, reverse: [1000, 1000] });
      pilot.begin(new THREE.Vector3(180, 30, 0), new THREE.Vector3(-1, 0, 0));
      const focus = new THREE.Vector3(0, 0, 0);
      for (let i = 0; i < fps * 6; i++) pilot.update(1 / fps, focus, 0);
      return pilot.position.clone();
    };
    expect(run(30).distanceTo(run(144))).toBeLessThan(3);
  });

  it('survives a frame with no time in it', () => {
    const pilot = flown();
    pilot.update(0, new THREE.Vector3(0, 0, 0), 0);
    expect(Number.isFinite(pilot.position.y)).toBe(true);
    expect(Number.isFinite(pilot.velocity.y)).toBe(true);
  });
});
