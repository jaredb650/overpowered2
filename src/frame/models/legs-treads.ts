/**
 * Treads 3D model: heavy dual armoured tank track pods with front/rear sloped glacis skirts,
 * bogie road wheels, front idlers, rear toothed drive sprockets & upper return rollers that
 * roll continuously with `stride`, plus a sloped central armoured chassis hull & turret pedestal.
 */
import * as THREE from 'three';
import { clamp } from '../../core/math';
import { ModelBuilder, type ModelMaterials } from '../../progression/modelkit';
import {
  ACROSS, AMBER, BRASS, DARK, FLAT, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL,
  ngon, prism, type LegsVisual,
} from './shared';

const TRACK_X = 1.62;
const ROAD_WHEEL_ZS = [-1.6, -0.8, 0, 0.8, 1.6] as const;
const RETURN_ROLLER_ZS = [-1.1, 0, 1.1] as const;

function buildTurretRing(b: ModelBuilder, hipsY: number): void {
  // Heavy octagonal waist turret bearing ring flush with the torso belly.
  b.solid(prism(ngon(1.26, 8, Math.PI / 8), 0.3, 0.045), STEEL, { at: [0, hipsY, 0.18], rot: FLAT });
  // Armoured turret ring collar & hydraulic recoil collar.
  b.solid(prism(ngon(1.42, 8, Math.PI / 8), 0.36, 0.05), OBSIDIAN, { at: [0, hipsY - 0.26, 0.18], rot: FLAT });
  b.cyl(1.32, 1.38, 0.12, 16, BRASS, { at: [0, hipsY - 0.12, 0.18] });
}

