/**
 * Rapier wrapper. All rigid-body work (ragdolls, gibs, debris) and all world queries go through here.
 *
 * Stepping: the world follows ctx.time.dt, so slow-mo slows physics down. The timestep is set from the
 * accumulated world time instead of a fixed 1/60, which keeps motion smooth at 25% speed.
 */
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CG, type Ctx, type PhysicsSystem, type RayHit, type SurfaceKind } from '../core/contracts';

/** Rapier group word: memberships in the high 16 bits, filter in the low 16 bits. */
export const groups = (membership: number, filter: number): number => ((membership & 0xffff) << 16) | (filter & 0xffff);
/** Filter word for a query that should hit everything in `mask`. */
const queryGroups = (mask: number): number => groups(0xffff, mask);

/** A body with this as its userData is thrown by whoever owns it, from `radialListeners`. radialImpulse skips it. */
export const OWN_BLAST = { ownBlast: true };

const MAX_STEP = 1 / 60;
const MIN_STEP = 1 / 240;
const MAX_SUBSTEPS = 4;
export const GRAVITY = -19;

export class Physics implements PhysicsSystem {
  readonly R = RAPIER;
  world!: RAPIER.World;
  /** Run before every sub-step, with the timestep. Used for ragdoll joint limits. */
  readonly preStep = new Set<(dt: number) => void>();

  /** Told about every radialImpulse before it is applied, so frozen corpses can wake and take it. */
  readonly radialListeners = new Set<(center: THREE.Vector3, radius: number, strength: number) => void>();
  /** Wall time of the last step(), for budget checks. Never feeds gameplay. */
  stepMs = 0;

  private surfaces = new Map<number, SurfaceKind>();
  private accumulator = 0;
  private ray!: RAPIER.Ray;
  private capsules = new Map<string, RAPIER.Capsule>();
  private readonly identity = { x: 0, y: 0, z: 0, w: 1 };
  private readonly hitPoint = new THREE.Vector3();
  private readonly radialSeen = new Set<number>();
  private readonly radialVec = new THREE.Vector3();
  private readonly radialT = { x: 0, y: 0, z: 0 };
  private anchor: RAPIER.RigidBody | null = null;

  /** Must finish before any other physics call. */
  static async create(): Promise<Physics> {
    await RAPIER.init();
    const p = new Physics();
    p.world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    p.world.numSolverIterations = 4;
    p.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    return p;
  }

  init(_ctx: Ctx): void {}

