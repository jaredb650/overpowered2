/**
 * The far batch: every old or distant body in one mesh and one draw.
 *
 * A body drawn as a character costs the frame about 0.03 ms of script and 36,600 triangles whether or not anyone looks
 * closely at it, and a settled one half of that (docs/notes/gore.md, "The mess: measured budgets"). Past the few dozen
 * the "Mess" setting allows to be drawn that way, a body at rest is baked: its pose worked out once on the CPU at the
 * coarsest level of detail, with its blood, wounds, burns and gear painted into its vertices, and written into a slot of
 * one shared geometry. Its character goes back to the library for the next enemy. What is kept is small: the pose, what
 * is cut off it, and the texels its wounds live in (`CorpseSnapshot`), so it can be put back exactly as it lay when a
 * rocket lands on the heap, a round hits it or the player walks into it.
 *
 * The batch is one material for every archetype: the characters' own far material, which shades from vertex colour alone.
 */
import * as THREE from 'three';
import type { Ctx } from '../core/contracts';

/** Where a body's vertices go: the batch's own arrays, written in place. */
export interface FarBuffers {
  position: Float32Array;
  /** Signed bytes, four a vertex (the fourth unused), as the models store them. */
  normal: Int8Array;
  /** Colour and occlusion, four bytes a vertex. */
  color: Uint8Array;
  /** Roughness, metal, glow and a material code, four bytes a vertex. */
  mat: Uint8Array;
  index: Uint32Array;
}

/** What a body leaves behind when it is baked, enough to stand it up again as it lay. Characters make and read it. */
export interface CorpseSnapshot {
  archetype: string;
  /** The root's place and turn: position, quaternion. */
  root: Float32Array;
  /** Every rig bone's own position and turn, seven floats a bone. */
  pose: Float32Array;
  /** Bones cut off, by rig index: the top of each lost chain. */
  cut: number[];
  /** The texels after the bones: wounds, blood, burn, breaks. */
  surface: Float32Array;
  wounds: { count: number; open: number; limits: Float32Array };
  stress: Float32Array;
  /** What it wore and carried that was still on it, copies of the meshes with the bone each hung on. */
  gear: { bone: number; object: THREE.Object3D }[];
  /** Stand-ins (a partial head), as they were mounted. */
  standIns: { bone: number; object: THREE.Object3D }[];
}

/** What the batch needs of a character (characters/Character.ts). */
export interface FarSource {
  readonly archetype: string;
  /** The material every baked body is drawn with. Any archetype's will do: it shades from the vertices alone. */
  readonly farMaterial: THREE.Material;
  /**
   * Writes the body as it lies into `out`, at most `maxVerts` vertices from `vertex` and `maxIndices` indices from
   * `index`, the indices counted from `vertex`. Returns how many of each it wrote.
   */
  bakeFar(out: FarBuffers, vertex: number, index: number, maxVerts: number, maxIndices: number): { verts: number; indices: number };
  snapshot(): CorpseSnapshot;
  restore(snap: CorpseSnapshot): void;
}

export const FarTuning = {
  /**
   * Room for one body: the coarsest level of a Brute is 1,954 triangles, and a body's gear (a rifle, a helmet, plates) is
   * given the rest. What does not fit is left off.
   */
  slotVerts: 2600,
  slotIndices: 9000,
  /** Bodies the batch has room for: the most any "Mess" level keeps past what it draws as characters (200 - 48). */
  slots: 160,
};

/**
 * One shared geometry cut into equal slots. A slot in use holds one body's triangles; a free one holds none (its indices
 * all name one vertex). The draw runs as far as the last slot in use.
 */
export class FarBatch {
  private mesh: THREE.Mesh | null = null;
  private buffers: FarBuffers | null = null;
  private readonly used: Uint8Array;
  private high = 0;
  private attrs: { position: THREE.BufferAttribute; normal: THREE.BufferAttribute; color: THREE.BufferAttribute; mat: THREE.BufferAttribute; index: THREE.BufferAttribute } | null = null;
  /** Bodies in the batch, and its triangles, for the overlay and checks. */
  count = 0;
  triangles = 0;
  private readonly tris: Uint32Array;

  constructor(private readonly ctx: Ctx, readonly slots = FarTuning.slots) {
    this.used = new Uint8Array(slots);
    this.tris = new Uint32Array(slots);
  }

