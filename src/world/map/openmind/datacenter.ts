/**
 * Sub-Level 4 Compute Vault (`datacenter.ts`, x = -34..+34, z = -24..+18, y = -6, catwalks y = -1):
 *   - Freezing blue-lit monolithic subterranean compute hall beneath OpenMind HQ
 *   - 3 distinct Compute Clusters (North, West, East) lined with chain-exploding `rack` breakables & glass partitions
 *   - Raised steel mesh catwalks (y = -1) with twin walkable staircases overlooking the aisles
 *   - Central Air-Gap Containment Core with 4 destructible containment pylons (`vault.pylon.0..3`)
 *   - Hidden heavy gantry bay for AEGIS-0 (Project Safeguard) in the SW alcove
 *   - Structural concrete street-breakout ramp (y = -6 -> y = 0 at z = +18) sealed by destructible `vault.breakoutBulkhead`
 */
import { FACE, type Mat } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import { signId, type SignName } from '../../kit/signs';
import type { MapSpec } from '../spec';
import { DATACENTER, ELEVATOR_SHAFT } from './plan';

const OBSIDIAN: readonly [number, number, number] = [0.2, 0.24, 0.3];
const CRYO_STEEL: readonly [number, number, number] = [0.46, 0.56, 0.68];
const VAULT_FLOOR: readonly [number, number, number] = [0.24, 0.29, 0.37];
const CONCRETE_COLD: readonly [number, number, number] = [0.52, 0.58, 0.66];

function solidBox(
  k: Kit,
  mat: Mat,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  tint?: readonly [number, number, number],
  bev = 0.04,
): void {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  const hx = (x1 - x0) / 2, hy = (y1 - y0) / 2, hz = (z1 - z0) / 2;
  const g = k.geo.use(mat);
  if (tint) g.tint(tint[0], tint[1], tint[2]);
  if (bev > 0.008) g.bevel(cx, cy, cz, hx, hy, hz, bev);
  else g.box(cx, cy, cz, hx, hy, hz, FACE.all);
  if (tint) g.tint(1);
  k.collide(cx, cy, cz, hx, hy, hz, mat === 'steel' || mat === 'steelDark' ? 'metal' : 'concrete');
}

function mountSign(k: Kit, x: number, y: number, z: number, yaw: number, name: SignName, w = 2.6): void {
  const h = w / 4;
  k.push(x, y, z, yaw);
  k.geo.use('steelDark').tint(...OBSIDIAN).bevel(0, 0, -0.04, w / 2 + 0.06, h / 2 + 0.06, 0.04, 0.015);
  k.geo.tint(1).use('signs').quadUV(-w / 2, -h / 2, 0.01, w / 2, h / 2, signId(name));
  k.pop();
}

