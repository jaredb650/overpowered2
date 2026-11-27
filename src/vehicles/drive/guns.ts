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

const COPPER = '#c9743c';
const NADE_GOLD = '#e8a82e';
const SAND_CASE = '#6b5c43';
const AMBER_STRIP = '#ff9828';
const CYAN_STRIP = '#38e8ff';

/**
 * M2-X50 / 40MM DUAL-FEED COMBO TURRET (Jackal Seat 2 & Desert Raid Technical):
 * Novel integrated side-by-side twin-barrel weapon system — NOT a standard .50-cal with a tube bolted on:
 *   - Left channel (`x = -0.082`): long heavy fluted .50-cal autocannon barrel + perforated cooling shroud
 *     + wedge muzzle brake, fed by an articulated brass/copper .50 BMG bullet belt from a left olive ammo box.
 *   - Right channel (`x = +0.088`): thick wide-bore 40mm Smart-AGL barrel with radiator rings & slotted blast
 *     diffuser, fed by an articulated chunky gold-ogive 40mm HEDP grenade belt from a right ordnance box.
 *   - Monolithic dual-breech chassis, twin-bore bridge clamps, armored spade grips, and live cyan/amber
 *     mode-selector telemetry bar (cyan = .50-cal HMG, amber = 40mm AGL).
 */
