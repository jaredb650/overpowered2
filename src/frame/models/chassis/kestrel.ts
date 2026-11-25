/**
 * Kestrel Aero-Core (`chassisKestrel`): sleek forward-canted predatory fighter-jet torso with a sharp swept needle
 * nose beak, wasp-waisted narrow spine, high-mounted twin supersonic intake cowls, low-slung winglet pauldrons,
 * twin swept dorsal tail-stabilizer fins, and a narrow wraparound fighter canopy in first-person.
 */
import * as THREE from 'three';
import { ModelBuilder, type ModelMaterials } from '../../../progression/modelkit';
import {
  ACROSS, ALONG_Z, AMBER, BRASS, BUREAU_PALETTE, DARK, FLAT, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL,
  frameBuilder, ngon, prism,
  type ChassisPlaces, type CockpitVisual, type FramePalette,
} from '../shared';

export const KESTREL_PLACES: ChassisPlaces = {
  eye: [0, 1.34, -1.26],
  head: [0, 2.22, -0.78],
  leftArm: [-1.44, 0.14, -1.18],
  rightArm: [1.44, 0.14, -1.18],
  shoulders: [
    [1.3, 2.34, 0.42],
    [-1.3, 2.34, 0.42],
    [0, 2.56, 0.64],
  ],
  jets: [0, 0.96, 1.88],
  jetNozzles: [
    [-0.74, 0.56, 1.98],
    [0.74, 0.56, 1.98],
  ],
  posturePitch: -0.09,
};

const _yAxis = new THREE.Vector3(0, 1, 0);
function acrossRot(roll = 0, yaw = 0, pitch = 0): [number, number, number] {
  const q = new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(pitch, yaw, -roll, 'YXZ'))
    .multiply(new THREE.Quaternion().setFromAxisAngle(_yAxis, Math.PI / 2));
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  return [e.x, e.y, e.z];
}

