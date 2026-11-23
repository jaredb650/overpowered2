import { isStarter, sanitizeStarterMods, starterLoadout, type StarterGun } from '../contracts/starter';
import type { ModId } from '../core/gameplay';
import { MODS } from '../weapons/mods';
import type { Loadout, Mission } from './types';

/** Adapt the whole checkpoint plan before validation, keeping the guaranteed-pickup rule intact. */
export function missionWithStarter(mission: Mission, gun: StarterGun, mods?: readonly ModId[]): Mission {
  const customMods = mods !== undefined ? sanitizeStarterMods(gun, mods) : undefined;
  const kit = (loadout: Loadout): Loadout => {
    const next: Loadout = { ...loadout, weapons: starterLoadout(loadout.weapons, gun) };
    if (customMods !== undefined) {
      const fixed = (loadout.mods ?? []).filter(id => Object.hasOwn(MODS, id) && !isStarter(MODS[id].weapon));
      next.mods = [...fixed, ...customMods];
      next.exclusiveMods = true;
    }
    return next;
  };
  return {
    ...mission, loadout: kit(mission.loadout),
    beats: mission.beats.map(beat => beat.checkpoint
      ? { ...beat, checkpoint: { ...beat.checkpoint, loadout: kit(beat.checkpoint.loadout) } } : beat),
  };
}
