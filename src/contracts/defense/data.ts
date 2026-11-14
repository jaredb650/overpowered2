/**
 * Outpost Defense's economy as data (docs/proposals/outpost-defense.md, piece 5): what credits pay, what everything costs,
 * the loadout's rules and the shops. Every number a balance pass would touch is in this file. No three.js.
 *
 * Tuned to Q4's default: the opening budget buys the Harrow and the Rivet with a little left over, and a player who kills
 * most of waves 1 to 4 can hire the first rocketeer in the break before wave 5, not before (economy.test.ts checks both).
 */
import type { AllyType } from '../../allies/data';
import type { CallInId, WeaponId } from '../../core/gameplay';
import { waveStrength } from '../../enemies/outpost/doctrine';

export const ECONOMY = {
  /** The loadout screen's budget. What is not spent there becomes credits. */
  budget: 1600,
  /** Per kill by the player (or a call-in the player bought). An ally's kills pay nothing, as they score nothing. */
  kill: 10,
  /** On top of `kill`, for a headshot. */
  headshot: 5,
  /** Per wave survived: `waveBase + waveStep * wave`. */
  waveBase: 125,
  waveStep: 25,
  /** Seconds of the break before wave 1, and between waves. The world stops while a shop is open. */
  firstBreak: 20,
  breakSeconds: 30,
  /** Most allies hired at once, up or down: the proposal's squad of 4 to 8. */
  squadMax: 8,
  /** Seconds of work a bought repair takes, so a wall cannot be fixed instantly mid-fight. */
  repairSeconds: 4,
} as const;

/** Credits for one kill. */
export const killPay = (headshot: boolean): number => ECONOMY.kill + (headshot ? ECONOMY.headshot : 0);
/** Credits for surviving `wave`. */
export const wavePay = (wave: number): number => ECONOMY.waveBase + ECONOMY.waveStep * wave;

// ---------------------------------------------------------------------------------------------
// Weapons and ammunition
// ---------------------------------------------------------------------------------------------

/** What a box of a gun's ammunition is, for its price and for which shop sells it. */
export type AmmoClass = 'basic' | 'specialty' | 'explosive';

export interface WeaponPrice {
  /** Credits for the gun. A base weapon brings its family members (weapons/families.ts), and is priced for both. */
  price: number;
  /** In the loadout as a primary or a secondary. Unset: Armoury only, in a break. */
  loadout?: 'primary' | 'secondary';
  /** Rockets, shells and the Lance's plasma: never in the loadout. */
  explosive?: boolean;
  ammo: AmmoClass;
  /** Credits for a box: half the gun's most reserve. The right tool is cheaper than the wrong one: the Quiver is cheap. */
  box: number;
}

/** Every gun the shops sell. Melee is not sold: the loadout carries a Shiv. */
export const WEAPON_PRICES: Partial<Record<WeaponId, WeaponPrice>> = {
  harrow: { price: 900, loadout: 'primary', ammo: 'basic', box: 90 },
  smg: { price: 1100, loadout: 'primary', ammo: 'basic', box: 60 },
  thresher: { price: 800, loadout: 'primary', ammo: 'basic', box: 80 },
  shotgun: { price: 1000, loadout: 'primary', ammo: 'basic', box: 70 },
  stakegun: { price: 1100, loadout: 'primary', ammo: 'specialty', box: 220 },
  kiln: { price: 1200, loadout: 'primary', ammo: 'specialty', box: 200 },
  sabot: { price: 1400, loadout: 'primary', ammo: 'specialty', box: 300 },
  piledriver: { price: 1800, loadout: 'primary', ammo: 'specialty', box: 280 },
  buzzsaw: { price: 2600, loadout: 'primary', ammo: 'specialty', box: 260 },
  rivet: { price: 400, loadout: 'secondary', ammo: 'basic', box: 50 },
  judge: { price: 650, loadout: 'secondary', ammo: 'basic', box: 60 },
  quiver: { price: 1600, explosive: true, ammo: 'explosive', box: 260 },
  rocket: { price: 3000, explosive: true, ammo: 'explosive', box: 450 },
  autocannon: { price: 2600, explosive: true, ammo: 'explosive', box: 420 },
  lance: { price: 2400, explosive: true, ammo: 'explosive', box: 380 },
};

