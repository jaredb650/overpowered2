/**
 * Dogfight Mode Wave Director (`DogfightWaves`).
 *
 * Open-ocean Aircraft Carrier defense & air-to-air dogfighting survival mode on USS Sovereign:
 *   - Escalating waves of skilled AI enemy pilots flying real 3D jets (Hornet, Harrier, Warthog,
 *     B-1 Lancer heavy carrier bombers, and F-22 Raptor Aces every 5th wave!).
 *   - Automated USS Sovereign carrier tower defenses: CIWS Phalanx 20mm gatling turrets, SeaRAM
 *     homing SAM launchers, Hull Armor & Auto-Repair, and Allied AI Wingmen escorts!
 *   - Interactive Flight Deck Terminals: switch/launch any aircraft (`F/A-18E`, `F-22`, `B-1`,
 *     `AV-8B`, `A-10`, `Kestrel`) and upgrade carrier defenses with earned combat credits!
 *   - Lightweight 3D airborne tracer & homing missile simulation for enemy guns/AAMs, CIWS streams,
 *     SeaRAM SAMs, and allied wingman combat.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import type { WavePhase, WaveSystem } from '../../core/gameplay';
import { clamp, rand } from '../../core/math';
import { ModelMaterials } from '../../progression/modelkit';
import type { DriveVehicleId } from '../../vehicles/drive/types';
import {
  CARRIER_AIRCRAFT_TERMINAL,
  CARRIER_CENTER,
  CARRIER_DECK_RECT,
  CARRIER_DECK_Y,
  CARRIER_DEFENSE_TERMINAL,
  CARRIER_WINGMAN_PAD,
  DOGFIGHT_BOUNDS,
  DOGFIGHT_PLAYER_SPAWN,
  DOGFIGHT_SKY_SPAWNS,
} from '../../world/map/dogfight/plan';
import type { EnemyManager } from '../EnemyManager';
import type { Outpost } from '../outpost';
import { AiCombatJet, type AiJetKind, type AiJetTeam, type AiTacticalRole } from './aiJet';
import { CarrierDefenseSystem, type CarrierUpgradeId } from './carrier';
import { DogfightTerminalUi, type TerminalTab } from './terminalUi';

const FIRST_WAVE_DELAY = 6.5;
const INTERMISSION_SECONDS = 14.0;
const SPAWN_STAGGER_SECONDS = 1.6;
const MAX_CONCURRENT_ENEMIES = 6;
const TERMINAL_INTERACT_RANGE = 5.2;

/** Returns the enemy jet squadron roster for `wave` (gentle Wave 1 ramp -> heavy bombers -> Raptor Aces!). */
export function dogfightWaveRoster(wave: number): AiJetKind[] {
  const w = Math.max(1, Math.floor(wave));
  if (w === 1) return ['hornet', 'hornet'];
  if (w === 2) return ['hornet', 'hornet', 'harrier'];
  if (w === 3) return ['hornet', 'hornet', 'harrier', 'warthog'];
  if (w === 4) return ['hornet', 'hornet', 'harrier', 'warthog', 'lancer'];
  if (w === 5) return ['raptor', 'hornet', 'hornet', 'warthog', 'lancer'];

  const total = Math.min(10, 4 + Math.floor(w * 0.75));
  const list: AiJetKind[] = [];
  const aceWave = w % 5 === 0;
  const aces = aceWave ? Math.min(2, Math.floor(w / 5)) : (w >= 8 ? 1 : 0);
  const bombers = Math.min(2, Math.floor((w - 2) / 3));
  const warthogs = Math.min(2, Math.floor((w - 1) / 3));

  for (let i = 0; i < aces; i++) list.push('raptor');
  for (let i = 0; i < bombers; i++) list.push('lancer');
  for (let i = 0; i < warthogs; i++) list.push('warthog');

  while (list.length < total) {
    list.push(list.length % 3 === 1 ? 'harrier' : 'hornet');
  }
  return list;
}

/** Pilot skill rating [0.35..1.0] scaling cleanly with wave number. */
export function dogfightWaveSkill(wave: number): number {
  const w = Math.max(1, Math.floor(wave));
  return clamp(0.35 + (w - 1) * 0.11, 0.35, 1.0);
}

