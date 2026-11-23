/**
 * Sculptural procedural 3D models for all 5 player-driveable vehicles.
 *
 * Conventions (matching src/enemies/vehicles/models.ts & loft.ts):
 *   - Nose along +Z, Up along +Y, Left along +X.
 *   - Every model sits on y = 0 at rest (wheels/tracks/skids grounded; Viper skiff floats on repulsors).
 *   - Uses ModelBuilder + lofted chamfered hulls (`hull()`), rotating front-steered wheels,
 *     independent rotating turrets, recoiling gun barrels, spinning rotors, animated hydraulic
 *     outriggers, emissive headlights/afterburners/repulsor rings, and Bastion's resupply aura ring.
 */
import * as THREE from 'three';
import { ModelBuilder, type ModelMaterials } from '../../progression/modelkit';
import { warthogModel } from '../../progression/callins/warthog';
import { UTILITY_AIRFRAME } from '../utilityModel';
import { hull } from '../loft';
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
  /** Exterior canopy/turret parts hidden while in 1P so the camera never clips into vehicle geometry. */
  readonly fpHideParts?: THREE.Object3D[];
  /** Downward VTOL thruster cones visible when hovering in VTOL mode (Harrier / Warthog). */
  readonly vtolGlow?: THREE.Object3D[];
}

const ALONG_X: readonly [number, number, number] = [0, 0, Math.PI / 2];
const ALONG_Z: readonly [number, number, number] = [Math.PI / 2, 0, 0];

const TYRE = '#17191c';
const RIM = '#5a636e';
const BOLT = '#a5b0ba';
const STEEL = '#23282e';
const GUNMETAL = '#343b42';
const GLASS = '#0b1822';
const CHROME = '#b6c2cc';

