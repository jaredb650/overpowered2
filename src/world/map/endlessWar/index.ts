/**
 * Endless War — Combined-Arms War Front (`map: 'endless_war'`, `contract: 'endless_war'`) map builder.
 *
 * A massive, overcast, war-torn 480 m x 720 m muddy battlefield inside a 2,200 m x 2,200 m x 380 m
 * flyable theater. Deliberately packed with LOS-breaking terrain — interlocking trench networks,
 * bombed-out crossroads town blocks, ruined grain silos, flooded quarry rock walls, blasted pine
 * copses, earthen ridges, burned tank wrecks, a 60 m sunken river funneled across 3 fortified
 * bridges, 5 enemy strategic facility compounds, Friendly FOB Vanguard, and North Fortress Iron Bastion.
 */
import * as THREE from 'three';
import type { SpawnPoint } from '../../../core/contracts';
import type { StructuralClusterSpec, StructuralNodeSpec } from '../../destruction';
import { FACE, type Mat } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import { cable, pipe, scrapHeap, truck, tyres } from '../../kit/props';
import { floorStencil, stencil } from '../../kit/stencil';
import type { MapSpec } from '../spec';
import {
  ENDLESS_WAR_AIRCRAFT_PAD,
  ENDLESS_WAR_ATMOSPHERE,
  ENDLESS_WAR_BOUNDS,
  ENDLESS_WAR_CROSSINGS,
  ENDLESS_WAR_ENEMY_LANES,
  ENDLESS_WAR_ENEMY_SPAWNS,
  ENDLESS_WAR_FACILITIES,
  ENDLESS_WAR_FOB_CORE,
  ENDLESS_WAR_FOB_TURRETS,
  ENDLESS_WAR_FRAME_PAD,
  ENDLESS_WAR_FRIENDLY_LANES,
  ENDLESS_WAR_HUB_PT,
  ENDLESS_WAR_LEVELS,
  ENDLESS_WAR_LIGHT_BOUNDS,
  ENDLESS_WAR_LIGHT_CELL,
  ENDLESS_WAR_NAV_BOUNDS,
  ENDLESS_WAR_PICKUP_SPOTS,
  ENDLESS_WAR_PLAYER_SPAWN,
  ENDLESS_WAR_PLAYER_YAW,
  ENDLESS_WAR_PROCUREMENT_POD,
  ENDLESS_WAR_RIVER_Z0,
  ENDLESS_WAR_RIVER_Z1,
  ENDLESS_WAR_TERMINAL,
  ENDLESS_WAR_VEHICLE_PAD,
  ENDLESS_WAR_WAR_CONSOLE,
  ENDLESS_WAR_WATER_Y,
  WAR_PALETTE,
  type Rgb,
  type Vec2,
} from './plan';

export {
  ENDLESS_WAR_ATMOSPHERE,
  ENDLESS_WAR_BOUNDS,
  ENDLESS_WAR_LEVELS,
  ENDLESS_WAR_LIGHT_BOUNDS,
  ENDLESS_WAR_LIGHT_CELL,
  ENDLESS_WAR_NAV_BOUNDS,
};
export * from './plan';

export const ENDLESS_WAR_HUB = new THREE.Vector3(ENDLESS_WAR_HUB_PT[0], ENDLESS_WAR_HUB_PT[1], ENDLESS_WAR_HUB_PT[2]);

const STAGES_BUILT = new WeakSet<MapSpec>();
const GROUND_THICK = 1.0;

// ---------------------------------------------------------------------------
// Low-level Geometry & Terrain Helpers
// ---------------------------------------------------------------------------

function groundPatch(
  k: Kit,
  mat: Mat,
  tint: Rgb,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y: number,
  step: number,
): void {
  const g = k.geo.use(mat).tint(tint[0], tint[1], tint[2]);
  const nu = Math.max(1, Math.min(24, Math.ceil(Math.abs(x1 - x0) / step)));
  const nv = Math.max(1, Math.min(24, Math.ceil(Math.abs(z1 - z0) / step)));
  g.grid(x0, y, z1, x1 - x0, 0, 0, 0, 0, z0 - z1, nu, nv);
  g.tint(1);
}

function solidBox(
  k: Kit,
  cx: number,
  cy: number,
  cz: number,
  hx: number,
  hy: number,
  hz: number,
  mat: Mat,
  opts?: { tint?: Rgb },
): void {
  const g = k.geo.use(mat);
  if (opts?.tint) g.tint(opts.tint[0], opts.tint[1], opts.tint[2]);
  g.box(cx, cy, cz, hx, hy, hz, FACE.all);
  g.tint(1);
  const surface = mat === 'dirt' ? 'dirt' : (mat === 'steelDark' || mat === 'steel' || mat === 'rust') ? 'metal' : 'concrete';
  k.collide(cx, cy, cz, hx, hy, hz, surface);
}

function drawRoad(k: Kit, pts: readonly Vec2[], width: number, mat: Mat = 'asphalt', tint: Rgb = WAR_PALETTE.tarmac, markings = true): void {
  const g = k.geo;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    k.along(a[0], 0.025, a[1], b[0], 0.025, b[1], len => {
      g.use(mat).tint(tint[0], tint[1], tint[2]);
      g.box(len / 2, 0.005, 0, len / 2 + 1.4, 0.005, width / 2, FACE.py);
      if (markings) {
        g.use('dirt').tint(0.18, 0.16, 0.13);
        for (const s of [-1, 1]) {
          g.box(len / 2, 0.009, s * (width * 0.45), len / 2 + 0.6, 0.003, 0.45, FACE.py);
        }
        g.use('paintYellow').tint(0.66, 0.56, 0.30);
        for (let u = 4; u < len - 4; u += 12) {
          g.box(u, 0.011, 0, 2.4, 0.003, 0.14, FACE.py);
        }
      } else {
        g.use('dirt').tint(0.16, 0.14, 0.11);
        for (const s of [-1, 1]) {
          g.box(len / 2, 0.009, s * (width * 0.28), len / 2 + 1.0, 0.003, 0.65, FACE.py);
        }
      }
      g.tint(1);
    });
  }
}

/** Raised muddy earthwork ridge / hill crest that physically breaks ground line-of-sight. */
function mudRidge(
  k: Kit,
  spec: MapSpec,
  x: number,
  z: number,
  len: number,
  w: number,
  h: number,
  yaw: number,
  collide = true,
): void {
  const g = k.geo;
  const hl = len / 2;
  const hw = w / 2;
  const topL = hl * 0.62;
  const topW = hw * 0.36;
  k.push(x, 0, z, yaw);

  // Sloped earthen sides + grass-mud crest
  g.use('dirt').tint(WAR_PALETTE.mudGrass[0], WAR_PALETTE.mudGrass[1], WAR_PALETTE.mudGrass[2]);
  g.quad(-topL, h, topW, topL, h, topW, topL, h, -topW, -topL, h, -topW);

  g.use('dirt').tint(WAR_PALETTE.mudBase[0], WAR_PALETTE.mudBase[1], WAR_PALETTE.mudBase[2]);
  g.quad(-hl, 0, hw, hl, 0, hw, topL, h, topW, -topL, h, topW);
  g.use('dirt').tint(WAR_PALETTE.mudDark[0], WAR_PALETTE.mudDark[1], WAR_PALETTE.mudDark[2]);
  g.quad(hl, 0, -hw, -hl, 0, -hw, -topL, h, -topW, topL, h, -topW);

  g.use('dirt').tint(WAR_PALETTE.hillRock[0], WAR_PALETTE.hillRock[1], WAR_PALETTE.hillRock[2]);
  g.quad(-hl, 0, -hw, -hl, 0, hw, -topL, h, topW, -topL, h, -topW);
  g.quad(hl, 0, hw, hl, 0, -hw, topL, h, -topW, topL, h, topW);
  g.tint(1);

  if (collide) {
    k.noClimb(() => k.collide(0, h * 0.45, 0, hl * 0.78, h * 0.45, hw * 0.62, 'dirt'));
    const c = Math.abs(Math.cos(yaw));
    const s = Math.abs(Math.sin(yaw));
    const ex = hl * 0.78 * c + hw * 0.62 * s;
    const ez = hl * 0.78 * s + hw * 0.62 * c;
    spec.plan?.blocks.push({ x0: x - ex, z0: z - ez, x1: x + ex, z1: z + ez });
  }
  k.pop();
}

/** Artillery shell crater with dark scorched mud rim and churned earth ring. */
function shellCrater(k: Kit, x: number, z: number, r: number): void {
  const g = k.geo;
  g.use('dirt').tint(0.16, 0.14, 0.12);
  g.box(x, 0.015, z, r * 0.75, 0.015, r * 0.75, FACE.py);
  // Muddy raised lip segments
  g.use('dirt').tint(WAR_PALETTE.mudDark[0], WAR_PALETTE.mudDark[1], WAR_PALETTE.mudDark[2]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + (x * 0.13);
    const rx = x + Math.cos(a) * r * 0.92;
    const rz = z + Math.sin(a) * r * 0.92;
    g.box(rx, 0.24, rz, r * 0.36, 0.24, r * 0.28, FACE.all & ~FACE.ny);
  }
  g.tint(1);
}

/** Cluster of artillery-blasted dark pine trunks, shattered limbs, and jagged stumps (breaks mid-range LOS). */
function blastedTreeCopse(k: Kit, x: number, z: number, count: number, radius: number, seed: number): void {
  const g = k.geo;
  for (let i = 0; i < count; i++) {
    const h1 = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
    const h2 = Math.sin(seed * 93.989 + i * 37.719) * 19283.4123;
    const f1 = h1 - Math.floor(h1);
    const f2 = h2 - Math.floor(h2);
    const ang = f1 * Math.PI * 2;
    const dist = Math.sqrt(f2) * radius;
    const tx = x + Math.cos(ang) * dist;
    const tz = z + Math.sin(ang) * dist;
    const tall = 4.2 + (f1 * 6.8);
    const leanX = (f2 - 0.5) * 0.9;
    const leanZ = (f1 - 0.5) * 0.9;

    // Charred trunk
    g.use('plywood').tint(0.22, 0.19, 0.16);
    g.cyl(tx, 0, tz, tx + leanX, tall, tz + leanZ, 0.24, 0.07, 5, false, true);

    // Jagged surviving boughs & olive needles on taller trees
    if (tall > 6.5) {
      g.use('dirt').tint(0.18, 0.22, 0.15);
      for (let b = 0; b < 3; b++) {
        const by = tall * (0.45 + b * 0.2);
        const ba = ang + b * 2.15;
        const bx = tx + leanX * (by / tall);
        const bz = tz + leanZ * (by / tall);
        g.box(bx + Math.cos(ba) * 0.95, by, bz + Math.sin(ba) * 0.95, 1.15, 0.32, 0.72, FACE.all);
      }
    }
  }
  g.tint(1);
}

