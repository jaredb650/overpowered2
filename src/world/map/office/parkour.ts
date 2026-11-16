/**
 * The lines outside that only a player takes: the scaffold up the yard face, the window cleaner's gondolas on the plaza face and on the
 * tower, and the advertising sign over the gap to the car park, which is the wall to run. Sizes are the movement kit's
 * (docs/notes/player.md): a jump is 1.4 m, a jump and mantle reaches 3 m, a jump and wall climb about 5.5 m, a run 12.5 m/s.
 * office-map.test.ts plays each line with the real Player.
 */
import { FACE } from '../../kit/geo';
import { signId } from '../../kit/signs';
import type { Kit } from '../../kit/kit';
import type { MapSpec } from '../spec';
import { Builder } from './build';
import { B, LV, PARAPET, PARK, T_OUT, TOWER } from './plan';

/**
 * Three tiers up the yard face, staggered so each is reached from the one below. The first floor's tier is in two runs, each meeting a
 * broken bay. Plywood sheets close the ends and the first tier's outer face: the faces a jump climbs.
 *
 *   T1 2.2 on z -2..4: a jump and mantle from the yard, up its sheeted face
 *   T2 4.4 on z 4..16 (the bay into the second executive office) and z -16..-8 (the Director's bay)
 *   T3 6.6 on z -8..-2: from T1 a jump and climb up its end; from it a drop to T2's north run, or a climb to the parapet
 */
export const SCAFFOLD = {
  x0: -31.6, x1: B.x0 - T_OUT / 2 - 0.25,
  tiers: [
    { y: 2.2, spans: [[-2, 4]] },
    { y: LV.f2, spans: [[4, 16], [-16, -8]] },
    { y: 6.6, spans: [[-8, -2]] },
  ],
  /** Sheets: z, from, to. The tier's end faces down to the tier or ground below. */
  sheets: [[-2, 0, 2.2], [4, 0, 4.4], [-2, 2.2, 6.6], [-8, 4.4, 6.6]],
} as const;
/** The gondola under the plaza face's broken window: a step up off the canopy, a window in, a climb to the parapet. */
export const GONDOLA = { x0: 13, x1: 22.5, z0: B.z1 + T_OUT / 2 + 0.15, z1: B.z1 + T_OUT / 2 + 1.45, y: 5.35 } as const;
/** The gondola on the tower's face, over the roof's AC unit: a perch over the roof and the plaza. */
export const PERCH = { x0: -20, x1: -14, z0: TOWER.z1 + 0.3, z1: TOWER.z1 + 1.5, y: 13 } as const;
/** The sign across the gap between the roof and the car park's roof: its south face is the wall run. */
export const SIGN = { x0: B.x1 - 0.6, x1: PARK.x0 + 0.6, z: -13.6, t: 0.3, y0: 8.6, y1: 15 } as const;

function scaffold(b: Builder): void {
  const g = b.g, S = SCAFFOLD, w = S.x1 - S.x0;
  for (const tier of S.tiers) for (const [z0, z1] of tier.spans) {
    // Planks on a deck you can stand on; a toe board on the outer edge.
    b.solid(S.x0, tier.y - 0.08, z0, S.x1, tier.y, z1, 'metal', false);
    g.use('plywood').tint(0.66, 0.56, 0.42);
    for (let x = S.x0 + 0.15; x < S.x1; x += 0.3) g.box(x, tier.y - 0.02, (z0 + z1) / 2, 0.13, 0.02, (z1 - z0) / 2, FACE.py | FACE.ny | FACE.px | FACE.nx);
    g.use('steel').tint(0.62, 0.62, 0.6).box(S.x0 + 0.03, tier.y + 0.08, (z0 + z1) / 2, 0.02, 0.08, (z1 - z0) / 2, FACE.sides);
    g.tint(1);
    b.rail([S.x0 + 0.05, tier.y, z0, S.x0 + 0.05, tier.y, z1]);
    b.plan.decks.push({ x0: S.x0, z0, x1: S.x1, z1 });
  }
  // Standards from the ground to above the top tier, ledgers between them, a brace in every other bay. Tubes, no colliders.
  const top = 7.8;
  const g2 = g.use('steel').tint(0.66, 0.66, 0.62);
  for (let z = -16; z <= 16; z += 2) {
    const used = S.tiers.some(t => t.spans.some(([a, c]) => z >= a - 0.01 && z <= c + 0.01));
    if (!used) continue;
    for (const x of [S.x0 + 0.05, S.x1 - 0.05]) g2.cyl(x, 0, z, x, top, z, 0.025, 0.025, 6, false, false);
    for (const t of S.tiers) g2.cyl(S.x0 + 0.05, t.y - 0.1, z, S.x1 - 0.05, t.y - 0.1, z, 0.022, 0.022, 6, false, false);
    if (Math.round(z / 2) % 2 === 0) g2.cyl(S.x0 + 0.05, 0.2, z, S.x0 + 0.05, top - 0.4, z + 2, 0.02, 0.02, 6, false, false);
    g2.box(S.x0 + 0.05, 0.03, z, 0.12, 0.03, 0.12, FACE.py | FACE.sides);
  }
  g.tint(1);
  // Plywood: across each sheeted end, and down the first tier's outer face.
  const ply = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
    b.solid(x0, y0, z0, x1, y1, z1, 'concrete', false);
    g.use('plywood').tint(0.7, 0.6, 0.46).box((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2);
    g.tint(1);
  };
  for (const [z, y0, y1] of S.sheets) ply(S.x0, y0, z - 0.03, S.x1, y1, z + 0.03);
  ply(S.x0 - 0.03, 0, -2, S.x0 + 0.03, 2.2, 4);
  g.use('hazard').tint(1).box(S.x0 - 0.035, 1.1, 1, 0.005, 0.15, 2.9, FACE.nx);
  g.tint(1);
  void w;
}

