/**
 * Mech Shotgun arm model: sculpted Bureau-metal semi-auto heavy combat shotgun with a bevelled receiver,
 * recessed outboard ejection port with brass shell highlight, oversized under-barrel tubular magazine with
 * heavy figure-8 clamp collar, wide ventilated upper barrel heat shield with open cooling slots, ribbed
 * forend grip, folded-over top metal stock stub with hook detail, ported breaching choke, and amber sight bead.
 *
 * Drawn natively for the right arm (+X outboard, -X inboard facing cockpit); `ArmRack` mirrors it on the left.
 */
import * as THREE from 'three';
import type { GunSpec } from '../../vehicles/guns';
import {
  ACROSS, ALONG_Z, AMBER, BRASS, DARK, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL, prism,
} from './shared';

/** Upper barrel bore centreline Y in local gun space. */
const BORE_Y = 0.12;
/** Under-barrel tubular magazine centreline Y in local gun space. */
const TUBE_Y = -0.21;

/** U-shaped arched rib profile in XY for the ventilated upper barrel heat shield. */
const SHIELD_RIB: readonly (readonly [number, number])[] = [
  [-0.27, -0.02],
  [-0.27, 0.24],
  [-0.18, 0.34],
  [0.18, 0.34],
  [0.27, 0.24],
  [0.27, -0.02],
  [0.19, -0.02],
  [0.19, 0.20],
  [0.12, 0.27],
  [-0.12, 0.27],
  [-0.19, 0.20],
  [-0.19, -0.02],
];

/** Sculpted figure-8 clamp profile bridging the upper barrel shroud and lower magazine tube. */
const CLAMP_COLLAR: readonly (readonly [number, number])[] = [
  [-0.25, -0.37],
  [0.25, -0.37],
  [0.29, -0.21],
  [0.24, -0.05],
  [0.28, 0.12],
  [0.24, 0.30],
  [0.14, 0.36],
  [-0.14, 0.36],
  [-0.24, 0.30],
  [-0.28, 0.12],
  [-0.24, -0.05],
  [-0.29, -0.21],
];

/** Chamfered octagonal grip collar for the ribbed combat forend. */
const FOREND_RIB: readonly (readonly [number, number])[] = [
  [-0.24, -0.36],
  [0.24, -0.36],
  [0.28, -0.27],
  [0.28, -0.12],
  [0.21, -0.06],
  [-0.21, -0.06],
  [-0.28, -0.12],
  [-0.28, -0.27],
];