/** Exterior fighter-jet wedge fuselage, needle beak, dorsal tail fins, intake cowls, and winglet pauldrons. */
function exterior(b: ModelBuilder): void {
  // Narrow wasp-waist structural spine & hydraulic abdominal core.
  b.solid(prism([
    [-0.92, -0.06], [0.84, 0.02], [1.02, 0.58], [0.76, 1.02], [-0.82, 0.98], [-1.06, 0.44],
  ], 1.18, 0.05), IRON, { rot: ACROSS });
  // Waist armor girdle & central hydraulic piston column.
  b.solid(prism(ngon(0.68, 8, Math.PI / 8), 0.24, 0.03), STEEL, { at: [0, 0.08, 0.12], rot: FLAT });
  for (const s of [-1, 1]) {
    b.cyl(0.085, 0.095, 0.86, 10, STEEL, { at: [s * 0.48, 0.44, -0.24], rot: [0.22, 0, s * -0.14] });
    b.cyl(0.11, 0.11, 0.22, 10, BRASS, { at: [s * 0.48, 0.34, -0.21], rot: [0.22, 0, s * -0.14] });
    b.cyl(0.07, 0.07, 0.88, 8, GUNMETAL, { at: [s * 0.42, 0.52, 0.48], rot: [-0.28, 0, s * -0.1] });
  }

  // Main predatory forward-canted aero-wedge fuselage (slim, elongated along -Z).
  b.solid(prism([
    [-1.68, 0.72], [0.58, 0.44], [2.46, 0.92], [2.76, 1.24], [2.18, 1.66],
    [0.88, 2.18], [-0.74, 2.26], [-1.76, 1.72], [-1.86, 1.18],
  ], 1.68, 0.07), OBSIDIAN, { rot: ACROSS });

  // Sharp swept-back needle nose beak & stealth chine prow extending to z = -2.84.
  b.solid(prism([
    [1.15, 0.76], [2.78, 1.06], [2.88, 1.26], [2.12, 1.62], [1.12, 1.74],
  ], 1.12, 0.045), PLATE, { rot: ACROSS });
  b.solid(prism([
    [1.82, 1.02], [2.94, 1.16], [2.62, 1.42], [1.8, 1.44],
  ], 0.56, 0.03), GUNMETAL, { rot: ACROSS });
  // Lower ventral aero splitter keel beneath the nose beak.
  b.solid(prism([
    [0.2, 0.34], [2.36, 0.82], [2.18, 1.0], [0.16, 0.64],
  ], 0.62, 0.03), DARK, { rot: ACROSS });

  // Steeply raked overhanging canopy brow & recessed dark fighter glass bay.
  b.solid(prism([
    [0.72, 1.66], [2.32, 1.46], [2.04, 1.78], [0.84, 2.14],
  ], 1.18, 0.04), PLATE, { rot: ACROSS });
  b.solid(prism([
    [1.36, 1.22], [2.44, 1.16], [2.22, 1.54], [1.36, 1.62],
  ], 1.02, 0.025), DARK, { rot: ACROSS });

  // Sculpted dorsal spine ridge running from neck collar to tail deck.
  b.solid(prism([
    [-1.74, 1.78], [0.64, 1.98], [0.46, 2.38], [-1.42, 2.44], [-1.84, 2.12],
  ], 0.78, 0.045), PLATE, { rot: ACROSS });
  b.solid(prism([
    [-1.56, 2.26], [0.24, 2.26], [0.06, 2.52], [-1.38, 2.54],
  ], 0.34, 0.025), STEEL, { rot: ACROSS });

  for (const s of [-1, 1]) {
    // High-mounted supersonic engine intake cowls flanking the cockpit with dark splitter ducts.
    b.solid(prism([
      [-1.02, 1.22], [1.34, 1.16], [1.56, 1.56], [1.14, 2.02], [-0.88, 2.14], [-1.22, 1.64],
    ], 0.52, 0.045), PLATE, { at: [s * 1.02, 0, 0], rot: [0, Math.PI / 2 + s * -0.08, 0] });
    // Dark recessed intake mouth + supersonic splitter vane.
    b.box(0.36, 0.44, 0.14, DARK, { at: [s * 1.04, 1.54, -1.52], rot: [0.16, s * -0.08, 0] });
    b.box(0.04, 0.42, 0.36, STEEL, { at: [s * 1.04, 1.54, -1.44], rot: [0.16, s * -0.08, 0] });
    b.glow(new THREE.BoxGeometry(0.05, 0.04, 1.18), RED, 3.8, { at: [s * 1.26, 1.82, -0.58], rot: [0.06, s * -0.08, 0] });

    // Swept forward canard cheek winglets flanking the nose beak.
    b.solid(prism([
      [-0.56, -0.14], [0.74, -0.04], [0.42, 0.18], [-0.58, 0.16],
    ], 0.09, 0.018), GUNMETAL, { at: [s * 0.92, 1.08, -1.44], rot: acrossRot(s * -0.24, s * -0.26) });

    // Low-slung swept razor winglet pauldrons (replaces chunky boxy shoulders!).
    b.solid(prism([
      [-0.78, -0.28], [0.76, -0.44], [1.18, -0.2], [0.46, 0.28], [-0.94, 0.36],
    ], 0.44, 0.035), PLATE, { at: [s * 1.52, 1.62, -0.08], rot: acrossRot(s * 0.34) });
    b.solid(prism([
      [-0.64, -0.12], [0.58, -0.26], [0.78, -0.04], [-0.74, 0.14],
    ], 0.14, 0.02), OBSIDIAN, { at: [s * 1.86, 1.64, -0.06], rot: acrossRot(s * 0.44) });
    b.glow(new THREE.BoxGeometry(0.48, 0.035, 0.05), AMBER, 3.8, { at: [s * 1.66, 1.62, -0.74], rot: [0, 0, s * -0.34] });

    // Compact shoulder gimbal drum & sleek angled upper-arm pylon connecting down to x = ±1.44.
    b.cyl(0.26, 0.26, 0.46, 12, STEEL, { at: [s * 1.36, 1.22, -0.16], rot: [0, 0, Math.PI / 2] });
    b.cyl(0.28, 0.28, 0.1, 12, BRASS, { at: [s * 1.22, 1.22, -0.16], rot: [0, 0, Math.PI / 2] });
    b.solid(prism([
      [-0.16, -0.54], [0.18, -0.54], [0.22, 0.54], [-0.2, 0.54],
    ], 0.28, 0.03), GUNMETAL, { at: [s * 1.42, 0.72, -0.54], rot: [0.58, 0, 0] });
    b.cyl(0.065, 0.065, 0.96, 8, STEEL, { at: [s * 1.54, 0.74, -0.42], rot: [0.58, 0, 0] });

    // Swept-back twin dorsal tail-stabilizer fins rising cleanly behind the intakes.
    const finRot = acrossRot(s * 0.36);
    b.solid(prism([
      [-0.58, -0.08], [0.58, 0.08], [0.06, 1.32], [-0.72, 1.28], [-1.12, 0.44],
    ], 0.1, 0.02), PLATE, { at: [s * 0.92, 1.84, 1.0], rot: finRot });
    b.solid(prism([
      [-0.42, 0.18], [0.26, 0.26], [-0.06, 1.14], [-0.58, 1.1],
    ], 0.04, 0.01), OBSIDIAN, { at: [s * 0.96, 1.84, 1.0], rot: finRot });
    b.glow(new THREE.BoxGeometry(0.04, 0.72, 0.05), RED, 4.0, { at: [s * 1.22, 2.54, 1.24], rot: [-0.32, 0, s * -0.36] });

    // Rear shoulder pylon mount cradle at x = ±1.3, y = 2.34, z = 0.42.
    b.solid(prism([
      [-0.36, -0.06], [0.38, -0.06], [0.3, 0.18], [-0.3, 0.18],
    ], 0.42, 0.025), GUNMETAL, { at: [s * 1.3, 2.18, 0.42], rot: ACROSS });
    b.cyl(0.065, 0.065, 0.36, 10, BRASS, { at: [s * 1.3, 2.28, 0.68], rot: [0, 0, Math.PI / 2] });

    // Twin sleek rear vectoring jet nozzles tucked close along the tail spine.
    b.solid(prism([
      [-0.42, -0.24], [0.28, -0.22], [0.34, 0.48], [-0.26, 0.56],
    ], 0.44, 0.035), OBSIDIAN, { at: [s * 0.74, 1.18, 1.66], rot: ACROSS });
    b.cyl(0.22, 0.3, 0.54, 14, IRON, { at: [s * 0.74, 0.78, 1.9], rot: [0.32, 0, s * -0.06] });
    b.cyl(0.27, 0.31, 0.08, 14, STEEL, { at: [s * 0.74, 0.54, 1.98], rot: [0.32, 0, s * -0.06] });
    b.glow(new THREE.CylinderGeometry(0.16, 0.21, 0.06, 12), AMBER, 4.5, { at: [s * 0.74, 0.6, 1.95], rot: [0.32, 0, s * -0.06] });
  }

  // Rear cooling louvers nestled between the twin nozzles (rear weakspot visual cue).
  for (let i = 0; i < 4; i++) {
    b.box(0.84, 0.07, 0.2, i % 2 ? IRON : PLATE, { at: [0, 0.72 + i * 0.28, 1.94], rot: [0.28, 0, 0] });
    b.glow(new THREE.BoxGeometry(0.66, 0.035, 0.04), AMBER, 3.8, { at: [0, 0.69 + i * 0.28, 1.91] });
  }
}

