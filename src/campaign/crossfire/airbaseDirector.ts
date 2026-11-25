/**
 * Crossfire Part 1 Runtime Director — "Valken Airbase" (`map: 'airbase'`, Contractor #7712-A).
 *
 * Handles all 7 Part 1 `cf.*` mission director calls:
 *   - `cf.airbaseInit`
 *   - `cf.apronFuelWatch`
 *   - `cf.atcConsole`
 *   - `cf.buddyRaptorsBoard`
 *   - `cf.lancerReady`
 *   - `cf.buddyRaptorsTakeoff`
 *   - `cf.handoffToStrait`
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import { ModelMaterials } from '../../progression/modelkit';
import type { DriveableManager } from '../../vehicles/drive/manager';
import { buildVehicleModel, type VehicleModelRig } from '../../vehicles/drive/models';
import type { DriveableVehicle } from '../../vehicles/drive/vehicle';
import {
  AIRBASE_ATC_CONSOLE,
  AIRBASE_BUDDY_RAPTOR_SPAWNS,
  AIRBASE_DESTRUCTIBLES,
  AIRBASE_LANCER_SPAWN,
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
const FUEL_DEPOTS = AIRBASE_DESTRUCTIBLES.filter(d => d.kind === 'fuelDepot');
const CONSOLE_REACH = Math.max(4.2, AIRBASE_ATC_CONSOLE.interactRadius + 0.6);

export class AirbaseDirector {
  private readonly propsRoot = new THREE.Group();
  private materials: ModelMaterials | null = null;
  private airWing: CrossfireAirWing | null = null;
  private built = false;

  private lockedLancerRig: VehicleModelRig | null = null;
  private readonly parkedRaptors: VehicleModelRig[] = [];
  private consoleBeacon: THREE.Mesh | null = null;
  private consoleBeaconMat: THREE.MeshBasicMaterial | null = null;
  private consoleRing: THREE.Mesh | null = null;
  private readonly ownedGeos: THREE.BufferGeometry[] = [];
  private readonly ownedMats: THREE.Material[] = [];

  // Part 1 live mission state
  private fuelWatchActive = false;
  private fuelBlownSignaled = false;
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

  ensureBuilt(): void {
    if (this.built) return;
    this.built = true;
    this.materials = new ModelMaterials(this.ctx);
    this.ctx.render?.scene?.add(this.propsRoot);
    this.airWing = new CrossfireAirWing(this.ctx);
    this.buildConsoleIndicator();
    this.hookExplosions();
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
    for (const depot of FUEL_DEPOTS) {
      const dist = Math.hypot(at.x - depot.x, at.z - depot.z);
      if (dist <= radius + 14) {
        this.triggerFuelCookoff(depot.x, depot.z, depot.label);
        return;
      }
    }
  }

  private triggerFuelCookoff(x: number, z: number, label: string): void {
    if (this.fuelBlownSignaled) return;
    this.fuelBlownSignaled = true;
    const pos = _v.set(x, 2.2, z);
    this.ctx.fx?.explosion?.(pos, { radius: 18, scale: 2.2, kind: 'barrel' });
    this.ctx.audio?.play?.('rocket_explosion', { position: pos, volume: 0.95, pitch: 0.8 });
    this.ctx.hud?.feed?.(`${label} DETONATED — APRON IGNITED!`, '#ff9f1c');
    this.runner.signal(CROSSFIRE_SIGNALS.fuelBlown);
  }

  /** Handles all 7 Part 1 `cf.*` calls. Returns true if handled. */
  call(name: string, _arg?: string): boolean {
    this.ensureBuilt();
    switch (name) {
      case 'cf.airbaseInit':
        this.airbaseInit();
        return true;
      case 'cf.apronFuelWatch':
        this.fuelWatchActive = true;
        return true;
      case 'cf.atcConsole':
        this.armAtcConsole();
        return true;
      case 'cf.buddyRaptorsBoard':
        this.startBuddyRaptorsBoarding();
        return true;
      case 'cf.lancerReady':
        this.unlockLancer();
        return true;
      case 'cf.buddyRaptorsTakeoff':
        this.launchBuddyRaptors();
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
  }

  /** Ensures the static Alert Hangar B-1B Lancer and parked buddy F-22 Raptors exist (including mid-mission ?beat= jumps). */
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
        if (rig.resupplyRing) rig.resupplyRing.visible = false;
        this.propsRoot.add(rig.root);
        this.parkedRaptors.push(rig);
      }
    }
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
    this.raptorsSpooling = true;
    this.raptorsSpoolClock = 0;
    this.raptorsSpooledSignaled = false;
    for (const rig of this.parkedRaptors) {
      for (const g of rig.boostGlow) g.visible = true;
      for (const r of rig.riders) r.root.visible = true;
    }
    const first = AIRBASE_BUDDY_RAPTOR_SPAWNS[0];
    if (first) {
      this.ctx.audio?.play?.('veh_afterburner_ignite', {
        position: _v.set(first.at[0], first.at[1] + 2, first.at[2]),
        volume: 0.65,
        pitch: 0.9,
      });
    }
    this.ctx.hud?.feed?.('VIPER-2 & VIPER-3 BOARDING ALERT F-22 RAPTORS — SPOOLED FOR LAUNCH', '#38e8ff');
  }

  private unlockLancer(): void {
    if (this.lancerUnlocked) return;
    this.ensureAirbaseProps();
    this.lancerUnlocked = true;
    this.lancerBoardedSignaled = false;
    this.lancerAirborneSignaled = false;

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
    for (let i = 0; i < AIRBASE_BUDDY_RAPTOR_SPAWNS.length; i++) {
      const pad = AIRBASE_BUDDY_RAPTOR_SPAWNS[i]!;
      const xOffset = i === 0 ? -24 : 24;
      const spawnPos = new THREE.Vector3(pad.at[0], Math.max(10, pad.at[1] + 10), pad.at[2]);
      this.airWing.spawnAlly('raptor', spawnPos, pad.yaw, 0.85, {
        label: pad.callsign,
        tacticalRole: 'hunter',
        spawnOptions: {
          doctrine: 'escort_bomber',
          speedOverride: 62,
          waypoints: [
            new THREE.Vector3(pad.at[0] * 0.5 + 30, 34, -170),
            new THREE.Vector3(AIRBASE_TAKEOFF_GATE.beaconAt[0] + xOffset, 82, -310),
            new THREE.Vector3(xOffset * 1.5, 112, -560),
          ],
        },
      });
    }
    this.ctx.hud?.feed?.('VIPER-2 & VIPER-3 AIRBORNE — CLIMBING NORTH OFF RUNWAY 01/19!', '#38e8ff');
  }

  private handoffToStrait(): void {
    if (this.handoffTriggered) return;
    this.handoffTriggered = true;

    const prev = loadChainState() ?? createInitialChainState();
    const prog = this.ctx.progression;
    const hpRatio = this.lancerVehicle && this.lancerVehicle.def.maxHealth > 0
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

  update(dt: number): void {
    if (!this.built || dt <= 0) return;

    // 1. Watch JP-8 fuel depots via DestructionManager clusters
    if (this.fuelWatchActive && !this.fuelBlownSignaled) {
      const dest = this.ctx.world?.objects?.destruction;
      if (dest) {
        for (const depot of FUEL_DEPOTS) {
          const cluster = dest.getCluster(depot.id);
          if (cluster && (cluster.collapsed || cluster.destroyedFraction >= 0.45)) {
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

    // 3. Buddy F-22 Raptors spool-up timer -> `cf:raptors_spooled`
    if (this.raptorsSpooling && !this.raptorsSpooledSignaled) {
      this.raptorsSpoolClock += dt;
      if (this.raptorsSpoolClock >= 3.0) {
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
          const highClimb = pos.y >= AIRBASE_TAKEOFF_GATE.minAltitudeY + 26 && pos.z <= -160;
          if (pastGate || highClimb) {
            this.lancerAirborneSignaled = true;
            this.runner.signal(CROSSFIRE_SIGNALS.lancerAirborne);
          }
        }
      }
    }

    // 5. Update airborne buddy Raptors after takeoff
    if (this.raptorsLaunched) {
      this.airWing?.update(dt);
    }
  }

  /** Test & debug inspection state. */
  get state() {
    return {
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
      handoffTriggered: this.handoffTriggered,
      parkedRaptorCount: this.parkedRaptors.length,
      alliedAirborneCount: this.airWing?.allies.length ?? 0,
    };
  }

  private clearStageEntities(): void {
    this.hideAtcPrompt();
    this.unmarkAtc?.();
    this.unmarkAtc = null;
    if (this.lockedLancerRig) {
      this.propsRoot.remove(this.lockedLancerRig.root);
      this.lockedLancerRig = null;
    }
    for (const rig of this.parkedRaptors) {
      this.propsRoot.remove(rig.root);
    }
    this.parkedRaptors.length = 0;
    if (this.consoleBeacon) this.consoleBeacon.visible = false;
    if (this.consoleRing) this.consoleRing.visible = false;
    this.airWing?.clear();

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
    for (const g of this.ownedGeos) g.dispose();
    this.ownedGeos.length = 0;
    for (const m of this.ownedMats) m.dispose();
    this.ownedMats.length = 0;
    this.ctx.render?.scene?.remove(this.propsRoot);
    this.built = false;
  }
}
