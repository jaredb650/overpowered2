/**
 * Point Defence active protection turret model (`pointdef`).
 * Sleek bevelled dome turret in plate/steel with a canted phased-array radar panel (amber trim)
 * and a compact twin-barrel rapid interceptor stub.
 */
import * as THREE from 'three';
import type { ModelBuilder } from '../../progression/modelkit';
import {
  ACROSS, ALONG_Z, AMBER, DARK, FLAT, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL,
  ngon, prism, type ShoulderModelBuilder,
} from './shared';

export function buildPointDef(b: ModelBuilder): void {
  // Turret pedestal & octagonal azimuth slewing ring.
  b.cyl(0.22, 0.28, 0.34, 12, IRON, { at: [0, -0.34, 0] });
  b.solid(prism(ngon(0.42, 8, Math.PI / 8), 0.14, 0.025), STEEL, { at: [0, -0.14, 0], rot: FLAT });

  // Sleek bevelled dome turret body: layered faceted cupola in PLATE / STEEL / OBSIDIAN.
  b.solid(prism(ngon(0.48, 8, Math.PI / 8), 0.24, 0.04), OBSIDIAN, { at: [0, 0.02, 0], rot: FLAT });
  b.solid(prism(ngon(0.44, 8, Math.PI / 8), 0.22, 0.045), PLATE, { at: [0, 0.2, 0], rot: FLAT });
  b.solid(prism(ngon(0.32, 8, Math.PI / 8), 0.14, 0.035), STEEL, { at: [0, 0.36, 0.02], rot: FLAT });

  // Rear sensor counterweight bustle & cooling gill collar.
  b.solid(
    prism([[-0.56, -0.06], [-0.14, -0.06], [-0.1, 0.28], [-0.46, 0.32], [-0.6, 0.12]], 0.54, 0.035),
    GUNMETAL,
    { rot: ACROSS },
  );

  // Primary canted phased-array radar panel atop the rear dome + twin cheek track-radar pads.
  b.solid(
    prism([
      [-0.32, -0.2], [0.32, -0.2], [0.38, -0.1], [0.34, 0.18],
      [0.24, 0.24], [-0.24, 0.24], [-0.34, 0.18], [-0.38, -0.1],
    ], 0.1, 0.022),
    GUNMETAL,
    { at: [0, 0.56, 0.12], rot: [-0.34, 0, 0] },
  );
  // Recessed dark AESA emitter face + thin inset AMBER radar trim border.
  b.solid(
    prism([[-0.26, -0.14], [0.26, -0.14], [0.28, 0.12], [0.2, 0.18], [-0.2, 0.18], [-0.28, 0.12]], 0.04, 0.008),
    DARK,
    { at: [0, 0.57, 0.075], rot: [-0.34, 0, 0] },
  );
  b.glow(new THREE.BoxGeometry(0.48, 0.022, 0.02), AMBER, 4.2, { at: [0, 0.71, 0.02], rot: [-0.34, 0, 0] });
  b.glow(new THREE.BoxGeometry(0.48, 0.022, 0.02), AMBER, 4.2, { at: [0, 0.43, 0.115], rot: [-0.34, 0, 0] });
  // Radar support yoke struts.
  for (const s of [-1, 1]) {
    b.solid(
      prism([[-0.05, -0.14], [0.06, -0.14], [0.05, 0.16], [-0.04, 0.16]], 0.07, 0.012),
      STEEL,
      { at: [s * 0.24, 0.42, 0.16], rot: [-0.22, 0, 0] },
    );
    // Side canted track-radar cheek pods.
    b.solid(
      prism([[-0.18, -0.1], [0.2, -0.1], [0.24, 0.08], [-0.14, 0.12]], 0.1, 0.02),
      PLATE,
      { at: [s * 0.46, 0.14, -0.02], rot: [0, s * 0.24, s * -0.18] },
    );
    b.glow(new THREE.BoxGeometry(0.02, 0.022, 0.24), AMBER, 3.6, { at: [s * 0.51, 0.14, -0.04], rot: [0, s * 0.24, 0] });
  }

  // Compact twin-barrel rapid interceptor stub + bevelled armoured mantlet projecting along -Z.
  b.solid(
    prism([[-0.22, -0.12], [0.22, -0.12], [0.26, 0.04], [0.18, 0.14], [-0.18, 0.14], [-0.26, 0.04]], 0.34, 0.025),
    OBSIDIAN,
    { at: [0, 0.14, -0.42] },
  );
  b.solid(
    prism([[-0.17, -0.08], [0.17, -0.08], [0.19, 0.06], [-0.19, 0.06]], 0.16, 0.016),
    GUNMETAL,
    { at: [0, 0.14, -0.58] },
  );
  // Twin short rapid-fire interceptor barrels with steel shrouds and iron muzzle brakes.
  for (const x of [-0.095, 0.095]) {
    b.cyl(0.042, 0.048, 0.42, 10, STEEL, { at: [x, 0.14, -0.76], rot: ALONG_Z });
    b.cyl(0.052, 0.052, 0.09, 10, IRON, { at: [x, 0.14, -0.94], rot: ALONG_Z });
    b.cyl(0.028, 0.028, 0.04, 8, DARK, { at: [x, 0.14, -0.99], rot: ALONG_Z });
  }

  // Forward electro-optical tracking lens + thin inset active status diode.
  b.cyl(0.048, 0.056, 0.12, 10, IRON, { at: [0, 0.27, -0.44], rot: ALONG_Z });
  b.glow(new THREE.CylinderGeometry(0.03, 0.03, 0.025, 10), RED, 4.5, { at: [0, 0.27, -0.51], rot: ALONG_Z });
  b.glow(new THREE.BoxGeometry(0.2, 0.02, 0.02), AMBER, 3.8, { at: [0, 0.04, -0.58] });
}

export const SHOULDER_POINTDEF: ShoulderModelBuilder = buildPointDef;
