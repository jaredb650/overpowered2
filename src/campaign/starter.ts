import { starterLoadout, type StarterGun } from '../contracts/starter';
import type { Loadout, Mission } from './types';

/** Adapt the whole checkpoint plan before validation, keeping the guaranteed-pickup rule intact. */
export function missionWithStarter(mission: Mission, gun: StarterGun): Mission {
  const kit = (loadout: Loadout): Loadout => ({ ...loadout, weapons: starterLoadout(loadout.weapons, gun) });
  return {
    ...mission, loadout: kit(mission.loadout),
    beats: mission.beats.map(beat => beat.checkpoint
      ? { ...beat, checkpoint: { ...beat.checkpoint, loadout: kit(beat.checkpoint.loadout) } } : beat),
  };
}
