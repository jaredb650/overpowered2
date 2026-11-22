/** Every playable map and how to pick one. Add a map by adding a row: World never needs to know which one it runs. */
import * as THREE from 'three';
import type { Kit } from '../kit/kit';
import type { NavBuildOptions } from '../nav';
import { authorMap, MAP_STAGES, type MapStage } from './crucible';
import { authorFort, FORT_EXTENT, FORT_STAGES } from './fort';
import { authorHoldfast, HOLDFAST_BOUNDS, HOLDFAST_HUB, HOLDFAST_STAGES } from './holdfast';
import { LEVEL as HOLDFAST_LEVEL } from './holdfast/plan';
import { LEVEL as FORT_LEVEL } from './fort/plan';
import { authorKillHouse, KILLHOUSE_EXTENT, KILLHOUSE_STAGES } from './killhouse';
import { authorOutpost, OUTPOST_EXTENT, OUTPOST_STAGES } from './outpost';
import { authorOffice, OFFICE_BOUNDS, OFFICE_HUB, OFFICE_STAGES } from './office';
import { LV as OFFICE_LEVEL } from './office/plan';
import { authorRange, RANGE, RANGE_STAGES } from '../../lab/range';
import { ANNEX_BOUNDS, ANNEX_HUB, ANNEX_STAGES, authorAnnex } from './annex';
import {
  authorRooftop, ROOFTOP_BOUNDS, ROOFTOP_HUB, ROOFTOP_LEVELS,
  ROOFTOP_LIGHT_BOUNDS, ROOFTOP_LIGHT_CELL, ROOFTOP_STAGES,
} from './rooftop';
import {
  authorChancery, CHANCERY_BOUNDS, CHANCERY_HUB, CHANCERY_LEVELS,
  CHANCERY_LIGHT_BOUNDS, CHANCERY_LIGHT_CELL, CHANCERY_STAGES,
} from './chancery';
import { KH } from './killhouse/plan';
import { LEVEL, RING } from './layout';
import type { MapSpec } from './spec';
import type { MapZone } from '../../core/contracts';
import { ACTIVE } from '../../contracts/select';

export type MapId = 'crucible' | 'killhouse' | 'outpost' | 'fort' | 'holdfast' | 'office' | 'range' | 'annex' | 'rooftop' | 'chancery';

export interface MapDef {
  id: MapId;
  /** Nav columns, the kill plane under the map and the fall-back containment. */
  bounds: THREE.Box3;
  /** Light volume and static moon shadow coverage. */
  lightBounds: THREE.Box3;
  /** Light volume cell in meters. Undefined takes the renderer's default. */
  lightCell?: number;
  /** Half width of the square the minimap charts. */
  minimapExtent: number;
  /** Any spot every walkable node must be able to reach. */
  navHub: THREE.Vector3;
  nav?: NavBuildOptions;
  stages: readonly MapStage[];
  author(k: Kit, spec: MapSpec): void;
  readyLabel: string;
  zoneOverride?(position: THREE.Vector3, zones: readonly MapZone[]): MapZone | null;
}

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) =>
  new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));

const crucible: MapDef = {
  id: 'crucible',
  bounds: box(-172, -18, -172, 172, 110, 172),
  lightBounds: box(-RING.half - 24, -18, -RING.half - 24, RING.half + 24, 72, RING.half + 24),
  minimapExtent: 172,
  navHub: new THREE.Vector3(30, -8, 0),
  stages: MAP_STAGES,
  author: authorMap,
  readyLabel: 'Lighting the reactor',
  // The deck curves through the zone rectangles at the corners, so test it by distance from its centre line.
  zoneOverride(p, zones) {
    if (p.y <= LEVEL.ring - 3) return null;
    const cc = RING.half - RING.corner;
    const dx = Math.abs(p.x) - cc, dz = Math.abs(p.z) - cc;
    const d = dx > 0 && dz > 0 ? Math.hypot(dx, dz) : Math.max(dx, dz);
    return Math.abs(d - RING.corner) < RING.width / 2 + 1 ? zones[zones.length - 1] ?? null : null;
  },
};

