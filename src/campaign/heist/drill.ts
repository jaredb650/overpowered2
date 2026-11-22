/**
 * Payday-style Bureau Thermal Lance Vault Drill & 20-ton Planetary Vault Door
 * for Mission 4 ("Bank Run").
 *
 * State flow:
 *   idle -> ready (via arm()) -> drilling (95 s) <-> jammed (35% & 72% auto-jams or C4 blast)
 *                                   |-> broken (integrity 0%, $2,500 surcharge, 4.5 s spare deploy)
 *                                   |-> opening (3.2 s lock retraction + -108° hinge swing) -> open
 *
 * SWAT Tech Saboteurs registered via `registerSaboteur()` push toward the drill,
 * plant a 6 s Demolition Charge (C4) when within 2.5 m, and chip drill integrity if unchallenged.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Ctx, LoopHandle } from '../../core/contracts';
import { clamp, rand, smoothstep, TAU } from '../../core/math';
import type { Enemy } from '../../enemies/Enemy';
import { ModelBuilder, ModelMaterials } from '../../progression/modelkit';
import { div, Label, span } from '../../ui/dom';
import {
  DRILL_FLOOR_POS,
  DRILL_POS,
  VAULT_DOOR_HINGE,
  VAULT_DOOR_POS,
  VAULT_DOOR_SIZE,
} from '../../world/map/bank/plan';

export type DrillState = 'idle' | 'ready' | 'drilling' | 'jammed' | 'broken' | 'opening' | 'open';

export const DRILL_DURATION = 95;
export const DRILL_REACH = 3.2;
export const DRILL_REBOOT_HOLD = 2.2;
export const DRILL_DEFUSE_HOLD = 1.4;
export const DRILL_REBUILD_HOLD = 4.5;
export const DRILL_JAM_1 = 0.35;
export const DRILL_JAM_2 = 0.72;
export const DRILL_C4_FUSE = 6.0;
export const DRILL_C4_DAMAGE = 55;
export const DRILL_C4_DEFUSE_REWARD = 500;
export const DRILL_REBUILD_SURCHARGE = 2500;
export const VAULT_OPEN_DURATION = 3.2;
export const VAULT_OPEN_ANGLE = (-108 * Math.PI) / 180;
export const SABOTEUR_PLANT_REACH = 2.5;
export const SABOTEUR_CHIP_REACH = 3.0;
export const SABOTEUR_CHIP_DPS = 3.5;

const BOLT_COUNT = 8;
const BOLT_BASE_RADIUS = 1.98;
const BOLT_RETRACT_DIST = 0.38;
const DOOR_RADIUS = 2.25;
const DOOR_THICKNESS = 0.55;
const DOOR_LOCAL_CENTER_X = VAULT_DOOR_POS[0] - VAULT_DOOR_HINGE[0];
const DOOR_LOCAL_CENTER_Y = VAULT_DOOR_SIZE.height * 0.5;
const C4_REPLANT_COOLDOWN = 7.0;
const SPARK_INTERVAL = 0.09;
const HOLD_TICK_INTERVAL = 0.32;

const TELEMETRY_LINES: readonly string[] = [
  'BUREAU THERMAL LANCE MK-IV // OXYGEN-MAGNESIUM CORE 2,940°C — NOMINAL',
  'TITANIUM-TUNGSTEN BULKHEAD PENETRATION UNDERWAY // KEEP SABOTEURS CLEAR',
  'REMINDER: REPLACEMENT THERMAL BITS ARE DEDUCTED FROM CONTRACTOR PAYOUT',
  'PRESSURE SEAL INTEGRITY DROPPING // VENTING MOLTEN SLAG ON SOUTH FACE',
  'NOTICE: BRINE RESERVE ANTI-TAMPER SENSORS ACTIVE — EXPECT SWAT TECH BREACH',
  'THERMAL EXPANSION WARNING: MANUAL WRENCH REBOOT REQUIRED ON OVERHEAT',
];

const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _drillPos = new THREE.Vector3(DRILL_POS[0], DRILL_POS[1], DRILL_POS[2]);
const _drillFloor = new THREE.Vector3(DRILL_FLOOR_POS[0], DRILL_FLOOR_POS[1], DRILL_FLOOR_POS[2]);
const _doorCenter = new THREE.Vector3(
  VAULT_DOOR_POS[0],
  VAULT_DOOR_POS[1] + VAULT_DOOR_SIZE.height * 0.5,
  VAULT_DOOR_POS[2],
);
const _doorHalfExtents = new THREE.Vector3(
  VAULT_DOOR_SIZE.width * 0.5,
  VAULT_DOOR_SIZE.height * 0.5,
  0.4,
);

interface TrackedSaboteur {
  enemy: Enemy;
  unmark: (() => void) | null;
}

interface DrillHudDom {
  root: HTMLElement;
  phase: Label;
  pct: Label;
  fill: HTMLElement;
  integrityFill: HTMLElement;
  integrityText: Label;
  holdRow: HTMLElement;
  holdFill: HTMLElement;
  holdText: Label;
  clause: Label;
}

function buildVaultDoorSlab(): ModelBuilder {
  const b = new ModelBuilder();
  const steelDark = '#2c323a';
  const steelMid = '#464f5a';
  const steelLight = '#626d7a';
  const brass = '#b88f34';
  const gunmetal = '#1d2228';

  const cx = DOOR_LOCAL_CENTER_X;
  const cy = DOOR_LOCAL_CENTER_Y;

  // Heavy 20-ton circular steel vault slab (cylinder axis along Z).
  b.cyl(DOOR_RADIUS, DOOR_RADIUS, DOOR_THICKNESS, 28, steelMid, {
    at: [cx, cy, 0],
    rot: [Math.PI / 2, 0, 0],
  });
  // Stepped bevelled outer steel flange collar.
  b.cyl(DOOR_RADIUS + 0.12, DOOR_RADIUS + 0.08, 0.24, 28, steelDark, {
    at: [cx, cy, -0.06],
    rot: [Math.PI / 2, 0, 0],
  });
  // Recessed armored front face plate & brushed brass perimeter bezel.
  b.cyl(1.78, 1.85, 0.09, 24, steelDark, {
    at: [cx, cy, DOOR_THICKNESS * 0.5 + 0.02],
    rot: [Math.PI / 2, 0, 0],
  });
  b.solid(new THREE.TorusGeometry(1.88, 0.06, 8, 28), brass, {
    at: [cx, cy, DOOR_THICKNESS * 0.5 + 0.03],
  });
  // Perimeter rivets around the circular steel plate.
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU;
    b.cyl(0.045, 0.05, 0.06, 8, steelLight, {
      at: [cx + Math.cos(a) * 2.04, cy + Math.sin(a) * 2.04, DOOR_THICKNESS * 0.5 + 0.02],
      rot: [Math.PI / 2, 0, 0],
    });
  }
  // Massive industrial crane-hinge spine & knuckles at x = 0 (hinge axis).
  b.cyl(0.24, 0.24, 3.6, 12, gunmetal, { at: [0, cy, 0.16] });
  for (const hy of [-1.25, 0, 1.25]) {
    b.cyl(0.32, 0.32, 0.42, 12, steelLight, { at: [0, cy + hy, 0.16] });
    b.box(0.85, 0.26, 0.28, steelDark, { at: [0.46, cy + hy, 0.2] });
  }
  // Upper & lower armored hinge arms bolting onto the circular slab.
  b.box(1.5, 0.22, 0.18, steelMid, { at: [0.9, cy + 1.15, DOOR_THICKNESS * 0.5 + 0.05] });
  b.box(1.5, 0.22, 0.18, steelMid, { at: [0.9, cy - 1.15, DOOR_THICKNESS * 0.5 + 0.05] });
  // Status lamp housing perched top-right of the front face.
  b.box(0.32, 0.36, 0.16, gunmetal, { at: [cx + 0.92, cy + 1.25, DOOR_THICKNESS * 0.5 + 0.07] });
  return b;
}

function buildLockWheel(): ModelBuilder {
  const b = new ModelBuilder();
  const brass = '#c99c38';
  const brassBright = '#e0b850';
  const steel = '#3a424c';

  // Central spindle hub + outer handwheel torus + 6 radial brushed-brass spokes.
  b.cyl(0.24, 0.28, 0.26, 14, steel, { at: [0, 0, 0], rot: [Math.PI / 2, 0, 0] });
  b.cyl(0.14, 0.14, 0.32, 12, brassBright, { at: [0, 0, 0.04], rot: [Math.PI / 2, 0, 0] });
  b.solid(new THREE.TorusGeometry(0.76, 0.065, 8, 24), brass, { at: [0, 0, 0.1] });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    b.cyl(0.042, 0.042, 0.72, 8, brassBright, {
      at: [Math.cos(a) * 0.38, Math.sin(a) * 0.38, 0.08],
      rot: [0, 0, a - Math.PI / 2],
    });
    // Knurled handgrip pegs protruding from the wheel rim.
    b.cyl(0.036, 0.04, 0.16, 8, steel, {
      at: [Math.cos(a) * 0.76, Math.sin(a) * 0.76, 0.18],
      rot: [Math.PI / 2, 0, 0],
    });
  }
  return b;
}

function buildLockingBolt(): ModelBuilder {
  const b = new ModelBuilder();
  // Heavy solid chrome-steel cylinder extending along +X in its local rotated container.
  b.cyl(0.095, 0.095, 0.62, 10, '#7c8794', { at: [0, 0, 0], rot: [0, 0, Math.PI / 2] });
  b.cyl(0.12, 0.12, 0.1, 10, '#2a3038', { at: [-0.22, 0, 0], rot: [0, 0, Math.PI / 2] });
  return b;
}

function buildDrillChassis(): ModelBuilder {
  const b = new ModelBuilder();
  const yellow = '#e5a817';
  const yellowDark = '#b88210';
  const black = '#1c2025';
  const steel = '#454e59';
  const tankRed = '#a82c22';

  // Main Bureau yellow-and-black thermal lance body (nose points toward -Z into the vault door).
  b.box(0.56, 0.44, 0.88, yellow, { at: [0, 0, 0.18] });
  b.box(0.6, 0.12, 0.84, black, { at: [0, 0.24, 0.18] });
  b.box(0.6, 0.09, 0.86, black, { at: [0, -0.22, 0.18] });
  // Hazard stripe side armor plates.
  for (const sx of [-0.3, 0.3]) {
    b.box(0.04, 0.22, 0.66, black, { at: [sx, 0, 0.18] });
    b.box(0.05, 0.08, 0.62, yellowDark, { at: [sx, 0.04, 0.18] });
  }
  // Twin pressurized oxygen/magnesium fuel canisters flanking the housing.
  for (const sx of [-0.39, 0.39]) {
    b.cyl(0.1, 0.1, 0.68, 10, tankRed, { at: [sx, -0.02, 0.24], rot: [Math.PI / 2, 0, 0] });
    b.cyl(0.07, 0.09, 0.1, 10, steel, { at: [sx, -0.02, -0.13], rot: [Math.PI / 2, 0, 0] });
  }
  // Front collar & heat-shield shroud facing the vault door (-Z).
  b.cyl(0.18, 0.22, 0.22, 12, steel, { at: [0, 0, -0.34], rot: [Math.PI / 2, 0, 0] });
  b.cyl(0.24, 0.24, 0.06, 12, black, { at: [0, 0, -0.24], rot: [Math.PI / 2, 0, 0] });
  // Rear telemetry box + carry handles.
  b.box(0.42, 0.28, 0.16, black, { at: [0, 0.04, 0.68] });
  b.glow(new THREE.PlaneGeometry(0.28, 0.14), '#ffb400', 2.2, { at: [0, 0.06, 0.77] });
  // Beacon pedestal on top.
  b.cyl(0.09, 0.12, 0.12, 10, black, { at: [0, 0.35, 0.18] });
  // Heavy splayed tripod legs reaching down from DRILL_POS (y = -0.05) to floor (y = -1.5 -> delta -1.45 m).
  const legSpecs: readonly (readonly [number, number, number, number, number])[] = [
    [-0.42, -0.74, 0.52, -0.26, 0.28],
    [0.42, -0.74, 0.52, -0.26, -0.28],
    [0, -0.74, -0.18, 0.16, 0],
  ];
  for (const [lx, ly, lz, rx, rz] of legSpecs) {
    b.cyl(0.042, 0.05, 1.56, 8, black, { at: [lx, ly, lz], rot: [rx, 0, rz] });
    b.box(0.16, 0.05, 0.16, yellowDark, { at: [lx * 1.42, -1.42, lz + (rx < 0 ? 0.2 : -0.12)] });
  }
  return b;
}

function buildDrillBit(): ModelBuilder {
  const b = new ModelBuilder();
  const lance = '#7e8996';
  const tip = '#ff8c2e';
  // Rotating fluted auger / thermal lance rod extending toward -Z into the vault door.
  b.cyl(0.055, 0.09, 0.68, 10, lance, { at: [0, 0, -0.34], rot: [Math.PI / 2, 0, 0] });
  for (let i = 0; i < 4; i++) {
    b.box(0.15, 0.035, 0.06, '#30363e', {
      at: [0, 0, -0.14 - i * 0.14],
      rot: [0, 0, i * 0.75],
    });
  }
  b.glow(new THREE.ConeGeometry(0.065, 0.16, 10), tip, 3.6, {
    at: [0, 0, -0.7],
    rot: [-Math.PI / 2, 0, 0],
  });
  return b;
}

function buildC4Pack(): ModelBuilder {
  const b = new ModelBuilder();
  // Compact SWAT demolition brick strapped to the side of the drill.
  b.box(0.12, 0.22, 0.34, '#24292e', { at: [0, 0, 0] });
  b.box(0.135, 0.16, 0.24, '#5e5645', { at: [0, 0, 0] });
  b.box(0.145, 0.04, 0.36, '#14171a', { at: [0, 0.06, 0] });
  b.box(0.145, 0.04, 0.36, '#14171a', { at: [0, -0.06, 0] });
  return b;
}

export class VaultDrill {
  private readonly materials: ModelMaterials;
  private readonly doorPivot: THREE.Group;
  private readonly lockWheel: THREE.Group;
  private readonly lockingBolts: { group: THREE.Group; angle: number }[] = [];
  private readonly statusLampMat: THREE.MeshBasicMaterial;
  private readonly burnRing: THREE.Mesh;
  private readonly burnRingMat: THREE.MeshBasicMaterial;

  private readonly drillRoot: THREE.Group;
  private readonly drillBit: THREE.Group;
  private readonly beaconMat: THREE.MeshBasicMaterial;
  private readonly c4Group: THREE.Group;
  private readonly c4LedMat: THREE.MeshBasicMaterial;

  private doorCollider: RAPIER.Collider | null = null;
  private hudDom: DrillHudDom | null = null;

  private _state: DrillState = 'idle';
  private _progress = 0;
  private _integrity = 100;
  private _bombTimer = 0;
  private _holdProgress = 0;
  private _surchargeTotal = 0;

  private openElapsed = 0;
  private pulseClock = 0;
  private sparkClock = 0;
  private holdTickClock = 0;
  private beepClock = 0;
  private klaxonClock = 0;
  private bombCooldown = 0;
  private activeHoldKind: 'none' | 'reboot' | 'defuse' | 'rebuild' = 'none';

  private plantedSignalled = false;
  private milestone25 = false;
  private milestone50 = false;
  private milestone75 = false;
  private doneSignalled = false;
  private jam1Triggered = false;
  private jam2Triggered = false;

  private drillLoop: LoopHandle | null = null;
  private klaxonLoop: LoopHandle | null = null;
  private markerRemover: (() => void) | null = null;
  private markerMode: 'none' | 'ready' | 'jammed' | 'broken' | 'c4' = 'none';
  private promptRemover: (() => void) | null = null;
  private promptKey = '';

  private readonly saboteurs = new Map<number, TrackedSaboteur>();

  constructor(
    private readonly ctx: Ctx,
    private readonly onSignal: (sig: string) => void,
  ) {
    this.materials = new ModelMaterials(ctx);

    // -----------------------------------------------------------------------
    // 1. 20-ton Circular Planetary Vault Door pivoted around VAULT_DOOR_HINGE
    // -----------------------------------------------------------------------
    this.doorPivot = new THREE.Group();
    this.doorPivot.position.set(VAULT_DOOR_HINGE[0], VAULT_DOOR_HINGE[1], VAULT_DOOR_HINGE[2]);
    this.doorPivot.add(this.materials.group(buildVaultDoorSlab()));

    // Brushed brass/steel spoke lock-wheel on the front (+Z) face
    this.lockWheel = this.materials.group(buildLockWheel());
    this.lockWheel.position.set(
      DOOR_LOCAL_CENTER_X,
      DOOR_LOCAL_CENTER_Y,
      DOOR_THICKNESS * 0.5 + 0.08,
    );
    this.doorPivot.add(this.lockWheel);

    // 8 radial locking bolts around the circular rim
    const boltProto = buildLockingBolt();
    for (let i = 0; i < BOLT_COUNT; i++) {
      const angle = (i / BOLT_COUNT) * TAU;
      const boltGroup = this.materials.group(boltProto);
      boltGroup.rotation.z = angle;
      boltGroup.position.set(
        DOOR_LOCAL_CENTER_X + Math.cos(angle) * BOLT_BASE_RADIUS,
        DOOR_LOCAL_CENTER_Y + Math.sin(angle) * BOLT_BASE_RADIUS,
        0.04,
      );
      this.doorPivot.add(boltGroup);
      this.lockingBolts.push({ group: boltGroup, angle });
    }

    // Glowing red/green status lamp on the front face
    this.statusLampMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ff2e22').multiplyScalar(2.6),
      toneMapped: false,
      fog: false,
    });
    const statusLamp = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), this.statusLampMat);
    statusLamp.position.set(
      DOOR_LOCAL_CENTER_X + 0.92,
      DOOR_LOCAL_CENTER_Y + 1.25,
      DOOR_THICKNESS * 0.5 + 0.16,
    );
    this.doorPivot.add(statusLamp);

    // Glowing expanding burn-ring on the steel vault door where the thermal lance bites
    this.burnRingMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ff6a18').multiplyScalar(3.4),
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false,
      depthWrite: false,
    });
    this.burnRing = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.24, 24), this.burnRingMat);
    this.burnRing.position.set(
      DOOR_LOCAL_CENTER_X,
      DRILL_POS[1] - VAULT_DOOR_HINGE[1],
      DOOR_THICKNESS * 0.5 + 0.075,
    );
    this.burnRing.visible = false;
    this.doorPivot.add(this.burnRing);

    ctx.render.scene.add(this.doorPivot);
    this.ensureDoorCollider();

    // -----------------------------------------------------------------------
    // 2. Bureau Thermal Lance Drill Tripod + Attachable C4 Demolition Pack
    // -----------------------------------------------------------------------
    this.drillRoot = new THREE.Group();
    this.drillRoot.position.copy(_drillPos);
    this.drillRoot.add(this.materials.group(buildDrillChassis()));

    this.drillBit = this.materials.group(buildDrillBit());
    this.drillBit.position.set(0, 0, -0.36);
    this.drillRoot.add(this.drillBit);

    this.beaconMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ffb400').multiplyScalar(3.0),
      toneMapped: false,
      fog: false,
    });
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.16, 10), this.beaconMat);
    beacon.position.set(0, 0.48, 0.18);
    this.drillRoot.add(beacon);

    this.c4Group = new THREE.Group();
    this.c4Group.position.set(0.36, 0.16, 0.18);
    this.c4Group.add(this.materials.group(buildC4Pack()));
    this.c4LedMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ff2211').multiplyScalar(4.0),
      toneMapped: false,
      fog: false,
    });
    const c4Led = new THREE.Mesh(new THREE.SphereGeometry(0.036, 8, 6), this.c4LedMat);
    c4Led.position.set(0.08, 0.08, 0.08);
    this.c4Group.add(c4Led);
    this.c4Group.visible = false;
    this.drillRoot.add(this.c4Group);

    this.drillRoot.visible = false;
    ctx.render.scene.add(this.drillRoot);

    this.hudDom = this.buildHudDom();
  }

  // ---------------------------------------------------------------------------
  // Public state getters
  // ---------------------------------------------------------------------------

  get state(): DrillState {
    return this._state;
  }

  /** Normalized drill completion progress, 0..1. */
  get progress(): number {
    return this._progress;
  }

  /** Drill structural integrity, 0..100. */
  get integrity(): number {
    return this._integrity;
  }

  /** Seconds left on an armed SWAT demolition pack, or 0 when no C4 is active. */
  get bombTimer(): number {
    return this._bombTimer;
  }

  /** Current hold-E progress (0..1) for reboot, C4 defuse, or spare drill rebuild. */
  get holdProgress(): number {
    return this._holdProgress;
  }

  /** Current vault door hinge rotation around Y in radians (0 closed -> -108° open). */
  get doorAngle(): number {
    return this.doorPivot.rotation.y;
  }

  /** True while the static Rapier collider is sealing the vault aperture. */
  get hasCollider(): boolean {
    return this.doorCollider !== null;
  }

  /** Cumulative Bureau equipment replacement surcharge billed when drills are destroyed. */
  get surchargeTotal(): number {
    return this._surchargeTotal;
  }

  /** Count of living tracked SWAT saboteurs. */
  get saboteurCount(): number {
    return this.saboteurs.size;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle & Mission Hooks
  // ---------------------------------------------------------------------------

  /** Transitions from idle to ready so the player can walk up and plant the drill. */
  arm(): void {
    if (this._state === 'opening' || this._state === 'open') return;
    this.ensureDoorCollider();
    this._state = 'ready';
    this.drillRoot.visible = false;
    this.setMarker('ready', 'VAULT DRILL', '#ffb400');
  }

  /** Immediately mounts and starts the Bureau Thermal Lance (used by fast-start / tests). */
  startImmediate(): void {
    this.ensureDoorCollider();
    this.plantDrill();
  }

  /** Immediately opens the vault door and removes its collider (for Act 3 checkpoint restarts). */
  forceOpen(): void {
    this.stopLoops();
    this.clearPrompt();
    this.clearMarker();
    this.clearSaboteurs();
    this.removeDoorCollider();
    this._bombTimer = 0;
    this._holdProgress = 0;
    this.activeHoldKind = 'none';
    this._progress = 1;
    this._state = 'open';
    this.openElapsed = VAULT_OPEN_DURATION;
    this.drillRoot.visible = false;
    this.c4Group.visible = false;
    this.burnRing.visible = false;
    this.doorPivot.rotation.y = VAULT_OPEN_ANGLE;
    this.setBoltRetraction(1);
    this.setLampColor('#3cff7a', 2.8);
    this.setHudVisible(false);
  }

  /** Tracks a SWAT Tech enemy as a saboteur who rushes the drill and plants C4. */
  registerSaboteur(enemy: Enemy): void {
    if (!enemy || !enemy.alive || this.saboteurs.has(enemy.uid)) return;
    const unmark = this.ctx.hud.follow
      ? this.ctx.hud.follow(enemy.position, 'SABOTEUR', '#ffae33')
      : null;
    this.saboteurs.set(enemy.uid, { enemy, unmark });
  }

  /** Applies direct damage to the active thermal drill's integrity (0..100). */
  damageDrill(amount: number, forceJam = false): void {
    if (amount <= 0) return;
    if (this._state !== 'drilling' && this._state !== 'jammed') return;
    this._integrity = clamp(this._integrity - amount, 0, 100);
    if (this._integrity <= 0) {
      this.triggerBroken();
    } else if (forceJam && this._state === 'drilling') {
      this.enterJam(false);
    }
    this.updateHud();
  }

  /** Frame tick. */
  update(dt: number): void {
    if (dt <= 0) return;
    this.pulseClock += dt;
    if (this.bombCooldown > 0) this.bombCooldown = Math.max(0, this.bombCooldown - dt);

    switch (this._state) {
      case 'idle':
      case 'open':
        return;

      case 'ready':
        this.updateReady();
        return;

      case 'drilling':
        this.updateDrilling(dt);
        this.updateSaboteurs(dt);
        this.updateBomb(dt);
        this.updateActiveInteraction(dt);
        this.updateHud();
        return;

      case 'jammed':
        this.updateJammed(dt);
        this.updateSaboteurs(dt);
        this.updateBomb(dt);
        this.updateActiveInteraction(dt);
        this.updateHud();
        return;

      case 'broken':
        this.updateBroken(dt);
        this.updateHud();
        return;

      case 'opening':
        this.updateOpening(dt);
        this.updateHud();
        return;
    }
  }

  /** Cleanly stops loops, removes markers/HUD/collider/saboteurs and resets transient state. */
  clear(): void {
    this.stopLoops();
    this.clearPrompt();
    this.clearMarker();
    this.clearSaboteurs();
    this.removeDoorCollider();

    this._state = 'idle';
    this._progress = 0;
    this._integrity = 100;
    this._bombTimer = 0;
    this._holdProgress = 0;
    this._surchargeTotal = 0;
    this.openElapsed = 0;
    this.pulseClock = 0;
    this.sparkClock = 0;
    this.holdTickClock = 0;
    this.beepClock = 0;
    this.klaxonClock = 0;
    this.bombCooldown = 0;
    this.activeHoldKind = 'none';

    this.plantedSignalled = false;
    this.milestone25 = false;
    this.milestone50 = false;
    this.milestone75 = false;
    this.doneSignalled = false;
    this.jam1Triggered = false;
    this.jam2Triggered = false;

    this.drillRoot.visible = false;
    this.drillRoot.position.copy(_drillPos);
    this.c4Group.visible = false;
    this.burnRing.visible = false;
    this.burnRing.scale.set(1, 1, 1);
    this.doorPivot.rotation.y = 0;
    this.lockWheel.rotation.z = 0;
    this.setBoltRetraction(0);
    this.setLampColor('#ff2e22', 2.6);
    this.setHudVisible(false);
  }

  /** Resets everything back to closed idle state with a fresh sealed vault door collider. */
  reset(): void {
    this.clear();
    this.ensureDoorCollider();
  }

  /** Disposes owned scene objects and HUD DOM elements. */
  dispose(): void {
    this.clear();
    this.doorPivot.removeFromParent();
    this.drillRoot.removeFromParent();
    this.statusLampMat.dispose();
    this.burnRing.geometry.dispose();
    this.burnRingMat.dispose();
    this.beaconMat.dispose();
    this.c4LedMat.dispose();
    this.hudDom?.root.remove();
    this.hudDom = null;
  }

  // ---------------------------------------------------------------------------
  // State Handlers
  // ---------------------------------------------------------------------------

  private isPlayerInReach(): boolean {
    const p = this.ctx.player;
    if (!p?.alive || p.parked) return false;
    const dx = p.position.x - _drillFloor.x;
    const dz = p.position.z - _drillFloor.z;
    const dy = Math.abs(p.position.y - _drillFloor.y);
    return Math.hypot(dx, dz) <= DRILL_REACH && dy <= 3.5;
  }

  private interactKey(): string {
    return (typeof this.ctx.input.labelFor === 'function' ? this.ctx.input.labelFor('interact') : '') || 'E';
  }

  private updateReady(): void {
    if (this.isPlayerInReach()) {
      const key = this.interactKey();
      this.setPrompt('ready', `[${key}] PLANT BUREAU THERMAL DRILL`, '#ffd447');
      if (this.ctx.input.pressed('interact')) {
        this.plantDrill();
      }
    } else {
      this.clearPrompt();
    }
  }

  private plantDrill(): void {
    this.clearPrompt();
    this.clearMarker();
    this._state = 'drilling';
    this._integrity = 100;
    this._bombTimer = 0;
    this._holdProgress = 0;
    this.activeHoldKind = 'none';
    this.drillRoot.visible = true;
    this.drillRoot.position.copy(_drillPos);
    this.c4Group.visible = false;
    this.burnRing.visible = true;
    this.setBeaconColor('#ffb400', 3.0);
    this.setLampColor('#ff7a22', 2.6);
    this.setHudVisible(true);
    this.startDrillLoop();
    this.playSafe('metal_clang', { position: _drillPos, pitch: 0.85, volume: 0.8 });
    this.playSafe('steam_burst', { position: _drillPos, pitch: 1.05, volume: 0.65 });
    this.ctx.hud.feed('BUREAU THERMAL LANCE MOUNTED — DEFEND THE VAULT DRILL!', '#ffb400');

    if (!this.plantedSignalled) {
      this.plantedSignalled = true;
      this.onSignal('bk:drill_planted');
    }
    this.updateHud();
  }

  private updateDrilling(dt: number): void {
    const prev = this._progress;
    let next = clamp(prev + dt / DRILL_DURATION, 0, 1);

    // Trigger scheduled thermal jams cleanly without skipping over them on large timesteps.
    if (!this.jam1Triggered && next >= DRILL_JAM_1) {
      this.jam1Triggered = true;
      this._progress = DRILL_JAM_1;
      this.emitProgressMilestones();
      this.enterJam(true, 'bk:drill_jam1');
      return;
    }
    if (!this.jam2Triggered && next >= DRILL_JAM_2) {
      this.jam2Triggered = true;
      this._progress = DRILL_JAM_2;
      this.emitProgressMilestones();
      this.enterJam(true, 'bk:drill_jam2');
      return;
    }

    this._progress = next;
    this.emitProgressMilestones();

    // Mechanical motion, slag sparks, glowing expanding burn-ring, pulsing orange light.
    this.drillBit.rotation.z += dt * 36;
    this.drillRoot.position.set(
      _drillPos.x + Math.sin(this.pulseClock * 68) * 0.008,
      _drillPos.y + Math.cos(this.pulseClock * 59) * 0.008,
      _drillPos.z,
    );
    const ringScale = 0.65 + this._progress * 1.95;
    this.burnRing.visible = true;
    this.burnRing.scale.set(ringScale, ringScale, 1);
    const glowPulse = 2.6 + Math.sin(this.pulseClock * 18) * 0.7;
    this.burnRingMat.color.set('#ff6a18').multiplyScalar(glowPulse);
    this.setBeaconColor('#ffb400', 2.4 + Math.sin(this.pulseClock * 8) * 0.6);

    this.sparkClock += dt;
    if (this.sparkClock >= SPARK_INTERVAL) {
      this.sparkClock -= SPARK_INTERVAL;
      _v.set(_drillPos.x, _drillPos.y, _drillPos.z - 0.56);
      _dir.set(rand(-0.55, 0.55), rand(-0.25, 0.45), 1).normalize();
      this.ctx.fx.sparks(_v, _dir, 7, '#ffaa33');
      this.ctx.render.lights.flash(_v, '#ff7b24', 9 + rand(0, 4), 10, 0.12);
    }

    if (this._progress >= 1) {
      this.beginOpening();
    }
  }

  private emitProgressMilestones(): void {
    if (!this.milestone25 && this._progress >= 0.25) {
      this.milestone25 = true;
      this.onSignal('bk:drill_25');
    }
    if (!this.milestone50 && this._progress >= 0.5) {
      this.milestone50 = true;
      this.onSignal('bk:drill_50');
    }
    if (!this.milestone75 && this._progress >= 0.75) {
      this.milestone75 = true;
      this.onSignal('bk:drill_75');
    }
  }

  private enterJam(fromOverheat: boolean, signal?: string): void {
    this._state = 'jammed';
    this.stopDrillLoop();
    this.startKlaxonLoop();
    this.drillRoot.position.copy(_drillPos);
    this.setLampColor('#ff2418', 3.4);
    this.setMarker('jammed', 'DRILL JAMMED', '#ff4433');
    this.playSafe('steam_burst', { position: _drillPos, pitch: 0.75, volume: 0.75 });
    this.playSafe('ui_error', { volume: 0.7 });
    this.ctx.fx.smoke(_drillPos, '#555b63', 1.4, 1.4);
    if (fromOverheat) {
      this.ctx.hud.feed('THERMAL OVERHEAT — REBOOT THE VAULT DRILL!', '#ff5544');
    } else {
      this.ctx.hud.feed('DRILL KNOCKED OFFLINE — REBOOT REQUIRED!', '#ff5544');
    }
    if (signal) this.onSignal(signal);
  }

  private updateJammed(dt: number): void {
    const flash = Math.sin(this.pulseClock * 14) > 0;
    this.setBeaconColor(flash ? '#ff2418' : '#4a0d0a', flash ? 4.2 : 1.0);
    if (flash) {
      this.ctx.render.lights.flash(_v.set(_drillPos.x, _drillPos.y + 0.5, _drillPos.z), '#ff2218', 7, 9, 0.08);
    }
    // Periodic klaxon pulse if audio system lacks looped alarm_klaxon.
    if (!this.klaxonLoop?.alive) {
      this.klaxonClock += dt;
      if (this.klaxonClock >= 1.8) {
        this.klaxonClock = 0;
        this.playSafe('ui_error', { position: _drillPos, pitch: 0.8, volume: 0.45 });
      }
    }
  }

  private triggerBroken(): void {
    this._state = 'broken';
    this._integrity = 0;
    this._bombTimer = 0;
    this._holdProgress = 0;
    this.activeHoldKind = 'none';
    this._surchargeTotal += DRILL_REBUILD_SURCHARGE;

    this.stopLoops();
    this.drillRoot.visible = false;
    this.c4Group.visible = false;
    this.setLampColor('#ff2218', 3.4);
    this.setMarker('broken', 'DEPLOY SPARE DRILL', '#ff5544');

    this.ctx.fx.explosion(_drillPos, { radius: 3.5, kind: 'grenade' });
    this.ctx.fx.sparks(_drillPos, _dir.set(0, 0.6, 1).normalize(), 24, '#ff7a22');
    this.playSafe('explosion_small', { position: _drillPos, volume: 0.85 });
    this.ctx.camera.addTrauma(0.5);

    this.ctx.hud.feed('DRILL DESTROYED — $2,500 BUREAU EQUIPMENT SURCHARGE', '#ff4d3d');
    this.ctx.hud.banner?.('DRILL DESTROYED', '$2,500 BUREAU EQUIPMENT SURCHARGE', '#ff4d3d');
  }

  private updateBroken(dt: number): void {
    this.updateSaboteurs(dt);
    const inReach = this.isPlayerInReach();
    if (!inReach) {
      this.resetHold();
      this.clearPrompt();
      return;
    }

    const key = this.interactKey();
    const pct = Math.round(this._holdProgress * 100);
    const label = this._holdProgress > 0
      ? `DEPLOYING SPARE DRILL (${pct}%)`
      : `HOLD [${key}] DEPLOY SPARE BUREAU DRILL (4.5s)`;
    this.setPrompt(`rebuild:${pct}`, label, '#ffaa33');

    if (this.ctx.input.isDown('interact')) {
      this.activeHoldKind = 'rebuild';
      this._holdProgress = clamp(this._holdProgress + dt / DRILL_REBUILD_HOLD, 0, 1);
      this.ctx.hud.hold?.(this._holdProgress);
      this.tickHoldFoley(dt, 0.8);
      if (this._holdProgress >= 1) {
        this.completeRebuild();
      }
    } else {
      this.resetHold();
    }
  }

  private completeRebuild(): void {
    this.resetHold();
    this.clearPrompt();
    this.clearMarker();
    this._integrity = 100;
    this._state = 'drilling';
    this.drillRoot.visible = true;
    this.drillRoot.position.copy(_drillPos);
    this.c4Group.visible = false;
    this.setBeaconColor('#ffb400', 3.0);
    this.setLampColor('#ff7a22', 2.6);
    this.startDrillLoop();
    this.playSafe('metal_clang', { position: _drillPos, pitch: 0.9, volume: 0.85 });
    this.playSafe('steam_burst', { position: _drillPos, pitch: 1.0, volume: 0.7 });
    this.ctx.hud.hold?.(1);
    this.ctx.hud.feed(
      `SPARE THERMAL DRILL ONLINE — RESUMING AT ${Math.round(this._progress * 100)}%`,
      '#7ee787',
    );
  }

  // ---------------------------------------------------------------------------
  // Saboteurs & C4 Demolition Charge
  // ---------------------------------------------------------------------------

  private updateSaboteurs(dt: number): void {
    for (const [uid, entry] of this.saboteurs) {
      const e = entry.enemy;
      if (!e.alive || e.health <= 0) {
        entry.unmark?.();
        this.saboteurs.delete(uid);
        continue;
      }

      // Steer living saboteurs directly toward the vault drill.
      e.mode = 'point';
      e.moveTarget.copy(_drillFloor);
      e.face = 'move';
      e.flowUntil = 0;
      if (e.pace < 1.05) e.pace = 1.05;

      if (this._state !== 'drilling' && this._state !== 'jammed') continue;

      const d = Math.hypot(e.position.x - _drillFloor.x, e.position.z - _drillFloor.z);
      const dy = Math.abs(e.position.y - _drillFloor.y);

      if (d <= SABOTEUR_PLANT_REACH && dy <= 3.0 && this._bombTimer <= 0 && this.bombCooldown <= 0) {
        this.plantC4();
      } else if (d <= SABOTEUR_CHIP_REACH && dy <= 3.0) {
        // Unchallenged saboteurs wrench/chip away at the drill chassis slowly.
        this.damageDrill(SABOTEUR_CHIP_DPS * dt, false);
        if (this._integrity <= 0) return;
      }
    }
  }

  private plantC4(): void {
    this._bombTimer = DRILL_C4_FUSE;
    this.beepClock = 0;
    this.c4Group.visible = true;
    this.setMarker('c4', 'DEFUSE C4!', '#ff2e22');
    this.playSafe('bomber_beep', { position: _drillPos, pitch: 1.1, volume: 0.85 });
    this.ctx.hud.feed('SWAT SABOTEUR PLANTED C4 ON DRILL — HOLD [E] TO DEFUSE!', '#ff3b30');
    this.onSignal('bk:saboteur_c4');
  }

  private updateBomb(dt: number): void {
    if (this._bombTimer <= 0) return;

    this._bombTimer = Math.max(0, this._bombTimer - dt);
    const urgency = 1 - this._bombTimer / DRILL_C4_FUSE;
    const beepInterval = Math.max(0.14, 0.65 - urgency * 0.5);
    this.beepClock += dt;
    if (this.beepClock >= beepInterval) {
      this.beepClock = 0;
      this.playSafe('bomber_beep', { position: _drillPos, pitch: 1.0 + urgency * 0.6, volume: 0.75 });
      this.ctx.render.lights.flash(_drillPos, '#ff1f14', 10, 10, 0.08);
    }

    const blink = Math.sin(this.pulseClock * (12 + urgency * 24)) > 0;
    this.c4LedMat.color.set(blink ? '#ff2211' : '#3a0808').multiplyScalar(blink ? 4.6 : 1.0);

    if (this._bombTimer <= 0) {
      this.detonateC4();
    }
  }

  private detonateC4(): void {
    this._bombTimer = 0;
    this.bombCooldown = C4_REPLANT_COOLDOWN;
    this.c4Group.visible = false;
    if (this.activeHoldKind === 'defuse') this.resetHold();

    this.ctx.fx.explosion(_drillPos, { radius: 4.5, kind: 'grenade' });
    this.ctx.fx.sparks(_drillPos, _dir.set(0, 0.5, 1).normalize(), 32, '#ff8822');
    this.ctx.render.lights.flash(_drillPos, '#ff6618', 26, 28, 0.35);
    this.playSafe('explosion_barrel', { position: _drillPos, volume: 0.9 });
    this.ctx.camera.addTrauma(0.65);

    this.ctx.hud.feed('SABOTEUR C4 DETONATED ON VAULT DRILL!', '#ff3b30');
    this.damageDrill(DRILL_C4_DAMAGE, true);
  }

  private updateActiveInteraction(dt: number): void {
    const needsDefuse = this._bombTimer > 0;
    const needsReboot = !needsDefuse && this._state === 'jammed';

    if (!needsDefuse && !needsReboot) {
      this.resetHold();
      this.clearPrompt();
      return;
    }

    if (!this.isPlayerInReach()) {
      this.resetHold();
      this.clearPrompt();
      return;
    }

    const key = this.interactKey();
    if (needsDefuse) {
      if (this.activeHoldKind !== 'defuse') {
        this._holdProgress = 0;
        this.activeHoldKind = 'defuse';
      }
      const pct = Math.round(this._holdProgress * 100);
      const text = this._holdProgress > 0
        ? `DEFUSING C4 (${pct}%) — ${this._bombTimer.toFixed(1)}s`
        : `HOLD [${key}] DEFUSE C4 (${this._bombTimer.toFixed(1)}s)`;
      this.setPrompt(`defuse:${pct}:${Math.ceil(this._bombTimer * 5)}`, text, '#ff4d3d');

      if (this.ctx.input.isDown('interact')) {
        this._holdProgress = clamp(this._holdProgress + dt / DRILL_DEFUSE_HOLD, 0, 1);
        this.ctx.hud.hold?.(this._holdProgress);
        this.tickHoldFoley(dt, 1.35);
        if (this._holdProgress >= 1) {
          this.completeDefuse();
        }
      } else {
        this._holdProgress = 0;
        this.holdTickClock = 0;
      }
      return;
    }

    // Jam reboot hold (2.2 s)
    if (this.activeHoldKind !== 'reboot') {
      this._holdProgress = 0;
      this.activeHoldKind = 'reboot';
    }
    const pct = Math.round(this._holdProgress * 100);
    const text = this._holdProgress > 0
      ? `REBOOTING DRILL (${pct}%)`
      : `HOLD [${key}] REBOOT THERMAL DRILL`;
    this.setPrompt(`reboot:${pct}`, text, '#ffd447');

    if (this.ctx.input.isDown('interact')) {
      this._holdProgress = clamp(this._holdProgress + dt / DRILL_REBOOT_HOLD, 0, 1);
      this.ctx.hud.hold?.(this._holdProgress);
      this.tickHoldFoley(dt, 1.0);
      if (this._holdProgress >= 1) {
        this.completeReboot();
      }
    } else {
      this._holdProgress = 0;
      this.holdTickClock = 0;
    }
  }

  private completeDefuse(): void {
    this.resetHold();
    this.clearPrompt();
    this._bombTimer = 0;
    this.bombCooldown = C4_REPLANT_COOLDOWN;
    this.c4Group.visible = false;

    if (this._state === 'jammed') {
      this.setMarker('jammed', 'DRILL JAMMED', '#ff4433');
    } else {
      this.clearMarker();
    }

    this.playSafe('ui_confirm', { volume: 0.85 });
    this.playSafe('metal_clang', { position: _drillPos, pitch: 1.35, volume: 0.65 });
    this.ctx.hud.hold?.(1);
    this.ctx.progression?.award?.(DRILL_C4_DEFUSE_REWARD, 'C4 DEFUSED', _drillPos);
    this.ctx.hud.feed(`C4 DEFUSED (+$${DRILL_C4_DEFUSE_REWARD})`, '#7ee787');
  }

  private completeReboot(): void {
    this.resetHold();
    this.clearPrompt();
    this.clearMarker();
    this.stopKlaxonLoop();
    this._state = 'drilling';
    this.setBeaconColor('#ffb400', 3.0);
    this.setLampColor('#ff7a22', 2.6);
    this.startDrillLoop();
    this.playSafe('metal_clang', { position: _drillPos, pitch: 1.15, volume: 0.8 });
    this.playSafe('steam_burst', { position: _drillPos, pitch: 1.15, volume: 0.65 });
    this.ctx.hud.hold?.(1);
    this.ctx.hud.feed('THERMAL LANCE REBOOTED — DRILLING RESUMED', '#7ee787');
  }

  // ---------------------------------------------------------------------------
  // Vault Door Opening Animation
  // ---------------------------------------------------------------------------

  private beginOpening(): void {
    this._state = 'opening';
    this._progress = 1;
    this._bombTimer = 0;
    this.resetHold();
    this.clearPrompt();
    this.clearMarker();
    this.stopLoops();
    this.removeDoorCollider();

    this.openElapsed = 0;
    this.drillRoot.visible = false;
    this.c4Group.visible = false;
    this.setLampColor('#3cff7a', 3.2);

    this.playSafe('steam_burst', { position: _doorCenter, pitch: 0.72, volume: 0.95 });
    this.playSafe('metal_groan', { position: _doorCenter, pitch: 0.68, volume: 0.95 });
    this.ctx.fx.sparks(_drillPos, _dir.set(0, 0.4, 1).normalize(), 36, '#ffd447');
    this.ctx.fx.smoke(_drillPos, '#cfd6de', 2.4, 2.2);
    this.ctx.render.lights.flash(_doorCenter, '#7ee787', 16, 18, 0.55);
    this.ctx.camera.addTrauma(0.35);
    this.ctx.hud.feed('VAULT BREACHED — 20-TON PLANETARY DOOR OPENING!', '#7ee787');

    if (!this.doneSignalled) {
      this.doneSignalled = true;
      this.onSignal('bk:drill_done');
    }
  }

  private updateOpening(dt: number): void {
    this.openElapsed += dt;
    const t = this.openElapsed;

    // Spin lock-wheel rapidly during the unlocking phase, then coast to a stop.
    const wheelSpin = t < 1.1 ? 14 : Math.max(0, 14 * (1 - (t - 1.1) / 0.8));
    this.lockWheel.rotation.z += wheelSpin * dt;

    // Retract all 8 radial locking bolts smoothly inward during the first 0.95 s.
    const retract = smoothstep(0.05, 0.95, t);
    this.setBoltRetraction(retract);

    // Swing the 20-ton door smoothly from 0° to -108° around hinge Y over 3.2 s.
    const swing = smoothstep(0.4, VAULT_OPEN_DURATION, t);
    this.doorPivot.rotation.y = VAULT_OPEN_ANGLE * swing;

    // Cool down burn ring while door opens.
    this.burnRingMat.opacity = Math.max(0, 0.9 * (1 - t / 2.2));
    if (this.burnRingMat.opacity <= 0.01) this.burnRing.visible = false;

    this.sparkClock += dt;
    if (t < 1.4 && this.sparkClock >= 0.22) {
      this.sparkClock = 0;
      this.ctx.fx.smoke(_doorCenter, '#d2d9e0', 1.6, 1.5);
      this.ctx.fx.sparks(_doorCenter, _dir.set(rand(-0.6, 0.6), 0.3, 1).normalize(), 8, '#ffbe55');
    }

    if (this.openElapsed >= VAULT_OPEN_DURATION) {
      this.doorPivot.rotation.y = VAULT_OPEN_ANGLE;
      this.setBoltRetraction(1);
      this.burnRing.visible = false;
      this._state = 'open';
      this.setHudVisible(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Physics & Visual Helpers
  // ---------------------------------------------------------------------------

  private ensureDoorCollider(): void {
    if (this.doorCollider) return;
    const phys = this.ctx.physics;
    if (!phys || typeof phys.addStaticBox !== 'function') return;
    this.doorCollider = phys.addStaticBox(_doorCenter, _doorHalfExtents, null, 'metal');
    phys.markNoClimb?.(this.doorCollider);
  }

  private removeDoorCollider(): void {
    if (!this.doorCollider) return;
    const world = this.ctx.physics?.world;
    if (world && typeof world.removeCollider === 'function') {
      world.removeCollider(this.doorCollider, true);
    }
    this.doorCollider = null;
  }

  private setBoltRetraction(frac: number): void {
    const r = BOLT_BASE_RADIUS - clamp(frac, 0, 1) * BOLT_RETRACT_DIST;
    for (const bolt of this.lockingBolts) {
      bolt.group.position.set(
        DOOR_LOCAL_CENTER_X + Math.cos(bolt.angle) * r,
        DOOR_LOCAL_CENTER_Y + Math.sin(bolt.angle) * r,
        0.04,
      );
    }
  }

  private setLampColor(hex: string, boost: number): void {
    this.statusLampMat.color.set(hex).multiplyScalar(boost);
  }

  private setBeaconColor(hex: string, boost: number): void {
    this.beaconMat.color.set(hex).multiplyScalar(boost);
  }

  private resetHold(): void {
    this._holdProgress = 0;
    this.holdTickClock = 0;
    this.activeHoldKind = 'none';
  }

  private tickHoldFoley(dt: number, pitchBase: number): void {
    this.holdTickClock += dt;
    if (this.holdTickClock >= HOLD_TICK_INTERVAL) {
      this.holdTickClock -= HOLD_TICK_INTERVAL;
      this.playSafe('metal_clang', {
        position: _drillPos,
        pitch: pitchBase + this._holdProgress * 0.4,
        volume: 0.42,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Audio Helpers (graceful catalog checks)
  // ---------------------------------------------------------------------------

  private hasSound(id: string): boolean {
    const audio = this.ctx.audio;
    if (!audio) return false;
    return typeof audio.has === 'function' ? audio.has(id) : true;
  }

  private playSafe(id: string, opts?: { position?: THREE.Vector3; pitch?: number; volume?: number }): void {
    if (!this.ctx.audio?.play || !this.hasSound(id)) return;
    this.ctx.audio.play(id, opts);
  }

  private startDrillLoop(): void {
    if (this.drillLoop?.alive) return;
    const audio = this.ctx.audio;
    if (!audio || typeof audio.startLoop !== 'function') return;
    const id = this.hasSound('electric_buzz_loop')
      ? 'electric_buzz_loop'
      : this.hasSound('barrel_hiss_loop')
        ? 'barrel_hiss_loop'
        : this.hasSound('flame_burn_loop')
          ? 'flame_burn_loop'
          : null;
    if (!id) return;
    this.drillLoop = audio.startLoop(id, { position: _drillPos, volume: 0.65, pitch: 0.92 });
  }

  private stopDrillLoop(): void {
    this.drillLoop?.stop(0.15);
    this.drillLoop = null;
  }

  private startKlaxonLoop(): void {
    if (this.klaxonLoop?.alive) return;
    const audio = this.ctx.audio;
    if (!audio || typeof audio.startLoop !== 'function') return;
    if (!this.hasSound('alarm_klaxon')) return;
    this.klaxonLoop = audio.startLoop('alarm_klaxon', { position: _drillPos, volume: 0.45, pitch: 1.05 });
  }

  private stopKlaxonLoop(): void {
    this.klaxonLoop?.stop(0.15);
    this.klaxonLoop = null;
  }

  private stopLoops(): void {
    this.stopDrillLoop();
    this.stopKlaxonLoop();
  }

  // ---------------------------------------------------------------------------
  // Markers, Prompts & Saboteur Cleanup
  // ---------------------------------------------------------------------------

  private setMarker(mode: 'ready' | 'jammed' | 'broken' | 'c4', label: string, color: string): void {
    if (this.markerMode === mode) return;
    this.clearMarker();
    this.markerMode = mode;
    if (this.ctx.hud?.marker) {
      this.markerRemover = this.ctx.hud.marker(
        new THREE.Vector3(_drillFloor.x, _drillFloor.y + 2.2, _drillFloor.z),
        label,
        color,
      );
    }
  }

  private clearMarker(): void {
    this.markerRemover?.();
    this.markerRemover = null;
    this.markerMode = 'none';
  }

  private setPrompt(key: string, label: string, color: string): void {
    if (this.promptKey === key) return;
    this.clearPrompt();
    this.promptKey = key;
    if (this.ctx.hud?.follow) {
      this.promptRemover = this.ctx.hud.follow(
        new THREE.Vector3(_drillPos.x, _drillPos.y + 0.95, _drillPos.z),
        label,
        color,
      );
    }
  }

  private clearPrompt(): void {
    this.promptRemover?.();
    this.promptRemover = null;
    this.promptKey = '';
  }

  private clearSaboteurs(): void {
    for (const entry of this.saboteurs.values()) {
      entry.unmark?.();
    }
    this.saboteurs.clear();
  }

  // ---------------------------------------------------------------------------
  // Top-Center Vault Drill HUD (.fc-bar.bk-drill)
  // ---------------------------------------------------------------------------

  private buildHudDom(): DrillHudDom | null {
    if (typeof document === 'undefined') return null;

    const titleEl = span('fc-title', 'BUREAU THERMAL LANCE');
    const phaseEl = span('fc-phase', 'CUTTING VAULT DOOR');
    const pctEl = span('fc-pct', '0%');
    const fill = div('fc-fill');

    // Integrity sub-bar styled cleanly inline to pair with .fc-bar without CSS edits
    const integrityFill = div('bk-drill-int-fill');
    integrityFill.style.cssText =
      'height:100%;width:100%;background:#7ee787;transform-origin:0 50%;transform:scaleX(1);transition:transform 0.12s linear;';
    const integrityTrack = div('bk-drill-int-track', integrityFill);
    integrityTrack.style.cssText =
      'flex:1;height:0.28rem;background:rgba(0,0,0,0.65);border:0.06rem solid rgba(255,255,255,0.12);overflow:hidden;';
    const integrityTextEl = span('bk-drill-int-val', 'INTEGRITY 100%');
    integrityTextEl.style.cssText = 'font-size:0.72rem;letter-spacing:0.07em;color:rgba(230,240,236,0.85);';
    const integrityRow = div('bk-drill-int-row', integrityTextEl, integrityTrack);
    integrityRow.style.cssText = 'display:flex;align-items:center;gap:0.55rem;margin-top:0.3rem;';

    // Hold progress sub-bar shown while wrench-rebooting, defusing C4, or deploying spare drill
    const holdFill = div('bk-drill-hold-fill');
    holdFill.style.cssText =
      'height:100%;width:100%;background:#ffd447;transform-origin:0 50%;transform:scaleX(0);';
    const holdTrack = div('bk-drill-hold-track', holdFill);
    holdTrack.style.cssText =
      'flex:1;height:0.32rem;background:rgba(0,0,0,0.7);border:0.06rem solid rgba(255,212,71,0.35);overflow:hidden;';
    const holdTextEl = span('bk-drill-hold-val', '');
    holdTextEl.style.cssText = 'font-size:0.74rem;font-weight:700;letter-spacing:0.06em;color:#ffd447;';
    const holdRow = div('bk-drill-hold-row', holdTextEl, holdTrack);
    holdRow.style.cssText = 'display:none;align-items:center;gap:0.55rem;margin-top:0.32rem;';

    const clauseEl = div('fc-clause');
    const root = div(
      'fc-bar bk-drill',
      div('fc-head', titleEl, phaseEl, pctEl),
      div('fc-track', fill),
      integrityRow,
      holdRow,
      clauseEl,
    );

    const mount = document.querySelector('.hud') ?? document.getElementById('ui') ?? document.body;
    mount?.append(root);

    return {
      root,
      phase: new Label(phaseEl),
      pct: new Label(pctEl),
      fill,
      integrityFill,
      integrityText: new Label(integrityTextEl),
      holdRow,
      holdFill,
      holdText: new Label(holdTextEl),
      clause: new Label(clauseEl),
    };
  }

  private setHudVisible(on: boolean): void {
    if (!this.hudDom) return;
    this.hudDom.root.classList.toggle('on', on);
  }

  private updateHud(): void {
    const dom = this.hudDom;
    if (!dom) return;

    const pct = clamp(this._progress, 0, 1);
    dom.pct.set(`${Math.floor(pct * 100)}%`);
    dom.fill.style.transform = `scaleX(${pct.toFixed(4)})`;

    const intFrac = clamp(this._integrity / 100, 0, 1);
    dom.integrityFill.style.transform = `scaleX(${intFrac.toFixed(4)})`;
    dom.integrityFill.style.background =
      intFrac > 0.55 ? '#7ee787' : intFrac > 0.25 ? '#ffb400' : '#ff4433';
    dom.integrityText.set(`INTEGRITY ${Math.ceil(this._integrity)}%`);

    if (this._bombTimer > 0) {
      dom.phase.set(`C4 ARMED — DEFUSE (${this._bombTimer.toFixed(1)}s)!`);
      dom.root.style.borderTopColor = '#ff3b30';
      dom.clause.set('ALERT: SWAT DEMOLITION PACK DETECTED ON DRILL CHASSIS — HOLD [E] TO DEFUSE!');
    } else if (this._state === 'jammed') {
      dom.phase.set('THERMAL OVERHEAT — REBOOT DRILL');
      dom.root.style.borderTopColor = '#ff4433';
      dom.clause.set('WARNING: LANCE OVERHEATED — APPROACH VAULT DOOR AND HOLD [E] TO WRENCH-REBOOT');
    } else if (this._state === 'broken') {
      dom.phase.set('DRILL DESTROYED — DEPLOY SPARE');
      dom.root.style.borderTopColor = '#ff3b30';
      dom.clause.set(`$2,500 BUREAU EQUIPMENT SURCHARGE BILLED — HOLD [E] TO MOUNT SPARE DRILL`);
    } else if (this._state === 'opening') {
      dom.phase.set('VAULT LOCKS RETRACTING');
      dom.root.style.borderTopColor = '#7ee787';
      dom.clause.set('PENETRATION COMPLETE — STAND CLEAR OF 20-TON PLANETARY DOOR SWING');
    } else {
      dom.phase.set('CUTTING 20-TON VAULT DOOR');
      dom.root.style.borderTopColor = '';
      const idx = Math.floor(this.pulseClock / 7.5) % TELEMETRY_LINES.length;
      dom.clause.set(TELEMETRY_LINES[idx]!);
    }

    if (this._holdProgress > 0 && this.activeHoldKind !== 'none') {
      dom.holdRow.style.display = 'flex';
      dom.holdFill.style.transform = `scaleX(${this._holdProgress.toFixed(4)})`;
      const actionLabel =
        this.activeHoldKind === 'defuse'
          ? 'DEFUSING C4'
          : this.activeHoldKind === 'rebuild'
            ? 'DEPLOYING SPARE DRILL'
            : 'REBOOTING DRILL';
      dom.holdText.set(`${actionLabel} ${Math.round(this._holdProgress * 100)}%`);
    } else {
      dom.holdRow.style.display = 'none';
    }
  }
}