  /** Built on the first bake (or at load, `warm`), with the first body's far material. */
  private ensure(material: THREE.Material): FarBuffers {
    if (this.buffers) return this.buffers;
    const t = FarTuning;
    const verts = this.slots * t.slotVerts;
    const buffers: FarBuffers = {
      position: new Float32Array(verts * 3),
      normal: new Int8Array(verts * 4),
      color: new Uint8Array(verts * 4),
      mat: new Uint8Array(verts * 4),
      index: new Uint32Array(this.slots * t.slotIndices),
    };
    const geometry = new THREE.BufferGeometry();
    const dynamic = <T extends THREE.BufferAttribute>(a: T): T => a.setUsage(THREE.DynamicDrawUsage) as T;
    const attrs = {
      position: dynamic(new THREE.BufferAttribute(buffers.position, 3)),
      normal: dynamic(new THREE.BufferAttribute(buffers.normal, 4, true)),
      color: dynamic(new THREE.BufferAttribute(buffers.color, 4, true)),
      mat: dynamic(new THREE.BufferAttribute(buffers.mat, 4, true)),
      index: dynamic(new THREE.BufferAttribute(buffers.index, 1)),
    };
    geometry.setAttribute('position', attrs.position);
    geometry.setAttribute('normal', attrs.normal);
    geometry.setAttribute('aColor', attrs.color);
    geometry.setAttribute('aMat', attrs.mat);
    geometry.setIndex(attrs.index);
    geometry.setDrawRange(0, 0);
    // Never culled as a whole: the bodies in it lie all over the map.
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'gore.far';
    mesh.frustumCulled = false;
    // No shadow of their own: each lies in its own pool, and 150 of them in the shadow pass is what this is here to save.
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    this.ctx.render.scene.add(mesh);
    this.mesh = mesh;
    this.buffers = buffers;
    this.attrs = attrs;
    return buffers;
  }

  /** Compiles the batch's program at load, so the first body baked in a fight does not stall its frame. */
  warm(source: FarSource): void {
    this.ensure(source.farMaterial);
  }

  /** Bakes `source` as it lies into a free slot. -1 with no slot free. */
  add(source: FarSource): number {
    let slot = -1;
    for (let i = 0; i < this.slots; i++) {
      if (this.used[i] === 0) {
        slot = i;
        break;
      }
    }
    if (slot < 0) return -1;
    const buffers = this.ensure(source.farMaterial);
    const t = FarTuning;
    const v0 = slot * t.slotVerts;
    const i0 = slot * t.slotIndices;
    const wrote = source.bakeFar(buffers, v0, i0, t.slotVerts, t.slotIndices);
    // The rest of the slot draws nothing.
    buffers.index.fill(v0, i0 + wrote.indices, i0 + t.slotIndices);
    this.used[slot] = 1;
    this.tris[slot] = wrote.indices / 3;
    this.triangles += this.tris[slot]!;
    this.count++;
    this.send(slot, wrote.verts);
    if (slot >= this.high) this.high = slot + 1;
    this.mesh!.geometry.setDrawRange(0, this.high * t.slotIndices);
    return slot;
  }

  /** Empties a slot: its body has been stood up again, or has gone. */
  remove(slot: number): void {
    if (slot < 0 || this.used[slot] === 0 || !this.buffers) return;
    const t = FarTuning;
    this.used[slot] = 0;
    this.count--;
    this.triangles -= this.tris[slot]!;
    this.tris[slot] = 0;
    const i0 = slot * t.slotIndices;
    this.buffers.index.fill(slot * t.slotVerts, i0, i0 + t.slotIndices);
    const index = this.attrs!.index;
    index.addUpdateRange(i0, t.slotIndices);
    index.needsUpdate = true;
    while (this.high > 0 && this.used[this.high - 1] === 0) this.high--;
    this.mesh!.geometry.setDrawRange(0, this.high * t.slotIndices);
  }

  private send(slot: number, verts: number): void {
    const t = FarTuning;
    const a = this.attrs!;
    const v0 = slot * t.slotVerts;
    a.position.addUpdateRange(v0 * 3, verts * 3);
    a.normal.addUpdateRange(v0 * 4, verts * 4);
    a.color.addUpdateRange(v0 * 4, verts * 4);
    a.mat.addUpdateRange(v0 * 4, verts * 4);
    a.index.addUpdateRange(slot * t.slotIndices, t.slotIndices);
    a.position.needsUpdate = a.normal.needsUpdate = a.color.needsUpdate = a.mat.needsUpdate = a.index.needsUpdate = true;
  }

  /** three clears nothing by itself: the ranges of the frame just drawn are dropped before the next are added. */
  afterFrame(): void {
    const a = this.attrs;
    if (!a) return;
    if (!a.position.needsUpdate) a.position.clearUpdateRanges();
    if (!a.normal.needsUpdate) a.normal.clearUpdateRanges();
    if (!a.color.needsUpdate) a.color.clearUpdateRanges();
    if (!a.mat.needsUpdate) a.mat.clearUpdateRanges();
    if (!a.index.needsUpdate) a.index.clearUpdateRanges();
  }

  clear(): void {
    if (!this.buffers) return;
    for (let i = 0; i < this.slots; i++) if (this.used[i]) this.remove(i);
  }
}