  /** A fixed body at the origin, so a world-anchored joint can give its anchor in world coordinates. */
  get anchorBody(): RAPIER.RigidBody {
    return (this.anchor ??= this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed()));
  }

  step(dt: number): void {
    this.accumulator += dt;
    if (this.accumulator < MIN_STEP) return;
    const started = performance.now();
    const substeps = Math.min(MAX_SUBSTEPS, Math.ceil(this.accumulator / MAX_STEP));
    const h = Math.min(this.accumulator / substeps, MAX_STEP);
    this.world.timestep = h;
    for (let i = 0; i < substeps; i++) {
      for (const hook of this.preStep) hook(h);
      this.world.step();
    }
    this.accumulator = 0;
    this.stepMs = performance.now() - started;
  }

  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, mask: number = CG.World): RayHit | null {
    this.ray.origin = origin;
    this.ray.dir = dir;
    const hit = this.world.castRayAndGetNormal(this.ray, maxDist, true, undefined, queryGroups(mask));
    if (!hit) return null;
    const distance = hit.timeOfImpact;
    return {
      point: new THREE.Vector3().copy(origin).addScaledVector(dir, distance),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      distance,
      surface: this.surfaceOf(hit.collider),
      collider: hit.collider,
    };
  }

  raycastInto(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, mask: number, out: RayHit): boolean {
    this.ray.origin = origin;
    this.ray.dir = dir;
    const hit = this.world.castRayAndGetNormal(this.ray, maxDist, true, undefined, queryGroups(mask));
    if (!hit) return false;
    const distance = hit.timeOfImpact;
    out.point.copy(origin).addScaledVector(dir, distance);
    out.normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
    out.distance = distance;
    out.surface = this.surfaceOf(hit.collider);
    out.collider = hit.collider;
    return true;
  }

  private capsule(radius: number, halfHeight: number): RAPIER.Capsule {
    const key = `${radius}:${halfHeight}`;
    let shape = this.capsules.get(key);
    if (!shape) this.capsules.set(key, (shape = new RAPIER.Capsule(halfHeight, radius)));
    return shape;
  }

  sweepCapsule(
    from: THREE.Vector3, radius: number, halfHeight: number, motion: THREE.Vector3, mask: number = CG.World,
  ): { fraction: number; point: THREE.Vector3; normal: THREE.Vector3; collider: RAPIER.Collider } | null {
    const hit = this.world.castShape(
      from, this.identity, motion, this.capsule(radius, halfHeight), 0, 1, true, undefined, queryGroups(mask),
    );
    if (!hit) return null;
    // World.castShape reports witness1/normal1 on the hit collider, in world space.
    return {
      fraction: hit.time_of_impact,
      point: this.hitPoint.set(hit.witness1.x, hit.witness1.y, hit.witness1.z).clone(),
      normal: new THREE.Vector3(hit.normal1.x, hit.normal1.y, hit.normal1.z),
      collider: hit.collider,
    };
  }

  overlapCapsule(center: THREE.Vector3, radius: number, halfHeight: number, mask: number = CG.World): boolean {
    return (
      this.world.intersectionWithShape(center, this.identity, this.capsule(radius, halfHeight), undefined, queryGroups(mask)) !== null
    );
  }

  addStaticBox(center: THREE.Vector3, halfExtents: THREE.Vector3, rotation: THREE.Quaternion | null, surface: SurfaceKind): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
      .setTranslation(center.x, center.y, center.z)
      .setCollisionGroups(groups(CG.World, 0xffff))
      .setFriction(0.8);
    if (rotation) desc.setRotation(rotation);
    return this.register(this.world.createCollider(desc), surface);
  }

  addStaticMesh(vertices: Float32Array, indices: Uint32Array, surface: SurfaceKind): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.trimesh(vertices, indices)
      .setCollisionGroups(groups(CG.World, 0xffff))
      .setFriction(0.8);
    return this.register(this.world.createCollider(desc), surface);
  }

  /** Records a surface kind for a collider made outside this class. */
  register(collider: RAPIER.Collider, surface: SurfaceKind): RAPIER.Collider {
    this.surfaces.set(collider.handle, surface);
    return collider;
  }

  surfaceOf(collider: RAPIER.Collider): SurfaceKind {
    return this.surfaces.get(collider.handle) ?? 'concrete';
  }

  /** Call after creating static geometry so queries see it before the first step. */
  flushQueries(): void {
    this.world.timestep = MIN_STEP;
    this.world.step();
  }

  radialImpulse(center: THREE.Vector3, radius: number, strength: number): void {
    for (const listener of this.radialListeners) listener(center, radius, strength);
    const ball = new RAPIER.Ball(radius);
    const seen = this.radialSeen;
    seen.clear();
    const mask = CG.Ragdoll | CG.Gib | CG.Debris;
    const impulse = this.radialVec;
    const scratch = this.radialT;
    this.world.intersectionsWithShape(center, this.identity, ball, collider => {
      const body = collider.parent();
      if (!body || seen.has(body.handle) || !body.isDynamic() || body.userData === OWN_BLAST) return true;
      seen.add(body.handle);
      const t = body.translation(scratch);
      impulse.set(t.x - center.x, t.y - center.y + 0.5, t.z - center.z);
      const d = impulse.length();
      const falloff = Math.max(0, 1 - d / radius);
      impulse.multiplyScalar((strength * falloff) / Math.max(d, 0.2));
      body.applyImpulse(impulse, true);
      return true;
    }, undefined, queryGroups(mask));
  }
}
