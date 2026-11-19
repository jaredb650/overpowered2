/**
 * Co-op: every player, as the host's soldiers and their Commander know them. Alone there is one player and none of this
 * exists: `Outpost.crowd` is null and every routine reads `w.player`, as it always did.
 *
 * The enemy side was written about "the player". In co-op each mechanic is about one particular player (the one a soldier is
 * after, the one who camps, the one whose footstep it was), and it is run as that player: `EnemyManager.focus` points the
 * AI's picture of the player at them, so the routine itself needs no co-op branch. What needs one state a player (how long
 * they have stood still, how they are moving) keeps a `Mind` each. What the host cannot see of a guest (their shots, their
 * landings, what they picked up) the guest tells it in a `Note` (net/world/crowd.ts).
 */
import * as THREE from 'three';
import type { PlayerSystem } from '../../core/contracts';
import { TargetTrack } from './aim';

export interface CrowdPlayer {
  /** Lobby id. */
  id: string;
  slot: number;
  /** As the game's own player type: the host's is the real one, a guest's a stand-in fed by their pose. */
  player: PlayerSystem;
  /** This browser's own player (the host's). */
  own: boolean;
}

/** What a guest's sonar and minimap need to know to lie as the host's do (commander/jam.ts). All by enemy uid. */
export interface JamState {
  on: boolean;
  /** The jammer and radio men: they always show, in cyan. */
  ops: number[];
  /** Men under foil: unseen past a few metres. */
  cold: number[];
  /** Men playing dead or lying wounded as bait: not on the minimap until a ping. */
  floor: number[];
}

export interface CrowdLink {
  /** Every player whose body is in the world, the host's own first. Built once a frame. */
  players(): readonly CrowdPlayer[];
  /** The guest whose claim the host is applying right now (a kill, a cut), or null: the host's own doing, or the world's. */
  applying(): CrowdPlayer | null;
  /** The player in this lobby slot, if they are in the world. */
  bySlot(slot: number): CrowdPlayer | null;
  /** Host: what every guest's sonar may say has changed. */
  jam(state: JamState): void;
}

/** What a guest tells the host of itself that the host cannot see or hear from its pose. */
export type NoteKind = 'shots' | 'land' | 'slam' | 'pickup' | 'ping' | 'hurt' | 'reload' | 'blind';
export const NOTE_KINDS: readonly NoteKind[] = ['shots', 'land', 'slam', 'pickup', 'ping', 'hurt', 'reload', 'blind'];

export interface Note {
  kind: NoteKind;
  /** shots: how many since the last note. land: the impact. slam: its radius. hurt: the damage, with `left` the health left of 1. */
  n: number;
  /** shots: the weapon. pickup: its kind. hurt: what did it. */
  what: string;
  at: THREE.Vector3;
  left: number;
}

/** What the men read of one player's motion. */
export class Mind {
  readonly track = new TargetTrack();
  readonly stillAt = new THREE.Vector3();
  stillFor = 0;
  /** Footsteps: were their feet on the ground at the last listen, and how fast they were falling if not. */
  grounded = true;
  fall = 0;

  reset(): void {
    this.track.reset();
    this.stillFor = 0;
    this.grounded = true;
    this.fall = 0;
  }
}

/** The living player nearest `at` on the flat, or null with none alive. */
export function nearestOf(players: readonly CrowdPlayer[], at: THREE.Vector3): CrowdPlayer | null {
  let best: CrowdPlayer | null = null;
  let bestD = Infinity;
  for (let i = 0; i < players.length; i++) {
    const p = players[i]!;
    if (!p.player.alive) continue;
    const d = Math.hypot(p.player.position.x - at.x, p.player.position.z - at.z);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}
