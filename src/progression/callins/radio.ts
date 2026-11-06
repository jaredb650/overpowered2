/**
 * Aircrew chatter as text on the HUD, with a garbled radio burst under each line. There are no recorded voices for a
 * crew yet, so `say` is written to stay the only thing that would change when there are.
 *
 * Lines queue, because a burst of events must read as a crew talking and not as a log. The queue is short on purpose:
 * a line that waits too long is about something that has already happened.
 */
import type { Ctx } from '../../core/contracts';

const LINE_GAP = 1.5;
const MAX_WAITING = 3;

export class Radio {
  private readonly waiting: string[] = [];
  private gap = 0;

  constructor(private readonly ctx: Ctx, private readonly callsign: string, private readonly color: string) {}

  say(line: string): void {
    if (this.waiting.length >= MAX_WAITING) this.waiting.shift();
    this.waiting.push(line);
  }

  update(dt: number): void {
    this.gap -= dt;
    if (this.gap > 0 || this.waiting.length === 0) return;
    this.gap = LINE_GAP;
    const { audio, hud } = this.ctx;
    hud.feed(`${this.callsign}: ${this.waiting.shift()!}`, this.color);
    audio.play('vox_radio', { volume: 0.55, unaffectedByTime: true });
  }
}
