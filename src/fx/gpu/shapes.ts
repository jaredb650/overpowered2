import * as THREE from 'three';
import { mulberry32 } from '../../core/math';

/** Face normals, no shared vertices: the facet is the point of these shapes. */
function faceted(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  n.deleteAttribute('uv');
  n.computeVertexNormals();
  return n;
}

/** The original's SphereGeometry(r, 4, 4): an angular 24-triangle gem at unit radius. */
export const gem = () => faceted(new THREE.SphereGeometry(1, 4, 4));

/** Unit cube, half-extent 1. */
export const cube = () => faceted(new THREE.BoxGeometry(2, 2, 2));

/** Sharp irregular rock or glass splinter. */
export function shard(): THREE.BufferGeometry {
  const rng = mulberry32(7);
  const j = () => 0.75 + rng() * 0.5;
  const top = [0, 1.5, 0.1];
  const bottom = [0.15, -1.2, 0];
  const ring = [0, 1, 2, 3, 4].map(i => {
    const a = (i / 5) * Math.PI * 2 + rng() * 0.5;
    return [Math.cos(a) * 0.62 * j(), (rng() - 0.5) * 0.5, Math.sin(a) * 0.62 * j()];
  });
  const tri: number[] = [];
  for (let i = 0; i < 5; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % 5]!;
    tri.push(...a, ...top, ...b, ...b, ...bottom, ...a);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
  return faceted(g);
}

/** Thin plate with a broken outline: armour flakes, concrete spall, shrapnel. */
export function plate(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(1, 0.82, 0.22, 5, 1);
  return faceted(g);
}

/** Tapered limb-like stick from the original's giblet set. */
export function rod(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.5, 0.36, 2.6, 4, 1);
  return faceted(g);
}

/** Spent shell casing: open-ended hexagonal tube along Y. */
export function casing(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.5, 0.5, 2.4, 6, 1);
  return faceted(g);
}

/** Corners of a centred quad, for anything that computes its own orientation. */
export function quad(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}
