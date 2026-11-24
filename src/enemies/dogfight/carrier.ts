/**
 * USS Sovereign (CVN-88) Carrier Hull, Credits & Automated Tower-Defense Systems (`CarrierDefenseSystem`).
 *
 * Manages:
 *   - Carrier Hull Integrity (base 2500 HP, upgradeable to 5500 HP + passive deck-crew auto-repair)
 *   - Combat Credits earned from enemy jet kills & wave clears
 *   - Animated 3D CIWS Phalanx 20mm Gatling Turrets (Lv 0->3: 2 / 3 / 4 active turrets on carrier sponsons)
 *   - Animated 3D SeaRAM / SAM Launcher Batteries (Lv 0->3: 1 / 2 / 3 launchers firing homing SAMs)
 *   - Allied AI Wingman Escorts (Lv 0->2: Hornet wingman at Lv 1, + F-22 Raptor escort at Lv 2)
 *   - Emergency Hull & Aircraft Repair action
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import { clamp, dampAngle } from '../../core/math';
import { CARRIER_CIWS_MOUNTS, CARRIER_SAM_MOUNTS, type SponsonMount } from '../../world/map/dogfight/plan';
import type { AiCombatJet } from './aiJet';

export type CarrierUpgradeId = 'ciws' | 'sam' | 'armor' | 'wingman' | 'repair';

export interface CarrierUpgradeState {
  readonly id: CarrierUpgradeId;
  readonly name: string;
  readonly summary: string;
  readonly level: number;
  readonly maxLevel: number;
  readonly nextCost: number;
  readonly maxed: boolean;
}

export const CARRIER_BASE_HP = 2500;
export const CARRIER_START_CREDITS = 350;

export const UPGRADE_COSTS: Record<Exclude<CarrierUpgradeId, 'repair'>, readonly number[]> = {
  ciws: [250, 450, 700],
  sam: [300, 520, 800],
  armor: [280, 480, 750],
  wingman: [450, 750],
};

export const EMERGENCY_REPAIR_COST = 200;
export const EMERGENCY_REPAIR_AMOUNT = 900;

const CIWS_ACTIVE_COUNTS = [0, 2, 3, 4] as const;
const CIWS_DPS = [0, 42, 66, 98] as const;
const CIWS_RANGE = 220;

const SAM_ACTIVE_COUNTS = [0, 1, 2, 3] as const;
const SAM_COOLDOWNS = [99, 5.2, 3.6, 2.4] as const;
const SAM_RANGE = 340;

const ARMOR_REPAIR_PER_SEC = [0, 12, 26, 45] as const;

interface CiwsTurretRig {
  readonly mount: SponsonMount;
  readonly root: THREE.Group;
  readonly head: THREE.Group;
  readonly muzzle: THREE.Object3D;
  yaw: number;
  fireCd: number;
}

interface SamLauncherRig {
  readonly mount: SponsonMount;
  readonly root: THREE.Group;
  readonly pod: THREE.Group;
  readonly muzzle: THREE.Object3D;
  yaw: number;
  fireCd: number;
}

export interface CarrierDefenseCallbacks {
  onCiwsShot(from: THREE.Vector3, dir: THREE.Vector3, damage: number): void;
  onSamLaunch(from: THREE.Vector3, dir: THREE.Vector3, target: AiCombatJet, damage: number): void;
  onSpawnWingman(kind: 'hornet' | 'raptor'): void;
  onCarrierDestroyed(): void;
}

const _pos = new THREE.Vector3();
const _dir = new THREE.Vector3();

function buildCiwsMesh(mount: SponsonMount): CiwsTurretRig {
  const root = new THREE.Group();
  root.position.set(mount.at[0], mount.at[1], mount.at[2]);

  const darkMat = new THREE.MeshStandardMaterial({ color: 0x3a424c, roughness: 0.6, metalness: 0.5 });
  const domeMat = new THREE.MeshStandardMaterial({ color: 0xdce4ec, roughness: 0.35, metalness: 0.25 });
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x20252b, roughness: 0.45, metalness: 0.7 });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.25, 0.75, 10), darkMat);
  base.position.y = 0.38;
  root.add(base);

  const head = new THREE.Group();
  head.position.y = 0.85;
  head.rotation.y = mount.defaultYaw;
  root.add(head);

  // Iconic white Phalanx radar radome ("R2-D2" dome).
  const radome = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.72, 1.5, 12), domeMat);
  radome.position.y = 0.95;
  head.add(radome);
  const domeCap = new THREE.Mesh(new THREE.SphereGeometry(0.62, 12, 8), domeMat);
  domeCap.position.y = 1.7;
  head.add(domeCap);

  // 20mm Vulcan rotary barrel protruding forward (+Z).
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 2.2, 8), gunMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.55, 1.35);
  head.add(barrel);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.55, 2.55);
  head.add(muzzle);

  return { mount, root, head, muzzle, yaw: mount.defaultYaw, fireCd: 0 };
}

function buildSamMesh(mount: SponsonMount): SamLauncherRig {
  const root = new THREE.Group();
  root.position.set(mount.at[0], mount.at[1], mount.at[2]);

  const baseMat = new THREE.MeshStandardMaterial({ color: 0x3b444f, roughness: 0.65, metalness: 0.45 });
  const boxMat = new THREE.MeshStandardMaterial({ color: 0x586573, roughness: 0.5, metalness: 0.4 });
  const capMat = new THREE.MeshStandardMaterial({ color: 0xffaa2b, roughness: 0.4, metalness: 0.2 });

  const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.15, 0.7, 10), baseMat);
  ped.position.y = 0.35;
  root.add(ped);

  const pod = new THREE.Group();
  pod.position.y = 1.05;
  pod.rotation.y = mount.defaultYaw;
  root.add(pod);

  const box = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.05, 2.4), boxMat);
  box.rotation.x = -0.38;
  box.position.y = 0.4;
  pod.add(box);

  // Orange missile cell launch facecaps.
  for (const ox of [-0.4, 0, 0.4]) {
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.68, 0.12), capMat);
    cap.position.set(ox, 0.85, 1.12);
    cap.rotation.x = -0.38;
    pod.add(cap);
  }

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 1.1, 1.4);
  pod.add(muzzle);

  return { mount, root, pod, muzzle, yaw: mount.defaultYaw, fireCd: 1.5 };
}

export class CarrierDefenseSystem {
  hp = CARRIER_BASE_HP;
  maxHp = CARRIER_BASE_HP;
  credits = CARRIER_START_CREDITS;
  destroyed = false;

  ciwsLevel = 0;
  samLevel = 0;
  armorLevel = 0;
  wingmanLevel = 0;

  private readonly ciwsTurrets: CiwsTurretRig[] = [];
  private readonly samLaunchers: SamLauncherRig[] = [];
  private hitFlashTimer = 0;
  private warnCooldown = 0;

  constructor(
    private readonly ctx: Ctx,
    private readonly cb: CarrierDefenseCallbacks,
  ) {}

  get underAttack(): boolean {
    return this.hitFlashTimer > 0;
  }

  reset(): void {
    this.disposeMeshes();
    this.hp = CARRIER_BASE_HP;
    this.maxHp = CARRIER_BASE_HP;
    this.credits = CARRIER_START_CREDITS;
    this.destroyed = false;
    this.ciwsLevel = 0;
    this.samLevel = 0;
    this.armorLevel = 0;
    this.wingmanLevel = 0;
    this.hitFlashTimer = 0;
    this.warnCooldown = 0;
  }

  /** Co-op guest: applies host carrier hull, credits, upgrade levels, and mounts matching sponson turrets. */
  syncFromHost(
    hp: number,
    maxHp: number,
    credits: number,
    destroyed: boolean,
    ciwsLevel: number,
    samLevel: number,
    armorLevel: number,
    wingmanLevel: number,
  ): void {
    const tookHit = hp < this.hp - 1;
    this.hp = clamp(hp, 0, Math.max(1, maxHp));
    this.maxHp = Math.max(1, maxHp);
    this.credits = Math.max(0, Math.round(credits));
    this.destroyed = destroyed;
    this.ciwsLevel = clamp(ciwsLevel | 0, 0, UPGRADE_COSTS.ciws.length);
    this.samLevel = clamp(samLevel | 0, 0, UPGRADE_COSTS.sam.length);
    this.armorLevel = clamp(armorLevel | 0, 0, UPGRADE_COSTS.armor.length);
    this.wingmanLevel = clamp(wingmanLevel | 0, 0, UPGRADE_COSTS.wingman.length);
    if (tookHit) this.hitFlashTimer = 1.6;
    this.syncTurretMeshes();
  }

  addCredits(amount: number): void {
    if (amount <= 0) return;
    this.credits += Math.round(amount);
  }

  damageHull(amount: number, hitPoint: THREE.Vector3, attackerName: string): void {
    if (this.destroyed || amount <= 0) return;
    this.hp = Math.max(0, this.hp - amount);
    this.hitFlashTimer = 2.0;

    if (this.warnCooldown <= 0) {
      this.warnCooldown = 4.2;
      const pct = Math.round((this.hp / this.maxHp) * 100);
      this.ctx.hud?.feed?.(`CARRIER HIT · ${attackerName} (${pct}%)`, '#ff4d3d');
    }

    if (this.hp <= 0) {
      this.destroyed = true;
      this.ctx.fx?.explosion?.(hitPoint, { radius: 16, scale: 3.0 });
      this.ctx.audio?.play?.('explosion_tank', { position: hitPoint, volume: 1.0, pitch: 0.72 });
      this.cb.onCarrierDestroyed();
    }
  }

  upgradeCatalog(): CarrierUpgradeState[] {
    const ciwsMax = UPGRADE_COSTS.ciws.length;
    const samMax = UPGRADE_COSTS.sam.length;
    const armorMax = UPGRADE_COSTS.armor.length;
    const wingMax = UPGRADE_COSTS.wingman.length;
    return [
      {
        id: 'ciws',
        name: 'CIWS PHALANX BATTERY',
        summary: this.ciwsLevel === 0
          ? 'Install 2 automated 20mm Phalanx gatling turrets on bow sponsons'
          : `Upgrade to ${CIWS_ACTIVE_COUNTS[Math.min(ciwsMax, this.ciwsLevel + 1)]} rapid-fire CIWS turrets (+firepower)`,
        level: this.ciwsLevel,
        maxLevel: ciwsMax,
        nextCost: UPGRADE_COSTS.ciws[this.ciwsLevel] ?? 0,
        maxed: this.ciwsLevel >= ciwsMax,
      },
      {
        id: 'sam',
        name: 'SEARAM SAM LAUNCHERS',
        summary: this.samLevel === 0
          ? 'Install automated surface-to-air homing missile pod on the island'
          : `Add SAM launcher (${SAM_ACTIVE_COUNTS[Math.min(samMax, this.samLevel + 1)]} pods) & faster lock salvo`,
        level: this.samLevel,
        maxLevel: samMax,
        nextCost: UPGRADE_COSTS.sam[this.samLevel] ?? 0,
        maxed: this.samLevel >= samMax,
      },
      {
        id: 'armor',
        name: 'HULL ARMOR & AUTO-REPAIR',
        summary: `+1,000 Max Hull HP, instant repair & +${ARMOR_REPAIR_PER_SEC[Math.min(armorMax, this.armorLevel + 1)]} HP/s deck crew repair`,
        level: this.armorLevel,
        maxLevel: armorMax,
        nextCost: UPGRADE_COSTS.armor[this.armorLevel] ?? 0,
        maxed: this.armorLevel >= armorMax,
      },
      {
        id: 'wingman',
        name: 'ALLIED AI WINGMAN ESCORT',
        summary: this.wingmanLevel === 0
          ? 'Launch an allied AI F/A-18E Super Hornet to patrol & dogfight bandits'
          : 'Launch a second elite allied AI F-22 Raptor escort!',
        level: this.wingmanLevel,
        maxLevel: wingMax,
        nextCost: UPGRADE_COSTS.wingman[this.wingmanLevel] ?? 0,
        maxed: this.wingmanLevel >= wingMax,
      },
      {
        id: 'repair',
        name: 'EMERGENCY HULL & JET REPAIR',
        summary: `Instantly restore +${EMERGENCY_REPAIR_AMOUNT} Carrier Hull HP and repair your aircraft`,
        level: 0,
        maxLevel: 99,
        nextCost: EMERGENCY_REPAIR_COST,
        maxed: false,
      },
    ];
  }

  purchase(id: CarrierUpgradeId): { ok: boolean; reason?: string } {
    if (this.destroyed) return { ok: false, reason: 'Carrier destroyed' };

    if (id === 'repair') {
      if (this.credits < EMERGENCY_REPAIR_COST) return { ok: false, reason: 'Not enough credits' };
      this.credits -= EMERGENCY_REPAIR_COST;
      this.hp = Math.min(this.maxHp, this.hp + EMERGENCY_REPAIR_AMOUNT);
      this.ctx.events.emit('dogfight:repair_player_jet', { amount: 1000 });
      this.ctx.audio?.play?.('ui_confirm');
      this.ctx.hud?.feed?.(`EMERGENCY REPAIR COMPLETE — HULL ${Math.round(this.hp)}/${this.maxHp}`, '#38e8ff');
      return { ok: true };
    }

    const costs = UPGRADE_COSTS[id];
    const current =
      id === 'ciws' ? this.ciwsLevel
      : id === 'sam' ? this.samLevel
      : id === 'armor' ? this.armorLevel
      : this.wingmanLevel;

    if (current >= costs.length) return { ok: false, reason: 'Max level reached' };
    const cost = costs[current]!;
    if (this.credits < cost) return { ok: false, reason: 'Not enough credits' };

    this.credits -= cost;
    if (id === 'ciws') {
      this.ciwsLevel++;
      this.syncTurretMeshes();
      this.ctx.hud?.feed?.(`CIWS PHALANX UPGRADED TO LV ${this.ciwsLevel}!`, '#38e8ff');
    } else if (id === 'sam') {
      this.samLevel++;
      this.syncTurretMeshes();
      this.ctx.hud?.feed?.(`SEARAM SAM BATTERY UPGRADED TO LV ${this.samLevel}!`, '#38e8ff');
    } else if (id === 'armor') {
      this.armorLevel++;
      this.maxHp += 1000;
      this.hp = Math.min(this.maxHp, this.hp + 1000);
      this.ctx.hud?.feed?.(`CARRIER HULL ARMOR LV ${this.armorLevel} (+1000 MAX HP & AUTO-REPAIR)`, '#38e8ff');
    } else if (id === 'wingman') {
      this.wingmanLevel++;
      const kind = this.wingmanLevel >= 2 ? 'raptor' : 'hornet';
      this.cb.onSpawnWingman(kind);
      this.ctx.hud?.feed?.(`ALLIED WINGMAN LAUNCHED (${kind === 'raptor' ? 'F-22 RAPTOR' : 'F/A-18E HORNET'})!`, '#38e8ff');
    }
    this.ctx.audio?.play?.('ui_confirm');
    return { ok: true };
  }

  private syncTurretMeshes(): void {
    const scene = this.ctx.render?.scene;
    if (!scene) return;

    const wantCiws = CIWS_ACTIVE_COUNTS[this.ciwsLevel] ?? 0;
    while (this.ciwsTurrets.length < wantCiws && this.ciwsTurrets.length < CARRIER_CIWS_MOUNTS.length) {
      const mount = CARRIER_CIWS_MOUNTS[this.ciwsTurrets.length]!;
      const rig = buildCiwsMesh(mount);
      scene.add(rig.root);
      this.ciwsTurrets.push(rig);
    }

    const wantSam = SAM_ACTIVE_COUNTS[this.samLevel] ?? 0;
    while (this.samLaunchers.length < wantSam && this.samLaunchers.length < CARRIER_SAM_MOUNTS.length) {
      const mount = CARRIER_SAM_MOUNTS[this.samLaunchers.length]!;
      const rig = buildSamMesh(mount);
      scene.add(rig.root);
      this.samLaunchers.push(rig);
    }
  }

  update(dt: number, enemies: readonly AiCombatJet[]): void {
    if (this.destroyed) return;
    if (this.hitFlashTimer > 0) this.hitFlashTimer = Math.max(0, this.hitFlashTimer - dt);
    if (this.warnCooldown > 0) this.warnCooldown = Math.max(0, this.warnCooldown - dt);

    // Passive deck crew auto-repair from Hull Armor upgrades!
    const repairRate = ARMOR_REPAIR_PER_SEC[this.armorLevel] ?? 0;
    if (repairRate > 0 && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + repairRate * dt);
    }

    // Tick CIWS Phalanx rapid-fire turrets.
    const ciwsDps = CIWS_DPS[this.ciwsLevel] ?? 0;
    const shotInterval = this.ciwsLevel >= 3 ? 0.08 : this.ciwsLevel === 2 ? 0.1 : 0.12;
    const perShotDmg = ciwsDps * shotInterval;
    for (const t of this.ciwsTurrets) {
      t.fireCd = Math.max(0, t.fireCd - dt);
      const target = this.pickNearest(t.root.position, enemies, CIWS_RANGE);
      if (!target) continue;

      const dx = target.position.x - t.root.position.x;
      const dz = target.position.z - t.root.position.z;
      t.yaw = dampAngle(t.yaw, Math.atan2(dx, dz), 9, dt);
      t.head.rotation.y = t.yaw;

      if (t.fireCd <= 0) {
        t.muzzle.getWorldPosition(_pos);
        // Lead target slightly for crisp CIWS tracer convergence!
        const dist = _pos.distanceTo(target.position);
        const leadT = clamp(dist / 240, 0.05, 0.5);
        _dir.copy(target.position).addScaledVector(target.velocity, leadT).sub(_pos).normalize();
        this.cb.onCiwsShot(_pos.clone(), _dir.clone(), perShotDmg);
        t.fireCd = shotInterval;
      }
    }

    // Tick SeaRAM / SAM missile launchers.
    const samCd = SAM_COOLDOWNS[this.samLevel] ?? 6;
    for (const s of this.samLaunchers) {
      s.fireCd = Math.max(0, s.fireCd - dt);
      const target = this.pickNearest(s.root.position, enemies, SAM_RANGE);
      if (!target) continue;

      const dx = target.position.x - s.root.position.x;
      const dz = target.position.z - s.root.position.z;
      s.yaw = dampAngle(s.yaw, Math.atan2(dx, dz), 6, dt);
      s.pod.rotation.y = s.yaw;

      if (s.fireCd <= 0) {
        s.muzzle.getWorldPosition(_pos);
        _dir.subVectors(target.position, _pos).add(new THREE.Vector3(0, 12, 0)).normalize();
        this.cb.onSamLaunch(_pos.clone(), _dir.clone(), target, 175 + this.samLevel * 25);
        s.fireCd = samCd;
      }
    }
  }

  private pickNearest(from: THREE.Vector3, enemies: readonly AiCombatJet[], maxRange: number): AiCombatJet | null {
    let best: AiCombatJet | null = null;
    let bestSq = maxRange * maxRange;
    for (const e of enemies) {
      if (!e.alive || e.team !== 'enemy') continue;
      const dSq = from.distanceToSquared(e.position);
      if (dSq < bestSq) {
        bestSq = dSq;
        best = e;
      }
    }
    return best;
  }

  private disposeMeshes(): void {
    const scene = this.ctx.render?.scene;
    for (const t of this.ciwsTurrets) {
      scene?.remove(t.root);
    }
    for (const s of this.samLaunchers) {
      scene?.remove(s.root);
    }
    this.ciwsTurrets.length = 0;
    this.samLaunchers.length = 0;
  }

  dispose(): void {
    this.disposeMeshes();
  }
}
