/**
 * The Autoraffica's paint-then-snap smart aim (docs/proposals/weapons-wishlist.md section 2). Hold R to toggle SMART mode on or
 * off (off = plain 3-round burst). While SMART is on:
 * - At rest (`phase = 'idle'`), the 8° circle is shown with no passive lock.
 * - Click and hold left click with live visible head(s) in the circle (8° cone, 70 m range, line-of-sight checked) to paint them
 *   one at a time, nearest unpainted head to the crosshair first (`paintTime = 0.25 s` per head), playing an ascending lock beep
 *   per mark. Leaving the circle or losing line-of-sight while charging resets that head's charge.
 * - Letting go while still painting cancels all marks and fires nothing.
 * - Once every live visible head in the circle is marked (at least 1, or up to `maxMarks`), full-auto firing starts automatically
 *   at the smart spec's `interval` (800 RPM) into mark #1's head until dead, then a short `snapDelay` (~0.08 s) to mark #2, etc.,
 *   until all marked targets are dead or the magazine empties.
 * - Letting go while firing stops immediately and clears remaining marks.
 * - Clicking with no heads in the circle falls back to a plain single shot on pull (`status = 'plain'`).
 * - Akimbo: right and left guns alternate claiming painted heads and fire at their respective locked heads simultaneously.
 *
 * The rules only. `Weapons.ts` answers what is in the circle and in sight; this never touches the world.
 */
import * as THREE from 'three';
import type { EnemyInstance, MissileTarget, PaintView, SmartAimPhase, SmartAimView } from '../core/gameplay';

export const SMART_DEFAULTS = {
  /** Seconds held to paint one head. */
  paintTime: 0.25,
  /** Maximum painted heads per paint-then-snap sequence. */
  maxMarks: 6,
  /** Short snap pause (seconds) when advancing to the next marked head after a kill. */
  snapDelay: 0.08,
} as const;

export interface SmartSpec {
  /** Seconds R is held to switch it, as the Gimlet's selector. A shorter press reloads. */
  readonly hold: number;
  /** Radians off the crosshair a head may be and be painted: the circle on the HUD. */
  readonly cone: number;
  /** Legacy hysteresis factor kept on the data row. */
  readonly keep: number;
  /** Metres. */
  readonly range: number;
  /** Legacy tracking window kept on the data row. */
  readonly track: number;
  readonly rest: number;
  readonly grace: number;
  /** Seconds between rounds while drilling locked heads (800 RPM = 0.075 s). */
  readonly interval: number;
  /** Seconds to paint one head; defaults to `SMART_DEFAULTS.paintTime` (0.25 s). */
  readonly paintTime?: number;
  /** Max painted heads; defaults to `SMART_DEFAULTS.maxMarks` (6). */
  readonly maxMarks?: number;
  /** Snap delay (s) between consecutive marked kills; defaults to `SMART_DEFAULTS.snapDelay` (0.08 s). */
  readonly snapDelay?: number;
}

/** One painted head: implements `MissileTarget` so `LockMarkers` draws a lock bracket on it directly. */
export class SmartLock implements MissileTarget {
  enemy!: EnemyInstance;
  readonly center = new THREE.Vector3();
  /** Akimbo: true when assigned to the left gun. */
  left = false;

  get alive(): boolean {
    return this.enemy.alive;
  }
}

/** What the smart aim asks of the gun. */
export interface SmartHooks {
  /** The nearest live, visible head inside `cone` and `range` not already present in `painted`; null when none is. */
  lookUnpainted(cone: number, range: number, painted: readonly SmartLock[]): EnemyInstance | null;
  /** Whether `e`'s head is still alive, inside `cone` and `range`, and in plain sight. */
  holds(e: EnemyInstance, cone: number, range: number): boolean;
  /** Writes the middle of `e`'s head into `out`. */
  head(e: EnemyInstance, out: THREE.Vector3): void;
  /** A head finished painting (`count` is 1-based mark count, `left` is the akimbo hand that claimed it). */
  marked(e: EnemyInstance, count: number, left: boolean): void;
  /** Trigger released mid-paint: all marks cancelled without firing. */
  cancelled(): void;
}

/** Outcome of `SmartAim.update`, telling `Weapons.ts` whether to fall back to a plain shot or run smart auto-fire. */
export type SmartUpdateStatus = 'idle' | 'plain' | 'painting' | 'firing';

