/**
 * Act 4 Pursuit Helicopter Boss — `AUDITOR-1` ("Bank Run", Mission 4).
 *
 * Governor Reginald Sterling's armored Reserve Air-Support Gunship chases the player's
 * getaway Humvee down the Coastal Elevated Expressway with 4 destructible subsystems
 * (`chin`, `podL`, `podR`, `tail`), 3 dynamic attack phases (`strafe`, `broadside`,
 * `overpass` with shootable 4-rocket salvos), a `.fc-bar.fc-boss` + `.fc-pips` integrity
 * HUD, and a 2.8 s burning death spiral into an overhead highway gantry.
 */
import * as THREE from 'three';
import type { Ctx, EmitterHandle, LoopHandle } from '../../core/contracts';
import { clamp, damp, dampAngle, lerp, rand, wrapAngle } from '../../core/math';
import { ModelBuilder, ModelMaterials } from '../../progression/modelkit';
import { div, Label, span } from '../../ui/dom';
import { HIGHWAY_ORIGIN, LV } from '../../world/map/bank/plan';

// -------------------------------------------------------------------------------------------------
// Public types & constants
// -------------------------------------------------------------------------------------------------

export type BossPhase = 'idle' | 'strafe' | 'broadside' | 'overpass' | 'dying' | 'dead';
export type BossSubsystemId = 'chin' | 'podL' | 'podR' | 'tail';

export interface BossSubsystem {
  readonly id: BossSubsystemId;
  readonly label: string;
  readonly localOffset: THREE.Vector3;
  readonly hitRadius: number;
  hp: number;
  readonly maxHp: number;
  destroyed: boolean;
  hotTimer: number;
}

export interface BossRocket {
  readonly id: number;
  readonly mesh: THREE.Group;
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  hp: number;
  age: number;
  maxAge: number;
  alive: boolean;
  smokeTimer: number;
}

export interface BossHitResult {
  readonly distance: number;
  readonly point: THREE.Vector3;
  readonly kind: 'rocket' | BossSubsystemId | 'hull';
}

export const GUNSHIP_BOSS_CONSTANTS = {
  maxHp: 1350,
  subsystemBonusMult: 1.35,
  chinHp: 260,
  podLHp: 220,
  podRHp: 220,
  tailHp: 260,
  rocketHp: 22,
  rocketHitRadius: 1.35,
  rocketTravelSeconds: 2.4,
  rocketDamage: 40,
  strafeStaggerThreshold: 90,
  strafeDuration: 6.5,
  broadsideDuration: 6.0,
  overpassDuration: 6.5,
  overpassLockDelay: 1.2,
  deathSpiralDuration: 2.8,
  hullHitRadius: 3.6,
} as const;

const PHASE_LABELS: Record<BossPhase, string> = {
  idle: 'STANDBY',
  strafe: 'PHASE — REAR-CHASE STRAFE',
  broadside: 'PHASE — BROADSIDE DOOR GUNNERS',
  overpass: 'PHASE — OVERPASS ROCKET SALVO',
  dying: 'CRITICAL — TAIL & ROTOR FAILURE',
  dead: 'DESTROYED',
};

// -------------------------------------------------------------------------------------------------
// Scratch math objects (zero per-frame allocations)
// -------------------------------------------------------------------------------------------------

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _target = new THREE.Vector3();
const _subWorld = new THREE.Vector3();
const _hitPt = new THREE.Vector3();
const _defaultHumvee = new THREE.Vector3(HIGHWAY_ORIGIN[0], LV.highway, HIGHWAY_ORIGIN[2]);

const ALONG_X: readonly [number, number, number] = [0, 0, Math.PI / 2];
const ALONG_Z: readonly [number, number, number] = [Math.PI / 2, 0, 0];

// -------------------------------------------------------------------------------------------------
// Pure ray-sphere helper
// -------------------------------------------------------------------------------------------------

function raySphereDist(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  center: THREE.Vector3,
  radius: number,
  maxDist: number,
): number {
  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const oz = origin.z - center.z;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  if (c <= 0) return 0;
  if (b > 0) return -1;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 && t <= maxDist ? t : -1;
}

// -------------------------------------------------------------------------------------------------
// AUDITOR-1 Model Builder (dark navy & Reserve gold armored gunship)
// -------------------------------------------------------------------------------------------------

interface AuditorModel {
  root: THREE.Group;
  fuselage: THREE.Group;
  mainRotor: THREE.Group;
  tailRotor: THREE.Group;
  chinGroup: THREE.Group;
  podLGroup: THREE.Group;
  podRGroup: THREE.Group;
  tailGroup: THREE.Group;
  searchlightCone: THREE.Mesh;
  lockRails: THREE.Mesh[];
}

