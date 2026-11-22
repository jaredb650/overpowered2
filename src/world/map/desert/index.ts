/**
 * Surplus — Desert Raid map builder stub (replaced in full by Lane 1).
 */
import * as THREE from 'three';
import type { Kit } from '../../kit/kit';
import type { MapSpec } from '../spec';
import {
  DESERT_BOUNDS,
  DESERT_HUB_PT,
  DESERT_LEVELS,
  DESERT_LIGHT_BOUNDS,
  DESERT_LIGHT_CELL,
} from './plan';

export { DESERT_BOUNDS, DESERT_LEVELS, DESERT_LIGHT_BOUNDS, DESERT_LIGHT_CELL };

export const DESERT_HUB = new THREE.Vector3(DESERT_HUB_PT[0], DESERT_HUB_PT[1], DESERT_HUB_PT[2]);

export const DESERT_STAGES = [
  {
    label: 'Shaping Surplus and the dawn dunes',
    run: (k: Kit, spec: MapSpec) => {
      authorDesert(k, spec);
    },
  },
] as const;

export function authorDesert(k: Kit, spec: MapSpec): void {
  spec.reactor = null;
  spec.killY = -12;
  k.floor('dirt', -180, -165, 180, 230, 0);
  spec.spawns = [{ position: new THREE.Vector3(0, 0.1, 208), zone: 'desert-approach', kind: 'ground' }];
}
