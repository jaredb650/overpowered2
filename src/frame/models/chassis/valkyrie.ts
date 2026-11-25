/**
 * Valkyrie Seraph Core (`chassisValkyrie`): sculpted upright high-tech V-taper interceptor with a layered angular
 * chevron chestplate, flared collar gorget, exposed glowing sternum energy core slit, crisp angled winged shoulder
 * binders, and twin articulated wing-vane heat radiators sweeping dramatically aft from the shoulders.
 */
import * as THREE from 'three';
import { ModelBuilder, type ModelMaterials } from '../../../progression/modelkit';
import {
  ACROSS, AMBER, BRASS, BUREAU_PALETTE, DARK, FLAT, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL,
  frameBuilder, ngon, prism,
  type ChassisPlaces, type CockpitVisual, type FramePalette,
} from '../shared';

export const VALKYRIE_PLACES: ChassisPlaces = {
  eye: [0, 1.42, -0.94],
  head: [0, 2.5, -0.26],
  leftArm: [-1.84, 0.22, -1.08],
  rightArm: [1.84, 0.22, -1.08],
  shoulders: [
    [2.12, 2.56, 0.34],
    [-2.12, 2.56, 0.34],
    [0, 2.74, 0.48],
  ],
  jets: [0, 1.04, 1.84],
  jetNozzles: [
    [-1.12, 0.54, 1.9],
    [1.12, 0.54, 1.9],
  ],
  posturePitch: 0.03,
};

const _yAxis = new THREE.Vector3(0, 1, 0);
function acrossRot(roll = 0, yaw = 0, pitch = 0): [number, number, number] {
  const q = new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(pitch, yaw, -roll, 'YXZ'))
    .multiply(new THREE.Quaternion().setFromAxisAngle(_yAxis, Math.PI / 2));
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  return [e.x, e.y, e.z];
}

