/** Puts test bodies in the world and takes them away. Dev only, so it reaches into the concrete enemy classes. */
import * as THREE from 'three';
import type { VehicleKind } from '../campaign/types';
import { CG, type Ctx } from '../core/contracts';
import type { EnemyId } from '../core/gameplay';
import type { Behaviour } from '../enemies/brain';
import { ENEMIES } from '../enemies/data';
import type { Enemy } from '../enemies/Enemy';
import type { EnemyManager } from '../enemies/EnemyManager';
import { VEHICLES } from '../enemies/vehicles';
import type { CallInManager } from '../progression/callins/manager';
import type { Objects } from '../world/objects';
import { WALL } from '../world/structures';
import type { AiMode } from './settings';

const REACH = 40;
/** Where a spawn goes when the crosshair is on open sky. */
const SKY_DROP = 14;
/** Nothing is placed on top of the player, however close the crosshair is. */
const CLEARANCE = 2.2;
const DRONE_HEIGHT = 2.4;
const PATROL_HALF = 5;
const PATROL_PACE = 0.75;
const TURN_AT = 0.8;
/** A lab vehicle stops this short of where it was spawned, and a chopper comes in at this height. */
const DRIVE_IN = 24;
/** The Lance's column starts this far ahead of the player, and looks this far for the wall that ends it. */
const COLUMN_FROM = 8;
const COLUMN_REACH = 70;
const CHOPPER_HEIGHT = 20;

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
    else out.set(player.forward.x, 0, player.forward.z).setLength(SKY_DROP).add(player.eye);
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

  /**
   * Targets for the Quiver: `count` of `id` in a loose arc ahead of the player, 20 to 28 m out and inside the paint cone,
   * so a hold paints them one after another without a sweep. Returns how many stood.
   */
  spread(id: EnemyId, ai: AiMode, count: number): number {
    const { player, world } = this.ctx;
    _flat.set(player.forward.x, 0, player.forward.z).normalize();
    _right.set(-_flat.z, 0, _flat.x);
    let placed = 0;
    for (let i = 0; i < count; i++) {
      const across = count > 1 ? i / (count - 1) - 0.5 : 0;
      // Side by side more than one behind another, so no one stands in the path to the next one's mark.
      const out = 20 + (i % 3) * 4;
      _p.copy(player.position).addScaledVector(_flat, out).addScaledVector(_right, across * out * 0.26);
      const ground = world.nav.groundHeight(_p.x, _p.y + 3, _p.z);
      if (Number.isNaN(ground)) continue;
      _p.y = ground;
      if (this.place(id, _p, ai)) placed++;
    }
    return placed;
  }

  /**
   * Targets for the Lance: `count` of `id` one behind another straight down the crosshair, from 8 m out and `gap` apart, for
   * a beam to go through. With `beside`, every third has a bystander 1.7 m to one side, off the line, for the bursts to
   * reach. The column is closed up to fit the clear floor ahead, and nobody is stood on a step or a block, where a level
   * beam would pass over the rest. Returns how many stood, bystanders included.
   */
  column(id: EnemyId, ai: AiMode, count: number, gap = 1.8, beside = true): number {
    const { physics, player, world } = this.ctx;
    _flat.set(player.forward.x, 0, player.forward.z).normalize();
    _right.set(-_flat.z, 0, _flat.x);
    // Chest height, level: what a beam down the column has to clear.
    _at.copy(player.position);
    _at.y += 1.1;
    const wall = physics.raycast(_at, _flat, COLUMN_REACH, CG.World);
    const room = (wall ? wall.distance : COLUMN_REACH) - COLUMN_FROM - 1.5;
    const step = count > 1 ? Math.min(gap, Math.max(room, 0) / (count - 1)) : 0;
    let placed = 0;
    for (let i = 0; i < count; i++) {
      const sides = beside && i % 3 === 1 ? 2 : 1;
      for (let k = 0; k < sides; k++) {
        _p.copy(player.position).addScaledVector(_flat, COLUMN_FROM + i * step);
        if (k === 1) _p.addScaledVector(_right, i % 2 ? 1.7 : -1.7);
        const ground = world.nav.groundHeight(_p.x, _p.y + 1.5, _p.z);
        if (Number.isNaN(ground) || Math.abs(ground - player.position.y) > 0.4) continue;
        _p.y = ground;
        if (this.place(id, _p, ai)) placed++;
      }
    }
    return placed;
  }

  /**
   * One of `id` at each distance in `fronts`, meters from the eye to the front of its body along the crosshair, every other
   * one 0.35 m to the side so each shows past the last. `backs` turns them all to face away. Returns how many stood.
   */
  reachLine(id: EnemyId, ai: AiMode, fronts: readonly number[], backs: boolean): number {
    const { player, world } = this.ctx;
    _flat.set(player.forward.x, 0, player.forward.z).normalize();
    _right.set(-_flat.z, 0, _flat.x);
    const radius = ENEMIES[id].radius * 0.85;
    let placed = 0;
    for (let i = 0; i < fronts.length; i++) {
      _p.copy(player.position).addScaledVector(_flat, fronts[i]! + radius).addScaledVector(_right, i % 2 === 0 ? 0.35 : -0.35);
      const ground = world.nav.groundHeight(_p.x, _p.y + 3, _p.z);
      if (Number.isNaN(ground)) continue;
      _p.y = ground;
      const e = this.place(id, _p, ai);
      if (!e) continue;
      if (backs) e.yaw += Math.PI;
      placed++;
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

  /** Off, it sits parked at the crosshair to be shot at. On, it comes from behind the crosshair and drives past the player. */
  vehicle(kind: VehicleKind, ai: AiMode): void {
    const vehicles = this.enemies.vehicles;
    if (!vehicles) return;
    const { player } = this.ctx;
    this.aimPoint(VEHICLES[kind].halfLength, _at);
    if (kind === 'chopper') {
      _p.copy(_at).setY(VEHICLES.chopper.roof + CHOPPER_HEIGHT);
      vehicles.spawnChopper(_p, [_at.clone().setY(CHOPPER_HEIGHT)], null);
      return;
    }
    _flat.subVectors(_at, player.position).setY(0).normalize();
    const parked = ai !== 'on';
    const stop = _at.clone().addScaledVector(_flat, -DRIVE_IN);
    vehicles.spawnGround(kind, {
      x: _at.x, y: _at.y, z: _at.z, route: parked ? [] : [{ x: stop.x, z: stop.z, hold: 0 }], tag: null,
      crew: parked ? [] : ['trooper', 'gunner', 'trooper'], crewTag: null, holds: false, holdYaw: NaN, parked,
    });
  }

  /** A mounted gun on the floor under the crosshair, facing away from the player. Pressed again on the same gun, it goes up a level. */
  emplacement(): void {
    const { player, progression } = this.ctx;
    const guns = (progression as unknown as { callInsManager: CallInManager }).callInsManager.emplacements;
    this.aimPoint(1.2, _at);
    const near = guns.all.find(e => e.spec.pos.distanceTo(_at) < 1.5);
    if (near) {
      near.upgrade(near.levelNumber % 3 + 1);
      return;
    }
    guns.place({ pos: _at.clone(), yaw: Math.atan2(-player.forward.x, -player.forward.z), arc: 1 });
  }

  /** A wall segment across the crosshair, its face to the player. Blasts wear it like any on the map. */
  wall(): void {
    const f = this.ctx.player.forward;
    this.aimPoint(0.6, _at);
    (this.ctx.world.objects as Objects).walls.place({ kind: 'wall', x: _at.x, y: _at.y, z: _at.z, yaw: Math.atan2(-f.x, -f.z), length: WALL.segment });
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