interface AirProjectile {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  team: AiJetTeam;
  damage: number;
  life: number;
  missile: boolean;
  targetJet: AiCombatJet | null;
  targetPlayer: boolean;
  smokeCd: number;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();
const _zAxis = new THREE.Vector3(0, 0, 1);

const _airTermPos = new THREE.Vector3(CARRIER_AIRCRAFT_TERMINAL[0], CARRIER_AIRCRAFT_TERMINAL[1] + 2.3, CARRIER_AIRCRAFT_TERMINAL[2]);
const _defTermPos = new THREE.Vector3(CARRIER_DEFENSE_TERMINAL[0], CARRIER_DEFENSE_TERMINAL[1] + 2.3, CARRIER_DEFENSE_TERMINAL[2]);

export class DogfightWaves implements WaveSystem {
  wave = 0;
  phase: WavePhase = 'intermission';
  remaining = 0;
  total = 0;
  nextWaveIn = 0;
  boss = false;

  readonly carrier: CarrierDefenseSystem;
  readonly enemies: AiCombatJet[] = [];
  readonly allies: AiCombatJet[] = [];

  private readonly materials: ModelMaterials;
  private readonly ui: DogfightTerminalUi;
  private readonly projectiles: AirProjectile[] = [];
  private spawnQueue: AiJetKind[] = [];
  private spawnTimer = 0;
  private active = false;
  private waveClearBonus = 0;
  private carrierLossPending = false;
  private carrierLossTimer = 0;
  private unprompt: (() => void) | null = null;
  private promptTag = '';
  private repairHudCd = 0;
  private missileWarnCd = 0;
  private readonly prevPlayerPos = new THREE.Vector3();
  private readonly playerVel = new THREE.Vector3();
  private hasPrevPlayerPos = false;
  private playerFlareWindow = 0;
  private enemySpawnOrdinal = 0;
  private wasRwrActive = false;