/** Military trench redoubt with raised sandbag firing parapets, duckboards, dugout roof, and barbed-wire stakes. */
function trenchRedoubt(k: Kit, spec: MapSpec, x: number, z: number, length: number, yaw: number, enemyOwned = false): void {
  const g = k.geo;
  const hl = length / 2;
  k.push(x, 0, z, yaw);

  // Muddy duckboard floor trench lane
  g.use('plywood').tint(WAR_PALETTE.timber[0], WAR_PALETTE.timber[1], WAR_PALETTE.timber[2]);
  g.box(0, 0.03, 0, hl, 0.03, 1.45, FACE.py);

  // Front raised sandbag + earth parapet facing the enemy (breaks eye-level LOS when crouched, firing slots across top)
  const frontZ = enemyOwned ? 1.85 : -1.85;
  const backZ = -frontZ;
  const bagTint = enemyOwned ? [0.46, 0.41, 0.34] : WAR_PALETTE.sandbag;

  // Left & right parapet wings with center firing slit gap
  for (const sx of [-1, 1]) {
    const wx = sx * (hl * 0.54);
    const wLen = hl * 0.42;
    solidBox(k, wx, 0.85, frontZ, wLen, 0.85, 0.62, 'dirt', { tint: bagTint as Rgb });
    // Timber revetment posts on inside face
    g.use('plywood').tint(0.32, 0.24, 0.18);
    g.box(wx, 0.75, frontZ * 0.68, wLen, 0.75, 0.10, FACE.all & ~FACE.ny);
    // Low parados berm behind trench
    solidBox(k, wx, 0.52, backZ, wLen * 0.82, 0.52, 0.45, 'dirt', { tint: WAR_PALETTE.mudDark });
  }

  // Overhead corrugated-iron & sandbag dugout shelter at one end (tall ~2.7 m solid LOS blocker)
  const dugX = -hl * 0.68;
  solidBox(k, dugX, 1.35, 0, 2.4, 0.22, 2.2, 'rust', { tint: WAR_PALETTE.rustSteel });
  solidBox(k, dugX, 1.65, 0, 2.2, 0.26, 2.0, 'dirt', { tint: bagTint as Rgb });
  for (const sx of [-2.1, 2.1]) {
    for (const sz of [-1.8, 1.8]) {
      g.use('plywood').tint(0.30, 0.23, 0.17);
      g.box(dugX + sx, 0.68, sz, 0.14, 0.68, 0.14, FACE.all);
    }
  }

  // Barbed-wire X-stakes out in front of the parapet
  const wireZ = frontZ + (enemyOwned ? 2.4 : -2.4);
  g.use('rust').tint(0.34, 0.28, 0.24);
  for (let wx = -hl + 2; wx <= hl - 2; wx += 4.5) {
    g.cyl(wx - 0.5, 0, wireZ - 0.4, wx + 0.5, 1.05, wireZ + 0.4, 0.04, 0.04, 4);
    g.cyl(wx + 0.5, 0, wireZ - 0.4, wx - 0.5, 1.05, wireZ + 0.4, 0.04, 0.04, 4);
  }
  g.tint(1);

  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  const ex = hl * c + 2.4 * s;
  const ez = hl * s + 2.4 * c;
  spec.plan?.blocks.push({ x0: x - ex, z0: z - ez, x1: x + ex, z1: z + ez });
  k.pop();
}

/** Multi-story bombed-out masonry war-town ruin (7–11 m tall!) — major sightline blocker with walk-through doorways. */
function ruinedBuilding(
  k: Kit,
  spec: MapSpec,
  x: number,
  z: number,
  w: number,
  d: number,
  floors: 1 | 2 | 3,
  yaw: number,
  tint: Rgb = WAR_PALETTE.brickRuins,
): void {
  const g = k.geo;
  const hw = w / 2;
  const hd = d / 2;
  const H = floors * 3.4;
  const wt = 0.34;
  k.push(x, 0, z, yaw);

  // Rubble-strewn concrete interior slab
  g.use('concreteDark').tint(0.32, 0.33, 0.34);
  g.box(0, 0.04, 0, hw - 0.2, 0.04, hd - 0.2, FACE.py);

  // Back solid wall (tallest surviving facade — major LOS breaker)
  solidBox(k, 0, H * 0.5, -hd, hw, H * 0.5, wt, 'concrete', { tint });

  // Side walls — one full height, one jagged stepped collapse
  solidBox(k, -hw, H * 0.46, 0, wt, H * 0.46, hd, 'concrete', { tint: [tint[0] * 0.9, tint[1] * 0.9, tint[2] * 0.9] });
  solidBox(k, hw, H * 0.32, -hd * 0.22, wt, H * 0.32, hd * 0.78, 'concrete', { tint: [tint[0] * 0.85, tint[1] * 0.85, tint[2] * 0.85] });

  // Front facade with wide walk-through doorway gap (3.2 m wide)
  const wing = Math.max(1.2, (w - 3.4) / 2);
  const fH = floors >= 2 ? H * 0.42 : H * 0.85;
  solidBox(k, -hw + wing / 2, fH * 0.5, hd, wing / 2, fH * 0.5, wt, 'concrete', { tint });
  solidBox(k, hw - wing / 2, fH * 0.5, hd, wing / 2, fH * 0.5, wt, 'concrete', { tint });

  // Partially collapsed second-floor slab & exposed rusted steel girders
  if (floors >= 2) {
    g.use('concreteDark').tint(0.34, 0.35, 0.36);
    g.box(-hw * 0.32, 3.45, -hd * 0.25, hw * 0.62, 0.16, hd * 0.65, FACE.all);
    g.use('rust').tint(0.36, 0.25, 0.19);
    for (let i = -1; i <= 1; i++) {
      g.box(i * (hw * 0.42), 3.42, 0, 0.11, 0.14, hd * 0.92, FACE.all);
    }
  }
  if (floors === 3) {
    g.use('concrete').tint(tint[0] * 0.82, tint[1] * 0.82, tint[2] * 0.82);
    g.box(-hw * 0.35, 7.2, -hd, hw * 0.58, 1.5, wt * 0.9, FACE.all);
    g.box(-hw, 7.0, -hd * 0.35, wt * 0.9, 1.3, hd * 0.55, FACE.all);
  }

  // Rubble pile inside broken corner
  solidBox(k, hw * 0.55, 0.55, hd * 0.45, hw * 0.32, 0.55, hd * 0.32, 'dirt', { tint: [0.34, 0.32, 0.30] });
  g.tint(1);

  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  spec.plan?.blocks.push({
    x0: x - (hw * c + hd * s),
    z0: z - (hw * s + hd * c),
    x1: x + (hw * c + hd * s),
    z1: z + (hw * s + hd * c),
  });
  k.pop();
}

/** Heavy reinforced concrete pillbox / casemate bunker with firing embrasures and sandbag wings. */
function bunkerCasemate(k: Kit, spec: MapSpec, x: number, z: number, yaw: number, enemyOwned = false): void {
  const g = k.geo;
  k.push(x, 0, z, yaw);
  const wallTint = enemyOwned ? WAR_PALETTE.darkConcrete : WAR_PALETTE.wetConcrete;
  // Thick roof slab
  solidBox(k, 0, 2.75, 0, 4.4, 0.45, 3.6, 'concreteDark', { tint: [0.28, 0.30, 0.32] });
  // Side & front lower walls leaving firing slit at y = 1.4..2.3
  solidBox(k, -3.8, 1.2, 0, 0.55, 1.2, 3.1, 'concrete', { tint: wallTint });
  solidBox(k, 3.8, 1.2, 0, 0.55, 1.2, 3.1, 'concrete', { tint: wallTint });
  solidBox(k, 0, 0.72, 2.95, 3.4, 0.72, 0.52, 'concrete', { tint: wallTint });
  // Rear wall with doorway
  solidBox(k, -2.4, 1.2, -2.95, 1.3, 1.2, 0.45, 'concrete', { tint: wallTint });
  solidBox(k, 2.4, 1.2, -2.95, 1.3, 1.2, 0.45, 'concrete', { tint: wallTint });
  // Sandbag flank wings
  solidBox(k, -5.3, 0.75, 1.2, 1.2, 0.75, 0.55, 'dirt', { tint: WAR_PALETTE.sandbag });
  solidBox(k, 5.3, 0.75, 1.2, 1.2, 0.75, 0.55, 'dirt', { tint: WAR_PALETTE.sandbag });
  // Red or blue indicator lamp inside embrasure
  g.use(enemyOwned ? 'emissiveRed' : 'emissiveCyan').tint(1);
  g.box(0, 2.25, 2.55, 0.55, 0.10, 0.10, FACE.all);
  g.tint(1);

  spec.plan?.blocks.push({ x0: x - 5.2, z0: z - 4.0, x1: x + 5.2, z1: z + 4.0 });
  k.pop();
}

/** Burned-out tank carcass, wrecked truck, or derailed rail boxcar creating authentic battlefield cover. */
function wreckedArmor(k: Kit, spec: MapSpec, x: number, z: number, yaw: number, kind: 'tank' | 'truck' | 'boxcar'): void {
  const g = k.geo;
  k.push(x, 0, z, yaw);
  if (kind === 'tank') {
    // Charred tracked hull + askew turret & drooping barrel
    solidBox(k, 0, 0.78, 0, 1.9, 0.72, 3.4, 'steelDark', { tint: [0.22, 0.21, 0.20] });
    g.use('rust').tint(0.32, 0.22, 0.17);
    g.box(0.25, 1.72, -0.2, 1.25, 0.44, 1.45, FACE.all);
    g.cyl(0.25, 1.78, 1.1, 0.55, 1.45, 4.1, 0.12, 0.10, 6);
    // Track skirts
    g.use('steelDark').tint(0.16, 0.16, 0.16);
    for (const sx of [-1.85, 1.85]) g.box(sx, 0.48, 0, 0.28, 0.46, 3.55, FACE.all);
    spec.plan?.blocks.push({ x0: x - 3.6, z0: z - 3.6, x1: x + 3.6, z1: z + 3.6 });
  } else if (kind === 'boxcar') {
    solidBox(k, 0, 1.95, 0, 1.65, 1.55, 6.2, 'rust', { tint: [0.36, 0.24, 0.20] });
    g.use('steelDark').tint(0.20, 0.20, 0.22);
    g.box(0, 0.35, 0, 1.45, 0.32, 5.8, FACE.all);
    spec.plan?.blocks.push({ x0: x - 6.2, z0: z - 6.2, x1: x + 6.2, z1: z + 6.2 });
  } else {
    truck(k, 0, 0, 0, 0);
    spec.plan?.blocks.push({ x0: x - 4.0, z0: z - 4.0, x1: x + 4.0, z1: z + 4.0 });
  }
  g.tint(1);
  k.pop();
}

