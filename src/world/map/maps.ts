/** Every playable map and how to pick one. Add a map by adding a row: World never needs to know which one it runs. */
import * as THREE from 'three';
import type { Kit } from '../kit/kit';
import type { NavBuildOptions } from '../nav';
import { authorMap, MAP_STAGES, type MapStage } from './crucible';
import { authorKillHouse, KILLHOUSE_EXTENT, KILLHOUSE_STAGES } from './killhouse';
import { authorRange, RANGE, RANGE_STAGES } from '../../lab/range';
import { KH } from './killhouse/plan';
import { LEVEL, RING } from './layout';
import type { MapSpec } from './spec';
import type { MapZone } from '../../core/contracts';

export type MapId = 'crucible' | 'killhouse' | 'range';

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

const MAPS: Record<MapId, MapDef> = { crucible, killhouse, range };
/** The swarm game. The Kill House is a separate game mode, reached by URL until the menu can pick it. */
const DEFAULT_MAP: MapId = 'crucible';

/** `?map=killhouse`, `?map=range` or `?map=crucible`. Anything else, including the movement sandbox's `?map=1`, is the default. */
export function selectMap(): MapDef {
  const name = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('map');
  return MAPS[name as MapId] ?? MAPS[DEFAULT_MAP];
}
