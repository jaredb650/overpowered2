/**
 * Crossfire Part 1 Runtime Director — "Valken Airbase" (`map: 'airbase'`, Contractor #7712-A).
 *
 * Handles all 9 Part 1 `cf.*` mission director calls:
 *   - `cf.airbaseInit`
 *   - `cf.airbaseBreach`
 *   - `cf.apronFuelWatch`
 *   - `cf.atcConsole`
 *   - `cf.buddyRaptorsBoard`
 *   - `cf.lancerReady`
 *   - `cf.buddyRaptorsTakeoff`
 *   - `cf.airbaseEscapeCutscene`
 *   - `cf.handoffToStrait`
 */
import * as THREE from 'three';
import type { Ally } from '../../allies/ally';
import type { AllyType } from '../../allies/data';
import type { Ctx, DamageInfo } from '../../core/contracts';
import type { EnemyInstance, ExplosionSpec } from '../../core/gameplay';
import { clamp } from '../../core/math';
import type { EnemyManager } from '../../enemies/EnemyManager';
import type { VehicleSystem } from '../../enemies/vehicles';
import { ModelMaterials } from '../../progression/modelkit';
import { AiVehicleFleet } from '../../vehicles/drive/aiDriver';
import type { DriveableManager } from '../../vehicles/drive/manager';
import { buildVehicleModel, type VehicleModelRig } from '../../vehicles/drive/models';
import type { DriveableVehicle } from '../../vehicles/drive/vehicle';
import {
  AIRBASE_ATC_CONSOLE,
  AIRBASE_BUDDY_RAPTOR_SPAWNS,
  AIRBASE_DESTRUCTIBLES,
  AIRBASE_INNER_GATE,
  AIRBASE_LANCER_SPAWN,
  AIRBASE_SOUTH_GATE,
  AIRBASE_TAKEOFF_GATE,
} from '../../world/map/airbase/plan';
import type { MissionRunner } from '../runner';
import { CrossfireAirWing } from './airWing';
import {
  CROSSFIRE_DEFAULT_LANCER_MAX_HP,
  CROSSFIRE_SIGNALS,
  createInitialChainState,
  loadChainState,
  saveChainState,
  transitionToCrossfirePart,
} from './chain';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _enemyScratch: EnemyInstance[] = [];
const _blastDamage: DamageInfo = {
  amount: 0,
  type: 'explosive',
  point: new THREE.Vector3(),
  dir: new THREE.Vector3(),
  force: 18,
  source: 'jp8_pipeline',
};
const GATE_FUEL_DEPOTS = AIRBASE_DESTRUCTIBLES.filter(d => d.id === 'airbase.fuel.north');
const CONSOLE_REACH = Math.max(4.2, AIRBASE_ATC_CONSOLE.interactRadius + 0.6);
const SOUTH_GATE_Z = AIRBASE_SOUTH_GATE.z + 3; // z = 121 (matches South Gate gantry portal)

type FrontStage = 'staging' | 'perimeter' | 'apron' | 'tower' | 'hangar';

interface PendingPipelineBlast {
  delay: number;
  at: THREE.Vector3;
  radius: number;
  scale: number;
  damage: number;
  isGateBlast: boolean;
}

interface ViperWingmanEntry {
  readonly callsign: string;
  readonly padIndex: number;
  ally: Ally;
  unmark: (() => void) | null;
  boarded: boolean;
}

const STAGING_TRUCK_BAYS: readonly {
  readonly truckPos: readonly [number, number, number];
  readonly truckYaw: number;
  readonly spawnPos: readonly [number, number, number];
}[] = [
  { truckPos: [-20, 0, 139], truckYaw: 0.24, spawnPos: [-20, 0, 145] },
  { truckPos: [22, 0, 141], truckYaw: -0.24, spawnPos: [22, 0, 147] },
];

const INITIAL_ASSAULT_SPOTS: readonly {
  readonly type: AllyType;
  readonly at: readonly [number, number, number];
  readonly post: readonly [number, number, number];
}[] = [
  // Lead breacher crouched beside the South Gate blast charge during the opening cutscene
  { type: 'shotgunner', at: [-2.2, 0, 123.5], post: [-2.2, 0, 123.5] },
  { type: 'rifleman', at: [-7.5, 0, 127], post: [-7.5, 0, 126] },
  { type: 'rifleman', at: [7.5, 0, 127], post: [7.5, 0, 126] },
  { type: 'gunner', at: [-11.5, 0, 133], post: [-11.0, 0, 131] },
  { type: 'rifleman', at: [11.5, 0, 133], post: [11.0, 0, 131] },
  { type: 'shotgunner', at: [-7.0, 0, 137], post: [-7.0, 0, 135] },
  { type: 'rifleman', at: [7.0, 0, 137], post: [7.0, 0, 135] },
  { type: 'gunner', at: [-13.5, 0, 141], post: [-13.0, 0, 139] },
];

const FRONT_POSTS: Readonly<Record<FrontStage, readonly (readonly [number, number, number])[]>> = {
  staging: [
    [-7.5, 0, 126],
    [7.5, 0, 126],
    [-11.0, 0, 131],
    [11.0, 0, 131],
  ],
  perimeter: [
    [-14, 0, 108],
    [-4, 0, 104],
    [6, 0, 104],
    [16, 0, 108],
  ],
  apron: [
    [-34, 0, 74],
    [-22, 0, 62],
    [-12, 0, 48],
    [-36, 0, 40],
  ],
  tower: [
    [-38, 0, 8],
    [-26, 0, -4],
    [-42, 0, -2],
    [-18, 0, -14],
  ],
  hangar: [
    [-10, 0, -34],
    [6, 0, -38],
    [22, 0, -38],
    [12, 0, -48],
  ],
};

const EXPENDABLE_TYPES: readonly AllyType[] = ['rifleman', 'shotgunner', 'rifleman', 'gunner'];

export class AirbaseDirector {
  private readonly propsRoot = new THREE.Group();
  private materials: ModelMaterials | null = null;
  private airWing: CrossfireAirWing | null = null;
  private fleet: AiVehicleFleet | null = null;
  private built = false;

  private lockedLancerRig: VehicleModelRig | null = null;
  private readonly parkedRaptors: VehicleModelRig[] = [];
  private readonly stagingTrucks: VehicleModelRig[] = [];
  private breachChargeGroup: THREE.Group | null = null;
  private breachChargeLedMat: THREE.MeshBasicMaterial | null = null;
  private consoleBeacon: THREE.Mesh | null = null;
  private consoleBeaconMat: THREE.MeshBasicMaterial | null = null;
  private consoleRing: THREE.Mesh | null = null;
  private readonly fuelBeacons: THREE.Mesh[] = [];
  private readonly fuelRings: THREE.Mesh[] = [];
  private readonly ownedGeos: THREE.BufferGeometry[] = [];
  private readonly ownedMats: THREE.Material[] = [];

  // 3-tier friendly invasion tracking
  private readonly viperWingmen: ViperWingmanEntry[] = [];
  private readonly assaultTroops: Ally[] = [];
  private invasionInitialized = false;
  private gateBreached = false;
  private apronGateBreached = false;
  private frontStage: FrontStage = 'staging';
  private reinforceTimer = 0;
  private truckReinforcementsSpawned = 0;

  // Part 1 live mission state
  private fuelWatchActive = false;
  private fuelBlownSignaled = false;
  private readonly pendingPipelineBlasts: PendingPipelineBlast[] = [];
  private readonly unmarkFuelDepots: (() => void)[] = [];
  private atcArmed = false;
  private atcDone = false;
  private atcPromptShowing = false;
  private raptorsSpooling = false;
  private raptorsSpoolClock = 0;
  private raptorsSpooledSignaled = false;
  private raptorsLaunched = false;
  private lancerUnlocked = false;
  private lancerBoardedSignaled = false;
  private lancerAirborneSignaled = false;
  private escapeCutsceneActive = false;
  private escapeClock = 0;
  private escapeSmokeCd = 0;
  private escapeLancerHpRatio: number | null = null;
  private escapeFormationRoot: THREE.Group | null = null;
  private escapeLancerRig: VehicleModelRig | null = null;
  private readonly escapeRaptorRigs: VehicleModelRig[] = [];
  private handoffTriggered = false;
  private lancerVehicle: DriveableVehicle | null = null;
  private beaconPulse = 0;
  private unmarkAtc: (() => void) | null = null;
  private unsubBlast: (() => void) | null = null;
  private prevBlastHandler: ((center: THREE.Vector3, radius: number, amount: number, source: string) => void) | null = null;
  private blastHooked = false;