function buildAuditorModel(materials: ModelMaterials): AuditorModel {
  const root = new THREE.Group();
  root.name = 'heist.auditor1';

  const NAVY = '#142136';
  const NAVY_HI = '#1f3352';
  const NAVY_DARK = '#0d1624';
  const GOLD = '#d4a428';
  const GOLD_HI = '#ecc24c';
  const STEEL = '#333b46';
  const GLASS = '#09131e';

  // Main armored fuselage (nose along +Z, up +Y)
  const bodyB = new ModelBuilder();
  bodyB.box(2.35, 1.85, 5.4, NAVY, { at: [0, 0.1, 0.8] });
  bodyB.box(2.05, 1.45, 2.4, NAVY_HI, { at: [0, -0.05, 4.1] });
  bodyB.box(1.35, 0.9, 1.4, NAVY_DARK, { at: [0, -0.25, 5.5] });
  // Reserve gold livery bands along flanks & nose
  for (const s of [-1, 1]) {
    bodyB.box(0.1, 0.24, 5.6, GOLD, { at: [s * 1.2, 0.12, 1.0] });
    bodyB.box(0.08, 0.12, 2.2, GOLD_HI, { at: [s * 1.06, -0.05, 4.1] });
    // Armored side door frames (for broadside door gunners)
    bodyB.box(0.12, 1.15, 1.8, NAVY_DARK, { at: [s * 1.18, -0.08, 0.65] });
    // Twin armored turbine housings above fuselage
    bodyB.cyl(0.46, 0.52, 2.9, 10, NAVY_HI, { at: [s * 0.78, 1.28, 0.3], rot: ALONG_Z });
    bodyB.glow(new THREE.CircleGeometry(0.24, 8), '#ff7828', 2.8, { at: [s * 0.78, 1.28, -1.18], rot: [0, Math.PI, 0] });
    // Stub wings
    bodyB.box(2.8, 0.22, 1.55, NAVY_DARK, { at: [s * 2.15, -0.18, 0.85], rot: [0, 0, s * 0.12] });
    bodyB.box(0.14, 0.7, 1.2, GOLD, { at: [s * 3.5, -0.45, 0.85] });
    // Navigation strobes
    bodyB.glow(new THREE.SphereGeometry(0.12, 6, 4), s > 0 ? '#ff2a20' : '#35ff8a', 4.5, {
      at: [s * 3.55, -0.45, 0.85],
    });
    // Heavy landing skids
    bodyB.box(0.14, 0.12, 4.2, STEEL, { at: [s * 1.15, -1.55, 0.9] });
    bodyB.box(0.1, 0.72, 0.14, STEEL, { at: [s * 1.0, -1.2, 2.1], rot: [0, 0, s * 0.25] });
    bodyB.box(0.1, 0.72, 0.14, STEEL, { at: [s * 1.0, -1.2, -0.3], rot: [0, 0, s * 0.25] });
  }
  // Armored cockpit canopy & glowing flight-deck visor
  bodyB.box(1.85, 0.92, 2.2, GLASS, { at: [0, 0.62, 3.65], rot: [0.28, 0, 0] });
  bodyB.glow(new THREE.BoxGeometry(1.4, 0.12, 0.08), '#ffae30', 2.6, { at: [0, 0.65, 4.78] });
  // Rotor mast
  bodyB.cyl(0.26, 0.34, 0.85, 10, STEEL, { at: [0, 1.58, 0.55] });
  // Tail boom connecting fuselage to tail assembly
  bodyB.box(0.74, 0.82, 5.2, NAVY, { at: [0, 0.45, -4.1] });
  bodyB.box(0.8, 0.14, 4.6, GOLD, { at: [0, 0.55, -4.0] });
  // Searchlight housing under nose
  bodyB.solid(new THREE.SphereGeometry(0.32, 8, 6), STEEL, { at: [0, -0.82, 5.0] });
  bodyB.glow(new THREE.CircleGeometry(0.24, 10), '#fff6d8', 5.0, { at: [0, -0.86, 5.28] });

  const fuselage = materials.group(bodyB);
  root.add(fuselage);

  // 4-blade main rotor
  const mrB = new ModelBuilder();
  mrB.cyl(0.42, 0.48, 0.34, 10, STEEL);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    mrB.box(0.36, 0.05, 6.4, '#1a1e24', { at: [Math.sin(a) * 3.2, 0.04, Math.cos(a) * 3.2], rot: [0.04, a, 0] });
    mrB.box(0.38, 0.06, 0.48, GOLD_HI, { at: [Math.sin(a) * 6.15, 0.04, Math.cos(a) * 6.15], rot: [0.04, a, 0] });
  }
  const mainRotor = materials.group(mrB);
  mainRotor.position.set(0, 2.08, 0.55);
  root.add(mainRotor);

  // Subsystem 1: Chin Rotary Turret
  const chinB = new ModelBuilder();
  chinB.solid(new THREE.SphereGeometry(0.44, 10, 8), STEEL);
  chinB.box(0.42, 0.38, 0.85, NAVY_DARK, { at: [0, -0.08, 0.35] });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    chinB.cyl(0.045, 0.045, 1.65, 8, '#46505c', { at: [Math.cos(a) * 0.1, Math.sin(a) * 0.1, 1.3], rot: ALONG_Z });
  }
  chinB.glow(new THREE.BoxGeometry(0.18, 0.12, 0.12), '#ff3824', 3.4, { at: [0, 0.22, 0.55] });
  const chinGroup = materials.group(chinB);
  chinGroup.position.set(0, -1.18, 3.8);
  root.add(chinGroup);

  // Subsystems 2 & 3: Port & Starboard Rocket Pods + Lock-on Warning Rails
  const makePod = (side: 1 | -1): { group: THREE.Group; rail: THREE.Mesh } => {
    const pb = new ModelBuilder();
    pb.box(0.18, 0.42, 0.72, STEEL, { at: [0, 0.28, 0] });
    pb.cyl(0.42, 0.42, 2.1, 12, NAVY_HI, { rot: ALONG_Z });
    pb.cyl(0.44, 0.44, 0.24, 12, GOLD, { at: [0, 0, 0.65], rot: ALONG_Z });
    for (const [rx, ry] of [[-0.14, 0.14], [0.14, 0.14], [-0.14, -0.14], [0.14, -0.14]] as const) {
      pb.cyl(0.11, 0.11, 0.12, 8, '#101216', { at: [rx, ry, 1.08], rot: ALONG_Z });
    }
    const group = materials.group(pb);
    group.position.set(side * 2.55, -0.62, 1.05);

    const railMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ff2218').multiplyScalar(4.0),
      transparent: true,
      opacity: 0.15,
      toneMapped: false,
    });
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 2.15), railMat);
    rail.position.set(side * 0.48, 0.08, 0.1);
    group.add(rail);
    return { group, rail };
  };
  const podL = makePod(1);
  const podR = makePod(-1);
  root.add(podL.group, podR.group);

  // Subsystem 4: Tail Fin & Tail Rotor Assembly
  const tailGroup = new THREE.Group();
  tailGroup.position.set(0, 1.45, -6.5);
  const tb = new ModelBuilder();
  tb.box(0.24, 2.25, 1.45, NAVY_HI, { at: [0, 0.25, 0], rot: [0.22, 0, 0] });
  tb.box(0.28, 0.36, 1.4, GOLD, { at: [0, 0.72, -0.12], rot: [0.22, 0, 0] });
  tb.box(3.0, 0.12, 0.72, NAVY_DARK, { at: [0, -0.65, 0.45] });
  tb.glow(new THREE.SphereGeometry(0.14, 6, 4), '#ff2a20', 4.5, { at: [0, 1.45, -0.3] });
  tailGroup.add(materials.group(tb));

  const trB = new ModelBuilder();
  trB.cyl(0.16, 0.16, 0.34, 8, STEEL, { rot: ALONG_X });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    trB.box(0.05, 1.15, 0.16, '#1a1e24', { at: [0.22, Math.cos(a) * 0.56, Math.sin(a) * 0.56], rot: [a, 0, 0] });
  }
  const tailRotor = materials.group(trB);
  tailRotor.position.set(0.14, 0.55, -0.2);
  tailGroup.add(tailRotor);
  root.add(tailGroup);

  // Blinding volumetric searchlight cone sweeping from nose toward the Humvee
  const coneGeo = new THREE.ConeGeometry(3.8, 28, 16, 1, true);
  coneGeo.translate(0, -14, 0);
  coneGeo.rotateX(-Math.PI / 2); // points along +Z from origin
  const coneMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#fff4d0'),
    transparent: true,
    opacity: 0.14,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  });
  const searchlightCone = new THREE.Mesh(coneGeo, coneMat);
  searchlightCone.position.set(0, -0.88, 5.25);
  root.add(searchlightCone);

  return {
    root,
    fuselage,
    mainRotor,
    tailRotor,
    chinGroup,
    podLGroup: podL.group,
    podRGroup: podR.group,
    tailGroup,
    searchlightCone,
    lockRails: [podL.rail, podR.rail],
  };
}

