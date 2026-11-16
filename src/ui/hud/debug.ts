/** F3 frame counter and F4 engine readout. Text refreshes a few times a second, so reading it costs nothing. */
import type { Ctx } from '../../core/contracts';
import { Label, Shown, div, h } from '../dom';
import type { HudState } from '../state';
import type { CommsLine } from '../../enemies/outpost/events';
import { RULES } from '../../enemies/outpost/chatter/lines';

const REFRESH = 0.25;

interface GameStats {
  fps?: number;
  cpuMs?: number;
  state?: string;
  drawCalls?: number;
  triangles?: number;
  enemies?: number;
}

const readStats = (): GameStats =>
  (window as unknown as { __op2?: { stats?: () => GameStats } }).__op2?.stats?.() ?? {};

const fix = (v: number | undefined, digits = 0): string => (typeof v === 'number' ? v.toFixed(digits) : '-');

export class DebugOverlays {
  readonly el: HTMLElement;
  private fps: Label;
  private info: Label;
  private fpsShown: Shown;
  private infoShown: Shown;
  private showFps = false;
  private showInfo = false;
  private clock = 0;
  /** The last few chatter lines and why their rows won: the rule tuning view (docs/design/squad-comms.md, "Build plan" 4). */
  private readonly said: string[] = [];

  constructor(private readonly ctx: Ctx) {
    const fps = div('dbg-fps');
    const info = h('pre', 'dbg-info');
    this.el = div('dbg', fps, info);
    this.fps = new Label(fps);
    this.info = new Label(info);
    this.fpsShown = new Shown(fps, 'block');
    this.infoShown = new Shown(info, 'block');
    this.fpsShown.set(false);
    this.infoShown.set(false);
  }

  chatter(line: CommsLine): void {
    if (line.row === undefined) return;
    const row = line.row >= 0 ? RULES[line.row] : undefined;
    this.said.push(`${(line.speaker ?? line.squad).padEnd(20).slice(0, 20)} ${line.why || (row ? `${row.id}  (host decided)` : 'relay')}`);
    if (this.said.length > 6) this.said.shift();
  }

  toggleFps(): void {
    this.showFps = !this.showFps;
    this.fpsShown.set(this.showFps);
    this.clock = 0;
  }

  toggleInfo(): void {
    this.showInfo = !this.showInfo;
    this.infoShown.set(this.showInfo);
    this.clock = 0;
  }

  update(s: HudState, dt: number): void {
    if (!this.showFps && !this.showInfo) return;
    this.clock -= dt;
    if (this.clock > 0) return;
    this.clock = REFRESH;
    const stats = readStats();
    if (this.showFps) this.fps.set(`${fix(stats.fps)} fps  ${fix(stats.cpuMs, 1)} ms`);
    if (this.showInfo) {
      const p = this.ctx.player.position;
      const v = this.ctx.player.velocity;
      this.info.set([
        `state    ${stats.state ?? '-'}`,
        `pos      ${fix(p?.x, 1)} ${fix(p?.y, 1)} ${fix(p?.z, 1)}`,
        `vel      ${fix(v?.x, 1)} ${fix(v?.y, 1)} ${fix(v?.z, 1)}`,
        `speed    ${s.speed.toFixed(1)} m/s`,
        `health   ${s.health.toFixed(0)} / ${s.maxHealth.toFixed(0)}  armor ${s.armor.toFixed(0)}`,
        `wave     ${s.wave} ${s.phase}  left ${s.remaining}`,
        `enemies  ${s.enemies.length}`,
        `combo    ${s.combo}  x${s.multiplier.toFixed(1)}`,
        `draws    ${stats.drawCalls ?? '-'}`,
        `tris     ${typeof stats.triangles === 'number' ? stats.triangles.toLocaleString('en-US') : '-'}`,
        `timescale ${this.ctx.time.scale.toFixed(2)}`,
        ...(this.said.length ? ['', 'chatter: speaker, row, score, ties, tier, facts, priority', ...this.said] : []),
      ].join('\n'));
    }
  }
}
