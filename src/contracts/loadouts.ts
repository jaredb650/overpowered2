import type { WeaponId } from '../core/gameplay';
import { STARTING_WEAPONS } from '../weapons/data';
import { inPlay } from '../weapons/families';
import type { ContractId } from './data';
import { hasStarter, selectedStarter, type StarterGun } from './starter';

export function survivalLoadout(contract: ContractId, available = inPlay, starter: StarterGun | undefined = hasStarter(contract) ? selectedStarter(contract) : undefined): readonly WeaponId[] {
  return STARTING_WEAPONS.map(id => {
    if (id === 'smg' && starter && available(starter)) return starter;
    if (id === 'rivet' && !available('rivet')) return 'judge';
    return id;
  });
}
