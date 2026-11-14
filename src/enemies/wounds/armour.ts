/**
 * Section 14.6, armour: a plate carrier and a helmet, as the same plates the Brute wears. Front plate only, so a flanker or a man
 * running away has nothing behind him: what the plate covers is exactly what the player has to work round. Light roles go without.
 */
import { HumanoidBone as B } from '../../characters/rig';
import type { PlatePaint, PlateSpec } from '../armor';
import type { Role } from '../outpost/doctrine';

/** The suit's own colours, so it reads as kit and not as a target. */
const KIT: PlatePaint = { body: 0x1c2733, rib: 0x263340, edge: 0x4d5c6a, bolt: 0x8c969e, stripe: 0x33424f };

const CARRIER: PlateSpec = {
  regions: ['chest'], bone: B.chest, hp: 0.5, shape: 'slab', paint: KIT, size: [0.34, 0.3, 0.05], offset: [0, 0.1, 0.17], tilt: [-0.06, 0, 0], facing: 'front',
};
export const HELMET: PlateSpec = {
  regions: ['head'], bone: B.head, hp: 0.3, shape: 'slab', paint: KIT, size: [0.17, 0.2, 0.05], offset: [0, 0.205, 0.02], tilt: [-Math.PI / 2, 0, 0],
  worn: 'head',
};

/** The machine gunner already carries more iron than this. */
export const ARMOUR: Record<Role, readonly PlateSpec[]> = {
  rifle: [CARRIER, HELMET],
  shotgun: [CARRIER, HELMET],
  machinegun: [],
  rocket: [CARRIER, HELMET],
  marksman: [],
  shield: [HELMET],
  medic: [CARRIER],
};

/** What a plate has left when it starts to hang off him, as a share of what it started with. */
export const CRACKED = 0.55;
/** How far a cracked plate drops and tips. */
export const CRACK_DROP = 0.02;
export const CRACK_TIP = 0.2;
