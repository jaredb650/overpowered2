/**
 * Reusable Crossfire Air Wing & Two-Way Dogfight Simulation Controller (`CrossfireAirWing`).
 *
 * Powers live AI jet dogfights across all 4 parts of Crossfire:
 *   - Part 1: Allied buddy F-22 Raptors climbing off Runway 01/19 beside the player's B-1B Lancer
 *   - Parts 2 & 4: 7,500 HP Allied Escort B-1B Lancer + Raptor wingmen vs escalating Southern waves
 *   - Part 3: Friendly F-22 escorts vs Halcyon Hornet CAP overhead
 *
 * Registers every enemy `AiCombatJet` with `ctx.enemies.vehicles.addExtra(jet)` so player Vulcan
 * cannons, AIM-9X/AIM-120D homing missiles, and blasts lock, hit, and shatter jets via
 * `DogfightWreckageSystem` (7 physical chunks + pilot ejections/ragdolls/gibs!).
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import { clamp, rand } from '../../core/math';
import type { EnemyManager } from '../../enemies/EnemyManager';
import {
  AiCombatJet,
  type AiJetKind,
  type AiJetSpawnOptions,
  type AiJetTeam,
  type AiJetTheater,
  type AiTacticalRole,
} from '../../enemies/dogfight/aiJet';
import { DogfightWreckageSystem } from '../../enemies/dogfight/wreckage';
import type { VehicleSystem } from '../../enemies/vehicles';
import { ModelMaterials } from '../../progression/modelkit';

interface AirProjectile {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  lastTrail: THREE.Vector3;
  vel: THREE.Vector3;
  team: AiJetTeam;
  damage: number;
  life: number;
  missile: boolean;
  targetJet: AiCombatJet | null;
  targetPlayer: boolean;
  smokeCd: number;
}

export interface CrossfireAirWingCallbacks {
  onWaveCleared?: (waveId: string) => void;
  onEnemyKilled?: (jet: AiCombatJet, waveId: string | null) => void;
  onAllyKilled?: (jet: AiCombatJet) => void;
  onGroundStrike?: (from: THREE.Vector3, hitPoint: THREE.Vector3, damage: number, attackerName: string, heavyBomb: boolean) => void;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _trailPt = new THREE.Vector3();
const _back = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();
const _zAxis = new THREE.Vector3(0, 0, 1);

export const CROSSFIRE_AIR_THEATER: AiJetTheater = {
  minAlt: 24,
  maxAlt: 300,
  turnRadius: 720,
  groundY: 0,
  dynamicGroundTarget: false,
};

export class CrossfireAirWing {
  readonly enemies: AiCombatJet[] = [];
  readonly allies: AiCombatJet[] = [];
  readonly wreckage: DogfightWreckageSystem;
  readonly materials: ModelMaterials;

  private readonly projectiles: AirProjectile[] = [];
  private readonly waveJets = new Map<string, Set<AiCombatJet>>();
  private readonly jetToWave = new Map<AiCombatJet, string>();
  private readonly clearedWaves = new Set<string>();
  private readonly prevPlayerPos = new THREE.Vector3();
  private readonly playerVel = new THREE.Vector3();
  private hasPrevPlayerPos = false;
  private playerFlareWindow = 0;
  private wasRwrActive = false;
  private unsubFlares: (() => void) | null = null;

  private readonly tracerGeo = new THREE.BoxGeometry(0.16, 0.16, 4.8);
  private readonly missileGeo = new THREE.CylinderGeometry(0.14, 0.2, 2.4, 6);
  private readonly enemyTracerMat = new THREE.MeshBasicMaterial({ color: 0xff5a36 });
  private readonly allyTracerMat = new THREE.MeshBasicMaterial({ color: 0xffe484 });
  private readonly enemyMissileMat = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
  private readonly allyMissileMat = new THREE.MeshBasicMaterial({ color: 0x56f0ff });

  constructor(
    private readonly ctx: Ctx,
    private readonly cb: CrossfireAirWingCallbacks = {},
    private readonly theater: AiJetTheater = CROSSFIRE_AIR_THEATER,
  ) {
    this.missileGeo.rotateX(Math.PI / 2);
    this.materials = new ModelMaterials(ctx);
    this.wreckage = new DogfightWreckageSystem(ctx, ctx.enemies as unknown as EnemyManager, {
      onBombHitCarrier: () => { /* Crossfire bombers attack ground/escort targets, not CVN-88. */ },
    });

    if (ctx.events?.on) {
      this.unsubFlares = ctx.events.on('dogfight:player_flares', () => {
        this.handlePlayerFlares();
      });
    }
  }

  private get vehicleSystem(): Partial<VehicleSystem> | undefined {
    return this.ctx.enemies?.vehicles as Partial<VehicleSystem> | undefined;
  }

  spawnEnemy(
    kind: AiJetKind,
    pos: THREE.Vector3,
    yaw: number,
    skill: number,
    opts?: {
      waveId?: string;
      label?: string;
      tacticalRole?: AiTacticalRole;
      spawnOptions?: AiJetSpawnOptions;
    },
  ): AiCombatJet {
    const waveId = opts?.waveId ?? null;
    const jet = new AiCombatJet(
      this.ctx,
      this.materials,
      kind,
      'enemy',
      pos,
      yaw,
      skill,
      {
        onGunShot: (from, dir, team, damage, speed) => {
          this.spawnProjectile(from, dir, team, damage, speed, false, null, false);
        },
        onMissileLaunch: (from, dir, team, _targetPos, targetJet, damage) => {
          const targetsPlayer = targetJet === null;
          this.spawnProjectile(from, dir, team, damage, 165, true, targetJet, targetsPlayer);
          this.ctx.audio?.play?.('aircraft_missile_fire', { position: from, volume: 0.68, pitch: 1.04 });
        },
        onCarrierStrike: (from, hitPoint, damage, attackerName, heavyBomb) => {
          this.cb.onGroundStrike?.(from, hitPoint, damage, attackerName, heavyBomb);
        },
        onKilled: (killedJet, source, heavyKill) => {
          this.ctx.progression?.award?.(
            killedJet.profile.rewardScore,
            `${killedJet.name} SPLASHED`,
            killedJet.position,
          );
          this.ctx.hud?.feed?.(`SPLASH ONE! ${killedJet.name}`, '#ffd166');
          this.wreckage.shatterJet(
            killedJet.kind,
            killedJet.position,
            killedJet.velocity,
            killedJet.yaw,
            killedJet.pitch,
            killedJet.roll,
          );
          this.wreckage.spawnPilotFate(
            killedJet.kind,
            killedJet.position,
            killedJet.velocity,
            source,
            Boolean(heavyKill),
          );
          this.handleEnemyRemoved(killedJet);
        },
        handlesEnemyAiHits: false,
      },
      opts?.label,
      opts?.tacticalRole,
      this.theater,
      opts?.spawnOptions,
    );

    this.enemies.push(jet);
    this.vehicleSystem?.addExtra?.(jet);

    if (waveId) {
      let set = this.waveJets.get(waveId);
      if (!set) {
        set = new Set();
        this.waveJets.set(waveId, set);
      }
      set.add(jet);
      this.jetToWave.set(jet, waveId);
      this.clearedWaves.delete(waveId);
    }

    return jet;
  }

  spawnAlly(
    kind: AiJetKind,
    pos: THREE.Vector3,
    yaw: number,
    skill: number,
    opts?: {
      label?: string;
      tacticalRole?: AiTacticalRole;
      spawnOptions?: AiJetSpawnOptions;
    },
  ): AiCombatJet {
    const ally = new AiCombatJet(
      this.ctx,
      this.materials,
      kind,
      'ally',
      pos,
      yaw,
      skill,
      {
        onGunShot: (from, dir, team, damage, speed) => {
          this.spawnProjectile(from, dir, team, damage, speed, false, null, false);
        },
        onMissileLaunch: (from, dir, team, _targetPos, targetJet, damage) => {
          this.spawnProjectile(from, dir, team, damage, 175, true, targetJet, false);
          this.ctx.audio?.play?.('aircraft_missile_fire', { position: from, volume: 0.62, pitch: 1.08 });
        },
        onCarrierStrike: () => { /* Allies never strike friendly ships. */ },
        onKilled: killed => {
          this.wreckage.shatterJet(
            killed.kind,
            killed.position,
            killed.velocity,
            killed.yaw,
            killed.pitch,
            killed.roll,
          );
          this.cb.onAllyKilled?.(killed);
        },
        handlesEnemyAiHits: false,
      },
      opts?.label,
      opts?.tacticalRole ?? 'hunter',
      this.theater,
      opts?.spawnOptions,
    );

    this.allies.push(ally);
    return ally;
  }

  /** Fires a friendly carrier CIWS burst or SAM launch (Part 4 Carrier Umbrella spectacle!). */
  fireFriendlyDefenseShot(
    from: THREE.Vector3,
    target: AiCombatJet,
    missile: boolean,
    damage: number,
  ): void {
    _v.subVectors(target.position, from).normalize();
    this.spawnProjectile(from, _v, 'ally', damage, missile ? 195 : 290, missile, missile ? target : null, false);
  }

  /** Number of living enemy jets belonging to a named wave (or total live enemies if omitted). */
  aliveEnemyCount(waveId?: string): number {
    if (!waveId) {
      let n = 0;
      for (const e of this.enemies) if (e.alive && !e.disposed) n++;
      return n;
    }
    const set = this.waveJets.get(waveId);
    if (!set) return 0;
    let n = 0;
    for (const j of set) if (j.alive && !j.disposed) n++;
    return n;
  }

  isWaveCleared(waveId: string): boolean {
    return this.clearedWaves.has(waveId);
  }

  /** Force-clears all remaining living enemies in a wave (helpful for carrier umbrella sweep & tests). */
  shredWave(waveId: string, source = 'ally_carrier_umbrella'): void {
    const set = this.waveJets.get(waveId);
    if (!set) return;
    for (const jet of [...set]) {
      if (jet.alive && !jet.disposed) {
        jet.applyDamage(jet.health + 500, jet.position, source, false, true);
      }
    }
  }

  private handleEnemyRemoved(jet: AiCombatJet): void {
    const waveId = this.jetToWave.get(jet) ?? null;
    this.cb.onEnemyKilled?.(jet, waveId);
    if (!waveId) return;
    const set = this.waveJets.get(waveId);
    if (set) {
      set.delete(jet);
      let anyAlive = false;
      for (const other of set) {
        if (other.alive && !other.disposed) {
          anyAlive = true;
          break;
        }
      }
      if (!anyAlive && !this.clearedWaves.has(waveId)) {
        this.clearedWaves.add(waveId);
        this.cb.onWaveCleared?.(waveId);
      }
    }
    this.jetToWave.delete(jet);
  }

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
    if (this.projectiles.length >= 90) {
      const oldest = this.projectiles.shift();
      if (oldest) this.ctx.render?.scene?.remove(oldest.mesh);
    }

    const geo = missile ? this.missileGeo : this.tracerGeo;
    const mat = missile
      ? (team === 'enemy' ? this.enemyMissileMat : this.allyMissileMat)
      : (team === 'enemy' ? this.enemyTracerMat : this.allyTracerMat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(from);
    _v2.copy(dir).normalize();
    _quat.setFromUnitVectors(_zAxis, _v2);
    mesh.quaternion.copy(_quat);
    this.ctx.render?.scene?.add(mesh);

    this.projectiles.push({
      mesh,
      pos: from.clone(),
      lastTrail: from.clone(),
      vel: _v2.clone().multiplyScalar(speed),
      team,
      damage,
      life: missile ? 6.5 : 2.1,
      missile,
      targetJet,
      targetPlayer,
      smokeCd: 0,
    });
  }

  handlePlayerFlares(): void {
    this.playerFlareWindow = Math.max(this.playerFlareWindow, 4.2);
    for (const e of this.enemies) {
      if (e.alive) e.breakPlayerLock(4.2);
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]!;
      if (p.team === 'enemy' && p.missile && p.targetPlayer) {
        this.ctx.fx?.sparks?.(p.pos, _up, 16, 0xfff0aa);
        this.ctx.render?.scene?.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }
  }

  update(dt: number, priorityTarget: AiCombatJet | null = null): void {
    if (dt <= 0) return;

    if (this.playerFlareWindow > 0) {
      this.playerFlareWindow = Math.max(0, this.playerFlareWindow - dt);
    }

    const player = this.ctx.player;
    const playerPos = player?.position ?? _v.set(0, 0, 0);
    if (this.hasPrevPlayerPos) {
      this.playerVel.subVectors(playerPos, this.prevPlayerPos).divideScalar(Math.max(0.004, dt));
      const spd = this.playerVel.length();
      if (spd > 180) this.playerVel.multiplyScalar(180 / spd);
    } else {
      this.playerVel.set(0, 0, 0);
      this.hasPrevPlayerPos = true;
    }
    this.prevPlayerPos.copy(playerPos);

    const playerAirborne = Boolean(player && player.alive && (player.parked || playerPos.y > 16));
    const playerCountermeasures = this.playerFlareWindow > 0;

    // Tick allied jets (escort B-1B Lancer + F-22 wingmen)
    for (let i = this.allies.length - 1; i >= 0; i--) {
      const ally = this.allies[i]!;
      ally.update(dt, playerPos, this.playerVel, playerAirborne, this.enemies, playerCountermeasures);
      if (ally.disposed) {
        this.allies.splice(i, 1);
      }
    }

    // Tick enemy jets (splitting pressure across player, wingmen, and escort bomber!)
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i]!;
      enemy.update(
        dt,
        playerPos,
        this.playerVel,
        playerAirborne,
        this.allies,
        playerCountermeasures,
        priorityTarget && priorityTarget.alive ? priorityTarget : null,
      );
      if (enemy.disposed) {
        this.vehicleSystem?.removeExtra?.(enemy);
        this.enemies.splice(i, 1);
      }
    }

    this.tickProjectiles(dt, playerPos, playerAirborne);
    this.wreckage.update(dt);
    this.emitRwr(playerAirborne);
  }

  private tickProjectiles(dt: number, playerPos: THREE.Vector3, playerAirborne: boolean): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]!;
      p.life -= dt;

      if (p.missile) {
        let aim: THREE.Vector3 | null = null;
        if (p.targetJet && p.targetJet.alive && !p.targetJet.disposed) {
          aim = p.targetJet.position;
        } else if (p.targetPlayer && playerAirborne) {
          aim = playerPos;
        }
        if (aim) {
          const speed = p.vel.length();
          _v.subVectors(aim, p.pos).normalize();
          _v2.copy(p.vel).normalize().lerp(_v, clamp(3.8 * dt, 0, 1)).normalize();
          p.vel.copy(_v2).multiplyScalar(speed);
          _quat.setFromUnitVectors(_zAxis, _v2);
          p.mesh.quaternion.copy(_quat);
        }
      }

      p.pos.addScaledVector(p.vel, dt);
      p.mesh.position.copy(p.pos);

      if (p.missile) {
        const dist = p.pos.distanceTo(p.lastTrail);
        if (dist >= 4.2) {
          const steps = Math.min(6, Math.floor(dist / 4.2));
          const smokeColor = p.team === 'ally' ? 0xe4e8ec : 0xdcd6ce;
          for (let s = 1; s <= steps; s++) {
            _trailPt.lerpVectors(p.lastTrail, p.pos, s / steps);
            this.ctx.fx?.smoke?.(_trailPt, smokeColor, 1.32, 2.45);
          }
          p.lastTrail.copy(p.pos);
        }
        p.smokeCd -= dt;
        if (p.smokeCd <= 0) {
          p.smokeCd = 0.032;
          this.ctx.fx?.smoke?.(p.pos, 0xffaa44, 0.42, 0.22);
          _back.copy(p.vel).normalize().negate();
          this.ctx.fx?.sparks?.(p.pos, _back, 2, p.team === 'ally' ? 0xb8f3ff : 0xffb380);
        }
      }

      let hit = false;
      if (p.team === 'enemy') {
        if (playerAirborne && p.pos.distanceTo(playerPos) <= (p.missile ? 7.5 : 5.2)) {
          this.ctx.events?.emit?.('dogfight:damage_player_jet', {
            amount: p.damage,
            from: p.pos,
            heavy: p.missile,
          });
          if (p.missile) {
            this.ctx.fx?.explosion?.(p.pos, { radius: 8, scale: 1.25 });
            this.ctx.audio?.play?.('rocket_explosion', { position: p.pos, volume: 0.78 });
          }
          hit = true;
        } else {
          for (let j = 0; j < this.allies.length; j++) {
            const ally = this.allies[j]!;
            if (!ally.alive || ally.disposed) continue;
            const rad = ally.kind === 'lancer' ? 14.0 : 7.5;
            if (p.pos.distanceTo(ally.position) <= rad) {
              ally.applyDamage(p.damage, p.pos, p.missile ? 'enemy_aam' : 'enemy_gun', false, p.missile);
              if (p.missile) {
                this.ctx.fx?.explosion?.(p.pos, { radius: 8, scale: 1.2 });
              }
              hit = true;
              break;
            }
          }
        }
      } else {
        for (let j = 0; j < this.enemies.length; j++) {
          const enemy = this.enemies[j]!;
          if (!enemy.alive || enemy.disposed) continue;
          const rad = enemy.kind === 'lancer' ? 14.0 : (p.missile ? 9.5 : 6.8);
          if (p.pos.distanceTo(enemy.position) <= rad) {
            enemy.applyDamage(p.damage, p.pos, p.missile ? 'ally_aam' : 'ally_gun', false, p.missile);
            if (p.missile) {
              this.ctx.fx?.explosion?.(p.pos, { radius: 8, scale: 1.2 });
            }
            hit = true;
            break;
          }
        }
      }

      if (hit || p.life <= 0 || p.pos.y <= 0.2) {
        this.ctx.render?.scene?.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }
  }

  private emitRwr(playerAirborne: boolean): void {
    let maxLock = 0;
    let label = '';
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.playerLockProgress > maxLock) {
        maxLock = e.playerLockProgress;
        label = e.name;
      }
    }
    const missileInbound = this.projectiles.some(p => p.team === 'enemy' && p.missile && p.targetPlayer);
    const active = playerAirborne && (maxLock > 0.08 || missileInbound);

    if (!active) {
      if (this.wasRwrActive) {
        this.wasRwrActive = false;
        this.ctx.events?.emit?.('dogfight:rwr', {
          locking: false,
          lockStrength: 0,
          missileInbound: false,
          label: '',
        });
      }
      return;
    }

    this.wasRwrActive = true;
    this.ctx.events?.emit?.('dogfight:rwr', {
      locking: maxLock > 0.08,
      lockStrength: maxLock,
      missileInbound,
      label: missileInbound ? 'FOX-2 INBOUND — POP [Q] FLARES' : `${label} LOCKING`,
    });
  }

  clear(): void {
    const vehSys = this.vehicleSystem;
    for (const e of this.enemies) {
      vehSys?.removeExtra?.(e);
      e.dispose();
    }
    this.enemies.length = 0;
    for (const a of this.allies) a.dispose();
    this.allies.length = 0;
    for (const p of this.projectiles) this.ctx.render?.scene?.remove(p.mesh);
    this.projectiles.length = 0;
    this.waveJets.clear();
    this.jetToWave.clear();
    this.clearedWaves.clear();
    this.wreckage.reset();
    this.hasPrevPlayerPos = false;
    this.playerFlareWindow = 0;
    if (this.wasRwrActive) {
      this.wasRwrActive = false;
      this.ctx.events?.emit?.('dogfight:rwr', {
        locking: false,
        lockStrength: 0,
        missileInbound: false,
        label: '',
      });
    }
  }

  dispose(): void {
    this.clear();
    this.unsubFlares?.();
    this.unsubFlares = null;
    this.tracerGeo.dispose();
    this.missileGeo.dispose();
    this.enemyTracerMat.dispose();
    this.allyTracerMat.dispose();
    this.enemyMissileMat.dispose();
    this.allyMissileMat.dispose();
  }
}
