/**
 * Small utility-AI framework.
 *
 * Two layers run side by side on every enemy:
 *  - Behaviours decide what the legs do. Each scores itself and the best one owns the movement intent.
 *  - Attacks decide what the hands do. They run on a wind-up, active, recover timeline and can overlap movement.
 *
 * A role is just a list of each. Maimed states need no special cases: they are behaviours and attacks whose
 * score or `requires` reads the enemy's remaining limbs, so losing an arm changes what is available.
 */
import type { Enemy } from './Enemy';
import type { AiWorld } from './aiWorld';

export interface Behaviour {
  readonly name: string;
  /** Desirability right now. Zero or less means unavailable. */
  score(e: Enemy, w: AiWorld): number;
  enter?(e: Enemy, w: AiWorld): void;
  /** Runs on the enemy's staggered think tick. */
  think?(e: Enemy, w: AiWorld): void;
  /** Runs every frame while active. Keep it to a few arithmetic operations. */
  frame?(e: Enemy, w: AiWorld, dt: number): void;
  exit?(e: Enemy, w: AiWorld): void;
  /** Seconds this behaviour stays selected before it can lose to a better score. Reads as commitment. */
  commit?: number;
}

export type AttackToken = 'ranged' | 'melee' | null;

export interface AttackDef {
  readonly name: string;
  /** Usable between these distances to the player. */
  readonly range: readonly [number, number];
  /** Needs a clear line to the player. */
  readonly los: boolean;
  /** Limited slot held for the whole attack. Keeps incoming damage readable. */
  readonly token: AttackToken;
  readonly cooldown: readonly [number, number];
  /** Telegraph length. Never zero for anything that hurts. */
  readonly windup: number;
  /** Time the attack stays in its active phase, or the shot spacing when `shots` is set. */
  readonly active: number;
  readonly recover: number;
  /** Multiplies move speed while the attack runs. */
  readonly moveMul: number;
  /** Fired this many times across the active phase. */
  readonly shots?: number;
  /** Higher wins when several attacks are available. */
  readonly weight?: number;
  /** Limb, armour or phase gate. Losing the gun arm removes gun attacks through this. */
  requires?(e: Enemy): boolean;
  /** Start of the wind-up: pose, audio and visual tell. */
  begin(e: Enemy, w: AiWorld): void;
  windupTick?(e: Enemy, w: AiWorld, dt: number): void;
  /** One shot or strike. `index` counts shots from zero. */
  fire(e: Enemy, w: AiWorld, index: number): void;
  activeTick?(e: Enemy, w: AiWorld, dt: number): void;
  /** Always runs when the attack stops, whether it finished or was interrupted. */
  end?(e: Enemy, w: AiWorld, interrupted: boolean): void;
  /**
   * Its shots are for show (a flame's globs: the damage is the host's to work out). In co-op only the first is sent; every
   * screen makes the rest from the same timeline.
   */
  readonly local?: boolean;
}

/** Co-op host: the attack events for the guests (net/world/attacks.ts). Null in single player, on a guest, and for a guest's copy. */
function net(w: AiWorld) {
  const coop = w.cosmetic ? undefined : w.ctx.coop;
  return coop?.hosting ? coop.world?.attacks ?? null : null;
}

export type AttackPhase = 'idle' | 'windup' | 'active' | 'recover';

/** Chooses the best behaviour on a think tick. */
export function thinkBehaviours(e: Enemy, w: AiWorld): void {
  const list = e.behaviours;
  const current = e.behaviour;
  const committed = current !== null && w.now < e.behaviourUntil;
  let best: Behaviour | null = current;
  let bestScore = current ? current.score(e, w) + (committed ? 10 : 0.08) : -Infinity;
  for (let i = 0; i < list.length; i++) {
    const b = list[i]!;
    if (b === current) continue;
    const s = b.score(e, w);
    if (s > bestScore && s > 0) {
      bestScore = s;
      best = b;
    }
  }
  if (bestScore <= 0) best = null;
  if (best !== current) setBehaviour(e, w, best);
  e.behaviour?.think?.(e, w);
}

export function setBehaviour(e: Enemy, w: AiWorld, b: Behaviour | null): void {
  e.behaviour?.exit?.(e, w);
  e.behaviour = b;
  e.behaviourUntil = b ? w.now + (b.commit ?? 0) : 0;
  b?.enter?.(e, w);
}