export const SHOTGUN_ARM: GunSpec = {
  name: 'frame-shotgun',
  build: b => {
    // ---- Heavy chamfered Bureau-metal receiver (+u forward along -Z) ----
    b.solid(
      prism(
        [[-1.12, -0.34], [0.58, -0.34], [0.76, -0.12], [0.74, 0.30], [0.40, 0.46], [-0.94, 0.46], [-1.18, 0.20]],
        0.78,
        0.05,
      ),
      OBSIDIAN,
      { rot: ACROSS },
    );

    // Sloped upper receiver armour hood & sight rail spine.
    b.solid(
      prism([[-0.90, 0.38], [0.56, 0.38], [0.68, 0.28], [0.34, 0.54], [-0.80, 0.54]], 0.68, 0.03),
      PLATE,
      { rot: ACROSS },
    );

    // Outboard (+X) layered receiver plates split around a recessed ejection port (z = -0.26 .. +0.18).
    b.solid(
      prism([[-0.98, -0.26], [-0.18, -0.26], [-0.18, 0.30], [-0.88, 0.34]], 0.10, 0.022),
      GUNMETAL,
      { at: [0.40, 0, 0], rot: ACROSS },
    );
    b.solid(
      prism([[0.26, -0.26], [0.66, -0.24], [0.70, 0.18], [0.26, 0.28]], 0.10, 0.022),
      GUNMETAL,
      { at: [0.40, 0, 0], rot: ACROSS },
    );
    b.solid(
      prism([[-0.22, -0.26], [0.30, -0.26], [0.30, -0.03], [-0.22, -0.03]], 0.10, 0.02),
      GUNMETAL,
      { at: [0.40, 0, 0], rot: ACROSS },
    );

    // Recessed ejection port cavity, visible chambered brass shell highlight, and angled brass deflector.
    b.box(0.08, 0.27, 0.44, DARK, { at: [0.39, 0.13, -0.04] });
    b.cyl(0.068, 0.068, 0.30, 10, BRASS, { at: [0.37, 0.09, -0.05], rot: ALONG_Z });
    b.solid(
      prism([[-0.30, 0.04], [-0.18, 0.02], [-0.18, 0.24], [-0.28, 0.26]], 0.12, 0.018),
      STEEL,
      { at: [0.44, 0, 0], rot: ACROSS },
    );

    // Inboard (-X) reinforced cheek plate & Bureau cockpit telemetry strips.
    b.solid(
      prism([[-0.94, -0.26], [0.62, -0.24], [0.68, 0.16], [0.36, 0.34], [-0.86, 0.34]], 0.09, 0.022),
      GUNMETAL,
      { at: [-0.40, 0, 0], rot: ACROSS },
    );
    b.glow(new THREE.BoxGeometry(0.03, 0.035, 0.62), RED, 3.6, { at: [-0.455, 0.24, 0.06] });
    b.glow(new THREE.BoxGeometry(0.03, 0.11, 0.045), AMBER, 3.2, { at: [-0.455, 0.05, -0.36] });

    // Under-receiver loading gate ramp, shell lifter fork, and visible brass shell rim at the tube throat.
    b.solid(
      prism([[-0.48, -0.38], [0.46, -0.38], [0.58, -0.28], [-0.36, -0.30]], 0.42, 0.02),
      IRON,
      { rot: ACROSS },
    );
    b.box(0.18, 0.04, 0.46, STEEL, { at: [0, -0.36, -0.14], rot: [0.12, 0, 0] });
    b.cyl(0.082, 0.082, 0.09, 10, BRASS, { at: [0, TUBE_Y - 0.05, -0.46], rot: ALONG_Z });

    // Rear heavy elbow gimbal yoke & trunnion cheeks.
    b.cyl(0.28, 0.28, 0.56, 12, STEEL, { at: [0, 0.18, 0.98], rot: [0, 0, Math.PI / 2] });
    for (const s of [-1, 1]) {
      b.solid(
        prism([[-1.20, -0.02], [-0.82, -0.02], [-0.78, 0.34], [-1.14, 0.34]], 0.12, 0.02),
        PLATE,
        { at: [s * 0.32, 0, 0], rot: ACROSS },
      );
    }

    // ---- Folded-over top metal stock stub with curved hook detail ----
    // Rear folding hinge block & steel cross-pin.
    b.cyl(0.072, 0.072, 0.66, 10, STEEL, { at: [0, 0.54, 0.86], rot: [0, 0, Math.PI / 2] });
    for (const s of [-1, 1]) {
      b.solid(
        prism([[-0.96, 0.44], [-0.76, 0.44], [-0.78, 0.62], [-0.94, 0.62]], 0.11, 0.015),
        OBSIDIAN,
        { at: [s * 0.27, 0, 0], rot: ACROSS },
      );
      // Twin stamped-metal folding stock struts sweeping forward over the receiver top.
      b.solid(
        prism([[-0.88, 0.54], [0.46, 0.58], [0.50, 0.67], [-0.86, 0.64]], 0.068, 0.014),
        GUNMETAL,
        { at: [s * 0.26, 0, 0], rot: ACROSS },
      );
    }
    // Perforated upper stock spine cross-bridges (real open slots between them).
    for (const z of [0.64, 0.30, -0.04, -0.34]) {
      b.solid(
        prism([[-0.26, 0.62], [0.26, 0.62], [0.22, 0.68], [-0.22, 0.68]], 0.13, 0.014),
        PLATE,
        { at: [0, 0, z] },
      );
    }
    // Signature folded hook / arm-brace stub at the forward top end of the folded stock.
    b.solid(
      prism([[0.38, 0.56], [0.56, 0.56], [0.68, 0.66], [0.64, 0.78], [0.46, 0.78], [0.52, 0.68], [0.38, 0.66]], 0.46, 0.018),
      PLATE,
      { rot: ACROSS },
    );
    b.cyl(0.048, 0.048, 0.56, 10, STEEL, { at: [0, 0.62, -0.44], rot: [0, 0, Math.PI / 2] });
    b.solid(
      prism([[0.62, 0.65], [0.70, 0.67], [0.67, 0.77], [0.60, 0.76]], 0.42, 0.014),
      OBSIDIAN,
      { rot: ACROSS },
    );

    // ---- Wide perforated / ventilated upper barrel heat shield with open cooling slots ----
    // Receiver front throat collar tying receiver to barrel shroud and magazine tube.
    b.solid(prism(CLAMP_COLLAR, 0.16, 0.022), GUNMETAL, { at: [0, 0, -0.74] });

    // Longitudinal side shroud rails & slim upper sight rib.
    for (const s of [-1, 1]) {
      b.solid(
        prism([[0.74, -0.02], [2.04, -0.02], [2.04, 0.08], [0.74, 0.08]], 0.08, 0.015),
        GUNMETAL,
        { at: [s * 0.24, 0, 0], rot: ACROSS },
      );
    }
    b.solid(
      prism([[0.74, 0.30], [2.04, 0.30], [2.00, 0.36], [0.74, 0.36]], 0.13, 0.015),
      PLATE,
      { rot: ACROSS },
    );

    // 7 spaced arched U-channel cooling ribs (real open slots between every rib expose the steel barrel inside).
    for (let i = 0; i < 7; i++) {
      const z = -0.84 - i * 0.19;
      b.solid(prism(SHIELD_RIB, 0.085, 0.014), i === 0 || i === 6 ? PLATE : GUNMETAL, { at: [0, 0, z] });
    }

    // Rear ghost-ring sight hood & front protective sight ears with subtle glowing amber sight bead.
    for (const s of [-1, 1]) {
      b.solid(
        prism([[0.58, 0.48], [0.70, 0.48], [0.68, 0.59], [0.60, 0.59]], 0.045, 0.01),
        OBSIDIAN,
        { at: [s * 0.11, 0, 0], rot: ACROSS },
      );
      b.solid(
        prism([[1.90, 0.34], [2.04, 0.34], [2.02, 0.46], [1.94, 0.46]], 0.04, 0.01),
        OBSIDIAN,
        { at: [s * 0.09, 0, 0], rot: ACROSS },
      );
    }
    b.solid(prism([[1.92, 0.34], [2.02, 0.34], [2.00, 0.41], [1.94, 0.41]], 0.07, 0.01), STEEL, { rot: ACROSS });
    b.glow(new THREE.SphereGeometry(0.032, 8, 6), AMBER, 3.4, { at: [0, 0.425, -1.97] });

    // ---- Oversized under-barrel tubular magazine with clamp collar & brass retainer ----
    b.cyl(0.155, 0.155, 1.86, 14, IRON, { at: [0, TUBE_Y, -1.55], rot: ALONG_Z });
    b.cyl(0.168, 0.168, 0.08, 14, BRASS, { at: [0, TUBE_Y, -2.38], rot: ALONG_Z });
    b.cyl(0.164, 0.156, 0.16, 14, GUNMETAL, { at: [0, TUBE_Y, -2.50], rot: ALONG_Z });
    b.cyl(0.125, 0.125, 0.05, 12, STEEL, { at: [0, TUBE_Y, -2.59], rot: ALONG_Z });

    // Heavy figure-8 front barrel-to-magazine clamp collar with protruding steel cross-bolts.
    b.solid(prism(CLAMP_COLLAR, 0.20, 0.024), PLATE, { at: [0, 0, -1.98] });
    for (const s of [-1, 1]) {
      b.cyl(0.042, 0.042, 0.10, 8, STEEL, { at: [s * 0.27, -0.05, -1.98], rot: [0, 0, Math.PI / 2] });
    }

    // ---- Ribbed combat forend grip & dual steel action bars ----
    b.solid(
      prism([[-0.22, -0.34], [0.22, -0.34], [0.25, -0.25], [0.25, -0.12], [0.18, -0.07], [-0.18, -0.07], [-0.25, -0.12], [-0.25, -0.25]], 0.88, 0.022),
      OBSIDIAN,
      { at: [0, 0, -1.36] },
    );
    for (let i = 0; i < 6; i++) {
      const z = -1.01 - i * 0.14;
      b.solid(prism(FOREND_RIB, 0.072, 0.014), i % 2 === 0 ? GUNMETAL : IRON, { at: [0, 0, z] });
    }
    for (const s of [-1, 1]) {
      b.box(0.04, 0.06, 0.62, STEEL, { at: [s * 0.22, -0.11, -0.82] });
    }
  },
  moving: b => {
    // ---- Heavy thick-walled recoiling steel barrel (visible through heat shield cooling slots) ----
    b.cyl(0.165, 0.175, 0.42, 14, GUNMETAL, { at: [0, BORE_Y, -0.74], rot: ALONG_Z });
    b.cyl(0.138, 0.148, 2.16, 14, STEEL, { at: [0, BORE_Y, -1.72], rot: ALONG_Z });
    // Brass gas-port collar band mid-barrel (flashes past the heat-shield slots on recoil).
    b.cyl(0.154, 0.154, 0.09, 14, BRASS, { at: [0, BORE_Y, -1.34], rot: ALONG_Z });

    // Heavy angular ported breaching muzzle choke & deep dark bore cavity.
    b.solid(
      prism(
        [[2.66, -0.07], [2.94, -0.07], [2.98, 0.01], [2.98, 0.23], [2.94, 0.31], [2.66, 0.31], [2.62, 0.23], [2.62, 0.01]],
        0.38,
        0.026,
      ),
      OBSIDIAN,
      { rot: ACROSS },
    );
    b.cyl(0.185, 0.185, 0.08, 14, GUNMETAL, { at: [0, BORE_Y, -2.68], rot: ALONG_Z });
    b.cyl(0.125, 0.125, 0.10, 12, DARK, { at: [0, BORE_Y, -2.94], rot: ALONG_Z });
    for (const s of [-1, 1]) {
      b.box(0.05, 0.14, 0.10, DARK, { at: [s * 0.19, BORE_Y, -2.79] });
      b.box(0.05, 0.14, 0.08, DARK, { at: [s * 0.19, BORE_Y, -2.90] });
    }

    // Reciprocating heavy steel bolt carrier & outboard charging handle inside ejection port.
    b.solid(
      prism([[-0.12, 0.03], [0.22, 0.03], [0.22, 0.24], [-0.12, 0.24]], 0.07, 0.014),
      STEEL,
      { at: [0.36, 0, 0], rot: ACROSS },
    );
    b.cyl(0.044, 0.044, 0.14, 10, STEEL, { at: [0.47, 0.14, -0.17], rot: [0, 0, Math.PI / 2] });
    b.cyl(0.052, 0.052, 0.05, 10, OBSIDIAN, { at: [0.53, 0.14, -0.17], rot: [0, 0, Math.PI / 2] });
  },
  muzzle: [0, BORE_Y, -2.98],
  follow: 22,
  return: 15,
};