/** Narrow swept fighter-jet wraparound canopy interior in eye space (unobstructed center & stomp chin sightlines). */
function interior(b: ModelBuilder): void {
  for (const s of [-1, 1]) {
    // Sleek steeply-raked fighter canopy arch ribs at the outer edges.
    b.solid(prism([
      [-0.038, -0.62], [0.042, -0.58], [0.028, 0.64], [-0.044, 0.6],
    ], 0.055, 0.01), OBSIDIAN, { at: [s * 0.98, 0.06, -0.76], rot: [0.22, 0, s * 0.2] });
    b.box(0.016, 1.12, 0.02, STEEL, { at: [s * 0.94, 0.06, -0.73], rot: [0.22, 0, s * 0.2] });
    // Narrow swept side fuselage sill consoles.
    b.solid(prism([
      [-0.24, -0.14], [0.28, -0.14], [0.22, 0.12], [-0.2, 0.14],
    ], 0.56, 0.018), OBSIDIAN, { at: [s * 0.84, -0.72, -0.48], rot: [0.26, s * -0.18, 0] });
    b.box(0.36, 0.025, 0.34, GUNMETAL, { at: [s * 0.82, -0.6, -0.52], rot: [0.26, s * -0.18, 0] });
    b.glow(new THREE.BoxGeometry(0.22, 0.01, 0.012), RED, 3.2, { at: [s * 0.78, -0.58, -0.62], rot: [0, s * -0.18, 0] });
    b.glow(new THREE.BoxGeometry(0.12, 0.01, 0.012), AMBER, 3.0, { at: [s * 0.84, -0.58, -0.54], rot: [0, s * -0.18, 0] });
  }
  // Pointed aerodynamic overhead canopy spine bow (leaves upper sky wide open).
  b.solid(prism([
    [-0.08, -0.028], [0.08, -0.028], [0.05, 0.036], [-0.06, 0.036],
  ], 1.84, 0.01), OBSIDIAN, { at: [0, 0.64, -0.82], rot: ACROSS });
  b.glow(new THREE.BoxGeometry(0.32, 0.01, 0.012), RED, 3.4, { at: [0, 0.62, -0.78] });
  // Compact fighter HUD glare-shield nose lip along lower center (stomp floor remains visible to sides/below).
  b.solid(prism([
    [-0.08, -0.03], [0.14, -0.02], [0.08, 0.04], [-0.08, 0.035],
  ], 0.76, 0.01), GUNMETAL, { at: [0, -0.54, -0.86], rot: ACROSS });
  b.glow(new THREE.BoxGeometry(0.24, 0.008, 0.01), AMBER, 3.0, { at: [0, -0.515, -0.82] });
}