/** Starts the highest-weighted attack that is ready, if any. Runs on think ticks. */
export function thinkAttacks(e: Enemy, w: AiWorld): void {
  if (e.attackPhase !== 'idle' || w.now < e.attackReadyAt || e.airborne) return;
  const list = e.attacks;
  let best: AttackDef | null = null;
  let bestWeight = -Infinity;
  for (let i = 0; i < list.length; i++) {
    const a = list[i]!;
    if (w.now < (e.attackCooldowns.get(a) ?? 0)) continue;
    if (e.dist < a.range[0] || e.dist > a.range[1]) continue;
    if (a.los && !e.hasLos) continue;
    if (a.requires && !a.requires(e)) continue;
    const weight = (a.weight ?? 1) * (0.75 + Math.random() * 0.5);
    if (weight > bestWeight) {
      bestWeight = weight;
      best = a;
    }
  }
  if (!best) return;
  if (best.token && !w.director.acquire(e, best.token)) return;
  startAttack(e, w, best);
}

export function startAttack(e: Enemy, w: AiWorld, a: AttackDef): void {
  e.attack = a;
  e.attackPhase = 'windup';
  e.attackClock = 0;
  e.attackShots = 0;
  e.attackStage = 0;
  e.attackLate = 0;
  // Attacks from outside the player's view wait longer, so a hit in the back always had a chance to be heard.
  e.attackWindup = a.windup * (e.inView ? 1 : w.director.offscreenWindup);
  const guests = net(w);
  if (!guests) {
    a.begin(e, w);
    return;
  }
  guests.enter();
  try { a.begin(e, w); } finally { guests.leave(); }
  guests.began(e, a);
}

/** Advances the attack timeline by one frame. */
export function tickAttack(e: Enemy, w: AiWorld, dt: number): void {
  if (!e.attack) return;
  const guests = net(w);
  if (!guests) {
    tick(e, w, dt, null);
    return;
  }
  guests.enter();
  try { tick(e, w, dt, guests); } finally { guests.leave(); }
}

type Guests = NonNullable<ReturnType<typeof net>>;

/** One shot. In co-op what it spawns is gathered and sent with it. */
function shoot(e: Enemy, w: AiWorld, a: AttackDef, index: number, guests: Guests | null): void {
  if (!guests) {
    a.fire(e, w, index);
    return;
  }
  guests.firing();
  try { a.fire(e, w, index); } finally { guests.fired(e, a, index); }
}

function tick(e: Enemy, w: AiWorld, dt: number, guests: Guests | null): void {
  const a = e.attack;
  if (!a) return;
  e.attackClock += dt;
  e.attackLoop?.setPosition(e.center);
  if (e.attackPhase === 'windup') {
    a.windupTick?.(e, w, dt);
    if (e.attackClock >= e.attackWindup) {
      e.attackPhase = 'active';
      e.attackClock = 0;
      if (!a.shots) shoot(e, w, a, 0, guests);
    }
    return;
  }
  if (e.attackPhase === 'active') {
    a.activeTick?.(e, w, dt);
    if (e.attack !== a) return;
    if (a.shots) {
      while (e.attackShots < a.shots && e.attackClock >= e.attackShots * a.active) {
        shoot(e, w, a, e.attackShots++, guests);
        if (e.attack !== a) return;
      }
      if (e.attackShots >= a.shots) enterRecover(e);
    } else if (e.attackClock >= a.active) {
      enterRecover(e);
    }
    return;
  }
  if (e.attackPhase === 'recover' && e.attackClock >= a.recover) finishAttack(e, w, false);
}

function enterRecover(e: Enemy): void {
  e.attackPhase = 'recover';
  e.attackClock = 0;
}

export function finishAttack(e: Enemy, w: AiWorld, interrupted: boolean): void {
  const a = e.attack;
  if (!a) return;
  e.attack = null;
  e.attackPhase = 'idle';
  e.attackLoop?.stop(0.12);
  e.attackLoop = null;
  const guests = net(w);
  if (!guests) a.end?.(e, w, interrupted);
  else {
    guests.enter();
    try { a.end?.(e, w, interrupted); } finally { guests.leave(); }
    guests.ended(e, a, interrupted);
  }
  if (a.token) w.director.release(e, a.token);
  const [lo, hi] = a.cooldown;
  e.attackCooldowns.set(a, w.now + lo + Math.random() * (hi - lo));
  // A short shared gap stops one enemy chaining two different attacks back to back.
  e.attackReadyAt = w.now + (interrupted ? 0.6 : 0.15);
}
