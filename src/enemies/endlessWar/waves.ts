/**
 * Endless War Master Frontline Director (`EndlessWarWaves`).
 *
 * Nonstop, zero-downtime combined-arms war across a 480 m x 720 m overcast mud front divided
 * by a wide river with 3 fortified bridges:
 *   - Autonomous friendly army (`AllySystem` + `AiVehicleFleet`) continuously spawns at FOB Vanguard
 *     and fights across West, Center, and East lanes with zero micromanagement.
 *   - Uncapped Threat Escalation (`THREAT 1 -> ∞`) continuously ramps enemy Saltblood squads,
 *     convoys, tanks, attack choppers, hostile combat jets (`CrossfireAirWing`), SAM/Flak/Mortar
 *     emplacements (`BaseDefenseSystem`), paratroopers, Juggernauts, and Titans until inevitable defeat.
 *   - Pushing across the river to sabotage 5 Enemy Strategic Facilities (`StrategicFacilitySystem`)
 *     cripples enemy capabilities, pays large credit bounties, and fires 30-second Momentum Surges.
 *   - War Command Console (`[E]` at FOB kiosk or `[O]` Field Radio) spends credits on heavy
 *     reinforcement pushes (`Armored Spearhead`, `Airborne Platoon`, `Fighter/Gunship Wing`,
 *     `Rolling Artillery`, `Total Mobilization`, `FOB Repair & Overdrive`).
 *   - Infinite 4-second player respawn at Friendly FOB Vanguard; Lose Condition = FOB Command Core destroyed.
 */
import * as THREE from 'three';
import type { AllyType } from '../../allies/data';
import { CrossfireAirWing } from '../../campaign/crossfire/airWing';
import { BaseDefenseSystem } from '../../campaign/crossfire/baseDefense';
import type { Ctx } from '../../core/contracts';
import type { EnemyId, WavePhase, WaveSystem } from '../../core/gameplay';
import { clamp, rand } from '../../core/math';
import { AiVehicleFleet } from '../../vehicles/drive/aiDriver';
import { EXPLOSIONS } from '../../weapons/data';
import {
  ENDLESS_WAR_CHOPPER_LZS,
  ENDLESS_WAR_CROSSINGS,
  ENDLESS_WAR_ENEMY_DEFENSES,
  ENDLESS_WAR_ENEMY_LANES,
  ENDLESS_WAR_ENEMY_SPAWNS,
  ENDLESS_WAR_FACILITIES,
  ENDLESS_WAR_FRIENDLY_LANES,
  ENDLESS_WAR_FRIENDLY_SPAWNS,
  ENDLESS_WAR_PLAYER_SPAWN,
  ENDLESS_WAR_PLAYER_YAW,
  ENDLESS_WAR_PROCUREMENT_POD,
  ENDLESS_WAR_RALLY_Z,
  ENDLESS_WAR_SKY_SPAWNS,
  ENDLESS_WAR_WAR_CONSOLE,
  type StrategicFacilityPlan,
  type WarLaneId,
} from '../../world/map/endlessWar/plan';
import type { AiJetKind, AiJetTheater } from '../dogfight/aiJet';
import type { EnemyManager } from '../EnemyManager';
import type { Outpost } from '../outpost';
import { ParatrooperSystem, type DropZone } from '../rooftop/paratroopers';
import { StrategicFacilitySystem } from './facilities';
import { FobDefenseSystem } from './fobDefense';
import { EndlessWarHud, type BridgeOwner } from './hudOverlay';
import { WAR_BOOSTS, WarCommandUi, type WarBoostId } from './warConsoleUi';

export const ENDLESS_WAR_THREAT_STEP_SEC = 95;
export const ENDLESS_WAR_REDEPLOY_SEC = 4.0;
export const ENDLESS_WAR_MOMENTUM_SEC = 30.0;

const LANES: readonly WarLaneId[] = ['west', 'center', 'east'];
const CONSOLE_INTERACT_RANGE = 5.4;

const WAR_AIR_THEATER: AiJetTheater = {
  minAlt: 36,
  maxAlt: 330,
  turnRadius: 920,
  groundY: 0,
  dynamicGroundTarget: true,
};

/** Pure uncapped Threat Level calculation from elapsed seconds + deep fortress pressure. */
export function endlessWarThreatLevel(elapsedSec: number, deepSabotageCount = 0): { level: number; progress: number } {
  const effective = Math.max(0, elapsedSec) + Math.max(0, deepSabotageCount) * 28;
  const raw = effective / ENDLESS_WAR_THREAT_STEP_SEC;
  const level = 1 + Math.floor(raw);
  const progress = raw - Math.floor(raw);
  return { level, progress };
}

/** Pure enemy active force caps scaling with Threat Level while staying safely under MAX_ALIVE = 48. */
export function endlessWarEnemyCaps(threat: number): {
  infantryCap: number;
  groundVehCap: number;
  chopperCap: number;
  jetCap: number;
  infantryInterval: number;
  armorInterval: number;
  airInterval: number;
  bossInterval: number;
} {
  const t = Math.max(1, threat);
  return {
    infantryCap: Math.min(36, 22 + t * 2),
    groundVehCap: Math.min(6, 2 + Math.floor(t / 2)),
    chopperCap: t < 2 ? 0 : Math.min(2, 1 + Math.floor((t - 2) / 4)),
    jetCap: t < 4 ? 0 : Math.min(3, 1 + Math.floor((t - 4) / 3)),
    infantryInterval: Math.max(2.6, 8.2 - (t - 1) * 0.55),
    armorInterval: Math.max(11, 28 - (t - 1) * 1.8),
    airInterval: Math.max(18, 46 - (t - 1) * 2.6),
    bossInterval: Math.max(26, 72 - (t - 1) * 4.0),
  };
}

