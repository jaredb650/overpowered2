/** The active contract as a system, and the kit every contract shares. Game.ts finds `createContracts` by convention. */
import type { Ctx } from '../core/contracts';
import type { ContractSystem } from '../core/gameplay';
import type { ContractDef } from './data';
import { BackShots } from './rewards';
import { ACTIVE } from './select';
import { Sonar } from './sonar';

class Contracts implements ContractSystem {
  readonly def: ContractDef = ACTIVE.def;
  readonly sonar: Sonar;

  constructor(private readonly ctx: Ctx) {
    this.sonar = new Sonar(ctx);
  }

  init(): void {
    const { backShot } = this.def.rewards;
    if (backShot > 1) new BackShots(this.ctx, backShot);
  }

  update(): void {
    this.sonar.update();
  }

  reset(): void {
    this.sonar.reset();
  }
}

export function createContracts(ctx: Ctx): ContractSystem {
  return new Contracts(ctx);
}
