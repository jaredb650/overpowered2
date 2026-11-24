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
import {
  authorBank, BANK_BOUNDS, BANK_HUB, BANK_LEVELS,
  BANK_LIGHT_BOUNDS, BANK_LIGHT_CELL, BANK_STAGES,
} from './bank';
import {
  authorDesert, DESERT_BOUNDS, DESERT_HUB, DESERT_LEVELS,
  DESERT_LIGHT_BOUNDS, DESERT_LIGHT_CELL, DESERT_STAGES,
} from './desert';
import {
  authorBadlands, BADLANDS_BOUNDS, BADLANDS_HUB, BADLANDS_LEVELS,
  BADLANDS_LIGHT_BOUNDS, BADLANDS_LIGHT_CELL, BADLANDS_STAGES,
} from './badlands';
import {
  authorDogfight, DOGFIGHT_BOUNDS, DOGFIGHT_HUB, DOGFIGHT_LEVELS,
  DOGFIGHT_LIGHT_BOUNDS, DOGFIGHT_LIGHT_CELL, DOGFIGHT_NAV_BOUNDS, DOGFIGHT_STAGES,
} from './dogfight';
import {
  authorAirbase, AIRBASE_BOUNDS, AIRBASE_HUB, AIRBASE_LEVELS,
  AIRBASE_LIGHT_BOUNDS, AIRBASE_LIGHT_CELL, AIRBASE_NAV_BOUNDS, AIRBASE_STAGES,
} from './airbase';
import {
  authorStrait, STRAIT_BOUNDS, STRAIT_HUB, STRAIT_LEVELS,
  STRAIT_LIGHT_BOUNDS, STRAIT_LIGHT_CELL, STRAIT_NAV_BOUNDS, STRAIT_STAGES,
} from './strait';
import {
  authorHalcyon, HALCYON_BOUNDS, HALCYON_HUB, HALCYON_LEVELS,
  HALCYON_LIGHT_BOUNDS, HALCYON_LIGHT_CELL, HALCYON_NAV_BOUNDS, HALCYON_STAGES,
} from './halcyon';
import { KH } from './killhouse/plan';
import { LEVEL, RING } from './layout';
import type { MapSpec } from './spec';
import type { MapZone } from '../../core/contracts';
import { ACTIVE } from '../../contracts/select';

export type MapId = 'crucible' | 'killhouse' | 'outpost' | 'fort' | 'holdfast' | 'office' | 'range' | 'annex' | 'rooftop' | 'chancery' | 'bank' | 'desert' | 'badlands' | 'dogfight' | 'airbase' | 'strait' | 'halcyon';

