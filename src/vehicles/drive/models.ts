/**
 * High-detail procedural PBR 3D models for all 10 player-driveable vehicles.
 *
 * Conventions (matching src/enemies/vehicles/models.ts & loft.ts):
 *   - Nose along +Z, Up along +Y, Left along +X.
 *   - Every model sits on y = 0 at rest (wheels/tracks/skids grounded; Viper skiff floats on repulsors).
 *   - Uses VehicleBuilder (`textures.ts`) for cached 512x512 procedural PBR maps (riveted armor panels,
 *     brushed metal/diamond plate, deep knobby tire treads, woven carbon, glossy tinted canopies) while
 *     preserving every vehicle's exact silhouette, rotating steered wheels, independent turrets, recoiling
 *     barrels, spinning rotors, hydraulic outriggers, emissive lights/afterburners, and visible articulated
 *     rider sockets (`riders.ts`) ready for solo & multi-seat co-op!
 */
import * as THREE from 'three';
import { ModelBuilder, type ModelMaterials } from '../../progression/modelkit';
import { warthogModel } from '../../progression/callins/warthog';
import { UTILITY_AIRFRAME } from '../utilityModel';
import { hull } from '../loft';
import { VehicleBuilder, upgradeModelToPbrArmor } from './textures';
import { buildRiderRig, type RiderRig } from './riders';
import type { DriveVehicleId } from './types';

export interface VehicleModelRig {
  readonly root: THREE.Group;
  readonly body: THREE.Group;
  readonly turret: THREE.Group | null;
  readonly barrel: THREE.Group | null;
  readonly barrelBaseZ: number;
  readonly subTurret: THREE.Group | null;
  readonly wheelsFront: THREE.Group[];
  readonly wheelsRear: THREE.Group[];
  readonly rotorMain: THREE.Group | null;
  readonly rotorTail: THREE.Group | null;
  readonly outriggers: THREE.Group[];
  readonly boostGlow: THREE.Object3D[];
  readonly resupplyRing: THREE.Mesh | null;
  readonly muzzles: Readonly<Record<'main' | 'coax' | 'podLeft' | 'podRight' | 'roof' | 'front' | 'rear', THREE.Object3D>>;
  readonly meshes: THREE.Object3D[];
  /** Visible articulated seated operator models indexed by `seatIndex` (co-op multi-seat ready). */
  readonly riders: readonly RiderRig[];
  /** Base Y offset of `body` relative to `root` (preserved during hover/bob sync). */
  readonly bodyBaseY?: number;
  /** Exterior canopy/turret parts hidden while in 1P so the camera never clips into vehicle geometry. */
  readonly fpHideParts?: THREE.Object3D[];
  /** Downward VTOL thruster cones visible when hovering in VTOL mode (Harrier / Warthog). */
  readonly vtolGlow?: THREE.Object3D[];
  /** Pivoting variable-geometry swing wings (Lancer: sweep smoothly backward with airspeed!). */
  readonly wingsLeft?: THREE.Group;
  readonly wingsRight?: THREE.Group;
  /** Animated 2D thrust-vectoring exhaust nozzle groups (F-22 Raptor). */
  readonly nozzles?: THREE.Group[];
  /** Giant trailing fuel-torch plumes for Lancer's [Q] Dump-and-Burn special! */
  readonly dumpBurnGlow?: THREE.Object3D[];
  /** Retractable tricycle landing gear group (hidden automatically once airborne above 3.2m). */
  readonly landingGear?: THREE.Group;
  /** Animated ventral internal bomb-bay door hinges (Lancer triple bays; each carries `userData.side = 1 | -1`). */
  readonly bombBayDoors?: THREE.Object3D[];
}

const ALONG_X: readonly [number, number, number] = [0, 0, Math.PI / 2];
const ALONG_Z: readonly [number, number, number] = [Math.PI / 2, 0, 0];

const TYRE = '#1a1d21';
const TYRE_LUG = '#282c32';
const RIM = '#5a636e';
const BOLT = '#b6c2cc';
const STEEL = '#262c33';
const GUNMETAL = '#39414a';
const GLASS = '#0e2230';
const CHROME = '#c4cfd9';
const BRAKE_RED = '#c9332b';
const SPRING_YELLOW = '#e0a92b';

function makeMarker(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D {
  const o = new THREE.Object3D();
  o.position.set(x, y, z);
  parent.add(o);
  return o;
}

/** High-detail knobby off-road / sport wheel with PBR vulcanized tread, spoked alloy rim, brake disc & caliper. */
function makeWheelGroup(materials: ModelMaterials, radius: number, width: number, rimColor: string): THREE.Group {
  const b = new VehicleBuilder();
  // Round vulcanized knobby tire carcass + subtle sidewall shoulder bevels
  b.cyl(radius, radius, width, 24, TYRE, { rot: ALONG_X }, 'tread');
  b.cyl(radius * 0.88, radius * 0.88, width + 0.025, 20, '#1f2328', { rot: ALONG_X }, 'tread');
  // Recessed alloy wheel barrel & inner brake rotor
  b.cyl(radius * 0.62, radius * 0.62, width + 0.04, 16, rimColor, { rot: ALONG_X }, 'metal');
  b.cyl(radius * 0.54, radius * 0.54, width + 0.055, 16, '#1a1f25', { rot: ALONG_X }, 'metal');
  b.cyl(radius * 0.42, radius * 0.42, width * 0.45, 14, '#8d97a1', { rot: ALONG_X }, 'metal'); // ventilated brake disc
  b.box(width * 0.58, radius * 0.24, radius * 0.16, BRAKE_RED, { at: [0, radius * 0.34, radius * 0.24] }, 'armor'); // caliper
  b.cyl(radius * 0.24, radius * 0.24, width + 0.1, 12, STEEL, { rot: ALONG_X }, 'metal');

  // 5 machined alloy rim spokes + lug nuts
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    b.box(width + 0.07, radius * 0.46, radius * 0.1, rimColor, {
      at: [0, Math.cos(a) * radius * 0.34, Math.sin(a) * radius * 0.34],
      rot: [a, 0, 0],
    }, 'metal');
    b.cyl(0.028, 0.028, width + 0.115, 6, BOLT, {
      at: [0, Math.cos(a) * radius * 0.16, Math.sin(a) * radius * 0.16],
      rot: ALONG_X,
    }, 'metal');
  }

  // 12 sculpted off-road tread blocks so tire rotation reads cleanly at every speed
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const shift = i % 2 === 0 ? width * 0.12 : -width * 0.12;
    b.box(width * 0.72, radius * 0.13, radius * 0.2, TYRE_LUG, {
      at: [shift, Math.cos(a) * radius * 0.96, Math.sin(a) * radius * 0.96],
      rot: [a, 0, 0],
    }, 'tread');
  }
  return b.build(materials);
}

function collectMeshes(root: THREE.Object3D): THREE.Object3D[] {
  const list: THREE.Object3D[] = [];
  root.traverse(o => {
    if ((o as THREE.Mesh).isMesh) list.push(o);
  });
  return list;
}

// =================================================================================================
// 1. JACKAL — 4WD Dune Technical (Sand Tan + Slate + Amber Racing Stripes + Rollcage + Roof Rotary)
// =================================================================================================

function buildJackal(materials: ModelMaterials): VehicleModelRig {
  const SAND = '#c9a268';
  const SAND_LIGHT = '#dbb982';
  const SAND_DARK = '#8e6e42';
  const AMBER = '#f59e0b';

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const b = new VehicleBuilder();
  // Heavy tubular desert chassis skid-plate, frame rails & coilover shocks
  b.box(1.5, 0.22, 4.4, STEEL, { at: [0, 0.68, 0] }, 'metal');
  b.box(1.75, 0.14, 0.9, GUNMETAL, { at: [0, 0.56, 2.15], rot: [-0.42, 0, 0] }, 'metal'); // front bash skid
  // Sculpted hood & cowl (lofted hull)
  b.solid(hull([
    { z: 0.45, w: 1.05, top: 1.48, bottom: 0.78 },
    { z: 1.55, w: 1.0, top: 1.38, bottom: 0.78 },
    { z: 2.52, w: 0.88, top: 1.15, bottom: 0.82 },
  ]), SAND, {}, 'armor');
  // Racing stripe, slatted radiator grille, winch drum & hood scoop
  b.box(0.46, 0.04, 1.8, AMBER, { at: [0, 1.39, 1.42], rot: [0.12, 0, 0] }, 'armor');
  b.box(0.54, 0.14, 0.75, GUNMETAL, { at: [0, 1.46, 1.15] }, 'metal');
  b.box(0.44, 0.07, 0.06, '#14171b', { at: [0, 1.46, 1.53] }, 'carbon'); // scoop intake vent
  b.box(1.18, 0.26, 0.08, '#171b20', { at: [0, 1.02, 2.51] }, 'metal'); // front grille housing
  for (let i = -2; i <= 2; i++) {
    b.box(1.12, 0.025, 0.1, GUNMETAL, { at: [0, 0.94 + (i + 2) * 0.045, 2.53] }, 'metal');
  }
  b.cyl(0.11, 0.11, 0.46, 12, CHROME, { at: [0, 0.86, 2.68], rot: ALONG_X }, 'metal'); // front winch drum
  // Bull-bar, headlights, suspension shocks & desert fenders
  b.box(1.95, 0.12, 0.12, GUNMETAL, { at: [0, 0.84, 2.66] }, 'metal');
  b.box(1.65, 0.08, 0.08, GUNMETAL, { at: [0, 1.24, 2.58] }, 'metal');
  for (const s of [-1, 1]) {
    b.box(0.08, 0.54, 0.08, GUNMETAL, { at: [s * 0.74, 1.02, 2.62] }, 'metal');
    b.glow(new THREE.BoxGeometry(0.32, 0.12, 0.06), '#fff1c1', 3.2, { at: [s * 0.64, 1.08, 2.52] });
    b.glow(new THREE.BoxGeometry(0.24, 0.1, 0.06), '#ff3b30', 2.6, { at: [s * 0.86, 1.12, -2.54] });
    // Flared desert fenders + fender bolt lips
    b.box(0.28, 0.14, 1.12, SAND_DARK, { at: [s * 1.14, 1.18, 1.58] }, 'armor');
    b.box(0.28, 0.14, 1.12, SAND_DARK, { at: [s * 1.14, 1.22, -1.48] }, 'armor');
    // Visible desert coilover suspension shocks inside wheel arches
    b.cyl(0.055, 0.055, 0.52, 10, SPRING_YELLOW, { at: [s * 0.96, 0.9, 1.58], rot: [0, 0, s * 0.24] }, 'armor');
    b.cyl(0.055, 0.055, 0.52, 10, SPRING_YELLOW, { at: [s * 0.96, 0.92, -1.48], rot: [0, 0, s * 0.22] }, 'armor');
    // Twin forward hood bumper MGs with flash hiders
    b.cyl(0.045, 0.055, 0.95, 10, STEEL, { at: [s * 0.54, 1.28, 2.28], rot: ALONG_Z }, 'metal');
    b.cyl(0.062, 0.052, 0.12, 10, GUNMETAL, { at: [s * 0.54, 1.28, 2.74], rot: ALONG_Z }, 'metal');
    // Side wing mirrors
    b.box(0.22, 0.12, 0.06, GUNMETAL, { at: [s * 1.12, 1.52, 0.52] }, 'metal');
  }
  // Open-air armored cockpit tub, interior dashboard, steering wheel & twin bucket seats
  b.box(1.96, 0.56, 1.45, SAND_LIGHT, { at: [0, 1.12, -0.05] }, 'armor');
  b.box(1.68, 0.36, 0.34, '#20252b', { at: [0, 1.42, 0.44] }, 'carbon'); // dashboard cowl
  b.glow(new THREE.BoxGeometry(0.42, 0.1, 0.04), '#38e8ff', 2.2, { at: [0.42, 1.46, 0.28] }); // digital cluster
  b.cyl(0.032, 0.032, 0.28, 8, STEEL, { at: [0.42, 1.46, 0.38], rot: [1.15, 0, 0] }, 'metal'); // steering column
  b.solid(new THREE.TorusGeometry(0.16, 0.025, 8, 16), '#1d2126', { at: [0.42, 1.52, 0.28], rot: [-0.42, 0, 0] }, 'carbon', true); // steering wheel
  for (const sx of [-0.42, 0.42]) {
    b.box(0.46, 0.12, 0.48, '#23282f', { at: [sx, 1.26, -0.14] }, 'carbon'); // seat cushion
    b.box(0.44, 0.56, 0.12, '#23282f', { at: [sx, 1.56, -0.38], rot: [-0.14, 0, 0] }, 'carbon'); // backrest
  }
  for (const s of [-1, 1]) {
    // Rear roll-cage struts & diamond-plate side step bars
    b.cyl(0.055, 0.055, 1.05, 10, CHROME, { at: [s * 0.92, 1.74, -0.78], rot: [0.18, 0, 0] }, 'metal');
    b.cyl(0.05, 0.05, 1.72, 10, CHROME, { at: [s * 0.86, 1.82, -1.52], rot: [0.76, 0, 0] }, 'metal');
    b.box(0.18, 0.07, 1.75, STEEL, { at: [s * 1.1, 0.66, 0.05] }, 'metal');
  }
  // Rear truck bed + spare desert tire + jerrycan + ammo crate + twin nitro exhaust pipes
  b.box(1.94, 0.56, 1.75, SAND, { at: [0, 1.12, -1.65] }, 'armor');
  b.box(1.72, 0.14, 1.56, GUNMETAL, { at: [0, 0.94, -1.62] }, 'metal');
  b.box(0.24, 0.44, 0.34, '#a83228', { at: [-0.72, 1.24, -1.88] }, 'armor'); // red fuel jerrycan
  b.box(0.42, 0.3, 0.56, '#4c5b3f', { at: [0.64, 1.16, -1.85] }, 'armor'); // green ammo crate
  b.cyl(0.5, 0.5, 0.28, 18, TYRE, { at: [0, 1.32, -2.35], rot: [0.72, 0, 0] }, 'tread');
  b.cyl(0.28, 0.28, 0.31, 12, RIM, { at: [0, 1.32, -2.35], rot: [0.72, 0, 0] }, 'metal');
  for (const s of [-1, 1]) {
    b.cyl(0.07, 0.09, 0.65, 10, GUNMETAL, { at: [s * 0.56, 0.92, -2.52], rot: ALONG_Z }, 'metal');
  }
  // Turret ring mount on rear deck
  b.solid(new THREE.TorusGeometry(0.56, 0.07, 10, 22), GUNMETAL, { at: [0, 2.18, -0.78], rot: [Math.PI / 2, 0, 0] }, 'metal', true);
  body.add(b.build(materials));

  // Front windshield, A-pillars, roof rails & amber lightbar (hidden in 1P driver view for zero clipping)
  const fpB = new VehicleBuilder();
  fpB.box(1.78, 0.42, 0.08, GLASS, { at: [0, 1.66, 0.68], rot: [-0.42, 0, 0] }, 'canopy');
  fpB.box(1.84, 0.06, 0.1, GUNMETAL, { at: [0, 1.85, 0.59], rot: [-0.42, 0, 0] }, 'metal');
  for (const s of [-1, 1]) {
    fpB.cyl(0.055, 0.055, 1.05, 10, CHROME, { at: [s * 0.92, 1.72, 0.45], rot: [-0.38, 0, 0] }, 'metal');
    fpB.cyl(0.055, 0.055, 1.38, 10, CHROME, { at: [s * 0.92, 2.16, -0.18], rot: ALONG_Z }, 'metal');
  }
  fpB.cyl(0.055, 0.055, 1.84, 10, CHROME, { at: [0, 2.16, 0.46], rot: ALONG_X }, 'metal');
  fpB.cyl(0.055, 0.055, 1.84, 10, CHROME, { at: [0, 2.16, -0.82], rot: ALONG_X }, 'metal');
  fpB.glow(new THREE.BoxGeometry(1.36, 0.09, 0.1), '#ffbe3b', 3.4, { at: [0, 2.24, 0.46] });
  const fpHideGroup = fpB.build(materials);
  body.add(fpHideGroup);

  // Nitro boost exhaust flame cones (toggled when boosting)
  const boostGlow: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const fb = new ModelBuilder();
    fb.glow(new THREE.ConeGeometry(0.14, 0.85, 8), '#38e8ff', 4.5, { at: [0, 0, -0.4], rot: [-Math.PI / 2, 0, 0] });
    const g = materials.group(fb);
    g.position.set(s * 0.56, 0.92, -2.85);
    g.visible = false;
    body.add(g);
    boostGlow.push(g);
  }

  // Roof .50 Cal Rotary Turret (rotates independently!)
  const turret = new THREE.Group();
  turret.position.set(0, 2.22, -0.78);
  body.add(turret);
  const tb = new VehicleBuilder();
  tb.box(0.52, 0.44, 0.68, GUNMETAL, { at: [0, 0.26, 0] }, 'metal');
  tb.box(0.86, 0.52, 0.07, SAND_DARK, { at: [0, 0.36, 0.46], rot: [-0.22, 0, 0] }, 'armor'); // gun shield
  tb.box(0.28, 0.14, 0.09, GLASS, { at: [0, 0.5, 0.44], rot: [-0.22, 0, 0] }, 'canopy'); // armored gun-shield viewport
  tb.box(0.24, 0.26, 0.36, AMBER, { at: [0.38, 0.22, -0.05] }, 'armor'); // ammo drum
  // Dual spade handles at rear of receiver
  for (const s of [-1, 1]) {
    tb.cyl(0.022, 0.022, 0.22, 8, STEEL, { at: [s * 0.16, 0.22, -0.36] }, 'metal');
  }
  turret.add(tb.build(materials));

  const barrel = new THREE.Group();
  barrel.position.set(0, 0.32, 0.44);
  turret.add(barrel);
  const bb = new VehicleBuilder();
  // Triple-barrel rotary cluster + 40mm under-barrel grenade tube
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    bb.cyl(0.032, 0.034, 1.35, 10, STEEL, { at: [Math.cos(a) * 0.06, Math.sin(a) * 0.06, 0.66], rot: ALONG_Z }, 'metal');
  }
  bb.cyl(0.12, 0.12, 0.12, 12, GUNMETAL, { at: [0, 0, 1.05], rot: ALONG_Z }, 'metal');
  bb.cyl(0.11, 0.11, 0.08, 12, GUNMETAL, { at: [0, 0, 0.52], rot: ALONG_Z }, 'metal');
  bb.cyl(0.06, 0.065, 0.72, 10, AMBER, { at: [0, -0.14, 0.38], rot: ALONG_Z }, 'armor');
  barrel.add(bb.build(materials));

  // 4 Independent Big Off-Road Wheels
  const wheelsFront: THREE.Group[] = [];
  const wheelsRear: THREE.Group[] = [];
  const wRad = 0.56;
  const wWid = 0.42;
  for (const s of [-1, 1]) {
    const wf = makeWheelGroup(materials, wRad, wWid, AMBER);
    wf.position.set(s * 1.18, wRad, 1.58);
    root.add(wf);
    wheelsFront.push(wf);

    const wr = makeWheelGroup(materials, wRad * 1.06, wWid * 1.08, AMBER);
    wr.position.set(s * 1.2, wRad * 1.06, -1.48);
    root.add(wr);
    wheelsRear.push(wr);
  }

  // Visible co-op ready crew: Seat 0 seated driver inside open cab + Seat 1 roof gunner rotating with turret!
  const riders: RiderRig[] = [
    buildRiderRig(materials, { seatIndex: 0, parent: body, at: [0.42, 1.4, -0.16], posture: 'seated', scale: 0.96 }),
    buildRiderRig(materials, { seatIndex: 1, parent: turret, at: [0, -0.22, -0.84], posture: 'gunner', scale: 0.95 }),
  ];

  const mRoof = makeMarker(barrel, 0, 0, 1.42);
  const mCoax = makeMarker(body, 0, 1.28, 2.8);
  const mMain = makeMarker(body, 0, 1.08, 2.75);
  return {
    root,
    body,
    turret,
    barrel,
    barrelBaseZ: 0.44,
    subTurret: null,
    wheelsFront,
    wheelsRear,
    rotorMain: null,
    rotorTail: null,
    outriggers: [],
    boostGlow,
    resupplyRing: null,
    fpHideParts: [fpHideGroup],
    riders,
    muzzles: { main: mMain, coax: mCoax, podLeft: mMain, podRight: mMain, roof: mRoof, front: mMain, rear: mRoof },
    meshes: collectMeshes(root),
  };
}

