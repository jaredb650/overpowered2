/**
 * Display names, colours, and the copy behind the guide. Anything a tuning table already knows is read from that table,
 * so the guide cannot drift from the game.
 */
import { SONAR } from '../contracts/data';
import type { Action } from '../core/contracts';
import type { CallInId, EnemyId, PerkId, PowerupId, WeaponId } from '../core/gameplay';
import { MOVE } from '../player/tuning';
import {
  CACHE_ORDER, CALLINS as CALLIN_DEFS, CHAIN_REACTION_KILLS, COMBO_PERKS, DROP_POD, EFFECTS, MEGA, OVERDRIVE_MIN_SPEED, PICKUP, SCORE, STACK, STYLE_GATE, WINDOWS,
} from '../progression/data';
import { PENETRATION, SWORD, TUNING, WEAPONS as WEAPON_DEFS, WEAPON_ORDER as WEAPON_SEQUENCE } from '../weapons/data';

/** The game's own order: number keys, and inside a key the order it steps through its family. */
export const WEAPON_ORDER: readonly WeaponId[] = WEAPON_SEQUENCE;

export interface WeaponInfo {
  name: string;
  key: string;
  role: string;
  note: string;
}

const def = WEAPON_DEFS;

export const WEAPONS: Record<WeaponId, WeaponInfo> = {
  smg: {
    name: 'SMG', key: '1',
    role: `${def.smg.damage} damage, ${def.smg.magSize} rounds, ${Math.round(1 / def.smg.interval)} a second, dead accurate`,
    note: `Akimbo during Berserk: both guns fire.${def.smg.falloff ? ` Fades past ${def.smg.falloff.from} m.` : ''}`,
  },
  harrow: {
    name: 'Harrow', key: '1',
    role: `Battle rifle. ${def.harrow.damage} damage, ${def.harrow.magSize} rounds, ${Math.round(1 / def.harrow.interval)} a second`,
    note: 'Press 1 again to swap with the SMG. Full damage at any range. Goes through one body or a sheet of cover, and takes limbs off.',
  },
  shotgun: {
    name: 'Shotgun', key: '2',
    role: `${def.shotgun.pellets} pellets of ${def.shotgun.damage}, semi-auto`,
    note: `Inside ${TUNING.shotgun.pointBlank} m the pellets take limbs off.`,
  },
  rocket: {
    name: 'Rocket', key: '3',
    role: `${def.rocket.damage} damage, ${TUNING.rocket.radius} m blast, one in the tube`,
    note: 'Direct hits gib. Fire at your feet to rocket jump, for very little health.',
  },
  autocannon: {
    name: 'Autocannon', key: '4',
    role: `30 mm shell kills everything within ${TUNING.autocannon.radius} m, ${def.autocannon.magSize} a magazine`,
    note: `Right click scopes. Bosses take ${TUNING.autocannon.bossDamage} a shell.`,
  },
  sabot: {
    name: 'Sabot', key: '4',
    role: `The autocannon loaded with darts. ${def.sabot.damage} damage, no blast, through armour`,
    note: `Press 4 again to swap. Goes through walls up to ${PENETRATION.maxWall} m thick, ${def.sabot.penetration} m of them in all, and everyone in line: ping the sonar, then shoot what it shows.`,
  },
  sword: {
    name: 'Sword', key: '5',
    role: `Hold left click for a three-swing chain that lunges up to ${SWORD.lunge.range} m`,
    note: 'Hold right click to block bullets, release to sweep. Right click on swing 2 or 3 is the finisher blast.',
  },
  judge: {
    name: 'Judge', key: '6',
    role: `Revolver, ${def.judge.damage} damage, ${def.judge.magSize} shots`,
    note: `A headshot jumps to the next ${def.judge.headHops} heads.`,
  },
  rivet: {
    name: 'Rivet', key: '6',
    role: `Pistol. ${def.rivet.damage} damage, ${def.rivet.magSize} rounds, as fast as you can click`,
    note: `Press 6 again to swap with the Judge. Out in a blink, headshots count triple, weak past ${def.rivet.falloff!.from} m.`,
  },
  lance: {
    name: 'Lance', key: '7',
    role: 'Railgun. Hold to charge, release to fire',
    note: 'Pierces everything in line and severs what it touches.',
  },
  buzzsaw: {
    name: 'Buzzsaw', key: '8',
    role: `Minigun, spins up to ${Math.round(1 / def.buzzsaw.interval)} rounds a second`,
    note: 'Slows you while it fires. Shreds limbs one by one.',
  },
  kiln: {
    name: 'Kiln', key: '9',
    role: 'Flamethrower, short range',
    note: 'Burning enemies panic and spread fire.',
  },
  stakegun: {
    name: 'Stakegun', key: '0',
    role: `Rebar stakes, ${def.stakegun.damage} damage`,
    note: 'Pins bodies and limbs to walls.',
  },
};

