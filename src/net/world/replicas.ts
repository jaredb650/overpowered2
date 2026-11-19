/**
 * The host's enemies on every guest: the host builds a snapshot of all of them every SNAPSHOT_MS and sends it on the `world`
 * lane; a guest spawns, updates and withdraws its copies ("replicas") from it and moves them between the last two snapshots.
 * The frame's bytes are snapshot.ts. A killed uid is remembered (`dead`) so a late snapshot never brings it back.
 */
import * as THREE from 'three';
import type { DamageInfo } from '../../core/contracts';
import type { Enemy } from '../../enemies/Enemy';
import { HELMET } from '../../enemies/wounds/armour';
import { capturable } from './capture';
import type { WorldContext, WorldModule } from './context';
import { CAPTURABLE, decodeWorld, encodeWorld, POSTURES, SNAPSHOT_MS, type EnemyFrame, type PostureId, type WorldFrame } from './snapshot';
import { REGIONS, type Vec } from './wire';

export interface Replica { enemy: Enemy; from: EnemyFrame; to: EnemyFrame; at: number }

/** The posture a man is held in by his animator (postures.ts), as the snapshot carries it. */
export function postureOf(enemy: Enemy): PostureId {
  const name = (enemy.char.anim as unknown as { posture?: { name?: string } }).posture?.name;
  return (POSTURES as readonly string[]).includes(name ?? '') ? name as PostureId : 'stand';
}

export class Replicas implements WorldModule {
  /** Guest: the host's enemies as drawn here, by uid. */
  readonly map = new Map<number, Replica>();
  /** Guest: uids the host has said are dead. */
  readonly dead = new Set<number>();
  /** Guest: the last snapshot taken. */
  receivedSeq: number | null = null;
  private pending: ArrayBuffer | null = null;
  private next = 0;
  private seq = 0;

  constructor(private readonly w: WorldContext) {
    w.onSnapshot = data => this.receive(data);
  }

  /** Guest: the copy of this enemy, if it is drawn here. */
  enemy(uid: number): Enemy | undefined { return this.map.get(uid)?.enemy; }
  /** Guest: the flag bits of this enemy's latest snapshot (0 if unknown). */
  flags(uid: number): number { return this.map.get(uid)?.to.flags ?? 0; }

  /** The map is up: the snapshot kept while it loaded is taken now. */
  begin(): void {
    if (this.pending) this.receive(this.pending);
    this.pending = null;
  }

  private frame(enemy: Enemy): EnemyFrame {
    return { uid: enemy.uid, id: enemy.id, position: enemy.position.toArray() as Vec, velocity: enemy.velocity.toArray() as Vec,
      yaw: enemy.yaw, health: enemy.health, maxHealth: enemy.maxHealth, armor: enemy.armor,
      flags: (enemy.airborne ? 1 : 0) | (enemy.downed ? 2 : 0) | (enemy.frozen > 0 ? 4 : 0) | (enemy.burning > 0 ? 8 : 0)
        | (enemy.shield ? 16 : 0) | (enemy.ward > 0 ? 32 : 0) | (enemy.entrance === 'boss' ? 64 : 0) | (capturable(enemy) ? CAPTURABLE : 0),
      posture: postureOf(enemy),
      animation: enemy.attack ? enemy.attackPhase === 'windup' ? 1 : 2 : enemy.stagger > 0 ? 3 : 0,
      severed: REGIONS.reduce((mask, region, index) => mask | (enemy.char.severed.has(region) ? 1 << index : 0), 0),
      plates: enemy.plates.reduce((mask, plate, index) => mask | (plate.hp > 0 ? 1 << index : 0), 0) };
  }