interface PendingArtilleryShell {
  pos: THREE.Vector3;
  delay: number;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _consolePos = new THREE.Vector3(ENDLESS_WAR_WAR_CONSOLE[0], 1.6, ENDLESS_WAR_WAR_CONSOLE[2]);

export class EndlessWarWaves implements WaveSystem {
  wave = 1;
  phase: WavePhase = 'spawning';
  remaining = 999;
  total = 999;
  nextWaveIn = 0;
  boss = false;

  readonly facilities: StrategicFacilitySystem;
  readonly fob: FobDefenseSystem;
  readonly allyFleet: AiVehicleFleet;
  readonly airWing: CrossfireAirWing;
  readonly baseDefense: BaseDefenseSystem;
  readonly warConsole: WarCommandUi;
  readonly hudOverlay: EndlessWarHud;
  readonly paratroopers: ParatrooperSystem;

  elapsedSec = 0;
  threatLevel = 1;
  threatProgress = 0;
  frontlineStage = 2; // Starts contesting the River Crossings
  deepestStage = 2;
  momentumLeft = 0;
  mobilizeLeft = 0;
  fobLost = false;
  boostsCalled = 0;
  readonly bridges: Record<WarLaneId, BridgeOwner> = { west: 'contested', center: 'contested', east: 'contested' };

  private active = false;
  private playing = true;
  private podDropped = false;
  private redeployLeft = 0;
  private deepSabotageCount = 0;
  private readonly boostCooldowns = new Map<WarBoostId, number>();
  private readonly pendingShells: PendingArtilleryShell[] = [];

  private friendlyInfTimer = 1.5;
  private friendlyArmorTimer = 6.0;
  private enemyInfTimer = 2.0;
  private enemyArmorTimer = 12.0;
  private enemyAirTimer = 28.0;
  private enemyJetTimer = 42.0;
  private enemyBossTimer = 50.0;
  private frontlineTimer = 0.5;
  private laneCursor = 0;
  private unprompt: (() => void) | null = null;
  private keyListener: ((e: KeyboardEvent) => void) | null = null;
  private readonly unsubs: (() => void)[] = [];

  constructor(
    private readonly ctx: Ctx,
    private readonly o: Outpost,
    private readonly manager: EnemyManager,
  ) {
    this.facilities = new StrategicFacilitySystem(ctx, {
      onDestroyed: plan => this.onFacilityDestroyed(plan),
      onRebuilt: plan => this.onFacilityRebuilt(plan),
    });
    this.fob = new FobDefenseSystem(ctx, () => this.onFobDestroyed());
    this.allyFleet = new AiVehicleFleet(ctx);
    this.airWing = new CrossfireAirWing(ctx, {
      onEnemyKilled: jet => {
        const shop = this.ctx.contracts?.shop as { credits?: number } | null | undefined;
        if (shop && typeof shop.credits === 'number') shop.credits += 350;
        this.ctx.progression?.award?.(350, `${jet.profile.name} SHOT DOWN`, jet.position);
      },
    }, WAR_AIR_THEATER);
    this.baseDefense = new BaseDefenseSystem(ctx);
    this.paratroopers = new ParatrooperSystem(ctx, o, manager);
    this.hudOverlay = new EndlessWarHud();
    this.warConsole = new WarCommandUi(ctx, {
      getCredits: () => this.getCredits(),
      getCooldown: id => this.boostCooldowns.get(id) ?? 0,
      getFobHpPct: () => this.fob.hpFrac,
      getThreatLevel: () => this.threatLevel,
      onOrder: id => this.orderBoost(id),
    });
  }

  init(): void {
    if (this.ctx.events?.on) {
      this.unsubs.push(
        this.ctx.events.on('run:start', () => this.start()),
        this.ctx.events.on('game:state', ({ to }) => {
          this.playing = to === 'playing';
          if (to === 'menu' || to === 'gameover') {
            this.warConsole.close();
            this.clearPrompt();
          }
        }),
      );
    }

    if (typeof window !== 'undefined') {
      this.keyListener = (e: KeyboardEvent) => {
        if (!this.active || !this.playing || this.fobLost || this.redeployLeft > 0) return;
        if (e.code !== 'KeyO' || e.repeat) return;
        if (this.warConsole.open) return;
        e.preventDefault();
        this.warConsole.show();
      };
      window.addEventListener('keydown', this.keyListener);
    }
  }

  start(): void {
    this.reset();
    this.active = true;
    this.facilities.init();
    this.fob.init();
    this.hudOverlay.mount();

    // Wire Friendly FOB Core + AiVehicleFleet into VehicleSystem so enemy tanks & choppers fight our armor & base!
    const vehicles = this.manager.vehicles;
    if (vehicles) {
      vehicles.registerFriendlyTarget(this.fob);
      vehicles.setFriendlyVehicles(() => this.allyFleet.getLiveGroundTargets());
    }

    // Spawn all Sector 3 & Sector 4 enemy SAM, Flak, Radar, and Mortar emplacements
    this.spawnAllBaseDefenses();

    // Seed an immediate opening clash across all 3 lanes so combat roars from second 1!
    for (const lane of LANES) {
      this.spawnFriendlySquad(lane, 4);
      this.spawnEnemySquad(lane, 5);
    }
    this.spawnFriendlyArmor('center', 'aegis');
    this.spawnFriendlyArmor('west', 'bastion');
    this.spawnEnemyArmor('center', 'humvee');
    this.spawnEnemyArmor('east', 'truck');

    this.ctx.hud?.feed?.('ENDLESS WAR — PUSH THE RIVER BRIDGES & SABOTAGE ENEMY FACILITIES', '#6beeff');
  }

