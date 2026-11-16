/**
 * The Crucible's shop at run time (docs/proposals/weapons-update.md, section 10): the credits, the break's length, and buying.
 * `ctx.contracts.shop` on a page where it is on (`SHOP_ON`), null elsewhere. The rules are rules.ts and the prices data.ts; the pay
 * is Outpost Defense's (defense/data.ts). The only way in is the supply pod each break brings (progression/pickups/pods.ts): E at it
 * emits `shop:open`, and the menu (ui/screens/procurement.ts) goes up over the paused run as Outpost Defense's shops do.
 */
import type { Ctx } from '../../core/contracts';
import { DEV_TOOLS } from '../../core/devflags';
import type { ModId, WeaponSystem } from '../../core/gameplay';
import { killPay, paysFor, wavePay } from '../defense/data';
import { BOSS_PAY, SHOP_ON, SUPPLY_BREAK } from './data';
import type { Loadout } from '../../progression/implants';
import { implantOffers, modOffers, offerFor, weaponOffers, type ShopAct, type ShopOffer, type ShopView } from './rules';

declare module '../../core/contracts' {
  interface GameEvents {
    /** E at a supply pod: the HUD puts the Crucible's shop up and pauses the run under it. */
    'shop:open': Record<string, never>;
  }
}

declare module '../../core/gameplay' {
  interface ContractSystem {
    /** The Crucible's shop. Null on any other page. */
    readonly shop?: CrucibleShop | null;
    /** Where credits go on this page (a prisoner's bounty among them): Outpost Defense's or the Crucible's, null without any. */
    readonly wallet?: { earn(amount: number): void } | null;
  }
}

/** What the shop needs of the weapons beyond the interface: the mods (src/weapons/mods.ts). */
type ModWeapons = WeaponSystem & {
  readonly mods: ReadonlySet<ModId>;
  readonly fitted: ReadonlySet<ModId>;
  grantMod(id: ModId): void;
  fitMod(id: ModId, on: boolean): boolean;
};

const FEED = '#ffc14a';

export class CrucibleShop {
  credits = 0;
  /** Credits earned this run, for the tests. */
  earned = 0;
  /** A wave has just been cleared: the break that follows is lengthened to `SUPPLY_BREAK` once it has begun. */
  private stretch = false;

  constructor(private readonly ctx: Ctx) {}

  init(): void {
    const { events } = this.ctx;
    events.on('enemy:killed', e => {
      if (paysFor(e.damage.source)) this.earn(killPay(e.headshot) + (e.enemy.isBoss ? BOSS_PAY : 0));
    });
    events.on('wave:clear', e => {
      const pay = wavePay(e.wave);
      this.earn(pay);
      this.stretch = true;
      this.ctx.hud.feed(`+${pay} CREDITS: WAVE ${e.wave} CLEARED`, FEED);
    });
    if (DEV_TOOLS && typeof window !== 'undefined') (window as unknown as { __shop: CrucibleShop }).__shop = this;
  }

  reset(): void {
    this.credits = this.earned = 0;
    this.stretch = false;
  }

  update(): void {
    const waves = this.ctx.waves as { nextWaveIn: number };
    // The waves set the break's length as it begins, after `wave:clear`: it is stretched here, once, the frame after.
    if (this.stretch && this.inBreak) {
      this.stretch = false;
      waves.nextWaveIn = Math.max(waves.nextWaveIn, SUPPLY_BREAK);
    }
    if (this.inBreak && waves.nextWaveIn > 3 && this.ctx.input.pressed('nextWave')) {
      waves.nextWaveIn = 3;
      this.ctx.hud.feed('NEXT WAVE CALLED IN', '#ff8a3a');
    }
  }

  earn(amount: number): void {
    this.credits += amount;
    this.earned += amount;
  }

  get inBreak(): boolean {
    return this.ctx.waves.phase === 'intermission';
  }

  /** The run as the rules read it, now. */
  view(): ShopView {
    const w = this.weapons;
    const waves = this.ctx.waves;
    return {
      credits: this.credits, inBreak: this.inBreak, cleared: this.inBreak ? waves.wave : waves.wave - 1,
      owned: w.owned, mods: w.mods, fitted: w.fitted,
      implants: this.loadout.owned, implantsFitted: this.loadout.fitted, slots: this.loadout.slots,
    };
  }

  /** Progression's implant loadout (progression/implants.ts), which the interface does not carry. */
  get loadout(): Loadout {
    return (this.ctx.progression as unknown as { loadout: Loadout }).loadout;
  }

  implantOffers(): ShopOffer[] {
    return implantOffers(this.view());
  }

  weaponOffers(): ShopOffer[] {
    return weaponOffers(this.view());
  }

  modOffers(): ShopOffer[] {
    return modOffers(this.view());
  }

  /**
   * Buys a gun (exactly that one), buys and fits a mod or an implant, or fits or takes off one already bought, free; or buys the
   * next implant slot. Returns why not, or null once it is done.
   */
  buy(act: ShopAct): string | null {
    const offer = offerFor(act, this.view());
    if (!offer) return 'Not sold';
    if (offer.why) return offer.why;
    const w = this.weapons;
    if (act.kind === 'slot') {
      this.loadout.openSlot();
    } else if (act.kind === 'implant') {
      // Fitting one takes off the one of its class (Loadout.fit); progression ends a removed effect and arms the new one.
      if (offer.owned) {
        this.loadout.fit(act.id, !offer.fitted);
        return null;
      }
      this.loadout.fit(act.id, true);
    } else if (act.kind === 'weapon') {
      w.give(act.id);
    } else if (offer.owned) {
      w.fitMod(act.id, !offer.fitted);
      return null;
    } else {
      w.grantMod(act.id);
      w.fitMod(act.id, true);
    }
    this.credits -= offer.ware.price;
    return null;
  }

  private get weapons(): ModWeapons {
    return this.ctx.weapons as ModWeapons;
  }
}

/** Only where the Crucible sells its guns. */
export const createShop = (ctx: Ctx): CrucibleShop | null => (SHOP_ON ? new CrucibleShop(ctx) : null);
