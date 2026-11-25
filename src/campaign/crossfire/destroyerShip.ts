/**
 * Dynamic, Sinkable Southern Missile Destroyers (`SNS IRONCLAD` & `SNS BASTION`) for Crossfire Part 2 ("The Strait").
 *
 * Replaces static invincible map geometry with full 3D PBR stealth warships that carry a shared global
 * hull health pool (`DESTROYER_HULL_MAX_HP = 1500 HP`), missile lock-on center on the superstructure,
 * multi-part Rapier hull colliders, and a cinematic chain-explosion + listing + sinking animation.
 *
 * Players can sink each warship either by pouring AMRAAMs / AGMs / Vulcan cannons directly into the
 * hull OR by knocking out deck SAM/CIWS turrets (which also chunks hull HP). The moment a destroyer
 * reaches 0 HP it chain-detonates, immediately destroys all surviving turrets on its deck (never forcing
 * a hunt for tucked-away CIWS), lists hard to port/starboard, and slips beneath the ocean in fire & smoke.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Ctx, ExplosionKind } from '../../core/contracts';
import type { ExplosionSpec, MissileTarget, VehicleRadarTarget } from '../../core/gameplay';
import { clamp, rand } from '../../core/math';
import type { ExtraTarget, VehicleSystem } from '../../enemies/vehicles';
import { EXPLOSIONS } from '../../weapons/data';
import {
  DESTROYER_LOCAL_MOUNTS,
  type StraitShipPose,
} from '../../world/map/strait/plan';

export const DESTROYER_HULL_MAX_HP = 1500;
export const DESTROYER_TURRET_KILL_HULL_DAMAGE = 340;
export const DESTROYER_TURRET_HIT_PASS_RATIO = 0.35;
const SINK_DURATION_SECONDS = 5.8;

let nextShipUid = 680_000;

const _up = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _half = new THREE.Vector3();
const _quat = new THREE.Quaternion();

interface PendingShipBlast {
  pos: THREE.Vector3;
  delay: number;
  radius: number;
}

interface BuiltWarshipRig {
  root: THREE.Group;
  hullGroup: THREE.Group;
  wakeGroup: THREE.Group;
  meshes: THREE.Mesh[];
  emissiveMeshes: THREE.Mesh[];
  materials: THREE.Material[];
}

function addPart(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  meshes: THREE.Mesh[],
  rotY = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (rotY !== 0) m.rotation.y = rotY;
  parent.add(m);
  meshes.push(m);
  return m;
}

/**
 * Builds a detailed 3D PBR Southern Missile Destroyer matching `authorNavalEscort(..., true)`
 * with separated `hullGroup` (lists & sinks) and `wakeGroup` (fades at waterline).
 */
