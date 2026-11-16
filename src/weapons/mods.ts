/**
 * Weapon mods (docs/proposals/weapons-update.md, section 10): bought and fitted at the Crucible's shop between waves, never
 * switched in a fight. Each one belongs to one gun and is a patch over that gun's row in WEAPONS: `Weapons.fitMod` swaps the
 * slot's row for the patched copy, so everything that fires reads it with no branch of its own. What a mod looks like on the
 * gun (a part, a sight, a muzzle) is the gun's ViewDef's `mods` entry (src/weapons/viewmodels).
 */
import type { AmmoLoad } from '../core/contracts';
import type { ModId, WeaponId } from '../core/gameplay';
import { AMMO, WEAPONS, type WeaponDef } from './data';

export interface ModDef {
  id: ModId;
  /** The gun it fits. */
  weapon: WeaponId;
  name: string;
  /** What it changes in the gun's row. */
  patch: Partial<WeaponDef>;
  /** A gun takes one of each: an optic, and a kind of round. Fitting one takes off any other of its slot on the same gun. */
  slot?: 'sight' | 'ammo';
}

const smg = WEAPONS.smg;
/** An ACOG's view: four times the hip view's magnification (90 to 28 degrees), twice the red dot's. See docs/notes/weapons.md. */
const ACOG = { zoom: 0.69, time: 0.24 } as const;
const DOT = { zoom: 0.4, time: 0.2 } as const;

/** The guns that take AP, HP and +P rounds: the SMG, the rifles and the four pistols. */
export const AMMO_GUNS: readonly WeaponId[] = ['smg', 'gimlet', 'harrow', 'rivet', 'ultramag', 'autoraffica', 'judge', 'awl'];

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
  // Every dart is a Raufoss round (raufoss.ts), as the Piledriver's right click loads. The Sabot's right click stays its scope.
  raufoss: { id: 'raufoss', weapon: 'sabot', name: 'Raufoss rounds', patch: { raufoss: true } },
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
  smgAp: rounds('smg', 'ap'), smgHp: rounds('smg', 'hp'),
  gimletAp: rounds('gimlet', 'ap'), gimletHp: rounds('gimlet', 'hp'),
  harrowAp: rounds('harrow', 'ap'), harrowHp: rounds('harrow', 'hp'),
  rivetAp: rounds('rivet', 'ap'), rivetHp: rounds('rivet', 'hp'),
  ultramagAp: rounds('ultramag', 'ap'), ultramagHp: rounds('ultramag', 'hp'),
  judgeAp: rounds('judge', 'ap'), judgeHp: rounds('judge', 'hp'),
  autorafficaAp: rounds('autoraffica', 'ap'), autorafficaHp: rounds('autoraffica', 'hp'),
  // A longer magazine out of the grip: 30 where it was 21, and a beat longer to change.
  autorafficaMag: { id: 'autorafficaMag', weapon: 'autoraffica', name: 'Extended magazine', patch: { magSize: 30, reloadTime: 1.25 } },
  smgPlusP: rounds('smg', 'plusP'), gimletPlusP: rounds('gimlet', 'plusP'), harrowPlusP: rounds('harrow', 'plusP'),
  rivetPlusP: rounds('rivet', 'plusP'), ultramagPlusP: rounds('ultramag', 'plusP'), judgePlusP: rounds('judge', 'plusP'),
  autorafficaPlusP: rounds('autoraffica', 'plusP'), awlPlusP: rounds('awl', 'plusP'),
};

export const MOD_ORDER: readonly ModId[] = [
  'awlAcog', 'awlCan', 'awlAp', 'awlHp', 'awlPlusP',
  'suppressor', 'smgAp', 'smgHp', 'smgPlusP', 'gimletAcog', 'gimletDot', 'gimletCan', 'gimletGl', 'gimletAp', 'gimletHp', 'gimletPlusP',
  'reddot', 'harrowAcog', 'harrowAp', 'harrowHp', 'harrowPlusP', 'raufoss', 'rivetAp', 'rivetHp', 'rivetPlusP', 'ultramagAp', 'ultramagHp', 'ultramagPlusP', 'judgeAp', 'judgeHp', 'judgePlusP',
  'autorafficaAp', 'autorafficaHp', 'autorafficaPlusP', 'autorafficaMag',
];

/** Held and fitted at the start of every run: the Gimlet's ACOG and suppressor. The shop takes them off and puts them back. */
export const ISSUED: readonly ModId[] = ['gimletAcog', 'gimletCan'];

/** `id`'s row with every fitted mod of its own patched over it, or the row itself when none is. */
export function moddedDef(id: WeaponId, fitted: ReadonlySet<ModId>): WeaponDef {
  let def = WEAPONS[id];
  for (const m of MOD_ORDER) if (fitted.has(m) && MODS[m].weapon === id) {
    const patch = MODS[m].patch;
    // +P multiplies the fitted gun's damage, including the SMG suppressor's boost in its separate slot.
    const damage = patch.load === 'plusP' ? def.damage * AMMO.plusP.flesh : patch.damage ?? def.damage;
    def = { ...def, ...patch, damage };
  }
  return def;
}
