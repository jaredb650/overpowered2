/**
 * Weapon mods (docs/proposals/weapons-update.md, section 10): bought and fitted at the Crucible's shop between waves, never
 * switched in a fight. Each one belongs to one gun and is a patch over that gun's row in WEAPONS: `Weapons.fitMod` swaps the
 * slot's row for the patched copy, so everything that fires reads it with no branch of its own. What a mod looks like on the
 * gun (a part, a sight, a muzzle) is the gun's ViewDef's `mods` entry (src/weapons/viewmodels).
 */
import type { AmmoLoad } from '../core/contracts';
import type { ModId, WeaponId } from '../core/gameplay';
import { ADS_ZOOM } from './adsZoom';
import { AMMO, TUNING, WEAPONS, breakLoad, type WeaponDef } from './data';

export interface ModDef {
  id: ModId;
  /** The gun it fits. */
  weapon: WeaponId;
  name: string;
  /** What it changes in the gun's row. */
  patch: Partial<WeaponDef>;
  /** A gun takes one of each: an optic, and a kind of round. Fitting one takes off any other of its slot on the same gun. */
  slot?: 'sight' | 'ammo' | 'mag' | 'barrel' | 'length' | 'trigger' | 'choke' | 'hammer' | 'grip' | 'loader' | 'muzzle';
  /** What it changes worked out from the row as every fitted mod's `patch` left it: a mod that stacks with another on the same part. */
  adjust?: (def: WeaponDef) => Partial<WeaponDef>;
}

const smg = WEAPONS.smg;
/**
 * The Ultramag's compensator: 15% more shots a minute, and its ports throw the gas up and the muzzle down, so it climbs under half
 * as far (the camera's kick, the rig's recoil spring and the clip's own flip, viewmodels/models/ultramag.ts). The slide's travel
 * is untouched.
 */
export const COMP = { rate: 1.15, flip: 0.45 } as const;
const hmg = WEAPONS.piledriver;
const awl = WEAPONS.awl;
/**
 * The Awl's extended barrel: more of the powder burns in the bore, so the round leaves faster. `penetration` m more budget (one
 * more body), plates met as a heavy round (half of it gets past instead of none), and a longer, brighter vapor wake ('scoutLong').
 * With AP it goes through plates as the Sabot's dart does: the piece it passes is torn off and the round lands in full.
 */
export const AWL_BARREL = { penetration: 0.4 } as const;
/** The Awl's greased bolt: the whole cycle, every cue and the model's bolt with it, at this share: 0.65 s to 0.49 (92 to 123 a minute). */
export const GREASE = 0.75;
/** An ACOG's view: four times the hip view's magnification (90 to 28 degrees), twice the red dot's. See docs/notes/weapons.md. */
const ACOG = { zoom: 0.69, time: 0.24 } as const;
const DOT = { zoom: 0.4, time: 0.2 } as const;

/** The guns that take AP, HP and +P rounds: the SMG, the rifles and the four pistols. */
export const AMMO_GUNS: readonly WeaponId[] = ['smg', 'gimlet', 'harrow', 'rivet', 'ultramag', 'autoraffica', 'judge', 'awl', 'flail'];

