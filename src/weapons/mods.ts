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

/** The guns that take AP and HP rounds: the SMG, the two rifles and the three pistols. */
export const AMMO_GUNS: readonly WeaponId[] = ['smg', 'gimlet', 'harrow', 'rivet', 'ultramag', 'judge'];

/** AP: less to flesh, most of it through a plate, one more body. HP: more to flesh, nothing through a plate, no further. */
function rounds(gun: WeaponId, load: AmmoLoad): ModDef {
  const row = WEAPONS[gun];
  const ap = load === 'ap';
  return {
    id: `${gun}${ap ? 'Ap' : 'Hp'}` as ModId, weapon: gun, name: ap ? 'AP rounds' : 'HP rounds', slot: 'ammo',
    patch: {
      load, tracer: load, damage: row.damage * AMMO[load].flesh,
      penetration: ap ? row.penetration + AMMO.ap.penetration : 0,
    },
  };
}

export const MODS: Readonly<Record<ModId, ModDef>> = {
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
};

export const MOD_ORDER: readonly ModId[] = [
  'suppressor', 'smgAp', 'smgHp', 'gimletAcog', 'gimletDot', 'gimletCan', 'gimletGl', 'gimletAp', 'gimletHp',
  'reddot', 'harrowAcog', 'harrowAp', 'harrowHp', 'raufoss', 'rivetAp', 'rivetHp', 'ultramagAp', 'ultramagHp', 'judgeAp', 'judgeHp',
];

/** Held and fitted at the start of every run: the Gimlet's ACOG and suppressor. The shop takes them off and puts them back. */
export const ISSUED: readonly ModId[] = ['gimletAcog', 'gimletCan'];

/** `id`'s row with every fitted mod of its own patched over it, or the row itself when none is. */
export function moddedDef(id: WeaponId, fitted: ReadonlySet<ModId>): WeaponDef {
  let def = WEAPONS[id];
  for (const m of MOD_ORDER) if (fitted.has(m) && MODS[m].weapon === id) def = { ...def, ...MODS[m].patch };
  return def;
}
