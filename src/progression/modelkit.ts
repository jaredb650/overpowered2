/**
 * Procedural model builder for everything this system puts in the world.
 *
 * A model is two merged meshes at most: lit faceted metal and unlit HDR glow, each coloured per vertex.
 * That keeps an aircraft of sixty parts at two draw calls, which is the only way a screen full of drones,
 * capsules and pods stays inside the draw budget.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Ctx } from '../core/contracts';

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3(1, 1, 1);
const _mat = new THREE.Matrix4();
const _col = new THREE.Color();

export interface Placement {
  at?: readonly [number, number, number];
  rot?: readonly [number, number, number];
  /** Non-uniform scale applied before rotation. */
  scale?: readonly [number, number, number];
}

function paint(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, boost: number): THREE.BufferGeometry {
  // Non-indexed so flat shading gets hard edges, and so every part merges with every other.
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  _col.set(color).multiplyScalar(boost);
  const n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = _col.r;
    colors[i * 3 + 1] = _col.g;
    colors[i * 3 + 2] = _col.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

function place(geo: THREE.BufferGeometry, p: Placement): THREE.BufferGeometry {
  const a = p.at ?? [0, 0, 0];
  const r = p.rot ?? [0, 0, 0];
  const s = p.scale ?? [1, 1, 1];
  _euler.set(r[0], r[1], r[2]);
  _quat.setFromEuler(_euler);
  _pos.set(a[0], a[1], a[2]);
  _scale.set(s[0], s[1], s[2]);
  _mat.compose(_pos, _quat, _scale);
  geo.applyMatrix4(_mat);
  return geo;
}

export class ModelBuilder {
  private solidParts: THREE.BufferGeometry[] = [];
  private glowParts: THREE.BufferGeometry[] = [];

  /** Adds any geometry as lit metal. */
  solid(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, p: Placement = {}): this {
    this.solidParts.push(paint(place(geo, p), color, 1));
    return this;
  }

  /** Adds any geometry as unlit glow. `boost` above 1 pushes it into bloom. */
  glow(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, boost = 3, p: Placement = {}): this {
    this.glowParts.push(paint(place(geo, p), color, boost));
    return this;
  }

  box(w: number, h: number, d: number, color: THREE.ColorRepresentation, p: Placement = {}): this {
    return this.solid(new THREE.BoxGeometry(w, h, d), color, p);
  }

  cyl(rTop: number, rBottom: number, h: number, seg: number, color: THREE.ColorRepresentation, p: Placement = {}): this {
    return this.solid(new THREE.CylinderGeometry(rTop, rBottom, h, seg), color, p);
  }

  /** Mirrors a placement across X, for the left and right halves of a symmetric model. */
  static mirrorX(p: Placement): Placement {
    const a = p.at ?? [0, 0, 0];
    const r = p.rot ?? [0, 0, 0];
    return { ...p, at: [-a[0], a[1], a[2]], rot: [r[0], -r[1], -r[2]] };
  }

  solidGeometry(): THREE.BufferGeometry | null {
    return this.solidParts.length ? mergeGeometries(this.solidParts, false) : null;
  }

  glowGeometry(): THREE.BufferGeometry | null {
    return this.glowParts.length ? mergeGeometries(this.glowParts, false) : null;
  }
}

/** Materials shared by every model here. Vertex colours carry the paint, so two materials cover the system. */
export class ModelMaterials {
  readonly solid: THREE.MeshStandardMaterial;
  readonly glow: THREE.MeshBasicMaterial;

  constructor(ctx: Ctx) {
    this.solid = ctx.render.materials.patch(
      new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, metalness: 0.75, roughness: 0.42 }),
    );
    this.glow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false });
  }

  /** Builds a Group of the merged meshes. */
  group(b: ModelBuilder): THREE.Group {
    const g = new THREE.Group();
    const solid = b.solidGeometry();
    const glow = b.glowGeometry();
    if (solid) g.add(new THREE.Mesh(solid, this.solid));
    if (glow) g.add(new THREE.Mesh(glow, this.glow));
    return g;
  }
}
