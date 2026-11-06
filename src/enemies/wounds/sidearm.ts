/**
 * The pistol a man falls back on when he cannot hold his rifle. It lives on the pooled body like a plate does, out of sight until
 * it is drawn. In the right hand it is the animator's ordinary one-handed grip. The left hand has no grip of its own, so there it is
 * the `pistol` posture that holds it out.
 */
import * as THREE from 'three';
import type { CharacterInstance } from '../../core/contracts';
import type { Ctx } from '../../core/contracts';
import type { Socket } from '../../characters/format';
import type { Enemy } from '../Enemy';

interface Armoury {
  prop?(id: string): Promise<THREE.Mesh>;
  sockets?(archetype: string): Record<string, Socket>;
}

interface Attachable {
  attachProp(bone: number, prop: THREE.Object3D): void;
}

interface Gripping {
  setGrip?(grip: { socketPos: THREE.Vector3; socketRot: THREE.Quaternion; foregrip: THREE.Vector3 | null } | null): void;
}

interface Pair {
  left: THREE.Mesh | null;
  right: THREE.Mesh | null;
}

export class Sidearms {
  private model: THREE.Mesh | null = null;
  private readonly carried = new WeakMap<CharacterInstance, Pair>();

  constructor(private readonly ctx: Ctx) {}

  init(): void {
    const armoury = this.ctx.characters as unknown as Armoury;
    void armoury.prop?.('pistol').then(mesh => {
      this.model = mesh;
    });
  }

  /** Out of sight on a body that has only just come out of the pool, which shows everything attached to it. */
  holster(e: Enemy): void {
    const pair = this.carried.get(e.char);
    if (!pair) return;
    if (pair.left) pair.left.visible = false;
    if (pair.right) pair.right.visible = false;
  }

  draw(e: Enemy, right: boolean): void {
    if (!this.model) return;
    const armoury = this.ctx.characters as unknown as Armoury;
    const socket = armoury.sockets?.(e.id)[right ? 'handR' : 'handL'];
    if (!socket) return;
    let pair = this.carried.get(e.char);
    if (!pair) {
      pair = { left: null, right: null };
      this.carried.set(e.char, pair);
    }
    let mesh = right ? pair.right : pair.left;
    if (!mesh) {
      mesh = this.model.clone();
      mesh.position.set(socket.pos[0], socket.pos[1], socket.pos[2]);
      mesh.quaternion.set(socket.rot[0], socket.rot[1], socket.rot[2], socket.rot[3]);
      mesh.scale.setScalar(e.char.rig.height / 1.85);
      (e.char as unknown as Attachable).attachProp(socket.bone, mesh);
      if (right) pair.right = mesh;
      else pair.left = mesh;
    }
    mesh.visible = true;
    if (!right) return;
    (e.char.anim as unknown as Gripping).setGrip?.({
      socketPos: mesh.position.clone(), socketRot: mesh.quaternion.clone(), foregrip: null,
    });
  }
}
