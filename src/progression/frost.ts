/**
 * Frost Nova: one use, an ice front runs out from the player and locks every enemy it reaches. Enemies hold the frozen
 * rule themselves (no thinking, 3x damage, shatter on death); this draws the front and the ice shells.
 */
import * as THREE from 'three';
import type { Ctx } from '../core/contracts';
import type { EnemyInstance, KillEvent } from '../core/gameplay';
import { rand, randomUnit, TAU } from '../core/math';
import { EFFECTS, FROST } from './data';

const SHARDS_PER_ENEMY = 9;
const MAX_FROZEN = 48;
const ICE = EFFECTS.frostNova.color;

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _axis = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

interface Shell {
  enemy: EnemyInstance | null;
  /** Local offsets are fixed at freeze time, so the shell keeps its shape. */
  offsets: Float32Array;
  axes: Float32Array;
  sizes: Float32Array;
  grown: number;
}

export class FrostNova {
  private readonly mesh: THREE.InstancedMesh;
  private readonly shells: Shell[] = [];
  private readonly near: EnemyInstance[] = [];
  private readonly front = new THREE.Vector3();
  private radius = -1;

  constructor(private readonly ctx: Ctx) {
    const material = ctx.render.materials.patch(new THREE.MeshStandardMaterial({
      color: '#bfefff', emissive: new THREE.Color('#5fc8ff').multiplyScalar(0.8), roughness: 0.1, metalness: 0, flatShading: true,
    }));
    const shard = new THREE.ConeGeometry(0.5, 2.2, 5, 1);
    this.mesh = new THREE.InstancedMesh(shard, material, MAX_FROZEN * SHARDS_PER_ENEMY);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    ctx.render.scene.add(this.mesh);
    for (let i = 0; i < MAX_FROZEN; i++) {
      this.shells.push({
        enemy: null, offsets: new Float32Array(SHARDS_PER_ENEMY * 3), axes: new Float32Array(SHARDS_PER_ENEMY * 3),
        sizes: new Float32Array(SHARDS_PER_ENEMY), grown: 0,
      });
    }
  }

  /** The nova goes off here. */
  cast(): void {
    const { audio, camera, fx, player, render } = this.ctx;
    this.front.copy(player.position);
    this.radius = 0;
    audio.play('frost_nova_blast');
    fx.ring(this.front, _up, ICE, FROST.radius * 2);
    fx.frostShatter(player.eye, _up, 2);
    render.post.flash(ICE, 0.8, 0.5);
    render.post.chromatic(0.6, 0.4);
    camera.fovPunch(-5, 0.3);
    camera.addTrauma(0.3);
  }

  private freeze(e: EnemyInstance): void {
    const shell = this.shells.find(s => s.enemy === e) ?? this.shells.find(s => s.enemy === null);
    e.frozen = FROST.freezeSeconds;
    if (!shell || shell.enemy === e) return;
    shell.enemy = e;
    shell.grown = 0;
    const height = e.char.rig.height;
    for (let i = 0; i < SHARDS_PER_ENEMY; i++) {
      randomUnit(_axis);
      _axis.y = Math.abs(_axis.y) * 0.8 + 0.2;
      _axis.normalize();
      const a = rand(0, TAU);
      shell.offsets[i * 3] = Math.cos(a) * rand(0.1, 0.35) * height * 0.5;
      shell.offsets[i * 3 + 1] = rand(-0.45, 0.45) * height;
      shell.offsets[i * 3 + 2] = Math.sin(a) * rand(0.1, 0.35) * height * 0.5;
      shell.axes[i * 3] = _axis.x;
      shell.axes[i * 3 + 1] = _axis.y;
      shell.axes[i * 3 + 2] = _axis.z;
      shell.sizes[i] = rand(0.26, 0.5) * height * 0.5;
    }
    this.ctx.audio.play('freeze_crackle', { position: e.center });
    this.ctx.fx.sparks(e.center, _up, 14, ICE);
  }

  onKill(e: KillEvent): void {
    if (e.enemy.frozen <= 0) return;
    const { audio, fx } = this.ctx;
    fx.frostShatter(e.enemy.center, e.damage.dir, Math.max(1, e.enemy.char.rig.height / 1.85));
    audio.play('frozen_shatter', { position: e.enemy.center });
  }

  update(dt: number): void {
    if (this.radius >= 0) {
      this.radius += FROST.frontSpeed * dt;
      const count = this.ctx.enemies.query(this.front, Math.min(this.radius, FROST.radius), this.near);
      for (let i = 0; i < count; i++) {
        const e = this.near[i]!;
        if (e.alive && e.frozen <= 0) this.freeze(e);
      }
      if (this.radius >= FROST.radius) this.radius = -1;
    }

    let n = 0;
    for (const shell of this.shells) {
      const e = shell.enemy;
      if (!e) continue;
      if (!e.alive || e.frozen <= 0) {
        shell.enemy = null;
        continue;
      }
      // Ice arrives at full size in a blink: peak on frame one, with just enough growth to read as a freeze.
      shell.grown = Math.min(1, shell.grown + dt * 9);
      for (let i = 0; i < SHARDS_PER_ENEMY; i++) {
        _p.set(shell.offsets[i * 3]!, shell.offsets[i * 3 + 1]!, shell.offsets[i * 3 + 2]!).add(e.center);
        _axis.set(shell.axes[i * 3]!, shell.axes[i * 3 + 1]!, shell.axes[i * 3 + 2]!);
        _q.setFromUnitVectors(_up, _axis);
        _s.setScalar(shell.sizes[i]! * shell.grown);
        _m.compose(_p, _q, _s);
        this.mesh.setMatrixAt(n++, _m);
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = n > 0;
  }

  clear(): void {
    this.radius = -1;
    for (const shell of this.shells) shell.enemy = null;
    this.mesh.count = 0;
  }
}