function makeMarker(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D {
  const o = new THREE.Object3D();
  o.position.set(x, y, z);
  parent.add(o);
  return o;
}

function makeWheelGroup(materials: ModelMaterials, radius: number, width: number, rimColor: string): THREE.Group {
  const b = new ModelBuilder();
  b.cyl(radius, radius, width, 16, TYRE, { rot: ALONG_X });
  b.cyl(radius * 0.6, radius * 0.6, width + 0.04, 10, rimColor, { rot: ALONG_X });
  b.cyl(radius * 0.25, radius * 0.25, width + 0.09, 8, STEEL, { rot: ALONG_X });
  // Deep off-road tread blocks & lug bolts so spinning wheels pop visually.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.box(width + 0.05, radius * 0.16, radius * 0.26, '#262a2f', {
      at: [0, Math.cos(a) * radius * 0.94, Math.sin(a) * radius * 0.94],
      rot: [a, 0, 0],
    });
    if (i % 2 === 0) {
      b.box(width + 0.1, 0.055, 0.055, BOLT, {
        at: [0, Math.cos(a) * radius * 0.38, Math.sin(a) * radius * 0.38],
      });
    }
  }
  return materials.group(b);
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

  const b = new ModelBuilder();
  // Heavy tubular desert chassis skid-plate & frame rails.
  b.box(1.5, 0.22, 4.4, STEEL, { at: [0, 0.68, 0] });
  b.box(1.75, 0.14, 0.9, GUNMETAL, { at: [0, 0.56, 2.15], rot: [-0.42, 0, 0] }); // front bash skid
  // Sculpted hood & cowl (lofted hull).
  b.solid(hull([
    { z: 0.45, w: 1.05, top: 1.48, bottom: 0.78 },
    { z: 1.55, w: 1.0, top: 1.38, bottom: 0.78 },
    { z: 2.52, w: 0.88, top: 1.15, bottom: 0.82 },
  ]), SAND);
  // Racing stripe & hood scoop.
  b.box(0.46, 0.04, 1.8, AMBER, { at: [0, 1.38, 1.42], rot: [0.12, 0, 0] });
  b.box(0.54, 0.14, 0.75, GUNMETAL, { at: [0, 1.45, 1.15] });
  // Bull-bar, headlights & desert LED lightbar.
  b.box(1.95, 0.12, 0.12, GUNMETAL, { at: [0, 0.84, 2.66] });
  b.box(1.65, 0.08, 0.08, GUNMETAL, { at: [0, 1.24, 2.58] });
  for (const s of [-1, 1]) {
    b.box(0.08, 0.54, 0.08, GUNMETAL, { at: [s * 0.74, 1.02, 2.62] });
    b.glow(new THREE.BoxGeometry(0.32, 0.12, 0.06), '#fff1c1', 3.2, { at: [s * 0.64, 1.08, 2.52] });
    b.glow(new THREE.BoxGeometry(0.24, 0.1, 0.06), '#ff3b30', 2.6, { at: [s * 0.86, 1.12, -2.54] });
    // Flared desert fenders.
    b.box(0.28, 0.14, 1.12, SAND_DARK, { at: [s * 1.14, 1.18, 1.58] });
    b.box(0.28, 0.14, 1.12, SAND_DARK, { at: [s * 1.14, 1.22, -1.48] });
    // Twin forward hood bumper MGs.
    b.cyl(0.045, 0.055, 0.95, 8, STEEL, { at: [s * 0.54, 1.28, 2.28], rot: ALONG_Z });
  }
  // Open-air armored cockpit tub, raked windshield & bucket seats.
  b.box(1.96, 0.56, 1.45, SAND_LIGHT, { at: [0, 1.12, -0.05] });
  b.box(1.78, 0.42, 0.08, GLASS, { at: [0, 1.66, 0.68], rot: [-0.42, 0, 0] });
  for (const s of [-1, 1]) {
    // Tubular chrome desert roll-cage pillars & roof rails.
    b.cyl(0.055, 0.055, 1.05, 8, CHROME, { at: [s * 0.92, 1.72, 0.45], rot: [-0.38, 0, 0] });
    b.cyl(0.055, 0.055, 1.05, 8, CHROME, { at: [s * 0.92, 1.74, -0.78], rot: [0.18, 0, 0] });
    b.cyl(0.055, 0.055, 1.38, 8, CHROME, { at: [s * 0.92, 2.16, -0.18], rot: ALONG_Z });
    b.cyl(0.05, 0.05, 1.72, 8, CHROME, { at: [s * 0.86, 1.82, -1.52], rot: [0.76, 0, 0] });
    // Side step bars & fuel cans.
    b.box(0.18, 0.07, 1.75, STEEL, { at: [s * 1.1, 0.66, 0.05] });
  }
  // Roof crossbars + glowing amber desert lightbar.
  b.cyl(0.055, 0.055, 1.84, 8, CHROME, { at: [0, 2.16, 0.46], rot: ALONG_X });
  b.cyl(0.055, 0.055, 1.84, 8, CHROME, { at: [0, 2.16, -0.82], rot: ALONG_X });
  b.glow(new THREE.BoxGeometry(1.36, 0.09, 0.1), '#ffbe3b', 3.4, { at: [0, 2.24, 0.46] });
  // Rear truck bed + angled spare desert tire + twin nitro exhaust pipes.
  b.box(1.94, 0.56, 1.75, SAND, { at: [0, 1.12, -1.65] });
  b.box(1.72, 0.14, 1.56, GUNMETAL, { at: [0, 0.94, -1.62] });
  b.cyl(0.5, 0.5, 0.28, 12, TYRE, { at: [0, 1.32, -2.35], rot: [0.72, 0, 0] });
  b.cyl(0.28, 0.28, 0.31, 8, RIM, { at: [0, 1.32, -2.35], rot: [0.72, 0, 0] });
  for (const s of [-1, 1]) {
    b.cyl(0.07, 0.09, 0.65, 8, GUNMETAL, { at: [s * 0.56, 0.92, -2.52], rot: ALONG_Z });
  }
  // Turret ring mount on rear deck.
  b.solid(new THREE.TorusGeometry(0.56, 0.07, 8, 18), GUNMETAL, { at: [0, 2.18, -0.78], rot: [Math.PI / 2, 0, 0] });
  body.add(materials.group(b));

  // Nitro boost exhaust flame cones (toggled when boosting).
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

  // Roof .50 Cal Rotary Turret (rotates independently!).
  const turret = new THREE.Group();
  turret.position.set(0, 2.22, -0.78);
  body.add(turret);
  const tb = new ModelBuilder();
  tb.box(0.52, 0.44, 0.68, GUNMETAL, { at: [0, 0.26, 0] });
  tb.box(0.86, 0.52, 0.07, SAND_DARK, { at: [0, 0.36, 0.46], rot: [-0.22, 0, 0] }); // gun shield
  tb.box(0.24, 0.26, 0.36, AMBER, { at: [0.38, 0.22, -0.05] }); // ammo drum
  turret.add(materials.group(tb));

  const barrel = new THREE.Group();
  barrel.position.set(0, 0.32, 0.44);
  turret.add(barrel);
  const bb = new ModelBuilder();
  // Triple-barrel rotary cluster + 40mm under-barrel grenade tube.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    bb.cyl(0.032, 0.034, 1.35, 8, STEEL, { at: [Math.cos(a) * 0.06, Math.sin(a) * 0.06, 0.66], rot: ALONG_Z });
  }
  bb.cyl(0.12, 0.12, 0.12, 10, GUNMETAL, { at: [0, 0, 1.05], rot: ALONG_Z });
  bb.cyl(0.06, 0.065, 0.72, 8, AMBER, { at: [0, -0.14, 0.38], rot: ALONG_Z });
  barrel.add(materials.group(bb));

  // 4 Independent Big Off-Road Wheels (front pair steers + spins, rear pair spins).
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

  const b = new ModelBuilder();
  // Sloped lower & upper glacis composite tank hull.
  b.solid(hull([
    { z: -3.55, w: 1.75, top: 1.62, bottom: 0.56 },
    { z: -2.4, w: 1.88, top: 1.74, bottom: 0.52 },
    { z: 1.65, w: 1.88, top: 1.72, bottom: 0.52 },
    { z: 3.15, w: 1.76, top: 1.42, bottom: 0.62 },
    { z: 3.68, w: 1.56, top: 1.12, bottom: 0.88 },
  ]), OLIVE);
  // Reactive armor (ERA) side skirts & glacis bricks.
  for (const s of [-1, 1]) {
    // Track housings + 6 armored roadwheels per side.
    b.box(0.74, 0.86, 6.85, STEEL, { at: [s * 1.62, 0.54, -0.05] });
    b.box(0.18, 0.72, 6.95, OLIVE_DARK, { at: [s * 1.98, 0.96, -0.05] }); // side skirt
    for (let i = 0; i < 6; i++) {
      const z = -2.65 + i * 1.06;
      b.cyl(0.42, 0.42, 0.62, 12, GUNMETAL, { at: [s * 1.62, 0.42, z], rot: ALONG_X });
      b.cyl(0.22, 0.22, 0.68, 8, OLIVE_LIGHT, { at: [s * 1.62, 0.42, z], rot: ALONG_X });
      // Reactive armor bricks along skirt.
      b.box(0.12, 0.46, 0.82, OLIVE_LIGHT, { at: [s * 2.06, 1.02, z] });
    }
    // Front tow hooks & armored headlights.
    b.box(0.24, 0.24, 0.42, GUNMETAL, { at: [s * 1.15, 1.02, 3.68] });
    b.glow(new THREE.BoxGeometry(0.28, 0.14, 0.08), '#ffe9b0', 3.0, { at: [s * 1.38, 1.42, 3.22] });
    // Rear engine deck vents & glowing turbine grilles.
    b.box(0.95, 0.14, 1.65, STEEL, { at: [s * 0.72, 1.76, -2.35] });
    b.glow(new THREE.BoxGeometry(0.62, 0.22, 0.08), '#ff6b35', 2.4, { at: [s * 0.88, 1.22, -3.56] });
  }
  // Front hazard stripe & driver periscope visor.
  b.box(2.8, 0.12, 0.06, AMBER, { at: [0, 1.34, 3.24], rot: [-0.36, 0, 0] });
  b.glow(new THREE.BoxGeometry(0.56, 0.09, 0.08), OPTIC, 2.8, { at: [0, 1.74, 2.28] });
  body.add(materials.group(b));

  // Turbine overdrive rear glow.
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

  // Heavy Composite Wedge Turret (360° independent slew!).
  const turret = new THREE.Group();
  turret.position.set(0, 1.78, -0.15);
  body.add(turret);
  const tb = new ModelBuilder();
  tb.solid(hull([
    { z: -2.25, w: 1.42, top: 1.02, bottom: 0.02 },
    { z: -0.9, w: 1.68, top: 1.12, bottom: 0.02 },
    { z: 0.85, w: 1.56, top: 1.06, bottom: 0.02 },
    { z: 1.95, w: 0.96, top: 0.78, bottom: 0.12 },
  ]), OLIVE_LIGHT);
  // Turret bustle rack, smoke dischargers & cyan thermal sight box.
  tb.box(2.3, 0.45, 0.78, GUNMETAL, { at: [0, 0.62, -2.38] });
  tb.box(0.56, 0.36, 0.62, STEEL, { at: [0.88, 1.16, 0.95] });
  tb.glow(new THREE.BoxGeometry(0.42, 0.18, 0.06), OPTIC, 3.2, { at: [0.88, 1.18, 1.27] });
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      tb.cyl(0.06, 0.06, 0.34, 8, GUNMETAL, { at: [s * 1.52, 0.84, 0.45 + k * 0.22], rot: [0.55, 0, s * -0.45] });
    }
    tb.box(0.08, 0.22, 1.85, AMBER, { at: [s * 1.68, 0.64, -0.35] });
  }
  // Antenna whips.
  tb.cyl(0.02, 0.03, 2.2, 6, STEEL, { at: [1.15, 2.0, -1.85] });
  tb.cyl(0.02, 0.03, 1.8, 6, STEEL, { at: [-1.15, 1.8, -1.85] });
  turret.add(materials.group(tb));

  // Commander Cupola + 20mm AA Autocannon + TOW ATGM tube.
  const subTurret = new THREE.Group();
  subTurret.position.set(-0.55, 1.14, -0.52);
  turret.add(subTurret);
  const sb = new ModelBuilder();
  sb.cyl(0.48, 0.54, 0.32, 12, OLIVE_DARK, { at: [0, 0.16, 0] });
  sb.box(0.32, 0.26, 0.56, GUNMETAL, { at: [0, 0.44, 0.1] });
  sb.cyl(0.045, 0.055, 1.45, 8, STEEL, { at: [0, 0.46, 0.92], rot: ALONG_Z });
  sb.cyl(0.11, 0.11, 1.05, 10, OLIVE, { at: [0.34, 0.52, 0.25], rot: ALONG_Z }); // TOW launcher
  subTurret.add(materials.group(sb));

  // 120mm Smoothbore Main Cannon (elevates & recoils inside turret!).
  const barrel = new THREE.Group();
  barrel.position.set(0, 0.58, 1.65);
  turret.add(barrel);
  const bb = new ModelBuilder();
  bb.box(0.86, 0.54, 0.62, GUNMETAL, { at: [0, 0, 0.1] }); // mantlet
  bb.cyl(0.11, 0.14, 4.9, 12, OLIVE_DARK, { at: [0, 0, 2.55], rot: ALONG_Z });
  bb.cyl(0.19, 0.19, 0.82, 12, GUNMETAL, { at: [0, 0, 2.1], rot: ALONG_Z }); // bore evacuator
  bb.box(0.3, 0.28, 0.52, STEEL, { at: [0, 0, 4.95] }); // muzzle brake
  // Coaxial 7.62mm barrel beside mantlet.
  bb.cyl(0.032, 0.035, 1.25, 8, STEEL, { at: [0.46, 0.04, 0.85], rot: ALONG_Z });
  barrel.add(materials.group(bb));

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
    muzzles: { main: mMain, coax: mCoax, podLeft: mMain, podRight: mMain, roof: mRoof, front: mMain, rear: mRoof },
    meshes: collectMeshes(root),
    fpHideParts: [barrel],
  };
}