  reset(): void {
    this.active = false;
    this.podDropped = false;
    this.elapsedSec = 0;
    this.threatLevel = 1;
    this.threatProgress = 0;
    this.wave = 1;
    this.phase = 'spawning';
    this.frontlineStage = 2;
    this.deepestStage = 2;
    this.momentumLeft = 0;
    this.mobilizeLeft = 0;
    this.fobLost = false;
    this.redeployLeft = 0;
    this.deepSabotageCount = 0;
    this.boostsCalled = 0;
    this.bridges.west = 'contested';
    this.bridges.center = 'contested';
    this.bridges.east = 'contested';
    this.boostCooldowns.clear();
    this.pendingShells.length = 0;

    this.friendlyInfTimer = 1.5;
    this.friendlyArmorTimer = 7.0;
    this.enemyInfTimer = 2.0;
    this.enemyArmorTimer = 14.0;
    this.enemyAirTimer = 30.0;
    this.enemyJetTimer = 48.0;
    this.enemyBossTimer = 55.0;
    this.frontlineTimer = 0.5;

    this.warConsole.close();
    this.clearPrompt();
    this.facilities.dispose();
    this.fob.dispose();
    this.allyFleet.clear();
    this.airWing.clear();
    this.baseDefense.clear();
    this.paratroopers.reset();
    this.hudOverlay.dispose();
  }

  /**
   * Called by `Hud.updateDeath` when the player dies.
   * Returns true to keep the endless war running and redeploy the player back at FOB Vanguard in 4 s!
   * Returns false if FOB Vanguard has already fallen (proceeding to Game Over).
   */
  redeploy(): boolean {
    if (!this.active || this.fobLost) return false;
    if (this.redeployLeft <= 0) {
      this.redeployLeft = ENDLESS_WAR_REDEPLOY_SEC;
    }
    return true;
  }

  private completePlayerRedeploy(): void {
    const p = this.ctx.player as {
      alive: boolean;
      health: number;
      maxHealth: number;
      armor: number;
      position: THREE.Vector3;
      yaw: number;
      pitch: number;
      teleport?: (pos: THREE.Vector3, yaw?: number) => void;
      reset?: () => void;
    } | undefined;
    if (!p) return;

    // Exit any destroyed/occupied seat cleanly
    const seats = (this.ctx as { seats?: { occupied?: boolean; exit?: () => void } }).seats;
    if (seats?.occupied) seats.exit?.();

    const spawn = new THREE.Vector3(...ENDLESS_WAR_PLAYER_SPAWN);
    p.alive = true;
    p.health = p.maxHealth;
    p.armor = Math.max(p.armor ?? 0, 50);
    if (typeof p.teleport === 'function') {
      p.teleport(spawn, ENDLESS_WAR_PLAYER_YAW);
    } else {
      p.position.copy(spawn);
      p.yaw = ENDLESS_WAR_PLAYER_YAW;
      p.pitch = 0;
    }
    this.ctx.input?.requestLock?.();
    this.ctx.hud?.feed?.('REDEPLOYED AT FOB VANGUARD — BACK IN THE FIGHT', '#5ceeff');
  }

  update(): void {
    if (!this.active) return;
    const dt = this.ctx.time.dt;
    if (dt <= 0) return;

    if (!this.podDropped) {
      this.podDropped = true;
      const pods = (this.ctx.progression as unknown as { pods?: { call(at: THREE.Vector3): void } } | undefined)?.pods;
      pods?.call?.(new THREE.Vector3(ENDLESS_WAR_PROCUREMENT_POD[0], ENDLESS_WAR_PROCUREMENT_POD[1], ENDLESS_WAR_PROCUREMENT_POD[2]));
    }

    // 1. Handle infinite 4-second player respawn countdown while war keeps raging
    if (this.redeployLeft > 0) {
      this.redeployLeft = Math.max(0, this.redeployLeft - dt);
      if (this.redeployLeft <= 0 && !this.fobLost) {
        this.completePlayerRedeploy();
      }
    }

    // 2. Uncapped Threat Level progression
    if (!this.fobLost) {
      this.elapsedSec += dt;
      const th = endlessWarThreatLevel(this.elapsedSec, this.deepSabotageCount);
      if (th.level > this.threatLevel) {
        this.threatLevel = th.level;
        this.wave = th.level;
        this.ctx.hud?.feed?.(`THREAT LEVEL ${this.threatLevel} — ENEMY FORCES ESCALATING`, '#ff6248');
      }
      this.threatProgress = th.progress;
    }

    // 3. Tick boost timers & active surge clocks
    if (this.momentumLeft > 0) this.momentumLeft = Math.max(0, this.momentumLeft - dt);
    if (this.mobilizeLeft > 0) this.mobilizeLeft = Math.max(0, this.mobilizeLeft - dt);
    for (const [id, cd] of this.boostCooldowns) {
      if (cd > 0) this.boostCooldowns.set(id, Math.max(0, cd - dt));
    }

    // 4. Update all war subsystems
    this.facilities.update(dt, this.threatLevel);
    this.allyFleet.update(dt);
    this.airWing.update(dt);
    this.paratroopers.update(dt);
    this.updateArtilleryShells(dt);

    const enemyVehicles = this.manager.vehicles?.live ?? [];
    this.fob.update(dt, this.manager.alive, enemyVehicles, this.airWing.enemies);

    // Update enemy SAM/Flak/Radar/Mortar emplacements (suppress mortars/SAMs when linked facility is down!)
    const artilleryUp = this.facilities.isAlive('artillery_battery');
    const radarUp = this.facilities.isAlive('radar_aa');
    this.baseDefense.update(dt, {
      alliedJets: this.airWing.allies,
      friendlyGroundTargets: [...this.allyFleet.getLiveGroundTargets(), this.fob],
    });
    void artilleryUp;
    void radarUp;

    // 5. Frontline bridgehead control & autonomous reinforcement directors
    this.frontlineTimer -= dt;
    if (this.frontlineTimer <= 0) {
      this.frontlineTimer = 0.6;
      this.evaluateFrontline();
    }

    if (!this.fobLost) {
      this.updateFriendlySpawners(dt);
      this.updateEnemySpawners(dt);
    }

    // 6. Physical FOB War Command Console interaction prompt
    this.updateWarConsolePrompt();

    // 7. Update compact War Front HUD + Redeploy Overlay
    this.hudOverlay.update(dt, {
      elapsedSec: this.elapsedSec,
      threatLevel: this.threatLevel,
      threatProgress: this.threatProgress,
      frontlineStage: this.frontlineStage,
      bridges: this.bridges,
      facilities: this.facilities.getSnapshots(),
      fobHpFrac: this.fob.hpFrac,
      fobUnderAttack: this.fob.underAttackTimer > 0,
      fobBreached: this.fob.breachedCount > 0,
      momentumLeft: this.momentumLeft,
      mobilizeLeft: this.mobilizeLeft,
      credits: this.getCredits(),
      redeployLeft: this.redeployLeft,
    });
  }

