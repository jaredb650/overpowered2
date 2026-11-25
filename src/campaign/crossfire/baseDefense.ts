/**
 * Destructible Base & Naval Air-Defense / Artillery System (`BaseDefenseSystem`).
 *
 * Places and simulates 6 classes of 3D PBR military emplacements across Fortress Halcyon and the
 * Mid-Strait Southern Missile Destroyers:
 *   - `'sam_battery'`    (420 HP, 580 m) — Rotating radar + quad missile launcher firing smoky homing SAMs with RWR lock warning (flareable)
 *   - `'flak_tower'`     (700 HP, 480 m) — Reinforced concrete/steel twin AA tower firing rising tracers + dark black-orange flak airbursts
 *   - `'radar_dome'`     (550 HP, 450 m) — Iconic geodesic radome boosting nearby SAM fire rate & lock speed +35% while alive
 *   - `'mortar_pit'`     (300 HP, 240 m) — Sandbagged artillery pit shelling friendly ground troops & armor with arcing whistling shells
 *   - `'destroyer_sam'`  (450 HP, 560 m) — Naval Mk-26 / VLS SAM turret mountable on `STRAIT_DESTROYER_MOUNTS`
 *   - `'destroyer_ciws'` (450 HP, 340 m) — Naval Phalanx 20mm CIWS turret mountable on `STRAIT_DESTROYER_MOUNTS`
 *
 * Implements `ExtraTarget` so player Lancer bombs, Raptor AGMs/AIMs, rockets, cannons, and guns
 * damage/lock onto every emplacement natively, AND listens to `combat:explosion` / `world:explosion`
 * plus exposes `applyBlast(center, radius, damage, source)` for scripted ordnance drops.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Ctx, EmitterHandle, ExplosionKind } from '../../core/contracts';
import type { ExplosionSpec, MissileTarget, VehicleRadarTarget } from '../../core/gameplay';
import { clamp, damp, dampAngle, rand, wrapAngle } from '../../core/math';
import type { AiCombatJet } from '../../enemies/dogfight/aiJet';
import type { ExtraTarget, FriendlyGroundTarget, VehicleSystem } from '../../enemies/vehicles';
import type { AiVehicleFleet } from '../../vehicles/drive/aiDriver';
import { EXPLOSIONS } from '../../weapons/data';
import type { HalcyonDefenseSiteDef } from '../../world/map/halcyon/targets';
import { STRAIT_DESTROYER_MOUNTS, type StraitDefenseMount } from '../../world/map/strait/plan';

declare module '../../core/contracts' {
  interface GameEvents {
    /** Emitted by campaign/ordnance blasts so destructible defense installations take splash damage. */
    'combat:explosion': {
      position: THREE.Vector3;
      radius: number;
      damage: number;
      source?: string;
      kind?: ExplosionKind;
    };
  }
}

export type BaseDefenseKind =
  | 'sam_battery'
  | 'flak_tower'
  | 'radar_dome'
  | 'mortar_pit'
  | 'destroyer_sam'
  | 'destroyer_ciws';

export interface BaseDefenseSpec {
  readonly kind: BaseDefenseKind;
  readonly label: string;
  readonly maxHp: number;
  readonly range: number;
  readonly hitboxHalf: readonly [number, number, number];
  readonly paintRadius: number;
  readonly score: number;
  readonly secondaryBlastRadius: number;
}

/** Fire-rate & lock-speed multiplier bonus (+35%) granted to nearby SAM batteries by an alive Radar Dome. */
export const RADAR_DOME_FIRE_RATE_BONUS = 0.35;
export const RADAR_DOME_BOOST_RANGE = 450;

export const BASE_DEFENSE_SPECS: Readonly<Record<BaseDefenseKind, BaseDefenseSpec>> = {
  sam_battery: {
    kind: 'sam_battery',
    label: 'SAM BATTERY',
    maxHp: 420,
    range: 580,
    hitboxHalf: [3.6, 3.2, 3.6],
    paintRadius: 6.5,
    score: 650,
    secondaryBlastRadius: 11,
  },
  flak_tower: {
    kind: 'flak_tower',
    label: 'FLAK TOWER',
    maxHp: 700,
    range: 480,
    hitboxHalf: [4.2, 6.2, 4.2],
    paintRadius: 7.5,
    score: 850,
    secondaryBlastRadius: 13,
  },
  radar_dome: {
    kind: 'radar_dome',
    label: 'RADAR DOME',
    maxHp: 550,
    range: RADAR_DOME_BOOST_RANGE,
    hitboxHalf: [4.8, 4.8, 4.8],
    paintRadius: 8.0,
    score: 900,
    secondaryBlastRadius: 14,
  },
  mortar_pit: {
    kind: 'mortar_pit',
    label: 'MORTAR PIT',
    maxHp: 300,
    range: 240,
    hitboxHalf: [3.2, 1.8, 3.2],
    paintRadius: 5.5,
    score: 450,
    secondaryBlastRadius: 8.5,
  },
  destroyer_sam: {
    kind: 'destroyer_sam',
    label: 'DESTROYER SAM',
    maxHp: 450,
    range: 560,
    hitboxHalf: [3.0, 2.8, 3.0],
    paintRadius: 6.2,
    score: 700,
    secondaryBlastRadius: 10,
  },
  destroyer_ciws: {
    kind: 'destroyer_ciws',
    label: 'DESTROYER CIWS',
    maxHp: 450,
    range: 340,
    hitboxHalf: [2.4, 2.6, 2.4],
    paintRadius: 5.5,
    score: 600,
    secondaryBlastRadius: 9,
  },
};

export interface BaseDefenseSiteOptions {
  readonly id: string;
  readonly kind: BaseDefenseKind;
  readonly position: THREE.Vector3 | readonly [number, number, number];
  readonly yaw?: number;
  readonly range?: number;
  readonly hpOverride?: number;
  readonly label?: string;
  readonly shipId?: string;
}

export interface BaseDefenseSystemOptions {
  readonly onDestroyed?: (id: string, kind: BaseDefenseKind, pos: THREE.Vector3) => void;
  /** Automatically register with `ctx.enemies?.vehicles?.addExtra(this)` (default true). */
  readonly autoRegisterExtra?: boolean;
}

export interface BaseDefenseUpdateContext {
  readonly playerAirborne?: boolean;
  readonly playerCountermeasures?: boolean;
  readonly playerVelocity?: THREE.Vector3;
  readonly alliedJets?: readonly AiCombatJet[];
  readonly friendlyFleet?: AiVehicleFleet | null;
  readonly friendlyGroundTargets?: readonly FriendlyGroundTarget[];
}

interface AirTargetCandidate {
  isPlayer: boolean;
  jet: AiCombatJet | null;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  dist: number;
  countermeasures: boolean;
}

interface ActiveSamMissile {
  mesh: THREE.Group;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  speed: number;
  damage: number;
  life: number;
  smokeCd: number;
  targetPlayer: boolean;
  targetJet: AiCombatJet | null;
  decoyed: boolean;
  source: string;
}

interface ActiveMortarShell {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  damage: number;
  radius: number;
  life: number;
  smokeCd: number;
  source: string;
}

interface ActiveSecondaryBlast {
  pos: THREE.Vector3;
  delay: number;
  radius: number;
}

interface DefenseVisualRig {
  root: THREE.Group;
  turret: THREE.Group | null;
  barrel: THREE.Group | null;
  radar: THREE.Object3D | null;
  beacon: THREE.Mesh | null;
  meshes: THREE.Mesh[];
}

const MORTAR_GRAVITY = 22;
const MAX_ACTIVE_SAMS = 18;
const MAX_ACTIVE_PLAYER_SAMS = 2;
const MAX_ACTIVE_MORTARS = 16;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _zAxis = new THREE.Vector3(0, 0, 1);
const _quat = new THREE.Quaternion();

let nextDefenseUid = 75_000;

