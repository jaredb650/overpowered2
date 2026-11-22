/**
 * The arm guns a Frame can wear, as models: one `Gun` for each kind on each side, built when first worn and kept. Shared by the
 * Frame a player sits in (seat.ts) and another player's copy of it (puppet.ts), so both draw the same loadout.
 *
 * No new models: the rotary was drawn for the left arm and the 40 mm and 105 mm for the right, and on the other side each is the
 * same model mirrored, so its drum or its breech still faces out.
 */
import type * as THREE from 'three';
import type { ModelMaterials } from '../progression/modelkit';
import { Gun, type GunSpec } from '../vehicles/guns';
import { CANNON_ARM, HOWITZER_ARM, ROTARY_ARM } from './cockpit';
import type { ArmKind, ArmSide } from './loadout';

const SPECS: Readonly<Record<ArmKind, GunSpec>> = { rotary: ROTARY_ARM, cannon40: CANNON_ARM, howitzer105: HOWITZER_ARM };
/** The side each model was drawn for. */
const NATIVE: Readonly<Record<ArmKind, ArmSide>> = { rotary: 'left', cannon40: 'right', howitzer105: 'right' };

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