  // ---- Frontline & Bridgehead Evaluation ------------------------------------

  private evaluateFrontline(): void {
    const allies = this.ctx.allies?.allies ?? [];
    const enemies = this.manager.alive;
    const playerPos = this.ctx.player?.alive ? this.ctx.player.position : null;

    let friendlyBridges = 0;
    let enemyBridges = 0;

    for (const c of ENDLESS_WAR_CROSSINGS) {
      let fScore = 0;
      let eScore = 0;
      const r = c.captureRadius + 24;
      for (const a of allies) {
        if (!a.alive) continue;
        if (Math.hypot(a.body.position.x - c.x, a.body.position.z) <= r) fScore += 1;
      }
      for (const fv of this.allyFleet.getLiveGroundTargets()) {
        if (Math.hypot(fv.position.x - c.x, fv.position.z) <= r) fScore += 2.5;
      }
      if (playerPos && Math.hypot(playerPos.x - c.x, playerPos.z) <= r + 14) fScore += 3;

      for (const e of enemies) {
        if (!e.alive) continue;
        if (Math.hypot(e.position.x - c.x, e.position.z) <= r) eScore += 1;
      }
      for (const ev of this.manager.vehicles?.live ?? []) {
        if (ev.alive && Math.hypot(ev.position.x - c.x, ev.position.z) <= r) eScore += 2.5;
      }

      if (fScore > eScore + 1.5) {
        this.bridges[c.id] = 'friendly';
        friendlyBridges++;
      } else if (eScore > fScore + 1.5) {
        this.bridges[c.id] = 'enemy';
        enemyBridges++;
      } else {
        this.bridges[c.id] = 'contested';
      }
    }

    // Count friendly presence deep in North Defense Belt (z < -70) & enemy breaches south (z > 180)
    let deepFriendlies = (playerPos && playerPos.z < -70) ? 3 : 0;
    for (const a of allies) if (a.alive && a.body.position.z < -70) deepFriendlies++;
    let southEnemies = this.fob.breachedCount;
    for (const e of enemies) if (e.alive && e.position.z > 160) southEnemies++;

    let stage = 2;
    if (this.fob.breachedCount >= 3 || southEnemies >= 10) {
      stage = 0;
    } else if (enemyBridges >= 2 && southEnemies >= 4) {
      stage = 1;
    } else if (friendlyBridges >= 2 && deepFriendlies >= 5 && this.facilities.destroyedCount >= 2) {
      stage = 4;
    } else if (friendlyBridges >= 2 || deepFriendlies >= 4) {
      stage = 3;
    }

    this.frontlineStage = stage;
    if (stage > this.deepestStage) this.deepestStage = stage;
  }

  // ---- Autonomous Friendly Army Spawners ------------------------------------

  private updateFriendlySpawners(dt: number): void {
    const heldBridges = LANES.filter(l => this.bridges[l] === 'friendly').length;
    let tempo = 1.0;
    if (heldBridges >= 2) tempo += 0.15;
    if (this.momentumLeft > 0) tempo += 0.60;
    if (this.mobilizeLeft > 0) tempo *= 2.0;

    // 1. Autonomous Friendly Infantry Squads
    this.friendlyInfTimer -= dt * tempo;
    if (this.friendlyInfTimer <= 0) {
      const aliveAllies = this.ctx.allies?.allies.filter(a => a.alive).length ?? 0;
      const cap = (this.momentumLeft > 0 || this.mobilizeLeft > 0) ? 22 : 16;
      if (aliveAllies < cap) {
        const lane = this.nextLane();
        const count = Math.min(4, cap - aliveAllies);
        this.spawnFriendlySquad(lane, count);
      }
      this.friendlyInfTimer = 9.5;
    }

    // 2. Autonomous Friendly AI Armor (Jackals, Bastions, Aegis MBTs)
    this.friendlyArmorTimer -= dt * tempo;
    if (this.friendlyArmorTimer <= 0) {
      const liveGround = this.allyFleet.getLiveGroundTargets().length;
      const armorCap = this.mobilizeLeft > 0 ? 7 : 4;
      if (liveGround < armorCap) {
        const lane = this.nextLane();
        const roll = Math.random();
        const kind = roll < 0.42 ? 'aegis' : (roll < 0.78 ? 'bastion' : 'jackal');
        this.spawnFriendlyArmor(lane, kind);
      }
      this.friendlyArmorTimer = 26.0;
    }
  }