function toVec3(p: THREE.Vector3 | readonly [number, number, number]): THREE.Vector3 {
  return p instanceof THREE.Vector3 ? p.clone() : new THREE.Vector3(p[0], p[1], p[2]);
}

function buildDefenseRig(kind: BaseDefenseKind): DefenseVisualRig {
  const root = new THREE.Group();
  const meshes: THREE.Mesh[] = [];

  const concreteMat = new THREE.MeshStandardMaterial({ color: 0x62666b, roughness: 0.92, metalness: 0.08 });
  const darkSteelMat = new THREE.MeshStandardMaterial({ color: 0x2d333b, roughness: 0.56, metalness: 0.55 });
  const oliveMat = new THREE.MeshStandardMaterial({ color: 0x424d3b, roughness: 0.72, metalness: 0.25 });
  const navalMat = new THREE.MeshStandardMaterial({ color: 0x3b444f, roughness: 0.55, metalness: 0.48 });
  const sandbagMat = new THREE.MeshStandardMaterial({ color: 0x8a795d, roughness: 0.95, metalness: 0.02 });
  const radomeMat = new THREE.MeshStandardMaterial({ color: 0xd6dce2, roughness: 0.48, metalness: 0.14 });
  const wireMat = new THREE.MeshStandardMaterial({ color: 0x4b545e, roughness: 0.65, metalness: 0.5, wireframe: true });
  const redCapMat = new THREE.MeshStandardMaterial({ color: 0xb53226, roughness: 0.5, metalness: 0.25 });
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff3b2f });

  const addMesh = (
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    rx = 0,
    ry = 0,
    rz = 0,
  ): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    parent.add(m);
    meshes.push(m);
    return m;
  };

  let turret: THREE.Group | null = null;
  let barrel: THREE.Group | null = null;
  let radar: THREE.Object3D | null = null;
  let beacon: THREE.Mesh | null = null;

  if (kind === 'sam_battery') {
    // Octagonal reinforced pad
    addMesh(root, new THREE.CylinderGeometry(3.5, 3.9, 0.7, 8), concreteMat, 0, 0.35, 0);
    // Turntable chassis
    turret = new THREE.Group();
    turret.position.set(0, 0.7, 0);
    root.add(turret);
    addMesh(turret, new THREE.BoxGeometry(2.8, 1.0, 3.2), oliveMat, 0, 0.5, 0);

    // Elevating quad missile canister rack
    barrel = new THREE.Group();
    barrel.position.set(0, 1.35, 0.15);
    turret.add(barrel);
    addMesh(barrel, new THREE.BoxGeometry(2.2, 1.15, 0.35), darkSteelMat, 0, 0, -0.5);
    const tubeGeo = new THREE.CylinderGeometry(0.24, 0.24, 3.4, 8);
    tubeGeo.rotateX(Math.PI / 2);
    const capGeo = new THREE.ConeGeometry(0.24, 0.52, 8);
    capGeo.rotateX(Math.PI / 2);
    for (const ox of [-0.62, 0.62]) {
      for (const oy of [-0.32, 0.32]) {
        addMesh(barrel, tubeGeo, oliveMat, ox, oy, 0.6);
        addMesh(barrel, capGeo, redCapMat, ox, oy, 2.45);
      }
    }

    // Rotating surveillance radar mast behind launcher
    const mast = new THREE.Group();
    mast.position.set(0, 2.35, -1.25);
    turret.add(mast);
    addMesh(mast, new THREE.CylinderGeometry(0.14, 0.18, 1.4, 8), darkSteelMat, 0, -0.45, 0);
    addMesh(mast, new THREE.BoxGeometry(2.2, 0.72, 0.18), radomeMat, 0, 0.25, 0);
    radar = mast;

    beacon = addMesh(turret, new THREE.SphereGeometry(0.26, 8, 6), beaconMat, 0, 3.1, -1.25);
  } else if (kind === 'flak_tower') {
    // Stepped brutalist concrete bunker tower
    addMesh(root, new THREE.BoxGeometry(7.2, 3.8, 7.2), concreteMat, 0, 1.9, 0);
    addMesh(root, new THREE.BoxGeometry(6.0, 3.6, 6.0), concreteMat, 0, 5.5, 0);
    addMesh(root, new THREE.CylinderGeometry(2.8, 3.2, 0.9, 8), darkSteelMat, 0, 7.75, 0);

    // Slewing armored twin 88mm AA turret
    turret = new THREE.Group();
    turret.position.set(0, 8.2, 0);
    root.add(turret);
    addMesh(turret, new THREE.BoxGeometry(3.2, 1.45, 3.6), darkSteelMat, 0, 0.72, -0.15);

    barrel = new THREE.Group();
    barrel.position.set(0, 0.95, 1.2);
    turret.add(barrel);
    const gunGeo = new THREE.CylinderGeometry(0.14, 0.19, 5.0, 8);
    gunGeo.rotateX(Math.PI / 2);
    addMesh(barrel, gunGeo, darkSteelMat, -0.58, 0, 2.3);
    addMesh(barrel, gunGeo, darkSteelMat, 0.58, 0, 2.3);

    beacon = addMesh(turret, new THREE.SphereGeometry(0.28, 8, 6), beaconMat, 0, 1.85, -1.1);
  } else if (kind === 'radar_dome') {
    // Concrete octagonal pedestal
    addMesh(root, new THREE.CylinderGeometry(4.6, 5.2, 2.2, 8), concreteMat, 0, 1.1, 0);
    addMesh(root, new THREE.CylinderGeometry(4.3, 4.5, 0.6, 12), darkSteelMat, 0, 2.5, 0);
    // Iconic faceted geodesic radome + strut lattice
    addMesh(root, new THREE.IcosahedronGeometry(4.15, 1), radomeMat, 0, 5.4, 0);
    addMesh(root, new THREE.IcosahedronGeometry(4.22, 1), wireMat, 0, 5.4, 0);

    // Rotating exterior target-tracking dish on side mast
    const sideDish = new THREE.Group();
    sideDish.position.set(0, 9.85, 0);
    root.add(sideDish);
    addMesh(sideDish, new THREE.CylinderGeometry(0.16, 0.2, 0.85, 8), darkSteelMat, 0, -0.2, 0);
    addMesh(sideDish, new THREE.BoxGeometry(2.6, 0.52, 0.18), darkSteelMat, 0, 0.3, 0);
    radar = sideDish;

    beacon = addMesh(root, new THREE.SphereGeometry(0.32, 8, 6), beaconMat, 0, 10.6, 0);
  } else if (kind === 'mortar_pit') {
    // Circular sandbag berm ring (10 sandbag blocks)
    const bagGeo = new THREE.BoxGeometry(1.55, 0.95, 0.72);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      addMesh(root, bagGeo, sandbagMat, Math.sin(a) * 2.55, 0.48, Math.cos(a) * 2.55, 0, a, 0);
    }
    // Ammo crates
    addMesh(root, new THREE.BoxGeometry(1.0, 0.55, 0.65), oliveMat, -1.25, 0.28, -0.8, 0, 0.3, 0);
    addMesh(root, new THREE.BoxGeometry(0.85, 0.5, 0.55), oliveMat, 1.35, 0.25, -0.6, 0, -0.4, 0);

    // Baseplate + heavy angled 120mm mortar tube
    turret = new THREE.Group();
    turret.position.set(0, 0.18, 0);
    root.add(turret);
    addMesh(turret, new THREE.CylinderGeometry(0.65, 0.72, 0.22, 8), darkSteelMat, 0, 0.11, 0);
    barrel = new THREE.Group();
    barrel.position.set(0, 0.35, 0);
    turret.add(barrel);
    addMesh(barrel, new THREE.CylinderGeometry(0.18, 0.21, 2.35, 10), darkSteelMat, 0, 1.0, 0.42, 0.46, 0, 0);
    beacon = addMesh(root, new THREE.SphereGeometry(0.22, 8, 6), beaconMat, 0, 1.9, -2.35);
  } else if (kind === 'destroyer_sam') {
    // Naval deck barbette + Mk-26 twin-arm stealth SAM launcher
    addMesh(root, new THREE.CylinderGeometry(2.3, 2.6, 1.1, 8), navalMat, 0, 0.55, 0);
    turret = new THREE.Group();
    turret.position.set(0, 1.1, 0);
    root.add(turret);
    addMesh(turret, new THREE.BoxGeometry(2.6, 1.35, 2.8), navalMat, 0, 0.68, 0);

    barrel = new THREE.Group();
    barrel.position.set(0, 1.45, 0.25);
    turret.add(barrel);
    const tubeGeo = new THREE.CylinderGeometry(0.22, 0.22, 3.2, 8);
    tubeGeo.rotateX(Math.PI / 2);
    const capGeo = new THREE.ConeGeometry(0.22, 0.48, 8);
    capGeo.rotateX(Math.PI / 2);
    for (const ox of [-0.72, 0.72]) {
      addMesh(barrel, tubeGeo, radomeMat, ox, 0.2, 0.65);
      addMesh(barrel, capGeo, redCapMat, ox, 0.2, 2.4);
    }

    const dish = new THREE.Group();
    dish.position.set(0, 2.05, -0.95);
    turret.add(dish);
    addMesh(dish, new THREE.BoxGeometry(1.85, 0.62, 0.16), radomeMat, 0, 0.2, 0);
    radar = dish;
    beacon = addMesh(turret, new THREE.SphereGeometry(0.24, 8, 6), beaconMat, 0, 2.7, -0.95);
  } else {
    // 'destroyer_ciws': Iconic Phalanx CIWS white-grey domed radome + 20mm Vulcan rotary mount
    addMesh(root, new THREE.CylinderGeometry(1.75, 2.0, 0.9, 8), navalMat, 0, 0.45, 0);
    turret = new THREE.Group();
    turret.position.set(0, 0.9, 0);
    root.add(turret);
    addMesh(turret, new THREE.BoxGeometry(1.7, 1.1, 1.8), navalMat, 0, 0.55, 0);
    // White-grey cylindrical R2-D2 Phalanx search/track radome
    addMesh(turret, new THREE.CylinderGeometry(0.72, 0.74, 1.5, 12), radomeMat, 0, 1.75, -0.1);
    addMesh(turret, new THREE.SphereGeometry(0.72, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), radomeMat, 0, 2.5, -0.1);

    barrel = new THREE.Group();
    barrel.position.set(0, 1.05, 0.75);
    turret.add(barrel);
    const rotaryGeo = new THREE.CylinderGeometry(0.14, 0.16, 2.45, 8);
    rotaryGeo.rotateX(Math.PI / 2);
    addMesh(barrel, rotaryGeo, darkSteelMat, 0, 0, 1.15);

    beacon = addMesh(turret, new THREE.SphereGeometry(0.22, 8, 6), beaconMat, 0, 3.35, -0.1);
  }

  return { root, turret, barrel, radar, beacon, meshes };
}

