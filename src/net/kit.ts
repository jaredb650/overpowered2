/**
 * A player's kit, as the host keeps it for a player who drops and comes back (team.ts): every gun with its mods and rounds,
 * grenades, stims, implants, brain chips, the call-ins held and the combo. The player's own browser reads it (`readKit`) and
 * puts it back (`applyKit`) through the same calls the shop and the missions use; the host only stores it, cleaned (`cleanKit`),
 * under the player's stable id. Credits, score and kills ride on the card (the purse), not here.
 */
import type { Ctx } from '../core/contracts';
import type { CallInId, ModId, WeaponId } from '../core/gameplay';
import { CHIPS, CHIP_SLOTS, type ChipId, type ChipRack } from '../contracts/chips';
import { CALLINS } from '../progression/data';
import { IMPLANTS, SLOT_WARES, type ImplantId, type Loadout } from '../progression/implants';
import { cleanKit as cleanGun, type GunKit } from '../weapons/handover';
import { TUNING, WEAPONS } from '../weapons/data';
import { MODS } from '../weapons/mods';

export interface Kit {
  guns: GunKit[];
  /** The gun in hand. */
  current: string;
  grenades: number;
  stims: number;
  implants: string[];
  implantsFitted: string[];
  implantSlots: number;
  chips: string[];
  chipsFitted: string[];
  chipSlots: number;
  callIns: string[];
  combo: number;
  headshots: number;
}

/** The weapons as the kit needs them: the mods and the gun in hand, which the interface does not carry. */
type KitWeapons = Ctx['weapons'] & {
  readonly mods: ReadonlySet<ModId>;
  readonly fitted: ReadonlySet<ModId>;
  grenades: number;
  grantMod(id: ModId): void;
  fitMod(id: ModId, on: boolean): boolean;
  switchTo?(id: WeaponId): void;
};
type KitProgression = Ctx['progression'] & { loadout?: Loadout };

const rack = (ctx: Ctx): ChipRack | undefined => (ctx.contracts as unknown as { chips?: { rack?: ChipRack } } | undefined)?.chips?.rack;
const count = (v: unknown, max: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : 0);
const ids = <T extends string>(v: unknown, table: object, max: number): T[] =>
  Array.isArray(v) ? [...new Set(v)].filter((id): id is T => typeof id === 'string' && Object.hasOwn(table, id)).slice(0, max) : [];

/** This browser's kit, now. */
export function readKit(ctx: Ctx): Kit {
  const w = ctx.weapons as KitWeapons;
  const p = ctx.progression as KitProgression;
  const chips = rack(ctx);
  const guns: GunKit[] = [];
  for (const id of w.owned) {
    const a = w.ammo(id);
    const mods = [...(w.mods ?? [])].filter(m => MODS[m]?.weapon === id);
    guns.push({ weapon: id, mods, fitted: mods.filter(m => w.fitted?.has(m)), mag: a.mag, reserve: a.reserve });
  }
  return {
    guns, current: w.current, grenades: w.grenades ?? 0, stims: p.stims?.count ?? 0,
    implants: [...(p.loadout?.owned ?? [])], implantsFitted: [...(p.loadout?.fitted ?? [])], implantSlots: p.loadout?.slots ?? 1,
    chips: [...(chips?.owned ?? [])], chipsFitted: [...(chips?.fitted ?? [])], chipSlots: chips?.slots ?? 1,
    callIns: [...(p.callIns ?? [])], combo: p.combo ?? 0, headshots: p.headshots ?? 0,
  };
}

/** A kit from another browser, or null: known ids only, every number bounded, nothing else kept. */
export function cleanKit(raw: unknown): Kit | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.guns)) return null;
  const guns: GunKit[] = [];
  for (const g of r.guns.slice(0, 40)) {
    const gun = cleanGun(g);
    if (gun && !guns.some(o => o.weapon === gun.weapon)) guns.push(gun);
  }
  if (!guns.length) return null;
  const implants = ids<ImplantId>(r.implants, IMPLANTS, 64);
  const chips = ids<ChipId>(r.chips, CHIPS, 16);
  return {
    guns, current: guns.some(g => g.weapon === r.current) ? r.current as string : guns[0]!.weapon,
    grenades: count(r.grenades, TUNING.grenade.max), stims: count(r.stims, 9),
    implants, implantsFitted: ids<ImplantId>(r.implantsFitted, IMPLANTS, 8).filter(id => implants.includes(id)),
    implantSlots: Math.max(1, count(r.implantSlots, SLOT_WARES.length)),
    chips, chipsFitted: ids<ChipId>(r.chipsFitted, CHIPS, CHIP_SLOTS).filter(id => chips.includes(id)),
    chipSlots: Math.max(1, count(r.chipSlots, CHIP_SLOTS)),
    callIns: ids<CallInId>(r.callIns, CALLINS, 16), combo: count(r.combo, 9999), headshots: count(r.headshots, 1e6),
  };
}

/** Puts a kit back in this browser's hands: guns with their mods and rounds, implants, brain chips, call-ins, the combo. */
export function applyKit(ctx: Ctx, kit: Kit): void {
  const w = ctx.weapons as KitWeapons;
  const p = ctx.progression as KitProgression;
  const guns = kit.guns.filter(g => Object.hasOwn(WEAPONS, g.weapon));
  if (guns.length) {
    // The gun in hand first: the loadout draws its first weapon.
    const order = [...guns].sort((a, b) => Number(b.weapon === kit.current) - Number(a.weapon === kit.current));
    w.setLoadout(order.map(g => g.weapon), kit.grenades);
    for (const g of guns) {
      for (const m of g.mods) w.grantMod?.(m);
      for (const m of g.fitted) w.fitMod?.(m, true);
      const a = w.ammo(g.weapon);
      a.mag = Math.min(g.mag, a.magSize);
      a.reserve = Math.min(a.maxReserve, g.reserve);
    }
  }
  const loadout = p.loadout;
  if (loadout) {
    while (loadout.slots < kit.implantSlots && loadout.openSlot()) { /* opened */ }
    for (const id of kit.implants as ImplantId[]) loadout.grant(id);
    for (const id of [...loadout.fitted]) if (!kit.implantsFitted.includes(id)) loadout.fit(id, false);
    for (const id of kit.implantsFitted as ImplantId[]) loadout.fit(id, true);
  }
  const chips = rack(ctx);
  if (chips) {
    while (chips.slots < kit.chipSlots && chips.openSlot()) { /* opened */ }
    for (const id of kit.chips as ChipId[]) chips.grant(id);
    for (const id of [...chips.fitted]) if (!kit.chipsFitted.includes(id)) chips.fit(id, false);
    for (const id of kit.chipsFitted as ChipId[]) chips.fit(id, true);
  }
  for (const id of kit.callIns as CallInId[]) if (!p.callIns?.has(id)) p.grantCallIn?.(id);
  if (kit.combo > 0) p.setCombo?.(kit.combo);
  const stims = p.stims;
  if (stims) {
    if (kit.stims > stims.count) stims.give(kit.stims - stims.count);
    else for (let n = stims.count - kit.stims; n > 0; n--) stims.spend();
  }
}
