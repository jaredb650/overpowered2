/**
 * The observation level: one steel ring along the ring walls, reached by four ramps in the long halls.
 * Decks sit straight on the walls. Rails have no colliders, so stepping off is always an exit, never a trap.
 */
import { FACE } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import type { MapPlan } from '../spec';
import { FACES, KH, RAMP, rotRect } from './plan';

const HALF = KH.deckW / 2;
const Y = KH.deck;

/** Solid wedge on the shell. Sloped top, vertical sides, nothing under it to crawl into. */
function ramp(k: Kit, plan: MapPlan, turn: number): void {
  const g = k.geo;
  const { footX, topX, z, pierX } = RAMP;
  const w = KH.deckW, run = footX - topX, out = FACES.out;
  // A deep tilted box is a wedge once the floor has swallowed its underside.
  k.along(footX, 0, z, topX, Y, z, len => {
    k.collide(len / 2, -4, 0, len / 2, 4, w / 2, 'concrete');
    g.use('concrete').tint(0.9, 0.92, 0.96);
    g.gridStep(0, 0.004, w / 2, len, 0, 0, 0, 0, -w, 1.2);
    g.tint(1).use('steelDark');
    for (let u = 1.2; u < len - 0.4; u += 1.2) g.box(u, 0.012, 0, 0.05, 0.006, w / 2 - 0.5, FACE.py);
    g.use('hazard');
    for (const s of [1, -1]) g.box(len / 2, 0.012, s * (w / 2 - 0.16), len / 2, 0.006, 0.16, FACE.py);
  });
  // Only the open side shows. It is a run of quads with a triangle at the foot, because a quad with two corners on
  // one point gets a zero normal, and that is a NaN pixel in the renderer.
  const n = Math.ceil(run / 1.6);
  const zo = z + w / 2;
  for (let i = 0; i < n; i++) {
    const x0 = footX - (i / n) * run, x1 = footX - ((i + 1) / n) * run;
    const h0 = (i / n) * Y, h1 = ((i + 1) / n) * Y;
    const s = 0.84 + k.rng() * 0.2;
    g.use('concrete').tint(s, s, s * 1.02);
    if (i === 0) g.tri(x0, 0, zo, x1, h1, zo, x1, 0, zo);
    else g.quad(x1, 0, zo, x0, 0, zo, x0, h0, zo, x1, h1, zo);
  }
  g.tint(1);
  k.mass('concrete', pierX, 0, -out, topX, Y, -out + w, 1.6);
  plan.blocks.push(rotRect(turn, pierX, -out, footX, -out + w));
  k.rail([footX, 0, zo, topX, Y, zo, pierX, Y, zo]);
}

/** One side of the ring, in the north frame, with the bridge from its pier. It includes its west corner, so four sides close it. */
function side(k: Kit, plan: MapPlan, turn: number): void {
  const R = KH.ring, x = RAMP.bridgeX, inner = -R + HALF, outer = -R - HALF, pierEdge = -FACES.out + KH.deckW;
  k.catwalk(-R - HALF, -R, R - HALF, -R, Y, KH.deckW, 'none');
  k.rail([-R + HALF, Y, inner, R - HALF, Y, inner]);
  k.rail([-R - HALF, Y, outer, x - HALF, Y, outer]);
  k.rail([x + HALF, Y, outer, R + HALF, Y, outer]);
  k.catwalk(x, pierEdge, x, outer, Y, KH.deckW, 'both');
  plan.decks.push(rotRect(turn, -R - HALF, outer, R + HALF, inner));
  plan.decks.push(rotRect(turn, x - HALF, pierEdge, x + HALF, outer));
}

export function authorCatwalks(k: Kit, plan: MapPlan): void {
  for (let i = 0; i < 4; i++) {
    k.push(0, 0, 0, (-i * Math.PI) / 2);
    side(k, plan, i);
    ramp(k, plan, i);
    k.pop();
  }
}
