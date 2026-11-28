/**
 * Rigged Industrial Freight / Service Elevator for Deprecation (`Form 7742-A`, Section 5).
 *
 * - Real kinematic Rapier floor (`6 m × 6 m`) + procedural industrial freight cage with open
 *   wire-mesh walls, emergency beacon lights, sliding doors, and scrolling neon floor-number
 *   light strips inside the shaft so a 40 m physical drop sells an 80-story express plunge.
 * - State machine:
 *     `idle_top` -> `holding` (25 s lobby hold countdown) -> `doors_open` -> `descending_1`
 *     -> `jammed` (4 shootable 80 HP hydraulic brake clamps on shaft corner rails)
 *     -> `falling` (rapid plunge smashing through the datacenter ceiling grate)
 *     -> `arrived_vault` (settled at Sub-Level 4, doors open into Compute Vault).
 * - Implements `ExtraTarget` for native weapon/explosive shooting plus direct `hit(pos, dir, dmg)`
 *   and `blast(pos, radius, dmg)` methods.
 * - Keeps the player safely riding on the kinematic floor without clipping or falling through.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { CG, type Ctx, type ExplosionKind } from '../../core/contracts';
import type { ExplosionSpec } from '../../core/gameplay';
import { clamp } from '../../core/math';
import type { ExtraTarget, VehicleSystem } from '../../enemies/vehicles';

export type ElevatorState =
  | 'idle_top'
  | 'holding'
  | 'doors_open'
  | 'descending_1'
  | 'jammed'
  | 'falling'
  | 'arrived_vault';

export type Vec3Like = THREE.Vector3 | readonly [number, number, number];

export interface ElevatorDef {
  /** World X/Z center of the elevator shaft (and default `topY` if `topY` is omitted). */
  readonly position: Vec3Like;
  /** Top lobby floor elevation in meters (default `position.y` or `34`). */
  readonly topY?: number;
  /** Mid-shaft elevation where Ram cuts power & engages hydraulic brakes (default `18`). */
  readonly jamY?: number;
  /** Bottom Compute Vault floor elevation in meters (default `-6`). */
  readonly bottomY?: number;
  /** Square cab floor width & depth in meters (default `6`). */
  readonly size?: number;
  /** Cab cage interior height in meters (default `3.8`). */
  readonly cabHeight?: number;
  /** Lobby hold countdown duration in seconds (default `25`). */
  readonly holdDuration?: number;
  /** Controlled descent speed during `descending_1` in m/s (default `4.2`). */
  readonly descentSpeed?: number;
  /** Gravitational acceleration during `falling` plunge in m/s² (default `24`). */
  readonly fallGravity?: number;
  /** Terminal fall speed during `falling` plunge in m/s (default `32`). */
  readonly maxFallSpeed?: number;
  /** HP per hydraulic brake clamp (4 clamps total, default `80`). */
  readonly clampHp?: number;
  /** Elevation of the breakable datacenter ceiling grate smashed during `falling` (default `bottomY + 4.5`). */
  readonly ceilingGrateY?: number;
  /** Optional cab door facing yaw in radians (default `0`, opening toward `+Z`). */
  readonly doorYaw?: number;
  /** Automatically close doors and begin descent when the player enters the cab in `doors_open` (default `true`). */
  readonly autoStartDescentOnBoard?: boolean;
  /** Automatically register with `ctx.enemies.vehicles.addExtra(this)` (default `true`). */
  readonly autoRegisterExtra?: boolean;

  readonly onStateChange?: (state: ElevatorState, prev: ElevatorState) => void;
  readonly onHoldProgress?: (elapsed: number, duration: number, fraction: number) => void;
  readonly onClampDestroyed?: (index: number, remaining: number, position: THREE.Vector3) => void;
  readonly onCeilingBreach?: (position: THREE.Vector3) => void;
  readonly onArrivedVault?: (position: THREE.Vector3) => void;
}

export interface BrakeClampSnapshot {
  readonly index: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly alive: boolean;
  readonly position: THREE.Vector3;
}

export const ELEVATOR_DEFAULTS = {
  topY: 34,
  jamY: 18,
  bottomY: -6,
  size: 6,
  cabHeight: 3.8,
  holdDuration: 25,
  descentSpeed: 4.2,
  fallGravity: 24,
  maxFallSpeed: 32,
  clampHp: 80,
  clampHitRadius: 0.9,
  floorThickness: 0.4,
  stripCount: 12,
  stripSpacing: 2.4,
  topDisplayFloor: 80,
  bottomDisplayFloor: -4,
} as const;

const UP = new THREE.Vector3(0, 1, 0);
const _tmpVec = new THREE.Vector3();
const _tmpDir = new THREE.Vector3();
const _tmpFeet = new THREE.Vector3();

function rapierGroups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

function toVec3(v: Vec3Like, out: THREE.Vector3): THREE.Vector3 {
  if (v instanceof THREE.Vector3) return out.copy(v);
  return out.set(v[0], v[1], v[2]);
}

interface BrakeClampInternal {
  readonly index: number;
  readonly localOffset: THREE.Vector3;
  readonly worldPos: THREE.Vector3;
  hp: number;
  readonly maxHp: number;
  alive: boolean;
  body: RAPIER.RigidBody | null;
  collider: RAPIER.Collider | null;
  mesh: THREE.Mesh | null;
  glowMat: THREE.MeshStandardMaterial | null;
}

interface ElevatorVisuals {
  root: THREE.Group;
  cabGroup: THREE.Group;
  doorLeft: THREE.Mesh;
  doorRight: THREE.Mesh;
  beaconMeshes: THREE.Mesh[];
  beaconMat: THREE.MeshStandardMaterial;
  stripGroup: THREE.Group;
  stripMeshes: THREE.Mesh[];
  stripMat: THREE.MeshStandardMaterial;
  ceilingGrate: THREE.Group;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
}

