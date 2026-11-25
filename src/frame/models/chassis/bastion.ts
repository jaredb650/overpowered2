/**
 * Bastion Siege-Core (`chassisBastion`): massive monolithic wedge fortress with a steep sloped frontal ramming
 * glacis, spaced reactive-armour ERA blocks, towering twin slab shoulder bastions flanking the recessed head well,
 * triple-slat armoured bunker viewport, bolted tow shackles, and twin bulky rear exhaust stacks.
 */
import * as THREE from 'three';
import { ModelBuilder, type ModelMaterials } from '../../../progression/modelkit';
import {
  ACROSS, ALONG_Z, AMBER, BRASS, BUREAU_PALETTE, DARK, FLAT, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL,
  frameBuilder, ngon, prism,
  type ChassisPlaces, type CockpitVisual, type FramePalette,
} from '../shared';

export const BASTION_PLACES: ChassisPlaces = {
  eye: [0, 1.28, -0.98],
  head: [0, 2.38, -0.22],
  leftArm: [-2.15, 0.14, -1.06],
  rightArm: [2.15, 0.14, -1.06],
  shoulders: [
    [1.88, 2.68, 0.18],
    [-1.88, 2.68, 0.18],
    [0, 2.74, 0.42],
  ],
  jets: [0, 1.0, 2.06],
  jetNozzles: [
    [-1.42, 0.46, 2.1],
    [1.42, 0.46, 2.1],
  ],
  posturePitch: 0.02,
};

