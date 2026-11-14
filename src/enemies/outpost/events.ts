/**
 * What the Outpost tells the rest of the game. Other systems listen; nothing here knows who.
 *
 *   enemy:surrendered, enemy:executed   the Geneva Suggestion
 *   enemy:backshot                      back-shot rewards. Emitted after the damage, for score and feedback
 *   comms:line                          the on-screen feed and, later, the recorded voices
 *   enemy:broken, enemy:escaped, squad:broken, dread:spike   style scoring, the HUD and The Commander
 *   enemy:wounded                       section 14.6's style labels, once per man per zone, with what it pays
 *   enemy:condition                     a man moved between section 14.1's conditions
 *   prisoner:grabbed, questioned, freed, refused, rearmed   what became of a man who gave up
 */
import type * as THREE from 'three';
import type { DamageInfo } from '../../core/contracts';
import type { DamageResult, EnemyInstance, KillEvent } from '../../core/gameplay';
import type { Condition, ZoneId } from '../wounds/rules';

export type CommsKind =
  | 'contact' | 'lost' | 'noise' | 'manDown' | 'leaderDown' | 'takingCommand' | 'medic' | 'reloading' | 'moving' | 'covering'
  | 'flanking' | 'frag' | 'flash' | 'breach' | 'fallback' | 'regroup' | 'fear' | 'panic' | 'surrender' | 'fix' | 'squadGone'
  | 'hit' | 'dying' | 'beg' | 'scream' | 'rescue' | 'lastStand' | 'order' | 'ally'
  | 'pinning' | 'flushing' | 'rushing' | 'cutoff' | 'ambushSet' | 'spring' | 'opening' | 'wounded' | 'dry' | 'refused' | 'hostage' | 'clearShot' | 'obey' | 'behindUs';

export interface CommsLine {
  kind: CommsKind;
  text: string;
  /** 'Alpha', 'Bravo'. */
  squad: string;
  /** 'Alpha-2'. Null for Command itself. */
  speaker: string | null;
  enemy: EnemyInstance | null;
  /** Where it was said from. Shared and reused: copy it to keep it. */
  position: THREE.Vector3;
}

declare module '../../core/contracts' {
  interface GameEvents {
    'comms:line': CommsLine;
    /** Morale ran out. The weapon is on the floor and `fate` says what happens next. */
    'enemy:broken': { enemy: EnemyInstance; fate: 'flee' | 'surrender' };
    /** Hands up, on the knees. No longer a threat, and no longer counted for the wave. */
    'enemy:surrendered': { enemy: EnemyInstance };
    /** A surrendered enemy was killed. Sent after `enemy:killed`, with the same event. */
    'enemy:executed': { kill: KillEvent };
    /** A hit from behind. `fleeing` is true while it is running for a gate. */
    'enemy:backshot': { enemy: EnemyInstance; damage: DamageInfo; result: DamageResult; fleeing: boolean };
    /** A broken enemy reached a gate and left the round. */
    'enemy:escaped': { enemy: EnemyInstance };
    /** A squad was cut down so fast that its survivors broke. */
    'squad:broken': { squad: string; survivors: number };
    /** A hit found a part of a man worth naming. `damage` is only good for this call. */
    'enemy:wounded': { enemy: EnemyInstance; zone: ZoneId; label: string; bonus: number; damage: DamageInfo };
    /** Healthy, wounded, mortal, downed or dead: section 14.1. Not sent for 'dead', which is `enemy:killed`. */
    'enemy:condition': { enemy: EnemyInstance; condition: Condition };
    /** Dread jumped. `cause` is a perk id, a call-in id, or 'squad'. */
    'dread:spike': { dread: number; cause: string };
    /** A squad finished a drill, well or badly. For the record of how a fight went, and for bots. */
    'squad:drill': { squad: string; drill: string; done: boolean; seconds: number };
    /** The player took a prisoner by the collar. */
    'prisoner:grabbed': { enemy: EnemyInstance };
    /** He talked. `truthful` is false when what he said was a lie. */
    'prisoner:questioned': { enemy: EnemyInstance; truthful: boolean };
    /** The player let him go. */
    'prisoner:freed': { enemy: EnemyInstance };
    /** He was shot on his knees and lived, so he has stopped being a prisoner. */
    'prisoner:refused': { enemy: EnemyInstance };
    /** He got hold of a gun and is back in the fight. */
    'prisoner:rearmed': { enemy: EnemyInstance };
  }
}