// =================================================================================================
// 2. AEGIS — Main Battle Tank (65-ton Sloped Composite Hull + ERA Bricks + 120mm Recoiling Turret)
// =================================================================================================

function buildAegis(materials: ModelMaterials): VehicleModelRig {
  const OLIVE = '#4d5a46';
  const OLIVE_LIGHT = '#62715a';
  const OLIVE_DARK = '#364031';
  const AMBER = '#f59e0b';
  const OPTIC = '#38bdf8';

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const b = new VehicleBuilder();
  // Sloped lower & upper glacis composite tank hull
  b.solid(hull([
    { z: -3.55, w: 1.75, top: 1.62, bottom: 0.56 },
    { z: -2.4, w: 1.88, top: 1.74, bottom: 0.52 },
    { z: 1.65, w: 1.88, top: 1.72, bottom: 0.52 },
    { z: 3.15, w: 1.76, top: 1.42, bottom: 0.62 },
    { z: 3.68, w: 1.56, top: 1.12, bottom: 0.88 },
  ]), OLIVE, {}, 'armor');
  // Reactive armor (ERA) side skirts, textured tracks & glacis bricks
  for (const s of [-1, 1]) {
    b.box(0.74, 0.86, 6.85, STEEL, { at: [s * 1.62, 0.54, -0.05] }, 'tread');
    b.box(0.18, 0.72, 6.95, OLIVE_DARK, { at: [s * 1.98, 0.96, -0.05] }, 'armor'); // side skirt
    for (let i = 0; i < 6; i++) {
      const z = -2.65 + i * 1.06;
      b.cyl(0.42, 0.42, 0.62, 16, GUNMETAL, { at: [s * 1.62, 0.42, z], rot: ALONG_X }, 'metal');
      b.cyl(0.22, 0.22, 0.68, 12, OLIVE_LIGHT, { at: [s * 1.62, 0.42, z], rot: ALONG_X }, 'armor');
      b.box(0.12, 0.46, 0.82, OLIVE_LIGHT, { at: [s * 2.06, 1.02, z] }, 'armor'); // ERA block
      b.box(0.14, 0.05, 0.78, OLIVE_DARK, { at: [s * 2.07, 1.24, z] }, 'metal'); // ERA mounting rail
    }
    // Front tow shackles, tow cable & armored headlights
    b.box(0.24, 0.24, 0.42, GUNMETAL, { at: [s * 1.15, 1.02, 3.68] }, 'metal');
    b.glow(new THREE.BoxGeometry(0.28, 0.14, 0.08), '#ffe9b0', 3.0, { at: [s * 1.38, 1.42, 3.22] });
    // Rear engine deck louvered vents & glowing turbine grilles
    b.box(0.95, 0.14, 1.65, STEEL, { at: [s * 0.72, 1.76, -2.35] }, 'metal');
    for (let v = 0; v < 4; v++) {
      b.box(0.84, 0.04, 0.16, '#14181c', { at: [s * 0.72, 1.84, -2.9 + v * 0.36] }, 'metal');
    }
    b.glow(new THREE.BoxGeometry(0.62, 0.22, 0.08), '#ff6b35', 2.4, { at: [s * 0.88, 1.22, -3.56] });
  }
  // Front hazard stripe & driver armored periscope visor
  b.box(2.8, 0.12, 0.06, AMBER, { at: [0, 1.34, 3.24], rot: [-0.36, 0, 0] }, 'armor');
  b.box(0.66, 0.16, 0.22, GUNMETAL, { at: [0, 1.74, 2.22] }, 'metal');
  b.glow(new THREE.BoxGeometry(0.56, 0.09, 0.08), OPTIC, 2.8, { at: [0, 1.74, 2.34] });
  body.add(b.build(materials));

  // Turbine overdrive rear glow
  const boostGlow: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const fb = new ModelBuilder();
    fb.glow(new THREE.ConeGeometry(0.24, 1.1, 8), '#ff8c38', 4.2, { at: [0, 0, -0.5], rot: [-Math.PI / 2, 0, 0] });
    const g = materials.group(fb);
    g.position.set(s * 0.88, 1.22, -3.65);
    g.visible = false;
    body.add(g);
    boostGlow.push(g);
  }

  // Heavy Composite Wedge Turret (360° independent slew!)
  const turret = new THREE.Group();
  turret.position.set(0, 1.78, -0.15);
  body.add(turret);
  const tb = new VehicleBuilder();
  tb.solid(hull([
    { z: -2.25, w: 1.42, top: 1.02, bottom: 0.02 },
    { z: -0.9, w: 1.68, top: 1.12, bottom: 0.02 },
    { z: 0.85, w: 1.56, top: 1.06, bottom: 0.02 },
    { z: 1.95, w: 0.96, top: 0.78, bottom: 0.12 },
  ]), OLIVE_LIGHT, {}, 'armor');
  // Turret bustle rack, stowage pack, smoke dischargers & glossy cyan thermal sight box
  tb.box(2.3, 0.45, 0.78, GUNMETAL, { at: [0, 0.62, -2.38] }, 'metal');
  tb.box(1.9, 0.32, 0.56, OLIVE_DARK, { at: [0, 0.66, -2.36] }, 'carbon');
  tb.box(0.56, 0.36, 0.62, STEEL, { at: [0.88, 1.16, 0.95] }, 'metal');
  tb.box(0.46, 0.24, 0.08, GLASS, { at: [0.88, 1.18, 1.24] }, 'canopy');
  tb.glow(new THREE.BoxGeometry(0.42, 0.14, 0.06), OPTIC, 3.2, { at: [0.88, 1.18, 1.29] });
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      tb.cyl(0.06, 0.06, 0.34, 10, GUNMETAL, { at: [s * 1.52, 0.84, 0.45 + k * 0.22], rot: [0.55, 0, s * -0.45] }, 'metal');
    }
    tb.box(0.08, 0.22, 1.85, AMBER, { at: [s * 1.68, 0.64, -0.35] }, 'armor');
  }
  // Antenna whips
  tb.cyl(0.02, 0.03, 2.2, 8, STEEL, { at: [1.15, 2.0, -1.85] }, 'metal');
  tb.cyl(0.02, 0.03, 1.8, 8, STEEL, { at: [-1.15, 1.8, -1.85] }, 'metal');
  turret.add(tb.build(materials));

  // Commander Cupola + 20mm AA Autocannon + TOW ATGM tube
  const subTurret = new THREE.Group();
  subTurret.position.set(-0.55, 1.14, -0.52);
  turret.add(subTurret);
  const sb = new VehicleBuilder();
  sb.cyl(0.48, 0.54, 0.32, 16, OLIVE_DARK, { at: [0, 0.16, 0] }, 'armor');
  sb.box(0.32, 0.26, 0.56, GUNMETAL, { at: [0, 0.44, 0.1] }, 'metal');
  sb.cyl(0.045, 0.055, 1.45, 10, STEEL, { at: [0, 0.46, 0.92], rot: ALONG_Z }, 'metal');
  sb.cyl(0.11, 0.11, 1.05, 12, OLIVE, { at: [0.34, 0.52, 0.25], rot: ALONG_Z }, 'armor'); // TOW launcher
  subTurret.add(sb.build(materials));

  // 120mm Smoothbore Main Cannon (elevates & recoils inside turret!)
  const barrel = new THREE.Group();
  barrel.position.set(0, 0.58, 1.65);
  turret.add(barrel);
  const bb = new VehicleBuilder();
  bb.box(0.86, 0.54, 0.62, GUNMETAL, { at: [0, 0, 0.1] }, 'metal'); // mantlet
  bb.cyl(0.11, 0.14, 4.9, 16, OLIVE_DARK, { at: [0, 0, 2.55], rot: ALONG_Z }, 'metal');
  bb.cyl(0.19, 0.19, 0.82, 16, GUNMETAL, { at: [0, 0, 2.1], rot: ALONG_Z }, 'armor'); // bore evacuator
  bb.box(0.3, 0.28, 0.52, STEEL, { at: [0, 0, 4.95] }, 'metal'); // muzzle brake
  bb.cyl(0.032, 0.035, 1.25, 10, STEEL, { at: [0.46, 0.04, 0.85], rot: ALONG_Z }, 'metal'); // coax barrel
  barrel.add(bb.build(materials));

  // Seat 1 commander peeking from cupola hatch when manned
  const riders: RiderRig[] = [
    buildRiderRig(materials, { seatIndex: 1, parent: subTurret, at: [0, 0.04, -0.26], posture: 'cockpit', scale: 0.88 }),
  ];

  const mMain = makeMarker(barrel, 0, 0, 5.25);
  const mCoax = makeMarker(barrel, 0.46, 0.04, 1.5);
  const mRoof = makeMarker(subTurret, 0, 0.46, 1.7);
  return {
    root,
    body,
    turret,
    barrel,
    barrelBaseZ: 1.65,
    subTurret,
    wheelsFront: [],
    wheelsRear: [],
    rotorMain: null,
    rotorTail: null,
    outriggers: [],
    boostGlow,
    resupplyRing: null,
    riders,
    muzzles: { main: mMain, coax: mCoax, podLeft: mMain, podRight: mMain, roof: mRoof, front: mMain, rear: mRoof },
    meshes: collectMeshes(root),
    fpHideParts: [turret, barrel],
  };
}