export const HYBRID_HMG_AGL: GunSpec = {
  name: 'hybrid_hmg_agl',
  build: (b: ModelBuilder) => {
    // Pintle pedestal yoke & damped twin-arm cradle
    b.cyl(0.056, 0.064, 0.34, 10, IRON, { at: [0, -0.31, 0.06] });
    b.box(0.32, 0.065, 0.34, IRON, { at: [0, -0.13, 0.06] });
    for (const s of [1, -1]) {
      b.box(0.036, 0.16, 0.24, IRON, { at: [s * 0.17, -0.03, 0.06] });
    }

    // Monolithic faceted twin-channel combo receiver (left .50-cal breech + right 40mm AGL breech)
    b.box(0.32, 0.15, 0.64, IRON, { at: [0, 0.02, 0.04] });
    // Left .50-cal upper breech cowl (chamfered gunmetal + cooling louver ribs)
    b.box(0.135, 0.13, 0.62, GUNMETAL, { at: [-0.082, 0.075, 0.02] });
    b.box(0.11, 0.032, 0.44, TITANIUM, { at: [-0.082, 0.152, 0.0] });
    // Right 40mm AGL raised heavy breech cowl (stepped armored titanium top + vent slots)
    b.box(0.145, 0.145, 0.56, GUNMETAL, { at: [0.088, 0.078, 0.0] });
    b.box(0.125, 0.036, 0.38, TITANIUM, { at: [0.088, 0.162, -0.02] });
    for (let i = 0; i < 4; i++) {
      b.box(0.09, 0.012, 0.036, IRON, { at: [0.088, 0.184, -0.15 + i * 0.085] });
    }
    // Center spine valley (keeps top sightline clean & unobstructed for zoomed crosshair aim)
    b.box(0.058, 0.05, 0.54, IRON, { at: [0, 0.108, 0.02] });
    b.box(0.16, 0.024, 0.04, TITANIUM, { at: [0, 0.122, -0.24] });

    // LEFT FLANK: Olive .50-cal ammo box + articulated curved brass .50 BMG BULLET BELT feeding left channel
    b.box(0.14, 0.21, 0.34, OLIVE, { at: [-0.295, -0.055, 0.04] });
    b.box(0.15, 0.032, 0.35, IRON, { at: [-0.295, 0.045, 0.04] });
    // 7 linked .50-cal cartridges arching cleanly up into the left feed tray (brass case + pointed copper tip!)
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const bx = -0.265 + t * 0.135;
      const by = 0.062 + Math.sin(t * Math.PI * 0.65) * 0.055;
      const bz = -0.02;
      // Brass cartridge case (along Z)
      b.cyl(0.011, 0.012, 0.115, 8, BRASS, { at: [bx, by, bz + 0.01], rot: ALONG_Z });
      // Pointed copper .50-cal bullet tip projecting forward (-Z)
      b.cyl(0.002, 0.01, 0.048, 8, COPPER, { at: [bx, by, bz - 0.072], rot: ALONG_Z });
      // Dark steel disintegrating belt link
      b.box(0.024, 0.022, 0.026, IRON, { at: [bx, by, bz + 0.02] });
    }
    // Left feed-throat lip guard
    b.box(0.045, 0.055, 0.17, TITANIUM, { at: [-0.158, 0.105, -0.02] });

    // RIGHT FLANK: Armored 40mm ordnance box + articulated curved 40mm HEDP GRENADE BELT feeding right channel
    b.box(0.16, 0.23, 0.32, SAND_CASE, { at: [0.305, -0.055, 0.02] });
    b.box(0.166, 0.036, 0.33, IRON, { at: [0.305, 0.055, 0.02] });
    b.box(0.018, 0.048, 0.24, AMBER_STRIP, { at: [0.388, -0.03, 0.02] });
    // 5 chunky linked 40mm grenades arching cleanly up into the right feed tray (wide brass base + rounded gold warhead!)
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const gx = 0.275 - t * 0.135;
      const gy = 0.068 + Math.sin(t * Math.PI * 0.65) * 0.058;
      const gz = -0.015;
      // Thick 40mm brass casing
      b.cyl(0.021, 0.021, 0.065, 10, BRASS, { at: [gx, gy, gz + 0.025], rot: ALONG_Z });
      // Rounded golden-amber 40mm HEDP grenade warhead nose (-Z)
      b.cyl(0.014, 0.021, 0.055, 10, NADE_GOLD, { at: [gx, gy, gz - 0.034], rot: ALONG_Z });
      b.cyl(0.005, 0.014, 0.018, 10, AMBER_STRIP, { at: [gx, gy, gz - 0.068], rot: ALONG_Z });
      // Heavy black 40mm belt link cuff
      b.box(0.034, 0.032, 0.028, IRON, { at: [gx, gy, gz + 0.015] });
    }
    // Right 40mm feed-throat chute hood
    b.box(0.052, 0.068, 0.18, TITANIUM, { at: [0.168, 0.11, -0.015] });

    // Ergonomic armored dual-spade grips, crossbar & twin trigger paddles
    b.box(0.34, 0.038, 0.06, IRON, { at: [0, 0.015, 0.4] });
    for (const s of [1, -1]) {
      b.cyl(0.023, 0.023, 0.18, 8, GRIP, { at: [s * 0.155, 0.075, 0.43] });
      b.box(0.034, 0.026, 0.042, TITANIUM, { at: [s * 0.155, 0.168, 0.42] });
      b.box(0.028, 0.026, 0.036, s < 0 ? CYAN_STRIP : AMBER_STRIP, { at: [s * 0.092, 0.105, 0.405] });
    }
    // Rear fire-control selector pod between grips
    b.box(0.11, 0.062, 0.055, IRON, { at: [0, 0.062, 0.39] });
  },
  moving: (b: ModelBuilder) => {
    // Twin-bore structural yoke clamps uniting both distinct barrels into one novel combo weapon
    for (const cz of [-0.46, -0.84]) {
      b.box(0.25, 0.088, 0.065, TITANIUM, { at: [0.003, 0.045, cz] });
      b.box(0.27, 0.036, 0.045, IRON, { at: [0.003, 0.045, cz] });
    }

    // BARREL 1 (LEFT, x = -0.082): Long heavy fluted .50-cal autocannon barrel + vented shroud + wedge muzzle brake
    b.cyl(0.054, 0.058, 0.48, 10, IRON, { at: [-0.082, 0.052, -0.52], rot: ALONG_Z });
    b.cyl(0.031, 0.033, 1.12, 10, TITANIUM, { at: [-0.082, 0.052, -0.96], rot: ALONG_Z });
    // Angular heat-fin rails flanking the .50-cal barrel with glowing cyan cooling strips
    for (const s of [-1, 1]) {
      b.box(0.012, 0.034, 0.62, GUNMETAL, { at: [-0.082 + s * 0.046, 0.052, -0.78] });
      b.glow(new THREE.BoxGeometry(0.006, 0.01, 0.52), CYAN_STRIP, 1.8, { at: [-0.082 + s * 0.053, 0.052, -0.78] });
    }
    // Bold twin-baffle .50-cal compensator wedge brake
    b.box(0.086, 0.062, 0.15, GUNMETAL, { at: [-0.082, 0.052, -1.56] });
    b.box(0.094, 0.022, 0.032, TITANIUM, { at: [-0.082, 0.052, -1.59] });

    // BARREL 2 (RIGHT, x = +0.088): Thick wide-bore 40mm Smart-AGL barrel + radiator collar rings + blast diffuser
    b.cyl(0.052, 0.056, 0.88, 12, GUNMETAL, { at: [0.088, 0.042, -0.72], rot: ALONG_Z });
    // Heavy ringed thermal cooling fins along the 40mm barrel
    for (const rz of [-0.56, -0.68, -0.8, -0.94, -1.04]) {
      b.cyl(0.066, 0.066, 0.026, 12, TITANIUM, { at: [0.088, 0.042, rz], rot: ALONG_Z });
    }
    // Glowing amber smart-fuze inductor rail along outer right flank of 40mm barrel
    b.box(0.014, 0.036, 0.56, IRON, { at: [0.146, 0.042, -0.76] });
    b.glow(new THREE.BoxGeometry(0.007, 0.014, 0.46), AMBER_STRIP, 2.0, { at: [0.155, 0.042, -0.76] });
    // Flared wide-bore 40mm grenade diffuser collar & dark bore crown
    b.cyl(0.068, 0.06, 0.13, 12, IRON, { at: [0.088, 0.042, -1.2], rot: ALONG_Z });
    b.cyl(0.042, 0.042, 0.02, 12, GRIP, { at: [0.088, 0.042, -1.268], rot: ALONG_Z });
  },
  extra: () => {
    // Live active-mode telemetry indicator bar on rear selector pod (cyan = .50-cal HMG, amber = 40mm AGL)
    const group = new THREE.Group();
    const hmgMat = new THREE.MeshBasicMaterial({ color: CYAN_STRIP });
    const aglMat = new THREE.MeshBasicMaterial({ color: AMBER_STRIP });
    const hmgBar = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.018, 0.014), hmgMat);
    hmgBar.position.set(0, 0.082, 0.418);
    const aglBar = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.018, 0.014), aglMat);
    aglBar.position.set(0, 0.082, 0.418);
    aglBar.visible = false;
    group.add(hmgBar, aglBar);
    return {
      group,
      setActive: (_amount: number, mode = 0) => {
        hmgBar.visible = mode === 0;
        aglBar.visible = mode === 1;
      },
    };
  },
  muzzle: [0, 0.048, -1.62],
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
