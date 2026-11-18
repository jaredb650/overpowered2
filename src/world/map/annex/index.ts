/**
 * The Retraining Annex, a Bureau training site, at `/?contract=retraining`. One route north through every station of the tutorial
 * (docs/design/tutorial.md, campaign/missions/retraining.ts). Roofless like the Kill House, behind tall walls, so the capture drone
 * and the call-ins have sky everywhere. plan.ts has every number.
 */
import * as THREE from 'three';
import { FACE, type Mat } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import { signId, type SignName } from '../../kit/signs';
import type { MapSpec } from '../spec';
import {
  BALCONY, BLADE, BOUNDS, JET_TOWER, CHIMNEY, CHIMNEY_TOP, DASH_LAND, DASH_PIT, DECK, DOORS, DUCT, EXIT, GALLERY, HALL, INTAKE, LEDGE, MANTLE,
  PIT, QUIET, ROCKET_LEDGE, SHACKS, SHED, SLAM_PIT, SLOT, STAIRS_X, STAND, TOWN, VAULT, WALL, WALL_LAND, WALL_PIT, YARD,
} from './plan';

const T = 1;
const CONTAINMENT = 46;

/** A wall slab from (x0, z0) to (x1, z1), floor to `h`, with a doorway `w` wide and `dh` tall centred on `at` along its length. */
function wallWithDoor(k: Kit, mat: Mat, x0: number, z0: number, x1: number, z1: number, y0: number, h: number, at: number, w: number, dh: number): void {
  const alongX = x1 - x0 > z1 - z0;
  if (alongX) {
    k.mass(mat, x0, y0, z0, at - w / 2, y0 + h, z1);
    k.mass(mat, at + w / 2, y0, z0, x1, y0 + h, z1);
    k.mass(mat, at - w / 2, y0 + dh, z0, at + w / 2, y0 + h, z1);
  } else {
    k.mass(mat, x0, y0, z0, x1, y0 + h, at - w / 2);
    k.mass(mat, x0, y0, at + w / 2, x1, y0 + h, z1);
    k.mass(mat, x0, y0 + dh, at - w / 2, x1, y0 + h, at + w / 2);
  }
}

/** A sign from the atlas, facing local +z, `yaw` turning it (π faces it north, along -z). */
function sign(k: Kit, x: number, y: number, z: number, yaw: number, name: SignName, w = 2.4): void {
  k.push(x, y, z, yaw);
  const h = w / 4;
  k.geo.use('steelDark').box(0, 0, 0.02, w / 2 + 0.06, h / 2 + 0.06, 0.02);
  k.geo.use('signs').quadUV(-w / 2, -h / 2, 0.045, w / 2, h / 2, signId(name));
  k.pop();
}

/** A cyan stripe painted along a wall face at running height, to say "run here". */
function stripe(k: Kit, x: number, z0: number, z1: number, y: number): void {
  k.geo.use('emissiveCyan').box(x, y, (z0 + z1) / 2, 0.02, 0.06, (z1 - z0) / 2);
}

function containment(k: Kit): void {
  const { x0, x1, z0, z1 } = BOUNDS;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, hx = (x1 - x0) / 2, hz = (z1 - z0) / 2;
  k.containment(cx, CONTAINMENT / 2, z0 - 1, hx + 2, CONTAINMENT / 2, 1);
  k.containment(cx, CONTAINMENT / 2, z1 + 1, hx + 2, CONTAINMENT / 2, 1);
  k.containment(x0 - 1, CONTAINMENT / 2, cz, 1, CONTAINMENT / 2, hz + 2);
  k.containment(x1 + 1, CONTAINMENT / 2, cz, 1, CONTAINMENT / 2, hz + 2);
}

