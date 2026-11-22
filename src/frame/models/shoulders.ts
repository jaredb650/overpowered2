/** Shoulder model builder registry, wired in Phase 0 so Phase 1 lanes only edit their own `shoulder-*.ts` files. */
import type { ShoulderKind } from '../loadout';
import type { ShoulderModelBuilder } from './shared';
import { buildPod6 } from './shoulder-pod6';
import { buildStormPod } from './shoulder-storm';
import { buildMirv } from './shoulder-mirv';
import { buildWireBomb } from './shoulder-wire';
import { buildMortarRack } from './shoulder-mortar';
import { buildFpvHive } from './shoulder-fpv';
import { buildPointDef } from './shoulder-pointdef';
import { buildFlareRack } from './shoulder-flares';

export const SHOULDER_MODELS: Readonly<Record<ShoulderKind, ShoulderModelBuilder>> = {
  pod6: buildPod6,
  storm: buildStormPod,
  mirv: buildMirv,
  wire: buildWireBomb,
  mortar: buildMortarRack,
  fpv: buildFpvHive,
  pointdef: buildPointDef,
  flares: buildFlareRack,
};