// =================================================================================================
// 3. KESTREL — Twin-Turbine Attack Gunship (Stealth Charcoal + Crimson Stripes + Hydra Pods + Chin Gun)
// =================================================================================================

function buildKestrel(materials: ModelMaterials): VehicleModelRig {
  const CHARCOAL = '#282f37';
  const SLATE = '#3e4854';
  const CRIMSON = '#dc2626';
  const CANOPY = '#9c7830';
  const OPTIC = '#38e8ff';

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const b = new VehicleBuilder();
  // Sleek stealth tandem-cockpit fuselage
  b.solid(hull([
    { z: -6.8, w: 0.24, top: 1.85, bottom: 1.35 },
    { z: -3.2, w: 0.56, top: 2.05, bottom: 1.12 },
    { z: -1.4, w: 1.05, top: 2.48, bottom: 0.72 },
    { z: 1.5, w: 0.96, top: 2.38, bottom: 0.68 },
    { z: 3.1, w: 0.64, top: 1.65, bottom: 0.74 },
    { z: 4.15, w: 0.34, top: 1.18, bottom: 0.84 },
  ]), CHARCOAL, {}, 'armor');
  // Glossy armored golden-tint stepped tandem canopy + canopy frame bows
  b.solid(hull([
    { z: 0.25, w: 0.68, top: 2.62, bottom: 1.95 },
    { z: 1.75, w: 0.62, top: 2.48, bottom: 1.78 },
    { z: 2.95, w: 0.44, top: 1.72, bottom: 1.32 },
  ]), CANOPY, {}, 'canopy');
  b.box(1.28, 0.06, 0.08, STEEL, { at: [0, 2.48, 1.72] }, 'metal'); // canopy frame bow
  b.box(0.06, 0.07, 2.6, STEEL, { at: [0, 2.52, 1.48], rot: [0.22, 0, 0] }, 'metal'); // spine bow
  // Nose TADS thermal targeting turret ball
  b.box(0.54, 0.46, 0.52, STEEL, { at: [0, 1.02, 4.18] }, 'metal');
  b.glow(new THREE.CircleGeometry(0.14, 12), OPTIC, 3.4, { at: [0, 1.02, 4.46] });
  // Twin turbine engine nacelles, intakes, weapon wings & crimson stripes
  for (const s of [-1, 1]) {
    b.solid(hull([
      { z: -2.0, w: 0.42, top: 2.52, bottom: 1.78 },
      { z: 0.75, w: 0.46, top: 2.56, bottom: 1.76 },
    ]), SLATE, { at: [s * 1.15, 0, 0] }, 'armor');
    b.cyl(0.28, 0.28, 0.14, 14, '#111519', { at: [s * 1.15, 2.16, 0.78], rot: ALONG_Z }, 'metal'); // intake mouth
    b.box(0.14, 0.22, 3.2, CRIMSON, { at: [s * 1.06, 1.52, 0.35] }, 'armor');
    // Swept stub weapon wings
    b.box(2.35, 0.18, 1.28, SLATE, { at: [s * 2.15, 1.48, 0.45], rot: [0, s * -0.14, s * -0.1] }, 'armor');
    // 70mm Hydra 19-tube Rocket Pods + dual Hellfire rails on wingtips
    b.cyl(0.32, 0.34, 1.85, 16, GUNMETAL, { at: [s * 2.25, 1.16, 0.62], rot: ALONG_Z }, 'metal');
    b.glow(new THREE.CircleGeometry(0.24, 12), '#ff9e3b', 2.2, { at: [s * 2.25, 1.16, 1.56] });
    b.cyl(0.12, 0.12, 1.95, 10, CRIMSON, { at: [s * 3.15, 1.16, 0.55], rot: ALONG_Z }, 'armor');
    // Landing skids / rugged gear struts
    b.cyl(0.06, 0.06, 4.2, 10, STEEL, { at: [s * 1.25, 0.12, 0.2], rot: ALONG_Z }, 'metal');
    b.box(0.08, 0.72, 0.12, STEEL, { at: [s * 1.05, 0.42, 1.25], rot: [0, 0, s * 0.35] }, 'metal');
    b.box(0.08, 0.72, 0.12, STEEL, { at: [s * 1.05, 0.42, -0.85], rot: [0, 0, s * 0.35] }, 'metal');
  }
  // Vertical tail fin & horizontal stabilizers
  b.box(0.18, 2.2, 1.25, CHARCOAL, { at: [0, 2.38, -6.4], rot: [-0.26, 0, 0] }, 'armor');
  b.box(0.2, 0.48, 1.18, CRIMSON, { at: [0, 3.08, -6.58], rot: [-0.26, 0, 0] }, 'armor');
  b.box(2.6, 0.12, 0.68, SLATE, { at: [0, 1.72, -5.85] }, 'armor');
  // Rotor mast housing & swashplate collar
  b.cyl(0.24, 0.36, 0.72, 14, GUNMETAL, { at: [0, 2.86, 0.15] }, 'metal');
  b.cyl(0.42, 0.42, 0.1, 14, CHROME, { at: [0, 3.06, 0.15] }, 'metal');
  body.add(b.build(materials));

  // Twin rear turbine afterburner glows
  const boostGlow: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const fb = new ModelBuilder();
    fb.glow(new THREE.ConeGeometry(0.24, 1.35, 8), '#ff7b2e', 4.4, { at: [0, 0, -0.6], rot: [-Math.PI / 2, 0, 0] });
    const g = materials.group(fb);
    g.position.set(s * 1.15, 2.14, -2.12);
    g.visible = false;
    body.add(g);
    boostGlow.push(g);
  }

  // Spinning 4-blade Main Rotor
  const rotorMain = new THREE.Group();
  rotorMain.position.set(0, 3.24, 0.15);
  body.add(rotorMain);
  const mb = new VehicleBuilder();
  mb.cyl(0.36, 0.36, 0.2, 14, STEEL, {}, 'metal');
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    mb.box(0.34, 0.04, 6.2, GUNMETAL, { at: [Math.sin(a) * 3.1, 0, Math.cos(a) * 3.1], rot: [0, a, 0] }, 'carbon');
    mb.box(0.35, 0.045, 0.45, CRIMSON, { at: [Math.sin(a) * 5.95, 0, Math.cos(a) * 5.95], rot: [0, a, 0] }, 'armor');
  }
  rotorMain.add(mb.build(materials));

  // Spinning Tail Rotor
  const rotorTail = new THREE.Group();
  rotorTail.position.set(0.28, 2.88, -6.58);
  body.add(rotorTail);
  const trb = new VehicleBuilder();
  trb.cyl(0.14, 0.14, 0.16, 10, STEEL, { rot: ALONG_X }, 'metal');
  trb.box(0.04, 2.1, 0.18, GUNMETAL, {}, 'carbon');
  trb.box(0.04, 0.18, 2.1, GUNMETAL, {}, 'carbon');
  rotorTail.add(trb.build(materials));

  // Articulating Chin 30mm Chain Gun Turret
  const turret = new THREE.Group();
  turret.position.set(0, 0.64, 3.22);
  body.add(turret);
  const barrel = new THREE.Group();
  turret.add(barrel);
  const cb = new VehicleBuilder();
  cb.box(0.36, 0.32, 0.56, GUNMETAL, { at: [0, -0.1, 0] }, 'metal');
  cb.cyl(0.055, 0.068, 1.65, 10, STEEL, { at: [0, -0.14, 0.95], rot: ALONG_Z }, 'metal');
  barrel.add(cb.build(materials));

  // Tandem cockpit pilot + gunner silhouettes
  const riders: RiderRig[] = [
    buildRiderRig(materials, { seatIndex: 0, parent: body, at: [0, 1.95, 0.98], posture: 'cockpit', scale: 0.82 }),
    buildRiderRig(materials, { seatIndex: 1, parent: body, at: [0, 1.66, 2.12], posture: 'cockpit', scale: 0.78 }),
  ];

  const mMain = makeMarker(barrel, 0, -0.14, 1.85);
  const mPodLeft = makeMarker(body, 2.25, 1.16, 1.75);
  const mPodRight = makeMarker(body, -2.25, 1.16, 1.75);
  return {
    root,
    body,
    turret,
    barrel,
    barrelBaseZ: 0,
    subTurret: null,
    wheelsFront: [],
    wheelsRear: [],
    rotorMain,
    rotorTail,
    outriggers: [],
    boostGlow,
    resupplyRing: null,
    riders,
    muzzles: { main: mMain, coax: mMain, podLeft: mPodLeft, podRight: mPodRight, roof: mMain, front: mMain, rear: mMain },
    meshes: collectMeshes(root),
    fpHideParts: [turret],
  };
}

// =================================================================================================
// 4. VIPER — Repulsor Jet-Skiff (Burnt Crimson + Carbon + Cyan Repulsor Rings + Twin Jet Intakes)
// =================================================================================================

function buildViper(materials: ModelMaterials): VehicleModelRig {
  const CRIMSON = '#b91c1c';
  const CRIMSON_BRIGHT = '#ef4444';
  const CARBON = '#1f252d';
  const TITANIUM = '#94a3b8';
  const CYAN = '#38e8ff';

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const b = new VehicleBuilder();
  // Razor-sleek aerodynamic jet-bike fairing lofted from jet tail to needle nose
  b.solid(hull([
    { z: -2.05, w: 0.42, top: 0.96, bottom: 0.44 },
    { z: -0.95, w: 0.56, top: 1.06, bottom: 0.38 },
    { z: 0.45, w: 0.64, top: 1.18, bottom: 0.36 },
    { z: 1.55, w: 0.52, top: 0.98, bottom: 0.46 },
    { z: 2.38, w: 0.22, top: 0.68, bottom: 0.52 },
  ]), CRIMSON, {}, 'armor');
  // Woven carbon spine saddle + glossy sculpted windscreen + HUD dash + twin handlebars
  b.box(0.46, 0.22, 1.42, CARBON, { at: [0, 1.06, -0.58] }, 'carbon');
  b.box(0.52, 0.32, 0.58, GLASS, { at: [0, 1.24, 0.78], rot: [-0.62, 0, 0] }, 'canopy');
  b.glow(new THREE.BoxGeometry(0.28, 0.06, 0.04), CYAN, 2.8, { at: [0, 1.22, 0.54] });
  for (const s of [-1, 1]) {
    // Swept forward stabilization outrigger fins + twin 20mm pulse blasters
    b.solid(hull([
      { z: -1.35, w: 0.2, top: 0.78, bottom: 0.42 },
      { z: 0.65, w: 0.22, top: 0.82, bottom: 0.36 },
      { z: 2.08, w: 0.14, top: 0.68, bottom: 0.48 },
    ]), CARBON, { at: [s * 0.72, 0, 0] }, 'carbon');
    b.box(0.08, 0.1, 2.55, CRIMSON_BRIGHT, { at: [s * 0.88, 0.66, 0.35] }, 'armor');
    b.cyl(0.055, 0.065, 1.15, 12, TITANIUM, { at: [s * 0.72, 0.64, 2.12], rot: ALONG_Z }, 'metal');
    b.glow(new THREE.CircleGeometry(0.06, 10), CYAN, 3.8, { at: [s * 0.72, 0.64, 2.71] });
    // Handlebar grips & foot stirrups
    b.cyl(0.032, 0.032, 0.46, 10, TITANIUM, { at: [s * 0.36, 1.16, 0.36], rot: [0, s * -0.32, Math.PI / 2] }, 'metal');
    b.box(0.18, 0.05, 0.32, TITANIUM, { at: [s * 0.44, 0.62, -0.05] }, 'metal');
    // Swept rear twin stabilizer tailfins
    b.box(0.07, 0.56, 0.86, CRIMSON_BRIGHT, { at: [s * 0.56, 1.08, -1.65], rot: [-0.35, 0, s * -0.28] }, 'armor');
    // Rear twin jet thruster nozzles
    b.cyl(0.18, 0.22, 0.48, 14, TITANIUM, { at: [s * 0.26, 0.68, -2.14], rot: ALONG_Z }, 'metal');
    b.glow(new THREE.CircleGeometry(0.16, 12), CYAN, 3.6, { at: [s * 0.26, 0.68, -2.39], rot: [0, Math.PI, 0] });
  }
  // Glowing cyan underside repulsor levitation rings (front & rear)
  b.glow(new THREE.TorusGeometry(0.46, 0.055, 8, 20), CYAN, 3.8, { at: [0, 0.34, 1.08], rot: [Math.PI / 2, 0, 0] });
  b.glow(new THREE.TorusGeometry(0.44, 0.055, 8, 20), CYAN, 3.8, { at: [0, 0.34, -1.05], rot: [Math.PI / 2, 0, 0] });
  b.glow(new THREE.BoxGeometry(0.36, 0.09, 0.08), '#ffffff', 3.6, { at: [0, 0.74, 2.34] });
  body.add(b.build(materials));

  // Mach boost afterburner plumes
  const boostGlow: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const fb = new ModelBuilder();
    fb.glow(new THREE.ConeGeometry(0.18, 1.65, 8), CYAN, 4.8, { at: [0, 0, -0.8], rot: [-Math.PI / 2, 0, 0] });
    const g = materials.group(fb);
    g.position.set(s * 0.26, 0.68, -2.36);
    g.visible = false;
    body.add(g);
    boostGlow.push(g);
  }

  // 2 visible riders: Pilot straddling the hover-bike + rear pillion gunner!
  const riders: RiderRig[] = [
    buildRiderRig(materials, { seatIndex: 0, parent: body, at: [0, 1.14, -0.24], posture: 'straddle' }),
    buildRiderRig(materials, { seatIndex: 1, parent: body, at: [0, 1.17, -0.86], posture: 'pillion' }),
  ];

  const mMain = makeMarker(body, 0, 0.64, 2.75);
  const mRear = makeMarker(body, 0, 1.38, -1.25);
  return {
    root,
    body,
    turret: null,
    barrel: null,
    barrelBaseZ: 0,
    subTurret: null,
    wheelsFront: [],
    wheelsRear: [],
    rotorMain: null,
    rotorTail: null,
    outriggers: [],
    boostGlow,
    resupplyRing: null,
    riders,
    muzzles: { main: mMain, coax: mMain, podLeft: mMain, podRight: mMain, roof: mMain, front: mMain, rear: mRear },
    meshes: collectMeshes(root),
  };
}

