/**
 * The notice every screen shows while the team's slow motion runs: who slowed the world and with what ("KESTREL used Focus", in
 * that player's colour), the world's speed, and a bar that drains to the moment it ends. When the world is back to full speed
 * it says so, then goes. The owner's rule: no slow-mo starts on any screen without it, the causer's own screen included.
 *
 * Its own element inside the HUD's root (`hud.mount`), under the teammates strip; it needs nothing from the co-op HUD.
 */
import type { Ctx } from '../../core/contracts';
import { div, span } from '../../ui/dom';
import '../../ui/css/cooptime.css';
import { COLORS } from '../remote';
import { slowLine, type SlowEntry } from './slow';

/** How long "full speed" stays up after the last slow-mo ends, ms. */
const DONE_MS = 1100;

interface Row { el: HTMLElement; bar: HTMLElement; text: string; seen: number }

export interface SlowNames { name(slot: number): string; me: number }

export class SlowNotice {
  readonly el: HTMLElement;
  private readonly rows = new Map<string, Row>();
  private readonly list = div('ct-rows');
  private readonly state = div('ct-state');
  private stateText = '';
  private doneAt = 0;
  private stamp = 0;
  private shown = false;

  constructor(ctx: Ctx, private readonly names: SlowNames) {
    this.el = div('ct', this.list, this.state);
    this.el.style.display = 'none';
    (ctx.hud as Ctx['hud'] & { mount?(el: HTMLElement): void }).mount?.(this.el);
  }

  /** Every frame, with what is slowing the world now. */
  update(entries: readonly SlowEntry[], now: number): void {
    if (entries.length === 0 && !this.shown) return;
    this.stamp++;
    let scale = 1;
    for (const entry of entries) {
      scale = Math.min(scale, entry.scale);
      let row = this.rows.get(entry.key);
      const text = this.text(entry);
      if (!row) {
        const bar = div('ct-fill');
        row = { el: div('ct-row', div('ct-line'), div('ct-bar', bar)), bar, text: '', seen: 0 };
        this.rows.set(entry.key, row);
        this.list.append(row.el);
      }
      if (row.text !== text) {
        row.text = text;
        const line = slowLine(entry.kind, this.names.name(entry.slot), entry.label);
        const who = span('ct-who', line.who ? `${line.who}${entry.slot === this.names.me ? ' (you)' : ''}` : '');
        const color = `#${(COLORS[entry.slot] ?? 0xcfe8ff).toString(16).padStart(6, '0')}`;
        who.style.color = color;
        row.bar.style.background = color;
        row.el.firstElementChild!.replaceChildren(who, span('ct-what', line.who ? ` ${line.what}` : line.what));
      }
      row.seen = this.stamp;
      row.bar.style.transform = `scaleX(${Math.max(0, Math.min(1, (entry.until - now) / Math.max(1, entry.total))).toFixed(3)})`;
    }
    for (const [key, row] of this.rows) if (row.seen !== this.stamp) { row.el.remove(); this.rows.delete(key); }
    if (entries.length > 0) {
      this.doneAt = 0;
      this.say(`WORLD AT ${scale.toFixed(2)}x · YOU AT FULL SPEED`, false);
      if (!this.shown) { this.shown = true; this.el.style.display = ''; this.el.classList.add('up'); }
      return;
    }
    // The last one ended: say so, briefly, so the end is as plain as the start.
    if (!this.doneAt) { this.doneAt = now + DONE_MS; this.say('WORLD BACK TO FULL SPEED', true); }
    else if (now >= this.doneAt) { this.shown = false; this.doneAt = 0; this.el.style.display = 'none'; this.el.classList.remove('up'); }
  }

  private text(entry: SlowEntry): string { return `${entry.kind}|${entry.slot}|${entry.label}|${this.names.name(entry.slot)}`; }

  private say(text: string, done: boolean): void {
    if (text === this.stateText) return;
    this.stateText = text;
    this.state.textContent = text;
    this.el.classList.toggle('done', done);
  }

  /** What the notice reads right now, for the proofs: each line, and the line under them. Empty when it is not up. */
  read(): { lines: string[]; state: string } {
    return { lines: this.shown ? [...this.rows.values()].map(row => row.el.firstElementChild!.textContent ?? '') : [], state: this.shown ? this.stateText : '' };
  }

  dispose(): void { this.el.remove(); }
}
