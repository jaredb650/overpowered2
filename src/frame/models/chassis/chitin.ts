/**
 * Chitin Carapace Core (`chassisChitin`): organic segmented bio-industrial shell with overlapping curved multi-plate
 * beetle-like carapace ribs along a hunched dorsal spine, teardrop dome shoulder shells, glowing segmented thermal
 * flank gill-vents, insectoid mandrel cheek guards, ribbed hydraulic spine cables, and a curved panoramic 1P visor.
 */
import * as THREE from 'three';
import { ModelBuilder, type ModelMaterials } from '../../../progression/modelkit';
import {
  ACROSS, AMBER, BRASS, BUREAU_PALETTE, DARK, FLAT, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL,
  frameBuilder, ngon, prism,
  type ChassisPlaces, type CockpitVisual, type FramePalette,
} from '../shared';

export const CHITIN_PLACES: ChassisPlaces = {
  eye: [0, 1.24, -1.1],
  head: [0, 2.26, -0.6],
  leftArm: [-1.68, 0.12, -1.16],
  rightArm: [1.68, 0.12, -1.16],
  shoulders: [
    [1.48, 2.28, 0.28],
    [-1.48, 2.28, 0.28],
    [0, 2.6, 0.44],
  ],
  jets: [0, 0.92, 1.88],
  jetNozzles: [
    [-0.96, 0.5, 1.94],
    [0.96, 0.5, 1.94],
  ],
  posturePitch: -0.06,
};

const _yAxis = new THREE.Vector3(0, 1, 0);
function acrossRot(roll = 0, yaw = 0, pitch = 0): [number, number, number] {
  const q = new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(pitch, yaw, -roll, 'YXZ'))
    .multiply(new THREE.Quaternion().setFromAxisAngle(_yAxis, Math.PI / 2));
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  return [e.x, e.y, e.z];
}

/** Helper: smoothly curved arched carapace profile (10-vertex organic dome) for beetle-like segmented plating. */
function archProfile(uBack: number, uFront: number, vLow: number, vHigh: number): [number, number][] {
  const uMid = (uBack + uFront) * 0.5;
  const rx = (uFront - uBack) * 0.5;
  const ry = vHigh - vLow;
  return [
    [uBack, vLow],
    [uMid + rx * 0.4, vLow - ry * 0.08],
    [uFront, vLow + ry * 0.16],
    [uFront + rx * 0.06, vLow + ry * 0.52],
    [uMid + rx * 0.52, vLow + ry * 0.88],
    [uMid, vHigh],
    [uMid - rx * 0.56, vLow + ry * 0.92],
    [uBack - rx * 0.08, vLow + ry * 0.54],
  ];
}

