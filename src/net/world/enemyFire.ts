/**
 * The enemies' fire on other screens. The host's enemy rays are checked against every remote player (a hit becomes `hurt`,
 * targeting.ts) and drawn on guests as a tracer (`ray`); an enemy projectile's launch is sent as a `ray` along its first line.
 */
import * as THREE from 'three';
import { CG } from '../../core/contracts';
import { closestSegmentPoints } from '../../weapons/geometry';
import type { WorldContext } from './context';
import type { PlayerTarget, Targeting } from './targeting';
import type { Vec } from './wire';

/** Host: an enemy's shot, for the guests' tracers. */
export type EnemyFireEvent = { t: 'ray'; from: Vec; to: Vec };

export class EnemyFire {
  constructor(private readonly w: WorldContext, private readonly targeting: Targeting) {
    w.router.guest('ray', value => w.ctx.fx.tracer(new THREE.Vector3(...value.from), new THREE.Vector3(...value.to), 'enemy'));
  }

  /** Host: an enemy's ray from `from` to `to`. Returns where it stopped on a remote player, or null if it hit none. */
  enemyRay(from: THREE.Vector3, to: THREE.Vector3, damage: number, source: string, trace = true): THREE.Vector3 | null {
    if (!this.w.hosting) return null;
    let nearest = 2;
    let target: PlayerTarget | undefined;
    for (const candidate of this.targeting.players()) {
      if (!candidate.player.alive) continue;
      const hit = closestSegmentPoints(from, to, candidate.player.position, candidate.player.eye);
      if (hit.dist2 < 0.4 * 0.4 && hit.s < nearest) { nearest = hit.s; target = candidate; }
    }
    const end = target ? from.clone().lerp(to, nearest) : to;
    if (trace) this.w.send({ t: 'ray', from: from.toArray() as Vec, to: end.toArray() as Vec });
    if (!target || target.id === this.w.session.lobby.you) return null;
    this.targeting.hurt(target.id, { amount: damage, from, type: 'bullet', source });
    return end;
  }

  /** Host: an enemy launched a projectile. Guests see a tracer along its line to the first wall. */
  projectile(from: THREE.Vector3, dir: THREE.Vector3): void {
    if (!this.w.hosting) return;
    const wall = this.w.ctx.physics.raycast(from, dir, 100, CG.World);
    const to = wall?.point ?? from.clone().addScaledVector(dir, 100);
    this.w.send({ t: 'ray', from: from.toArray() as Vec, to: to.toArray() as Vec });
  }
}
