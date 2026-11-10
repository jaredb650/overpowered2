/**
 * The parkour strip on the Test Range: every move in a row, down the west wall from the spawn end to the deck. It runs
 * along -Z at x = -29.5, with the room's own west wall on the left to run on.
 *
 * In order: vault thin cover, slide under a bar, vault a deep crate, wall run and kick across a 3.8 m corridor, mantle a
 * 2 m block, walk off its far edge, then jump and mantle the 3 m deck, and slam back down.
 */
import { FACE } from '../world/kit/geo';
import type { Kit } from '../world/kit/kit';

/** The lane's two edges. The room's west wall is at x = -32. */
const X0 = -31.9;
const X1 = -27;

export const PARKOUR = {
  /** Where the panel's button stands the player, looking down the strip. */
  start: [-29.5, 24.5] as const,
  /** Front face of each station along Z, for the live check and for anyone reading the floor. */
  cover: 18,
  bar: 12,
  crate: 7,
  /** The second wall, from and to along Z, and the X of its face. The room's own wall is the other side: 3.8 m apart. */
  corridor: [3.5, -10.5] as const,
  corridorX: -28.2,
  block: -13,
  deck: -20,
} as const;

function line(k: Kit, z: number): void {
  k.geo.use('paintYellow').box((X0 + X1) / 2, 0.006, z, (X1 - X0) / 2, 0.002, 0.06, FACE.py);
}

export function parkour(k: Kit): void {
  const P = PARKOUR;
  // A yellow line one stride before each station.
  for (const z of [P.cover + 2, P.bar + 2.5, P.crate + 2, P.corridor[0] + 0.6, P.block + 2, P.deck + 3]) line(k, z);

  // Waist-high and thin: the plain vault.
  k.block('panel', X0, 0, P.cover - 0.5, X1, 1.1, P.cover, 0.04);
  // A bar to slide under, 1.15 m off the floor, on two posts.
  k.block('steel', X0, 1.15, P.bar - 0.4, X1, 1.6, P.bar, 0.03);
  k.block('steel', X1 - 0.3, 0, P.bar - 0.4, X1, 1.15, P.bar, 0.03);
  // 1.2 m high and 1.5 m deep: a vault with a hand's worth of travel over the top.
  k.block('panel', X0, 0, P.crate - 1.5, X1, 1.2, P.crate, 0.05);
  // A second wall facing the room's, for running the west wall and kicking between the two.
  k.block('concrete', P.corridorX, 0, P.corridor[1], P.corridorX + 0.5, 5, P.corridor[0], 0.04);
  // 2 m to climb, 2.5 m deep, and an edge to walk off.
  k.block('panel', X0, 0, P.block - 2.5, X1, 2, P.block, 0.05);
}
