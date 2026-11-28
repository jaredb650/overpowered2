/**
 * Runtime mission director for **Deprecation** (`Form 7742-A`, map `openmind`).
 *
 * Orchestrates every Deprecation-specific set piece without polluting core engine systems:
 *   - `ZiplineManager` (`zipline.ts`)         — Tower 1->2 sabotaged canyon cable & Tower 3->HQ glass-breach cable
 *   - `GrappleMarkManager` (`grappleMarks.ts`)— Skyline crane booms, Spire Plaza pillars & ORION-0 Stage 3B shoulder anchor
 *   - `ServiceElevator` (`elevator.ts`)       — 25 s Service Lobby hold, rigged shaft plunge, 4 hydraulic brake clamps
 *   - `CivilianCrowd` (`civilians.ts`)        — <= 24 fleeing Grand Boulevard civilians heading to glowing SUBWAY shelters
 *   - `OrionBoss` (`orionBoss.ts`)            — 12 m multi-stage AEGIS-0 / ORION-0 mech boss across Boulevard, Intersection & Spire Plaza
 *   - Skyline chasm kill plane (`y < SKYLINE_KILL_Y` north of Tower 4), 80th-floor glass-breach detection,
 *     Sub-Level 4 Compute Vault tracker (3 Compute Clusters + 4 Air-Gap Pylons), and unified mission HUD bars.
 */
import * as THREE from 'three';
import type { Ctx, DestructionManagerLike } from '../../core/contracts';
import { clamp } from '../../core/math';
import type { EnemyManager } from '../../enemies/EnemyManager';
import type { VehicleSystem } from '../../enemies/vehicles';
import { div, Label, span } from '../../ui/dom';
import type { Objects } from '../../world/objects';
import {
  BOULEVARD,
  DATACENTER,
  ELEVATOR_SHAFT,
  GRAPPLE_ANCHORS,
  OFFICE,
  SKYLINE_KILL_Y,
  TOWER_BY_ID,
  ZIPLINES,
} from '../../world/map/openmind/plan';
import type { GameHost } from '../host';
import type { CampaignHud } from '../hud';
import type { MissionRunner } from '../runner';
import { CivilianCrowd, type CivilianRouteDef } from './civilians';
import { ServiceElevator, type ElevatorState } from './elevator';
import { GrappleMarkManager } from './grappleMarks';
import { OrionBoss, type OrionArenaConfig, type OrionHudState, type OrionStage } from './orionBoss';
import { ZiplineManager } from './zipline';

/** Every `dp.*` mission script call supported by `DeprecationDirector`. */
export const DEPRECATION_CALLS: ReadonlySet<string> = new Set([
  'dp.skyline',
  'dp.chopperWatch',
  'dp.glassRun',
  'dp.office',
  'dp.elevatorHold',
  'dp.elevatorRide',
  'dp.datacenter',
  'dp.breakout',
  'dp.orionStage1',
  'dp.orionStage2',
  'dp.orionStage3',
  'dp.hideBoss',
]);

const _tmpVec = new THREE.Vector3();
const _tmpShoulder = new THREE.Vector3();
const _tmpSpawn = new THREE.Vector3();

/** Fraction of a compute cluster's server racks that must be destroyed for the cluster to count neutralized. */
const CLUSTER_DESTROY_FRAC = 0.6;

/** Maximum concurrent Stage 2 boss drones alive at once to keep downtown combat brisk and capped. */
const MAX_ACTIVE_BOSS_DRONES = 8;

interface HarpoonProbe {
  harpoon?: { state?: string };
}

type HudMode = 'none' | 'elevator' | 'vault' | 'orion';

function buildOrionArena(): OrionArenaConfig {
  const subs = BOULEVARD.spirePlaza.substations;
  return {
    dormantPos: DATACENTER.aegisBay.center,
    vaultBreachPos: [0, -2, DATACENTER.breakoutRamp.bulkheadZ],
    boulevardStart: [0, 0, 62],
    boulevardBounds: { minX: -24, maxX: 24, minZ: 24, maxZ: BOULEVARD.skybridge.z - 4 },
    skybridgePos: [0, BOULEVARD.skybridge.deckY, BOULEVARD.skybridge.z],
    skybridgeTag: BOULEVARD.skybridge.tag,
    intersectionStart: [0, 0, BOULEVARD.intersection.center[2]],
    intersectionBounds: {
      minX: -34,
      maxX: 34,
      minZ: BOULEVARD.intersection.z0,
      maxZ: BOULEVARD.intersection.z1 - 2,
    },
    cornerColumns: BOULEVARD.intersection.corners.map(c => ({
      id: c.tag,
      tag: c.tag,
      pos: [c.colFaceX, 0, c.colFaceZ] as const,
      radius: 3.4,
    })),
    spirePos: [8, 0, BOULEVARD.spirePlaza.spireCenter[2] + 4],
    spireBounds: {
      minX: -36,
      maxX: 36,
      minZ: BOULEVARD.spirePlaza.z0 + 2,
      maxZ: BOULEVARD.spirePlaza.z1 - 2,
    },
    conduitPositions: [subs[0].pos, subs[1].pos, subs[2].pos],
  };
}

function buildCivilianRoutes(): CivilianRouteDef[] {
  const [w1, e1, w2, e2] = BOULEVARD.subwayEntrances;
  return [
    {
      id: 'west_north',
      waypoints: [[-20, 0, 26], [-20, 0, 35], [w1.x, 0, w1.z]],
      subwayExit: [w1.x, 0, w1.z],
    },
    {
      id: 'east_mid',
      waypoints: [[20, 0, 32], [20, 0, 56], [e1.x, 0, e1.z]],
      subwayExit: [e1.x, 0, e1.z],
    },
    {
      id: 'west_inter',
      waypoints: [[-21, 0, 74], [-21, 0, 92], [w2.x, 0, w2.z]],
      subwayExit: [w2.x, 0, w2.z],
    },
    {
      id: 'east_inter',
      waypoints: [[21, 0, 88], [21, 0, 104], [e2.x, 0, e2.z]],
      subwayExit: [e2.x, 0, e2.z],
    },
  ];
}