function buildBossRocketMesh(materials: ModelMaterials): THREE.Group {
  const b = new ModelBuilder();
  b.cyl(0.11, 0.11, 1.35, 8, '#343c46', { rot: ALONG_Z });
  b.cyl(0.03, 0.14, 0.42, 8, '#e23224', { at: [0, 0, 0.85], rot: ALONG_Z });
  b.glow(new THREE.SphereGeometry(0.28, 8, 6), '#ff8828', 5.2, { at: [0, 0, -0.78] });
  b.glow(new THREE.SphereGeometry(0.18, 6, 4), '#ff2a18', 4.0, { at: [0, 0, 0.92] });
  return materials.group(b);
}

// -------------------------------------------------------------------------------------------------
// Boss Integrity HUD (reuses `.fc-bar.fc-boss` & `.fc-pips` from campaign.css)
// -------------------------------------------------------------------------------------------------

interface BossHudRefs {
  root: HTMLElement;
  phase: Label;
  pct: Label;
  fill: HTMLElement;
  pips: Record<BossSubsystemId, HTMLElement>;
}

const PIP_ORDER: readonly BossSubsystemId[] = ['chin', 'podL', 'podR', 'tail'];
const PIP_LABELS: Record<BossSubsystemId, string> = {
  chin: 'CHIN TURRET',
  podL: 'PORT POD',
  podR: 'STBD POD',
  tail: 'TAIL ROTOR',
};

function createBossHud(): BossHudRefs | null {
  if (typeof document === 'undefined') return null;
  const titleEl = span('fc-title', 'AUDITOR-1 // RESERVE GUNSHIP');
  const phaseEl = span('fc-phase', PHASE_LABELS.strafe);
  const pctEl = span('fc-pct', '100%');
  const fill = div('fc-fill boss');
  const pipRow = div('fc-pips');

  const pips = {} as Record<BossSubsystemId, HTMLElement>;
  for (const id of PIP_ORDER) {
    const pip = span('fc-pip', PIP_LABELS[id]);
    pips[id] = pip;
    pipRow.append(pip);
  }

  const root = div(
    'fc-bar fc-boss',
    div('fc-head', titleEl, phaseEl, pctEl),
    div('fc-track', fill),
    pipRow,
  );
  const host = document.querySelector('.hud') ?? document.body;
  host?.append(root);
  return {
    root,
    phase: new Label(phaseEl),
    pct: new Label(pctEl),
    fill,
    pips,
  };
}

// -------------------------------------------------------------------------------------------------
// GunshipBoss (`AUDITOR-1`)
// -------------------------------------------------------------------------------------------------

export class GunshipBoss {
  private readonly materials: ModelMaterials;
  private model: AuditorModel | null = null;
  private hud: BossHudRefs | null = null;

  private readonly _position = new THREE.Vector3(HIGHWAY_ORIGIN[0], LV.highway + 16, HIGHWAY_ORIGIN[2] + 38);
  private _yaw = Math.PI;
  private _pitch = 0;
  private _roll = 0;

  private _phase: BossPhase = 'idle';
  private _hp: number = GUNSHIP_BOSS_CONSTANTS.maxHp;
  readonly maxHp: number = GUNSHIP_BOSS_CONSTANTS.maxHp;
  private readonly _subsystems: Record<BossSubsystemId, BossSubsystem>;

  // Tracking & damage callback
  private getHumveePos: () => THREE.Vector3 = () => _defaultHumvee;
  private onDamageHumvee: ((amount: number, from?: THREE.Vector3, source?: string) => void) | null = null;

  // Phase & combat timers
  private phaseTime = 0;
  private fireCooldown = 0.6;
  private broadsideSide: 1 | -1 = 1;
  private strafeChinDamage = 0;
  private staggerTimer = 0;
  private overpassSalvoFired = false;
  private overpassLockAlerted = false;
  private deathTimer = 0;
  private deathBurstTimer = 0;
  private smokeTimer = 0;
  private tailSignalled = false;
  private dyingSignalled = false;
  private deadSignalled = false;

  // Active shootable rockets
  private nextRocketId = 1;
  private readonly _rockets: BossRocket[] = [];

  // Audio & emitters
  private rotorLoop: LoopHandle | null = null;
  private turbineLoop: LoopHandle | null = null;
  private tailFireEmitter: EmitterHandle | null = null;
  private tailSmokeEmitter: EmitterHandle | null = null;

  constructor(private readonly ctx: Ctx, private readonly onSignal: (sig: string) => void) {
    this.materials = new ModelMaterials(ctx);
    this._subsystems = this.createSubsystems();
  }

  private createSubsystems(): Record<BossSubsystemId, BossSubsystem> {
    return {
      chin: {
        id: 'chin',
        label: 'CHIN TURRET',
        localOffset: new THREE.Vector3(0, -1.18, 3.8),
        hitRadius: 1.55,
        hp: GUNSHIP_BOSS_CONSTANTS.chinHp,
        maxHp: GUNSHIP_BOSS_CONSTANTS.chinHp,
        destroyed: false,
        hotTimer: 0,
      },
      podL: {
        id: 'podL',
        label: 'PORT POD',
        localOffset: new THREE.Vector3(2.55, -0.62, 1.05),
        hitRadius: 1.5,
        hp: GUNSHIP_BOSS_CONSTANTS.podLHp,
        maxHp: GUNSHIP_BOSS_CONSTANTS.podLHp,
        destroyed: false,
        hotTimer: 0,
      },
      podR: {
        id: 'podR',
        label: 'STBD POD',
        localOffset: new THREE.Vector3(-2.55, -0.62, 1.05),
        hitRadius: 1.5,
        hp: GUNSHIP_BOSS_CONSTANTS.podRHp,
        maxHp: GUNSHIP_BOSS_CONSTANTS.podRHp,
        destroyed: false,
        hotTimer: 0,
      },
      tail: {
        id: 'tail',
        label: 'TAIL ROTOR',
        localOffset: new THREE.Vector3(0, 1.45, -6.5),
        hitRadius: 1.75,
        hp: GUNSHIP_BOSS_CONSTANTS.tailHp,
        maxHp: GUNSHIP_BOSS_CONSTANTS.tailHp,
        destroyed: false,
        hotTimer: 0,
      },
    };
  }