function buildDestroyerRig(): BuiltWarshipRig {
  const root = new THREE.Group();
  const hullGroup = new THREE.Group();
  const wakeGroup = new THREE.Group();
  root.add(hullGroup);
  root.add(wakeGroup);

  const meshes: THREE.Mesh[] = [];
  const emissiveMeshes: THREE.Mesh[] = [];

  const redBootMat = new THREE.MeshStandardMaterial({ color: 0x8a2624, roughness: 0.72, metalness: 0.25 });
  const hullSteelMat = new THREE.MeshStandardMaterial({ color: 0x566070, roughness: 0.56, metalness: 0.58 });
  const superSteelMat = new THREE.MeshStandardMaterial({ color: 0x626c7a, roughness: 0.52, metalness: 0.55 });
  const darkSteelMat = new THREE.MeshStandardMaterial({ color: 0x3b424d, roughness: 0.58, metalness: 0.62 });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x454b54, roughness: 0.88, metalness: 0.14 });
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x8d97a6, roughness: 0.45, metalness: 0.48 });
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xe2e6f0, roughness: 0.6, metalness: 0.1 });
  const yellowMat = new THREE.MeshStandardMaterial({ color: 0xf4c42e, roughness: 0.52, metalness: 0.15 });
  const hazardMat = new THREE.MeshStandardMaterial({ color: 0xe69c36, roughness: 0.55, metalness: 0.25 });
  const emissiveRedMat = new THREE.MeshStandardMaterial({
    color: 0xff402b,
    emissive: 0xff3622,
    emissiveIntensity: 2.2,
    roughness: 0.25,
  });
  const emissiveOrangeMat = new THREE.MeshStandardMaterial({
    color: 0xff8c2b,
    emissive: 0xff6e1a,
    emissiveIntensity: 1.8,
    roughness: 0.28,
  });
  const wakeMat = new THREE.MeshBasicMaterial({
    color: 0xc2e2f5,
    transparent: true,
    opacity: 0.68,
    depthWrite: false,
  });

  const materials: THREE.Material[] = [
    redBootMat,
    hullSteelMat,
    superSteelMat,
    darkSteelMat,
    deckMat,
    panelMat,
    whiteMat,
    yellowMat,
    hazardMat,
    emissiveRedMat,
    emissiveOrangeMat,
    wakeMat,
  ];

  const hullScale = 1.18;
  const hx = 6.2 * hullScale;
  const hz = 38 * hullScale;

  // Red anti-fouling waterline boot-top
  addPart(hullGroup, new THREE.BoxGeometry(hx * 1.92, 2.6, hz * 2.0), redBootMat, 0, 0.1, 0, meshes);
  addPart(hullGroup, new THREE.BoxGeometry(hx * 1.12, 2.6, 13.6), redBootMat, 0, 0.1, -(hz + 6.5), meshes);

  // Main armored stealth naval hull + pointed raked bow prow
  addPart(hullGroup, new THREE.BoxGeometry(hx * 2.0, 4.8, (hz + 1) * 2.0), hullSteelMat, 0, 3.4, 0, meshes);
  addPart(hullGroup, new THREE.BoxGeometry(hx * 1.24, 4.4, 13.6), hullSteelMat, 0, 3.7, -(hz + 6.5), meshes);
  addPart(hullGroup, new THREE.BoxGeometry(hx * 0.60, 3.8, 7.6), hullSteelMat, 0, 4.0, -(hz + 13.0), meshes);

  // Non-skid weather deck + aft helicopter landing deck markings
  addPart(hullGroup, new THREE.BoxGeometry(hx * 1.84, 0.24, hz * 1.88), deckMat, 0, 5.85, 0, meshes);
  const heliZ = hz * 0.66;
  addPart(hullGroup, new THREE.BoxGeometry(0.56, 0.08, 5.6), whiteMat, -1.6, 6.0, heliZ, meshes);
  addPart(hullGroup, new THREE.BoxGeometry(0.56, 0.08, 5.6), whiteMat, 1.6, 6.0, heliZ, meshes);
  addPart(hullGroup, new THREE.BoxGeometry(3.2, 0.08, 0.60), whiteMat, 0, 6.0, heliZ, meshes);
  addPart(hullGroup, new THREE.BoxGeometry(hx * 1.56, 0.08, 0.48), yellowMat, 0, 6.0, heliZ - 6.8, meshes);
  addPart(hullGroup, new THREE.BoxGeometry(hx * 1.56, 0.08, 0.48), yellowMat, 0, 6.0, heliZ + 6.8, meshes);

  // Forward 5-inch stealth naval gun turret + VLS missile cell deck
  addPart(hullGroup, new THREE.BoxGeometry(4.6, 2.1, 5.6), darkSteelMat, 0, 6.8, -(hz * 0.76), meshes);
  const gunBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 7.4, 6), darkSteelMat);
  gunBarrel.rotation.x = Math.PI / 2 - 0.04;
  gunBarrel.position.set(0, 7.22, -(hz * 0.86));
  hullGroup.add(gunBarrel);
  meshes.push(gunBarrel);

  addPart(hullGroup, new THREE.BoxGeometry(7.2, 1.3, 10.4), panelMat, 0, 6.45, -24.0, meshes);
  addPart(hullGroup, new THREE.BoxGeometry(6.4, 0.14, 9.2), hazardMat, 0, 7.14, -24.0, meshes);

  // Multi-tier stealth superstructure + aft helicopter hangar bay + navigation bridge
  addPart(hullGroup, new THREE.BoxGeometry(hx * 1.56, 8.0, 29.0), superSteelMat, 0, 9.8, -5.0, meshes);
  addPart(hullGroup, new THREE.BoxGeometry(hx * 1.44, 5.4, 14.0), superSteelMat, 0, 8.6, 12.0, meshes);
  addPart(hullGroup, new THREE.BoxGeometry(hx * 1.08, 5.0, 16.4), superSteelMat, 0, 15.6, -7.0, meshes);

  // AEGIS phased-array radar panels
  addPart(hullGroup, new THREE.BoxGeometry(0.28, 3.2, 4.4), panelMat, -hx * 0.56, 15.2, -7.0, meshes);
  addPart(hullGroup, new THREE.BoxGeometry(0.28, 3.2, 4.4), panelMat, hx * 0.56, 15.2, -7.0, meshes);
  addPart(hullGroup, new THREE.BoxGeometry(4.8, 3.2, 0.28), panelMat, 0, 15.2, -15.35, meshes);

  // Integrated stealth mainmast + radar crossarm
  addPart(hullGroup, new THREE.BoxGeometry(3.8, 9.2, 4.8), darkSteelMat, 0, 22.4, -7.0, meshes);
  addPart(hullGroup, new THREE.CylinderGeometry(0.18, 0.52, 5.5, 8), darkSteelMat, 0, 29.75, -7.0, meshes);
  addPart(hullGroup, new THREE.BoxGeometry(9.6, 0.40, 0.56), darkSteelMat, 0, 29.0, -7.0, meshes);
  addPart(hullGroup, new THREE.BoxGeometry(0.90, 1.50, 8.4), whiteMat, 0, 26.8, -7.0, meshes);

  // Hostile red/orange bridge glow + masthead aviation beacon
  const bridgeRed = addPart(hullGroup, new THREE.BoxGeometry(7.2, 1.3, 0.28), emissiveRedMat, 0, 16.0, -15.4, meshes);
  const bridgeAmber = addPart(hullGroup, new THREE.BoxGeometry(8.4, 0.70, 0.24), emissiveOrangeMat, 0, 11.4, -19.6, meshes);
  const mastBeacon = addPart(hullGroup, new THREE.BoxGeometry(1.1, 0.96, 1.1), emissiveRedMat, 0, 32.9, -7.0, meshes);
  emissiveMeshes.push(bridgeRed, bridgeAmber, mastBeacon);

  // Armored SAM & CIWS sponson pads matching DESTROYER_LOCAL_MOUNTS
  for (const m of DESTROYER_LOCAL_MOUNTS) {
    const [mx, my, mz] = m.local;
    addPart(hullGroup, new THREE.BoxGeometry(4.6, 1.1, 4.6), darkSteelMat, mx, my - 0.55, mz, meshes);
    addPart(hullGroup, new THREE.BoxGeometry(3.8, 0.14, 3.8), hazardMat, mx, my - 0.03, mz, meshes);
  }

  // Churning bow wave spray & twin stern propeller wakes
  addPart(wakeGroup, new THREE.BoxGeometry(10.4, 0.05, 68), wakeMat, 0, 0.05, hz + 34, meshes);
  addPart(wakeGroup, new THREE.BoxGeometry(17.2, 0.04, 52), wakeMat, 0, 0.04, hz + 76, meshes);
  for (const s of [-1, 1]) {
    addPart(wakeGroup, new THREE.BoxGeometry(2.2, 0.05, 28), wakeMat, s * 5.2, 0.06, -(hz + 10), meshes, -s * 0.38);
  }

  return { root, hullGroup, wakeGroup, meshes, emissiveMeshes, materials };
}

