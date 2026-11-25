/**
 * Crossfire Parts 2 & 4 Runtime Director — "The Strait" & "Dusk Egress" (`map: 'strait'`, Contractor #7712-B).
 *
 * Handles all 8 Strait `cf.*` mission director calls:
 *   Part 2 (Outbound Escort):
 *     - `cf.straitOutboundInit`
 *     - `cf.straitWave` (`outbound_probe`, `destroyer_strike`, `coastal_aces`)
 *     - `cf.straitDestroyersHot`
 *     - `cf.straitFeetDryWatch`
 *     - `cf.handoffToHalcyon`
 *   Part 4 (Dusk Return Egress):
 *     - `cf.straitReturnInit`
 *     - `cf.straitWave` (`return_ambush`, `return_final`)
 *     - `cf.straitCarrierUmbrella`
 *     - `cf.crossfireDebrief`
 */
import * as THREE from 'three';
import { recordMissionWin } from '../../contracts/unlocks';
import type { Ctx } from '../../core/contracts';
import { clamp, rand } from '../../core/math';
import type { AiCombatJet, AiJetKind, EscortHoldingOrbit } from '../../enemies/dogfight/aiJet';
import type { DriveableManager } from '../../vehicles/drive/manager';
import type { DriveableVehicle } from '../../vehicles/drive/vehicle';
import {
  STRAIT_CARRIER_CENTER,
  STRAIT_CARRIER_RECOVERY_Z,
  STRAIT_DESTROYERS,
  STRAIT_DESTROYER_MOUNTS,
  STRAIT_ENEMY_SECTORS,
  STRAIT_FEET_DRY_Z,
  STRAIT_FRIENDLY_ESCORTS,
  STRAIT_INBOUND_LANCER_PATH,
  STRAIT_INBOUND_PLAYER_SPAWN,
  STRAIT_INBOUND_WINGMAN_SPAWNS,
  STRAIT_OUTBOUND_LANCER_PATH,
  STRAIT_OUTBOUND_PLAYER_SPAWN,
  STRAIT_OUTBOUND_WINGMAN_SPAWNS,
  type StraitFlightPose,
} from '../../world/map/strait/plan';
import type { MissionRunner } from '../runner';
import { CrossfireAirWing, STRAIT_AIR_THEATER } from './airWing';
import { BaseDefenseSystem } from './baseDefense';
import {
  CROSSFIRE_DEFAULT_LANCER_MAX_HP,
  CROSSFIRE_SIGNALS,
  clearChainState,
  createInitialChainState,
  loadChainState,
  transitionToCrossfirePart,
} from './chain';
import { DestroyerFleet } from './destroyerShip';
import { CrossfireHudOverlay } from './hudOverlay';

interface StraitWaveEntry {
  readonly kind: AiJetKind;
  readonly sectorId: string;
  readonly spawnIndex: number;
  readonly skill: number;
  readonly label?: string;
}

const STRAIT_WAVES: Readonly<Record<string, readonly StraitWaveEntry[]>> = {
  outbound_probe: [
    { kind: 'hornet', sectorId: 'west_flank', spawnIndex: 1, skill: 0.56, label: 'SOUTHERN HORNET-1' },
    { kind: 'hornet', sectorId: 'north_cap', spawnIndex: 1, skill: 0.62, label: 'SOUTHERN HORNET-2' },
    { kind: 'hornet', sectorId: 'east_flank', spawnIndex: 1, skill: 0.56, label: 'SOUTHERN HORNET-3' },
  ],
  destroyer_strike: [
    { kind: 'harrier', sectorId: 'west_flank', spawnIndex: 0, skill: 0.64, label: 'STRIKER HARRIER-1' },
    { kind: 'harrier', sectorId: 'east_flank', spawnIndex: 0, skill: 0.64, label: 'STRIKER HARRIER-2' },
    { kind: 'harrier', sectorId: 'high_cover', spawnIndex: 0, skill: 0.68, label: 'STRIKER HARRIER-3' },
    { kind: 'warthog', sectorId: 'west_flank', spawnIndex: 1, skill: 0.66, label: 'IRONCLAD WARTHOG-1' },
    { kind: 'warthog', sectorId: 'east_flank', spawnIndex: 1, skill: 0.66, label: 'BASTION WARTHOG-2' },
  ],
  coastal_aces: [
    { kind: 'raptor', sectorId: 'north_cap', spawnIndex: 1, skill: 0.86, label: 'RED-WING ACE LEADER' },
    { kind: 'hornet', sectorId: 'north_cap', spawnIndex: 0, skill: 0.72, label: 'HALCYON CAP-1' },
    { kind: 'hornet', sectorId: 'north_cap', spawnIndex: 2, skill: 0.72, label: 'HALCYON CAP-2' },
    { kind: 'hornet', sectorId: 'high_cover', spawnIndex: 1, skill: 0.75, label: 'HALCYON CAP-3' },
  ],
  return_ambush: [
    { kind: 'raptor', sectorId: 'north_pursuit', spawnIndex: 0, skill: 0.88, label: 'RED-WING ACE-1' },
    { kind: 'raptor', sectorId: 'north_pursuit', spawnIndex: 2, skill: 0.88, label: 'RED-WING ACE-2' },
    { kind: 'hornet', sectorId: 'high_cover', spawnIndex: 0, skill: 0.74, label: 'RED-WING HORNET-1' },
    { kind: 'hornet', sectorId: 'high_cover', spawnIndex: 1, skill: 0.74, label: 'RED-WING HORNET-2' },
    { kind: 'hornet', sectorId: 'west_flank', spawnIndex: 0, skill: 0.72, label: 'RED-WING HORNET-3' },
    { kind: 'hornet', sectorId: 'east_flank', spawnIndex: 0, skill: 0.72, label: 'RED-WING HORNET-4' },
  ],
  return_final: [
    { kind: 'raptor', sectorId: 'north_pursuit', spawnIndex: 1, skill: 0.90, label: 'RED-WING COMMANDER' },
    { kind: 'hornet', sectorId: 'west_flank', spawnIndex: 2, skill: 0.76, label: 'PURSUIT HORNET-1' },
    { kind: 'hornet', sectorId: 'east_flank', spawnIndex: 2, skill: 0.76, label: 'PURSUIT HORNET-2' },
    { kind: 'hornet', sectorId: 'high_cover', spawnIndex: 2, skill: 0.78, label: 'PURSUIT HORNET-3' },
  ],
};