  private spawnFriendlySquad(lane: WarLaneId, count: number): void {
    const allies = this.ctx.allies;
    if (!allies) return;
    const spawns = ENDLESS_WAR_FRIENDLY_SPAWNS[lane];
    const rallyZ = ENDLESS_WAR_RALLY_Z[this.frontlineStage] ?? 42;
    const crossing = ENDLESS_WAR_CROSSINGS.find(c => c.id === lane)!;
    const types: readonly AllyType[] = ['rifleman', 'rifleman', 'gunner', 'rocketeer', 'riot', 'medic'];

    for (let i = 0; i < count; i++) {
      const sp = spawns[i % spawns.length]!;
      const at = new THREE.Vector3(sp[0] + rand(-4, 4), sp[1], sp[2] + rand(-4, 4));
      const post = new THREE.Vector3(crossing.x + rand(-18, 18), 0, rallyZ + rand(-14, 14));
      const type = types[Math.floor(Math.random() * types.length)]!;
      const ally = allies.spawn(type, at, post, 22, Math.PI);
      if (ally) {
        ally.expendable = true;
        ally.detached = true;
      }
    }
  }

  private spawnFriendlyArmor(lane: WarLaneId, kind: 'aegis' | 'bastion' | 'jackal'): void {
    const pts = ENDLESS_WAR_FRIENDLY_LANES[lane];
    const spawnPt = pts[0]!;
    this.allyFleet.spawnGround({
      kind,
      laneId: `ew_ally_${lane}`,
      spawn: [spawnPt[0] + rand(-3, 3), 0, spawnPt[1]],
      waypoints: pts.slice(1).map(p => [p[0], 0, p[1]] as const),
    });
  }

  // ---- Escalating Enemy Army Spawners ---------------------------------------

  private updateEnemySpawners(dt: number): void {
    const caps = endlessWarEnemyCaps(this.threatLevel);
    const fuelUp = this.facilities.isAlive('fuel_depot');
    const motorUp = this.facilities.isAlive('motor_pool');
    const airUp = this.facilities.isAlive('airfield_tower');
    const radarUp = this.facilities.isAlive('radar_aa');

    const cadenceMult = fuelUp ? 1.0 : 0.75;

    // 1. Enemy Saltblood Infantry Warbands
    this.enemyInfTimer -= dt * cadenceMult;
    if (this.enemyInfTimer <= 0) {
      const alive = this.manager.alive.length;
      if (alive < caps.infantryCap) {
        const lane = this.nextLane();
        const squadSize = Math.min(5, caps.infantryCap - alive);
        this.spawnEnemySquad(lane, squadSize);
      }
      this.enemyInfTimer = caps.infantryInterval;
    }

    // 2. Enemy Armor & Convoys (halted while Iron Bastion Motor Pool is destroyed!)
    if (motorUp) {
      this.enemyArmorTimer -= dt * cadenceMult;
      if (this.enemyArmorTimer <= 0) {
        const liveGround = this.countEnemyGroundVehicles();
        if (liveGround < caps.groundVehCap) {
          const lane = this.nextLane();
          const tankChance = clamp(0.18 + (this.threatLevel - 1) * 0.10, 0.18, 0.72);
          const roll = Math.random();
          const kind = roll < tankChance ? 'tank' : (roll < tankChance + 0.35 ? 'truck' : 'humvee');
          this.spawnEnemyArmor(lane, kind);
        }
        this.enemyArmorTimer = caps.armorInterval;
      }
    }

    // 3. Enemy Fast-Rope Choppers, Gunships & Paratroopers (grounded while Airfield Tower is destroyed!)
    if (airUp) {
      this.enemyAirTimer -= dt * cadenceMult;
      if (this.enemyAirTimer <= 0) {
        this.spawnEnemyChopperOrDrop(caps.chopperCap);
        this.enemyAirTimer = caps.airInterval;
      }

      // 4. Enemy Combat Jets (Threat 4+; doubled delay while Radar & AA Net is destroyed!)
      if (caps.jetCap > 0) {
        const jetRate = radarUp ? 1.0 : 0.5;
        this.enemyJetTimer -= dt * jetRate;
        if (this.enemyJetTimer <= 0) {
          if (this.airWing.enemies.length < caps.jetCap) {
            this.spawnEnemyJet();
          }
          this.enemyJetTimer = Math.max(18, 52 - this.threatLevel * 2.5);
        }
      }
    }

    // 5. Heavy Bosses (Juggernauts at Threat 3+, Titans at Threat 5+)
    if (this.threatLevel >= 3) {
      this.enemyBossTimer -= dt * cadenceMult;
      if (this.enemyBossTimer <= 0) {
        if (this.manager.alive.length < 44) {
          const lane = this.nextLane();
          const sp = ENDLESS_WAR_ENEMY_SPAWNS[lane][0]!;
          const isTitan = this.threatLevel >= 5 && Math.random() < clamp(0.32 + (this.threatLevel - 5) * 0.08, 0.32, 0.75);
          const id: EnemyId = isTitan ? 'titan' : 'juggernaut';
          this.manager.spawn(id, new THREE.Vector3(sp[0], 0, sp[2]));
          this.ctx.hud?.feed?.(
            isTitan ? `HOSTILE TITAN ADVANCING ON ${lane.toUpperCase()} LANE` : `HOSTILE JUGGERNAUT DEPLOYED ON ${lane.toUpperCase()} LANE`,
            '#ff4b3e',
          );
        }
        this.enemyBossTimer = caps.bossInterval;
      }
    }
  }

