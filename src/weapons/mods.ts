/**
 * Weapon mods (docs/proposals/weapons-update.md, section 10): bought and fitted at the Crucible's shop between waves, never
 * switched in a fight. Each one belongs to one gun and is a patch over that gun's row in WEAPONS: `Weapons.fitMod` swaps the
 * slot's row for the patched copy, so everything that fires reads it with no branch of its own. What a mod looks like on the
 * gun (a part, a sight, a muzzle) is the gun's ViewDef's `mods` entry (src/weapons/viewmodels).
 */
import type { AmmoLoad } from '../core/contracts';
import type { ModId, WeaponId } from '../core/gameplay';
import { ADS_ZOOM } from './adsZoom';
import { AMMO, WEAPONS, breakLoad, type WeaponDef } from './data';

export interface ModDef {
  id: ModId;
  /** The gun it fits. */
  weapon: WeaponId;
  name: string;
  /** What it changes in the gun's row. */
  patch: Partial<WeaponDef>;
  /** A gun takes one of each: an optic, and a kind of round. Fitting one takes off any other of its slot on the same gun. */
  slot?: 'sight' | 'ammo' | 'mag' | 'barrel' | 'choke' | 'hammer' | 'grip' | 'loader' | 'muzzle';
  /** What it changes worked out from the row as every fitted mod's `patch` left it: a mod that stacks with another on the same part. */
  adjust?: (def: WeaponDef) => Partial<WeaponDef>;
}

const smg = WEAPONS.smg;
/**
 * The Ultramag's compensator: 15% more shots a minute, and the muzzle climbs three quarters as far (the camera's kick, the rig's
 * recoil spring and the clip's own flip, viewmodels/models/ultramag.ts); the slide's travel is untouched.
 */
export const COMP = { rate: 1.15, flip: 0.75 } as const;
const hmg = WEAPONS.piledriver;
/** An ACOG's view: four times the hip view's magnification (90 to 28 degrees), twice the red dot's. See docs/notes/weapons.md. */
const ACOG = { zoom: 0.69, time: 0.24 } as const;
const DOT = { zoom: 0.4, time: 0.2 } as const;

/** The guns that take AP, HP and +P rounds: the SMG, the rifles and the four pistols. */
export const AMMO_GUNS: readonly WeaponId[] = ['smg', 'gimlet', 'harrow', 'rivet', 'ultramag', 'autoraffica', 'judge', 'awl', 'flail'];

/** AP and HP specialise in plates and flesh; +P multiplies damage and keeps ball penetration and plate rules. */
function rounds(gun: WeaponId, load: AmmoLoad): ModDef {
  const row = WEAPONS[gun];
  const ap = load === 'ap';
  return {
    id: `${gun}${ap ? 'Ap' : load === 'hp' ? 'Hp' : 'PlusP'}` as ModId, weapon: gun,
    name: load === 'plusP' ? '+P rounds' : `${load.toUpperCase()} rounds`, slot: 'ammo',
    patch: {
      load, tracer: load, damage: row.damage * AMMO[load].flesh,
      penetration: load === 'hp' ? 0 : row.penetration + (ap ? AMMO.ap.penetration : 0),
    },
  };
}

/**
 * The guns that take a weapon light: every rifle, shotgun and pistol, not the heavies or the Sabot. Always on while fitted (no key
 * for it), it is the rig's one spotlight (viewmodels/rig.ts `updateLight`) and changes nothing in the row.
 */
export const LIGHT_GUNS = ['smg', 'gimlet', 'harrow', 'awl', 'shotgun', 'thresher', 'deuce', 'judge', 'rivet', 'ultramag', 'autoraffica'] as const satisfies readonly WeaponId[];
export const lightOf = (gun: (typeof LIGHT_GUNS)[number]): ModId => `${gun}Light`;
const light = (gun: (typeof LIGHT_GUNS)[number]): ModDef => ({ id: lightOf(gun), weapon: gun, name: 'Weapon light', patch: {} });