/** Exterior upright V-taper hull, layered chevron breastplate, sternum energy core, flared gorget, and sweeping wing-vanes. */
function exterior(b: ModelBuilder): void {
  // Athletic tapered waist column with segmented abdominal armor plates and flanking hydraulic tendons.
  b.solid(prism(ngon(0.76, 8, Math.PI / 8), 0.26, 0.035), STEEL, { at: [0, 0.08, 0.1], rot: FLAT });
  b.solid(prism([
    [-0.96, -0.02], [0.98, 0.04], [1.14, 0.64], [0.92, 1.06], [-0.94, 1.04], [-1.1, 0.48],
  ], 1.48, 0.055), OBSIDIAN, { rot: ACROSS });
  // Segmented chevron abdominal armor plates.
  for (let i = 0; i < 3; i++) {
    b.solid(prism([
      [0.64, 0.14 + i * 0.24], [1.24 + i * 0.08, 0.22 + i * 0.24],
      [1.16 + i * 0.08, 0.38 + i * 0.24], [0.64, 0.34 + i * 0.24],
    ], 1.12 - i * 0.08, 0.025), PLATE, { rot: ACROSS });
  }
  for (const s of [-1, 1]) {
    b.cyl(0.08, 0.08, 0.94, 10, STEEL, { at: [s * 0.68, 0.52, -0.08], rot: [0.12, 0, s * -0.18] });
    b.cyl(0.105, 0.105, 0.22, 10, BRASS, { at: [s * 0.68, 0.38, -0.06], rot: [0.12, 0, s * -0.18] });
  }

  // Broad heroic V-taper upper chest core.
  b.solid(prism([
    [-1.44, 0.78], [1.22, 0.72], [1.92, 1.38], [1.74, 2.04], [0.94, 2.42],
    [-0.86, 2.44], [-1.62, 1.92], [-1.68, 1.18],
  ], 2.46, 0.08), OBSIDIAN, { rot: ACROSS });

  // Sweeping angular chevron breastplate (layered dual-wing prow flanking the central energy core slit).
  for (const s of [-1, 1]) {
    b.solid(prism([
      [0.68, 0.92], [1.96, 1.16], [2.14, 1.56], [1.72, 2.06], [0.76, 2.24],
    ], 0.94, 0.045), PLATE, { at: [s * 0.64, 0, 0], rot: [0, Math.PI / 2 + s * -0.18, 0] });
    // Secondary crisp angled collarbone vane plate.
    b.solid(prism([
      [-0.64, -0.28], [0.68, -0.2], [0.38, 0.22], [-0.72, 0.3],
    ], 0.74, 0.03), GUNMETAL, { at: [s * 0.78, 2.12, -1.08], rot: acrossRot(s * -0.14, s * -0.14) });
    // Cheek intake louvers tucked beneath the chevron prow.
    for (let i = 0; i < 3; i++) {
      b.box(0.32, 0.045, 0.12, STEEL, { at: [s * 0.74, 1.14 + i * 0.12, -1.96], rot: [0.22, s * -0.22, 0] });
    }
  }

  // Exposed glowing energy core slit running vertically down the sternum (palette-glow core + brass containment ribs).
  b.box(0.36, 0.92, 0.24, DARK, { at: [0, 1.38, -2.02], rot: [-0.14, 0, 0] });
  b.glow(new THREE.BoxGeometry(0.14, 0.78, 0.08), RED, 4.8, { at: [0, 1.38, -2.14], rot: [-0.14, 0, 0] });
  for (let i = 0; i < 3; i++) {
    b.box(0.42, 0.045, 0.08, BRASS, { at: [0, 1.12 + i * 0.26, -2.13], rot: [-0.14, 0, 0] });
  }

  // Flared armoured collar gorget framing the proud elevated head mount at [0, 2.5, -0.26].
  b.solid(prism([
    [-0.86, 2.24], [0.76, 2.24], [0.96, 2.54], [0.68, 2.68], [-0.74, 2.64], [-0.94, 2.44],
  ], 1.48, 0.035), PLATE, { rot: ACROSS });
  b.solid(prism([
    [-0.64, 2.32], [0.58, 2.32], [0.68, 2.56], [-0.6, 2.56],
  ], 1.12, 0.025), DARK, { rot: ACROSS });
  // Recessed upper visor shroud beneath the gorget brow.
  b.box(1.16, 0.34, 0.16, DARK, { at: [0, 1.98, -1.96], rot: [-0.2, 0, 0] });

  for (const s of [-1, 1]) {
    // Crisp angled winged shoulder binders flaring upward and outward.
    b.solid(prism([
      [-0.78, -0.58], [0.88, -0.54], [1.26, -0.1], [0.72, 0.52], [-0.66, 0.62], [-1.04, 0.02],
    ], 0.64, 0.05), PLATE, { at: [s * 1.78, 1.88, -0.06], rot: acrossRot(s * 0.22) });
    // Outer sweeping binder blade & glowing trim strip.
    b.solid(prism([
      [-0.92, -0.58], [0.72, -0.62], [1.04, -0.12], [0.24, 0.52], [-1.18, 0.62],
    ], 0.16, 0.025), GUNMETAL, { at: [s * 2.18, 2.12, -0.02], rot: acrossRot(s * 0.34) });
    b.glow(new THREE.BoxGeometry(0.06, 0.05, 1.22), RED, 4.2, { at: [s * 2.28, 2.08, -0.06], rot: [0.06, 0, s * -0.34] });

    // Sculpted shoulder gimbal drum & sleek upper-arm fairing connecting down to x = ±1.84.
    b.cyl(0.32, 0.32, 0.56, 14, STEEL, { at: [s * 1.74, 1.38, -0.08], rot: [0, 0, Math.PI / 2] });
    b.cyl(0.35, 0.35, 0.12, 14, BRASS, { at: [s * 1.54, 1.38, -0.08], rot: [0, 0, Math.PI / 2] });
    b.solid(prism([
      [-0.2, -0.58], [0.2, -0.58], [0.24, 0.58], [-0.24, 0.58],
    ], 0.36, 0.035), PLATE, { at: [s * 1.82, 0.82, -0.38], rot: [0.46, 0, 0] });
    b.cyl(0.08, 0.08, 1.04, 10, STEEL, { at: [s * 1.98, 0.82, -0.24], rot: [0.46, 0, 0] });

    // Twin articulated sweeping wing-vane heat radiators extending wide & aft from the rear shoulders!
    // Wing-pylon structural boom carrying the wide shoulder hardpoint at [±2.12, 2.56, 0.34].
    b.solid(prism([
      [-0.48, -0.1], [0.54, -0.08], [0.44, 0.2], [-0.42, 0.2],
    ], 1.38, 0.03), OBSIDIAN, { at: [s * 1.54, 2.38, 0.38], rot: acrossRot(s * -0.16) });
    b.solid(prism([
      [-0.42, 0.0], [0.46, 0.0], [0.38, 0.2], [-0.36, 0.2],
    ], 0.58, 0.025), PLATE, { at: [s * 2.12, 2.42, 0.34], rot: ACROSS });
    b.cyl(0.08, 0.08, 0.48, 10, BRASS, { at: [s * 2.12, 2.52, 0.68], rot: [0, 0, Math.PI / 2] });

    // Primary sweeping seraph wing-vane blades (3 layered radiator feathers sweeping back & outward).
    for (let f = 0; f < 3; f++) {
      const len = 1.95 - f * 0.36;
      const yOff = 2.16 - f * 0.38;
      const zOff = 0.82 + f * 0.22;
      const roll = s * (0.42 + f * 0.14);
      const yaw = s * (-0.34 - f * 0.06);
      b.solid(prism([
        [-len, -0.14], [0.22, -0.1], [0.28, 0.18], [-len * 0.72, 0.28], [-len * 1.04, 0.04],
      ], 0.09, 0.018), f === 0 ? PLATE : GUNMETAL, { at: [s * (1.44 + f * 0.16), yOff, zOff], rot: acrossRot(roll, yaw, 0.16) });
      b.glow(new THREE.BoxGeometry(0.035, 0.045, len * 0.74), AMBER, 3.8, {
        at: [s * (1.72 + f * 0.14), yOff + 0.08, zOff + len * 0.38],
        rot: [0.16, yaw, -roll],
      });
    }

    // Twin precision rear vectoring thruster bells.
    b.solid(prism([
      [-0.4, -0.26], [0.3, -0.22], [0.36, 0.54], [-0.28, 0.6],
    ], 0.5, 0.035), OBSIDIAN, { at: [s * 1.12, 1.24, 1.66], rot: ACROSS });
    b.cyl(0.24, 0.34, 0.58, 14, IRON, { at: [s * 1.12, 0.8, 1.84], rot: [0.24, 0, s * -0.1] });
    b.cyl(0.3, 0.35, 0.08, 14, STEEL, { at: [s * 1.12, 0.54, 1.9], rot: [0.24, 0, s * -0.1] });
    b.glow(new THREE.CylinderGeometry(0.18, 0.23, 0.06, 12), AMBER, 4.6, { at: [s * 1.12, 0.6, 1.88], rot: [0.24, 0, s * -0.1] });
  }

  // Sculpted dorsal reactor spine pack with crisp vertical radiator fins.
  b.solid(prism([
    [-0.48, 0.36], [0.28, 0.32], [0.28, 2.04], [-0.34, 2.12], [-0.56, 1.64],
  ], 1.56, 0.05), GUNMETAL, { at: [0, 0, 1.66], rot: ACROSS });
  for (let i = 0; i < 5; i++) {
    b.box(1.26, 0.075, 0.22, i % 2 ? PLATE : IRON, { at: [0, 0.62 + i * 0.29, 2.22], rot: [0.26, 0, 0] });
    b.glow(new THREE.BoxGeometry(1.04, 0.038, 0.045), RED, 3.8, { at: [0, 0.58 + i * 0.29, 2.18] });
  }
}

