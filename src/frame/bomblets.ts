/**
 * Shared bomblet carpet entry point used by both the Bomblet Cannon (`arms/cluster.ts`) and the Mortar Rack's cluster
 * round (`shoulders/mortar.ts`).
 *
 * Phase 0 stub: fires a modest ripple of placeholder explosions along the carpet patch. Lane C replaces this module
 * with the full wall-bouncing bomblet submunition fan and 0.7 s timed ripple without changing callers.
 */
import * as THREE from 'three';
import type { Ctx } from '../core/contracts';

export interface BombletSpec {
  /** Number of bomblets in the carpet (e.g. 28 for Bomblet Cannon, 32 for Mortar Cluster). */
  count: number;
  /** Forward length of the carpet in metres (e.g. 14). */
  length: number;
  /** Side-to-side width of the carpet in metres (e.g. 9), or diameter when `circular` is true. */
  width: number;
  /** Ripple duration in seconds over which bomblets detonate (e.g. 0.7). */
  ripple: number;
  /** Blast radius per bomblet in metres (e.g. 2.4). */
  blastRadius: number;
  /** Blast damage per bomblet (e.g. 70). */
  damage: number;
  /** True for a mortar's overhead circular shower; false for a forward-thrown fan. */
  circular?: boolean;
  /** Damage source string. */
  source: string;
  /** Co-op cosmetic-only playback (no damage). */
  cosmetic?: boolean;
}

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _at = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * Releases a carpet of bomblets from `origin` along `dir`.
 * Phase 0 stub places a compact burst of 3 sample impacts so callers compile and run cleanly before Lane C lands.
 */
export function bombletCarpet(ctx: Ctx, origin: THREE.Vector3, dir: THREE.Vector3, spec: BombletSpec): void {
  _fwd.set(dir.x, 0, dir.z);
  if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1);
  else _fwd.normalize();
  _right.crossVectors(_fwd, _up).normalize();

  const samples = Math.min(3, Math.max(1, spec.count));
  for (let i = 0; i < samples; i++) {
    const t = samples === 1 ? 0.5 : i / (samples - 1);
    const along = spec.circular ? (t - 0.5) * spec.width * 0.5 : (0.2 + t * 0.6) * spec.length;
    const across = (i - 1) * spec.width * 0.18;
    _at.copy(origin).addScaledVector(_fwd, along).addScaledVector(_right, across);
    ctx.combat.explode(_at, {
      radius: spec.blastRadius,
      damage: spec.damage,
      kind: 'grenade',
      source: spec.source,
      team: 'player',
      scale: 0.65,
      cosmetic: spec.cosmetic,
    });
  }
}
