/** Four long ramps from the rim of the Core up to the Ring Road corners. They are the map's main sliding lines. */
import type { Kit } from '../kit/kit';
import { FACE } from '../kit/geo';
import { signPanel } from '../kit/props';
import { signId } from '../kit/signs';
import type { MapSpec } from './spec';
import { DIAGONALS, VIADUCT, viaductY } from './layout';

const HW = VIADUCT.width / 2;
const SOLID_UNTIL = 100;

export function authorViaducts(k: Kit, spec: MapSpec): void {
  const g = k.geo;
  for (const [ux, uz] of DIAGONALS) {
    const px = -uz, pz = ux;
    const at = (r: number, lat: number): [number, number] => [ux * r + px * lat, uz * r + pz * lat];
    const r0 = VIADUCT.r0, r1 = VIADUCT.r1 + 2;
    const yEnd = viaductY(r1);
    k.ramp(ux * r0, uz * r0, 0, ux * r1, uz * r1, yEnd, VIADUCT.width, 'asphalt', 0.5, false);

    k.along(ux * r0, 0, uz * r0, ux * r1, yEnd, uz * r1, len => {
      // Box girder under the deck, and curbs with lit edges that draw a line straight to the reactor.
      g.use('concreteDark').slab(len / 2, -0.9, 0, len / 2, 0.4, HW - 1.2, 4, FACE.ny | FACE.pz | FACE.nz);
      for (const s of [1, -1]) {
        g.use('concrete').bevel(len / 2, 0.42, s * (HW + 0.25), len / 2, 0.42, 0.25, 0.08);
        g.use('emissiveCyan').box(len / 2, 0.86, s * (HW + 0.25), len / 2, 0.025, 0.06, FACE.py);
      }
      // Lane marks.
      for (let u = 4; u < len - 4; u += 9) {
        g.use('paintWhite').tint(0.7).quad(u, 0.02, 0.1, u + 4, 0.02, 0.1, u + 4, 0.02, -0.1, u, 0.02, -0.1);
        g.tint(1);
      }
    });

    // Low curb collider, gapped where catwalks join at mid-height.
    for (const lat of [HW + 0.25, -HW - 0.25]) {
      const [ax, az] = at(r0, lat), [bx, bz] = at(120, lat), [cx, cz] = at(138, lat), [dx, dz] = at(r1 - 6, lat);
      k.along(ax, viaductY(r0) + 0.42, az, bx, viaductY(120) + 0.42, bz, len => k.collide(len / 2, 0, 0, len / 2, 0.42, 0.25, 'concrete'));
      k.along(cx, viaductY(138) + 0.42, cz, dx, viaductY(r1 - 6) + 0.42, dz, len => k.collide(len / 2, 0, 0, len / 2, 0.42, 0.25, 'concrete'));
    }

    // Embankment: below 4 m clearance the deck sits on solid fill, retained by sloped walls to run along.
    const [ea, eb] = at(r0, HW + 0.5), [fa, fb] = at(SOLID_UNTIL, HW + 0.5), [ga, gb] = at(SOLID_UNTIL, -HW - 0.5), [ha, hb] = at(r0, -HW - 0.5);
    k.sideWall(fa, fb, viaductY(SOLID_UNTIL), ea, eb, 0, -0.05);
    k.sideWall(ha, hb, 0, ga, gb, viaductY(SOLID_UNTIL), -0.05);
    k.along(ux * r0, 0, uz * r0, ux * SOLID_UNTIL, viaductY(SOLID_UNTIL), uz * SOLID_UNTIL, len => {
      k.collide(len / 2, -3, 0, len / 2, 3, HW + 0.7, 'concrete');
    });
    // Abutment closing the end of the fill.
    const [ia, ib] = at(SOLID_UNTIL, 0);
    k.push(ia, 0, ib, Math.atan2(-uz, ux));
    k.block('concrete', -0.6, 0, -HW - 0.8, 1, viaductY(SOLID_UNTIL) - 0.45, HW + 0.8, 0.1);
    k.pop();

    // Piers, closer together toward the ring so the span feels loaded.
    for (let r = SOLID_UNTIL + 13; r < r1 - 4; r += 14) {
      const y = viaductY(r) - 1.3;
      for (const lat of [4.6, -4.6]) {
        const [x, z] = at(r, lat);
        k.column(x, z, 0, y, 1.5, 'concrete', Math.atan2(-uz, ux));
      }
      const [a, b] = at(r, 6.6), [c, d] = at(r, -6.6);
      k.beam(a, y + 0.3, b, c, y + 0.3, d, 0.65, 0.55, 'concreteDark');
    }

    // Lamps down both sides, alternating, each with a real light.
    let side = 1;
    for (let r = r0 + 16; r < r1 - 8; r += 30) {
      const lat = side * (HW + 0.3);
      const [x, z] = at(r, lat);
      const y = viaductY(r) + 0.8;
      k.push(x, y, z, Math.atan2(-uz, ux) + (side > 0 ? -Math.PI / 2 : Math.PI / 2));
      g.use('steelDark').cyl(0, 0, 0, 0, 6, 0, 0.09, 0.06, 6, false, false);
      k.beam(0, 6, 0, 2.4, 6.4, 0, 0.05, 0.05);
      g.use('steelDark').bevel(2.6, 6.36, 0, 0.5, 0.07, 0.16, 0.02);
      g.use('emissiveWhite').box(2.6, 6.27, 0, 0.42, 0.02, 0.1, FACE.ny);
      k.light(2.8, 5, 0, 'white', 44, 24);
      k.pop();
      side = -side;
    }

    // Overhead marker at the top of the climb.
    const [sx, sz] = at(VIADUCT.r1 - 22, 0);
    const y = viaductY(VIADUCT.r1 - 22);
    k.push(sx, y, sz, Math.atan2(-uz, ux) + Math.PI / 2);
    k.column(-HW - 1, 0, 0, 7, 0.5, 'steelDark');
    k.column(HW + 1, 0, 0, 7, 0.5, 'steelDark');
    k.truss(-HW - 1, 7, 0, HW + 1, 7, 0, 1.2, 1, 'steelDark', 0.07);
    signPanel(k, 0, 7, 0.62, 0, 7, 1.75, signId('RING ROAD'));
    k.pop();
  }
  spec.view('viaduct', 80, 8.5, -60, 118, 13, -118);
  spec.view('viaduct_down', 118, 15.7, -118, 0, 4, 0);
}
