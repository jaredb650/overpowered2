/**
 * Badlands Enemy Jet Airstrike Controller (`BadlandsJetController`).
 *
 * Brings our full 3D PBR AI combat jets (`warthog`, `harrier`, `hornet`, `lancer`, `raptor`)
 * into Badlands from Wave 6+ with:
 *   - Distinct aircraft doctrines over the 352 m × 352 m desert basin:
 *       * A-10 Warthog  — Low diving GAU-8 30 mm BRRRT strafes + Mk-82 / cluster dive-bombs
 *       * AV-8B Harrier — Hydra rocket barrages + 25 mm cannon passes (dogfights airborne players)
 *       * F/A-18E Hornet / F-22 Raptor Ace — Air-superiority dogfighters with Fox-2 missiles & RWR lock
 *         against airborne helicopters/Frames, plus fast strafing/rocket runs vs ground targets
 *       * B-1 Lancer    — High-altitude supersonic carpet bombing with 5-bomb Mk-84 & para-bomb sticks
 *   - Full `ExtraTarget` / `MissileTarget` / AA-radar registration so Bastion AA Vulcans, Kestrel/Valkyrie
 *     gunships, Distraint Frames, and infantry rockets all track, lock, and shred jets seamlessly
 *   - 7-piece physical wreckage shatter + randomized pilot fate (shootable parachutist / burning / mangled / gibbed)
 *   - Seamless co-op sync through `DogfightSync` (`SIDE.jets`, `dfhit`, `dfshatter`, `dfrwr`, `dfdmg`, `dfflare`)
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import { clamp, rand } from '../../core/math';
import { ModelMaterials } from '../../progression/modelkit';
import { BADLANDS_SKY_SPAWNS } from '../../world/map/badlands';
import type { EnemyManager } from '../EnemyManager';
import {
  AiCombatJet,
  type AiJetKind,
  type AiJetTeam,
  type AiJetTheater,
  type AiTacticalRole,
} from '../dogfight/aiJet';
import { DogfightWreckageSystem } from '../dogfight/wreckage';
import { cutAir, makeAirSpeaker, sayAir } from '../outpost/chatter/airRadio';

export interface BadlandsJetNetBridge {
  onJetKilled(jet: AiCombatJet, source: string, heavyKill: boolean): void;
  onPlayerFlares(): void;
  onGuestDamage(peerId: string, amount: number, from: THREE.Vector3): void;
  onGuestRwr(peerId: string, locking: boolean, lockStrength: number, missileInbound: boolean, label: string): void;
}

export const BADLANDS_JET_THEATER: AiJetTheater = {
  minAlt: 28,
  maxAlt: 102,
  turnRadius: 215,
  groundY: 0,
  dynamicGroundTarget: true,
  bomberAlert: 'B-1 LANCER BOMBS AWAY — CARPET BOMBING RUN! TAKE COVER!',
};

interface JetProjectile {
  pos: THREE.Vector3;
  lastTrail: THREE.Vector3;
  vel: THREE.Vector3;
  damage: number;
  speed: number;
  homing: boolean;
  rocket: boolean;
  heavyTracer: boolean;
  life: number;
  targetPeerId: string | null;
  decoyed: boolean;
  smokeCd: number;
}

const JET_SPAWN_RADIUS = 205;
const MAX_PROJECTILES = 72;
const FLARE_WINDOW_SECONDS = 3.2;

const _v = new THREE.Vector3();
const _prev = new THREE.Vector3();
const _trailPt = new THREE.Vector3();
const _back = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class BadlandsJetController {
  readonly enemies: AiCombatJet[] = [];
  readonly allies: readonly AiCombatJet[] = [];
  readonly wreckage: DogfightWreckageSystem;

  private materials: ModelMaterials | null = null;
  private readonly projectiles: JetProjectile[] = [];
  private readonly prevPlayerPos = new THREE.Vector3();
  private readonly playerVel = new THREE.Vector3();
  private hasPrevPlayerPos = false;
  private playerFlareWindow = 0;
  private missileWarnCd = 0;
  private spawnOrdinal = 0;
  private rwrActive = false;
  private netBridge: BadlandsJetNetBridge | null = null;
  private readonly offs: (() => void)[] = [];

  constructor(
    private readonly ctx: Ctx,
    private readonly manager: EnemyManager,
  ) {
    this.wreckage = new DogfightWreckageSystem(
      ctx,
      manager,
      {
        onBombHitCarrier: (hitPt, damage, _attackerName, heavy) => {
          this.detonateDesertOrdnance(hitPt, damage, heavy ? 14 : 9.5, heavy ? 'shell' : 'rocket');
        },
      },
      'desert',
    );

    const offFlares = ctx.events?.on?.('dogfight:player_flares', () => {
      this.triggerLocalFlares();
    });
    if (typeof offFlares === 'function') this.offs.push(offFlares);
  }

  /** Plugs or clears the co-op network bridge (called by `DogfightSync`). */
  setNetBridge(bridge: BadlandsJetNetBridge | null): void {
    this.netBridge = bridge;
  }

  /** Number of currently flying hostile jets. */
  get aliveCount(): number {
    let n = 0;
    for (const j of this.enemies) {
      if (j.alive && !j.disposed) n++;
    }
    return n;
  }

  /** Guest: advances shattered wreckage & falling bombs on co-op guests. */
  tickGuest(dt: number): void {
    if (dt <= 0) return;
    this.wreckage.update(dt);
  }

  /** Guest: plays the 7-piece physical jet breakup & pilot fate when host splashes a Badlands jet. */
  applyGuestShatter(
    kind: AiJetKind,
    _team: AiJetTeam,
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    yaw: number,
    pitch: number,
    roll: number,
    source: string,
    heavyKill: boolean,
  ): void {
    this.wreckage.shatterJet(kind, pos, vel, yaw, pitch, roll);
    this.wreckage.spawnPilotFate(kind, pos, vel, source, heavyKill);
  }

  /** Host: breaks enemy jet radar locks & decoys inbound Fox-2 missiles when a guest pops flares. */
  triggerGuestFlares(): void {
    this.playerFlareWindow = Math.max(this.playerFlareWindow, FLARE_WINDOW_SECONDS);
    for (const jet of this.enemies) jet.breakPlayerLock(3.8);
    for (const p of this.projectiles) {
      if (p.homing) p.decoyed = true;
    }
  }

  private triggerLocalFlares(): void {
    this.playerFlareWindow = FLARE_WINDOW_SECONDS;
    for (const jet of this.enemies) jet.breakPlayerLock(3.8);
    for (const p of this.projectiles) {
      if (p.homing) p.decoyed = true;
    }
    this.netBridge?.onPlayerFlares();
  }

  /** Spawns an enemy combat jet on the Badlands outer sky perimeter and registers it with `VehicleSystem`. */
  spawnJet(kind: AiJetKind, wave: number): AiCombatJet {
    this.materials ??= new ModelMaterials(this.ctx);
    const raw = BADLANDS_SKY_SPAWNS[Math.floor(rand(0, BADLANDS_SKY_SPAWNS.length))] ?? [120, 62, -120];
    const len = Math.max(1, Math.hypot(raw[0], raw[2]));
    const alt = clamp(
      kind === 'lancer' ? 84 : kind === 'warthog' ? 54 : 68,
      BADLANDS_JET_THEATER.minAlt + 12,
      BADLANDS_JET_THEATER.maxAlt - 6,
    );
    const pos = new THREE.Vector3(
      (raw[0] / len) * JET_SPAWN_RADIUS + rand(-18, 18),
      alt + rand(-5, 6),
      (raw[2] / len) * JET_SPAWN_RADIUS + rand(-18, 18),
    );

    const ordinal = this.spawnOrdinal++;
    const tacticalRole: AiTacticalRole =
      kind === 'raptor' || kind === 'hornet'
        ? 'hunter'
        : kind === 'harrier'
          ? (ordinal % 2 === 0 ? 'hunter' : 'striker')
          : 'striker';

    const aim = this.ctx.player?.alive ? this.ctx.player.position : _v.set(0, 0, 0);
    const initialYaw = Math.atan2(aim.x - pos.x, aim.z - pos.z);
    const skill = clamp(0.45 + Math.max(0, wave - 6) * 0.06 + (kind === 'raptor' ? 0.16 : 0), 0.45, 0.95);

    const speaker = makeAirSpeaker(kind, false);
    let lastSalvoCallAt = -Infinity;
    let calledDamaged = false;
    const salvoReady = (): boolean => {
      const now = this.ctx.time?.elapsed ?? 0;
      if (now - lastSalvoCallAt < 4.5) return false;
      lastSalvoCallAt = now;
      return true;
    };

    const jet = new AiCombatJet(
      this.ctx,
      this.materials,
      kind,
      'enemy',
      pos,
      initialYaw,
      skill,
      {
        onGunShot: (from, dir, _team, damage, speed, heavy) => {
          this.spawnProjectile(from, dir, damage, speed, false, false, !!heavy, null);
        },
        onMissileLaunch: (from, dir, _team, _targetPos, _targetJet, damage) => {
          const targetPeer = this.pickAirborneGuestPeerId();
          this.spawnProjectile(from, dir, damage, 148, true, false, false, targetPeer);
          this.ctx.audio?.play?.('aircraft_missile_fire', { position: from, volume: 0.72, pitch: 1.02 });
          sayAir(this.ctx, 'airDogfight', speaker, { fox2: true });
          if (this.missileWarnCd <= 0) {
            this.missileWarnCd = 4.0;
            this.ctx.hud?.feed?.('MISSILE ALERT — ENEMY JET FOX-2 INBOUND!', '#ff3864');
          }
        },
        onBombDrop: (from, initVel, bombKind, damage, attackerName) => {
          this.wreckage.spawnBomb(from, initVel, bombKind, damage, attackerName);
          if (salvoReady()) sayAir(this.ctx, 'airStrike', speaker, { bombsAway: true });
        },
        onCarrierRocket: (from, dir, damage) => {
          this.spawnProjectile(from, dir, damage, 134, false, true, false, null);
          this.ctx.audio?.play?.('rocket_fire', { position: from, volume: 0.5, pitch: rand(1.0, 1.15) });
          if (salvoReady()) sayAir(this.ctx, 'airStrike', speaker, { rockets: true });
        },
        onCarrierGunStrafe: (from, dir, damage, _attackerName, heavy) => {
          this.spawnProjectile(from, dir, damage, heavy ? 245 : 220, false, false, heavy, null);
          if (salvoReady()) sayAir(this.ctx, 'airStrike', speaker, { brrrt: kind === 'warthog', strafe: true });
          if (heavy || Math.random() < 0.35) {
            this.ctx.audio?.play?.('gunship_gun', {
              position: from,
              volume: heavy ? 0.58 : 0.32,
              pitch: heavy ? rand(0.68, 0.8) : rand(1.05, 1.22),
            });
          }
        },
        onCarrierStrike: (_from, hitPt, damage, _attackerName, heavyBomb) => {
          this.detonateDesertOrdnance(hitPt, damage, heavyBomb ? 13 : 8.5, heavyBomb ? 'shell' : 'rocket');
        },
        onStateChange: (_j, next) => {
          if (next === 'carrier_run') sayAir(this.ctx, 'airStrike', speaker, { attackRun: true });
          else if (next === 'dogfight') sayAir(this.ctx, 'airDogfight', speaker, { engaged: true });
          else if (next === 'evade') sayAir(this.ctx, 'airEvade', speaker, { breaking: true });
        },
        onFlare: () => {
          sayAir(this.ctx, 'airEvade', speaker, { flares: true });
        },
        onLockBroken: () => {
          sayAir(this.ctx, 'airDogfight', speaker, { lockLost: true });
        },
        onDamaged: (_j, ratio) => {
          if (!calledDamaged && ratio < 0.45) {
            calledDamaged = true;
            sayAir(this.ctx, 'airEvade', speaker, { damaged: true });
          }
        },
        onKilled: (killedJet, source, heavyKill) => {
          if (!cutAir(this.ctx, speaker)) {
            sayAir(this.ctx, 'airDown', speaker, { eject: !heavyKill }, true);
          }
          this.manager.vehicles?.removeExtra?.(killedJet);
          this.ctx.progression?.award?.(killedJet.profile.rewardScore, `${killedJet.name} SPLASHED`, killedJet.position);
          this.ctx.hud?.feed?.(`SPLASH ONE! ${killedJet.name} DOWN`, '#ffd166');
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
            !!heavyKill,
          );
          this.netBridge?.onJetKilled(killedJet, source, !!heavyKill);
        },
      },
      undefined,
      tacticalRole,
      BADLANDS_JET_THEATER,
    );

    this.enemies.push(jet);
    this.manager.vehicles?.addExtra?.(jet);
    this.ctx.audio?.play?.('wave_start_hard', { position: pos, volume: 0.45, pitch: 1.18 });
    sayAir(this.ctx, 'airInbound', speaker, { cas: true });
    return jet;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    if (this.missileWarnCd > 0) this.missileWarnCd = Math.max(0, this.missileWarnCd - dt);
    if (this.playerFlareWindow > 0) this.playerFlareWindow = Math.max(0, this.playerFlareWindow - dt);

    const player = this.ctx.player;
    const playerPos = player.position;
    if (this.hasPrevPlayerPos && dt > 1e-4) {
      this.playerVel.subVectors(playerPos, this.prevPlayerPos).divideScalar(dt);
      const spd = this.playerVel.length();
      if (spd > 160) this.playerVel.multiplyScalar(160 / spd);
    } else {
      this.playerVel.set(0, 0, 0);
    }
    this.prevPlayerPos.copy(playerPos);
    this.hasPrevPlayerPos = true;

    const playerAirborne = player.alive && playerPos.y > 14;
    const playerCountermeasures = this.playerFlareWindow > 0;

    // Update all live enemy jets and prune destroyed ones.
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const jet = this.enemies[i]!;
      if (!jet.alive || jet.disposed) {
        this.manager.vehicles?.removeExtra?.(jet);
        this.enemies.splice(i, 1);
        continue;
      }
      jet.update(dt, playerPos, this.playerVel, playerAirborne, this.allies, playerCountermeasures);
    }

    this.tickProjectiles(dt, playerPos, playerCountermeasures);
    this.wreckage.update(dt);
    this.emitRwr(player.alive && (player.parked || playerAirborne));
  }

  private spawnProjectile(
    from: THREE.Vector3,
    dir: THREE.Vector3,
    damage: number,
    speed: number,
    homing: boolean,
    rocket: boolean,
    heavyTracer: boolean,
    targetPeerId: string | null,
  ): void {
    if (this.projectiles.length >= MAX_PROJECTILES) {
      this.projectiles.shift();
    }
    this.projectiles.push({
      pos: from.clone(),
      lastTrail: from.clone(),
      vel: dir.clone().normalize().multiplyScalar(speed),
      damage,
      speed,
      homing,
      rocket,
      heavyTracer,
      life: homing ? 7.5 : rocket ? 4.8 : 2.6,
      targetPeerId,
      decoyed: false,
      smokeCd: 0,
    });
  }

  private tickProjectiles(dt: number, playerPos: THREE.Vector3, playerCountermeasures: boolean): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]!;
      p.life -= dt;
      if (p.life <= 0) {
        this.projectiles.splice(i, 1);
        continue;
      }

      if (p.homing) {
        if (playerCountermeasures) p.decoyed = true;
        if (!p.decoyed) {
          _v.subVectors(playerPos, p.pos);
          if (_v.lengthSq() > 1) {
            _v.normalize();
            const curDir = p.vel.clone().normalize();
            curDir.lerp(_v, clamp(dt * 3.8, 0, 1)).normalize();
            p.vel.copy(curDir).multiplyScalar(p.speed);
          }
        } else {
          p.vel.y -= 16 * dt;
        }
      } else if (p.rocket) {
        p.vel.y -= 4.5 * dt;
      }

      _prev.copy(p.pos);
      p.pos.addScaledVector(p.vel, dt);

      // Draw crisp tracers & distance-interpolated volumetric rocket/missile smoke trails!
      if (p.homing) {
        const dist = p.pos.distanceTo(p.lastTrail);
        if (dist >= 4.2) {
          const steps = Math.min(6, Math.floor(dist / 4.2));
          for (let s = 1; s <= steps; s++) {
            _trailPt.lerpVectors(p.lastTrail, p.pos, s / steps);
            this.ctx.fx?.smoke?.(_trailPt, 0xdcd6ce, 1.32, 2.45);
          }
          p.lastTrail.copy(p.pos);
        }
        p.smokeCd -= dt;
        if (p.smokeCd <= 0) {
          p.smokeCd = 0.032;
          this.ctx.fx?.smoke?.(p.pos, 0xffaa44, 0.42, 0.22);
          _back.copy(p.vel).normalize().negate();
          this.ctx.fx?.sparks?.(p.pos, _back, 2, 0xffd27a);
        }
        this.ctx.fx?.tracer?.(_prev, p.pos, 'heavy');
      } else if (p.rocket) {
        const dist = p.pos.distanceTo(p.lastTrail);
        if (dist >= 5.5) {
          const steps = Math.min(4, Math.floor(dist / 5.5));
          for (let s = 1; s <= steps; s++) {
            _trailPt.lerpVectors(p.lastTrail, p.pos, s / steps);
            this.ctx.fx?.smoke?.(_trailPt, 0xc8c2b8, 1.24, 1.35);
          }
          p.lastTrail.copy(p.pos);
        }
        p.smokeCd -= dt;
        if (p.smokeCd <= 0) {
          p.smokeCd = 0.04;
          _back.copy(p.vel).normalize().negate();
          this.ctx.fx?.sparks?.(p.pos, _back, 2, 0xffaa55);
        }
        this.ctx.fx?.tracer?.(_prev, p.pos, 'heavy');
      } else {
        this.ctx.fx?.tracer?.(_prev, p.pos, p.heavyTracer ? 'heavy' : 'bullet');
      }

      // 1. Check hit on local player or occupied vehicle!
      const hitRadius = p.homing ? 7.5 : p.rocket ? 5.5 : 4.2;
      if (this.ctx.player.alive && p.pos.distanceToSquared(playerPos) <= hitRadius * hitRadius) {
        if (p.homing || p.rocket) {
          this.detonateDesertOrdnance(p.pos, p.damage, p.homing ? 9.5 : 7.5, 'rocket');
        } else {
          this.damageLocalPlayer(p.damage, _prev, 'enemy_jet_gun', 'bullet');
        }
        this.projectiles.splice(i, 1);
        continue;
      }

      // 2. Check hit on co-op guests (host only)!
      if (this.checkGuestHit(p, hitRadius)) {
        this.projectiles.splice(i, 1);
        continue;
      }

      // 3. Desert floor impact!
      if (p.pos.y <= 0.4) {
        p.pos.y = 0.45;
        if (p.homing || p.rocket) {
          this.detonateDesertOrdnance(p.pos, p.damage, p.homing ? 9.5 : 7.5, 'rocket');
        } else {
          this.ctx.fx?.sparks?.(p.pos, _up, p.heavyTracer ? 8 : 4, p.heavyTracer ? 0xff9933 : 0xd8be94);
          if (p.heavyTracer && Math.random() < 0.35) {
            this.ctx.fx?.explosion?.(p.pos, { radius: 3.5, scale: 0.55 });
          }
        }
        this.projectiles.splice(i, 1);
      }
    }
  }

  private damageLocalPlayer(amount: number, from: THREE.Vector3, source: string, type: 'bullet' | 'explosive'): void {
    const player = this.ctx.player;
    if (!player.alive) return;
    if (player.parked) {
      this.ctx.events?.emit?.('dogfight:damage_player_jet', {
        amount,
        from: from.clone(),
        heavy: type === 'explosive',
      });
    } else {
      player.takeDamage?.({ amount, type, from: from.clone(), source });
    }
  }

  private detonateDesertOrdnance(center: THREE.Vector3, damage: number, radius: number, kind: 'shell' | 'rocket'): void {
    const combat = this.ctx.combat;
    if (combat?.explode) {
      combat.explode(center, {
        kind,
        radius,
        damage,
        team: 'enemy',
        source: 'enemy_rocket',
        selfDamage: 0.55,
      });
    } else {
      this.ctx.fx?.explosion?.(center, { radius, scale: kind === 'shell' ? 1.9 : 1.25 });
      const dist = this.ctx.player.position.distanceTo(center);
      if (dist <= radius) {
        const falloff = clamp(1 - (dist / radius) * 0.65, 0.3, 1);
        this.damageLocalPlayer(Math.round(damage * 0.55 * falloff), center, 'enemy_rocket', 'explosive');
      }
    }

    // Also hurt the player's occupied vehicle if caught in the desert blast!
    if (this.ctx.player.alive && this.ctx.player.parked) {
      const dist = this.ctx.player.position.distanceTo(center);
      if (dist <= radius + 2.5) {
        const falloff = clamp(1 - (dist / (radius + 2.5)) * 0.6, 0.35, 1);
        this.ctx.events?.emit?.('dogfight:damage_player_jet', {
          amount: Math.round(damage * 0.65 * falloff),
          from: center.clone(),
          heavy: true,
        });
      }
    }
  }

  private pickAirborneGuestPeerId(): string | null {
    const coop = this.ctx.coop;
    if (!coop?.hosting) return null;
    for (const p of coop.lobby.players) {
      if (p.host) continue;
      const remote = coop.remotes.get(p.id);
      if (remote && remote.char.root.position.y > 14) return p.id;
    }
    return null;
  }

  private checkGuestHit(p: JetProjectile, hitRadius: number): boolean {
    const coop = this.ctx.coop;
    if (!coop?.hosting || !this.netBridge) return false;
    const rSq = hitRadius * hitRadius;
    for (const member of coop.lobby.players) {
      if (member.host) continue;
      const remote = coop.remotes.get(member.id);
      if (!remote) continue;
      if (p.pos.distanceToSquared(remote.char.root.position) <= rSq) {
        this.netBridge.onGuestDamage(member.id, p.damage, _prev);
        if (p.homing || p.rocket) {
          this.ctx.fx?.explosion?.(p.pos, { radius: 8, scale: 1.3 });
        }
        return true;
      }
    }
    return false;
  }

  private emitRwr(eligible: boolean): void {
    if (!eligible || this.enemies.length === 0) {
      if (this.rwrActive) {
        this.rwrActive = false;
        this.ctx.events?.emit?.('dogfight:rwr', {
          locking: false,
          lockStrength: 0,
          missileInbound: false,
          label: '',
        });
      }
      return;
    }

    let maxLock = 0;
    let label = '';
    for (const j of this.enemies) {
      if (j.alive && j.playerLockProgress > maxLock) {
        maxLock = j.playerLockProgress;
        label = j.name;
      }
    }
    let missileInbound = false;
    for (const p of this.projectiles) {
      if (p.homing && !p.decoyed && !p.targetPeerId) {
        missileInbound = true;
        break;
      }
    }
    const locking = maxLock > 0.08;
    if (locking || missileInbound || this.rwrActive) {
      this.rwrActive = locking || missileInbound;
      this.ctx.events?.emit?.('dogfight:rwr', {
        locking,
        lockStrength: maxLock,
        missileInbound,
        label: missileInbound ? 'FOX-2 INBOUND' : label,
      });
    }
  }

  reset(): void {
    for (const jet of this.enemies) {
      this.manager.vehicles?.removeExtra?.(jet);
      jet.dispose();
    }
    this.enemies.length = 0;
    this.projectiles.length = 0;
    this.wreckage.reset();
    this.hasPrevPlayerPos = false;
    this.playerFlareWindow = 0;
    this.missileWarnCd = 0;
    this.spawnOrdinal = 0;
    if (this.rwrActive) {
      this.rwrActive = false;
      this.ctx.events?.emit?.('dogfight:rwr', {
        locking: false,
        lockStrength: 0,
        missileInbound: false,
        label: '',
      });
    }
  }

  dispose(): void {
    this.reset();
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.wreckage.dispose();
    this.netBridge = null;
  }
}