/** Exterior organic segmented beetle-carapace torso, shingled dorsal ribs, gill vents, mandrels, and spine cables. */
function exterior(b: ModelBuilder): void {
  // Segmented thoracic waist core with curved abdominal chitin rings.
  b.solid(prism(ngon(0.86, 12, Math.PI / 12), 0.26, 0.04), STEEL, { at: [0, 0.08, 0.12], rot: FLAT });
  for (let i = 0; i < 3; i++) {
    const r = 0.82 + i * 0.14;
    b.solid(prism(ngon(r, 12, Math.PI / 12), 0.28, 0.045), i % 2 === 0 ? OBSIDIAN : GUNMETAL, {
      at: [0, 0.28 + i * 0.26, 0.06 - i * 0.08],
      rot: [Math.PI / 2 - 0.14, 0, 0],
    });
  }

  // Smooth bulbous inner thorax core (curved 10-sided dome silhouette).
  b.solid(prism(archProfile(-1.72, 1.76, 0.44, 2.24), 2.38, 0.11), OBSIDIAN, { rot: ACROSS });

  // Five overlapping curved multi-plate dorsal carapace ribs shingled down the hunched spine!
  const ribs: readonly [number, number, number, number, number, string][] = [
    [0.24, 2.18, 1.24, 2.22, 1.98, PLATE],
    [-0.44, 1.38, 1.56, 2.48, 2.36, PLATE],
    [-1.12, 0.56, 1.52, 2.54, 2.52, GUNMETAL],
    [-1.68, -0.18, 1.26, 2.38, 2.28, PLATE],
    [-2.04, -0.74, 0.82, 2.02, 1.88, GUNMETAL],
  ];
  for (let i = 0; i < ribs.length; i++) {
    const [u0, u1, v0, v1, depth, col] = ribs[i]!;
    b.solid(prism(archProfile(u0, u1, v0, v1), depth, 0.065), col, { rot: ACROSS });
  }

  // Central dorsal ridge crest with recessed glowing bio-thermal spine veins.
  for (let i = 0; i < 4; i++) {
    const z = -0.78 + i * 0.62;
    const y = 2.32 + (i === 1 ? 0.14 : i === 2 ? 0.12 : -i * 0.08);
    b.solid(prism(ngon(0.24, 10), 0.42, 0.03), OBSIDIAN, { at: [0, y, z], rot: ACROSS });
    b.glow(new THREE.BoxGeometry(0.18, 0.055, 0.34), RED, 4.2, { at: [0, y + 0.14, z], rot: [-0.14 * i, 0, 0] });
  }

  // Forward bulbous smooth visor dome & recessed dark panoramic eye cavity.
  b.solid(prism(archProfile(0.86, 2.26, 0.68, 1.94), 1.66, 0.08), GUNMETAL, { rot: ACROSS });
  b.solid(prism(ngon(0.76, 12), 0.24, 0.03), DARK, { at: [0, 1.28, -2.14], scale: [1.06, 0.46, 1] });

  // Ribbed flexible hydraulic spine cables curving down the lower rear back.
  for (const s of [-1, 1]) {
    for (let seg = 0; seg < 6; seg++) {
      const t = seg / 5;
      const y = 1.68 - t * 1.18;
      const z = 1.82 + Math.sin(t * Math.PI) * 0.34;
      b.cyl(0.11, 0.11, 0.18, 10, seg % 2 === 0 ? STEEL : IRON, { at: [s * 0.36, y, z], rot: [0.3 - t * 0.5, 0, 0] });
    }
    // Central thick brass umbilical conduit flanking the spine.
    b.cyl(0.065, 0.065, 1.24, 10, BRASS, { at: [s * 0.16, 1.1, 1.98], rot: [0.12, 0, 0] });

    // Insectoid mandrel cheek guards curving inward around the front panoramic visor!
    b.solid(prism([
      [-0.78, -0.32], [0.32, -0.26], [0.78, 0.06], [0.62, 0.3], [0.02, 0.16], [-0.8, 0.1],
    ], 0.24, 0.035), PLATE, { at: [s * 0.94, 0.88, -1.64], rot: acrossRot(s * -0.14, s * 0.26) });
    b.solid(prism([
      [-0.56, -0.28], [0.48, -0.16], [0.64, 0.14], [0.08, 0.3], [-0.66, 0.14],
    ], 0.18, 0.025), OBSIDIAN, { at: [s * 0.98, 1.24, -1.8], rot: acrossRot(s * 0.08, s * 0.22) });

    // Glowing segmented thermal gill-vents running along both flanks of the carapace!
    for (let g = 0; g < 4; g++) {
      const gz = -1.04 + g * 0.56;
      const gy = 1.12 + g * 0.08;
      b.solid(prism([
        [-0.22, -0.09], [0.22, -0.06], [0.18, 0.09], [-0.2, 0.07],
      ], 0.14, 0.015), IRON, { at: [s * 1.26, gy, gz], rot: acrossRot(s * 0.18) });
      b.glow(new THREE.BoxGeometry(0.04, 0.055, 0.32), AMBER, 4.0, { at: [s * 1.34, gy, gz], rot: [0.1, 0, 0] });
    }

    // Teardrop curved beetle shoulder carapace shells (smooth domed shells instead of blocky boxes!).
    b.solid(prism(archProfile(-0.96, 1.04, -0.6, 0.6), 0.88, 0.08), PLATE, { at: [s * 1.76, 1.66, -0.12], rot: acrossRot(s * 0.26) });
    b.solid(prism(archProfile(-0.76, 0.78, -0.46, 0.46), 0.72, 0.06), OBSIDIAN, { at: [s * 1.72, 1.38, -0.12], rot: acrossRot(s * 0.22) });
    b.glow(new THREE.BoxGeometry(0.06, 0.045, 0.88), RED, 3.8, { at: [s * 2.18, 1.66, -0.14], rot: [0.08, 0, s * -0.26] });

    // Curved organic shoulder socket & ribbed arm tendon down to x = ±1.68.
    b.cyl(0.32, 0.32, 0.52, 14, STEEL, { at: [s * 1.66, 1.24, -0.14], rot: [0, 0, Math.PI / 2] });
    b.solid(prism(archProfile(-0.22, 0.24, -0.58, 0.58), 0.36, 0.04), GUNMETAL, { at: [s * 1.68, 0.72, -0.48], rot: [0.5, 0, 0] });
    b.cyl(0.085, 0.085, 1.02, 10, BRASS, { at: [s * 1.84, 0.72, -0.34], rot: [0.5, 0, 0] });

    // Curved shoulder mount pod at [±1.48, 2.28, 0.28].
    b.solid(prism(ngon(0.36, 10), 0.26, 0.03), GUNMETAL, { at: [s * 1.48, 2.18, 0.28], rot: FLAT });
    b.cyl(0.075, 0.075, 0.42, 10, BRASS, { at: [s * 1.48, 2.24, 0.58], rot: [0, 0, Math.PI / 2] });

    // Shrouded bio-industrial rear thruster pods at x = ±0.96, y = 0.5, z = 1.94.
    b.solid(prism(archProfile(-0.46, 0.36, -0.28, 0.62), 0.56, 0.055), OBSIDIAN, { at: [s * 0.96, 1.18, 1.68], rot: ACROSS });
    b.cyl(0.24, 0.34, 0.56, 14, IRON, { at: [s * 0.96, 0.74, 1.88], rot: [0.26, 0, s * -0.1] });
    b.cyl(0.3, 0.34, 0.08, 14, STEEL, { at: [s * 0.96, 0.5, 1.94], rot: [0.26, 0, s * -0.1] });
    b.glow(new THREE.CylinderGeometry(0.18, 0.24, 0.06, 12), AMBER, 4.5, { at: [s * 0.96, 0.56, 1.92], rot: [0.26, 0, s * -0.1] });
  }
}

