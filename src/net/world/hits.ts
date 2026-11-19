/**
 * Damage to enemies, as the guests see it. A guest's own hit is a claim the host checks and applies (claims.ts). What the
 * host's damage then did goes to every guest as `hitfx` (a wound), `sever` (a limb) and `kill` (the death, replayed on the
 * guest's copy). Whose kill it was is credit.ts's word (`by`), so each player's own browser pays and scores only their kills.
 */
import * as THREE from 'three';
import type { DamageInfo } from '../../core/contracts';
import type { EnemyId, KillEvent } from '../../core/gameplay';
import type { GoreRegion } from '../../characters/rig';
import type { Enemy } from '../../enemies/Enemy';
import type { Credit } from './credit';
import { unpackDamage, type WorldContext } from './context';
import type { Replicas } from './replicas';
import { packDamage, type Vec, type WireDamage } from './wire';

export type HitEvent =
  /** Host: an enemy was hit; its health and armour after, and whether armour stopped it. */
  | { t: 'hitfx'; uid: number; damage: WireDamage; health: number; armor: number; blocked: boolean }
  /** `by` is the killer's slot (-1 the world's own), `head` the host's headshot verdict: the killer's browser pays itself. */
  | { t: 'kill'; uid: number; id: EnemyId; at: Vec; yaw: number; damage: WireDamage; gib: boolean; by?: number; head?: boolean }
  | { t: 'sever'; uid: number; region: GoreRegion; damage: WireDamage };

export class Hits {
  /** `credit` is built first: its `enemy:killed` listener has named the killer before this one sends the death. */
  constructor(private readonly w: WorldContext, private readonly replicas: Replicas, private readonly credit: Credit) {
    if (w.hosting) {
      w.listen('enemy:hit', event => w.send({ t: 'hitfx', uid: event.enemy.uid, damage: packDamage(event.damage),
        health: event.enemy.health, armor: event.enemy.armor, blocked: event.result.blocked }));
      w.listen('enemy:killed', event => {
        const by = this.credit.slot(event.enemy.uid);
        w.send({ t: 'kill', uid: event.enemy.uid, id: event.enemy.id, at: event.enemy.position.toArray() as Vec, yaw: event.enemy.yaw,
          damage: packDamage(event.damage), gib: event.gibbed, by, head: event.headshot });
      });
      w.listen('enemy:severed', event => w.send({ t: 'sever', uid: event.enemy.uid, region: event.region, damage: packDamage(event.damage) }));
    }
    w.router.guest('kill', value => this.killIn(value));
    w.router.guest('hitfx', value => this.hitfxIn(value));
    w.router.guest('sever', value => this.severIn(value));
  }

  private killIn(value: Extract<HitEvent, { t: 'kill' }>): void {
    const { manager, session } = this.w;
    if (this.replicas.dead.has(value.uid)) return;
    this.replicas.dead.add(value.uid);
    let enemy = this.replicas.enemy(value.uid);
    if (!enemy) {
      enemy = manager.spawn(value.id, new THREE.Vector3(...value.at)) ?? undefined;
      if (enemy) { enemy.uid = value.uid; enemy.yaw = value.yaw; }
    }
    if (enemy) {
      const damage = unpackDamage(value.damage);
      manager.replayDeath(enemy, damage, value.gib);
      // My own kill: my browser pays, scores and counts it, as the host's does its own.
      if (value.by === session.lobby.me?.slot) this.ownKill(enemy, damage, value.gib === true, value.head === true);
    }
    // Whose kill it was, for the kill feed (credit.ts).
    this.w.ctx.events.emit('coop:kill', { by: Number.isInteger(value.by) ? value.by! : -1, id: value.id, boss: enemy?.isBoss === true, head: value.head === true });
    this.replicas.map.delete(value.uid);
  }

  private hitfxIn(value: Extract<HitEvent, { t: 'hitfx' }>): void {
    const { ctx } = this.w;
    const enemy = this.replicas.enemy(value.uid);
    if (!enemy || this.replicas.dead.has(value.uid)) return;
    enemy.health = value.health; enemy.armor = value.armor;
    const damage = unpackDamage(value.damage);
    if (value.blocked) ctx.fx.impact(damage.point, damage.dir.clone().negate(), 'armor');
    else { ctx.gore.wound(enemy.char, damage, 0.6); ctx.fx.bloodHit(damage.point, damage.dir); enemy.char.hitFlash(0.4); }
  }

  private severIn(value: Extract<HitEvent, { t: 'sever' }>): void {
    const enemy = this.replicas.enemy(value.uid);
    if (enemy && !enemy.char.severed.has(value.region)) this.w.ctx.gore.sever(enemy.char, value.region, unpackDamage(value.damage));
  }

  private ownKill(enemy: Enemy, damage: DamageInfo, gibbed: boolean, headshot: boolean): void {
    const { ctx } = this.w;
    const p = ctx.player;
    const event: KillEvent = { enemy, damage, headshot, gibbed, sliced: !!damage.slicePlaneNormal, severedCount: enemy.char.severed.size,
      playerAirborne: !p.grounded, playerSliding: p.sliding, playerWallRunning: p.wallRunning, playerSpeed: p.speed,
      distance: enemy.position.distanceTo(p.position), explosionId: damage.explosionId ?? null };
    ctx.events.emit('enemy:killed', event);
  }

  /** Host: an enemy that blew itself up dies on the guests' screens too. */
  selfDestruct(enemy: Enemy): void {
    if (!this.w.hosting) return;
    this.w.send({ t: 'kill', uid: enemy.uid, id: enemy.id, at: enemy.position.toArray() as Vec, yaw: enemy.yaw, gib: true,
      damage: { amount: enemy.health + 1, type: 'explosive', point: enemy.center.toArray() as Vec, dir: [0, 1, 0], force: 300, source: enemy.id, gib: true } });
  }

}
