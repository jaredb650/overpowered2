/**
 * Sweeping CCTV security cameras for stealth infiltration missions ("Quiet Title").
 *
 * Each camera builds a procedural mount + articulated head + lens + status LED + translucent
 * vision cone, registers a static `'metal'` Rapier collider (1 shot destroys it with sparks and
 * a 10 m sound radius), sweeps smoothly across its arc with brief pauses at the ends, and fills
 * a 2.0 s lock meter when an unoccluded player enters its low-light vision cone.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { CG, type Ctx, type RayHit } from '../core/contracts';
import { clamp } from '../core/math';
import type { Mat } from './kit/geo';

export interface CameraSpec {
  id: string;
  position: readonly [number, number, number];
  /** Center yaw in radians (0 = -Z). */
  yaw: number;
  /** Downward pitch in radians (default 0.35). */
  pitch?: number;
  /** Sweep half-angle in radians (default 0.65). */
  sweepAngle?: number;
  /** Sweep angular speed in rad/s (default 0.45). */
  sweepSpeed?: number;
  /** Detection range in meters (default 22). */
  range?: number;
  /** Optional breaker circuit group id. */
  group?: string;
}

export interface CameraSystemOptions {
  /** Fired when a camera reaches full lock (1.0) on the player. */
  onAlert?: (cameraId: string, playerEye: THREE.Vector3) => void;
  /** Fired when a camera is destroyed by gunfire or blast (emits a 10 m sound radius). */
  onDestroyed?: (position: THREE.Vector3, cameraId: string, soundRadius: number) => void;
  /** Optional world material lookup matching World.material. */
  material?: (mat: Mat) => THREE.Material;
}

/** Read-only runtime state snapshot of a single security camera. */
export interface CameraState {
  readonly id: string;
  readonly group: string | undefined;
  readonly position: THREE.Vector3;
  readonly headWorldPos: THREE.Vector3;
  readonly yaw: number;
  readonly pitch: number;
  readonly sweepAngle: number;
  readonly sweepSpeed: number;
  readonly range: number;
  readonly currentYaw: number;
  readonly lock: number;
  readonly powered: boolean;
  readonly destroyed: boolean;
  readonly alerted: boolean;
  readonly seeing: boolean;
  readonly collider: RAPIER.Collider | null;
}

export const LOCK_SECONDS = 2.0;
export const LOCK_DECAY = 0.6;
export const CONE_HALF_ANGLE = 0.38;
export const SWEEP_PAUSE_SECONDS = 0.8;
export const CAMERA_DEFAULT_PITCH = 0.35;
export const CAMERA_DEFAULT_SWEEP_ANGLE = 0.65;
export const CAMERA_DEFAULT_SWEEP_SPEED = 0.45;
export const CAMERA_DEFAULT_RANGE = 22;
export const CAMERA_DESTROY_SOUND_RADIUS = 10;

const COS_CONE = Math.cos(CONE_HALF_ANGLE);
const MIN_LIGHT_RANGE_SCALE = 0.6;
const HEAD_OFFSET_Y = -0.14;
const RAY_START_OFFSET = 0.36;

const COLOR_LED_IDLE = 0x38ffaa;
const COLOR_LED_SPOT = 0xffaa22;
const COLOR_LED_LOCK = 0xff2222;
const COLOR_LED_OFF = 0x111518;

const COLOR_CONE_IDLE = 0x38d8ff;
const COLOR_CONE_SPOT = 0xffaa22;
const COLOR_CONE_LOCK = 0xff2222;

const UP = new THREE.Vector3(0, 1, 0);
const COLLIDER_HALF = new THREE.Vector3(0.26, 0.22, 0.26);

// Pre-allocated scratch buffers so update() performs zero allocations.
const _camFwd = new THREE.Vector3();
const _toPlayer = new THREE.Vector3();
const _rayOrigin = new THREE.Vector3();
const _alertPos = new THREE.Vector3();
const _rayHit: RayHit = {
  point: new THREE.Vector3(),
  normal: new THREE.Vector3(),
  distance: 0,
  surface: 'concrete',
  collider: null,
};

type VisualMode = 'idle' | 'spot' | 'lock' | 'off';

