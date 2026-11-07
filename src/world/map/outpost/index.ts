/** The Outpost: the mission's map. See plan.ts for the layout and docs/campaign/MISSION.md for what it is for. */
import * as THREE from 'three';
import type { SpawnPoint } from '../../../core/contracts';
import type { Kit } from '../../kit/kit';
import type { MapSpec } from '../spec';
import { authorApron } from './apron';
import { authorCitadel } from './citadel';
import { authorDeep } from './deep';
import { COOLANT, EDGE, GALLERY, LEVEL, ROADS, ROOMS, SITE, WALL, YARD } from './plan';
import { authorRooms } from './rooms';
import { Site } from './site';
import { authorStack } from './stack';
import { authorWall } from './wall';

const site = (k: Kit, spec: MapSpec): Site => new Site(k, spec);

export const OUTPOST_STAGES = [
  { label: 'Grading the apron', run: (k: Kit, spec: MapSpec) => { start(spec); authorApron(site(k, spec)); } },
  { label: 'Raising the wall', run: (k: Kit, spec: MapSpec) => authorWall(site(k, spec)) },
  { label: 'Pouring the citadel', run: (k: Kit, spec: MapSpec) => { const s = site(k, spec); authorCitadel(s); authorRooms(s); } },
  { label: 'Flooding the pit', run: (k: Kit, spec: MapSpec) => authorDeep(site(k, spec)) },
  { label: 'Climbing the Stack', run: (k: Kit, spec: MapSpec) => authorStack(site(k, spec)) },
] as const;

function start(spec: MapSpec): void {
  spec.reactor = null;
  spec.plan = { fills: [], walls: [], blocks: [], decks: [], gates: [], doors: [] };
  spec.roads = ROADS.map(r => ({ id: r.id, points: r.points.map(p => [p[0], p[1]] as const), width: r.width }));
}

function zones(spec: MapSpec): void {
  for (const r of ROOMS) spec.zone(r.id, r.name, r.x0, r.y - 1, r.z0, r.x1, r.ceil + 1, r.z1);
  spec.zone('ring-yard', 'GATE YARD', -YARD.x, -1, YARD.north, YARD.x, 30, WALL.south);
  spec.zone('ring-roof', 'COMMS ROOF', -24, 13, -80, 24, 40, -26);
  spec.zone('ring-apron', 'THE APRON', -EDGE, -8, -EDGE, EDGE, 60, EDGE);
}

/** Authored, because a body cannot come in over a wall a player is kept out by. */
function entrances(spec: MapSpec): void {
  for (const [x, z] of [[100, 34], [-100, 34], [0, 6], [-20, 0], [20, 0]] as const) spec.gate('ring-apron', x, 0.1, z);
  const ground = (x: number, z: number, y = 0.1): SpawnPoint => ({ position: new THREE.Vector3(x, y, z), zone: 'ring-apron', kind: 'ground' });
  const air = (x: number, z: number): SpawnPoint => ({ position: new THREE.Vector3(x, 30, z), zone: 'ring-apron', kind: 'air' });
  spec.spawns = [
    ground(-96, 80), ground(96, 92), ground(-70, 96), ground(0, 100), ground(60, 96), ground(90, 20), ground(-90, 20),
    air(0, 60), air(-70, 40), air(70, 40), air(0, 100),
  ];
}

