/**
 * The Raufoss round: a round effect, not a gun. It stops on the first thing it strikes and bursts there, small, then
 * throws a cone of pellets out of the far side: through the cover it struck, or out of the back of the man it hit and into
 * the men behind him. It forgives a miss on a man behind cover, and shreds a line of them. On a man's armour (a plate, a
 * helmet, a shield) it bursts just behind it, inside him: the pellets are a point-blank blast into his body, past the plate.
 *
 * The Piledriver fires it on right click. The Crucible will sell it fitted to the Sabot: whatever gun carries it hands
 * `fire` the round it would have fired. Every number is TUNING.raufoss.
 */
import * as THREE from 'three';
import { CG, type Ctx } from '../core/contracts';
import type { BurstSpec, EnemyInstance, ShotSpec, StruckList } from '../core/gameplay';
import { randomInCone } from '../core/math';
import type { Combat } from './Combat';
import { TUNING } from './data';
import { wallExit } from './penetration';

/** TUNING.raufoss, or another gun's own numbers for the same round. */
export interface RaufossTuning {
  readonly direct: number;
  readonly burst: BurstSpec;
  readonly pellets: number;
  readonly share: number;
  readonly cone: number;
  readonly range: number;
  readonly wall: number;
  readonly force: number;
}

const SLOTS = 8;

export class Raufoss {
  private readonly struck: StruckList = {
    count: 0, walls: 0, points: Array.from({ length: SLOTS }, () => new THREE.Vector3()), enemies: new Array(SLOTS).fill(null),
    armoured: new Array(SLOTS).fill(false),
  };
  private readonly pellet: ShotSpec = { damage: 0, source: '', team: 'player' };
  private readonly at = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly exit = new THREE.Vector3();
  private readonly exitNormal = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly from = new THREE.Vector3();

  constructor(private readonly ctx: Ctx, private readonly combat: Combat) {}

  /** One round from `origin` along `dir`. `shot` is the round as the gun filled it; this takes it over. */
  fire(origin: THREE.Vector3, dir: THREE.Vector3, shot: ShotSpec, t: RaufossTuning = TUNING.raufoss): void {
    const c = this.ctx;
    const list = this.struck;
    list.count = list.walls = 0;
    const damage = shot.damage;
    // It goes no further than the first thing it meets: the pellets are what goes on.
    shot.damage = damage * t.direct;
    shot.penetrate = shot.pierce = shot.ricochet = shot.headHops = 0;
    shot.burst = shot.blastRadius = undefined;
    shot.struck = list;
    const res = this.combat.fireRay(origin, dir, shot);
    shot.struck = undefined;

    const enemy: EnemyInstance | null = list.count > 0 ? list.enemies[0]! : null;
    let through = true;
    if (enemy) {
      this.at.copy(list.points[0]!);
      this.normal.copy(dir).negate();
      this.exit.copy(this.at).addScaledVector(dir, 0.05);
    } else {
      // The ray stopped on a wall, or on nothing at all.
      const wall = c.physics.raycast(origin, dir, origin.distanceTo(res.end) + 0.05, CG.World);
      if (!wall) return;
      this.at.copy(wall.point);
      this.normal.copy(wall.normal);
      // Thicker than `wall` it bursts on and no further: the ground, a bunker.
      through = wallExit(c.physics, wall.point, dir, t.wall, this.exit, this.exitNormal) >= 0;
      if (through) this.combat.exitWall(this.exit, dir, this.exitNormal, wall.surface, 0.8);
      this.exit.addScaledVector(dir, 0.02);
    }
    this.combat.bursts.at(this.at, this.normal, t.burst, shot.source, enemy);
    if (!through) return;
    // His armour took it: it bursts behind the plate, and every pellet goes into him.
    if (enemy && list.armoured![0] && enemy.alive) {
      this.inside(enemy, dir, damage * t.share, shot, t);
      return;
    }

    const p = this.pellet;
    p.damage = damage * t.share;
    p.source = shot.source;
    p.team = shot.team;
    p.type = 'pellet';
    p.tracer = 'bullet';
    p.tracerFrom = this.exit;
    p.maxDistance = t.range;
    p.force = t.force;
    p.severMult = shot.severMult;
    p.headshotMult = 1.5;
    // Past the man it came out of: the list holds him, and a ray passes over anyone in it, his body too. Each pellet adds
    // whoever it hits, so the list is cut back to him before the next.
    p.struck = enemy ? list : undefined;
    p.skipCorpses = enemy !== null;
    for (let i = 0; i < t.pellets; i++) {
      list.count = 1;
      this.combat.fireRay(this.exit, randomInCone(dir, t.cone, this.dir), p);
    }
    p.struck = undefined;
  }

  /** The pellets as a point-blank blast into `enemy` behind the armour that stopped the round, where it struck him. */
  private inside(enemy: EnemyInstance, dir: THREE.Vector3, damage: number, shot: ShotSpec, t: RaufossTuning): void {
    const hit = this.ctx.enemies.raycast(this.from.copy(this.at).addScaledVector(dir, -0.3), dir, 0.6);
    const bone = hit?.enemy === enemy ? hit.bone : undefined;
    const region = hit?.enemy === enemy ? hit.region : undefined;
    for (let i = 0; i < t.pellets && enemy.alive; i++) {
      const o = this.combat.strikeOptions('pellet', shot.source);
      o.force = t.force;
      o.severMult = shot.severMult ?? 1;
      o.headshotMult = 1.5;
      // Behind the plate: it is not in their way, and it goes with them.
      o.pierces = true;
      o.quiet = i > 0;
      this.combat.strike(enemy, this.at, this.normal, dir, bone, region, damage, o);
    }
  }
}