  private spawnEnemySquad(lane: WarLaneId, count: number): void {
    const spawns = ENDLESS_WAR_ENEMY_SPAWNS[lane];
    const pool: EnemyId[] = this.threatLevel >= 4
      ? ['trooper', 'gunner', 'stalker', 'brute', 'rocketeer', 'sniper', 'riot']
      : ['trooper', 'trooper', 'gunner', 'stalker', 'riot'];
    const ids: EnemyId[] = [];
    for (let i = 0; i < count; i++) {
      ids.push(pool[Math.floor(Math.random() * pool.length)]!);
    }
    const base = spawns[Math.floor(Math.random() * spawns.length)]!;
    const squad = this.o.muster(ids.length, new THREE.Vector3(base[0], 0, base[2]));
    for (let i = 0; i < ids.length; i++) {
      this.o.enlistInto(squad, ids[i]!, new THREE.Vector3(base[0] + rand(-4, 4), 0, base[2] + rand(-4, 4)));
    }
  }

  private spawnEnemyArmor(lane: WarLaneId, kind: 'humvee' | 'truck' | 'tank'): void {
    const vehicles = this.manager.vehicles;
    if (!vehicles) return;
    const pts = ENDLESS_WAR_ENEMY_LANES[lane];
    const start = pts[0]!;
    const route = pts.slice(1).map(([x, z]) => ({ x, z, hold: 0 }));
    const crew: EnemyId[] = kind === 'truck' ? ['trooper', 'trooper', 'gunner', 'stalker'] : (kind === 'humvee' ? ['trooper', 'stalker'] : []);
    vehicles.spawnGround(kind, {
      x: start[0] + rand(-2, 2),
      y: 0,
      z: start[1],
      route,
      tag: `ew_enemy_${kind}`,
      crew,
      crewTag: null,
      holds: false,
      holdYaw: NaN,
      parked: false,
      maxHostile: 38,
      waveQueued: false,
    });
  }

  private spawnEnemyChopperOrDrop(chopperCap: number): void {
    const vehicles = this.manager.vehicles;
    if (!vehicles) return;
    const lz = ENDLESS_WAR_CHOPPER_LZS[Math.floor(Math.random() * ENDLESS_WAR_CHOPPER_LZS.length)]!;
    const sky = ENDLESS_WAR_SKY_SPAWNS[Math.floor(Math.random() * 3)]!;

    // Threat 5+: occasional paratrooper drop over the river / south trench belt
    if (this.threatLevel >= 5 && Math.random() < 0.35) {
      const zone: DropZone = {
        x: lz.pos[0],
        y: 0,
        z: lz.pos[2],
        radius: 16,
      };
      this.paratroopers.launchDrop(zone, ['stalker', 'gunner', 'trooper', 'brute']);
      this.ctx.hud?.feed?.('HOSTILE PARATROOPERS DROPPING OVER THE FRONT', '#ff8c42');
      return;
    }

    const activeChoppers = vehicles.live.filter(v => v.alive && v.def.kind === 'chopper').length;
    if (chopperCap > 0 && activeChoppers < chopperCap && Math.random() < 0.55) {
      const marks = ENDLESS_WAR_CROSSINGS.map(c => new THREE.Vector3(c.x, 26, c.capturePos[2] + rand(-40, 40)));
      vehicles.spawnChopper(new THREE.Vector3(sky[0], 54, sky[2]), marks, 'ew_enemy_chopper');
      this.ctx.hud?.feed?.('ENEMY ATTACK HELICOPTER ON STATION', '#ff6448');
    } else {
      vehicles.spawnTransport(
        new THREE.Vector3(sky[0], 42, sky[2]),
        new THREE.Vector3(lz.pos[0], 0, lz.pos[2]),
        14,
        ['trooper', 'gunner', 'stalker', 'trooper'],
        'ew_enemy_transport',
      );
    }
  }

  private spawnEnemyJet(): void {
    const sky = ENDLESS_WAR_SKY_SPAWNS[Math.floor(Math.random() * 5)]!;
    const roster: AiJetKind[] = this.threatLevel >= 7
      ? ['hornet', 'warthog', 'raptor', 'harrier']
      : ['hornet', 'harrier', 'warthog'];
    const kind = roster[Math.floor(Math.random() * roster.length)]!;
    const skill = clamp(0.45 + (this.threatLevel - 4) * 0.08, 0.45, 0.98);
    this.airWing.spawnEnemy(kind, new THREE.Vector3(sky[0], sky[1], sky[2]), 0, skill, {
      label: `BANDIT ${kind.toUpperCase()}`,
    });
    this.ctx.hud?.feed?.(`HOSTILE ${kind.toUpperCase()} ENTERING AIRSPACE`, '#ff4c3b');
  }

  private spawnAllBaseDefenses(): void {
    for (const def of ENDLESS_WAR_ENEMY_DEFENSES) {
      this.baseDefense.addSite({
        id: def.id,
        kind: def.kind,
        position: def.position,
        yaw: def.yaw,
      });
    }
  }

  // ---- Strategic Facility Events & Momentum Surges --------------------------

