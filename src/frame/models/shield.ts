/**
 * Armored Energy Shield arm model (`src/frame/models/shield.ts`).
 *
 * Native side: left (`+X` inboard toward cockpit, `-X` outboard, `-Z` forward along forearm, `+Z` rear elbow).
 * Sculpted Bureau-metal kite-buckler emitter plate:
 *   - Fixed (`build`): heavy angular kite-shaped armored tower buckler (`prism`), layered reactive faceplates,
 *     4 corner projector emitter pylons with brass focus tips, central circular shield generator core with
 *     glowing capacitor ring, forearm clamp cradle, and rear elbow gimbal.
 *   - Moving (`moving`): reciprocating central projector emitter ring that kicks forward on Shield Bash.
 *   - Extra (`extra`): wide 4.4 m × 3.4 m translucent hexagonal energy barrier plane + glowing perimeter rim
 *     frame + interior hex lattice ribs — unfolds and brightens dramatically when `setActive(v > 0)`!
 */
import * as THREE from 'three';
import type { GunExtra, GunSpec } from '../../vehicles/guns';
import type { ModelMaterials } from '../../progression/modelkit';
import type { FramePalette } from './palette';
import {
  ACROSS, ALONG_Z, AMBER, BRASS, DARK, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL, ngon, prism,
} from './shared';