export class DestroyerShip implements MissileTarget {
  readonly uid = nextShipUid++;
  readonly id: string;
  readonly label: string;
  readonly position: THREE.Vector3;
  readonly yaw: number;
  readonly center: THREE.Vector3;
  readonly aimLift = 0;
  readonly paintRadius = 24;
  readonly maxHealth: number;
  health: number;
  alive = true;
  sinking = false;
  sunk = false;
  disposed = false;

  readonly rig: BuiltWarshipRig;
  readonly colliders: RAPIER.Collider[] = [];
  private readonly markerPos = new THREE.Vector3();
  private unmark: (() => void) | null = null;
  private sinkElapsed = 0;
  private sinkSmokeCd = 0;
  private readonly listSign: 1 | -1;
  private readonly pitchSign: 1 | -1;
  private readonly pendingBlasts: PendingShipBlast[] = [];

  constructor(
    private readonly ctx: Ctx,
    pose: StraitShipPose,
    maxHp = DESTROYER_HULL_MAX_HP,
  ) {
    this.id = pose.id;
    this.label = pose.name;
    this.position = new THREE.Vector3(pose.x, 0, pose.z);
    this.yaw = pose.yaw;
    // Lock-on point squarely on the midship stealth superstructure
    this.center = new THREE.Vector3(pose.x, 11.5, pose.z);
    this.maxHealth = maxHp;
    this.health = maxHp;
    this.listSign = pose.id.includes('west') ? 1 : -1;
    this.pitchSign = pose.id.includes('west') ? 1 : -1;

    this.rig = buildDestroyerRig();
    this.rig.root.name = `strait.destroyer.${pose.id}`;
    this.rig.root.position.set(pose.x, 0, pose.z);
    this.rig.root.rotation.y = pose.yaw;
    ctx.render?.scene?.add(this.rig.root);

    this.registerColliders();

    this.markerPos.set(pose.x, 34, pose.z);
    this.unmark = ctx.hud?.follow?.(this.markerPos, this.label, '#ff4d3d') ?? null;
  }

