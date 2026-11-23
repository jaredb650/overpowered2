/**
 * Acoustic propagation for stealth missions: tuned sound radii by movement, weapon, and impact,
 * plus single-ray wall occlusion attenuation with zero per-call allocations.
 */
import * as THREE from 'three';
import { CG, type PhysicsSystem, type RayHit } from '../../core/contracts';
import type { ModId, WeaponId } from '../../core/gameplay';
import { isMelee } from '../../weapons/melee/data';

/** Tuned sound propagation radii in metres (before wall occlusion). */
export const SOUND_RADIUS = {
  crouchWalk: 0,
  walk: 5,
  run: 12,
  dash: 17,
  slide: 16,
  takedown: 3,
  suppressedLight: 9,
  suppressedHeavy: 14,
  impact: 11,
  lightBreak: 12,
  cameraBreak: 10,
  breakerSilent: 3,
  breakerShot: 16,
  unsuppressedShot: 45,
  explosion: 75,
} as const;

/** Multiplier applied to effective sound radius when solid world geometry blocks line-of-hearing. */
export const WALL_ATTENUATION = 0.42;

/** Heavy firearms whose suppressed report still carries further than light pistols/SMGs/carbines. */
const HEAVY_SUPPRESSED: ReadonlySet<WeaponId> = new Set<WeaponId>([
  'awl',
  'harrow',
  'sabot',
  'judge',
  'shotgun',
  'deuce',
  'thresher',
  'flail',
  'piledriver',
  'autocannon',
  'metalstorm',
  'stakegun',
  'billhook',
  'gaff',
]);

/** Suppressor mod IDs keyed by weapon, for resolving suppression from `ctx.weapons.fitted`. */
const SUPPRESSOR_MOD_BY_WEAPON: Partial<Record<WeaponId, ModId>> = {
  awl: 'awlCan',
  smg: 'suppressor',
  gimlet: 'gimletCan',
  ultramag: 'ultramagCan',
  rivet: 'rivetCan',
};

/** Scratch vectors/hit for zero-allocation occlusion raycasts. */
const _from = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _hit: RayHit = {
  point: new THREE.Vector3(),
  normal: new THREE.Vector3(),
  distance: 0,
  surface: 'concrete',
  collider: null,
};

/** True when `weapon` is intrinsically suppressed (Autoraffica) or has its suppressor mod fitted. */
export function isWeaponSuppressed(weapon: WeaponId, fitted?: ReadonlySet<ModId>): boolean {
  if (weapon === 'autoraffica') return true;
  if (!fitted) return false;
  const mod = SUPPRESSOR_MOD_BY_WEAPON[weapon];
  return mod !== undefined && fitted.has(mod);
}

/** Acoustic radius in metres for firing `weapon`. */
export function soundRadiusForShot(weapon: WeaponId, suppressed: boolean): number {
  if (isMelee(weapon)) return SOUND_RADIUS.takedown;
  if (suppressed) {
    return HEAVY_SUPPRESSED.has(weapon) ? SOUND_RADIUS.suppressedHeavy : SOUND_RADIUS.suppressedLight;
  }
  return SOUND_RADIUS.unsuppressedShot;
}

/** Acoustic radius in metres for player movement. Crouch-walking is completely silent (0 m). */
export function movementSoundRadius(speed: number, crouched: boolean, sliding: boolean, dashing: boolean): number {
  if (dashing) return SOUND_RADIUS.dash;
  if (sliding) return SOUND_RADIUS.slide;
  if (crouched) return SOUND_RADIUS.crouchWalk;
  if (speed < 0.8) return 0;
  if (speed < 7.5) return SOUND_RADIUS.walk;
  return SOUND_RADIUS.run;
}

/**
 * Effective hearing radius from `from` (sound source, lifted +0.8 m) to `to` (listener feet, lifted +1.4 m eye height).
 * Performs at most one `CG.World` raycast with zero per-call allocations. If a solid wall blocks the line,
 * attenuates `baseRadius` by `WALL_ATTENUATION` (0.42).
 */
export function effectiveSoundRadius(
  physics: PhysicsSystem | null,
  from: THREE.Vector3,
  to: THREE.Vector3,
  baseRadius: number,
): number {
  if (baseRadius <= 0) return 0;
  if (!physics) return baseRadius;

  _from.set(from.x, from.y + 0.8, from.z);
  _dir.set(to.x - _from.x, (to.y + 1.4) - _from.y, to.z - _from.z);
  const dist = _dir.length();
  if (dist <= 0.1) return baseRadius;

  _dir.multiplyScalar(1 / dist);
  _hit.distance = 0;
  const blocked = physics.raycastInto(_from, _dir, dist - 0.05, CG.World, _hit);
  return blocked ? baseRadius * WALL_ATTENUATION : baseRadius;
}
