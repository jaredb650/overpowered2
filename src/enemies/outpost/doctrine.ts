/**
 * The Outpost's numbers and its standing orders. Everything here is data.
 *
 * `Doctrine` is what The Commander will change between waves (section 16.2): each field is a rule a later answer to the
 * player can flip, and nothing reads a habit of the player's directly. Squad templates are the same idea for who turns up.
 */
import type { EnemyId } from '../../core/gameplay';

export type Role = 'rifle' | 'shotgun' | 'machinegun' | 'rocket' | 'marksman' | 'shield' | 'medic';

export interface RoleDef {
  /** Metres from the threat it wants to fight at. */
  near: number;
  far: number;
  /** Rounds, bursts or rockets before a reload, counted in shots. */
  mag: number;
  reload: number;
  /** Starting morale. Heavier kit means a harder man. */
  morale: number;
  /** Can shoot while walking. Long weapons stop first. */
  firesOnTheMove: boolean;
  /** Never goes on a flank: it is the base of fire. */
  base: boolean;
}

export const ROLES: Record<Role, RoleDef> = {
  rifle: { near: 11, far: 26, mag: 18, reload: 2.3, morale: 100, firesOnTheMove: true, base: false },
  shotgun: { near: 5, far: 12, mag: 5, reload: 2.8, morale: 100, firesOnTheMove: true, base: false },
  machinegun: { near: 14, far: 32, mag: 66, reload: 4.2, morale: 125, firesOnTheMove: false, base: true },
  rocket: { near: 14, far: 34, mag: 2, reload: 4, morale: 105, firesOnTheMove: false, base: true },
  marksman: { near: 20, far: 46, mag: 4, reload: 3, morale: 105, firesOnTheMove: false, base: true },
  shield: { near: 6, far: 16, mag: 8, reload: 2.2, morale: 120, firesOnTheMove: true, base: false },
  medic: { near: 12, far: 26, mag: 6, reload: 2.4, morale: 110, firesOnTheMove: false, base: true },
};

export const ROLE_OF: Partial<Record<EnemyId, Role>> = {
  trooper: 'rifle', gunner: 'shotgun', brute: 'machinegun', rocketeer: 'rocket', sniper: 'marksman', riot: 'shield', warden: 'medic',
};

/** Who takes over when the leader falls, best first. A medic or a sniper will run a squad only if nobody else is left. */
export const SUCCESSION: readonly Role[] = ['rifle', 'shield', 'shotgun', 'machinegun', 'rocket', 'medic', 'marksman'];

export const CALLSIGNS = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'] as const;

/** Section 14.2: about 8 on wave 1 and rarely over about 18 alive. */
export const MAX_HOSTILE = 18;
const FIRST_WAVE_STRENGTH = 8;
const STRENGTH_PER_WAVE = 2;
const MAX_STRENGTH = 40;
export const MIN_SQUAD = 3;
export const MAX_SQUAD = 6;

export interface SquadTemplate {
  /** First wave this squad type can appear in. */
  from: number;
  weight: number;
  /** In seat order. The first seat leads unless its role rules it out. */
  members: readonly EnemyId[];
}

/** Every rifle squad carries a base of fire or a close-quarters man, so a squad always has something to do besides stand. */
export const SQUAD_TEMPLATES: readonly SquadTemplate[] = [
  { from: 1, weight: 3, members: ['trooper', 'trooper', 'brute', 'trooper'] },
  { from: 1, weight: 3, members: ['trooper', 'gunner', 'trooper', 'gunner'] },
  { from: 2, weight: 2, members: ['riot', 'gunner', 'trooper', 'trooper'] },
  { from: 3, weight: 2, members: ['trooper', 'brute', 'warden', 'trooper', 'trooper'] },
  { from: 3, weight: 1.5, members: ['trooper', 'rocketeer', 'trooper'] },
  { from: 4, weight: 1.5, members: ['sniper', 'trooper', 'trooper'] },
  { from: 5, weight: 1.5, members: ['riot', 'riot', 'gunner', 'warden', 'trooper'] },
  { from: 6, weight: 1.5, members: ['trooper', 'brute', 'rocketeer', 'warden', 'riot', 'trooper'] },
];

export const waveStrength = (wave: number): number => Math.min(FIRST_WAVE_STRENGTH + STRENGTH_PER_WAVE * (wave - 1), MAX_STRENGTH);

/** Wave 1 is always the pair the doctrine is built around: a machine gun to pin and a rifle squad to move. */
const OPENING: readonly (readonly EnemyId[])[] = [SQUAD_TEMPLATES[0]!.members, SQUAD_TEMPLATES[1]!.members];

export function composeOutpostWave(wave: number, roll: () => number = Math.random): EnemyId[][] {
  if (wave <= 1) return OPENING.map(s => [...s]);
  const open = SQUAD_TEMPLATES.filter(t => t.from <= wave);
  const out: EnemyId[][] = [];
  let left = waveStrength(wave);
  while (left > 0) {
    if (left < MIN_SQUAD && out.length > 0) {
      // A squad of one or two is no squad. The odd men fill empty seats instead.
      const room = out.find(s => s.length < MAX_SQUAD);
      if (!room) break;
      room.push('trooper');
      left--;
      continue;
    }
    let total = 0;
    for (const t of open) total += t.weight;
    let r = roll() * total;
    let picked = open[0]!;
    for (const t of open) {
      r -= t.weight;
      if (r <= 0) {
        picked = t;
        break;
      }
    }
    const squad = picked.members.slice(0, Math.min(picked.members.length, left));
    out.push(squad);
    left -= squad.length;
  }
  return out;
}

export interface Doctrine {
  /** Anyone may give up. The Commander turns this off once the player starts executing prisoners. */
  surrender: boolean;
  /** Chance a broken man gives up rather than runs, with the player out of reach. Close by he has no choice. */
  surrenderChance: number;
  /** Metres between men when choosing cover. Raised against explosives. */
  spacing: number;
  /** Fragmentation grenades a soldier carries. */
  grenades: number;
  /** Degrees off the base of fire that a flanking team aims for. */
  flankAngle: number;
  /** Seconds of nobody knowing where the player is before Command passes on a rough fix. No round stalls on a hider. */
  fixAfter: number;
  /** Metres of error on that fix. */
  fixError: number;
}

export const defaultDoctrine = (): Doctrine => ({
  surrender: true,
  surrenderChance: 0.35,
  spacing: 2.2,
  grenades: 1,
  flankAngle: 95,
  fixAfter: 12,
  fixError: 7,
});

/** Simultaneous shooters and the gap between bursts. Fewer men than the swarm, so each one gets to matter. */
export function fireRules(wave: number): { limit: number; gap: number } {
  return { limit: Math.min(3 + Math.floor(wave / 2), 7), gap: Math.max(0.5 - wave * 0.03, 0.2) };
}
