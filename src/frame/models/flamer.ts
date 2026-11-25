/**
 * Heavy Incinerator arm weapon 3D model (`src/frame/models/flamer.ts`).
 *
 * Native side: right (`-X` inboard toward cockpit, `+X` outboard, `-Z` forward along bore, `+Z` rear elbow).
 * Sculpted industrial Bureau incinerator architecture:
 *   - Fixed (`build`): bevelled `OBSIDIAN`/`PLATE` heavy receiver cowling, twin underslung pressurized
 *     cylindrical fuel tanks bound with ribbed `STEEL` retaining straps and `BRASS` pressure valves/manifolds,
 *     thick insulated segmented hose conduits routing fuel into the breech, and inboard pressure telemetry.
 *   - Moving (`moving`): heavy ribbed barrel jacket, flanged wide-mouth octagonal igniter nozzle with recessed
 *     `DARK` throat, and twin protruding spark-igniter prongs with `BRASS` insulators and glowing tips.
 *   - Extra (`extra`): roaring translucent additive pilot flame cone mesh inside the wide-mouth igniter that
 *     idles as a compact pilot flame at `setActive(0.2)` and roars out at `setActive(1)`.
 */
import * as THREE from 'three';
import { clamp } from '../../core/math';
import type { GunExtra, GunSpec } from '../../vehicles/guns';
import {
  ACROSS, ALONG_Z, AMBER, BRASS, DARK, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL, ngon, prism,
} from './shared';

