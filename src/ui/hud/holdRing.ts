/**
 * The hold ring: a dial round the crosshair that fills while E is held on something that takes a hold (a capture, a revive), and
 * flashes once when the hold is done. One for every hold, so they all read alike. Whoever is holding asks for a fill each frame
 * (`HudSystem.hold`); a frame nobody asks, the ring is gone, so letting go or walking off clears it with no call of its own.
 */
import { Flag, Shown, div, markup } from '../dom';

/** Seconds the done flash stays up. */
export const FLASH_SECONDS = 0.35;

/** What the ring shows this frame, from the most asked of it since the last (null: nothing) and the flash still running. */
export function ringFrame(asked: number | null, flash: number, dt: number): { fill: number | null; flash: number } {
  if (asked !== null && asked >= 1) return { fill: 1, flash: FLASH_SECONDS };
  if (flash > 0) return { fill: 1, flash: Math.max(0, flash - dt) };
  return { fill: asked === null ? null : Math.max(0, asked), flash: 0 };
}

const R = 40;
const ROUND = 2 * Math.PI * R;

export class HoldRing {
  readonly el: HTMLElement;
  private readonly arc: SVGCircleElement;
  private readonly shown: Shown;
  private readonly done: Flag;
  private asked: number | null = null;
  private flash = 0;

  constructor() {
    const svg = markup<SVGSVGElement>(`<svg class="hr-svg" viewBox="-50 -50 100 100" aria-hidden="true"><circle class="hr-track" r="${R}"/>` +
      `<circle class="hr-arc" r="${R}" stroke-dasharray="${ROUND}" stroke-dashoffset="${ROUND}" transform="rotate(-90)"/><path class="hr-tick" d="M-12 1 L-4 9 L13 -9"/></svg>`);
    this.arc = svg.querySelector('.hr-arc')!;
    this.el = div('hr', svg);
    this.shown = new Shown(this.el);
    this.done = new Flag(this.el, 'done');
    this.shown.set(false);
  }

  /** This frame's fill, 0 to 1; 1 is done. Several askers in a frame: the fullest wins. */
  ask(fill: number): void {
    this.asked = Math.max(this.asked ?? 0, fill);
  }

  update(dt: number): void {
    const f = ringFrame(this.asked, this.flash, dt);
    this.asked = null;
    this.flash = f.flash;
    this.shown.set(f.fill !== null);
    this.done.set(f.flash > 0);
    if (f.fill !== null) this.arc.setAttribute('stroke-dashoffset', String(ROUND * (1 - f.fill)));
  }
}
