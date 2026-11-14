/**
 * Stims: the player carries up to STIM.max, health pickups add one each, and the stim key injects one. The injection is a
 * second in which the player cannot fire, aim or reload and walks slowly, and taking damage does not stop it; the heal
 * lands halfway, when the needle goes in. The off hand's animation answers the 'stim:inject' event (viewmodels/offhand.ts).
 *
 * `spend()` is the outside door, for reviving an ally (Outpost Defense piece 2): it takes a stim and does nothing else.
 *
 * Runs on the player's clock, as the sonar does: SLOWMO does not stretch the player's own hands.
 */
import type { Ctx } from '../core/contracts';
import type { StimKit } from '../core/gameplay';
import { holdSpeed } from '../weapons/handling';
import { PICKUP_LOOK, STIM } from './data';

export class Stims implements StimKit {
  count: number = STIM.start;
  readonly max = STIM.max;
  /** Seconds into the injection, or -1. */
  private t = -1;
  private healed = false;
  private rest = 0;

  constructor(private readonly ctx: Ctx) {}

  get injecting(): number {
    return this.t < 0 ? -1 : Math.min(1, this.t / STIM.seconds);
  }

  get full(): boolean {
    return this.count >= this.max;
  }

  give(n: number): number {
    const took = Math.max(0, Math.min(Math.floor(n), this.max - this.count));
    this.count += took;
    return took;
  }

  spend(): boolean {
    if (this.count <= 0) return false;
    this.count--;
    return true;
  }

  /** What stops the key now: 'busy' is silent, the others say so. Null when a press would inject. */
  refusal(): 'busy' | 'empty' | 'full' | null {
    const { player, progression } = this.ctx;
    if (this.t >= 0 || this.rest > 0 || !player.alive || player.parked || progression?.targeting) return 'busy';
    if (this.count <= 0) return 'empty';
    if (player.health >= player.maxHealth) return 'full';
    return null;
  }

  update(dt: number): void {
    const { input, player } = this.ctx;
    if (this.rest > 0) this.rest -= dt;
    if (input.pressed('stim')) this.press();
    if (this.t < 0) return;
    if (!player.alive) {
      this.t = -1;
      return;
    }
    this.t += dt;
    if (!this.healed && this.t >= STIM.injectAt) this.inject();
    if (this.t >= STIM.seconds) {
      this.t = -1;
      this.rest = STIM.cooldown;
      return;
    }
    holdSpeed(player, STIM.moveCap, dt);
  }

  private press(): void {
    const { audio, events, hud, weapons } = this.ctx;
    const no = this.refusal();
    if (no === 'busy') return;
    if (no) {
      audio.play('ui_error');
      hud.feed(no === 'empty' ? 'NO STIMS' : 'HEALTH FULL', PICKUP_LOOK.health.color);
      return;
    }
    this.count--;
    this.t = 0;
    this.healed = false;
    weapons.occupy?.(STIM.seconds);
    audio.play('stim_click');
    events.emit('stim:inject', {});
  }

  private inject(): void {
    const { audio, player, render } = this.ctx;
    this.healed = true;
    player.heal(STIM.heal);
    audio.play('stim_hiss');
    render.post.flash(PICKUP_LOOK.health.color, 0.08, 0.3);
  }

  reset(): void {
    this.count = STIM.start;
    this.t = -1;
    this.healed = false;
    this.rest = 0;
  }
}
