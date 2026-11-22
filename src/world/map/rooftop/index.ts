/**
 * Rooftop Skyline (`rooftop`): 7 interconnected skyscrapers at varied elevations (20..44.5 m)
 * over a lethal street chasm (`killY = 5`), built for parkour movement and multi-vector SWAT combat.
 */
import * as THREE from 'three';
import type { SpawnPoint } from '../../../core/contracts';
import type { Kit } from '../../kit/kit';
import type { MapSpec } from '../spec';
import { authorParkour } from './parkour';
import {
  FLYER_SPAWNS, LV, PICKUP_SPOTS, PLAYER_SPAWNS,
  ROOFTOP_BOUNDS, ROOFTOP_HUB, ROOFTOP_KILL_Y, ROOFTOP_LIGHT_BOUNDS, ROOFTOP_LIGHT_CELL,
  STAIRWELL_DOORS, TOWERS,
} from './plan';
import { authorProps } from './props';
import { authorTowers } from './towers';

export const ROOFTOP_STAGES = [
  {
    label: 'Raising the skyline',
    run: (k: Kit, spec: MapSpec) => {
      spec.reactor = null;
      spec.killY = ROOFTOP_KILL_Y;
      spec.plan = { fills: [], walls: [], blocks: [], decks: [], gates: [], doors: [] };
      authorTowers(k, spec);
    },
  },
  { label: 'Rigging the parkour lines', run: authorParkour },
  { label: 'Dressing the rooftops', run: authorProps },
] as const;

function zones(spec: MapSpec): void {
  const sky = ROOFTOP_BOUNDS.y1;
  // Specific sub-decks first so zoneAt resolves the tightest match.
  spec.zone('roof-apex-penthouse', 'APEX PENTHOUSE', -20, LV.helios - 0.5, -14, -11, sky, -4);
  spec.zone('roof-helios-spire', 'HELIOS COMMS SPIRE', -12, LV.heliosTop - 0.5, -64, 10, sky, -52);
  spec.zone('roof-foundry-crane', 'TOWER CRANE', 30, 36, -15, 64, sky, -5);
  spec.zone('roof-meridian-terrace', 'MERIDIAN TERRACE', -58, LV.meridianTop - 0.5, -14, -39, sky, 0);
  spec.zone('roof-bastion-towers', 'WATER-TOWER DECK', -22, LV.vanguard - 0.5, 48, -10, sky, 62);
  spec.zone('roof-citadel-mezz', 'ATRIUM MEZZANINE', 58, LV.apex - 0.5, 34, 68, sky, 62);

  for (const t of TOWERS) {
    spec.zone(t.zone, t.name, t.x0, t.y - 2, t.z0, t.x1, sky, t.z1);
  }
  spec.zone('roof-skyline', 'SKYLINE', ROOFTOP_BOUNDS.x0, ROOFTOP_BOUNDS.y0, ROOFTOP_BOUNDS.z0, ROOFTOP_BOUNDS.x1, sky, ROOFTOP_BOUNDS.z1);
}

function spawns(spec: MapSpec): void {
  // Stairwell doors are already registered as `spec.gates` (`kind: 'gate'`) in `towers.ts`.
  // Also expose ground + air spawns so Crucible/fallback modes play cleanly on this map.
  const groundSpawns: SpawnPoint[] = STAIRWELL_DOORS.map(d => ({
    position: new THREE.Vector3(d.x, d.y + 0.1, d.z),
    zone: d.zone,
    kind: 'ground',
  }));
  const airSpawns: SpawnPoint[] = FLYER_SPAWNS.map(([x, y, z]) => ({
    position: new THREE.Vector3(x, y, z),
    zone: 'roof-skyline',
    kind: 'air',
  }));
  spec.spawns = [...groundSpawns, ...airSpawns];

  for (const [x, y, z] of PICKUP_SPOTS) spec.pickup(x, y, z);
  for (const s of PLAYER_SPAWNS) {
    spec.playerSpawns.push({ position: new THREE.Vector3(s.x, s.y + 0.1, s.z), yaw: s.yaw });
  }
}

function views(spec: MapSpec): void {
  spec.view('overview', 88, 72, 86, 0, 28, -4);
  spec.view('high', 0, 145, 16, 0, 28, 0);
  spec.view('helipad', 0, LV.apex + 2, 16, 0, LV.apex + 4, -40);
  spec.view('crane', 42, 41, -10, 0, LV.apex + 2, 0);
  spec.view('chimney', -48.5, LV.meridian + 2, 6, -48.5, LV.meridianTop, -8);
  spec.view('spire', -2, 46.5, -56, 0, LV.apex, 10);
  spec.view('waterTower', -16, LV.vanguard + 2, 52, 0, LV.apex, -10);
}

export function authorRooftop(_k: Kit, spec: MapSpec): void {
  zones(spec);
  spawns(spec);
  views(spec);
}

export {
  ROOFTOP_BOUNDS,
  ROOFTOP_HUB,
  ROOFTOP_KILL_Y,
  ROOFTOP_LIGHT_BOUNDS,
  ROOFTOP_LIGHT_CELL,
};
export const ROOFTOP_LEVELS = Object.values(LV);
