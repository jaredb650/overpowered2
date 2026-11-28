/**
 * Fleeing civilian crowd pool for Deprecation (`Form 7742-A`, Grand Boulevard & Intersection).
 *
 * - Strictly capped pool of up to 24 lightweight procedural human silhouettes in muted office
 *   attire (trench coats, slacks, briefcases — visually distinct from dark armored troopers).
 * - Zero NavGraph queries, zero Rapier colliders, zero Ragdoll overhead: pure waypoint sprint
 *   along Grand Boulevard sidewalks toward glowing green `SUBWAY` shelter exits with `sin`
 *   limb-swing stride animation.
 * - `reactToBlast(pos, radius)` (also wired to `world:explosion`) causes nearby civilians to
 *   duck/flinch briefly and sprint faster toward shelter.
 * - Strictly non-combatant: never targeted by enemies, never increments kill or score counters,
 *   and cleanly recycles upon descending into a subway stairwell.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import { clamp } from '../../core/math';

export type Vec3Like = THREE.Vector3 | readonly [number, number, number];

export const MAX_CIVILIANS = 24;

export interface CivilianRouteDef {
  readonly id: string;
  /** Ordered sidewalk waypoints ending at or leading into the subway shelter entrance. */
  readonly waypoints: readonly Vec3Like[];
  /** Optional glowing green subway exit beacon location (defaults to the final waypoint). */
  readonly subwayExit?: Vec3Like;
}

export interface CivilianCrowdConfig {
  readonly routes: readonly CivilianRouteDef[];
  /** Number of pooled civilians to spawn (clamped to `0..MAX_CIVILIANS`, default `24`). */
  readonly count?: number;
  /** Base jogging/running speed in m/s (default `4.6`). */
  readonly baseSpeed?: number;
  /** Speed multiplier while panicked after a nearby blast/beam/collapse (default `1.6`). */
  readonly panicSpeedMult?: number;
  /** Minimum reaction radius in meters for `reactToBlast` (default `28`). */
  readonly panicRadius?: number;
  /** Duration in seconds of panicked sprint after a nearby blast (default `4.5`). */
  readonly panicDuration?: number;
  /** Duration in seconds of the initial crouch/duck flinch at blast onset (default `0.45`). */
  readonly duckDuration?: number;
  /** Automatically subscribe to `ctx.events.on('world:explosion', ...)` (default `true`). */
  readonly autoListenExplosions?: boolean;
  /** Whether the crowd starts active immediately (default `true`). */
  readonly autoStart?: boolean;
  /** Optional callback fired when a civilian safely reaches a subway exit and recycles. */
  readonly onRecycle?: (routeId: string, recycledTotal: number) => void;
}

export interface CivilianSnapshot {
  readonly index: number;
  readonly active: boolean;
  readonly routeId: string;
  readonly waypointIndex: number;
  readonly position: THREE.Vector3;
  readonly speed: number;
  readonly panicked: boolean;
  readonly ducking: boolean;
  readonly stridePhase: number;
}

export const CIVILIAN_DEFAULTS = {
  baseSpeed: 4.6,
  panicSpeedMult: 1.6,
  panicRadius: 28,
  panicDuration: 4.5,
  duckDuration: 0.45,
  waypointReachDist: 0.9,
} as const;

/** Muted office-attire coat palette (distinct from dark-armored corporate troopers). */
const COAT_COLORS = [0x8f8a7e, 0x4b5c6b, 0xa89b84, 0x6f5358, 0x5c665d, 0x7a7670] as const;

function toVec3(v: Vec3Like, out: THREE.Vector3): THREE.Vector3 {
  if (v instanceof THREE.Vector3) return out.copy(v);
  return out.set(v[0], v[1], v[2]);
}

interface ParsedRoute {
  readonly id: string;
  readonly waypoints: readonly THREE.Vector3[];
  readonly subwayExit: THREE.Vector3;
}

interface CivilianVisualRig {
  root: THREE.Group;
  body: THREE.Group;
  leftArm: THREE.Mesh;
  rightArm: THREE.Group;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
}

interface CivilianAgent {
  readonly index: number;
  active: boolean;
  routeIndex: number;
  waypointIndex: number;
  readonly position: THREE.Vector3;
  yaw: number;
  readonly personalSpeedFactor: number;
  currentSpeed: number;
  stridePhase: number;
  panicRemaining: number;
  duckRemaining: number;
  readonly lateralOffset: number;
  rig: CivilianVisualRig | null;
}

