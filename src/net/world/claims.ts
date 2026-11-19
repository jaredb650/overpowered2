/**
 * A guest's damage, as a claim. A guest never hurts an enemy itself: `claim` turns its hit into a `hit` event and guesses the
 * result; the host checks it (authority.ts) and applies it as that guest's damage (`hitIn`). What the host's damage then did
 * goes out from hits.ts (`hitfx`, `sever`, `kill`), which also reads here whose claim is being applied (`applying`) and who
 * last hit an enemy (`lastHit`), for kill credit.
 */
import * as THREE from 'three';
import type { DamageInfo } from '../../core/contracts';
import type { DamageResult, EnemyInstance } from '../../core/gameplay';
import type { Enemy } from '../../enemies/Enemy';
import { WEAPONS, bossHit } from '../../weapons/data';
import { claimKind } from '../authority';
import { unpackDamage, type WorldContext } from './context';
import type { RemoteFire } from './remoteFire';
import type { Replicas } from './replicas';
import type { Targeting } from './targeting';
import { ENEMY_IDS, packDamage, type Vec, type WireDamage } from './wire';

/** Guest to host: my shot `shot` hit enemy `target` like this, fired from `origin`. */
export interface HitClaim { t: 'hit'; shot: number; target: number; weapon: string; origin: Vec; damage: WireDamage }

export class Claims {
  /** Host: the last player to land a claim on each enemy, for a kill by bleeding or fire after the hit. */
  private readonly lastHitter = new Map<number, string>();
  /** Host: the guest whose claim is being applied right now (lobby id). */
  private current: string | null = null;

  constructor(private readonly w: WorldContext, private readonly replicas: Replicas, private readonly targeting: Targeting, private readonly shots: RemoteFire) {
    w.router.host('hit', (value, from, now) => this.hitIn(value, from, now));
    w.snapshotSent.push(alive => {
      for (const uid of this.lastHitter.keys()) if (!alive.has(uid)) this.lastHitter.delete(uid);
    });
  }

  /** Host: the guest whose claim is being applied right now (lobby id), or null. */
  get applying(): string | null { return this.current; }
  /** Host: the last guest to land a claim on this enemy (lobby id). */
  lastHit(uid: number): string | undefined { return this.lastHitter.get(uid); }

  /** Guest: the local player's damage on an enemy becomes a claim; the result is a guess at what the host will say. */
  claim(enemy: EnemyInstance, damage: DamageInfo): DamageResult {
    const { ctx } = this.w;
    if (ENEMY_IDS.some(id => id === damage.source) || ['bleed', 'hazard', 'trample', 'coop'].includes(damage.source)) {
      return { dealt: 0, blocked: false, killed: false, headshot: false, severed: [] };
    }
    const weapon = ctx.weapons.current;
    // Only a gun's hit needs the shot it came from; a blast or a call-in's damage never draws a phantom tracer.
    if (claimKind(damage.source, damage.type) === 'shot'
      && (performance.now() - this.shots.firedAt > Math.max(100, WEAPONS[weapon].interval * 1000) || this.shots.weapon !== weapon)) this.shots.fire(weapon, ctx.player.eye, ctx.player.forward);
    this.w.send({ t: 'hit', shot: this.shots.shot, target: enemy.uid, weapon, origin: ctx.player.eye.toArray() as Vec, damage: packDamage(damage) });
    const body = enemy as Enemy;
    const region = damage.region ?? 'chest';
    const facing = Math.sin(enemy.yaw) * damage.dir.x + Math.cos(enemy.yaw) * damage.dir.z;
    const shield = body.shield && facing <= -0.35 && !['armR', 'forearmR', 'shinL', 'shinR'].includes(region);
    const plate = body.plates.find(plate => plate.hp > 0 && plate.spec.regions.includes(region)
      && (!plate.spec.facing || (facing > 0) === (plate.spec.facing === 'back')));
    const flags = this.replicas.flags(enemy.uid);
    const armoured = !!plate || shield || (flags & 96) !== 0;
    const blocked = (flags & 96) !== 0 || (shield && !damage.armorPiercing)
      || (!!plate && !damage.pierces && !damage.armorPiercing && !['ap', 'api', 'flechette'].includes(damage.load!));
    return { dealt: blocked ? 0 : damage.amount, blocked, killed: false, headshot: damage.region === 'head', severed: [], armour: armoured ? blocked ? 'stopped' : 'through' : undefined };
  }

  /** Host: a guest's claim, checked and applied as that guest's damage. */
  private hitIn(value: HitClaim, from: string, now: number): void {
    const { ctx, stats } = this.w;
    const remote = this.w.sender(from, now);
    if (!remote) return;
    const eye = remote.char.root.position.clone().add(new THREE.Vector3(0, 1.6, 0));
    const enemy = ctx.enemies.alive.find(enemy => enemy.uid === value.target);
    if (!enemy || this.w.life(from).down || !this.w.validator.validate(from, value, now, eye.toArray() as Vec, enemy.center.toArray() as Vec,
      (origin, target) => this.w.visible(origin, target))) { stats.rejected++; return; }
    stats.accepted++;
    const damage = unpackDamage(value.damage);
    if (damage.bone !== undefined && damage.bone >= enemy.char.rig.bones.length) damage.bone = undefined;
    damage.amount = bossHit(enemy.isBoss, damage.amount);
    this.targeting.targetPlayer = this.targeting.players().find(player => player.id === from)?.player ?? ctx.player;
    this.lastHitter.set(enemy.uid, from);
    this.current = from;
    try { this.w.manager.applyDamage(enemy, damage); }
    finally { this.targeting.targetPlayer = null; this.current = null; }
  }
}