  // ---- Read-only state accessors ----------------------------------------------------------------

  get active(): boolean {
    return this._phase !== 'idle' && this._phase !== 'dead';
  }

  get alive(): boolean {
    return this._phase === 'strafe' || this._phase === 'broadside' || this._phase === 'overpass';
  }

  get hp(): number {
    return this._hp;
  }

  get phase(): BossPhase {
    return this._phase;
  }

  get position(): THREE.Vector3 {
    return this._position;
  }

  get subsystems(): Readonly<Record<BossSubsystemId, BossSubsystem>> {
    return this._subsystems;
  }

  get rockets(): readonly BossRocket[] {
    return this._rockets;
  }

  get staggered(): boolean {
    return this.staggerTimer > 0;
  }

  /** Number of rockets fired in an overpass salvo given surviving pods (4 -> 2 -> 0). */
  get salvoSize(): number {
    const pods = (this._subsystems.podL.destroyed ? 0 : 1) + (this._subsystems.podR.destroyed ? 0 : 1);
    return pods * 2;
  }

  /** Computes the current world-space center of one of the 4 destructible subsystems. */
  getSubsystemWorldCenter(id: BossSubsystemId, out = new THREE.Vector3()): THREE.Vector3 {
    const sub = this._subsystems[id];
    out.copy(sub.localOffset);
    if (this.model) {
      out.applyQuaternion(this.model.root.quaternion).add(this._position);
    } else {
      out.applyAxisAngle(UP, this._yaw).add(this._position);
    }
    return out;
  }

  // ---- Lifecycle & Public Controls --------------------------------------------------------------

  /** Spawns AUDITOR-1 above the Coastal Elevated Expressway tracking the Humvee. */
  spawn(
    getHumveePos: () => THREE.Vector3,
    onDamageHumvee?: (amount: number, from?: THREE.Vector3, source?: string) => void,
  ): void {
    this.ensureBuilt();
    this.clearRockets();
    this.stopEmitters();
    this.stopLoops();

    this.getHumveePos = getHumveePos;
    this.onDamageHumvee = onDamageHumvee ?? null;

    this._hp = this.maxHp;
    this._phase = 'strafe';
    this.phaseTime = 0;
    this.fireCooldown = 0.9;
    this.broadsideSide = 1;
    this.strafeChinDamage = 0;
    this.staggerTimer = 0;
    this.overpassSalvoFired = false;
    this.overpassLockAlerted = false;
    this.deathTimer = 0;
    this.deathBurstTimer = 0;
    this.smokeTimer = 0;
    this.tailSignalled = false;
    this.dyingSignalled = false;
    this.deadSignalled = false;

    // Reset all 4 subsystems
    const fresh = this.createSubsystems();
    for (const id of PIP_ORDER) {
      Object.assign(this._subsystems[id], fresh[id]);
    }

    const hv = this.getHumveePos();
    this._position.set(hv.x, hv.y + 11, hv.z + 26);
    this._yaw = Math.PI; // facing -Z toward Humvee ahead
    this._pitch = -0.14;
    this._roll = 0;

    if (this.model) {
      this.model.root.visible = true;
      this.model.chinGroup.visible = true;
      this.model.podLGroup.visible = true;
      this.model.podRGroup.visible = true;
      this.model.tailGroup.visible = true;
      this.model.searchlightCone.visible = true;
      this.syncModelTransform();
    }

    this.hud?.root.classList.add('on');
    this.updateHud();

    this.ctx.audio?.play?.('boss_intro', { volume: 0.9 });
    this.rotorLoop = this.ctx.audio?.startLoop?.('gunship_rotor_loop', { position: this._position, volume: 0.72, fadeIn: 0.4 }) ?? null;
    this.turbineLoop = this.ctx.audio?.startLoop?.('gunship_turbine_loop', { position: this._position, volume: 0.45, fadeIn: 0.4 }) ?? null;
    this.ctx.hud?.feed?.('AUDITOR-1 ON STATION — TARGET CHIN TURRET, ROCKET PODS & TAIL ROTOR!', '#ff5b4c');
  }

  /** Switches directly into a combat pattern (used internally for cycling and by unit tests). */
  setPhase(next: 'strafe' | 'broadside' | 'overpass'): void {
    if (!this.alive) return;
    this._phase = next;
    this.phaseTime = 0;
    this.fireCooldown = 0.75;
    this.strafeChinDamage = 0;
    this.overpassSalvoFired = false;
    this.overpassLockAlerted = false;
    if (next === 'broadside') {
      this.broadsideSide = this.broadsideSide === 1 ? -1 : 1;
    }
    this.updateHud();
  }

  /**
   * Raycast hit test for `.50 cal` turret shots.
   * Priority order:
   *   1. Active shootable rockets (generous `1.35 m` radius!)
   *   2. The 4 destructible subsystems (`chin`, `podL`, `podR`, `tail`, dealing 1.35x bonus hull damage)
   *   3. Armored fuselage hull
   */
  hitRay(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, damage: number): BossHitResult | null {
    if (!this.active || damage <= 0) return null;

    // 1. Shootable rockets FIRST (even if boss is dying, let players finish intercepting live rockets!)
    let bestRocket: BossRocket | null = null;
    let bestRocketDist = maxDist;
    for (const r of this._rockets) {
      if (!r.alive) continue;
      const d = raySphereDist(origin, dir, r.position, GUNSHIP_BOSS_CONSTANTS.rocketHitRadius, bestRocketDist);
      if (d >= 0 && d < bestRocketDist) {
        bestRocketDist = d;
        bestRocket = r;
      }
    }
    if (bestRocket) {
      _hitPt.copy(origin).addScaledVector(dir, bestRocketDist);
      this.damageRocket(bestRocket, damage, _hitPt);
      return { distance: bestRocketDist, point: _hitPt.clone(), kind: 'rocket' };
    }

    if (!this.alive) return null;

    // 2. The 4 destructible subsystems
    let bestSub: BossSubsystem | null = null;
    let bestSubDist = maxDist;
    for (const id of PIP_ORDER) {
      const sub = this._subsystems[id];
      if (sub.destroyed) continue;
      this.getSubsystemWorldCenter(id, _subWorld);
      const d = raySphereDist(origin, dir, _subWorld, sub.hitRadius, bestSubDist);
      if (d >= 0 && d < bestSubDist) {
        bestSubDist = d;
        bestSub = sub;
      }
    }
    if (bestSub) {
      _hitPt.copy(origin).addScaledVector(dir, bestSubDist);
      this.damageSubsystem(bestSub, damage, _hitPt);
      return { distance: bestSubDist, point: _hitPt.clone(), kind: bestSub.id };
    }

    // 3. Armored fuselage hull
    const hullDist = raySphereDist(origin, dir, this._position, GUNSHIP_BOSS_CONSTANTS.hullHitRadius, maxDist);
    if (hullDist >= 0) {
      _hitPt.copy(origin).addScaledVector(dir, hullDist);
      this.damageHull(damage, _hitPt, false);
      return { distance: hullDist, point: _hitPt.clone(), kind: 'hull' };
    }

    return null;
  }

