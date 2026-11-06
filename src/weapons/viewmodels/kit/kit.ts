/** What a model builder receives. */
import { Mesher } from './mesher';
import type { VmMaterials } from './materials';

export class Kit {
  constructor(readonly mats: VmMaterials) {}

  mesher(): Mesher {
    const m = new Mesher();
    m.decals = this.mats.decalRegions as Mesher['decals'];
    return m;
  }
}