/** Crisp high-tech geometric bezel first-person cockpit interior (wide clear view, angled HUD wings). */
function interior(b: ModelBuilder): void {
  for (const s of [-1, 1]) {
    // Sleek faceted diamond-cut A-pillars.
    b.solid(prism([
      [-0.045, -0.6], [0.045, -0.58], [0.032, 0.64], [-0.048, 0.62],
    ], 0.06, 0.012), PLATE, { at: [s * 1.06, 0.04, -0.74], rot: [0.14, 0, s * 0.14] });
    b.glow(new THREE.BoxGeometry(0.012, 0.72, 0.014), RED, 3.0, { at: [s * 1.02, 0.06, -0.71], rot: [0.14, 0, s * 0.14] });
    // Angled side holographic telemetry wing bezels.
    b.solid(prism([
      [-0.26, -0.14], [0.28, -0.14], [0.24, 0.14], [-0.22, 0.16],
    ], 0.52, 0.018), OBSIDIAN, { at: [s * 0.88, -0.72, -0.46], rot: [0.32, s * -0.18, 0] });
    b.glow(new THREE.BoxGeometry(0.26, 0.012, 0.012), RED, 3.2, { at: [s * 0.82, -0.58, -0.58], rot: [0, s * -0.18, 0] });
    b.glow(new THREE.BoxGeometry(0.18, 0.01, 0.012), AMBER, 3.0, { at: [s * 0.86, -0.62, -0.54], rot: [0, s * -0.18, 0] });
  }
  // Faceted overhead interceptor canopy arch + central energy telemetry pip bar.
  b.solid(prism([
    [-0.08, -0.03], [0.08, -0.03], [0.055, 0.04], [-0.065, 0.04],
  ], 2.16, 0.012), OBSIDIAN, { at: [0, 0.65, -0.8], rot: ACROSS });
  b.solid(prism([
    [-0.04, -0.02], [0.04, -0.02], [0.03, 0.025], [-0.03, 0.025],
  ], 0.72, 0.008), PLATE, { at: [0, 0.62, -0.78], rot: ACROSS });
  b.glow(new THREE.BoxGeometry(0.36, 0.01, 0.012), RED, 3.4, { at: [0, 0.6, -0.75] });
  // Slim lower V-notched sill (keeps chin stomp sightline wide open).
  b.solid(prism([
    [-0.06, -0.025], [0.06, -0.025], [0.045, 0.025], [-0.05, 0.025],
  ], 2.08, 0.01), GUNMETAL, { at: [0, -0.58, -0.84], rot: ACROSS });
}

