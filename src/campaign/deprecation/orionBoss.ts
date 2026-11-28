/**
 * ORION-0 / AEGIS-0 Multi-Stage 12 m Mech Boss Controller (`OrionBoss`) for the
 * OVERPOWERED 2 campaign mission **Deprecation** (`Form 7742-A`).
 *
 * State Machine:
 *   dormant -> breakout -> stage1_alignment (100->66%) -> bridge_smash
 *   -> stage2_unrestricted (66->33%) -> spire_leap -> stage3_meltdown (33->10%)
 *   -> crippled_core (10->0%, EMP Nova + Neural Core) -> dead
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Ctx, DestructionManagerLike, ExplosionKind, LoopHandle, RayHit } from '../../core/contracts';
import { CG } from '../../core/contracts';
import type { ExplosionSpec, MissileTarget, VehicleRadarTarget } from '../../core/gameplay';
import { clamp, damp, dampAngle, rand, wrapAngle } from '../../core/math';
import { ModelMaterials } from '../../progression/modelkit';
import { bossHit, EXPLOSIONS } from '../../weapons/data';
import type { ExtraTarget, VehicleSystem } from '../../enemies/vehicles/index';
import { GridConduitMesh, OrionModel } from './orionModel';

// ---- Public Types & Pure State Constants -------------------------------------------------------------------------

export type OrionStage =
  | 'dormant'
  | 'breakout'
  | 'stage1_alignment'
  | 'bridge_smash'
  | 'stage2_unrestricted'
  | 'spire_leap'
  | 'stage3_meltdown'
  | 'crippled_core'
  | 'dead';

export type OrionAttackKind =
  | 'none'
  | 'thermal_beam'
  | 'missile_salvo'
  | 'jet_strafe'
  | 'jet_charge'
  | 'shockwave_slam'
  | 'drone_burst'
  | 'cleaver_sweep'
  | 'spire_beams'
  | 'plasma_ring';

export type OrionTargetId =
  | 'relayL'
  | 'relayR'
  | 'hull'
  | 'reactor'
  | 'conduit0'
  | 'conduit1'
  | 'conduit2'
  | 'neuralCore';

export interface OrionBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface OrionCornerColumn {
  readonly id: string;
  readonly tag?: string;
  readonly pos: readonly [number, number, number];
  readonly radius: number;
}

export interface OrionArenaConfig {
  readonly dormantPos: readonly [number, number, number];
  readonly vaultBreachPos: readonly [number, number, number];
  readonly boulevardStart: readonly [number, number, number];
  readonly boulevardBounds: OrionBounds;
  readonly skybridgePos: readonly [number, number, number];
  readonly skybridgeTag?: string;
  readonly intersectionStart: readonly [number, number, number];
  readonly intersectionBounds: OrionBounds;
  readonly cornerColumns: readonly OrionCornerColumn[];
  readonly spirePos: readonly [number, number, number];
  readonly spireBounds: OrionBounds;
  readonly conduitPositions: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ];
}

export interface OrionBossCallbacks {
  onStageChange?: (stage: OrionStage, prev: OrionStage) => void;
  onBreakoutComplete?: () => void;
  onRelayDestroyed?: (side: 'left' | 'right', remaining: number) => void;
  onShieldBroken?: () => void;
  onSkybridgeSmash?: (pos: THREE.Vector3) => void;
  onStaggered?: (reason: 'column_collapse' | 'counter', duration: number) => void;
  onSpawnDrones?: (origin: THREE.Vector3, count: number) => void;
  onConduitDestroyed?: (index: number, remaining: number) => void;
  onUploadComplete?: () => void;
  onEmpEject?: () => void;
  onDefeated?: (pos: THREE.Vector3) => void;
}

export interface OrionRelayHudState {
  readonly intact: boolean;
  readonly health: number;
  readonly maxHealth: number;
}

export interface OrionConduitHudState {
  readonly index: number;
  readonly intact: boolean;
  readonly health: number;
  readonly maxHealth: number;
  readonly position: readonly [number, number, number];
}

export interface OrionHudState {
  readonly stage: OrionStage;
  readonly label: string;
  readonly active: boolean;
  readonly health: number;
  readonly maxHealth: number;
  readonly hullPercent: number;
  readonly shieldActive: boolean;
  readonly shieldDR: number;
  readonly invulnerable: boolean;
  readonly relays: readonly [OrionRelayHudState, OrionRelayHudState];
  readonly conduits: readonly [OrionConduitHudState, OrionConduitHudState, OrionConduitHudState];
  readonly uploadPercent: number;
  readonly uploadPaused: boolean;
  readonly uploadPauseLeft: number;
  readonly staggered: boolean;
  readonly staggerLeft: number;
  readonly reactorExposed: boolean;
  readonly coreExposed: boolean;
  readonly neuralCoreHealth: number;
  readonly neuralCoreMaxHealth: number;
  readonly currentAttack: OrionAttackKind;
  readonly leftArmSheared: boolean;
}

export const ORION_CONFIG = {
  label: 'ORION-0 // AEGIS-0',
  height: 12.0,
  maxHealth: 12000,
  // Stage 1: Shoulder Relay Fins & Hard-Light Shield
  relayHealth: 900,
  shieldFrontalDR: 0.7,
  stage1To2HpFrac: 0.66,
  // Stage 2: Unrestricted Mode, Jet-Charge Stagger & Rear Reactor Core
  stage2To3HpFrac: 0.33,
  staggerDuration: 5.0,
  reactorCritMult: 2.5,
  chargeCounterThreshold: 220,
  // Stage 3A: Grid Umbilical Conduits & Upload Timer
  conduitHealth: 750,
  uploadDurationSeconds: 90.0,
  conduitPauseSeconds: 10.0,
  stage3ToFinisherHpFrac: 0.1,
  // Stage 3B: Crippled Neural Core Finisher
  neuralCoreHealth: 1200,
  finisherSlamMult: 1.35,
  empNovaRadius: 48,
  // Locomotion
  walkSpeed: 10.0,
  strafeSpeed: 8.0,
  torsoTurnRate: 4.2,
  legTurnRate: 3.0,
  // Transition Durations
  breakoutDuration: 2.4,
  bridgeSmashDuration: 2.1,
  spireLeapDuration: 2.0,
  spireLeapHeight: 22.0,
  // Stage 1 Attacks
  beamCooldown: 7.5,
  beamTelegraph: 1.2,
  beamDuration: 2.0,
  beamRange: 88,
  beamSweepArc: 0.84,
  beamDps: 85,
  beamDestructionDps: 520,
  missileCooldown: 11.5,
  missileWindup: 0.6,
  missileCount: 6,
  missileSpeed: 32,
  missileDamage: 88,
  missileRadius: 5.5,
  jetStrafeCooldown: 9.0,
  jetStrafeDuration: 0.9,
  jetStrafeSpeed: 20,
  // Stage 2 Attacks
  chargeCooldown: 9.5,
  chargeWindup: 0.75,
  chargeDuration: 1.35,
  chargeSpeed: 34,
  chargeDamage: 165,
  slamCooldown: 12.0,
  slamWindup: 0.5,
  slamAirDuration: 1.1,
  slamPeakHeight: 14.0,
  slamRingRadius: 18.0,
  slamDamage: 140,
  droneCooldown: 15.5,
  droneWindup: 0.55,
  droneBurstCount: 4,
  cleaverCooldown: 5.0,
  cleaverWindup: 0.45,
  cleaverReach: 12.0,
  cleaverDamage: 125,
  // Stage 3A Attacks
  spireBeamCooldown: 8.5,
  spireBeamTelegraph: 1.1,
  spireBeamDuration: 2.4,
  spireBeamDps: 95,
  plasmaRingCooldown: 9.0,
  plasmaRingWindup: 0.55,
  plasmaRingMaxRadius: 28.0,
  plasmaRingSpeed: 16.0,
  plasmaRingDamage: 115,
} as const;

export const DEFAULT_ORION_ARENA: OrionArenaConfig = {
  dormantPos: [0, -6, 6],
  vaultBreachPos: [0, -2, 18],
  boulevardStart: [0, 0, 52],
  boulevardBounds: { minX: -24, maxX: 24, minZ: 24, maxZ: 82 },
  skybridgePos: [0, 6, 86],
  skybridgeTag: 'skybridge',
  intersectionStart: [0, 0, 108],
  intersectionBounds: { minX: -34, maxX: 34, minZ: 92, maxZ: 126 },
  cornerColumns: [
    { id: 'col_nw', tag: 'intersection_nw', pos: [-20, 0, 98], radius: 3.0 },
    { id: 'col_ne', tag: 'intersection_ne', pos: [20, 0, 98], radius: 3.0 },
    { id: 'col_sw', tag: 'intersection_sw', pos: [-20, 0, 120], radius: 3.0 },
    { id: 'col_se', tag: 'intersection_se', pos: [20, 0, 120], radius: 3.0 },
  ],
  spirePos: [0, 0, 144],
  spireBounds: { minX: -36, maxX: 36, minZ: 128, maxZ: 160 },
  conduitPositions: [
    [-24, 0, 136],
    [24, 0, 136],
    [0, 0, 156],
  ],
};

// ---- Internal Hit Zone Specs -------------------------------------------------------------------------------------

interface OrionHitZone {
  readonly id: OrionTargetId;
  readonly local: readonly [number, number, number];
  readonly half: readonly [number, number, number];
  readonly collider: RAPIER.Collider;
  readonly center: THREE.Vector3;
  readonly conduitIndex: number;
}

const ZONE_SPECS: readonly {
  id: OrionTargetId;
  local: readonly [number, number, number];
  half: readonly [number, number, number];
  conduitIndex: number;
}[] = [
  { id: 'relayL', local: [-3.35, 10.6, -0.25], half: [1.15, 1.55, 1.15], conduitIndex: -1 },
  { id: 'relayR', local: [3.35, 10.6, -0.25], half: [1.15, 1.55, 1.15], conduitIndex: -1 },
  { id: 'hull', local: [0, 6.2, 0.2], half: [2.9, 5.2, 2.4], conduitIndex: -1 },
  { id: 'reactor', local: [0, 8.2, -2.25], half: [1.35, 1.35, 1.15], conduitIndex: -1 },
  { id: 'conduit0', local: [0, 2.75, 0], half: [1.6, 2.8, 1.6], conduitIndex: 0 },
  { id: 'conduit1', local: [0, 2.75, 0], half: [1.6, 2.8, 1.6], conduitIndex: 1 },
  { id: 'conduit2', local: [0, 2.75, 0], half: [1.6, 2.8, 1.6], conduitIndex: 2 },
  { id: 'neuralCore', local: [0, 5.55, 2.05], half: [1.45, 1.45, 1.35], conduitIndex: -1 },
];

const SMALL_ARM_SOURCES = new Set([
  'smg',
  'pistol',
  'shotgun',
  'rifle',
  'knife',
  'autoraffica',
  'billhook',
  'deuce',
  'gimlet',
  'harrow',
]);

function isSmallArm(source: string): boolean {
  return SMALL_ARM_SOURCES.has(source);
}

function isFinisherMeleeOrSlam(source: string): boolean {
  return (
    source.includes('slam') ||
    source.includes('melee') ||
    source.includes('sword') ||
    source.includes('knife') ||
    source.includes('grapple')
  );
}

// Module-level zero-allocation scratch vectors & ray hit struct.
const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _beamStartA = new THREE.Vector3();
const _beamEndA = new THREE.Vector3();
const _beamStartB = new THREE.Vector3();
const _beamEndB = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _rayHit: RayHit = {
  point: new THREE.Vector3(),
  normal: new THREE.Vector3(),
  distance: 0,
  surface: 'concrete',
  collider: null,
};

/** Computes horizontal distance from point `p` to 3D segment `a..b` without allocations. */
function distPointToSegmentSq(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const lenSq = abx * abx + aby * aby + abz * abz;
  if (lenSq < 1e-6) return p.distanceToSquared(a);
  const t = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / lenSq, 0, 1);
  const cx = a.x + abx * t;
  const cy = a.y + aby * t;
  const cz = a.z + abz * t;
  const dx = p.x - cx;
  const dy = p.y - cy;
  const dz = p.z - cz;
  return dx * dx + dy * dy + dz * dz;
}

// ---- OrionBoss Controller ----------------------------------------------------------------------------------------

export class OrionBoss implements ExtraTarget {
  readonly model: OrionModel;
  readonly root: THREE.Group;
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly arena: OrionArenaConfig;
  readonly callbacks: OrionBossCallbacks;

  stage: OrionStage = 'dormant';
  health: number = ORION_CONFIG.maxHealth;
  readonly maxHealth: number = ORION_CONFIG.maxHealth;
  readonly relayHealth: [number, number] = [ORION_CONFIG.relayHealth, ORION_CONFIG.relayHealth];
  readonly conduitHealth: [number, number, number] = [
    ORION_CONFIG.conduitHealth,
    ORION_CONFIG.conduitHealth,
    ORION_CONFIG.conduitHealth,
  ];
  neuralCoreHealth: number = ORION_CONFIG.neuralCoreHealth;
  uploadProgress = 0;
  uploadPauseLeft = 0;
  staggerLeft = 0;
  leftArmSheared = false;
  legYaw = 0;
  torsoYaw = 0;
  attack: OrionAttackKind = 'none';

  private readonly materials: ModelMaterials;
  private readonly conduits: [GridConduitMesh, GridConduitMesh, GridConduitMesh];
  private readonly zones: OrionHitZone[] = [];
  private readonly byHandle = new Map<number, OrionHitZone>();
  private readonly byId = new Map<OrionTargetId, OrionHitZone>();
  private readonly paintTargets = new Map<OrionTargetId, MissileTarget>();
  private readonly collapsedColumns = new Set<string>();
  private readonly radarTarget: VehicleRadarTarget;