  /** Launches a live shootable rocket salvo (4 with both pods, 2 with 1 pod, 0 with none). */
  launchRocketSalvo(): number {
    const count = this.salvoSize;
    if (count <= 0) return 0;

    const hv = this.getHumveePos();
    const origins: THREE.Vector3[] = [];
    if (!this._subsystems.podL.destroyed) {
      const pL = this.getSubsystemWorldCenter('podL', new THREE.Vector3());
      origins.push(
        pL.clone().add(new THREE.Vector3(-0.6, 0.35, 0)),
        pL.clone().add(new THREE.Vector3(0.6, -0.45, -1.2)),
      );
    }
    if (!this._subsystems.podR.destroyed) {
      const pR = this.getSubsystemWorldCenter('podR', new THREE.Vector3());
      origins.push(
        pR.clone().add(new THREE.Vector3(-0.6, 0.35, 0)),
        pR.clone().add(new THREE.Vector3(0.6, -0.45, -1.2)),
      );
    }

    const launched = Math.min(count, origins.length);
    for (let i = 0; i < launched; i++) {
      const start = origins[i]!;
      const mesh = buildBossRocketMesh(this.materials);
      mesh.position.copy(start);
      this.ctx.render.scene.add(mesh);

      // Stagger spread slightly so each rocket is visually distinct and shootable
      const spreadX = (i - (launched - 1) / 2) * 0.9;
      const spreadY = 1.45 + (i % 2) * 0.35;
      const travel = GUNSHIP_BOSS_CONSTANTS.rocketTravelSeconds + i * 0.14;
      const vel = new THREE.Vector3(
        (hv.x + spreadX - start.x) / travel,
        (hv.y + spreadY - start.y) / travel,
        (hv.z - start.z) / travel,
      );
      this._rockets.push({
        id: this.nextRocketId++,
        mesh,
        position: start.clone(),
        velocity: vel,
        hp: GUNSHIP_BOSS_CONSTANTS.rocketHp,
        age: 0,
        maxAge: travel + 1.2,
        alive: true,
        smokeTimer: 0,
      });
    }

    this.ctx.audio?.play?.('aa_launch', { position: this._position, volume: 0.9 });
    this.ctx.audio?.play?.('missile_incoming', { volume: 0.78 });
    this.ctx.hud?.feed?.(`AUDITOR-1 LAUNCHED ${launched} ROCKETS — SHOOT THEM DOWN!`, '#ff5b4c');
    return launched;
  }

  /** Per-frame update. */
  update(dt: number): void {
    if (!this.active || dt <= 0) return;
    const step = Math.min(dt, 0.1);

    // Decay HUD hot indicators
    for (const id of PIP_ORDER) {
      const s = this._subsystems[id];
      if (s.hotTimer > 0) s.hotTimer = Math.max(0, s.hotTimer - step);
    }

    if (this._phase === 'dying') {
      this.updateDeathSpiral(step);
    } else if (this.alive) {
      this.updateCombat(step);
    }

    this.updateRockets(step);
    this.updateVisuals(step);
    this.updateHud();
  }

  /** Cleanly removes meshes, rockets, emitters, loops, and hides Boss HUD. */
  clear(): void {
    this.clearRockets();
    this.stopEmitters();
    this.stopLoops();
    this._phase = 'idle';
    this._hp = this.maxHp;
    this.staggerTimer = 0;
    this.tailSignalled = false;
    this.dyingSignalled = false;
    this.deadSignalled = false;
    if (this.model) {
      this.model.root.visible = false;
    }
    this.hud?.root.classList.remove('on');
  }

  reset(): void {
    this.clear();
  }

  // ---- Combat phase choreography ----------------------------------------------------------------

