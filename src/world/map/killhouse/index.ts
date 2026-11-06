/** The Kill House: a roofless shoot house in a walled yard. See plan.ts for the layout. */
import * as THREE from 'three';
import type { SpawnPoint } from '../../../core/contracts';
import type { Kit } from '../../kit/kit';
import { authorCatwalks } from './catwalks';
import { authorRooms } from './rooms';
import { authorShell } from './shell';
import { CORRIDOR, COURT, KH, ROOMS, rot, SPACES, YARD_IN, YARD_OUT } from './plan';
import type { MapSpec } from '../spec';

export const KILLHOUSE_STAGES = [
  { label: 'Pouring the slab', run: (k: Kit, spec: MapSpec) => { startPlan(spec); authorShell(k, spec); } },
  { label: 'Hanging the catwalks', run: (k: Kit, spec: MapSpec) => authorCatwalks(k, spec.plan!) },
  { label: 'Dressing the rooms', run: authorRooms },
] as const;

function startPlan(spec: MapSpec): void {
  spec.reactor = null;
  spec.plan = {
    fills: [CORRIDOR, COURT, ...ROOMS].map(s => ({ x0: s.x0, z0: s.z0, x1: s.x1, z1: s.z1, rgb: s.paint, label: s.n ? String(s.n) : '' })),
    walls: [], blocks: [], decks: [], gates: [], doors: [],
  };
}

const MID = (YARD_IN + YARD_OUT) / 2;

/** Over-the-wall drops land in the yard between the T-walls, where only someone already in that stretch can see them. */
function yardDrops(): SpawnPoint[] {
  return [0, 1, 2, 3].flatMap(i => [-22, 22].map(u => {
    const [x, z] = rot(i, u, -MID);
    return { position: new THREE.Vector3(x, 0.1, z), zone: 'ring-yard', kind: 'ground' as const };
  }));
}

function flyers(): SpawnPoint[] {
  return [[0, -MID], [MID, 0], [0, MID], [-MID, 0], [28, 28], [-28, -28]].map(([x, z]) => ({
    position: new THREE.Vector3(x!, 13, z!), zone: 'ring-yard', kind: 'air' as const,
  }));
}

export function authorKillHouse(_k: Kit, spec: MapSpec): void {
  for (const s of SPACES) spec.zone(s.id, s.name, s.x0, -2, s.z0, s.x1, 40, s.z1);
  // Looking down the court at an open door, not at the tower's blank base.
  spec.playerSpawns.push({ position: new THREE.Vector3(6.6, 0.1, 3), yaw: Math.PI / 2 });
  spec.playerSpawns.push({ position: new THREE.Vector3(-6.6, 0.1, -3), yaw: -Math.PI / 2 });
  spec.spawns = [...yardDrops(), ...flyers()];
  const eye = 1.62;
  const look = (name: string, i: number, x: number, z: number, lx: number, lz: number, y = eye, ly = eye) => {
    const [px, pz] = rot(i, x, z), [qx, qz] = rot(i, lx, lz);
    spec.view(name, px, y, pz, qx, ly, qz);
  };
  ROOMS.forEach((r, n) => {
    const i = n >> 1;
    if (n % 2 === 0) look(`room${r.n}`, i, -17, -17, -24, -24);
    else look(`room${r.n}`, i, -13, -16.6, 12, -19);
  });
  look('court', 0, 6.6, 3, -8, 3);
  look('court2', 0, -7, 7, 7, -7);
  look('ring', 0, -11.75, -11.75, 11, -11.75);
  look('yard', 0, -11, -33, 12, -33);
  look('gate', 0, 7, -32.6, 0, -36);
  look('port', 0, 25.6, -28, 31, -30);
  look('catwalk', 0, -14.5, -14.5, 14.5, -14.5, KH.deck + eye, KH.deck + 0.5);
  look('ramp', 0, 13.6, -23.5, -3, -23.5);
  spec.view('overview', 40, 42, 50, 0, -2, 0);
}

export const KILLHOUSE_EXTENT = YARD_OUT + KH.gateDepth + 2;
