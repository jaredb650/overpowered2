import * as THREE from 'three';

/**
 * Fixed-size ring of per-instance spawn records, one interleaved buffer per draw call.
 *
 * Emission writes one record at the head and marks it dirty; nothing touches a record again, because
 * motion is a closed-form function of (spawn data, time) evaluated in the vertex shader. A full ring
 * overwrites its oldest record, which is the oldest-out eviction the 30k budget depends on.
 */
export class InstanceRing<O extends THREE.Mesh | THREE.LineSegments = THREE.Mesh> {
  readonly stride: number;
  readonly data: Float32Array;
  readonly geometry: THREE.InstancedBufferGeometry;
  object!: O;

  /** Offset of the birth time and lifetime inside a record, for the live count. */
  birthAt = 3;
  lifeAt = 7;

  private readonly buffer: THREE.InstancedInterleavedBuffer;
  private head = 0;
  private high = 0;
  private lastDeath = -Infinity;
  private pendingStart = 0;
  private pendingCount = 0;

  constructor(base: THREE.BufferGeometry, readonly cap: number, attributes: readonly string[]) {
    this.stride = attributes.length * 4;
    this.data = new Float32Array(cap * this.stride);
    this.buffer = new THREE.InstancedInterleavedBuffer(this.data, this.stride, 1);
    this.buffer.setUsage(THREE.DynamicDrawUsage);

    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    for (const name of Object.keys(base.attributes)) g.setAttribute(name, base.attributes[name]!);
    attributes.forEach((name, i) => {
      g.setAttribute(name, new THREE.InterleavedBufferAttribute(this.buffer, 4, i * 4, false));
    });
    g.instanceCount = 0;
    this.geometry = g;
  }

  /** Reserves the next record and returns its float offset. `death` is on the ring's own clock. */
  alloc(death: number): number {
    const slot = this.head;
    this.head = slot + 1 === this.cap ? 0 : slot + 1;
    if (slot >= this.high) this.high = slot + 1;
    if (death > this.lastDeath) this.lastDeath = death;
    if (this.pendingCount === 0) this.pendingStart = slot;
    this.pendingCount++;
    return slot * this.stride;
  }

  /** Once per frame. Uploads only what was written and hides the draw call once everything is dead. */
  sync(now: number): void {
    const n = this.pendingCount;
    if (n > 0) {
      const b = this.buffer;
      const s = this.stride;
      if (n >= this.cap) {
        b.addUpdateRange(0, this.cap * s);
      } else {
        const start = this.pendingStart;
        const tail = Math.min(n, this.cap - start);
        b.addUpdateRange(start * s, tail * s);
        if (tail < n) b.addUpdateRange(0, (n - tail) * s);
      }
      b.needsUpdate = true;
      this.pendingCount = 0;
      this.geometry.instanceCount = this.high;
      this.object.visible = true;
    } else if (this.object.visible && now >= this.lastDeath) {
      this.object.visible = false;
      this.geometry.instanceCount = 0;
      this.head = 0;
      this.high = 0;
      this.lastDeath = -Infinity;
    }
  }

  /**
   * Draws the empty ring for one frame, so its program and GPU pipeline exist before anything needs them.
   * Record zero has no life, so the vertex shader throws it away and nothing shows.
   */
  warm(): void {
    if (this.high > 0) return;
    this.geometry.instanceCount = 1;
    this.object.visible = true;
  }

  /** Kills everything without a data upload: instanceCount 0 skips the draw and the next write starts over. */
  clear(): void {
    this.object.visible = false;
    this.geometry.instanceCount = 0;
    this.head = 0;
    this.high = 0;
    this.pendingCount = 0;
    this.lastDeath = -Infinity;
    this.buffer.clearUpdateRanges();
  }

  get active(): boolean {
    return this.object.visible;
  }

  /** Debug only: scans the ring. */
  countLive(now: number): number {
    let n = 0;
    const d = this.data;
    for (let i = 0, o = 0; i < this.high; i++, o += this.stride) {
      const age = now - d[o + this.birthAt]!;
      if (age >= 0 && age < d[o + this.lifeAt]!) n++;
    }
    return n;
  }
}