const _v = new THREE.Vector3();
const _origin = new THREE.Vector3();

function spawnPointForSector(sectorId: string, idx: number): THREE.Vector3 {
  const sector = STRAIT_ENEMY_SECTORS.find(s => s.id === sectorId) ?? STRAIT_ENEMY_SECTORS[0]!;
  const tuple = sector.spawns[idx % sector.spawns.length] ?? [0, 140, -500];
  return new THREE.Vector3(tuple[0], tuple[1], tuple[2]);
}

function yawToward(from: THREE.Vector3, to: THREE.Vector3): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

export const LANCER_FORMATION_REPAIR_RADIUS = 135;
export const LANCER_FORMATION_REPAIR_RATE = 120;

const LANCER_ORBIT_PROBE: EscortHoldingOrbit = {
  centerX: 0,
  centerZ: 280,
  altitude: 112,
  radiusX: 155,
  radiusZ: 80,
  speed: 44,
  direction: 1,
};

const LANCER_ORBIT_DESTROYERS: EscortHoldingOrbit = {
  centerX: 0,
  centerZ: 145,
  altitude: 124,
  radiusX: 175,
  radiusZ: 80,
  speed: 46,
  direction: -1,
};

const LANCER_ORBIT_COASTAL: EscortHoldingOrbit = {
  centerX: 0,
  centerZ: -335,
  altitude: 128,
  radiusX: 160,
  radiusZ: 85,
  speed: 46,
  direction: 1,
};

const LANCER_ORBIT_RETURN_AMBUSH: EscortHoldingOrbit = {
  centerX: 0,
  centerZ: -210,
  altitude: 122,
  radiusX: 160,
  radiusZ: 85,
  speed: 44,
  direction: 1,
};

type StraitBeatStage = 'start' | 'midstrait' | 'coastal' | 'carrier';

export class StraitDirector {
  private airWing: CrossfireAirWing | null = null;
  private defenses: BaseDefenseSystem | null = null;
  private destroyers: DestroyerFleet | null = null;
  private built = false;

  private mode: 'none' | 'outbound' | 'return' = 'none';
  private escortLancer: AiCombatJet | null = null;
  private playerRaptor: DriveableVehicle | null = null;
  private playerSpawnPose: StraitFlightPose | null = null;
  private introCutsceneSeen = false;
  private introReboardDone = false;

  private destroyersHot = false;
  private destroyersSuppressedSignaled = false;
  private lancerMidstraitSignaled = false;
  private feetDryWatchActive = false;
  private feetDrySignaled = false;
  private umbrellaActive = false;
  private umbrellaFireCd = 0;
  private lancerRecoveredSignaled = false;
  private lancerFailed = false;
  private handoffTriggered = false;
  private debriefComplete = false;
  private smokeTrailCd = 0;
  private formationRepairActive = false;
  private repairFxCd = 0;
  private playerCrashTimer = -1;
  private spawnedWaveNames = new Set<string>();
  private activeOrbitTag: string | null = null;

  // Saved dawn scene atmosphere so dusk return tint can be cleanly reverted on clear/reset
  private savedBgColor: THREE.Color | null = null;
  private savedFogColor: THREE.Color | null = null;
  private duskApplied = false;

  constructor(
    private readonly ctx: Ctx,
    private readonly runner: MissionRunner,
    private readonly hudOverlay: CrossfireHudOverlay,
    private readonly isCutscenePlaying: () => boolean = () => false,
  ) {}

  private get driveables(): DriveableManager | undefined {
    return (this.ctx.progression as unknown as { driveables?: DriveableManager } | undefined)?.driveables;
  }

  private downPlayerCleanly(source: string): void {
    if (this.playerRaptor?.occupied) {
      this.playerRaptor.exit?.(true);
    }
    const p = this.ctx.player as (Ctx['player'] & { unpark?: (grace?: number) => void }) | undefined;
    if (p && p.alive) {
      p.unpark?.(0);
      p.takeDamage?.({
        amount: 9999,
        from: p.position?.clone?.() ?? new THREE.Vector3(),
        type: 'true',
        source,
      });
    }
    if (this.runner.state !== 'down' && this.runner.state !== 'won') {
      this.runner.down();
    }
  }

  ensureBuilt(): void {
    if (this.built) return;
    this.built = true;

    this.airWing = new CrossfireAirWing(
      this.ctx,
      {
        onWaveCleared: waveId => {
          this.runner.signal(`cf:wave_cleared_${waveId}`);
        },
        onAllyKilled: jet => {
          if (jet === this.escortLancer && !this.lancerFailed && !this.feetDrySignaled && !this.lancerRecoveredSignaled) {
            this.lancerFailed = true;
            this.ctx.hud?.feed?.('B-1B LANCER DESTROYED — ESCORT FAILED!', '#ff3b2f');
            this.downPlayerCleanly('lancer_destroyed');
          }
        },
      },
      STRAIT_AIR_THEATER,
    );

    this.destroyers = new DestroyerFleet(this.ctx, {
      onShipSunk: ship => {
        // Instantly destroy & hide all surviving SAM/CIWS turrets on the sinking warship!
        this.defenses?.destroySitesForShip(ship.id);
        this.checkDestroyerSuppression();
      },
    });

    this.defenses = new BaseDefenseSystem(this.ctx, {
      onDamaged: (_id, _kind, amount, pos, shipId) => {
        if (shipId) this.destroyers?.applyTurretDamage(shipId, amount, false, pos);
      },
      onDestroyed: (_id, kind, pos, shipId) => {
        this.ctx.hud?.feed?.(
          kind === 'destroyer_sam' ? 'DESTROYER SEARAM LAUNCHER KNOCKED OUT!' : 'DESTROYER CIWS TURRET SILENCED!',
          '#ffd166',
        );
        if (shipId) this.destroyers?.applyTurretDamage(shipId, 0, true, pos);
        this.checkDestroyerSuppression();
      },
    });
  }