function intake(k: Kit): void {
  const { x0, x1, z0, z1, h } = INTAKE;
  k.floor('tile', x0 - T, z0, x1 + T, z1 + T, 0);
  k.mass('concrete', x0 - T, 0, z0, x0, h, z1);
  k.mass('concrete', x1, 0, z0, x1 + T, h, z1);
  // The south wall with the voluntary exit in it, and the dark corridor behind, ending in a white panel.
  wallWithDoor(k, 'concrete', x0 - T, z1, x1 + T, z1 + T, 0, h, 0, INTAKE.door * 2, 2.6);
  k.floor('concreteDark', EXIT.x0 - T, EXIT.z0 + T, EXIT.x1 + T, EXIT.z1 + T, 0);
  k.mass('concreteDark', EXIT.x0 - T, 0, EXIT.z0 + T, EXIT.x0, 3, EXIT.z1);
  k.mass('concreteDark', EXIT.x1, 0, EXIT.z0 + T, EXIT.x1 + T, 3, EXIT.z1);
  k.mass('concreteDark', EXIT.x0 - T, 0, EXIT.z1, EXIT.x1 + T, 3, EXIT.z1 + T);
  k.mass('concreteDark', EXIT.x0 - T, 3, EXIT.z0 + T, EXIT.x1 + T, 3.4, EXIT.z1 + T);
  k.geo.use('emissiveWhite').box(0, 1.4, EXIT.z1 - 0.03, 1.4, 1.3, 0.02);
  k.light(0, 2.4, EXIT.z1 - 1.2, 'white', 60, 6);
  sign(k, 0, 3.15, z1 - 0.02, Math.PI, 'EXIT · VOLUNTARY', 2.6);
  // The clone pods: a row of glass cases along the walls, the player's in the middle of the room.
  for (let i = 0; i < 4; i++) {
    const z = 3 + i * 3;
    for (const side of [-1, 1]) {
      const x = side * (x1 - 1.2);
      k.block('steelDark', x - 0.8, 0, z - 0.8, x + 0.8, 0.25, z + 0.8, 0.04, 'metal');
      k.deco('glass', x - 0.7, 0.25, z - 0.7, x + 0.7, 2.4, z + 0.7, 0.02);
      k.deco('steelDark', x - 0.8, 2.4, z - 0.8, x + 0.8, 2.6, z + 0.8, 0.04);
      k.geo.use('emissiveCyan').box(x, 0.27, z, 0.6, 0.01, 0.6);
    }
  }
  k.block('steelDark', -0.9, 0, 7.6, 0.9, 0.22, 9.4, 0.04, 'metal');
  k.geo.use('emissiveCyan').box(0, 0.24, 8.5, 0.7, 0.01, 0.7);
  sign(k, 0, 3.2, z0 + 1.02, Math.PI, 'RETRAINING', 2.6);
  k.light(0, 3.8, 7, 'cyan', 70, 12);
  k.light(0, 3.8, 2, 'white', 40, 10);
  // The way on, north into the hall.
  wallWithDoor(k, 'concrete', x0 - T, z0, x1 + T, z0 + 1, 0, h, DOORS.hall.x, DOORS.hall.w, 3.4);
}

