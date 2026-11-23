/**
 * Bespoke close-up 3D 1P turret gun specs rendered through `src/vehicles/guns.ts` (`Gun`)
 * for Jackal Roof Gunner (futuristic combined .50-cal / 40mm Smart-AGL) and Bastion AA Vulcan.
 * Valkyrie Door Gunner directly reuses the iconic `M134` rotary cannon from `src/vehicles/guns.ts`.
 */
import * as THREE from 'three';
import type { ModelBuilder } from '../../progression/modelkit';
import type { GunSpec } from '../guns';

const IRON = '#323942';
const GUNMETAL = '#48525e';
const TITANIUM = '#6d7885';
const GRIP = '#1d2126';
const BRASS = '#b08f4e';
const OLIVE = '#434b35';
const ALONG_Z: readonly [number, number, number] = [Math.PI / 2, 0, 0];

/**
 * M2-X50 / 40MM HYBRID AUTOCANNON-AGL (Jackal Seat 2):
 * Futuristic over/under heavy .50-cal rail-cooled autocannon paired with an underslung 40mm rotary
 * grenade drum, dual feed chutes, glowing cyan holo ring sight, and armored spade grips.
 */
export const HYBRID_HMG_AGL: GunSpec = {
  name: 'hybrid_hmg_agl',
  build: (b: ModelBuilder) => {
    // Pintle yoke & damped cradle
    b.cyl(0.05, 0.058, 0.36, 10, IRON, { at: [0, -0.32, 0.04] });
    b.box(0.22, 0.07, 0.34, IRON, { at: [0, -0.13, 0.04] });
    for (const s of [1, -1]) b.box(0.032, 0.16, 0.24, IRON, { at: [s * 0.12, -0.03, 0.04] });

    // Main futuristic angular upper receiver (.50-cal)
    b.box(0.21, 0.19, 0.64, GUNMETAL, { at: [0, 0.04, 0.08] });
    b.box(0.18, 0.04, 0.48, TITANIUM, { at: [0, 0.15, 0.08] });
    b.box(0.23, 0.05, 0.36, IRON, { at: [0, 0.03, -0.06] });

    // Underslung 40mm 6-chamber rotary grenade drum + breech housing
    b.cyl(0.095, 0.095, 0.24, 12, IRON, { at: [0, -0.11, -0.16], rot: ALONG_Z });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      b.cyl(0.025, 0.025, 0.26, 6, BRASS, { at: [Math.cos(a) * 0.058, -0.11 + Math.sin(a) * 0.058, -0.16], rot: ALONG_Z });
    }
    b.cyl(0.042, 0.046, 0.52, 10, GUNMETAL, { at: [0, -0.11, -0.52], rot: ALONG_Z });
    b.cyl(0.05, 0.05, 0.06, 10, TITANIUM, { at: [0, -0.11, -0.78], rot: ALONG_Z });

    // Left .50-cal ammo box & brass belt feed
    b.box(0.14, 0.2, 0.32, OLIVE, { at: [-0.23, -0.04, 0.06] });
    for (let i = 0; i < 4; i++) {
      b.box(0.075, 0.026, 0.055, BRASS, {
        at: [-0.16 + i * 0.024, 0.05 + i * 0.024, 0.02 + i * 0.015],
        rot: [0, 0, -0.55],
      });
    }

    // Right-side digital smart-fuse telemetry box + glowing cyan status strip
    b.box(0.06, 0.11, 0.22, IRON, { at: [0.14, 0.04, 0.08] });
    b.glow(new THREE.BoxGeometry(0.015, 0.035, 0.14), '#38e8ff', 2.4, { at: [0.172, 0.05, 0.08] });

    // Glowing cyan holographic ring sight standing cleanly above the receiver
    b.box(0.022, 0.075, 0.035, IRON, { at: [0, 0.195, -0.06] });
    b.solid(new THREE.TorusGeometry(0.058, 0.006, 8, 22), IRON, { at: [0, 0.265, -0.06] });
    b.glow(new THREE.TorusGeometry(0.046, 0.0035, 6, 20), '#38e8ff', 2.6, { at: [0, 0.265, -0.06] });
    b.glow(new THREE.SphereGeometry(0.006, 6, 6), '#ff8a38', 3.0, { at: [0, 0.265, -0.06] });

    // Ergonomic dual spade grips + dual triggers (LMB .50-cal + RMB 40mm thumb paddles)
    b.box(0.28, 0.032, 0.05, IRON, { at: [0, -0.01, 0.43] });
    for (const s of [1, -1]) {
      b.cyl(0.022, 0.022, 0.16, 8, GRIP, { at: [s * 0.125, 0.05, 0.45] });
      b.box(0.026, 0.024, 0.035, '#ff8a38', { at: [s * 0.075, 0.085, 0.43] });
    }
    b.box(0.065, 0.034, 0.025, BRASS, { at: [0, 0.02, 0.42] });
  },
  moving: (b: ModelBuilder) => {
    // Heavy vented .50-cal barrel shroud + reciprocating fluted barrel + muzzle brake
    b.cyl(0.058, 0.062, 0.42, 10, IRON, { at: [0, 0.045, -0.42], rot: ALONG_Z });
    b.cyl(0.032, 0.032, 1.08, 10, TITANIUM, { at: [0, 0.045, -0.98], rot: ALONG_Z });
    // Twin glowing plasma/heat rail fins flanking the .50-cal barrel
    for (const s of [1, -1]) {
      b.box(0.014, 0.04, 0.65, GUNMETAL, { at: [s * 0.052, 0.045, -0.74] });
      b.glow(new THREE.BoxGeometry(0.006, 0.012, 0.56), '#38e8ff', 1.8, { at: [s * 0.06, 0.045, -0.74] });
    }
    b.box(0.078, 0.058, 0.14, GUNMETAL, { at: [0, 0.045, -1.54] });
  },
  muzzle: [0, 0.045, -1.64],
  follow: 20,
  return: 26,
};

