/**
 * Scripted doors and gates. A leaf is a real collider that moves, in the way the Crucible's crushers do, and a shut door leaves the
 * soldiers' route graph, so nobody plans a walk through it.
 *
 * A leaf that would close on the player stops above them and waits, so a closing door can never bury anyone in it.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Ctx } from '../core/contracts';
import { clamp } from '../core/math';
import { MOVE } from '../player/tuning';
import type { DoorDef } from './types';

const THICK = 0.3;
/** Metres either side of the leaf that count as under it. Tighter than a body pressed against it, which must not hold a door up. */
const UNDER = 0.5;
/** Past the end of a door's width, the player is beside it. */
const BESIDE = 0.6;
/** Shut enough that nobody can be routed through it. */
const ROUTE_SHUT = 0.5;

const _c = new THREE.Vector3();
const _h = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

interface Routes {
  outpost?: { routes: { setClosed(x: number, z: number, dx: number, dz: number, width: number, shut: boolean): void } } | null;
}

interface Part {
  mesh: THREE.Mesh;
  collider: RAPIER.Collider;
  /** Which way this part goes along the door's width, for a slide or a split. */
  side: number;
}

class Door {
  readonly parts: Part[] = [];
  open: number;
  target: number;
  /** Share per second. */
  rate = 0;
  done: (() => void) | null = null;
  /** Unit vector along the width. */
  readonly across = new THREE.Vector3();
  readonly through = new THREE.Vector3();

  constructor(readonly def: DoorDef, ctx: Ctx, material: THREE.Material) {
    this.open = this.target = def.start;
    const { yaw, kind } = def;
    this.through.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    this.across.set(Math.cos(yaw), 0, -Math.sin(yaw));
    _q.setFromAxisAngle(UP, yaw);
    const sides = kind === 'split' ? [-1, 1] : [1];
    for (const side of sides) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
      mesh.quaternion.copy(_q);
      mesh.castShadow = mesh.receiveShadow = true;
      ctx.render.scene.add(mesh);
      _c.set(...def.at);
      _h.set(def.width / 2, def.height / 2, THICK / 2);
      const collider = ctx.physics.addStaticBox(_c, _h, _q, 'metal');
      this.parts.push({ mesh, collider, side });
    }
    this.place();
  }

  /** A shutter rolls up into its lintel, so its bottom edge rises and its top never moves. Leaves slide away whole. */
  place(): void {
    const { def, open } = this;
    const [x, y, z] = def.at;
    for (const p of this.parts) {
      let width = def.width;
      let height = def.height;
      _c.set(x, y + def.height / 2, z);
      if (def.kind === 'shutter') {
        height = Math.max(def.height * (1 - open), 0.02);
        _c.y = y + def.height - height / 2;
      } else {
        const share = def.kind === 'split' ? 0.5 : 1;
        width = def.width * share;
        const shift = (open + (def.kind === 'split' ? 0.5 : 0)) * width * p.side;
        _c.addScaledVector(this.across, shift);
      }
      p.mesh.position.copy(_c);
      p.mesh.scale.set(width, height, THICK);
      p.collider.setTranslation(_c);
      p.collider.setHalfExtents(_h.set(width / 2, height / 2, THICK / 2));
    }
  }
}

export class Doors {
  private readonly doors = new Map<string, Door>();
  private moving = 0;

  constructor(private readonly ctx: Ctx) {}

  /** `seconds` of 0 puts it there now. */
  set(id: string, def: DoorDef, open: number, seconds: number, done: () => void): void {
    const { ctx } = this;
    let door = this.doors.get(id);
    if (!door) {
      door = new Door(def, ctx, ctx.render.materials.world(def.look ?? 'hazard'));
      this.doors.set(id, door);
    }
    door.target = clamp(open);
    this.route(door);
    if (seconds <= 0 || door.target === door.open) {
      door.open = door.target;
      door.place();
      this.settle(door, false);
      done();
      return;
    }
    const interrupted = door.done;
    if (!interrupted) this.moving++;
    door.rate = Math.abs(door.target - door.open) / seconds;
    door.done = done;
    interrupted?.();
    _v.set(...def.at);
    ctx.audio.play('crusher_rise', { position: _v });
  }

  private route(door: Door): void {
    const { def, through } = door;
    const shut = door.target < ROUTE_SHUT;
    (this.ctx.enemies as unknown as Routes).outpost?.routes.setClosed(def.at[0], def.at[2], through.x, through.z, def.width, shut);
  }

  private settle(door: Door, loud: boolean): void {
    if (door.done) this.moving--;
    const done = door.done;
    door.done = null;
    if (loud && door.open < 0.02) {
      const { ctx } = this;
      _v.set(...door.def.at);
      ctx.fx.dust(_v, UP, 3);
      ctx.camera.addTrauma(0.12);
      ctx.audio.play('crusher_slam', { position: _v, volume: 0.8 });
      ctx.audio.play('metal_clang', { position: _v, pitch: 0.6 });
    }
    done?.();
  }

  /** Lowest the shutter's edge may come with the player under it, or 0 when they are clear. */
  private headroom(door: Door): number {
    const { player } = this.ctx;
    const { def, through, across } = door;
    _v.copy(player.position).sub(_c.set(...def.at));
    if (Math.abs(_v.dot(through)) > UNDER || Math.abs(_v.dot(across)) > def.width / 2 + BESIDE) return 0;
    const body = player.sliding || player.crouched ? MOVE.crouchHeight : MOVE.standHeight;
    return _v.y + body + 0.08;
  }

  update(dt: number): void {
    if (this.moving === 0) return;
    for (const door of this.doors.values()) {
      if (!door.done) continue;
      const closing = door.target < door.open;
      const step = door.rate * dt;
      let next = closing ? Math.max(door.target, door.open - step) : Math.min(door.target, door.open + step);
      if (closing) {
        const clearance = this.headroom(door);
        if (clearance > 0) next = Math.max(next, door.def.kind === 'shutter' ? Math.min(door.open, clearance / door.def.height) : door.open);
      }
      door.open = next;
      door.place();
      if (door.open === door.target) this.settle(door, true);
    }
  }
}
