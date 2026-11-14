/**
 * A shopkeeper behind each counter (Outpost Defense): a rifleman's body in the allies' kit, idle at the fort's `keeper` point (or just
 * behind the counter until the fort has one), turning to face the player when he comes near and nodding when he buys. Not an ally:
 * not in the squad or on the minimap, never shot at, and nothing he does touches the fight.
 */
import * as THREE from 'three';
import { HumanoidBone as B } from '../../characters/rig';
import type { CharacterInstance, Ctx } from '../../core/contracts';
import { dampAngle } from '../../core/math';
import type { ShopId } from './data';

/** The body: the rifleman's. */
const BODY = 'trooper';
/** He turns to the player inside this, and animates at full rate inside `NEAR`, skips frames out to `FAR`, and stops past it. */
const WATCH = 7;
const NEAR = 20;
const FAR = 60;
/** Seconds between tries while the body is not loaded yet. */
const RETRY = 1;

export interface KeeperPoint {
  readonly pos: THREE.Vector3;
  /** Which way he faces with nobody near, as a body's yaw (0 faces +z). */
  readonly yaw: number;
}

interface Keeper {
  id: ShopId;
  char: CharacterInstance;
  at: KeeperPoint;
  yaw: number;
}

const LOCO = { speed: 0, moveX: 0, moveZ: 0, aimYaw: 0, aimPitch: 0, grounded: true };
const _d = new THREE.Vector3();

export class Keepers {
  private readonly men: Keeper[] = [];
  private tryAt = 0;

  constructor(private readonly ctx: Ctx, private readonly points: readonly { id: ShopId; at: KeeperPoint }[]) {}

  /** Once a frame. The bodies go up the first frame they can. */
  update(dt: number): void {
    const { ctx } = this;
    if (this.men.length === 0) {
      if (ctx.time.elapsed < this.tryAt) return;
      this.tryAt = ctx.time.elapsed + RETRY;
      this.raise();
      return;
    }
    const p = ctx.player.position;
    for (const k of this.men) {
      const dx = p.x - k.at.pos.x, dz = p.z - k.at.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > FAR) continue;
      const watching = d < WATCH && Math.abs(p.y - k.at.pos.y) < 2.5;
      k.yaw = dampAngle(k.yaw, watching ? Math.atan2(dx, dz) : k.at.yaw, 4, dt);
      k.char.root.rotation.y = k.yaw;
      k.char.anim.setLocomotion(LOCO);
      k.char.anim.update(dt, d < NEAR ? 0 : 1);
    }
  }

  /** A nod over the counter: something was bought at `id`. */
  nod(id: ShopId): void {
    const k = this.men.find(m => m.id === id);
    if (!k) return;
    _d.set(Math.sin(k.yaw), -1.4, Math.cos(k.yaw)).normalize();
    k.char.anim.flinch(B.head, _d, 0.6);
  }

  private raise(): void {
    const { ctx } = this;
    if (!ctx.render?.scene) return;
    for (const { id, at } of this.points) {
      let char: CharacterInstance;
      try {
        char = ctx.characters.spawn(BODY);
      } catch {
        // Not loaded yet: the next try.
        for (const m of this.men) {
          m.char.root.removeFromParent();
          ctx.allies?.props.strip(m.char);
          m.char.release();
        }
        this.men.length = 0;
        return;
      }
      char.root.position.copy(at.pos);
      char.root.rotation.y = at.yaw;
      (char.anim as { setPosture?(name: string): void }).setPosture?.('stand');
      ctx.allies?.props.fit(char);
      ctx.render.scene.add(char.root);
      this.men.push({ id, char, at, yaw: at.yaw });
    }
  }
}