/**
 * TWIN 20MM AA RADAR VULCAN (Bastion Seat 2):
 * Dual side-by-side heavy autocannon barrels with armored radar shield & green lead-computing holo pane.
 */
export const VULCAN_AA: GunSpec = {
  name: 'vulcan_aa',
  build: (b: ModelBuilder) => {
    b.cyl(0.065, 0.08, 0.4, 10, IRON, { at: [0, -0.32, 0.05] });
    b.box(0.42, 0.18, 0.46, IRON, { at: [0, -0.02, 0.06] });
    // Twin side ammo drums
    for (const s of [1, -1]) {
      b.cyl(0.14, 0.14, 0.22, 12, OLIVE, { at: [s * 0.3, -0.04, 0.08], rot: [0, 0, Math.PI / 2] });
      b.box(0.14, 0.16, 0.52, GUNMETAL, { at: [s * 0.18, 0.04, -0.08] });
      b.cyl(0.022, 0.022, 0.16, 8, GRIP, { at: [s * 0.16, 0.02, 0.38] });
    }
    // Wide AA radar holo sight frame above center bridge
    b.box(0.24, 0.025, 0.04, IRON, { at: [0, 0.15, -0.1] });
    for (const s of [1, -1]) b.box(0.02, 0.16, 0.03, IRON, { at: [s * 0.11, 0.23, -0.1] });
    b.box(0.24, 0.02, 0.03, IRON, { at: [0, 0.31, -0.1] });
    b.glow(new THREE.RingGeometry(0.048, 0.056, 24), '#38ff8c', 2.4, { at: [0, 0.23, -0.1] });
  },
  moving: (b: ModelBuilder) => {
    for (const s of [1, -1]) {
      b.cyl(0.048, 0.054, 0.45, 10, IRON, { at: [s * 0.18, 0.04, -0.52], rot: ALONG_Z });
      b.cyl(0.028, 0.028, 1.15, 8, TITANIUM, { at: [s * 0.18, 0.04, -1.08], rot: ALONG_Z });
      b.cyl(0.04, 0.036, 0.12, 8, GUNMETAL, { at: [s * 0.18, 0.04, -1.66], rot: ALONG_Z });
    }
  },
  muzzle: [0, 0.04, -1.72],
  follow: 22,
  return: 28,
};