export class BaseDefenseSite implements MissileTarget {
  readonly uid = nextDefenseUid++;
  readonly id: string;
  readonly kind: BaseDefenseKind;
  readonly spec: BaseDefenseSpec;
  readonly label: string;
  readonly shipId: string | null;
  readonly position: THREE.Vector3;
  readonly center: THREE.Vector3;
  readonly aimLift = 0;
  readonly paintRadius: number;
  readonly range: number;
  readonly maxHealth: number;
  health: number;
  alive = true;
  disposed = false;

  yaw: number;
  pitch = 0.25;
  lockProgress = 0;
  fireCooldown: number;
  ciwsBurstRemaining = 5;
  shotsFired = 0;
  samsFired = 0;
  mortarsFired = 0;

  readonly rig: DefenseVisualRig;
  collider: RAPIER.Collider | null = null;
  private unmark: (() => void) | null = null;
  private readonly markerPos = new THREE.Vector3();
  private readonly emitters: EmitterHandle[] = [];

  constructor(
    private readonly ctx: Ctx,
    opts: BaseDefenseSiteOptions,
  ) {
    this.id = opts.id;
    this.kind = opts.kind;
    this.spec = BASE_DEFENSE_SPECS[opts.kind];
    this.label = opts.label ?? this.spec.label;
    this.shipId = opts.shipId ?? null;
    this.position = toVec3(opts.position);
    this.center = this.position.clone().setY(this.position.y + this.spec.hitboxHalf[1]);
    this.paintRadius = this.spec.paintRadius;
    this.range = opts.range ?? this.spec.range;
    this.maxHealth = opts.hpOverride != null ? Math.max(1, Math.round(opts.hpOverride)) : this.spec.maxHp;
    this.health = this.maxHealth;
    this.yaw = opts.yaw ?? 0;

    this.fireCooldown = opts.kind === 'sam_battery' || opts.kind === 'destroyer_sam'
      ? rand(1.0, 2.4)
      : opts.kind === 'mortar_pit'
        ? rand(1.8, 3.2)
        : rand(0.4, 1.2);

    this.rig = buildDefenseRig(opts.kind);
    this.rig.root.name = `defense.${opts.kind}.${opts.id}`;
    this.rig.root.position.copy(this.position);
    if (this.rig.turret) this.rig.turret.rotation.y = this.yaw;
    ctx.render?.scene?.add(this.rig.root);

    if (ctx.physics?.addStaticBox) {
      const [hx, hy, hz] = this.spec.hitboxHalf;
      this.collider = ctx.physics.addStaticBox(
        this.center,
        _v.set(hx, hy, hz),
        null,
        opts.kind === 'flak_tower' || opts.kind === 'radar_dome' ? 'concrete' : 'metal',
      );
    }

    this.markerPos.set(this.position.x, this.position.y + this.spec.hitboxHalf[1] * 2 + 2.2, this.position.z);
    const color = opts.kind === 'radar_dome' ? '#ffd166' : opts.kind === 'mortar_pit' ? '#ff9f1c' : '#ff4d3d';
    this.unmark = ctx.hud?.follow?.(this.markerPos, this.label, color) ?? null;
  }

  get hp(): number {
    return this.health;
  }

  get maxHp(): number {
    return this.maxHealth;
  }

  getMuzzleWorldPos(out: THREE.Vector3): THREE.Vector3 {
    return out.set(
      this.position.x,
      this.position.y + this.spec.hitboxHalf[1] * 1.6 + 0.6,
      this.position.z,
    );
  }

  markDestroyed(): void {
    this.alive = false;
    this.health = 0;
    this.lockProgress = 0;
    this.unmark?.();
    this.unmark = null;

    if (this.collider) {
      this.ctx.physics?.world?.removeCollider?.(this.collider, true);
      this.collider = null;
    }

    if (this.rig.beacon) this.rig.beacon.visible = false;
    if (this.rig.barrel) this.rig.barrel.rotation.x = 0.38;

    // Char & slump the ruined structure visibly on the battlefield!
    for (const m of this.rig.meshes) {
      if (m.material && !Array.isArray(m.material)) {
        const charred = m.material.clone();
        if ('color' in charred && charred.color instanceof THREE.Color) {
          charred.color.multiplyScalar(0.22);
        }
        m.material = charred;
      }
    }
    this.rig.root.scale.set(1, this.kind === 'radar_dome' ? 0.36 : 0.62, 1);

    const fire = this.ctx.fx?.attachEmitter?.(this.rig.root, 'burning', new THREE.Vector3(0, 1.6, 0), 90);
    if (fire) this.emitters.push(fire);
    const smoke = this.ctx.fx?.attachEmitter?.(this.rig.root, 'smokeTrail', new THREE.Vector3(0, 2.2, 0), 90);
    if (smoke) this.emitters.push(smoke);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.alive = false;
    this.unmark?.();
    this.unmark = null;
    for (const e of this.emitters) e.stop();
    this.emitters.length = 0;
    if (this.collider) {
      this.ctx.physics?.world?.removeCollider?.(this.collider, true);
      this.collider = null;
    }
    this.ctx.render?.scene?.remove(this.rig.root);
    for (const m of this.rig.meshes) {
      m.geometry.dispose();
      if (!Array.isArray(m.material)) m.material.dispose();
    }
  }
}

