/** What every call-in shares. */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import { mulberry32 } from '../../core/math';
import type { NewsKind } from './link';
import type { ModelMaterials } from '../modelkit';
import type { GroundProbe } from './ground';
import type { Ordnance } from './ordnance';

const _lifted = new THREE.Vector3();

/**
 * A blast point standing clear of the floor. combat.explode tests each victim with a ray from the blast, and a ray
 * that starts on the floor stops there, so a blast on the exact impact point reaches nobody at all.
 */
export function aboveFloor(p: THREE.Vector3): THREE.Vector3 {
  return _lifted.copy(p).setY(p.y + 0.7);
}

export interface StrikeKit {
  ctx: Ctx;
  probe: GroundProbe;
  materials: ModelMaterials;
  ordnance: Ordnance;
  /** The one Warthog airframe, hidden between runs. */
  jet: THREE.Group;
  /** Co-op: the HUD every player reads, on a copy's kit, whose own context keeps the caller's banners to the caller. See `everyone`. */
  all?: Ctx['hud'];
  /**
   * Co-op: this kit flies another player's call-in for the look (mirror.ts). Its context already hurts nothing (ghost.ts);
   * this is for the few things a strike does past it: a state written straight onto an enemy, a prompt for the player.
   */
  cosmetic?: boolean;
}

/**
 * A running call-in. The clock handed to `update` is time.realDt: strikes keep the first game's rhythm through SLOWMO,
 * and because rockets themselves fly on world time they pile up mid-air, which is the accident worth keeping.
 * It only ticks while playing, so pause holds a strike and `dispose` on a new run kills it.
 */
export interface Strike {
  /** Returns true once finished. */
  update(dt: number): boolean;
  /** Called when it finishes and when a run ends early: no more damage, nothing left in the scene. */
  dispose(): void;
  /** Co-op, on a copy: what its caller's own did that the order could not say (link.ts `CallNews`). */
  news?(kind: NewsKind, values: readonly number[]): void;
  /**
   * Where the thing a player would look at is now: the aircraft, the foot of the beam, the pod, the mark. The co-op proofs
   * compare a caller's with its copies' to see that every screen flies the same path.
   */
  readonly where: THREE.Vector3;
}

/**
 * Co-op, for a strike that does things its order cannot say (a steered beam, an aircraft's guns). The caller's own is given
 * `tell`, and says them as they happen; every other screen's copy is a `puppet`, which does none of it by itself and plays
 * what it is told through `Strike.news`. Alone, a strike gets neither.
 */
export interface StrikeNet {
  puppet?: boolean;
  tell?: Tell | null;
  /** On a copy: draws the flares its caller's aircraft threw, from where the copy is. */
  flares?: (from: THREE.Vector3) => void;
}
export type Tell = (kind: NewsKind, values?: number[]) => void;

/** Seconds between a caller's words on something that moves all the time: a pose, a steered point. */
export const TELL_EVERY = 0.1;

export interface StrikeOrder {
  point: THREE.Vector3;
  /** Unit XZ direction of travel. Only the Warthog uses it. */
  heading: THREE.Vector3;
  /**
   * What the strike rolls its scatter from (`mulberry32`). The manager draws a fresh one for every call; in co-op it goes to
   * the other players with the order, so every screen's copy lands its rounds on the same spots.
   */
  seed?: number;
  /** An angle the caller worked out from where they stood, given to a copy that cannot: the gunship's side of its circle, a pod's facing. */
  yaw?: number;
}

/** A strike's own generator, from its order's seed. An order made without one (a test's) gets a seed of its own. */
export const rngOf = (order: StrikeOrder): (() => number) => mulberry32(order.seed ?? Math.floor(Math.random() * 0x100000000));

/** The HUD for a banner that is every player's business (the nuke's countdown): shown by a co-op copy as by the caller's own. */
export const everyone = (kit: StrikeKit): Ctx['hud'] => kit.all ?? kit.ctx.hud;

/** `lo` to `hi` from a strike's own generator. */
export const roll = (rng: () => number, lo: number, hi: number): number => lo + rng() * (hi - lo);

/** Seconds after a pop before the flares will go again, so a double press does not throw two. */
export const FLARE_LOCKOUT = 3;

/**
 * A call-in that is an aircraft: the door gunner, the attack chopper and the gunship. Each is the player's to fly or an
 * AI's, and it is what the enemy's anti-air (`antiAir.ts`) shoots at.
 */
export interface Aircraft extends Strike {
  readonly position: THREE.Vector3;
  /** What every damage source it fires starts with, so a boss knows which aircraft is pounding it. */
  readonly sources: string;
  /** Missile hits left before it goes down. */
  hits: number;
  /** Flares left to throw at a missile. */
  flares: number;
  /** Small-arms rounds that land before it goes down. 0 on an airframe bullets cannot hurt. */
  rounds: number;
  /** The player is in the seat, or on the way to it. */
  readonly flown: boolean;
  /** The pilot or the crew throw its flares, not the player. */
  readonly autoFlares: boolean;
  /** Anti-air may lock it: up, not going down, and not a mission's fixed flight. */
  readonly huntable: boolean;
  /** Throws flares a player can see on its own. Otherwise anti-air draws them where it is. */
  readonly drawsFlares?: boolean;
  /** A missile reached it. True when that brought it down. */
  hit(): boolean;
  /** A round landed. True when that brought it down. */
  shot(): boolean;
  /** Flares out, if any are left and the last pop is `FLARE_LOCKOUT` behind. True when they went. */
  popFlares(): boolean;
  /** A burst from an enemy chopper landed. Helicopters only: the gunship flies far over them. */
  struck?(seconds: number): void;
  /** Down now: whoever is in the seat is back in the body, and the aircraft crashes. */
  down(): void;
}

export function isAircraft(strike: Strike): strike is Aircraft {
  return typeof (strike as Partial<Aircraft>).down === 'function';
}

/**
 * Tap or hold on a call-in key. A tap is a press let go inside `hold` seconds, a hold is one kept down that long. Feed it
 * the key every frame from the press on; it answers once and is then idle until the next `press`.
 */
export class TapOrHold {
  private t = -1;

  constructor(private readonly hold: number) {}

  get waiting(): boolean {
    return this.t >= 0;
  }

  press(): void {
    this.t = 0;
  }

  cancel(): void {
    this.t = -1;
  }

  update(dt: number, down: boolean): 'tap' | 'hold' | null {
    if (this.t < 0) return null;
    this.t += dt;
    if (!down) {
      this.t = -1;
      return 'tap';
    }
    if (this.t < this.hold) return null;
    this.t = -1;
    return 'hold';
  }
}