const E = KILLHOUSE_EXTENT;
const killhouse: MapDef = {
  id: 'killhouse',
  bounds: box(-E, -4, -E, E, 40, E),
  lightBounds: box(-E - 2, -2, -E - 2, E + 2, 24, E + 2),
  lightCell: 1,
  minimapExtent: E,
  navHub: new THREE.Vector3(0, 0, 7),
  // A wall top or a block of cover is no floor here. A player up on one seeds the flow field at the nearest real floor,
  // which is where the enemies should gather anyway.
  nav: { mutual: true, levels: [0, KH.deck] },
  stages: KILLHOUSE_STAGES,
  author: authorKillHouse,
  readyLabel: 'Lighting the floods',
};

const O = OUTPOST_EXTENT;
const outpost: MapDef = {
  id: 'outpost',
  bounds: box(-O, -14, -O, O, 70, O),
  // The volume caps at 200 cells a side, so a site this wide cannot have the Kill House's 1 m cell.
  lightBounds: box(-O + 4, -13, -O + 4, O - 4, 34, O - 4),
  lightCell: 1.2,
  minimapExtent: O,
  navHub: new THREE.Vector3(0, 0, 50),
  // Every flat height a man can stand on. Tops of cover, roofs and the wreck's deck are no floor, so a player up on one seeds the field
  // at the nearest real floor, and nobody tries to path to them.
  nav: { mutual: true, levels: [-12, -6, -5, -3, 0, 5, 9, 10, 14] },
  stages: OUTPOST_STAGES,
  author: authorOutpost,
  readyLabel: 'Lighting the wire',
};

const F = FORT_EXTENT;
const fort: MapDef = {
  id: 'fort',
  bounds: box(-F, -4, -F, F, 40, F),
  // The volume caps at 200 cells a side: 240 m at 1.2 m is 200.
  lightBounds: box(-F, -2, -F, F, 20, F),
  lightCell: 1.2,
  minimapExtent: F,
  navHub: new THREE.Vector3(1, 0, 1),
  // The field, the catwalks, the gun pads and the bastion tops. Roofs, sandbags and cover tops are no floor.
  nav: { mutual: true, levels: Object.values(FORT_LEVEL) },
  stages: FORT_STAGES,
  author: authorFort,
  readyLabel: 'Manning the walls',
};

const H = HOLDFAST_BOUNDS;
const holdfast: MapDef = {
  id: 'holdfast',
  bounds: box(H.x0, -10, H.z0, H.x1, 60, H.z1),
  // The volume caps at 200 cells a side: 360 m at 1.8 m is 200, so the salt is lit out to the horizon.
  lightBounds: box(-180, -8, -180, 180, 28, 180),
  lightCell: 1.8,
  minimapExtent: Math.max(-H.x0, H.x1, -H.z0, H.z1),
  navHub: HOLDFAST_HUB,
  // The salt, the dock's floor, the firing steps, gun pads, flat roofs, the harbour walk, the quay crane's deck and the east stacks' top.
  // Container tops elsewhere are no floor: nobody walks the parkour route.
  nav: { mutual: true, levels: Object.values(HOLDFAST_LEVEL) },
  stages: HOLDFAST_STAGES,
  author: authorHoldfast,
  readyLabel: 'Hanging out the washing',
};