export const GRENADE_NOTE = `${TUNING.grenade.start} frags, up to ${TUNING.grenade.max}. Ammo pickups restock them. Hold to cook. Shoot one out of the air to set it off.`;

export const WEAPONS_NOTE =
  `Some keys hold two weapons: press the key again to swap, and each has its own ammo. The second comes with the first. ` +
  `Five keys are loaded from the start. A weapon cache drops every ${DROP_POD.everyWaves === 2 ? 'second' : `${DROP_POD.everyWaves}th`} wave, marked on your HUD, ` +
  `with the next of ${CACHE_ORDER.map(id => WEAPONS[id].name).join(', ')}. A gun that runs dry hands over to the next one with ammo, and sword kills refill your last gun.`;

export interface CallInInfo {
  name: string;
  /** The input action that calls it, so the chip shows the player's own binding. */
  action: Action;
  combo: number;
  color: string;
  radius: number;
  note: string;
}

export const CALLIN_ORDER: readonly CallInId[] = ['airstrike', 'warthog', 'doorGunner', 'attackChopper', 'orbital', 'ac130', 'blackSun', 'nuke'];

const callIn = (id: CallInId, name: string, action: Action, note: string): CallInInfo => ({
  name, action, note, combo: CALLIN_DEFS[id].combo, color: CALLIN_DEFS[id].color, radius: CALLIN_DEFS[id].radius,
});

export const CALLINS: Record<CallInId, CallInInfo> = {
  airstrike: callIn('airstrike', 'Airstrike', 'streak', '15 rockets across the mark, then a finale.'),
  warthog: callIn('warthog', 'Warthog', 'callinWarthog', '50 shells along a line. Hold the click and drag to set its heading.'),
  doorGunner: callIn('doorGunner', 'Door Gunner', 'callinDoorGunner', 'No mark needed. You take the M134 in the door of a circling helicopter until the belt or the time runs out.'),
  attackChopper: callIn('attackChopper', 'Attack Chopper', 'callinChopper', 'No mark needed. You take the gunner seat, the pilot finds the fight, and you have a cannon and rockets until they run out.'),
  orbital: callIn('orbital', 'Orbital Lance', 'callinOrbital', 'A burning beam you steer for 6 seconds.'),
  ac130: callIn('ac130', 'AC-130', 'callinAc130', 'A gunship circles the mark for two minutes and shells it while you fight.'),
  blackSun: callIn('blackSun', 'Black Sun', 'callinBlackSun', 'Drags enemies and corpses in, then implodes.'),
  nuke: callIn('nuke', 'Tactical Nuke', 'callinNuke', 'Six seconds of siren, then it whites out the map.'),
};

export const CALLIN_NOTE = 'Your combo earns each one and is not spent. Press its key to aim, click to confirm, right click to cancel. The ring on the floor is the true blast.';

export interface PerkInfo {
  name: string;
  color: string;
  trigger: string;
  reward: string;
}

const perk = (id: PerkId, name: string, trigger: string, reward: string): PerkInfo =>
  ({ name, trigger, reward: `${EFFECTS[id].seconds} s. ${reward}`, color: EFFECTS[id].color });

const within = (w: { need: number; span: number }, what: string) => `${w.need} ${what} in ${w.span} s`;
const comboAt = (id: PerkId) => `Combo ${COMBO_PERKS.find(p => p.perk === id)!.at}`;

