/**
 * Holdfast, the free port on the salt flats of Brine: Foreclosure's map, at `/?map=holdfast`. plan.ts has every number,
 * `campaign/missions/foreclosure.places.ts` every mark the mission uses, and docs/notes/holdfast.md draws it.
 */
import * as THREE from 'three';
import type { SpawnPoint } from '../../../core/contracts';
import type { Kit } from '../../kit/kit';
import type { MapSpec } from '../spec';
import { authorGround } from './ground';
import { APRON, BOUNDS, HOLDFAST_SPAWNS, LEVEL, LZ, PANS, QUAY_ROAD, ROADS, SKY, SLIP, SQUARE, WALL_Z, WEST_X } from './plan';
import { authorTown } from './town';
import { authorYard } from './yard';

export const HOLDFAST_STAGES = [
  { label: 'Laying the salt', run: (k: Kit, spec: MapSpec) => { start(spec); authorGround(k, spec); } },
  { label: 'Painting the town', run: authorTown },
  { label: 'Stacking the yard', run: authorYard },
] as const;

function start(spec: MapSpec): void {
  spec.reactor = null;
  const fill = (x0: number, z0: number, x1: number, z1: number, rgb: readonly [number, number, number], label = '') => ({ x0, z0, x1, z1, rgb, label });
  spec.plan = {
    fills: [
      fill(BOUNDS.x0, BOUNDS.z0, WEST_X, BOUNDS.z1, [0.3, 0.3, 0.29], 'THE PANS'),
      fill(WEST_X, WALL_Z, BOUNDS.x1, BOUNDS.z1, [0.24, 0.23, 0.2], 'THE FLATS'),
      fill(WEST_X, -105, BOUNDS.x1, WALL_Z, [0.2, 0.18, 0.15]),
      fill(SQUARE.x0, SQUARE.z0, SQUARE.x1, SQUARE.z1, [0.3, 0.24, 0.18], 'THE SQUARE'),
    ],
    walls: [], blocks: [], decks: [], gates: [], doors: [],
  };
  spec.roads = ROADS.map(r => ({ id: r.id, points: r.points, width: r.width }));
}

/** Smallest first: a point takes the first zone it is in. Ids start with an audio room (roomForZone): open air is `ring`/`scrapyard`. */
function zones(spec: MapSpec): void {
  spec.zone('foundry-slip', 'THE SLIP', SLIP.x0, LEVEL.slip - 1, SLIP.z0, SLIP.x1, 2, SLIP.z1);
  spec.zone('ring-square', 'THE SQUARE', SQUARE.x0, -1, SQUARE.z0, SQUARE.x1, SKY, SQUARE.z1);
  spec.zone('refinery-stacks', 'THE STACKS', -9, -1, -44, 110, SKY, 8);
  spec.zone('ring-quay', 'THE QUAY', -9, -1, APRON.z0, BOUNDS.x1, SKY, APRON.z1);
  spec.zone('ring-quayroad', 'QUAY ROAD', QUAY_ROAD.x0, -1, QUAY_ROAD.z0, BOUNDS.x1, SKY, 8);
  spec.zone('ring-harbour', 'THE HARBOUR', -9, -1, -113, BOUNDS.x1, SKY, APRON.z0);
  spec.zone('scrapyard-market', 'THE MARKET', -9, -1, 8, BOUNDS.x1, SKY, WALL_Z);
  spec.zone('scrapyard-shanties', 'OUTER SHANTIES', WEST_X, -1, WALL_Z, BOUNDS.x1, SKY, 84);
  spec.zone('scrapyard-flats', 'THE FLATS', WEST_X, -1, 84, BOUNDS.x1, SKY, BOUNDS.z1);
  spec.zone('ring-pans', 'THE PANS', BOUNDS.x0, -1, BOUNDS.z0, WEST_X, SKY, BOUNDS.z1);
}