  /** Handles all 8 Strait (Parts 2 & 4) `cf.*` calls. Returns true if handled. */
  call(name: string, arg?: string): boolean {
    this.ensureBuilt();
    switch (name) {
      case 'cf.straitOutboundInit':
        this.initStrait('outbound', 'start');
        return true;
      case 'cf.straitWave': {
        const waveName = arg ?? 'outbound_probe';
        if (waveName === 'destroyer_strike') this.ensureInitializedForBeat('outbound', 'midstrait');
        else if (waveName === 'coastal_aces') this.ensureInitializedForBeat('outbound', 'coastal');
        else if (waveName === 'outbound_probe') this.ensureInitializedForBeat('outbound', 'start');
        else if (waveName === 'return_ambush') this.ensureInitializedForBeat('return', 'start');
        else if (waveName === 'return_final') this.ensureInitializedForBeat('return', 'carrier');
        this.spawnWave(waveName);
        return true;
      }
      case 'cf.straitDestroyersHot':
        this.ensureInitializedForBeat('outbound', 'midstrait');
        this.activateDestroyers();
        return true;
      case 'cf.straitFeetDryWatch':
        this.ensureInitializedForBeat('outbound', 'coastal');
        this.feetDryWatchActive = true;
        return true;
      case 'cf.handoffToHalcyon':
        this.handoffToHalcyon();
        return true;
      case 'cf.straitReturnInit':
        this.initStrait('return', 'start');
        return true;
      case 'cf.straitCarrierUmbrella':
        this.ensureInitializedForBeat('return', 'carrier');
        this.activateCarrierUmbrella();
        return true;
      case 'cf.crossfireDebrief':
        this.runCrossfireDebrief();
        return true;
      default:
        return false;
    }
  }

  /**
   * Ensures the escort Lancer, wingmen, and Contractor B's airborne F-22 Raptor are spawned and boarded
   * when redeploying at a mid-mission checkpoint (e.g. Destroyer Gauntlet, Coastal Aces, Carrier Umbrella)
   * or jumping directly to a beat via `?beat=`.
   */
  private ensureInitializedForBeat(mode: 'outbound' | 'return', stage: StraitBeatStage): void {
    const needsPlane = Boolean(this.driveables) && (!this.playerRaptor || !this.playerRaptor.alive);
    if (this.mode === mode && this.escortLancer?.alive && !needsPlane) return;
    this.initStrait(mode, stage);
  }

  private spawnPlayerAirborneRaptor(pose: StraitFlightPose): DriveableVehicle | null {
    const mgr = this.driveables;
    if (!mgr) {
      // Headless/unit-test fallback: place player directly at airborne spawn
      this.ctx.player?.teleport?.(new THREE.Vector3(pose.at[0], pose.at[1], pose.at[2]), pose.yaw);
      return null;
    }

    mgr.clear();
    const pos = new THREE.Vector3(pose.at[0], pose.at[1], pose.at[2]);
    const veh = mgr.spawn('raptor', pos, pose.yaw, { poolSlot: `crossfire.${pose.id}`, exitLocked: true });
    veh.setExitLocked?.(true);
    veh.phys.grounded = false;
    veh.phys.groundY = 0;
    veh.phys.altitude = pos.y;
    veh.phys.vtolMode = false;
    veh.phys.airThrottle = 0.72;
    veh.phys.speed = pose.speed;
    veh.phys.velocity.set(Math.sin(pose.yaw) * pose.speed, 0, Math.cos(pose.yaw) * pose.speed);
    veh.phys.position.copy(pos);
    veh.board(0);
    return veh;
  }

  private positionPlayerRaptorInFormation(veh: DriveableVehicle): void {
    const pose = this.playerSpawnPose;
    if (!pose) return;
    const lancer = this.escortLancer;
    let x = pose.at[0];
    let y = pose.at[1];
    let z = pose.at[2];
    if (lancer && lancer.alive) {
      // Hold slightly aft & off the starboard/port wing of the 28.2 m AI B-1B Lancer so she sits squarely in front of the pilot!
      const outbound = this.mode === 'outbound';
      x = lancer.position.x + (outbound ? 24 : -24);
      y = lancer.position.y + 4;
      z = lancer.position.z + (outbound ? 48 : -48);
    }
    veh.phys.grounded = false;
    veh.phys.groundY = 0;
    veh.phys.altitude = y;
    veh.phys.vtolMode = false;
    veh.phys.airThrottle = 0.72;
    veh.phys.speed = pose.speed;
    veh.phys.yaw = pose.yaw;
    veh.phys.pitch = 0;
    veh.phys.roll = 0;
    veh.phys.velocity.set(Math.sin(pose.yaw) * pose.speed, 0, Math.cos(pose.yaw) * pose.speed);
    veh.phys.position.set(x, y, z);
    veh.model?.root?.position?.set(x, y, z);
  }