export const PERKS: Record<PerkId, PerkInfo> = {
  bloodthirst: perk('bloodthirst', 'Blood Thirst', within(WINDOWS.bloodthirst, 'kills'), `${STACK.damage.bloodthirst}x damage, bottomless mags, double pellets`),
  hellfire: perk('hellfire', 'Hellfire', within(WINDOWS.hellfire, 'kills'), 'Explosive rounds, huge instakill rockets'),
  berserk: perk('berserk', 'Berserk', comboAt('berserk'), `${STACK.damage.berserk}x damage, ${STACK.fireRate.berserk}x fire rate, ${STACK.speed.berserk}x speed, akimbo, no damage taken`),
  sentinels: perk('sentinels', 'Sentinels', comboAt('sentinels'), 'Three gun drones orbit you'),
  chainStorm: perk('chainStorm', 'Chain Storm', comboAt('chainStorm'), 'Every kill arcs lightning'),
  adrenaline: perk('adrenaline', 'Adrenaline', within(WINDOWS.adrenaline, 'sword kills'), `+${STACK.adrenalinePerStack * 100}% speed, stacks to 3`),
  slowmo: perk('slowmo', 'Slowmo', within(WINDOWS.slowmo, 'headshots'), 'The world at quarter speed, you at full speed'),
  butcher: perk('butcher', 'Butcher', `A limb off ${WINDOWS.butcher.need} different bodies in ${WINDOWS.butcher.span} s, direct hits only`, 'Every hit severs'),
  skyfall: perk('skyfall', 'Skyfall', `${within(WINDOWS.skyfall, 'kills')}, off the ground for ${STYLE_GATE.hangTime} s or more`, 'Unlimited air dashes, explosive slam'),
  chainReaction: perk('chainReaction', 'Chain Reaction', `${CHAIN_REACTION_KILLS} kills from one blast, not under Hellfire`, 'Enemies explode when they die'),
  overdrive: perk('overdrive', 'Overdrive', `${within(WINDOWS.overdrive, 'kills')} above ${OVERDRIVE_MIN_SPEED} m/s`, `Damage rises with speed, up to ${STACK.overdriveMaxDamage}x`),
  geneva: perk('geneva', 'Geneva Suggestion', 'The Outpost: kill someone who surrendered', `+${STACK.genevaDamagePerStack * 100}% damage and +${STACK.genevaFireRatePerStack * 100}% fire rate a stack, up to ${EFFECTS.geneva.maxStacks}`),
};

export const PERK_NOTE = `Butcher, Skyfall, Chain Reaction and Overdrive are style perks. One can start every ${STYLE_GATE.spacing} s at most, and each waits ${STYLE_GATE.rearm} s after it ends.`;

const power = (id: PowerupId, name: string, note: string) => ({ name, note, color: EFFECTS[id].color });

export const POWERUPS: Record<PowerupId, { name: string; color: string; note: string }> = {
  quad: power('quad', 'Quad', `${STACK.damage.quad}x damage`),
  haste: power('haste', 'Haste', `${STACK.speed.haste}x speed and fire rate`),
  vampire: power('vampire', 'Vampire', 'Kills heal you'),
  ricochet: power('ricochet', 'Ricochet', 'Bullets bounce'),
  shock: power('shock', 'Shock Rounds', 'Hits arc between enemies'),
  ghost: power('ghost', 'Ghost', 'Enemies lose you past 15 m'),
  magnet: power('magnet', 'Magnet', 'Pickups fly to you'),
  regen: power('regen', 'Regen', 'Fast health and ammo'),
  frostNova: power('frostNova', 'Frost Nova', 'One use. Freezes enemies, and frozen bodies shatter'),
  timeWarp: power('timeWarp', 'Time Warp', `One use. ${EFFECTS.timeWarp.seconds} s of slow-mo`),
};

export const POWERUP_NOTE = 'Capsules appear on a schedule, marked on your HUD, and last 15 s once taken.';

export const PICKUP_GUIDE: readonly { name: string; note: string }[] = [
  { name: 'Health', note: `+${PICKUP.health}. Kills drop these, and health also regenerates after ${MOVE.regenDelay} s without a hit` },
  { name: 'Armor', note: `+${PICKUP.armor}. Takes two thirds of every hit` },
  { name: 'Ammo', note: `${PICKUP.ammo * 100}% of every reserve and a grenade` },
  { name: 'Mega Health', note: `+${MEGA.heal}, past your maximum. Respawns on the map` },
  { name: 'Heavy Armor', note: `+${PICKUP.heavyArmor}. Respawns on the map` },
];

/** Combo rewards in ladder order, for the "next" line under the combo counter. */
export const LADDER: readonly { combo: number; name: string; color: string }[] = [
  { combo: 8, name: 'Airstrike', color: CALLINS.airstrike.color },
  { combo: 12, name: 'Warthog', color: CALLINS.warthog.color },
  { combo: 15, name: 'Berserk', color: PERKS.berserk.color },
  { combo: 18, name: 'Door Gunner', color: CALLINS.doorGunner.color },
  { combo: 20, name: 'Sentinels', color: PERKS.sentinels.color },
  { combo: 22, name: 'Attack Chopper', color: CALLINS.attackChopper.color },
  { combo: 25, name: 'Orbital Lance', color: CALLINS.orbital.color },
  { combo: 28, name: 'AC-130', color: CALLINS.ac130.color },
  { combo: 30, name: 'Chain Storm', color: PERKS.chainStorm.color },
  { combo: 40, name: 'Black Sun', color: CALLINS.blackSun.color },
  { combo: 50, name: 'Tactical Nuke', color: CALLINS.nuke.color },
];