// =================================================================================================
// 3. KESTREL — Twin-Turbine Attack Gunship (Stealth Charcoal + Crimson Stripes + Hydra Pods + Chin Gun)
// =================================================================================================

function buildKestrel(materials: ModelMaterials): VehicleModelRig {
  const CHARCOAL = '#262c33';
  const SLATE = '#3a434d';
  const CRIMSON = '#dc2626';
  const CANOPY = '#b4852a';
  const OPTIC = '#38e8ff';

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const b = new ModelBuilder();
  // Sleek stealth tandem-cockpit fuselage.
  b.solid(hull([
    { z: -6.8, w: 0.24, top: 1.85, bottom: 1.35 },
    { z: -3.2, w: 0.56, top: 2.05, bottom: 1.12 },
    { z: -1.4, w: 1.05, top: 2.48, bottom: 0.72 },
    { z: 1.5, w: 0.96, top: 2.38, bottom: 0.68 },
    { z: 3.1, w: 0.64, top: 1.65, bottom: 0.74 },
    { z: 4.15, w: 0.34, top: 1.18, bottom: 0.84 },
  ]), CHARCOAL);
  // Armored golden-tint stepped tandem canopy.
  b.solid(hull([
    { z: 0.25, w: 0.68, top: 2.62, bottom: 1.95 },
    { z: 1.75, w: 0.62, top: 2.48, bottom: 1.78 },
    { z: 2.95, w: 0.44, top: 1.72, bottom: 1.32 },
  ]), CANOPY);
  // Nose TADS thermal targeting turret ball.
  b.box(0.54, 0.46, 0.52, STEEL, { at: [0, 1.02, 4.18] });
  b.glow(new THREE.CircleGeometry(0.14, 10), OPTIC, 3.4, { at: [0, 1.02, 4.46] });
  // Twin turbine engine nacelles & crimson squadron stripes.
  for (const s of [-1, 1]) {
    b.solid(hull([
      { z: -2.0, w: 0.42, top: 2.52, bottom: 1.78 },
      { z: 0.75, w: 0.46, top: 2.56, bottom: 1.76 },
    ]), SLATE, { at: [s * 1.15, 0, 0] });
    b.box(0.14, 0.22, 3.2, CRIMSON, { at: [s * 1.06, 1.52, 0.35] });
    // Swept stub weapon wings.
    b.box(2.35, 0.18, 1.28, SLATE, { at: [s * 2.15, 1.48, 0.45], rot: [0, s * -0.14, s * -0.1] });
    // 70mm Hydra 19-tube Rocket Pods + dual Hellfire rails on wingtips.
    b.cyl(0.32, 0.34, 1.85, 12, GUNMETAL, { at: [s * 2.25, 1.16, 0.62], rot: ALONG_Z });
    b.glow(new THREE.CircleGeometry(0.24, 10), '#ff9e3b', 2.2, { at: [s * 2.25, 1.16, 1.56] });
    b.cyl(0.12, 0.12, 1.95, 8, CRIMSON, { at: [s * 3.15, 1.16, 0.55], rot: ALONG_Z });
    // Landing skids / rugged gear struts.
    b.cyl(0.06, 0.06, 4.2, 8, STEEL, { at: [s * 1.25, 0.12, 0.2], rot: ALONG_Z });
    b.box(0.08, 0.72, 0.12, STEEL, { at: [s * 1.05, 0.42, 1.25], rot: [0, 0, s * 0.35] });
    b.box(0.08, 0.72, 0.12, STEEL, { at: [s * 1.05, 0.42, -0.85], rot: [0, 0, s * 0.35] });
  }
  // Vertical tail fin & horizontal stabilizers.
  b.box(0.18, 2.2, 1.25, CHARCOAL, { at: [0, 2.38, -6.4], rot: [-0.26, 0, 0] });
  b.box(0.2, 0.48, 1.18, CRIMSON, { at: [0, 3.08, -6.58], rot: [-0.26, 0, 0] });
  b.box(2.6, 0.12, 0.68, SLATE, { at: [0, 1.72, -5.85] });
  // Rotor mast housing.
  b.cyl(0.24, 0.36, 0.72, 10, GUNMETAL, { at: [0, 2.86, 0.15] });
  body.add(materials.group(b));

  // Twin rear turbine afterburner glows.
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

  // Spinning 4-blade Main Rotor.
  const rotorMain = new THREE.Group();
  rotorMain.position.set(0, 3.24, 0.15);
  body.add(rotorMain);
  const mb = new ModelBuilder();
  mb.cyl(0.36, 0.36, 0.2, 10, STEEL);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    mb.box(0.34, 0.04, 6.2, GUNMETAL, { at: [Math.sin(a) * 3.1, 0, Math.cos(a) * 3.1], rot: [0, a, 0] });
    mb.box(0.35, 0.045, 0.45, CRIMSON, { at: [Math.sin(a) * 5.95, 0, Math.cos(a) * 5.95], rot: [0, a, 0] });
  }
  rotorMain.add(materials.group(mb));

  // Spinning Tail Rotor.
  const rotorTail = new THREE.Group();
  rotorTail.position.set(0.28, 2.88, -6.58);
  body.add(rotorTail);
  const trb = new ModelBuilder();
  trb.cyl(0.14, 0.14, 0.16, 8, STEEL, { rot: ALONG_X });
  trb.box(0.04, 2.1, 0.18, GUNMETAL);
  trb.box(0.04, 0.18, 2.1, GUNMETAL);
  rotorTail.add(materials.group(trb));

  // Articulating Chin 30mm Chain Gun Turret.
  const turret = new THREE.Group();
  turret.position.set(0, 0.64, 3.22);
  body.add(turret);
  const barrel = new THREE.Group();
  turret.add(barrel);
  const cb = new ModelBuilder();
  cb.box(0.36, 0.32, 0.56, GUNMETAL, { at: [0, -0.1, 0] });
  cb.cyl(0.055, 0.068, 1.65, 8, STEEL, { at: [0, -0.14, 0.95], rot: ALONG_Z });
  barrel.add(materials.group(cb));

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
  const CARBON = '#1c2128';
  const TITANIUM = '#94a3b8';
  const CYAN = '#38e8ff';

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const b = new ModelBuilder();
  // Razor-sleek aerodynamic jet-bike fairing lofted from jet tail to needle nose.
  b.solid(hull([
    { z: -2.05, w: 0.42, top: 0.96, bottom: 0.44 },
    { z: -0.95, w: 0.56, top: 1.06, bottom: 0.38 },
    { z: 0.45, w: 0.64, top: 1.18, bottom: 0.36 },
    { z: 1.55, w: 0.52, top: 0.98, bottom: 0.46 },
    { z: 2.38, w: 0.22, top: 0.68, bottom: 0.52 },
  ]), CRIMSON);
  // Carbon spine saddle + sculpted windscreen + twin handlebars.
  b.box(0.46, 0.22, 1.42, CARBON, { at: [0, 1.06, -0.58] });
  b.box(0.52, 0.32, 0.58, GLASS, { at: [0, 1.24, 0.78], rot: [-0.62, 0, 0] });
  for (const s of [-1, 1]) {
    // Swept forward stabilization outrigger fins + twin 20mm pulse blasters.
    b.solid(hull([
      { z: -1.35, w: 0.2, top: 0.78, bottom: 0.42 },
      { z: 0.65, w: 0.22, top: 0.82, bottom: 0.36 },
      { z: 2.08, w: 0.14, top: 0.68, bottom: 0.48 },
    ]), CARBON, { at: [s * 0.72, 0, 0] });
    b.box(0.08, 0.1, 2.55, CRIMSON_BRIGHT, { at: [s * 0.88, 0.66, 0.35] });
    b.cyl(0.055, 0.065, 1.15, 8, TITANIUM, { at: [s * 0.72, 0.64, 2.12], rot: ALONG_Z });
    b.glow(new THREE.CircleGeometry(0.06, 8), CYAN, 3.8, { at: [s * 0.72, 0.64, 2.71] });
    // Handlebar grips.
    b.cyl(0.032, 0.032, 0.46, 8, TITANIUM, { at: [s * 0.36, 1.16, 0.36], rot: [0, s * -0.32, Math.PI / 2] });
    // Swept rear twin stabilizer tailfins.
    b.box(0.07, 0.56, 0.86, CRIMSON_BRIGHT, { at: [s * 0.56, 1.08, -1.65], rot: [-0.35, 0, s * -0.28] });
    // Rear twin jet thruster nozzles.
    b.cyl(0.18, 0.22, 0.48, 10, TITANIUM, { at: [s * 0.26, 0.68, -2.14], rot: ALONG_Z });
    b.glow(new THREE.CircleGeometry(0.16, 10), CYAN, 3.6, { at: [s * 0.26, 0.68, -2.39], rot: [0, Math.PI, 0] });
  }
  // Glowing cyan underside repulsor levitation rings (front & rear).
  b.glow(new THREE.TorusGeometry(0.46, 0.055, 8, 18), CYAN, 3.8, { at: [0, 0.34, 1.08], rot: [Math.PI / 2, 0, 0] });
  b.glow(new THREE.TorusGeometry(0.44, 0.055, 8, 18), CYAN, 3.8, { at: [0, 0.34, -1.05], rot: [Math.PI / 2, 0, 0] });
  // Headlight blade.
  b.glow(new THREE.BoxGeometry(0.36, 0.09, 0.08), '#ffffff', 3.6, { at: [0, 0.74, 2.34] });
  body.add(materials.group(b));

  // Mach boost afterburner plumes.
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
  const PLATE = '#343b42';
  const HAZARD = '#eab308';
  const GREEN = '#22c55e';

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const b = new ModelBuilder();
  // Massive 6x6 ladder chassis & armored belly.
  b.box(2.4, 0.42, 7.6, STEEL, { at: [0, 0.86, 0] });
  // Sloped armored engine bonnet & heavy cab.
  b.solid(hull([
    { z: 0.9, w: 1.48, top: 2.78, bottom: 1.02 },
    { z: 2.45, w: 1.46, top: 2.66, bottom: 1.02 },
    { z: 3.1, w: 1.38, top: 2.02, bottom: 1.02 },
    { z: 4.1, w: 1.26, top: 1.78, bottom: 1.02 },
  ]), OCHRE);
  // Slotted armored windshield visor + side armor shutters.
  b.box(2.38, 0.34, 0.1, GLASS, { at: [0, 2.34, 2.52], rot: [-0.26, 0, 0] });
  for (let i = -2; i <= 2; i++) {
    b.box(0.06, 0.38, 0.14, PLATE, { at: [i * 0.48, 2.34, 2.56], rot: [-0.26, 0, 0] });
  }
  // Massive welded V-shaped steel Ramming Plow at the nose!
  b.box(1.75, 1.05, 0.24, PLATE, { at: [0.8, 0.96, 4.35], rot: [0.18, -0.34, 0] });
  b.box(1.75, 1.05, 0.24, PLATE, { at: [-0.8, 0.96, 4.35], rot: [0.18, 0.34, 0] });
  b.box(0.32, 1.1, 0.34, HAZARD, { at: [0, 0.98, 4.62], rot: [0.18, 0, 0] });
  for (const s of [-1, 1]) {
    b.glow(new THREE.BoxGeometry(0.36, 0.16, 0.08), '#fff0b8', 3.2, { at: [s * 0.98, 1.56, 4.12] });
    // Heavy steel exhaust stacks behind cab.
    b.cyl(0.11, 0.12, 2.15, 8, GUNMETAL, { at: [s * 1.56, 2.15, 0.65] });
    // Armored weapon deck side-walls + resupply medical/ammo lockers.
    b.box(0.24, 1.35, 4.6, OCHRE_DARK, { at: [s * 1.48, 1.72, -1.65] });
    b.box(0.08, 0.24, 4.4, HAZARD, { at: [s * 1.62, 1.68, -1.65] });
    b.glow(new THREE.BoxGeometry(0.1, 0.42, 0.72), GREEN, 2.6, { at: [s * 1.62, 1.98, -0.65] });
    // Bumper twin HMGs.
    b.cyl(0.05, 0.06, 1.0, 8, STEEL, { at: [s * 0.84, 1.48, 4.45], rot: ALONG_Z });
  }
  // Armored weapon deck floor & rear bulkhead.
  b.box(2.85, 0.28, 4.7, PLATE, { at: [0, 1.24, -1.65] });
  b.box(2.96, 1.28, 0.28, OCHRE_DARK, { at: [0, 1.74, -3.98] });
  // Green beacon dome on cab roof.
  b.glow(new THREE.CylinderGeometry(0.18, 0.24, 0.22, 10), GREEN, 3.0, { at: [0, 2.94, 1.75] });
  body.add(materials.group(b));

  // Boost exhaust glows.
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

  // 4 Animated Hydraulic Stabilizer Outriggers (swing out & lock to ground when Deployed via [Q]!).
  const outriggers: THREE.Group[] = [];
  const outriggerSpots: readonly (readonly [number, number])[] = [
    [1.58, 1.85], [-1.58, 1.85], [1.58, -3.15], [-1.58, -3.15],
  ];
  for (const [ox, oz] of outriggerSpots) {
    const side = Math.sign(ox);
    const og = new THREE.Group();
    og.position.set(ox, 1.02, oz);
    const ob = new ModelBuilder();
    ob.box(0.86, 0.22, 0.34, HAZARD, { at: [side * 0.42, 0, 0] });
    ob.box(0.28, 1.12, 0.32, GUNMETAL, { at: [side * 0.86, -0.45, 0] });
    ob.box(0.56, 0.14, 0.56, STEEL, { at: [side * 0.86, -1.0, 0] });
    og.add(materials.group(ob));
    og.rotation.z = side * 1.15; // stowed upright along hull
    body.add(og);
    outriggers.push(og);
  }

  // Glowing ground resupply aura ring (visible when Deployed via [Q]).
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

  // Front Twin 20mm Vulcan Turret (over cab roof).
  const turret = new THREE.Group();
  turret.position.set(0, 2.86, 1.05);
  body.add(turret);
  const tb = new ModelBuilder();
  tb.cyl(0.66, 0.74, 0.36, 12, PLATE, { at: [0, 0.18, 0] });
  tb.box(0.92, 0.52, 0.84, OCHRE, { at: [0, 0.54, 0] });
  turret.add(materials.group(tb));

  const barrel = new THREE.Group();
  barrel.position.set(0, 0.56, 0.48);
  turret.add(barrel);
  const bb = new ModelBuilder();
  for (const s of [-1, 1]) {
    bb.cyl(0.085, 0.095, 1.65, 10, STEEL, { at: [s * 0.34, 0, 0.82], rot: ALONG_Z });
    bb.cyl(0.11, 0.11, 0.16, 10, HAZARD, { at: [s * 0.34, 0, 1.38], rot: ALONG_Z });
  }
  barrel.add(materials.group(bb));

  // Rear Quad 35mm Flak / Siege Mortar Turret (in armored bed).
  const subTurret = new THREE.Group();
  subTurret.position.set(0, 2.15, -2.15);
  body.add(subTurret);
  const sb = new ModelBuilder();
  sb.cyl(0.82, 0.92, 0.45, 12, PLATE, { at: [0, 0.22, 0] });
  sb.box(1.18, 0.64, 1.05, OCHRE_DARK, { at: [0, 0.68, -0.05] });
  for (const sx of [-0.34, 0.34]) {
    for (const sy of [-0.14, 0.16]) {
      sb.cyl(0.055, 0.068, 2.15, 8, STEEL, { at: [sx, 0.72 + sy, 1.35], rot: ALONG_Z });
    }
  }
  sb.cyl(0.16, 0.18, 1.35, 10, HAZARD, { at: [0, 1.12, 0.55], rot: [Math.PI / 2 - 0.38, 0, 0] }); // siege mortar tube
  subTurret.add(materials.group(sb));

  // 6 Heavy 6×6 Armored Wheels (front axle steers, dual rear axles drive!).
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
    muzzles: { main: mCoax, coax: mCoax, podLeft: mFront, podRight: mFront, roof: mFront, front: mFront, rear: mRear },
    meshes: collectMeshes(root),
  };
}

