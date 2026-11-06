/**
 * The two lessons the raid is built round: the Coolant Hall's gap and the cable gallery. Every lip here is a PARKOUR number. Everything
 * that reaches over a gap is paint or steel with no collider, and it hangs below the lip, so nothing can be stood on to shorten a jump.
 */
import { FACE } from '../../kit/geo';
import { machine, pipe, signPanel } from '../../kit/props';
import { signId } from '../../kit/signs';
import {
  CABLE_GALLERY, COOLANT, COOLANT_HALL, GALLERY, GALLERY_STAIR, HALL_TOP, KITCHEN_STAIR, rect, type Rgb, SKIN,
} from './plan';
import type { Site } from './site';

const COLD: Rgb = [0.14, 0.82, 0.9];

/** The bridge that went: two stumps, hanging off each lip, torn short of anything a boot could use. */
function stump(s: Site, x: number, lipZ: number, dir: number): void {
  const k = s.k, g = k.geo;
  for (const sx of [-1.6, 1.6]) {
    k.push(x + sx, -0.5, lipZ, dir > 0 ? 0 : Math.PI);
    g.use('steelDark').tint(0.74);
    g.box(0, 0, 1.3 + sx * 0.14, 0.09, 0.26, 1.3 + sx * 0.14, FACE.py | FACE.ny | FACE.px | FACE.nx | FACE.pz);
    g.tint(1);
    k.pop();
  }
  g.use('hazard').box(x, 0.012, lipZ - dir * 0.3, 2.6, 0.001, 0.3, FACE.py);
}

function coolantHall(s: Site): void {
  const { platform, x0, x1, north, south, nearLip, farLip, pit } = COOLANT;
  const k = s.k, g = k.geo;
  const r = COOLANT_HALL;
  s.plan.fills.push({ x0, z0: north, x1, z1: south, rgb: r.paint, label: '' });
  s.paintFloor('concreteDark', platform, 0, r.floorTint);
  s.paintFloor('concreteDark', rect(x0, north, GALLERY_STAIR.top, farLip), 0, r.floorTint);
  s.paintFloor('concreteDark', rect(GALLERY_STAIR.top, north, x1, GALLERY_STAIR.north), 0, r.floorTint);
  s.paintFloor('concreteDark', rect(GALLERY_STAIR.top, GALLERY_STAIR.south, x1, farLip), 0, r.floorTint);
  s.paintFloor('dirt', rect(x0, farLip, x1, south), pit, [0.26, 0.3, 0.34], 2.4);
  s.line(x0, farLip + 0.0, x1, farLip + 0.02, [0.86, 0.72, 0.16], 0.02);

  // The pit's walls are the slabs' own sides.
  const g2 = g.use('concrete').tint(0.5, 0.56, 0.62);
  g2.box((x0 + x1) / 2, pit / 2, farLip + 0.002, (x1 - x0) / 2, -pit / 2, 0.001, FACE.pz);
  g2.box((platform.x0 + platform.x1) / 2, pit / 2, nearLip - 0.002, (platform.x1 - platform.x0) / 2, -pit / 2, 0.001, FACE.nz);
  g2.box(platform.x0 - 0.002, pit / 2, (nearLip + south) / 2, 0.001, -pit / 2, 2, FACE.nx);
  g2.box(platform.x1 + 0.002, pit / 2, (nearLip + south) / 2, 0.001, -pit / 2, 2, FACE.px);
  g2.tint(1);

  // The way back up from the pit, onto the near platform: a fall costs a walk, never the mission.
  s.stairs(platform.x0 - 12, -48, pit, platform.x0, -48, 0, 4, 'concrete', true);
  // Cold light from below, so the gap reads as depth and the far side as a place to land.
  for (let x = x0 + 5; x < x1; x += 7.5) {
    g.use('emissiveCyan').box(x, pit + 0.04, -59, 2.6, 0.04, 6, FACE.py);
    k.light(x, pit + 1.6, -59, 'cyan', 18, 12);
  }
  for (const [x, z] of [[-50, -62], [-40, -55], [-22, -63], [-18, -54], [-32, -60]] as const) machine(k, x, pit, z, k.rand(0, 3), 3.4, 2.2, 2.2);
  pipe(k, [-56, pit + 3, -66, -14, pit + 3, -66], 0.5, 'steelDark', 6, 10);
  pipe(k, [-56, pit + 3.8, -53, -46, pit + 3.8, -53, -46, pit + 1, -53], 0.34, 'steel', 6, 8);
  // Three great pipes across the top of the room, far above any jump, to give the dark a ceiling.
  for (const [z, rad] of [[-74, 0.9], [-60, 1.1], [-52, 0.7]] as const) pipe(k, [x0, HALL_TOP - 1.6, z, x1, HALL_TOP - 1.6, z], rad, 'steelDark', 7, 12);
  for (let z = -76; z < -48; z += 9) k.ibeam(x0, HALL_TOP - 0.3, z, x1, HALL_TOP - 0.3, z, 0.6, 0.3);

  stump(s, -34, nearLip, -1);
  stump(s, -34, farLip, 1);
  s.fill(-34, 3.2, -47.4, 26, 12, 'white');
  s.bar(-34, 4.2, -44.5, 0, 3, 'white', 0, 0);
  s.fill(-34, 3.6, -73, 34, 16, 'white');
  s.fill(-48, 3, -73, 14, 12, 'cyan');
  s.lamp(-34, 3.6, -78 + SKIN, 0, 'white', 0);
  signPanel(k, -44.6, 2.5, -46 + SKIN + 0.05, 0, 5, 1.25, signId('COOLANT'), true);
  signPanel(k, -23.4, 2.5, -46 + SKIN + 0.05, 0, 4, 1, signId('GAP AHEAD'), true);
  s.words('CLEAR RIGHT', -22, 2.6, -78 + SKIN, 0.9, 1, COLD);
  s.spec.pickup(-50, 0.3, -74);
  // Marks the way down to the gallery: the only thing on this side that is lit from below.
  s.floorWords('ARROW', -28, 0, -69.9, -Math.PI / 2, 2.2, CABLE_GALLERY.paint);
  k.rail([GALLERY_STAIR.top, 0, GALLERY_STAIR.north, -14, 0, GALLERY_STAIR.north]);
  k.rail([GALLERY_STAIR.top, 0, GALLERY_STAIR.south, -14, 0, GALLERY_STAIR.south]);
  s.fill(-19, -1, -69.9, 12, 9, 'cyan');
  s.spec.jump(-34, 0, nearLip + 0.6, -34, 0, farLip - 0.6);
}