function buildChassis(b: ModelBuilder, hipsY: number): void {
  const pedTop = hipsY - 0.38;

  // Sloped trapezoidal upper casemate pedestal connecting tank hull to waist ring.
  b.solid(prism([
    [-1.78, 2.05], [1.74, 2.05], [1.38, pedTop], [-1.32, pedTop],
  ], 2.28, 0.07), OBSIDIAN, { at: [0, 0, 0.14], rot: ACROSS });
  // Bevelled upper glacis collar plates on pedestal.
  b.solid(prism([
    [0.82, 2.08], [1.86, 2.06], [1.46, pedTop - 0.06], [0.76, pedTop - 0.04],
  ], 1.88, 0.05), PLATE, { at: [0, 0, 0.14], rot: ACROSS });

  // Heavy hydraulic recoil stabilizer struts bracing pedestal out to left/right track sponsons.
  for (const s of [-1, 1]) {
    b.cyl(0.11, 0.11, 1.45, 10, STEEL, { at: [s * 1.18, 2.48, -0.58], rot: [0, 0, s * 0.56] });
    b.cyl(0.15, 0.15, 0.48, 10, BRASS, { at: [s * 1.12, 2.58, -0.58], rot: [0, 0, s * 0.56] });
    b.cyl(0.11, 0.11, 1.45, 10, STEEL, { at: [s * 1.18, 2.48, 0.84], rot: [0, 0, s * 0.56] });
    b.cyl(0.15, 0.15, 0.48, 10, BRASS, { at: [s * 1.12, 2.58, 0.84], rot: [0, 0, s * 0.56] });
  }

  // Central armoured tank hull tub (`y = 0.68 .. 2.15`, sloped front nose glacis & rear engine deck).
  b.solid(prism([
    [-2.18, 0.82], [1.78, 0.68], [2.46, 1.24], [2.12, 1.88], [1.48, 2.16], [-1.86, 2.16], [-2.38, 1.54],
  ], 2.34, 0.08), OBSIDIAN, { at: [0, 0, 0.04], rot: ACROSS });
  // Sloped front glacis armour wedge plate.
  b.solid(prism([
    [1.36, 1.82], [2.48, 1.28], [2.22, 1.94], [1.48, 2.18],
  ], 1.96, 0.045), PLATE, { at: [0, 0, 0.04], rot: ACROSS });
  // Lower chin bumper beam + twin front tow shackles.
  b.solid(prism([
    [1.82, 0.72], [2.48, 1.14], [2.36, 1.32], [1.74, 0.96],
  ], 1.76, 0.04), GUNMETAL, { at: [0, 0, 0.04], rot: ACROSS });
  for (const s of [-1, 1]) {
    b.box(0.16, 0.22, 0.3, STEEL, { at: [s * 0.68, 1.05, -2.38], rot: [0.35, 0, 0] });
    // Twin recessed amber convoy headlights on upper front glacis.
    b.box(0.32, 0.18, 0.18, IRON, { at: [s * 0.86, 1.88, -2.06] });
    b.glow(new THREE.BoxGeometry(0.24, 0.09, 0.04), AMBER, 4.2, { at: [s * 0.86, 1.88, -2.16] });
  }

  // Rear armoured engine deck with louvered exhaust vents & twin angled exhaust pipes.
  b.solid(prism([
    [-2.24, 1.52], [-1.36, 1.52], [-1.36, 2.2], [-2.06, 2.12],
  ], 1.92, 0.04), GUNMETAL, { at: [0, 0, 0.04], rot: ACROSS });
  for (let i = 0; i < 4; i++) {
    b.box(1.56, 0.06, 0.18, IRON, { at: [0, 2.22, 1.48 + i * 0.2], rot: [-0.24, 0, 0] });
  }
  for (const s of [-1, 1]) {
    b.cyl(0.14, 0.17, 0.85, 10, STEEL, { at: [s * 0.72, 2.38, 2.18], rot: [-0.42, 0, s * -0.14] });
    b.glow(new THREE.BoxGeometry(0.24, 0.06, 0.04), RED, 3.4, { at: [s * 0.88, 1.76, 2.36] });
  }

  // Dual heavy armoured track pods (left & right).
  for (const s of [-1, 1]) {
    const tx = s * TRACK_X;

    // Inner track suspension beam bridging track pod to central hull.
    b.solid(prism([
      [-1.92, 0.42], [1.92, 0.42], [2.18, 1.18], [-2.12, 1.18],
    ], 0.44, 0.04), GUNMETAL, { at: [tx - s * 0.34, 0, 0], rot: ACROSS });

    // Continuous dark armoured track belt loop (bottom sole flush at y = 0.0!).
    // Bottom ground contact run.
    b.solid(prism([
      [-1.92, 0.0], [1.96, 0.0], [1.96, 0.12], [-1.92, 0.12],
    ], 0.94, 0.02), DARK, { at: [tx, 0, 0], rot: ACROSS });
    // Front sloped climb run (bottom front -> front idler).
    b.solid(prism([
      [1.88, 0.02], [2.66, 0.94], [2.56, 1.06], [1.82, 0.14],
    ], 0.94, 0.02), DARK, { at: [tx, 0, 0], rot: ACROSS });
    // Rear sloped climb run (bottom rear -> rear drive sprocket).
    b.solid(prism([
      [-2.58, 0.98], [-1.84, 0.02], [-1.76, 0.14], [-2.48, 1.1],
    ], 0.94, 0.02), DARK, { at: [tx, 0, 0], rot: ACROSS });
    // Top return track run under the armoured fender.
    b.solid(prism([
      [-2.42, 1.44], [2.48, 1.42], [2.48, 1.56], [-2.42, 1.56],
    ], 0.94, 0.02), DARK, { at: [tx, 0, 0], rot: ACROSS });

    // Raised track grouser cleats along the visible front/rear/top track faces.
    for (let i = -5; i <= 5; i++) {
      b.box(0.88, 0.05, 0.14, GUNMETAL, { at: [tx, 1.58, i * 0.42] });
    }
    for (let i = 0; i < 3; i++) {
      const f = i / 2;
      b.box(0.88, 0.06, 0.12, GUNMETAL, { at: [tx, 0.22 + f * 0.62, -2.02 - f * 0.52], rot: [0.88, 0, 0] });
      b.box(0.88, 0.06, 0.12, GUNMETAL, { at: [tx, 0.24 + f * 0.62, 1.96 + f * 0.5], rot: [-0.88, 0, 0] });
    }

    // Heavy upper armoured fender & sloped front/rear mudguard glacis skirts.
    b.solid(prism([
      [-2.56, 1.48], [2.64, 1.46], [2.82, 1.18], [2.68, 1.62], [2.22, 1.88], [-2.18, 1.88], [-2.64, 1.6], [-2.76, 1.22],
    ], 1.12, 0.05), OBSIDIAN, { at: [tx, 0, 0], rot: ACROSS });
    // Layered outer reactive side-skirt armour panels (leaving lower road wheels clearly visible!).
    for (let p = 0; p < 4; p++) {
      const pz = -1.56 + p * 1.04;
      b.solid(prism([
        [-0.46, 0.88], [0.46, 0.88], [0.42, 1.72], [-0.42, 1.72],
      ], 0.14, 0.03), PLATE, { at: [tx + s * 0.54, 0, pz], rot: ACROSS });
      // Bolt bosses along skirt top.
      b.cyl(0.045, 0.045, 0.08, 6, STEEL, { at: [tx + s * 0.62, 1.56, pz - 0.26], rot: [0, 0, Math.PI / 2] });
      b.cyl(0.045, 0.045, 0.08, 6, STEEL, { at: [tx + s * 0.62, 1.56, pz + 0.26], rot: [0, 0, Math.PI / 2] });
    }
    // Front & rear sloped mudguard nose/tail plates.
    b.solid(prism([
      [2.16, 1.58], [2.86, 1.16], [2.72, 1.66], [2.2, 1.88],
    ], 1.04, 0.035), PLATE, { at: [tx, 0, 0], rot: ACROSS });
    b.solid(prism([
      [-2.78, 1.2], [-2.12, 1.58], [-2.16, 1.88], [-2.66, 1.64],
    ], 1.04, 0.035), PLATE, { at: [tx, 0, 0], rot: ACROSS });
    // Thin Bureau crimson stripe + amber fender corner lamps.
    b.glow(new THREE.BoxGeometry(0.04, 0.045, 3.6), RED, 3.5, { at: [tx + s * 0.62, 1.68, 0] });
    b.glow(new THREE.BoxGeometry(0.18, 0.05, 0.05), AMBER, 3.8, { at: [tx + s * 0.36, 1.66, -2.54] });
  }
}

