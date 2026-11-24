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
import type { Ctx } from '../../core/contracts';
import { clamp, rand } from '../../core/math';
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

export class HalcyonDirector {
  private materials: ModelMaterials | null = null;
  private airWing: CrossfireAirWing | null = null;
  private defenses: BaseDefenseSystem | null = null;
  private fleet: AiVehicleFleet | null = null;
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
  private hqDestroyedSignaled = false;
  private leveledActive = false;
  private leveledClock = 0;
  private egressReadySignaled = false;
  private handoffTriggered = false;

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

  ensureBuilt(): void {
    if (this.built) return;
    this.built = true;

    this.materials = new ModelMaterials(this.ctx);
    this.airWing = new CrossfireAirWing(this.ctx);
    this.fleet = new AiVehicleFleet(this.ctx, this.materials);
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
        this.onWorldBlast(ev.position, ev.radius, ev.damage);
      });
      const u2 = this.ctx.events.on('world:explosion', ev => {
        this.onWorldBlast(ev.position, ev.radius, ev.damage);
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
        this.onWorldBlast(at, radius, damage);
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

  private onWorldBlast(at: THREE.Vector3, radius: number, damage: number): void {
    if (!this.active) return;
    // Apply splash damage to BaseDefenseSystem emplacements too (covers world.objects.blastHandler bombs)
    this.defenses?.applyBlast(at, radius, damage, 'lancer_ordnance', true);

    // Track blast damage against structured Halcyon targets (walls, facilities, Tier-3 HQ)
    for (const target of HALCYON_TARGETS) {
      if (this.destroyedTargets.has(target.id)) continue;
      const dx = at.x - target.pos[0];
      const dz = at.z - target.pos[2];
      const dist = Math.hypot(dx, dz);
      const reach = radius + target.radius;
      if (dist > reach) continue;
      const falloff = clamp(1 - (dist / Math.max(1, reach)) * 0.65, 0.3, 1);
      // Tier-3 Command HQ resists tiny blasts unless Citadel Siege is active or heavy ordnance hits
      const effectiveDmg = target.id === 'citadel_command_hq' && damage < 260 ? damage * 0.45 : damage;
      const next = (this.targetDamage.get(target.id) ?? 0) + effectiveDmg * falloff;
      this.targetDamage.set(target.id, next);
      if (next >= target.hp) {
        this.markTargetDestroyed(target.id, at);
      }
    }
    this.evaluateMilestones();
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
        this.halcyonInit();
        return true;
      case 'cf.halcyonBreachWatch':
        this.breachWatchActive = true;
        this.liveCallout = 'MERCER: BLOW SECTION B [0, 0, 98] & OUTER FLAK BASTIONS!';
        this.syncHud();
        return true;
      case 'cf.halcyonArmorPush':
        this.startArmorPush();
        return true;
      case 'cf.halcyonValkyrieDrop':
        this.launchValkyrieDrops();
        return true;
      case 'cf.halcyonWarMachine':
        this.startWarMachinePhase();
        return true;
      case 'cf.halcyonCitadelSiege':
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

  private mountDefenseSubset(ids: ReadonlySet<string>): void {
    if (!this.defenses) return;
    const toMount = HALCYON_DEFENSE_SITES.filter(s => ids.has(s.id) && !this.mountedDefenseIds.has(s.id));
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
    const veh = mgr.spawn('lancer', pos, yaw, { poolSlot: 'crossfire.halcyon_lancer' });
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

  private halcyonInit(): void {
    this.clearMissionState();
    this.active = true;

    // 1. Spawn Contractor A airborne in the overhauled 4-mode B-1B Lancer
    this.playerLancer = this.spawnPlayerAirborneLancer();

    // 2. Mount initial Outer Flak Bastions (`site_flak_west`, `site_flak_east`)
    this.mountDefenseSubset(INITIAL_DEFENSE_IDS);

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
    }

    // 4. Spawn Mercer's initial beachhead infantry squad if AlliesSystem is available
    if (this.ctx.allies?.spawn) {
      const types = ['rifleman', 'gunner', 'rocketeer', 'medic'] as const;
      for (let i = 0; i < types.length; i++) {
        this.ctx.allies.spawn(types[i]!, new THREE.Vector3(-18 + i * 12, 0, 146));
      }
    }

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

    // Activate Halcyon's 3 Mortar Trenches & 2 outer SAM Batteries
    this.mountDefenseSubset(RIDGE_DEFENSE_IDS);

    // Move Kestrel CAS orbit inside the forward trench line
    const kestrel = this.fleet?.getById('mercer_kestrel_cas');
    if (kestrel) {
      kestrel.orbitCenter.set(0, 0, 68);
    }

    this.liveCallout = 'MERCER PINNED BY MORTARS & OUTER SAMs — USE CBU-105 CLUSTER!';
    this.ctx.hud?.feed?.('HALCYON MORTAR TRENCHES & SAM BATTERIES ALPHA/BRAVO ACTIVE!', '#ff9f1c');
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
    this.syncHud();
  }

  private startCitadelSiege(): void {
    if (this.citadelSiegeActive) return;
    this.citadelSiegeActive = true;

    // Top off the player's B-1B Lancer bomb bays and arm Mode 3 (BLU-121/B Thermobaric)
    const activeLancer = this.playerLancer ?? (this.driveables?.active?.def.id === 'lancer' ? this.driveables.active : null);
    activeLancer?.refillOrdnance(3);

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
      'PRIMARY: CITADEL COMMAND HQ (BLU-121)',
      '#ff3864',
    ) ?? null;

    this.liveCallout = 'BOMB BAYS REFILLED — DROP BLU-121 THERMOBARIC ON CITADEL HQ!';
    this.ctx.hud?.feed?.('BLU-121/B THERMOBARIC ARMED — SHATTER CITADEL COMMAND HQ!', '#ff3864');
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

    // Beat 4: Center Citadel Tier-3 Command HQ
    if (this.citadelSiegeActive && !this.hqDestroyedSignaled) {
      const hq = getHalcyonTarget('citadel_command_hq');
      if (hq && this.isTargetDestroyed(hq)) {
        this.hqDestroyedSignaled = true;
        this.unmarkHq?.();
        this.unmarkHq = null;
        this.liveCallout = 'CITADEL COMMAND HQ COLLAPSED!';
        this.ctx.hud?.feed?.('FORTRESS HALCYON COMMAND HQ DESTROYED!', '#54ff9d');
        this.runner.signal(CROSSFIRE_SIGNALS.halcyonHqDestroyed);
      }
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

    const badges: HalcyonHudBadge[] = [
      { id: 'sec_b', label: 'SEC-B', done: this.breachedSignaled, active: this.breachWatchActive && !this.breachedSignaled },
      { id: 'ridge', label: 'MORTARS/SAMs', done: this.ridgeClearSignaled, active: this.armorPushActive && !this.ridgeClearSignaled },
      { id: 'armory', label: 'ARMORY', done: this.armoryDownSignaled, active: this.warMachineActive && !this.armoryDownSignaled },
      { id: 'airfield', label: 'AIRFIELD', done: this.airfieldDownSignaled, active: this.warMachineActive && !this.airfieldDownSignaled },
      { id: 'fuel', label: 'FUEL', done: this.fuelDownSignaled, active: this.warMachineActive && !this.fuelDownSignaled },
      { id: 'radar', label: 'RADARS', done: this.radarDownSignaled, active: this.warMachineActive && !this.radarDownSignaled },
      { id: 'hq', label: 'CITADEL HQ', done: this.hqDestroyedSignaled, active: this.citadelSiegeActive && !this.hqDestroyedSignaled },
    ];

    this.hudOverlay.updateHalcyon({
      flattenedPct: Math.round(this.flattenedFraction * 100),
      callout: this.liveCallout,
      badges,
    });
  }

  update(dt: number): void {
    if (!this.built || !this.active || dt <= 0) return;

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

    // 1. Tick Mercer's friendly combined-arms fleet (Aegis tanks, Bastion APCs, Jackals, Kestrel CAS, Valkyries)
    this.fleet?.update(dt);

    // 2. Tick Halcyon BaseDefenseSystem (Flak towers, Mortar trenches shelling Mercer armor, SAMs + Radar boost)
    const playerAirborne = Boolean(this.ctx.player?.alive && (this.ctx.player.parked || this.ctx.player.position.y > 16));
    this.defenses?.update(dt, {
      playerAirborne,
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
      hqDestroyedSignaled: this.hqDestroyedSignaled,
      leveledActive: this.leveledActive,
      egressReadySignaled: this.egressReadySignaled,
      handoffTriggered: this.handoffTriggered,
      flattenedPct: Math.round(this.flattenedFraction * 100),
      friendlyUnits: this.fleet?.units.length ?? 0,
      defenseSites: this.defenses?.totalCount ?? 0,
    };
  }

  private clearMissionState(): void {
    this.unmarkHq?.();
    this.unmarkHq = null;
    this.vehicleSystem?.setFriendlyVehicles?.(null);
    this.fleet?.clear();
    this.defenses?.clear();
    this.airWing?.clear();
    this.hudOverlay.hide();

    this.active = false;
    this.playerLancer = null;
    this.introCutsceneSeen = false;
    this.introReboardDone = false;
    this.mountedDefenseIds.clear();
    this.targetDamage.clear();
    this.destroyedTargets.clear();

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
    this.hqDestroyedSignaled = false;
    this.leveledActive = false;
    this.leveledClock = 0;
    this.egressReadySignaled = false;
    this.handoffTriggered = false;
    this.hudThrottle = 0;
    this.capRespawnCd = 28;
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
    this.built = false;
  }
}