/**
 * The guns that take akimbo: the SMG and the four pistols. A second one in the left hand (viewmodels/models/index.ts `leftOf`), the
 * two fired in turn on a left click (Weapons.ts): twice the rate, two magazines, twice the reload. With no sights to look down,
 * right click is a zoom on the crosshair (`AKIMBO_ADS`, the viewmodel stays at the hip), so it takes the optic's slot: the
 * Ultramag's reflex sight and akimbo exclude each other. It takes the Judge's fan away; the Autoraffica's smart aim goes dual, a lock a
 * gun (Weapons.ts `smartL`).
 * The magazine and the reload are worked out last (`adjust`), so an extended magazine or mag tape doubles with them.
 */
export const AKIMBO_GUNS = ['smg', 'rivet', 'ultramag', 'judge', 'autoraffica'] as const satisfies readonly WeaponId[];
export const akimboOf = (gun: (typeof AKIMBO_GUNS)[number]): ModId => `${gun}Akimbo`;
/** Akimbo's right click: the view narrows by this share, as irons do, and the guns stay where they are. */
export const AKIMBO_ADS = { zoom: 0.3, time: 0.15 } as const;
const akimbo = (gun: (typeof AKIMBO_GUNS)[number]): ModDef => ({
  id: akimboOf(gun), weapon: gun, name: 'Akimbo', slot: 'sight', patch: { akimbo: true, ads: AKIMBO_ADS },
  adjust: d => ({ magSize: d.magSize * 2, reloadTime: d.reloadTime * 2 }),
});

