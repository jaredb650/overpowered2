/**
 * OpenMind HQ & Grand Boulevard (`openmind`, Mission: Deprecation / Form 7742-A).
 *
 * Single seamless map spanning the eastern Mirror's Edge skyline (Towers 1-3),
 * Tower 4 OpenMind HQ (Executive Floor, Mezzanine & 6x6 Freight Elevator Shaft),
 * Sub-Level 4 Compute Vault (3 chain-exploding server clusters & 4 air-gap pylons),
 * and Downtown Grand Boulevard (Plaza Garage, destructible storefronts, Pedestrian
 * Skybridge, 4-Way Civic Intersection stagger-column buildings & Civic Spire Plaza).
 */
import * as THREE from 'three';
import type { SpawnPoint } from '../../../core/contracts';
import type { Kit } from '../../kit/kit';
import type { MapSpec } from '../spec';
import { authorBoulevard } from './boulevard';
import { authorDatacenter } from './datacenter';
import { authorOffice } from './office';
import {
  AIR_SPAWNS,
  BOULEVARD,
  DATACENTER,
  ELEVATOR_SHAFT,
  GROUND_SPAWNS,
  LV,
  OFFICE,
  OPENMIND_BOUNDS,
  OPENMIND_HUB,
  OPENMIND_KILL_Y,
  OPENMIND_LEVELS,
  OPENMIND_LIGHT_BOUNDS,
  OPENMIND_LIGHT_CELL,
  OPENMIND_ROADS,
  PICKUP_SPOTS,
  PLAYER_SPAWNS,
  TOWERS,
  VIEWS,
} from './plan';
import { authorSkyline } from './skyline';

function start(spec: MapSpec): void {
  spec.reactor = null;
  spec.killY = OPENMIND_KILL_Y;
  spec.plan = { fills: [], walls: [], blocks: [], decks: [], gates: [], doors: [] };
  spec.roads = OPENMIND_ROADS.map(r => ({ id: r.id, points: r.points, width: r.width }));
}

export const OPENMIND_STAGES = [
  {
    label: 'Raising the eastern skyline',
    run: (k: Kit, spec: MapSpec) => {
      start(spec);
      authorSkyline(k, spec);
    },
  },
  { label: 'Glazing OpenMind HQ', run: authorOffice },
  { label: 'Chilling Sub-Level 4', run: authorDatacenter },
  { label: 'Paving Grand Boulevard', run: authorBoulevard },
] as const;

/** Tightest zones first so `zoneAt` always resolves the most specific match. */
function zones(spec: MapSpec): void {
  const sky = OPENMIND_BOUNDS.y1;

  // Freight Elevator Shaft
  spec.zone(
    'om-shaft',
    'FREIGHT ELEVATOR SHAFT',
    ELEVATOR_SHAFT.x0,
    ELEVATOR_SHAFT.bottomY,
    ELEVATOR_SHAFT.z0,
    ELEVATOR_SHAFT.x1,
    OFFICE.mezzCeil,
    ELEVATOR_SHAFT.z1,
  );

  // OpenMind HQ Interior Floors
  spec.zone('om-exec', 'OPENMIND HQ EXECUTIVE', OFFICE.x0, OFFICE.execY - 0.5, OFFICE.z0, OFFICE.x1, OFFICE.execCeil + 1, OFFICE.z1);
  spec.zone('om-mezz', 'ENGINEERING MEZZANINE', OFFICE.x0, OFFICE.mezzY - 0.5, OFFICE.z0, OFFICE.x1, OFFICE.mezzCeil + 0.5, OFFICE.z1);

  // Sub-Level 4 Compute Vault
  spec.zone('om-vault', 'SUB-LEVEL 4 COMPUTE VAULT', DATACENTER.x0, DATACENTER.floorY - 1, DATACENTER.z0, DATACENTER.x1, DATACENTER.ceilY + 0.5, DATACENTER.z1);

  // Skyline Towers 1-3
  for (const t of TOWERS) {
    if (t.id !== 'hq') spec.zone(t.zone, t.name, t.x0, t.y - 8, t.z0, t.x1, sky, t.z1);
  }

  // Downtown Grand Boulevard Zones
  const pg = BOULEVARD.plazaGarage;
  spec.zone('om-garage', 'OPENMIND PLAZA GARAGE', pg.x0, pg.floorY - 1, pg.z0, pg.x1, 1.5, pg.z1 + 10);
  spec.zone('om-spire', 'CIVIC SPIRE PLAZA', BOULEVARD.spirePlaza.x0, -2, BOULEVARD.spirePlaza.z0, BOULEVARD.spirePlaza.x1, sky, BOULEVARD.spirePlaza.z1);
  spec.zone('om-intersection', 'CIVIC 4-WAY INTERSECTION', BOULEVARD.x0, -2, BOULEVARD.intersection.z0, BOULEVARD.x1, sky, BOULEVARD.intersection.z1);
  spec.zone('om-boulevard', 'GRAND BOULEVARD', BOULEVARD.x0, -2, BOULEVARD.z0, BOULEVARD.x1, sky, BOULEVARD.intersection.z0);

  // Fallback precinct
  spec.zone('om-downtown', 'DOWNTOWN CORE', OPENMIND_BOUNDS.x0, OPENMIND_BOUNDS.y0, OPENMIND_BOUNDS.z0, OPENMIND_BOUNDS.x1, sky, OPENMIND_BOUNDS.z1);
}

function spawns(spec: MapSpec): void {
  const groundSpawns: SpawnPoint[] = GROUND_SPAWNS.map(([x, y, z, zone]) => ({
    position: new THREE.Vector3(x, y + 0.1, z),
    zone,
    kind: 'ground',
  }));
  const airSpawns: SpawnPoint[] = AIR_SPAWNS.map(([x, y, z]) => ({
    position: new THREE.Vector3(x, y, z),
    zone: 'om-downtown',
    kind: 'air',
  }));
  spec.spawns = [...groundSpawns, ...airSpawns];

  for (const [x, y, z, zone] of GROUND_SPAWNS) spec.gate(zone, x, y + 0.1, z);
  for (const [x, y, z] of PICKUP_SPOTS) spec.pickup(x, y, z);
  for (const s of PLAYER_SPAWNS) {
    spec.playerSpawns.push({ position: new THREE.Vector3(s.x, s.y + 0.1, s.z), yaw: s.yaw });
  }
}

function views(spec: MapSpec): void {
  for (const [name, v] of Object.entries(VIEWS)) {
    spec.view(name, v.pos[0], v.pos[1], v.pos[2], v.look[0], v.look[1], v.look[2]);
  }
}

export function authorOpenmind(_k: Kit, spec: MapSpec): void {
  zones(spec);
  spawns(spec);
  views(spec);
}

export {
  LV,
  OPENMIND_BOUNDS,
  OPENMIND_HUB,
  OPENMIND_KILL_Y,
  OPENMIND_LEVELS,
  OPENMIND_LIGHT_BOUNDS,
  OPENMIND_LIGHT_CELL,
};
export * from './plan';
