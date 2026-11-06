/**
 * What a man carries that says what he is for. Section 16.5 wants a visible tell on everything, and at 30 m the tell is a silhouette:
 * a whip antenna, a mast, a red designator, a visor. Each is a small merged model on a bone.
 *
 * Bodies are pooled, and a prop stays on a corpse for as long as the corpse lasts, so it comes off when the body is next handed out
 * and not when the man dies.
 */
import * as THREE from 'three';
import { HumanoidBone as B } from '../../characters/rig';
import type { CharacterInstance, Ctx } from '../../core/contracts';
import { ModelBuilder, ModelMaterials } from '../../progression/modelkit';

export type PropKind = 'whip' | 'mast' | 'designator' | 'visor' | 'foil' | 'grenade' | 'vest' | 'detonator' | 'cap';

const STEEL = 0x3a4048;
const DARK = 0x14171c;
const OLIVE = 0x39452e;
const RED = 0xff2a18;
const CYAN = 0x39e0ff;

interface Fit {
  bone: number;
  at: readonly [number, number, number];
  rot?: readonly [number, number, number];
  scale?: number;
  build(b: ModelBuilder): void;
}

const FITS: Record<PropKind, Fit> = {
  // A pack with a two-metre whip. It has to clear a waist-high wall and show over a crate.
  whip: {
    bone: B.chest, at: [0, 0.1, -0.19],
    build: b => b.box(0.3, 0.42, 0.14, OLIVE).box(0.022, 1.7, 0.022, STEEL, { at: [0.11, 1.0, -0.02], rot: [0.05, 0, -0.04] }).glow(new THREE.SphereGeometry(0.05, 8, 6), RED, 5, { at: [0.15, 1.85, -0.06] }).glow(new THREE.BoxGeometry(0.1, 0.04, 0.02), CYAN, 3, { at: [-0.06, 0.1, -0.08] }),
  },
  // Thicker and square-topped, so a call-in jammer never reads as the sonar's man.
  mast: {
    bone: B.chest, at: [0, 0.12, -0.2],
    build: b => b.box(0.34, 0.46, 0.18, 0x2c3238).box(0.05, 1.25, 0.05, STEEL, { at: [0, 0.82, 0] }).box(0.46, 0.05, 0.05, STEEL, { at: [0, 1.32, 0] }).box(0.3, 0.05, 0.05, STEEL, { at: [0, 1.16, 0] }).glow(new THREE.BoxGeometry(0.06, 0.06, 0.06), 0xffa400, 5, { at: [0, 1.42, 0] }),
  },
  designator: {
    bone: B.head, at: [0.08, 0.05, 0.11], rot: [0, 0, 0],
    build: b => b.box(0.14, 0.09, 0.2, DARK).cyl(0.04, 0.04, 0.05, 8, STEEL, { at: [0.03, 0, 0.12], rot: [Math.PI / 2, 0, 0] }).glow(new THREE.SphereGeometry(0.028, 8, 6), RED, 6, { at: [0.03, 0, 0.15] }),
  },
  visor: {
    bone: B.head, at: [0, 0.05, 0.11],
    build: b => b.box(0.2, 0.1, 0.03, 0x0d1720).box(0.22, 0.03, 0.05, STEEL, { at: [0, 0.07, -0.02] }).box(0.04, 0.12, 0.09, STEEL, { at: [0.12, 0.02, -0.06] }).box(0.04, 0.12, 0.09, STEEL, { at: [-0.12, 0.02, -0.06] }),
  },
  // A folded space blanket across the shoulders. It is what keeps him off the sonar, and it catches the light.
  foil: {
    bone: B.chest, at: [0, 0.12, -0.17], rot: [0.12, 0, 0],
    build: b => b.box(0.46, 0.5, 0.03, 0xb8c4cc).box(0.5, 0.06, 0.05, 0x8d989f, { at: [0, 0.24, 0.02] }),
  },
  grenade: {
    bone: B.handL, at: [0, 0.07, 0.03],
    build: b => b.cyl(0.03, 0.03, 0.09, 8, 0x2d3a24).box(0.02, 0.05, 0.015, STEEL, { at: [0.03, 0.05, 0] }).glow(new THREE.SphereGeometry(0.018, 6, 5), RED, 7, { at: [0, 0.06, 0] }),
  },
  vest: {
    bone: B.chest, at: [0, 0.02, 0.17],
    build: b => b.box(0.32, 0.26, 0.06, 0x63583e).box(0.34, 0.02, 0.07, 0xa02818, { at: [0, 0.06, 0] }).box(0.34, 0.02, 0.07, 0xa02818, { at: [0, -0.06, 0] }).glow(new THREE.SphereGeometry(0.03, 8, 6), RED, 7, { at: [0.1, 0.1, 0.04] }),
  },
  detonator: {
    bone: B.handR, at: [0, 0.08, 0.02],
    build: b => b.box(0.05, 0.11, 0.05, 0xb79c3a).glow(new THREE.SphereGeometry(0.024, 8, 6), RED, 7, { at: [0, 0.07, 0] }),
  },
  // Only the suit wears this, and the suit's head is twice a man's. It sits high and large or the helmet swallows it.
  cap: {
    bone: B.head, at: [0, 0.42, 0.02], scale: 2.1,
    build: b => b.cyl(0.17, 0.14, 0.08, 12, 0x1b2230).cyl(0.13, 0.13, 0.02, 12, 0xb79c3a, { at: [0, -0.03, 0] }).box(0.2, 0.015, 0.1, 0x0d1016, { at: [0, -0.05, 0.13], rot: [0.25, 0, 0] }).glow(new THREE.BoxGeometry(0.05, 0.05, 0.015), 0xffd070, 2, { at: [0, 0.01, 0.15] }),
  },
};