/** The left akimbo gun's smart-aim view: hidden at rest, tracks the left gun's painted/firing head while active. */
export class SmartAimLeft implements SmartAimView {
  constructor(private readonly owner: SmartAim) {}

  get on(): boolean {
    return this.owner.on && this.owner.akimbo;
  }

  get cone(): number {
    return this.owner.cone;
  }

  get phase(): SmartAimPhase {
    return this.owner.phase;
  }

  get charge(): number {
    return this.owner.leftCharge;
  }

  get chargingAt(): THREE.Vector3 | null {
    return this.owner.leftCharge > 0 ? this.owner.chargingAt : null;
  }

  get markCount(): number {
    return this.owner.markCount;
  }

  get target(): EnemyInstance | null {
    return this.owner.activeTarget(true);
  }

  get lock(): THREE.Vector3 | null {
    return this.owner.lockFor(true);
  }
}

const paintTimeOf = (s: SmartSpec) => s.paintTime ?? SMART_DEFAULTS.paintTime;
const maxMarksOf = (s: SmartSpec) => s.maxMarks ?? SMART_DEFAULTS.maxMarks;
const snapDelayOf = (s: SmartSpec) => s.snapDelay ?? SMART_DEFAULTS.snapDelay;

export class SmartAim implements SmartAimView, PaintView {
  on = false;
  akimbo = false;
  cone = 0;
  phase: SmartAimPhase = 'idle';
  /** 0..1 progress toward locking the head currently being painted. */
  charge = 0;
  max: number = SMART_DEFAULTS.maxMarks;
  readonly marks: SmartLock[] = [];
  readonly left: SmartAimLeft;

  /** Right (or single) gun's head target position as of the last update. */
  readonly head = new THREE.Vector3();
  /** Left akimbo gun's head target position as of the last update. */
  readonly leftHead = new THREE.Vector3();
  private readonly chargingHead = new THREE.Vector3();

  private readonly pool: SmartLock[] = [];
  private charging: EnemyInstance | null = null;
  /** Akimbo: hand that will claim the next completed mark (`false` = right, `true` = left). */
  private nextLeft = false;
  /** Currently targeted enemies while `phase === 'firing'`. */
  private curRight: EnemyInstance | null = null;
  private curLeft: EnemyInstance | null = null;
  /** Remaining snap delay (s) before each hand fires after advancing to a new head. */
  private snapRight = 0;
  private snapLeft = 0;
  /** True after a firing sequence finishes naturally while LMB is still held, preventing a stray shot until release. */
  private waitRelease = false;

  constructor() {
    this.left = new SmartAimLeft(this);
  }

  get painting(): boolean {
    return this.on && this.phase === 'painting';
  }

  get markCount(): number {
    return this.marks.length;
  }

  get chargingAt(): THREE.Vector3 | null {
    return this.on && this.phase === 'painting' && this.charging !== null && this.charging.alive ? this.chargingHead : null;
  }

  get leftCharge(): number {
    return this.on && this.akimbo && this.phase === 'painting' && this.charging !== null && this.nextLeft ? this.charge : 0;
  }

  /** Right (or single) gun's currently locked or charging enemy, or null. */
  get target(): EnemyInstance | null {
    return this.activeTarget(false);
  }

  /** Right (or single) gun's aim point while painting or firing; null at rest. */
  get lock(): THREE.Vector3 | null {
    return this.lockFor(false);
  }

  /** Enemy targeted by `left` hand (charging, latest hand mark, or active firing target), or null at rest. */
  activeTarget(left: boolean): EnemyInstance | null {
    if (!this.on || this.phase === 'idle') return null;
    if (left && !this.akimbo) return null;
    if (this.phase === 'firing') {
      const own = left ? this.curLeft : this.curRight;
      if (own?.alive) return own;
      const other = left ? this.curRight : this.curLeft;
      return other?.alive ? other : null;
    }
    // Painting phase:
    if (left) {
      if (this.charging?.alive && this.nextLeft) return this.charging;
      for (let i = this.marks.length - 1; i >= 0; i--) {
        if (this.marks[i]!.left && this.marks[i]!.alive) return this.marks[i]!.enemy;
      }
      return null;
    }
    if (this.charging?.alive && (!this.akimbo || !this.nextLeft)) return this.charging;
    for (let i = this.marks.length - 1; i >= 0; i--) {
      if (!this.marks[i]!.left && this.marks[i]!.alive) return this.marks[i]!.enemy;
    }
    return this.charging?.alive ? this.charging : this.marks.length > 0 && this.marks[0]!.alive ? this.marks[0]!.enemy : null;
  }