  private initStrait(mode: 'outbound' | 'return', stage: StraitBeatStage = 'start'): void {
    this.clearMissionState();
    this.mode = mode;

    const chain = loadChainState();
    const lancerMaxHp = chain?.lancerMaxHp ?? CROSSFIRE_DEFAULT_LANCER_MAX_HP;
    const defaultHp = mode === 'return' ? Math.round(lancerMaxHp * 0.65) : lancerMaxHp;
    const startHp = clamp(chain?.lancerHp ?? defaultHp, Math.round(lancerMaxHp * 0.3), lancerMaxHp);

    if (mode === 'return') {
      this.applyDuskAtmosphere();
    } else {
      this.restoreAtmosphere();
    }

    // Determine Lancer starting waypoint slice & formation pose for the active beat/checkpoint stage
    const rawPath = mode === 'outbound' ? STRAIT_OUTBOUND_LANCER_PATH : STRAIT_INBOUND_LANCER_PATH;
    const startIdx = mode === 'outbound'
      ? (stage === 'coastal' ? 3 : stage === 'midstrait' ? 2 : 0)
      : (stage === 'carrier' ? 3 : 0);
    const waypoints = rawPath.slice(startIdx).map(p => new THREE.Vector3(p[0], p[1], p[2]));
    const lancerStart = waypoints[0]!.clone();
    const lancerYaw = mode === 'outbound' ? Math.PI : 0;

    // 1. Spawn Contractor B airborne in the F-22 Raptor (positioned in formation behind/beside the Lancer for mid-mission checkpoints)
    const basePose = mode === 'outbound' ? STRAIT_OUTBOUND_PLAYER_SPAWN : STRAIT_INBOUND_PLAYER_SPAWN;
    const playerPose: StraitFlightPose = startIdx === 0
      ? basePose
      : {
          id: `${basePose.id}_${stage}`,
          at: [
            lancerStart.x + (mode === 'outbound' ? 24 : -24),
            lancerStart.y + 4,
            lancerStart.z + (mode === 'outbound' ? 48 : -48),
          ],
          yaw: basePose.yaw,
          speed: basePose.speed,
        };
    if (stage !== 'start') {
      this.introReboardDone = true;
    }
    if (mode === 'outbound' && stage === 'coastal') {
      this.lancerMidstraitSignaled = true;
      this.destroyersSuppressedSignaled = true;
    }
    this.playerSpawnPose = playerPose;
    this.playerRaptor = this.spawnPlayerAirborneRaptor(playerPose);

    // 2. Spawn the 7,500 HP AI B-1B Lancer flying along the strait escort path
    if (this.airWing) {
      const lancer = this.airWing.spawnAlly('lancer', lancerStart, lancerYaw, 0.82, {
        label: mode === 'outbound' ? 'B-1B LANCER (ESCORT)' : 'B-1B LANCER (DAMAGED)',
        tacticalRole: 'striker',
        spawnOptions: {
          doctrine: 'escort_bomber',
          hpOverride: lancerMaxHp,
          speedOverride: mode === 'outbound' ? 21 : 24,
          waypoints,
          onWaypointsComplete: () => {
            if (mode === 'outbound') this.signalFeetDry();
            else this.signalLancerRecovered();
          },
        },
      });
      lancer.health = startHp;
      this.escortLancer = lancer;

      // 3. Spawn friendly F-22 Raptor wingmen flanking the Lancer
      const wingmen = mode === 'outbound' ? STRAIT_OUTBOUND_WINGMAN_SPAWNS : STRAIT_INBOUND_WINGMAN_SPAWNS;
      const baseLancerStart = rawPath[0]!;
      const offX = lancerStart.x - baseLancerStart[0];
      const offY = lancerStart.y - baseLancerStart[1];
      const offZ = lancerStart.z - baseLancerStart[2];
      for (let i = 0; i < wingmen.length; i++) {
        const w = wingmen[i]!;
        this.airWing.spawnAlly(
          'raptor',
          new THREE.Vector3(w.at[0] + offX, w.at[1] + offY, w.at[2] + offZ),
          w.yaw,
          0.8,
          {
            label: i === 0 ? 'VIPER-2 (F-22)' : 'VIPER-3 (F-22)',
            tacticalRole: 'hunter',
          },
        );
      }
    }

    // 4. Spawn dynamic sinkable Southern Missile Destroyers (SNS IRONCLAD & SNS BASTION) for Outbound Beats 1–2
    if (mode === 'outbound' && stage !== 'coastal') {
      this.destroyers?.spawnShips(STRAIT_DESTROYERS);
    }

    this.syncHud();
  }

  private spawnWave(waveName: string): void {
    const entries = STRAIT_WAVES[waveName];
    if (!entries || !this.airWing) return;
    this.spawnedWaveNames.add(waveName);

    const anchor = this.escortLancer?.position ?? _v.set(0, 100, 0);
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      const pos = spawnPointForSector(entry.sectorId, entry.spawnIndex);
      // Slight deterministic spread so simultaneous spawns never stack on one point
      pos.x += (i - (entries.length - 1) * 0.5) * 28;
      pos.y += (i % 2) * 14;
      const yaw = yawToward(pos, anchor);
      this.airWing.spawnEnemy(entry.kind, pos, yaw, entry.skill, {
        waveId: waveName,
        label: entry.label,
        tacticalRole: entry.kind === 'raptor' || entry.kind === 'hornet' ? 'hunter' : 'striker',
        spawnOptions: {
          priorityTarget: this.escortLancer,
        },
      });
    }