/** Concrete anti-tank dragon's teeth row (blocks vehicles, infantry weave through). */
function dragonsTeeth(k: Kit, x0: number, z0: number, x1: number, z1: number, spacing = 3.2): void {
  const g = k.geo;
  const dist = Math.hypot(x1 - x0, z1 - z0);
  const count = Math.max(2, Math.floor(dist / spacing));
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const x = x0 + (x1 - x0) * t;
    const z = z0 + (z1 - z0) * t;
    g.use('concrete').tint(0.44, 0.45, 0.46);
    g.box(x, 0.45, z, 0.52, 0.45, 0.52, FACE.all & ~FACE.ny);
    g.box(x, 1.05, z, 0.30, 0.28, 0.30, FACE.all & ~FACE.ny);
    k.noClimb(() => k.collide(x, 0.62, z, 0.50, 0.62, 0.50, 'concrete'));
  }
  g.tint(1);
}

/** Overhead rusted steel power transmission pylon (adds dramatic scale & vertical reference). */
function powerPylon(k: Kit, x: number, z: number, yaw = 0): void {
  const g = k.geo;
  k.push(x, 0, z, yaw);
  g.use('rust').tint(0.32, 0.28, 0.25);
  for (const sx of [-1.4, 1.4]) {
    for (const sz of [-1.4, 1.4]) {
      g.cyl(sx, 0, sz, sx * 0.28, 16.5, sz * 0.28, 0.14, 0.08, 4);
    }
  }
  g.box(0, 12.2, 0, 4.4, 0.22, 0.32, FACE.all);
  g.box(0, 15.2, 0, 3.2, 0.20, 0.28, FACE.all);
  k.noClimb(() => k.collide(0, 2.0, 0, 1.5, 2.0, 1.5, 'metal'));
  g.tint(1);
  k.pop();
}

/** Tier-0 destructible wooden watchtower / ammo shack scattered across No-Man's-Land. */
function buildFieldWatchtower(id: string, x: number, z: number, yaw: number): StructuralClusterSpec {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const pt = (lx: number, ly: number, lz: number): [number, number, number] => [
    x + lx * c + lz * s,
    ly,
    z - lx * s + lz * c,
  ];
  const H = 3.8;
  const W = 1.8;
  const D = 1.6;
  const nodes: StructuralNodeSpec[] = [
    { id: 'stilt_fl', pos: pt(-W, H / 2, D), half: [0.18, H / 2, 0.18], mat: 'plywood', color: 0x524234, hp: 95, tier: 0, anchored: true, kind: 'column', yaw, materialClass: 'wood' },
    { id: 'stilt_fr', pos: pt(W, H / 2, D), half: [0.18, H / 2, 0.18], mat: 'plywood', color: 0x524234, hp: 95, tier: 0, anchored: true, kind: 'column', yaw, materialClass: 'wood' },
    { id: 'stilt_bl', pos: pt(-W, H / 2, -D), half: [0.18, H / 2, 0.18], mat: 'plywood', color: 0x48382c, hp: 95, tier: 0, anchored: true, kind: 'column', yaw, materialClass: 'wood' },
    { id: 'stilt_br', pos: pt(W, H / 2, -D), half: [0.18, H / 2, 0.18], mat: 'plywood', color: 0x48382c, hp: 95, tier: 0, anchored: true, kind: 'column', yaw, materialClass: 'wood' },
    { id: 'deck', pos: pt(0, H + 0.14, 0), half: [W + 0.35, 0.14, D + 0.35], mat: 'plywood', color: 0x62503e, hp: 110, tier: 0, anchored: false, kind: 'slab', yaw, impactRadius: 6.5, materialClass: 'wood' },
    { id: 'parapet', pos: pt(0, H + 0.72, D), half: [W + 0.25, 0.5, 0.18], mat: 'dirt', color: 0x766c58, hp: 100, tier: 0, anchored: false, kind: 'wall', yaw, materialClass: 'stone' },
    { id: 'roof', pos: pt(0, H + 2.35, 0), half: [W + 0.5, 0.12, D + 0.5], mat: 'rust', color: 0x5d4438, hp: 105, tier: 0, anchored: false, kind: 'roof', yaw, impactRadius: 6.5, materialClass: 'metal' },
    { id: 'fuel_drum', pos: pt(W + 0.85, 0.55, D + 0.3), half: [0.42, 0.55, 0.42], mat: 'paintRed', color: 0xb8261e, hp: 35, tier: 0, anchored: true, kind: 'hazard', yaw, hazardRadius: 9.0, hazardDamage: 240, materialClass: 'metal' },
  ];
  return {
    id,
    kind: 'watchtower',
    label: 'FIELD WATCHTOWER',
    nodes,
  };
}

// ---------------------------------------------------------------------------
// Stage 1: Overcast Mud Valley, Split River Gorge, Roads & Distant Theater Rim
// ---------------------------------------------------------------------------

function stageTerrainAndSky(k: Kit, spec: MapSpec): void {
  const g = k.geo;

  // 1a. Split ground floor — South Bank (z in [+30, +360]) & North Bank (z in [-360, -30])
  // Leaving z in (-30, +30) open for the sunken river gorge so NavGraph strictly routes across the 3 bridges!
  groundPatch(k, 'dirt', WAR_PALETTE.mudBase, -240, ENDLESS_WAR_RIVER_Z1, 240, 360, 0, 24);
  groundPatch(k, 'dirt', WAR_PALETTE.mudBase, -240, -360, 240, ENDLESS_WAR_RIVER_Z0, 0, 24);

  // Dark churned mud & moss-grass patches across the front for rich surface variation
  groundPatch(k, 'dirt', WAR_PALETTE.mudGrass, -230, 140, -60, 250, 0.012, 20);
  groundPatch(k, 'dirt', WAR_PALETTE.mudGrass, 60, 140, 230, 250, 0.012, 20);
  groundPatch(k, 'dirt', WAR_PALETTE.mudDark, -195, 36, 195, 138, 0.014, 24);
  groundPatch(k, 'dirt', WAR_PALETTE.mudDark, -195, -138, 195, -36, 0.014, 24);
  groundPatch(k, 'dirt', WAR_PALETTE.mudGrass, -230, -250, -70, -140, 0.012, 20);
  groundPatch(k, 'dirt', WAR_PALETTE.mudGrass, 70, -250, 230, -140, 0.012, 20);

  // Physics ground slabs (South bank + North bank)
  k.noClimb(() => {
    k.collide(0, -GROUND_THICK / 2, 195, 244, GROUND_THICK / 2, 165, 'dirt');
    k.collide(0, -GROUND_THICK / 2, -195, 244, GROUND_THICK / 2, 165, 'dirt');
  });

  // 1b. Sunken 60 m River Gorge (visual water at y = -3.0, sloped banks, riverbed far below)
  groundPatch(k, 'concreteDark', WAR_PALETTE.riverWater, -1100, ENDLESS_WAR_RIVER_Z0 - 2, 1100, ENDLESS_WAR_RIVER_Z1 + 2, ENDLESS_WAR_WATER_Y, 64);
  // Subtle current foam streaks along the dark river surface
  g.use('paintWhite').tint(0.36, 0.42, 0.45);
  for (let rx = -220; rx <= 220; rx += 34) {
    g.box(rx, ENDLESS_WAR_WATER_Y + 0.03, ((rx * 7) % 18) - 9, 9.5, 0.01, 0.55, FACE.py);
  }
  // Steep mud river embankments along both banks (except bridge deck footprints)
  g.use('dirt').tint(WAR_PALETTE.riverBank[0], WAR_PALETTE.riverBank[1], WAR_PALETTE.riverBank[2]);
  g.quad(-244, 0, ENDLESS_WAR_RIVER_Z1, 244, 0, ENDLESS_WAR_RIVER_Z1, 244, ENDLESS_WAR_WATER_Y - 0.5, ENDLESS_WAR_RIVER_Z1 - 5.5, -244, ENDLESS_WAR_WATER_Y - 0.5, ENDLESS_WAR_RIVER_Z1 - 5.5);
  g.quad(244, 0, ENDLESS_WAR_RIVER_Z0, -244, 0, ENDLESS_WAR_RIVER_Z0, -244, ENDLESS_WAR_WATER_Y - 0.5, ENDLESS_WAR_RIVER_Z0 + 5.5, 244, ENDLESS_WAR_WATER_Y - 0.5, ENDLESS_WAR_RIVER_Z0 + 5.5);
  g.tint(1);

  // Invisible deep riverbed collider so fallen players/wrecks hit mud instead of falling into void
  k.noClimb(() => k.collide(0, -4.6, 0, 260, 0.5, 32, 'dirt'));

  // 1c. Outer Battlefield Apron & Scenic Valley Floor extending to +-1,600 m for high-altitude jet sorties
  groundPatch(k, 'dirt', [0.24, 0.22, 0.19], -1600, -1600, 1600, -360, -0.35, 160);
  groundPatch(k, 'dirt', [0.24, 0.22, 0.19], -1600, 360, 1600, 1600, -0.35, 160);
  groundPatch(k, 'dirt', [0.24, 0.22, 0.19], -1600, -360, -240, 360, -0.35, 160);
  groundPatch(k, 'dirt', [0.24, 0.22, 0.19], 240, -360, 1600, 360, -0.35, 160);

  // Border ridges sealing the East & West battlefield edges (x = +-248 m) so ground units stay inside the valley
  for (const sx of [-1, 1]) {
    for (let rz = -320; rz <= 320; rz += 80) {
      if (Math.abs(rz) < 42) continue; // Let the river cut cleanly through the valley walls
      mudRidge(k, spec, sx * 246, rz, 86, 26, 11.5 + (Math.abs(rz) % 5), Math.PI / 2, true);
    }
    // Perimeter boundary colliders
    k.noClimb(() => k.collide(sx * 242, 6, 0, 2, 12, 364, 'dirt'));
  }
  for (const sz of [-362, 362]) {
    k.noClimb(() => k.collide(0, 6, sz, 244, 12, 2, 'dirt'));
  }

  // Towering distant mountain ring out at 520–1,050 m (visual-only for thrilling aircraft backdrop)
  const mountainRing: readonly [number, number, number, number, number, number][] = [
    [-760, -740, 420, 190, 96, 0.4],
    [0, -860, 520, 210, 118, 0.05],
    [760, -720, 440, 190, 102, -0.45],
    [-820, -180, 460, 180, 88, 1.48],
    [820, -160, 460, 180, 94, 1.62],
    [-820, 380, 440, 180, 84, 1.52],
    [820, 400, 440, 180, 82, 1.55],
    [-680, 820, 420, 180, 78, -0.35],
    [0, 880, 520, 190, 86, 0.0],
    [680, 820, 420, 180, 80, 0.38],
  ];
  for (const [mx, mz, ml, mw, mh, myaw] of mountainRing) {
    mudRidge(k, spec, mx, mz, ml, mw, mh, myaw, false);
  }

  // High-altitude overcast storm-cloud deck (y = 225..285 m) so jets climb into clouds and dive onto targets!
  const cloudPuffs: readonly [number, number, number, number, number][] = [
    [-540, 242, -520, 185, 16], [120, 255, -620, 210, 18], [580, 248, -420, 195, 16],
    [-620, 250, 40, 190, 16], [-140, 268, -110, 220, 18], [460, 252, 80, 195, 16],
    [-480, 244, 520, 185, 16], [80, 258, 560, 210, 18], [560, 246, 480, 190, 16],
  ];
  g.use('concrete').tint(WAR_PALETTE.cloudGray[0], WAR_PALETTE.cloudGray[1], WAR_PALETTE.cloudGray[2]);
  for (const [cx, cy, cz, cr, ch] of cloudPuffs) {
    g.box(cx, cy, cz, cr, ch * 0.5, cr * 0.72, FACE.all);
    g.box(cx + cr * 0.32, cy - ch * 0.25, cz - cr * 0.22, cr * 0.65, ch * 0.42, cr * 0.56, FACE.all);
  }
  g.tint(1);

  // 1d. Main Paved Highway (Center) & Muddy Armor Supply Roads (West, East, Lateral Connectors)
  drawRoad(k, ENDLESS_WAR_FRIENDLY_LANES.center, 15.0, 'asphalt', WAR_PALETTE.tarmac, true);
  drawRoad(k, ENDLESS_WAR_FRIENDLY_LANES.west, 11.5, 'dirt', WAR_PALETTE.mudTrack, false);
  drawRoad(k, ENDLESS_WAR_FRIENDLY_LANES.east, 11.5, 'dirt', WAR_PALETTE.mudTrack, false);
  // Lateral cross-front supply roads
  drawRoad(k, [[-170, 175], [0, 175], [170, 175]], 9.5, 'dirt', WAR_PALETTE.mudTrack, false);
  drawRoad(k, [[-170, -118], [0, -118], [170, -118]], 9.5, 'dirt', WAR_PALETTE.mudTrack, false);
}