export const ENEMY_NAMES: Record<EnemyId, string> = {
  husk: 'Husk', trooper: 'Trooper', gunner: 'Gunner', brute: 'Brute', stalker: 'Stalker', rocketeer: 'Rocketeer',
  sniper: 'Sniper', riot: 'Riot', leaper: 'Leaper', bomber: 'Bomber', burner: 'Burner', warden: 'Warden',
  skitter: 'Skitter', drone: 'Drone', juggernaut: 'Juggernaut', titan: 'Titan',
};

/**
 * In order of arrival. `wave` is the first wave each one appears in on the standard rules, from ROSTER in enemies/rules.ts.
 * The Guide documents the standard, ranked game; the Crucible rules screen shows a custom one.
 */
export const ENEMY_GUIDE: readonly { id: EnemyId; wave: number; role: string; tip: string }[] = [
  { id: 'husk', wave: 1, role: 'Melee swarm', tip: 'Slow. The danger is the crowd. Herd them into a line and blow them up.' },
  { id: 'trooper', wave: 1, role: 'Ranged', tip: 'Bursts inside 30 m and backs away under 13. Keep moving and it misses.' },
  { id: 'gunner', wave: 2, role: 'Close ranged', tip: 'Shotgun inside 13 m. Kill it on the way in.' },
  { id: 'bomber', wave: 3, role: 'Suicide', tip: 'Runs at you with a fuel tank. Shoot the tank and it takes the pack with it.' },
  { id: 'brute', wave: 4, role: 'Heavy', tip: 'Minigun and armour plates. Shoot the plates off. Running into one stops you dead.' },
  { id: 'juggernaut', wave: 5, role: 'Mini-boss', tip: 'Charges and slams. Armour comes off in stages. Dodge the charge.' },
  { id: 'stalker', wave: 6, role: 'Elite', tip: 'The one fast enemy. Dodges sideways when aimed at. Use blast or the sword.' },
  { id: 'rocketeer', wave: 7, role: 'Area denial', tip: 'Rockets from 56 m. Shoot the backpack.' },
  { id: 'skitter', wave: 8, role: 'Machine swarm', tip: 'Spider mine. Pop it at range.' },
  { id: 'leaper', wave: 9, role: 'Ambush', tip: 'Clings to walls and pounces. Look up.' },
  { id: 'titan', wave: 10, role: 'Boss', tip: 'Every 10 waves. Shoot off the arms to stop attacks, the legs to drop it.' },
  { id: 'riot', wave: 11, role: 'Frontal shield', tip: 'Flank it, or shoot off the shield arm.' },
  { id: 'sniper', wave: 12, role: 'Long range', tip: 'The laser shows the shot charging. Break the line.' },
  { id: 'drone', wave: 13, role: 'Flyer', tip: 'Hovering gun. It falls and crashes when shot.' },
  { id: 'burner', wave: 14, role: 'Zone', tip: 'Flamethrower inside 10 m. Its tank explodes.' },
  { id: 'warden', wave: 15, role: 'Support', tip: 'Shields and buffs its neighbours. Kill it first.' },
];

export const ENEMY_NOTE = 'Bumping a body costs nothing: every hit you take is a telegraphed attack. Maimed enemies keep coming, so finish them. With three left in a wave they all show on your HUD. ' +
  `The sonar ping shows every enemy through walls for ${SONAR.reveal} s, every ${SONAR.cooldown} s, or every ${SONAR.lastCooldown} s with ${SONAR.lastEnemies} or fewer left.`;

/** `action` shows the player's own key. `keys` is for anything that is not one key. */
export const MOVEMENT_GUIDE: readonly { action?: Action; keys?: string; name: string; body: string }[] = [
  { keys: 'WASD', name: 'Run', body: `No sprint key. You run at ${MOVE.runSpeed} m/s, planted and precise.` },
  { action: 'jump', name: 'Bunny hop', body: 'Time a jump to the landing and you keep your speed. Miss it and you stumble. Settings has a hold-to-hop option.' },
  { keys: 'W + A or D', name: 'Air strafe', body: 'In the air, strafe and turn the mouse the same way to gain speed, up to about 27 m/s.' },
  { action: 'jump', name: 'Double jump', body: 'Jump again in the air. Your speed swings toward the keys you hold.' },
  { action: 'dash', name: 'Dash', body: `${MOVE.dashCharges} charges, ${MOVE.dashRecharge} s each. A burst in the direction of your keys that also stops a fall. Jump out of it to keep more speed.` },
  { action: 'slide', name: 'Slide', body: 'Boosts on entry and runs faster downhill. Jump out and keep the speed.' },
  { action: 'slide', name: 'Ground slam', body: 'In the air: drop hard. The shockwave grows with the fall. Press jump on impact to bounce.' },
  { keys: 'Jump + W', name: 'Wall run', body: 'Jump at a long wall at an angle, hold W and steer into it. About a second, then jump off for a boost.' },
  { action: 'jump', name: 'Wall kick', body: 'Jump toward a wall while airborne. Once per wall.' },
  { keys: 'Jump + W', name: 'Mantle', body: 'Jump at a ledge while holding W and you climb it without losing speed.' },
];