export class DeprecationDirector {
  private built = false;
  private disposed = false;

  // Subsystems
  private ziplines: ZiplineManager | null = null;
  private grappleMarks: GrappleMarkManager | null = null;
  private elevator: ServiceElevator | null = null;
  private civilians: CivilianCrowd | null = null;
  private orion: OrionBoss | null = null;

  // Skyline & office watchers
  private skylineKillActive = false;
  private chopperWatchActive = false;
  private chopperGrappled = false;
  private zipSnapped = false;
  private zipSaved = false;
  private glassWatchActive = false;
  private glassBreached = false;
  private initialCurtainPanes = 0;

  // Datacenter demolition tracker
  private vaultActive = false;
  private vaultClustersSignalled = false;
  private vaultClearedSignalled = false;
  private readonly clusterTotals = new Map<string, number>();
  private readonly clusterDone = new Set<string>();
  private readonly vaultMarkers = new Map<string, () => void>();

  // Boss progression guards
  private stage1DoneSignalled = false;
  private stage2DoneSignalled = false;
  private conduitsDownSignalled = false;
  private empEjectSignalled = false;
  private orionDeadSignalled = false;
  private readonly bossDroneUids = new Set<number>();

  // Unified HUD bar (reuses campaign.css `.fc-bar`, `.fc-pips`, `.fc-clause`)
  private readonly hudEl: HTMLElement;
  private readonly hudTitle: Label;
  private readonly hudPhase: Label;
  private readonly hudPct: Label;
  private readonly hudFill: HTMLElement;
  private readonly hudPipRow: HTMLElement;
  private readonly hudClause: Label;
  private readonly hudPips = new Map<string, HTMLElement>();
  private hudMode: HudMode = 'none';
  private hudPipSignature = '';

  // Large center-screen zipline grab & ride prompt (campaign.css `.dp-zip-prompt`)
  private readonly zipPromptEl: HTMLElement;
  private readonly zipPromptBadge: Label;
  private readonly zipPromptMain: Label;
  private readonly zipPromptSub: Label;
  private zipPromptState: 'off' | 'ready' | 'riding' = 'off';

  private readonly unsubs: (() => void)[] = [];

  constructor(
    private readonly ctx: Ctx,
    private readonly runner: MissionRunner,
    private readonly ui: CampaignHud,
  ) {
    const titleEl = span('fc-title', 'ORION-0');
    const phaseEl = span('fc-phase', '');
    const pctEl = span('fc-pct', '100%');
    const clauseEl = div('fc-clause');
    this.hudFill = div('fc-fill');
    this.hudPipRow = div('fc-pips');
    this.hudEl = div(
      'fc-bar fc-boss',
      div('fc-head', titleEl, phaseEl, pctEl),
      div('fc-track', this.hudFill),
      this.hudPipRow,
      clauseEl,
    );
    this.hudTitle = new Label(titleEl);
    this.hudPhase = new Label(phaseEl);
    this.hudPct = new Label(pctEl);
    this.hudClause = new Label(clauseEl);
    this.ui.el.append(this.hudEl);

    const zipBadgeEl = div('dp-zip-badge');
    const zipMainEl = div('dp-zip-main');
    const zipSubEl = div('dp-zip-sub');
    this.zipPromptEl = div('dp-zip-prompt', zipBadgeEl, zipMainEl, zipSubEl);
    this.zipPromptBadge = new Label(zipBadgeEl);
    this.zipPromptMain = new Label(zipMainEl);
    this.zipPromptSub = new Label(zipSubEl);
    this.ui.el.append(this.zipPromptEl);

    if (ctx.events?.on) {
      this.unsubs.push(
        ctx.events.on('enemy:killed', e => {
          this.bossDroneUids.delete(e.enemy.uid);
        }),
      );
    }
  }

  private get manager(): EnemyManager {
    return this.ctx.enemies as EnemyManager;
  }

  private get vehicles(): VehicleSystem | null {
    return this.manager.vehicles ?? null;
  }

  private get worldObjects(): Objects | null {
    return (this.ctx.world?.objects as Objects | undefined) ?? null;
  }

  private get destruction(): DestructionManagerLike | null {
    return this.ctx.world?.objects?.destruction ?? null;
  }

  private get harpoonState(): string | null {
    return (this.ctx.weapons as unknown as HarpoonProbe | undefined)?.harpoon?.state ?? null;
  }

  // -----------------------------------------------------------------------------------------------
  // Frame provider wrapper (Stage 3B EMP Eject & Spire Plaza grapple beacons)
  // -----------------------------------------------------------------------------------------------

  wrapFrame(host: GameHost): void {
    const base = host.frame.bind(host);
    host.frame = (act, at, done) => {
      if (act === 'eject') {
        this.enableSectionGrappleMarks('boss_stage3');
        this.grappleMarks?.setEnabled('orion_shoulder', true);
      }
      base(act, at, done);
    };
  }

  // -----------------------------------------------------------------------------------------------
  // Lazy world construction
  // -----------------------------------------------------------------------------------------------

