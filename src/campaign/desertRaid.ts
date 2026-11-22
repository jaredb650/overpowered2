/** Desert Raid runtime director stub (replaced by Lane 5). */
import type { Ctx } from '../core/contracts';
import type { CampaignHud } from './hud';
import type { MissionRunner } from './runner';

export class DesertRaid {
  constructor(private readonly _ctx: Ctx, private readonly _runner: MissionRunner, private readonly _ui: CampaignHud) {}
  ensureBuilt(): void {}
  call(_name: string, _arg?: string): void {}
  update(_dt: number): void {}
  clear(): void {}
  reset(): void {}
}