function gondola(b: Builder, G: { x0: number; x1: number; z0: number; z1: number; y: number }, hangTo: number): void {
  const g = b.g;
  b.solid(G.x0, G.y - 0.12, G.z0, G.x1, G.y, G.z1, 'metal', false);
  g.use('grate').tint(0.7).box((G.x0 + G.x1) / 2, G.y - 0.06, (G.z0 + G.z1) / 2, (G.x1 - G.x0) / 2, 0.06, (G.z1 - G.z0) / 2);
  g.use('paintWhite').tint(0.86, 0.6, 0.12);
  // Kick plates and a rail round the outside, no colliders: nothing on the way in may stop a jump.
  g.box((G.x0 + G.x1) / 2, G.y + 0.15, G.z1 - 0.03, (G.x1 - G.x0) / 2, 0.15, 0.03, FACE.sides | FACE.py);
  for (const x of [G.x0 + 0.03, G.x1 - 0.03]) g.box(x, G.y + 0.15, (G.z0 + G.z1) / 2, 0.03, 0.15, (G.z1 - G.z0) / 2, FACE.sides | FACE.py);
  g.tint(1);
  b.rail([G.x0, G.y, G.z1, G.x1, G.y, G.z1]);
  // Hung on four cables from davits above.
  g.use('steelDark').tint(0.4);
  for (const x of [G.x0 + 0.3, G.x1 - 0.3]) for (const z of [G.z0 + 0.1, G.z1 - 0.1]) g.cyl(x, G.y, z, x, hangTo, z, 0.012, 0.012, 4, false, false);
  for (const x of [G.x0 + 0.3, G.x1 - 0.3]) b.k.beam(x, hangTo, G.z0 - 1.2, x, hangTo, G.z1 + 0.2, 0.06, 0.08, 'steelDark');
  g.use('emissiveOrange').tint(0.5).box(G.x0 + 0.2, G.y + 0.32, G.z1 - 0.07, 0.06, 0.03, 0.01, FACE.pz);
  g.tint(1);
}

/** A billboard across the gap: a lit face of the Bureau's, on a frame, posts on each roof. */
function sign(b: Builder): void {
  const S = SIGN, g = b.g, cx = (S.x0 + S.x1) / 2, w = S.x1 - S.x0;
  // One solid face: a wall run must not catch on a seam.
  b.solid(S.x0, S.y0, S.z - S.t / 2, S.x1, S.y1, S.z + S.t / 2, 'metal', false);
  g.use('steelDark').tint(0.3, 0.32, 0.36).bevel(cx, (S.y0 + S.y1) / 2, S.z, w / 2, (S.y1 - S.y0) / 2, S.t / 2, 0.04);
  g.use('signs').tint(1);
  const sh = Math.min(S.y1 - S.y0 - 0.6, w / 4);
  b.k.push(cx, (S.y0 + S.y1) / 2 + 0.3, S.z + S.t / 2 + 0.01, 0);
  g.quadUV(-sh * 2, -sh / 2, 0, sh * 2, sh / 2, signId('SMILE: YOU ARE BEING AUDITED'));
  b.k.pop();
  b.k.push(cx, (S.y0 + S.y1) / 2 + 0.3, S.z - S.t / 2 - 0.01, Math.PI);
  g.quadUV(-sh * 2, -sh / 2, 0, sh * 2, sh / 2, signId('COMPLIANCE IS MANDATORY'));
  b.k.pop();
  g.use('emissiveWhite').tint(0.5);
  g.box(cx, S.y1 + 0.05, S.z + 0.4, w / 2 - 0.3, 0.03, 0.06, FACE.ny);
  g.box(cx, S.y1 + 0.05, S.z - 0.4, w / 2 - 0.3, 0.03, 0.06, FACE.ny);
  g.tint(1);
  b.k.light(cx, S.y1 - 1, S.z + 3, 0xdfe8ff, 26, 14);
}

export function authorParkour(k: Kit, spec: MapSpec): void {
  const b = new Builder(k, spec);
  scaffold(b);
  gondola(b, GONDOLA, PARAPET + 0.6);
  gondola(b, PERCH, PERCH.y + 6);
  sign(b);
}
