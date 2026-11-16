/**
 * The Office: Regional Processing Office 9, a branch of the Office of Societal Compliance. Both survival modes play here
 * (`ContractDef.alsoOn`). plan.ts has every number; docs/proposals/office-map.md draws it.
 */
import * as THREE from 'three';
import type { SpawnPoint } from '../../../core/contracts';
import type { Kit } from '../../kit/kit';
import type { MapSpec } from '../spec';
import { authorOutside } from './outside';
import { authorRooms } from './rooms';
import { BOUNDS, ENTRANCES, FLYERS, LV, PICKUPS_IN, PICKUPS_OUT, ROOMS, SKY, floorY } from './plan';
import { authorShell } from './shell';

export const OFFICE_STAGES = [
  { label: 'Pouring the slabs', run: (k: Kit, spec: MapSpec) => { start(spec); authorShell(k, spec); } },
  { label: 'Laying the plaza', run: authorOutside },
  { label: 'Furnishing the floors', run: authorRooms },
] as const;

function start(spec: MapSpec): void {
  spec.reactor = null;
  spec.plan = { fills: [], walls: [], blocks: [], decks: [], gates: [], doors: [] };
}

/** Smallest first: a point takes the first zone it is in. */
function zones(spec: MapSpec): void {
  for (const r of ROOMS) {
    const y0 = floorY(r.floor) - (r.floor === 'g' ? 1 : 0.2);
    spec.zone(r.id, r.name, r.x0, y0, r.z0, r.x1, (r.floor === 'g' ? LV.f2 : LV.roof) - 0.2, r.z1);
  }
  spec.zone('refinery-shaft', 'LIFT SHAFT', 2, -1, -18, 6, 12, -14);
  spec.zone('transit-bridge', 'SKYBRIDGE', 28, 3, -12, 40, 8, -8);
  spec.zone('transit-carpark', 'CAR PARK', 40, -1, -18, 70, LV.roof - 0.2, 20);
  spec.zone('ring-carparkroof', 'CAR PARK ROOF', 40, LV.roof - 0.2, -18, 70, SKY, 20);
  spec.zone('ring-roof', 'ROOF', -28, LV.roof - 0.2, -18, 28, SKY, 18);
  spec.zone('ring-yard', 'SERVICE YARD', BOUNDS.x0, -1, -18, -28, SKY, 18);
  spec.zone('ring-lane', 'LOADING LANE', 28, -1, -18, 40, SKY, 18);
  spec.zone('ring-alley', 'ALLEY', BOUNDS.x0, -1, BOUNDS.z0, BOUNDS.x1, SKY, -18);
  spec.zone('ring-street', 'STREET', BOUNDS.x0, -1, 46, BOUNDS.x1, SKY, BOUNDS.z1);
  spec.zone('ring-plaza', 'PLAZA', BOUNDS.x0, -1, 18, BOUNDS.x1, SKY, 46);
  spec.zone('ring-east', 'EAST LANE', 70, -1, -18, BOUNDS.x1, SKY, 20);
}

function spawns(spec: MapSpec): void {
  const ground = ([x, y, z]: readonly [number, number, number]): SpawnPoint =>
    ({ position: new THREE.Vector3(x, y + 0.1, z), zone: z > 18 ? 'ring-plaza' : z < -18 ? 'ring-alley' : x < 0 ? 'ring-yard' : 'transit-carpark', kind: 'ground' });
  spec.spawns = [
    ...ENTRANCES.map(ground),
    ...FLYERS.map(([x, y, z]) => ({ position: new THREE.Vector3(x, y, z), zone: 'ring-plaza', kind: 'air' as const })),
  ];
  for (const p of [...PICKUPS_OUT, ...PICKUPS_IN]) spec.pickup(p[0], p[1], p[2]);
  // In the lobby, looking out at the plaza through the doors.
  spec.playerSpawns.push({ position: new THREE.Vector3(3.5, 0.1, 4), yaw: Math.PI });
  spec.playerSpawns.push({ position: new THREE.Vector3(7, 0.1, 4), yaw: Math.PI });
}

function views(spec: MapSpec): void {
  const eye = 1.62;
  const look = (name: string, x: number, y: number, z: number, lx: number, ly: number, lz: number) => spec.view(name, x, y + eye, z, lx, ly, lz);
  spec.view('overview', 70, 60, 90, 5, 0, 0);
  spec.view('high', 0, 180, 10, 0, 0, 0);
  look('lobby', 10, 0, 14, -2, 1.5, -4);
  look('reception', 0, 0, -1, 8, 1, 14);
  look('corridor', -26, 0, -4, 12, 1.5, -4);
  look('server', -16, 0, -8, -26, 1, -16);
  look('copy', -6, 0, -8, -12, 1, -16);
  look('break', -16, 0, 16, -26, 1, -1);
  look('cubicles', 26, 0, 16, 16, 1, -16);
  look('waiting', -5, 0, 17, -13, 1, 9);
  look('stairs', -2.1, 0, -6.5, -2.1, 3, -16);
  look('gallery', 0.6, LV.f2, -6.5, 0.6, LV.f2 + 1, -16);
  look('open', -2, LV.f2, 16, 26, LV.f2 + 1, -16);
  look('open2', 26, LV.f2, -3, 16, LV.f2 + 1, -16);
  look('meeting', -5, LV.f2, 3, -13, LV.f2 + 1, 3);
  look('exec', -15, LV.f2, 7, -27, LV.f2 + 1, -1);
  look('director', -15, LV.f2, -7, -27, LV.f2 + 1, -17);
  look('it', 13, LV.f2, -7, 7, LV.f2 + 1, -17);
  look('bridge', 29, LV.f2, -10, 40, LV.f2 + 1, -10);
  look('roof', -4, LV.roof, 16, 24, LV.roof + 1, -14);
  look('roofTower', 20, LV.roof, 10, -16, LV.roof + 6, -8);
  look('plaza', 5, 0, 44, 5, 4, 18);
  look('street', -64, 0, 52, 40, 2, 50);
  look('yard', -64, 0, 16, -30, 3, -10);
  look('alley', -60, 0, -26, 60, 2, -26);
  look('escape', 0, 0, -28, 18, 5, -19);
  look('lane', 34, 0, 16, 34, 4, -16);
  look('park0', 42, 0, 18, 60, 1, -14);
  look('park1', 42, LV.f2, -16, 62, LV.f2 + 1, 16);
  look('parkRoof', 68, LV.roof, 18, 30, LV.roof + 2, -14);
  look('gap', 22, LV.roof, -15, 44, LV.roof + 1, -15);
}

export function authorOffice(_k: Kit, spec: MapSpec): void {
  zones(spec);
  spawns(spec);
  views(spec);
}

export const OFFICE_BOUNDS = BOUNDS;
export const OFFICE_HUB = new THREE.Vector3(5, 0, 10);
