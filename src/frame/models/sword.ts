/**
 * Plasma Energy Sword arm model (`src/frame/models/sword.ts`).
 *
 * Native side: left (`+X` inboard toward cockpit, `-X` outboard, `-Z` forward along blade, `+Z` rear elbow).
 * Sculpted Bureau-metal forearm energy gauntlet emitter:
 *   - Fixed (`build`): sleek bevelled forearm vambrace (`prism`), twin outboard brass capacitor drums,
 *     vented cooling heat-sink fins, reinforced wrist collar, and rear elbow gimbal.
 *   - Moving (`moving`): articulated split twin-prong plasma containment fork jutting past the wrist with
 *     recessed magnetic focus rails and emitter aperture throat.
 *   - Extra (`extra`): dramatic 5.2 m translucent/emissive Plasma Blade (white-hot faceted inner core +
 *     colored cyan/gold/palette outer plasma envelope + cross-guard emitter arcs) driven smoothly by
 *     `setActive(amount, mode)` from compact `0.15` pilot flame at idle to full `5.2 m` blazing sword!
 */
import * as THREE from 'three';
import type { GunExtra, GunSpec } from '../../vehicles/guns';
import type { ModelMaterials } from '../../progression/modelkit';
import type { FramePalette } from './palette';
import {
  ACROSS, ALONG_Z, AMBER, BRASS, DARK, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL, prism,
} from './shared';

/** Total extended length of the plasma blade in metres. */
export const PLASMA_BLADE_LENGTH = 5.2;
const BLADE_ORIGIN_Z = -1.62;

