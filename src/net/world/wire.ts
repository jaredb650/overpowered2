/** What every co-op world message is built from: vectors, damage, and the id lists both ends index into. No game imports. */
import type { DamageInfo } from '../../core/contracts';
import type { EnemyId } from '../../core/gameplay';
import type { GoreRegion } from '../../characters/rig';

export const ENEMY_IDS: readonly EnemyId[] = ['husk', 'trooper', 'gunner', 'brute', 'stalker', 'riot', 'sniper', 'rocketeer', 'leaper', 'bomber', 'burner', 'warden', 'skitter', 'drone', 'juggernaut', 'titan'];
export const REGIONS: readonly GoreRegion[] = ['head', 'chest', 'abdomen', 'armL', 'forearmL', 'armR', 'forearmR', 'legL', 'shinL', 'legR', 'shinR'];
export type Vec = [number, number, number];
export type WireDamage = Omit<DamageInfo, 'point' | 'dir' | 'slicePlaneNormal'> & { point: Vec; dir: Vec; slicePlaneNormal?: Vec };

export const validVec = (value: unknown): value is Vec => Array.isArray(value) && value.length === 3
  && value.every(axis => typeof axis === 'number' && Number.isFinite(axis) && Math.abs(axis) <= 100000);

export function packDamage(damage: DamageInfo): WireDamage {
  return { ...damage, point: damage.point.toArray() as Vec, dir: damage.dir.toArray() as Vec,
    slicePlaneNormal: damage.slicePlaneNormal?.toArray() as Vec | undefined };
}
