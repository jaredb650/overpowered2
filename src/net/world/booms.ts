/**
 * Explosions on other screens. Every explosion a game makes goes out as `boom` (a guest's through the host) and is drawn and
 * heard elsewhere without damage. The host also works out what an enemy's blast does to each remote player (`hurt`,
 * targeting.ts). A guest's blast on the host's vehicles is a claim (claims.ts `vhit`), never this event.
 *
 * Three kinds of blast never go out as a `boom`:
 * - `cosmetic`: it is itself the copy of someone else's (a call-in flown here), so sending it on would echo it back;
 * - `mirrored`: every other screen flies its own copy of what made it (an airstrike's rockets, a gunship's rounds: callins.ts)
 *   and draws the blast there, on time with the round that lands;
 * - `worldObject`: the caller drew it. A map explosive's owner sends it with `show` (the barrels are world-a's); a call-in's
 *   are `mirrored` through its copy.
 *
 * The budget. A `boom` costs every other player an explosion to draw, so there is a cap a second. It is two buckets, so a
 * storm of small blasts cannot silence the ones that matter: `BOOMS_PER_SECOND` for anything, and `PRIORITY_PER_SECOND` more
 * that only a large blast, or one close to another player, may draw on once the first is empty. The host keeps a pair of
 * buckets for itself and one for each guest it relays, so one player's storm does not eat another's.
 */
import * as THREE from 'three';
import type { ExplosionKind } from '../../core/contracts';
import type { ExplosionSpec } from '../../core/gameplay';
import { EXPLOSIONS } from '../../weapons/data';
import type { WorldContext } from './context';
import type { Targeting } from './targeting';
import { validVec, type Vec } from './wire';

/** An explosion someone else's game made: drawn and heard here, never damaging (the host already counted it). */
export type BoomEvent = { t: 'boom'; at: Vec; kind: string; radius: number; slot?: number; scale?: number };

/** Explosions mirrored to other screens per second, of any size: a rotary of explosive rounds stays affordable. */
export const BOOMS_PER_SECOND = 24;
/** And this many more a second for the ones that matter: large, or close to another player. */
export const PRIORITY_PER_SECOND = 12;
/** A blast this wide is large: a rocket and up. */
export const LARGE_RADIUS = 5;
/** A blast within this many of its own radii of another player (and never less than `NEAR_FLOOR` m) is close to them. */
export const NEAR_RADII = 4;
export const NEAR_FLOOR = 14;

/** What `boom` may spend: a bucket for anything and a reserve for the blasts that matter. Refilled by the clock it is given. */
export class BoomBudget {
  private general = BOOMS_PER_SECOND;
  private reserve = PRIORITY_PER_SECOND;
  private last = -1;

  /** True when this blast may go out. `now` is in milliseconds. */
  spend(now: number, priority: boolean): boolean {
    if (this.last >= 0) {
      const seconds = Math.max(0, now - this.last) / 1000;
      this.general = Math.min(BOOMS_PER_SECOND, this.general + seconds * BOOMS_PER_SECOND);
      this.reserve = Math.min(PRIORITY_PER_SECOND, this.reserve + seconds * PRIORITY_PER_SECOND);
    }
    this.last = now;
    if (this.general >= 1) {
      this.general--;
      return true;
    }
    if (priority && this.reserve >= 1) {
      this.reserve--;
      return true;
    }
    return false;
  }
}

/** Large, or close to someone who would see it: the blasts kept when a second holds more than the budget. */
export function boomMatters(radius: number, nearest: number): boolean {
  return radius >= LARGE_RADIUS || nearest <= Math.max(NEAR_FLOOR, radius * NEAR_RADII);
}

const _at = new THREE.Vector3();

export class Booms {
  private readonly own = new BoomBudget();
  /** Host: one budget per guest whose blasts it passes on. */
  private readonly relayed = new Map<string, BoomBudget>();
  /** Booms left out for want of budget, for the proofs and the cost meter. */
  dropped = 0;

  constructor(private readonly w: WorldContext, private readonly targeting: Targeting) {
    w.router.both('boom', (value, from, now) => this.boomIn(value, from, now));
  }

