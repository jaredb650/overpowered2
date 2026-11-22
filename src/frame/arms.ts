/**
 * The arm guns a Frame can wear, as models: one `Gun` for each kind on each side, built when first worn and kept. Shared by the
 * Frame a player sits in (seat.ts) and another player's copy of it (puppet.ts), so both draw the same loadout.
 *
 * Each model is drawn natively for one side and mirrored on the other so its drum, clip, or breech always faces outward.
 */
import type * as THREE from 'three';
import type { ModelMaterials } from '../progression/modelkit';
import { Gun, type GunSpec } from '../vehicles/guns';
import type { ArmKind, ArmSide } from './loadout';
import { ROTARY_ARM } from './models/rotary';
import { CANNON_ARM } from './models/cannon40';
import { HOWITZER_ARM } from './models/howitzer105';
import { VULCAN30_ARM } from './models/vulcan30';
import { BEAM_ARM } from './models/beam';
import { CLUSTER_ARM } from './models/cluster';
import { SHOTGUN_ARM } from './models/shotgun';

const SPECS: Readonly<Record<ArmKind, GunSpec>> = {
  rotary: ROTARY_ARM,
  cannon40: CANNON_ARM,
  howitzer105: HOWITZER_ARM,
  vulcan30: VULCAN30_ARM,
  beam: BEAM_ARM,
  cluster: CLUSTER_ARM,
  shotgun: SHOTGUN_ARM,
};

/** The side each model was drawn for. */
const NATIVE: Readonly<Record<ArmKind, ArmSide>> = {
  rotary: 'left',
  cannon40: 'right',
  howitzer105: 'right',
  vulcan30: 'left',
  beam: 'right',
  cluster: 'right',
  shotgun: 'right',
};

export class ArmRack {
  /** Per side, per kind; and every one built, for hiding without an iterator a frame. */
  private readonly bySide: Record<ArmSide, Partial<Record<ArmKind, Gun>>> = { left: {}, right: {} };
  private readonly all: Gun[] = [];

  /** `ready`: the guns to build now rather than on first wear (the standard Frame's, and the howitzer Foreclosure fits). */
  constructor(private readonly materials: ModelMaterials, private readonly scene: THREE.Scene,
    ready: readonly (readonly [ArmSide, ArmKind])[] = []) {
    for (const [side, kind] of ready) this.gun(side, kind);
  }

  /** The model for `kind` on `side`, built the first time it is asked for. Hidden until posed. */
  gun(side: ArmSide, kind: ArmKind): Gun {
    const row = this.bySide[side];
    let g = row[kind];
    if (!g) {
      g = row[kind] = new Gun(this.materials, this.scene, SPECS[kind], NATIVE[kind] !== side);
      this.all.push(g);
    }
    return g;
  }

  /** Every gun hidden but these two. */
  only(left: Gun, right: Gun): void {
    for (let i = 0; i < this.all.length; i++) {
      const g = this.all[i]!;
      if (g !== left && g !== right) g.hide();
    }
  }

  hideAll(): void {
    for (let i = 0; i < this.all.length; i++) this.all[i]!.hide();
  }
}