/** Readable names for damage sources that are not a weapon or an enemy. */
const SOURCE_NAMES: Readonly<Record<string, string>> = {
  airstrike: 'Airstrike', warthog: 'Warthog', orbital: 'Orbital Lance', black_sun: 'Black Sun', nuke: 'Tactical Nuke',
  ac130_25mm: 'AC-130 25mm', ac130_40mm: 'AC-130 40mm', ac130_105mm: 'AC-130 105mm', ac130_hellfire: 'AC-130 Hellfire',
  sentinel: 'Sentinels', chain_storm: 'Chain Storm', chain_reaction: 'Chain Reaction', skyfall: 'Skyfall', slam: 'Ground slam',
  grenade: 'Frag', sword_finisher: 'Sword finisher', sword_deflect: 'Deflected shot', drop_pod: 'Drop pod',
  barrel: 'Barrel', tank: 'Tank', lava: 'Lava', crusher: 'Crusher', electric: 'Electric floor',
};

export function sourceName(source: string): string {
  return WEAPONS[source as WeaponId]?.name ?? ENEMY_NAMES[source as EnemyId] ?? SOURCE_NAMES[source] ?? source.replace(/_/g, ' ');
}

export const CONTROLS_NOTE =
  `Speed pays: your score multiplier steps up at ${SCORE.speedTiers.slice(1).map(t => t[0]).join(', ')} m/s, ` +
  `and ${WINDOWS.overdrive.need} kills in ${WINDOWS.overdrive.span} s above ${OVERDRIVE_MIN_SPEED} m/s set off Overdrive.`;

export const SLIDE_NOTE = 'Use C to slide. On Windows and Linux Ctrl+W closes the tab and no page can stop it, so Ctrl is risky while you hold W.';

/** Rebindable actions, in the groups the settings screen and the guide show them. */
export const KEY_GROUPS: readonly { title: string; rows: readonly [Action, string][] }[] = [
  {
    title: 'Move',
    rows: [
      ['forward', 'Forward'], ['back', 'Back'], ['left', 'Left'], ['right', 'Right'],
      ['jump', 'Jump'], ['dash', 'Dash'], ['slide', 'Slide and slam'],
    ],
  },
  {
    title: 'Fight',
    rows: [
      ['fire', 'Fire'], ['aim', 'Aim and alt fire'], ['reload', 'Reload'], ['melee', 'Quick melee'],
      ['grenade', 'Grenade'], ['sonar', 'Sonar ping'], ['weaponLast', 'Last weapon'], ['weaponNext', 'Next weapon'], ['weaponPrev', 'Previous weapon'],
    ],
  },
  {
    title: 'Call in',
    rows: [
      ['streak', 'Airstrike'], ['callinWarthog', 'Warthog'], ['callinDoorGunner', 'Door Gunner'], ['callinChopper', 'Attack Chopper'], ['callinOrbital', 'Orbital Lance'],
      ['callinAc130', 'AC-130'], ['callinBlackSun', 'Black Sun'], ['callinNuke', 'Tactical Nuke'], ['scoreboard', 'Run stats'],
    ],
  },
];

/** From docs/CREDITS.md. CC BY 3.0 asks for the author, the licence and word of the changes wherever the game goes. */
export const CREDITS: readonly { who: string; what: string; licence: string }[] = [
  { who: 'Mike Koenig', what: 'Gore, blood and body sounds, through SoundBible', licence: 'CC BY 3.0' },
  { who: 'Kenney', what: 'Impact Sounds: footsteps and impacts', licence: 'CC0 1.0' },
  { who: 'AngryFlash, Ploor, SoundMaster13, Vladimir', what: 'Further sounds, through SoundBible', licence: 'Public domain' },
];

export const CREDITS_NOTE = 'All of these sounds were changed: cut, pitched, layered, filtered and re-encoded. CC BY 3.0 is at creativecommons.org/licenses/by/3.0. Everything else is original to the game or synthesized at load.';