export class CivilianCrowd {
  readonly maxCount: number;

  private readonly routes: ParsedRoute[] = [];
  private readonly agents: CivilianAgent[] = [];
  private readonly baseSpeed: number;
  private readonly panicSpeedMult: number;
  private readonly panicRadius: number;
  private readonly panicDuration: number;
  private readonly duckDuration: number;
  private readonly onRecycleCb?: (routeId: string, recycledTotal: number) => void;

  private running = false;
  private _recycledCount = 0;
  private nextRouteCursor = 0;

  private sceneRoot: THREE.Group | null = null;
  private readonly sharedGeos: THREE.BufferGeometry[] = [];
  private readonly sharedMats: THREE.Material[] = [];
  private readonly unsubs: (() => void)[] = [];
  private disposed = false;

  constructor(private readonly ctx: Ctx, config: CivilianCrowdConfig) {
    this.baseSpeed = config.baseSpeed ?? CIVILIAN_DEFAULTS.baseSpeed;
    this.panicSpeedMult = config.panicSpeedMult ?? CIVILIAN_DEFAULTS.panicSpeedMult;
    this.panicRadius = config.panicRadius ?? CIVILIAN_DEFAULTS.panicRadius;
    this.panicDuration = config.panicDuration ?? CIVILIAN_DEFAULTS.panicDuration;
    this.duckDuration = config.duckDuration ?? CIVILIAN_DEFAULTS.duckDuration;
    this.onRecycleCb = config.onRecycle;

    for (const r of config.routes) {
      if (r.waypoints.length < 2) continue;
      const waypoints = r.waypoints.map(w => toVec3(w, new THREE.Vector3()));
      const subwayExit = r.subwayExit
        ? toVec3(r.subwayExit, new THREE.Vector3())
        : waypoints[waypoints.length - 1]!.clone();
      this.routes.push({ id: r.id, waypoints, subwayExit });
    }

    const requested = config.count ?? MAX_CIVILIANS;
    this.maxCount = this.routes.length > 0 ? clamp(Math.floor(requested), 0, MAX_CIVILIANS) : 0;

    this.buildSceneResources();
    this.initPool();

    if (config.autoListenExplosions !== false && ctx.events?.on) {
      this.unsubs.push(
        ctx.events.on('world:explosion', ev => {
          this.reactToBlast(ev.position, ev.radius);
        }),
      );
    }

    if (config.autoStart !== false && this.maxCount > 0) {
      this.start();
    }
  }

  /** Number of currently active running civilians (`<= 24`). */
  get activeCount(): number {
    let n = 0;
    for (let i = 0; i < this.agents.length; i++) {
      if (this.agents[i]!.active) n++;
    }
    return n;
  }

  /** Number of civilians currently in panicked sprint mode. */
  get panickedCount(): number {
    let n = 0;
    for (let i = 0; i < this.agents.length; i++) {
      if (this.agents[i]!.active && this.agents[i]!.panicRemaining > 0) n++;
    }
    return n;
  }