  ensureBuilt(): void {
    if (this.built || this.disposed) return;
    this.built = true;

    // 1. Ziplines (Tower 1 -> Tower 2 sabotaged canyon cable + Tower 3 -> HQ glass breach cable)
    this.ziplines = new ZiplineManager(this.ctx, {
      onSnap: (id) => {
        if (id === 'canyon_zipline' && !this.zipSnapped) {
          this.zipSnapped = true;
          this.grappleMarks?.setEnabled('tower2_rescue_crane', true);
          this.runner.signal('dp:zipline_snapped');
        }
      },
    });
    for (const z of ZIPLINES) {
      this.ziplines.add({
        id: z.id,
        start: z.start,
        end: z.end,
        snapAt: z.snapAt ?? null,
        label: z.label,
        onComplete: (id) => {
          if (id === 'hq_launch_zipline') {
            this.shatterCurtainWallCenter();
            this.signalGlassBreached();
          }
        },
      });
    }

    // 2. Grapple Anchor Beacons (7 static plan anchors + 1 dynamic ORION-0 Stage 3B shoulder anchor)
    this.grappleMarks = new GrappleMarkManager(this.ctx, this.ui.el);
    for (const a of GRAPPLE_ANCHORS) {
      this.grappleMarks.add({
        id: a.id,
        position: a.pos,
        label: a.label,
        enabled: false,
        priority: a.id === 'tower2_rescue_crane' ? 10 : 5,
      });
    }
    this.grappleMarks.add({
      id: 'orion_shoulder',
      position: () => (this.orion && this.orion.coreExposed ? this.orion.getGrappleAnchorWorld(_tmpShoulder) : null),
      label: 'ORION-0 SHOULDER [RMB]',
      enabled: false,
      priority: 20,
      radius: 1.5,
      aimConeDeg: 28,
    });

    // 3. Rigged Service Elevator (Service Lobby y=34 -> jam y=18 -> Compute Vault y=-6)
    this.elevator = new ServiceElevator(this.ctx, {
      position: [ELEVATOR_SHAFT.cx, ELEVATOR_SHAFT.topY, ELEVATOR_SHAFT.cz],
      topY: ELEVATOR_SHAFT.topY,
      jamY: ELEVATOR_SHAFT.jamY,
      bottomY: ELEVATOR_SHAFT.bottomY,
      size: ELEVATOR_SHAFT.width,
      ceilingGrateY: ELEVATOR_SHAFT.grateY,
      doorYaw: -Math.PI / 2,
      autoStartDescentOnBoard: true,
      autoRegisterExtra: true,
      onStateChange: (state) => this.onElevatorState(state),
    });

    // 4. Grand Boulevard Fleeing Civilians (capped at 24, non-combatant, paused until Breakout)
    this.civilians = new CivilianCrowd(this.ctx, {
      routes: buildCivilianRoutes(),
      count: 24,
      autoStart: false,
      autoListenExplosions: true,
    });

    // 5. ORION-0 / AEGIS-0 Multi-Stage 12 m Mech Boss
    this.orion = new OrionBoss(
      this.ctx,
      this.vehicles,
      buildOrionArena(),
      {
        onShieldBroken: () => {
          this.runner.signal('dp:shield_broken');
        },
        onStageChange: (stage) => this.onOrionStageChange(stage),
        onStaggered: () => {
          this.runner.signal('dp:orion_staggered');
        },
        onSpawnDrones: (origin, count) => this.spawnBossDrones(origin, count),
        onConduitDestroyed: (_index, remaining) => {
          if (remaining === 0 && !this.conduitsDownSignalled) {
            this.conduitsDownSignalled = true;
            this.runner.signal('dp:conduits_down');
          }
        },
        onUploadComplete: () => {
          if (this.ctx.player.alive) {
            this.ctx.hud.feed('ORION-0 UPLOAD REACHED 100% — REDEPLOYING AT SPIRE PLAZA!', '#ff3a52');
            this.ctx.player.takeDamage({
              amount: 99999,
              from: this.orion?.position ?? _tmpVec.set(0, 0, 144),
              type: 'hazard',
              source: 'orion_spire_beam',
            });
          }
        },
        onEmpEject: () => {
          if (!this.empEjectSignalled) {
            this.empEjectSignalled = true;
            this.enableSectionGrappleMarks('boss_stage3');
            this.grappleMarks?.setEnabled('orion_shoulder', true);
            this.runner.signal('dp:emp_eject');
          }
        },
        onDefeated: () => {
          if (!this.orionDeadSignalled) {
            this.orionDeadSignalled = true;
            this.disableAllGrappleMarks();
            this.setHudMode('none');
            this.runner.signal('dp:orion_dead');
          }
        },
      },
    );
    this.orion.hide();
  }

  // -----------------------------------------------------------------------------------------------
  // Mission script call router (`dp.*`)
  // -----------------------------------------------------------------------------------------------

  call(name: string, _arg: string | undefined): void {
    this.ensureBuilt();
    switch (name) {
      case 'dp.skyline':
        this.activateSkyline();
        return;
      case 'dp.chopperWatch':
        this.chopperWatchActive = true;
        this.chopperGrappled = false;
        return;
      case 'dp.glassRun':
        this.activateGlassRun();
        return;
      case 'dp.office':
        this.activateOffice();
        return;
      case 'dp.elevatorHold':
        this.startElevatorHold();
        return;
      case 'dp.elevatorRide':
        this.ensureElevatorRide();
        return;
      case 'dp.datacenter':
        this.activateDatacenter();
        return;
      case 'dp.breakout':
        this.activateBreakout();
        return;
      case 'dp.orionStage1':
        this.activateOrionStage1();
        return;
      case 'dp.orionStage2':
        this.activateOrionStage2();
        return;
      case 'dp.orionStage3':
        this.activateOrionStage3();
        return;
      case 'dp.hideBoss':
        this.hideAllBossAndProps();
        return;
      default:
        return;
    }
  }

  // -----------------------------------------------------------------------------------------------
  // Section Activation Handlers (Checkpoint-Idempotent)
  // -----------------------------------------------------------------------------------------------

  private activateSkyline(): void {
    this.skylineKillActive = true;
    this.zipSnapped = false;
    this.zipSaved = false;
    this.glassWatchActive = false;
    this.vaultActive = false;
    this.clearVaultMarkers();
    this.setHudMode('none');
    this.ziplines?.reset();
    this.disableAllGrappleMarks();
    this.enableSectionGrappleMarks('skyline_drop');
    this.elevator?.reset();
    this.civilians?.stop();
    this.orion?.hide();
  }

  private activateGlassRun(): void {
    this.skylineKillActive = true;
    this.chopperWatchActive = false;
    this.glassWatchActive = true;
    this.glassBreached = false;
    this.vaultActive = false;
    this.clearVaultMarkers();
    this.setHudMode('none');
    this.initialCurtainPanes = this.countAliveCurtainPanes();
    this.disableAllGrappleMarks();
    this.enableSectionGrappleMarks('glass_run');
    this.elevator?.reset();
    this.civilians?.stop();
    this.orion?.hide();
  }