export const SHIELD_ARM: GunSpec = {
  name: 'frame-shield',

  build: b => {
    // Forearm mounting cradle & rear elbow gimbal.
    b.solid(
      prism([[-0.96, -0.26], [0.68, -0.24], [0.84, 0.0], [0.64, 0.24], [-0.88, 0.26], [-1.04, 0.04]], 0.56, 0.035),
      IRON,
      { rot: ACROSS },
    );
    b.cyl(0.28, 0.28, 0.52, 12, STEEL, { at: [0, 0.1, 0.88], rot: [0, 0, Math.PI / 2] });

    // Heavy angular kite-buckler physical shield plate mounted along the outboard forearm (-X outboard on native left).
    // Positioned forward & angled slightly outward so it protects the flank at rest and swings across center when guarding.
    b.solid(
      prism(
        [[-0.56, -0.88], [0.56, -0.88], [0.88, -0.24], [0.76, 0.64], [0, 1.06], [-0.76, 0.64], [-0.88, -0.24]],
        0.24,
        0.042,
      ),
      OBSIDIAN,
      { at: [-0.26, 0.04, -1.16] },
    );

    // Layered beveled reactive outer armor carapace on the buckler face.
    b.solid(
      prism(
        [[-0.42, -0.68], [0.42, -0.68], [0.68, -0.18], [0.58, 0.48], [0, 0.82], [-0.58, 0.48], [-0.68, -0.18]],
        0.16,
        0.03,
      ),
      PLATE,
      { at: [-0.26, 0.04, -1.26] },
    );

    // Structural armored mounting yoke tying the forearm cradle to the buckler backplate.
    b.solid(
      prism([[-0.3, -0.24], [0.92, -0.22], [1.04, 0.22], [-0.26, 0.24]], 0.36, 0.025),
      GUNMETAL,
      { at: [-0.14, 0.04, -0.4], rot: ACROSS },
    );

    // 4 angled corner projector pylons with brass emitter tips projecting the hexagonal field.
    const corners: readonly (readonly [number, number, number])[] = [
      [-0.78, 0.54, 0.42],
      [0.26, 0.54, -0.42],
      [-0.84, -0.46, -0.35],
      [0.32, -0.46, 0.35],
    ];
    for (const [cx, cy, rz] of corners) {
      b.solid(
        prism([[-0.12, -0.1], [0.12, -0.1], [0.09, 0.24], [-0.09, 0.24]], 0.26, 0.02),
        GUNMETAL,
        { at: [cx, cy, -1.32], rot: [0, 0, rz] },
      );
      b.cyl(0.055, 0.072, 0.24, 8, BRASS, { at: [cx, cy, -1.44], rot: ALONG_Z });
      b.glow(new THREE.CylinderGeometry(0.038, 0.038, 0.05, 8), RED, 4.8, { at: [cx, cy, -1.56], rot: ALONG_Z });
    }

    // Central recessed shield generator core on the buckler face.
    b.solid(prism(ngon(0.32, 8, Math.PI / 8), 0.14, 0.022), STEEL, { at: [-0.26, 0.04, -1.36] });
    b.cyl(0.22, 0.24, 0.12, 12, DARK, { at: [-0.26, 0.04, -1.4], rot: ALONG_Z });
    b.glow(new THREE.TorusGeometry(0.17, 0.028, 8, 16), AMBER, 4.8, { at: [-0.26, 0.04, -1.44] });

    // Inboard pilot status strips on the back face of the buckler (+Z facing cockpit).
    b.glow(new THREE.BoxGeometry(0.56, 0.032, 0.03), AMBER, 3.8, { at: [-0.26, 0.42, -1.0] });
    b.glow(new THREE.BoxGeometry(0.42, 0.03, 0.03), RED, 3.6, { at: [-0.26, -0.34, -1.0] });
  },

  moving: b => {
    // Reciprocating projector emitter emitter-crown that thrusts forward on Shield Bash.
    b.solid(prism(ngon(0.25, 6, 0), 0.08, 0.014), BRASS, { at: [-0.26, 0.04, -1.46] });
    b.glow(new THREE.CylinderGeometry(0.095, 0.095, 0.05, 10), RED, 5.2, { at: [-0.26, 0.04, -1.49], rot: ALONG_Z });
  },

  extra: (_materials: ModelMaterials, palette: FramePalette): GunExtra => {
    const group = new THREE.Group();
    group.position.set(-0.26, 0.04, -1.62);

    // Wide 4.4 m x 3.4 m hexagonal energy barrier plane (semi-transparent so center sight stays clear).
    const hexPts: readonly (readonly [number, number])[] = [
      [-1.35, -1.7], [1.35, -1.7], [2.2, 0], [1.35, 1.7], [-1.35, 1.7], [-2.2, 0],
    ];
    const outerShape = new THREE.Shape(hexPts.map(([x, y]) => new THREE.Vector2(x, y)));
    const panelGeo = new THREE.ShapeGeometry(outerShape);

    // Glowing hexagonal rim frame (ring shape with an open center hole).
    const rimShape = new THREE.Shape(hexPts.map(([x, y]) => new THREE.Vector2(x, y)));
    const innerHole = new THREE.Path(hexPts.map(([x, y]) => new THREE.Vector2(x * 0.88, y * 0.88)));
    rimShape.holes.push(innerHole);
    const rimGeo = new THREE.ShapeGeometry(rimShape);

    // Secondary inner hex lattice ring for tactical readability.
    const midShape = new THREE.Shape(hexPts.map(([x, y]) => new THREE.Vector2(x * 0.56, y * 0.56)));
    const midHole = new THREE.Path(hexPts.map(([x, y]) => new THREE.Vector2(x * 0.51, y * 0.51)));
    midShape.holes.push(midHole);
    const midGeo = new THREE.ShapeGeometry(midShape);

    const stdColor = new THREE.Color('#38d8ff').lerp(new THREE.Color(palette.glow || '#38d8ff'), 0.25);
    const bucklerColor = new THREE.Color('#74f8ff').lerp(new THREE.Color(palette.secondaryGlow || '#ffaa30'), 0.3);
    const perfectColor = new THREE.Color('#e8fcff');

    const panelMat = new THREE.MeshBasicMaterial({
      color: stdColor.clone().multiplyScalar(1.4),
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false,
    });
    const rimMat = new THREE.MeshBasicMaterial({
      color: stdColor.clone().multiplyScalar(2.4),
      transparent: true,
      opacity: 0.78,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false,
    });
    const midMat = new THREE.MeshBasicMaterial({
      color: stdColor.clone().multiplyScalar(1.9),
      transparent: true,
      opacity: 0.48,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false,
    });

    const barrierGroup = new THREE.Group();
    const panelMesh = new THREE.Mesh(panelGeo, panelMat);
    const rimMesh = new THREE.Mesh(rimGeo, rimMat);
    rimMesh.position.z = -0.02;
    const midMesh = new THREE.Mesh(midGeo, midMat);
    midMesh.position.z = -0.03;
    barrierGroup.add(panelMesh, rimMesh, midMesh);
    group.add(barrierGroup);

    const setActive = (amount: number, mode = 0): void => {
      const clamped = Math.max(0, Math.min(1, amount));
      if (clamped <= 0.01) {
        barrierGroup.visible = false;
        barrierGroup.scale.setScalar(0.01);
        return;
      }
      barrierGroup.visible = true;
      const isPerfect = clamped >= 0.94;
      const base = mode === 1 ? bucklerColor : stdColor;
      const scale = 0.58 + clamped * 0.42;
      barrierGroup.scale.set(scale, scale, 1);
      panelMat.opacity = 0.14 + clamped * 0.16;
      panelMat.color.copy(base).lerp(perfectColor, isPerfect ? 0.55 : 0).multiplyScalar(1.2 + clamped * 1.4);
      rimMat.opacity = 0.45 + clamped * 0.52;
      rimMat.color.copy(base).lerp(perfectColor, isPerfect ? 0.65 : 0.1).multiplyScalar(1.8 + clamped * 2.4);
      midMat.opacity = 0.25 + clamped * 0.45;
      midMat.color.copy(base).lerp(perfectColor, isPerfect ? 0.5 : 0).multiplyScalar(1.4 + clamped * 1.8);
    };
    // Subtle translucent deployment in garage preview; combat immediately drives 0 or 0.72..1.0.
    setActive(0.45, 0);

    return {
      group,
      setActive,
    };
  },

  muzzle: [-0.26, 0.04, -1.65],
  follow: 26,
  return: 16,
};
