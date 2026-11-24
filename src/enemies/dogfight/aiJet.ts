/**
 * Skilled AI Combat Jet (`AiCombatJet`) for Dogfight mode.
 *
 * Flies our real 3D PBR aircraft models (`hornet`, `harrier`, `warthog`, `lancer`, `raptor`) with
 * smooth banking aerobatic flight physics, retractable landing gear, dynamic Lancer swing-wings,
 * Raptor thrust-vectoring nozzles, afterburner plumes, IR countermeasure flares, and a tactical
 * dogfighting state machine:
 *   - `approach`     — Inbound from outer ocean sky toward USS Sovereign
 *   - `carrier_run`  — Diving strafe / rocket / bomb attack run against the Aircraft Carrier
 *   - `dogfight`     — High-G lead-pursuit air-to-air dogfight against the player (or enemy jets)
 *   - `evade`        — Break turn + IR flare countermeasure when damaged or hunted on its six
 *   - `extend`       — Climbing separation & Immelmann energy recovery before looping back in
 *   - `dying`        — Flaming spiral-down crash into the ocean with splashdown detonation
 *
 * Implements `ExtraTarget` & `MissileTarget` so player Vulcan/GAU-8 cannons, AIM-9X/AIM-120D
 * homing missiles, flak shells, blasts, AA Lead-Computing Pips, and thermal highlights all work
 * out of the box with zero special-casing!
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Ctx, ExplosionKind } from '../../core/contracts';
import type { ExplosionSpec, MissileTarget, VehicleRadarTarget } from '../../core/gameplay';
import { clamp, damp, rand } from '../../core/math';
import type { ModelMaterials } from '../../progression/modelkit';
import { buildVehicleModel, type VehicleModelRig } from '../../vehicles/drive/models';
import { EXPLOSIONS } from '../../weapons/data';
import { CARRIER_CENTER, CARRIER_DECK_Y, DOGFIGHT_BOUNDS } from '../../world/map/dogfight/plan';
import type { ExtraTarget } from '../vehicles';
import type { BombKind } from './wreckage';

export type AiJetKind = 'hornet' | 'harrier' | 'warthog' | 'lancer' | 'raptor';
export type AiJetTeam = 'enemy' | 'ally';
export type AiJetRole = 'fighter' | 'striker' | 'bomber' | 'ace' | 'wingman';
export type AiJetDoctrine = 'heavy_bomber' | 'cas_attacker' | 'rocket_striker' | 'air_superiority' | 'ace_interceptor';
export type AiJetState = 'approach' | 'carrier_run' | 'dogfight' | 'evade' | 'extend' | 'dying';
export type AiTacticalRole = 'hunter' | 'striker';

export interface AiJetProfile {
  readonly kind: AiJetKind;
  readonly name: string;
  readonly role: AiJetRole;
  readonly doctrine: AiJetDoctrine;
  readonly maxHp: number;
  readonly cruiseSpeed: number;
  readonly boostSpeed: number;
  readonly turnRate: number;
  readonly pitchRate: number;
  readonly maxBank: number;
  readonly preferredAlt: number;
  readonly hitboxHalf: readonly [number, number, number];
  readonly hasGun: boolean;
  readonly gunDamage: number;
  readonly gunRange: number;
  readonly carrierStrikeDamage: number;
  readonly hasMissiles: boolean;
  readonly missileCooldown: number;
  readonly flareCooldown: number;
  readonly rewardCredits: number;
  readonly rewardScore: number;
}

export const AI_JET_PROFILES: Record<AiJetKind, AiJetProfile> = {
  hornet: {
    kind: 'hornet',
    name: 'F/A-18E HORNET',
    role: 'fighter',
    doctrine: 'air_superiority',
    maxHp: 340,
    cruiseSpeed: 58,
    boostSpeed: 86,
    turnRate: 1.65,
    pitchRate: 1.58,
    maxBank: 1.22,
    preferredAlt: 82,
    hitboxHalf: [5.4, 2.2, 6.2],
    hasGun: true,
    gunDamage: 12,
    gunRange: 215,
    carrierStrikeDamage: 75,
    hasMissiles: true,
    missileCooldown: 8.5,
    flareCooldown: 9.0,
    rewardCredits: 140,
    rewardScore: 450,
  },
  harrier: {
    kind: 'harrier',
    name: 'AV-8B HARRIER',
    role: 'striker',
    doctrine: 'rocket_striker',
    maxHp: 300,
    cruiseSpeed: 52,
    boostSpeed: 74,
    turnRate: 1.78,
    pitchRate: 1.68,
    maxBank: 1.16,
    preferredAlt: 68,
    hitboxHalf: [4.8, 2.1, 5.6],
    hasGun: true,
    gunDamage: 13,
    gunRange: 195,
    carrierStrikeDamage: 95,
    hasMissiles: true,
    missileCooldown: 10.5,
    flareCooldown: 10.0,
    rewardCredits: 130,
    rewardScore: 400,
  },
  warthog: {
    kind: 'warthog',
    name: 'A-10 WARTHOG',
    role: 'striker',
    doctrine: 'cas_attacker',
    maxHp: 520,
    cruiseSpeed: 46,
    boostSpeed: 64,
    turnRate: 1.38,
    pitchRate: 1.30,
    maxBank: 0.98,
    preferredAlt: 56,
    hitboxHalf: [6.4, 2.3, 6.0],
    hasGun: true,
    gunDamage: 20,
    gunRange: 205,
    carrierStrikeDamage: 155,
    hasMissiles: false,
    missileCooldown: 16,
    flareCooldown: 10.5,
    rewardCredits: 175,
    rewardScore: 550,
  },
  lancer: {
    kind: 'lancer',
    name: 'B-1 LANCER',
    role: 'bomber',
    doctrine: 'heavy_bomber',
    maxHp: 680,
    cruiseSpeed: 66,
    boostSpeed: 98,
    turnRate: 1.02,
    pitchRate: 1.05,
    maxBank: 0.88,
    preferredAlt: 96,
    hitboxHalf: [8.2, 2.6, 9.8],
    hasGun: false,
    gunDamage: 0,
    gunRange: 0,
    carrierStrikeDamage: 280,
    hasMissiles: false,
    missileCooldown: 20,
    flareCooldown: 8.5,
    rewardCredits: 240,
    rewardScore: 750,
  },
  raptor: {
    kind: 'raptor',
    name: 'F-22 RAPTOR ACE',
    role: 'ace',
    doctrine: 'ace_interceptor',
    maxHp: 540,
    cruiseSpeed: 68,
    boostSpeed: 104,
    turnRate: 2.15,
    pitchRate: 2.02,
    maxBank: 1.36,
    preferredAlt: 108,
    hitboxHalf: [5.8, 2.3, 6.8],
    hasGun: true,
    gunDamage: 16,
    gunRange: 245,
    carrierStrikeDamage: 105,
    hasMissiles: true,
    missileCooldown: 6.5,
    flareCooldown: 6.2,
    rewardCredits: 300,
    rewardScore: 1000,
  },
};

export interface AiJetFireCallbacks {
  onGunShot(from: THREE.Vector3, dir: THREE.Vector3, team: AiJetTeam, damage: number, speed: number, heavy?: boolean): void;
  onMissileLaunch(from: THREE.Vector3, dir: THREE.Vector3, team: AiJetTeam, targetPos: THREE.Vector3, targetJet: AiCombatJet | null, damage: number): void;
  onCarrierStrike(from: THREE.Vector3, hitPoint: THREE.Vector3, damage: number, attackerName: string, heavyBomb: boolean): void;
  onBombDrop?(from: THREE.Vector3, initVel: THREE.Vector3, kind: BombKind, damage: number, attackerName: string): void;
  onCarrierRocket?(from: THREE.Vector3, dir: THREE.Vector3, damage: number, attackerName: string): void;
  onCarrierGunStrafe?(from: THREE.Vector3, dir: THREE.Vector3, damage: number, attackerName: string, heavy: boolean): void;
  onKilled(jet: AiCombatJet, source: string, heavyKill?: boolean): void;
}

const MIN_FLIGHT_ALT = 22;
const MAX_FLIGHT_ALT = DOGFIGHT_BOUNDS.y1 - 24;
const BOUNDARY_TURN_R = 575;

let nextJetUid = 90_000;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _carrierPos = new THREE.Vector3(CARRIER_CENTER[0], CARRIER_CENTER[1], CARRIER_CENTER[2]);

/** Pure angle-wrap helper in [-PI, PI]. */
function wrapAngle(a: number): number {
  let r = a;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r < -Math.PI) r += Math.PI * 2;
  return r;
}

