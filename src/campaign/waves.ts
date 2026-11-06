/** A mission decides who arrives and when, so the wave loop has nothing to do. Stands behind `ctx.waves` while one runs. */
import type { WavePhase, WaveSystem } from '../core/gameplay';

export class MissionWaves implements WaveSystem {
  readonly wave = 1;
  readonly phase: WavePhase = 'clearing';
  readonly nextWaveIn = 0;

  start(): void {}
}