  private onFacilityDestroyed(plan: StrategicFacilityPlan): void {
    if (plan.sector === 4) this.deepSabotageCount++;

    // Destroy linked BaseDefense emplacements immediately when Artillery or Radar/AA goes down
    if (plan.id === 'artillery_battery' || plan.id === 'radar_aa') {
      for (const def of ENDLESS_WAR_ENEMY_DEFENSES) {
        if (def.facilityId === plan.id) {
          this.baseDefense.applyBlast(new THREE.Vector3(...def.position), 14, 9999, 'facility_sabotage');
        }
      }
    }

    // Trigger 30-second MOMENTUM SURGE + immediate free breakthrough squad & tank!
    this.momentumLeft = Math.max(this.momentumLeft, ENDLESS_WAR_MOMENTUM_SEC);
    this.spawnFriendlySquad(plan.lane, 5);
    this.spawnFriendlyArmor(plan.lane, 'aegis');
    this.ctx.hud?.feed?.(`MOMENTUM SURGE! ALLIED BREAKTHROUGH LAUNCHING ON ${plan.lane.toUpperCase()} LANE`, '#ffe066');
  }

  private onFacilityRebuilt(plan: StrategicFacilityPlan): void {
    if (plan.id === 'artillery_battery' || plan.id === 'radar_aa') {
      for (const def of ENDLESS_WAR_ENEMY_DEFENSES) {
        if (def.facilityId === plan.id) {
          this.baseDefense.addSite({
            id: `${def.id}_r${Math.floor(this.elapsedSec)}`,
            kind: def.kind,
            position: def.position,
            yaw: def.yaw,
          });
        }
      }
    }
  }

  // ---- War Command Console Boosts -------------------------------------------

  getCredits(): number {
    const shop = this.ctx.contracts?.shop as { credits?: number } | null | undefined;
    return shop && typeof shop.credits === 'number' ? shop.credits : 0;
  }

  orderBoost(id: WarBoostId): boolean {
    const spec = WAR_BOOSTS.find(b => b.id === id);
    if (!spec) return false;
    if ((this.boostCooldowns.get(id) ?? 0) > 0) return false;

    const shop = this.ctx.contracts?.shop as { credits?: number } | null | undefined;
    const credits = this.getCredits();
    if (credits < spec.cost) return false;
    if (shop && typeof shop.credits === 'number') shop.credits -= spec.cost;

    this.boostCooldowns.set(id, spec.cooldown);
    this.boostsCalled++;

    if (id === 'spearhead') {
      // 3 friendly Aegis MBTs + 2 Bastion guntrucks rolling straight up Center Highway!
      for (let i = 0; i < 3; i++) {
        this.allyFleet.spawnGround({
          kind: 'aegis',
          laneId: 'ew_spearhead',
          spawn: [(i - 1) * 8, 0, 286 - i * 8],
          waypoints: ENDLESS_WAR_FRIENDLY_LANES.center.slice(1).map(p => [p[0] + (i - 1) * 4, 0, p[1]] as const),
          label: `SPEARHEAD MBT-${i + 1}`,
        });
      }
      for (const sx of [-12, 12]) {
        this.allyFleet.spawnGround({
          kind: 'bastion',
          laneId: 'ew_spearhead',
          spawn: [sx, 0, 294],
          waypoints: ENDLESS_WAR_FRIENDLY_LANES.center.slice(1).map(p => [p[0] + sx * 0.4, 0, p[1]] as const),
        });
      }
      this.ctx.hud?.feed?.('ARMORED SPEARHEAD DEPLOYED — 3 MBTs + 2 GUNTRUCKS ROLLING NORTH!', '#ffca58');
    } else if (id === 'airborne') {
      const rallyZ = ENDLESS_WAR_RALLY_Z[this.frontlineStage] ?? 0;
      const dropXs = [-46, 46];
      for (let i = 0; i < 2; i++) {
        const dx = dropXs[i]!;
        this.allyFleet.spawnValkyrie({
          approachFrom: [dx * 2, 48, 340],
          lzPos: [dx, 0, rallyZ - 18],
          egressTo: [dx * 3, 55, 360],
          squadCount: 5,
          squadTypes: ['rocketeer', 'gunner', 'riot', 'rifleman', 'medic'],
          postPos: [dx, 0, rallyZ - 32],
          expendable: true,
          detached: true,
        });
      }
      this.ctx.hud?.feed?.('AIRBORNE PLATOON INBOUND — 2 VALKYRIES DROPPING ON THE FRONT!', '#5ceeff');
    } else if (id === 'air_wing') {
      for (const sx of [-160, 160]) {
        this.airWing.spawnAlly('raptor', new THREE.Vector3(sx, 115, 580), Math.PI, 0.92, {
          label: sx < 0 ? 'VIPER-1' : 'VIPER-2',
        });
      }
      const rallyZ = ENDLESS_WAR_RALLY_Z[this.frontlineStage] ?? -40;
      this.allyFleet.spawnKestrel({
        spawn: [0, 56, 340],
        orbitCenter: [0, 0, rallyZ - 35],
        orbitRadius: 95,
        orbitAltitude: 44,
        label: 'KESTREL CAS-1',
      });
      this.ctx.hud?.feed?.('ALLIED FIGHTER & GUNSHIP WING SCRAMBLED!', '#5ceeff');
    } else if (id === 'artillery') {
      // 14 heavy 155 mm howitzer shells targeted on enemy clusters & North Bridgeheads
      const targets: THREE.Vector3[] = [];
      for (const e of this.manager.alive) {
        if (e.alive && e.position.z < 140) targets.push(e.position.clone());
      }
      for (const ev of this.manager.vehicles?.live ?? []) {
        if (ev.alive && ev.position.z < 140) targets.push(ev.position.clone());
      }
      for (let i = 0; i < 14; i++) {
        let pt: THREE.Vector3;
        if (targets.length > 0) {
          const pick = targets[i % targets.length]!;
          pt = new THREE.Vector3(pick.x + rand(-14, 14), 0, pick.z + rand(-14, 14));
        } else {
          const c = ENDLESS_WAR_CROSSINGS[i % ENDLESS_WAR_CROSSINGS.length]!;
          pt = new THREE.Vector3(c.x + rand(-28, 28), 0, -55 + rand(-35, 35));
        }
        this.pendingShells.push({ pos: pt, delay: 1.2 + i * 0.45 });
      }
      this.ctx.hud?.feed?.('ROLLING 155mm ARTILLERY BARRAGE INBOUND — CLEAR THE TARGET ZONE!', '#ff9848');
    } else if (id === 'mobilize') {
      this.mobilizeLeft = 60;
      for (const lane of LANES) this.spawnFriendlySquad(lane, 3);
      this.ctx.hud?.feed?.('TOTAL MOBILIZATION ACTIVE — 2x ALLIED SPAWN TEMPO (60s)!', '#ffe066');
    } else if (id === 'fob_overdrive') {
      this.fob.triggerOverdrive();
    }

    return true;
  }

