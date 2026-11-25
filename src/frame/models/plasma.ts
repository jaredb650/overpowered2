/**
 * Plasma Scatter Rifle 3D arm model (`src/frame/models/plasma.ts`).
 *
 * Native side: right (`-X` inboard toward cockpit, `+X` outboard, `-Z` forward along bore, `+Z` rear elbow).
 * Futuristic open-forked magnetic plasma rifle architecture:
 *   - Fixed (`build`): sculpted angular `prism` receiver cowling (`OBSIDIAN`/`PLATE`/`GUNMETAL`), rear magnetic
 *     capacitor bottle, 3 glowing lateral capacitor fins per flank, and an angled outboard energy-cell magazine.
 *   - Moving (`moving`): split twin upper and lower magnetic rail forks projecting forward along `-Z` with an
 *     open central plasma containment channel, `STEEL` inner magnetic rails, and `BRASS` field-focusing rings.
 *   - Extra (`extra`): suspended glowing plasma containment core & twin energetic containment rings nestled
 *     between the upper and lower magnetic forks, scaling and brightening with charge ratio in `setActive`.
 */
import * as THREE from 'three';
import { clamp } from '../../core/math';
import type { GunExtra, GunSpec } from '../../vehicles/guns';
import {
  ACROSS, ALONG_Z, AMBER, BRASS, DARK, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL, ngon, prism,
} from './shared';