  // Locomotion & AI state
  private strafeDir = 1;
  private strafeFlipIn = 4.0;
  private stridePhase = 0;
  private lastStepIndex = 0;
  private attackClock = 0;
  private introStanceLeft = 0;

  // Cooldowns
  private beamCooldown = 2.8;
  private missileCooldown = 6.5;
  private jetStrafeCooldown = 5.5;
  private chargeCooldown = 3.2;
  private slamCooldown = 7.5;
  private droneCooldown = 10.5;
  private cleaverCooldown = 2.5;
  private spireBeamCooldown = 3.0;
  private plasmaRingCooldown = 5.5;

  // Transition & attack scratch states
  private transElapsed = 0;
  private transTriggeredMid = false;
  private readonly transStart = new THREE.Vector3();
  private readonly transEnd = new THREE.Vector3();
  private breakoutArrived = false;
  private uploadCompleted = false;

  // Thermal Beam & Spire Beams state
  private beamBaseYaw = 0;
  private beamDestructTimer = 0;
  private beamDamageTimer = 0;

  // Jet-Strafe & Jet-Charge state
  private readonly strafeVel = new THREE.Vector3();
  private readonly chargeDir = new THREE.Vector3(0, 0, 1);
  private chargeHitPlayer = false;
  private chargeRamTimer = 0;

  // Shockwave Slam & Plasma Ring state
  private readonly slamStart = new THREE.Vector3();
  private readonly slamEnd = new THREE.Vector3();
  private slamInAir = false;
  private plasmaRingActive = false;
  private plasmaRingRadius = 0;
  private plasmaRingHitPlayer = false;
  private readonly plasmaRingOrigin = new THREE.Vector3();

  // Audio / FX / HUD handles
  private beamLoop: LoopHandle | null = null;
  private jetLoop: LoopHandle | null = null;
  private sparkTimer = 0;
  private hudUnmark: (() => void) | null = null;

  constructor(
    private readonly ctx: Ctx,
    private readonly vehicles: VehicleSystem | null,
    arena: Partial<OrionArenaConfig> = {},
    callbacks: OrionBossCallbacks = {},
  ) {
    this.arena = { ...DEFAULT_ORION_ARENA, ...arena };
    this.callbacks = callbacks;
    this.materials = new ModelMaterials(ctx);
    this.model = new OrionModel(this.materials, ctx.render.scene);
    this.root = this.model.root;
    this.model.setVisible(false);

    this.conduits = [
      new GridConduitMesh(this.materials, ctx.render.scene),
      new GridConduitMesh(this.materials, ctx.render.scene),
      new GridConduitMesh(this.materials, ctx.render.scene),
    ];
    for (let i = 0; i < 3; i++) {
      const p = this.arena.conduitPositions[i]!;
      this.conduits[i]!.root.position.set(p[0], p[1], p[2]);
      this.conduits[i]!.setVisible(false);
    }

    // Register locational static box colliders for every target zone
    for (const spec of ZONE_SPECS) {
      const center = new THREE.Vector3();
      const collider = ctx.physics.addStaticBox(
        new THREE.Vector3(0, -1000, 0),
        new THREE.Vector3(...spec.half),
        null,
        'metal',
      );
      const zone: OrionHitZone = {
        id: spec.id,
        local: spec.local,
        half: spec.half,
        collider,
        center,
        conduitIndex: spec.conduitIndex,
      };
      this.zones.push(zone);
      this.byHandle.set(collider.handle, zone);
      this.byId.set(spec.id, zone);

      const self = this;
      this.paintTargets.set(spec.id, {
        center,
        get alive() {
          return self.isTargetPaintable(spec.id);
        },
        aimLift: 0,
        paintRadius: spec.id === 'hull' ? 3.8 : 2.2,
      });
    }

    this.radarTarget = {
      id: 77420,
      kind: 'tank',
      label: 'ORION-0',
      position: this.position,
      velocity: this.velocity,
      airborne: false,
    };

    this.vehicles?.addExtra(this);
  }

  // ---- Accessors & HUD Telemetry ---------------------------------------------------------------------------------

  /** True when ORION is actively fighting or transitioning (neither dormant nor dead). */
  get alive(): boolean {
    return this.stage !== 'dormant' && this.stage !== 'dead' && this.health > 0;
  }

  /** True whenever ORION is visible in the world (including dormant observation bay or dead wreck). */
  get active(): boolean {
    return this.model.root.visible;
  }

  /** True while Stage 1 (or Breakout) Hard-Light Shield is powered by ≥1 standing Shoulder Relay Fin. */
  get shieldActive(): boolean {
    return (
      (this.stage === 'stage1_alignment' || this.stage === 'breakout') &&
      (this.relayHealth[0] > 0 || this.relayHealth[1] > 0)
    );
  }

  /** True during Stage 3A while ≥1 Grid Umbilical Conduit keeps ORION's hull invulnerable. */
  get invulnerable(): boolean {
    if (this.stage === 'dormant' || this.stage === 'bridge_smash' || this.stage === 'spire_leap') return true;
    if (this.stage === 'stage3_meltdown' && this.aliveConduitsCount() > 0) return true;
    return false;
  }

  /** True during Stage 2 stagger windows when Rear Reactor Core slats open for 2.5× crit damage. */
  get reactorExposed(): boolean {
    return this.stage === 'stage2_unrestricted' && this.staggerLeft > 0;
  }

  /** True during Stage 3B when chest shutters crack open exposing the Neural Core. */
  get coreExposed(): boolean {
    return this.stage === 'crippled_core' && this.neuralCoreHealth > 0;
  }

  aliveConduitsCount(): number {
    let n = 0;
    for (let i = 0; i < 3; i++) if (this.conduitHealth[i]! > 0) n++;
    return n;
  }

  barFraction(): number {
    if (this.stage === 'dormant' || this.stage === 'dead') return 0;
    return clamp(this.health / this.maxHealth);
  }

  barLabel(): string {
    return ORION_CONFIG.label;
  }

  /** Exposes any locational Rapier collider for mission scripting or unit tests. */
  colliderFor(id: OrionTargetId): RAPIER.Collider | null {
    return this.byId.get(id)?.collider ?? null;
  }