/** AP and HP specialise in plates and flesh; +P multiplies damage and keeps ball penetration and plate rules. */
function rounds(gun: WeaponId, load: Exclude<AmmoLoad, 'flechette' | 'api' | 'dragon'>): ModDef {
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
export const LIGHT_GUNS = [
  'smg', 'gimlet', 'harrow', 'bodkin', 'awl', 'shotgun', 'thresher', 'deuce', 'billhook', 'judge', 'rivet', 'ultramag', 'autoraffica',
] as const satisfies readonly WeaponId[];
export const lightOf = (gun: (typeof LIGHT_GUNS)[number]): ModId => `${gun}Light`;
const light = (gun: (typeof LIGHT_GUNS)[number]): ModDef => ({ id: lightOf(gun), weapon: gun, name: 'Weapon light', patch: {} });

/**
 * The guns that take a tactical rail laser sight: every rifle and shotgun. Projects a crosshair-aligned red beam and dot
 * (viewmodels/lam.ts) and, where the gun aims down sights, brings it to the eye 30% faster (matching `billhookLam`).
 */
export const LAM_GUNS = [
  'gimlet', 'harrow', 'bodkin', 'flail', 'awl', 'sabot', 'shotgun', 'thresher', 'deuce', 'billhook',
] as const satisfies readonly WeaponId[];
export const lamOf = (gun: (typeof LAM_GUNS)[number]): ModId => `${gun}Lam`;
const laserSight = (gun: (typeof LAM_GUNS)[number]): ModDef => ({
  id: lamOf(gun), weapon: gun, name: 'Laser sight', patch: {},
  adjust: d => (d.ads ? { ads: { ...d.ads, time: d.ads.time * 0.7 } } : {}),
});

/** The guns that take flechettes: every one that fires pellets. The Judge fires one slug, so it does not. */
export const FLECHETTE_GUNS = ['shotgun', 'thresher', 'deuce', 'billhook'] as const satisfies readonly WeaponId[];
export const flechetteOf = (gun: (typeof FLECHETTE_GUNS)[number]): ModId => `${gun}Flechette`;
/**
 * Flechettes, the shotguns' AP (AMMO.flechette): 3.5 times the pellets, each a quarter of one, in the gun's own cone, with a
 * needle of a tracer each, smaller marks on the wall, and a hiss over the report. The plate and bleed rules are enemies/damage.ts.
 */
function flechette(gun: (typeof FLECHETTE_GUNS)[number]): ModDef {
  const row = WEAPONS[gun];
  return {
    id: flechetteOf(gun), weapon: gun, name: 'Flechettes', slot: 'ammo',
    patch: {
      load: 'flechette', tracer: 'flechette', pellets: Math.round(row.pellets * AMMO.flechette.pellets),
      damage: row.damage * AMMO.flechette.flesh, impactScale: 0.4,
      sounds: [...row.sounds, { id: 'bullet_flyby', volume: 0.55, pitch: 1.45, pitchJitter: 0.08 }],
    },
  };
}

/** The guns that take Dragon's breath: the Thresher and the Billhook (Q9 default). */
export const DRAGON_GUNS = ['thresher', 'billhook'] as const satisfies readonly WeaponId[];
export const dragonOf = (gun: (typeof DRAGON_GUNS)[number]): ModId => `${gun}Dragon`;
function dragon(gun: (typeof DRAGON_GUNS)[number]): ModDef {
  return {
    id: dragonOf(gun), weapon: gun, name: "Dragon's breath", slot: 'ammo',
    patch: { load: 'dragon', tracer: 'dragon' },
  };
}

/** The guns that take API rounds: the Harrow and the Flail. Another gun takes them by joining this list (and ModId). */
export const API_GUNS = ['harrow', 'flail'] as const satisfies readonly WeaponId[];
export const apiOf = (gun: (typeof API_GUNS)[number]): ModId => `${gun}Api`;
/** API, armour-piercing incendiary: the gun's AP round (`rounds`), traced red, that sometimes sets the man alight (AMMO.api). */
function incendiary(gun: (typeof API_GUNS)[number]): ModDef {
  const ap = rounds(gun, 'ap');
  return { ...ap, id: apiOf(gun), name: 'API rounds', patch: { ...ap.patch, load: 'api', tracer: 'api' } };
}

/**
 * Flared magwell: 15% faster reload (`adjust` runs last, so it stacks with extended magazines and with akimbo's doubled reload).
 * Another gun joins by adding its id here (and ModId).
 */
export const MAGWELL_GUNS = ['harrow', 'gimlet', 'ultramag', 'rivet', 'bodkin'] as const satisfies readonly WeaponId[];
export const magwellOf = (gun: (typeof MAGWELL_GUNS)[number]): ModId => `${gun}Magwell`;
export const MAGWELL_SCALE = 0.85;
const magwell = (gun: (typeof MAGWELL_GUNS)[number]): ModDef => ({
  id: magwellOf(gun), weapon: gun, name: 'Flared magwell', slot: 'loader', patch: {},
  adjust: d => ({ reloadTime: d.reloadTime * MAGWELL_SCALE }),
});

/**
 * The guns that take akimbo: the SMG and the four pistols. A second one in the left hand (viewmodels/models/index.ts `leftOf`), the
 * two fired in turn on a left click (Weapons.ts): twice the rate, two magazines, twice the reload. With no sights to look down,
 * right click is a zoom on the crosshair (`AKIMBO_ADS`, the viewmodel stays at the hip), so it takes the optic's slot. The
 * Ultramag's reflex sight has no slot and stays on, on both guns, for the look: nothing aims through it. It takes the Judge's fan away; the Autoraffica's smart aim goes dual, a lock a
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

/**
 * Riot shield: fits any of the four pistols in the `sight` slot (excludes akimbo). Carried on the off-arm;
 * replaces ADS (and the Judge's fan) with raising the shield on right click.
 */
export const SHIELD_GUNS = ['rivet', 'ultramag', 'judge', 'autoraffica'] as const satisfies readonly WeaponId[];
export const shieldOf = (gun: (typeof SHIELD_GUNS)[number]): ModId => `${gun}Shield`;
const shield = (gun: (typeof SHIELD_GUNS)[number]): ModDef => ({
  id: shieldOf(gun), weapon: gun, name: 'Riot shield', slot: 'sight',
  patch: { shield: true, ads: undefined, altFan: undefined },
});

export const MODS: Readonly<Record<ModId, ModDef>> = {
  awlAcog: { id: 'awlAcog', weapon: 'awl', name: 'ACOG', slot: 'sight', patch: { scope: false, ads: ACOG } },
  awlAp: rounds('awl', 'ap'), awlHp: rounds('awl', 'hp'),
  awlCan: { id: 'awlCan', weapon: 'awl', name: 'Suppressor', patch: { muzzle: 'suppressed', sounds: [{ id: 'awl_suppressed_shot', pitchJitter: 0.02 }] } },
  // After the rounds in MOD_ORDER, so its wake shows over AP's streak and its budget adds to theirs (HP still stops in the first
  // body). The can goes on over its brake, so the two stack.
  awlBarrel: {
    id: 'awlBarrel', weapon: 'awl', name: 'Extended barrel', slot: 'barrel', patch: { armour: 'heavy', tracer: 'scoutLong' },
    adjust: d => ({
      penetration: d.penetration > 0 ? d.penetration + AWL_BARREL.penetration : 0,
      ...(d.load === 'ap' ? { armorPiercing: true } : {}),
    }),
  },
  awlBolt: {
    id: 'awlBolt', weapon: 'awl', name: 'Greased bolt',
    patch: {
      interval: awl.interval * GREASE, cycleTime: awl.cycleTime! * GREASE,
      cycleFoley: awl.cycleFoley!.map(([at, id]) => [at * GREASE, id] as const),
    },
  },
  // +100 rounds a minute (800 to 900) and a tenth more a round; its own quieter report and a small dim flash.
  suppressor: {
    id: 'suppressor', weapon: 'smg', name: 'Suppressor',
    patch: { interval: 60 / (60 / smg.interval + 100), damage: smg.damage * 1.1, muzzle: 'suppressed', sounds: [{ id: 'smg_suppressed_shot', pitchJitter: 0.03 }] },
  },
  // A sight, not a number: the optic on the dust cover and its dot in the ADS picture (viewmodels/models/harrow.ts).
  reddot: { id: 'reddot', weapon: 'harrow', name: 'Red dot sight', patch: {}, slot: 'sight' },
  // The ACOG (viewmodels/models/optics.ts), the Gimlet's own, for the Harrow: the view narrows to it.
  harrowAcog: { id: 'harrowAcog', weapon: 'harrow', name: 'ACOG', patch: { ads: ACOG }, slot: 'sight' },
  // Harrow wishlist: short barrel (+15% rate, 600→690 rpm), muzzle brake (+5%, stacks to ~725 rpm), 40-round magazine.
  harrowShort: { id: 'harrowShort', weapon: 'harrow', name: 'Short barrel', slot: 'barrel', patch: { interval: WEAPONS.harrow.interval / 1.15 } },
  harrowBrake: { id: 'harrowBrake', weapon: 'harrow', name: 'Muzzle brake', slot: 'muzzle', patch: {}, adjust: d => ({ interval: d.interval / 1.05 }) },
  harrowMag: { id: 'harrowMag', weapon: 'harrow', name: 'Extended magazine', slot: 'mag', patch: { magSize: 40 } },
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
  // Every shell a proximity-fused air burst that throws a cone of shrapnel down its line (flak.ts), in place of the 5 m instakill.
  // The autocannon's one round, so no slot, as the Sabot's Raufoss.
  autocannonFlak: { id: 'autocannonFlak', weapon: 'autocannon', name: 'Flak shells', patch: { flak: true } },
  // Autocannon longer barrel: 200→280 m/s shell velocity, and 900→1150 direct damage on bosses, vehicles and the mech.
  autocannonBarrel: {
    id: 'autocannonBarrel', weapon: 'autocannon', name: 'Longer barrel', slot: 'barrel',
    patch: { shell: { speed: 280, bossDamage: 1150 } },
  },
  // Optics on a short rail behind the Piledriver's feed cover; the ladder folds. The view narrows as the other guns' do.
  piledriverDot: { id: 'piledriverDot', weapon: 'piledriver', name: 'Red dot sight', slot: 'sight', patch: { ads: DOT } },
  piledriverAcog: { id: 'piledriverAcog', weapon: 'piledriver', name: 'ACOG', slot: 'sight', patch: { ads: ACOG } },
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
  // Gimlet long barrel: 800→760 rpm, 40→48 damage (scales ammo mods), +0.4 m penetration, full damage to 90 m, breaks plates;
  // with AP rounds fitted, ignores armour plates entirely like the Awl's extended barrel.
  gimletLong: {
    id: 'gimletLong', weapon: 'gimlet', name: 'Long barrel', slot: 'barrel',
    patch: { interval: 60 / 760, armour: 'medium', falloff: { from: 90, to: 140, floor: 0.75 }, tracer: 'scoutLong' },
    adjust: d => ({
      damage: d.damage * (48 / WEAPONS.gimlet.damage),
      penetration: d.load === 'hp' ? 0 : d.penetration + AWL_BARREL.penetration,
      ...(d.load === 'ap' ? { armorPiercing: true } : {}),
    }),
  },
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
  // Rivet's new mods (mirroring the Ultramag's): suppressor, compensator, reflex sight, laser module.
  rivetCan: {
    id: 'rivetCan', weapon: 'rivet', name: 'Suppressor', slot: 'muzzle',
    patch: { muzzle: 'suppressed', sounds: [{ id: 'rivet_suppressed_shot', pitchJitter: 0.04 }] },
  },
  rivetDot: { id: 'rivetDot', weapon: 'rivet', name: 'Reflex sight', patch: {} },
  rivetLam: { id: 'rivetLam', weapon: 'rivet', name: 'Laser module', patch: { interval: WEAPONS.rivet.interval / 1.25 } },
  rivetComp: {
    id: 'rivetComp', weapon: 'rivet', name: 'Compensator', slot: 'muzzle', patch: {},
    adjust: d => ({ interval: d.interval / COMP.rate, kick: d.kick * COMP.flip }),
  },
  piledriverBox: { id: 'piledriverBox', weapon: 'piledriver', name: 'Extended box', slot: 'mag', patch: { magSize: 100 } },
  smgAp: rounds('smg', 'ap'), smgHp: rounds('smg', 'hp'),
  gimletAp: rounds('gimlet', 'ap'), gimletHp: rounds('gimlet', 'hp'),
  harrowAp: rounds('harrow', 'ap'), harrowHp: rounds('harrow', 'hp'),
  rivetAp: rounds('rivet', 'ap'), rivetHp: rounds('rivet', 'hp'),
  ultramagAp: rounds('ultramag', 'ap'), ultramagHp: rounds('ultramag', 'hp'),
  // The Ultramag's: a square can with its own quieter report; a reflex sight on the slide (the look is the sight); a laser module
  // that has it fire a quarter faster (0.36 s to 0.288 s between shots, inside the slide's 0.245 s cycle); 11 rounds, not 7.
  ultramagCan: { id: 'ultramagCan', weapon: 'ultramag', name: 'Suppressor', slot: 'muzzle', patch: { muzzle: 'suppressed', sounds: [{ id: 'ultramag_suppressed_shot', pitchJitter: 0.02 }] } },
  // No slot: it changes nothing in the row, so it stays on with akimbo, on both slides, for the look alone.
  ultramagDot: { id: 'ultramagDot', weapon: 'ultramag', name: 'Reflex sight', patch: {} },
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
  smgPlusP: rounds('smg', 'plusP'), gimletPlusP: rounds('gimlet', 'plusP'), harrowPlusP: rounds('harrow', 'plusP'),
  rivetPlusP: rounds('rivet', 'plusP'), ultramagPlusP: rounds('ultramag', 'plusP'), judgePlusP: rounds('judge', 'plusP'),
  autorafficaPlusP: rounds('autoraffica', 'plusP'), awlPlusP: rounds('awl', 'plusP'),
  // A longer magazine out of the grip: 30 where it was 21, and a beat longer to change.
  autorafficaMag: { id: 'autorafficaMag', weapon: 'autoraffica', name: 'Extended magazine', patch: { magSize: 30, reloadTime: 1.25 } },
  // The Deuce's: two more barrels over the first two, so four shells, a barrel a left click and every loaded one on a right
  // click; each barrel past the first adds `kick` - 1 to the recoil and `push` to the shove. Loaded a shell at a time, 1.98 s.
  deuceQuad: {
    id: 'deuceQuad', weapon: 'deuce', name: 'Quad barrels', slot: 'barrel',
    patch: { magSize: 4, ...breakLoad(4), altBoth: { ...WEAPONS.deuce.altBoth!, kick: 1.4, push: 3.5 } },
  },
  // Deuce long barrel: stacks with Quad barrels (`length` slot); tightens spread 0.075→0.05 and holds damage out to 14 m.
  deuceLong: {
    id: 'deuceLong', weapon: 'deuce', name: 'Long barrel', slot: 'length',
    patch: { spread: 0.05, falloff: { from: 14, to: 30, floor: 0.3 } },
  },
  // Two shells a hand: the double loads in one go (1.26 s), the quad in two (1.5 s, the plain double's time).
  deuceLoader: { id: 'deuceLoader', weapon: 'deuce', name: 'Speed loader', slot: 'loader', patch: {}, adjust: d => breakLoad(d.magSize / 2) },
  // The pump's: a tighter cone, 0.05 to 0.03, so the pellets stay together further out. Excludes Sawed-off (`barrel` slot).
  shotgunChoke: { id: 'shotgunChoke', weapon: 'shotgun', name: 'Choke', slot: 'barrel', patch: { spread: 0.03 } },
  // Sawed-off barrel: 4 shells, wide 0.085 spread, 34 damage a pellet, Deuce's short reach. Excludes Choke.
  shotgunSawedOff: {
    id: 'shotgunSawedOff', weapon: 'shotgun', name: 'Sawed-off barrel', slot: 'barrel',
    patch: { magSize: 4, spread: 0.085, falloff: { from: 9, to: 26, floor: 0.3 } },
    adjust: d => ({ damage: d.damage * (34 / WEAPONS.shotgun.damage) }),
  },
  // Pump greased bolt: 75% cycle time (0.55 → 0.4125 s), matching Awl's GREASE.
  shotgunBolt: {
    id: 'shotgunBolt', weapon: 'shotgun', name: 'Greased bolt',
    patch: {
      interval: WEAPONS.shotgun.interval * GREASE,
      cycleFoley: WEAPONS.shotgun.cycleFoley!.map(([at, id]) => [at * GREASE, id] as const),
    },
  },
  // The Judge's fanning: a bar every 0.28 s where it was 0.4, and up to six bars, a chamber each, where it was three.
  judgeHammer: {
    id: 'judgeHammer', weapon: 'judge', name: 'Extended hammer', slot: 'hammer', patch: {},
    adjust: d => (d.altFan ? { altFan: { ...d.altFan, perBar: 0.28 } } : {}),
  },
  judgeGrip: {
    id: 'judgeGrip', weapon: 'judge', name: 'Comfort grip', slot: 'grip', patch: {},
    adjust: d => (d.altFan ? { altFan: { ...d.altFan, bars: 6 } } : {}),
  },
  // Judge extended barrel (120→150 damage) and compensator (fan charge 20% faster, stacks with hammer; 30% less kick).
  judgeLong: {
    id: 'judgeLong', weapon: 'judge', name: 'Extended barrel', slot: 'barrel', patch: {},
    adjust: d => ({ damage: d.damage * (150 / WEAPONS.judge.damage) }),
  },
  judgeComp: {
    id: 'judgeComp', weapon: 'judge', name: 'Compensator', slot: 'muzzle', patch: {},
    adjust: d => ({ kick: d.kick * 0.7, ...(d.altFan ? { altFan: { ...d.altFan, perBar: d.altFan.perBar * 0.8 } } : {}) }),
  },
  // Launchers wishlist: Rocket longer tube & WP rockets; MGL long barrel & enhanced trigger; Howitzer cluster shell.
  rocketTube: {
    id: 'rocketTube', weapon: 'rocket', name: 'Longer tube', slot: 'barrel',
    patch: { damage: 130, rocket: { speed: 56, laserTurn: TUNING.rocket.laserTurn * (56 / TUNING.rocket.speed) } },
  },
  rocketWp: {
    id: 'rocketWp', weapon: 'rocket', name: 'WP rockets',
    patch: { wp: true, altAmmo: { label: 'WP', hold: 0.3 } },
  },
  mglLong: {
    id: 'mglLong', weapon: 'mgl', name: 'Long barrel', slot: 'barrel',
    patch: { damage: 105, grenade: { ...WEAPONS.mgl.grenade!, speed: 70 } },
  },
  mglTrigger: {
    id: 'mglTrigger', weapon: 'mgl', name: 'Enhanced trigger', slot: 'trigger',
    patch: { interval: 0.27 },
  },
  howitzerCluster: {
    id: 'howitzerCluster', weapon: 'howitzer', name: 'Cluster shell',
    patch: { cluster: true, altAmmo: { label: 'CLUSTER', hold: 0.3 } },
  },
  smgLight: light('smg'), gimletLight: light('gimlet'), harrowLight: light('harrow'), bodkinLight: light('bodkin'), awlLight: light('awl'),
  shotgunLight: light('shotgun'), thresherLight: light('thresher'), deuceLight: light('deuce'), billhookLight: light('billhook'),
  judgeLight: light('judge'), rivetLight: light('rivet'), ultramagLight: light('ultramag'), autorafficaLight: light('autoraffica'),
  // The Flail's: a red dot or an ACOG on the feed cover's rail, one or the other; a box of 200 where it was 100, a beat longer to
  // swap; heavy M60/MG42-inspired barrel (880 rpm, 44 dmg, Harrow penetration/armour); enhanced stock; and the rifles' rounds.
  flailDot: { id: 'flailDot', weapon: 'flail', name: 'Red dot sight', slot: 'sight', patch: { ads: DOT } },
  flailAcog: { id: 'flailAcog', weapon: 'flail', name: 'ACOG', slot: 'sight', patch: { ads: ACOG } },
  flailBox: { id: 'flailBox', weapon: 'flail', name: 'Large box', slot: 'mag', patch: { magSize: 200, reloadTime: 3.1 } },
  flailHeavy: {
    id: 'flailHeavy', weapon: 'flail', name: 'Heavy barrel', slot: 'barrel',
    patch: { interval: 60 / 880, armour: 'medium' },
    adjust: d => ({
      damage: d.damage * (44 / WEAPONS.flail.damage),
      penetration: d.load === 'hp' ? 0 : d.penetration + 0.3,
    }),
  },
  flailStock: {
    id: 'flailStock', weapon: 'flail', name: 'Enhanced stock',
    patch: { breath: { hold: ADS_ZOOM.hold * 1.6, cooldown: ADS_ZOOM.cooldown * 0.7 } },
  },
  flailAp: rounds('flail', 'ap'), flailHp: rounds('flail', 'hp'), flailPlusP: rounds('flail', 'plusP'),
  // Billhook mods: reflex sight, laser (faster ADS), extended 11-shell tube, slugs (1x200, spread 0, medium armour), plus light/flechette/dragon.
  billhookDot: { id: 'billhookDot', weapon: 'billhook', name: 'Reflex sight', slot: 'sight', patch: { ads: DOT } },
  billhookLam: laserSight('billhook'),
  gimletLam: laserSight('gimlet'), harrowLam: laserSight('harrow'), bodkinLam: laserSight('bodkin'), flailLam: laserSight('flail'),
  awlLam: laserSight('awl'), sabotLam: laserSight('sabot'), shotgunLam: laserSight('shotgun'), thresherLam: laserSight('thresher'), deuceLam: laserSight('deuce'),
  billhookTube: { id: 'billhookTube', weapon: 'billhook', name: 'Extended tube', slot: 'mag', patch: { magSize: 11 } },
  billhookSlug: {
    id: 'billhookSlug', weapon: 'billhook', name: 'Slugs', slot: 'ammo',
    patch: { pellets: 1, spread: 0, damage: 200, armour: 'medium', severMult: 2.8, force: 55, tracer: 'heavy', impactScale: 1.5 },
  },
  // Bodkin mods: 4x optic, 36-round clear mag, 5-round burst, tungsten darts (3.2 m pen, 65 dmg on bosses/vehicles), plus light/magwell.
  bodkinAcog: { id: 'bodkinAcog', weapon: 'bodkin', name: '4x optic', slot: 'sight', patch: { ads: ACOG } },
  bodkinMag: { id: 'bodkinMag', weapon: 'bodkin', name: 'Extended magazine', slot: 'mag', patch: { magSize: 36 } },
  bodkinBurst5: {
    id: 'bodkinBurst5', weapon: 'bodkin', name: '5-round burst',
    patch: { select: { hold: 0.3, modes: ['burst', 'semi'], burst: { rounds: 5, recover: 0.38 } } },
  },
  bodkinTungsten: {
    id: 'bodkinTungsten', weapon: 'bodkin', name: 'Tungsten darts', slot: 'ammo',
    patch: { penetration: 3.2, bossDamage: 65, tracer: 'sabot' },
  },
  smgAkimbo: akimbo('smg'), rivetAkimbo: akimbo('rivet'), ultramagAkimbo: akimbo('ultramag'), judgeAkimbo: akimbo('judge'),
  autorafficaAkimbo: akimbo('autoraffica'),
  rivetShield: shield('rivet'), ultramagShield: shield('ultramag'), judgeShield: shield('judge'), autorafficaShield: shield('autoraffica'),
  harrowMagwell: magwell('harrow'), gimletMagwell: magwell('gimlet'), ultramagMagwell: magwell('ultramag'),
  rivetMagwell: magwell('rivet'), bodkinMagwell: magwell('bodkin'),
  shotgunFlechette: flechette('shotgun'), thresherFlechette: flechette('thresher'), deuceFlechette: flechette('deuce'), billhookFlechette: flechette('billhook'),
  thresherDragon: dragon('thresher'), billhookDragon: dragon('billhook'),
  harrowApi: incendiary('harrow'), flailApi: incendiary('flail'),
  // 40mm FireStorm: swaps Metal Storm's 36-barrel small-bore block for a stacked 40mm HE grenade matrix.
  metalstorm40mm: {
    id: 'metalstorm40mm', weapon: 'metalstorm', name: '40mm FireStorm', slot: 'barrel',
    patch: {
      round: 'grenade',
      magSize: 36, reserve: 72, maxReserve: 108, reloadTime: 2.8,
      damage: 55, spread: 0.032, force: 55,
      muzzle: 'rotary',
      sounds: [{ id: 'launcher_thump', pitchJitter: 0.06 }],
      recoil: 1.1, kick: 0.014, shake: 0.032, fovPunch: 0.75,
      grenade: { speed: 52, gravity: 11.5, life: 7, radius: 5.0, blast: 135 },
    },
  },
  // Awl .50 Cal conversion: heavy anti-materiel chambering, massive damage/penetration/overkill jump, tank-brake boom.
  // No slot so it stacks freely with awlBarrel (Extended barrel), awlCan, awlBolt, optics, and ammo mods.
  awl50: {
    id: 'awl50', weapon: 'awl', name: '.50 Cal conversion',
    patch: {
      armour: 'heavy',
      casing: 'cannon',
      muzzle: 'sabot',
      sounds: [{ id: 'awl50_shot', pitchJitter: 0.02 }],
      force: 85,
      severMult: 3.5,
      gib: 0.05,
      killStop: 0.05,
      impactScale: 1.9,
      kick: 0.028,
      shake: 0.028,
      fovPunch: 2.4,
      recoil: 1.45,
      magSize: 4,
    },
    adjust: d => ({
      damage: Math.round(d.damage * 1.75),
      penetration: d.penetration > 0 ? d.penetration + 0.8 : 0,
      bodyCost: 0.16,
      ...(d.load !== 'hp' ? { armorPiercing: true } : {}),
      ...(d.muzzle === 'suppressed' ? { sounds: [{ id: 'awl50_suppressed_shot', pitchJitter: 0.02 }] } : {}),
      interval: +(d.interval * 1.15).toFixed(3),
      cycleTime: d.cycleTime ? +(d.cycleTime * 1.15).toFixed(3) : undefined,
      cycleFoley: d.cycleFoley?.map(([at, id]) => [+(at * 1.15).toFixed(3), id] as const),
    }),
  },
  // Milkor MGL Sticky Bomb conversion: hold R to toggle between HE and STICKY 40mm grenades; RMB detonates all planted stickies.
  mglSticky: {
    id: 'mglSticky', weapon: 'mgl', name: 'Sticky Bomb',
    patch: { altAmmo: { label: 'STICKY', hold: 0.3 } },
  },
};

export const MOD_ORDER: readonly ModId[] = [
  'awlAcog', 'awl50', 'awlCan', 'awlAp', 'awlHp', 'awlPlusP', 'awlBarrel', 'awlBolt',
  'suppressor', 'smgAp', 'smgHp', 'smgPlusP', 'gimletAcog', 'gimletDot', 'gimletCan', 'gimletGl', 'gimletAp', 'gimletHp', 'gimletPlusP', 'gimletLong',
  'reddot', 'harrowAcog', 'harrowAp', 'harrowHp', 'harrowPlusP', 'harrowShort', 'harrowBrake', 'harrowMag',
  'bodkinAcog', 'bodkinMag', 'bodkinBurst5', 'bodkinTungsten',
  'raufoss', 'rivetAp', 'rivetHp', 'rivetPlusP', 'ultramagAp', 'ultramagHp', 'ultramagPlusP', 'judgeAp', 'judgeHp', 'judgePlusP',
  'autorafficaAp', 'autorafficaHp', 'autorafficaPlusP', 'autorafficaMag',
  'sabotBrake', 'trommel12', 'autocannonFlak', 'autocannonBarrel', 'piledriverDot', 'piledriverAcog',
  'ultramagCan', 'ultramagDot', 'ultramagLam', 'ultramagMag', 'ultramagComp',
  'rivetCan', 'rivetDot', 'rivetLam', 'rivetComp',
  'smgMag', 'smgTape', 'smgStock', 'swordEnergy', 'gimletShort', 'rivetMag', 'piledriverBox',
  'deuceQuad', 'deuceLong', 'deuceLoader', 'shotgunChoke', 'shotgunSawedOff', 'shotgunBolt',
  'billhookDot', 'billhookTube', 'billhookSlug',
  'judgeHammer', 'judgeGrip', 'judgeLong', 'judgeComp',
  'rocketTube', 'rocketWp', 'mglLong', 'mglTrigger', 'howitzerCluster',
  'flailDot', 'flailAcog', 'flailBox', 'flailAp', 'flailHp', 'flailPlusP', 'flailHeavy', 'flailStock',
  'metalstorm40mm', 'mglSticky',
  ...LIGHT_GUNS.map(lightOf),
  ...LAM_GUNS.map(lamOf),
  ...AKIMBO_GUNS.map(akimboOf),
  ...SHIELD_GUNS.map(shieldOf),
  ...MAGWELL_GUNS.map(magwellOf),
  ...FLECHETTE_GUNS.map(flechetteOf),
  ...DRAGON_GUNS.map(dragonOf),
  ...API_GUNS.map(apiOf),
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
