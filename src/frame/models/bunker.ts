/**
 * Hydraulic Pile Bunker arm model (`src/frame/models/bunker.ts`).
 *
 * Native side: left (`+X` inboard toward cockpit, `-X` outboard, `-Z` forward along spike, `+Z` rear elbow).
 * Brutalist Bureau industrial pile-driver housing:
 *   - Fixed (`build`): heavy chamfered ram chassis (`prism`), twin flanking hydraulic gas cylinders with
 *     chrome piston rods and brass manifold collars, pressure gauge dial, armored front knuckle bumper &
 *     slatted blast guard cage, rear elbow gimbal.
 *   - Moving (`moving`): massive serrated 3.4 m tapered hexagonal tungsten stake spike + machined breech
 *     piston shaft — slams visibly forward (`u.arm.recoil(-1.6)`) on explosive drive!
 *   - Extra (`extra`): superheated orange-amber thermal collar & breech pressure glow rings that intensify
 *     smoothly from `0` (cool) to `1` (armed explosive pressure) via `setActive(chargeRatio)`.
 */
import * as THREE from 'three';
import type { GunExtra, GunSpec } from '../../vehicles/guns';
import type { ModelMaterials } from '../../progression/modelkit';
import type { FramePalette } from './palette';
import {
  ACROSS, ALONG_Z, AMBER, BRASS, DARK, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL, ngon, prism,
} from './shared';

/** Total length of the sliding tungsten pile-bunker stake in metres. */
export const BUNKER_SPIKE_LENGTH = 3.4;

