/**
 * What being shot at does to the player, and what a flashbang does. Rounds that miss still cost something: the air cracks, the view
 * jumps, the image softens and the aim goes with it. That is why a machine gun on a lane works on a player who never gets hit, and why
 * dropping behind cover and moving on is a decision and not a habit.
 *
 * Nothing here takes health. All of it decays on the player's own clock, so a hit-stop cannot strand it.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import { clamp, rand } from '../../core/math';
import type { AiWorld } from '../aiWorld';

/** Metres from a round to the player at which it starts to tell. */
const CRACK_RANGE = 3.4;
/** What one round adds at the closest and what a round on the far side of a wall adds. */
const PER_ROUND = 0.085;
const THROUGH_COVER = 0.4;
/** Seconds of quiet before it starts to lift, and how fast it lifts per second. */
const LINGER = 0.35;
const FADE = 0.42;
/** Radians one close round jolts the view by. It is a real shove on the aim, at full suppression. */
const JOLT = 0.02;
/** Trauma per second at full suppression. */
const SHAKE = 0.9;
/** Seconds between the pulses that keep the image torn. */
const PULSE_SECONDS = 0.12;
/** Pushes the music down so that the gunfire takes the room. */
const DUCK = 0.6;
/** How blurred the image is at full suppression, in the shader's own units. */
const BLUR = 1;

/** Metres a bang reaches, full-strength seconds of white, and seconds of ringing after. */
const BLIND_RANGE = 13;
const BLIND_SECONDS = 5.5;
const BLIND_INTENSITY = 11;
/** Share of the blinding that having your back to it still costs. */
const BACK_TURNED = 0.42;

const _to = new THREE.Vector3();

export class Suppression {
  /** 0 calm, 1 cannot think. */
  level = 0;
  /** How much of a bang the player is still inside. */
  blind = 0;
  /** Rounds that cracked past, for anyone measuring. */
  cracks = 0;
  private quietAt = 0;
  private pulseAt = 0;
  private blindUntil = 0;
  private blindSeconds = 1;

  constructor(private readonly w: AiWorld) {}

  private get ctx(): Ctx {
    return this.w.ctx;
  }

  reset(): void {
    this.level = this.blind = this.cracks = 0;
    this.quietAt = this.pulseAt = this.blindUntil = 0;
    this.ctx.render.post.setSuppression?.(0);
    this.ctx.hud.dazzle?.(0);
  }

  /** One round went somewhere near. `line` is whether it had a clear run at the player. */
  round(muzzle: THREE.Vector3, dir: THREE.Vector3, line: boolean): void {
    const { player } = this.w;
    if (!player.alive) return;
    _to.subVectors(player.chest, muzzle);
    const along = _to.dot(dir);
    if (along <= 0) return;
    const miss = Math.sqrt(Math.max(_to.lengthSq() - along * along, 0));
    if (miss > CRACK_RANGE) return;
    const close = 1 - miss / CRACK_RANGE;
    const add = PER_ROUND * close * (line ? 1 : THROUGH_COVER);
    this.level = clamp(this.level + add);
    this.quietAt = this.w.now + LINGER;
    this.cracks++;
    if (!line) return;
    const kick = JOLT * close * (0.4 + this.level);
    this.ctx.camera.kick(rand(-kick, kick), rand(-kick, kick), rand(-kick, kick) * 0.6);
  }

  /** A bang went off at `at`. A wall in the way is the only thing that stops it. */
  flash(at: THREE.Vector3): boolean {
    const { w } = this;
    const p = w.player;
    const d = p.eye.distanceTo(at);
    if (d > BLIND_RANGE || !w.director.clearLine(at, p.eye)) return false;
    _to.subVectors(at, p.eye).normalize();
    const facing = BACK_TURNED + (1 - BACK_TURNED) * Math.max(0, _to.dot(p.forward));
    const strength = clamp((1 - (d / BLIND_RANGE) ** 2) * facing);
    const seconds = BLIND_SECONDS * (0.45 + 0.55 * strength);
    const { audio, camera, render } = this.ctx;
    // The curve in post is the square of what is left, so this stays white for over half of `seconds` and then comes back slowly.
    render.post.flash(0xffffff, BLIND_INTENSITY * strength, seconds);
    render.post.chromatic(0.5 * strength, seconds);
    camera.addTrauma(0.35 * strength);
    camera.kick(rand(-0.05, 0.05) * strength, rand(-0.05, 0.05) * strength, rand(-0.08, 0.08) * strength);
    audio.duck(0.9, seconds);
    audio.play('ear_ring', { volume: strength, duration: seconds, unaffectedByTime: true });
    this.blind = Math.max(this.blind, strength);
    this.blindUntil = w.now + seconds;
    this.blindSeconds = seconds;
    this.level = Math.max(this.level, strength);
    this.quietAt = w.now + seconds * 0.6;
    return true;
  }

  get blinded(): boolean {
    return this.w.now < this.blindUntil;
  }

  update(dt: number): void {
    const { ctx, w } = this;
    if (w.now >= this.quietAt) this.level = Math.max(0, this.level - FADE * dt);
    if (this.blind > 0) {
      // Comes back slowly and all at the end, the way the white on the screen does.
      const left = (this.blindUntil - w.now) / this.blindSeconds;
      if (left <= 0) this.blind = 0;
      ctx.hud.dazzle?.(left <= 0 ? 0 : clamp(left * 2.2) * this.blind);
    }
    const { level } = this;
    ctx.render.post.setSuppression?.(level * level * BLUR);
    if (level < 0.05) return;
    ctx.camera.addTrauma(level * level * SHAKE * dt);
    if (w.now < this.pulseAt) return;
    this.pulseAt = w.now + PULSE_SECONDS;
    ctx.render.post.chromatic(0.06 * level, 0.2);
    ctx.audio.duck(DUCK * level, 0.3);
  }
}
