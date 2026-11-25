/**
 * Friendly FOB Vanguard Core & Perimeter CIWS/SAM Defense System (`FobDefenseSystem`).
 *
 * - Owns the 25,000 HP Friendly FOB Command Core (implements `FriendlyGroundTarget` so enemy tanks,
 *   guntrucks, and attack choppers engage it once they breach Sector 1, plus close-range infantry
 *   siege damage if hostiles storm the inner plaza).
 * - Tough by design: 4 automated corner CIWS / SAM bastion turrets shred stray raiders and low-flying
 *   enemy aircraft so the player never has to babysit base HP — the FOB only falls when the friendly
 *   army collapses and heavy enemy waves swarm the perimeter.
 * - Supports War Command "FOB Repair & Defense Overdrive" (+25% HP repair + 1.8x fire-rate boost).
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import type { EnemyInstance } from '../../core/gameplay';
import { clamp } from '../../core/math';
import type { AiCombatJet } from '../dogfight/aiJet';
import type { FriendlyGroundTarget } from '../vehicles';
import type { Vehicle as EnemyVehicle } from '../vehicles/vehicle';
import {
  ENDLESS_WAR_FOB_CORE,
  ENDLESS_WAR_FOB_MAX_HP,
  ENDLESS_WAR_FOB_TURRETS,
} from '../../world/map/endlessWar/plan';

interface FobTurret {
  readonly id: string;
  readonly kind: 'ciws' | 'sam';
  readonly pos: THREE.Vector3;
  readonly group: THREE.Group;
  readonly head: THREE.Group;
  cooldown: number;
}

interface TurretTracer {
  readonly mesh: THREE.Mesh;
  readonly pos: THREE.Vector3;
  readonly vel: THREE.Vector3;
  life: number;
}

const GROUND_RANGE = 195;
const AIR_RANGE = 340;
const INFANTRY_SIEGE_RANGE = 34;

const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();
const _zAxis = new THREE.Vector3(0, 0, 1);

export class FobDefenseSystem implements FriendlyGroundTarget {
  readonly id = 'fob_vanguard_core';
  readonly position = new THREE.Vector3(ENDLESS_WAR_FOB_CORE[0], ENDLESS_WAR_FOB_CORE[1], ENDLESS_WAR_FOB_CORE[2]);
  readonly velocity = new THREE.Vector3();
  readonly aimLift = 3.2;
  readonly armored = true;
  readonly airborne = false;

  readonly root = new THREE.Group();
  readonly maxHp = ENDLESS_WAR_FOB_MAX_HP;
  hp = ENDLESS_WAR_FOB_MAX_HP;
  overdriveLeft = 0;
  underAttackTimer = 0;
  breachedCount = 0;

  private readonly turrets: FobTurret[] = [];
  private readonly tracers: TurretTracer[] = [];
  private readonly tracerGeo = new THREE.BoxGeometry(0.16, 0.16, 5.2);
  private readonly ciwsMat = new THREE.MeshBasicMaterial({ color: 0x5ce6ff });
  private readonly samMat = new THREE.MeshBasicMaterial({ color: 0xffd25a });
  private siegeTick = 0;
  private warnCd = 0;
  private destroyedCallbackFired = false;

  constructor(
    private readonly ctx: Ctx,
    private readonly onDestroyed: () => void,
  ) {
    this.root.name = 'endless-war-fob-defense';
  }

  get alive(): boolean {
    return this.hp > 0;
  }

  get hpFrac(): number {
    return clamp(this.hp / this.maxHp, 0, 1);
  }

  init(): void {
    this.dispose();
    this.hp = this.maxHp;
    this.overdriveLeft = 0;
    this.underAttackTimer = 0;
    this.breachedCount = 0;
    this.destroyedCallbackFired = false;

    if (this.ctx.render.scene instanceof THREE.Scene) {
      this.ctx.render.scene.add(this.root);
    }

    const baseMat = new THREE.MeshStandardMaterial({ color: 0x38424d, roughness: 0.6, metalness: 0.55 });
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x262d35, roughness: 0.45, metalness: 0.72 });
    const domeMat = new THREE.MeshStandardMaterial({ color: 0xd0d8e0, roughness: 0.35, metalness: 0.25 });

    for (const def of ENDLESS_WAR_FOB_TURRETS) {
      const group = new THREE.Group();
      group.position.set(def.pos[0], def.pos[1], def.pos[2]);

      const ped = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.4, 1.1, 8), baseMat);
      ped.position.y = 0.55;
      group.add(ped);

      const head = new THREE.Group();
      head.position.y = 1.3;
      if (def.kind === 'ciws') {
        const radome = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.72, 1.5, 8), domeMat);
        radome.position.y = 0.75;
        head.add(radome);
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 2.3, 6), gunMat);
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(0, 0.2, 1.25);
        head.add(barrel);
      } else {
        const pod = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.2, 2.2), baseMat);
        pod.position.y = 0.55;
        head.add(pod);
        for (const sx of [-0.55, 0.55]) {
          const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 2.4, 6), gunMat);
          tube.rotation.x = Math.PI * 0.36;
          tube.position.set(sx, 0.85, 0.45);
          head.add(tube);
        }
      }
      group.add(head);
      this.root.add(group);

      this.turrets.push({
        id: def.id,
        kind: def.kind,
        pos: new THREE.Vector3(def.pos[0], def.pos[1] + 1.4, def.pos[2]),
        group,
        head,
        cooldown: Math.random() * 0.5,
      });
    }
  }

  /** War Command boost: restores +25% Core HP and overclocks all 4 perimeter turrets for 45 s. */
  triggerOverdrive(): void {
    if (!this.alive) return;
    this.hp = Math.min(this.maxHp, this.hp + Math.round(this.maxHp * 0.25));
    this.overdriveLeft = 45;
    this.ctx.hud?.feed?.('FOB CORE REPAIRED (+25%) — CIWS / SAM OVERDRIVE ACTIVE (45s)', '#4ef0ff');
  }

  takeDamage(amount: number, _from?: THREE.Vector3, _source?: string): void {
    if (!this.alive || amount <= 0) return;
    this.hp = Math.max(0, this.hp - amount);
    this.underAttackTimer = 5.0;
    if (this.warnCd <= 0) {
      this.warnCd = 9.0;
      const pct = Math.ceil(this.hpFrac * 100);
      this.ctx.hud?.feed?.(`WARNING: FOB VANGUARD CORE UNDER FIRE (${pct}% HP)`, '#ff4438');
    }
    if (this.hp <= 0 && !this.destroyedCallbackFired) {
      this.destroyedCallbackFired = true;
      this.ctx.fx?.explosion?.(_v.set(this.position.x, 4.5, this.position.z), { radius: 34, kind: 'thermobaric', scale: 2.0 });
      this.ctx.audio?.play?.('explosion', { position: this.position, volume: 1.0 });
      this.onDestroyed();
    }
  }

  update(
    dt: number,
    enemyInfantry: readonly EnemyInstance[],
    enemyVehicles: readonly EnemyVehicle[],
    enemyJets: readonly AiCombatJet[],
  ): void {
    if (!this.alive) return;
    if (this.overdriveLeft > 0) this.overdriveLeft = Math.max(0, this.overdriveLeft - dt);
    if (this.underAttackTimer > 0) this.underAttackTimer = Math.max(0, this.underAttackTimer - dt);
    if (this.warnCd > 0) this.warnCd = Math.max(0, this.warnCd - dt);

    // 1. Track Sector 1 breach count & close-range infantry siege against FOB Core
    let breached = 0;
    this.siegeTick -= dt;
    let infantrySiegeDps = 0;
    for (let i = 0; i < enemyInfantry.length; i++) {
      const e = enemyInfantry[i]!;
      if (!e.alive) continue;
      if (e.position.z > 248) breached++;
      const d = Math.hypot(e.position.x - this.position.x, e.position.z - this.position.z);
      if (d <= INFANTRY_SIEGE_RANGE) {
        infantrySiegeDps += e.maxHealth >= 400 ? 65 : 18;
      }
    }
    for (let i = 0; i < enemyVehicles.length; i++) {
      const v = enemyVehicles[i]!;
      if (v.alive && v.position.z > 248) breached += 2;
    }
    this.breachedCount = breached;

    if (this.siegeTick <= 0 && infantrySiegeDps > 0) {
      this.siegeTick = 0.65;
      this.takeDamage(infantrySiegeDps * 0.65, undefined, 'enemy_siege');
    }

    // 2. Automated CIWS / SAM Perimeter Turrets engaging threats approaching FOB Vanguard
    const rateMult = this.overdriveLeft > 0 ? 1.8 : 1.0;
    for (const t of this.turrets) {
      t.cooldown -= dt * rateMult;
      if (t.cooldown > 0) continue;

      // Priority 1 (SAM turrets prefer enemy jets & choppers; CIWS engages air & breached armor/infantry)
      let fired = false;

      if (enemyJets.length > 0) {
        let bestJet: AiCombatJet | null = null;
        let bestDist = AIR_RANGE;
        for (const jet of enemyJets) {
          if (!jet.alive) continue;
          const d = jet.position.distanceTo(t.pos);
          if (d < bestDist) {
            bestDist = d;
            bestJet = jet;
          }
        }
        if (bestJet) {
          this.aimAndFire(t, bestJet.position, t.kind === 'sam');
          bestJet.applyDamage(t.kind === 'sam' ? 58 : 26, bestJet.position, 'fob_defense', false, t.kind === 'sam');
          t.cooldown = t.kind === 'sam' ? 1.55 : 0.24;
          fired = true;
        }
      }

      if (!fired && enemyVehicles.length > 0) {
        let bestVeh: EnemyVehicle | null = null;
        let bestDist = t.kind === 'sam' ? 210 : GROUND_RANGE + 35;
        for (const v of enemyVehicles) {
          if (!v.alive) continue;
          // Only engage vehicles approaching South Trenches / FOB (z > 130) or airborne choppers
          if (v.position.y < 8 && v.position.z < 130) continue;
          const d = v.position.distanceTo(t.pos);
          if (d < bestDist) {
            bestDist = d;
            bestVeh = v;
          }
        }
        if (bestVeh) {
          _v.set(bestVeh.position.x, bestVeh.position.y + 1.6, bestVeh.position.z);
          this.aimAndFire(t, _v, t.kind === 'sam');
          bestVeh.take(t.kind === 'sam' ? 85 : 32, null, 'fob_defense', _v);
          t.cooldown = t.kind === 'sam' ? 1.45 : 0.22;
          fired = true;
        }
      }

      if (!fired && enemyInfantry.length > 0) {
        let bestInf: EnemyInstance | null = null;
        let bestDist = GROUND_RANGE;
        for (const e of enemyInfantry) {
          if (!e.alive || e.position.z < 175) continue;
          const d = e.position.distanceTo(t.pos);
          if (d < bestDist) {
            bestDist = d;
            bestInf = e;
          }
        }
        if (bestInf) {
          _v.set(bestInf.position.x, bestInf.position.y + 1.2, bestInf.position.z);
          this.aimAndFire(t, _v, false);
          this.ctx.enemies?.applyDamage?.(bestInf, {
            amount: t.kind === 'sam' ? 42 : 28,
            type: 'bullet',
            point: _v.clone(),
            dir: _v.clone().sub(t.pos).normalize(),
            force: 4,
            source: 'fob_defense',
          });
          t.cooldown = t.kind === 'sam' ? 0.95 : 0.18;
        }
      }
    }

    // 3. Advance tracer visuals
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i]!;
      tr.life -= dt;
      if (tr.life <= 0) {
        tr.mesh.removeFromParent();
        this.tracers.splice(i, 1);
        continue;
      }
      tr.pos.addScaledVector(tr.vel, dt);
      tr.mesh.position.copy(tr.pos);
    }
  }

  private aimAndFire(t: FobTurret, targetPos: THREE.Vector3, isSam: boolean): void {
    _dir.subVectors(targetPos, t.pos);
    const dist = Math.max(1, _dir.length());
    _dir.divideScalar(dist);
    t.head.rotation.y = Math.atan2(_dir.x, _dir.z);

    if (this.tracers.length < 24) {
      const speed = isSam ? 165 : 260;
      const mesh = new THREE.Mesh(this.tracerGeo, isSam ? this.samMat : this.ciwsMat);
      mesh.position.copy(t.pos).addScaledVector(_dir, 2.2);
      _quat.setFromUnitVectors(_zAxis, _dir);
      mesh.quaternion.copy(_quat);
      this.root.add(mesh);
      this.tracers.push({
        mesh,
        pos: mesh.position.clone(),
        vel: _dir.clone().multiplyScalar(speed),
        life: Math.min(0.9, dist / speed),
      });
    }
    void _up;
  }

  dispose(): void {
    for (const tr of this.tracers) tr.mesh.removeFromParent();
    this.tracers.length = 0;
    for (const t of this.turrets) t.group.removeFromParent();
    this.turrets.length = 0;
    this.root.removeFromParent();
  }
}