// =================================================================================================
// 5. BASTION — 6×6 Armored Guntruck (Ochre + Steel V-Plow + 4 Hydraulic Outriggers + Twin Turrets)
// =================================================================================================

function buildBastion(materials: ModelMaterials): VehicleModelRig {
  const OCHRE = '#a1824d';
  const OCHRE_DARK = '#725a32';
  const PLATE = '#384048';
  const HAZARD = '#eab308';
  const GREEN = '#22c55e';

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const b = new VehicleBuilder();
  // Massive 6x6 ladder chassis & armored belly
  b.box(2.4, 0.42, 7.6, STEEL, { at: [0, 0.86, 0] }, 'metal');
  // Sloped armored engine bonnet & heavy cab
  b.solid(hull([
    { z: 0.9, w: 1.48, top: 2.78, bottom: 1.02 },
    { z: 2.45, w: 1.46, top: 2.66, bottom: 1.02 },
    { z: 3.1, w: 1.38, top: 2.02, bottom: 1.02 },
    { z: 4.1, w: 1.26, top: 1.78, bottom: 1.02 },
  ]), OCHRE, {}, 'armor');
  // Armored engine hood louvers
  for (let i = 0; i < 4; i++) {
    b.box(1.56, 0.05, 0.14, STEEL, { at: [0, 1.94 - i * 0.04, 3.16 + i * 0.22], rot: [0.22, 0, 0] }, 'metal');
  }
  // Massive welded V-shaped steel Ramming Plow at the nose!
  b.box(1.75, 1.05, 0.24, PLATE, { at: [0.8, 0.96, 4.35], rot: [0.18, -0.34, 0] }, 'metal');
  b.box(1.75, 1.05, 0.24, PLATE, { at: [-0.8, 0.96, 4.35], rot: [0.18, 0.34, 0] }, 'metal');
  b.box(0.32, 1.1, 0.34, HAZARD, { at: [0, 0.98, 4.62], rot: [0.18, 0, 0] }, 'armor');
  for (const s of [-1, 1]) {
    b.glow(new THREE.BoxGeometry(0.36, 0.16, 0.08), '#fff0b8', 3.2, { at: [s * 0.98, 1.56, 4.12] });
    // Heavy steel exhaust stacks behind cab
    b.cyl(0.11, 0.12, 2.15, 12, GUNMETAL, { at: [s * 1.56, 2.15, 0.65] }, 'metal');
    // Armored weapon deck side-walls + resupply medical/ammo lockers
    b.box(0.24, 1.35, 4.6, OCHRE_DARK, { at: [s * 1.48, 1.72, -1.65] }, 'armor');
    b.box(0.08, 0.24, 4.4, HAZARD, { at: [s * 1.62, 1.68, -1.65] }, 'armor');
    b.glow(new THREE.BoxGeometry(0.1, 0.42, 0.72), GREEN, 2.6, { at: [s * 1.62, 1.98, -0.65] });
    // Bumper twin HMGs
    b.cyl(0.05, 0.06, 1.0, 10, STEEL, { at: [s * 0.84, 1.48, 4.45], rot: ALONG_Z }, 'metal');
  }
  // Armored weapon deck floor & rear bulkhead
  b.box(2.85, 0.28, 4.7, PLATE, { at: [0, 1.24, -1.65] }, 'metal');
  b.box(2.96, 1.28, 0.28, OCHRE_DARK, { at: [0, 1.74, -3.98] }, 'armor');
  body.add(b.build(materials));

  // Slotted armored windshield visor + cab beacon (hidden in 1P so driver & gunner views never clip!)
  const fpB = new VehicleBuilder();
  fpB.box(2.38, 0.34, 0.1, GLASS, { at: [0, 2.34, 2.52], rot: [-0.26, 0, 0] }, 'canopy');
  for (let i = -2; i <= 2; i++) {
    fpB.box(0.06, 0.38, 0.14, PLATE, { at: [i * 0.48, 2.34, 2.56], rot: [-0.26, 0, 0] }, 'metal');
  }
  fpB.glow(new THREE.CylinderGeometry(0.18, 0.24, 0.22, 12), GREEN, 3.0, { at: [0, 2.94, 1.75] });
  const fpHideGroup = fpB.build(materials);
  body.add(fpHideGroup);

  // Boost exhaust glows
  const boostGlow: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const fb = new ModelBuilder();
    fb.glow(new THREE.ConeGeometry(0.2, 0.95, 8), '#ff9e3b', 4.0, { at: [0, 0.45, 0] });
    const g = materials.group(fb);
    g.position.set(s * 1.56, 3.24, 0.65);
    g.visible = false;
    body.add(g);
    boostGlow.push(g);
  }

  // 4 Animated Hydraulic Stabilizer Outriggers (swing out & lock to ground when Deployed via [Q]!)
  const outriggers: THREE.Group[] = [];
  const outriggerSpots: readonly (readonly [number, number])[] = [
    [1.58, 1.85], [-1.58, 1.85], [1.58, -3.15], [-1.58, -3.15],
  ];
  for (const [ox, oz] of outriggerSpots) {
    const side = Math.sign(ox);
    const og = new THREE.Group();
    og.position.set(ox, 1.02, oz);
    const ob = new VehicleBuilder();
    ob.box(0.86, 0.22, 0.34, HAZARD, { at: [side * 0.42, 0, 0] }, 'armor');
    ob.box(0.28, 1.12, 0.32, GUNMETAL, { at: [side * 0.86, -0.45, 0] }, 'metal');
    ob.box(0.56, 0.14, 0.56, STEEL, { at: [side * 0.86, -1.0, 0] }, 'metal');
    og.add(ob.build(materials));
    og.rotation.z = side * 1.15;
    body.add(og);
    outriggers.push(og);
  }

  // Glowing ground resupply aura ring (visible when Deployed via [Q])
  const ringGeo = new THREE.RingGeometry(13.2, 14.0, 48);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x22c55e,
    transparent: true,
    opacity: 0.42,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const resupplyRing = new THREE.Mesh(ringGeo, ringMat);
  resupplyRing.position.set(0, 0.12, 0);
  resupplyRing.visible = false;
  root.add(resupplyRing);

  // Front Twin 20mm Vulcan Turret (over cab roof)
  const turret = new THREE.Group();
  turret.position.set(0, 2.86, 1.05);
  body.add(turret);
  const tb = new VehicleBuilder();
  tb.cyl(0.66, 0.74, 0.36, 16, PLATE, { at: [0, 0.18, 0] }, 'metal');
  tb.box(0.92, 0.52, 0.84, OCHRE, { at: [0, 0.54, 0] }, 'armor');
  turret.add(tb.build(materials));

  const barrel = new THREE.Group();
  barrel.position.set(0, 0.56, 0.48);
  turret.add(barrel);
  const bb = new VehicleBuilder();
  for (const s of [-1, 1]) {
    bb.cyl(0.085, 0.095, 1.65, 12, STEEL, { at: [s * 0.34, 0, 0.82], rot: ALONG_Z }, 'metal');
    bb.cyl(0.11, 0.11, 0.16, 12, HAZARD, { at: [s * 0.34, 0, 1.38], rot: ALONG_Z }, 'armor');
  }
  barrel.add(bb.build(materials));

  // Rear Quad 35mm Flak / Siege Mortar Turret (in armored bed)
  const subTurret = new THREE.Group();
  subTurret.position.set(0, 2.15, -2.15);
  body.add(subTurret);
  const sb = new VehicleBuilder();
  sb.cyl(0.82, 0.92, 0.45, 16, PLATE, { at: [0, 0.22, 0] }, 'metal');
  sb.box(1.18, 0.64, 1.05, OCHRE_DARK, { at: [0, 0.68, -0.05] }, 'armor');
  for (const sx of [-0.34, 0.34]) {
    for (const sy of [-0.14, 0.16]) {
      sb.cyl(0.055, 0.068, 2.15, 10, STEEL, { at: [sx, 0.72 + sy, 1.35], rot: ALONG_Z }, 'metal');
    }
  }
  sb.cyl(0.16, 0.18, 1.35, 12, HAZARD, { at: [0, 1.12, 0.55], rot: [Math.PI / 2 - 0.38, 0, 0] }, 'armor');
  subTurret.add(sb.build(materials));

  // 6 Heavy 6×6 Armored Wheels
  const wheelsFront: THREE.Group[] = [];
  const wheelsRear: THREE.Group[] = [];
  const wRad = 0.68;
  const wWid = 0.48;
  for (const s of [-1, 1]) {
    const wf = makeWheelGroup(materials, wRad, wWid, OCHRE_DARK);
    wf.position.set(s * 1.48, wRad, 2.65);
    root.add(wf);
    wheelsFront.push(wf);

    for (const rz of [-1.25, -2.85]) {
      const wr = makeWheelGroup(materials, wRad, wWid, OCHRE_DARK);
      wr.position.set(s * 1.48, wRad, rz);
      root.add(wr);
      wheelsRear.push(wr);
    }
  }

  // Rear deck flak gunner visible behind the armored flak mount when Seat 2 is manned!
  const riders: RiderRig[] = [
    buildRiderRig(materials, { seatIndex: 2, parent: subTurret, at: [0, 0.16, -0.92], posture: 'gunner', scale: 0.94 }),
  ];

  const mFront = makeMarker(barrel, 0, 0, 1.72);
  const mRear = makeMarker(subTurret, 0, 0.72, 2.55);
  const mCoax = makeMarker(body, 0, 1.48, 4.95);
  return {
    root,
    body,
    turret,
    barrel,
    barrelBaseZ: 0.48,
    subTurret,
    wheelsFront,
    wheelsRear,
    rotorMain: null,
    rotorTail: null,
    outriggers,
    boostGlow,
    resupplyRing,
    fpHideParts: [fpHideGroup],
    riders,
    muzzles: { main: mCoax, coax: mCoax, podLeft: mFront, podRight: mFront, roof: mFront, front: mFront, rear: mRear },
    meshes: collectMeshes(root),
  };
}

// =============================================================================
// 6. NOMAD — Unarmed 4WD Combat Quad ATV (Nimble Jumper + 2-Up Co-op Saddle!)
// =============================================================================
function buildQuad(materials: ModelMaterials): VehicleModelRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const b = new VehicleBuilder();
  const OLIVE = '#4d5d3d';
  const TAN = '#b69c6d';
  const ACCENT = '#9cff57';

  // Rugged tubular chassis, bash skidplate, footboards & engine cooling block
  b.box(0.86, 0.24, 1.85, STEEL, { at: [0, 0.56, 0] }, 'metal');
  b.box(0.74, 0.14, 0.65, GUNMETAL, { at: [0, 0.48, 1.05], rot: [-0.42, 0, 0] }, 'metal');
  b.box(0.46, 0.28, 0.56, GUNMETAL, { at: [0, 0.62, 0.12] }, 'metal'); // V-twin engine casing
  b.box(1.16, 0.05, 0.62, STEEL, { at: [0, 0.48, -0.05] }, 'metal'); // diamond-plate footboards
  // Sculpted angular fenders, tank shroud & fuel cap
  b.box(1.18, 0.16, 0.82, OLIVE, { at: [0, 0.86, 0.68], rot: [0.1, 0, 0] }, 'armor');
  b.box(1.18, 0.16, 0.85, OLIVE, { at: [0, 0.88, -0.72], rot: [-0.08, 0, 0] }, 'armor');
  b.box(0.56, 0.34, 0.72, TAN, { at: [0, 0.96, 0.24] }, 'armor');
  b.cyl(0.055, 0.055, 0.04, 10, CHROME, { at: [0, 1.14, 0.34] }, 'metal'); // machined fuel cap
  // Two-up ribbed rider + rear passenger saddle + steel front/rear utility racks
  b.box(0.5, 0.18, 1.08, '#1f2328', { at: [0, 0.94, -0.45] }, 'carbon');
  b.box(0.92, 0.08, 0.42, STEEL, { at: [0, 1.02, -1.04] }, 'metal');
  b.box(0.84, 0.08, 0.34, STEEL, { at: [0, 1.0, 0.96] }, 'metal');
  b.box(0.88, 0.2, 0.07, GUNMETAL, { at: [0, 0.76, 1.14] }, 'metal'); // front bull-bar
  // Steering column, handlebars, grips, handguards & suspension A-arm shocks
  b.cyl(0.035, 0.04, 0.48, 10, STEEL, { at: [0, 1.12, 0.6], rot: [-0.32, 0, 0] }, 'metal');
  b.cyl(0.025, 0.025, 0.82, 10, CHROME, { at: [0, 1.28, 0.52], rot: ALONG_X }, 'metal');
  for (const s of [-1, 1]) {
    b.cyl(0.036, 0.036, 0.16, 10, '#181b20', { at: [s * 0.36, 1.28, 0.52], rot: ALONG_X }, 'carbon'); // handlebar grip
    b.box(0.14, 0.09, 0.05, OLIVE, { at: [s * 0.36, 1.29, 0.6], rot: [0, s * -0.18, 0] }, 'armor'); // handguard
    // Visible front & rear yellow coilover suspension shocks + lower control A-arms
    b.cyl(0.042, 0.042, 0.38, 10, SPRING_YELLOW, { at: [s * 0.52, 0.64, 0.76], rot: [0, 0, s * 0.32] }, 'armor');
    b.cyl(0.042, 0.042, 0.38, 10, SPRING_YELLOW, { at: [s * 0.52, 0.65, -0.76], rot: [0, 0, s * 0.3] }, 'armor');
    b.box(0.38, 0.05, 0.08, STEEL, { at: [s * 0.48, 0.44, 0.78] }, 'metal');
    b.glow(new THREE.BoxGeometry(0.18, 0.1, 0.06), '#f0ffe0', 3.4, { at: [s * 0.3, 0.92, 1.12] });
    b.glow(new THREE.BoxGeometry(0.14, 0.07, 0.05), '#ff3428', 2.4, { at: [s * 0.32, 0.92, -1.16] });
    // Twin rear exhaust cans + chrome tips
    b.cyl(0.055, 0.065, 0.46, 12, GUNMETAL, { at: [s * 0.24, 0.68, -1.02], rot: ALONG_Z }, 'metal');
    b.cyl(0.046, 0.046, 0.08, 10, CHROME, { at: [s * 0.24, 0.68, -1.26], rot: ALONG_Z }, 'metal');
  }
  b.glow(new THREE.BoxGeometry(0.24, 0.04, 0.04), ACCENT, 2.2, { at: [0, 1.14, 0.42] });
  body.add(b.build(materials));

  const boostGlow: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.11, 0.65, 8),
      new THREE.MeshBasicMaterial({ color: 0x9cff57, transparent: true, opacity: 0.85, toneMapped: false }),
    );
    flame.rotation.x = -Math.PI / 2;
    flame.position.set(s * 0.24, 0.68, -1.52);
    flame.visible = false;
    body.add(flame);
    boostGlow.push(flame);
  }

  // 4 chunky knobby ATV wheels
  const wheelsFront: THREE.Group[] = [];
  const wheelsRear: THREE.Group[] = [];
  const wRad = 0.38;
  for (const s of [-1, 1]) {
    const wf = makeWheelGroup(materials, wRad, 0.3, TAN);
    wf.position.set(s * 0.68, wRad, 0.78);
    root.add(wf);
    wheelsFront.push(wf);
    const wr = makeWheelGroup(materials, wRad * 1.05, 0.34, TAN);
    wr.position.set(s * 0.7, wRad * 1.05, -0.78);
    root.add(wr);
    wheelsRear.push(wr);
  }

  // Two-up co-op rider sockets: Seat 0 driver straddling handlebars + Seat 1 rear pillion gunner!
  const riders: RiderRig[] = [
    buildRiderRig(materials, { seatIndex: 0, parent: body, at: [0, 1.05, -0.08], posture: 'straddle' }),
    buildRiderRig(materials, { seatIndex: 1, parent: body, at: [0, 1.06, -0.66], posture: 'pillion' }),
  ];

  const mFront = makeMarker(body, 0, 1.0, 1.2);
  return {
    root,
    body,
    turret: null,
    barrel: null,
    barrelBaseZ: 0,
    subTurret: null,
    wheelsFront,
    wheelsRear,
    rotorMain: null,
    rotorTail: null,
    outriggers: [],
    boostGlow,
    resupplyRing: null,
    riders,
    muzzles: { main: mFront, coax: mFront, podLeft: mFront, podRight: mFront, roof: mFront, front: mFront, rear: mFront },
    meshes: collectMeshes(root),
  };
}