/** Exterior brutalist siege-fortress torso, sloped glacis, reactive armour blocks, towering slab pauldrons, and stacks. */
function exterior(b: ModelBuilder): void {
  // Heavy armoured waist collar & monolithic lower hull plinth.
  b.solid(prism(ngon(1.18, 8, Math.PI / 8), 0.34, 0.045), STEEL, { at: [0, 0.1, 0.12], rot: FLAT });
  b.solid(prism([
    [-1.62, -0.06], [1.66, -0.02], [2.04, 0.46], [1.74, 0.88], [-1.72, 0.82],
  ], 2.74, 0.07), GUNMETAL, { rot: ACROSS });

  // Massive monolithic wedge main citadel hull (wide 3.2 m core).
  b.solid(prism([
    [-1.84, 0.32], [1.56, 0.24], [2.36, 0.84], [2.14, 1.88], [1.34, 2.42],
    [-1.18, 2.48], [-1.98, 2.02], [-2.06, 0.96],
  ], 3.16, 0.1), OBSIDIAN, { rot: ACROSS });

  // Steeply sloped frontal ramming glacis & overhanging bunker casemate brow.
  b.solid(prism([
    [1.08, 0.34], [2.46, 0.72], [2.34, 1.18], [1.14, 1.06],
  ], 2.52, 0.055), PLATE, { rot: ACROSS });
  b.solid(prism([
    [0.92, 1.72], [2.48, 1.66], [2.24, 2.14], [1.02, 2.34],
  ], 2.42, 0.055), PLATE, { rot: ACROSS });
  // Deeply recessed dark bunker casemate aperture for the triple-slat visor.
  b.box(1.78, 0.56, 0.22, DARK, { at: [0, 1.38, -2.28] });
  // Thick vertical armoured mullion ribs dividing the bunker slit into three reinforced bays.
  for (const x of [-0.56, 0, 0.56]) {
    b.solid(prism([
      [-0.08, -0.28], [0.1, -0.28], [0.08, 0.28], [-0.08, 0.28],
    ], 0.14, 0.015), STEEL, { at: [x, 1.38, -2.38], rot: ACROSS });
  }

  // Spaced reactive-armour (ERA) brick arrays bolted across the sloped chest glacis.
  for (let row = 0; row < 2; row++) {
    for (let col = -2; col <= 2; col++) {
      const y = 0.64 + row * 0.28;
      const z = -2.34 - row * 0.06;
      b.solid(prism([
        [-0.2, -0.1], [0.2, -0.1], [0.18, 0.1], [-0.18, 0.1],
      ], 0.14, 0.018), (row + col) % 2 === 0 ? PLATE : GUNMETAL, { at: [col * 0.45, y, z], rot: [0.34, 0, 0] });
    }
  }

  // Heavy lower steel ramming bumper bar & bolted brass tow shackles on the prow.
  b.solid(prism([
    [-0.14, -0.12], [0.18, -0.12], [0.14, 0.14], [-0.12, 0.14],
  ], 2.68, 0.025), IRON, { at: [0, 0.36, -2.36], rot: ACROSS });
  for (const s of [-1, 1]) {
    b.cyl(0.11, 0.11, 0.22, 10, BRASS, { at: [s * 0.96, 0.38, -2.52], rot: [0, 0, Math.PI / 2] });
    b.solid(prism([
      [-0.08, -0.14], [0.18, -0.1], [0.18, 0.1], [-0.08, 0.14],
    ], 0.12, 0.015), STEEL, { at: [s * 0.96, 0.38, -2.44], rot: ACROSS });
  }

  // Recessed armoured head collar well (raised parapet flanking the head mount at [0, 2.38, -0.22]).
  b.solid(prism([
    [-0.98, 2.26], [0.46, 2.24], [0.32, 2.54], [-0.88, 2.58],
  ], 1.72, 0.04), GUNMETAL, { rot: ACROSS });

  for (const s of [-1, 1]) {
    // Towering twin slab shoulder bastions / vertical blast shields flanking the hull at x = ±2.18.
    b.solid(prism([
      [-1.12, 0.86], [1.18, 0.92], [1.32, 1.54], [1.06, 2.66], [-0.88, 2.74], [-1.26, 2.02],
    ], 0.92, 0.075), PLATE, { at: [s * 2.18, 0, -0.06], rot: ACROSS });
    // Inner dark blast-shield backing slab + spaced outer ERA armor shield plate.
    b.solid(prism([
      [-0.96, 0.72], [0.98, 0.76], [1.08, 1.62], [-1.04, 1.64],
    ], 0.74, 0.045), OBSIDIAN, { at: [s * 2.02, 0, -0.06], rot: ACROSS });
    b.solid(prism([
      [-0.78, 1.24], [0.84, 1.28], [0.76, 2.46], [-0.68, 2.5],
    ], 0.22, 0.03), GUNMETAL, { at: [s * 2.64, 0, -0.06], rot: ACROSS });
    // Bolted steel reinforcement ribs & hazard lamp on each shoulder bastion face.
    for (let i = 0; i < 3; i++) {
      b.box(0.16, 0.08, 1.54, STEEL, { at: [s * 2.76, 1.48 + i * 0.42, -0.06] });
    }
    b.glow(new THREE.BoxGeometry(0.12, 0.06, 1.24), AMBER, 3.8, { at: [s * 2.75, 2.48, -0.06] });
    b.glow(new THREE.BoxGeometry(0.22, 0.07, 0.06), RED, 4.0, { at: [s * 2.16, 2.56, -1.18] });

    // Massive shoulder turret drum & heavy double-strut arm gantry down to x = ±2.15.
    b.cyl(0.44, 0.44, 0.68, 14, STEEL, { at: [s * 2.04, 1.24, -0.06], rot: [0, 0, Math.PI / 2] });
    b.cyl(0.48, 0.48, 0.14, 14, BRASS, { at: [s * 1.82, 1.24, -0.06], rot: [0, 0, Math.PI / 2] });
    b.solid(prism([
      [-0.28, -0.62], [0.28, -0.62], [0.3, 0.62], [-0.3, 0.62],
    ], 0.5, 0.04), GUNMETAL, { at: [s * 2.12, 0.72, -0.26], rot: [0.38, 0, 0] });
    b.cyl(0.12, 0.12, 1.14, 10, STEEL, { at: [s * 2.34, 0.72, -0.1], rot: [0.38, 0, 0] });

    // Heavy elevated shoulder bastion mount saddle (slots 0 & 1 at x = ±1.88, y = 2.68, z = 0.18).
    b.solid(prism([
      [-0.56, -0.06], [0.58, -0.06], [0.48, 0.24], [-0.46, 0.24],
    ], 0.76, 0.03), OBSIDIAN, { at: [s * 1.88, 2.52, 0.18], rot: ACROSS });
    b.cyl(0.09, 0.09, 0.58, 10, BRASS, { at: [s * 1.88, 2.64, 0.58], rot: [0, 0, Math.PI / 2] });

    // Bulky twin rear vertical armoured exhaust stacks rising behind the bastion.
    b.solid(prism([
      [-0.44, 0.68], [0.38, 0.68], [0.38, 2.86], [-0.28, 3.04], [-0.52, 2.68],
    ], 0.64, 0.045), GUNMETAL, { at: [s * 1.18, 0, 2.02], rot: ACROSS });
    b.cyl(0.24, 0.26, 0.44, 12, IRON, { at: [s * 1.18, 3.04, 2.12], rot: [-0.14, 0, 0] });
    b.cyl(0.28, 0.28, 0.09, 12, STEEL, { at: [s * 1.18, 3.22, 2.15], rot: [-0.14, 0, 0] });
    // Heavy rear thruster bells at x = ±1.42, y = 0.46, z = 2.1.
    b.cyl(0.3, 0.44, 0.62, 14, IRON, { at: [s * 1.42, 0.76, 2.04], rot: [0.22, 0, s * -0.08] });
    b.cyl(0.38, 0.44, 0.1, 14, STEEL, { at: [s * 1.42, 0.46, 2.1], rot: [0.22, 0, s * -0.08] });
    b.glow(new THREE.CylinderGeometry(0.22, 0.28, 0.06, 12), AMBER, 4.4, { at: [s * 1.42, 0.52, 2.08], rot: [0.22, 0, s * -0.08] });
  }

  // Heavy recessed rear reactor radiator bay with thick armoured louver bars.
  b.solid(prism([
    [-0.58, 0.26], [0.32, 0.22], [0.32, 2.08], [-0.42, 2.14], [-0.66, 1.66],
  ], 1.78, 0.05), OBSIDIAN, { at: [0, 0, 1.88], rot: ACROSS });
  for (let i = 0; i < 5; i++) {
    b.box(1.48, 0.11, 0.26, i % 2 ? PLATE : IRON, { at: [0, 0.52 + i * 0.32, 2.48], rot: [0.28, 0, 0] });
    b.glow(new THREE.BoxGeometry(1.24, 0.045, 0.05), AMBER, 3.8, { at: [0, 0.48 + i * 0.32, 2.44] });
  }
}

