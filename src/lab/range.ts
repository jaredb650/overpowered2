/**
 * The Test Range at /?map=range: one plain lit room with things to land on. Nothing here is dressed, because a body on
 * a bare floor is what is being looked at, and because the map has to boot in seconds. The floor is ruled at 1 m with
 * a heavier line every 5 m, so a throw can be read by eye. Local +Z is toward the player's spawn.
 */
import * as THREE from 'three';
import { FACE } from '../world/kit/geo';
import type { Kit } from '../world/kit/kit';
import type { MapSpec } from '../world/map/spec';
import { parkour } from './parkour';

export const RANGE = { halfX: 32, halfZ: 26, wall: 11, deck: 3, thick: 2 } as const;

/** High enough that nothing thrown leaves the room, without having to draw a wall that tall. */
const CONTAINMENT = 34;
const LINE_Y = 0.006;
const LINE = 0.03;
/** Half length of a metre tick. Full lines every metre shimmer into bands down the length of the room. */
const TICK = 0.14;

function rule(k: Kit): void {
  const { halfX: x, halfZ: z } = RANGE;
  const g = k.geo.use('paintWhite').tint(0.7);
  for (let i = -30; i <= 30; i += 5) g.box(i, LINE_Y, 0, LINE, 0.002, z, FACE.py);
  for (let i = -25; i <= 25; i += 5) g.box(0, LINE_Y, i, x, 0.002, LINE, FACE.py);
  for (let i = -x; i <= x; i++) {
    for (let j = -25; j <= 25; j += 5) if (i % 5 !== 0) g.box(i, LINE_Y, j, LINE / 2, 0.002, TICK, FACE.py);
  }
  for (let j = -z; j <= z; j++) {
    for (let i = -30; i <= 30; i += 5) if (j % 5 !== 0) g.box(i, LINE_Y, j, TICK, 0.002, LINE / 2, FACE.py);
  }
  g.tint(1);
}

function shell(k: Kit): void {
  const { halfX: x, halfZ: z, wall: h, thick: t } = RANGE;
  k.floor('concrete', -x - t, -z - t, x + t, z + t, 0, 1, 3);
  k.mass('concrete', -x - t, 0, -z - t, x + t, h, -z);
  k.mass('concrete', -x - t, 0, z, x + t, h, z + t);
  k.mass('concrete', -x - t, 0, -z, -x, h, z);
  k.mass('concrete', x, 0, -z, x + t, h, z);
  const top = (CONTAINMENT - h) / 2 + h, half = (CONTAINMENT - h) / 2;
  k.collide(0, top, -z - 1, x + t, half, 1, 'concrete', false);
  k.collide(0, top, z + 1, x + t, half, 1, 'concrete', false);
  k.collide(-x - 1, top, 0, 1, half, z, 'concrete', false);
  k.collide(x + 1, top, 0, 1, half, z, 'concrete', false);
}

/** A deck along the far wall, stairs up to it, and a run of steps that bodies can fall down. */
function ledges(k: Kit): void {
  const { halfX: x, halfZ: z, deck } = RANGE;
  const front = -z + 6;
  k.block('panel', -x, 0, -z, x, deck, front, 0.05);
  k.stairs(-16, front + 6, 0, -16, front, deck, 4, 'steel', false);
  k.ramp(16, front + 9, 0, 16, front, deck, 5, 'panel', 0.8, false);
  // Rising ledges, each about what a thrown body can clear or catch on.
  for (let i = 0; i < 4; i++) {
    const y = 0.45 * (i + 1);
    k.block('panel', -7 + i * 3, 0, front, -4 + i * 3, y, front + 4, 0.04);
  }
}

/** Things to be thrown against and over. */
function cover(k: Kit): void {
  k.block('panel', -24, 0, 4, -14, 1.1, 4.5, 0.04);
  k.block('panel', 14, 0, 4, 24, 2.4, 4.5, 0.04);
  k.block('panel', -26, 0, -9, -22, 1.2, -5, 0.05);
  k.block('panel', 22, 0, -9, 26, 0.6, -5, 0.05);
  k.block('panel', 24, 0.6, -9, 26, 1.8, -7, 0.05);
}

/**
 * The piercing gallery, behind the spawn: walls across a lane that runs along +X, thin to thick, with a bay behind each
 * to stand bodies in. Stand at `GALLERY.stand`, look down +X, and a round has to go through every wall before the bay it
 * is meant for. The lane is open on its -Z side, so the bays can be walked into.
 */
export const GALLERY = {
  z0: 19, z1: 25, height: 3.2,
  stand: [1.5, 22] as const,
  /** Near face along X, thickness, and what it is made of. A normal interior wall in the maps is 0.6 to 1 m, an outer one 1.6. */
  walls: [
    { x: 6, thick: 0.3, mat: 'panel' }, { x: 10, thick: 0.6, mat: 'panel' }, { x: 14, thick: 1, mat: 'concrete' },
    { x: 18.5, thick: 1.6, mat: 'concrete' }, { x: 24, thick: 0.1, mat: 'steel' },
  ] as const,
  /** Middle of the bay behind each wall. */
  bays: [8.3, 12.3, 16.8, 22, 27] as const,
} as const;

function gallery(k: Kit): void {
  const { z0, z1, height } = GALLERY;
  for (const w of GALLERY.walls) k.block(w.mat, w.x, 0, z0, w.x + w.thick, height, z1, 0.03);
  // A paint tick on the floor for every 10 cm of the wall behind it, so the thickness can be read from the stand.
  const g = k.geo.use('paintYellow');
  for (const w of GALLERY.walls) {
    const ticks = Math.round(w.thick * 10);
    for (let i = 0; i < ticks; i++) g.box(w.x - 0.5, LINE_Y, z0 + 0.3 + i * 0.3, 0.3, 0.002, 0.1, FACE.py);
  }
}

function lights(k: Kit): void {
  const { halfX: x, halfZ: z } = RANGE;
  for (let i = -2; i <= 2; i++) {
    for (let j = -1; j <= 2; j++) k.light(i * (x / 2.5), 8.4, j * (z / 2.2), 'white', 120, 24);
  }
}

export const RANGE_STAGES = [
  { label: 'Pouring the floor', run: (k: Kit, spec: MapSpec) => { spec.reactor = null; shell(k); rule(k); } },
  { label: 'Setting out the range', run: (k: Kit) => { ledges(k); cover(k); gallery(k); parkour(k); lights(k); } },
] as const;

export function authorRange(_k: Kit, spec: MapSpec): void {
  const { halfX: x, halfZ: z } = RANGE;
  spec.zone('range', 'Test Range', -x, -2, -z, x, CONTAINMENT, z);
  spec.playerSpawns.push({ position: new THREE.Vector3(0, 0.1, 15), yaw: 0 });
  // Nothing spawns by itself here, but the enemy system still asks where a lost body could come back.
  spec.spawns = [[-24, 12], [24, 12], [-24, -14], [24, -14]].map(([sx, sz]) => ({
    position: new THREE.Vector3(sx!, 0.1, sz!), zone: 'range', kind: 'ground' as const,
  }));
  spec.view('overview', 0, 16, 34, 0, 0, -6);
}