// =============================================================================
// 7. RAZOR — Unarmed Combat Dirtbike / Motorcycle (Deep Lean Banking + 2-Up Co-op!)
// =============================================================================
function buildMoto(materials: ModelMaterials): VehicleModelRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const b = new VehicleBuilder();
  const FAIRING = '#2b323c';
  const CRIMSON = '#e0355d';

  // Spine trellis frame, V-twin engine block with finned cylinder heads, fuel tank & front cowl
  b.box(0.32, 0.42, 0.78, GUNMETAL, { at: [0, 0.62, 0.05] }, 'metal');
  b.cyl(0.11, 0.11, 0.28, 12, '#48525d', { at: [0, 0.68, 0.22], rot: [0.42, 0, 0] }, 'metal'); // front V-twin cyl
  b.cyl(0.11, 0.11, 0.28, 12, '#48525d', { at: [0, 0.68, -0.06], rot: [-0.42, 0, 0] }, 'metal'); // rear V-twin cyl
  b.box(0.36, 0.26, 0.64, CRIMSON, { at: [0, 0.95, 0.25], rot: [-0.14, 0, 0] }, 'armor'); // sculpted fuel tank
  b.cyl(0.045, 0.045, 0.03, 10, CHROME, { at: [0, 1.09, 0.32] }, 'metal'); // tank cap
  b.box(0.34, 0.16, 0.88, '#1b1f25', { at: [0, 0.9, -0.44], rot: [0.06, 0, 0] }, 'carbon'); // woven two-up saddle
  b.box(0.32, 0.3, 0.52, FAIRING, { at: [0, 1.04, 0.76], rot: [-0.36, 0, 0] }, 'armor'); // aggressive nose cowl
  b.box(0.28, 0.24, 0.06, GLASS, { at: [0, 1.24, 0.76], rot: [-0.58, 0, 0] }, 'canopy'); // tinted fly-screen
  b.box(0.22, 0.07, 0.38, CRIMSON, { at: [0, 0.84, 0.92], rot: [-0.24, 0, 0] }, 'armor'); // front mudguard
  b.cyl(0.045, 0.045, 0.34, 10, SPRING_YELLOW, { at: [0, 0.64, -0.44], rot: [0.65, 0, 0] }, 'armor'); // rear mono-shock
  // Raked inverted telescopic front forks, swingarm, twin exhausts, footpegs & handlebars
  for (const s of [-1, 1]) {
    b.cyl(0.036, 0.032, 0.92, 12, CHROME, { at: [s * 0.14, 0.78, 0.78], rot: [0.42, 0, 0] }, 'metal');
    b.cyl(0.044, 0.044, 0.38, 12, SPRING_YELLOW, { at: [s * 0.14, 0.96, 0.68], rot: [0.42, 0, 0] }, 'armor'); // gold fork uppers
    b.box(0.05, 0.08, 0.72, GUNMETAL, { at: [s * 0.16, 0.44, -0.56] }, 'metal'); // rear swingarm
    b.cyl(0.045, 0.055, 0.62, 12, STEEL, { at: [s * 0.2, 0.64, -0.78], rot: [Math.PI / 2 - 0.18, 0, 0] }, 'metal');
    b.cyl(0.036, 0.036, 0.08, 10, CHROME, { at: [s * 0.2, 0.7, -1.09], rot: [Math.PI / 2 - 0.18, 0, 0] }, 'metal');
    // Rider & pillion footpegs
    b.cyl(0.02, 0.02, 0.14, 8, CHROME, { at: [s * 0.24, 0.46, 0.06], rot: ALONG_X }, 'metal');
    b.cyl(0.018, 0.018, 0.14, 8, CHROME, { at: [s * 0.24, 0.5, -0.46], rot: ALONG_X }, 'metal');
    // Handlebar grips
    b.cyl(0.03, 0.03, 0.15, 10, '#181b20', { at: [s * 0.32, 1.18, 0.56], rot: ALONG_X }, 'carbon');
  }
  b.cyl(0.022, 0.022, 0.74, 10, STEEL, { at: [0, 1.18, 0.56], rot: ALONG_X }, 'metal');
  b.glow(new THREE.BoxGeometry(0.2, 0.12, 0.06), '#fff4e0', 4.0, { at: [0, 1.02, 1.02] });
  b.glow(new THREE.BoxGeometry(0.18, 0.07, 0.05), '#ff2a4a', 2.8, { at: [0, 0.96, -0.92] });
  b.glow(new THREE.BoxGeometry(0.16, 0.04, 0.04), '#ff4f7a', 2.4, { at: [0, 1.14, 0.5] });
  body.add(b.build(materials));

  const boostGlow: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.09, 0.78, 8),
      new THREE.MeshBasicMaterial({ color: 0xff5a82, transparent: true, opacity: 0.9, toneMapped: false }),
    );
    flame.rotation.x = -Math.PI / 2;
    flame.position.set(s * 0.2, 0.7, -1.42);
    flame.visible = false;
    body.add(flame);
    boostGlow.push(flame);
  }

  // Front & rear oversized knobby motorcycle wheels (mounted on body so wheels lean WITH the bike!)
  const wf = makeWheelGroup(materials, 0.42, 0.18, CRIMSON);
  wf.position.set(0, 0.42, 0.96);
  body.add(wf);
  const wr = makeWheelGroup(materials, 0.42, 0.22, CRIMSON);
  wr.position.set(0, 0.42, -0.92);
  body.add(wr);

  // Two-up co-op rider sockets (mounted on `body` so BOTH riders lean into corners & wheelies!)
  const riders: RiderRig[] = [
    buildRiderRig(materials, { seatIndex: 0, parent: body, at: [0, 1.0, -0.06], posture: 'straddle' }),
    buildRiderRig(materials, { seatIndex: 1, parent: body, at: [0, 1.03, -0.62], posture: 'pillion' }),
  ];

  const mFront = makeMarker(body, 0, 0.95, 1.1);
  return {
    root,
    body,
    turret: null,
    barrel: null,
    barrelBaseZ: 0,
    subTurret: null,
    wheelsFront: [wf],
    wheelsRear: [wr],
    rotorMain: null,
    rotorTail: null,
    outriggers: [],
    boostGlow,
    resupplyRing: null,
    riders,
    muzzles: { main: mFront, coax: mFront, podLeft: mFront, podRight: mFront, roof: mFront, front: mFront, rear: mFront },
    meshes: collectMeshes(root),
  };
}

// =============================================================================
// 8. VALKYRIE — Pilotable Door-Gunner Utility Chopper (Reuses Packmule Airframe!)
// =============================================================================
function buildValkyrie(materials: ModelMaterials): VehicleModelRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 1.65;
  root.add(body);

  const hb = new ModelBuilder();
  UTILITY_AIRFRAME.build(hb);
  const hullGroup = materials.group(hb);
  upgradeModelToPbrArmor(hullGroup, materials, 'armor');
  body.add(hullGroup);

  // Main & tail rotors from UTILITY_AIRFRAME spec
  const rMainSpec = UTILITY_AIRFRAME.rotors[0]!;
  const rmb = new ModelBuilder();
  rMainSpec.build(rmb);
  const rotorMain = materials.group(rmb);
  upgradeModelToPbrArmor(rotorMain, materials, 'metal');
  rotorMain.position.set(rMainSpec.at[0], rMainSpec.at[1], rMainSpec.at[2]);
  body.add(rotorMain);

  const rTailSpec = UTILITY_AIRFRAME.rotors[1]!;
  const rtb = new ModelBuilder();
  rTailSpec.build(rtb);
  const rotorTail = materials.group(rtb);
  upgradeModelToPbrArmor(rotorTail, materials, 'metal');
  rotorTail.position.set(rTailSpec.at[0], rTailSpec.at[1], rTailSpec.at[2]);
  body.add(rotorTail);

  // Side door-gunner pintle frame & M134 minigun mount detail
  const db = new VehicleBuilder();
  db.cyl(0.04, 0.04, 0.62, 10, STEEL, { at: [1.34, -0.35, 0.2] }, 'metal');
  db.box(0.24, 0.2, 0.42, GUNMETAL, { at: [1.38, -0.08, 0.2] }, 'metal');
  db.cyl(0.05, 0.055, 0.92, 10, STEEL, { at: [1.72, -0.08, 0.2], rot: ALONG_X }, 'metal');
  body.add(db.build(materials));

  const boostGlow: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.18, 1.1, 8),
      new THREE.MeshBasicMaterial({ color: 0xff9c3b, transparent: true, opacity: 0.85, toneMapped: false }),
    );
    flame.rotation.x = -Math.PI / 2;
    flame.position.set(s * 0.62, 1.5, -2.7);
    flame.visible = false;
    body.add(flame);
    boostGlow.push(flame);
  }

  // Visible pilot + side door gunner!
  const riders: RiderRig[] = [
    buildRiderRig(materials, { seatIndex: 0, parent: body, at: [0.36, -0.18, 2.05], posture: 'cockpit', scale: 0.86 }),
    buildRiderRig(materials, { seatIndex: 1, parent: body, at: [0.92, -0.36, 0.2], posture: 'gunner', yawOffset: Math.PI / 2, scale: 0.9 }),
  ];

  const mDoor = makeMarker(body, 1.55, -0.1, 0.2);
  const mNose = makeMarker(body, 0, -0.2, 4.8);
  return {
    root,
    body,
    bodyBaseY: 1.65,
    turret: null,
    barrel: null,
    barrelBaseZ: 0,
    subTurret: null,
    wheelsFront: [],
    wheelsRear: [],
    rotorMain,
    rotorTail,
    outriggers: [],
    boostGlow,
    resupplyRing: null,
    riders,
    muzzles: { main: mNose, coax: mDoor, podLeft: mDoor, podRight: mDoor, roof: mDoor, front: mNose, rear: mDoor },
    meshes: collectMeshes(root),
  };
}

