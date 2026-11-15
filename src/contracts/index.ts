/** The active contract as a system, and the kit every contract shares. Game.ts finds `createContracts` by convention. */
import type { Ctx } from '../core/contracts';
import type { ContractSystem } from '../core/gameplay';
import type { ContractDef } from './data';
import { createDefense, type Defense } from './defense';
import { DefenseRadio } from './defense/radio';
import { BackShots } from './rewards';
import { createShop, type CrucibleShop } from './shop';
import { ACTIVE } from './select';
import { Sonar } from './sonar';

class Contracts implements ContractSystem {
  readonly def: ContractDef = ACTIVE.def;
  readonly sonar: Sonar;
  readonly defense: Defense | null;
  /** Outpost Defense's radio: the Commander, the Council and the player's men. Only the fort has sides to name. */
  readonly radio: DefenseRadio | null;
  /** The Crucible's shop and its credits (shop/), where this page's Crucible sells its guns. */
  readonly shop: CrucibleShop | null;

  constructor(private readonly ctx: Ctx) {
    this.sonar = new Sonar(ctx);
    this.defense = createDefense(ctx);
    this.radio = this.defense && ACTIVE.map === 'fort' ? new DefenseRadio(ctx) : null;
    this.shop = createShop(ctx);
  }

  /** The purse a prisoner's bounty and any other credits go into on this page. */
  get wallet(): Defense | CrucibleShop | null {
    return this.defense ?? this.shop;
  }

  init(): void {
    const { backShot } = this.def.rewards;
    if (backShot > 1) new BackShots(this.ctx, backShot);
    this.defense?.init();
    this.radio?.init();
    this.shop?.init();
  }

  update(): void {
    this.sonar.update();
    this.defense?.update();
    this.radio?.update();
    this.shop?.update();
  }

  reset(): void {
    this.sonar.reset();
    this.defense?.reset();
    this.radio?.reset();
    this.shop?.reset();
  }
}

export function createContracts(ctx: Ctx): ContractSystem {
  return new Contracts(ctx);
}
