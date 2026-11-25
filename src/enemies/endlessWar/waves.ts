/**
 * Endless War Master Frontline Director (`EndlessWarWaves`).
 *
 * Nonstop, zero-downtime combined-arms war across a 480 m x 720 m overcast mud front divided
 * by a wide river with 3 fortified bridges:
 *   - Two reactive army commanders (`WarTacticalCommander`) orchestrate concentrated Main Effort
 *     battlegroups, flank responses, emergency intruder defense inside base walls, frontline armor
 *     pacing, active infantry marching, and threat-prioritized CAS air strikes.
 *   - Destructible Iron Bastion Blast Gates (`BastionDefenseSystem`) seal the northern enemy fortress
 *     against player & friendly armor rush while allowing enemy armor/reinforcements out cleanly.
 *   - Uncapped Threat Escalation (`THREAT 1 -> ∞`) continuously ramps high-density enemy infantry
 *     (including AT rocketeers from Threat 1), humvees, troop trucks, tanks, attack choppers,
 *     hostile combat jets (`CrossfireAirWing`), SAM/Flak/Mortar emplacements, paratroopers,
 *     Juggernauts, and Titans until inevitable defeat.
 *   - Sabotaging 5 Enemy Strategic Facilities (`StrategicFacilitySystem`) cripples enemy capabilities,
 *     pays large credit bounties, and fires 30-second Momentum Surges.
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
  ENDLESS_WAR_BASTION_GATES,
  ENDLESS_WAR_CHOPPER_LZS,
  ENDLESS_WAR_CROSSINGS,
  ENDLESS_WAR_ENEMY_DEFENSES,
  ENDLESS_WAR_ENEMY_LANES,
  ENDLESS_WAR_ENEMY_SALLY_SPAWNS,
  ENDLESS_WAR_ENEMY_SPAWNS,
  ENDLESS_WAR_FACILITIES,
  ENDLESS_WAR_FOB_CORE,
  ENDLESS_WAR_FRIENDLY_LANES,
  ENDLESS_WAR_FRIENDLY_SPAWNS,
  ENDLESS_WAR_OPENING_ENEMY_STAGING,
  ENDLESS_WAR_OPENING_FRIENDLY_STAGING,
  ENDLESS_WAR_PLAYER_SPAWN,
  ENDLESS_WAR_PLAYER_YAW,
  ENDLESS_WAR_PROCUREMENT_POD,
  ENDLESS_WAR_RALLY_Z,
  ENDLESS_WAR_SKY_SPAWNS,
  ENDLESS_WAR_WAR_CONSOLE,
  type BastionGatePlan,
  type StrategicFacilityPlan,
  type Vec3,
  type WarLaneId,
} from '../../world/map/endlessWar/plan';
import type { AiJetKind, AiJetTheater } from '../dogfight/aiJet';
import type { EnemyManager } from '../EnemyManager';
import type { Outpost } from '../outpost';
import { ParatrooperSystem, type DropZone } from '../rooftop/paratroopers';
import { BastionDefenseSystem } from './bastionDefense';
import { StrategicFacilitySystem } from './facilities';
import { FobDefenseSystem } from './fobDefense';
import { EndlessWarHud, type BridgeOwner } from './hudOverlay';
import { WarTacticalCommander } from './tacticalAi';
import { WAR_BOOSTS, WarCommandUi, type WarBoostId } from './warConsoleUi';

export const ENDLESS_WAR_THREAT_STEP_SEC = 95;
export const ENDLESS_WAR_REDEPLOY_SEC = 4.0;
export const ENDLESS_WAR_MOMENTUM_SEC = 30.0;

const LANES: readonly WarLaneId[] = ['west', 'center', 'east'];
const CONSOLE_INTERACT_RANGE = 5.4;

/** Pure uncapped Threat Level calculation from elapsed seconds + deep fortress pressure. */
export function endlessWarThreatLevel(elapsedSec: number, deepSabotageCount = 0): { level: number; progress: number } {
  const effective = Math.max(0, elapsedSec) + Math.max(0, deepSabotageCount) * 28;
  const raw = effective / ENDLESS_WAR_THREAT_STEP_SEC;
  const level = 1 + Math.floor(raw);
  const progress = raw - Math.floor(raw);
  return { level, progress };
}