// =============================================================================
// 9. HARRIER — VTOL Jump-Jet Fighter (Swept Wings + Swivel Nozzles + Ordnance)
// =============================================================================
function buildHarrier(materials: ModelMaterials): VehicleModelRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 1.45;
  root.add(body);

  const b = new VehicleBuilder();
  const JET_GREY = '#4f5b67';
  const DARK_GREY = '#2c343d';
  const LIGHT_GREY = '#7a8895';

  // Sleek tapered fuselage + ejection seat headrest & cockpit glare-shield
  b.solid(hull([
    { z: -5.4, w: 0.24, top: 0.42, bottom: -0.22 },
    { z: -2.4, w: 0.78, top: 0.82, bottom: -0.58 },
    { z: 0.8, w: 0.94, top: 0.88, bottom: -0.66 },
    { z: 3.4, w: 0.68, top: 0.56, bottom: -0.52 },
    { z: 5.6, w: 0.14, top: -0.06, bottom: -0.28 },
  ]), JET_GREY, {}, 'armor');
  b.box(0.42, 0.54, 0.22, DARK_GREY, { at: [0, 0.92, 1.34], rot: [-0.15, 0, 0] }, 'carbon'); // ejection seat back
  b.box(0.24, 0.12, 0.16, '#eab308', { at: [0, 1.18, 1.32] }, 'armor'); // ejection headrest pull loop
  b.glow(new THREE.BoxGeometry(0.26, 0.1, 0.04), '#46ff9a', 2.4, { at: [0, 0.82, 2.52] }); // cockpit HUD glass

  // Bubble fighter canopy (tagged in separate group so 1P cockpit never clips glass!)
  const canopyB = new VehicleBuilder();
  canopyB.solid(hull([
    { z: 0.6, w: 0.56, top: 1.32, bottom: 0.78 },
    { z: 2.2, w: 0.52, top: 1.42, bottom: 0.68 },
    { z: 3.4, w: 0.34, top: 0.95, bottom: 0.45 },
  ]), GLASS, {}, 'canopy');
  canopyB.box(0.05, 0.06, 2.5, DARK_GREY, { at: [0, 1.36, 1.9], rot: [0.16, 0, 0] }, 'metal');
  canopyB.box(1.06, 0.06, 0.08, DARK_GREY, { at: [0, 1.34, 2.24] }, 'metal'); // front canopy arch
  const canopyGroup = canopyB.build(materials);
  body.add(canopyGroup);

  // Side Pegasus turbofan intakes, compressor fan faces & 4 vectored-thrust VTOL nozzles
  for (const s of [-1, 1]) {
    b.box(0.56, 0.92, 2.4, DARK_GREY, { at: [s * 0.98, 0.12, 1.1] }, 'armor');
    b.box(0.46, 0.78, 0.15, '#0d1014', { at: [s * 0.98, 0.12, 2.32] }, 'metal');
    b.cyl(0.2, 0.2, 0.06, 14, CHROME, { at: [s * 0.98, 0.12, 2.26], rot: ALONG_Z }, 'metal'); // turbofan spinner
    // High swept anhedral delta wings + flap actuator fairings
    b.box(4.2, 0.15, 2.4, JET_GREY, { at: [s * 2.55, 0.42, -0.35], rot: [0, s * -0.46, s * -0.14] }, 'armor');
    b.box(1.4, 0.12, 1.2, LIGHT_GREY, { at: [s * 4.55, 0.18, -1.55], rot: [0, s * -0.52, s * -0.16] }, 'armor');
    // Tailplanes
    b.box(1.9, 0.11, 1.1, JET_GREY, { at: [s * 1.1, 0.14, -4.6], rot: [0, s * -0.35, s * -0.12] }, 'armor');
    // Underwing ordnance pylons: Mk-82 bombs & Sidewinder missiles
    for (const wx of [1.85, 3.15]) {
      b.box(0.1, 0.28, 0.65, DARK_GREY, { at: [s * wx, 0.18, -0.35] }, 'metal');
      b.cyl(0.14, 0.14, 1.85, 12, '#3d4a35', { at: [s * wx, -0.04, -0.25], rot: ALONG_Z }, 'armor');
      b.solid(new THREE.ConeGeometry(0.14, 0.38, 12), '#e6c24a', { at: [s * wx, -0.04, 0.85], rot: ALONG_Z }, 'armor', true);
    }
    // Vectored nozzles (front + rear per side)
    for (const nz of [0.45, -1.25]) {
      b.cyl(0.22, 0.26, 0.42, 14, STEEL, { at: [s * 0.96, -0.32, nz], rot: [0.35, 0, s * 0.25] }, 'metal');
    }
    // Wingtip nav lights
    b.glow(new THREE.SphereGeometry(0.1, 8, 8), s > 0 ? '#ff2020' : '#24ff6a', 5, { at: [s * 5.2, 0.08, -1.9] });
  }
  // Vertical stabilizer fin + GAU-12 ventral gun pod
  b.box(0.16, 2.25, 1.85, JET_GREY, { at: [0, 1.48, -4.35], rot: [-0.32, 0, 0] }, 'armor');
  b.box(0.18, 0.45, 0.72, '#46ff9a', { at: [0, 2.42, -4.72] }, 'armor');
  b.cyl(0.16, 0.18, 2.2, 12, STEEL, { at: [0, -0.72, 1.45], rot: ALONG_Z }, 'metal');
  // Landing gear oleo struts + knobby tires
  b.box(0.14, 0.92, 0.16, STEEL, { at: [0, -0.95, 2.1] }, 'metal');
  b.box(0.16, 0.88, 0.22, STEEL, { at: [0, -0.92, -1.2] }, 'metal');
  b.cyl(0.24, 0.24, 0.18, 16, TYRE, { at: [0, -1.32, 2.1], rot: ALONG_X }, 'tread');
  b.cyl(0.28, 0.28, 0.24, 16, TYRE, { at: [0, -1.3, -1.2], rot: ALONG_X }, 'tread');
  b.cyl(0.12, 0.12, 0.2, 12, CHROME, { at: [0, -1.32, 2.1], rot: ALONG_X }, 'metal');
  b.cyl(0.15, 0.15, 0.26, 12, CHROME, { at: [0, -1.3, -1.2], rot: ALONG_X }, 'metal');
  body.add(b.build(materials));

  const boostGlow: THREE.Object3D[] = [];
  const vtolGlow: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const aft = new THREE.Mesh(
      new THREE.ConeGeometry(0.26, 2.6, 10),
      new THREE.MeshBasicMaterial({ color: 0x5ae8ff, transparent: true, opacity: 0.9, toneMapped: false }),
    );
    aft.rotation.x = -Math.PI / 2;
    aft.position.set(s * 0.92, -0.22, -2.7);
    aft.visible = false;
    body.add(aft);
    boostGlow.push(aft);

    for (const nz of [0.45, -1.25]) {
      const vt = new THREE.Mesh(
        new THREE.ConeGeometry(0.22, 1.65, 8),
        new THREE.MeshBasicMaterial({ color: 0xffa640, transparent: true, opacity: 0.82, toneMapped: false }),
      );
      vt.rotation.x = Math.PI;
      vt.position.set(s * 0.96, -1.18, nz);
      vt.visible = false;
      body.add(vt);
      vtolGlow.push(vt);
    }
  }

  // Visible pilot seated inside cockpit!
  const riders: RiderRig[] = [
    buildRiderRig(materials, { seatIndex: 0, parent: body, at: [0, 0.66, 1.82], posture: 'cockpit', scale: 0.8 }),
  ];

  const mNose = makeMarker(body, 0, -0.72, 3.2);
  const mLeft = makeMarker(body, 2.2, -0.25, 0.2);
  const mRight = makeMarker(body, -2.2, -0.25, 0.2);
  return {
    root,
    body,
    bodyBaseY: 1.45,
    turret: null,
    barrel: null,
    barrelBaseZ: 0,
    subTurret: null,
    wheelsFront: [],
    wheelsRear: [],
    rotorMain: null,
    rotorTail: null,
    outriggers: [],
    boostGlow,
    vtolGlow,
    resupplyRing: null,
    fpHideParts: [canopyGroup],
    riders,
    muzzles: { main: mNose, coax: mNose, podLeft: mLeft, podRight: mRight, roof: mNose, front: mNose, rear: mNose },
    meshes: collectMeshes(root),
  };
}

// =============================================================================
// 10. WARTHOG — Flyable A-10 Thunderbolt II (Reuses Iconic warthogModel + PBR Armor!)
// =============================================================================
function buildWarthog(materials: ModelMaterials): VehicleModelRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 1.65;
  root.add(body);

  const jet = warthogModel(materials);
  upgradeModelToPbrArmor(jet, materials, 'armor');
  jet.scale.setScalar(0.68);
  body.add(jet);

  // Textured PBR landing gear pods so it rests cleanly on the Badlands tarmac!
  const gb = new VehicleBuilder();
  gb.cyl(0.24, 0.24, 0.18, 16, TYRE, { at: [0, -1.42, 3.5], rot: ALONG_X }, 'tread');
  gb.cyl(0.12, 0.12, 0.2, 12, CHROME, { at: [0, -1.42, 3.5], rot: ALONG_X }, 'metal');
  for (const s of [-1, 1]) {
    gb.cyl(0.3, 0.3, 0.22, 16, TYRE, { at: [s * 1.8, -1.38, 0.3], rot: ALONG_X }, 'tread');
    gb.cyl(0.15, 0.15, 0.24, 12, CHROME, { at: [s * 1.8, -1.38, 0.3], rot: ALONG_X }, 'metal');
    gb.box(0.14, 0.72, 0.18, STEEL, { at: [s * 1.8, -1.0, 0.3] }, 'metal');
  }
  gb.box(0.14, 0.78, 0.16, STEEL, { at: [0, -1.04, 3.5] }, 'metal');
  body.add(gb.build(materials));

  const boostGlow: THREE.Object3D[] = [];
  const vtolGlow: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const aft = new THREE.Mesh(
      new THREE.ConeGeometry(0.32, 2.8, 10),
      new THREE.MeshBasicMaterial({ color: 0xff9b4a, transparent: true, opacity: 0.9, toneMapped: false }),
    );
    aft.rotation.x = -Math.PI / 2;
    aft.position.set(s * 0.98, 0.72, -5.1);
    aft.visible = false;
    body.add(aft);
    boostGlow.push(aft);

    const vt = new THREE.Mesh(
      new THREE.ConeGeometry(0.24, 1.6, 8),
      new THREE.MeshBasicMaterial({ color: 0xffa640, transparent: true, opacity: 0.78, toneMapped: false }),
    );
    vt.rotation.x = Math.PI;
    vt.position.set(s * 1.4, -0.95, 0.2);
    vt.visible = false;
    body.add(vt);
    vtolGlow.push(vt);
  }

  // Visible pilot inside A-10 titanium tub cockpit
  const riders: RiderRig[] = [
    buildRiderRig(materials, { seatIndex: 0, parent: body, at: [0, 0.36, 2.45], posture: 'cockpit', scale: 0.8 }),
  ];

  const mGun = makeMarker(body, 0.08, -0.22, 6.2);
  const mLeft = makeMarker(body, 2.8, -0.68, 0.6);
  const mRight = makeMarker(body, -2.8, -0.68, 0.6);
  return {
    root,
    body,
    bodyBaseY: 1.65,
    turret: null,
    barrel: null,
    barrelBaseZ: 0,
    subTurret: null,
    wheelsFront: [],
    wheelsRear: [],
    rotorMain: null,
    rotorTail: null,
    outriggers: [],
    boostGlow,
    vtolGlow,
    resupplyRing: null,
    fpHideParts: [jet],
    riders,
    muzzles: { main: mGun, coax: mGun, podLeft: mLeft, podRight: mRight, roof: mGun, front: mGun, rear: mGun },
    meshes: collectMeshes(root),
  };
}

// =============================================================================
// 11. RAPTOR — F-22 Stealth Air-Superiority Dogfighter (Chined Nose, Diamond Wings, Twin V-Tails, 2D Vector Nozzles)
// =============================================================================
function buildRaptor(materials: ModelMaterials): VehicleModelRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 1.42;
  root.add(body);

  const b = new VehicleBuilder();
  const RAM_BASE = '#4f5a66';
  const RAM_DARK = '#343d47';
  const RAM_LIGHT = '#758392';
  const GOLD_GLASS = '#7a5a1a';

  // Sleek chined stealth diamond fuselage (+Z nose to +6.45 m, wide twin-engine rear deck)
  b.solid(hull([
    { z: -4.9, w: 1.08, top: 0.54, bottom: -0.34 },
    { z: -2.2, w: 1.38, top: 0.68, bottom: -0.46 },
    { z: 0.9, w: 1.32, top: 0.72, bottom: -0.48 },
    { z: 3.6, w: 0.76, top: 0.44, bottom: -0.34 },
    { z: 5.4, w: 0.34, top: 0.12, bottom: -0.18 },
    { z: 6.45, w: 0.06, top: -0.02, bottom: -0.08 },
  ]), RAM_BASE, {}, 'armor');
  // Chined fuselage stealth bevel ridges & dorsal spine RAM panels
  b.box(1.55, 0.14, 5.4, RAM_DARK, { at: [0, 0.66, -1.5] }, 'armor');
  b.box(0.88, 0.1, 3.6, RAM_LIGHT, { at: [0, 0.72, -1.6] }, 'armor');
  b.box(0.42, 0.48, 0.22, RAM_DARK, { at: [0, 0.82, 1.55], rot: [-0.18, 0, 0] }, 'carbon'); // ejection seat
  b.glow(new THREE.BoxGeometry(0.28, 0.1, 0.04), '#38e8ff', 2.8, { at: [0, 0.74, 2.75] }); // stealth HUD glass

  // Frameless gold-tinted stealth bubble canopy (hidden in 1P cockpit!)
  const canopyB = new VehicleBuilder();
  canopyB.solid(hull([
    { z: 0.75, w: 0.56, top: 1.18, bottom: 0.68 },
    { z: 2.25, w: 0.52, top: 1.36, bottom: 0.58 },
    { z: 3.75, w: 0.32, top: 0.84, bottom: 0.38 },
  ]), GOLD_GLASS, {}, 'canopy');
  const canopyGroup = canopyB.build(materials);
  body.add(canopyGroup);

  for (const s of [-1, 1]) {
    // Angled stealth caret engine intakes
    b.box(0.74, 0.64, 2.85, RAM_DARK, { at: [s * 1.12, 0.04, 1.25], rot: [0, s * 0.14, s * 0.24] }, 'armor');
    b.box(0.62, 0.52, 0.14, '#0c0f13', { at: [s * 1.16, 0.04, 2.66], rot: [0, s * 0.22, s * 0.24] }, 'metal');
    // Signature F-22 diamond trapezoidal wings (swept-back LE + forward-swept TE)
    b.box(3.9, 0.12, 2.45, RAM_BASE, { at: [s * 2.55, 0.12, -0.55], rot: [0, s * 0.58, 0] }, 'armor');
    b.box(2.15, 0.1, 1.45, RAM_LIGHT, { at: [s * 3.72, 0.11, -1.55], rot: [0, s * -0.22, 0] }, 'armor');
    // Swept-back diamond horizontal stabilators
    b.box(2.1, 0.09, 1.22, RAM_DARK, { at: [s * 1.85, 0.06, -4.35], rot: [0, s * 0.52, 0] }, 'armor');
    // Signature canted outward twin V-tails (~26 deg cant)
    b.box(0.13, 2.1, 1.85, RAM_BASE, { at: [s * 1.32, 1.12, -3.75], rot: [-0.36, 0, s * -0.44] }, 'armor');
    b.box(0.14, 0.32, 0.85, '#38e8ff', { at: [s * 1.72, 1.98, -4.18], rot: [0, 0, s * -0.44] }, 'armor');
    // Wingtip nav lights
    b.glow(new THREE.SphereGeometry(0.09, 8, 8), s > 0 ? '#ff2020' : '#24ff6a', 4.8, { at: [s * 4.78, 0.12, -1.78] });
  }
  // Right-wing root internal 20mm M61A2 Vulcan gun port fairing
  b.box(0.24, 0.16, 1.45, STEEL, { at: [0.85, 0.36, 2.95] }, 'metal');
  body.add(b.build(materials));

  // Retractable tricycle landing gear (tucks away cleanly once airborne!)
  const gearB = new VehicleBuilder();
  gearB.box(0.12, 0.92, 0.14, STEEL, { at: [0, -0.9, 3.2] }, 'metal');
  gearB.cyl(0.22, 0.22, 0.16, 16, TYRE, { at: [0, -1.26, 3.2], rot: ALONG_X }, 'tread');
  gearB.cyl(0.11, 0.11, 0.18, 12, CHROME, { at: [0, -1.26, 3.2], rot: ALONG_X }, 'metal');
  for (const s of [-1, 1]) {
    gearB.box(0.14, 0.88, 0.16, STEEL, { at: [s * 1.32, -0.88, -1.2] }, 'metal');
    gearB.cyl(0.26, 0.26, 0.2, 16, TYRE, { at: [s * 1.32, -1.22, -1.2], rot: ALONG_X }, 'tread');
    gearB.cyl(0.13, 0.13, 0.22, 12, CHROME, { at: [s * 1.32, -1.22, -1.2], rot: ALONG_X }, 'metal');
  }
  const landingGear = gearB.build(materials);
  body.add(landingGear);

  // Animated 2D Rectangular Thrust-Vectoring Exhaust Nozzles + Twin Blue-White Afterburners!
  const nozzles: THREE.Group[] = [];
  const boostGlow: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const noz = new THREE.Group();
    noz.position.set(s * 0.56, 0.08, -4.95);
    const nb = new VehicleBuilder();
    nb.box(0.68, 0.42, 0.72, STEEL, { at: [0, 0, -0.22] }, 'metal');
    nb.box(0.56, 0.28, 0.18, '#151920', { at: [0, 0, -0.54] }, 'metal');
    nb.box(0.66, 0.08, 0.46, GUNMETAL, { at: [0, 0.21, -0.34] }, 'metal');
    nb.box(0.66, 0.08, 0.46, GUNMETAL, { at: [0, -0.21, -0.34] }, 'metal');
    noz.add(nb.build(materials));

    const aft = new THREE.Mesh(
      new THREE.ConeGeometry(0.28, 3.4, 10),
      new THREE.MeshBasicMaterial({ color: 0x4de8ff, transparent: true, opacity: 0.92, toneMapped: false }),
    );
    aft.rotation.x = -Math.PI / 2;
    aft.position.set(0, 0, -2.15);
    aft.visible = false;
    noz.add(aft);
    boostGlow.push(aft);

    body.add(noz);
    nozzles.push(noz);
  }

  const riders: RiderRig[] = [
    buildRiderRig(materials, { seatIndex: 0, parent: body, at: [0, 0.62, 2.08], posture: 'cockpit', scale: 0.8 }),
  ];

  const mGun = makeMarker(body, 0.85, 0.36, 4.2);
  const mLeft = makeMarker(body, 1.35, -0.35, 0.4);
  const mRight = makeMarker(body, -1.35, -0.35, 0.4);
  return {
    root,
    body,
    bodyBaseY: 1.42,
    turret: null,
    barrel: null,
    barrelBaseZ: 0,
    subTurret: null,
    wheelsFront: [],
    wheelsRear: [],
    rotorMain: null,
    rotorTail: null,
    outriggers: [],
    boostGlow,
    nozzles,
    landingGear,
    resupplyRing: null,
    fpHideParts: [canopyGroup],
    riders,
    muzzles: { main: mGun, coax: mGun, podLeft: mLeft, podRight: mRight, roof: mGun, front: mGun, rear: mGun },
    meshes: collectMeshes(root),
  };
}

