import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CG, type Ctx } from '../../core/contracts';

const LOOSE_BODIES = (0xffff << 16) | (CG.Ragdoll | CG.Gib | CG.Debris);
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

/**
 * Corpses, limbs and debris inside a ball, handed back as a list. Rapier silently drops an impulse applied from inside
 * its own query callback, so anything that pushes bodies must collect them first and push after the query returns.
 *
 * Corpses at rest have no rigid body at all. `wake` is the only way to reach them: gore answers a radial impulse by
 * waking what it can afford to simulate, and from the next step on they show up here.
 */
export class BodyQuery {
  readonly found: RAPIER.RigidBody[] = [];
  private readonly seen = new Set<number>();
  private readonly ball: RAPIER.Ball;
  private readonly collect = (collider: RAPIER.Collider): boolean => {
    const body = collider.parent();
    if (body && body.isDynamic() && !this.seen.has(body.handle)) {
      this.seen.add(body.handle);
      this.found.push(body);
    }
    return true;
  };

  constructor(private readonly ctx: Ctx) {
    this.ball = new ctx.physics.R.Ball(1);
  }

  /** Fills `found`. A body with several colliders is listed once. */
  run(center: THREE.Vector3, radius: number): readonly RAPIER.RigidBody[] {
    this.found.length = 0;
    this.seen.clear();
    this.ball.radius = radius;
    this.ctx.physics.world.intersectionsWithShape(center, IDENTITY, this.ball, this.collect, undefined, LOOSE_BODIES);
    return this.found;
  }

  /** Stirs resting corpses in the ball. `strength` below zero leans them toward the centre. */
  wake(center: THREE.Vector3, radius: number, strength: number): void {
    this.ctx.physics.radialImpulse(center, radius, strength);
  }
}