// =============================================================================
// 6. NOMAD — Unarmed 4WD Combat Quad ATV (Nimble Jumper + Rear Passenger Seat)
// =============================================================================
function buildQuad(materials: ModelMaterials): VehicleModelRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const b = new ModelBuilder();
  const OLIVE = '#4d5d3d';
  const TAN = '#b69c6d';
  const ACCENT = '#9cff57';

  // Rugged tubular chassis & bash skidplate
  b.box(0.86, 0.24, 1.85, STEEL, { at: [0, 0.56, 0] });
  b.box(0.74, 0.14, 0.65, GUNMETAL, { at: [0, 0.48, 1.05], rot: [-0.42, 0, 0] });
  // Sculpted angular fenders & fuel tank
  b.box(1.18, 0.16, 0.82, OLIVE, { at: [0, 0.86, 0.68], rot: [0.1, 0, 0] });
  b.box(1.18, 0.16, 0.85, OLIVE, { at: [0, 0.88, -0.72], rot: [-0.08, 0, 0] });
  b.box(0.56, 0.34, 0.72, TAN, { at: [0, 0.96, 0.24] });
  // Two-up ribbed rider + rear passenger saddle + steel rear grab-rack
  b.box(0.5, 0.18, 1.08, '#1f2226', { at: [0, 0.94, -0.45] });
  b.box(0.92, 0.08, 0.42, STEEL, { at: [0, 1.02, -1.04] });
  b.box(0.84, 0.08, 0.34, STEEL, { at: [0, 1.0, 0.96] });
  // Steering column, handlebars & LED headlights
  b.cyl(0.035, 0.04, 0.48, 8, STEEL, { at: [0, 1.12, 0.6], rot: [-0.32, 0, 0] });
  b.cyl(0.025, 0.025, 0.82, 8, CHROME, { at: [0, 1.28, 0.52], rot: ALONG_X });
  for (const s of [-1, 1]) {
    b.glow(new THREE.BoxGeometry(0.18, 0.1, 0.06), '#f0ffe0', 3.4, { at: [s * 0.3, 0.92, 1.12] });
    b.glow(new THREE.BoxGeometry(0.14, 0.07, 0.05), '#ff3428', 2.4, { at: [s * 0.32, 0.92, -1.16] });
    // Twin rear exhaust cans
    b.cyl(0.055, 0.065, 0.46, 8, GUNMETAL, { at: [s * 0.24, 0.68, -1.02], rot: ALONG_Z });
  }
  b.glow(new THREE.BoxGeometry(0.24, 0.04, 0.04), ACCENT, 2.2, { at: [0, 1.14, 0.42] });
  body.add(materials.group(b));

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
    muzzles: { main: mFront, coax: mFront, podLeft: mFront, podRight: mFront, roof: mFront, front: mFront, rear: mFront },
    meshes: collectMeshes(root),
  };
}