/** Builds a crisp swept V-chevron fighter canopy visor mesh pair controlled by StandIn active/standby state. */
function makeVisor(color: string, boost: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(boost), toneMapped: false });
  const centerGeo = new THREE.BoxGeometry(0.56, 0.09, 0.06);
  const center = new THREE.Mesh(centerGeo, mat);
  center.position.set(0, 1.38, -2.42);
  center.rotation.set(-0.28, 0, 0);
  g.add(center);
  for (const s of [-1, 1]) {
    const wingGeo = new THREE.BoxGeometry(0.46, 0.08, 0.055);
    const wing = new THREE.Mesh(wingGeo, mat);
    wing.position.set(s * 0.42, 1.44, -2.24);
    wing.rotation.set(-0.22, s * -0.48, s * 0.12);
    g.add(wing);
  }
  return g;
}

export function buildKestrelChassis(materials: ModelMaterials, palette?: FramePalette): CockpitVisual {
  const pal = palette ?? BUREAU_PALETTE;
  const ext = frameBuilder(pal);
  exterior(ext);
  const exteriorGroup = materials.group(ext);
  exteriorGroup.name = 'chassis.kestrel';

  const visorActive = makeVisor(pal.glow, 4.2);
  const visorStandby = makeVisor(pal.secondaryGlow, 3.4);
  visorStandby.visible = false;
  exteriorGroup.add(visorActive, visorStandby);

  const int = frameBuilder(pal);
  interior(int);
  const interiorGroup = materials.group(int, materials.nearby);
  interiorGroup.name = 'chassis.kestrel.interior';

  return {
    exterior: exteriorGroup,
    interior: interiorGroup,
    replacesHull: true,
    hideStandardInterior: true,
    hideStandardVisor: true,
    places: KESTREL_PLACES,
    visorActive,
    visorStandby,
  };
}
