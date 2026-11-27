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
  /** The wear on its limbs, as the characters keep count of it (theirs to read). */
  worn: object;
  stress: Float32Array;
  /** What it wore and carried that was still on it, copies of the meshes with the bone each hung on. */
  gear: { bone: number; object: THREE.Object3D }[];
  /** What was this body's alone (a partial head standing in for the real one, an implant), as it was mounted. */
  standIns: { bone: number; object: THREE.Object3D; folds: boolean }[];
}

/** What a batch needs of anything it is to draw: a body, or a loose limb (characters/Character.ts). */
export interface FarBakeable {
  /** The material every baked body is drawn with. Any archetype's will do: it shades from the vertices alone. */
  readonly farMaterial: THREE.Material;
  bakeFar(out: FarBuffers, vertex: number, index: number, maxVerts: number, maxIndices: number): { verts: number; indices: number };
}

/** What the batch needs of a character (characters/Character.ts). */
export interface FarSource {
  readonly archetype: string;
  /** The material every baked body is drawn with. Any archetype's will do: it shades from the vertices alone. */
  readonly farMaterial: THREE.Material;
  /**
   * Writes the body as it lies into `out`, at most `maxVerts` vertices from `vertex` and `maxIndices` indices from
   * `index`. Returns how many of each it wrote, or none of either if the body does not fit.
   */
  bakeFar(out: FarBuffers, vertex: number, index: number, maxVerts: number, maxIndices: number): { verts: number; indices: number };
  snapshot(): CorpseSnapshot;
  restore(snap: CorpseSnapshot): void;
}

export const FarTuning = {
  /**
   * Room for one body: the coarsest level of a Brute is 1,954 triangles, and a body's gear (a rifle, a helmet, plates) is
   * given the rest: sixty mixed bodies in the game came to 1,852 triangles each. What does not fit is left off.
   */
  slotVerts: 2200,
  slotIndices: 7800,
  /**
   * Bodies the batch may come to hold: the most any "Mess" level keeps past what it draws as characters (200 - 40). It is
   * given room forty bodies at a time as they come, 3.4 MB a step, so a level that bakes twenty never pays for 160.
   */
  slots: 160,
  step: 40,
  /**
   * The limbs' own batch (`Gore.farLimbs`): a loose limb at rest is a few hundred triangles at the coarsest level, so its
   * slots are a third the size and the 64 limbs the highest "Mess" level keeps are 2.6 MB where body-sized slots would be
   * 5.4. A top half with its arms, head and kit that does not fit stays a piece.
   */
  limb: { slotVerts: 900, slotIndices: 2400, slots: 72, step: 24 },
};

/** The size of a batch's slots and how it grows. */
export interface FarShape {
  slotVerts: number;
  slotIndices: number;
  step: number;
}

/**
 * One shared geometry cut into equal slots. A slot in use holds one body's triangles; a free one holds none (its indices
 * all name one vertex). The draw runs as far as the last slot in use.
 */
export class FarBatch {
  private mesh: THREE.Mesh | null = null;
  private buffers: FarBuffers | null = null;
  private readonly used: Uint8Array;
  /** Slots there is room for now. */
  private room = 0;
  private high = 0;
  private attrs: { position: THREE.BufferAttribute; normal: THREE.BufferAttribute; color: THREE.BufferAttribute; mat: THREE.BufferAttribute; index: THREE.BufferAttribute } | null = null;
  /** Bytes the batch's arrays hold now, in the page and again on the GPU. */
  get bytes(): number {
    return this.room * (this.shape.slotVerts * 24 + this.shape.slotIndices * 4);
  }

  /** The mesh every baked body is drawn in, once there is one: something in the scene for what belongs to them to hang on. */
  get object(): THREE.Object3D | null {
    return this.mesh;
  }

  /** Bodies in the batch, and its triangles, for the overlay and checks. */
  count = 0;
  triangles = 0;
  private readonly tris: Uint32Array;

  constructor(private readonly ctx: Ctx, readonly slots = FarTuning.slots, private readonly shape: FarShape = FarTuning, private readonly name = 'gore.far') {
    this.used = new Uint8Array(slots);
    this.tris = new Uint32Array(slots);
  }

