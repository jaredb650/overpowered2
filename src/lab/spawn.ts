/** Puts test bodies in the world and takes them away. Dev only, so it reaches into the concrete enemy classes. */
import * as THREE from 'three';
import { CG, type Ctx } from '../core/contracts';
import type { EnemyId } from '../core/gameplay';
import type { Behaviour } from '../enemies/brain';
import { ENEMIES } from '../enemies/data';
import type { Enemy } from '../enemies/Enemy';
import type { EnemyManager } from '../enemies/EnemyManager';
import type { AiMode } from './settings';

const REACH = 40;
/** Nothing is placed on top of the player, however close the crosshair is. */
const CLEARANCE = 2.2;
const DRONE_HEIGHT = 2.4;
const PATROL_HALF = 5;
const PATROL_PACE = 0.75;
const TURN_AT = 0.8;

interface Route {
  a: THREE.Vector3;
  b: THREE.Vector3;
}

const routes = new WeakMap<Enemy, Route>();

/** Back and forth along one line, for testing hits on a moving body. Nothing else: no attacks, no reaction. */
const PATROL: Behaviour = {
  name: 'patrol',
  score: () => 1,
  enter(e) {
    e.mode = 'point';
    e.face = 'move';
    e.pace = PATROL_PACE;
    e.moveTarget.copy(routes.get(e)!.a);
  },
  frame(e) {
    if (Math.hypot(e.moveTarget.x - e.position.x, e.moveTarget.z - e.position.z) > TURN_AT) return;
    const route = routes.get(e)!;
    e.moveTarget.copy(e.moveTarget.equals(route.a) ? route.b : route.a);
  },
};

const NO_BEHAVIOURS: Behaviour[] = [];
const PATROLLING: Behaviour[] = [PATROL];

const _at = new THREE.Vector3();
const _p = new THREE.Vector3();
const _right = new THREE.Vector3();
const _flat = new THREE.Vector3();

export class LabSpawner {
  private readonly enemies: EnemyManager;

  constructor(private readonly ctx: Ctx) {
    this.enemies = ctx.enemies as unknown as EnemyManager;
  }

  /** Writes where the crosshair lands on the floor, kept clear of walls and of the player, into `out`. */
  private aimPoint(radius: number, out: THREE.Vector3): THREE.Vector3 {
    const { physics, player, world } = this.ctx;
    const hit = physics.raycast(player.eye, player.forward, REACH, CG.World);
    if (hit) out.copy(hit.point).addScaledVector(hit.normal, radius + 0.3);
    else out.copy(player.eye).addScaledVector(player.forward, REACH);
    _flat.subVectors(out, player.position).setY(0);
    const away = _flat.length();
    const least = radius + CLEARANCE;
    if (away < least) {
      if (away < 0.01) _flat.set(player.forward.x, 0, player.forward.z);
      _flat.setLength(least);
      out.x = player.position.x + _flat.x;
      out.z = player.position.z + _flat.z;
    }
    const ground = world.nav.groundHeight(out.x, out.y + 1.5, out.z);
    if (!Number.isNaN(ground)) out.y = ground;
    else if (world.nav.nearest(out, 12, _p)) out.copy(_p);
    return out;
  }

  /** Spawns `count` in a line across the view, centred on the crosshair. Returns how many fitted under the cap. */
  atCrosshair(id: EnemyId, ai: AiMode, count: number): number {
    const { player, world } = this.ctx;
    const radius = ENEMIES[id].radius;
    this.aimPoint(radius, _at);
    _right.set(-player.forward.z, 0, player.forward.x).normalize();
    const gap = radius * 2 + 1;
    let placed = 0;
    for (let i = 0; i < count; i++) {
      const offset = (i - (count - 1) / 2) * gap;
      _p.copy(_at).addScaledVector(_right, offset);
      const ground = world.nav.groundHeight(_p.x, _p.y + 1.5, _p.z);
      if (Number.isNaN(ground)) continue;
      _p.y = ground;
      if (this.place(id, _p, ai)) placed++;
    }
    return placed;
  }

  place(id: EnemyId, at: THREE.Vector3, ai: AiMode): Enemy | null {
    const e = this.enemies.spawn(id, at);
    if (!e) return null;
    const { player } = this.ctx;
    e.yaw = Math.atan2(player.position.x - at.x, player.position.z - at.z);
    if (ai === 'on') return e;
    e.attacks = [];
    e.barkAt = Infinity;
    if (ai === 'patrol' && id !== 'drone') {
      _right.set(Math.cos(e.yaw), 0, -Math.sin(e.yaw));
      routes.set(e, {
        a: at.clone().addScaledVector(_right, PATROL_HALF),
        b: at.clone().addScaledVector(_right, -PATROL_HALF),
      });
      e.behaviours = PATROLLING;
      return e;
    }
    e.behaviours = NO_BEHAVIOURS;
    e.mode = 'hold';
    e.face = 'lock';
    e.dummy = true;
    if (id === 'drone') {
      e.pinned = true;
      e.position.y += DRONE_HEIGHT;
    }
    return e;
  }

  killAll(): void {
    this.enemies.killAll('lab');
  }

  /** Corpses, limbs, chunks, blood and plate debris. The living are left alone. */
  clearBodies(): void {
    const { gore, render } = this.ctx;
    gore.clear();
    render.decals.clear();
    this.enemies.debris.clear();
  }
}