export interface MapDef {
  id: MapId;
  /** Playable bounds, the kill plane under the map and the fall-back containment. */
  bounds: THREE.Box3;
  /** Optional tighter bounds for the 1 m NavGraph bake (defaults to `bounds`). Great for huge air/sea maps. */
  navBounds?: THREE.Box3;
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
  /** Optional atmosphere preset ('night' default, 'dawn' for golden desert sunrise). */
  atmosphere?: 'night' | 'dawn';
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

const BK = BANK_BOUNDS;
const BKL = BANK_LIGHT_BOUNDS;
const bank: MapDef = {
  id: 'bank',
  bounds: box(BK.x0, BK.y0, BK.z0, BK.x1, BK.y1, BK.z1),
  lightBounds: box(BKL.x0, BKL.y0, BKL.z0, BKL.x1, BKL.y1, BKL.z1),
  lightCell: BANK_LIGHT_CELL,
  minimapExtent: 68,
  navHub: BANK_HUB,
  nav: { mutual: true, levels: [...BANK_LEVELS] },
  stages: BANK_STAGES,
  author: authorBank,
  readyLabel: 'Polishing the bullion',
};

const DR = DESERT_BOUNDS;
const DRL = DESERT_LIGHT_BOUNDS;
const desert: MapDef = {
  id: 'desert',
  bounds: box(DR.x0, DR.y0, DR.z0, DR.x1, DR.y1, DR.z1),
  lightBounds: box(DRL.x0, DRL.y0, DRL.z0, DRL.x1, DRL.y1, DRL.z1),
  lightCell: DESERT_LIGHT_CELL,
  minimapExtent: 220,
  navHub: DESERT_HUB,
  nav: { mutual: true, levels: [...DESERT_LEVELS] },
  stages: DESERT_STAGES,
  author: authorDesert,
  readyLabel: 'Raising the dust',
  atmosphere: 'dawn',
};

const BD = BADLANDS_BOUNDS;
const BDL = BADLANDS_LIGHT_BOUNDS;
const badlands: MapDef = {
  id: 'badlands',
  bounds: box(BD.x0, BD.y0, BD.z0, BD.x1, BD.y1, BD.z1),
  lightBounds: box(BDL.x0, BDL.y0, BDL.z0, BDL.x1, BDL.y1, BDL.z1),
  lightCell: BADLANDS_LIGHT_CELL,
  minimapExtent: 176,
  navHub: BADLANDS_HUB,
  nav: { mutual: true, levels: [...BADLANDS_LEVELS] },
  stages: BADLANDS_STAGES,
  author: authorBadlands,
  readyLabel: 'Opening the Badlands',
  atmosphere: 'dawn',
};

const DF = DOGFIGHT_BOUNDS;
const DFN = DOGFIGHT_NAV_BOUNDS;
const DFL = DOGFIGHT_LIGHT_BOUNDS;
const dogfight: MapDef = {
  id: 'dogfight',
  bounds: box(DF.x0, DF.y0, DF.z0, DF.x1, DF.y1, DF.z1),
  navBounds: box(DFN.x0, DFN.y0, DFN.z0, DFN.x1, DFN.y1, DFN.z1),
  lightBounds: box(DFL.x0, DFL.y0, DFL.z0, DFL.x1, DFL.y1, DFL.z1),
  lightCell: DOGFIGHT_LIGHT_CELL,
  minimapExtent: 280,
  navHub: DOGFIGHT_HUB,
  nav: { mutual: true, levels: [...DOGFIGHT_LEVELS] },
  stages: DOGFIGHT_STAGES,
  author: authorDogfight,
  readyLabel: 'Launching combat air patrol',
  atmosphere: 'dawn',
};

const AB = AIRBASE_BOUNDS;
const ABN = AIRBASE_NAV_BOUNDS;
const ABL = AIRBASE_LIGHT_BOUNDS;
const airbase: MapDef = {
  id: 'airbase',
  bounds: box(AB.x0, AB.y0, AB.z0, AB.x1, AB.y1, AB.z1),
  navBounds: box(ABN.x0, ABN.y0, ABN.z0, ABN.x1, ABN.y1, ABN.z1),
  lightBounds: box(ABL.x0, ABL.y0, ABL.z0, ABL.x1, ABL.y1, ABL.z1),
  lightCell: AIRBASE_LIGHT_CELL,
  minimapExtent: 168,
  navHub: AIRBASE_HUB,
  nav: { mutual: true, levels: [...AIRBASE_LEVELS] },
  stages: AIRBASE_STAGES,
  author: authorAirbase,
  readyLabel: 'Spoofing Northern IFF',
  atmosphere: 'dawn',
};

const ST = STRAIT_BOUNDS;
const STN = STRAIT_NAV_BOUNDS;
const STL = STRAIT_LIGHT_BOUNDS;
const strait: MapDef = {
  id: 'strait',
  bounds: box(ST.x0, ST.y0, ST.z0, ST.x1, ST.y1, ST.z1),
  navBounds: box(STN.x0, STN.y0, STN.z0, STN.x1, STN.y1, STN.z1),
  lightBounds: box(STL.x0, STL.y0, STL.z0, STL.x1, STL.y1, STL.z1),
  lightCell: STRAIT_LIGHT_CELL,
  minimapExtent: 640,
  navHub: STRAIT_HUB,
  nav: { mutual: true, levels: [...STRAIT_LEVELS] },
  stages: STRAIT_STAGES,
  author: authorStrait,
  readyLabel: 'Forming up on the Lancer',
  atmosphere: 'dawn',
};

const HL = HALCYON_BOUNDS;
const HLN = HALCYON_NAV_BOUNDS;
const HLL = HALCYON_LIGHT_BOUNDS;
const halcyon: MapDef = {
  id: 'halcyon',
  bounds: box(HL.x0, HL.y0, HL.z0, HL.x1, HL.y1, HL.z1),
  navBounds: box(HLN.x0, HLN.y0, HLN.z0, HLN.x1, HLN.y1, HLN.z1),
  lightBounds: box(HLL.x0, HLL.y0, HLL.z0, HLL.x1, HLL.y1, HLL.z1),
  lightCell: HALCYON_LIGHT_CELL,
  minimapExtent: 180,
  navHub: HALCYON_HUB,
  nav: { mutual: true, levels: [...HALCYON_LEVELS] },
  stages: HALCYON_STAGES,
  author: authorHalcyon,
  readyLabel: 'Arming Fortress Halcyon defenses',
  atmosphere: 'dawn',
};

const MAPS: Record<MapId, MapDef> = { crucible, killhouse, outpost, fort, holdfast, office, range, annex, rooftop, chancery, bank, desert, badlands, dogfight, airbase, strait, halcyon };

/** The map of the page's contract, or whatever `?map=` names. contracts/select.ts has the rules. */
export function selectMap(): MapDef {
  return MAPS[ACTIVE.map];
}