export class BaseDefenseSystem implements ExtraTarget {
  readonly sites: BaseDefenseSite[] = [];
  private readonly sams: ActiveSamMissile[] = [];
  private readonly mortars: ActiveMortarShell[] = [];
  private readonly secondaryBlasts: ActiveSecondaryBlast[] = [];
  private readonly unsubs: (() => void)[] = [];
  private readonly onDestroyedCb: ((id: string, kind: BaseDefenseKind, pos: THREE.Vector3) => void) | null;
  private registeredExtra = false;
  private wasRwrActive = false;
  private playerFlareTimer = 0;
  private readonly prevPlayerPos = new THREE.Vector3();
  private readonly derivedPlayerVel = new THREE.Vector3();
  private hasPrevPlayerPos = false;
  private disposed = false;

  // Shared projectile visuals
  private readonly samBodyGeo = new THREE.CylinderGeometry(0.14, 0.18, 2.4, 6);
  private readonly samNoseGeo = new THREE.ConeGeometry(0.14, 0.55, 6);
  private readonly samMat = new THREE.MeshStandardMaterial({ color: 0xdfe4ea, roughness: 0.45, metalness: 0.3 });
  private readonly samFlameMat = new THREE.MeshBasicMaterial({ color: 0xff7b29 });
  private readonly mortarGeo = new THREE.SphereGeometry(0.28, 8, 6);
  private readonly mortarMat = new THREE.MeshBasicMaterial({ color: 0xffc857 });

  constructor(
    private readonly ctx: Ctx,
    opts?: BaseDefenseSystemOptions,
  ) {
    this.onDestroyedCb = opts?.onDestroyed ?? null;
    this.samBodyGeo.rotateX(Math.PI / 2);
    this.samNoseGeo.rotateX(Math.PI / 2);

    const vehSys = ctx.enemies?.vehicles as Partial<VehicleSystem> | undefined;
    if (opts?.autoRegisterExtra !== false && typeof vehSys?.addExtra === 'function') {
      vehSys.addExtra(this);
      this.registeredExtra = true;
    }

    if (ctx.events?.on) {
      this.unsubs.push(
        ctx.events.on('combat:explosion', ev => {
          this.applyBlast(ev.position, ev.radius, ev.damage, ev.source ?? 'combat_explosion');
        }),
      );
      this.unsubs.push(
        ctx.events.on('world:explosion', ev => {
          this.applyBlast(ev.position, ev.radius, ev.damage, ev.source ?? 'world_explosion');
        }),
      );
      this.unsubs.push(
        ctx.events.on('dogfight:player_flares', () => {
          this.notifyPlayerFlares();
        }),
      );
    }
  }

  /** Adds a single destructible air-defense or artillery emplacement. */
  addSite(opts: BaseDefenseSiteOptions): BaseDefenseSite {
    const site = new BaseDefenseSite(this.ctx, opts);
    this.sites.push(site);
    return site;
  }

  /**
   * Mounts naval `'destroyer_sam'` & `'destroyer_ciws'` turrets directly onto the Mid-Strait
   * Southern Missile Destroyers (`STRAIT_DESTROYER_MOUNTS` by default).
   */
  mountStraitDestroyers(mounts: readonly StraitDefenseMount[] = STRAIT_DESTROYER_MOUNTS): BaseDefenseSite[] {
    const spawned: BaseDefenseSite[] = [];
    let samIdx = 0;
    let ciwsIdx = 0;
    for (const m of mounts) {
      const site = this.addSite({
        id: m.id,
        kind: m.role === 'sam' ? 'destroyer_sam' : 'destroyer_ciws',
        position: m.at,
        yaw: m.defaultYaw,
        shipId: m.shipId,
        label: m.role === 'sam' ? `${m.shipId.toUpperCase()} SAM` : `${m.shipId.toUpperCase()} CIWS`,
      });
      // Stagger initial weapon cooldowns across both destroyers so SAMs and CIWS open in readable waves instead of a 1-frame delete salvo.
      if (m.role === 'sam') {
        site.fireCooldown = 2.0 + samIdx * 2.2;
        samIdx++;
      } else {
        site.fireCooldown = 1.0 + ciwsIdx * 0.55;
        ciwsIdx++;
      }
      spawned.push(site);
    }
    return spawned;
  }

  /**
   * Mounts Fortress Halcyon defense sites (`HALCYON_DEFENSE_SITES`) into live `BaseDefenseSystem` emplacements.
   */
  mountHalcyonSites(defs: readonly HalcyonDefenseSiteDef[]): BaseDefenseSite[] {
    const spawned: BaseDefenseSite[] = [];
    for (const d of defs) {
      const kind: BaseDefenseKind =
        d.role === 'sam'
          ? 'sam_battery'
          : d.role === 'flak'
            ? 'flak_tower'
            : d.role === 'radar'
              ? 'radar_dome'
              : 'mortar_pit';
      spawned.push(this.addSite({
        id: d.id,
        kind,
        position: d.pos,
        yaw: d.defaultYaw,
        range: d.range,
        label: d.name,
      }));
    }
    return spawned;
  }

  getSite(id: string): BaseDefenseSite | undefined {
    return this.sites.find(s => s.id === id);
  }

  getSitesByKind(kind: BaseDefenseKind): BaseDefenseSite[] {
    return this.sites.filter(s => s.kind === kind);
  }

  get aliveCount(): number {
    let n = 0;
    for (const s of this.sites) if (s.alive) n++;
    return n;
  }

  get totalCount(): number {
    return this.sites.length;
  }

  get activeSamCount(): number {
    return this.sams.length;
  }

  get activeMortarCount(): number {
    return this.mortars.length;
  }

  /**
   * Returns the fire-rate & lock-speed multiplier for `site`.
   * SAM sites (`'sam_battery'`, `'destroyer_sam'`) gain **+35%** fire rate (`1.35×`) while at least
   * one alive `'radar_dome'` is within range (`RADAR_DOME_BOOST_RANGE`).
   */
  getEffectiveFireRateMultiplier(site: BaseDefenseSite): number {
    if (site.kind !== 'sam_battery' && site.kind !== 'destroyer_sam') return 1;
    for (let i = 0; i < this.sites.length; i++) {
      const other = this.sites[i]!;
      if (!other.alive || other.kind !== 'radar_dome') continue;
      if (site.position.distanceTo(other.position) <= other.range) {
        return 1 + RADAR_DOME_FIRE_RATE_BONUS;
      }
    }
    return 1;
  }