export const MODS: Readonly<Record<ModId, ModDef>> = {
  awlAcog: { id: 'awlAcog', weapon: 'awl', name: 'ACOG', slot: 'sight', patch: { scope: false, ads: ACOG } },
  awlAp: rounds('awl', 'ap'), awlHp: rounds('awl', 'hp'),
  awlCan: { id: 'awlCan', weapon: 'awl', name: 'Suppressor', patch: { muzzle: 'suppressed', sounds: [{ id: 'awl_suppressed_shot', pitchJitter: 0.02 }] } },
  // +100 rounds a minute (800 to 900) and a tenth more a round; its own quieter report and a small dim flash.
  suppressor: {
    id: 'suppressor', weapon: 'smg', name: 'Suppressor',
    patch: { interval: 60 / (60 / smg.interval + 100), damage: smg.damage * 1.1, muzzle: 'suppressed', sounds: [{ id: 'smg_suppressed_shot', pitchJitter: 0.03 }] },
  },
  // A sight, not a number: the optic on the dust cover and its dot in the ADS picture (viewmodels/models/harrow.ts).
  reddot: { id: 'reddot', weapon: 'harrow', name: 'Red dot sight', patch: {}, slot: 'sight' },
  // The ACOG (viewmodels/models/optics.ts), the Gimlet's own, for the Harrow: the view narrows to it.
  harrowAcog: { id: 'harrowAcog', weapon: 'harrow', name: 'ACOG', patch: { ads: ACOG }, slot: 'sight' },
  // Every dart is a Raufoss round (raufoss.ts), as the Piledriver's held R loads. The Sabot's right click stays its scope.
  raufoss: { id: 'raufoss', weapon: 'sabot', name: 'Raufoss rounds', patch: { raufoss: true } },
  // A T-shaped brake on the dart's barrel: less kick to wait out, so the next dart is a quarter sooner (0.45 to 0.36 s).
  sabotBrake: { id: 'sabotBrake', weapon: 'sabot', name: 'Muzzle brake', patch: { interval: WEAPONS.sabot.interval / 1.25 } },
  // Three heavy barrels where there were six: the Piledriver's round at the Trommel's rate. Spin-up, cone and slow are the
  // Trommel's; the round no longer bursts. The barrage is heard a step lower (`loopPitch`).
  trommel12: {
    id: 'trommel12', weapon: 'buzzsaw', name: '12 mm rechamber',
    patch: {
      damage: hmg.damage, severMult: hmg.severMult, force: hmg.force, headshotMult: hmg.headshotMult, penetration: hmg.penetration,
      bodyCost: hmg.bodyCost, gib: hmg.gib, killStop: hmg.killStop, impactScale: hmg.impactScale, burst: undefined, loopPitch: 0.8,
    },
  },
  // The Gimlet's. It is issued with the ACOG and the can on (`ISSUED`); the red dot swaps for the ACOG.
  gimletAcog: { id: 'gimletAcog', weapon: 'gimlet', name: 'ACOG', patch: { ads: ACOG }, slot: 'sight' },
  gimletDot: { id: 'gimletDot', weapon: 'gimlet', name: 'Red dot sight', patch: { ads: DOT }, slot: 'sight' },
  // Its own suppressed shot (the owner's) and the small dim flash. Nothing else changes.
  gimletCan: {
    id: 'gimletCan', weapon: 'gimlet', name: 'Suppressor',
    patch: { muzzle: 'suppressed', sounds: [{ id: 'gimlet_suppressed_shot', pitchJitter: 0.03 }] },
  },
  // The M203: hold R raises it (Weapons.select), and it fires LAUNCHER's grenade.
  gimletGl: { id: 'gimletGl', weapon: 'gimlet', name: 'Grenade launcher', patch: { launcher: true } },
  // A short barrel cut back to the launcher's mouth: the gas port nearer the muzzle cycles it 15% faster (800 to 920 a minute,
  // a short carbine's real gain). The can screws onto it and the launcher still fits, so it stacks with both.
  gimletShort: { id: 'gimletShort', weapon: 'gimlet', name: 'Short barrel', slot: 'barrel', patch: { interval: WEAPONS.gimlet.interval / 1.15 } },
  // Extended magazines: more rounds and nothing else. The Piledriver's is a box twice the size, 100 rounds of belt where it was 50;
  // the SMG's a 50-round stick where it was 30.
  smgMag: { id: 'smgMag', weapon: 'smg', name: 'Extended magazine', slot: 'mag', patch: { magSize: 50 } },
  // Cloth tape round the SMG's magazine with a pull tab: the hand finds it first time, and a reload is 30% quicker (1.0 to 0.7 s),
  // well inside the Gimlet's 1.02 s. Its own slot, so it stacks with the long magazine.
  smgTape: { id: 'smgTape', weapon: 'smg', name: 'Mag tape', slot: 'loader', patch: {}, adjust: d => ({ reloadTime: d.reloadTime * 0.7 }) },
  // A full stock with a cheek rest: the held-breath zoom (adsZoom.ts) holds 60% longer (3.5 to 5.6 s) and cools 30% sooner (2.5 to 1.75 s).
  // The katana's: a blade of light on an emitter hilt (melee/data.ts ENERGY). Melee.ts reads it off the fitted set; the row is the katana's.
  swordEnergy: { id: 'swordEnergy', weapon: 'sword', name: 'Energy blade', patch: {} },
  smgStock: { id: 'smgStock', weapon: 'smg', name: 'Stock', patch: { breath: { hold: ADS_ZOOM.hold * 1.6, cooldown: ADS_ZOOM.cooldown * 0.7 } } },
  rivetMag: { id: 'rivetMag', weapon: 'rivet', name: 'Extended magazine', slot: 'mag', patch: { magSize: 22 } },
  piledriverBox: { id: 'piledriverBox', weapon: 'piledriver', name: 'Extended box', slot: 'mag', patch: { magSize: 100 } },
  smgAp: rounds('smg', 'ap'), smgHp: rounds('smg', 'hp'),
  gimletAp: rounds('gimlet', 'ap'), gimletHp: rounds('gimlet', 'hp'),
  harrowAp: rounds('harrow', 'ap'), harrowHp: rounds('harrow', 'hp'),
  rivetAp: rounds('rivet', 'ap'), rivetHp: rounds('rivet', 'hp'),
  ultramagAp: rounds('ultramag', 'ap'), ultramagHp: rounds('ultramag', 'hp'),
  // The Ultramag's: a square can with its own quieter report; a reflex sight on the slide (the look is the sight); a laser module
  // that has it fire a quarter faster (0.36 s to 0.288 s between shots, inside the slide's 0.245 s cycle); 11 rounds, not 7.
  ultramagCan: { id: 'ultramagCan', weapon: 'ultramag', name: 'Suppressor', slot: 'muzzle', patch: { muzzle: 'suppressed', sounds: [{ id: 'ultramag_suppressed_shot', pitchJitter: 0.02 }] } },
  ultramagDot: { id: 'ultramagDot', weapon: 'ultramag', name: 'Reflex sight', patch: {}, slot: 'sight' },
  ultramagLam: { id: 'ultramagLam', weapon: 'ultramag', name: 'Laser module', patch: { interval: WEAPONS.ultramag.interval / 1.25 } },
  ultramagMag: { id: 'ultramagMag', weapon: 'ultramag', name: 'Extended magazine', patch: { magSize: 11, reloadTime: 1.4 } },
  // A race-gun compensator in the can's place (the muzzle slot): its ports throw the gas up, so it fires faster with less flip
  // (`COMP`). Worked out last, so it stacks with the laser's quarter: 0.36 s to 0.313, both 0.25, past the slide's 0.245 s cycle.
  ultramagComp: {
    id: 'ultramagComp', weapon: 'ultramag', name: 'Compensator', slot: 'muzzle', patch: {},
    adjust: d => ({ interval: d.interval / COMP.rate, kick: d.kick * COMP.flip }),
  },
  judgeAp: rounds('judge', 'ap'), judgeHp: rounds('judge', 'hp'),
  autorafficaAp: rounds('autoraffica', 'ap'), autorafficaHp: rounds('autoraffica', 'hp'),
  // A longer magazine out of the grip: 30 where it was 21, and a beat longer to change.
  autorafficaMag: { id: 'autorafficaMag', weapon: 'autoraffica', name: 'Extended magazine', patch: { magSize: 30, reloadTime: 1.25 } },
  smgPlusP: rounds('smg', 'plusP'), gimletPlusP: rounds('gimlet', 'plusP'), harrowPlusP: rounds('harrow', 'plusP'),
  rivetPlusP: rounds('rivet', 'plusP'), ultramagPlusP: rounds('ultramag', 'plusP'), judgePlusP: rounds('judge', 'plusP'),
  autorafficaPlusP: rounds('autoraffica', 'plusP'), awlPlusP: rounds('awl', 'plusP'),
  // The Deuce's: two more barrels over the first two, so four shells, a barrel a left click and every loaded one on a right
  // click; each barrel past the first adds `kick` - 1 to the recoil and `push` to the shove. Loaded a shell at a time, 1.98 s.
  deuceQuad: {
    id: 'deuceQuad', weapon: 'deuce', name: 'Quad barrels', slot: 'barrel',
    patch: { magSize: 4, ...breakLoad(4), altBoth: { ...WEAPONS.deuce.altBoth!, kick: 1.4, push: 3.5 } },
  },
  // Two shells a hand: the double loads in one go (1.26 s), the quad in two (1.5 s, the plain double's time).
  deuceLoader: { id: 'deuceLoader', weapon: 'deuce', name: 'Speed loader', slot: 'loader', patch: {}, adjust: d => breakLoad(d.magSize / 2) },
  // The pump's: a tighter cone, 0.05 to 0.03, so the pellets stay together further out.
  shotgunChoke: { id: 'shotgunChoke', weapon: 'shotgun', name: 'Choke', slot: 'choke', patch: { spread: 0.03 } },
  // The Judge's fanning: a bar every 0.28 s where it was 0.4, and up to six bars, a chamber each, where it was three.
  judgeHammer: { id: 'judgeHammer', weapon: 'judge', name: 'Extended hammer', slot: 'hammer', patch: {}, adjust: d => ({ altFan: { ...d.altFan!, perBar: 0.28 } }) },
  judgeGrip: { id: 'judgeGrip', weapon: 'judge', name: 'Comfort grip', slot: 'grip', patch: {}, adjust: d => ({ altFan: { ...d.altFan!, bars: 6 } }) },
  smgLight: light('smg'), gimletLight: light('gimlet'), harrowLight: light('harrow'), awlLight: light('awl'),
  shotgunLight: light('shotgun'), thresherLight: light('thresher'), deuceLight: light('deuce'),
  judgeLight: light('judge'), rivetLight: light('rivet'), ultramagLight: light('ultramag'), autorafficaLight: light('autoraffica'),
  // The Flail's: a red dot or an ACOG on the feed cover's rail, one or the other; a box of 200 where it was 100, a beat longer to
  // swap; and the rifles' three kinds of round.
  flailDot: { id: 'flailDot', weapon: 'flail', name: 'Red dot sight', slot: 'sight', patch: { ads: DOT } },
  flailAcog: { id: 'flailAcog', weapon: 'flail', name: 'ACOG', slot: 'sight', patch: { ads: ACOG } },
  flailBox: { id: 'flailBox', weapon: 'flail', name: 'Large box', slot: 'mag', patch: { magSize: 200, reloadTime: 3.1 } },
  flailAp: rounds('flail', 'ap'), flailHp: rounds('flail', 'hp'), flailPlusP: rounds('flail', 'plusP'),
  smgAkimbo: akimbo('smg'), rivetAkimbo: akimbo('rivet'), ultramagAkimbo: akimbo('ultramag'), judgeAkimbo: akimbo('judge'),
  autorafficaAkimbo: akimbo('autoraffica'),
};