function hall(k: Kit): void {
  const { x0, x1 } = HALL;
  const north = ROCKET_LEDGE.z0;
  k.mass('concrete', x0 - T, PIT, north - T, x0, WALL, 0);
  k.mass('concrete', x1, PIT, north - T, x1 + T, WALL, 0);
  // Floors, broken by the two pits.
  k.floor('concrete', x0, MANTLE.z0, x1, 0, 0);
  k.floor('concrete', x0, ROCKET_LEDGE.z1, x1, WALL_LAND.z0, 0);
  for (const pit of [DASH_PIT, WALL_PIT]) k.floor('rubber', x0, pit.z0, x1, pit.z1, PIT, 0.6, 3, 'concrete');
  // Pit walls between the decks and the pit floor.
  k.mass('concreteDark', x0, PIT, MANTLE.z0, x1, 0, MANTLE.z0 + 0.6);

  // The duct: a wall with a slot 1.2 m high under it. Crouch.
  k.mass('concrete', x0, DUCT.gap, DUCT.z0, x1, WALL, DUCT.z1);
  k.geo.use('hazard').box(0, DUCT.gap - 0.05, DUCT.z1 + 0.01, (x1 - x0) / 2, 0.05, 0.01);
  sign(k, 0, DUCT.gap + 1.2, DUCT.z1 + 0.02, 0, 'CROUCH');
  // Waist-high cover across the run-up: vault it.
  k.block('panel', x0, 0, VAULT.z0, x1, VAULT.h, VAULT.z1, 0.04, 'metal');
  // The slide slot: too long to walk through before the run-up's speed is gone.
  k.mass('concrete', x0, SLOT.gap, SLOT.z0, x1, WALL, SLOT.z1);
  k.geo.use('hazard').box(0, SLOT.gap - 0.05, SLOT.z1 + 0.01, (x1 - x0) / 2, 0.05, 0.01);
  sign(k, 0, SLOT.gap + 1.2, SLOT.z1 + 0.02, 0, 'SLIDE');

  // The mantle wall, whose top is the take-off over the dash pit.
  k.block('concrete', x0, 0, MANTLE.z0, x1, DECK, MANTLE.z1, 0.05);
  k.geo.use('emissiveCyan').box(0, DECK + 0.01, MANTLE.z0 + 0.2, (x1 - x0) / 2, 0.01, 0.06);
  sign(k, 0, DECK + 3, MANTLE.z1 + 0.02, 0, 'DASH');
  // Landing for the dash, take-off for the wall run.
  k.block('concrete', x0, PIT, DASH_LAND.z0, x1, DECK, DASH_LAND.z1, 0.05);
  k.geo.use('emissiveCyan').box(0, DECK + 0.01, DASH_LAND.z0 + 0.2, (x1 - x0) / 2, 0.01, 0.06);
  sign(k, 0, DECK + 3, DASH_PIT.z0 + 0.02, 0, 'WALL RUN');
  stripe(k, x1 - 0.01, WALL_PIT.z0, WALL_PIT.z1, DECK + 1.6);
  stripe(k, x0 + 0.01, WALL_PIT.z0, WALL_PIT.z1, DECK + 1.6);
  // The wall run lands here, at the foot of the chimney.
  k.block('concrete', x0, PIT, WALL_LAND.z0, x1, DECK, WALL_LAND.z1, 0.05);

  // The chimney: two blocks with a 2.4 m shaft between them, a back wall, and the slam deck on top.
  const { x0: cx0, x1: cx1, z0: cz0, z1: cz1, side, back } = CHIMNEY;
  k.mass('concrete', cx0 - side, DECK, cz0, cx0, CHIMNEY_TOP, cz1);
  k.mass('concrete', cx1, DECK, cz0, cx1 + side, CHIMNEY_TOP, cz1);
  k.mass('concrete', cx0 - side, 0, cz0 - back, cx1 + side, CHIMNEY_TOP, cz0);
  k.mass('concrete', cx0 - side, 0, cz0, cx1 + side, DECK, WALL_LAND.z0);
  // Nothing round the sides: the chimney is the only way on.
  k.mass('concrete', x0, 0, cz0 - back, cx0 - side, WALL, WALL_LAND.z0);
  k.mass('concrete', cx1 + side, 0, cz0 - back, x1, WALL, WALL_LAND.z0);
  sign(k, 0, DECK + 3.5, cz1 + 0.02, 0, 'CHIMNEY');
  k.geo.use('emissiveCyan').box(cx0 + 0.01, (DECK + CHIMNEY_TOP) / 2, (cz0 + cz1) / 2, 0.01, (CHIMNEY_TOP - DECK) / 2, 0.04, FACE.px);
  k.geo.use('emissiveCyan').box(cx1 - 0.01, (DECK + CHIMNEY_TOP) / 2, (cz0 + cz1) / 2, 0.01, (CHIMNEY_TOP - DECK) / 2, 0.04, FACE.nx);
  // The slam pit's ring, painted round where the subjects stand.
  const g = k.geo.use('paintYellow');
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    g.box(SLAM_PIT.cx + Math.cos(a) * 4, 0.006, SLAM_PIT.cz + Math.sin(a) * 4, 0.3, 0.002, 0.08, FACE.py);
  }
  sign(k, 0, CHIMNEY_TOP - 3, cz0 - back - 0.02, Math.PI, 'SLAM');

  // The rocket ledge, no-climb, and the door on top of it into the Gallery.
  k.noClimb(() => k.block('concrete', x0, 0, ROCKET_LEDGE.z0, x1, LEDGE, ROCKET_LEDGE.z1, 0.05));
  sign(k, 0, LEDGE + 1.6, ROCKET_LEDGE.z1 + 0.02, 0, 'ROCKET JUMP');
  const jt = JET_TOWER;
  k.noClimb(() => k.block('steelDark', jt.x0, LEDGE, jt.z0, jt.x1, LEDGE + jt.h, jt.z1, 0.05, 'metal'));
  k.geo.use('emissiveCyan').box((jt.x0 + jt.x1) / 2, LEDGE + jt.h + 0.01, jt.z1 - 0.2, (jt.x1 - jt.x0) / 2, 0.01, 0.06);
  sign(k, jt.x1 + 0.02, LEDGE + 2.2, (jt.z0 + jt.z1) / 2, Math.PI / 2, 'JUMP JET', 2.2);
  wallWithDoor(k, 'concrete', x0 - T, ROCKET_LEDGE.z0 - T, x1 + T, ROCKET_LEDGE.z0, LEDGE, WALL - LEDGE, DOORS.gallery.x, DOORS.gallery.w, 3.4);
  k.mass('concrete', x0 - T, 0, ROCKET_LEDGE.z0 - T, x1 + T, LEDGE, ROCKET_LEDGE.z0);

  // Between the obstacles, never inside one: a lamp buried in the duct or the slot lights nothing.
  for (const z of [-3, -16, -22, -38, -54, -66, -80, -92, -112, -122]) k.light(0, 8, z, 'white', 120, 22);
  k.light(0, CHIMNEY_TOP + 3, SLAM_PIT.cz, 'cyan', 90, 22);
}

