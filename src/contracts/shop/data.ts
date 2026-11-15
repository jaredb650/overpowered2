/**
 * The Crucible's shop (docs/proposals/weapons-update.md, section 10): every number and every line of its copy. No three.js, so
 * the tests and the menu read it as the runtime does. The pay is Outpost Defense's (defense/data.ts): the same kill and wave
 * rates, the same rule on whose kills pay.
 *
 * In the Crucible the weapon caches stop: the guns they brought are sold here instead, each from a wave on, roughly where its
 * cache used to land (progression's CACHE_ORDER, one every second wave), and the Lance last.
 */
import { MISSION_ID } from '../../campaign/select';
import { ON_RANGE } from '../../core/devflags';
import type { ModId, WeaponId } from '../../core/gameplay';
import { ACTIVE } from '../select';

const query = typeof location === 'undefined' ? null : new URLSearchParams(location.search);

/**
 * This page's Crucible sells its guns: the Crucible's own game, not a mission, the range or a sandbox. `?shop=0` brings the
 * weapon caches back.
 */
export const SHOP_ON: boolean =
  query !== null && ACTIVE.def.id === 'crucible' && MISSION_ID === null && !ON_RANGE && !query.has('sandbox') && query.get('shop') !== '0';

/**
 * Seconds of a break with the shop on, at least: the supply pod takes about 6 s to land and open (progression's DROP_POD), and then
 * there has to be time to run to it, up to 110 m (`SUPPLY.far`), and shop. The Crucible's own 8 s break would never reach it. L ends a
 * break early, as in Outpost Defense.
 */
export const SUPPLY_BREAK = 25;

/** A boss's kill on top of the ordinary pay: a Juggernaut or a Titan is a wave's work. */
export const BOSS_PAY = 300;

export interface Ware {
  /** Credits. */
  price: number;
  /** The wave that has to be cleared before it is sold. 0: from the start. */
  wave: number;
  /** The catalogue's line. */
  lore: string;
}

/** The guns for sale, in the menu's order. The run's starting guns are not sold: they are issued. */
export const WEAPON_WARES: Readonly<Partial<Record<WeaponId, Ware>>> = {
  rivet: {
    price: 350, wave: 2,
    lore: 'Compact, semi-automatic and inexpensive, like the contractor. Right click fires three, for those who were going to miss anyway.',
  },
  judge: {
    price: 600, wave: 2,
    lore: 'Six chambers, one opinion. The Judge has never been overturned on appeal, chiefly because nobody has survived to file one.',
  },
  autocannon: {
    price: 1800, wave: 4,
    lore: 'Twenty millimetres of shoulder-fired dispute resolution. The recoil is a feature. Please brace against something the Council does not own.',
  },
  deuce: {
    price: 1400, wave: 6,
    lore: 'Two barrels, because one was occasionally not enough and three failed the fire inspection. Reloading is left as an exercise for the contractor.',
  },
  buzzsaw: {
    price: 2600, wave: 8,
    lore: 'Six barrels and an electric motor. Ammunition is billed by the second, and the motor resents being let go.',
  },
  kiln: {
    price: 2200, wave: 10,
    lore: 'Napalm by the hose, for areas the Council has already written off. Do not point it at assets. Everything is an asset until it is on fire.',
  },
  stakegun: {
    price: 2000, wave: 12,
    lore: 'Fires a steel stake, which stays in. The exploding kind also stays in, briefly. Not for use near anything you would miss.',
  },
  ultramag: {
    price: 1700, wave: 14,
    lore: 'The hardest-hitting pistol in the catalogue, for when the argument has to end in one sentence. The slide is polished so the last thing they see is themselves.',
  },
  piledriver: {
    price: 3200, wave: 16,
    lore: 'A heavy machine gun for carrying, by people who stopped asking whether they should. Each round is about the size of a decision you cannot take back.',
  },
  lance: {
    price: 4500, wave: 18,
    lore: 'Directed energy for the senior contractor. Targets are not so much killed as removed from the records, the floor and the air.',
  },
};

export const WEAPON_WARE_ORDER = Object.keys(WEAPON_WARES) as WeaponId[];

/** The mods for sale (src/weapons/mods.ts). Bought once, then fitted or taken off here, free, in any break. */
export const MOD_WARES: Readonly<Record<ModId, Ware>> = {
  suppressor: {
    price: 900, wave: 0,
    lore: 'Quieter, faster and a tenth more lethal: the Council\'s working definition of good manners. Complaints about the noise will not be received.',
  },
  reddot: {
    price: 500, wave: 0,
    lore: 'A red dot on the Harrow, so you always know where the round is going. The Council regrets it cannot offer its contractors the same.',
  },
  raufoss: {
    price: 2400, wave: 10,
    lore: 'Every dart now bursts where it lands and sends what is left out of the far side. Cover has been reclassified as a suggestion.',
  },
};

/** The menu's heading and its small print. */
export const SHOP_COPY = {
  title: 'Procurement',
  form: 'Form 7742-P',
  terms: 'Purchases are final. So, statistically, is the purchaser.',
} as const;