  /** The local game made an explosion (Combat.explode). */
  blast(center: THREE.Vector3, spec: ExplosionSpec): void {
    const { session } = this.w;
    // A copy of someone else's blast is drawn here and goes no further: no `boom`, and it hurts no remote player.
    if (spec.cosmetic) return;
    // Every explosion this game makes is drawn on the others': the host's for everyone, a guest's through the host.
    if (!spec.worldObject && !spec.mirrored) this.send(center, spec.kind, spec.radius, spec.scale);
    if (!session.hosting || spec.team !== 'enemy') return;
    const def = EXPLOSIONS[spec.kind];
    for (const target of this.targeting.players()) {
      if (target.id === session.lobby.you || !target.player.alive) continue;
      const distance = target.player.eye.distanceTo(center);
      if (distance > spec.radius || (!def.ignoresCover && !this.w.visible(center.toArray() as Vec, target.player.eye.toArray() as Vec))) continue;
      this.targeting.hurt(target.id, { amount: spec.damage * (1 - distance / spec.radius * (1 - def.edgeDamage)), from: center, type: 'explosive', source: spec.source });
    }
  }

  /**
   * A blast for the other screens that combat did not make: a map explosive its owner drew itself, a prop going up. Drawn and
   * heard there with the explosion table's look for `kind`; it hurts nothing. For other lanes (`CoopWorld.boom`).
   */
  show(center: THREE.Vector3, kind: ExplosionKind, radius: number, scale?: number): void {
    this.send(center, kind, radius, scale);
  }

  private send(center: THREE.Vector3, kind: ExplosionKind, radius: number, scale: number | undefined): void {
    if (!this.w.ready) return;
    if (!this.own.spend(performance.now(), boomMatters(radius, this.nearestOther(center)))) {
      this.dropped++;
      return;
    }
    this.w.send({ t: 'boom', at: center.toArray() as Vec, kind, radius, slot: this.w.session.lobby.me?.slot,
      ...(scale !== undefined && scale !== 1 ? { scale } : {}) });
  }

  /** Metres from `at` to the nearest other player's body, or Infinity alone. */
  private nearestOther(at: THREE.Vector3, except?: string): number {
    const { ctx, session } = this.w;
    let best = Infinity;
    for (const [id, remote] of session.remotes) {
      if (id === except) continue;
      best = Math.min(best, remote.char.root.position.distanceTo(at));
    }
    // A relayed blast is also for the host's own eyes.
    if (except !== undefined) best = Math.min(best, ctx.player.position.distanceTo(at));
    return best;
  }

  /** Someone else's explosion, drawn and heard here. It hurts nobody: whatever it did, the host has already counted. */
  private boomIn(value: BoomEvent, from: string, now: number): void {
    const { ctx, session } = this.w;
    if (!validVec(value.at) || !Object.hasOwn(EXPLOSIONS, value.kind) || !Number.isFinite(value.radius) || value.radius <= 0 || value.radius > 60) return;
    const scale = Number.isFinite(value.scale) ? Math.min(4, Math.max(0.2, value.scale!)) : undefined;
    const at = _at.set(...value.at);
    if (session.hosting) {
      let budget = this.relayed.get(from);
      if (!budget) this.relayed.set(from, budget = new BoomBudget());
      if (!budget.spend(now, boomMatters(value.radius, this.nearestOther(at, from)))) {
        this.dropped++;
        return;
      }
      const slot = session.lobby.players.find(p => p.id === from)?.slot;
      this.w.relay({ t: 'boom', at: value.at, kind: value.kind, radius: value.radius, slot, ...(scale !== undefined ? { scale } : {}) }, from);
    }
    const kind = value.kind as ExplosionKind;
    // What a guest's blast does to the host's vehicles is a claim of its own (claims.ts `vhit`), not this drawing.
    ctx.fx.explosion(at, { radius: value.radius, kind, scale });
    for (const sound of EXPLOSIONS[kind as keyof typeof EXPLOSIONS].sounds) ctx.audio.play(sound.id, { ...sound, position: at });
    const near = ctx.player.eye.distanceTo(at);
    if (near < value.radius * 4) ctx.camera.addTrauma(0.35 * (1 - near / (value.radius * 4)));
  }

  /** A player left: their relay budget goes with them. */
  forgetPeer(id: string): void {
    this.relayed.delete(id);
  }
}
