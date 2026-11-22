/** Desert Raid mission script stub (replaced by Lane 5). */
import type { Loadout, Mission } from '../types';

const LOADOUT: Loadout = { weapons: ['smg', 'ultramag', 'satchel', 'knife'], grenades: 4 };

export const DESERT_RAID: Mission = {
  id: 'desert_raid',
  title: 'Desert Raid',
  corpses: 36,
  loadout: LOADOUT,
  redeployLines: [],
  lines: [],
  marks: { start: { at: [0, 0, 208], yaw: 0 } },
  zones: {},
  doors: {},
  routes: {},
  cutscenes: {},
  beats: [
    {
      id: 'approach',
      title: 'The Approach',
      checkpoint: { at: 'start', loadout: LOADOUT },
      start: [{ do: 'finish' }],
    },
  ],
};
