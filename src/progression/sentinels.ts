/**
 * Sentinels: three gun drones orbiting the player. They shoot through combat.fireRay, so their kills feed the combo
 * and the ladder like any other. They live on playerDt: they are the player's, and keep the player's speed in SLOWMO.
 */
import * as THREE from 'three';
import { CG, type Ctx, type LoopHandle } from '../core/contracts';
import type { EnemyInstance, ShotSpec } from '../core/gameplay';
import { damp, TAU } from '../core/math';
import { EFFECTS, SENTINEL as S } from './data';
import { ModelBuilder, type ModelMaterials } from './modelkit';

const CYAN = EFFECTS.sentinels.color;
/** Barrel tips in model space; the gun points along +Z. */
const MUZZLE_Y = -0.02;
const MUZZLE_Z = 0.52;
const MUZZLE_X = 0.13;

const _toTarget = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _anchor = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function droneModel(materials: ModelMaterials): THREE.Group {
  const b = new ModelBuilder();
  const hull = '#39424c';
  const plate = '#566270';
  // Hexagonal core with an armoured collar.
  b.cyl(0.26, 0.3, 0.2, 6, hull);
  b.cyl(0.2, 0.26, 0.1, 6, plate, { at: [0, 0.15, 0] });
  b.cyl(0.3, 0.22, 0.1, 6, plate, { at: [0, -0.15, 0] });
  // Twin barrels under a heat shroud.
  for (const s of [1, -1]) {
    b.box(0.09, 0.09, 0.3, hull, { at: [s * MUZZLE_X, MUZZLE_Y, 0.24] });
    b.cyl(0.024, 0.03, 0.34, 6, '#14181c', { at: [s * MUZZLE_X, MUZZLE_Y, 0.36], rot: [Math.PI / 2, 0, 0] });
    b.glow(new THREE.BoxGeometry(0.1, 0.012, 0.18), CYAN, 3, { at: [s * MUZZLE_X, MUZZLE_Y + 0.052, 0.22] });
    // Stabiliser vanes.
    b.box(0.34, 0.03, 0.12, plate, { at: [s * 0.42, 0.02, -0.06], rot: [0, 0, s * -0.22] });
    b.box(0.05, 0.13, 0.15, hull, { at: [s * 0.58, -0.03, -0.06] });
  }
  b.box(0.18, 0.08, 0.2, hull, { at: [0, 0.2, -0.05] });
  // Sensor eye and drive ring, so each reads as awake from across the screen.
  b.glow(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 10), CYAN, 6, { at: [0, 0.05, 0.27], rot: [Math.PI / 2, 0, 0] });
  b.glow(new THREE.TorusGeometry(0.31, 0.012, 4, 24), CYAN, 3.5, { rot: [Math.PI / 2, 0, 0], at: [0, -0.2, 0] });
  return materials.group(b);
}

interface Drone {
  group: THREE.Group;
  position: THREE.Vector3;
  target: EnemyInstance | null;
  scanIn: number;
  fireIn: number;
  left: boolean;
  deployed: number;
}

export class Sentinels {
  private readonly drones: Drone[] = [];
  private readonly near: EnemyInstance[] = [];
  private active = false;
  private orbit = 0;
  private hum: LoopHandle | null = null;
  private readonly shot: ShotSpec = { damage: S.damage, source: 'sentinel', team: 'player', maxDistance: S.range + 5, tracer: 'plasma', force: 5 };

  constructor(private readonly ctx: Ctx, materials: ModelMaterials) {
    for (let i = 0; i < S.count; i++) {
      const group = droneModel(materials);
      group.visible = false;
      ctx.render.scene.add(group);
      this.drones.push({ group, position: group.position, target: null, scanIn: i / (S.count * S.scanRate), fireIn: i / (S.count * S.fireRate), left: false, deployed: 0 });
    }
  }

  start(): void {
    this.active = true;
    this.hum = this.ctx.audio.startLoop('sentinel_orbit_loop');
    for (const d of this.drones) {
      // They launch from the player's chest and fly out to station.
      d.group.visible = true;
      d.deployed = 0;
      d.target = null;
      d.position.copy(this.ctx.player.eye);
    }
  }