interface CameraRuntime {
  readonly id: string;
  readonly group: string | undefined;
  readonly position: THREE.Vector3;
  readonly headWorldPos: THREE.Vector3;
  readonly yaw: number;
  readonly pitch: number;
  readonly sweepAngle: number;
  readonly sweepSpeed: number;
  readonly range: number;
  currentYaw: number;
  sweepOffset: number;
  sweepDir: 1 | -1;
  pauseTimer: number;
  lock: number;
  powered: boolean;
  destroyed: boolean;
  alerted: boolean;
  seeing: boolean;
  visualMode: VisualMode;
  collider: RAPIER.Collider | null;
  readonly mountGroup: THREE.Group;
  readonly headGroup: THREE.Group;
  readonly bodyMesh: THREE.Mesh;
  readonly ledMesh: THREE.Mesh;
  readonly coneMesh: THREE.Mesh;
}

export class CameraSystem {
  readonly root = new THREE.Group();
  private readonly list: CameraRuntime[] = [];
  private readonly byId = new Map<string, CameraRuntime>();
  private readonly byCollider = new Map<number, CameraRuntime>();
  private readonly thermalCache: THREE.Object3D[] = [];
  private readonly ownedGeos: THREE.BufferGeometry[] = [];
  private readonly ownedMats: THREE.Material[] = [];
  private readonly ledMats: Record<VisualMode, THREE.MeshBasicMaterial>;
  private readonly coneMats: Record<'idle' | 'spot' | 'lock', THREE.MeshBasicMaterial>;
  private readonly onAlert?: (cameraId: string, playerEye: THREE.Vector3) => void;
  private readonly onDestroyed?: (position: THREE.Vector3, cameraId: string, soundRadius: number) => void;

