/**
 * In-engine cutscenes: the camera on rails, with the body parked somewhere safe and the on-foot HUD put away. It borrows the gunner's
 * seat for all of this, because a seat is exactly a view that is not the player's.
 */
import * as THREE from 'three';
import type { Ctx, SeatView } from '../core/contracts';
import type { SeatPanel } from '../core/gameplay';
import { clamp, smoothstep } from '../core/math';
import type { Cutscene, Shot } from './types';

/** A press this soon after the cut is the tail of whatever the player was doing. */
const SKIP_AFTER = 0.5;

const _eye = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _to = new THREE.Vector3();

export class CutscenePlayer {
  private readonly view: SeatView = { position: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0, shake: 0.4 };
  private shots: readonly Shot[] | null = null;
  private index = 0;
  private clock = 0;
  private total = 0;
  private done: ((skipped: boolean) => void) | null = null;

  constructor(private readonly ctx: Ctx, private readonly panel: SeatPanel) {}

  get playing(): boolean {
    return this.shots !== null;
  }

  play(scene: Cutscene, done: (skipped: boolean) => void): void {
    const { camera, hud, player } = this.ctx;
    this.shots = scene.shots;
    this.index = this.clock = this.total = 0;
    this.done = done;
    player.park(player.position);
    camera.setSeat(this.view);
    hud.seat(this.panel);
    this.frame();
  }

  private frame(): void {
    const shot = this.shots![this.index]!;
    const t = smoothstep(0, 1, clamp(this.clock / shot.seconds));
    const v = this.view;
    v.position.lerpVectors(_a.set(...shot.from), _b.set(...shot.to), t);
    _eye.lerpVectors(_a.set(...shot.lookFrom), _b.set(...shot.lookTo), t);
    _to.subVectors(_eye, v.position);
    v.yaw = Math.atan2(-_to.x, -_to.z);
    v.pitch = Math.atan2(_to.y, Math.hypot(_to.x, _to.z));
    this.ctx.camera.syncSeat();
  }

  update(dt: number): void {
    if (!this.shots) return;
    this.clock += dt;
    this.total += dt;
    if (this.total > SKIP_AFTER && this.ctx.input.pressed('interact')) {
      this.stop(true);
      return;
    }
    if (this.clock >= this.shots[this.index]!.seconds) {
      this.clock = 0;
      if (++this.index >= this.shots.length) {
        this.stop(false);
        return;
      }
    }
    this.frame();
  }

  private stop(skipped: boolean): void {
    const { camera, hud, player } = this.ctx;
    const done = this.done;
    this.shots = null;
    this.done = null;
    camera.setSeat(null);
    hud.seat(null);
    player.unpark(0);
    done?.(skipped);
  }

  reset(): void {
    this.shots = null;
    this.done = null;
  }
}