export class AiCombatJet implements ExtraTarget, MissileTarget {
  readonly uid = nextJetUid++;
  readonly profile: AiJetProfile;
  readonly kind: AiJetKind;
  readonly team: AiJetTeam;
  readonly tacticalRole: AiTacticalRole;
  readonly skill: number;
  readonly name: string;

  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly center = new THREE.Vector3();
  readonly aimLift = 0;
  readonly paintRadius = 8.2;

  yaw = 0;
  pitch = 0;
  roll = 0;
  speed: number;
  health: number;
  readonly maxHealth: number;
  alive = true;
  disposed = false;

  /** 0..1 active radar/IR lock progress on the player's aircraft (drives cockpit RWR warning tone & HUD!). */
  playerLockProgress = 0;
  private lockSuppressed = 0;
  private retaliateTimer = 0;

  state: AiJetState = 'approach';
  private stateTimer = 0;
  private gunCooldown = 0;
  private gunBurstLeft = 0;
  private missileCooldown: number;
  private flareCooldown = 0;
  private strikeCooldown = 0;
  private bombSalvoLeft = 0;
  private bombSalvoCd = 0;
  private strafeBurstLeft = 0;
  private strafeBurstCd = 0;
  private rocketSalvoLeft = 0;
  private rocketSalvoCd = 0;
  private carrierPassCount = 0;
  private smokeTimer = 0;
  private evadeDir = 1;
  private orbitSide = 1;
  private wingSweep = 0;
  private afterburning = false;
  private unmark: (() => void) | null = null;
  private readonly markerPos = new THREE.Vector3();

  private readonly rig: VehicleModelRig;
  private collider: RAPIER.Collider | null = null;
  private readonly teamBeacon: THREE.Mesh;