  stop(): void {
    this.active = false;
    this.hum?.stop(0.2);
    this.hum = null;
    const { fx, audio } = this.ctx;
    for (const d of this.drones) {
      if (!d.group.visible) continue;
      d.group.visible = false;
      fx.sparks(d.position, _up, 18, CYAN);
      fx.ring(d.position, _up, CYAN, 2);
      audio.play('explosion_small', { position: d.position, volume: 0.5 });
    }
  }

  update(dt: number): void {
    if (!this.active || dt <= 0) return;
    const { player } = this.ctx;
    this.orbit += dt * S.orbitSpeed;
    for (let i = 0; i < this.drones.length; i++) {
      const d = this.drones[i]!;
      d.deployed = damp(d.deployed, 1, 5, dt);
      const a = this.orbit + (i / S.count) * TAU;
      const radius = S.orbitRadius * d.deployed;
      _anchor.set(
        player.eye.x + Math.cos(a) * radius,
        player.eye.y + S.orbitHeight + Math.sin(this.orbit * 1.7 + i * 2.1) * 0.25,
        player.eye.z + Math.sin(a) * radius,
      );
      // A little lag, so they swing out behind the player on a dash instead of being glued on.
      d.position.x = damp(d.position.x, _anchor.x, 16, dt);
      d.position.y = damp(d.position.y, _anchor.y, 16, dt);
      d.position.z = damp(d.position.z, _anchor.z, 16, dt);
      this.think(d, dt);
      this.aim(d, a, dt);
    }
  }

  private think(d: Drone, dt: number): void {
    d.scanIn -= dt;
    if (d.target && (!d.target.alive || d.target.center.distanceToSquared(d.position) > S.range * S.range)) d.target = null;
    if (d.scanIn <= 0) {
      d.scanIn = 1 / S.scanRate;
      d.target = this.acquire(d);
    }
    d.fireIn -= dt;
    if (d.target && d.deployed > 0.6 && d.fireIn <= 0) {
      d.fireIn = 1 / S.fireRate;
      this.fire(d);
    }
  }

  /** Nearest enemy in clear line of sight, preferring one no other drone has claimed. */
  private acquire(d: Drone): EnemyInstance | null {
    const { enemies, physics } = this.ctx;
    const count = enemies.query(d.position, S.range, this.near);
    let best: EnemyInstance | null = null;
    let bestScore = Infinity;
    for (let i = 0; i < count; i++) {
      const e = this.near[i]!;
      if (!e.alive) continue;
      let score = e.center.distanceToSquared(d.position);
      for (const other of this.drones) if (other !== d && other.target === e) score *= 4;
      if (score < bestScore) {
        _dir.subVectors(e.center, d.position);
        const len = _dir.length();
        if (physics.raycast(d.position, _dir.divideScalar(len), len, CG.World)) continue;
        best = e;
        bestScore = score;
      }
    }
    return best;
  }

  private fire(d: Drone): void {
    const { audio, combat, fx } = this.ctx;
    const t = d.target!;
    d.left = !d.left;
    _muzzle.set(d.left ? MUZZLE_X : -MUZZLE_X, MUZZLE_Y, MUZZLE_Z).applyQuaternion(d.group.quaternion).add(d.position);
    _dir.subVectors(t.center, _muzzle).normalize();
    fx.muzzleFlash(_muzzle, _dir, 'plasma');
    audio.play('sentinel_fire', { position: _muzzle });
    combat.fireRay(_muzzle, _dir, this.shot);
  }

  private aim(d: Drone, orbitAngle: number, dt: number): void {
    if (d.target) _toTarget.copy(d.target.center);
    else {
      // Idle drones watch outward along the orbit, like sentries.
      _toTarget.set(d.position.x + Math.cos(orbitAngle) * 5, d.position.y, d.position.z + Math.sin(orbitAngle) * 5);
    }
    _m.lookAt(_toTarget, d.position, _up);
    // Matrix4.lookAt points -Z; the model's gun is +Z.
    _q.setFromRotationMatrix(_m).multiply(FLIP);
    d.group.quaternion.slerp(_q, 1 - Math.exp(-18 * dt));
  }

  clear(): void {
    this.active = false;
    this.hum?.stop(0.05);
    this.hum = null;
    for (const d of this.drones) {
      d.group.visible = false;
      d.target = null;
    }
  }
}

const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
