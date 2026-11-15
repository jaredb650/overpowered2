/**
 * The Judge's fanning (docs/proposals/weapons-update.md section 5): hold right click to charge up to three bars, a round
 * each, never more than are loaded. Let go and the bars drain; every head the crosshair passes over in that time takes a
 * lock, one a bar, one a man. When the bars run out, or every bar has its lock, the hammer is fanned: a headshot at each
 * lock in the order painted, `gap` apart. No lock, no shot and no round spent.
 *
 * The rules only. `Weapons.ts` answers what is under the crosshair and fires; this never touches the world.
 */
import * as THREE from 'three';
import type { EnemyInstance, PaintView } from '../core/gameplay';

export interface FanSpec {
  /** Bars at most, a round each. */
  readonly bars: number;
  /** Seconds of holding a bar takes. */
  readonly perBar: number;
  /** Seconds the bars drain over once let go: the time to paint the locks. */
  readonly drain: number;
  /** Seconds between two fanned shots. */
  readonly gap: number;
  /** Radians off the crosshair a head may be and still take a lock, and how far away. */
  readonly cone: number;
  readonly range: number;
  /** Seconds after the last fanned shot before the gun fires again. */
  readonly recover: number;
}

/** A lock as the HUD's markers draw it: `center` is his head, kept up to date while the lock lives. */
export interface FanLock {
  enemy: EnemyInstance;
  readonly center: THREE.Vector3;
  readonly alive: boolean;
}

/** What the fan asks of the gun. */
export interface FanHooks {
  /** The head nearest the crosshair in `cone` and in sight that is not in `locked`, or null. */
  look(locked: readonly FanLock[]): EnemyInstance | null;
  /** Writes the middle of his head into `out`. */
  head(e: EnemyInstance, out: THREE.Vector3): void;
  /** A bar filled: `n` charged now. */
  bar(n: number): void;
  /** Let go with bars charged: the drain starts. */
  release(): void;
  /** Every frame of the drain, 0 at the release to 1 when it runs out. */
  drain(k: number): void;
  /** A lock painted: `n` locks now. */
  lock(n: number): void;
  /** One fanned shot at this lock. */
  shoot(lock: FanLock): void;
  /** The fan is over, fired or not (`fired` false: no lock, nothing spent). */
  end(fired: boolean): void;
}

export type FanPhase = 'idle' | 'charge' | 'drain' | 'fire';

function makeLock(enemy: EnemyInstance): FanLock {
  return { enemy, center: new THREE.Vector3(), get alive() { return this.enemy.alive; } };
}

export class Fan implements PaintView {
  phase: FanPhase = 'idle';
  /** Bars charged. */
  bars = 0;
  /** 0 to 1 toward the next bar while charging. */
  progress = 0;
  /** Seconds of drain left. */
  left = 0;
  /** Live locks in the order painted. A shot fired takes its lock off the front. */
  readonly marks: FanLock[] = [];
  private readonly pool: FanLock[] = [];
  private clock = 0;
  /** A right press not yet taken: one made while the gun was still recovering starts the charge once it can. */
  private armed = false;
  private spec: FanSpec | null = null;

  /** The HUD draws the locks from the release to the last shot. */
  get painting(): boolean {
    return this.phase === 'drain' || this.phase === 'fire';
  }

  get max(): number {
    return this.bars;
  }

  /** The bar by the crosshair, 0 to 1 of all `bars`: filling while held, draining after. */
  get bar(): number {
    const t = this.spec;
    if (!t) return 0;
    if (this.phase === 'charge') return (this.bars + this.progress) / t.bars;
    if (this.phase === 'drain') return (this.bars / t.bars) * (this.left / t.drain);
    return 0;
  }

  get busy(): boolean {
    return this.phase !== 'idle';
  }

  cancel(): void {
    this.phase = 'idle';
    this.bars = 0;
    this.progress = 0;
    this.left = 0;
    this.release();
  }

  /**
   * One frame of the gun `t`. `pressed` and `held` are the right button, `loaded` the rounds in the cylinder, `ready`
   * false while the gun is still recovering from a shot.
   */
  update(dt: number, t: FanSpec, pressed: boolean, held: boolean, loaded: number, ready: boolean, h: FanHooks): void {
    this.spec = t;
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const m = this.marks[i]!;
      if (!m.alive) this.free(i);
      else h.head(m.enemy, m.center);
    }
    switch (this.phase) {
      case 'idle':
        if (pressed) this.armed = true;
        if (!held) this.armed = false;
        if (!this.armed || !ready || loaded <= 0) return;
        this.armed = false;
        this.phase = 'charge';
        this.bars = 0;
        this.progress = 0;
      // falls through: the press frame charges too
      case 'charge': {
        const cap = Math.min(t.bars, loaded);
        if (held) {
          this.progress += dt / t.perBar;
          while (this.progress >= 1 && this.bars < cap) {
            this.progress -= 1;
            h.bar(++this.bars);
          }
          // Full, or nothing more loaded to charge: it holds at that.
          if (this.bars >= cap) this.progress = 0;
          return;
        }
        if (this.bars === 0) {
          this.cancel();
          return;
        }
        this.phase = 'drain';
        this.progress = 0;
        this.left = t.drain;
        h.release();
      }
      // falls through: the release frame can already paint
      case 'drain': {
        this.left = Math.max(0, this.left - dt);
        h.drain(1 - this.left / t.drain);
        if (this.marks.length < this.bars) {
          const e = h.look(this.marks);
          if (e) {
            const lock = this.pool.pop() ?? makeLock(e);
            lock.enemy = e;
            h.head(e, lock.center);
            this.marks.push(lock);
            h.lock(this.marks.length);
          }
        }
        if (this.left > 0 && this.marks.length < this.bars) return;
        if (this.marks.length === 0) {
          this.cancel();
          h.end(false);
          return;
        }
        // The first slap comes a gap after the last lock, so the locks are seen for a moment before they go.
        this.phase = 'fire';
        this.clock = t.gap;
        return;
      }
      case 'fire':
        this.clock -= dt;
        while (this.clock <= 0 && this.marks.length > 0) {
          const lock = this.marks[0]!;
          this.free(0);
          h.shoot(lock);
          this.clock += t.gap;
        }
        if (this.marks.length > 0) return;
        this.cancel();
        h.end(true);
    }
  }

  private free(i: number): void {
    this.pool.push(this.marks.splice(i, 1)[0]!);
  }

  private release(): void {
    while (this.marks.length > 0) this.free(this.marks.length - 1);
  }
}
