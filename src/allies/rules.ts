/**
 * The allies' rules as plain arithmetic, with no game state, so each can be tested on its own: where a follower stands, who an
 * enemy shoots, what the crosshair says, what one press of E means, and what a hit does to a man.
 */
import { ALLY } from './data';

/**
 * Where follower `index` of `count` stands: a fan behind the player, `ALLY.followNear` to `ALLY.followFar` back, alternating
 * sides so the first two flank him. `fx, fz` is the player's flat facing.
 */
export function followSlot(index: number, count: number, px: number, pz: number, fx: number, fz: number, out: { x: number; z: number }): void {
  const len = Math.hypot(fx, fz) || 1;
  const bx = -fx / len, bz = -fz / len;
  const side = index % 2 === 0 ? 1 : -1;
  const rank = Math.floor(index / 2);
  const ranks = Math.max(1, Math.ceil(count / 2));
  const back = ALLY.followNear + (ALLY.followFar - ALLY.followNear) * (ranks > 1 ? rank / (ranks - 1) : 0);
  // 35 degrees off the line behind for the first pair, wider for each pair after, so nobody stands in the player's back.
  const angle = side * (0.6 + rank * 0.22);
  const c = Math.cos(angle), s = Math.sin(angle);
  out.x = px + (bx * c - bz * s) * back;
  out.z = pz + (bz * c + bx * s) * back;
}

/** What the reticle shows. The nearer of the two bodies wins, and nothing shows through a wall. Distances are Infinity for none. */
export function crosshairRead(enemyAt: number, allyAt: number, wallAt: number): 'hostile' | 'friendly' | null {
  const near = Math.min(enemyAt, allyAt);
  if (!Number.isFinite(near) || wallAt < near) return null;
  return allyAt < enemyAt ? 'friendly' : 'hostile';
}

/** An enemy soldier turns his gun on an ally he can see when he has no sight of the player, or the ally is the nearer. */
export function prefersAlly(seesPlayer: boolean, playerDist: number, allyDist: number): boolean {
  return !seesPlayer || allyDist < playerDist;
}

export type Gesture = 'tap' | 'hold' | 'revive' | null;

/**
 * One key, three meanings: a tap, a hold, and a longer hold on a downed man. A hold fires once, while the key is still down,
 * so the squad answers before the key comes up.
 */
export class OrderKey {
  /** Seconds the key has been down, or -1 when it is up or already spent. */
  held = -1;

  /** `reviving`: the man in front is down, so the hold means revive, and runs to `ALLY.revive`. */
  update(dt: number, pressed: boolean, down: boolean, reviving: boolean): Gesture {
    if (pressed) this.held = 0;
    if (this.held < 0) return null;
    if (down) {
      this.held += dt;
      if (reviving ? this.held >= ALLY.revive : this.held >= ALLY.hold) {
        this.held = -1;
        return reviving ? 'revive' : 'hold';
      }
      return null;
    }
    // Let go before the hold landed. On a downed man that is a revive given up, not an order.
    this.held = -1;
    return reviving ? null : 'tap';
  }

  /** 0..1 of the way through a hold, for the prompt. */
  progress(reviving: boolean): number {
    return this.held < 0 ? 0 : Math.min(1, this.held / (reviving ? ALLY.revive : ALLY.hold));
  }
}

export interface Vitals {
  health: number;
  maxHealth: number;
  state: 'up' | 'down' | 'dead';
}

/**
 * What a hit does to an ally, after the wound system has priced it. `floors` is a wound that puts a man on the ground whatever
 * his health. A man on his feet goes down rather than dying, unless one hit is overwhelming: that is what makes him worth
 * reviving. On the ground he lies on a small pool, and a hit that empties it kills him.
 */
export function takeHit(v: Vitals, amount: number, floors: boolean): 'none' | 'down' | 'dead' {
  if (v.state === 'dead' || amount <= 0) return 'none';
  if (v.state === 'down') {
    v.health -= amount;
    if (v.health > 0) return 'none';
    v.state = 'dead';
    return 'dead';
  }
  if (amount >= v.maxHealth * ALLY.overwhelming) {
    v.health = 0;
    v.state = 'dead';
    return 'dead';
  }
  v.health -= amount;
  if (v.health > 0 && !floors) return 'none';
  v.state = 'down';
  v.health = v.maxHealth * ALLY.downPool;
  return 'down';
}

/** Back on his feet with half his health. Only a downed man can be revived: a dead one stays dead. */
export function revive(v: Vitals): boolean {
  if (v.state !== 'down') return false;
  v.state = 'up';
  v.health = v.maxHealth * ALLY.reviveHealth;
  return true;
}

/** Whether the player can revive, and what it costs. No stim kit on this page: free, until stims land everywhere. */
export function reviveCost(kit: { count: number } | null): 'free' | 'stim' | 'none' {
  if (!kit) return 'free';
  return kit.count > 0 ? 'stim' : 'none';
}
