/**
 * Unit & Rapier physics tests for all 5 custom engine drives (`flight`, `hover`, `afterburner`, `overcharge`, `diesel`)
 * and all 6 `DriveKind` visuals in `engine-kit.ts`.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { wrapAngle } from '../../../core/math';
import { Physics } from '../../../physics/Physics';
import type { ModelBuilder, ModelMaterials } from '../../../progression/modelkit';
import { Walker, type WalkerIntent } from '../../controller';
import { FRAME } from '../../data';
import type { DriveKind } from '../../loadout';
import { buildEngineVisual } from '../../models/engine-kit';

const DT = 1 / 60;
const DEG = Math.PI / 180;
let physics: Physics;
let placed: RAPIER.Collider[] = [];

function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
  const c = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const h = new THREE.Vector3((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2);
  placed.push(physics.addStaticBox(c, h, null, 'concrete'));
  physics.flushQueries();
}

const floor = () => box(-400, -1, -400, 400, 0, 400);

const idle = (): WalkerIntent => ({
  moveX: 0, moveZ: 0, viewYaw: 0, jet: false, stomp: false, charge: false, chargeHeld: false, viewPitch: 0,
});

function makeWalker(drive: DriveKind, x = 0, z = 0, yaw = 0): Walker {
  const w = new Walker(physics, 0);
  w.setMovement('walker', drive);
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

function mockMaterials(): ModelMaterials {
  const solid = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true });
  const glow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const nearby = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true });
  return {
    solid,
    glow,
    nearby,
    group(b: ModelBuilder, material: THREE.Material = solid): THREE.Group {
      const g = new THREE.Group();
      const s = b.solidGeometry();
      const gl = b.glowGeometry();
      if (s) g.add(new THREE.Mesh(s, material));
      if (gl) g.add(new THREE.Mesh(gl, glow));
      return g;
    },
  } as unknown as ModelMaterials;
}

beforeAll(async () => {
  physics = await Physics.create();
});

afterEach(() => {
  for (const c of placed) physics.world.removeCollider(c, false);
  placed = [];
  physics.flushQueries();
});

describe('Jump-Jet Engine (flight)', () => {
  it('has 4.0 s fuel, FLIGHT HUD label, free flight climb with 14 m/s air speed, and 1.2 s delay + 3.0 s full refill', () => {
    floor();
    const w = makeWalker('flight');
    expect(w.driveHudLabel).toBe('FLIGHT');
    expect(w.maxFuel).toBeCloseTo(4.0, 5);
    expect(w.fuel).toBeCloseTo(4.0, 5);

    // Hold Space + forward: true free climb well past standard 7 m hop and 14 m/s horizontal air speed.
    const fly = { ...idle(), jet: true, moveZ: 1 };
    run(w, 2.5, fly);
    expect(w.flying).toBe(true);
    expect(w.jetting).toBe(true);
    expect(w.feet.y).toBeGreaterThan(22);
    expect(w.speed).toBeCloseTo(14, 1);
    expect(w.fuel).toBeCloseTo(1.5, 1);

    // Burn remaining 1.5 s to empty.
    run(w, 1.6, fly);
    expect(w.fuel).toBeCloseTo(0, 5);
    expect(w.flying).toBe(false);

    // Wait 1.0 s (< 1.2 s refill delay): fuel must still be 0.
    run(w, 1.0, idle());
    expect(w.fuel).toBeCloseTo(0, 5);

    // Wait past 1.2 s delay + 1.5 s (half of 3.0 s refill) -> ~2.0 s fuel.
    run(w, 1.7, idle());
    expect(w.fuel).toBeGreaterThan(1.8);
    expect(w.fuel).toBeLessThan(2.2);

    // Finish the remaining 1.5 s refill -> full 4.0 s.
    run(w, 1.6, idle());
    expect(w.fuel).toBeCloseTo(4.0, 4);
  });

  it('blasts omnidirectionally at 32 m/s for 0.6 s costing 1.0 s fuel (including upward), and refuses below 1.0 s fuel', () => {
    floor();
    const w = makeWalker('flight');

    // Pitch up 45° and press Shift: blasts upward + forward at 32 m/s for 0.6 s costing 1.0 s fuel.
    const pitch = 45 * DEG;
    const startY = w.feet.y;
    const startZ = w.feet.z;
    let maxSpeed3D = 0;
    let charged = false;
    run(w, 0.6, { ...idle(), charge: true, viewPitch: pitch }, () => {
      if (w.said.charged) charged = true;
      maxSpeed3D = Math.max(maxSpeed3D, w.velocity.length());
    });
    expect(charged).toBe(true);
    expect(w.fuel).toBeCloseTo(3.0, 2);
    expect(maxSpeed3D).toBeCloseTo(32, 0.5);
    expect(w.feet.y - startY).toBeGreaterThan(10);
    expect(startZ - w.feet.z).toBeGreaterThan(10);

    // Drain fuel below 1.0 s and confirm Shift blast does NOT fire.
    w.fuel = 0.8;
    w.charging = 0;
    w.update(DT, { ...idle(), charge: true });
    expect(w.said.charged).toBe(false);
    expect(w.fuel).toBeCloseTo(0.8, 3);
  });
});

describe('Rotor Engine (hover)', () => {
  it('climbs to 14 m ceiling and hovers indefinitely at zero fuel cost with 9 m/s air strafe and 0 charges', () => {
    floor();
    const w = makeWalker('hover');
    expect(w.driveHudLabel).toBe('ROTOR');
    expect(w.maxCharges).toBe(0);
    expect(w.charges).toBe(0);

    // Shift press does nothing.
    w.update(DT, { ...idle(), charge: true });
    expect(w.said.charged).toBe(false);
    expect(w.charging).toBe(0);

    // Climb and hold Space for 8 s: settles at 14 m ceiling with zero fuel spent.
    const startFuel = w.fuel;
    run(w, 8.0, { ...idle(), jet: true });
    expect(w.grounded).toBe(false);
    expect(w.hovering).toBe(true);
    expect(w.clearance()).toBeGreaterThan(13.5);
    expect(w.clearance()).toBeLessThanOrEqual(14.15);
    expect(w.fuel).toBeCloseTo(startFuel, 5);

    // Omnidirectional lateral air strafe reaches 9 m/s.
    run(w, 1.2, { ...idle(), jet: true, moveX: 1 });
    expect(w.speed).toBeCloseTo(9, 0.5);
    expect(w.fuel).toBeCloseTo(startFuel, 5);

    // Releasing Space lets it descend to ground and clears hovering.
    run(w, 3.0, idle());
    expect(w.grounded).toBe(true);
    expect(w.hovering).toBe(false);
  });
});

describe('Afterburner (afterburner)', () => {
  it('hops without hovering, enters 48 m/s jet mode with 70 deg/s turn cap, pitch climb/dive, 7 s fuel, armsLockedForward, and exits cleanly', () => {
    floor();
    const w = makeWalker('afterburner');
    expect(w.driveHudLabel).toBe('AFTERBURNER');
    expect(w.maxFuel).toBeCloseTo(7.0, 5);

    // Normal hop on Space cannot hover: holding Space for 3.5 s falls back to the ground.
    run(w, 3.5, { ...idle(), jet: true });
    expect(w.grounded).toBe(true);
    expect(w.jetMode).toBe(false);

    // Release Space, then hop up and hold Shift in mid-air to enter jet mode.
    w.update(DT, idle());
    run(w, 0.4, { ...idle(), jet: true });
    expect(w.grounded).toBe(false);

    run(w, 0.5, { ...idle(), chargeHeld: true, viewYaw: 0, viewPitch: 0 });
    expect(w.jetMode).toBe(true);
    expect(w.armsLockedForward).toBe(true);
    expect(w.flying).toBe(true);
    expect(w.speed).toBeCloseTo(48, 0.5);

    // Turn rate capped cleanly at 70°/s when asking for a 180° turn over 0.5 s.
    const yawBefore = w.viewYaw;
    run(w, 0.5, { ...idle(), chargeHeld: true, viewYaw: Math.PI, viewPitch: 0 });
    const turned = Math.abs(wrapAngle(w.viewYaw - yawBefore));
    expect(turned).toBeCloseTo(0.5 * 70 * DEG, 2);

    // Pitch up climbs smoothly.
    const yBeforeClimb = w.feet.y;
    run(w, 0.6, { ...idle(), chargeHeld: true, viewYaw: w.viewYaw, viewPitch: 0.45 });
    expect(w.feet.y).toBeGreaterThan(yBeforeClimb + 5);

    // Releasing Shift exits jetMode, unlocks arms, and transitions into a controlled hover-fall (bleeding speed).
    const fuelOnRelease = w.fuel;
    expect(fuelOnRelease).toBeLessThan(7.0);
    run(w, 0.5, { ...idle(), chargeHeld: false, viewYaw: w.viewYaw });
    expect(w.jetMode).toBe(false);
    expect(w.armsLockedForward).toBe(false);
    expect(w.flying).toBe(false);
    expect(w.speed).toBeLessThan(20);
    expect(w.velocity.y).toBeGreaterThan(-12);

    // Landing and waiting refills the 7.0 s jet fuel tank.
    run(w, 6.0, idle());
    expect(w.grounded).toBe(true);
    expect(w.fuel).toBeCloseTo(7.0, 3);

    // Jumping + holding Shift directly off the ground enters jetMode immediately without re-snapping to floor.
    run(w, 0.3, { ...idle(), jet: true, chargeHeld: true, viewPitch: 0 });
    expect(w.grounded).toBe(false);
    expect(w.jetMode).toBe(true);
    expect(w.armsLockedForward).toBe(true);
  });

  it('executes a 1.5x dive-bomb stomp when stomping from jet mode', () => {
    floor();
    const w = makeWalker('afterburner');
    run(w, 0.5, { ...idle(), jet: true });
    run(w, 0.5, { ...idle(), chargeHeld: true, viewPitch: 0.25 });
    expect(w.jetMode).toBe(true);
    expect(w.clearance()).toBeGreaterThan(5);

    w.update(DT, { ...idle(), chargeHeld: true, stomp: true });
    expect(w.jetMode).toBe(false);
    expect(w.armsLockedForward).toBe(false);
    expect(w.stomping).toBe(true);

    let landedStomp = -1;
    let landedMult = 1;
    for (let t = 0; t < 2 && landedStomp < 0; t += DT) {
      w.update(DT, idle());
      if (w.said.stomped >= 0) {
        landedStomp = w.said.stomped;
        landedMult = w.said.stompMult;
      }
    }
    expect(landedStomp).toBeGreaterThanOrEqual(FRAME.stomp.big);
    expect(landedMult).toBeCloseTo(1.5, 5);
  });

  it('exits jet mode automatically when 7.0 s fuel runs out', () => {
    floor();
    const w = makeWalker('afterburner');
    run(w, 0.5, { ...idle(), jet: true });
    run(w, 7.2, { ...idle(), chargeHeld: true, viewPitch: 0.1 });
    expect(w.fuel).toBeCloseTo(0, 4);
    expect(w.jetMode).toBe(false);
    expect(w.armsLockedForward).toBe(false);
  });
});

describe('Overcharge Engine (overcharge)', () => {
  it('has 3 charges refilling in 2.5 s, bursts at 26 m/s for 0.7 s, and has 0.5x jet fuel', () => {
    floor();
    const w = makeWalker('overcharge');
    expect(w.driveHudLabel).toBe('OVERCHARGE');
    expect(w.maxCharges).toBe(3);
    expect(w.charges).toBe(3);
    expect(w.maxFuel).toBeCloseTo(FRAME.jet.fuel * 0.5, 5);
    expect(w.fuel).toBeCloseTo(FRAME.jet.fuel * 0.5, 5);

    const z0 = w.feet.z;
    let peakSpeed = 0;
    run(w, 0.7, { ...idle(), charge: true }, () => {
      peakSpeed = Math.max(peakSpeed, w.speed);
    });
    expect(peakSpeed).toBeCloseTo(26, 0.5);
    // 26 m/s × 0.7 s ≈ 18.2 m travel.
    expect(z0 - w.feet.z).toBeGreaterThan(16.5);
    expect(z0 - w.feet.z).toBeLessThan(19.5);
    expect(w.charges).toBe(2);

    // Fire 2nd and 3rd charges back to back (each lasts 0.7 s).
    run(w, 0.75, { ...idle(), charge: true });
    expect(w.charges).toBe(1);
    run(w, 0.75, { ...idle(), charge: true });
    expect(w.charges).toBe(0);

    // Wait for 1st refill (started at t=0, already 2.2 s elapsed -> ~0.35 s left for 1st charge, then +2.5 s for 2nd).
    run(w, 0.5, idle());
    expect(w.charges).toBe(1);
    run(w, 2.55, idle());
    expect(w.charges).toBe(2);
    run(w, 2.55, idle());
    expect(w.charges).toBe(3);
  });
});

describe('Long-Haul Engine (diesel)', () => {
  it('has 1.3x fuel, runs steadily at 11 m/s for up to 12 s holding Shift with charging > 0, and refills fully in 4 s on release', () => {
    floor();
    const w = makeWalker('diesel');
    expect(w.driveHudLabel).toBe('LONG-HAUL');
    expect(w.maxFuel).toBeCloseTo(FRAME.jet.fuel * 1.3, 5);

    // Hold Shift continuously for 6 s: steady 11 m/s and charging > 0 for trampling.
    let chargingSamples = 0;
    run(w, 6.0, { ...idle(), chargeHeld: true }, () => {
      if (w.charging > 0) chargingSamples++;
    });
    expect(w.speed).toBeCloseTo(11, 0.5);
    expect(chargingSamples).toBeGreaterThan(300);
    expect(w.charges).toBe(6);

    // Continue holding Shift for another 6.2 s -> stamina hits 0 and run stops.
    run(w, 6.2, { ...idle(), chargeHeld: true });
    expect(w.charges).toBe(0);
    expect(w.charging).toBe(0);

    // Release Shift for 2.0 s -> half refilled (6 s of 12 s).
    run(w, 2.0, { ...idle(), chargeHeld: false });
    expect(w.charges).toBe(6);

    // Release Shift for another 2.05 s (total 4.05 s) -> full 12 s stamina reservoir.
    run(w, 2.05, { ...idle(), chargeHeld: false });
    expect(w.charges).toBe(12);
  });
});

describe('buildEngineVisual (engine-kit.ts)', () => {
  it('returns null for standard jets and builds + poses all 5 custom engine visuals cleanly', () => {
    const mats = mockMaterials();
    expect(buildEngineVisual('jets', mats)).toBeNull();

    const custom: DriveKind[] = ['flight', 'hover', 'afterburner', 'overcharge', 'diesel'];
    for (const kind of custom) {
      const vis = buildEngineVisual(kind, mats);
      expect(vis).not.toBeNull();
      let meshCount = 0;
      vis!.group.traverse(obj => {
        if (obj instanceof THREE.Mesh) meshCount++;
      });
      expect(meshCount).toBeGreaterThan(0);

      // Pose across every movement state without throwing.
      vis!.pose(DT, false, false, false, false, 0, false);
      vis!.pose(DT, true, true, false, false, 1.5, false);
      vis!.pose(DT, false, false, true, false, 2.0, false);
      vis!.pose(DT, true, true, false, true, 3.0, false);
      vis!.pose(DT, true, true, true, true, 4.0, true);
    }

    // Specific animation checks:
    // 1. Rotor hides cleanly when `inside` is true so blades do not block interior cockpit view.
    const hoverVis = buildEngineVisual('hover', mats)!;
    hoverVis.pose(0.1, false, false, true, false, 0, false);
    expect(hoverVis.group.visible).toBe(true);
    hoverVis.pose(0.1, false, false, true, false, 0, true);
    expect(hoverVis.group.visible).toBe(false);

    // 2. Afterburner wings sweep to a distinct angle in jetMode vs walking.
    const abVis = buildEngineVisual('afterburner', mats)!;
    abVis.pose(0.5, false, false, false, false, 0, false);
    const walkRotZ = abVis.group.children[1]!.rotation.z;
    for (let i = 0; i < 30; i++) abVis.pose(DT, true, true, false, true, 0, false);
    const jetRotZ = abVis.group.children[1]!.rotation.z;
    expect(Math.abs(jetRotZ - walkRotZ)).toBeGreaterThan(0.5);
  });
});