  private activateOffice(): void {
    this.skylineKillActive = false;
    this.chopperWatchActive = false;
    this.glassWatchActive = false;
    this.vaultActive = false;
    this.clearVaultMarkers();
    this.disableAllGrappleMarks();
    this.setHudMode('none');
    this.elevator?.reset();
    this.civilians?.stop();
    this.orion?.hide();
  }

  private startElevatorHold(): void {
    this.skylineKillActive = false;
    this.glassWatchActive = false;
    this.vaultActive = false;
    this.clearVaultMarkers();
    this.disableAllGrappleMarks();
    this.civilians?.stop();
    this.orion?.hide();
    if (this.isPlayerInVault()) {
      this.elevator?.setCheckpointState('arrived_vault');
      this.setHudMode('none');
      return;
    }
    if (this.elevator) {
      this.elevator.reset();
      this.elevator.startHold();
    }
    this.setHudMode('elevator');
  }

  private ensureElevatorRide(): void {
    if (!this.elevator) return;
    if (this.elevator.state === 'arrived_vault' || this.isPlayerInVault()) {
      if (this.elevator.state !== 'arrived_vault') {
        this.elevator.setCheckpointState('arrived_vault');
      }
      this.setHudMode('none');
      return;
    }
    if (this.elevator.state === 'idle_top' || this.elevator.state === 'holding') {
      this.elevator.openDoors();
    }
    this.setHudMode('elevator');
  }

  private activateDatacenter(): void {
    this.skylineKillActive = false;
    this.glassWatchActive = false;
    this.disableAllGrappleMarks();
    this.civilians?.stop();

    // Ensure elevator sits cleanly at the bottom of the shaft for checkpoint restarts
    if (this.elevator && this.elevator.state !== 'arrived_vault') {
      this.elevator.setCheckpointState('arrived_vault');
    }

    // Park ORION-0 dormant inside AEGIS-0 bay behind observation glass
    this.orion?.parkDormant();

    // Snapshot compute cluster rack counts & arm Sub-Level 4 HUD + world markers
    this.vaultActive = true;
    this.vaultClustersSignalled = false;
    this.vaultClearedSignalled = false;
    this.clusterTotals.clear();
    this.clusterDone.clear();
    this.clearVaultMarkers();

    for (const c of DATACENTER.clusters) {
      const alive = this.countAliveClusterRacks(c.x0, c.x1, c.z0, c.z1);
      this.clusterTotals.set(c.id, Math.max(alive, 1));
      if (alive === 0) {
        this.clusterDone.add(c.id);
      } else {
        this.vaultMarkers.set(
          c.id,
          this.ctx.hud.marker(new THREE.Vector3(c.center[0], c.center[1] + 2.4, c.center[2]), c.name, '#ff9830'),
        );
      }
    }
    for (let i = 0; i < DATACENTER.airGapCore.pylons.length; i++) {
      const p = DATACENTER.airGapCore.pylons[i]!;
      const alive = this.destruction?.getCluster(p.id) ? this.destruction.isClusterAlive(p.id) : true;
      if (alive) {
        this.vaultMarkers.set(
          p.id,
          this.ctx.hud.marker(new THREE.Vector3(p.pos[0], p.pos[1] + 3.2, p.pos[2]), `AIR-GAP PYLON ${i + 1}`, '#22ecff'),
        );
      }
    }
    this.setHudMode('vault');
  }

  private activateBreakout(): void {
    this.skylineKillActive = false;
    this.vaultActive = false;
    this.clearVaultMarkers();
    this.disableAllGrappleMarks();
    this.setHudMode('none');
    if (this.elevator && this.elevator.state !== 'arrived_vault') {
      this.elevator.setCheckpointState('arrived_vault');
    }
    this.civilians?.reset();
    this.civilians?.start();
    this.orion?.startBreakout();
  }

  private activateOrionStage1(): void {
    this.skylineKillActive = false;
    this.vaultActive = false;
    this.clearVaultMarkers();
    this.disableAllGrappleMarks();
    this.stage1DoneSignalled = false;
    this.stage2DoneSignalled = false;
    this.conduitsDownSignalled = false;
    this.empEjectSignalled = false;
    this.orionDeadSignalled = false;

    if (this.civilians && !this.civilians.isRunning) {
      this.civilians.start();
    }
    if (this.orion && this.orion.stage !== 'stage1_alignment') {
      this.orion.startStage('stage1_alignment');
    }
    this.setHudMode('orion');
  }

  private activateOrionStage2(): void {
    this.skylineKillActive = false;
    this.vaultActive = false;
    this.clearVaultMarkers();
    this.disableAllGrappleMarks();
    this.stage1DoneSignalled = true;
    this.stage2DoneSignalled = false;
    this.conduitsDownSignalled = false;
    this.empEjectSignalled = false;
    this.orionDeadSignalled = false;

    if (this.civilians && !this.civilians.isRunning) {
      this.civilians.start();
    }
    // If transitioning naturally from Stage 1, let `bridge_smash` finish cleanly; on checkpoint restart jump directly!
    if (this.orion && this.orion.stage !== 'bridge_smash' && this.orion.stage !== 'stage2_unrestricted') {
      this.orion.startStage('stage2_unrestricted');
      // Open skybridge debris visually/physically if restarting directly at Intersection checkpoint
      if (this.destruction?.getCluster(BOULEVARD.skybridge.tag) && this.destruction.isClusterAlive(BOULEVARD.skybridge.tag)) {
        this.destruction.blast(_tmpVec.set(0, BOULEVARD.skybridge.deckY, BOULEVARD.skybridge.z), 16, 2800, 'frame_charge');
      }
    }
    this.setHudMode('orion');
  }

