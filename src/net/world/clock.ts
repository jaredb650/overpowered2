/**
 * The time scale in co-op. The host's world is everyone's, so only slow-mo that is meant to be shared stays on its clock
 * (SHARED_SLOW); a guest keeps none of its own. A guest's slow-mo perk asks the host to slow the world (`slow`).
 */
import type { WorldContext } from './context';

/** Guest to host: my slow-mo perk started (`on`) or ended. The host slows the world for everyone. */
export type SlowEvent = { t: 'slow'; id: string; on: boolean };

/** Slow-mo every player shares: the host's world slows, so it slows on every screen. Everything else (hit-stop, the fan) is dropped. */
const SHARED_SLOW = /^(slowmo|timeWarp|bossDeath|coop:)/;

export class Clock {
  /** Host: slow-mo a guest's perk asked for, by request id, until when. */
  private readonly slows = new Map<string, number>();

  constructor(private readonly w: WorldContext) {
    if (!w.hosting) {
      w.listen('perk:start', e => { if (e.id === 'slowmo' || e.id === 'timeWarp') w.send({ t: 'slow', id: e.id, on: true }); });
      w.listen('perk:end', e => { if (e.id === 'slowmo' || e.id === 'timeWarp') w.send({ t: 'slow', id: e.id, on: false }); });
    }
    w.router.host('slow', (value, from, now) => {
      if (value.id !== 'slowmo' && value.id !== 'timeWarp') return;
      const id = `coop:${from}:${value.id}`;
      if (value.on) { w.ctx.time.pushScale(id, 0.25, 0.18, 0.4); this.slows.set(id, now + 8000); }
      else { w.ctx.time.popScale(id); this.slows.delete(id); }
    });
  }

  /** Before the clock ticks: the host keeps the slow-mo everyone shares, a guest keeps none (its world is the host's). */
  clock(): void {
    const time = this.w.ctx.time;
    if (!this.w.hosting) return time.clearScales();
    const now = performance.now();
    for (const [id, until] of this.slows) if (now >= until) { time.popScale(id); this.slows.delete(id); }
    time.keepScales(id => SHARED_SLOW.test(id));
  }
}
