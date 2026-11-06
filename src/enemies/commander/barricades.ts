/**
 * Steel shutters that drop across a door and change the map under the player's feet (section 16.3). A shutter is a real collider, and
 * the door leaves the soldiers' route graph, so nobody walks through it. Explosives take it down. Never more than two, and never the
 * last way out of anywhere: the Kill House gives every room at least three exits, and this keeps at least two of them.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Door } from '../outpost/squad';
import type { Commander } from './index';

const MAX_SHUTTERS = 2;
const HEIGHT = 4.1;
const THICK = 0.22;
/** Blasts it takes. */
const STRENGTH = 2;
/** Nothing lands on a player standing in the doorway. */
const CLEARANCE = 5;
const DROP_SECONDS = 0.28;

const _a = new THREE.Vector3();
const _half = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

interface Shutter {
  door: Door;
  mesh: THREE.Mesh;
  collider: RAPIER.Collider;
  hp: number;
  /** Seconds left of it falling. */
  falling: number;
  floor: number;
}

export class Barricades {
  private readonly shutters: Shutter[] = [];
  private material: THREE.Material | null = null;
  private allDoors: readonly Door[] | null = null;

  constructor(private readonly c: Commander) {}

  private build(door: Door, floor: number): Shutter {
    const { ctx } = this.c.w;
    this.material ??= ctx.render.materials.world('hazard');
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(door.w, HEIGHT, THICK), this.material);
    const yaw = Math.atan2(door.dx, door.dz);
    mesh.rotation.y = yaw;
    mesh.position.set(door.x, floor + HEIGHT + 2, door.z);
    mesh.castShadow = true;
    ctx.render.scene.add(mesh);
    _a.set(door.x, floor + HEIGHT / 2, door.z);
    _half.set(door.w / 2, HEIGHT / 2, THICK / 2 + 0.12);
    _q.setFromAxisAngle(_up, yaw);
    const collider = ctx.physics.addStaticBox(_a, _half, _q, 'metal');
    return { door, mesh, collider, hp: STRENGTH, falling: DROP_SECONDS, floor };
  }

  /** Seals up to `count` of the doors the player uses most. Returns how many came down. */
  drop(count: number): number {
    const { c } = this;
    const { o, tracker, w } = c;
    this.allDoors ??= o.doors;
    let sealed = 0;
    const all = this.allDoors;
    for (const i of tracker.hotDoors(6)) {
      if (sealed >= count || this.shutters.length >= MAX_SHUTTERS) break;
      const door = all[i];
      if (!door || this.shutters.some(s => s.door === door)) continue;
      if (Math.hypot(w.player.position.x - door.x, w.player.position.z - door.z) < CLEARANCE) continue;
      if (!c.posts.doorFloor(door, _a)) continue;
      this.shutters.push(this.build(door, _a.y));
      o.routes.setClosed(door.x, door.z, door.dx, door.dz, door.w, true);
      sealed++;
    }
    if (sealed > 0) o.doors = all.filter(d => !this.shutters.some(s => s.door === d));
    return sealed;
  }

  update(dt: number): void {
    const { ctx } = this.c.w;
    for (const s of this.shutters) {
      if (s.falling <= 0) continue;
      s.falling -= dt;
      const t = Math.max(0, s.falling / DROP_SECONDS);
      s.mesh.position.y = s.floor + HEIGHT / 2 + t * t * (HEIGHT + 2);
      if (s.falling > 0) continue;
      _a.set(s.door.x, s.floor + 0.2, s.door.z);
      ctx.fx.dust(_a, _up, 3);
      ctx.camera.addTrauma(0.15);
      ctx.audio.play('metal_clang', { position: _a, pitch: 0.6 });
      ctx.audio.play('crusher_slam', { position: _a, volume: 0.8 });
    }
  }

  onBlast(center: THREE.Vector3, radius: number): void {
    for (let i = this.shutters.length - 1; i >= 0; i--) {
      const s = this.shutters[i]!;
      if (Math.hypot(center.x - s.door.x, center.z - s.door.z) > radius + s.door.w / 2) continue;
      if (--s.hp > 0) continue;
      this.breach(i);
    }
  }

  private breach(index: number): void {
    const { o, w } = this.c;
    const { ctx } = w;
    const s = this.shutters[index]!;
    _a.set(s.door.x, s.floor + 1.4, s.door.z);
    ctx.fx.chips(_a, 0xff9000, 18);
    ctx.fx.sparks(_a, _up, 24, 0xffd0a0);
    ctx.audio.play('metal_groan', { position: _a });
    this.remove(s);
    this.shutters.splice(index, 1);
    o.doors = (this.allDoors ?? o.doors).filter(d => !this.shutters.some(x => x.door === d));
  }

  private remove(s: Shutter): void {
    const { o, w } = this.c;
    s.mesh.removeFromParent();
    s.mesh.geometry.dispose();
    w.ctx.physics.world.removeCollider(s.collider, true);
    o.routes.setClosed(s.door.x, s.door.z, s.door.dx, s.door.dz, s.door.w, false);
  }

  reset(): void {
    for (const s of this.shutters) this.remove(s);
    this.shutters.length = 0;
    if (this.allDoors) this.c.o.doors = this.allDoors;
  }

  get count(): number {
    return this.shutters.length;
  }
}
