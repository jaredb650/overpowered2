/**
 * The Autoraffica's smart aim (docs/proposals/weapons-update.md section 14). Hold R to switch it on or off. While it is on, the
 * head nearest the crosshair inside a circle of `cone` radians, in `range` and in plain sight, takes the lock: the crosshair
 * snaps onto it and follows it, and every round goes into that head. The lock holds while he lives, stays in sight and
 * inside `keep` times the circle; out of sight or out of the circle it lasts `grace` more. It never jumps to a nearer head
 * while it holds. After `track` seconds on one man it lets him go, and he cannot be locked again for `rest`, so it moves on
 * to whoever else is in the circle. A man who dies hands the lock on at once, so the rest of a burst goes to the next.
 *
 * The rules only. `Weapons.ts` answers what is in the circle and in sight; this never touches the world.
 */
import * as THREE from 'three';
import type { EnemyInstance, SmartAimView } from '../core/gameplay';

export interface SmartSpec {
  /** Seconds R is held to switch it, as the Gimlet's selector. A shorter press reloads. */
  readonly hold: number;
  /** Radians off the crosshair a head may be and take the lock: the circle on the HUD. */
  readonly cone: number;
  /** A lock holds out to this many times `cone`, so a head on the circle's edge does not flicker in and out. */
  readonly keep: number;
  /** Metres. */
  readonly range: number;
  /** Seconds the lock stays on one man at most, and seconds he is passed over after. */
  readonly track: number;
  readonly rest: number;
  /** Seconds a lock outlives losing sight of him or leaving the circle. */
  readonly grace: number;
  /** Seconds between rounds while a held trigger fires full auto at locked heads. */
  readonly interval: number;
}

/** What the smart aim asks of the gun. */
export interface SmartHooks {
  /** The head nearest the crosshair inside `cone`, in range and in sight, other than `skip`; null when none is. */
  look(cone: number, skip: EnemyInstance | null): EnemyInstance | null;
  /** Whether his head is still inside `cone`, in range and in sight. */
  holds(e: EnemyInstance, cone: number): boolean;
  /** Writes the middle of his head into `out`. */
  head(e: EnemyInstance, out: THREE.Vector3): void;
  /** A new lock was taken. */
  locked(e: EnemyInstance): void;
}

export class SmartAim implements SmartAimView {
  on = false;
  cone = 0;
  /** The locked man, or null. */
  target: EnemyInstance | null = null;
  /** His head, as of the last update. */
  readonly head = new THREE.Vector3();
  /** Seconds on this man, and seconds he has been out of sight or out of the circle. */
  private held = 0;
  private lost = 0;
  /** The man last let go of after `track`, and seconds before he can be locked again. */
  private spent: EnemyInstance | null = null;
  private spentFor = 0;

  get lock(): THREE.Vector3 | null {
    return this.on && this.target ? this.head : null;
  }

  update(dt: number, spec: SmartSpec, hooks: SmartHooks): void {
    this.cone = spec.cone;
    if (this.spentFor > 0 && (this.spentFor -= dt) <= 0) this.spent = null;
    let t = this.target;
    if (t) {
      this.held += dt;
      if (!t.alive) t = null;
      else if (this.held >= spec.track) {
        this.spent = t;
        this.spentFor = spec.rest;
        t = null;
      } else if (hooks.holds(t, spec.cone * spec.keep)) this.lost = 0;
      else if ((this.lost += dt) > spec.grace) t = null;
    }
    if (!t) {
      t = hooks.look(spec.cone, this.spent);
      if (t) {
        this.held = 0;
        this.lost = 0;
        hooks.locked(t);
      }
    }
    this.target = t;
    if (t) hooks.head(t, this.head);
  }

  /** Lets go of everything: switched off, the gun put away, a new run. */
  drop(): void {
    this.target = null;
    this.spent = null;
    this.spentFor = 0;
  }
}