  private localToWorld(lx: number, ly: number, lz: number, out = new THREE.Vector3()): THREE.Vector3 {
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    return out.set(
      this.position.x + lx * c + lz * s,
      ly,
      this.position.z - lx * s + lz * c,
    );
  }

  private registerColliders(): void {
    const physics = this.ctx.physics;
    if (!physics?.addStaticBox) return;

    const hullScale = 1.18;
    const hx = 6.2 * hullScale;
    const hz = 38 * hullScale;
    _quat.setFromAxisAngle(_up, this.yaw);

    // Main hull box, central superstructure box, and aft hangar box matching authorNavalEscort
    const boxes: ReadonlyArray<[number, number, number, number, number, number]> = [
      [0, 3.0, 0, hx + 0.3, 3.1, hz + 4],
      [0, 13.5, -5.0, hx * 0.85, 10.2, 15.5],
      [0, 8.6, 12.0, hx * 0.78, 3.0, 7.5],
    ];
    for (const [lx, ly, lz, ehx, ehy, ehz] of boxes) {
      const worldCenter = this.localToWorld(lx, ly, lz);
      const col = physics.addStaticBox(worldCenter, _half.set(ehx, ehy, ehz), _quat.clone(), 'metal');
      this.colliders.push(col);
    }
  }

  private clearColliders(): void {
    const world = this.ctx.physics?.world;
    for (const c of this.colliders) {
      world?.removeCollider?.(c, true);
    }
    this.colliders.length = 0;
  }

  ownsCollider(collider: RAPIER.Collider): boolean {
    for (let i = 0; i < this.colliders.length; i++) {
      if (this.colliders[i]!.handle === collider.handle) return true;
    }
    return false;
  }

  /** Returns 0..1 remaining hull fraction. */
  get healthRatio(): number {
    return clamp(this.health / Math.max(1, this.maxHealth), 0, 1);
  }