  constructor(
    private readonly ctx: Ctx,
    specs: readonly CameraSpec[],
    options: CameraSystemOptions = {},
  ) {
    this.root.name = 'security-cameras';
    this.root.matrixAutoUpdate = false;
    this.root.updateMatrix();
    this.onAlert = options.onAlert;
    this.onDestroyed = options.onDestroyed;

    const steelDarkMat = this.resolveMat(options.material, 'steelDark', 0x2a313a, 0.72, 0.45);
    const steelMat = this.resolveMat(options.material, 'steel', 0x626e7c, 0.7, 0.38);
    const lensMat = new THREE.MeshStandardMaterial({ color: 0x090d14, metalness: 0.25, roughness: 0.12 });
    const makeConeMat = (color: number, opacity: number) => new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.ledMats = {
      idle: new THREE.MeshBasicMaterial({ color: COLOR_LED_IDLE, toneMapped: false }),
      spot: new THREE.MeshBasicMaterial({ color: COLOR_LED_SPOT, toneMapped: false }),
      lock: new THREE.MeshBasicMaterial({ color: COLOR_LED_LOCK, toneMapped: false }),
      off: new THREE.MeshBasicMaterial({ color: COLOR_LED_OFF, toneMapped: false }),
    };
    this.coneMats = {
      idle: makeConeMat(COLOR_CONE_IDLE, 0.11),
      spot: makeConeMat(COLOR_CONE_SPOT, 0.18),
      lock: makeConeMat(COLOR_CONE_LOCK, 0.26),
    };
    this.ownedMats.push(
      lensMat,
      this.ledMats.idle, this.ledMats.spot, this.ledMats.lock, this.ledMats.off,
      this.coneMats.idle, this.coneMats.spot, this.coneMats.lock,
    );

    // Shared procedural geometry parts for mount, articulated head, sunshield, lens, and LED.
    const basePlateGeo = new THREE.BoxGeometry(0.16, 0.05, 0.16);
    const stemGeo = new THREE.CylinderGeometry(0.032, 0.04, 0.16, 10);
    const swivelGeo = new THREE.SphereGeometry(0.055, 10, 8);
    const chassisGeo = new THREE.BoxGeometry(0.2, 0.15, 0.34);
    const hoodGeo = new THREE.BoxGeometry(0.23, 0.035, 0.4);
    const barrelGeo = new THREE.CylinderGeometry(0.048, 0.055, 0.08, 12);
    barrelGeo.rotateX(Math.PI / 2);
    const glassGeo = new THREE.CircleGeometry(0.042, 12);
    const ledGeo = new THREE.SphereGeometry(0.022, 8, 6);
    this.ownedGeos.push(basePlateGeo, stemGeo, swivelGeo, chassisGeo, hoodGeo, barrelGeo, glassGeo, ledGeo);
    const coneGeoCache = new Map<number, THREE.ConeGeometry>();

    const freeze = (o: THREE.Object3D): void => {
      o.matrixAutoUpdate = false;
      o.updateMatrix();
    };

    for (const spec of specs) {
      const pitch = spec.pitch ?? CAMERA_DEFAULT_PITCH;
      const sweepAngle = Math.max(0, spec.sweepAngle ?? CAMERA_DEFAULT_SWEEP_ANGLE);
      const sweepSpeed = Math.max(0, spec.sweepSpeed ?? CAMERA_DEFAULT_SWEEP_SPEED);
      const range = Math.max(1, spec.range ?? CAMERA_DEFAULT_RANGE);

      const position = new THREE.Vector3(spec.position[0], spec.position[1], spec.position[2]);
      const headWorldPos = new THREE.Vector3(position.x, position.y + HEAD_OFFSET_Y, position.z);

      const mountGroup = new THREE.Group();
      mountGroup.name = `cam_${spec.id}`;
      mountGroup.position.copy(position);
      freeze(mountGroup);

      const plate = new THREE.Mesh(basePlateGeo, steelDarkMat);
      plate.position.set(0, 0.02, 0);
      freeze(plate);
      mountGroup.add(plate);

      const stem = new THREE.Mesh(stemGeo, steelMat);
      stem.position.set(0, -0.06, 0);
      freeze(stem);
      mountGroup.add(stem);

      const swivel = new THREE.Mesh(swivelGeo, steelDarkMat);
      swivel.position.set(0, HEAD_OFFSET_Y, 0);
      freeze(swivel);
      mountGroup.add(swivel);

      const headGroup = new THREE.Group();
      headGroup.position.set(0, HEAD_OFFSET_Y, 0);
      headGroup.rotation.order = 'YXZ';
      headGroup.rotation.set(-pitch, spec.yaw, 0);
      freeze(headGroup);
      mountGroup.add(headGroup);

      const bodyMesh = new THREE.Mesh(chassisGeo, steelDarkMat);
      bodyMesh.position.set(0, 0, -0.04);
      bodyMesh.castShadow = true;
      bodyMesh.receiveShadow = true;
      bodyMesh.userData.dynamicShadow = true;
      freeze(bodyMesh);
      headGroup.add(bodyMesh);

      const hood = new THREE.Mesh(hoodGeo, steelMat);
      hood.position.set(0, 0.088, -0.07);
      freeze(hood);
      headGroup.add(hood);

      const barrel = new THREE.Mesh(barrelGeo, steelMat);
      barrel.position.set(0, -0.01, -0.23);
      freeze(barrel);
      headGroup.add(barrel);

      const glass = new THREE.Mesh(glassGeo, lensMat);
      glass.position.set(0, -0.01, -0.272);
      glass.rotation.y = Math.PI;
      freeze(glass);
      headGroup.add(glass);

      const ledMesh = new THREE.Mesh(ledGeo, this.ledMats.idle);
      ledMesh.position.set(0.065, -0.055, -0.215);
      freeze(ledMesh);
      headGroup.add(ledMesh);

      // Subtle translucent vision cone extending along local -Z from the lens.
      const coneLen = Math.min(range * 0.55, 11);
      const coneKey = Math.round(coneLen * 100);
      let coneGeo = coneGeoCache.get(coneKey);
      if (!coneGeo) {
        const coneRadius = coneLen * Math.tan(CONE_HALF_ANGLE);
        coneGeo = new THREE.ConeGeometry(coneRadius, coneLen, 20, 1, true);
        coneGeo.translate(0, -coneLen * 0.5, 0);
        coneGeo.rotateX(Math.PI / 2);
        coneGeoCache.set(coneKey, coneGeo);
        this.ownedGeos.push(coneGeo);
      }

      const coneMesh = new THREE.Mesh(coneGeo, this.coneMats.idle);
      coneMesh.position.set(0, -0.01, -0.26);
      coneMesh.renderOrder = 2;
      freeze(coneMesh);
      headGroup.add(coneMesh);

      this.root.add(mountGroup);

      const collider = this.createCollider(headWorldPos);

      const runtime: CameraRuntime = {
        id: spec.id,
        group: spec.group,
        position,
        headWorldPos,
        yaw: spec.yaw,
        pitch,
        sweepAngle,
        sweepSpeed,
        range,
        currentYaw: spec.yaw,
        sweepOffset: 0,
        sweepDir: 1,
        pauseTimer: 0,
        lock: 0,
        powered: true,
        destroyed: false,
        alerted: false,
        seeing: false,
        visualMode: 'idle',
        collider,
        mountGroup,
        headGroup,
        bodyMesh,
        ledMesh,
        coneMesh,
      };

      this.list.push(runtime);
      this.byId.set(spec.id, runtime);
      if (collider) this.byCollider.set(collider.handle, runtime);
    }

    this.rebuildThermalCache();
  }

