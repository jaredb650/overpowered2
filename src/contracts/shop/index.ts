/**
 * The Crucible's shop at run time (docs/proposals/weapons-update.md, section 10): the credits, the key that opens the menu in a
 * break, and buying. `ctx.contracts.shop` on a page where it is on (`SHOP_ON`), null elsewhere. The rules are rules.ts and the
 * prices data.ts; the pay is Outpost Defense's (defense/data.ts). The menu is ui/screens/procurement.ts, over a paused run as
 * Outpost Defense's shops are.
 */
import type { Ctx } from '../../core/contracts';
import { DEV_TOOLS } from '../../core/devflags';
import type { ModId, WeaponSystem } from '../../core/gameplay';
import { killPay, paysFor, wavePay } from '../defense/data';
import { BOSS_PAY, SHOP_ON } from './data';
import { modOffers, offerFor, weaponOffers, type ShopAct, type ShopOffer, type ShopView } from './rules';

declare module '../../core/contracts' {
  interface GameEvents {
    /** The HUD puts the Crucible's shop up and pauses the run under it. */
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

  constructor(private readonly ctx: Ctx) {}

  init(): void {
    const { events } = this.ctx;
    events.on('enemy:killed', e => {
      if (paysFor(e.damage.source)) this.earn(killPay(e.headshot) + (e.enemy.isBoss ? BOSS_PAY : 0));
    });
    events.on('wave:clear', e => {
      const pay = wavePay(e.wave);
      this.earn(pay);
      const key = this.ctx.input.labelFor?.('shop') ?? 'I';
      this.ctx.hud.feed(`+${pay} CREDITS: WAVE ${e.wave} CLEARED. ${key}: SHOP`, FEED);
    });
    if (DEV_TOOLS && typeof window !== 'undefined') (window as unknown as { __shop: CrucibleShop }).__shop = this;
  }

  reset(): void {
    this.credits = this.earned = 0;
  }

  update(): void {
    const { input, player } = this.ctx;
    if (!input.pressed('shop') || !player.alive) return;
    if (this.inBreak) this.ctx.events.emit('shop:open', {});
    else this.ctx.hud.feed('THE SHOP OPENS BETWEEN WAVES', FEED);
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
    };
  }

  weaponOffers(): ShopOffer[] {
    return weaponOffers(this.view());
  }

  modOffers(): ShopOffer[] {
    return modOffers(this.view());
  }

  /**
   * Buys a gun (exactly that one), buys and fits a mod, or fits or takes off a mod already bought, free. Returns why not, or
   * null once it is done.
   */
  buy(act: ShopAct): string | null {
    const offer = offerFor(act, this.view());
    if (!offer) return 'Not sold';
    if (offer.why) return offer.why;
    const w = this.weapons;
    if (act.kind === 'weapon') {
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