  private receive(data: ArrayBuffer): void {
    const { ctx, manager } = this.w;
    if (this.w.hosting) return;
    if (!this.w.ready) { this.pending = data; return; }
    const frame = decodeWorld(data);
    if (!frame || (this.receivedSeq !== null && ((frame.seq - this.receivedSeq) >>> 0) >= 0x80000000) || frame.seq === this.receivedSeq) return;
    this.receivedSeq = frame.seq;
    const now = performance.now();
    Object.assign(ctx.waves, { wave: frame.wave, phase: frame.phase, nextWaveIn: frame.nextWaveIn });
    const present = new Set<number>();
    for (const state of frame.enemies) {
      if (this.dead.has(state.uid)) continue;
      present.add(state.uid);
      let replica = this.map.get(state.uid);
      if (!replica) {
        const enemy = manager.spawn(state.id, new THREE.Vector3(...state.position));
        if (!enemy) continue;
        enemy.uid = state.uid;
        replica = { enemy, from: state, to: state, at: now };
        this.map.set(state.uid, replica);
      } else {
        replica.from = { ...replica.to, position: replica.enemy.position.toArray() as Vec, yaw: replica.enemy.yaw };
        replica.to = state; replica.at = now;
      }
      const enemy = replica.enemy;
      enemy.health = state.health; enemy.maxHealth = state.maxHealth;
      if (state.plates && enemy.plates.length === 0) manager.fitPlates(enemy, [HELMET]);
      enemy.armor = state.armor;
      enemy.airborne = (state.flags & 1) !== 0;
      enemy.shield = (state.flags & 16) !== 0;
      const skin = enemy.char as unknown as { setBurn?(amount: number): void; setFrost?(amount: number): void };
      skin.setBurn?.((state.flags & 8) !== 0 ? 1 : 0);
      skin.setFrost?.((state.flags & 4) !== 0 ? 1 : 0);
      if (state.animation !== replica.from.animation && state.animation !== 0) enemy.char.anim.play(state.animation === 1 ? 'attackMelee' : state.animation === 2 ? 'shoot' : 'stagger');
      enemy.plates.forEach((plate, index) => {
        plate.mesh.visible = (state.plates & 1 << index) !== 0;
        if (!plate.mesh.visible) plate.hp = 0;
      });
      for (let index = 0; index < REGIONS.length; index++) if ((state.severed & 1 << index) && !enemy.char.severed.has(REGIONS[index]!)) {
        const damage: DamageInfo = { amount: 1, type: 'slash', point: enemy.center.clone(), dir: new THREE.Vector3(0, 1, 0), force: 1, source: 'coop' };
        ctx.gore.sever(enemy.char, REGIONS[index]!, damage);
      }
    }
    for (const [uid, replica] of this.map) if (!present.has(uid) && now - replica.at > 500) {
      manager.withdraw(replica.enemy); this.map.delete(uid);
    }
  }

  /** Guest, each frame before the enemies draw: every replica moved between its last two snapshots. */
  animate(now: number): void {
    for (const replica of this.map.values()) {
      const alpha = Math.max(0, Math.min(1, (now - replica.at) / SNAPSHOT_MS));
      const { enemy, from, to } = replica;
      enemy.position.fromArray(from.position).lerp(new THREE.Vector3(...to.position), alpha);
      enemy.yaw = from.yaw + Math.atan2(Math.sin(to.yaw - from.yaw), Math.cos(to.yaw - from.yaw)) * alpha;
      enemy.velocity.fromArray(to.velocity);
      this.w.manager.placeReplica(enemy, this.w.ctx.time.dt, (to.flags & 2) !== 0 ? 'downed' : to.posture ?? 'stand');
    }
  }

  /** Host: the snapshot, when it is due. Last in the world's update. */
  update(now: number): void {
    const { ctx, manager, stats } = this.w;
    if (!this.w.hosting || now < this.next) return;
    this.next = now + SNAPSHOT_MS;
    const frame: WorldFrame = { seq: this.seq++ >>> 0, wave: ctx.waves.wave, phase: ctx.waves.phase, nextWaveIn: ctx.waves.nextWaveIn,
      enemies: manager.alive.map(enemy => this.frame(enemy)) };
    const buffer = encodeWorld(frame);
    const recipients = this.w.sendSnapshot(buffer);
    stats.snapshotBytes += buffer.byteLength * recipients;
    stats.snapshotPackets += recipients;
    const alive = new Set(manager.alive.map(enemy => enemy.uid));
    for (const sent of this.w.snapshotSent) sent(alive);
  }

  dispose(): void {
    for (const replica of this.map.values()) if (replica.enemy.alive) this.w.manager.withdraw(replica.enemy);
    this.map.clear();
  }
}
