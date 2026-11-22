/** Pump yard tower collapse, sewer & Quist 5-outcome finale stub (replaced by Lane 4). */
import type { Ctx } from '../../core/contracts';
import type { CampaignHud } from '../hud';
import type { MissionRunner } from '../runner';
import type { QuistHooks, QuistOutcome, SetpiecesController } from './types';

export class DesertSetpieces implements SetpiecesController {
  quistOutcome: QuistOutcome | null = null;
  gateBreached = false;
  towerDropped = false;
  constructor(private readonly _ctx: Ctx, private readonly _runner: MissionRunner, private readonly _ui: CampaignHud) {}
  ensureBuilt(): void {}
  pulseLoudspeaker(): void {}
  shatterMainGate(): void { this.gateBreached = true; }
  armWaterTower(): void {}
  triggerWaterTowerDrop(): void { this.towerDropped = true; }
  startPlaneChase(_hooks: QuistHooks): void {}
  advanceQuistToTail(): void {}
  update(_dt: number): void {}
  clear(): void {}
  reset(): void {}
}