// ---------------------------------------------------------------------------
// Stage 2: South Friendly FOB "Vanguard" (z = +255..+355)
// ---------------------------------------------------------------------------

function stageFriendlyFob(k: Kit, spec: MapSpec): void {
  const g = k.geo;

  // Paved concrete FOB apron
  groundPatch(k, 'concreteDark', [0.34, 0.36, 0.38], -185, 260, 185, 352, 0.02, 16);
  groundPatch(k, 'concrete', [0.44, 0.46, 0.48], -74, 274, 62, 344, 0.028, 12);

  // 170 m West-Wing Concrete Airstrip (x = -210, z = +346 -> +176) aimed straight North (-Z)
  groundPatch(k, 'asphalt', [0.22, 0.23, 0.25], -224, 176, -196, 348, 0.026, 16);
  g.use('paintWhite').tint(0.84, 0.86, 0.88);
  for (const sx of [-222.2, -197.8]) g.box(sx, 0.036, 262, 0.28, 0.005, 84, FACE.py);
  for (let rz = 186; rz <= 334; rz += 16) g.box(-210, 0.036, rz, 0.35, 0.005, 4.5, FACE.py);
  // Threshold piano-key stripes
  for (let i = -3; i <= 3; i++) {
    if (i === 0) continue;
    g.box(-210 + i * 2.6, 0.038, 341, 0.85, 0.005, 3.6, FACE.py);
  }
  // Runway edge amber beacon posts
  for (let rz = 188; rz <= 344; rz += 26) {
    for (const sx of [-225.2, -194.8]) {
      g.use('steelDark').tint(0.28).box(sx, 0.42, rz, 0.14, 0.42, 0.14, FACE.all);
      g.use('paintYellow').tint(1.2, 0.95, 0.35).box(sx, 0.88, rz, 0.22, 0.14, 0.22, FACE.all);
    }
  }
  g.tint(1);

  // Fortified FOB Perimeter Wall (z = +258) with 3 wide 28 m armored gates at x = -145, 0, +145
  // Note: West runway at x = -210 stays 100% open to the north!
  const frontSegments: readonly [number, number][] = [
    [-190, -160],
    [-130, -15],
    [15, 130],
    [160, 190],
  ];
  for (const [x0, x1] of frontSegments) {
    const cx = (x0 + x1) / 2;
    const hx = (x1 - x0) / 2;
    solidBox(k, cx, 2.6, 258, hx, 2.6, 1.35, 'concrete', { tint: WAR_PALETTE.wetConcrete });
    // Sloped concrete crenellation & sandbag crown
    g.use('dirt').tint(WAR_PALETTE.sandbag[0], WAR_PALETTE.sandbag[1], WAR_PALETTE.sandbag[2]);
    g.box(cx, 5.45, 257.4, hx - 0.5, 0.38, 0.65, FACE.all);
    // Exterior buttresses every 14 m
    g.use('concreteDark').tint(0.32, 0.34, 0.36);
    for (let bx = x0 + 6; bx <= x1 - 6; bx += 14) {
      g.box(bx, 1.9, 256.1, 0.65, 1.9, 0.85, FACE.all);
    }
  }
  // Gatehouse twin armored pylons flanking all 3 gates
  for (const gx of [-145, 0, 145]) {
    for (const sx of [-15, 15]) {
      solidBox(k, gx + sx, 3.6, 258, 1.8, 3.6, 2.2, 'concreteDark', { tint: [0.32, 0.35, 0.38] });
      g.use('emissiveCyan').tint(0.45, 0.85, 1.2).box(gx + sx, 6.8, 256.8, 1.2, 0.24, 0.14, FACE.all);
    }
  }
  // Rear & side FOB walls
  solidBox(k, 0, 2.4, 352, 190, 2.4, 1.3, 'concrete', { tint: WAR_PALETTE.wetConcrete });
  solidBox(k, 190, 2.4, 305, 1.3, 2.4, 47, 'concrete', { tint: WAR_PALETTE.wetConcrete });
  solidBox(k, -190, 2.4, 305, 1.3, 2.4, 47, 'concrete', { tint: WAR_PALETTE.wetConcrete });

  // 4 Corner Automated CIWS / SAM Bastion Towers
  for (const t of ENDLESS_WAR_FOB_TURRETS) {
    const [tx, , tz] = t.pos;
    solidBox(k, tx, 3.6, tz, 4.4, 3.6, 4.4, 'concreteDark', { tint: [0.30, 0.33, 0.36] });
    g.use('steelDark').tint(0.32, 0.36, 0.40);
    g.box(tx, 7.35, tz, 4.8, 0.22, 4.8, FACE.all);
    g.use(t.kind === 'ciws' ? 'emissiveCyan' : 'paintYellow').tint(0.85, 0.95, 1.1);
    g.box(tx, 6.9, tz, 4.9, 0.14, 4.9, FACE.all & ~FACE.py & ~FACE.ny);
  }

  // FOB Command Core Bunker (Lose-Condition Structure at [0, 0, 336])
  const [fx, , fz] = ENDLESS_WAR_FOB_CORE;
  solidBox(k, fx, 3.4, fz, 9.5, 3.4, 8.2, 'concreteDark', { tint: [0.34, 0.38, 0.42] });
  solidBox(k, fx, 7.4, fz, 6.2, 1.0, 5.4, 'steelDark', { tint: [0.28, 0.34, 0.40] });
  // Armored sloped front glacis + glowing cyan command beacon spire
  g.use('emissiveCyan').tint(0.42, 0.92, 1.25);
  g.box(fx, 4.8, fz - 8.32, 5.2, 0.42, 0.12, FACE.all);
  g.box(fx, 8.6, fz, 3.6, 0.25, 3.6, FACE.all);
  g.use('steelDark').tint(0.36, 0.40, 0.44);
  g.cyl(fx, 8.4, fz, fx, 19.5, fz, 0.55, 0.22, 8);
  g.use('emissiveCyan').tint(0.5, 1.1, 1.4).box(fx, 19.8, fz, 0.72, 0.72, 0.72, FACE.all);
  k.push(fx, 5.9, fz - 8.28, Math.PI);
  stencil(k, 'WAR ROOM', 0, 0, 0, 0.9, [0.45, 0.92, 1.0]);
  k.pop();
  k.light(fx, 11.0, fz - 10, 0x38d8ff, 12, 34);

  // Interactive Kiosk 1: Cyan Motor Pool & Distraint Frame Terminal ([-14, 0, 298])
  {
    const [tx, , tz] = ENDLESS_WAR_TERMINAL;
    solidBox(k, tx, 1.35, tz, 1.6, 1.35, 0.95, 'steelDark', { tint: [0.24, 0.30, 0.36] });
    g.use('emissiveCyan').tint(0.32, 0.92, 1.18).box(tx, 1.65, tz + 0.98, 1.28, 0.78, 0.06, FACE.all);
    g.use('concreteDark').tint(0.32).box(tx, 3.25, tz, 2.4, 0.14, 1.65, FACE.all);
    for (const sx of [-2.1, 2.1]) g.use('steelDark').tint(0.28).box(tx + sx, 1.62, tz, 0.14, 1.62, 0.14, FACE.all);
    stencil(k, 'ARMOURY', tx, 2.85, tz + 0.92, 0.36, [0.35, 0.92, 1.0]);
    k.light(tx, 3.1, tz + 1.4, 0x38e8ff, 6.5, 18);
  }

  // Interactive Kiosk 2: Amber War Command Console ([+14, 0, 298])
  {
    const [wx, , wz] = ENDLESS_WAR_WAR_CONSOLE;
    solidBox(k, wx, 1.35, wz, 1.6, 1.35, 0.95, 'steelDark', { tint: [0.32, 0.27, 0.22] });
    g.use('paintYellow').tint(1.25, 0.82, 0.22).box(wx, 1.65, wz + 0.98, 1.28, 0.78, 0.06, FACE.all);
    g.use('concreteDark').tint(0.32).box(wx, 3.25, wz, 2.4, 0.14, 1.65, FACE.all);
    for (const sx of [-2.1, 2.1]) g.use('steelDark').tint(0.28).box(wx + sx, 1.62, wz, 0.14, 1.62, 0.14, FACE.all);
    stencil(k, 'WAR ROOM', wx, 2.85, wz + 0.92, 0.36, [1.0, 0.78, 0.25]);
    k.light(wx, 3.1, wz + 1.4, 0xffaa33, 6.5, 18);
  }

  // Painted Delivery Pads: Distraint Frame Pad, Vehicle Staging Bay, Procurement Bay
  floorStencil(k, 'CHEVRON', ENDLESS_WAR_FRAME_PAD[0], ENDLESS_WAR_FRAME_PAD[2] + 5.2, 0, 1.6, [0.35, 0.9, 1.0], 0.04);
  floorStencil(k, 'ARMOURY', ENDLESS_WAR_VEHICLE_PAD[0], ENDLESS_WAR_VEHICLE_PAD[2] + 8.5, 0, 1.2, [0.92, 0.84, 0.45], 0.04);
  floorStencil(k, 'CRATES', ENDLESS_WAR_PROCUREMENT_POD[0], ENDLESS_WAR_PROCUREMENT_POD[2] + 4.2, 0, 0.95, [0.65, 0.95, 0.72], 0.04);

  // Hazard paint frames around delivery bays
  g.use('hazard').tint(0.9, 0.82, 0.5);
  for (const [bx, bz, bhx, bhz] of [
    [ENDLESS_WAR_FRAME_PAD[0], ENDLESS_WAR_FRAME_PAD[2], 4.8, 4.8],
    [ENDLESS_WAR_VEHICLE_PAD[0], ENDLESS_WAR_VEHICLE_PAD[2], 7.5, 9.5],
  ] as const) {
    g.box(bx, 0.038, bz - bhz, bhx, 0.006, 0.35, FACE.py);
    g.box(bx, 0.038, bz + bhz, bhx, 0.006, 0.35, FACE.py);
    g.box(bx - bhx, 0.038, bz, 0.35, 0.006, bhz, FACE.py);
    g.box(bx + bhx, 0.038, bz, 0.35, 0.006, bhz, FACE.py);
  }

  // Friendly FOB barracks huts, fuel bladders & comms props (flanking the plaza cleanly)
  solidBox(k, -92, 2.4, 326, 12, 2.4, 6.5, 'concrete', { tint: WAR_PALETTE.oliveArmor });
  solidBox(k, 92, 2.4, 326, 12, 2.4, 6.5, 'concrete', { tint: WAR_PALETTE.oliveArmor });
  solidBox(k, 108, 1.8, 286, 7.5, 1.8, 4.5, 'rust', { tint: WAR_PALETTE.oliveArmor });
  tyres(k, -64, 0, 276, 4);
  tyres(k, 64, 0, 276, 4);
  scrapHeap(k, -116, 310, 4.2, 1.8);
  k.light(0, 10, 296, 0xb8d4f0, 8, 42);
  g.tint(1);
}

