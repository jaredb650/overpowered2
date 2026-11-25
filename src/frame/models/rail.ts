/**
 * Linear Rail Rifle 3D arm model (`src/frame/models/rail.ts`).
 *
 * Native side: right (`-X` inboard toward cockpit, `+X` outboard, `-Z` forward along bore, `+Z` rear elbow).
 * Long aggressive twin-rail electromagnetic sniper architecture:
 *   - Fixed (`build`): angular bevelled `OBSIDIAN`/`PLATE` breech receiver, heavy breech capacitor drum with
 *     `BRASS` terminal rings, dorsal scope prism housing with recessed `DARK` optic aperture, and recoil track.
 *   - Moving (`moving`): recoiling rail carriage supporting `3.2 m` extended split parallel magnetic rails
 *     (`z = -0.80` to `z = -4.00`), 9 exposed copper/`BRASS` induction coils spanning the open barrel gap,
 *     and cantilevered stabilizer muzzle clamps.
 *   - Extra (`extra`): glowing electromagnetic rail charge strip running down the central accelerator gap,
 *     illuminating progressively with charge ratio and shifting hue between `SABOT` and `ARC` modes.
 */
import * as THREE from 'three';
import { clamp } from '../../core/math';
import type { GunExtra, GunSpec } from '../../vehicles/guns';
import {
  ACROSS, ALONG_Z, AMBER, BRASS, DARK, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL, prism,
} from './shared';