function views(spec: MapSpec): void {
  const eye = 1.62;
  const look = (name: string, x: number, y: number, z: number, lx: number, ly: number, lz: number) => spec.view(name, x, y + eye, z, lx, ly, lz);
  look('lz', -32, -3, 92, -32, -1, 70);
  look('lzRamp', -28, -3, 86, -8, 0, 86);
  look('rim', -32, 0, 72, 0, 4, 12);
  look('lanes', 0, 0, 66, 0, 4, 12);
  look('road', 60, 0, 34, -30, 2, 34);
  look('gate', 0, 0, 30, 0, 3, 12);
  look('guardhouse', 10, 0, 34, 24, 1.6, 24);
  look('guardIn', 19, 0, 24, 29, 1.2, 24);
  look('pump', -48, 0, 62, -60, 2, 50);
  look('fuel', 44, 0, 36, 60, 2, 50);
  look('wreck', 62, 0, 68, 84, 3, 84);
  look('wreckDeck', 80, 4.2, 83, 92, 4, 85);
  look('tower', 40, 9, 12, 40, 0, 70);
  look('wallWalk', 18, 5, 11.8, 30, 6, 11.8);
  look('yard', 0, 0, 9, 0, 2.4, -12);
  look('yardNest', -22, 0, 4, -14, 1, -6);
  look('sally', 0, 0, -16, 0, 2, -26);
  look('southCorridor', -12, 0, -17.5, -56, 1.2, -17.5);
  look('bunk1', -17, 0, -21, -17, 1.2, -39);
  look('bunk2', -28, 0, -21, -28, 1.2, -39);
  look('bunk3', -40, 0, -21, -40, 1.2, -39);
  look('bunk4', -50, 0, -21, -50, 1.2, -39);
  look('northCorridor', -54, 0, -42.5, -12, 1.2, -42.5);
  look('coolantDoor', -34, 0, -43, -34, 0, -70);
  look('coolant', -34, 0, -47, -34, 0, -72);
  look('coolantFar', -34, 0, -72, -34, 0, -46);
  look('coolantStairs', -38, 0, -70, -18, -2, -70);
  look('coolantPit', -50, COOLANT.pit, -60, -30, -3, -56);
  look('galleryNear', -22, GALLERY.floor, -74.5, 11, GALLERY.floor + 1, -74.5);
  look('galleryLip', -11.6, GALLERY.floor, -73, 11, GALLERY.floor, -77);
  look('galleryFar', 11.6, GALLERY.floor, -74.5, -11, GALLERY.floor + 1, -74.5);
  look('trench', -6, GALLERY.trench, -75, 8, GALLERY.trench + 3, -75);
  look('kitchen', 35, 0, -74.5, 52, 1, -74.5);
  look('mess', 24, 0, -68, 50, 1, -48);
  look('messHatch', 36, 0, -72, 36, 1, -50);
  look('eastCorridor', 14, 0, -42.5, 54, 1.2, -42.5);
  look('armoury', 44, 0, -40, 44, 1, -33);
  look('guardRoom', 14, 0, -36.5, 28, 1, -36.5);
  look('plate', 15, 0, -24, 56, 1.4, -24);
  look('plateEnd', 54, 0, -24, 12, 1.4, -24);
  look('stackFloor', 6, 0, -32, -4, 6, -56);
  look('stackBase', 0, LEVEL.gallery, -46, 0, 8, -60);
  look('stackMid', -6, LEVEL.upper, -36, 6, 8, -60);
  look('stackTop', 0, LEVEL.command, -40, 0, 11, -72);
  look('shaft', 7.5, 0, -61, 7.5, 9, -60);
  look('war', 12, LEVEL.command, -68, -10, 11, -76);
  look('warGlass', 0, LEVEL.command, -62, 0, 11, -72);
  look('roofStairs', -13.7, LEVEL.command, -77, -13.7, 13, -67);
  look('roof', 0, LEVEL.roof, -70, 0, 6, 30);
  look('roofSouth', 0, LEVEL.roof, -27.2, 0, 0, 40);
  spec.view('overview', 150, 90, 160, 0, 0, -10);
  spec.view('north', 0, 60, -170, 0, 6, -30);
  spec.view('west', -170, 50, -30, 0, 6, -30);
  spec.view('fly1', -90, 36, 58, 0, 6, 12);
  spec.view('flyEast', 92, 34, 40, 0, 4, -20);
}

export function authorOutpost(_k: Kit, spec: MapSpec): void {
  zones(spec);
  entrances(spec);
  spec.playerSpawns.push({ position: new THREE.Vector3(-32, -2.9, 86), yaw: 0 });
  views(spec);
}

export const OUTPOST_EXTENT = EDGE;
export { SITE };