  /** Triggers fatal chain-explosion & sinking sequence. */
  beginSinking(): void {
    if (!this.alive || this.sinking) return;
    this.alive = false;
    this.health = 0;
    this.sinking = true;
    this.sinkElapsed = 0;
    this.unmark?.();
    this.unmark = null;
    this.clearColliders();

    // Extinguish bridge/mast lights & char hull plates
    for (const em of this.rig.emissiveMeshes) em.visible = false;
    for (const mat of this.rig.materials) {
      if (mat instanceof THREE.MeshStandardMaterial) {
        mat.color.multiplyScalar(0.38);
      }
    }

    // Immediate massive magazine detonation amidships!
    const midship = this.localToWorld(0, 12, -5);
    this.ctx.fx?.explosion?.(midship, { radius: 28, scale: 3.4 });
    this.ctx.fx?.chips?.(midship, 0xff9020, 64);
    this.ctx.fx?.ring?.(this.localToWorld(0, 1.0, 0), _up, 0xff8c2a, 34);
    this.ctx.render?.lights?.flash?.(midship, 0xffa040, 26, 180, 0.75);
    this.ctx.audio?.play?.('explosion_tank', { position: midship, volume: 1.0, pitch: 0.72 });

    // Staggered chain detonations from bow VLS cells -> bridge -> stern hangar
    this.pendingBlasts.push(
      { pos: this.localToWorld(0, 8, -26), delay: 0.45, radius: 22 },
      { pos: this.localToWorld(0, 15, -7), delay: 1.05, radius: 26 },
      { pos: this.localToWorld(0, 9, 18), delay: 1.75, radius: 24 },
      { pos: this.localToWorld(0, 6, -12), delay: 2.55, radius: 20 },
    );
  }

  update(dt: number): void {
    if (this.disposed) return;

    // Damaged smoke plume while still afloat below 60% hull
    if (this.alive && this.healthRatio < 0.6) {
      this.sinkSmokeCd -= dt;
      if (this.sinkSmokeCd <= 0) {
        this.sinkSmokeCd = this.healthRatio < 0.3 ? 0.16 : 0.32;
        const plume = this.localToWorld(rand(-4, 4), 14, rand(-18, 12));
        this.ctx.fx?.smoke?.(plume, this.healthRatio < 0.3 ? '#1e1b1a' : '#3a3c40', 5.2, 3.0);
        if (this.healthRatio < 0.35) {
          this.ctx.fx?.sparks?.(plume, _up, 8, 0xff7a22);
        }
      }
      return;
    }

    if (!this.sinking || this.sunk) return;

    this.sinkElapsed += dt;

    // Fire staggered magazine chain detonations along the sinking hull
    for (let i = this.pendingBlasts.length - 1; i >= 0; i--) {
      const b = this.pendingBlasts[i]!;
      b.delay -= dt;
      if (b.delay > 0) continue;
      this.pendingBlasts.splice(i, 1);
      this.ctx.fx?.explosion?.(b.pos, { radius: b.radius, scale: 2.6 });
      this.ctx.fx?.smoke?.(b.pos, '#1f1d1c', 7.5, 3.8);
      this.ctx.audio?.play?.('explosion_tank', { position: b.pos, volume: 0.9, pitch: rand(0.68, 0.86) });
    }

    // Smoothly list heavily to one side, pitch bow/stern down, and plunge beneath the waves!
    const t = clamp(this.sinkElapsed / SINK_DURATION_SECONDS, 0, 1);
    const easeIn = t * t;
    const easeOut = 1 - (1 - t) * (1 - t);
    this.rig.hullGroup.rotation.z = this.listSign * 0.68 * easeOut;
    this.rig.hullGroup.rotation.x = this.pitchSign * 0.24 * easeIn;
    this.rig.hullGroup.position.y = -25 * easeIn;

    // Fade surface foam wake as the warship disappears under the ocean
    for (const mat of this.rig.materials) {
      if (mat instanceof THREE.MeshBasicMaterial && mat.transparent) {
        mat.opacity = Math.max(0, 0.68 * (1 - t));
      }
    }

    // Churning fire, black smoke, and white sea foam plumes while sinking
    this.sinkSmokeCd -= dt;
    if (this.sinkSmokeCd <= 0 && t < 0.92) {
      this.sinkSmokeCd = 0.14;
      const firePos = this.localToWorld(rand(-6, 6), Math.max(1.2, 10 * (1 - t)), rand(-28, 24));
      this.ctx.fx?.smoke?.(firePos, '#23201f', 6.8, 3.4);
      const foamPos = this.localToWorld(rand(-8, 8), 0.6, rand(-36, 34));
      this.ctx.fx?.smoke?.(foamPos, '#d0e4f2', 5.0, 2.0);
    }

    if (t >= 1) {
      this.sunk = true;
      this.sinking = false;
      this.rig.root.visible = false;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.alive = false;
    this.unmark?.();
    this.unmark = null;
    this.clearColliders();
    this.ctx.render?.scene?.remove(this.rig.root);
    for (const m of this.rig.meshes) m.geometry.dispose();
    for (const mat of this.rig.materials) mat.dispose();
  }
}

export interface DestroyerFleetCallbacks {
  onShipSunk?: (ship: DestroyerShip) => void;
  onShipDamaged?: (ship: DestroyerShip, amount: number) => void;
}

/**
 * Manages the Strait's hostile Southern Missile Destroyers and integrates them into
 * `ctx.enemies.vehicles` as `ExtraTarget`s so player AMRAAMs, AGMs, Vulcan cannons,
 * and bomb/rocket blasts lock, damage, and sink them cleanly.
 */
export class DestroyerFleet implements ExtraTarget {
  readonly ships: DestroyerShip[] = [];
  private registeredExtra = false;
  private disposed = false;