// =============================================================================
// 12. HORNET — F/A-18E Super Hornet (Sweeping LEX Strakes, Rhino Intakes, Twin Canted Tails, Wingtip Rails)
// =============================================================================
function buildHornet(materials: ModelMaterials): VehicleModelRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 1.46;
  root.add(body);

  const b = new VehicleBuilder();
  const NAVY_TOP = '#7a8694';
  const NAVY_BOT = '#95a0ab';
  const NAVY_DARK = '#343c46';
  const SQN_GOLD = '#f4c430';

  // Sleek Super Hornet fuselage + black nose anti-glare strip
  b.solid(hull([
    { z: -4.8, w: 0.88, top: 0.56, bottom: -0.38 },
    { z: -1.8, w: 1.08, top: 0.72, bottom: -0.5 },
    { z: 1.4, w: 0.94, top: 0.72, bottom: -0.46 },
    { z: 3.9, w: 0.58, top: 0.38, bottom: -0.34 },
    { z: 6.1, w: 0.1, top: -0.02, bottom: -0.14 },
  ]), NAVY_TOP, {}, 'armor');
  b.box(0.56, 0.08, 2.2, NAVY_DARK, { at: [0, 0.46, 3.85], rot: [0.16, 0, 0] }, 'armor'); // nose anti-glare
  b.box(0.42, 0.5, 0.22, NAVY_DARK, { at: [0, 0.86, 1.55], rot: [-0.15, 0, 0] }, 'carbon'); // ejection seat
  b.glow(new THREE.BoxGeometry(0.26, 0.1, 0.04), '#6ec6ff', 2.6, { at: [0, 0.78, 2.7] });

  // Framed Naval aviator bubble canopy (hidden in 1P!)
  const canopyB = new VehicleBuilder();
  canopyB.solid(hull([
    { z: 0.65, w: 0.52, top: 1.24, bottom: 0.68 },
    { z: 2.25, w: 0.5, top: 1.38, bottom: 0.6 },
    { z: 3.55, w: 0.32, top: 0.88, bottom: 0.42 },
  ]), GLASS, {}, 'canopy');
  canopyB.box(1.02, 0.06, 0.08, NAVY_DARK, { at: [0, 1.34, 2.22] }, 'metal');
  canopyB.box(0.06, 0.06, 2.6, NAVY_DARK, { at: [0, 1.34, 1.92], rot: [0.15, 0, 0] }, 'metal');
  const canopyGroup = canopyB.build(materials);
  body.add(canopyGroup);

  for (const s of [-1, 1]) {
    // Trademark F/A-18E sweeping Leading-Edge Extensions (LEX) flaring back into wing root!
    b.box(1.12, 0.1, 3.4, NAVY_BOT, { at: [s * 0.96, 0.34, 1.65], rot: [0, s * 0.24, 0] }, 'armor');
    // Rectangular angular "Rhino" Super Hornet engine intakes tucked under LEX
    b.box(0.68, 0.62, 2.9, NAVY_DARK, { at: [s * 1.04, -0.08, 0.35] }, 'armor');
    b.box(0.56, 0.5, 0.14, '#0c0f13', { at: [s * 1.04, -0.08, 1.82], rot: [0, s * 0.18, 0] }, 'metal');
    // Broad swept-back carrier wings
    b.box(4.25, 0.13, 1.92, NAVY_TOP, { at: [s * 2.85, 0.24, -0.75], rot: [0, s * 0.3, 0] }, 'armor');
    // Wingtip Sidewinder rails + slim AIM-9 white missiles
    b.box(0.12, 0.12, 1.75, NAVY_DARK, { at: [s * 4.92, 0.24, -1.45] }, 'metal');
    b.cyl(0.06, 0.06, 1.95, 10, '#e6ecf2', { at: [s * 5.04, 0.24, -1.35], rot: ALONG_Z }, 'armor');
    // Underwing Maverick / JDAM pylons & ordnance
    for (const wx of [2.15, 3.35]) {
      b.box(0.1, 0.28, 0.72, NAVY_DARK, { at: [s * wx, 0.04, -0.85] }, 'metal');
      b.cyl(0.13, 0.13, 1.85, 12, '#dfe6ed', { at: [s * wx, -0.16, -0.78], rot: ALONG_Z }, 'armor');
      b.solid(new THREE.ConeGeometry(0.13, 0.34, 10), NAVY_DARK, { at: [s * wx, -0.16, 0.3], rot: ALONG_Z }, 'armor', true);
    }
    // Swept-back horizontal tailplanes
    b.box(2.05, 0.1, 1.15, NAVY_BOT, { at: [s * 1.78, 0.06, -4.35], rot: [0, s * 0.44, 0] }, 'armor');
    // Iconic outward-canted twin vertical tail fins (~20 deg cant) + gold squadron stripe!
    b.box(0.14, 2.25, 1.65, NAVY_TOP, { at: [s * 1.15, 1.25, -3.55], rot: [-0.28, 0, s * -0.34] }, 'armor');
    b.box(0.16, 0.32, 0.92, SQN_GOLD, { at: [s * 1.48, 2.15, -3.88], rot: [0, 0, s * -0.34] }, 'armor');
    // Twin closely-spaced F414 circular exhaust nozzles
    b.cyl(0.32, 0.36, 0.65, 14, STEEL, { at: [s * 0.44, 0.08, -5.05], rot: ALONG_Z }, 'metal');
    // Wingtip nav lights
    b.glow(new THREE.SphereGeometry(0.09, 8, 8), s > 0 ? '#ff2020' : '#24ff6a', 4.6, { at: [s * 5.05, 0.32, -1.4] });
  }
  // Nose-mounted M61A1 Vulcan port + carrier arrestor tailhook
  b.box(0.22, 0.14, 0.65, STEEL, { at: [0, 0.34, 4.9] }, 'metal');
  b.box(0.08, 0.08, 1.65, STEEL, { at: [0, -0.36, -4.45], rot: [0.14, 0, 0] }, 'metal');
  body.add(b.build(materials));

  // Retractable carrier tricycle landing gear (twin nose wheels!)
  const gearB = new VehicleBuilder();
  gearB.box(0.14, 0.94, 0.16, STEEL, { at: [0, -0.92, 3.25] }, 'metal');
  for (const nw of [-0.14, 0.14]) {
    gearB.cyl(0.21, 0.21, 0.12, 14, TYRE, { at: [nw, -1.28, 3.25], rot: ALONG_X }, 'tread');
  }
  for (const s of [-1, 1]) {
    gearB.box(0.16, 0.92, 0.18, STEEL, { at: [s * 1.38, -0.92, -1.05] }, 'metal');
    gearB.cyl(0.27, 0.27, 0.22, 16, TYRE, { at: [s * 1.38, -1.24, -1.05], rot: ALONG_X }, 'tread');
    gearB.cyl(0.13, 0.13, 0.24, 12, CHROME, { at: [s * 1.38, -1.24, -1.05], rot: ALONG_X }, 'metal');
  }
  const landingGear = gearB.build(materials);
  body.add(landingGear);

  const boostGlow: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const aft = new THREE.Mesh(
      new THREE.ConeGeometry(0.28, 3.0, 10),
      new THREE.MeshBasicMaterial({ color: 0xffa84c, transparent: true, opacity: 0.9, toneMapped: false }),
    );
    aft.rotation.x = -Math.PI / 2;
    aft.position.set(s * 0.44, 0.08, -6.8);
    aft.visible = false;
    body.add(aft);
    boostGlow.push(aft);
  }

  const riders: RiderRig[] = [
    buildRiderRig(materials, { seatIndex: 0, parent: body, at: [0, 0.64, 2.02], posture: 'cockpit', scale: 0.8 }),
  ];

  const mGun = makeMarker(body, 0, 0.36, 5.25);
  const mLeft = makeMarker(body, 2.25, -0.2, -0.35);
  const mRight = makeMarker(body, -2.25, -0.2, -0.35);
  return {
    root,
    body,
    bodyBaseY: 1.46,
    turret: null,
    barrel: null,
    barrelBaseZ: 0,
    subTurret: null,
    wheelsFront: [],
    wheelsRear: [],
    rotorMain: null,
    rotorTail: null,
    outriggers: [],
    boostGlow,
    landingGear,
    resupplyRing: null,
    fpHideParts: [canopyGroup],
    riders,
    muzzles: { main: mGun, coax: mGun, podLeft: mLeft, podRight: mRight, roof: mGun, front: mGun, rear: mGun },
    meshes: collectMeshes(root),
  };
}