  private resolveMat(
    lookup: ((mat: Mat) => THREE.Material) | undefined,
    name: Mat,
    fallbackColor: number,
    metalness: number,
    roughness: number,
  ): THREE.Material {
    if (lookup) return lookup(name);
    const m = new THREE.MeshStandardMaterial({ color: fallbackColor, metalness, roughness });
    this.ownedMats.push(m);
    return m;
  }

  private createCollider(center: THREE.Vector3): RAPIER.Collider | null {
    if (!this.ctx.physics?.addStaticBox) return null;
    return this.ctx.physics.addStaticBox(center, COLLIDER_HALF, null, 'metal');
  }

  private removeCollider(cam: CameraRuntime): void {
    if (!cam.collider) return;
    this.byCollider.delete(cam.collider.handle);
    this.ctx.physics?.world?.removeCollider(cam.collider, false);
    cam.collider = null;
  }

  private rebuildThermalCache(): void {
    this.thermalCache.length = 0;
    for (let i = 0; i < this.list.length; i++) {
      const c = this.list[i]!;
      if (!c.destroyed && c.powered) this.thermalCache.push(c.bodyMesh);
    }
  }

  private applyVisual(cam: CameraRuntime, mode: VisualMode): void {
    if (cam.visualMode === mode) return;
    cam.visualMode = mode;
    cam.ledMesh.material = this.ledMats[mode];
    if (mode === 'off') {
      cam.coneMesh.visible = false;
      return;
    }
    cam.coneMesh.visible = true;
    cam.coneMesh.material = this.coneMats[mode];
  }

  /** True if `collider` belongs to an active (undestroyed) security camera. */
  isCollider(collider: RAPIER.Collider | null): boolean {
    return collider !== null && this.byCollider.has(collider.handle);
  }

  /** 1 shot destroys a camera, emitting sparks and a 10 m sound event. Returns true if a camera was struck. */
  damageCollider(collider: RAPIER.Collider | null, amount = 1): boolean {
    if (!collider || amount <= 0) return false;
    const cam = this.byCollider.get(collider.handle);
    if (!cam || cam.destroyed) return false;
    this.destroyCamera(cam);
    return true;
  }

  /** Destroys a camera by id. Returns true if it transitioned from intact to destroyed. */
  destroy(id: string): boolean {
    const cam = this.byId.get(id);
    if (!cam || cam.destroyed) return false;
    this.destroyCamera(cam);
    return true;
  }

  /** Destroys any intact cameras within `radius` of `center`. Returns how many were destroyed. */
  blast(center: THREE.Vector3, radius: number): number {
    if (radius <= 0) return 0;
    const r2 = radius * radius;
    let count = 0;
    for (let i = 0; i < this.list.length; i++) {
      const cam = this.list[i]!;
      if (cam.destroyed) continue;
      if (cam.headWorldPos.distanceToSquared(center) <= r2) {
        this.destroyCamera(cam);
        count++;
      }
    }
    return count;
  }

  private destroyCamera(cam: CameraRuntime): void {
    cam.destroyed = true;
    cam.lock = 0;
    cam.alerted = false;
    cam.seeing = false;
    this.removeCollider(cam);
    this.applyVisual(cam, 'off');
    // Drop and tilt the broken camera head downward.
    cam.headGroup.rotation.set(-1.28, cam.currentYaw + 0.18, 0.36);
    cam.headGroup.updateMatrix();

    this.ctx.fx?.sparks?.(cam.headWorldPos, UP, 18, 0xffd066);
    this.ctx.fx?.smoke?.(cam.headWorldPos, 0x2b3038, 0.65, 1.4);
    this.ctx.audio?.play?.('electric_zap', { position: cam.headWorldPos, volume: 0.6, pitch: 1.2 });
    this.ctx.audio?.play?.('metal_clang', { position: cam.headWorldPos, volume: 0.45, pitch: 1.6 });

    this.rebuildThermalCache();
    this.onDestroyed?.(cam.position, cam.id, CAMERA_DESTROY_SOUND_RADIUS);
  }

