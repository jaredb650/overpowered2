/**
 * What makes an ally read as one at 40 m: a pale square pack frame with a whip aerial and a cold white beacon on top, a cyan
 * band round the helmet and a cyan bar across the chest. No green on the body: green is the husk's and the Warthog's, and the
 * crosshair's. The beacon turns amber while he is down, so a man to revive can be found across a fight.
 *
 * Bodies are pooled and shared with the enemy. A prop stays on a corpse while the corpse lasts, and comes off when the body is
 * next handed out to anyone (`strip`, on every spawn).
 */
import * as THREE from 'three';
import { HumanoidBone as B } from '../characters/rig';
import type { CharacterInstance, Ctx } from '../core/contracts';
import { ModelBuilder, ModelMaterials } from '../progression/modelkit';
import { ALLY_BEACON, ALLY_COLOR, ALLY_DOWN_COLOR } from './data';

const PALE = 0xd6dde3;
const STEEL = 0x3a4048;

export interface Kit {
  pack: THREE.Group;
  band: THREE.Group;
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
      .box(0.32, 0.44, 0.12, PALE)
      .box(0.36, 0.04, 0.14, PALE, { at: [0, 0.24, 0] })
      .box(0.02, 1.15, 0.02, STEEL, { at: [0.12, 0.78, -0.02], rot: [0.04, 0, -0.03] })
      .glow(new THREE.BoxGeometry(0.26, 0.035, 0.02), ALLY_COLOR, 3, { at: [0, 0.08, -0.065] });
    const pack = this.materials.group(p);
    pack.position.set(0, 0.1, -0.2);
    const beacon = new THREE.Mesh(this.beaconShape, this.up);
    beacon.position.set(0.135, 1.38, -0.02);
    pack.add(beacon);
    // The chest bar and the helmet band. Glow only, so they read in the dark and through smoke.
    pack.add(this.materials.group(new ModelBuilder().glow(new THREE.BoxGeometry(0.24, 0.04, 0.02), ALLY_COLOR, 2.5, { at: [0, 0.02, 0.42] })));
    const b = new ModelBuilder()
      .glow(new THREE.BoxGeometry(0.23, 0.035, 0.02), ALLY_COLOR, 2.5, { at: [0, 0, 0.115] })
      .glow(new THREE.BoxGeometry(0.23, 0.035, 0.02), ALLY_COLOR, 2.5, { at: [0, 0, -0.115] })
      .glow(new THREE.BoxGeometry(0.02, 0.035, 0.23), ALLY_COLOR, 2.5, { at: [0.115, 0, 0] })
      .glow(new THREE.BoxGeometry(0.02, 0.035, 0.23), ALLY_COLOR, 2.5, { at: [-0.115, 0, 0] });
    const band = this.materials.group(b);
    band.position.set(0, 0.11, 0.01);
    return { pack, band, beacon };
  }

  fit(char: CharacterInstance): void {
    this.strip(char);
    const kit = this.spare.pop() ?? this.build();
    char.bones[B.chest]?.add(kit.pack);
    char.bones[B.head]?.add(kit.band);
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
    this.worn.delete(char);
    this.spare.push(kit);
  }
}
