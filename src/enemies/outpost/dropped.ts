/**
 * Guns on the floor. A broken man's weapon leaves his hands as its own mesh, so it stays where he dropped it after he has
 * gone. Cheap arcs with no physics body, for the same reason armour plates have none: nothing needs to hit them.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import { rand } from '../../core/math';
import { HumanoidBone as B } from '../../characters/rig';
import type { Enemy } from '../Enemy';

const MAX_DROPPED = 16;
const GRAVITY = 16;
/** A hand-held prop, as the library attaches it. */
interface Carried {
  bone: number;
  object: THREE.Object3D;
}
interface Holding {
  props?: readonly Carried[];
}

interface Drop {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  resting: boolean;
}

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _spin = new THREE.Euler();
const _flat = new THREE.Euler();

export class DroppedWeapons {
  private readonly drops: Drop[] = [];
  private cursor = 0;

  constructor(private readonly ctx: Ctx) {}

  /** Lets go of everything in his hands. */
  drop(e: Enemy): void {
    const props = (e.char as unknown as Holding).props;
    if (!props) return;
    for (const p of props) {
      if ((p.bone !== B.handR && p.bone !== B.handL) || !p.object.visible || !(p.object instanceof THREE.Mesh)) continue;
      this.release(p.object, e);
      p.object.visible = false;
    }
  }

  private release(from: THREE.Mesh, e: Enemy): void {
    const d = this.slot(from);
    from.getWorldPosition(_p);
    from.getWorldQuaternion(_q);
    from.getWorldScale(_s);
    d.mesh.position.copy(_p);
    d.mesh.quaternion.copy(_q);
    d.mesh.scale.copy(_s);
    d.mesh.visible = true;
    d.resting = false;
    d.velocity.set(e.velocity.x * 0.5 + rand(-0.8, 0.8), rand(0.6, 1.6), e.velocity.z * 0.5 + rand(-0.8, 0.8));
    d.spin.set(rand(-5, 5), rand(-3, 3), rand(-5, 5));
  }

  /** Oldest out once the cap is reached. */
  private slot(from: THREE.Mesh): Drop {
    if (this.drops.length < MAX_DROPPED) {
      const mesh = new THREE.Mesh(from.geometry, from.material);
      mesh.castShadow = true;
      this.ctx.render.scene.add(mesh);
      const d: Drop = { mesh, velocity: new THREE.Vector3(), spin: new THREE.Vector3(), resting: false };
      this.drops.push(d);
      return d;
    }
    const d = this.drops[this.cursor]!;
    this.cursor = (this.cursor + 1) % MAX_DROPPED;
    d.mesh.geometry = from.geometry;
    d.mesh.material = from.material;
    return d;
  }

  update(dt: number): void {
    const nav = this.ctx.world.nav;
    for (const d of this.drops) {
      if (d.resting || !d.mesh.visible) continue;
      d.velocity.y -= GRAVITY * dt;
      d.mesh.position.addScaledVector(d.velocity, dt);
      _spin.set(d.spin.x * dt, d.spin.y * dt, d.spin.z * dt);
      d.mesh.quaternion.multiply(_q.setFromEuler(_spin));
      const ground = nav.groundHeight(d.mesh.position.x, d.mesh.position.y + 0.5, d.mesh.position.z);
      if (Number.isNaN(ground) || d.mesh.position.y > ground + 0.06) continue;
      d.mesh.position.y = ground + 0.06;
      if (d.velocity.y < -2.2) {
        // One clatter, then it lies down on its side.
        d.velocity.y *= -0.3;
        d.velocity.x *= 0.5;
        d.velocity.z *= 0.5;
        d.spin.multiplyScalar(0.4);
        this.ctx.audio.play('casing_rifle', { position: d.mesh.position, volume: 0.7, pitch: 0.6 });
        continue;
      }
      d.resting = true;
      _flat.setFromQuaternion(d.mesh.quaternion, 'YXZ');
      d.mesh.quaternion.setFromEuler(_flat.set(0, _flat.y, Math.PI / 2, 'YXZ'));
    }
  }

  clear(): void {
    for (const d of this.drops) d.mesh.visible = false;
    this.cursor = 0;
  }
}
