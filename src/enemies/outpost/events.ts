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
 *   prisoner:cuffed, secured            the capture and the drone (airlift.ts)
 */
import type * as THREE from 'three';
import type { DamageInfo } from '../../core/contracts';
import type { DamageResult, EnemyInstance, KillEvent } from '../../core/gameplay';
import type { Condition, ZoneId } from '../wounds/rules';

export type CommsKind =
  | 'contact' | 'lost' | 'noise' | 'manDown' | 'leaderDown' | 'takingCommand' | 'medic' | 'reloading' | 'moving' | 'covering'
  | 'flanking' | 'frag' | 'flash' | 'breach' | 'fallback' | 'regroup' | 'fear' | 'panic' | 'surrender' | 'fix' | 'squadGone'
  | 'hit' | 'dying' | 'beg' | 'scream' | 'rescue' | 'lastStand' | 'order' | 'ally'
  | 'pinning' | 'flushing' | 'rushing' | 'cutoff' | 'ambushSet' | 'spring' | 'opening' | 'wounded' | 'dry' | 'refused' | 'hostage' | 'clearShot' | 'obey' | 'behindUs'
  // The squad comms system's own (docs/design/squad-comms.md).
  | 'ack'
  | 'plateHeld' | 'plateGone' | 'pierced' | 'artery' | 'gut' | 'limbLost' | 'downed'
  | 'set' | 'playerHit'
  | 'rocketOut' | 'gunDown' | 'hold'
  | 'contactReport' | 'copy' | 'status' | 'squadWiped' | 'sayAgain' | 'radioCheck' | 'radioLost' | 'radioGrab'
  | 'flee' | 'holdout' | 'fakeOut' | 'revenge' | 'taunt'
  | 'habit'
  | 'shieldUp' | 'stackOn' | 'shieldPush' | 'breakOut' | 'shieldFlanked' | 'shieldDown' | 'merge'
  // Combined-arms vehicle, ordnance, and air-ground pilot radio concepts.
  | 'vehSpotted' | 'ordnance' | 'vehHijack' | 'vehRoadkill' | 'vehAir' | 'vehArmor' | 'groundAirCall'
  | 'airInbound' | 'airStrike' | 'airDogfight' | 'airEvade' | 'airDown' | 'airSplash';

export interface CommsLine {
  kind: CommsKind;
  text: string;
  /** 'Alpha', 'Bravo'. */
  squad: string;
  /** 'Cpl Marsh · Alpha'. Null for Command itself. */
  speaker: string | null;
  enemy: EnemyInstance | null;
  /** Where it was said from. Shared and reused: copy it to keep it. */
  position: THREE.Vector3;
  /** The rule table's row (chatter/lines.ts `RULES`), or -1 for words a caller chose. Absent from lines outside the Outpost's brain. */
  row?: number;
  /** The name ids (chatter/names.ts `NAME_LIST`) the feed tag and the {dead} slot used, or -1. */
  name?: number;
  dead?: number;
  /** The row's other blanks as filled ({clock}, {squad}...), or null. */
  slots?: Record<string, string> | null;
  /** Why this row won, for the debug overlay. Empty on a co-op guest. */
  why?: string;
  /** The speaker's voice for life (chatter/voices.ts), or -1. */
  voice?: number;
  /** Explicit chatter clip key (without `.t2`/`.t3`) for relayed lines (`row === -1`), or null. */
  clip?: string | null;
  /** True when a relayed clip should play on the map-wide radio channel rather than spatially from `enemy`. */
  radio?: boolean;
  /** True for friendly Dogfight wingmen and allied aircrews so the HUD styles them in var(--friend) while preserving semantic kind. */
  ally?: boolean;
}

declare module '../../core/contracts' {
  interface GameEvents {
    'comms:line': CommsLine;
    /** The speaker talking was killed or badly hit `at` characters into the line: it ends there, with a dash. */
    'comms:cut': { enemy: EnemyInstance | null; speaker?: string | null; at: number; radio: boolean };
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
    /**
     * He talked. `truthful` is false when what he said was a lie. `marks` is what his word put on the map (shared and reused: copy
     * it to keep it) and `seconds` how long it stays: the co-op host passes them on, so the whole team sees what he gave up.
     */
    'prisoner:questioned': { enemy: EnemyInstance; truthful: boolean; marks?: readonly { at: THREE.Vector3; label: string }[]; seconds?: number };
    /** The player let him go. */
    'prisoner:freed': { enemy: EnemyInstance };
    /** He was shot on his knees and lived, so he has stopped being a prisoner. */
    'prisoner:refused': { enemy: EnemyInstance };
    /** He got hold of a gun and is back in the fight. */
    'prisoner:rearmed': { enemy: EnemyInstance };
    /** The player cuffed him. A drone is coming for him. */
    'prisoner:cuffed': { enemy: EnemyInstance };
    /** The drone lifted him off the floor. `bounty` is the credits it paid, 0 in a mode without them. Once per man. */
    'prisoner:secured': { enemy: EnemyInstance; bounty: number };
  }
}