/** Curved organic panoramic first-person cockpit framing with segmented carapace arch ribs and mandible cheeks. */
function interior(b: ModelBuilder): void {
  for (const s of [-1, 1]) {
    // Arched curved carapace side ribs framing the panoramic viewport.
    b.solid(prism([
      [-0.06, -0.6], [0.06, -0.54], [0.09, 0.04], [0.04, 0.6], [-0.06, 0.56], [-0.04, 0.02],
    ], 0.08, 0.015), OBSIDIAN, { at: [s * 1.04, 0.04, -0.74], rot: [0.1, 0, s * 0.14] });
    // Ribbed conduit cables along the inner canopy cheek.
    for (let i = 0; i < 4; i++) {
      b.cyl(0.024, 0.024, 0.06, 8, i % 2 === 0 ? BRASS : STEEL, { at: [s * 0.97, -0.34 + i * 0.22, -0.71], rot: [0.1, 0, s * 0.14] });
    }
    // Curved side organic instrument pod with glowing amber/red nodules.
    b.solid(prism(archProfile(-0.28, 0.3, -0.16, 0.18), 0.52, 0.022), GUNMETAL, { at: [s * 0.88, -0.74, -0.46], rot: [0.3, s * -0.16, 0] });
    for (let i = 0; i < 3; i++) {
      b.glow(new THREE.SphereGeometry(0.024, 8, 6), i === 0 ? RED : AMBER, 3.4, { at: [s * (0.74 + i * 0.08), -0.58, -0.6 + i * 0.02] });
    }
  }
  // Curved arched carapace upper brow hood (smooth organic dome arc across top).
  b.solid(prism([
    [-0.1, -0.04], [0.1, -0.04], [0.08, 0.05], [-0.08, 0.05],
  ], 2.18, 0.016), PLATE, { at: [0, 0.65, -0.78], rot: ACROSS });
  b.glow(new THREE.BoxGeometry(0.46, 0.012, 0.012), RED, 3.2, { at: [0, 0.62, -0.75] });
  b.box(2.24, 0.06, 1.2, DARK, { at: [0, 0.74, -0.22] });
  // Smooth curved lower sill with open center chin window for stomps.
  b.solid(prism([
    [-0.07, -0.03], [0.07, -0.03], [0.05, 0.035], [-0.06, 0.035],
  ], 2.08, 0.014), OBSIDIAN, { at: [0, -0.58, -0.84], rot: ACROSS });
}

/** Curved multi-segment panoramic beetle visor arc controlled by StandIn active/standby state. */
function makeVisor(color: string, boost: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(boost), toneMapped: false });
  for (let i = -2; i <= 2; i++) {
    const a = i * 0.28;
    const seg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.055), mat);
    seg.position.set(Math.sin(a) * 0.76, 1.32 - Math.abs(i) * 0.03, -2.26 + (1 - Math.cos(a)) * 0.65);
    seg.rotation.set(-0.14, -a, 0);
    g.add(seg);
  }
  return g;
}

export function buildChitinChassis(materials: ModelMaterials, palette?: FramePalette): CockpitVisual {
  const pal = palette ?? BUREAU_PALETTE;
  const ext = frameBuilder(pal);
  exterior(ext);
  const exteriorGroup = materials.group(ext);
  exteriorGroup.name = 'chassis.chitin';

  const visorActive = makeVisor(pal.glow, 4.2);
  const visorStandby = makeVisor(pal.secondaryGlow, 3.4);
  visorStandby.visible = false;
  exteriorGroup.add(visorActive, visorStandby);

  const int = frameBuilder(pal);
  interior(int);
  const interiorGroup = materials.group(int, materials.nearby);
  interiorGroup.name = 'chassis.chitin.interior';

  return {
    exterior: exteriorGroup,
    interior: interiorGroup,
    replacesHull: true,
    hideStandardInterior: true,
    hideStandardVisor: true,
    places: CHITIN_PLACES,
    visorActive,
    visorStandby,
  };
}