  /** Live world-space head vector for `left` hand while active, or null at rest. */
  lockFor(left: boolean): THREE.Vector3 | null {
    if (!this.on || this.phase === 'idle') return null;
    if (left && !this.akimbo) return null;
    if (!this.activeTarget(left)) return null;
    return left ? this.leftHead : this.head;
  }

  /**
   * The enemy `left` hand may fire into right now during `phase === 'firing'`, or null if waiting out its `snapDelay` or idle.
   */
  readyTarget(left: boolean): EnemyInstance | null {
    if (!this.on || this.phase !== 'firing') return null;
    if (left && !this.akimbo) return null;
    if (left ? this.snapLeft > 0 : this.snapRight > 0) return null;
    const own = left ? this.curLeft : this.curRight;
    if (own?.alive) return own;
    const other = left ? this.curRight : this.curLeft;
    return other?.alive ? other : null;
  }

  /**
   * Advances the smart-aim state machine by `dt`.
   * - `pressed`: trigger was pulled this frame (or buffered while held).
   * - `held`: trigger is currently down.
   * - `canShoot`: magazine has at least one round (or bottomless).
   */
  update(
    dt: number,
    spec: SmartSpec,
    pressed: boolean,
    held: boolean,
    canShoot: boolean,
    hooks: SmartHooks,
  ): SmartUpdateStatus {
    this.cone = spec.cone;
    this.max = maxMarksOf(spec);
    if (!held) this.waitRelease = false;
    if (!this.on) {
      this.drop();
      return 'idle';
    }

    if (this.phase === 'idle') {
      if (this.waitRelease) return 'idle';
      if (!pressed) return 'idle';
      if (!canShoot) return 'plain';
      const first = hooks.lookUnpainted(spec.cone, spec.range, this.marks);
      if (!first) return 'plain';
      // Start painting the nearest visible head inside the circle.
      this.phase = 'painting';
      this.charging = first;
      this.charge = 0;
      this.nextLeft = false;
      hooks.head(first, this.chargingHead);
      if (!held) {
        // Released on the very same frame: cancel without firing.
        this.cancelPainting(hooks);
        return 'idle';
      }
      return this.stepPainting(dt, spec, hooks);
    }

    if (this.phase === 'painting') {
      if (!held) {
        this.cancelPainting(hooks);
        return 'idle';
      }
      return this.stepPainting(dt, spec, hooks);
    }

    // phase === 'firing'
    if (!held) {
      this.clearAll();
      return 'idle';
    }
    if (this.snapRight > 0) this.snapRight = Math.max(0, this.snapRight - dt);
    if (this.snapLeft > 0) this.snapLeft = Math.max(0, this.snapLeft - dt);
    return this.advanceTargets(spec, hooks);
  }

  /** Called right after a smart-aimed shot fires so a kill immediately advances to the next mark with `snapDelay`. */
  afterShot(spec: SmartSpec, hooks: SmartHooks): void {
    if (this.phase !== 'firing') return;
    this.advanceTargets(spec, hooks);
  }

  /** Ends firing cleanly (e.g. magazine emptied mid-sequence) and waits for trigger release before starting again. */
  finish(): void {
    this.clearAll();
    this.waitRelease = true;
  }

  /** Lets go of everything: switched off, reloaded, holstered, the gun put away, or a new run. */
  drop(): void {
    this.clearAll();
    this.waitRelease = false;
  }

