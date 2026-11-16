import type { WeaponId } from '../core/gameplay';
import { STARTING_WEAPONS } from '../weapons/data';
import { inPlay } from '../weapons/families';
import type { ContractId } from './data';

export function survivalLoadout(contract: ContractId, available = inPlay): readonly WeaponId[] {
  return STARTING_WEAPONS.map(id => {
    if (id === 'smg' && contract === 'outpost' && available('harrow')) return 'harrow';
    if (id === 'rivet' && !available('rivet')) return 'judge';
    return id;
  });
}