// =============================================================================
// 7. RAZOR — Unarmed Combat Dirtbike / Motorcycle (Deep Lean Banking + Wheelie!)
// =============================================================================
function buildMoto(materials: ModelMaterials): VehicleModelRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const b = new ModelBuilder();
  const FAIRING = '#2b313a';
  const CRIMSON = '#e0355d';

  // Spine frame, V-twin engine block, fuel tank & aggressive front cowl
  b.box(0.32, 0.42, 0.78, GUNMETAL, { at: [0, 0.62, 0.05] });
  b.box(0.36, 0.26, 0.64, CRIMSON, { at: [0, 0.95, 0.25], rot: [-0.14, 0, 0] });
  b.box(0.34, 0.16, 0.88, '#1a1d22', { at: [0, 0.9, -0.44], rot: [0.06, 0, 0] });
  b.box(0.32, 0.3, 0.52, FAIRING, { at: [0, 1.04, 0.76], rot: [-0.36, 0, 0] });
  // Raked telescopic front forks & handlebars
  for (const s of [-1, 1]) {
    b.cyl(0.032, 0.035, 0.92, 8, CHROME, { at: [s * 0.14, 0.78, 0.78], rot: [0.42, 0, 0] });
    b.cyl(0.045, 0.055, 0.62, 8, STEEL, { at: [s * 0.2, 0.64, -0.78], rot: [Math.PI / 2 - 0.18, 0, 0] });
  }
  b.cyl(0.022, 0.022, 0.74, 8, STEEL, { at: [0, 1.18, 0.56], rot: ALONG_X });
  b.glow(new THREE.BoxGeometry(0.2, 0.12, 0.06), '#fff4e0', 4.0, { at: [0, 1.02, 1.02] });
  b.glow(new THREE.BoxGeometry(0.18, 0.07, 0.05), '#ff2a4a', 2.8, { at: [0, 0.96, -0.92] });
  b.glow(new THREE.BoxGeometry(0.16, 0.04, 0.04), '#ff4f7a', 2.4, { at: [0, 1.14, 0.5] });
  body.add(materials.group(b));

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
  body.add(hullGroup);

  // Main & tail rotors from UTILITY_AIRFRAME spec
  const rMainSpec = UTILITY_AIRFRAME.rotors[0]!;
  const rmb = new ModelBuilder();
  rMainSpec.build(rmb);
  const rotorMain = materials.group(rmb);
  rotorMain.position.set(rMainSpec.at[0], rMainSpec.at[1], rMainSpec.at[2]);
  body.add(rotorMain);

  const rTailSpec = UTILITY_AIRFRAME.rotors[1]!;
  const rtb = new ModelBuilder();
  rTailSpec.build(rtb);
  const rotorTail = materials.group(rtb);
  rotorTail.position.set(rTailSpec.at[0], rTailSpec.at[1], rTailSpec.at[2]);
  body.add(rotorTail);

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

  const mDoor = makeMarker(body, 1.55, -0.1, 0.2);
  const mNose = makeMarker(body, 0, -0.2, 4.8);
  return {
    root,
    body,
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

  const b = new ModelBuilder();
  const JET_GREY = '#4c5762';
  const DARK_GREY = '#2c343d';
  const LIGHT_GREY = '#73808c';

  // Sleek tapered fuselage
  b.solid(hull([
    { z: -5.4, w: 0.24, top: 0.42, bottom: -0.22 },
    { z: -2.4, w: 0.78, top: 0.82, bottom: -0.58 },
    { z: 0.8, w: 0.94, top: 0.88, bottom: -0.66 },
    { z: 3.4, w: 0.68, top: 0.56, bottom: -0.52 },
    { z: 5.6, w: 0.14, top: -0.06, bottom: -0.28 },
  ]), JET_GREY);

  // Bubble fighter canopy (tagged in separate group so 1P cockpit never clips glass!)
  const canopyB = new ModelBuilder();
  canopyB.solid(hull([
    { z: 0.6, w: 0.56, top: 1.32, bottom: 0.78 },
    { z: 2.2, w: 0.52, top: 1.42, bottom: 0.68 },
    { z: 3.4, w: 0.34, top: 0.95, bottom: 0.45 },
  ]), GLASS);
  canopyB.box(0.05, 0.06, 2.5, DARK_GREY, { at: [0, 1.36, 1.9], rot: [0.16, 0, 0] });
  const canopyGroup = materials.group(canopyB);
  body.add(canopyGroup);

  // Side Pegasus turbofan intakes & 4 vectored-thrust VTOL nozzles
  for (const s of [-1, 1]) {
    b.box(0.56, 0.92, 2.4, DARK_GREY, { at: [s * 0.98, 0.12, 1.1] });
    b.box(0.46, 0.78, 0.15, '#0d1014', { at: [s * 0.98, 0.12, 2.32] });
    // High swept anhedral delta wings
    b.box(4.2, 0.15, 2.4, JET_GREY, { at: [s * 2.55, 0.42, -0.35], rot: [0, s * -0.46, s * -0.14] });
    b.box(1.4, 0.12, 1.2, LIGHT_GREY, { at: [s * 4.55, 0.18, -1.55], rot: [0, s * -0.52, s * -0.16] });
    // Tailplanes
    b.box(1.9, 0.11, 1.1, JET_GREY, { at: [s * 1.1, 0.14, -4.6], rot: [0, s * -0.35, s * -0.12] });
    // Underwing ordnance pylons: Mk-82 bombs & Sidewinder missiles
    for (const wx of [1.85, 3.15]) {
      b.box(0.1, 0.28, 0.65, DARK_GREY, { at: [s * wx, 0.18, -0.35] });
      b.cyl(0.14, 0.14, 1.85, 8, '#3d4a35', { at: [s * wx, -0.04, -0.25], rot: ALONG_Z });
      b.solid(new THREE.ConeGeometry(0.14, 0.38, 8), '#e6c24a', { at: [s * wx, -0.04, 0.85], rot: ALONG_Z });
    }
    // Vectored nozzles (front + rear per side)
    for (const nz of [0.45, -1.25]) {
      b.cyl(0.22, 0.26, 0.42, 10, STEEL, { at: [s * 0.96, -0.32, nz], rot: [0.35, 0, s * 0.25] });
    }
    // Wingtip nav lights
    b.glow(new THREE.SphereGeometry(0.1, 6, 6), s > 0 ? '#ff2020' : '#24ff6a', 5, { at: [s * 5.2, 0.08, -1.9] });
  }
  // Vertical stabilizer fin + GAU-12 ventral gun pod
  b.box(0.16, 2.25, 1.85, JET_GREY, { at: [0, 1.48, -4.35], rot: [-0.32, 0, 0] });
  b.box(0.18, 0.45, 0.72, '#46ff9a', { at: [0, 2.42, -4.72] });
  b.cyl(0.16, 0.18, 2.2, 8, STEEL, { at: [0, -0.72, 1.45], rot: ALONG_Z });
  // Landing gear struts
  b.box(0.14, 0.92, 0.16, STEEL, { at: [0, -0.95, 2.1] });
  b.box(0.16, 0.88, 0.22, STEEL, { at: [0, -0.92, -1.2] });
  b.cyl(0.24, 0.24, 0.18, 10, TYRE, { at: [0, -1.32, 2.1], rot: ALONG_X });
  b.cyl(0.28, 0.28, 0.24, 10, TYRE, { at: [0, -1.3, -1.2], rot: ALONG_X });
  body.add(materials.group(b));

  const boostGlow: THREE.Object3D[] = [];
  const vtolGlow: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    // Aft supersonic afterburner flames
    const aft = new THREE.Mesh(
      new THREE.ConeGeometry(0.26, 2.6, 10),
      new THREE.MeshBasicMaterial({ color: 0x5ae8ff, transparent: true, opacity: 0.9, toneMapped: false }),
    );
    aft.rotation.x = -Math.PI / 2;
    aft.position.set(s * 0.92, -0.22, -2.7);
    aft.visible = false;
    body.add(aft);
    boostGlow.push(aft);

    // Downward VTOL hover thruster plumes
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

  const mNose = makeMarker(body, 0, -0.72, 3.2);
  const mLeft = makeMarker(body, 2.2, -0.25, 0.2);
  const mRight = makeMarker(body, -2.2, -0.25, 0.2);
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
    vtolGlow,
    resupplyRing: null,
    fpHideParts: [canopyGroup],
    muzzles: { main: mNose, coax: mNose, podLeft: mLeft, podRight: mRight, roof: mNose, front: mNose, rear: mNose },
    meshes: collectMeshes(root),
  };
}