export const FLAMER_ARM: GunSpec = {
  name: 'frame-flamer',

  build: b => {
    // Heavy bevelled main incinerator receiver chassis (+u forward along -Z).
    b.solid(
      prism(
        [[-1.12, -0.18], [0.95, -0.18], [1.18, 0.02], [1.1, 0.34], [0.62, 0.48], [-0.92, 0.48], [-1.22, 0.22]],
        0.78,
        0.048,
      ),
      OBSIDIAN,
      { rot: ACROSS },
    );

    // Ventilated upper thermal shroud hood with slotted ridge plates.
    b.solid(
      prism([[-0.82, 0.42], [0.76, 0.42], [0.96, 0.3], [0.54, 0.58], [-0.74, 0.58]], 0.64, 0.032),
      PLATE,
      { rot: ACROSS },
    );
    for (let i = 0; i < 4; i++) {
      b.solid(
        prism([[-0.55 + i * 0.34, 0.54], [-0.36 + i * 0.34, 0.54], [-0.34 + i * 0.34, 0.62], [-0.57 + i * 0.34, 0.62]], 0.36, 0.012),
        DARK,
        { rot: ACROSS },
      );
    }

    // Side structural cheek plates & heat-vent ribs.
    for (const s of [-1, 1]) {
      b.solid(
        prism([[-0.88, -0.12], [0.84, -0.1], [0.98, 0.1], [0.72, 0.32], [-0.76, 0.32]], 0.12, 0.024),
        GUNMETAL,
        { at: [s * 0.4, 0.04, 0], rot: ACROSS },
      );
    }

    // Twin underslung pressurized cylindrical fuel tanks with ribbed steel straps and brass pressure valves.
    for (const s of [-1, 1]) {
      const tx = s * 0.25;
      const ty = -0.38;
      const tz = -0.34;
      // Main pressurized fuel cylinder.
      b.cyl(0.185, 0.185, 1.48, 14, GUNMETAL, { at: [tx, ty, tz], rot: ALONG_Z });
      // Tapered steel pressure domes fore and aft.
      b.cyl(0.11, 0.185, 0.16, 14, PLATE, { at: [tx, ty, tz - 0.82], rot: ALONG_Z });
      b.cyl(0.185, 0.11, 0.16, 14, PLATE, { at: [tx, ty, tz + 0.82], rot: ALONG_Z });

      // Four ribbed steel retaining straps clamping each tank to the cradle.
      for (const sz of [-0.56, -0.18, 0.2, 0.56]) {
        b.cyl(0.204, 0.204, 0.075, 14, STEEL, { at: [tx, ty, tz + sz], rot: ALONG_Z });
        b.cyl(0.212, 0.212, 0.028, 14, IRON, { at: [tx, ty, tz + sz], rot: ALONG_Z });
      }

      // Brass pressure relief valves, manifold collars, and regulator wheels.
      b.cyl(0.068, 0.082, 0.14, 10, BRASS, { at: [tx, ty, tz - 0.94], rot: ALONG_Z });
      b.cyl(0.055, 0.055, 0.12, 10, BRASS, { at: [tx + s * 0.16, ty + 0.08, tz - 0.52], rot: [0, 0, s * 0.85] });
      b.solid(new THREE.TorusGeometry(0.075, 0.018, 6, 12), BRASS, {
        at: [tx + s * 0.22, ty + 0.12, tz - 0.52],
        rot: [0, Math.PI / 2, 0],
      });
      b.cyl(0.048, 0.048, 0.12, 8, BRASS, { at: [tx, ty, tz + 0.94], rot: ALONG_Z });
    }

    // Underslung tank cradle bridge beam.
    b.solid(
      prism([[-0.48, -0.24], [0.88, -0.24], [0.96, -0.14], [-0.48, -0.14]], 0.56, 0.024),
      IRON,
      { rot: ACROSS },
    );

    // Thick insulated segmented hose conduits curving from the front tank manifolds up into the breech.
    for (const s of [-1, 1]) {
      const steps = 6;
      for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        const hx = s * (0.28 + Math.sin(t * Math.PI) * 0.18);
        const hy = -0.38 + t * 0.44;
        const hz = -1.28 + Math.sin(t * Math.PI) * -0.14 + t * 0.18;
        b.cyl(0.062, 0.062, 0.14, 10, i % 2 === 0 ? DARK : IRON, {
          at: [hx, hy, hz],
          rot: [0.35 - t * 0.5, 0, s * (0.45 - t * 0.9)],
        });
      }
      // Brass compression fittings at both ends of the insulated hose.
      b.cyl(0.076, 0.076, 0.07, 10, BRASS, { at: [s * 0.28, -0.36, -1.26], rot: ALONG_Z });
      b.cyl(0.076, 0.076, 0.07, 10, BRASS, { at: [s * 0.34, 0.04, -1.1], rot: [0, 0, Math.PI / 2] });
    }

    // Rear heavy elbow gimbal & machined yoke.
    b.cyl(0.32, 0.32, 0.58, 12, STEEL, { at: [0, 0.16, 1.0], rot: [0, 0, Math.PI / 2] });
    b.cyl(0.22, 0.22, 0.68, 10, IRON, { at: [0, 0.16, 1.0], rot: [0, 0, Math.PI / 2] });

    // Inboard fuel-pressure & pilot status telemetry strips facing the cockpit.
    b.solid(prism([[-0.4, 0.12], [0.52, 0.12], [0.52, 0.24], [-0.4, 0.24]], 0.04, 0.008), DARK, { at: [-0.45, 0, 0], rot: ACROSS });
    b.glow(new THREE.BoxGeometry(0.024, 0.036, 0.8), AMBER, 4.4, { at: [-0.465, 0.18, -0.06] });
    b.glow(new THREE.BoxGeometry(0.024, 0.1, 0.038), RED, 4.2, { at: [-0.465, 0.02, -0.58] });
  },

  moving: b => {
    // Heavy insulated projector barrel tube & slotted cooling jacket.
    b.cyl(0.20, 0.23, 1.18, 14, GUNMETAL, { at: [0, 0.02, -1.68], rot: ALONG_Z });
    for (let i = 0; i < 4; i++) {
      const z = -1.26 - i * 0.25;
      b.solid(prism(ngon(0.30, 8, Math.PI / 8), 0.07, 0.015), i % 2 === 0 ? PLATE : STEEL, { at: [0, 0.02, z] });
    }

    // Flanged heavy wide-mouth igniter nozzle bell stepping outward to disperse stream or wide deluge.
    b.solid(prism(ngon(0.35, 8, Math.PI / 8), 0.20, 0.025), OBSIDIAN, { at: [0, 0.02, -2.32] });
    b.solid(prism(ngon(0.42, 8, Math.PI / 8), 0.16, 0.024), PLATE, { at: [0, 0.02, -2.50] });
    b.solid(prism(ngon(0.46, 8, Math.PI / 8), 0.09, 0.018), STEEL, { at: [0, 0.02, -2.60] });
    // Deep recessed scorched nozzle throat + glowing pilot igniter ring inside the wide mouth.
    b.cyl(0.28, 0.22, 0.28, 14, DARK, { at: [0, 0.02, -2.54], rot: ALONG_Z });
    b.glow(new THREE.TorusGeometry(0.22, 0.024, 8, 16), AMBER, 5.4, { at: [0, 0.02, -2.61] });

    // Twin protruding spark-igniter prongs (upper & lower angled steel electrodes with brass insulator collars).
    for (const sy of [-1, 1]) {
      // Mounting flange lug.
      b.solid(
        prism([[0, -0.05], [0.22, -0.04], [0.24, 0.04], [0, 0.05]], 0.12, 0.014),
        IRON,
        { at: [0, 0.02 + sy * 0.34, -2.44], rot: ACROSS },
      );
      // Brass ceramic insulator collar.
      b.cyl(0.052, 0.058, 0.12, 8, BRASS, { at: [0, 0.02 + sy * 0.31, -2.62], rot: ALONG_Z });
      // Tapered steel spark prong canted inward toward the pilot cone.
      b.cyl(0.018, 0.036, 0.34, 8, STEEL, {
        at: [0, 0.02 + sy * 0.24, -2.78],
        rot: [Math.PI / 2 - sy * 0.34, 0, 0],
      });
      // Hot spark tip glow.
      b.glow(new THREE.SphereGeometry(0.028, 8, 6), AMBER, 6.2, { at: [0, 0.02 + sy * 0.17, -2.92] });
    }
  },

  extra(_materials, palette): GunExtra {
    const group = new THREE.Group();
    group.name = 'flamer-pilot-cone';

    // Outer roaring napalm flame cone (apex pointing forward along -Z).
    const outerGeo = new THREE.ConeGeometry(0.28, 1.35, 12, 1, true);
    outerGeo.rotateX(-Math.PI / 2);
    outerGeo.translate(0, 0, -0.68);
    const outerMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.thruster || '#ff7820'),
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const outerMesh = new THREE.Mesh(outerGeo, outerMat);
    outerMesh.position.set(0, 0.02, -2.56);

    // Inner incandescent core pilot cone.
    const innerGeo = new THREE.ConeGeometry(0.14, 0.85, 10, 1, true);
    innerGeo.rotateX(-Math.PI / 2);
    innerGeo.translate(0, 0, -0.42);
    const innerMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.thrusterCore || '#fff0b8'),
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const innerMesh = new THREE.Mesh(innerGeo, innerMat);
    innerMesh.position.set(0, 0.02, -2.56);

    group.add(outerMesh, innerMesh);

    const setActive = (amount: number, mode = 0): void => {
      const a = clamp(amount);
      const wideBoost = mode === 1 ? 1.55 : 1.0;
      const radial = (0.35 + a * 0.95) * wideBoost;
      const length = (0.28 + a * 1.45) * (mode === 1 ? 0.8 : 1.15);
      outerMesh.scale.set(radial, radial, length);
      innerMesh.scale.set(radial * 0.8, radial * 0.8, length * 0.85);
      outerMat.opacity = 0.14 + a * 0.72;
      innerMat.opacity = 0.25 + a * 0.7;
      group.visible = a > 0.01;
    };

    setActive(0.2, 0);
    return { group, setActive };
  },

  muzzle: [0, 0.02, -2.86],
  follow: 20,
  return: 14,
};
