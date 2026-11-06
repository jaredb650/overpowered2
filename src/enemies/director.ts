/**
 * The director keeps a crowd fair and readable. Every enemy could shoot at once; the director decides who may.
 *
 *  - Attack tokens cap how many enemies attack at the same moment, so damage arrives as hits you can read
 *    rather than a drizzle that drains health with no visible cause.
 *  - A volley gap spaces the start of ranged attacks. Two squads never fire on the same frame.
 *  - The line-of-sight budget caps raycasts per frame, however many enemies want one.
 */
import * as THREE from 'three';
import { clamp, TAU } from '../core/math';
import { GHOST_RANGE } from './behaviours';
import type { AttackToken } from './brain';
import type { Enemy } from './Enemy';
import type { AiWorld } from './aiWorld';

/** Raycasts per frame shared by all enemies. Each one costs a WASM crossing and allocations in the wrapper. */
const LOS_PER_FRAME = 8;
/** Enemies refresh sight at most this often, and a stale answer is fine for a few frames. */
const LOS_INTERVAL = 0.25;
/** Spacing between voices, so a crowd sounds like a crowd and not a choir. */
const BARK_GAP = 0.45;

export interface Squad {
  id: number;
  size: number;
  /** Bearing around the player the squad approaches on. Members fan out from here. */
  bearing: number;
}

export class Director {
  rangedLimit = 1;
  meleeLimit = 2;
  /** Multiplies wind-up time for attacks the player cannot see. */
  offscreenWindup = 1.35;
  private rangedHeld = 0;
  private meleeHeld = 0;
  private nextVolleyAt = 0;
  private nextSwingAt = 0;
  private nextBarkAt = 0;
  private volleyGap = 1.7;
  private swingGap = 0.95;
  private losLeft = LOS_PER_FRAME;
  private losCursor = 0;
  private squadId = 0;
  private readonly from = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();

  constructor(private readonly w: AiWorld) {}

  reset(): void {
    this.rangedHeld = this.meleeHeld = 0;
    this.nextVolleyAt = this.nextSwingAt = this.nextBarkAt = 0;
    this.setWave(1);
  }

  /** Later waves get more simultaneous attackers. This, more than raw damage, is what makes them lethal. */
  setWave(wave: number): void {
    this.rangedLimit = clamp(1 + Math.floor(wave / 2), 1, 9);
    this.meleeLimit = clamp(2 + Math.floor(wave / 2), 2, 7);
    // Measured from the start of one burst to the next, so this, not the token count, is what limits early fire: a
    // token frees the moment a burst ends and another shooter takes it at once.
    this.volleyGap = clamp(1.95 - wave * 0.26, 0.14, 1.7);
    this.swingGap = clamp(1.02 - wave * 0.07, 0.22, 0.95);
  }

  acquire(e: Enemy, token: AttackToken): boolean {
    if (token === 'ranged') {
      if (e.holdsRanged) return true;
      if (this.rangedHeld >= this.rangedLimit || this.w.now < this.nextVolleyAt) return false;
      this.rangedHeld++;
      this.nextVolleyAt = this.w.now + this.volleyGap;
      e.holdsRanged = true;
      return true;
    }
    if (token === 'melee') {
      if (e.holdsMelee) return true;
      // The slot frees the moment a swing ends, so a crowd would otherwise chain hits with no gap between them.
      if (this.meleeHeld >= this.meleeLimit || this.w.now < this.nextSwingAt) return false;
      this.meleeHeld++;
      this.nextSwingAt = this.w.now + this.swingGap;
      e.holdsMelee = true;
      return true;
    }
    return true;
  }

  release(e: Enemy, token: AttackToken): void {
    if (token === 'ranged' && e.holdsRanged) {
      e.holdsRanged = false;
      this.rangedHeld--;
    } else if (token === 'melee' && e.holdsMelee) {
      e.holdsMelee = false;
      this.meleeHeld--;
    }
  }

  releaseAll(e: Enemy): void {
    this.release(e, 'ranged');
    this.release(e, 'melee');
  }

  /** True when another enemy could step in. Melee waiters circle instead of stacking on the player. */
  get meleeFree(): boolean {
    return this.meleeHeld < this.meleeLimit;
  }

  makeSquad(size: number, bearing: number): Squad {
    return { id: ++this.squadId, size, bearing };
  }

  /** Fans squad members around the bearing they arrive on, then flank sides alternate. */
  joinSquad(e: Enemy, squad: Squad, index: number): void {
    e.squad = squad;
    e.side = index % 2 === 0 ? 1 : -1;
    const fan = Math.ceil(index / 2) * 0.45 * e.side;
    e.slotAngle = (squad.bearing + fan + TAU) % TAU;
  }

  beginFrame(): void {
    this.losLeft = LOS_PER_FRAME;
  }

  /** Spends the frame's sight budget round-robin, nearest stale enemies first in practice because of think rates. */
  updateSight(alive: readonly Enemy[]): void {
    const n = alive.length;
    if (n === 0) return;
    const now = this.w.now;
    for (let i = 0; i < n && this.losLeft > 0; i++) {
      this.losCursor = (this.losCursor + 1) % n;
      const e = alive[this.losCursor]!;
      if (now - e.losAt < LOS_INTERVAL * (e.lod + 1)) continue;
      this.losLeft--;
      e.losAt = now;
      e.hasLos = this.hasSight(e);
    }
  }

  /** Eye to eye. Also used by cover search with a different origin. */
  hasSight(e: Enemy): boolean {
    if (this.w.player.ghost && e.dist > GHOST_RANGE) return false;
    this.from.copy(e.position);
    // Hanging on a wall its head is level with its hands, not a standing height above them.
    this.from.y += e.pinned ? 0.5 : e.def.eyeHeight;
    return this.clearLine(this.from, this.w.player.eye);
  }

  clearLine(a: THREE.Vector3, b: THREE.Vector3): boolean {
    this.dir.subVectors(b, a);
    const d = this.dir.length();
    if (d < 0.01) return true;
    this.dir.multiplyScalar(1 / d);
    return this.w.ctx.physics.raycast(a, this.dir, d - 0.1) === null;
  }

  spendBark(): boolean {
    if (this.w.now < this.nextBarkAt) return false;
    this.nextBarkAt = this.w.now + BARK_GAP;
    return true;
  }

  /** Spends budget for a one-off query. Callers must cope with false by trying again next tick. */
  spendRay(): boolean {
    if (this.losLeft <= 0) return false;
    this.losLeft--;
    return true;
  }
}