// ---------------------------------------------------------------------------
// Stage 3: South Trench Belt & LOS-Breaking Ruined Approaches (z = +30..+255)
// ---------------------------------------------------------------------------

function stageSouthFront(k: Kit, spec: MapSpec): void {
  // 3a. Interlocking South Mud Trench Line (z = +188..+232)
  trenchRedoubt(k, spec, -182, 214, 24, 0.08, false);
  trenchRedoubt(k, spec, -104, 206, 28, -0.06, false);
  trenchRedoubt(k, spec, -44, 218, 28, 0.04, false);
  trenchRedoubt(k, spec, 44, 218, 28, -0.04, false);
  trenchRedoubt(k, spec, 104, 206, 28, 0.06, false);
  trenchRedoubt(k, spec, 182, 214, 24, -0.08, false);

  // Forward trench outposts & pillboxes
  bunkerCasemate(k, spec, -66, 192, Math.PI, false);
  bunkerCasemate(k, spec, 66, 192, Math.PI, false);
  bunkerCasemate(k, spec, -166, 184, Math.PI + 0.18, false);
  bunkerCasemate(k, spec, 166, 184, Math.PI - 0.18, false);

  // Mid-south LOS-breaking muddy knolls & blasted pine forests
  mudRidge(k, spec, -82, 148, 48, 24, 6.2, 0.14, true);
  mudRidge(k, spec, 82, 148, 48, 24, 6.4, -0.16, true);
  mudRidge(k, spec, -206, 118, 34, 22, 7.5, 0.35, true);
  mudRidge(k, spec, 206, 118, 36, 22, 7.8, -0.32, true);

  blastedTreeCopse(k, -94, 154, 14, 22, 11);
  blastedTreeCopse(k, 94, 154, 14, 22, 23);
  blastedTreeCopse(k, -196, 162, 10, 16, 37);
  blastedTreeCopse(k, 196, 162, 10, 16, 41);

  // 3b. CENTER APPROACH: Shattered Crossroads Town (z = +56..+148)
  // Multi-story bombed-out masonry blocks flanking Center Highway (x = -12..+12 stays clear for tanks!)
  ruinedBuilding(k, spec, -26, 134, 14, 12, 2, 0.06, WAR_PALETTE.brickRuins);
  ruinedBuilding(k, spec, 28, 132, 15, 11, 3, -0.08, [0.42, 0.40, 0.38]);
  ruinedBuilding(k, spec, -44, 104, 16, 13, 3, 0.12, [0.46, 0.34, 0.28]);
  ruinedBuilding(k, spec, -22, 86, 12, 11, 2, -0.05, WAR_PALETTE.wetConcrete);
  ruinedBuilding(k, spec, 25, 92, 14, 12, 2, 0.09, WAR_PALETTE.brickRuins);
  ruinedBuilding(k, spec, 48, 106, 15, 13, 3, -0.11, [0.38, 0.37, 0.36]);
  ruinedBuilding(k, spec, -24, 54, 12, 10, 2, 0.04, WAR_PALETTE.wetConcrete);
  ruinedBuilding(k, spec, 26, 54, 13, 10, 2, -0.06, WAR_PALETTE.brickRuins);

  // Burned vehicles, craters & anti-tank traps in the town approaches
  wreckedArmor(k, spec, -11, 118, 0.42, 'tank');
  wreckedArmor(k, spec, 11, 74, -0.58, 'truck');
  wreckedArmor(k, spec, -36, 68, 1.1, 'tank');
  dragonsTeeth(k, -66, 56, -34, 56);
  dragonsTeeth(k, 34, 56, 66, 56);

  // 3c. WEST APPROACH: Ruined Grain Mill, Silos & Rail Siding (x = -195..-110, z = +54..+146)
  ruinedBuilding(k, spec, -172, 114, 16, 14, 3, 0.05, [0.44, 0.42, 0.40]);
  ruinedBuilding(k, spec, -118, 92, 14, 11, 2, -0.08, WAR_PALETTE.brickRuins);
  // Twin tall concrete grain silos (huge silhouette breaking West sightline)
  for (const sz of [126, 136]) {
    k.geo.use('concrete').tint(0.45, 0.46, 0.45);
    k.geo.cyl(-178, 0, sz, -178, 13.5, sz, 4.2, 4.2, 10, false, true);
    k.noClimb(() => k.collide(-178, 6.7, sz, 4.1, 6.7, 4.1, 'concrete'));
  }
  wreckedArmor(k, spec, -162, 64, 0.14, 'boxcar');
  wreckedArmor(k, spec, -126, 126, -0.22, 'boxcar');
  blastedTreeCopse(k, -112, 58, 9, 14, 53);

  // 3d. EAST APPROACH: Flooded Hydro Quarry & Concrete Plant (x = +110..+200, z = +54..+146)
  ruinedBuilding(k, spec, 174, 112, 16, 13, 2, -0.06, WAR_PALETTE.darkConcrete);
  ruinedBuilding(k, spec, 118, 96, 13, 12, 2, 0.10, WAR_PALETTE.wetConcrete);
  // Tall rusted quarry crusher tower + overhead conveyor pipes
  solidBox(k, 176, 5.2, 76, 5.5, 5.2, 5.5, 'rust', { tint: WAR_PALETTE.rustSteel });
  pipe(k, [172, 8.2, 76, 172, 6.4, 108], 0.55, 'rust');
  wreckedArmor(k, spec, 126, 62, 0.65, 'tank');
  mudRidge(k, spec, 198, 64, 34, 18, 5.5, 0.25, true);

  // Power pylons striding across the south front
  powerPylon(k, -76, 224, 0.1);
  powerPylon(k, -72, 110, 0.1);
  powerPylon(k, 74, 224, -0.1);
  powerPylon(k, 72, 110, -0.1);
  cable(k, -76, 15.2, 224, -72, 15.2, 110, 4.5);
  cable(k, 74, 15.2, 224, 72, 15.2, 110, 4.5);

  // Scattered artillery craters across the mud fields
  const craters: readonly [number, number, number][] = [
    [-116, 232, 4.2], [-28, 226, 4.8], [32, 230, 4.0], [116, 228, 4.5],
    [-64, 124, 5.2], [64, 124, 5.0], [-96, 76, 4.6], [96, 76, 4.8],
    [-168, 156, 4.4], [168, 156, 4.4], [-58, 44, 3.8], [58, 44, 3.8],
  ];
  for (const [cx, cz, cr] of craters) shellCrater(k, cx, cz, cr);

  // Destructible field watchtowers
  spec.destructionClusters.push(
    buildFieldWatchtower('ew.tower.sw', -126, 166, 0.15),
    buildFieldWatchtower('ew.tower.se', 126, 166, -0.15),
  );
}

// ---------------------------------------------------------------------------
// Stage 4: The 3 Fortified River Crossings (z = -30..+30)
// ---------------------------------------------------------------------------