function gallery(k: Kit): void {
  const { x0, x1, z0, z1, landing, foot } = GALLERY;
  k.floor('concrete', x0, z0, x1, z1, 0);
  k.mass('concrete', x0 - T, 0, z0, x0, 8, z1);
  k.mass('concrete', x1, 0, z0, x1 + T, 8, z1);
  // The landing at the ledge's height, and the stairs down.
  k.block('concrete', x0, 0, landing, x1, LEDGE, z1, 0.05);
  k.stairs(0, landing, LEDGE, 0, foot, 0, 4, 'steel', true);
  // The lane: a firing line, numbered posts, a low wall in front of the grenade trench.
  k.geo.use('paintWhite').box(0, 0.006, foot - 2, (x1 - x0) / 2 - 0.5, 0.002, 0.05, FACE.py);
  k.block('panel', -7, 0, -191, 7, 1.2, -190.4, 0.04, 'metal');
  // The supply pod's pad on the east side.
  k.geo.use('emissiveOrange').box(8, 0.006, -162, 1.6, 0.002, 0.04, FACE.py);
  k.geo.use('emissiveOrange').box(8, 0.006, -162, 0.04, 0.002, 1.6, FACE.py);
  sign(k, 0, 5, z1 + 0.02 - 4, 0, 'THE GALLERY');
  wallWithDoor(k, 'concrete', x0 - T, z0 - T, x1 + T, z0, 0, 8, DOORS.blade.x, DOORS.blade.w, 3.4);
  for (let z = -145; z > z0; z -= 16) k.light(0, 7, z, 'white', 100, 22);
}

function blade(k: Kit): void {
  const { x0, x1, z0, z1 } = BLADE;
  k.floor('tile', x0, z0, x1, z1, 0);
  k.mass('concrete', x0 - T, 0, z0, x0, 6, z1);
  k.mass('concrete', x1, 0, z0, x1 + T, 6, z1);
  wallWithDoor(k, 'concrete', x0 - T, z0 - T, x1 + T, z0, 0, 6, DOORS.quiet.x, DOORS.quiet.w, 3.4);
  sign(k, 0, 4.4, z0 + 0.02, 0, 'STANDARD ISSUE');
  k.light(0, 5, -213, 'white', 90, 18);
}

