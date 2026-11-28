/**
 * Dynamic auto-instancing batcher for repeated bone-attached character props (weapons, helmets, packs, armor plates).
 *
 * Keeps every source `THREE.Mesh` intact on its parent bone so gameplay code (muzzle sockets, visibility, shoot-offs,
 * material charring, X-ray highlights, snapshots) works unchanged, while collapsing hundreds of identical opaque
 * draw calls (both main pass and per-frame dynamic shadow pass) into ~10–18 `InstancedMesh` draws.
 */
import * as THREE from 'three';

/** Dedicated layer for source meshes currently drawn by an `InstancedMesh` batch. Kept off layer 0 (main/shadows). */
export const BATCHED_PROP_LAYER = 5;

const INITIAL_CAPACITY = 32;
/** Slightly above `MoonShadows`'s `DYNAMIC_HALF = 34` so nearby off-camera props still cast dynamic shadows. */
const SHADOW_KEEP_RADIUS = 38;

interface Bucket {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  castShadow: boolean;
  mesh: THREE.InstancedMesh;
  capacity: number;
  count: number;
  /** Number of consecutive frames this bucket had zero instances (for pruning stale LOD/material combos if needed). */
  idleFrames: number;
}

const _frustum = new THREE.Frustum();
const _projScreen = new THREE.Matrix4();
const _camPos = new THREE.Vector3();
const _sphere = new THREE.Sphere();

function isEffectivelyVisibleIn(obj: THREE.Object3D, root: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    if (!cur.visible) return false;
    if (cur === root) return true;
    cur = cur.parent;
  }
  return false;
}

export class PropBatcher {
  readonly group = new THREE.Group();
  private readonly sources: THREE.Mesh[] = [];
  private readonly registered = new WeakSet<THREE.Mesh>();
  private readonly buckets = new Map<number, Bucket>();
  private readonly activeBuckets: Bucket[] = [];

  constructor() {
    this.group.name = 'prop-batches';
    this.group.matrixAutoUpdate = false;
    this.group.updateMatrix();
  }

  /** Registers a bone-attached prop or armor plate mesh for automatic instanced batching when inside the world scene. */
  register(mesh: THREE.Mesh): void {
    if (this.registered.has(mesh)) return;
    this.registered.add(mesh);
    mesh.userData.autoBatch = true;
    this.sources.push(mesh);
  }

  /** Unregisters a disposed mesh so dynamic spawns (e.g. vehicles) never accumulate in `sources`. */
  unregister(mesh: THREE.Mesh): void {
    if (!this.registered.delete(mesh)) return;
    const idx = this.sources.indexOf(mesh);
    if (idx >= 0) {
      const last = this.sources.pop()!;
      if (idx < this.sources.length) this.sources[idx] = last;
    }
    if (!mesh.layers.isEnabled(0)) mesh.layers.set(0);
  }

  /**
   * Packs all visible registered meshes currently inside `scene` into per-(geometry, material, castShadow)
   * `InstancedMesh` buckets. Call right after `scene.updateMatrixWorld()` and before shadow/opaque passes.
   */
  sync(scene: THREE.Scene, camera: THREE.Camera): void {
    if (this.sources.length === 0) return;

    // Reset counts on previously active buckets.
    for (let i = 0; i < this.activeBuckets.length; i++) {
      this.activeBuckets[i]!.count = 0;
    }
    this.activeBuckets.length = 0;

    // Build frustum + camera world position once for per-instance culling.
    _projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_projScreen);
    _camPos.setFromMatrixPosition(camera.matrixWorld);