/** Heavy riveted bunker-slit first-person cockpit framing (keeps center sightline & chin stomp hatch clear). */
function interior(b: ModelBuilder): void {
  for (const s of [-1, 1]) {
    // Thick riveted armoured bunker side pillars.
    b.solid(prism([
      [-0.1, -0.64], [0.1, -0.6], [0.08, 0.64], [-0.1, 0.62],
    ], 0.12, 0.02), OBSIDIAN, { at: [s * 1.04, 0.02, -0.74], rot: [0.06, 0, s * 0.05] });
    b.box(0.04, 1.16, 0.06, PLATE, { at: [s * 0.96, 0.02, -0.71], rot: [0.06, 0, s * 0.05] });
    // Heavy bolted steel rivet studs along each bunker pillar.
    for (let i = 0; i < 4; i++) {
      b.cyl(0.022, 0.022, 0.04, 8, BRASS, { at: [s * 0.94, -0.38 + i * 0.26, -0.68], rot: ALONG_Z });
    }
    // Chunky armoured side bulkhead & switchboard panel.
    b.box(0.14, 1.28, 1.38, GUNMETAL, { at: [s * 1.16, 0, 0.04] });
    b.solid(prism([
      [-0.34, -0.18], [0.34, -0.18], [0.28, 0.16], [-0.28, 0.2],
    ], 0.58, 0.025), OBSIDIAN, { at: [s * 0.88, -0.76, -0.44], rot: [0.34, s * -0.12, 0] });
    for (let i = 0; i < 3; i++) {
      b.glow(new THREE.BoxGeometry(0.06, 0.022, 0.02), i === 0 ? RED : AMBER, 3.2, { at: [s * (0.72 + i * 0.1), -0.6, -0.6 + i * 0.02] });
    }
  }
  // Thick overhanging armoured tank-slit brow slab & heavy lower glacis sill.
  b.solid(prism([
    [-0.14, -0.06], [0.14, -0.06], [0.1, 0.08], [-0.12, 0.08],
  ], 2.28, 0.02), OBSIDIAN, { at: [0, 0.62, -0.78], rot: ACROSS });
  b.box(0.56, 0.06, 0.12, PLATE, { at: [0, 0.58, -0.77] });
  b.glow(new THREE.BoxGeometry(0.18, 0.016, 0.014), RED, 3.4, { at: [0, 0.56, -0.72] });
  b.box(2.34, 0.1, 1.28, DARK, { at: [0, 0.74, -0.2] });

  b.solid(prism([
    [-0.12, -0.055], [0.12, -0.055], [0.08, 0.05], [-0.1, 0.05],
  ], 2.2, 0.018), OBSIDIAN, { at: [0, -0.56, -0.82], rot: ACROSS });
  for (const s of [-1, 1]) {
    b.box(0.06, 0.06, 0.94, IRON, { at: [s * 0.56, -1.0, -0.62], rot: [0.5, 0, s * -0.06] });
  }
}

/** Triple-slat glowing bunker viewport mesh pair (3 horizontal armoured slit bays). */
function makeVisor(color: string, boost: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(boost), toneMapped: false });
  const slats: readonly [number, number][] = [
    [-0.28, 0.36],
    [0.28, 0.36],
    [-0.78, 0.24],
    [0.78, 0.24],
  ];
  for (const [x, w] of slats) {
    const upper = new THREE.Mesh(new THREE.BoxGeometry(w, 0.085, 0.06), mat);
    upper.position.set(x, 1.46, -2.41);
    g.add(upper);
    const lower = new THREE.Mesh(new THREE.BoxGeometry(w * 0.88, 0.055, 0.055), mat);
    lower.position.set(x, 1.28, -2.4);
    g.add(lower);
  }
  return g;
}

export function buildBastionChassis(materials: ModelMaterials, palette?: FramePalette): CockpitVisual {
  const pal = palette ?? BUREAU_PALETTE;
  const ext = frameBuilder(pal);
  exterior(ext);
  const exteriorGroup = materials.group(ext);
  exteriorGroup.name = 'chassis.bastion';

  const visorActive = makeVisor(pal.glow, 4.2);
  const visorStandby = makeVisor(pal.secondaryGlow, 3.4);
  visorStandby.visible = false;
  exteriorGroup.add(visorActive, visorStandby);

  const int = frameBuilder(pal);
  interior(int);
  const interiorGroup = materials.group(int, materials.nearby);
  interiorGroup.name = 'chassis.bastion.interior';

  return {
    exterior: exteriorGroup,
    interior: interiorGroup,
    replacesHull: true,
    hideStandardInterior: true,
    hideStandardVisor: true,
    places: BASTION_PLACES,
    visorActive,
    visorStandby,
  };
}
