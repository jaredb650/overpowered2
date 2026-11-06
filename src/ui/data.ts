/** Display names, colours, and the copy behind the guide. Numbers here are design values from docs/DESIGN.md. */
import type { Action } from '../core/contracts';
import type { CallInId, EnemyId, PerkId, PowerupId, WeaponId } from '../core/gameplay';
import { CALLINS as CALLIN_DEFS, EFFECTS } from '../progression/data';

export const WEAPON_ORDER: readonly WeaponId[] = [
  'smg', 'shotgun', 'rocket', 'autocannon', 'sword', 'judge', 'lance', 'buzzsaw', 'kiln', 'stakegun',
];

export interface WeaponInfo {
  name: string;
  key: string;
  role: string;
  note: string;
}

export const WEAPONS: Record<WeaponId, WeaponInfo> = {
  smg: { name: 'SMG', key: '1', role: 'Pixel-accurate, 20 rounds a second', note: 'Akimbo in Berserk: both guns fire.' },
  shotgun: { name: 'Shotgun', key: '2', role: 'Six pellets, semi-auto', note: 'Point blank, pellets take limbs off.' },
  rocket: { name: 'Rocket', key: '3', role: '100 damage, 8 m blast, one in the tube', note: 'Fire at your feet to rocket jump. Direct hits gib.' },
  autocannon: { name: 'Autocannon', key: '4', role: '30 mm, instakill blast, 5 m radius', note: 'Right click to scope.' },
  sword: { name: 'Sword', key: '5', role: 'Three-swing chain', note: 'Right click sweeps, hold to block bullets, then finish heavy.' },
  judge: { name: 'Judge', key: '6', role: 'Revolver, 120 damage, six shots', note: 'A headshot ricochets to the next head.' },
  lance: { name: 'Lance', key: '7', role: 'Railgun, charge and release', note: 'Pierces everything in line.' },
  buzzsaw: { name: 'Buzzsaw', key: '8', role: 'Minigun, spins up to 50 rounds a second', note: 'Slows you down. Shreds limbs one by one.' },
  kiln: { name: 'Kiln', key: '9', role: 'Flamethrower, short range', note: 'Burning enemies panic and spread fire.' },
  stakegun: { name: 'Stakegun', key: '0', role: 'Rebar stakes', note: 'Pins bodies and limbs to walls.' },
};

export interface CallInInfo {
  name: string;
  /** The input action that calls it, so the chip shows the player's own binding. */
  action: Action;
  combo: number;
  color: string;
  radius: number;
  note: string;
}

export const CALLIN_ORDER: readonly CallInId[] = ['airstrike', 'warthog', 'orbital', 'blackSun', 'nuke'];

const callIn = (id: CallInId, name: string, action: Action, note: string): CallInInfo => ({
  name, action, note, combo: CALLIN_DEFS[id].combo, color: CALLIN_DEFS[id].color, radius: CALLIN_DEFS[id].radius,
});

export const CALLINS: Record<CallInId, CallInInfo> = {
  airstrike: callIn('airstrike', 'Airstrike', 'streak', '15 rockets, then a finale.'),
  warthog: callIn('warthog', 'Warthog', 'callinWarthog', '50 shells along the line you choose.'),
  orbital: callIn('orbital', 'Orbital Lance', 'callinOrbital', 'Steer a burning beam for 6 seconds.'),
  blackSun: callIn('blackSun', 'Black Sun', 'callinBlackSun', 'Drags enemies and corpses in, then implodes.'),
  nuke: callIn('nuke', 'Tactical Nuke', 'callinNuke', 'Whites out the map.'),
};

export interface PerkInfo {
  name: string;
  color: string;
  trigger: string;
  reward: string;
}

const perk = (id: PerkId, name: string, trigger: string, reward: string): PerkInfo =>
  ({ name, trigger, reward, color: EFFECTS[id].color });

export const PERKS: Record<PerkId, PerkInfo> = {
  bloodthirst: perk('bloodthirst', 'Blood Thirst', '4 kills in 5 s', '10 s of 2x damage, bottomless mags, double pellets'),
  hellfire: perk('hellfire', 'Hellfire', '10 kills in 10 s', '5 s of explosive rounds and huge instakill rockets'),
  berserk: perk('berserk', 'Berserk', 'Combo 15', '10 s of 5x damage, 3x fire rate, 2x speed, akimbo, no damage taken'),
  adrenaline: perk('adrenaline', 'Adrenaline', '3 sword kills in 3 s', 'Speed boost, stacks to 3'),
  slowmo: perk('slowmo', 'Slowmo', '3 headshots in 3 s', '5 s with the world at quarter speed, you at full speed'),
  sentinels: perk('sentinels', 'Sentinels', 'Combo 20', '20 s of three orbiting gun drones'),
  chainStorm: perk('chainStorm', 'Chain Storm', 'Combo 30', '12 s of every kill arcing lightning'),
  butcher: perk('butcher', 'Butcher', '3 limbs severed in 2 s', '8 s where every hit severs'),
  skyfall: perk('skyfall', 'Skyfall', '3 airborne kills in 4 s', '8 s of unlimited air dashes and an explosive slam'),
  chainReaction: perk('chainReaction', 'Chain Reaction', '3 kills from one explosion', '6 s of enemies exploding on death'),
  overdrive: perk('overdrive', 'Overdrive', '5 kills above 25 m/s', '10 s of damage that scales with your speed'),
};

const power = (id: PowerupId, name: string, note: string) => ({ name, note, color: EFFECTS[id].color });