export class ServiceElevator implements ExtraTarget {
  readonly centerX: number;
  readonly centerZ: number;
  readonly topY: number;
  readonly jamY: number;
  readonly bottomY: number;
  readonly size: number;
  readonly halfSize: number;
  readonly cabHeight: number;
  readonly holdDuration: number;
  readonly descentSpeed: number;
  readonly fallGravity: number;
  readonly maxFallSpeed: number;
  readonly clampHp: number;
  readonly ceilingGrateY: number;
  readonly doorYaw: number;

  private readonly def: ElevatorDef;
  private readonly autoStartDescentOnBoard: boolean;

  private _state: ElevatorState = 'idle_top';
  private _cabY: number;
  private _verticalSpeed = 0;
  private _holdElapsed = 0;
  private _doorOpen = 0;
  private _scrollOffset = 0;
  private _ceilingBreached = false;
  private clock = 0;
  private rumbleTimer = 0;
  private windTimer = 0;

  private floorBody: RAPIER.RigidBody | null = null;
  private floorCollider: RAPIER.Collider | null = null;
  private readonly clamps: BrakeClampInternal[] = [];
  private readonly clampByHandle = new Map<number, BrakeClampInternal>();
  private visuals: ElevatorVisuals | null = null;

  private registeredExtra = false;
  private readonly unsubs: (() => void)[] = [];
  private disposed = false;

  constructor(private readonly ctx: Ctx, def: ElevatorDef) {
    this.def = def;
    const pos = toVec3(def.position, new THREE.Vector3());
    this.centerX = pos.x;
    this.centerZ = pos.z;
    this.topY = def.topY ?? pos.y ?? ELEVATOR_DEFAULTS.topY;
    this.jamY = def.jamY ?? ELEVATOR_DEFAULTS.jamY;
    this.bottomY = def.bottomY ?? ELEVATOR_DEFAULTS.bottomY;
    this.size = def.size ?? ELEVATOR_DEFAULTS.size;
    this.halfSize = this.size * 0.5;
    this.cabHeight = def.cabHeight ?? ELEVATOR_DEFAULTS.cabHeight;
    this.holdDuration = def.holdDuration ?? ELEVATOR_DEFAULTS.holdDuration;
    this.descentSpeed = def.descentSpeed ?? ELEVATOR_DEFAULTS.descentSpeed;
    this.fallGravity = def.fallGravity ?? ELEVATOR_DEFAULTS.fallGravity;
    this.maxFallSpeed = def.maxFallSpeed ?? ELEVATOR_DEFAULTS.maxFallSpeed;
    this.clampHp = def.clampHp ?? ELEVATOR_DEFAULTS.clampHp;
    this.ceilingGrateY = def.ceilingGrateY ?? (this.bottomY + 4.5);
    this.doorYaw = def.doorYaw ?? 0;
    this.autoStartDescentOnBoard = def.autoStartDescentOnBoard !== false;
    this._cabY = this.topY;

    this.initPhysics();
    this.initClamps();
    this.visuals = this.buildVisuals();
    this.syncTransforms(true);

    const vehSys = ctx.enemies?.vehicles as Partial<VehicleSystem> | undefined;
    if (def.autoRegisterExtra !== false && typeof vehSys?.addExtra === 'function') {
      vehSys.addExtra(this);
      this.registeredExtra = true;
    }

    if (ctx.events?.on) {
      this.unsubs.push(
        ctx.events.on('world:explosion', ev => {
          this.applyBlast(ev.position, ev.radius, ev.damage, ev.source ?? 'world_explosion');
        }),
      );
    }
  }

  get state(): ElevatorState {
    return this._state;
  }

  /** Current top-surface Y elevation of the elevator cab floor. */
  get y(): number {
    return this._cabY;
  }

  /** Current downward speed in m/s (positive while moving down). */
  get speed(): number {
    return this._verticalSpeed;
  }

  /** Normalized `0..1` lobby hold countdown progress. */
  get holdProgress(): number {
    if (this._state === 'idle_top') return 0;
    if (this._state === 'holding') return clamp(this._holdElapsed / Math.max(this.holdDuration, 0.001), 0, 1);
    return 1;
  }

  /** Seconds elapsed in `holding` state. */
  get holdElapsed(): number {
    return this._holdElapsed;
  }

  /** Door opening fraction `0` (closed) to `1` (open). */
  get doorOpen(): number {
    return this._doorOpen;
  }

  /** Visual scroll offset of the rushing neon shaft strips. */
  get scrollOffset(): number {
    return this._scrollOffset;
  }

  /** Simulated express floor indicator (`80` at top -> `-4` at Sub-Level 4). */
  get displayFloor(): number {
    const span = Math.max(this.topY - this.bottomY, 0.001);
    const frac = clamp((this.topY - this._cabY) / span, 0, 1);
    return Math.round(
      ELEVATOR_DEFAULTS.topDisplayFloor +
        (ELEVATOR_DEFAULTS.bottomDisplayFloor - ELEVATOR_DEFAULTS.topDisplayFloor) * frac,
    );
  }

  /** Number of intact hydraulic brake clamps remaining (0..4). */
  get clampsRemaining(): number {
    let n = 0;
    for (let i = 0; i < this.clamps.length; i++) {
      if (this.clamps[i]!.alive) n++;
    }
    return n;
  }

  /** True once the falling cab has smashed through the datacenter ceiling grate. */
  get ceilingBreached(): boolean {
    return this._ceilingBreached;
  }

  /** Kinematic Rapier floor collider (null only when running without a Rapier world). */
  get collider(): RAPIER.Collider | null {
    return this.floorCollider;
  }

  /** Read-only snapshot of the 4 corner hydraulic brake clamps. */
  getClamps(): BrakeClampSnapshot[] {
    return this.clamps.map(c => ({
      index: c.index,
      hp: c.hp,
      maxHp: c.maxHp,
      alive: c.alive,
      position: c.worldPos.clone(),
    }));
  }

