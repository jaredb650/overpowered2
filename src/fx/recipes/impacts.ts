import * as THREE from 'three';
import { rand } from '../../core/math';
import type { SurfaceKind } from '../../core/contracts';
import type { FxCore } from '../core';
import { SmokeMode } from '../layers/smoke';
import type { ChipShape } from '../layers/chips';
import { hot, type Rgb } from '../layers/shared';
import { CHIP, SMOKE, SPARK } from '../palette';
import { bloodHit } from './blood';
import { chipDome, sparkCone } from './bursts';

interface SurfaceFx {
  chips: number;
  chip: Rgb;
  shape: ChipShape;
  chipSpeed: number;
  chipSize: number;
  chipLife: number;
  dust: Rgb | null;
  dustSize: number;
  sparks: number;
  spark: Rgb;
  /** Small star for one or two frames at the hit: the crack of the envelope. */
  pop: Rgb | null;
  decal: boolean;
}

const BASE: SurfaceFx = {
  chips: 8,
  chip: CHIP.grey,
  shape: 'gem',
  chipSpeed: 0.75,
  chipSize: 1,
  chipLife: 1,
  dust: SMOKE.dust,
  dustSize: 0.3,
  sparks: 0,
  spark: SPARK.yellow,
  pop: null,
  decal: true,
};

const POP_HOT = hot(0xffdd88, 9);
const POP_COLD = hot(0xbfeaff, 7);

const SURFACES: Record<SurfaceKind, SurfaceFx> = {
  concrete: { ...BASE, chips: 9, shape: 'shard', dustSize: 0.32, sparks: 2, pop: hot(0xcfd8e0, 4) },
  metal: { ...BASE, chips: 3, chip: CHIP.steel, shape: 'plate', chipSize: 0.5, dust: null, sparks: 16, pop: POP_HOT },
  grate: { ...BASE, chips: 2, chip: CHIP.steel, shape: 'plate', chipSize: 0.45, dust: null, sparks: 10, spark: SPARK.amber, pop: POP_HOT, decal: false },
  dirt: { ...BASE, chips: 12, chip: CHIP.dirt, shape: 'gem', chipSpeed: 0.85, chipSize: 1.1, dust: hot(0x4a4238, 0.6), dustSize: 0.42 },
  glass: { ...BASE, chips: 14, chip: CHIP.glass, shape: 'shard', chipSpeed: 1, chipSize: 0.9, dust: null, sparks: 3, spark: SPARK.white, pop: POP_COLD },
  flesh: { ...BASE },
  armor: { ...BASE, chips: 4, chip: CHIP.steel, shape: 'plate', chipSize: 0.6, dust: null, sparks: 12, spark: SPARK.white, pop: hot(0xffffff, 9), decal: false },
  energy: { ...BASE, chips: 6, chip: CHIP.cyan, shape: 'shard', dust: null, sparks: 10, spark: SPARK.cyan, pop: POP_COLD, decal: false },
  lava: { ...BASE, chips: 14, chip: CHIP.orange, shape: 'gem', chipSpeed: 0.8, dust: null, sparks: 6, spark: SPARK.orange, pop: hot(0xffa030, 8), decal: false },
};

export function impact(core: FxCore, position: THREE.Vector3, normal: THREE.Vector3, surface: SurfaceKind, scale = 1): void {
  if (surface === 'flesh') {
    bloodHit(core, position, normal, scale);
    return;
  }
  const f = SURFACES[surface];
  const x = position.x + normal.x * 0.02;
  const y = position.y + normal.y * 0.02;
  const z = position.z + normal.z * 0.02;
  const floor = core.floorAt(x, y, z);

  if (f.dust) {
    const s = core.smoke;
    const b = core.birth;
    const d = f.dustSize * scale;
    s.begin(f.dust, 0.5, b, rand(0.3, 0.5), d, d * 2.1, 5, 0.35, 0.14, SmokeMode.Lit);
    for (let i = 0; i < 2; i++) {
      s.add(x, y, z, normal.x * rand(1.5, 3.5) + rand(-0.5, 0.5), normal.y * rand(1.5, 3.5) + rand(0, 0.5), normal.z * rand(1.5, 3.5) + rand(-0.5, 0.5), rand(-1, 1));
    }
  }
  chipDome(core, x, y, z, normal, f.chip, Math.ceil(f.chips * scale), floor, f.chipSpeed, f.chipSize * Math.sqrt(scale), f.shape, f.chipLife);
  if (f.sparks) {
    sparkCone(core, x, y, z, normal.x, normal.y, normal.z, f.spark, Math.ceil(f.sparks * scale), floor, 15, 0.42, 0.016);
  }
  if (f.pop) core.flashes.star(x, y, z, f.pop, 0.2 * scale, core.now, 0.034, 6, 0.28, 0.7, 0.5, 8);
  if (f.decal) core.ctx.render.decals.add('bullet', position, normal, 0.12 * Math.sqrt(scale), rand(0, 6.2832));
}