  constructor(
    private readonly ctx: Ctx,
    private readonly runner: MissionRunner,
  ) {
    this.propsRoot.name = 'crossfire.airbase.props';
  }

  private get driveables(): DriveableManager | undefined {
    return (this.ctx.progression as unknown as { driveables?: DriveableManager } | undefined)?.driveables;
  }

  private get vehicleSystem(): Partial<VehicleSystem> | undefined {
    return this.ctx.enemies?.vehicles as Partial<VehicleSystem> | undefined;
  }

  /** Exposed for unit tests and runtime inspection. */
  get vehicleFleet(): AiVehicleFleet | null {
    return this.fleet;
  }

  ensureBuilt(): void {
    if (this.built) return;
    this.built = true;
    this.materials = new ModelMaterials(this.ctx);
    this.ctx.render?.scene?.add(this.propsRoot);
    this.airWing = new CrossfireAirWing(this.ctx);
    this.fleet = new AiVehicleFleet(this.ctx, this.materials);
    this.buildConsoleIndicator();
    this.buildBreachChargeProp();
    this.buildFuelIndicators();
    this.hookExplosions();
  }

  /** Pulsing orange target beacons & ground rings marking the JP-8 Fuel Depots during Beat 2. */
  private buildFuelIndicators(): void {
    const beaconGeo = new THREE.SphereGeometry(0.42, 10, 8);
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff6b1a });
    const ringGeo = new THREE.RingGeometry(4.1, 4.65, 28);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xff8c24, side: THREE.DoubleSide });
    this.ownedGeos.push(beaconGeo, ringGeo);
    this.ownedMats.push(beaconMat, ringMat);

    for (const depot of GATE_FUEL_DEPOTS) {
      const beacon = new THREE.Mesh(beaconGeo, beaconMat);
      beacon.position.set(depot.x, 4.6, depot.z);
      beacon.visible = false;
      this.propsRoot.add(beacon);
      this.fuelBeacons.push(beacon);

      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.set(depot.x, 0.09, depot.z);
      ring.visible = false;
      this.propsRoot.add(ring);
      this.fuelRings.push(ring);
    }
  }

  private buildConsoleIndicator(): void {
    const geo = new THREE.SphereGeometry(0.22, 10, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff9f1c });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(
      AIRBASE_ATC_CONSOLE.at[0],
      AIRBASE_ATC_CONSOLE.at[1] + 1.45,
      AIRBASE_ATC_CONSOLE.at[2],
    );
    mesh.visible = false;
    this.propsRoot.add(mesh);

    const ringGeo = new THREE.RingGeometry(0.55, 0.72, 20);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xf4b238, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(
      AIRBASE_ATC_CONSOLE.at[0],
      AIRBASE_ATC_CONSOLE.at[1] + 0.08,
      AIRBASE_ATC_CONSOLE.at[2],
    );
    ring.visible = false;
    this.propsRoot.add(ring);

    this.ownedGeos.push(geo, ringGeo);
    this.ownedMats.push(mat, ringMat);
    this.consoleBeacon = mesh;
    this.consoleBeaconMat = mat;
    this.consoleRing = ring;
  }

  /** Visible satchel breach charge + blinking armed LED on the south face of the closed South Radar Gate. */
  private buildBreachChargeProp(): void {
    const group = new THREE.Group();
    group.name = 'crossfire.airbase.south_breach_charge';
    group.position.set(0, 1.45, SOUTH_GATE_Z + 0.45);

    const bodyGeo = new THREE.BoxGeometry(0.42, 0.28, 0.16);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3b4038, roughness: 0.75 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    group.add(body);

    const strapGeo = new THREE.BoxGeometry(0.46, 0.07, 0.18);
    const strapMat = new THREE.MeshStandardMaterial({ color: 0x1e2024, roughness: 0.9 });
    const strap = new THREE.Mesh(strapGeo, strapMat);
    group.add(strap);

    const ledGeo = new THREE.SphereGeometry(0.08, 8, 6);
    const ledMat = new THREE.MeshBasicMaterial({ color: 0xff2b22 });
    const led = new THREE.Mesh(ledGeo, ledMat);
    led.position.set(0, 0.06, 0.11);
    group.add(led);

    group.visible = false;
    this.propsRoot.add(group);
    this.ownedGeos.push(bodyGeo, strapGeo, ledGeo);
    this.ownedMats.push(bodyMat, strapMat, ledMat);
    this.breachChargeGroup = group;
    this.breachChargeLedMat = ledMat;
  }

  private hookExplosions(): void {
    if (this.ctx.events?.on && !this.unsubBlast) {
      const u1 = this.ctx.events.on('combat:explosion', ev => {
        this.onWorldBlast(ev.position, ev.radius);
      });
      const u2 = this.ctx.events.on('world:explosion', ev => {
        this.onWorldBlast(ev.position, ev.radius);
      });
      this.unsubBlast = () => {
        u1();
        u2();
      };
    }

    const objs = this.ctx.world?.objects;
    if (objs && !this.blastHooked) {
      this.prevBlastHandler = objs.blastHandler ?? null;
      this.blastHooked = true;
      objs.blastHandler = (at, radius, damage, source) => {
        this.prevBlastHandler?.(at, radius, damage, source);
        this.onWorldBlast(at, radius);
      };
    }
  }

  private unhookExplosions(): void {
    this.unsubBlast?.();
    this.unsubBlast = null;
    if (this.blastHooked) {
      const objs = this.ctx.world?.objects;
      if (objs) objs.blastHandler = this.prevBlastHandler;
      this.prevBlastHandler = null;
      this.blastHooked = false;
    }
  }

  private onWorldBlast(at: THREE.Vector3, radius: number): void {
    if (!this.fuelWatchActive || this.fuelBlownSignaled) return;
    for (const depot of GATE_FUEL_DEPOTS) {
      const dist = Math.hypot(at.x - depot.x, at.z - depot.z);
      if (dist <= radius + 8) {
        this.triggerFuelCookoff(depot.x, depot.z, depot.label);
        return;
      }
    }
  }

  private clearFuelMarkers(): void {
    for (const off of this.unmarkFuelDepots) off();
    this.unmarkFuelDepots.length = 0;
    for (const b of this.fuelBeacons) b.visible = false;
    for (const r of this.fuelRings) r.visible = false;
  }

  private armFuelWatch(): void {
    this.fuelWatchActive = true;
    if (this.fuelBlownSignaled) return;
    this.clearFuelMarkers();
    for (let i = 0; i < GATE_FUEL_DEPOTS.length; i++) {
      const depot = GATE_FUEL_DEPOTS[i]!;
      const b = this.fuelBeacons[i];
      const r = this.fuelRings[i];
      if (b) b.visible = true;
      if (r) r.visible = true;
      const off = this.ctx.hud?.marker?.(
        new THREE.Vector3(depot.x, 4.8, depot.z),
        'JP-8 MAIN MANIFOLD · BLOW GATE PIPELINE',
        '#ff5e1a',
      ) ?? null;
      if (off) this.unmarkFuelDepots.push(off);
    }
  }

  private openApronGate(): void {
    if (this.apronGateBreached) return;
    this.apronGateBreached = true;
    this.fleet?.setGateOpen('apron_gate', true);
    this.advanceAssaultLine('tower');
  }

  private applyPipelineBlastDamage(at: THREE.Vector3, radius: number, damage: number): void {
    const enemies = this.ctx.enemies as unknown as EnemyManager | undefined;
    if (!enemies) return;
    if (typeof enemies.query === 'function') {
      const n = enemies.query(at, radius, _enemyScratch);
      for (let i = 0; i < n; i++) {
        const e = _enemyScratch[i]!;
        if (!e.alive) continue;
        const d = e.center.distanceTo(at);
        const falloff = clamp(1 - (d / Math.max(1, radius)) * 0.65, 0.3, 1);
        _v2.subVectors(e.center, at).normalize();
        _blastDamage.amount = damage * falloff;
        _blastDamage.point.copy(e.center);
        _blastDamage.dir.copy(_v2);
        _blastDamage.force = 22 * falloff;
        enemies.applyDamage(e, _blastDamage);
      }
    }
    if (enemies.vehicles?.blast) {
      const spec: ExplosionSpec = {
        radius,
        damage,
        kind: 'barrel',
        source: 'jp8_pipeline',
        team: 'player',
      };
      enemies.vehicles.blast(at, spec);
    }
  }

  private detonatePipelineBlast(b: PendingPipelineBlast): void {
    this.ctx.fx?.explosion?.(b.at, { radius: b.radius, scale: b.scale, kind: 'barrel' });
    this.ctx.fx?.chips?.(b.at, 0xff8822, b.isGateBlast ? 54 : 32);
    this.ctx.render?.lights?.flash?.(b.at, 0xff8c2b, b.isGateBlast ? 24 : 16, b.isGateBlast ? 62 : 42, 0.55);
    this.ctx.audio?.play?.('rocket_explosion', { position: b.at, volume: 1.0, pitch: b.isGateBlast ? 0.72 : 0.84 });
    if (b.isGateBlast) {
      // Secondary pier explosions flanking the Inner Blast Gate gantry
      const pierW = _v.set(AIRBASE_INNER_GATE.portalCenterX - AIRBASE_INNER_GATE.portalHalfW, 2.4, AIRBASE_INNER_GATE.z + 1.0);
      this.ctx.fx?.explosion?.(pierW, { radius: 14, scale: 1.9, kind: 'barrel' });
      const pierE = _v2.set(AIRBASE_INNER_GATE.portalCenterX + AIRBASE_INNER_GATE.portalHalfW, 2.4, AIRBASE_INNER_GATE.z + 1.0);
      this.ctx.fx?.explosion?.(pierE, { radius: 14, scale: 1.9, kind: 'barrel' });
      this.ctx.audio?.play?.('vehicle_explode', { position: b.at, volume: 0.95, pitch: 0.85 });
    }
    this.applyPipelineBlastDamage(b.at, b.radius + 4, b.damage);

    if (b.isGateBlast) {
      this.openApronGate();
      this.ctx.hud?.feed?.('INNER BLAST GATE BREACHED — ARMOR & ASSAULT TROOPS PUSHING TO ATC TOWER!', '#38e8ff');
    }
  }

  private triggerFuelCookoff(x: number, z: number, label: string): void {
    if (this.fuelBlownSignaled) return;
    this.fuelBlownSignaled = true;
    this.clearFuelMarkers();

    // Stage 1 (t = 0.0 s): Primary JP-8 depot fireball
    const pos = _v.set(x, 2.5, z);
    this.ctx.fx?.explosion?.(pos, { radius: 20, scale: 2.5, kind: 'barrel' });
    this.ctx.fx?.chips?.(pos, 0xff9922, 40);
    this.ctx.render?.lights?.flash?.(pos, 0xff8822, 20, 52, 0.5);
    this.ctx.audio?.play?.('rocket_explosion', { position: pos, volume: 1.0, pitch: 0.78 });
    this.ctx.audio?.play?.('vehicle_explode', { position: pos, volume: 0.8, pitch: 0.9 });
    this.applyPipelineBlastDamage(pos, 22, 650);
    this.ctx.hud?.feed?.(`${label} DETONATED — JP-8 PIPELINE IGNITING TOWARD INNER BLAST GATE!`, '#ff6b1a');

    // Stage 2 (t = 0.35 s): Mid-pipeline pressure valve eruption
    // Stage 3 (t = 0.70 s): Inner Blast Gate breach fireball obliterating the roadblock & releasing our armor!
    this.pendingPipelineBlasts.push(
      {
        delay: 0.35,
        at: new THREE.Vector3(-35.2, 2.5, 17.5),
        radius: 16,
        scale: 2.2,
        damage: 700,
        isGateBlast: false,
      },
      {
        delay: 0.70,
        at: new THREE.Vector3(AIRBASE_INNER_GATE.portalCenterX, 2.8, AIRBASE_INNER_GATE.z),
        radius: 24,
        scale: 2.9,
        damage: 1400,
        isGateBlast: true,
      },
    );

    this.runner.signal(CROSSFIRE_SIGNALS.fuelBlown);
  }

  /** Handles all 8 Part 1 `cf.*` calls. Returns true if handled. */
  call(name: string, _arg?: string): boolean {
    this.ensureBuilt();
    switch (name) {
      case 'cf.airbaseInit':
        this.airbaseInit();
        return true;
      case 'cf.airbaseBreach':
        this.triggerSouthGateBreach();
        return true;
      case 'cf.apronFuelWatch':
        this.ensureInvasionForce(true, false);
        this.advanceAssaultLine('apron');
        this.armFuelWatch();
        return true;
      case 'cf.atcConsole':
        this.ensureInvasionForce(true, true);
        this.openApronGate();
        this.armAtcConsole();
        return true;
      case 'cf.buddyRaptorsBoard':
        this.ensureInvasionForce(true, true);
        this.openApronGate();
        this.advanceAssaultLine('hangar');
        this.startBuddyRaptorsBoarding();
        return true;
      case 'cf.lancerReady':
        this.unlockLancer();
        return true;
      case 'cf.buddyRaptorsTakeoff':
        this.launchBuddyRaptors();
        return true;
      case 'cf.airbaseEscapeCutscene':
        this.startEscapeCutscene();
        return true;
      case 'cf.handoffToStrait':
        this.handoffToStrait();
        return true;
      default:
        return false;
    }
  }

  private airbaseInit(): void {
    this.clearStageEntities();

    const chain = createInitialChainState({
      active: true,
      part: 1,
      contractor: 'A',
      lancerHp: CROSSFIRE_DEFAULT_LANCER_MAX_HP,
      lancerMaxHp: CROSSFIRE_DEFAULT_LANCER_MAX_HP,
    });
    saveChainState(chain);

    this.ensureAirbaseProps();
    this.ensureInvasionForce(false, false);
  }

  /** Ensures static Alert Hangar B-1B Lancer, parked F-22 Raptors, and staging troop carriers exist. */
  private ensureAirbaseProps(): void {
    if (!this.materials) return;

    // 1. Locked B-1B Lancer staged inside the Hardened Alert Hangar until beat 5 (`cf.lancerReady`)
    if (!this.lancerUnlocked && !this.lockedLancerRig) {
      const lancerRig = buildVehicleModel('lancer', this.materials);
      lancerRig.root.name = 'crossfire.locked_lancer';
      lancerRig.root.position.set(
        AIRBASE_LANCER_SPAWN.at[0],
        AIRBASE_LANCER_SPAWN.at[1],
        AIRBASE_LANCER_SPAWN.at[2],
      );
      lancerRig.root.rotation.set(0, AIRBASE_LANCER_SPAWN.yaw, 0, 'YXZ');
      if (lancerRig.landingGear) lancerRig.landingGear.visible = true;
      for (const g of lancerRig.boostGlow) g.visible = false;
      if (lancerRig.resupplyRing) lancerRig.resupplyRing.visible = false;
      this.propsRoot.add(lancerRig.root);
      this.lockedLancerRig = lancerRig;
    }

    // 2. Two parked F-22 Raptors on the west/east alert revetment pads for Viper-2 and Viper-3
    if (!this.raptorsLaunched && this.parkedRaptors.length === 0) {
      for (const pad of AIRBASE_BUDDY_RAPTOR_SPAWNS) {
        const rig = buildVehicleModel('raptor', this.materials);
        rig.root.name = `crossfire.parked_${pad.id}`;
        rig.root.position.set(pad.at[0], pad.at[1], pad.at[2]);
        rig.root.rotation.set(0, pad.yaw, 0, 'YXZ');
        if (rig.landingGear) rig.landingGear.visible = true;
        for (const g of rig.boostGlow) g.visible = false;
        for (const r of rig.riders) r.root.visible = false;
        if (rig.resupplyRing) rig.resupplyRing.visible = false;
        this.propsRoot.add(rig.root);
        this.parkedRaptors.push(rig);
      }
    }

    // 3. Two static staging troop carriers parked off the South Insertion Road shoulders (concealed spawn bays)
    if (this.stagingTrucks.length === 0) {
      for (let i = 0; i < STAGING_TRUCK_BAYS.length; i++) {
        const bay = STAGING_TRUCK_BAYS[i]!;
        const rig = buildVehicleModel('bastion', this.materials);
        rig.root.name = `crossfire.staging_carrier_${i + 1}`;
        rig.root.position.set(bay.truckPos[0], bay.truckPos[1], bay.truckPos[2]);
        rig.root.rotation.set(0, bay.truckYaw, 0, 'YXZ');
        if (rig.resupplyRing) rig.resupplyRing.visible = false;
        for (const r of rig.riders) r.root.visible = false;
        this.propsRoot.add(rig.root);
        this.stagingTrucks.push(rig);
      }
    }
  }

  /**
   * Stages the combined-arms Bureau assault force:
   *   - 3 AI-driven friendly ground vehicles (2 Jackal technicals + 1 Aegis MBT),
   *     sequentially gated at `south_gate` (South Radar Gate) and `apron_gate` (Inner Blast Gate
   *     at z = 11 — held until the player detonates the marked JP-8 Fuel Depots!).
   *   - 2 essential scripted wingmen (`VIPER-2`, `VIPER-3`) with cyan HUD follow markers.
   *   - 8 expendable frontline assault infantry stacked on the gate & approach road.
   * Safe to call on mid-mission `?beat=` jumps (`startBreached = true`).
   */
  private ensureInvasionForce(startBreached: boolean, apronOpen = false): void {
    this.ensureAirbaseProps();
    if (this.invasionInitialized) {
      if (startBreached && !this.gateBreached) {
        this.gateBreached = true;
        this.fleet?.setGateOpen('south_gate', true);
        if (this.breachChargeGroup) this.breachChargeGroup.visible = false;
      }
      if (apronOpen && !this.apronGateBreached) {
        this.openApronGate();
      }
      return;
    }
    this.invasionInitialized = true;
    this.gateBreached = startBreached;
    this.apronGateBreached = apronOpen;
    this.frontStage = apronOpen ? 'tower' : startBreached ? 'apron' : 'staging';
    this.reinforceTimer = 9.0;
    this.truckReinforcementsSpawned = 0;

    if (this.breachChargeGroup) {
      this.breachChargeGroup.visible = !startBreached;
    }

    // Wire friendly ground targets into VehicleSystem so Northern armor & QRF fight our vehicles!
    this.vehicleSystem?.setFriendlyVehicles?.(() => this.fleet?.getLiveGroundTargets(true) ?? []);

    // 1. Friendly AI armor & technical convoy (2 Jackals + 1 Aegis MBT, gated at South Gate -> Inner Apron Gate)
    if (this.fleet) {
      this.fleet.setGateOpen('south_gate', startBreached);
      this.fleet.setGateOpen('apron_gate', apronOpen);

      this.fleet.spawnGround({
        id: 'airbase_jackal_west',
        kind: 'jackal',
        laneId: 'south_gate',
        label: 'JACKAL-1 · ASSAULT',
        spawn: apronOpen ? [-22, 0, -2] : startBreached ? [-20, 0, 72] : [-4.2, 0, 131],
        waypoints: apronOpen
          ? [[-20, 0, -14], [-10, 0, -28]]
          : startBreached
            ? [[-24, 0, 32], [-22, 0, -4], [-10, 0, -28]]
            : [[-4.2, 0, 126], [-5, 0, 104], [-20, 0, 68], [-25, 0, 26], [-22, 0, -4], [-10, 0, -28]],
        gateWaypoints: apronOpen ? undefined : startBreached ? { 0: 'apron_gate' } : { 0: 'south_gate', 3: 'apron_gate' },
        hpOverride: 340,
        speedScale: 0.34,
      });

      this.fleet.spawnGround({
        id: 'airbase_jackal_east',
        kind: 'jackal',
        laneId: 'south_gate',
        label: 'JACKAL-2 · ASSAULT',
        spawn: apronOpen ? [-14, 0, -4] : startBreached ? [0, 0, 64] : [4.2, 0, 132],
        waypoints: apronOpen
          ? [[6, 0, -18], [16, 0, -28]]
          : startBreached
            ? [[-14, 0, 28], [-16, 0, -4], [14, 0, -26]]
            : [[4.2, 0, 126], [6, 0, 100], [-2, 0, 62], [-14, 0, 28], [-16, 0, -4], [14, 0, -26]],
        gateWaypoints: apronOpen ? undefined : startBreached ? { 0: 'apron_gate' } : { 0: 'south_gate', 3: 'apron_gate' },
        hpOverride: 340,
        speedScale: 0.34,
      });

      this.fleet.spawnGround({
        id: 'airbase_aegis_lead',
        kind: 'aegis',
        laneId: 'south_gate',
        label: 'AEGIS-1 · HEAVY ARMOR',
        spawn: apronOpen ? [-22, 0, 2] : startBreached ? [-20, 0, 56] : [-3.4, 0, 148],
        waypoints: apronOpen
          ? [[-18, 0, -18], [8, 0, -22], [22, 0, -32]]
          : startBreached
            ? [[-20, 0, 30], [-22, 0, -4], [6, 0, -20], [22, 0, -32]]
            : [[-3.4, 0, 130], [-2, 0, 102], [-18, 0, 62], [-20, 0, 30], [-22, 0, -4], [6, 0, -20], [22, 0, -32]],
        gateWaypoints: apronOpen ? undefined : startBreached ? { 0: 'apron_gate' } : { 0: 'south_gate', 3: 'apron_gate' },
        hpOverride: 1050,
        speedScale: 0.24,
      });
    }

    // 2. Essential wingmen: VIPER-2 & VIPER-3 (unkillable, follow player, board F-22 Raptors in Beat 4)
    this.ensureViperWingmen();

    // 3. Initial expendable assault platoon stacked behind the South Gate & barriers
    if (!startBreached) {
      for (const spot of INITIAL_ASSAULT_SPOTS) {
        this.spawnExpendableTrooper(
          spot.type,
          new THREE.Vector3(spot.at[0], spot.at[1], spot.at[2]),
          new THREE.Vector3(spot.post[0], spot.post[1], spot.post[2]),
          Math.PI,
        );
      }
    } else {
      const posts = FRONT_POSTS[apronOpen ? 'tower' : 'apron'];
      for (let i = 0; i < 6; i++) {
        const pt = posts[i % posts.length]!;
        const at = new THREE.Vector3(pt[0] + (i - 2.5) * 2.2, pt[1], pt[2] + 8);
        this.spawnExpendableTrooper(
          EXPENDABLE_TYPES[i % EXPENDABLE_TYPES.length]!,
          at,
          new THREE.Vector3(pt[0], pt[1], pt[2]),
          Math.PI,
        );
      }
    }
  }

  /** Spawns essential Viper-2 and Viper-3 if not already present (including checkpoint jumps). */
  private ensureViperWingmen(): void {
    if (this.viperWingmen.length >= 2) return;
    const allies = this.ctx.allies;
    if (!allies?.spawn) return;

    const p = this.ctx.player?.position;
    const baseX = p ? p.x : 0;
    const baseY = p ? p.y : 0;
    const baseZ = p ? p.z : 142;

    const defs: readonly { callsign: string; type: AllyType; dx: number; dz: number; padIndex: number }[] = [
      { callsign: 'VIPER-2', type: 'rifleman', dx: -4.5, dz: 2.0, padIndex: 0 },
      { callsign: 'VIPER-3', type: 'gunner', dx: 4.5, dz: 2.0, padIndex: 1 },
    ];

    for (const d of defs) {
      if (this.viperWingmen.some(w => w.callsign === d.callsign)) continue;
      const pos = new THREE.Vector3(baseX + d.dx, baseY, baseZ + d.dz);
      const ally = allies.spawn(d.type, pos, pos.clone(), 6, Math.PI);
      if (!ally) continue;
      ally.essential = true;
      ally.detached = true;
      ally.order = 'follow';
      const unmark = this.ctx.hud?.follow?.(ally.body.center, d.callsign, '#38e8ff') ?? null;
      this.viperWingmen.push({
        callsign: d.callsign,
        padIndex: d.padIndex,
        ally,
        unmark,
        boarded: false,
      });
    }
  }

  private spawnExpendableTrooper(
    type: AllyType,
    at: THREE.Vector3,
    post: THREE.Vector3,
    yaw: number,
  ): Ally | null {
    const ally = this.ctx.allies?.spawn?.(type, at, post, 8, yaw) ?? null;
    if (!ally) return null;
    const hp = type === 'gunner' ? 120 : 90;
    ally.maxHealth = hp;
    ally.health = hp;
    ally.expendable = true;
    ally.detached = true;
    ally.order = 'post';
    this.assaultTroops.push(ally);
    return ally;
  }

  /** Detonates the South Radar Gate breach charge and releases the friendly assault convoy & infantry. */
  private triggerSouthGateBreach(): void {
    this.ensureInvasionForce(false, false);
    if (this.gateBreached) return;
    this.gateBreached = true;

    if (this.breachChargeGroup) {
      this.breachChargeGroup.visible = false;
    }

    const blastPos = _v.set(0, 2.2, SOUTH_GATE_Z);
    this.ctx.fx?.explosion?.(blastPos, { radius: 14, scale: 2.0, kind: 'barrel' });
    this.ctx.fx?.chips?.(blastPos, 0xffaa33, 42);
    this.ctx.render?.lights?.flash?.(blastPos, 0xffaa44, 18, 48, 0.5);
    this.ctx.audio?.play?.('rocket_explosion', { position: blastPos, volume: 1.0, pitch: 0.78 });
    this.ctx.audio?.play?.('vehicle_explode', { position: blastPos, volume: 0.75, pitch: 0.92 });

    // Open the South Gate lane so Jackal-1, Jackal-2, and Aegis-1 surge into Sector 1 (and hold at Inner Apron Gate)!
    this.fleet?.setGateOpen('south_gate', true);
    this.advanceAssaultLine('perimeter');

    this.ctx.hud?.feed?.('SOUTH RADAR GATE BREACHED — ASSAULT ARMOR & INFANTRY MOVING IN!', '#38e8ff');
  }

  /** Advances surviving expendable assault infantry forward to the current battlefront stage. */
  private advanceAssaultLine(stage: FrontStage): void {
    this.frontStage = stage;
    const posts = FRONT_POSTS[stage];
    let idx = 0;
    for (let i = this.assaultTroops.length - 1; i >= 0; i--) {
      const a = this.assaultTroops[i]!;
      if (!a.alive) {
        this.assaultTroops.splice(i, 1);
        continue;
      }
      const pt = posts[idx % posts.length]!;
      idx++;
      a.post.set(pt[0], pt[1], pt[2]);
      a.postRadius = 9;
      a.thinkAt = 0;
    }
  }

  /** Spawns a backup Aegis tank on the taxiway if our lead Aegis fell before the Alert Hangar duel. */
  private ensureHangarArmorSupport(): void {
    if (!this.fleet) return;
    const liveAegis = this.fleet.units.some(u => u.kind === 'aegis' && u.alive && !u.disposed);
    if (liveAegis) return;
    this.fleet.setGateOpen('south_gate', true);
    this.fleet.setGateOpen('apron_gate', true);
    this.fleet.spawnGround({
      id: 'airbase_aegis_reinforce',
      kind: 'aegis',
      laneId: 'south_gate',
      label: 'AEGIS-2 · HEAVY ARMOR',
      spawn: [-22, 0, 2],
      waypoints: [[8, 0, -20], [22, 0, -32]],
      gateWaypointIndex: 0,
      hpOverride: 1150,
      speedScale: 0.28,
    });
  }

  private armAtcConsole(): void {
    this.atcArmed = true;
    this.atcDone = false;
    if (this.consoleBeacon) this.consoleBeacon.visible = true;
    if (this.consoleRing) this.consoleRing.visible = true;
    this.consoleBeaconMat?.color.setHex(0xff9f1c);
    this.unmarkAtc?.();
    this.unmarkAtc = this.ctx.hud?.marker?.(
      new THREE.Vector3(AIRBASE_ATC_CONSOLE.at[0], AIRBASE_ATC_CONSOLE.at[1] + 1.5, AIRBASE_ATC_CONSOLE.at[2]),
      'ATC OVERRIDE CONSOLE [E]',
      '#ff9f1c',
    ) ?? null;
  }

  /** Completes the ATC Hangar Override & IFF Spoof Console interaction. Public for deterministic tests. */
  triggerAtcOverride(): void {
    if (this.atcDone) return;
    this.atcDone = true;
    this.atcArmed = false;
    this.hideAtcPrompt();
    this.unmarkAtc?.();
    this.unmarkAtc = null;
    this.consoleBeaconMat?.color.setHex(0x38e8ff);
    if (this.consoleRing) this.consoleRing.visible = false;

    const pos = _v.set(AIRBASE_ATC_CONSOLE.at[0], AIRBASE_ATC_CONSOLE.at[1] + 1, AIRBASE_ATC_CONSOLE.at[2]);
    this.ctx.audio?.play?.('hit_confirm', { position: pos, volume: 0.9, pitch: 0.85 });
    this.ctx.hud?.feed?.('HANGAR BLAST DOORS OVERRIDDEN — NORTHERN IFF SPOOF LOCKED', '#38e8ff');
    this.runner.signal(CROSSFIRE_SIGNALS.atcOverrideDone);
  }

  private startBuddyRaptorsBoarding(): void {
    this.ensureAirbaseProps();
    this.ensureViperWingmen();
    this.ensureHangarArmorSupport();

    this.raptorsSpooling = true;
    this.raptorsSpoolClock = 0;
    this.raptorsSpooledSignaled = false;

    // Order essential Viper-2 and Viper-3 to sprint straight to their parked F-22 Raptor pads!
    for (const entry of this.viperWingmen) {
      if (entry.boarded) continue;
      const pad = AIRBASE_BUDDY_RAPTOR_SPAWNS[entry.padIndex];
      if (!pad) continue;
      entry.ally.scriptedGoal = new THREE.Vector3(pad.at[0], pad.at[1], pad.at[2]);
      entry.ally.thinkAt = 0;
    }

    // If no on-foot wingmen could be spawned (e.g. headless stub without allies.spawn), light jets directly
    if (this.viperWingmen.length === 0) {
      for (let i = 0; i < this.parkedRaptors.length; i++) {
        this.activateParkedRaptor(i);
      }
    }

    this.ctx.hud?.feed?.('VIPER-2 & VIPER-3 SPRINTING FOR ALERT F-22 RAPTORS!', '#38e8ff');
  }

  private activateParkedRaptor(padIndex: number): void {
    const rig = this.parkedRaptors[padIndex];
    if (!rig) return;
    for (const g of rig.boostGlow) g.visible = true;
    for (const r of rig.riders) r.root.visible = true;
    const pad = AIRBASE_BUDDY_RAPTOR_SPAWNS[padIndex];
    if (pad) {
      this.ctx.audio?.play?.('veh_afterburner_ignite', {
        position: _v.set(pad.at[0], pad.at[1] + 2, pad.at[2]),
        volume: 0.65,
        pitch: 0.9,
      });
    }
  }

  private boardViperWingman(entry: ViperWingmanEntry): void {
    if (entry.boarded) return;
    entry.boarded = true;
    entry.ally.scriptedGoal = null;
    entry.unmark?.();
    entry.unmark = null;
    this.ctx.allies?.dismiss?.(entry.ally);
    this.activateParkedRaptor(entry.padIndex);
  }

  private unlockLancer(): void {
    if (this.lancerUnlocked) return;
    this.ensureAirbaseProps();
    this.lancerUnlocked = true;
    this.lancerBoardedSignaled = false;
    this.lancerAirborneSignaled = false;

    // Ensure any still-running Viper wingmen are seated inside their Raptors before takeoff
    for (const entry of this.viperWingmen) {
      if (!entry.boarded) this.boardViperWingman(entry);
    }

    // Remove locked static display Lancer before spawning the live driveable B-1B Lancer
    if (this.lockedLancerRig) {
      this.propsRoot.remove(this.lockedLancerRig.root);
      this.lockedLancerRig = null;
    }

    const spawnPos = new THREE.Vector3(
      AIRBASE_LANCER_SPAWN.at[0],
      AIRBASE_LANCER_SPAWN.at[1],
      AIRBASE_LANCER_SPAWN.at[2],
    );
    const mgr = this.driveables;
    if (mgr) {
      this.lancerVehicle = mgr.spawn('lancer', spawnPos, AIRBASE_LANCER_SPAWN.yaw, {
        poolSlot: 'crossfire.valken_lancer',
        exitLocked: true,
      });
      this.lancerVehicle.setExitLocked?.(true);
    }
    this.ctx.hud?.feed?.('B-1B LANCER UNLOCKED IN ALERT HANGAR — CLIMB ABOARD [E]', '#ffd166');
  }

  private launchBuddyRaptors(): void {
    if (this.raptorsLaunched) return;
    this.raptorsLaunched = true;

    for (const rig of this.parkedRaptors) {
      this.propsRoot.remove(rig.root);
    }
    this.parkedRaptors.length = 0;

    if (!this.airWing) return;
    // Climb off the alert pads and orbit overhead above the north runway waiting for the player to rotate
    for (let i = 0; i < AIRBASE_BUDDY_RAPTOR_SPAWNS.length; i++) {
      const pad = AIRBASE_BUDDY_RAPTOR_SPAWNS[i]!;
      const side = i === 0 ? -1 : 1;
      const spawnPos = new THREE.Vector3(pad.at[0], Math.max(10, pad.at[1] + 10), pad.at[2]);
      this.airWing.spawnAlly('raptor', spawnPos, pad.yaw, 0.85, {
        label: pad.callsign,
        tacticalRole: 'hunter',
        spawnOptions: {
          doctrine: 'escort_bomber',
          speedOverride: 44,
          waypoints: [
            new THREE.Vector3(62 + side * 26, 46, -185),
            new THREE.Vector3(62 + side * 78, 62, -95),
            new THREE.Vector3(62 + side * 52, 58, 15),
            new THREE.Vector3(62 + side * 24, 52, -165),
            new THREE.Vector3(62 + side * 74, 64, -80),
            new THREE.Vector3(62 + side * 28, 56, -220),
          ],
        },
      });
    }
    this.ctx.hud?.feed?.('VIPER-2 & VIPER-3 AIRBORNE — HOLDING OVERHEAD ESCORT FOR YOUR ROTATION!', '#38e8ff');
  }

  /**
   * Stages the cinematic 3-ship Escape Formation (`B-1B Lancer` lead + `VIPER-2` & `VIPER-3` F-22
   * wingmen tucked tight on its wingtips) climbing smoothly north across Valken Airbase during the
   * `valkenEscape` cutscene so Darrow and Council finish dialogue cleanly with zero invisible-wall
   * loitering.
   */
  private startEscapeCutscene(): void {
    if (this.escapeCutsceneActive) return;
    this.escapeCutsceneActive = true;
    this.escapeClock = 0;
    this.escapeSmokeCd = 0;

    // Preserve surviving Lancer HP before exiting & clearing the live driveable
    const activeVeh = this.lancerVehicle ?? this.driveables?.active ?? null;
    if (activeVeh && activeVeh.def.maxHealth > 0) {
      this.escapeLancerHpRatio = clamp(activeVeh.health / activeVeh.def.maxHealth, 0.25, 1);
    }

    // Quietly exit player from the live Lancer so vehicle flight controls & invisible-wall hits stop immediately
    (this.lancerVehicle as unknown as { exit?: (quiet?: boolean) => void } | null)?.exit?.(true);
    this.ctx.player?.teleport?.(new THREE.Vector3(AIRBASE_LANCER_SPAWN.at[0], 0, AIRBASE_LANCER_SPAWN.at[2]));
    this.lancerVehicle = null;
    this.driveables?.clear?.();
    this.airWing?.clear();
    this.raptorsLaunched = false;

    // Clear any residual cockpit/post-FX state and keep first-person weapons holstered/hidden before the cut
    const canvas = this.ctx.render?.renderer?.domElement;
    if (canvas) canvas.style.filter = '';
    this.ctx.render?.post?.setGrade?.('default', 0);
    this.ctx.render?.post?.setSpeed?.(0);
    this.ctx.weapons?.setHolstered?.(true);
    const viewScene = this.ctx.render?.viewScene;
    if (viewScene) viewScene.visible = false;

    for (const rig of this.parkedRaptors) {
      this.propsRoot.remove(rig.root);
    }
    this.parkedRaptors.length = 0;

    if (!this.materials) return;

    const root = new THREE.Group();
    root.name = 'crossfire.airbase.escape_formation';
    root.position.set(40, 48, -10);

    // Center lead: 28.2 m B-1B Lancer with gear up, afterburners lit, nose pitched gently into climb
    const lancerRig = buildVehicleModel('lancer', this.materials);
    lancerRig.root.name = 'crossfire.escape_lancer';
    lancerRig.root.rotation.set(-0.105, Math.PI, 0, 'YXZ');
    if (lancerRig.landingGear) lancerRig.landingGear.visible = false;
    if (lancerRig.resupplyRing) lancerRig.resupplyRing.visible = false;
    for (const g of lancerRig.boostGlow) {
      g.visible = true;
      g.scale.set(1, 1, 1.35);
    }
    root.add(lancerRig.root);
    this.escapeLancerRig = lancerRig;

    // Wingmen: Viper-2 (port) & Viper-3 (starboard) sliding cleanly onto the Lancer's wingtips
    this.escapeRaptorRigs.length = 0;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const rig = buildVehicleModel('raptor', this.materials);
      rig.root.name = i === 0 ? 'crossfire.escape_viper2' : 'crossfire.escape_viper3';
      rig.root.position.set(side * 38, -5.0, 26);
      rig.root.rotation.set(-0.105, Math.PI, -side * 0.14, 'YXZ');
      if (rig.landingGear) rig.landingGear.visible = false;
      if (rig.resupplyRing) rig.resupplyRing.visible = false;
      for (const r of rig.riders) r.root.visible = false;
      for (const g of rig.boostGlow) {
        g.visible = true;
        g.scale.set(1, 1, 1.25);
      }
      root.add(rig.root);
      this.escapeRaptorRigs.push(rig);
    }

    this.propsRoot.add(root);
    this.escapeFormationRoot = root;
  }

  private tickEscapeFormation(dt: number): void {
    if (!this.escapeCutsceneActive || !this.escapeFormationRoot) return;
    this.escapeClock += dt;
    const t = this.escapeClock;

    // Linear cruise climb synchronized with the 3-shot `valkenEscape` camera track (0 -> 26.2 s)
    const fx = 40;
    const fy = 48 + t * 1.65;
    const fz = -10 - t * 10.5;
    this.escapeFormationRoot.position.set(fx, fy, fz);

    // Subtle aerodynamic bank-and-leveling feel + B-1B variable-geometry wing sweep
    const bank = Math.sin(t * 0.42) * 0.055;
    const pitch = -0.105 + clamp(t / 24, 0, 1) * 0.045;
    if (this.escapeLancerRig) {
      this.escapeLancerRig.root.rotation.set(pitch, Math.PI, bank, 'YXZ');
      if (this.escapeLancerRig.wingsLeft && this.escapeLancerRig.wingsRight) {
        const sweep = 0.14 + clamp(t / 7.5, 0, 1) * 0.54;
        this.escapeLancerRig.wingsLeft.rotation.y = sweep;
        this.escapeLancerRig.wingsRight.rotation.y = -sweep;
      }
      const glowScale = 1.25 + Math.sin(t * 21) * 0.14;
      for (const g of this.escapeLancerRig.boostGlow) {
        g.scale.set(1, 1, glowScale);
      }
    }

    // Viper-2 & Viper-3 smoothly close into tight fingertip escort formation on the Lancer's wings
    const join = clamp(t / 4.8, 0, 1);
    const smoothJoin = join * join * (3 - 2 * join);
    for (let i = 0; i < this.escapeRaptorRigs.length; i++) {
      const side = i === 0 ? -1 : 1;
      const rig = this.escapeRaptorRigs[i]!;
      const bobY = Math.sin(t * 1.45 + i * 2.1) * 0.45;
      const bobX = Math.cos(t * 0.95 + i * 1.7) * 0.35;
      const targetX = side * (38 - smoothJoin * 13) + bobX;
      const targetY = -5.0 + smoothJoin * 2.8 + bobY;
      const targetZ = 26 - smoothJoin * 12 + (i === 1 ? 2 : 0);
      rig.root.position.set(targetX, targetY, targetZ);
      const joinBank = (1 - smoothJoin) * (-side * 0.22);
      rig.root.rotation.set(pitch, Math.PI, bank + joinBank + Math.sin(t * 1.1 + i) * 0.03, 'YXZ');
      const glowScale = 1.18 + Math.sin(t * 24 + i) * 0.12;
      for (const g of rig.boostGlow) {
        g.scale.set(1, 1, glowScale);
      }
    }

    // Crisp afterburner exhaust trail behind the 3-ship flight
    this.escapeSmokeCd -= dt;
    if (this.escapeSmokeCd <= 0) {
      this.escapeSmokeCd = 0.09;
      this.ctx.fx?.smoke?.(_v.set(fx, fy - 0.8, fz + 15), 2, 0xdce6f2, 1.4);
      this.ctx.fx?.smoke?.(_v.set(fx - 25, fy - 2.4, fz + 22), 1, 0xdce6f2, 0.9);
      this.ctx.fx?.smoke?.(_v.set(fx + 25, fy - 2.4, fz + 24), 1, 0xdce6f2, 0.9);
    }
  }

  private handoffToStrait(): void {
    if (this.handoffTriggered) return;
    this.handoffTriggered = true;

    const prev = loadChainState() ?? createInitialChainState();
    const prog = this.ctx.progression;
    const hpRatio = this.escapeLancerHpRatio !== null
      ? this.escapeLancerHpRatio
      : this.lancerVehicle && this.lancerVehicle.def.maxHealth > 0
        ? Math.max(0.25, Math.min(1, this.lancerVehicle.health / this.lancerVehicle.def.maxHealth))
        : 1;
    const lancerHp = Math.round(CROSSFIRE_DEFAULT_LANCER_MAX_HP * hpRatio);

    void transitionToCrossfirePart(
      'crossfire_strait',
      {
        part: 2,
        contractor: 'B',
        lancerHp,
        lancerMaxHp: CROSSFIRE_DEFAULT_LANCER_MAX_HP,
        score: prog?.score ?? prev.score,
        kills: prog?.kills ?? prev.kills,
        elapsed: (prev.elapsed ?? 0) + (this.runner.elapsed ?? 0),
        deaths: (prev.deaths ?? 0) + (this.runner.deaths ?? 0),
      },
      'TRANSFERRING TO CONTRACTOR #7712-B // F-22 RAPTOR ESCORT',
      {
        sublabel: 'VALKEN AIRBASE CLEARED · NORTHERN IFF SPOOF ACTIVE · ENTERING THE STRAIT',
      },
    );
  }

  private hideAtcPrompt(): void {
    this.atcPromptShowing = false;
  }

  /** Reinforces expendable assault infantry strictly from behind the parked staging troop carriers outside South Gate. */
  private tickStagingTruckReinforcements(dt: number): void {
    if (!this.gateBreached) return;
    if (this.frontStage !== 'perimeter' && this.frontStage !== 'apron' && this.frontStage !== 'tower') return;
    if (this.truckReinforcementsSpawned >= 16) return;

    this.reinforceTimer -= dt;
    if (this.reinforceTimer > 0) return;
    this.reinforceTimer = 9.0;

    // Prune dead expendables
    for (let i = this.assaultTroops.length - 1; i >= 0; i--) {
      if (!this.assaultTroops[i]!.alive) this.assaultTroops.splice(i, 1);
    }

    const totalAllies = this.ctx.allies?.allies?.length ?? 0;
    if (this.assaultTroops.length >= 8 || totalAllies >= 18) return;

    const posts = FRONT_POSTS[this.frontStage];
    const toSpawn = Math.min(2, 8 - this.assaultTroops.length, 16 - this.truckReinforcementsSpawned);
    for (let i = 0; i < toSpawn; i++) {
      const bay = STAGING_TRUCK_BAYS[(this.truckReinforcementsSpawned + i) % STAGING_TRUCK_BAYS.length]!;
      const post = posts[(this.truckReinforcementsSpawned + i) % posts.length]!;
      const type = EXPENDABLE_TYPES[(this.truckReinforcementsSpawned + i) % EXPENDABLE_TYPES.length]!;
      const at = new THREE.Vector3(bay.spawnPos[0], bay.spawnPos[1], bay.spawnPos[2]);
      const ally = this.spawnExpendableTrooper(type, at, new THREE.Vector3(post[0], post[1], post[2]), Math.PI);
      if (ally) {
        this.truckReinforcementsSpawned++;
      }
    }
  }

  update(dt: number): void {
    if (!this.built || dt <= 0) return;

    // 0. Blink armed satchel charge LED before breach & update friendly AI armor
    if (this.breachChargeGroup?.visible && this.breachChargeLedMat) {
      this.beaconPulse += dt * 7.5;
      this.breachChargeLedMat.color.setHex(Math.sin(this.beaconPulse) >= 0 ? 0xff2b22 : 0x440908);
    }
    this.fleet?.update(dt);
    this.tickStagingTruckReinforcements(dt);

    // 0b. Tick staggered 3-stage JP-8 pipeline chain explosions -> Inner Blast Gate breach
    for (let i = this.pendingPipelineBlasts.length - 1; i >= 0; i--) {
      const b = this.pendingPipelineBlasts[i]!;
      b.delay -= dt;
      if (b.delay > 0) continue;
      this.pendingPipelineBlasts.splice(i, 1);
      this.detonatePipelineBlast(b);
    }

    // 1. Pulse JP-8 depot markers & watch the deep North JP-8 Main Manifold via DestructionManager clusters
    if (this.fuelWatchActive && !this.fuelBlownSignaled) {
      this.beaconPulse += dt * 5.2;
      const pulseScale = 0.85 + Math.sin(this.beaconPulse) * 0.3;
      for (const b of this.fuelBeacons) {
        if (b.visible) b.scale.setScalar(pulseScale);
      }
      for (const r of this.fuelRings) {
        if (r.visible) r.rotation.z += dt * 1.1;
      }

      const dest = this.ctx.world?.objects?.destruction;
      if (dest) {
        for (const depot of GATE_FUEL_DEPOTS) {
          const cluster = dest.getCluster(depot.id);
          if (!cluster) continue;
          const withNodes = cluster as { getNode?: (id: string) => { state?: string } | undefined };
          const tankA = withNodes.getNode?.('jp8_tank_a');
          const tankB = withNodes.getNode?.('jp8_tank_b');
          const tankHit = (tankA && tankA.state !== 'intact') || (tankB && tankB.state !== 'intact');
          if (cluster.collapsed || cluster.destroyedFraction >= 0.12 || tankHit) {
            this.triggerFuelCookoff(depot.x, depot.z, depot.label);
            break;
          }
        }
      }
    }

    // 2. Interactive ATC Hangar Override & IFF Spoof Console
    if (this.atcArmed && !this.atcDone) {
      this.beaconPulse += dt * 4.5;
      if (this.consoleBeacon) {
        const s = 0.85 + Math.sin(this.beaconPulse) * 0.25;
        this.consoleBeacon.scale.setScalar(s);
      }
      if (this.consoleRing) {
        this.consoleRing.rotation.z += dt * 1.4;
      }

      const player = this.ctx.player;
      if (player && player.alive && !player.parked) {
        const dx = player.position.x - AIRBASE_ATC_CONSOLE.at[0];
        const dy = player.position.y - AIRBASE_ATC_CONSOLE.at[1];
        const dz = player.position.z - AIRBASE_ATC_CONSOLE.at[2];
        const near = Math.hypot(dx, dz) <= CONSOLE_REACH && Math.abs(dy) <= 2.6;
        if (near) {
          if (!this.atcPromptShowing) {
            const key = this.ctx.input?.labelFor?.('interact') ?? 'E';
            this.ctx.hud?.callout?.(`[${key}] TRIGGER HANGAR OVERRIDE & IFF SPOOF`);
            this.atcPromptShowing = true;
          }
          if (this.ctx.input?.pressed?.('interact')) {
            this.triggerAtcOverride();
          }
        } else {
          this.hideAtcPrompt();
        }
      } else {
        this.hideAtcPrompt();
      }
    }

    // 3. Viper-2 & Viper-3 sprint-to-cockpit boarding + spool-up -> `cf:raptors_spooled`
    if (this.raptorsSpooling && !this.raptorsSpooledSignaled) {
      this.raptorsSpoolClock += dt;
      let allBoarded = true;
      for (const entry of this.viperWingmen) {
        if (entry.boarded) continue;
        const pad = AIRBASE_BUDDY_RAPTOR_SPAWNS[entry.padIndex];
        const dist = pad
          ? Math.hypot(entry.ally.body.position.x - pad.at[0], entry.ally.body.position.z - pad.at[2])
          : 0;
        if (dist <= 8.5 || this.raptorsSpoolClock >= 3.0) {
          this.boardViperWingman(entry);
        } else {
          allBoarded = false;
        }
      }
      if (allBoarded && this.raptorsSpoolClock >= 3.0) {
        this.raptorsSpooledSignaled = true;
        this.runner.signal(CROSSFIRE_SIGNALS.raptorsSpooled);
      }
    }

    // 4. B-1B Lancer boarding & takeoff climb detection
    if (this.lancerUnlocked) {
      const activeVeh = this.driveables?.active ?? null;
      const inLancer = Boolean(
        (this.lancerVehicle && this.lancerVehicle.occupied)
        || (activeVeh && activeVeh.def.id === 'lancer'),
      );
      if (inLancer && !this.lancerBoardedSignaled) {
        this.lancerBoardedSignaled = true;
        this.runner.signal(CROSSFIRE_SIGNALS.lancerBoarded);
      }

      if (this.lancerBoardedSignaled && !this.lancerAirborneSignaled) {
        const pos = this.lancerVehicle?.phys.position ?? activeVeh?.phys.position ?? this.ctx.player?.position;
        if (pos) {
          const pastGate = pos.z <= AIRBASE_TAKEOFF_GATE.northZ && pos.y >= AIRBASE_TAKEOFF_GATE.minAltitudeY;
          const runwayRotate = pos.z <= -195 && pos.y >= 30;
          const highClimb = pos.y >= 46 && pos.z <= -120;
          if (pastGate || runwayRotate || highClimb) {
            this.lancerAirborneSignaled = true;
            this.runner.signal(CROSSFIRE_SIGNALS.lancerAirborne);
          }
        }
      }
    }

    // 5. Update airborne buddy Raptors after takeoff & animated 3-ship escape cutscene formation
    if (this.raptorsLaunched) {
      this.airWing?.update(dt);
    }
    if (this.escapeCutsceneActive) {
      this.tickEscapeFormation(dt);
    }
  }

  /** Test & debug inspection state. */
  get state() {
    return {
      invasionInitialized: this.invasionInitialized,
      gateBreached: this.gateBreached,
      apronGateBreached: this.apronGateBreached,
      frontStage: this.frontStage,
      friendlyVehicleCount: this.fleet?.getLiveAll().length ?? 0,
      viperWingmenCount: this.viperWingmen.length,
      viperBoardedCount: this.viperWingmen.filter(w => w.boarded).length,
      assaultTroopCount: this.assaultTroops.filter(a => a.alive).length,
      fuelWatchActive: this.fuelWatchActive,
      fuelBlownSignaled: this.fuelBlownSignaled,
      atcArmed: this.atcArmed,
      atcDone: this.atcDone,
      raptorsSpooling: this.raptorsSpooling,
      raptorsSpooledSignaled: this.raptorsSpooledSignaled,
      raptorsLaunched: this.raptorsLaunched,
      lancerUnlocked: this.lancerUnlocked,
      lancerBoardedSignaled: this.lancerBoardedSignaled,
      lancerAirborneSignaled: this.lancerAirborneSignaled,
      escapeCutsceneActive: this.escapeCutsceneActive,
      handoffTriggered: this.handoffTriggered,
      parkedRaptorCount: this.parkedRaptors.length,
      alliedAirborneCount: this.airWing?.allies.length ?? 0,
    };
  }

  private clearStageEntities(): void {
    this.hideAtcPrompt();
    this.unmarkAtc?.();
    this.unmarkAtc = null;
    this.clearFuelMarkers();
    this.pendingPipelineBlasts.length = 0;

    for (const w of this.viperWingmen) {
      w.unmark?.();
      w.unmark = null;
      w.ally.scriptedGoal = null;
      if (!w.boarded) this.ctx.allies?.dismiss?.(w.ally);
    }
    this.viperWingmen.length = 0;

    for (const a of this.assaultTroops) {
      if (a.alive) this.ctx.allies?.dismiss?.(a);
    }
    this.assaultTroops.length = 0;

    this.vehicleSystem?.setFriendlyVehicles?.(null);
    this.fleet?.clear();

    if (this.lockedLancerRig) {
      this.propsRoot.remove(this.lockedLancerRig.root);
      this.lockedLancerRig = null;
    }
    if (this.escapeFormationRoot) {
      this.propsRoot.remove(this.escapeFormationRoot);
      this.escapeFormationRoot = null;
    }
    this.escapeLancerRig = null;
    this.escapeRaptorRigs.length = 0;
    for (const rig of this.parkedRaptors) {
      this.propsRoot.remove(rig.root);
    }
    this.parkedRaptors.length = 0;
    for (const rig of this.stagingTrucks) {
      this.propsRoot.remove(rig.root);
    }
    this.stagingTrucks.length = 0;

    if (this.breachChargeGroup) this.breachChargeGroup.visible = false;
    if (this.consoleBeacon) this.consoleBeacon.visible = false;
    if (this.consoleRing) this.consoleRing.visible = false;
    this.airWing?.clear();

    this.invasionInitialized = false;
    this.gateBreached = false;
    this.apronGateBreached = false;
    this.frontStage = 'staging';
    this.reinforceTimer = 0;
    this.truckReinforcementsSpawned = 0;

    this.fuelWatchActive = false;
    this.fuelBlownSignaled = false;
    this.atcArmed = false;
    this.atcDone = false;
    this.raptorsSpooling = false;
    this.raptorsSpoolClock = 0;
    this.raptorsSpooledSignaled = false;
    this.raptorsLaunched = false;
    this.lancerUnlocked = false;
    this.lancerBoardedSignaled = false;
    this.lancerAirborneSignaled = false;
    this.escapeCutsceneActive = false;
    this.escapeClock = 0;
    this.escapeSmokeCd = 0;
    this.escapeLancerHpRatio = null;
    this.handoffTriggered = false;
    this.lancerVehicle = null;
  }

  clear(): void {
    this.clearStageEntities();
  }

  reset(): void {
    this.clearStageEntities();
    this.unhookExplosions();
    this.airWing?.dispose();
    this.airWing = null;
    this.fleet?.dispose();
    this.fleet = null;
    for (const g of this.ownedGeos) g.dispose();
    this.ownedGeos.length = 0;
    for (const m of this.ownedMats) m.dispose();
    this.ownedMats.length = 0;
    this.ctx.render?.scene?.remove(this.propsRoot);
    this.built = false;
  }
}