function stageRiverCrossings(k: Kit, spec: MapSpec): void {
  const g = k.geo;

  // 4a. WEST CROSSING — Shattered Steel Truss Rail & Pontoon Bridge (x = -145, width = 18 m)
  {
    const bx = ENDLESS_WAR_CROSSINGS[0]!.x;
    const hw = ENDLESS_WAR_CROSSINGS[0]!.width / 2;
    // Continuous walkable deck from z = -34 to +34 (overlaps banks cleanly for seamless NavGraph!)
    solidBox(k, bx, -0.35, 0, hw, 0.35, 34, 'plywood', { tint: [0.36, 0.30, 0.24] });
    // Heavy concrete bridge piers standing in the river
    for (const pz of [-22, 0, 22]) {
      g.use('concreteDark').tint(0.32, 0.34, 0.35);
      g.box(bx, -2.0, pz, hw + 1.2, 1.8, 2.2, FACE.all);
    }
    // Tall iconic rusted steel Warren truss overhead structure (height 8.4 m!)
    g.use('rust').tint(0.36, 0.24, 0.19);
    for (const sx of [-hw + 0.55, hw - 0.55]) {
      // Side railings (collidable so tanks stay on the deck)
      solidBox(k, bx + sx, 0.85, 0, 0.45, 0.85, 32, 'rust', { tint: [0.34, 0.24, 0.20] });
      // Top longitudinal girder
      g.box(bx + sx, 8.2, 0, 0.42, 0.42, 30, FACE.all);
      // Vertical & diagonal truss struts
      for (let tz = -26; tz <= 26; tz += 10.4) {
        g.box(bx + sx, 4.5, tz, 0.34, 3.7, 0.34, FACE.all);
        if (tz < 22) {
          g.cyl(bx + sx, 1.0, tz, bx + sx, 8.0, tz + 5.2, 0.18, 0.18, 4);
          g.cyl(bx + sx, 8.0, tz + 5.2, bx + sx, 1.0, tz + 10.4, 0.18, 0.18, 4);
        }
      }
    }
    // Overhead cross-bracing beams
    for (let tz = -26; tz <= 26; tz += 10.4) {
      g.box(bx, 8.2, tz, hw, 0.36, 0.38, FACE.all);
    }
    // Sandbag cover pockets along the bridge edges
    solidBox(k, bx - hw + 2.1, 0.65, -10, 1.1, 0.65, 2.4, 'dirt', { tint: WAR_PALETTE.sandbag });
    solidBox(k, bx + hw - 2.1, 0.65, 10, 1.1, 0.65, 2.4, 'dirt', { tint: WAR_PALETTE.sandbag });
  }

  // 4b. CENTER CROSSING — Main 4-Lane Concrete Highway Viaduct (x = 0, width = 28 m)
  {
    const bx = ENDLESS_WAR_CROSSINGS[1]!.x;
    const hw = ENDLESS_WAR_CROSSINGS[1]!.width / 2;
    solidBox(k, bx, -0.35, 0, hw, 0.35, 34, 'asphalt', { tint: WAR_PALETTE.tarmac });
    // Center dashed highway stripe
    g.use('paintYellow').tint(0.72, 0.60, 0.28);
    for (let uz = -28; uz <= 28; uz += 10) g.box(bx, 0.02, uz, 0.18, 0.005, 2.5, FACE.py);
    // Massive concrete arch piers
    g.use('concrete').tint(0.42, 0.44, 0.45);
    for (const pz of [-22, -7, 7, 22]) {
      g.box(bx, -2.0, pz, hw + 1.4, 1.8, 2.4, FACE.all);
    }
    // Concrete parapet guardrails + snapped lamp poles
    for (const sx of [-hw + 0.55, hw - 0.55]) {
      solidBox(k, bx + sx, 0.92, 0, 0.55, 0.92, 33, 'concrete', { tint: WAR_PALETTE.wetConcrete });
      for (const lz of [-20, 0, 20]) {
        g.use('steelDark').tint(0.30).cyl(bx + sx, 1.8, lz, bx + sx * 0.92, 7.2, lz, 0.12, 0.08, 5);
      }
    }
    // Staggered jersey barriers & burned tank carcass on outer shoulders (keeps 16 m center clear for tanks!)
    solidBox(k, -10.5, 0.65, -14, 1.8, 0.65, 0.55, 'concrete', { tint: WAR_PALETTE.wetConcrete });
    solidBox(k, 10.5, 0.65, 14, 1.8, 0.65, 0.55, 'concrete', { tint: WAR_PALETTE.wetConcrete });
    wreckedArmor(k, spec, -10.2, 6, 0.28, 'tank');
    wreckedArmor(k, spec, 10.4, -8, -0.36, 'truck');
  }

  // 4c. EAST CROSSING — Cracked Hydro Dam & Rocky Concrete Ford (x = +145, width = 20 m)
  {
    const bx = ENDLESS_WAR_CROSSINGS[2]!.x;
    const hw = ENDLESS_WAR_CROSSINGS[2]!.width / 2;
    // Paved concrete ford causeway across the river
    solidBox(k, bx, -0.35, 0, hw, 0.35, 34, 'concreteDark', { tint: [0.36, 0.37, 0.36] });
    // Low rubble & boulder retaining walls lining the ford edges
    for (const sx of [-hw + 0.6, hw - 0.6]) {
      solidBox(k, bx + sx, 0.65, 0, 0.6, 0.65, 31, 'concreteDark', { tint: [0.32, 0.33, 0.34] });
    }
    // Towering cracked concrete Hydroelectric Dam rising immediately east of the crossing (x = +160..+242)
    solidBox(k, 202, 5.8, -4, 41, 6.8, 7.5, 'concrete', { tint: [0.40, 0.42, 0.44] });
    // Heavy dam buttresses & broken spillway sluices
    g.use('concreteDark').tint(0.30, 0.32, 0.34);
    for (let dx = 166; dx <= 234; dx += 13.5) {
      g.box(dx, 5.2, 4.5, 1.6, 6.2, 4.5, FACE.all);
    }
    // Ruined concrete turbine control house perched on the dam crest
    solidBox(k, 176, 13.6, -4, 7.5, 2.4, 5.2, 'concreteDark', { tint: [0.34, 0.36, 0.38] });
    // White rushing spillway foam at base of dam
    g.use('paintWhite').tint(0.55, 0.62, 0.66).box(198, ENDLESS_WAR_WATER_Y + 0.08, 12, 34, 0.08, 6.5, FACE.py);
  }
  g.tint(1);
}

// ---------------------------------------------------------------------------
// Stage 5: North Enemy Defense Belt & 3 Mid-North Strategic Facilities (z = -35..-255)
// ---------------------------------------------------------------------------

function stageNorthDefenseBelt(k: Kit, spec: MapSpec): void {
  const g = k.geo;

  // 5a. North Bridgehead Bunkers & Zig-Zag Enemy Trenches (z = -46..-108)
  bunkerCasemate(k, spec, -166, -48, 0.16, true);
  bunkerCasemate(k, spec, -124, -48, -0.16, true);
  bunkerCasemate(k, spec, -24, -50, 0.10, true);
  bunkerCasemate(k, spec, 24, -50, -0.10, true);
  bunkerCasemate(k, spec, 124, -48, 0.16, true);
  bunkerCasemate(k, spec, 166, -48, -0.16, true);

  trenchRedoubt(k, spec, -184, -84, 24, -0.06, true);
  trenchRedoubt(k, spec, -96, -80, 30, 0.08, true);
  trenchRedoubt(k, spec, -44, -92, 26, -0.05, true);
  trenchRedoubt(k, spec, 44, -92, 26, 0.05, true);
  trenchRedoubt(k, spec, 96, -80, 30, -0.08, true);
  trenchRedoubt(k, spec, 184, -84, 24, 0.06, true);

  // LOS-blocking North Ridge Hills & Blasted Woods (hiding Iron Bastion until you fight past the river!)
  mudRidge(k, spec, -76, -104, 52, 24, 7.6, -0.14, true);
  mudRidge(k, spec, 76, -104, 52, 24, 7.8, 0.14, true);
  mudRidge(k, spec, -206, -134, 34, 22, 8.4, -0.25, true);
  mudRidge(k, spec, 206, -134, 34, 22, 8.6, 0.25, true);
  mudRidge(k, spec, -62, -214, 56, 22, 6.8, 0.10, true);
  mudRidge(k, spec, 62, -214, 56, 22, 6.8, -0.10, true);

  blastedTreeCopse(k, -82, -104, 14, 22, 71);
  blastedTreeCopse(k, 82, -104, 14, 22, 83);
  blastedTreeCopse(k, -68, -216, 12, 18, 97);
  blastedTreeCopse(k, 68, -216, 12, 18, 109);

  // Ruined North Checkpoint Buildings flanking Center Highway
  ruinedBuilding(k, spec, -30, -148, 14, 12, 2, -0.08, WAR_PALETTE.darkConcrete);
  ruinedBuilding(k, spec, -34, -196, 15, 11, 2, 0.06, WAR_PALETTE.brickRuins);
  wreckedArmor(k, spec, 12, -88, 0.35, 'tank');
  wreckedArmor(k, spec, -132, -102, -0.42, 'tank');
  wreckedArmor(k, spec, 132, -102, 0.48, 'truck');

  dragonsTeeth(k, -64, -64, -36, -64);
  dragonsTeeth(k, 36, -64, 64, -64);

  // 5b. STRATEGIC FACILITY 1 — Forward Fuel & Ammo Depot (Sector 3 West, [-156, 0, -178])
  {
    const f = ENDLESS_WAR_FACILITIES[0]!;
    const [fx, , fz] = f.position;
    groundPatch(k, 'concreteDark', [0.28, 0.28, 0.29], fx - 20, fz - 18, fx + 20, fz + 18, 0.025, 10);
    // Blast-wall perimeter with open entrance gaps
    solidBox(k, fx - 19, 2.0, fz, 0.7, 2.0, 16, 'concrete', { tint: WAR_PALETTE.darkConcrete });
    solidBox(k, fx, 2.0, fz - 17, 17, 2.0, 0.7, 'concrete', { tint: WAR_PALETTE.darkConcrete });
    solidBox(k, fx - 10, 2.0, fz + 17, 8, 2.0, 0.7, 'concrete', { tint: WAR_PALETTE.darkConcrete });
    // Industrial fuel storage tanks & red hazard piping (visual compound frame around live destructible core)
    g.use('paintRed').tint(0.76, 0.24, 0.18);
    for (const sx of [-7, 0, 7]) {
      g.cyl(fx + sx, 0, fz - 7, fx + sx, 5.2, fz - 7, 2.4, 2.4, 10, false, true);
    }
    pipe(k, [fx - 8, 4.2, fz - 7, fx + 8, 4.2, fz - 7], 0.35, 'rust');
    k.light(fx, 7.5, fz, 0xff5a28, 8, 28);
  }

  // 5c. STRATEGIC FACILITY 2 — Artillery & Mortar Ridge (Sector 3 Center-East, [+44, 0, -172])
  {
    const f = ENDLESS_WAR_FACILITIES[1]!;
    const [fx, , fz] = f.position;
    groundPatch(k, 'concreteDark', [0.30, 0.31, 0.32], fx - 20, fz - 18, fx + 20, fz + 18, 0.025, 10);
    // Protective sandbag artillery revetment arcs & munitions bunkers
    solidBox(k, fx - 16, 1.5, fz + 12, 6, 1.5, 1.0, 'dirt', { tint: WAR_PALETTE.sandbag });
    solidBox(k, fx + 16, 1.5, fz + 12, 6, 1.5, 1.0, 'dirt', { tint: WAR_PALETTE.sandbag });
    solidBox(k, fx, 2.1, fz - 15, 16, 2.1, 1.2, 'concreteDark', { tint: WAR_PALETTE.darkConcrete });
    // Observation rangefinder tower
    solidBox(k, fx + 14, 4.4, fz - 10, 2.4, 4.4, 2.4, 'concrete', { tint: WAR_PALETTE.wetConcrete });
    k.light(fx, 7.5, fz, 0xff6b2c, 8, 28);
  }

  // 5d. STRATEGIC FACILITY 3 — Radar & AA Network (Sector 3 East, [+158, 0, -178])
  {
    const f = ENDLESS_WAR_FACILITIES[2]!;
    const [fx, , fz] = f.position;
    groundPatch(k, 'concreteDark', [0.30, 0.32, 0.34], fx - 20, fz - 18, fx + 20, fz + 18, 0.025, 10);
    solidBox(k, fx + 19, 2.0, fz, 0.7, 2.0, 16, 'concrete', { tint: WAR_PALETTE.darkConcrete });
    solidBox(k, fx, 2.0, fz - 17, 17, 2.0, 0.7, 'concrete', { tint: WAR_PALETTE.darkConcrete });
    // Communications mast
    g.use('steelDark').tint(0.36).cyl(fx + 12, 0, fz - 10, fx + 12, 16.5, fz - 10, 0.42, 0.16, 6);
    g.use('paintRed').tint(1.3, 0.25, 0.2).box(fx + 12, 16.8, fz - 10, 0.48, 0.48, 0.48, FACE.all);
    k.light(fx, 8.0, fz, 0xff4238, 8, 28);
  }

  // North field watchtowers
  spec.destructionClusters.push(
    buildFieldWatchtower('ew.tower.nw', -112, -138, Math.PI - 0.2),
    buildFieldWatchtower('ew.tower.ne', 112, -138, Math.PI + 0.2),
  );
  g.tint(1);
}

