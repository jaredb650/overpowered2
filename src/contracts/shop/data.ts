/**
 * The Crucible's shop (docs/proposals/weapons-update.md, section 10): every number and every line of its copy. No three.js, so
 * the tests and the menu read it as the runtime does. The pay is Outpost Defense's (defense/data.ts): the same kill and wave
 * rates, the same rule on whose kills pay.
 *
 * In every endless survival game but Outpost Defense (`SHOP_CONTRACTS`) the weapon caches stop: the guns they brought are sold here
 * instead, each from a wave on, roughly where its cache used to land (progression's CACHE_ORDER, one every second wave), and the
 * Lance last. Every other player weapon is listed too, so the catalogue is the whole arsenal: the issued guns as issued.
 */
import { MISSION_ID } from '../../campaign/select';
import { ON_RANGE } from '../../core/devflags';
import type { ModId, WeaponId } from '../../core/gameplay';
import type { ContractId } from '../data';
import { ACTIVE } from '../select';

const query = typeof location === 'undefined' ? null : new URLSearchParams(location.search);

/**
 * The endless survival games that sell their guns from a supply pod: the Crucible and Endless Humans. Outpost Defense
 * (`defense`) has its own shops, and the Campaign and Foreclosure are missions.
 */
export const SHOP_CONTRACTS: readonly ContractId[] = ['crucible', 'outpost'];

/**
 * This page sells its guns: one of `SHOP_CONTRACTS`' own games, not a mission, the range or a sandbox. `?shop=0` brings the
 * weapon caches back.
 */
export const SHOP_ON: boolean =
  query !== null && SHOP_CONTRACTS.includes(ACTIVE.def.id) && MISSION_ID === null && !ON_RANGE && !query.has('sandbox')
  && query.get('shop') !== '0';

/**
 * Seconds of a break with the shop on, at least: the supply pod takes about 6 s to land and open (progression's DROP_POD), and then
 * there has to be time to run to it, up to 110 m (`SUPPLY.far`), and shop. The Crucible's own 8 s break would never reach it. L ends a
 * break early, as in Outpost Defense.
 */
export const SUPPLY_BREAK = 25;

/** A boss's kill on top of the ordinary pay: a Juggernaut or a Titan is a wave's work. */
export const BOSS_PAY = 300;

export interface Ware {
  /** Credits. 0: issued, never sold. */
  price: number;
  /** The wave that has to be cleared before it is sold. 0: from the start. */
  wave: number;
  /** The catalogue's line. */
  lore: string;
}

/**
 * Every player weapon, in the menu's order: for sale by the wave it waits for, then the run's starting guns, which are issued (price
 * 0, never sold). The Shiv, Cosh, Prybar and Spade are listed only where they are in play (`?melee=four`, weapons/families.ts).
 */
export const WEAPON_WARES: Readonly<Partial<Record<WeaponId, Ware>>> = {
  knife: {
    price: 250, wave: 1,
    lore: 'A short knife for the contractor who likes to be close enough to apologise. Works best from behind, like most Council policy.',
  },
  gimlet: {
    price: 450, wave: 1,
    lore: 'A carbine with a four-power sight, so you can read the name tag before you file it. Supplied suppressed: the Council prefers its incidents quiet.',
  },
  rivet: {
    price: 350, wave: 2,
    lore: 'Compact, semi-automatic and inexpensive, like the contractor. Right click fires three, for those who were going to miss anyway.',
  },
  judge: {
    price: 600, wave: 2,
    lore: 'Six chambers, one opinion. The Judge has never been overturned on appeal, chiefly because nobody has survived to file one.',
  },
  baton: {
    price: 300, wave: 3,
    lore: 'Puts people on the floor without quite finishing them, which makes them a bounty rather than a statistic. The Council accepts both.',
  },
  autocannon: {
    price: 1800, wave: 4,
    lore: 'Twenty millimetres of shoulder-fired dispute resolution. The recoil is a feature. Please brace against something the Council does not own.',
  },
  crowbar: {
    price: 450, wave: 5,
    lore: 'Opens crates, doors and kneecaps. For the purposes of this tool, plate armour is a door.',
  },
  deuce: {
    price: 1400, wave: 6,
    lore: 'Two barrels, because one was occasionally not enough and three failed the fire inspection. Reloading is left as an exercise for the contractor.',
  },
  shovel: {
    price: 500, wave: 7,
    lore: 'For the work and for afterwards. The edge takes heads off, and the face throws what it kills, which saves on digging.',
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
  // Issued: every run starts with these, so they are listed, never sold.
  smg: {
    price: 0, wave: 0,
    lore: 'Issued to every contractor, along with the paperwork and the life insurance. Of the three, only the submachine gun is guaranteed to work.',
  },
  harrow: {
    price: 0, wave: 0,
    lore: 'A battle rifle with no respect for cover. Issued so the Council can say it gave you a fair chance.',
  },
  shotgun: {
    price: 0, wave: 0,
    lore: 'Several opinions per pull, all delivered at once and at conversational range. The pump is the pause for reflection.',
  },
  thresher: {
    price: 0, wave: 0,
    lore: 'A drum-fed shotgun for contractors who found the pump too contemplative. It climbs as it fires. So does the invoice.',
  },
  rocket: {
    price: 0, wave: 0,
    lore: 'The Council\'s insurers asked that it be listed as a last resort. It is listed here as a first one.',
  },
  quiver: {
    price: 0, wave: 0,
    lore: 'Four missiles that find their own way to the target, which is more than the Council expects of its contractors.',
  },
  sabot: {
    price: 0, wave: 0,
    lore: 'Darts through armour, through walls and through whatever the walls were for. Issued with the Council\'s condolences to the walls.',
  },
  sword: {
    price: 0, wave: 0,
    lore: 'Issued because the blade, unlike the ammunition, is not billed. It stops bullets, which the Council regards as a perk rather than a benefit.',
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
  harrowAcog: {
    price: 700, wave: 2,
    lore: 'Four-power magnification for the Harrow. The target appears four times larger, and in the Council\'s experience so does the paperwork.',
  },
  // The Gimlet's ACOG and suppressor are issued fitted (weapons/mods.ts ISSUED): price 0, listed so they can be taken off.
  gimletAcog: {
    price: 0, wave: 0,
    lore: 'Issued with the Gimlet. Four-power, for confirming at a distance what you already suspected up close.',
  },
  gimletDot: {
    price: 250, wave: 0,
    lore: 'A red dot in the ACOG\'s place, for contractors who would rather see the room than the man across it. The ACOG is kept on file.',
  },
  gimletCan: {
    price: 0, wave: 0,
    lore: 'Issued with the Gimlet. Take it off and everyone hears you, which some contractors mistake for leadership.',
  },
  gimletGl: {
    price: 1200, wave: 4,
    lore: 'A 40 mm launcher under the barrel. Hold R to bring it to bear. One round, then a reload, then usually a silence.',
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