  /** Returns the Rapier collider of clamp `index` (0..3), if created. */
  getClampCollider(index: number): RAPIER.Collider | null {
    return this.clamps[index]?.collider ?? null;
  }

  /** True if world point `(x, z)` lies within the `6 m × 6 m` cab footprint. */
  isInsideFootprint(pos: THREE.Vector3, margin = 0.1): boolean {
    const limit = this.halfSize - margin;
    return Math.abs(pos.x - this.centerX) <= limit && Math.abs(pos.z - this.centerZ) <= limit;
  }

  /** Begins the 25-second Service Lobby hold countdown (`idle_top` -> `holding`). */
  startHold(): boolean {
    if (this._state !== 'idle_top') return false;
    this._holdElapsed = 0;
    this.setState('holding');
    this.ctx.audio?.play?.('metal_groan', {
      position: _tmpVec.set(this.centerX, this._cabY + 2, this.centerZ),
      volume: 0.75,
      pitch: 0.9,
    });
    return true;
  }

  /** Opens the cab doors immediately (useful for checkpoints or after lobby hold completes). */
  openDoors(): void {
    if (this._state === 'idle_top' || this._state === 'holding') {
      this._holdElapsed = this.holdDuration;
      this.setState('doors_open');
    }
  }

  /** Closes doors and begins the express shaft descent (`doors_open` / `idle_top` -> `descending_1`). */
  startDescent(): boolean {
    if (this._state !== 'doors_open' && this._state !== 'idle_top' && this._state !== 'holding') {
      return false;
    }
    this._doorOpen = 0;
    this._verticalSpeed = this.descentSpeed;
    this.setState('descending_1');
    const pos = _tmpVec.set(this.centerX, this._cabY + 1.5, this.centerZ);
    this.ctx.audio?.play?.('crusher_rise', { position: pos, volume: 0.75, pitch: 0.78 });
    this.ctx.audio?.play?.('metal_groan', { position: pos, volume: 0.8, pitch: 0.7 });
    return true;
  }

  /** Forces the elevator directly into a checkpoint state cleanly. */
  setCheckpointState(target: ElevatorState): void {
    this._verticalSpeed = 0;
    this._ceilingBreached = target === 'arrived_vault';
    if (target === 'idle_top') {
      this._cabY = this.topY;
      this._holdElapsed = 0;
      this._doorOpen = 0;
      this.restoreClamps();
    } else if (target === 'holding') {
      this._cabY = this.topY;
      this._holdElapsed = 0;
      this._doorOpen = 0;
      this.restoreClamps();
    } else if (target === 'doors_open') {
      this._cabY = this.topY;
      this._holdElapsed = this.holdDuration;
      this._doorOpen = 1;
      this.restoreClamps();
    } else if (target === 'descending_1') {
      this._cabY = this.topY;
      this._doorOpen = 0;
      this._verticalSpeed = this.descentSpeed;
      this.restoreClamps();
    } else if (target === 'jammed') {
      this._cabY = this.jamY;
      this._doorOpen = 0;
      this.restoreClamps();
    } else if (target === 'falling') {
      this._cabY = this.jamY;
      this._doorOpen = 0;
      this.destroyAllClampsSilent();
    } else if (target === 'arrived_vault') {
      this._cabY = this.bottomY;
      this._doorOpen = 1;
      this.destroyAllClampsSilent();
    }
    this.setState(target);
    this.syncTransforms(true);
  }

  // -------------------------------------------------------------------------------------------
  // Shootable hydraulic brake clamps (ExtraTarget + direct hit/blast API)
  // -------------------------------------------------------------------------------------------

  /** ExtraTarget: hitscan bullet hit on a clamp collider. */
  shot(collider: RAPIER.Collider, point: THREE.Vector3, amount: number, source: string): boolean {
    const clampObj = this.clampByHandle.get(collider.handle);
    if (!clampObj || !clampObj.alive) return false;
    if (this._state !== 'jammed') return false;
    this.applyClampDamage(clampObj, amount, point, source);
    return true;
  }

  /** ExtraTarget: direct rocket/shell impact on a clamp collider. */
  direct(
    collider: RAPIER.Collider,
    point: THREE.Vector3,
    amount: number,
    _kind: ExplosionKind,
    source: string,
  ): boolean {
    return this.shot(collider, point, amount, source);
  }

  /**
   * Direct ray-sphere hit test against the 4 hydraulic brake clamps (for weapon hooks or tests).
   * Returns true if a live clamp was hit.
   */
  hit(pos: THREE.Vector3, dir: THREE.Vector3, dmg: number, source = 'weapon'): boolean {
    if (this._state !== 'jammed' || dmg <= 0) return false;
    _tmpDir.copy(dir);
    const len = _tmpDir.length();
    if (len < 1e-6) return false;
    _tmpDir.divideScalar(len);

    let best: BrakeClampInternal | null = null;
    let bestT = Infinity;
    const r = ELEVATOR_DEFAULTS.clampHitRadius;
    const r2 = r * r;

    for (let i = 0; i < this.clamps.length; i++) {
      const c = this.clamps[i]!;
      if (!c.alive) continue;
      // Ray-sphere intersection against clamp world center.
      const ox = c.worldPos.x - pos.x;
      const oy = c.worldPos.y - pos.y;
      const oz = c.worldPos.z - pos.z;
      const proj = ox * _tmpDir.x + oy * _tmpDir.y + oz * _tmpDir.z;
      if (proj < -r) continue;
      const closestX = pos.x + _tmpDir.x * Math.max(0, proj);
      const closestY = pos.y + _tmpDir.y * Math.max(0, proj);
      const closestZ = pos.z + _tmpDir.z * Math.max(0, proj);
      const dx = c.worldPos.x - closestX;
      const dy = c.worldPos.y - closestY;
      const dz = c.worldPos.z - closestZ;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 <= r2 && proj < bestT) {
        bestT = proj;
        best = c;
      }
    }

