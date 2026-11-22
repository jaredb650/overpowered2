/**
 * Chancery Estate ("Quiet Title"): High Magistrate Vane's cliffside limestone modernist compound
 * overlooking the burning salt flats of Holdfast.
 *
 * `plan.ts` holds every coordinate, stealth light fixture, wing breaker, CCTV camera, and alarm panel;
 * `grounds.ts` builds the coastal culvert, perimeter wall, gardens, generator complex, grand courtyard,
 * glass conservatory, bell tower sniper perch, and cliff horizon;
 * `mansion.ts` builds the Chancery Mansion, Upper Bureau, East Loggia, Servant Wing, and Sub-Level Bunker.
 */
import * as THREE from 'three';
import type { SpawnPoint } from '../../../core/contracts';
import type { Kit } from '../../kit/kit';
import type { MapSpec } from '../spec';
import { authorGrounds } from './grounds';
import { authorMansion } from './mansion';
import {
  AIR_SPAWNS,
  CHANCERY_ALARMS,
  CHANCERY_BOUNDS,
  CHANCERY_BREAKERS,
  CHANCERY_CAMERAS,
  CHANCERY_HUB,
  CHANCERY_KILL_Y,
  CHANCERY_LEVELS,
  CHANCERY_LIGHT_BOUNDS,
  CHANCERY_LIGHT_CELL,
  CHANCERY_LIGHTS,
  CHANCERY_ROADS,
  GROUND_SPAWNS,
  PICKUP_SPOTS,
  PLAYER_SPAWNS,
  SIGHTLINES,
} from './plan';

export const CHANCERY_STAGES = [
  {
    label: 'Shaping the grounds',
    run: (k: Kit, spec: MapSpec) => {
      start(spec);
      authorGrounds(k, spec);
    },
  },
  {
    label: 'Raising the Chancery',
    run: authorMansion,
  },
] as const;

function start(spec: MapSpec): void {
  spec.reactor = null;
  spec.killY = CHANCERY_KILL_Y;
  const fill = (
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    rgb: readonly [number, number, number],
    label = '',
  ) => ({ x0, z0, x1, z1, rgb, label });

  spec.plan = {
    fills: [
      fill(-74, 16, -24, 46, [0.18, 0.24, 0.18], 'WEST GARDEN'),
      fill(-68, -18, -32, 14, [0.24, 0.25, 0.28], 'GENERATOR HOUSE'),
      fill(-26, -22, 26, 36, [0.3, 0.29, 0.27], 'GRAND COURTYARD'),
      fill(28, 14, 74, 46, [0.18, 0.24, 0.18], 'EAST TERRACE'),
      fill(34, -26, 62, 10, [0.22, 0.3, 0.32], 'CONSERVATORY'),
      fill(-52, -58, -24, -26, [0.26, 0.25, 0.24], 'SERVANT'),
      fill(-24, -60, 24, -24, [0.34, 0.33, 0.31], 'CHANCERY'),
    ],
    walls: [],
    blocks: [],
    decks: [],
    gates: [],
    doors: [],
  };
  spec.roads = CHANCERY_ROADS.map(r => ({ id: r.id, points: r.points, width: r.width }));
}