  private activateOrionStage3(): void {
    this.skylineKillActive = false;
    this.vaultActive = false;
    this.clearVaultMarkers();
    this.disableAllGrappleMarks();
    this.stage1DoneSignalled = true;
    this.stage2DoneSignalled = true;
    this.conduitsDownSignalled = false;
    this.empEjectSignalled = false;
    this.orionDeadSignalled = false;

    if (this.civilians && !this.civilians.isRunning) {
      this.civilians.start();
    }
    if (this.orion && this.orion.stage !== 'spire_leap' && this.orion.stage !== 'stage3_meltdown') {
      this.orion.startStage('stage3_meltdown');
    }
    this.setHudMode('orion');
  }

  private hideAllBossAndProps(): void {
    this.skylineKillActive = false;
    this.chopperWatchActive = false;
    this.glassWatchActive = false;
    this.vaultActive = false;
    this.clearVaultMarkers();
    this.disableAllGrappleMarks();
    this.setHudMode('none');
    this.civilians?.stop();
  }

  // -----------------------------------------------------------------------------------------------
  // Per-Frame Update
  // -----------------------------------------------------------------------------------------------

  update(dt: number): void {
    if (!this.built || this.disposed) return;

    this.ziplines?.update(dt);
    this.grappleMarks?.update(dt);
    this.elevator?.update(dt);
    this.civilians?.update(dt);
    this.orion?.update(dt);

    this.updateSkylineWatchers();
    this.updateGlassBreachWatcher();
    this.updateElevatorVaultFallback();
    this.updateVaultTracker();
    this.updateHud();
  }

  private isPlayerInVault(): boolean {
    const player = this.ctx.player;
    if (!player || !player.alive || player.parked) return false;
    const p = player.position;
    return (
      p.x >= DATACENTER.x0 - 1 &&
      p.x <= DATACENTER.x1 + 1 &&
      p.z >= DATACENTER.z0 - 1 &&
      p.z <= DATACENTER.z1 + 1 &&
      p.y >= DATACENTER.floorY - 2 &&
      p.y <= DATACENTER.ceilY - 0.5
    );
  }

  private updateElevatorVaultFallback(): void {
    const el = this.elevator;
    if (!el || el.state === 'falling' || el.state === 'arrived_vault') return;
    const beatId = this.runner.beat?.id;
    if (beatId !== 'office_breach' && beatId !== 'elevator_drop') return;
    if (!this.isPlayerInVault()) return;

    // Player dropped down the shaft (or reached Sub-Level 4) ahead of the elevator sequence:
    // snap the cab to the bottom landing and advance cleanly into Sub-Level 4.
    el.setCheckpointState('arrived_vault');
    this.setHudMode('none');
  }

  private updateSkylineWatchers(): void {
    const player = this.ctx.player;
    if (!player || !player.alive) return;

    // 1. Skyline chasm kill plane (only active while north of Tower 4 on Towers 1–3)
    if (this.skylineKillActive && !player.parked && player.position.z < OFFICE.z0 && player.position.y < SKYLINE_KILL_Y) {
      player.takeDamage({
        amount: 9999,
        from: player.position,
        type: 'hazard',
        source: 'zipline_snap',
      });
      return;
    }

    const hState = this.harpoonState;

    // 2. Zipline snap crane-grapple / landing save reaction
    if (this.zipSnapped && !this.zipSaved) {
      const t2 = TOWER_BY_ID.tower2;
      const onTower2 =
        player.position.x >= t2.x0 - 2 &&
        player.position.x <= t2.x1 + 2 &&
        player.position.z >= t2.z0 - 2 &&
        player.position.z <= t2.z1 + 2 &&
        player.position.y >= t2.y - 3;
      if (hState === 'anchored_wall' || onTower2) {
        this.zipSaved = true;
        this.runner.signal('dp:zipline_saved');
      }
    }

    // 3. Gaff harpoon grapple onto the patrol helicopter
    if (this.chopperWatchActive && !this.chopperGrappled && hState === 'anchored_vehicle') {
      this.chopperGrappled = true;
      this.runner.signal('dp:chopper_grappled');
    }
  }

  private updateGlassBreachWatcher(): void {
    if (!this.glassWatchActive || this.glassBreached) return;
    const player = this.ctx.player;
    if (!player || !player.alive) return;

    const aliveNow = this.countAliveCurtainPanes();
    const nearCurtain =
      player.position.z >= OFFICE.curtainWall.z - 8 &&
      player.position.z <= OFFICE.curtainWall.z + 6 &&
      Math.abs(player.position.x) <= OFFICE.curtainWall.width;

    if (nearCurtain && this.initialCurtainPanes > 0 && aliveNow < this.initialCurtainPanes) {
      this.signalGlassBreached();
    }
  }

  private signalGlassBreached(): void {
    if (this.glassBreached) return;
    this.glassBreached = true;
    this.glassWatchActive = false;
    this.runner.signal('dp:glass_breached');
  }

  private countAliveCurtainPanes(): number {
    const props = this.worldObjects?.props?.props;
    if (!props) return 0;
    const cw = OFFICE.curtainWall;
    let n = 0;
    for (let i = 0; i < props.length; i++) {
      const p = props[i]!;
      if (
        p.alive &&
        p.kind === 'pane' &&
        Math.abs(p.p.z - cw.z) <= 1.2 &&
        p.p.x >= cw.x0 - 0.5 &&
        p.p.x <= cw.x1 + 0.5 &&
        p.p.y >= cw.y0 - 0.5 &&
        p.p.y <= cw.y1 + 0.5
      ) {
        n++;
      }
    }
    return n;
  }

  private shatterCurtainWallCenter(): void {
    const objs = this.worldObjects;
    if (!objs) return;
    _tmpVec.set(0, OFFICE.execY + 2.2, OFFICE.curtainWall.z);
    objs.props.blast(_tmpVec, 5.5, 45, 'zipline_snap');
  }

  private countAliveClusterRacks(x0: number, x1: number, z0: number, z1: number): number {
    const props = this.worldObjects?.props?.props;
    if (!props) return 0;
    let n = 0;
    for (let i = 0; i < props.length; i++) {
      const p = props[i]!;
      if (
        p.alive &&
        p.kind === 'rack' &&
        p.p.x >= x0 - 1 &&
        p.p.x <= x1 + 1 &&
        p.p.z >= z0 - 1 &&
        p.p.z <= z1 + 1 &&
        p.p.y <= DATACENTER.ceilY
      ) {
        n++;
      }
    }
    return n;
  }