  private stepPainting(dt: number, spec: SmartSpec, hooks: SmartHooks): SmartUpdateStatus {
    this.pruneAndRefreshMarks(hooks);

    // If the head currently charging died, left the circle, or went behind cover, its charge resets.
    if (this.charging && (!this.charging.alive || !hooks.holds(this.charging, spec.cone, spec.range))) {
      this.charging = null;
      this.charge = 0;
    }

    if (!this.charging) {
      const next = this.marks.length < this.max ? hooks.lookUnpainted(spec.cone, spec.range, this.marks) : null;
      if (next) {
        this.charging = next;
        this.charge = 0;
        hooks.head(next, this.chargingHead);
      } else if (this.marks.length > 0) {
        // Every live visible head in the circle is marked (or cap reached): start drilling them automatically.
        this.beginFiring(hooks);
        return 'firing';
      } else {
        // Still holding trigger, waiting for a head to enter the circle.
        this.syncPaintHeads(hooks);
        return 'painting';
      }
    }

    hooks.head(this.charging, this.chargingHead);
    const pt = paintTimeOf(spec);
    this.charge = pt > 0 ? Math.min(1, this.charge + dt / pt) : 1;

    if (this.charge >= 1 - 1e-6) {
      const enemy = this.charging;
      const left = this.akimbo ? this.nextLeft : false;
      if (this.akimbo) this.nextLeft = !this.nextLeft;
      const slot = this.pool[this.marks.length] ?? (this.pool[this.marks.length] = new SmartLock());
      slot.enemy = enemy;
      slot.left = left;
      hooks.head(enemy, slot.center);
      this.marks.push(slot);
      this.charging = null;
      this.charge = 0;
      hooks.marked(enemy, this.marks.length, left);

      const more = this.marks.length < this.max ? hooks.lookUnpainted(spec.cone, spec.range, this.marks) : null;
      if (more) {
        this.charging = more;
        this.charge = 0;
        hooks.head(more, this.chargingHead);
        this.syncPaintHeads(hooks);
        return 'painting';
      }
      this.beginFiring(hooks);
      return 'firing';
    }

    this.syncPaintHeads(hooks);
    return 'painting';
  }

  private beginFiring(hooks: SmartHooks): void {
    this.phase = 'firing';
    this.charging = null;
    this.charge = 0;
    this.snapRight = 0;
    this.snapLeft = 0;
    this.curRight = this.firstAlive(false) ?? this.firstAlive(true);
    this.curLeft = this.akimbo ? (this.firstAlive(true) ?? this.curRight) : null;
    this.syncFiringHeads(hooks);
  }

  private advanceTargets(spec: SmartSpec, hooks: SmartHooks): SmartUpdateStatus {
    this.pruneAndRefreshMarks(hooks);
    if (this.marks.length === 0) {
      this.finish();
      return 'idle';
    }

    const prevRight = this.curRight;
    if (!this.curRight || !this.curRight.alive) {
      const nextR = this.firstAlive(false) ?? this.firstAlive(true);
      if (prevRight && nextR && nextR !== prevRight) this.snapRight = snapDelayOf(spec);
      this.curRight = nextR;
    }

    if (this.akimbo) {
      const prevLeft = this.curLeft;
      if (!this.curLeft || !this.curLeft.alive) {
        const nextL = this.firstAlive(true) ?? this.curRight;
        if (prevLeft && nextL && nextL !== prevLeft) this.snapLeft = snapDelayOf(spec);
        this.curLeft = nextL;
      }
    } else {
      this.curLeft = null;
      this.snapLeft = 0;
    }

    this.syncFiringHeads(hooks);
    return 'firing';
  }

  private firstAlive(left: boolean): EnemyInstance | null {
    for (let i = 0; i < this.marks.length; i++) {
      const m = this.marks[i]!;
      if (m.left === left && m.alive) return m.enemy;
    }
    return null;
  }

  private pruneAndRefreshMarks(hooks: SmartHooks): void {
    let w = 0;
    for (let i = 0; i < this.marks.length; i++) {
      const m = this.marks[i]!;
      if (!m.alive) continue;
      hooks.head(m.enemy, m.center);
      this.marks[w++] = m;
    }
    this.marks.length = w;
  }

  private syncPaintHeads(hooks: SmartHooks): void {
    const r = this.activeTarget(false);
    if (r) hooks.head(r, this.head);
    if (this.akimbo) {
      const l = this.activeTarget(true);
      if (l) hooks.head(l, this.leftHead);
    }
  }

  private syncFiringHeads(hooks: SmartHooks): void {
    const r = this.activeTarget(false);
    if (r) hooks.head(r, this.head);
    if (this.akimbo) {
      const l = this.activeTarget(true);
      if (l) hooks.head(l, this.leftHead);
    }
  }

  private cancelPainting(hooks: SmartHooks): void {
    const hadActivity = this.marks.length > 0 || this.charging !== null;
    this.clearAll();
    if (hadActivity) hooks.cancelled();
  }

  private clearAll(): void {
    this.phase = 'idle';
    this.charge = 0;
    this.charging = null;
    this.marks.length = 0;
    this.nextLeft = false;
    this.curRight = null;
    this.curLeft = null;
    this.snapRight = 0;
    this.snapLeft = 0;
  }
}
