/**
 * Where the Commander's men stand. Everything is chosen from what the map already knows: cover spots, doors and gates, with real rays
 * to confirm a line, a few at a time, because these run when a man needs a post and not on a clock.
 */
import * as THREE from 'three';
import { rand, TAU } from '../../core/math';
import type { CoverSpot } from '../outpost/cover';
import type { Door } from '../outpost/squad';
import type { Commander } from './index';

/** Spots tried per request. Each costs a ray at most. */
const TRIES = 36;
const EYE = 1.6;

const _eye = new THREE.Vector3();
const _to = new THREE.Vector3();
const _d = new THREE.Vector3();

export class Posts {
  private readonly candidates: CoverSpot[] = [];

  constructor(private readonly c: Commander) {}

  /**
   * A spot with a clear line on `target`, a long way off, and behind where the player is facing if there is one. `high` prefers
   * height, which on this map is what sees into a roofless room.
   */
  overwatch(target: THREE.Vector3, near: number, far: number, high: boolean, out: THREE.Vector3): boolean {
    const { w } = this.c;
    const n = this.sample(target, near, far);
    _to.copy(target);
    _to.y += 1.4;
    const fwd = w.player.forward;
    let best = -Infinity;
    let found = false;
    for (let i = 0; i < n; i++) {
      const p = this.candidates[i]!.position;
      _eye.copy(p);
      _eye.y += EYE;
      if (!w.director.clearLine(_eye, _to)) continue;
      _d.subVectors(p, target).setY(0).normalize();
      // Behind the player scores up to 10. An angle they are not watching is the whole of the idea.
      const score = -_d.dot(fwd) * 10 + p.y * (high ? 2.5 : 1) + rand(0, 3);
      if (score > best) {
        best = score;
        out.copy(p);
        found = true;
      }
    }
    return found;
  }

  /** Fills `candidates` with an even pick of free spots in the band. Arithmetic over the list, so only the picks cost a ray. */
  private sample(target: THREE.Vector3, near: number, far: number): number {
    const { spots } = this.c.o.cover;
    const near2 = near * near;
    const far2 = far * far;
    let seen = 0;
    for (const spot of spots) {
      if (spot.claimedBy !== 0) continue;
      const d2 = spot.position.distanceToSquared(target);
      if (d2 < near2 || d2 > far2) continue;
      seen++;
      if (seen <= TRIES) this.candidates[seen - 1] = spot;
      else {
        const slot = Math.floor(Math.random() * seen);
        if (slot < TRIES) this.candidates[slot] = spot;
      }
    }
    return Math.min(seen, TRIES);
  }

  /** The cover spot nearest `min` metres from the player and past it, inside the walls. */
  farRoom(min: number, out: THREE.Vector3): boolean {
    const { w, o } = this.c;
    const spots = o.cover.spots;
    if (spots.length === 0) return false;
    const p = w.player.position;
    let best = Infinity;
    for (let i = 0; i < TRIES * 2; i++) {
      const spot = spots[Math.floor(Math.random() * spots.length)]!;
      const q = spot.position;
      if (spot.claimedBy !== 0 || q.y > 2 || Math.max(Math.abs(q.x), Math.abs(q.z)) > 26) continue;
      const dist = q.distanceTo(p);
      if (dist < min) continue;
      if (dist < best) {
        best = dist;
        out.copy(q);
      }
    }
    return best < Infinity;
  }

  /** A hot door, and a place beside it on the far side. `seat` spreads a squad either side of the frame. */
  ambush(seat: number, out: THREE.Vector3): boolean {
    const { o, tracker, w } = this.c;
    const hot = tracker.hotDoors(3);
    const door = o.doors[hot[Math.min(hot.length - 1, seat % Math.max(hot.length, 1))] ?? Math.floor(Math.random() * o.doors.length)];
    if (!door) return false;
    // Whichever side of it the player is not on.
    const side = (w.player.position.x - door.x) * door.dx + (w.player.position.z - door.z) * door.dz > 0 ? -1 : 1;
    const flank = seat % 2 === 0 ? 1 : -1;
    const across = door.w / 2 + 1.4 + (seat >> 1) * 1.2;
    _d.set(door.x + door.dx * side * 2.2 - door.dz * flank * across, 0.2, door.z + door.dz * side * 2.2 + door.dx * flank * across);
    return w.ctx.world.nav.nearest(_d, 3.5, out);
  }

  /** Somewhere to watch a door from, and the point on it to watch. */
  lane(seat: number, watch: THREE.Vector3, out: THREE.Vector3): boolean {
    const { o, tracker, w } = this.c;
    const hot = tracker.hotDoors(1);
    const door = o.doors[hot[0] ?? 0];
    if (!door) return false;
    watch.set(door.x, 1.2, door.z);
    const spots = o.cover.spots;
    const reach = seat % 2 === 0 ? 1 : -1;
    let best = Infinity;
    for (let i = 0; i < TRIES; i++) {
      const spot = spots[Math.floor(Math.random() * spots.length)]!;
      const q = spot.position;
      const dist = q.distanceTo(watch);
      if (spot.claimedBy !== 0 || dist < 9 || dist > 30) continue;
      // Two men on opposite sides of the door make a crossfire. Two on the same side make a queue.
      if (((q.x - door.x) * door.dz - (q.z - door.z) * door.dx) * reach < 0) continue;
      _eye.copy(q);
      _eye.y += EYE;
      if (!w.director.clearLine(_eye, watch)) continue;
      if (dist < best) {
        best = dist;
        out.copy(q);
      }
    }
    return best < Infinity;
  }

  /** Open floor near the player, in plain view, where a man has no business standing. */
  openGround(seat: number, out: THREE.Vector3): boolean {
    const { w } = this.c;
    const p = w.player.position;
    const a = rand(0, TAU);
    _d.set(p.x + Math.sin(a) * 24 + (seat - 1) * 2.4, 0.2, p.z + Math.cos(a) * 24);
    return w.ctx.world.nav.nearest(_d, 9, out);
  }

  /** Floor under a door's centre. */
  doorFloor(door: Door, out: THREE.Vector3): boolean {
    _d.set(door.x, 0.2, door.z);
    return this.c.w.ctx.world.nav.nearest(_d, 2.5, out);
  }
}
