/**
 * Guided Heavy Missile shoulder model (`buildWireBomb` / `SHOULDER_WIRE`).
 * Massive single-tube heavy cruise-missile launch rail/pod with bulky protruding warhead nose, cruciform
 * stabilizer fins tucked inside the rail shroud, side-mounted laser-designator optic pod with glowing red lens,
 * and plate/steel/brass retention clamps.
 */
import * as THREE from 'three';
import type { ModelBuilder } from '../../progression/modelkit';
import { ACROSS, ALONG_Z, AMBER, BRASS, DARK, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL, prism } from './shared';

/** Builds the heavy guided missile launch rail/pod in local shoulder mount space (origin = pylon mount, -Z = forward). */
export function buildWireBomb(b: ModelBuilder): void {
  // Heavy shoulder trunnion pylon, side gussets, and brass pivot pins.
  b.cyl(0.15, 0.18, 0.52, 10, STEEL, { at: [0, -0.48, 0.06] });
  b.solid(prism([[-0.44, -0.34], [0.46, -0.34], [0.36, -0.18], [-0.36, -0.18]], 0.54, 0.03), IRON, { rot: ACROSS });
  for (const s of [-1, 1]) {
    b.cyl(0.055, 0.055, 0.10, 8, BRASS, { at: [s * 0.30, -0.28, 0.06], rot: [0, 0, Math.PI / 2] });
  }

  // Massive single-tube armoured launch cradle & open-front rail shroud (OBSIDIAN spine + GUNMETAL side cheeks).
  b.solid(
    prism(
      [[-1.02, -0.26], [0.88, -0.26], [0.96, -0.10], [0.84, 0.44], [0.48, 0.54], [-0.88, 0.54], [-1.06, 0.34]],
      0.84,
      0.05,
    ),
    OBSIDIAN,
    { rot: ACROSS },
  );
  // Sloped upper dorsal rail cover + flank armour rails cradling the heavy tube.
  b.solid(prism([[-0.84, 0.42], [0.86, 0.42], [0.76, 0.58], [-0.74, 0.58]], 0.58, 0.03), PLATE, { rot: ACROSS });
  for (const s of [-1, 1]) {
    b.solid(prism([[-0.92, -0.18], [0.92, -0.18], [1.02, 0.02], [0.90, 0.24], [-0.88, 0.24], [-0.98, 0.04]], 0.14, 0.025), GUNMETAL, {
      at: [s * 0.42, 0.06, 0],
      rot: ACROSS,
    });
  }

  // Rear back-blast exhaust bell shroud & dark bore.
  b.cyl(0.36, 0.42, 0.26, 14, IRON, { at: [0, 0.08, 1.06], rot: ALONG_Z });
  b.cyl(0.28, 0.32, 0.16, 14, DARK, { at: [0, 0.08, 1.14], rot: ALONG_Z });

  // Three heavy circumferential PLATE / STEEL / BRASS retention clamps along the launch tube.
  for (const z of [0.58, -0.06, -0.68]) {
    b.cyl(0.41, 0.41, 0.12, 14, PLATE, { at: [0, 0.08, z], rot: ALONG_Z });
    b.cyl(0.43, 0.43, 0.045, 14, BRASS, { at: [0, 0.08, z], rot: ALONG_Z });
    for (const s of [-1, 1]) {
      b.solid(prism([[-0.07, -0.07], [0.07, -0.07], [0.09, 0.07], [-0.09, 0.07]], 0.12, 0.015), STEEL, {
        at: [s * 0.45, 0.08, z],
        rot: ACROSS,
      });
    }
  }

  // Bulky heavy cruise missile seated inside the rail with protruding warhead nose (-Z).
  // Main fuselage cylinder.
  b.cyl(0.30, 0.30, 1.72, 16, GUNMETAL, { at: [0, 0.08, -0.10], rot: ALONG_Z });
  // Forward heavy warhead collar + brass fuzing ring + tapered bulky ogive nose protruding well ahead of shroud.
  b.cyl(0.32, 0.32, 0.14, 16, STEEL, { at: [0, 0.08, -0.96], rot: ALONG_Z });
  b.cyl(0.33, 0.33, 0.06, 16, BRASS, { at: [0, 0.08, -1.06], rot: ALONG_Z });
  b.cyl(0.22, 0.32, 0.36, 16, PLATE, { at: [0, 0.08, -1.26], rot: ALONG_Z });
  b.cyl(0.08, 0.22, 0.30, 16, OBSIDIAN, { at: [0, 0.08, -1.58], rot: ALONG_Z });
  b.glow(new THREE.CylinderGeometry(0.062, 0.078, 0.04, 12), AMBER, 4.4, { at: [0, 0.08, -1.74], rot: ALONG_Z });

  // Cruciform stabilizer fins tucked cleanly inside the rail shroud slots (45 deg X-arrangement).
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2 + Math.PI / 4;
    const fx = Math.cos(angle) * 0.31;
    const fy = 0.08 + Math.sin(angle) * 0.31;
    // Aft main cruciform stabilizers tucked inside rear rail channels.
    b.solid(prism([[-0.26, -0.02], [0.22, -0.02], [0.10, 0.14], [-0.26, 0.12]], 0.032, 0.008), PLATE, {
      at: [fx, fy, 0.42],
      rot: [0, Math.PI / 2, angle - Math.PI / 2],
    });
    // Forward steering canard vanes tucked behind the warhead collar.
    const cx = Math.cos(angle) * 0.29;
    const cy = 0.08 + Math.sin(angle) * 0.29;
    b.solid(prism([[-0.12, -0.015], [0.10, -0.015], [0.02, 0.09], [-0.12, 0.08]], 0.024, 0.006), STEEL, {
      at: [cx, cy, -0.78],
      rot: [0, Math.PI / 2, angle - Math.PI / 2],
    });
  }

  // Side-mounted laser-designator optic pod with recessed RED lens on the outboard flank (+X).
  b.solid(prism([[-0.18, -0.07], [0.18, -0.07], [0.14, 0.07], [-0.14, 0.07]], 0.26, 0.015), STEEL, {
    at: [0.48, 0.12, -0.26],
  });
  b.solid(
    prism([[-0.34, -0.15], [0.38, -0.15], [0.46, -0.04], [0.44, 0.14], [0.32, 0.18], [-0.30, 0.18], [-0.38, 0.04]], 0.26, 0.028),
    OBSIDIAN,
    { at: [0.64, 0.12, -0.34], rot: ACROSS },
  );
  // Top visor hood on the optic pod.
  b.solid(prism([[-0.16, 0.14], [0.48, 0.14], [0.54, 0.20], [-0.12, 0.20]], 0.24, 0.014), PLATE, {
    at: [0.64, 0.12, -0.34],
    rot: ACROSS,
  });
  // Recessed dark optic housing + glowing RED laser designator lens + brass bezel ring.
  b.cyl(0.105, 0.115, 0.10, 12, BRASS, { at: [0.64, 0.12, -0.76], rot: ALONG_Z });
  b.cyl(0.088, 0.088, 0.06, 12, DARK, { at: [0.64, 0.12, -0.80], rot: ALONG_Z });
  b.glow(new THREE.CylinderGeometry(0.068, 0.068, 0.035, 12), RED, 4.8, { at: [0.64, 0.12, -0.82], rot: ALONG_Z });
  // Thin inset status strips on dorsal rail and designator cheek.
  b.glow(new THREE.BoxGeometry(0.06, 0.025, 0.72), RED, 3.8, { at: [0, 0.59, -0.10] });
  b.glow(new THREE.BoxGeometry(0.022, 0.026, 0.24), AMBER, 3.4, { at: [0.78, 0.14, -0.34] });
}

export const SHOULDER_WIRE = buildWireBomb;