/** The free melee weapon every loadout carries. */
export const LOADOUT_MELEE: WeaponId = 'knife';
/** What the loadout screen starts on: a decent rifle and a pistol (Q4). */
export const DEFAULT_LOADOUT: readonly [WeaponId, WeaponId] = ['harrow', 'rivet'];

/** A grenade, from the Armoury: explosive, so priced high. */
export const GRENADE_PRICE = 150;
/** The Infirmary and magazine's refill: half a reserve for every basic gun carried. */
export const BASIC_REFILL_PRICE = 100;

// ---------------------------------------------------------------------------------------------
// Troops, call-ins, guns, repairs, stims
// ---------------------------------------------------------------------------------------------

/**
 * Q3's ratios on a rifleman of 250: machine gunners and shotgunners twice that, riot police and medics three times, snipers,
 * rocketeers and mortar teams four to five. No upkeep.
 */
export const ALLY_PRICES: Record<AllyType | 'mortar', number> = {
  rifleman: 250,
  gunner: 500,
  shotgunner: 500,
  riot: 750,
  medic: 750,
  sniper: 1100,
  rocketeer: 1200,
  mortar: 1200,
};

/** Barracks order. Mortar teams are listed, and shut until piece 8 builds them. */
/** What each type is for, from the proposal's table. */
export const ALLY_ROLES: Record<AllyType | 'mortar', string> = {
  rifleman: 'All-rounder. Holds a wall section',
  gunner: 'All-rounder. Holds a corner',
  shotgunner: 'Close combat. Guards inside',
  riot: 'Shield line across a breach',
  medic: 'Revives with stims of his own',
  sniper: 'Range. Bad up close',
  rocketeer: 'Vehicles and choppers. Bad up close',
  mortar: 'Shells the field at random',
};

export const BARRACKS_ORDER: readonly (AllyType | 'mortar')[] = ['rifleman', 'gunner', 'shotgunner', 'riot', 'medic', 'sniper', 'rocketeer', 'mortar'];

/** Climbing with power. Bought, never earned by combo, in this mode (Q6: the Armoury, at any time). */
export const CALLIN_PRICES: Record<CallInId, number> = {
  airstrike: 600,
  warthog: 900,
  doorGunner: 1500,
  attackChopper: 2000,
  orbital: 2400,
  ac130: 3200,
  blackSun: 4500,
  nuke: 8000,
};

/** A mounted gun to the level after: index 0 buys level 2, index 1 level 3 (vehicles/emplacement.ts, MOUNT_LEVELS). */
export const MOUNT_PRICES: readonly number[] = [700, 1600];

/** One stage of a repair. A chipped piece that is still intact costs half. Shacks are cover for the enemy, so not sold. */
export const REPAIR_PRICES = { wall: 250, gate: 350 } as const;

export const STIM_PRICE = 150;

// ---------------------------------------------------------------------------------------------
// Shops
// ---------------------------------------------------------------------------------------------

export type ShopId = 'barracks' | 'armoury' | 'infirmary';

export interface ShopDef {
  id: ShopId;
  name: string;
  /** What the menu says it is for. */
  blurb: string;
  /** Q1: a building with health. A later agent wires attackers to it. */
  health: number;
  /** Q7: rebuilt in a break, for a large sum. */
  rebuild: number;
  color: string;
}

export const SHOPS: Record<ShopId, ShopDef> = {
  barracks: {
    id: 'barracks', name: 'Barracks', blurb: 'Hire troops, replace the fallen, send work crews to the walls.',
    health: 1500, rebuild: 2500, color: '#8fd16a',
  },
  armoury: {
    id: 'armoury', name: 'Armoury', blurb: 'Weapons in a break. Ammunition by type, gun upgrades and call-ins at any time.',
    health: 1500, rebuild: 3000, color: '#ffc14a',
  },
  infirmary: {
    id: 'infirmary', name: 'Infirmary', blurb: 'Stims and basic ammunition. The magazine.',
    health: 1500, rebuild: 3500, color: '#39e0ff',
  },
};

export const SHOP_ORDER: readonly ShopId[] = ['barracks', 'armoury', 'infirmary'];

/**
 * What the break says is coming, until the wave director (piece 7) supplies `preview(wave)` on `ctx.waves`. Until then the
 * waves are Endless Humans' own, so this says what those are.
 */
export function placeholderPreview(wave: number): string {
  return `About ${waveStrength(wave)} men in squads. Endless Humans' waves stand in until the wave director is built`;
}
