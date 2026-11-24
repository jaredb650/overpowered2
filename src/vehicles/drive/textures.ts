/**
 * Procedural PBR material & surface-texture library for player-driveable vehicles.
 *
 * Replaces flat untextured faceted polygons with crisp, tileable 512x512 canvas-generated PBR maps
 * (albedo grain + panel seams + rivets + weathering, bump relief, and roughness variation) paired
 * with automatic box-projected UVs so every lofted hull, wing, fender, turret, and tire renders with
 * tactile military hardware detail while preserving each vehicle's exact silhouette and low draw count.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ModelMaterials, Placement } from '../../progression/modelkit';

export type VehicleSurface = 'armor' | 'metal' | 'tread' | 'canopy' | 'carbon';

export interface VehicleMaterialSet {
  readonly armor: THREE.MeshStandardMaterial;
  readonly metal: THREE.MeshStandardMaterial;
  readonly tread: THREE.MeshStandardMaterial;
  readonly canopy: THREE.MeshStandardMaterial;
  readonly carbon: THREE.MeshStandardMaterial;
  readonly glow: THREE.MeshBasicMaterial;
}

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3(1, 1, 1);
const _mat = new THREE.Matrix4();
const _col = new THREE.Color();

/** Deterministic fast PRNG for crisp procedural textures. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  return { canvas, ctx };
}

function finishTexture(canvas: HTMLCanvasElement, repeatX: number, repeatY: number, isColor: boolean): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 4;
  if (isColor) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Painted military composite armor plate: panel seams, recessed rivets, directional brush grain & subtle grit. */
function buildArmorTextures(): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture; rough: THREE.CanvasTexture } | null {
  const S = 512;
  const cMap = makeCanvas(S);
  const cBump = makeCanvas(S);
  const cRough = makeCanvas(S);
  if (!cMap || !cBump || !cRough) return null;
  const rng = mulberry32(4109);

  // Albedo multiplier (centered near white so vertex paint hues stay true & rich).
  const m = cMap.ctx;
  m.fillStyle = '#ecebe6';
  m.fillRect(0, 0, S, S);
  // Subtle directional brushed armor grain
  for (let i = 0; i < 2400; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const w = 14 + rng() * 58;
    const v = 216 + Math.floor(rng() * 34);
    m.fillStyle = `rgba(${v},${v},${v - 2},0.16)`;
    m.fillRect(x, y, w, 1.5);
  }
  // Subtle weathering / desert dust mottling
  for (let i = 0; i < 420; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 4 + rng() * 24;
    m.fillStyle = rng() > 0.5 ? 'rgba(182,172,154,0.06)' : 'rgba(92,96,98,0.05)';
    m.beginPath();
    m.arc(x, y, r, 0, Math.PI * 2);
    m.fill();
  }

  // Bump & roughness base
  const b = cBump.ctx;
  b.fillStyle = '#808080';
  b.fillRect(0, 0, S, S);
  const r = cRough.ctx;
  r.fillStyle = '#929292';
  r.fillRect(0, 0, S, S);

  // Panel seam grid (2x2 large armor plates + sub-panel bevels)
  const lines = [0, 128, 256, 384];
  for (const pos of lines) {
    const heavy = pos === 0 || pos === 256;
    const w = heavy ? 3 : 2;
    // Recessed dark seam
    m.fillStyle = heavy ? 'rgba(42,46,50,0.46)' : 'rgba(54,58,62,0.28)';
    m.fillRect(pos, 0, w, S);
    m.fillRect(0, pos, S, w);
    // Crisp edge highlight beside seam (worn paint bevel)
    m.fillStyle = 'rgba(255,255,255,0.22)';
    m.fillRect(pos + w, 0, 2, S);
    m.fillRect(0, pos + w, S, 2);

    b.fillStyle = heavy ? '#242424' : '#464646';
    b.fillRect(pos, 0, w, S);
    b.fillRect(0, pos, S, w);
    b.fillStyle = '#b6b6b6';
    b.fillRect(pos + w, 0, 2, S);
    b.fillRect(0, pos + w, S, 2);

    // Worn metallic edges are shinier (lower roughness)
    r.fillStyle = '#585858';
    r.fillRect(pos + w, 0, 3, S);
    r.fillRect(0, pos + w, S, 3);
  }

  // Corner & seam rivets along every plate
  for (let py = 0; py < 4; py++) {
    for (let px = 0; px < 4; px++) {
      const ox = px * 128;
      const oy = py * 128;
      const pts: readonly [number, number][] = [
        [10, 10], [64, 10], [118, 10],
        [10, 64], [118, 64],
        [10, 118], [64, 118], [118, 118],
      ];
      for (const [dx, dy] of pts) {
        m.fillStyle = 'rgba(48,52,56,0.42)';
        m.beginPath();
        m.arc(ox + dx, oy + dy, 2.8, 0, Math.PI * 2);
        m.fill();
        m.fillStyle = 'rgba(245,248,250,0.34)';
        m.beginPath();
        m.arc(ox + dx - 0.8, oy + dy - 0.8, 1.4, 0, Math.PI * 2);
        m.fill();

        b.fillStyle = '#dedede';
        b.beginPath();
        b.arc(ox + dx, oy + dy, 2.5, 0, Math.PI * 2);
        b.fill();
      }
    }
  }

  // Micro-scratches for tactile realism
  for (let i = 0; i < 160; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const ang = rng() * Math.PI * 2;
    const len = 6 + rng() * 26;
    m.strokeStyle = 'rgba(255,255,255,0.22)';
    m.lineWidth = 1;
    m.beginPath();
    m.moveTo(x, y);
    m.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    m.stroke();
    r.strokeStyle = '#484848';
    r.lineWidth = 1.2;
    r.beginPath();
    r.moveTo(x, y);
    r.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    r.stroke();
  }

  return {
    map: finishTexture(cMap.canvas, 1, 1, true),
    bump: finishTexture(cBump.canvas, 1, 1, false),
    rough: finishTexture(cRough.canvas, 1, 1, false),
  };
}

