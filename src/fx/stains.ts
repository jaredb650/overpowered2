import * as THREE from 'three';
import type { DecalSystem } from '../core/contracts';
import type { Landing } from './layers/blood';

const CAP = 192;

/** Decal size against a strand's half width. The blot fills about a third of its quad. */
export const STAIN_SCALE = 13;

interface Stain {
  at: number;
  live: boolean;
  position: THREE.Vector3;
  normal: THREE.Vector3;
  velocity: THREE.Vector3;
  size: number;
}

/**
 * Stains waiting for the drop that will make them. A strand's whole flight is worked out when it is
 * emitted, so where it lands, how fast and at what angle are already known, and the decal goes down on
 * the frame the drop arrives. What you see land is what leaves the mark, for one ray per burst.
 */
export class StainQueue {
  private readonly stains: Stain[] = [];
  private head = 0;
  private booked = 0;

  constructor() {
    for (let i = 0; i < CAP; i++) {
      this.stains.push({ at: 0, live: false, position: new THREE.Vector3(), normal: new THREE.Vector3(), velocity: new THREE.Vector3(), size: 0 });
    }
  }

  /** Oldest-out. A strand that ran out of life in the air leaves nothing. */
  book(at: number, l: Landing, size: number): void {
    if (l.nx === 0 && l.ny === 0 && l.nz === 0) return;
    const s = this.stains[this.head]!;
    this.head = (this.head + 1) % CAP;
    if (!s.live) this.booked++;
    s.at = at;
    s.live = true;
    s.position.set(l.x, l.y, l.z);
    s.normal.set(l.nx, l.ny, l.nz);
    s.velocity.set(l.vx, l.vy, l.vz);
    s.size = size;
  }

  run(now: number, decals: DecalSystem): void {
    if (this.booked === 0) return;
    for (let i = 0; i < CAP; i++) {
      const s = this.stains[i]!;
      if (!s.live || now < s.at) continue;
      s.live = false;
      this.booked--;
      decals.splat(s.position, s.normal, s.size, s.velocity);
    }
  }

  clear(): void {
    for (const s of this.stains) s.live = false;
    this.booked = 0;
  }
}