/** Subterranean vault floor, ribbed monolith perimeter walls, and ceiling partitioned around the elevator shaft. */
function buildVaultShell(k: Kit, spec: MapSpec): void {
  const { x0, x1, z0, z1, floorY, ceilY, breakoutRamp: br } = DATACENTER;
  const sh = ELEVATOR_SHAFT;
  const g = k.geo;

  // Monolithic obsidian-tiled Compute Vault floor at y = -6.
  g.use('tile').tint(...VAULT_FLOOR);
  g.slab((x0 + x1) / 2, floorY - 0.5, (z0 + z1) / 2, (x1 - x0) / 2, 0.5, (z1 - z0) / 2, 5, FACE.all);
  g.tint(1);
  k.collide((x0 + x1) / 2, floorY - 0.5, (z0 + z1) / 2, (x1 - x0) / 2, 0.5, (z1 - z0) / 2, 'concrete');

  // Glowing cyan cryogenic floor channel inlays converging on the central Air-Gap Core.
  g.use('emissiveCyan').tint(0.75);
  g.box(0, floorY + 0.015, -13, 0.16, 0.01, 6.0, FACE.py);
  g.box(-14, floorY + 0.015, -3, 8.0, 0.01, 0.16, FACE.py);
  g.box(14, floorY + 0.015, -3, 8.0, 0.01, 0.16, FACE.py);
  g.tint(1);

  // Perimeter subterranean reinforced concrete walls (N, W, E, and S flanking the x=-4..+4 breakout ramp!).
  const wt = 0.8;
  solidBox(k, 'concreteDark', x0 - wt, floorY, z0 - wt, x1 + wt, ceilY, z0, OBSIDIAN, 0.04); // North
  solidBox(k, 'concreteDark', x0 - wt, floorY, z0, x0, ceilY, z1, OBSIDIAN, 0.04);           // West
  solidBox(k, 'concreteDark', x1, floorY, z0, x1 + wt, ceilY, z1, OBSIDIAN, 0.04);           // East
  // South wall (z = +18) leaves wide 8 m breakout ramp opening at x = -4..+4!
  solidBox(k, 'concreteDark', x0 - wt, floorY, z1, br.x0, ceilY, z1 + wt, OBSIDIAN, 0.04);
  solidBox(k, 'concreteDark', br.x1, floorY, z1, x1 + wt, ceilY, z1 + wt, OBSIDIAN, 0.04);

  // Brutalist architectural concrete ribs & vertical cryo-blue light columns along vault walls.
  for (let rx = x0 + 6; rx <= x1 - 6; rx += 8) {
    g.use('steelDark').tint(...OBSIDIAN).bevel(rx, (floorY + ceilY) / 2, z0 + 0.35, 0.55, (ceilY - floorY) / 2, 0.4, 0.05);
    g.use('emissiveCyan').tint(0.8).box(rx, (floorY + ceilY) / 2, z0 + 0.78, 0.08, (ceilY - floorY) / 2 - 0.8, 0.04, FACE.pz);
  }
  for (let rz = z0 + 6; rz <= z1 - 6; rz += 8) {
    g.use('steelDark').tint(...OBSIDIAN);
    g.bevel(x0 + 0.35, (floorY + ceilY) / 2, rz, 0.4, (ceilY - floorY) / 2, 0.55, 0.05);
    g.bevel(x1 - 0.35, (floorY + ceilY) / 2, rz, 0.4, (ceilY - floorY) / 2, 0.55, 0.05);
    g.use('emissiveCyan').tint(0.75);
    g.box(x0 + 0.78, (floorY + ceilY) / 2, rz, 0.04, (ceilY - floorY) / 2 - 0.8, 0.08, FACE.px);
    g.box(x1 - 0.78, (floorY + ceilY) / 2, rz, 0.04, (ceilY - floorY) / 2 - 0.8, 0.08, FACE.nx);
  }
  g.tint(1);

  // Vault ceiling slab at y = +4.5 partitioned cleanly around the Freight Elevator Shaft (x: 14..20, z: 8..14)!
  k.floor('concreteDark', x0, z0, x1, sh.z0, ceilY + 0.5, 0.5, 5);    // North of shaft (z = -24..8)
  k.floor('concreteDark', x0, sh.z0, sh.x0, z1, ceilY + 0.5, 0.5, 4); // West of shaft (x = -34..14, z = 8..18)
  k.floor('concreteDark', sh.x1, sh.z0, x1, z1, ceilY + 0.5, 0.5, 3); // East of shaft (x = 20..34, z = 8..18)
  k.floor('concreteDark', sh.x0, sh.z1, sh.x1, z1, ceilY + 0.5, 0.5, 2); // South of shaft (z = 14..18)

  // Overhead heavy structural steel roof trusses spanning the compute hall.
  for (const tz of [-16, -8, 0, 8]) {
    k.truss(x0 + 1, ceilY - 0.7, tz, x1 - 1, ceilY - 0.7, tz, 1.1, 0.7, 'steelDark', 0.1);
  }

  spec.plan?.fills.push({ x0, z0, x1, z1, rgb: [56, 98, 148], label: 'SUB-LEVEL 4 COMPUTE VAULT' });
}