/** Machined brushed steel & industrial diamond-plate texture for frames, rollcages, grilles & barrels. */
function buildMetalTextures(): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } | null {
  const S = 256;
  const cMap = makeCanvas(S);
  const cBump = makeCanvas(S);
  if (!cMap || !cBump) return null;
  const rng = mulberry32(9973);

  const m = cMap.ctx;
  const b = cBump.ctx;
  m.fillStyle = '#e4e8ec';
  m.fillRect(0, 0, S, S);
  b.fillStyle = '#7e7e7e';
  b.fillRect(0, 0, S, S);

  for (let y = 0; y < S; y += 2) {
    const shade = 212 + Math.floor(rng() * 34);
    m.fillStyle = `rgb(${shade},${shade + 2},${shade + 4})`;
    m.fillRect(0, y, S, 2);
    const bv = 112 + Math.floor(rng() * 32);
    b.fillStyle = `rgb(${bv},${bv},${bv})`;
    b.fillRect(0, y, S, 2);
  }
  // Subtle industrial diamond tread / machined louver markings
  for (let y = 8; y < S; y += 32) {
    for (let x = 8; x < S; x += 32) {
      m.fillStyle = 'rgba(255,255,255,0.22)';
      m.fillRect(x, y, 10, 3);
      m.fillRect(x + 16, y + 12, 3, 10);
      b.fillStyle = '#c4c4c4';
      b.fillRect(x, y, 10, 3);
      b.fillRect(x + 16, y + 12, 3, 10);
    }
  }

  return {
    map: finishTexture(cMap.canvas, 1.5, 1.5, true),
    bump: finishTexture(cBump.canvas, 1.5, 1.5, false),
  };
}

/** Deep knobby vulcanized off-road tire & tank tread pattern. */
function buildTreadTextures(): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } | null {
  const S = 256;
  const cMap = makeCanvas(S);
  const cBump = makeCanvas(S);
  if (!cMap || !cBump) return null;
  const rng = mulberry32(2047);

  const m = cMap.ctx;
  const b = cBump.ctx;
  m.fillStyle = '#d4d6d8';
  m.fillRect(0, 0, S, S);
  b.fillStyle = '#363636';
  b.fillRect(0, 0, S, S);

  // Heavy alternating chevron tire lugs
  for (let y = 0; y < S; y += 24) {
    for (let x = 0; x < S; x += 32) {
      const shift = ((y / 24) % 2) * 16;
      const lx = (x + shift) % S;
      m.fillStyle = '#f2f2f2';
      m.fillRect(lx + 2, y + 3, 22, 14);
      m.fillStyle = 'rgba(52,54,58,0.45)';
      m.fillRect(lx, y + 18, 28, 5);

      b.fillStyle = '#e0e0e0';
      b.fillRect(lx + 2, y + 3, 22, 14);
    }
  }
  // Fine rubber grain noise
  for (let i = 0; i < 900; i++) {
    const v = 180 + Math.floor(rng() * 55);
    m.fillStyle = `rgba(${v},${v},${v},0.16)`;
    m.fillRect(rng() * S, rng() * S, 2, 2);
  }

  return {
    map: finishTexture(cMap.canvas, 2, 2, true),
    bump: finishTexture(cBump.canvas, 2, 2, false),
  };
}

