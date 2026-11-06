/** What the campaign adds to the shared contracts. */
import type { GameSystem } from '../core/contracts';
import type { MissionRunner } from './runner';
import type { MissionHost } from './types';

/** On every page. With no mission it does nothing at all, so the swarm pays for one empty call a frame. */
export interface CampaignSystem extends GameSystem {
  /** True while the page is running a mission. */
  readonly active: boolean;
  readonly runner: MissionRunner | null;
  /**
   * Replaces parts of the host, for a system that has something better than the fallback. Call it from your own `init`, and report
   * every body you spawned with `unitGone`.
   */
  provide(parts: Partial<MissionHost>): void;
  /** Raises a signal for `{ signal }` triggers. */
  signal(name: string): void;
  /** A body under a tag has left the fight. */
  unitGone(tag: string, killed: boolean, source: string): void;
  /** At the end of the death beat. True when the mission has taken the player back to a checkpoint and there is no game over. */
  redeploy(): boolean;
}

declare module '../core/contracts' {
  interface Ctx {
    campaign: CampaignSystem;
  }

  interface GameEvents {
    /** The mission's last beat is done. */
    'campaign:complete': Record<string, never>;
  }
}