  /** Total civilians that have safely entered subway shelter exits and recycled. */
  get recycledCount(): number {
    return this._recycledCount;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Read-only snapshots of all pooled civilians for diagnostics & testing. */
  getSnapshots(): CivilianSnapshot[] {
    return this.agents.map(a => ({
      index: a.index,
      active: a.active,
      routeId: this.routes[a.routeIndex]?.id ?? '',
      waypointIndex: a.waypointIndex,
      position: a.position.clone(),
      speed: a.currentSpeed,
      panicked: a.panicRemaining > 0,
      ducking: a.duckRemaining > 0,
      stridePhase: a.stridePhase,
    }));
  }

  /** Activates the crowd runners along Grand Boulevard sidewalks. */
  start(): void {
    if (this.disposed || this.routes.length === 0) return;
    this.running = true;
    for (const a of this.agents) {
      a.active = true;
      if (a.rig) a.rig.root.visible = true;
    }
    if (this.sceneRoot) this.sceneRoot.visible = true;
  }

  /** Hides and pauses the crowd runners without destroying the pool. */
  stop(): void {
    this.running = false;
    for (const a of this.agents) {
      a.active = false;
      if (a.rig) a.rig.root.visible = false;
    }
    if (this.sceneRoot) this.sceneRoot.visible = false;
  }

  /**
   * Triggers panic, brief crouch-duck flinch, and sprint acceleration on all civilians within
   * `Math.max(radius, panicRadius)` meters of a blast, ORION thermal beam, or building collapse.
   * Returns the number of civilians startled.
   */
  reactToBlast(pos: Vec3Like, radius = 0): number {
    if (this.disposed || !this.running) return 0;
    const bx = pos instanceof THREE.Vector3 ? pos.x : pos[0];
    const by = pos instanceof THREE.Vector3 ? pos.y : pos[1];
    const bz = pos instanceof THREE.Vector3 ? pos.z : pos[2];
    const reach = Math.max(radius, this.panicRadius);
    const reachSq = reach * reach;

    let startled = 0;
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i]!;
      if (!a.active) continue;
      const dx = a.position.x - bx;
      const dy = a.position.y - by;
      const dz = a.position.z - bz;
      if (dx * dx + dy * dy + dz * dz > reachSq) continue;

      a.panicRemaining = Math.max(a.panicRemaining, this.panicDuration);
      a.duckRemaining = Math.max(a.duckRemaining, this.duckDuration);
      startled++;
    }
    return startled;
  }

  /** Advances waypoint sprint, limb-swing animation, panic timers, and safe subway exit recycling. */
  update(dt: number): void {
    if (this.disposed || !this.running || dt <= 0 || this.routes.length === 0) return;

    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i]!;
      if (!a.active) continue;

      if (a.panicRemaining > 0) a.panicRemaining = Math.max(0, a.panicRemaining - dt);
      if (a.duckRemaining > 0) a.duckRemaining = Math.max(0, a.duckRemaining - dt);

      const route = this.routes[a.routeIndex]!;
      const target = route.waypoints[a.waypointIndex]!;

      // Determine current sprint speed: brief duck flinch slows momentarily then surges into panicked sprint.
      const panicMult = a.panicRemaining > 0 ? this.panicSpeedMult : 1.0;
      const duckMult = a.duckRemaining > 0 ? 0.85 : 1.0;
      const speed = this.baseSpeed * a.personalSpeedFactor * panicMult * duckMult;
      a.currentSpeed = speed;

      const tx = target.x + a.lateralOffset;
      const ty = target.y;
      const tz = target.z;
      const dx = tx - a.position.x;
      const dy = ty - a.position.y;
      const dz = tz - a.position.z;
      const dist = Math.hypot(dx, dy, dz);
      const step = speed * dt;

      if (dist <= Math.max(step, CIVILIAN_DEFAULTS.waypointReachDist)) {
        a.position.set(tx, ty, tz);
        a.waypointIndex++;
        if (a.waypointIndex >= route.waypoints.length) {
          this.recycleAgent(a, route.id);
        }
      } else {
        const inv = 1 / dist;
        a.position.x += dx * inv * step;
        a.position.y += dy * inv * step;
        a.position.z += dz * inv * step;
        a.yaw = Math.atan2(dx, dz);
      }

      // Advance procedural `sin` stride phase proportional to ground distance traveled.
      a.stridePhase += step * 2.35;
      this.syncAgentVisual(a);
    }
  }

  /** Resets all pooled civilians back to staggered starting positions along the routes. */
  reset(): void {
    this._recycledCount = 0;
    this.nextRouteCursor = 0;
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i]!;
      a.panicRemaining = 0;
      a.duckRemaining = 0;
      a.currentSpeed = this.baseSpeed * a.personalSpeedFactor;
      a.stridePhase = i * 0.9;
      this.placeStaggered(a, i);
      this.syncAgentVisual(a);
    }
  }

  /** Disposes all Three.js meshes/geometries/materials and unsubscribes from events. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;

    for (const unsub of this.unsubs) unsub();
    this.unsubs.length = 0;

    if (this.sceneRoot) {
      this.ctx.render?.scene?.remove?.(this.sceneRoot);
      this.sceneRoot = null;
    }
    for (const g of this.sharedGeos) g.dispose();
    for (const m of this.sharedMats) m.dispose();
    this.sharedGeos.length = 0;
    this.sharedMats.length = 0;
    this.agents.length = 0;
  }

  // -------------------------------------------------------------------------------------------
  // Internal pooling & procedural visuals
  // -------------------------------------------------------------------------------------------

  private initPool(): void {
    for (let i = 0; i < this.maxCount; i++) {
      // Deterministic personal speed & sidewalk lane spread so crowds read naturally without jitter.
      const speedFactor = 0.88 + ((i * 37) % 100) * 0.0028;
      const lateralOffset = (((i * 53) % 11) - 5) * 0.16;

      const agent: CivilianAgent = {
        index: i,
        active: false,
        routeIndex: i % this.routes.length,
        waypointIndex: 1,
        position: new THREE.Vector3(),
        yaw: 0,
        personalSpeedFactor: speedFactor,
        currentSpeed: this.baseSpeed * speedFactor,
        stridePhase: i * 0.9,
        panicRemaining: 0,
        duckRemaining: 0,
        lateralOffset,
        rig: this.buildCivilianRig(i),
      };

      this.placeStaggered(agent, i);
      this.syncAgentVisual(agent);
      this.agents.push(agent);
    }
  }

  private placeStaggered(agent: CivilianAgent, index: number): void {
    if (this.routes.length === 0) return;
    const routeIdx = index % this.routes.length;
    const route = this.routes[routeIdx]!;
    agent.routeIndex = routeIdx;

    // Distribute initial spawns cleanly across the route segments so sidewalks start populated.
    const segCount = route.waypoints.length - 1;
    const frac = ((index / Math.max(1, this.maxCount)) * 0.82) % 0.85;
    const scaled = frac * segCount;
    const segIdx = Math.min(segCount - 1, Math.floor(scaled));
    const localT = scaled - segIdx;

    const a = route.waypoints[segIdx]!;
    const b = route.waypoints[segIdx + 1]!;
    agent.position.lerpVectors(a, b, localT);
    agent.position.x += agent.lateralOffset;
    agent.waypointIndex = segIdx + 1;
    agent.yaw = Math.atan2(b.x - a.x, b.z - a.z);
  }

  private recycleAgent(agent: CivilianAgent, finishedRouteId: string): void {
    this._recycledCount++;
    this.onRecycleCb?.(finishedRouteId, this._recycledCount);

    // Respawn cleanly at the start of the next sidewalk route (calm until another blast hits).
    const nextIdx = this.nextRouteCursor++ % this.routes.length;
    const route = this.routes[nextIdx]!;
    agent.routeIndex = nextIdx;
    agent.waypointIndex = 1;
    agent.panicRemaining = 0;
    agent.duckRemaining = 0;
    agent.position.copy(route.waypoints[0]!);
    agent.position.x += agent.lateralOffset;
    const nextWp = route.waypoints[1]!;
    agent.yaw = Math.atan2(nextWp.x - route.waypoints[0]!.x, nextWp.z - route.waypoints[0]!.z);
  }

  private buildSceneResources(): void {
    const scene = this.ctx.render?.scene;
    if (!scene || this.routes.length === 0) return;

    this.sceneRoot = new THREE.Group();
    this.sceneRoot.visible = false;

    // Glowing emerald SUBWAY shelter exit signs at each route's terminus.
    const signPostGeo = new THREE.BoxGeometry(0.14, 2.8, 0.14);
    const signBoxGeo = new THREE.BoxGeometry(2.2, 0.55, 0.18);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x2c333a, roughness: 0.5, metalness: 0.7 });
    const subwayMat = new THREE.MeshStandardMaterial({
      color: 0x28e67a,
      emissive: 0x18cc62,
      emissiveIntensity: 1.8,
      roughness: 0.25,
      metalness: 0.1,
    });
    this.sharedGeos.push(signPostGeo, signBoxGeo);
    this.sharedMats.push(postMat, subwayMat);

    for (const r of this.routes) {
      const signGroup = new THREE.Group();
      signGroup.position.copy(r.subwayExit);
      const postL = new THREE.Mesh(signPostGeo, postMat);
      postL.position.set(-1.0, 1.4, 0);
      const postR = new THREE.Mesh(signPostGeo, postMat);
      postR.position.set(1.0, 1.4, 0);
      const header = new THREE.Mesh(signBoxGeo, subwayMat);
      header.position.set(0, 2.75, 0);
      signGroup.add(postL, postR, header);
      this.sceneRoot.add(signGroup);
    }

    // Pre-build shared lightweight silhouette geometries for all 24 pooled civilians.
    const torsoGeo = new THREE.BoxGeometry(0.42, 0.68, 0.24);
    const headGeo = new THREE.SphereGeometry(0.14, 7, 6);
    const armGeo = new THREE.BoxGeometry(0.12, 0.52, 0.12);
    armGeo.translate(0, -0.22, 0);
    const legGeo = new THREE.BoxGeometry(0.15, 0.72, 0.16);
    legGeo.translate(0, -0.34, 0);
    const briefcaseGeo = new THREE.BoxGeometry(0.08, 0.28, 0.38);
    this.sharedGeos.push(torsoGeo, headGeo, armGeo, legGeo, briefcaseGeo);

    const headMat = new THREE.MeshStandardMaterial({ color: 0xd9b89c, roughness: 0.75, metalness: 0.05 });
    const trouserMat = new THREE.MeshStandardMaterial({ color: 0x2a2d34, roughness: 0.8, metalness: 0.05 });
    const briefcaseMat = new THREE.MeshStandardMaterial({ color: 0x4a3525, roughness: 0.55, metalness: 0.2 });
    this.sharedMats.push(headMat, trouserMat, briefcaseMat);

    for (const c of COAT_COLORS) {
      this.sharedMats.push(
        new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, metalness: 0.08 }),
      );
    }

    scene.add(this.sceneRoot);
  }

  private buildCivilianRig(index: number): CivilianVisualRig | null {
    if (!this.sceneRoot || this.sharedGeos.length < 7) return null;

    // Shared indices: [0: signPost, 1: signBox, 2: torso, 3: head, 4: arm, 5: leg, 6: briefcase]
    const torsoGeo = this.sharedGeos[2]!;
    const headGeo = this.sharedGeos[3]!;
    const armGeo = this.sharedGeos[4]!;
    const legGeo = this.sharedGeos[5]!;
    const briefcaseGeo = this.sharedGeos[6]!;

    // Shared materials: [0: post, 1: subway, 2: head, 3: trouser, 4: briefcase, 5+: coats]
    const headMat = this.sharedMats[2]!;
    const trouserMat = this.sharedMats[3]!;
    const briefcaseMat = this.sharedMats[4]!;
    const coatMat = this.sharedMats[5 + (index % COAT_COLORS.length)]!;

    const root = new THREE.Group();
    root.visible = false;
    const body = new THREE.Group();
    root.add(body);

    const torso = new THREE.Mesh(torsoGeo, coatMat);
    torso.position.y = 1.06;
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.56;

    const leftArm = new THREE.Mesh(armGeo, coatMat);
    leftArm.position.set(-0.27, 1.32, 0);

    const rightArm = new THREE.Group();
    rightArm.position.set(0.27, 1.32, 0);
    const rightArmMesh = new THREE.Mesh(armGeo, coatMat);
    rightArm.add(rightArmMesh);
    // Give ~2/3 of commuters a briefcase to make office silhouettes read immediately.
    if (index % 3 !== 2) {
      const briefcase = new THREE.Mesh(briefcaseGeo, briefcaseMat);
      briefcase.position.set(0.05, -0.54, 0.04);
      rightArm.add(briefcase);
    }

    const leftLeg = new THREE.Mesh(legGeo, trouserMat);
    leftLeg.position.set(-0.11, 0.72, 0);
    const rightLeg = new THREE.Mesh(legGeo, trouserMat);
    rightLeg.position.set(0.11, 0.72, 0);

    body.add(torso, head, leftArm, rightArm, leftLeg, rightLeg);
    this.sceneRoot.add(root);

    return { root, body, leftArm, rightArm, leftLeg, rightLeg };
  }

  private syncAgentVisual(agent: CivilianAgent): void {
    const rig = agent.rig;
    if (!rig) return;

    rig.root.position.copy(agent.position);
    rig.root.rotation.y = agent.yaw;

    const swingAmp = agent.panicRemaining > 0 ? 0.92 : 0.65;
    const s = Math.sin(agent.stridePhase) * swingAmp;
    rig.leftLeg.rotation.x = s;
    rig.rightLeg.rotation.x = -s;
    rig.leftArm.rotation.x = -s * 0.85;
    rig.rightArm.rotation.x = s * 0.65;

    // Subtle vertical stride bob + crouched lean while ducking/panicking from a nearby blast.
    const bob = Math.abs(Math.sin(agent.stridePhase)) * 0.07;
    const duckDrop = agent.duckRemaining > 0 ? -0.24 : 0;
    rig.body.position.y = bob + duckDrop;
    rig.body.rotation.x = agent.duckRemaining > 0 ? 0.38 : agent.panicRemaining > 0 ? 0.18 : 0.08;
  }
}
