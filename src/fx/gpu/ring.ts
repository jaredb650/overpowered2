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

  readonly deaths: Float64Array;
  readonly orderIndependent: boolean;

  private readonly buffer: THREE.InstancedInterleavedBuffer;
  private head = 0;
  private high = 0;
  private lastDeath = -Infinity;
  private pendingStart = 0;
  private pendingCount = 0;

  constructor(
    base: THREE.BufferGeometry,
    readonly cap: number,
    attributes: readonly string[],
    orderIndependent = false,
  ) {
    this.stride = attributes.length * 4;
    this.data = new Float32Array(cap * this.stride);
    this.deaths = new Float64Array(cap);
    this.deaths.fill(-Infinity);
    this.orderIndependent = orderIndependent;
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
    this.deaths[slot] = death;
    if (death > this.lastDeath) this.lastDeath = death;
    if (this.pendingCount === 0) this.pendingStart = slot;
    this.pendingCount++;
    return slot * this.stride;
  }

  /** Once per frame. Uploads only what was written, trims/compacts dead slots, and hides when empty. */
  sync(now: number): void {
    const n = this.pendingCount;
    const b = this.buffer;
    const s = this.stride;
    const deaths = this.deaths;

    // Trim trailing dead slots for every ring (preserves draw order for order-dependent layers).
    let high = this.high;
    while (high > 0 && deaths[high - 1]! <= now) high--;

    // For additive/opaque order-independent layers, swap-compact dead holes with the live tail.
    let compactMin = this.cap;
    let compactMax = -1;
    if (this.orderIndependent && high > 1) {
      const data = this.data;
      let i = 0;
      while (i < high) {
        if (deaths[i]! <= now) {
          const last = high - 1;
          if (i < last) {
            data.copyWithin(i * s, last * s, (last + 1) * s);
            deaths[i] = deaths[last]!;
            deaths[last] = -Infinity;
            if (i < compactMin) compactMin = i;
            if (i > compactMax) compactMax = i;
          }
          high--;
          while (high > i && deaths[high - 1]! <= now) high--;
        }
        i++;
      }
      this.head = high === this.cap ? 0 : high;
    } else if (this.head > high) {
      // Slots [high .. oldHigh) are all dead; pull head back to avoid leaving dead gaps.
      this.head = high;
    }

    this.high = high;

    if (high === 0) {
      this.pendingCount = 0;
      if (this.object.visible && now >= this.lastDeath) {
        this.object.visible = false;
        this.geometry.instanceCount = 0;
        this.head = 0;
        this.lastDeath = -Infinity;
        b.clearUpdateRanges();
      } else if (n > 0) {
        this.object.visible = false;
        this.geometry.instanceCount = 0;
        this.head = 0;
        this.lastDeath = -Infinity;
        b.clearUpdateRanges();
      }
      return;
    }

    const hasCompact = compactMax >= compactMin;
    if (n > 0 || hasCompact) {
      b.clearUpdateRanges();
      if (n >= this.cap) {
        b.addUpdateRange(0, high * s);
      } else {
        if (n > 0) {
          const start = this.pendingStart;
          const tail = Math.min(n, this.cap - start);
          const tailEnd = Math.min(start + tail, high);
          if (tailEnd > start) b.addUpdateRange(start * s, (tailEnd - start) * s);
          if (tail < n) {
            const wrapCount = Math.min(n - tail, high);
            if (wrapCount > 0) b.addUpdateRange(0, wrapCount * s);
          }
        }
        if (hasCompact) {
          b.addUpdateRange(compactMin * s, (compactMax - compactMin + 1) * s);
        }
      }
      b.needsUpdate = true;
      this.pendingCount = 0;
    }

    this.geometry.instanceCount = high;
    this.object.visible = true;
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
    this.deaths.fill(-Infinity);
    this.buffer.clearUpdateRanges();
  }

  get active(): boolean {
    return this.object.visible;
  }

  get highCount(): number {
    return this.high;
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
