/**
 * In-engine cutscenes: the camera on rails, with the body parked somewhere safe and the on-foot HUD put away. It borrows the gunner's
 * seat for all of this, because a seat is exactly a view that is not the player's.
 *
 * Black is the mission's curtain, not the film's. It outlives the seat, so nothing shows between a film ending and whatever comes next
 * being ready, and the seat's own first frame comes up out of it.
 */
import * as THREE from 'three';
import type { CharacterInstance, Ctx, LocomotionInput, SeatView } from '../core/contracts';
import { clamp, smoothstep } from '../core/math';
import type { EnemyManager } from '../enemies/EnemyManager';
import type { CampaignHud } from './hud';
import type { Cutscene, Mark, Shot } from './types';

/** A press this soon after the cut is the tail of whatever the player was doing. */
const SKIP_AFTER = 0.5;
/** Seconds up from black once a film has handed back. */
const LIFT_SECONDS = 0.9;
const STILL: LocomotionInput = { speed: 0, moveX: 0, moveZ: 0, aimYaw: 0, aimPitch: 0, grounded: true };

const _eye = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _to = new THREE.Vector3();

export class CutscenePlayer {
  private readonly view: SeatView = { position: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0, shake: 0.4 };
  private scene: Cutscene | null = null;
  private index = 0;
  private clock = 0;
  private total = 0;
  private done: ((skipped: boolean) => void) | null = null;
  private figure: CharacterInstance | null = null;

  constructor(private readonly ctx: Ctx, private readonly ui: CampaignHud) {}

  get playing(): boolean {
    return this.scene !== null;
  }

  play(scene: Cutscene, done: (skipped: boolean) => void): void {
    const { camera, hud, player, weapons } = this.ctx;
    this.scene = scene;
    this.index = this.clock = this.total = 0;
    this.done = done;
    player.park(player.position);
    weapons.setHolstered(true);
    camera.setSeat(this.view);
    hud.seat(this.ui.cinema);
    if (scene.figure) this.stage(scene.figure);
    this.cut();
    this.frame();
  }

  /** One man at the glass. He is a body with no brain, so nothing in the fight can see him. */
  private stage(at: Mark): void {
    const { ctx } = this;
    const char = ctx.characters.spawn('trooper');
    char.root.position.set(...at.at);
    char.root.rotation.y = at.yaw ?? 0;
    ctx.render.scene.add(char.root);
    char.anim.setLocomotion(STILL);
    (ctx.enemies as EnemyManager).outpost?.commander.props.fit(char, 'cap');
    this.figure = char;
  }

  private strike(): void {
    const char = this.figure;
    if (!char) return;
    (this.ctx.enemies as EnemyManager).outpost?.commander.props.strip(char);
    char.root.removeFromParent();
    char.release();
    this.figure = null;
  }

  /** What changes only when the shot does. */
  private cut(): void {
    const shot = this.scene!.shots[this.index]!;
    this.ctx.camera.setZoom(shot.fov ?? null);
    this.ui.caption(shot.caption ?? '');
  }

  private shade(shot: Shot): void {
    const { fadeIn = 0, fadeOut = 0, seconds } = shot;
    const up = fadeIn > 0 ? 1 - this.clock / fadeIn : 0;
    const down = fadeOut > 0 ? 1 - (seconds - this.clock) / fadeOut : 0;
    this.ui.curtain(clamp(Math.max(up, down)));
  }

  private frame(): void {
    const shot = this.scene!.shots[this.index]!;
    const t = smoothstep(0, 1, clamp(this.clock / shot.seconds));
    const v = this.view;
    v.position.lerpVectors(_a.set(...shot.from), _b.set(...shot.to), t);
    _eye.lerpVectors(_a.set(...shot.lookFrom), _b.set(...shot.lookTo), t);
    _to.subVectors(_eye, v.position);
    v.yaw = Math.atan2(-_to.x, -_to.z);
    v.pitch = Math.atan2(_to.y, Math.hypot(_to.x, _to.z));
    this.shade(shot);
    this.ctx.camera.syncSeat();
  }

  update(dt: number): void {
    const { scene } = this;
    if (!scene) return;
    this.clock += dt;
    this.total += dt;
    this.figure?.anim.update(dt, 0);
    if (this.total > SKIP_AFTER && this.ctx.input.pressed('interact')) {
      this.stop(true);
      return;
    }
    if (this.clock >= scene.shots[this.index]!.seconds) {
      this.clock = 0;
      if (++this.index >= scene.shots.length) {
        this.stop(false);
        return;
      }
      this.cut();
    }
    this.frame();
  }

  private stop(skipped: boolean): void {
    const { ui } = this;
    const { endsBlack } = this.scene!;
    const done = this.done;
    this.release();
    ui.curtain(1);
    if (!endsBlack) ui.lift(LIFT_SECONDS);
    done?.(skipped);
  }

  private release(): void {
    const { camera, hud, player, weapons } = this.ctx;
    this.scene = null;
    this.done = null;
    this.strike();
    this.ui.caption('');
    camera.setSeat(null);
    camera.setZoom(null);
    hud.seat(null);
    player.unpark(0);
    weapons.setHolstered(false);
  }

  /** A restart or a quit from the pause menu, with the film still running. */
  reset(): void {
    if (this.scene) this.release();
  }
}