  private readonly tracerGeo = new THREE.BoxGeometry(0.14, 0.14, 4.4);
  private readonly missileGeo = new THREE.CylinderGeometry(0.14, 0.2, 2.4, 6);
  private readonly enemyTracerMat = new THREE.MeshBasicMaterial({ color: 0xff5a36 });
  private readonly allyTracerMat = new THREE.MeshBasicMaterial({ color: 0xffe484 });
  private readonly enemyMissileMat = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
  private readonly allyMissileMat = new THREE.MeshBasicMaterial({ color: 0x56f0ff });

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.active || this.carrier.destroyed) return;
    if (e.code === 'KeyB' && !this.ui.open && !this.ctx.player.parked && this.isOnCarrierDeck(this.ctx.player.position)) {
      e.preventDefault();
      this.ui.openTab('defenses');
    }
  };

  constructor(
    private readonly ctx: Ctx,
    private readonly outpost: Outpost,
    private readonly manager: EnemyManager,
  ) {
    this.missileGeo.rotateX(Math.PI / 2);
    this.materials = new ModelMaterials(ctx);

    this.carrier = new CarrierDefenseSystem(ctx, {
      onCiwsShot: (from, dir, damage) => {
        this.spawnProjectile(from, dir, 'ally', damage, 280, false, null, false);
        if (Math.random() < 0.24) {
          this.ctx.audio?.play?.('gunship_gun', { position: from, volume: 0.32, pitch: rand(1.15, 1.32) });
        }
      },
      onSamLaunch: (from, dir, target, damage) => {
        this.spawnProjectile(from, dir, 'ally', damage, 165, true, target, false);
        this.ctx.audio?.play?.('rocket_fire', { position: from, volume: 0.72, pitch: 1.15 });
        this.ctx.fx?.sparks?.(from, _up, 12, 0xffd166);
      },
      onSpawnWingman: kind => {
        this.spawnWingman(kind);
      },
      onCarrierDestroyed: () => {
        this.triggerCarrierDestroyed();
      },
    });

    this.ui = new DogfightTerminalUi(ctx, this.carrier, {
      onSelectAircraft: (id, boardNow) => this.selectAircraft(id, boardNow),
      onBuyUpgrade: id => this.buyUpgrade(id),
      onCallNextWave: () => this.callNextWaveNow(),
      canCallNextWave: () => this.phase === 'intermission' && !this.carrier.destroyed,
      waveSummary: () => {
        if (this.carrier.destroyed) return 'CARRIER LOST';
        if (this.phase === 'intermission') return `NEXT WAVE ${Math.ceil(this.nextWaveIn)}s`;
        return `WAVE ${this.wave} · ${this.remaining} BANDITS`;
      },
    });

    ctx.events.on('run:start', () => this.start());
    ctx.events.on('game:state', ({ to }) => {
      this.ui.setHudVisible(this.active && to === 'playing');
      if (to === 'menu' || to === 'gameover') {
        this.ui.close();
        this.clearPrompt();
        this.clearPlayerRwr();
      }
    });
    ctx.events.on('dogfight:player_flares', () => {
      if (this.active) this.handlePlayerFlares();
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKeyDown);
    }
  }

  start(): void {
    this.reset();
    this.active = true;
    this.phase = 'intermission';
    this.nextWaveIn = FIRST_WAVE_DELAY;
    this.ui.setHudVisible(true);
    this.ui.updateHud();
    this.ctx.hud?.feed?.('USS SOVEREIGN FLIGHT OPS — BOARD YOUR JET OR USE DECK TERMINALS [E]', '#38e8ff');
  }

  reset(): void {
    this.clearUnitsAndProjectiles();
    this.clearPrompt();
    this.clearPlayerRwr();
    this.carrier.reset();
    this.ui.close();
    this.ui.setHudVisible(false);
    this.wave = 0;
    this.phase = 'intermission';
    this.remaining = 0;
    this.total = 0;
    this.nextWaveIn = 0;
    this.boss = false;
    this.spawnQueue.length = 0;
    this.spawnTimer = 0;
    this.carrierLossPending = false;
    this.carrierLossTimer = 0;
    this.hasPrevPlayerPos = false;
    this.playerVel.set(0, 0, 0);
    this.playerFlareWindow = 0;
    this.enemySpawnOrdinal = 0;
    this.active = false;
    // Keep generic outpost squads suppressed so ground soldiers don't spawn over the ocean.
    void this.outpost;
  }

  private selectAircraft(id: DriveVehicleId, boardNow: boolean): void {
    this.ctx.events.emit('dogfight:spawn_jet', { id, board: boardNow });
    this.ctx.audio?.play?.('ui_confirm');
    this.ctx.hud?.feed?.(`CATAPULT READY — ${id.toUpperCase()} STAGED ON FLIGHT DECK`, '#38e8ff');
  }

  private buyUpgrade(id: CarrierUpgradeId): void {
    const res = this.carrier.purchase(id);
    if (!res.ok) {
      this.ctx.audio?.play?.('ui_error');
    }
  }

  private callNextWaveNow(): void {
    if (this.phase === 'intermission' && !this.carrier.destroyed) {
      this.nextWaveIn = 0.05;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Main per-frame Dogfight loop
  // -------------------------------------------------------------------------------------------

  update(): void {
    if (!this.active) return;
    const dt = this.ctx.time.dt;
    if (dt <= 0) return;

    // Dramatic carrier sinking beat before ending the run.
    if (this.carrierLossPending) {
      this.carrierLossTimer -= dt;
      if (Math.random() < dt * 7) {
        _v.set(rand(-16, 14), CARRIER_DECK_Y + rand(0.5, 4.5), rand(-55, 55));
        this.ctx.fx?.explosion?.(_v, { radius: 12, scale: rand(1.4, 2.4) });
        this.ctx.audio?.play?.('explosion_barrel', { position: _v, volume: 0.85, pitch: rand(0.75, 1.0) });
      }
      if (this.carrierLossTimer <= 0 && this.ctx.player.alive) {
        this.carrierLossPending = false;
        this.ctx.player.takeDamage({
          amount: 999_999,
          type: 'explosive',
          from: new THREE.Vector3(...CARRIER_CENTER),
          source: 'carrier_destroyed',
        });
      }
      this.ui.updateHud();
      return;
    }

    if (this.repairHudCd > 0) this.repairHudCd = Math.max(0, this.repairHudCd - dt);
    if (this.missileWarnCd > 0) this.missileWarnCd = Math.max(0, this.missileWarnCd - dt);
    if (this.playerFlareWindow > 0) this.playerFlareWindow = Math.max(0, this.playerFlareWindow - dt);

    // 1. Wave Director State Machine
    if (this.phase === 'intermission') {
      this.nextWaveIn = Math.max(0, this.nextWaveIn - dt);
      if (this.nextWaveIn <= 0) {
        this.startNextWave();
      }
    } else {
      this.tickSpawns(dt);
      const aliveEnemies = this.countAliveEnemies();
      this.remaining = aliveEnemies + this.spawnQueue.length;
      if (this.spawnQueue.length === 0 && this.phase === 'spawning') {
        this.phase = this.boss ? 'boss' : 'clearing';
      }
      if (this.remaining <= 0) {
        this.completeWave();
      }
    }

    // 2. Player state (airborne vs on deck) — compute real 3D jet velocity while seated!
    // (Player.velocity stays 0 while parked inside a vehicle, so finite-difference position gives
    //  AI fighters accurate lead-pursuit velocity!)
    const player = this.ctx.player;
    const playerPos = player.position;
    if (player.parked && this.hasPrevPlayerPos && dt > 1e-4) {
      this.playerVel.subVectors(playerPos, this.prevPlayerPos).divideScalar(dt);
      const spd = this.playerVel.length();
      if (spd > 180) this.playerVel.multiplyScalar(180 / spd);
    } else {
      this.playerVel.copy(player.velocity);
    }
    this.prevPlayerPos.copy(playerPos);
    this.hasPrevPlayerPos = true;

    const playerVel = this.playerVel;
    const playerAirborne = player.parked && playerPos.y > CARRIER_DECK_Y + 6;
    const playerCountermeasures = this.playerFlareWindow > 0;

    // 3. Ocean fall-off safety hoist (if player walks off deck on foot into water).
    if (player.alive && !player.parked && playerPos.y < 2.2) {
      player.teleport(new THREE.Vector3(DOGFIGHT_PLAYER_SPAWN[0], DOGFIGHT_PLAYER_SPAWN[1] + 0.25, DOGFIGHT_PLAYER_SPAWN[2]));
      this.ctx.hud?.feed?.('RESCUE HOIST — RETURNED TO USS SOVEREIGN FLIGHT DECK', '#38e8ff');
      this.ctx.audio?.play?.('ui_confirm');
    }

    // 4. Auto-repair player's aircraft whenever landed/parked on the carrier flight deck!
    if (player.alive && player.parked && this.isOnCarrierDeck(playerPos) && playerPos.y <= CARRIER_DECK_Y + 3.5) {
      this.ctx.events.emit('dogfight:repair_player_jet', { amount: 65 * dt });
    }

    // 5. Interactive Deck Terminal proximity prompts ([E] Aircraft Hangar / Carrier Defenses).
    this.updateDeckTerminals();

    // 6. Tick all AI Enemy Jets & Allied Wingmen!
    this.tickJets(this.enemies, dt, playerPos, playerVel, playerAirborne, this.allies, playerCountermeasures);
    this.tickJets(this.allies, dt, playerPos, playerVel, playerAirborne, this.enemies, false);

    // 7. Tick Carrier CIWS Phalanx, SeaRAM SAM launchers & Hull Auto-Repair!
    this.carrier.update(dt, this.enemies);

    // 8. Tick airborne tracers & homing missiles!
    this.tickProjectiles(dt, playerPos, playerCountermeasures);

    // 9. Aggregate enemy radar locks & inbound Fox-2 missiles for the player's cockpit RWR!
    this.emitPlayerRwr(player.alive && player.parked);

    // 10. Update Carrier HUD Strip!
    this.ui.updateHud();
  }

  private startNextWave(): void {
    this.wave++;
    this.spawnQueue = dogfightWaveRoster(this.wave);
    this.total = this.spawnQueue.length;
    this.remaining = this.total;
    this.boss = this.wave % 5 === 0;
    this.phase = 'spawning';
    this.spawnTimer = 0.25;
    this.waveClearBonus = 200 + this.wave * 75;

    // Ensure allied wingmen from upgrades are airborne at wave start!
    this.ensureWingmen();

    this.ctx.events.emit('wave:start', { wave: this.wave, total: this.total, boss: this.boss });
    const label = this.boss
      ? `WAVE ${this.wave} — ACE SQUADRON INBOUND (${this.total} BANDITS)!`
      : `WAVE ${this.wave} — ${this.total} HOSTILE AIRCRAFT ON RADAR!`;
    this.ctx.hud?.feed?.(label, this.boss ? '#ff3864' : '#ff9f1c');
    this.ctx.audio?.play?.(this.boss ? 'wave_start_hard' : 'wave_start');
  }

  private completeWave(): void {
    this.phase = 'intermission';
    this.nextWaveIn = INTERMISSION_SECONDS;
    const scoreBonus = 1000 + this.wave * 400;
    this.carrier.addCredits(this.waveClearBonus);
    this.ctx.progression?.award?.(scoreBonus, `WAVE ${this.wave} CLEAR`);
    this.ctx.events.emit('wave:clear', { wave: this.wave, bonus: scoreBonus });
    this.ctx.hud?.feed?.(
      `WAVE ${this.wave} CLEARED! +${this.waveClearBonus} CR — LAND ON DECK TO UPGRADE DEFENSES`,
      '#54ff9d',
    );
  }

  private tickSpawns(dt: number): void {
    if (this.spawnQueue.length === 0) return;
    if (this.countAliveEnemies() >= MAX_CONCURRENT_ENEMIES) return;
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;

    const kind = this.spawnQueue.shift()!;
    this.spawnEnemyJet(kind);
    this.spawnTimer = SPAWN_STAGGER_SECONDS;
  }

  private spawnEnemyJet(kind: AiJetKind): void {
    const slot = DOGFIGHT_SKY_SPAWNS[Math.floor(Math.random() * DOGFIGHT_SKY_SPAWNS.length)]!;
    const pos = new THREE.Vector3(
      slot[0] + rand(-24, 24),
      slot[1] + rand(-10, 18),
      slot[2] + rand(-24, 24),
    );

    // Assign clear tactical roles: Hornets & Raptors are air-superiority hunters that dogfight
    // the player; Lancers & Warthogs focus on carrier strikes; Harriers split 50/50!
    const ordinal = this.enemySpawnOrdinal++;
    const tacticalRole: AiTacticalRole =
      kind === 'raptor' || kind === 'hornet'
        ? 'hunter'
        : kind === 'harrier'
          ? (ordinal % 2 === 0 ? 'hunter' : 'striker')
          : 'striker';

    const player = this.ctx.player;
    const playerAirborne = player.parked && player.position.y > CARRIER_DECK_Y + 6;
    const aimX = tacticalRole === 'hunter' && playerAirborne ? player.position.x : CARRIER_CENTER[0];
    const aimZ = tacticalRole === 'hunter' && playerAirborne ? player.position.z : CARRIER_CENTER[2];
    const initialYaw = Math.atan2(aimX - pos.x, aimZ - pos.z);
    const skill = dogfightWaveSkill(this.wave) + (kind === 'raptor' ? 0.15 : 0);

    const jet = new AiCombatJet(this.ctx, this.materials, kind, 'enemy', pos, initialYaw, skill, {
      onGunShot: (from, dir, team, damage, speed) => {
        this.spawnProjectile(from, dir, team, damage, speed, false, null, team === 'enemy');
      },
      onMissileLaunch: (from, dir, team, _targetPos, targetJet, damage) => {
        this.spawnProjectile(from, dir, team, damage, 152, true, targetJet, team === 'enemy');
        this.ctx.audio?.play?.('rocket_fire', { position: from, volume: 0.65, pitch: 1.05 });
        if (team === 'enemy' && this.missileWarnCd <= 0) {
          this.missileWarnCd = 4.0;
          this.ctx.hud?.feed?.('MISSILE ALERT — BANDIT FOX-2 INBOUND! POP [Q] FLARES!', '#ff3864');
        }
      },
      onCarrierStrike: (from, hitPt, damage, attackerName, heavyBomb) => {
        this.ctx.fx?.explosion?.(hitPt, { radius: heavyBomb ? 14 : 8, scale: heavyBomb ? 2.2 : 1.25 });
        this.ctx.audio?.play?.(heavyBomb ? 'explosion_tank' : 'explosion_barrel', { position: hitPt, volume: 0.9, pitch: rand(0.85, 1.05) });
        if (heavyBomb) {
          // Visual bomb drop streak from bomber to deck.
          _v.subVectors(hitPt, from).normalize();
          this.spawnProjectile(from, _v, 'enemy', 0, 145, false, null, false);
        }
        this.carrier.damageHull(damage, hitPt, attackerName);
      },
      onKilled: (killedJet, _source) => {
        this.carrier.addCredits(killedJet.profile.rewardCredits);
        this.ctx.progression?.award?.(killedJet.profile.rewardScore, `${killedJet.name} SPLASHED`, killedJet.position);
        this.ctx.hud?.feed?.(`SPLASH ONE! ${killedJet.name} (+${killedJet.profile.rewardCredits} CR)`, '#ffd166');
      },
    }, undefined, tacticalRole);

    this.enemies.push(jet);
    this.manager.vehicles?.addExtra(jet);
  }

  private ensureWingmen(): void {
    const aliveAllies = this.allies.filter(a => a.alive);
    if (this.carrier.wingmanLevel >= 1 && aliveAllies.length < 1) {
      this.spawnWingman('hornet');
    }
    if (this.carrier.wingmanLevel >= 2 && this.allies.filter(a => a.alive).length < 2) {
      this.spawnWingman('raptor');
    }
  }

  private spawnWingman(kind: 'hornet' | 'raptor'): void {
    const pos = new THREE.Vector3(
      CARRIER_WINGMAN_PAD[0] + rand(-4, 4),
      CARRIER_WINGMAN_PAD[1] + 18,
      CARRIER_WINGMAN_PAD[2] - 25,
    );
    const ally = new AiCombatJet(this.ctx, this.materials, kind, 'ally', pos, Math.PI, 0.92, {
      onGunShot: (from, dir, team, damage, speed) => {
        this.spawnProjectile(from, dir, team, damage, speed, false, null, false);
      },
      onMissileLaunch: (from, dir, team, _targetPos, targetJet, damage) => {
        this.spawnProjectile(from, dir, team, damage, 165, true, targetJet, false);
        this.ctx.audio?.play?.('rocket_fire', { position: from, volume: 0.55, pitch: 1.15 });
      },
      onCarrierStrike: () => { /* Allies never strike the carrier. */ },
      onKilled: killed => {
        this.ctx.hud?.feed?.(`${killed.name} SHOT DOWN — LAUNCHING REPLACEMENT NEXT WAVE`, '#ff9f1c');
      },
    }, undefined, 'hunter');
    this.allies.push(ally);
  }

  private tickJets(
    list: AiCombatJet[],
    dt: number,
    playerPos: THREE.Vector3,
    playerVel: THREE.Vector3,
    playerAirborne: boolean,
    opponents: readonly AiCombatJet[],
    playerCountermeasures: boolean,
  ): void {
    for (let i = list.length - 1; i >= 0; i--) {
      const jet = list[i]!;
      jet.update(dt, playerPos, playerVel, playerAirborne, opponents, playerCountermeasures);
      if (jet.disposed) {
        this.manager.vehicles?.removeExtra(jet);
        list.splice(i, 1);
      }
    }
  }

  private handlePlayerFlares(): void {
    this.playerFlareWindow = Math.max(this.playerFlareWindow, 4.2);

    let brokeLocks = 0;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.isLockingPlayer) brokeLocks++;
      e.breakPlayerLock(4.2);
    }

    let decoyedMissiles = 0;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]!;
      if (p.team === 'enemy' && p.missile && p.targetPlayer) {
        this.ctx.fx?.sparks?.(p.pos, _up, 18, 0xfff0aa);
        this.ctx.fx?.explosion?.(p.pos, { radius: 4.5, scale: 0.65 });
        this.ctx.audio?.play?.('explosion_barrel', { position: p.pos, volume: 0.45, pitch: 1.25 });
        this.ctx.render?.scene?.remove(p.mesh);
        this.projectiles.splice(i, 1);
        decoyedMissiles++;
      }
    }

    if (decoyedMissiles > 0) {
      this.ctx.hud?.feed?.(
        decoyedMissiles > 1
          ? `${decoyedMissiles} INBOUND MISSILES DECOYED BY IR FLARES!`
          : 'INBOUND MISSILE DECOYED BY IR FLARES!',
        '#54ff9d',
      );
    } else if (brokeLocks > 0) {
      this.ctx.hud?.feed?.('RADAR LOCK BROKEN — IR FLARES DEPLOYED!', '#54ff9d');
    }

    this.emitPlayerRwr(this.ctx.player.alive && this.ctx.player.parked);
  }

  private emitPlayerRwr(activeCockpit: boolean): void {
    if (!activeCockpit) {
      this.clearPlayerRwr();
      return;
    }

    let maxLock = 0;
    let lockingName = '';
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.playerLockProgress > maxLock) {
        maxLock = e.playerLockProgress;
        lockingName = e.name;
      }
    }

    let missileInbound = false;
    for (const p of this.projectiles) {
      if (p.team === 'enemy' && p.missile && p.targetPlayer) {
        missileInbound = true;
        break;
      }
    }

    const locking = maxLock > 0.08;
    const anyWarning = locking || missileInbound;
    if (!anyWarning && !this.wasRwrActive) return;
    this.wasRwrActive = anyWarning;

    const label = missileInbound
      ? 'BANDIT FOX-2 INBOUND'
      : locking
        ? `${lockingName} LOCKING (${Math.round(maxLock * 100)}%)`
        : '';

    this.ctx.events.emit('dogfight:rwr', {
      locking,
      lockStrength: maxLock,
      missileInbound,
      label,
    });
  }

  private clearPlayerRwr(): void {
    if (!this.wasRwrActive) return;
    this.wasRwrActive = false;
    this.ctx.events.emit('dogfight:rwr', {
      locking: false,
      lockStrength: 0,
      missileInbound: false,
      label: '',
    });
  }

  private countAliveEnemies(): number {
    let n = 0;
    for (const e of this.enemies) if (e.alive) n++;
    return n;
  }

  // -------------------------------------------------------------------------------------------
  // Airborne Tracer & Homing Missile Pool
  // -------------------------------------------------------------------------------------------

  private spawnProjectile(
    from: THREE.Vector3,
    dir: THREE.Vector3,
    team: AiJetTeam,
    damage: number,
    speed: number,
    missile: boolean,
    targetJet: AiCombatJet | null,
    targetPlayer: boolean,
  ): void {
    if (this.projectiles.length >= 140) {
      const old = this.projectiles.shift()!;
      this.ctx.render?.scene?.remove(old.mesh);
    }
    const geo = missile ? this.missileGeo : this.tracerGeo;
    const mat = missile
      ? (team === 'enemy' ? this.enemyMissileMat : this.allyMissileMat)
      : (team === 'enemy' ? this.enemyTracerMat : this.allyTracerMat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(from);
    _quat.setFromUnitVectors(_zAxis, dir);
    mesh.quaternion.copy(_quat);
    this.ctx.render?.scene?.add(mesh);

    this.projectiles.push({
      mesh,
      pos: from.clone(),
      vel: dir.clone().multiplyScalar(speed),
      team,
      damage,
      life: missile ? 7.5 : 2.6,
      missile,
      targetJet,
      targetPlayer,
      smokeCd: 0,
    });
  }

  private tickProjectiles(dt: number, playerPos: THREE.Vector3, playerCountermeasures: boolean): void {
    const player = this.ctx.player;
    const maxBoundX = DOGFIGHT_BOUNDS.x1 + 60;
    const maxBoundZ = DOGFIGHT_BOUNDS.z1 + 60;

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]!;
      p.life -= dt;

      if (p.missile) {
        let aimTarget: THREE.Vector3 | null = null;
        if (p.team === 'ally' && p.targetJet?.alive) {
          aimTarget = p.targetJet.position;
        } else if (p.team === 'enemy' && p.targetPlayer && player.alive && !playerCountermeasures) {
          aimTarget = playerPos;
        }

        if (aimTarget) {
          const spd = p.vel.length();
          _v.subVectors(aimTarget, p.pos).normalize();
          // Homing turn rate: SAMs track tightly; enemy AAMs are dodgeable with hard G-breaks or [Q] flares!
          const turnGain = p.team === 'ally' ? 5.2 : 2.45;
          _v2.copy(p.vel).normalize().lerp(_v, clamp(turnGain * dt, 0, 1)).normalize();
          p.vel.copy(_v2).multiplyScalar(spd);
          _quat.setFromUnitVectors(_zAxis, _v2);
          p.mesh.quaternion.copy(_quat);
        }

        p.smokeCd -= dt;
        if (p.smokeCd <= 0) {
          p.smokeCd = 0.045;
          this.ctx.fx?.sparks?.(p.pos, _up, 2, p.team === 'ally' ? 0xb8f3ff : 0xffb380);
        }
      }

      p.pos.addScaledVector(p.vel, dt);
      p.mesh.position.copy(p.pos);

      let hit = false;
      if (p.damage > 0) {
        if (p.team === 'ally') {
          // Check hit against enemy AI jets!
          const hitRadius = p.missile ? 8.2 : 5.6;
          const hitSq = hitRadius * hitRadius;
          for (const e of this.enemies) {
            if (!e.alive) continue;
            if (p.pos.distanceToSquared(e.position) <= hitSq) {
              if (p.missile) {
                this.ctx.fx?.explosion?.(p.pos, { radius: 8, scale: 1.15 });
                this.ctx.audio?.play?.('rocket_explosion', { position: p.pos, volume: 0.75 });
              }
              e.applyDamage(p.damage, p.pos, p.missile ? 'carrier_sam' : 'carrier_ciws', false);
              hit = true;
              break;
            }
          }
        } else if (player.alive) {
          // Check hit against player (active aircraft hull when parked, or on-foot player on deck).
          const hitR = p.missile ? 6.4 : 4.2;
          if (p.pos.distanceToSquared(playerPos) <= hitR * hitR) {
            if (p.missile) {
              this.ctx.fx?.explosion?.(p.pos, { radius: 8, scale: 1.1 });
              this.ctx.audio?.play?.('rocket_explosion', { position: p.pos, volume: 0.85 });
            }
            if (player.parked) {
              this.ctx.events.emit('dogfight:damage_player_jet', {
                amount: p.damage,
                from: p.pos.clone(),
              });
            } else {
              player.takeDamage({
                amount: p.damage,
                type: p.missile ? 'explosive' : 'bullet',
                from: p.pos.clone(),
                source: p.missile ? 'enemy_aam' : 'enemy_jet_gun',
              });
            }
            hit = true;
          }
        }
      }

      const outOfBounds = Math.abs(p.pos.x) > maxBoundX || Math.abs(p.pos.z) > maxBoundZ || p.pos.y <= 0.2;
      if (hit || p.life <= 0 || outOfBounds) {
        this.ctx.render?.scene?.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Deck Terminals & Helpers
  // -------------------------------------------------------------------------------------------

  private isOnCarrierDeck(p: THREE.Vector3): boolean {
    return (
      p.x >= CARRIER_DECK_RECT.x0 - 1.5 &&
      p.x <= CARRIER_DECK_RECT.x1 + 1.5 &&
      p.z >= CARRIER_DECK_RECT.z0 - 1.5 &&
      p.z <= CARRIER_DECK_RECT.z1 + 1.5
    );
  }

  private updateDeckTerminals(): void {
    const { input, player } = this.ctx;
    if (!player.alive || player.parked || this.ui.open || this.carrier.destroyed) {
      this.clearPrompt();
      return;
    }

    const dAir = Math.hypot(
      player.position.x - CARRIER_AIRCRAFT_TERMINAL[0],
      player.position.z - CARRIER_AIRCRAFT_TERMINAL[2],
    );
    const dDef = Math.hypot(
      player.position.x - CARRIER_DEFENSE_TERMINAL[0],
      player.position.z - CARRIER_DEFENSE_TERMINAL[2],
    );

    const key = input.labelFor?.('interact') ?? 'E';
    let targetTab: TerminalTab | null = null;
    if (dAir <= TERMINAL_INTERACT_RANGE && dAir <= dDef) {
      targetTab = 'aircraft';
      this.setPrompt(_airTermPos, `[${key}] FLIGHT DECK HANGAR — SELECT AIRCRAFT`, '#38e8ff');
    } else if (dDef <= TERMINAL_INTERACT_RANGE) {
      targetTab = 'defenses';
      this.setPrompt(_defTermPos, `[${key}] CARRIER DEFENSES — UPGRADES (${this.carrier.credits} CR)`, '#ffd166');
    } else {
      this.clearPrompt();
    }

    if (targetTab && input.pressed?.('interact')) {
      this.ui.openTab(targetTab);
    }
  }

  private setPrompt(pos: THREE.Vector3, label: string, color: string): void {
    const tag = `${label}|${color}`;
    if (this.promptTag === tag && this.unprompt) return;
    this.clearPrompt();
    this.promptTag = tag;
    this.unprompt = this.ctx.hud?.follow?.(pos, label, color) ?? null;
  }

  private clearPrompt(): void {
    if (this.unprompt) {
      this.unprompt();
      this.unprompt = null;
    }
    this.promptTag = '';
  }

  private triggerCarrierDestroyed(): void {
    this.ui.close();
    this.clearPrompt();
    this.carrierLossPending = true;
    this.carrierLossTimer = 2.0;
    this.ctx.hud?.feed?.('USS SOVEREIGN SUNK — CARRIER LOST!', '#ff2e2e');
  }

  private clearUnitsAndProjectiles(): void {
    for (const e of this.enemies) {
      this.manager.vehicles?.removeExtra(e);
      e.dispose();
    }
    for (const a of this.allies) {
      a.dispose();
    }
    this.enemies.length = 0;
    this.allies.length = 0;

    for (const p of this.projectiles) {
      this.ctx.render?.scene?.remove(p.mesh);
    }
    this.projectiles.length = 0;
  }

  dispose(): void {
    this.clearUnitsAndProjectiles();
    this.clearPrompt();
    this.carrier.dispose();
    this.ui.dispose();
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKeyDown);
    }
  }
}