  private updateVaultTracker(): void {
    if (!this.vaultActive || this.vaultClearedSignalled) return;

    let clustersDoneCount = 0;
    for (const c of DATACENTER.clusters) {
      if (!this.clusterDone.has(c.id)) {
        const total = this.clusterTotals.get(c.id) ?? 1;
        const alive = this.countAliveClusterRacks(c.x0, c.x1, c.z0, c.z1);
        const destroyedFrac = 1 - alive / Math.max(total, 1);
        if (destroyedFrac >= CLUSTER_DESTROY_FRAC || alive === 0) {
          this.clusterDone.add(c.id);
          this.vaultMarkers.get(c.id)?.();
          this.vaultMarkers.delete(c.id);
          this.ctx.hud.feed(`${c.name} LIQUIDATED!`, '#ff9830');
        }
      }
      if (this.clusterDone.has(c.id)) clustersDoneCount++;
    }

    if (clustersDoneCount === DATACENTER.clusters.length && !this.vaultClustersSignalled) {
      this.vaultClustersSignalled = true;
      this.runner.signal('dp:vault_clusters_done');
    }

    let pylonsDoneCount = 0;
    const dest = this.destruction;
    for (let i = 0; i < DATACENTER.airGapCore.pylons.length; i++) {
      const p = DATACENTER.airGapCore.pylons[i]!;
      const alive = dest?.getCluster(p.id) ? dest.isClusterAlive(p.id) : false;
      if (!alive) {
        pylonsDoneCount++;
        const unmark = this.vaultMarkers.get(p.id);
        if (unmark) {
          unmark();
          this.vaultMarkers.delete(p.id);
          this.ctx.hud.feed(`AIR-GAP PYLON ${i + 1} BREACHED!`, '#22ecff');
        }
      }
    }

    if (clustersDoneCount === DATACENTER.clusters.length && pylonsDoneCount === DATACENTER.airGapCore.pylons.length) {
      this.vaultClearedSignalled = true;
      this.vaultActive = false;
      this.clearVaultMarkers();
      this.setHudMode('none');
      this.runner.signal('dp:vault_cleared');
    }
  }

  // -----------------------------------------------------------------------------------------------
  // Elevator & ORION Callbacks
  // -----------------------------------------------------------------------------------------------

  private onElevatorState(state: ElevatorState): void {
    if (state === 'doors_open') {
      this.ctx.hud.feed('FREIGHT LIFT ARRIVED — BOARD CAB TO SUB-LEVEL 4!', '#7ee787');
      this.runner.signal('dp:elev_arrived');
    } else if (state === 'jammed') {
      this.runner.signal('dp:elev_jammed');
    } else if (state === 'arrived_vault') {
      this.setHudMode('none');
      this.runner.signal('dp:elev_vault');
    }
  }

  private onOrionStageChange(stage: OrionStage): void {
    if ((stage === 'bridge_smash' || stage === 'stage2_unrestricted') && !this.stage1DoneSignalled) {
      this.stage1DoneSignalled = true;
      this.runner.signal('dp:stage1_done');
    }
    if ((stage === 'spire_leap' || stage === 'stage3_meltdown') && !this.stage2DoneSignalled) {
      this.stage2DoneSignalled = true;
      this.runner.signal('dp:stage2_done');
    }
  }

  private spawnBossDrones(origin: THREE.Vector3, count: number): void {
    const budget = Math.max(0, MAX_ACTIVE_BOSS_DRONES - this.bossDroneUids.size);
    const toSpawn = Math.min(count, budget);
    for (let i = 0; i < toSpawn; i++) {
      const ang = (i / Math.max(toSpawn, 1)) * Math.PI * 2;
      _tmpSpawn.set(origin.x + Math.cos(ang) * 4.5, Math.max(origin.y + 5.5, 5.5), origin.z + Math.sin(ang) * 4.5);
      const e = this.manager.spawn('drone', _tmpSpawn);
      if (e) this.bossDroneUids.add(e.uid);
    }
  }

  // -----------------------------------------------------------------------------------------------
  // Unified Mission HUD Bar (Elevator Hold/Jam, Compute Vault Liquidation, ORION-0 Multi-Stage)
  // -----------------------------------------------------------------------------------------------

  private setHudMode(mode: HudMode): void {
    this.hudMode = mode;
    this.hudPipSignature = '';
    if (mode === 'none') {
      this.hudEl.classList.remove('on');
      this.hudPipRow.replaceChildren();
      this.hudPips.clear();
      this.hudClause.set('');
      return;
    }
    this.hudEl.classList.add('on');
  }

  private ensurePips(signature: string, defs: readonly (readonly [string, string])[]): void {
    if (this.hudPipSignature === signature) return;
    this.hudPipSignature = signature;
    this.hudPipRow.replaceChildren();
    this.hudPips.clear();
    for (const [id, label] of defs) {
      const pip = span('fc-pip', label);
      this.hudPips.set(id, pip);
      this.hudPipRow.append(pip);
    }
  }

  private updateZiplinePrompt(): void {
    const z = this.ziplines;
    if (z?.riding) {
      const jumpKey = (this.ctx.input?.labelFor?.('jump') || 'SPACE').toUpperCase();
      this.zipPromptBadge.set('RIDING ZIPLINE');
      this.zipPromptMain.set(`PRESS [${jumpKey}] TO DETACH`);
      this.zipPromptSub.set('AIM & SHOOT FREELY');
      if (this.zipPromptState !== 'riding') {
        this.zipPromptState = 'riding';
        this.zipPromptEl.classList.add('on', 'riding');
      }
      return;
    }

    const label = z?.promptedLabel ?? null;
    if (label) {
      const key = (this.ctx.input?.labelFor?.('interact') || 'E').toUpperCase();
      const jumpKey = (this.ctx.input?.labelFor?.('jump') || 'SPACE').toUpperCase();
      this.zipPromptBadge.set('ZIPLINE READY');
      this.zipPromptMain.set(`PRESS [${key}] TO RIDE`);
      this.zipPromptSub.set(`${label} · [${jumpKey}] TO DETACH`);
      if (this.zipPromptState !== 'ready') {
        this.zipPromptState = 'ready';
        this.zipPromptEl.classList.add('on');
        this.zipPromptEl.classList.remove('riding');
      }
      return;
    }

    if (this.zipPromptState !== 'off') {
      this.zipPromptState = 'off';
      this.zipPromptEl.classList.remove('on', 'riding');
    }
  }