/** Crisp angular dual-wing interceptor canopy visor mesh pair. */
function makeVisor(color: string, boost: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(boost), toneMapped: false });
  for (const s of [-1, 1]) {
    const seg = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.09, 0.055), mat);
    seg.position.set(s * 0.28, 1.98, -2.06);
    seg.rotation.set(-0.2, s * -0.22, s * 0.12);
    g.add(seg);
  }
  const core = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.06), mat);
  core.position.set(0, 1.93, -2.11);
  core.rotation.x = -0.2;
  g.add(core);
  return g;
}

export function buildValkyrieChassis(materials: ModelMaterials, palette?: FramePalette): CockpitVisual {
  const pal = palette ?? BUREAU_PALETTE;
  const ext = frameBuilder(pal);
  exterior(ext);
  const exteriorGroup = materials.group(ext);
  exteriorGroup.name = 'chassis.valkyrie';

  const visorActive = makeVisor(pal.glow, 4.2);
  const visorStandby = makeVisor(pal.secondaryGlow, 3.4);
  visorStandby.visible = false;
  exteriorGroup.add(visorActive, visorStandby);

  const int = frameBuilder(pal);
  interior(int);
  const interiorGroup = materials.group(int, materials.nearby);
  interiorGroup.name = 'chassis.valkyrie.interior';

  return {
    exterior: exteriorGroup,
    interior: interiorGroup,
    replacesHull: true,
    hideStandardInterior: true,
    hideStandardVisor: true,
    places: VALKYRIE_PLACES,
    visorActive,
    visorStandby,
  };
}