function quiet(k: Kit): void {
  const { x0, x1, z0, z1 } = QUIET;
  k.floor('concreteDark', x0, z0, x1, z1, 0);
  k.mass('concrete', x0 - T, 0, z0, x0, 6, z1);
  k.mass('concrete', x1, 0, z0, x1 + T, 6, z1);
  // Low rooms in the south half, each hiding a subject. Through walls the sonar shows him.
  for (const [ax, az, bx, bz] of [[-14, -236, -6, -236.6], [-6, -236.6, -6.6, -244], [6, -236.6, 14, -236], [6.6, -244, 6, -236.6], [-3, -246, 3, -246.6]] as const) {
    k.mass('concrete', Math.min(ax, bx), 0, Math.min(az, bz), Math.max(ax, bx), 4, Math.max(az, bz));
  }
  // The ring, painted on the floor of the north half.
  const g = k.geo.use('emissiveRed');
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    g.box(Math.cos(a) * 1.6, 0.006, -258 + Math.sin(a) * 1.6, 0.12, 0.002, 0.04, FACE.py);
  }
  wallWithDoor(k, 'concrete', x0 - T, z0 - T, x1 + T, z0, 0, 6, DOORS.yard.x, DOORS.yard.w, 3.6);
  k.light(-8, 5, -240, 'white', 70, 14);
  k.light(8, 5, -240, 'white', 70, 14);
  k.light(0, 5, -258, 'red', 80, 16);
}

function yard(k: Kit, spec: MapSpec): void {
  const { x0, x1, z0, z1 } = YARD;
  k.floor('dirt', x0, z0, x1, z1, 0);
  k.mass('concrete', x0 - T, 0, z0, x0, 6, z1);
  k.mass('concrete', x1, 0, z0, x1 + T, 6, z1);
  // The shed: walls with no roof, its door on the west.
  const { x0: sx0, x1: sx1, z0: sz0, z1: sz1, h } = SHED;
  k.mass('plywood', sx0, 0, sz0, sx1, h, sz0 + 0.3);
  k.mass('plywood', sx0, 0, sz1 - 0.3, sx1, h, sz1);
  k.mass('plywood', sx1 - 0.3, 0, sz0, sx1, h, sz1);
  k.mass('plywood', sx0, 0, sz0, sx0 + 0.3, h, sz0 + 3);
  k.mass('plywood', sx0, 0, sz1 - 3, sx0 + 0.3, h, sz1);
  // A sandbag line the first squad holds.
  k.block('dirt', -18, 0, -296, -4, 1.1, -295, 0.15);
  k.block('dirt', 4, 0, -290, 12, 1.1, -289, 0.15);
  k.block('concrete', -24, 0, -312, -18, 1.4, -310, 0.08);
  k.block('concrete', -2, 0, -306, 4, 1.2, -304.5, 0.08);
  spec.shack(-22, -284, 0.2, 'sheet');
  // The balcony block at the north end, with stairs up its south face.
  const { x0: bx0, x1: bx1, z0: bz0, z1: bz1 } = STAND;
  k.mass('concrete', bx0, 0, bz0, bx1, BALCONY, bz1);
  k.mass('concrete', x0 - T, 0, z0 - T, bx0, 6, z0);
  k.mass('concrete', bx1, 0, z0 - T, x1 + T, 6, z0);
  k.stairs(STAIRS_X, bz1 + 12, 0, STAIRS_X, bz1, BALCONY, 4, 'steel', true);
  // The parapet, and a back wall the blast throws the contractor into rather than off.
  // Glass, so the town below is in full view from the rail.
  k.block('steelDark', bx0, BALCONY, bz0, bx1, BALCONY + 0.12, bz0 + 0.3, 0.02, 'metal');
  k.deco('glass', bx0, BALCONY + 0.12, bz0 + 0.1, bx1, BALCONY + 1.1, bz0 + 0.2, 0.01);
  k.deco('steelDark', bx0, BALCONY + 1.1, bz0, bx1, BALCONY + 1.18, bz0 + 0.3, 0.02);
  k.collide(0, BALCONY + 0.6, bz0 + 0.15, (bx1 - bx0) / 2, 0.6, 0.15, 'glass');
  k.mass('concrete', bx0, BALCONY, bz1 - 0.5, STAIRS_X - 2.2, BALCONY + 4, bz1);
  k.mass('concrete', STAIRS_X + 2.2, BALCONY, bz1 - 0.5, bx1, BALCONY + 4, bz1);
  for (const x of [bx0, bx1 - 0.5]) k.mass('concrete', x, BALCONY, bz0, x + 0.5, BALCONY + 4, bz1);
  k.mast(-26, -276, 0, 12, 0.6, 'white', 140, 44);
  k.mast(26, -276, 0, 12, -0.6, 'white', 140, 44);
  k.mast(-26, -330, 0, 12, 2.4, 'white', 140, 44);
  k.mast(26, -330, 0, 12, -2.4, 'white', 140, 44);
  sign(k, 0, 4.6, z1 - 0.02, Math.PI, 'THE YARD', 2.6);
}

