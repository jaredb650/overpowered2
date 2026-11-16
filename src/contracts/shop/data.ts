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
import { survivalLoadout } from '../loadouts';

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
const WEAPON_CATALOGUE: Readonly<Partial<Record<WeaponId, Ware>>> = {
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
    lore: 'Compact, semi-automatic and inexpensive, like the contractor. It does nothing else, which is also like the contractor.',
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
  autoraffica: {
    price: 2100, wave: 12,
    lore: 'Three rounds a pull through a silencer it was born with. Hold R and it finds the head for you: the Council has been automating the contractor for years, and is pleased to report progress.',
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
  smg: {
    price: 350, wave: 1,
    lore: 'A submachine gun, paperwork and life insurance are available separately. Only the submachine gun is guaranteed to work.',
  },
  harrow: {
    price: 700, wave: 2,
    lore: 'A battle rifle with no respect for cover. The Council considers a fair chance an optional expense.',
  },
  shotgun: {
    price: 600, wave: 1,
    lore: 'Several opinions per pull, all delivered at once and at conversational range. The pump is the pause for reflection.',
  },
  thresher: {
    price: 1000, wave: 3,
    lore: 'A drum-fed shotgun for contractors who found the pump too contemplative. It climbs as it fires. So does the invoice.',
  },
  rocket: {
    price: 1500, wave: 4,
    lore: 'The Council\'s insurers asked that it be listed as a last resort. It is listed here as a first one.',
  },
  quiver: {
    price: 2400, wave: 8,
    lore: 'Four missiles that find their own way to the target, which is more than the Council expects of its contractors.',
  },
  awl: {
    price: 950, wave: 2,
    lore: 'Five rounds and a bolt you operate yourself. The Council has identified the missing automation as a saving.',
  },
  sabot: {
    price: 1800, wave: 6,
    lore: 'Darts through armour, through walls and through whatever the walls were for. Supplied with the Council\'s condolences to the walls.',
  },
  sword: {
    price: 250, wave: 0,
    lore: 'Issued because the blade, unlike the ammunition, is not billed. It stops bullets, which the Council regards as a perk rather than a benefit.',
  },
};

export function weaponWares(contract: ContractId): Readonly<Partial<Record<WeaponId, Ware>>> {
  const starting = new Set(survivalLoadout(contract));
  // Kill House / Endless Humans: compress the catalogue's weapon progression into waves 0–9. The cap also
  // covers future weapons with later catalogue locks; the Crucible and all non-weapon wares keep their locks.
  return Object.fromEntries(Object.entries(WEAPON_CATALOGUE).map(([id, ware]) =>
    [id, starting.has(id as WeaponId) ? { ...ware, price: 0, wave: 0 }
      : contract === 'outpost' ? { ...ware, wave: Math.min(9, Math.ceil(ware.wave / 2)) } : ware]));
}

export const WEAPON_WARES = weaponWares(ACTIVE.def.id);
export const WEAPON_WARE_ORDER = Object.keys(WEAPON_CATALOGUE) as WeaponId[];

/** The mods for sale (src/weapons/mods.ts). Bought once, then fitted or taken off here, free, in any break. */
export const MOD_WARES: Readonly<Record<ModId, Ware>> = {
  awlAcog: { price: 600, wave: 2, lore: 'Four-power glass instead of the scout scope. Less tunnel. The same end of it.' },
  awlAp: { price: 450, wave: 2, lore: 'Less to the man, more through his plate. Procurement calls this targeting.' },
  awlHp: { price: 450, wave: 2, lore: 'More to the man, nothing through his plate. Please read the dress code.' },
  awlCan: { price: 500, wave: 2, lore: 'For sending a personal message without notifying the entire department.' },
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
  // Extended magazines and the Gimlet's short barrel (weapons/mods.ts): a mag slot and a barrel slot, beside the optic and the round.
  smgMag: {
    price: 500, wave: 1,
    lore: 'Forty-five rounds where there were thirty. The Council found that most contractors reload at the worst possible moment and has moved that moment back.',
  },
  rivetMag: {
    price: 300, wave: 2,
    lore: 'Twenty-two rounds for the Rivet, seven more chances to make the first one count. The magazine now leaves the grip by a hand\'s width, like the contractor\'s confidence.',
  },
  piledriverBox: {
    price: 1800, wave: 16,
    lore: 'A box twice the size: a hundred rounds of belt before you stop. The Council has not been able to find a reason to stop. It has stopped looking.',
  },
  gimletShort: {
    price: 800, wave: 3,
    lore: 'Ten centimetres off the Gimlet\'s barrel and fifteen percent on its rate of fire. The can screws back onto the stub and the launcher still fits under it. Procurement searched for a catch and has filed none.',
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
  sabotBrake: {
    price: 900, wave: 4,
    lore: 'A brake on the Sabot\'s muzzle, so the gun stops arguing with your shoulder sooner and the next dart goes a quarter earlier. The shoulder was not consulted.',
  },
  trommel12: {
    price: 3000, wave: 12,
    lore: 'The Trommel rebarrelled for heavy machine-gun rounds: three barrels, the Piledriver\'s round, the Trommel\'s appetite. Walls are now a formality.',
  },
  raufoss: {
    price: 2400, wave: 10,
    lore: 'Every dart now bursts where it lands and sends what is left out of the far side. Cover has been reclassified as a suggestion.',
  },  // AP, HP and +P rounds (weapons/mods.ts, AMMO in weapons/data.ts): one ammo mod to a gun, or ball with none.
  smgAp: {
    price: 400, wave: 2,
    lore: 'Steel-cored rounds for the SMG. They go through the plate and arrive a little tired. The Council can relate.',
  },
  smgHp: {
    price: 400, wave: 0,
    lore: 'Hollow-points for the SMG. Ruinous to a man in a shirt, polite to a man in a plate. Find out which before you commit.',
  },
  gimletAp: {
    price: 500, wave: 2,
    lore: 'Armour-piercing rounds for the Gimlet. A helmet is now a hat. The man under it is still a man, for slightly less time.',
  },
  gimletHp: {
    price: 500, wave: 0,
    lore: 'Hollow-points for the Gimlet: half again as bad for the body and no use at all against a plate. Know your audience.',
  },
  harrowAp: {
    price: 600, wave: 2,
    lore: 'The Harrow already breaks plates. These go through them without stopping to break anything, and then through the next man as well.',
  },
  harrowHp: {
    price: 600, wave: 0,
    lore: 'Hollow-points for the Harrow. Each round stays in the first man it meets, who will not be writing to thank you.',
  },
  rivetAp: {
    price: 300, wave: 2,
    lore: 'Armour-piercing rounds for the Rivet. Fifteen small arguments a plate cannot win, only lose slowly.',
  },
  rivetHp: {
    price: 300, wave: 0,
    lore: 'Hollow-points for the Rivet. At the range it is any good at, nobody is wearing enough.',
  },
  ultramagAp: {
    price: 700, wave: 2,
    lore: 'A penetrator for the Ultramag. The plate is a formality. The man behind it is a second formality.',
  },
  ultramagHp: {
    price: 700, wave: 0,
    lore: 'The largest hollow-point the Council would sign for. Against flesh, a closing statement. Against a plate, a loud knock.',
  },
  ultramagCan: {
    price: 600, wave: 0,
    lore: 'A square suppressor for the Ultramag, because round ones were felt to be a little forgiving. It is quieter. Nobody said quiet.',
  },
  ultramagDot: {
    price: 500, wave: 0,
    lore: 'A reflex sight on the slide. Put the dot on the problem and the problem is resolved. Procurement prefers the word resolved.',
  },
  ultramagLam: {
    price: 900, wave: 4,
    lore: 'A laser module. The Council cannot explain why it makes the gun fire faster, and has stopped asking, as the numbers are good.',
  },
  ultramagMag: {
    price: 500, wave: 0,
    lore: 'Eleven rounds where there were seven. The extra four are for the people who heard the first seven.',
  },
  judgeAp: {
    price: 600, wave: 2,
    lore: 'Armour-piercing slugs for the Judge. The verdict goes straight through the appeal.',
  },
  judgeHp: {
    price: 600, wave: 0,
    lore: 'Hollow-point slugs for the Judge: the harshest sentence in the catalogue, unless the accused is wearing a plate, in which case it is a warning.',
  },
  // The Deuce's quad barrels and speed loader (they stack), the pump's choke, the Judge's hammer and grip (they stack).
  deuceQuad: {
    price: 1600, wave: 8,
    lore: 'Two more barrels on top of the first two. The fire inspection that failed three has not been told about four. Right click fires all of them, which the manual calls optimism.',
  },
  deuceLoader: {
    price: 600, wave: 6,
    lore: 'A clip that puts two shells in at once. The hand still goes in, it just spends less time there reconsidering.',
  },
  shotgunChoke: {
    price: 400, wave: 1,
    lore: 'A tube that narrows the end of the pump\'s barrel, so the pellets arrive together and further away. The Council admires a group that stays on message.',
  },
  judgeHammer: {
    price: 500, wave: 2,
    lore: 'A longer hammer spur, quicker under the palm. The Judge now reaches its verdict in less time, which the Council has welcomed as reform.',
  },
  judgeGrip: {
    price: 900, wave: 4,
    lore: 'A fuller grip, so the hand stays on through all six chambers. Six verdicts in one sitting. Appeals will be heard by nobody.',
  },
  autorafficaAp: {
    price: 500, wave: 2,
    lore: 'Armour-piercing rounds for the Autoraffica. The gun already picks the head; these see that the helmet does not object.',
  },
  autorafficaMag: {
    price: 800, wave: 4,
    lore: 'Thirty rounds where there were twenty-one, for contractors whose smart aim finds more heads than they brought bullets. The extra length is load-bearing.',
  },
  autorafficaHp: {
    price: 500, wave: 0,
    lore: 'Hollow-points for the Autoraffica, three at a time, all in the same place. The Council calls this efficiency. The coroner calls it one hole.',
  },
  smgPlusP: { price: 350, wave: 0, lore: 'Twenty percent more damage from the SMG. The Council has raised the pressure without raising the salary.' },
  gimletPlusP: { price: 450, wave: 0, lore: 'Overpressure rounds for the Gimlet. A general increase in damage, filed under routine maintenance.' },
  harrowPlusP: { price: 550, wave: 0, lore: 'The Harrow, with twenty percent more round. Procurement has declined to call it a promotion.' },
  rivetPlusP: { price: 250, wave: 0, lore: 'More pressure in the Rivet. The same fifteen complaints, submitted with greater force.' },
  ultramagPlusP: { price: 650, wave: 0, lore: 'Overpressure for the Ultramag. The Council reviewed the existing damage and found room for growth.' },
  judgePlusP: { price: 550, wave: 0, lore: 'The same verdict, twenty percent harder. Sentencing guidelines have been updated accordingly.' },
  autorafficaPlusP: { price: 450, wave: 0, lore: 'More damage from every Autoraffica round. The automation budget has been redirected into pressure.' },
  awlPlusP: { price: 400, wave: 0, lore: 'Overpressure rounds for the Awl. Five rounds still. Procurement insists this counts as doing more with less.' },
};

/** The menu's heading and its small print. */
export const SHOP_COPY = {
  title: 'Procurement',
  form: 'Form 7742-P',
  terms: 'Purchases are final. So, statistically, is the purchaser.',
} as const;