/** High-density enemy active force caps scaling with Threat Level (safely under Endless War's 68-entity cap). */
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
    infantryCap: Math.min(62, 38 + (t - 1) * 3),
    groundVehCap: Math.min(14, 6 + Math.floor(t * 0.9)),
    chopperCap: t < 2 ? 0 : Math.min(3, 1 + Math.floor((t - 2) / 3)),
    jetCap: t < 4 ? 0 : Math.min(4, 1 + Math.floor((t - 4) / 2)),
    infantryInterval: Math.max(1.8, 5.2 - (t - 1) * 0.4),
    armorInterval: Math.max(6.5, 16.5 - (t - 1) * 1.1),
    airInterval: Math.max(15, 38 - (t - 1) * 2.2),
    bossInterval: Math.max(22, 64 - (t - 1) * 3.8),
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
  readonly bastion: BastionDefenseSystem;
  readonly commander: WarTacticalCommander;
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
  private friendlyArmorTimer = 8.0;
  private enemyInfTimer = 1.8;
  private enemyArmorTimer = 9.0;
  private enemyAirTimer = 24.0;
  private enemyJetTimer = 38.0;
  private enemyBossTimer = 48.0;
  private frontlineTimer = 0.45;
  private unprompt: (() => void) | null = null;
  private keyListener: ((e: KeyboardEvent) => void) | null = null;
  private readonly unsubs: (() => void)[] = [];

  constructor(
    private readonly ctx: Ctx,
    private readonly o: Outpost,
    private readonly manager: EnemyManager,
  ) {
    this.commander = new WarTacticalCommander();
    this.facilities = new StrategicFacilitySystem(ctx, {
      onDestroyed: plan => this.onFacilityDestroyed(plan),
      onRebuilt: plan => this.onFacilityRebuilt(plan),
    });
    this.fob = new FobDefenseSystem(ctx, () => this.onFobDestroyed());
    this.bastion = new BastionDefenseSystem(ctx, {
      onGateBreached: plan => this.onBastionGateBreached(plan),
      onGateRebuilt: plan => this.onBastionGateRebuilt(plan),
    });
    this.allyFleet = new AiVehicleFleet(ctx);

    const theater: AiJetTheater = {
      minAlt: 36,
      maxAlt: 330,
      turnRadius: 920,
      groundY: 0,
      dynamicGroundTarget: true,
      resolveGroundStrikeTarget: jet => this.commander.pickEnemyAirStrikeTarget(
        jet,
        this.allyFleet.units,
        this.ctx.player?.alive ? this.ctx.player.position : null,
        this.threatLevel,
      ),
    };
    this.airWing = new CrossfireAirWing(ctx, {
      onEnemyKilled: jet => {
        const shop = this.ctx.contracts?.shop as { credits?: number } | null | undefined;
        if (shop && typeof shop.credits === 'number') shop.credits += 350;
        this.ctx.progression?.award?.(350, `${jet.profile.name} SHOT DOWN`, jet.position);
      },
      onGroundStrike: (from, hitPoint, damage, attackerName, heavyBomb) => {
        this.resolveEnemyAirStrike(from, hitPoint, damage, attackerName, heavyBomb);
      },
    }, theater);
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
    this.bastion.init();
    this.hudOverlay.mount();

    // Seal all 3 Iron Bastion Blast Gates in AiVehicleFleet until blasted open!
    for (const g of ENDLESS_WAR_BASTION_GATES) {
      this.allyFleet.setGateOpen(g.id, false);
    }
    this.allyFleet.setSiegeTargets(() => this.bastion.getSiegeTargets());

    // Wire Friendly FOB Core + AiVehicleFleet into VehicleSystem so enemy tanks & choppers fight our armor & base!
    const vehicles = this.manager.vehicles;
    if (vehicles) {
      vehicles.registerFriendlyTarget(this.fob);
      vehicles.setFriendlyVehicles(() => this.allyFleet.getLiveGroundTargets());
    }

    // Wire enemy AT Rocketeers & breaching infantry -> friendly tanks & FOB Vanguard Core!
    if (this.ctx.allies) {
      this.ctx.allies.extraFoeProvider = s => this.commander.resolveExtraFoe(s, this.allyFleet.units, this.fob);
    }

    // Spawn all Sector 3 & Sector 4 enemy SAM, Flak, Radar, and Mortar emplacements
    this.spawnAllBaseDefenses();

    // Seed an intense, realistic opening warfront across all 3 lanes (staged forward near the bridges & trenches)!
    for (const lane of LANES) {
      const fSpots = ENDLESS_WAR_OPENING_FRIENDLY_STAGING[lane];
      for (const spot of fSpots) {
        this.spawnFriendlySquad(lane, 3, spot);
      }
      const eSpots = ENDLESS_WAR_OPENING_ENEMY_STAGING[lane];
      for (const spot of eSpots) {
        this.spawnEnemySquad(lane, 4, 'assault', spot);
      }
    }

    // Opening combined-arms armor columns: friendly tanks hold with infantry & respect sealed Blast Gates!
    this.spawnFriendlyArmor('center', 'aegis', 68);
    this.spawnFriendlyArmor('west', 'bastion', 74);
    this.spawnFriendlyArmor('east', 'aegis', 74);

    // Opening enemy mechanized assault: tanks, humvees, and frontline troop trucks!
    this.spawnEnemyArmor('center', 'tank');
    this.spawnEnemyArmor('west', 'humvee');
    this.spawnEnemyArmor('east', 'truck');
    this.spawnEnemyArmor('center', 'truck');
    this.spawnEnemyArmor('west', 'tank');

    this.ctx.hud?.feed?.('ENDLESS WAR — HOLD THE BRIDGES, BREACH IRON BASTION GATES & SABOTAGE FACILITIES', '#6beeff');
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

    this.friendlyInfTimer = 2.0;
    this.friendlyArmorTimer = 10.0;
    this.enemyInfTimer = 2.0;
    this.enemyArmorTimer = 9.5;
    this.enemyAirTimer = 24.0;
    this.enemyJetTimer = 38.0;
    this.enemyBossTimer = 48.0;
    this.frontlineTimer = 0.45;

    if (this.ctx.allies) {
      this.ctx.allies.extraFoeProvider = null;
    }
    this.allyFleet.setSiegeTargets(null);

    this.warConsole.close();
    this.clearPrompt();
    this.commander.reset();
    this.facilities.dispose();
    this.fob.dispose();
    this.bastion.dispose();
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
    const friendlyInf = this.ctx.allies?.allies ?? [];
    this.fob.update(dt, this.manager.alive, enemyVehicles, this.airWing.enemies);
    this.bastion.update(dt, this.threatLevel, this.allyFleet.units, friendlyInf, this.airWing.allies);

    // Update enemy SAM/Flak/Radar/Mortar emplacements
    this.baseDefense.update(dt, {
      alliedJets: this.airWing.allies,
      friendlyGroundTargets: [...this.allyFleet.getLiveGroundTargets(), this.fob],
    });

    // 5. Two-Army Tactical Evaluation, Frontline Bridge Control & Active Orders
    this.frontlineTimer -= dt;
    if (this.frontlineTimer <= 0) {
      this.frontlineTimer = 0.55;
      const playerPos = this.ctx.player?.alive ? this.ctx.player.position : null;
      this.commander.evaluate(
        0.55,
        friendlyInf,
        this.allyFleet.units,
        this.manager.alive,
        enemyVehicles,
        playerPos,
        this.bastion,
      );
      this.evaluateFrontline();

      // Emergency Iron Bastion QRF dispatch when player/friendly tanks breach inside enemy walls!
      if (!this.fobLost && this.commander.shouldTriggerBastionQrf()) {
        const sit = this.commander.getSituation();
        const qrfLane = sit.bastionBreachLane ?? 'center';
        this.spawnEnemySquad(qrfLane, 5, 'qrf');
        if (this.facilities.isAlive('motor_pool')) {
          this.spawnEnemyArmor(qrfLane, 'tank');
        }
        this.ctx.hud?.feed?.(`IRON BASTION INTRUSION — ENEMY ANTI-ARMOR QRF SCRAMBLED ON ${qrfLane.toUpperCase()}!`, '#ff523e');
      }
    }

    const nowSec = (this.o as { w?: { now?: number } })?.w?.now ?? this.elapsedSec;
    this.commander.issueOrders(dt, nowSec, friendlyInf, this.allyFleet, this.bastion);

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
      gates: this.bastion.getGateSnapshots(),
      facilities: this.facilities.getSnapshots(),
      fobHpFrac: this.fob.hpFrac,
      fobUnderAttack: this.fob.underAttackTimer > 0,
      fobBreached: this.fob.breachedCount > 0,
      momentumLeft: this.momentumLeft,
      mobilizeLeft: this.mobilizeLeft,
      credits: this.getCredits(),
      redeployLeft: this.redeployLeft,
      tacticalAlert: this.commander.getTacticalAlert(),
    });
  }

  // ---- Enemy CAS Air Strike Ground Resolution -------------------------------

  private resolveEnemyAirStrike(
    _from: THREE.Vector3,
    hitPoint: THREE.Vector3,
    damage: number,
    attackerName: string,
    heavyBomb: boolean,
  ): void {
    const radius = heavyBomb ? 18 : 11;
    const scale = heavyBomb ? 1.55 : 1.05;
    const at = _v.set(hitPoint.x, 0.4, hitPoint.z);

    this.ctx.fx?.explosion?.(at, { radius, kind: heavyBomb ? 'thermobaric' : 'rocket', scale });
    this.ctx.render?.lights?.flash?.(at, 0xff7426, 22, 60, 0.35);
    this.ctx.audio?.play?.('explosion', { position: at, volume: heavyBomb ? 0.88 : 0.68 });

    // 1. Damage friendly AI armor in blast radius
    this.allyFleet.applyEnemyBlast(at, radius, damage * (heavyBomb ? 3.2 : 2.1), attackerName);

    // 2. Damage friendly infantry in blast radius
    for (const a of this.ctx.allies?.allies ?? []) {
      if (!a.alive) continue;
      const d = a.body.position.distanceTo(at);
      if (d <= radius) {
        const fall = clamp(1 - d / (radius + 2), 0.3, 1);
        a.shotAt?.(at, damage * 0.9 * fall, 0.1, attackerName);
      }
    }

    // 3. Damage Friendly FOB Vanguard Core if strike lands near the inner plaza
    const fobDist = Math.hypot(at.x - this.fob.position.x, at.z - this.fob.position.z);
    if (fobDist <= radius + 14) {
      this.fob.takeDamage(damage * (heavyBomb ? 4.0 : 2.4), at, attackerName);
    }

    // 4. Splash player if caught in blast radius
    const p = this.ctx.player as { alive?: boolean; position?: THREE.Vector3; takeDamage?: (d: unknown) => void } | undefined;
    if (p?.alive && p.position) {
      const pd = p.position.distanceTo(at);
      if (pd <= radius) {
        const fall = clamp(1 - pd / (radius + 2), 0.25, 1);
        p.takeDamage?.({
          amount: Math.round(damage * 0.45 * fall),
          from: at,
          type: 'explosive',
          source: attackerName,
        });
      }
    }
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

    let deepFriendlies = (playerPos && playerPos.z < -70) ? 3 : 0;
    for (const a of allies) if (a.alive && a.body.position.z < -70) deepFriendlies++;
    let southEnemies = this.fob.breachedCount;
    for (const e of enemies) if (e.alive && e.position.z > 160) southEnemies++;

    let stage = 2;
    if (this.fob.breachedCount >= 3 || southEnemies >= 10) {
      stage = 0;
    } else if (enemyBridges >= 2 && southEnemies >= 4) {
      stage = 1;
    } else if (friendlyBridges >= 2 && deepFriendlies >= 5 && (this.bastion.breachedCount > 0 || this.facilities.destroyedCount >= 2)) {
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

    // 1. Autonomous Friendly Infantry Squads (concentrated on Allied Commander's Main Effort lane!)
    this.friendlyInfTimer -= dt * tempo;
    if (this.friendlyInfTimer <= 0) {
      const aliveAllies = this.ctx.allies?.allies.filter(a => a.alive).length ?? 0;
      const cap = (this.momentumLeft > 0 || this.mobilizeLeft > 0) ? 32 : 24;
      if (aliveAllies < cap) {
        const lane = this.commander.pickFriendlySpawnLane();
        const count = Math.min(5, cap - aliveAllies);
        this.spawnFriendlySquad(lane, count);
      }
      this.friendlyInfTimer = 5.8;
    }

    // 2. Autonomous Friendly AI Armor (Jackals, Bastions, Aegis MBTs)
    this.friendlyArmorTimer -= dt * tempo;
    if (this.friendlyArmorTimer <= 0) {
      const liveGround = this.allyFleet.getLiveGroundTargets().length;
      const armorCap = this.mobilizeLeft > 0 ? 8 : 5;
      if (liveGround < armorCap) {
        const lane = this.commander.pickFriendlySpawnLane();
        const roll = Math.random();
        const kind = roll < 0.45 ? 'aegis' : (roll < 0.80 ? 'bastion' : 'jackal');
        this.spawnFriendlyArmor(lane, kind);
      }
      this.friendlyArmorTimer = 18.5;
    }
  }

  private spawnFriendlySquad(lane: WarLaneId, count: number, spawnOverride?: Vec3): void {
    const allies = this.ctx.allies;
    if (!allies) return;
    const spawns = ENDLESS_WAR_FRIENDLY_SPAWNS[lane];
    const intel = this.commander.getSituation().lanes[lane];
    const gateSealed = this.bastion.isGateSealed(lane);
    const minZ = gateSealed ? -230 : -295;
    const rallyZ = clamp(intel ? intel.contactZ - 16 : (ENDLESS_WAR_RALLY_Z[this.frontlineStage] ?? 42), minZ, 232);
    const crossing = ENDLESS_WAR_CROSSINGS.find(c => c.id === lane)!;
    const types: readonly AllyType[] = ['rifleman', 'rifleman', 'gunner', 'rocketeer', 'riot', 'medic'];

    for (let i = 0; i < count; i++) {
      const sp = spawnOverride ?? spawns[i % spawns.length]!;
      const at = new THREE.Vector3(sp[0] + rand(-5, 5), sp[1], sp[2] + rand(-5, 5));
      const post = new THREE.Vector3(crossing.x + rand(-16, 16), 0, rallyZ + rand(-12, 12));
      const type = types[Math.floor(Math.random() * types.length)]!;
      const ally = allies.spawn(type, at, post, 22, Math.PI);
      if (ally) {
        ally.expendable = true;
        ally.detached = true;
      }
    }
  }

  private spawnFriendlyArmor(lane: WarLaneId, kind: 'aegis' | 'bastion' | 'jackal', initialHoldZ?: number): void {
    const pts = ENDLESS_WAR_FRIENDLY_LANES[lane];
    const spawnPt = pts[0]!;
    const wps = pts.slice(1);
    const gatePlan = ENDLESS_WAR_BASTION_GATES.find(g => g.lane === lane);
    // Waypoint `wps.length - 2` is `[laneX, -242]` right outside the Iron Bastion Blast Gate (`z = -258`)!
    const gateIdx = Math.max(0, wps.length - 2);

    const unit = this.allyFleet.spawnGround({
      kind,
      laneId: `ew_ally_${lane}`,
      spawn: [spawnPt[0] + rand(-3, 3), 0, spawnPt[1]],
      waypoints: wps.map(p => [p[0], 0, p[1]] as const),
      gateWaypoints: gatePlan ? { [gateIdx]: gatePlan.id } : undefined,
    });
    unit.combatHold = true;
    const intel = this.commander.getSituation().lanes[lane];
    const gateSealed = this.bastion.isGateSealed(lane);
    unit.holdNorthZ = initialHoldZ ?? clamp((intel?.friendlyFrontZ ?? 90) - 28, gateSealed ? -236 : -300, 180);
  }

  // ---- Escalating Enemy Army Spawners ---------------------------------------

  private updateEnemySpawners(dt: number): void {
    const caps = endlessWarEnemyCaps(this.threatLevel);
    const fuelUp = this.facilities.isAlive('fuel_depot');
    const motorUp = this.facilities.isAlive('motor_pool');
    const airUp = this.facilities.isAlive('airfield_tower');
    const radarUp = this.facilities.isAlive('radar_aa');

    const cadenceMult = fuelUp ? 1.0 : 0.75;

    // 1. High-Density Enemy Saltblood Infantry Warbands (with AT Rocketeers from Threat 1!)
    this.enemyInfTimer -= dt * cadenceMult;
    if (this.enemyInfTimer <= 0) {
      const alive = this.manager.alive.length;
      if (alive < caps.infantryCap) {
        const lane = this.commander.pickEnemySpawnLane();
        const squadSize = Math.min(6, caps.infantryCap - alive);
        this.spawnEnemySquad(lane, squadSize, 'assault');
      }
      this.enemyInfTimer = caps.infantryInterval;
    }

    // 2. Enemy Armor & Mechanized Convoys (halted while Iron Bastion Motor Pool is destroyed!)
    if (motorUp) {
      this.enemyArmorTimer -= dt * cadenceMult;
      if (this.enemyArmorTimer <= 0) {
        const liveGround = this.countEnemyGroundVehicles();
        if (liveGround < caps.groundVehCap) {
          const lane = this.commander.pickEnemySpawnLane();
          const tankChance = clamp(0.26 + (this.threatLevel - 1) * 0.08, 0.26, 0.65);
          const roll = Math.random();
          const kind = roll < tankChance ? 'tank' : (roll < tankChance + 0.36 ? 'truck' : 'humvee');
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
          this.enemyJetTimer = Math.max(16, 48 - this.threatLevel * 2.5);
        }
      }
    }

    // 5. Heavy Bosses (Juggernauts at Threat 3+, Titans at Threat 5+)
    if (this.threatLevel >= 3) {
      this.enemyBossTimer -= dt * cadenceMult;
      if (this.enemyBossTimer <= 0) {
        if (this.manager.alive.length < 62) {
          const lane = this.commander.pickEnemySpawnLane();
          const sealed = this.bastion.isGateSealed(lane);
          const sp = sealed ? ENDLESS_WAR_ENEMY_SALLY_SPAWNS[lane][0]! : ENDLESS_WAR_ENEMY_SPAWNS[lane][0]!;
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

  private spawnEnemySquad(
    lane: WarLaneId,
    count: number,
    role: 'assault' | 'qrf' = 'assault',
    spawnOverride?: Vec3,
  ): void {
    const sealed = this.bastion.isGateSealed(lane);
    // Exterior sally ports when gate is sealed for outward assault squads; interior spawns for Bastion QRF!
    const spawns = (role === 'qrf' || !sealed)
      ? ENDLESS_WAR_ENEMY_SPAWNS[lane]
      : ENDLESS_WAR_ENEMY_SALLY_SPAWNS[lane];
    const pool: EnemyId[] = this.threatLevel >= 4
      ? ['trooper', 'gunner', 'stalker', 'brute', 'rocketeer', 'sniper', 'riot']
      : ['trooper', 'trooper', 'gunner', 'stalker', 'riot', 'rocketeer'];

    const ids: EnemyId[] = [];
    // Guarantee anti-armor AT Rocketeers in every squad (2 in QRF squads, 1 in regular squads!)
    const guaranteedAt = role === 'qrf' ? Math.min(2, count) : (count >= 3 ? 1 : 0);
    for (let i = 0; i < guaranteedAt; i++) ids.push('rocketeer');
    while (ids.length < count) {
      ids.push(pool[Math.floor(Math.random() * pool.length)]!);
    }

    const base = spawnOverride ?? spawns[Math.floor(Math.random() * spawns.length)]!;
    const squad = this.o.muster(ids.length, new THREE.Vector3(base[0], 0, base[2]));
    for (let i = 0; i < ids.length; i++) {
      this.o.enlistInto(squad, ids[i]!, new THREE.Vector3(base[0] + rand(-5, 5), 0, base[2] + rand(-5, 5)));
    }

    // Register squad with WarTacticalCommander & wake it up IMMEDIATELY via adopt() so it marches right away!
    this.commander.registerEnemySquad(squad, lane, role);
    const sit = this.commander.getSituation();
    const crossing = ENDLESS_WAR_CROSSINGS.find(c => c.id === lane)!;
    const initialGoal = (role === 'qrf' && sit.bastionBreachPos)
      ? sit.bastionBreachPos.clone()
      : new THREE.Vector3(crossing.x + rand(-10, 10), 0, Math.min(240, base[2] + 85));
    const nowSec = (this.o as { w?: { now?: number } })?.w?.now ?? Math.max(0.1, this.elapsedSec);
    squad.adopt?.(initialGoal, nowSec + 0.05);
  }

  private spawnEnemyArmor(lane: WarLaneId, kind: 'humvee' | 'truck' | 'tank'): void {
    const vehicles = this.manager.vehicles;
    if (!vehicles) return;
    const pts = ENDLESS_WAR_ENEMY_LANES[lane];
    const start = pts[0]!;
    const route = this.commander.buildEnemyVehicleRoute(lane, kind);
    const crew: EnemyId[] = kind === 'truck'
      ? ['trooper', 'gunner', 'rocketeer', 'stalker', 'trooper']
      : (kind === 'humvee' ? ['trooper', 'rocketeer'] : []);

    vehicles.spawnGround(kind, {
      x: start[0] + rand(-2.5, 2.5),
      y: 0,
      z: start[1],
      route,
      tag: `ew_enemy_${kind}`,
      crew,
      crewTag: null,
      holds: false,
      holdYaw: NaN,
      parked: false,
      maxHostile: 64,
      waveQueued: false,
    });
  }

  private spawnEnemyChopperOrDrop(chopperCap: number): void {
    const vehicles = this.manager.vehicles;
    if (!vehicles) return;
    // Bias drop LZ toward Enemy Commander's Main Effort lane!
    const mainLane = this.commander.enemyMainLane;
    const laneLzs = ENDLESS_WAR_CHOPPER_LZS.filter(z => z.lane === mainLane);
    const lzPool = laneLzs.length > 0 && Math.random() < 0.7 ? laneLzs : ENDLESS_WAR_CHOPPER_LZS;
    const lz = lzPool[Math.floor(Math.random() * lzPool.length)]!;
    const sky = ENDLESS_WAR_SKY_SPAWNS[Math.floor(Math.random() * 3)]!;

    // Threat 5+: occasional paratrooper drop over the river / south trench belt
    if (this.threatLevel >= 5 && Math.random() < 0.35) {
      const zone: DropZone = {
        x: lz.pos[0],
        y: 0,
        z: lz.pos[2],
        radius: 16,
      };
      this.paratroopers.launchDrop(zone, ['rocketeer', 'gunner', 'trooper', 'brute']);
      this.ctx.hud?.feed?.('HOSTILE PARATROOPERS DROPPING OVER THE FRONT', '#ff8c42');
      return;
    }

    const activeChoppers = vehicles.live.filter(v => v.alive && v.def.kind === 'chopper').length;
    if (chopperCap > 0 && activeChoppers < chopperCap && Math.random() < 0.58) {
      const marks = ENDLESS_WAR_CROSSINGS.map(c => new THREE.Vector3(c.x, 28, c.capturePos[2] + rand(-35, 35)));
      this.commander.registerChopperMarks(marks);
      vehicles.spawnChopper(new THREE.Vector3(sky[0], 54, sky[2]), marks, 'ew_enemy_chopper');
      this.ctx.hud?.feed?.('ENEMY ATTACK HELICOPTER ON STATION', '#ff6448');
    } else {
      vehicles.spawnTransport(
        new THREE.Vector3(sky[0], 42, sky[2]),
        new THREE.Vector3(lz.pos[0], 0, lz.pos[2]),
        14,
        ['trooper', 'gunner', 'rocketeer', 'stalker'],
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

  // ---- Iron Bastion Blast Gate Events ---------------------------------------

  private onBastionGateBreached(plan: BastionGatePlan): void {
    this.allyFleet.setGateOpen(plan.id, true);
    // Enemy fortress scrambles immediate interior AT QRF when a gate falls!
    this.spawnEnemySquad(plan.lane, 5, 'qrf');
    if (this.facilities.isAlive('motor_pool')) {
      this.spawnEnemyArmor(plan.lane, 'tank');
    }
  }

  private onBastionGateRebuilt(plan: BastionGatePlan): void {
    this.allyFleet.setGateOpen(plan.id, false);
  }

  // ---- Strategic Facility Events & Momentum Surges --------------------------

  private onFacilityDestroyed(plan: StrategicFacilityPlan): void {
    if (plan.sector === 4) this.deepSabotageCount++;

    if (plan.id === 'artillery_battery' || plan.id === 'radar_aa') {
      for (const def of ENDLESS_WAR_ENEMY_DEFENSES) {
        if (def.facilityId === plan.id) {
          this.baseDefense.applyBlast(new THREE.Vector3(...def.position), 14, 9999, 'facility_sabotage');
        }
      }
    }

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
      // 3 friendly Aegis MBTs + 2 Bastion guntrucks rolling straight up Center Highway (respecting Center Blast Gate)!
      const centerWps = ENDLESS_WAR_FRIENDLY_LANES.center.slice(1);
      const centerGate = ENDLESS_WAR_BASTION_GATES.find(g => g.lane === 'center');
      const gateIdx = Math.max(0, centerWps.length - 2);

      for (let i = 0; i < 3; i++) {
        const u = this.allyFleet.spawnGround({
          kind: 'aegis',
          laneId: 'ew_spearhead',
          spawn: [(i - 1) * 8, 0, 286 - i * 8],
          waypoints: centerWps.map(p => [p[0] + (i - 1) * 4, 0, p[1]] as const),
          gateWaypoints: centerGate ? { [gateIdx]: centerGate.id } : undefined,
          label: `SPEARHEAD MBT-${i + 1}`,
        });
        u.combatHold = true;
      }
      for (const sx of [-12, 12]) {
        const u = this.allyFleet.spawnGround({
          kind: 'bastion',
          laneId: 'ew_spearhead',
          spawn: [sx, 0, 294],
          waypoints: centerWps.map(p => [p[0] + sx * 0.4, 0, p[1]] as const),
          gateWaypoints: centerGate ? { [gateIdx]: centerGate.id } : undefined,
        });
        u.combatHold = true;
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
      const sit = this.commander.getSituation();
      const hot = sit.lanes[this.commander.allyMainLane];
      this.allyFleet.spawnKestrel({
        spawn: [0, 56, 340],
        orbitCenter: [hot.x, 0, clamp(hot.contactZ - 25, -210, 200)],
        orbitRadius: 92,
        orbitAltitude: 44,
        label: 'KESTREL CAS-1',
      });
      this.ctx.hud?.feed?.('ALLIED FIGHTER & GUNSHIP WING SCRAMBLED!', '#5ceeff');
    } else if (id === 'artillery') {
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
      for (const lane of LANES) this.spawnFriendlySquad(lane, 4);
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
      this.bastion.applyBlast(sh.pos, 18, 560, 'war_artillery');
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