// ---------------------------------------------------------------------------
// Stage 6: North Enemy Fortress "Iron Bastion" (z = -255..-355)
// ---------------------------------------------------------------------------

function stageEnemyFortress(k: Kit, spec: MapSpec): void {
  const g = k.geo;

  // Vast brutalist tarmac fortress apron
  groundPatch(k, 'asphalt', [0.24, 0.24, 0.26], -224, -354, 224, -258, 0.022, 18);

  // Massive Concrete Bastion South Wall (z = -258) with 3 wide 28 m armored gates at x = -145, 0, +145
  const wallSegs: readonly [number, number][] = [
    [-226, -160],
    [-130, -15],
    [15, 130],
    [160, 226],
  ];
  for (const [x0, x1] of wallSegs) {
    const cx = (x0 + x1) / 2;
    const hx = (x1 - x0) / 2;
    solidBox(k, cx, 3.6, -258, hx, 3.6, 1.8, 'concreteDark', { tint: [0.28, 0.29, 0.31] });
    g.use('steelDark').tint(0.24, 0.22, 0.22);
    g.box(cx, 7.45, -258, hx, 0.32, 2.0, FACE.all);
    // Exterior armored ribs
    for (let bx = x0 + 6; bx <= x1 - 6; bx += 14) {
      g.box(bx, 3.2, -255.8, 0.85, 3.2, 0.95, FACE.all);
    }
  }
  // Fortress Gate Towers with intimidating red warning beacons
  for (const gx of [-145, 0, 145]) {
    for (const sx of [-15, 15]) {
      solidBox(k, gx + sx, 5.2, -258, 2.2, 5.2, 2.8, 'concreteDark', { tint: [0.26, 0.26, 0.28] });
      g.use('paintRed').tint(1.3, 0.22, 0.18).box(gx + sx, 9.6, -255.1, 1.4, 0.35, 0.14, FACE.all);
    }
  }
  // Fortress rear & flank retaining walls
  solidBox(k, 0, 4.2, -354, 226, 4.2, 1.8, 'concreteDark', { tint: [0.26, 0.27, 0.29] });
  solidBox(k, -226, 4.0, -306, 1.8, 4.0, 48, 'concreteDark', { tint: [0.26, 0.27, 0.29] });
  solidBox(k, 226, 4.0, -306, 1.8, 4.0, 48, 'concreteDark', { tint: [0.26, 0.27, 0.29] });

  // Center Landmark: Looming Iron Bastion Citadel Keep (z = -326, x = 0, 22 m tall brutalist command fortress!)
  solidBox(k, 0, 5.5, -330, 24, 5.5, 13, 'concreteDark', { tint: [0.26, 0.27, 0.30] });
  solidBox(k, 0, 13.5, -332, 14, 3.5, 9, 'steelDark', { tint: [0.24, 0.23, 0.25] });
  solidBox(k, 0, 18.8, -333, 6.5, 2.2, 5.2, 'concreteDark', { tint: [0.22, 0.22, 0.24] });
  g.use('paintRed').tint(1.35, 0.20, 0.16);
  g.box(0, 10.2, -316.8, 16, 0.45, 0.15, FACE.all);
  g.box(0, 16.5, -322.8, 8.5, 0.38, 0.15, FACE.all);
  g.use('steelDark').tint(0.32).cyl(0, 21.0, -333, 0, 31.0, -333, 0.65, 0.24, 8);
  g.use('paintRed').tint(1.4, 0.2, 0.15).box(0, 31.4, -333, 0.85, 0.85, 0.85, FACE.all);
  stencil(k, 'NO ENTRY', 0, 8.4, -316.8, 1.4, [1.0, 0.28, 0.22]);
  k.light(0, 14.0, -312, 0xff3b28, 14, 48);

  // STRATEGIC FACILITY 4 — Iron Bastion Motor Pool (Sector 4 West, [-146, 0, -314])
  {
    const f = ENDLESS_WAR_FACILITIES[3]!;
    const [fx, , fz] = f.position;
    // Heavy steel gantry crane framing the tank yard
    g.use('rust').tint(0.42, 0.28, 0.20);
    for (const sx of [-16, 16]) {
      g.box(fx + sx, 6.5, fz - 12, 0.85, 6.5, 0.85, FACE.all);
      g.box(fx + sx, 6.5, fz + 12, 0.85, 6.5, 0.85, FACE.all);
    }
    g.box(fx, 13.0, fz - 12, 16.8, 0.85, 0.9, FACE.all);
    g.box(fx, 13.0, fz + 12, 16.8, 0.85, 0.9, FACE.all);
    floorStencil(k, 'LIVE FIRE', fx, fz + 16, Math.PI, 1.3, [1.0, 0.45, 0.25], 0.04);
    k.light(fx, 10, fz, 0xff6228, 10, 34);
  }

  // STRATEGIC FACILITY 5 — Enemy Airfield Control Tower & Helipads (Sector 4 East, [+150, 0, -314])
  {
    const f = ENDLESS_WAR_FACILITIES[4]!;
    const [fx, , fz] = f.position;
    // Twin marked concrete helipads beside the ATC tower
    for (const hx of [fx - 26, fx + 26]) {
      groundPatch(k, 'concrete', [0.36, 0.37, 0.39], hx - 10, fz + 6, hx + 10, fz + 26, 0.032, 10);
      g.use('paintYellow').tint(0.76, 0.64, 0.26);
      g.box(hx - 4.2, 0.042, fz + 16, 0.45, 0.006, 5.2, FACE.py);
      g.box(hx + 4.2, 0.042, fz + 16, 0.45, 0.006, 5.2, FACE.py);
      g.box(hx, 0.042, fz + 16, 4.2, 0.006, 0.45, FACE.py);
    }
    // Hardened aircraft hangar behind tower
    solidBox(k, fx + 32, 4.4, fz - 22, 12, 4.4, 14, 'concreteDark', { tint: [0.30, 0.31, 0.33] });
    k.light(fx, 12, fz, 0xff4030, 10, 36);
  }

  // Add minimap blocks for fortress core
  spec.plan?.blocks.push({ x0: -24, z0: -344, x1: 24, z1: -316 });
  g.tint(1);
}

// ---------------------------------------------------------------------------
// Stage 7: Zones, Spawns, Pickups & Waypoint Registration
// ---------------------------------------------------------------------------

