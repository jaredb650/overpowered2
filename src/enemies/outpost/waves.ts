/**
 * The Outpost's wave loop. The swarm's `Waves` feeds packs from a roster and clears when the field is empty; this feeds
 * squads through the gates, one man at a time, and clears when nobody is left fighting, so prisoners do not hold it up.
 */
import type { Ctx } from '../../core/contracts';
import type { EnemyId, WavePhase, WaveSystem } from '../../core/gameplay';
import type { EnemyManager } from '../EnemyManager';
import { Commander } from '../commander';
import { composeOutpostWave, MAX_HOSTILE } from './doctrine';
import type { Outpost } from './index';

const INTERMISSION = 8;
const FIRST_WAVE_DELAY = 3;
const TICK_SECONDS = 3;
/** Between men walking through a gate, and between squads. Dread stretches the second: section 14.3, reinforcements hesitate. */
const MAN_GAP = 0.55;
const SQUAD_GAP = 3.5;

export class OutpostWaves implements WaveSystem {
  wave = 0;
  phase: WavePhase = 'intermission';
  nextWaveIn = 0;

  private queue: EnemyId[][] = [];
  private cursor = 0;
  private seat = 0;
  private clock = 0;
  private running = false;
  private lastTick = 0;

  constructor(private readonly ctx: Ctx, private readonly o: Outpost, private readonly manager: EnemyManager) {}

  reset(): void {
    this.wave = 0;
    this.phase = 'intermission';
    this.nextWaveIn = 0;
    this.queue = [];
    this.cursor = this.seat = 0;
    this.running = false;
    this.manager.queued = 0;
  }

  start(): void {
    this.reset();
    this.running = true;
    this.nextWaveIn = FIRST_WAVE_DELAY;
    this.ctx.audio.music('easy');
    if (Commander.forcedWave() > 1) this.jumpTo(Commander.forcedWave());
  }

  /** For tests: straight to a wave. */
  jumpTo(wave: number): void {
    this.running = true;
    this.wave = wave - 1;
    this.nextWaveIn = 0;
    this.phase = 'intermission';
  }

  update(): void {
    if (!this.running) return;
    const dt = this.ctx.time.dt;
    if (this.phase === 'intermission') {
      this.nextWaveIn -= dt;
      const whole = Math.ceil(this.nextWaveIn);
      if (whole !== this.lastTick) {
        this.lastTick = whole;
        if (whole > 0 && whole <= TICK_SECONDS && this.wave > 0) this.ctx.audio.play('wave_tick');
      }
      if (this.nextWaveIn <= 0) this.begin(this.wave + 1);
      return;
    }
    if (this.phase === 'spawning') this.feed(dt);
    this.checkClear();
  }

  private begin(wave: number): void {
    const { ctx, manager } = this;
    this.wave = wave;
    manager.setWave(wave);
    this.queue = this.o.commander.compose(wave, composeOutpostWave(wave, Math.random));
    this.cursor = this.seat = 0;
    this.clock = 0.4;
    let total = 0;
    for (const squad of this.queue) total += squad.length;
    manager.queued = total;
    this.phase = 'spawning';
    if (wave >= 10) ctx.audio.music('hard');
    ctx.audio.play(wave >= 10 ? 'wave_start_hard' : 'wave_start');
    ctx.events.emit('wave:start', { wave, total, boss: false });
    this.o.onWaveStart();
  }

  private feed(dt: number): void {
    if (this.cursor >= this.queue.length) {
      this.phase = 'clearing';
      return;
    }
    this.clock -= dt;
    if (this.clock > 0) return;
    const squad = this.queue[this.cursor]!;
    if (this.seat === 0) {
      // The rest of the wave waits outside the wire until there is room in the fight.
      if (this.o.hostile + squad.length > MAX_HOSTILE) return;
      this.o.formSquad(squad.length);
      this.o.commander.onSquadFormed(this.cursor);
    }
    this.o.sendIn(squad[this.seat]!);
    this.manager.queued--;
    this.seat++;
    if (this.seat < squad.length) {
      this.clock = MAN_GAP;
      return;
    }
    this.seat = 0;
    this.cursor++;
    this.clock = SQUAD_GAP * this.o.dread.hesitation;
  }

  private checkClear(): void {
    const { ctx, manager } = this;
    if (this.cursor < this.queue.length || manager.queued > 0 || this.o.hostile > 0) return;
    const bonus = 500 + 150 * this.wave;
    ctx.audio.play('wave_clear');
    ctx.events.emit('wave:clear', { wave: this.wave, bonus });
    this.phase = 'intermission';
    this.nextWaveIn = this.o.commander.intermission(this.wave, INTERMISSION);
  }
}