  /** Enables or cuts power to all cameras assigned to `group` (e.g. a circuit breaker zone). */
  setGroupPower(group: string, powered: boolean): void {
    let changed = false;
    for (let i = 0; i < this.list.length; i++) {
      const cam = this.list[i]!;
      if (cam.group !== group) continue;
      if (cam.powered === powered) continue;
      cam.powered = powered;
      changed = true;
      if (!powered) {
        cam.lock = 0;
        cam.alerted = false;
        cam.seeing = false;
        this.applyVisual(cam, 'off');
      } else if (!cam.destroyed) {
        this.applyVisual(cam, 'idle');
      }
    }
    if (changed) this.rebuildThermalCache();
  }

  /** Active camera head meshes that glow warm in Thermal Vision. */
  thermalMeshes(): readonly THREE.Object3D[] {
    return this.thermalCache;
  }

  /** Highest current lock progress (0..1) across all active cameras, for HUD warning display. */
  maxLock(): number {
    let best = 0;
    for (let i = 0; i < this.list.length; i++) {
      const cam = this.list[i]!;
      if (!cam.destroyed && cam.powered && cam.lock > best) best = cam.lock;
    }
    return best;
  }

  /** Read-only inspection of a camera by id. */
  getCamera(id: string): CameraState | undefined {
    return this.byId.get(id);
  }

  /** All cameras as read-only state views. */
  get cameras(): readonly CameraState[] {
    return this.list;
  }

  /**
   * Advances camera sweeps, performs zero-allocation cone & LOS checks against `playerEye`,
   * fills/decays lock meters, and fires `onAlert` at full lock.
   */
  update(dt: number, playerEye: THREE.Vector3, lightLevel = 1): void {
    if (dt <= 0) return;
    const lightScale = MIN_LIGHT_RANGE_SCALE + (1 - MIN_LIGHT_RANGE_SCALE) * clamp(lightLevel, 0, 1);

    for (let i = 0; i < this.list.length; i++) {
      const cam = this.list[i]!;
      if (cam.destroyed || !cam.powered) continue;

      const prevYaw = cam.currentYaw;

      // Current forward direction of the lens (yaw 0 = -Z, positive pitch = downward).
      const cp = Math.cos(cam.pitch);
      _camFwd.set(-Math.sin(cam.currentYaw) * cp, -Math.sin(cam.pitch), -Math.cos(cam.currentYaw) * cp);

      const seen = this.canSeePlayer(cam, playerEye, cam.range * lightScale);
      cam.seeing = seen;

      if (seen) {
        // Hold / gently track the spotted player within the camera's mechanical sweep arc.
        const horiz = Math.hypot(_toPlayer.x, _toPlayer.z);
        if (horiz > 0.05 && cam.sweepAngle > 0) {
          const desiredYaw = Math.atan2(-_toPlayer.x, -_toPlayer.z);
          let delta = desiredYaw - cam.yaw;
          delta = Math.atan2(Math.sin(delta), Math.cos(delta));
          const targetOffset = clamp(delta, -cam.sweepAngle, cam.sweepAngle);
          const diff = targetOffset - cam.sweepOffset;
          const maxStep = Math.max(cam.sweepSpeed * 1.5, 0.9) * dt;
          cam.sweepOffset += clamp(diff, -maxStep, maxStep);
          cam.currentYaw = cam.yaw + cam.sweepOffset;
        }

        cam.lock = Math.min(1, cam.lock + dt / LOCK_SECONDS);
        if (cam.lock >= 1) {
          this.applyVisual(cam, 'lock');
          if (!cam.alerted) {
            cam.alerted = true;
            _alertPos.copy(playerEye);
            this.ctx.audio?.play?.('stake_beep', { position: cam.headWorldPos, volume: 0.7, pitch: 1.45 });
            this.onAlert?.(cam.id, _alertPos);
          }
        } else {
          this.applyVisual(cam, 'spot');
        }
      } else {
        // Resume smooth ping-pong sweep with brief pause at arc ends.
        if (cam.sweepAngle > 0 && cam.sweepSpeed > 0) {
          if (cam.pauseTimer > 0) {
            cam.pauseTimer = Math.max(0, cam.pauseTimer - dt);
          } else {
            cam.sweepOffset += cam.sweepDir * cam.sweepSpeed * dt;
            if (cam.sweepOffset >= cam.sweepAngle) {
              cam.sweepOffset = cam.sweepAngle;
              cam.sweepDir = -1;
              cam.pauseTimer = SWEEP_PAUSE_SECONDS;
            } else if (cam.sweepOffset <= -cam.sweepAngle) {
              cam.sweepOffset = -cam.sweepAngle;
              cam.sweepDir = 1;
              cam.pauseTimer = SWEEP_PAUSE_SECONDS;
            }
          }
          cam.currentYaw = cam.yaw + cam.sweepOffset;
        }

        cam.lock = Math.max(0, cam.lock - dt * LOCK_DECAY);
        if (cam.lock <= 0) {
          cam.alerted = false;
          this.applyVisual(cam, 'idle');
        } else {
          this.applyVisual(cam, cam.alerted ? 'lock' : 'spot');
        }
      }

      if (cam.currentYaw !== prevYaw) {
        cam.headGroup.rotation.set(-cam.pitch, cam.currentYaw, 0);
        cam.headGroup.updateMatrix();
      }
    }
  }