function stageSpawnsAndZones(spec: MapSpec): void {
  spec.playerSpawns.push(
    { position: new THREE.Vector3(...ENDLESS_WAR_PLAYER_SPAWN), yaw: ENDLESS_WAR_PLAYER_YAW },
    { position: new THREE.Vector3(-8, 0, 306), yaw: ENDLESS_WAR_PLAYER_YAW },
    { position: new THREE.Vector3(8, 0, 306), yaw: ENDLESS_WAR_PLAYER_YAW },
    { position: new THREE.Vector3(0, 0, 314), yaw: ENDLESS_WAR_PLAYER_YAW },
  );

  for (const p of ENDLESS_WAR_PICKUP_SPOTS) {
    spec.pickupSpots.push(new THREE.Vector3(p[0], p[1], p[2]));
  }

  // Seed enemy manual spawns inside Iron Bastion and North Defense Belt
  const enemySeeds: SpawnPoint[] = [];
  for (const lane of ['west', 'center', 'east'] as const) {
    for (const pt of ENDLESS_WAR_ENEMY_SPAWNS[lane]) {
      enemySeeds.push({
        position: new THREE.Vector3(pt[0], pt[1], pt[2]),
        zone: 'iron_bastion',
        kind: 'ground',
      });
    }
  }
  spec.spawns = spec.spawns ? [...spec.spawns, ...enemySeeds] : enemySeeds;

  spec.zones.push(
    { id: 'fob_vanguard', name: 'FOB VANGUARD', bounds: new THREE.Box3(new THREE.Vector3(-240, -10, 255), new THREE.Vector3(240, 80, 360)) },
    { id: 'south_trenches', name: 'SOUTH TRENCH BELT', bounds: new THREE.Box3(new THREE.Vector3(-240, -10, 150), new THREE.Vector3(240, 80, 255)) },
    { id: 'bridge_approaches', name: 'SHATTERED CROSSROADS', bounds: new THREE.Box3(new THREE.Vector3(-240, -10, 30), new THREE.Vector3(240, 80, 150)) },
    { id: 'river_crossings', name: 'THE RIVER CROSSINGS', bounds: new THREE.Box3(new THREE.Vector3(-240, -10, -30), new THREE.Vector3(240, 80, 30)) },
    { id: 'north_defense_belt', name: 'NORTH DEFENSE BELT', bounds: new THREE.Box3(new THREE.Vector3(-240, -10, -255), new THREE.Vector3(240, 80, -30)) },
    { id: 'iron_bastion', name: 'IRON BASTION FORTRESS', bounds: new THREE.Box3(new THREE.Vector3(-240, -10, -360), new THREE.Vector3(240, 80, -255)) },
  );

  // Add enemy armor lane start/end landmarks to minimap plan for clean tactical chart
  for (const lane of ['west', 'center', 'east'] as const) {
    const pts = ENDLESS_WAR_ENEMY_LANES[lane];
    if (pts.length >= 2) {
      spec.plan?.blocks.push({
        x0: pts[0]![0] - 4,
        z0: pts[0]![1] - 4,
        x1: pts[0]![0] + 4,
        z1: pts[0]![1] + 4,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Stage 6b: Extra War-Torn LOS Breakers, Hedgerows, Ruined Overpass & Wrecks
// ---------------------------------------------------------------------------

function stageWarDetailAndLOS(k: Kit, spec: MapSpec): void {
  const g = k.geo;

  // 1. Stone farm hedgerow walls & blown brick garden walls weaving across the flanks
  const hedgerows: readonly [number, number, number, number][] = [
    [-112, 234, 18, 0.12], [-56, 174, 22, -0.18], [56, 174, 22, 0.18], [112, 234, 18, -0.12],
    [-92, 118, 20, 0.25], [92, 118, 20, -0.25], [-74, 72, 18, -0.14], [74, 72, 18, 0.14],
    [-108, -62, 20, 0.18], [108, -62, 20, -0.18], [-64, -142, 24, -0.22], [64, -142, 24, 0.22],
    [-104, -226, 22, 0.14], [104, -226, 22, -0.14], [-186, -196, 18, 0.3], [186, -196, 18, -0.3],
  ];
  for (const [hx, hz, len, yaw] of hedgerows) {
    k.push(hx, 0, hz, yaw);
    solidBox(k, 0, 1.05, 0, len / 2, 1.05, 0.42, 'concrete', { tint: [0.36, 0.35, 0.33] });
    // Jagged broken wall crest stones + low mud bank
    g.use('dirt').tint(WAR_PALETTE.mudGrass[0], WAR_PALETTE.mudGrass[1], WAR_PALETTE.mudGrass[2]);
    g.box(0, 0.42, 0.72, len * 0.48, 0.42, 0.55, FACE.all & ~FACE.ny);
    k.pop();
  }

  // 2. Shattered Concrete Highway Overpass Arch spanning Center Road at z = +162 (epic silhouette + vertical cover!)
  {
    const oz = 162;
    // Left & right massive abutments cleanly outside the 15 m highway (x = +-14..+-32)
    solidBox(k, -22, 3.6, oz, 8.0, 3.6, 4.2, 'concreteDark', { tint: [0.34, 0.35, 0.37] });
    solidBox(k, 22, 3.6, oz, 8.0, 3.6, 4.2, 'concreteDark', { tint: [0.34, 0.35, 0.37] });
    // Broken overhanging bridge spans (cantilevered skyward over the road with a dramatic blown center gap!)
    g.use('concrete').tint(0.42, 0.44, 0.45);
    g.box(-14.5, 7.0, oz, 8.5, 0.65, 4.4, FACE.all);
    g.box(14.5, 7.0, oz, 8.5, 0.65, 4.4, FACE.all);
    // Exposed rusted rebar beams jutting into the blown gap
    g.use('rust').tint(0.42, 0.25, 0.18);
    for (let rz = -2.8; rz <= 2.8; rz += 1.4) {
      g.box(-5.2, 6.95, oz + rz, 2.2, 0.12, 0.12, FACE.all);
      g.box(5.2, 6.95, oz + rz, 2.2, 0.12, 0.12, FACE.all);
    }
  }

  // 3. Additional North-Sector Ruined Farmhouses, Supply Depots & Industrial Sheds (dense fighting past the river!)
  ruinedBuilding(k, spec, -178, -112, 15, 12, 2, 0.08, WAR_PALETTE.brickRuins);
  ruinedBuilding(k, spec, -112, -138, 14, 11, 2, -0.12, WAR_PALETTE.darkConcrete);
  ruinedBuilding(k, spec, 176, -112, 15, 12, 2, -0.08, WAR_PALETTE.wetConcrete);
  ruinedBuilding(k, spec, 112, -136, 14, 11, 2, 0.11, WAR_PALETTE.brickRuins);
  ruinedBuilding(k, spec, 28, -124, 13, 11, 2, -0.06, WAR_PALETTE.darkConcrete);
  ruinedBuilding(k, spec, -28, -234, 14, 11, 2, 0.09, WAR_PALETTE.darkConcrete);
  ruinedBuilding(k, spec, 28, -234, 14, 11, 2, -0.09, WAR_PALETTE.darkConcrete);
  ruinedBuilding(k, spec, -184, -228, 15, 12, 3, 0.05, [0.36, 0.36, 0.38]);
  ruinedBuilding(k, spec, 184, -228, 15, 12, 3, -0.05, [0.36, 0.36, 0.38]);

  // 4. Downed Transport Helicopter Carcasses (iconic war-front landmarks on the mud flats!)
  for (const [dx, dz, dyaw] of [[-78, 86, 0.65], [82, -132, -0.82]] as const) {
    k.push(dx, 0, dz, dyaw);
    solidBox(k, 0, 1.25, 0, 1.85, 1.15, 4.8, 'steelDark', { tint: [0.24, 0.27, 0.23] });
    // Broken tail boom & bent rotor blades
    g.use('rust').tint(0.30, 0.24, 0.20);
    g.box(0.4, 1.1, -6.4, 0.55, 0.55, 3.6, FACE.all);
    g.box(0, 2.55, 0.4, 5.4, 0.08, 0.28, FACE.all);
    g.box(0, 2.55, 0.4, 0.28, 0.08, 4.6, FACE.all);
    // Warm burning engine glow
    g.use('emissiveOrange').tint(1.2, 0.48, 0.14).box(0, 1.6, 1.2, 0.85, 0.35, 0.85, FACE.all);
    k.pop();
  }

  // 5. Additional Burned Armor Hulks & Glowing Wreck Fires for deep battlefield storytelling
  const extraWrecks: readonly [number, number, number, 'tank' | 'truck'][] = [
    [-86, 188, 0.8, 'tank'], [88, 186, -0.6, 'truck'],
    [-168, 42, 0.22, 'tank'], [168, 42, -0.3, 'tank'],
    [-58, -42, 0.9, 'truck'], [58, -42, -0.75, 'tank'],
    [-88, -172, 0.4, 'tank'], [88, -174, -0.5, 'truck'],
    [-124, -238, 0.3, 'tank'], [124, -238, -0.25, 'tank'],
  ];
  for (const [wx, wz, wyaw, wkind] of extraWrecks) {
    wreckedArmor(k, spec, wx, wz, wyaw, wkind);
    // Embers glowing inside burned hull
    g.use('emissiveOrange').tint(1.1, 0.42, 0.12).box(wx, 1.18, wz, 0.52, 0.22, 0.52, FACE.all);
  }

  // 6. Extra Blasted Pine Copses & North Artillery Craters
  blastedTreeCopse(k, -184, 72, 10, 16, 131);
  blastedTreeCopse(k, 184, 148, 10, 16, 149);
  blastedTreeCopse(k, -178, -62, 10, 16, 163);
  blastedTreeCopse(k, 178, -62, 10, 16, 179);
  blastedTreeCopse(k, -12, -142, 8, 14, 191);
  blastedTreeCopse(k, -138, -214, 10, 16, 211);
  blastedTreeCopse(k, 138, -214, 10, 16, 223);

  const northCraters: readonly [number, number, number][] = [
    [-112, -46, 4.5], [112, -46, 4.5], [-46, -68, 5.0], [46, -68, 4.8],
    [-144, -132, 4.6], [0, -134, 5.2], [144, -132, 4.6],
    [-86, -204, 4.8], [86, -204, 4.8], [-16, -242, 4.4], [16, -242, 4.4],
  ];
  for (const [cx, cz, cr] of northCraters) shellCrater(k, cx, cz, cr);

  // North power pylons continuing across the river into Enemy territory
  powerPylon(k, -74, -56, 0.08);
  powerPylon(k, -76, -168, 0.08);
  powerPylon(k, 74, -56, -0.08);
  powerPylon(k, 76, -168, -0.08);
  cable(k, -74, 15.2, -56, -76, 15.2, -168, 4.8);
  cable(k, 74, 15.2, -56, 76, 15.2, -168, 4.8);
  g.tint(1);
}

export const ENDLESS_WAR_STAGES = [
  { label: 'Carving the river gorge & valley', run: (k: Kit, spec: MapSpec) => { STAGES_BUILT.add(spec); stageTerrainAndSky(k, spec); } },
  { label: 'Fortifying FOB Vanguard', run: (k: Kit, spec: MapSpec) => stageFriendlyFob(k, spec) },
  { label: 'Digging trenches & shattered town', run: (k: Kit, spec: MapSpec) => stageSouthFront(k, spec) },
  { label: 'Spanning the three river crossings', run: (k: Kit, spec: MapSpec) => stageRiverCrossings(k, spec) },
  { label: 'Arming North Defense Belt', run: (k: Kit, spec: MapSpec) => stageNorthDefenseBelt(k, spec) },
  { label: 'Raising Iron Bastion Fortress', run: (k: Kit, spec: MapSpec) => stageEnemyFortress(k, spec) },
  { label: 'Scarring the battlefield & hedgerows', run: (k: Kit, spec: MapSpec) => stageWarDetailAndLOS(k, spec) },
  { label: 'Charting frontline lanes', run: (_k: Kit, spec: MapSpec) => stageSpawnsAndZones(spec) },
] as const;

export function authorEndlessWar(k: Kit, spec: MapSpec): void {
  if (STAGES_BUILT.has(spec)) return;
  for (const s of ENDLESS_WAR_STAGES) s.run(k, spec);
}
