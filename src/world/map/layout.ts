/** Shared dimensions of The Crucible. Every zone file measures against these, so the plan stays coherent. */
export const LEVEL = { arena: -8, lower: -7, ground: 0, catwalk: 8, ring: 14, halo: 8, crown: 30 } as const;

/** Ring Road centre line: a rounded square. */
export const RING = { half: 150, corner: 70, width: 18, wallTop: 24 } as const;

/** Sunken arena. */
export const BOWL = { radius: 46, rim: 68, reactor: 13 } as const;

/** Diagonal viaducts run from the rim up to the ring. Radii measured from the map centre along the diagonal. */
export const VIADUCT = { r0: 68, r1: 175, width: 14 } as const;

/** Height of the viaduct deck at a radius along its axis. */
export const viaductY = (r: number) => (LEVEL.ring * (r - VIADUCT.r0)) / (VIADUCT.r1 - VIADUCT.r0);

/** The four diagonals as unit vectors, starting NE and going clockwise. */
export const DIAGONALS = [
  [Math.SQRT1_2, -Math.SQRT1_2], [Math.SQRT1_2, Math.SQRT1_2], [-Math.SQRT1_2, Math.SQRT1_2], [-Math.SQRT1_2, -Math.SQRT1_2],
] as const;

/** Foundry hall shell. */
export const HALL = { x: 68, z0: -138, z1: -74, height: 34 } as const;

/** Transit trench. */
export const TRENCH = { x0: -118, x1: -92, z0: -74, z1: 74, y: -7 } as const;

/** Scrapyard pit. */
export const PIT = { x0: -22, x1: 22, z0: 96, z1: 124, y: -7 } as const;

/** Refinery sump. */
export const SUMP = { x0: 104, x1: 120, z0: -56, z1: 56, y: -7 } as const;

/** Foundry lava channel and the gallery beside it. */
export const LAVA = { x0: -56, x1: 56, z0: -122, z1: -104, y: -8.6, galleryZ0: -104, galleryZ1: -92, galleryY: -7 } as const;