    const sources = this.sources;
    for (let i = 0; i < sources.length; i++) {
      const m = sources[i]!;
      const mat = m.material;
      // Only batch single opaque materials; leave anything else on layer 0 for normal rendering.
      if (Array.isArray(mat) || !mat || mat.transparent || !m.geometry) {
        if (!m.layers.isEnabled(0)) m.layers.set(0);
        continue;
      }

      if (!isEffectivelyVisibleIn(m, scene)) {
        // Restore layer 0 when detached from world scene (e.g. reused in a menu backdrop or cloned).
        if (!m.layers.isEnabled(0)) m.layers.set(0);
        continue;
      }

      // Suppress individual rendering on layer 0 (opaque + shadow) while leaving XRAY_LAYER (4) untouched.
      if (m.layers.isEnabled(0)) {
        m.layers.disable(0);
        m.layers.enable(BATCHED_PROP_LAYER);
      }

      // Per-instance frustum + shadow-range cull (skipped when frustumCulled=false, e.g. shader warm-up props).
      const g = m.geometry;
      if (m.frustumCulled) {
        if (!g.boundingSphere) g.computeBoundingSphere();
        const bs = g.boundingSphere;
        if (bs) {
          const te = m.matrixWorld.elements;
          // Max column length of upper 3x3 gives exact uniform/non-uniform scale bound.
          const sx2 = te[0]! * te[0]! + te[1]! * te[1]! + te[2]! * te[2]!;
          const sy2 = te[4]! * te[4]! + te[5]! * te[5]! + te[6]! * te[6]!;
          const sz2 = te[8]! * te[8]! + te[9]! * te[9]! + te[10]! * te[10]!;
          const maxScale = Math.sqrt(Math.max(sx2, sy2, sz2));
          const r = bs.radius * maxScale;
          const cx = te[0]! * bs.center.x + te[4]! * bs.center.y + te[8]! * bs.center.z + te[12]!;
          const cy = te[1]! * bs.center.x + te[5]! * bs.center.y + te[9]! * bs.center.z + te[13]!;
          const cz = te[2]! * bs.center.x + te[6]! * bs.center.y + te[10]! * bs.center.z + te[14]!;
          const dx = cx - _camPos.x;
          const dy = cy - _camPos.y;
          const dz = cz - _camPos.z;
          const shadowRange = SHADOW_KEEP_RADIUS + r;
          if (dx * dx + dy * dy + dz * dz > shadowRange * shadowRange) {
            _sphere.center.set(cx, cy, cz);
            _sphere.radius = r;
            if (!_frustum.intersectsSphere(_sphere)) continue;
          }
        }
      }

      const cast = m.castShadow;
      const key = g.id * 1048576 + mat.id * 2 + (cast ? 1 : 0);
      let bucket = this.buckets.get(key);
      if (!bucket) {
        bucket = this.createBucket(key, g, mat, cast);
      }
      if (bucket.count === 0) this.activeBuckets.push(bucket);
      if (bucket.count >= bucket.capacity) this.growBucket(bucket);

      const dst = bucket.mesh.instanceMatrix.array as Float32Array;
      const src = m.matrixWorld.elements;
      const off = bucket.count * 16;
      for (let k = 0; k < 16; k++) dst[off + k] = src[k]!;
      bucket.count++;
    }

    // Finalize every bucket: hide empty ones, upload only the populated slice for active ones.
    for (const bucket of this.buckets.values()) {
      if (bucket.count === 0) {
        bucket.mesh.count = 0;
        bucket.mesh.visible = false;
        bucket.idleFrames++;
      } else {
        bucket.idleFrames = 0;
        bucket.mesh.count = bucket.count;
        bucket.mesh.visible = true;
        bucket.mesh.instanceMatrix.clearUpdateRanges();
        bucket.mesh.instanceMatrix.addUpdateRange(0, bucket.count * 16);
        bucket.mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }

  private createBucket(key: number, geometry: THREE.BufferGeometry, material: THREE.Material, castShadow: boolean): Bucket {
    const capacity = INITIAL_CAPACITY;
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = 'prop-batch';
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.userData.dynamicShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(mesh);
    const bucket: Bucket = { geometry, material, castShadow, mesh, capacity, count: 0, idleFrames: 0 };
    this.buckets.set(key, bucket);
    return bucket;
  }

  private growBucket(bucket: Bucket): void {
    const nextCap = bucket.capacity * 2;
    const oldMesh = bucket.mesh;
    const nextMesh = new THREE.InstancedMesh(bucket.geometry, bucket.material, nextCap);
    nextMesh.name = 'prop-batch';
    nextMesh.count = bucket.count;
    nextMesh.visible = true;
    nextMesh.frustumCulled = false;
    nextMesh.castShadow = bucket.castShadow;
    nextMesh.receiveShadow = true;
    nextMesh.userData.dynamicShadow = true;
    nextMesh.matrixAutoUpdate = false;
    nextMesh.updateMatrix();
    nextMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    (nextMesh.instanceMatrix.array as Float32Array).set(
      (oldMesh.instanceMatrix.array as Float32Array).subarray(0, bucket.count * 16),
    );
    this.group.remove(oldMesh);
    oldMesh.dispose();
    this.group.add(nextMesh);
    bucket.mesh = nextMesh;
    bucket.capacity = nextCap;
  }

  dispose(): void {
    for (const bucket of this.buckets.values()) {
      this.group.remove(bucket.mesh);
      bucket.mesh.dispose();
    }
    this.buckets.clear();
    this.activeBuckets.length = 0;
  }
}