  /** Built on the first bake (or at load, `warm`), with the first body's far material. */
  private ensure(material: THREE.Material, want = 1): FarBuffers {
    if (this.buffers && want <= this.room) return this.buffers;
    const t = this.shape;
    const room = Math.min(this.slots, Math.ceil(Math.max(want, this.room + 1) / t.step) * t.step);
    const verts = room * t.slotVerts;
    const buffers: FarBuffers = {
      position: new Float32Array(verts * 3),
      normal: new Int8Array(verts * 4),
      color: new Uint8Array(verts * 4),
      mat: new Uint8Array(verts * 4),
      index: new Uint32Array(room * t.slotIndices),
    };
    const old = this.buffers;
    if (old) {
      // More room: what is there is carried over, and the whole of it sent again, once.
      buffers.position.set(old.position);
      buffers.normal.set(old.normal);
      buffers.color.set(old.color);
      buffers.mat.set(old.mat);
      buffers.index.set(old.index);
    }
    this.room = room;
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
    geometry.setDrawRange(0, this.high * t.slotIndices);
    // Never culled as a whole: the bodies in it lie all over the map.
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.geometry = geometry;
    } else {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = this.name;
      mesh.frustumCulled = false;
      // No shadow of their own: each lies in its own pool, and 150 of them in the shadow pass is what this is here to save.
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.ctx.render.scene.add(mesh);
      this.mesh = mesh;
    }
    this.buffers = buffers;
    this.attrs = attrs;
    return buffers;
  }

  private generation = 0;
  private savedOnAfterRender: THREE.Mesh['onAfterRender'] | null = null;

  /** Compiles the batch's program at load, so the first body baked in a fight does not stall its frame. */
  warm(source: FarBakeable): void {
    this.ensure(source.farMaterial);
    // One body, written and taken out again: an empty draw compiles nothing.
    const slot = this.add(source);
    const mesh = this.mesh!;
    if (slot < 0) return;
    const gen = this.generation;
    if (!this.savedOnAfterRender) this.savedOnAfterRender = mesh.onAfterRender;
    const drawn = mesh.onAfterRender;
    mesh.onAfterRender = (...args) => {
      mesh.onAfterRender = drawn;
      if (drawn === this.savedOnAfterRender) this.savedOnAfterRender = null;
      if (this.generation === gen) this.remove(slot);
      drawn.apply(mesh, args);
    };
  }

  private scratch: FarBuffers | null = null;

  private getScratch(): FarBuffers {
    if (!this.scratch) {
      const t = this.shape;
      this.scratch = {
        position: new Float32Array(t.slotVerts * 3),
        normal: new Int8Array(t.slotVerts * 4),
        color: new Uint8Array(t.slotVerts * 4),
        mat: new Uint8Array(t.slotVerts * 4),
        index: new Uint32Array(t.slotIndices),
      };
    }
    return this.scratch;
  }

  /** Bakes `source` as it lies into a free slot. -1 with no slot free. */
  add(source: FarBakeable): number {
    let slot = -1;
    for (let i = 0; i < this.slots; i++) {
      if (this.used[i] === 0) {
        slot = i;
        break;
      }
    }
    if (slot < 0) return -1;
    const t = this.shape;
    const v0 = slot * t.slotVerts;
    const i0 = slot * t.slotIndices;
    let buffers: FarBuffers;
    let wrote: { verts: number; indices: number };
    if (slot >= this.room) {
      // Avoid allocating/growing the shared GPU buffers if the source does not fit a slot.
      const scratch = this.getScratch();
      wrote = source.bakeFar(scratch, 0, 0, t.slotVerts, t.slotIndices);
      if (wrote.indices === 0) return -1;
      buffers = this.ensure(source.farMaterial, slot + 1);
      buffers.position.set(scratch.position.subarray(0, wrote.verts * 3), v0 * 3);
      buffers.normal.set(scratch.normal.subarray(0, wrote.verts * 4), v0 * 4);
      buffers.color.set(scratch.color.subarray(0, wrote.verts * 4), v0 * 4);
      buffers.mat.set(scratch.mat.subarray(0, wrote.verts * 4), v0 * 4);
      for (let k = 0; k < wrote.indices; k++) buffers.index[i0 + k] = scratch.index[k]! + v0;
    } else {
      buffers = this.buffers!;
      wrote = source.bakeFar(buffers, v0, i0, t.slotVerts, t.slotIndices);
      // Too big for a slot (a Titan): it stays a character.
      if (wrote.indices === 0) return -1;
    }
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
    const t = this.shape;
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
    const t = this.shape;
    const a = this.attrs!;
    const v0 = slot * t.slotVerts;
    a.position.addUpdateRange(v0 * 3, verts * 3);
    a.normal.addUpdateRange(v0 * 4, verts * 4);
    a.color.addUpdateRange(v0 * 4, verts * 4);
    a.mat.addUpdateRange(v0 * 4, verts * 4);
    a.index.addUpdateRange(slot * t.slotIndices, t.slotIndices);
    a.position.needsUpdate = a.normal.needsUpdate = a.color.needsUpdate = a.mat.needsUpdate = a.index.needsUpdate = true;
  }

  clear(): void {
    this.generation++;
    if (this.mesh && this.savedOnAfterRender) {
      this.mesh.onAfterRender = this.savedOnAfterRender;
      this.savedOnAfterRender = null;
    }
    if (!this.buffers) return;
    if (this.high > 0) {
      const count = this.high * this.shape.slotIndices;
      this.buffers.index.fill(0, 0, count);
      const index = this.attrs!.index;
      index.clearUpdateRanges();
      index.addUpdateRange(0, count);
      index.needsUpdate = true;
      this.high = 0;
      this.mesh!.geometry.setDrawRange(0, 0);
    }
    this.used.fill(0);
    this.tris.fill(0);
    this.count = 0;
    this.triangles = 0;
    this.lower(0);
  }

  /** Lowers every body in the batch by `metres` at once: how the baked ones sink when the floor is swept. */
  lower(metres: number): void {
    if (!this.mesh) return;
    this.mesh.position.y = -metres;
    this.mesh.updateMatrix();
    this.mesh.matrixWorldNeedsUpdate = true;
  }
}