/** 3 Compute Clusters (North, West, East) lined with chain-exploding `rack` breakables & glass partitions. */
function buildComputeClusters(k: Kit, spec: MapSpec): void {
  const y = DATACENTER.floorY; // -6
  const g = k.geo;

  // 1. North Compute Cluster (x: -10..+10, z: -21..-12) — 2 rows of 12 tightly spaced racks (24 total)
  for (let i = 0; i < 12; i++) {
    const rx = -5.5 + i * 1.0;
    spec.breakable('rack', rx, y, -19.2, 0);
    spec.breakable('rack', rx, y, -14.8, Math.PI);
  }
  // Overhead cryo cable trays & cyan glow bars over North Cluster
  g.use('grate').tint(0.65);
  for (const rz of [-19.2, -14.8]) g.box(0, y + 3.4, rz, 7.0, 0.06, 0.55, FACE.py | FACE.ny);
  g.use('emissiveCyan').tint(0.85);
  for (const rz of [-20.1, -18.3, -15.7, -13.9]) g.box(0, y + 4.1, rz, 6.8, 0.04, 0.06, FACE.ny);
  g.tint(1);
  // Glass partition wall with central entry gap along z = -12
  for (const gx of [-7.5, -4.5, 4.5, 7.5]) {
    spec.breakable('pane', gx, y + 1.6, -12.0, 0, 2.8, 3.2);
  }
  mountSign(k, 0, y + 4.4, -12.2, 0, 'SERVER ROOM', 3.0);

  // 2. West Compute Cluster (x: -30..-18, z: -12..+6) — 2 rows of 12 racks (24 total)
  for (let i = 0; i < 12; i++) {
    const rz = -10.5 + i * 1.0;
    spec.breakable('rack', -27.5, y, rz, Math.PI / 2);
    spec.breakable('rack', -22.2, y, rz, -Math.PI / 2);
  }
  g.use('grate').tint(0.65);
  for (const rx of [-27.5, -22.2]) g.box(rx, y + 3.4, -5.0, 0.55, 0.06, 6.8, FACE.py | FACE.ny);
  g.use('emissiveCyan').tint(0.85);
  for (const rx of [-28.4, -26.6, -23.1, -21.3]) g.box(rx, y + 4.1, -5.0, 0.06, 0.04, 6.6, FACE.ny);
  g.tint(1);
  for (const gz of [-9.0, -6.0, 0.0, 3.0]) {
    spec.breakable('pane', -18.0, y + 1.6, gz, Math.PI / 2, 2.8, 3.2);
  }
  mountSign(k, -18.2, y + 4.4, -3.0, Math.PI / 2, 'COOLANT', 2.8);

  // 3. East Compute Cluster (x: +18..+30, z: -12..+4) — 2 rows of 10 racks (20 total)
  for (let i = 0; i < 10; i++) {
    const rz = -10.2 + i * 1.0;
    spec.breakable('rack', 22.2, y, rz, Math.PI / 2);
    spec.breakable('rack', 27.5, y, rz, -Math.PI / 2);
  }
  g.use('grate').tint(0.65);
  for (const rx of [22.2, 27.5]) g.box(rx, y + 3.4, -5.7, 0.55, 0.06, 5.8, FACE.py | FACE.ny);
  g.use('emissiveCyan').tint(0.85);
  for (const rx of [21.3, 23.1, 26.6, 28.4]) g.box(rx, y + 4.1, -5.7, 0.06, 0.04, 5.6, FACE.ny);
  g.tint(1);
  for (const gz of [-9.0, -6.0, 0.0]) {
    spec.breakable('pane', 18.0, y + 1.6, gz, Math.PI / 2, 2.8, 3.2);
  }
  mountSign(k, 18.2, y + 4.4, -3.0, -Math.PI / 2, 'SERVER ROOM', 2.8);

  // Tactical cryo extinguishers & backup generators around the cluster aisles.
  spec.breakable('extinguisher', -14.5, y + 1.1, -12.0, 0);
  spec.breakable('extinguisher', 14.5, y + 1.1, -12.0, 0);
  spec.breakable('generator', -13.0, y, -21.5, 0);
  spec.breakable('generator', 13.0, y, -21.5, 0);
}

