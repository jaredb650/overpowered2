/**
 * Silent close-quarters rear takedown helper for stealth infiltration ("Quiet Title").
 *
 * Scans living human guards within close reach behind/flanking their facing cone, verifies
 * they are unaware or suspicious via an eligibility predicate, and executes a lethal
 * armor-bypassing melee/true takedown with minimal collapse impulse and a 3 m noise radius.
 */
import * as THREE from 'three';
import type { Ctx, DamageInfo } from '../core/contracts';
import type { EnemyInstance } from '../core/gameplay';

export type TakedownEligibility = (enemyId: number, enemy: EnemyInstance) => boolean;

export interface TakedownResult {
  readonly position: THREE.Vector3;
  readonly noiseRadius: number;
}

export const TAKEDOWN_DEFAULT_DIST = 2.2;
export const TAKEDOWN_REAR_DOT_MAX = 0.15;
export const TAKEDOWN_PLAYER_AIM_DOT_MIN = 0.25;
export const TAKEDOWN_MAX_VERTICAL_DELTA = 1.6;
export const TAKEDOWN_DAMAGE = 9999;
export const TAKEDOWN_FORCE = 18;
export const TAKEDOWN_NOISE_RADIUS = 3;

const DEFAULT_ELIGIBLE: TakedownEligibility = () => true;

export class StealthTakedown {
  private readonly defaultEligible: TakedownEligibility;
  private readonly hitPoint = new THREE.Vector3();
  private readonly hitDir = new THREE.Vector3(0, 0, 1);
  private readonly resultPos = new THREE.Vector3();
  private readonly damage: DamageInfo;
  private readonly result: TakedownResult;

  constructor(isEligible?: TakedownEligibility) {
    this.defaultEligible = isEligible ?? DEFAULT_ELIGIBLE;
    this.damage = {
      amount: TAKEDOWN_DAMAGE,
      type: 'true',
      point: this.hitPoint,
      dir: this.hitDir,
      force: TAKEDOWN_FORCE,
      source: 'stealth_takedown',
      region: 'chest',
      pierces: true,
      armorPiercing: true,
    };
    this.result = {
      position: this.resultPos,
      noiseRadius: TAKEDOWN_NOISE_RADIUS,
    };
  }

  /**
   * Finds the nearest living human enemy within `maxDist` where the player is behind/flanking
   * (`dot(enemyForward, dirToPlayer) < 0.15`), looking toward them, and `isEligible(enemy.uid)`
   * returns true. Zero allocations.
   */
  findTarget(
    playerPos: THREE.Vector3,
    playerForward: THREE.Vector3,
    enemies: readonly EnemyInstance[],
    maxDist = TAKEDOWN_DEFAULT_DIST,
    isEligible?: TakedownEligibility,
  ): EnemyInstance | null {
    const check = isEligible ?? this.defaultEligible;
    const maxDistSq = maxDist * maxDist;

    const pfx = playerForward.x;
    const pfz = playerForward.z;
    const pfLen = Math.hypot(pfx, pfz);
    const hasPlayerFwd = pfLen > 1e-4;
    const pfUnitX = hasPlayerFwd ? pfx / pfLen : 0;
    const pfUnitZ = hasPlayerFwd ? pfz / pfLen : 0;

    let best: EnemyInstance | null = null;
    let bestDistSq = maxDistSq;

    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i]!;
      if (!e.alive || e.machine || e.isBoss) continue;

      const dy = Math.abs(playerPos.y - e.position.y);
      if (dy > TAKEDOWN_MAX_VERTICAL_DELTA) continue;

      const dx = playerPos.x - e.position.x;
      const dz = playerPos.z - e.position.z;
      const horizSq = dx * dx + dz * dz;
      const distSq = horizSq + dy * dy;
      if (distSq > bestDistSq) continue;

      if (horizSq > 1e-4) {
        const invHoriz = 1 / Math.sqrt(horizSq);
        const toPlayerX = dx * invHoriz;
        const toPlayerZ = dz * invHoriz;

        // EnemyManager facing convention: yaw 0 faces +Z -> (sin(yaw), 0, cos(yaw)).
        const efX = Math.sin(e.yaw);
        const efZ = Math.cos(e.yaw);
        const rearDot = efX * toPlayerX + efZ * toPlayerZ;
        if (rearDot >= TAKEDOWN_REAR_DOT_MAX) continue;

        // Require player to generally face the target (dirToEnemy = -dirToPlayer).
        if (hasPlayerFwd) {
          const aimDot = pfUnitX * -toPlayerX + pfUnitZ * -toPlayerZ;
          if (aimDot < TAKEDOWN_PLAYER_AIM_DOT_MIN) continue;
        }
      }

      if (!check(e.uid, e)) continue;

      bestDistSq = distSq;
      best = e;
    }

    return best;
  }

  /**
   * Executes a lethal silent close-quarters rear takedown on `target`, bypassing all armor.
   * Plays blade impact audio, triggers a subtle camera punch, and returns `{ position, noiseRadius: 3 }`.
   * Zero allocations.
   */
  execute(target: EnemyInstance, ctx: Ctx): TakedownResult {
    this.resultPos.copy(target.position);
    this.hitPoint.copy(target.center);

    // Direction of the quiet forward collapse: from player toward enemy (or enemy's facing if overlapped).
    const px = ctx.player?.position?.x ?? target.position.x - Math.sin(target.yaw);
    const pz = ctx.player?.position?.z ?? target.position.z - Math.cos(target.yaw);
    const dx = target.position.x - px;
    const dz = target.position.z - pz;
    const len = Math.hypot(dx, dz);
    if (len > 1e-4) {
      this.hitDir.set(dx / len, -0.15, dz / len).normalize();
    } else {
      this.hitDir.set(Math.sin(target.yaw), -0.15, Math.cos(target.yaw)).normalize();
    }

    ctx.enemies.applyDamage(target, this.damage);

    const audio = ctx.audio;
    const soundId = audio?.has?.('knife_hit')
      ? 'knife_hit'
      : audio?.has?.('knife_flesh')
        ? 'knife_flesh'
        : 'sword_hit';
    audio?.play?.(soundId, { position: this.hitPoint, volume: 0.78, pitch: 1.08 });

    ctx.fx?.bloodHit?.(this.hitPoint, this.hitDir, 0.7);
    ctx.camera?.kick?.(0.032, -0.022, 0.038);
    ctx.camera?.fovPunch?.(-2.4, 0.14);
    ctx.camera?.addTrauma?.(0.14);

    return this.result;
  }
}
