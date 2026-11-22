/**
 * Gait and drive movement registries. Wired once in Phase 0 so Lane I (legs) and Lane J (engines) only edit their own
 * files under `src/frame/move/gait/` and `src/frame/move/drive/`.
 */
import type { DriveKind, GaitKind } from '../loadout';
import type { GaitPlugin } from './gait/types';
import { WALKER_GAIT } from './gait/walker';
import { SPRINTER_GAIT } from './gait/sprinter';
import { HEAVY_GAIT } from './gait/heavy';
import { TREADS_GAIT } from './gait/treads';
import { SPIDER_GAIT } from './gait/spider';
import type { DrivePlugin } from './drive/types';
import { JETS_DRIVE } from './drive/jets';
import { FLIGHT_DRIVE } from './drive/flight';
import { HOVER_DRIVE } from './drive/hover';
import { AFTERBURNER_DRIVE } from './drive/afterburner';
import { OVERCHARGE_DRIVE } from './drive/overcharge';
import { DIESEL_DRIVE } from './drive/diesel';

export const GAIT_REGISTRY: Readonly<Record<GaitKind, GaitPlugin>> = {
  walker: WALKER_GAIT,
  sprinter: SPRINTER_GAIT,
  heavy: HEAVY_GAIT,
  treads: TREADS_GAIT,
  spider: SPIDER_GAIT,
};

export const DRIVE_REGISTRY: Readonly<Record<DriveKind, DrivePlugin>> = {
  jets: JETS_DRIVE,
  flight: FLIGHT_DRIVE,
  hover: HOVER_DRIVE,
  afterburner: AFTERBURNER_DRIVE,
  overcharge: OVERCHARGE_DRIVE,
  diesel: DIESEL_DRIVE,
};