/** Raised steel mesh catwalks at y = -1 with twin staircases overlooking the compute aisles. */
function buildVaultCatwalks(k: Kit, spec: MapSpec): void {
  const cy = DATACENTER.catwalkY; // -1
  const fy = DATACENTER.floorY;   // -6

  // Perimeter ring overlooking all 3 clusters & the Air-Gap Core (leaving breakout ramp x=-4.5..+4.5 open!).
  k.catwalk(-16, -10.5, 16, -10.5, cy, 3.0, 'both', true);
  k.catwalk(-16, -10.5, -16, 5.0, cy, 3.0, 'both', true);
  k.catwalk(16, -10.5, 16, 5.0, cy, 3.0, 'both', true);
  k.catwalk(-16, 5.0, -5.5, 5.0, cy, 3.0, 'both', true);
  k.catwalk(5.5, 5.0, 16, 5.0, cy, 3.0, 'both', true);

  // Support steel columns beneath catwalk corners.
  for (const [cx, cz] of [[-16, -10.5], [16, -10.5], [-16, 5], [16, 5], [-6, 5], [6, 5]] as const) {
    k.column(cx, cz, fy, cy - 0.15, 0.45, 'steelDark');
  }

  // Twin walkable steel staircases connecting Vault Floor (-6) <-> Catwalks (-1) (run = 10, rise = 5, slope = 0.50).
  k.stairs(-16, 15, fy, -16, 5, cy, 2.8, 'steel', true);
  k.stairs(10.5, 15, fy, 10.5, 5, cy, 2.8, 'steel', true);

  spec.plan?.decks.push(
    { x0: -17.5, z0: -12, x1: 17.5, z1: -9 },
    { x0: -17.5, z0: -12, x1: -14.5, z1: 6.5 },
    { x0: 14.5, z0: -12, x1: 17.5, z1: 6.5 },
  );
}

/** Central Air-Gap Containment Core + 4 destructible Air-Gap Pylons (`vault.pylon.0..3`). */
function buildAirGapCore(k: Kit, spec: MapSpec): void {
  const { center, pylons } = DATACENTER.airGapCore;
  const [cx, y, cz] = center; // [0, -6, -3]
  const g = k.geo;

  // Stepped obsidian-and-steel containment plinth at center (visual + low curb, clear core center).
  g.use('steelDark').tint(...OBSIDIAN).bevel(cx, y + 0.25, cz, 5.2, 0.25, 5.2, 0.08);
  g.use('steel').tint(...CRYO_STEEL).bevel(cx, y + 0.58, cz, 3.4, 0.16, 3.4, 0.06);

  // Central quantum neural core column suspended in air-gap glass rings (y = -5.2 .. +4.2).
  g.use('glass').tint(0.45, 0.88, 1.0).cyl(cx, y + 0.74, cz, cx, DATACENTER.ceilY - 0.4, cz, 1.45, 1.45, 16, false, false);
  g.use('emissiveCyan').tint(1).cyl(cx, y + 1.0, cz, cx, DATACENTER.ceilY - 0.6, cz, 0.52, 0.52, 12, false, false);
  for (const ry of [y + 2.2, y + 4.8, y + 7.4]) {
    g.use('steelDark').tint(...OBSIDIAN).cyl(cx, ry - 0.14, cz, cx, ry + 0.14, cz, 1.95, 1.95, 16, true, true);
    g.use('emissiveCyan').tint(0.95).cyl(cx, ry - 0.05, cz, cx, ry + 0.05, cz, 2.02, 2.02, 16, false, false);
  }
  g.tint(1);
  k.collidePrism(cx, cz, y, DATACENTER.ceilY, 1.55, 12, 'glass');

  // 4 Destructible Air-Gap Containment Pylons (cluster + breakable outer glass shield).
  for (const p of pylons) {
    const [px, py, pz] = p.pos;
    spec.cluster({
      id: p.id,
      tag: p.id,
      kind: 'pylon',
      label: 'AIR-GAP CONTAINMENT PYLON',
      value: 45_000,
      collapseThreshold: 0.4,
      nodes: [
        {
          id: `${p.id}_base`,
          pos: [px, py + 0.8, pz],
          half: [0.65, 0.8, 0.65],
          mat: 'steelDark',
          color: 0x263242,
          hp: 160,
          tier: 1,
          anchored: true,
          kind: 'column',
          supports: [`${p.id}_core`],
          label: 'PYLON BASE',
        },
        {
          id: `${p.id}_core`,
          pos: [px, py + 3.0, pz],
          half: [0.46, 1.4, 0.46],
          mat: 'emissiveCyan',
          color: 0x4fd7ff,
          hp: 120,
          tier: 1,
          anchored: false,
          keyNode: true,
          kind: 'hazard',
          hazardRadius: 5.5,
          hazardDamage: 120,
          supports: [`${p.id}_base`, `${p.id}_cap`],
          label: 'AIR-GAP CONDUIT',
        },
        {
          id: `${p.id}_cap`,
          pos: [px, py + 4.85, pz],
          half: [0.62, 0.45, 0.62],
          mat: 'steel',
          color: 0x74889e,
          hp: 120,
          tier: 1,
          anchored: false,
          kind: 'column',
          supports: [`${p.id}_core`],
          label: 'PYLON CAPACITOR',
        },
      ],
    });
    // Outward-facing breakable containment glass pane right in front of each pylon!
    const outYaw = Math.atan2(px - cx, pz - cz);
    spec.breakable('pane', px + Math.sin(outYaw) * 0.9, py + 2.2, pz + Math.cos(outYaw) * 0.9, outYaw, 1.8, 3.4);
  }
}