/** Everything under the far platform: the duct, the two decks, the trench between them and the stairs at each end. */
function gallery(s: Site): void {
  const { north, south, nearEnd, nearLip, farLip, farEnd, floor, ceil, trench } = GALLERY;
  const k = s.k, g = k.geo;
  const r = CABLE_GALLERY;
  s.plan.fills.push({ x0: nearEnd, z0: north, x1: farEnd, z1: south, rgb: r.paint, label: '' });
  // The north wall is one box from end to end: this is what gets run on, and it must have no seam, no skin and no detail that stands proud.
  s.mass('concrete', nearEnd - 1, trench - 1, north - 1, farEnd + 1, ceil, north, 0.86, 2);
  s.mass('concreteDark', nearEnd - 1, floor - 1, south, GALLERY_STAIR.foot, ceil, GALLERY_STAIR.north, 0.5, 2);
  s.mass('concreteDark', GALLERY_STAIR.landing, trench - 1, south, farEnd + 1, ceil, south + 1, 0.5, 2);
  s.mass('concreteDark', nearEnd - 1, floor - 1, north, nearEnd, ceil, south, 0.5, 2);
  s.mass('concreteDark', farEnd, floor - 1, north, farEnd + 1, ceil, KITCHEN_STAIR.north, 0.5, 2);
  s.mass('concreteDark', farEnd, floor - 1, KITCHEN_STAIR.south, farEnd + 1, ceil, south, 0.5, 2);
  // Decks stand on the trench floor, so their ends are its walls.
  s.mass('concreteDark', nearEnd, trench - 1, north, nearLip, floor, south, 0.74, 1.6);
  s.mass('concreteDark', farLip, trench - 1, north, farEnd, floor, south, 0.74, 1.6);
  s.mass('concreteDark', nearLip, trench - 1, north, farLip, trench, south, 0.5, 2);
  // The ceiling's underside, where the far platform and the kitchen stand over it.
  s.paintFloor('concreteDark', rect(nearEnd, north, farEnd, south), ceil - 0.002, [0.34, 0.36, 0.4], 2);
  g.use('concreteDark').tint(0.4).slab(0, ceil + 0.002, (north + south) / 2, farEnd, 0.001, (south - north) / 2, 2, FACE.ny);
  g.tint(1);

  // The invitation. A line of light the full length of the north wall, inside the wall's own face, with chevrons pointing along it.
  const wz = north + 0.002;
  g.use('emissiveCyan').box(0, floor + 1.55, wz, farEnd - 0.2, 0.05, 0.002, FACE.pz);
  g.use('emissiveCyan').box(0, floor + 1.2, wz, farEnd - 0.2, 0.012, 0.002, FACE.pz);
  for (let x = nearEnd + 3; x < farEnd - 2; x += 4) {
    k.push(x, 0, wz + 0.002, 0);
    s.words('CHEVRON', 0, floor + 2.25, 0, 0.72, 1, COLD);
    k.pop();
  }
  for (let x = -20; x <= 20; x += 8) k.light(x, floor + 1.6, north + 1.5, 'cyan', 12, 8);
  // The south wall stays dark, so the eye has one thing to do. A little red in the trench says how far down it goes.
  for (const x of [-7, 7]) k.light(x, trench + 1.4, -74.5, 'red', 10, 9);
  // Cable trays on the south wall, tight against it, which is all this room was ever for.
  for (const y of [floor + 2.5, floor + 2.1, floor + 1.7]) {
    g.use('rubber').tint(0.8).box(0, y, south - 0.02, 21, 0.03, 0.018, FACE.nz | FACE.py);
    g.tint(1);
  }
  s.line(nearLip - 0.6, north, nearLip, south, [0.86, 0.72, 0.16], floor + 0.012, 'hazard');
  s.line(farLip, north, farLip + 0.6, south, [0.86, 0.72, 0.16], floor + 0.012, 'hazard');
  s.paintFloor('concreteDark', rect(nearEnd, north, nearLip, south), floor, r.floorTint);
  s.paintFloor('concreteDark', rect(farLip, north, farEnd, south), floor, r.floorTint);
  s.words('GALLERY', -19, floor + 2.4, south - 0.002, 0.7, -1, r.paint);
  s.spec.pickup(20, floor + 0.3, -75);

  // Stairs down from the far platform. Their foot is side-on to the lip, so the deck's 13 m is the whole run-up.
  const { top, foot, landing, north: sn, south: ss } = GALLERY_STAIR;
  const zc = (sn + ss) / 2;
  s.stairs(top, zc, 0, foot, zc, floor, ss - sn);
  s.solid(foot, floor - 1, sn, landing, floor, ss);
  s.paintFloor('concreteDark', rect(foot, sn, landing, ss), floor, r.floorTint);
  s.mass('concreteDark', landing, floor - 1, sn, landing + 1, ceil, ss, 0.5, 2);
  s.mass('concreteDark', foot, floor - 1, ss, landing + 1, ceil, ss + 1, 0.5, 2);
  s.mass('concreteDark', top - 1, floor - 1, sn - 0.4, foot, 0, sn, 0.5, 2, FACE.pz);
  s.mass('concreteDark', top - 1, floor - 1, ss, foot, 0, ss + 0.4, 0.5, 2, FACE.nz);
  k.light((foot + landing) / 2, floor + 1.8, zc, 'cyan', 6, 6);

  // Back up out of the trench, onto the near deck only.
  s.stairs(3, -72.5, trench, nearLip, -72.5, floor, 3, 'concrete', true);

  // Up from the far deck into the kitchen.
  const ks = KITCHEN_STAIR, kz = (ks.north + ks.south) / 2;
  s.stairs(ks.foot, kz, floor, ks.top, kz, 0, ks.south - ks.north);
  s.mass('concreteDark', ks.foot, floor - 1, ks.north - 0.6, ks.top + 0.6, 0, ks.north, 0.5, 2, FACE.pz);
  s.mass('concreteDark', ks.foot, floor - 1, ks.south, ks.top + 0.6, 0, ks.south + 0.6, 0.5, 2, FACE.nz);
  k.light(ks.foot + 3, -1.4, kz, 'orange', 8, 8);
  s.spec.jump(nearLip - 0.6, floor, -74.5, farLip + 0.6, floor, -74.5);
}

export function authorDeep(s: Site): void {
  coolantHall(s);
  gallery(s);
}