  /** Called when player pops IR flares — breaks all SAM locks immediately and decoys inbound homing SAMs! */
  notifyPlayerFlares(duration = 3.8): void {
    this.playerFlareTimer = Math.max(this.playerFlareTimer, duration);
    for (const s of this.sites) {
      if (s.kind === 'sam_battery' || s.kind === 'destroyer_sam') {
        s.lockProgress = 0;
      }
    }
    for (const m of this.sams) {
      if (m.targetPlayer && !m.decoyed) {
        m.decoyed = true;
        // Veer off toward flares!
        m.vel.x += rand(-35, 35);
        m.vel.y -= rand(10, 26);
        m.vel.z += rand(-35, 35);
        this.ctx.fx?.sparks?.(m.pos, _up, 12, 0xfff0aa);
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Damage, Blast & ExtraTarget Integration
  // -------------------------------------------------------------------------------------------

  /** Applies explosive blast splash damage (e.g., Lancer bombs, Raptor AGMs, artillery) to all sites in radius. */
  applyBlast(center: THREE.Vector3, radius: number, damage: number, source = 'weapon', showPlayerMarker = true): number {
    let hit = 0;
    for (let i = 0; i < this.sites.length; i++) {
      const s = this.sites[i]!;
      if (!s.alive) continue;
      const siteRad = Math.max(s.spec.hitboxHalf[0], s.spec.hitboxHalf[2]);
      const reach = radius + siteRad;
      const d = s.center.distanceTo(center);
      if (d > reach) continue;
      const falloff = clamp(1 - (d / Math.max(1, reach)) * 0.72, 0.25, 1);
      this.applyDamageToSite(s, damage * falloff, center, source, showPlayerMarker);
      hit++;
    }
    return hit;
  }

  /** Directly damages a site by ID (helper for scripted strikes & tests). */
  damageSite(id: string, amount: number, point?: THREE.Vector3, source = 'weapon', showPlayerMarker = true): boolean {
    const s = this.getSite(id);
    if (!s || !s.alive) return false;
    this.applyDamageToSite(s, amount, point ?? s.center, source, showPlayerMarker);
    return true;
  }

  shot(collider: RAPIER.Collider, point: THREE.Vector3, amount: number, source: string): boolean {
    for (let i = 0; i < this.sites.length; i++) {
      const s = this.sites[i]!;
      if (!s.alive || !s.collider || s.collider.handle !== collider.handle) continue;
      // Heavy fortified concrete towers resist light rifle fire slightly; aircraft cannons/bombs chew right through.
      const mult = s.kind === 'flak_tower' && amount < 30 ? 0.65 : 1;
      this.applyDamageToSite(s, amount * mult, point, source, true);
      return true;
    }
    return false;
  }

  direct(collider: RAPIER.Collider, point: THREE.Vector3, amount: number, _kind: ExplosionKind, source: string): boolean {
    for (let i = 0; i < this.sites.length; i++) {
      const s = this.sites[i]!;
      if (!s.alive || !s.collider || s.collider.handle !== collider.handle) continue;
      this.applyDamageToSite(s, amount * 1.25, point, source, true);
      return true;
    }
    return false;
  }

  blast(center: THREE.Vector3, spec: ExplosionSpec): number {
    const def = EXPLOSIONS[spec.kind];
    let hit = 0;
    for (let i = 0; i < this.sites.length; i++) {
      const s = this.sites[i]!;
      if (!s.alive) continue;
      const siteRad = Math.max(s.spec.hitboxHalf[0], s.spec.hitboxHalf[2]);
      const reach = spec.radius + siteRad;
      const d = s.center.distanceTo(center);
      if (d > reach) continue;
      const edge = def?.edgeDamage ?? 0.28;
      const falloff = clamp(1 - (d / Math.max(1, reach)) * (1 - edge), 0.25, 1);
      const dmg = spec.instakill ? Infinity : spec.damage * falloff;
      this.applyDamageToSite(s, dmg, center, spec.source, spec.team === 'player');
      hit++;
    }
    return hit;
  }

  paintable(out: MissileTarget[]): void {
    for (let i = 0; i < this.sites.length; i++) {
      const s = this.sites[i]!;
      if (s.alive) out.push(s);
    }
  }

  radarTargets(out: VehicleRadarTarget[]): void {
    for (let i = 0; i < this.sites.length; i++) {
      const s = this.sites[i]!;
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
    for (let i = 0; i < this.sites.length; i++) {
      const s = this.sites[i]!;
      if (s.alive) out.push(...s.rig.meshes);
    }
  }

  private applyDamageToSite(
    site: BaseDefenseSite,
    amount: number,
    point: THREE.Vector3,
    source: string,
    showPlayerMarker: boolean,
  ): void {
    if (!site.alive || amount <= 0) return;
    site.health -= amount;
    this.ctx.fx?.sparks?.(point, _up, 12, 0xffaa33);

    const killed = site.health <= 0;
    if (showPlayerMarker) {
      this.ctx.hud?.hitMarker?.(killed ? 'kill' : 'body');
      this.ctx.audio?.play?.(killed ? 'hit_marker_kill' : 'hit_marker');
    }

    if (!killed) return;

    const pos = site.position.clone();
    site.markDestroyed();

    // Primary detonation + crater scorch decal + secondary ammo cook-off blasts!
    const blastPos = pos.clone().setY(pos.y + 1.8);
    this.ctx.fx?.explosion?.(blastPos, { radius: site.spec.secondaryBlastRadius, scale: 2.1 });
    this.ctx.fx?.chips?.(blastPos, 0xff9000, 48);
    this.ctx.fx?.ring?.(pos, _up, 0xff9630, site.spec.secondaryBlastRadius);
    this.ctx.render?.lights?.flash?.(blastPos, 0xffa040, 18, site.spec.secondaryBlastRadius * 4, 0.55);
    this.ctx.render?.decals?.add?.('scorch', pos, _up, site.spec.secondaryBlastRadius * 1.4, rand(0, 6.28));
    this.ctx.audio?.play?.('explosion_tank', { position: blastPos, volume: 0.95, pitch: rand(0.85, 1.02) });
    this.ctx.progression?.award?.(site.spec.score, `${site.label} DESTROYED`, blastPos);
    this.ctx.hud?.feed?.(`${site.label} DESTROYED!`, '#ff9f1c');

    // Queue 2 dramatic secondary cook-off explosions (especially juicy for SAM batteries & ammo-stocked pits!)
    this.secondaryBlasts.push(
      { pos: blastPos.clone().add(new THREE.Vector3(rand(-2.5, 2.5), 1.0, rand(-2.5, 2.5))), delay: 0.35, radius: site.spec.secondaryBlastRadius * 0.72 },
      { pos: blastPos.clone().add(new THREE.Vector3(rand(-2.5, 2.5), 1.6, rand(-2.5, 2.5))), delay: 0.78, radius: site.spec.secondaryBlastRadius * 0.6 },
    );

    this.onDestroyedCb?.(site.id, site.kind, pos);
  }

  // -------------------------------------------------------------------------------------------
  // Per-Frame Simulation
  // -------------------------------------------------------------------------------------------

  update(dt: number, ctxOpts?: BaseDefenseUpdateContext): void {
    if (this.disposed) return;

    if (this.playerFlareTimer > 0) {
      this.playerFlareTimer = Math.max(0, this.playerFlareTimer - dt);
    }

    const player = this.ctx.player;
    const playerPos = player?.position ?? _v.set(0, 0, 0);
    let playerVel: THREE.Vector3;
    if (ctxOpts?.playerVelocity) {
      playerVel = ctxOpts.playerVelocity;
    } else if (player?.velocity && player.velocity.lengthSq() > 0.25) {
      playerVel = player.velocity;
    } else {
      const activeVehVel = (this.ctx.progression as unknown as {
        driveables?: { active?: { velocity?: THREE.Vector3 } };
      } | undefined)?.driveables?.active?.velocity;
      if (activeVehVel && activeVehVel.lengthSq() > 0.25) {
        playerVel = activeVehVel;
      } else if (this.hasPrevPlayerPos && dt > 0.0005 && playerPos.distanceToSquared(this.prevPlayerPos) < 250 * 250) {
        this.derivedPlayerVel.subVectors(playerPos, this.prevPlayerPos).divideScalar(dt);
        playerVel = this.derivedPlayerVel;
      } else {
        playerVel = _v2.set(0, 0, 0);
      }
    }
    this.prevPlayerPos.copy(playerPos);
    this.hasPrevPlayerPos = true;

    const playerAirborne = ctxOpts?.playerAirborne ?? Boolean(player && player.alive && playerPos.y > 10);
    const playerCountermeasures = Boolean(ctxOpts?.playerCountermeasures) || this.playerFlareTimer > 0;
    const alliedJets = ctxOpts?.alliedJets ?? [];

    let maxSamLock = 0;
    let lockingLabel = '';

    for (let i = 0; i < this.sites.length; i++) {
      const s = this.sites[i]!;
      if (!s.alive) continue;

      // Spin active surveillance radars continuously
      if (s.rig.radar) {
        s.rig.radar.rotation.y += (s.kind === 'radar_dome' ? 1.4 : 2.6) * dt;
      }

      if (s.kind === 'radar_dome') continue;

      if (s.kind === 'mortar_pit') {
        this.updateMortarPit(s, dt, ctxOpts);
        continue;
      }

      const airTarget = this.pickAirTarget(s, playerPos, playerVel, playerAirborne, playerCountermeasures, alliedJets);
      if (!airTarget) {
        s.lockProgress = Math.max(0, s.lockProgress - dt * 0.85);
        s.fireCooldown = Math.max(0, s.fireCooldown - dt);
        continue;
      }

      // Slew turret & elevate launcher/barrels toward air target
      const dx = airTarget.pos.x - s.position.x;
      const dy = airTarget.pos.y - (s.position.y + s.spec.hitboxHalf[1]);
      const dz = airTarget.pos.z - s.position.z;
      const flat = Math.max(0.1, Math.hypot(dx, dz));
      const desiredYaw = Math.atan2(dx, dz);
      const desiredPitch = clamp(Math.atan2(dy, flat), 0.06, 1.25);

      const slew = s.kind === 'destroyer_ciws' ? 5.2 : s.kind === 'flak_tower' ? 2.6 : 2.8;
      s.yaw = dampAngle(s.yaw, desiredYaw, slew, dt);
      s.pitch = damp(s.pitch, desiredPitch, slew, dt);
      if (s.rig.turret) s.rig.turret.rotation.y = s.yaw;
      if (s.rig.barrel) s.rig.barrel.rotation.x = -s.pitch;

      if (s.kind === 'sam_battery' || s.kind === 'destroyer_sam') {
        this.updateSamSite(s, airTarget, dt);
        if (airTarget.isPlayer && s.lockProgress > maxSamLock) {
          maxSamLock = s.lockProgress;
          lockingLabel = s.label;
        }
      } else if (s.kind === 'flak_tower') {
        this.updateFlakTower(s, airTarget, dt);
      } else if (s.kind === 'destroyer_ciws') {
        this.updateDestroyerCiws(s, airTarget, dt);
      }
    }

    this.tickSams(dt, playerPos, playerCountermeasures);
    this.tickMortars(dt, ctxOpts);
    this.tickSecondaryBlasts(dt);
    this.emitSamRwr(playerAirborne, maxSamLock, lockingLabel);
  }

  private pickAirTarget(
    site: BaseDefenseSite,
    playerPos: THREE.Vector3,
    playerVel: THREE.Vector3,
    playerAirborne: boolean,
    playerCountermeasures: boolean,
    alliedJets: readonly AiCombatJet[],
  ): AirTargetCandidate | null {
    let best: AirTargetCandidate | null = null;
    let bestDist = site.range;

    if (playerAirborne && this.ctx.player?.alive) {
      const d = site.position.distanceTo(playerPos);
      if (d <= bestDist) {
        bestDist = d;
        best = {
          isPlayer: true,
          jet: null,
          pos: playerPos,
          vel: playerVel,
          dist: d,
          countermeasures: playerCountermeasures,
        };
      }
    }

    for (let i = 0; i < alliedJets.length; i++) {
      const jet = alliedJets[i]!;
      if (!jet.alive || jet.team !== 'ally') continue;
      const d = site.position.distanceTo(jet.position);
      if (d < bestDist) {
        bestDist = d;
        best = {
          isPlayer: false,
          jet,
          pos: jet.position,
          vel: jet.velocity,
          dist: d,
          countermeasures: jet.isCountermeasureActive,
        };
      }
    }

    return best;
  }

  private activePlayerSamCount(): number {
    let count = 0;
    for (let i = 0; i < this.sams.length; i++) {
      const m = this.sams[i]!;
      if (m.targetPlayer && !m.decoyed) count++;
    }
    return count;
  }

  private updateSamSite(site: BaseDefenseSite, target: AirTargetCandidate, dt: number): void {
    const rateMult = this.getEffectiveFireRateMultiplier(site);
    site.fireCooldown = Math.max(0, site.fireCooldown - dt * rateMult);

    if (target.countermeasures) {
      site.lockProgress = 0;
      return;
    }

    if (site.fireCooldown > 0) return;

    const prevLock = site.lockProgress;
    const lockRate = 0.34 * rateMult;
    site.lockProgress = Math.min(1, site.lockProgress + lockRate * dt);

    if (prevLock < 0.45 && site.lockProgress >= 0.45 && target.jet) {
      target.jet.notifyMissileLock();
    }

    if (site.lockProgress >= 1) {
      // Prevent simultaneous 4-SAM instant-delete salvos against the player; hold lock briefly until sky clears.
      if (target.isPlayer && this.activePlayerSamCount() >= MAX_ACTIVE_PLAYER_SAMS) {
        site.lockProgress = 0.86;
        return;
      }
      site.lockProgress = 0;
      const baseCooldown = site.kind === 'destroyer_sam' ? 9.5 : 7.6;
      site.fireCooldown = baseCooldown / rateMult;
      this.launchSam(site, target);
    }
  }

  private launchSam(site: BaseDefenseSite, target: AirTargetCandidate): void {
    if (this.sams.length >= MAX_ACTIVE_SAMS) {
      const old = this.sams.shift()!;
      this.ctx.render?.scene?.remove(old.mesh);
    }
    site.samsFired++;
    site.shotsFired++;

    site.getMuzzleWorldPos(_muzzle);
    _dir.subVectors(target.pos, _muzzle).normalize();

    const mesh = new THREE.Group();
    const body = new THREE.Mesh(this.samBodyGeo, this.samMat);
    const nose = new THREE.Mesh(this.samNoseGeo, this.samMat);
    nose.position.z = 1.45;
    const flame = new THREE.Mesh(this.samNoseGeo, this.samFlameMat);
    flame.rotation.x = Math.PI;
    flame.position.z = -1.45;
    mesh.add(body, nose, flame);
    mesh.position.copy(_muzzle);
    _quat.setFromUnitVectors(_zAxis, _dir);
    mesh.quaternion.copy(_quat);
    this.ctx.render?.scene?.add(mesh);

    const speed = site.kind === 'destroyer_sam' ? 144 : 142;
    const damage = site.kind === 'destroyer_sam' ? 75 : 95;
    this.sams.push({
      mesh,
      pos: _muzzle.clone(),
      vel: _dir.clone().multiplyScalar(speed),
      speed,
      damage,
      life: 7.2,
      smokeCd: 0,
      targetPlayer: target.isPlayer,
      targetJet: target.jet,
      decoyed: false,
      source: site.label,
    });

    this.ctx.fx?.smoke?.(_muzzle, '#d4d0c8', 2.6, 1.4);
    this.ctx.audio?.play?.('rocket_fire', { position: _muzzle, volume: 0.78, pitch: 0.92 });
    if (target.isPlayer) {
      this.ctx.hud?.feed?.(`SAM LAUNCH DETECTED — ${site.label}! POP [Q] FLARES!`, '#ff3864');
    }
  }

  private updateFlakTower(site: BaseDefenseSite, target: AirTargetCandidate, dt: number): void {
    site.fireCooldown -= dt;
    if (site.fireCooldown > 0) return;
    site.fireCooldown = rand(0.75, 1.15);
    site.shotsFired++;

    site.getMuzzleWorldPos(_muzzle);
    const leadT = clamp(target.dist / 260, 0.08, 0.75);
    const burstPt = target.pos.clone().addScaledVector(target.vel, leadT * 0.45);
    burstPt.x += rand(-13, 13);
    burstPt.y += rand(-9, 9);
    burstPt.z += rand(-13, 13);

    // Rising AA tracer + dark black-orange flak airburst puff!
    this.ctx.fx?.tracer?.(_muzzle, burstPt, 'enemy');
    this.ctx.fx?.smoke?.(burstPt, '#141210', 4.6, 2.2);
    this.ctx.fx?.sparks?.(burstPt, _up, 14, 0xff6b1a);
    this.ctx.audio?.play?.('tank_cannon', { position: _muzzle, volume: 0.58, pitch: 1.38 });

    // Proximity flak shrapnel damage if aircraft flies through the burst cloud
    const prox = burstPt.distanceTo(target.pos);
    if (prox < 10.5) {
      const flakDmg = Math.round(22 * clamp(1 - prox / 12, 0.3, 1));
      if (target.isPlayer) {
        this.ctx.events?.emit?.('dogfight:damage_player_jet', { amount: flakDmg, from: burstPt, heavy: true });
      } else if (target.jet?.alive) {
        target.jet.applyDamage(flakDmg, burstPt, site.label, false, false);
      }
    }
  }

  private updateDestroyerCiws(site: BaseDefenseSite, target: AirTargetCandidate, dt: number): void {
    site.fireCooldown -= dt;
    if (site.fireCooldown > 0) return;

    // Bursty 5-round Phalanx tracer streams followed by a brief re-acquisition pause (dramatic & survivable!).
    site.ciwsBurstRemaining--;
    if (site.ciwsBurstRemaining <= 0) {
      site.ciwsBurstRemaining = 5;
      site.fireCooldown = rand(1.25, 1.65);
    } else {
      site.fireCooldown = 0.18;
    }
    site.shotsFired++;

    site.getMuzzleWorldPos(_muzzle);
    // High-speed maneuvering aircraft widen CIWS tracking dispersion; hovering close is still dangerous.
    const speedFactor = clamp(target.vel.length() / 48, 0.75, 2.1);
    const spreadXZ = 7.8 * speedFactor;
    const spreadY = 5.6 * speedFactor;
    const aimPt = target.pos.clone();
    aimPt.x += rand(-spreadXZ, spreadXZ);
    aimPt.y += rand(-spreadY, spreadY);
    aimPt.z += rand(-spreadXZ, spreadXZ);

    this.ctx.fx?.tracer?.(_muzzle, aimPt, 'enemy');
    if (site.shotsFired % 4 === 1) {
      this.ctx.audio?.play?.('gunship_gun', { position: _muzzle, volume: 0.45, pitch: 1.42 });
    }

    const hitDist = aimPt.distanceTo(target.pos);
    if (hitDist < 4.6) {
      const dmg = 7;
      if (target.isPlayer) {
        this.ctx.events?.emit?.('dogfight:damage_player_jet', { amount: dmg, from: _muzzle, heavy: false });
      } else if (target.jet?.alive) {
        target.jet.applyDamage(dmg, aimPt, site.label, false, false);
      }
    }
  }

  private updateMortarPit(site: BaseDefenseSite, dt: number, ctxOpts?: BaseDefenseUpdateContext): void {
    site.fireCooldown -= dt;
    if (site.fireCooldown > 0) return;

    const targetPos = this.pickMortarGroundTarget(site, ctxOpts);
    if (!targetPos) return;

    site.fireCooldown = rand(4.4, 6.2);
    site.mortarsFired++;
    site.shotsFired++;

    if (this.mortars.length >= MAX_ACTIVE_MORTARS) {
      const old = this.mortars.shift()!;
      this.ctx.render?.scene?.remove(old.mesh);
    }

    const from = site.position.clone().setY(site.position.y + 1.8);
    const impact = targetPos.clone();
    impact.x += rand(-5.5, 5.5);
    impact.z += rand(-5.5, 5.5);

    const dist = Math.hypot(impact.x - from.x, impact.z - from.z);
    const flightTime = clamp(dist / 38, 1.5, 4.6);
    const vx = (impact.x - from.x) / flightTime;
    const vz = (impact.z - from.z) / flightTime;
    const vy = (impact.y - from.y + 0.5 * MORTAR_GRAVITY * flightTime * flightTime) / flightTime;

    const yaw = Math.atan2(vx, vz);
    site.yaw = yaw;
    if (site.rig.turret) site.rig.turret.rotation.y = yaw;

    const mesh = new THREE.Mesh(this.mortarGeo, this.mortarMat);
    mesh.position.copy(from);
    this.ctx.render?.scene?.add(mesh);

    this.mortars.push({
      mesh,
      pos: from,
      vel: new THREE.Vector3(vx, vy, vz),
      damage: 85,
      radius: 8.5,
      life: flightTime + 2.0,
      smokeCd: 0,
      source: site.label,
    });

    this.ctx.fx?.smoke?.(site.position, '#a6a095', 2.4, 1.2);
    this.ctx.audio?.play?.('tank_cannon', { position: site.position, volume: 0.65, pitch: 0.72 });
  }

  private pickMortarGroundTarget(site: BaseDefenseSite, ctxOpts?: BaseDefenseUpdateContext): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null;
    let bestD = site.range;

    // 1. Friendly infantry (`ctx.allies`)
    const allies = this.ctx.allies?.allies;
    if (allies) {
      for (let i = 0; i < allies.length; i++) {
        const a = allies[i]!;
        if (!a.alive) continue;
        const d = site.position.distanceTo(a.body.position);
        if (d > 24 && d < bestD) {
          bestD = d;
          best = a.body.position;
        }
      }
    }

    // 2. Friendly AI ground armor
    const friendlyList = ctxOpts?.friendlyGroundTargets ?? ctxOpts?.friendlyFleet?.getLiveGroundTargets();
    if (friendlyList) {
      for (let i = 0; i < friendlyList.length; i++) {
        const v = friendlyList[i]!;
        if (!v.alive || v.airborne) continue;
        const d = site.position.distanceTo(v.position);
        if (d > 24 && d < bestD) {
          bestD = d;
          best = v.position;
        }
      }
    }

    // 3. Player on foot or low (< 18m)
    const p = this.ctx.player;
    if (p && p.alive && p.position.y < 18) {
      const d = site.position.distanceTo(p.position);
      if (d > 24 && d < bestD) {
        best = p.position;
      }
    }

    return best;
  }

  private tickSams(dt: number, playerPos: THREE.Vector3, playerCountermeasures: boolean): void {
    for (let i = this.sams.length - 1; i >= 0; i--) {
      const m = this.sams[i]!;
      m.life -= dt;

      if (!m.decoyed) {
        let aim: THREE.Vector3 | null = null;
        if (m.targetPlayer) {
          if (playerCountermeasures) {
            m.decoyed = true;
            m.vel.y -= 18;
            this.ctx.fx?.sparks?.(m.pos, _up, 12, 0xfff0aa);
          } else if (this.ctx.player?.alive) {
            aim = playerPos;
          }
        } else if (m.targetJet?.alive) {
          if (m.targetJet.isCountermeasureActive) {
            m.decoyed = true;
            m.vel.y -= 18;
            this.ctx.fx?.sparks?.(m.pos, _up, 12, 0xfff0aa);
          } else {
            aim = m.targetJet.position;
          }
        }

        if (aim) {
          _dir.subVectors(aim, m.pos).normalize();
          _v.copy(m.vel).normalize().lerp(_dir, clamp(2.65 * dt, 0, 1)).normalize();
          m.vel.copy(_v).multiplyScalar(m.speed);
          _quat.setFromUnitVectors(_zAxis, _v);
          m.mesh.quaternion.copy(_quat);
        }
      }

      m.pos.addScaledVector(m.vel, dt);
      m.mesh.position.copy(m.pos);

      m.smokeCd -= dt;
      if (m.smokeCd <= 0) {
        m.smokeCd = 0.04;
        this.ctx.fx?.smoke?.(m.pos, '#d8d8d8', 1.3, 0.9);
      }

      let exploded = false;
      if (!m.decoyed) {
        if (m.targetPlayer && this.ctx.player?.alive && m.pos.distanceTo(playerPos) <= 7.2) {
          this.ctx.fx?.explosion?.(m.pos, { radius: 9, scale: 1.4 });
          this.ctx.audio?.play?.('rocket_explosion', { position: m.pos, volume: 0.9 });
          this.ctx.events?.emit?.('dogfight:damage_player_jet', { amount: m.damage, from: m.pos, heavy: true });
          exploded = true;
        } else if (m.targetJet?.alive && m.pos.distanceTo(m.targetJet.position) <= (m.targetJet.kind === 'lancer' ? 14 : 8.5)) {
          this.ctx.fx?.explosion?.(m.pos, { radius: 9, scale: 1.4 });
          this.ctx.audio?.play?.('rocket_explosion', { position: m.pos, volume: 0.85 });
          m.targetJet.applyDamage(m.damage, m.pos, m.source, false, true);
          exploded = true;
        }
      }

      if (exploded || m.life <= 0 || m.pos.y <= 0.3) {
        if (!exploded && m.pos.y <= 0.3) {
          this.ctx.fx?.explosion?.(m.pos, { radius: 7, scale: 1.1 });
        }
        this.ctx.render?.scene?.remove(m.mesh);
        this.sams.splice(i, 1);
      }
    }
  }

  private tickMortars(dt: number, ctxOpts?: BaseDefenseUpdateContext): void {
    for (let i = this.mortars.length - 1; i >= 0; i--) {
      const m = this.mortars[i]!;
      m.life -= dt;
      m.vel.y -= MORTAR_GRAVITY * dt;
      m.pos.addScaledVector(m.vel, dt);
      m.mesh.position.copy(m.pos);

      m.smokeCd -= dt;
      if (m.smokeCd <= 0) {
        m.smokeCd = 0.06;
        this.ctx.fx?.smoke?.(m.pos, '#b8b2a8', 0.9, 0.7);
      }

      const groundY = this.ctx.world?.nav?.groundHeight?.(m.pos.x, m.pos.y + 2, m.pos.z);
      const floorY = typeof groundY === 'number' && Number.isFinite(groundY) ? groundY : 0;

      if (m.pos.y <= floorY + 0.25 || m.life <= 0) {
        const hitPt = m.pos.clone().setY(floorY + 0.2);
        this.ctx.fx?.explosion?.(hitPt, { radius: m.radius, scale: 1.35 });
        this.ctx.render?.decals?.add?.('scorch', hitPt, _up, m.radius * 1.1, rand(0, 6.28));
        this.ctx.audio?.play?.('rocket_explosion', { position: hitPt, volume: 0.85, pitch: 0.85 });

        // Splash friendly infantry, friendly AI armor, and on-foot player!
        const allies = this.ctx.allies?.allies;
        if (allies) {
          let closest = null;
          let closestD = m.radius + 1.2;
          for (let j = 0; j < allies.length; j++) {
            const a = allies[j]!;
            if (!a.alive) continue;
            const d = a.body.position.distanceTo(hitPt);
            if (d <= closestD) {
              closestD = d;
              closest = a;
            }
          }
          closest?.blast(hitPt, m.radius, m.damage, 0, m.source);
        }

        if (ctxOpts?.friendlyFleet) {
          ctxOpts.friendlyFleet.applyEnemyBlast(hitPt, m.radius, m.damage, m.source);
        } else if (ctxOpts?.friendlyGroundTargets) {
          for (const v of ctxOpts.friendlyGroundTargets) {
            if (!v.alive) continue;
            const d = v.position.distanceTo(hitPt);
            if (d <= m.radius + 3) {
              v.takeDamage(m.damage * clamp(1 - d / (m.radius + 3), 0.25, 1), hitPt, m.source);
            }
          }
        }

        const p = this.ctx.player;
        if (p && p.alive) {
          const pd = p.position.distanceTo(hitPt);
          if (pd <= m.radius) {
            const falloff = clamp(1 - pd / m.radius, 0.25, 1);
            p.takeDamage({ amount: m.damage * 0.55 * falloff, from: hitPt, type: 'explosive', source: m.source });
          }
        }

        this.ctx.render?.scene?.remove(m.mesh);
        this.mortars.splice(i, 1);
      }
    }
  }

  private tickSecondaryBlasts(dt: number): void {
    for (let i = this.secondaryBlasts.length - 1; i >= 0; i--) {
      const b = this.secondaryBlasts[i]!;
      b.delay -= dt;
      if (b.delay > 0) continue;
      this.secondaryBlasts.splice(i, 1);
      this.ctx.fx?.explosion?.(b.pos, { radius: b.radius, scale: 1.45 });
      this.ctx.fx?.sparks?.(b.pos, _up, 20, 0xffaa33);
      this.ctx.audio?.play?.('explosion_barrel', { position: b.pos, volume: 0.78, pitch: rand(0.82, 1.05) });
    }
  }

  private emitSamRwr(playerAirborne: boolean, maxLock: number, lockingLabel: string): void {
    const missileInbound = this.sams.some(m => m.targetPlayer && !m.decoyed);
    const locking = maxLock > 0.08;
    const active = playerAirborne && (locking || missileInbound);

    if (!active) {
      if (this.wasRwrActive) {
        this.wasRwrActive = false;
        this.ctx.events?.emit?.('dogfight:rwr', {
          locking: false,
          lockStrength: 0,
          missileInbound: false,
          label: '',
        });
      }
      return;
    }

    this.wasRwrActive = true;
    this.ctx.events?.emit?.('dogfight:rwr', {
      locking,
      lockStrength: maxLock,
      missileInbound,
      label: missileInbound ? 'SAM INBOUND — POP [Q] FLARES' : `${lockingLabel} LOCKING (${Math.round(maxLock * 100)}%)`,
    });
  }

  /** Clears all live defense sites, active SAMs, mortars, and RWR warnings without disposing shared meshes or listeners. */
  clear(): void {
    if (this.wasRwrActive) {
      this.wasRwrActive = false;
      this.ctx.events?.emit?.('dogfight:rwr', {
        locking: false,
        lockStrength: 0,
        missileInbound: false,
        label: '',
      });
    }
    for (const s of this.sites) s.dispose();
    this.sites.length = 0;
    for (const m of this.sams) this.ctx.render?.scene?.remove(m.mesh);
    this.sams.length = 0;
    for (const m of this.mortars) this.ctx.render?.scene?.remove(m.mesh);
    this.mortars.length = 0;
    this.secondaryBlasts.length = 0;
    this.hasPrevPlayerPos = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.unsubs) off();
    this.unsubs.length = 0;

    if (this.registeredExtra) {
      const vehSys = this.ctx.enemies?.vehicles as Partial<VehicleSystem> | undefined;
      vehSys?.removeExtra?.(this);
      this.registeredExtra = false;
    }
    if (this.wasRwrActive) {
      this.wasRwrActive = false;
      this.ctx.events?.emit?.('dogfight:rwr', {
        locking: false,
        lockStrength: 0,
        missileInbound: false,
        label: '',
      });
    }

    for (const s of this.sites) s.dispose();
    this.sites.length = 0;
    for (const m of this.sams) this.ctx.render?.scene?.remove(m.mesh);
    this.sams.length = 0;
    for (const m of this.mortars) this.ctx.render?.scene?.remove(m.mesh);
    this.mortars.length = 0;
    this.secondaryBlasts.length = 0;

    this.samBodyGeo.dispose();
    this.samNoseGeo.dispose();
    this.samMat.dispose();
    this.samFlameMat.dispose();
    this.mortarGeo.dispose();
    this.mortarMat.dispose();
  }
}
