/**
 * Host: who each enemy is after. Every player is a target: the host's own player, and each guest through a stand-in that reads
 * their body's pose and turns damage into a `hurt` event for them. Also the path a chaser takes to a remote player.
 * Guest: takes the `hurt` the host sends.
 */
import * as THREE from 'three';
import type { PlayerDamage, PlayerSystem } from '../../core/contracts';
import type { Enemy } from '../../enemies/Enemy';
import type { PlayerSense } from '../../enemies/aiWorld';
import type { Foe } from '../../enemies/outpost/soldier';
import { soldierOf } from '../../enemies/outpost/soldier';
import { Route, RouteFinder, type NavGrid } from '../../enemies/outpost/routes';
import { WEAPONS } from '../../weapons/data';
import { selectTarget } from '../authority';
import type { TeamLife } from '../team';
import type { WorldContext, WorldModule } from './context';
import { validVec, type Vec } from './wire';

/** Host to one guest: an enemy hurt you. `life` is the life it was meant for (team.ts); damage for an earlier one is dropped. */
export type HurtEvent = { t: 'hurt'; amount: number; from: Vec; type: string; source: string; life: number };

export interface PlayerTarget { id: string; player: PlayerSystem; life: TeamLife; foe: Foe }

export class Targeting implements WorldModule {
  /** Host: the player the enemy being updated is after (EnemyManager reads and clears it). */
  targetPlayer: PlayerSystem | null = null;
  /** Guest: true while the host's `hurt` is being applied, so the player takes it (`allowsLocalDamage`). */
  receivingDamage = false;
  private readonly selections = new Map<number, string>();
  private readonly sight = new Map<number, { target: string; at: number; visible: boolean }>();
  private readonly adapters = new Map<string, PlayerTarget>();
  private readonly finder = new RouteFinder();
  private readonly routes = new Map<number, { route: Route; at: number; target: THREE.Vector3 }>();
  private searchFrame = -1;

  constructor(private readonly w: WorldContext) {
    w.router.guest('hurt', value => this.hurtIn(value));
    w.snapshotSent.push(alive => {
      for (const uid of this.selections.keys()) if (!alive.has(uid)) { this.selections.delete(uid); this.sight.delete(uid); this.routes.delete(uid); }
    });
  }

  /** Every player whose body is in the world, the local one included. */
  players(): PlayerTarget[] {
    const { ctx, session } = this.w;
    const localId = session.lobby.you;
    const result: PlayerTarget[] = [];
    for (const roster of session.lobby.players) {
      const remote = session.remotes.get(roster.id);
      if (roster.id !== localId && (!remote || !remote.buffer.sample(performance.now()))) continue;
      let adapter = this.adapters.get(roster.id);
      if (!adapter) {
        const position = new THREE.Vector3(), eye = new THREE.Vector3(), velocity = new THREE.Vector3(), forward = new THREE.Vector3();
        const life = this.w.life(roster.id);
        const player = roster.id === localId ? ctx.player : new Proxy(ctx.player, {
          get: (target, key) => {
            switch (key) {
              case 'position': return position;
              case 'eye': return eye;
              case 'velocity': return velocity;
              case 'forward': return forward;
              case 'alive': return !life.down;
              case 'grounded': return true;
              case 'takeDamage': return (damage: PlayerDamage) => this.hurt(roster.id, damage);
              case 'launch': case 'push': return () => {};
              default: return Reflect.get(target, key);
            }
          },
        });
        const foe: Foe = {
          get alive() { return player.alive; }, get center() { return eye; },
          shotAt: (from, damage, miss, source) => {
            const end = eye.clone().add(new THREE.Vector3((Math.random() - 0.5) * miss, (Math.random() - 0.5) * miss, 0));
            const dir = end.sub(from).normalize();
            ctx.combat.fireRay(from, dir, { damage, source, team: 'enemy', tracer: 'enemy' });
          },
          blast: (at, radius, damage, delay, source) => this.w.later.push(performance.now() + delay * 1000,
            () => ctx.combat.explode(at, { radius, damage, source, team: 'enemy', kind: 'enemy' })),
        };
        adapter = { id: roster.id, player, life, foe };
        this.adapters.set(roster.id, adapter);
      }
      if (remote) {
        adapter.player.position.copy(remote.char.root.position);
        adapter.player.eye.copy(remote.char.root.position).y += 1.6;
        const pose = remote.buffer.sample(performance.now())!;
        adapter.player.velocity.fromArray(pose.velocity);
        adapter.player.forward.set(-Math.sin(pose.yaw), 0, -Math.cos(pose.yaw));
      }
      result.push(adapter);
    }
    return result;
  }

