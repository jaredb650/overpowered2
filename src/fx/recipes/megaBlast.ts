/**
 * The Guided Heavy Missile's mega-blast entry point (docs/proposals/mech-parts.md section 3).
 *
 * Phase 0 stub: runs a large `Combat.explode` plus a shock ring so the Guided Heavy Missile and any other caller have a
 * stable contract from day one. Lane G replaces the internals with the full condensation-dome shockwave, delayed shake
 * and ragdoll wave, dust ring, and fireball column without changing this signature.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';

const UP = new THREE.Vector3(0, 1, 0);

export interface MegaBlastOptions {
  /** Damage source name for kill feed / telemetry. Defaults to `'wireBomb'`. */
  source?: string;
  /** Co-op visual-only playback (no damage). */
  cosmetic?: boolean;
  /** Co-op mirrored flag (caller's blast mirrored on other screens). */
  mirrored?: boolean;
}

/**
 * Triggers a massive local non-nuke explosion at `at`, scaled by `scale` (1 = Guided Heavy Missile: 26 m kill radius,
 * 70 m shockwave).
 */
export function megaBlast(ctx: Ctx, at: THREE.Vector3, scale = 1, opts?: MegaBlastOptions): void {
  const s = Math.max(0.25, scale);
  const cosmetic = opts?.cosmetic === true;
  ctx.combat.explode(at, {
    radius: 26 * s,
    damage: 1400 * s,
    kind: 'shell',
    source: opts?.source ?? 'wireBomb',
    team: 'player',
    instakill: true,
    selfDamage: 0.55,
    playerPush: 26 * s,
    scale: 2.8 * s,
    shake: 1.6 * s,
    cosmetic,
    mirrored: opts?.mirrored,
  });
  ctx.fx.ring(at, UP, 0xffc680, 70 * s);
}