  constructor(
    private readonly ctx: Ctx,
    private readonly cb: DestroyerFleetCallbacks = {},
  ) {}

  private get vehicleSystem(): Partial<VehicleSystem> | undefined {
    return this.ctx.enemies?.vehicles as Partial<VehicleSystem> | undefined;
  }

  private ensureRegistered(): void {
    if (this.registeredExtra) return;
    this.vehicleSystem?.addExtra?.(this);
    this.registeredExtra = true;
  }

  spawnShips(poses: readonly StraitShipPose[], maxHp = DESTROYER_HULL_MAX_HP): DestroyerShip[] {
    this.ensureRegistered();
    const spawned: DestroyerShip[] = [];
    for (const pose of poses) {
      if (this.getShip(pose.id)) continue;
      const ship = new DestroyerShip(this.ctx, pose, maxHp);
      this.ships.push(ship);
      spawned.push(ship);
    }
    return spawned;
  }

  getShip(id: string): DestroyerShip | undefined {
    return this.ships.find(s => s.id === id);
  }

  get aliveCount(): number {
    let n = 0;
    for (const s of this.ships) if (s.alive) n++;
    return n;
  }

  get totalCount(): number {
    return this.ships.length;
  }

  get allSunkOrSinking(): boolean {
    return this.ships.length > 0 && this.aliveCount === 0;
  }

  /** Directly damages a destroyer hull by ship ID (used by turret pass-through damage & tests). */
  damageShip(
    shipId: string,
    amount: number,
    point?: THREE.Vector3,
    showPlayerMarker = true,
  ): boolean {
    const ship = this.getShip(shipId);
    if (!ship || !ship.alive || amount <= 0) return false;
    this.applyDamageToShip(ship, amount, point ?? ship.center, showPlayerMarker);
    return true;
  }

  /** Called when a deck SAM or CIWS turret on `shipId` takes damage or is destroyed. */
  applyTurretDamage(shipId: string, amount: number, destroyed: boolean, point?: THREE.Vector3): void {
    const ship = this.getShip(shipId);
    if (!ship || !ship.alive) return;
    const hullDamage = destroyed
      ? DESTROYER_TURRET_KILL_HULL_DAMAGE
      : Math.round(amount * DESTROYER_TURRET_HIT_PASS_RATIO);
    if (hullDamage > 0) {
      this.applyDamageToShip(ship, hullDamage, point ?? ship.center, false);
    }
  }