export const SWORD_ARM: GunSpec = {
  name: 'frame-sword',

  build: b => {
    // Sleek swept bevelled forearm vambrace housing (+u forward along -Z).
    b.solid(
      prism(
        [[-1.12, -0.3], [0.82, -0.26], [1.14, -0.06], [1.06, 0.24], [0.46, 0.42], [-0.94, 0.4], [-1.18, 0.14]],
        0.64,
        0.045,
      ),
      OBSIDIAN,
      { rot: ACROSS },
    );

    // Layered angular upper forearm armor cowling (`PLATE`).
    b.solid(
      prism([[-0.84, 0.34], [0.84, 0.3], [1.04, 0.18], [0.36, 0.52], [-0.76, 0.5]], 0.54, 0.032),
      PLATE,
      { rot: ACROSS },
    );

    // Outboard twin plasma capacitor drums with brass end-caps & clamping collars (-X outboard on native left arm).
    for (const [cy, cz] of [[0.14, 0.12], [-0.12, 0.24]] as const) {
      b.cyl(0.115, 0.115, 0.72, 12, GUNMETAL, { at: [-0.42, cy, cz], rot: ALONG_Z });
      b.cyl(0.128, 0.128, 0.06, 12, IRON, { at: [-0.42, cy, cz - 0.18], rot: ALONG_Z });
      b.cyl(0.128, 0.128, 0.06, 12, IRON, { at: [-0.42, cy, cz + 0.18], rot: ALONG_Z });
      b.cyl(0.088, 0.1, 0.1, 10, BRASS, { at: [-0.42, cy, cz - 0.4], rot: ALONG_Z });
      b.cyl(0.088, 0.1, 0.1, 10, BRASS, { at: [-0.42, cy, cz + 0.4], rot: ALONG_Z });
    }

    // Vented side heat-sink fin array along the forward vambrace flanks.
    for (let i = 0; i < 5; i++) {
      const z = -0.32 - i * 0.15;
      b.solid(
        prism([[-0.03, -0.22], [0.03, -0.22], [0.04, 0.26], [-0.04, 0.26]], 0.76, 0.012),
        i % 2 === 0 ? STEEL : PLATE,
        { at: [0, 0.04, z] },
      );
    }

    // Underslung armored gauntlet brace & rear elbow gimbal.
    b.solid(prism([[-0.64, -0.38], [0.96, -0.32], [1.1, -0.18], [-0.56, -0.2]], 0.44, 0.028), GUNMETAL, { rot: ACROSS });
    b.cyl(0.28, 0.28, 0.52, 12, STEEL, { at: [0, 0.12, 0.94], rot: [0, 0, Math.PI / 2] });
    b.cyl(0.19, 0.19, 0.62, 10, IRON, { at: [0, 0.12, 0.94], rot: [0, 0, Math.PI / 2] });

    // Inboard cockpit charge telemetry strips (+X faces cockpit on native left arm).
    b.solid(prism([[-0.42, 0.1], [0.46, 0.1], [0.46, 0.22], [-0.42, 0.22]], 0.05, 0.01), DARK, { at: [0.36, 0, -0.04], rot: ACROSS });
    b.glow(new THREE.BoxGeometry(0.026, 0.034, 0.78), RED, 4.6, { at: [0.375, 0.16, -0.04] });
    b.glow(new THREE.BoxGeometry(0.026, 0.1, 0.04), AMBER, 3.4, { at: [0.375, -0.02, -0.44] });
  },

  moving: b => {
    // Articulated wrist emitter collar.
    b.solid(prism([[-0.18, -0.26], [0.24, -0.24], [0.3, 0.24], [-0.18, 0.28]], 0.56, 0.03), GUNMETAL, { at: [0, 0.04, -1.16], rot: ACROSS });
    b.cyl(0.17, 0.19, 0.22, 12, DARK, { at: [0, 0.04, -1.48], rot: ALONG_Z });

    // Twin upper & lower plasma containment emitter prongs jutting forward past the wrist.
    b.solid(
      prism([[0.0, 0.12], [0.84, 0.14], [1.06, 0.06], [0.92, 0.24], [0.06, 0.28]], 0.24, 0.022),
      PLATE,
      { at: [0, 0.04, -1.18], rot: ACROSS },
    );
    b.solid(
      prism([[0.0, -0.26], [0.84, -0.24], [1.06, -0.06], [0.92, -0.14], [0.06, -0.12]], 0.24, 0.022),
      OBSIDIAN,
      { at: [0, 0.04, -1.18], rot: ACROSS },
    );

    // Brass magnetic focusing coils clamping the emitter fork.
    for (const y of [-0.18, 0.2]) {
      b.cyl(0.055, 0.055, 0.34, 10, BRASS, { at: [0, 0.04 + y, -1.62], rot: [0, 0, Math.PI / 2] });
    }
    // Recessed plasma ignition rails inside the containment fork.
    b.glow(new THREE.BoxGeometry(0.04, 0.026, 0.78), RED, 5.4, { at: [0, 0.15, -1.64] });
    b.glow(new THREE.BoxGeometry(0.04, 0.026, 0.78), RED, 5.4, { at: [0, -0.07, -1.64] });
  },

  extra: (_materials: ModelMaterials, palette: FramePalette): GunExtra => {
    const group = new THREE.Group();
    group.position.set(0, 0.04, BLADE_ORIGIN_Z);

    // Tapered broadsword plasma blade profile (extruded thin along X, length 5.2 m along -Z via rot: ACROSS).
    const coreGeo = prism(
      [[0, -0.09], [PLASMA_BLADE_LENGTH * 0.84, -0.065], [PLASMA_BLADE_LENGTH, 0], [PLASMA_BLADE_LENGTH * 0.84, 0.065], [0, 0.09]],
      0.036,
      0.01,
    );
    coreGeo.rotateY(Math.PI / 2);

    const sheathGeo = prism(
      [[-0.08, -0.22], [PLASMA_BLADE_LENGTH * 0.8, -0.17], [PLASMA_BLADE_LENGTH + 0.14, 0], [PLASMA_BLADE_LENGTH * 0.8, 0.17], [-0.08, 0.22]],
      0.088,
      0.024,
    );
    sheathGeo.rotateY(Math.PI / 2);

    // Cross-guard plasma emitter flare wings at the blade root.
    const guardGeo = prism(
      [[-0.08, -0.34], [0.34, -0.24], [0.46, 0], [0.34, 0.24], [-0.08, 0.34]],
      0.06,
      0.016,
    );
    guardGeo.rotateY(Math.PI / 2);

    const cleaveColor = new THREE.Color('#44e8ff').lerp(new THREE.Color(palette.glow || '#44e8ff'), 0.35);
    const impaleColor = new THREE.Color('#ffaa28').lerp(new THREE.Color(palette.secondaryGlow || '#ffaa28'), 0.4);
    const whiteCore = new THREE.Color('#f4fcff');

    const coreMat = new THREE.MeshBasicMaterial({
      color: whiteCore.clone().multiplyScalar(2.4),
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    const sheathMat = new THREE.MeshBasicMaterial({
      color: cleaveColor.clone().multiplyScalar(2.0),
      transparent: true,
      opacity: 0.52,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false,
    });
    const guardMat = new THREE.MeshBasicMaterial({
      color: cleaveColor.clone().multiplyScalar(2.2),
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });

    const bladePivot = new THREE.Group();
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    const sheathMesh = new THREE.Mesh(sheathGeo, sheathMat);
    const guardMesh = new THREE.Mesh(guardGeo, guardMat);
    bladePivot.add(coreMesh, sheathMesh, guardMesh);
    group.add(bladePivot);

    // Default active appearance for garage turntable preview: visibly ignited plasma blade.
    const applyState = (amount: number, mode = 0): void => {
      const clamped = Math.max(0.12, Math.min(1, amount));
      const baseColor = mode === 1 ? impaleColor : cleaveColor;
      const lenScale = 0.14 + (clamped - 0.12) / 0.88 * 0.86;
      const widthScale = 0.55 + clamped * 0.55;
      bladePivot.scale.set(widthScale, widthScale, lenScale);
      coreMat.opacity = 0.38 + clamped * 0.6;
      coreMat.color.copy(whiteCore).multiplyScalar(1.4 + clamped * 2.2);
      sheathMat.opacity = 0.2 + clamped * 0.5;
      sheathMat.color.copy(baseColor).multiplyScalar(1.3 + clamped * 2.2);
      guardMat.opacity = 0.25 + clamped * 0.6;
      guardMat.color.copy(baseColor).multiplyScalar(1.5 + clamped * 2.0);
    };
    applyState(0.9, 0);

    return {
      group,
      setActive: applyState,
    };
  },

  muzzle: [0, 0.04, BLADE_ORIGIN_Z - PLASMA_BLADE_LENGTH * 0.5],
  follow: 28,
  return: 18,
};