export const POWERUPS: Record<PowerupId, { name: string; color: string; note: string }> = {
  quad: power('quad', 'Quad', '4x damage'),
  haste: power('haste', 'Haste', '1.5x speed and fire rate'),
  vampire: power('vampire', 'Vampire', 'Kills heal you'),
  ricochet: power('ricochet', 'Ricochet', 'Bullets bounce'),
  shock: power('shock', 'Shock Rounds', 'Hits arc between enemies'),
  ghost: power('ghost', 'Ghost', 'Enemies lose you past 15 m'),
  magnet: power('magnet', 'Magnet', 'Pickups fly to you'),
  regen: power('regen', 'Regen', 'Fast health and ammo'),
  frostNova: power('frostNova', 'Frost Nova', 'One use. Freezes enemies, frozen bodies shatter'),
  timeWarp: power('timeWarp', 'Time Warp', 'One use. 5 s of slow-mo'),
};

/** Combo rewards in ladder order, for the "next" line under the combo counter. */
export const LADDER: readonly { combo: number; name: string; color: string }[] = [
  { combo: 8, name: 'Airstrike', color: CALLINS.airstrike.color },
  { combo: 12, name: 'Warthog', color: CALLINS.warthog.color },
  { combo: 15, name: 'Berserk', color: PERKS.berserk.color },
  { combo: 20, name: 'Sentinels', color: PERKS.sentinels.color },
  { combo: 25, name: 'Orbital Lance', color: CALLINS.orbital.color },
  { combo: 30, name: 'Chain Storm', color: PERKS.chainStorm.color },
  { combo: 40, name: 'Black Sun', color: CALLINS.blackSun.color },
  { combo: 50, name: 'Tactical Nuke', color: CALLINS.nuke.color },
];

export const ENEMY_NAMES: Record<EnemyId, string> = {
  husk: 'Husk', trooper: 'Trooper', gunner: 'Gunner', brute: 'Brute', stalker: 'Stalker', rocketeer: 'Rocketeer',
  sniper: 'Sniper', riot: 'Riot', leaper: 'Leaper', bomber: 'Bomber', burner: 'Burner', warden: 'Warden',
  skitter: 'Skitter', drone: 'Drone', juggernaut: 'Juggernaut', titan: 'Titan',
};

export const ENEMY_GUIDE: readonly { id: EnemyId; role: string; tip: string }[] = [
  { id: 'husk', role: 'Melee swarm', tip: 'Runs straight at you and lunges. Keep moving.' },
  { id: 'trooper', role: 'Ranged', tip: 'Shoots inside 30 m, backs off under 13 m. Close the gap.' },
  { id: 'gunner', role: 'Close ranged', tip: 'Pushes in with a shotgun. Kill it before it arrives.' },
  { id: 'brute', role: 'Heavy', tip: 'Minigun and armour plates. Shoot the plates off.' },
  { id: 'stalker', role: 'Elite', tip: 'Dodges sideways when aimed at. Lead it or use blast.' },
  { id: 'rocketeer', role: 'Area denial', tip: 'Shoot the backpack.' },
  { id: 'sniper', role: 'Long range', tip: 'The laser shows the shot charging. Break the line.' },
  { id: 'riot', role: 'Frontal shield', tip: 'Flank it, or shoot off the shield arm.' },
  { id: 'leaper', role: 'Ambush', tip: 'Clings to walls and pounces. Look up.' },
  { id: 'bomber', role: 'Suicide', tip: 'Shoot the tank and it takes the pack with it.' },
  { id: 'burner', role: 'Zone', tip: 'Flamethrower. The tank explodes.' },
  { id: 'warden', role: 'Support', tip: 'Shields and buffs its neighbours. Kill it first.' },
  { id: 'skitter', role: 'Machine swarm', tip: 'Fast spider mine. Pop it at range.' },
  { id: 'drone', role: 'Flyer', tip: 'Hovering gun. It falls and crashes when shot.' },
  { id: 'juggernaut', role: 'Mini-boss', tip: 'Charges and slams. Armour comes off in stages.' },
  { id: 'titan', role: 'Boss, every 10 waves', tip: 'Shoot off arms to stop attacks, legs to drop it.' },
];

export const MOVEMENT_GUIDE: readonly { keys: string; name: string; body: string }[] = [
  { keys: 'WASD', name: 'Run', body: 'There is no sprint key. You reach 17 m/s in a fifth of a second.' },
  { keys: 'Space', name: 'Bunny hop', body: 'Hold Space through a landing and you lose nothing. Strafe in the air to gain speed with no cap.' },
  { keys: 'Space', name: 'Double jump', body: 'Jump again in the air. Your speed swings toward the keys you hold.' },
  { keys: 'Shift', name: 'Dash', body: 'Two charges, 1.4 s each. Keeps your momentum and cancels a fall.' },
  { keys: 'Ctrl / C', name: 'Slide', body: 'Keeps your speed and boosts on entry. Faster downhill. Jump out and keep all of it.' },
  { keys: 'Ctrl / C', name: 'Ground slam', body: 'In the air: drop hard. The shockwave grows with fall height. Press Space on impact to bounce.' },
  { keys: 'Hit a wall', name: 'Wall run', body: 'Any near-vertical wall at speed. 1.2 s with no gravity, then jump off for a boost.' },
  { keys: 'Space', name: 'Wall kick', body: 'Jump near a wall while airborne, once per wall.' },
  { keys: 'W', name: 'Mantle', body: 'Keep moving forward at a ledge and you climb it without losing speed.' },
];

export const CONTROLS_NOTE = 'Speed pays. Kills above 25 m/s feed Overdrive, and your speed tier multiplies your score.';
