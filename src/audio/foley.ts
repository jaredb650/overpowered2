/**
 * Continuous sounds that follow the player's body. The player system plays one-shots from its own
 * events; these beds need per-frame levels, so they live here and read true state from ctx.player.
 */
import type { AudioSystem, Ctx, LoopHandle } from '../core/contracts';
import { clamp, damp, smoothstep } from '../core/math';
import { DEAD_HANDLE } from './voices';

/** Health fraction where the world starts to close in, and where it has fully closed. */
const HEALTH_DULL_START = 0.42;
const HEALTH_DULL_FULL = 0.12;
const HEARTBEAT_MIN_RATE = 0.85;
const HEARTBEAT_MAX_RATE = 1.55;
const WARN_BELOW = 0.25;

/** A loop that starts when wanted, follows a level, and lets go without a click. */
class Bed {
  private handle: LoopHandle = DEAD_HANDLE;
  private level = 0;

  constructor(
    private readonly audio: AudioSystem,
    private readonly id: string,
    private readonly riseRate: number,
    private readonly fallRate: number,
  ) {}

  update(target: number, pitch: number, realDt: number): void {
    this.level = damp(this.level, target, target > this.level ? this.riseRate : this.fallRate, realDt);
    if (this.level < 0.01 && target === 0) {
      if (this.handle.alive) this.handle.stop(0.05);
      this.level = 0;
      return;
    }
    if (!this.handle.alive) {
      this.handle = this.audio.startLoop(this.id, { volume: this.level, pitch, fadeIn: 0.02 });
      return;
    }
    this.handle.setVolume(this.level, 0.04);
    this.handle.setPitch(pitch);
  }

  stop(): void {
    if (this.handle.alive) this.handle.stop(0.1);
    this.level = 0;
  }
}

export class PlayerFoley {
  private readonly wind: Bed;
  private readonly slide: Bed;
  private readonly wallrun: Bed;
  private readonly fall: Bed;
  private readonly heart: Bed;
  private slamming = false;
  private warned = false;
  /** 0..1, how far low health has dulled the world. */
  lowHealth = 0;

  constructor(private readonly ctx: Ctx, audio: AudioSystem) {
    this.wind = new Bed(audio, 'speed_wind_loop', 3.5, 2.2);
    this.slide = new Bed(audio, 'slide_loop', 24, 16);
    this.wallrun = new Bed(audio, 'wallrun_loop', 24, 14);
    this.fall = new Bed(audio, 'slam_fall_loop', 12, 26);
    this.heart = new Bed(audio, 'heartbeat_loop', 2, 1.2);
    ctx.events.on('player:slamstart', () => { this.slamming = true; });
    ctx.events.on('player:slam', () => { this.slamming = false; });
  }

  private silence(): void {
    this.wind.stop();
    this.slide.stop();
    this.wallrun.stop();
    this.fall.stop();
    this.heart.stop();
  }

  reset(): void {
    this.silence();
    this.slamming = false;
    this.warned = false;
    this.lowHealth = 0;
  }

  update(realDt: number): void {
    const p = this.ctx.player;
    const v = p.velocity;
    // Stubbed in sandboxes: a proxy where a Vector3 would be has no numeric x.
    if (typeof p.health !== 'number' || !v || typeof v.x !== 'number') return;

    if (!p.alive) {
      this.silence();
      this.lowHealth = 1;
      return;
    }

    const flat = Math.hypot(v.x, v.z);
    const speed = Math.hypot(flat, v.y);
    this.wind.update(smoothstep(13, 46, speed), 0.72 + 0.8 * smoothstep(13, 60, speed), realDt);

    const sliding = p.sliding && p.grounded;
    this.slide.update(sliding ? clamp(0.35 + flat / 34, 0, 1) : 0, 0.8 + flat / 60, realDt);

    this.wallrun.update(p.wallRunning ? clamp(0.45 + flat / 40, 0, 1) : 0, 0.85 + flat / 70, realDt);

    if (p.grounded) this.slamming = false;
    const falling = this.slamming && v.y < 0;
    this.fall.update(falling ? clamp(-v.y / 60, 0.3, 1) : 0, 0.7 + clamp(-v.y / 70, 0, 1) * 0.9, realDt);

    const health = p.maxHealth > 0 ? p.health / p.maxHealth : 1;
    this.lowHealth = clamp((HEALTH_DULL_START - health) / (HEALTH_DULL_START - HEALTH_DULL_FULL));
    const panic = this.lowHealth;
    this.heart.update(panic > 0 ? 0.35 + panic * 0.65 : 0, HEARTBEAT_MIN_RATE + (HEARTBEAT_MAX_RATE - HEARTBEAT_MIN_RATE) * panic, realDt);

    if (health < WARN_BELOW && !this.warned) {
      this.warned = true;
      this.ctx.audio.play('low_health_warn');
    } else if (health > WARN_BELOW + 0.1) {
      this.warned = false;
    }
  }
}