  constructor(
    private readonly ctx: Ctx,
    materials: ModelMaterials,
    kind: AiJetKind,
    team: AiJetTeam,
    spawnPos: THREE.Vector3,
    initialYaw: number,
    skill: number,
    private readonly cb: AiJetFireCallbacks,
    customLabel?: string,
    tacticalRole?: AiTacticalRole,
  ) {
    this.kind = kind;
    this.team = team;
    this.profile = AI_JET_PROFILES[kind];
    this.tacticalRole = tacticalRole ?? (
      this.profile.role === 'ace' || this.profile.role === 'fighter'
        ? 'hunter'
        : this.profile.kind === 'harrier' && Math.random() < 0.5
          ? 'hunter'
          : 'striker'
    );
    this.skill = clamp(skill, 0.25, 1.0);
    this.name = customLabel ?? (team === 'ally' ? `WINGMAN ${this.profile.name}` : this.profile.name);

    // Slight HP scaling with skill on enemy fighters; wingmen are resilient escorts.
    this.maxHealth = Math.round(this.profile.maxHp * (team === 'ally' ? 1.8 : 0.88 + this.skill * 0.28));
    this.health = this.maxHealth;
    this.speed = this.profile.cruiseSpeed;
    this.yaw = initialYaw;
    this.position.copy(spawnPos);
    this.center.copy(spawnPos);
    this.velocity.set(Math.sin(initialYaw) * this.speed, 0, Math.cos(initialYaw) * this.speed);
    this.missileCooldown = rand(4.5, this.profile.missileCooldown);
    this.orbitSide = Math.random() < 0.5 ? -1 : 1;
    this.evadeDir = this.orbitSide;

    // Build our real PBR 3D jet rig and configure it for flight!
    this.rig = buildVehicleModel(kind, materials);
    if (this.rig.landingGear) this.rig.landingGear.visible = false;
    if (this.rig.resupplyRing) this.rig.resupplyRing.visible = false;
    for (const r of this.rig.riders) r.root.visible = true;

    // Add crisp glowing IFF identification wingtip/dorsal strobe so enemy vs friendly jets read instantly in the sky!
    const beaconColor = team === 'enemy' ? 0xff3b2f : 0x38e8ff;
    const beaconMat = new THREE.MeshBasicMaterial({ color: beaconColor });
    this.teamBeacon = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), beaconMat);
    this.teamBeacon.position.set(0, 1.85, -1.2);
    this.rig.body.add(this.teamBeacon);

    // Tint afterburners slightly warmer/redder on enemies, bright cyan-amber on allies.
    for (const g of this.rig.boostGlow) {
      g.visible = true;
    }

    this.rig.root.position.copy(this.position);
    this.rig.root.rotation.set(0, this.yaw, 0, 'YXZ');
    ctx.render.scene.add(this.rig.root);

    // Create Rapier static collider box moved every frame for bullets, missiles, and AA shells.
    if (team === 'enemy' && ctx.physics?.addStaticBox) {
      const [hx, hy, hz] = this.profile.hitboxHalf;
      this.collider = ctx.physics.addStaticBox(
        this.position,
        _v.set(hx, hy, hz),
        null,
        'metal',
      );
    }

    // Track jet with a sleek HUD world indicator (red bandit diamond or cyan wingman tag).
    this.markerPos.copy(this.position);
    const tagText = team === 'ally'
      ? `ALLY · ${kind === 'raptor' ? 'RAPTOR' : 'HORNET'}`
      : kind === 'raptor'
        ? 'ACE · RAPTOR'
        : kind === 'lancer'
          ? 'BOMBER · LANCER'
          : this.profile.name;
    const tagColor = team === 'ally' ? '#38e8ff' : kind === 'raptor' ? '#ff3864' : kind === 'lancer' ? '#ff9f1c' : '#ff4d3d';
    this.unmark = ctx.hud?.follow?.(this.markerPos, tagText, tagColor) ?? null;
  }

  // -------------------------------------------------------------------------------------------
  // ExtraTarget implementation (player guns, missiles, flak, AA Lead Pips)
  // -------------------------------------------------------------------------------------------

  shot(collider: RAPIER.Collider, point: THREE.Vector3, amount: number, source: string): boolean {
    if (!this.alive || !this.collider || collider.handle !== this.collider.handle) return false;
    this.applyDamage(amount, point, source, true, amount >= 95);
    return true;
  }

  direct(collider: RAPIER.Collider, point: THREE.Vector3, amount: number, _kind: ExplosionKind, source: string): boolean {
    if (!this.alive || !this.collider || collider.handle !== this.collider.handle) return false;
    this.applyDamage(amount * 1.15, point, source, true, true);
    return true;
  }

  blast(center: THREE.Vector3, spec: ExplosionSpec): number {
    if (!this.alive || this.team !== 'enemy') return 0;
    const dist = this.position.distanceTo(center);
    const reach = spec.radius + Math.max(this.profile.hitboxHalf[0], this.profile.hitboxHalf[2]) * 0.65;
    if (dist > reach) return 0;
    const def = EXPLOSIONS[spec.kind];
    const falloff = clamp(1 - (dist / Math.max(1, reach)) * (1 - def.edgeDamage), 0.2, 1);
    const dmg = spec.instakill ? Infinity : spec.damage * falloff;
    this.applyDamage(dmg, this.position, spec.source, spec.team === 'player', true);
    return 1;
  }

  paintable(out: MissileTarget[]): void {
    if (this.alive && this.team === 'enemy') out.push(this);
  }

  radarTargets(out: VehicleRadarTarget[]): void {
    if (!this.alive || this.team !== 'enemy') return;
    out.push({
      id: this.uid,
      kind: 'chopper',
      label: this.name,
      position: this.center.clone(),
      velocity: this.velocity.clone(),
      airborne: true,
    });
  }

  highlightMeshes(out: THREE.Object3D[]): void {
    if (this.alive && this.team === 'enemy') out.push(...this.rig.meshes);
  }

  /** Applies damage from player, CIWS, SAMs, or allied wingmen. */
  applyDamage(
    amount: number,
    point: THREE.Vector3,
    source: string,
    showPlayerMarker: boolean,
    heavyHit = false,
  ): void {
    if (!this.alive || amount <= 0) return;
    this.health -= amount;
    this.ctx.fx?.sparks?.(point, _v.set(0, 1, 0), 10, 0xffaa33);

    const killed = this.health <= 0;
    if (showPlayerMarker) {
      this.ctx.hud?.hitMarker?.(killed ? 'kill' : 'body');
      this.ctx.audio?.play?.(killed ? 'hit_marker_kill' : 'hit_marker');
    }

    if (killed) {
      const overkill = heavyHit || amount >= 140 || this.health <= -120;
      this.shatterAndDie(source, overkill);
      return;
    }

    // Skilled enemy pilots react to taking hits by popping IR flares and executing a high-G break turn!
    // Fighters/strikers switch into retaliation dogfight; B-1 Lancers stay pure bombers and evade at Mach speed.
    if (this.team === 'enemy') {
      if (showPlayerMarker && this.profile.doctrine !== 'heavy_bomber') {
        this.retaliateTimer = this.profile.doctrine === 'cas_attacker' ? 7 : 14;
      }
      if (this.state !== 'evade' && Math.random() < 0.35 + this.skill * 0.45) {
        this.triggerEvade();
      }
    }
  }

  /** True when this bandit is actively painting the player's jet with radar/IR missile lock. */
  get isLockingPlayer(): boolean {
    return this.alive && this.team === 'enemy' && this.playerLockProgress > 0.08;
  }

  /** Called when the player pops IR flares / smoke to break this bandit's radar/IR lock immediately. */
  breakPlayerLock(suppressSeconds = 3.8): void {
    this.playerLockProgress = 0;
    this.lockSuppressed = Math.max(this.lockSuppressed, suppressSeconds);
  }

  private triggerEvade(): void {
    this.state = 'evade';
    this.stateTimer = rand(1.9, 3.0);
    this.evadeDir = Math.random() < 0.5 ? -1 : 1;
    this.playerLockProgress = 0;
    this.bombSalvoLeft = 0;
    this.strafeBurstLeft = 0;
    this.rocketSalvoLeft = 0;
    if (this.flareCooldown <= 0) {
      this.popFlares();
      this.flareCooldown = this.profile.flareCooldown * (1.25 - this.skill * 0.35);
    }
  }

  private popFlares(): void {
    for (let i = 0; i < 4; i++) {
      _v.copy(this.position).addScaledVector(this.velocity, -0.04 * (i + 1));
      _v.x += rand(-2.5, 2.5);
      _v.y += rand(-1.5, 0.5);
      _v.z += rand(-2.5, 2.5);
      this.ctx.fx?.sparks?.(_v, _v2.set(rand(-1, 1), -1, rand(-1, 1)), 12, 0xfff0aa);
    }
    this.ctx.audio?.play?.('veh_flare_pop', { position: this.position, volume: 0.45, pitch: 1.1 });
  }

  /** Blows the jet apart immediately (callback spawns 7 tumbling physics chunks + pilot ejection/ragdoll/gibs!). */
  private shatterAndDie(source: string, heavyKill: boolean): void {
    if (!this.alive) return;
    this.alive = false;
    this.health = 0;
    this.playerLockProgress = 0;
    this.state = 'dying';
    this.bombSalvoLeft = 0;
    this.strafeBurstLeft = 0;
    this.rocketSalvoLeft = 0;

    // Notify wave director FIRST while position, velocity, yaw, pitch, roll are intact so multi-piece
    // wreckage & pilot ejection inherit the exact flight vector!
    this.cb.onKilled(this, source, heavyKill);

    // Immediately remove intact hull & collider so the shattered physical chunks replace the plane!
    this.dispose();
  }

  // -------------------------------------------------------------------------------------------
  // Per-frame Skilled AI Flight & Combat Update
  // -------------------------------------------------------------------------------------------

  update(
    dt: number,
    playerPos: THREE.Vector3,
    playerVel: THREE.Vector3,
    playerAirborne: boolean,
    opponents: readonly AiCombatJet[],
    playerCountermeasures = false,
  ): void {
    if (this.disposed || !this.alive) return;

    this.stateTimer = Math.max(0, this.stateTimer - dt);
    this.gunCooldown = Math.max(0, this.gunCooldown - dt);
    this.missileCooldown = Math.max(0, this.missileCooldown - dt);
    this.flareCooldown = Math.max(0, this.flareCooldown - dt);
    this.strikeCooldown = Math.max(0, this.strikeCooldown - dt);
    this.lockSuppressed = Math.max(0, this.lockSuppressed - dt);
    this.retaliateTimer = Math.max(0, this.retaliateTimer - dt);
    if (playerCountermeasures) {
      this.playerLockProgress = 0;
    }

    if (this.team === 'ally') {
      this.updateWingmanAi(dt, opponents);
    } else {
      this.updateEnemyAi(dt, playerPos, playerVel, playerAirborne, playerCountermeasures);
    }

    // Visual smoke trail when damaged below 48% HP.
    const hpFrac = this.health / this.maxHealth;
    if (hpFrac < 0.48) {
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0) {
        this.smokeTimer = hpFrac < 0.25 ? 0.06 : 0.13;
        this.ctx.fx?.sparks?.(this.position, _v.set(0, 1, 0), 3, hpFrac < 0.25 ? 0xff5522 : 0x555c66);
      }
    }

    this.syncModelAndCollider(dt);
  }

  private updateEnemyAi(
    dt: number,
    playerPos: THREE.Vector3,
    playerVel: THREE.Vector3,
    playerAirborne: boolean,
    playerCountermeasures: boolean,
  ): void {
    const distCarrier = Math.hypot(this.position.x - _carrierPos.x, this.position.z - _carrierPos.z);
    const distPlayer = this.position.distanceTo(playerPos);
    const horizR = Math.hypot(this.position.x, this.position.z);
    const doctrine = this.profile.doctrine;

    // Distinct target preferences per aircraft class:
    // - B-1 Lancer (heavy_bomber): NEVER dogfights; pure high-altitude carrier carpet bomber!
    // - A-10 Warthog (cas_attacker): focuses relentlessly on carrier strafes/bombs; only briefly dogfights if attacked up close.
    // - Hornet / Raptor / Hunter Harrier: actively intercept & dogfight the airborne player across the whole sky!
    const wantsDogfight = playerAirborne && doctrine !== 'heavy_bomber' && (
      this.tacticalRole === 'hunter' ||
      (doctrine === 'cas_attacker' ? (this.retaliateTimer > 0 && distPlayer < 210) : (this.retaliateTimer > 0 || distPlayer < 210))
    );

    if (this.state === 'approach') {
      if (wantsDogfight) {
        this.state = 'dogfight';
        this.stateTimer = rand(10, 16);
      } else if (distCarrier < (doctrine === 'heavy_bomber' ? 320 : 260)) {
        this.state = 'carrier_run';
        this.stateTimer = rand(8, 12);
      }
    } else if (this.state === 'evade') {
      if (this.stateTimer <= 0) {
        this.state = wantsDogfight ? 'dogfight' : 'extend';
        this.stateTimer = wantsDogfight ? rand(9, 14) : rand(3.5, 5.5);
      }
    } else if (this.state === 'extend') {
      const extendDist = doctrine === 'heavy_bomber' ? 330 : 250;
      if (this.stateTimer <= 0 || (!wantsDogfight && distCarrier > extendDist)) {
        if (wantsDogfight) {
          this.state = 'dogfight';
          this.stateTimer = rand(10, 16);
        } else {
          this.state = 'carrier_run';
          this.stateTimer = rand(8, 12);
        }
      }
    } else if (this.state === 'carrier_run') {
      if (wantsDogfight && (this.tacticalRole === 'hunter' || this.retaliateTimer > 0 || (doctrine !== 'cas_attacker' && distPlayer < 175))) {
        this.state = 'dogfight';
        this.stateTimer = rand(10, 15);
      } else if (this.bombSalvoLeft <= 0 && this.strafeBurstLeft <= 0 && this.rocketSalvoLeft <= 0 && (distCarrier < 42 || this.stateTimer <= 0)) {
        this.state = 'extend';
        this.stateTimer = doctrine === 'heavy_bomber' ? rand(4.8, 6.8) : rand(3.5, 5.2);
        this.orbitSide = Math.random() < 0.5 ? -1 : 1;
      }
    } else if (this.state === 'dogfight') {
      if (!playerAirborne || doctrine === 'heavy_bomber') {
        this.state = 'carrier_run';
        this.stateTimer = rand(6, 9);
      } else if (distPlayer < 46) {
        this.state = 'extend';
        this.stateTimer = rand(2.2, 3.4);
        this.orbitSide = Math.random() < 0.5 ? -1 : 1;
      } else if (this.stateTimer <= 0 && this.tacticalRole === 'striker' && this.retaliateTimer <= 0) {
        this.state = 'carrier_run';
        this.stateTimer = rand(8, 11);
      }
    }

    // Continue any active bomb stick, GAU-8 BRRRT strafe burst, or Hydra rocket salvo!
    this.tickActiveCarrierSalvos(dt);

    // Choose 3D steering target point + airspeed tailored to aircraft doctrine!
    let targetSpeed = this.profile.cruiseSpeed;
    this.afterburning = false;

    if (horizR > BOUNDARY_TURN_R) {
      const anchor = playerAirborne && this.tacticalRole === 'hunter' ? playerPos : _carrierPos;
      _aim.set(anchor.x + this.orbitSide * 60, this.profile.preferredAlt, anchor.z);
      targetSpeed = this.profile.cruiseSpeed;
      this.playerLockProgress = Math.max(0, this.playerLockProgress - dt * 0.9);
    } else if (this.state === 'approach') {
      const anchor = wantsDogfight ? playerPos : _carrierPos;
      _aim.set(anchor.x + this.orbitSide * 28, this.profile.preferredAlt, anchor.z);
      targetSpeed = this.profile.boostSpeed * 0.94;
      this.afterburning = true;
      this.playerLockProgress = Math.max(0, this.playerLockProgress - dt * 0.8);
    } else if (this.state === 'carrier_run') {
      this.playerLockProgress = Math.max(0, this.playerLockProgress - dt * 0.8);

      if (doctrine === 'heavy_bomber') {
        // B-1 Lancer: flies level, high-altitude supersonic carpet-bombing corridor right over USS Sovereign!
        const bombAlt = CARRIER_DECK_Y + 76;
        _aim.set(_carrierPos.x, bombAlt, _carrierPos.z);
        targetSpeed = this.profile.cruiseSpeed * 1.12;
        this.afterburning = distCarrier > 150;

        // Compute realistic ballistic horizontal release lead distance so falling bombs land right on the flight deck!
        const hDrop = Math.max(18, this.position.y - CARRIER_DECK_Y);
        const tFall = Math.sqrt((2 * hDrop) / 26);
        const releaseLead = clamp(this.speed * tFall, 65, 195);
        if (this.strikeCooldown <= 0 && this.bombSalvoLeft <= 0 && distCarrier <= releaseLead + 32 && distCarrier >= Math.max(25, releaseLead - 75)) {
          this.forwardDir(_fwd);
          _v.set(_carrierPos.x - this.position.x, 0, _carrierPos.z - this.position.z).normalize();
          const horizDot = _fwd.x * _v.x + _fwd.z * _v.z;
          if (horizDot > 0.78) {
            this.beginCarrierOrdnancePass();
          }
        }
      } else if (doctrine === 'cas_attacker') {
        // A-10 Warthog: alternates low steep GAU-8 Avenger diving strafes and medium-altitude dive-bomb runs!
        const isBombPass = this.carrierPassCount % 2 === 1;
        const runAlt = isBombPass ? CARRIER_DECK_Y + 42 : CARRIER_DECK_Y + 22;
        _aim.set(_carrierPos.x + rand(-4, 4), runAlt, _carrierPos.z + rand(-14, 14));
        targetSpeed = isBombPass ? this.profile.cruiseSpeed * 1.05 : this.profile.cruiseSpeed * 0.92;
        this.afterburning = false;

        const maxRange = isBombPass ? 155 : 215;
        if (this.strikeCooldown <= 0 && this.bombSalvoLeft <= 0 && this.strafeBurstLeft <= 0 && distCarrier < maxRange && distCarrier > 36) {
          this.forwardDir(_fwd);
          _v.subVectors(_carrierPos, this.position).normalize();
          if (_fwd.dot(_v) > 0.76) {
            this.beginCarrierOrdnancePass();
          }
        }
      } else {
        // Harrier (Hydra rockets + 25mm), Hornet/Raptor (when player is grounded: fast strafe + rockets).
        const runAlt = CARRIER_DECK_Y + 28;
        _aim.set(_carrierPos.x + rand(-5, 5), runAlt, _carrierPos.z + rand(-16, 16));
        targetSpeed = this.profile.cruiseSpeed * 1.08;
        this.afterburning = false;

        if (this.strikeCooldown <= 0 && this.rocketSalvoLeft <= 0 && this.strafeBurstLeft <= 0 && distCarrier < 195 && distCarrier > 45) {
          this.forwardDir(_fwd);
          _v.subVectors(_carrierPos, this.position).normalize();
          if (_fwd.dot(_v) > 0.74) {
            this.beginCarrierOrdnancePass();
          }
        }
      }
    } else if (this.state === 'dogfight') {
      const leadT = clamp(distPlayer / 185, 0.14, 1.15) * (0.55 + this.skill * 0.45);
      _aim.copy(playerPos).addScaledVector(playerVel, leadT);
      _aim.y = clamp(_aim.y + 5, MIN_FLIGHT_ALT + 6, MAX_FLIGHT_ALT);
      targetSpeed = distPlayer > 160 ? this.profile.boostSpeed : this.profile.cruiseSpeed * (0.94 + this.skill * 0.22);
      this.afterburning = distPlayer > 160;

      this.tryAirToAirWeapons(dt, playerPos, playerVel, null, distPlayer, playerAirborne && !playerCountermeasures);
    } else if (this.state === 'evade') {
      const breakYaw = this.yaw + this.evadeDir * 1.45;
      _aim.set(
        this.position.x + Math.sin(breakYaw) * 130,
        clamp(this.position.y + 34, MIN_FLIGHT_ALT + 12, MAX_FLIGHT_ALT),
        this.position.z + Math.cos(breakYaw) * 130,
      );
      targetSpeed = this.profile.boostSpeed;
      this.afterburning = true;
      this.playerLockProgress = 0;
    } else {
      const awayFrom = wantsDogfight ? playerPos : _carrierPos;
      _v.subVectors(this.position, awayFrom);
      _v.y = 0;
      if (_v.lengthSq() < 1) _v.set(this.orbitSide, 0, -1);
      _v.normalize();
      _aim.set(
        this.position.x + _v.x * 160 + -_v.z * this.orbitSide * 85,
        clamp(this.profile.preferredAlt + 24, MIN_FLIGHT_ALT + 20, MAX_FLIGHT_ALT),
        this.position.z + _v.z * 160 + _v.x * this.orbitSide * 85,
      );
      targetSpeed = this.profile.boostSpeed * 0.96;
      this.afterburning = true;
      this.playerLockProgress = Math.max(0, this.playerLockProgress - dt * 1.1);
    }

    this.steerToward(_aim, targetSpeed, dt);
  }

  private beginCarrierOrdnancePass(): void {
    const doctrine = this.profile.doctrine;
    const passIdx = this.carrierPassCount++;

    if (doctrine === 'heavy_bomber') {
      // B-1 Lancer: 5-bomb carpet stick (mix of Mk-84 & parachute-retarded heavy bombs!). Never shoots guns!
      this.bombSalvoLeft = 5;
      this.bombSalvoCd = 0;
      this.strikeCooldown = 6.2;
      this.ctx.hud?.feed?.('B-1 LANCER BOMBS AWAY — CARPET SALVO OVER CARRIER!', '#ff9f1c');
      return;
    }

    if (doctrine === 'cas_attacker') {
      if (passIdx % 2 === 1) {
        // Warthog dive-bomb pass: 2 Mk-82 / cluster bombs!
        this.bombSalvoLeft = 2;
        this.bombSalvoCd = 0;
        this.strikeCooldown = 5.0;
      } else {
        // Warthog signature GAU-8 Avenger 30mm BRRRT diving strafe (9 heavy rounds)!
        this.strafeBurstLeft = 9;
        this.strafeBurstCd = 0;
        this.strikeCooldown = 4.6;
        this.ctx.audio?.play?.('gunship_gun', { position: this.position, volume: 0.85, pitch: 0.72 });
      }
      return;
    }

    if (doctrine === 'rocket_striker') {
      // AV-8B Harrier: 4-rocket Hydra barrage + 3 cannon rounds!
      this.rocketSalvoLeft = 4;
      this.rocketSalvoCd = 0;
      this.strafeBurstLeft = 3;
      this.strafeBurstCd = 0.28;
      this.strikeCooldown = 4.5;
      return;
    }

    // Fighters (Hornet/Raptor) on opportunistic carrier pass when player is grounded: 2 rockets + short gun burst.
    this.rocketSalvoLeft = 2;
    this.rocketSalvoCd = 0;
    this.strafeBurstLeft = 4;
    this.strafeBurstCd = 0.14;
    this.strikeCooldown = 4.2;
  }

  private tickActiveCarrierSalvos(dt: number): void {
    // 1. Staggered real gravity-driven bomb drops (Lancer carpet stick / Warthog dive bombs)
    if (this.bombSalvoLeft > 0) {
      this.bombSalvoCd -= dt;
      if (this.bombSalvoCd <= 0) {
        this.bombSalvoLeft--;
        this.bombSalvoCd = this.profile.doctrine === 'heavy_bomber' ? 0.24 : 0.28;
        const from = this.position.clone().add(new THREE.Vector3(rand(-1.8, 1.8), -2.4, rand(-1.8, 1.8)));

        // Calculate clean ballistic aim velocity toward carrier deck so bombs actually arc onto USS Sovereign!
        const targetDeck = new THREE.Vector3(rand(-12, 8), CARRIER_DECK_Y, rand(-44, 44));
        const hDrop = Math.max(12, from.y - CARRIER_DECK_Y);
        const isPara = this.profile.doctrine === 'heavy_bomber' && this.bombSalvoLeft % 2 === 1;
        const kind: BombKind = this.profile.doctrine === 'heavy_bomber'
          ? (isPara ? 'para' : 'mk84')
          : (this.bombSalvoLeft === 0 ? 'cluster' : 'mk82');

        const tFlight = isPara
          ? Math.max(1.2, hDrop / 15.5)
          : Math.max(0.85, Math.sqrt((2 * hDrop) / 26));
        const bombVel = new THREE.Vector3(
          clamp((targetDeck.x - from.x) / tFlight, -75, 75),
          -3.5,
          clamp((targetDeck.z - from.z) / tFlight, -75, 75),
        );
        // Blend slightly with real jet forward velocity for visual authenticity!
        bombVel.x = bombVel.x * 0.72 + this.velocity.x * 0.28;
        bombVel.z = bombVel.z * 0.72 + this.velocity.z * 0.28;

        const perBombDmg = Math.round(
          (this.profile.doctrine === 'heavy_bomber' ? 76 : 82) * (0.85 + this.skill * 0.28),
        );

        if (this.cb.onBombDrop) {
          this.cb.onBombDrop(from, bombVel, kind, perBombDmg, this.name);
        } else {
          this.cb.onCarrierStrike(from, targetDeck, perBombDmg, this.name, true);
        }
      }
    }

    // 2. Staggered Hydra unguided rocket salvos (Harrier / fighters on carrier attack)
    if (this.rocketSalvoLeft > 0) {
      this.rocketSalvoCd -= dt;
      if (this.rocketSalvoCd <= 0) {
        this.rocketSalvoLeft--;
        this.rocketSalvoCd = 0.16;
        this.forwardDir(_fwd);
        const targetDeck = new THREE.Vector3(rand(-13, 9), CARRIER_DECK_Y + 0.6, rand(-46, 46));
        const from = this.position.clone().addScaledVector(_fwd, 3.2);
        const dir = _v.subVectors(targetDeck, from).normalize();
        const rDmg = Math.round(32 * (0.85 + this.skill * 0.3));
        if (this.cb.onCarrierRocket) {
          this.cb.onCarrierRocket(from, dir.clone(), rDmg, this.name);
        } else {
          this.cb.onCarrierStrike(from, targetDeck, rDmg, this.name, false);
        }
      }
    }

    // 3. Rapid-fire cannon strafe bursts (A-10 Warthog 30mm GAU-8 BRRRT / fighter 20mm strafes)
    if (this.strafeBurstLeft > 0 && this.profile.hasGun) {
      this.strafeBurstCd -= dt;
      if (this.strafeBurstCd <= 0) {
        this.strafeBurstLeft--;
        const isGau8 = this.profile.doctrine === 'cas_attacker';
        this.strafeBurstCd = isGau8 ? 0.065 : 0.095;
        this.forwardDir(_fwd);
        const targetDeck = new THREE.Vector3(rand(-13, 9), CARRIER_DECK_Y + 0.5, rand(-44, 44));
        const from = this.position.clone().addScaledVector(_fwd, 4.5);
        const dir = _v.subVectors(targetDeck, from).normalize();
        const sDmg = Math.round((isGau8 ? 20 : 14) * (0.85 + this.skill * 0.28));
        if (this.cb.onCarrierGunStrafe) {
          this.cb.onCarrierGunStrafe(from, dir.clone(), sDmg, this.name, isGau8);
        } else {
          this.cb.onGunShot(from, dir.clone(), 'enemy', sDmg, 230, isGau8);
        }
      }
    }
  }

  private updateWingmanAi(dt: number, enemies: readonly AiCombatJet[]): void {
    let target: AiCombatJet | null = null;
    let bestD = Infinity;
    for (const e of enemies) {
      if (!e.alive || e.team !== 'enemy') continue;
      const d = this.position.distanceToSquared(e.position);
      if (d < bestD) {
        bestD = d;
        target = e;
      }
    }

    if (target) {
      const dist = Math.sqrt(bestD);
      const leadT = clamp(dist / 185, 0.14, 1.05);
      _aim.copy(target.position).addScaledVector(target.velocity, leadT);
      _aim.y = clamp(_aim.y + 4, MIN_FLIGHT_ALT + 8, MAX_FLIGHT_ALT);
      const targetSpeed = dist > 130 ? this.profile.boostSpeed : this.profile.cruiseSpeed * 1.10;
      this.afterburning = dist > 130;
      this.steerToward(_aim, targetSpeed, dt);
      this.tryAirToAirWeapons(dt, target.position, target.velocity, target, dist, false);
    } else {
      const patrolAngle = Math.atan2(this.position.x - _carrierPos.x, this.position.z - _carrierPos.z) + this.orbitSide * 0.55;
      _aim.set(
        _carrierPos.x + Math.sin(patrolAngle) * 165,
        this.profile.preferredAlt + 18,
        _carrierPos.z + Math.cos(patrolAngle) * 165,
      );
      this.afterburning = false;
      this.steerToward(_aim, this.profile.cruiseSpeed * 0.88, dt);
    }
  }

  private tryAirToAirWeapons(
    dt: number,
    targetPos: THREE.Vector3,
    targetVel: THREE.Vector3,
    targetJet: AiCombatJet | null,
    dist: number,
    lockingPlayer: boolean,
  ): void {
    this.forwardDir(_fwd);
    const leadT = clamp(dist / 235, 0.08, 0.85);
    _v.copy(targetPos).addScaledVector(targetVel, leadT).sub(this.position).normalize();
    const align = _fwd.dot(_v);

    // 1. Autocannon tracer burst (ONLY on aircraft equipped with guns — never B-1 Lancer!)
    if (this.profile.hasGun && dist < this.profile.gunRange && align > 0.90 && this.gunCooldown <= 0) {
      if (this.gunBurstLeft <= 0) this.gunBurstLeft = this.team === 'ally' ? 5 : Math.round(4 + this.skill * 4);
      const spread = this.team === 'ally' ? 0.022 : (1.1 - this.skill * 0.65) * 0.048;
      _v.x += rand(-spread, spread);
      _v.y += rand(-spread, spread);
      _v.z += rand(-spread, spread);
      _v.normalize();
      const dmg = this.team === 'ally' ? 30 : this.profile.gunDamage;
      const isHeavyGun = this.profile.doctrine === 'cas_attacker';
      this.cb.onGunShot(this.position.clone().addScaledVector(_fwd, 5.5), _v.clone(), this.team, dmg, 245, isHeavyGun);
      this.gunBurstLeft--;
      this.gunCooldown = this.gunBurstLeft > 0 ? (isHeavyGun ? 0.07 : 0.10) : rand(0.95, 1.9) * (1.2 - this.skill * 0.35);
    }

    // 2. Homing Air-to-Air Missile (Fox-2) with genuine radar/IR lock acquisition on the player!
    if (lockingPlayer && this.team === 'enemy') {
      const canAcquire = this.profile.hasMissiles &&
        this.missileCooldown <= 0 &&
        this.lockSuppressed <= 0 &&
        dist > 60 &&
        dist < 480 &&
        align > 0.80;

      if (canAcquire) {
        const lockRate = (this.profile.role === 'ace' ? 0.62 : 0.48) * (0.85 + this.skill * 0.30);
        this.playerLockProgress = Math.min(1, this.playerLockProgress + lockRate * dt);
        if (this.playerLockProgress >= 1) {
          this.playerLockProgress = 0;
          const mDmg = Math.round(95 + this.skill * 55);
          this.cb.onMissileLaunch(
            this.position.clone().addScaledVector(_fwd, 4.5),
            _fwd.clone(),
            this.team,
            targetPos.clone(),
            null,
            mDmg,
          );
          this.missileCooldown = this.profile.missileCooldown * (1.15 - this.skill * 0.25);
        }
      } else {
        this.playerLockProgress = Math.max(0, this.playerLockProgress - dt * 0.85);
      }
      return;
    }

    // Wingman AI missile launch against enemy aircraft!
    if (this.team === 'ally' && this.profile.hasMissiles && dist > 60 && dist < 420 && align > 0.82 && this.missileCooldown <= 0) {
      this.cb.onMissileLaunch(
        this.position.clone().addScaledVector(_fwd, 4.5),
        _fwd.clone(),
        this.team,
        targetPos.clone(),
        targetJet,
        155,
      );
      this.missileCooldown = this.profile.missileCooldown * 0.72;
    }
  }

  private steerToward(target: THREE.Vector3, targetSpeed: number, dt: number): void {
    const dx = target.x - this.position.x;
    const dy = target.y - this.position.y;
    const dz = target.z - this.position.z;
    const horiz = Math.max(0.01, Math.hypot(dx, dz));

    const desiredYaw = Math.atan2(dx, dz);
    const yawErr = wrapAngle(desiredYaw - this.yaw);
    const maxYawStep = this.profile.turnRate * (0.82 + this.skill * 0.35) * dt;
    const yawStep = clamp(yawErr, -maxYawStep, maxYawStep);
    this.yaw = wrapAngle(this.yaw + yawStep);

    const desiredNosePitch = clamp(Math.atan2(dy, horiz), -0.78, 0.72);
    const desiredPitch = -desiredNosePitch;
    const maxPitchStep = this.profile.pitchRate * dt;
    const pitchDiff = clamp(desiredPitch - this.pitch, -maxPitchStep, maxPitchStep);
    this.pitch = clamp(this.pitch + pitchDiff, -0.82, 0.78);

    const turnRateActual = dt > 0.0001 ? yawStep / dt : 0;
    const targetRoll = clamp((-turnRateActual / Math.max(0.6, this.profile.turnRate)) * this.profile.maxBank, -this.profile.maxBank, this.profile.maxBank);
    this.roll = damp(this.roll, targetRoll, 5.2, dt);

    this.speed = damp(this.speed, targetSpeed, 2.8, dt);
    this.forwardDir(_fwd);
    this.velocity.copy(_fwd).multiplyScalar(this.speed);
    this.position.addScaledVector(this.velocity, dt);

    if (this.position.y < MIN_FLIGHT_ALT) {
      this.position.y = MIN_FLIGHT_ALT;
      if (this.pitch > 0) this.pitch = damp(this.pitch, -0.25, 8, dt);
    } else if (this.position.y > MAX_FLIGHT_ALT) {
      this.position.y = MAX_FLIGHT_ALT;
      if (this.pitch < 0) this.pitch = damp(this.pitch, 0.15, 6, dt);
    }
  }

  private forwardDir(out: THREE.Vector3): THREE.Vector3 {
    const nosePitch = -this.pitch;
    const cp = Math.cos(nosePitch);
    return out.set(Math.sin(this.yaw) * cp, Math.sin(nosePitch), Math.cos(this.yaw) * cp).normalize();
  }

  private syncModelAndCollider(dt: number): void {
    this.center.copy(this.position);
    this.markerPos.set(this.position.x, this.position.y + 4.4, this.position.z);

    this.rig.root.position.copy(this.position);
    this.rig.root.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');

    // Animate Lancer variable-geometry swept wings & Raptor thrust-vectoring nozzles!
    if (this.rig.wingsLeft && this.rig.wingsRight) {
      const wantSweep = clamp((this.speed - 36) / 36, 0, 1);
      this.wingSweep = damp(this.wingSweep, wantSweep, 3.5, dt);
      const ang = this.wingSweep * 0.72;
      this.rig.wingsLeft.rotation.y = -ang;
      this.rig.wingsRight.rotation.y = ang;
    }
    if (this.rig.nozzles) {
      const defl = clamp(-this.pitch * 0.35, -0.35, 0.35);
      for (const n of this.rig.nozzles) n.rotation.x = defl;
    }
    for (const g of this.rig.boostGlow) {
      g.visible = this.alive;
      const s = this.afterburning ? 1.35 : 0.72;
      g.scale.set(1, 1, s);
    }

    // Update Rapier hitbox collider transform so player gunfire & missiles hit accurately!
    if (this.collider && this.alive) {
      _euler.set(this.pitch, this.yaw, this.roll, 'YXZ');
      _quat.setFromEuler(_euler);
      this.collider.setTranslation(this.position);
      this.collider.setRotation(_quat);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.alive = false;
    this.unmark?.();
    this.unmark = null;
    if (this.collider) {
      this.ctx.physics?.world?.removeCollider?.(this.collider, true);
      this.collider = null;
    }
    this.ctx.render.scene.remove(this.rig.root);
    (this.teamBeacon.material as THREE.Material).dispose();
    this.teamBeacon.geometry.dispose();
  }
}