/** Hidden SW Containment Bay for AEGIS-0 (Project Safeguard) with heavy gantry arms & hazard beacons. */
function buildAegisBay(k: Kit): void {
  const bay = DATACENTER.aegisBay;
  const y = DATACENTER.floorY; // -6
  const g = k.geo;

  // Heavy industrial docking gantry frame inside SW alcove (x: -32..-18, z: +8..+17).
  k.column(bay.x0 + 1.2, bay.z0 + 1.0, y, DATACENTER.ceilY - 0.5, 0.9, 'steelDark');
  k.column(bay.x1 - 1.2, bay.z0 + 1.0, y, DATACENTER.ceilY - 0.5, 0.9, 'steelDark');
  k.truss(bay.x0 + 1.2, y + 8.5, bay.z0 + 1.0, bay.x1 - 1.2, y + 8.5, bay.z0 + 1.0, 1.4, 1.2, 'steelDark', 0.11);

  // Heavy mech maintenance cradle arms & amber warning beacons.
  g.use('hazard').box((bay.x0 + bay.x1) / 2, y + 0.02, bay.z0, 12.0, 0.02, 0.6, FACE.py);
  g.use('steelDark').tint(...OBSIDIAN);
  g.bevel(bay.x0 + 2.4, y + 4.2, bay.center[2], 0.9, 4.2, 1.8, 0.08);
  g.bevel(bay.x1 - 2.4, y + 4.2, bay.center[2], 0.9, 4.2, 1.8, 0.08);
  g.use('emissiveOrange').tint(0.95);
  g.box(bay.x0 + 3.35, y + 5.6, bay.center[2], 0.06, 2.4, 0.25, FACE.px);
  g.box(bay.x1 - 3.35, y + 5.6, bay.center[2], 0.06, 2.4, 0.25, FACE.nx);
  g.tint(1);
  mountSign(k, bay.center[0], y + 8.4, bay.z0 + 0.3, Math.PI, 'HIGH VOLTAGE', 3.4);
  k.light(bay.center[0], y + 6.5, bay.center[2], 'orange', 34, 16);
}

