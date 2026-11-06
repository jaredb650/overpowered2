/** What the Commander tells the rest of the game. The dialogue box and its chips listen. Nothing here knows who. */
import type * as THREE from 'three';
import type { AdaptationId, Phase, TrickId } from './adaptations';
import type { RoundReport } from './tracker';

/** What the box needs to say something about the round that just ended. */
export interface Briefing {
  wave: number;
  /** The wave the player is about to fight. */
  next: number;
  phase: Phase;
  report: RoundReport;
  /** The answer fielded for the next wave, if any. */
  adaptation: AdaptationId | null;
  /** New tricks for the next wave. */
  tricks: readonly TrickId[];
  /** Everything answered so far, new last. */
  fielded: readonly AdaptationId[];
  /** Seconds until the next wave, which is the box's own budget too. */
  seconds: number;
}

export type StatusFlag = 'painted' | 'jammed' | 'uplink' | 'aaLock';

declare module '../../core/contracts' {
  interface GameEvents {
    /** Between waves: the Commander has something to say. */
    'commander:briefing': Briefing;
    /** The player pressed through the box. The next wave comes sooner. */
    'commander:skipped': Record<string, never>;
    /** A warning chip goes up or comes down. */
    'commander:status': { flag: StatusFlag; on: boolean };
    /** One line from the Commander over the open channel, mid-wave. An id from lines.ts. */
    'commander:bark': { id: string; vars?: Readonly<Record<string, string>> };
    /** He has come down himself, or has gone. */
    'commander:person': { arrived: boolean };
    /** The Commander's own side killed one of its men, and paid the player for it. */
    'commander:gift': { position: THREE.Vector3; cause: string };
    /** He is dead. The contract is fulfilled. */
    'commander:fulfilled': Record<string, never>;
  }
}