function town(k: Kit, spec: MapSpec): void {
  const { x0, x1, z0, z1 } = TOWN;
  k.floor('dirt', x0, z0, x1, STAND.z0, 0, 0.6, 4);
  k.mass('concrete', x0 - T, 0, z0 - T, x1 + T, 4, z0);
  k.mass('concrete', x0 - T, 0, z0, x0, 4, YARD.z0);
  k.mass('concrete', x1, 0, z0, x1 + T, 4, YARD.z0);
  k.mass('concrete', x0, 0, STAND.z0 - 0.5, STAND.x0, 4, YARD.z0);
  k.mass('concrete', STAND.x1, 0, STAND.z0 - 0.5, x1, 4, YARD.z0);
  SHACKS.forEach(([x, z, yaw], i) => spec.shack(x, z, yaw, i % 2 === 0 ? 'planks' : 'sheet'));
  // Floodlit, so the subjects are seen from the balcony.
  for (const [x, z, yaw] of [[-40, -350, 0.7], [40, -350, -0.7], [-40, -400, 2.4], [40, -400, -2.4], [0, -402, Math.PI]] as const) {
    k.mast(x, z, 0, 12, yaw, 'white', 140, 46);
  }
}

export const ANNEX_STAGES = [
  { label: 'Pouring the bays', run: (k: Kit, spec: MapSpec) => { spec.reactor = null; containment(k); intake(k); hall(k); } },
  { label: 'Ruling the lanes', run: (k: Kit) => { gallery(k); blade(k); quiet(k); } },
  { label: 'Raking the yard', run: (k: Kit, spec: MapSpec) => { yard(k, spec); town(k, spec); } },
] as const;

export function authorAnnex(_k: Kit, spec: MapSpec): void {
  spec.zone('annex-intake', 'INTAKE', INTAKE.x0, -1, INTAKE.z0, INTAKE.x1, 6, EXIT.z1);
  spec.zone('annex-hall', 'MOBILITY HALL', HALL.x0, PIT - 1, ROCKET_LEDGE.z0, HALL.x1, WALL, 0);
  spec.zone('annex-gallery', 'GALLERY', GALLERY.x0, -1, GALLERY.z0, GALLERY.x1, 10, GALLERY.z1);
  spec.zone('annex-blade', 'CUTTING ROOM', BLADE.x0, -1, BLADE.z0, BLADE.x1, 8, BLADE.z1);
  spec.zone('annex-quiet', 'QUIET ROOM', QUIET.x0, -1, QUIET.z0, QUIET.x1, 8, QUIET.z1);
  spec.zone('annex-shed', 'SHED', SHED.x0, -1, SHED.z0, SHED.x1, 6, SHED.z1);
  spec.zone('annex-yard', 'YARD', YARD.x0, -1, YARD.z0, YARD.x1, 20, YARD.z1);
  spec.zone('annex-balcony', 'BALCONY', STAND.x0, BALCONY - 1, STAND.z0, STAND.x1, 30, STAND.z1);
  spec.zone('annex-town', 'TOWN', TOWN.x0, -1, TOWN.z0, TOWN.x1, 30, TOWN.z1);
  spec.playerSpawns.push({ position: new THREE.Vector3(0, 0.32, 8.5), yaw: 0 });
  // The yard's gates, where a man let go walks out, and where a lost body comes back.
  spec.spawns = [[-27, -276], [27, -276], [-27, -326], [27, -326]].map(([x, z]) => ({
    position: new THREE.Vector3(x!, 0.1, z!), zone: 'annex-yard', kind: 'ground' as const,
  }));
  spec.view('overview', 40, 60, 10, 0, 0, -160);
  spec.view('intake', 0, 1.7, 12, 0, 1.6, 0);
  spec.view('hall', 0, 14, 4, 0, 2, -80);
  spec.view('yard', -26, 10, -276, 10, 0, -310);
  spec.view('town', 0, BALCONY + 1.7, -336, 0, 2, -392);
}

export const ANNEX_BOUNDS = BOUNDS;
export const ANNEX_HUB = new THREE.Vector3(0, 0, -300);