  private updateCombat(dt: number): void {
    this.phaseTime += dt;
    if (this.staggerTimer > 0) {
      this.staggerTimer = Math.max(0, this.staggerTimer - dt);
    }

    const hv = this.getHumveePos();

    if (this._phase === 'strafe') {
      // Rear-chase hover behind & above Humvee (z ≈ +24, y ≈ +11)
      const swayX = Math.sin(this.phaseTime * 1.15) * 6.5;
      _target.set(hv.x + swayX, hv.y + 11.0 + Math.sin(this.phaseTime * 2.1) * 0.8, hv.z + 24.0);
      this.steerToward(_target, hv, dt, 2.2);

      // Twin red tracer sweeps (cancelled while staggered, weakened if chin turret destroyed)
      if (this.staggerTimer <= 0) {
        this.fireCooldown -= dt;
        const rate = this._subsystems.chin.destroyed ? 0.55 : 0.22;
        if (this.fireCooldown <= 0) {
          this.fireCooldown = rate;
          this.fireChinSweep(hv);
        }
      }

      if (this.phaseTime >= GUNSHIP_BOSS_CONSTANTS.strafeDuration) {
        this.setPhase('broadside');
      }
    } else if (this._phase === 'broadside') {
      // Swoop down level beside the expressway railing (x ≈ ±16, y ≈ +4, z ≈ +4)
      _target.set(
        hv.x + this.broadsideSide * 16.0,
        hv.y + 4.0 + Math.sin(this.phaseTime * 2.4) * 0.5,
        hv.z + 4.0 + Math.cos(this.phaseTime * 1.2) * 3.0,
      );
      this.steerToward(_target, hv, dt, 2.6);

      // Turn fuselage broadside (parallel to highway) so cabin door gunners face Humvee
      const broadsideYaw = Math.PI; // fuselage flying alongside Humvee toward -Z
      this._yaw = dampAngle(this._yaw, broadsideYaw, 4.0, dt);

      if (this.staggerTimer <= 0) {
        this.fireCooldown -= dt;
        if (this.fireCooldown <= 0) {
          this.fireCooldown = 0.34;
          this.fireDoorGunners(hv);
        }
      }

      if (this.phaseTime >= GUNSHIP_BOSS_CONSTANTS.broadsideDuration) {
        this.setPhase('overpass');
      }
    } else if (this._phase === 'overpass') {
      const hasPods = this.salvoSize > 0;
      // Overtake Humvee ahead (z ≈ -28, y ≈ +9; or aggressive low pass z ≈ -20, y ≈ +5.5 if pods gone)
      _target.set(
        hv.x + Math.sin(this.phaseTime * 1.4) * 3.5,
        hv.y + (hasPods ? 9.0 : 5.5),
        hv.z - (hasPods ? 28.0 : 20.0),
      );
      this.steerToward(_target, hv, dt, 2.4);

      if (hasPods) {
        if (!this.overpassLockAlerted && this.phaseTime >= 0.35) {
          this.overpassLockAlerted = true;
          this.ctx.audio?.play?.('aa_lock', { position: this._position, volume: 0.85 });
          this.ctx.hud?.feed?.('AUDITOR-1 LOCKING ROCKET PODS!', '#ffae30');
        }
        if (!this.overpassSalvoFired && this.phaseTime >= GUNSHIP_BOSS_CONSTANTS.overpassLockDelay) {
          this.overpassSalvoFired = true;
          this.launchRocketSalvo();
        }
      } else if (this.staggerTimer <= 0) {
        // Both pods gone -> aggressive low nose-gun pass
        this.fireCooldown -= dt;
        if (this.fireCooldown <= 0) {
          this.fireCooldown = 0.28;
          this.fireChinSweep(hv);
        }
      }

      if (this.phaseTime >= GUNSHIP_BOSS_CONSTANTS.overpassDuration) {
        this.setPhase('strafe');
      }
    }

    // Thick smoke trail when tail rotor is damaged
    if (this._subsystems.tail.destroyed) {
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0) {
        this.smokeTimer = 0.12;
        this.getSubsystemWorldCenter('tail', _v);
        this.ctx.fx?.smoke?.(_v, 0x161618, 1.8, 1.6);
        this.ctx.fx?.embers?.(_v, 4, 1.5);
      }
    }
  }

  private steerToward(target: THREE.Vector3, lookAtPos: THREE.Vector3, dt: number, rate: number): void {
    const prevX = this._position.x;
    const prevZ = this._position.z;
    this._position.x = damp(this._position.x, target.x, rate, dt);
    this._position.y = damp(this._position.y, target.y, rate, dt);
    this._position.z = damp(this._position.z, target.z, rate, dt);

    const vx = dt > 1e-5 ? (this._position.x - prevX) / dt : 0;
    const vz = dt > 1e-5 ? (this._position.z - prevZ) / dt : 0;

    // Face Humvee nose-on (+Z local nose -> atan2(dx, dz))
    const dx = lookAtPos.x - this._position.x;
    const dz = lookAtPos.z - this._position.z;
    const desiredYaw = Math.atan2(dx, dz);
    const tailWobble = this._subsystems.tail.destroyed ? Math.sin(this.phaseTime * 6.5) * 0.24 : 0;
    this._yaw = dampAngle(this._yaw, desiredYaw + tailWobble, 3.8, dt);

    const staggerRoll = this.staggerTimer > 0 ? Math.sin(this.staggerTimer * 18) * 0.48 : 0;
    this._roll = damp(this._roll, clamp(-vx * 0.025, -0.35, 0.35) + staggerRoll, 6, dt);
    this._pitch = damp(this._pitch, clamp(vz * 0.015, -0.22, 0.22) + (this._phase === 'overpass' ? 0.14 : 0), 6, dt);
  }

  private fireChinSweep(hv: THREE.Vector3): void {
    this.getSubsystemWorldCenter('chin', _v);
    // Twin sweeping tracer streams across highway lane
    const sweep = Math.sin(this.phaseTime * 3.8) * 3.4;
    for (const side of [-0.45, 0.45]) {
      _v2.set(hv.x + sweep + side + rand(-0.6, 0.6), hv.y + rand(0.7, 2.2), hv.z + rand(-1.5, 1.5));
      this.ctx.fx?.tracer?.(_v, _v2, 'enemy');
    }
    this.ctx.audio?.play?.('gunship_gun', { position: _v, volume: 0.72 });

    // Deal damage when sweep crosses Humvee lane
    const chinBroken = this._subsystems.chin.destroyed;
    if (Math.abs(sweep) < (chinBroken ? 1.1 : 2.1)) {
      const dmg = chinBroken ? 5 : 10;
      this.deliverDamageToHumvee(dmg, _v, 'auditor1_chin');
    }
  }

  private fireDoorGunners(hv: THREE.Vector3): void {
    _v.set(this._position.x - this.broadsideSide * 1.35, this._position.y - 0.1, this._position.z + 0.6);
    _v2.set(hv.x + rand(-1.4, 1.4), hv.y + rand(0.9, 2.2), hv.z + rand(-1.6, 1.6));
    this.ctx.fx?.tracer?.(_v, _v2, 'enemy');
    this.ctx.audio?.play?.('mounted_gun', { position: _v, volume: 0.72 });
    if (Math.random() < 0.6) {
      this.deliverDamageToHumvee(9, _v, 'auditor1_door_gun');
    }
  }

  private deliverDamageToHumvee(amount: number, from: THREE.Vector3, source: string): void {
    if (this.onDamageHumvee) {
      this.onDamageHumvee(amount, from, source);
    } else {
      this.ctx.player?.takeDamage?.({ amount, from, type: 'bullet', source });
    }
  }

  // ---- Damage & Subsystems ----------------------------------------------------------------------

  private damageSubsystem(sub: BossSubsystem, damage: number, hitPt: THREE.Vector3): void {
    sub.hp = Math.max(0, sub.hp - damage);
    sub.hotTimer = 0.65;

    // Track chin damage during strafe to stagger/cancel sweep!
    if (sub.id === 'chin' && this._phase === 'strafe') {
      this.strafeChinDamage += damage;
      if (this.strafeChinDamage >= GUNSHIP_BOSS_CONSTANTS.strafeStaggerThreshold && this.staggerTimer <= 0) {
        this.strafeChinDamage = 0;
        this.staggerTimer = 1.65;
        this.ctx.fx?.sparks?.(hitPt, UP, 18, 0xffbb33);
        this.ctx.hud?.feed?.('CHIN TURRET STAGGERED — SWEEP BROKEN!', '#ffcf56');
      }
    }

    const broke = sub.hp <= 0 && !sub.destroyed;
    if (broke) {
      sub.destroyed = true;
      this.onSubsystemDestroyed(sub, hitPt);
    }

    // Subsystem hits deal 1.35x bonus hull damage!
    const bonusDamage = Math.round(damage * GUNSHIP_BOSS_CONSTANTS.subsystemBonusMult);
    this.damageHull(bonusDamage, hitPt, true, broke);
  }

  private onSubsystemDestroyed(sub: BossSubsystem, hitPt: THREE.Vector3): void {
    this.ctx.fx?.explosion?.(hitPt, { radius: 4.5, kind: 'grenade', scale: 1.05 });
    this.ctx.fx?.sparks?.(hitPt, UP, 22, 0xffaa33);
    this.ctx.render?.lights?.flash?.(hitPt, 0xff8828, 22, 34, 0.4);
    this.ctx.audio?.play?.('plate_destroyed', { position: hitPt, volume: 0.9 });
    this.ctx.audio?.play?.('explosion_small', { position: hitPt, volume: 0.85 });
    this.ctx.camera?.addTrauma?.(0.32);

    if (sub.id === 'chin') {
      if (this.model) this.model.chinGroup.visible = false;
      this.staggerTimer = 2.0;
      this.ctx.hud?.feed?.('AUDITOR-1 CHIN TURRET DESTROYED!', '#7ee787');
    } else if (sub.id === 'podL') {
      if (this.model) this.model.podLGroup.visible = false;
      this.ctx.hud?.feed?.('AUDITOR-1 PORT ROCKET POD DESTROYED!', '#7ee787');
    } else if (sub.id === 'podR') {
      if (this.model) this.model.podRGroup.visible = false;
      this.ctx.hud?.feed?.('AUDITOR-1 STBD ROCKET POD DESTROYED!', '#7ee787');
    } else if (sub.id === 'tail') {
      if (this.model) {
        this.tailSmokeEmitter = this.ctx.fx?.attachEmitter?.(this.model.tailGroup, 'smokeTrail', undefined, 120) ?? null;
        this.tailFireEmitter = this.ctx.fx?.attachEmitter?.(this.model.tailGroup, 'fireTrail', undefined, 120) ?? null;
      }
      this.ctx.hud?.feed?.('AUDITOR-1 TAIL ROTOR CRIPPLED — LOSING STABILITY!', '#ffcf56');
      if (!this.tailSignalled) {
        this.tailSignalled = true;
        this.onSignal('bk:boss_tail_damaged');
      }
    }
  }

  private damageHull(amount: number, hitPt: THREE.Vector3, isWeakpoint: boolean, brokeSub = false): void {
    if (!this.alive || amount <= 0) return;
    this._hp = Math.max(0, this._hp - amount);

    this.ctx.fx?.sparks?.(hitPt, UP, isWeakpoint ? 12 : 6, isWeakpoint ? 0xffcc44 : 0xffaa66);
    this.ctx.hud?.hitMarker?.(this._hp <= 0 || brokeSub ? 'kill' : isWeakpoint ? 'armorThrough' : 'armor');
    this.ctx.audio?.play?.(isWeakpoint ? 'vehicle_weak_point' : 'hit_marker_armor', { position: hitPt, volume: 0.72 });

    if (this._hp <= 0) {
      this.beginDeathSpiral();
    }
    this.updateHud();
  }

  // ---- Shootable Rocket Salvo -------------------------------------------------------------------

  private damageRocket(r: BossRocket, amount: number, hitPt: THREE.Vector3): void {
    r.hp -= amount;
    if (r.hp <= 0 && r.alive) {
      r.alive = false;
      this.ctx.fx?.explosion?.(hitPt, { radius: 3.5, kind: 'rocket', scale: 0.8 });
      this.ctx.audio?.play?.('explosion_small', { position: hitPt, volume: 0.82 });
      this.ctx.hud?.hitMarker?.('kill');
      this.ctx.hud?.feed?.('ROCKET INTERCEPTED!', '#7ee787');
    }
  }

  private updateRockets(dt: number): void {
    const hv = this.getHumveePos();
    for (let i = this._rockets.length - 1; i >= 0; i--) {
      const r = this._rockets[i]!;
      if (!r.alive) {
        r.mesh.removeFromParent();
        this._rockets.splice(i, 1);
        continue;
      }
      r.age += dt;
      // Gentle lateral tracking so rockets converge dramatically on the Humvee
      const dx = hv.x - r.position.x;
      r.velocity.x = damp(r.velocity.x, clamp(dx * 1.2, -7.5, 7.5), 1.5, dt);
      r.position.addScaledVector(r.velocity, dt);
      r.mesh.position.copy(r.position);
      r.mesh.lookAt(r.position.x + r.velocity.x, r.position.y + r.velocity.y, r.position.z + r.velocity.z);

      r.smokeTimer -= dt;
      if (r.smokeTimer <= 0) {
        r.smokeTimer = 0.055;
        this.ctx.fx?.smoke?.(r.position, 0xd8d4cc, 0.65, 0.75);
      }

      const d = r.position.distanceTo(_v.set(hv.x, hv.y + 1.5, hv.z));
      if (d <= 2.45) {
        r.alive = false;
        r.mesh.removeFromParent();
        this._rockets.splice(i, 1);
        this.ctx.fx?.explosion?.(r.position, { radius: 6, kind: 'rocket', scale: 1.15 });
        this.ctx.audio?.play?.('explosion_barrel', { position: r.position, volume: 0.9 });
        this.deliverDamageToHumvee(GUNSHIP_BOSS_CONSTANTS.rocketDamage, r.position, 'auditor1_rocket');
      } else if (r.age >= r.maxAge || r.position.z > hv.z + 32) {
        r.alive = false;
        r.mesh.removeFromParent();
        this._rockets.splice(i, 1);
      }
    }
  }

  // ---- Cinematic 2.8 s Death Spiral -------------------------------------------------------------

  private beginDeathSpiral(): void {
    if (this._phase === 'dying' || this._phase === 'dead') return;
    this._phase = 'dying';
    this.deathTimer = 0;
    this.deathBurstTimer = 0.15;

    this.turbineLoop?.stop(0.4);
    this.turbineLoop = null;
    this.rotorLoop?.setPitch(0.55, 1.8);
    this.ctx.audio?.play?.('gunship_stricken', { position: this._position, volume: 0.95 });
    this.ctx.audio?.play?.('boss_alarm', { volume: 0.75 });
    this.ctx.hud?.feed?.('AUDITOR-1 GOING DOWN — BRACE FOR IMPACT!', '#ffcf56');

    if (this.model) {
      this.model.searchlightCone.visible = false;
    }

    if (!this.dyingSignalled) {
      this.dyingSignalled = true;
      this.onSignal('bk:boss_dying');
    }
    this.updateHud();
  }

  private updateDeathSpiral(dt: number): void {
    this.deathTimer += dt;
    const t = clamp(this.deathTimer / GUNSHIP_BOSS_CONSTANTS.deathSpiralDuration);
    const hv = this.getHumveePos();

    // Spin wildly out of control while dropping onto expressway deck behind/beside Humvee
    this._yaw = wrapAngle(this._yaw + (5.8 + t * 5.2) * dt);
    this._roll = clamp(this._roll + 2.4 * dt, -1.25, 1.25);
    this._pitch = lerp(0.1, 0.58, t);

    const crashX = hv.x + (this._position.x >= hv.x ? 7.5 : -7.5);
    const crashY = LV.highway + 1.6;
    const crashZ = hv.z + 18;
    this._position.x = damp(this._position.x, crashX, 1.4, dt);
    this._position.y = damp(this._position.y, crashY, 1.35 + t * 1.4, dt);
    this._position.z = damp(this._position.z, crashZ, 1.4, dt);

    // Periodic mid-air fire bursts & heavy black smoke
    this.deathBurstTimer -= dt;
    if (this.deathBurstTimer <= 0) {
      this.deathBurstTimer = 0.34;
      _v.copy(this._position).add(new THREE.Vector3(rand(-2.2, 2.2), rand(-0.6, 1.2), rand(-2.5, 2.5)));
      this.ctx.fx?.explosion?.(_v, { radius: 4.5, kind: 'barrel', scale: 0.95 });
      this.ctx.fx?.smoke?.(_v, 0x161514, 2.4, 2.0);
      this.ctx.audio?.play?.('explosion_small', { position: _v, volume: 0.72 });
      this.ctx.camera?.addTrauma?.(0.18);
    }

    if (this.deathTimer >= GUNSHIP_BOSS_CONSTANTS.deathSpiralDuration) {
      this.finishCrash();
    }
  }

  private finishCrash(): void {
    if (this._phase === 'dead') return;
    this._phase = 'dead';
    this.stopEmitters();
    this.stopLoops();

    // Massive overhead gantry crash fireball!
    this.ctx.fx?.explosion?.(this._position, { radius: 14, kind: 'hellfire', scale: 2.3 });
    this.ctx.fx?.smoke?.(this._position, 0x181615, 4.2, 3.2);
    this.ctx.render?.lights?.flash?.(this._position, 0xff8828, 42, 65, 0.7);
    this.ctx.render?.post?.flash?.('#ffb464', 0.55, 0.45);
    this.ctx.audio?.play?.('veh_destroyed', { position: this._position, volume: 1.0 });
    this.ctx.audio?.play?.('boss_death', { volume: 0.95 });
    this.ctx.camera?.addTrauma?.(0.92);
    this.ctx.hud?.feed?.('AUDITOR-1 DESTROYED — STERLING DOWN!', '#7ee787');

    if (this.model) {
      this.model.root.visible = false;
    }
    this.hud?.root.classList.remove('on');

    if (!this.deadSignalled) {
      this.deadSignalled = true;
      this.onSignal('bk:boss_dead');
    }
  }

  // ---- Visuals, HUD & Cleanup -------------------------------------------------------------------

  private ensureBuilt(): void {
    if (!this.model) {
      this.model = buildAuditorModel(this.materials);
      this.model.root.visible = false;
      this.ctx.render.scene.add(this.model.root);
    }
    if (!this.hud) {
      this.hud = createBossHud();
    }
  }

  private updateVisuals(dt: number): void {
    const m = this.model;
    if (!m) return;

    this.syncModelTransform();

    // Spin main & tail rotors
    m.mainRotor.rotation.y += (this._phase === 'dying' ? 11 : 28) * dt;
    m.tailRotor.rotation.x += (this._subsystems.tail.destroyed ? 6 : 52) * dt;

    // Searchlight cone tracks Humvee roof
    if (m.searchlightCone.visible) {
      m.root.updateMatrixWorld();
      const hv = this.getHumveePos();
      _v.set(hv.x, hv.y + 1.4, hv.z);
      m.searchlightCone.lookAt(_v);
    }

    // Pulse red lock-on warning rails during overpass telegraph
    const lockActive = this._phase === 'overpass' && !this.overpassSalvoFired && this.salvoSize > 0;
    const lockOpacity = lockActive ? 0.55 + Math.sin(this.phaseTime * 22) * 0.4 : 0.1;
    for (const rail of m.lockRails) {
      (rail.material as THREE.MeshBasicMaterial).opacity = lockOpacity;
    }

    // Update 3D audio loop positions
    this.rotorLoop?.setPosition(this._position);
    this.turbineLoop?.setPosition(this._position);
  }

  private syncModelTransform(): void {
    if (!this.model) return;
    this.model.root.position.copy(this._position);
    this.model.root.rotation.order = 'YXZ';
    this.model.root.rotation.set(this._pitch, this._yaw, this._roll);
  }

  private updateHud(): void {
    const hud = this.hud;
    if (!hud) return;
    const pct = clamp(this._hp / this.maxHp);
    hud.pct.set(`${Math.ceil(pct * 100)}%`);
    hud.fill.style.transform = `scaleX(${pct.toFixed(4)})`;
    const phaseLabel =
      this._phase === 'overpass' && this.salvoSize === 0
        ? 'PHASE — OVERPASS NOSE PASS'
        : PHASE_LABELS[this._phase];
    hud.phase.set(phaseLabel);

    for (const id of PIP_ORDER) {
      const sub = this._subsystems[id];
      const pip = hud.pips[id];
      pip.classList.toggle('dead', sub.destroyed);
      pip.classList.toggle('hot', !sub.destroyed && (sub.hotTimer > 0 || sub.hp < sub.maxHp * 0.5));
    }
  }

  private clearRockets(): void {
    for (const r of this._rockets) r.mesh.removeFromParent();
    this._rockets.length = 0;
  }

  private stopEmitters(): void {
    this.tailFireEmitter?.stop();
    this.tailFireEmitter = null;
    this.tailSmokeEmitter?.stop();
    this.tailSmokeEmitter = null;
  }

  private stopLoops(): void {
    this.rotorLoop?.stop(0.25);
    this.rotorLoop = null;
    this.turbineLoop?.stop(0.25);
    this.turbineLoop = null;
  }
}
