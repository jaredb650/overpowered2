/** Picks the right animator for a rig. */
import * as THREE from 'three';
import type { CharacterAnimation } from '../../core/contracts';
import type { ArchetypeDef } from '../archetypes';
import type { GoreRegion, RigDef } from '../rig';
import { DroneAnimator } from './DroneAnimator';
import { HumanoidAnimator } from './HumanoidAnimator';
import { SkitterAnimator } from './SkitterAnimator';

export interface AnimatedBody {
  bones: readonly THREE.Bone[];
  rig: RigDef;
  root: THREE.Object3D;
  severed: ReadonlySet<GoreRegion>;
  isHidden(bone: number): boolean;
}

/** What the library needs on top of the contract. */
export interface PooledAnimation extends CharacterAnimation {
  reset(): void;
  onFootstep: ((x: number, y: number, z: number, strength: number) => void) | null;
  treadmill: boolean;
  groundAt: ((x: number, y: number, z: number) => number) | null;
}

export function createAnimator(def: ArchetypeDef, c: AnimatedBody): PooledAnimation {
  if (def.rig === 'skitter') return new SkitterAnimator(c.bones, c.root, b => c.isHidden(b));
  if (def.rig === 'drone') return new DroneAnimator(c.bones, c.root, b => c.isHidden(b));
  return new HumanoidAnimator(c.bones, c.rig, def, c.root, c.severed, b => c.isHidden(b));
}

export { HumanoidAnimator, type WeaponGrip } from './HumanoidAnimator';