  private canSeePlayer(cam: CameraRuntime, playerEye: THREE.Vector3, effectiveRange: number): boolean {
    _toPlayer.subVectors(playerEye, cam.headWorldPos);
    const distSq = _toPlayer.lengthSq();
    if (distSq > effectiveRange * effectiveRange) return false;
    if (distSq <= 1e-6) return true;

    const dist = Math.sqrt(distSq);
    const invDist = 1 / dist;
    _toPlayer.multiplyScalar(invDist);

    if (_camFwd.dot(_toPlayer) < COS_CONE) return false;

    const rayDist = dist - RAY_START_OFFSET - 0.1;
    if (rayDist <= 0.05) return true;

    const physics = this.ctx.physics;
    if (!physics) return true;

    _rayOrigin.copy(cam.headWorldPos).addScaledVector(_toPlayer, RAY_START_OFFSET);

    if (typeof physics.raycastInto === 'function') {
      const hit = physics.raycastInto(_rayOrigin, _toPlayer, rayDist, CG.World, _rayHit);
      if (!hit) return true;
      if (_rayHit.collider && cam.collider && _rayHit.collider.handle === cam.collider.handle) return true;
      return false;
    }

    const hit = physics.raycast?.(_rayOrigin, _toPlayer, rayDist, CG.World);
    if (!hit) return true;
    if (hit.collider && cam.collider && hit.collider.handle === cam.collider.handle) return true;
    return false;
  }

  /** Restores all cameras to intact, powered, initial sweep state. */
  reset(): void {
    for (let i = 0; i < this.list.length; i++) {
      const cam = this.list[i]!;
      cam.destroyed = false;
      cam.powered = true;
      cam.lock = 0;
      cam.alerted = false;
      cam.seeing = false;
      cam.sweepOffset = 0;
      cam.sweepDir = 1;
      cam.pauseTimer = 0;
      cam.currentYaw = cam.yaw;
      cam.headGroup.rotation.set(-cam.pitch, cam.yaw, 0);
      cam.headGroup.updateMatrix();
      this.applyVisual(cam, 'idle');

      if (!cam.collider) {
        const collider = this.createCollider(cam.headWorldPos);
        cam.collider = collider;
        if (collider) this.byCollider.set(collider.handle, cam);
      }
    }
    this.rebuildThermalCache();
  }

  /** Removes colliders, detaches from scene, and frees owned GPU resources. */
  dispose(): void {
    for (let i = 0; i < this.list.length; i++) {
      this.removeCollider(this.list[i]!);
    }
    this.root.removeFromParent();
    for (let i = 0; i < this.ownedGeos.length; i++) this.ownedGeos[i]!.dispose();
    for (let i = 0; i < this.ownedMats.length; i++) this.ownedMats[i]!.dispose();
    this.ownedGeos.length = 0;
    this.ownedMats.length = 0;
    this.thermalCache.length = 0;
  }
}