export const RAIL_ARM: GunSpec = {
  name: 'frame-rail',

  build: b => {
    // Sleek, heavy angular precision rail breech receiver (+u forward along -Z).
    b.solid(
      prism(
        [[-1.18, -0.22], [0.88, -0.2], [1.14, -0.02], [1.02, 0.3], [0.52, 0.42], [-0.98, 0.42], [-1.26, 0.16]],
        0.64,
        0.04,
      ),
      OBSIDIAN,
      { rot: ACROSS },
    );

    // Side structural cheek shrouds & recessed breech vents.
    for (const s of [-1, 1]) {
      b.solid(
        prism([[-0.84, -0.14], [0.76, -0.12], [0.9, 0.06], [0.64, 0.28], [-0.74, 0.28]], 0.1, 0.02),
        GUNMETAL,
        { at: [s * 0.35, 0.04, 0], rot: ACROSS },
      );
    }

    // Heavy breech capacitor drum mounted outboard/rear with brass high-voltage terminal rings.
    b.cyl(0.22, 0.22, 0.86, 14, GUNMETAL, { at: [0.42, 0.04, 0.26], rot: ALONG_Z });
    for (const cz of [-0.04, 0.26, 0.56]) {
      b.cyl(0.236, 0.236, 0.055, 14, STEEL, { at: [0.42, 0.04, cz], rot: ALONG_Z });
    }
    b.cyl(0.16, 0.2, 0.11, 14, BRASS, { at: [0.42, 0.04, -0.22], rot: ALONG_Z });
    b.cyl(0.2, 0.16, 0.11, 14, BRASS, { at: [0.42, 0.04, 0.74], rot: ALONG_Z });
    // Copper/brass power feed busbar from capacitor drum into the rail breech.
    b.cyl(0.04, 0.04, 0.56, 8, BRASS, { at: [0.24, 0.04, -0.44], rot: [0, 0.42, Math.PI / 2] });

    // Dorsal precision scope prism housing mounted atop the receiver.
    b.solid(
      prism([[-0.38, 0.38], [0.68, 0.38], [0.84, 0.46], [0.66, 0.64], [-0.26, 0.64], [-0.46, 0.5]], 0.28, 0.022),
      PLATE,
      { rot: ACROSS },
    );
    // Scope mounting stanchions.
    for (const sz of [-0.45, 0.15]) {
      b.solid(prism([[-0.08, 0.34], [0.08, 0.34], [0.06, 0.44], [-0.06, 0.44]], 0.22, 0.01), IRON, { at: [0, 0, sz], rot: ACROSS });
    }
    // Recessed dark optical objective & glowing thin reticle slit.
    b.cyl(0.082, 0.088, 0.14, 12, DARK, { at: [0, 0.51, -0.78], rot: ALONG_Z });
    b.glow(new THREE.TorusGeometry(0.064, 0.012, 6, 14), RED, 5.2, { at: [0, 0.51, -0.84] });

    // Underslung heavy linear recoil guide cradle.
    b.solid(
      prism([[-0.42, -0.34], [1.18, -0.3], [1.28, -0.18], [-0.38, -0.2]], 0.38, 0.024),
      IRON,
      { rot: ACROSS },
    );
    b.cyl(0.065, 0.065, 1.32, 10, STEEL, { at: [0, -0.26, -0.66], rot: ALONG_Z });

    // Rear heavy elbow gimbal.
    b.cyl(0.3, 0.3, 0.54, 12, STEEL, { at: [0, 0.12, 1.04], rot: [0, 0, Math.PI / 2] });
    b.cyl(0.2, 0.2, 0.64, 10, IRON, { at: [0, 0.12, 1.04], rot: [0, 0, Math.PI / 2] });

    // Inboard charge telemetry strip facing the pilot cockpit.
    b.solid(prism([[-0.34, 0.12], [0.58, 0.12], [0.58, 0.22], [-0.34, 0.22]], 0.04, 0.008), DARK, { at: [-0.39, 0, 0], rot: ACROSS });
    b.glow(new THREE.BoxGeometry(0.022, 0.03, 0.82), AMBER, 4.4, { at: [-0.405, 0.17, -0.12] });
  },

  moving: b => {
    // Heavy machined recoiling rail carriage block bridging receiver to the twin rails.
    b.solid(
      prism([[-0.22, -0.22], [0.46, -0.22], [0.56, -0.1], [0.56, 0.18], [0.42, 0.26], [-0.22, 0.26]], 0.44, 0.024),
      PLATE,
      { at: [0, 0.02, -0.96], rot: ACROSS },
    );

    // 3.2 m extended split parallel magnetic rails running from z = -0.80 out to z = -4.00!
    // Upper magnetic rail blade.
    b.solid(
      prism([[0.0, 0.12], [3.08, 0.11], [3.2, 0.15], [3.06, 0.22], [0.06, 0.26], [-0.04, 0.18]], 0.26, 0.02),
      OBSIDIAN,
      { at: [0, 0.02, -0.80], rot: ACROSS },
    );
    b.solid(
      prism([[0.08, 0.09], [3.12, 0.09], [3.16, 0.13], [0.08, 0.13]], 0.14, 0.01),
      STEEL,
      { at: [0, 0.02, -0.80], rot: ACROSS },
    );

    // Lower magnetic rail blade.
    b.solid(
      prism([[0.0, -0.24], [3.06, -0.20], [3.2, -0.14], [3.08, -0.10], [0.0, -0.10], [-0.04, -0.17]], 0.26, 0.02),
      GUNMETAL,
      { at: [0, 0.02, -0.80], rot: ACROSS },
    );
    b.solid(
      prism([[0.08, -0.12], [3.12, -0.12], [3.16, -0.08], [0.08, -0.08]], 0.14, 0.01),
      STEEL,
      { at: [0, 0.02, -0.80], rot: ACROSS },
    );

    // Exposed copper/brass induction coils arrayed down the 3.2 m open barrel gap.
    for (let i = 0; i < 9; i++) {
      const cz = -1.16 - i * 0.31;
      // Lateral brass induction coil yokes flanking the accelerator gap.
      for (const s of [-1, 1]) {
        b.cyl(0.032, 0.032, 0.28, 8, BRASS, { at: [s * 0.15, 0.02, cz] });
        b.solid(
          prism([[-0.035, -0.18], [0.035, -0.18], [0.05, 0.18], [-0.05, 0.18]], 0.045, 0.008),
          i % 2 === 0 ? PLATE : STEEL,
          { at: [s * 0.18, 0.02, cz], rot: ACROSS },
        );
      }
      // Copper/brass upper & lower induction bridge straps.
      b.cyl(0.026, 0.026, 0.32, 8, BRASS, { at: [0, 0.17, cz], rot: [0, 0, Math.PI / 2] });
      b.cyl(0.026, 0.026, 0.32, 8, BRASS, { at: [0, -0.13, cz], rot: [0, 0, Math.PI / 2] });
    }

    // Aggressive cantilevered muzzle stabilizer fins flanking the rail tips.
    for (const s of [-1, 1]) {
      b.solid(
        prism([[2.48, -0.06], [3.08, -0.04], [3.18, 0.02], [3.08, 0.08], [2.48, 0.1]], 0.07, 0.012),
        PLATE,
        { at: [s * 0.18, 0.02, -0.80], rot: ACROSS },
      );
    }

    // Thin static inset accelerator trim along outer rail edges.
    b.glow(new THREE.BoxGeometry(0.022, 0.018, 2.86), RED, 4.6, { at: [0, 0.115, -2.42] });
    b.glow(new THREE.BoxGeometry(0.022, 0.018, 2.86), RED, 4.6, { at: [0, -0.075, -2.42] });
  },

  extra(_materials, _palette): GunExtra {
    const group = new THREE.Group();
    group.name = 'rail-charge-strip';

    const sabotColor = new THREE.Color('#38e0ff');
    const arcColor = new THREE.Color('#9a78ff');

    // Glowing rail charge strip running cleanly down the open 3.2 m electromagnetic gap.
    const stripGeo = new THREE.BoxGeometry(0.048, 0.048, 2.95);
    const stripMat = new THREE.MeshBasicMaterial({
      color: sabotColor.clone(),
      transparent: true,
      opacity: 0.25,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const stripMesh = new THREE.Mesh(stripGeo, stripMat);
    stripMesh.position.set(0, 0.02, -2.44);

    // Outer energized field halo along the accelerator gap.
    const haloGeo = new THREE.BoxGeometry(0.11, 0.095, 2.98);
    const haloMat = new THREE.MeshBasicMaterial({
      color: sabotColor.clone(),
      transparent: true,
      opacity: 0.1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const haloMesh = new THREE.Mesh(haloGeo, haloMat);
    haloMesh.position.set(0, 0.02, -2.44);

    // Focusing muzzle ring glow at the tip of the 3.2 m rails.
    const muzzleRingGeo = new THREE.TorusGeometry(0.11, 0.02, 8, 16);
    const muzzleRingMat = new THREE.MeshBasicMaterial({
      color: sabotColor.clone(),
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const muzzleRing = new THREE.Mesh(muzzleRingGeo, muzzleRingMat);
    muzzleRing.position.set(0, 0.02, -3.96);

    group.add(stripMesh, haloMesh, muzzleRing);

    const setActive = (amount: number, mode = 0): void => {
      const a = clamp(amount);
      const baseColor = mode === 1 ? arcColor : sabotColor;
      stripMat.color.copy(baseColor);
      haloMat.color.copy(baseColor);
      muzzleRingMat.color.copy(baseColor);

      const widthScale = 0.65 + a * 1.15;
      stripMesh.scale.set(widthScale, widthScale, 0.25 + a * 0.75);
      haloMesh.scale.set(widthScale, widthScale, 0.25 + a * 0.75);
      muzzleRing.scale.setScalar(0.6 + a * 0.95);

      stripMat.opacity = 0.18 + a * 0.82;
      haloMat.opacity = 0.06 + a * 0.44;
      muzzleRingMat.opacity = 0.14 + a * 0.82;
    };

    setActive(0, 0);
    return { group, setActive };
  },

  muzzle: [0, 0.02, -4.04],
  follow: 18,
  return: 11,
};
