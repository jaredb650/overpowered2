/**
 * The fort of Outpost Defense, at `/?map=fort`: three rings of destructible walls with catwalks, a shop in each ring and an open field
 * round it. plan.ts has every number and all the data other systems read; docs/notes/fort.md draws it.
 */
import * as THREE from 'three';
import type { SpawnPoint } from '../../../core/contracts';
import type { Kit } from '../../kit/kit';
import type { MapSpec } from '../spec';
import { authorBase } from './base';
import { authorBuildings } from './buildings';
import { authorField } from './field';
import { EDGE, FORT_ROADS, FORT_SPAWNS, LEVEL, RINGS, ring, SKY } from './plan';
import { authorRings } from './rings';

export const FORT_STAGES = [
  { label: 'Clearing the field', run: (k: Kit, spec: MapSpec) => { start(spec); authorField(k, spec); } },
  { label: 'Raising the rings', run: authorRings },
  { label: 'Stocking the shops', run: authorBuildings },
  { label: 'Moving in', run: authorBase },
] as const;

function start(spec: MapSpec): void {
  spec.reactor = null;
  spec.plan = {
    // Outermost first, so each ring paints over the one outside it.
    fills: [...RINGS].sort((a, b) => b.half - a.half).map(r => ({
      x0: -r.half, z0: -r.half, x1: r.half, z1: r.half, rgb: [r.paint[0] * 0.35, r.paint[1] * 0.35, r.paint[2] * 0.35] as const, label: '',
    })),
    walls: [], blocks: [], decks: [], gates: [], doors: [],
  };
  spec.roads = FORT_ROADS.map(r => ({ id: r.id, points: r.points, width: r.width }));
}

function zones(spec: MapSpec): void {
  for (const r of [...RINGS].sort((a, b) => a.half - b.half)) spec.zone(`fort-${r.id}`, r.name, -r.half, -2, -r.half, r.half, SKY, r.half);
  spec.zone('fort-field', 'THE FIELD', -EDGE, -2, -EDGE, EDGE, SKY, EDGE);
}

function spawns(spec: MapSpec): void {
  const ground = (p: readonly number[]): SpawnPoint => ({ position: new THREE.Vector3(p[0], 0.1, p[2]), zone: 'fort-field', kind: 'ground' });
  spec.spawns = [
    ...FORT_SPAWNS.foot.map(s => ground(s.pos)),
    ...FORT_SPAWNS.air.map(p => ({ position: new THREE.Vector3(p[0], p[1], p[2]), zone: 'fort-field', kind: 'air' as const })),
  ];
}

function views(spec: MapSpec): void {
  const eye = 1.62;
  const O = ring('outer').half, M = ring('middle').half, D = LEVEL.deck + eye;
  spec.view('overview', 92, 88, 118, 0, -4, 4);
  spec.view('high', 0, 150, 40, 0, 0, 2);
  spec.view('core', 9, eye, 1, -8, 2, -6);
  spec.view('infirmary', -6.3, eye, 2.5, -6.3, 2, -8);
  spec.view('middle', 24, eye, 22, 0, 2, -24);
  spec.view('armoury', 3, eye, -15.5, 0, 2, -24);
  spec.view('outer', 40, eye, 42, -30, 2, 42);
  spec.view('barracks', -24, eye, 35, -28, 2, 45);
  // Inside each shop, from the door, at the counter and the keeper's place behind it.
  spec.view('barracksShop', -26.6, eye, 42.4, -28.4, 1.1, 47.6);
  spec.view('armouryShop', 1.4, eye, -22.4, -0.4, 1.1, -27.4);
  spec.view('infirmaryShop', -5, eye, -5.4, -6.6, 1.1, -9.6);
  spec.view('catwalk', -38, D, -O + 1.6, 20, LEVEL.deck + 1.2, -O + 1.6);
  spec.view('crenel', -17.3, D, -O + 1.05, -17.3, 0, -O - 40);
  spec.view('gun', 26, LEVEL.gun + eye + 0.6, -O + 2.4, 26, 1.5, -O - 30);
  spec.view('tower', -O + 1.7, LEVEL.tower + eye, -O + 1.7, -O - 40, 0, -O - 30);
  spec.view('towerOut', -O - 18, 9, -O - 12, -O + 3, 7, -O + 3);
  spec.view('gate', 0, eye, -O - 14, 0, 2.6, -O);
  spec.view('gateIn', 6, eye, -O + 12, 0, 3, -O);
  spec.view('middleGate', 14, eye, -M - 8, 14, 2.4, -M);
  spec.view('wallOut', 30, eye, -O - 22, 18, 4, -O);
  spec.view('motorPool', -32, 4, -32, -38, 1.5, -45);
  spec.view('waterTower', 46.6, LEVEL.tower + eye, -41, 10, 0, -96);
  spec.view('comms', -24, LEVEL.tower + eye, -17.5, -60, 0, -62);
  spec.view('hqRoof', 22, LEVEL.roof + eye, 36, 22, 2, 70);
  spec.view('field', -30, eye, -96, 0, 3, -O);
  spec.view('fieldWide', 70, 22, -110, 0, 0, -40);
  // Each side of the field from outside: the checkpoint, the village, the wire, the rise.
  spec.view('north', 14, 6, -118, 0, 3, -80);
  spec.view('east', 116, 12, -34, 86, 0, 0);
  spec.view('south', -34, 12, 116, 0, 0, 80);
  spec.view('west', -116, 14, -20, -88, 0, -50);
}

export function authorFort(_k: Kit, spec: MapSpec): void {
  zones(spec);
  spawns(spec);
  // In the core, looking at the infirmary's door across the pad.
  spec.playerSpawns.push({ position: new THREE.Vector3(-1, 0.1, 5), yaw: Math.atan2(5.3, 9.4) });
  spec.playerSpawns.push({ position: new THREE.Vector3(1.5, 0.1, -1.5), yaw: Math.PI / 4 });
  views(spec);
}

export const FORT_EXTENT = EDGE;