export const MOD_ORDER: readonly ModId[] = [
  'awlAcog', 'awlCan', 'awlAp', 'awlHp', 'awlPlusP',
  'suppressor', 'smgAp', 'smgHp', 'smgPlusP', 'gimletAcog', 'gimletDot', 'gimletCan', 'gimletGl', 'gimletAp', 'gimletHp', 'gimletPlusP',
  'reddot', 'harrowAcog', 'harrowAp', 'harrowHp', 'harrowPlusP', 'raufoss', 'rivetAp', 'rivetHp', 'rivetPlusP', 'ultramagAp', 'ultramagHp', 'ultramagPlusP', 'judgeAp', 'judgeHp', 'judgePlusP',
  'autorafficaAp', 'autorafficaHp', 'autorafficaPlusP', 'autorafficaMag',
  'sabotBrake', 'trommel12',
  'ultramagCan', 'ultramagDot', 'ultramagLam', 'ultramagMag', 'ultramagComp',
  'smgMag', 'smgTape', 'smgStock', 'swordEnergy', 'gimletShort', 'rivetMag', 'piledriverBox',
  'deuceQuad', 'deuceLoader', 'shotgunChoke', 'judgeHammer', 'judgeGrip',
  'flailDot', 'flailAcog', 'flailBox', 'flailAp', 'flailHp', 'flailPlusP',
  ...LIGHT_GUNS.map(lightOf),
  ...AKIMBO_GUNS.map(akimboOf),
];

/** Held and fitted at the start of every run: the Gimlet's ACOG and suppressor, the SMG's light. The shop takes them off and puts them back. */
export const ISSUED: readonly ModId[] = ['gimletAcog', 'gimletCan', 'smgLight'];

/** `id`'s row with every fitted mod of its own patched over it, or the row itself when none is. */
export function moddedDef(id: WeaponId, fitted: ReadonlySet<ModId>): WeaponDef {
  let def = WEAPONS[id];
  for (const m of MOD_ORDER) if (fitted.has(m) && MODS[m].weapon === id) {
    const patch = MODS[m].patch;
    // +P multiplies the fitted gun's damage, including the SMG suppressor's boost in its separate slot.
    const damage = patch.load === 'plusP' ? def.damage * AMMO.plusP.flesh : patch.damage ?? def.damage;
    def = { ...def, ...patch, damage };
  }
  for (const m of MOD_ORDER) if (fitted.has(m) && MODS[m].weapon === id && MODS[m].adjust) def = { ...def, ...MODS[m].adjust!(def) };
  return def;
}