/** Structural concrete street-breakout ramp (y = -6 -> y = 0 at z = +18) sealed by destructible bulkhead. */
function buildBreakoutRamp(k: Kit, spec: MapSpec): void {
  const br = DATACENTER.breakoutRamp; // x: -4..+4, z: +2..+18, y: -6 -> 0
  const cx = (br.x0 + br.x1) / 2;

  // Wide 8 m smooth concrete breakout ramp (run = 16 m, rise = 6 m -> slope = 0.375, NavGraph-friendly!).
  k.ramp(cx, br.z0, br.y0, cx, br.z1, br.y1, br.width, 'concrete', 0.8, true);

  // Side concrete retaining walls flanking the ramp along x = -4.5 and x = +4.5.
  solidBox(k, 'concreteDark', br.x0 - 0.7, br.y0, br.z0, br.x0, DATACENTER.ceilY, br.z1, CONCRETE_COLD, 0.04);
  solidBox(k, 'concreteDark', br.x1, br.y0, br.z0, br.x1 + 0.7, DATACENTER.ceilY, br.z1, CONCRETE_COLD, 0.04);

  // Warning chevron strip along the ramp centerline leading up to daylight!
  k.stripLine([cx, br.y0 + 0.04, br.z0, cx, br.y1 + 0.04, br.z1 - 0.4], 0.4, 'emissiveOrange');
  mountSign(k, cx, br.y1 + 4.1, br.z1 - 0.8, Math.PI, 'BLAST DOOR', 3.2);

  // Destructible/removable concrete street bulkhead sealing z = +18 until Section 6->7 breakout!
  // Attaches after NavGraph.build() with `navBlock: true`, so nav stays valid and unblocks when breached!
  spec.cluster({
    id: br.bulkheadTag,
    tag: br.bulkheadTag,
    kind: 'bulkhead',
    label: 'SUB-LEVEL 4 BLAST BULKHEAD',
    value: 60_000,
    collapseThreshold: 0.35,
    nodes: [
      {
        id: 'bulkhead_west',
        pos: [-2.6, 2.2, br.bulkheadZ],
        half: [1.3, 2.2, 0.35],
        mat: 'concreteDark',
        color: 0x3b4452,
        hp: 260,
        tier: 1,
        anchored: true,
        navBlock: true,
        kind: 'wall',
        supports: ['bulkhead_center'],
        label: 'BULKHEAD WEST LEAF',
      },
      {
        id: 'bulkhead_center',
        pos: [0, 2.2, br.bulkheadZ],
        half: [1.3, 2.2, 0.35],
        mat: 'hazard',
        color: 0x626b78,
        hp: 240,
        tier: 1,
        anchored: true,
        keyNode: true,
        navBlock: true,
        kind: 'wall',
        supports: ['bulkhead_west', 'bulkhead_east'],
        label: 'BULKHEAD CENTER SEAL',
      },
      {
        id: 'bulkhead_east',
        pos: [2.6, 2.2, br.bulkheadZ],
        half: [1.3, 2.2, 0.35],
        mat: 'concreteDark',
        color: 0x3b4452,
        hp: 260,
        tier: 1,
        anchored: true,
        navBlock: true,
        kind: 'wall',
        supports: ['bulkhead_center'],
        label: 'BULKHEAD EAST LEAF',
      },
    ],
  });
}

/** Freezing blue server-hall lighting across all 3 Compute Clusters, Catwalks, and Air-Gap Core (10 lights). */
function buildVaultLighting(k: Kit): void {
  const CRYO_BLUE = 0x2a8cff;
  const ICE_CYAN = 0x6be0ff;
  k.light(0, 1.5, -3, ICE_CYAN, 120, 32);        // Central Air-Gap Core glow
  k.light(0, 1.5, -17, CRYO_BLUE, 88, 26);       // North Compute Cluster
  k.light(-24, 1.5, -4, CRYO_BLUE, 88, 26);      // West Compute Cluster
  k.light(24, 1.5, -4, CRYO_BLUE, 88, 26);       // East Compute Cluster
  k.light(-12, 2.5, 6, ICE_CYAN, 68, 24);        // SW Catwalk
  k.light(11, 2.5, 4, ICE_CYAN, 74, 24);         // Elevator Landing & Main Aisle
  k.light(0, 1.2, 11, 0xffaa66, 52, 20);         // Breakout Ramp warm accent
}

export function authorDatacenter(k: Kit, spec: MapSpec): void {
  buildVaultShell(k, spec);
  buildComputeClusters(k, spec);
  buildVaultCatwalks(k, spec);
  buildAirGapCore(k, spec);
  buildAegisBay(k);
  buildBreakoutRamp(k, spec);
  buildVaultLighting(k);
}
