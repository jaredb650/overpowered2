/**
 * Crossfire Part 3 Runtime Director — "Fortress Halcyon" (`map: 'halcyon'`, Contractor #7712-A).
 *
 * Handles all 8 Part 3 `cf.*` mission director calls and orchestrates the full-scale combined-arms
 * battlefield (player 4-mode B-1B Lancer + Mercer beachhead tanks/APCs/Kestrel/Valkyries +
 * allied F-22 escorts vs Halcyon Flak/Mortars/SAMs/Radars/Enemy Armor/Hornet CAP/Tier-3 Citadel HQ):
 *   - `cf.halcyonInit`
 *   - `cf.halcyonBreachWatch`
 *   - `cf.halcyonArmorPush`
 *   - `cf.halcyonValkyrieDrop`
 *   - `cf.halcyonWarMachine`
 *   - `cf.halcyonCitadelSiege`
 *   - `cf.halcyonLeveled`
 *   - `cf.handoffToReturn`
 */
import * as THREE from 'three';
import type { AllyType } from '../../allies';
import type { Ctx } from '../../core/contracts';
import type { EnemyId } from '../../core/gameplay';
import { clamp, rand } from '../../core/math';
import type { OutpostSquad } from '../../enemies/outpost/squad';
import type { Foe, Soldier } from '../../enemies/outpost/soldier';
import type { VehicleSystem } from '../../enemies/vehicles';
import { ModelMaterials } from '../../progression/modelkit';
import { AiVehicleFleet } from '../../vehicles/drive/aiDriver';
import type { DriveableManager } from '../../vehicles/drive/manager';
import type { DriveableVehicle } from '../../vehicles/drive/vehicle';
import {
  BREACH_SECTION_B_IDS,
  HALCYON_AIR_PATROLS,
  HALCYON_CHOPPER_LZS,
  HALCYON_CITADEL_HQ_POS,
  HALCYON_DEFENSE_SITES,
  HALCYON_GROUND_LANES,
  HALCYON_TARGETS,
  getHalcyonTarget,
  type HalcyonTargetDef,
} from '../../world/map/halcyon/targets';
import type { MissionRunner } from '../runner';
import { CrossfireAirWing } from './airWing';
import { BaseDefenseSystem } from './baseDefense';
import { CitadelInfernoSpectacle } from './citadelInferno';
import {
  CROSSFIRE_DEFAULT_LANCER_MAX_HP,
  CROSSFIRE_SIGNALS,
  createInitialChainState,
  loadChainState,
  transitionToCrossfirePart,
} from './chain';
import { CrossfireHudOverlay, type HalcyonHudBadge } from './hudOverlay';

const _v = new THREE.Vector3();

const INITIAL_DEFENSE_IDS = new Set(['site_flak_west', 'site_flak_east']);
const RIDGE_DEFENSE_IDS = new Set(['site_mortar_west', 'site_mortar_center', 'site_mortar_east', 'site_sam_sw', 'site_sam_se']);
const WAR_MACHINE_DEFENSE_IDS = new Set(['site_flak_north', 'site_sam_nw', 'site_sam_ne', 'site_radar_west', 'site_radar_east']);

const ARMORY_TARGET_IDS = ['tank_armory_depot', 'tank_armory_motor_pool'] as const;
const AIRFIELD_TARGET_IDS = ['hangar_north', 'hangar_south', 'flightline_fighters', 'flightline_choppers'] as const;
const FUEL_TARGET_IDS = ['fuel_tank_farm', 'ammo_bunker_depot'] as const;
const RADAR_TARGET_IDS = ['radar_west', 'radar_east'] as const;

/** BLU-121/B thermobaric blast damage threshold to crack Tier-3 reinforced concrete on Citadel Command HQ. */
const HQ_CRACK_THRESHOLD = 1800;

const MERCER_INFANTRY_POOL: readonly AllyType[] = ['rifleman', 'rifleman', 'gunner', 'rocketeer', 'riot', 'medic'];
const HALCYON_INFANTRY_POOL: readonly EnemyId[] = ['trooper', 'trooper', 'gunner', 'stalker', 'riot', 'rocketeer'];

interface TrackedEnemySquad {
  squad: OutpostSquad;
  laneX: number;
}

interface OutpostLike {
  muster(size: number, at: THREE.Vector3): OutpostSquad;
  enlistInto(squad: OutpostSquad, id: EnemyId, at: THREE.Vector3): unknown;
  w?: { now?: number };
}

function isThermobaricBlast(source?: string, kind?: string, damage = 0, radius = 0): boolean {
  const s = (source ?? '').toLowerCase();
  return (
    s.includes('thermobaric')
    || s === 'ac130_bomb'
    || kind === 'thermobaric'
    || (!s && damage >= 2400 && radius >= 36)
  );
}

function isNapalmBlast(source?: string, kind?: string): boolean {
  const s = (source ?? '').toLowerCase();
  return s.includes('napalm') || s.includes('incendiary') || s.includes('fire') || kind === 'napalm';
}

export class HalcyonDirector {
  private materials: ModelMaterials | null = null;
  private airWing: CrossfireAirWing | null = null;
  private defenses: BaseDefenseSystem | null = null;
  private fleet: AiVehicleFleet | null = null;
  private citadelInferno: CitadelInfernoSpectacle | null = null;
  private built = false;

  private active = false;
  private playerLancer: DriveableVehicle | null = null;
  private introCutsceneSeen = false;
  private introReboardDone = false;
  private mountedDefenseIds = new Set<string>();

  // Phase flags & milestones
  private breachWatchActive = false;
  private breachedSignaled = false;
  private armorPushActive = false;
  private ridgeClearSignaled = false;
  private valkyrieDropped = false;
  private warMachineActive = false;
  private armoryDownSignaled = false;
  private airfieldDownSignaled = false;
  private fuelDownSignaled = false;
  private radarDownSignaled = false;
  private warBrokenSignaled = false;
  private citadelSiegeActive = false;
  private hqCrackDamage = 0;
  private hqCracked = false;
  private hqCrackedSignaled = false;
  private hqBurned = false;
  private hqDestroyedSignaled = false;
  private hqHintCooldown = 0;
  private leveledActive = false;
  private leveledClock = 0;
  private egressReadySignaled = false;
  private handoffTriggered = false;

  // Endless-War-style live ground battle state
  private readonly enemyGroundSquads: TrackedEnemySquad[] = [];
  private groundWarElapsed = 0;
  private friendlyInfTimer = 5.5;
  private friendlyArmorTimer = 16;
  private enemyInfTimer = 4.8;
  private enemyArmorTimer = 14;
  private groundOrderTimer = 3.0;
  private groundWarSpawns = 0;
  private enemyVehSeq = 0;
  private allyArmorSeq = 0;

  // Target health accumulator (tracks both DestructionManager clusters & direct bomb blast splash)
  private readonly targetDamage = new Map<string, number>();
  private readonly destroyedTargets = new Set<string>();
  private unmarkHq: (() => void) | null = null;
  private unsubBlast: (() => void) | null = null;
  private prevBlastHandler: ((center: THREE.Vector3, radius: number, amount: number, source: string) => void) | null = null;
  private blastHooked = false;
  private liveCallout = 'BREACH SECTION B & SILENCE OUTER FLAK BASTIONS';
  private hudThrottle = 0;
  private capRespawnCd = 28;
  private playerCrashTimer = -1;
  private lancerLastHp = -1;
  private lancerNoDamageTimer = 0;

  constructor(
    private readonly ctx: Ctx,
    private readonly runner: MissionRunner,
    private readonly hudOverlay: CrossfireHudOverlay,
    private readonly isCutscenePlaying: () => boolean = () => false,
  ) {}

  private get driveables(): DriveableManager | undefined {
    return (this.ctx.progression as unknown as { driveables?: DriveableManager } | undefined)?.driveables;
  }

  private get vehicleSystem(): Partial<VehicleSystem> | undefined {
    return this.ctx.enemies?.vehicles as Partial<VehicleSystem> | undefined;
  }