// =============================================================================
// 10. WARTHOG — Flyable A-10 Thunderbolt II (Reuses Iconic warthogModel!)
// =============================================================================
function buildWarthog(materials: ModelMaterials): VehicleModelRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 1.65;
  root.add(body);

  const jet = warthogModel(materials);
  jet.scale.setScalar(0.68);
  body.add(jet);

  // Landing gear pods so it rests cleanly on the Badlands tarmac!
  const gb = new ModelBuilder();
  gb.cyl(0.24, 0.24, 0.18, 10, TYRE, { at: [0, -1.42, 3.5], rot: ALONG_X });
  for (const s of [-1, 1]) {
    gb.cyl(0.3, 0.3, 0.22, 10, TYRE, { at: [s * 1.8, -1.38, 0.3], rot: ALONG_X });
    gb.box(0.14, 0.72, 0.18, STEEL, { at: [s * 1.8, -1.0, 0.3] });
  }
  gb.box(0.14, 0.78, 0.16, STEEL, { at: [0, -1.04, 3.5] });
  body.add(materials.group(gb));

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

  const mGun = makeMarker(body, 0.08, -0.22, 6.2);
  const mLeft = makeMarker(body, 2.8, -0.68, 0.6);
  const mRight = makeMarker(body, -2.8, -0.68, 0.6);
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
    vtolGlow,
    resupplyRing: null,
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
  }
}