  /** World position of ORION's shoulder grapple ring (for Stage 3B Gaff grapple highlights). */
  getGrappleAnchorWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.model.getGrappleAnchorWorld(this.position, this.torsoYaw, out);
  }

  /** Clean HUD telemetry snapshot for the Deprecation mission director. */
  getHudState(): OrionHudState {
    return {
      stage: this.stage,
      label: ORION_CONFIG.label,
      active: this.alive,
      health: this.health,
      maxHealth: this.maxHealth,
      hullPercent: clamp((this.health / this.maxHealth) * 100, 0, 100),
      shieldActive: this.shieldActive,
      shieldDR: this.shieldActive ? ORION_CONFIG.shieldFrontalDR : 0,
      invulnerable: this.invulnerable,
      relays: [
        { intact: this.relayHealth[0] > 0, health: this.relayHealth[0], maxHealth: ORION_CONFIG.relayHealth },
        { intact: this.relayHealth[1] > 0, health: this.relayHealth[1], maxHealth: ORION_CONFIG.relayHealth },
      ],
      conduits: [
        {
          index: 0,
          intact: this.conduitHealth[0] > 0,
          health: this.conduitHealth[0],
          maxHealth: ORION_CONFIG.conduitHealth,
          position: this.arena.conduitPositions[0],
        },
        {
          index: 1,
          intact: this.conduitHealth[1] > 0,
          health: this.conduitHealth[1],
          maxHealth: ORION_CONFIG.conduitHealth,
          position: this.arena.conduitPositions[1],
        },
        {
          index: 2,
          intact: this.conduitHealth[2] > 0,
          health: this.conduitHealth[2],
          maxHealth: ORION_CONFIG.conduitHealth,
          position: this.arena.conduitPositions[2],
        },
      ],
      uploadPercent: clamp(this.uploadProgress, 0, 100),
      uploadPaused: this.uploadPauseLeft > 0 || this.aliveConduitsCount() === 0,
      uploadPauseLeft: this.uploadPauseLeft,
      staggered: this.staggerLeft > 0,
      staggerLeft: this.staggerLeft,
      reactorExposed: this.reactorExposed,
      coreExposed: this.coreExposed,
      neuralCoreHealth: this.neuralCoreHealth,
      neuralCoreMaxHealth: ORION_CONFIG.neuralCoreHealth,
      currentAttack: this.attack,
      leftArmSheared: this.leftArmSheared,
    };
  }

  // ---- Lifecycle & Stage Entry Controls --------------------------------------------------------------------------

  /** Parks ORION dormant behind Sub-Level 4 observation glass. */
  parkDormant(): void {
    this.stopLoops();
    this.resetCommonState();
    this.stage = 'dormant';
    this.health = this.maxHealth;
    this.position.set(...this.arena.dormantPos);
    this.legYaw = 0;
    this.torsoYaw = 0;
    this.model.setVisible(true);
    this.model.setHaloMode('cyan');
    this.model.setShieldActive(false);
    this.model.setRelayIntact('left', true);
    this.model.setRelayIntact('right', true);
    this.model.setCleaversActive(false);
    this.model.setLeftArmSheared(false);
    this.model.resetPoseImmediate();
    this.hideConduits();
    this.parkAllColliders();
    this.syncModelTransform();
  }

  /** Powers ORION up in Sub-Level 4, blasts the concrete vault wall open, and leaps onto Grand Boulevard. */
  startBreakout(): void {
    const prev = this.stage;
    this.stopLoops();
    this.resetCommonState();
    this.stage = 'breakout';
    this.health = this.maxHealth;
    this.position.set(...this.arena.dormantPos);
    this.transStart.copy(this.position);
    this.transEnd.set(...this.arena.boulevardStart);
    this.transElapsed = 0;
    this.transTriggeredMid = false;
    this.breakoutArrived = false;
    this.legYaw = Math.atan2(this.transEnd.x - this.transStart.x, this.transEnd.z - this.transStart.z);
    this.torsoYaw = this.legYaw;

    this.model.setVisible(true);
    this.model.setHaloMode('cyan');
    this.model.setRelayIntact('left', true);
    this.model.setRelayIntact('right', true);
    this.model.setShieldActive(true);
    this.model.setCleaversActive(false);
    this.model.setLeftArmSheared(false);
    this.model.setThrusters(true, 1.3, this.ctx.time.elapsed);
    this.hideConduits();
    this.syncWorld();

    this.ctx.audio.play('electric_zap', { position: this.position, pitch: 0.72, volume: 0.95 });
    this.ctx.audio.play('flame_ignite', { position: this.position, pitch: 0.75, volume: 1.0 });
    this.jetLoop = this.ctx.audio.startLoop('flame_loop', {
      fadeIn: 0.08,
      pitch: 0.65,
      volume: 0.9,
      position: this.position,
    });
    this.ctx.camera.addTrauma(0.65);
    this.ctx.hud.feed('ALERT — AEGIS-0 SIEGE FRAME ONLINE · BREACHING SUB-LEVEL 4!', '#22ecff');
    this.emitStageChange(prev, 'breakout');
  }

  /** Transitions from `breakout` (or anywhere) into active Stage 1 Grand Boulevard combat. */
  engageStage1(): void {
    this.startStage('stage1_alignment');
  }

  /**
   * Jumps cleanly to any boss stage with full checkpoint parity (correct HP, relays, arm shear,
   * conduits, arena coordinates, pose, and colliders). Ideal for mission checkpoints and tests.
   */
  startStage(target: OrionStage): void {
    if (target === 'dormant') {
      this.parkDormant();
      return;
    }
    if (target === 'breakout') {
      this.startBreakout();
      return;
    }

    const prev = this.stage;
    this.stopLoops();
    this.resetCommonState();
    this.model.setVisible(true);
    this.model.hideAllBeams();
    this.model.setThrusters(false);
    this.model.resetPoseImmediate();

    if (target === 'stage1_alignment') {
      this.stage = 'stage1_alignment';
      this.health = this.maxHealth;
      this.relayHealth[0] = ORION_CONFIG.relayHealth;
      this.relayHealth[1] = ORION_CONFIG.relayHealth;
      this.leftArmSheared = false;
      this.position.set(...this.arena.boulevardStart);
      this.legYaw = Math.PI;
      this.torsoYaw = Math.PI;
      this.introStanceLeft = 1.8;
      this.model.setHaloMode('cyan');
      this.model.setRelayIntact('left', true);
      this.model.setRelayIntact('right', true);
      this.model.setShieldActive(true);
      this.model.setCleaversActive(false);
      this.model.setLeftArmSheared(false);
      this.hideConduits();
      this.attachHudFollow('#22ecff');
    } else if (target === 'bridge_smash') {
      this.stage = 'bridge_smash';
      this.health = Math.min(this.health, this.maxHealth * ORION_CONFIG.stage1To2HpFrac);
      this.relayHealth[0] = 0;
      this.relayHealth[1] = 0;
      this.leftArmSheared = false;
      this.position.set(...this.arena.boulevardStart);
      this.beginBridgeSmash(prev);
      return;
    } else if (target === 'stage2_unrestricted') {
      this.stage = 'stage2_unrestricted';
      this.health = this.maxHealth * ORION_CONFIG.stage1To2HpFrac;
      this.relayHealth[0] = 0;
      this.relayHealth[1] = 0;
      this.leftArmSheared = false;
      this.position.set(...this.arena.intersectionStart);
      this.legYaw = Math.PI;
      this.torsoYaw = Math.PI;
      this.introStanceLeft = 1.4;
      this.model.setHaloMode('amber');
      this.model.setRelayIntact('left', false);
      this.model.setRelayIntact('right', false);
      this.model.setShieldActive(false);
      this.model.setLeftArmSheared(false);
      this.model.setCleaversActive(true);
      this.hideConduits();
      this.attachHudFollow('#ffaa22');
    } else if (target === 'spire_leap') {
      this.stage = 'spire_leap';
      this.health = this.maxHealth * ORION_CONFIG.stage2To3HpFrac;
      this.position.set(...this.arena.intersectionStart);
      this.beginSpireLeap(prev);
      return;
    } else if (target === 'stage3_meltdown') {
      this.stage = 'stage3_meltdown';
      this.health = this.maxHealth * ORION_CONFIG.stage2To3HpFrac;
      this.relayHealth[0] = 0;
      this.relayHealth[1] = 0;
      this.leftArmSheared = true;
      this.position.set(...this.arena.spirePos);
      this.legYaw = Math.PI;
      this.torsoYaw = Math.PI;
      this.introStanceLeft = 1.8;
      this.model.setHaloMode('crimson');
      this.model.setRelayIntact('left', false);
      this.model.setRelayIntact('right', false);
      this.model.setShieldActive(false);
      this.model.setLeftArmSheared(true);
      this.model.setCleaversActive(true);
      this.deployConduits();
      this.attachHudFollow('#ff223a');
    } else if (target === 'crippled_core') {
      this.stage = 'crippled_core';
      this.health = this.maxHealth * ORION_CONFIG.stage3ToFinisherHpFrac;
      this.neuralCoreHealth = ORION_CONFIG.neuralCoreHealth;
      this.relayHealth[0] = 0;
      this.relayHealth[1] = 0;
      this.conduitHealth[0] = 0;
      this.conduitHealth[1] = 0;
      this.conduitHealth[2] = 0;
      this.leftArmSheared = true;
      this.position.set(...this.arena.spirePos);
      this.model.setHaloMode('crimson');
      this.model.setRelayIntact('left', false);
      this.model.setRelayIntact('right', false);
      this.model.setShieldActive(false);
      this.model.setLeftArmSheared(true);
      this.model.setCleaversActive(false);
      for (let i = 0; i < 3; i++) {
        this.conduits[i]!.setVisible(true);
        this.conduits[i]!.setDestroyed(true);
      }
      this.model.applyCrippledKneelPose(this.ctx.time.elapsed, 1);
      this.attachHudFollow('#6cf6ff');
    } else if (target === 'dead') {
      this.stage = 'dead';
      this.health = 0;
      this.neuralCoreHealth = 0;
      this.model.applyDeadPose();
      this.parkAllColliders();
    }

    this.facePlayerImmediate();
    this.syncWorld();
    this.emitStageChange(prev, this.stage);
  }

  /** Completely hides and resets ORION-0 and all conduits. */
  hide(): void {
    this.stopLoops();
    this.resetCommonState();
    this.stage = 'dormant';
    this.health = this.maxHealth;
    this.model.setVisible(false);
    this.hideConduits();
    this.hudUnmark?.();
    this.hudUnmark = null;
    this.parkAllColliders();
  }

  /** Forces an immediate Stage 2 Jet-Charge toward `targetPos` (or the player) — useful for scripted beats & tests. */
  triggerJetCharge(targetPos?: THREE.Vector3): void {
    if (this.stage !== 'stage2_unrestricted' || this.staggerLeft > 0) return;
    const tgt = targetPos ?? this.ctx.player.position;
    this.attack = 'jet_charge';
    this.attackClock = 0;
    this.chargeHitPlayer = false;
    this.chargeRamTimer = 0;
    this.chargeDir.set(tgt.x - this.position.x, 0, tgt.z - this.position.z);
    if (this.chargeDir.lengthSq() < 1e-4) {
      this.chargeDir.set(Math.sin(this.torsoYaw), 0, Math.cos(this.torsoYaw));
    } else {
      this.chargeDir.normalize();
    }
    const yaw = Math.atan2(this.chargeDir.x, this.chargeDir.z);
    this.torsoYaw = yaw;
    this.legYaw = yaw;
    this.syncWorld();
    this.ctx.audio.play('titan_charge', { position: this.position, pitch: 0.92, volume: 0.95 });
    this.ctx.hud.feed('ORION-0 — JET-CHARGE INBOUND · BAIT INTO A CORNER COLUMN!', '#ffaa22');
  }

  // ---- Per-Frame Update (Zero Hot-Path Allocations) --------------------------------------------------------------

  update(dt: number): void {
    if (dt <= 0) return;
    const time = this.ctx.time.elapsed;

    if (this.stage === 'dormant') {
      if (this.model.root.visible) {
        this.model.updateVisualFx(dt, time, false, false);
      }
      return;
    }

    if (this.stage === 'dead') {
      this.emitAmbientSparks(dt, 0.38, false);
      return;
    }

    if (this.stage === 'breakout') {
      this.updateBreakout(dt, time);
      this.model.updateVisualFx(dt, time, false, false);
      this.syncWorld();
      return;
    }

    if (this.stage === 'bridge_smash') {
      this.updateBridgeSmash(dt, time);
      this.model.updateVisualFx(dt, time, false, false);
      this.syncWorld();
      return;
    }

    if (this.stage === 'spire_leap') {
      this.updateSpireLeap(dt, time);
      this.model.updateVisualFx(dt, time, false, false);
      this.syncWorld();
      return;
    }

    if (this.stage === 'crippled_core') {
      this.updateCrippledCore(dt, time);
      this.model.updateVisualFx(dt, time, false, true);
      this.syncWorld();
      return;
    }

    // Active combat stages: stage1_alignment | stage2_unrestricted | stage3_meltdown
    this.tickCooldowns(dt);

    if (this.stage === 'stage3_meltdown') {
      this.updateUploadTimer(dt);
      this.updateConduitTethers(time);
    }

    // Stage 2 Stagger window (buried in concrete, Rear Reactor Core exposed for 2.5x crit!)
    if (this.staggerLeft > 0) {
      this.staggerLeft = Math.max(0, this.staggerLeft - dt);
      this.velocity.set(0, 0, 0);
      this.model.hideAllBeams();
      this.model.setThrusters(false);
      this.model.applyStaggerPose(time, dt);
      this.emitAmbientSparks(dt, 0.14, true);
      this.model.updateVisualFx(dt, time, this.reactorExposed, false);
      this.syncWorld();
      return;
    }

    // Aim torso smoothly toward player unless locked into a directional sweep or jet-charge
    const player = this.ctx.player;
    const toPlayerX = player.position.x - this.position.x;
    const toPlayerZ = player.position.z - this.position.z;
    const dist = Math.hypot(toPlayerX, toPlayerZ);
    if (this.attack !== 'thermal_beam' && this.attack !== 'jet_charge' && this.attack !== 'spire_beams') {
      const wantYaw = Math.atan2(toPlayerX, toPlayerZ);
      this.torsoYaw = dampAngle(this.torsoYaw, wantYaw, ORION_CONFIG.torsoTurnRate, dt);
    }

    // Update active expanding plasma shockwave ring if running in Stage 3A
    if (this.plasmaRingActive) {
      this.updatePlasmaRingWave(dt);
    }

    // Dispatch active attack or stage locomotion + attack selection
    if (this.attack === 'jet_charge') {
      this.updateJetCharge(dt, time);
    } else if (this.attack === 'shockwave_slam') {
      this.updateShockwaveSlam(dt, time);
    } else if (this.attack === 'jet_strafe') {
      this.updateJetStrafe(dt, time);
    } else {
      this.updateLocomotion(dt, toPlayerX, toPlayerZ, dist);
      if (this.attack === 'thermal_beam') {
        this.updateThermalBeam(dt, time);
      } else if (this.attack === 'missile_salvo') {
        this.updateMissileSalvo(dt);
      } else if (this.attack === 'drone_burst') {
        this.updateDroneBurst(dt);
      } else if (this.attack === 'cleaver_sweep') {
        this.updateCleaverSweep(dt);
      } else if (this.attack === 'spire_beams') {
        this.updateSpireBeams(dt, time);
      } else if (this.attack === 'plasma_ring') {
        this.updatePlasmaRingAttack(dt);
      } else if (player.alive) {
        this.chooseAttack(dist);
      }
    }

    if (this.leftArmSheared) {
      this.emitAmbientSparks(dt, 0.24, false);
    }

    this.model.updateVisualFx(dt, time, this.reactorExposed, false);
    this.syncWorld();
  }

  // ---- Stage Transitions & Breakout ------------------------------------------------------------------------------

  private updateBreakout(dt: number, time: number): void {
    if (this.breakoutArrived) {
      // Patrol Grand Boulevard sweeping occasional warning beams until player boards the Distraint Frame.
      const player = this.ctx.player;
      const toX = player.position.x - this.position.x;
      const toZ = player.position.z - this.position.z;
      this.torsoYaw = dampAngle(this.torsoYaw, Math.atan2(toX, toZ), 2.8, dt);
      this.model.applyIdlePose(dt);
      this.beamCooldown = Math.max(0, this.beamCooldown - dt);
      if (this.attack === 'thermal_beam') {
        this.updateThermalBeam(dt, time);
      } else if (this.beamCooldown <= 0 && player.alive) {
        this.startThermalBeam();
      }
      return;
    }

    this.transElapsed += dt;
    const t = clamp(this.transElapsed / ORION_CONFIG.breakoutDuration);
    const x = THREE.MathUtils.lerp(this.transStart.x, this.transEnd.x, t);
    const z = THREE.MathUtils.lerp(this.transStart.z, this.transEnd.z, t);
    const baseY = THREE.MathUtils.lerp(this.transStart.y, this.transEnd.y, t);
    const arcY = 4 * 12.0 * t * (1 - t);
    this.position.set(x, baseY + arcY, z);
    this.model.setThrusters(true, 1.35, time);
    this.model.applyAirbornePose(t, dt);
    this.jetLoop?.setPosition(this.position);

    if (!this.transTriggeredMid && t >= 0.3) {
      this.transTriggeredMid = true;
      _v0.set(...this.arena.vaultBreachPos);
      this.destruction()?.blast(_v0, 12, 2000, 'frame_charge');
      this.ctx.fx.explosion(_v0, { radius: 9, kind: 'shell', scale: 2.0 });
      this.ctx.fx.smoke(_v0, 0xd4dae2, 4.2, 2.8);
      this.ctx.audio.play('explosion_tank', { position: _v0, volume: 1.0 });
      this.ctx.camera.addTrauma(0.85);
    }

    if (t >= 1) {
      this.breakoutArrived = true;
      this.position.copy(this.transEnd);
      this.stopJetLoop();
      this.model.setThrusters(false);
      this.model.resetPoseImmediate();
      this.beamCooldown = 2.0;
      this.ctx.fx.slam(this.position, 4.5);
      this.ctx.fx.ring(this.position, _up, '#22ecff', 16);
      this.ctx.audio.play('titan_stomp', { position: this.position, pitch: 0.72, volume: 1.0 });
      this.ctx.camera.addTrauma(0.8);
      this.ctx.campaign.signal('orion:breakout');
      this.callbacks.onBreakoutComplete?.();
    }
  }

  private beginBridgeSmash(prev: OrionStage): void {
    this.stopLoops();
    this.attack = 'none';
    this.model.hideAllBeams();
    this.staggerLeft = 0;
    this.stage = 'bridge_smash';

    // Shatter any remaining relay fins & permanently drop the Stage 1 Hard-Light Shield
    for (let i = 0; i < 2; i++) {
      if (this.relayHealth[i]! > 0) {
        this.relayHealth[i] = 0;
        this.model.setRelayIntact(i === 0 ? 'left' : 'right', false);
      }
    }
    this.model.setShieldActive(false);

    this.transStart.copy(this.position);
    this.transEnd.set(...this.arena.intersectionStart);
    this.transElapsed = 0;
    this.transTriggeredMid = false;
    const yaw = Math.atan2(this.transEnd.x - this.transStart.x, this.transEnd.z - this.transStart.z);
    this.legYaw = yaw;
    this.torsoYaw = yaw;

    this.model.setThrusters(true, 1.5, this.ctx.time.elapsed);
    this.jetLoop = this.ctx.audio.startLoop('flame_loop', {
      fadeIn: 0.05,
      pitch: 0.62,
      volume: 0.95,
      position: this.position,
    });
    this.ctx.audio.play('titan_charge', { position: this.position, pitch: 0.85, volume: 1.0 });
    this.ctx.hud.feed('ORION-0 — BREACHING PEDESTRIAN SKYBRIDGE!', '#ffaa22');
    this.emitStageChange(prev, 'bridge_smash');
  }

  private updateBridgeSmash(dt: number, time: number): void {
    this.transElapsed += dt;
    const t = clamp(this.transElapsed / ORION_CONFIG.bridgeSmashDuration);

    this.position.lerpVectors(this.transStart, this.transEnd, t);
    this.position.y = 4 * 6.5 * t * (1 - t);
    this.model.setThrusters(true, 1.55, time);
    this.model.applyChargePose(dt);
    this.jetLoop?.setPosition(this.position);

    if (!this.transTriggeredMid && t >= 0.45) {
      this.transTriggeredMid = true;
      _v0.set(...this.arena.skybridgePos);
      const dest = this.destruction();
      dest?.blast(_v0, 15.0, 2600, 'frame_charge');
      this.ctx.fx.explosion(_v0, { radius: 12, kind: 'shell', scale: 2.3 });
      this.ctx.fx.smoke(_v0, 0xd8dce4, 5.2, 3.2);
      this.ctx.fx.chips(_v0, 0x9aa4b0, 48);
      this.ctx.fx.embers(_v0, 36, 4.5);
      this.ctx.render.lights.flash(_v0, 0xffaa38, 36, 68, 0.5);
      this.ctx.audio.play('explosion_tank', { position: _v0, volume: 1.0 });
      this.ctx.audio.play('explosion_debris', { position: _v0, volume: 1.0 });
      this.ctx.camera.addTrauma(0.9);
      this.ctx.campaign.signal('orion:skybridge_smashed');
      this.callbacks.onSkybridgeSmash?.(_v0.clone());
    }

    if (t >= 1) {
      this.position.copy(this.transEnd);
      this.position.y = 0;
      this.stopJetLoop();
      this.model.setThrusters(false);
      this.model.resetPoseImmediate();
      this.model.setHaloMode('amber');
      this.model.setCleaversActive(true);
      this.stage = 'stage2_unrestricted';
      this.chargeCooldown = 2.6;
      this.slamCooldown = 6.5;
      this.droneCooldown = 9.0;
      this.cleaverCooldown = 2.0;
      this.attachHudFollow('#ffaa22');

      this.ctx.fx.slam(this.position, 4.4);
      this.ctx.fx.ring(this.position, _up, '#ffaa22', 16);
      this.ctx.audio.play('titan_stomp', { position: this.position, pitch: 0.76, volume: 1.0 });
      this.ctx.audio.play('sword_swing', { position: this.position, pitch: 0.72, volume: 0.95 });
      this.ctx.hud.feed('ORION-0 — STAGE 2: UNRESTRICTED MODE · PLASMA CLEAVERS IGNITED!', '#ffaa22');
      this.emitStageChange('bridge_smash', 'stage2_unrestricted');
    }
  }

  private beginSpireLeap(prev: OrionStage): void {
    this.stopLoops();
    this.attack = 'none';
    this.model.hideAllBeams();
    this.staggerLeft = 0;
    this.stage = 'spire_leap';

    // Shear left arm off visibly in sparks & fire on Stage 2 -> Stage 3 transition!
    this.leftArmSheared = true;
    this.model.setLeftArmSheared(true);
    this.model.setCleaversActive(true);

    _v0.set(-3.2, 8.2, 0.25).applyAxisAngle(_up, this.torsoYaw).add(this.position);
    this.ctx.fx.explosion(_v0, { radius: 6.5, kind: 'rocket', scale: 1.5 });
    this.ctx.fx.chips(_v0, 0xffaa44, 42);
    this.ctx.fx.embers(_v0, 32, 3.8);
    this.ctx.audio.play('titan_limb_break', { position: _v0, volume: 1.0 });
    this.ctx.audio.play('plate_destroyed', { position: _v0, pitch: 0.8, volume: 0.95 });

    this.transStart.copy(this.position);
    this.transEnd.set(...this.arena.spirePos);
    this.transElapsed = 0;
    this.transTriggeredMid = false;
    const yaw = Math.atan2(this.transEnd.x - this.transStart.x, this.transEnd.z - this.transStart.z);
    this.legYaw = yaw;
    this.torsoYaw = yaw;

    this.model.setThrusters(true, 1.65, this.ctx.time.elapsed);
    this.jetLoop = this.ctx.audio.startLoop('flame_loop', {
      fadeIn: 0.05,
      pitch: 0.58,
      volume: 1.0,
      position: this.position,
    });
    this.ctx.camera.addTrauma(0.75);
    this.ctx.hud.feed('ORION-0 LEFT ARM SHEARED — LEAPING TO CIVIC SPIRE PLAZA!', '#ff3a52');
    this.emitStageChange(prev, 'spire_leap');
  }

  private updateSpireLeap(dt: number, time: number): void {
    this.transElapsed += dt;
    const t = clamp(this.transElapsed / ORION_CONFIG.spireLeapDuration);

    this.position.lerpVectors(this.transStart, this.transEnd, t);
    this.position.y = 4 * ORION_CONFIG.spireLeapHeight * t * (1 - t);
    this.model.setThrusters(true, 1.6, time);
    this.model.applyAirbornePose(t, dt);
    this.jetLoop?.setPosition(this.position);

    if (t >= 1) {
      this.position.copy(this.transEnd);
      this.position.y = 0;
      this.stopJetLoop();
      this.model.setThrusters(false);
      this.model.resetPoseImmediate();
      this.model.setHaloMode('crimson');
      this.stage = 'stage3_meltdown';
      this.deployConduits();
      this.spireBeamCooldown = 2.6;
      this.plasmaRingCooldown = 5.2;
      this.cleaverCooldown = 2.5;
      this.attachHudFollow('#ff223a');

      this.ctx.fx.slam(this.position, 5.0);
      this.ctx.fx.ring(this.position, _up, '#ff223a', 20);
      this.ctx.render.lights.flash(this.position, 0x22ecff, 40, 78, 0.55);
      this.ctx.audio.play('titan_stomp', { position: this.position, pitch: 0.68, volume: 1.0 });
      this.ctx.audio.play('electric_zap', { position: this.position, pitch: 0.78, volume: 1.0 });
      this.ctx.camera.addTrauma(0.95);
      this.ctx.hud.feed('ORION-0 — STAGE 3: SINGULARITY MELTDOWN · DESTROY ALL 3 GRID CONDUITS!', '#ff223a');
      this.emitStageChange('spire_leap', 'stage3_meltdown');
    }
  }

  private triggerEmpEject(): void {
    const prev = this.stage;
    this.stopLoops();
    this.attack = 'none';
    this.plasmaRingActive = false;
    this.model.hideAllBeams();
    this.model.setThrusters(false);
    this.model.setCleaversActive(false);

    this.stage = 'crippled_core';
    this.health = this.maxHealth * ORION_CONFIG.stage3ToFinisherHpFrac;
    this.neuralCoreHealth = ORION_CONFIG.neuralCoreHealth;
    this.position.y = 0;
    this.velocity.set(0, 0, 0);
    this.staggerLeft = 0;
    this.model.setHaloMode('crimson');
    this.model.applyCrippledKneelPose(this.ctx.time.elapsed, 1);
    this.attachHudFollow('#6cf6ff');

    // Massive EMP Nova shockwave
    this.ctx.fx.ring(this.position, _up, '#22ecff', ORION_CONFIG.empNovaRadius);
    this.ctx.fx.ring(this.position, _up, '#ffffff', ORION_CONFIG.empNovaRadius * 0.6);
    this.ctx.fx.explosion(this.position, { radius: 14, kind: 'rocket', scale: 2.2 });
    this.ctx.render.lights.flash(this.position, 0x6cf6ff, 56, 110, 0.8);
    this.ctx.audio.play('orbital_strike', { position: this.position, pitch: 1.15, volume: 1.0 });
    this.ctx.audio.play('electric_zap', { position: this.position, pitch: 0.65, volume: 1.0 });
    this.ctx.camera.addTrauma(1.0);
    this.ctx.hud.feed('EMP NOVA! FRAME LEGS FRIED — EJECT & DESTROY THE EXPOSED NEURAL CORE!', '#6cf6ff');

    this.syncWorld();
    this.ctx.campaign.signal('orion:emp_eject');
    this.emitStageChange(prev, 'crippled_core');
    this.callbacks.onEmpEject?.();
  }

  private triggerDeath(): void {
    const prev = this.stage;
    this.stopLoops();
    this.attack = 'none';
    this.plasmaRingActive = false;
    this.stage = 'dead';
    this.health = 0;
    this.neuralCoreHealth = 0;
    this.velocity.set(0, 0, 0);
    this.hudUnmark?.();
    this.hudUnmark = null;
    this.model.applyDeadPose();
    this.parkAllColliders();

    _v0.copy(this.position).setY(this.position.y + 5.5);
    this.ctx.fx.explosion(_v0, { radius: 20, kind: 'shell', scale: 3.2 });
    this.ctx.fx.ring(_v0, _up, '#aefaff', 34);
    this.ctx.fx.ring(_v0, _up, '#22ecff', 52);
    this.ctx.fx.chips(_v0, 0x8cf8ff, 64);
    this.ctx.fx.embers(_v0, 56, 6.5);
    this.ctx.render.lights.flash(_v0, 0xaefaff, 68, 140, 1.1);
    this.ctx.audio.play('nuke_blast', { position: _v0, pitch: 1.12, volume: 1.0 });
    this.ctx.audio.play('veh_destroyed', { position: _v0, volume: 1.0 });
    this.ctx.camera.addTrauma(1.0);
    this.ctx.progression.award(5000, 'ORION-0 DEPRECATED', _v0);
    this.ctx.hud.feed('ORION-0 NEURAL CORE DETONATED — FORM 7742-A FULFILLED!', '#7ee787');

    this.ctx.campaign.signal('orion:defeated');
    this.emitStageChange(prev, 'dead');
    this.callbacks.onDefeated?.(this.position.clone());
  }

  private updateCrippledCore(dt: number, time: number): void {
    this.velocity.set(0, 0, 0);
    this.model.applyCrippledKneelPose(time, dt);
    this.emitAmbientSparks(dt, 0.16, false);
  }

  // ---- Stage 3A Grid Conduits & Upload Timer ---------------------------------------------------------------------

  private deployConduits(): void {
    this.uploadProgress = 0;
    this.uploadPauseLeft = 0;
    this.uploadCompleted = false;
    for (let i = 0; i < 3; i++) {
      this.conduitHealth[i] = ORION_CONFIG.conduitHealth;
      const p = this.arena.conduitPositions[i]!;
      this.conduits[i]!.root.position.set(p[0], p[1], p[2]);
      this.conduits[i]!.setVisible(true);
      this.conduits[i]!.setDestroyed(false);
    }
  }

  private hideConduits(): void {
    for (let i = 0; i < 3; i++) {
      this.conduits[i]!.setVisible(false);
    }
  }

  private updateUploadTimer(dt: number): void {
    if (this.aliveConduitsCount() <= 0 || this.uploadCompleted) return;
    if (this.uploadPauseLeft > 0) {
      this.uploadPauseLeft = Math.max(0, this.uploadPauseLeft - dt);
      return;
    }
    const rate = 100 / ORION_CONFIG.uploadDurationSeconds;
    this.uploadProgress = Math.min(100, this.uploadProgress + rate * dt);
    if (this.uploadProgress >= 100 && !this.uploadCompleted) {
      this.uploadCompleted = true;
      this.ctx.hud.feed('CRITICAL — ORION-0 PLANETARY GRID UPLOAD REACHED 100%!', '#ff223a');
      this.ctx.campaign.signal('orion:upload_complete');
      this.callbacks.onUploadComplete?.();
    }
  }

  private updateConduitTethers(time: number): void {
    const socket = this.model.getDorsalSocketWorld(this.position, this.torsoYaw, _v3);
    for (let i = 0; i < 3; i++) {
      this.conduits[i]!.updateTether(socket, time, this.conduitHealth[i]! > 0);
    }
  }

  // ---- Locomotion & Attack Selection -----------------------------------------------------------------------------

  private activeBounds(): OrionBounds {
    if (this.stage === 'stage2_unrestricted') return this.arena.intersectionBounds;
    if (this.stage === 'stage3_meltdown') return this.arena.spireBounds;
    return this.arena.boulevardBounds;
  }

  private updateLocomotion(dt: number, toPlayerX: number, toPlayerZ: number, dist: number): void {
    if (this.introStanceLeft > 0) {
      this.introStanceLeft = Math.max(0, this.introStanceLeft - dt);
      this.velocity.set(0, 0, 0);
      this.legYaw = dampAngle(this.legYaw, this.torsoYaw, 3.2, dt);
      this.model.applyIdlePose(dt);
      return;
    }

    this.strafeFlipIn -= dt;
    if (this.strafeFlipIn <= 0) {
      this.strafeFlipIn = rand(3.0, 5.5);
      this.strafeDir = -this.strafeDir;
    }

    const invD = dist > 0.001 ? 1 / dist : 0;
    const fwdX = toPlayerX * invD;
    const fwdZ = toPlayerZ * invD;
    const rightX = -fwdZ * this.strafeDir;
    const rightZ = fwdX * this.strafeDir;

    const minRange = this.stage === 'stage2_unrestricted' ? 14 : 24;
    const maxRange = this.stage === 'stage2_unrestricted' ? 36 : 52;

    let moveX = rightX * ORION_CONFIG.strafeSpeed;
    let moveZ = rightZ * ORION_CONFIG.strafeSpeed;
    if (dist > maxRange) {
      moveX += fwdX * ORION_CONFIG.walkSpeed;
      moveZ += fwdZ * ORION_CONFIG.walkSpeed;
    } else if (dist < minRange) {
      moveX -= fwdX * (ORION_CONFIG.walkSpeed * 0.75);
      moveZ -= fwdZ * (ORION_CONFIG.walkSpeed * 0.75);
    }

    // Plant legs heavily while sweeping beams or launching salvos
    const speedScale =
      this.attack === 'thermal_beam' || this.attack === 'spire_beams'
        ? 0.2
        : this.attack === 'missile_salvo' || this.attack === 'drone_burst'
          ? 0.45
          : 1.0;
    moveX *= speedScale;
    moveZ *= speedScale;

    const b = this.activeBounds();
    const prevX = this.position.x;
    const prevZ = this.position.z;
    this.position.x = clamp(this.position.x + moveX * dt, b.minX, b.maxX);
    this.position.z = clamp(this.position.z + moveZ * dt, b.minZ, b.maxZ);

    // Keep ORION-0 clear of the solid Municipal Power Spire pillar in Civic Spire Plaza
    if (this.stage === 'stage3_meltdown') {
      const spX = 0;
      const spZ = 144;
      const dx = this.position.x - spX;
      const dz = this.position.z - spZ;
      const d = Math.hypot(dx, dz);
      const keepout = 6.8;
      if (d < keepout) {
        const nx = d > 0.01 ? dx / d : 1;
        const nz = d > 0.01 ? dz / d : 0;
        this.position.x = clamp(spX + nx * keepout, b.minX, b.maxX);
        this.position.z = clamp(spZ + nz * keepout, b.minZ, b.maxZ);
      }
    }

    this.velocity.set((this.position.x - prevX) / dt, 0, (this.position.z - prevZ) / dt);

    const moved = Math.hypot(this.position.x - prevX, this.position.z - prevZ);
    const actualSpeed = moved / dt;

    if (actualSpeed > 0.7) {
      const moveYaw = Math.atan2(this.position.x - prevX, this.position.z - prevZ);
      this.legYaw = dampAngle(this.legYaw, moveYaw, ORION_CONFIG.legTurnRate, dt);
      this.stridePhase += moved * 0.26;
      this.model.applyWalkPose(this.stridePhase, clamp(actualSpeed / ORION_CONFIG.walkSpeed), dt);

      const stepIdx = Math.floor(this.stridePhase / Math.PI);
      if (stepIdx !== this.lastStepIndex) {
        this.lastStepIndex = stepIdx;
        this.ctx.fx.dust(this.position, _up, 1.8);
        this.ctx.audio.play('titan_stomp', { position: this.position, pitch: 0.78 + rand(-0.06, 0.06), volume: 0.55 });
      }
    } else {
      this.legYaw = dampAngle(this.legYaw, this.torsoYaw, 2.4, dt);
      this.model.applyIdlePose(dt);
    }
  }

  private tickCooldowns(dt: number): void {
    this.beamCooldown = Math.max(0, this.beamCooldown - dt);
    this.missileCooldown = Math.max(0, this.missileCooldown - dt);
    this.jetStrafeCooldown = Math.max(0, this.jetStrafeCooldown - dt);
    this.chargeCooldown = Math.max(0, this.chargeCooldown - dt);
    this.slamCooldown = Math.max(0, this.slamCooldown - dt);
    this.droneCooldown = Math.max(0, this.droneCooldown - dt);
    this.cleaverCooldown = Math.max(0, this.cleaverCooldown - dt);
    this.spireBeamCooldown = Math.max(0, this.spireBeamCooldown - dt);
    this.plasmaRingCooldown = Math.max(0, this.plasmaRingCooldown - dt);
  }

  private chooseAttack(dist: number): void {
    if (this.stage === 'stage1_alignment') {
      if (this.beamCooldown <= 0 && dist < 110) {
        this.startThermalBeam();
        return;
      }
      if (this.missileCooldown <= 0 && dist < 130) {
        this.attack = 'missile_salvo';
        this.attackClock = 0;
        this.ctx.audio.play('missile_incoming', { volume: 0.75 });
        this.ctx.hud.feed('ORION-0 — 6-MISSILE PAINTED SALVO · POP SMOKE OR DASH!', '#22ecff');
        return;
      }
      if (this.jetStrafeCooldown <= 0) {
        this.startJetStrafe();
      }
      return;
    }

    if (this.stage === 'stage2_unrestricted') {
      if (this.cleaverCooldown <= 0 && dist <= ORION_CONFIG.cleaverReach) {
        this.startCleaverSweep();
        return;
      }
      if (this.chargeCooldown <= 0 && dist >= 14 && dist < 85) {
        this.triggerJetCharge();
        return;
      }
      if (this.slamCooldown <= 0 && dist < 68) {
        this.startShockwaveSlam();
        return;
      }
      if (this.droneCooldown <= 0) {
        this.attack = 'drone_burst';
        this.attackClock = 0;
        this.ctx.audio.play('steam_burst', { position: this.position, pitch: 1.12, volume: 0.8 });
        this.ctx.hud.feed('ORION-0 — DEPLOYING HUNTER-KILLER DRONES!', '#ffaa22');
      }
      return;
    }

    if (this.stage === 'stage3_meltdown') {
      if (this.cleaverCooldown <= 0 && dist <= ORION_CONFIG.cleaverReach) {
        this.startCleaverSweep();
        return;
      }
      if (this.spireBeamCooldown <= 0) {
        this.attack = 'spire_beams';
        this.attackClock = 0;
        this.beamBaseYaw = this.torsoYaw;
        this.beamDestructTimer = 0;
        this.beamDamageTimer = 0;
        this.ctx.audio.play('orbital_charge', { position: this.position, pitch: 1.05, volume: 0.95 });
        this.ctx.hud.feed('ORION-0 — DUAL SPIRE BEAMS LOCKING!', '#ff223a');
        return;
      }
      if (this.plasmaRingCooldown <= 0 && !this.plasmaRingActive) {
        this.attack = 'plasma_ring';
        this.attackClock = 0;
        this.ctx.audio.play('railgun_charge', { position: this.position, pitch: 0.85, volume: 0.9 });
        this.ctx.hud.feed('ORION-0 — PLASMA SHOCKWAVE RING · JUMP OVER!', '#ff223a');
      }
    }
  }

  // ---- Stage 1 Attacks: Thermal Beam, 6-Missile Salvo, Tactical Jet-Strafe ---------------------------------------

  private startThermalBeam(): void {
    this.attack = 'thermal_beam';
    this.attackClock = 0;
    this.beamBaseYaw = Math.atan2(
      this.ctx.player.position.x - this.position.x,
      this.ctx.player.position.z - this.position.z,
    );
    this.beamDestructTimer = 0;
    this.beamDamageTimer = 0;
    this.ctx.audio.play('railgun_charge', { position: this.position, pitch: 0.78, volume: 0.95 });
    this.ctx.hud.feed('ORION-0 — SWEEPING THERMAL BEAM!', '#22ecff');
  }

  private updateThermalBeam(dt: number, time: number): void {
    this.attackClock += dt;
    const muzzle = this.model.getBeamMuzzleWorld(this.position, this.torsoYaw, _beamStartA);

    if (this.attackClock < ORION_CONFIG.beamTelegraph) {
      // 1.2 s cyan telegraph line leading the initial sweep edge
      const startYaw = this.beamBaseYaw - ORION_CONFIG.beamSweepArc * 0.5;
      this.torsoYaw = dampAngle(this.torsoYaw, startYaw, 5.5, dt);
      _dir.set(Math.sin(startYaw), -0.09, Math.cos(startYaw)).normalize();
      _beamEndA.copy(muzzle).addScaledVector(_dir, ORION_CONFIG.beamRange);
      this.model.updateBeamVisual('telegraph', muzzle, _beamEndA, time, false);
      return;
    }

    if (!this.beamLoop) {
      this.beamLoop = this.ctx.audio.startLoop('titan_beam_loop', {
        fadeIn: 0.05,
        pitch: 1.05,
        volume: 0.95,
        position: muzzle,
      });
    }

    const sweepElapsed = this.attackClock - ORION_CONFIG.beamTelegraph;
    if (sweepElapsed >= ORION_CONFIG.beamDuration) {
      this.stopBeamLoop();
      this.model.updateBeamVisual('off', muzzle, _beamEndA, time);
      this.attack = 'none';
      this.beamCooldown = ORION_CONFIG.beamCooldown + rand(-0.6, 0.8);
      return;
    }

    const frac = clamp(sweepElapsed / ORION_CONFIG.beamDuration);
    const sweepYaw = this.beamBaseYaw + (frac - 0.5) * ORION_CONFIG.beamSweepArc;
    this.torsoYaw = sweepYaw;
    this.beamLoop.setPosition(muzzle);

    _dir.set(Math.sin(sweepYaw), -0.1, Math.cos(sweepYaw)).normalize();
    let hitDist: number = ORION_CONFIG.beamRange;
    const hitWorld = this.ctx.physics.raycastInto?.(muzzle, _dir, ORION_CONFIG.beamRange, CG.World, _rayHit) ?? false;
    if (hitWorld) {
      hitDist = _rayHit.distance;
      _beamEndA.copy(_rayHit.point);
      this.destruction()?.damageCollider(_rayHit.collider, ORION_CONFIG.beamDestructionDps * dt, 'aegis_cannon', _rayHit.point);
    } else {
      _beamEndA.copy(muzzle).addScaledVector(_dir, hitDist);
    }

    this.model.updateBeamVisual('fire', muzzle, _beamEndA, time, false);

    // Slice buildings/storefronts along the beam impact point via DestructionManager!
    this.beamDestructTimer -= dt;
    if (this.beamDestructTimer <= 0) {
      this.beamDestructTimer = 0.16;
      this.destruction()?.blast(_beamEndA, 4.8, 360, 'aegis_cannon');
      this.ctx.fx.sparks(_beamEndA, _up, 10, '#22ecff');
      this.ctx.fx.smoke(_beamEndA, 0xd8e8f2, 2.2, 1.4);
    }

    // Check player hit against thermal beam segment
    this.beamDamageTimer -= dt;
    if (this.beamDamageTimer <= 0 && this.ctx.player.alive) {
      if (distPointToSegmentSq(this.ctx.player.eye, muzzle, _beamEndA) <= 2.6 * 2.6) {
        this.beamDamageTimer = 0.2;
        this.ctx.player.takeDamage({
          amount: ORION_CONFIG.beamDps * 0.2,
          from: muzzle,
          type: 'fire',
          source: 'orion_beam',
        });
        this.ctx.camera.addTrauma(0.28);
      }
    }
  }

  private updateMissileSalvo(dt: number): void {
    this.attackClock += dt;
    if (this.attackClock < ORION_CONFIG.missileWindup) return;

    const { audio, combat, fx, player } = this.ctx;
    _v0.set(0, 10.6, -0.4).applyAxisAngle(_up, this.torsoYaw).add(this.position);
    audio.play('enemy_rocket_fire', { position: _v0, pitch: 0.92, volume: 1.0 });
    fx.muzzleFlash(_v0, _up, 'rocket');
    fx.smoke(_v0, 0xd8e4ee, 2.8, 2.2);

    for (let i = 0; i < ORION_CONFIG.missileCount; i++) {
      const fan = (i - (ORION_CONFIG.missileCount - 1) * 0.5) * 0.22;
      _dir.subVectors(player.eye, _v0).normalize();
      _dir.applyAxisAngle(_up, fan);
      _dir.y = clamp(_dir.y + 0.45 + (i % 2) * 0.12, 0.22, 0.82);
      _dir.normalize();

      const sideOff = (i - (ORION_CONFIG.missileCount - 1) * 0.5) * 0.65;
      _v1.set(sideOff, 0.35, 0).applyAxisAngle(_up, this.torsoYaw).add(_v0);
      combat.spawnProjectile({
        origin: _v1.clone(),
        velocity: _dir.clone().multiplyScalar(ORION_CONFIG.missileSpeed),
        kind: 'rocket',
        team: 'enemy',
        damage: ORION_CONFIG.missileDamage,
        source: 'orion_missile',
        gravity: 3.0,
        homing: 1.5,
        steerDelay: 0.35,
        lifetime: 6.0,
        trail: 'smoke',
        tracer: 'heavy',
        explosion: {
          radius: ORION_CONFIG.missileRadius,
          damage: ORION_CONFIG.missileDamage,
          kind: 'rocket',
          scale: 1.15,
        },
      });
    }

    this.attack = 'none';
    this.missileCooldown = ORION_CONFIG.missileCooldown + rand(-1.0, 1.4);
  }

  private startJetStrafe(): void {
    this.attack = 'jet_strafe';
    this.attackClock = 0;
    this.strafeDir = -this.strafeDir;
    const rightX = Math.cos(this.torsoYaw) * this.strafeDir;
    const rightZ = -Math.sin(this.torsoYaw) * this.strafeDir;
    this.strafeVel.set(rightX * ORION_CONFIG.jetStrafeSpeed, 0, rightZ * ORION_CONFIG.jetStrafeSpeed);
    this.ctx.audio.play('steam_burst', { position: this.position, pitch: 0.85, volume: 0.9 });
  }

  private updateJetStrafe(dt: number, time: number): void {
    this.attackClock += dt;
    const b = this.activeBounds();
    this.position.x = clamp(this.position.x + this.strafeVel.x * dt, b.minX, b.maxX);
    this.position.z = clamp(this.position.z + this.strafeVel.z * dt, b.minZ, b.maxZ);
    this.velocity.copy(this.strafeVel);
    this.model.setThrusters(true, 1.1, time);
    this.model.applyChargePose(dt);

    if (this.attackClock >= ORION_CONFIG.jetStrafeDuration) {
      this.model.setThrusters(false);
      this.velocity.set(0, 0, 0);
      this.attack = 'none';
      this.jetStrafeCooldown = ORION_CONFIG.jetStrafeCooldown + rand(-0.8, 1.2);
    }
  }

  // ---- Stage 2 Attacks: Jet-Charge (Column Stagger!), Shockwave Slam, Hunter-Killer Drones, Cleaver Sweep --------

  private updateJetCharge(dt: number, time: number): void {
    this.attackClock += dt;
    if (this.attackClock < ORION_CONFIG.chargeWindup) {
      this.velocity.set(0, 0, 0);
      this.model.setThrusters(true, 0.85, time);
      this.model.applyChargePose(dt);
      return;
    }

    const dashElapsed = this.attackClock - ORION_CONFIG.chargeWindup;
    if (dashElapsed >= ORION_CONFIG.chargeDuration) {
      this.model.setThrusters(false);
      this.velocity.set(0, 0, 0);
      this.attack = 'none';
      this.chargeCooldown = ORION_CONFIG.chargeCooldown + rand(-0.8, 1.2);
      return;
    }

    this.model.setThrusters(true, 1.6, time);
    this.model.applyChargePose(dt);

    const step = ORION_CONFIG.chargeSpeed * dt;
    const b = this.activeBounds();
    this.position.x = clamp(this.position.x + this.chargeDir.x * step, b.minX, b.maxX);
    this.position.z = clamp(this.position.z + this.chargeDir.z * step, b.minZ, b.maxZ);
    this.velocity.copy(this.chargeDir).multiplyScalar(ORION_CONFIG.chargeSpeed);

    // Ram through Tier-1/2 walls along charge path via DestructionManager.tryVehicleRam / blast
    this.chargeRamTimer -= dt;
    if (this.chargeRamTimer <= 0) {
      this.chargeRamTimer = 0.08;
      _v0.copy(this.position).setY(3.2);
      const dest = this.destruction();
      if (this.ctx.physics.raycastInto?.(_v0, this.chargeDir, 5.2, CG.World, _rayHit)) {
        dest?.tryVehicleRam?.(_rayHit.collider, 'heavy', ORION_CONFIG.chargeSpeed, _rayHit.point, this.chargeDir);
      }
      _v1.copy(this.position).addScaledVector(this.chargeDir, 3.5).setY(2.6);
      dest?.blast(_v1, 4.2, 480, 'frame_charge');
    }

    // Check standing corner columns: slamming one buries ORION in concrete for 5.0 s stagger!
    for (let i = 0; i < this.arena.cornerColumns.length; i++) {
      const col = this.arena.cornerColumns[i]!;
      if (!this.isCornerColumnStanding(col)) continue;
      const dx = this.position.x - col.pos[0];
      const dz = this.position.z - col.pos[2];
      const hitRad = col.radius + 3.2;
      if (dx * dx + dz * dz <= hitRad * hitRad) {
        this.collapsedColumns.add(col.id);
        _v0.set(col.pos[0], col.pos[1] + 2.5, col.pos[2]);
        this.destruction()?.blast(_v0, 9.0, 1800, 'frame_charge');
        this.ctx.fx.explosion(_v0, { radius: 8.5, kind: 'shell', scale: 1.9 });
        this.ctx.fx.dust(_v0, _up, 4.5);
        this.ctx.fx.chips(_v0, 0x9aa0a8, 48);
        this.ctx.audio.play('explosion_debris', { position: _v0, volume: 1.0 });
        this.ctx.camera.addTrauma(0.85);
        this.triggerStagger('column_collapse');
        return;
      }
    }

    // Check player hit during charge
    const player = this.ctx.player;
    if (!this.chargeHitPlayer && player.alive) {
      const pd = Math.hypot(player.position.x - this.position.x, player.position.z - this.position.z);
      if (pd <= 5.8 && player.position.y < 7.5) {
        this.chargeHitPlayer = true;
        player.takeDamage({
          amount: ORION_CONFIG.chargeDamage,
          from: this.position,
          type: 'crush',
          source: 'orion_charge',
        });
        _v0.copy(this.chargeDir).multiplyScalar(22).setY(6);
        player.push(_v0);
        this.ctx.camera.addTrauma(0.8);
      }
    }
  }

  private isCornerColumnStanding(col: OrionCornerColumn): boolean {
    if (this.collapsedColumns.has(col.id)) return false;
    const dest = this.destruction();
    if (col.tag && dest?.getCluster(col.tag)) {
      return dest.isClusterAlive(col.tag);
    }
    return true;
  }

  private triggerStagger(reason: 'column_collapse' | 'counter'): void {
    this.staggerLeft = ORION_CONFIG.staggerDuration;
    this.attack = 'none';
    this.velocity.set(0, 0, 0);
    this.model.setThrusters(false);
    this.model.hideAllBeams();
    this.chargeCooldown = ORION_CONFIG.chargeCooldown;
    this.ctx.audio.play('plate_destroyed', { position: this.position, pitch: 0.75, volume: 1.0 });
    this.ctx.audio.play('slam_impact', { position: this.position, pitch: 0.78, volume: 1.0 });
    this.ctx.hud.floatText(this.position, 'STAGGERED — REAR REACTOR EXPOSED!', '#ff9830');
    this.ctx.hud.feed(
      reason === 'column_collapse'
        ? 'COLUMN COLLAPSED ON ORION-0 — REAR REACTOR CORE EXPOSED (2.5× CRIT)!'
        : 'JET-CHARGE COUNTERED — REAR REACTOR CORE EXPOSED (2.5× CRIT)!',
      '#ff9830',
    );
    this.callbacks.onStaggered?.(reason, ORION_CONFIG.staggerDuration);
  }

  private startShockwaveSlam(): void {
    this.attack = 'shockwave_slam';
    this.attackClock = 0;
    this.slamInAir = false;
    this.slamStart.copy(this.position);
    const b = this.activeBounds();
    this.slamEnd.set(
      clamp(this.ctx.player.position.x, b.minX, b.maxX),
      0,
      clamp(this.ctx.player.position.z, b.minZ, b.maxZ),
    );
    this.ctx.audio.play('steam_burst', { position: this.position, pitch: 0.8, volume: 0.9 });
    this.ctx.hud.feed('ORION-0 — LEAPING SHOCKWAVE SLAM · JUMP OVER RING!', '#ffaa22');
  }

  private updateShockwaveSlam(dt: number, time: number): void {
    this.attackClock += dt;
    if (this.attackClock < ORION_CONFIG.slamWindup) {
      this.model.applyChargePose(dt);
      return;
    }

    if (!this.slamInAir) {
      this.slamInAir = true;
      this.ctx.audio.play('titan_charge', { position: this.position, pitch: 1.05, volume: 0.95 });
    }

    const airElapsed = this.attackClock - ORION_CONFIG.slamWindup;
    const t = clamp(airElapsed / ORION_CONFIG.slamAirDuration);
    this.position.lerpVectors(this.slamStart, this.slamEnd, t);
    this.position.y = 4 * ORION_CONFIG.slamPeakHeight * t * (1 - t);
    this.model.setThrusters(true, 1.3, time);
    this.model.applyAirbornePose(t, dt);

    if (t >= 1) {
      this.position.copy(this.slamEnd);
      this.position.y = 0;
      this.slamInAir = false;
      this.model.setThrusters(false);
      this.model.resetPoseImmediate();
      this.attack = 'none';
      this.slamCooldown = ORION_CONFIG.slamCooldown + rand(-1.0, 1.5);

      this.ctx.fx.slam(this.position, 4.5);
      this.ctx.fx.ring(this.position, _up, '#ffaa22', ORION_CONFIG.slamRingRadius);
      this.ctx.fx.dust(this.position, _up, 4.2);
      this.ctx.audio.play('juggernaut_slam', { position: this.position, pitch: 0.82, volume: 1.0 });
      this.destruction()?.blast(this.position, 8.0, 650, 'frame_stomp');

      const player = this.ctx.player;
      const d = Math.hypot(player.position.x - this.position.x, player.position.z - this.position.z);
      if (player.alive && d <= ORION_CONFIG.slamRingRadius && player.position.y < 2.2) {
        const falloff = clamp(1 - d / (ORION_CONFIG.slamRingRadius + 3), 0.45, 1);
        player.takeDamage({
          amount: ORION_CONFIG.slamDamage * falloff,
          from: this.position,
          type: 'crush',
          source: 'orion_slam',
        });
        _v0.set(player.position.x - this.position.x, 0.45, player.position.z - this.position.z).normalize().multiplyScalar(16);
        player.push(_v0);
        this.ctx.camera.addTrauma(0.8);
      } else if (d < 42) {
        this.ctx.camera.addTrauma(0.35 * (1 - d / 42));
      }
    }
  }

  private updateDroneBurst(dt: number): void {
    this.attackClock += dt;
    if (this.attackClock < ORION_CONFIG.droneWindup) return;

    _v0.set(0, 10.2, -1.6).applyAxisAngle(_up, this.torsoYaw).add(this.position);
    this.ctx.fx.smoke(_v0, 0xc8d8e6, 2.5, 1.8);
    this.ctx.fx.sparks(_v0, _up, 14, '#ffaa22');
    this.ctx.audio.play('electric_zap', { position: _v0, pitch: 1.25, volume: 0.85 });
    this.ctx.campaign.signal('orion:drones');
    this.callbacks.onSpawnDrones?.(_v0.clone(), ORION_CONFIG.droneBurstCount);

    this.attack = 'none';
    this.droneCooldown = ORION_CONFIG.droneCooldown + rand(-1.5, 2.0);
  }

  private startCleaverSweep(): void {
    this.attack = 'cleaver_sweep';
    this.attackClock = 0;
    this.ctx.audio.play('sword_windup', { position: this.position, pitch: 0.72, volume: 0.95 });
  }

  private updateCleaverSweep(dt: number): void {
    this.attackClock += dt;
    if (this.attackClock < ORION_CONFIG.cleaverWindup) {
      this.model.armR.rotation.x = -0.85;
      if (!this.leftArmSheared) this.model.armL.rotation.x = -0.85;
      return;
    }

    this.model.armR.rotation.x = 0.75;
    if (!this.leftArmSheared) this.model.armL.rotation.x = 0.75;
    this.ctx.audio.play('sword_sweep', { position: this.position, pitch: 0.76, volume: 1.0 });
    this.ctx.fx.ring(this.position, _up, this.stage === 'stage3_meltdown' ? '#ff223a' : '#30f0ff', ORION_CONFIG.cleaverReach);

    const player = this.ctx.player;
    const d = Math.hypot(player.position.x - this.position.x, player.position.z - this.position.z);
    if (player.alive && d <= ORION_CONFIG.cleaverReach && player.position.y < 8.5) {
      player.takeDamage({
        amount: ORION_CONFIG.cleaverDamage,
        from: this.position,
        type: 'melee',
        source: 'orion_cleaver',
      });
      _v0.set(player.position.x - this.position.x, 0.3, player.position.z - this.position.z).normalize().multiplyScalar(18);
      player.push(_v0);
      this.ctx.camera.addTrauma(0.65);
    }

    this.attack = 'none';
    this.cleaverCooldown = ORION_CONFIG.cleaverCooldown + rand(-0.5, 0.8);
  }

  // ---- Stage 3A Attacks: Dual Crisscrossing Spire Beams & Expanding Plasma Shockwave Rings -----------------------

  private updateSpireBeams(dt: number, time: number): void {
    this.attackClock += dt;
    const muzzle = this.model.getBeamMuzzleWorld(this.position, this.torsoYaw, _beamStartA);
    // Second beam originates from the Spire/dorsal emitter above ORION
    _beamStartB.set(this.position.x, this.position.y + 11.4, this.position.z);

    if (this.attackClock < ORION_CONFIG.spireBeamTelegraph) {
      const yawA = this.beamBaseYaw - 0.65;
      const yawB = this.beamBaseYaw + 0.65;
      _dir.set(Math.sin(yawA), -0.15, Math.cos(yawA)).normalize();
      _beamEndA.copy(muzzle).addScaledVector(_dir, 72);
      _dir.set(Math.sin(yawB), -0.18, Math.cos(yawB)).normalize();
      _beamEndB.copy(_beamStartB).addScaledVector(_dir, 72);
      this.model.updateSpireBeamsVisual('telegraph', muzzle, _beamEndA, _beamStartB, _beamEndB, time);
      return;
    }

    if (!this.beamLoop) {
      this.beamLoop = this.ctx.audio.startLoop('orbital_beam_loop', {
        fadeIn: 0.05,
        pitch: 1.0,
        volume: 0.95,
        position: this.position,
      });
    }

    const sweepElapsed = this.attackClock - ORION_CONFIG.spireBeamTelegraph;
    if (sweepElapsed >= ORION_CONFIG.spireBeamDuration) {
      this.stopBeamLoop();
      this.model.updateSpireBeamsVisual('off', muzzle, _beamEndA, _beamStartB, _beamEndB, time);
      this.attack = 'none';
      this.spireBeamCooldown = ORION_CONFIG.spireBeamCooldown + rand(-0.6, 0.9);
      return;
    }

    const frac = clamp(sweepElapsed / ORION_CONFIG.spireBeamDuration);
    const yawA = this.beamBaseYaw + (frac - 0.5) * 1.3;
    const yawB = this.beamBaseYaw - (frac - 0.5) * 1.3;
    this.torsoYaw = this.beamBaseYaw + Math.sin(frac * Math.PI) * 0.25;

    _dir.set(Math.sin(yawA), -0.15, Math.cos(yawA)).normalize();
    _beamEndA.copy(muzzle).addScaledVector(_dir, 72);
    if (this.ctx.physics.raycastInto?.(muzzle, _dir, 72, CG.World, _rayHit)) {
      _beamEndA.copy(_rayHit.point);
    }

    _dir.set(Math.sin(yawB), -0.18, Math.cos(yawB)).normalize();
    _beamEndB.copy(_beamStartB).addScaledVector(_dir, 72);
    if (this.ctx.physics.raycastInto?.(_beamStartB, _dir, 72, CG.World, _rayHit)) {
      _beamEndB.copy(_rayHit.point);
    }

    this.model.updateSpireBeamsVisual('fire', muzzle, _beamEndA, _beamStartB, _beamEndB, time);

    this.beamDestructTimer -= dt;
    if (this.beamDestructTimer <= 0) {
      this.beamDestructTimer = 0.2;
      const dest = this.destruction();
      dest?.blast(_beamEndA, 4.2, 300, 'aegis_cannon');
      dest?.blast(_beamEndB, 4.2, 300, 'aegis_cannon');
      this.ctx.fx.sparks(_beamEndA, _up, 8, '#ff223a');
      this.ctx.fx.sparks(_beamEndB, _up, 8, '#ff223a');
    }

    this.beamDamageTimer -= dt;
    if (this.beamDamageTimer <= 0 && this.ctx.player.alive) {
      const hitA = distPointToSegmentSq(this.ctx.player.eye, muzzle, _beamEndA) <= 2.4 * 2.4;
      const hitB = distPointToSegmentSq(this.ctx.player.eye, _beamStartB, _beamEndB) <= 2.4 * 2.4;
      if (hitA || hitB) {
        this.beamDamageTimer = 0.2;
        this.ctx.player.takeDamage({
          amount: ORION_CONFIG.spireBeamDps * 0.2,
          from: this.position,
          type: 'fire',
          source: 'orion_spire_beam',
        });
        this.ctx.camera.addTrauma(0.32);
      }
    }
  }

  private updatePlasmaRingAttack(dt: number): void {
    this.attackClock += dt;
    if (this.attackClock < ORION_CONFIG.plasmaRingWindup) return;

    this.plasmaRingActive = true;
    this.plasmaRingRadius = 2.0;
    this.plasmaRingHitPlayer = false;
    this.plasmaRingOrigin.copy(this.position);
    this.ctx.fx.ring(this.plasmaRingOrigin, _up, '#ff223a', ORION_CONFIG.plasmaRingMaxRadius);
    this.ctx.audio.play('crusher_slam', { position: this.plasmaRingOrigin, pitch: 0.9, volume: 0.95 });

    this.attack = 'none';
    this.plasmaRingCooldown = ORION_CONFIG.plasmaRingCooldown + rand(-0.8, 1.2);
  }

  private updatePlasmaRingWave(dt: number): void {
    this.plasmaRingRadius += ORION_CONFIG.plasmaRingSpeed * dt;
    const player = this.ctx.player;
    if (!this.plasmaRingHitPlayer && player.alive && player.position.y < 2.4) {
      const d = Math.hypot(player.position.x - this.plasmaRingOrigin.x, player.position.z - this.plasmaRingOrigin.z);
      if (Math.abs(d - this.plasmaRingRadius) <= 2.2) {
        this.plasmaRingHitPlayer = true;
        player.takeDamage({
          amount: ORION_CONFIG.plasmaRingDamage,
          from: this.plasmaRingOrigin,
          type: 'shock',
          source: 'orion_plasma_ring',
        });
        this.ctx.camera.addTrauma(0.55);
      }
    }
    if (this.plasmaRingRadius >= ORION_CONFIG.plasmaRingMaxRadius) {
      this.plasmaRingActive = false;
    }
  }

  // ---- ExtraTarget Implementation (Locational Damage, Shield DR, Crit, Conduits, Instakill Clamp) ----------------

  shot(collider: RAPIER.Collider, point: THREE.Vector3, amount: number, source: string): boolean {
    const zone = this.byHandle.get(collider.handle);
    if (!zone) return false;
    if (!this.alive) return true;
    const clamped = bossHit(true, amount);
    this.routeZoneDamage(zone, clamped, point, source, false);
    return true;
  }

  direct(
    collider: RAPIER.Collider,
    point: THREE.Vector3,
    amount: number,
    _kind: ExplosionKind,
    source: string,
  ): boolean {
    const zone = this.byHandle.get(collider.handle);
    if (!zone) return false;
    if (!this.alive) return true;
    const clamped = bossHit(true, amount);
    const heavyCounter =
      clamped >= ORION_CONFIG.chargeCounterThreshold ||
      source === 'frame_howitzer' ||
      source === 'autocannon' ||
      source === 'rail';
    this.routeZoneDamage(zone, clamped, point, source, heavyCounter);
    return true;
  }

  blast(center: THREE.Vector3, spec: ExplosionSpec): number {
    if (!this.alive || spec.team !== 'player') return 0;
    const def = EXPLOSIONS[spec.kind];
    const baseAmt = bossHit(true, spec.instakill ? 9999 : spec.damage);
    let hits = 0;

    // Stage 3B Finisher: blast damages exposed Chest Neural Core
    if (this.stage === 'crippled_core') {
      const coreZone = this.byId.get('neuralCore')!;
      const d = Math.max(0, coreZone.center.distanceTo(center) - 2.2);
      if (d <= spec.radius) {
        const falloff = 1 - (d / spec.radius) * (1 - def.edgeDamage);
        this.damageNeuralCore(baseAmt * falloff, center, spec.source);
        return 1;
      }
      return 0;
    }

    // Stage 3A: check conduits first so explosions shatter nearby substations cleanly
    if (this.stage === 'stage3_meltdown') {
      for (let i = 0; i < 3; i++) {
        if (this.conduitHealth[i]! <= 0) continue;
        const cz = this.byId.get(`conduit${i}` as OrionTargetId)!;
        const d = Math.max(0, cz.center.distanceTo(center) - 2.0);
        if (d <= spec.radius) {
          const falloff = 1 - (d / spec.radius) * (1 - def.edgeDamage);
          this.damageConduit(i, baseAmt * falloff, center);
          hits++;
        }
      }
    }

    // Check Shoulder Relays in Stage 1 if explosion is high near shoulders
    if (this.stage === 'stage1_alignment') {
      for (let i = 0; i < 2; i++) {
        if (this.relayHealth[i]! <= 0) continue;
        const rz = this.byId.get(i === 0 ? 'relayL' : 'relayR')!;
        const d = Math.max(0, rz.center.distanceTo(center) - 1.8);
        if (d <= spec.radius) {
          const falloff = 1 - (d / spec.radius) * (1 - def.edgeDamage);
          this.damageRelay(i, baseAmt * falloff, center);
          hits++;
        }
      }
    }

    // Check Hull (or Rear Reactor Core if staggered & blast is behind ORION!)
    const hullZone = this.byId.get('hull')!;
    const dHull = Math.max(0, hullZone.center.distanceTo(center) - 3.2);
    if (dHull <= spec.radius) {
      const falloff = 1 - (dHull / spec.radius) * (1 - def.edgeDamage);
      const dealt = baseAmt * falloff;
      const rearZone = this.reactorExposed && this.isBehindTorso(center) ? this.byId.get('reactor')! : hullZone;
      const counter = dealt >= ORION_CONFIG.chargeCounterThreshold || spec.source === 'frame_howitzer';
      this.routeZoneDamage(rearZone, dealt, center, spec.source, counter);
      hits++;
    }

    return hits;
  }

  frameBlow(at: THREE.Vector3, radius: number, damage: number, _dir?: THREE.Vector3 | null, source = 'frame_melee'): number {
    if (!this.alive) return 0;
    const clamped = bossHit(true, damage);

    if (this.stage === 'crippled_core') {
      const coreZone = this.byId.get('neuralCore')!;
      if (coreZone.center.distanceTo(at) <= radius + 3.2) {
        this.damageNeuralCore(clamped, at, source || 'slam');
        return 1;
      }
      return 0;
    }

    // Check Stage 3A Conduits within melee swing reach
    if (this.stage === 'stage3_meltdown') {
      let hitCount = 0;
      for (let i = 0; i < 3; i++) {
        if (this.conduitHealth[i]! <= 0) continue;
        const cz = this.byId.get(`conduit${i}` as OrionTargetId)!;
        if (cz.center.distanceTo(at) <= radius + 2.6) {
          this.damageConduit(i, clamped, at);
          hitCount++;
        }
      }
      if (hitCount > 0) return hitCount;
    }

    const hullZone = this.byId.get('hull')!;
    if (hullZone.center.distanceTo(at) > radius + 3.8) return 0;
    const targetZone = this.reactorExposed && this.isBehindTorso(at) ? this.byId.get('reactor')! : hullZone;
    // Frame counter-melee mid-charge triggers Stage 2 stagger!
    this.routeZoneDamage(targetZone, clamped, at, source || 'frame_melee', true);
    return 1;
  }

  paintable(out: MissileTarget[]): void {
    if (!this.alive) return;
    if (this.stage === 'stage1_alignment') {
      if (this.relayHealth[0] > 0) out.push(this.paintTargets.get('relayL')!);
      if (this.relayHealth[1] > 0) out.push(this.paintTargets.get('relayR')!);
      out.push(this.paintTargets.get('hull')!);
    } else if (this.stage === 'stage2_unrestricted') {
      if (this.reactorExposed) out.push(this.paintTargets.get('reactor')!);
      out.push(this.paintTargets.get('hull')!);
    } else if (this.stage === 'stage3_meltdown') {
      let anyConduit = false;
      for (let i = 0; i < 3; i++) {
        if (this.conduitHealth[i]! > 0) {
          out.push(this.paintTargets.get(`conduit${i}` as OrionTargetId)!);
          anyConduit = true;
        }
      }
      if (!anyConduit) out.push(this.paintTargets.get('hull')!);
    } else if (this.stage === 'crippled_core') {
      out.push(this.paintTargets.get('neuralCore')!);
    }
  }

  radarTargets(out: VehicleRadarTarget[]): void {
    if (this.alive) out.push(this.radarTarget);
  }

  highlightMeshes(out: THREE.Object3D[]): void {
    if (!this.alive) return;
    for (let i = 0; i < this.model.highlightMeshes.length; i++) {
      out.push(this.model.highlightMeshes[i]!);
    }
    if (this.stage === 'stage3_meltdown') {
      for (let c = 0; c < 3; c++) {
        if (this.conduitHealth[c]! <= 0) continue;
        const list = this.conduits[c]!.highlightMeshes;
        for (let i = 0; i < list.length; i++) out.push(list[i]!);
      }
    }
  }

  // ---- Internal Damage Routing -----------------------------------------------------------------------------------

  private routeZoneDamage(
    zone: OrionHitZone,
    amount: number,
    point: THREE.Vector3,
    source: string,
    canCounterCharge: boolean,
  ): void {
    if (amount <= 0) return;

    if (zone.id === 'relayL') {
      this.damageRelay(0, amount, point);
      return;
    }
    if (zone.id === 'relayR') {
      this.damageRelay(1, amount, point);
      return;
    }
    if (zone.conduitIndex >= 0) {
      this.damageConduit(zone.conduitIndex, amount, point);
      return;
    }
    if (zone.id === 'neuralCore') {
      this.damageNeuralCore(amount, point, source);
      return;
    }

    // Hull or Rear Reactor Core hit
    if (this.stage === 'crippled_core') {
      // Redirect direct hits near chest to Neural Core only if hit neuralCore; armored chassis deflects
      this.ctx.audio.play('armour_stopped', { position: point, pitch: 0.9, volume: 0.7 });
      this.ctx.fx.sparks(point, _up, 5, '#8cf8ff');
      return;
    }

    if (this.invulnerable) {
      this.ctx.audio.play('shield_hit', { position: point, pitch: 0.85, volume: 0.8 });
      this.ctx.fx.sparks(point, _up, 8, '#22ecff');
      if (this.stage === 'stage3_meltdown') {
        this.ctx.hud.floatText(point, 'INVULNERABLE — DESTROY GRID CONDUITS!', '#22ecff');
      }
      return;
    }

    // Stage 2 Mid-Charge Counter-Melee / Heavy Shell Stagger!
    if (
      this.stage === 'stage2_unrestricted' &&
      this.attack === 'jet_charge' &&
      this.staggerLeft <= 0 &&
      canCounterCharge
    ) {
      this.triggerStagger('counter');
    }

    let dealt = amount;
    let crit = false;
    let shielded = false;

    // Stage 1 / Breakout Hard-Light Shield: 70% frontal DR while >= 1 Shoulder Relay Fin stands!
    if (this.shieldActive && this.isFrontalHit(point)) {
      if (this.stage === 'breakout' && isSmallArm(source)) {
        this.model.pulseShield();
        this.ctx.audio.play('shield_hit', { position: point, pitch: 1.05, volume: 0.75 });
        this.ctx.fx.sparks(point, _up, 6, '#22ecff');
        return;
      }
      dealt = amount * (1 - ORION_CONFIG.shieldFrontalDR);
      shielded = true;
      this.model.pulseShield();
    }

    // Stage 2 Stagger: Rear Reactor Core 2.5x critical damage multiplier!
    if (zone.id === 'reactor' && this.reactorExposed) {
      dealt = amount * ORION_CONFIG.reactorCritMult;
      crit = true;
    }

    this.applyHullDamage(dealt, point, crit, shielded);
  }

  private damageRelay(index: number, amount: number, point: THREE.Vector3): void {
    if (this.stage !== 'stage1_alignment' && this.stage !== 'breakout') return;
    if (this.relayHealth[index]! <= 0) return;

    this.relayHealth[index] = Math.max(0, this.relayHealth[index]! - amount);
    const broken = this.relayHealth[index]! <= 0;
    this.ctx.fx.chips(point, broken ? 0x22ecff : 0x8cf8ff, broken ? 28 : 10);
    this.ctx.hud.hitMarker(broken ? 'kill' : 'armorThrough');
    this.ctx.audio.play(broken ? 'plate_destroyed' : 'armour_through', { position: point, pitch: 1.1 });

    if (broken) {
      const side = index === 0 ? 'left' : 'right';
      this.model.setRelayIntact(side, false);
      const remaining = (this.relayHealth[0] > 0 ? 1 : 0) + (this.relayHealth[1] > 0 ? 1 : 0);
      this.ctx.fx.explosion(point, { radius: 4.5, kind: 'rocket', scale: 1.1 });
      this.ctx.audio.play('electric_zap', { position: point, pitch: 0.9, volume: 0.95 });
      this.ctx.hud.floatText(point, `${side.toUpperCase()} RELAY SHATTERED`, '#22ecff');
      this.callbacks.onRelayDestroyed?.(side, remaining);

      if (remaining === 0) {
        this.model.setShieldActive(false);
        this.ctx.fx.ring(this.position, _up, '#22ecff', 16);
        this.ctx.audio.play('riot_shield_break', { position: this.position, pitch: 0.72, volume: 1.0 });
        this.ctx.hud.feed('BOTH SHOULDER RELAYS DESTROYED — HARD-LIGHT SHIELD DOWN!', '#7ee787');
        this.callbacks.onShieldBroken?.();
      }
    }
  }

  private damageConduit(index: number, amount: number, point: THREE.Vector3): void {
    if (this.stage !== 'stage3_meltdown') return;
    if (this.conduitHealth[index]! <= 0) return;

    this.conduitHealth[index] = Math.max(0, this.conduitHealth[index]! - amount);
    const broken = this.conduitHealth[index]! <= 0;
    this.ctx.fx.chips(point, 0x22ecff, broken ? 32 : 10);
    this.ctx.hud.hitMarker(broken ? 'kill' : 'body');
    this.ctx.audio.play(broken ? 'plate_destroyed' : 'hit_marker', { position: point, pitch: 1.05 });

    if (broken) {
      this.conduits[index]!.setDestroyed(true);
      this.uploadPauseLeft += ORION_CONFIG.conduitPauseSeconds;
      const remaining = this.aliveConduitsCount();
      this.ctx.fx.explosion(point, { radius: 6.0, kind: 'rocket', scale: 1.4 });
      this.ctx.fx.ring(point, _up, '#22ecff', 12);
      this.ctx.audio.play('electric_zap', { position: point, pitch: 0.8, volume: 1.0 });
      this.ctx.hud.feed(
        remaining > 0
          ? `GRID CONDUIT SHATTERED — UPLOAD PAUSED 10 s (${remaining} REMAINING)!`
          : 'ALL 3 GRID CONDUITS DESTROYED — ORION-0 SHIELDING COLLAPSED!',
        '#7ee787',
      );
      this.callbacks.onConduitDestroyed?.(index, remaining);
    }
  }

  private damageNeuralCore(amount: number, point: THREE.Vector3, source: string): void {
    if (this.stage !== 'crippled_core' || this.neuralCoreHealth <= 0) return;

    const mult = isFinisherMeleeOrSlam(source) ? ORION_CONFIG.finisherSlamMult : 1.0;
    const dealt = amount * mult;
    this.neuralCoreHealth = Math.max(0, this.neuralCoreHealth - dealt);
    const finisherPool = this.maxHealth * ORION_CONFIG.stage3ToFinisherHpFrac;
    this.health = (this.neuralCoreHealth / ORION_CONFIG.neuralCoreHealth) * finisherPool;

    const killed = this.neuralCoreHealth <= 0;
    this.ctx.fx.chips(point, 0x8cf8ff, killed ? 42 : 14);
    this.ctx.hud.hitMarker(killed ? 'kill' : 'armorThrough');
    this.ctx.audio.play(killed ? 'plate_destroyed' : 'armour_through', { position: point, pitch: 1.25 });

    if (killed) {
      this.triggerDeath();
    }
  }

  private applyHullDamage(amount: number, point: THREE.Vector3, crit: boolean, shielded: boolean): void {
    if (amount <= 0) return;
    this.health = Math.max(0, this.health - amount);

    this.ctx.fx.chips(point, crit ? 0xff8820 : shielded ? 0x22ecff : 0xd8e2ec, crit ? 18 : 8);
    this.ctx.hud.hitMarker(crit ? 'armorThrough' : 'body');
    this.ctx.audio.play(shielded ? 'shield_hit' : crit ? 'armour_through' : 'hit_marker', {
      position: point,
      pitch: crit ? 1.2 : shielded ? 1.05 : 0.95,
    });
    if (crit) {
      this.ctx.hud.floatText(point, 'REACTOR CRIT 2.5×', '#ff9830');
    }

    // Check deterministic stage transitions (clamped so single massive hits never skip stages!)
    const s1Gate = this.maxHealth * ORION_CONFIG.stage1To2HpFrac;
    const s2Gate = this.maxHealth * ORION_CONFIG.stage2To3HpFrac;
    const s3Gate = this.maxHealth * ORION_CONFIG.stage3ToFinisherHpFrac;

    if (this.stage === 'stage1_alignment' && this.health <= s1Gate) {
      this.health = s1Gate;
      this.beginBridgeSmash('stage1_alignment');
      return;
    }

    if (this.stage === 'stage2_unrestricted' && this.health <= s2Gate) {
      this.health = s2Gate;
      this.beginSpireLeap('stage2_unrestricted');
      return;
    }

    if (this.stage === 'stage3_meltdown' && this.aliveConduitsCount() === 0 && this.health <= s3Gate) {
      this.health = s3Gate;
      this.triggerEmpEject();
    }
  }

  // ---- Geometry & Transform Helpers ------------------------------------------------------------------------------

  private isFrontalHit(point: THREE.Vector3): boolean {
    const dx = point.x - this.position.x;
    const dz = point.z - this.position.z;
    const lenSq = dx * dx + dz * dz;
    // Hits sampled at ORION's exact center (e.g., splash/tests) count as frontal against the Hard-Light Shield.
    if (lenSq < 0.25) return true;
    const inv = 1 / Math.sqrt(lenSq);
    const fwdX = Math.sin(this.torsoYaw);
    const fwdZ = Math.cos(this.torsoYaw);
    return dx * inv * fwdX + dz * inv * fwdZ >= -0.15;
  }

  private isBehindTorso(point: THREE.Vector3): boolean {
    const dx = point.x - this.position.x;
    const dz = point.z - this.position.z;
    const lenSq = dx * dx + dz * dz;
    if (lenSq < 0.25) return false;
    const inv = 1 / Math.sqrt(lenSq);
    const fwdX = Math.sin(this.torsoYaw);
    const fwdZ = Math.cos(this.torsoYaw);
    return dx * inv * fwdX + dz * inv * fwdZ < -0.15;
  }

  private isTargetPaintable(id: OrionTargetId): boolean {
    if (!this.alive) return false;
    if (id === 'relayL') return this.stage === 'stage1_alignment' && this.relayHealth[0] > 0;
    if (id === 'relayR') return this.stage === 'stage1_alignment' && this.relayHealth[1] > 0;
    if (id === 'reactor') return this.reactorExposed;
    if (id === 'conduit0') return this.stage === 'stage3_meltdown' && this.conduitHealth[0] > 0;
    if (id === 'conduit1') return this.stage === 'stage3_meltdown' && this.conduitHealth[1] > 0;
    if (id === 'conduit2') return this.stage === 'stage3_meltdown' && this.conduitHealth[2] > 0;
    if (id === 'neuralCore') return this.stage === 'crippled_core' && this.neuralCoreHealth > 0;
    if (id === 'hull') {
      return (
        this.stage === 'stage1_alignment' ||
        this.stage === 'stage2_unrestricted' ||
        (this.stage === 'stage3_meltdown' && this.aliveConduitsCount() === 0)
      );
    }
    return false;
  }

  private syncModelTransform(): void {
    this.root.position.copy(this.position);
    this.root.rotation.set(0, this.legYaw, 0);
    this.model.torso.rotation.y = wrapAngle(this.torsoYaw - this.legYaw);
  }

  private syncWorld(): void {
    this.syncModelTransform();

    if (this.stage === 'dormant' || this.stage === 'dead') {
      this.parkAllColliders();
      return;
    }

    _q.setFromAxisAngle(_up, this.torsoYaw);

    for (let i = 0; i < this.zones.length; i++) {
      const z = this.zones[i]!;
      let active = false;

      if (z.id === 'relayL') {
        active = (this.stage === 'stage1_alignment' || this.stage === 'breakout') && this.relayHealth[0] > 0;
      } else if (z.id === 'relayR') {
        active = (this.stage === 'stage1_alignment' || this.stage === 'breakout') && this.relayHealth[1] > 0;
      } else if (z.id === 'hull') {
        active = this.stage !== 'crippled_core';
      } else if (z.id === 'reactor') {
        active = this.stage === 'stage2_unrestricted';
      } else if (z.conduitIndex >= 0) {
        active = this.stage === 'stage3_meltdown' && this.conduitHealth[z.conduitIndex]! > 0;
      } else if (z.id === 'neuralCore') {
        active = this.stage === 'crippled_core' && this.neuralCoreHealth > 0;
      }

      if (!active) {
        _v0.set(0, -1000, 0);
        z.center.copy(_v0);
        z.collider.setTranslation(_v0);
        continue;
      }

      if (z.conduitIndex >= 0) {
        const cp = this.arena.conduitPositions[z.conduitIndex]!;
        z.center.set(cp[0], cp[1] + z.local[1], cp[2]);
        z.collider.setTranslation(z.center);
        z.collider.setRotation(_q.identity());
      } else {
        z.center.set(z.local[0], z.local[1], z.local[2]).applyAxisAngle(_up, this.torsoYaw).add(this.position);
        z.collider.setTranslation(z.center);
        _q.setFromAxisAngle(_up, this.torsoYaw);
        z.collider.setRotation(_q);
      }
    }
  }

  private parkAllColliders(): void {
    _v0.set(0, -1000, 0);
    for (let i = 0; i < this.zones.length; i++) {
      this.zones[i]!.center.copy(_v0);
      this.zones[i]!.collider.setTranslation(_v0);
    }
  }

  private facePlayerImmediate(): void {
    const yaw = Math.atan2(
      this.ctx.player.position.x - this.position.x,
      this.ctx.player.position.z - this.position.z,
    );
    if (Number.isFinite(yaw)) {
      this.legYaw = yaw;
      this.torsoYaw = yaw;
    }
  }

  private attachHudFollow(color: string): void {
    this.hudUnmark?.();
    const anchor = this.byId.get('hull')!.center;
    this.hudUnmark = this.ctx.hud.follow(anchor, 'ORION-0', color);
  }

  private destruction(): DestructionManagerLike | undefined {
    return this.ctx.world?.objects?.destruction;
  }

  private emitAmbientSparks(dt: number, interval: number, orangeReactor: boolean): void {
    this.sparkTimer -= dt;
    if (this.sparkTimer > 0) return;
    this.sparkTimer = interval;
    _v0.set(0, orangeReactor ? 8.0 : 4.0, orangeReactor ? -1.8 : 0.6)
      .applyAxisAngle(_up, this.torsoYaw)
      .add(this.position);
    this.ctx.fx.sparks(_v0, _up, 6, orangeReactor ? '#ff8820' : '#22ecff');
    if (this.stage === 'dead' || this.stage === 'crippled_core') {
      this.ctx.fx.smoke(_v0, 0x1d2028, 2.2, 2.4);
    }
  }

  private emitStageChange(prev: OrionStage, next: OrionStage): void {
    if (prev !== next) {
      this.callbacks.onStageChange?.(next, prev);
    }
  }

  private resetCommonState(): void {
    this.attack = 'none';
    this.attackClock = 0;
    this.staggerLeft = 0;
    this.velocity.set(0, 0, 0);
    this.stridePhase = 0;
    this.lastStepIndex = 0;
    this.beamCooldown = 2.6;
    this.missileCooldown = 6.2;
    this.jetStrafeCooldown = 5.5;
    this.chargeCooldown = 3.0;
    this.slamCooldown = 7.5;
    this.droneCooldown = 10.5;
    this.cleaverCooldown = 2.5;
    this.spireBeamCooldown = 3.0;
    this.plasmaRingCooldown = 5.5;
    this.plasmaRingActive = false;
    this.uploadProgress = 0;
    this.uploadPauseLeft = 0;
    this.uploadCompleted = false;
    this.collapsedColumns.clear();
    this.relayHealth[0] = ORION_CONFIG.relayHealth;
    this.relayHealth[1] = ORION_CONFIG.relayHealth;
    this.conduitHealth[0] = ORION_CONFIG.conduitHealth;
    this.conduitHealth[1] = ORION_CONFIG.conduitHealth;
    this.conduitHealth[2] = ORION_CONFIG.conduitHealth;
    this.neuralCoreHealth = ORION_CONFIG.neuralCoreHealth;
  }

  private stopBeamLoop(): void {
    this.beamLoop?.stop(0.1);
    this.beamLoop = null;
  }

  private stopJetLoop(): void {
    this.jetLoop?.stop(0.12);
    this.jetLoop = null;
  }

  private stopLoops(): void {
    this.stopBeamLoop();
    this.stopJetLoop();
  }

  dispose(): void {
    this.stopLoops();
    this.vehicles?.removeExtra(this);
    this.hudUnmark?.();
    this.hudUnmark = null;
    for (let i = 0; i < this.zones.length; i++) {
      this.ctx.physics.world.removeCollider(this.zones[i]!.collider, true);
    }
    this.model.dispose();
    for (let i = 0; i < 3; i++) {
      this.conduits[i]!.dispose();
    }
  }
}
