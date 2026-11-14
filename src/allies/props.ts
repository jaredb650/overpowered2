/**
 * What makes an ally read as one at 40 m, on top of the Bailiff's black body: a grey square pack frame with a whip aerial, a
 * cold white beacon on top and a thin red bar across its back (docs/proposals/mission-2-plan.md, section 4). Our red stays small: a
 * Bailiff's own slit and sleeve stripe say the rest, and a red bar across the chest read as a red block at 25 m. Only a stand-in enemy
 * body (before the Bailiffs load) also wears a red band round the helmet and the bar on the chest. No green on the body: green is the
 * husk's and the Warthog's, and the crosshair's. The beacon turns amber while he is down, so a man to revive can be found across a
 * fight.
 *
 * Bodies are pooled and shared with the enemy. A prop stays on a corpse while the corpse lasts, and comes off when the body is
 * next handed out to anyone (`strip`, on every spawn).
 */
import * as THREE from 'three';
import { HumanoidBone as B } from '../characters/rig';
import type { CharacterInstance, Ctx } from '../core/contracts';
import { ModelBuilder, ModelMaterials } from '../progression/modelkit';
import { ALLY_BEACON, ALLY_DOWN_COLOR, ALLY_FRAME, ALLY_MARK, BAILIFF_BODIES } from './data';

const STEEL = 0x3a4048;

export interface Kit {
  pack: THREE.Group;
  /** The helmet band and the chest bar, for a stand-in enemy body only. */
  band: THREE.Group;
  bar: THREE.Group;
  beacon: THREE.Mesh;
}

export class AllyProps {
  private readonly materials: ModelMaterials;
  private readonly up = new THREE.MeshBasicMaterial({ color: new THREE.Color(ALLY_BEACON).multiplyScalar(4), toneMapped: false, fog: false });
  private readonly down = new THREE.MeshBasicMaterial({ color: new THREE.Color(ALLY_DOWN_COLOR).multiplyScalar(5), toneMapped: false, fog: false });
  private readonly beaconShape = new THREE.OctahedronGeometry(0.075, 0);
  private readonly spare: Kit[] = [];
  private readonly worn = new WeakMap<CharacterInstance, Kit>();

  constructor(ctx: Ctx) {
    this.materials = new ModelMaterials(ctx);
  }

  private build(): Kit {
    const p = new ModelBuilder()
      .box(0.32, 0.44, 0.12, ALLY_FRAME)
      .box(0.36, 0.04, 0.14, ALLY_FRAME, { at: [0, 0.24, 0] })
      .box(0.02, 1.15, 0.02, STEEL, { at: [0.12, 0.78, -0.02], rot: [0.04, 0, -0.03] })
      .glow(new THREE.BoxGeometry(0.26, 0.035, 0.02), ALLY_MARK, 3, { at: [0, 0.08, -0.065] });
    const pack = this.materials.group(p);
    pack.position.set(0, 0.1, -0.2);
    const beacon = new THREE.Mesh(this.beaconShape, this.up);
    beacon.position.set(0.135, 1.38, -0.02);
    pack.add(beacon);
    // The chest bar and the helmet band. Glow only, so they read in the dark and through smoke.
    const bar = this.materials.group(new ModelBuilder().glow(new THREE.BoxGeometry(0.24, 0.04, 0.02), ALLY_MARK, 2.5, { at: [0, 0.12, 0.22] }));
    const b = new ModelBuilder()
      .glow(new THREE.BoxGeometry(0.23, 0.035, 0.02), ALLY_MARK, 2.5, { at: [0, 0, 0.115] })
      .glow(new THREE.BoxGeometry(0.23, 0.035, 0.02), ALLY_MARK, 2.5, { at: [0, 0, -0.115] })
      .glow(new THREE.BoxGeometry(0.02, 0.035, 0.23), ALLY_MARK, 2.5, { at: [0.115, 0, 0] })
      .glow(new THREE.BoxGeometry(0.02, 0.035, 0.23), ALLY_MARK, 2.5, { at: [-0.115, 0, 0] });
    const band = this.materials.group(b);
    band.position.set(0, 0.11, 0.01);
    return { pack, band, bar, beacon };
  }

  fit(char: CharacterInstance): void {
    this.strip(char);
    const kit = this.spare.pop() ?? this.build();
    char.bones[B.chest]?.add(kit.pack);
    if (!(BAILIFF_BODIES as readonly string[]).includes((char as { archetype?: string }).archetype ?? '')) {
      char.bones[B.head]?.add(kit.band);
      char.bones[B.chest]?.add(kit.bar);
    }
    kit.beacon.material = this.up;
    this.worn.set(char, kit);
  }

  /** Amber while he is down. */
  setDown(char: CharacterInstance, down: boolean): void {
    const kit = this.worn.get(char);
    if (kit) kit.beacon.material = down ? this.down : this.up;
  }

  strip(char: CharacterInstance): void {
    const kit = this.worn.get(char);
    if (!kit) return;
    kit.pack.removeFromParent();
    kit.band.removeFromParent();
    kit.bar.removeFromParent();
    this.worn.delete(char);
    this.spare.push(kit);
  }
}