  private applyDamageToShip(
    ship: DestroyerShip,
    amount: number,
    point: THREE.Vector3,
    showPlayerMarker: boolean,
  ): void {
    if (!ship.alive || amount <= 0) return;
    ship.health = Math.max(0, ship.health - amount);
    this.ctx.fx?.sparks?.(point, _up, 14, 0xffaa33);

    const killed = ship.health <= 0;
    if (showPlayerMarker) {
      this.ctx.hud?.hitMarker?.(killed ? 'kill' : 'body');
      this.ctx.audio?.play?.(killed ? 'hit_marker_kill' : 'hit_marker');
    }

    this.cb.onShipDamaged?.(ship, amount);

    if (!killed) return;

    ship.beginSinking();
    this.ctx.progression?.award?.(1200, `${ship.label} SUNK`, ship.center);
    this.ctx.hud?.feed?.(`${ship.label} SUNK — WARSHIP GOING DOWN!`, '#54ff9d');
    this.cb.onShipSunk?.(ship);
  }

  // -------------------------------------------------------------------------------------------
  // ExtraTarget integration (player guns, homing missiles, bomb/rocket blasts, radar, thermal)
  // -------------------------------------------------------------------------------------------

  shot(collider: RAPIER.Collider, point: THREE.Vector3, amount: number, _source: string): boolean {
    for (let i = 0; i < this.ships.length; i++) {
      const s = this.ships[i]!;
      if (!s.alive || !s.ownsCollider(collider)) continue;
      // Armored warship hull absorbs light rifle pellets slightly; aircraft cannons & missiles tear right in.
      const mult = amount < 20 ? 0.5 : 1.0;
      this.applyDamageToShip(s, amount * mult, point, true);
      return true;
    }
    return false;
  }

  direct(collider: RAPIER.Collider, point: THREE.Vector3, amount: number, _kind: ExplosionKind, _source: string): boolean {
    for (let i = 0; i < this.ships.length; i++) {
      const s = this.ships[i]!;
      if (!s.alive || !s.ownsCollider(collider)) continue;
      this.applyDamageToShip(s, amount * 1.35, point, true);
      return true;
    }
    return false;
  }

  blast(center: THREE.Vector3, spec: ExplosionSpec): number {
    const def = EXPLOSIONS[spec.kind];
    let hit = 0;
    for (let i = 0; i < this.ships.length; i++) {
      const s = this.ships[i]!;
      if (!s.alive) continue;
      // Generous warship hull blast footprint (52 m half-length)
      const reach = spec.radius + 42;
      const d = _v.copy(center).setY(s.center.y).distanceTo(s.center);
      if (d > reach) continue;
      const edge = def?.edgeDamage ?? 0.30;
      const falloff = clamp(1 - (d / Math.max(1, reach)) * (1 - edge), 0.32, 1);
      const dmg = spec.instakill ? Infinity : spec.damage * falloff;
      this.applyDamageToShip(s, dmg, center, spec.team === 'player');
      hit++;
    }
    return hit;
  }

  paintable(out: MissileTarget[]): void {
    for (let i = 0; i < this.ships.length; i++) {
      const s = this.ships[i]!;
      if (s.alive) out.push(s);
    }
  }

  radarTargets(out: VehicleRadarTarget[]): void {
    for (let i = 0; i < this.ships.length; i++) {
      const s = this.ships[i]!;
      if (!s.alive) continue;
      out.push({
        id: s.uid,
        kind: 'tank',
        label: s.label,
        position: s.center.clone(),
        velocity: new THREE.Vector3(),
        airborne: false,
      });
    }
  }

  highlightMeshes(out: THREE.Object3D[]): void {
    for (let i = 0; i < this.ships.length; i++) {
      const s = this.ships[i]!;
      if (s.alive) out.push(...s.rig.meshes);
    }
  }

  update(dt: number): void {
    if (this.disposed || dt <= 0) return;
    for (let i = 0; i < this.ships.length; i++) {
      this.ships[i]!.update(dt);
    }
  }

  clear(): void {
    for (const s of this.ships) s.dispose();
    this.ships.length = 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    if (this.registeredExtra) {
      this.vehicleSystem?.removeExtra?.(this);
      this.registeredExtra = false;
    }
  }
}