  private updateHud(): void {
    this.updateZiplinePrompt();
    if (this.hudMode === 'none') return;

    if (this.hudMode === 'elevator' && this.elevator) {
      const el = this.elevator;
      this.hudTitle.set('FREIGHT LIFT // EXPRESS SHAFT');
      if (el.state === 'holding') {
        const pct = Math.round(el.holdProgress * 100);
        this.hudPhase.set('SUMMONING CAB');
        this.hudPct.set(`${pct}%`);
        this.hudFill.style.width = `${pct}%`;
        this.ensurePips('elev_hold', []);
        this.hudClause.set('HOLD SERVICE LOBBY UNTIL FREIGHT DOORS OPEN');
      } else if (el.state === 'doors_open') {
        this.hudPhase.set('DOORS OPEN');
        this.hudPct.set('BOARD');
        this.hudFill.style.width = '100%';
        this.ensurePips('elev_open', []);
        this.hudClause.set('STEP INSIDE FREIGHT CAB TO DESCEND TO SUB-LEVEL 4');
      } else if (el.state === 'jammed') {
        const clamps = el.getClamps();
        const dead = clamps.filter(c => !c.alive).length;
        const pct = Math.round((dead / 4) * 100);
        this.hudPhase.set(`SHAFT JAMMED · FLOOR ${el.displayFloor}`);
        this.hudPct.set(`${4 - dead} LEFT`);
        this.hudFill.style.width = `${pct}%`;
        this.ensurePips('elev_clamps', [
          ['c0', 'CLAMP NW'],
          ['c1', 'CLAMP NE'],
          ['c2', 'CLAMP SW'],
          ['c3', 'CLAMP SE'],
        ]);
        for (const c of clamps) {
          const pip = this.hudPips.get(`c${c.index}`);
          if (pip) {
            pip.classList.toggle('dead', !c.alive);
            pip.classList.toggle('hot', c.alive);
          }
        }
        this.hudClause.set('SHOOT ALL 4 GLOWING HYDRAULIC BRAKE CLAMPS TO DROP INTO SUB-LEVEL 4');
      } else {
        const floor = el.displayFloor >= 0 ? `${el.displayFloor}F` : `B${Math.abs(el.displayFloor)}`;
        this.hudPhase.set(el.state === 'falling' ? 'FREEFALL BREACH!' : 'EXPRESS DESCENT');
        this.hudPct.set(floor);
        const spanY = Math.max(el.topY - el.bottomY, 1);
        const frac = clamp((el.topY - el.y) / spanY, 0, 1);
        this.hudFill.style.width = `${Math.round(frac * 100)}%`;
        this.ensurePips('elev_move', []);
        this.hudClause.set('');
      }
      return;
    }

    if (this.hudMode === 'vault') {
      this.hudTitle.set('SUB-LEVEL 4 // COMPUTE LIQUIDATION');
      this.ensurePips('vault_targets', [
        ['cluster.north', 'NORTH'],
        ['cluster.west', 'WEST'],
        ['cluster.east', 'EAST'],
        ['vault.pylon.0', 'PYLON 1'],
        ['vault.pylon.1', 'PYLON 2'],
        ['vault.pylon.2', 'PYLON 3'],
        ['vault.pylon.3', 'PYLON 4'],
      ]);
      let done = 0;
      for (const c of DATACENTER.clusters) {
        const dead = this.clusterDone.has(c.id);
        if (dead) done++;
        this.hudPips.get(c.id)?.classList.toggle('dead', dead);
      }
      const dest = this.destruction;
      for (const p of DATACENTER.airGapCore.pylons) {
        const dead = dest?.getCluster(p.id) ? !dest.isClusterAlive(p.id) : false;
        if (dead) done++;
        const pip = this.hudPips.get(p.id);
        if (pip) {
          pip.classList.toggle('dead', dead);
          pip.classList.toggle('hot', !dead && this.vaultClustersSignalled);
        }
      }
      const pct = Math.round((done / 7) * 100);
      this.hudPhase.set(`${done} / 7 LIQUIDATED`);
      this.hudPct.set(`${pct}%`);
      this.hudFill.style.width = `${pct}%`;
      this.hudClause.set(
        this.vaultClustersSignalled
          ? 'DESTROY THE 4 CENTRAL AIR-GAP CONTAINMENT PYLONS'
          : 'DETONATE SERVER RACKS ACROSS ALL 3 COMPUTE CLUSTERS',
      );
      return;
    }

    if (this.hudMode === 'orion' && this.orion) {
      const s: OrionHudState = this.orion.getHudState();
      if (!s.active) {
        this.setHudMode('none');
        return;
      }
      this.hudTitle.set(s.label);
      const hpPct = Math.round(s.hullPercent);
      this.hudPct.set(`${hpPct}%`);
      this.hudFill.style.width = `${hpPct}%`;

      if (s.stage === 'stage1_alignment' || s.stage === 'bridge_smash') {
        this.hudPhase.set(s.shieldActive ? 'STAGE 1 · SHIELD ONLINE (70% DR)' : 'STAGE 1 · SHIELD OFFLINE');
        this.ensurePips('orion_s1', [
          ['relayL', 'LEFT RELAY'],
          ['relayR', 'RIGHT RELAY'],
          ['shield', 'HARD-LIGHT SHIELD'],
        ]);
        this.hudPips.get('relayL')?.classList.toggle('dead', !s.relays[0].intact);
        this.hudPips.get('relayL')?.classList.toggle('hot', s.relays[0].intact);
        this.hudPips.get('relayR')?.classList.toggle('dead', !s.relays[1].intact);
        this.hudPips.get('relayR')?.classList.toggle('hot', s.relays[1].intact);
        this.hudPips.get('shield')?.classList.toggle('dead', !s.shieldActive);
        this.hudClause.set(
          s.shieldActive
            ? 'SHOOT BOTH GLOWING SHOULDER RELAY FINS TO DROP HARD-LIGHT SHIELD'
            : 'SHIELD DOWN — POUND ORION-0 BELOW 66% HULL!',
        );
      } else if (s.stage === 'stage2_unrestricted' || s.stage === 'spire_leap') {
        this.hudPhase.set(
          s.staggered ? `STAGE 2 · STAGGERED (${s.staggerLeft.toFixed(1)}s)` : 'STAGE 2 · UNRESTRICTED MODE',
        );
        this.ensurePips('orion_s2', [
          ['reactor', 'REAR REACTOR (2.5× CRIT)'],
          ['callins', 'ORBITAL CALL-INS LIVE'],
        ]);
        this.hudPips.get('reactor')?.classList.toggle('hot', s.reactorExposed);
        this.hudPips.get('callins')?.classList.toggle('hot', true);
        this.hudClause.set(
          s.reactorExposed
            ? 'REAR REACTOR EXPOSED — FOCUS FIRE FOR 2.5× CRIT DAMAGE!'
            : 'BAIT JET-CHARGES INTO CORNER COLUMNS · ORBITAL CALL-INS UNLOCKED',
        );
      } else if (s.stage === 'stage3_meltdown') {
        const up = Math.round(s.uploadPercent);
        this.hudPhase.set(s.invulnerable ? `STAGE 3A · INVULNERABLE` : 'STAGE 3A · SHIELD BROKEN');
        this.ensurePips('orion_s3a', [
          ['con0', 'WEST CONDUIT'],
          ['con1', 'EAST CONDUIT'],
          ['con2', 'SOUTH CONDUIT'],
        ]);
        for (const c of s.conduits) {
          const pip = this.hudPips.get(`con${c.index}`);
          if (pip) {
            pip.classList.toggle('dead', !c.intact);
            pip.classList.toggle('hot', c.intact);
          }
        }
        this.hudClause.set(
          s.invulnerable
            ? `UPLOAD TO GLOBAL GRID: ${up}%${s.uploadPaused ? ' (PAUSED)' : ''} — DESTROY ALL 3 CONDUITS!`
            : `CONDUITS DOWN · UPLOAD HALTED (${up}%) — PUSH ORION-0 TO 10%!`,
        );
      } else if (s.stage === 'crippled_core') {
        const corePct = Math.round(clamp((s.neuralCoreHealth / Math.max(s.neuralCoreMaxHealth, 1)) * 100, 0, 100));
        this.hudPhase.set('STAGE 3B · EXPOSED NEURAL CORE');
        this.hudPct.set(`CORE ${corePct}%`);
        this.hudFill.style.width = `${corePct}%`;
        this.ensurePips('orion_s3b', [['core', 'NEURAL CORE']]);
        this.hudPips.get('core')?.classList.toggle('hot', true);
        this.hudClause.set('GAFF GRAPPLE TO SPIRE PILLARS OR ORION SHOULDER — DESTROY THE NEURAL CORE!');
      }
    }
  }

