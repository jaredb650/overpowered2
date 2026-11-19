/**
 * What a swing draws in the air: its crescents, rings, dash streaks and the slam of a cleave. `Melee` draws them through
 * this, and in co-op each is also told to the other players (`melee:fx`, sent by net/world/remoteFire.ts), who draw the same
 * thing in the same place: a slash is laid out in the world round the swinger, so from outside it is at their blade.
 */
import * as THREE from 'three';
import type { Ctx, SlashKind } from '../../core/contracts';
import type { MeleeFx } from '../../core/gameplay';

export class MeleeShow {
  /** Reused: read at once by whoever listens. */
  private readonly told: MeleeFx = { kind: 'slash', a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), x: 0, y: 0, look: 'light' };

  constructor(private readonly ctx: Ctx) {}

  slash(center: THREE.Vector3, normal: THREE.Vector3, start: THREE.Vector3, arc: number, radius: number, kind: SlashKind): void {
    this.ctx.fx.slash(center, normal, start, arc, radius, kind);
    this.tell('slash', center, normal, start, arc, radius, kind);
  }

  ring(position: THREE.Vector3, dir: THREE.Vector3, color: number, size: number): void {
    this.ctx.fx.ring(position, dir, color, size);
    this.tell('ring', position, dir, null, color, size, 'light');
  }

  dashStreaks(position: THREE.Vector3, dir: THREE.Vector3): void {
    this.ctx.fx.dashStreaks(position, dir);
    this.tell('streaks', position, dir, null, 0, 0, 'light');
  }

  /** The cleave going into the floor at `position`, the blade lying `along`. */
  slam(position: THREE.Vector3, impact: number, along: THREE.Vector3): void {
    this.ctx.fx.slam(position, impact);
    this.tell('slam', position, along, null, impact, 0, 'light');
  }

  /** A sound of the swing that the swinger hears in their own head: the others hear it from the swinger. */
  sound(id: string, pitch = 1): void {
    this.tell('sound', this.ctx.player.eye, null, null, pitch, 0, id);
  }

  private tell(kind: MeleeFx['kind'], a: THREE.Vector3, b: THREE.Vector3 | null, c: THREE.Vector3 | null, x: number, y: number, look: string): void {
    if (!this.ctx.coop) return;
    const t = this.told;
    t.kind = kind;
    t.a.copy(a);
    if (b) t.b.copy(b);
    else t.b.set(0, 1, 0);
    if (c) t.c.copy(c);
    else t.c.set(0, 0, 0);
    t.x = x;
    t.y = y;
    t.look = look;
    this.ctx.events.emit('melee:fx', t);
  }
}
