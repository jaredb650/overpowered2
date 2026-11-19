/**
 * Damage to enemies. A guest never hurts an enemy itself: its hit is a claim (`hit`) the host checks (authority.ts) and applies
 * as that guest. What the host's damage then did goes to every guest as `hitfx` (a wound), `sever` (a limb) and `kill` (the
 * death, replayed on the guest's copy). Also who killed what, so each player's own browser pays and scores only their kills.
 */
import * as THREE from 'three';
import type { DamageInfo } from '../../core/contracts';
import type { DamageResult, EnemyId, EnemyInstance, KillEvent } from '../../core/gameplay';
import type { GoreRegion } from '../../characters/rig';
import type { Enemy } from '../../enemies/Enemy';
import { WEAPONS, bossHit } from '../../weapons/data';
import { claimKind } from '../authority';
import { unpackDamage, type WorldContext, type WorldModule } from './context';
import type { RemoteFire } from './remoteFire';
import type { Replicas } from './replicas';
import type { Targeting } from './targeting';
import { ENEMY_IDS, packDamage, type Vec, type WireDamage } from './wire';

/** Guest to host: my shot `shot` hit enemy `target` like this, fired from `origin`. */
export interface HitClaim { t: 'hit'; shot: number; target: number; weapon: string; origin: Vec; damage: WireDamage }
export type HitEvent =
  | HitClaim
  /** Host: an enemy was hit; its health and armour after, and whether armour stopped it. */
  | { t: 'hitfx'; uid: number; damage: WireDamage; health: number; armor: number; blocked: boolean }
  /** `by` is the killer's slot (-1 the world's own), `head` the host's headshot verdict: the killer's browser pays itself. */
  | { t: 'kill'; uid: number; id: EnemyId; at: Vec; yaw: number; damage: WireDamage; gib: boolean; by?: number; head?: boolean }
  | { t: 'sever'; uid: number; region: GoreRegion; damage: WireDamage };

export class Hits implements WorldModule {
  /** Host: who killed each enemy that died lately (lobby id), for kill pay and score (`notMine`). */
  private readonly killedBy = new Map<number, { id: string; at: number }>();
  /** Host: the last player to land a claim on each enemy, for a kill by bleeding or fire after the hit. */
  private readonly lastHitter = new Map<number, string>();
  /** Host: the guest whose claim is being applied right now. */
  private applying: string | null = null;

  constructor(private readonly w: WorldContext, private readonly replicas: Replicas, private readonly targeting: Targeting, private readonly shots: RemoteFire) {
    const { session } = w;
    if (w.hosting) {
      // Registered before any system's own listener (systems listen in init, after this): who killed it is known first.
      w.listen('enemy:killed', event => {
        const id = this.applying ?? (Object.hasOwn(WEAPONS, event.damage.source) || /^(grenade|sword)/.test(event.damage.source) ? session.lobby.you
          : this.lastHitter.get(event.enemy.uid) ?? session.lobby.you);
        this.killedBy.set(event.enemy.uid, { id, at: performance.now() });
      });
      w.listen('enemy:hit', event => w.send({ t: 'hitfx', uid: event.enemy.uid, damage: packDamage(event.damage),
        health: event.enemy.health, armor: event.enemy.armor, blocked: event.result.blocked }));
      w.listen('enemy:killed', event => {
        const by = session.lobby.players.find(p => p.id === this.killedBy.get(event.enemy.uid)?.id)?.slot ?? -1;
        w.send({ t: 'kill', uid: event.enemy.uid, id: event.enemy.id, at: event.enemy.position.toArray() as Vec, yaw: event.enemy.yaw,
          damage: packDamage(event.damage), gib: event.gibbed, by, head: event.headshot });
      });
      w.listen('enemy:severed', event => w.send({ t: 'sever', uid: event.enemy.uid, region: event.region, damage: packDamage(event.damage) }));
    }
    w.router.host('hit', (value, from, now) => this.hitIn(value, from, now));
    w.router.guest('kill', value => this.killIn(value));
    w.router.guest('hitfx', value => this.hitfxIn(value));
    w.router.guest('sever', value => this.severIn(value));
    w.snapshotSent.push(alive => {
      for (const uid of this.lastHitter.keys()) if (!alive.has(uid)) this.lastHitter.delete(uid);
    });
  }

  /**
   * Not this player's: a kill (by uid) or a hit landed by a teammate. Score, combo, perks, kill pay and the run report skip it,
   * so each player's own browser pays and scores only what they did. Solo and guests' own replays read false.
   */
  notMine(enemy?: { uid: number }): boolean {
    if (this.applying !== null) return true;
    const killer = enemy ? this.killedBy.get(enemy.uid)?.id : undefined;
    return killer !== undefined && killer !== this.w.session.lobby.you;
  }

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
    this.applying = from;
    try { this.w.manager.applyDamage(enemy, damage); }
    finally { this.targeting.targetPlayer = null; this.applying = null; }
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

  update(now: number): void {
    for (const [uid, kill] of this.killedBy) if (now - kill.at > 3000) this.killedBy.delete(uid);
  }
}