  // -----------------------------------------------------------------------------------------------
  // Grapple & Marker Helpers
  // -----------------------------------------------------------------------------------------------

  private enableSectionGrappleMarks(section: 'skyline_drop' | 'glass_run' | 'boss_stage3'): void {
    if (!this.grappleMarks) return;
    for (const a of GRAPPLE_ANCHORS) {
      if (a.section === section) {
        this.grappleMarks.setEnabled(a.id, true);
      }
    }
  }

  private disableAllGrappleMarks(): void {
    if (!this.grappleMarks) return;
    for (const a of GRAPPLE_ANCHORS) {
      this.grappleMarks.setEnabled(a.id, false);
    }
    this.grappleMarks.setEnabled('orion_shoulder', false);
  }

  private clearVaultMarkers(): void {
    for (const unmark of this.vaultMarkers.values()) unmark();
    this.vaultMarkers.clear();
  }

  // -----------------------------------------------------------------------------------------------
  // Reset / Clear / Dispose
  // -----------------------------------------------------------------------------------------------

  clear(): void {
    this.skylineKillActive = false;
    this.chopperWatchActive = false;
    this.chopperGrappled = false;
    this.zipSnapped = false;
    this.zipSaved = false;
    this.glassWatchActive = false;
    this.glassBreached = false;
    this.vaultActive = false;
    this.vaultClustersSignalled = false;
    this.vaultClearedSignalled = false;
    this.clusterTotals.clear();
    this.clusterDone.clear();
    this.clearVaultMarkers();
    this.stage1DoneSignalled = false;
    this.stage2DoneSignalled = false;
    this.conduitsDownSignalled = false;
    this.empEjectSignalled = false;
    this.orionDeadSignalled = false;
    this.bossDroneUids.clear();

    this.setHudMode('none');
    this.zipPromptState = 'off';
    this.zipPromptEl.classList.remove('on', 'riding');
    this.ziplines?.reset();
    this.disableAllGrappleMarks();
    this.elevator?.reset();
    this.civilians?.stop();
    this.orion?.hide();
  }

  reset(): void {
    this.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    for (const off of this.unsubs) off();
    this.unsubs.length = 0;
    this.ziplines?.dispose();
    this.ziplines = null;
    this.grappleMarks?.dispose();
    this.grappleMarks = null;
    this.elevator?.dispose();
    this.elevator = null;
    this.civilians?.dispose();
    this.civilians = null;
    this.orion?.dispose();
    this.orion = null;
    this.hudEl.remove();
    this.zipPromptEl.remove();
  }
}
