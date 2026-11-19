import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorldEvent } from '../worldProtocol';
import type { WorldContext } from './context';
import { HostClock } from './motion';
import type { Replicas } from './replicas';
import { Router } from './router';
import { Vehicles } from './vehicles';

const at = (t: number): void => { if (t > performance.now()) vi.advanceTimersByTime(t - performance.now()); };

/** A guest with one humvee driving a curve, its states arriving 5 times a second, drawn at `fps`. Returns where it is drawn over time. */
function drive(fps: number): { t: number; x: number; z: number; turn: number; turret: number }[] {
  const router = new Router();
  const model = { root: new THREE.Object3D(), turret: new THREE.Object3D() };
  const w = { hosting: false, ready: true, router, ctx: { enemies: { vehicles: { fleet: { ground: () => model } } } }, send: () => {}, side: () => {} };
  const vehicles = new Vehicles(w as unknown as WorldContext, { clock: new HostClock() } as unknown as Replicas);
  const out: { t: number; x: number; z: number; turn: number; turret: number }[] = [];
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), forward = new THREE.Vector3();
  let sent = -200;
  for (let frame = 0; frame * 1000 / fps <= 4000; frame++) {
    const now = 1000 + frame * 1000 / fps;
    at(now);
    while (sent + 200 <= now - 1000) {
      sent += 200;
      const angle = sent / 1000 * 0.8;
      q.setFromAxisAngle(up, angle);
      const event: WorldEvent = { t: 'vehicles', at: 500_000 + sent, list: [{ id: 1, kind: 'humvee', p: [Math.sin(angle) * 20, 0, Math.cos(angle) * 20], q: q.toArray() as [number, number, number, number], turret: angle * 2 }] };
      router.dispatch(event, 'host', false, now);
    }
    vehicles.animate(now);
    forward.set(0, 0, 1).applyQuaternion(model.root.quaternion);
    out.push({ t: now, x: model.root.position.x, z: model.root.position.z, turn: Math.atan2(forward.x, forward.z), turret: model.turret.rotation.y });
  }
  return out;
}

describe('vehicles on a guest', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['performance'] }));
  afterEach(() => vi.useRealTimers());

  it('are drawn the same at 30 and at 120 frames a second, turning with the host\'s vehicle and never ahead of it', () => {
    const slow = drive(30), fast = drive(120);
    for (const a of slow.filter(sample => sample.t > 2500)) {
      const b = fast.find(sample => Math.abs(sample.t - a.t) < 0.01)!;
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(0.05);
      expect(Math.abs(a.turn - b.turn)).toBeLessThan(0.01);
      expect(Math.abs(a.turret - b.turret)).toBeLessThan(0.01);
      // On the host's circle (a chord between two states at most 13 cm inside it), a little in the past.
      const radius = Math.hypot(a.x, a.z);
      expect(radius).toBeGreaterThan(19.85);
      expect(radius).toBeLessThan(20.01);
      const behind = (a.t - 1000) / 1000 * 0.8 - Math.atan2(a.x, a.z);
      expect(behind).toBeGreaterThan(0.1);
      expect(behind).toBeLessThan(0.3);
      // Its body turns with its path: the heading is the angle it has reached, between states too.
      expect(Math.abs(a.turn - Math.atan2(a.x, a.z))).toBeLessThan(0.02);
    }
    // It moves every frame: no standing still between states.
    for (let index = 1; index < fast.length; index++) if (fast[index]!.t > 2500) expect(Math.hypot(fast[index]!.x - fast[index - 1]!.x, fast[index]!.z - fast[index - 1]!.z)).toBeGreaterThan(0.05);
  });
});