    this.ctx.hud?.feed?.(
      `RADAR CONTACT: ${entries.length} HOSTILES INBOUND (${waveName.replace(/_/g, ' ').toUpperCase()})`,
      '#ff5a4f',
    );
  }

  private activateDestroyers(): void {
    if (this.destroyersHot || !this.defenses) return;
    this.destroyersHot = true;
    if (this.destroyers && this.destroyers.totalCount === 0) {
      this.destroyers.spawnShips(STRAIT_DESTROYERS);
    }
    const liveMounts = this.destroyers && this.destroyers.totalCount > 0
      ? STRAIT_DESTROYER_MOUNTS.filter(m => this.destroyers!.getShip(m.shipId)?.alive !== false)
      : STRAIT_DESTROYER_MOUNTS;
    if (liveMounts.length > 0) {
      this.defenses.mountStraitDestroyers(liveMounts);
      this.ctx.hud?.feed?.('SNS IRONCLAD & SNS BASTION WEAPONS HOT — SINK WARSHIPS OR KILL SEARAMs!', '#ff4d3d');
    } else {
      this.checkDestroyerSuppression();
    }
  }

  private checkDestroyerSuppression(): void {
    if (!this.destroyersHot || this.destroyersSuppressedSignaled || !this.defenses) return;
    const allShipsSunk = Boolean(this.destroyers && this.destroyers.allSunkOrSinking);
    const total = this.defenses.totalCount;
    const destroyed = total - this.defenses.aliveCount;
    const aliveSams = this.defenses.getSitesByKind('destroyer_sam').filter(s => s.alive).length;
    if (allShipsSunk || (total > 0 && (aliveSams === 0 || destroyed >= Math.ceil(total * 0.5)))) {
      this.destroyersSuppressedSignaled = true;
      this.ctx.hud?.feed?.(
        allShipsSunk
          ? 'BOTH SOUTHERN MISSILE DESTROYERS SUNK — CORRIDOR CLEAR!'
          : 'SOUTHERN MISSILE DESTROYERS SUPPRESSED!',
        '#54ff9d',
      );
      this.runner.signal(CROSSFIRE_SIGNALS.destroyersSuppressed);
    }
  }

  private signalFeetDry(): void {
    if (this.feetDrySignaled) return;
    this.feetDrySignaled = true;
    this.runner.signal(CROSSFIRE_SIGNALS.straitFeetDry);
  }

  private signalLancerRecovered(): void {
    if (this.lancerRecoveredSignaled) return;
    this.lancerRecoveredSignaled = true;
    this.ctx.hud?.feed?.('B-1B LANCER INSIDE CVN-91 CARRIER UMBRELLA — SAFE RECOVERY!', '#54ff9d');
    this.runner.signal(CROSSFIRE_SIGNALS.lancerRecovered);
  }

  private activateCarrierUmbrella(): void {
    this.umbrellaActive = true;
    this.umbrellaFireCd = 0.25;
    this.ctx.hud?.feed?.('CVN-91 & ESCORT FRIGATES WEAPONS FREE — CARRIER UMBRELLA HOT!', '#38e8ff');
  }

  private handoffToHalcyon(): void {
    if (this.handoffTriggered) return;
    this.handoffTriggered = true;

    const prev = loadChainState() ?? createInitialChainState({ part: 2, contractor: 'B' });
    const prog = this.ctx.progression;
    const lancerMaxHp = this.escortLancer?.maxHealth ?? prev.lancerMaxHp;
    const lancerHp = Math.max(
      Math.round(lancerMaxHp * 0.25),
      Math.round(this.escortLancer?.health ?? prev.lancerHp),
    );

    this.hudOverlay.hide();
    void transitionToCrossfirePart(
      'crossfire_halcyon',
      {
        part: 3,
        contractor: 'A',
        lancerHp,
        lancerMaxHp,
        score: (prev.score ?? 0) + (prog?.score ?? 0),
        kills: (prev.kills ?? 0) + (prog?.kills ?? 0),
        elapsed: (prev.elapsed ?? 0) + (this.runner.elapsed ?? 0),
        deaths: (prev.deaths ?? 0) + (this.runner.deaths ?? 0),
      },
      'TRANSFERRING TO CONTRACTOR #7712-A // B-1B LANCER COCKPIT',
      {
        sublabel: 'FEET-DRY OVER FORTRESS HALCYON · 4-MODE BOMB BAYS ARMED',
      },
    );
  }

  private runCrossfireDebrief(): void {
    if (this.debriefComplete) return;
    this.debriefComplete = true;
    this.hudOverlay.hide();
    recordMissionWin('crossfire');
    clearChainState();
    this.ctx.hud?.feed?.('FORM 7742-W CLOSED — CROSSFIRE CAMPAIGN COMPLETE', '#54ff9d');
  }

  private applyDuskAtmosphere(): void {
    const scene = this.ctx.render?.scene;
    if (!scene || this.duskApplied) return;
    this.duskApplied = true;
    if (scene.background instanceof THREE.Color) {
      this.savedBgColor = scene.background.clone();
      scene.background.setHex(0x4a221d);
    }
    if (scene.fog && 'color' in scene.fog && scene.fog.color instanceof THREE.Color) {
      this.savedFogColor = scene.fog.color.clone();
      scene.fog.color.setHex(0x6b3224);
    }
  }

  private restoreAtmosphere(): void {
    if (!this.duskApplied) return;
    this.duskApplied = false;
    const scene = this.ctx.render?.scene;
    if (!scene) return;
    if (this.savedBgColor && scene.background instanceof THREE.Color) {
      scene.background.copy(this.savedBgColor);
    }
    if (this.savedFogColor && scene.fog && 'color' in scene.fog && scene.fog.color instanceof THREE.Color) {
      scene.fog.color.copy(this.savedFogColor);
    }
    this.savedBgColor = null;
    this.savedFogColor = null;
  }

  private tickCarrierUmbrella(dt: number): void {
    if (!this.umbrellaActive || !this.airWing) return;
    this.umbrellaFireCd -= dt;
    if (this.umbrellaFireCd > 0) return;
    this.umbrellaFireCd = 0.55;

    const carrierPos = _origin.set(
      STRAIT_CARRIER_CENTER[0],
      STRAIT_CARRIER_CENTER[1] + 14,
      STRAIT_CARRIER_CENTER[2],
    );
    const liveEnemies = this.airWing.enemies.filter(e => e.alive && !e.disposed);
    if (liveEnemies.length === 0) return;

    // Pick closest pursuing bandit within 780 m of CVN-91 or escort frigates
    let target: AiCombatJet | null = null;
    let bestDist = 780;
    for (const e of liveEnemies) {
      const d = e.position.distanceTo(carrierPos);
      if (d < bestDist) {
        bestDist = d;
        target = e;
      }
    }
    if (!target) return;

    // Alternate fire between CVN-91 and the two escort frigates (USS Harbinger / USS Resolute)
    const shipPick = Math.floor(Math.random() * 3);
    if (shipPick === 0) {
      _v.copy(carrierPos);
    } else {
      const escort = STRAIT_FRIENDLY_ESCORTS[shipPick - 1]!;
      _v.set(escort.x, 12, escort.z);
    }

    const useMissile = bestDist > 260 && Math.random() < 0.45;
    this.airWing.fireFriendlyDefenseShot(_v, target, useMissile, useMissile ? 140 : 42);
    this.ctx.audio?.play?.(useMissile ? 'rocket_fire' : 'mounted_gun', {
      position: _v,
      volume: 0.42,
      pitch: useMissile ? 1.15 : 1.35,
    });
  }

  private updateLancerEscortHolding(lancer: AiCombatJet): void {
    // During intro flyby cutscenes, keep the Lancer at scenic flyby pace so she never races ahead before the player gets control.
    if (this.isCutscenePlaying()) {
      lancer.setHoldingOrbit(null);
      lancer.setSpeedOverride(10);
      this.activeOrbitTag = null;
      return;
    }

    let wantTag: string | null = null;
    let wantOrbit: EscortHoldingOrbit | null = null;
    let feedMsg: string | null = null;

    if (this.mode === 'outbound') {
      const probeActive = !this.destroyersHot && !this.feetDryWatchActive && !this.airWing?.isWaveCleared('outbound_probe');
      const gauntletActive = this.destroyersHot && (
        !this.destroyersSuppressedSignaled ||
        (this.spawnedWaveNames.has('destroyer_strike') && !this.airWing?.isWaveCleared('destroyer_strike'))
      );
      const coastalActive = this.feetDryWatchActive &&
        this.spawnedWaveNames.has('coastal_aces') &&
        !this.airWing?.isWaveCleared('coastal_aces');

      if (probeActive && (this.activeOrbitTag === 'probe' || lancer.position.z <= 290)) {
        wantTag = 'probe';
        wantOrbit = LANCER_ORBIT_PROBE;
        feedMsg = 'B-1B LANCER HOLDING DEFENSIVE ORBIT — SPLASH THE INTERCEPT PROBE!';
      } else if (gauntletActive && (this.activeOrbitTag === 'destroyers' || lancer.position.z <= 165)) {
        wantTag = 'destroyers';
        wantOrbit = LANCER_ORBIT_DESTROYERS;
        feedMsg = 'B-1B LANCER HOLDING DEFENSIVE ORBIT — SINK DESTROYERS & CLEAR STRIKE WING!';
      } else if (coastalActive && (this.activeOrbitTag === 'coastal' || lancer.position.z <= -310)) {
        wantTag = 'coastal';
        wantOrbit = LANCER_ORBIT_COASTAL;
        feedMsg = 'B-1B LANCER HOLDING OFFSHORE ORBIT — DOWN HALVORSEN’S COASTAL ACES!';
      }
    } else if (this.mode === 'return') {
      const ambushActive = !this.umbrellaActive &&
        this.spawnedWaveNames.has('return_ambush') &&
        !this.airWing?.isWaveCleared('return_ambush');
      if (ambushActive && (this.activeOrbitTag === 'return_ambush' || lancer.position.z >= -220)) {
        wantTag = 'return_ambush';
        wantOrbit = LANCER_ORBIT_RETURN_AMBUSH;
        feedMsg = 'WOUNDED LANCER EVADING IN DEFENSIVE ORBIT — BREAK RED-WING AMBUSH!';
      }
    }

    if (wantTag !== this.activeOrbitTag) {
      const prevTag = this.activeOrbitTag;
      this.activeOrbitTag = wantTag;
      lancer.setHoldingOrbit(wantOrbit);
      if (wantOrbit && feedMsg) {
        this.ctx.hud?.feed?.(feedMsg, '#ffd166');
      } else if (prevTag && !wantOrbit) {
        this.ctx.hud?.feed?.('CORRIDOR CLEAR — B-1B LANCER RESUMING TRANSIT!', '#54ff9d');
      }
    }

    lancer.setSpeedOverride(wantOrbit ? wantOrbit.speed ?? 44 : 25);
  }

  private formatDestroyerStatus(): string {
    const ships = this.destroyers?.ships ?? [];
    if (ships.length === 0) return 'SNS IRONCLAD & SNS BASTION SEARAM SAMs ACTIVE';
    const parts = ships.map(s => {
      const short = s.id.includes('west') ? 'IRONCLAD' : s.id.includes('east') ? 'BASTION' : s.label;
      return s.alive ? `${short} ${Math.round(s.healthRatio * 100)}%` : `${short} SUNK`;
    });
    const suffix = this.escortLancer?.isHoldingOrbit ? ' · LANCER HOLDING ORBIT' : ' · SINK WARSHIPS';
    return `${parts.join(' · ')}${suffix}`;
  }

  private syncHud(): void {
    if (this.mode === 'none' || !this.escortLancer || this.debriefComplete) {
      this.hudOverlay.hide();
      return;
    }
    const lancer = this.escortLancer;
    const startZ = this.mode === 'outbound'
      ? STRAIT_OUTBOUND_LANCER_PATH[0]![2]
      : STRAIT_INBOUND_LANCER_PATH[0]![2];
    const targetZ = this.mode === 'outbound' ? STRAIT_FEET_DRY_Z : STRAIT_CARRIER_RECOVERY_Z;
    const progress = clamp((lancer.position.z - startZ) / (targetZ - startZ), 0, 1);
    const remainingDist = Math.max(0, Math.abs(targetZ - lancer.position.z));
    const speed = Math.max(18, lancer.speed);
    const bandits = this.airWing?.aliveEnemyCount() ?? 0;
    const holdingOrbit = lancer.isHoldingOrbit;

    let statusLine: string | undefined;
    if (this.mode === 'outbound') {
      if (this.destroyersHot && !this.destroyersSuppressedSignaled) {
        statusLine = this.formatDestroyerStatus();
      } else if (this.feetDryWatchActive) {
        statusLine = holdingOrbit
          ? 'LANCER HOLDING OFFSHORE ORBIT — DOWN COASTAL ACES'
          : 'APPROACHING HALCYON COASTLINE — CLEAR REMAINING BANDITS';
      } else if (holdingOrbit) {
        statusLine = 'LANCER HOLDING DEFENSIVE ORBIT — SPLASH INTERCEPT PROBE';
      }
    } else if (this.umbrellaActive) {
      statusLine = 'CVN-91 CARRIER UMBRELLA HOT — ESCORT LANCER SOUTH';
    } else {
      statusLine = holdingOrbit
        ? 'WOUNDED LANCER HOLDING DEFENSIVE ORBIT — BREAK RED-WING AMBUSH'
        : 'WOUNDED LANCER TRAILING SMOKE — DEFEND HER SIX!';
    }

    let repairBanner: { text: string; tone: 'repair' | 'hint' } | null = null;
    const raptor = this.playerRaptor;
    if (raptor?.alive && raptor.occupied && raptor.def.maxHealth > 0) {
      const hullPct = Math.round((raptor.health / raptor.def.maxHealth) * 100);
      if (this.formationRepairActive) {
        repairBanner = {
          text: `✦ LANCER FORMATION REPAIR ACTIVE · F-22 HULL ${hullPct}% (+${LANCER_FORMATION_REPAIR_RATE} HP/S)`,
          tone: 'repair',
        };
      } else if (hullPct < 75 && lancer.alive) {
        repairBanner = {
          text: `F-22 HULL ${hullPct}% — FLY ALONGSIDE B-1B LANCER TO REPAIR`,
          tone: 'hint',
        };
      }
    }

    this.hudOverlay.updateStrait({
      mode: this.mode,
      lancerHp: lancer.health,
      lancerMaxHp: lancer.maxHealth,
      progress,
      etaSeconds: remainingDist / speed,
      banditsRemaining: bandits,
      holdingOrbit,
      statusLine,
      repairBanner,
    });
  }

  private tickFormationRepair(dt: number): void {
    const raptor = this.playerRaptor;
    const lancer = this.escortLancer;
    if (!raptor || !raptor.alive || !raptor.occupied || !lancer || !lancer.alive) {
      this.formationRepairActive = false;
      return;
    }

    const dist = raptor.phys.position.distanceTo(lancer.position);
    if (dist <= LANCER_FORMATION_REPAIR_RADIUS && raptor.health < raptor.def.maxHealth) {
      const wasActive = this.formationRepairActive;
      this.formationRepairActive = true;
      const prevHp = raptor.health;
      raptor.health = Math.min(raptor.def.maxHealth, raptor.health + LANCER_FORMATION_REPAIR_RATE * dt);
      this.ctx.player?.heal?.(20 * dt);

      this.repairFxCd -= dt;
      if (!wasActive || this.repairFxCd <= 0) {
        this.repairFxCd = 0.65;
        this.ctx.audio?.play?.('heal_tick', { volume: 0.34, pitch: 1.08 });
        this.ctx.fx?.sparks?.(raptor.phys.position, new THREE.Vector3(0, 1, 0), 6, 0x54ff9d);
      }
      if (prevHp < raptor.def.maxHealth && raptor.health >= raptor.def.maxHealth) {
        this.ctx.hud?.feed?.('F-22 HULL REPAIRED TO 100% — FORMATION LINK COMPLETE!', '#54ff9d');
      }
    } else {
      this.formationRepairActive = false;
    }
  }

  private tickPlayerAircraftSurvival(dt: number): void {
    if (this.debriefComplete || this.handoffTriggered || this.isCutscenePlaying()) return;
    const p = this.ctx.player;
    if (!p || !p.alive) return;

    // 1. Player's F-22 Raptor was shot down or crashed: brief explosion beat, then clean death -> Restart from Checkpoint!
    if (this.playerRaptor && !this.playerRaptor.alive) {
      if (this.playerCrashTimer < 0) {
        this.playerCrashTimer = 0.75;
        this.ctx.hud?.feed?.('F-22 RAPTOR SHOT DOWN — EJECTING!', '#ff3b2f');
      }
      this.playerCrashTimer -= dt;
      if (this.playerCrashTimer <= 0 || p.position.y < 18) {
        this.downPlayerCleanly('aircraft_destroyed');
      }
      return;
    }

    // 2. If player accidentally bailed out over open sea and hits the water, cleanly trigger checkpoint redeploy.
    if (this.playerRaptor && !this.playerRaptor.occupied && p.position.y < 14) {
      this.downPlayerCleanly('sea_impact');
    }
  }

  update(dt: number): void {
    if (!this.built || this.mode === 'none' || dt <= 0) return;

    // 0. Keep Contractor B's F-22 Raptor in formation through the intro flyby cutscene and re-seat cleanly when control hands back
    if (!this.introReboardDone && this.playerRaptor?.alive) {
      if (this.isCutscenePlaying()) {
        this.introCutsceneSeen = true;
        this.positionPlayerRaptorInFormation(this.playerRaptor);
      } else if (this.introCutsceneSeen) {
        this.introReboardDone = true;
        if (this.playerRaptor.occupied) this.playerRaptor.exit(true);
        this.positionPlayerRaptorInFormation(this.playerRaptor);
        this.playerRaptor.board(0);
      }
    }

    // 0b. Cleanly handle aircraft shot-down / sea impact -> checkpoint restart
    this.tickPlayerAircraftSurvival(dt);

    // 0c. Lancer formation proximity repair aura
    this.tickFormationRepair(dt);

    // 0d. Engage or release Lancer defensive racetrack holding orbit before ticking flight AI
    if (this.escortLancer?.alive) {
      this.updateLancerEscortHolding(this.escortLancer);
    }

    // 1. Tick two-way dogfight air wing with escort Lancer as shared priority target
    this.airWing?.update(dt, this.escortLancer);

    // 1b. Tick dynamic sinkable Southern Missile Destroyers (smoke plumes, chain explosions, listing & sinking)
    this.destroyers?.update(dt);

    // 2. Tick Mid-Strait Southern Missile Destroyer SAMs & CIWS
    if (this.destroyersHot && this.defenses) {
      const playerAirborne = Boolean(this.ctx.player?.alive && (this.ctx.player.parked || this.ctx.player.position.y > 16));
      this.defenses.update(dt, {
        playerAirborne,
        playerVelocity: this.playerRaptor?.alive ? this.playerRaptor.phys.velocity : undefined,
        alliedJets: this.airWing?.allies ?? [],
      });
      this.checkDestroyerSuppression();
    }

    // 3. Lancer transit milestones, adaptive clear-sky pace, and Part 4 smoke plume
    const lancer = this.escortLancer;
    if (lancer && lancer.alive) {
      if (this.mode === 'outbound') {
        if (!this.lancerMidstraitSignaled && lancer.position.z <= -100) {
          this.lancerMidstraitSignaled = true;
          this.runner.signal(CROSSFIRE_SIGNALS.lancerMidstrait);
        }
        // Adaptive boost if coastal_aces is already cleared so player isn't left waiting in empty sky
        if (this.feetDryWatchActive && this.airWing?.isWaveCleared('coastal_aces')) {
          lancer.position.z -= dt * 48;
        }
        if ((this.feetDryWatchActive || lancer.position.z <= STRAIT_FEET_DRY_Z) && lancer.position.z <= STRAIT_FEET_DRY_Z) {
          this.signalFeetDry();
        }
      } else if (this.mode === 'return') {
        // Battle-damaged Lancer trails heavy dark smoke across the dusk sky
        this.smokeTrailCd -= dt;
        if (this.smokeTrailCd <= 0) {
          this.smokeTrailCd = 0.14;
          _v.copy(lancer.position).add(new THREE.Vector3(rand(-4, 4), rand(-0.6, 0.8), rand(-3, 3)));
          this.ctx.fx?.smoke?.(_v, '#2b2826', 3.4, 2.2);
        }
        // Adaptive sprint into carrier umbrella once final pursuers are splashed
        if (this.umbrellaActive && this.airWing?.isWaveCleared('return_final')) {
          lancer.position.z += dt * 48;
        }
        if (lancer.position.z >= STRAIT_CARRIER_RECOVERY_Z) {
          this.signalLancerRecovered();
        }
      }
    }

    // 4. Part 4 Friendly Carrier Strike Group CIWS/SAM umbrella
    this.tickCarrierUmbrella(dt);

    // 5. Refresh Strait Escort HUD
    this.syncHud();
  }

  /** Exposed for unit tests & runtime inspection. */
  get airWingInstance(): CrossfireAirWing | null {
    return this.airWing;
  }

  get defenseSystem(): BaseDefenseSystem | null {
    return this.defenses;
  }

  get destroyerFleet(): DestroyerFleet | null {
    return this.destroyers;
  }

  get lancer(): AiCombatJet | null {
    return this.escortLancer;
  }

  get playerJet(): DriveableVehicle | null {
    return this.playerRaptor;
  }

  get state() {
    return {
      mode: this.mode,
      destroyersHot: this.destroyersHot,
      destroyersSuppressedSignaled: this.destroyersSuppressedSignaled,
      destroyersAlive: this.destroyers?.aliveCount ?? 0,
      holdingOrbit: this.escortLancer?.isHoldingOrbit ?? false,
      activeOrbitTag: this.activeOrbitTag,
      lancerMidstraitSignaled: this.lancerMidstraitSignaled,
      feetDryWatchActive: this.feetDryWatchActive,
      feetDrySignaled: this.feetDrySignaled,
      umbrellaActive: this.umbrellaActive,
      lancerRecoveredSignaled: this.lancerRecoveredSignaled,
      lancerFailed: this.lancerFailed,
      formationRepairActive: this.formationRepairActive,
      handoffTriggered: this.handoffTriggered,
      debriefComplete: this.debriefComplete,
      spawnedWaves: [...this.spawnedWaveNames],
      enemyCount: this.airWing?.aliveEnemyCount() ?? 0,
      allyCount: this.airWing?.allies.length ?? 0,
      lancerHp: this.escortLancer?.health ?? 0,
    };
  }

  private clearMissionState(): void {
    this.restoreAtmosphere();
    this.airWing?.clear();
    this.defenses?.clear();
    this.destroyers?.clear();
    this.hudOverlay.hide();

    this.mode = 'none';
    this.escortLancer = null;
    this.playerRaptor = null;
    this.playerSpawnPose = null;
    this.introCutsceneSeen = false;
    this.introReboardDone = false;
    this.destroyersHot = false;
    this.destroyersSuppressedSignaled = false;
    this.lancerMidstraitSignaled = false;
    this.feetDryWatchActive = false;
    this.feetDrySignaled = false;
    this.umbrellaActive = false;
    this.umbrellaFireCd = 0;
    this.lancerRecoveredSignaled = false;
    this.lancerFailed = false;
    this.handoffTriggered = false;
    this.debriefComplete = false;
    this.smokeTrailCd = 0;
    this.formationRepairActive = false;
    this.repairFxCd = 0;
    this.playerCrashTimer = -1;
    this.activeOrbitTag = null;
    this.spawnedWaveNames.clear();
  }

  clear(): void {
    this.clearMissionState();
  }

  reset(): void {
    this.clearMissionState();
    this.airWing?.dispose();
    this.airWing = null;
    this.defenses?.dispose();
    this.defenses = null;
    this.destroyers?.dispose();
    this.destroyers = null;
    this.built = false;
  }
}