// =============================================================================
// 13. LANCER — B-1B Lancer Supersonic Heavy Strategic Bomber (~28.2 m L × ~26.8 m W unswept / ~16.4 m swept × ~6.8 m H)
// =============================================================================
function buildLancer(materials: ModelMaterials): VehicleModelRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const BODY_BASE_Y = 2.48;
  body.position.y = BODY_BASE_Y;
  root.add(body);

  const b = new VehicleBuilder();
  const GUNSHIP = '#353d46';
  const DARK_SLATE = '#21272f';
  const TRIM_GREY = '#556270';
  const BAY_INTERIOR = '#15191f';
  const AMBER = '#f59e0b';

  // Long supersonic blended-wing-body strategic bomber fuselage (-13.5 m tailcone to +14.3 m needle radome = 27.8 m hull, 28.2 m w/ dump pipe!)
  b.solid(hull([
    { z: -13.5, w: 0.48, top: 0.68, bottom: -0.26 },
    { z: -9.5, w: 1.55, top: 1.05, bottom: -0.62 },
    { z: -4.2, w: 2.35, top: 1.24, bottom: -0.84 },
    { z: 0.4, w: 2.75, top: 1.32, bottom: -0.94 },
    { z: 5.2, w: 1.92, top: 1.28, bottom: -0.86 },
    { z: 9.6, w: 1.26, top: 0.92, bottom: -0.64 },
    { z: 12.2, w: 0.62, top: 0.36, bottom: -0.34 },
    { z: 14.3, w: 0.08, top: -0.02, bottom: -0.14 },
  ]), GUNSHIP, {}, 'armor');

  // Blended wing-box carry-through fairing, dorsal avionics spine & aerial refueling slipway
  b.box(5.35, 0.48, 7.2, DARK_SLATE, { at: [0, 0.24, 0.35] }, 'armor');
  b.box(1.42, 0.24, 12.8, TRIM_GREY, { at: [0, 1.24, -1.6] }, 'armor');
  b.box(0.92, 0.16, 2.2, DARK_SLATE, { at: [0, 1.32, 6.0] }, 'metal'); // UARRSI aerial refueling port
  b.box(0.54, 0.28, 3.8, DARK_SLATE, { at: [0, 0.96, -10.4] }, 'armor'); // dorsal ECM spine fairing

  // Recessed triple internal rotary bomb-bay cavity + rotary launcher drums (visible when belly doors swing open!)
  b.box(1.66, 0.22, 7.6, BAY_INTERIOR, { at: [0, -0.88, 2.3] }, 'metal');
  for (const bayZ of [4.9, 2.3, -0.3]) {
    b.cyl(0.32, 0.32, 2.05, 10, GUNMETAL, { at: [0, -0.78, bayZ], rot: ALONG_Z }, 'metal');
  }

  // Ventral nose M61 Vulcan rotary cannon fairing
  b.cyl(0.17, 0.21, 3.3, 12, STEEL, { at: [0, -0.82, 8.65], rot: ALONG_Z }, 'metal');
  b.box(0.56, 0.26, 2.4, DARK_SLATE, { at: [0, -0.74, 7.8] }, 'armor');

  // Symmetrical airframe features: SMCS mini-canards, paired rectangular 4-engine nacelles, and cruciform tailplanes
  for (const s of [-1, 1]) {
    // Iconic B-1B forward SMCS (Structural Mode Control System) nose ride-control mini-canards
    b.box(1.55, 0.10, 0.88, TRIM_GREY, { at: [s * 1.28, -0.16, 10.65], rot: [0, s * 0.48, s * -0.26] }, 'armor');

    // Paired rectangular underslung twin-engine nacelles (4 large F101 turbofans in twin boxes!)
    b.box(2.15, 1.12, 7.2, DARK_SLATE, { at: [s * 2.65, -0.68, -4.2] }, 'armor');
    b.box(2.22, 0.16, 6.4, TRIM_GREY, { at: [s * 2.65, -0.12, -4.1] }, 'armor'); // nacelle top pylon blend
    // Variable-geometry supersonic intake ramp & twin dark intake cavities with center splitter vane
    b.box(1.92, 0.86, 0.24, '#0a0d11', { at: [s * 2.65, -0.68, -0.58] }, 'metal');
    b.box(0.16, 0.94, 1.1, GUNMETAL, { at: [s * 2.65, -0.68, -0.62] }, 'metal'); // center intake splitter
    b.box(1.98, 0.14, 0.85, TRIM_GREY, { at: [s * 2.65, -0.18, -0.35], rot: [0.22, 0, 0] }, 'armor'); // overhanging intake lip
    // 2 large F101 turkey-feather turbofan exhaust nozzles per nacelle (4 engines total!)
    for (const nx of [-0.52, 0.52]) {
      b.cyl(0.42, 0.48, 1.25, 14, STEEL, { at: [s * 2.65 + nx, -0.68, -8.25], rot: ALONG_Z }, 'metal');
      b.cyl(0.34, 0.38, 0.35, 12, '#14181e', { at: [s * 2.65 + nx, -0.68, -8.82], rot: ALONG_Z }, 'metal');
    }

    // High-mounted swept-back cruciform all-moving horizontal stabilators on vertical fin
    b.box(4.4, 0.16, 1.95, GUNSHIP, { at: [s * 2.35, 2.28, -11.95], rot: [0, s * 0.54, 0] }, 'armor');
    b.box(4.1, 0.08, 0.28, TRIM_GREY, { at: [s * 2.35, 2.34, -11.15], rot: [0, s * 0.54, 0] }, 'armor');
  }

  // Tall swept B-1B single vertical stabilizer fin + top ECM pod & amber beacon (reaches world y ≈ 6.80 m!)
  b.box(0.28, 3.65, 3.15, GUNSHIP, { at: [0, 2.02, -10.85], rot: [-0.38, 0, 0] }, 'armor');
  b.box(0.32, 0.24, 1.45, AMBER, { at: [0, 4.18, -11.95] }, 'armor'); // top fin cap & strobe (4.18 + 0.12 + 2.48 = 6.78 m)
  b.box(0.34, 0.42, 1.95, DARK_SLATE, { at: [0, 1.45, -12.45] }, 'armor'); // rudder actuator fairing

  // Fuel-dump vent pipe at extreme tailcone (extends to z = -13.90 m -> exact 28.20 m airframe length!)
  b.cyl(0.16, 0.22, 1.1, 12, STEEL, { at: [0, 0.26, -13.35], rot: ALONG_Z }, 'metal');
  // Flight-deck interior instrument glow & copilot seat silhouette
  b.box(0.48, 0.56, 0.24, DARK_SLATE, { at: [-0.38, 1.16, 7.92], rot: [-0.15, 0, 0] }, 'carbon');
  b.glow(new THREE.BoxGeometry(0.95, 0.12, 0.06), '#ffb444', 2.4, { at: [0, 1.24, 9.15] });
  body.add(b.build(materials));

  // ANIMATED TRIPLE BELLY BOMB-BAY DOORS (3 tandem bays × 2 clamshell doors = 6 hinged leaves; `userData.side = 1 | -1`)
  const bombBayDoors: THREE.Object3D[] = [];
  for (const bayZ of [4.9, 2.3, -0.3]) {
    for (const side of [1, -1] as const) {
      const hinge = new THREE.Group();
      hinge.position.set(side * 0.88, -0.94, bayZ);
      hinge.userData.side = side;
      const db = new VehicleBuilder();
      db.box(0.86, 0.10, 2.35, DARK_SLATE, { at: [-side * 0.43, 0, 0] }, 'armor');
      db.box(0.76, 0.04, 2.22, TRIM_GREY, { at: [-side * 0.43, -0.05, 0] }, 'metal');
      hinge.add(db.build(materials));
      body.add(hinge);
      bombBayDoors.push(hinge);
    }
  }

  // Retractable heavy strategic bomber landing gear (twin nose wheels + dual 4-wheel main bogies; flush at world y = 0.00!)
  const gearB = new VehicleBuilder();
  // Heavy nose gear strut & twin nose wheels (2.48 - 2.12 - 0.36 = 0.00)
  gearB.box(0.26, 1.56, 0.28, STEEL, { at: [0, -1.48, 8.2] }, 'metal');
  gearB.box(0.18, 0.22, 1.05, GUNMETAL, { at: [0, -1.16, 7.72], rot: [0.55, 0, 0] }, 'metal'); // drag brace
  for (const nw of [-0.26, 0.26]) {
    gearB.cyl(0.36, 0.36, 0.22, 16, TYRE, { at: [nw, -2.12, 8.2], rot: ALONG_X }, 'tread');
    gearB.cyl(0.18, 0.18, 0.24, 12, CHROME, { at: [nw, -2.12, 8.2], rot: ALONG_X }, 'metal');
  }
  // Dual 4-wheel main gear bogies (2.48 - 2.02 - 0.46 = 0.00)
  for (const s of [-1, 1]) {
    gearB.box(0.30, 1.64, 0.34, STEEL, { at: [s * 3.1, -1.36, -1.2] }, 'metal');
    gearB.box(0.20, 0.24, 1.25, GUNMETAL, { at: [s * 2.55, -1.12, -1.2], rot: [0, 0, s * 0.48] }, 'metal'); // side brace
    gearB.box(0.28, 0.22, 1.55, STEEL, { at: [s * 3.1, -2.02, -1.2] }, 'metal'); // bogie beam
    for (const bx of [-0.30, 0.30]) {
      for (const bz of [-0.56, 0.56]) {
        gearB.cyl(0.46, 0.46, 0.28, 16, TYRE, { at: [s * 3.1 + bx, -2.02, -1.2 + bz], rot: ALONG_X }, 'tread');
        gearB.cyl(0.22, 0.22, 0.30, 12, CHROME, { at: [s * 3.1 + bx, -2.02, -1.2 + bz], rot: ALONG_X }, 'metal');
      }
    }
  }
  const landingGear = gearB.build(materials);
  body.add(landingGear);

  // Recessed 4-pane strategic bomber flight deck canopy with dark mullions & eyebrow roof (hidden in 1P!)
  const canopyB = new VehicleBuilder();
  canopyB.solid(hull([
    { z: 6.55, w: 1.24, top: 1.66, bottom: 1.08 },
    { z: 8.65, w: 1.08, top: 1.72, bottom: 0.94 },
    { z: 10.15, w: 0.72, top: 1.18, bottom: 0.66 },
  ]), GLASS, {}, 'canopy');
  // 4-pane strategic windshield framing: center post, left/right corner mullions, upper eyebrow brow & side escape hatches
  canopyB.box(0.11, 0.62, 0.14, DARK_SLATE, { at: [0, 1.44, 9.72], rot: [-0.52, 0, 0] }, 'metal');
  for (const s of [-1, 1]) {
    canopyB.box(0.11, 0.64, 0.14, DARK_SLATE, { at: [s * 0.66, 1.44, 9.32], rot: [-0.46, s * 0.25, 0] }, 'metal');
    canopyB.box(0.10, 0.56, 0.16, DARK_SLATE, { at: [s * 1.04, 1.46, 8.02] }, 'metal');
  }
  canopyB.box(1.78, 0.12, 2.05, GUNSHIP, { at: [0, 1.72, 7.65] }, 'armor');
  canopyB.box(1.52, 0.08, 0.12, DARK_SLATE, { at: [0, 1.64, 8.72] }, 'metal');
  const canopyGroup = canopyB.build(materials);
  body.add(canopyGroup);

  // HUGE ANIMATED VARIABLE-GEOMETRY SWING WINGS (15° unswept ~26.8 m span -> 60° swept ~16.4 m razor supersonic delta!)
  const makeSwingWing = (side: 1 | -1): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 2.45, 0.28, 1.45);
    const wb = new VehicleBuilder();
    // Inboard heavy wing box (pivots backward cleanly along -Z on high-speed Mach sweep)
    wb.box(6.2, 0.24, 2.75, GUNSHIP, { at: [side * 3.15, 0, -1.05], rot: [0, side * 0.30, 0] }, 'armor');
    // Outboard tapered supercritical supersonic wing section
    wb.box(4.75, 0.18, 1.75, TRIM_GREY, { at: [side * 8.20, -0.04, -2.72], rot: [0, side * 0.34, 0] }, 'armor');
    // Wingtip fairing reaching local x = ±10.95 (world x = ±13.40 -> ~26.8 m unswept, ±8.19 -> ~16.4 m swept!)
    wb.box(0.85, 0.14, 1.05, DARK_SLATE, { at: [side * 10.38, -0.05, -3.52], rot: [0, side * 0.34, 0] }, 'armor');
    // Leading-edge slat accent stripe & underwing flap track canoes
    wb.box(9.4, 0.10, 0.28, AMBER, { at: [side * 5.2, 0.09, -0.95], rot: [0, side * 0.32, 0] }, 'armor');
    for (const fx of [2.8, 5.2, 7.6]) {
      wb.box(0.24, 0.20, 1.15, DARK_SLATE, { at: [side * fx, -0.14, -fx * 0.33 - 1.35] }, 'metal');
    }
    wb.glow(new THREE.SphereGeometry(0.12, 8, 8), side > 0 ? '#ff2020' : '#24ff6a', 5.4, { at: [side * 10.83, -0.05, -3.65] });
    pivot.add(wb.build(materials));
    body.add(pivot);
    return pivot;
  };
  const wingsLeft = makeSwingWing(1);
  const wingsRight = makeSwingWing(-1);

  // 4 Roaring Orange F101 Afterburner Plumes (twin pods × 2 engines each, tucked inside z >= -13.6 so rest AABB = exact airframe!)
  const boostGlow: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    for (const nx of [-0.52, 0.52]) {
      const aft = new THREE.Mesh(
        new THREE.ConeGeometry(0.42, 4.8, 12),
        new THREE.MeshBasicMaterial({ color: 0xff9436, transparent: true, opacity: 0.9, toneMapped: false }),
      );
      aft.rotation.x = -Math.PI / 2;
      aft.position.set(s * 2.65 + nx, -0.68, -11.2);
      aft.visible = false;
      body.add(aft);
      boostGlow.push(aft);
    }
  }

  // Iconic "Dump-and-Burn" fiery fuel torch anchored at tailcone pipe (scale 0.001 at rest so rest AABB = exact 28.2 m airframe!)
  const dumpBurnGlow: THREE.Object3D[] = [];
  const outerTorchGeo = new THREE.ConeGeometry(1.15, 9.6, 12);
  outerTorchGeo.translate(0, 4.8, 0);
  const outerTorch = new THREE.Mesh(
    outerTorchGeo,
    new THREE.MeshBasicMaterial({ color: 0xff6218, transparent: true, opacity: 0.8, toneMapped: false }),
  );
  outerTorch.rotation.x = -Math.PI / 2;
  outerTorch.position.set(0, 0.26, -13.85);
  outerTorch.scale.setScalar(0.001);
  outerTorch.visible = false;
  body.add(outerTorch);
  dumpBurnGlow.push(outerTorch);

  const innerTorchGeo = new THREE.ConeGeometry(0.62, 6.8, 10);
  innerTorchGeo.translate(0, 3.4, 0);
  const innerTorch = new THREE.Mesh(
    innerTorchGeo,
    new THREE.MeshBasicMaterial({ color: 0xffe478, transparent: true, opacity: 0.94, toneMapped: false }),
  );
  innerTorch.rotation.x = -Math.PI / 2;
  innerTorch.position.set(0, 0.26, -13.85);
  innerTorch.scale.setScalar(0.001);
  innerTorch.visible = false;
  body.add(innerTorch);
  dumpBurnGlow.push(innerTorch);

  const riders: RiderRig[] = [
    buildRiderRig(materials, { seatIndex: 0, parent: body, at: [0.38, 0.98, 8.15], posture: 'cockpit', scale: 0.92 }),
  ];

  const mGun = makeMarker(body, 0, -0.82, 10.4);
  const mLeft = makeMarker(body, 0.36, -1.08, 2.3);
  const mRight = makeMarker(body, -0.36, -1.08, 2.3);
  return {
    root,
    body,
    bodyBaseY: BODY_BASE_Y,
    turret: null,
    barrel: null,
    barrelBaseZ: 0,
    subTurret: null,
    wheelsFront: [],
    wheelsRear: [],
    rotorMain: null,
    rotorTail: null,
    outriggers: [],
    boostGlow,
    wingsLeft,
    wingsRight,
    dumpBurnGlow,
    landingGear,
    bombBayDoors,
    resupplyRing: null,
    fpHideParts: [canopyGroup],
    riders,
    muzzles: { main: mGun, coax: mGun, podLeft: mLeft, podRight: mRight, roof: mGun, front: mGun, rear: mGun },
    meshes: collectMeshes(root),
  };
}

export function buildVehicleModel(id: DriveVehicleId, materials: ModelMaterials): VehicleModelRig {
  switch (id) {
    case 'jackal': return buildJackal(materials);
    case 'quad': return buildQuad(materials);
    case 'moto': return buildMoto(materials);
    case 'aegis': return buildAegis(materials);
    case 'kestrel': return buildKestrel(materials);
    case 'viper': return buildViper(materials);
    case 'bastion': return buildBastion(materials);
    case 'valkyrie': return buildValkyrie(materials);
    case 'harrier': return buildHarrier(materials);
    case 'warthog': return buildWarthog(materials);
    case 'raptor': return buildRaptor(materials);
    case 'hornet': return buildHornet(materials);
    case 'lancer': return buildLancer(materials);
  }
}
