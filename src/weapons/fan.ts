/**
 * The Judge's fanning (docs/proposals/weapons-update.md section 5). Hold right click: a bar fills every `perBar`, up to
 * `bars`, never more than are loaded, and while it is held the crosshair paints locks on heads. A head takes a lock the
 * moment it is under the crosshair; held there `stack` seconds longer it takes another, so a full charge on one man is
 * three locks on him. Locks never outnumber the bars. Let go and the hammer is fanned at once, a shot a bar, `gap` apart:
 * the locks first, in the order painted, each into its man's head; any bar left without a lock fires down the crosshair.
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
  /** Seconds the crosshair stays on a locked man before he takes another lock. */
  readonly stack: number;
  /** Seconds between two fanned shots. */
  readonly gap: number;
  /** Radians off the crosshair a head may be and still take a lock, and how far away. */
  readonly cone: number;
  readonly range: number;
  /** Seconds after the last fanned shot before the gun fires again. */
  readonly recover: number;
  /** The world's time scale from the release to the last shot. The player's clock is not slowed. */
  readonly slow: number;
}

/** A lock as the HUD's markers draw it: `center` is his head, kept up to date while the lock lives. */
export interface FanLock {
  enemy: EnemyInstance;
  readonly center: THREE.Vector3;
  readonly alive: boolean;
}

/** What the fan asks of the gun. */
export interface FanHooks {
  /** The head nearest the crosshair in `cone` and in sight, or null. */
  look(): EnemyInstance | null;
  /** Writes the middle of his head into `out`. */
  head(e: EnemyInstance, out: THREE.Vector3): void;
  /** A bar filled: `n` charged now, of `cap` it can reach. */
  bar(n: number, cap: number): void;
  /** A lock painted: `n` locks now, `onHim` of them on this man. */
  lock(n: number, onHim: number): void;
  /** Let go with bars charged: the fan starts, with the locks still in `marks`. */
  release(): void;
  /** One fanned shot: into this lock's head, or down the crosshair when null. */
  shoot(lock: FanLock | null): void;
  /** The last shot is gone, or the fan was let go of. */
  end(): void;
}

export type FanPhase = 'idle' | 'charge' | 'fire';

export class Fan implements PaintView {
  phase: FanPhase = 'idle';
  /** Bars charged. */
  bars = 0;
  /** 0 to 1 toward the next bar while charging. */
  progress = 0;
  /** Locks in the order painted, a man once per lock on him. A shot takes its lock off the front. */
  readonly marks: FanLock[] = [];
  /** Shots still to go in the fan. */
  private left = 0;
  private readonly pool: FanLock[] = [];
  private clock = 0;
  /** The man under the crosshair, and seconds since he took his last lock. */
  private on: EnemyInstance | null = null;
  private dwell = 0;
  /** A right press not yet taken: one made while the gun was still recovering starts the charge once it can. */
  private armed = false;
  private spec: FanSpec | null = null;

  /** The HUD draws the locks from the first bar to the last shot. */
  get painting(): boolean {
    return this.phase === 'fire' || (this.phase === 'charge' && this.bars > 0);
  }

  get max(): number {
    return this.bars;
  }

  /** The bar by the crosshair while charging, 0 to 1 of all `bars`. */
  get bar(): number {
    const t = this.spec;
    return t && this.phase === 'charge' ? (this.bars + this.progress) / t.bars : 0;
  }

  get busy(): boolean {
    return this.phase !== 'idle';
  }

  /** Lets the fan go with nothing fired. Weapons ends the slow motion and the loop itself when it calls this. */
  cancel(): void {
    this.phase = 'idle';
    this.bars = 0;
    this.progress = 0;
    this.left = 0;
    this.on = null;
    while (this.marks.length > 0) this.unmark(this.marks.length - 1);
  }

  /**
   * One frame of the gun `t`. `pressed` and `held` are the right button, `loaded` the rounds in the cylinder, `ready`
   * false while the gun is still recovering from a shot.
   */
  update(dt: number, t: FanSpec, pressed: boolean, held: boolean, loaded: number, ready: boolean, h: FanHooks): void {
    this.spec = t;
    // A man who dies gives his locks back: the bars are free to paint someone else, or to fire down the crosshair.
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const m = this.marks[i]!;
      if (!m.alive) this.unmark(i);
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
        this.on = null;
      // falls through: the press frame charges too
      case 'charge': {
        if (!held) {
          if (this.bars === 0) {
            this.cancel();
            h.end();
            return;
          }
          this.phase = 'fire';
          this.left = this.bars;
          this.clock = 0;
          h.release();
          this.fire(dt, t, h);
          return;
        }
        const cap = Math.min(t.bars, loaded);
        this.progress += dt / t.perBar;
        while (this.progress >= 1 && this.bars < cap) {
          this.progress -= 1;
          h.bar(++this.bars, cap);
        }
        if (this.bars >= cap) this.progress = 0;
        this.paint(dt, t, h);
        return;
      }
      case 'fire':
        this.fire(dt, t, h);
    }
  }

  private paint(dt: number, t: FanSpec, h: FanHooks): void {
    const e = h.look();
    if (e !== this.on) {
      this.on = e;
      this.dwell = 0;
    } else this.dwell += dt;
    if (!e || this.marks.length >= this.bars) return;
    const lock = this.lockOf(e);
    if (lock && this.dwell < t.stack) return;
    const l = lock ?? this.pool.pop() ?? { enemy: e, center: new THREE.Vector3(), get alive() { return this.enemy.alive; } };
    l.enemy = e;
    h.head(e, l.center);
    this.marks.push(l);
    this.dwell = 0;
    let onHim = 0;
    for (let i = 0; i < this.marks.length; i++) if (this.marks[i] === l) onHim++;
    h.lock(this.marks.length, onHim);
  }

  /** A shot on the release frame, then one every `gap`: locks first, then the bars nobody was painted for. */
  private fire(dt: number, t: FanSpec, h: FanHooks): void {
    this.clock -= dt;
    while (this.clock <= 0 && this.left > 0) {
      const lock = this.marks.length > 0 ? this.marks[0]! : null;
      if (lock) this.unmark(0);
      this.left--;
      h.shoot(lock);
      this.clock += t.gap;
    }
    if (this.left > 0) return;
    this.cancel();
    h.end();
  }

  private lockOf(e: EnemyInstance): FanLock | null {
    for (let i = 0; i < this.marks.length; i++) if (this.marks[i]!.enemy === e) return this.marks[i]!;
    return null;
  }

  /** Takes mark `i` out, and the lock object back to the pool once no mark holds it. */
  private unmark(i: number): void {
    const l = this.marks.splice(i, 1)[0]!;
    if (!this.marks.includes(l)) this.pool.push(l);
  }
}