/** Woven tactical carbon-fiber / ribbed saddle texture. */
function buildCarbonTextures(): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } | null {
  const S = 128;
  const cMap = makeCanvas(S);
  const cBump = makeCanvas(S);
  if (!cMap || !cBump) return null;

  const m = cMap.ctx;
  const b = cBump.ctx;
  m.fillStyle = '#c8ced4';
  m.fillRect(0, 0, S, S);
  b.fillStyle = '#686868';
  b.fillRect(0, 0, S, S);

  for (let y = 0; y < S; y += 8) {
    for (let x = 0; x < S; x += 8) {
      const alt = ((x + y) / 8) % 2 === 0;
      m.fillStyle = alt ? '#eef2f6' : '#a8b0b8';
      m.fillRect(x, y, 7, 3);
      m.fillStyle = alt ? '#a8b0b8' : '#eef2f6';
      m.fillRect(x, y + 4, 7, 3);

      b.fillStyle = alt ? '#b8b8b8' : '#585858';
      b.fillRect(x, y, 7, 3);
      b.fillStyle = alt ? '#585858' : '#b8b8b8';
      b.fillRect(x, y + 4, 7, 3);
    }
  }

  return {
    map: finishTexture(cMap.canvas, 3, 3, true),
    bump: finishTexture(cBump.canvas, 3, 3, false),
  };
}

const cache = new WeakMap<ModelMaterials, VehicleMaterialSet>();

/** Returns cached procedural PBR materials for driveable vehicles (safe in Node & browser). */
export function getVehicleMaterials(base: ModelMaterials): VehicleMaterialSet {
  const hit = cache.get(base);
  if (hit) return hit;

  const armorTex = buildArmorTextures();
  const metalTex = buildMetalTextures();
  const treadTex = buildTreadTextures();
  const carbonTex = buildCarbonTextures();

  const set: VehicleMaterialSet = {
    armor: new THREE.MeshStandardMaterial({
      vertexColors: true,
      metalness: 0.42,
      roughness: 0.56,
      map: armorTex?.map ?? null,
      bumpMap: armorTex?.bump ?? null,
      bumpScale: 0.032,
      roughnessMap: armorTex?.rough ?? null,
    }),
    metal: new THREE.MeshStandardMaterial({
      vertexColors: true,
      metalness: 0.82,
      roughness: 0.34,
      map: metalTex?.map ?? null,
      bumpMap: metalTex?.bump ?? null,
      bumpScale: 0.02,
    }),
    tread: new THREE.MeshStandardMaterial({
      vertexColors: true,
      metalness: 0.08,
      roughness: 0.88,
      map: treadTex?.map ?? null,
      bumpMap: treadTex?.bump ?? null,
      bumpScale: 0.055,
    }),
    canopy: new THREE.MeshStandardMaterial({
      vertexColors: true,
      metalness: 0.9,
      roughness: 0.12,
      emissive: new THREE.Color('#0c1c28'),
      emissiveIntensity: 0.45,
    }),
    carbon: new THREE.MeshStandardMaterial({
      vertexColors: true,
      metalness: 0.28,
      roughness: 0.48,
      map: carbonTex?.map ?? null,
      bumpMap: carbonTex?.bump ?? null,
      bumpScale: 0.022,
    }),
    glow: base.glow,
  };
  cache.set(base, set);
  return set;
}

/**
 * Generates distortion-free box-projected UVs from vertex positions & normals, applies vertex color,
 * and ensures non-indexed smooth/crisp normals for seamless geometry merging.
 */