function spawns(spec: MapSpec): void {
  const ground = (p: readonly number[], zone: string): SpawnPoint => ({ position: new THREE.Vector3(p[0], p[1]! + 0.1, p[2]), zone, kind: 'ground' });
  spec.spawns = [
    ...HOLDFAST_SPAWNS.foot.map(p => ground(p, 'scrapyard-market')),
    ...HOLDFAST_SPAWNS.air.map(p => ({ position: new THREE.Vector3(p[0], p[1], p[2]), zone: 'ring-harbour', kind: 'air' as const })),
  ];
  for (const p of HOLDFAST_SPAWNS.foot) spec.gate('scrapyard-market', p[0], p[1] + 0.1, p[2]);
}

function views(spec: MapSpec): void {
  const eye = 1.62;
  const look = (name: string, x: number, y: number, z: number, lx: number, ly: number, lz: number) => spec.view(name, x, y + eye, z, lx, ly, lz);
  spec.view('overview', 150, 150, 210, 20, 0, -10);
  spec.view('high', 0, 330, 60, 0, 0, 0);
  // The gunship's seat: on its orbit (radius 160, altitude 185) round the LZ, from the south and from the north-east over the town.
  spec.view('ac130', LZ.x, 185, LZ.z + 160, LZ.x, 0, LZ.z);
  spec.view('ac130East', LZ.x + 113, 185, LZ.z - 113, LZ.x, 0, LZ.z);
  look('lz', 40, 0, 104, 64, 2, 52);
  look('shanties', 20, 0, 84, 70, 1, 56);
  look('trench', 30, 0, 74, 52, 0.5, 64);
  look('fuel', 128, 0, 86, 150, 3, 64);
  look('gate', 70, 0, 72, 70, 3, 50);
  spec.view('wallOut', 92, 9, 80, 62, 2, 50);
  look('gunPad', 40, LEVEL.pad, 46, 44, 0, 80);
  look('step', 112, LEVEL.step, 48.4, 112, 0, 80);
  look('mainStreet', 70, 0, 47, 70, 2, 26);
  look('lane', 12, 0, 40, 12, 2, 16);
  look('saltLane', 10, 0, 29, 56, 2, 29);
  look('saltStreet', 84, 0, 29, 140, 2, 29);
  look('square', 80, 0, 39, 62, 2, 18);
  spec.view('squareHigh', 90, 18, 52, 66, 0, 24);
  look('roof', 45, LEVEL.roof, 39, 70, 1, 26);
  look('craneStreet', 4, 0, 11.5, 60, 2, 11.5);
  look('stacksFoot', 32, 0, 14, 32, 5, 4);
  look('stacksA', 37.5, 5.2, 4, 37.5, 9, -6);
  look('chimney', 37.55, 5.2, 1.2, 37.55, 12, -10);
  look('stacksTop', 32, 10.4, -20, 50, 4, -48);
  look('stacksEnd', 30, 7.8, -42, 56, 0, -50);
  look('aisle', 56.5, 0, 12, 56.5, 1.5, -44);
  look('grandad', 56.5, 2, -50, 56.5, 1, 8);
  look('craneCab', 22, 22, -20, 31, 23, -20);
  look('craneLeg', 6.35, 0, -12, 6.35, 12, -20);
  look('quay', 70, LEVEL.quayDeck, -58, 118, -4, -76);
  spec.view('slip', 98, 9, -48, 120, -6, -80);
  look('slipFloor', 104, LEVEL.slip, -66, 140, -4, -84);
  look('flak', 52, 0, -99, 20, 16, -104);
  look('harbourWalk', 60, LEVEL.harbour, -108, 20, 20, -106);
  look('westRoad', -2, 0, -60, -2, 2, -20);
  look('westGate', 4, 0, -20, -40, 2, -20);
  look('pans', -24, 0, -20, -110, 3, -10);
  spec.view('pansWide', -40, 40, 90, -90, 0, -20);
  look('cannery', 118, 0, 10, 140, 4, -30);
}

export function authorHoldfast(_k: Kit, spec: MapSpec): void {
  zones(spec);
  spawns(spec);
  spec.playerSpawns.push({ position: new THREE.Vector3(LZ.x, 0.1, LZ.z), yaw: 0 });
  views(spec);
}

export const HOLDFAST_BOUNDS = BOUNDS;
export const HOLDFAST_HUB = new THREE.Vector3(LZ.x, 0, LZ.z);
export { PANS };
