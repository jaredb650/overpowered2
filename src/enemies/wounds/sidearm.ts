/**
 * The pistol a man falls back on when he cannot hold his rifle. It lives on the pooled body like a plate does, out of sight until
 * it is drawn. In the right hand it is the animator's ordinary one-handed grip. The left hand has no grip of its own, so there it is
 * the `pistol` posture that holds it out.
 */
import * as THREE from 'three';
import type { CharacterInstance, Ctx } from '../../core/contracts';
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

interface PendingDraw {
  right: boolean;
  still?: () => boolean;
}

export class Sidearms {
  private model: THREE.Mesh | null = null;
  private loading = false;
  private readonly carried = new WeakMap<CharacterInstance, Pair>();
  private readonly pending = new Map<Enemy, PendingDraw>();

  constructor(private readonly ctx: Ctx) {}

  init(): void {
    if (this.model || this.loading) return;
    const armoury = this.ctx.characters as unknown as Armoury;
    const load = armoury.prop?.('pistol');
    if (!load) return;
    this.loading = true;
    void load.then(
      mesh => {
        this.model = mesh;
        this.loading = false;
        for (const [e, req] of this.pending) {
          if (e.alive && (!req.still || req.still())) this.attach(e, req.right);
        }
        this.pending.clear();
      },
      () => {
        this.loading = false;
        this.pending.clear();
      },
    );
  }

  /** Clears queued draws on run reset. */
  clear(): void {
    this.pending.clear();
  }

  /** True while this enemy is waiting on the pistol mesh to finish loading before attaching. */
  isPending(e: Enemy): boolean {
    return this.pending.has(e);
  }

  /** Out of sight on a body that has only just come out of the pool, which shows everything attached to it. */
  holster(e: Enemy): void {
    this.pending.delete(e);
    const pair = this.carried.get(e.char);
    if (!pair) return;
    if (pair.left) pair.left.visible = false;
    if (pair.right) pair.right.visible = false;
  }

  draw(e: Enemy, right: boolean, still?: () => boolean): boolean {
    if (!this.model) {
      if (!this.loading) this.init();
      if (this.loading) this.pending.set(e, { right, still });
      return false;
    }
    this.pending.delete(e);
    return this.attach(e, right);
  }

  private attach(e: Enemy, right: boolean): boolean {
    if (!this.model) return false;
    const armoury = this.ctx.characters as unknown as Armoury;
    const socket = armoury.sockets?.(e.id)[right ? 'handR' : 'handL'];
    if (!socket) return false;
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
    if (!right) return true;
    (e.char.anim as unknown as Gripping).setGrip?.({
      socketPos: mesh.position.clone(), socketRot: mesh.quaternion.clone(), foregrip: null,
    });
    return true;
  }
}
