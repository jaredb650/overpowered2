/** Pieces used by more than one zone. */
import * as THREE from 'three';
import type { Kit } from '../kit/kit';
import { FACE } from '../kit/geo';
import type { MapSpec } from './spec';

export interface KickerOpts {
  length?: number;
  width?: number;
  height?: number;
  /** Speed added along the direction of travel. */
  boost?: number;
  /** Speed added upward. */
  lift?: number;
}

/** Steel launch ramp. `x, z` is the lip, `dx, dz` the direction of travel. */
export function kicker(k: Kit, spec: MapSpec, x: number, y: number, z: number, dx: number, dz: number, o: KickerOpts = {}): void {
  const g = k.geo;
  const L = o.length ?? 9, w = o.width ?? 6, h = o.height ?? 2.1;
  k.ramp(x - dx * L, z - dz * L, y, x, z, y + h, w, 'steel', 0.3, false);
  k.along(x - dx * L, y, z - dz * L, x, y + h, z, len => {
    g.use('hazard').box(len - 0.5, 0.012, 0, 0.3, 0.01, w / 2, FACE.py);
    for (const s of [1, -1]) g.use('steelDark').bevel(len / 2, -0.2, s * (w / 2 - 0.1), len / 2, 0.2, 0.1, 0.03);
    g.use('emissiveCyan').box(len / 2, 0.02, 0, len / 2 - 0.6, 0.012, 0.06, FACE.py);
  });
  k.push(x, y, z, Math.atan2(-dz, dx));
  k.block('steelDark', -2.4, 0, -w / 2, 0, h - 0.3, w / 2, 0.06);
  k.pop();
  spec.ramps.push({
    pos: new THREE.Vector3(x, y + h, z), dir: new THREE.Vector3(dx, 0, dz), halfWidth: w / 2, length: 4, boost: o.boost ?? 9, lift: o.lift ?? 3,
  });
}
