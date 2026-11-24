/**
 * Unified Runtime Director for the 4-Part "Crossfire" Campaign (`CrossfireDirector`).
 *
 * Coordinates all 4 Crossfire missions across 3 bespoke theaters:
 *   - `crossfire_airbase`  -> `AirbaseDirector` (7 `cf.*` calls)
 *   - `crossfire_strait`   -> `StraitDirector`  (5 outbound `cf.*` calls)
 *   - `crossfire_halcyon`  -> `HalcyonDirector` (8 combined-arms `cf.*` calls)
 *   - `crossfire_return`   -> `StraitDirector`  (3 dusk return `cf.*` calls + `cf.straitWave`)
 *
 * Every one of the 23 documented `cf.*` calls in `CROSSFIRE_CALLS` (`chain.ts`) resolves to a
 * live handler here with zero unhandled warnings.
 */
import type { Ctx } from '../../core/contracts';
import type { CampaignHud } from '../hud';
import type { MissionRunner } from '../runner';
import { AirbaseDirector } from './airbaseDirector';
import { HalcyonDirector } from './halcyonDirector';
import { CrossfireHudOverlay } from './hudOverlay';
import { StraitDirector } from './straitDirector';

export const CROSSFIRE_MISSION_IDS = new Set<string>([
  'crossfire_airbase',
  'crossfire_strait',
  'crossfire_halcyon',
  'crossfire_return',
]);

export function isCrossfireMissionId(id: string): boolean {
  return CROSSFIRE_MISSION_IDS.has(id);
}

export class CrossfireDirector {
  readonly hudOverlay: CrossfireHudOverlay;
  readonly airbase: AirbaseDirector;
  readonly strait: StraitDirector;
  readonly halcyon: HalcyonDirector;
  private built = false;

  constructor(
    private readonly ctx: Ctx,
    private readonly runner: MissionRunner,
    readonly ui?: CampaignHud,
    isCutscenePlaying: () => boolean = () => false,
  ) {
    this.hudOverlay = new CrossfireHudOverlay();
    this.airbase = new AirbaseDirector(ctx, runner);
    this.strait = new StraitDirector(ctx, runner, this.hudOverlay, isCutscenePlaying);
    this.halcyon = new HalcyonDirector(ctx, runner, this.hudOverlay, isCutscenePlaying);
  }

  ensureBuilt(): void {
    if (this.built) return;
    this.built = true;

    const id = this.runner.mission.id;
    if (id === 'crossfire_airbase') {
      this.airbase.ensureBuilt();
    } else if (id === 'crossfire_strait' || id === 'crossfire_return') {
      this.strait.ensureBuilt();
    } else if (id === 'crossfire_halcyon') {
      this.halcyon.ensureBuilt();
    }

    if (typeof window !== 'undefined') {
      const op2 = (window as unknown as { __op2?: Record<string, unknown> }).__op2;
      if (op2) op2.crossfire = this;
    }
  }

  /**
   * Dispatches any `cf.*` call from a Crossfire mission script to its sub-director.
   * Returns `true` if handled, `false` otherwise.
   */
  call(name: string, arg?: string): boolean {
    this.ensureBuilt();
    if (this.airbase.call(name, arg)) return true;
    if (this.strait.call(name, arg)) return true;
    if (this.halcyon.call(name, arg)) return true;
    console.warn(`[crossfire] unhandled call "${name}" (arg=${arg ?? ''})`);
    return false;
  }

  update(dt: number): void {
    if (!this.built || dt <= 0) return;
    const id = this.runner.mission.id;
    if (id === 'crossfire_airbase') {
      this.airbase.update(dt);
    } else if (id === 'crossfire_strait' || id === 'crossfire_return') {
      this.strait.update(dt);
    } else if (id === 'crossfire_halcyon') {
      this.halcyon.update(dt);
    } else {
      // Fallback for generic/synthetic test harnesses running all sub-directors
      this.airbase.update(dt);
      this.strait.update(dt);
      this.halcyon.update(dt);
    }
  }

  clear(): void {
    this.airbase.clear();
    this.strait.clear();
    this.halcyon.clear();
    this.hudOverlay.hide();
  }

  reset(): void {
    this.airbase.reset();
    this.strait.reset();
    this.halcyon.reset();
    this.hudOverlay.dispose();
    this.built = false;
  }
}
