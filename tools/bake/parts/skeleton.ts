/** Bind-pose lookups for authoring. Everything here works at modelling scale. */
import { HumanoidBone, type RigDef } from '../../../src/characters/rig';
import { add, mix, type V3 } from '../sdf';

export const B = HumanoidBone;
export type Side = 1 | -1;

export class Sk {
  readonly pos: V3[];
  constructor(readonly rig: RigDef) {
    this.pos = [];
    rig.bones.forEach((b, i) => {
      this.pos[i] = b.parent < 0 ? b.offset : add(this.pos[b.parent]!, b.offset);
    });
  }

  /** Bind position of a bone plus an offset. */
  p(bone: number, dx = 0, dy = 0, dz = 0): V3 {
    return add(this.pos[bone]!, [dx, dy, dz]);
  }

  /** Point `t` of the way from bone `a` to bone `b`, plus an offset. */
  on(a: number, b: number, t: number, dx = 0, dy = 0, dz = 0): V3 {
    return add(mix(this.pos[a]!, this.pos[b]!, t), [dx, dy, dz]);
  }

  armBones(side: Side) {
    return side > 0
      ? { upper: B.upperArmL, fore: B.foreArmL, hand: B.handL }
      : { upper: B.upperArmR, fore: B.foreArmR, hand: B.handR };
  }

  legBones(side: Side) {
    return side > 0
      ? { thigh: B.thighL, shin: B.shinL, foot: B.footL }
      : { thigh: B.thighR, shin: B.shinR, foot: B.footR };
  }
}