    if (!best) return false;
    this.applyClampDamage(best, dmg, best.worldPos, source);
    return true;
  }

  /**
   * Applies radial explosion damage to live hydraulic brake clamps.
   * Supports both `ExtraTarget.blast(center, spec)` and direct `blast(pos, radius, dmg, source?)`.
   */
  blast(center: THREE.Vector3, spec: ExplosionSpec): number;
  blast(pos: THREE.Vector3, radius: number, dmg: number, source?: string): number;
  blast(
    center: THREE.Vector3,
    specOrRadius: ExplosionSpec | number,
    dmg?: number,
    source?: string,
  ): number {
    if (typeof specOrRadius === 'number') {
      return this.applyBlast(center, specOrRadius, dmg ?? 0, source ?? 'blast');
    }
    if (specOrRadius.team !== 'player') return 0;
    return this.applyBlast(
      center,
      specOrRadius.radius,
      specOrRadius.instakill ? Infinity : specOrRadius.damage,
      specOrRadius.source,
    );
  }

  /** Direct helper to damage a specific brake clamp by index (0..3). */
  damageClamp(index: number, dmg: number, source = 'direct'): boolean {
    const c = this.clamps[index];
    if (!c || !c.alive || this._state !== 'jammed' || dmg <= 0) return false;
    this.applyClampDamage(c, dmg, c.worldPos, source);
    return true;
  }

  /** ExtraTarget: optional X-ray highlight meshes while jammed. */
  highlightMeshes(out: THREE.Object3D[]): void {
    if (this._state !== 'jammed') return;
    for (let i = 0; i < this.clamps.length; i++) {
      const m = this.clamps[i]!.mesh;
      if (this.clamps[i]!.alive && m) out.push(m);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Update & state machine
  // -------------------------------------------------------------------------------------------

  update(dt: number): void {
    if (this.disposed || dt <= 0) return;
    this.clock += dt;

    const prevY = this._cabY;

    switch (this._state) {
      case 'idle_top':
        this._doorOpen = Math.max(0, this._doorOpen - dt * 2.2);
        break;

      case 'holding': {
        this._holdElapsed = Math.min(this.holdDuration, this._holdElapsed + dt);
        const frac = clamp(this._holdElapsed / Math.max(this.holdDuration, 0.001), 0, 1);
        this.def.onHoldProgress?.(this._holdElapsed, this.holdDuration, frac);
        if (this._holdElapsed >= this.holdDuration) {
          this.setState('doors_open');
          this.ctx.audio?.play?.('steam_burst', {
            position: _tmpVec.set(this.centerX, this._cabY + 2, this.centerZ),
            volume: 0.85,
            pitch: 1.08,
          });
        }
        break;
      }

      case 'doors_open': {
        this._doorOpen = Math.min(1, this._doorOpen + dt * 1.8);
        const player = this.ctx.player;
        if (
          this.autoStartDescentOnBoard &&
          player &&
          player.alive &&
          !player.parked &&
          this.isInsideFootprint(player.position, 0.35) &&
          Math.abs(player.position.y - this._cabY) <= 2.4
        ) {
          this.startDescent();
        }
        break;
      }

      case 'descending_1': {
        this._doorOpen = Math.max(0, this._doorOpen - dt * 3.0);
        this._verticalSpeed = this.descentSpeed;
        this._cabY = Math.max(this.jamY, this._cabY - this._verticalSpeed * dt);
        this._scrollOffset += 18 * dt;

        // Subtle continuous cab vibration + rushing shaft wind cues.
        this.rumbleTimer += dt;
        if (this.rumbleTimer >= 0.25) {
          this.rumbleTimer = 0;
          this.ctx.camera?.addTrauma?.(0.12);
        }
        this.windTimer += dt;
        if (this.windTimer >= 0.65) {
          this.windTimer = 0;
          this.ctx.audio?.play?.('steam_burst', {
            position: _tmpVec.set(this.centerX, this._cabY + 2.5, this.centerZ),
            volume: 0.28,
            pitch: 1.45,
          });
        }

        if (this._cabY <= this.jamY + 1e-4) {
          this._cabY = this.jamY;
          this._verticalSpeed = 0;
          this.enterJammed();
        }
        break;
      }

      case 'jammed': {
        this._doorOpen = Math.max(0, this._doorOpen - dt * 3.0);
        this._verticalSpeed = 0;
        break;
      }

      case 'falling': {
        this._doorOpen = 0;
        this._verticalSpeed = Math.min(this.maxFallSpeed, this._verticalSpeed + this.fallGravity * dt);
        this._cabY = Math.max(this.bottomY, this._cabY - this._verticalSpeed * dt);
        this._scrollOffset += 48 * dt;

        this.rumbleTimer += dt;
        if (this.rumbleTimer >= 0.14) {
          this.rumbleTimer = 0;
          this.ctx.camera?.addTrauma?.(0.24);
        }

        if (!this._ceilingBreached && this._cabY <= this.ceilingGrateY) {
          this.triggerCeilingBreach();
        }

        if (this._cabY <= this.bottomY + 1e-4) {
          this._cabY = this.bottomY;
          this._verticalSpeed = 0;
          this.enterArrivedVault();
        }
        break;
      }

      case 'arrived_vault': {
        this._doorOpen = Math.min(1, this._doorOpen + dt * 1.8);
        this._verticalSpeed = 0;
        break;
      }
    }

    this.syncTransforms(false);
    this.carryPlayerIfInside(prevY);
    this.updateVisualFX();
  }

  /** Restores the elevator to `idle_top` with intact clamps and ceiling grate. */
  reset(): void {
    this._state = 'idle_top';
    this._cabY = this.topY;
    this._verticalSpeed = 0;
    this._holdElapsed = 0;
    this._doorOpen = 0;
    this._scrollOffset = 0;
    this._ceilingBreached = false;
    this.clock = 0;
    this.rumbleTimer = 0;
    this.windTimer = 0;
    this.restoreClamps();
    if (this.visuals) {
      this.visuals.ceilingGrate.visible = true;
    }
    this.syncTransforms(true);
    this.updateVisualFX();
  }

  /** Removes all Rapier bodies/colliders, scene visuals, event listeners, and ExtraTarget registration. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const unsub of this.unsubs) unsub();
    this.unsubs.length = 0;

    if (this.registeredExtra) {
      const vehSys = this.ctx.enemies?.vehicles as Partial<VehicleSystem> | undefined;
      vehSys?.removeExtra?.(this);
      this.registeredExtra = false;
    }

    const world = this.ctx.physics?.world;
    if (world) {
      if (this.floorBody) {
        world.removeRigidBody(this.floorBody);
      } else if (this.floorCollider) {
        world.removeCollider(this.floorCollider, true);
      }
      for (const c of this.clamps) {
        if (c.body) {
          world.removeRigidBody(c.body);
        } else if (c.collider) {
          world.removeCollider(c.collider, true);
        }
        c.body = null;
        c.collider = null;
      }
    }
    this.floorBody = null;
    this.floorCollider = null;
    this.clampByHandle.clear();

    if (this.visuals) {
      this.ctx.render?.scene?.remove?.(this.visuals.root);
      for (const g of this.visuals.geometries) g.dispose();
      for (const m of this.visuals.materials) m.dispose();
      this.visuals = null;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Internal transitions & damage
  // -------------------------------------------------------------------------------------------

  private setState(next: ElevatorState): void {
    const prev = this._state;
    if (prev === next) return;
    this._state = next;
    this.def.onStateChange?.(next, prev);
  }

  private enterJammed(): void {
    this.setState('jammed');
    const pos = _tmpVec.set(this.centerX, this._cabY + 2, this.centerZ);
    this.ctx.camera?.addTrauma?.(0.48);
    this.ctx.audio?.play?.('crusher_slam', { position: pos, volume: 0.9, pitch: 0.72 });
    this.ctx.audio?.play?.('metal_groan', { position: pos, volume: 0.95, pitch: 0.65 });
    this.ctx.audio?.play?.('electric_zap', { position: pos, volume: 0.85, pitch: 0.88 });
    for (const c of this.clamps) {
      this.ctx.fx?.sparks?.(c.worldPos, UP, 10, 0xff5522);
    }
  }

  private triggerCeilingBreach(): void {
    this._ceilingBreached = true;
    const breachPos = new THREE.Vector3(this.centerX, this.ceilingGrateY, this.centerZ);
    if (this.visuals) {
      this.visuals.ceilingGrate.visible = false;
    }
    this.ctx.events?.emit?.('world:explosion', {
      position: breachPos,
      radius: 8,
      damage: 140,
      kind: 'barrel',
      source: 'elevator_breach',
    });
    this.ctx.fx?.explosion?.(breachPos, { radius: 7.5, kind: 'barrel', scale: 1.3 });
    this.ctx.fx?.sparks?.(breachPos, UP, 32, 0xff9933);
    this.ctx.audio?.play?.('crusher_slam', { position: breachPos, volume: 1.0, pitch: 0.62 });
    this.ctx.audio?.play?.('explosion_barrel', { position: breachPos, volume: 0.95, pitch: 0.85 });
    this.ctx.camera?.addTrauma?.(0.7);
    this.def.onCeilingBreach?.(breachPos);
  }

  private enterArrivedVault(): void {
    this.setState('arrived_vault');
    const arrivePos = new THREE.Vector3(this.centerX, this.bottomY, this.centerZ);
    this.ctx.camera?.addTrauma?.(0.62);
    this.ctx.fx?.dust?.(arrivePos, UP, 3.5);
    this.ctx.fx?.sparks?.(arrivePos, UP, 20, 0xffbb55);
    this.ctx.audio?.play?.('crusher_slam', { position: arrivePos, volume: 1.0, pitch: 0.58 });
    this.ctx.audio?.play?.('steam_burst', { position: arrivePos, volume: 0.9, pitch: 0.85 });
    this.def.onArrivedVault?.(arrivePos);
  }

  private applyBlast(center: THREE.Vector3, radius: number, damage: number, source: string): number {
    if (this._state !== 'jammed' || radius <= 0 || damage <= 0) return 0;
    let hitCount = 0;
    const effectiveRadius = radius + ELEVATOR_DEFAULTS.clampHitRadius;
    for (let i = 0; i < this.clamps.length; i++) {
      const c = this.clamps[i]!;
      if (!c.alive) continue;
      const d = c.worldPos.distanceTo(center);
      if (d > effectiveRadius) continue;
      const falloff = clamp(1 - (d / effectiveRadius) * 0.65, 0.35, 1);
      this.applyClampDamage(c, damage * falloff, c.worldPos, source);
      hitCount++;
    }
    return hitCount;
  }

  private applyClampDamage(
    clampObj: BrakeClampInternal,
    amount: number,
    point: THREE.Vector3,
    _source: string,
  ): void {
    if (!clampObj.alive || amount <= 0) return;
    clampObj.hp = Math.max(0, clampObj.hp - amount);
    const destroyed = clampObj.hp <= 0;

    this.ctx.fx?.sparks?.(point, UP, destroyed ? 24 : 8, destroyed ? 0xffaa22 : 0xff5533);
    this.ctx.hud?.hitMarker?.(destroyed ? 'kill' : 'armorBroken');
    this.ctx.audio?.play?.(destroyed ? 'plate_destroyed' : 'metal_clang', {
      position: point,
      volume: destroyed ? 0.95 : 0.7,
      pitch: destroyed ? 0.95 : 1.25,
    });

    if (!destroyed) return;

    clampObj.alive = false;
    if (clampObj.mesh) clampObj.mesh.visible = false;
    if (clampObj.collider) {
      clampObj.collider.setEnabled(false);
    }

    const remaining = this.clampsRemaining;
    this.ctx.camera?.addTrauma?.(0.22);
    this.def.onClampDestroyed?.(clampObj.index, remaining, clampObj.worldPos.clone());

    if (remaining === 0 && this._state === 'jammed') {
      this._verticalSpeed = 6;
      this.setState('falling');
      const pos = _tmpVec.set(this.centerX, this._cabY + 2, this.centerZ);
      this.ctx.audio?.play?.('metal_groan', { position: pos, volume: 1.0, pitch: 0.55 });
      this.ctx.audio?.play?.('stake_twang', { position: pos, volume: 0.95, pitch: 0.65 });
      this.ctx.camera?.addTrauma?.(0.5);
    }
  }

  private restoreClamps(): void {
    for (const c of this.clamps) {
      c.hp = c.maxHp;
      c.alive = true;
      if (c.mesh) c.mesh.visible = true;
      if (c.collider) c.collider.setEnabled(true);
    }
  }

  private destroyAllClampsSilent(): void {
    for (const c of this.clamps) {
      c.hp = 0;
      c.alive = false;
      if (c.mesh) c.mesh.visible = false;
      if (c.collider) c.collider.setEnabled(false);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Kinematic floor physics & safe player ride tracking
  // -------------------------------------------------------------------------------------------

  private initPhysics(): void {
    const phys = this.ctx.physics;
    if (!phys?.world || !phys?.R) return;

    const halfThick = ELEVATOR_DEFAULTS.floorThickness * 0.5;
    const bodyDesc = phys.R.RigidBodyDesc.kinematicPositionBased().setTranslation(
      this.centerX,
      this._cabY - halfThick,
      this.centerZ,
    );
    this.floorBody = phys.world.createRigidBody(bodyDesc);
    const colDesc = phys.R.ColliderDesc.cuboid(this.halfSize, halfThick, this.halfSize)
      .setCollisionGroups(rapierGroups(CG.World, 0xffff))
      .setFriction(0.9);
    this.floorCollider = phys.world.createCollider(colDesc, this.floorBody);
    (phys as { register?: (c: RAPIER.Collider, s: 'metal') => void }).register?.(this.floorCollider, 'metal');
  }

  private initClamps(): void {
    const inset = this.halfSize - 0.35;
    const clampY = 2.55;
    const offsets: readonly [number, number, number][] = [
      [-inset, clampY, -inset],
      [inset, clampY, -inset],
      [-inset, clampY, inset],
      [inset, clampY, inset],
    ];

    const phys = this.ctx.physics;
    for (let i = 0; i < offsets.length; i++) {
      const [ox, oy, oz] = offsets[i]!;
      const localOffset = new THREE.Vector3(ox, oy, oz);
      const worldPos = new THREE.Vector3(this.centerX + ox, this._cabY + oy, this.centerZ + oz);
      let body: RAPIER.RigidBody | null = null;
      let collider: RAPIER.Collider | null = null;

      if (phys?.world && phys?.R) {
        const bDesc = phys.R.RigidBodyDesc.kinematicPositionBased().setTranslation(
          worldPos.x,
          worldPos.y,
          worldPos.z,
        );
        body = phys.world.createRigidBody(bDesc);
        const cDesc = phys.R.ColliderDesc.cuboid(0.45, 0.45, 0.45)
          .setCollisionGroups(rapierGroups(CG.World, 0xffff));
        collider = phys.world.createCollider(cDesc, body);
        (phys as { register?: (c: RAPIER.Collider, s: 'metal') => void }).register?.(collider, 'metal');
      }

      const clampObj: BrakeClampInternal = {
        index: i,
        localOffset,
        worldPos,
        hp: this.clampHp,
        maxHp: this.clampHp,
        alive: true,
        body,
        collider,
        mesh: null,
        glowMat: null,
      };
      this.clamps.push(clampObj);
      if (collider) {
        this.clampByHandle.set(collider.handle, clampObj);
      }
    }
  }

  private syncTransforms(immediate: boolean): void {
    const halfThick = ELEVATOR_DEFAULTS.floorThickness * 0.5;
    const floorCenterY = this._cabY - halfThick;

    if (this.floorBody) {
      if (immediate) {
        this.floorBody.setTranslation({ x: this.centerX, y: floorCenterY, z: this.centerZ }, true);
      } else {
        this.floorBody.setNextKinematicTranslation({ x: this.centerX, y: floorCenterY, z: this.centerZ });
      }
    }

    for (let i = 0; i < this.clamps.length; i++) {
      const c = this.clamps[i]!;
      c.worldPos.set(
        this.centerX + c.localOffset.x,
        this._cabY + c.localOffset.y,
        this.centerZ + c.localOffset.z,
      );
      if (c.body) {
        if (immediate) {
          c.body.setTranslation({ x: c.worldPos.x, y: c.worldPos.y, z: c.worldPos.z }, true);
        } else {
          c.body.setNextKinematicTranslation({ x: c.worldPos.x, y: c.worldPos.y, z: c.worldPos.z });
        }
      }
    }

    if (this.visuals) {
      this.visuals.cabGroup.position.set(this.centerX, this._cabY, this.centerZ);
      const slide = this._doorOpen * (this.halfSize * 0.85);
      this.visuals.doorLeft.position.x = -this.halfSize * 0.5 - slide;
      this.visuals.doorRight.position.x = this.halfSize * 0.5 + slide;
    }
  }

  /**
   * Keeps the player safely riding on the kinematic floor during descent and freefall without
   * clipping through the deck or losing horizontal combat mobility / camera look.
   */
  private carryPlayerIfInside(prevCabY: number): void {
    const player = this.ctx.player;
    if (!player || !player.alive || player.parked) return;
    if (!this.isInsideFootprint(player.position, 0.08)) return;

    const py = player.position.y;
    const insideVertically = py >= Math.min(prevCabY, this._cabY) - 1.5 && py <= Math.max(prevCabY, this._cabY) + this.cabHeight;
    if (!insideVertically) return;

    const movingDown = this._state === 'descending_1' || this._state === 'falling';
    const belowFloor = py < this._cabY - 0.01;
    const ridingFloor = movingDown && py <= prevCabY + 0.75 && player.velocity.y <= 1.0;

    if (!belowFloor && !ridingFloor) return;

    const savedYaw = player.yaw;
    const savedPitch = player.pitch;
    const savedVx = player.velocity.x;
    const savedVz = player.velocity.z;

    _tmpFeet.set(player.position.x, this._cabY + 0.01, player.position.z);
    player.teleport(_tmpFeet, savedYaw);

    // Restore mouse look and lateral combat movement inside the cab.
    player.pitch = savedPitch;
    const cp = Math.cos(savedPitch);
    player.forward.set(-Math.sin(savedYaw) * cp, Math.sin(savedPitch), -Math.cos(savedYaw) * cp);
    player.velocity.set(savedVx, movingDown ? -this._verticalSpeed : 0, savedVz);
  }

  // -------------------------------------------------------------------------------------------
  // Procedural 3D cage, emergency beacons, clamps & rushing neon shaft strips
  // -------------------------------------------------------------------------------------------

  private buildVisuals(): ElevatorVisuals | null {
    const scene = this.ctx.render?.scene;
    if (!scene) return null;

    const root = new THREE.Group();
    const cabGroup = new THREE.Group();
    cabGroup.position.set(this.centerX, this._cabY, this.centerZ);
    cabGroup.rotation.y = this.doorYaw;
    root.add(cabGroup);

    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];

    const deckMat = new THREE.MeshStandardMaterial({ color: 0x383f47, roughness: 0.65, metalness: 0.7 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x252a30, roughness: 0.5, metalness: 0.85 });
    const hazardMat = new THREE.MeshStandardMaterial({ color: 0xe68a19, roughness: 0.5, metalness: 0.45 });
    const meshWallMat = new THREE.MeshStandardMaterial({
      color: 0x4c5866,
      roughness: 0.45,
      metalness: 0.8,
      transparent: true,
      opacity: 0.42,
      wireframe: false,
    });
    const beaconMat = new THREE.MeshStandardMaterial({
      color: 0xff2222,
      emissive: 0xff1111,
      emissiveIntensity: 0.15,
      roughness: 0.25,
      metalness: 0.2,
    });
    const stripMat = new THREE.MeshStandardMaterial({
      color: 0x33e6ff,
      emissive: 0x22d8ff,
      emissiveIntensity: 1.5,
      roughness: 0.2,
      metalness: 0.1,
    });
    const grateMat = new THREE.MeshStandardMaterial({
      color: 0x555f6b,
      roughness: 0.6,
      metalness: 0.8,
    });
    materials.push(deckMat, frameMat, hazardMat, meshWallMat, beaconMat, stripMat, grateMat);

    // 6 m x 6 m industrial floor deck.
    const deckGeo = new THREE.BoxGeometry(this.size, ELEVATOR_DEFAULTS.floorThickness, this.size);
    geometries.push(deckGeo);
    const deck = new THREE.Mesh(deckGeo, deckMat);
    deck.position.y = -ELEVATOR_DEFAULTS.floorThickness * 0.5;
    deck.receiveShadow = true;
    cabGroup.add(deck);

    // Hazard safety edge strips along the floor perimeter.
    const trimGeo = new THREE.BoxGeometry(this.size + 0.06, 0.14, 0.2);
    geometries.push(trimGeo);
    for (const zSign of [-1, 1]) {
      const trim = new THREE.Mesh(trimGeo, hazardMat);
      trim.position.set(0, -0.04, zSign * (this.halfSize - 0.08));
      cabGroup.add(trim);
    }

    // 4 corner structural I-beam posts.
    const postGeo = new THREE.BoxGeometry(0.24, this.cabHeight, 0.24);
    geometries.push(postGeo);
    const cornerInset = this.halfSize - 0.12;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const post = new THREE.Mesh(postGeo, frameMat);
        post.position.set(sx * cornerInset, this.cabHeight * 0.5, sz * cornerInset);
        cabGroup.add(post);
      }
    }

    // Open wire-mesh side walls (back, left, right — front has sliding doors).
    const railGeo = new THREE.BoxGeometry(this.size - 0.3, 0.1, 0.08);
    geometries.push(railGeo);
    for (let h = 0.7; h < this.cabHeight; h += 0.9) {
      const backRail = new THREE.Mesh(railGeo, frameMat);
      backRail.position.set(0, h, -this.halfSize + 0.08);
      cabGroup.add(backRail);

      for (const sx of [-1, 1]) {
        const sideRail = new THREE.Mesh(railGeo, frameMat);
        sideRail.rotation.y = Math.PI * 0.5;
        sideRail.position.set(sx * (this.halfSize - 0.08), h, 0);
        cabGroup.add(sideRail);
      }
    }

    const panelGeo = new THREE.BoxGeometry(this.size - 0.4, this.cabHeight - 0.4, 0.04);
    geometries.push(panelGeo);
    const backPanel = new THREE.Mesh(panelGeo, meshWallMat);
    backPanel.position.set(0, this.cabHeight * 0.5, -this.halfSize + 0.06);
    cabGroup.add(backPanel);

    // Top ceiling frame with open central escape/rappel hatch.
    const headerGeo = new THREE.BoxGeometry(this.size, 0.22, 0.35);
    geometries.push(headerGeo);
    for (const sz of [-1, 1]) {
      const beam = new THREE.Mesh(headerGeo, frameMat);
      beam.position.set(0, this.cabHeight, sz * (this.halfSize - 0.18));
      cabGroup.add(beam);
    }

    // Sliding front freight doors.
    const doorGeo = new THREE.BoxGeometry(this.halfSize - 0.08, this.cabHeight - 0.2, 0.14);
    geometries.push(doorGeo);
    const doorLeft = new THREE.Mesh(doorGeo, frameMat);
    doorLeft.position.set(-this.halfSize * 0.5, (this.cabHeight - 0.2) * 0.5, this.halfSize - 0.08);
    const doorRight = new THREE.Mesh(doorGeo, frameMat);
    doorRight.position.set(this.halfSize * 0.5, (this.cabHeight - 0.2) * 0.5, this.halfSize - 0.08);
    cabGroup.add(doorLeft, doorRight);

    // Twin overhead emergency beacon domes.
    const beaconGeo = new THREE.CylinderGeometry(0.18, 0.22, 0.24, 10);
    geometries.push(beaconGeo);
    const beaconMeshes: THREE.Mesh[] = [];
    for (const sx of [-1.4, 1.4]) {
      const b = new THREE.Mesh(beaconGeo, beaconMat);
      b.position.set(sx, this.cabHeight - 0.2, -this.halfSize + 0.45);
      cabGroup.add(b);
      beaconMeshes.push(b);
    }

    // 4 shootable glowing hydraulic brake clamps mounted at the 4 shaft corners.
    const clampGeo = new THREE.BoxGeometry(0.62, 0.52, 0.62);
    geometries.push(clampGeo);
    for (const c of this.clamps) {
      const cMat = new THREE.MeshStandardMaterial({
        color: 0xff3b22,
        emissive: 0xff2200,
        emissiveIntensity: 0.4,
        roughness: 0.3,
        metalness: 0.5,
      });
      materials.push(cMat);
      const mesh = new THREE.Mesh(clampGeo, cMat);
      mesh.position.copy(c.localOffset);
      cabGroup.add(mesh);
      c.mesh = mesh;
      c.glowMat = cMat;
    }

    // Rushing neon floor-number light strips scrolling upward past the shaft walls.
    const stripGroup = new THREE.Group();
    root.add(stripGroup);
    const stripGeo = new THREE.BoxGeometry(0.12, 0.16, this.size * 0.72);
    geometries.push(stripGeo);
    const stripMeshes: THREE.Mesh[] = [];
    for (let i = 0; i < ELEVATOR_DEFAULTS.stripCount; i++) {
      for (const sx of [-1, 1]) {
        const s = new THREE.Mesh(stripGeo, stripMat);
        s.position.set(this.centerX + sx * (this.halfSize + 0.55), this._cabY, this.centerZ);
        stripGroup.add(s);
        stripMeshes.push(s);
      }
    }

    // Breakable datacenter ceiling grate smashed during `falling`.
    const ceilingGrate = new THREE.Group();
    ceilingGrate.position.set(this.centerX, this.ceilingGrateY, this.centerZ);
    const grateBarGeo = new THREE.BoxGeometry(this.size + 0.6, 0.18, 0.24);
    geometries.push(grateBarGeo);
    for (let i = -2; i <= 2; i++) {
      const bar = new THREE.Mesh(grateBarGeo, grateMat);
      bar.position.z = i * 1.1;
      ceilingGrate.add(bar);
    }
    root.add(ceilingGrate);

    scene.add(root);
    return {
      root,
      cabGroup,
      doorLeft,
      doorRight,
      beaconMeshes,
      beaconMat,
      stripGroup,
      stripMeshes,
      stripMat,
      ceilingGrate,
      geometries,
      materials,
    };
  }

  private updateVisualFX(): void {
    const v = this.visuals;
    if (!v) return;

    const emergency = this._state === 'jammed' || this._state === 'falling';
    const pulse = 0.5 + 0.5 * Math.sin(this.clock * (this._state === 'falling' ? 16 : 8));
    v.beaconMat.emissiveIntensity = emergency ? 0.8 + pulse * 2.4 : 0.12;

    // Brighten brake clamps sharply while jammed so players spot all 4 instantly.
    for (const c of this.clamps) {
      if (!c.glowMat) continue;
      if (this._state === 'jammed' && c.alive) {
        const dmgRatio = 1 - c.hp / Math.max(c.maxHp, 1);
        c.glowMat.emissiveIntensity = 1.6 + pulse * 1.4 + dmgRatio * 1.2;
      } else {
        c.glowMat.emissiveIntensity = 0.25;
      }
    }

    // Scroll neon floor-number light strips vertically around the cab.
    const span = ELEVATOR_DEFAULTS.stripCount * ELEVATOR_DEFAULTS.stripSpacing;
    const halfSpan = span * 0.5;
    const activeShaft = this._state === 'descending_1' || this._state === 'jammed' || this._state === 'falling';
    v.stripGroup.visible = activeShaft;
    if (activeShaft) {
      v.stripMat.color.setHex(emergency ? 0xff4422 : 0x33e6ff);
      v.stripMat.emissive.setHex(emergency ? 0xff2200 : 0x22d8ff);
      for (let i = 0; i < ELEVATOR_DEFAULTS.stripCount; i++) {
        const raw = (i * ELEVATOR_DEFAULTS.stripSpacing + this._scrollOffset) % span;
        const y = this._cabY - halfSpan + raw;
        const left = v.stripMeshes[i * 2];
        const right = v.stripMeshes[i * 2 + 1];
        if (left) left.position.y = y;
        if (right) right.position.y = y;
      }
    }
  }
}