function buildWheelMesh(materials: ModelMaterials, radius: number, width: number, toothed: boolean): THREE.Group {
  const b = new ModelBuilder();
  // Dark rubber tire band.
  b.cyl(radius, radius, width, 14, DARK, { rot: [0, 0, Math.PI / 2] });
  // Inner machined gunmetal rim.
  b.cyl(radius * 0.78, radius * 0.78, width + 0.04, 10, GUNMETAL, { rot: [0, 0, Math.PI / 2] });
  // Raised steel hub cap + visible cross spokes so rotation reads immediately!
  b.cyl(radius * 0.34, radius * 0.34, width + 0.1, 8, STEEL, { rot: [0, 0, Math.PI / 2] });
  b.box(width + 0.07, radius * 1.38, radius * 0.18, PLATE, {});
  b.box(width + 0.07, radius * 0.18, radius * 1.38, PLATE, {});
  if (toothed) {
    // Drive sprocket brass collar & outer teeth lugs.
    b.cyl(radius * 0.48, radius * 0.48, width + 0.08, 8, BRASS, { rot: [0, 0, Math.PI / 2] });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      b.box(width + 0.06, 0.12, 0.12, STEEL, {
        at: [0, Math.cos(a) * (radius + 0.04), Math.sin(a) * (radius + 0.04)],
        rot: [a, 0, 0],
      });
    }
  }
  return materials.group(b);
}

interface WheelEntry {
  readonly mesh: THREE.Group;
  readonly ratio: number;
}

export function buildTreadsLegs(materials: ModelMaterials, hipsY: number): LegsVisual {
  const group = new THREE.Group();
  group.name = 'frame.legs.treads';

  const turretB = new ModelBuilder();
  buildTurretRing(turretB, hipsY);
  const turretGroup = materials.group(turretB);
  group.add(turretGroup);

  const chassisGroup = new THREE.Group();
  const chassisB = new ModelBuilder();
  buildChassis(chassisB, hipsY);
  chassisGroup.add(materials.group(chassisB));
  group.add(chassisGroup);

  const wheels: WheelEntry[] = [];
  for (const s of [-1, 1]) {
    const tx = s * TRACK_X;
    // 5 lower bogie road wheels per side.
    for (const wz of ROAD_WHEEL_ZS) {
      const w = buildWheelMesh(materials, 0.35, 0.86, false);
      w.position.set(tx, 0.44, wz);
      chassisGroup.add(w);
      wheels.push({ mesh: w, ratio: 1 });
    }
    // Front elevated idler wheel.
    const idler = buildWheelMesh(materials, 0.39, 0.84, false);
    idler.position.set(tx, 1.0, -2.24);
    chassisGroup.add(idler);
    wheels.push({ mesh: idler, ratio: 0.9 });
    // Rear elevated toothed drive sprocket.
    const sprocket = buildWheelMesh(materials, 0.41, 0.86, true);
    sprocket.position.set(tx, 1.04, 2.16);
    chassisGroup.add(sprocket);
    wheels.push({ mesh: sprocket, ratio: 0.85 });
    // 3 upper return rollers.
    for (const rz of RETURN_ROLLER_ZS) {
      const roller = buildWheelMesh(materials, 0.17, 0.78, false);
      roller.position.set(tx, 1.32, rz);
      chassisGroup.add(roller);
      wheels.push({ mesh: roller, ratio: 2.0 });
    }
  }

  return {
    group,
    pose(stride, _walk, effectiveSink, kneel, collapse, limpSide, _parked, jetMode): void {
      // Smooth tank chassis suspension — no walking leg swing!
      const sinkY = clamp(effectiveSink, -1.9, 0.5);
      turretGroup.position.y = sinkY;

      const suspDip = clamp(effectiveSink * 0.22 - kneel * 0.12 - collapse * 0.18, -0.34, 0.18);
      chassisGroup.position.y = suspDip;
      chassisGroup.rotation.set(
        (jetMode ? -0.18 : 0) + collapse * 0.09,
        0,
        collapse * 0.14 + limpSide * 0.04,
      );

      // Roll all bogie road wheels, idlers, drive sprockets, and return rollers continuously with stride.
      const baseSpin = -stride * 2.4;
      for (let i = 0; i < wheels.length; i++) {
        const entry = wheels[i]!;
        entry.mesh.rotation.x = baseSpin * entry.ratio;
      }
    },
  };
}