function preparePart(
  geo: THREE.BufferGeometry,
  color: THREE.ColorRepresentation,
  boost: number,
  uvScale: number,
  smooth: boolean,
): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (!smooth || !g.getAttribute('normal')) g.computeVertexNormals();
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const count = pos.count;

  // Box-projected UVs scaled in world/object meters so panels & rivets match across every part!
  const uvs = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = Math.abs(nrm.getX(i));
    const ny = Math.abs(nrm.getY(i));
    const nz = Math.abs(nrm.getZ(i));
    if (ny >= nx && ny >= nz) {
      uvs[i * 2] = x * uvScale;
      uvs[i * 2 + 1] = z * uvScale;
    } else if (nx >= nz) {
      uvs[i * 2] = z * uvScale;
      uvs[i * 2 + 1] = y * uvScale;
    } else {
      uvs[i * 2] = x * uvScale;
      uvs[i * 2 + 1] = y * uvScale;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

  _col.set(color).multiplyScalar(boost);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = _col.r;
    colors[i * 3 + 1] = _col.g;
    colors[i * 3 + 2] = _col.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

function placeGeo(geo: THREE.BufferGeometry, p: Placement): THREE.BufferGeometry {
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

const UV_SCALE: Record<VehicleSurface, number> = {
  armor: 0.48,
  metal: 0.72,
  tread: 1.15,
  canopy: 0.5,
  carbon: 1.4,
};

/**
 * Multi-surface procedural vehicle geometry builder.
 * Batches parts by PBR surface type (`armor`, `metal`, `tread`, `canopy`, `carbon`, `glow`) so a
 * richly textured, high-detail vehicle renders in ~4-5 draw calls total.
 */
export class VehicleBuilder {
  private readonly buckets: Record<VehicleSurface, THREE.BufferGeometry[]> = {
    armor: [],
    metal: [],
    tread: [],
    canopy: [],
    carbon: [],
  };
  private readonly glowParts: THREE.BufferGeometry[] = [];

  solid(
    geo: THREE.BufferGeometry,
    color: THREE.ColorRepresentation,
    p: Placement = {},
    surface: VehicleSurface = 'armor',
    smooth = false,
  ): this {
    this.buckets[surface].push(preparePart(placeGeo(geo, p), color, 1, UV_SCALE[surface], smooth));
    return this;
  }

  glow(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, boost = 3, p: Placement = {}): this {
    const g = placeGeo(geo, p);
    const ni = g.index ? g.toNonIndexed() : g;
    ni.deleteAttribute('uv');
    ni.computeVertexNormals();
    _col.set(color).multiplyScalar(boost);
    const n = ni.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = _col.r;
      colors[i * 3 + 1] = _col.g;
      colors[i * 3 + 2] = _col.b;
    }
    ni.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.glowParts.push(ni);
    return this;
  }

  box(
    w: number,
    h: number,
    d: number,
    color: THREE.ColorRepresentation,
    p: Placement = {},
    surface: VehicleSurface = 'armor',
  ): this {
    return this.solid(new THREE.BoxGeometry(w, h, d), color, p, surface, false);
  }

  cyl(
    rTop: number,
    rBottom: number,
    h: number,
    seg: number,
    color: THREE.ColorRepresentation,
    p: Placement = {},
    surface: VehicleSurface = 'metal',
  ): this {
    return this.solid(new THREE.CylinderGeometry(rTop, rBottom, h, seg), color, p, surface, seg >= 12);
  }

  sphere(
    radius: number,
    color: THREE.ColorRepresentation,
    p: Placement = {},
    surface: VehicleSurface = 'armor',
  ): this {
    return this.solid(new THREE.SphereGeometry(radius, 12, 10), color, p, surface, true);
  }

  /** Builds a THREE.Group with at most one merged mesh per used PBR surface type. */
  build(materials: ModelMaterials): THREE.Group {
    const mats = getVehicleMaterials(materials);
    const group = new THREE.Group();
    const surfaces: readonly VehicleSurface[] = ['armor', 'metal', 'tread', 'canopy', 'carbon'];
    for (const s of surfaces) {
      const list = this.buckets[s];
      if (list.length === 0) continue;
      const merged = mergeGeometries(list, false);
      if (merged) {
        const mesh = new THREE.Mesh(merged, mats[s]);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
    }
    if (this.glowParts.length > 0) {
      const merged = mergeGeometries(this.glowParts, false);
      if (merged) group.add(new THREE.Mesh(merged, mats.glow));
    }
    return group;
  }
}

/**
 * Upgrades an existing ModelBuilder group (e.g. shared Warthog / Valkyrie airframes) in-place to
 * use our procedural riveted PBR armor material with distortion-free box-projected UVs while
 * leaving unlit glow meshes untouched.
 */
export function upgradeModelToPbrArmor(
  root: THREE.Object3D,
  materials: ModelMaterials,
  surface: VehicleSurface = 'armor',
): void {
  const mats = getVehicleMaterials(materials);
  const mat = mats[surface];
  const uvScale = UV_SCALE[surface];
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.material === materials.glow) return;
    const g = mesh.geometry;
    const pos = g.getAttribute('position');
    if (!pos) return;
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const nrm = g.getAttribute('normal');
    if (!g.getAttribute('uv')) {
      const count = pos.count;
      const uvs = new Float32Array(count * 2);
      for (let i = 0; i < count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const nx = Math.abs(nrm.getX(i));
        const ny = Math.abs(nrm.getY(i));
        const nz = Math.abs(nrm.getZ(i));
        if (ny >= nx && ny >= nz) {
          uvs[i * 2] = x * uvScale;
          uvs[i * 2 + 1] = z * uvScale;
        } else if (nx >= nz) {
          uvs[i * 2] = z * uvScale;
          uvs[i * 2 + 1] = y * uvScale;
        } else {
          uvs[i * 2] = x * uvScale;
          uvs[i * 2 + 1] = y * uvScale;
        }
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    }
    mesh.material = mat;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
}