export class Props {
  private readonly materials: ModelMaterials;
  private readonly spare = new Map<PropKind, THREE.Group[]>();
  private readonly worn = new WeakMap<CharacterInstance, { kind: PropKind; model: THREE.Group }[]>();

  constructor(ctx: Ctx) {
    this.materials = new ModelMaterials(ctx);
  }

  private build(kind: PropKind): THREE.Group {
    const fit = FITS[kind];
    const b = new ModelBuilder();
    fit.build(b);
    const model = this.materials.group(b, this.materials.nearby);
    model.position.set(fit.at[0], fit.at[1], fit.at[2]);
    if (fit.rot) model.rotation.set(fit.rot[0], fit.rot[1], fit.rot[2]);
    if (fit.scale) model.scale.setScalar(fit.scale);
    return model;
  }

  fit(char: CharacterInstance, kind: PropKind): void {
    const list = this.spare.get(kind);
    const model = list?.pop() ?? this.build(kind);
    const bone = char.bones[FITS[kind].bone];
    if (!bone) return;
    bone.add(model);
    model.visible = true;
    let worn = this.worn.get(char);
    if (!worn) this.worn.set(char, (worn = []));
    worn.push({ kind, model });
  }

  /** Takes one kind off a living man: the pack he dropped, the grenade he threw. */
  remove(char: CharacterInstance, kind: PropKind): void {
    const worn = this.worn.get(char);
    if (!worn) return;
    const i = worn.findIndex(w => w.kind === kind);
    if (i < 0) return;
    this.shelve(worn[i]!.kind, worn[i]!.model);
    worn.splice(i, 1);
  }

  /** A pooled body comes back to the gate with nothing on it. */
  strip(char: CharacterInstance): void {
    const worn = this.worn.get(char);
    if (!worn) return;
    for (const w of worn) this.shelve(w.kind, w.model);
    worn.length = 0;
  }

  private shelve(kind: PropKind, model: THREE.Group): void {
    model.removeFromParent();
    let list = this.spare.get(kind);
    if (!list) this.spare.set(kind, (list = []));
    list.push(model);
  }
}