export const PLASMA_ARM: GunSpec = {
  name: 'frame-plasma',

  build: b => {
    // Sleek futuristic sculpted main receiver cowling (+u forward along -Z).
    b.solid(
      prism(
        [[-1.16, -0.22], [0.86, -0.2], [1.14, 0.02], [0.98, 0.36], [0.42, 0.48], [-0.96, 0.44], [-1.24, 0.14]],
        0.74,
        0.045,
      ),
      OBSIDIAN,
      { rot: ACROSS },
    );

    // Swept upper dorsal plasma fairing & recessed dark cooling channel.
    b.solid(
      prism([[-0.88, 0.38], [0.76, 0.36], [0.96, 0.24], [0.46, 0.56], [-0.74, 0.54]], 0.56, 0.03),
      PLATE,
      { rot: ACROSS },
    );
    b.solid(
      prism([[-0.66, 0.5], [0.4, 0.5], [0.48, 0.57], [-0.58, 0.57]], 0.18, 0.012),
      DARK,
      { rot: ACROSS },
    );

    // Bulbous rear magnetic bottle capacitor & brass terminal ring.
    b.cyl(0.24, 0.21, 0.62, 12, GUNMETAL, { at: [0, 0.08, 0.84], rot: ALONG_Z });
    b.cyl(0.255, 0.255, 0.08, 12, BRASS, { at: [0, 0.08, 0.62], rot: ALONG_Z });
    b.cyl(0.18, 0.22, 0.16, 12, PLATE, { at: [0, 0.08, 1.2], rot: ALONG_Z });

    // Three glowing lateral capacitor fins on each flank of the receiver.
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const fz = -0.18 - i * 0.34;
        // Angled bevelled capacitor fin winglet.
        b.solid(
          prism([[-0.12, -0.14], [0.16, -0.06], [0.12, 0.18], [-0.14, 0.12]], 0.16, 0.016),
          i % 2 === 0 ? PLATE : STEEL,
          { at: [s * 0.44, 0.06, fz], rot: [0, s * 0.24, s * -0.18] },
        );
        // Dark insulated fin seat + thin glowing lateral capacitor edge.
        b.solid(
          prism([[-0.08, -0.09], [0.1, -0.04], [0.08, 0.11], [-0.1, 0.07]], 0.05, 0.008),
          DARK,
          { at: [s * 0.38, 0.06, fz], rot: [0, s * 0.24, s * -0.18] },
        );
        b.glow(new THREE.BoxGeometry(0.026, 0.18, 0.045), RED, 5.2, {
          at: [s * 0.51, 0.06, fz],
          rot: [0, s * 0.24, s * -0.18],
        });
      }
    }

    // Angled energy-cell magazine canted outboard and downward from the breech.
    b.solid(
      prism([[-0.22, -0.56], [0.22, -0.56], [0.28, 0.02], [-0.24, 0.02]], 0.24, 0.024),
      GUNMETAL,
      { at: [0.36, -0.26, -0.22], rot: [0.26, 0, 0.42] },
    );
    // Magazine brass lock collar & glowing cell charge readout strip.
    b.solid(
      prism([[-0.24, -0.12], [0.24, -0.12], [0.26, -0.02], [-0.26, -0.02]], 0.27, 0.014),
      BRASS,
      { at: [0.36, -0.26, -0.22], rot: [0.26, 0, 0.42] },
    );
    b.glow(new THREE.BoxGeometry(0.032, 0.34, 0.06), AMBER, 4.6, {
      at: [0.47, -0.42, -0.24],
      rot: [0.26, 0, 0.42],
    });

    // Rear elbow gimbal.
    b.cyl(0.3, 0.3, 0.56, 12, STEEL, { at: [0, 0.14, 1.04], rot: [0, 0, Math.PI / 2] });
    b.cyl(0.2, 0.2, 0.66, 10, IRON, { at: [0, 0.14, 1.04], rot: [0, 0, Math.PI / 2] });

    // Inboard cockpit telemetry line.
    b.glow(new THREE.BoxGeometry(0.024, 0.032, 0.72), RED, 4.4, { at: [-0.41, 0.2, -0.15] });
  },

  moving: b => {
    // Forward magnetic field collar joining receiver to the open twin rail forks.
    b.solid(prism(ngon(0.34, 8, Math.PI / 8), 0.22, 0.024), PLATE, { at: [0, 0.04, -1.12] });
    b.cyl(0.22, 0.25, 0.26, 12, DARK, { at: [0, 0.04, -1.16], rot: ALONG_Z });

    // Split twin upper & lower magnetic rail forks with open central containment channel!
    // Upper magnetic fork prong.
    b.solid(
      prism([[0.0, 0.16], [1.46, 0.17], [1.62, 0.22], [1.42, 0.32], [0.06, 0.36], [-0.08, 0.24]], 0.34, 0.026),
      OBSIDIAN,
      { at: [0, 0.04, -1.12], rot: ACROSS },
    );
    b.solid(
      prism([[0.12, 0.13], [1.44, 0.14], [1.52, 0.19], [0.12, 0.19]], 0.2, 0.014),
      STEEL,
      { at: [0, 0.04, -1.12], rot: ACROSS },
    );

    // Lower magnetic fork prong.
    b.solid(
      prism([[0.0, -0.34], [1.42, -0.30], [1.62, -0.20], [1.46, -0.16], [0.0, -0.15], [-0.08, -0.24]], 0.34, 0.026),
      GUNMETAL,
      { at: [0, 0.04, -1.12], rot: ACROSS },
    );
    b.solid(
      prism([[0.12, -0.18], [1.44, -0.18], [1.52, -0.13], [0.12, -0.13]], 0.2, 0.014),
      STEEL,
      { at: [0, 0.04, -1.12], rot: ACROSS },
    );

    // Lateral magnetic yoke ribs & brass accelerator bands bridging the twin forks.
    for (let i = 0; i < 3; i++) {
      const bz = -1.48 - i * 0.42;
      for (const s of [-1, 1]) {
        b.solid(
          prism([[-0.04, -0.22], [0.05, -0.22], [0.07, 0.22], [-0.05, 0.22]], 0.06, 0.01),
          i === 2 ? BRASS : PLATE,
          { at: [s * 0.19, 0.04, bz], rot: ACROSS },
        );
      }
      b.cyl(0.032, 0.032, 0.38, 8, BRASS, { at: [0, 0.24, bz], rot: [0, 0, Math.PI / 2] });
      b.cyl(0.032, 0.032, 0.38, 8, BRASS, { at: [0, -0.16, bz], rot: [0, 0, Math.PI / 2] });
    }

    // Thin inset glow channels along the inner faces of the upper and lower magnetic forks.
    b.glow(new THREE.BoxGeometry(0.045, 0.024, 1.38), RED, 5.4, { at: [0, 0.175, -1.94] });
    b.glow(new THREE.BoxGeometry(0.045, 0.024, 1.38), RED, 5.4, { at: [0, -0.095, -1.94] });
  },

  extra(_materials, _palette): GunExtra {
    const group = new THREE.Group();
    group.name = 'plasma-containment-core';

    const cyanColor = new THREE.Color('#42f0ff');
    const violetColor = new THREE.Color('#c058ff');

    // Suspended glowing plasma core suspended between the upper and lower magnetic rail forks.
    const coreGeo = new THREE.CylinderGeometry(0.065, 0.065, 1.34, 12);
    coreGeo.rotateX(Math.PI / 2);
    const coreMat = new THREE.MeshBasicMaterial({
      color: cyanColor.clone(),
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    coreMesh.position.set(0, 0.04, -1.94);

    // Outer translucent violet plasma field sheath.
    const sheathGeo = new THREE.CylinderGeometry(0.115, 0.105, 1.4, 12, 1, true);
    sheathGeo.rotateX(Math.PI / 2);
    const sheathMat = new THREE.MeshBasicMaterial({
      color: violetColor.clone(),
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const sheathMesh = new THREE.Mesh(sheathGeo, sheathMat);
    sheathMesh.position.set(0, 0.04, -1.94);

    // Glowing plasma orb focal node right at the emitter mouth between the fork tips.
    const nodeGeo = new THREE.OctahedronGeometry(0.11, 1);
    const nodeMat = new THREE.MeshBasicMaterial({
      color: cyanColor.clone(),
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const nodeMesh = new THREE.Mesh(nodeGeo, nodeMat);
    nodeMesh.position.set(0, 0.04, -2.56);

    group.add(coreMesh, sheathMesh, nodeMesh);

    const setActive = (amount: number, mode = 0): void => {
      const a = clamp(amount);
      const radiusScale = 0.75 + a * 0.95;
      coreMesh.scale.set(radiusScale, radiusScale, 1);
      sheathMesh.scale.set(radiusScale * 1.15, radiusScale * 1.15, 1);
      const nodeScale = 0.5 + a * 1.35 + (mode === 1 ? 0.35 : 0);
      nodeMesh.scale.setScalar(nodeScale);
      coreMat.opacity = 0.45 + a * 0.55;
      sheathMat.opacity = 0.22 + a * 0.55;
      nodeMat.opacity = 0.35 + a * 0.65;
      coreMat.color.copy(cyanColor).lerp(violetColor, mode === 1 ? 0.7 : a * 0.45);
      nodeMat.color.copy(cyanColor).lerp(violetColor, mode === 1 ? 0.85 : a * 0.5);
    };

    setActive(0, 0);
    return { group, setActive };
  },

  muzzle: [0, 0.04, -2.74],
  follow: 24,
  return: 16,
};
