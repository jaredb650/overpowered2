/**
 * Faceted hulls for aircraft. A fuselage is one long curved shape, and a stack of boxes never reads as one, so a hull is
 * lofted through a few cross-sections instead. Each section is an octagon: flat top and belly, flat sides, chamfered
 * corners. Flat shading then gives the hard panel edges the rest of the game's hardware has.
 */
import * as THREE from 'three';

/** One cross-section. Nose is +Z, as in airframe.ts. */
export interface Station {
  z: number;
  /** Half width. */
  w: number;
  top: number;
  bottom: number;
}

const SIDES = 8;
/** How far in from the side the flat top and belly end. */
const CHAMFER = 0.62;

function ring(s: Station, out: number[]): void {
  const h = s.top - s.bottom;
  const low = s.bottom + h * 0.3;
  const high = s.bottom + h * 0.68;
  const c = s.w * CHAMFER;
  // Anticlockwise looking down -Z, which is what makes the faces below point outward.
  out.push(s.w, low, s.z, s.w, high, s.z, c, s.top, s.z, -c, s.top, s.z, -s.w, high, s.z, -s.w, low, s.z, -c, s.bottom, s.z, c, s.bottom, s.z);
}

/** Lofts through `stations`, which run from tail to nose, and closes both ends. */
export function hull(stations: readonly Station[]): THREE.BufferGeometry {
  const rings: number[] = [];
  for (const s of stations) ring(s, rings);
  const v: number[] = [];
  const corner = (r: number, i: number) => {
    const o = (r * SIDES + (i % SIDES)) * 3;
    v.push(rings[o]!, rings[o + 1]!, rings[o + 2]!);
  };
  for (let r = 0; r + 1 < stations.length; r++) {
    for (let i = 0; i < SIDES; i++) {
      corner(r, i); corner(r, i + 1); corner(r + 1, i + 1);
      corner(r, i); corner(r + 1, i + 1); corner(r + 1, i);
    }
  }
  const nose = stations.length - 1;
  for (let i = 1; i + 1 < SIDES; i++) {
    corner(nose, 0); corner(nose, i); corner(nose, i + 1);
    corner(0, 0); corner(0, i + 1); corner(0, i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  return g;
}