  private updateArtilleryShells(dt: number): void {
    for (let i = this.pendingShells.length - 1; i >= 0; i--) {
      const sh = this.pendingShells[i]!;
      sh.delay -= dt;
      if (sh.delay > 0) continue;
      this.pendingShells.splice(i, 1);

      const baseSpec = EXPLOSIONS.howitzer;
      this.ctx.fx?.explosion?.(sh.pos, { radius: 16, kind: 'howitzer', scale: 1.4 });
      this.ctx.render?.lights?.flash?.(sh.pos, 0xff8b34, 24, 65, 0.35);
      this.ctx.audio?.play?.('explosion', { position: sh.pos, volume: 0.9 });

      // Damage enemy infantry, vehicles, base defenses, and strategic facilities in blast radius
      for (const e of this.manager.alive) {
        if (!e.alive) continue;
        const d = e.position.distanceTo(sh.pos);
        if (d <= 18) {
          this.ctx.enemies?.applyDamage?.(e, {
            amount: 460 * (1 - d / 22),
            type: 'explosive',
            point: e.position.clone(),
            dir: _v.subVectors(e.position, sh.pos).normalize(),
            force: 18,
            source: 'war_artillery',
          });
        }
      }
      this.manager.vehicles?.blast?.(sh.pos, {
        ...baseSpec,
        radius: 18,
        damage: 520,
        source: 'war_artillery',
        kind: 'howitzer',
        team: 'player',
      });
      this.facilities.applyBlast(sh.pos, 18, 420, 'war_artillery');
      this.baseDefense.applyBlast(sh.pos, 18, 520, 'war_artillery');
    }
  }

  // ---- FOB Loss Condition ---------------------------------------------------

  private onFobDestroyed(): void {
    if (this.fobLost) return;
    this.fobLost = true;
    this.redeployLeft = 0;
    this.warConsole.close();
    this.clearPrompt();

    const mins = Math.floor(this.elapsedSec / 60);
    const secs = Math.floor(this.elapsedSec % 60);
    const clock = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    const reason = `FOB VANGUARD OVERRUN · THREAT ${this.threatLevel} · ${clock} · ${this.facilities.destroyedCount} FACILITIES SABOTAGED`;

    this.ctx.hud?.feed?.(reason, '#ff3d33');
    // Force player death so Hud transitions cleanly to the End-of-War Game Over debrief
    const p = this.ctx.player as { alive: boolean; takeDamage: (d: unknown) => void } | undefined;
    if (p?.alive) {
      p.takeDamage({ amount: 999_999, from: this.fob.position, type: 'true', source: reason });
    } else {
      this.ctx.events?.emit?.('player:died', { source: reason });
    }
  }

  // ---- FOB War Command Console Prompt ---------------------------------------

  private updateWarConsolePrompt(): void {
    const p = this.ctx.player;
    const seats = (this.ctx as { seats?: { occupied?: boolean } }).seats;
    if (!p?.alive || seats?.occupied || this.warConsole.open || this.fobLost) {
      this.clearPrompt();
      return;
    }
    const dist = _v2.set(p.position.x, p.position.y, p.position.z).distanceTo(_consolePos);
    if (dist <= CONSOLE_INTERACT_RANGE) {
      if (!this.unprompt) {
        const key = this.ctx.input?.labelFor?.('interact') ?? 'E';
        this.unprompt = this.ctx.hud?.follow?.(_consolePos, `[${key}] WAR COMMAND CONSOLE (REINFORCEMENTS)`, '#ffbe4d') ?? null;
      }
      if (this.ctx.input?.pressed?.('interact')) {
        this.clearPrompt();
        this.warConsole.show();
      }
    } else {
      this.clearPrompt();
    }
  }

  private clearPrompt(): void {
    this.unprompt?.();
    this.unprompt = null;
  }

  private nextLane(): WarLaneId {
    const lane = LANES[this.laneCursor % LANES.length]!;
    this.laneCursor++;
    return lane;
  }

  private countEnemyGroundVehicles(): number {
    let n = 0;
    for (const v of this.manager.vehicles?.live ?? []) {
      if (v.alive && (v.def.kind === 'humvee' || v.def.kind === 'truck' || v.def.kind === 'tank')) n++;
    }
    return n;
  }

  dispose(): void {
    this.reset();
    for (const u of this.unsubs) u();
    this.unsubs.length = 0;
    if (this.keyListener && typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.keyListener);
      this.keyListener = null;
    }
  }
}