/** Smallest / most specific zones first so `zoneAt` resolves the tightest match. */
function zones(spec: MapSpec): void {
  const sky = CHANCERY_BOUNDS.y1;
  // Sub-Level (-8)
  spec.zone('bunker-continuity', 'CONTINUITY BUNKER', -18, -10, -62, 18, -3, -38);
  spec.zone('bunker-armory', 'GUARD ARMORY', -22, -10, -20, -6, -3, -8);
  spec.zone('bunker-antechamber', 'VAULT ANTECHAMBER', -24, -10, -38, 16, -3, -20);
  spec.zone('bunker-capacitor', 'GENERATOR SUB-BASEMENT', -62, -10, -30, -40, -3, -14);
  spec.zone('bunker-tunnel', 'UTILITY TUNNEL', -54, -10, -46, -22, -3, -20);

  // Upper Levels (6 & 11.5)
  spec.zone('belltower-perch', 'BELL-TOWER PERCH', 44, 10.5, -28, 56, sky, -16);
  spec.zone('mansion-loggia', 'EAST PRIVATE LOGGIA', 20, 5.5, -50, 30, 12.5, -30);
  spec.zone('mansion-bureau', 'UPPER BUREAU', -20, 5.5, -58, 20, 12.5, -26);

  // Ground Interiors (0)
  spec.zone('mansion-sechub', 'SECURITY HUB', 14, -1, -38, 23, 5.8, -28);
  spec.zone('mansion-foyer', 'GRAND FOYER', -12, -1, -36, 12, 5.8, -24);
  spec.zone('mansion-library', 'WEST LIBRARY', -24, -1, -58, -12, 5.8, -24);
  spec.zone('mansion-archive', 'EAST ARCHIVE', 12, -1, -58, 24, 5.8, -24);
  spec.zone('mansion-servant', 'SERVANT WING', -52, -1, -58, -24, 5.8, -26);
  spec.zone('generator-house', 'GENERATOR HOUSE', -68, -1, -18, -32, 6.2, 14);
  spec.zone('conservatory-hall', 'GLASS CONSERVATORY', 34, -1, -26, 62, 7.6, 10);
  spec.zone('guardhouse-a', 'GUARDHOUSE A', -32, -1, 36, -22, 4.5, 44);
  spec.zone('guardhouse-b', 'GUARDHOUSE B', 30, -1, 36, 40, 4.5, 44);

  // Outer Grounds (0 -> sky)
  spec.zone('ring-courtyard', 'GRAND COURTYARD', -26, -1, -22, 26, sky, 36);
  spec.zone('ring-west-garden', 'WEST GARDEN', -74, -1, 16, -24, sky, 46);
  spec.zone('ring-east-terrace', 'EAST HEDGE TERRACE', 28, -1, 14, 74, sky, 46);
  spec.zone('ring-culvert', 'COASTAL CULVERT', -72, -1, 48, -38, sky, 72);
  spec.zone('ring-approach', 'MAIN GATE APPROACH', -38, -1, 46, 38, sky, 72);
  spec.zone('ring-cliff', 'NORTH CLIFF BLUFF', CHANCERY_BOUNDS.x0, -14, CHANCERY_BOUNDS.z0, CHANCERY_BOUNDS.x1, sky, -60);
  spec.zone('ring-estate', 'CHANCERY GROUNDS', CHANCERY_BOUNDS.x0, -14, CHANCERY_BOUNDS.z0, CHANCERY_BOUNDS.x1, sky, CHANCERY_BOUNDS.z1);
}

function spawns(spec: MapSpec): void {
  const groundSpawns: SpawnPoint[] = GROUND_SPAWNS.map(([x, y, z, zone]) => ({
    position: new THREE.Vector3(x, y + 0.1, z),
    zone,
    kind: 'ground',
  }));
  const airSpawns: SpawnPoint[] = AIR_SPAWNS.map(([x, y, z]) => ({
    position: new THREE.Vector3(x, y, z),
    zone: 'ring-estate',
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
  const eye = 1.62;
  const look = (name: string, x: number, y: number, z: number, lx: number, ly: number, lz: number) =>
    spec.view(name, x, y + eye, z, lx, ly, lz);

  spec.view('overview', 96, 78, 92, 0, 2, -20);
  spec.view('high', 0, 175, 16, 0, 0, -12);
  look('insertion', -55, 0, 62, -55, 2, 42);
  look('gatehouse', 0, 0, 56, 0, 4, -24);
  look('courtyard', 0, 0, 26, 0, 8, -36);
  look('generator', -50, 0, 10, -42, 2, -6);
  look('capacitor', -44, -8, -18, -50, -6.5, -22);
  look('conservatory', 48, 0, 6, 48, 4, -18);
  spec.view('perchWindow', ...SIGHTLINES.perchEye, ...SIGHTLINES.vaneWindow);
  spec.view('perchLoggia', ...SIGHTLINES.perchEye, ...SIGHTLINES.eastLoggia);
  look('foyer', 0, 0, -25, 0, 4, -46);
  look('sechub', 16, 0, -34, 21, 1.5, -34);
  look('bureau', 0, 6, -34, 0, 7, -50);
  look('loggia', 25, 6, -40, 48, 12, -22);
  look('bunkerDoor', 0, -8, -28, 0, -6, -38);
  look('bunker', 0, -8, -44, 0, -6.5, -54);
}

export function authorChancery(_k: Kit, spec: MapSpec): void {
  zones(spec);
  spawns(spec);
  views(spec);
}

export {
  CHANCERY_ALARMS,
  CHANCERY_BOUNDS,
  CHANCERY_BREAKERS,
  CHANCERY_CAMERAS,
  CHANCERY_HUB,
  CHANCERY_KILL_Y,
  CHANCERY_LEVELS,
  CHANCERY_LIGHT_BOUNDS,
  CHANCERY_LIGHT_CELL,
  CHANCERY_LIGHTS,
};