  private downPlayerCleanly(source: string): void {
    if (this.playerLancer?.occupied) {
      this.playerLancer.exit?.(true);
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

    this.materials = new ModelMaterials(this.ctx);
    this.airWing = new CrossfireAirWing(this.ctx);
    this.fleet = new AiVehicleFleet(this.ctx, this.materials);
    this.citadelInferno = new CitadelInfernoSpectacle(this.ctx);
    this.defenses = new BaseDefenseSystem(this.ctx, {
      onDestroyed: (id, kind, pos) => {
        const siteDef = HALCYON_DEFENSE_SITES.find(s => s.id === id);
        if (siteDef) {
          this.markTargetDestroyed(siteDef.targetId, pos);
        }
        if (kind === 'radar_dome') {
          this.ctx.hud?.feed?.('GEODESIC RADAR DOME DESTROYED — SAM LOCK SPEED DEGRADED!', '#54ff9d');
        }
        this.evaluateMilestones();
      },
    });
    this.hookExplosions();
  }

  private hookExplosions(): void {
    if (this.ctx.events?.on && !this.unsubBlast) {
      const u1 = this.ctx.events.on('combat:explosion', ev => {
        this.onWorldBlast(ev.position, ev.radius, ev.damage, ev.source, ev.kind);
      });
      const u2 = this.ctx.events.on('world:explosion', ev => {
        this.onWorldBlast(ev.position, ev.radius, ev.damage, ev.source, ev.kind);
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
        this.onWorldBlast(at, radius, damage, source);
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

  private onWorldBlast(
    at: THREE.Vector3,
    radius: number,
    damage: number,
    source?: string,
    kind?: string,
  ): void {
    if (!this.active) return;
    // Apply splash damage to BaseDefenseSystem emplacements too (covers world.objects.blastHandler bombs)
    this.defenses?.applyBlast(at, radius, damage, source || 'lancer_ordnance', true);

    const thermobaric = isThermobaricBlast(source, kind, damage, radius);
    const napalm = isNapalmBlast(source, kind);

    // Track blast damage against structured Halcyon targets (walls, facilities, 2-stage Tier-3 HQ)
    for (const target of HALCYON_TARGETS) {
      if (target.id === 'citadel_command_hq') {
        this.handleCitadelHqBlast(target, at, radius, damage, thermobaric, napalm);
        continue;
      }

      if (this.destroyedTargets.has(target.id)) continue;
      const dx = at.x - target.pos[0];
      const dz = at.z - target.pos[2];
      const dist = Math.hypot(dx, dz);
      const reach = radius + target.radius;
      if (dist > reach) continue;
      const falloff = clamp(1 - (dist / Math.max(1, reach)) * 0.65, 0.3, 1);
      const next = (this.targetDamage.get(target.id) ?? 0) + damage * falloff;
      this.targetDamage.set(target.id, next);
      if (next >= target.hp) {
        this.markTargetDestroyed(target.id, at);
      }
    }
    this.evaluateMilestones();
  }

  private handleCitadelHqBlast(
    target: HalcyonTargetDef,
    at: THREE.Vector3,
    radius: number,
    damage: number,
    thermobaric: boolean,
    napalm: boolean,
  ): void {
    if (this.hqBurned) return;
    const dx = at.x - target.pos[0];
    const dz = at.z - target.pos[2];
    const dist = Math.hypot(dx, dz);
    const extraReach = napalm ? 10 : 0;
    const reach = radius + target.radius + extraReach;
    if (dist > reach) return;

    // Stage 1: Tier-3 reinforced concrete can ONLY be cracked by BLU-121/B Thermobaric
    if (!this.hqCracked) {
      if (!thermobaric) {
        if (this.citadelSiegeActive && this.hqHintCooldown <= 0) {
          this.hqHintCooldown = 3.5;
          this.ctx.hud?.feed?.(
            'REINFORCED CONCRETE HELD — SWITCH TO BLU-121 THERMOBARIC [R] TO CRACK CITADEL HQ!',
            '#ffb347',
          );
        }
        return;
      }

      const falloff = clamp(1 - (dist / Math.max(1, reach)) * 0.55, 0.4, 1);
      this.hqCrackDamage += Math.max(damage, 2000) * falloff;
      if (this.hqCrackDamage >= HQ_CRACK_THRESHOLD) {
        this.hqCracked = true;
        const hqPos = _v.set(target.pos[0], target.pos[1] + 6, target.pos[2]);
        this.ctx.fx?.explosion?.(hqPos, { radius: 34, scale: 3.2, kind: 'thermobaric' });
        this.ctx.audio?.play?.('rocket_explosion', { position: hqPos, volume: 1.0, pitch: 0.64 });
      }
      return;
    }

    // Stage 2: Once cracked & Citadel Siege is live, ONLY BLU-27 Napalm burns Halvorsen out!
    if (!this.citadelSiegeActive) return;

    if (!napalm) {
      if (this.hqHintCooldown <= 0) {
        this.hqHintCooldown = 3.5;
        this.ctx.hud?.feed?.(
          'CONCRETE CRACKED — SWITCH TO BLU-27 NAPALM [R] TO BURN HALVORSEN OUT!',
          '#ff7b2e',
        );
      }
      return;
    }

    this.hqBurned = true;
    const hqPos = new THREE.Vector3(target.pos[0], target.pos[1], target.pos[2]);
    // Unique finale spectacle: violent whole-HQ volcanic napalm firestorm erupting across the entire 36 m x 31 m Citadel!
    this.citadelInferno?.ignite(hqPos);
    this.markTargetDestroyed('citadel_command_hq', at);
  }

  private markTargetDestroyed(targetId: string, blastPos?: THREE.Vector3): void {
    if (this.destroyedTargets.has(targetId)) return;
    this.destroyedTargets.add(targetId);

    const def = getHalcyonTarget(targetId);
    if (!def) return;

    const pos = blastPos ?? _v.set(def.pos[0], def.pos[1] + 4, def.pos[2]);
    this.ctx.progression?.award?.(Math.round(def.value / 250), `${def.name} DESTROYED`, pos);

    // Extra dramatic secondary fireballs on fuel farm / ammo bunkers / HQ
    if (def.category === 'fuel_ammo') {
      this.ctx.fx?.explosion?.(pos, { radius: 22, scale: 2.6, kind: 'barrel' });
      this.ctx.audio?.play?.('rocket_explosion', { position: pos, volume: 0.95, pitch: 0.72 });
    } else if (def.category === 'hq') {
      this.ctx.fx?.explosion?.(pos, { radius: 34, scale: 3.4, kind: 'thermobaric' });
      this.ctx.audio?.play?.('rocket_explosion', { position: pos, volume: 1.0, pitch: 0.62 });
    }
  }

  /** Handles all 8 Part 3 Halcyon `cf.*` calls. Returns true if handled. */
  call(name: string, _arg?: string): boolean {
    this.ensureBuilt();
    switch (name) {
      case 'cf.halcyonInit':
        this.halcyonInit('breach');
        return true;
      case 'cf.halcyonBreachWatch':
        this.ensureInitializedForBeat('breach');
        this.breachWatchActive = true;
        this.liveCallout = 'MERCER: BLOW SECTION B [0, 0, 98] & OUTER FLAK BASTIONS!';
        this.evaluateMilestones();
        this.syncHud();
        return true;
      case 'cf.halcyonArmorPush':
        this.ensureInitializedForBeat('ridge');
        this.startArmorPush();
        return true;
      case 'cf.halcyonValkyrieDrop':
        this.ensureInitializedForBeat('ridge');
        this.launchValkyrieDrops();
        return true;
      case 'cf.halcyonWarMachine':
        this.ensureInitializedForBeat('war_machine');
        this.startWarMachinePhase();
        return true;
      case 'cf.halcyonCitadelSiege':
        this.ensureInitializedForBeat('citadel');
        this.startCitadelSiege();
        return true;
      case 'cf.halcyonLeveled':
        this.triggerHalcyonLeveled();
        return true;
      case 'cf.handoffToReturn':
        this.handoffToReturn();
        return true;
      default:
        return false;
    }
  }

  /**
   * Guarantees the player is seated in a live airborne B-1B Lancer with Mercer's fleet & escorts
   * whenever redeploying from a mid-mission checkpoint (Beats 2, 3, or 4) or jumping via `?beat=`.
   */
  private ensureInitializedForBeat(stage: 'breach' | 'ridge' | 'war_machine' | 'citadel'): void {
    const needsLancer = Boolean(this.driveables) && (!this.playerLancer || !this.playerLancer.alive);
    if (this.active && !needsLancer) return;
    this.halcyonInit(stage);
  }

  private mountDefenseSubset(ids: ReadonlySet<string>): void {
    if (!this.defenses) return;
    const toMount = HALCYON_DEFENSE_SITES.filter(s => {
      if (!ids.has(s.id) || this.mountedDefenseIds.has(s.id)) return false;
      const target = getHalcyonTarget(s.targetId);
      if (target && this.isTargetDestroyed(target)) return false;
      return true;
    });
    if (toMount.length === 0) return;
    this.defenses.mountHalcyonSites(toMount);
    for (const s of toMount) this.mountedDefenseIds.add(s.id);
  }

  private positionPlayerLancerAtApproach(veh: DriveableVehicle): void {
    const corridor = HALCYON_AIR_PATROLS.find(p => p.id === 'corridor_b1b_south_north');
    const start = corridor?.waypoints[0] ?? ([0, 120, 620] as const);
    // Start at z = 440 so the 28.2 m B-1B Lancer immediately looks down across Fortress Halcyon's South Blast Wall & siege!
    const x = start[0];
    const y = start[1];
    const z = Math.min(start[2], 440);
    const yaw = Math.PI;
    const speed = 74;
    veh.phys.grounded = false;
    veh.phys.groundY = 0;
    veh.phys.altitude = y;
    veh.phys.vtolMode = false;
    veh.phys.airThrottle = 0.74;
    veh.phys.speed = speed;
    veh.phys.yaw = yaw;
    veh.phys.pitch = 0;
    veh.phys.roll = 0;
    veh.phys.velocity.set(Math.sin(yaw) * speed, 0, Math.cos(yaw) * speed);
    veh.phys.position.set(x, y, z);
    veh.model?.root?.position?.set(x, y, z);
  }

  private spawnPlayerAirborneLancer(): DriveableVehicle | null {
    const corridor = HALCYON_AIR_PATROLS.find(p => p.id === 'corridor_b1b_south_north');
    const start = corridor?.waypoints[0] ?? ([0, 120, 620] as const);
    const pos = new THREE.Vector3(start[0], start[1], Math.min(start[2], 440));
    const yaw = Math.PI;
    const speed = 74;

    const mgr = this.driveables;
    if (!mgr) {
      this.ctx.player?.teleport?.(pos, yaw);
      return null;
    }

    mgr.clear();
    const veh = mgr.spawn('lancer', pos, yaw, { poolSlot: 'crossfire.halcyon_lancer', exitLocked: true });
    veh.setExitLocked?.(true);
    const chain = loadChainState();
    if (chain && chain.lancerMaxHp > 0) {
      const ratio = clamp(chain.lancerHp / chain.lancerMaxHp, 0.5, 1);
      veh.health = Math.round(veh.def.maxHealth * ratio);
    }
    veh.phys.grounded = false;
    veh.phys.groundY = 0;
    veh.phys.altitude = pos.y;
    veh.phys.vtolMode = false;
    veh.phys.airThrottle = 0.74;
    veh.phys.speed = speed;
    veh.phys.velocity.set(Math.sin(yaw) * speed, 0, Math.cos(yaw) * speed);
    veh.phys.position.copy(pos);
    veh.board(0);
    return veh;
  }

  private halcyonInit(stage: 'breach' | 'ridge' | 'war_machine' | 'citadel' = 'breach'): void {
    this.clearMissionState();
    this.active = true;
    if (stage !== 'breach') {
      this.introReboardDone = true;
      this.breachedSignaled = true;
    }
    if (stage === 'war_machine' || stage === 'citadel') {
      this.ridgeClearSignaled = true;
    }
    if (stage === 'citadel') {
      this.warBrokenSignaled = true;
    }

    // 1. Spawn Contractor A airborne in the overhauled 4-mode B-1B Lancer
    this.playerLancer = this.spawnPlayerAirborneLancer();

    // 2. Mount initial Outer Flak Bastions (`site_flak_west`, `site_flak_east`) on Beat 1
    if (stage === 'breach') {
      this.mountDefenseSubset(INITIAL_DEFENSE_IDS);
    }

    // 3. Deploy Captain Mercer's Beachhead Armor & Kestrel CAS via AiVehicleFleet
    if (this.fleet) {
      const centerLane = HALCYON_GROUND_LANES.find(l => l.id === 'lane_center_breach');
      const westLane = HALCYON_GROUND_LANES.find(l => l.id === 'lane_west_breach');
      const eastLane = HALCYON_GROUND_LANES.find(l => l.id === 'lane_east_breach');

      if (centerLane) {
        this.fleet.spawnGround({
          id: 'mercer_aegis_1',
          kind: 'aegis',
          laneId: centerLane.id,
          spawn: [centerLane.spawn[0] - 8, centerLane.spawn[1]],
          waypoints: centerLane.waypoints,
          gateWaypointIndex: 0,
          hpOverride: 1600,
          label: 'MERCER AEGIS-1',
        });
        this.fleet.spawnGround({
          id: 'mercer_aegis_2',
          kind: 'aegis',
          laneId: centerLane.id,
          spawn: [centerLane.spawn[0] + 8, centerLane.spawn[1] + 6],
          waypoints: centerLane.waypoints,
          gateWaypointIndex: 0,
          hpOverride: 1600,
          label: 'MERCER AEGIS-2',
        });
      }

      if (westLane) {
        this.fleet.spawnGround({
          id: 'mercer_bastion_w',
          kind: 'bastion',
          laneId: westLane.id,
          spawn: westLane.spawn,
          waypoints: westLane.waypoints,
          gateWaypointIndex: 0,
          hpOverride: 1100,
          label: 'MERCER BASTION-W',
        });
        this.fleet.spawnGround({
          id: 'mercer_jackal_w',
          kind: 'jackal',
          laneId: westLane.id,
          spawn: [westLane.spawn[0] + 10, westLane.spawn[1] + 6],
          waypoints: westLane.waypoints,
          gateWaypointIndex: 0,
          hpOverride: 700,
          label: 'MERCER JACKAL-W',
        });
      }

      if (eastLane) {
        this.fleet.spawnGround({
          id: 'mercer_bastion_e',
          kind: 'bastion',
          laneId: eastLane.id,
          spawn: eastLane.spawn,
          waypoints: eastLane.waypoints,
          gateWaypointIndex: 0,
          hpOverride: 1100,
          label: 'MERCER BASTION-E',
        });
        this.fleet.spawnGround({
          id: 'mercer_jackal_e',
          kind: 'jackal',
          laneId: eastLane.id,
          spawn: [eastLane.spawn[0] - 10, eastLane.spawn[1] + 6],
          waypoints: eastLane.waypoints,
          gateWaypointIndex: 0,
          hpOverride: 700,
          label: 'MERCER JACKAL-E',
        });
      }

      // Friendly Kestrel Attack Gunship providing close air support over Mercer's beachhead
      this.fleet.spawnKestrel({
        id: 'mercer_kestrel_cas',
        spawn: [-160, 42, 260],
        orbitCenter: [0, 0, 108],
        orbitRadius: 72,
        orbitAltitude: 34,
        hpOverride: 1400,
        label: 'KESTREL CAS-1',
      });

      // Connect friendly armor & gunship into enemy VehicleSystem for real tank-vs-tank firefights!
      this.vehicleSystem?.setFriendlyVehicles?.(() => this.fleet?.getLiveGroundTargets(true) ?? []);
      if (stage !== 'breach') {
        this.openBreachGates();
      }
    }

    // 4. Launch Endless-War-style combined-arms ground war (Mercer infantry + Halcyon garrison + patrol armor)
    this.initGroundWar();

    // 5. Spawn 2 allied F-22 escorts + initial 2 Halcyon Hornet CAP fighters overhead
    if (this.airWing) {
      this.airWing.spawnAlly('raptor', new THREE.Vector3(-140, 145, 420), Math.PI, 0.82, {
        label: 'VIPER-2 (ESCORT)',
      });
      this.airWing.spawnAlly('raptor', new THREE.Vector3(140, 145, 420), Math.PI, 0.82, {
        label: 'VIPER-3 (ESCORT)',
      });
      this.airWing.spawnEnemy('hornet', new THREE.Vector3(-320, 155, -260), 0, 0.66, {
        waveId: 'halcyon_cap_init',
        label: 'HALCYON CAP-1',
      });
      this.airWing.spawnEnemy('hornet', new THREE.Vector3(320, 155, -260), 0, 0.66, {
        waveId: 'halcyon_cap_init',
        label: 'HALCYON CAP-2',
      });
    }

    this.liveCallout = 'MERCER BEACHHEAD DEPLOYED — AWAITING SECTION B BREACH';
    this.syncHud();
  }

  // ---- Endless-War-Style Active Ground Battle --------------------------------

  private get outpost(): OutpostLike | null {
    return ((this.ctx.enemies as unknown as { outpost?: OutpostLike | null } | undefined)?.outpost) ?? null;
  }

  private getGroundFrontlineZ(): number {
    if (this.warBrokenSignaled || this.citadelSiegeActive) return -14;
    if (this.ridgeClearSignaled || this.warMachineActive) return 14;
    if (this.breachedSignaled || this.armorPushActive) return 62;
    return 108;
  }

  private resolveEnemyExtraFoe(soldier: Soldier): Foe | null {
    const units = this.fleet?.units;
    if (!units || units.length === 0) return null;
    const pos = soldier.e.position;
    const isAt = soldier.e.id === 'rocketeer';
    let best: (typeof units)[number] | null = null;
    let bestDist = isAt ? 95 : 58;
    for (const fv of units) {
      if (!fv.alive || fv.disposed || fv.airborne) continue;
      const d = pos.distanceTo(fv.position);
      if (d < bestDist) {
        bestDist = d;
        best = fv;
      }
    }
    return best ? best.asFoe() : null;
  }

  private initGroundWar(): void {
    const allies = this.ctx.allies as (Ctx['allies'] & {
      extraFoeProvider?: ((soldier: Soldier) => Foe | null) | null;
    }) | undefined;

    // Connect enemy AT rocketeers & close defenders to Mercer's live Aegis/Bastion/Jackal armor!
    if (allies) {
      allies.extraFoeProvider = s => this.resolveEnemyExtraFoe(s);
    }

    const frontZ = this.getGroundFrontlineZ();

    // 1. Mercer's opening amphibious beachhead infantry (14 soldiers across West, Center & East assault squads)
    this.spawnMercerInfantrySquad([-68, 0, 146], [-62, 0, frontZ + 10], 4);
    this.spawnMercerInfantrySquad([0, 0, 146], [0, 0, frontZ + 8], 6);
    this.spawnMercerInfantrySquad([68, 0, 146], [62, 0, frontZ + 10], 4);

    // 2. Halcyon's live defending garrison right from second 1 (sally-port screen + forward trench defenders)
    this.spawnHalcyonEnemySquad([-64, 0, 114], [-64, 0, frontZ + 16], 4);
    this.spawnHalcyonEnemySquad([0, 0, 114], [0, 0, frontZ + 16], 5);
    this.spawnHalcyonEnemySquad([64, 0, 114], [64, 0, frontZ + 16], 4);
    this.spawnHalcyonEnemySquad([-32, 0, 68], [-32, 0, frontZ], 4);
    this.spawnHalcyonEnemySquad([32, 0, 68], [32, 0, frontZ], 4);

    // 3. Halcyon opening patrol armor & forward guard tank so combined-arms armor clashes erupt immediately
    this.spawnHalcyonEnemyArmor('humvee', [-72, 108], [[-68, 126], [-38, 118], [-68, 108]]);
    this.spawnHalcyonEnemyArmor('humvee', [72, 108], [[68, 126], [38, 118], [68, 108]]);
    this.spawnHalcyonEnemyArmor('tank', [0, 74], [[-28, 76], [28, 76], [0, 62]]);
  }

  private spawnMercerInfantrySquad(
    origin: readonly [number, number, number],
    rally: readonly [number, number, number],
    count: number,
  ): void {
    const allies = this.ctx.allies;
    if (!allies?.spawn || count <= 0) return;

    for (let i = 0; i < count; i++) {
      const at = new THREE.Vector3(origin[0] + rand(-7, 7), origin[1], origin[2] + rand(-5, 5));
      const post = new THREE.Vector3(rally[0] + rand(-14, 14), rally[1], rally[2] + rand(-10, 10));
      const type = MERCER_INFANTRY_POOL[i % MERCER_INFANTRY_POOL.length]!;
      const ally = allies.spawn(type, at, post, 24, Math.PI);
      if (ally) {
        ally.expendable = true;
        ally.detached = true;
      }
    }
    this.groundWarSpawns++;
  }

  private spawnMercerReinforcementArmor(): void {
    if (!this.fleet) return;
    const laneIds = ['lane_center_breach', 'lane_west_breach', 'lane_east_breach'] as const;
    const laneId = laneIds[this.allyArmorSeq % laneIds.length]!;
    const lane = HALCYON_GROUND_LANES.find(l => l.id === laneId);
    if (!lane) return;

    const seq = ++this.allyArmorSeq;
    const kind = seq % 3 === 0 ? 'jackal' : (seq % 2 === 0 ? 'bastion' : 'aegis');
    const hpOverride = kind === 'aegis' ? 1600 : (kind === 'bastion' ? 1100 : 700);
    this.fleet.spawnGround({
      id: `mercer_reinf_${kind}_${seq}`,
      kind,
      laneId: lane.id,
      spawn: [lane.spawn[0] + rand(-6, 6), lane.spawn[1] + rand(-3, 5)],
      waypoints: lane.waypoints,
      gateWaypointIndex: 0,
      hpOverride,
      label: `MERCER ${kind.toUpperCase()}-${seq}`,
    });
    this.groundWarSpawns++;
  }

  private spawnHalcyonEnemySquad(
    origin: readonly [number, number, number],
    goal: readonly [number, number, number],
    count: number,
  ): void {
    if (count <= 0) return;
    const ids: EnemyId[] = ['rocketeer'];
    while (ids.length < count) {
      ids.push(HALCYON_INFANTRY_POOL[Math.floor(Math.random() * HALCYON_INFANTRY_POOL.length)]!);
    }

    const o = this.outpost;
    if (o) {
      const base = new THREE.Vector3(origin[0], origin[1], origin[2]);
      const squad = o.muster(ids.length, base);
      for (const id of ids) {
        o.enlistInto(squad, id, new THREE.Vector3(origin[0] + rand(-6, 6), origin[1], origin[2] + rand(-5, 5)));
      }
      const nowSec = o.w?.now ?? Math.max(0.1, this.groundWarElapsed);
      squad.adopt?.(new THREE.Vector3(goal[0] + rand(-12, 12), goal[1], goal[2] + rand(-10, 10)), nowSec + 0.05);
      this.enemyGroundSquads.push({ squad, laneX: goal[0] });
      this.groundWarSpawns++;
      return;
    }

    // Fallback when running under minimal unit-test harnesses without Outpost tactical AI
    const spawnFn = (this.ctx.enemies as unknown as { spawn?: (id: EnemyId, at: THREE.Vector3) => unknown } | undefined)?.spawn;
    if (spawnFn) {
      for (const id of ids) {
        spawnFn.call(this.ctx.enemies, id, new THREE.Vector3(origin[0] + rand(-6, 6), origin[1], origin[2] + rand(-5, 5)));
      }
      this.groundWarSpawns++;
    }
  }

  private spawnHalcyonEnemyArmor(
    kind: 'tank' | 'humvee' | 'truck',
    spawnXZ: readonly [number, number],
    waypointsXZ: readonly (readonly [number, number])[],
  ): void {
    const vehSys = this.vehicleSystem;
    if (!vehSys?.order) return;

    const seq = ++this.enemyVehSeq;
    const crew: EnemyId[] | undefined =
      kind === 'truck'
        ? ['trooper', 'gunner', 'rocketeer', 'stalker']
        : kind === 'humvee'
          ? ['trooper', 'rocketeer']
          : undefined;

    vehSys.order(
      { do: 'vehicle', tag: `halcyon_war_${kind}_${seq}`, kind, at: 's0', route: 'r', crew, ensure: true },
      { at: [spawnXZ[0], 0, spawnXZ[1]], yaw: 0 },
      waypointsXZ.map(wp => ({ at: [wp[0], 0, wp[1]] as const, yaw: 0 })),
    );
    this.groundWarSpawns++;
  }

  private pickEnemyInfantrySpawn(): readonly [number, number, number] {
    const candidates: (readonly [number, number, number])[] = [];
    if (!this.breachedSignaled) {
      candidates.push([-68, 0, 112], [0, 0, 112], [68, 0, 112], [-32, 0, 68], [32, 0, 68]);
    } else {
      if (!this.armoryDownSignaled) candidates.push([-62, 0, 16]);
      if (!this.airfieldDownSignaled) candidates.push([62, 0, 16]);
      const barracksEast = getHalcyonTarget('barracks_east');
      if (!barracksEast || !this.isTargetDestroyed(barracksEast)) candidates.push([64, 0, -68]);
      candidates.push([-22, 0, -24], [22, 0, -24], [0, 0, 32]);
    }
    return candidates[Math.floor(Math.random() * candidates.length)] ?? [0, 0, -24];
  }

  private refreshGroundFrontlineOrders(): void {
    const frontZ = this.getGroundFrontlineZ();
    const lanes = [-64, 0, 64] as const;

    // Advance Mercer's detached ground infantry toward the current phase frontline
    const allies = this.ctx.allies?.allies ?? [];
    for (let i = 0; i < allies.length; i++) {
      const a = allies[i]!;
      if (!a.alive || !a.detached) continue;
      if (a.post.z > frontZ + 26) {
        const laneX = lanes[i % lanes.length]!;
        a.post.set(laneX + rand(-18, 18), 0, frontZ + rand(-8, 12));
      }
    }

    // Re-adopt active Halcyon enemy squads toward Mercer's advancing frontline and prune wiped squads
    const nowSec = this.outpost?.w?.now ?? Math.max(0.1, this.groundWarElapsed);
    for (let i = this.enemyGroundSquads.length - 1; i >= 0; i--) {
      const entry = this.enemyGroundSquads[i]!;
      const members = (entry.squad as unknown as { members?: readonly { e?: { alive?: boolean } }[] }).members;
      if (members && !members.some(m => m.e?.alive)) {
        this.enemyGroundSquads.splice(i, 1);
        continue;
      }
      entry.squad.adopt?.(new THREE.Vector3(entry.laneX + rand(-14, 14), 0, frontZ + rand(-8, 16)), nowSec + 0.05);
    }
  }

  private tickGroundWar(dt: number): void {
    if (this.hqDestroyedSignaled || this.leveledActive || this.handoffTriggered) return;
    this.groundWarElapsed += dt;

    const frontZ = this.getGroundFrontlineZ();
    const lanes = [-64, 0, 64] as const;

    // 1. Friendly Mercer infantry reinforcements (cap 20 alive)
    this.friendlyInfTimer -= dt;
    if (this.friendlyInfTimer <= 0) {
      this.friendlyInfTimer = 5.5;
      const aliveAllies = this.ctx.allies?.allies?.filter(a => a.alive).length ?? 0;
      if (aliveAllies < 20) {
        const laneX = lanes[Math.floor(Math.random() * lanes.length)]!;
        const spawnZ = this.valkyrieDropped ? 46 : 146;
        const count = Math.min(4, 20 - aliveAllies);
        this.spawnMercerInfantrySquad([laneX, 0, spawnZ], [laneX, 0, frontZ + 6], count);
      }
    }

    // 2. Friendly Mercer armor reinforcements (cap 7 live ground vehicles)
    this.friendlyArmorTimer -= dt;
    if (this.friendlyArmorTimer <= 0) {
      this.friendlyArmorTimer = 16;
      const liveGround = this.fleet?.getLiveGroundTargets(false).length ?? 0;
      if (liveGround < 7) {
        this.spawnMercerReinforcementArmor();
      }
    }

    // 3. Enemy Halcyon infantry warbands (cap 28 alive)
    this.enemyInfTimer -= dt;
    if (this.enemyInfTimer <= 0) {
      this.enemyInfTimer = 4.8;
      const aliveEnemies = this.ctx.enemies?.alive?.length ?? 0;
      if (aliveEnemies < 28) {
        const origin = this.pickEnemyInfantrySpawn();
        const laneX = lanes[Math.floor(Math.random() * lanes.length)]!;
        const count = Math.min(5, 28 - aliveEnemies);
        this.spawnHalcyonEnemySquad(origin, [laneX, 0, frontZ + 12], count);
      }
    }

    // 4. Enemy Halcyon counterattack armor & crewed troop trucks (cap 5 live ground vehicles)
    this.enemyArmorTimer -= dt;
    if (this.enemyArmorTimer <= 0) {
      this.enemyArmorTimer = 14;
      const liveEnemyGround = (this.vehicleSystem?.live ?? []).filter(
        v => v.alive && v.def?.kind !== 'chopper',
      ).length;
      if (liveEnemyGround < 5) {
        const roll = Math.random();
        const kind: 'tank' | 'humvee' | 'truck' =
          !this.armoryDownSignaled && roll < 0.42 ? 'tank' : (roll < 0.72 ? 'truck' : 'humvee');
        const westLane = HALCYON_GROUND_LANES.find(l => l.id === 'lane_enemy_armor_west');
        const eastLane = HALCYON_GROUND_LANES.find(l => l.id === 'lane_enemy_armor_east');
        const useWest = !this.armoryDownSignaled && (Math.random() < 0.5 || !eastLane);
        const chosen = useWest ? westLane : eastLane;
        if (chosen) {
          this.spawnHalcyonEnemyArmor(kind, chosen.spawn, chosen.waypoints);
        } else {
          this.spawnHalcyonEnemyArmor(kind, [0, -28], [[0, 12], [0, frontZ + 10]]);
        }
      }
    }

    // 5. Periodic dynamic frontline marching updates
    this.groundOrderTimer -= dt;
    if (this.groundOrderTimer <= 0) {
      this.groundOrderTimer = 3.0;
      this.refreshGroundFrontlineOrders();
    }
  }

  private openBreachGates(): void {
    if (!this.fleet) return;
    this.fleet.setGateOpen('lane_center_breach', true);
    this.fleet.setGateOpen('lane_west_breach', true);
    this.fleet.setGateOpen('lane_east_breach', true);
    this.fleet.setGateOpen('lane_beach_infantry_w', true);
  }

  private startArmorPush(): void {
    this.armorPushActive = true;
    this.openBreachGates();

    // Activate Halcyon's 3 Mortar Trenches & 2 outer SAM Batteries (skipping any already bombed!)
    this.mountDefenseSubset(RIDGE_DEFENSE_IDS);

    // Move Kestrel CAS orbit inside the forward trench line
    const kestrel = this.fleet?.getById('mercer_kestrel_cas');
    if (kestrel) {
      kestrel.orbitCenter.set(0, 0, 68);
    }

    this.liveCallout = 'MERCER PINNED BY MORTARS & OUTER SAMs — USE CBU-105 CLUSTER!';
    this.ctx.hud?.feed?.('HALCYON MORTAR TRENCHES & SAM BATTERIES ALPHA/BRAVO ACTIVE!', '#ff9f1c');
    this.refreshGroundFrontlineOrders();
    this.evaluateMilestones();
    this.syncHud();
  }

  private launchValkyrieDrops(): void {
    if (this.valkyrieDropped || !this.fleet) return;
    this.valkyrieDropped = true;

    const innerLzs = HALCYON_CHOPPER_LZS.filter(lz => lz.phase === 'inner_assault');
    for (let i = 0; i < innerLzs.length; i++) {
      const lz = innerLzs[i]!;
      this.fleet.spawnValkyrie({
        id: `mercer_valkyrie_${i + 1}`,
        lzId: lz.id,
        approachFrom: lz.approachFrom,
        lzPos: lz.pos,
        egressTo: lz.egressTo,
        squadCount: 4,
        label: `VALKYRIE ASSAULT-${i + 1}`,
        onTroopsDeployed: () => {
          this.ctx.hud?.feed?.(`MERCER FAST-ROPE SQUAD ON THE DECK AT ${lz.name}!`, '#38e8ff');
        },
      });
    }

    this.liveCallout = 'VALKYRIE CHOPPERS FAST-ROPING INTO INNER COURTYARD!';
    this.syncHud();
  }

  private startWarMachinePhase(): void {
    if (this.warMachineActive) return;
    this.warMachineActive = true;

    // Activate inner & northern ridge defenses (North Flak, SAM NW/NE, Geodesic Radar Domes)
    this.mountDefenseSubset(WAR_MACHINE_DEFENSE_IDS);

    // Unleash enemy counterattack armor & gunship choppers on the ground!
    const vehSys = this.vehicleSystem;
    if (vehSys?.order) {
      const westEnemyLane = HALCYON_GROUND_LANES.find(l => l.id === 'lane_enemy_armor_west');
      const eastEnemyLane = HALCYON_GROUND_LANES.find(l => l.id === 'lane_enemy_armor_east');

      if (westEnemyLane) {
        vehSys.order(
          { do: 'vehicle', tag: 'halcyon_tank_w', kind: 'tank', at: 'w0', route: 'r', ensure: true },
          { at: [westEnemyLane.spawn[0], 0, westEnemyLane.spawn[1]], yaw: 0 },
          westEnemyLane.waypoints.map(wp => ({ at: [wp[0], 0, wp[1]] as const, yaw: 0 })),
        );
      }
      if (eastEnemyLane) {
        vehSys.order(
          { do: 'vehicle', tag: 'halcyon_tank_e', kind: 'tank', at: 'e0', route: 'r', ensure: true },
          { at: [eastEnemyLane.spawn[0], 0, eastEnemyLane.spawn[1]], yaw: 0 },
          eastEnemyLane.waypoints.map(wp => ({ at: [wp[0], 0, wp[1]] as const, yaw: 0 })),
        );
      }
      // Enemy fortress defense attack chopper orbiting Citadel plaza
      vehSys.order(
        { do: 'vehicle', tag: 'halcyon_gunship', kind: 'chopper', at: 'c0', route: 'r', ensure: true },
        { at: [99, 44, -14], yaw: -Math.PI * 0.5 },
        [
          { at: [-120, 48, 30], yaw: 0 },
          { at: [120, 48, 30], yaw: 0 },
          { at: [120, 48, -90], yaw: 0 },
          { at: [-120, 48, -90], yaw: 0 },
        ],
      );
    }

    // Scramble 2 fresh Halcyon Hornet interceptors from East Airfield
    if (this.airWing) {
      this.airWing.spawnEnemy('hornet', new THREE.Vector3(100, 95, -180), 0, 0.72, {
        waveId: 'halcyon_scramble',
        label: 'QRA HORNET-1',
      });
      this.airWing.spawnEnemy('hornet', new THREE.Vector3(-100, 110, -220), 0, 0.72, {
        waveId: 'halcyon_scramble',
        label: 'QRA HORNET-2',
      });
    }

    this.liveCallout = 'OPEN HUNTING: FLATTEN ARMORY, AIRFIELD, FUEL FARM & RADAR DOMES!';
    this.ctx.hud?.feed?.('HALCYON WAR MACHINE UNLEASHED — ENEMY ARMOR & QRA SCRAMBLING!', '#ff5a4f');
    this.refreshGroundFrontlineOrders();
    this.evaluateMilestones();
    this.syncHud();
  }

  private startCitadelSiege(): void {
    if (this.citadelSiegeActive) return;
    this.citadelSiegeActive = true;

    // Top off all B-1B Lancer bomb bays WITHOUT overriding selected mode so the player switches with [R]!
    const activeLancer = this.playerLancer ?? (this.driveables?.active?.def.id === 'lancer' ? this.driveables.active : null);
    activeLancer?.refillOrdnance();

    // Shift Kestrel CAS orbit directly over the Center Citadel plaza
    const kestrel = this.fleet?.getById('mercer_kestrel_cas');
    if (kestrel) {
      kestrel.orbitCenter.set(HALCYON_CITADEL_HQ_POS[0], 0, HALCYON_CITADEL_HQ_POS[2]);
      kestrel.orbitRadius = 56;
    }

    // Place a vivid priority world marker on the Tier-3 Reinforced Command HQ
    this.unmarkHq?.();
    this.unmarkHq = this.ctx.hud?.marker?.(
      new THREE.Vector3(HALCYON_CITADEL_HQ_POS[0], 18, HALCYON_CITADEL_HQ_POS[2]),
      'PRIMARY: CRACK CITADEL HQ (BLU-121 THERMOBARIC)',
      '#ff3864',
    ) ?? null;

    this.liveCallout = 'BOMB BAYS REFILLED — SWITCH TO BLU-121 THERMOBARIC [R] TO CRACK CITADEL HQ!';
    this.ctx.hud?.feed?.('BOMB BAYS REFILLED — SWITCH TO BLU-121 THERMOBARIC [R] TO CRACK CITADEL HQ!', '#ff3864');
    this.refreshGroundFrontlineOrders();
    this.evaluateMilestones();
    this.syncHud();
  }

  private triggerHalcyonLeveled(): void {
    if (this.leveledActive) return;
    this.leveledActive = true;
    this.leveledClock = 0;
    this.unmarkHq?.();
    this.unmarkHq = null;

    // Dramatic chain devastation fireballs across the fallen fortress
    const center = new THREE.Vector3(HALCYON_CITADEL_HQ_POS[0], 6, HALCYON_CITADEL_HQ_POS[2]);
    this.ctx.fx?.explosion?.(center, { radius: 40, scale: 3.8, kind: 'thermobaric' });
    this.ctx.audio?.play?.('rocket_explosion', { position: center, volume: 1.0, pitch: 0.58 });

    this.liveCallout = 'FORTRESS HALCYON LEVELED — BREAK SOUTH FOR DUSK SEA EGRESS!';
    this.syncHud();
  }

  private handoffToReturn(): void {
    if (this.handoffTriggered) return;
    this.handoffTriggered = true;

    const prev = loadChainState() ?? createInitialChainState({ part: 3, contractor: 'A' });
    const prog = this.ctx.progression;
    const maxHp = prev.lancerMaxHp || CROSSFIRE_DEFAULT_LANCER_MAX_HP;

    // Carry forward battle-damaged Lancer HP (capped at 72% so the smoking wounded egress feels authentic!)
    const activeLancer = this.playerLancer ?? (this.driveables?.active?.def.id === 'lancer' ? this.driveables.active : null);
    const liveFrac = activeLancer && activeLancer.def.maxHealth > 0
      ? activeLancer.health / activeLancer.def.maxHealth
      : 0.62;
    const damagedHp = Math.round(maxHp * clamp(liveFrac, 0.35, 0.72));

    this.hudOverlay.hide();
    void transitionToCrossfirePart(
      'crossfire_return',
      {
        part: 4,
        contractor: 'B',
        lancerHp: damagedHp,
        lancerMaxHp: maxHp,
        score: (prev.score ?? 0) + (prog?.score ?? 0),
        kills: (prev.kills ?? 0) + (prog?.kills ?? 0),
        elapsed: (prev.elapsed ?? 0) + (this.runner.elapsed ?? 0),
        deaths: (prev.deaths ?? 0) + (this.runner.deaths ?? 0),
      },
      'TRANSFERRING TO CONTRACTOR #7712-B // DUSK EGRESS ESCORT',
      {
        sublabel: 'HALCYON DESTROYED · LANCER ENGINE #2 SMOKING · RETURN TO CVN-91',
      },
    );
  }

  private isTargetDestroyed(target: HalcyonTargetDef): boolean {
    // Tier-3 Citadel Command HQ requires both Stage 1 (BLU-121 Thermobaric crack) and Stage 2 (BLU-27 Napalm burn-out)
    if (target.id === 'citadel_command_hq') {
      return this.hqBurned;
    }

    if (this.destroyedTargets.has(target.id)) return true;

    // Check linked BaseDefenseSystem site
    const siteDef = HALCYON_DEFENSE_SITES.find(s => s.targetId === target.id);
    if (siteDef && this.mountedDefenseIds.has(siteDef.id)) {
      const site = this.defenses?.getSite(siteDef.id);
      if (site && !site.alive) {
        this.destroyedTargets.add(target.id);
        return true;
      }
    }

    // Check linked Structures (breachable walls & gates)
    if (target.structureIds.length > 0) {
      const structs = this.ctx.world?.objects?.structures;
      if (structs && structs.length > 0) {
        for (const sid of target.structureIds) {
          const st = structs[sid];
          if (st && st.stage === 'breached') {
            this.destroyedTargets.add(target.id);
            return true;
          }
        }
      }
    }

    // Check linked DestructionManager clusters
    const dest = this.ctx.world?.objects?.destruction;
    if (dest && target.clusterIds.length > 0) {
      let existing = 0;
      let broken = 0;
      for (const cid of target.clusterIds) {
        const c = dest.getCluster(cid);
        if (!c) continue;
        existing++;
        if (c.collapsed || c.destroyedFraction >= 0.5) broken++;
      }
      if (existing > 0 && broken >= Math.ceil(existing * 0.5)) {
        this.destroyedTargets.add(target.id);
        return true;
      }
    }

    return false;
  }

  private isGroupDown(targetIds: readonly string[], requiredFraction = 0.5): boolean {
    let down = 0;
    for (const id of targetIds) {
      const def = getHalcyonTarget(id);
      if (def && this.isTargetDestroyed(def)) down++;
    }
    return down >= Math.max(1, Math.ceil(targetIds.length * requiredFraction));
  }

  private isSectionBBreached(): boolean {
    const wallTarget = getHalcyonTarget('wall_section_b');
    if (wallTarget && this.isTargetDestroyed(wallTarget)) return true;
    const structs = this.ctx.world?.objects?.structures;
    if (structs && structs.length > 0) {
      for (const sid of BREACH_SECTION_B_IDS) {
        if (structs[sid]?.stage === 'breached') return true;
      }
    }
    return false;
  }

  private isDefenseSiteDead(siteId: string): boolean {
    const site = this.defenses?.getSite(siteId);
    if (site) return !site.alive;
    const def = HALCYON_DEFENSE_SITES.find(s => s.id === siteId);
    if (!def) return false;
    const target = getHalcyonTarget(def.targetId);
    return target ? this.isTargetDestroyed(target) : false;
  }

  /** Evaluates every active Halcyon phase condition and raises corresponding `cf:*` signals. */
  evaluateMilestones(): void {
    if (!this.active) return;

    // Beat 1: Beachhead Breach (Section B + Outer Flak West/East)
    if (this.breachWatchActive && !this.breachedSignaled) {
      const wallOpen = this.isSectionBBreached();
      const flaksDown = this.isDefenseSiteDead('site_flak_west') && this.isDefenseSiteDead('site_flak_east');
      if (wallOpen && flaksDown) {
        this.breachedSignaled = true;
        this.openBreachGates();
        this.liveCallout = 'SECTION B BREACHED — MERCER ARMOR ROLLING INSIDE HALCYON!';
        this.ctx.hud?.feed?.('SECTION B BREACHED — MERCER ARMOR POURING THROUGH!', '#54ff9d');
        this.runner.signal(CROSSFIRE_SIGNALS.halcyonBreached);
      }
    }

    // Beat 2: Ridge Suppression (3 Mortar Trenches + Outer SAM Alpha/Bravo)
    if (this.armorPushActive && !this.ridgeClearSignaled) {
      const ridgeDown =
        this.isDefenseSiteDead('site_mortar_west')
        && this.isDefenseSiteDead('site_mortar_center')
        && this.isDefenseSiteDead('site_mortar_east')
        && this.isDefenseSiteDead('site_sam_sw')
        && this.isDefenseSiteDead('site_sam_se');
      if (ridgeDown) {
        this.ridgeClearSignaled = true;
        this.liveCallout = 'RIDGE SUPPRESSED — VALKYRIE ASSAULT CHOPPERS CLEARED INBOUND!';
        this.ctx.hud?.feed?.('MORTARS & OUTER SAMs WIPED — VALKYRIE LZ CLEAR!', '#54ff9d');
        this.runner.signal(CROSSFIRE_SIGNALS.halcyonRidgeClear);
      }
    }

    // Beat 3: War Machine Open-Hunting Sectors
    if (this.warMachineActive) {
      if (!this.armoryDownSignaled && this.isGroupDown(ARMORY_TARGET_IDS, 0.5)) {
        this.armoryDownSignaled = true;
        this.ctx.hud?.feed?.('WEST TANK ARMORY & MOTOR POOL FLATTENED!', '#54ff9d');
        this.runner.signal(CROSSFIRE_SIGNALS.halcyonArmoryDown);
      }
      if (!this.airfieldDownSignaled && this.isGroupDown(AIRFIELD_TARGET_IDS, 0.5)) {
        this.airfieldDownSignaled = true;
        this.ctx.hud?.feed?.('EAST HARDENED AIRFIELD & HANGARS DESTROYED!', '#54ff9d');
        this.runner.signal(CROSSFIRE_SIGNALS.halcyonAirfieldDown);
      }
      if (!this.fuelDownSignaled && this.isGroupDown(FUEL_TARGET_IDS, 0.5)) {
        this.fuelDownSignaled = true;
        this.ctx.hud?.feed?.('NW FUEL TANK FARM COOKED OFF — SECONDARY CHAIN DETONATION!', '#ff9f1c');
        this.runner.signal(CROSSFIRE_SIGNALS.halcyonFuelDown);
      }
      if (!this.radarDownSignaled && this.isGroupDown(RADAR_TARGET_IDS, 1.0)) {
        this.radarDownSignaled = true;
        this.runner.signal(CROSSFIRE_SIGNALS.halcyonRadarDown);
      }

      if (!this.warBrokenSignaled) {
        const sectorsDown =
          (this.armoryDownSignaled ? 1 : 0)
          + (this.airfieldDownSignaled ? 1 : 0)
          + (this.fuelDownSignaled ? 1 : 0)
          + (this.radarDownSignaled ? 1 : 0);
        if (sectorsDown >= 3 || this.flattenedFraction >= 0.6) {
          this.warBrokenSignaled = true;
          this.liveCallout = 'HALCYON WAR MACHINE BROKEN — CITADEL COMMAND HQ EXPOSED!';
          this.ctx.hud?.feed?.('FORTRESS HALCYON WAR MACHINE SHATTERED!', '#54ff9d');
          this.runner.signal(CROSSFIRE_SIGNALS.halcyonWarBroken);
        }
      }
    }

    // Beat 4 Stage 1: BLU-121 Thermobaric cracks the Tier-3 Reinforced Concrete Bunker -> switch to BLU-27 Napalm
    if (this.citadelSiegeActive && this.hqCracked && !this.hqCrackedSignaled) {
      this.hqCrackedSignaled = true;
      const activeLancer = this.playerLancer ?? (this.driveables?.active?.def.id === 'lancer' ? this.driveables.active : null);
      activeLancer?.refillOrdnance();

      this.unmarkHq?.();
      this.unmarkHq = this.ctx.hud?.marker?.(
        new THREE.Vector3(HALCYON_CITADEL_HQ_POS[0], 18, HALCYON_CITADEL_HQ_POS[2]),
        'PRIMARY: BURN HALVORSEN OUT (BLU-27 NAPALM)',
        '#ff7b2e',
      ) ?? null;

      this.liveCallout = 'CONCRETE CRACKED — SWITCH TO BLU-27 NAPALM [R] TO BURN HALVORSEN OUT!';
      this.ctx.hud?.feed?.('CITADEL CONCRETE CRACKED — SWITCH TO BLU-27 NAPALM [R] & TORCH HALVORSEN!', '#ff7b2e');
      this.runner.signal(CROSSFIRE_SIGNALS.halcyonHqCracked);
    }

    // Beat 4 Stage 2: BLU-27 Napalm burns General Halvorsen out of the cracked vault
    if (this.citadelSiegeActive && this.hqBurned && !this.hqDestroyedSignaled) {
      this.hqDestroyedSignaled = true;
      this.unmarkHq?.();
      this.unmarkHq = null;
      this.liveCallout = 'NAPALM DIRECT HIT — GENERAL HALVORSEN BURNING INSIDE CITADEL HQ!';
      this.ctx.hud?.feed?.('NAPALM INFERNO INSIDE CITADEL HQ — GENERAL HALVORSEN ELIMINATED!', '#54ff9d');
      this.runner.signal(CROSSFIRE_SIGNALS.halcyonHqDestroyed);
    }
  }

  /** 0..1 fraction of Fortress Halcyon targets flattened. */
  get flattenedFraction(): number {
    if (this.leveledActive) return 1;
    let total = 0;
    let done = 0;
    for (const t of HALCYON_TARGETS) {
      total++;
      if (this.isTargetDestroyed(t)) done++;
    }
    return total > 0 ? done / total : 0;
  }

  private syncHud(): void {
    if (!this.active || this.handoffTriggered) {
      this.hudOverlay.hide();
      return;
    }

    const hqLabel = this.citadelSiegeActive && !this.hqDestroyedSignaled
      ? (this.hqCrackedSignaled ? 'BURN HQ (NAPALM)' : 'CRACK HQ (THERMO)')
      : 'CITADEL HQ';

    const badges: HalcyonHudBadge[] = [
      { id: 'sec_b', label: 'SEC-B', done: this.breachedSignaled, active: this.breachWatchActive && !this.breachedSignaled },
      { id: 'ridge', label: 'MORTARS/SAMs', done: this.ridgeClearSignaled, active: this.armorPushActive && !this.ridgeClearSignaled },
      { id: 'armory', label: 'ARMORY', done: this.armoryDownSignaled, active: this.warMachineActive && !this.armoryDownSignaled },
      { id: 'airfield', label: 'AIRFIELD', done: this.airfieldDownSignaled, active: this.warMachineActive && !this.airfieldDownSignaled },
      { id: 'fuel', label: 'FUEL', done: this.fuelDownSignaled, active: this.warMachineActive && !this.fuelDownSignaled },
      { id: 'radar', label: 'RADARS', done: this.radarDownSignaled, active: this.warMachineActive && !this.radarDownSignaled },
      { id: 'hq', label: hqLabel, done: this.hqDestroyedSignaled, active: this.citadelSiegeActive && !this.hqDestroyedSignaled },
    ];

    this.hudOverlay.updateHalcyon({
      flattenedPct: Math.round(this.flattenedFraction * 100),
      callout: this.liveCallout,
      badges,
    });
  }

  private tickPlayerLancerSurvivalAndRepair(dt: number): void {
    if (this.handoffTriggered || this.leveledActive || this.isCutscenePlaying()) return;
    const p = this.ctx.player;
    if (!p || !p.alive) return;

    const lancer = this.playerLancer;
    if (lancer && !lancer.alive) {
      if (this.playerCrashTimer < 0) {
        this.playerCrashTimer = 0.75;
        this.ctx.hud?.feed?.('B-1B LANCER SHOT DOWN — EJECTING!', '#ff3b2f');
      }
      this.playerCrashTimer -= dt;
      if (this.playerCrashTimer <= 0 || p.position.y < 14) {
        this.downPlayerCleanly('aircraft_destroyed');
      }
      return;
    }

    // Gentle out-of-combat damage-control self-repair between bombing runs so Part 3 doesn't soft-wall on attrition
    if (lancer && lancer.alive && lancer.occupied) {
      if (this.lancerLastHp >= 0 && lancer.health < this.lancerLastHp - 0.5) {
        this.lancerNoDamageTimer = 0;
      } else {
        this.lancerNoDamageTimer += dt;
      }
      if (this.lancerNoDamageTimer >= 5.5 && lancer.health < lancer.def.maxHealth) {
        lancer.health = Math.min(lancer.def.maxHealth, lancer.health + 75 * dt);
      }
      this.lancerLastHp = lancer.health;
    }
  }

  update(dt: number): void {
    if (!this.built || !this.active || dt <= 0) return;

    if (this.hqHintCooldown > 0) {
      this.hqHintCooldown = Math.max(0, this.hqHintCooldown - dt);
    }

    // 0. Hold Contractor A's B-1B Lancer cleanly at approach pose during the opening fly-in cutscene and re-seat once control hands back
    if (!this.introReboardDone && this.playerLancer?.alive) {
      if (this.isCutscenePlaying()) {
        this.introCutsceneSeen = true;
        this.positionPlayerLancerAtApproach(this.playerLancer);
      } else if (this.introCutsceneSeen) {
        this.introReboardDone = true;
        if (this.playerLancer.occupied) this.playerLancer.exit(true);
        this.positionPlayerLancerAtApproach(this.playerLancer);
        this.playerLancer.board(0);
      }
    }

    // 0b. Cleanly handle shot-down Lancer -> checkpoint redeploy & out-of-combat damage control repair
    this.tickPlayerLancerSurvivalAndRepair(dt);

    // 1. Tick Mercer's friendly combined-arms fleet (Aegis tanks, Bastion APCs, Jackals, Kestrel CAS, Valkyries)
    this.fleet?.update(dt);

    // 1b. Tick Endless-War-style live ground battle (Mercer vs Halcyon infantry, armor, trucks & dynamic frontline marching)
    this.tickGroundWar(dt);

    // 2. Tick Halcyon BaseDefenseSystem (Flak towers, Mortar trenches shelling Mercer armor, SAMs + Radar boost)
    const playerAirborne = Boolean(this.ctx.player?.alive && (this.ctx.player.parked || this.ctx.player.position.y > 16));
    this.defenses?.update(dt, {
      playerAirborne,
      playerVelocity: this.playerLancer?.alive ? this.playerLancer.phys.velocity : undefined,
      alliedJets: this.airWing?.allies ?? [],
      friendlyFleet: this.fleet,
    });

    // 3. Tick overhead air battle (2 allied F-22s vs Halcyon Hornet CAP)
    this.airWing?.update(dt);

    // 4. Keep CAP pressure alive while East Airfield hangars still stand during War Machine phase
    if (this.warMachineActive && !this.airfieldDownSignaled && !this.hqDestroyedSignaled && this.airWing) {
      this.capRespawnCd -= dt;
      if (this.capRespawnCd <= 0 && this.airWing.aliveEnemyCount() < 2) {
        this.capRespawnCd = 30;
        this.airWing.spawnEnemy(
          'hornet',
          new THREE.Vector3(rand(-240, 240), 138, -420),
          0,
          0.7,
          { label: 'HALCYON SCRAMBLE' },
        );
      }
    }

    // 5. Evaluate DestructionManager / Structure / BaseDefenseSystem milestone triggers
    this.evaluateMilestones();

    // 5b. Tick violent whole-HQ napalm eruption finale spectacle
    this.citadelInferno?.update(dt);

    // 6. Halcyon Leveled climax countdown -> `cf:halcyon_egress_ready`
    if (this.leveledActive && !this.egressReadySignaled) {
      this.leveledClock += dt;
      if (this.leveledClock >= 2.2) {
        this.egressReadySignaled = true;
        this.runner.signal(CROSSFIRE_SIGNALS.halcyonEgressReady);
      }
    }

    // 7. Throttled HUD refresh (~6 Hz)
    this.hudThrottle -= dt;
    if (this.hudThrottle <= 0) {
      this.hudThrottle = 0.16;
      this.syncHud();
    }
  }

  /** Exposed for unit tests & runtime inspection. */
  get defenseSystem(): BaseDefenseSystem | null {
    return this.defenses;
  }

  get vehicleFleet(): AiVehicleFleet | null {
    return this.fleet;
  }

  get airWingInstance(): CrossfireAirWing | null {
    return this.airWing;
  }

  get playerJet(): DriveableVehicle | null {
    return this.playerLancer;
  }

  get state() {
    return {
      active: this.active,
      breachWatchActive: this.breachWatchActive,
      breachedSignaled: this.breachedSignaled,
      armorPushActive: this.armorPushActive,
      ridgeClearSignaled: this.ridgeClearSignaled,
      valkyrieDropped: this.valkyrieDropped,
      warMachineActive: this.warMachineActive,
      armoryDownSignaled: this.armoryDownSignaled,
      airfieldDownSignaled: this.airfieldDownSignaled,
      fuelDownSignaled: this.fuelDownSignaled,
      radarDownSignaled: this.radarDownSignaled,
      warBrokenSignaled: this.warBrokenSignaled,
      citadelSiegeActive: this.citadelSiegeActive,
      hqCracked: this.hqCracked,
      hqCrackedSignaled: this.hqCrackedSignaled,
      hqBurned: this.hqBurned,
      hqInfernoActive: this.citadelInferno?.active ?? false,
      hqInfernoCookoffs: this.citadelInferno?.totalCookoffsFired ?? 0,
      hqDestroyedSignaled: this.hqDestroyedSignaled,
      leveledActive: this.leveledActive,
      egressReadySignaled: this.egressReadySignaled,
      handoffTriggered: this.handoffTriggered,
      flattenedPct: Math.round(this.flattenedFraction * 100),
      friendlyUnits: this.fleet?.units.length ?? 0,
      defenseSites: this.defenses?.totalCount ?? 0,
      enemyGroundSquads: this.enemyGroundSquads.length,
      groundWarSpawns: this.groundWarSpawns,
    };
  }

  private clearMissionState(): void {
    this.unmarkHq?.();
    this.unmarkHq = null;
    this.vehicleSystem?.setFriendlyVehicles?.(null);
    const allies = this.ctx.allies as (Ctx['allies'] & {
      extraFoeProvider?: ((soldier: Soldier) => Foe | null) | null;
    }) | undefined;
    if (allies) allies.extraFoeProvider = null;

    this.fleet?.clear();
    this.defenses?.clear();
    this.airWing?.clear();
    this.citadelInferno?.clear();
    this.hudOverlay.hide();

    this.active = false;
    this.playerLancer = null;
    this.introCutsceneSeen = false;
    this.introReboardDone = false;
    this.mountedDefenseIds.clear();
    this.targetDamage.clear();
    this.destroyedTargets.clear();
    this.enemyGroundSquads.length = 0;

    this.breachWatchActive = false;
    this.breachedSignaled = false;
    this.armorPushActive = false;
    this.ridgeClearSignaled = false;
    this.valkyrieDropped = false;
    this.warMachineActive = false;
    this.armoryDownSignaled = false;
    this.airfieldDownSignaled = false;
    this.fuelDownSignaled = false;
    this.radarDownSignaled = false;
    this.warBrokenSignaled = false;
    this.citadelSiegeActive = false;
    this.hqCrackDamage = 0;
    this.hqCracked = false;
    this.hqCrackedSignaled = false;
    this.hqBurned = false;
    this.hqDestroyedSignaled = false;
    this.hqHintCooldown = 0;
    this.leveledActive = false;
    this.leveledClock = 0;
    this.egressReadySignaled = false;
    this.handoffTriggered = false;
    this.groundWarElapsed = 0;
    this.friendlyInfTimer = 5.5;
    this.friendlyArmorTimer = 16;
    this.enemyInfTimer = 4.8;
    this.enemyArmorTimer = 14;
    this.groundOrderTimer = 3.0;
    this.groundWarSpawns = 0;
    this.enemyVehSeq = 0;
    this.allyArmorSeq = 0;
    this.hudThrottle = 0;
    this.capRespawnCd = 28;
    this.playerCrashTimer = -1;
    this.lancerLastHp = -1;
    this.lancerNoDamageTimer = 0;
  }

  clear(): void {
    this.clearMissionState();
  }

  reset(): void {
    this.clearMissionState();
    this.unhookExplosions();
    this.fleet?.dispose();
    this.fleet = null;
    this.defenses?.dispose();
    this.defenses = null;
    this.airWing?.dispose();
    this.airWing = null;
    this.citadelInferno?.dispose();
    this.citadelInferno = null;
    this.built = false;
  }
}