const OF = OFFICE_BOUNDS;
const office: MapDef = {
  id: 'office',
  bounds: box(OF.x0, -4, OF.z0, OF.x1, 40, OF.z1),
  // 148 m at 1 m is under the volume's 200 cells; 32 m tall is under its 48.
  lightBounds: box(OF.x0, -2, OF.z0, OF.x1, 30, OF.z1),
  lightCell: 1,
  minimapExtent: Math.max(-OF.x0, OF.x1, -OF.z0, OF.z1),
  navHub: OFFICE_HUB,
  // The ground, the first floor and both roofs. Desks, planters, cover, the canopy and the scaffold are no floor.
  nav: { mutual: true, levels: Object.values(OFFICE_LEVEL) },
  stages: OFFICE_STAGES,
  author: authorOffice,
  readyLabel: 'Filing the paperwork',
};

const range: MapDef = {
  id: 'range',
  bounds: box(-RANGE.halfX - 2, -4, -RANGE.halfZ - 2, RANGE.halfX + 2, 34, RANGE.halfZ + 2),
  lightBounds: box(-RANGE.halfX - 1, -1, -RANGE.halfZ - 1, RANGE.halfX + 1, 14, RANGE.halfZ + 1),
  minimapExtent: RANGE.halfX + 2,
  navHub: new THREE.Vector3(0, 0, 8),
  stages: RANGE_STAGES,
  author: authorRange,
  readyLabel: 'Switching on the lights',
};

const AN = ANNEX_BOUNDS;
const annex: MapDef = {
  id: 'annex',
  bounds: box(AN.x0, -8, AN.z0, AN.x1, 48, AN.z1),
  // 470 m long at 2.4 m is under the volume's 200 cells.
  lightBounds: box(AN.x0, -6, AN.z0, AN.x1, 30, AN.z1),
  lightCell: 2.4,
  minimapExtent: Math.max(-AN.z0, AN.z1) / 2 + 20,
  navHub: ANNEX_HUB,
  // The Yard is the only floor anyone walks on their own: the rest of the subjects are held where they stand.
  nav: { mutual: true, levels: [0] },
  stages: ANNEX_STAGES,
  author: authorAnnex,
  readyLabel: 'Issuing the contractor',
};

const RT = ROOFTOP_BOUNDS;
const RTL = ROOFTOP_LIGHT_BOUNDS;
const rooftop: MapDef = {
  id: 'rooftop',
  bounds: box(RT.x0, RT.y0, RT.z0, RT.x1, RT.y1, RT.z1),
  // 168 m at 1.2 m is 140 <= 200; 40 m tall at 1.2 m is 34 <= 48.
  lightBounds: box(RTL.x0, RTL.y0, RTL.z0, RTL.x1, RTL.y1, RTL.z1),
  lightCell: ROOFTOP_LIGHT_CELL,
  minimapExtent: Math.max(-RT.x0, RT.x1, -RT.z0, RT.z1),
  navHub: ROOFTOP_HUB,
  nav: { mutual: true, levels: ROOFTOP_LEVELS },
  stages: ROOFTOP_STAGES,
  author: authorRooftop,
  readyLabel: 'Clearing the skyline',
};

const CH = CHANCERY_BOUNDS;
const CHL = CHANCERY_LIGHT_BOUNDS;
const chancery: MapDef = {
  id: 'chancery',
  bounds: box(CH.x0, CH.y0, CH.z0, CH.x1, CH.y1, CH.z1),
  lightBounds: box(CHL.x0, CHL.y0, CHL.z0, CHL.x1, CHL.y1, CHL.z1),
  lightCell: CHANCERY_LIGHT_CELL,
  minimapExtent: Math.max(-CH.x0, CH.x1, -CH.z0, CH.z1),
  navHub: CHANCERY_HUB,
  nav: { mutual: true, levels: [...CHANCERY_LEVELS] },
  stages: CHANCERY_STAGES,
  author: authorChancery,
  readyLabel: 'Dimming the chandeliers',
};

const MAPS: Record<MapId, MapDef> = { crucible, killhouse, outpost, fort, holdfast, office, range, annex, rooftop, chancery };

/** The map of the page's contract, or whatever `?map=` names. contracts/select.ts has the rules. */
export function selectMap(): MapDef {
  return MAPS[ACTIVE.map];
}