  /** Host: picks this enemy's target and fills in what it senses of them. */
  select(enemy: Enemy, sense: PlayerSense): void {
    const { ctx, session } = this.w;
    const players = this.players();
    const selected = selectTarget(enemy.position.toArray(), players.map(target => ({ id: target.id, alive: target.player.alive, position: target.player.position.toArray() })), this.selections.get(enemy.uid));
    const target = players.find(player => player.id === selected?.id);
    this.targetPlayer = target?.player ?? ctx.player;
    const player = this.targetPlayer;
    if (target) this.selections.set(enemy.uid, target.id);
    sense.position.copy(player.position); sense.eye.copy(player.eye); sense.chest.copy(player.position).y += 1;
    sense.velocity.copy(player.velocity); sense.forward.copy(player.forward); sense.speed = player.velocity.length();
    sense.alive = !!target && player.alive; sense.grounded = player.grounded; sense.ghost = false;
    sense.evasion = Math.max(0, Math.min(1, (sense.speed - 2) / 9.5));
    if (target) {
      let sight = this.sight.get(enemy.uid);
      if (!sight || sight.target !== target.id || performance.now() >= sight.at) {
        sight = { target: target.id, at: performance.now() + 200, visible: this.w.visible(enemy.center.toArray() as Vec, player.eye.toArray() as Vec) };
        this.sight.set(enemy.uid, sight);
      }
      enemy.hasLos = sight.visible;
    }
    const soldier = soldierOf(enemy);
    if (soldier) soldier.foe = target && target.id !== session.lobby.you ? target.foe : null;
  }

  /** Every live player's eyes, for the host's fleeing men to run from (outpost/flight.ts). */
  playerEyes(): THREE.Vector3[] { return this.players().filter(target => target.player.alive).map(target => target.player.eye); }
  isRemoteTarget(): boolean { return !!this.targetPlayer && this.targetPlayer !== this.w.ctx.player; }

  /** Guest: may this damage reach the local player? Only the host's word, a hazard, or their own gun or grenade. */
  allowsLocalDamage(damage: PlayerDamage): boolean {
    return this.receivingDamage || damage.type === 'hazard' || Object.hasOwn(WEAPONS, damage.source) || damage.source === 'grenade';
  }

  /** Host: the way a chaser runs at a remote target. False leaves the enemy's own movement in charge. */
  steer(enemy: Enemy, direction: THREE.Vector3): boolean {
    const { ctx } = this.w;
    if (!this.isRemoteTarget()) return false;
    const target = this.targetPlayer!.position;
    if (enemy.hasLos) { direction.subVectors(target, enemy.position).setY(0).normalize(); return true; }
    const grid = ctx.world.nav as unknown as NavGrid;
    if (!grid.nodeCount) return false;
    if (!this.finder.ready) this.finder.build(grid);
    let cached = this.routes.get(enemy.uid);
    const now = performance.now();
    if ((!cached || now >= cached.at || cached.target.distanceToSquared(target) > 16) && this.searchFrame !== ctx.time.frame) {
      this.searchFrame = ctx.time.frame;
      if (!cached) { cached = { route: new Route(), at: 0, target: new THREE.Vector3() }; this.routes.set(enemy.uid, cached); }
      cached.at = now + 1200; cached.target.copy(target);
      this.finder.find(enemy.position, target, cached.route, null, 2000);
    }
    if (!cached || cached.route.done) return false;
    const route = cached.route;
    while (!route.done) {
      direction.set(route.x[route.next]!, route.y[route.next]!, route.z[route.next]!).sub(enemy.position);
      if (direction.lengthSq() > 0.75 * 0.75) break;
      route.next++;
    }
    if (route.done) { cached.at = 0; return false; }
    direction.setY(0).normalize();
    return true;
  }

  /** Host: an enemy's damage on a remote player goes to them as `hurt`; their own browser takes it. */
  hurt(id: string, damage: PlayerDamage): void {
    const life = this.w.life(id);
    if (life.down || damage.amount <= 0) return;
    this.w.send({ t: 'hurt', amount: damage.amount, from: (damage.from ?? this.w.ctx.player.position).toArray() as Vec,
      type: damage.type, source: damage.source, life: life.life }, id);
  }

  private hurtIn(value: HurtEvent): void {
    const { ctx, session } = this.w;
    if (this.w.life(session.lobby.you).accepts(value.life) && Number.isFinite(value.amount) && value.amount > 0 && value.amount < 10000 && validVec(value.from)) {
      this.receivingDamage = true;
      try { ctx.player.takeDamage({ amount: value.amount, from: new THREE.Vector3(...value.from), type: value.type as PlayerDamage['type'], source: value.source }); }
      finally { this.receivingDamage = false; }
    }
  }

  /** A player who left takes their stand-in and their claim history with them. */
  update(): void {
    for (const id of this.adapters.keys()) if (!this.w.session.lobby.players.some(player => player.id === id)) {
      this.adapters.delete(id); this.w.validator.forget(id);
    }
  }
}