export const BUNKER_ARM: GunSpec = {
  name: 'frame-bunker',

  build: b => {
    // Brutal heavy squared-chamfered forearm pile-driver chassis (+u forward along -Z).
    b.solid(
      prism(
        [[-1.26, -0.4], [1.14, -0.38], [1.34, -0.18], [1.34, 0.28], [0.98, 0.48], [-1.06, 0.48], [-1.32, 0.22]],
        0.92,
        0.055,
      ),
      OBSIDIAN,
      { rot: ACROSS },
    );

    // Heavy sloped upper recoil armor slab & vented breech lid.
    b.solid(
      prism([[-1.0, 0.42], [1.04, 0.42], [1.2, 0.26], [0.76, 0.62], [-0.88, 0.6]], 0.8, 0.04),
      PLATE,
      { rot: ACROSS },
    );

    // Twin massive hydraulic pressure cylinders flanking the ram housing.
    for (const s of [-1, 1]) {
      b.cyl(0.155, 0.155, 1.56, 12, GUNMETAL, { at: [s * 0.54, 0.04, -0.14], rot: ALONG_Z });
      b.cyl(0.175, 0.175, 0.09, 12, BRASS, { at: [s * 0.54, 0.04, -0.74], rot: ALONG_Z });
      b.cyl(0.175, 0.175, 0.09, 12, BRASS, { at: [s * 0.54, 0.04, 0.44], rot: ALONG_Z });
      // Exposed steel hydraulic actuator piston protruding forward from each cylinder.
      b.cyl(0.088, 0.088, 0.68, 10, STEEL, { at: [s * 0.54, 0.04, -1.2], rot: ALONG_Z });
      // Upper hydraulic cross-manifold conduit piping.
      b.cyl(0.042, 0.042, 0.42, 8, BRASS, { at: [s * 0.34, 0.36, 0.36], rot: [0, 0, Math.PI / 2] });
    }

    // Brass pressure gauge housing & dial mounted on the inboard flank (+X faces pilot on native left arm).
    b.cyl(0.12, 0.12, 0.1, 12, BRASS, { at: [0.56, 0.28, -0.34], rot: [0, 0, Math.PI / 2] });
    b.cyl(0.092, 0.092, 0.12, 12, DARK, { at: [0.57, 0.28, -0.34], rot: [0, 0, Math.PI / 2] });
    b.glow(new THREE.BoxGeometry(0.024, 0.075, 0.024), AMBER, 4.4, { at: [0.63, 0.3, -0.34] });

    // Heavy armored front knuckle bumper & slatted stake guide collar.
    b.solid(
      prism([[1.08, -0.44], [1.62, -0.4], [1.74, -0.18], [1.74, 0.24], [1.56, 0.44], [1.08, 0.46]], 1.06, 0.045),
      PLATE,
      { rot: ACROSS },
    );
    // Recessed dark guide throat where the tungsten stake fires out.
    b.solid(prism(ngon(0.28, 6, 0), 0.32, 0.02), DARK, { at: [0, 0, -1.66] });
    // Twin forward impact bumper horns.
    for (const s of [-1, 1]) {
      b.solid(
        prism([[1.42, -0.34], [1.96, -0.28], [2.04, -0.12], [1.96, 0.2], [1.42, 0.26]], 0.18, 0.025),
        IRON,
        { at: [s * 0.46, 0, 0], rot: ACROSS },
      );
    }

    // Rear explosive breech charge drum & elbow gimbal.
    b.cyl(0.26, 0.26, 0.68, 12, IRON, { at: [0, 0.02, 0.96], rot: ALONG_Z });
    b.cyl(0.32, 0.32, 0.56, 12, STEEL, { at: [0, 0.18, 1.04], rot: [0, 0, Math.PI / 2] });

    // Inboard charge telemetry strip.
    b.glow(new THREE.BoxGeometry(0.03, 0.042, 0.86), RED, 4.4, { at: [0.475, 0.18, -0.04] });
  },

  moving: b => {
    // Machined heavy rear piston shaft seated inside the housing.
    b.cyl(0.155, 0.155, 1.35, 10, IRON, { at: [0, 0, -0.95], rot: ALONG_Z });

    // Massive 3.4 m serrated tapered hexagonal tungsten spike stake (from z = -0.35 to z = -3.75).
    // Main hexagonal tungsten shank.
    b.solid(prism(ngon(0.165, 6, 0), 1.95, 0.022), STEEL, { at: [0, 0, -1.92] });

    // Serrated anti-armor flute rings stepped down toward the penetrator tip.
    for (let i = 0; i < 4; i++) {
      const z = -1.62 - i * 0.34;
      const r = 0.205 - i * 0.014;
      b.solid(prism(ngon(r, 6, Math.PI / 6), 0.11, 0.016), i % 2 === 0 ? PLATE : BRASS, { at: [0, 0, z] });
    }

    // Brutal tapered hexagonal armor-piercing stake tip.
    b.cyl(0.025, 0.165, 0.96, 6, STEEL, { at: [0, 0, -3.27], rot: [-Math.PI / 2, 0, 0] });
    b.cyl(0.012, 0.06, 0.24, 6, BRASS, { at: [0, 0, -3.68], rot: [-Math.PI / 2, 0, 0] });
  },

  extra: (_materials: ModelMaterials, palette: FramePalette): GunExtra => {
    const group = new THREE.Group();
    const heatColor = new THREE.Color('#ff6a18').lerp(new THREE.Color(palette.secondaryGlow || '#ffaa30'), 0.35);
    const whiteHot = new THREE.Color('#fff2cc');

    const glowMat = new THREE.MeshBasicMaterial({
      color: heatColor.clone().multiplyScalar(0.8),
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });

    // Thermal pressure bands & stake superheat tip sheath that ignite as explosive charge builds.
    const bandGeo = new THREE.TorusGeometry(0.215, 0.028, 8, 12);
    const b1 = new THREE.Mesh(bandGeo, glowMat);
    b1.position.set(0, 0, -1.78);
    const b2 = new THREE.Mesh(bandGeo, glowMat);
    b2.position.set(0, 0, -2.14);
    const tipGeo = new THREE.ConeGeometry(0.185, 1.04, 6, 1, true);
    tipGeo.rotateX(-Math.PI / 2);
    const tipMesh = new THREE.Mesh(tipGeo, glowMat);
    tipMesh.position.set(0, 0, -3.26);

    group.add(b1, b2, tipMesh);

    const setActive = (amount: number): void => {
      const t = Math.max(0, Math.min(1, amount));
      glowMat.opacity = 0.08 + t * 0.78;
      glowMat.color.copy(heatColor).lerp(whiteHot, t * 0.45).multiplyScalar(0.9 + t * 3.4);
      const s = 0.95 + t * 0.14;
      tipMesh.scale.set(s, s, 1 + t * 0.08);
    };
    setActive(0.25);

    return {
      group,
      setActive,
    };
  },

  muzzle: [0, 0, -3.76],
  follow: 24,
  return: 12,
};
